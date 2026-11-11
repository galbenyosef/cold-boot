/** Analytic IK + small math helpers shared by the enemy rigs. No allocations at call time. */
import * as THREE from 'three';

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _d = new THREE.Vector3(), _t = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

/**
 * Two-bone IK for a limb whose bind pose hangs straight down local -Y with a hinge about local X
 * (humanoid arm/leg). Everything is in the space of `parentQ` 's frame of reference ("rig space"):
 *   origin  – position of the upper joint (rig space)
 *   target  – desired end position (rig space)
 *   pole    – direction the hinge (knee/elbow) should point toward (rig space)
 *   parentQ – rig-space orientation of the upper bone's parent
 * Writes upper.quaternion (local) and returns the hinge bend angle (0 = straight) which the caller applies
 * as lower.rotation.x = sign * bend. `outUpperQ` receives the rig-space orientation of the upper bone.
 */
export function solveLimb(
  origin: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, parentQ: THREE.Quaternion,
  l1: number, l2: number, upper: THREE.Object3D, bendSign: number, outUpperQ: THREE.Quaternion,
): number {
  _d.copy(target).sub(origin);
  let dist = _d.length();
  const maxLen = (l1 + l2) * 0.999, minLen = Math.abs(l1 - l2) + 0.02;
  if (dist < 1e-5) { _d.set(0, -1, 0); dist = minLen; }
  _d.multiplyScalar(1 / (dist || 1));
  dist = Math.min(Math.max(dist, minLen), maxLen);
  // interior angle at the root joint between the upper bone and the root→target line
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const A = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const cosK = (l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2);
  const bend = Math.PI - Math.acos(Math.min(1, Math.max(-1, cosK)));
  // hinge axis: perpendicular to the plane containing target dir and pole
  _x.copy(pole).cross(_d);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0);
  _x.normalize();
  // upper bone direction = target dir rotated toward the pole by A about the hinge axis
  _t.copy(_d).applyAxisAngle(_x, -A);
  // basis: y = -upperDir, x = hinge axis, z = x × y
  _y.copy(_t).negate();
  _z.copy(_x).cross(_y).normalize();
  _x.copy(_y).cross(_z).normalize();
  _m.makeBasis(_x, _y, _z);
  outUpperQ.setFromRotationMatrix(_m);
  _qa.copy(parentQ).invert().multiply(outUpperQ);
  upper.quaternion.copy(_qa);
  return bend * bendSign;
}

/** Planar 2-bone solve: returns [a1, a2] as out.x / out.y for a leg in the (r, y) plane. a1 = elevation of first
 * segment above horizontal, a2 = interior bend (π = straight). */
export function solvePlanar(r: number, y: number, l1: number, l2: number, out: THREE.Vector2): void {
  let d = Math.hypot(r, y);
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 0.01), (l1 + l2) * 0.999);
  const base = Math.atan2(y, r);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const cosK = (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2);
  out.x = base + Math.acos(Math.min(1, Math.max(-1, cosA)));
  out.y = Math.acos(Math.min(1, Math.max(-1, cosK)));
}

/** Critically / under-damped spring toward target. Mutates and returns state object {x, v}. */
export interface Spring { x: number; v: number; }
export function spring(s: Spring, target: number, freq: number, damp: number, dt: number): number {
  const w = freq * 6.2831853;
  const a = -2 * damp * w * s.v - w * w * (s.x - target);
  s.v += a * dt;
  s.x += s.v * dt;
  return s.x;
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function turnToward(current: number, target: number, maxStep: number): number {
  const d = angleDiff(target, current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

export function smooth(t: number): number {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** Cheap deterministic value noise in 1D, range -1..1. */
export function noise1(t: number, seed = 0): number {
  const i = Math.floor(t), f = t - i;
  const h = (n: number) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

export { _qb as scratchQ };
