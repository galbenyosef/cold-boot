/**
 * First-person weapon rigs: gun + gloved hands + forearms, keyframed reload/pump choreography and
 * procedural recoil. `Viewmodel` layers sway / bob / sprint / inertia on top and owns both rigs.
 *
 * Spaces: the Viewmodel root is a child of the camera. Each rig has a `container` (child of root);
 * gun base pose, hands and forearms live in container space.
 *
 * Grips are solved once at load (see grip.ts): hands are placed by their knuckles on the weapon and the
 * fingers closed onto collision proxies, so every hold is a parameter vector that touches what it holds.
 * At run time finger poses are sampled from clip pose keys and blended continuously; when the support
 * hand carries something to the gun (magazine, shell) the hand itself is steered to the exact seat
 * transform, with the prop rigid in the hand.
 */
import * as THREE from 'three';
import type { VmMats } from './mats';
import { Hand, Forearm, POSES, POSE_LEN, THUMB, FINGERS, type HandPose } from './hands';
import { buildPistol, buildMagazine, pistolProxy, magProxy, type PistolModel } from './pistol';
import { buildShotgun, shotgunProxy, PUMP_TRAVEL, S_TUBE, type ShotgunModel } from './shotgun';
import { buildShell } from './props';
import { ClipPlayer, samplePoseKeys, type Clip } from './anim';
import { MuzzleFlash } from './muzzle';
import { Spring, Spring3, clamp, damp, noise1 } from '../math';
import { setViewmodel } from '../geom';
import { PISTOL_CLIPS, SHOTGUN_CLIPS, CARBINE_CLIPS } from './clips';
import { buildCarbine, buildCarbineMag, carbineProxy, carbineMagProxy, C_BORE, CH_POS, CH_TRAVEL, MAG_SEAT, SIGHT, type CarbineModel, type CarbineMag } from './carbine';
import { WEAPON_STATS } from '../weapons';
import { placeHand, wrapFinger, reachFinger, reachThumb, handProxy, gripReport, union, placed, capsuleSdf, type Sdf } from './grip';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _fv = new THREE.Vector3(), _dv = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

/** Orient an object so local +Y = F (fingers) and +Z = D (back of hand); D is orthogonalised. */
export function orientFD(q: THREE.Quaternion, F: THREE.Vector3Like, D: THREE.Vector3Like): THREE.Quaternion {
  _y.set(F.x, F.y, F.z).normalize();
  _z.set(D.x, D.y, D.z);
  _z.addScaledVector(_y, -_z.dot(_y)).normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return q.setFromRotationMatrix(_m);
}

export interface RigMotion {
  time: number;
  /** View rotation this frame (radians) — drives look sway. */
  lookX: number;
  lookY: number;
  /** 0..1 horizontal speed relative to sprint speed. */
  speed: number;
  /** Footstep phase (radians, 2π = two steps). */
  bobPhase: number;
  grounded: boolean;
  vy: number;
  sprint: number;
  crouch: number;
  /** 0..1 how much to pull back from a wall. */
  wall: number;
  /** 0..1 holster amount (equip/switch/death). */
  lower: number;
  strafe: number;
  /** Carbine aim-down-sights: eased blend 0..1 and the raw (linear) progress. Optional (0). */
  ads?: number;
  adsRaw?: number;
  /** Scale of bob / look lag / breathing on the gun (1 at the hip; small at the eye). Optional (1). */
  swayK?: number;
  /** x/y scale of the viewmodel against the camera's zoom (tan(fov/2) / tan(hip fov/2)): the gun keeps its size. */
  fovScale?: number;
}

/** Channel scratch buffers. */
const GUN = [0, 0, 0, 0, 0, 0];
const ONE = [0];
const FREE = [0];
const LP = [0, 0, 0], LF = [0, 1, 0], LD = [0, 0, 1];
const CAM = [0, 0];
const XFADE = 0.13;
/** 0→1→0 bump over x ∈ [0, 1] (soft at both ends). */
const bump01 = (x: number) => { if (x <= 0 || x >= 1) return 0; const s = Math.sin(Math.PI * x); return s * s; };
const smooth = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

export abstract class GunRig {
  readonly container = new THREE.Group();
  readonly gun: THREE.Object3D;
  readonly rh: Hand;
  readonly lh: Hand;
  readonly rf: Forearm;
  readonly lf: Forearm;
  readonly player = new ClipPlayer();
  readonly basePos = new THREE.Vector3();
  readonly baseRot = new THREE.Euler();
  readonly baseQuat = new THREE.Quaternion();
  /** The hip pose `setBase` sets; with an ADS pose the live base blends from it to `adsPos` / `adsQuat`. */
  readonly hipPos = new THREE.Vector3();
  readonly hipQuat = new THREE.Quaternion();
  readonly adsPos = new THREE.Vector3();
  readonly adsQuat = new THREE.Quaternion();
  hasAds = false;
  /** Eased ADS blend and raw progress (set by the Viewmodel each frame). */
  ads = 0;
  adsRaw = 0;
  /** How far the elbows follow the base as it moves to the eye (container space). */
  private readonly elbowShift = new THREE.Vector3();
  private readonly _rE = new THREE.Vector3();
  private readonly _lE = new THREE.Vector3();
  /** Sprint pose offsets (pos in base frame, euler). */
  readonly sprintPos = new THREE.Vector3();
  readonly sprintRot = new THREE.Euler();
  readonly rElbow = new THREE.Vector3(0.2, -0.42, 0.08);
  readonly lElbow = new THREE.Vector3(-0.14, -0.44, 0.02);
  /** LH socket rest transform in gun space. */
  readonly lhRestPos = new THREE.Vector3();
  readonly lhRestQuat = new THREE.Quaternion();
  /** LH live socket position in gun space (e.g. moves with the pump). */
  readonly lhLivePos = new THREE.Vector3();
  /**
   * Motion layers on the gun (all offsets in the base frame):
   *  follow  — the authored clip / sprint offset is a *target*; the gun chases it with mass (overshoot + settle)
   *  recoil  — fast wrist snap (muzzle flip)
   *  arm     — slower push through the elbows / shoulder that arrives after the wrist and settles later
   *  impact  — knocks from the choreography (magazine seated, slide dropped, shell thumbed in, pump stroke)
   */
  readonly followPos = new Spring3(6.2, 0.74);
  readonly followRot = new Spring3(5.4, 0.62);
  readonly recoilPos = new Spring3(6.5, 0.6);
  readonly recoilRot = new Spring3(5.6, 0.5);
  readonly armPos = new Spring3(3.1, 0.58);
  readonly armRot = new Spring3(2.9, 0.55);
  readonly impactPos = new Spring3(7.5, 0.42);
  readonly impactRot = new Spring3(6.5, 0.38);
  /** Elbows trail the wrists (sleeve / forearm lag). */
  private readonly rElbS = new Spring3(3.4, 0.7);
  private readonly lElbS = new Spring3(3.4, 0.7);
  readonly flash: MuzzleFlash;
  /** Squeeze amount 0..1 for trigger + index finger. */
  trigger = 0;
  protected triggerT = 0;
  /** 0 = index finger straight along the frame, 1 = on the trigger. */
  onTrigger = 0;
  private triggerHold = 0;
  readonly muzzleObj: THREE.Object3D;
  readonly ejectObj: THREE.Object3D;
  /** Callback for clip events. */
  onEvent: (id: string) => void = () => {};
  /** Named finger poses (parameter vectors) per hand; `rest` is the idle hold. */
  readonly lhPoses: Record<string, HandPose> = { open: POSES.open, relaxed: POSES.relaxed };
  readonly rhPoses: Record<string, HandPose> = {};
  /** Solver diagnostics: clearance in mm per finger [index, middle, ring, pinky, thumb] for each solved grip. */
  readonly report: Record<string, number[]> = {};
  /** Camera glance requested by the playing clip (radians: pitch, yaw) — smoothed; the weapon logic feeds it to the camera. */
  readonly glance = new THREE.Vector2();
  /** Support hand hanging off the gun while it is holstered / drawn (free pose in the gun's frame). */
  protected readonly drawP = new THREE.Vector3(-0.1, -0.2, 0.1);
  protected readonly drawF = new THREE.Vector3(0.25, 0.3, -0.92);
  protected readonly drawD = new THREE.Vector3(-0.75, 0.6, -0.1);
  protected time = Math.random() * 40;
  // idle life: periodic re-grip (one hand at a time), per-play variation, clip cross-fade of the support hand
  private regripT = -1;
  private regripHand = 0;
  private regripIn = 5 + Math.random() * 4;
  private quiet = 0;
  protected readonly vary = new THREE.Vector3();
  private xfade = 0;
  private readonly lhFromP = new THREE.Vector3();
  private readonly lhFromQ = new THREE.Quaternion();
  private readonly lhLastP = new THREE.Vector3();
  private readonly lhLastQ = new THREE.Quaternion();
  private lhInit = false;
  private drawW = 0;

  constructor(readonly m: VmMats, gun: THREE.Object3D, muzzle: THREE.Object3D, eject: THREE.Object3D, flash: MuzzleFlash) {
    this.gun = gun;
    this.muzzleObj = muzzle;
    this.ejectObj = eject;
    this.flash = flash;
    this.container.add(gun);
    this.rh = new Hand(m, false);
    this.lh = new Hand(m, true);
    this.rf = new Forearm(m, false);
    this.lf = new Forearm(m, true, 0);
    gun.add(this.rh.root);
    this.container.add(this.lh.root, this.rf.root, this.lf.root);
    muzzle.add(flash.root);
  }

  /** Set base pose (container space). */
  setBase(x: number, y: number, z: number, rx: number, ry: number, rz: number) {
    this.basePos.set(x, y, z);
    this.baseRot.set(rx, ry, rz);
    this.baseQuat.setFromEuler(this.baseRot);
    this.hipPos.copy(this.basePos);
    this.hipQuat.copy(this.baseQuat);
  }

  play(clip: Clip, onDone?: () => void, startAt = 0) {
    this.player.play(clip, (id) => this.handleEvent(id), onDone, startAt);
    this.player.speed = 1;
    this.startXfade();
    this.vary.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    this.quiet = 0;
  }

  /** Blend the support hand from wherever it is now into whatever drives it next. */
  protected startXfade() {
    this.lhFromP.copy(this.lhLastP); this.lhFromQ.copy(this.lhLastQ);
    this.xfade = XFADE;
  }

  protected handleEvent(id: string) { this.onEvent(id); }

  /** Procedural recoil: wrist snap now, arm push that lands a few frames later. */
  kick(back: number, up: number, side: number) {
    const r1 = Math.random() - 0.5, r2 = Math.random() - 0.5, r3 = Math.random() - 0.5;
    this.recoilPos.impulse(side * 0.2 * r1, up * 0.12, back);
    this.recoilRot.impulse(up, side * r2, side * r3 * 1.6);
    this.armPos.impulse(side * 0.05 * r2, up * 0.03, back * 0.8);
    this.armRot.impulse(up * 0.3, side * 0.12 * r2, side * 0.25 * r3);
    this.quiet = 0;
  }

  /** Knock the gun (m/s in the base frame, rad/s). */
  knock(px: number, py: number, pz: number, rx: number, ry: number, rz: number) {
    this.impactPos.impulse(px, py, pz);
    this.impactRot.impulse(rx, ry, rz);
  }

  pullTrigger() { this.triggerT = 0.07; this.triggerHold = 1.4; this.onTrigger = Math.max(this.onTrigger, 0.85); }

  /** World position of the muzzle. */
  muzzleWorld(out: THREE.Vector3) { return this.muzzleObj.getWorldPosition(out); }
  ejectWorld(out: THREE.Vector3) { return this.ejectObj.getWorldPosition(out); }

  // ── load-time grip solving (gun + container are still at identity → world space = gun space)

  /** Place the firing hand by its knuckles and solve its grip: fingers 1-3 wrap, thumb + index are steered. */
  protected solveFiringHand(proxy: Sdf, o: {
    idx: THREE.Vector3; pinky: THREE.Vector3; dorsal: THREE.Vector3; splay: number[];
    thumbTip: THREE.Vector3; thumbMid: THREE.Vector3; indexTip: THREE.Vector3; indexMid: THREE.Vector3; trigTip: THREE.Vector3; trigMid: THREE.Vector3;
  }) {
    const h = this.rh;
    placeHand(false, o.idx, o.pinky, o.dorsal, h.root.position, h.root.quaternion);
    const g = POSES.relaxed.slice();
    for (let f = 0; f < 4; f++) g[f * 4] = o.splay[f] * DEG;
    for (let f = 1; f < 4; f++) wrapFinger(h, g, f, proxy);
    reachThumb(h, g, o.thumbTip, o.thumbMid, proxy);
    g[1] = 12 * DEG; g[2] = 12 * DEG; g[3] = 8 * DEG;
    reachFinger(h, g, 0, o.indexTip, proxy, o.indexMid);
    const t = g.slice();
    t[1] = 30 * DEG; t[2] = 40 * DEG; t[3] = 20 * DEG;
    reachFinger(h, t, 0, o.trigTip, proxy, o.trigMid);
    this.rhPoses.grip = g;
    this.rhPoses.trigger = t;
    this.report.rh = gripReport(h, g, proxy);
    this.report.rhTrigger = gripReport(h, t, proxy);
    h.setPose(g, true);
    h.apply();
    return g;
  }

  /** Place the support hand on its socket by its knuckles; returns the pose buffer to solve into. */
  protected placeSupport(idx: THREE.Vector3, pinky: THREE.Vector3, dorsal: THREE.Vector3, splay: number[]): HandPose {
    placeHand(true, idx, pinky, dorsal, this.lhRestPos, this.lhRestQuat);
    this.lhLivePos.copy(this.lhRestPos);
    this.lh.root.position.copy(this.lhRestPos);
    this.lh.root.quaternion.copy(this.lhRestQuat);
    const g = POSES.relaxed.slice();
    for (let f = 0; f < 4; f++) g[f * 4] = splay[f] * DEG;
    return g;
  }

  /**
   * Place the support hand by its axis: fingers along `F`, back of the hand `D`, palm centre on `c`, then backed
   * off along `out` (default `D`) until the palm (metacarpal pads) just rests on `proxy`.
   */
  protected placeSupportFD(proxy: Sdf, F: THREE.Vector3, D: THREE.Vector3, c: THREE.Vector3, splay: number[], out: THREE.Vector3 = D): HandPose {
    const q = orientFD(new THREE.Quaternion(), F, D);
    const dn = out.clone().normalize();
    // palm pads (hand frame, mirrored for the left hand): knuckle bases and the heel
    const pads: THREE.Vector3[] = [];
    for (const f of FINGERS) for (const k of [0.25, 0.6, 0.95]) pads.push(V(-f.x * (0.72 + 0.28 * k), 0.012 + (f.y - 0.012) * k, 0));
    const R = 0.0135;
    const palmC = V(0, 0.058, 0).applyQuaternion(q);
    const pos = c.clone().sub(palmC);
    const clear = () => {
      let m = Infinity;
      for (const p of pads) { _v.copy(p).applyQuaternion(q).add(pos); m = Math.min(m, proxy(_v.x, _v.y, _v.z) - R); }
      return m;
    };
    // march out from inside the gun, then refine
    for (let i = 0; i < 400 && clear() < 0; i++) pos.addScaledVector(dn, 0.0005);
    for (let i = 0; i < 20; i++) { const g = clear(); if (Math.abs(g) < 2e-5) break; pos.addScaledVector(dn, -g * 0.8); }
    pos.addScaledVector(dn, -0.0006); // let the glove padding compress a touch
    this.lhRestPos.copy(pos); this.lhRestQuat.copy(q);
    this.lhLivePos.copy(pos);
    this.lh.root.position.copy(pos);
    this.lh.root.quaternion.copy(q);
    const g = POSES.relaxed.slice();
    for (let f = 0; f < 4; f++) g[f * 4] = splay[f] * DEG;
    return g;
  }

  /** Solve a pose for the support hand holding something given in the hand's own (unmirrored-rotation) frame. */
  protected solveHeld(name: string, proxy: Sdf, splay: number[], thumbTip: THREE.Vector3, thumbMid: THREE.Vector3 | null, wrap: boolean[] = [true, true, true, true], base: HandPose = POSES.relaxed) {
    const h = this.lh;
    _v.copy(h.root.position); _q.copy(h.root.quaternion);
    h.root.position.set(0, 0, 0); h.root.quaternion.identity();
    const g = base.slice();
    for (let f = 0; f < 4; f++) { g[f * 4] = splay[f] * DEG; if (wrap[f]) wrapFinger(h, g, f, proxy, { max: [72, 92, 52] }); }
    reachThumb(h, g, thumbTip, thumbMid, proxy);
    this.lhPoses[name] = g;
    this.report[name] = gripReport(h, g, proxy);
    h.root.position.copy(_v); h.root.quaternion.copy(_q);
    return g;
  }

  /** `lower` 0..1 = how far the weapon is holstered (the support hand comes off the gun while it is down). */
  update(dt: number, sprint: number, lower = 0) {
    this.time += dt;
    this.quiet += dt;
    this.player.update(dt);
    this.flash.update(dt);
    this.triggerT -= dt;
    this.triggerHold -= dt;
    this.trigger = damp(this.trigger, this.triggerT > 0 ? 1 : 0, this.triggerT > 0 ? 60 : 18, dt);
    this.onTrigger = damp(this.onTrigger, this.triggerHold > 0 ? 1 : 0, this.triggerHold > 0 ? 40 : 7, dt);
    const playing = this.player.playing;
    const t = this.time;

    // aim down the sights: the base pose travels from the hip to the eye on a short arc (the gun dips and cants a
    // touch on the way up, as it is thrown into the shoulder); the elbows come along
    let steady = 1;
    if (this.hasAds) {
      const k = this.ads;
      this.basePos.lerpVectors(this.hipPos, this.adsPos, k);
      this.baseQuat.slerpQuaternions(this.hipQuat, this.adsQuat, k);
      const r = this.adsRaw, arc = r > 0 && r < 1 ? 4 * r * (1 - r) : 0;
      if (arc > 0) {
        this.basePos.y -= 0.014 * arc; this.basePos.x += 0.008 * arc;
        this.baseQuat.multiply(_q3.setFromEuler(_e.set(-0.05 * arc, 0, 0.13 * arc)));
      }
      this.elbowShift.subVectors(this.basePos, this.hipPos).multiplyScalar(0.85);
      steady = 1 - 0.8 * k;
    }

    // gun: authored target (clip + sprint + a living wrist) chased with mass, plus recoil / arm / impact layers
    GUN.fill(0);
    this.player.get('gun', GUN);
    const g = this.gun;
    const sp = playing ? sprint * 0.3 : sprint;
    const calm = 1 - sp;
    const fp = this.followPos, fr = this.followRot;
    fp.target.set(GUN[0] + this.sprintPos.x * sp, GUN[1] + this.sprintPos.y * sp, GUN[2] + this.sprintPos.z * sp);
    fr.target.set(
      GUN[3] + this.sprintRot.x * sp + noise1(t * 0.31, 51) * 0.007 * calm * steady,
      GUN[4] + this.sprintRot.y * sp + noise1(t * 0.27, 52) * 0.006 * calm * steady,
      GUN[5] + this.sprintRot.z * sp + noise1(t * 0.19, 53) * 0.014 * calm * steady,
    );
    fp.update(dt); fr.update(dt);
    this.recoilPos.update(dt); this.recoilRot.update(dt);
    this.armPos.update(dt); this.armRot.update(dt);
    this.impactPos.update(dt); this.impactRot.update(dt);
    _v.copy(fp.x).add(this.recoilPos.x).add(this.armPos.x).add(this.impactPos.x);
    g.position.copy(_v.applyQuaternion(this.baseQuat)).add(this.basePos);
    _v.copy(fr.x).add(this.recoilRot.x).add(this.armRot.x).add(this.impactRot.x);
    g.quaternion.copy(this.baseQuat).multiply(_q.setFromEuler(_e.set(_v.x, _v.y, _v.z)));

    // camera glance (clip channel, degrees) — eased so clip changes never snap the view
    CAM[0] = 0; CAM[1] = 0;
    this.player.get('cam', CAM);
    this.glance.x = damp(this.glance.x, CAM[0] * DEG, 9, dt);
    this.glance.y = damp(this.glance.y, CAM[1] * DEG, 9, dt);

    this.updateParts(dt);

    // support hand (container space): socket on the gun (rest ↔ live pump) → authored free pose → draw pose
    ONE[0] = 1;
    this.player.get('lhAttach', ONE);
    _v2.copy(this.lhRestPos).lerp(this.lhLivePos, clamp(ONE[0], 0, 1)).applyQuaternion(g.quaternion).add(g.position);
    _q2.copy(g.quaternion).multiply(this.lhRestQuat);
    FREE[0] = 0;
    if (this.player.get('lhFree', FREE) && FREE[0] > 0.0005) {
      const fw = clamp(FREE[0], 0, 1);
      this.player.get('lhP', LP); this.player.get('lhF', LF); this.player.get('lhD', LD);
      ONE[0] = 0;
      this.player.get('lhBase', ONE);
      const bw = clamp(ONE[0], 0, 1);
      orientFD(_q, _fv.set(LF[0], LF[1], LF[2]), _dv.set(LD[0], LD[1], LD[2]));
      // the free pose is authored in the gun's frame (bw = 0) or in the un-canted base frame (bw = 1)
      _v.set(LP[0], LP[1], LP[2]).addScaledVector(this.vary, 0.014).applyQuaternion(g.quaternion).add(g.position);
      _v3.set(LP[0], LP[1], LP[2]).addScaledVector(this.vary, 0.014).applyQuaternion(this.baseQuat).add(this.basePos);
      _v.lerp(_v3, bw);
      _q3.copy(g.quaternion).multiply(_q);
      _q.premultiply(this.baseQuat);
      _q3.slerp(_q, bw);
      _v2.lerp(_v, fw);
      _q2.slerp(_q3, fw);
    }
    // holstered / drawing: the hand hangs off the gun and comes back on as the weapon arrives
    this.drawW = damp(this.drawW, lower > 0.12 ? 1 : 0, lower > 0.12 ? 16 : 7.5, dt);
    const dw = smooth(this.drawW);
    if (dw > 0.001) {
      _v.copy(this.drawP).applyQuaternion(g.quaternion).add(g.position);
      orientFD(_q, this.drawF, this.drawD).premultiply(g.quaternion);
      _v2.lerp(_v, dw);
      _q2.slerp(_q, dw);
    }
    this.steerSupport(_v2, _q2);
    if (this.xfade > 0 && this.lhInit) {
      const k = smooth(1 - this.xfade / XFADE);
      _v2.lerpVectors(this.lhFromP, _v2, k);
      _q2.copy(_q.copy(this.lhFromQ).slerp(_q2, k));
      this.xfade -= dt;
    }
    this.lhLastP.copy(_v2); this.lhLastQ.copy(_q2);
    this.lhInit = true;
    this.lh.root.position.copy(_v2);
    this.lh.root.quaternion.copy(_q2);

    // fingers: clip pose keys (continuous blend) or the idle holds; trigger finger indexes when not shooting
    const c = this.player.clip, ct = this.player.t;
    if (c?.poses?.lh) samplePoseKeys(c.poses.lh, ct, this.lhPoses, this.lh.target);
    else this.lh.setPose(this.lhPoses.rest);
    if (c?.poses?.rh) samplePoseKeys(c.poses.rh, ct, this.rhPoses, this.rh.target);
    else this.rh.setPose(this.rhPoses.grip);
    if (dw > 0.001) { const lt = this.lh.target, rl = POSES.relaxed; for (let i = 0; i < POSE_LEN; i++) lt[i] += (rl[i] - lt[i]) * dw; }
    const tr = this.rhPoses.trigger, rt = this.rh.target, k = this.onTrigger;
    for (let i = 0; i < 4; i++) rt[i] += (tr[i] - rt[i]) * k;
    this.fingerLife(dt, playing || sp > 0.3 || lower > 0.05);
    const io = this.rh.offset;
    io[2] += this.trigger * 0.16; io[3] += this.trigger * 0.14;
    this.rh.update(dt);
    this.lh.update(dt);

    // forearms aim from the wrist to an elbow that trails the wrist with a soft lag
    this.container.updateMatrix();
    this.orientArm(this.rf, this.rh.root, this._rE.copy(this.rElbow).add(this.elbowShift), this.rElbS, dt, _v.copy(this.rh.root.position).applyQuaternion(this.baseQuat).add(this.basePos));
    this.orientArm(this.lf, this.lh.root, this._lE.copy(this.lElbow).add(this.elbowShift), this.lElbS, dt, _v.copy(this.lhRestPos).applyQuaternion(this.baseQuat).add(this.basePos));
    this.afterHands();
  }

  /**
   * Hands are never still: fingers ease and re-seat on their own (only ever opening from the solved contact, so
   * nothing sinks in), the index finger shifts along the frame, and every 6–12 s one hand re-grips with a
   * finger roll (pinky → index) that also nudges the gun.
   */
  private fingerLife(dt: number, busy: boolean) {
    const lo = this.lh.offset, ro = this.rh.offset, t = this.time;
    for (let i = 0; i < POSE_LEN; i++) { lo[i] = 0; ro[i] = 0; }
    for (let f = 0; f < 4; f++) {
      const b = f * 4;
      lo[b + 1] -= (0.5 + 0.5 * noise1(t * 0.43 + f * 2.7, 31)) * 0.035;
      lo[b + 2] -= (0.5 + 0.5 * noise1(t * 0.37 + f * 1.9, 32)) * 0.03;
      if (f > 0) ro[b + 2] -= (0.5 + 0.5 * noise1(t * 0.33 + f * 2.3, 33)) * 0.02;
    }
    // index finger resting along the frame: slides and lifts a little
    const idle = 1 - this.onTrigger;
    ro[0] += noise1(t * 0.29, 34) * 0.035 * idle;
    ro[1] -= (0.5 + 0.5 * noise1(t * 0.23, 35)) * 0.05 * idle;
    if (busy) { this.regripT = -1; this.regripIn = Math.max(this.regripIn, 2.5); return; }
    if (this.regripT < 0) {
      this.regripIn -= dt;
      if (this.regripIn <= 0 && this.quiet > 2) {
        this.regripT = 0;
        this.regripHand = Math.random() < 0.6 ? 0 : 1;
        this.regripIn = 6 + Math.random() * 6;
        const s = this.regripHand ? 1 : -1;
        this.knock(s * 0.012, -0.01, 0.006, -0.12, s * 0.1, s * 0.35);
      }
      return;
    }
    this.regripT += dt;
    const rt = this.regripT, o = this.regripHand ? ro : lo;
    for (let f = this.regripHand ? 1 : 0; f < 4; f++) {
      const w = bump01((rt - (3 - f) * 0.075) / 0.42), b = f * 4;
      o[b + 1] -= 0.2 * w; o[b + 2] -= 0.13 * w; o[b + 3] -= 0.05 * w;
    }
    if (rt > 0.75) this.regripT = -1;
  }

  /** Point given in the support hand's rotation frame → container space. */
  protected lhPoint(local: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(local).applyQuaternion(this.lh.root.quaternion).add(this.lh.root.position);
  }
  /** Gun-space transform → container space (in place). */
  protected gunToContainer(pos: THREE.Vector3, quat: THREE.Quaternion) {
    pos.applyQuaternion(this.gun.quaternion).add(this.gun.position);
    quat.premultiply(this.gun.quaternion);
  }
  /** Hook: adjust the support hand's container-space transform (e.g. steer it to seat a magazine). */
  protected steerSupport(_pos: THREE.Vector3, _quat: THREE.Quaternion) {}
  protected afterHands() {}

  private readonly _wrist = new THREE.Vector3();
  private readonly _dors = new THREE.Vector3();
  private orientArm(arm: Forearm, hand: THREE.Object3D, elbow: THREE.Vector3, lag: Spring3, dt: number, restWrist: THREE.Vector3) {
    // hand root world → container space
    hand.updateWorldMatrix(true, false);
    this.container.updateWorldMatrix(true, false);
    _m.copy(this.container.matrixWorld).invert().multiply(hand.matrixWorld);
    this._wrist.setFromMatrixPosition(_m);
    _m.extractRotation(_m);
    this._dors.set(0, 0, 1).transformDirection(_m);
    // the elbow follows the wrist by about half its travel (the upper arm takes the rest), a beat late
    lag.target.copy(this._wrist).sub(restWrist).multiplyScalar(0.55).add(elbow);
    if (lag.x.lengthSq() === 0) lag.x.copy(lag.target);
    lag.update(dt);
    arm.orient(this._wrist, lag.x, this._dors);
  }

  /** Weapon-specific moving parts. */
  protected abstract updateParts(dt: number): void;
  abstract get busy(): boolean;
}

// ───────────────────────────────────────────── pistol

/**
 * Spare magazine in the support hand (hand rotation frame): pinched low — baseplate at the finger bases, the top
 * half standing clear of the fingertips so it can enter the well before the fingers reach the grip.
 */
const MAG_P = V(0.004, 0.222, -0.0255);
const MAG_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
const MAG_Q_INV = MAG_Q.clone().invert();
/** Heel of the palm (hand rotation frame) — what strikes the baseplate home. */
const HEEL = V(0.002, 0.022, -0.0165);
/** Baseplate underside below the magazine origin (magazine frame). */
const MAG_BASE = 0.1135;

export class PistolRig extends GunRig {
  readonly model: PistolModel;
  /** Slide locked back on empty. */
  slideLocked = false;
  private slideKick = 0;
  private hammerRot = 0;
  readonly spareMag: THREE.Group;
  readonly magRest = new THREE.Vector3();
  private magWiggle = 0;
  private SLIDE = [0];
  private MAG = [0];
  private ALIGN = [0];
  private STRIKE = [0, 0];

  constructor(m: VmMats) {
    const model = buildPistol(m);
    super(m, model.root, model.muzzle, model.ejectPort, new MuzzleFlash(0.1, 0.12));
    this.model = model;
    // compressed ready: gun low-right, yawed in toward the eye line and canted a little (relaxed wrists) so the
    // support hand's knuckle guard and strap face the eye; both forearms converge on it from below
    this.setBase(0.105, -0.062, -0.39, 0.02, 0.26, 0.19);
    this.sprintPos.set(-0.03, -0.03, 0.03);
    this.sprintRot.set(-0.42, 0.4, 0.16);
    this.rElbow.set(0.32, -0.36, 0.02);
    this.lElbow.set(-0.14, -0.38, 0.0);
    this.drawP.set(-0.085, -0.17, 0.1);

    // firing hand: web high under the beavertail, middle finger under the trigger guard, thumb forward
    const proxy = pistolProxy();
    const grip = this.solveFiringHand(proxy, {
      idx: V(0.0272, -0.0245, 0.034), pinky: V(0.0272, -0.0785, 0.0497), dorsal: V(0.883, 0, 0.469),
      splay: [5, -5, -4, -3],
      thumbTip: V(-0.0245, 0.007, -0.014), thumbMid: V(-0.0245, 0.008, 0.015),
      indexTip: V(0.0212, -0.011, -0.057), indexMid: V(0.0222, -0.014, -0.035),
      trigTip: V(-0.003, -0.028, -0.0565), trigMid: V(0.0165, -0.0275, -0.05),
    });

    // support hand: wrapped over the firing fingers, index under the guard, wrist canted, thumb along the frame
    const both = union([proxy, handProxy(this.rh, grip)]);
    const cant = 30 * DEG, sc = Math.sin(cant), cc = Math.cos(cant);
    const li = V(-0.0455, -0.056 + 0.044 * sc, -0.037 + 0.044 * cc);
    const s = this.placeSupport(li, V(li.x, li.y - 0.0564 * cc, li.z + 0.0564 * sc), V(-0.985, 0, 0.17), [3, 0, -2, -4]);
    for (let f = 0; f < 4; f++) wrapFinger(this.lh, s, f, both);
    reachThumb(this.lh, s, V(-0.0235, -0.0125, -0.066), V(-0.026, -0.014, -0.038), both);
    this.lhPoses.rest = s;
    this.report.lh = gripReport(this.lh, s, both);
    this.lh.setPose(s, true);

    // support hand carrying the spare magazine
    this.solveHeld('mag', placed(magProxy(), MAG_P, MAG_Q), [2, 0, -2, -4], V(0.002, 0.135, -0.046), V(0.016, 0.108, -0.043));
    // letting go of it / palm heel driving the baseplate home (fingers loose, slightly cupped)
    const push = POSES.open.slice();
    for (let i = 0; i < POSE_LEN; i++) push[i] = POSES.relaxed[i] * 0.52 + POSES.fist[i] * 0.48;
    push[THUMB] = POSES.relaxed[THUMB]; push[THUMB + 1] = POSES.relaxed[THUMB + 1];
    this.lhPoses.push = push;
    // thumb flick for the magazine catch / slide stop
    const rel = grip.slice();
    rel[THUMB + 1] += 0.22; rel[THUMB + 3] += 0.25;
    this.rhPoses.release = rel;

    // spare magazine (lives in the left hand during reloads)
    this.spareMag = buildMagazine(m, true);
    this.spareMag.visible = false;
    this.container.add(this.spareMag);
    this.magRest.copy(model.mag.position);
  }

  get busy() { return this.player.playing; }

  fire(lastRound: boolean) {
    this.slideKick = 1;
    this.flash.fire();
    this.pullTrigger();
    this.kick(0.55, 6.2, 3.0);
    if (lastRound) this.slideLocked = true;
  }

  /** Called by the clip events. */
  protected handleEvent(id: string) {
    switch (id) {
      case 'magRelease': this.knock(0, 0, 0, 0.25, 0, -0.5); break; // wrist flick that helps the old one out
      case 'magDrop': this.model.mag.visible = false; break;
      case 'magGrab': this.spareMag.visible = true; break;
      case 'magAttach': this.spareMag.visible = false; this.model.mag.visible = true; break;
      // the palm strike travels up through the frame; the magazine rattles once in the well
      case 'magIn': this.knock(0.02, 0.2, -0.03, 1.5, 0.25, 0.9); this.magWiggle = 1; break;
      case 'slideRelease': this.slideLocked = false; this.knock(0, -0.05, -0.16, -1.9, 0, 0.3); break;
    }
    super.handleEvent(id);
  }

  reload(empty: boolean, onDone: () => void) {
    this.play(empty ? PISTOL_CLIPS.reloadEmpty : PISTOL_CLIPS.reload, () => {
      this.model.mag.visible = true; this.spareMag.visible = false;
      onDone();
    });
  }

  cancel() {
    if (this.player.playing) this.startXfade();
    this.player.stop();
    this.model.mag.visible = true; this.spareMag.visible = false;
  }

  protected updateParts(dt: number) {
    const md = this.model;
    // slide: firing kick (fast back, spring forward), locked back on empty, or clip-driven
    if (this.slideKick > 0) this.slideKick = Math.max(0, this.slideKick - dt / 0.085);
    const k = this.slideKick;
    const kickPos = k > 0 ? (k > 0.78 ? (1 - k) / 0.22 : Math.pow(k / 0.78, 1.6)) * 0.031 : 0;
    let slide = Math.max(kickPos, this.slideLocked ? 0.029 : 0);
    if (this.player.get('slide', this.SLIDE)) slide = this.slideLocked ? Math.max(0.029, this.SLIDE[0]) : this.SLIDE[0];
    md.slide.position.z = slide;
    // slide stop rises when locked
    md.slideStop.rotation.x = damp(md.slideStop.rotation.x, this.slideLocked ? -0.09 : 0, 30, dt);
    // hammer: cocked by the slide, rests cocked (single action)
    this.hammerRot = Math.max(0.42, slide / 0.031 * 0.75);
    md.hammer.rotation.x = this.hammerRot;
    md.trigger.rotation.x = -this.trigger * 0.22;
    // magazine slide in/out of the well (+ a decaying rattle right after it is seated)
    this.MAG[0] = 0;
    this.player.get('magSlide', this.MAG);
    this.magWiggle = Math.max(0, this.magWiggle - dt * 5.5);
    const w = this.magWiggle * this.magWiggle;
    md.mag.position.y = this.magRest.y - this.MAG[0] - Math.abs(Math.sin(this.magWiggle * 16)) * 0.0016 * w;
    md.mag.rotation.x = Math.sin(this.magWiggle * 21) * 0.02 * w;
  }

  /** The hand is steered so the magazine it holds lines up with the well, then so its heel meets the baseplate. */
  protected steerSupport(pos: THREE.Vector3, quat: THREE.Quaternion) {
    this.ALIGN[0] = 0;
    this.player.get('magAlign', this.ALIGN);
    const a = clamp(this.ALIGN[0], 0, 1);
    const well = this.model.magWell;
    if (a > 0) {
      _q3.copy(well.quaternion).multiply(MAG_Q_INV);
      _v3.set(0, this.magRest.y - this.MAG[0], 0).applyQuaternion(well.quaternion).add(well.position);
      _v3.sub(_v.copy(MAG_P).applyQuaternion(_q3));
      this.gunToContainer(_v3, _q3);
      pos.lerp(_v3, a);
      quat.slerp(_q3, a);
    }
    this.STRIKE[0] = 0; this.STRIKE[1] = 0;
    this.player.get('strike', this.STRIKE);
    const sw = clamp(this.STRIKE[0], 0, 1);
    if (sw > 0) {
      // position only: heel under the baseplate, `gap` metres short of it along the well axis
      _v3.set(0, this.magRest.y - this.MAG[0] - MAG_BASE - this.STRIKE[1], 0.003).applyQuaternion(well.quaternion).add(well.position);
      _v3.applyQuaternion(this.gun.quaternion).add(this.gun.position);
      _v3.sub(_v.copy(HEEL).applyQuaternion(quat));
      pos.lerp(_v3, sw);
    }
  }

  protected afterHands() {
    const sm = this.spareMag;
    if (!sm.visible) return;
    this.lhPoint(MAG_P, sm.position);
    sm.quaternion.copy(this.lh.root.quaternion).multiply(MAG_Q);
  }
}

// ───────────────────────────────────────────── shotgun

/** Shell in the support hand (hand rotation frame): across the fingers, crimp toward the thumb side. */
const SHELL_P = V(-0.026, 0.108, -0.0212);
const SHELL_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2));
const SHELL_Q_INV = SHELL_Q.clone().invert();
/** Shell orientation entering the loading port (crimp forward, hand underneath), gun space. */
const SHELL_PORT_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)));
/** Hand orientation that matches a shell standing in the side saddle (palm against the receiver, fingers forward). */
const SADDLE_HAND_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)).multiply(SHELL_Q_INV);

export class ShotgunRig extends GunRig {
  readonly model: ShotgunModel;
  private PUMP = [0];
  readonly heldShell: THREE.Group;
  /** How many side-saddle shells to show (follows reserve). */
  saddleCount = 4;
  holding = false;
  private SA = [0];
  private SS = [0];
  private SG = [0];
  private pumpPrev = 0;
  /**
   * Support-hand grip on the pump (gun space): hand axis `yaw` degrees right of the barrel and rising `rise` degrees,
   * palm normal rolled `roll` degrees right of straight up; palm centre line through (cx, z); thumb tip height /
   * reach ahead of the thumb's base; forearm along (armYaw, armRise) — a slight natural wrist bend off the hand axis —
   * `arm` m back to the elbow, pushed `elbowOut` m outboard. Dev-overridable.
   */
  static SUPPORT = { yaw: 35, rise: 4, roll: 8, armYaw: 22, armRise: 18, cx: -0.004, z: -0.29, thumbY: 0.002, thumbZ: 0.092, arm: 0.3, elbowOut: 0.02 };

  constructor(m: VmMats) {
    const model = buildShotgun(m);
    super(m, model.root, model.muzzle, model.ejectPort, new MuzzleFlash(0.24, 0.3));
    this.model = model;
    // shouldered low: the eye looks down the length of the gun at the pump hand; the support forearm rises to it
    // from below-left (elbow under the gun, as when it is pulled into the shoulder)
    this.setBase(0.11, -0.15, -0.27, 0.11, 0.17, 0.22);
    // running: port arms — butt down by the hip, muzzle up across the body
    this.sprintPos.set(-0.055, -0.005, 0.06);
    this.sprintRot.set(0.1, 0.62, 0.3);
    this.rElbow.set(0.34, -0.36, 0.14);
    this.drawP.set(-0.1, -0.16, -0.16);
    this.drawF.set(0.5, 0.35, -0.8);
    this.drawD.set(-0.6, -0.75, -0.2);
    // heavier gun: slower, deeper follow-through
    this.followPos.freq = 5.2; this.followRot.freq = 4.6; this.followRot.zeta = 0.6;
    this.recoilPos.freq = 5.2; this.recoilRot.freq = 4.4; this.recoilRot.zeta = 0.55;
    this.armPos.freq = 2.5; this.armRot.freq = 2.4;
    this.impactPos.freq = 6; this.impactRot.freq = 5.2;

    const proxy = shotgunProxy();
    this.solveFiringHand(proxy, {
      idx: V(0.0268, -0.0375, 0.041), pinky: V(0.0268, -0.0912, 0.0585), dorsal: V(0.95, 0, 0.3),
      splay: [5, -5, -4, -3],
      thumbTip: V(-0.0265, -0.02, -0.002), thumbMid: V(-0.027, -0.019, 0.026),
      indexTip: V(0.0222, -0.005, -0.05), indexMid: V(0.0232, -0.009, -0.028),
      trigTip: V(-0.003, -0.024, -0.0615), trigMid: V(0.0165, -0.024, -0.056),
    });

    // support hand cups the pump from below, mid-forend: the forend lies diagonally across the palm, palm up and
    // a little to the right, thumb along the near (left) side, fingers curling up the far side. The hand (and the
    // forearm, wrist straight) rises to it from below-behind, angled only slightly across the gun.
    const G = ShotgunRig.SUPPORT;
    const fy = G.yaw * DEG, fr = G.rise * DEG, nr = G.roll * DEG;
    const F = V(Math.sin(fy) * Math.cos(fr), Math.sin(fr), -Math.cos(fy) * Math.cos(fr));
    const N = V(-Math.sin(nr), -Math.cos(nr), 0);
    const D = N.clone().addScaledVector(F, -N.dot(F)).normalize();
    const s = this.placeSupportFD(proxy, F, D, V(G.cx, S_TUBE + 0.002, G.z), [4, 1, -2, -5], N);
    for (let f = 0; f < 4; f++) wrapFinger(this.lh, s, f, proxy);
    // thumb: straight-ish along the left flank of the forend, pointing forward
    this.lh.apply(s, null, false);
    const tz = this.lh.thumbPoint(0, 0, _v).z - G.thumbZ;
    reachThumb(this.lh, s, V(-0.034, S_TUBE + G.thumbY, tz), V(-0.035, S_TUBE + G.thumbY - 0.005, tz + 0.026), proxy);
    this.lhPoses.rest = s;
    this.report.lh = gripReport(this.lh, s, proxy);
    this.lh.setPose(s, true);
    // the forearm runs from the wrist back to the elbow (down, back, slightly out), close to the hand's own line
    const ay = G.armYaw * DEG, ar = G.armRise * DEG;
    _v.set(Math.sin(ay) * Math.cos(ar), Math.sin(ar), -Math.cos(ay) * Math.cos(ar)).applyQuaternion(this.baseQuat);
    this.lElbow.copy(this.lhRestPos).applyQuaternion(this.baseQuat).add(this.basePos).addScaledVector(_v, -G.arm);
    this.lElbow.x -= G.elbowOut;

    // shell pinched across the fingers under the thumb
    const shell = capsuleSdf(V(SHELL_P.x + 0.006, SHELL_P.y, SHELL_P.z), V(SHELL_P.x + 0.058, SHELL_P.y, SHELL_P.z), 0.0108);
    this.solveHeld('shell', shell, [3, 0, -2, -5], V(0.012, 0.1, -0.04), V(0.022, 0.076, -0.036));
    const reach = this.lhPoses.shell.slice();
    for (let i = 0; i < POSE_LEN; i++) reach[i] = reach[i] * 0.74 + POSES.open[i] * 0.26;
    this.lhPoses.reach = reach;

    this.heldShell = buildShell(m);
    this.heldShell.visible = false;
    this.container.add(this.heldShell);
  }

  get busy() { return this.player.playing; }

  fire(onPumped: () => void) {
    this.flash.fire();
    this.pullTrigger();
    this.kick(1.25, 8.5, 4.5);
    this.play(SHOTGUN_CLIPS.pump, onPumped);
  }

  protected handleEvent(id: string) {
    switch (id) {
      case 'shellGrab': this.heldShell.visible = true; this.holding = true; break;
      // the thumb drives the shell past the latch: the push goes up into the receiver (never twice the same)
      case 'shellIn': {
        this.heldShell.visible = false; this.holding = false;
        const k = 0.8 + Math.random() * 0.5;
        this.knock(0.01 * this.vary.x, 0.07 * k, -0.1 * k, 0.5 * k, 0.2 * this.vary.y, -0.5 * k);
        break;
      }
    }
    super.handleEvent(id);
  }

  cancel() {
    if (this.player.playing) this.startXfade();
    this.player.stop();
    this.heldShell.visible = false; this.holding = false;
  }

  protected updateParts(dt: number) {
    const md = this.model;
    this.PUMP[0] = 0;
    this.player.get('pump', this.PUMP);
    const pn = clamp(this.PUMP[0], 0, 1);
    const p = pn * PUMP_TRAVEL;
    // the slide stops dead at both ends of its stroke: the gun (and the shoulder behind it) rocks against it
    if (dt > 0) {
      if (pn >= 0.995 && this.pumpPrev < 0.995) this.knock(0, -0.02, 0.22, -0.9, 0.15, -0.7);
      else if (pn <= 0.005 && this.pumpPrev > 0.005) this.knock(0, 0.015, -0.2, 0.7, -0.1, 0.5);
      this.pumpPrev = pn;
    }
    md.pump.position.z = p;
    md.bolt.position.z = p * 0.85;
    md.trigger.rotation.x = -this.trigger * 0.25;
    this.lhLivePos.copy(this.lhRestPos);
    this.lhLivePos.z += p;
    const vis = this.saddleCount - (this.holding ? 1 : 0);
    for (let i = 0; i < md.saddle.length; i++) md.saddle[i].visible = i < vis;
  }

  /** Steer the hand so the shell it pinches sits exactly in the saddle slot (grab) / in the loading port (insert). */
  protected steerSupport(pos: THREE.Vector3, quat: THREE.Quaternion) {
    this.SG[0] = 0; this.SA[0] = 0; this.SS[0] = 0;
    this.player.get('shellGrabW', this.SG);
    this.player.get('shellAlign', this.SA);
    this.player.get('shellSlide', this.SS);
    const gw = clamp(this.SG[0], 0, 1), a = clamp(this.SA[0], 0, 1), sl = clamp(this.SS[0], 0, 1);
    if (gw > 0) {
      const slot = this.model.saddle[clamp(this.saddleCount - 1, 0, this.model.saddle.length - 1)];
      _q3.copy(SADDLE_HAND_Q);
      _v3.copy(slot.position).sub(_v.copy(SHELL_P).applyQuaternion(_q3));
      this.gunToContainer(_v3, _q3);
      pos.lerp(_v3, gw);
      quat.slerp(_q3, gw);
    }
    if (a > 0) {
      const port = this.model.loadPort.position;
      _q3.copy(SHELL_PORT_Q).multiply(SHELL_Q_INV);
      _v3.set(port.x, port.y - 0.027 + sl * 0.034, port.z + 0.03 - sl * 0.054);
      _v3.sub(_v.copy(SHELL_P).applyQuaternion(_q3));
      this.gunToContainer(_v3, _q3);
      pos.lerp(_v3, a);
      quat.slerp(_q3, a);
    }
  }

  protected afterHands() {
    const sh = this.heldShell;
    if (!sh.visible) return;
    this.lhPoint(SHELL_P, sh.position);
    sh.quaternion.copy(this.lh.root.quaternion).multiply(SHELL_Q);
  }
}

// ───────────────────────────────────────────── carbine

/**
 * Magazine in the support hand (hand rotation frame): held like a handle — the body across the palm, baseplate on
 * the little-finger side, the top standing out past the index knuckle, fingers wrapped over the front spine.
 * Mag axes → hand: +Y (toward the top) → +X, +Z (rear) → −Y, +X → −Z.
 */
const CMAG_Q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, -1), V(1, 0, 0), V(0, -1, 0)));
const CMAG_Q_INV = CMAG_Q.clone().invert();
/** Where the knob of the charging handle sits in the support hand (hand rotation frame): hooked by the curled fingers. */
const CH_GRIP = V(0.004, 0.128, -0.04);

export class CarbineRig extends GunRig {
  readonly model: CarbineModel;
  readonly spareMag: CarbineMag;
  /** Charging handle held back (last round fired, until the empty reload releases it). */
  chargerLocked = false;
  private chargerPos = 0;
  private chargerVel = 0;
  /** Sustained-fire heat 0..1: the shoulder creeps, the gun buzzes. */
  private heat = 0;
  private magWiggle = 0;
  private MAG = [0];
  private HOLD = [0];
  private CHW = [0];
  private CHP = [0];
  /**
   * Support hand on the handguard (gun space), the shotgun's cupped hold rotated for a rounder, higher fore-end:
   * hand axis `yaw`° right of the bore rising `rise`°, palm rolled `roll`°; palm centre at (cx, C_BORE + dy, z);
   * thumb along the left flank. Dev-overridable (`&cgrip=`).
   */
  static SUPPORT = { yaw: 28, rise: 6, roll: 16, armYaw: 18, armRise: 20, cx: -0.003, dy: -0.004, z: -0.262, thumbY: 0.006, thumbZ: 0.085, arm: 0.3, elbowOut: 0.03 };

  constructor(m: VmMats) {
    const model = buildCarbine(m);
    super(m, model.root, model.muzzle, model.ejectPort, new MuzzleFlash(0.15, 0.2, new THREE.Color(1.0, 0.7, 0.38), 6));
    this.model = model;
    // shouldered and turned in: the left flank (magazine, witness strip, charging handle) faces the eye
    this.setBase(0.12, -0.135, -0.265, 0.01, 0.25, 0.04);
    // running: low ready, muzzle down across the body
    this.sprintPos.set(-0.04, -0.03, 0.05);
    this.sprintRot.set(-0.42, 0.5, 0.42);
    this.rElbow.set(0.33, -0.36, 0.12);
    this.drawP.set(-0.09, -0.16, -0.14);
    this.drawF.set(0.45, 0.35, -0.82);
    this.drawD.set(-0.6, -0.75, -0.2);
    // between the two: quicker to settle than the breacher, heavier than the sidearm
    this.followPos.freq = 5.8; this.followRot.freq = 5.0;
    this.recoilPos.freq = 7.2; this.recoilPos.zeta = 0.55; this.recoilRot.freq = 6.4; this.recoilRot.zeta = 0.5;
    this.armPos.freq = 2.8; this.armRot.freq = 2.6;

    const proxy = carbineProxy();
    // the breacher's grip, guard and trigger: the same firing-hand solve
    this.solveFiringHand(proxy, {
      idx: V(0.0268, -0.0375, 0.041), pinky: V(0.0268, -0.0912, 0.0585), dorsal: V(0.95, 0, 0.3),
      splay: [5, -5, -4, -3],
      thumbTip: V(-0.0265, -0.02, -0.002), thumbMid: V(-0.027, -0.019, 0.026),
      indexTip: V(0.0222, -0.005, -0.05), indexMid: V(0.0232, -0.009, -0.028),
      trigTip: V(-0.003, -0.024, -0.0615), trigMid: V(0.0165, -0.024, -0.056),
    });

    const G = CarbineRig.SUPPORT;
    const fy = G.yaw * DEG, fr = G.rise * DEG, nr = G.roll * DEG;
    const F = V(Math.sin(fy) * Math.cos(fr), Math.sin(fr), -Math.cos(fy) * Math.cos(fr));
    const N = V(-Math.sin(nr), -Math.cos(nr), 0);
    const D = N.clone().addScaledVector(F, -N.dot(F)).normalize();
    const s = this.placeSupportFD(proxy, F, D, V(G.cx, C_BORE + G.dy, G.z), [4, 1, -2, -5], N);
    for (let f = 0; f < 4; f++) wrapFinger(this.lh, s, f, proxy);
    this.lh.apply(s, null, false);
    const tz = this.lh.thumbPoint(0, 0, _v).z - G.thumbZ;
    reachThumb(this.lh, s, V(-0.035, C_BORE + G.thumbY, tz), V(-0.036, C_BORE + G.thumbY - 0.004, tz + 0.026), proxy);
    this.lhPoses.rest = s;
    this.report.lh = gripReport(this.lh, s, proxy);
    this.lh.setPose(s, true);
    const ay = G.armYaw * DEG, ar = G.armRise * DEG;
    _v.set(Math.sin(ay) * Math.cos(ar), Math.sin(ar), -Math.cos(ay) * Math.cos(ar)).applyQuaternion(this.baseQuat);
    this.lElbow.copy(this.lhRestPos).applyQuaternion(this.baseQuat).add(this.basePos).addScaledVector(_v, -G.arm);
    this.lElbow.x -= G.elbowOut;

    // magazine held like a handle (see CMAG_Q)
    this.solveHeld('mag', placed(carbineMagProxy(), CARBINE_MAG_P, CMAG_Q), [2, 0, -3, -6], V(0.036, 0.04, -0.034), V(0.026, 0.03, -0.03));
    // charging handle: knob pinched between thumb and the side of the index finger
    const pinch = POSES.relaxed.slice();
    for (let i = 0; i < POSE_LEN; i++) pinch[i] = POSES.relaxed[i] * 0.35 + POSES.fist[i] * 0.65;
    pinch[1] = 62 * DEG; pinch[2] = 70 * DEG; pinch[3] = 30 * DEG;
    pinch[THUMB] = 10 * DEG; pinch[THUMB + 1] = 20 * DEG; pinch[THUMB + 2] = 4 * DEG; pinch[THUMB + 3] = 18 * DEG; pinch[THUMB + 4] = 26 * DEG;
    this.lhPoses.pinch = pinch;
    // flat hand (seating slap) and a loose open hand
    const flat = POSES.open.slice();
    for (let i = 0; i < POSE_LEN; i++) flat[i] = POSES.open[i] * 0.7 + POSES.relaxed[i] * 0.3;
    this.lhPoses.flat = flat;
    // the firing thumb rides up for the selector / mag release
    const rel = this.rhPoses.grip.slice();
    rel[THUMB + 1] += 0.2; rel[THUMB + 3] += 0.22;
    this.rhPoses.release = rel;

    this.spareMag = buildCarbineMag(m);
    this.spareMag.root.visible = false;
    this.container.add(this.spareMag.root);
    this.solveAds();
  }

  /**
   * Eye relief (m, container space before the viewmodel's x/y squash) from the eye to the rear aperture when aimed,
   * and how far the sight line drops below the eye (m): 0 = the post tip exactly on the point of aim.
   */
  static ADS = { eye: 0.15, drop: 0 };
  /** The ADS base pose: the sight line (rear aperture → front post tip) on the view axis, the rear ring `eye` ahead. */
  solveAds() {
    const A = SIGHT.rear, P = SIGHT.front;
    const dy = P.y - A.y, dz = P.z - A.z;
    this.adsQuat.setFromAxisAngle(_v.set(1, 0, 0), Math.atan(dy / dz));
    this.adsPos.set(0, -CarbineRig.ADS.drop, -CarbineRig.ADS.eye).sub(_v.copy(A).applyQuaternion(this.adsQuat));
    this.hasAds = true;
  }

  get busy() { return this.player.playing; }

  /** `kick` scales the recoil the hands show (aimed: a shorter, straighter push). */
  fire(lastRound: boolean, kick = 1) {
    this.flash.fire();
    this.flash.root.scale.setScalar(1 + (WEAPON_STATS.carbine.ads.flash - 1) * this.ads);
    this.pullTrigger();
    // a straight push into the shoulder with a little flip, then a buzz as the bursts stack up in the springs
    const h = this.heat;
    this.kick((0.42 + h * 0.18) * kick, (2.3 + h * 1.1) * kick, (1.3 + h * 0.6) * kick);
    this.knock((Math.random() - 0.5) * 0.02 * kick, (Math.random() - 0.5) * 0.02 * kick, 0.02 * kick, (Math.random() - 0.5) * 0.35 * kick, (Math.random() - 0.5) * 0.3 * kick, (Math.random() - 0.5) * 0.6 * kick);
    this.heat = Math.min(1, this.heat + 0.11);
    if (lastRound) { this.chargerLocked = true; this.chargerVel = 0; }
  }

  protected handleEvent(id: string) {
    const md = this.model;
    switch (id) {
      case 'magRelease': this.knock(0, 0.02, 0, 0.3, 0, -0.35); break; // thumb on the paddle, a flick of the wrist
      case 'magOut':
        // the seated magazine is now the one in the hand (same count)
        this.spareMag.setRounds(this.lastRounds);
        md.mag.root.visible = false; this.spareMag.root.visible = true;
        break;
      case 'magDrop': this.spareMag.root.visible = false; break;
      case 'magGrab': this.spareMag.setRounds(30); this.spareMag.root.visible = true; break;
      case 'magAttach': this.spareMag.root.visible = false; md.mag.root.visible = true; md.mag.setRounds(30); break;
      // seated: the shove travels up through the receiver, the magazine rattles once
      case 'magIn': this.knock(0.01, 0.14, -0.02, 1.2, 0.2, 0.7); this.magWiggle = 1; break;
      case 'boltRelease': this.chargerLocked = false; this.chargerVel = 0; this.knock(0, -0.03, -0.12, -1.4, 0.1, 0.5); break;
      case 'raised': this.knock(0, -0.02, -0.03, -0.5, 0.05, 0.2); break;
    }
    super.handleEvent(id);
  }

  private lastRounds = 0;
  /** The seated magazine's count (kept by the weapon logic). */
  setRounds(n: number) { this.lastRounds = n; if (this.model.mag.root.visible) this.model.mag.setRounds(n); }

  reload(empty: boolean, onDone: () => void) {
    this.play(empty ? CARBINE_CLIPS.reloadEmpty : CARBINE_CLIPS.reload, () => {
      this.model.mag.root.visible = true; this.spareMag.root.visible = false;
      onDone();
    });
  }

  cancel() {
    if (this.player.playing) this.startXfade();
    this.player.stop();
    this.model.mag.root.visible = true; this.spareMag.root.visible = false;
  }

  protected updateParts(dt: number) {
    const md = this.model;
    this.heat = Math.max(0, this.heat - dt * 1.6);
    // charging handle: held back while locked (+ the hand's extra pull), else it slams home on its spring
    this.CHP[0] = 0;
    this.player.get('chPull', this.CHP);
    const target = (this.chargerLocked ? CH_TRAVEL : 0) + Math.max(0, this.CHP[0]);
    if (target >= this.chargerPos || this.chargerLocked) { this.chargerPos = target; this.chargerVel = 0; }
    else {
      // released: slams forward (fast), a tiny bounce off the stop
      this.chargerVel -= dt * 60;
      this.chargerPos += this.chargerVel * dt;
      if (this.chargerPos <= 0) { this.chargerPos = 0; this.chargerVel = this.chargerVel < -1 ? -this.chargerVel * 0.15 : 0; }
    }
    md.charger.position.z = CH_POS.z + this.chargerPos;
    md.trigger.rotation.x = -this.trigger * 0.25;
    this.MAG[0] = 0;
    this.player.get('magSlide', this.MAG);
    this.magWiggle = Math.max(0, this.magWiggle - dt * 5.5);
    const w = this.magWiggle * this.magWiggle;
    md.mag.root.position.y = -this.MAG[0] - Math.abs(Math.sin(this.magWiggle * 16)) * 0.0018 * w;
    md.mag.root.rotation.x = Math.sin(this.magWiggle * 21) * 0.025 * w;
  }

  /** Steer the hand so the magazine it holds sits in / below the well, or its pinch sits on the charging-handle knob. */
  protected steerSupport(pos: THREE.Vector3, quat: THREE.Quaternion) {
    this.HOLD[0] = 0;
    this.player.get('magHold', this.HOLD);
    const a = clamp(this.HOLD[0], 0, 1);
    if (a > 0) {
      _q3.copy(this.model.magWell.quaternion).multiply(CMAG_Q_INV);
      _v3.set(MAG_SEAT.x, MAG_SEAT.y - this.MAG[0], MAG_SEAT.z);
      _v3.sub(_v.copy(CARBINE_MAG_P).applyQuaternion(_q3));
      this.gunToContainer(_v3, _q3);
      pos.lerp(_v3, a);
      quat.slerp(_q3, a);
    }
    this.CHW[0] = 0;
    this.player.get('chHold', this.CHW);
    const c = clamp(this.CHW[0], 0, 1);
    if (c > 0) {
      // position only: the pinch point onto the knob (where the handle is now)
      this.model.chargerKnob.updateWorldMatrix(true, false);
      this.container.updateWorldMatrix(true, false);
      _v3.setFromMatrixPosition(this.model.chargerKnob.matrixWorld);
      this.container.worldToLocal(_v3);
      _v3.sub(_v.copy(CH_GRIP).applyQuaternion(quat));
      pos.lerp(_v3, c);
    }
  }

  protected afterHands() {
    const sm = this.spareMag.root;
    if (!sm.visible) return;
    this.lhPoint(CARBINE_MAG_P, sm.position);
    sm.quaternion.copy(this.lh.root.quaternion).multiply(CMAG_Q);
  }
}
/** Magazine origin (its top centre) in the support hand's rotation frame — see CMAG_Q. */
const CARBINE_MAG_P = V(0.122, 0.046, -0.026);

// ───────────────────────────────────────────── viewmodel (sway layer + rig switching)

export const VM_SCALE = 1.36;

export class Viewmodel {
  readonly root = new THREE.Group();
  readonly sway = new THREE.Group();
  readonly pistol: PistolRig;
  readonly shotgun: ShotgunRig;
  readonly carbine: CarbineRig;
  active: GunRig | null = null;
  private readonly lookSpring = new Spring3(3.2, 0.42);
  private readonly lookPos = new Spring3(4.5, 0.6);
  private readonly vert = new Spring(4.2, 0.45);
  private readonly sprintS = new Spring(2.6, 0.72);
  /** Holster amount the eye sees: drops with the input, comes back up on a spring (overshoots, settles). */
  private readonly lowS = new Spring(4.4, 0.6);
  /** Bob the gun actually shows: chases the footstep bob a beat late (mass). */
  private readonly bobS = new Spring3(5.5, 0.6);
  private bobAmp = 0;
  private crouch = 0;
  private wall = 0;
  private strafeLean = 0;

  constructor(m: VmMats, layer: number) {
    this.pistol = new PistolRig(m);
    this.shotgun = new ShotgunRig(m);
    this.carbine = new CarbineRig(m);
    this.root.add(this.sway);
    // Narrower effective viewmodel FOV (~54° vs the 72° world camera): squash depth relative to x/y.
    this.root.scale.set(VM_SCALE, VM_SCALE, 1);
    this.sway.add(this.pistol.container, this.shotgun.container, this.carbine.container);
    this.pistol.container.visible = false;
    this.shotgun.container.visible = false;
    this.carbine.container.visible = false;
    this.lowS.reset(1);
    setViewmodel(this.root, layer);
  }

  setActive(id: 'pistol' | 'shotgun' | 'carbine' | null) {
    this.active = id ? this.rig(id) : null;
    this.pistol.container.visible = this.active === this.pistol;
    this.shotgun.container.visible = this.active === this.shotgun;
    this.carbine.container.visible = this.active === this.carbine;
  }
  rig(id: 'pistol' | 'shotgun' | 'carbine'): GunRig { return id === 'pistol' ? this.pistol : id === 'shotgun' ? this.shotgun : this.carbine; }

  /** Jump / land impulses (m/s-ish). */
  bump(v: number) { this.vert.impulse(v); }
  lookImpulse(x: number, y: number) { this.lookSpring.impulse(x, y, 0); }

  update(dt: number, mo: RigMotion) {
    const rig = this.active;
    this.carbine.ads = mo.ads ?? 0;
    this.carbine.adsRaw = mo.adsRaw ?? 0;
    const fs = mo.fovScale ?? 1;
    this.root.scale.set(VM_SCALE * fs, VM_SCALE * fs, 1);
    if (dt <= 0) { rig?.update(0, this.sprintS.x, mo.lower); return; }
    const swk = mo.swayK ?? 1;
    const adsK = mo.ads ?? 0;
    // look lag: rotate opposite to view rotation, spring back
    const lx = clamp(mo.lookX, -0.08, 0.08), ly = clamp(mo.lookY, -0.08, 0.08);
    this.lookSpring.impulse(-ly * 9, -lx * 9, 0);
    this.lookPos.impulse(lx * 0.35, -ly * 0.25, 0);
    this.lookSpring.update(dt);
    this.lookPos.update(dt);
    // vertical inertia (jump/land/air)
    this.vert.target = mo.grounded ? 0 : clamp(-mo.vy * 0.004, -0.02, 0.02);
    this.vert.update(dt);
    this.sprintS.target = mo.sprint;
    this.sprintS.update(dt);
    this.bobAmp = damp(this.bobAmp, mo.grounded ? mo.speed : 0, 8, dt);
    this.crouch = damp(this.crouch, mo.crouch, 8, dt);
    this.wall = damp(this.wall, mo.wall, 10, dt);
    this.strafeLean = damp(this.strafeLean, mo.strafe, 6, dt);
    const spr = clamp(this.sprintS.x, 0, 1.15);

    const t = mo.time;
    const ph = mo.bobPhase;
    const A = this.bobAmp * (1 + spr * 1.5);
    // figure-8 bob as a target; the gun lags it and swings through (arms are not bolted to the head)
    this.bobS.target.set(Math.sin(ph) * 0.011 * A, -Math.abs(Math.cos(ph)) * 0.010 * A + 0.005 * A, Math.sin(ph) * 0.02 * A);
    this.bobS.update(dt);
    const bx = this.bobS.x.x, by = this.bobS.x.y, broll = this.bobS.x.z;
    // running: the arms pump — the muzzle rocks a quarter step behind the body
    const pump = Math.sin(ph - 0.9) * 0.035 * A * spr;
    // breathing: same rhythm as the camera's, arriving late through the arms; slow drift on top
    const br = 1 - Math.min(1, this.bobAmp * 1.5);
    const ix = (noise1(t * 0.35, 1) * 0.0022 + Math.sin(t * 0.9) * 0.0008) * br;
    const iy = (Math.sin(t * 1.35 - 0.95) * 0.0019 + noise1(t * 0.3, 2) * 0.0012) * br;
    const ipitch = (Math.sin(t * 1.35 - 0.6) - Math.sin(t * 1.35)) * 0.0045 * br + noise1(t * 0.25, 3) * 0.004;
    const iyaw = noise1(t * 0.22, 4) * 0.005;

    // holster: follows the input on the way down (must be gone before the swap), springs back up
    const low = clamp(mo.lower, 0, 1);
    const ls = this.lowS;
    ls.target = low * low * (3 - 2 * low);
    ls.update(dt);
    if (ls.x < ls.target) { ls.x = ls.target; if (ls.v < 0) ls.v = 0; }
    const lowE = ls.x;
    const s = this.sway;
    // aimed (swk < 1): the eye is on the sights, so bob, look lag, breathing and lean shrink to a small sway, and a
    // wall no longer pulls the gun back into the face (the sight would pass the near plane)
    const wl = this.wall * (1 - adsK);
    s.position.set(
      (bx + ix + this.lookPos.x.x * 0.06 - this.crouch * 0.008 - this.strafeLean * 0.006) * swk + lowE * 0.05,
      (by + iy + this.vert.x + this.lookPos.x.y * 0.06 - this.crouch * 0.006) * swk - lowE * 0.21,
      wl * 0.11 + this.crouch * 0.006 * swk + lowE * 0.07,
    );
    s.rotation.set(
      (ipitch + pump + this.lookSpring.x.x * 0.05 - this.vert.x * 1.4) * swk - lowE * 0.75 + wl * 0.35,
      (iyaw + this.lookSpring.x.y * 0.05 + pump * 0.4) * swk + wl * 0.3 - lowE * 0.25,
      (broll + this.lookSpring.x.y * 0.06 + this.strafeLean * 0.03 + this.crouch * 0.025) * swk + lowE * 0.4,
      'YXZ',
    );
    rig?.update(dt, spr, low);
  }
}
