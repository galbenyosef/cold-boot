/**
 * The free LEFT hand of a palm scan (REVISION 6.1 → "The scan as an interaction").
 *
 * Unlike the weapon rigs this hand is not a viewmodel: it lives in the WORLD (scene layer 0, true scale, lit by
 * the room), because what matters is that it lies ON the plate — flat, not above it and not through it. The pose
 * that does so is solved once at load with the grip solver against the plate's plane (fingers lowered until their
 * pads touch, the thumb laid out to the side), and the hand root is placed from the plate's own frame, so the
 * contact is exact wherever the plate is and however it is tilted.
 *
 * Motion: `begin` brings the hand up from below the left edge of the view and sets it down on the plate from
 * above (≈ 0.36 s); it stays while the scan runs; `release` lifts it off and takes it back out of view. The arm
 * behind it is a forearm (the weapon rigs' sleeve) and a plain upper-arm sleeve to a shoulder under the camera,
 * solved as a two-bone chain every frame, so the arm follows when the player shifts or the view moves.
 */
import * as THREE from 'three';
import type { PalmPlate } from '../core/types';
import type { VmMats } from './viewmodels/mats';
import { Forearm, Hand, POSES, POSE_LEN, type HandPose } from './viewmodels/hands';
import { gripReport, reachThumb, wrapFinger, type Sdf } from './viewmodels/grip';
import { clamp, smooth01 } from './math';

const DEG = Math.PI / 180;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The plate's surface under the lying hand, in the hand's frame: the plane z = −PLANE (the thenar pad compresses onto it). */
const PLANE = 0.0222;
/** Point of the hand (its frame) that sits over the plate's centre line: between the palm and the finger bases. */
const ANCHOR = V(0, 0.078, 0);
/** How far below the plate's centre (along its `up`) the anchor sits: the wrist ends up at the plate's near edge. */
const ANCHOR_DOWN = 0.076;
/** The hand lies a little across the plate: the left arm comes in from the left (radians about the plate's normal). */
const YAW_IN = 9 * DEG;
/** Wrist lifted a touch off the surface (radians about the hand's X): the heel of the hand, not the cuff, touches. */
const WRIST_LIFT = 0;
const REACH_S = 0.36, LEAVE_S = 0.3;
/** Wrist → elbow of the sleeve model, and the upper arm's natural length (it stretches when the reach is long). */
const FOREARM = 0.47, UPPER = 0.33;

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Orientation with local +Y = F (fingers) and +Z = D (back of the hand); D is orthogonalised against F. */
function orientFD(q: THREE.Quaternion, F: THREE.Vector3, D: THREE.Vector3): THREE.Quaternion {
  _y.copy(F).normalize();
  _z.copy(D).addScaledVector(_y, -D.dot(_y)).normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return q.setFromRotationMatrix(_m);
}

export type PalmMode = 'idle' | 'reach' | 'hold' | 'leave';

export class PalmHand {
  readonly root = new THREE.Group();
  readonly hand: Hand;
  private readonly arm: Forearm;
  private readonly upper: THREE.Mesh;
  private readonly elbow: THREE.Mesh;
  private readonly flat: HandPose;
  /** Solver diagnostics: clearance in mm of [index, middle, ring, pinky, thumb] above the plate's plane in the flat pose. */
  readonly report: number[];
  mode: PalmMode = 'idle';
  /** 0 = out of view, 1 = lying on the plate. */
  s = 0;
  private holdT = 0;
  private plate: PalmPlate | null = null;
  // the hand's seat on the plate (world)
  private readonly seatP = new THREE.Vector3();
  private readonly seatQ = new THREE.Quaternion();
  private readonly restP = new THREE.Vector3();
  private readonly restQ = new THREE.Quaternion();
  private readonly N = new THREE.Vector3();
  private readonly wrist = new THREE.Vector3();
  private readonly dorsal = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();
  private readonly elbowP = new THREE.Vector3();
  private readonly pose: HandPose = POSES.relaxed.slice();

  constructor(m: VmMats) {
    this.hand = new Hand(m, true);
    this.arm = new Forearm(m, false);
    // ── the pose that lies on a plane: solved with the hand at the origin (its frame = the solver's space) ──
    const h = this.hand;
    const plane: Sdf = (_px, _py, z) => z + PLANE;
    const g = POSES.open.slice();
    const splay = [8, 2, -5, -12];
    for (let f = 0; f < 4; f++) {
      g[f * 4] = splay[f] * DEG;
      // mostly from the knuckle: the fingers stay long and the pads come down onto the surface
      wrapFinger(h, g, f, plane, { start: [0, 2, 1], rate: [1, 0.3, 0.2], max: [36, 16, 10], skin: -0.001 });
    }
    // thumb laid out to the side (the solver's space is mirrored for a left hand: its thumb is on +X)
    const sx = h.left ? -1 : 1;
    reachThumb(h, g, V(sx * -0.097, 0.083, -PLANE + 0.0101), V(sx * -0.0765, 0.0655, -PLANE + 0.0119), plane);
    this.flat = g;
    this.report = gripReport(h, g, plane);
    h.setPose(POSES.relaxed, true);
    h.apply();

    const sleeve = m.sleeve;
    const ug = new THREE.CylinderGeometry(0.06, 0.074, 1, 20, 1, true);
    ug.translate(0, 0.5, 0); // from the elbow (origin) along +Y to the shoulder
    this.upper = new THREE.Mesh(ug, sleeve);
    this.elbow = new THREE.Mesh(new THREE.SphereGeometry(0.063, 16, 12), sleeve);
    this.root.add(h.root, this.arm.root, this.upper, this.elbow);
    this.root.traverse((o) => { o.frustumCulled = false; if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    this.root.visible = false;
    this.root.name = 'palm_hand';
  }

  get active(): boolean { return this.mode !== 'idle'; }
  /** The hand is lying on the plate. */
  get down(): boolean { return this.mode === 'hold'; }

  /** Start reaching for a plate. */
  begin(plate: PalmPlate): void {
    this.plate = plate;
    const N = this.N.copy(plate.normal).normalize();
    const U = _a.copy(plate.up).addScaledVector(N, -plate.up.dot(N)).normalize();
    const R = _b.crossVectors(U, N); // the user's right
    // fingers up the plate, turned inward a little; back of the hand along the normal, wrist a touch high
    const F = _c.copy(U).multiplyScalar(Math.cos(YAW_IN)).addScaledVector(R, Math.sin(YAW_IN));
    F.multiplyScalar(Math.cos(WRIST_LIFT)).addScaledVector(N, -Math.sin(WRIST_LIFT)).normalize();
    orientFD(this.seatQ, F, N);
    // the anchor over the plate; the palm's lowest pads on the surface
    _d.copy(ANCHOR).applyQuaternion(this.seatQ);
    this.seatP.copy(plate.position).addScaledVector(U, -ANCHOR_DOWN).addScaledVector(N, PLANE + Math.sin(WRIST_LIFT) * ANCHOR.y).sub(_d);
    if (this.mode === 'idle') { this.s = 0; this.hand.setPose(POSES.relaxed, true); }
    this.mode = 'reach';
    this.holdT = 0;
    this.root.visible = true;
  }

  /** Take the hand off. `linger`: stay a moment first (the scan completed: the plate has just read it). */
  release(linger = false): void {
    if (this.mode === 'idle') return;
    this.holdT = linger ? 0.28 : 0;
    this.mode = 'leave';
  }

  /**
   * Diagnostics (tests, review): how the hand sits on the plate right now, in mm above its surface (negative = sunk
   * in) — the lowest point of each finger [index, middle, ring, pinky], of the thumb, and of the palm's pads.
   */
  contact(): number[] | null {
    const pl = this.plate;
    if (!pl) return null;
    const h = this.hand, N = this.N, out: number[] = [];
    h.root.updateMatrixWorld(true);
    const gap = (p: THREE.Vector3, r: number) => (p.x - pl.position.x) * N.x + (p.y - pl.position.y) * N.y + (p.z - pl.position.z) * N.z - r;
    for (let f = 0; f < 4; f++) {
      let g = Infinity;
      for (let sgm = 0; sgm < 3; sgm++) for (const t of [0, 0.5, 1]) g = Math.min(g, gap(h.fingerPoint(f, sgm, t, _a), h.fingerRadius(f, sgm, t)));
      out.push(+(g * 1000).toFixed(1));
    }
    let g = Infinity;
    for (let sgm = 1; sgm < 3; sgm++) for (const t of [0, 0.5, 1]) g = Math.min(g, gap(h.thumbPoint(sgm, t, _a), h.thumbRadius(sgm, t)));
    out.push(+(g * 1000).toFixed(1));
    // palm: its underside is PLANE below the hand's own plane at the heel (thenar pad)
    g = Infinity;
    for (const [x, y] of [[0.02, 0.03], [-0.02, 0.03], [0, 0.06]]) g = Math.min(g, gap(h.root.localToWorld(_a.set(x, y, 0)), PLANE));
    out.push(+(g * 1000).toFixed(1));
    return out;
  }

  hide(): void { this.mode = 'idle'; this.s = 0; this.root.visible = false; this.plate = null; }

  /** `camera`: the view camera, world matrix up to date. `yaw`: the body's facing (the shoulder does not pitch with the head). */
  update(dt: number, camera: THREE.Camera, yaw: number): void {
    if (this.mode === 'idle' || !this.plate) return;
    if (this.mode === 'reach') { this.s = Math.min(1, this.s + dt / REACH_S); if (this.s >= 1) this.mode = 'hold'; }
    else if (this.mode === 'leave') {
      if (this.holdT > 0) this.holdT -= dt;
      else { this.s = Math.max(0, this.s - dt / LEAVE_S); if (this.s <= 0) { this.hide(); return; } }
    }
    const s = this.s, e = smooth01(s);
    // where the hand waits out of view: below the lower-left of the frame, fingers forward, palm down
    const me = camera.matrixWorld.elements;
    const cr = _x.set(me[0], me[1], me[2]), cu = _y.set(me[4], me[5], me[6]), cf = _z.set(-me[8], -me[9], -me[10]);
    const cp = _a.setFromMatrixPosition(camera.matrixWorld);
    this.restP.copy(cp).addScaledVector(cr, -0.2).addScaledVector(cu, -0.4).addScaledVector(cf, 0.3);
    _b.copy(cf).multiplyScalar(0.8).addScaledVector(cu, 0.25).addScaledVector(cr, 0.3);
    _c.copy(cu).multiplyScalar(0.8).addScaledVector(cr, -0.5);
    orientFD(this.restQ, _b, _c);
    // set down from above: an arc along the plate's normal that ends on the surface
    const h = this.hand;
    h.root.position.lerpVectors(this.restP, this.seatP, e).addScaledVector(this.N, 0.1 * 4 * s * (1 - s) * (1 - 0.35 * s));
    h.root.quaternion.copy(this.restQ).slerp(this.seatQ, smooth01(Math.min(1, s / 0.82)));
    // fingers: loose → opening as it comes over the plate → flat on contact
    const open = smooth01(clamp(s / 0.5, 0, 1)), lay = smooth01(clamp((s - 0.45) / 0.55, 0, 1));
    const p = this.pose, rl = POSES.relaxed, op = POSES.open, fl = this.flat;
    for (let i = 0; i < POSE_LEN; i++) { const a = rl[i] + (op[i] - rl[i]) * open; p[i] = a + (fl[i] - a) * lay; }
    if (s >= 1) { for (let i = 0; i < POSE_LEN; i++) { h.target[i] = fl[i]; h.current[i] = fl[i]; } h.apply(); }
    else { h.setPose(p); h.update(dt); }

    // ── the arm: wrist → elbow → shoulder ──
    h.root.updateMatrixWorld(true);
    const W = this.wrist.copy(h.root.position);
    this.dorsal.set(0, 0, 1).applyQuaternion(h.root.quaternion);
    // shoulder: under and left of the head, turning with the body only
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const S = this.shoulder.set(cp.x + cy * -0.21 + sy * 0.1, cp.y - 0.3, cp.z - sy * -0.21 + cy * 0.1);
    const u = _b.copy(S).sub(W);
    const d = Math.max(1e-3, u.length());
    u.multiplyScalar(1 / d);
    // pole: the elbow hangs down and out to the left
    const pole = _c.set(0, -1, 0).addScaledVector(cr, -0.55);
    pole.addScaledVector(u, -pole.dot(u)).normalize();
    // law of cosines while the arm can bend; beyond its reach it straightens and the upper arm gives
    let cosB = (FOREARM * FOREARM + d * d - UPPER * UPPER) / (2 * FOREARM * d);
    cosB = clamp(cosB, Math.cos(70 * DEG), Math.cos(9 * DEG));
    const sinB = Math.sqrt(1 - cosB * cosB);
    const E = this.elbowP.copy(W).addScaledVector(u, FOREARM * cosB).addScaledVector(pole, FOREARM * sinB);
    this.arm.orient(W, E, this.dorsal);
    this.elbow.position.copy(E);
    const up = _d.copy(S).sub(E);
    const ul = Math.max(1e-3, up.length());
    this.upper.position.copy(E);
    this.upper.quaternion.copy(_q.setFromUnitVectors(UP, up.multiplyScalar(1 / ul)));
    this.upper.scale.set(1, ul, 1);
  }
}
