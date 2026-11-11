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
import { Hand, Forearm, POSES, POSE_LEN, THUMB, type HandPose } from './hands';
import { buildPistol, buildMagazine, pistolProxy, magProxy, type PistolModel } from './pistol';
import { buildShotgun, shotgunProxy, PUMP_TRAVEL, type ShotgunModel } from './shotgun';
import { buildShell } from './props';
import { ClipPlayer, samplePoseKeys, type Clip } from './anim';
import { MuzzleFlash } from './muzzle';
import { Spring, Spring3, clamp, damp, noise1 } from '../math';
import { setViewmodel } from '../geom';
import { PISTOL_CLIPS, SHOTGUN_CLIPS } from './clips';
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
}

/** Channel scratch buffers. */
const GUN = [0, 0, 0, 0, 0, 0];
const ONE = [0];
const FREE = [0];
const LP = [0, 0, 0], LF = [0, 1, 0], LD = [0, 0, 1];
const POSE_TMP: HandPose = new Array(POSE_LEN).fill(0);

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
  readonly recoilPos = new Spring3(7.5, 0.62);
  readonly recoilRot = new Spring3(6.5, 0.55);
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
  }

  play(clip: Clip, onDone?: () => void, startAt = 0) {
    this.player.play(clip, (id) => this.handleEvent(id), onDone, startAt);
  }

  protected handleEvent(id: string) { this.onEvent(id); }

  /** Procedural recoil kick. */
  kick(back: number, up: number, side: number) {
    this.recoilPos.impulse(side * 0.2 * (Math.random() - 0.5), up * 0.15, back);
    this.recoilRot.impulse(up, side * (Math.random() - 0.5), side * (Math.random() - 0.5) * 1.6);
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

  update(dt: number, sprint: number) {
    this.player.update(dt);
    this.recoilPos.update(dt);
    this.recoilRot.update(dt);
    this.flash.update(dt);
    this.triggerT -= dt;
    this.triggerHold -= dt;
    this.trigger = damp(this.trigger, this.triggerT > 0 ? 1 : 0, this.triggerT > 0 ? 60 : 18, dt);
    this.onTrigger = damp(this.onTrigger, this.triggerHold > 0 ? 1 : 0, this.triggerHold > 0 ? 40 : 7, dt);

    // gun transform
    GUN.fill(0);
    this.player.get('gun', GUN);
    const g = this.gun;
    const sp = this.player.playing ? sprint * 0.3 : sprint;
    _v.set(GUN[0] + this.sprintPos.x * sp, GUN[1] + this.sprintPos.y * sp, GUN[2] + this.sprintPos.z * sp).add(this.recoilPos.x);
    g.position.copy(_v.applyQuaternion(this.baseQuat)).add(this.basePos);
    _e.set(GUN[3] + this.sprintRot.x * sp + this.recoilRot.x.x, GUN[4] + this.sprintRot.y * sp + this.recoilRot.x.y, GUN[5] + this.sprintRot.z * sp + this.recoilRot.x.z);
    g.quaternion.copy(this.baseQuat).multiply(_q.setFromEuler(_e));

    this.updateParts(dt);

    // left hand: socket (rest ↔ live pump) blended toward an authored free pose (all gun space)
    ONE[0] = 1;
    this.player.get('lhAttach', ONE);
    _v2.copy(this.lhRestPos).lerp(this.lhLivePos, clamp(ONE[0], 0, 1));
    _q2.copy(this.lhRestQuat);
    FREE[0] = 0;
    if (this.player.get('lhFree', FREE) && FREE[0] > 0.0005) {
      const fw = clamp(FREE[0], 0, 1);
      this.player.get('lhP', LP); this.player.get('lhF', LF); this.player.get('lhD', LD);
      _v.set(LP[0], LP[1], LP[2]);
      _v2.lerp(_v, fw);
      orientFD(_q, _fv.set(LF[0], LF[1], LF[2]), _dv.set(LD[0], LD[1], LD[2]));
      _q2.slerp(_q, fw);
    }
    this.steerSupport(_v2, _q2);
    this.lh.root.position.copy(_v2.applyQuaternion(g.quaternion)).add(g.position);
    this.lh.root.quaternion.copy(g.quaternion).multiply(_q2);

    // fingers: clip pose keys (continuous blend) or the idle holds; trigger finger indexes when not shooting
    const c = this.player.clip, t = this.player.t;
    if (c?.poses?.lh) samplePoseKeys(c.poses.lh, t, this.lhPoses, this.lh.target);
    else this.lh.setPose(this.lhPoses.rest);
    if (c?.poses?.rh) samplePoseKeys(c.poses.rh, t, this.rhPoses, this.rh.target);
    else this.rh.setPose(this.rhPoses.grip);
    const tr = this.rhPoses.trigger, rt = this.rh.target, k = this.onTrigger;
    for (let i = 0; i < 4; i++) rt[i] += (tr[i] - rt[i]) * k;
    const io = this.rh.offset;
    io[2] = this.trigger * 0.16; io[3] = this.trigger * 0.14;
    this.rh.update(dt);
    this.lh.update(dt);

    // forearms aim from the wrist to an elbow that follows the gun loosely
    this.container.updateMatrix();
    _v.copy(g.position).sub(this.basePos).multiplyScalar(0.55);
    this.orientArm(this.rf, this.rh.root, _v);
    this.orientArm(this.lf, this.lh.root, _v);
    this.afterHands();
  }

  /** Point given in the support hand's rotation frame → container space. */
  protected lhPoint(local: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(local).applyQuaternion(this.lh.root.quaternion).add(this.lh.root.position);
  }
  /** Hook: adjust the support hand's gun-space transform (e.g. steer it to seat a magazine). */
  protected steerSupport(_pos: THREE.Vector3, _quat: THREE.Quaternion) {}
  protected afterHands() {}

  private readonly _wrist = new THREE.Vector3();
  private readonly _dors = new THREE.Vector3();
  private readonly _elb = new THREE.Vector3();
  private orientArm(arm: Forearm, hand: THREE.Object3D, follow: THREE.Vector3) {
    // hand root world → container space
    hand.updateWorldMatrix(true, false);
    this.container.updateWorldMatrix(true, false);
    _m.copy(this.container.matrixWorld).invert().multiply(hand.matrixWorld);
    this._wrist.setFromMatrixPosition(_m);
    _m.extractRotation(_m);
    this._dors.set(0, 0, 1).transformDirection(_m);
    // mirrored hands have det<0; transformDirection keeps +Z mapping (mirror is on X)
    const elbow = arm === this.rf ? this.rElbow : this.lElbow;
    this._elb.copy(elbow).add(follow);
    arm.orient(this._wrist, this._elb, this._dors);
  }

  /** Weapon-specific moving parts. */
  protected abstract updateParts(dt: number): void;
  abstract get busy(): boolean;
}

// ───────────────────────────────────────────── pistol

/** Spare magazine in the support hand (hand rotation frame): flat against the palm, feed lips toward the fingertips. */
const MAG_P = V(0.004, 0.168, -0.0255);
const MAG_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
const MAG_Q_INV = MAG_Q.clone().invert();

export class PistolRig extends GunRig {
  readonly model: PistolModel;
  /** Slide locked back on empty. */
  slideLocked = false;
  private slideKick = 0;
  private hammerRot = 0;
  readonly spareMag: THREE.Group;
  readonly magRest = new THREE.Vector3();
  private SLIDE = [0];
  private MAG = [0];
  private ALIGN = [0];

  constructor(m: VmMats) {
    const model = buildPistol(m);
    super(m, model.root, model.muzzle, model.ejectPort, new MuzzleFlash(0.1, 0.12));
    this.model = model;
    this.setBase(0.1, -0.066, -0.365, 0.03, 0.16, 0.05);
    this.sprintPos.set(-0.03, -0.03, 0.03);
    this.sprintRot.set(-0.42, 0.5, 0.3);
    this.rElbow.set(0.27, -0.4, 0.0);
    this.lElbow.set(-0.02, -0.45, -0.06);

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
    this.solveHeld('mag', placed(magProxy(), MAG_P, MAG_Q), [2, 0, -2, -4], V(0.004, 0.09, -0.045), V(0.017, 0.066, -0.042));
    // palm heel pushing the baseplate home; thumb flick for the slide stop
    this.lhPoses.push = POSES.open;
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
    this.kick(0.75, 7.0, 3.0);
    if (lastRound) this.slideLocked = true;
  }

  /** Called by the clip events. */
  protected handleEvent(id: string) {
    switch (id) {
      case 'magDrop': this.model.mag.visible = false; break;
      case 'magGrab': this.spareMag.visible = true; break;
      case 'magAttach': this.spareMag.visible = false; this.model.mag.visible = true; break;
      case 'slideRelease': this.slideLocked = false; break;
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
    this.player.stop();
    this.model.mag.visible = true; this.spareMag.visible = false;
  }

  protected updateParts(dt: number) {
    const md = this.model;
    // slide: firing kick (fast back, spring forward), locked back on empty, or clip-driven
    if (this.slideKick > 0) this.slideKick = Math.max(0, this.slideKick - dt / 0.075);
    const k = this.slideKick;
    const kickPos = k > 0 ? (k > 0.8 ? (1 - k) / 0.2 : Math.pow(k / 0.8, 1.6)) * 0.031 : 0;
    let slide = Math.max(kickPos, this.slideLocked ? 0.029 : 0);
    if (this.player.get('slide', this.SLIDE)) slide = this.slideLocked ? Math.max(0.029, this.SLIDE[0]) : this.SLIDE[0];
    md.slide.position.z = slide;
    // slide stop rises when locked
    md.slideStop.rotation.x = damp(md.slideStop.rotation.x, this.slideLocked ? -0.09 : 0, 30, dt);
    // hammer: cocked by the slide, rests cocked (single action)
    this.hammerRot = Math.max(0.42, slide / 0.031 * 0.75);
    md.hammer.rotation.x = this.hammerRot;
    md.trigger.rotation.x = -this.trigger * 0.22;
    // magazine slide in/out of the well
    this.MAG[0] = 0;
    this.player.get('magSlide', this.MAG);
    md.mag.position.y = this.magRest.y - this.MAG[0];
  }

  /** While seating the magazine the hand is steered so the magazine it holds lines up with the well. */
  protected steerSupport(pos: THREE.Vector3, quat: THREE.Quaternion) {
    this.ALIGN[0] = 0;
    this.player.get('magAlign', this.ALIGN);
    const a = clamp(this.ALIGN[0], 0, 1);
    if (a <= 0) return;
    const well = this.model.magWell;
    _q3.copy(well.quaternion).multiply(MAG_Q_INV);
    _v3.set(0, this.magRest.y - this.MAG[0], 0).applyQuaternion(well.quaternion).add(well.position);
    _v3.sub(_v.copy(MAG_P).applyQuaternion(_q3));
    pos.lerp(_v3, a);
    quat.slerp(_q3, a);
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

  constructor(m: VmMats) {
    const model = buildShotgun(m);
    super(m, model.root, model.muzzle, model.ejectPort, new MuzzleFlash(0.24, 0.3));
    this.model = model;
    this.setBase(0.112, -0.112, -0.25, 0.012, 0.085, 0.03);
    this.sprintPos.set(-0.04, -0.02, 0.03);
    this.sprintRot.set(-0.2, 0.55, 0.28);
    this.rElbow.set(0.32, -0.38, 0.12);
    this.lElbow.set(-0.17, -0.37, -0.33);

    const proxy = shotgunProxy();
    this.solveFiringHand(proxy, {
      idx: V(0.0268, -0.0375, 0.041), pinky: V(0.0268, -0.0912, 0.0585), dorsal: V(0.95, 0, 0.3),
      splay: [5, -5, -4, -3],
      thumbTip: V(-0.0265, -0.02, -0.002), thumbMid: V(-0.027, -0.019, 0.026),
      indexTip: V(0.0222, -0.005, -0.05), indexMid: V(0.0232, -0.009, -0.028),
      trigTip: V(-0.003, -0.024, -0.0615), trigMid: V(0.0165, -0.024, -0.056),
    });

    // support hand cups the pump from below: fingers up the far side, thumb along the near side
    const s = this.placeSupport(V(-0.0185, -0.015, -0.336), V(0.0051, -0.0192, -0.2848), V(-0.571, -0.813, 0.0), [4, 0, -3, -6]);
    for (let f = 0; f < 4; f++) wrapFinger(this.lh, s, f, proxy);
    reachThumb(this.lh, s, V(-0.03, 0.026, -0.353), V(-0.034, 0.013, -0.326), proxy);
    this.lhPoses.rest = s;
    this.report.lh = gripReport(this.lh, s, proxy);
    this.lh.setPose(s, true);

    // shell pinched across the fingers under the thumb
    const shell = capsuleSdf(V(SHELL_P.x + 0.006, SHELL_P.y, SHELL_P.z), V(SHELL_P.x + 0.058, SHELL_P.y, SHELL_P.z), 0.0108);
    this.solveHeld('shell', shell, [3, 0, -2, -5], V(0.012, 0.1, -0.04), V(0.022, 0.076, -0.036));
    const reach = this.lhPoses.shell.slice();
    for (let i = 0; i < POSE_LEN; i++) reach[i] = reach[i] * 0.55 + POSES.open[i] * 0.45;
    this.lhPoses.reach = reach;

    this.heldShell = buildShell(m);
    this.heldShell.visible = false;
    this.container.add(this.heldShell);
  }

  get busy() { return this.player.playing; }

  fire(onPumped: () => void) {
    this.flash.fire();
    this.pullTrigger();
    this.kick(1.5, 11, 4.5);
    this.play(SHOTGUN_CLIPS.pump, onPumped);
  }

  protected handleEvent(id: string) {
    switch (id) {
      case 'shellGrab': this.heldShell.visible = true; this.holding = true; break;
      case 'shellIn': this.heldShell.visible = false; this.holding = false; break;
    }
    super.handleEvent(id);
  }

  cancel() {
    this.player.stop();
    this.heldShell.visible = false; this.holding = false;
  }

  protected updateParts(_dt: number) {
    const md = this.model;
    this.PUMP[0] = 0;
    this.player.get('pump', this.PUMP);
    const p = clamp(this.PUMP[0], 0, 1) * PUMP_TRAVEL;
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
      _v3.copy(slot.position).sub(_v.copy(SHELL_P).applyQuaternion(SADDLE_HAND_Q));
      pos.lerp(_v3, gw);
      quat.slerp(SADDLE_HAND_Q, gw);
    }
    if (a > 0) {
      const port = this.model.loadPort.position;
      _q3.copy(SHELL_PORT_Q).multiply(SHELL_Q_INV);
      _v3.set(port.x, port.y - 0.027 + sl * 0.034, port.z + 0.03 - sl * 0.054);
      _v3.sub(_v.copy(SHELL_P).applyQuaternion(_q3));
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

// ───────────────────────────────────────────── viewmodel (sway layer + rig switching)

export const VM_SCALE = 1.36;

export class Viewmodel {
  readonly root = new THREE.Group();
  readonly sway = new THREE.Group();
  readonly pistol: PistolRig;
  readonly shotgun: ShotgunRig;
  active: GunRig | null = null;
  private readonly lookSpring = new Spring3(3.2, 0.42);
  private readonly lookPos = new Spring3(4.5, 0.6);
  private readonly vert = new Spring(4.2, 0.45);
  private readonly sprintS = new Spring(3.0, 0.9);
  private bobAmp = 0;
  private crouch = 0;
  private wall = 0;
  private strafeLean = 0;

  constructor(m: VmMats, layer: number) {
    this.pistol = new PistolRig(m);
    this.shotgun = new ShotgunRig(m);
    this.root.add(this.sway);
    // Narrower effective viewmodel FOV (~54° vs the 72° world camera): squash depth relative to x/y.
    this.root.scale.set(VM_SCALE, VM_SCALE, 1);
    this.sway.add(this.pistol.container, this.shotgun.container);
    this.pistol.container.visible = false;
    this.shotgun.container.visible = false;
    setViewmodel(this.root, layer);
  }

  setActive(id: 'pistol' | 'shotgun' | null) {
    this.active = id === 'pistol' ? this.pistol : id === 'shotgun' ? this.shotgun : null;
    this.pistol.container.visible = this.active === this.pistol;
    this.shotgun.container.visible = this.active === this.shotgun;
  }

  /** Jump / land impulses (m/s-ish). */
  bump(v: number) { this.vert.impulse(v); }
  lookImpulse(x: number, y: number) { this.lookSpring.impulse(x, y, 0); }

  update(dt: number, mo: RigMotion) {
    const rig = this.active;
    if (dt <= 0) { rig?.update(0, this.sprintS.x); return; }
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

    const t = mo.time;
    const ph = mo.bobPhase;
    const A = this.bobAmp * (1 + this.sprintS.x * 0.8);
    // figure-8 bob
    const bx = Math.sin(ph) * 0.011 * A;
    const by = -Math.abs(Math.cos(ph)) * 0.010 * A + 0.005 * A;
    const broll = Math.sin(ph) * 0.02 * A;
    // breathing / idle drift
    const br = 1 - Math.min(1, this.bobAmp * 1.5);
    const ix = (noise1(t * 0.35, 1) * 0.0022 + Math.sin(t * 0.9) * 0.0008) * br;
    const iy = (Math.sin(t * 1.55) * 0.0016 + noise1(t * 0.3, 2) * 0.0012) * br;
    const ipitch = Math.sin(t * 1.55 + 0.6) * 0.004 * br + noise1(t * 0.25, 3) * 0.004;
    const iyaw = noise1(t * 0.22, 4) * 0.005;

    const low = mo.lower;
    const lowE = low * low * (3 - 2 * low);
    const s = this.sway;
    s.position.set(
      bx + ix + this.lookPos.x.x * 0.06 - this.crouch * 0.008 - this.strafeLean * 0.006,
      by + iy + this.vert.x + this.lookPos.x.y * 0.06 - this.crouch * 0.006 - lowE * 0.24,
      this.wall * 0.11 + this.crouch * 0.006 + lowE * 0.05,
    );
    s.rotation.set(
      ipitch + this.lookSpring.x.x * 0.05 - this.vert.x * 1.4 - lowE * 0.7 + this.wall * 0.35,
      iyaw + this.lookSpring.x.y * 0.05 + this.wall * 0.3,
      broll + this.lookSpring.x.y * 0.06 + this.strafeLean * 0.03 + this.crouch * 0.025 + lowE * 0.25,
      'YXZ',
    );
    rig?.update(dt, this.sprintS.x);
  }
}
