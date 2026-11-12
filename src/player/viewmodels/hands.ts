/**
 * Procedural gloved hands + sleeved forearms.
 *
 * Canonical RIGHT hand frame: origin = wrist pivot, +Y toward the fingers, +Z = back of the hand
 * (dorsal), -Z = palm, thumb on the -X side. The left hand is the same rig mirrored (scale.x = -1).
 *
 * Surfaces are sampled from parametric functions (palm loft with anatomical bulges, phalanges with
 * spherical joint ends of matching radius so neighbouring segments read as one continuous finger),
 * with padded panels lifted off the same functions so details conform to the hand.
 * The finger rig is 21 parameters (per finger: spread + 3 curls; thumb: 3 CMC angles + 2 curls); poses
 * are plain parameter vectors that blend continuously.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { M, Parts, rbox, sweep, sphere, deform, boxUV, type G, type Station } from '../geom';
import type { VmMats } from './mats';
import { rng } from '../math';

/** Finger: [splay, curl0, curl1, curl2] ×4 (index, middle, ring, pinky), thumb: [ry, rx, rz, curl1, curl2]. */
export type HandPose = number[];
export const POSE_LEN = 21;
export const THUMB = 16;

export function pose(fingers: number[][], thumb: number[]): HandPose {
  const p: number[] = [];
  for (const f of fingers) p.push(f[0], f[1], f[2], f[3]);
  p.push(...thumb);
  return p;
}
const D = Math.PI / 180;
/** Helper: degrees → pose. */
export function poseDeg(fingers: number[][], thumb: number[]): HandPose {
  return pose(fingers.map((f) => f.map((v) => v * D)), thumb.map((v) => v * D));
}

export const POSES = {
  relaxed: poseDeg([[3, 16, 24, 12], [0, 22, 30, 16], [-3, 28, 34, 18], [-7, 32, 38, 20]], [0, 4, 0, 12, 14]),
  open: poseDeg([[5, 4, 6, 3], [0, 4, 6, 3], [-5, 5, 7, 3], [-10, 6, 8, 4]], [-10, -4, 12, 4, 4]),
  fist: poseDeg([[0, 84, 96, 55], [0, 86, 98, 55], [0, 88, 98, 55], [0, 90, 96, 55]], [30, 30, 10, 30, 40]),
};

export interface FingerSpec { x: number; y: number; z: number; len: [number, number, number]; r: [number, number, number, number]; }
export const FINGERS: FingerSpec[] = [
  { x: -0.0285, y: 0.093, z: -0.001, len: [0.044, 0.026, 0.0225], r: [0.0096, 0.0088, 0.0081, 0.0072] },
  { x: -0.0095, y: 0.098, z: 0.0, len: [0.048, 0.030, 0.0235], r: [0.0099, 0.0091, 0.0084, 0.0074] },
  { x: 0.0095, y: 0.095, z: -0.0005, len: [0.045, 0.028, 0.0225], r: [0.0095, 0.0087, 0.0080, 0.0071] },
  { x: 0.0275, y: 0.086, z: -0.002, len: [0.035, 0.021, 0.0195], r: [0.0085, 0.0078, 0.0071, 0.0063] },
];
export const THUMB_POS = { x: -0.0235, y: 0.02, z: -0.0065 };
export const THUMB_LEN: [number, number, number] = [0.045, 0.0315, 0.027];
export const THUMB_R: [number, number, number, number] = [0.0132, 0.012, 0.0109, 0.0096];
/** Fingertip dome length factors (× tip radius). */
const TIP_K = 1.45;

// ───────────────────────────────────────────── parametric surface sampling

type Fn = (u: number, v: number, o: THREE.Vector3) => void;
type RGB = readonly [number, number, number];
/** Vertex tints (multiply the fabric albedo): back-of-hand textile, palm suede, dark trim. */
const C_BACK: RGB = [0.125, 0.092, 0.07];
const C_PALM: RGB = [0.19, 0.125, 0.08];
const C_PALM2: RGB = [0.12, 0.08, 0.052];
const C_TRIM: RGB = [0.03, 0.03, 0.03];
const C_ONE: RGB = [1, 1, 1];

const _p = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _wk = new THREE.Vector3(), _wd = new THREE.Vector3(), _wn = new THREE.Vector3(), _wy = new THREE.Vector3(0, 1, 0);
const _la = new THREE.Vector3(), _lb = new THREE.Vector3(), _lc = new THREE.Vector3(), _ld = new THREE.Vector3();

/** Sample `fn` over a (u, v) grid → non-indexed geometry (position, normal, color). Outward = dP/dv × dP/du. */
function surf(fn: Fn, u0: number, u1: number, nu: number, v0: number, v1: number, nv: number, col: RGB = C_ONE): G {
  const cols = nu + 1, rows = nv + 1;
  const P = new Float32Array(cols * rows * 3), N = new Float32Array(cols * rows * 3);
  const du = (u1 - u0) / nu, dv = (v1 - v0) / nv;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = u0 + i * du, v = v0 + j * dv, k = (j * cols + i) * 3;
      fn(u, v, _p);
      fn(u + du * 0.5, v, _a); fn(u - du * 0.5, v, _b); fn(u, v + dv * 0.5, _c); fn(u, v - dv * 0.5, _d);
      _a.sub(_b); _c.sub(_d);
      _b.crossVectors(_c, _a);
      const l = _b.length();
      if (l > 1e-12) _b.multiplyScalar(1 / l); else _b.set(0, 1, 0);
      P[k] = _p.x; P[k + 1] = _p.y; P[k + 2] = _p.z;
      N[k] = _b.x; N[k + 1] = _b.y; N[k + 2] = _b.z;
    }
  }
  const n = nu * nv * 6;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), color = new Float32Array(n * 3);
  let w = 0;
  const put = (k: number) => {
    pos[w] = P[k * 3]; pos[w + 1] = P[k * 3 + 1]; pos[w + 2] = P[k * 3 + 2];
    nor[w] = N[k * 3]; nor[w + 1] = N[k * 3 + 1]; nor[w + 2] = N[k * 3 + 2];
    color[w] = col[0]; color[w + 1] = col[1]; color[w + 2] = col[2];
    w += 3;
  };
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      put(a); put(c); put(b); put(b); put(c); put(d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return g;
}

/** Offset a surface along its normal by `lift(u, v, basePoint)` (padded panels that conform to the base). */
function lifted(fn: Fn, lift: (u: number, v: number, p: THREE.Vector3) => number, eu = 0.03, ev = 0.012): Fn {
  return (u, v, o) => {
    fn(u, v, o);
    const h = lift(u, v, o);
    fn(u + eu, v, _la); fn(u - eu, v, _lb); fn(u, v + ev, _lc); fn(u, v - ev, _ld);
    _la.sub(_lb); _lc.sub(_ld);
    _lb.crossVectors(_lc, _la);
    const l = _lb.length();
    if (l > 1e-12) o.addScaledVector(_lb, h / l);
  };
}

const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Plateau 0→1→0 over [a, b] with soft margins m. */
const plateau = (x: number, a: number, b: number, m: number) => sstep(a, a + m, x) * (1 - sstep(b - m, b, x));
const gauss = (x: number, s: number) => Math.exp(-(x * x) / (s * s));
const spow = (c: number, e: number) => Math.sign(c) * Math.pow(Math.abs(c), e);

function tinted(g: G, col: RGB): G {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/**
 * Hand geometry sink. Every part (palm, 14 phalanges, web roll) is authored in the space of the joint it rides on,
 * UV-mapped there, then moved into the hand's bind space and tagged with that joint's bone index — so a whole
 * hand is one rigidly-skinned mesh per material (3 draw calls instead of 29).
 */
class Skin {
  readonly bones: THREE.Bone[] = [];
  private readonly parts = new Map<THREE.Material, G[]>();
  bone(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Bone {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent.add(b);
    this.bones.push(b);
    return b;
  }
  /** Merge (position, normal, color) geometries given in `bone` space into this material's skinned mesh. */
  add(mat: THREE.Material, list: G[], bone: THREE.Bone, root: THREE.Object3D, uvOffset = 0) {
    const g = list.length === 1 ? list[0] : mergeGeometries(list, false)!;
    if (g !== list[0]) for (const l of list) l.dispose();
    boxUV(g, uvOffset, 5);
    // bind pose: bone → hand root
    root.updateMatrixWorld(true);
    g.applyMatrix4(_bm.copy(root.matrixWorld).invert().multiply(bone.matrixWorld));
    const n = g.getAttribute('position').count, bi = this.bones.indexOf(bone);
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    let arr = this.parts.get(mat);
    if (!arr) this.parts.set(mat, (arr = []));
    arr.push(g);
  }
  build(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    for (const [mat, list] of this.parts) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false)!;
      if (g !== list[0]) for (const l of list) l.dispose();
      g.computeBoundingSphere();
      const mesh = new THREE.SkinnedMesh(g, mat);
      mesh.frustumCulled = false;
      root.add(mesh);
      mesh.bind(skeleton, _bm.identity());
    }
    this.parts.clear();
  }
}
const _bm = new THREE.Matrix4();

// ───────────────────────────────────────────── palm

const PALM_Y0 = -0.009, PALM_Y1 = 0.106;
const PW: [number, number][] = [[-0.009, 0.0262], [0.0, 0.0282], [0.02, 0.0325], [0.05, 0.0392], [0.08, 0.0432], [0.095, 0.0428], [0.106, 0.041]];
const PH: [number, number][] = [[-0.009, 0.0152], [0.0, 0.0160], [0.02, 0.0168], [0.05, 0.0158], [0.08, 0.0136], [0.095, 0.0117], [0.106, 0.0104]];
function table(t: [number, number][], x: number): number {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) { const k = sstep(t[i - 1][0], t[i][0], x); return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * (0.5 * k + 0.5 * (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0])); }
  }
  return t[t.length - 1][1];
}

/** u: angle around the hand axis (0 = pinky edge, π/2 = back, π = thumb edge, 3π/2 = palm); v: 0 wrist … 1 knuckles. */
const palmFn: Fn = (u, v, o) => {
  v = Math.min(1, Math.max(0, v));
  let y = PALM_Y0 + (PALM_Y1 - PALM_Y0) * v;
  // rounded closures at both ends
  const c0 = Math.min(1, (y - PALM_Y0) / 0.012), c1 = Math.min(1, (PALM_Y1 - y) / 0.0085);
  const k0 = Math.max(0.02, Math.sqrt(1 - (1 - c0) * (1 - c0))), k1 = Math.max(0.02, Math.sqrt(1 - (1 - c1) * (1 - c1)));
  // wrist end closes to a dome, knuckle end to a rounded web edge
  const w = table(PW, y) * k0 * (0.93 + 0.07 * k1), h = table(PH, y) * (0.3 + 0.7 * k0) * k1;
  const cu = Math.cos(u), su = Math.sin(u);
  const dz = spow(su, 0.78);
  let x = spow(cu, 0.78) * w, z = dz * h;
  const pm = Math.max(0, -dz), dm = Math.max(0, dz);
  // the back of the hand ends at the knuckles; the palm pad runs further under the finger bases
  y -= sstep(0.07, PALM_Y1, y) * 0.0075 * (0.5 + 0.5 * dz);
  // knuckle arc: middle finger furthest, pinky shortest
  if (y > 0.05) y = 0.05 + (y - 0.05) * (1 - (10.7 * (x + 0.006) * (x + 0.006)) / 0.048);
  // thenar eminence (thumb muscle), hypothenar, palm hollow, pads under the finger bases
  const th = gauss(x + 0.021, 0.019) * gauss(y - 0.034, 0.028);
  z -= 0.0088 * th * Math.pow(pm, 0.7);
  x -= 0.0045 * th;
  z -= 0.0046 * gauss(x - 0.024, 0.014) * gauss(y - 0.03, 0.03) * pm;
  z += 0.003 * gauss(x - 0.002, 0.014) * gauss(y - 0.058, 0.02) * pm;
  z -= 0.0022 * gauss(y - 0.088, 0.009) * pm;
  // knuckles + shallow tendon ridges on the back
  for (let i = 0; i < 4; i++) {
    const f = FINGERS[i];
    z += 0.0034 * gauss(x - f.x, 0.0078) * gauss(y - (f.y - 0.003), 0.0085) * dm;
    z += 0.0007 * gauss(x - f.x * 0.82, 0.004) * plateau(y, 0.02, f.y - 0.008, 0.02) * dm;
  }
  o.set(x, y, z);
};
const palmV = (y: number) => (y - PALM_Y0) / (PALM_Y1 - PALM_Y0);

// ───────────────────────────────────────────── phalanges

/**
 * Tapered phalanx along +Y: joint sphere (radius r0) at the origin, shaft to `len`, joint sphere r1 (or a
 * fingertip). u: 0 = +X, π/2 = back, 3π/2 = pad side. `va`/`vb` = v at the start / end of the shaft.
 */
function phalanxFn(len: number, r0: number, r1: number, tip: boolean) {
  const tipLen = tip ? r1 * TIP_K : r1;
  const a = r0 * 1.5, c = tip ? r1 * 2.0 : r1 * 1.5;
  const total = a + len + c;
  const va = a / total, vb = (a + len) / total;
  const fn: Fn = (u, v, o) => {
    v = Math.min(1, Math.max(0, v));
    let y: number, r: number, t: number, pad = 0;
    if (v < va) { const q = (v / va) * (Math.PI / 2); y = -r0 * Math.cos(q); r = r0 * Math.sin(q); t = 0; }
    else if (v < vb) {
      t = (v - va) / (vb - va);
      y = len * t; r = (r0 + (r1 - r0) * t) * (1 - 0.055 * Math.sin(Math.PI * t)); pad = Math.sin(Math.PI * t);
    } else { const q = ((v - vb) / (1 - vb)) * (Math.PI / 2); y = len + tipLen * Math.sin(q); r = r1 * Math.cos(q); t = 1; }
    r = Math.max(r, 2.5e-4);
    const su = Math.sin(u);
    let z = r * 0.95 * su;
    if (su < 0) z *= 1 + 0.11 * pad;
    if (tip) {
      const k = v >= vb ? 1 : sstep(0.35, 1, t);
      z *= su > 0 ? 1 - 0.2 * k : 1 + 0.06 * k;
    }
    o.set(r * 1.04 * Math.cos(u), y, z);
  };
  return { fn, va, vb };
}

/** One finger segment: textile back, suede pad side, optional rubber pad on the back. */
function buildPhalanx(m: VmMats, skin: Skin, root: THREE.Object3D, into: THREE.Bone, len: number, r0: number, r1: number, tip: boolean, pad: boolean, seed: number, thumb = false) {
  const { fn, va, vb } = phalanxFn(len, r0, r1, tip);
  const nu = thumb ? 16 : 14, nv = tip ? 15 : 13;
  const s = 0.42; // seam angle below the horizontal
  const list: G[] = [
    surf(fn, -s, Math.PI + s, Math.round(nu * 0.62), 0, 1, nv, C_BACK),
    surf(fn, Math.PI + s, Math.PI * 2 - s, Math.round(nu * 0.38), 0, 1, nv, tip ? C_TRIM : C_PALM),
  ];
  // piping along both seams
  for (const sg of [-s, Math.PI + s]) {
    list.push(surf(lifted(fn, (_u, v) => 0.0002 + 0.0005 * plateau(v, va * 0.6, vb + (1 - vb) * 0.5, 0.05)), sg - 0.07, sg + 0.07, 2, va * 0.6, vb + (1 - vb) * 0.5, nv, C_TRIM));
  }
  skin.add(m.gloveVC, list, into, root, seed * 0.137);
  if (pad) {
    const u0 = Math.PI / 2 - 0.82, u1 = Math.PI / 2 + 0.82;
    const v0 = va + (vb - va) * 0.2, v1 = va + (vb - va) * 0.84;
    const pfn = lifted(fn, (u, v) => 0.00025 + 0.0013 * Math.pow(plateau(u, u0, u1, 0.3) * plateau(v, v0, v1, (v1 - v0) * 0.3), 0.7));
    skin.add(m.gloveArmor, [surf(pfn, u0, u1, 6, v0, v1, 6)], into, root, seed * 0.071);
  }
}

// ───────────────────────────────────────────── hand

export class Hand {
  readonly root = new THREE.Group();
  /** Joints [finger][segment]. */
  readonly joints: THREE.Object3D[][] = [];
  readonly thumb: THREE.Object3D[] = [];
  readonly current: HandPose = POSES.relaxed.slice();
  /** Blend target (mutable buffer — the rig writes the sampled pose into it every frame). */
  readonly target: HandPose = POSES.relaxed.slice();
  /** Additional per-frame offsets (e.g. trigger squeeze), added after blending. */
  readonly offset: HandPose = new Array(POSE_LEN).fill(0);
  blendSpeed = 26;

  private readonly skin = new Skin();
  private readonly palmBone: THREE.Bone;

  constructor(m: VmMats, readonly left: boolean) {
    const skin = this.skin;
    this.palmBone = skin.bone(this.root);
    this.buildPalm(m);
    FINGERS.forEach((f, fi) => {
      const chain: THREE.Object3D[] = [];
      let parent: THREE.Object3D = this.root;
      for (let s = 0; s < 3; s++) {
        const j = s === 0 ? skin.bone(parent, f.x, f.y, f.z) : skin.bone(parent, 0, f.len[s - 1], 0);
        buildPhalanx(m, skin, this.root, j, f.len[s], f.r[s], f.r[s + 1], s === 2, s < 2, fi * 7 + s);
        chain.push(j);
        parent = j;
      }
      this.joints.push(chain);
    });

    // Thumb: CMC near the wrist on the -X / palm side.
    let parent: THREE.Object3D = this.root;
    for (let s = 0; s < 3; s++) {
      const j = s === 0 ? skin.bone(parent, THUMB_POS.x, THUMB_POS.y, THUMB_POS.z) : skin.bone(parent, 0, THUMB_LEN[s - 1], 0);
      buildPhalanx(m, skin, this.root, j, THUMB_LEN[s], THUMB_R[s], THUMB_R[s + 1], s === 2, s < 2, 40 + s, true);
      this.thumb.push(j);
      parent = j;
    }
    this.buildWeb(m);
    skin.build(this.root);
    if (left) this.root.scale.x = -1;
    this.apply();
  }

  // ── thumb web: the skin between the thumb and the index metacarpal, re-spanned from the live thumb pose
  private webEdge!: THREE.Bone;
  private webPos!: THREE.BufferAttribute;
  private webNor!: THREE.BufferAttribute;
  private static readonly WEB_L0 = 0.05;
  private static readonly WEB_ROWS = 11;
  private static readonly WEB_SEG = 12;
  private static readonly WEB_BASE = new THREE.Vector3(-0.027, 0.03, -0.003);
  private static readonly WEB_ANCHOR = new THREE.Vector3(-0.0395, 0.071, -0.0035);

  private buildWeb(m: VmMats) {
    // free edge of the web: a tapered roll from the thumb knuckle to the side of the palm (stretched per frame)
    const L0 = Hand.WEB_L0;
    const { fn } = phalanxFn(L0, 0.0098, 0.0078, false);
    this.webEdge = this.skin.bone(this.root);
    this.skin.add(m.gloveVC, [surf(fn, 0, Math.PI * 2, 12, 0, 1, 12, C_BACK)], this.webEdge, this.root, 0.6);
    // membrane: a soft pillow lofted between the thumb metacarpal and the edge of the palm (re-spanned per frame)
    const R = Hand.WEB_ROWS, S = Hand.WEB_SEG;
    const g = new THREE.BufferGeometry();
    this.webPos = new THREE.BufferAttribute(new Float32Array(R * S * 3), 3);
    this.webNor = new THREE.BufferAttribute(new Float32Array(R * S * 3), 3);
    const col = new Float32Array(R * S * 3), uv = new Float32Array(R * S * 2);
    for (let r = 0; r < R; r++) for (let k = 0; k < S; k++) {
      const i = r * S + k;
      col[i * 3] = C_BACK[0]; col[i * 3 + 1] = C_BACK[1]; col[i * 3 + 2] = C_BACK[2];
      uv[i * 2] = (k / S) * 0.5; uv[i * 2 + 1] = r * 0.05;
    }
    const idx: number[] = [];
    for (let r = 0; r < R - 1; r++) for (let k = 0; k < S; k++) {
      const a = r * S + k, b = r * S + (k + 1) % S, c = a + S, d = b + S;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    g.setAttribute('position', this.webPos);
    g.setAttribute('normal', this.webNor);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const fill = new THREE.Mesh(g, m.gloveVC);
    fill.frustumCulled = false;
    this.root.add(fill);
  }

  private updateWeb() {
    const t0 = this.thumb[0];
    const k = _wk.set(0, THUMB_LEN[0], 0).applyQuaternion(t0.quaternion).add(t0.position); // thumb knuckle (hand space)
    const a = Hand.WEB_ANCHOR, b = t0.position;
    const e = this.webEdge;
    _wd.copy(a).sub(k);
    const len = _wd.length();
    e.position.copy(k);
    e.quaternion.setFromUnitVectors(_wy, _wd.multiplyScalar(1 / len));
    e.scale.set(1, len / Hand.WEB_L0, 1);
    // pillow rows from the thumb base (r = 0) to the free edge (r = 1): flattened rings between the two rails
    _wn.copy(k).sub(b).cross(_wd.copy(a).sub(b)).normalize();
    const P = this.webPos.array as Float32Array, N = this.webNor.array as Float32Array;
    const R = Hand.WEB_ROWS, S = Hand.WEB_SEG, c0 = Hand.WEB_BASE;
    _wd.copy(k).sub(b).normalize();
    const tx = _wd.x, ty = _wd.y, tz = _wd.z;
    for (let r = 0; r < R; r++) {
      const t = r / (R - 1);
      // rails: thumb metacarpal (b → k) and palm edge (c0 → a)
      const ax = b.x + (k.x - b.x) * t, ay = b.y + (k.y - b.y) * t, az = b.z + (k.z - b.z) * t;
      const bx = c0.x + (a.x - c0.x) * t, by = c0.y + (a.y - c0.y) * t, bz = c0.z + (a.z - c0.z) * t;
      const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
      let hx = (ax - bx) / 2, hy = (ay - by) / 2, hz = (az - bz) / 2;
      const hl = Math.max(1e-5, Math.hypot(hx, hy, hz)), half = hl + 0.004;
      hx /= hl; hy /= hl; hz /= hl;
      const th = 0.0118 - 0.0035 * t;
      for (let q = 0; q < S; q++) {
        const an = (q / S) * Math.PI * 2, cs = Math.cos(an), sn = Math.sin(an), i = (r * S + q) * 3;
        P[i] = mx + hx * half * cs + _wn.x * th * sn; P[i + 1] = my + hy * half * cs + _wn.y * th * sn; P[i + 2] = mz + hz * half * cs + _wn.z * th * sn;
        // ellipse normal
        let nx = hx * cs / half + _wn.x * sn / th, ny = hy * cs / half + _wn.y * sn / th, nz = hz * cs / half + _wn.z * sn / th;
        // bunched-fabric folds running across the web (shading only)
        const fold = 0.32 * Math.sin(t * 15 + q * 1.7) * Math.sin(Math.PI * t) / Math.hypot(nx, ny, nz);
        nx += tx * fold * Math.hypot(nx, ny, nz); ny += ty * fold * Math.hypot(nx, ny, nz); nz += tz * fold * Math.hypot(nx, ny, nz);
        const nl = 1 / Math.hypot(nx, ny, nz);
        nx *= nl; ny *= nl; nz *= nl;
        N[i] = nx; N[i + 1] = ny; N[i + 2] = nz;
      }
    }
    this.webPos.needsUpdate = true; this.webNor.needsUpdate = true;
  }

  private buildPalm(m: VmMats) {
    const TAU = Math.PI * 2;
    const s = 0.2; // suede wraps slightly up both edges
    const back: G[] = [surf(palmFn, -s, Math.PI + s, 30, 0, 1, 34, C_BACK)];
    // seam piping between textile and suede (both edges) and a stitched line across the back
    for (const sg of [-s, Math.PI + s]) {
      back.push(surf(lifted(palmFn, () => 0.0007), sg - 0.035, sg + 0.035, 2, 0.1, 0.93, 30, C_TRIM));
    }
    back.push(surf(lifted(palmFn, () => 0.0006), 0.3, Math.PI - 0.3, 22, palmV(0.0705), palmV(0.0725), 1, C_TRIM));
    back.push(surf(palmFn, Math.PI + s, TAU - s, 26, 0, 1, 34, C_PALM));
    // heel + thenar reinforcement patch (double layer)
    const hu0 = Math.PI + 0.42, hu1 = TAU - 0.42, hv0 = palmV(0.006), hv1 = palmV(0.05);
    back.push(surf(lifted(palmFn, (u, v) => 0.0002 + 0.001 * Math.pow(plateau(u, hu0, hu1, 0.18) * plateau(v, hv0, hv1, 0.05), 0.6)), hu0, hu1, 14, hv0, hv1, 10, C_PALM2));

    this.skin.add(m.gloveVC, back, this.palmBone, this.root, 0.11);

    // moulded rubber: knuckle guard with four raised caps, three ribs along the metacarpals
    const armor: G[] = [];
    const ku0 = 0.36, ku1 = Math.PI - 0.36, kv0 = palmV(0.0745), kv1 = palmV(0.1035);
    armor.push(surf(lifted(palmFn, (u, v, p) => {
      let caps = 0;
      for (const f of FINGERS) caps += gauss(p.x - f.x, 0.0068) * gauss(p.y - (f.y - 0.0035), 0.0075);
      return 0.0003 + (0.0011 + 0.0021 * Math.min(1, caps)) * Math.pow(plateau(u, ku0, ku1, 0.16) * plateau(v, kv0, kv1, 0.05), 0.6);
    }), ku0, ku1, 34, kv0, kv1, 12));
    const ru0 = 0.5, ru1 = Math.PI - 0.5, rv0 = palmV(0.03), rv1 = palmV(0.068);
    armor.push(surf(lifted(palmFn, (u, v, p) => {
      let ribs = 0;
      for (const x of [-0.021, -0.002, 0.017]) ribs = Math.max(ribs, plateau(p.x, x - 0.0062, x + 0.0062, 0.003));
      return 0.0002 + 0.0017 * ribs * plateau(v, rv0, rv1, 0.06) * plateau(u, ru0, ru1, 0.1);
    }), ru0, ru1, 40, rv0, rv1, 10));
    this.skin.add(m.gloveArmor, armor, this.palmBone, this.root, 0.4);

    // velcro wrist strap across the back with a pull tab, and the cuff ball that seats in the sleeve
    const strap: G[] = [];
    const su0 = -0.05, su1 = Math.PI + 0.05, sv0 = palmV(0.007), sv1 = palmV(0.0245);
    strap.push(surf(lifted(palmFn, (u, v) => 0.0003 + 0.0015 * Math.pow(plateau(u, su0, su1, 0.1) * plateau(v, sv0, sv1, 0.025), 0.5)), su0, su1, 24, sv0, sv1, 6));
    strap.push(tinted(rboxG(0.017, 0.0135, 0.0032, 0.0012, M(0.0215, 0.0158, 0.0162, 0.03, 0.32, 0)), C_ONE));
    this.skin.add(m.gloveStrap, strap, this.palmBone, this.root, 0.5);
  }

  /** Copy a pose into the blend target. `instant` also snaps the current pose. */
  setPose(p: HandPose, instant = false) {
    for (let i = 0; i < POSE_LEN; i++) this.target[i] = p[i];
    if (instant) for (let i = 0; i < POSE_LEN; i++) this.current[i] = p[i];
  }

  update(dt: number) {
    const k = 1 - Math.exp(-this.blendSpeed * dt);
    for (let i = 0; i < POSE_LEN; i++) this.current[i] += (this.target[i] - this.current[i]) * k;
    this.apply();
  }

  /** Write joint rotations from a pose (defaults to the blended current pose + offsets). */
  apply(c: HandPose = this.current, o: HandPose | null = this.offset, web = true) {
    for (let f = 0; f < 4; f++) {
      const b = f * 4;
      const ch = this.joints[f];
      ch[0].rotation.set(-(c[b + 1] + (o ? o[b + 1] : 0)), 0, c[b] + (o ? o[b] : 0), 'ZXY');
      ch[1].rotation.set(-(c[b + 2] + (o ? o[b + 2] : 0)), 0, 0);
      ch[2].rotation.set(-(c[b + 3] + (o ? o[b + 3] : 0)), 0, 0);
    }
    // Thumb rest orientation: points up/out toward -X, slightly palmward.
    const t = THUMB;
    const ov = (i: number) => (o ? o[t + i] : 0);
    this.thumb[0].rotation.set(-0.35 - (c[t + 1] + ov(1)), -0.25 + c[t] + ov(0), 0.72 + c[t + 2] + ov(2), 'YZX');
    this.thumb[1].rotation.set(-(c[t + 3] + ov(3)), 0, 0);
    this.thumb[2].rotation.set(-(c[t + 4] + ov(4)), 0, 0);
    if (web) this.updateWeb();
  }

  // ── load-time kinematics (used by the grip solver; these update world matrices)

  /** Point on the axis of finger `f` segment `s` at fraction `t` of its length (world space). */
  fingerPoint(f: number, s: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    return this.joints[f][s].localToWorld(out.set(0, FINGERS[f].len[s] * t, 0));
  }
  fingerRadius(f: number, s: number, t: number): number {
    const r = FINGERS[f].r;
    return r[s] + (r[s + 1] - r[s]) * t;
  }
  thumbPoint(s: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    return this.thumb[s].localToWorld(out.set(0, THUMB_LEN[s] * t, 0));
  }
  thumbRadius(s: number, t: number): number { return THUMB_R[s] + (THUMB_R[s + 1] - THUMB_R[s]) * t; }
}

function rboxG(w: number, h: number, d: number, r: number, m?: THREE.Matrix4): G {
  let g: G = rbox(w, h, d, r);
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (m) g.applyMatrix4(m);
  return g;
}

/**
 * Sleeved forearm. Origin at the wrist, geometry runs along -Y toward the elbow.
 * Oriented every frame so it points from the wrist to an elbow target.
 */
export class Forearm {
  readonly root = new THREE.Group();
  /** LED bar (drawRange driven) — only on the device arm. */
  ledMesh: THREE.Mesh | null = null;
  ledSegVerts = 0;
  private ledCount = 6;
  private readonly bx = new THREE.Vector3();
  private readonly by = new THREE.Vector3();
  private readonly bz = new THREE.Vector3();
  private readonly mtx = new THREE.Matrix4();

  constructor(m: VmMats, withDevice: boolean, deviceAngle = 0) {
    const p = Object.assign(new Parts(), { uvScale: 3 });
    const L = 0.46;
    const st: Station[] = [];
    const rand = rng(withDevice ? 11 : 23);
    const N = 30;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      // jacket sleeve: snug behind the cuff, fuller toward the elbow
      const w = 0.0362 + Math.pow(t, 0.8) * 0.021 + (t < 0.1 ? 0.0035 * (1 - t / 0.1) : 0);
      const h = 0.0318 + Math.pow(t, 0.8) * 0.019 + (t < 0.1 ? 0.0035 * (1 - t / 0.1) : 0);
      st.push({ z: -0.07 - t * L, w, h, n: 2.12 });
    }
    st.reverse();
    const sl = sweep(st, 40, false, false);
    sl.rotateX(-Math.PI / 2); // along -Y now; station y → -z
    // Fabric folds: compression rings bunching toward the wrist, long diagonal drapes further up.
    const ph = rand() * 10;
    deform(sl, (v) => {
      const a = Math.atan2(v.z, v.x);
      const d = -v.y - 0.07;
      const ring = Math.sin(d * 150 + Math.sin(a * 2 + ph) * 2.2 + Math.sin(a * 5 + ph * 2) * 0.6);
      const fold = (ring * 0.5 + 0.5) * (ring * 0.5 + 0.5) * Math.exp(-d * 9) * 0.0034
        + Math.sin(a * 3 + d * 24 + ph) * 0.0011 * Math.min(1, d * 12)
        + Math.sin(a * 2 - d * 11 + 1.3) * 0.0014 * Math.min(1, d * 8)
        + Math.sin(a * 7 + d * 60 + ph) * 0.0003;
      const r = Math.hypot(v.x, v.z);
      const s = (r + fold) / Math.max(r, 1e-4);
      v.x *= s; v.z *= s;
    });
    sl.computeVertexNormals();
    p.add(sl, m.sleeve);
    // Glove gauntlet over the wrist (bends with the forearm) with an elastic gather
    const gl = sweep([
      { z: -0.088, w: 0.0352, h: 0.0302, n: 2.2 }, { z: -0.08, w: 0.0372, h: 0.0318, n: 2.2 },
      { z: -0.055, w: 0.0348, h: 0.029, n: 2.25 }, { z: -0.034, w: 0.0322, h: 0.0258, n: 2.3 }, { z: -0.027, w: 0.031, h: 0.0244, n: 2.3 },
      { z: -0.02, w: 0.0316, h: 0.0246, n: 2.35 }, { z: -0.006, w: 0.0304, h: 0.0222, n: 2.45 },
      { z: 0.002, w: 0.0282, h: 0.0196, n: 2.45 }, { z: 0.007, w: 0.022, h: 0.015, n: 2.3 }, { z: 0.009, w: 0.01, h: 0.007, n: 2.2 },
    ], 30, false, false);
    gl.rotateX(-Math.PI / 2);
    p.add(gl, m.glove);
    // cuff binding
    const bind = sweep([
      { z: -0.0905, w: 0.0358, h: 0.0306, n: 2.2 }, { z: -0.089, w: 0.0382, h: 0.0328, n: 2.2 },
      { z: -0.081, w: 0.0384, h: 0.033, n: 2.2 }, { z: -0.0795, w: 0.0372, h: 0.0318, n: 2.2 },
    ], 30, false, false);
    bind.rotateX(-Math.PI / 2);
    p.add(bind, m.gloveStrap);

    // Sleeve hem: rolled cuff band with a stitched edge
    const hem = sweep([
      { z: -0.086, w: 0.0412, h: 0.0366, n: 2.12 }, { z: -0.082, w: 0.0428, h: 0.0382, n: 2.12 },
      { z: -0.07, w: 0.0424, h: 0.0378, n: 2.12 }, { z: -0.0655, w: 0.0398, h: 0.035, n: 2.12 },
    ], 36, false, false);
    hem.rotateX(-Math.PI / 2);
    p.add(hem, m.sleeve);
    p.build(this.root);

    if (withDevice) {
      // Wrist unit: rugged housing on two rubber straps, angled screen + LED bar + buttons.
      const dev = new THREE.Group();
      dev.rotation.y = deviceAngle;
      this.root.add(dev);
      const d = Object.assign(new Parts(), { uvScale: 3 });
      const yC = -0.135;
      for (const y of [yC + 0.022, yC - 0.022]) {
        const s = sweep([
          { z: y - 0.008, w: 0.0446, h: 0.0398, n: 2.2 }, { z: y - 0.007, w: 0.0458, h: 0.041, n: 2.2 },
          { z: y + 0.007, w: 0.0458, h: 0.041, n: 2.2 }, { z: y + 0.008, w: 0.0446, h: 0.0398, n: 2.2 },
        ], 30, false, false);
        s.rotateX(-Math.PI / 2); // station z → y
        d.add(s, m.rubber);
      }
      const zTop = 0.0455;
      d.add(rbox(0.05, 0.064, 0.016, 0.004, 3), m.polymer, M(0, yC, zTop));
      d.add(rbox(0.054, 0.012, 0.012, 0.003), m.gloveArmor, M(0, yC + 0.034, zTop - 0.002));
      d.add(rbox(0.054, 0.012, 0.012, 0.003), m.gloveArmor, M(0, yC - 0.034, zTop - 0.002));
      // bezel + screen
      d.add(rbox(0.038, 0.034, 0.003, 0.0012), m.gunmetal, M(0, yC + 0.006, zTop + 0.0085));
      d.add(rbox(0.033, 0.029, 0.0012), m.interior, M(0, yC + 0.006, zTop + 0.0103));
      // side buttons and screws
      for (const s of [-1, 1]) {
        d.add(rbox(0.004, 0.009, 0.006, 0.0015), m.steel, M(s * 0.026, yC + 0.012, zTop + 0.002));
        for (const yy of [yC + 0.025, yC - 0.025]) d.add(sphere(0.0016, 8, 6), m.steel, M(s * 0.021, yy, zTop + 0.0085, 0, 0, 0, 1, 1, 0.5));
      }
      d.add(rbox(0.012, 0.005, 0.003, 0.0012), m.rubber, M(-0.009, yC - 0.02, zTop + 0.0085));
      d.add(rbox(0.012, 0.005, 0.003, 0.0012), m.rubber, M(0.009, yC - 0.02, zTop + 0.0085));
      // small amber status pip
      d.add(sphere(0.0013, 8, 6), m.emAmber, M(0.016, yC + 0.02, zTop + 0.0105));
      d.build(dev);
      // LED segments (health bar) — drawRange controls how many are lit.
      const segs: G[] = [];
      for (let i = 0; i < this.ledCount; i++) {
        const g = new THREE.BoxGeometry(0.0038, 0.0145, 0.0006).toNonIndexed();
        g.translate(-0.0125 + i * 0.005, yC + 0.009, zTop + 0.0112);
        segs.push(g);
      }
      const led = Object.assign(new Parts(), { uvScale: 3 });
      segs.forEach((g) => led.add(g, m.wristLed));
      led.build(dev);
      this.ledMesh = dev.children[dev.children.length - 1] as THREE.Mesh;
      this.ledSegVerts = 36;
      // tiny readout line under the bar
      const line = Object.assign(new Parts(), { uvScale: 3 }).add(new THREE.BoxGeometry(0.026, 0.0016, 0.0006), m.emCyan, M(0, yC - 0.006, zTop + 0.0112));
      line.build(dev);
    }
  }

  /** Lit LED count = ceil(fraction * segments). */
  setLevel(frac: number) {
    if (!this.ledMesh) return;
    const n = Math.max(0, Math.min(this.ledCount, Math.ceil(frac * this.ledCount - 1e-3)));
    this.ledMesh.geometry.setDrawRange(0, n * this.ledSegVerts);
  }

  /**
   * Place at `wrist` (parent space) pointing toward `elbow`, twisted so the forearm's +Z follows `dorsal`.
   */
  orient(wrist: THREE.Vector3, elbow: THREE.Vector3, dorsal: THREE.Vector3) {
    this.by.copy(wrist).sub(elbow).normalize();
    this.bz.copy(dorsal).addScaledVector(this.by, -dorsal.dot(this.by)).normalize();
    this.bx.crossVectors(this.by, this.bz);
    this.mtx.makeBasis(this.bx, this.by, this.bz);
    this.root.quaternion.setFromRotationMatrix(this.mtx);
    this.root.position.copy(wrist);
  }
}
