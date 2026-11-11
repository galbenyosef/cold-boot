/**
 * Shared enemy brain plumbing: world blackboard, perception (LOS + distance + noise), path following with
 * LOS string-pulling, ground steering through physics capsules, stuck detection, audio loop upkeep.
 * Per-type behaviour lives in husk/skitter/sentry.
 */
import * as THREE from 'three';
import type { CapsuleBody, DynamicBox, Enemy, EnemyType, GameContext, LoopHandle } from '../core/types';
import { volumeNormal, type HitVolume } from './shared/hit';
import type { Rig } from './shared/rig';
import { angleDiff } from './shared/ik';
import type { NavGraph } from './nav';

export interface EnemyWorld {
  ctx: GameContext;
  nav: NavGraph;
  enemies: EnemyBase[];
  time: number;
  /** Player feet position / eye / velocity (refreshed every frame; safe defaults when there is no player yet). */
  playerPos: THREE.Vector3;
  playerEye: THREE.Vector3;
  playerVel: THREE.Vector3;
  playerAlive: boolean;
  /** Where the player's eye was `seconds` ago (≤ 1 s). */
  playerEyeAgo(seconds: number, out: THREE.Vector3): THREE.Vector3;
  rand(): number;
  onDeath(e: EnemyBase): void;
  /** Debug: force a visible LOD (-1 = by distance). */
  forceLod: number;
  /** World time until which a husk mutter is playing (max one at a time, globally). */
  whisperUntil: number;
}

const _from = new THREE.Vector3(), _to = new THREE.Vector3();
const _n = new THREE.Vector3(), _hn = new THREE.Vector3(), _mean = new THREE.Vector3();
const HIT_SLOTS = 12;
const PART_RANK: Record<string, number> = { limb: 1, torso: 2, core: 2, head: 3 };

/** Hits accumulated during one frame, flushed as ONE effect burst (shotgun = 9 damage calls). */
export interface HitBurst {
  /** Number of damage calls. */
  n: number;
  /** Sum of raw damage. */
  amount: number;
  /** Representative impact point / outward normal / shot direction. */
  point: THREE.Vector3; normal: THREE.Vector3; dir: THREE.Vector3;
  /** Most important part hit ('head' > 'torso'/'core' > 'limb'). */
  part: string;
  /** Region of the representative hit. */
  region: string;
}
let nextId = 1;

export abstract class EnemyBase implements Enemy {
  readonly id = nextId++;
  abstract readonly type: EnemyType;
  readonly object = new THREE.Group();
  readonly body: CapsuleBody;
  health = 1;
  alive = true;
  state: Enemy['state'] = 'idle';
  /** Game yaw: 0 faces -Z (same convention as the player). */
  yaw = 0;
  volumes: HitVolume[] = [];
  /** Broad-phase sphere (relative to position) for hitscan. */
  boundCenterY = 0.5;
  boundRadius = 1;
  /** True from the moment the machine starts waking. */
  awake = false;
  /** Seconds until a scheduled wake fires (-1 = none). */
  wakeDelay = -1;
  stateTime = 0;
  lodAcc = 0;
  diedAt = 0;
  /** Corpse finished collapsing → no more updates. */
  settled = false;
  /** Rig whose LOD / visibility the manager drives (set by subclasses). */
  lodRig: Rig | null = null;
  /** Level object whose `visible` tells whether this machine's room is being drawn (cached, see manager). */
  roomTag: THREE.Object3D | null = null;
  roomTagAt = -1;
  /** Keep the object hidden regardless of distance (e.g. a skitter still inside its vent). */
  holdHidden = false;
  /**
   * Scripted puppet (EnemyManager.actor): never perceives / attacks / takes damage, plays no audio loop and emits
   * only enemy:step. Set by subclasses first thing in their constructor.
   */
  isActor = false;

  // perception
  seesPlayer = false;
  dist = 99;
  protected losTimer: number;
  protected eyeHeight = 1.5;

  // navigation
  protected path: number[] = [];
  protected pathIdx = 0;
  protected replanTimer = 0;
  protected pullTimer = 0;
  protected directTimer = 0;
  protected direct = false;
  readonly waypoint = new THREE.Vector3();
  protected lastProgress = new THREE.Vector3();
  protected stuckTimer = 0;
  protected stuckCount = 0;
  protected unstickTime = 0;
  protected unstickDir = 1;

  private loop: LoopHandle | null = null;
  private loopTimer = 0;

  // hit fx accumulation (see queueHit / flushHits)
  private hitPts: THREE.Vector3[] = [];
  private hitNrm: THREE.Vector3[] = [];
  private readonly burst: HitBurst = { n: 0, amount: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), dir: new THREE.Vector3(), part: '', region: '' };

  // wreck collision
  /** Set by subclasses when the wreck has come to rest: low box hugging the torso (world space). */
  wreckBox: THREE.Box3 | null = null;
  wreckBody: DynamicBox | null = null;
  wreckChecked = 0;

  constructor(protected world: EnemyWorld, readonly group: string, position: THREE.Vector3, yaw: number, radius: number, height: number) {
    this.body = { position: position.clone(), velocity: new THREE.Vector3(), radius, height, onGround: false, gravityScale: 1 };
    this.yaw = yaw;
    this.losTimer = world.rand() * 0.2;
    this.replanTimer = world.rand() * 0.5;
    this.lastProgress.copy(position);
    this.object.position.copy(position);
    world.ctx.scene.add(this.object);
  }

  get position(): THREE.Vector3 { return this.body.position; }
  /** World position of the sensor used for line-of-sight checks. */
  protected eyePos(out: THREE.Vector3): THREE.Vector3 {
    const p = this.body.position;
    return out.set(p.x, p.y + this.eyeHeight, p.z);
  }
  /** World centre of the hitscan broad-phase sphere (radius boundRadius). */
  boundCenter(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.object.position); out.y += this.boundCenterY;
    return out;
  }
  /** Bodies with this set are skipped by the manager's separation pass (e.g. clinging to a wall). */
  ignoreSeparation = false;
  get hunting(): boolean { return this.alive && this.awake && (this.state === 'alert' || this.state === 'chase' || this.state === 'attack' || this.state === 'stagger'); }

  abstract update(dt: number): void;
  /** Begin waking (dormant → alive). `delay` seconds from now. */
  wake(delay = 0): void {
    if (!this.alive || this.awake || this.wakeDelay >= 0) return;
    this.wakeDelay = Math.max(0, delay);
  }
  /** Noise / damage alert for an awake-but-idle machine. */
  alert(): void {
    if (!this.alive) return;
    if (this.state === 'dormant') { this.wake(0); return; }
    if (this.state === 'idle') this.enterAlert();
  }
  protected abstract enterAlert(): void;
  abstract applyDamage(volume: HitVolume, amount: number, point: THREE.Vector3, dir: THREE.Vector3): void;
  // ── scripted puppet API (EnemyManager.actor) — implemented per type
  /** Walk / crawl / fly in a straight line to `point`; call `done` on arrival (or when abandoned). */
  puppetMove(_point: THREE.Vector3, _speed: number | undefined, done: () => void): void { done(); }
  puppetPose(_pose: string): void { /* per type */ }
  puppetLook(_point: THREE.Vector3 | null): void { /* per type */ }
  puppetEyes(_on: boolean): void { /* per type */ }
  /** Abort a pending move (resolves it). */
  puppetStop(): void { /* per type */ }

  /** Free per-instance GPU resources and leave the scene. */
  dispose(): void {
    this.stopLoop(0);
    if (this.wreckBody) { this.wreckBody.remove(); this.wreckBody = null; }
    this.wreckBox = null;
    this.object.removeFromParent();
  }

  // ── hit effects ────────────────────────────────────────────────────────
  /** Record one hit for this frame's effect burst (the burst is emitted once by flushHits). */
  protected queueHit(vol: HitVolume, amount: number, point: THREE.Vector3, dir: THREE.Vector3): void {
    const b = this.burst;
    if (this.hitPts.length === 0) for (let i = 0; i < HIT_SLOTS; i++) { this.hitPts.push(new THREE.Vector3()); this.hitNrm.push(new THREE.Vector3()); }
    const k = b.n < HIT_SLOTS ? b.n : HIT_SLOTS - 1;
    this.hitPts[k].copy(point);
    // outward normal: the capsule surface normal, bent toward the shooter
    volumeNormal(vol, point, _hn);
    this.hitNrm[k].copy(_hn).addScaledVector(dir, -0.6).normalize();
    if (b.n === 0) { b.dir.set(0, 0, 0); b.part = vol.part; b.region = vol.region; }
    else if ((PART_RANK[vol.part] ?? 0) > (PART_RANK[b.part] ?? 0)) { b.part = vol.part; b.region = vol.region; }
    b.dir.add(dir);
    b.n++;
    b.amount += amount;
  }

  /** Emit the accumulated burst (called by the manager once per frame, also for corpses). */
  flushHits(): void {
    const b = this.burst;
    if (b.n === 0) return;
    const m = Math.min(b.n, HIT_SLOTS);
    _mean.set(0, 0, 0);
    for (let i = 0; i < m; i++) _mean.add(this.hitPts[i]);
    _mean.multiplyScalar(1 / m);
    // representative impact: the recorded point closest to the centroid of the pattern
    let bi = 0, bd = Infinity;
    for (let i = 0; i < m; i++) { const d = this.hitPts[i].distanceToSquared(_mean); if (d < bd) { bd = d; bi = i; } }
    b.point.copy(this.hitPts[bi]); b.normal.copy(this.hitNrm[bi]);
    if (b.dir.lengthSq() > 1e-8) b.dir.normalize(); else b.dir.copy(b.normal).negate();
    try { this.hitFx(b); } catch { /* fx optional */ }
    b.n = 0; b.amount = 0;
  }

  /** Per-type look of a (coalesced) hit. */
  protected abstract hitFx(b: HitBurst): void;

  protected setState(s: Enemy['state']): void {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
  }

  protected emit(type: 'enemy:spawned' | 'enemy:woke' | 'enemy:alerted' | 'enemy:step'): void {
    if (this.isActor && type !== 'enemy:step') return;
    this.world.ctx.events.emit(type, { id: this.id, type: this.type, position: this.body.position });
  }
  protected emitAttack(kind: 'melee' | 'ranged'): void {
    if (this.isActor) return;
    this.world.ctx.events.emit('enemy:attack', { id: this.id, type: this.type, position: this.body.position, kind });
  }

  // ── audio loop ─────────────────────────────────────────────────────────
  protected startLoop(id: string, volume = 1): void {
    if (this.loop || this.isActor) return;
    try { this.loop = this.world.ctx.audio.loop(id, { position: this.body.position, volume }); } catch { this.loop = null; }
  }
  protected stopLoop(fade = 0.3): void {
    if (this.loop) { try { this.loop.stop(fade); } catch { /* audio not ready */ } this.loop = null; }
  }
  protected tickLoop(dt: number): void {
    if (!this.loop) return;
    this.loopTimer -= dt;
    if (this.loopTimer <= 0) { this.loopTimer = 0.12; this.loop.setPosition(this.body.position); }
  }

  // ── perception ─────────────────────────────────────────────────────────
  /** Updates `dist` every call and `seesPlayer` at ~6 Hz. */
  protected perceive(dt: number): void {
    const w = this.world, p = this.body.position;
    this.dist = Math.hypot(w.playerPos.x - p.x, w.playerPos.z - p.z, (w.playerPos.y - p.y) * 0.6);
    this.losTimer -= dt;
    if (this.losTimer > 0) return;
    this.losTimer = 0.15 + w.rand() * 0.04;
    if (!w.playerAlive || this.dist > 40) { this.seesPlayer = false; return; }
    this.eyePos(_from);
    this.seesPlayer = w.ctx.physics.lineOfSight(_from, w.playerEye);
  }

  /** Idle machines notice the player by sight (front cone, or very close) — returns true when noticed. */
  protected noticesPlayer(range: number): boolean {
    if (!this.seesPlayer || this.dist > range) return false;
    if (this.dist < 3.5) return true;
    const w = this.world, p = this.body.position;
    const want = Math.atan2(-(w.playerPos.x - p.x), -(w.playerPos.z - p.z));
    return Math.abs(angleDiff(want, this.yaw)) < 1.9;
  }

  // ── navigation ─────────────────────────────────────────────────────────
  /**
   * Chooses the point to walk toward (player, or next path node) into `this.waypoint`.
   * Replans at ≤ 2 Hz, string-pulls at 4 Hz. Returns false when there is nowhere to go.
   */
  protected navigate(dt: number, rayH = 0.35): boolean {
    const w = this.world, p = this.body.position, nav = w.nav;
    this.directTimer -= dt;
    if (this.directTimer <= 0) {
      this.directTimer = 0.25 + w.rand() * 0.05;
      // straight line when the player is visible, near, on our level and the floor-level ray is clear
      this.direct = nav.count === 0 ||
        (this.dist < 16 && Math.abs(w.playerPos.y - p.y) < 1.2 && this.seesPlayer && nav.walkable(p, w.playerPos, rayH));
    }
    if (this.direct) { this.waypoint.copy(w.playerPos); this.path.length = 0; return true; }
    this.replanTimer -= dt;
    if (this.replanTimer <= 0 || this.path.length === 0) {
      this.replanTimer = 0.6 + w.rand() * 0.4;
      const start = nav.nearestNode(p, true);
      const goal = nav.playerNode(w.time, w.playerPos);
      nav.findPath(start, goal, this.path);
      this.pathIdx = 0;
      // skip the first node if we are already past it toward the second
      if (this.path.length > 1) {
        const a = nav.nodePos(this.path[0]), b = nav.nodePos(this.path[1]);
        const abx = b.x - a.x, abz = b.z - a.z;
        if ((p.x - a.x) * abx + (p.z - a.z) * abz > 0 && nav.walkable(p, b, rayH)) this.pathIdx = 1;
      }
    }
    if (this.path.length === 0) { this.waypoint.copy(w.playerPos); return true; }
    this.pullTimer -= dt;
    if (this.pullTimer <= 0) {
      this.pullTimer = 0.25;
      // string-pull: skip ahead while the following node is directly walkable
      if (this.pathIdx < this.path.length - 1 && nav.walkable(p, nav.nodePos(this.path[this.pathIdx + 1]), rayH)) this.pathIdx++;
    }
    let node = nav.nodePos(this.path[this.pathIdx]);
    if (Math.hypot(node.x - p.x, node.z - p.z) < 0.55) {
      if (this.pathIdx < this.path.length - 1) { this.pathIdx++; node = nav.nodePos(this.path[this.pathIdx]); }
      else { this.waypoint.copy(w.playerPos); return true; }
    }
    this.waypoint.copy(node);
    return true;
  }

  /**
   * No-progress watchdog. Call every frame with whether the machine is trying to move.
   * Returns a lateral steering bias (-1..1) to apply while unsticking; may hop the body.
   */
  protected watchdog(dt: number, wantsMove: boolean, hop: number): number {
    const p = this.body.position;
    if (this.unstickTime > 0) this.unstickTime -= dt;
    if (!wantsMove) { this.stuckTimer = 0; this.lastProgress.copy(p); this.stuckCount = 0; return 0; }
    this.stuckTimer += dt;
    if (this.stuckTimer > 0.9) {
      const moved = Math.hypot(p.x - this.lastProgress.x, p.z - this.lastProgress.z);
      this.stuckTimer = 0;
      this.lastProgress.copy(p);
      if (moved < 0.3) {
        this.stuckCount++;
        this.replanTimer = 0; this.directTimer = 0.6; this.direct = false;
        this.unstickTime = 0.55;
        this.unstickDir = this.world.rand() < 0.5 ? -1 : 1;
        if (this.stuckCount >= 2 && this.body.onGround) this.body.velocity.y = hop;
        if (this.stuckCount >= 4 && this.path.length > 0) {
          // last resort: nudge onto the path node we are trying to reach
          const node = this.world.nav.nodePos(this.path[Math.min(this.pathIdx, this.path.length - 1)]);
          _n.copy(node).sub(p); _n.y = 0;
          const l = _n.length();
          if (l > 0.01 && l < 4) { p.addScaledVector(_n, Math.min(1, 0.6 / l)); p.y += 0.05; }
          this.stuckCount = 0;
        }
      } else {
        this.stuckCount = 0;
      }
    }
    return this.unstickTime > 0 ? this.unstickDir : 0;
  }

  /** Accelerate the horizontal velocity toward (dx,dz)*speed and run the capsule through physics. */
  protected moveGround(dt: number, dx: number, dz: number, speed: number, accel: number): void {
    const v = this.body.velocity;
    const tx = dx * speed, tz = dz * speed;
    const k = Math.min(1, accel * dt);
    v.x += (tx - v.x) * k; v.z += (tz - v.z) * k;
    this.world.ctx.physics.moveBody(this.body, dt);
    this.keepOffPlayer();
  }

  /** Never stand inside the player. */
  protected keepOffPlayer(): void {
    const w = this.world, p = this.body.position;
    if (Math.abs(w.playerPos.y - p.y) > 1.6) return;
    const dx = p.x - w.playerPos.x, dz = p.z - w.playerPos.z;
    const min = this.body.radius + 0.36;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 1e-6) {
      const d = Math.sqrt(d2), push = (min - d);
      p.x += (dx / d) * push; p.z += (dz / d) * push;
    }
  }

  protected faceToward(x: number, z: number, maxStep: number): number {
    const p = this.body.position;
    const want = Math.atan2(-(x - p.x), -(z - p.z));
    const d = angleDiff(want, this.yaw);
    const step = Math.sign(d) * Math.min(Math.abs(d), maxStep);
    this.yaw += step;
    return d - step;
  }

  /** Ground height under a point (raycast down), or null. */
  protected groundAt(x: number, y: number, z: number, maxDown = 3): number | null {
    _from.set(x, y, z); _to.set(0, -1, 0);
    const h = this.world.ctx.physics.raycast(_from, _to, maxDown);
    return h ? h.point.y : null;
  }
}
