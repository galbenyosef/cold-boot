/**
 * The taken soldier's rig runtime (stage 3c §8.2.2, W3a): the interface the soldier AI (W3b, soldier.ts) and the
 * cutscene actor (actor.ts) drive, and its implementation on the template of model.ts.
 *
 * Fully procedural and layered, solved every frame (no clips):
 *   pose parameters (crouch, ready, lean, reload, flinch, stagger — timed eases, not springs, so a 0.35 s rise is
 *   0.35 s) → torso (aim yaw/pitch shared hips → spine → chest; breathing only, no fidget) → legs (world-PLANTED
 *   feet: a foot stays where it landed until the body has moved / turned away from it, then steps — walking,
 *   strafing, backing off and turning on the spot all come out of the same rule; kneeling is a fixed stance) →
 *   the weapon (placed from the shoulder pocket / the eyes per pose and blended) → the head (cheek on the stock by
 *   CCD when the carbine is shouldered, else tracking) → both arms by IK onto the weapon's grips, hands oriented on
 *   the grip axes, fingers closed (trigger finger along the frame until he aims).
 *
 * Conventions: `root` is his feet position; its local −Z is his front (game yaw: `root.rotation.y = yaw` faces
 * like the player at that yaw). The caller positions / turns `root` (or a parent of it) and calls `update(dt)` once
 * per frame AFTER moving it. Every world point (eye, muzzle, nape, chest) is valid after `update`.
 */
import * as THREE from 'three';
import type { GameContext, LightHandle, SoldierArms } from '../../core/types';
import { hv, type HitVolume } from '../shared/hit';
import { armIK, damp, noise1, smooth, solveLimb } from '../shared/ik';
import { blinkGlowMaterial, type Rig } from '../shared/rig';
import { GUN, SOLDIER_DIM as K, SOLDIER_NAMES, type SoldierTemplate } from './model';

// ───────────────────────────────────────────────────────────── the interface (plan §8.2.2, verbatim)

export type SoldierPose = 'hold' | 'walk' | 'walk_aim' | 'aim' | 'crouch' | 'rise_aim' | 'lean_l' | 'lean_r' | 'reload' | 'flinch' | 'stagger';
export interface SoldierRig {
  readonly root: THREE.Object3D; readonly drawCalls: number; readonly volumes: HitVolume[];   // head, torso, 4 limbs
  setPose(p: SoldierPose, blend?: number): void;       // procedural, blended (human.ts style); no clips
  setMove(speed: number, heading: number): void;       // leg IK; walk ≤ 1.6, retreat ≤ 3.0 m/s
  aim(p: THREE.Vector3 | null): void;                  // torso/arms/head toward p (±70° yaw, +35/−45° pitch); null = low ready
  readonly eye: THREE.Vector3; readonly muzzle: THREE.Vector3; readonly nape: THREE.Vector3; readonly chest: THREE.Vector3;  // world, per frame
  setLight(on: boolean): void;                         // weapon light (spot via ctx.render.lights, no shadow, prio 0.5, 14 m, 0.35 rad)
  setLed(s: 'red' | 'fail' | 'off'): void;            // the Clasp mark: 'red' blinks 1 Hz (every living state), 'fail' = 3 fast
                                                       // blinks then off (3b's theatre pattern); no cyan state exists
  fire(): void;                                        // muzzle flash (fx.flash 0.05 s), recoil kick, casing
  die(kind: 'fwd' | 'back' | 'side', dir: THREE.Vector3): Promise<void>;   // keyed fall 1.2–1.6 s, then still
  speak(seconds: number): void;                        // head/shoulder micro-motion (no jaw)
  lod(level: 0 | 1): void; dispose(): void;
}

/**
 * What this implementation adds (W3a → W3b; nothing above is renamed):
 *   update(dt)        — REQUIRED once per frame after the caller moved / turned `root` (the interface has no tick).
 *   lodRig            — the underlying Rig: hand it to `EnemyBase.lodRig` and the manager drives LOD (12 / 10 m) and
 *                       the room visibility exactly as for every other enemy (then never call `lod()`).
 *   pose / reloading / dead / settled / lightOn / led — read-back for tests and the AI.
 *   reloadDuration    — 2.4 s carbine, 1.8 s pistol (the timeline the 'reload' pose plays; it ends in low ready).
 *   corpseBox(out)    — world box round the lying body (the wreck box) once dead.
 *   setFacingLock     — none: the caller owns facing; the rig never turns `root`.
 */
export interface SoldierRigEx extends SoldierRig {
  update(dt: number): void;
  readonly lodRig: Rig;
  readonly pose: SoldierPose;
  readonly reloading: boolean;
  readonly reloadDuration: number;
  readonly dead: boolean;
  readonly settled: boolean;
  readonly lightOn: boolean;
  readonly led: 'red' | 'fail' | 'off';
  readonly arms: SoldierArms;
  corpseBox(out: THREE.Box3): THREE.Box3;
  /** Swap the name tape (actor prop 'name'). */
  setName(name: string): void;
}

export interface SoldierRigOpts {
  arms?: SoldierArms;
  /** Name tape (default: one of the 19 linked crew by seed). */
  name?: string;
  /** Per-soldier variation (blink phase, breathing); default random. */
  seed?: number;
  /**
   * The manager drives LOD through `lodRig` (EnemyBase.lodRig: 12 / 10 m, `forceLod`): the rig then only switches its
   * shadow proxy (≤ 15 m) itself. Default false (the dev page: the rig switches LOD by the camera distance).
   */
  managedLod?: boolean;
}

export function createSoldierRig(ctx: GameContext, tpl: SoldierTemplate, opts: SoldierRigOpts = {}): SoldierRigEx {
  return new SoldierRigImpl(ctx, tpl, opts);
}

// ───────────────────────────────────────────────────────────── scratch

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _fx = new THREE.Vector3(), _fy = new THREE.Vector3(), _fz = new THREE.Vector3();
const HIP_W = K.hipX + 0.016;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

interface Ease { v: number; from: number; to: number; t: number; dur: number }
const ease = (v: number): Ease => ({ v, from: v, to: v, t: 1, dur: 1 });
function easeTo(e: Ease, to: number, dur: number): void {
  if (Math.abs(e.to - to) < 1e-4 && e.t >= e.dur) return;
  if (Math.abs(e.to - to) < 1e-4) return;
  e.from = e.v; e.to = to; e.t = 0; e.dur = Math.max(0.01, dur);
}
function easeStep(e: Ease, dt: number): number {
  if (e.t < e.dur) { e.t = Math.min(e.dur, e.t + dt); e.v = e.from + (e.to - e.from) * smooth(e.t / e.dur); }
  else e.v = e.to;
  return e.v;
}

/** One gun pose in WORLD space. */
interface Frame { p: THREE.Vector3; q: THREE.Quaternion }
const frame = (): Frame => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() });
function mixFrame(out: Frame, a: Frame, b: Frame, k: number): Frame {
  out.p.copy(a.p).lerp(b.p, k); out.q.copy(a.q).slerp(b.q, k);
  return out;
}

interface Foot {
  plant: THREE.Vector3; fwd: THREE.Vector3;        // world: where it stands, which way it points
  from: THREE.Vector3; fromFwd: THREE.Vector3;
  swing: number;                                    // < 0 = planted; else 0..1 progress
  dur: number;
  pos: THREE.Vector3; pitch: number;                // this frame's ankle-ground point + toe pitch
  ground: number;
}

type DeathKind = 'fwd' | 'back' | 'side' | 'sit';
/** Death key pose: hips position (model, relative to the feet origin) + Euler XYZ per bone (local). */
interface DKey { t: number; hips: [number, number, number]; r: Record<string, [number, number, number]>; ease?: 'in' | 'out' | 'io' }

// ───────────────────────────────────────────────────────────── implementation

class SoldierRigImpl implements SoldierRigEx {
  readonly root = new THREE.Group();
  /** Model space (faces +Z) under the root (faces −Z); the death turn rotates it. */
  private readonly pivot = new THREE.Group();
  readonly lodRig: Rig;
  private readonly B: Record<string, THREE.Bone>;
  readonly volumes: HitVolume[];
  readonly eye = new THREE.Vector3();
  readonly muzzle = new THREE.Vector3();
  readonly nape = new THREE.Vector3();
  readonly chest = new THREE.Vector3();
  readonly arms: SoldierArms;
  private readonly G: typeof GUN.carbine;
  private readonly seed: number;
  private readonly glow: THREE.Material;
  private tapeMat: THREE.Material;
  private light: LightHandle | null = null;
  private t = 0;

  // pose state
  pose: SoldierPose = 'hold';
  private crouch = ease(0); private ready = ease(0); private lean = ease(0); private present = ease(0);
  private flinchT = -1; private staggerT = -1; private staggerSide = 1;
  private reloadT = -1;
  readonly reloadDuration: number;
  private recoil = 0; private recoilV = 0;
  private speakT = 0; private speakDur = 0;

  // aim
  private aimPt: THREE.Vector3 | null = null;
  private readonly aimBuf = new THREE.Vector3();
  private yawA = 0; private pitchA = 0; private yawV = 0; private pitchV = 0;

  // locomotion
  private readonly lastRoot = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private moveSpeed = 0; private moveHeading = 0;
  private feet: Foot[];
  private lastStep = 1; private sinceLand = 1;
  private bob = 0;
  private first = true;

  // marks / light
  led: 'red' | 'fail' | 'off' = 'red';
  private failT = -1;
  lightOn = false;
  private lodManual = false;

  // death
  dead = false; settled = false;
  private dKind: DeathKind = 'fwd'; private dT = 0; private dDur = 1.4; private dKeys: DKey[] = [];
  private dSnap: Float32Array; private dYaw0 = 0; private dYaw1 = 0; private dSide = 1;
  private dDone: (() => void) | null = null;
  private wDrop = { on: false, v: new THREE.Vector3(), w: new THREE.Vector3(), rest: false, floor: 0, restQ: new THREE.Quaternion(), restT: 0 };
  private magDrop = { on: false, v: new THREE.Vector3(), floor: 0, rest: false, p: new THREE.Vector3(), q: new THREE.Quaternion() };

  // frames (world)
  private readonly fLow = frame(); private readonly fAim = frame(); private readonly fCrouch = frame(); private readonly fReload = frame();
  private readonly fA = frame(); private readonly fB = frame(); private readonly fGun = frame();
  private readonly pivotQ = new THREE.Quaternion(); private readonly pivotQi = new THREE.Quaternion();

  constructor(private ctx: GameContext, private tpl: SoldierTemplate, opts: SoldierRigOpts) {
    this.seed = opts.seed ?? Math.random() * 1000;
    this.lodManual = !!opts.managedLod;
    this.arms = opts.arms ?? 'carbine';
    this.G = this.arms === 'pistol' ? GUN.pistol : GUN.carbine;
    this.reloadDuration = this.arms === 'pistol' ? 1.8 : 2.4;
    const name = opts.name ?? SOLDIER_NAMES[Math.floor(Math.abs(this.seed) * 7.31) % SOLDIER_NAMES.length];
    this.glow = blinkGlowMaterial((this.seed * 0.6180339) % 1);
    this.tapeMat = tpl.tape(name);
    this.lodRig = tpl.rig.instantiate({ glow: this.glow, tape: this.tapeMat });
    this.B = this.lodRig.byName;
    this.root.name = 'soldier';
    this.pivot.rotation.y = Math.PI;
    this.root.add(this.pivot);
    this.pivot.add(this.lodRig.root);
    this.lodRig.setKeysVisible([this.arms === 'pistol' ? 'gun_c' : 'gun_p'], false);
    this.dSnap = this.lodRig.newPose();
    const B = this.B;
    this.volumes = [
      hv(B.head, [0, 0.06, 0.0], [0, 0.11, 0.0], 0.13, 'head'),
      hv(B.spine2, [0, -0.12, 0.03], [0, 0.17, 0.02], 0.19, 'torso'),
      hv(B.hips, [0, -0.06, 0], [0, 0.1, 0], 0.17, 'torso'),
      hv(B.thigh_l, [0, 0, 0], [0, -0.42, 0], 0.085, 'limb', 'leg_l'), hv(B.thigh_r, [0, 0, 0], [0, -0.42, 0], 0.085, 'limb', 'leg_r'),
      hv(B.shin_l, [0, 0, 0], [0, -0.4, 0], 0.065, 'limb', 'leg_l'), hv(B.shin_r, [0, 0, 0], [0, -0.4, 0], 0.065, 'limb', 'leg_r'),
      hv(B.uarm_l, [0, 0, 0], [0, -0.28, 0], 0.055, 'limb', 'arm_l'), hv(B.uarm_r, [0, 0, 0], [0, -0.28, 0], 0.055, 'limb', 'arm_r'),
      hv(B.larm_l, [0, 0, 0], [0, -0.26, 0], 0.05, 'limb', 'arm_l'), hv(B.larm_r, [0, 0, 0], [0, -0.26, 0], 0.05, 'limb', 'arm_r'),
    ];
    const mkFoot = (): Foot => ({ plant: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1), from: new THREE.Vector3(), fromFwd: new THREE.Vector3(0, 0, -1), swing: -1, dur: 0.4, pos: new THREE.Vector3(), pitch: 0, ground: 0 });
    this.feet = [mkFoot(), mkFoot()];
    this.B.mk_light_c.scale.setScalar(1e-4); this.B.mk_light_p.scale.setScalar(1e-4);
    this.B.mk_clasp_f.scale.setScalar(1e-4);
    this.B.magDrop.scale.setScalar(1e-4); this.B.mag2.scale.setScalar(1e-4);
    try {
      this.light = ctx.render?.lights?.add({ type: 'spot', position: new THREE.Vector3(0, -500, 0), target: new THREE.Vector3(0, -501, 0), color: 0xfff1de, intensity: 42, distance: 14, angle: 0.35, penumbra: 0.45, castShadow: false, priority: 0.5, enabled: false }) ?? null;
    } catch { this.light = null; }
  }

  // ───────────────────────────────────────────── interface

  get drawCalls(): number {
    let n = 0;
    this.lodRig.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.visible && (m.material as THREE.Material).colorWrite !== false) n++; });
    if (this.lodRig.shadow && this.lodRig.shadow.castShadow) n++;
    return n;
  }
  get reloading(): boolean { return this.reloadT >= 0; }

  setPose(p: SoldierPose, blend?: number): void {
    if (this.dead) return;
    if (p === 'flinch') { this.flinchT = 0; return; }
    if (p === 'stagger') { this.staggerT = 0; this.staggerSide = noise1(this.t * 3.1, this.seed) >= 0 ? 1 : -1; return; }
    const prev = this.pose;
    this.pose = p;
    if (p === 'reload') { this.reloadT = 0; easeTo(this.ready, 0, blend ?? 0.25); return; }
    if (prev === 'reload' && this.reloadT >= 0) this.endReload();
    const D = (d: number) => blend ?? d;
    switch (p) {
      case 'hold': case 'walk': easeTo(this.crouch, 0, D(0.5)); easeTo(this.ready, 0, D(0.45)); easeTo(this.lean, 0, D(0.4)); break;
      case 'walk_aim': case 'aim': easeTo(this.crouch, 0, D(0.4)); easeTo(this.ready, 1, D(0.3)); easeTo(this.lean, 0, D(0.35)); break;
      case 'crouch': easeTo(this.crouch, 1, D(0.45)); easeTo(this.ready, 0, D(0.3)); easeTo(this.lean, 0, D(0.35)); break;
      case 'rise_aim': easeTo(this.crouch, 0, D(0.35)); easeTo(this.ready, 1, D(0.35)); easeTo(this.lean, 0, D(0.35)); break;
      case 'lean_l': easeTo(this.crouch, 0, D(0.35)); easeTo(this.ready, 1, D(0.35)); easeTo(this.lean, 1, D(0.35)); break;
      case 'lean_r': easeTo(this.crouch, 0, D(0.35)); easeTo(this.ready, 1, D(0.35)); easeTo(this.lean, -1, D(0.35)); break;
    }
  }

  setMove(speed: number, heading: number): void { this.moveSpeed = Math.max(0, speed); this.moveHeading = heading; }

  aim(p: THREE.Vector3 | null): void {
    if (p) { this.aimPt = this.aimBuf.copy(p); } else this.aimPt = null;
  }

  setLight(on: boolean): void {
    if (this.dead) on = false;
    this.lightOn = on;
    if (this.light) this.light.enabled = on;
  }

  setLed(s: 'red' | 'fail' | 'off'): void {
    if (s === 'fail' && (this.led === 'fail' || this.led === 'off')) { if (this.led === 'off') return; }
    if (s === 'fail' && this.led !== 'fail') this.failT = 0;
    this.led = s;
  }

  fire(): void {
    if (this.dead) return;
    this.recoilV += this.arms === 'pistol' ? 9 : 6;
    const fx = this.ctx.fx;
    // the fx module's keyed muzzle (one level-wide muzzle light that never strobes); a plain flash without it
    try {
      const mz = (fx as unknown as { muzzle?: (p: THREE.Vector3, d: THREE.Vector3, o?: { kind?: 'carbine' | 'pistol'; light?: boolean; scale?: number; smoke?: boolean }) => void } | undefined)?.muzzle;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.fGun.q);
      if (mz) mz.call(fx, this.muzzle.clone(), dir, { kind: this.arms });
      else fx?.flash(this.muzzle, 0xffc890, this.arms === 'pistol' ? 5 : 7, 0.05, 6);
    } catch { /* optional */ }
    // casing: from the ejection port, out to his right and up
    try {
      if (fx) {
        const ep = _v.set(this.arms === 'pistol' ? 0.014 : 0.022, this.arms === 'pistol' ? 0.026 : 0.05, this.arms === 'pistol' ? 0.0 : -0.062);
        this.gunToWorld(ep, _v2);
        _q.copy(this.fGun.q);
        const imp = _v3.set(1.6, 1.4, 0.3).applyQuaternion(_q);
        const m = new THREE.Mesh(casingGeo(this.arms), casingMat(this.ctx));
        m.position.copy(_v2);
        m.quaternion.copy(_q);
        fx.debris(_v2, imp, [m], 2.5);
      }
    } catch { /* optional */ }
  }

  die(kind: 'fwd' | 'back' | 'side', dir: THREE.Vector3): Promise<void> {
    if (this.dead) return Promise.resolve();
    this.dead = true;
    this.setLight(false);
    this.setLed('fail');
    this.reloadT = -1; this.flinchT = -1; this.staggerT = -1;
    this.lodRig.capture(this.dSnap);
    // fall direction: the hit pushes him; the fall turns ≤ 35° toward it (side: the roll side follows the push)
    this.pivot.updateMatrixWorld(true);
    const fwdW = _v.set(0, 0, 1).applyQuaternion(this.pivotWorldQ(_q)).setY(0).normalize();
    const leftW = _v2.set(1, 0, 0).applyQuaternion(_q).setY(0).normalize();
    const d = _v3.copy(dir).setY(0);
    if (d.lengthSq() < 1e-6) d.copy(fwdW).negate();
    d.normalize();
    let k: DeathKind = kind;
    this.dYaw0 = this.pivot.rotation.y;
    if (kind === 'fwd') {
      const a = Math.atan2(d.dot(leftW), d.dot(fwdW));
      this.dYaw1 = this.dYaw0 + clamp(a, -0.6, 0.6);
      this.dDur = 1.45;
    } else if (kind === 'back') {
      const a = Math.atan2(-d.dot(leftW), -d.dot(fwdW));
      this.dYaw1 = this.dYaw0 + clamp(a, -0.6, 0.6);
      // (IB5a) which way the body rolls as it lands: away from the push's side component (else his seed)
      const sd = d.dot(leftW);
      this.dSide = Math.abs(sd) > 0.15 ? (sd > 0 ? -1 : 1) : noise1(this.seed, 5) >= 0 ? 1 : -1;
      // cover close behind him? then he sits back against it
      const wall = this.wallBehind();
      if (wall >= 0) { k = 'sit'; this.dYaw1 = this.dYaw0; this.dWall = wall; }
      this.dDur = k === 'sit' ? 1.55 : 1.35;
    } else {
      this.dSide = d.dot(leftW) >= 0 ? 1 : -1;
      // he turns toward the push as he goes: a quarter turn
      this.dYaw1 = this.dYaw0 + this.dSide * 1.2;
      this.dDur = 1.55;
    }
    this.dKind = k;
    this.dKeys = deathKeys(k, this.dSide, this.dWall);
    this.dT = 0;
    // the weapon leaves the hands
    const rel = k === 'fwd' ? 0.22 : k === 'sit' ? 0.5 : 0.3;
    this.wRelease = rel;
    return new Promise<void>((res) => { this.dDone = res; });
  }
  private dWall = 0.6;
  /** Debug: distance (m) from the sighting eye to the carbine's sight line point (cheek weld miss). */
  sightErr = 0;
  /** Debug: that miss in model space (eye − sight point; +y = the eye is above the sight line). */
  readonly sightMiss = new THREE.Vector3();
  private wRelease = 0.25;

  setName(name: string): void {
    const m = this.tpl.tape(name);
    this.lodRig.root.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh && mesh.userData.key === 'tape') mesh.material = m; });
  }

  speak(seconds: number): void { this.speakT = Math.max(this.speakT, seconds); this.speakDur = this.speakT; }

  lod(level: 0 | 1): void { this.lodManual = true; this.lodRig.setLod(level); }

  dispose(): void {
    if (this.light) { this.light.remove(); this.light = null; }
    this.lodRig.skeleton.dispose();
    this.root.removeFromParent();
    this.glow.dispose();
  }

  /** Debug: key points in MODEL space (cm, rounded). */
  probe(): Record<string, number[]> {
    const inv = new THREE.Matrix4().copy(this.pivot.matrixWorld).invert();
    const r = (v: THREE.Vector3) => v.applyMatrix4(inv).toArray().map((x) => Math.round(x * 100));
    const B = this.B;
    return {
      butt: r(this.gunToWorld(this.G.butt, new THREE.Vector3())), grip: r(this.gunToWorld(this.G.grip, new THREE.Vector3())), fore: r(this.gunToWorld(this.G.fore, new THREE.Vector3())),
      eyeR: r(this.boneW('head', K.eyeR, new THREE.Vector3())), neck: r(B.neck.getWorldPosition(new THREE.Vector3())), head: r(B.head.getWorldPosition(new THREE.Vector3())),
      shR: r(B.uarm_r.getWorldPosition(new THREE.Vector3())), shL: r(B.uarm_l.getWorldPosition(new THREE.Vector3())),
      handR: r(B.hand_r.getWorldPosition(new THREE.Vector3())), handL: r(B.hand_l.getWorldPosition(new THREE.Vector3())),
      hips: r(B.hips.getWorldPosition(new THREE.Vector3())), sight: r(this.gunToWorld(new THREE.Vector3(0, 0.0955, 0.22), new THREE.Vector3())),
    };
  }

  corpseBox(out: THREE.Box3): THREE.Box3 {
    out.makeEmpty();
    for (const n of ['hips', 'spine2', 'head', 'foot_l', 'foot_r', 'larm_l', 'larm_r', 'shin_l', 'shin_r']) out.expandByPoint(this.B[n].getWorldPosition(_v));
    const fy = this.feet[0].ground;
    out.min.y = Math.min(out.min.y, fy); out.max.y = Math.max(out.min.y + 0.15, Math.min(out.max.y, out.min.y + 0.3));
    out.expandByVector(_v.set(0.12, 0, 0.12));
    return out;
  }

  // ───────────────────────────────────────────── frame helpers

  private pivotWorldQ(out: THREE.Quaternion): THREE.Quaternion { return out.setFromRotationMatrix(this.pivot.matrixWorld); }
  /** Model point → world. */
  private mw(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 { return out.set(x, y, z).applyMatrix4(this.pivot.matrixWorld); }
  /** A point given in model BIND space, carried by a bone (bind rotations are identity). */
  private boneW(bone: string, p: THREE.Vector3 | [number, number, number], out: THREE.Vector3): THREE.Vector3 {
    const b = this.B[bone];
    let bp = this.bindPos.get(bone);
    if (!bp) { const d = this.lodRig.template.bones[this.lodRig.bones.indexOf(b)]; bp = new THREE.Vector3().setFromMatrixPosition(d.bind); this.bindPos.set(bone, bp); }
    if (Array.isArray(p)) out.set(p[0] - bp.x, p[1] - bp.y, p[2] - bp.z); else out.copy(p).sub(bp);
    return out.applyMatrix4(b.matrixWorld);
  }
  private readonly bindPos = new Map<string, THREE.Vector3>();
  private gunToWorld(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 { return out.copy(p).applyQuaternion(this.fGun.q).add(this.fGun.p); }
  private rotE(b: THREE.Bone, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ'): void { b.quaternion.setFromEuler(_e.set(x, y, z, order)); }
  private mulE(b: THREE.Bone, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ'): void { b.quaternion.multiply(_q.setFromEuler(_e.set(x, y, z, order))); }
  /** Gun orientation: gun −Z along `dir`, gun +Y toward `up` (world), rolled by `roll` about the bore. */
  private gunQ(dir: THREE.Vector3, up: THREE.Vector3, roll: number, out: THREE.Quaternion): THREE.Quaternion {
    _fz.copy(dir).normalize().negate();
    _fx.copy(up).cross(_fz);
    if (_fx.lengthSq() < 1e-8) _fx.set(1, 0, 0);
    _fx.normalize();
    _fy.copy(_fz).cross(_fx);
    _m.makeBasis(_fx, _fy, _fz);
    out.setFromRotationMatrix(_m);
    if (roll) out.multiply(_q3.setFromAxisAngle(_v4.set(0, 0, 1), roll));
    return out;
  }
  /** Cast behind his back for cover he could sit against (distance from his feet, −1 = none within 0.8 m). */
  private wallBehind(): number {
    const ph = this.ctx.physics;
    if (!ph) return -1;
    const back = _v.set(0, 0, -1).applyQuaternion(this.pivotWorldQ(_q)).setY(0).normalize();
    let best = -1;
    for (const h of [0.45, 0.8]) {
      const o = _v2.copy(this.root.getWorldPosition(_v3)); o.y += h;
      let r: ReturnType<typeof ph.raycast> = null;
      try { r = ph.raycast(o, back, 0.8 + 0.15); } catch { r = null; }
      if (!r || r.distance > 0.8 + 0.15) return -1;
      best = Math.max(best, r.distance);
    }
    return best;
  }

  // ───────────────────────────────────────────── update

  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    this.root.updateMatrixWorld(true);
    this.pivotWorldQ(this.pivotQ); this.pivotQi.copy(this.pivotQ).invert();
    if (this.dead) this.tickDeath(dt);
    else this.tickLiving(dt);
    this.tickMarks(dt);
    this.tickPoints();
    this.tickLod();
  }

  private tickLod(): void {
    const cam = this.ctx.camera;
    if (!cam) return;
    const d = _v.setFromMatrixPosition(cam.matrixWorld).distanceTo(this.root.getWorldPosition(_v2));
    if (!this.lodManual) {
      if (this.lodRig.lod === 0 && d > 12) this.lodRig.setLod(1);
      else if (this.lodRig.lod === 1 && d < 10) this.lodRig.setLod(0);
    }
    this.lodRig.setShadow(d < 15);
  }

  private tickPoints(): void {
    const B = this.B;
    this.boneW('head', K.eyeMid, this.eye);
    this.boneW('neck', K.clasp, this.nape);
    this.boneW('spine2', K.chest, this.chest);
    this.gunFromBone();
    this.gunToWorld(this.G.muzzle, this.muzzle);
    if (this.light) {
      this.gunToWorld(this.G.light, this.light.position);
      this.light.position.addScaledVector(_v.set(0, 0, -1).applyQuaternion(this.fGun.q), 0.02);
      this.light.target.copy(this.light.position).addScaledVector(_v, 6);
    }
    void B;
  }
  /** The gun's world frame from the 'wpn' bone (after death the bone is the truth). */
  private gunFromBone(): void {
    const w = this.B.wpn;
    w.updateMatrixWorld(true);
    w.matrixWorld.decompose(this.fGun.p, this.fGun.q, _v);
  }

  private tickMarks(dt: number): void {
    const B = this.B;
    let on = 1e-4, fail = 1e-4;
    if (this.led === 'red') on = 1;
    else if (this.led === 'fail') {
      this.failT += dt;
      const ft = this.failT;
      if (ft >= 1.5) { this.led = 'off'; }
      else fail = (ft % 0.5) < 0.25 ? 1 : 1e-4;
    }
    // the 4 cm halo has a real size: hide it (CPU, by the bone's scale) unless the camera is behind his neck —
    // read within ±60° of behind, gone by ±90°, never peeking round the neck from the front
    const cam = this.ctx.camera;
    if (cam && (on > 1e-3 || fail > 1e-3)) {
      B.neck.updateMatrixWorld(true);
      const nrm = _v.set(0, 0.15, -1).normalize().transformDirection(B.neck.matrixWorld);
      const toCam = _v2.setFromMatrixPosition(cam.matrixWorld).sub(this.boneW('neck', K.clasp, _v3)).normalize();
      const k = smooth((nrm.dot(toCam) - 0.0) / 0.5);
      on *= k; fail *= k;
    }
    B.mk_clasp.scale.setScalar(Math.max(1e-4, on));
    B.mk_clasp_f.scale.setScalar(Math.max(1e-4, fail));
    const lit = this.lightOn ? 1 : 1e-4;
    B.mk_light_c.scale.setScalar(this.arms === 'carbine' ? lit : 1e-4);
    B.mk_light_p.scale.setScalar(this.arms === 'pistol' ? lit : 1e-4);
  }

  // ───────────────────────────────────────────── living

  private tickLiving(dt: number): void {
    const B = this.B;
    this.tickDrops(dt);
    // pose eases
    const crouch = easeStep(this.crouch, dt), lean = easeStep(this.lean, dt);
    const hasAim = !!this.aimPt;
    easeTo(this.present, hasAim ? 1 : 0, 0.3);
    const present = easeStep(this.present, dt);
    let ready = easeStep(this.ready, dt) * present;
    // reload timeline
    let rw = 0;
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      const T = this.reloadDuration;
      rw = smooth(this.reloadT / 0.3) * (1 - smooth((this.reloadT - (T - 0.35)) / 0.35));
      if (this.reloadT >= T) this.endReload();
    }
    // overlays
    let fl = 0, st = 0;
    if (this.flinchT >= 0) { this.flinchT += dt; const u = this.flinchT / 0.25; fl = u < 0.3 ? smooth(u / 0.3) : 1 - smooth((u - 0.3) / 0.7); if (u >= 1) this.flinchT = -1; }
    if (this.staggerT >= 0) { this.staggerT += dt; const u = this.staggerT / 0.6; st = u < 0.15 ? smooth(u / 0.15) : 1 - smooth((u - 0.35) / 0.65); if (u >= 1) this.staggerT = -1; }
    ready *= 1 - 0.55 * st - 0.2 * fl;
    // recoil spring
    this.recoilV += (-this.recoil * 420 - this.recoilV * 26) * dt;
    this.recoil += this.recoilV * dt;

    // aim angles (model space) — smooth, critically damped: a machine's even head turn
    let tYaw = 0, tPitch = 0;
    if (this.aimPt) {
      const pm = _v.copy(this.aimPt).applyMatrix4(_m.copy(this.pivot.matrixWorld).invert());
      const ox = 0, oy = 1.45 - 0.6 * crouch, oz = 0;
      const dx = pm.x - ox, dy = pm.y - oy, dz = pm.z - oz;
      tYaw = clamp(Math.atan2(dx, dz), -70 * Math.PI / 180, 70 * Math.PI / 180);
      tPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -45 * Math.PI / 180, 35 * Math.PI / 180);
    }
    const w = 2 * Math.PI * 1.6;
    this.yawV += (-(this.yawA - tYaw) * w * w - 2 * w * this.yawV) * dt;
    this.pitchV += (-(this.pitchA - tPitch) * w * w - 2 * w * this.pitchV) * dt;
    this.yawA += this.yawV * dt; this.pitchA += this.pitchV * dt;
    const yawA = this.yawA, pitchA = this.pitchA;

    // locomotion state (measured root motion — whatever the caller does)
    const rp = this.root.getWorldPosition(_v2);
    if (this.first) { this.lastRoot.copy(rp); this.resetFeet(); this.first = false; }
    if (rp.distanceTo(this.lastRoot) > 1.5) { this.resetFeet(); this.lastRoot.copy(rp); }
    if (dt > 0) {
      _v3.copy(rp).sub(this.lastRoot).multiplyScalar(1 / dt).setY(0);
      this.vel.lerp(_v3, 1 - Math.exp(-10 * dt));
    }
    this.lastRoot.copy(rp);
    const speed = this.vel.length();

    // ── torso
    this.resetBody();
    for (const n of ['wpn', 'mag', 'magDrop', 'mag2'] as const) B[n].scale.setScalar(1);
    B.magDrop.scale.setScalar(this.magDrop.on ? 1 : 1e-4);
    const br = Math.sin(this.t * Math.PI * 2 * 0.24 + this.seed);
    const walkK = clamp(speed / 1.2, 0, 1);
    const aimStance = ready;
    // shares of the aim yaw carried by hips / spine (the rest by the shoulders / head)
    const shY = lerp(0.3, 0.85, aimStance);
    const hipsY = lerp(0.948, 0.932, aimStance) - 0.02 * walkK;
    // a rifleman blades his body (support shoulder forward); the head stays square to the target
    const blade = this.arms === 'carbine' ? -0.42 * aimStance : -0.08 * aimStance;
    B.hips.position.set(0, hipsY, -0.035 * aimStance);
    // forward lean of a shooter (aggressive stance) + crouch-walk / kneel
    const leanF = 0.05 + (this.arms === 'pistol' ? 0.1 : 0.2) * aimStance;
    this.rotE(B.hips, leanF * 0.4, yawA * shY * 0.2 + blade * 0.45, 0, 'YXZ');
    this.rotE(B.spine1, leanF * 0.5 + br * 0.004 + Math.min(0, pitchA) * 0.12 * aimStance, yawA * shY * 0.35 + blade * 0.3, 0, 'YXZ');
    this.rotE(B.spine2, leanF * 0.5 + br * 0.01 + pitchA * 0.25 * aimStance - 0.03 * aimStance, yawA * shY * 0.45 + blade * 0.25, 0, 'YXZ');
    this.rotE(B.neck, 0.04, -blade * 0.45, 0, 'YXZ');
    this.rotE(B.head, -0.02, -blade * 0.55, 0, 'YXZ');
    // lean: hips shift to the side, spine rolls out (his left = +X)
    if (Math.abs(lean) > 1e-3) {
      B.hips.position.x += 0.13 * lean;
      this.mulE(B.spine1, 0, 0, -0.1 * lean);
      this.mulE(B.spine2, 0, 0, -0.16 * lean);
      this.mulE(B.neck, 0, 0, 0.12 * lean);
    }
    // kneel (crouch): right knee down, seated on the heel, hunched behind cover
    const kn = crouch * (1 - walkK);
    if (kn > 1e-3) {
      B.hips.position.y = lerp(B.hips.position.y, 0.47, kn);
      B.hips.position.z += -0.2 * kn;
      B.hips.position.x += 0.02 * kn;
      this.mulE(B.hips, 0.24 * kn, 0, 0);
      this.mulE(B.spine1, 0.36 * kn, 0, 0);
      this.mulE(B.spine2, 0.2 * kn * (1 - aimStance), 0, 0);
      this.mulE(B.neck, 0.1 * kn, 0, 0);
    }
    // crouch-walk (moving while crouched): knees bent, hips lower
    const cw = crouch * walkK;
    if (cw > 1e-3) { B.hips.position.y -= 0.18 * cw; this.mulE(B.spine1, 0.2 * cw, 0, 0); }
    // overlays: flinch (hunch, head ducks) / stagger (knocked back and twisted)
    if (fl > 0) { this.mulE(B.spine2, -0.1 * fl, 0, 0); this.mulE(B.neck, 0.18 * fl, 0, 0); this.rotE(B.clav_l, 0, 0, 0.12 * fl); this.rotE(B.clav_r, 0, 0, -0.12 * fl); }
    if (st > 0) {
      B.hips.position.z -= 0.07 * st;
      this.mulE(B.spine1, -0.14 * st, 0.12 * st * this.staggerSide, 0, 'YXZ');
      this.mulE(B.spine2, -0.2 * st, 0.22 * st * this.staggerSide, 0.06 * st * this.staggerSide, 'YXZ');
      this.mulE(B.neck, 0.15 * st, 0, 0);
    }
    // recoil: the shoulder takes it
    if (Math.abs(this.recoil) > 1e-4) this.mulE(B.spine2, -this.recoil * (this.arms === 'pistol' ? 0.15 : 0.3), 0, 0);
    // walk: a level upper body; a slight counter-rotation of the hips
    // ── legs (planted feet in world space)
    this.pivot.updateMatrixWorld(true);
    this.legs(dt, speed, crouch, lean, st, aimStance);
    this.pivot.updateMatrixWorld(true);

    // ── the weapon
    this.weapon(yawA, pitchA, ready, crouch, rw, st, fl);
    // ── head: tracking / cheek on the stock
    this.head(dt, yawA, pitchA, shY, ready, crouch);
    // ── arms onto the weapon
    this.armsOnGun(rw);
    // speech: small head / shoulder motion (no jaw — the balaclava)
    if (this.speakT > 0) {
      this.speakT -= dt;
      const env = smooth(Math.min(1, (this.speakDur - this.speakT) / 0.2)) * smooth(Math.min(1, this.speakT / 0.25));
      const syl = noise1(this.t * 6.5, this.seed + 7) * 0.5 + 0.5;
      this.mulE(B.head, (0.035 * syl - 0.012) * env, 0.02 * noise1(this.t * 1.3, this.seed + 3) * env, 0.012 * noise1(this.t * 1.7, this.seed + 5) * env);
      this.mulE(B.neck, 0.015 * syl * env, 0, 0);
      B.head.updateMatrixWorld(true);
    }
  }

  /** Bind pose for the body; the weapon and the magazines keep their own transforms (they are simulated). */
  private resetBody(): void {
    const defs = this.lodRig.template.bones, bs = this.lodRig.bones;
    for (let i = 0; i < defs.length; i++) {
      const n = defs[i].name;
      if (n === 'wpn' || n === 'mag' || n === 'magDrop' || n === 'mag2') continue;
      bs[i].quaternion.copy(defs[i].localQuat); bs[i].position.copy(defs[i].localPos); bs[i].scale.set(1, 1, 1);
    }
  }

  private endReload(): void {
    this.reloadT = -1;
    this.B.mag.scale.setScalar(1);
    this.B.mag2.scale.setScalar(1e-4);
  }

  private resetFeet(): void {
    const B = this.B;
    void B;
    this.pivot.updateMatrixWorld(true);
    const q = this.pivotWorldQ(_q);
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i], s = i === 0 ? 1 : -1;
      this.mw(s * HIP_W, 0, i === 0 ? 0.03 : -0.03, f.plant);
      f.fwd.set(Math.sin(s * 0.12), 0, Math.cos(s * 0.12)).applyQuaternion(q).setY(0).normalize();
      f.swing = -1; f.pos.copy(f.plant); f.pitch = 0; f.ground = f.plant.y;
    }
  }

  /** Planted-feet gait + kneel stance + leg IK. */
  private legs(dt: number, speed: number, crouch: number, lean: number, st: number, aimStance: number): void {
    const B = this.B, q = this.pivotQ;
    const moving = speed > 0.12;
    // step timing: a level, unhurried walk (≈ 0.46 s per step at 1.6 m/s)
    const Ts = clamp(0.58 - 0.11 * speed, 0.32, 0.56);
    const swingDur = Ts * (moving ? 0.82 : 0.75);
    const lift = moving ? 0.07 + 0.015 * Math.min(1, speed) : 0.05;
    const fwdW = _v.set(0, 0, 1).applyQuaternion(q).setY(0).normalize();
    // home positions: under the hips, led by the velocity (lands ahead so mid-stance is under him)
    const lead = 0.6 * Ts;
    const homes: THREE.Vector3[] = [_v3, _v4];
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const lx = s * (HIP_W + 0.02 * aimStance) + 0.13 * lean + (lean * s > 0 ? 0.12 * Math.abs(lean) : 0);
      // shooter's stance: support (left) foot a little forward, the firing side back
      const lz = (s > 0 ? 0.06 : -0.08) * aimStance + (s > 0 ? 0.03 : -0.03) * (1 - aimStance) - 0.12 * st;
      this.mw(lx, 0, lz, homes[i]).addScaledVector(this.vel, lead);
    }
    this.sinceLand += dt;
    const swinging = this.feet[0].swing >= 0 || this.feet[1].swing >= 0;
    if (!swinging && crouch < 0.5) {
      let pick = -1;
      if (moving) {
        if (this.sinceLand > Ts - swingDur) pick = 1 - this.lastStep;
      } else {
        let worst = 0.11;
        for (let i = 0; i < 2; i++) {
          const f = this.feet[i];
          const e = _v5.copy(f.plant).sub(homes[i]).setY(0).length() + 0.25 * Math.acos(clamp(f.fwd.dot(fwdW), -1, 1)) * (Math.acos(clamp(f.fwd.dot(fwdW), -1, 1)) > 0.4 ? 1 : 0);
          if (e > worst) { worst = e; pick = i; }
        }
      }
      if (pick >= 0) {
        const f = this.feet[pick];
        f.from.copy(f.plant); f.fromFwd.copy(f.fwd);
        f.swing = 0; f.dur = swingDur;
        this.lastStep = pick;
      }
    }
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i], s = i === 0 ? 1 : -1;
      if (f.swing >= 0) {
        f.swing = Math.min(1, f.swing + dt / f.dur);
        const u = f.swing, k = smooth(u);
        const toFwd = _v5.copy(fwdW).applyAxisAngle(Y, s * 0.1);
        f.pos.copy(f.from).lerp(homes[i], k);
        f.pos.y = lerp(f.from.y, f.ground, k) + Math.sin(Math.PI * u) * lift;
        f.fwd.copy(f.fromFwd).lerp(toFwd, k).normalize();
        // toe-off → swing → heel strike
        f.pitch = moving ? 0.35 * (1 - smooth(u / 0.4)) - 0.22 * smooth((u - 0.6) / 0.4) : 0.1 * Math.sin(Math.PI * u);
        if (u >= 1) {
          f.plant.copy(homes[i]); f.plant.y = f.ground; f.fwd.copy(toFwd); f.swing = -1; this.sinceLand = 0; f.pitch = 0;
          f.ground = this.groundAt(f.plant, f.ground);
          f.plant.y = f.ground;
        }
      } else {
        f.pos.copy(f.plant);
        // heel-to-toe in stance while walking: flat mid-stance, heel off at the end
        f.pitch = moving ? -0.12 * Math.max(0, 1 - this.sinceLand / 0.12) + 0.25 * smooth((this.sinceLand - Ts * 0.9) / (Ts * 0.4)) : 0;
      }
    }
    // hips bob / sway with the gait (small: he moves level)
    if (moving) {
      const sw = this.feet[0].swing >= 0 ? this.feet[0].swing : this.feet[1].swing >= 0 ? this.feet[1].swing : 1;
      this.bob = damp(this.bob, Math.sin(Math.PI * sw), 12, dt);
      B.hips.position.y += -0.012 + 0.012 * this.bob;
      const stanceSide = this.feet[0].swing >= 0 ? -1 : 1;
      B.hips.position.x += 0.012 * stanceSide * Math.min(1, speed);
    }
    // kneel stance targets (model space): left foot forward flat, right knee on the floor, toes tucked
    const kn = crouch * (1 - clamp(speed / 1.2, 0, 1));
    this.pivot.updateMatrixWorld(true);
    const hipsQ = _q2.setFromRotationMatrix(B.hips.matrixWorld);
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i], s = i === 0 ? 1 : -1, sfx = i === 0 ? 'l' : 'r';
      const hip = _v.setFromMatrixPosition(B['thigh_' + sfx].matrixWorld);
      // standing target: ankle over the plant (pitch lifts the ankle)
      const T = _v2.copy(f.pos); T.y += K.ankle + Math.abs(Math.sin(f.pitch)) * 0.03;
      const pole = _v5.copy(f.fwd).addScaledVector(_fx.set(1, 0, 0).applyQuaternion(this.pivotQ), s * 0.3).normalize();   // knees over the toes, a touch out (never knock-kneed)
      if (kn > 1e-3) {
        // kneel: left ankle (0.12, 0.075, 0.30); right: knee on the floor ahead of the hip, ankle behind, raised
        const kT = s > 0 ? this.mw(0.13, K.ankle, 0.3, _fy) : this.mw(-0.11, 0.3, -0.46, _fy);
        T.lerp(kT, kn);
        if (s < 0) pole.lerp(_fz.set(0, -0.35, 1).applyQuaternion(this.pivotQ).normalize(), kn).normalize();
      }
      const bend = solveLimb(hip, T, pole, hipsQ, K.thigh, K.shin, B['thigh_' + sfx], 1, _q);
      B['shin_' + sfx].quaternion.setFromAxisAngle(X, bend);
      // foot: world yaw of the plant, toe pitch; kneel: the right foot stands on its toes
      _q3.copy(_q).multiply(B['shin_' + sfx].quaternion).invert();
      const yaw = Math.atan2(f.fwd.x, f.fwd.z);
      let pitch = f.pitch;
      if (kn > 1e-3 && s < 0) pitch = lerp(pitch, 1.25, kn);
      _q.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
      B['foot_' + sfx].quaternion.copy(_q3).multiply(_q);
      B['thigh_' + sfx].updateMatrixWorld(true);
    }
  }

  private groundAt(p: THREE.Vector3, fallback: number): number {
    const ph = this.ctx.physics;
    if (!ph) return fallback;
    try {
      const o = _fz.set(p.x, this.lastRoot.y + 0.5, p.z);
      const h = ph.raycast(o, _fy.set(0, -1, 0), 1.0);
      if (h && Math.abs(h.point.y - this.lastRoot.y) < 0.35) return h.point.y;
    } catch { /* fallback */ }
    return this.lastRoot.y;
  }

  // ───────────────────────────────────────────── the weapon

  private weapon(yawA: number, pitchA: number, ready: number, crouch: number, rw: number, st: number, fl: number): void {
    const B = this.B, G = this.G, pistol = this.arms === 'pistol';
    const q = this.pivotQ;
    const fwdM = _v.set(Math.sin(yawA) * Math.cos(pitchA), Math.sin(pitchA), Math.cos(yawA) * Math.cos(pitchA));
    const aimDir = _v2.copy(fwdM).applyQuaternion(q).normalize();
    const up = Y;
    // chest frame (world) from spine2
    B.spine2.updateMatrixWorld(true);
    // (a) aimed
    if (pistol) {
      // isosceles: arms out, sights on the line from the eyes to the target
      const eye = this.boneW('head', K.eyeMid, _v3);
      this.fAim.p.copy(eye).addScaledVector(aimDir, 0.39);
      this.gunQ(aimDir, up, 0, this.fAim.q);
      this.fAim.p.sub(_v4.copy(G.sight).applyQuaternion(this.fAim.q)).addScaledVector(up, -0.012);
    } else {
      // butt in the right shoulder pocket (on the chest, moves with it), bore on the target
      // (inboard of the shoulder joint and high enough that the comb comes up under the cheek)
      const pocket = this.boneW('spine2', [CARB_POCKET[0], CARB_POCKET[1], CARB_POCKET[2]], _v3);
      this.gunQ(aimDir, up, -0.05, this.fAim.q);
      this.fAim.p.copy(pocket).sub(_v4.copy(G.butt).applyQuaternion(this.fAim.q));
    }
    // (b) low ready (standing): muzzle 45° down, a touch inboard; butt still in the shoulder / pistol at the belly
    {
      const d = _v4.set(Math.sin(yawA * 0.5) * 0.55 + 0.16, -0.82, Math.cos(yawA * 0.5) * 0.55).applyQuaternion(q).normalize();
      if (pistol) {
        const c = this.boneW('spine2', [-0.025, 1.2, 0.36], _v3);
        this.gunQ(d, up, 0, this.fLow.q);
        this.fLow.p.copy(c).sub(_v5.copy(G.grip).applyQuaternion(this.fLow.q));
      } else {
        const pocket = this.boneW('spine2', [-0.095, 1.37, 0.17], _v3);
        this.gunQ(d, up, -0.2, this.fLow.q);
        this.fLow.p.copy(pocket).sub(_v5.copy(G.butt).applyQuaternion(this.fLow.q));
      }
    }
    // (c) kneeling behind cover: carbine at high port (muzzle up, clear of his face), pistol close at the chest
    if (crouch > 1e-3) {
      if (pistol) {
        const d = _v4.set(0.05, -0.35, 0.94).applyQuaternion(q).normalize();
        const c = this.boneW('spine2', [-0.02, 1.22, 0.3], _v3);
        this.gunQ(d, up, 0, this.fCrouch.q);
        this.fCrouch.p.copy(c).sub(_v5.copy(G.grip).applyQuaternion(this.fCrouch.q));
      } else {
        const d = _v4.set(0.22, 0.9, 0.38).applyQuaternion(q).normalize();
        const c = this.boneW('spine2', [-0.07, 1.06, 0.3], _v3);
        const back = _fx.set(0, 0, -1).applyQuaternion(q);
        this.gunQ(d, back.negate(), 0, this.fCrouch.q);
        this.fCrouch.p.copy(c).sub(_v5.copy(G.grip).applyQuaternion(this.fCrouch.q));
      }
    }
    // (d) reload: in front of the chest, tilted so the well faces the support hand
    if (rw > 1e-3) {
      if (pistol) {
        const d = _v4.set(0.12, 0.45, 0.88).applyQuaternion(q).normalize();
        const c = this.boneW('spine2', [-0.02, 1.25, 0.3], _v3);
        this.gunQ(d, up, 0.25, this.fReload.q);
        this.fReload.p.copy(c).sub(_v5.copy(G.grip).applyQuaternion(this.fReload.q));
      } else {
        const d = _v4.set(0.22, -0.3, 0.93).applyQuaternion(q).normalize();
        const c = this.boneW('spine2', [-0.09, 1.22, 0.27], _v3);
        this.gunQ(d, up, -0.55, this.fReload.q);
        this.fReload.p.copy(c).sub(_v5.copy(G.grip).applyQuaternion(this.fReload.q));
      }
    }
    // blend: stand low ↔ crouch low by the crouch, then ↔ aimed by ready, then the reload frame
    if (crouch > 1e-3) mixFrame(this.fA, this.fLow, this.fCrouch, smooth(crouch));
    else { this.fA.p.copy(this.fLow.p); this.fA.q.copy(this.fLow.q); }
    mixFrame(this.fB, this.fA, this.fAim, smooth(ready));
    const g = this.fGun;
    if (rw > 1e-3) mixFrame(g, this.fB, this.fReload, rw);
    else { g.p.copy(this.fB.p); g.q.copy(this.fB.q); }
    // recoil: back along the bore + muzzle climb
    if (Math.abs(this.recoil) > 1e-4) {
      g.p.addScaledVector(_v4.set(0, 0, 1).applyQuaternion(g.q), this.recoil * (pistol ? 0.025 : 0.018));
      g.q.multiply(_q.setFromAxisAngle(X, this.recoil * (pistol ? 0.16 : 0.07)));
    }
    if (st > 0 || fl > 0) g.q.multiply(_q.setFromEuler(_e.set(0.25 * st + 0.08 * fl, 0.15 * st * this.staggerSide, 0)));
    this.setGunBone(g);
  }

  /** Write a world gun frame into the top-level 'wpn' bone (model space) and the seated magazine. */
  private setGunBone(g: Frame): void {
    const B = this.B;
    B.wpn.position.copy(g.p).applyMatrix4(_m.copy(this.pivot.matrixWorld).invert());
    B.wpn.quaternion.copy(this.pivotQi).multiply(g.q);
    B.mag.position.copy(B.wpn.position); B.mag.quaternion.copy(B.wpn.quaternion);
    B.wpn.updateMatrixWorld(true);
  }

  // ───────────────────────────────────────────── head

  private head(dt: number, yawA: number, pitchA: number, shY: number, ready: number, crouch: number): void {
    const B = this.B;
    void dt;
    // the rest of the aim yaw / pitch after the torso: neck 40 %, head 60 %
    const restY = yawA * (1 - shY), restP = pitchA * (1 - 0.25 * ready) + 0.68 * crouch * (1 - ready);   // kneeling: the head lifts against the hunched spine — eyes level, over the cover
    this.mulE(B.neck, -restP * 0.35, restY * 0.4, 0, 'YXZ');
    this.mulE(B.head, -restP * 0.55, restY * 0.6, 0, 'YXZ');
    B.neck.updateMatrixWorld(true);
    // carbine shouldered: cheek on the stock — the sighting (right) eye pulled onto the sight line, gaze along it
    const sight = this.arms === 'carbine' ? smooth(ready) : 0;
    if (sight > 1e-3) {
      const g = this.fGun;
      const target = _v3.copy(_v.set(0, 0.0955, 0.22)).applyQuaternion(g.q).add(g.p);
      const gaze = _v4.set(0, 0, -1).applyQuaternion(g.q);
      for (let it = 0; it < 3; it++) {
        const bone = B.neck;
        bone.updateMatrixWorld(true);
        const J = _v.setFromMatrixPosition(bone.matrixWorld);
        const E = this.boneW('head', K.eyeR, _v2);
        const da = _fx.copy(E).sub(J).normalize(), db = _fy.copy(target).sub(J).normalize();
        _q.setFromUnitVectors(da, db);
        const ang = 2 * Math.acos(Math.min(1, Math.abs(_q.w)));
        _q2.identity().slerp(_q, Math.min(0.8, 0.22 / Math.max(1e-4, ang)) * sight);
        const bw = _q3.setFromRotationMatrix(bone.matrixWorld).premultiply(_q2);
        const pw = _q.setFromRotationMatrix(bone.parent!.matrixWorld).invert();
        bone.quaternion.copy(pw.multiply(bw));
        bone.updateMatrixWorld(true);
        // the head keeps its gaze along the bore (and a slight cant onto the stock)
        this.headAlong(gaze, sight);
      }
      // what the neck could not reach, the gun gives: it slides to the eye (the butt leaves the pocket by that much)
      const miss = _v2.copy(this.boneW('head', K.eyeR, _v)).sub(target);
      // only the miss ACROSS the sight line counts (the eye may sit anywhere along it): sliding the gun along the bore
      // would push the butt off the shoulder and straighten the support arm
      miss.addScaledVector(gaze, -miss.dot(gaze));
      this.sightErr = miss.length();
      this.sightMiss.copy(miss).applyQuaternion(this.pivotQi);
      if (this.sightErr > 0.002) { this.fGun.p.addScaledVector(miss, sight); this.setGunBone(this.fGun); }
    }
  }
  /** Turn the head (world) so it looks along `gaze`, canted 9° onto the stock; blend `k`. */
  private headAlong(gaze: THREE.Vector3, k: number): void {
    const B = this.B;
    B.neck.updateMatrixWorld(true);
    const nq = _q.setFromRotationMatrix(B.neck.matrixWorld);
    // desired head world: model +Z → gaze, +Y → up, canted
    _fz.copy(gaze).normalize();
    _fx.copy(Y).cross(_fz).normalize();
    _fy.copy(_fz).cross(_fx);
    _m.makeBasis(_fx, _fy, _fz);
    _q2.setFromRotationMatrix(_m).multiply(_q3.setFromAxisAngle(_v5.set(0, 0, 1), -0.16)).multiply(_q3.setFromAxisAngle(X, 0.4));
    const cur = _q3.copy(nq).multiply(B.head.quaternion);
    cur.slerp(_q2, k);
    B.head.quaternion.copy(nq.invert().multiply(cur));
    B.head.updateMatrixWorld(true);
  }

  // ───────────────────────────────────────────── arms + hands

  /** Hand world rotation from a finger direction F and a palm normal P (world), for side (+1 left, −1 right). */
  private handQ(side: number, F: THREE.Vector3, P: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
    _fy.copy(F).normalize().negate();
    _fx.copy(P).multiplyScalar(-side);
    _fx.addScaledVector(_fy, -_fx.dot(_fy)).normalize();
    _fz.copy(_fx).cross(_fy);
    _m.makeBasis(_fx, _fy, _fz);
    return out.setFromRotationMatrix(_m);
  }

  /**
   * Put one hand on a grip: `grip` = world point the palm closes round, `hq` = the hand's world rotation. The wrist
   * target is the grip minus the palm offset (hand space), the elbow toward `pole`; then the hand rotation is set.
   */
  private reach(side: number, grip: THREE.Vector3, hq: THREE.Quaternion, pole: THREE.Vector3, palmOff: THREE.Vector3): void {
    const B = this.B, s = side > 0 ? 'l' : 'r';
    const uarm = B['uarm_' + s], larm = B['larm_' + s], hand = B['hand_' + s];
    B['clav_' + s].updateMatrixWorld(true);
    const S = _v.setFromMatrixPosition(uarm.matrixWorld);
    const T = _v2.copy(palmOff).applyQuaternion(hq);
    T.subVectors(grip, T);
    const pq = _q.setFromRotationMatrix(uarm.parent!.matrixWorld);
    const bend = armIK(S, T, pole, K.uarm, K.larm, pq, uarm);
    larm.quaternion.setFromAxisAngle(X, -bend);
    uarm.updateMatrixWorld(true);
    const lq = _q2.setFromRotationMatrix(larm.matrixWorld).invert();
    hand.quaternion.copy(lq.multiply(hq));
    hand.updateMatrixWorld(true);
  }
  private fingers(side: number, curl: number, trig: number, thumb: number): void {
    const B = this.B, s = side > 0 ? 'l' : 'r';
    B['fing_' + s].quaternion.setFromAxisAngle(_v.set(0, 0, 1), -side * curl);
    B['fing2_' + s].quaternion.setFromAxisAngle(_v.set(0, 0, 1), -side * curl * 1.1);
    B['trig_' + s].quaternion.setFromAxisAngle(_v.set(0, 0, 1), -side * trig);
    this.rotE(B['thumb_' + s], -thumb * 0.5, 0, -side * thumb * 0.7);
  }

  private armsOnGun(rw: number): void {
    const B = this.B, g = this.fGun, pistol = this.arms === 'pistol', q = this.pivotQ;
    const ready = this.ready.v * this.present.v;
    // shoulders: the firing shoulder comes forward into the stock, the support one forward under the gun
    const pro = pistol ? 0.1 * ready : 0.08 + 0.08 * ready;
    this.rotE(B.clav_r, 0, pro, -0.02);
    this.rotE(B.clav_l, 0, -pro * 0.7, 0.02);
    this.pivot.updateMatrixWorld(true);
    // gun axes (world)
    const gx = _v3.set(1, 0, 0).applyQuaternion(g.q), gy = _v4.set(0, 1, 0).applyQuaternion(g.q), gz = _v5.set(0, 0, 1).applyQuaternion(g.q);
    // ── firing hand on the grip: fingers forward-down round the front strap, palm on the grip's right side
    {
      const F = _fx.set(0, 0, 0).addScaledVector(gz, -0.78).addScaledVector(gy, pistol ? -0.55 : -0.6).addScaledVector(gx, -0.12);
      const P = _fy.set(0, 0, 0).addScaledVector(gx, -1).addScaledVector(gz, -0.15);
      const hq = this.handQ(-1, F.clone(), P.clone(), _q3);
      const grip = this.gunToWorld(this.G.grip, new THREE.Vector3());
      const pole = new THREE.Vector3(-0.55, -0.85, -0.1).applyQuaternion(q).normalize();
      this.reach(-1, grip, hq.clone(), pole, PALM_R);
      const aimTrig = ready > 0.7 && this.reloadT < 0 ? 0.55 : 0.08;
      this.fingers(-1, 1.45, aimTrig, 0.95);
    }
    // ── support hand
    {
      let grip: THREE.Vector3, hq: THREE.Quaternion, pole: THREE.Vector3, curl = 1.25, thumb = 0.7;
      if (pistol) {
        // wraps the firing hand: palm on the grip's left side, fingers over the right hand's
        const F = new THREE.Vector3().addScaledVector(gz, -0.7).addScaledVector(gy, -0.5).addScaledVector(gx, 0.45);
        const P = new THREE.Vector3().addScaledVector(gx, 1).addScaledVector(gy, 0.2);
        hq = this.handQ(1, F, P, new THREE.Quaternion());
        grip = this.gunToWorld(_fz.set(-0.03, -0.055, 0.02), new THREE.Vector3());
        pole = new THREE.Vector3(0.6, -0.8, -0.1).applyQuaternion(q).normalize();
        curl = 1.35;
      } else {
        // under the fore-end: palm up against it, fingers round its right side, thumb along the left
        const F = new THREE.Vector3().addScaledVector(gx, 0.62).addScaledVector(gy, 0.3).addScaledVector(gz, -0.72);
        const P = new THREE.Vector3().addScaledVector(gy, 1).addScaledVector(gx, 0.3);
        hq = this.handQ(1, F, P, new THREE.Quaternion());
        grip = this.gunToWorld(this.G.fore, new THREE.Vector3());
        pole = new THREE.Vector3(0.35, -0.93, -0.1).applyQuaternion(q).normalize();
      }
      // reload: the support hand runs the timeline (old mag out → pouch → new mag in → charging handle / slide)
      if (this.reloadT >= 0) {
        const r = this.reloadHand(grip, hq);
        grip = r.grip; hq = r.hq; curl = r.curl; thumb = r.thumb;
      }
      this.reach(1, grip, hq, pole, PALM_L);
      this.fingers(1, curl, curl, thumb);
    }
    void rw;
  }

  /**
   * The support hand's reload path (gun already in the reload frame) and the three magazines. Returns where the hand
   * goes this frame. Carbine 2.4 s / pistol 1.8 s.
   */
  private reloadHand(home: THREE.Vector3, homeQ: THREE.Quaternion): { grip: THREE.Vector3; hq: THREE.Quaternion; curl: number; thumb: number } {
    const B = this.B, t = this.reloadT, pistol = this.arms === 'pistol', G = this.G, g = this.fGun;
    const T = pistol
      ? { grab: 0.2, out: 0.3, pouch: 0.7, well: 1.05, seat: 1.2, ch: 1.35, chPull: 1.5, back: 1.8 }
      : { grab: 0.4, out: 0.6, pouch: 1.05, well: 1.5, seat: 1.65, ch: 1.85, chPull: 2.0, back: 2.4 };
    const gy = _v4.set(0, 1, 0).applyQuaternion(g.q);
    const magAt = (dy: number, out: THREE.Vector3) => this.gunToWorld(_fz.copy(G.magSeat).addScaledVector(_fy.set(0, -1, 0), G.magLen * 0.55 - dy), out);
    // hand frames: on the mag (palm round it from below/the left), on the pouch, on the charging handle / slide
    const onMag = this.handQ(1, _fx.set(0, 0, 0).addScaledVector(_v5.set(0, 0, -1).applyQuaternion(g.q), 0.6).addScaledVector(gy, 0.75), _v.set(0, 0, 0).addScaledVector(_v2.set(1, 0, 0).applyQuaternion(g.q), 1), new THREE.Quaternion());
    const pouch = this.boneW('spine2', K.pouch, new THREE.Vector3());
    const fwdW = new THREE.Vector3(0, 0, 1).applyQuaternion(this.pivotQ);
    const onPouch = this.handQ(1, new THREE.Vector3(0, -1, 0).addScaledVector(fwdW, 0.3), fwdW.clone().negate(), new THREE.Quaternion());
    const chW = this.gunToWorld(G.charger, new THREE.Vector3());
    const onCh = pistol
      ? this.handQ(1, new THREE.Vector3(1, 0, 0).applyQuaternion(g.q).addScaledVector(gy, -0.3), gy.clone().negate(), new THREE.Quaternion())
      : this.handQ(1, new THREE.Vector3(0, 0, -1).applyQuaternion(g.q).addScaledVector(gy, -0.2), new THREE.Vector3(1, 0, 0).applyQuaternion(g.q), new THREE.Quaternion());
    const grip = new THREE.Vector3(), hq = new THREE.Quaternion();
    let curl = 1.2, thumb = 0.7;
    const seg = (a: number, b: number) => smooth((t - a) / (b - a));
    // the seated mag stays until it is pulled; the fresh one rides the hand from the pouch into the well
    const magOld = B.mag, magNew = B.mag2;
    if (t < T.grab) {
      grip.copy(home).lerp(magAt(0, _v), seg(0.05, T.grab)); hq.copy(homeQ).slerp(onMag, seg(0.05, T.grab));
    } else if (t < T.out) {
      // strip it: hand pulls the old mag down out of the well, then lets go (it falls)
      const k = seg(T.grab, T.out);
      magAt(-0.06 * k, grip); hq.copy(onMag); curl = 1.0;
      if (pistol) { /* the pistol's mag drops free by itself at grab */ }
      this.placeMagAlongWell(magOld, -0.06 * k);
    } else if (t < T.pouch) {
      if (!this.magDrop.on) this.dropMag();
      magOld.scale.setScalar(1e-4);
      const k = seg(T.out, T.pouch - 0.08);
      grip.copy(magAt(-0.06, _v)).lerp(pouch, k); hq.copy(onMag).slerp(onPouch, k); curl = 0.6 + 0.6 * k;
      if (t > T.pouch - 0.1) { magNew.scale.setScalar(1); this.placeMagInHand(magNew, grip, hq, 0); }
    } else if (t < T.well) {
      magOld.scale.setScalar(1e-4); magNew.scale.setScalar(1);
      const k = seg(T.pouch, T.well);
      grip.copy(pouch).lerp(magAt(-0.07, _v), k); hq.copy(onPouch).slerp(onMag, k);
      // the magazine travels with the hand: from upright in the pouch to under the well
      this.placeMagTravel(magNew, k, pouch, -0.07);
    } else if (t < T.seat) {
      magOld.scale.setScalar(1e-4); magNew.scale.setScalar(1);
      const k = seg(T.well, T.seat);
      magAt(-0.07 * (1 - k), grip); hq.copy(onMag);
      this.placeMagAlongWell(magNew, -0.07 * (1 - k));
    } else if (t < T.chPull) {
      magNew.scale.setScalar(1e-4); magOld.scale.setScalar(1);
      if (t < T.ch) { const k = seg(T.seat, T.ch); grip.copy(magAt(0, _v)).lerp(chW, k); hq.copy(onMag).slerp(onCh, k); curl = 1.1; }
      else {
        // pull the charging handle (carbine) / rack the slide (pistol) back and let it go
        const k = seg(T.ch, T.chPull);
        grip.copy(chW).addScaledVector(_v.set(0, 0, 1).applyQuaternion(g.q), (pistol ? 0.035 : 0.07) * Math.sin(Math.PI * k)); hq.copy(onCh); curl = 1.45; thumb = 1.0;
      }
    } else {
      magNew.scale.setScalar(1e-4); magOld.scale.setScalar(1);
      const k = seg(T.chPull, T.back - 0.05);
      grip.copy(chW).lerp(home, k); hq.copy(onCh).slerp(homeQ, k);
    }
    return { grip, hq, curl, thumb };
  }
  /** A magazine bone seated in the well, shifted `dy` along the well axis (negative = out). */
  private placeMagAlongWell(bone: THREE.Bone, dy: number): void {
    const B = this.B;
    bone.position.copy(B.wpn.position).add(_v.set(0, dy, 0).applyQuaternion(B.wpn.quaternion));
    bone.quaternion.copy(B.wpn.quaternion);
  }
  /** The fresh magazine between the pouch (upright, k 0) and below the well (k 1). */
  private placeMagTravel(bone: THREE.Bone, k: number, pouch: THREE.Vector3, dy: number): void {
    const B = this.B;
    // seated-in-well pose shifted out by dy (model space)
    const pWell = _v.copy(B.wpn.position).add(_v2.set(0, dy, 0).applyQuaternion(B.wpn.quaternion));
    const qWell = _q.copy(B.wpn.quaternion);
    // in the pouch: magazine upright, its seat point at the pouch mouth (model space)
    const pm = _v3.copy(pouch).applyMatrix4(_m.copy(this.pivot.matrixWorld).invert());
    const qP = _q2.identity().multiply(_q3.setFromAxisAngle(Y, Math.PI));
    const seat = _v4.copy(this.G.magSeat).applyQuaternion(qP);
    const pPouch = pm.sub(seat).add(_v5.set(0, this.G.magLen * 0.35, 0));
    bone.position.copy(pPouch).lerp(pWell, k);
    bone.quaternion.copy(qP).slerp(qWell, k);
  }
  private placeMagInHand(bone: THREE.Bone, _grip: THREE.Vector3, _hq: THREE.Quaternion, _k: number): void {
    this.placeMagTravel(bone, 0, this.boneW('spine2', K.pouch, new THREE.Vector3()), -0.07);
  }
  /** The old magazine leaves the well and falls (it lies where it lands until the next reload). */
  private dropMag(): void {
    const B = this.B, md = this.magDrop;
    md.on = true; md.rest = false;
    B.magDrop.position.copy(B.mag.position); B.magDrop.quaternion.copy(B.mag.quaternion);
    B.magDrop.scale.setScalar(1);
    md.v.set(0.15, -0.6, 0.25); // model space
    md.floor = 0.012;
  }

  // ───────────────────────────────────────────── death

  private tickDeath(dt: number): void {
    const B = this.B;
    this.tickDrops(dt);
    if (this.settled) return;
    this.dT += dt;
    const t = this.dT;
    // the fall turn (pivot)
    const turnK = smooth(t / (this.dKind === 'side' ? 0.8 : 0.6));
    this.pivot.rotation.y = this.dYaw0 + (this.dYaw1 - this.dYaw0) * turnK;
    this.pivot.updateMatrixWorld(true);
    this.resetBody();
    // keyed body
    const keys = this.dKeys;
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1];
    let u = clamp((t - a.t) / (b.t - a.t), 0, 1);
    const ez = b.ease ?? 'io';
    u = ez === 'in' ? u * u : ez === 'out' ? 1 - (1 - u) * (1 - u) : smooth(u);
    B.hips.position.set(lerp(a.hips[0], b.hips[0], u), lerp(a.hips[1], b.hips[1], u), lerp(a.hips[2], b.hips[2], u));
    for (const n of DBONES) {
      const ra = a.r[n] ?? ZERO3, rb = b.r[n] ?? ZERO3;
      _q.setFromEuler(_e.set(ra[0], ra[1], ra[2], 'XYZ'));
      _q2.setFromEuler(_e.set(rb[0], rb[1], rb[2], 'XYZ'));
      B[n].quaternion.copy(_q).slerp(_q2, u);
    }
    // fingers go slack
    for (const s of ['l', 'r']) { B['fing_' + s].quaternion.setFromAxisAngle(_v.set(0, 0, 1), (s === 'l' ? -1 : 1) * 0.45); B['fing2_' + s].quaternion.setFromAxisAngle(_v, (s === 'l' ? -1 : 1) * 0.4); }
    // blend in from the pose he was in
    const kin = smooth(t / 0.28);
    if (kin < 1) this.lodRig.blendTo(this.dSnap, 1 - kin);
    for (const n of ['wpn', 'mag', 'magDrop', 'mag2'] as const) this.B[n].scale.setScalar(n === 'wpn' || n === 'mag' ? 1 : n === 'magDrop' && this.magDrop.on ? 1 : 1e-4);
    // the weapon: in the hand until released, then falls
    if (!this.wDrop.on) {
      if (t >= this.wRelease) this.releaseWeapon();
      else {
        // keep it in the firing hand: re-place from the hand's current frame
        this.restoreGunFromSnap();
      }
    }
    this.pivot.updateMatrixWorld(true);
    if (t >= this.dDur) {
      this.settled = true;
      const d = this.dDone; this.dDone = null;
      if (d) d();
    }
  }
  private restoreGunFromSnap(): void {
    // the gun bone's local transform is in the snapshot (top-level bone, model space) — follow the right hand from it
    const B = this.B;
    B.hand_r.updateMatrixWorld(true);
    if (!this.gunInHand) {
      // gun relative to the right hand, captured once at death
      this.gunInHand = new THREE.Matrix4().copy(B.hand_r.matrixWorld).invert().multiply(B.wpn.matrixWorld);
    }
    _m.multiplyMatrices(B.hand_r.matrixWorld, this.gunInHand);
    _m.decompose(this.fGun.p, this.fGun.q, _v);
    this.setGunBone(this.fGun);
  }
  private gunInHand: THREE.Matrix4 | null = null;

  private releaseWeapon(): void {
    const wd = this.wDrop;
    wd.on = true; wd.rest = false;
    this.gunFromBone();
    const fwdM = _v.set(0, 0, 1);
    wd.v.copy(fwdM).multiplyScalar(0.45).add(_v2.set(-0.85, 0.35, 0));  // model space velocity: out to his right, clear of the body
    wd.w.set(2.5 * (noise1(this.seed, 1) + 0.3), 1.5 * noise1(this.seed, 2), 3 * noise1(this.seed, 3));
    wd.floor = 0.03;
  }
  private tickDrops(dt: number): void {
    const B = this.B, wd = this.wDrop;
    if (wd.on && !wd.rest) {
      const w = B.wpn;
      wd.v.y -= 9.8 * dt;
      w.position.addScaledVector(wd.v, dt);
      _q.setFromEuler(_e.set(wd.w.x * dt, wd.w.y * dt, wd.w.z * dt));
      w.quaternion.multiply(_q);
      const lowest = this.arms === 'pistol' ? 0.02 : 0.03;
      if (w.position.y <= lowest + 0.0) {
        w.position.y = lowest;
        wd.rest = true; wd.restT = 0;
        // lie on its side, keeping its heading
        const fz = _v.set(0, 0, 1).applyQuaternion(w.quaternion).setY(0);
        if (fz.lengthSq() < 1e-6) fz.set(0, 0, 1);
        fz.normalize();
        const side = noise1(this.seed, 9) >= 0 ? 1 : -1;
        _fx.set(0, side, 0); _fz.copy(fz); _fy.copy(_fz).cross(_fx).normalize(); _fx.copy(_fy).cross(_fz);
        _m.makeBasis(_fx, _fy, _fz);
        wd.restQ.setFromRotationMatrix(_m);
        this.wRestFrom = w.quaternion.clone();
      }
      B.mag.position.copy(w.position); B.mag.quaternion.copy(w.quaternion);
    } else if (wd.on && wd.rest && wd.restT < 1) {
      wd.restT = Math.min(1, wd.restT + dt / 0.18);
      if (this.wRestFrom) B.wpn.quaternion.copy(this.wRestFrom).slerp(wd.restQ, smooth(wd.restT));
      B.mag.position.copy(B.wpn.position); B.mag.quaternion.copy(B.wpn.quaternion);
    }
    const md = this.magDrop;
    if (md.on && !md.rest) {
      const m = B.magDrop;
      md.v.y -= 9.8 * dt;
      m.position.addScaledVector(md.v, dt);
      m.quaternion.multiply(_q.setFromEuler(_e.set(4 * dt, 0, 2 * dt)));
      // the magazine's lowest point ≈ its seat point (in gun space) + its length below
      _v.copy(this.G.magSeat).applyQuaternion(m.quaternion).add(m.position);
      if (_v.y < 0.03) {
        md.rest = true;
        const yaw = Math.atan2(_v2.set(0, 0, 1).applyQuaternion(m.quaternion).x, _v2.z);
        m.quaternion.setFromEuler(_e.set(0, yaw, Math.PI / 2, 'YXZ'));
        _v3.copy(this.G.magSeat).add(_v4.set(0, -this.G.magLen * 0.5, 0)).applyQuaternion(m.quaternion);
        m.position.y = 0.016 - _v3.y;
      }
    }
  }
  private wRestFrom: THREE.Quaternion | null = null;
}

/** Carbine butt in the shoulder pocket (model bind space, carried by spine2). */
const CARB_POCKET: [number, number, number] = [-0.075, 1.49, 0.07];
const PALM_R = new THREE.Vector3(0.026, -0.058, 0.012);
const PALM_L = new THREE.Vector3(-0.026, -0.058, 0.012);
const ZERO3: [number, number, number] = [0, 0, 0];
const DBONES = ['hips', 'spine1', 'spine2', 'neck', 'head', 'clav_l', 'clav_r', 'uarm_l', 'uarm_r', 'larm_l', 'larm_r', 'hand_l', 'hand_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r'] as const;

// ───────────────────────────────────────────────────────────── death keys

/**
 * Keyed falls (model space: +Z his front, +X his left; Euler XYZ local per bone; arm pitch − = forward, out + =
 * away from the body (left arm +Z rotation, right arm −Z); knee (shin) + = bends back; thigh − = forward).
 */
function deathKeys(kind: DeathKind, side: number, wall: number): DKey[] {
  const arm = (pL: number, oL: number, eL: number, pR: number, oR: number, eR: number) => ({
    uarm_l: [pL, 0, oL] as [number, number, number], larm_l: [-eL, 0, 0] as [number, number, number],
    uarm_r: [pR, 0, -oR] as [number, number, number], larm_r: [-eR, 0, 0] as [number, number, number],
  });
  const stand: DKey = { t: 0, hips: [0, 0.93, 0], r: { spine1: [0.04, 0, 0], spine2: [0.04, 0, 0], ...arm(-0.5, 0.2, 1.3, -0.6, 0.25, 1.4) } };
  if (kind === 'fwd') return [
    stand,
    { t: 0.3, hips: [0, 0.74, 0.07], ease: 'in', r: { hips: [0.2, 0, 0], spine1: [0.2, 0, 0], spine2: [0.2, 0, 0], neck: [0.25, 0, 0], head: [0.2, 0, 0], thigh_l: [-0.85, 0, 0.04], thigh_r: [-0.8, 0, -0.04], shin_l: [1.6, 0, 0], shin_r: [1.55, 0, 0], foot_l: [-0.7, 0, 0], foot_r: [-0.7, 0, 0], ...arm(-0.25, 0.15, 0.6, -0.3, 0.15, 0.7) } },
    { t: 0.55, hips: [0, 0.5, 0.08], ease: 'in', r: { hips: [0.42, 0, 0], spine1: [0.3, 0, 0], spine2: [0.25, 0, 0], neck: [0.2, 0, 0], head: [0.15, 0, 0], thigh_l: [-0.45, 0, 0.04], thigh_r: [-0.4, 0, -0.04], shin_l: [1.7, 0, 0], shin_r: [1.65, 0, 0], foot_l: [0.6, 0, 0], foot_r: [0.6, 0, 0], ...arm(-0.8, 0.25, 0.35, -0.85, 0.25, 0.3) } },
    { t: 0.85, hips: [0, 0.36, 0.25], ease: 'in', r: { hips: [0.95, 0, 0], spine1: [0.2, 0, 0], spine2: [0.12, 0, 0], neck: [-0.1, 0, 0], head: [-0.1, 0, 0], thigh_l: [-0.65, 0, 0.05], thigh_r: [-0.6, 0, -0.05], shin_l: [1.4, 0, 0], shin_r: [1.35, 0, 0], foot_l: [0.7, 0, 0], foot_r: [0.7, 0, 0], ...arm(-1.6, 0.4, 0.4, -1.55, 0.4, 0.45) } },
    { t: 1.12, hips: [0, 0.22, 0.72], ease: 'in', r: { hips: [1.5, 0, 0], spine1: [-0.04, 0, 0], spine2: [-0.06, 0, 0], neck: [0.0, 0.3, 0], head: [0.0, 0.85, 0.15], thigh_l: [-0.1, 0, 0.1], thigh_r: [-0.22, 0, -0.06], shin_l: [0.2, 0, 0], shin_r: [0.55, 0, 0], foot_l: [0.9, 0, 0], foot_r: [0.8, 0, 0], ...arm(-2.3, 0.5, 0.3, 0.15, 0.35, 0.1) } },
    { t: 1.45, hips: [0, 0.21, 0.72], ease: 'out', r: { hips: [1.53, 0, 0.02], spine1: [-0.05, 0, 0], spine2: [-0.06, 0, 0], neck: [0.12, 0.35, 0], head: [0.08, 0.95, 0.22], thigh_l: [-0.1, 0, 0.12], thigh_r: [-0.25, 0, -0.06], shin_l: [0.15, 0, 0], shin_r: [0.6, 0, 0], foot_l: [0.95, 0, 0], foot_r: [0.85, 0, 0], ...arm(-2.4, 0.55, 0.3, 0.2, 0.3, 0.1) } },
  ];
  if (kind === 'back') {
    // (IB5a, B4) never a symmetric star: he lands rolled a little onto one side (s), the head turned that way, the arm on
    // that side flung up past the head, the other arm fallen across his belt, one leg straight, the other knee up and
    // fallen outward. `side` (+1 / −1) mirrors it (set from the push in `die`).
    const s = side >= 0 ? 1 : -1, up = s > 0 ? 'l' : 'r', dn = s > 0 ? 'r' : 'l', o = (a: number, j: 'l' | 'r') => (j === 'l' ? a : -a);
    const limbs = (k: number) => ({
      ['uarm_' + up]: [-0.6 - 2.45 * k, 0, o(0.5 - 0.1 * k, up)] as [number, number, number], ['larm_' + up]: [-0.4 - 0.25 * k, 0, 0] as [number, number, number],
      ['hand_' + up]: [0.3 * k, 0, o(-0.4 * k, up)] as [number, number, number],
      ['uarm_' + dn]: [-0.5 + 0.1 * k, 0, o(0.55 - 0.65 * k, dn)] as [number, number, number], ['larm_' + dn]: [-0.5 - 1.05 * k, o(0.5 * k, dn), 0] as [number, number, number],
      ['hand_' + dn]: [0.1, 0, o(0.3 * k, dn)] as [number, number, number],
      ['thigh_' + up]: [-0.75 + 0.6 * k, 0.12 * k * s, o(0.1 + 0.05 * k, up)] as [number, number, number], ['shin_' + up]: [1.1 - 0.95 * k, 0, 0] as [number, number, number],
      ['foot_' + up]: [-0.2 + 0.45 * k, 0, o(0.2 * k, up)] as [number, number, number],
      ['thigh_' + dn]: [-0.6 - 0.25 * k, 0, o(0.1 + 0.52 * k, dn)] as [number, number, number], ['shin_' + dn]: [1.0 + 0.3 * k, 0, 0] as [number, number, number],
      ['foot_' + dn]: [-0.15 + 0.1 * k, 0, o(0.15 * k, dn)] as [number, number, number],
    });
    return [
      stand,
      { t: 0.28, hips: [0, 0.8, -0.06], ease: 'in', r: { hips: [-0.15, 0, 0], spine1: [-0.12, 0, 0], spine2: [-0.15, 0, 0], neck: [0.25, 0, 0], head: [0.15, 0, 0], thigh_l: [-0.45, 0, 0.05], thigh_r: [-0.35, 0, -0.05], shin_l: [0.9, 0, 0], shin_r: [0.75, 0, 0], foot_l: [-0.45, 0, 0], foot_r: [-0.4, 0, 0], ...arm(-0.6, 0.5, 0.6, -0.5, 0.55, 0.6) } },
      { t: 0.62, hips: [0, 0.24, -0.32], ease: 'in', r: { hips: [-0.55, 0, 0.04 * s], spine1: [-0.05, 0.04 * s, 0], spine2: [0.05, 0.04 * s, 0], neck: [0.3, 0.1 * s, 0], head: [0.2, 0.15 * s, 0], thigh_l: [-0.95, 0, 0.08], thigh_r: [-0.85, 0, -0.08], shin_l: [1.25, 0, 0], shin_r: [1.1, 0, 0], foot_l: [-0.3, 0, 0], foot_r: [-0.25, 0, 0], ...arm(-0.4, 0.8, 0.4, -0.3, 0.8, 0.4) } },
      { t: 0.95, hips: [0.03 * s, 0.19, -0.5], ease: 'in', r: { hips: [-1.42, 0.06 * s, 0.06 * s], spine1: [0.02, 0.06 * s, 0.03 * s], spine2: [0.0, 0.08 * s, 0.02 * s], neck: [0.2, 0.25 * s, 0], head: [0.1, 0.45 * s, 0.05 * s], ...limbs(0.75) } },
      { t: 1.35, hips: [0.04 * s, 0.18, -0.52], ease: 'out', r: { hips: [-1.5, 0.12 * s, 0.1 * s], spine1: [0.04, 0.1 * s, 0.05 * s], spine2: [0.02, 0.12 * s, 0.04 * s], neck: [-0.22, 0.32 * s, 0.04 * s], head: [-0.1, 0.72 * s, 0.12 * s], ...limbs(1) } },
    ];
  }
  if (kind === 'sit') {
    const z = -clamp(wall - 0.2, 0.05, 0.62);
    return [
      stand,
      { t: 0.3, hips: [0, 0.78, z * 0.4], ease: 'in', r: { hips: [-0.1, 0, 0], spine1: [-0.1, 0, 0], spine2: [-0.1, 0, 0], neck: [0.2, 0, 0], head: [0.1, 0, 0], thigh_l: [-0.6, 0, 0.06], thigh_r: [-0.5, 0, -0.06], shin_l: [1.0, 0, 0], shin_r: [0.9, 0, 0], foot_l: [-0.4, 0, 0], foot_r: [-0.4, 0, 0], ...arm(-0.4, 0.3, 0.6, -0.4, 0.3, 0.6) } },
      { t: 0.85, hips: [0, 0.15, z], ease: 'in', r: { hips: [-0.12, 0, 0], spine1: [-0.08, 0, 0], spine2: [-0.06, 0, 0], neck: [0.3, 0, 0], head: [0.25, 0, 0], thigh_l: [-1.75, 0, 0.14], thigh_r: [-1.7, 0, -0.12], shin_l: [0.7, 0, 0], shin_r: [0.65, 0, 0], foot_l: [0.4, 0, 0], foot_r: [0.4, 0, 0], ...arm(-0.45, 0.25, 0.6, -0.4, 0.25, 0.6) } },
      { t: 1.55, hips: [0, 0.14, z], ease: 'out', r: { hips: [-0.1, 0, 0.05 * side], spine1: [0.02, 0, 0.18 * side], spine2: [0.06, 0, 0.16 * side], neck: [0.45, 0, 0.2 * side], head: [0.25, 0.2 * side, 0.25 * side], thigh_l: [-1.85, 0, 0.3], thigh_r: [-1.5, 0, -0.08], shin_l: [0.62, 0, 0], shin_r: [0.12, 0, 0], foot_l: [0.35, 0, 0], foot_r: [-0.45, 0, 0], ...arm(-0.5, 0.2, 0.7, -0.35, 0.3, 0.5) } },
    ];
  }
  // side: crumples while turning and drops onto the side the push sends him (side +1 = onto his LEFT side). In the
  // body frame "down" is +X·s: a Z rotation +θ·s moves a hanging limb toward the floor.
  const s = side;
  const dn = s > 0 ? 'l' : 'r', up = s > 0 ? 'r' : 'l';
  const lim = (dArm: [number, number, number], dEl: number, uArm: [number, number, number], uEl: number, dTh: [number, number, number], dSh: number, uTh: [number, number, number], uSh: number) => ({
    ['uarm_' + dn]: dArm, ['larm_' + dn]: [-dEl, 0, 0] as [number, number, number], ['uarm_' + up]: uArm, ['larm_' + up]: [-uEl, 0, 0] as [number, number, number],
    ['thigh_' + dn]: dTh, ['shin_' + dn]: [dSh, 0, 0] as [number, number, number], ['thigh_' + up]: uTh, ['shin_' + up]: [uSh, 0, 0] as [number, number, number],
  });
  return [
    stand,
    { t: 0.35, hips: [0, 0.72, 0], ease: 'in', r: { hips: [0.15, 0, -0.12 * s], spine1: [0.15, 0, -0.1 * s], spine2: [0.12, 0, -0.1 * s], neck: [0.2, 0, -0.1 * s], head: [0.15, 0, 0], foot_l: [-0.75, 0, 0], foot_r: [-0.75, 0, 0],
      ...lim([-0.3, 0, 0.3 * s], 0.6, [-0.3, 0, -0.3 * s], 0.6, [-0.9, 0, 0.04 * s], 1.7, [-0.85, 0, -0.04 * s], 1.6) } },
    { t: 0.75, hips: [0.12 * s, 0.42, 0.05], ease: 'in', r: { hips: [0.3, 0, -0.6 * s], spine1: [0.2, 0, -0.2 * s], spine2: [0.15, 0, -0.15 * s], neck: [0.2, 0, 0.1 * s], head: [0.1, 0, 0.1 * s], foot_l: [-0.3, 0, 0], foot_r: [-0.3, 0, 0],
      ...lim([-0.9, 0, 0.5 * s], 0.4, [-0.6, 0, -0.2 * s], 0.7, [-1.1, 0, -0.1 * s], 1.8, [-1.0, 0, 0.05 * s], 1.7) } },
    { t: 1.15, hips: [0.32 * s, 0.265, 0.06], ease: 'in', r: { hips: [0.18, 0, -1.48 * s], spine1: [0.22, 0, -0.04 * s], spine2: [0.18, 0, 0.0], neck: [0.1, 0, -0.32 * s], head: [0.05, 0, -0.25 * s], foot_l: [-0.2, 0, 0], foot_r: [-0.2, 0, 0],
      ...lim([-1.4, 0, -0.12 * s], 0.5, [-0.75, 0, 0.1 * s], 1.0, [-0.75, 0, -0.08 * s], 1.25, [-1.1, 0, 0.12 * s], 1.55) } },
    { t: 1.55, hips: [0.32 * s, 0.255, 0.06], ease: 'out', r: { hips: [0.2, 0, -1.53 * s], spine1: [0.24, 0, -0.04 * s], spine2: [0.2, 0, 0.0], neck: [0.08, 0, -0.38 * s], head: [0.05, 0, -0.3 * s], foot_l: [-0.15, 0, 0], foot_r: [-0.2, 0, 0],
      ...lim([-1.45, 0, -0.14 * s], 0.55, [-0.7, 0, 0.18 * s], 1.1, [-0.72, 0, -0.08 * s], 1.2, [-1.12, 0, 0.16 * s], 1.6) } },
  ];
}

// ───────────────────────────────────────────────────────────── casings

let _casing: Record<string, THREE.BufferGeometry> = {};
let _casingMat: THREE.Material | null = null;
function casingGeo(arms: SoldierArms): THREE.BufferGeometry {
  if (!_casing[arms]) {
    const g = arms === 'pistol' ? new THREE.CylinderGeometry(0.0048, 0.0048, 0.019, 8) : new THREE.CylinderGeometry(0.0055, 0.0062, 0.039, 8);
    g.rotateX(Math.PI / 2);
    _casing[arms] = g;
  }
  return _casing[arms];
}
function casingMat(ctx: GameContext): THREE.Material {
  if (!_casingMat) { try { _casingMat = ctx.materials.get('brass'); } catch { _casingMat = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.9, roughness: 0.35 }); } }
  return _casingMat;
}
void _casing; void _m2;
