/**
 * Stage 3c §8.2.3–8.2.7 (W3b) — THE TAKEN SOLDIER's behaviour: perception (sight cone / range / dark rules / the
 * flashlight beam / the lit window / hearing / group knowledge), hold & release, cover-to-cover movement at walking
 * pace, the telegraphed fire cycle (rise / lean with light → aim 0.45 s → burst → hold → back), honest misses near the
 * player, suppression, retreat, search, the stand-off at a crawl exit, death, drops. Every number is in `fire.ts`
 * `SOLDIER_TUNING`. The body is W3a's `SoldierRigEx` (rig.ts, §8.2.2): this class positions / turns the enemy object,
 * sets pose / move / aim, then calls `rig.update(dt)` once per frame (also while dying, until the body is still and the
 * Clasp mark is out). Cutscene actors are W3a's `SoldierActor` (actor.ts), not this class.
 *
 * Mapping to `Enemy.state`: hold / idle → 'idle'; combat → 'chase' ('attack' in rise / aim / burst / after);
 * search → 'alert'; stagger → 'stagger'; dead → 'dead'.
 */
import * as THREE from 'three';
import type { CoverPoint, HitOwner, SoldierArms, SoldierDebug, Surface } from '../../core/types';
import { EnemyBase, type EnemyWorld, type HitBurst } from '../ai';
import type { FactoryOpts } from '../manager';
import type { HitVolume } from '../shared/hit';
import { angleDiff } from '../shared/ik';
import { SOLDIER_TUNING as T, hitChance, type DirectedSoldier, type SoldierDirector } from './fire';
import { chooseCover, coverSafe, peekEye } from './cover';
import type { SoldierPose, SoldierRigEx } from './rig';

type Mode = 'hold' | 'idle' | 'combat' | 'search' | 'standoff' | 'dying' | 'dead';
type Impact = { point: THREE.Vector3; normal: THREE.Vector3; surface: Surface; owner?: HitOwner };
type Fire = 'none' | 'rise' | 'aim' | 'burst' | 'after' | 'back' | 'reload';

export interface SoldierFactoryOpts extends FactoryOpts { rig: SoldierRigEx }

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _d = new THREE.Vector3();
const _pc = new THREE.Vector3(), _pe = new THREE.Vector3(), _aim = new THREE.Vector3(), _end = new THREE.Vector3(), _end2 = new THREE.Vector3(), _cl = new THREE.Vector3();
const yawOf = (x: number, z: number) => Math.atan2(-x, -z);

/** Test switches (`enemies.debug.soldier(id).debugSet({...})`). */
export interface SoldierDebugSet {
  /** No AI at all: stands in `pose` (default 'aim'), never fires, never moves; still takes damage and dies. */
  freeze?: boolean; pose?: SoldierPose;
  /** A fixed gap between bursts (s) instead of the table's range (statistics runs). */
  gap?: number | null;
  /** The first-burst miss off (statistics runs). */
  noFirstMiss?: boolean;
  /** Never chooses cover / moves / searches (stands and fights where he is, no sidestep). */
  noMove?: boolean;
  /** Fire at the player whenever he sees him (skip the cover peek logic). */
  aware?: boolean;
  /** With `freeze`: where the frozen pose aims (world point), default none (low ready / the pose's own). */
  aimAt?: THREE.Vector3 | null;
}

export class Soldier extends EnemyBase implements DirectedSoldier {
  readonly type = 'soldier' as const;
  readonly arms: SoldierArms;
  readonly coverSet: string | undefined;
  readonly rig: SoldierRigEx;
  mode: Mode = 'idle';
  private fire: Fire = 'none';
  private fireT = 0;
  private dir: SoldierDirector | null = null;
  // perception
  aware = false;
  private lastKnown = new THREE.Vector3();
  private lastSeenT = -1e9;
  private unseenT = 1e9;
  private firstMiss = true;
  private senseT = 0;
  private sightChest = false;
  /** World time since which sight (dark) / the beam has held continuously; −1 = not holding. */
  private darkSince = -1;
  private beamSince = -1;
  private visRaw = false;
  private seenDist = 99;
  // suppression / damage
  supp = 0;
  private peekBlockUntil = -1;
  private suppWasHigh = false;
  private recentHits: [number, number][] = [];
  private frameDmg = 0; private frameHead = false; private frameBuck = 0;
  private flinchT = 0; private staggerT = 0;
  // cover / movement
  private cover: CoverPoint | null = null;
  private coverSide = 1;
  private target: THREE.Vector3 | null = null;
  private targetCover: CoverPoint | null = null;
  private moveSpeed = T.walk;
  private recent: string[] = [];
  private coverTimer = 0.3;
  private checkT = 0; private checkN = 0;
  private peekSight = false;
  private retreating = false;
  private stuckT = 0; private lastPos = new THREE.Vector3();
  private stepAcc = 0; private stepN = 0;
  // firing
  private gapT = 0;
  private mag: number;
  private shotsLeft = 0; private shotT = 0;
  private friendlyTries = 0;
  private burstVis = 4;
  private lightOn = false;
  // search / stand-off
  private searchPhase = 0; private searchT = 0; private searched = false; private searchYaw = 0;
  private standNode = -1;
  // hold walk (story extra)
  private holdWalk: { to: THREE.Vector3; speed: number; done: () => void } | null = null;
  // pose
  private curPose: SoldierPose | '' = '';
  // stats (H12)
  shots = 0; hits = 0; bursts = 0;
  private dbg: SoldierDebugSet = {};
  private spawnYaw: number;

  constructor(world: EnemyWorld, group: string, position: THREE.Vector3, yaw: number, o: SoldierFactoryOpts) {
    super(world, group, position, yaw, 0.35, 1.8);
    this.isActor = false;
    this.arms = o.arms ?? 'carbine';
    this.coverSet = o.cover;
    this.health = T.hp;
    this.mag = T.reload[this.arms].rounds;
    this.eyeHeight = T.eye.stand;
    this.boundCenterY = 1.0; this.boundRadius = 1.35;
    this.spawnYaw = yaw;
    this.rig = o.rig;
    this.volumes = this.rig.volumes;
    // the manager drives LOD (12 / 10 m, forceLod) and room visibility through the rig like every other enemy
    this.lodRig = this.rig.lodRig;
    this.object.add(this.rig.root);
    this.awake = true;
    this.dir = world.soldiers();
    this.dir.register(this);
    if (o.pose === 'hold') { this.mode = 'hold'; this.state = 'idle'; }
    else if (o.dormant) { this.mode = 'idle'; this.state = 'idle'; }
    else {
      // a spawn-mode group arrives knowing where the player is (CHOIR) and works toward him from cover
      this.mode = 'idle'; this.state = 'idle';
      if (o.emerge) this.becomeAware(world.playerPos, false);
    }
    this.rig.setLed('red');
    this.place();
    this.choosePose(0);
    this.rig.update(0);
    this.emit('enemy:spawned');
  }

  // ───────────────────────────────────────────────────────── contract-ish extras

  get holdingNow(): boolean { return this.alive && this.mode === 'hold'; }
  releaseHold(why: string): void {
    if (this.mode !== 'hold' || !this.alive) return;
    if (this.holdWalk) { const d = this.holdWalk.done; this.holdWalk = null; d(); }
    this.mode = 'combat';
    this.becomeAware(this.world.playerPos, false);
    this.emit('enemy:alerted');
    this.log('release', { why });
  }
  /** Story extra (v5_boots): a holding soldier walks to a point (stays holding), weapon light on if asked. */
  holdWalkTo(to: THREE.Vector3, speed = 1.3, light = false): Promise<void> {
    if (this.mode !== 'hold' || !this.alive) return Promise.resolve();
    if (this.holdWalk) { const d = this.holdWalk.done; this.holdWalk = null; d(); }
    this.setLight(light);
    return new Promise((resolve) => { this.holdWalk = { to: to.clone(), speed, done: resolve }; });
  }
  debugSet(o: SoldierDebugSet): SoldierDebugSet { this.dbg = { ...this.dbg, ...o }; if (o.aware) this.becomeAware(this.world.playerPos, false); return this.dbg; }
  debugRow(): SoldierDebug {
    const p = this.body.position;
    return {
      id: this.id, group: this.group, pos: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)], state: this.state,
      aware: this.aware, holding: this.mode === 'hold', token: !!this.dir?.tokens.has(this.id), light: this.lightOn,
      cover: this.cover?.id ?? null, hp: +this.health.toFixed(2), suppression: +this.supp.toFixed(3),
      shots: this.shots, hits: this.hits, bursts: this.bursts,
      // extras (tests)
      ...({ mode: this.mode, fire: this.fire, sees: this.seesPlayer, firstMiss: this.firstMiss, moving: !!this.target, target: this.targetCover?.id ?? null, mag: this.mag, led: this.rig.led, standNode: this.standNode, yaw: +this.yaw.toFixed(3), pose: this.curPose, rigPose: this.rig.pose, burstsHere: this.burstsHere, settledBody: this.rig.settled } as object),
    } as SoldierDebug;
  }

  // ───────────────────────────────────────────────────────── director callbacks

  headPoint(out: THREE.Vector3): THREE.Vector3 { return out.copy(this.rig.eye); }
  nearMiss(weapon: string, d: number): void {
    if (!this.alive || this.isActor) return;
    if (this.mode === 'hold') this.releaseHold('shot_near');
    const g = this.dir!.takeSuppression(this.id, T.supp.gain[weapon] ?? 0.3);
    this.supp += g;
    if (!this.aware) this.becomeAware(this.world.playerPos, true);
    this.log('supp', { g: +g.toFixed(3), s: +this.supp.toFixed(3), d: +d.toFixed(2) });
  }
  heardSprint(at: THREE.Vector3): void {
    if (this.mode !== 'idle' || this.aware || !this.alive) return;
    this.becomeAware(at, true);
  }
  told(at: THREE.Vector3): void {
    if (!this.alive || this.mode === 'hold' || this.isActor) return;
    if (!this.aware) { this.becomeAware(at, false); this.emit('enemy:alerted'); return; }
    this.lastKnown.copy(at); this.lastSeenT = this.world.time;
  }
  /** Gunfire within a weapon's noise radius (manager.alertNoise): an idle soldier turns; a holding one does not. */
  override alert(): void {
    if (!this.alive || this.mode !== 'idle' || this.aware) return;
    this.becomeAware(this.world.playerPos, true);
  }
  protected enterAlert(): void { this.alert(); }
  override wake(): void { /* soldiers are never dormant machines */ }

  private becomeAware(at: THREE.Vector3, share: boolean): void {
    const first = !this.aware;
    this.aware = true;
    this.lastKnown.copy(at); this.lastSeenT = this.world.time;
    if (this.mode === 'idle') this.mode = 'combat';
    if (first) {
      this.coverTimer = 0.2 + this.world.rand() * 0.3;
      this.log('aware', {});
      if (share) { this.emit('enemy:alerted'); this.dir?.share(this.group, this.id, at); }
    }
  }

  // ───────────────────────────────────────────────────────── update

  update(dt: number): void {
    this.stateTime += dt;
    if (this.mode === 'dead') return;
    if (this.mode === 'dying') {
      this.place();
      this.rig.update(dt);
      // settled = the keyed fall is over (rig.settled, 1.35–1.55 s) AND the Clasp's 'fail' pattern has run out (1.5 s);
      // then the manager stops updating him. A guard at 2.2 s.
      if ((this.rig.settled && this.rig.led === 'off') || this.world.time - this.diedAt >= 2.2) this.settle();
      return;
    }
    const w = this.world;
    const p = this.body.position;
    this.dist = Math.hypot(w.playerPos.x - p.x, w.playerPos.z - p.z, (w.playerPos.y - p.y) * 0.6);
    // per-frame damage reactions (one shotgun shell = one "hit")
    if (this.frameDmg > 0) this.reactToHit();
    this.flinchT = Math.max(0, this.flinchT - dt);
    this.staggerT = Math.max(0, this.staggerT - dt);
    // suppression decay; the no-peek window
    if (this.supp > 0) this.supp = Math.max(0, this.supp - T.supp.decay * dt);
    if (this.supp >= T.supp.noPeek) this.suppWasHigh = true;
    else if (this.suppWasHigh) { this.suppWasHigh = false; this.peekBlockUntil = w.time + T.supp.noPeekAfter; }
    this.sense(dt);
    if (this.dbg.freeze) { this.place(); this.setPose(this.dbg.pose ?? 'aim'); this.rig.aim(this.dbg.aimAt ?? null); this.rig.setMove(0, this.yaw); this.moveGround(dt, 0, 0, 0, 10); this.place(); this.rig.update(dt); return; }
    if (this.mode === 'hold') this.tickHold(dt);
    else if (this.mode === 'idle') { this.moveGround(dt, 0, 0, 0, 8); this.rig.setMove(0, this.yaw); }
    else this.tickAware(dt);
    this.choosePose(dt);
    this.chooseAim();
    // the step out from high cover: out over the rise (0.35 s), back over 'back' (0.4 s)
    const out = !!this.cover && this.cover.height === 'high' && (this.fire === 'rise' || this.fire === 'aim' || this.fire === 'burst' || this.fire === 'after');
    this.stepOut = THREE.MathUtils.clamp(this.stepOut + (out ? dt / T.rise : -dt / T.back) * T.cover.leanStep, 0, T.cover.leanStep);
    if (!this.cover) this.stepOut = 0;
    this.place();
    this.rig.update(dt);
  }

  /** High cover: the step out to the peek side (m, eased over the rise / back) — the body (and its hit volumes) moves. */
  private stepOut = 0;
  private place(): void {
    this.object.position.copy(this.body.position);
    if (this.stepOut > 1e-3 && this.cover) {
      const n = this.cover.normal;
      this.object.position.x += -n.z * this.coverSide * this.stepOut;
      this.object.position.z += n.x * this.coverSide * this.stepOut;
    }
    this.object.rotation.y = this.yaw;
    this.object.updateMatrixWorld(true);
  }

  // ── perception (≤ 6 Hz)
  /** Sight segment: glass passes (re-cast ≤ 3 panes), every other collider (grating, doors, wreck boxes) blocks. */
  private sightLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const phys = this.world.ctx.physics;
    _d.copy(b).sub(a);
    let rem = _d.length();
    if (rem < 1e-3) return true;
    _d.multiplyScalar(1 / rem);
    _v3.copy(a);
    for (let k = 0; k <= T.sight.glass; k++) {
      const hit = phys.raycast(_v3, _d, Math.max(0, rem - 0.05));
      if (!hit) return true;
      if (hit.surface !== 'glass' || k === T.sight.glass) return false;
      _v3.copy(hit.point).addScaledVector(_d, 0.03);
      rem -= hit.distance + 0.03;
      if (rem <= 0.05) return true;
    }
    return false;
  }
  private readonly sightFn = (a: THREE.Vector3, b: THREE.Vector3) => this.sightLine(a, b);

  private inDark(p: THREE.Vector3): boolean {
    const boxes = this.world.ctx.level?.regions?.dark;
    if (!boxes) return false;
    for (const b of boxes) if (b.containsPoint(p)) return true;
    return false;
  }
  private playerChest(out: THREE.Vector3): THREE.Vector3 {
    const w = this.world, eh = w.playerEye.y - w.playerPos.y;
    return out.set(w.playerPos.x, w.playerPos.y + eh * 0.72, w.playerPos.z);
  }

  private sense(dt: number): void {
    this.senseT -= dt;
    if (this.senseT > 0) return;
    const tick = 1 / T.sight.rate;
    this.senseT = tick * (0.95 + this.world.rand() * 0.1);
    const w = this.world, pl = w.ctx.player;
    if (!w.playerAlive || !pl) { this.seesPlayer = false; this.visRaw = false; return; }
    const eye = this.rig.eye;
    const d = eye.distanceTo(w.playerEye);
    this.seenDist = d;
    const lit = this.dir!.lit;
    const darkOff = !lit && !pl.flashlightOn && this.inDark(w.playerPos);
    const range = darkOff ? T.sight.darkRange : T.sight.range;
    let vis = false;
    if (d <= T.sight.range + 2) {
      // one ray per tick: the eye, or the chest when the eye was blocked (both only right after losing sight)
      const tgt = this.sightChest ? this.playerChest(_pc) : w.playerEye;
      vis = this.sightLine(eye, tgt);
      if (!vis) {
        this.sightChest = !this.sightChest;
        if (this.visRaw) vis = this.sightLine(eye, this.sightChest ? this.playerChest(_pc) : w.playerEye);
      }
    }
    this.visRaw = vis;
    this.seesPlayer = vis && d <= range;
    const p = this.body.position;
    const toYaw = yawOf(w.playerPos.x - p.x, w.playerPos.z - p.z);
    const inCone = Math.abs(angleDiff(toYaw, this.yaw)) <= T.sight.cone;
    // the flashlight beam on him (within 25 m, ≤ 0.3 rad off the player's forward) for 0.5 s
    if (pl.flashlightOn && vis && d <= T.sight.beamRange) {
      _v.copy(this.rig.chest).sub(w.playerEye).normalize();
      if (_v.dot(pl.forward) >= Math.cos(T.sight.beamAngle)) { if (this.beamSince < 0) this.beamSince = w.time; } else this.beamSince = -1;
    } else this.beamSince = -1;
    const beamHeld = this.beamSince >= 0 && w.time - this.beamSince >= T.sight.beamHold - 1e-3;
    if (this.mode === 'hold') {
      if (this.seesPlayer && d <= T.hold.sees && (inCone || d < T.sight.close)) this.releaseHold('sees_close');
      return;
    }
    if (this.aware || this.mode !== 'idle') return;
    let notice = false;
    if (this.seesPlayer) {
      if (lit || d < T.sight.close) notice = true;
      else if (inCone) {
        if (darkOff) { if (this.darkSince < 0) this.darkSince = w.time; if (w.time - this.darkSince >= T.sight.darkHold - 1e-3) notice = true; }
        else notice = true;
      } else this.darkSince = -1;
    } else this.darkSince = -1;
    if (beamHeld) notice = true;
    if (notice) { this.log('notice', { d: +d.toFixed(2), lit, dark: darkOff, beam: beamHeld }); this.becomeAware(w.playerPos, true); }
  }

  // ── hold
  private tickHold(dt: number): void {
    const hw = this.holdWalk;
    if (hw) {
      this.target = hw.to; this.moveSpeed = hw.speed;
      const arrived = this.travel(dt, false);
      if (arrived) { this.target = null; this.holdWalk = null; hw.done(); }
    } else {
      this.moveGround(dt, 0, 0, 0, 8);
      this.rig.setMove(0, this.yaw);
    }
  }

  // ── aware: cover, firing, search, stand-off
  private tickAware(dt: number): void {
    const w = this.world, nav = w.nav, p = this.body.position;
    if (this.seesPlayer) {
      if (this.unseenT >= T.firstMissReset && !this.dbg.noFirstMiss) this.firstMiss = true;
      this.unseenT = 0;
      this.lastKnown.copy(w.playerPos); this.lastSeenT = w.time;
      if (this.mode === 'search') { this.mode = 'combat'; this.target = null; this.searchPhase = 0; this.coverTimer = 0.3; }
      this.searched = false;
    } else this.unseenT += dt;
    if (this.dbg.noFirstMiss) this.firstMiss = false;
    // stand-off at a crawl exit (the player on a nav:false floor)
    const so = nav.exitsAware ? nav.standOffNode(this.id, w.time, w.playerPos) : -1;
    if (so >= 0 && this.fire === 'none') {
      if (this.mode !== 'standoff' || this.standNode !== so) {
        this.mode = 'standoff'; this.standNode = so;
        this.leaveCover();
        this.target = nav.nodePos(so).clone(); this.targetCover = null; this.moveSpeed = T.walk;
        this.log('standoff', { node: so });
      }
    } else if (this.mode === 'standoff' && so < 0) {
      this.mode = 'combat'; this.standNode = -1; this.target = null; this.coverTimer = 0;
    }
    this.setState(this.staggerT > 0 ? 'stagger' : this.fire === 'rise' || this.fire === 'aim' || this.fire === 'burst' || this.fire === 'after' ? 'attack' : this.mode === 'search' ? 'alert' : 'chase');
    // the fire cycle runs first: nothing moves while it does. A reload is broken off when his point is flanked (he
    // moves, then reloads at the new point).
    this.tickFire(dt);
    if (this.fire === 'reload' && this.cover && !this.dbg.noMove) {
      this.checkT -= dt;
      if (this.checkT <= 0) {
        this.checkT = 0.25;
        if (!coverSafe(w, this.cover, this.threatEye(_pe), this.sightFn)) { this.fire = 'none'; this.log('reload_break', {}); this.chooseCoverNow(true); return; }
      }
    }
    if (this.fire === 'none' && !this.target && this.mag < T.burst[this.arms].n) { this.fire = 'reload'; this.fireT = 0; this.sound('soldier_reload', this.rig.chest, 0.9); this.log('reload', {}); }
    if (this.fire !== 'none' || this.staggerT > 0) { this.stand(dt); this.faceThreat(dt, 4); return; }
    if (this.mode === 'standoff') {
      if (this.target && this.travel(dt, true)) this.target = null;
      if (!this.target) { this.stand(dt); const ex = nav.standOffExit; if (ex) this.turnTo(yawOf(ex.x - p.x, ex.z - p.z), 3 * dt); }
      return;
    }
    if (this.mode === 'search') { this.tickSearch(dt); return; }
    // search: unseen 6 s and nothing better to do
    if (!this.dbg.noMove && !this.seesPlayer && !this.searched && w.time - this.lastSeenT > T.search.after && !this.target) {
      this.mode = 'search'; this.searchPhase = 1; this.leaveCover();
      this.target = this.lastKnown.clone(); this.moveSpeed = T.walk;
      this.log('search', { at: this.lastKnown.toArray().map((v) => +v.toFixed(2)) });
      return;
    }
    // moving to a cover point (or a sidestep)
    if (this.target) {
      if (this.travel(dt, true)) this.arrive();
      return;
    }
    this.stand(dt);
    // facing: the point's normal in cover, the threat in the open
    if (this.cover) this.turnTo(yawOf(this.cover.normal.x, this.cover.normal.z), 3 * dt);
    else this.faceThreat(dt, 3);
    if (this.dbg.noMove) return;
    // 2 Hz checks in place: peek sight / flanked (alternating), never in a husk's path
    this.checkT -= dt;
    let flanked = false;
    if (this.checkT <= 0) {
      this.checkT = 0.25;
      this.checkN++;
      const threatEye = this.threatEye(_pe);
      if (this.cover) {
        flanked = !coverSafe(w, this.cover, threatEye, this.sightFn);
        if (this.checkN % 2 === 0) this.peekSight = this.world.ctx.physics.lineOfSight(peekEye(this.cover, this.coverSide, _v2), w.playerEye);
      }
      this.flankedNow = flanked;
      this.huskPath();
    }
    // choose cover: on a timer, on suppression ≥ 1.0, after ≥ 40 damage in 3 s, when flanked — and RELOCATE (another
    // point, never this one) after 2–3 bursts from one point or when suppressed / hurt at it, so a long fight moves
    this.coverTimer -= dt;
    const supHigh = this.supp >= T.supp.move;
    const hurt = this.recentDamage() >= T.retreat.damage;
    this.retreating = this.supp >= T.retreat.supp || this.health < T.retreat.hp || hurt;
    const used = !!this.cover && this.burstsHere >= this.relocateAfter && this.fire === 'none';
    // pressed AT THIS POINT: suppressed / hurt after he has settled here (fire taken on the way in does not count)
    const settled = !this.cover || w.time - this.arrivedAt >= T.cover.settle;
    const hurtHere = this.recentDamage(this.cover ? this.arrivedAt : -1e9) >= T.retreat.damage;
    const pressed = settled && (supHigh || hurtHere) && !this.retreatedFor;
    if (this.coverTimer <= 0 || flanked || pressed || used) {
      if (supHigh || hurt) this.retreatedFor = true;
      this.coverTimer = T.cover.every[0] + this.world.rand() * (T.cover.every[1] - T.cover.every[0]);
      const moved = this.chooseCoverNow(flanked, !!this.cover && (used || pressed));
      // nowhere else to go: stay, and try again after the next burst
      if (used && !moved) this.burstsHere = this.relocateAfter - 1;
    }
    if (!supHigh && !hurt) this.retreatedFor = false;
  }
  private retreatedFor = false;
  private flankedNow = false;

  /** Damage taken in the last `retreat.window` s (only hits after `since`). */
  private recentDamage(since = -1e9): number {
    const t = this.world.time;
    while (this.recentHits.length && this.recentHits[0][0] < t - T.retreat.window) this.recentHits.shift();
    let s = 0;
    for (const [ht, d] of this.recentHits) if (ht >= since) s += d;
    return s;
  }
  private arrivedAt = -1e9;

  private threatEye(out: THREE.Vector3): THREE.Vector3 {
    const w = this.world;
    if (this.seesPlayer || w.time - this.lastSeenT < 0.5) return out.copy(w.playerEye);
    return out.set(this.lastKnown.x, this.lastKnown.y + 1.65, this.lastKnown.z);
  }

  private coverTried = false;
  /** Bursts fired from the current point, and after how many (2–3, drawn on arrival) he relocates. */
  private burstsHere = 0;
  private relocateAfter = 2;
  /** Choose a point (`relocate`: never the current one). True when he sets off for a new point. */
  private chooseCoverNow(flanked: boolean, relocate = false): boolean {
    const w = this.world;
    this.coverTried = true;
    const threatFeet = this.seesPlayer ? w.playerPos : this.lastKnown;
    const res = chooseCover(w, this.dir!, {
      id: this.id, set: this.coverSet, arms: this.arms, position: this.body.position, current: flanked || relocate ? null : this.cover,
      exclude: relocate || flanked ? this.cover?.id : undefined,
      recent: this.recent, threatEye: this.threatEye(_pe), threatFeet, retreat: this.retreating,
    }, this.sightFn);
    if (res && res.point === this.cover) { this.coverSide = res.side; return false; }
    if (res) {
      this.leaveCover();
      this.dir!.claim(res.point, this.id);
      this.targetCover = res.point; this.coverSide = res.side;
      this.target = res.point.position.clone();
      const closer = res.point.position.distanceTo(threatFeet) < this.body.position.distanceTo(threatFeet) - 0.5;
      this.moveSpeed = this.retreating ? T.retreatSpeed : (relocate || flanked) && !closer ? T.relocateSpeed : T.walk;
      this.log('cover_go', { cover: res.point.id, score: +res.score.toFixed(3), retreat: this.retreating, flanked, relocate });
      return true;
    }
    // nothing passes: keep a point that is still safe, else fight from here
    if (this.cover && !flanked) return false;
    if (this.cover) { this.leaveCover(); this.log('cover_lost', {}); }
    return false;
  }
  private leaveCover(): void {
    if (this.cover) this.dir!.leave(this.cover, this.id);
    if (this.targetCover) this.dir!.leave(this.targetCover, this.id);
    this.cover = null; this.targetCover = null;
  }
  private arrive(): void {
    this.target = null;
    if (this.targetCover) {
      this.cover = this.targetCover; this.targetCover = null;
      this.recent.push(this.cover.id); if (this.recent.length > 2) this.recent.shift();
      this.peekSight = false; this.checkT = 0; this.flankedNow = false;
      this.arrivedAt = this.world.time;
      this.burstsHere = 0; this.relocateAfter = T.cover.relocate[0] + Math.floor(this.world.rand() * (T.cover.relocate[1] - T.cover.relocate[0] + 1));
      this.log('cover_at', { cover: this.cover.id });
    }
  }

  /** Never stand in a husk's path: a hunting husk within 3 m whose line to the player passes within 0.8 m → step aside. */
  private huskPath(): void {
    const w = this.world, p = this.body.position;
    for (const e of w.enemies) {
      if (e === this || !e.alive || e.type !== 'husk' || !e.hunting) continue;
      const hx = e.position.x, hz = e.position.z;
      if (Math.hypot(hx - p.x, hz - p.z) > 3) continue;
      const ax = w.playerPos.x - hx, az = w.playerPos.z - hz, l2 = ax * ax + az * az;
      if (l2 < 1e-4) continue;
      const t = ((p.x - hx) * ax + (p.z - hz) * az) / l2;
      if (t <= 0 || t >= 1) continue;
      const lat = ((p.x - hx) * az - (p.z - hz) * ax) / Math.sqrt(l2);
      if (Math.abs(lat) > 0.8) continue;
      const s = lat >= 0 ? 1 : -1, l = Math.sqrt(l2);
      _v.set(p.x + (az / l) * 1.3 * s, p.y, p.z - (ax / l) * 1.3 * s);
      if (w.nav.walkable(p, _v, 0.35, w.nav.decks)) { this.leaveCover(); this.target = _v.clone(); this.moveSpeed = T.walk; this.log('yield', {}); }
      return;
    }
  }

  private tickSearch(dt: number): void {
    const w = this.world, p = this.body.position;
    if (this.searchPhase === 1) {
      if (!this.target) this.target = this.lastKnown.clone();
      const arrived = this.travel(dt, true) || Math.hypot(this.lastKnown.x - p.x, this.lastKnown.z - p.z) < 1.0;
      if (arrived) {
        // never look around in a doorway: carry on 1.6 m through it
        const door = this.nearDoor(p, 1.4);
        if (door && !this.searchThrough) {
          this.searchThrough = true;
          _v.copy(p).sub(this.lastPos).setY(0);
          if (_v.lengthSq() < 1e-4) _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
          _v.normalize().multiplyScalar(1.8).add(p);
          this.target = _v.clone();
          return;
        }
        this.target = null; this.searchPhase = 2; this.searchT = 0; this.searchYaw = this.yaw; this.searchThrough = false;
      }
      return;
    }
    this.stand(dt);
    this.searchT += dt;
    this.turnTo(this.searchYaw + Math.sin(this.searchT * 1.4) * 1.0, 2 * dt);
    if (this.searchT >= T.search.look) {
      this.searched = true; this.mode = 'combat'; this.searchPhase = 0; this.coverTimer = 0;
      this.log('search_end', {});
    }
  }
  private searchThrough = false;

  private nearDoor(p: THREE.Vector3, r: number): boolean {
    for (const d of this.world.ctx.level?.doors ?? []) {
      if (Math.hypot(d.position.x - p.x, d.position.z - p.z) < r && Math.abs((d.y ?? d.position.y) - p.y) < 2) return true;
    }
    return false;
  }

  /** Walk toward `target` (nav); true on arrival. Separation from other enemies (1.2 m); footsteps. */
  private travel(dt: number, aimWalk: boolean): boolean {
    const w = this.world, p = this.body.position, tgt = this.target!;
    const left = Math.hypot(tgt.x - p.x, tgt.z - p.z);
    if (left < 0.25 && Math.abs(tgt.y - p.y) < 1.0) { this.stand(dt); return true; }
    const ok = this.navigateTo(dt, tgt);
    if (!ok) { this.stand(dt); this.stuckT += dt; if (this.stuckT > 1.5) { this.stuckT = 0; this.target = null; if (this.targetCover) this.leaveCover(); this.coverTimer = 0.4; } return false; }
    let dx = this.waypoint.x - p.x, dz = this.waypoint.z - p.z;
    let l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    // separation: never within 1.2 m of another enemy
    for (const e of w.enemies) {
      if (e === this || !e.alive || !e.awake || Math.abs(e.position.y - p.y) > 1.5) continue;
      const ex = p.x - e.position.x, ez = p.z - e.position.z, d = Math.hypot(ex, ez);
      if (d < T.cover.separation && d > 1e-3) { const k = (T.cover.separation - d) / T.cover.separation; dx += (ex / d) * k * 1.4; dz += (ez / d) * k * 1.4; }
    }
    l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const speed = Math.min(this.moveSpeed, left * 2.2 + 0.3);
    this.moveGround(dt, dx, dz, speed, 6);
    const heading = yawOf(dx, dz);
    this.rig.setMove(Math.hypot(this.body.velocity.x, this.body.velocity.z), heading);
    if (aimWalk && this.aware && this.seesPlayer) this.faceThreat(dt, 3);
    else this.turnTo(heading, 3.5 * dt);
    // progress watchdog: no 0.3 m in 3 s → give up this goal
    this.stuckT += dt;
    if (this.stuckT > 3) {
      if (p.distanceTo(this.lastPos) < 0.3) { this.target = null; if (this.targetCover) this.leaveCover(); this.coverTimer = 0.4; this.log('stuck', {}); }
      this.stuckT = 0; this.lastPos.copy(p);
    }
    this.footsteps(dt);
    return false;
  }
  private stand(dt: number): void {
    this.moveGround(dt, 0, 0, 0, 8);
    this.rig.setMove(0, this.yaw);
  }
  private footsteps(dt: number): void {
    const v = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    this.stepAcc += v * dt;
    if (this.stepAcc < 0.75) return;
    this.stepAcc = 0;
    if (this.dist > 25 || this.isActor) return;
    this.stepN++;
    // audio plays `soldier_step` (deck / grate / wet by position) on the event — never here
    this.emit('enemy:step');
    if (this.stepN % 4 === 0) this.sound('gear_rattle', _v.copy(this.body.position).setY(this.body.position.y + 1.1), 0.5);
  }
  private turnTo(yaw: number, step: number): void {
    const d = angleDiff(yaw, this.yaw);
    this.yaw += Math.sign(d) * Math.min(Math.abs(d), step);
  }
  private faceThreat(dt: number, rate: number): void {
    const w = this.world, p = this.body.position;
    const tx = this.seesPlayer ? w.playerPos.x : this.lastKnown.x, tz = this.seesPlayer ? w.playerPos.z : this.lastKnown.z;
    this.turnTo(yawOf(tx - p.x, tz - p.z), rate * dt);
  }

  // ── the fire cycle (§8.2.5)
  private tickFire(dt: number): void {
    const w = this.world;
    switch (this.fire) {
      case 'none': {
        if (this.gapT > 0) this.gapT -= dt;
        if (this.canStartBurst()) this.startRise();
        break;
      }
      case 'rise':
        this.fireT += dt;
        if (this.fireT >= T.rise) { this.fire = 'aim'; this.fireT = 0; this.friendlyTries = 0; this.sound('soldier_aim_click', this.rig.muzzle, 0.9); this.log('aim', {}); }
        break;
      case 'aim':
        this.fireT += dt;
        if (this.fireT >= T.aim && this.flinchT <= 0) this.beginBurst();
        break;
      case 'burst':
        this.shotT -= dt;
        if (this.shotT <= 0 && this.flinchT <= 0) {
          this.shoot();
          if (this.fire !== 'burst') break;
          if (this.shotsLeft <= 0) this.endBurst();
        }
        break;
      case 'after':
        this.fireT += dt;
        if (this.fireT >= T.holdAfter) { this.fire = 'back'; this.fireT = 0; this.log('back', {}); }
        break;
      case 'back':
        this.fireT += dt;
        if (this.fireT >= T.back) this.endCycle();
        break;
      case 'reload':
        // the gap runs on through a reload (a reload is part of the pause between bursts, not added to it)
        if (this.gapT > 0) this.gapT -= dt;
        this.fireT += dt;
        if (this.fireT >= T.reload[this.arms].time) { this.mag = T.reload[this.arms].rounds; this.fire = 'none'; this.log('reloaded', {}); }
        break;
    }
    void w;
  }

  private canStartBurst(): boolean {
    const w = this.world;
    if (!this.aware || !w.playerAlive || this.mode === 'standoff' && !this.seesPlayer) return false;
    if (this.mode === 'search') return false;
    if (this.gapT > 0 || this.staggerT > 0 || this.target || this.mag <= 0) return false;
    // the first thing an aware soldier does is look for cover (where the level has any), not shoot from the open
    if (!this.cover && !this.coverTried && !this.dbg.noMove && (w.ctx.level?.cover?.length ?? 0) > 0) return false;
    if (this.supp >= T.supp.noPeek || w.time < this.peekBlockUntil) return false;
    // only at a recently known player (6 s) he can line up on: from the peek position in cover, by sight in the open
    if (w.time - this.lastSeenT > T.search.after) return false;
    // a flanked point is left first (within 1.5 s), not fired from
    if (this.cover && this.flankedNow && !this.dbg.noMove) return false;
    const can = this.cover && !this.dbg.aware ? this.peekSight : this.seesPlayer;
    if (!can) return false;
    return this.dir!.takeToken(this.id);
  }
  private startRise(): void {
    this.fire = 'rise'; this.fireT = 0;
    this.setLight(true);
    this.sound('soldier_light_on', this.rig.muzzle, 0.7);
    this.log('rise', { cover: this.cover?.id ?? null, h: this.cover?.height ?? 'open' });
  }
  private setLight(on: boolean): void {
    if (this.lightOn === on) return;
    this.lightOn = on;
    this.rig.setLight(on);
    this.log(on ? 'light_on' : 'light_off', {});
  }

  private beginBurst(): void {
    const w = this.world, phys = w.ctx.physics;
    const muz = this.rig.muzzle;
    this.playerChest(_pc);
    // a clear line (no glass) from the muzzle to the player: else stand down (the telegraph was honest)
    if (!this.seesPlayer || !(phys.lineOfSight(muz, _pc) || phys.lineOfSight(muz, w.playerEye))) { this.abort('noline'); return; }
    if (this.friendBlocks(muz, _pc)) {
      this.friendlyTries++;
      if (this.friendlyTries > T.friendly.tries) { this.abort('friendly'); return; }
      this.fireT = T.aim - T.friendly.wait;
      this.log('friendly_wait', {});
      return;
    }
    // partly visible: how many of 4 body-axis points the muzzle sees (sentry.ts heights, scaled for a crouch)
    const eh = w.playerEye.y - w.playerPos.y, k = eh / 1.65;
    let vis = 0;
    for (let i = 0; i < 4; i++) {
      _v.set(w.playerPos.x, w.playerPos.y + (0.3 + i * 0.42) * k, w.playerPos.z);
      if (phys.lineOfSight(muz, _v)) vis++;
    }
    if (vis === 0 && !phys.lineOfSight(muz, w.playerEye)) { this.abort('hidden'); return; }
    this.burstVis = Math.max(1, vis);
    this.fire = 'burst';
    this.shotsLeft = Math.min(T.burst[this.arms].n, this.mag);
    this.shotT = 0;
    this.bursts++;
    this.emitAttack('ranged');
    this.log('burst', { vis: this.burstVis, first: this.firstMiss });
  }
  private abort(why: string): void {
    this.fire = 'back'; this.fireT = 0;
    this.gapT = Math.max(this.gapT, 0.6);
    this.log('abort', { why });
  }
  private endBurst(): void {
    this.fire = 'after'; this.fireT = 0;
    this.firstMiss = false;
  }
  private endCycle(): void {
    this.setLight(false);
    this.dir!.dropToken(this.id);
    if (this.cover) this.burstsHere++;
    const [g0, g1] = T.gap[this.arms];
    this.gapT = this.dbg.gap ?? g0 + this.world.rand() * (g1 - g0);
    this.log('end', {});
    if (this.mag < T.burst[this.arms].n) {
      this.fire = 'reload'; this.fireT = 0;
      if (this.dist <= T.reload.audible) this.sound('soldier_reload', this.rig.chest, 0.9);
      this.log('reload', {});
      return;
    }
    this.fire = 'none';
    // no cover: sidestep 1–2 m between bursts
    if (!this.cover && !this.dbg.noMove && this.mode === 'combat') {
      const w = this.world, p = this.body.position;
      const ax = w.playerPos.x - p.x, az = w.playerPos.z - p.z, l = Math.hypot(ax, az) || 1;
      const s = w.rand() < 0.5 ? -1 : 1, len = 1 + w.rand();
      _v.set(p.x + (az / l) * len * s, p.y, p.z - (ax / l) * len * s);
      if (!this.nearDoor(_v, 1.4) && w.nav.walkable(p, _v, 0.35, w.nav.decks) && w.nav.walkable(p, _v, 1.0)) { this.target = _v.clone(); this.moveSpeed = T.walk; this.log('sidestep', {}); }
    }
  }
  /** Cancel the cycle at once (a heavy hit / head hit in rise or aim, a stagger in the burst, death). */
  private cancelCycle(why: string): void {
    if (this.fire === 'none' || this.fire === 'reload') return;
    this.setLight(false);
    this.dir?.dropToken(this.id);
    this.fire = 'none'; this.fireT = 0;
    this.gapT = Math.max(this.gapT, 0.9);
    this.log('cancel', { why });
  }

  /** Another enemy's capsule within 0.5 m of the shot line. */
  private friendBlocks(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const w = this.world;
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    if (l2 < 1e-4) return false;
    for (const e of w.enemies) {
      if (e === this || !e.alive) continue;
      const ex = e.position.x, ez = e.position.z;
      const t = ((ex - a.x) * dx + (ez - a.z) * dz) / l2;
      if (t <= 0.02 || t >= 0.98) continue;
      const lat = Math.abs((ex - a.x) * dz - (ez - a.z) * dx) / Math.sqrt(l2);
      if (lat > e.body.radius + T.friendly.clear) continue;
      const y = a.y + (b.y - a.y) * t;
      if (y < e.position.y - 0.2 || y > e.position.y + e.body.height + 0.3) continue;
      return true;
    }
    return false;
  }

  private shoot(): void {
    const w = this.world, phys = w.ctx.physics, pl = w.ctx.player;
    const muz = _v2.copy(this.rig.muzzle);
    this.playerChest(_pc);
    // never a hit on a player he cannot see: a clear line to the chest or the eye, else the burst stops
    if (!w.playerAlive || !(phys.lineOfSight(muz, _pc) || phys.lineOfSight(muz, w.playerEye))) { this.shotsLeft = 0; this.endBurst(); this.log('noline', {}); return; }
    if (this.friendBlocks(muz, _pc)) {
      this.friendlyTries++;
      if (this.friendlyTries > T.friendly.tries) { this.shotsLeft = 0; this.endBurst(); return; }
      this.shotT = T.friendly.wait;
      return;
    }
    const d = this.rig.eye.distanceTo(w.playerEye);
    const v = w.playerVel, ax = w.playerPos.x - this.body.position.x, az = w.playerPos.z - this.body.position.z, al = Math.hypot(ax, az) || 1;
    const crossing = Math.abs(v.x * (-az / al) + v.z * (ax / al));
    const speed = Math.hypot(v.x, v.z);
    const eh = w.playerEye.y - w.playerPos.y;
    const p = hitChance(d, { crossing, speed, visible: this.burstVis, crouched: eh < 1.3, supp: this.supp });
    const dmg = T.damage[this.arms];
    let hit = !this.firstMiss && w.rand() < p;
    let capped = false;
    if (hit && !this.dir!.allowHit(dmg)) { hit = false; capped = true; }
    this.shotsLeft--;
    this.shotT = T.burst[this.arms].interval;
    this.mag--;
    this.shots++;
    this.rig.fire();
    this.sound(this.arms === 'pistol' ? 'soldier_pistol_fire' : 'soldier_carbine_fire', muz, 1);
    const end = _end;
    let impact: Impact | null = null;
    if (hit) {
      end.copy(_pc).add(_v.set((w.rand() - 0.5) * 0.3, (w.rand() - 0.5) * 0.4, (w.rand() - 0.5) * 0.3));
      this.hits++;
      try { pl.damage(dmg, muz.clone()); } catch { /* player optional */ }
    } else {
      impact = this.missPoint(muz, end);
    }
    // order (W6): tracer → enemy:fired → bullet:impact (fx draws the impact, no light); never fx.sparks here
    if (this.arms === 'carbine') {
      try { (w.ctx.fx as unknown as { tracer?(a: THREE.Vector3, b: THREE.Vector3): void }).tracer?.(muz, end); } catch { /* fx optional (W6) */ }
    }
    w.ctx.events.emit('enemy:fired', { id: this.id, type: this.type, origin: muz.clone(), point: end.clone(), hit });
    if (impact) w.ctx.events.emit('bullet:impact', { point: end.clone(), normal: impact.normal.clone(), surface: impact.surface, owner: impact.owner });
    this.log('shot', { hit, capped, first: this.firstMiss, d: +d.toFixed(2), p: +p.toFixed(3), end: [+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2)] });
  }

  /**
   * A miss lands NEAR the player: the round goes to a point 0.4–1.2 m off his body axis (random side, a little high
   * or low) and hits whatever is there; if that ray would fly on far behind him, the round strikes the deck beside his
   * feet instead. A whiz (pistol) / crack (carbine) at the ray's closest point to his head when it passes within 2.5 m.
   */
  private missPoint(muz: THREE.Vector3, out: THREE.Vector3): Impact | null {
    const w = this.world, phys = w.ctx.physics, A = w.playerPos, M = T.miss;
    const eh = w.playerEye.y - A.y;
    let dx = A.x - muz.x, dz = A.z - muz.z;
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const sx = -dz, sz = dx;
    // up to 4 tries (body height, body height, the deck by his feet, head height); the first that lands in the band
    // wins, else the one that lands closest to him (never a round into the shooter's own cover if anything is better)
    let impact: Impact | null = null, bestErr = Infinity;
    const sgn0 = w.rand() < 0.5 ? -1 : 1;
    for (let k = 0; k < 4; k++) {
      const sgn = k % 2 ? -sgn0 : sgn0, off = M.min + w.rand() * (M.max - M.min);
      const h = k === 2 ? 0.03 : k === 3 ? eh + 0.2 : 0.15 + w.rand() * (eh + 0.25);
      const along = (w.rand() - 0.5) * 0.5;
      _aim.set(A.x + sx * off * sgn + dx * along, A.y + h, A.z + sz * off * sgn + dz * along);
      _d.copy(_aim).sub(muz);
      const len = _d.length();
      _d.multiplyScalar(1 / len);
      const hit = phys.raycast(muz, _d, len + (k === 2 ? 3 : 1.2));
      if (!hit) continue;
      const hd = Math.hypot(hit.point.x - A.x, hit.point.z - A.z);
      const near = hd >= M.min - 0.02 && hd <= M.band && hit.point.y >= A.y - 0.3 && hit.point.y <= A.y + eh + 0.8;
      const err = near ? 0 : hd < M.min ? M.min - hd : hd - M.band;
      if (err < bestErr) { bestErr = err; impact = hit; _end2.copy(_d); }
      if (near) break;
    }
    if (impact) _d.copy(_end2);
    if (impact) out.copy(impact.point);
    else out.copy(muz).addScaledVector(_d, 60);
    // the whiz / crack where it passes his head
    _v.copy(out).sub(muz);
    const segL = _v.length();
    _v.multiplyScalar(1 / (segL || 1));
    const t = THREE.MathUtils.clamp(_cl.copy(w.playerEye).sub(muz).dot(_v), 0, segL);
    _cl.copy(muz).addScaledVector(_v, t);
    const hd = _cl.distanceTo(w.playerEye);
    if (hd <= M.whiz) {
      this.sound(this.arms === 'pistol' ? 'bullet_whiz' : 'bullet_crack', _cl, 1);
      this.log('whiz', { d: +hd.toFixed(2) });
    }
    this.log('miss', { axis: +Math.hypot(out.x - A.x, out.z - A.z).toFixed(3), y: +(out.y - A.y).toFixed(2), impact: !!impact });
    return impact;
  }

  // ── pose / aim
  private setPose(p: SoldierPose): void {
    if (p === this.curPose) return;
    this.curPose = p;
    this.rig.setPose(p);
  }
  private choosePose(_dt: number): void {
    let p: SoldierPose;
    const low = this.cover?.height === 'low';
    const lean: SoldierPose = this.coverSide > 0 ? 'lean_r' : 'lean_l';
    if (this.mode === 'hold' || this.mode === 'idle') p = this.holdWalk ? 'walk' : 'hold';
    else if (this.staggerT > 0) p = 'stagger';
    else if (this.fire === 'rise') p = this.cover ? (low ? 'rise_aim' : lean) : 'aim';
    else if (this.fire === 'aim' || this.fire === 'burst' || this.fire === 'after') p = this.cover ? (low ? 'aim' : lean) : 'aim';
    else if (this.fire === 'reload') p = 'reload';
    else if (this.fire === 'back') p = this.cover && low ? 'crouch' : 'walk_aim';
    else if (this.target) p = 'walk_aim';
    else if (this.mode === 'standoff') p = 'aim';
    else if (this.cover) p = low ? 'crouch' : 'walk_aim';
    else p = 'walk_aim';
    if (this.flinchT > 0) return; // the flinch overlay plays; the pose is re-issued after it
    this.setPose(p);
  }
  private chooseAim(): void {
    const w = this.world;
    if (this.fire === 'rise' || this.fire === 'aim' || this.fire === 'burst' || this.fire === 'after') {
      w.playerEyeAgo(T.lag.seconds, _aim); _aim.y -= T.lag.drop;
      this.rig.aim(_aim);
    } else if (this.mode === 'hold') this.rig.aim(this.visRaw && this.seenDist <= T.sight.range ? w.playerEye : null);
    else if (this.mode === 'standoff') { const ex = w.nav.standOffExit; this.rig.aim(ex ? _aim.set(ex.x, ex.y + 0.6, ex.z) : null); }
    else if (this.aware && this.seesPlayer && this.fire !== 'reload') this.rig.aim(w.playerEye);
    else if (this.aware && this.fire !== 'reload' && (this.target || !this.cover || this.cover.height === 'high') && this.mode !== 'search') {
      // weapon up toward where the player was (moving cover to cover, standing at high cover) when that is in front
      // of him; else low ready
      const p = this.body.position;
      const toYaw = yawOf(this.lastKnown.x - p.x, this.lastKnown.z - p.z);
      if (Math.abs(angleDiff(toYaw, this.yaw)) < 1.4) this.rig.aim(_aim.set(this.lastKnown.x, this.lastKnown.y + 1.4, this.lastKnown.z));
      else this.rig.aim(null);
    } else this.rig.aim(null);
  }

  private sound(id: string, at: THREE.Vector3, volume: number): void {
    if (this.isActor) return;
    try { this.world.ctx.audio.play(id, { position: at.clone(), volume }); } catch { /* audio optional */ }
  }
  private log(ev: string, o: Record<string, unknown>): void {
    this.dir?.push({ t: +this.world.time.toFixed(4), id: this.id, ev, ...o });
  }

  // ───────────────────────────────────────────────────────── damage

  protected hitFx(b: HitBurst): void {
    const fx = this.world.ctx.fx, w = this.world;
    fx.smoke(b.point, { count: b.part === 'head' ? 2 : 3, size: 0.12, color: b.part === 'torso' ? 0x3a3d40 : 0x2a1c1c, rise: 0.15, life: 0.6 });
    this.sound('soldier_hit_vest', b.point, Math.min(1.2, 0.6 + b.amount / 40));
    if (b.part !== 'torso') {
      _v.copy(b.dir).normalize();
      const hit = w.ctx.physics.raycast(b.point, _v, 2.5);
      if (hit && hit.surface !== 'glass') fx.decal('blood_splat', hit.point, hit.normal, 0.3 + Math.min(0.3, b.amount / 100));
    }
  }

  applyDamage(vol: HitVolume, amount: number, point: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.alive || this.isActor) return;
    const w = this.world;
    // the plate carrier (torso ×0.8) is for bullets; buckshot from ≤ 6 m bites on every part (S3 / §5.3: 2 shells)
    const buck = w.ctx.player?.currentWeapon === 'shotgun' && point.distanceTo(w.playerEye) <= T.buckshot.range;
    const mult = buck ? T.buckshot.mult * (vol.part === 'head' ? T.mult.head : 1) : T.mult[vol.part] ?? 1;
    let dmg = amount * mult;
    // one shell (all its pellets land in one frame) never deals more than `shellMax`: no one-shell kill, even at contact
    if (buck) { dmg = Math.max(0, Math.min(dmg, T.buckshot.shellMax - this.frameBuck)); this.frameBuck += dmg; }
    this.health -= dmg;
    w.ctx.events.emit('enemy:damaged', { id: this.id, type: this.type, point, direction: dir, amount: dmg, part: vol.part });
    this.queueHit(vol, amount, point, dir);
    this.frameDmg += dmg;
    if (vol.part === 'head') this.frameHead = true;
    this.recentHits.push([w.time, dmg]);
    this.log('hit', { part: vol.part, dmg: +dmg.toFixed(2), hp: +this.health.toFixed(2) });
    if (this.health <= 0) { this.die(dir); return; }
    if (this.mode === 'hold') this.releaseHold('shot');
    if (!this.aware) this.becomeAware(w.playerPos, true);
    else { this.lastKnown.copy(w.playerPos); this.lastSeenT = w.time; }
    this._lastDir.copy(dir);
  }
  private _lastDir = new THREE.Vector3();

  /** One frame's hits as ONE hit (a shotgun shell): flinch always; ≥ 25 or a head hit cancels the rise / aim, staggers. */
  private reactToHit(): void {
    const dmg = this.frameDmg, head = this.frameHead;
    this.frameDmg = 0; this.frameHead = false; this.frameBuck = 0;
    if (!this.alive) return;
    const heavy = head || dmg >= T.cancelDamage;
    if (heavy && (this.fire === 'rise' || this.fire === 'aim')) this.cancelCycle(head ? 'head' : 'heavy');
    if (head || dmg >= T.staggerDamage) {
      if (this.fire === 'burst' || this.fire === 'after') this.cancelCycle('stagger');
      this.staggerT = T.stagger;
      this.body.velocity.addScaledVector(this._lastDir.setY(0), 1.2);
      this.log('stagger', { dmg: +dmg.toFixed(2), head });
    }
    this.flinchT = T.flinch;
    this.curPose = '';
    this.rig.setPose('flinch');
  }

  private die(dir: THREE.Vector3): void {
    if (!this.alive) return;
    const w = this.world;
    this.alive = false; this.health = 0;
    this.cancelCycle('dead');
    this.setLight(false);
    this.dir?.dropToken(this.id);
    this.leaveCover();
    this.target = null;
    if (this.holdWalk) { const d = this.holdWalk.done; this.holdWalk = null; d(); }
    this.mode = 'dying';
    this.setState('dead');
    // keyed by the hit direction against his facing: from the front → back, from behind → forward, else side
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const along = (dir.x * fx + dir.z * fz) / (Math.hypot(dir.x, dir.z) || 1);
    const kind = along < -0.5 ? 'back' : along > 0.5 ? 'fwd' : 'side';
    // the rig plays the Clasp's 'fail' pattern (3 fast blinks, 1.5 s) and then puts it out (rig.die)
    this.sound('clasp_fail', this.rig.nape, 0.6);
    this.diedAt = w.time;
    this.log('died', { kind });
    this.deathKind = kind;
    w.onDeath(this);
    this.body.velocity.set(0, this.body.velocity.y, 0);
    this.rig.die(kind, dir).then(() => this.settle(), () => this.settle());
  }
  deathKind: 'fwd' | 'back' | 'side' | '' = '';

  private settle(): void {
    if (this.mode !== 'dying') return;
    const w = this.world, p = this.body.position;
    this.mode = 'dead';
    this.settled = true;
    if (this.rig.led !== 'off') this.rig.setLed('off');
    // the body: the rig's box round the lying body, made the manager's walkable 0.15 m box (check:wreck)
    this.object.updateMatrixWorld(true);
    const box = this.rig.corpseBox(new THREE.Box3());
    box.min.y = p.y; box.max.y = p.y + 0.15;
    this.wreckBox = box;
    this.sound('soldier_fall', this.rig.chest, 0.9);
    this.dir?.addDrop(this.id, _v.set(this.rig.chest.x, p.y, this.rig.chest.z), this.arms);
    this.log('settled', { box: [box.min.toArray(), box.max.toArray()].map((a) => a.map((v) => +v.toFixed(2))) });
    void w;
  }

  override corpseChest(out: THREE.Vector3): THREE.Vector3 | null { return out.copy(this.rig.chest); }

  override dispose(): void {
    this.setLight(false);
    if (this.dir) { this.dir.unregister(this); this.dir.removeDrops(new Set([this.id])); }
    this.rig.dispose();
    super.dispose();
  }
  /** Facing at spawn (tests). */
  get spawnFacing(): number { return this.spawnYaw; }
}
