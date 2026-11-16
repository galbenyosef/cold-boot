#!/usr/bin/env node
/**
 * Dev tool (not part of the game bundle): builds Halvorsen's head asset `public/models/halvorsen-head.glb`.
 *
 * Source (all CC0 1.0, see docs/ASSETS.md → "Halvorsen's head"):
 *   • MakeHuman 1.x base mesh hm08 + morph targets — https://github.com/makehumancommunity/makehuman
 *       makehuman/data/3dobjs/base.obj, makehuman/data/targets/<group>/<name>.target   (licence: LICENSE.ASSETS.md)
 *   • MakeHuman system asset pack (skins, eyebrows) —
 *       https://mirror1.makehuman.net/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
 *       skins/old_caucasian_male/old_lightskinned_male_diffuse.png, eyebrows/eyebrow009/*
 *   No MakeHuman program code is used: this script reads the CC0 data files itself (OBJ, .target = "vertex dx dy dz"
 *   lines, .mhclo = proxy fitting, three body verts + weights + offset).
 *
 * Inputs (plain anonymous downloads, each into its own empty directory; never run anything from inside them):
 *   mhrepo/:  curl -O https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/3dobjs/base.obj
 *             mkdir t; for each target <group>/<name> used in TARGETS below:
 *             curl -o t/<name>.target https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/targets/<group>/<name>.target
 *             (groups: macrodetails, head, nose, chin, neck, eyes, mouth, forehead, eyebrows, cheek, ears)
 *   mhsys/:   curl -o sys.zip https://mirror1.makehuman.net/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
 *             unzip sys.zip 'skins/old_caucasian_male/*' 'eyebrows/eyebrow009/*' 'packs/*' -d x     (→ pass mhsys/x)
 * Usage: node src/enemies/dev/build-head2.mjs <mhrepo> <mhsys/x> <workdir> public/models/halvorsen-head.glb
 *   (needs ImageMagick 7 `magick` on PATH; intermediate images go to <workdir>)
 *
 * What it does:
 *   1. hm08 body mesh, morphed: male, ~58 years (age slider 0.754), caucasian, a little heavy, plus face targets
 *      (broader square face, heavier jaw and double chin, longer heavier nose, eye bags, mouth corners down, lower
 *      brows, bigger ears) — see TARGETS.
 *   2. keeps the head + neck (body faces above the clavicles; the bottom edge is ragged, the game trims it at the
 *      collar), drops the rest of the body and the helper geometry (eyeballs, teeth, tongue, lashes) — the game makes
 *      its own eyeballs / mouth interior. The eyes are OPEN sockets (hm08 lids, no closed-lid surface) and the lips
 *      are a closed seam with a short mouth-cavity lining behind them. One Catmull–Clark step on the skin (socket
 *      linings + mouth cavity untouched, their shared edges fixed), quads split on the short diagonal, smooth normals
 *      averaged per position across UV seams.
 *   3. colour map 768×1280: the head island of the CC0 "old caucasian male" skin (top 1120 rows) + the throat strip
 *      MakeHuman maps on the torso island (below) + two flat patches (socket lining, mouth cavity). Scalp hair greyed
 *      and thinned to bare scalp at the crown/temples, brown sideburn fringe removed, stubble greyed, red eyelid cast
 *      removed, slight ruddiness on nose/cheeks, saturation −20 %; eyebrow009 fitted from its .mhclo and baked in grey.
 *      Normal map: derived from the colour map's fine detail (height = high-passed luminance), glTF/OpenGL green-up.
 *   4. writes one GLB (metres, y up, face toward +z, the full body's feet at y = 0) with `extras.landmarks` on the node:
 *      eye centres + eyeball radius (hm08 helper eyes), the eye openings and the lip seam (bounding boxes of the
 *      skin/socket and skin/mouth boundary loops), and hm08 joint centroids (jaw, mouth, head, head2, neck, lids).
  */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [mhrepo, mhsys, work, out] = process.argv.slice(2);
if (!mhrepo || !mhsys || !work || !out) { console.error('usage: build-head2.mjs <mhrepo> <mhsys> <workdir> <out.glb>'); process.exit(1); }
fs.mkdirSync(work, { recursive: true });

// ── morph targets (name → weight). Macro: age 0.754 (MakeHuman: 0.5 = 25 y, 1.0 = 90 y → 58 y), weight 0.68.
const AGE_OLD = 0.508, AGE_YOUNG = 1 - AGE_OLD, FAT = 0.36;
const TARGETS = {
  'caucasian-male-young': AGE_YOUNG, 'caucasian-male-old': AGE_OLD,
  'universal-male-young-averagemuscle-maxweight': AGE_YOUNG * FAT, 'universal-male-old-averagemuscle-maxweight': AGE_OLD * FAT,
  'head-age-incr': 0.5, 'head-fat-incr': 0.35, 'head-square': 0.45, 'head-rectangular': 0.2,
  'nose-scale-vert-incr': 0.35, 'nose-volume-incr': 0.35, 'nose-point-down': 0.3, 'nose-hump-incr': 0.25, 'nose-width2-incr': 0.2,
  'chin-width-incr': 0.4, 'chin-height-incr': 0.15, 'chin-bones-incr': 0.35, 'chin-prominent-incr': 0.1,
  'neck-double-incr': 0.45, 'neck-scale-horiz-incr': 0.3,
  'l-eye-bag-incr': 0.55, 'r-eye-bag-incr': 0.55, 'l-eye-height2-decr': 0.25, 'r-eye-height2-decr': 0.25,
  'l-eye-scale-decr': 0.15, 'r-eye-scale-decr': 0.15,
  'mouth-angles-down': 0.35, 'mouth-laugh-lines-out': 0.4, 'mouth-upperlip-volume-decr': 0.35, 'mouth-lowerlip-volume-decr': 0.15,
  'mouth-scale-horiz-incr': 0.15,
  'forehead-temple-decr': 0.2, 'forehead-scale-vert-incr': 0.25,
  'eyebrows-trans-down': 0.25, 'eyebrows-angle-down': 0.2,
  'l-cheek-volume-incr': 0.2, 'r-cheek-volume-incr': 0.2, 'l-cheek-trans-down': 0.35, 'r-cheek-trans-down': 0.35,
  'l-cheek-bones-decr': 0.15, 'r-cheek-bones-decr': 0.15,
  'l-ear-scale-incr': 0.25, 'r-ear-scale-incr': 0.25, 'l-ear-lobe-incr': 0.3, 'r-ear-lobe-incr': 0.3,
};

// ── OBJ
const objTxt = fs.readFileSync(path.join(mhrepo, 'base.obj'), 'utf8');
const V = [], VT = [], faces = []; // faces: { g, v: [], t: [] }
const groupVerts = new Map();
let g = '';
for (const line of objTxt.split('\n')) {
  if (line.startsWith('v ')) { const p = line.split(/\s+/); V.push(+p[1], +p[2], +p[3]); }
  else if (line.startsWith('vt ')) { const p = line.split(/\s+/); VT.push(+p[1], +p[2]); }
  else if (line.startsWith('g ')) g = line.slice(2).trim();
  else if (line.startsWith('f ')) {
    const p = line.trim().split(/\s+/).slice(1);
    const f = { g, v: p.map((s) => +s.split('/')[0] - 1), t: p.map((s) => +s.split('/')[1] - 1) };
    faces.push(f);
    if (!groupVerts.has(g)) groupVerts.set(g, new Set());
    for (const i of f.v) groupVerts.get(g).add(i);
  }
}
const nV0 = V.length / 3;
// ── targets
for (const [name, w] of Object.entries(TARGETS)) {
  const file = path.join(mhrepo, 't', `${name}.target`);
  if (!fs.existsSync(file)) throw new Error('missing target ' + file);
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    const i = +p[0];
    V[i * 3] += +p[1] * w; V[i * 3 + 1] += +p[2] * w; V[i * 3 + 2] += +p[3] * w;
  }
}
// ── to metres, feet on the ground
let minY = Infinity;
for (const f of faces) if (f.g === 'body') for (const i of f.v) minY = Math.min(minY, V[i * 3 + 1]);
for (let i = 0; i < nV0; i++) { V[i * 3] *= 0.1; V[i * 3 + 1] = (V[i * 3 + 1] - minY) * 0.1; V[i * 3 + 2] *= 0.1; }
const centroid = (gname) => {
  const s = groupVerts.get(gname); if (!s) throw new Error('no group ' + gname);
  const c = [0, 0, 0]; for (const i of s) for (let k = 0; k < 3; k++) c[k] += V[i * 3 + k];
  return c.map((x) => x / s.size);
};
const r3 = (a) => a.map((x) => Math.round(x * 1e5) / 1e5);
const eyeL = centroid('helper-l-eye'), eyeR = centroid('helper-r-eye');
let eyeRad = 0; for (const i of groupVerts.get('helper-l-eye')) eyeRad = Math.max(eyeRad, Math.hypot(V[i * 3] - eyeL[0], V[i * 3 + 1] - eyeL[1], V[i * 3 + 2] - eyeL[2]));
const clav = centroid('joint-l-clavicle');
const LMK = {
  eyeL: r3(eyeL), eyeR: r3(eyeR), eyeRadius: Math.round(eyeRad * 1e5) / 1e5,
  jaw: r3(centroid('joint-jaw')), mouth: r3(centroid('joint-mouth')), head: r3(centroid('joint-head')), head2: r3(centroid('joint-head-2')),
  neck: r3(centroid('joint-neck')), lowerlidL: r3(centroid('joint-l-lowerlid')), upperlidL: r3(centroid('joint-l-upperlid')),
  lowerlidR: r3(centroid('joint-r-lowerlid')), upperlidR: r3(centroid('joint-r-upperlid')),
};

// ── head + neck selection: body faces whose vertices are all above the cut (a little above the clavicles)
const yCut = clav[1] + 0.035;
const keepF = faces.filter((f) => f.g === 'body' && f.v.every((i) => V[i * 3 + 1] > yCut && Math.abs(V[i * 3]) < 0.11));
// ── UV islands: the head island (right of the atlas) is cropped; the eye-socket linings (left red ovals), the mouth
// interior (bottom-right red) and any neck faces from the torso island get flat colour patches instead
const island = (f) => {
  const u = f.t.reduce((s, t) => s + VT[t * 2], 0) / f.t.length, v = f.t.reduce((s, t) => s + VT[t * 2 + 1], 0) / f.t.length;
  if (u < 0.2 && v > 0.5 && v < 0.7) return 'socket';
  if (v < 0.13 && u > 0.7) return 'mouth';
  if (u < 0.6) return 'neck';
  return 'head';
};
const bboxOf = (name) => {
  let u0 = 1, u1 = 0, w0 = 1, w1 = 0;
  for (const f of keepF) if (island(f) === name) for (const t of f.t) { u0 = Math.min(u0, VT[t * 2]); u1 = Math.max(u1, VT[t * 2]); w0 = Math.min(w0, VT[t * 2 + 1]); w1 = Math.max(w1, VT[t * 2 + 1]); }
  const x0 = Math.max(0, Math.floor(u0 * TEX) - PAD), x1 = Math.min(TEX, Math.ceil(u1 * TEX) + PAD);
  const y0 = Math.max(0, Math.floor((1 - w1) * TEX) - PAD), y1 = Math.min(TEX, Math.ceil((1 - w0) * TEX) + PAD);
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
};
const TEX = 2048, PAD = 6;
// output atlas SW × SH: the head island fills the top (≈ 1:1 texel scale with the 2048² source), the throat/front-neck
// faces (which MakeHuman maps on the torso island) a strip below it, three flat patches in the bottom-right corner
const SW = 768, SH = 1280, HEAD_H = 1120;
const HB = bboxOf('head'), NB = bboxOf('neck');
const NSC = Math.min(SW * 0.72 / NB.w, (SH - HEAD_H - 8) / NB.h), NW = Math.round(NB.w * NSC), NH = Math.round(NB.h * NSC);
const atlas = (isl, u, v) => {
  const b = isl === 'neck' ? NB : HB;
  const fx = (u * TEX - b.x0) / b.w, fy = ((1 - v) * TEX - b.y0) / b.h;
  return isl === 'neck' ? [(fx * NW) / SW, (HEAD_H + 4 + fy * NH) / SH] : [fx, (fy * HEAD_H) / SH];
};
// flat patches (texel rects, painted after the colour work)
const PATCH = { socket: [SW - 120, SH - 40], mouth: [SW - 80, SH - 40] };
const cornerUV = (t, isl) => PATCH[isl] ? [(PATCH[isl][0] + 12) / SW, (PATCH[isl][1] + 12) / SH] : atlas(isl, VT[t * 2], VT[t * 2 + 1]);
// polygons with per-corner uvs
let polys = keepF.map((f) => { const isl = island(f); return { isl, v: f.v.slice(), uv: f.t.map((t) => cornerUV(t, isl)) }; });
const islandCount = {}; for (const p of polys) islandCount[p.isl] = (islandCount[p.isl] ?? 0) + 1;
// ── one Catmull–Clark step on the skin (head island + neck), uvs linear. The eye-socket linings and the mouth
// interior stay as they are; the edges they share with the skin are treated as fixed boundaries (no cracks).
{
  const sub = polys.filter((p) => p.isl === 'head' || p.isl === 'neck');
  const rest = polys.filter((p) => !(p.isl === 'head' || p.isl === 'neck'));
  const ek = (a, b) => (a < b ? a * 1e6 + b : b * 1e6 + a);
  const edges = new Map();
  sub.forEach((p, fi) => p.v.forEach((a, k) => { const b = p.v[(k + 1) % p.v.length]; const e = ek(a, b); if (!edges.has(e)) edges.set(e, { a, b, f: [] }); edges.get(e).f.push(fi); }));
  const at = (i) => [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]];
  const add = (q, w, r) => { r[0] += q[0] * w; r[1] += q[1] * w; r[2] += q[2] * w; return r; };
  const fp = sub.map((p) => { const c = [0, 0, 0]; for (const i of p.v) add(at(i), 1 / p.v.length, c); return c; });
  const NV = [...V];
  const newVert = (q) => { NV.push(q[0], q[1], q[2]); return NV.length / 3 - 1; };
  const fId = fp.map(newVert);
  const eId = new Map(), boundaryV = new Set();
  for (const [e, E] of edges) {
    let q;
    if (E.f.length === 2) { q = [0, 0, 0]; add(at(E.a), 0.25, q); add(at(E.b), 0.25, q); add(fp[E.f[0]], 0.25, q); add(fp[E.f[1]], 0.25, q); }
    else { q = add(at(E.a), 0.5, add(at(E.b), 0.5, [0, 0, 0])); boundaryV.add(E.a); boundaryV.add(E.b); }
    eId.set(e, newVert(q));
  }
  // also fixed: vertices used by the untouched faces
  for (const p of rest) for (const i of p.v) boundaryV.add(i);
  const vf = new Map(), ve = new Map();
  sub.forEach((p, fi) => p.v.forEach((a) => { if (!vf.has(a)) vf.set(a, []); vf.get(a).push(fi); }));
  for (const [, E] of edges) for (const a of [E.a, E.b]) { if (!ve.has(a)) ve.set(a, []); ve.get(a).push(E); }
  for (const [vtx, fl] of vf) {
    if (boundaryV.has(vtx)) continue;
    const n = fl.length, F = [0, 0, 0], R = [0, 0, 0];
    for (const fi of fl) add(fp[fi], 1 / n, F);
    const el = ve.get(vtx);
    for (const E of el) { add(at(E.a), 0.5 / el.length, R); add(at(E.b), 0.5 / el.length, R); }
    const P0 = at(vtx);
    for (let k = 0; k < 3; k++) NV[vtx * 3 + k] = (F[k] + 2 * R[k] + (n - 3) * P0[k]) / n;
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const out = [];
  sub.forEach((p, fi) => {
    const k = p.v.length, cu = [0, 0]; for (const u of p.uv) { cu[0] += u[0] / k; cu[1] += u[1] / k; }
    for (let i = 0; i < k; i++) {
      const pi = (i + k - 1) % k, ni = (i + 1) % k;
      out.push({ isl: p.isl, v: [p.v[i], eId.get(ek(p.v[i], p.v[ni])), fId[fi], eId.get(ek(p.v[pi], p.v[i]))],
        uv: [p.uv[i], mid(p.uv[i], p.uv[ni]), cu, mid(p.uv[pi], p.uv[i])] });
    }
  });
  V.length = 0; V.push(...NV);
  polys = [...out, ...rest];
}
// ── landmarks from the topology: the lip seam = the loop shared by skin and mouth interior; the eye openings = the
// loops shared by skin and socket linings (boundary vertices were kept fixed by the subdivision)
{
  const used = (isl) => { const st = new Set(); for (const p of polys) if (p.isl === isl) for (const i of p.v) st.add(i); return st; };
  const skinV = new Set([...used('head'), ...used('neck')]);
  const box = (st) => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const i of st) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], V[i * 3 + k]); mx[k] = Math.max(mx[k], V[i * 3 + k]); } return { min: r3(mn), max: r3(mx) }; };
  const lip = new Set([...used('mouth')].filter((i) => skinV.has(i)));
  const sock = [...used('socket')].filter((i) => skinV.has(i));
  LMK.lipSeam = box(lip);
  LMK.eyeOpeningL = box(new Set(sock.filter((i) => V[i * 3] > 0)));
  LMK.eyeOpeningR = box(new Set(sock.filter((i) => V[i * 3] < 0)));
}
// ── vertices split per (position, uv) pair
const key = new Map(); const P = [], UV = [], src = []; const idx = [];
const vid = (v, uv) => {
  const k = `${v}|${Math.round(uv[0] * 1e6)}|${Math.round(uv[1] * 1e6)}`; let j = key.get(k);
  if (j === undefined) { j = src.length; key.set(k, j); src.push(v); P.push(V[v * 3], V[v * 3 + 1], V[v * 3 + 2]); UV.push(uv[0], uv[1]); }
  return j;
};
for (const p of polys) {
  const ids = p.v.map((v, k) => vid(v, p.uv[k]));
  // split quads along the shorter diagonal
  if (ids.length === 4) {
    const d = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
    if (d(ids[0], ids[2]) <= d(ids[1], ids[3])) idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    else idx.push(ids[0], ids[1], ids[3], ids[1], ids[2], ids[3]);
  } else for (let k = 1; k + 1 < ids.length; k++) idx.push(ids[0], ids[k], ids[k + 1]);
}
// ── smooth normals per original vertex (seamless across UV splits)
const acc = new Float64Array(V.length);
for (let t = 0; t < idx.length; t += 3) {
  const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
  const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
  const e1 = [P[b * 3] - ax, P[b * 3 + 1] - ay, P[b * 3 + 2] - az], e2 = [P[c * 3] - ax, P[c * 3 + 1] - ay, P[c * 3 + 2] - az];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  for (const i of [a, b, c]) for (let k = 0; k < 3; k++) acc[src[i] * 3 + k] += n[k];
}
const NRM = [];
for (let i = 0; i < src.length; i++) {
  const o = src[i] * 3, l = Math.hypot(acc[o], acc[o + 1], acc[o + 2]) || 1;
  NRM.push(acc[o] / l, acc[o + 1] / l, acc[o + 2] / l);
}

// ── eyebrows (mhclo proxy): fitted onto the morphed body, then baked into the skin crop
function fitProxy(dir, name) {
  const objP = fs.readFileSync(path.join(dir, `${name}.obj`), 'utf8');
  const pv = [], pvt = [], pf = [];
  for (const line of objP.split('\n')) {
    if (line.startsWith('vt ')) { const p = line.split(/\s+/); pvt.push(+p[1], +p[2]); }
    else if (line.startsWith('v ')) { const p = line.split(/\s+/); pv.push(+p[1], +p[2], +p[3]); }
    else if (line.startsWith('f ')) { const p = line.trim().split(/\s+/).slice(1); pf.push({ v: p.map((s) => +s.split('/')[0] - 1), t: p.map((s) => +s.split('/')[1] - 1) }); }
  }
  const lines = fs.readFileSync(path.join(dir, `${name}.mhclo`), 'utf8').split('\n');
  const refs = [];
  let inVerts = false;
  for (const line of lines) {
    if (line.startsWith('verts')) { inVerts = true; continue; }
    if (!inVerts) continue;
    const p = line.trim().split(/\s+/).map(Number);
    if (p.length === 9 && p.every((x) => Number.isFinite(x))) refs.push(p);
    else if (p.length === 1 && Number.isFinite(p[0]) && line.trim()) refs.push([p[0], p[0], p[0], 1, 0, 0, 0, 0, 0]);
    else if (line.trim() && !/^[-\d]/.test(line.trim())) inVerts = false;
  }
  return { pv, pvt, pf, refs };
}
const BODY_UV = new Map(); // body vertex → a uv (first seen, body group)
for (const f of faces) if (f.g === 'body') f.v.forEach((v, k) => { if (!BODY_UV.has(v)) BODY_UV.set(v, [VT[f.t[k] * 2], VT[f.t[k] * 2 + 1]]); });

// ── colour map
const skinPng = path.join(mhsys, 'skins/old_caucasian_male/old_lightskinned_male_diffuse.png');
const crop = path.join(work, 'crop.png');
execFileSync('magick', ['-size', `${SW}x${SH}`, 'xc:#d9b49c',
  '(', skinPng, '-crop', `${HB.w}x${HB.h}+${HB.x0}+${HB.y0}`, '+repage', '-resize', `${SW}x${HEAD_H}!`, ')', '-geometry', '+0+0', '-composite',
  '(', skinPng, '-crop', `${NB.w}x${NB.h}+${NB.x0}+${NB.y0}`, '+repage', '-resize', `${NW}x${NH}!`, ')', '-geometry', `+0+${HEAD_H + 4}`, '-composite', crop]);
// raw RGBA buffers
const readRGBA = (file, w, h) => execFileSync('magick', [file, '-resize', `${w}x${h}!`, '-depth', '8', 'RGBA:-'], { maxBuffer: 1 << 28 });
const writeRGB = (buf, w, h, file, q) => execFileSync('magick', ['-size', `${w}x${h}`, '-depth', '8', 'RGBA:-', '-alpha', 'off', '-quality', String(q), file], { input: buf, maxBuffer: 1 << 28 });
const col = readRGBA(crop, SW, SH);
// uv (crop space) of every kept vertex → per-texel region masks via triangle rasterisation
const raster = (tri, cb) => {
  const [p0, p1, p2] = tri;
  const xs = [p0[0], p1[0], p2[0]], ys = [p0[1], p1[1], p2[1]];
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(SW - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(SH - 1, Math.ceil(Math.max(...ys)));
  const d = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1]);
  if (Math.abs(d) < 1e-9) return;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const l0 = ((p1[1] - p2[1]) * (px - p2[0]) + (p2[0] - p1[0]) * (py - p2[1])) / d;
    const l1 = ((p2[1] - p0[1]) * (px - p2[0]) + (p0[0] - p2[0]) * (py - p2[1])) / d;
    const l2 = 1 - l0 - l1;
    if (l0 < -0.02 || l1 < -0.02 || l2 < -0.02) continue;
    cb(x, y, l0, l1, l2);
  }
};
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const eyeMid = [(eyeL[0] + eyeR[0]) / 2, (eyeL[1] + eyeR[1]) / 2, (eyeL[2] + eyeR[2]) / 2];
const headC = [0, eyeMid[1] + 0.01, eyeMid[2] - 0.09];
// per-vertex weights: [receded crown, receding temples, stubble, forehead (skin sample), ruddiness, scalp hair zone]
const hairLine = (a) => { // hairline height above eye level by angle round the head (0 front, π back)
  const k = [[0, 0.07], [0.6, 0.068], [0.95, 0.03], [1.15, 0.0], [1.35, 0.005], [1.6, 0.03], [1.9, -0.02], [2.4, -0.07], [Math.PI, -0.085]];
  let j = 0; while (j < k.length - 2 && a > k[j + 1][0]) j++;
  return k[j][1] + (k[j + 1][1] - k[j][1]) * sm(k[j][0], k[j + 1][0], a);
};
const vW = (i) => {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  const a = Math.abs(Math.atan2(x - headC[0], z - headC[2])); // 0 front, π back
  const up = y - eyeMid[1];
  const crown = sm(0.075, 0.115, up) * (1 - sm(1.7, 2.5, a)); // receded front/top: thin, scalp shows
  const temple = sm(0.04, 0.07, up) * sm(0.45, 0.8, a) * (1 - sm(1.15, 1.5, a)); // receding temples
  const stub = sm(LMK.mouth[1] + 0.035, LMK.mouth[1] - 0.005, y) * (1 - sm(0.9, 1.5, a)) + sm(0.025, -0.01, up - (LMK.mouth[1] - eyeMid[1]) ) * 0;
  const fore = sm(0.035, 0.045, up) * (1 - sm(0.06, 0.07, up)) * (1 - sm(0.2, 0.35, a));
  const nose = Math.exp(-((x / 0.012) ** 2 + ((y - (eyeMid[1] - 0.035)) / 0.02) ** 2)) * sm(eyeMid[2] - 0.005, eyeMid[2] + 0.03, z);
  const cheek = Math.exp(-(((Math.abs(x) - 0.042) / 0.018) ** 2 + ((y - (eyeMid[1] - 0.035)) / 0.018) ** 2)) * (1 - sm(0.9, 1.3, a));
  const hairZ = sm(-0.01, 0.004, up - hairLine(a));
  const fringe = sm(-0.035, -0.008, up - hairLine(a)) * (1 - hairZ) * sm(0.5, 0.9, a); // the source's brown sideburn / nape fringe
  const lid = Math.max(...[eyeL, eyeR].map((e) => Math.exp(-(((x - e[0]) / 0.022) ** 2 + ((y - e[1] - 0.002) / 0.014) ** 2)))) * (1 - sm(0.7, 1.1, a));
  return [crown, temple, Math.min(1, Math.max(0, stub)), fore, Math.min(1, nose + cheek * 0.8), hairZ, lid, fringe];
};
const NCH = 9;
const region = new Float32Array(SW * SH * NCH); // 6 weights + coverage
for (let t = 0; t < idx.length; t += 3) {
  const ids = [idx[t], idx[t + 1], idx[t + 2]];
  if (ids.some((i) => UV[i * 2] * SW > SW - 130 && UV[i * 2 + 1] * SH > SH - 50)) continue; // flat patches
  const tri = ids.map((i) => [UV[i * 2] * SW, UV[i * 2 + 1] * SH]);
  const w = ids.map(vW);
  raster(tri, (x, y, l0, l1, l2) => {
    const o = (y * SW + x) * NCH;
    for (let k = 0; k < NCH - 1; k++) region[o + k] = w[0][k] * l0 + w[1][k] * l1 + w[2][k] * l2;
    region[o + NCH - 1] = 1;
  });
}
const blur = (src, w, h, r) => {
  const tmp = new Float32Array(w * h), dst = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { tmp[y * w + x] = s / (2 * r + 1); s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { dst[y * w + x] = s / (2 * r + 1); s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  return dst;
};
const chan = (k) => { const c = new Float32Array(SW * SH); for (let i = 0; i < SW * SH; i++) c[i] = col[i * 4 + k]; return c; };
const L = new Float32Array(SW * SH); for (let i = 0; i < SW * SH; i++) L[i] = 0.299 * col[i * 4] + 0.587 * col[i * 4 + 1] + 0.114 * col[i * 4 + 2];
const Lb = blur(L, SW, SH, 5);
const Cb = [blur(chan(0), SW, SH, 8), blur(chan(1), SW, SH, 8), blur(chan(2), SW, SH, 8)];
// forehead skin = the scalp colour under thinning hair
const skin = [0, 0, 0]; { let n = 0; for (let i = 0; i < SW * SH; i++) { const w = region[i * NCH + 3]; if (w > 0.5) { for (let k = 0; k < 3; k++) skin[k] += col[i * 4 + k]; n++; } } for (let k = 0; k < 3; k++) skin[k] /= n || 1; }
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const o = (y * SW + x) * 4, i = y * SW + x, ro = i * NCH;
  if (!region[ro + NCH - 1]) continue;
  const crown = region[ro], temple = region[ro + 1], stub = region[ro + 2], ruddy = region[ro + 4], hairZ = region[ro + 5], lid = region[ro + 6], fringe = region[ro + 7];
  let r = col[o], gg = col[o + 1], b = col[o + 2];
  const dark = Math.max(0, Lb[i] - L[i]); // a strand / whisker is darker than its neighbourhood
  // scalp hair → salt-and-pepper grey, contrast kept (strands stay a little darker than the grey mass)
  if (hairZ > 0) {
    const gv = 40 + L[i] * 0.5 + hash(x, y * 1.7) * 26;
    const k = hairZ * 0.92;
    r += (gv * 1.02 - r) * k; gg += (gv * 0.99 - gg) * k; b += (gv * 0.95 - b) * k;
    // receded crown / temples: mostly bare scalp; only the darkest strands survive, thin and grey
    const bald = Math.min(1, crown + temple) * hairZ;
    if (bald > 0) {
      const strand = sm(6, 22, dark) * (hash(x * 0.71, y * 0.29) > 0.55 ? 1 : 0.2);
      const sc = [skin[0] * 1.0 + 6, skin[1] * 0.96, skin[2] * 0.94];
      const kk = bald * (1 - 0.7 * strand);
      r += (sc[0] - r) * kk; gg += (sc[1] - gg) * kk; b += (sc[2] - b) * kk;
    }
  }
  // stubble: whiskers turn grey (lighter than the skin's dark stubble) — only the dark detail texels change
  if (stub > 0) {
    const k = stub * sm(2, 14, dark) * 0.85;
    const gv = 150 + hash(x, y) * 30;
    r += (gv - r) * k; gg += (gv * 0.98 - gg) * k; b += (gv * 0.96 - b) * k;
    // and the blue-grey stubble shadow of the original is softened toward skin
    const k2 = stub * 0.35;
    r += (Cb[0][i] - r) * k2 * 0.4; gg += (Cb[1][i] - gg) * k2 * 0.4; b += (Cb[2][i] - b) * k2 * 0.4;
  }
  // below the new (grey) hairline the source's brown fringe would read as dyed sideburns: darker texels → skin, the
  // rest of the short hair there → grey like the scalp
  if (fringe > 0) {
    const skL = 0.299 * skin[0] + 0.587 * skin[1] + 0.114 * skin[2];
    const k = fringe * sm(skL - 4, skL - 45, L[i]);
    const gv = 70 + L[i] * 0.45;
    r += (skin[0] * 0.55 + gv * 0.45 - r) * k; gg += (skin[1] * 0.55 + gv * 0.45 - gg) * k; b += (skin[2] * 0.55 + gv * 0.43 - b) * k;
  }
  // the source's orange-red eyelids → toward forehead skin, a little darker (tired, slightly sunken)
  if (lid > 0) { const k = lid * 0.6; r += (skin[0] * 0.93 - r) * k; gg += (skin[1] * 0.9 - gg) * k; b += (skin[2] * 0.9 - b) * k; }
  // a tired, weathered complexion: ruddy nose/cheeks
  if (ruddy > 0) { r += 10 * ruddy; gg -= 9 * ruddy; b -= 8 * ruddy; }
  col[o] = Math.max(0, Math.min(255, r)); col[o + 1] = Math.max(0, Math.min(255, gg)); col[o + 2] = Math.max(0, Math.min(255, b));
}
// eyebrows: fit eyebrow009 (bushy) and bake it (alpha over) into the crop, salt-and-pepper per strand
{
  const dir = path.join(mhsys, 'eyebrows/eyebrow009');
  const { pvt, pf, refs } = fitProxy(dir, 'eyebrow009');
  const bw = 512, bh = 512;
  const brow = readRGBA(path.join(dir, 'eyebrow009.png'), bw, bh);
  // each proxy vertex: skin uv = weighted body uvs (the brows hug the skin)
  const puv = refs.map((r) => {
    let u = 0, v = 0;
    for (let k = 0; k < 3; k++) { const q = BODY_UV.get(r[k]) ?? [0, 0]; u += q[0] * r[3 + k]; v += q[1] * r[3 + k]; }
    const q = atlas('head', u, v); return [q[0] * SW, q[1] * SH];
  });
  for (const f of pf) {
    const tris = f.v.length === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]];
    for (const tr of tris) {
      const vs = tr.map((k) => f.v[k]), ts = tr.map((k) => f.t[k]);
      raster(vs.map((v) => puv[v]), (x, y, l0, l1, l2) => {
        const u = pvt[ts[0] * 2] * l0 + pvt[ts[1] * 2] * l1 + pvt[ts[2] * 2] * l2;
        const v = pvt[ts[0] * 2 + 1] * l0 + pvt[ts[1] * 2 + 1] * l1 + pvt[ts[2] * 2 + 1] * l2;
        const bx = Math.min(bw - 1, Math.max(0, Math.floor(u * bw))), by = Math.min(bh - 1, Math.max(0, Math.floor((1 - v) * bh)));
        const bo = (by * bw + bx) * 4, a = Math.min(1, (brow[bo + 3] / 255) * 1.1);
        if (a <= 0) return;
        const o = (y * SW + x) * 4;
        const hv = hash(Math.floor(bx / 3) * 0.37, by * 1.3);
        const gcol = hv > 0.55 ? [128, 124, 118] : hv > 0.2 ? [78, 73, 68] : [48, 44, 41];
        for (let k = 0; k < 3; k++) col[o + k] = col[o + k] * (1 - a) + gcol[k] * a;
      });
    }
  }
}
// overall: a little less saturated and less yellow than the source skin (night shift, fluorescent pallor)
for (let i = 0; i < SW * SH; i++) {
  const o = i * 4, l = 0.299 * col[o] + 0.587 * col[o + 1] + 0.114 * col[o + 2];
  col[o] = Math.min(255, (l + (col[o] - l) * 0.8) * 0.99); col[o + 1] = Math.min(255, (l + (col[o + 1] - l) * 0.8) * 0.975); col[o + 2] = Math.min(255, (l + (col[o + 2] - l) * 0.8) * 1.0);
}
// outside the island: the edge texels are dilated outward (no dark source outline bleeding into the UV seams under
// filtering), everything further out is flat mean skin (compresses well; no logo / hand bits from the source atlas)
{
  const cov = new Uint8Array(SW * SH); for (let i = 0; i < SW * SH; i++) cov[i] = region[i * NCH + NCH - 1] ? 1 : 0;
  // the source island's own rim (a dark outline) is pulled in too: the 2 outermost covered texels are re-filled
  for (let pass = 0; pass < 2; pass++) {
    const edge = [];
    for (let y = 1; y < SH - 1; y++) for (let x = 1; x < SW - 1; x++) { const i = y * SW + x; if (cov[i] && (!cov[i - 1] || !cov[i + 1] || !cov[i - SW] || !cov[i + SW])) edge.push(i); }
    for (const i of edge) cov[i] = 0;
  }
  for (let pass = 0; pass < 10; pass++) {
    const add = [];
    for (let y = 1; y < SH - 1; y++) for (let x = 1; x < SW - 1; x++) {
      const i = y * SW + x; if (cov[i]) continue;
      const c = [0, 0, 0]; let n = 0;
      for (const j of [i - 1, i + 1, i - SW, i + SW, i - SW - 1, i - SW + 1, i + SW - 1, i + SW + 1]) if (cov[j]) { for (let k = 0; k < 3; k++) c[k] += col[j * 4 + k]; n++; }
      if (n) add.push([i, c.map((v) => v / n)]);
    }
    for (const [i, c] of add) { for (let k = 0; k < 3; k++) col[i * 4 + k] = c[k]; cov[i] = 1; }
  }
  for (let i = 0; i < SW * SH; i++) if (!cov[i]) for (let k = 0; k < 3; k++) col[i * 4 + k] = skin[k];
}
// flat patches: socket lining (dark, wet red-brown), mouth interior (dark red)
{
  const fill = (x0, y0, c) => { for (let y = y0; y < y0 + 24; y++) for (let x = x0; x < x0 + 24; x++) { const o = (y * SW + x) * 4; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; } };
  fill(PATCH.socket[0], PATCH.socket[1], [70, 34, 30]); fill(PATCH.mouth[0], PATCH.mouth[1], [58, 22, 22]);
}
const colJpg = path.join(work, 'col_halvorsen.jpg');
writeRGB(col, SW, SH, colJpg, 85);
// ── normal map from the colour detail: height = high-passed luminance (dark creases/pores = low)
{
  const c2 = readRGBA(colJpg, SW, SH);
  const l = new Float32Array(SW * SH); for (let i = 0; i < SW * SH; i++) l[i] = (0.299 * c2[i * 4] + 0.587 * c2[i * 4 + 1] + 0.114 * c2[i * 4 + 2]) / 255;
  const lb = blur(l, SW, SH, 6);
  const h = new Float32Array(SW * SH); for (let i = 0; i < SW * SH; i++) h[i] = l[i] - lb[i];
  const nm = Buffer.alloc(SW * SH * 4);
  const K = 2.2;
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const i = y * SW + x;
    const dx = (h[y * SW + Math.min(SW - 1, x + 1)] - h[y * SW + Math.max(0, x - 1)]) * K;
    // image rows go down = +v in glTF uv (flipY false)
    const dy = (h[Math.min(SH - 1, y + 1) * SW + x] - h[Math.max(0, y - 1) * SW + x]) * K;
    let nx = -dx, ny = dy, nz = 1; // OpenGL/glTF convention: green = up the image (−v) const ln = Math.hypot(nx, ny, nz); nx /= ln; ny /= ln; nz /= ln;
    nm[i * 4] = Math.round((nx * 0.5 + 0.5) * 255); nm[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255); nm[i * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255); nm[i * 4 + 3] = 255;
  }
  writeRGB(nm, SW, SH, path.join(work, 'nrm_halvorsen.jpg'), 80);
}

// ── GLB
const chunks = []; let off = 0; const views = []; const accessors = [];
const pushView = (buf, target) => {
  const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
  views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}) });
  chunks.push(buf); off += buf.length; return views.length - 1;
};
const addAcc = (arr, type, ctype, target, minmax) => {
  const buf = ctype === 5126 ? Buffer.from(new Float32Array(arr).buffer) : Buffer.from(new Uint16Array(arr).buffer);
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
  const a = { bufferView: pushView(buf, target), componentType: ctype, count: arr.length / n, type };
  if (minmax) { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < arr.length; i++) { mn[i % 3] = Math.min(mn[i % 3], arr[i]); mx[i % 3] = Math.max(mx[i % 3], arr[i]); } a.min = mn; a.max = mx; }
  accessors.push(a); return accessors.length - 1;
};
if (src.length > 65535) throw new Error('too many vertices for u16');
const POSITION = addAcc(P, 'VEC3', 5126, 34962, true);
const NORMAL = addAcc(NRM, 'VEC3', 5126, 34962);
const TEXCOORD_0 = addAcc(UV, 'VEC2', 5126, 34962);
const indices = addAcc(idx, 'SCALAR', 5123, 34963);
const imgCol = pushView(fs.readFileSync(colJpg));
const imgNrm = pushView(fs.readFileSync(path.join(work, 'nrm_halvorsen.jpg')));
const json = {
  asset: { version: '2.0', generator: 'cold-boot build-head2.mjs', copyright: 'Built from MakeHuman CC0 assets (hm08 base mesh, targets, old_caucasian_male skin, eyebrow009) — www.makehumancommunity.org — modified for COLD BOOT' },
  scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'halvorsen_head', extras: { units: 'm', landmarks: LMK, cutY: Math.round(yCut * 1e4) / 1e4 } }],
  meshes: [{ name: 'halvorsen_head', primitives: [{ attributes: { POSITION, NORMAL, TEXCOORD_0 }, indices, material: 0 }] }],
  materials: [{ name: 'halvorsen_head_skin', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.62 }, normalTexture: { index: 1, scale: 0.6 } }],
  textures: [{ source: 0, sampler: 0 }, { source: 1, sampler: 0 }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  images: [{ bufferView: imgCol, mimeType: 'image/jpeg' }, { bufferView: imgNrm, mimeType: 'image/jpeg' }],
  accessors, bufferViews: views, buffers: [{ byteLength: 0 }],
};
let bin = Buffer.concat(chunks); bin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
json.buffers[0].byteLength = bin.length;
let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, jh, js, bh, bin]));
console.log('wrote', out, 12 + 8 + js.length + 8 + bin.length, 'bytes;', src.length, 'vertices,', idx.length / 3, 'triangles; head crop', JSON.stringify(HB), 'neck crop', JSON.stringify(NB));
console.log('islands', JSON.stringify(islandCount));
console.log('landmarks', JSON.stringify(LMK));
