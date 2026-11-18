/**
 * Stage 3d §5.6 (W3b): the dock loader's BEHAVIOUR — the moon pool's autonomous gantry crane as the level-6 boss.
 *
 * Rail-bound (no nav): a bridge on wall rails (z), a trolley on the bridge (x), a hoist (rope length) and a grab that
 * swings as a damped pendulum under the trolley. Everything the arena means comes from `Level.dock` (slots, `target`,
 * no-slam box, rails, park); every number from LOADER_TUNING (tuning.ts). The body is a `LoaderRig` (stubrig.ts: the
 * interface W3a's rig implements; `StubLoaderRig` until it lands).
 *
 * Modes: working (B-14 over the well; `cue('lower')`; a slow patrol) → wake → hunt (choose) · slam (track → lock → drop
 * → recover → rise) · shift (goto → clamp → lift → carry → lower → release → rise) · drop (goto → clamp → lift → carry →
 * strobe → release) · swing (wind → sweep) · guard (parked high while he is unreachable; also the restore grace) ·
 * dying → dead. Stage = max(objective stage, damage stage) (§5.6.5).
 *
 * Damage model (§5.6.5): floods 40 (×1), rams 200 (×1 extended / ×0 retracted), pod 500 (×0 cowl shut / ×1 open once
 * both rams are gone), body ×0.05. A ×0 hit = `armour_clank` (≤ 1 per 0.3 s), sparks, `enemy:damaged` with amount 0 and
 * the part (the UI shakes the pip). The loader never damages an enemy; ≤ 40 to the player in any 2 s.
 */
import * as THREE from 'three';
import type { BossState, CargoHandle, CargoSlot, DockArena, LightHandle } from '../../core/types';
import { EnemyBase, type EnemyWorld, type HitBurst } from '../ai';
import type { FactoryOpts } from '../manager';
import type { HitVolume } from '../shared/hit';
import { LOADER_TUNING as T } from './tuning';
import type { LoaderPart, LoaderPose, LoaderRig } from './stubrig';

export const LOADER_PARTS: readonly LoaderPart[] = ['flood_1', 'flood_2', 'flood_3', 'flood_4', 'ram_e', 'ram_w', 'pod'];
const PART_HP: Record<LoaderPart, number> = { flood_1: T.hp.flood, flood_2: T.hp.flood, flood_3: T.hp.flood, flood_4: T.hp.flood, ram_e: T.hp.ram, ram_w: T.hp.ram, pod: T.hp.pod };

type Mode = 'working' | 'hunt' | 'slam' | 'shift' | 'drop' | 'swing' | 'guard' | 'dying' | 'dead' | 'puppet';
type AttackKind = 'slam' | 'shift' | 'drop' | 'swing';

/** One logged event (check-loader reads `debug.loader().log`). */
export interface LoaderLogEntry { t: number; kind: string; [k: string]: unknown }

const RAISED_TOP = -6.4;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/** One crane axis with inertia: accelerate, coast, brake to the goal (crane-like, never instant). */
class Axis {
  v = 0;
  constructor(public x: number) {}
  drive(goal: number, vmax: number, dt: number, accel: number = T.speed.accel, brake: number = T.speed.brake): number {
    const d = goal - this.x, s = Math.sign(d);
    const stop = (this.v * this.v) / (2 * brake);
    let want = Math.abs(d) < 1e-3 ? 0 : s * vmax;
    if (Math.abs(d) <= stop + 0.02 && Math.sign(this.v) === s) want = s * Math.sqrt(Math.max(0, 2 * brake * Math.abs(d)));
    const a = Math.abs(want) > Math.abs(this.v) && Math.sign(want) === Math.sign(this.v || want) ? accel : brake;
    const dv = clamp(want - this.v, -a * dt, a * dt);
    const v0 = this.v;
    this.v += dv;
    this.x += (v0 + this.v) * 0.5 * dt;
    if (Math.abs(goal - this.x) < 0.01 && Math.abs(this.v) < 0.05) { this.x = goal; this.v = 0; }
    return (this.v - v0) / Math.max(dt, 1e-4);
  }
  snap(x: number): void { this.x = x; this.v = 0; }
}

export class Loader extends EnemyBase {
  readonly type = 'loader' as const;
  readonly rig: LoaderRig;
  private dock: DockArena | null;
  private rails: { xMin: number; xMax: number; zMin: number; zMax: number; railY: number };
  private well: THREE.Vector3;
  // ── kinematics
  private bz: Axis; private tx: Axis;
  /** Grab top (world y) and its hoist rate. */
  private top = RAISED_TOP;
  private sway = { x: 0, vx: 0, z: 0, vz: 0 };
  private jaws = 0; private jawsGoal = 0;
  private rams = 0; private ramsGoal = 0;
  private cowl = 0;
  private ringK = 0;
  private readonly pose: LoaderPose;
  private readonly floodDir: THREE.Vector3[] = [0, 1, 2, 3].map(() => new THREE.Vector3(0, -1, 0));
  private readonly floodAim: THREE.Vector3[] = [0, 1, 2, 3].map(() => new THREE.Vector3());
  // ── state
  mode: Mode = 'working';
  private phase = '';
  private phaseT = 0;
  private hp: Record<LoaderPart, number> = { ...PART_HP };
  private objStage = 0;
  private dmgStage = 0;
  private emittedStage = 0;
  private woke = false;
  private graceUntil = -1;
  private unreachT = 0;
  private reach = false;
  private reachT = 0;
  private sees = false;
  private seeT = 0;
  private cd: Record<AttackKind, number> = { slam: 1.5, shift: T.shift.period, drop: 4, swing: 2 };
  private shiftClock = 0;
  // ── slam
  private ring = new THREE.Vector3();
  private ringState: 'off' | 'track' | 'lock' = 'off';
  private lockP = new THREE.Vector3();
  private deckY = -20;
  private waitTries = 0;
  private impactAt = -1;
  // ── cargo
  private carried: CargoHandle | null = null;
  private carriedId: string | null = null;
  private b14: THREE.Object3D | null = null;
  private srcSlot: CargoSlot | null = null;
  private dstSlot: CargoSlot | null = null;
  private outlineOnAt = -1;
  private fallCheckAt = -1;
  private shoveT = 0;
  private lowerT = -1;
  // ── swing
  private laneA = new THREE.Vector3(); private laneB = new THREE.Vector3();
  private swingHit = false;
  // ── fx / visuals
  private grabBox: import('../../core/types').DynamicBox | null = null;
  private ringMesh: THREE.Mesh;
  private outline: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private outlineMat: THREE.MeshBasicMaterial;
  private clankAt = -1;
  private knockT = 0; private readonly knockV = new THREE.Vector3();
  private dealt: { t: number; a: number }[] = [];
  private litCache = { t: -1, x: 0, y: 0, z: 0, v: false };
  private losT: number[] = [0, 0, 0, 0];
  private losV: boolean[] = [false, false, false, false];
  private patrolI = 0;
  private dyingFrom = new THREE.Vector3();
  private floodsOutAt: number[] = [];
  private splashed = false;
  private hoistSnd = 0;
  /** Debug / tests. */
  readonly log: LoaderLogEntry[] = [];
  lastAttack: { kind: AttackKind | null; telegraphStart: number; lockStart: number; impact: number } = { kind: null, telegraphStart: -1, lockStart: -1, impact: -1 };
  /** Rays cast by the loader (cost case). */
  rays = 0;
  /** Update cost accumulation (ms). */
  costMs = 0; costN = 0;

  constructor(world: EnemyWorld, group: string, position: THREE.Vector3, yaw: number, o: FactoryOpts, rig: LoaderRig) {
    super(world, group, position, yaw, 0.5, 1.0);
    this.isActor = !!o.actor;
    this.rig = rig;
    this.object.position.set(0, 0, 0);
    this.object.add(rig.root);
    this.volumes = rig.volumes;
    this.ignoreSeparation = true;
    this.body.gravityScale = 0;
    this.boundRadius = 30;
    const ctx = world.ctx;
    this.dock = ctx.level?.dock ?? null;
    this.rails = this.dock?.rails ?? { xMin: -71, xMax: -33, zMin: -192, zMax: -153, railY: -4.0 };
    const dw = (this.dock as unknown as { well?: THREE.Vector3 } | null)?.well;
    this.well = dw ? dw.clone() : this.dock ? new THREE.Vector3((this.dock.noSlam.min.x + this.dock.noSlam.max.x) / 2, -20.3, this.dock.noSlam.min.z - 2) : new THREE.Vector3(-52, -20.3, -176);
    this.health = T.hp.ram * 2 + T.hp.pod;
    const working = o.pose === 'working';
    const sx = working ? this.well.x : clamp(position.x, this.rails.xMin, this.rails.xMax);
    const sz = working ? this.well.z : clamp(position.z, this.rails.zMin, this.rails.zMax);
    this.tx = new Axis(sx); this.bz = new Axis(sz);
    this.pose = { bridgeZ: sz, trolleyX: sx, grab: new THREE.Vector3(sx, RAISED_TOP, sz), swayX: 0, swayZ: 0, jaws: 0, rams: 0, cowl: 0, floodAim: this.floodAim, floodCone: [T.sight.coneWide, T.sight.coneWide, T.sight.coneWide, T.sight.coneWide], ring: 0, mark: 'cyan' };
    for (let i = 0; i < 4; i++) this.floodAim[i].set(sx + (i - 1.5) * 4, -20, sz);
    // the ring (on the deck) and the slot outline: emissive quads owned by the loader (its telegraphs)
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    this.ringMesh = new THREE.Mesh(new THREE.RingGeometry(T.slam.radius - 0.12, T.slam.radius, 48), this.ringMat);
    this.ringMesh.rotation.x = -Math.PI / 2; this.ringMesh.visible = false; this.ringMesh.renderOrder = 3; this.ringMesh.frustumCulled = false;
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    this.outline = new THREE.Mesh(this.outlineGeometry(6.0, 2.4), this.outlineMat);
    this.outline.visible = false; this.outline.renderOrder = 3; this.outline.frustumCulled = false;
    if (!this.isActor) { ctx.scene.add(this.ringMesh); ctx.scene.add(this.outline); }
    if (this.isActor) { this.mode = 'puppet'; this.state = 'idle'; for (const l of rig.floods) if (l) l.enabled = false; }
    else if (working) {
      this.mode = 'working'; this.phase = 'hold'; this.state = 'idle'; this.awake = true;
      this.hangB14();
      this.top = this.well.y + 3.0 + 2.6 + 1.6; // B-14's bottom 3 m over the water: wet at +1.5 s of the lower
      this.startLoop('loader_hum', 0.8);
    } else {
      this.awake = true; this.startLoop('loader_hum', 0.8); this.beginHostile();
    }
    this.syncPose(0.016);
    this.emit('enemy:spawned');
  }

  private outlineGeometry(w: number, d: number): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry(), t = 0.14, hw = w / 2, hd = d / 2;
    const quads: [number, number, number, number][] = [[-hw, -hd, hw, -hd + t], [-hw, hd - t, hw, hd], [-hw, -hd, -hw + t, hd], [hw - t, -hd, hw, hd]];
    const pos: number[] = [];
    for (const [x0, z0, x1, z1] of quads) pos.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  // ───────────────────────────────────────────── BossControl surface (manager.boss wraps these)

  get stage(): number { return this.woke ? Math.max(1, this.objStage, this.dmgStage) : 0; }
  get dead(): boolean { return !this.alive; }
  get bothRamsGone(): boolean { return this.hp.ram_e <= 0 && this.hp.ram_w <= 0; }
  partHp(part: string): number { return Math.max(0, (this.hp as Record<string, number>)[part] ?? 0); }

  cue(name: 'lower'): void {
    if (name !== 'lower' || this.woke || this.mode !== 'working' || !this.b14 || this.phase !== 'hold') return;
    this.setPhase('lower');
    this.lowerT = this.world.time;
    this.logE('cue', { name });
    this.play('loader_hoist');
  }

  override wake(_delay = 0): void {
    if (!this.alive || this.isActor || this.woke) return;
    this.beginHostile();
  }

  setStage(s: 1 | 2 | 3): void {
    if (!this.alive) return;
    this.objStage = Math.max(this.objStage, s);
    this.checkStage();
  }

  floodLit(p: THREE.Vector3): boolean {
    if (!this.alive || this.isActor) return false;
    const c = this.litCache, w = this.world;
    if (w.time - c.t < 0.2 && Math.abs(c.x - p.x) + Math.abs(c.y - p.y) + Math.abs(c.z - p.z) < 0.5) return c.v;
    let lit = false;
    for (let i = 0; i < 4 && !lit; i++) {
      if (this.hp[`flood_${i + 1}` as LoaderPart] <= 0) continue;
      const l = this.rig.floods[i], rig = this.rig;
      if (!l || !l.enabled) continue;
      if (rig.floodInPool ? !rig.floodInPool(i) : !inPool(l)) continue;
      const head = rig.floodHead(i, _v);
      if (rig.floodCovers) { if (!rig.floodCovers(i, p)) continue; }
      else {
        _v2.copy(p).sub(head);
        const d = _v2.length();
        if (d > T.sight.floodRange || d < 1e-3) continue;
        if (_v2.dot(this.floodDir[i]) / d < Math.cos(this.pose.floodCone[i] / 2)) continue;
      }
      if (w.time - this.losT[i] > 0.25) {
        this.losT[i] = w.time; this.rays++;
        this.losV[i] = w.ctx.physics.lineOfSight(head, p);
      }
      lit = this.losV[i];
    }
    c.t = w.time; c.x = p.x; c.y = p.y; c.z = p.z; c.v = lit;
    return lit;
  }

  snapshot(): BossState {
    const parts: Record<string, number> = {};
    for (const k of LOADER_PARTS) parts[k] = Math.max(0, this.hp[k]);
    const st = this.stage;
    return {
      stage: (st > 3 ? 3 : st) as 0 | 1 | 2 | 3,
      parts,
      slots: this.dock ? this.dock.slots.map((s) => s.container) : [],
      carried: this.carriedId,
      dead: !this.alive,
    };
  }

  restore(s: BossState): void {
    if (this.isActor) return;
    const w = this.world;
    // parts
    this.rig.reset();
    for (const k of LOADER_PARTS) {
      const v = s.parts?.[k];
      this.hp[k] = typeof v === 'number' && isFinite(v) ? clamp(v, 0, PART_HP[k]) : PART_HP[k];
      if (this.hp[k] <= 0) this.rig.destroyPart(k);
    }
    this.dmgStage = this.bothRamsGone ? 3 : this.hp.ram_e <= 0 || this.hp.ram_w <= 0 ? 2 : 1;
    this.cowl = this.bothRamsGone ? 1 : 0;
    // cargo: whatever is in the grab goes back to a slot first, then the saved layout
    this.releaseCarriedTo(null);
    this.removeB14();
    if (this.dock && Array.isArray(s.slots)) this.applyLayout(s.slots, s.carried);
    if (s.carried === 'B-14' && !this.woke) this.hangB14();
    if (s.dead) { this.silentDead(); return; }
    // stage + grace
    this.woke = s.stage >= 1;
    this.objStage = Math.max(1, s.stage);
    this.emittedStage = this.stage;
    // re-emitted on every restore (audio sets its dark beds and the boss music stage from it)
    if (this.woke) this.world.ctx.events.emit('boss:stage', { group: this.group, stage: this.stage });
    if (this.woke) {
      this.state = 'attack';
      this.graceUntil = w.time + T.guard.grace;
      this.enterMode('guard');
    }
    this.ringState = 'off';
    this.outlineOnAt = -1;
    this.logE('restore', { stage: this.stage });
  }

  /** The layout of a BossState: container ids per dock slot index (null = empty); `carried` hangs in the grab. */
  private applyLayout(want: (string | null)[], carried: string | null): void {
    const dock = this.dock!;
    const held: CargoHandle[] = [];
    dock.slots.forEach((sl, i) => {
      const target = i < want.length ? want[i] : sl.container;
      if (sl.container && sl.container !== target) { const h = dock.lift(sl.id); if (h) held.push(h); }
    });
    dock.slots.forEach((sl, i) => {
      const target = i < want.length ? want[i] : null;
      if (!target || sl.container === target) return;
      const k = held.findIndex((h) => h.id === target);
      if (k >= 0) { dock.place(held[k], sl.id); held.splice(k, 1); }
    });
    for (const h of held) {
      if (carried && h.id === carried) { this.takeLoad(h); continue; }
      const free = dock.slots.find((q) => !q.container);
      if (free) dock.place(h, free.id);
    }
  }

  removeSilentlyPrep(): void {
    this.stopLoop(0);
    this.ringMesh.removeFromParent(); this.outline.removeFromParent();
    if (this.grabBox) { this.grabBox.remove(); this.grabBox = null; }
    this.releaseCarriedTo(null);
    this.removeB14();
  }

  private silentDead(): void {
    this.alive = false; this.health = 0;
    this.mode = 'dead'; this.state = 'dead';
    this.stopLoop(0);
    for (const l of this.rig.floods) if (l) l.enabled = false;
    this.object.visible = false; this.holdHidden = true; this.settled = true;
  }

  override dispose(): void {
    this.removeSilentlyPrep();
    try { this.rig.dispose(); } catch { /* */ }
    this.ringMesh.geometry.dispose(); this.outline.geometry.dispose();
    super.dispose();
  }

  // ───────────────────────────────────────────── modes

  private setPhase(p: string): void { this.phase = p; this.phaseT = 0; }

  private enterMode(m: Mode, phase = ''): void {
    this.mode = m; this.phase = phase; this.phaseT = 0;
    this.setState(m === 'working' || m === 'puppet' ? 'idle' : m === 'dying' || m === 'dead' ? 'dead' : m === 'hunt' || m === 'guard' ? 'chase' : 'attack');
  }

  private beginHostile(): void {
    const wasWorking = this.mode === 'working';
    this.woke = true;
    this.objStage = Math.max(1, this.objStage);
    if (wasWorking && this.b14) this.dropB14();
    this.enterMode('hunt');
    this.world.ctx.events.emit('enemy:woke', { id: this.id, type: this.type, position: this.body.position });
    this.world.ctx.events.emit('enemy:alerted', { id: this.id, type: this.type, position: this.body.position });
    this.logE('wake', {});
    this.checkStage();
  }

  private checkStage(): void {
    const st = this.stage;
    if (st > this.emittedStage && st >= 1) {
      this.emittedStage = st;
      this.logE('stage', { stage: st });
      this.world.ctx.events.emit('boss:stage', { group: this.group, stage: st });
    }
  }

  protected enterAlert(): void { if (!this.woke) this.beginHostile(); }

  // ───────────────────────────────────────────── update

  update(dt: number): void {
    if (this.isActor) { this.syncPose(dt); return; }
    const t0 = performance.now();
    this.stateTime += dt; this.phaseT += dt;
    for (const k of Object.keys(this.cd) as AttackKind[]) this.cd[k] -= dt;
    this.shiftClock += dt;
    this.tickKnock(dt);
    if (this.mode === 'dead') { this.syncPose(dt); this.settled = this.phaseT > 1; return; }
    this.perceive2(dt);
    switch (this.mode) {
      case 'working': this.tickWorking(dt); break;
      case 'hunt': this.tickHunt(dt); break;
      case 'guard': this.tickGuard(dt); break;
      case 'slam': this.tickSlam(dt); break;
      case 'shift': case 'drop': this.tickCargo(dt); break;
      case 'swing': this.tickSwing(dt); break;
      case 'dying': this.tickDying(dt); break;
    }
    this.aimFloods(dt);
    this.syncPose(dt);
    this.tickLoop(dt);
    this.costMs += performance.now() - t0; this.costN++;
  }

  /** Sensor sight (6 Hz, 60 m) and the reachability of his deck (5 Hz, `dock.target`). */
  private perceive2(dt: number): void {
    const w = this.world;
    this.rig.sensor(_v);
    this.dist = _v.distanceTo(w.playerPos);
    if ((this.seeT -= dt) <= 0) {
      this.seeT = 0.16 + w.rand() * 0.02;
      if (!w.playerAlive || this.dist > T.sight.range) this.sees = false;
      else { this.rays++; this.sees = w.ctx.physics.lineOfSight(_v, w.playerEye); }
      this.seesPlayer = this.sees;
    }
    if ((this.reachT -= dt) <= 0) {
      this.reachT = 0.2;
      this.reach = !!this.dock && w.playerAlive && this.dock.target(w.playerPos);
      // his DECK is one it can reach (he may stand where the grab cannot drop — beside a container — and still be
      // on its dock: that is SHIFT's case, not GUARD's): a target point within 2.5 m
      this.deckReach = this.reach || (!!this.dock && w.playerAlive && (this.nearTarget(w.playerPos)
        || this.dock.slots.some((q) => !!q.container && this.onHisDeck(q) && this.distToSlot(q, w.playerPos) <= T.shift.near)));
    }
    this.unreachT = this.deckReach ? 0 : this.unreachT + dt;
  }

  private deckReach = false;
  private nearTarget(p: THREE.Vector3): boolean {
    for (const r of [1.5, 2.5]) for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (this.dock!.target(_v3.set(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r))) return true;
    }
    return false;
  }

  private vBridge(): number { return T.speed.bridge[this.stageIx()]; }
  private vTrolley(): number { return T.speed.trolley[this.stageIx()]; }
  private stageIx(): number { return clamp(this.stage, 1, 3) - 1; }

  /** Drive the crane's grab centre toward (x, z) and its grab top toward `top`; returns true when there. */
  private driveTo(x: number, z: number, top: number | null, dt: number, scale = 1, hoist: number = T.speed.hoist): boolean {
    const r = this.rails;
    x = clamp(x, r.xMin, r.xMax); z = clamp(z, r.zMin, r.zMax);
    const ax = this.tx.drive(x, this.vTrolley() * scale, dt), az = this.bz.drive(z, this.vBridge() * scale, dt);
    // pendulum: the trolley's acceleration swings the grab the other way; damped spring
    const L = Math.max(2, this.rig.sheaveY - this.top);
    const g = 19, k = g / L, c = 0.9;
    this.sway.vz += (-k * this.sway.z - c * this.sway.vz - ax / L) * dt;
    this.sway.vx += (-k * this.sway.x - c * this.sway.vx + az / L) * dt;
    this.sway.z = clamp(this.sway.z + this.sway.vz * dt, -0.4, 0.4); this.sway.x = clamp(this.sway.x + this.sway.vx * dt, -0.4, 0.4);
    if (Math.abs(this.tx.v) + Math.abs(this.bz.v) > 0.4 && (this.hoistSnd -= dt) <= 0) { this.hoistSnd = 3; this.play('loader_travel', 0.7); }
    if (top !== null) {
      const d = top - this.top;
      this.top += clamp(d, -hoist * dt, hoist * dt);
    }
    return Math.abs(this.tx.x - x) < 0.15 && Math.abs(this.bz.x - z) < 0.15 && (top === null || Math.abs(this.top - top) < 0.05);
  }

  private tickWorking(dt: number): void {
    const w = this.world, W = T.working;
    this.ringK = 0.6;
    if (this.phase === 'hold') {
      this.driveTo(this.well.x, this.well.z, null, dt, 0.5);
      this.sway.x = Math.sin(w.time * 0.7) * W.sway; this.sway.z = Math.cos(w.time * 0.55) * W.sway * 0.7;
      return;
    }
    if (this.phase === 'lower') {
      this.driveTo(this.well.x, this.well.z, -26 + 2.6 + 1.6, dt, 0.5);
      const bottom = this.top - this.rig.grabHeight - 2.6;
      if (bottom < this.well.y && !this.splashed) { this.splashed = true; this.play('splash_big', 0.6); try { w.ctx.fx.smoke(_v.set(this.tx.x, this.well.y + 0.2, this.bz.x), { count: 6, size: 1.4, color: 0x9aa8b0, rise: 0.4, life: 2.0 }); } catch { /* */ } }
      if (this.top <= -26 + 2.6 + 1.6 + 0.05) { this.removeB14(); this.setPhase('rise'); this.play('loader_hoist'); }
      return;
    }
    if (this.phase === 'rise') {
      if (this.driveTo(this.well.x, this.well.z, RAISED_TOP, dt, 0.5)) { this.setPhase('patrol'); this.splashed = false; }
      return;
    }
    // patrol: a slow loop over the dock's corners (raised), floods sweeping the work area
    const r = this.rails, pts: [number, number][] = [[r.xMin + 4, r.zMin + 6], [r.xMax - 4, r.zMin + 6], [r.xMax - 4, r.zMin + 22], [r.xMin + 4, r.zMin + 22]];
    const p = pts[this.patrolI % pts.length];
    if (this.driveTo(p[0], p[1], RAISED_TOP, dt, W.patrolScale)) { if (this.phaseT > 4) { this.patrolI++; this.phaseT = 0; } }
    else this.phaseT = 0;
  }

  private tickGuard(dt: number): void {
    const park = this.dock?.park ?? _v.set(this.well.x, -8, this.rails.zMin + 6);
    this.ramsGoal = 0; this.jawsGoal = 0;
    this.driveTo(park.x, park.z, park.y + this.rig.grabHeight / 2, dt);
    if (this.graceUntil > 0) { if (this.world.time >= this.graceUntil) { this.graceUntil = -1; this.enterMode('hunt'); } return; }
    if (this.deckReach) { this.logE('guard_leave', {}); this.enterMode('hunt'); }
  }

  private tickHunt(dt: number): void {
    const w = this.world, pp = w.playerPos;
    this.ramsGoal = 0; this.jawsGoal = 0; this.ringState = 'off';
    if (!w.playerAlive) { this.driveTo(this.tx.x, this.bz.x, RAISED_TOP, dt); return; }
    if (this.unreachT >= T.guard.after) { this.logE('guard', {}); this.enterMode('guard'); return; }
    if (this.deckReach) {
      if (this.stage >= 3 && this.bothRamsGone && this.cd.swing <= 0 && this.planSwing()) { this.startAttack('swing'); this.enterMode('swing', 'wind'); this.play('loader_squeal'); return; }
      if (this.stage >= 2 && this.cd.drop <= 0 && this.planCargo('drop')) { this.startAttack('drop'); this.enterMode('drop', 'goto'); return; }
      if (this.stage <= 2 && this.shiftClock >= T.shift.period && this.planCargo('shift')) { this.shiftClock = 0; this.startAttack('shift'); this.enterMode('shift', 'goto'); return; }
      if (this.reach && this.cd.slam <= 0 && Math.hypot(this.tx.x - pp.x, this.bz.x - pp.z) < 3) {
        this.startAttack('slam');
        this.deckY = pp.y; this.ring.copy(pp); this.ringState = 'track'; this.waitTries = 0;
        this.enterMode('slam', 'track');
        this.play('loader_track', 0.8);
        return;
      }
    }
    // follow above him: at the slam hover over a deck it can reach, raised otherwise
    this.driveTo(pp.x, pp.z, this.reach ? Math.min(RAISED_TOP, pp.y + T.slam.hover + this.rig.grabHeight) : RAISED_TOP, dt, 0.8);
  }

  private startAttack(kind: AttackKind): void {
    this.lastAttack = { kind, telegraphStart: this.world.time, lockStart: -1, impact: -1 };
    this.logE('attack', { attack: kind });
  }

  // ── SLAM
  private tickSlam(dt: number): void {
    const w = this.world, S = T.slam, ix = this.stageIx(), pp = w.playerPos;
    const lag = this.floodsAlive() > 0 ? S.lag : S.lagNoFloods;
    const hover = this.deckY + S.hover + this.rig.grabHeight;
    switch (this.phase) {
      case 'track': {
        w.playerEyeAgo(lag, _v); // the eye's x/z `lag` s ago; his deck height now
        this.ring.set(_v.x, pp.y, _v.z);
        this.deckY = pp.y;
        this.driveTo(this.ring.x, this.ring.z, hover, dt, 1.25, 4);
        // the lock waits (tracking) until the grab hangs over the ring; given up after 3 s more
        const over = Math.hypot(this.tx.x - this.ring.x, this.bz.x - this.ring.z) <= 0.6;
        if (this.phaseT >= S.track[ix] + 3) { this.logE('slam_abort', { why: 'behind' }); this.cd.slam = 1.0; this.enterMode('hunt'); return; }
        if (this.phaseT >= S.track[ix] && over) {
          this.lockP.copy(this.ring);
          if (!this.slamOk(this.lockP)) {
            if (++this.waitTries > S.waitTries) { this.logE('slam_abort', {}); this.cd.slam = 1.0; this.enterMode('hunt'); return; }
            this.phaseT = S.track[ix] - S.waitStep; // wait 0.5 s (still tracking) and re-check
            return;
          }
          this.ringState = 'lock';
          this.lastAttack.lockStart = w.time;
          this.logE('lock', { p: this.lockP.toArray() });
          this.setPhase('lock');
          this.jawsGoal = this.bothRamsGone ? this.jaws : 1;
          this.ramsGoal = 1;
          if (!this.bothRamsGone) this.play('loader_jaws');
          this.play('loader_brake');
        }
        break;
      }
      case 'lock':
        this.driveTo(this.lockP.x, this.lockP.z, hover, dt, 1.5, 4);
        if (this.phaseT >= S.lock) { this.setPhase('drop'); this.logE('drop', {}); }
        break;
      case 'drop': {
        this.driveTo(this.lockP.x, this.lockP.z, null, dt, 1.5);
        const goal = this.deckY + this.rig.grabHeight;
        this.top = Math.max(goal, hover - (S.hover * this.phaseT) / S.drop);
        if (this.phaseT >= S.drop) { this.top = goal; this.impact(); this.setPhase('recover'); }
        break;
      }
      case 'recover':
        this.ringState = 'off';
        if (this.phaseT >= S.recover[ix]) { this.setPhase('rise'); this.ramsGoal = 0; this.jawsGoal = 0; this.logE('rise', {}); this.play('loader_hoist'); }
        break;
      case 'rise':
        this.driveTo(this.tx.x, this.bz.x, this.deckY + S.hover + this.rig.grabHeight, dt, 1, S.hover / S.rise);
        if (this.phaseT >= S.rise) { this.cd.slam = S.cooldown[ix]; this.enterMode('hunt'); }
        break;
    }
  }

  private slamOk(p: THREE.Vector3): boolean {
    if (!this.dock || !this.dock.target(p)) return false;
    const es = this.world.enemies;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e === this || !e.alive || e.type === 'loader') continue;
      const ep = e.position;
      if (Math.hypot(ep.x - p.x, ep.z - p.z) < T.slam.enemyClear && Math.abs(ep.y - p.y) < 2) return false;
    }
    return true;
  }

  private impact(): void {
    const w = this.world, S = T.slam, pp = w.playerPos;
    const c = _v.set(this.tx.x + Math.sin(this.sway.z) * 0, this.deckY, this.bz.x);
    this.lastAttack.impact = w.time; this.impactAt = w.time;
    this.play('loader_impact');
    try { w.ctx.fx.smoke(_v2.set(c.x, c.y + 0.1, c.z), { count: 10, size: 1.2, color: 0x6a6660, rise: 0.25, life: 1.6 }); w.ctx.fx.sparks(_v2.set(c.x, c.y + 0.05, c.z), Y, 18, 5); } catch { /* */ }
    const dx = pp.x - c.x, dz = pp.z - c.z, d = Math.hypot(dx, dz);
    let hit = false;
    if (w.playerAlive && Math.abs(pp.y - c.y) < 1.0) {
      if (d < S.radius + 0.35) {
        // S6c: a clear ray from the grab's bottom centre to his chest
        const chest = _v3.set(pp.x, pp.y + (w.playerEye.y - pp.y) * 0.72, pp.z);
        const from = _v2.set(c.x, c.y + 0.3, c.z);
        _dir.copy(chest).sub(from); const L = _dir.length(); _dir.normalize();
        if (this.grabBox) this.grabBox.enabled = false;
        const h = L > 0.05 ? w.ctx.physics.raycast(from, _dir, L) : null;
        this.rays++;
        if (!h) {
          hit = true;
          this.hurt(S.damage, c);
          this.knock(dx / (d || 1), dz / (d || 1), S.knock);
        }
      }
      if (d < S.shockRadius) try { w.ctx.player.shake(S.shake * (1 - d / S.shockRadius * 0.5)); } catch { /* */ }
    }
    this.logE('impact', { p: [c.x, c.y, c.z], dist: +d.toFixed(2), hit });
  }

  // ── SHIFT / DROP
  private onHisDeck(s: CargoSlot): boolean { return Math.abs(this.world.playerPos.y - s.floorY) <= T.shift.deckBand; }
  private slotHasEnemy(s: CargoSlot): boolean {
    for (const e of this.world.enemies) {
      if (e === this || !e.alive || e.type === 'loader') continue;
      const p = e.position;
      if (p.x > s.box.min.x - 0.4 && p.x < s.box.max.x + 0.4 && p.z > s.box.min.z - 0.4 && p.z < s.box.max.z + 0.4 && p.y > s.floorY - 1 && p.y < s.box.max.y + 1) return true;
    }
    return false;
  }
  private distToSlot(s: CargoSlot, p: THREE.Vector3): number {
    const cx = clamp(p.x, s.box.min.x, s.box.max.x), cz = clamp(p.z, s.box.min.z, s.box.max.z);
    return Math.hypot(p.x - cx, p.z - cz);
  }

  private planCargo(kind: 'shift' | 'drop'): boolean {
    const dock = this.dock;
    if (!dock) return false;
    const pp = this.world.playerPos;
    const occ = dock.slots.filter((s) => s.container && !this.slotHasEnemy(s));
    const free = dock.slots.filter((s) => !s.container && !this.slotHasEnemy(s) && this.slotTargetOk(s));
    if (!free.length) return false;
    if (kind === 'shift') {
      const near = occ.filter((s) => this.onHisDeck(s) && this.distToSlot(s, pp) <= T.shift.near);
      if (!near.length) return false;
      near.sort((a, b) => this.distToSlot(a, pp) - this.distToSlot(b, pp));
      free.sort((a, b) => this.distToSlot(b, pp) - this.distToSlot(a, pp));
      this.srcSlot = near[0]; this.dstSlot = free[0];
    } else {
      const dst = free.filter((s) => this.onHisDeck(s) && this.distToSlot(s, pp) <= T.drop.near).sort((a, b) => this.distToSlot(a, pp) - this.distToSlot(b, pp));
      if (!dst.length) return false;
      // the load: a container he is not standing at, the nearest to the grab (the drop must come while he is there)
      const g = _v2.set(this.tx.x, pp.y, this.bz.x);
      const src = occ.filter((s) => this.distToSlot(s, pp) > T.shift.near).sort((a, b) => this.distToSlot(a, g) - this.distToSlot(b, g));
      if (!src.length && !this.carried) return false;
      this.srcSlot = this.carried ? null : src[0]; this.dstSlot = dst[0];
    }
    this.outlineOnAt = -1;
    return true;
  }

  /** The set-down footprint is a legal target (S6b) — the slot box minus its own container. */
  private slotTargetOk(s: CargoSlot): boolean {
    return !!this.dock && this.dock.target(s.box.getCenter(_v3).setY(s.floorY));
  }

  private bodyOnLoad(s: CargoSlot): THREE.Vector3 | null {
    const top = s.box.max.y, w = this.world;
    const test = (p: THREE.Vector3) => p.x > s.box.min.x - 0.35 && p.x < s.box.max.x + 0.35 && p.z > s.box.min.z - 0.35 && p.z < s.box.max.z + 0.35 && p.y > top - 0.1 && p.y < top + T.shift.liftGuard + 0.1;
    if (w.playerAlive && test(w.playerPos)) return w.playerPos;
    for (const e of w.enemies) if (e !== this && e.alive && test(e.position)) return e.position;
    return null;
  }

  private tickCargo(dt: number): void {
    const w = this.world, Sh = T.shift, dst = this.dstSlot;
    if (!this.dock || !dst) { this.enterMode('hunt'); return; }
    const carryTop = (s: CargoSlot) => s.floorY + (this.mode === 'drop' ? T.drop.height : Sh.carryHeight) + 2.6 + this.rig.grabHeight;
    switch (this.phase) {
      case 'goto': {
        if (this.carried) { this.setPhase('carry'); break; }
        const src = this.srcSlot;
        if (!src || !src.container) { this.enterMode('hunt'); return; }
        const c = src.box.getCenter(_v);
        const above = src.box.max.y + this.rig.grabHeight;
        const over = Math.abs(this.tx.x - c.x) < 0.2 && Math.abs(this.bz.x - c.z) < 0.2;
        this.driveTo(c.x, c.z, over ? above : Math.max(this.top, carryTop(src)), dt);
        if (over && Math.abs(this.top - above) < 0.05) { this.setPhase('clamp'); this.jawsGoal = 1; this.ramsGoal = this.onHisDeck(src) ? 1 : 0; this.play('loader_jaws'); this.shoveT = 0; }
        break;
      }
      case 'clamp': {
        const src = this.srcSlot!;
        const body = this.bodyOnLoad(src);
        if (body) {
          // B2: never lift with a body on the load — wait, re-check, then shove it off
          this.shoveT += dt; this.phaseT = Math.min(this.phaseT, Sh.clamp * 0.5);
          if (this.shoveT > Sh.shoveAfter) this.shove(body, src);
          break;
        }
        if (this.phaseT > Sh.clamp * 0.5) this.jawsGoal = 0;
        if (this.phaseT >= Sh.clamp) {
          const h = this.dock.lift(src.id);
          if (!h) { this.enterMode('hunt'); return; }
          this.takeLoad(h); this.ramsGoal = 0;
          this.setPhase('lift'); this.play('loader_hoist'); this.logE('lift', { slot: src.id, id: h.id });
        }
        break;
      }
      case 'lift':
        this.driveTo(this.tx.x, this.bz.x, carryTop(dst), dt, 1, (carryTop(dst) - this.top) / Math.max(0.2, Sh.lift - this.phaseT) || T.speed.hoist);
        if (this.phaseT >= Sh.lift) this.setPhase('carry');
        break;
      case 'carry': {
        const c = dst.box.getCenter(_v);
        if (this.driveTo(c.x, c.z, carryTop(dst), dt, Math.min(1, Sh.carry / this.vTrolley()))) {
          this.setPhase(this.mode === 'drop' ? 'strobe' : 'lower');
          this.outlineOnAt = w.time;
          this.outlineMat.color.setHex(this.mode === 'drop' ? 0xff2010 : 0xffa020);
          this.logE('outline', { slot: dst.id, attack: this.mode });
        }
        break;
      }
      case 'lower': {
        const c = dst.box.getCenter(_v), setTop = dst.floorY + 2.6 + this.rig.grabHeight;
        // set-down contact no earlier than the outline's 1.6 s
        const rate = Math.min(T.speed.hoist, (this.top - setTop) / Math.max(0.05, Sh.outline - (w.time - this.outlineOnAt)));
        this.driveTo(c.x, c.z, setTop, dt, 1, Math.max(0.2, rate));
        if (this.top <= setTop + 0.02 && w.time - this.outlineOnAt >= Sh.outline) {
          this.ramsGoal = this.onHisDeck(dst) ? 1 : 0; this.jawsGoal = 1; this.play('loader_jaws');
          this.contactHurt(dst, Sh.damage);
          this.dock.place(this.carried!, dst.id);
          this.logE('setdown', { slot: dst.id, id: this.carriedId, t0: this.outlineOnAt });
          this.rig.carry(null); this.carried = null; this.carriedId = null;
          this.outlineOnAt = -1;
          this.setPhase('release');
        }
        break;
      }
      case 'strobe':
        if (w.time - this.outlineOnAt >= T.drop.strobe) {
          const h = this.carried!, from = dst.floorY + T.drop.height;
          this.rig.carry(null); this.carried = null;
          this.dock.drop(h, dst.id, from);
          this.logE('release', { slot: dst.id, id: this.carriedId, t0: this.outlineOnAt });
          this.carriedId = null;
          this.fallCheckAt = w.time + Math.sqrt((2 * T.drop.height) / 19);
          this.jawsGoal = 1; this.ramsGoal = this.onHisDeck(dst) ? 1 : 0;
          this.setPhase('release');
        }
        break;
      case 'release':
        if (this.fallCheckAt > 0 && w.time >= this.fallCheckAt) {
          this.fallCheckAt = -1; this.outlineOnAt = -1;
          this.contactHurt(dst, T.drop.damage);
          this.play('loader_impact', 0.8);
        }
        if (this.phaseT >= Sh.clamp && this.fallCheckAt < 0) {
          this.jawsGoal = 0; this.ramsGoal = 0;
          if (this.driveTo(this.tx.x, this.bz.x, RAISED_TOP, dt)) {
            const ix = this.stageIx();
            if (this.mode === 'drop') this.cd.drop = T.drop.cooldown[ix];
            this.cd.slam = Math.max(this.cd.slam, 1.0);
            this.enterMode('hunt');
          }
        }
        break;
    }
  }

  private contactHurt(s: CargoSlot, dmg: number): void {
    const w = this.world, p = w.playerPos;
    if (!w.playerAlive) return;
    const inside = p.x > s.box.min.x - 0.3 && p.x < s.box.max.x + 0.3 && p.z > s.box.min.z - 0.3 && p.z < s.box.max.z + 0.3 && p.y > s.floorY - 0.5 && p.y < s.box.max.y;
    if (!inside) return;
    const c = s.box.getCenter(_v);
    this.hurt(dmg, c);
    // push him out across the slot's short axis (z), away from its centre line
    const sz = p.z >= c.z ? 1 : -1;
    const need = (sz > 0 ? s.box.max.z - p.z : p.z - s.box.min.z) + 0.5;
    try { w.ctx.player.teleport(_v2.set(p.x, p.y + 0.02, p.z + sz * need)); } catch { /* */ }
    this.knock(0, sz, 3);
    this.logE('contact', { slot: s.id, dmg });
  }

  private shove(p: THREE.Vector3, s: CargoSlot): void {
    const c = s.box.getCenter(_v), dz = p.z >= c.z ? 1 : -1;
    if (p === this.world.playerPos) this.knock(0, dz, T.shift.shove);
    else p.z += dz * T.shift.shove * 0.016;
  }

  private takeLoad(h: CargoHandle): void {
    this.carried = h; this.carriedId = h.id;
    this.rig.carry(h.object);
  }

  private releaseCarriedTo(slot: string | null): void {
    if (!this.carried || !this.dock) return;
    const h = this.carried;
    this.rig.carry(null); this.carried = null; this.carriedId = null;
    const s = slot ? this.dock.slots.find((q) => q.id === slot) : this.dock.slots.find((q) => !q.container);
    if (s) this.dock.place(h, s.id);
  }

  // ── B-14 (working state)
  private hangB14(): void {
    if (this.b14) return;
    // origin = the bottom centre (as the dock's containers)
    const m = new THREE.Group(), box = new THREE.Mesh(new THREE.BoxGeometry(6.0, 2.6, 2.4), this.world.ctx.materials.get('container_orange'));
    box.position.y = 1.3; m.add(box);
    m.name = 'container_B-14';
    this.b14 = m; this.carriedId = 'B-14';
    this.rig.carry(m);
  }
  private removeB14(): void {
    if (!this.b14) return;
    if (this.carriedId === 'B-14') { this.rig.carry(null); this.carriedId = null; }
    this.b14.removeFromParent();
    this.b14.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.b14 = null;
  }
  private dropB14(): void {
    // woken while still holding B-14: the brakes let go over the well — it goes down at once
    this.logE('b14_dropped', {});
    this.removeB14();
    this.play('splash_big', 0.7);
  }

  // ── SWING
  private planSwing(): boolean {
    if (!this.dock) return false;
    const pp = this.world.playerPos, half = T.swing.arc / 2;
    const xMin = Math.max(this.rails.xMin, -67), xMax = Math.min(this.rails.xMax, -37);
    for (const sgn of this.tx.x < pp.x ? [-1, 1] : [1, -1]) {
      const ax = clamp(pp.x + sgn * half, xMin, xMax), bx = clamp(pp.x - sgn * half, xMin, xMax);
      if (Math.abs(ax - bx) < T.swing.arc * 0.8) continue;
      this.laneA.set(ax, pp.y, pp.z); this.laneB.set(bx, pp.y, pp.z);
      if (this.dock.target(this.laneA, this.laneB)) { this.deckY = pp.y; this.swingHit = false; return true; }
    }
    return false;
  }

  private tickSwing(dt: number): void {
    const w = this.world, Sw = T.swing, swingTop = this.deckY + Sw.bottom + this.rig.grabHeight;
    if (this.phase === 'wind') {
      this.driveTo(this.laneA.x, this.laneA.z, swingTop, dt, 1.4, 4);
      if (this.phaseT >= Sw.wind) {
        this.tx.snap(this.laneA.x); this.bz.snap(this.laneA.z); this.top = swingTop;
        this.lastAttack.lockStart = w.time;
        this.setPhase('sweep'); this.logE('sweep', { a: this.laneA.toArray(), b: this.laneB.toArray() });
      }
      return;
    }
    if (this.phase === 'sweep') {
      const k = smooth(this.phaseT / Sw.sweep);
      const x = THREE.MathUtils.lerp(this.laneA.x, this.laneB.x, k), z = THREE.MathUtils.lerp(this.laneA.z, this.laneB.z, k);
      const vx = (x - this.tx.x) / Math.max(dt, 1e-4);
      this.tx.x = x; this.tx.v = vx; this.bz.x = z;
      this.top = swingTop;
      this.sway.z = clamp(-vx * 0.02, -0.4, 0.4);
      const pp = w.playerPos;
      if (!this.swingHit && w.playerAlive && Math.abs(pp.y - this.deckY) < 1.0) {
        const crouched = w.playerEye.y - pp.y < 1.25;
        const top = crouched ? Sw.crouchHeight : 1.8;
        const inX = Math.abs(pp.x - x) < this.rig.grabHalf + 0.35, inZ = Math.abs(pp.z - z) < this.rig.grabHalf + 0.35;
        if (inX && inZ && top > Sw.bottom) {
          this.swingHit = true;
          this.hurt(Sw.damage, _v.set(x, this.deckY + 1.5, z));
          this.knock(Math.sign(this.laneB.x - this.laneA.x), 0, Sw.knock);
          this.lastAttack.impact = w.time;
        }
      }
      if (this.phaseT >= Sw.sweep) {
        this.logE('swing_end', { hit: this.swingHit });
        this.cd.swing = Sw.cooldown; this.cd.slam = Math.max(this.cd.slam, 1.2);
        this.setPhase('rise');
      }
      return;
    }
    if (this.driveTo(this.tx.x, this.bz.x, RAISED_TOP, dt)) this.enterMode('hunt');
  }

  // ── damage to the player (cap: ≤ 40 per 2 s)
  private hurt(amount: number, from: THREE.Vector3): void {
    const w = this.world, now = w.time;
    while (this.dealt.length && now - this.dealt[0].t > T.cap.window) this.dealt.shift();
    const used = this.dealt.reduce((a, d) => a + d.a, 0);
    const a = Math.min(amount, T.cap.amount - used);
    if (a <= 0) { this.logE('capped', { want: amount }); return; }
    this.dealt.push({ t: now, a });
    try { w.ctx.player.damage(a, from.clone()); } catch { /* */ }
    this.logE('hurt', { amount: a, want: amount });
  }

  private knock(nx: number, nz: number, speed: number): void {
    this.knockV.set(nx, 0, nz).normalize().multiplyScalar(speed);
    this.knockT = 0.32;
  }
  private tickKnock(dt: number): void {
    if (this.knockT <= 0) return;
    this.knockT -= dt;
    try {
      if (this.knockT > 0) this.world.ctx.player.setCarry(_v3.copy(this.knockV).multiplyScalar(this.knockT / 0.32));
      else this.world.ctx.player.setCarry(null);
    } catch { /* */ }
  }

  // ── floods
  private floodsAlive(): number { let n = 0; for (let i = 1; i <= 4; i++) if (this.hp[`flood_${i}` as LoaderPart] > 0) n++; return n; }

  private aimFloods(dt: number): void {
    const w = this.world, pp = w.playerPos;
    const hostile = this.woke && this.alive;
    const onTarget = hostile && (this.sees || this.mode === 'slam');
    for (let i = 0; i < 4; i++) {
      if (this.hp[`flood_${i + 1}` as LoaderPart] <= 0) continue;
      const head = this.rig.floodHead(i, _v);
      let want: THREE.Vector3;
      if (this.mode === 'swing') want = _v2.lerpVectors(this.laneA, this.laneB, (i + 0.5) / 4).setY(this.deckY);
      else if ((this.mode === 'shift' || this.mode === 'drop') && this.dstSlot && this.phase !== 'goto' && this.phase !== 'clamp') want = this.dstSlot.box.getCenter(_v2).setY(this.dstSlot.floorY);
      else if ((this.mode === 'shift' || this.mode === 'drop') && this.srcSlot) want = this.srcSlot.box.getCenter(_v2);
      else if (this.mode === 'slam' && this.ringState !== 'off') want = _v2.copy(this.ringState === 'lock' ? this.lockP : this.ring);
      else if (onTarget) want = _v2.set(pp.x, pp.y + 1.0, pp.z);
      else {
        // sweep the work area under the grab
        const a = w.time * 0.35 + i * 1.7;
        want = _v2.set(this.tx.x + Math.sin(a) * 7, -20, this.bz.x + Math.cos(a * 0.8) * 7);
      }
      _dir.copy(want).sub(head);
      const len = _dir.length();
      if (len < 1e-3) continue;
      _dir.multiplyScalar(1 / len);
      const cur = this.floodDir[i];
      const ang = cur.angleTo(_dir), step = T.sight.slew * (onTarget || this.mode !== 'working' ? 1 : 0.5) * dt;
      if (ang <= step) cur.copy(_dir);
      else { _v3.crossVectors(cur, _dir); if (_v3.lengthSq() < 1e-8) _v3.set(0, 1, 0); cur.applyAxisAngle(_v3.normalize(), step); }
      this.floodAim[i].copy(head).addScaledVector(cur, 30);
      this.pose.floodCone[i] = onTarget || this.mode === 'slam' ? T.sight.coneNarrow : T.sight.coneWide;
    }
  }

  // ── pose → rig
  private syncPose(dt: number): void {
    const P = this.pose;
    this.jaws += clamp(this.jawsGoal - this.jaws, -dt * 2.5, dt * 2.5);
    this.rams += clamp(this.ramsGoal - this.rams, -dt * 3, dt * 3);
    if (this.bothRamsGone && this.cowl < 1) this.cowl = Math.min(1, this.cowl + dt * 2);
    P.bridgeZ = this.bz.x; P.trolleyX = this.tx.x;
    const L = Math.max(0.5, this.rig.sheaveY - this.top);
    P.grab.set(this.tx.x + Math.sin(this.sway.z) * L * 0.15, this.top, this.bz.x - Math.sin(this.sway.x) * L * 0.15);
    P.swayX = this.sway.x; P.swayZ = this.sway.z;
    P.jaws = this.jaws; P.rams = this.rams; P.cowl = this.cowl;
    const held = (this.mode === 'slam' && this.phase !== 'track') || ((this.mode === 'shift' || this.mode === 'drop') && (this.phase === 'clamp' || this.phase === 'lower' || this.phase === 'release' || this.phase === 'strobe'));
    P.swayHold = held ? 1 : 0;
    P.forceSwayZ = this.mode === 'swing' && this.phase === 'sweep' ? this.sway.z : null;
    P.ringMode = !this.alive ? 'off' : this.ringState === 'lock' ? 'red' : this.mode === 'working' || this.ringState === 'track' ? 'white' : 'off';
    P.ring = this.ringK; P.mark = !this.alive ? 'off' : this.woke ? 'red' : 'cyan';
    if (this.mode === 'dying' && this.phaseT > 0.1) P.mark = 'off';
    if (this.isActor) P.mark = 'off';
    try { this.rig.apply(P, dt); } catch (e) { if (this.world.ctx.debug.verbose) console.warn('[loader] rig.apply', e); }
    this.body.position.set(this.tx.x, -4.5, this.bz.x);
    // the ring and the outline (telegraphs)
    const ring = this.ringState !== 'off' && this.alive;
    this.ringMesh.visible = ring;
    if (ring) {
      this.ringMesh.position.set(this.ringState === 'lock' ? this.lockP.x : this.ring.x, this.deckY + 0.03, this.ringState === 'lock' ? this.lockP.z : this.ring.z);
      this.ringMat.color.setHex(this.ringState === 'lock' ? 0xff1a08 : 0xfff2d0);
    }
    const ol = this.outlineOnAt >= 0 && !!this.dstSlot && this.alive;
    this.outline.visible = ol && Math.floor((this.world.time - this.outlineOnAt) * 6) % 2 === 0;
    if (ol) { const c = this.dstSlot!.box.getCenter(_v); this.outline.position.set(c.x, this.dstSlot!.floorY + 0.03, c.z); }
    // carried container's box follows it; the grab's own box while its bottom is < 2.5 m above a deck (B2)
    // a carried container's box is kept on it by the dock (W4b: every frame while lifted)
    const bottom = this.top - this.rig.grabHeight;
    const low = this.alive && this.mode !== 'dying' && bottom - this.deckY < T.grabBoxBelow && bottom > this.deckY - 0.5 && this.woke;
    if (low) {
      if (!this.grabBox) { try { this.grabBox = this.world.ctx.physics.addBox(new THREE.Box3(), 'metal'); this.grabBox.walkable = false; } catch { this.grabBox = null; } }
      if (this.grabBox) {
        const g = this.rig.grabHalf;
        this.grabBox.box.min.set(P.grab.x - g, bottom, P.grab.z - g); this.grabBox.box.max.set(P.grab.x + g, this.top, P.grab.z + g);
        this.grabBox.enabled = true;
      }
    } else if (this.grabBox) this.grabBox.enabled = false;
  }

  override boundCenter(out: THREE.Vector3): THREE.Vector3 { return out.set((this.rails.xMin + this.rails.xMax) / 2, (this.rails.railY + this.top) / 2, this.bz.x); }

  // ───────────────────────────────────────────── damage

  /** The multiplier a hit on `part` gets right now (debug / UI / tests). */
  mult(part: string): number {
    if (part.startsWith('flood_')) return this.hp[part as LoaderPart] > 0 ? T.mult.flood : 0;
    if (part === 'ram_e' || part === 'ram_w') return this.hp[part] > 0 && this.rams > 0.5 ? T.mult.ramExtended : T.mult.ramRetracted;
    if (part === 'pod') return this.cowl > 0.5 ? T.mult.podOpen : T.mult.podShut;
    return T.mult.body;
  }

  protected hitFx(b: HitBurst): void {
    const fx = this.world.ctx.fx;
    try { fx.sparks(b.point, b.normal, clamp(Math.round(3 + b.amount / 8), 3, 16), 3); } catch { /* */ }
  }

  applyDamage(vol: HitVolume, amount: number, point: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.alive || this.isActor || this.mode === 'dying') return;
    const w = this.world, part = vol.part;
    const m = this.mult(part);
    let dmg = amount * m;
    const key = part as LoaderPart;
    if (key in this.hp) dmg = Math.min(dmg, Math.max(0, this.hp[key]));
    if (m <= 0) {
      if (w.time - this.clankAt >= T.clankEvery) { this.clankAt = w.time; this.play('armour_clank', 0.9, point); }
      try { w.ctx.fx.sparks(point, _v.copy(dir).negate(), 10, 4); } catch { /* */ }
    } else if (part === 'body') this.play('impact_metal', 0.6, point);
    else if (part === 'ram_e' || part === 'ram_w') this.play('ram_hit', 0.8, point);
    w.ctx.events.emit('enemy:damaged', { id: this.id, type: this.type, point, direction: dir, amount: dmg, part });
    this.queueHit(vol, amount, point, dir);
    if (!this.woke) this.beginHostile();
    if (dmg <= 0) return;
    if (key in this.hp) {
      this.hp[key] -= dmg;
      if (this.hp[key] <= 0) { this.hp[key] = 0; this.destroy(key, point); }
    }
    this.health = Math.max(0, this.hp.ram_e) + Math.max(0, this.hp.ram_w) + Math.max(0, this.hp.pod);
  }

  private destroy(part: LoaderPart, point: THREE.Vector3): void {
    const w = this.world;
    this.rig.destroyPart(part);
    for (const v of this.volumes) if (v.part === part && part.startsWith('flood_')) v.enabled = false;
    w.ctx.events.emit('enemy:part-destroyed', { id: this.id, type: this.type, part, position: point.clone() });
    this.logE('destroyed', { part });
    if (part.startsWith('flood_')) {
      this.play('flood_pop', 1, point);
      try { w.ctx.fx.sparks(point, Y, 24, 4); w.ctx.fx.flash(point, 0xfff0d0, 5, 0.08, 6); w.ctx.fx.emitter('sparks', point.clone(), Y, 3); } catch { /* */ }
      this.litCache.t = -1;
      return;
    }
    if (part === 'ram_e' || part === 'ram_w') {
      this.play('ram_burst', 1, point);
      try { w.ctx.fx.fluid(point, Y, 16); w.ctx.fx.smoke(point, { count: 6, size: 0.6, color: 0xd8d8d8, rise: 0.8, life: 1.4 }); } catch { /* */ }
      this.dmgStage = Math.max(this.dmgStage, this.bothRamsGone ? 3 : 2);
      if (this.bothRamsGone) {
        this.play('cowl_open', 1);
        this.rig.sensor(_v); try { w.ctx.fx.emitter('steam', _v.clone(), _v2.set(0, -1, 0), 4); } catch { /* */ }
        this.logE('cowl_open', {});
      }
      this.checkStage();
      return;
    }
    if (part === 'pod') this.die();
  }

  private die(): void {
    if (!this.alive) return;
    const w = this.world;
    this.alive = false; this.health = 0;
    this.ringState = 'off'; this.outlineOnAt = -1;
    this.rig.sensor(_v);
    try { w.ctx.fx.explosion(_v.clone(), 0.8); w.ctx.player.shake(0.3); } catch { /* */ }
    this.play('loader_death', 1);
    this.stopLoop(1.5);
    this.dyingFrom.set(this.tx.x, this.top, this.bz.x);
    this.floodsOutAt = [0, 1, 2, 3].map((i) => 0.3 + i * (T.death.floodsOut / 4) + w.rand() * 0.1);
    this.enterMode('dying', 'reach');
    this.diedAt = w.time;
    if (this.rig.die) {
      // W3a's keyed death: the rig drives the machine into the well; its cues are our sounds / fx (D25)
      this.setPhase('rig');
      const cueSnd: Partial<Record<string, string>> = { drive_fail: 'loader_travel', brake_release: 'loader_brake', rope_run: 'rope_whip', splash: 'splash_big', flood_out: 'flood_pop', buffer: 'loader_impact' };
      this.rig.die(this.well.clone(), (c, at) => {
        const id = cueSnd[c];
        if (id) this.play(id, c === 'flood_out' ? 0.5 : 1, at);
        try {
          if (c === 'splash') w.ctx.fx.smoke(at.clone().setY(this.well.y + 0.3), { count: 14, size: 1.8, color: 0xb8c4cc, rise: 1.2, life: 2.4 });
          if (c === 'flood_out') w.ctx.fx.sparks(at, Y, 10, 3);
          if (c === 'buffer') w.ctx.player.shake(0.15);
        } catch { /* */ }
        if (c === 'splash' && this.carried) { const h = this.carried; this.carried = null; this.carriedId = null; h.box.enabled = false; }
        // the 'done' cue settles the loader synchronously (a promise `.then` cannot run inside a stepped test loop)
        if (c === 'done') this.settleDead();
      }).then(() => this.settleDead());
    }
    this.logE('died', {});
    w.onDeath(this);
  }

  private settleDead(): void {
    if (this.mode !== 'dying') return;
    this.removeB14(); this.mode = 'dead'; this.phaseT = 0; this.setState('dead'); this.logE('dead', {});
  }

  private tickDying(dt: number): void {
    const w = this.world, D = T.death;
    if (this.phase === 'rig') {
      if (this.rig.grabTopNow) this.top = this.rig.grabTopNow(_v).y;
      // the rig's death promise is the end; a fallback after 16 s (logged) so the loader always settles
      if (this.phaseT > 25 && this.mode === 'dying') { this.logE('dead_timeout', {}); this.removeB14(); this.mode = 'dead'; this.phaseT = 0; this.setState('dead'); }
      return;
    }
    // floods die one by one over 1.5 s
    for (let i = 0; i < 4; i++) {
      const l = this.rig.floods[i];
      if (l && l.enabled && this.stateTime >= 0 && this.phaseTotal() >= this.floodsOutAt[i]) l.enabled = false;
    }
    if (this.phase === 'reach') {
      // 2.0 s of failing drive: the grab is put over the well's centre (it dies reaching for the water), raised clear
      const k = smooth(this.phaseT / D.reach);
      this.tx.x = THREE.MathUtils.lerp(this.dyingFrom.x, this.well.x, k); this.bz.x = THREE.MathUtils.lerp(this.dyingFrom.z, this.well.z, k);
      this.top = Math.max(this.top, THREE.MathUtils.lerp(this.dyingFrom.y, Math.max(this.dyingFrom.y, -9), k));
      this.sway.z = Math.sin(this.phaseT * 9) * 0.05;
      if (this.phaseT >= D.reach) { this.setPhase('plunge'); this.play('rope_whip', 1); this.vPlunge = 0; }
      return;
    }
    if (this.phase === 'plunge') {
      this.vPlunge = Math.min(D.plunge * 2, this.vPlunge + 19 * dt);
      this.top -= this.vPlunge * dt;
      const bottom = this.top - this.rig.grabHeight - (this.carried || this.b14 ? 2.6 : 0);
      if (!this.splashed && bottom < this.well.y) {
        this.splashed = true; this.play('splash_big', 1);
        try { w.ctx.fx.smoke(_v.set(this.well.x, this.well.y + 0.3, this.well.z), { count: 14, size: 1.8, color: 0xb8c4cc, rise: 1.2, life: 2.4 }); } catch { /* */ }
      }
      const floorTop = -26 + this.rig.grabHeight;
      if (this.top <= floorTop) {
        this.top = floorTop;
        if (this.carried) { const h = this.carried; this.rig.carry(null); this.carried = null; h.object.visible = false; h.box.enabled = false; }
        this.removeB14();
        this.setPhase('coast'); this.play('loader_brake', 0.6);
      }
      return;
    }
    // the bridge coasts into its end-stop buffers
    if (this.phase === 'coast') {
      if (this.phaseT >= 2.5) { this.mode = 'dead'; this.phaseT = 0; this.setState('dead'); this.logE('dead', { grab: [this.tx.x, this.top, this.bz.x] }); }
    }
  }
  private vPlunge = 0;
  private phaseTotal(): number { return this.world.time - this.diedAt; }

  // ───────────────────────────────────────────── misc

  private play(id: string, volume = 1, at?: THREE.Vector3): void {
    if (this.isActor) return;
    try { this.world.ctx.audio.play(id, { position: (at ?? this.body.position).clone(), volume }); } catch { /* audio not ready */ }
  }

  private logE(kind: string, o: Record<string, unknown>): void {
    this.log.push({ t: +this.world.time.toFixed(3), kind, ...o });
    if (this.log.length > 600) this.log.splice(0, 100);
  }

  override puppetEyes(_on: boolean): void { /* the marks follow the pose */ }

  /** `enemies.debug.loader()` row (§8.2; S8d `parts[id].{hp, pos, mult}`). */
  debugRow(): Record<string, unknown> {
    const parts: Record<string, { hp: number; pos: number[]; mult: number }> = {};
    for (const k of LOADER_PARTS) {
      const v = this.volumes.find((q) => q.part === k);
      let pos: number[] = [];
      if (v) { v.bone.updateWorldMatrix(true, false); _v.copy(v.a).add(v.b).multiplyScalar(0.5).applyMatrix4(v.bone.matrixWorld); pos = _v.toArray().map((x) => +x.toFixed(3)); }
      parts[k] = { hp: +Math.max(0, this.hp[k]).toFixed(2), pos, mult: this.mult(k) };
    }
    const r = (x: number) => +x.toFixed(3);
    const bottom = this.top - this.rig.grabHeight;
    return {
      id: this.id, group: this.group, alive: this.alive,
      stage: this.stage, mode: this.mode, phase: this.phase, objStage: this.objStage, dmgStage: this.dmgStage,
      parts, floods: this.floodsAlive(),
      target: this.ringState === 'lock' ? this.lockP.toArray().map(r) : this.ringState === 'track' ? this.ring.toArray().map(r) : null,
      ring: { state: this.ringState, pos: (this.ringState === 'lock' ? this.lockP : this.ring).toArray().map(r) },
      grab: this.rig.grabTopNow ? this.rig.grabTopNow(_v).toArray().map(r) : [r(this.pose.grab.x), r(this.top), r(this.pose.grab.z)], grabBottom: r(bottom),
      jaws: r(this.jaws), rams: this.rams > 0.5 ? 'extended' : 'retracted', cowl: r(this.cowl),
      carried: this.carriedId, slots: this.dock ? this.dock.slots.map((s) => s.container) : [],
      outline: this.outlineOnAt >= 0 && this.dstSlot ? this.dstSlot.id : null,
      lastAttack: { ...this.lastAttack },
      sees: this.sees, reach: this.reach, unreach: r(this.unreachT), cd: { ...this.cd },
      rays: this.rays, costMs: this.costN ? +(this.costMs / this.costN).toFixed(4) : 0,
      grace: this.graceUntil > 0, time: r(this.world.time),
    };
  }
}

/** S13: is a flood's light in the light pool this frame (not only enabled)? */
function inPool(l: LightHandle): boolean {
  const h = l as unknown as { slot?: unknown };
  if ('slot' in (h as object)) return h.slot != null && l.factor > 0;
  return l.factor > 0;
}
