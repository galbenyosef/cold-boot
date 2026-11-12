/**
 * Load-time grip solver. Hands are placed by where their knuckles sit on the weapon, then each finger is
 * closed against a signed-distance proxy of whatever it holds (weapon, the other hand, a magazine…) until
 * it touches — so grips wrap the real shapes without sinking in or floating — or steered to target points.
 * Results are plain `HandPose` parameter vectors; nothing here runs per frame.
 *
 * Proxy space = the space the hand root is placed in (gun space for weapon grips): +X right, +Y up,
 * -Z muzzle; side profiles are (s, t) = (-z, y) like the weapon models.
 */
import * as THREE from 'three';
import { Hand, FINGERS, THUMB, THUMB_LEN, type HandPose } from './hands';

export type Sdf = (x: number, y: number, z: number) => number;

/** Signed distance to a closed 2D polygon (negative inside). */
function polyDist(poly: number[][], px: number, py: number): number {
  let d = Infinity, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1];
    const ex = bx - ax, ey = by - ay, wx = px - ax, wy = py - ay;
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const dx = wx - ex * t, dy = wy - ey * t;
    d = Math.min(d, dx * dx + dy * dy);
    if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside ? -Math.sqrt(d) : Math.sqrt(d);
}

/** Side profile in (s, t) extruded across X to ±halfW (optionally with holes, e.g. a trigger guard). */
export function prismX(poly: number[][], halfW: number, holes: number[][][] = [], round = 0.0015): Sdf {
  return (x, y, z) => {
    let d2 = polyDist(poly, -z, y);
    for (const h of holes) d2 = Math.max(d2, -polyDist(h, -z, y));
    d2 += round;
    const dx = Math.abs(x) - halfW + round;
    return Math.min(Math.max(d2, dx), 0) + Math.hypot(Math.max(d2, 0), Math.max(dx, 0)) - round;
  };
}
export function boxSdf(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, round = 0): Sdf {
  return (x, y, z) => {
    const dx = Math.abs(x - cx) - hx + round, dy = Math.abs(y - cy) - hy + round, dz = Math.abs(z - cz) - hz + round;
    return Math.min(Math.max(dx, dy, dz), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) - round;
  };
}
/** Cylinder along Z between z0 < z1. */
export function cylSdf(cx: number, cy: number, z0: number, z1: number, r: number): Sdf {
  return (x, y, z) => {
    const dr = Math.hypot(x - cx, y - cy) - r, dz = Math.abs(z - (z0 + z1) / 2) - (z1 - z0) / 2;
    return Math.min(Math.max(dr, dz), 0) + Math.hypot(Math.max(dr, 0), Math.max(dz, 0));
  };
}
export function capsuleSdf(a: THREE.Vector3Like, b: THREE.Vector3Like, r: number): Sdf {
  const ax = a.x, ay = a.y, az = a.z, ex = b.x - ax, ey = b.y - ay, ez = b.z - az;
  const l2 = Math.max(1e-12, ex * ex + ey * ey + ez * ez);
  return (x, y, z) => {
    const wx = x - ax, wy = y - ay, wz = z - az;
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey + wz * ez) / l2));
    return Math.hypot(wx - ex * t, wy - ey * t, wz - ez * t) - r;
  };
}
export function union(list: Sdf[]): Sdf {
  return (x, y, z) => { let d = Infinity; for (let i = 0; i < list.length; i++) { const v = list[i](x, y, z); if (v < d) d = v; } return d; };
}
export const NOTHING: Sdf = () => 1;
/** `sdf` rigidly placed at (pos, quat). */
export function placed(sdf: Sdf, pos: THREE.Vector3Like, quat: THREE.Quaternion): Sdf {
  const inv = quat.clone().invert(), p = new THREE.Vector3(pos.x, pos.y, pos.z), t = new THREE.Vector3();
  return (x, y, z) => { t.set(x, y, z).sub(p).applyQuaternion(inv); return sdf(t.x, t.y, t.z); };
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _ex = new THREE.Vector3(), _ey = new THREE.Vector3(), _ez = new THREE.Vector3();
const _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _lz = new THREE.Vector3();
const _ml = new THREE.Matrix4(), _mw = new THREE.Matrix4();

/**
 * Hand root transform (in its parent space) that puts the index knuckle at `idx` and the pinky knuckle at
 * `pinky` with the back of the hand facing `dorsal` (orthogonalised against the knuckle line).
 */
export function placeHand(left: boolean, idx: THREE.Vector3Like, pinky: THREE.Vector3Like, dorsal: THREE.Vector3Like, pos: THREE.Vector3, quat: THREE.Quaternion) {
  const sx = left ? -1 : 1;
  const i = FINGERS[0], p = FINGERS[3];
  // local frame from the (mirrored) knuckle line
  _lx.set(sx * (p.x - i.x), p.y - i.y, p.z - i.z).normalize();
  _lz.set(0, 0, 1).addScaledVector(_lx, -_lx.z).normalize();
  _ly.crossVectors(_lz, _lx);
  _ex.set(pinky.x - idx.x, pinky.y - idx.y, pinky.z - idx.z).normalize();
  _ez.set(dorsal.x, dorsal.y, dorsal.z);
  _ez.addScaledVector(_ex, -_ez.dot(_ex)).normalize();
  _ey.crossVectors(_ez, _ex);
  _ml.makeBasis(_lx, _ly, _lz).transpose();
  _mw.makeBasis(_ex, _ey, _ez).multiply(_ml);
  quat.setFromRotationMatrix(_mw);
  _v.set(sx * (i.x + p.x) / 2, (i.y + p.y) / 2, (i.z + p.z) / 2).applyQuaternion(quat);
  pos.set((idx.x + pinky.x) / 2, (idx.y + pinky.y) / 2, (idx.z + pinky.z) / 2).sub(_v);
}

/** Deepest overlap test for finger `f` segments ≥ `from`: min over samples of (distance − radius). */
function fingerGap(hand: Hand, f: number, from: number, sdf: Sdf): number {
  let g = Infinity;
  for (let s = from; s < 3; s++) {
    for (let k = 0; k < 4; k++) {
      const t = s === 2 ? 0.2 + k * 0.33 : 0.3 + k * 0.24;
      hand.fingerPoint(f, s, Math.min(t, 1.15), _v);
      const d = sdf(_v.x, _v.y, _v.z) - hand.fingerRadius(f, s, Math.min(t, 1));
      if (d < g) g = d;
    }
  }
  return g;
}

export interface WrapOpts { start?: number[]; max?: number[]; skin?: number; rate?: number[]; }
const DEG = Math.PI / 180;

/**
 * Close finger `f` onto `sdf`: all three joints curl together; a joint stops when its own or a more distal
 * segment makes contact. Writes the curls into `pose` (spread is left as given).
 */
export function wrapFinger(hand: Hand, pose: HandPose, f: number, sdf: Sdf, o: WrapOpts = {}) {
  const b = f * 4;
  const start = o.start ?? [0, 4, 4], max = o.max ?? [88, 108, 62], rate = o.rate ?? [1, 1.25, 0.7];
  const skin = o.skin ?? -0.0008; // let the padding compress slightly so there is never a visible gap
  const live = [true, true, true];
  for (let j = 0; j < 3; j++) pose[b + 1 + j] = start[j] * DEG;
  for (let it = 0; it < 140 && (live[0] || live[1] || live[2]); it++) {
    for (let j = 0; j < 3; j++) {
      if (!live[j]) continue;
      const prev = pose[b + 1 + j];
      const next = prev + rate[j] * DEG;
      if (next > max[j] * DEG) { live[j] = false; continue; }
      pose[b + 1 + j] = next;
      hand.apply(pose, null, false);
      if (fingerGap(hand, f, j, sdf) < skin) { pose[b + 1 + j] = prev; live[j] = false; }
    }
  }
  hand.apply(pose, null, false);
}

/**
 * Generic coordinate-descent pose fit: adjust `params` (indices into `pose`, within [lo, hi]) to minimise
 * `cost()` (evaluated after the pose is applied to the hand).
 */
export function fitPose(hand: Hand, pose: HandPose, params: number[], lo: number[], hi: number[], cost: () => number) {
  const evalAt = () => { hand.apply(pose, null, false); return cost(); };
  let best = evalAt();
  for (let step = 0.3; step > 0.003; step *= 0.6) {
    for (let pass = 0; pass < 6; pass++) {
      let improved = false;
      for (let k = 0; k < params.length; k++) {
        const i = params[k], v0 = pose[i];
        for (const s of [step, -step]) {
          pose[i] = Math.min(hi[k] * DEG, Math.max(lo[k] * DEG, v0 + s));
          const c = evalAt();
          if (c < best - 1e-12) { best = c; improved = true; break; }
          pose[i] = v0;
        }
      }
      if (!improved) break;
    }
  }
  hand.apply(pose, null, false);
  return best;
}

const sq = (x: number) => x * x;

/** Steer finger `f` so its tip (and optionally its last knuckle) reach target points without sinking into `sdf`. */
export function reachFinger(hand: Hand, pose: HandPose, f: number, tip: THREE.Vector3Like, sdf: Sdf, mid?: THREE.Vector3Like) {
  const b = f * 4;
  return fitPose(hand, pose, [b, b + 1, b + 2, b + 3], [-16, -8, 0, 0], [16, 90, 105, 60], () => {
    hand.fingerPoint(f, 2, 1, _w);
    let c = sq(_w.x - tip.x) + sq(_w.y - tip.y) + sq(_w.z - tip.z);
    if (mid) { hand.fingerPoint(f, 2, 0, _w); c += 0.6 * (sq(_w.x - mid.x) + sq(_w.y - mid.y) + sq(_w.z - mid.z)); }
    const g = fingerGap(hand, f, 0, sdf);
    if (g < 0) c += 6 * g * g;
    // prefer natural curl ratios
    c += 2e-6 * sq(pose[b + 3] - pose[b + 2] * 0.55);
    return c;
  });
}

function thumbGap(hand: Hand, sdf: Sdf, from = 0): number {
  let g = Infinity;
  for (let s = from; s < 3; s++) {
    for (let k = 0; k < 3; k++) {
      const t = 0.35 + k * 0.35;
      hand.thumbPoint(s, t, _v);
      const d = sdf(_v.x, _v.y, _v.z) - hand.thumbRadius(s, Math.min(1, t));
      if (d < g) g = d;
    }
  }
  return g;
}

/** Steer the thumb: tip → `tip`, last knuckle → `mid` (sets its direction), kept out of `sdf`. */
export function reachThumb(hand: Hand, pose: HandPose, tip: THREE.Vector3Like, mid: THREE.Vector3Like | null, sdf: Sdf) {
  const t = THUMB;
  return fitPose(hand, pose, [t, t + 1, t + 2, t + 3, t + 4], [-70, -40, -50, -10, -10], [80, 70, 50, 60, 75], () => {
    hand.thumbPoint(2, 1, _w);
    let c = sq(_w.x - tip.x) + sq(_w.y - tip.y) + sq(_w.z - tip.z);
    if (mid) { hand.thumbPoint(2, 0, _w); c += 0.7 * (sq(_w.x - mid.x) + sq(_w.y - mid.y) + sq(_w.z - mid.z)); }
    const g = thumbGap(hand, sdf);
    if (g < -0.001) c += 6 * sq(g + 0.001);
    // the two visible phalanges must rest ON the surface: sinking costs far more than missing the target
    const gv = thumbGap(hand, sdf, 1);
    if (gv < 0.0002) c += 300 * sq(gv - 0.0002);
    return c;
  });
}

/** Capsule proxies of a posed hand (fingers, thumb, palm slab) in the hand root's parent space. */
export function handProxy(hand: Hand, pose: HandPose): Sdf {
  hand.apply(pose, null, false);
  const list: Sdf[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let f = 0; f < 4; f++) {
    for (let s = 0; s < 3; s++) {
      hand.fingerPoint(f, s, 0, a); hand.fingerPoint(f, s, 1, b);
      list.push(capsuleSdf(a.clone(), b.clone(), hand.fingerRadius(f, s, 0.5)));
    }
    // metacarpal: knuckle back toward the wrist
    hand.fingerPoint(f, 0, 0, a);
    hand.root.localToWorld(b.set(FINGERS[f].x * 0.72, 0.012, 0));
    list.push(capsuleSdf(a.clone(), b.clone(), 0.0135));
  }
  for (let s = 0; s < 3; s++) {
    hand.thumbPoint(s, 0, a); hand.thumbPoint(s, 1, b);
    list.push(capsuleSdf(a.clone(), b.clone(), hand.thumbRadius(s, 0.5)));
  }
  return union(list);
}

/** Diagnostics: per-finger clearance (mm, negative = sunk in) of a pose against a proxy, plus thumb. */
export function gripReport(hand: Hand, pose: HandPose, sdf: Sdf): number[] {
  hand.apply(pose, null, false);
  const out: number[] = [];
  for (let f = 0; f < 4; f++) out.push(+(fingerGap(hand, f, 0, sdf) * 1000).toFixed(1));
  out.push(+(thumbGap(hand, sdf, 1) * 1000).toFixed(1));
  return out;
}

void THUMB_LEN;
