/**
 * Geometry builder toolkit core.
 *
 * A Builder accumulates primitives into per-material batches (plus instanced props) and merges each
 * batch into ONE mesh at `build()`. All primitives honour a transform stack, so props can be authored
 * in local space and stamped anywhere. UVs are generated in METRES: box-projected from the final
 * (post-transform) position by face normal, or — for round things — native UVs scaled to metres.
 */
import * as THREE from 'three';
import type { DecalName, MaterialName, SignStyle, Surface } from '../core/types';
import type { LevelBuild } from './context';
import type { UvRect } from './signatlas';

export type Mat = MaterialName | THREE.Material;
export type UvMode = 'box' | 'keep' | 'unit';
export type Axis = 'x' | 'y' | 'z';
export type Face = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

interface Item { geo: THREE.BufferGeometry; m: THREE.Matrix4; uv: UvMode; su: number; sv: number; /** atlas sub-rectangle (resolved before merging) */ uvr?: UvRect; /** ?zdebug=1: where it was authored */ src?: string }

/** ?zdebug=1 (checks): remember the authoring call site of every primitive (merged meshes get userData.srcRanges). */
const ZDEBUG = typeof location !== 'undefined' && /[?&]zdebug=1/.test(location.search);
function callSite(): string {
  const st = (new Error().stack ?? '').split('\n').slice(2);
  const out: string[] = [];
  for (const l of st) {
    const m = /\/src\/(level\/[^?:)]+)(?:\?[^:)]*)?:(\d+)/.exec(l);
    if (!m || /level\/builder\.ts/.test(m[1])) continue;
    out.push(`${m[1].replace('level/', '')}:${m[2]}`);
    if (out.length >= 3) break;
  }
  return out.join(' < ');
}
interface Batch { mat: THREE.Material; cast: boolean; items: Item[] }

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _n3 = new THREE.Matrix3();
const _box = new THREE.Box3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// ── shared unit geometries (scaled through the item matrix) ─────────────────────────────────────────
const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}
export const unitBox = () => cached('box', () => new THREE.BoxGeometry(1, 1, 1));
export const unitCyl = (seg: number, open = false) =>
  cached(`cyl${seg}${open ? 'o' : ''}`, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, open));
export const unitCone = (seg: number, ratio: number) =>
  cached(`cone${seg}_${ratio.toFixed(3)}`, () => new THREE.CylinderGeometry(ratio, 1, 1, seg, 1));
export const unitSphere = (seg: number) =>
  cached(`sph${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(4, Math.round(seg * 0.6))));
export const unitPlane = () => cached('plane', () => new THREE.PlaneGeometry(1, 1));
export const unitTorus = (seg: number, tube: number) =>
  cached(`tor${seg}_${tube.toFixed(3)}`, () => new THREE.TorusGeometry(1, tube, 6, seg));

/** Deterministic RNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(f, {
    range: (lo: number, hi: number) => lo + (hi - lo) * f(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * f()),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(f() * arr.length)],
    chance: (p: number) => f() < p,
  });
}
export type Rng = ReturnType<typeof rng>;

const FACE_EULER: Record<Face, [number, number, number]> = {
  '+z': [0, 0, 0], '-z': [0, Math.PI, 0], '+x': [0, Math.PI / 2, 0], '-x': [0, -Math.PI / 2, 0],
  '+y': [-Math.PI / 2, 0, 0], '-y': [Math.PI / 2, 0, 0],
};
const FACE_N: Record<Face, [number, number, number]> = {
  '+z': [0, 0, 1], '-z': [0, 0, -1], '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0],
};

/** Merge transformed items into one geometry (position / normal / uv, indexed). */
export function mergeItems(items: Item[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const it of items) {
    const pc = it.geo.getAttribute('position').count;
    nv += pc;
    ni += it.geo.index ? it.geo.index.count : pc;
  }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
  const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const it of items) {
    const g = it.geo;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    let nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (!nor) { g.computeVertexNormals(); nor = g.getAttribute('normal') as THREE.BufferAttribute; }
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const e = it.m.elements;
    _n3.getNormalMatrix(it.m);
    const n = _n3.elements;
    const flip = it.m.determinant() < 0;
    const pc = pos.count;
    const pa = pos.array as ArrayLike<number>, na = nor.array as ArrayLike<number>;
    const ua = uv ? (uv.array as ArrayLike<number>) : null;
    const ps = pos.itemSize, usz = uv ? uv.itemSize : 2;
    for (let i = 0; i < pc; i++) {
      const x = pa[i * ps], y = pa[i * ps + 1], z = pa[i * ps + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const o = (vo + i) * 3;
      P[o] = wx; P[o + 1] = wy; P[o + 2] = wz;
      const a = na[i * 3], b = na[i * 3 + 1], c = na[i * 3 + 2];
      let nx = n[0] * a + n[3] * b + n[6] * c;
      let ny = n[1] * a + n[4] * b + n[7] * c;
      let nz = n[2] * a + n[5] * b + n[8] * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;
      const u = (vo + i) * 2;
      if (it.uv === 'box') {
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        if (ay >= ax && ay >= az) { U[u] = wx; U[u + 1] = wz; }
        else if (ax >= az) { U[u] = wz; U[u + 1] = wy; }
        else { U[u] = wx; U[u + 1] = wy; }
      } else if (ua) {
        U[u] = ua[i * usz] * it.su; U[u + 1] = ua[i * usz + 1] * it.sv;
        if (it.uvr) { U[u] = it.uvr.ou + U[u] * it.uvr.su; U[u + 1] = it.uvr.ov + U[u + 1] * it.uvr.sv; }
      }
    }
    if (g.index) {
      const ia = g.index.array as ArrayLike<number>;
      const ic = g.index.count;
      if (flip) for (let i = 0; i < ic; i += 3) { I[io + i] = ia[i] + vo; I[io + i + 1] = ia[i + 2] + vo; I[io + i + 2] = ia[i + 1] + vo; }
      else for (let i = 0; i < ic; i++) I[io + i] = ia[i] + vo;
      io += ic;
    } else {
      if (flip) for (let i = 0; i < pc; i += 3) { I[io + i] = vo + i; I[io + i + 1] = vo + i + 2; I[io + i + 2] = vo + i + 1; }
      else for (let i = 0; i < pc; i++) I[io + i] = vo + i;
      io += pc;
    }
    vo += pc;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.setIndex(new THREE.BufferAttribute(I, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

export class Builder {
  /** Current transform. */
  m = new THREE.Matrix4();
  /** When false, emitted geometry goes to non-shadow-casting batches (small greebles, decals). */
  cast = true;
  private stack: THREE.Matrix4[] = [];
  private castStack: boolean[] = [];
  private batches = new Map<string, Batch>();
  private insts = new Map<string, THREE.Matrix4[]>();
  tris = 0;
  /** Room ids this zone belongs to (visibility culling). */
  rooms: string[] = [];
  /** Static zones put their signs into the shared sign atlas (parts built on the spot cannot: the atlas is laid out last). */
  atlasSigns = false;

  constructor(readonly L: LevelBuild, readonly name: string) {}

  // ── transform stack ──
  push(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0): this {
    this.stack.push(this.m.clone());
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(1, 1, 1));
    this.m.multiply(_m);
    return this;
  }
  pushScale(sx: number, sy: number, sz: number): this {
    this.stack.push(this.m.clone());
    this.m.multiply(_m.makeScale(sx, sy, sz));
    return this;
  }
  pop(): this { this.m.copy(this.stack.pop()!); return this; }
  at(x: number, y: number, z: number, ry: number, fn: () => void): this {
    this.push(x, y, z, ry); fn(); return this.pop();
  }
  /** Run `fn` with shadow casting disabled (detail geometry). */
  detail(fn: () => void): this {
    this.castStack.push(this.cast); this.cast = false; fn(); this.cast = this.castStack.pop()!; return this;
  }
  solid(fn: () => void): this {
    this.castStack.push(this.cast); this.cast = true; fn(); this.cast = this.castStack.pop()!; return this;
  }

  mat(m: Mat): THREE.Material { return typeof m === 'string' ? this.L.ctx.materials.get(m) : m; }

  private batch(m: Mat, cast: boolean): Batch {
    const mat = this.mat(m);
    const key = mat.uuid + (cast ? 'c' : 'n');
    let b = this.batches.get(key);
    if (!b) this.batches.set(key, (b = { mat, cast, items: [] }));
    return b;
  }

  /** Add any geometry under the current transform (optionally with an extra local matrix). */
  geo(m: Mat, g: THREE.BufferGeometry, uv: UvMode = 'box', local?: THREE.Matrix4, su = 1, sv = 1): this {
    const mm = this.m.clone();
    if (local) mm.multiply(local);
    this.batch(m, this.cast).items.push({ geo: g, m: mm, uv, su, sv, src: ZDEBUG ? callSite() : undefined });
    return this;
  }

  private trs(x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number) {
    return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
  }

  /** Box by centre + size. */
  box(m: Mat, cx: number, cy: number, cz: number, w: number, h: number, d: number): this {
    return this.geo(m, unitBox(), 'box', this.trs(cx, cy, cz, 0, 0, 0, w, h, d));
  }
  /** Box by min / max corners. */
  bx(m: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    return this.box(m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  }
  /** Rotated box (Euler YXZ). */
  rbox(m: Mat, cx: number, cy: number, cz: number, w: number, h: number, d: number, rx = 0, ry = 0, rz = 0): this {
    return this.geo(m, unitBox(), 'box', this.trs(cx, cy, cz, rx, ry, rz, w, h, d));
  }
  /** Capped cylinder / frustum along an axis. `rTop` (the +axis end) defaults to r. */
  cyl(m: Mat, cx: number, cy: number, cz: number, r: number, len: number, axis: Axis = 'y', seg = 10, rTop?: number): this {
    const g = rTop === undefined || rTop === r ? unitCyl(seg) : unitCone(seg, rTop / r);
    const rx = axis === 'z' ? Math.PI / 2 : 0, rz = axis === 'x' ? -Math.PI / 2 : 0;
    return this.geo(m, g, 'keep', this.trs(cx, cy, cz, rx, 0, rz, r, len, r), 2 * Math.PI * r, len);
  }
  /** Cylinder between two points. */
  rod(m: Mat, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, seg = 8): this {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return this;
    _q.setFromUnitVectors(Y_AXIS, _p.set(dx / len, dy / len, dz / len));
    const mm = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(r, len, r));
    return this.geo(m, unitCyl(seg), 'keep', mm, 2 * Math.PI * r, len);
  }
  sphere(m: Mat, cx: number, cy: number, cz: number, r: number, seg = 10, sy = 1, sx = 1, sz = 1): this {
    return this.geo(m, unitSphere(seg), 'keep', this.trs(cx, cy, cz, 0, 0, 0, r * sx, r * sy, r * sz), 2 * Math.PI * r, Math.PI * r);
  }
  torus(m: Mat, cx: number, cy: number, cz: number, r: number, tube: number, axis: Axis = 'y', seg = 14): this {
    const rx = axis === 'y' ? Math.PI / 2 : 0, ry = axis === 'x' ? Math.PI / 2 : 0;
    return this.geo(m, unitTorus(seg, tube / r), 'keep', this.trs(cx, cy, cz, rx, ry, 0, r, r, r), 2 * Math.PI * r, 2 * Math.PI * tube);
  }
  /**
   * Flat quad lying on a surface whose outward normal is `face`. (cx,cy,cz) is the point ON the surface;
   * the quad is lifted by `off`. `uv`='unit' → 0..1 (decals, signs, screens); 'box' → metres.
   */
  quad(m: Mat, cx: number, cy: number, cz: number, w: number, h: number, face: Face, rot = 0, uv: UvMode = 'unit', off = 0): this {
    const n = FACE_N[face], fe = FACE_EULER[face];
    const mm = new THREE.Matrix4().compose(
      new THREE.Vector3(cx + n[0] * off, cy + n[1] * off, cz + n[2] * off),
      new THREE.Quaternion().setFromEuler(_e.set(fe[0], fe[1], fe[2], 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    if (rot) mm.multiply(_m.makeRotationZ(rot));
    mm.multiply(_m.makeScale(w, h, 1));
    return this.geo(m, unitPlane(), uv, mm);
  }
  /** Decal quad (never casts). */
  decal(name: DecalName, variant: number, cx: number, cy: number, cz: number, w: number, h: number, face: Face, rot = 0, off = 0.004): this {
    const c = this.cast; this.cast = false;
    this.quad(this.L.ctx.materials.decal(name, variant), cx, cy, cz, w, h, face, rot, 'unit', off);
    this.cast = c;
    return this;
  }
  /** Text sign quad (never casts). `plate` adds a thin backing plate. */
  sign(text: string, style: SignStyle, cx: number, cy: number, cz: number, w: number, h: number, face: Face, rot = 0, plate = false): this {
    const c = this.cast; this.cast = false;
    const off = plate ? 0.014 : 0.005;
    if (plate) {
      const n = FACE_N[face], fe = FACE_EULER[face];
      const mm = new THREE.Matrix4().compose(
        new THREE.Vector3(cx + n[0] * 0.006, cy + n[1] * 0.006, cz + n[2] * 0.006),
        new THREE.Quaternion().setFromEuler(_e.set(fe[0], fe[1], fe[2], 'YXZ')), new THREE.Vector3(1, 1, 1));
      if (rot) mm.multiply(_m.makeRotationZ(rot));
      mm.multiply(_m.makeScale(w + 0.04, h + 0.04, 0.012));
      this.geo('painted_dark', unitBox(), 'box', mm);
    }
    const at = this.atlasSigns ? this.L.signSlot(text, style, w / h) : null;
    if (at) {
      this.quad(at.mat, cx, cy, cz, w, h, face, rot, 'unit', off);
      const items = this.batch(at.mat, false).items;
      items[items.length - 1].uvr = at.rect;
    } else this.quad(this.L.signMat(text, style, w / h), cx, cy, cz, w, h, face, rot, 'unit', off);
    this.cast = c;
    return this;
  }

  /** Static collision box (local coords, honours transform). `nav` = counts as a nav obstacle. */
  collide(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, surface: Surface = 'metal', nav = true): this {
    const mm = this.m.clone().multiply(
      _m.compose(_p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q.identity(), _s.set(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))),
    );
    this.L.addCollider(mm, surface, nav);
    return this;
  }

  /** Stamp an instanced prop (defined with LevelBuild.defineInstance) under the current transform. */
  inst(name: string, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): this {
    let list = this.insts.get(name);
    if (!list) this.insts.set(name, (list = []));
    list.push(this.m.clone().multiply(this.trs(x, y, z, rx, ry, rz, sx, sy, sz)));
    return this;
  }

  /** World-space position of a local point under the current transform. */
  world(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(x, y, z).applyMatrix4(this.m);
  }

  /**
   * Merge everything into a Group of (few) meshes: one per material.
   * `proxy` (static zones): visual meshes do not cast; all shadow-casting geometry is merged into ONE
   * invisible caster mesh, so each shadow pass costs a single draw call per zone.
   */
  build(proxy = false): THREE.Group {
    const group = new THREE.Group();
    group.name = this.name;
    group.userData.rooms = this.rooms;
    const byMat = new Map<THREE.Material, Item[]>();
    const casters: Item[] = [];
    let anyCast = false;
    for (const b of this.batches.values()) {
      if (!b.items.length) continue;
      let list = byMat.get(b.mat);
      if (!list) byMat.set(b.mat, (list = []));
      for (const it of b.items) list.push(it);
      const m = b.mat as THREE.Material;
      if (b.cast && !m.transparent) {
        // alpha-tested materials (grates, cage mesh) must cast through their own mesh to keep the pattern
        if (proxy && !(m.alphaTest > 0)) { anyCast = true; for (const it of b.items) casters.push(it); } else (list as any).cast = true;
      }
    }
    for (const [mat, items] of byMat) {
      const geo = mergeItems(items);
      if (ZDEBUG) {
        const r: [number, number, string][] = []; let t0 = 0;
        for (const it of items) { const n = (it.geo.index ? it.geo.index.count : it.geo.getAttribute('position').count) / 3; r.push([t0, n, it.src ?? '?']); t0 += n; }
        geo.userData.srcRanges = r;
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `${this.name}:${mat.name || 'mat'}`;
      mesh.castShadow = !!(items as any).cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      this.tris += geo.index!.count / 3;
    }
    if (proxy && anyCast) {
      const geo = mergeItems(casters);
      geo.deleteAttribute('uv'); geo.deleteAttribute('normal');
      const mesh = new THREE.Mesh(geo, shadowOnlyMaterial());
      mesh.name = `${this.name}:shadow`;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = -10;
      // The proxy only matters in shadow passes. In colour passes its draw range is pushed past the end
      // of the index buffer, which makes the renderer skip the draw call entirely.
      mesh.onBeforeShadow = showRange;
      mesh.onBeforeRender = hideRange;
      group.add(mesh);
    }
    for (const [name, mats] of this.insts) {
      const def = this.L.instDefs.get(name);
      if (!def) { console.warn(`[level] unknown instance "${name}"`); continue; }
      const im = new THREE.InstancedMesh(def.geo, def.mat, mats.length);
      for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.computeBoundingBox();
      im.name = `${this.name}:inst:${name}`;
      im.castShadow = def.cast;
      im.receiveShadow = true;
      im.matrixAutoUpdate = false;
      group.add(im);
      this.tris += (def.geo.index ? def.geo.index.count / 3 : def.geo.getAttribute('position').count / 3) * mats.length;
    }
    this.batches.clear();
    this.insts.clear();
    return group;
  }

  /** Merge everything (ignoring materials) into a single geometry — for instanced prop definitions. */
  bake(): THREE.BufferGeometry {
    const items: Item[] = [];
    for (const b of this.batches.values()) items.push(...b.items);
    this.batches.clear();
    return mergeItems(items);
  }
}

type RangeHook = (r: unknown, s: unknown, c: unknown, cc: unknown, geometry: THREE.BufferGeometry) => void;
const showRange: RangeHook = (_r, _s, _c, _cc, geometry) => { geometry.drawRange.start = 0; };
const hideRange = ((_r: unknown, _s: unknown, _c: unknown, geometry: THREE.BufferGeometry) => { geometry.drawRange.start = 1e9; }) as THREE.Object3D['onBeforeRender'];

let _shadowOnly: THREE.MeshBasicMaterial | null = null;
/** Draws nothing in colour passes; exists only so the mesh is rendered into shadow maps. */
export function shadowOnlyMaterial(): THREE.MeshBasicMaterial {
  if (!_shadowOnly) {
    _shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
    _shadowOnly.name = 'shadow_only';
  }
  return _shadowOnly;
}

export function aabbOf(m: THREE.Matrix4, out = new THREE.Box3()): THREE.Box3 {
  _box.min.set(-0.5, -0.5, -0.5); _box.max.set(0.5, 0.5, 0.5);
  return out.copy(_box).applyMatrix4(m);
}
