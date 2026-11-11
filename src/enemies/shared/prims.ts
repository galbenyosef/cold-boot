/**
 * Procedural hard-surface primitives used by the enemy model builders.
 * Every function returns a NON-INDEXED BufferGeometry with position + normal + uv, so they can all be
 * merged freely (see RigBuilder). UVs are re-projected in metres by the builder.
 */
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export type V3 = [number, number, number];

/**
 * Global tessellation level for the builders (1 = hero mesh). LOD / shadow-proxy passes re-run the same
 * authoring code with a lower `k`: every primitive scales its segment counts, chamfers collapse to plain
 * boxes below 0.6. Set by RigBuilder.author*(); never touch it at gameplay time.
 */
export const DETAIL = { k: 1 };
function seg(n: number, min = 3): number {
  return DETAIL.k >= 1 ? n : Math.max(min, Math.round(n * DETAIL.k));
}

function ni(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  if (!out.getAttribute('uv')) {
    out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
  }
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

/** Raw triangle soup helper. */
class Soup {
  pos: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
    this.tri(a, b, c); this.tri(a, c, d);
  }
  /** Flat-shaded geometry. */
  flat(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.computeVertexNormals();
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((this.pos.length / 3) * 2), 2));
    return g;
  }
}

/** Chamfered box centred on the origin. `b` = chamfer size. 44 triangles, flat shaded. */
export function box(w: number, h: number, d: number, b = 0): THREE.BufferGeometry {
  if (DETAIL.k < 0.6) b = 0;
  if (b <= 0) return ni(new THREE.BoxGeometry(w, h, d));
  const hx = w / 2, hy = h / 2, hz = d / 2;
  b = Math.min(b, hx * 0.95, hy * 0.95, hz * 0.95);
  const s = new Soup();
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const out = (a: THREE.Vector3, bb: THREE.Vector3, c: THREE.Vector3, dd?: THREE.Vector3) => {
    // orient outward (convex, centred)
    const n = _v.copy(bb).sub(a).cross(new THREE.Vector3().copy(c).sub(a));
    const ctr = new THREE.Vector3().add(a).add(bb).add(c);
    const flip = n.dot(ctr) < 0;
    if (dd) { if (flip) s.quad(a, dd, c, bb); else s.quad(a, bb, c, dd); }
    else if (flip) s.tri(a, c, bb); else s.tri(a, bb, c);
  };
  for (const sx of [-1, 1]) {
    out(P(sx * hx, -hy + b, -hz + b), P(sx * hx, hy - b, -hz + b), P(sx * hx, hy - b, hz - b), P(sx * hx, -hy + b, hz - b));
  }
  for (const sy of [-1, 1]) {
    out(P(-hx + b, sy * hy, -hz + b), P(hx - b, sy * hy, -hz + b), P(hx - b, sy * hy, hz - b), P(-hx + b, sy * hy, hz - b));
  }
  for (const sz of [-1, 1]) {
    out(P(-hx + b, -hy + b, sz * hz), P(hx - b, -hy + b, sz * hz), P(hx - b, hy - b, sz * hz), P(-hx + b, hy - b, sz * hz));
  }
  // edges
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    out(P(sx * hx, sy * (hy - b), -hz + b), P(sx * hx, sy * (hy - b), hz - b), P(sx * (hx - b), sy * hy, hz - b), P(sx * (hx - b), sy * hy, -hz + b));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    out(P(sx * hx, -hy + b, sz * (hz - b)), P(sx * hx, hy - b, sz * (hz - b)), P(sx * (hx - b), hy - b, sz * hz), P(sx * (hx - b), -hy + b, sz * hz));
  }
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    out(P(-hx + b, sy * hy, sz * (hz - b)), P(hx - b, sy * hy, sz * (hz - b)), P(hx - b, sy * (hy - b), sz * hz), P(-hx + b, sy * (hy - b), sz * hz));
  }
  // corners
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    out(P(sx * hx, sy * (hy - b), sz * (hz - b)), P(sx * (hx - b), sy * hy, sz * (hz - b)), P(sx * (hx - b), sy * (hy - b), sz * hz));
  }
  return s.flat();
}

/** Tapered box: bottom (y=-h/2) w0×d0, top w1×d1. Flat shaded, with small chamfer-less faces. */
export function wedge(w0: number, d0: number, w1: number, d1: number, h: number, zShiftTop = 0, xShiftTop = 0): THREE.BufferGeometry {
  const s = new Soup();
  const y0 = -h / 2, y1 = h / 2;
  const a = [new THREE.Vector3(-w0 / 2, y0, -d0 / 2), new THREE.Vector3(w0 / 2, y0, -d0 / 2), new THREE.Vector3(w0 / 2, y0, d0 / 2), new THREE.Vector3(-w0 / 2, y0, d0 / 2)];
  const t = [new THREE.Vector3(-w1 / 2 + xShiftTop, y1, -d1 / 2 + zShiftTop), new THREE.Vector3(w1 / 2 + xShiftTop, y1, -d1 / 2 + zShiftTop),
    new THREE.Vector3(w1 / 2 + xShiftTop, y1, d1 / 2 + zShiftTop), new THREE.Vector3(-w1 / 2 + xShiftTop, y1, d1 / 2 + zShiftTop)];
  s.quad(a[0], a[1], a[2], a[3]);
  s.quad(t[3], t[2], t[1], t[0]);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; s.quad(a[j], a[i], t[i], t[j]); }
  return s.flat();
}

/** Cylinder along Y, centred. */
export function cyl(rTop: number, rBot: number, h: number, segs = 12, open = false): THREE.BufferGeometry {
  return ni(new THREE.CylinderGeometry(rTop, rBot, h, seg(segs, 4), 1, open));
}

/** Cylinder with chamfered rims (lathe). */
export function bcyl(r: number, h: number, bevel: number, segs = 14): THREE.BufferGeometry {
  const hh = h / 2;
  if (DETAIL.k < 0.6) return cyl(r, r, h, segs);
  return hlathe([[0, -hh], [r - bevel, -hh], [r, -hh + bevel], [r, hh - bevel], [r - bevel, hh], [0, hh]], segs);
}

/** Hard-edged lathe: like lathe() but with faceted profile corners (each profile segment gets its own normals). */
export function hlathe(profile: [number, number][], segs = 14): THREE.BufferGeometry {
  const seg_ = seg(segs, 5);
  const s: number[] = [], n: number[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    // outward normal of the profile segment in (r, y): rotate the direction by -90°
    let nr = y1 - y0, ny = -(r1 - r0);
    const l = Math.hypot(nr, ny) || 1; nr /= l; ny /= l;
    for (let k = 0; k < seg_; k++) {
      const a0 = (k / seg_) * Math.PI * 2, a1 = ((k + 1) / seg_) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p00 = [r0 * s0, y0, r0 * c0], p01 = [r0 * s1, y0, r0 * c1], p10 = [r1 * s0, y1, r1 * c0], p11 = [r1 * s1, y1, r1 * c1];
      const n0 = [nr * s0, ny, nr * c0], n1 = [nr * s1, ny, nr * c1];
      if (r0 > 1e-6) { s.push(...p00, ...p01, ...p11); n.push(...n0, ...n1, ...n1); }
      if (r1 > 1e-6) { s.push(...p00, ...p11, ...p10); n.push(...n0, ...n1, ...n0); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(s), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((s.length / 3) * 2), 2));
  return g;
}

export function sphere(r: number, ws = 12, hs = 8): THREE.BufferGeometry {
  return ni(new THREE.SphereGeometry(r, seg(ws, 5), seg(hs, 3)));
}

export function torus(R: number, r: number, radial = 6, tubular = 16, arc = Math.PI * 2): THREE.BufferGeometry {
  return ni(new THREE.TorusGeometry(R, r, seg(radial, 3), seg(tubular, 6), arc));
}

/** Cylinder between two points. */
export function rod(a: V3, b: V3, r: number, seg = 8, r2 = r): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = cyl(r2, r, len, seg);
  _q.setFromUnitVectors(UP, _v.copy(B).sub(A).normalize());
  _m.compose(A.add(B).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

/** Smooth tube through points (cable / hose). */
export function tube(points: V3[], r: number, radial = 6, tubular = 0, tension = 0.5): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', tension);
  const n = tubular || Math.max(4, Math.round(curve.getLength() / 0.025));
  return ni(new THREE.TubeGeometry(curve, seg(Math.min(n, 48), 3), r, seg(radial, 3), false));
}

/** Hex bolt head, axis Y, sitting on y=0. */
export function bolt(r = 0.006, h = 0.004): THREE.BufferGeometry {
  const g = cyl(r, r, h, 6);
  g.translate(0, h / 2, 0);
  return g;
}

/** Extruded 2D outline (XY plane, extruded along +Z, centred in Z) with a bevel. */
export function plate(outline: [number, number][], thickness: number, bevel = 0.004, holes?: [number, number][][]): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  if (holes) for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const bv = Math.min(bevel, thickness * 0.45);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness - bv * 2, bevelEnabled: bv > 0 && DETAIL.k >= 0.6, bevelSize: bv, bevelThickness: bv, bevelSegments: 1, steps: 1, curveSegments: seg(6, 2),
  });
  g.translate(0, 0, -(thickness - bv * 2) / 2);
  const out = ni(g);
  // crisp bevels
  out.computeVertexNormals();
  return out;
}

export interface PatchOpts {
  nu: number; nv: number;
  thickness: number;
  /** Return false to cut the cell out (cracks / broken-off chunks / vents). u,v are cell centres 0..1. */
  mask?: (u: number, v: number) => boolean;
  /** Smooth normals across the outer surface (default true). */
  smooth?: boolean;
  /** Flip which side is "outer" (offset direction). */
  flip?: boolean;
}

/**
 * Thick shell from a parametric surface: outer skin + inner skin + rim walls on every open edge
 * (patch border and edges of masked-out cells). The workhorse for armour / shell plates.
 */
export function patch(fn: (u: number, v: number, out: THREE.Vector3) => void, o: PatchOpts): THREE.BufferGeometry {
  const { thickness } = o;
  const nu = seg(o.nu, Math.min(o.nu, 2)), nv = seg(o.nv, 1);
  const W = nu + 1, H = nv + 1;
  const P: THREE.Vector3[] = new Array(W * H);
  const N: THREE.Vector3[] = new Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = new THREE.Vector3();
    fn(i / nu, j / nv, p);
    P[j * W + i] = p;
    N[j * W + i] = new THREE.Vector3();
  }
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fnrm = new THREE.Vector3();
  const sign = o.flip ? -1 : 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = P[j * W + i], b = P[j * W + i + 1], c = P[(j + 1) * W + i + 1], d = P[(j + 1) * W + i];
    e1.copy(c).sub(a); e2.copy(d).sub(b);
    fnrm.copy(e1).cross(e2).multiplyScalar(sign);
    N[j * W + i].add(fnrm); N[j * W + i + 1].add(fnrm); N[(j + 1) * W + i + 1].add(fnrm); N[(j + 1) * W + i].add(fnrm);
  }
  for (const n of N) n.normalize();
  const I = P.map((p, k) => p.clone().addScaledVector(N[k], -thickness));
  const pos: number[] = [], nor: number[] = [];
  const push = (p: THREE.Vector3, n: THREE.Vector3) => { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); };
  // Mask is sampled at VERTICES; a cell with all four corners inside is a quad, with three it becomes a
  // triangle (diagonal cut) — so cracks and chipped edges get 45° facets instead of stair-steps.
  const inside = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) inside[j * W + i] = !o.mask || o.mask(i / nu, j / nv) ? 1 : 0;
  const rev = sign < 0;
  const flatN = new THREE.Vector3();
  const edges = new Map<number, number>();
  const edgeKey = (a: number, b: number) => (a < b ? a * W * H + b : b * W * H + a);
  const tri = (ka: number, kb: number, kc: number) => {
    let na = N[ka], nb = N[kb], nc = N[kc];
    if (o.smooth === false) {
      e1.copy(P[kb]).sub(P[ka]); e2.copy(P[kc]).sub(P[ka]);
      flatN.copy(e1).cross(e2).multiplyScalar(sign).normalize();
      na = nb = nc = flatN.clone();
    }
    if (rev) { push(P[ka], na); push(P[kc], nc); push(P[kb], nb); } else { push(P[ka], na); push(P[kb], nb); push(P[kc], nc); }
    // inner skin
    const ia = N[ka].clone().negate(), ib = N[kb].clone().negate(), ic = N[kc].clone().negate();
    if (rev) { push(I[ka], ia); push(I[kb], ib); push(I[kc], ic); } else { push(I[ka], ia); push(I[kc], ic); push(I[kb], ib); }
    for (const [x, y] of [[ka, kb], [kb, kc], [kc, ka]] as const) {
      const k = edgeKey(x, y);
      // remember direction of first use so the wall can be wound consistently
      edges.set(k, edges.has(k) ? -1 : (x < y ? 1 : 2));
    }
  };
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const ka = j * W + i, kb = ka + 1, kc = kb + W, kd = ka + W;
    const n = inside[ka] + inside[kb] + inside[kc] + inside[kd];
    if (n === 4) { tri(ka, kb, kc); tri(ka, kc, kd); }
    else if (n === 3) {
      if (!inside[ka]) tri(kb, kc, kd);
      else if (!inside[kb]) tri(ka, kc, kd);
      else if (!inside[kc]) tri(ka, kb, kd);
      else tri(ka, kb, kc);
    }
  }
  // rim walls on every edge used by exactly one triangle
  const WH = W * H;
  for (const [k, dir] of edges) {
    if (dir < 0) continue;
    const lo = Math.floor(k / WH), hi = k % WH;
    // edge direction as used by its triangle (x → y)
    const x = dir === 1 ? lo : hi, y = dir === 1 ? hi : lo;
    e1.copy(P[y]).sub(P[x]); e2.copy(I[x]).sub(P[x]);
    fnrm.copy(e2).cross(e1).multiplyScalar(sign).normalize();
    const nn = fnrm.clone();
    if (rev) { push(P[x], nn); push(P[y], nn); push(I[y], nn); push(P[x], nn); push(I[y], nn); push(I[x], nn); }
    else { push(P[x], nn); push(I[y], nn); push(P[y], nn); push(P[x], nn); push(I[x], nn); push(I[y], nn); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

/** Signed power for superellipses. */
export function spow(x: number, e: number): number {
  return Math.sign(x) * Math.pow(Math.abs(x), e);
}

/** Linear interpolation through a table of [t, value] keys. */
export function keyLerp(keys: [number, number][], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      let f = (t - t0) / (t1 - t0 || 1);
      f = f * f * (3 - 2 * f);
      return v0 + (v1 - v0) * f;
    }
  }
  return keys[keys.length - 1][1];
}

export interface ShellOpts {
  /** [v, radiusX, radiusZ, centreZ?] keys along the height (v 0 bottom … 1 top). */
  y0: number; y1: number;
  rx: [number, number][]; rz: [number, number][];
  cz?: [number, number][];
  cx?: [number, number][];
  /** Angular range, radians; 0 = +Z (front), +π/2 = +X. */
  a0: number; a1: number;
  /** Superellipse exponent: 2 = ellipse, >2 = boxier. */
  n?: number;
  nu?: number; nv?: number; thickness?: number;
  mask?: (u: number, v: number) => boolean;
  /** Per-v angular trims: a0/a1 offsets (for swept plate edges). */
  trim0?: [number, number][]; trim1?: [number, number][];
}

/** Section of a superelliptic tube around Y — armour plates wrapped round limbs and torsos. */
export function shell(o: ShellOpts): THREE.BufferGeometry {
  const e = 2 / (o.n ?? 2.6);
  return patch((u, v, out) => {
    const a0 = o.a0 + (o.trim0 ? keyLerp(o.trim0, v) : 0), a1 = o.a1 + (o.trim1 ? keyLerp(o.trim1, v) : 0);
    const a = a0 + (a1 - a0) * u;
    const rx = keyLerp(o.rx, v), rz = keyLerp(o.rz, v);
    out.set(
      (o.cx ? keyLerp(o.cx, v) : 0) + rx * spow(Math.sin(a), e),
      o.y0 + (o.y1 - o.y0) * v,
      (o.cz ? keyLerp(o.cz, v) : 0) + rz * spow(Math.cos(a), e),
    );
  }, { nu: o.nu ?? 10, nv: o.nv ?? 6, thickness: o.thickness ?? 0.008, mask: o.mask });
}

/** Deterministic PRNG. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Transform helper: T * Ry*Rx*Rz * S. Angles in radians. */
export function xf(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx, sy, sz),
  );
}
