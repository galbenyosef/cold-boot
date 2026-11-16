/**
 * §8.8 (stage 3a) — Halvorsen's head: `public/models/halvorsen-head.glb` (MakeHuman CC0 data morphed to a heavy-set man
 * of ~58, see docs/ASSETS.md and src/enemies/dev/build-head2.mjs). Loaded once on level 3 (or by the dev harness);
 * on any failure his procedural fallback head (halvorsen.ts) stays.
 *
 * Unlike Tomas's scan, this head already has OPEN eye sockets with real lids and a socket lining, and a closed lip seam
 * with a mouth cavity behind it. At load it is fitted to his skeleton (a fixed offset — the template's bones were
 * placed on the GLB's landmarks) and rigged:
 *   • neck: below a seam (low at the throat, higher at the nape) the ragged bottom is pulled onto a clean column that
 *     fits inside the vest's stand-up collar, then trimmed;
 *   • lids: the upper lid (skin + the front of the socket lining) is weighted to `lid_*`, the lower lid to `lidlo_*`;
 *     both bones pivot at the eyeball centre, so rotating them slides the lids over the eyeball (blinks, fear, gaze);
 *   • mouth: every triangle of the lip band and of the front of the cavity belongs wholly to the upper (head) or the
 *     lower (jaw) side; seam vertices are duplicated, so the lips stay sealed at rest and part only when the jaw opens;
 *     deeper in, the cavity stretches (blended weights); the lower face (chin, jaw flesh) follows the jaw;
 *   • brows weighted to `brow_*` (worry / disbelief), the neck root blended to the neck bone;
 *   • new eyeballs (template, key 'eye') at the landmark centres, sized to sit just behind the lid margins; teeth.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GameContext } from '../../core/types';
import type { HumanTemplate } from './model';
import { HALV } from './halvorsen';

export interface Head2 {
  face: THREE.BufferGeometry;
  faceMat: THREE.Material;
  teeth: THREE.BufferGeometry;
  teethMat: THREE.Material;
  mouth: THREE.BufferGeometry;
  mouthMat: THREE.Material;
}

const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const SOCK_U = (768 - 120 + 12) / 768, MOUTH_U = (768 - 80 + 12) / 768;

export async function loadHalvorsenHead(ctx: GameContext, tpl: HumanTemplate, url = `${import.meta.env.BASE_URL}models/halvorsen-head.glb`): Promise<Head2> {
  const t0 = performance.now();
  const gltf = await new GLTFLoader().loadAsync(url);
  let src: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => { if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh; });
  if (!src) throw new Error('no mesh in head asset');
  const mesh = src as THREE.Mesh;
  const lm = (mesh.userData?.landmarks ?? (mesh.parent?.userData as any)?.landmarks) as Record<string, any> | undefined;
  const g = mesh.geometry as THREE.BufferGeometry;
  const srcMat = mesh.material as THREE.MeshStandardMaterial;
  const P0 = g.getAttribute('position').array as Float32Array, N0 = g.getAttribute('normal').array as Float32Array;
  const T = g.getAttribute('uv').array as Float32Array, I = g.getIndex()!.array;
  const nV = P0.length / 3;
  const off = HALV.glbOff;
  // the template's eye bones sit on these landmarks; warn if the asset moved
  if (lm?.eyeL && Math.hypot(lm.eyeL[0] - HALV.eyeL.x, lm.eyeL[1] - HALV.eyeL.y, lm.eyeL[2] + off.z - HALV.eyeL.z) > 0.002) console.warn('[enemies] Halvorsen head: eye landmarks differ from the template');
  const pos = new Float32Array(nV * 3), nrm = new Float32Array(N0);
  for (let i = 0; i < nV; i++) { pos[i * 3] = P0[i * 3] + off.x; pos[i * 3 + 1] = P0[i * 3 + 1] + off.y; pos[i * 3 + 2] = P0[i * 3 + 2] + off.z; }
  const isPatch = (i: number, u: number) => Math.abs(T[i * 2] - u) < 0.003 && T[i * 2 + 1] > 0.97;
  const sock = new Uint8Array(nV), cav = new Uint8Array(nV);
  for (let i = 0; i < nV; i++) { if (isPatch(i, SOCK_U)) sock[i] = 1; else if (isPatch(i, MOUTH_U)) cav[i] = 1; }

  // ── lip seam: y and z as functions of x (from the skin/cavity boundary vertices)
  const key = (i: number) => `${pos[i * 3].toFixed(5)},${pos[i * 3 + 1].toFixed(5)},${pos[i * 3 + 2].toFixed(5)}`;
  const cavKeys = new Set<string>(), sockKeys = new Set<string>();
  for (let i = 0; i < nV; i++) { if (cav[i]) cavKeys.add(key(i)); if (sock[i]) sockKeys.add(key(i)); }
  const seamPts: THREE.Vector3[] = [];
  const marginPts: THREE.Vector3[] = [];
  for (let i = 0; i < nV; i++) {
    if (cav[i] || sock[i]) continue;
    const k = key(i);
    if (cavKeys.has(k)) seamPts.push(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
    else if (sockKeys.has(k)) marginPts.push(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  }
  if (seamPts.length < 8) throw new Error('lip seam not found');
  let half = 0;
  for (const p of seamPts) half = Math.max(half, Math.abs(p.x));
  /** seam y / z at x (nearest seam samples, smoothed) */
  const seamAt = (x: number) => {
    let wy = 0, wz = 0, ws = 0;
    for (const p of seamPts) { const w = Math.exp(-((p.x - x) ** 2) / (2 * 0.004 ** 2)) + 1e-9; wy += p.y * w; wz += p.z * w; ws += w; }
    return { y: wy / ws, z: wz / ws };
  };
  const seamMid = seamAt(0);

  // ── neck: pull the ragged bottom onto a column inside the vest collar, trim it
  const NECK_LOW = 1.446, ncz = 0.0, nrx = 0.066, nrz = 0.058;
  for (let i = 0; i < nV; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const a = Math.atan2(x / nrx, (z - ncz) / nrz);
    const seam = 1.468 + 0.045 * sm(0.5, 1.7, Math.abs(a)); // throat … nape
    if (y >= seam) continue;
    const w = sm(seam, seam - 0.024, y);
    const tx = Math.sin(a) * nrx, tz = ncz + Math.cos(a) * nrz;
    pos[i * 3] = x + (tx - x) * w; pos[i * 3 + 2] = z + (tz - z) * w;
    pos[i * 3 + 1] = y + (Math.max(y, NECK_LOW) - y) * w;
    const nx = Math.sin(a) / nrx, nz = Math.cos(a) / nrz, nl = Math.hypot(nx, nz) || 1;
    nrm[i * 3] += (nx / nl - nrm[i * 3]) * w; nrm[i * 3 + 1] *= 1 - w; nrm[i * 3 + 2] += (nz / nl - nrm[i * 3 + 2]) * w;
    const ln = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
    nrm[i * 3] /= ln; nrm[i * 3 + 1] /= ln; nrm[i * 3 + 2] /= ln;
  }

  // ── bones
  const bi = new Map<string, number>();
  tpl.rig.bones.forEach((b, i) => bi.set(b.name, i));
  const B = (n: string) => { const v = bi.get(n); if (v === undefined) throw new Error('no bone ' + n); return v; };

  // ── weights
  const EYES = [{ c: HALV.eyeL, s: 'l' }, { c: HALV.eyeR, s: 'r' }] as const;
  // opening centre (x) and margins per eye from the margin loop
  const open = EYES.map(({ c }) => {
    let x0 = 1, x1 = -1, yTop = -1, yBot = 9;
    for (const p of marginPts) { if (Math.sign(p.x) !== Math.sign(c.x)) continue; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); yTop = Math.max(yTop, p.y); yBot = Math.min(yBot, p.y); }
    return { cx: (x0 + x1) / 2, hw: (x1 - x0) / 2, yTop, yBot, mid: (yTop + yBot) / 2 };
  });
  const browC = [new THREE.Vector3(0.031, 1.652, 0.112), new THREE.Vector3(-0.031, 1.652, 0.112)];
  const si = new Uint16Array(nV * 4), sw = new Float32Array(nV * 4);
  const jawW = (x: number, y: number, z: number) => {
    const s = seamAt(x), below = s.y - y, dx = Math.abs(x);
    if (below < 0.0006 && !(dx > half - 0.002 && below > -0.002)) return 0;
    const lat = 1 - sm(0.034, 0.078, dx);
    const deep = 1 - sm(0.045, 0.11, seamMid.z - z);
    const w = lat * (0.4 + 0.6 * deep) * (1 - sm(0.065, 0.11, below) * 0.4) * (below < 0.0006 ? 0.5 : 1);
    return Math.max(0, Math.min(1, w));
  };
  const setW = (i: number, ws: [number, number][]) => {
    ws.sort((p, q) => q[1] - p[1]);
    let tot = 0; for (let k = 0; k < 4 && k < ws.length; k++) tot += ws[k][1];
    for (let k = 0; k < 4; k++) { si[i * 4 + k] = k < ws.length ? ws[k][0] : 0; sw[i * 4 + k] = k < ws.length ? ws[k][1] / (tot || 1) : 0; }
  };
  for (let i = 0; i < nV; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const wn = (1 - sm(1.47, 1.535, y + 0.3 * Math.max(0, z))) * 0.8;
    let wj = 0;
    if (cav[i]) {
      // cavity: the front belongs to its lip (decided per triangle below); deeper it stretches
      const s = seamAt(x);
      wj = sm(s.y + 0.003, s.y - 0.012, y);
    } else wj = jawW(x, y, z);
    wj *= 1 - wn;
    // lids
    let wl = 0, wlo = 0, lidB = 'lid_l', lidLoB = 'lidlo_l';
    for (let e = 0; e < 2; e++) {
      const { c, s } = EYES[e], o = open[e];
      const dx = Math.abs(x - o.cx), dz = z - c.z;
      if (dz < -0.004 || dx > o.hw + 0.009) continue;
      const lat = 1 - sm(o.hw - 0.002, o.hw + 0.008, dx);
      if (y >= o.mid) {
        // upper lid: margin → crease (≈ 9 mm above the margin); the lining follows near the front
        const above = y - o.yTop;
        const k = lat * (1 - sm(0.0015, 0.0075, above)) * (sock[i] ? 1 - sm(0.0, 0.006, c.z + 0.012 - z) : 1);
        if (k > wl) { wl = k; lidB = 'lid_' + s; }
      } else {
        const below = o.yBot - y;
        const k = lat * (1 - sm(0.0015, 0.0065, below)) * 0.85 * (sock[i] ? 1 - sm(0.0, 0.006, c.z + 0.012 - z) : 1);
        if (k > wlo) { wlo = k; lidLoB = 'lidlo_' + s; }
      }
    }
    // brows
    let wb = 0, brow = 'brow_l';
    for (let e = 0; e < 2; e++) {
      const p = browC[e];
      const d = Math.hypot((x - p.x) / 0.032, (y - p.y) / 0.016, (z - p.z) / 0.03);
      const k = (1 - sm(0.35, 1, d)) * 0.9;
      if (k > wb) { wb = k; brow = e === 0 ? 'brow_l' : 'brow_r'; }
    }
    const rest = Math.max(0, 1 - wj - wn);
    wl *= rest; wlo *= rest * (1 - wl); wb *= Math.max(0, rest - wl - wlo);
    const wh = Math.max(0, 1 - wj - wn - wl - wlo - wb);
    setW(i, [[B('head'), wh], [B('jaw'), wj], [B('neck'), wn], [B(lidB), wl], [B(lidLoB), wlo], [B(brow), wb]]);
  }

  // ── triangles: trim the neck bottom; split the lips (and the front of the cavity) by side
  const xP = Array.from(pos), xN = Array.from(nrm), xT = Array.from(T), xSI = Array.from(si), xSW = Array.from(sw);
  const nX0 = nV;
  const dupJaw = new Map<number, number>(), dupHead = new Map<number, number>();
  const dup = (i: number, jaw: boolean): number => {
    const m = jaw ? dupJaw : dupHead;
    let j = m.get(i);
    if (j !== undefined) return j;
    j = xP.length / 3;
    xP.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); xN.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]); xT.push(T[i * 2], T[i * 2 + 1]);
    // the lower lip opens fully in the middle; toward the corners it stays with the upper lip (corners barely part)
    const wj = 1 - 0.9 * sm(half * 0.45, half + 0.002, Math.abs(pos[i * 3]));
    if (jaw) { xSI.push(B('jaw'), B('head'), 0, 0); xSW.push(wj, 1 - wj, 0, 0); } else { xSI.push(B('head'), 0, 0, 0); xSW.push(1, 0, 0, 0); }
    m.set(i, j);
    return j;
  };
  const keep: number[] = [];
  for (let t = 0; t < I.length; t += 3) {
    const ids = [I[t], I[t + 1], I[t + 2]];
    const ys = ids.map((i) => pos[i * 3 + 1]);
    if (Math.max(...ys) < NECK_LOW + 0.002) continue;
    const cx = (pos[ids[0] * 3] + pos[ids[1] * 3] + pos[ids[2] * 3]) / 3, cy = (ys[0] + ys[1] + ys[2]) / 3;
    const cz = (pos[ids[0] * 3 + 2] + pos[ids[1] * 3 + 2] + pos[ids[2] * 3 + 2]) / 3;
    const s = seamAt(cx);
    const inBand = Math.abs(cx) < half + 0.004 && Math.abs(cy - s.y) < 0.012 && cz > s.z - 0.022;
    if (inBand) {
      const lower = cy < s.y;
      for (let k = 0; k < 3; k++) {
        const i = ids[k], y = pos[i * 3 + 1], sy = seamAt(pos[i * 3]).y;
        if (lower && y >= sy - 0.0005) ids[k] = dup(i, true);
        else if (!lower && y < sy - 0.0005) ids[k] = dup(i, false);
        else if (cav[i] && Math.abs(y - sy) < 0.004) ids[k] = dup(i, lower); // cavity front ring: rigid with its lip
      }
    }
    keep.push(ids[0], ids[1], ids[2]);
  }
  void nX0;
  // ── vertex tint (multiplies the colour map): lash line + contact shadow at the lid margins, a little socket shade
  const nX = xP.length / 3;
  const col = new Float32Array(nX * 3).fill(1);
  for (let i = 0; i < nX; i++) {
    const x = xP[i * 3], y = xP[i * 3 + 1], z = xP[i * 3 + 2];
    let r = 1, gg = 1, b = 1;
    for (let e = 0; e < 2; e++) {
      const o = open[e], c = EYES[e].c;
      if (z < c.z - 0.006) continue;
      const dx = (x - o.cx) / (o.hw + 0.003);
      if (Math.abs(dx) > 1.3) continue;
      const top = o.yTop - 0.0012 * dx * dx, bot = o.yBot + 0.0015 * dx * dx;
      // upper lash line: dark, right at the margin; lower margin thinner and warmer
      const du = y - top, dl = bot - y;
      const lash = (1 - sm(0.0, 0.0022, Math.abs(du))) * (1 - sm(0.9, 1.25, Math.abs(dx)));
      const low = (1 - sm(0.0, 0.0012, Math.abs(dl))) * (1 - sm(0.85, 1.2, Math.abs(dx))) * 0.5;
      r -= 0.55 * lash + 0.25 * low; gg -= 0.6 * lash + 0.3 * low; b -= 0.58 * lash + 0.28 * low;
      // the shade inside the upper lid crease
      const crease = (1 - sm(0.3, 1.1, Math.hypot(dx, (y - top - 0.008) / 0.004))) * 0.12;
      r -= crease; gg -= crease * 1.1; b -= crease;
    }
    col[i * 3] = Math.max(0.12, r); col[i * 3 + 1] = Math.max(0.1, gg); col[i * 3 + 2] = Math.max(0.1, b);
  }
  const face = new THREE.BufferGeometry();
  face.setAttribute('position', new THREE.Float32BufferAttribute(xP, 3));
  face.setAttribute('normal', new THREE.Float32BufferAttribute(xN, 3));
  face.setAttribute('uv', new THREE.Float32BufferAttribute(xT, 2));
  face.setAttribute('color', new THREE.BufferAttribute(col, 3));
  face.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(xSI, 4));
  face.setAttribute('skinWeight', new THREE.Float32BufferAttribute(xSW, 4));
  face.setIndex(keep);
  face.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.6, 0), 0.35);

  // ── teeth: a hint of upper and lower incisors behind the lips (seen only when he speaks)
  const teethParts: THREE.BufferGeometry[] = [];
  for (const [lower, bone] of [[false, 'head'], [true, 'jaw']] as const) {
    const arc = new THREE.CylinderGeometry(0.024, 0.024, lower ? 0.006 : 0.008, 32, 1, true, -0.8, 1.6);
    arc.scale(1, 1, 0.75);
    arc.translate(0, seamMid.y + (lower ? -0.0062 : 0.0028), seamMid.z - 0.0125 - 0.024 * 0.75);
    const tp = arc.getAttribute('position');
    const tc = new Float32Array(tp.count * 3), tsi = new Uint16Array(tp.count * 4), tsw = new Float32Array(tp.count * 4);
    for (let i = 0; i < tp.count; i++) {
      const side = Math.abs(tp.getX(i)) / 0.024;
      const k = (lower ? 0.55 : 0.68) * (1 - 0.6 * side) * (0.75 + 0.25 * Math.abs(Math.cos(tp.getX(i) * 520)));
      tc[i * 3] = k; tc[i * 3 + 1] = k * 0.95; tc[i * 3 + 2] = k * 0.82;
      tsi[i * 4] = B(bone); tsw[i * 4] = 1;
    }
    arc.setAttribute('color', new THREE.BufferAttribute(tc, 3));
    arc.setAttribute('skinIndex', new THREE.BufferAttribute(tsi, 4));
    arc.setAttribute('skinWeight', new THREE.BufferAttribute(tsw, 4));
    arc.deleteAttribute('uv');
    teethParts.push(arc.toNonIndexed());
  }
  const teeth = mergeGeometries(teethParts)!;
  teeth.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.6, 0), 0.35);
  // dark back of the mouth (behind the cavity lining: nothing shows through if a gap opens)
  const mouth = new THREE.SphereGeometry(1, 14, 10);
  mouth.scale(half * 0.8, 0.016, 0.022);
  mouth.translate(0, seamMid.y - 0.003, seamMid.z - 0.04);
  {
    const mp = mouth.getAttribute('position');
    const msi = new Uint16Array(mp.count * 4), msw = new Float32Array(mp.count * 4);
    for (let i = 0; i < mp.count; i++) { msi[i * 4] = mp.getY(i) < seamMid.y - 0.003 ? B('jaw') : B('head'); msw[i * 4] = 1; }
    mouth.setAttribute('skinIndex', new THREE.BufferAttribute(msi, 4));
    mouth.setAttribute('skinWeight', new THREE.BufferAttribute(msw, 4));
    mouth.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.6, 0), 0.35);
  }

  // ── materials (through the library)
  const lib = ctx.materials;
  const faceMat = lib.clone('plastic_white', {
    color: 0xe6d6cc, map: srcMat.map, normalMap: srcMat.normalMap, normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.66, metalness: 0, roughnessMap: null, metalnessMap: null, aoMap: null, vertexColors: true,
    emissive: 0xffd2b8, emissiveMap: srcMat.map, emissiveIntensity: 0.025, envMapIntensity: 0.4,
  });
  faceMat.name = 'halv_head_skin';
  const teethMat = lib.clone('plastic_white', { color: 0xffffff, roughness: 0.35, metalness: 0, vertexColors: true, map: null, normalMap: null, roughnessMap: null, metalnessMap: null, aoMap: null });
  teethMat.name = 'halv_teeth';
  const mouthMat = lib.get('plastic_dark');
  if (ctx.debug.verbose) console.log(`[enemies] Halvorsen head: ${keep.length / 3} tris, lip seam ${seamPts.length} verts (dup ${dupJaw.size}+${dupHead.size}), margins ${marginPts.length}, ${(performance.now() - t0).toFixed(0)} ms`);
  return { face, faceMat, teeth, teethMat, mouth, mouthMat };
}
