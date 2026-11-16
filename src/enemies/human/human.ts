/**
 * TOMAS runtime (actor only — never an enemy). Fully procedural, layered animation:
 *   base pose (per named pose, with its own life: breathing, weight shifts, fidgets, struggle…)
 *   + walk (distance-driven gait, planted feet, leg IK) + blend between poses
 *   + look (eyes → head → torso, springs; idle glances when nobody tells him where to look)
 *   + attention (REVISION 6.1 "People react to you"): `auto` by default — he looks at the player whenever he can
 *     see them (≤ 16 m, through glass, not through walls / closed doors / the partition; rays at 10 Hz; the last
 *     seen position held 0.8 s), `pinned` (story point, or a live object), `rest`. Eyes → head → body: the body
 *     turns on the spot only in idle / talk (player > 55° off for 0.7 s); the story's facing is the REST facing
 *     he returns to 2 s after losing sight. Flinches and looks at a bullet impact he can see within 3 m.
 *   + speech (jaw syllables, nods, brows, small gestures) + blinks + secondary motion (badge, knotted sleeves).
 *
 * Poses: idle, wave, bang_glass, write, talk, sit, sit_floor, back_away, held, carried (see setPose / DESIGN).
 * Glass poses assume the pane is GLASS_Z in front of his position.
 */
import * as THREE from 'three';
import type { EnemyType } from '../../core/types';
import { EnemyBase, type EnemyWorld, type HitBurst } from '../ai';
import type { FactoryOpts } from '../manager';
import { hv, type HitVolume } from '../shared/hit';
import { angleDiff, armIK, damp, noise1, smooth, solveLimb, spring, type Spring } from '../shared/ik';
import type { Rig } from '../shared/rig';
import { HUMAN_DIM as K, type HumanTemplate } from './model';

export const HUMAN_POSES = ['idle', 'wave', 'bang_glass', 'write', 'talk', 'sit', 'sit_floor', 'back_away', 'held', 'carried', 'struggle'] as const;
type HPose = typeof HUMAN_POSES[number];
/**
 * Default distance (m) from his feet position to the glass pane for bang_glass / write. REVISION 5: the pose string
 * may carry the distance as a parameter — `'bang_glass:0.5'`, `'write:0.5'` (clamped 0.3 … 0.7).
 * Other parameters: `'held:file'` (single file: left wrist pulled forward by a 'lead' escort, right arm twisted behind
 * him by a 'push' escort). `'flinch'` is a one-shot overlay (ducks, arms up, recovers in ≈ 1.3 s) on whatever pose
 * he is in — it does not change the pose.
 */
export const GLASS_Z = 0.42;

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _t = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _upQ = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _fw = new THREE.Vector3(), _lf = new THREE.Vector3();
const FK_SAVE = ['uarm', 'larm', 'hand'] as const;
let warned = new Set<string>();

interface Fidget { kind: string; t: number; dur: number }

export class Human extends EnemyBase {
  readonly type = 'human' as unknown as EnemyType;
  private rig: Rig;
  private B: Record<string, THREE.Bone>;
  private pose: HPose = 'idle';
  private poseT = 0;
  private snap: Float32Array;
  private blendT = 1; private blendDur = 0.5;
  private seed: number;
  // walking
  private moving = false; private target = new THREE.Vector3(); private wantSpeed = 1.25; private curSpeed = 0;
  private done: (() => void) | null = null;
  private phase = 0; private walkW = 0; private travel = 1; private stuckT = 0; private lastD = 1e9; private groundT = 0;
  private turnW = 0;
  // look
  /** Effective look target this frame (set by attention(); null = rest behaviour). */
  private lookPt: THREE.Vector3 | null = null; private readonly lookBuf = new THREE.Vector3();
  // attention (REVISION 6.1)
  private attn: 'auto' | 'pinned' | 'rest' = 'auto';
  private pinObj: THREE.Object3D | null = null;
  private readonly pinPt = new THREE.Vector3();
  private seen = false; private sightT = 0; private lastSeenT = -1e9;
  private readonly lastSeen = new THREE.Vector3();
  /** True while the look target is the player (auto). */
  private onPlayer = false;
  /** Seconds the target has been > 55° off his facing (body turn after 0.7 s). */
  private offT = 0;
  /** The story's facing (or his last arrival / spawn facing): what the body returns to when nobody is seen. */
  private restYaw = 0;
  /** The pending yawGoal is an attention turn (slower, re-aimed while the player moves), not a story facing. */
  private attnTurn = false;
  private impactT = -1e9; private readonly impactPt = new THREE.Vector3();
  private offImpact: (() => void) | null = null;
  private readonly glance = new THREE.Vector3(); private glanceT = 0;
  private hY: Spring = { x: 0, v: 0 }; private hP: Spring = { x: 0, v: 0 }; private tY: Spring = { x: 0, v: 0 };
  private eY: Spring = { x: 0, v: 0 }; private eP: Spring = { x: 0, v: 0 };
  // face
  private blink = 0; private blinkT = 0; private nextBlink = 2; private eyesOpen = true;
  private speakT = 0; private speakDur = 0;
  // body life
  private shift: Spring = { x: 0, v: 0 }; private shiftTgt = 1; private shiftTimer = 4;
  private fidget: Fidget | null = null; private fidgetTimer = 6;
  private gest: Spring = { x: 0, v: 0 }; private gest2: Spring = { x: 0, v: 0 }; private gestTgt = 0; private gestTgt2 = 0; private gestTimer = 0;
  private jerk: Spring = { x: 0, v: 0 }; private jerkTimer = 1;
  private bangCount = 0; private lastBang = -1;
  private badgeS: Spring = { x: 0, v: 0 }; private sleeveS: Spring = { x: 0, v: 0 };
  private prevYaw = 0;
  private readonly markerTip = new THREE.Vector3();
  /** REVISION 5: glass distance for bang_glass / write (pose parameter). */
  private glassZ = GLASS_Z;
  /** REVISION 5: 'held:file' variant. */
  private heldFile = false;
  /** REVISION 5: flinch overlay time (−1 = none). */
  private flinchT = -1;
  private flinchK = 0;
  /** REVISION 5: the scanned head's closed lids (blink). */
  private scanLids: THREE.SkinnedMesh | null = null;
  /**
   * Facing set from outside: the story places him with `object.rotation.y = yaw` (its yaw convention — the same as
   * `this.yaw`: 0 faces −Z, +π/2 faces −X). We own `object.rotation.y` (= yaw + π) and rewrite it every frame, so a
   * foreign value is read as "face this way" before it is overwritten. `rotOut` is the last value we wrote.
   */
  private rotOut = NaN;
  /** Facing he turns to on the spot (≈ 0.4 s for a quarter turn); null = none. Walking cancels it. */
  private yawGoal: number | null = null;
  /** bang_glass / write: square up to the pane in front of him once he stands still. */
  private squarePending = false;
  /**
   * Distance (m) from his feet to the visible pane, measured by squareToGlass (NaN = not measured: the pose parameter
   * / GLASS_Z is used). Glass colliders are 10 cm slabs centred on the pane, so the pane is 5 cm past the hit face.
   */
  private glassFace = NaN;

  constructor(world: EnemyWorld, private tpl: HumanTemplate, group: string, position: THREE.Vector3, yaw: number, o: FactoryOpts) {
    super(world, group, position, yaw, 0.3, 1.75);
    this.isActor = true;
    this.awake = false;
    this.state = 'idle';
    this.seed = this.id * 3.17 + 0.5;
    this.rig = tpl.rig.instantiate();
    this.B = this.rig.byName;
    if (tpl.scan) this.attachScan(tpl.scan);
    this.lodRig = this.rig;
    this.object.add(this.rig.root);
    this.snap = this.rig.newPose();
    this.boundCenterY = 0.9; this.boundRadius = 1.2;
    // REVISION 5: hit volumes only for the actor shot test (he is never an enemy; R2 says he must be behind glass)
    const B = this.B;
    this.volumes = [
      hv(B.head, [0, 0.05, 0.005], [0, 0.13, 0.005], 0.1, 'head'),
      hv(B.spine2, [0, -0.1, 0.01], [0, 0.2, 0], 0.16, 'torso'),
      hv(B.hips, [0, -0.06, 0], [0, 0.1, 0], 0.16, 'torso'),
      hv(B.thigh_l, [0, 0, 0], [0, -0.42, 0], 0.08, 'limb'), hv(B.thigh_r, [0, 0, 0], [0, -0.42, 0], 0.08, 'limb'),
      hv(B.shin_l, [0, 0, 0], [0, -0.4, 0], 0.06, 'limb'), hv(B.shin_r, [0, 0, 0], [0, -0.4, 0], 0.06, 'limb'),
      hv(B.uarm_l, [0, 0, 0], [0, -0.28, 0], 0.05, 'limb'), hv(B.uarm_r, [0, 0, 0], [0, -0.28, 0], 0.05, 'limb'),
      hv(B.larm_l, [0, 0, 0], [0, -0.26, 0], 0.045, 'limb'), hv(B.larm_r, [0, 0, 0], [0, -0.26, 0], 0.045, 'limb'),
    ];
    this.body.gravityScale = 0;
    this.nextBlink = 1 + world.rand() * 3;
    this.glanceT = world.rand() * 2;
    this.prevYaw = yaw;
    this.restYaw = yaw;
    try { this.offImpact = world.ctx.events.on('bullet:impact', (e) => this.onImpact(e.point)); } catch { this.offImpact = null; }
    this.setPoseNow(this.poseName(o.pose));
    this.blendT = 1;
    this.tick(0.016);
  }

  private poseName(p: string | undefined): HPose {
    if (!p || p === 'standing') return 'idle';
    const ci = p.indexOf(':');
    if (ci > 0) {
      const name = p.slice(0, ci), arg = p.slice(ci + 1);
      if (name === 'bang_glass' || name === 'write') {
        const z = parseFloat(arg);
        if (Number.isFinite(z)) this.glassZ = THREE.MathUtils.clamp(z, 0.3, 0.7);
        return name;
      }
      if (name === 'held') { this.heldFile = arg === 'file'; return 'held'; }
      p = name;
    } else if (p === 'bang_glass' || p === 'write') this.glassZ = GLASS_Z;
    else if (p === 'held') this.heldFile = false;
    if ((HUMAN_POSES as readonly string[]).includes(p)) return p as HPose;
    if (!warned.has(p)) { warned.add(p); console.warn(`[enemies] human: unknown pose "${p}" → idle`); }
    return 'idle';
  }

  private setPoseNow(p: HPose): void {
    if ((p === 'bang_glass' || p === 'write') && p !== this.pose) { this.squarePending = true; this.glassFace = NaN; }
    this.pose = p; this.poseT = 0;
    this.fidget = null; this.fidgetTimer = 4 + this.world.rand() * 6;
    this.bangCount = 0;
  }

  // ───────────────────────────────────────────── EnemyBase plumbing (actor only)
  protected enterAlert(): void { /* never */ }
  applyDamage(_v: HitVolume, _a: number, _p: THREE.Vector3, _d: THREE.Vector3): void { /* never */ }
  protected hitFx(_b: HitBurst): void { /* never */ }

  override puppetMove(point: THREE.Vector3, speed: number | undefined, done: () => void): void {
    if (this.done) this.arrive();
    this.target.copy(point);
    const def = this.pose === 'back_away' ? 0.6 : this.pose === 'held' ? 1.0 : 1.25;
    this.wantSpeed = THREE.MathUtils.clamp(speed ?? def, 0.2, 3.2);
    this.moving = true; this.done = done; this.stuckT = 0; this.lastD = 1e9;
    this.yawGoal = null; this.attnTurn = false; this.glassFace = NaN;
    // walking poses: sitting / writing / banging get up into a stand first
    if (this.pose === 'sit' || this.pose === 'sit_floor' || this.pose === 'bang_glass' || this.pose === 'write' || this.pose === 'wave') this.puppetPose('idle');
  }
  override puppetPose(pose: string): void {
    if (pose === 'flinch') { this.flinchT = 0; this.blinkSoon(); return; }
    const n = this.poseName(pose);
    if (n === this.pose) return;
    this.rig.capture(this.snap);
    this.blendT = 0;
    this.blendDur = n === 'carried' || this.pose === 'carried' ? 0.9 : n === 'sit' || n === 'sit_floor' || this.pose === 'sit' || this.pose === 'sit_floor' ? 0.85 : 0.45;
    this.setPoseNow(n);
  }
  /**
   * REVISION 6.1: a point pins a frozen copy; null returns to `auto`. The player's own eye vector (what the story
   * passes to mean "look at the player") is `auto` — pinning a frozen copy of it would stare at where they were.
   */
  override puppetLook(point: THREE.Vector3 | null): void {
    this.pinObj = null;
    if (!point || point === this.world.ctx.player?.eye) { this.attn = 'auto'; return; }
    this.pinPt.copy(point); this.attn = 'pinned';
  }
  /** REVISION 6.1: pin a live object (its world position, every frame). */
  puppetLookObject(o: THREE.Object3D): void { this.pinObj = o; this.attn = 'pinned'; }
  override puppetLookMode(mode: 'auto' | 'rest'): void { this.pinObj = null; this.attn = mode === 'rest' ? 'rest' : 'auto'; }
  override puppetEyes(on: boolean): void { this.eyesOpen = on; }
  override puppetStop(): void { if (this.done) this.arrive(); this.moving = false; }
  override puppetSpeak(seconds: number): void { this.speakT = Math.max(this.speakT, seconds); this.speakDur = this.speakT; }
  override puppetGait(_g: string): void { /* his walk is his walk */ }

  private arrive(): void {
    this.moving = false;
    this.restYaw = this.yaw; // where he stopped is where he rests (until the story says otherwise)
    const d = this.done; this.done = null;
    if (d) d();
  }

  /** REVISION 5: bind the scanned head to this skeleton; hide the procedural face + hair. */
  private attachScan(sc: NonNullable<HumanTemplate['scan']>): void {
    const add = (g: THREE.BufferGeometry, m: THREE.Material, order = 0) => {
      const mesh = new THREE.SkinnedMesh(g, m);
      mesh.bind(this.rig.skeleton, new THREE.Matrix4());
      mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = order;
      mesh.userData.key = 'scan';
      this.rig.root.add(mesh);
      return mesh;
    };
    add(sc.mouth, sc.mouthMat);
    add(sc.eyes, sc.eyeMat);
    add(sc.lashes, sc.lashMat);
    add(sc.face, sc.faceMat);
    this.scanLids = add(sc.lids, sc.faceMat);
    this.scanLids.visible = false;
    add(sc.hair, sc.hairMat);
    add(sc.collar, sc.shirtMat);
    this.rig.setKeysVisible(['face', 'hair', 'eye'], false);
  }

  override dispose(): void {
    if (this.offImpact) { this.offImpact(); this.offImpact = null; }
    this.rig.skeleton.dispose();
    super.dispose();
  }

  // ───────────────────────────────────────────── update

  update(dt: number): void { this.tick(dt); }

  private tick(dt: number): void {
    const w = this.world, p = this.body.position;
    this.stateTime += dt; this.poseT += dt;
    this.adoptFacing();
    this.locomotion(dt);
    this.turnToGoal(dt);
    // timers
    this.shiftTimer -= dt;
    if (this.shiftTimer <= 0) { this.shiftTgt = -Math.sign(this.shiftTgt || 1) * (0.6 + w.rand() * 0.4); this.shiftTimer = (this.pose === 'talk' ? 3 : 6) + w.rand() * 6; }
    spring(this.shift, this.shiftTgt, 0.32, 0.85, dt);
    this.gestTimer -= dt;
    if (this.gestTimer <= 0) { this.gestTgt = w.rand(); this.gestTgt2 = w.rand() * 2 - 1; this.gestTimer = 0.6 + w.rand() * 1.1; }
    spring(this.gest, this.gestTgt, 0.9, 0.8, dt); spring(this.gest2, this.gestTgt2, 0.7, 0.8, dt);
    this.jerkTimer -= dt;
    if (this.jerkTimer <= 0) { this.jerkTimer = 0.5 + w.rand() * 1.6; this.jerk.v += (w.rand() - 0.5) * 14; }
    spring(this.jerk, 0, 1.6, 0.35, dt);
    this.tickBlink(dt);
    if (this.flinchT >= 0) {
      this.flinchT += dt;
      const u = this.flinchT;
      this.flinchK = u < 0.12 ? smooth(u / 0.12) : u < 0.55 ? 1 : 1 - smooth((u - 0.55) / 0.75);
      if (u > 1.3) { this.flinchT = -1; this.flinchK = 0; }
    }
    // base pose
    this.rig.reset();
    if (this.tpl.scan) {
      const { eyeOffL: l, eyeOffR: r } = this.tpl.scan, B = this.B;
      B.eye_l.position.add(l); B.lid_l.position.add(l); B.eye_r.position.add(r); B.lid_r.position.add(r);
    }
    this.B.marker.scale.setScalar(this.pose === 'write' ? 1 : 1e-4);
    this.basePose(dt);
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
      this.rig.blendTo(this.snap, 1 - smooth(this.blendT));
    }
    // overlays
    this.syncWorld();
    this.attention(dt);
    this.look(dt);
    this.speech(dt);
    this.secondary(dt);
    this.face();
    this.syncWorld();
    void p;
  }

  private syncWorld(): void {
    this.object.position.copy(this.body.position);
    this.object.rotation.y = this.rotOut = this.yaw + Math.PI;
    this.object.updateMatrixWorld(true);
  }

  // ───────────────────────────────────────────── facing

  /** A facing written into `object.rotation.y` by the story (see `rotOut`): turn to it (lying / sitting: at once). */
  private adoptFacing(): void {
    const r = this.object.rotation.y;
    if (!Number.isFinite(this.rotOut) || r === this.rotOut) return; // (exact: it holds the very number we wrote)
    this.object.rotation.y = this.rotOut;
    this.restYaw = r; this.attnTurn = false; this.offT = 0;
    if (this.pose === 'carried' || this.pose === 'sit' || this.pose === 'sit_floor') { this.yaw = this.prevYaw = r; this.yawGoal = null; }
    else this.yawGoal = r;
    if (this.pose === 'bang_glass' || this.pose === 'write') this.squarePending = true;
  }

  /**
   * bang_glass / write: whatever yaw he was given, his palms go flat on the pane — so he squares up to it. Rays at
   * chest height fan out ±70° round the facing he is turning to; the nearest glass within 1.2 m sets the facing
   * (straight into the pane, along its normal). No glass in reach: the facing stays as given.
   */
  private squareToGlass(): void {
    const ph = this.world.ctx.physics, p = this.body.position;
    const base = this.yawGoal ?? this.yaw;
    _v.set(p.x, p.y + 1.3, p.z);
    let best: { d: number; nx: number; nz: number } | null = null;
    for (let k = -7; k <= 7; k++) {
      const a = base + k * 0.1745;
      _v2.set(-Math.sin(a), 0, -Math.cos(a));
      let h: ReturnType<typeof ph.raycast> = null;
      try { h = ph.raycast(_v, _v2, 1.2); } catch { h = null; }
      if (!h || h.surface !== 'glass') continue;
      const nl = Math.hypot(h.normal.x, h.normal.z);
      if (nl < 0.7) continue;
      // distance to the pane's plane (not along the slanted ray)
      const nx = h.normal.x / nl, nz = h.normal.z / nl;
      const d = (p.x - h.point.x) * nx + (p.z - h.point.z) * nz;
      if (d > 0 && (!best || d < best.d)) best = { d, nx, nz };
    }
    if (best) { this.yawGoal = this.restYaw = Math.atan2(best.nx, best.nz); this.attnTurn = false; this.glassFace = best.d + 0.05; }
  }

  /**
   * Where the pose puts its hands (m in front of his feet): measured pane minus what the hand/fingers reach past the
   * IK point (≈ 4 cm), so palms and the marker tip touch the glass and never go through it.
   */
  private gz(): number {
    return Number.isFinite(this.glassFace) ? THREE.MathUtils.clamp(this.glassFace - 0.038, 0.3, 0.7) : this.glassZ;
  }

  /** Standing still with a facing to reach: turn on the spot. */
  private turnToGoal(dt: number): void {
    if (this.moving) return;
    if (this.squarePending && (this.pose === 'bang_glass' || this.pose === 'write')) { this.squarePending = false; this.squareToGlass(); }
    if (this.yawGoal === null) return;
    const rem = angleDiff(this.yawGoal, this.yaw);
    // story facings: a quick quarter turn (≈ 0.4 s); attention turns: unhurried, eased into the last 0.4 rad
    const rate = this.attnTurn ? 2.4 * Math.min(1, 0.35 + Math.abs(rem) / 0.4) : 4.0;
    const step = Math.sign(rem) * Math.min(Math.abs(rem), rate * dt);
    this.yaw += step;
    if (Math.abs(rem - step) < 1e-3) { this.yawGoal = null; this.attnTurn = false; }
  }

  // ───────────────────────────────────────────── locomotion

  private locomotion(dt: number): void {
    const w = this.world, p = this.body.position;
    let want = 0;
    if (this.moving) {
      const dx = this.target.x - p.x, dz = this.target.z - p.z, d = Math.hypot(dx, dz);
      this.stuckT += dt;
      if (this.stuckT > 1.5) { if (this.lastD - d < 0.06) this.arrive(); this.stuckT = 0; this.lastD = d; }
      if (this.moving && d < 0.1) this.arrive();
      if (this.moving) {
        if (this.pose !== 'carried') {
          const travelYaw = Math.atan2(-dx, -dz);
          const face = this.pose === 'back_away' ? travelYaw + Math.PI : travelYaw;
          const rem = angleDiff(face, this.yaw);
          const step = Math.sign(rem) * Math.min(Math.abs(rem), (this.curSpeed < 0.3 ? 2.4 : 3.6) * dt);
          this.yaw += step;
          const al = Math.max(0, Math.cos(rem - step));
          want = this.wantSpeed * al * al;
        } else want = this.wantSpeed;
        want = Math.min(want, d * 2.5 + 0.15);
        this.curSpeed = damp(this.curSpeed, want, this.pose === 'carried' ? 8 : 4.5, dt);
        const k = Math.min(d, this.curSpeed * dt) / (d || 1);
        p.x += dx * k; p.z += dz * k;
      }
    }
    if (!this.moving) this.curSpeed = damp(this.curSpeed, 0, 6, dt);
    this.travel = this.pose === 'back_away' ? -1 : 1;
    if (this.pose !== 'carried' && this.curSpeed > 0.05) {
      this.groundT -= dt;
      if (this.groundT <= 0) { this.groundT = 0.2; const g = this.groundAt(p.x, p.y + 0.6, p.z, 1.6); if (g !== null) p.y = g; }
    }
    const walks = this.pose === 'idle' || this.pose === 'talk' || this.pose === 'back_away' || this.pose === 'held' || this.pose === 'struggle';
    this.walkW = damp(this.walkW, walks && this.curSpeed > 0.08 ? 1 : 0, 6, dt);
    const stepLen = 0.3 + 0.24 * Math.min(this.curSpeed, 1.8);
    let adv = this.curSpeed * dt / (2 * stepLen);
    if (this.pose === 'held') adv *= 0.8 + 0.5 * Math.max(0, noise1(w.time * 1.7, this.seed + 4));
    // turning on the spot: little shuffle steps
    const dyaw = Math.abs(angleDiff(this.yaw, this.prevYaw));
    this.prevYaw = this.yaw;
    this.turnW = damp(this.turnW, walks && this.curSpeed < 0.1 && dyaw > dt * 0.3 ? 1 : 0, 6, dt);
    adv += this.turnW * dt * 0.9;
    this.phase += adv * this.travel;
  }

  /** Foot (ankle-ground point) in rig space for the gait, given the foot's phase offset. */
  private gaitFoot(side: number, out: THREE.Vector3): { pitch: number; swing: number } {
    const ps = this.phase + (side > 0 ? 0 : 0.5);
    const psi = ps - Math.floor(ps);
    const stepLen = 0.3 + 0.24 * Math.min(this.curSpeed, 1.8);
    const half = stepLen * 0.62 * (1 - this.turnW * 0.85) * Math.min(1, this.curSpeed / 0.4 + this.turnW);
    const STANCE = 0.62;
    let z: number, y = 0, pitch = 0, swing = 0;
    const lift = this.pose === 'held' ? 0.025 : 0.055 + 0.02 * Math.min(1, this.curSpeed);
    if (psi < STANCE) {
      const u = psi / STANCE;
      z = half - 2 * half * u;
      // heel strike → flat → heel off
      pitch = -0.22 * (1 - smooth(u / 0.18)) + 0.38 * smooth((u - 0.72) / 0.28);
    } else {
      const u = (psi - STANCE) / (1 - STANCE);
      swing = Math.sin(Math.PI * u);
      z = -half + 2 * half * smooth(u);
      y = swing * lift + (u < 0.3 ? 0.02 * smooth(u / 0.3) : 0);
      pitch = 0.4 * (1 - smooth(u / 0.45)) - 0.25 * smooth((u - 0.6) / 0.4);
    }
    out.set(side * (K.hipX + 0.012), y, z * this.travel + 0.01);
    return { pitch, swing };
  }

  // ───────────────────────────────────────────── base poses

  private rotE(b: THREE.Bone, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ'): void { b.quaternion.setFromEuler(_e.set(x, y, z, order)); }
  private mulE(b: THREE.Bone, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ'): void { b.quaternion.multiply(_q.setFromEuler(_e.set(x, y, z, order))); }
  /** FK arm: pitch (− forward), twist, out (+ away from the body), elbow flex. */
  private arm(side: number, pitch: number, twist: number, out: number, elbow: number): void {
    const s = side > 0 ? 'l' : 'r';
    this.rotE(this.B['uarm_' + s], pitch, twist * side, out * side);
    this.rotE(this.B['larm_' + s], -Math.max(0.02, elbow), 0, 0);
  }
  private fingers(side: number, curl: number, thumb = curl * 0.6): void {
    const s = side > 0 ? 'l' : 'r', B = this.B;
    B['fing_' + s].quaternion.setFromAxisAngle(Z, -side * curl);
    B['fing2_' + s].quaternion.setFromAxisAngle(Z, -side * curl * 1.15);
    this.rotE(B['thumb_' + s], -thumb * 0.5, 0, -side * thumb * 0.6);
  }

  private basePose(dt: number): void {
    const B = this.B, t = this.world.time, sd = this.seed;
    const breathRate = this.pose === 'back_away' || this.pose === 'held' ? 0.75 : this.pose === 'bang_glass' ? 0.6 : this.pose === 'sit' || this.pose === 'sit_floor' || this.pose === 'carried' ? 0.22 : 0.3;
    const br = Math.sin(t * Math.PI * 2 * breathRate + sd);
    const sh = this.shift.x;
    const tremble = this.pose === 'back_away' || this.pose === 'held' || this.pose === 'struggle' ? 1 : 0;
    const tr = (k: number) => noise1(t * 21 + k, sd + k) * 0.012 * tremble;
    this.idleTorso(br, sh);
    // standing feet (rig space) + gait mix
    let fl = new THREE.Vector3(0.106, 0, 0.035), fr = new THREE.Vector3(-0.1, 0, -0.03);
    let ylL = 0.14, ylR = -0.14;
    let hipsY = 0.938 - Math.abs(sh) * 0.008 - this.flinchK * 0.13;
    switch (this.pose) {
      case 'idle': case 'talk': case 'wave': case 'back_away': case 'held': case 'bang_glass': case 'write': case 'struggle': {
        if (this.pose === 'bang_glass' || this.pose === 'write') { fl.set(0.11, 0, 0.06); fr.set(-0.11, 0, 0.0); }
        if (this.pose === 'back_away') { fl.set(0.11, 0, -0.1); fr.set(-0.1, 0, 0.06); hipsY -= 0.012; }
        if (this.pose === 'held') { fl.set(0.13, 0, 0.08); fr.set(-0.12, 0, -0.02); hipsY -= 0.02 + Math.max(0, this.jerk.x) * 0.04; }
        if (this.pose === 'struggle') {
          // planted wide, digging in; every few seconds a heel kicks out / a knee comes up
          fl.set(0.15, 0, 0.1); fr.set(-0.14, 0, -0.06);
          const ct = (this.poseT + this.seed) % 3.1, kick = ct > 2.2 ? Math.sin(Math.PI * (ct - 2.2) / 0.9) : 0;
          const side = Math.floor((this.poseT + this.seed) / 3.1) % 2 === 0;
          const f = side ? fl : fr;
          f.y += 0.22 * kick; f.z += 0.18 * kick;
          hipsY -= 0.05 + Math.abs(this.struggleX()) * 0.05 + 0.03 * kick;
          B.hips.position.z -= 0.05 * Math.max(0, this.struggleX());
        }
        const W = Math.max(this.walkW, this.turnW);
        if (W > 0.001) {
          const a = this.gaitFoot(1, _v), b = this.gaitFoot(-1, _v2);
          fl.lerp(_v, W); fr.lerp(_v2, W);
          const ph = this.phase * Math.PI * 2;
          hipsY += (-0.011 * Math.cos(2 * ph) - 0.006) * this.walkW;
          B.hips.position.x += 0.016 * Math.sin(ph) * this.walkW;
          this.mulE(B.hips, 0.03 * this.walkW, -0.11 * Math.cos(ph) * this.walkW * this.travel, 0.035 * Math.sin(ph) * this.walkW);
          this.mulE(B.spine2, 0.02 * this.walkW, 0.15 * Math.cos(ph) * this.walkW * this.travel, -0.02 * Math.sin(ph) * this.walkW);
          this.legs(fl, fr, hipsY, a.pitch * W, b.pitch * W, ylL * (1 - W), ylR * (1 - W));
          if (this.pose === 'idle' || this.pose === 'talk') {
            // arm swing (opposite legs)
            const sw = 0.3 * Math.min(1.2, this.curSpeed / 1.2) * this.walkW * this.travel;
            this.arm(1, 0.05 + sw * Math.cos(ph), 0, 0.09, 0.22 + 0.25 * Math.max(0, -Math.cos(ph)) * this.walkW);
            if (this.pose === 'idle') this.arm(-1, 0.05 - sw * Math.cos(ph), 0, 0.09, 0.22 + 0.25 * Math.max(0, Math.cos(ph)) * this.walkW);
          }
        } else this.legs(fl, fr, hipsY, 0, 0, ylL, ylR);
        break;
      }
      default: break;
    }
    switch (this.pose) {
      case 'idle': this.poseIdle(dt, br); break;
      case 'talk': this.poseTalk(dt, br); break;
      case 'wave': this.poseWave(t); break;
      case 'bang_glass': this.poseBang(t); break;
      case 'write': this.poseWrite(t); break;
      case 'back_away': this.poseBackAway(t, tr); break;
      case 'held': this.poseHeld(t, tr); break;
      case 'struggle': this.poseStruggle(t, tr); break;
      case 'sit': this.poseSit(t, br, false); break;
      case 'sit_floor': this.poseSit(t, br, true); break;
      case 'carried': this.poseCarried(t, br); break;
    }
    if (this.pose !== 'carried' && this.pose !== 'sit' && this.pose !== 'sit_floor') this.flinchOverlay();
    void dt;
  }

  /** Spine/neck/shoulders of an upright, breathing, weight-shifting young man (poses add on top). */
  private idleTorso(br: number, sh: number): void {
    const B = this.B;
    B.hips.position.set(sh * 0.026, 0.938, 0);
    this.rotE(B.hips, 0.035, sh * 0.04, -sh * 0.045);
    this.rotE(B.spine1, 0.02 + br * 0.006, -sh * 0.025, sh * 0.035, 'YXZ');
    this.rotE(B.spine2, 0.035 + br * 0.016, 0, sh * 0.025, 'YXZ');
    this.rotE(B.neck, 0.08, 0, -sh * 0.02, 'YXZ');
    this.rotE(B.head, 0.02, 0, -sh * 0.015, 'YXZ');
    this.rotE(B.clav_l, 0, 0, br * 0.012 + 0.02);
    this.rotE(B.clav_r, 0, 0, -br * 0.012 - 0.02);
    this.arm(1, 0.06, 0, 0.09, 0.2);
    this.arm(-1, 0.06, 0, 0.09, 0.22);
    this.rotE(B.hand_l, 0.05, 0, -0.08); this.rotE(B.hand_r, 0.05, 0, 0.08);
    this.fingers(1, 0.4); this.fingers(-1, 0.45);
  }

  /** Leg IK in rig space: feet = ankle-ground points; hips height set here. */
  private legs(fl: THREE.Vector3, fr: THREE.Vector3, hipsY: number, pL: number, pR: number, yL: number, yR: number, up = 0): void {
    const B = this.B;
    B.hips.position.y = hipsY;
    const hipsQ = B.hips.quaternion;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1, s = i === 0 ? 'l' : 'r', f = i === 0 ? fl : fr;
      const pitch = i === 0 ? pL : pR, yw = i === 0 ? yL : yR;
      _v3.set(side * K.hipX, K.hipY - K.hipsY, 0).applyQuaternion(hipsQ).add(B.hips.position);
      _t.set(f.x, f.y + K.ankle + Math.abs(Math.sin(pitch)) * 0.035, f.z);
      _s.set(side * (0.06 + up * 0.25) + Math.sin(yw) * 0.5, up * 2, 1).normalize();
      const bend = solveLimb(_v3, _t, _s, hipsQ, K.thigh, K.shin, B['thigh_' + s], 1, _upQ);
      B['shin_' + s].quaternion.setFromAxisAngle(X, bend);
      _q.copy(_upQ).multiply(B['shin_' + s].quaternion).invert();
      _q2.setFromEuler(_e.set(pitch, yw, 0, 'YXZ'));
      B['foot_' + s].quaternion.copy(_q).multiply(_q2);
    }
  }

  private poseIdle(dt: number, br: number): void {
    const w = this.world, B = this.B, t = w.time;
    // small life in the hanging arms
    this.mulE(B.uarm_l, noise1(t * 0.31, this.seed + 1) * 0.04, 0, noise1(t * 0.27, this.seed + 2) * 0.03);
    this.mulE(B.uarm_r, noise1(t * 0.29, this.seed + 3) * 0.04, 0, -noise1(t * 0.33, this.seed + 4) * 0.03);
    void br;
    // fidgets
    if (this.walkW > 0.3) { this.fidget = null; return; }
    if (!this.fidget) {
      this.fidgetTimer -= dt;
      if (this.fidgetTimer <= 0) {
        const r = w.rand();
        const kind = r < 0.3 ? 'neck' : r < 0.5 ? 'hair' : r < 0.75 ? 'cross' : 'face';
        this.fidget = { kind, t: 0, dur: kind === 'cross' ? 5 + w.rand() * 3 : kind === 'neck' ? 3 : kind === 'hair' ? 1.9 : 2.4 };
      }
      return;
    }
    const f = this.fidget;
    f.t += dt;
    if (f.t >= f.dur) { this.fidget = null; this.fidgetTimer = 6 + w.rand() * 9; return; }
    const k = smooth(f.t / 0.45) * (1 - smooth((f.t - (f.dur - 0.55)) / 0.55));
    this.syncWorld();
    if (f.kind === 'neck') {
      const rub = Math.sin(f.t * 7) * 0.02;
      this.headPoint(-0.045 + rub, 1.56, -0.06, _v);
      this.ikArm(-1, _v, 0.2, -0.3, 0.9, k);
      this.mulE(B.neck, 0.15 * k, 0, 0.08 * k); this.mulE(B.head, 0.1 * k, -0.1 * k, 0);
      this.fingers(-1, 0.6 * k + 0.45 * (1 - k));
    } else if (f.kind === 'hair') {
      const u = f.t / f.dur;
      this.headPoint(-0.04, 1.72 + 0.02 * Math.sin(u * Math.PI), 0.06 - 0.12 * smooth(u), _v);
      this.ikArm(-1, _v, 0.6, -0.2, 0.4, k);
      this.mulE(B.head, -0.08 * k, 0, -0.05 * k);
      this.fingers(-1, 0.5);
    } else if (f.kind === 'cross') {
      this.rigPoint(-0.14, 1.27, 0.1, _v); this.ikArm(1, _v, -0.2, -0.8, 0.0, k);
      this.rigPoint(0.15, 1.25, 0.075, _v); this.ikArm(-1, _v, -0.4, -0.8, 0.0, k);
      this.fingers(1, 0.7 * k + 0.4); this.fingers(-1, 0.8 * k + 0.4);
      this.mulE(B.spine2, -0.03 * k, 0, 0);
    } else {
      const rub = Math.sin(f.t * 5.5) * 0.015 * k;
      this.headPoint(0.028, 1.63 + rub, 0.13, _v); this.ikArm(1, _v, -0.6, -0.4, 0.0, k, true);
      this.headPoint(-0.028, 1.63 - rub, 0.13, _v); this.ikArm(-1, _v, -0.6, -0.4, 0.0, k, true);
      this.mulE(B.neck, 0.18 * k, 0, 0); this.mulE(B.head, 0.12 * k, 0, 0);
      this.mulE(B.spine2, 0.08 * k, 0, 0);
    }
  }

  private poseTalk(dt: number, br: number): void {
    const B = this.B, t = this.world.time;
    void dt; void br;
    // left hand presses the headset cup to his ear
    this.syncWorld();
    this.headPoint(0.115, 1.585, 0.0, _v);
    this.ikArm(1, _v, -0.5, -0.1, 0.8, 1, false, true);
    this.fingers(1, 0.25);
    this.mulE(B.neck, 0, 0, 0.06); this.mulE(B.head, 0.04, 0, 0.07);
    // right hand talks
    const g = this.gest.x, g2 = this.gest2.x;
    this.arm(-1, -0.25 - 0.3 * g, 0.2 * g2, 0.2 + 0.1 * g, 1.15 + 0.45 * g);
    this.rotE(B.hand_r, -0.2, -0.9 * g, 0.1 * g2);
    this.fingers(-1, 0.25 - 0.15 * g);
    this.mulE(B.spine2, 0, -0.06 * g2, 0, 'YXZ');
    void t;
  }

  private poseWave(t: number): void {
    const B = this.B, ph = t * Math.PI * 2 * 1.7;
    const both = Math.max(0, noise1(t * 0.35, this.seed + 9)) > 0.25;
    this.arm(-1, 0.2, -0.35, 2.45 + 0.22 * Math.sin(ph), 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(ph + 1.1)));
    this.rotE(B.hand_r, 0, 1.1, 0.15 * Math.sin(ph + 0.6));
    this.fingers(-1, 0.06, 0.05);
    if (both) {
      this.arm(1, 0.2, -0.35, 2.3 - 0.2 * Math.sin(ph + 0.4), 0.45 + 0.3 * (0.5 + 0.5 * Math.sin(ph + 1.5)));
      this.rotE(B.hand_l, 0, 1.1, -0.15 * Math.sin(ph + 1));
      this.fingers(1, 0.06, 0.05);
    }
    this.mulE(B.spine1, 0, 0, 0.05, 'YXZ'); this.mulE(B.spine2, -0.04, 0, 0.07 + 0.02 * Math.sin(ph), 'YXZ');
    this.mulE(B.head, -0.08, 0, -0.06);
    B.hips.position.y += 0.006 * Math.sin(ph * 2);
  }

  private poseBang(t: number): void {
    const B = this.B, w = this.world;
    // bursts of three blows, then a gasp
    const BEAT = 0.4, BURST = 3, GAP = 0.95, cyc = BEAT * BURST + GAP;
    const ct = (this.poseT + this.seed) % cyc;
    let pull = 0, lean = 0;
    const n = Math.floor(ct / BEAT);
    if (n < BURST) {
      const u = (ct % BEAT) / BEAT;
      pull = u < 0.62 ? smooth(u / 0.62) : 1 - smooth((u - 0.62) / 0.1);
      lean = u > 0.62 ? 1 - smooth((u - 0.72) / 0.28) : 0;
      const key = Math.floor((this.poseT + this.seed) / cyc) * 10 + n;
      if (u > 0.72 && this.lastBang !== key) {
        this.lastBang = key;
        this.rigPoint(0, 1.43, this.gz(), _v);
        try { w.ctx.audio.play('glass_bang', { position: _v, volume: 0.9 }); } catch { /* optional */ }
      }
    } else { pull = 0.25 * smooth((ct - BEAT * BURST) / 0.3); }
    this.mulE(B.spine1, 0.06 + 0.06 * lean, 0, 0, 'YXZ'); this.mulE(B.spine2, 0.05 + 0.08 * lean - 0.03 * pull, 0, 0, 'YXZ');
    B.hips.position.z += 0.025 * lean;
    this.mulE(B.head, 0.08 + 0.1 * lean, noise1(t * 1.3, this.seed) * 0.15, 0);
    this.syncWorld();
    for (const side of [1, -1]) {
      const lag = side > 0 ? 0 : 0.06;
      const pz = this.gz() - 0.015 - 0.045 * lean - 0.15 * Math.max(0, pull - lag); // (the lean carries the hands on)
      this.rigPoint(side * 0.2, 1.42 + 0.06 * pull, pz, _v);
      this.ikArm(side, _v, -0.65, -0.3, 0.55, 1);
      this.palmTo(side, _fw.set(0, 0.95, 0.3), _lf.set(0, 0, 1));
      this.fingers(side, 0.08 + 0.25 * pull, 0.1);
    }
  }

  private poseWrite(t: number): void {
    const B = this.B;
    // a word left to right (his view), pen lifts between letters, then he steps back to check it
    const WORD = 2.8, LOOK = 1.3, cyc = WORD + LOOK, ct = (this.poseT + 0.4) % cyc;
    let x: number, y: number, back = 0;
    if (ct < WORD) {
      const u = ct / WORD, letter = Math.floor(u * 5), lu = (u * 5) % 1;
      x = 0.13 - 0.26 * u;
      y = 1.62 + 0.03 * Math.sin(lu * Math.PI * 2 * 1.5 + letter) - 0.012 * letter;
      if (lu > 0.86) back = smooth((lu - 0.86) / 0.07) * (1 - smooth((lu - 0.93) / 0.07));
    } else {
      const u = (ct - WORD) / LOOK;
      back = smooth(u / 0.2) * (1 - smooth((u - 0.75) / 0.25));
      x = -0.13 + 0.26 * smooth((u - 0.6) / 0.4); y = 1.62;
    }
    this.mulE(B.spine2, 0.03, -0.06, 0, 'YXZ');
    this.mulE(B.head, 0.05 + 0.08 * back, -0.1 * x, 0.08);
    this.syncWorld();
    // the marker tip touches the pane; the wrist sits behind / above it
    this.rigPoint(x, y, this.gz() - 0.005 - 0.04 * back, this.markerTip);
    this.rigPoint(x - 0.006, y + 0.05, this.gz() - 0.11 - 0.04 * back, _v);
    this.ikArm(-1, _v, -0.55, -0.35, 0.6, 1);
    this.palmTo(-1, _fw.set(0, -0.55, 0.55), _lf.set(1, 0, 0.15));
    this.fingers(-1, 1.35, 1.1);
    // left hand flat on the glass, leaning on it
    this.rigPoint(0.26, 1.47, this.gz() - 0.015, _v);
    this.ikArm(1, _v, -0.6, -0.25, 0.6, 1);
    this.palmTo(1, _fw.set(0.1, 0.95, 0.25), _lf.set(0, 0, 1));
    this.fingers(1, 0.1, 0.1);
    void t;
  }

  private poseBackAway(t: number, tr: (k: number) => number): void {
    const B = this.B;
    this.mulE(B.spine1, -0.06, 0, 0, 'YXZ'); this.mulE(B.spine2, -0.05 + tr(1), tr(2), 0, 'YXZ');
    this.mulE(B.neck, -0.06, 0, 0); this.mulE(B.head, -0.08 + tr(3), tr(4) * 2, 0);
    for (const side of [1, -1]) {
      this.arm(side, -0.7 + tr(5 + side), 0.1, 0.25, 1.45 + tr(7 + side) * 2);
      this.rotE(side > 0 ? B.hand_l : B.hand_r, -0.6, -side * 0.5, 0);
      this.fingers(side, 0.12, 0.1);
    }
    void t;
  }

  private poseHeld(t: number, tr: (k: number) => number): void {
    const B = this.B, j = this.jerk.x, sd = this.seed;
    if (this.heldFile) {
      // single file: the one in front has his left wrist, the one behind twists his right arm up his back
      this.mulE(B.spine1, 0.1 + Math.abs(j) * 0.08, -0.12, 0.04, 'YXZ');
      this.mulE(B.spine2, 0.08, -0.1 + j * 0.15, 0, 'YXZ');
      this.mulE(B.neck, 0.1, noise1(t * 0.5, sd + 3) * 0.4, 0, 'YXZ');
      this.arm(1, -0.95 + tr(1) + j * 0.1, -0.2, 0.15, 0.12);
      this.rotE(B.hand_l, -0.2, 0, -0.3);
      this.fingers(1, 0.5, 0.4);
      this.arm(-1, 0.55 + tr(2), 0.6, 0.18, 1.45);
      this.rotE(B.hand_r, 0.3, 0.5, 0.2);
      this.fingers(-1, 0.9 + 0.2 * Math.abs(j), 0.6);
      return;
    }
    const tw = noise1(t * 0.55, sd + 1) * 0.3 + j * 0.25;
    this.mulE(B.spine1, 0.05 + Math.abs(j) * 0.1, tw * 0.5, noise1(t * 0.7, sd + 2) * 0.1, 'YXZ');
    this.mulE(B.spine2, 0.06, tw * 0.6, 0, 'YXZ');
    this.mulE(B.neck, 0.05, noise1(t * 0.4, sd + 3) * 0.5, 0, 'YXZ');
    for (const side of [1, -1]) {
      const pull = noise1(t * 0.9 + side, sd + 5) * 0.12 + (side > 0 ? j : -j) * 0.12;
      this.arm(side, -0.2 + tr(side), -0.55 + pull, 1.15 - pull * 0.4, 0.35 + Math.abs(pull));
      this.rotE(side > 0 ? B.hand_l : B.hand_r, 0.2, 0, -side * 0.35);
      this.fingers(side, 0.85 + 0.3 * Math.abs(j), 0.6);
    }
  }

  /** −1 … 1: which way he is wrenching (struggle). */
  private struggleX(): number {
    const t = this.world.time, sd = this.seed;
    return Math.sin(t * 2.3 + sd) * 0.6 + noise1(t * 1.7, sd + 40) * 0.6 + this.jerk.x * 0.5;
  }

  /** REVISION 5: held at the loading arch, fighting it — wrenching side to side, pulling back, head thrown about. */
  private poseStruggle(t: number, tr: (k: number) => number): void {
    const B = this.B, sd = this.seed, x = this.struggleX();
    const pull = Math.max(0, noise1(t * 1.1, sd + 41));
    this.mulE(B.hips, -0.05 * pull, x * 0.25, x * 0.05);
    this.mulE(B.spine1, 0.12 - 0.15 * pull, x * 0.35, -x * 0.12, 'YXZ');
    this.mulE(B.spine2, 0.1 - 0.12 * pull, x * 0.45, -x * 0.1, 'YXZ');
    this.mulE(B.neck, 0.1 + noise1(t * 2.9, sd + 42) * 0.25, noise1(t * 2.1, sd + 43) * 0.6 - x * 0.3, 0, 'YXZ');
    this.mulE(B.head, -0.15 * pull + noise1(t * 3.3, sd + 44) * 0.2, 0, noise1(t * 2.5, sd + 45) * 0.2, 'YXZ');
    for (const side of [1, -1]) {
      const yank = Math.max(0, side * x) * 0.5 + pull * 0.2;
      this.arm(side, -0.15 + yank * 0.6 + tr(side), -0.6, 1.1 - yank * 0.5, 0.3 + yank * 0.8);
      this.rotE(side > 0 ? B.hand_l : B.hand_r, 0.3, 0, -side * 0.4);
      this.fingers(side, 1.0, 0.7);
    }
  }

  /** REVISION 5: flinch overlay — ducks (hips dropped in basePose), turns the face away, forearms up over the head. */
  private flinchOverlay(): void {
    const k = this.flinchK;
    if (k <= 0.001) return;
    const B = this.B;
    this.mulE(B.spine1, 0.22 * k, 0, 0, 'YXZ'); this.mulE(B.spine2, 0.25 * k, 0.15 * k, 0, 'YXZ');
    this.mulE(B.neck, 0.35 * k, 0.3 * k, 0, 'YXZ'); this.mulE(B.head, 0.2 * k, 0.35 * k, 0.1 * k, 'YXZ');
    this.syncWorld();
    this.headPoint(0.06, 1.74, 0.16, _v); this.ikArm(1, _v, -0.1, -0.2, 0.5, k);
    this.headPoint(-0.05, 1.7, 0.2, _v); this.ikArm(-1, _v, -0.2, -0.2, 0.5, k);
    this.fingers(1, 0.7 * k + 0.2); this.fingers(-1, 0.75 * k + 0.2);
  }

  /** World grip points for the escorts' hands: 'wrist_l' | 'wrist_r' | 'uarm_l' | 'uarm_r' | 'back'. */
  gripPoint(part: string, out: THREE.Vector3): THREE.Vector3 {
    const B = this.B;
    if (part === 'wrist_l' || part === 'wrist_r') return out.setFromMatrixPosition(B['hand_' + part.slice(-1)].matrixWorld);
    if (part === 'uarm_l' || part === 'uarm_r') {
      const s = part.slice(-1);
      out.setFromMatrixPosition(B['uarm_' + s].matrixWorld);
      return out.lerp(_v3.setFromMatrixPosition(B['larm_' + s].matrixWorld), 0.6);
    }
    // between the shoulder blades
    out.set(0, 0.18, -0.13).applyMatrix4(B.spine2.matrixWorld);
    return out;
  }

  private poseSit(t: number, br: number, floor: boolean): void {
    const B = this.B, w = this.world, sd = this.seed;
    const sigh = Math.max(0, noise1(t * 0.12, sd + 7));
    const lift = smooth((this.lookPt ? 0.6 : 0) + (this.speakT > 0 ? 0.6 : 0) + Math.max(0, noise1(t * 0.18, sd + 8) - 0.3));
    if (!floor) {
      B.hips.position.set(0, 0.5, -0.05);
      this.rotE(B.hips, -0.1, 0, 0);
      this.rotE(B.spine1, 0.26 + br * 0.01 + sigh * 0.05, 0, 0, 'YXZ');
      this.rotE(B.spine2, 0.2 + br * 0.02, 0, 0, 'YXZ');
      this.rotE(B.neck, 0.3 - 0.25 * lift, 0, 0, 'YXZ'); this.rotE(B.head, 0.25 - 0.3 * lift, 0, 0, 'YXZ');
      this.legsSeat(new THREE.Vector3(0.13, 0, 0.43), new THREE.Vector3(-0.12, 0, 0.4));
    } else {
      B.hips.position.set(0, 0.12, 0.0);
      this.rotE(B.hips, -0.55, 0, 0);
      this.rotE(B.spine1, 0.22 + br * 0.01, 0, 0, 'YXZ');
      this.rotE(B.spine2, 0.22 + br * 0.02 + sigh * 0.05, 0, 0, 'YXZ');
      this.rotE(B.neck, 0.35 - 0.3 * lift, 0, 0, 'YXZ'); this.rotE(B.head, 0.2 - 0.25 * lift, 0, 0.05, 'YXZ');
      this.legsSeat(new THREE.Vector3(0.14, 0, 0.36), new THREE.Vector3(-0.12, 0, 0.33), 1);
    }
    this.syncWorld();
    // forearms on the thighs / knees, hands hanging loose between them
    const y = floor ? 0.5 : 0.47, z = floor ? 0.3 : 0.37;
    this.rigPoint(0.05, y, z, _v); this.ikArm(1, _v, -0.8, -0.2, 0.3, 1);
    this.rigPoint(-0.05, y + 0.01, z + 0.01, _v); this.ikArm(-1, _v, -0.8, -0.2, 0.3, 1);
    this.rotE(B.hand_l, 0.4, 0, -0.3); this.rotE(B.hand_r, 0.4, 0, 0.3);
    this.fingers(1, 0.6); this.fingers(-1, 0.55);
    // now and then: rubs his face
    this.fidgetTimer -= 1 / 60;
    if (!this.fidget && this.fidgetTimer <= 0) this.fidget = { kind: 'face', t: 0, dur: 2.6 };
    if (this.fidget) {
      const f = this.fidget;
      f.t += 1 / 60;
      if (f.t >= f.dur) { this.fidget = null; this.fidgetTimer = 9 + w.rand() * 10; return; }
      const k = smooth(f.t / 0.5) * (1 - smooth((f.t - (f.dur - 0.6)) / 0.6));
      this.mulE(B.neck, 0.15 * k, 0, 0); this.mulE(B.head, 0.1 * k, 0, 0);
      this.syncWorld();
      const rub = Math.sin(f.t * 5) * 0.015 * k;
      this.headPoint(0.03, 1.63 + rub, 0.13, _v); this.ikArm(1, _v, -0.7, -0.3, 0.0, k, true);
      this.headPoint(-0.03, 1.63 - rub, 0.13, _v); this.ikArm(-1, _v, -0.7, -0.3, 0.0, k, true);
    }
  }

  /** Seated legs: hips are placed already; feet planted on the floor in rig space. */
  private legsSeat(fl: THREE.Vector3, fr: THREE.Vector3, up = 0): void {
    const y = this.B.hips.position.y;
    this.legs(fl, fr, y, -0.05 - up * 0.3, -0.05 - up * 0.3, 0.2, -0.2, up);
  }

  private poseCarried(t: number, br: number): void {
    const B = this.B, sd = this.seed;
    B.hips.position.set(0, 0.13, 0);
    this.rotE(B.hips, -Math.PI / 2 + 0.05, 0, noise1(t * 0.3, sd) * 0.04);
    this.rotE(B.spine1, -0.03 + br * 0.01, 0, 0, 'YXZ');
    this.rotE(B.spine2, 0.04 + br * 0.03, 0, 0, 'YXZ');
    const lift = smooth(Math.max(0, noise1(t * 0.22, sd + 2) - 0.2) * 2);
    this.rotE(B.neck, 0.12 + 0.35 * lift, noise1(t * 0.17, sd + 3) * 0.5 * (1 - lift), 0, 'YXZ');
    this.rotE(B.head, 0.05 + 0.15 * lift, noise1(t * 0.21, sd + 4) * 0.4, 0, 'YXZ');
    const reach = smooth(Math.max(0, noise1(t * 0.25, sd + 5) - 0.35) * 2.5);
    this.arm(1, 0.1, 0, 0.42, 0.35);
    this.arm(-1, 0.1 - 1.1 * reach, 0.2 * reach, 0.35 + 0.2 * reach, 0.35 + 0.5 * reach);
    this.rotE(B.hand_l, 0, 0, -0.2); this.rotE(B.hand_r, 0, 0, 0.2);
    this.fingers(1, 0.55); this.fingers(-1, 0.5 - 0.35 * reach);
    for (const side of [1, -1]) {
      const s = side > 0 ? 'l' : 'r';
      this.rotE(B['thigh_' + s], -0.08 - (side > 0 ? 0.25 : 0.05), 0, 0.1 * side);
      this.rotE(B['shin_' + s], side > 0 ? 0.5 : 0.12, 0, 0);
      this.rotE(B['foot_' + s], 0.55, side * 0.2, 0);
    }
  }

  // ───────────────────────────────────────────── IK helpers

  /** Rig-space point → world. */
  private rigPoint(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.body.position, ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    return out.set(p.x + x * c + z * s, p.y + y, p.z - x * s + z * c);
  }
  /** Model-space point on the head (bind coordinates) → world, following the head bone. */
  private headPoint(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const h = this.B.head;
    return out.set(x, y - 1.556, z + 0.006).applyMatrix4(h.matrixWorld);
  }

  /**
   * World-space arm IK toward `T` (wrist), elbow hint in rig axes (out, down, back), blended with the current FK
   * by `k`. `face`: palm toward the face (fingers up); `head`: palm toward the head side (headset).
   */
  private ikArm(side: number, T: THREE.Vector3, down: number, back: number, out: number, k: number, face = false, head = false): void {
    if (k <= 0.001) return;
    const B = this.B, s = side > 0 ? 'l' : 'r';
    const uarm = B['uarm_' + s], larm = B['larm_' + s], hand = B['hand_' + s];
    const save = FK_SAVE.map((n) => B[n + '_' + s].quaternion.clone());
    this.object.updateMatrixWorld(true);
    const ry = this.yaw + Math.PI, c = Math.cos(ry), sn = Math.sin(ry);
    _fw.set(sn, 0, c); _lf.set(c, 0, -sn);
    _s.setFromMatrixPosition(uarm.matrixWorld);
    _q2.setFromRotationMatrix(uarm.parent!.matrixWorld);
    _v3.copy(_lf).multiplyScalar(side * (0.35 + out)).addScaledVector(Y, down).addScaledVector(_fw, back);
    const bend = armIK(_s, T, _v3, K.uarm, K.larm, _q2, uarm);
    larm.quaternion.setFromAxisAngle(X, -bend);
    if (face || head) {
      uarm.updateMatrixWorld(true);
      if (face) this.palmTo(side, _v.set(0, 1, 0.2), _v2.set(0, 0, -1));
      else this.palmTo(side, _v.set(0, 1, -0.2), _v2.set(-1, 0, 0));
    }
    if (k < 0.999) {
      for (let i = 0; i < 3; i++) { const b = B[FK_SAVE[i] + '_' + s]; _q3.copy(b.quaternion); b.quaternion.copy(save[i]).slerp(_q3, k); }
    }
    void hand;
  }

  /**
   * Orient a hand in world terms: `fingers` direction and `palm` normal given in RIG axes (x his left, y up, z front).
   * Requires the arm's world matrices to be current (call right after ikArm).
   */
  private palmTo(side: number, fingers: THREE.Vector3, palm: THREE.Vector3): void {
    const B = this.B, s = side > 0 ? 'l' : 'r';
    const larm = B['larm_' + s], hand = B['hand_' + s];
    B['uarm_' + s].updateMatrixWorld(true);
    const ry = this.yaw + Math.PI;
    _q.setFromAxisAngle(Y, ry);
    const yAx = _v3.copy(fingers).normalize().negate().applyQuaternion(_q);
    const xAx = _t.copy(palm).normalize().multiplyScalar(-side).applyQuaternion(_q);
    xAx.addScaledVector(yAx, -xAx.dot(yAx)).normalize();
    const zAx = _s.copy(xAx).cross(yAx);
    _m.makeBasis(xAx, yAx, zAx);
    _q2.setFromRotationMatrix(_m);
    _q3.setFromRotationMatrix(larm.matrixWorld).invert();
    hand.quaternion.copy(_q3).multiply(_q2);
  }

  // ───────────────────────────────────────────── attention (REVISION 6.1)

  /** A clear line from a to b, seeing through glass (re-cast past each pane, at most 3 panes). */
  private sightRay(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const ph = this.world.ctx.physics;
    _t.copy(a);
    for (let k = 0; k < 4; k++) {
      _s.copy(b).sub(_t);
      const len = _s.length();
      if (len < 0.06) return true;
      _s.multiplyScalar(1 / len);
      let h: ReturnType<typeof ph.raycast> = null;
      try { h = ph.raycast(_t, _s, len - 0.05); } catch { return false; }
      if (!h) return true;
      if (h.surface !== 'glass' || k === 3) return false;
      _t.copy(h.point).addScaledVector(_s, 0.12); // through the pane (panes are ≤ 10 cm slabs)
    }
    return false;
  }

  private canSeePlayer(eye: THREE.Vector3): boolean {
    const w = this.world, pl = w.ctx.player;
    if (!pl || !pl.alive) return false;
    const d = eye.distanceTo(w.playerEye);
    if (d > 16) return false;
    // he has to be facing roughly that way to notice someone (or hear them close by); once he has them he keeps them
    if (this.world.time - this.lastSeenT > 0.8 && d > 2.5) {
      const want = Math.atan2(-(w.playerEye.x - eye.x), -(w.playerEye.z - eye.z));
      if (Math.abs(angleDiff(want, this.yaw)) > 2.1) return false;
    }
    return this.sightRay(eye, w.playerEye);
  }

  /** A round lands near him: flinch and look at it — only if he can see where it hit (within 3 m). */
  private onImpact(point: THREE.Vector3): void {
    if (!this.object.parent) return;
    _v3.setFromMatrixPosition(this.B.neck.matrixWorld);
    const p = this.body.position;
    const dHead = _v3.distanceTo(point), dBody = Math.hypot(point.x - p.x, point.z - p.z);
    if (Math.min(dHead, dBody) > 3) return;
    if (!this.sightRay(_v3.clone(), point)) return;
    if (this.flinchT < 0 || this.flinchT > 0.6) { this.flinchT = 0; }
    this.blinkSoon();
    this.impactT = this.world.time;
    this.impactPt.copy(point);
  }

  /** Who he looks at this frame: an impact he just saw, the story's pin, the player he can see, or nothing (rest). */
  private attention(dt: number): void {
    const w = this.world, t = w.time;
    _v.setFromMatrixPosition(this.B.neck.matrixWorld);
    this.sightT -= dt;
    if (this.attn !== 'auto') this.seen = false;
    else if (this.sightT <= 0) {
      this.sightT = 0.1; // ≤ 10 Hz
      this.seen = this.canSeePlayer(_v);
    }
    if (this.seen) { this.lastSeen.copy(w.playerEye); this.lastSeenT = t; }
    this.onPlayer = false;
    if (t - this.impactT < 1.2) this.lookPt = this.lookBuf.copy(this.impactPt);
    else if (this.attn === 'pinned') this.lookPt = this.pinObj ? this.pinObj.getWorldPosition(this.lookBuf) : this.lookBuf.copy(this.pinPt);
    else if (this.attn === 'auto' && t - this.lastSeenT <= 0.8) { this.lookPt = this.lookBuf.copy(this.lastSeen); this.onPlayer = true; }
    else this.lookPt = null;
    // the body: on the spot, only standing free (idle / talk)
    const bodyFree = !this.moving && (this.pose === 'idle' || this.pose === 'talk');
    if (!bodyFree) { this.offT = 0; if (this.attnTurn) { this.yawGoal = null; this.attnTurn = false; } return; }
    const storyTurning = this.yawGoal !== null && !this.attnTurn;
    if (this.lookPt && t - this.impactT >= 1.2 && !storyTurning) {
      const p = this.body.position;
      const want = Math.atan2(-(this.lookPt.x - p.x), -(this.lookPt.z - p.z));
      const off = angleDiff(want, this.yaw);
      if (this.attnTurn) { this.yawGoal = want; this.offT = 0; }
      else if (Math.abs(off) > 0.96) { this.offT += dt; if (this.offT >= 0.7) { this.yawGoal = want; this.attnTurn = true; this.offT = 0; } }
      else this.offT = 0;
    } else if (!this.lookPt && !storyTurning) {
      this.offT = 0;
      // 2 s without anyone to look at: back to the facing the story gave him
      if (t - this.lastSeenT > 2.0 && t - this.impactT > 2.0 && Math.abs(angleDiff(this.restYaw, this.yaw)) > 0.05) {
        if (!this.attnTurn || this.yawGoal !== this.restYaw) { this.yawGoal = this.restYaw; this.attnTurn = true; }
      } else if (this.attnTurn && this.yawGoal !== this.restYaw) { this.yawGoal = null; this.attnTurn = false; }
    }
  }

  // ───────────────────────────────────────────── overlays

  private look(dt: number): void {
    const w = this.world, B = this.B, t = w.time;
    // where to look: the story's target, or the task at hand, or nervous glances
    let tgt: THREE.Vector3;
    let tracking = !!this.lookPt;
    // carried / lying: only what is within ±40° of where his face points; walking: the player only within ±50° of the path
    if (this.lookPt && (this.pose === 'carried' || (this.onPlayer && this.walkW > 0.3))) {
      _v.setFromMatrixPosition(B.neck.matrixWorld);
      _q.setFromRotationMatrix(B.spine2.matrixWorld).invert();
      _v2.copy(this.lookPt).sub(_v).applyQuaternion(_q);
      const ya = Math.atan2(_v2.x, _v2.z), pa = Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z));
      const lim = this.pose === 'carried' ? 0.7 : 0.87;
      if (Math.abs(ya) > lim || (this.pose === 'carried' && Math.abs(pa) > lim)) tracking = false;
    }
    if (tracking && this.lookPt) tgt = this.lookPt;
    else if (this.pose === 'write') tgt = this.markerTip;
    else {
      this.glanceT -= dt;
      if (this.glanceT <= 0) {
        const busy = this.pose === 'bang_glass' || this.pose === 'held' || this.pose === 'struggle';
        this.glanceT = (busy ? 0.5 : 1.2) + w.rand() * (busy ? 1.2 : 3);
        const yawR = (w.rand() - 0.5) * (busy ? 1.6 : 1.1), pit = (w.rand() - 0.5) * 0.12 + (this.pose === 'sit' || this.pose === 'sit_floor' ? -0.3 : 0);
        this.rigPoint(Math.sin(yawR) * 4, 1.6 + Math.sin(pit) * 4, Math.cos(yawR) * 4, this.glance);
        if (this.pose === 'carried') this.rigPoint(Math.sin(yawR) * 2, 4, 0.5, this.glance);
      }
      tgt = this.glance;
      // walking: eyes on the way ahead
      if (this.walkW > 0.3) tgt = this.rigPoint(noise1(t * 0.3, this.seed + 30) * 1.2, 1.55, 5 * this.travel, this.glance);
    }
    const wt = this.pose === 'carried' ? 0.5 : this.pose === 'sit' || this.pose === 'sit_floor' ? 0.7 : 1;
    _v.setFromMatrixPosition(B.neck.matrixWorld);
    _q.setFromRotationMatrix(B.spine2.matrixWorld).invert();
    _v2.copy(tgt).sub(_v).applyQuaternion(_q);
    const yaw = Math.atan2(_v2.x, _v2.z), pitch = -Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z));
    const behind = Math.abs(yaw) > 2.4;
    const hl = this.pose === 'carried' ? 0.6 : 1.15;
    const hyW = behind ? 0 : THREE.MathUtils.clamp(yaw * 0.85, -hl, hl), hpW = THREE.MathUtils.clamp(pitch * 0.75, -0.55, 0.6);
    spring(this.hY, hyW * wt, 1.5, 0.78, dt); spring(this.hP, hpW * wt, 1.5, 0.8, dt);
    const tyW = !behind && Math.abs(yaw) > 0.9 ? THREE.MathUtils.clamp((yaw - Math.sign(yaw) * 0.9) * 0.7, -0.5, 0.5) : 0;
    spring(this.tY, tyW * wt, 0.6, 0.9, dt);
    // (the body turn is attention()'s: idle / talk only)
    this.mulE(B.spine1, 0, this.tY.x * 0.4, 0, 'YXZ'); this.mulE(B.spine2, 0, this.tY.x * 0.6, 0, 'YXZ');
    B.neck.quaternion.premultiply(_q.setFromEuler(_e.set(this.hP.x * 0.35, this.hY.x * 0.35, 0, 'YXZ')));
    B.head.quaternion.premultiply(_q.setFromEuler(_e.set(this.hP.x * 0.65, this.hY.x * 0.65, -this.hY.x * 0.06, 'YXZ')));
    // eyes: whatever the head has not covered, quickly
    const eyW = THREE.MathUtils.clamp((yaw - this.hY.x - this.tY.x) * (behind ? 0 : 1), -0.55, 0.55);
    const epW = THREE.MathUtils.clamp(pitch - this.hP.x, -0.4, 0.4);
    spring(this.eY, eyW, 5.5, 0.95, dt); spring(this.eP, epW, 5.5, 0.95, dt);
    if (Math.abs(this.eY.v) > 3) this.blinkSoon();
  }

  private blinkSoon(): void { if (this.blinkT <= 0 && this.nextBlink > 0.25) this.nextBlink = Math.min(this.nextBlink, 0.05 + this.world.rand() * 0.1); }

  private tickBlink(dt: number): void {
    const w = this.world;
    if (this.blinkT > 0) {
      this.blinkT -= dt;
      const u = 1 - this.blinkT / 0.15;
      this.blink = u < 0.33 ? smooth(u / 0.33) : u < 0.5 ? 1 : 1 - smooth((u - 0.5) / 0.5);
      if (this.blinkT <= 0) this.blink = 0;
    } else {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) {
        this.blinkT = 0.15;
        const nervous = this.pose === 'back_away' || this.pose === 'held' || this.pose === 'struggle' || this.speakT > 0;
        this.nextBlink = w.rand() < 0.18 ? 0.22 : (nervous ? 1.2 : 2.2) + w.rand() * (nervous ? 2 : 3.5);
      }
    }
  }

  private speech(dt: number): void {
    const B = this.B, t = this.world.time, sd = this.seed;
    let jaw = this.pose === 'struggle' ? 0.09 : this.pose === 'carried' || this.pose === 'held' || this.pose === 'bang_glass' ? 0.05 : 0.012;
    // the scanned head keeps its lips closed at rest (they only part while he speaks / fights for breath)
    if (this.tpl.scan) jaw = this.pose === 'struggle' ? 0.05 : 0;
    if (this.speakT > 0) {
      this.speakT -= dt;
      const fade = smooth(this.speakT / 0.15) * smooth((this.speakDur - this.speakT) / 0.1);
      const syl = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 4.4 + 2.2 * noise1(t * 1.4, sd));
      const word = smooth(0.5 + noise1(t * 2.3, sd + 1) * 1.2);
      const env = Math.pow(syl, 1.4) * word * fade;
      const emph = Math.max(0, noise1(t * 1.1, sd + 2)) * fade;
      jaw += this.tpl.scan ? 0.01 + env * 0.13 + emph * 0.03 : 0.03 + env * 0.2 + emph * 0.04;
      B.head.quaternion.multiply(_q.setFromEuler(_e.set(-emph * 0.07 + env * 0.025, noise1(t * 0.8, sd + 3) * 0.06 * fade, noise1(t * 0.6, sd + 4) * 0.05 * fade, 'YXZ')));
      B.brow_l.position.y += emph * 0.0035; B.brow_r.position.y += emph * 0.0035;
      // small hand gestures when the hands are free
      if (this.pose === 'idle' && !this.fidget && this.walkW < 0.3) {
        const g = Math.max(0, this.gest.x - 0.3) * fade;
        this.mulE(B.uarm_r, -0.35 * g, 0, 0.05 * g); this.mulE(B.larm_r, -0.7 * g, 0, 0); this.mulE(B.hand_r, 0, -0.8 * g, 0);
        const g2 = Math.max(0, this.gest2.x - 0.2) * fade;
        this.mulE(B.uarm_l, -0.25 * g2, 0, 0); this.mulE(B.larm_l, -0.5 * g2, 0, 0);
        this.fingers(-1, 0.45 - 0.35 * g); this.fingers(1, 0.4 - 0.3 * g2);
      }
    }
    B.jaw.quaternion.setFromAxisAngle(X, jaw);
  }

  private face(): void {
    const B = this.B, t = this.world.time, sd = this.seed;
    // worry lives in his brows: inner ends up, a little furrow; fear widens the eyes
    const fear = this.flinchK > 0.3 || this.pose === 'back_away' || this.pose === 'held' || this.pose === 'struggle' || this.pose === 'bang_glass' ? 1 : this.pose === 'carried' ? 0.6 : 0.35;
    B.brow_l.position.y += 0.0015 * fear + noise1(t * 0.5, sd + 11) * 0.0008;
    B.brow_r.position.y += 0.0015 * fear + noise1(t * 0.5, sd + 12) * 0.0008;
    B.brow_l.quaternion.setFromAxisAngle(Z, -0.12 * fear); B.brow_r.quaternion.setFromAxisAngle(Z, 0.12 * fear);
    const closed = this.eyesOpen ? this.blink : 1;
    if (this.scanLids) {
      // scan: the procedural lid caps are folded away (scaled into the eyeball); a blink shows the scan's own lids
      this.scanLids.visible = closed > 0.3;
      B.lid_l.scale.setScalar(1e-4); B.lid_r.scale.setScalar(1e-4);
    }
    for (const s of ['l', 'r']) {
      B['eye_' + s].quaternion.setFromEuler(_e.set(this.eP.x, this.eY.x, 0, 'YXZ'));
      const open = -0.08 * fear - (this.tpl.scan ? 0.45 : 0);
      B['lid_' + s].quaternion.setFromAxisAngle(X, open + Math.max(0, this.eP.x) * 0.6 + closed * (1.25 - open));
    }
  }

  private secondary(dt: number): void {
    const B = this.B;
    // the badge hangs plumb (mostly) and swings with the walk; the knotted sleeves likewise from the hips
    _q.copy(B.hips.quaternion).multiply(B.spine1.quaternion).multiply(B.spine2.quaternion).invert();
    spring(this.badgeS, Math.sin(this.phase * Math.PI * 4) * 0.12 * this.walkW + this.jerk.x * 0.1, 1.6, 0.25, dt);
    const plumb = this.pose === 'carried' ? 0.25 : 0.8;
    B.badge.quaternion.identity().slerp(_q, plumb).multiply(_q2.setFromEuler(_e.set(this.badgeS.x, 0, this.badgeS.x * 0.4)));
    _q.copy(B.hips.quaternion).invert();
    spring(this.sleeveS, Math.sin(this.phase * Math.PI * 2) * 0.2 * this.walkW, 1.2, 0.3, dt);
    const sp = this.pose === 'carried' || this.pose === 'sit_floor' ? 0.1 : this.pose === 'sit' ? 0.5 : 0.75;
    for (const s of ['l', 'r']) {
      const b = B['sleeve_' + s];
      b.quaternion.identity().slerp(_q, sp).multiply(_q2.setFromEuler(_e.set(this.sleeveS.x * (s === 'l' ? 1 : -1), 0, 0)));
    }
  }
}
