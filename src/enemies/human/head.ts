/**
 * REVISION 5 — Tomas's scanned head (R7 / "Tomas's head" / 5.1 "Head asset").
 *
 * Asset: `public/models/tomas-head.glb` = "Infinite, 3D Head Scan" by Lee Perry-Smith (CC BY 3.0, three.js examples;
 * see docs/ASSETS.md), colour map toned for Tomas. Loaded once on level 2 by createEnemies; on any failure the
 * procedural head stays (fallback).
 *
 * The scan is a closed-eyed, bald, shoulders-up bust. At load it is fitted to the procedural body:
 *   • scaled + placed so its eye slits sit on the procedural eyeballs (two-point fit, inter-pupil distance);
 *   • trimmed at the collar (the T-shirt collar + procedural neck hide the seam);
 *   • almond eye openings cut through the closed lids — the procedural eyeballs (look-at) and lids (blink) show through;
 *   • the lips are split along the mouth line and the lower face is skinned to the jaw bone (speech) over a dark
 *     mouth interior; brows are weighted to the brow bones (worry / emphasis);
 *   • a short-cropped hair shell is grown from the scalp (offset along the normals, ragged edge);
 * then every Human instance binds it to its own skeleton and hides the procedural face + hair.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GameContext } from '../../core/types';
import type { HumanTemplate } from './model';

export interface ScanHead {
  /** Model-space (bind pose) skinned geometries; skinIndex = template bone indices. */
  face: THREE.BufferGeometry;
  /** The closed lids (shown while a blink is in its closed phase). */
  lids: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
  mouth: THREE.BufferGeometry;
  faceMat: THREE.Material;
  hairMat: THREE.Material;
  /** Round T-shirt collar rib over the neck seam. */
  collar: THREE.BufferGeometry;
  shirtMat: THREE.Material;
  mouthMat: THREE.Material;
  eyes: THREE.BufferGeometry;
  lashes: THREE.BufferGeometry;
  lashMat: THREE.Material;
  eyeMat: THREE.Material;
  /** Model-space offsets that move the procedural eye/lid bones behind the scan's eye openings. */
  eyeOffL: THREE.Vector3; eyeOffR: THREE.Vector3;
}

const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vnoise(x: number, y: number): number {
  const h = (i: number, j: number) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}

/**
 * Landmarks in the scan's own space (x right = his left, y up, z forward; measured from a front depth render of the
 * asset): eyeball centres behind the closed lids, lip line + corners, brows. z is found on the front surface.
 */
const LM = {
  eyeA: [0.5, 1.665], eyeB: [-0.74, 1.665],
  mouth: [-0.11, 0.47], mouthA: [0.31, 0.47], mouthB: [-0.53, 0.47],
  browA: [0.52, 1.96], browB: [-0.76, 1.96],
};

/** Front-most surface point at (x, y) (orthographic ray along −z). */
function frontPoint(pos: ArrayLike<number>, idx: ArrayLike<number>, x: number, y: number, out: THREE.Vector3): boolean {
  let best = -Infinity;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], bx = pos[b * 3], by = pos[b * 3 + 1], cx = pos[c * 3], cy = pos[c * 3 + 1];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
    const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const z = pos[a * 3 + 2] * l1 + pos[b * 3 + 2] * l2 + pos[c * 3 + 2] * l3;
    if (z > best) best = z;
  }
  if (best === -Infinity) return false;
  out.set(x, y, best);
  return true;
}

/** Cap line height above eye level by angle round the head (0 front, π back): above the brows, over the ear tops. */
function capEdge(a: number): number {
  // a proper beanie: low on the forehead, over the tops of the ears, down to the nape at the back
  const k: [number, number][] = [[0, 0.056], [0.5, 0.054], [0.9, 0.046], [1.2, 0.036], [1.6, 0.033], [1.85, 0.012], [2.15, -0.03], [2.6, -0.062], [Math.PI, -0.072]];
  let j = 0; while (j < k.length - 2 && a > k[j + 1][0]) j++;
  const f = sm(k[j][0], k[j + 1][0], a);
  return k[j][1] + (k[j + 1][1] - k[j][1]) * f;
}
/** Natural hairline (where his own hair would start), for the sideburns / nape tint below the cap. */
function hairEdge(a: number): number {
  const k: [number, number][] = [[0, 0.068], [0.78, 0.066], [0.95, 0.02], [1.08, -0.012], [1.2, -0.004], [1.32, 0.03], [1.62, 0.032], [1.9, -0.02], [2.3, -0.06], [2.7, -0.085], [Math.PI, -0.092]];
  let j = 0; while (j < k.length - 2 && a > k[j + 1][0]) j++;
  const f = sm(k[j][0], k[j + 1][0], a);
  return k[j][1] + (k[j + 1][1] - k[j][1]) * f;
}

export async function loadTomasHead(ctx: GameContext, tpl: HumanTemplate, url = `${import.meta.env.BASE_URL}models/tomas-head.glb`): Promise<ScanHead | null> {
  const t0 = performance.now();
  const gltf = await new GLTFLoader().loadAsync(url);
  let src: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => { if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh; });
  if (!src) throw new Error('no mesh in head asset');
  const mesh = src as THREE.Mesh;
  const g = mesh.geometry as THREE.BufferGeometry;
  const srcMat = mesh.material as THREE.MeshStandardMaterial;
  // (the maps in the GLB are pre-flipped by build-head.mjs to match the scan's UVs under glTF's flipY = false)
  const P = g.getAttribute('position').array as Float32Array, N = g.getAttribute('normal').array as Float32Array;
  const T = g.getAttribute('uv').array as Float32Array, I = g.getIndex()!.array;
  const nV = P.length / 3;

  // ── fit: scan eye slits → procedural eye fronts
  const scanLeft = new THREE.Vector3(), scanRight = new THREE.Vector3();
  if (!frontPoint(P, I, LM.eyeA[0], LM.eyeA[1], scanLeft) || !frontPoint(P, I, LM.eyeB[0], LM.eyeB[1], scanRight)) throw new Error('eye landmarks not found');
  const eyeR = 0.0118;
  const tL = tpl.eyeL.clone(), tR = tpl.eyeR.clone();
  // real proportions: 63 mm between the pupils (the procedural eyes are closer set; their bones are moved instead)
  const s = 0.063 / scanLeft.distanceTo(scanRight);
  const yaw = Math.atan2(-(scanLeft.z - scanRight.z), scanLeft.x - scanRight.x);
  const mS = scanLeft.clone().add(scanRight).multiplyScalar(0.5);
  const mT = tL.clone().add(tR).multiplyScalar(0.5);
  mT.z += eyeR + 0.0016; // the closed lid sits just in front of the eyeball
  const M = new THREE.Matrix4().makeTranslation(mT.x, mT.y, mT.z)
    .multiply(new THREE.Matrix4().makeRotationY(-yaw))
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-mS.x, -mS.y, -mS.z));
  const NM = new THREE.Matrix3().getNormalMatrix(M);
  // where the eyeballs have to be: behind the scan's lids (the eye bones are offset by this much per instance)
  const eyeAt = (p: THREE.Vector3) => p.clone().applyMatrix4(M).add(new THREE.Vector3(0, -0.0006, -(eyeR + 0.0042)));
  const eyeOffL = eyeAt(scanLeft).sub(tL), eyeOffR = eyeAt(scanRight).sub(tR);
  const eyeCL = tL.clone().add(eyeOffL), eyeCR = tR.clone().add(eyeOffR);
  const pos = new Float32Array(nV * 3), nrm = new Float32Array(nV * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < nV; i++) {
    v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(M); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    v.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).applyMatrix3(NM).normalize(); nrm[i * 3] = v.x; nrm[i * 3 + 1] = v.y; nrm[i * 3 + 2] = v.z;
  }
  const at = (p: number[]) => { const o = new THREE.Vector3(p[0], p[1], 0).applyMatrix4(M); frontPoint(pos, I, o.x, o.y, o); return o; };
  const mouth = at(LM.mouth), mL = at(LM.mouthA), mR = at(LM.mouthB);
  // younger, softer: the jaw and chin a little narrower (a lattice squeeze in x from the mouth down to the neck)
  for (let i = 0; i < nV; i++) {
    const y = pos[i * 3 + 1];
    const k = sm(mouth.y + 0.012, mouth.y - 0.045, y) * (1 - sm(1.545, 1.5, y) * 0.0) * sm(1.47, 1.52, y);
    pos[i * 3] = mouth.x + (pos[i * 3] - mouth.x) * (1 - 0.085 * k);
  }
  const browA = at(LM.browA), browB = at(LM.browB);
  const mouthHalf = Math.abs(mL.x - mR.x) * 0.5 + 0.002;

  // ── bones
  const bi = new Map<string, number>();
  tpl.rig.bones.forEach((b, i) => bi.set(b.name, i));
  const B = (n: string) => bi.get(n)!;

  // ── triangle filter: collar trim, eye openings, lip split
  const CUT = 1.47, neckTop = 1.5, neckZ = mT.z - 0.095;
  // ── neck: below a seam line (low at the throat, higher at the nape) the scan is pulled onto a clean elliptical
  // column that ends in a horizontal loop at the collar — no ragged shoulder triangles, no spikes
  const NECK_LOW = 1.478;
  let ncx = 0, ncz = 0, nrx = 0.055, nrz = 0.056;
  {
    let xm = 0, z0 = 1e9, z1 = -1e9, n = 0;
    for (let i = 0; i < nV; i++) {
      if (Math.abs(pos[i * 3 + 1] - 1.53) > 0.006) continue;
      const nx = pos[i * 3] / 0.08, nz = (pos[i * 3 + 2] - neckZ) / 0.085;
      if (nx * nx + nz * nz > 1) continue;
      xm = Math.max(xm, Math.abs(pos[i * 3])); z0 = Math.min(z0, pos[i * 3 + 2]); z1 = Math.max(z1, pos[i * 3 + 2]); n++;
    }
    if (n > 8) { ncz = (z0 + z1) / 2; nrx = THREE.MathUtils.clamp(xm * 0.97, 0.048, 0.064); nrz = THREE.MathUtils.clamp((z1 - z0) / 2 * 0.97, 0.048, 0.066); }
    else ncz = neckZ;
  }
  const neckInfo = { cx: ncx, cz: ncz, rx: nrx, rz: nrz };
  for (let i = 0; i < nV; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const dx = x - ncx, dz = z - ncz;
    const a = Math.atan2(dx / nrx, dz / nrz);
    const seam = 1.512 + 0.05 * sm(0.6, 2.4, Math.abs(a)); // throat … nape
    if (y >= seam) continue;
    const w = sm(seam, seam - 0.022, y);
    const tx = ncx + Math.sin(a) * nrx, tz = ncz + Math.cos(a) * nrz;
    pos[i * 3] = x + (tx - x) * w; pos[i * 3 + 2] = z + (tz - z) * w;
    pos[i * 3 + 1] = y + (Math.max(y, NECK_LOW) - y) * w;
    const nx = Math.sin(a) / nrx, nz = Math.cos(a) / nrz, nl = Math.hypot(nx, nz) || 1;
    nrm[i * 3] += (nx / nl - nrm[i * 3]) * w; nrm[i * 3 + 1] *= 1 - w; nrm[i * 3 + 2] += (nz / nl - nrm[i * 3 + 2]) * w;
    const ln = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
    nrm[i * 3] /= ln; nrm[i * 3 + 1] /= ln; nrm[i * 3 + 2] /= ln;
  }
  /** Almond eye opening: < 1 inside (min over both eyes; front of the face only). */
  const eyeQ = (x: number, y: number, z: number) => {
    let q = 99;
    for (const e of [eyeCL, eyeCR]) {
      if (z < e.z - 0.002) continue;
      // centred a touch below the pupil: the upper lid covers the top of the iris, a sliver of white shows below
      const dx = (x - e.x) / 0.0145, dy = (y - (e.y + 0.0004 - 0.0009 * ((x - e.x) / 0.0145) * Math.sign(e.x))) / (0.0055 * (1 - 0.42 * Math.min(1, Math.abs(dx))));
      q = Math.min(q, dx * dx + dy * dy);
    }
    return q;
  };
  const eyeHole = (x: number, y: number, z: number) => eyeQ(x, y, z) < 1;
  const pos0 = pos.slice();
  // the rim of each opening turns in toward the eyeball (lids have thickness, the eye sits in a socket)
  for (let i = 0; i < nV; i++) {
    const q = eyeQ(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    if (q > 2) continue;
    const k = (1 - sm(0.9, 2, q)) * 0.0022;
    pos[i * 3] -= nrm[i * 3] * k; pos[i * 3 + 1] -= nrm[i * 3 + 1] * k; pos[i * 3 + 2] -= nrm[i * 3 + 2] * k;
  }
  const keep: number[] = [];
  /** The scan's own closed lids (cut out of the openings): shown for the closed phase of a blink. */
  const lidIdx: number[] = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ya = pos[a * 3 + 1], yb = pos[b * 3 + 1], yc = pos[c * 3 + 1];
    if (Math.max(ya, yb, yc) < NECK_LOW + 0.002) continue; // collapsed shoulder triangles on the bottom loop
    void CUT;
    const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, cy = (ya + yb + yc) / 3, cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
    // below the jaw keep only the neck column (the scan's shoulders go; the collar hides the cut)
    void neckTop;
    if (eyeHole(cx, cy, cz)) { lidIdx.push(a, b, c); continue; }
    keep.push(a, b, c);
  }

  // ── skin weights: jaw (lower lip, chin, jaw flesh), brows, neck root
  const si = new Uint16Array(nV * 4), sw = new Float32Array(nV * 4);
  const jawW = (x: number, y: number, z: number) => {
    const below = mouth.y - y, dx = Math.abs(x - mouth.x);
    if (z < mouth.z - 0.075 || below < -0.0004) return 0;
    const lat = 1 - sm(0.03, 0.07, dx);
    const deep = 1 - sm(0.035, 0.09, mouth.z - z);
    const w = (below > 0.0004 ? 1 : 0) * lat * (0.5 + 0.5 * deep) * (1 - sm(0.06, 0.1, below) * 0.5);
    return Math.max(0, Math.min(1, w));
  };
  for (let i = 0; i < nV; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const wn = (1 - sm(1.5, 1.565, y)) * sm(-0.06, 0.0, -z + 0.02) * 0.0 + (1 - sm(1.49, 1.56, y)) * 0.7;
    const wj = jawW(x, y, z) * (1 - wn);
    let wb = 0, brow = 'brow_l';
    for (const [p, name] of [[browA, browA.x > browB.x ? 'brow_l' : 'brow_r'], [browB, browB.x > browA.x ? 'brow_l' : 'brow_r']] as const) {
      const d = Math.hypot((x - p.x) / 0.03, (y - p.y) / 0.014, (z - p.z) / 0.02);
      const k = (1 - sm(0.4, 1, d)) * 0.9;
      if (k > wb) { wb = k; brow = name; }
    }
    wb *= 1 - wj - wn;
    const wh = Math.max(0, 1 - wj - wn - wb);
    const ws: [number, number][] = [[B('head'), wh], [B('jaw'), wj], [B('neck'), wn], [B(brow), wb]];
    ws.sort((p, q) => q[1] - p[1]);
    let tot = 0; for (const w of ws) tot += w[1];
    for (let k = 0; k < 4; k++) { si[i * 4 + k] = ws[k][0]; sw[i * 4 + k] = ws[k][1] / (tot || 1); }
  }
  // ── lips: closed and seamless at rest. Every triangle of the mouth band belongs wholly to the upper lip (head) or the
  // lower lip (jaw) by its centroid; shared vertices are duplicated with that side's weights, so the lips only part
  // when the jaw actually opens (speech), over the dark mouth interior.
  const xP = Array.from(pos), xN = Array.from(nrm), xT = Array.from(T), xSI = Array.from(si), xSW = Array.from(sw);
  const dupJaw = new Map<number, number>(), dupHead = new Map<number, number>();
  const dup = (i: number, jaw: boolean): number => {
    const m = jaw ? dupJaw : dupHead;
    let j = m.get(i);
    if (j !== undefined) return j;
    j = xP.length / 3;
    xP.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); xN.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]); xT.push(T[i * 2], T[i * 2 + 1]);
    if (jaw) { const wj = 1 - sm(0.03, 0.07, Math.abs(pos[i * 3] - mouth.x)) * 0.0; xSI.push(B('jaw'), B('head'), 0, 0); xSW.push(wj, 1 - wj, 0, 0); }
    else { xSI.push(B('head'), 0, 0, 0); xSW.push(1, 0, 0, 0); }
    m.set(i, j);
    return j;
  };
  for (let t = 0; t < keep.length; t += 3) {
    const ids = [keep[t], keep[t + 1], keep[t + 2]];
    const cx = (pos[ids[0] * 3] + pos[ids[1] * 3] + pos[ids[2] * 3]) / 3, cy = (pos[ids[0] * 3 + 1] + pos[ids[1] * 3 + 1] + pos[ids[2] * 3 + 1]) / 3;
    const cz = (pos[ids[0] * 3 + 2] + pos[ids[1] * 3 + 2] + pos[ids[2] * 3 + 2]) / 3;
    if (Math.abs(cx - mouth.x) > mouthHalf + 0.003 || cz < mouth.z - 0.014 || Math.abs(cy - mouth.y) > 0.008) continue;
    const lower = cy < mouth.y;
    for (let k = 0; k < 3; k++) {
      const i = ids[k], y = pos[i * 3 + 1];
      if (lower && y >= mouth.y - 0.0004) keep[t + k] = dup(i, true);
      else if (!lower && y < mouth.y - 0.0004) keep[t + k] = dup(i, false);
    }
  }
  // ── vertex tint (multiplies the colour map): contact shadow round the eyes, soft hair at the sideburns / nape
  const nX = xP.length / 3;
  const col = new Float32Array(nX * 3).fill(1);
  const headC0 = new THREE.Vector3(0, mT.y + 0.005, mT.z - 0.095);
  for (let i = 0; i < nX; i++) {
    const x = xP[i * 3], y = xP[i * 3 + 1], z = xP[i * 3 + 2];
    let r = 1, g = 1, b = 1;
    const q = eyeQ(x, y, z);
    if (q < 4) {
      const k = 1 - sm(1, 2.6, q);
      r -= 0.28 * k; g -= 0.32 * k; b -= 0.28 * k;
      // upper-lid crease / socket shade above the eye
      for (const e of [eyeCL, eyeCR]) {
        const d = Math.hypot((x - e.x) / 0.016, (y - e.y - 0.009) / 0.006);
        const c = (1 - sm(0.5, 1.4, d)) * 0.16;
        r -= c; g -= c * 1.1; b -= c;
      }
    }
    const a = Math.abs(Math.atan2(x - headC0.x, z - headC0.z));
    const edge = mT.y + hairEdge(a) + (vnoise(a * 14, y * 300) - 0.5) * 0.006;
    const hk = sm(-0.003, 0.004, y - edge) * (1 - sm(-0.004, 0.004, y - (mT.y + capEdge(a)))) * sm(0.9, 1.05, a);
    if (hk > 0) {
      const n = 0.75 + vnoise(x * 700, y * 600 + z * 500) * 0.5;
      r += (0.34 * n - r) * hk * 0.85; g += (0.26 * n - g) * hk * 0.85; b += (0.21 * n - b) * hk * 0.85;
    }
    col[i * 3] = Math.max(0.1, r); col[i * 3 + 1] = Math.max(0.1, g); col[i * 3 + 2] = Math.max(0.1, b);
  }
  const face = new THREE.BufferGeometry();
  face.setAttribute('position', new THREE.Float32BufferAttribute(xP, 3));
  face.setAttribute('normal', new THREE.Float32BufferAttribute(xN, 3));
  face.setAttribute('uv', new THREE.Float32BufferAttribute(xT, 2));
  face.setAttribute('color', new THREE.BufferAttribute(col, 3));
  face.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(xSI, 4));
  face.setAttribute('skinWeight', new THREE.Float32BufferAttribute(xSW, 4));
  face.setIndex(keep);
  const lids = new THREE.BufferGeometry();
  for (const k of ['normal', 'uv', 'color', 'skinIndex', 'skinWeight']) lids.setAttribute(k, face.getAttribute(k));
  {
    // the lids keep the scan's own (un-tucked) surface, nudged 0.6 mm forward so the eyeball never shows through
    const lp = new Float32Array(xP);
    for (let i = 0; i < nV; i++) for (let k = 0; k < 3; k++) lp[i * 3 + k] = pos0[i * 3 + k] + nrm[i * 3 + k] * 0.0006;
    lids.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  }
  lids.setIndex(lidIdx);
  lids.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.65, 0), 0.3);
  face.computeTangents?.();
  face.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.65, 0), 0.3);

  // ── knitted watch cap (beanie) over the scalp: a thick shell above the cap line with a rolled cuff; the headset
  // band sits on it. Short hair shows below it at the sideburns and nape (vertex tint above).
  const headC = new THREE.Vector3(0, mT.y + 0.005, mT.z - 0.095);
  const eyeY = mT.y;
  const hairOff = new Float32Array(nV);
  for (let i = 0; i < nV; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const a = Math.abs(Math.atan2(x - headC.x, z - headC.z));
    const above = y - (eyeY + capEdge(a));
    if (above < -0.03) { hairOff[i] = -9; continue; }
    const cuff = 1 - sm(0.024, 0.03, above);
    const crown = sm(eyeY + 0.06, eyeY + 0.14, y);
    const knit = vnoise(x * 300, y * 260 + z * 280) * 0.0008;
    hairOff[i] = -0.004 + (0.0095 + 0.0035 * cuff + 0.004 * crown + knit + 0.004) * sm(-0.003, 0.002, above);
  }
  const cuffY = (i: number) => eyeY + capEdge(Math.abs(Math.atan2(pos[i * 3] - headC.x, pos[i * 3 + 2] - headC.z))) + 0.006;
  const cuffBelow = (i: number) => pos[i * 3 + 1] < cuffY(i);
  const hp: number[] = [], hn: number[] = [], hc: number[] = [], huv: number[] = [];
  const hsi: number[] = [], hsw: number[] = [];
  const remap = new Int32Array(nV).fill(-1);
  const hIdx: number[] = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (hairOff[a] < -1 || hairOff[b] < -1 || hairOff[c] < -1) continue;
    // the shell ends inside the rolled cuff: vertices below the cuff line are lifted onto it (see below)
    if (cuffBelow(a) && cuffBelow(b) && cuffBelow(c)) continue;
    if (Math.max(hairOff[a], hairOff[b], hairOff[c]) <= 0) continue;
    for (const i of [a, b, c]) {
      if (remap[i] < 0) {
        remap[i] = hp.length / 3;
        const o = hairOff[i];
        // below the cuff line: lifted onto it and kept on the skin, i.e. inside the cuff tube
        const low = cuffBelow(i);
        const lift = low ? cuffY(i) - pos[i * 3 + 1] : 0;
        const oo = low ? 0 : o;
        hp.push(pos[i * 3] + nrm[i * 3] * oo, pos[i * 3 + 1] + nrm[i * 3 + 1] * oo + lift, pos[i * 3 + 2] + nrm[i * 3 + 2] * oo);
        hn.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
        // knit ribs run vertically: u around the head, v up it
        const ang = Math.atan2(pos[i * 3] - headC.x, pos[i * 3 + 2] - headC.z);
        huv.push(ang * 7, pos[i * 3 + 1] * 30);
        const k = 0.9 + vnoise(pos[i * 3] * 90, pos[i * 3 + 1] * 90 + pos[i * 3 + 2] * 70) * 0.2;
        hc.push(k, k, k);
        hsi.push(B('head'), 0, 0, 0); hsw.push(1, 0, 0, 0);
      }
      hIdx.push(remap[i]);
    }
  }
  // ── rolled cuff: a smooth tube round the head on the cap line, sitting just proud of the skin (hides the shell's
  // triangle-stepped lower edge)
  const ringOnSurface = (height: (a: number) => number, out: number, n = 72): THREE.Vector3[] => {
    const raw: { a: number; y: number; r: number }[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 - Math.PI, y = height(Math.abs(a));
      let r = 0;
      for (let i = 0; i < nV; i++) {
        const py = pos[i * 3 + 1];
        if (Math.abs(py - y) > 0.005) continue;
        const dx = pos[i * 3] - headC.x, dz = pos[i * 3 + 2] - headC.z;
        const va = Math.atan2(dx, dz);
        let d = Math.abs(va - a); if (d > Math.PI) d = Math.PI * 2 - d;
        if (d > 0.07) continue;
        r = Math.max(r, Math.hypot(dx, dz));
      }
      raw.push({ a, y, r });
    }
    // fill gaps + smooth the radius round the ring
    for (let k = 0; k < n; k++) if (raw[k].r === 0) raw[k].r = raw[(k + n - 1) % n].r || 0.08;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < n; k++) {
      let r = 0, w = 0;
      for (let j = -3; j <= 3; j++) { const q = raw[(k + j + n) % n]; const ww = 4 - Math.abs(j); r += q.r * ww; w += ww; }
      r = r / w + out;
      pts.push(new THREE.Vector3(headC.x + Math.sin(raw[k].a) * r, raw[k].y, headC.z + Math.cos(raw[k].a) * r));
    }
    return pts;
  };
  const tubeAlong = (pts: THREE.Vector3[], radius: number, bones: (p: THREE.Vector3) => [number, number][], shade: number): THREE.BufferGeometry => {
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal'), pts.length * 2, radius, 10, true);
    const tp = tube.getAttribute('position');
    const c = new Float32Array(tp.count * 3).fill(shade);
    const ti = new Uint16Array(tp.count * 4), tw = new Float32Array(tp.count * 4);
    const pv = new THREE.Vector3();
    for (let i = 0; i < tp.count; i++) {
      pv.fromBufferAttribute(tp, i);
      const bw = bones(pv);
      for (let k = 0; k < bw.length && k < 4; k++) { ti[i * 4 + k] = bw[k][0]; tw[i * 4 + k] = bw[k][1]; }
    }
    tube.setAttribute('color', new THREE.BufferAttribute(c, 3));
    tube.setAttribute('skinIndex', new THREE.BufferAttribute(ti, 4));
    tube.setAttribute('skinWeight', new THREE.BufferAttribute(tw, 4));
    const uvA = tube.getAttribute('uv');
    for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * 40, uvA.getY(i) * 2);
    return tube.toNonIndexed();
  };
  const cuff = tubeAlong(ringOnSurface((a) => eyeY + capEdge(a) + 0.0065, 0.003), 0.0082, () => [[B('head'), 1]], 0.92);
  // the shell's own lower edge stays just above the cuff's centre line (tucked under it)
  let hairGeo: THREE.BufferGeometry;
  const hair = new THREE.BufferGeometry();
  hair.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
  hair.setAttribute('normal', new THREE.Float32BufferAttribute(hn, 3));
  hair.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3));
  hair.setAttribute('uv', new THREE.Float32BufferAttribute(huv, 2));
  hair.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(hsi, 4));
  hair.setAttribute('skinWeight', new THREE.Float32BufferAttribute(hsw, 4));
  hair.setIndex(hIdx);
  hair.computeVertexNormals();
  {
    const ni = hair.toNonIndexed();
    const merged = mergeGeometries([ni, cuff]);
    if (merged) { hair.dispose(); hairGeo = merged; } else hairGeo = hair;
  }
  hairGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.65, 0), 0.3);
  // ── T-shirt collar rib: a round knit band at the neckline, over the cut end of the scan's neck
  const neckRing: THREE.Vector3[] = [];
  for (let k = 0, n = 48; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    // hugs the neck column just above its bottom loop; a crew neck dips a little at the front
    neckRing.push(new THREE.Vector3(neckInfo.cx + Math.sin(a) * (neckInfo.rx + 0.0045), NECK_LOW + 0.012 - 0.006 * Math.max(0, Math.cos(a)) ** 2, neckInfo.cz + Math.cos(a) * (neckInfo.rz + 0.0045)));
  }
  const collar = tubeAlong(neckRing, 0.0085, (p) => { const w = sm(1.47, 1.53, p.y) * 0.4; return [[B('spine2'), 1 - w], [B('neck'), w]]; }, 0.95);
  collar.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), 0.3);

  // ── mouth interior (dark, upper half on the head, lower on the jaw) + a hint of teeth
  const mouthG = new THREE.SphereGeometry(1, 14, 10);
  mouthG.scale(mouthHalf * 0.85, 0.013, 0.02);
  mouthG.translate(mouth.x, mouth.y - 0.002, mouth.z - 0.021);
  {
    const mp = mouthG.getAttribute('position');
    const msi = new Uint16Array(mp.count * 4), msw = new Float32Array(mp.count * 4);
    for (let i = 0; i < mp.count; i++) { msi[i * 4] = mp.getY(i) < mouth.y - 0.002 ? B('jaw') : B('head'); msw[i * 4] = 1; }
    mouthG.setAttribute('skinIndex', new THREE.BufferAttribute(msi, 4));
    mouthG.setAttribute('skinWeight', new THREE.BufferAttribute(msw, 4));
  }

  // ── eyeballs (replace the procedural ones in scan mode): authored at the procedural eye centres (bind pose) and
  // carried to the scan's sockets by the eye-bone offsets. Dark brown iris ≈ 11.3 mm, black pupil, darker limbal
  // ring, an off-white sclera that warms toward the corners.
  const eyeGeos: THREE.BufferGeometry[] = [];
  for (const [c, bone] of [[tL, 'eye_l'], [tR, 'eye_r']] as const) {
    const sg = new THREE.SphereGeometry(eyeR, 28, 20);
    sg.rotateX(Math.PI / 2); // pole on +z (gaze axis) so rings of latitude are iris rings
    const ec = new Float32Array(sg.getAttribute('position').count * 3);
    const pa = sg.getAttribute('position');
    for (let i = 0; i < pa.count; i++) {
      const vz = pa.getZ(i) / eyeR, ang = Math.acos(Math.max(-1, Math.min(1, vz)));
      let r: number, g2: number, b: number;
      if (ang < 0.2) { r = 0.012; g2 = 0.01; b = 0.01; }
      else if (ang < 0.5) {
        const t = (ang - 0.2) / 0.3, fib = vnoise(Math.atan2(pa.getY(i), pa.getX(i)) * 9, t * 3) * 0.5 + 0.5;
        r = (0.07 + 0.06 * t) * fib; g2 = (0.045 + 0.035 * t) * fib; b = (0.025 + 0.015 * t) * fib;
        if (t > 0.82) { r *= 0.45; g2 *= 0.45; b *= 0.45; }
      } else {
        const t = sm(0.5, 0.58, ang), side = Math.abs(pa.getX(i)) / eyeR;
        r = 0.04 + (0.5 + 0.06 * side) * t; g2 = 0.03 + (0.44 - 0.04 * side) * t; b = 0.025 + (0.41 - 0.05 * side) * t;
      }
      // the upper lid's shadow on the eyeball (it barely rotates, so baking it in is fine)
      const sh = 1 - 0.6 * sm(0.05, 0.6, pa.getY(i) / eyeR);
      ec[i * 3] = r * sh; ec[i * 3 + 1] = g2 * sh; ec[i * 3 + 2] = b * sh;
    }
    sg.setAttribute('color', new THREE.BufferAttribute(ec, 3));
    sg.translate(c.x, c.y, c.z);
    const esi = new Uint16Array(pa.count * 4), esw = new Float32Array(pa.count * 4);
    for (let i = 0; i < pa.count; i++) { esi[i * 4] = B(bone); esw[i * 4] = 1; }
    sg.setAttribute('skinIndex', new THREE.BufferAttribute(esi, 4));
    sg.setAttribute('skinWeight', new THREE.BufferAttribute(esw, 4));
    sg.deleteAttribute('uv');
    eyeGeos.push(sg);
  }
  // lid margins: a soft tube round each opening (lash line on top, thinner wet rim below) — defines the eye and hides
  // the triangle steps of the cut
  const lashGeos: THREE.BufferGeometry[] = [];
  for (const [e, ec, bone] of [[eyeCL, eyeOffL, 'head'], [eyeCR, eyeOffR, 'head']] as const) {
    void ec;
    const N = 40, ring: THREE.Vector3[] = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const dxn = Math.cos(a);
      const hx = e.x + dxn * 0.0145 * 0.99;
      const hh = 0.0055 * (1 - 0.42 * Math.min(1, Math.abs(dxn)));
      const hy = e.y + 0.0004 - 0.0009 * dxn * Math.sign(e.x) + Math.sin(a) * hh * 0.99;
      const p = new THREE.Vector3(hx, hy, e.z + 0.02);
      // drop onto the face surface (front-most), then tuck a little toward the eyeball
      let best = -Infinity;
      for (let t = 0; t < keep.length; t += 3) {
        const i0 = keep[t], i1 = keep[t + 1], i2 = keep[t + 2];
        const ax = xP[i0 * 3], ay = xP[i0 * 3 + 1], bx = xP[i1 * 3], by = xP[i1 * 3 + 1], cx = xP[i2 * 3], cy = xP[i2 * 3 + 1];
        if (Math.max(ax, bx, cx) < hx - 0.003 || Math.min(ax, bx, cx) > hx + 0.003 || Math.max(ay, by, cy) < hy - 0.003 || Math.min(ay, by, cy) > hy + 0.003) continue;
        const z = (xP[i0 * 3 + 2] + xP[i1 * 3 + 2] + xP[i2 * 3 + 2]) / 3;
        if (z > best && z < e.z + 0.02) best = z;
      }
      p.z = (best > -Infinity ? best : e.z + 0.008) - 0.0012;
      ring.push(p);
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 80, 1, 6, true);
    // per-vertex radius + colour: lash line on top (thicker, near black-brown), lower rim thin and pinkish-brown
    const tp = tube.getAttribute('position'), tn = tube.getAttribute('normal');
    const tc = new Float32Array(tp.count * 3);
    const cen = new THREE.Vector3();
    for (let i = 0; i < tp.count; i++) {
      // the tube was built with radius 1: recover the centre point and rescale
      cen.set(tp.getX(i) - tn.getX(i), tp.getY(i) - tn.getY(i), tp.getZ(i) - tn.getZ(i));
      const up = sm(-0.001, 0.003, cen.y - e.y);
      const r = 0.00035 + 0.00085 * up;
      tp.setXYZ(i, cen.x + tn.getX(i) * r, cen.y + tn.getY(i) * r + up * 0.0003, cen.z + tn.getZ(i) * r);
      const c = 0.06 + (1 - up) * 0.32;
      tc[i * 3] = c * 1.15; tc[i * 3 + 1] = c * 0.78; tc[i * 3 + 2] = c * 0.72;
    }
    tube.setAttribute('color', new THREE.BufferAttribute(tc, 3));
    tube.deleteAttribute('uv');
    const ti = new Uint16Array(tp.count * 4), tw = new Float32Array(tp.count * 4);
    for (let i = 0; i < tp.count; i++) { ti[i * 4] = B(bone); tw[i * 4] = 1; }
    tube.setAttribute('skinIndex', new THREE.BufferAttribute(ti, 4));
    tube.setAttribute('skinWeight', new THREE.BufferAttribute(tw, 4));
    lashGeos.push(tube.toNonIndexed());
  }
  const lashes = mergeGeometries(lashGeos)!;
  lashes.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.65, 0), 0.3);
  const eyes = mergeGeometries(eyeGeos)!;
  eyes.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.65, 0), 0.3);

  // ── materials (through the library)
  const lib = ctx.materials;
  const faceMat = lib.clone('plastic_white', {
    color: 0xeae2dc, map: srcMat.map, normalMap: srcMat.normalMap, normalScale: srcMat.normalScale.clone().multiplyScalar(0.8),
    roughness: 0.7, metalness: 0, roughnessMap: null, metalnessMap: null, aoMap: null, vertexColors: true,
    // a little light of its own from the colour map: stands in for subsurface warmth so hard light never goes waxy-grey
    emissive: 0xffd2b8, emissiveMap: srcMat.map, emissiveIntensity: 0.03, envMapIntensity: 0.5,
  });
  faceMat.name = 'tomas_scan_skin';
  // cropped hair: the fabric weave at a fine tiling reads as short strands; matte, warm dark brown
  const shirtMat = tpl.rig.meshes.find((m) => m.key === 'shirt')?.material ?? lib.clone('fabric', { color: 0x34383d, vertexColors: true });
  const hairMat = lib.clone('fabric', { color: 0x7d8277, roughness: 0.95, metalness: 0, vertexColors: true });
  hairMat.name = 'tomas_scan_hair';
  const mouthMat = lib.get('plastic_dark');
  const eyeSrc = tpl.rig.meshes.find((m) => m.key === 'eye')?.material as THREE.MeshStandardMaterial | undefined;
  const eyeMat = (eyeSrc ?? lib.clone('plastic_white', { vertexColors: true })).clone();
  eyeMat.color.setRGB(1, 1, 1); eyeMat.roughness = 0.3; eyeMat.envMapIntensity = 0.45; eyeMat.vertexColors = true;
  eyeMat.name = 'tomas_scan_eye';
  const lashMat = lib.clone('rubber', { color: 0xffffff, roughness: 0.85, metalness: 0, vertexColors: true, map: null, normalMap: null, roughnessMap: null, aoMap: null });
  lashMat.name = 'tomas_scan_lash';
  if (ctx.debug.verbose) console.log(`[enemies] Tomas scan head: scale ${s.toFixed(4)}, ${keep.length / 3} face tris, ${hIdx.length / 3} hair tris, ${(performance.now() - t0).toFixed(0)} ms`);
  return { face, lids, hair: hairGeo, collar, shirtMat, mouth: mouthG, eyes, lashes, lashMat, faceMat, hairMat, mouthMat, eyeMat, eyeOffL, eyeOffR };
}
