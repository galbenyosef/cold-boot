/**
 * Procedural hard-surface / organic geometry toolkit for the weapon & hand models.
 * Convention for weapon parts: +X right, +Y up, -Z = muzzle direction. Units metres.
 * Everything here runs at load time only.
 */
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type G = THREE.BufferGeometry;

/** Compose a transform: translate, euler XYZ (radians), scale. */
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** Non-indexed copy with only position+normal, transformed by `m` (winding fixed for mirrored matrices). */
export function prep(geo: G, m?: THREE.Matrix4, crease?: number): G {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.clearGroups();
  if (m) {
    g.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(g, false);
  }
  if (crease !== undefined) {
    const c = toCreasedNormals(g, crease);
    g.dispose();
    g = c;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  }
  return g;
}

/** Reverse triangle winding of a non-indexed geometry; optionally negate normals too. */
export function flipWinding(g: G, negateNormals = true): G {
  const swap = (attr: THREE.BufferAttribute) => {
    const a = attr.array as Float32Array, s = attr.itemSize;
    for (let i = 0; i < attr.count; i += 3) {
      for (let k = 0; k < s; k++) {
        const t = a[(i + 1) * s + k]; a[(i + 1) * s + k] = a[(i + 2) * s + k]; a[(i + 2) * s + k] = t;
      }
    }
    attr.needsUpdate = true;
  };
  if (g.index) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  } else {
    for (const k of Object.keys(g.attributes)) swap(g.attributes[k] as THREE.BufferAttribute);
  }
  if (negateNormals) {
    const n = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (n) { const a = n.array as Float32Array; for (let i = 0; i < a.length; i++) a[i] = -a[i]; n.needsUpdate = true; }
  }
  return g;
}

/** Box-projected UVs in metres from the dominant normal axis. */
export function boxUV(g: G, offset = 0, scale = 1): G {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else if (ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * scale + offset; uv[i * 2 + 1] = v * scale + offset * 0.7;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Collects geometry per material and merges it into one mesh per material. */
export class Parts {
  private map = new Map<THREE.Material, G[]>();
  add(geo: G, mat: THREE.Material, m?: THREE.Matrix4, crease?: number): this {
    let list = this.map.get(mat);
    if (!list) this.map.set(mat, (list = []));
    list.push(prep(geo, m, crease));
    return this;
  }
  /** Merge everything into `into` (or a new Group). */
  /** UV multiplier (finer texture detail on small parts like gloves). */
  uvScale = 1;
  build(into: THREE.Object3D = new THREE.Group(), uvOffset = 0): THREE.Object3D {
    for (const [mat, list] of this.map) {
      if (!list.length) continue;
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false)!;
      if (g !== list[0]) for (const l of list) l.dispose();
      boxUV(g, uvOffset, this.uvScale);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = (mat as any).name || 'part';
      into.add(mesh);
    }
    this.map.clear();
    return into;
  }
  get empty() { return this.map.size === 0; }
}

// ───────────────────────────────────────────── primitives

export const rbox = (w: number, h: number, d: number, r = Math.min(w, h, d) * 0.2, seg = 2): G =>
  new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) * 0.499));

export const box = (w: number, h: number, d: number): G => new THREE.BoxGeometry(w, h, d);

/** Cylinder along Z, centred. */
export function cylZ(r: number, len: number, seg = 16, r2 = r, open = false): G {
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, open);
  g.rotateX(-Math.PI / 2); // +Y → -Z ; top (r2) ends at -Z
  return g;
}
/** Cylinder along X, centred. */
export function cylX(r: number, len: number, seg = 12): G {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return g;
}
export function cylY(r: number, len: number, seg = 12, r2 = r): G {
  return new THREE.CylinderGeometry(r2, r, len, seg);
}
export function sphere(r: number, ws = 12, hs = 8): G { return new THREE.SphereGeometry(r, ws, hs); }

/**
 * Lathe around the Z axis (muzzle direction -Z). `runs` are smooth profile runs of [radius, s] where
 * s is distance toward the muzzle (z = -s). Separate runs give hard edges between them.
 * Profile must be ordered so the surface faces outward (increasing s on outer surfaces).
 */
export function latheZ(runs: [number, number][][], seg = 24): G {
  const parts: G[] = [];
  for (const run of runs) {
    const pts = run.map(([r, s]) => new THREE.Vector2(Math.max(r, 1e-5), s));
    const g = new THREE.LatheGeometry(pts, seg);
    g.rotateX(-Math.PI / 2); // lathe +Y → -Z
    parts.push(prep(g));
    g.dispose();
  }
  return parts.length === 1 ? parts[0] : mergeGeometries(parts, false)!;
}

/** Hollow tube along Z from s0 to s1 (z = -s), with flat annular ends. */
export function tubeZ(rOut: number, rIn: number, s0: number, s1: number, seg = 24): G {
  return latheZ([
    [[rIn, s0], [rOut, s0]],
    [[rOut, s0], [rOut, s1]],
    [[rOut, s1], [rIn, s1]],
    [[rIn, s1], [rIn, s0]],
  ], seg);
}

/** Polygon (optionally with per-corner fillet radius as 3rd element) → Shape. */
export function shape(points: number[][], defaultR = 0): THREE.Shape {
  const s = new THREE.Shape();
  pathInto(s, points, defaultR);
  return s;
}
export function hole(points: number[][], defaultR = 0): THREE.Path {
  const p = new THREE.Path();
  pathInto(p, points, defaultR);
  return p;
}
function pathInto(p: THREE.Path, pts: number[][], defaultR: number) {
  const n = pts.length;
  const P = (i: number) => pts[(i + n) % n];
  for (let i = 0; i < n; i++) {
    const cur = P(i), prev = P(i - 1), next = P(i + 1);
    const r = cur[2] ?? defaultR;
    if (r <= 0) {
      if (i === 0) p.moveTo(cur[0], cur[1]); else p.lineTo(cur[0], cur[1]);
      continue;
    }
    const d1x = prev[0] - cur[0], d1y = prev[1] - cur[1];
    const d2x = next[0] - cur[0], d2y = next[1] - cur[1];
    const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
    const rr = Math.min(r, l1 * 0.48, l2 * 0.48);
    const ax = cur[0] + (d1x / l1) * rr, ay = cur[1] + (d1y / l1) * rr;
    const bx = cur[0] + (d2x / l2) * rr, by = cur[1] + (d2y / l2) * rr;
    if (i === 0) p.moveTo(ax, ay); else p.lineTo(ax, ay);
    p.quadraticCurveTo(cur[0], cur[1], bx, by);
  }
  p.closePath();
}

/**
 * Side-profile extrusion: shape drawn in (s = forward toward muzzle, t = up), extruded across X with
 * total `width`, centred at x = `cx`. Bevel keeps outer dimensions.
 */
export function profileX(sh: THREE.Shape, width: number, bevel = 0.0008, cx = 0, curveSegments = 10, bevelSegments = 2): G {
  const b = Math.min(bevel, width * 0.3);
  const depth = Math.max(1e-5, width - 2 * b);
  const g = new THREE.ExtrudeGeometry(sh, {
    depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments, curveSegments,
  });
  const m = new THREE.Matrix4().set(
    0, 0, 1, cx - depth / 2,
    0, 1, 0, 0,
    -1, 0, 0, 0,
    0, 0, 0, 1,
  );
  const out = prep(g, m, 0.6);
  g.dispose();
  return out;
}

/** Cross-section extrusion: shape in (x, y), extruded along -Z from s0 to s1 (z = -s). */
export function sectionZ(sh: THREE.Shape, s0: number, s1: number, bevel = 0.0006, curveSegments = 8): G {
  const len = s1 - s0;
  const b = Math.min(bevel, len * 0.3);
  const depth = Math.max(1e-5, len - 2 * b);
  const g = new THREE.ExtrudeGeometry(sh, {
    depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, curveSegments,
  });
  // extrude goes +Z from -b..depth+b; we want z from -s0 down to -s1
  const out = prep(g, M(0, 0, -s0 - b - depth, 0, 0, 0), 0.6);
  g.dispose();
  return out;
}

export interface Station { z: number; w: number; h: number; n?: number; x?: number; y?: number; }

/**
 * Smooth loft through superellipse cross-sections along +Z (stations sorted by z).
 * n = 2 ellipse, larger = boxier. Caps are flat fans.
 */
export function sweep(st: Station[], seg = 20, capStart = true, capEnd = true): G {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const s of st) {
    const n = s.n ?? 2;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const ex = 2 / n;
      pos.push((s.x ?? 0) + Math.sign(c) * Math.pow(Math.abs(c), ex) * s.w,
               (s.y ?? 0) + Math.sign(sn) * Math.pow(Math.abs(sn), ex) * s.h, s.z);
    }
  }
  for (let i = 0; i < st.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const out = [prep(g)];
  g.dispose();
  const cap = (s: Station, ring: number, front: boolean) => {
    const cp: number[] = [];
    const base = ring * seg;
    const cx = s.x ?? 0, cy = s.y ?? 0;
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      const p1 = [pos[(base + j) * 3], pos[(base + j) * 3 + 1], pos[(base + j) * 3 + 2]];
      const p2 = [pos[(base + j2) * 3], pos[(base + j2) * 3 + 1], pos[(base + j2) * 3 + 2]];
      if (front) cp.push(cx, cy, s.z, ...p2, ...p1); else cp.push(cx, cy, s.z, ...p1, ...p2);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.computeVertexNormals();
    out.push(cg);
  };
  if (capStart) cap(st[0], 0, true);
  if (capEnd) cap(st[st.length - 1], st.length - 1, false);
  return out.length === 1 ? out[0] : mergeGeometries(out, false)!;
}

/** Bend a flat geometry (x = arc length, y = radial offset, z = along axis) around the Z axis. */
export function wrapZ(g: G, radius: number, angleOffset = 0): G {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const a = p.getX(i) / radius + angleOffset;
    const r = radius + p.getY(i);
    p.setXYZ(i, Math.sin(a) * r, Math.cos(a) * r, p.getZ(i));
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Displace vertices with a function (load-time sculpting). */
export function deform(g: G, f: (v: THREE.Vector3) => void): G {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); f(v); p.setXYZ(i, v.x, v.y, v.z); }
  p.needsUpdate = true;
  return g;
}

export function merge(list: G[]): G {
  const prepped = list.map((g) => prep(g));
  return mergeGeometries(prepped, false)!;
}

/** Point-in-polygon (even-odd) for 2D point lists. */
export function inPoly(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Apply a layer + render flags to a whole subtree. */
export function setViewmodel(obj: THREE.Object3D, layer: number) {
  obj.traverse((o) => {
    o.layers.set(layer);
    o.frustumCulled = false;
    if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = true; }
  });
}
