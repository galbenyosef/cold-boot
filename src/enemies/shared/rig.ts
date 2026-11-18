/**
 * RigBuilder: collects hard-surface geometry per rigid bone and bakes ONE rigidly-skinned mesh per material
 * for a whole machine (so a 45-bone android costs ~8 draw calls instead of ~100).
 * Geometry + materials are built once per enemy type (RigTemplate) and shared by every instance;
 * instances only clone the bone hierarchy.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { DETAIL } from './prims';

export interface BoneDef {
  name: string;
  parent: number;
  /** Bind transform in model space. */
  bind: THREE.Matrix4;
  /** Bind transform relative to parent. */
  localPos: THREE.Vector3;
  localQuat: THREE.Quaternion;
}

interface Chunk { geo: THREE.BufferGeometry; mat: string; bone: number; mark?: boolean; }

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

export class RigBuilder {
  bones: BoneDef[] = [];
  index = new Map<string, number>();
  private chunks: Chunk[] = [];
  private curBone = 0;
  private curFrame = 0;
  private curMat = 'frame';
  /** When -1, bone-local geometry added with addL is mirrored in X (to build right/left limbs from one function). */
  mirror = 1;
  /** Bones whose geometry should be available as loose debris meshes. */
  debrisBones = new Set<string>();
  /** LOD passes: chunks whose bounding box is smaller than this (largest extent, metres) are dropped. */
  minFeature = 0;
  /** Optional per-material vertex colouring (grime) applied after merging, see build(). */
  colorize: Record<string, (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void> = {};
  /** Material keys folded into another key for every visible build (e.g. all emissive bits → 'glow'). */
  fold: Record<string, string> = {};
  /** Per SOURCE key vertex colour (linear, may exceed 1) written when its chunks are folded (glow tints). */
  tint: Record<string, [number, number, number]> = {};

  /** Final key of a chunk (after LOD remap + fold), tagging folded chunks with their tint colour. */
  private keyOf(c: Chunk, remap?: Record<string, string | null>): string | null {
    let key: string | null = remap && c.mat in remap ? remap[c.mat] : c.mat;
    if (key !== null && this.fold[key]) key = this.fold[key];
    if (key !== null && key !== c.mat && this.tint[c.mat] && !c.geo.getAttribute('color')) {
      const t = this.tint[c.mat];
      const n = c.geo.getAttribute('position').count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = t[0]; col[i * 3 + 1] = t[1]; col[i * 3 + 2] = t[2]; }
      c.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    return key;
  }

  /** Define a bone. Position in MODEL space; optional bind rotation (model space euler YXZ). */
  bone(name: string, parent: string | null, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): number {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    const bind = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    const p = parent === null ? -1 : this.idx(parent);
    const localPos = new THREE.Vector3(x, y, z), localQuat = q.clone();
    if (p >= 0) {
      const inv = new THREE.Matrix4().copy(this.bones[p].bind).invert();
      const local = new THREE.Matrix4().multiplyMatrices(inv, bind);
      local.decompose(localPos, localQuat, new THREE.Vector3());
    }
    const i = this.bones.length;
    this.bones.push({ name, parent: p, bind, localPos, localQuat });
    this.index.set(name, i);
    return i;
  }

  idx(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`[rig] unknown bone ${name}`);
    return i;
  }

  /** Select the bone that subsequent geometry is rigidly bound to. */
  use(bone: string, mirror = 1): this { this.curBone = this.curFrame = this.idx(bone); this.mirror = mirror; return this; }
  /** Keep authoring in the current frame (set by use()) but bind following geometry to another bone (plates, pistons). */
  bind(bone: string): this { this.curBone = this.idx(bone); return this; }
  mat(m: string): this { this.curMat = m; return this; }

  private tooSmall(geo: THREE.BufferGeometry): boolean {
    if (this.minFeature <= 0) return false;
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    return Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) < this.minFeature;
  }

  private push(geo: THREE.BufferGeometry, m: THREE.Matrix4, keepUV: boolean, bone: number) {
    geo.applyMatrix4(m);
    if (this.tooSmall(geo)) { geo.dispose(); return geo; }
    if (m.determinant() < 0) flipWinding(geo);
    if (!keepUV) projectUV(geo);
    const n = geo.getAttribute('position').count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.chunks.push({ geo, mat: this.curMat, bone });
    return geo;
  }

  /** Add geometry given in MODEL space (optionally transformed by `m` first). Ownership of `geo` is taken. */
  add(geo: THREE.BufferGeometry, m?: THREE.Matrix4, keepUV = false): this {
    this.push(geo, m ?? _m.identity(), keepUV, this.curBone);
    return this;
  }

  /** Add geometry given in the current bone's LOCAL space (bind pose). Honors `mirror`. */
  addL(geo: THREE.BufferGeometry, m?: THREE.Matrix4, keepUV = false): this {
    _m2.copy(this.bones[this.curFrame].bind);
    if (this.mirror < 0) _m2.multiply(_m.makeScale(-1, 1, 1));
    if (m) _m2.multiply(m);
    this.push(geo, _m2.clone(), keepUV, this.curBone);
    return this;
  }

  /**
   * Flexible cable: geometry in MODEL space whose vertices are blended between two bones along the
   * dominant direction between `from` and `to` points (model space).
   */
  cable(geo: THREE.BufferGeometry, boneA: string, boneB: string, from: THREE.Vector3, to: THREE.Vector3, ease = true): this {
    const a = this.idx(boneA), b = this.idx(boneB);
    if (this.tooSmall(geo)) { geo.dispose(); return this; }
    projectUV(geo);
    const pos = geo.getAttribute('position');
    const n = pos.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const d = _n.copy(to).sub(from);
    const l2 = d.lengthSq();
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(pos, i).sub(from);
      let t = THREE.MathUtils.clamp(_v.dot(d) / l2, 0, 1);
      if (ease) t = t * t * (3 - 2 * t);
      si[i * 4] = a; si[i * 4 + 1] = b;
      sw[i * 4] = 1 - t; sw[i * 4 + 1] = t;
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.chunks.push({ geo, mat: this.curMat, bone: -1 });
    return this;
  }

  /**
   * Smoothly skinned geometry in MODEL space (REVISION 4 — the human): `weigh` returns up to 4 [bone, weight] pairs
   * per vertex (normalised here). Optional `m` transforms the geometry first.
   */
  addSkinned(geo: THREE.BufferGeometry, weigh: (p: THREE.Vector3) => [string, number][], m?: THREE.Matrix4): this {
    if (m) { geo.applyMatrix4(m); if (m.determinant() < 0) flipWinding(geo); }
    if (this.tooSmall(geo)) { geo.dispose(); return this; }
    projectUV(geo);
    const pos = geo.getAttribute('position');
    const n = pos.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const memo = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(pos, i);
      const ws = weigh(_v).filter((w) => w[1] > 1e-4).sort((x, y) => y[1] - x[1]).slice(0, 4);
      let tot = 0;
      for (const w of ws) tot += w[1];
      if (ws.length === 0 || tot <= 0) { si[i * 4] = this.curBone; sw[i * 4] = 1; continue; }
      for (let k = 0; k < ws.length; k++) {
        let bi = memo.get(ws[k][0]);
        if (bi === undefined) { bi = this.idx(ws[k][0]); memo.set(ws[k][0], bi); }
        si[i * 4 + k] = bi; sw[i * 4 + k] = ws[k][1] / tot;
      }
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.chunks.push({ geo, mat: this.curMat, bone: -1 });
    return this;
  }

  /**
   * Dark-room mark (see `markShader` below): a camera-facing glow disc of `radius` metres at `p` (MODEL space), rigidly
   * bound to `bone`, drawn in the 'glow' mesh (no extra draw call). It never shrinks below ~2.5 px on screen, so it reads
   * at 25 m in a black room; `n` (model space) is the direction it shines — it fades out over `faceMin … faceMin + 0.45`
   * of cos(angle to the viewer) (faceMin ≤ −1.5: omnidirectional). Brightness / size follow the bone's world scale
   * (1 = full, 0.3 = dim standby, 1e-4 = off). `tint`: linear HDR colour. Exempt from LOD feature culling.
   */
  mark(bone: string, p: THREE.Vector3, n: THREE.Vector3, radius: number, tint: [number, number, number], faceMin = -0.15, opts?: MarkOpts): this {
    const bi = this.idx(bone);
    const C = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    const pos = new Float32Array(18), nor = new Float32Array(18), col = new Float32Array(18), uv = new Float32Array(12), mk = new Float32Array(24);
    // stage 3c W3a: per-mark blink (hz, on-fraction); 0 = steady (every mark built before 3c)
    const bk = new Float32Array(12);
    if (opts?.blink && opts.blink.hz > 0 && opts.blink.on > 0 && opts.blink.on < 1) for (let i = 0; i < 6; i++) { bk[i * 2] = opts.blink.hz; bk[i * 2 + 1] = opts.blink.on; }
    const si = new Uint16Array(24), sw = new Float32Array(24);
    _n.copy(n).normalize();
    for (let i = 0; i < 6; i++) {
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      nor[i * 3] = _n.x; nor[i * 3 + 1] = _n.y; nor[i * 3 + 2] = _n.z;
      col[i * 3] = tint[0]; col[i * 3 + 1] = tint[1]; col[i * 3 + 2] = tint[2];
      mk[i * 4] = C[i][0]; mk[i * 4 + 1] = C[i][1]; mk[i * 4 + 2] = radius; mk[i * 4 + 3] = faceMin;
      si[i * 4] = bi; sw[i * 4] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('mark', new THREE.BufferAttribute(mk, 4));
    geo.setAttribute('markBlink', new THREE.BufferAttribute(bk, 2));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.chunks.push({ geo, mat: 'glow', bone: bi, mark: true });
    return this;
  }

  /** Every geometry merged into one mesh needs the same attribute set: zero `mark` (and white `color`) where missing. */
  private static uniform(list: THREE.BufferGeometry[], material: THREE.Material | undefined): void {
    const needMark = material === _glow || list.some((g) => g.getAttribute('mark'));
    const needColor = needMark && list.some((g) => g.getAttribute('color'));
    for (const g of list) {
      const n = g.getAttribute('position').count;
      if (needMark && !g.getAttribute('mark')) g.setAttribute('mark', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
      if (needMark && !g.getAttribute('markBlink')) g.setAttribute('markBlink', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      if (needColor && !g.getAttribute('color')) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
  }

  build(materials: Record<string, THREE.Material>, opts: { shadow: string[]; radius: number; center: THREE.Vector3 }): RigTemplate {
    const byMat = new Map<string, THREE.BufferGeometry[]>();
    for (const c of this.chunks) {
      const key = this.keyOf(c)!;
      if (!materials[key]) throw new Error(`[rig] no material for key ${key}`);
      let list = byMat.get(key);
      if (!list) byMat.set(key, (list = []));
      list.push(c.geo);
    }
    const meshes: TemplateMesh[] = [];
    let triangles = 0;
    for (const [mat, list] of byMat) {
      RigBuilder.uniform(list, materials[mat]);
      let g = mergeGeometries(list, false)!;
      this.applyColor(mat, g);
      g = mergeVertices(g, 1e-5);
      triangles += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
      g.boundingSphere = new THREE.Sphere(opts.center.clone(), opts.radius);
      meshes.push({ key: mat, geometry: g, material: materials[mat], castShadow: opts.shadow.includes(mat) });
    }
    // Debris: per requested bone, one geometry in BONE-LOCAL space with material groups.
    const debris = new Map<string, { geometry: THREE.BufferGeometry; materials: THREE.Material[] }>();
    for (const name of this.debrisBones) {
      const bi = this.idx(name);
      const inv = new THREE.Matrix4().copy(this.bones[bi].bind).invert();
      const groups = new Map<string, THREE.BufferGeometry[]>();
      for (const c of this.chunks) {
        if (c.bone !== bi || c.mark) continue;
        const g = c.geo.clone();
        g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight');
        g.deleteAttribute('color'); g.deleteAttribute('mark'); g.deleteAttribute('markBlink');
        g.applyMatrix4(inv);
        let l = groups.get(c.mat);
        if (!l) groups.set(c.mat, (l = []));
        l.push(g);
      }
      if (groups.size === 0) continue;
      const geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];
      for (const [mat, l] of groups) { geos.push(mergeGeometries(l, false)!); mats.push(materials[mat]); }
      const merged = mergeGeometries(geos, true)!;
      merged.computeBoundingSphere();
      debris.set(name, { geometry: merged, materials: mats });
    }
    for (const c of this.chunks) c.geo.dispose();
    this.chunks.length = 0;
    const boneInverses = this.bones.map((b) => new THREE.Matrix4().copy(b.bind).invert());
    return new RigTemplate(this.bones, boneInverses, meshes, debris, triangles, opts.radius, opts.center);
  }

  private applyColor(mat: string, g: THREE.BufferGeometry): void {
    const fn = this.colorize[mat];
    if (!fn) return;
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    const col = new Float32Array(pos.count * 3);
    const p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nor, i);
      c.setRGB(1, 1, 1);
      fn(p, n, c);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  /**
   * Reduced visible LOD from the chunks authored by THIS builder (run the author code with a low DETAIL.k first).
   * `remap` folds materials together to save draw calls (value null = drop the chunks). Same bone layout as the
   * template it is attached to.
   */
  buildLod(materials: Record<string, THREE.Material>, remap: Record<string, string | null>, opts: { radius: number; center: THREE.Vector3 }): { meshes: TemplateMesh[]; triangles: number } {
    const byMat = new Map<string, THREE.BufferGeometry[]>();
    for (const c of this.chunks) {
      const key = this.keyOf(c, remap);
      if (key === null) continue;
      let list = byMat.get(key);
      if (!list) byMat.set(key, (list = []));
      list.push(c.geo);
    }
    const meshes: TemplateMesh[] = [];
    let triangles = 0;
    for (const [mat, list] of byMat) {
      RigBuilder.uniform(list, materials[mat]);
      let g = mergeGeometries(list, false)!;
      this.applyColor(mat, g);
      g = mergeVertices(g, 1e-5);
      triangles += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
      g.boundingSphere = new THREE.Sphere(opts.center.clone(), opts.radius);
      meshes.push({ key: mat, geometry: g, material: materials[mat], castShadow: false });
    }
    for (const c of this.chunks) c.geo.dispose();
    this.chunks.length = 0;
    return { meshes, triangles };
  }

  /** One merged position-only geometry (all materials except `exclude`) used as the shadow-casting proxy. */
  buildShadow(exclude: string[], opts: { radius: number; center: THREE.Vector3 }): { geometry: THREE.BufferGeometry; triangles: number } {
    const list: THREE.BufferGeometry[] = [];
    for (const c of this.chunks) {
      if (exclude.includes(c.mat) || c.mark) continue;
      c.geo.deleteAttribute('normal'); c.geo.deleteAttribute('uv');
      list.push(c.geo);
    }
    let g = mergeGeometries(list, false)!;
    g = mergeVertices(g, 1e-4);
    for (const c of this.chunks) c.geo.dispose();
    this.chunks.length = 0;
    g.boundingSphere = new THREE.Sphere(opts.center.clone(), opts.radius);
    return { geometry: g, triangles: g.index ? g.index.count / 3 : g.getAttribute('position').count / 3 };
  }
}

let _glow: THREE.MeshBasicMaterial | null = null;
/** Unlit HDR material for every small emissive bit of the machines; colour comes from vertex colours (tint). */
export function glowMaterial(): THREE.MeshBasicMaterial {
  if (!_glow) {
    _glow = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    _glow.name = 'enemy_glow';
    markShader(_glow, { value: 0 });
  }
  return _glow;
}

/**
 * Stage 3c W3a: per-mark blink (`RigBuilder.mark(…, { blink })`). A blinking mark is lit for the first `on` fraction of
 * every 1 / `hz` s of `markTime()` shifted by the material's phase; between, its disc collapses (nothing drawn). The
 * shared `glowMaterial()` has phase 0; `blinkGlowMaterial(phase)` is a private copy (same program, own phase) for
 * one instance (`RigTemplate.instantiate({ glow })`), so each soldier blinks on his own beat. Steady marks (every
 * mark built before 3c) ignore all of it.
 */
export interface MarkOpts { blink?: { hz: number; on: number } }
export function blinkGlowMaterial(phase: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  m.name = 'enemy_glow';
  markShader(m, { value: ((phase % 1) + 1) % 1 });
  return m;
}
/** Clock of every blinking mark (seconds; the game sets it from world time, else performance time is used). */
const uMarkTime = { value: 0 };
let markClockSet = false;
export function setMarkTime(t: number): void { uMarkTime.value = t; markClockSet = true; }
export function markTime(): number { return uMarkTime.value; }

/**
 * Dark-room marks (RigBuilder.mark): the glow material grows each mark's disc to at least MARK_PX (fraction of the
 * viewport height, ≥ 2 px) so the point survives distance, sub-pixel geometry and the LOD; a mark seen from behind
 * its `faceMin` cone shrinks back to its real size (no dark disc on a lit shell). Ordinary glow geometry (mark = 0)
 * renders exactly as before. The disc is pulled toward the viewer by its radius (+ ≤ 6 cm once grown) so its own housing does not clip it.
 */
const MARK_FRAC = 0.0026, MARK_MIN_PX = 2.2;
function markShader(m: THREE.MeshBasicMaterial, uPhase: { value: number }): void {
  const uH = { value: 720 }, uPx = { value: 2.2 };
  const vp = new THREE.Vector4();
  m.onBeforeRender = (renderer) => {
    renderer.getCurrentViewport(vp);
    const h = vp.w > 0 ? vp.w : 720;
    uH.value = h; uPx.value = Math.max(MARK_MIN_PX, h * MARK_FRAC);
    if (!markClockSet) uMarkTime.value = performance.now() / 1000;
  };
  m.customProgramCacheKey = () => 'enemy_glow_marks_3';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMarkH = uH; sh.uniforms.uMarkPx = uPx; sh.uniforms.uMarkTime = uMarkTime; sh.uniforms.uMarkPhase = uPhase;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 mark;
attribute vec2 markBlink;
uniform float uMarkH;
uniform float uMarkPx;
uniform float uMarkTime;
uniform float uMarkPhase;
varying vec3 vMark;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vMark = vec3(0.0, 0.0, -1.0);
#ifdef USE_SKINNING
if (mark.z > 0.0) {
  float s = length(skinMatrix[0].xyz);
  vec3 toCam = normalize(-mvPosition.xyz);
  float face = mark.w < -1.5 ? 1.0 : smoothstep(mark.w, mark.w + 0.45, dot(normalize(transformedNormal), toCam));
  float px = -mvPosition.z * 2.0 / (projectionMatrix[1][1] * uMarkH);
  float bl = (markBlink.x > 0.0 && markBlink.y > 0.0 && markBlink.y < 1.0) ? step(fract(uMarkTime * markBlink.x + uMarkPhase), markBlink.y) : 1.0;
  float rNat = mark.z * s * bl;
  // a BLINKING mark (only the soldier's Clasp: W3a's per-mark blink) grows to 1.5 × the minimum and burns 1.4 ×
  // brighter — it must be picked out at 20–30 m in the dark bay (≥ 3 px at 25 m on 720p; IA5 / B7)
  float grow = markBlink.x > 0.0 ? 1.5 : 1.0;
  float r = max(rNat, 0.5 * uMarkPx * grow * px * step(0.05, s) * face * bl);
  vec3 c = mvPosition.xyz + toCam * (rNat + min((r - rNat) * 1.5, 0.06));
  mvPosition = vec4(c + vec3(mark.xy * r, 0.0), 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vMark = vec3(mark.xy, min(s, 1.6) * mix(0.3, 1.0, face) * (grow > 1.0 && r > rNat ? 1.4 : 1.0));
}
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vMark;`)
      .replace('#include <opaque_fragment>', `if (vMark.z >= 0.0) {
  float d2 = dot(vMark.xy, vMark.xy);
  if (d2 > 1.0) discard;
  outgoingLight *= vMark.z * (1.0 - 0.6 * d2);
}
#include <opaque_fragment>`);
  };
}

/** Linear RGB × intensity of a library emissive colour, for glow vertex tints. */
export function tintOf(hex: number, intensity: number): [number, number, number] {
  const c = new THREE.Color(hex).multiplyScalar(intensity);
  return [c.r, c.g, c.b];
}

export interface LodSpec {
  /** Tessellation factor for prims (see DETAIL). */
  k: number;
  minFeature: number;
}

/**
 * Run `author` (which defines bones + geometry on a fresh builder) three times: hero mesh, distance LOD, shadow
 * proxy. All three share one bone layout, so every instance drives them with ONE skeleton.
 */
export function buildRigLods<T>(
  author: (b: RigBuilder) => T,
  materials: Record<string, THREE.Material>,
  opts: {
    radius: number; center: THREE.Vector3;
    lod: LodSpec & { remap: Record<string, string | null> };
    proxy: LodSpec & { exclude: string[] };
    colorize?: RigBuilder['colorize'];
    fold?: RigBuilder['fold'];
    tint?: RigBuilder['tint'];
  },
): { template: RigTemplate; data: T } {
  const run = (k: number, minFeature: number) => {
    const b = new RigBuilder();
    b.minFeature = minFeature;
    if (opts.colorize) b.colorize = opts.colorize;
    if (opts.fold) b.fold = opts.fold;
    if (opts.tint) b.tint = opts.tint;
    DETAIL.k = k;
    try { return { b, data: author(b) }; } finally { DETAIL.k = 1; }
  };
  const hero = run(1, 0);
  const template = hero.b.build(materials, { shadow: [], radius: opts.radius, center: opts.center });
  const lod = run(opts.lod.k, opts.lod.minFeature);
  const l1 = lod.b.buildLod(materials, opts.lod.remap, opts);
  const px = run(opts.proxy.k, opts.proxy.minFeature);
  const sh = px.b.buildShadow(opts.proxy.exclude, opts);
  template.lod1 = l1.meshes; template.lod1Triangles = l1.triangles;
  template.shadowGeometry = sh.geometry; template.shadowTriangles = sh.triangles;
  return { template, data: hero.data };
}

let _shadowOnly: THREE.MeshBasicMaterial | null = null;
/** Writes nothing in colour passes; the mesh exists only to be rendered into shadow maps. */
function shadowOnlyMaterial(): THREE.MeshBasicMaterial {
  if (!_shadowOnly) {
    _shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
    _shadowOnly.name = 'enemy_shadow_proxy';
  }
  return _shadowOnly;
}

interface TemplateMesh { key: string; geometry: THREE.BufferGeometry; material: THREE.Material; castShadow: boolean; }

export class RigTemplate {
  /** Distance LOD meshes (same skeleton). Empty = no LOD. */
  lod1: TemplateMesh[] = [];
  lod1Triangles = 0;
  /** Shadow-only proxy geometry (position + skinning). Null = the hero meshes cast. */
  shadowGeometry: THREE.BufferGeometry | null = null;
  shadowTriangles = 0;
  constructor(
    public bones: BoneDef[],
    private boneInverses: THREE.Matrix4[],
    public meshes: TemplateMesh[],
    public debris: Map<string, { geometry: THREE.BufferGeometry; materials: THREE.Material[] }>,
    public triangles: number,
    public radius: number,
    public center: THREE.Vector3,
  ) {}

  get drawCalls(): number { return this.meshes.length; }

  instantiate(materialOverride?: Record<string, THREE.Material>): Rig {
    const root = new THREE.Group();
    const bones: THREE.Bone[] = [];
    const byName: Record<string, THREE.Bone> = {};
    for (const d of this.bones) {
      const b = new THREE.Bone();
      b.name = d.name;
      b.position.copy(d.localPos);
      b.quaternion.copy(d.localQuat);
      bones.push(b);
      byName[d.name] = b;
      if (d.parent >= 0) bones[d.parent].add(b); else root.add(b);
    }
    const skeleton = new THREE.Skeleton(bones, this.boneInverses);
    const make = (geometry: THREE.BufferGeometry, material: THREE.Material, cast: boolean, receive: boolean) => {
      const m = new THREE.SkinnedMesh(geometry, material);
      m.castShadow = cast;
      m.receiveShadow = receive;
      m.bind(skeleton, IDENTITY);
      // Fixed generous bounds (three would otherwise compute bounds once from the bind pose).
      m.boundingSphere = new THREE.Sphere(this.center.clone(), this.radius);
      m.matrixAutoUpdate = false;
      root.add(m);
      return m;
    };
    const proxy = this.shadowGeometry !== null;
    const meshes: THREE.SkinnedMesh[] = [];
    for (const t of this.meshes) { const m = make(t.geometry, materialOverride?.[t.key] ?? t.material, proxy ? false : t.castShadow, true); m.userData.key = t.key; meshes.push(m); }
    const lod1: THREE.SkinnedMesh[] = [];
    for (const t of this.lod1) { const m = make(t.geometry, materialOverride?.[t.key] ?? t.material, false, true); m.userData.key = t.key; m.visible = false; lod1.push(m); }
    let shadow: THREE.SkinnedMesh | null = null;
    if (this.shadowGeometry) {
      shadow = make(this.shadowGeometry, shadowOnlyMaterial(), true, false);
      shadow.renderOrder = -10;
    }
    return new Rig(this, root, bones, byName, skeleton, meshes, lod1, shadow);
  }

  /** Loose (non-skinned) mesh of one bone's geometry, for debris. Null when the bone has none registered. */
  debrisMesh(bone: string): THREE.Mesh | null {
    const d = this.debris.get(bone);
    if (!d) return null;
    const m = new THREE.Mesh(d.geometry, d.materials);
    m.castShadow = true;
    return m;
  }
}

const IDENTITY = new THREE.Matrix4();

export class Rig {
  /** Pose buffer layout: per bone quaternion (4), then hips/root-bone position (3). */
  readonly poseSize: number;
  constructor(
    public template: RigTemplate,
    public root: THREE.Group,
    public bones: THREE.Bone[],
    public byName: Record<string, THREE.Bone>,
    public skeleton: THREE.Skeleton,
    public meshes: THREE.SkinnedMesh[],
    public lod1: THREE.SkinnedMesh[] = [],
    public shadow: THREE.SkinnedMesh | null = null,
  ) {
    this.poseSize = bones.length * 4 + 3;
  }

  /** Currently shown visible LOD (0 hero, 1 reduced). */
  lod = 0;
  setLod(level: number): void {
    if (this.lod1.length === 0) level = 0;
    if (level === this.lod) return;
    this.lod = level;
    this.refresh();
  }
  /** Material keys whose meshes are currently not drawn (e.g. emissive eyes of a powered-down machine). */
  private off = new Set<string>();
  setKeysVisible(keys: readonly string[], on: boolean): void {
    let changed = false;
    for (const k of keys) {
      if (on ? this.off.delete(k) : !this.off.has(k)) { changed = true; if (!on) this.off.add(k); }
    }
    if (changed) this.refresh();
  }
  private refresh(): void {
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i].visible = this.lod === 0 && !this.off.has(this.meshes[i].userData.key);
    for (let i = 0; i < this.lod1.length; i++) this.lod1[i].visible = this.lod === 1 && !this.off.has(this.lod1[i].userData.key);
  }
  /** Enable / disable the shadow proxy (e.g. while hidden). */
  setShadow(on: boolean): void { if (this.shadow) this.shadow.castShadow = on; }

  b(name: string): THREE.Bone {
    const bone = this.byName[name];
    if (!bone) throw new Error(`[rig] no bone ${name}`);
    return bone;
  }

  newPose(): Float32Array { return new Float32Array(this.poseSize); }

  /** Store every bone quaternion + first bone position. */
  capture(out: Float32Array): Float32Array {
    const bs = this.bones;
    for (let i = 0; i < bs.length; i++) {
      const q = bs[i].quaternion;
      out[i * 4] = q.x; out[i * 4 + 1] = q.y; out[i * 4 + 2] = q.z; out[i * 4 + 3] = q.w;
    }
    const p = bs[0].position, o = bs.length * 4;
    out[o] = p.x; out[o + 1] = p.y; out[o + 2] = p.z;
    return out;
  }

  apply(pose: Float32Array): void {
    const bs = this.bones;
    for (let i = 0; i < bs.length; i++) bs[i].quaternion.set(pose[i * 4], pose[i * 4 + 1], pose[i * 4 + 2], pose[i * 4 + 3]);
    const o = bs.length * 4;
    bs[0].position.set(pose[o], pose[o + 1], pose[o + 2]);
  }

  /** Blend the CURRENT bone state toward `pose` by weight w (0 = keep current, 1 = pose). */
  blendTo(pose: Float32Array, w: number): void {
    if (w <= 0) return;
    if (w >= 1) { this.apply(pose); return; }
    const bs = this.bones;
    for (let i = 0; i < bs.length; i++) {
      _q.set(pose[i * 4], pose[i * 4 + 1], pose[i * 4 + 2], pose[i * 4 + 3]);
      bs[i].quaternion.slerp(_q, w);
    }
    const o = bs.length * 4, p = bs[0].position;
    p.x += (pose[o] - p.x) * w; p.y += (pose[o + 1] - p.y) * w; p.z += (pose[o + 2] - p.z) * w;
  }

  /** Reset to bind pose. */
  reset(): void {
    const defs = this.template.bones;
    for (let i = 0; i < defs.length; i++) {
      this.bones[i].quaternion.copy(defs[i].localQuat);
      this.bones[i].position.copy(defs[i].localPos);
      this.bones[i].scale.set(1, 1, 1);
    }
  }
}

const _q = new THREE.Quaternion();

function flipWinding(g: THREE.BufferGeometry) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    const arr = a.array as any, s = a.itemSize;
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < s; k++) {
        const t = arr[(i + 1) * s + k];
        arr[(i + 1) * s + k] = arr[(i + 2) * s + k];
        arr[(i + 2) * s + k] = t;
      }
    }
  }
}

/** Box-project UVs in metres (1 UV = 1 m) from model-space position, per triangle dominant axis. */
function projectUV(g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i += 3) {
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) { nx += nor.getX(i + k); ny += nor.getY(i + k); nz += nor.getZ(i + k); }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k), y = pos.getY(i + k), z = pos.getZ(i + k);
      if (ax >= ay && ax >= az) uv.setXY(i + k, z, y);
      else if (ay >= az) uv.setXY(i + k, x, z);
      else uv.setXY(i + k, x, y);
    }
  }
}
