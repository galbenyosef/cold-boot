// Z-fighting detector: coplanar, same-facing, overlapping render triangles.
// Usage: node scripts/check-zfight.mjs [--url http://127.0.0.1:5173] [--level 1|2|all] [--shot [N]]
//          [--room <id>] [--tol 0.002] [--min-tri-area 0.005] [--min-overlap 0.002] [--top 25] [--verbose]
// Exit code 1 when same-facing (or double-sided opposite-facing) clusters are found.
import { parseArgs, levelsOf, launch, bootLevel, writeJson } from './lib/check-common.mjs';

const args = parseArgs();
const base = args.url ?? 'http://127.0.0.1:5173';
const opts = {
  tol: Number(args.tol ?? 0.002),           // plane distance tolerance (m)
  angDeg: Number(args.ang ?? 0.5),          // normal tolerance (deg)
  minTriArea: Number(args['min-tri-area'] ?? 0.005), // m^2, triangles smaller than this are ignored
  minOverlap: Number(args['min-overlap'] ?? 0.002),  // m^2, overlap area needed to count a pair
  mergeGap: Number(args['merge-gap'] ?? 0.5),        // m, clusters with same planes/meshes closer than this merge
};
const shotN = args.shot ? (args.shot === '1' ? 6 : Number(args.shot)) : 0;
const top = Number(args.top ?? 25);

/** Runs inside the page. Pure geometry, no THREE import needed. */
function analyse(o) {
  const g = window.__game;
  g.scene.updateMatrixWorld(true);
  const vmLayer = g.render?.viewmodelLayer;
  const excluded = {}; // reason -> {count, names:Set}
  const exclude = (why, name, tris = 0) => { const e = excluded[why] ??= { meshes: 0, tris: 0, examples: [] }; e.meshes++; e.tris += tris; if (e.examples.length < 6 && !e.examples.includes(name)) e.examples.push(name); };

  const meshes = []; // {name, nameSrc, mats:[names], hidden, inst}
  const T = { v: [], mesh: [], mat: [], side: [], nx: [], ny: [], nz: [], d: [], area: [] };
  let nTri = 0, nAll = 0, parked = 0;
  const e = new Array(16);

  const pathName = (obj) => {
    if (obj.name) return [obj.name, 'mesh.name'];
    for (let p = obj.parent; p; p = p.parent) if (p.name) return [`${p.name}/<unnamed>`, 'parent.name'];
    return [obj.geometry?.name || `<${obj.type}#${obj.id}>`, 'none'];
  };
  const matName = (m, obj) => {
    if (m.name) return [m.name, 'material.name'];
    if (m.userData?.name) return [m.userData.name, 'userData.name'];
    // fall back to a registry lookup by identity in ctx.materials, else uuid prefix + colour
    return [`<anon ${m.type} #${m.id} ${m.color ? '#' + m.color.getHexString() : ''}${m.map?.name ? ' map:' + m.map.name : ''}>`, 'anon'];
  };

  const walk = (obj, hiddenUp) => {
    const hid = hiddenUp || !obj.visible;
    if (obj.isSprite || obj.isLine || obj.isPoints || obj.isLight || obj.isCamera) return;
    if (obj.isMesh) consider(obj, hid);
    for (const c of obj.children) walk(c, hid);
  };
  const consider = (obj, hidden) => {
    const geo = obj.geometry;
    const pos = geo?.attributes?.position;
    if (!pos) return;
    const [nm] = pathName(obj);
    if (vmLayer !== undefined && obj.layers.isEnabled(vmLayer)) return exclude('viewmodel layer', nm);
    if (/collider|proxy|shadowcaster/i.test(nm) || obj.userData?.collider) return exclude('collider / proxy by name', nm);
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const idx = geo.index;
    const triCount = (idx ? idx.count : pos.count) / 3;
    const okMat = mats.map((m) => {
      if (!m) return 'null material';
      if (m.visible === false || m.colorWrite === false) return 'invisible material (visible/colorWrite false)';
      if (m.opacity === 0) return 'opacity 0';
      if (m.polygonOffset) return 'polygonOffset material (decal / deliberate offset)';
      if (m.transparent && m.blending === 2) return 'additive transparent fx';
      if (m.depthWrite === false) return 'depthWrite=false (fx / volumetric / overlay)';
      if (m.isShaderMaterial && m.transparent) return 'transparent shader material (fx)';
      return null;
    });
    if (okMat.every((r) => r)) return exclude(okMat[0], `${nm} [${mats.map((m) => m?.name || '?').join(',')}]`, triCount);
    const mi = meshes.length;
    const mnames = mats.map((m) => (m ? matName(m, obj)[0] : '<null>'));
    meshes.push({ name: nm, nameSrc: pathName(obj)[1], mats: mnames, hidden, inst: !!obj.isInstancedMesh, type: obj.type });
    const groups = geo.groups?.length && Array.isArray(obj.material) ? geo.groups : null;
    const nInst = obj.isInstancedMesh ? obj.count : 1;
    const M = obj.matrixWorld.elements;
    const IM = new Array(16);
    const mul = (a, b, out) => { for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; out[c * 4 + r] = s; } };
    const px = pos.array, stride = pos.data ? pos.data.stride : pos.itemSize, off = pos.offset ?? 0;
    const parr = pos.data ? pos.data.array : px;
    const ia = idx ? idx.array : null;
    const W = new Float64Array(9);
    for (let ii = 0; ii < nInst; ii++) {
      let m = M;
      if (obj.isInstancedMesh) { const tmp = obj.instanceMatrix.array; for (let k = 0; k < 16; k++) e[k] = tmp[ii * 16 + k]; mul(M, e, IM); m = IM; }
      for (let t = 0; t < triCount; t++) {
        nAll++;
        for (let k = 0; k < 3; k++) {
          const vi = ia ? ia[t * 3 + k] : t * 3 + k;
          const x = parr[vi * stride + off], y = parr[vi * stride + off + 1], z = parr[vi * stride + off + 2];
          W[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          W[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          W[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        if (W[1] < -50 && W[4] < -50) { parked++; continue; }
        const ax = W[3] - W[0], ay = W[4] - W[1], az = W[5] - W[2], bx = W[6] - W[0], by = W[7] - W[1], bz = W[8] - W[2];
        let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const l = Math.hypot(nx, ny, nz);
        const area = l / 2;
        if (area < o.minTriArea) continue;
        let slot = 0;
        if (groups) { const ti = t * 3; slot = 0; for (const gr of groups) if (ti >= gr.start && ti < gr.start + gr.count) { slot = gr.materialIndex; break; } }
        const mat = mats[slot] ?? mats[0];
        if (okMat[Math.min(slot, okMat.length - 1)]) continue;
        let side = mat.side; // 0 front, 1 back, 2 double
        nx /= l; ny /= l; nz /= l;
        if (side === 1) { nx = -nx; ny = -ny; nz = -nz; }
        for (let k = 0; k < 9; k++) T.v.push(W[k]);
        T.mesh.push(mi); T.mat.push(slot); T.side.push(side === 2 ? 2 : 0);
        T.nx.push(nx); T.ny.push(ny); T.nz.push(nz); T.d.push(nx * W[0] + ny * W[1] + nz * W[2]); T.area.push(area);
        nTri++;
      }
    }
  };
  walk(g.scene, false);
  if (parked) excluded['parked far below the world (y < -50, stashed meshes)'] = { meshes: 0, tris: parked, examples: [] };

  // ── bucket by plane (canonical normal with largest component positive; quantised; distance in `tol` steps)
  const cosA = Math.cos(o.angDeg * Math.PI / 180);
  const buckets = new Map();
  const canon = new Float32Array(nTri * 4), sgn = new Int8Array(nTri);
  const bkey = new Array(nTri);
  const snap = (c) => { const a = Math.abs(c); return a > cosA ? Math.sign(c) : Math.round(c / 0.01) * 0.01; };
  for (let i = 0; i < nTri; i++) {
    let nx = T.nx[i], ny = T.ny[i], nz = T.nz[i], d = T.d[i];
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const mx = Math.max(ax, ay, az);
    const comp = mx === ax ? nx : mx === ay ? ny : nz;
    const s = comp >= 0 ? 1 : -1;
    sgn[i] = s;
    nx *= s; ny *= s; nz *= s; d *= s;
    let qx = snap(nx), qy = snap(ny), qz = snap(nz);
    if (Math.abs(qx) === 1 || Math.abs(qy) === 1 || Math.abs(qz) === 1) { nx = qx; ny = qy; nz = qz; d = nx * T.v[i * 9] + ny * T.v[i * 9 + 1] + nz * T.v[i * 9 + 2]; }
    canon[i * 4] = nx; canon[i * 4 + 1] = ny; canon[i * 4 + 2] = nz; canon[i * 4 + 3] = d;
    const nq = `${qx.toFixed(2)},${qy.toFixed(2)},${qz.toFixed(2)}`;
    const dq = Math.round(d / o.tol);
    bkey[i] = [nq, dq];
    const k = `${nq}|${dq}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, b = { nq, dq, list: [] });
    b.list.push(i);
  }

  // ── polygon clipping (Sutherland–Hodgman) of triangle a by triangle b, in 2D
  const CELL = 0.5;
  const pairs = [];
  let tested = 0;
  const U = [0, 0, 0], V = [0, 0, 0];
  const clipArea = (A, B, outPoly) => {
    // A, B: [x0,y0,x1,y1,x2,y2], make CCW
    const ccw = (P) => ((P[2] - P[0]) * (P[5] - P[1]) - (P[3] - P[1]) * (P[4] - P[0])) >= 0 ? P : [P[0], P[1], P[4], P[5], P[2], P[3]];
    A = ccw(A); B = ccw(B);
    let poly = [[A[0], A[1]], [A[2], A[3]], [A[4], A[5]]];
    for (let k = 0; k < 3 && poly.length; k++) {
      const x1 = B[k * 2], y1 = B[k * 2 + 1], x2 = B[((k + 1) % 3) * 2], y2 = B[((k + 1) % 3) * 2 + 1];
      const side = (p) => (x2 - x1) * (p[1] - y1) - (y2 - y1) * (p[0] - x1);
      const res = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const sp = side(p), sq = side(q);
        if (sp >= 0) res.push(p);
        if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); res.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
      poly = res;
    }
    if (poly.length < 3) return 0;
    let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
    outPoly.push(...poly);
    return Math.abs(a) / 2;
  };

  const processBucket = (b, nb) => {
    const L = b.list, L2 = nb ? nb.list : [];
    const all = L2.length ? L.concat(L2) : L;
    if (all.length < 2) return;
    const i0 = L[0];
    const n0 = [canon[i0 * 4], canon[i0 * 4 + 1], canon[i0 * 4 + 2]];
    // basis
    const h = Math.abs(n0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const cr = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
    let u = cr(n0, h); const ul = Math.hypot(...u); u = u.map((x) => x / ul); const v = cr(n0, u);
    U[0] = u[0]; U[1] = u[1]; U[2] = u[2]; V[0] = v[0]; V[1] = v[1]; V[2] = v[2];
    const P = new Float64Array(all.length * 6), mn = new Float64Array(all.length * 2), mxx = new Float64Array(all.length * 2);
    const grid = new Map();
    for (let a = 0; a < all.length; a++) {
      const t = all[a];
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let k = 0; k < 3; k++) {
        const wx = T.v[t * 9 + k * 3], wy = T.v[t * 9 + k * 3 + 1], wz = T.v[t * 9 + k * 3 + 2];
        const px = wx * u[0] + wy * u[1] + wz * u[2], py = wx * v[0] + wy * v[1] + wz * v[2];
        P[a * 6 + k * 2] = px; P[a * 6 + k * 2 + 1] = py;
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
      mn[a * 2] = x0; mn[a * 2 + 1] = y0; mxx[a * 2] = x1; mxx[a * 2 + 1] = y1;
      const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL), cy0 = Math.floor(y0 / CELL), cy1 = Math.floor(y1 / CELL);
      for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
        const key = cx * 65537 + cy;
        let c = grid.get(key); if (!c) grid.set(key, c = []);
        c.push(a);
      }
    }
    const nL = L.length;
    for (const [key, cell] of grid) {
      if (cell.length < 2) continue;
      const cy = ((key % 65537) + 65537 + 32768) % 65537; // not used for ownership; ownership uses mins below
      for (let ii = 0; ii < cell.length; ii++) for (let jj = ii + 1; jj < cell.length; jj++) {
        const a = cell[ii], c = cell[jj];
        if (a >= nL && c >= nL) continue; // both in neighbour bucket: handled by their own pass
        // owner cell = cell containing max of the two AABB mins
        const ox = Math.floor(Math.max(mn[a * 2], mn[c * 2]) / CELL), oy = Math.floor(Math.max(mn[a * 2 + 1], mn[c * 2 + 1]) / CELL);
        if (ox * 65537 + oy !== key) continue;
        if (mn[a * 2] >= mxx[c * 2] || mn[c * 2] >= mxx[a * 2] || mn[a * 2 + 1] >= mxx[c * 2 + 1] || mn[c * 2 + 1] >= mxx[a * 2 + 1]) continue;
        const ta = all[a], tc = all[c];
        // exact plane/normal test
        const dotN = T.nx[ta] * T.nx[tc] + T.ny[ta] * T.ny[tc] + T.nz[ta] * T.nz[tc];
        if (Math.abs(dotN) < cosA) continue;
        let dev = 0;
        for (let k = 0; k < 3; k++) { const dd = Math.abs(T.nx[ta] * T.v[tc * 9 + k * 3] + T.ny[ta] * T.v[tc * 9 + k * 3 + 1] + T.nz[ta] * T.v[tc * 9 + k * 3 + 2] - T.d[ta]); if (dd > dev) dev = dd; }
        if (dev > o.tol) continue;
        tested++;
        const poly = [];
        const ar = clipArea(Array.from(P.subarray(a * 6, a * 6 + 6)), Array.from(P.subarray(c * 6, c * 6 + 6)), poly);
        if (ar < o.minOverlap) continue;
        // back to world for centroid/bbox
        const n = [canon[ta * 4], canon[ta * 4 + 1], canon[ta * 4 + 2]], d = canon[ta * 4 + 3];
        let cx = 0, cyy = 0; for (const p of poly) { cx += p[0]; cyy += p[1]; } cx /= poly.length; cyy /= poly.length;
        const w = (pu, pv) => [n[0] * d + u[0] * pu + v[0] * pv, n[1] * d + u[1] * pu + v[1] * pv, n[2] * d + u[2] * pu + v[2] * pv];
        const pw = poly.map((p) => w(p[0], p[1]));
        const mnw = [1e9, 1e9, 1e9], mxw = [-1e9, -1e9, -1e9];
        for (const p of pw) for (let k = 0; k < 3; k++) { if (p[k] < mnw[k]) mnw[k] = p[k]; if (p[k] > mxw[k]) mxw[k] = p[k]; }
        const same = dotN > 0;
        const ds = T.side[ta] === 2 || T.side[tc] === 2;
        pairs.push({ a: ta, b: tc, area: ar, c: w(cx, cyy), mn: mnw, mx: mxw, cls: same ? 'same' : ds ? 'opposite-ds' : 'opposite', n: same ? [T.nx[ta], T.ny[ta], T.nz[ta]] : [T.nx[ta], T.ny[ta], T.nz[ta]], key: `${b.nq}|${b.dq}` });
      }
    }
  };
  for (const b of buckets.values()) {
    const nb = buckets.get(`${b.nq}|${b.dq + 1}`);
    processBucket(b, nb);
  }

  // ── cluster: union by shared triangle, then merge same plane/mesh/material/class clusters within mergeGap
  const parent = new Map();
  const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; } return r; };
  const cl = pairs.map((p) => `${p.cls}`);
  for (let i = 0; i < pairs.length; i++) { const p = pairs[i]; for (const t of [p.a * 2, p.b * 2]) if (!parent.has(t)) parent.set(t, t); }
  const clsOfTri = (t, p) => `${p.cls}`;
  const un = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  // triangles are only unioned within the same class (so same-facing and opposite-facing never merge)
  const triUnionKey = new Map();
  for (const p of pairs) { const ka = `${p.a}|${p.cls}`, kb = `${p.b}|${p.cls}`; for (const k of [ka, kb]) if (!triUnionKey.has(k)) { const id = parent.size; triUnionKey.set(k, id + 1e9); parent.set(id + 1e9, id + 1e9); } un(triUnionKey.get(ka), triUnionKey.get(kb)); }
  const groups = new Map();
  for (const p of pairs) { const r = find(triUnionKey.get(`${p.a}|${p.cls}`)); let gr = groups.get(r); if (!gr) groups.set(r, gr = []); gr.push(p); }
  let clusters = [];
  for (const ps of groups.values()) {
    const ms = new Set(), mt = new Set();
    for (const p of ps) { ms.add(T.mesh[p.a]); ms.add(T.mesh[p.b]); mt.add(`${T.mesh[p.a]}:${T.mat[p.a]}`); mt.add(`${T.mesh[p.b]}:${T.mat[p.b]}`); }
    clusters.push({ ps, sig: `${ps[0].cls}|${ps[0].key.split('|')[0]}|${[...mt].sort().join(',')}`, mn: ps.reduce((m, p) => m.map((v, k) => Math.min(v, p.mn[k])), [1e9, 1e9, 1e9]), mx: ps.reduce((m, p) => m.map((v, k) => Math.max(v, p.mx[k])), [-1e9, -1e9, -1e9]), planeD: ps[0].key });
  }
  const gap = (A, B) => { let s = 0; for (let k = 0; k < 3; k++) { const d = Math.max(A.mn[k] - B.mx[k], B.mn[k] - A.mx[k], 0); s += d * d; } return Math.sqrt(s); };
  const bySig = new Map();
  for (const c of clusters) { let a = bySig.get(c.sig); if (!a) bySig.set(c.sig, a = []); a.push(c); }
  clusters = [];
  for (const list of bySig.values()) {
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        if (list[i].planeD.split('|')[1] != list[j].planeD.split('|')[1] && Math.abs(list[i].planeD.split('|')[1] - list[j].planeD.split('|')[1]) > 1) continue;
        if (gap(list[i], list[j]) < o.mergeGap) {
          const A = list[i], B = list[j];
          A.ps = A.ps.concat(B.ps); A.mn = A.mn.map((v, k) => Math.min(v, B.mn[k])); A.mx = A.mx.map((v, k) => Math.max(v, B.mx[k]));
          list.splice(j, 1); changed = true; break outer;
        }
      }
    }
    clusters.push(...list);
  }

  const Vec = g.camera.position.constructor;
  const findings = clusters.map((c) => {
    let area = 0, cx = 0, cy = 0, cz = 0;
    const ms = new Map();
    for (const p of c.ps) {
      area += p.area; cx += p.c[0] * p.area; cy += p.c[1] * p.area; cz += p.c[2] * p.area;
      for (const t of [p.a, p.b]) { const k = `${T.mesh[t]}:${T.mat[t]}`; ms.set(k, (ms.get(k) ?? 0) + 1); }
    }
    cx /= area; cy /= area; cz /= area;
    const first = c.ps[0];
    const room = g.level.roomAt(new Vec(cx, cy, cz))?.id ?? null;
    const items = [...ms.keys()].map((k) => { const [mi, slot] = k.split(':').map(Number); const m = meshes[mi]; return { mesh: m.name, meshSrc: m.nameSrc, material: m.mats[Math.min(slot, m.mats.length - 1)], hidden: m.hidden, instanced: m.inst }; });
    return {
      cls: first.cls, area: +area.toFixed(4), pairs: c.ps.length, room,
      center: [cx, cy, cz].map((v) => +v.toFixed(3)), bbox: { min: c.mn.map((v) => +v.toFixed(3)), max: c.mx.map((v) => +v.toFixed(3)) },
      normal: first.n.map((v) => +v.toFixed(4)), items,
      meshes: [...new Set(items.map((i) => i.mesh))], materials: [...new Set(items.map((i) => i.material))],
      sameMesh: new Set(items.map((i) => i.mesh + '|' + i.meshSrc)).size === 1 && items.length <= 2 ? new Set(c.ps.flatMap((p) => [T.mesh[p.a], T.mesh[p.b]])).size === 1 : false,
      anyHiddenAtCapture: items.some((i) => i.hidden),
    };
  });
  // ── visibility: can a person stand in front of the spot? (room test + ray along the normal against all kept triangles)
  const rayFree = (o3, d3, maxT) => {
    let best = maxT;
    for (let t = 0; t < nTri; t++) {
      const b9 = t * 9, v = T.v;
      const e1x = v[b9 + 3] - v[b9], e1y = v[b9 + 4] - v[b9 + 1], e1z = v[b9 + 5] - v[b9 + 2];
      const e2x = v[b9 + 6] - v[b9], e2y = v[b9 + 7] - v[b9 + 1], e2z = v[b9 + 8] - v[b9 + 2];
      const px = d3[1] * e2z - d3[2] * e2y, py = d3[2] * e2x - d3[0] * e2z, pz = d3[0] * e2y - d3[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-9) continue;
      const inv = 1 / det, sx = o3[0] - v[b9], sy = o3[1] - v[b9 + 1], sz = o3[2] - v[b9 + 2];
      const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const w = (d3[0] * qx + d3[1] * qy + d3[2] * qz) * inv; if (w < 0 || u + w > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > 0 && tt < best) best = tt;
    }
    return best;
  };
  findings.sort((a, b) => b.area - a.area);
  const rayMax = 3;
  findings.forEach((f, i) => {
    const n = f.cls === 'same' || true ? f.normal : f.normal;
    f.sides = [];
    // observers can stand on either side for opposite-facing pairs; for same-facing only the +normal side counts
    const dirs = f.cls === 'same' ? [1] : [1, -1];
    let bestClear = 0, bestDir = 1, inRoom = false;
    for (const sd of dirs) {
      const dir = [n[0] * sd, n[1] * sd, n[2] * sd];
      const probe = new Vec(f.center[0] + dir[0] * 0.4, f.center[1] + dir[1] * 0.4, f.center[2] + dir[2] * 0.4);
      const rm = g.level.roomAt(probe);
      if (rm) inRoom = true;
      if (i >= 3000) continue;
      // sample centre + bbox corners that lie in the plane
      const pts = [f.center];
      for (const bx of [f.bbox.min[0], f.bbox.max[0]]) for (const by of [f.bbox.min[1], f.bbox.max[1]]) for (const bz of [f.bbox.min[2], f.bbox.max[2]]) pts.push([(bx + f.center[0]) / 2, (by + f.center[1]) / 2, (bz + f.center[2]) / 2]);
      for (const pt of pts.slice(0, 5)) {
        const c = rayFree([pt[0] + dir[0] * 0.01, pt[1] + dir[1] * 0.01, pt[2] + dir[2] * 0.01], dir, rayMax);
        if (c > bestClear) { bestClear = c; bestDir = sd; }
      }
    }
    f.visibility = i >= 3000 ? (inRoom ? 'unchecked' : 'outside-rooms') : !inRoom ? 'outside-rooms' : bestClear < 0.25 ? 'blocked' : 'open';
    f.clear = +bestClear.toFixed(2); f.viewSide = bestDir;
  });
  findings.sort((a, b) => (a.cls === 'same' ? 0 : a.cls === 'opposite-ds' ? 1 : 2) - (b.cls === 'same' ? 0 : b.cls === 'opposite-ds' ? 1 : 2) || b.area - a.area);
  return { stats: { meshes: meshes.length, trisInspected: nAll, trisKept: nTri, buckets: buckets.size, pairsTested: tested, pairs: pairs.length }, excluded, findings };
}

const browser = await launch();
let bad = 0;
for (const level of levelsOf(args)) {
  const page = await bootLevel(browser, base, level);
  const t0 = Date.now();
  const res = await page.evaluate(analyse, opts);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (args.room) res.findings = res.findings.filter((f) => f.room === args.room);
  const vis = (f) => f.visibility === 'open' || f.visibility === 'unchecked';
  const same = res.findings.filter((f) => f.cls === 'same' && vis(f));
  const ds = res.findings.filter((f) => f.cls === 'opposite-ds' && vis(f));
  const opp = res.findings.filter((f) => f.cls === 'opposite' && vis(f));
  const unseen = res.findings.filter((f) => !vis(f) && f.cls !== 'opposite');
  console.log(`\n=== Z-FIGHT level ${level} (${secs}s) ===`);
  console.log(`meshes ${res.stats.meshes}, tris inspected ${res.stats.trisInspected}, kept ${res.stats.trisKept}, overlapping pairs ${res.stats.pairs}`);
  console.log('excluded:', Object.entries(res.excluded).map(([k, v]) => `${k}: ${v.meshes} meshes/${v.tris} tris`).join('; ') || 'none');
  console.log(`clusters: same-facing ${same.length}, opposite-facing double-sided ${ds.length}, opposite-facing (low severity) ${opp.length}`);
  const show = (arr, label) => {
    if (!arr.length) return;
    console.log(`-- ${label}`);
    arr.slice(0, top).forEach((f, i) => console.log(`#${i} ${f.area.toFixed(3)} m2 room=${f.room} vis=${f.visibility}/${f.clear}m at (${f.center.join(', ')}) n=(${f.normal.map((v) => v.toFixed(2)).join(', ')}) pairs=${f.pairs}${f.sameMesh ? ' SAME-MESH' : ''}${f.anyHiddenAtCapture ? ' (some mesh culled at capture)' : ''}\n     ${f.items.map((it) => `${it.mesh}{${it.material}}`).join('  X  ')}`));
  };
  console.log(`not reachable by an eye (outside rooms / blocked within 25 cm): ${unseen.length} clusters, ${unseen.reduce((a, f) => a + f.area, 0).toFixed(1)} m2 (in JSON, visibility field; not counted)`);
  show(same, 'same-facing (real z-fighting)');
  show(ds, 'opposite-facing, double-sided material involved (can fight)');
  if (args.verbose) show(opp, 'opposite-facing (back-to-back, normally harmless)');
  const shots = [];
  if (shotN) {
    const targets = [...same.filter((f) => f.visibility === 'open'), ...ds.filter((f) => f.visibility === 'open')].slice(0, shotN);
    for (let i = 0; i < targets.length; i++) {
      const f = targets[i];
      const out = `shots/checks/zfight-l${level}-${i}.png`;
      await page.evaluate(({ f }) => {
        const g = window.__game; const Vec = g.camera.position.constructor;
        const sd = f.viewSide, c = f.center, n = f.normal.map((v) => v * sd), D = Math.max(0.8, Math.min(2, f.clear - 0.15));
        let ex, ey, ez;
        if (Math.abs(n[1]) > 0.8) { ex = c[0] + 1.4; ez = c[2] + 0.7; ey = c[1] + (n[1] > 0 ? 1.6 : -1.6); } // floor / ceiling: look down/up at an angle
        else { ex = c[0] + n[0] * D; ey = c[1]; ez = c[2] + n[2] * D; }
        const room = g.level.roomAt(new Vec(c[0], c[1], c[2]));
        const floor = room ? room.bounds.min.y + 0.5 : 0;
        let feet = Math.max(ey - 1.6, floor);
        if (Math.abs(n[1]) > 0.8 && n[1] < 0) feet = Math.max(floor, c[1] - 2.8); // ceiling: stand on the floor
        const eyeY = feet + 1.6;
        const dx = c[0] - ex, dy = c[1] - eyeY, dz = c[2] - ez;
        g.player.teleport(new Vec(ex, feet, ez), Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      }, { f });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: out });
      shots.push(out); f.screenshot = out;
    }
    console.log('screenshots:', shots.join(' '));
  }
  console.log('json:', writeJson('zfight', level, { level, opts, ...res }));
  bad += same.length + ds.length;
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
