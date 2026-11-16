/**
 * TOMAS — the one living person (REVISION 4). 22, slight, ~1.75 m. Grey-blue coverall worn with the top half pulled
 * down and the sleeves knotted round the waist, charcoal T-shirt, lanyard + badge, a headset with a mic boom.
 * Smoothly skinned (unlike the machines): every body piece carries blended weights along its bone chain.
 * The face is built to read at 2–10 m through glass: deep-set eyes with whites + iris, dark brows, eyelids that blink,
 * a mouth slit with lips that open on a jaw bone, a nose that throws a shadow, hair framing it all.
 *
 * Model space: feet on y = 0, facing +Z, his LEFT is +X. Bind pose: standing straight, arms hanging, palms in.
 */
import * as THREE from 'three';
import type { GameContext, MaterialName } from '../../core/types';
import { buildRigLods, glowMaterial, tintOf, type RigBuilder, type RigTemplate } from '../shared/rig';
import { DETAIL, keyLerp, patch, spow, type V3 } from '../shared/prims';
import { coverallMaterial } from '../husk/worker';

export const HUMAN_DIM = {
  hipsY: 0.95,
  hipX: 0.088, hipY: 0.9,
  thigh: 0.42, shin: 0.405, ankle: 0.075,
  shoulderX: 0.172, shoulderY: 1.425, shoulderZ: -0.02,
  uarm: 0.285, larm: 0.245, hand: 0.17,
  /** Head centre (ellipsoid), radii. */
  headC: new THREE.Vector3(0, 1.645, 0.004), headR: new THREE.Vector3(0.074, 0.106, 0.096),
  eyeY: 1.641, eyeX: 0.0315, eyeR: 0.0118,
  mouthY: 1.583,
};
const K = HUMAN_DIM;

export interface HumanTemplate {
  rig: RigTemplate;
  /** REVISION 5: the scanned head (level 2), or null = procedural face. Set by createEnemies after loading. */
  scan?: import('./head').ScanHead | null;
  /** Eye centres in model space (bind), for look-at maths. */
  eyeL: THREE.Vector3; eyeR: THREE.Vector3;
  /** §8.8: which person this template builds (absent = Tomas). */
  who?: 'tomas' | 'halvorsen';
  /** §8.8: uniform scale of the rig (absent = 1). */
  scale?: number;
  /** §8.8: Halvorsen's GLB head (head2.ts), or null = his procedural fallback head. */
  head2?: import('./head2').Head2 | null;
}

const D = Math.PI / 180;

export function vnoise(x: number, y: number): number {
  const h = (i: number, j: number) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
export const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function libOr(ctx: GameContext, name: MaterialName, fb: MaterialName, over: Partial<THREE.MeshStandardMaterialParameters>, fbOver: Partial<THREE.MeshStandardMaterialParameters>): THREE.MeshStandardMaterial {
  const m = ctx.materials.get(name);
  if (m.name === name) return ctx.materials.clone(name, over);
  return ctx.materials.clone(fb, { ...over, ...fbOver });
}

export function buildHumanTemplate(ctx: GameContext): HumanTemplate {
  const M = ctx.materials;
  const skin = libOr(ctx, 'skin', 'plastic_white', { vertexColors: true }, { color: 0xc79a7f, roughness: 0.62, metalness: 0, map: null, normalMap: null, roughnessMap: null, metalnessMap: null, aoMap: null });
  skin.name = 'tomas_skin';
  const cover = coverallMaterial(ctx).clone(); cover.vertexColors = true; cover.name = 'tomas_coverall';
  const shirt = M.clone('fabric', { color: 0x34383d, vertexColors: true }); shirt.name = 'tomas_shirt';
  const hair = M.clone('rubber', { color: 0x3a2a1e, roughness: 0.72, vertexColors: true }); hair.name = 'tomas_hair';
  const eye = M.clone('plastic_white', { color: 0xe9e4dc, roughness: 0.22, metalness: 0, vertexColors: true, map: null, normalMap: null, roughnessMap: null, metalnessMap: null, aoMap: null }); eye.name = 'tomas_eye';
  const dark = M.get('plastic_dark');
  const boot = M.clone('rubber', { color: 0x2a2420 }); boot.name = 'tomas_boot';
  const badge = M.clone('plastic_white', { vertexColors: true }); badge.name = 'tomas_badge';
  const mats: Record<string, THREE.Material> = { glow: glowMaterial(), skin, face: skin, cover, shirt, hair, eye, dark, boot, badge, green: M.get('emissive_green') };
  const { template, data } = buildRigLods(authorHuman, mats, {
    radius: 1.5, center: new THREE.Vector3(0, 0.9, 0),
    fold: { green: 'glow' }, tint: { green: tintOf(0x40ff70, 1.6) },
    lod: { k: 0.5, minFeature: 0.006, remap: { badge: 'shirt', boot: 'dark' } },
    proxy: { k: 0.3, minFeature: 0.02, exclude: ['eye', 'green', 'badge'] },
    colorize: { skin: skinTone, face: skinTone, cover: clothShade, shirt: clothShade, hair: hairTone, eye: eyeTone, badge: badgeTone },
  });
  return { rig: template, eyeL: data.eyeL, eyeR: data.eyeR };
}

// ───────────────────────────────────────────────────────────── geometry helpers

export type Ring = { c: THREE.Vector3; rx: number; rz: number; n?: number };

/**
 * Closed tube through rings (each ring perpendicular to the local path tangent; `front` fixes the ring's
 * a = 0 direction). Smooth normals; optional end caps. Returns non-indexed geometry.
 */
export function loft(rings: Ring[], radial: number, opts: { sub?: number; capA?: boolean; capB?: boolean; front?: THREE.Vector3; n?: number } = {}): THREE.BufferGeometry {
  const nr = Math.max(5, Math.round(radial * DETAIL.k));
  const sub = Math.max(1, Math.round((opts.sub ?? 3) * Math.min(1, DETAIL.k + 0.2)));
  const front = opts.front ?? new THREE.Vector3(0, 0, 1);
  // sample centreline smoothly (Catmull-Rom) and radii (smoothstep keys)
  const curve = new THREE.CatmullRomCurve3(rings.map((r) => r.c.clone()), false, 'centripetal');
  const nS = (rings.length - 1) * sub + 1;
  const keysRx: [number, number][] = rings.map((r, i) => [i / (rings.length - 1), r.rx]);
  const keysRz: [number, number][] = rings.map((r, i) => [i / (rings.length - 1), r.rz]);
  const keysN: [number, number][] = rings.map((r, i) => [i / (rings.length - 1), r.n ?? opts.n ?? 2]);
  const pos: number[] = [];
  const T = new THREE.Vector3(), Ax = new THREE.Vector3(), Az = new THREE.Vector3(), C = new THREE.Vector3();
  for (let i = 0; i < nS; i++) {
    const t = i / (nS - 1);
    curve.getPoint(t, C);
    curve.getTangent(t, T);
    Ax.copy(front).cross(T);
    if (Ax.lengthSq() < 1e-8) Ax.set(1, 0, 0);
    Ax.normalize();
    Az.copy(T).cross(Ax).normalize();
    // keep "front" pointing forward for upward paths too
    if (Az.dot(front) < 0) { Az.negate(); Ax.negate(); }
    const rx = keyLerp(keysRx, t), rz = keyLerp(keysRz, t), e = 2 / keyLerp(keysN, t);
    for (let k = 0; k < nr; k++) {
      const a = (k / nr) * Math.PI * 2;
      const sx = spow(Math.sin(a), e) * rx, sz = spow(Math.cos(a), e) * rz;
      pos.push(C.x + Ax.x * sx + Az.x * sz, C.y + Ax.y * sx + Az.y * sz, C.z + Ax.z * sx + Az.z * sz);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nS - 1; i++) for (let k = 0; k < nr; k++) {
    const a = i * nr + k, b = i * nr + ((k + 1) % nr), c = (i + 1) * nr + ((k + 1) % nr), d = (i + 1) * nr + k;
    idx.push(a, b, c, a, c, d);
  }
  // sides: make the first quad's normal point away from the centreline
  {
    const p0 = new THREE.Vector3().fromArray(pos, 0), p1 = new THREE.Vector3().fromArray(pos, 3), p2 = new THREE.Vector3().fromArray(pos, (nr + 1) * 3);
    const nrm = p1.clone().sub(p0).cross(p2.clone().sub(p0));
    curve.getPoint(0, C);
    if (nrm.dot(p0.clone().sub(C)) < 0) for (let i = 0; i < idx.length; i += 3) { const tt = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tt; }
  }
  const addCap = (ring: number, end: boolean) => {
    curve.getPoint(end ? 1 : 0, C);
    curve.getTangent(end ? 1 : 0, T);
    if (!end) T.negate();
    const ci = pos.length / 3;
    pos.push(C.x, C.y, C.z);
    const pa = new THREE.Vector3().fromArray(pos, ring * nr * 3), pb = new THREE.Vector3().fromArray(pos, (ring * nr + 1) * 3);
    const flip = pa.clone().sub(C).cross(pb.clone().sub(C)).dot(T) < 0;
    for (let k = 0; k < nr; k++) {
      const a = ring * nr + k, b = ring * nr + ((k + 1) % nr);
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  };
  if (opts.capA !== false) addCap(0, false);
  if (opts.capB !== false) addCap(nS - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const out = g.toNonIndexed();
  g.dispose();
  out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
  return out;
}
export const R = (x: number, y: number, z: number, rx: number, rz: number, n?: number): Ring => ({ c: new THREE.Vector3(x, y, z), rx, rz, n });

/** Ellipsoid (smooth), non-indexed. */
export function ellip(c: V3, r: V3, ws = 14, hs = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, Math.max(6, Math.round(ws * DETAIL.k)), Math.max(4, Math.round(hs * DETAIL.k)));
  g.scale(r[0], r[1], r[2]); g.translate(c[0], c[1], c[2]);
  const o = g.toNonIndexed(); g.dispose();
  return o;
}

/** Weights along a bone chain: joints[i] starts bone bones[i]; the last joint ends the chain. */
export function chain(bones: string[], joints: V3[], radii: number[]): (p: THREE.Vector3) => [string, number][] {
  const J = joints.map((j) => new THREE.Vector3(...j));
  const S: number[] = [0];
  for (let i = 1; i < J.length; i++) S.push(S[i - 1] + J[i].distanceTo(J[i - 1]));
  const ab = new THREE.Vector3(), ap = new THREE.Vector3();
  return (p) => {
    let best = Infinity, bs = 0;
    for (let i = 0; i < J.length - 1; i++) {
      ab.copy(J[i + 1]).sub(J[i]); ap.copy(p).sub(J[i]);
      const l2 = ab.lengthSq();
      let t = l2 > 0 ? ap.dot(ab) / l2 : 0;
      // allow running past the ends
      if (i > 0) t = Math.max(0, t);
      if (i < J.length - 2) t = Math.min(1, t);
      const q = ab.multiplyScalar(t).add(J[i]);
      const d = q.distanceToSquared(p);
      if (d < best) { best = d; bs = S[i] + t * Math.sqrt(l2); }
    }
    // find segment by arc length and blend around joints
    let k = 0;
    while (k < bones.length - 1 && bs >= S[k + 1]) k++;
    const out: [string, number][] = [];
    let w = 1;
    if (k > 0) {
      const r = radii[k] ?? 0.04, f = sm(-r, r, bs - S[k]);
      if (f < 1) { out.push([bones[k - 1], 1 - f]); w = f; }
    }
    if (k < bones.length - 1) {
      const r = radii[k + 1] ?? 0.04, f = sm(-r, r, bs - S[k + 1]);
      if (f > 0) { out.push([bones[k + 1], f * w]); w *= 1 - f; }
    }
    out.push([bones[k], w]);
    return out;
  };
}
export const rigid = (bone: string) => (): [string, number][] => [[bone, 1]];

/** Head-surface direction for (a = around, 0 front / +π/2 left; e = elevation). */
export function hdir(a: number, e: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
}

/** Eye / brow / mouth anchors on the head ellipsoid. */
export const EYE_A = 0.335, EYE_E = (K.eyeY - K.headC.y) / K.headR.y;
export const MOUTH_E = Math.asin((K.mouthY - K.headC.y) / K.headR.y);

/** The skull + face surface: ellipsoid with the face shaped in (sockets, brow, cheekbones, jaw, chin, lips). */
export function headPoint(a: number, e: number, out: THREE.Vector3): THREE.Vector3 {
  const d = hdir(a, e, out);
  let rx = K.headR.x, ry = K.headR.y, rz = K.headR.z;
  const front = Math.max(0, d.z), lower = Math.max(0, -d.y), back = Math.max(0, -d.z);
  // jaw narrows toward the chin; the back of the skull tucks into the neck
  rx *= 1 - 0.22 * sm(0.1, 0.95, lower) * (0.6 + 0.4 * front);
  rz *= 1 - 0.18 * sm(0.3, 1, lower) * back;
  ry *= 1 - 0.1 * sm(0.4, 1, lower) * back;
  // flatter face plane, fuller cranium at the back
  rz *= 1 - 0.035 * sm(0.5, 1, front) + 0.03 * sm(0.2, 1, back) * sm(-0.2, 0.5, d.y);
  let x = d.x * rx, y = d.y * ry, z = d.z * rz;
  const g = (da: number, de: number, wa: number, we: number) => Math.exp(-(da * da) / (wa * wa) - (de * de) / (we * we));
  let push = 0;
  for (const s of [-1, 1]) {
    push -= 0.0085 * g(a - s * EYE_A, e - EYE_E, 0.2, 0.14);              // eye sockets
    push += 0.0055 * g(a - s * 0.31, e - (EYE_E + 0.2), 0.24, 0.06);     // brow ridge
    push += 0.004 * g(a - s * 0.78, e - (EYE_E - 0.17), 0.22, 0.14);     // cheekbones
    push -= 0.003 * g(a - s * 0.6, e - (MOUTH_E + 0.05), 0.2, 0.2);      // under the cheekbones
  }
  push += 0.0035 * g(a, e - (MOUTH_E - 0.36), 0.28, 0.16);                // chin
  push += 0.0042 * g(a, e - MOUTH_E, 0.26, 0.09);                         // lips (muzzle)
  push -= 0.0018 * g(a, e - (MOUTH_E - 0.15), 0.2, 0.05);                 // groove under the lower lip
  push += 0.0028 * g(a, e - (EYE_E + 0.34), 0.5, 0.25);                   // forehead
  const n = out.set(x, y, z);
  const l = Math.hypot(x / rx, y / ry, z / rz) || 1;
  void l;
  n.set(x, y, z).normalize();
  x += n.x * push; y += n.y * push; z += n.z * push;
  return out.set(K.headC.x + x, K.headC.y + y, K.headC.z + z);
}

// around / elevation remaps: denser samples over the face
export const remapA = (u: number) => { const x = 2 * u - 1; return Math.PI * x * (0.34 + 0.66 * x * x); };
export const remapE = (v: number) => { const x = 2 * v - 1; return -0.2 + x * (0.55 + 0.96 * x * x) + 0.26 * x * x; };

function authorHuman(b: RigBuilder): { eyeL: THREE.Vector3; eyeR: THREE.Vector3 } {
  // ── skeleton ─────────────────────────────────────────────────────────
  b.bone('hips', null, 0, K.hipsY, 0);
  b.bone('spine1', 'hips', 0, 1.06, -0.005);
  b.bone('spine2', 'spine1', 0, 1.22, -0.01);
  b.bone('neck', 'spine2', 0, 1.47, -0.02);
  b.bone('head', 'neck', 0, 1.556, -0.006);
  b.bone('jaw', 'head', 0, 1.608, 0.004);
  const eyeC = (s: number) => {
    const p = headPoint(s * EYE_A, EYE_E, new THREE.Vector3());
    const n = hdir(s * EYE_A, EYE_E, new THREE.Vector3());
    return p.addScaledVector(n, -0.0062);
  };
  const eL = eyeC(1), eR = eyeC(-1);
  for (const [sfx, s, e] of [['l', 1, eL], ['r', -1, eR]] as const) {
    b.bone('eye_' + sfx, 'head', e.x, e.y, e.z);
    b.bone('lid_' + sfx, 'head', e.x, e.y, e.z);
    b.bone('brow_' + sfx, 'head', 0.03 * s, 1.664, 0.087);
    b.bone('clav_' + sfx, 'spine2', 0.03 * s, 1.43, -0.02);
    b.bone('uarm_' + sfx, 'clav_' + sfx, K.shoulderX * s, K.shoulderY, K.shoulderZ);
    b.bone('larm_' + sfx, 'uarm_' + sfx, K.shoulderX * s, K.shoulderY - K.uarm, K.shoulderZ);
    const wy = K.shoulderY - K.uarm - K.larm;
    b.bone('hand_' + sfx, 'larm_' + sfx, K.shoulderX * s, wy, K.shoulderZ);
    b.bone('fing_' + sfx, 'hand_' + sfx, K.shoulderX * s, wy - 0.088, K.shoulderZ + 0.004);
    b.bone('fing2_' + sfx, 'fing_' + sfx, K.shoulderX * s, wy - 0.128, K.shoulderZ + 0.004);
    b.bone('thumb_' + sfx, 'hand_' + sfx, (K.shoulderX - 0.008) * s, wy - 0.022, K.shoulderZ + 0.026);
    b.bone('thigh_' + sfx, 'hips', K.hipX * s, K.hipY, 0);
    b.bone('shin_' + sfx, 'thigh_' + sfx, K.hipX * s, K.hipY - K.thigh, 0.004);
    b.bone('foot_' + sfx, 'shin_' + sfx, K.hipX * s, K.ankle, -0.004);
    b.bone('sleeve_' + sfx, 'hips', 0.035 + 0.03 * s, 0.985, 0.122);
  }
  b.bone('badge', 'spine2', 0, 1.385, 0.12);
  b.bone('marker', 'hand_r', -K.shoulderX, K.shoulderY - K.uarm - K.larm - 0.06, K.shoulderZ);

  // ── head ─────────────────────────────────────────────────────────────
  const headW = (p: THREE.Vector3): [string, number][] => {
    // lower lip, chin and jaw flesh follow the jaw; corners half; neck root blends into the neck
    const dx = Math.abs(p.x), below = K.mouthY - p.y;
    let wj = 0;
    if (p.z > -0.01 && below > -0.0006) {
      const lat = 1 - sm(0.028, 0.068, dx);
      const deep = 1 - sm(0.02, 0.07, -p.z + 0.06);
      wj = (below > 0.0006 ? 1 : 0.5) * lat * (0.55 + 0.45 * deep) * (1 - sm(0.05, 0.075, below) * 0.4);
      if (dx > 0.02) wj *= 1 - sm(0.0, 0.012, -below + 0.004) * 0.3;
    }
    const wn = sm(1.575, 1.54, p.y) * sm(0.03, -0.03, p.z) * 0.6;
    return [['jaw', wj * (1 - wn)], ['neck', wn], ['head', Math.max(0, 1 - wj - wn)]];
  };
  // REVISION 5: the face surface, nose and ears get their own key ('face') so a scanned head can replace them
  b.use('head').mat('face');
  {
    const NU = 72, NV = 60;
    const jm = Math.round(((MOUTH_E / (Math.PI / 2)) * 0.5 + 0.5) * NV); // not exact under the remap — find below
    void jm;
    // mouth row: the v whose remapped elevation is closest to MOUTH_E
    let mv = 0, md = 1e9;
    for (let j = 0; j <= NV; j++) { const d = Math.abs(remapE(j / NV) - MOUTH_E); if (d < md) { md = d; mv = j; } }
    const MW = 0.235; // mouth half-width (around angle)
    const eyeHole = (a: number, e: number, s: number) => {
      const da = (a - s * EYE_A) / 0.165, de = (e - EYE_E - 0.012 * Math.cos(da * 1.4)) / (0.075 + 0.02 * (1 - Math.abs(da)));
      // almond: pointed at the corners, inner corner a touch lower
      return da * da + de * de * (1 + 0.6 * da * da) < 1;
    };
    const mask = (u: number, v: number) => {
      const a = remapA(u), e = remapE(v);
      if (eyeHole(a, e, 1) || eyeHole(a, e, -1)) return false;
      const j = Math.round(v * NV);
      if (j === mv && Math.abs(a) < MW) return false;
      return true;
    };
    const geo = patch((u, v, out) => {
      const a = remapA(u);
      let e = remapE(v);
      const j = Math.round(v * NV);
      if (Math.abs(a) < MW + 0.06 && Math.abs(j - mv) === 1) {
        // lips close over the slit (closed mouth reads as a line, ~2 mm)
        const k = (1 - sm(MW - 0.06, MW + 0.06, Math.abs(a))) * 0.72;
        e += (remapE(mv / NV) - e) * k;
      }
      return headPoint(a, Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, e)), out);
    }, { nu: NU, nv: NV, thickness: 0.004, mask });
    b.addSkinned(geo, headW);
  }
  // nose: bridge → tip → base with nostril wings
  {
    const top = headPoint(0, EYE_E + 0.02, new THREE.Vector3());
    const n = (y: number, z: number, rx: number, rz: number): Ring => R(0, y, z, rx, rz, 2.2);
    const zf = top.z;
    b.addSkinned(loft([n(1.648, zf - 0.007, 0.0055, 0.004), n(1.636, zf - 0.002, 0.006, 0.005), n(1.622, zf + 0.005, 0.0072, 0.0068),
      n(1.61, zf + 0.011, 0.0092, 0.009), n(1.604, zf + 0.012, 0.009, 0.008), n(1.6, zf + 0.004, 0.007, 0.005)], 12, { sub: 3, front: new THREE.Vector3(0, 0, 1) }), rigid('head'));
    for (const s of [-1, 1]) b.addSkinned(ellip([s * 0.0095, 1.602, zf - 0.001], [0.0062, 0.005, 0.0075], 10, 7), rigid('head'));
  }
  // ears
  for (const s of [-1, 1]) {
    const geo = patch((u, v, out) => {
      const a = (-0.5 + u) * Math.PI * 1.9, r = 1 - v * 0.55;
      out.set(Math.cos(a) * 0.012 * r * 0.6 - v * 0.004, Math.sin(a) * 0.029 * r, -Math.cos(a) * 0.016 * r - 0.004);
    }, { nu: 12, nv: 3, thickness: 0.004, flip: s < 0 });
    const m = new THREE.Matrix4().compose(new THREE.Vector3(s * 0.073, 1.637, -0.006), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s * -12 * D, s * 6 * D)), new THREE.Vector3(s, 1, 1));
    b.addSkinned(geo, rigid('head'), m);
  }
  // mouth interior + teeth
  b.mat('dark');
  b.addSkinned(ellip([0, K.mouthY - 0.002, 0.058], [0.022, 0.012, 0.018], 12, 8), (p) => [['jaw', p.y < K.mouthY - 0.002 ? 1 : 0], ['head', p.y < K.mouthY - 0.002 ? 0 : 1]]);
  b.mat('eye');
  b.addSkinned(ellip([0, K.mouthY + 0.0028, 0.072], [0.016, 0.0028, 0.005], 12, 5), rigid('head'));
  // eyes (whites + iris by vertex colour)
  b.addSkinned(ellip([eL.x, eL.y, eL.z], [K.eyeR, K.eyeR, K.eyeR], 18, 12), rigid('eye_l'));
  b.addSkinned(ellip([eR.x, eR.y, eR.z], [K.eyeR, K.eyeR, K.eyeR], 18, 12), rigid('eye_r'));
  // upper eyelids: skin caps hugging the eyeball (rotate down to blink)
  b.mat('skin');
  for (const [sfx, e] of [['l', eL], ['r', eR]] as const) {
    const geo = patch((u, v, out) => {
      const a = (-0.62 + 1.24 * u) * Math.PI / 2, el = (0.17 + 0.83 * v) * Math.PI / 2;
      const r = K.eyeR + 0.0016;
      out.set(e.x + Math.cos(el) * Math.sin(a) * r * 1.02, e.y + Math.sin(el) * r, e.z + Math.cos(el) * Math.cos(a) * r);
    }, { nu: 10, nv: 4, thickness: 0.0016 });
    b.addSkinned(geo, rigid('lid_' + sfx));
  }
  // brows
  b.mat('hair');
  for (const s of [-1, 1]) {
    const pts: Ring[] = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4, a = s * (0.13 + 0.42 * t), e = EYE_E + 0.165 + 0.035 * Math.sin(Math.PI * t * 0.9) - 0.01 * t;
      const p = headPoint(a, e, new THREE.Vector3()).addScaledVector(hdir(a, e, new THREE.Vector3()), 0.0012);
      pts.push({ c: p, rx: 0.0024 + 0.0012 * (1 - t), rz: 0.0042 + 0.0022 * (1 - t) - 0.002 * t, n: 2 });
    }
    b.addSkinned(loft(pts, 6, { sub: 2, front: new THREE.Vector3(0, 1, 0.3).normalize() }), rigid(s > 0 ? 'brow_l' : 'brow_r'));
  }
  // hair: messy cap over the skull; fringe falls onto the forehead; short at the nape; sideburns
  {
    const hl: [number, number][] = [[0, 0.5], [0.3, 0.52], [0.62, 0.42], [0.95, 0.28], [1.18, -0.1], [1.34, -0.08], [1.46, 0.26], [1.85, 0.24], [2.15, -0.18], [2.7, -0.42], [Math.PI, -0.5]];
    const geo = patch((u, v, out) => {
      const a = remapA(u), e = -0.62 + v * (Math.PI / 2 + 0.62 - 0.001);
      const p = headPoint(a, e, out);
      const n = hdir(a, e, new THREE.Vector3());
      const pole = 1 - sm(1.05, 1.5, e);
      const tuft = (vnoise(a * 4.5 + 3, e * 5) * 0.012 + vnoise(a * 13, e * 11 + 7) * 0.004) * pole + 0.006 * (1 - pole);
      const top = sm(-0.2, 0.9, e);
      let off = 0.007 + top * 0.016 + tuft * (0.5 + top);
      // fringe: hangs forward and down over the forehead
      const fr = Math.max(0, Math.cos(a)) ** 3 * sm(0.3, 0.75, e) * (1 - sm(1.15, 1.45, e));
      off += fr * 0.008;
      p.addScaledVector(n, off);
      p.y -= fr * 0.012 * (0.5 + vnoise(a * 9, 1.3));
      p.z += fr * 0.006;
      return p;
    }, { nu: 60, nv: 22, thickness: 0.006, mask: (u, v) => {
      const a = remapA(u), e = -0.62 + v * (Math.PI / 2 + 0.62);
      const edge = keyLerp(hl, Math.abs(a)) + (vnoise(a * 11.3, 2.2) - 0.5) * 0.2 * (0.5 + 0.5 * Math.max(0, Math.cos(a))) + (vnoise(a * 31, 5.1) - 0.5) * 0.06;
      return e > edge;
    } });
    b.addSkinned(geo, rigid('head'));
  }

  // ── neck ─────────────────────────────────────────────────────────────
  b.mat('skin');
  b.addSkinned(loft([R(0, 1.43, -0.02, 0.058, 0.054), R(0, 1.49, -0.016, 0.054, 0.051), R(0, 1.55, -0.01, 0.05, 0.05), R(0, 1.6, -0.008, 0.048, 0.047)], 16, { sub: 2 }),
    chain(['spine2', 'neck', 'head'], [[0, 1.3, -0.02], [0, 1.47, -0.02], [0, 1.556, -0.006], [0, 1.65, 0]], [0, 0.03, 0.03]));

  // ── torso: T-shirt ───────────────────────────────────────────────────
  b.mat('shirt');
  const torsoW = chain(['hips', 'spine1', 'spine2', 'neck'], [[0, 0.85, 0], [0, 1.06, -0.005], [0, 1.22, -0.01], [0, 1.47, -0.02], [0, 1.6, -0.02]], [0, 0.06, 0.07, 0.025]);
  // REVISION 5: one continuous shirt surface from the waist to the collar with a real shoulder girdle — the sides of
  // the top rings drop (trapezius slope from the neck out to the shoulder), the widest ring is the deltoid line, and
  // the shoulder flesh is partly skinned to the upper arm so raised arms pull it along (no ball joints).
  {
    // [y, rx, rz, cz, drop at the sides, superellipse n]
    const RINGS: number[][] = [
      [0.93, 0.148, 0.097, 0.0, 0, 2.5], [1.0, 0.142, 0.092, 0.0, 0, 2.5], [1.08, 0.137, 0.09, 0.006, 0, 2.4], [1.18, 0.148, 0.098, 0.012, 0, 2.4],
      [1.28, 0.16, 0.105, 0.014, 0, 2.5], [1.35, 0.17, 0.104, 0.008, 0, 2.5], [1.4, 0.178, 0.098, 0.0, 0.006, 2.4], [1.432, 0.166, 0.09, -0.006, 0.02, 2.3],
      [1.46, 0.14, 0.08, -0.012, 0.032, 2.2], [1.485, 0.098, 0.068, -0.016, 0.022, 2.2], [1.5, 0.064, 0.058, -0.016, 0.006, 2.1],
    ];
    const NU = Math.max(12, Math.round(44 * DETAIL.k)), NV = Math.max(10, Math.round(48 * Math.min(1, DETAIL.k + 0.2)));
    const key = (c: number) => RINGS.map((r) => [(r[0] - 0.93) / (1.5 - 0.93), r[c]] as [number, number]);
    const kRx = key(1), kRz = key(2), kCz = key(3), kDrop = key(4), kN = key(5);
    const posA: number[] = [];
    for (let j = 0; j <= NV; j++) {
      const v = j / NV, yv = 0.93 + v * (1.5 - 0.93);
      const rx = keyLerp(kRx, v), rz = keyLerp(kRz, v), cz = keyLerp(kCz, v), drop = keyLerp(kDrop, v), e = 2 / keyLerp(kN, v);
      for (let k = 0; k < NU; k++) {
        const a = (k / NU) * Math.PI * 2, sa = Math.sin(a), ca = Math.cos(a);
        const x = spow(sa, e) * rx, z = cz + spow(ca, e) * rz;
        posA.push(x, yv - drop * Math.pow(Math.abs(sa), 1.6), z);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < NV; j++) for (let k = 0; k < NU; k++) {
      const a = j * NU + k, b2 = j * NU + ((k + 1) % NU), c = (j + 1) * NU + ((k + 1) % NU), d = (j + 1) * NU + k;
      idx.push(a, c, b2, a, d, c);
    }
    // bottom cap
    const ci = posA.length / 3; posA.push(0, 0.93, 0);
    for (let k = 0; k < NU; k++) idx.push(ci, k, (k + 1) % NU);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const tg = g.toNonIndexed(); g.dispose();
    // outward winding check (first side quad)
    {
      const pa = tg.getAttribute('position'), na = tg.getAttribute('normal');
      const p0 = new THREE.Vector3().fromBufferAttribute(pa, 0), n0 = new THREE.Vector3().fromBufferAttribute(na, 0);
      if (n0.dot(p0.setY(0)) < 0) {
        const arr = pa.array as Float32Array;
        for (let i = 0; i < pa.count; i += 3) for (let c = 0; c < 3; c++) { const t = arr[(i + 1) * 3 + c]; arr[(i + 1) * 3 + c] = arr[(i + 2) * 3 + c]; arr[(i + 2) * 3 + c] = t; }
        tg.computeVertexNormals();
      }
    }
    tg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tg.getAttribute('position').count * 2), 2));
    b.addSkinned(tg, (p) => {
      const base = torsoW(p);
      const side = p.x >= 0 ? 'l' : 'r';
      const w = sm(0.11, 0.17, Math.abs(p.x)) * sm(1.3, 1.4, p.y) * 0.55;
      if (w <= 0) return base;
      return [...base.map(([n, ww]) => [n, ww * (1 - w)] as [string, number]), ['uarm_' + side, w]];
    });
  }
  // short sleeves: start inside the shoulder (deltoid cap), cloth over the upper arm, a turned hem
  for (const s of [-1, 1]) {
    const sfx = s > 0 ? 'l' : 'r';
    const x = K.shoulderX * s, z = K.shoulderZ;
    const sleeveW = (p: THREE.Vector3): [string, number][] => {
      // long blend: the cap of the sleeve stays with the shoulder and stretches as the arm lifts
      // the sleeve follows the arm; only its root (buried in the shoulder) is held by the chest
      const w = Math.max(sm(1.445, 1.405, p.y), sm(0.13, 0.17, Math.abs(p.x)));
      return w >= 1 ? [['uarm_' + sfx, 1]] : [['spine2', 1 - w], ['uarm_' + sfx, w]];
    };
    b.addSkinned(loft([R(x - 0.07 * s, 1.43, z, 0.018, 0.026), R(x - 0.045 * s, 1.432, z, 0.024, 0.034), R(x - 0.02 * s, 1.418, z, 0.032, 0.046), R(x + 0.004 * s, 1.392, z, 0.046, 0.056), R(x + 0.012 * s, 1.36, z, 0.053, 0.057),
      R(x + 0.014 * s, 1.31, z, 0.052, 0.054), R(x + 0.016 * s, 1.275, z, 0.053, 0.055), R(x + 0.016 * s, 1.262, z, 0.05, 0.052)], 20,
      { sub: 3, front: new THREE.Vector3(0, 0, 1), capA: true, capB: false }), sleeveW);
    // turned-up hem band
    const hem: Ring[] = [];
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      hem.push({ c: new THREE.Vector3(x + 0.016 * s + Math.sin(a) * 0.053, 1.272, z + Math.cos(a) * 0.055), rx: 0.004, rz: 0.006, n: 2 });
    }
    b.addSkinned(loft(hem, 6, { sub: 1, capA: false, capB: false, front: new THREE.Vector3(0, 1, 0) }), () => [['uarm_' + sfx, 1]]);
  }
  // ── arms + hands (skin) ──────────────────────────────────────────────
  b.mat('skin');
  for (const s of [-1, 1]) {
    const sfx = s > 0 ? 'l' : 'r', x = K.shoulderX * s, z = K.shoulderZ;
    const wy = K.shoulderY - K.uarm - K.larm;
    const armW = chain(['spine2', 'uarm_' + sfx, 'larm_' + sfx, 'hand_' + sfx], [[0.06 * s, 1.44, z], [x, K.shoulderY, z], [x, K.shoulderY - K.uarm, z], [x, wy, z], [x, wy - 0.1, z]], [0, 0.05, 0.045, 0.025]);
    b.addSkinned(loft([R(x, 1.38, z, 0.043, 0.046), R(x, 1.3, z, 0.04, 0.042), R(x, 1.2, z, 0.036, 0.038), R(x, 1.14, z - 0.002, 0.034, 0.035), R(x, 1.08, z, 0.037, 0.038), R(x, 1.0, z, 0.032, 0.03),
      R(x, 0.92, z, 0.024, 0.02), R(x, wy, z, 0.023, 0.018)], 16, { sub: 3 }), armW);
    // palm (thin across X, wide along Z), palm faces the thigh
    const handW = chain(['hand_' + sfx, 'fing_' + sfx], [[x, wy, z], [x, wy - 0.088, z], [x, wy - 0.2, z]], [0, 0.012]);
    b.addSkinned(loft([R(x, wy + 0.004, z + 0.003, 0.018, 0.022, 2.4), R(x, wy - 0.035, z + 0.004, 0.0145, 0.042, 2.8), R(x + 0.002 * s, wy - 0.08, z + 0.004, 0.012, 0.043, 3), R(x + 0.002 * s, wy - 0.095, z + 0.004, 0.0105, 0.04, 2.6)], 14, { sub: 2 }), handW);
    // fingers: index (front, +z) → little
    const fz = [0.028, 0.0095, -0.0085, -0.026], fl = [0.072, 0.08, 0.076, 0.06], fr = [0.0082, 0.0085, 0.008, 0.0072];
    for (let i = 0; i < 4; i++) {
      const y0 = wy - 0.084, zz = z + 0.004 + fz[i], L = fl[i], r = fr[i];
      const fW = chain(['hand_' + sfx, 'fing_' + sfx, 'fing2_' + sfx], [[x, wy, zz], [x, wy - 0.088, zz], [x, wy - 0.128, zz], [x, y0 - L - 0.02, zz]], [0, 0.008, 0.008]);
      b.addSkinned(loft([R(x + 0.0012 * s, y0, zz, r * 1.05, r * 1.1), R(x + 0.001 * s, y0 - L * 0.5, zz, r * 0.95, r), R(x, y0 - L * 0.92, zz, r * 0.8, r * 0.85), R(x - 0.001 * s, y0 - L, zz, r * 0.4, r * 0.45)], 8, { sub: 2 }), fW);
    }
    // thumb: from the heel of the palm, forward and down
    const tw = chain(['hand_' + sfx, 'thumb_' + sfx], [[x, wy, z + 0.02], [x - 0.008 * s, wy - 0.022, z + 0.026], [x - 0.012 * s, wy - 0.08, z + 0.05]], [0, 0.01]);
    b.addSkinned(loft([R(x - 0.004 * s, wy - 0.012, z + 0.022, 0.011, 0.012), R(x - 0.01 * s, wy - 0.04, z + 0.036, 0.009, 0.0095), R(x - 0.013 * s, wy - 0.064, z + 0.046, 0.008, 0.0085), R(x - 0.014 * s, wy - 0.075, z + 0.05, 0.004, 0.004)], 8, { sub: 2, front: new THREE.Vector3(1, 0, 0) }), tw);
  }

  // ── coverall: pelvis + legs ──────────────────────────────────────────
  b.mat('cover');
  {
    const pelvW = (p: THREE.Vector3): [string, number][] => {
      const s = p.x >= 0 ? 'l' : 'r';
      const wt = sm(0.94, 0.8, p.y) * sm(0.01, 0.06, Math.abs(p.x)) * 0.85;
      return [['hips', 1 - wt], ['thigh_' + s, wt]];
    };
    b.addSkinned(loft([R(0, 1.035, 0.0, 0.146, 0.094, 2.4), R(0, 0.98, 0.0, 0.156, 0.104, 2.4), R(0, 0.92, -0.004, 0.165, 0.11, 2.5), R(0, 0.86, -0.004, 0.158, 0.104, 2.5), R(0, 0.82, -0.002, 0.11, 0.08, 2.3)], 28, { sub: 3 }), pelvW);
  }
  for (const s of [-1, 1]) {
    const sfx = s > 0 ? 'l' : 'r', x = K.hipX * s;
    const legW = chain(['hips', 'thigh_' + sfx, 'shin_' + sfx, 'foot_' + sfx], [[x, 1.0, 0], [x, K.hipY, 0], [x, K.hipY - K.thigh, 0.004], [x, K.ankle, -0.004], [x, -0.05, 0]], [0, 0.07, 0.06, 0.05]);
    b.addSkinned(loft([R(x + 0.006 * s, 0.92, -0.004, 0.084, 0.088), R(x + 0.002 * s, 0.8, 0.004, 0.08, 0.082), R(x, 0.66, 0.006, 0.07, 0.074), R(x, 0.52, 0.01, 0.062, 0.066), R(x, 0.46, 0.008, 0.06, 0.064),
      R(x, 0.34, -0.004, 0.06, 0.062), R(x, 0.2, -0.004, 0.058, 0.06), R(x, 0.11, 0.0, 0.06, 0.064), R(x, 0.085, 0.002, 0.061, 0.066)], 20, { sub: 3 }), legW);
    // thigh cargo pocket
    b.addSkinned(loft([R(x + 0.066 * s, 0.7, 0.0, 0.012, 0.045, 3), R(x + 0.068 * s, 0.6, 0.002, 0.014, 0.047, 3), R(x + 0.066 * s, 0.56, 0.004, 0.01, 0.042, 3)], 12, { sub: 2 }), legW);
  }
  // the coverall top, pulled down: rolled band at the waist, back panel hanging over the seat, sleeves knotted in front
  {
    const roll: Ring[] = [];
    const N = 28;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const lump = 1 + 0.12 * vnoise(i * 0.9, 3.3);
      roll.push({ c: new THREE.Vector3(Math.sin(a) * 0.16, 1.0 + 0.012 * Math.sin(a * 2 + 1) - 0.01 * Math.max(0, Math.cos(a)), Math.cos(a) * 0.108 + 0.002), rx: 0.022 * lump, rz: 0.028 * lump, n: 2 });
    }
    b.addSkinned(loft(roll, 10, { sub: 1, capA: false, capB: false, front: new THREE.Vector3(0, 1, 0) }), rigid('hips'));
    // knot (front, a little to his left)
    b.addSkinned(ellip([0.04, 0.99, 0.128], [0.04, 0.03, 0.026], 12, 8), rigid('hips'));
    b.addSkinned(ellip([0.022, 0.975, 0.135], [0.025, 0.028, 0.02], 10, 7), rigid('hips'));
    // back panel
    const geo = patch((u, v, out) => {
      const a = (112 + 136 * u) * D, y = 0.99 - v * 0.27;
      const rx = 0.162 + v * 0.03, rz = 0.112 + v * 0.03 + 0.012 * Math.sin(u * Math.PI);
      const fold = 0.006 * Math.sin(u * 19 + v * 2) * v;
      out.set(Math.sin(a) * (rx + fold), y, Math.cos(a) * (rz + fold) - 0.004);
    }, { nu: 18, nv: 7, thickness: 0.006 });
    b.addSkinned(geo, (p) => {
      const wt = sm(0.93, 0.74, p.y) * 0.55;
      return [['hips', 1 - wt], [p.x >= 0 ? 'thigh_l' : 'thigh_r', wt]];
    });
    // sleeves hanging from the knot
    for (const s of [-1, 1]) {
      const sfx = s > 0 ? 'l' : 'r';
      const x0 = 0.035 + 0.03 * s;
      const sl = loft([R(x0, 0.985, 0.13, 0.026, 0.02), R(x0 + 0.012 * s, 0.9, 0.135, 0.03, 0.016), R(x0 + 0.02 * s, 0.78, 0.13, 0.033, 0.015), R(x0 + 0.024 * s, 0.68, 0.124, 0.035, 0.016), R(x0 + 0.025 * s, 0.665, 0.122, 0.03, 0.014)], 10, { sub: 3 });
      b.addSkinned(sl, chain(['hips', 'sleeve_' + sfx], [[x0, 1.02, 0.13], [x0, 0.985, 0.13], [x0, 0.6, 0.13]], [0, 0.02]));
    }
  }
  // boots
  b.mat('boot');
  for (const s of [-1, 1]) {
    const sfx = s > 0 ? 'l' : 'r', x = K.hipX * s;
    const bw = chain(['shin_' + sfx, 'foot_' + sfx], [[x, 0.3, 0], [x, K.ankle, -0.004], [x, 0, 0.2]], [0, 0.03]);
    b.addSkinned(loft([R(x, 0.15, -0.004, 0.05, 0.055), R(x, 0.09, 0.0, 0.052, 0.062), R(x, 0.05, 0.03, 0.05, 0.095, 2.6), R(x + 0.004 * s, 0.04, 0.09, 0.048, 0.07, 2.6), R(x + 0.006 * s, 0.035, 0.15, 0.044, 0.034, 2.4), R(x + 0.006 * s, 0.03, 0.178, 0.036, 0.012, 2.2)], 16,
      { sub: 3, front: new THREE.Vector3(0, 1, 0) }), bw);
    b.addSkinned(loft([R(x, 0.016, -0.075, 0.05, 0.016, 3), R(x + 0.004 * s, 0.014, 0.05, 0.056, 0.016, 3), R(x + 0.006 * s, 0.013, 0.17, 0.042, 0.014, 3)], 12, { sub: 2, front: new THREE.Vector3(0, 1, 0) }), rigid('foot_' + sfx));
  }

  // ── lanyard + badge ──────────────────────────────────────────────────
  b.mat('badge');
  {
    const pts: Ring[] = [];
    // round the back of the neck, down both sides of the chest to the clip
    const path: V3[] = [[0.0, 1.398, 0.104], [0.03, 1.43, 0.098], [0.05, 1.47, 0.06], [0.058, 1.486, 0.0], [0.04, 1.49, -0.05], [0.0, 1.488, -0.064], [-0.04, 1.49, -0.05], [-0.058, 1.486, 0.0], [-0.05, 1.47, 0.06], [-0.03, 1.43, 0.098], [0.0, 1.398, 0.104]];
    for (const p of path) pts.push({ c: new THREE.Vector3(...p), rx: 0.0055, rz: 0.0016, n: 2 });
    b.addSkinned(loft(pts, 5, { sub: 2, front: new THREE.Vector3(0, 0, 1) }), rigid('spine2'));
    const card = new THREE.BoxGeometry(0.054, 0.084, 0.003).toNonIndexed();
    card.translate(0, 1.33, 0.124);
    b.addSkinned(card, rigid('badge'));
    const clip = new THREE.BoxGeometry(0.012, 0.022, 0.006).toNonIndexed();
    clip.translate(0, 1.383, 0.124);
    b.addSkinned(clip, rigid('badge'));
  }

  // ── headset ──────────────────────────────────────────────────────────
  b.mat('dark');
  {
    const band: Ring[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, a = (-1 + 2 * t) * Math.PI / 2;
      // over the crown, slightly behind the top
      const x = Math.sin(a) * 0.088, y = 1.648 + Math.cos(a) * 0.128, z = -0.012 - Math.cos(a) * 0.006;
      band.push({ c: new THREE.Vector3(x, y, z), rx: 0.008, rz: 0.0035, n: 2.5 });
    }
    b.addSkinned(loft(band, 8, { sub: 2, front: new THREE.Vector3(0, 0, 1) }), rigid('head'));
    // left ear cup + right pad
    const cup = new THREE.CylinderGeometry(0.033, 0.033, 0.024, Math.max(8, Math.round(18 * DETAIL.k)));
    cup.rotateZ(Math.PI / 2); cup.translate(0.089, 1.638, -0.006);
    b.addSkinned(cup.toNonIndexed(), rigid('head'));
    const pad = new THREE.CylinderGeometry(0.022, 0.024, 0.016, Math.max(8, Math.round(14 * DETAIL.k)));
    pad.rotateZ(Math.PI / 2); pad.translate(-0.084, 1.64, -0.006);
    b.addSkinned(pad.toNonIndexed(), rigid('head'));
    // mic boom from the cup to the corner of the mouth
    const boom: Ring[] = ([[0.098, 1.632, 0.012], [0.09, 1.612, 0.05], [0.07, 1.594, 0.084], [0.04, 1.587, 0.1], [0.024, 1.586, 0.104]] as V3[]).map((p) => ({ c: new THREE.Vector3(...p), rx: 0.0026, rz: 0.0026 }));
    b.addSkinned(loft(boom, 6, { sub: 3 }), rigid('head'));
    b.addSkinned(ellip([0.02, 1.586, 0.105], [0.007, 0.0065, 0.0065], 8, 6), rigid('head'));
    // cable down to the collar
    const cab: Ring[] = ([[0.09, 1.616, -0.012], [0.08, 1.56, -0.03], [0.07, 1.5, -0.04], [0.09, 1.45, -0.04]] as V3[]).map((p) => ({ c: new THREE.Vector3(...p), rx: 0.0022, rz: 0.0022 }));
    b.addSkinned(loft(cab, 5, { sub: 3 }), chain(['head', 'neck', 'spine2'], [[0.09, 1.62, -0.012], [0.08, 1.55, -0.03], [0.07, 1.48, -0.04], [0.09, 1.42, -0.04]], [0, 0.02, 0.02]));
    b.mat('green');
    b.addSkinned(ellip([0.1015, 1.648, 0.004], [0.002, 0.0028, 0.0028], 6, 4), rigid('head'));
  }

  // ── marker (shown only while writing) ────────────────────────────────
  b.mat('badge');
  {
    const wy = K.shoulderY - K.uarm - K.larm, x = -K.shoulderX;
    const m = new THREE.CylinderGeometry(0.0085, 0.0085, 0.13, Math.max(6, Math.round(10 * DETAIL.k)));
    m.rotateX(Math.PI / 2); m.translate(x + 0.006, wy - 0.06, K.shoulderZ + 0.02);
    b.addSkinned(m.toNonIndexed(), rigid('marker'));
  }
  return { eyeL: eL, eyeR: eR };
}

// ───────────────────────────────────────────────────────────── vertex colours

const EL = new THREE.Vector3(), ER = new THREE.Vector3();
let eyesReady = false;
function eyeCentres() {
  if (eyesReady) return;
  for (const [s, out] of [[1, EL], [-1, ER]] as const) {
    headPoint(s * EYE_A, EYE_E, out);
    out.addScaledVector(hdir(s * EYE_A, EYE_E, new THREE.Vector3()), -0.0062);
  }
  eyesReady = true;
}

function skinTone(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color): void {
  eyeCentres();
  let r = 1, g = 1, bl = 1;
  if (p.y > 1.5) {
    // tired: dark round the eyes, worse underneath
    for (const e of [EL, ER]) {
      const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
      const d = Math.hypot(dx * 0.9, dy * (dy < 0 ? 0.75 : 1.2), dz);
      const k = 1 - sm(0.012, 0.03, d);
      r -= k * 0.32; g -= k * 0.38; bl -= k * 0.3;
      if (dy < -0.006 && dy > -0.02 && Math.abs(dx) < 0.016) { const u = 1 - sm(0.0, 0.016, Math.abs(dx)); r -= u * 0.08; g -= u * 0.12; bl -= u * 0.06; }
    }
    // lips: darker, redder
    const ly = (p.y - (K.mouthY - 0.001)) / 0.0065, lx = p.x / 0.022;
    if (p.z > 0.07) { const k = 1 - sm(0.6, 1.2, lx * lx + ly * ly); r -= k * 0.06; g -= k * 0.17; bl -= k * 0.14; if (Math.abs(p.y - (K.mouthY - 0.0005)) < 0.0018 && Math.abs(p.x) < 0.022) { r *= 0.45; g *= 0.35; bl *= 0.35; } }
    // stubble: chin, jaw, upper lip
    if (p.y < 1.6 && p.z > -0.03) {
      const st = (1 - sm(1.59, 1.605, p.y)) * (vnoise(p.x * 400, p.y * 400) * 0.5 + 0.5) * 0.06;
      r -= st; g -= st * 1.05; bl -= st * 0.9;
    }
    // cheeks + nose tip a touch warm
    for (const s of [-1, 1]) { const d = Math.hypot(p.x - s * 0.045, p.y - 1.61, (p.z - 0.07) * 0.6); const k = 1 - sm(0.0, 0.025, d); g -= k * 0.06; bl -= k * 0.06; }
    // inside of the mouth / nostrils / ear holes: dark
    if (p.y < 1.6 && p.y > 1.592 && p.z > 0.098 && p.z < 0.108 && Math.abs(p.x) > 0.004 && Math.abs(p.x) < 0.016 && n.y < -0.3) { r *= 0.4; g *= 0.35; bl *= 0.35; }
    if (Math.abs(p.x) > 0.07 && n.x * Math.sign(p.x) < 0.2 && p.y > 1.62 && p.y < 1.66) { r *= 0.75; g *= 0.7; bl *= 0.7; }
  } else {
    // arms / hands: knuckles + creases slightly darker, a few scuffs
    const m = vnoise(p.x * 60, p.y * 60 + p.z * 40) * 0.08;
    r -= m; g -= m * 1.1; bl -= m;
  }
  out.setRGB(Math.max(0.08, r), Math.max(0.05, g), Math.max(0.05, bl));
}

export function clothShade(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color): void {
  const big = vnoise(p.x * 8 + p.z * 3, p.y * 7);
  const fine = vnoise(p.x * 41 + 3, p.y * 37 + p.z * 23);
  let k = 1.02 - big * 0.07 - fine * 0.05;
  // folds: behind the knees, crotch, under the waist roll, elbows of the shirt
  k -= Math.max(0, -n.y) * 0.18;
  if (p.y < 0.98 && p.y > 0.93) k -= 0.12 * (1 - sm(0.93, 0.98, p.y));
  if (p.y < 0.55 && p.y > 0.42 && p.z < 0) k -= 0.12;
  // grime toward the cuffs
  k -= (1 - sm(0.08, 0.45, p.y)) * 0.18;
  // sweat-dark patch down the shirt's chest and under the arms
  if (p.y > 1.18 && p.y < 1.4 && Math.abs(p.x) < 0.06 && p.z > 0.06) k -= 0.06 * (1 - sm(0.0, 0.06, Math.abs(p.x)));
  k = Math.min(1.1, Math.max(0.45, k));
  out.setRGB(k, k, k * 1.01);
}

export function hairTone(p: THREE.Vector3, _n: THREE.Vector3, out: THREE.Color): void {
  const v = vnoise(p.x * 90, p.y * 70 + p.z * 50) * 0.35 + vnoise(p.x * 17, p.z * 19) * 0.25;
  const k = 0.75 + v;
  out.setRGB(k, k * 0.95, k * 0.9);
}

export function eyeTone(p: THREE.Vector3, _n: THREE.Vector3, out: THREE.Color): void {
  eyeCentres();
  const e = p.x >= 0 ? EL : ER;
  const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > K.eyeR * 1.4) { out.setRGB(0.86, 0.84, 0.78); return; } // teeth
  // angle from the gaze axis (+Z at bind)
  const c = dz / (d || 1);
  const ang = Math.acos(Math.min(1, Math.max(-1, c)));
  if (ang < 0.19) { out.setRGB(0.02, 0.018, 0.016); return; }                                // pupil
  if (ang < 0.46) { const t = (ang - 0.19) / 0.27; out.setRGB(0.2 + t * 0.12, 0.13 + t * 0.06, 0.07); return; } // iris (hazel-brown)
  const lim = sm(0.46, 0.52, ang);
  const vein = 1 - sm(0.6, 1.4, ang) * 0.12;
  out.setRGB((0.12 + 0.86 * lim) * vein, (0.1 + 0.8 * lim) * vein * 0.97, (0.09 + 0.76 * lim) * vein * 0.95);
}

function badgeTone(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color): void {
  // lanyard: night-shift blue; the card: white with a blue band, photo square and a barcode strip; marker: black cap
  if (p.y > 1.385 || (p.y > 1.372 && Math.abs(p.x) > 0.008)) { out.setRGB(0.12, 0.25, 0.55); return; }
  if (p.y < 1.2) { out.setRGB(p.z > K.shoulderZ + 0.07 ? 0.05 : 0.9, p.z > K.shoulderZ + 0.07 ? 0.05 : 0.9, p.z > K.shoulderZ + 0.07 ? 0.05 : 0.88); return; }
  if (n.z < 0.5) { out.setRGB(0.85, 0.85, 0.83); return; }
  const lx = p.x, ly = p.y - 1.33;
  if (ly > 0.026) { out.setRGB(0.12, 0.3, 0.62); return; }
  if (ly > -0.012 && ly < 0.02 && lx > -0.022 && lx < 0.0) { out.setRGB(0.35, 0.3, 0.27); return; }
  if (ly < -0.03 && Math.abs(lx) < 0.02 && Math.sin(lx * 900) > 0.2) { out.setRGB(0.08, 0.08, 0.08); return; }
  out.setRGB(0.93, 0.93, 0.9);
}
