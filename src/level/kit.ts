/**
 * Geometry kit — structural / mechanical building blocks on top of Builder.
 * Everything is authored in the builder's current local frame.
 */
import * as THREE from 'three';
import type { Axis, Builder, Mat, Rng } from './builder';

export type P3 = [number, number, number];

const geoCache = new Map<string, THREE.BufferGeometry>();

/** Raised panel with chamfered edges, facing local +Z. Base at z=0, front at z=d, centred in XY. */
function panelGeo(w: number, h: number, d: number, bev: number): THREE.BufferGeometry {
  const key = `p${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}_${bev.toFixed(3)}`;
  let g = geoCache.get(key);
  if (g) return g;
  const a = w / 2, b = h / 2, c = Math.max(0.001, a - bev), e = Math.max(0.001, b - bev);
  const o: P3[] = [[-a, -b, 0], [a, -b, 0], [a, b, 0], [-a, b, 0]];
  const i: P3[] = [[-c, -e, d], [c, -e, d], [c, e, d], [-c, e, d]];
  const v: number[] = [];
  const quad = (p: P3, q: P3, r: P3, s: P3) => v.push(...p, ...q, ...r, ...p, ...r, ...s);
  quad(i[0], i[1], i[2], i[3]);
  for (let k = 0; k < 4; k++) { const n = (k + 1) % 4; quad(o[k], o[n], i[n], i[k]); }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  geoCache.set(key, g);
  return g;
}

const _t = new THREE.Matrix4();

/** Bevelled raised panel on a +Z facing surface: rect (x0,y0)-(x1,y1), base plane z0, depth d. */
export function panel(b: Builder, mat: Mat, x0: number, y0: number, x1: number, y1: number, z0: number, d = 0.035, bev = 0.02) {
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0.02 || h <= 0.02) return;
  b.geo(mat, panelGeo(w, h, d, Math.min(bev, w / 3, h / 3)), 'box', new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, z0));
}
/** Bevelled panel on an arbitrary axis-aligned face: centre on the surface, `face` normal. */
export function panelOn(b: Builder, mat: Mat, cx: number, cy: number, cz: number, w: number, h: number, face: '+x' | '-x' | '+y' | '-y' | '+z' | '-z', d = 0.03, bev = 0.02) {
  const m = new THREE.Matrix4();
  if (face === '-z') m.makeRotationY(Math.PI);
  else if (face === '+x') m.makeRotationY(Math.PI / 2);
  else if (face === '-x') m.makeRotationY(-Math.PI / 2);
  else if (face === '+y') m.makeRotationX(-Math.PI / 2);
  else if (face === '-y') m.makeRotationX(Math.PI / 2);
  m.setPosition(cx, cy, cz);
  b.geo(mat, panelGeo(w, h, d, Math.min(bev, w / 3, h / 3)), 'box', m);
}

/** I-beam along an axis, centred. For axis 'y' the flanges face ±Z (or ±X with roll). */
export function ibeam(b: Builder, mat: Mat, axis: Axis, cx: number, cy: number, cz: number, len: number, w = 0.15, h = 0.2, tf = 0.016, tw = 0.012, roll = false) {
  const o = h / 2 - tf / 2;
  if (axis === 'x') {
    b.box(mat, cx, cy + o, cz, len, tf, w).box(mat, cx, cy - o, cz, len, tf, w).box(mat, cx, cy, cz, len, h - 2 * tf, tw);
  } else if (axis === 'z') {
    b.box(mat, cx, cy + o, cz, w, tf, len).box(mat, cx, cy - o, cz, w, tf, len).box(mat, cx, cy, cz, tw, h - 2 * tf, len);
  } else if (!roll) {
    b.box(mat, cx, cy, cz + o, w, len, tf).box(mat, cx, cy, cz - o, w, len, tf).box(mat, cx, cy, cz, tw, len, h - 2 * tf);
  } else {
    b.box(mat, cx + o, cy, cz, tf, len, w).box(mat, cx - o, cy, cz, tf, len, w).box(mat, cx, cy, cz, h - 2 * tf, len, tw);
  }
}

/** C-channel (open side towards +dir of the perpendicular axis) along x or z. */
export function channel(b: Builder, mat: Mat, axis: 'x' | 'z', cx: number, cy: number, cz: number, len: number, w = 0.1, h = 0.12, t = 0.012) {
  if (axis === 'x') {
    b.box(mat, cx, cy, cz - w / 2 + t / 2, len, h, t).box(mat, cx, cy + h / 2 - t / 2, cz, len, t, w).box(mat, cx, cy - h / 2 + t / 2, cz, len, t, w);
  } else {
    b.box(mat, cx - w / 2 + t / 2, cy, cz, t, h, len).box(mat, cx, cy + h / 2 - t / 2, cz, w, t, len).box(mat, cx, cy - h / 2 + t / 2, cz, w, t, len);
  }
}

/** Open lattice truss along x or z between two chords (Warren pattern). */
export function truss(b: Builder, mat: Mat, axis: 'x' | 'z', cx: number, cy: number, cz: number, len: number, depth = 0.7, chord = 0.08, panelLen = 1.0) {
  const top = cy + depth / 2, bot = cy - depth / 2;
  const n = Math.max(2, Math.round(len / panelLen));
  const step = len / n;
  if (axis === 'x') {
    b.box(mat, cx, top, cz, len, chord, chord * 1.6).box(mat, cx, bot, cz, len, chord, chord * 1.6);
    for (let i = 0; i < n; i++) {
      const x0 = cx - len / 2 + i * step, x1 = x0 + step;
      if (i % 2 === 0) b.rod(mat, x0, bot, cz, x1, top, cz, chord * 0.32, 5); else b.rod(mat, x0, top, cz, x1, bot, cz, chord * 0.32, 5);
    }
  } else {
    b.box(mat, cx, top, cz, chord * 1.6, chord, len).box(mat, cx, bot, cz, chord * 1.6, chord, len);
    for (let i = 0; i < n; i++) {
      const z0 = cz - len / 2 + i * step, z1 = z0 + step;
      if (i % 2 === 0) b.rod(mat, cx, bot, z0, cx, top, z1, chord * 0.32, 5); else b.rod(mat, cx, top, z0, cx, bot, z1, chord * 0.32, 5);
    }
  }
}

export interface PipeOpts { seg?: number; flanges?: boolean; every?: number; elbow?: number }
/** Pipe through a list of points: straight runs, ball elbows, flanges near the ends and every `every` m. */
export function pipe(b: Builder, mat: Mat, pts: P3[], r: number, o: PipeOpts = {}) {
  const seg = o.seg ?? (r > 0.06 ? 12 : r > 0.025 ? 8 : 6);
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    b.rod(mat, p[0], p[1], p[2], q[0], q[1], q[2], r, seg);
    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) continue;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    if (o.flanges !== false && r >= 0.03 && len > 0.4) {
      const fl = (t: number) => {
        const x = p[0] + ux * t, y = p[1] + uy * t, z = p[2] + uz * t, hl = Math.max(0.012, r * 0.3);
        b.rod(mat, x - ux * hl, y - uy * hl, z - uz * hl, x + ux * hl, y + uy * hl, z + uz * hl, r * 1.45, seg);
      };
      fl(Math.min(0.12, len * 0.2)); fl(len - Math.min(0.12, len * 0.2));
      if (o.every) for (let t = o.every; t < len - o.every * 0.5; t += o.every) fl(t);
    }
    if (i > 0) b.sphere(mat, p[0], p[1], p[2], r * (o.elbow ?? 1.18), seg);
  }
}

/** Gate valve with a hand wheel. `axis` = pipe direction, wheel stem points along `stem`. */
export function valve(b: Builder, x: number, y: number, z: number, axis: Axis, r: number, stem: Axis = 'y', sign = 1, wheelMat: Mat = 'painted_orange') {
  const L = r * 4;
  b.cyl('steel_raw', x, y, z, r * 1.5, L, axis, 10);
  b.sphere('steel_raw', x, y, z, r * 2.0, 10);
  const sl = r * 5;
  const sx = stem === 'x' ? sign : 0, sy = stem === 'y' ? sign : 0, sz = stem === 'z' ? sign : 0;
  b.cyl('steel_raw', x + sx * sl / 2, y + sy * sl / 2, z + sz * sl / 2, r * 0.5, sl, stem, 6);
  const wx = x + sx * sl, wy = y + sy * sl, wz = z + sz * sl, wr = r * 3.2;
  b.torus(wheelMat, wx, wy, wz, wr, r * 0.42, stem, 14);
  if (stem === 'y') { b.box(wheelMat, wx, wy, wz, wr * 2, r * 0.4, r * 0.4).box(wheelMat, wx, wy, wz, r * 0.4, r * 0.4, wr * 2); }
  else if (stem === 'x') { b.box(wheelMat, wx, wy, wz, r * 0.4, wr * 2, r * 0.4).box(wheelMat, wx, wy, wz, r * 0.4, r * 0.4, wr * 2); }
  else { b.box(wheelMat, wx, wy, wz, wr * 2, r * 0.4, r * 0.4).box(wheelMat, wx, wy, wz, r * 0.4, wr * 2, r * 0.4); }
}

/** Sagging cable between two points (parabolic catenary). */
export function cable(b: Builder, mat: Mat, p: P3, q: P3, sag: number, r = 0.02, seg = 10, radial = 5) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    pts.push(new THREE.Vector3(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t - sag * 4 * t * (1 - t), p[2] + (q[2] - p[2]) * t));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) + sag;
  b.geo(mat, new THREE.TubeGeometry(curve, seg, r, radial, false), 'keep', undefined, len, 2 * Math.PI * r);
}

/** Bundle of sagging cables with slightly different sag / offsets. */
export function cableBundle(b: Builder, p: P3, q: P3, n: number, sag: number, r: number, spread: number, R: Rng, mats: Mat[] = ['rubber', 'rubber', 'plastic_dark']) {
  for (let i = 0; i < n; i++) {
    const ox = R.range(-spread, spread), oz = R.range(-spread, spread), oy = R.range(-spread, spread) * 0.5;
    cable(b, mats[i % mats.length], [p[0] + ox, p[1] + oy, p[2] + oz], [q[0] + ox, q[1] + oy, q[2] + oz], sag * R.range(0.75, 1.25), r * R.range(0.7, 1.3), 10, 5);
  }
}

/** Smooth hose / cable through control points (e.g. lying on the floor). */
export function hose(b: Builder, mat: Mat, pts: P3[], r = 0.025, radial = 6, segPer = 6) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const len = curve.getLength();
  b.geo(mat, new THREE.TubeGeometry(curve, Math.max(4, (pts.length - 1) * segPer), r, radial, false), 'keep', undefined, len, 2 * Math.PI * r);
}

/** Rectangular sheet-metal duct with flange frames. */
export function ductRect(b: Builder, mat: Mat, axis: Axis, cx: number, cy: number, cz: number, len: number, w: number, h: number, every = 1.2) {
  const f = 0.035, t = 0.03;
  if (axis === 'x') {
    b.box(mat, cx, cy, cz, len, h, w);
    for (let x = -len / 2 + 0.02; x <= len / 2; x += every) b.box('trim_steel', cx + x, cy, cz, t, h + f * 2, w + f * 2);
  } else if (axis === 'z') {
    b.box(mat, cx, cy, cz, w, h, len);
    for (let z = -len / 2 + 0.02; z <= len / 2; z += every) b.box('trim_steel', cx, cy, cz + z, w + f * 2, h + f * 2, t);
  } else {
    b.box(mat, cx, cy, cz, w, len, h);
    for (let y = -len / 2 + 0.02; y <= len / 2; y += every) b.box('trim_steel', cx, cy + y, cz, w + f * 2, t, h + f * 2);
  }
}

/** Round duct with ring flanges. */
export function ductRound(b: Builder, mat: Mat, axis: Axis, cx: number, cy: number, cz: number, len: number, r: number, every = 1.5, seg = 18) {
  b.cyl(mat, cx, cy, cz, r, len, axis, seg);
  for (let t = -len / 2 + 0.03; t <= len / 2; t += every) {
    b.cyl('trim_steel', cx + (axis === 'x' ? t : 0), cy + (axis === 'y' ? t : 0), cz + (axis === 'z' ? t : 0), r + 0.035, 0.05, axis, seg);
  }
}

/** Louvred vent on a +Z facing surface. */
export function louvre(b: Builder, x0: number, y0: number, x1: number, y1: number, z0: number, d = 0.045, frameMat: Mat = 'trim_steel') {
  const f = 0.035;
  b.bx('painted_dark', x0 + f, y0 + f, z0, x1 - f, y1 - f, z0 + 0.004);
  b.bx(frameMat, x0, y0, z0, x1, y0 + f, z0 + d).bx(frameMat, x0, y1 - f, z0, x1, y1, z0 + d);
  b.bx(frameMat, x0, y0 + f, z0, x0 + f, y1 - f, z0 + d).bx(frameMat, x1 - f, y0 + f, z0, x1, y1 - f, z0 + d);
  const n = Math.max(2, Math.floor((y1 - y0 - 2 * f) / 0.065));
  const step = (y1 - y0 - 2 * f) / n;
  for (let i = 0; i < n; i++) b.rbox(frameMat, (x0 + x1) / 2, y0 + f + (i + 0.5) * step, z0 + d * 0.55, x1 - x0 - 2 * f, 0.008, d * 1.2, -0.75, 0, 0);
}

/** Walkable floor grating panel(s) at height y with a steel frame and cross bars. */
export function grate(b: Builder, x0: number, z0: number, x1: number, z1: number, y = 0, barEvery = 1.0) {
  const f = 0.045;
  b.detail(() => {
    b.quad('floor_grate', (x0 + x1) / 2, y + 0.002, (z0 + z1) / 2, x1 - x0 - f, z1 - z0 - f, '+y', 0, 'box');
    b.bx('trim_steel', x0, y - 0.03, z0, x1, y + 0.005, z0 + f).bx('trim_steel', x0, y - 0.03, z1 - f, x1, y + 0.005, z1);
    b.bx('trim_steel', x0, y - 0.03, z0 + f, x0 + f, y + 0.005, z1 - f).bx('trim_steel', x1 - f, y - 0.03, z0 + f, x1, y + 0.005, z1 - f);
    if (x1 - x0 > z1 - z0) {
      const n = Math.round((x1 - x0) / barEvery);
      for (let i = 1; i < n; i++) { const x = x0 + (i * (x1 - x0)) / n; b.bx('trim_steel', x - f / 2, y - 0.03, z0 + f, x + f / 2, y + 0.005, z1 - f); }
    } else {
      const n = Math.round((z1 - z0) / barEvery);
      for (let i = 1; i < n; i++) { const z = z0 + (i * (z1 - z0)) / n; b.bx('trim_steel', x0 + f, y - 0.03, z - f / 2, x1 - f, y + 0.005, z + f / 2); }
    }
  });
}

/** Service trench under a grate: pit bottom, pipes and cables along the long axis, supports. */
export function trench(b: Builder, x0: number, z0: number, x1: number, z1: number, depth: number, R: Rng, wet = false) {
  const alongX = x1 - x0 > z1 - z0;
  b.detail(() => {
    b.bx('painted_dark', x0 - 0.05, -depth - 0.05, z0 - 0.05, x1 + 0.05, -depth, z1 + 0.05);
    const w = alongX ? z1 - z0 : x1 - x0;
    const lanes = Math.max(2, Math.floor(w / 0.16));
    for (let i = 0; i < lanes; i++) {
      const o = (alongX ? z0 : x0) + ((i + 0.5) * w) / lanes;
      const k = R();
      const r = k < 0.3 ? 0.06 : k < 0.6 ? 0.04 : 0.022;
      const mat: Mat = k < 0.3 ? 'steel_raw' : k < 0.45 ? 'copper' : k < 0.6 ? 'painted_orange' : 'rubber';
      const y = -depth + r + 0.03 + (k > 0.6 ? R.range(0, 0.05) : 0);
      if (alongX) pipe(b, mat, [[x0, y, o], [x1, y, o]], r, { every: r > 0.03 ? 1.6 : 0, flanges: r > 0.03 });
      else pipe(b, mat, [[o, y, z0], [o, y, z1]], r, { every: r > 0.03 ? 1.6 : 0, flanges: r > 0.03 });
    }
    const L = alongX ? x1 - x0 : z1 - z0;
    for (let t = 0.6; t < L; t += 1.5) {
      if (alongX) b.bx('trim_steel', x0 + t - 0.03, -depth, z0, x0 + t + 0.03, -depth + 0.03, z1);
      else b.bx('trim_steel', x0, -depth, z0 + t - 0.03, x1, -depth + 0.03, z0 + t + 0.03);
    }
    if (wet) b.decal('oil_stain', 1, (x0 + x1) / 2, -depth, (z0 + z1) / 2, Math.min(1.2, x1 - x0), Math.min(1.2, z1 - z0), '+y');
  });
  grate(b, x0, z0, x1, z1, 0);
}

/** Floor slab with rectangular holes (for trenches / pits). Top at y=0. One continuous collider. */
export function floorSlab(b: Builder, mat: Mat, x0: number, z0: number, x1: number, z1: number, holes: [number, number, number, number][] = [],
  surface: 'metal' | 'concrete' | 'rubber' = 'metal', thick = 0.6) {
  const xs = [x0, x1], zs = [z0, z1];
  for (const h of holes) { xs.push(h[0], h[2]); zs.push(h[1], h[3]); }
  const uniq = (a: number[], lo: number, hi: number) => [...new Set(a.filter((v) => v >= lo && v <= hi))].sort((p, q) => p - q);
  const X = uniq(xs, x0, x1), Z = uniq(zs, z0, z1);
  const inHole = (x: number, z: number) => holes.some((h) => x > h[0] && x < h[2] && z > h[1] && z < h[3]);
  for (let j = 0; j < Z.length - 1; j++) {
    let run = -1;
    for (let i = 0; i <= X.length - 1; i++) {
      const solid = i < X.length - 1 && !inHole((X[i] + X[i + 1]) / 2, (Z[j] + Z[j + 1]) / 2);
      if (solid && run < 0) run = i;
      if (!solid && run >= 0) { b.bx(mat, X[run], -thick, Z[j], X[i], 0, Z[j + 1]); run = -1; }
    }
  }
  b.collide(x0, -thick, z0, x1, 0, z1, surface, false);
}

/** Handrail along a polyline (posts, top rail, mid rail, kick plate). */
export function handrail(b: Builder, mat: Mat, pts: P3[], h = 1.05, postEvery = 1.25, kick = true) {
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    const n = Math.max(1, Math.round(len / postEvery));
    for (let k = 0; k <= n; k++) {
      if (k === 0 && i > 0) continue;
      const t = k / n, x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t, z = p[2] + (q[2] - p[2]) * t;
      b.rod(mat, x, y, z, x, y + h, z, 0.02, 6);
    }
    b.rod(mat, p[0], p[1] + h, p[2], q[0], q[1] + h, q[2], 0.024, 6);
    b.rod(mat, p[0], p[1] + h * 0.52, p[2], q[0], q[1] + h * 0.52, q[2], 0.016, 6);
    if (kick) {
      const dx = q[0] - p[0], dz = q[2] - p[2];
      if (Math.abs(dx) > Math.abs(dz)) b.box(mat, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + 0.06, (p[2] + q[2]) / 2, Math.abs(dx), 0.1, 0.008);
      else b.box(mat, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + 0.06, (p[2] + q[2]) / 2, 0.008, 0.1, Math.abs(dz));
    }
  }
}

/** Lathe (surface of revolution) from a [radius, y] profile. */
export function lathe(b: Builder, mat: Mat, profile: [number, number][], x: number, y: number, z: number, seg = 16, axis: Axis = 'y') {
  let len = 0, rmax = 0;
  for (let i = 0; i < profile.length; i++) {
    rmax = Math.max(rmax, profile[i][0]);
    if (i) len += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
  }
  const g = new THREE.LatheGeometry(profile.map((p) => new THREE.Vector2(Math.max(0.0001, p[0]), p[1])), seg);
  _t.identity();
  if (axis === 'z') _t.makeRotationX(Math.PI / 2); else if (axis === 'x') _t.makeRotationZ(-Math.PI / 2);
  _t.setPosition(x, y, z);
  b.geo(mat, g, 'keep', _t.clone(), 2 * Math.PI * rmax, len);
}

/** Extrude a 2D outline (XY, CCW) along +Z by `depth` — no bevel. */
export function extrude(b: Builder, mat: Mat, outline: [number, number][], depth: number, x = 0, y = 0, z = 0, ry = 0, rx = 0) {
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
  b.geo(mat, g, 'box', m);
}

/** Four bolts in the corners of a rect on a +Z facing surface. */
export function bolts4(b: Builder, x0: number, y0: number, x1: number, y1: number, z: number, inset = 0.045) {
  b.inst('bolt', x0 + inset, y0 + inset, z).inst('bolt', x1 - inset, y0 + inset, z).inst('bolt', x0 + inset, y1 - inset, z).inst('bolt', x1 - inset, y1 - inset, z);
}

/** Hazard-striped floor band (thin raised strip). */
export function hazardStrip(b: Builder, x0: number, z0: number, x1: number, z1: number, y = 0) {
  b.detail(() => b.bx('hazard_stripes', x0, y - 0.01, z0, x1, y + 0.004, z1));
}

/** Electrical junction box on a +Z surface with conduits leaving upward. */
export function junctionBox(b: Builder, x: number, y: number, z0: number, w = 0.3, h = 0.4, conduitTo = 0, led: Mat | null = null) {
  b.bx('painted_dark', x - w / 2, y - h / 2, z0, x + w / 2, y + h / 2, z0 + 0.11);
  panel(b, 'trim_steel', x - w / 2 + 0.02, y - h / 2 + 0.02, x + w / 2 - 0.02, y + h / 2 - 0.02, z0 + 0.11, 0.012, 0.012);
  b.box('steel_raw', x + w / 2 - 0.05, y, z0 + 0.13, 0.02, 0.08, 0.02);
  if (led) b.box(led, x - w / 2 + 0.06, y + h / 2 - 0.06, z0 + 0.125, 0.02, 0.02, 0.01);
  if (conduitTo > y) {
    b.rod('trim_steel', x - 0.07, y + h / 2, z0 + 0.05, x - 0.07, conduitTo, z0 + 0.05, 0.016, 6);
    b.rod('trim_steel', x + 0.05, y + h / 2, z0 + 0.05, x + 0.05, conduitTo, z0 + 0.05, 0.012, 6);
    for (let cy = y + h / 2 + 0.3; cy < conduitTo; cy += 0.7) b.box('steel_raw', x - 0.01, cy, z0 + 0.03, 0.2, 0.025, 0.06);
  }
}

/** Mesh / cage wall panel (alpha-tested grate, double sided) in the local XY plane at z, with a frame. */
export function cagePanel(b: Builder, grateMat: Mat, x0: number, y0: number, x1: number, y1: number, z: number, frame = 0.04, frameMat: Mat = 'trim_steel') {
  b.solid(() => b.quad(grateMat, (x0 + x1) / 2, (y0 + y1) / 2, z, x1 - x0, y1 - y0, '+z', 0, 'box'));
  b.bx(frameMat, x0, y0, z - frame / 2, x1, y0 + frame, z + frame / 2).bx(frameMat, x0, y1 - frame, z - frame / 2, x1, y1, z + frame / 2);
  b.bx(frameMat, x0, y0, z - frame / 2, x0 + frame, y1, z + frame / 2).bx(frameMat, x1 - frame, y0, z - frame / 2, x1, y1, z + frame / 2);
}

/** Simple straight stair flight rising along local -Z (decorative unless the caller adds colliders). */
export function stairs(b: Builder, mat: Mat, w: number, rise: number, run: number, n: number) {
  for (let i = 0; i < n; i++) {
    b.box(mat, 0, (i + 1) * rise - 0.015, -(i + 0.5) * run, w, 0.03, run + 0.02);
  }
  const len = Math.hypot(n * rise, n * run), ang = Math.atan2(n * rise, n * run);
  for (const s of [-1, 1]) b.rbox('trim_steel', (s * w) / 2, (n * rise) / 2 - 0.05, (-n * run) / 2, 0.03, 0.18, len, ang, 0, 0);
}
