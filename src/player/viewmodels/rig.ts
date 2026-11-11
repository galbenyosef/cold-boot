/**
 * First-person weapon rigs: gun + gloved hands + forearms, keyframed reload/pump choreography and
 * procedural recoil. `Viewmodel` layers sway / bob / sprint / inertia on top and owns both rigs.
 *
 * Spaces: the Viewmodel root is a child of the camera. Each rig has a `container` (child of root);
 * gun base pose, hands and forearms live in container space.
 */
import * as THREE from 'three';
import type { VmMats } from './mats';
import { Hand, Forearm, poseDeg, type HandPose } from './hands';
import { buildPistol, buildMagazine, P_GRIP_ANGLE, type PistolModel } from './pistol';
import { buildShotgun, PUMP_TRAVEL, type ShotgunModel } from './shotgun';
import { buildShell } from './props';
import { ClipPlayer, type Clip } from './anim';
import { MuzzleFlash } from './muzzle';
import { Spring, Spring3, clamp, damp, noise1 } from '../math';
import { setViewmodel } from '../geom';
import { PISTOL_CLIPS, SHOTGUN_CLIPS } from './clips';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _fv = new THREE.Vector3(), _dv = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const MAG_IN_HAND = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
const SHELL_IN_HAND = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
const SHELL_ALIGN = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

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
const HOLD = new THREE.Vector3(0, 0.06, -0.035);

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
  readonly muzzleObj: THREE.Object3D;
  readonly ejectObj: THREE.Object3D;
  /** Callback for clip events. */
  onEvent: (id: string) => void = () => {};
  readonly lhPoses: Record<string, HandPose> = {};
  rhGrip!: HandPose;

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

  protected handleEvent(id: string) {
    if (id.startsWith('lh:')) {
      const p = this.lhPoses[id.slice(3)];
      if (p) this.lh.setPose(p);
      return;
    }
    this.onEvent(id);
  }

  /** Procedural recoil kick. */
  kick(back: number, up: number, side: number) {
    this.recoilPos.impulse(side * 0.2 * (Math.random() - 0.5), up * 0.15, back);
    this.recoilRot.impulse(up, side * (Math.random() - 0.5), side * (Math.random() - 0.5) * 1.6);
  }

  pullTrigger() { this.triggerT = 0.07; }

  /** World position of the muzzle. */
  muzzleWorld(out: THREE.Vector3) { return this.muzzleObj.getWorldPosition(out); }
  ejectWorld(out: THREE.Vector3) { return this.ejectObj.getWorldPosition(out); }

  update(dt: number, sprint: number) {
    this.player.update(dt);
    this.recoilPos.update(dt);
    this.recoilRot.update(dt);
    this.flash.update(dt);
    this.triggerT -= dt;
    this.trigger = damp(this.trigger, this.triggerT > 0 ? 1 : 0, this.triggerT > 0 ? 60 : 18, dt);

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
    this.lh.root.position.copy(_v2.applyQuaternion(g.quaternion)).add(g.position);
    this.lh.root.quaternion.copy(g.quaternion).multiply(_q2);

    // fingers
    const io = this.rh.offset;
    io[1] = -this.trigger * 0.28; io[2] = this.trigger * 0.42; io[3] = this.trigger * 0.2;
    this.rh.update(dt);
    this.lh.update(dt);

    // forearms aim from the wrist to an elbow that follows the gun loosely
    this.container.updateMatrix();
    _v.copy(g.position).sub(this.basePos).multiplyScalar(0.55);
    this.orientArm(this.rf, this.rh.root, _v);
    this.orientArm(this.lf, this.lh.root, _v);
    this.afterHands();
  }

  /** Left-hand hold point in container space. */
  protected holdPoint(out: THREE.Vector3) {
    return out.copy(HOLD).applyQuaternion(this.lh.root.quaternion).add(this.lh.root.position);
  }
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

export class PistolRig extends GunRig {
  readonly model: PistolModel;
  /** Slide locked back on empty. */
  slideLocked = false;
  private slideKick = 0;
  private slideHold = 0;
  private hammerRot = 0;
  readonly spareMag: THREE.Group;
  private magState: 'gun' | 'hand' | 'gone' = 'gun';
  readonly magRest = new THREE.Vector3();
  private SLIDE = [0];
  private MAG = [0];

  constructor(m: VmMats) {
    const model = buildPistol(m);
    super(m, model.root, model.muzzle, model.ejectPort, new MuzzleFlash(0.1, 0.12));
    this.model = model;
    this.setBase(0.075, -0.083, -0.3, 0.03, 0.22, 0.09);
    this.sprintPos.set(-0.02, -0.022, 0.015);
    this.sprintRot.set(-0.38, 0.42, 0.32);
    this.rElbow.set(0.2, -0.62, -0.06);
    this.lElbow.set(-0.16, -0.62, -0.08);

    // right hand around the grip
    const a = P_GRIP_ANGLE;
    orientFD(this.rh.root.quaternion, { x: 0.12, y: -Math.sin(a) - 0.05, z: -Math.cos(a) }, { x: 1, y: 0.15, z: 0.25 });
    this.rh.root.position.set(0.018, -0.014, 0.052);
    this.rhGrip = poseDeg([[27, 28, 66, 34], [0, 80, 96, 45], [-3, 84, 94, 44], [-6, 88, 90, 40]], [8, 8, -14, 10, 6]);
    this.rh.setPose(this.rhGrip, true);

    // left hand support socket
    this.lhRestPos.set(-0.05, -0.05, 0.066);
    orientFD(this.lhRestQuat, { x: 0.15, y: -0.35, z: -0.92 }, { x: -1, y: -0.1, z: 0.1 });
    this.lhLivePos.copy(this.lhRestPos);
    this.lhPoses.support = poseDeg([[0, 62, 70, 30], [0, 66, 72, 30], [-2, 70, 70, 30], [-5, 74, 70, 28]], [-10, -6, -12, 6, 4]);
    this.lhPoses.open = poseDeg([[4, 14, 18, 10], [0, 16, 20, 10], [-4, 20, 24, 12], [-8, 24, 26, 14]], [-14, -10, 8, 6, 6]);
    this.lhPoses.mag = poseDeg([[6, 55, 60, 30], [0, 70, 70, 34], [-4, 76, 72, 34], [-8, 80, 70, 32]], [-2, 18, 4, 16, 12]);
    this.lhPoses.pinch = poseDeg([[2, 40, 60, 40], [0, 70, 80, 40], [-3, 78, 80, 36], [-6, 82, 78, 34]], [10, 30, 0, 20, 20]);
    this.lh.setPose(this.lhPoses.support, true);

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
      case 'magDrop': this.model.mag.visible = false; this.magState = 'gone'; break;
      case 'magGrab': this.spareMag.visible = true; this.magState = 'hand'; break;
      case 'magAttach':
        this.spareMag.visible = false; this.model.mag.visible = true; this.magState = 'gun'; break;
      case 'slideRelease': this.slideLocked = false; break;
    }
    super.handleEvent(id);
  }

  reload(empty: boolean, onDone: () => void) {
    this.play(empty ? PISTOL_CLIPS.reloadEmpty : PISTOL_CLIPS.reload, () => {
      this.lh.setPose(this.lhPoses.support);
      this.model.mag.visible = true; this.spareMag.visible = false; this.magState = 'gun';
      onDone();
    });
  }

  cancel() {
    this.player.stop();
    this.model.mag.visible = true; this.spareMag.visible = false; this.magState = 'gun';
    this.lh.setPose(this.lhPoses.support);
  }

  protected updateParts(dt: number) {
    const md = this.model;
    // slide: firing kick (fast back, spring forward), locked back on empty, or clip-driven
    if (this.slideKick > 0) this.slideKick = Math.max(0, this.slideKick - dt / 0.075);
    const k = this.slideKick;
    const kickPos = k > 0 ? (k > 0.8 ? (1 - k) / 0.2 : Math.pow(k / 0.8, 1.6)) * 0.031 : 0;
    let slide = Math.max(kickPos, this.slideLocked ? 0.029 : 0);
    if (this.player.get('slide', this.SLIDE)) slide = this.slideLocked ? Math.max(0.029, this.SLIDE[0]) : this.SLIDE[0];
    this.slideHold = slide;
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
    void this.magState;
  }

  private ALIGN = [0];
  protected afterHands() {
    const sm = this.spareMag;
    if (!sm.visible) return;
    const md = this.model, g = this.gun;
    this.ALIGN[0] = 0;
    this.player.get('magAlign', this.ALIGN);
    const a = clamp(this.ALIGN[0], 0, 1);
    // well-aligned pose (container space)
    _q.copy(g.quaternion).multiply(md.magWell.quaternion);
    _v.set(0, this.magRest.y - this.MAG[0], 0).applyQuaternion(md.magWell.quaternion).add(md.magWell.position).applyQuaternion(g.quaternion).add(g.position);
    // in-hand pose: mag top 0.07 above the palm along the fingers
    _q2.copy(this.lh.root.quaternion).multiply(MAG_IN_HAND);
    this.holdPoint(_v2);
    _v2.add(_x.set(0, 0.062, 0).applyQuaternion(_q2));
    sm.position.copy(_v2).lerp(_v, a);
    sm.quaternion.copy(_q2).slerp(_q, Math.max(a, 0.6));
  }
}

// ───────────────────────────────────────────── shotgun

export class ShotgunRig extends GunRig {
  readonly model: ShotgunModel;
  private PUMP = [0];
  private pumpKick = 0;
  readonly heldShell: THREE.Group;
  /** How many side-saddle shells to show (follows reserve). */
  saddleCount = 4;
  holding = false;

  constructor(m: VmMats) {
    const model = buildShotgun(m);
    super(m, model.root, model.muzzle, model.ejectPort, new MuzzleFlash(0.24, 0.3));
    this.model = model;
    this.setBase(0.09, -0.112, -0.28, 0.025, 0.05, 0.05);
    this.sprintPos.set(-0.03, -0.012, 0.03);
    this.sprintRot.set(-0.22, 0.5, 0.3);
    this.rElbow.set(0.2, -0.38, 0.14);
    this.lElbow.set(-0.32, -0.44, -0.12);

    const a = 0.36;
    orientFD(this.rh.root.quaternion, { x: 0.1, y: -Math.sin(a) - 0.05, z: -Math.cos(a) }, { x: 1, y: 0.15, z: 0.25 });
    this.rh.root.position.set(0.026, -0.022, 0.085);
    this.rhGrip = poseDeg([[2, 16, 48, 22], [0, 78, 88, 40], [-3, 82, 86, 38], [-6, 86, 82, 36]], [6, 4, -2, 8, 6]);
    this.rh.setPose(this.rhGrip, true);

    // left hand on the pump: palm under/left of the fore-end, fingers wrap up the right side
    this.lhRestPos.set(-0.041, -0.021, -0.257);
    orientFD(this.lhRestQuat, { x: 0.5, y: 0.02, z: -0.86 }, { x: -0.4, y: -0.9, z: -0.1 });
    this.lhPoses.pump = poseDeg([[0, 74, 78, 36], [0, 66, 66, 28], [-3, 70, 64, 26], [-6, 72, 62, 24]], [-6, 8, -10, 6, 6]);
    this.lhPoses.open = poseDeg([[4, 14, 18, 10], [0, 16, 20, 10], [-4, 20, 24, 12], [-8, 24, 26, 14]], [-14, -10, 8, 6, 6]);
    this.lhPoses.shell = poseDeg([[2, 40, 50, 30], [0, 62, 70, 34], [-3, 78, 80, 36], [-6, 84, 80, 34]], [18, 30, 4, 18, 14]);
    this.lh.setPose(this.lhPoses.pump, true);

    this.heldShell = buildShell(m);
    this.heldShell.visible = false;
    this.container.add(this.heldShell);
  }

  get busy() { return this.player.playing; }

  fire(onPumped: () => void) {
    this.flash.fire();
    this.pullTrigger();
    this.kick(1.5, 11, 4.5);
    this.pumpKick = 1;
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
    this.lh.setPose(this.lhPoses.pump);
  }

  protected updateParts(dt: number) {
    const md = this.model;
    this.PUMP[0] = 0;
    this.player.get('pump', this.PUMP);
    const p = clamp(this.PUMP[0], 0, 1) * PUMP_TRAVEL;
    md.pump.position.z = p;
    md.bolt.position.z = p * 0.85;
    md.trigger.rotation.x = -this.trigger * 0.25;
    this.lhLivePos.copy(this.lhRestPos);
    this.lhLivePos.z += p;
    this.pumpKick = Math.max(0, this.pumpKick - dt * 4);
    const vis = this.saddleCount - (this.holding ? 1 : 0);
    for (let i = 0; i < md.saddle.length; i++) md.saddle[i].visible = i < vis;
  }

  private SA = [0];
  private SS = [0];
  protected afterHands() {
    const sh = this.heldShell;
    if (!sh.visible) return;
    const g = this.gun, port = this.model.loadPort.position;
    this.SA[0] = 0; this.SS[0] = 0;
    this.player.get('shellAlign', this.SA);
    this.player.get('shellSlide', this.SS);
    const a = clamp(this.SA[0], 0, 1), sl = clamp(this.SS[0], 0, 1);
    _v.set(port.x, port.y - 0.026 + sl * 0.034, port.z + 0.026 - sl * 0.05).applyQuaternion(g.quaternion).add(g.position);
    _q.copy(g.quaternion).multiply(SHELL_ALIGN);
    _q2.copy(this.lh.root.quaternion).multiply(SHELL_IN_HAND);
    this.holdPoint(_v2);
    _v2.add(_x.set(0, -0.03, 0).applyQuaternion(_q2));
    sh.position.copy(_v2).lerp(_v, a);
    sh.quaternion.copy(_q2).slerp(_q, a);
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
