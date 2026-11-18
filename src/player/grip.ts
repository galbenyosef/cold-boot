/**
 * Stage 3d D7 / §8.3: the hands of a GRIP (`Player.grip`) — both gloved hands on a handle (crank, pull, pump, lever,
 * pin), in the WORLD like the palm scan's hand (`palm.ts`): true scale, lit by the room, closed round the handle.
 *
 * Each hand is the viewmodel's `Hand` + `Forearm` + a plain upper-arm sleeve to a shoulder under the camera, solved as
 * a two-bone chain every frame (the palm hand's arm). The handle frame comes from the grip: `N` = the outward normal
 * of the face the player works from (toward him), `T` = his right along the face, `U` = up along the face. The motion
 * clip moves the grasp points in that frame:
 *   crank  — both hands on one crank knob going round a 0.15 m circle, 0.6 s per turn (only while advancing)
 *   pull   — a braced two-handed draw: the hands come out along N by 0.28 m with the progress (the body leans back)
 *   pump   — a lever stroke every 0.7 s: the hands go down 0.18 m and back up (only while advancing)
 *   lever  — one heavy pull: down 0.32 m and 0.08 m toward him with the progress
 *   pin    — twist-and-draw: a quarter turn about N over the first half, then drawn 0.16 m out along N
 * `begin` brings the hands up from below the view onto the handle (0.3 s); `release` takes them back out (0.28 s).
 */
import * as THREE from 'three';
import type { VmMats } from './viewmodels/mats';
import { Forearm, Hand, POSES, POSE_LEN, type HandPose } from './viewmodels/hands';
import { clamp, smooth01 } from './math';

export type GripMotion = 'crank' | 'pull' | 'pump' | 'lever' | 'pin';

const DEG = Math.PI / 180;
const REACH_S = 0.3, LEAVE_S = 0.28;
const FOREARM = 0.47, UPPER = 0.33;
/** Half the spacing of the two hands along the handle (two-handed bar); the crank knob is narrower. */
const SPREAD = 0.12, SPREAD_CRANK = 0.055;
export const CRANK_TURN = 0.6, PUMP_STROKE = 0.7;
/** Grasp centre in the hand's frame (wrist origin, +Y fingers, +Z back of the hand): inside the closed fingers. */
const GRASP = new THREE.Vector3(0, 0.085, -0.03);
/** The closed-on-a-bar pose: between open and a fist (a ~35 mm handle). */
const CLOSED: HandPose = POSES.open.map((o, i) => o + (POSES.fist[i] - o) * 0.78);

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const UPV = new THREE.Vector3(0, 1, 0);

function orientFD(q: THREE.Quaternion, F: THREE.Vector3, D: THREE.Vector3): THREE.Quaternion {
  _y.copy(F).normalize();
  _z.copy(D).addScaledVector(_y, -D.dot(_y)).normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return q.setFromRotationMatrix(_m);
}

class Arm {
  readonly hand: Hand;
  readonly fore: Forearm;
  readonly upper: THREE.Mesh;
  readonly elbow: THREE.Mesh;
  readonly seatP = new THREE.Vector3();
  readonly seatQ = new THREE.Quaternion();
  readonly restP = new THREE.Vector3();
  readonly restQ = new THREE.Quaternion();
  readonly pose: HandPose = POSES.relaxed.slice();
  constructor(m: VmMats, readonly left: boolean, root: THREE.Object3D) {
    this.hand = new Hand(m, left);
    this.fore = new Forearm(m, false);
    const ug = new THREE.CylinderGeometry(0.06, 0.074, 1, 20, 1, true);
    ug.translate(0, 0.5, 0);
    this.upper = new THREE.Mesh(ug, m.sleeve);
    this.elbow = new THREE.Mesh(new THREE.SphereGeometry(0.063, 16, 12), m.sleeve);
    root.add(this.hand.root, this.fore.root, this.upper, this.elbow);
  }
}

export class GripHands {
  readonly root = new THREE.Group();
  private readonly arms: [Arm, Arm];
  mode: 'idle' | 'reach' | 'hold' | 'leave' = 'idle';
  /** 0 = out of view, 1 = on the handle. */
  s = 0;
  motion: GripMotion = 'pull';
  /** Clip clock (s): advances only while the grip advances (crank turns, pump strokes). */
  phase = 0;
  progress = 0;
  private readonly P = new THREE.Vector3();
  private readonly N = new THREE.Vector3();
  private readonly T = new THREE.Vector3();
  private readonly U = new THREE.Vector3();
  /** The current grasp point (world) of each hand, for tests. */
  readonly grasp = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly cam = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly tmp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  constructor(m: VmMats) {
    this.arms = [new Arm(m, false, this.root), new Arm(m, true, this.root)];
    this.root.traverse((o) => { o.frustumCulled = false; if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    this.root.visible = false;
    this.root.name = 'grip_hands';
  }

  get active(): boolean { return this.mode !== 'idle'; }
  get on(): boolean { return this.mode === 'hold'; }

  /** Set the handle frame and bring the hands onto it. `yaw`: the player's facing (for a vertical normal). */
  begin(point: THREE.Vector3, normal: THREE.Vector3, motion: GripMotion, yaw: number): void {
    this.P.copy(point);
    const N = this.N.copy(normal);
    if (N.lengthSq() < 1e-8) N.set(Math.sin(yaw), 0, Math.cos(yaw));
    N.normalize();
    // T = the user's right along the face (facing −N); a face that looks up / down takes his right from the yaw
    const T = this.T.crossVectors(UPV, N);
    if (T.lengthSq() < 0.04) T.set(Math.cos(yaw), 0, -Math.sin(yaw));
    T.normalize();
    this.U.crossVectors(N, T).normalize();
    this.motion = motion;
    if (this.mode === 'idle') {
      this.s = 0;
      for (const a of this.arms) a.hand.setPose(POSES.relaxed, true);
    }
    this.mode = 'reach';
    this.root.visible = true;
  }

  release(): void {
    if (this.mode === 'idle') return;
    this.mode = 'leave';
  }

  hide(): void { this.mode = 'idle'; this.s = 0; this.root.visible = false; }

  /** The clip's grasp offsets → seat of each hand (world). */
  private seats(): void {
    const { P, N, T, U } = this;
    const k = this.progress, t = this.phase;
    // the face's grasp frame for a palm-down overhand grip: fingers into the face and a little up, back of the hand up
    const th = 30 * DEG;
    let roll = 0;
    const [c, Tr, Ur, F, D] = this.tmp;
    c.copy(P);
    let spread = SPREAD;
    switch (this.motion) {
      case 'crank': {
        const ang = (t / CRANK_TURN) * Math.PI * 2;
        c.addScaledVector(T, Math.cos(ang) * 0.15).addScaledVector(U, Math.sin(ang) * 0.15);
        spread = SPREAD_CRANK;
        break;
      }
      case 'pull': c.addScaledVector(N, 0.28 * smooth01(k)); break;
      case 'pump': {
        const ph = (t % PUMP_STROKE) / PUMP_STROKE;
        c.addScaledVector(U, -0.18 * Math.sin(ph * Math.PI));
        break;
      }
      case 'lever': { const e = smooth01(k); c.addScaledVector(U, -0.32 * e).addScaledVector(N, 0.08 * e); break; }
      case 'pin': {
        roll = -90 * DEG * smooth01(clamp(k * 2, 0, 1));
        c.addScaledVector(N, 0.16 * smooth01(clamp(k * 2 - 1, 0, 1)));
        spread = SPREAD_CRANK;
        break;
      }
    }
    // fingers F, back of the hand D (roll: about N, the pin's twist)
    const cr = Math.cos(roll), sr = Math.sin(roll);
    Tr.copy(T).multiplyScalar(cr).addScaledVector(U, sr);
    Ur.copy(U).multiplyScalar(cr).addScaledVector(T, -sr);
    F.copy(N).multiplyScalar(-Math.cos(th)).addScaledVector(Ur, Math.sin(th));
    D.copy(Ur).multiplyScalar(Math.cos(th)).addScaledVector(N, Math.sin(th));
    for (let i = 0; i < 2; i++) {
      const a = this.arms[i];
      const side = a.left ? -1 : 1;
      const g = this.grasp[i].copy(c).addScaledVector(Tr, side * spread);
      orientFD(a.seatQ, F, D);
      // the wrist sits so that the grasp centre of the closed hand is on the handle
      a.seatP.copy(GRASP).applyQuaternion(a.seatQ);
      a.seatP.subVectors(g, a.seatP);
    }
  }

  /** `camera`: world matrix current. `yaw`: the body's facing. `advance`: the clip clock runs (s of game time). */
  update(dt: number, camera: THREE.Camera, yaw: number, advance: number): void {
    if (this.mode === 'idle') return;
    if (this.mode === 'reach') { this.s = Math.min(1, this.s + dt / REACH_S); if (this.s >= 1) this.mode = 'hold'; }
    else if (this.mode === 'leave') { this.s = Math.max(0, this.s - dt / LEAVE_S); if (this.s <= 0) { this.hide(); return; } }
    this.phase += advance;
    this.seats();
    const s = this.s, e = smooth01(s);
    const me = camera.matrixWorld.elements;
    const [cr, cu, cf, cp, E] = this.cam;
    cr.set(me[0], me[1], me[2]); cu.set(me[4], me[5], me[6]); cf.set(-me[8], -me[9], -me[10]);
    cp.setFromMatrixPosition(camera.matrixWorld);
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    for (const a of this.arms) {
      const side = a.left ? -1 : 1;
      // waiting out of view: below the lower corner of the frame on its side, fingers forward
      a.restP.copy(cp).addScaledVector(cr, side * 0.22).addScaledVector(cu, -0.42).addScaledVector(cf, 0.3);
      orientFD(a.restQ, _a.copy(cf).multiplyScalar(0.8).addScaledVector(cu, 0.25), _b.copy(cu).multiplyScalar(0.8).addScaledVector(cr, side * 0.4));
      const h = a.hand;
      h.root.position.lerpVectors(a.restP, a.seatP, e);
      h.root.quaternion.copy(a.restQ).slerp(a.seatQ, smooth01(Math.min(1, s / 0.8)));
      // fingers: relaxed → open on the way → closed on the handle
      const open = smooth01(clamp(s / 0.5, 0, 1)), close = smooth01(clamp((s - 0.55) / 0.45, 0, 1));
      const rl = POSES.relaxed, op = POSES.open;
      for (let i = 0; i < POSE_LEN; i++) { const v = rl[i] + (op[i] - rl[i]) * open; a.pose[i] = v + (CLOSED[i] - v) * close; }
      h.setPose(a.pose);
      h.update(dt);
      // ── the arm: wrist → elbow → shoulder (the shoulder turns with the body only)
      h.root.updateMatrixWorld(true);
      const W = h.root.position;
      const dorsal = _c.set(0, 0, 1).applyQuaternion(h.root.quaternion);
      const S = _d.set(cp.x + cy * side * 0.21 + sy * 0.1, cp.y - 0.3, cp.z - sy * side * 0.21 + cy * 0.1);
      const u = _a.copy(S).sub(W);
      const d = Math.max(1e-3, u.length());
      u.multiplyScalar(1 / d);
      const pole = _b.set(0, -1, 0).addScaledVector(cr, side * 0.55);
      pole.addScaledVector(u, -pole.dot(u)).normalize();
      let cosB = (FOREARM * FOREARM + d * d - UPPER * UPPER) / (2 * FOREARM * d);
      cosB = clamp(cosB, Math.cos(70 * DEG), Math.cos(9 * DEG));
      const sinB = Math.sqrt(1 - cosB * cosB);
      E.copy(W).addScaledVector(u, FOREARM * cosB).addScaledVector(pole, FOREARM * sinB);
      a.fore.orient(W, E, dorsal);
      a.elbow.position.copy(E);
      const up = _x.copy(S).sub(E);
      const ul = Math.max(1e-3, up.length());
      a.upper.position.copy(E);
      a.upper.quaternion.copy(_q.setFromUnitVectors(UPV, up.multiplyScalar(1 / ul)));
      a.upper.scale.set(1, ul, 1);
    }
  }
}
