// Door / moving-part detector: opens every door and looks for render geometry left hanging in the opening.
// Usage: node scripts/check-doors.mjs [--url http://127.0.0.1:5173] [--level 1|2|all] [--door <id>] [--noshots]
//          [--shrink 0.03] [--shrink-x 0.1] [--depth 0.6] [--floor 0.06] [--machines]
//  * opening volume (door-local): x within the clear width (+-w/2), y floor..lintel, z +-depth (frame thickness is 0.2; default 0.6 so things hung in front of / behind the opening count too),
//    shrunk by --shrink (y, z) and --shrink-x (across the opening: the frame's own chevron strips and foot blocks poke 5 cm in); --floor = lowest y considered (threshold strips are below it).
//  * every triangle of every visible mesh that intersects the volume is a finding, unless it belongs to a mesh
//    under the door's own group (the leaves) AND that mesh is not inside... (those are reported separately as "own part in opening").
//  * reverse check: meshes under a leaf group whose bounding box is far from the door footprint (wrong parent).
//  * --machines: for level-2 named machines (setMachine) also report static geometry left inside the volume vacated by moved nodes.
// Rules: opening (hanging in the clear opening), (a) pocket the open leaf occupies is free of static geometry/glass,
//   (b) open leaf is enclosed by wall faces on both sides (ray test, 0.45 m), (c) no static detail triangle (< 0.03 m2) within 2.5 cm of the closed leaf faces; big wall faces/caps are ignored for (a) and (c) (always touch by design), glass never.
// Exit code 1 when anything is found.
import { parseArgs, levelsOf, launch, bootLevel, writeJson } from './lib/check-common.mjs';

const args = parseArgs();
const base = args.url ?? 'http://127.0.0.1:5173';
const opts = { shrink: Number(args.shrink ?? 0.03), shrinkX: Number(args['shrink-x'] ?? 0.1), depth: Number(args.depth ?? 0.6), floor: Number(args.floor ?? 0.06) };

/**
 * In page. mode 'closed': leaf boxes of the door as it rests now + static triangles within 3 cm of the closed leaves (rule c).
 *          mode 'open'  : opening volume, leaf pocket (rule a), wall enclosure of the open leaf (rule b), wrong parents.
 * All triangle work is exact (instances expanded, merged zone meshes walked per triangle).
 */
function pageAnalyse(o) {
  const g = window.__game;
  g.scene.updateMatrixWorld(true);
  const door = g.level.doors.find((d) => d.id === o.id);
  const root = g.level.object(o.id);
  const w = door.w, h = door.h, wall = door.spec.wall;
  const px = door.position.x, pz = door.position.z;
  const vm = g.render?.viewmodelLayer;
  const nameOf = (obj) => { if (obj.name) return [obj.name, 'mesh.name']; for (let p = obj.parent; p; p = p.parent) if (p.name) return [`${p.name}/<unnamed>`, 'parent.name']; return [`<${obj.type}#${obj.id}>`, 'none']; };
  const matNames = (m) => (Array.isArray(m) ? m : [m]).map((x) => x?.name || `<anon ${x?.type}#${x?.id}>`).join(',');
  const isGlass = (m) => (Array.isArray(m) ? m : [m]).some((x) => x && (/glass|window|pane(?!l)/i.test(x.name || '') || (x.transparent && x.opacity < 0.9)));
  const skipMat = (m) => m && (m.visible === false || m.colorWrite === false || m.opacity === 0 || (m.depthWrite === false && !isGlass(m)));
  const boxOfNode = (node) => {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; let any = false;
    node.updateWorldMatrix(true, true);
    node.traverse((x) => {
      if (!x.isMesh || !x.geometry) return;
      if (!x.geometry.boundingBox) x.geometry.computeBoundingBox();
      const bb = x.geometry.boundingBox, M = x.matrixWorld.elements; any = true;
      for (const a of [bb.min.x, bb.max.x]) for (const b of [bb.min.y, bb.max.y]) for (const c of [bb.min.z, bb.max.z]) {
        const q = [M[0] * a + M[4] * b + M[8] * c + M[12], M[1] * a + M[5] * b + M[9] * c + M[13], M[2] * a + M[6] * b + M[10] * c + M[14]];
        for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], q[i]); mx[i] = Math.max(mx[i], q[i]); }
      }
    });
    return any ? { mn, mx } : null;
  };
  const leafGroups = root.children.filter((c) => !/:status$/.test(c.name) && boxOfNode(c));
  const mkBox = (mn, mx) => ({ c: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], e: [(mx[0] - mn[0]) / 2, (mx[1] - mn[1]) / 2, (mx[2] - mn[2]) / 2] });
  const tests = []; // {key, B, own:false}
  if (o.mode === 'closed') {
    // rule c: 3 cm off the faces of each closed leaf (shrunk 2 cm sideways so the jamb liners do not count)
    leafGroups.forEach((lg, i) => {
      const b = boxOfNode(lg); const zAxis = wall === 'z' ? 2 : 0;
      const mn = b.mn.slice(), mx = b.mx.slice();
      for (let k = 0; k < 3; k++) { if (k === zAxis) { mn[k] -= 0.025; mx[k] += 0.025; } else { mn[k] += 0.02; mx[k] -= 0.02; } }
      tests.push({ key: `closed-leaf${i}`, B: mkBox(mn, mx), leaf: b });
    });
  } else {
    const sill = door.y0 ?? 0; // doors standing on a raised sill (tunnel shutters on the belt)
    const hw = w / 2 - o.shrinkX, hd = o.depth - o.shrink, y0 = sill + o.floor, y1 = sill + h - o.shrink;
    tests.push({ key: 'opening', B: wall === 'z' ? { c: [px, (y0 + y1) / 2, pz], e: [hw, (y1 - y0) / 2, hd] } : { c: [px, (y0 + y1) / 2, pz], e: [hd, (y1 - y0) / 2, hw] } });
    leafGroups.forEach((lg, i) => {
      const b = boxOfNode(lg); const mn = b.mn.map((v) => v + 0.03), mx = b.mx.map((v) => v - 0.03);
      tests.push({ key: `pocket${i}`, B: mkBox(mn, mx), leaf: b });
    });
  }
  const out = new Map(); let skippedHidden = 0, ignoredBig = 0;
  const encl = []; // static tris near open leaves (for rule b)
  const wideBoxes = tests.filter((t) => t.key.startsWith('pocket')).map((t) => ({ lo: t.leaf.mn.map((v) => v - 0.6), hi: t.leaf.mx.map((v) => v + 0.6) }));
  const triBox = (v, B) => {
    const c = B.c, e = B.e;
    const a = [v[0] - c[0], v[1] - c[1], v[2] - c[2]], b = [v[3] - c[0], v[4] - c[1], v[5] - c[2]], d = [v[6] - c[0], v[7] - c[1], v[8] - c[2]];
    for (let i = 0; i < 3; i++) if (Math.min(a[i], b[i], d[i]) > e[i] || Math.max(a[i], b[i], d[i]) < -e[i]) return false;
    const f = [[b[0] - a[0], b[1] - a[1], b[2] - a[2]], [d[0] - b[0], d[1] - b[1], d[2] - b[2]], [a[0] - d[0], a[1] - d[1], a[2] - d[2]]];
    for (const fe of f) for (const u of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const n = [u[1] * fe[2] - u[2] * fe[1], u[2] * fe[0] - u[0] * fe[2], u[0] * fe[1] - u[1] * fe[0]];
      const p0 = a[0] * n[0] + a[1] * n[1] + a[2] * n[2], p1 = b[0] * n[0] + b[1] * n[1] + b[2] * n[2], p2 = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
      const r = e[0] * Math.abs(n[0]) + e[1] * Math.abs(n[1]) + e[2] * Math.abs(n[2]);
      if (Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r) return false;
    }
    const nn = [f[0][1] * f[1][2] - f[0][2] * f[1][1], f[0][2] * f[1][0] - f[0][0] * f[1][2], f[0][0] * f[1][1] - f[0][1] * f[1][0]];
    const r = e[0] * Math.abs(nn[0]) + e[1] * Math.abs(nn[1]) + e[2] * Math.abs(nn[2]);
    return Math.abs(a[0] * nn[0] + a[1] * nn[1] + a[2] * nn[2]) <= r;
  };
  const record = (key, mesh, nm, tag, mats, W, own, glass) => {
    const k = `${key}|${nm}|${mats}`; let e = out.get(k);
    if (!e) out.set(k, e = { test: key, mesh: nm, nameSrc: tag, material: mats, tris: 0, own, glass, instanced: !!mesh.isInstancedMesh, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] });
    e.tris++;
    for (let i = 0; i < 3; i++) for (let k2 = 0; k2 < 3; k2++) { e.min[k2] = Math.min(e.min[k2], W[i * 3 + k2]); e.max[k2] = Math.max(e.max[k2], W[i * 3 + k2]); }
  };
  const walk = (obj, own) => {
    if (!obj.visible) { skippedHidden++; return; }
    if (obj.isSprite || obj.isLine || obj.isPoints || obj.isLight || obj.isCamera) return;
    if (obj === root) own = true;
    if (obj.isMesh) tryMesh(obj, own);
    for (const c of obj.children) walk(c, own);
  };
  const tryMesh = (mesh, own) => {
    if (vm !== undefined && mesh.layers.isEnabled(vm)) return;
    const [nm, tag] = nameOf(mesh);
    if (/collider/i.test(nm)) return;
    const m = mesh.material;
    if (Array.isArray(m) ? m.every(skipMat) : skipMat(m)) return;
    const isFrame = /^frames/.test(nm); // the door's own frame zone: its liners/jambs legitimately touch the leaf
    const glass = isGlass(m), mats = matNames(m);
    const geo = mesh.geometry, pos = geo?.attributes?.position; if (!pos) return;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const bs = geo.boundingSphere, M = mesh.matrixWorld.elements;
    const n = mesh.isInstancedMesh ? mesh.count : 1;
    const idx = geo.index, tc = (idx ? idx.count : pos.count) / 3;
    const stride = pos.data ? pos.data.stride : pos.itemSize, off = pos.offset ?? 0, arr = pos.data ? pos.data.array : pos.array, ia = idx ? idx.array : null;
    const IM = new Array(16), e = new Array(16), W = new Float64Array(9);
    const reach = tests.map((t) => Math.hypot(...t.B.e)); const maxReach = Math.max(...reach, 0) + 0.6 + 6;
    for (let i = 0; i < n; i++) {
      let mm = M;
      if (mesh.isInstancedMesh) { const t = mesh.instanceMatrix.array; for (let k = 0; k < 16; k++) e[k] = t[i * 16 + k]; for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += M[k * 4 + r] * e[c * 4 + k]; IM[c * 4 + r] = s; } mm = IM; }
      const sc = Math.max(Math.hypot(mm[0], mm[1], mm[2]), Math.hypot(mm[4], mm[5], mm[6]), Math.hypot(mm[8], mm[9], mm[10]));
      const cx = mm[0] * bs.center.x + mm[4] * bs.center.y + mm[8] * bs.center.z + mm[12], cy = mm[1] * bs.center.x + mm[5] * bs.center.y + mm[9] * bs.center.z + mm[13], cz = mm[2] * bs.center.x + mm[6] * bs.center.y + mm[10] * bs.center.z + mm[14];
      let near = false;
      for (const t of tests) if (Math.hypot(cx - t.B.c[0], cy - t.B.c[1], cz - t.B.c[2]) <= bs.radius * sc + Math.hypot(...t.B.e) + 0.7) { near = true; break; }
      if (!near) continue;
      for (let t = 0; t < tc; t++) {
        for (let k = 0; k < 3; k++) {
          const vi = ia ? ia[t * 3 + k] : t * 3 + k, x = arr[vi * stride + off], y = arr[vi * stride + off + 1], z = arr[vi * stride + off + 2];
          W[k * 3] = mm[0] * x + mm[4] * y + mm[8] * z + mm[12]; W[k * 3 + 1] = mm[1] * x + mm[5] * y + mm[9] * z + mm[13]; W[k * 3 + 2] = mm[2] * x + mm[6] * y + mm[10] * z + mm[14];
        }
        let area = -1;
        if (W[1] < -50) continue; // stashed far below (elevator shaft parts)
        for (const tt of tests) if (triBox(W, tt.B)) {
          if (tt.key !== 'opening') {
            if (isFrame) continue;
            // pocket / closed-leaf rules look at details (bolts, mullions, glass); big wall faces/caps always touch a pocket by design
            if (area < 0) { const ax = W[3] - W[0], ay = W[4] - W[1], az = W[5] - W[2], bx = W[6] - W[0], by = W[7] - W[1], bz = W[8] - W[2]; area = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2; }
            if (area > 0.03 && !glass) { ignoredBig++; continue; }
          }
          record(tt.key, mesh, nm, tag, mats, W, own, glass);
        }
        if (!own && wideBoxes.length) for (const wb of wideBoxes) {
          let ok = true; for (let k = 0; k < 3 && ok; k++) { const lo = Math.min(W[k], W[3 + k], W[6 + k]), hi = Math.max(W[k], W[3 + k], W[6 + k]); if (hi < wb.lo[k] || lo > wb.hi[k]) ok = false; }
          if (ok) { encl.push({ v: Array.from(W), glass, nm }); break; }
        }
      }
    }
  };
  walk(g.scene, false);

  const findings = [...out.values()].map((f) => ({ ...f, min: f.min.map((v) => +v.toFixed(2)), max: f.max.map((v) => +v.toFixed(2)) }));
  const res = { id: o.id, kind: door.spec.kind, wall, pos: [px, pz], t: door.t, locked: door.locked, rooms: door.spec.rooms, skippedHiddenNodes: skippedHidden, ignoredBigFaces: ignoredBig, findings };
  if (o.mode === 'closed') return res;

  // rule b: is every sample point of the open leaf enclosed by wall faces on both sides (local +-z within 0.45 m)?
  const rayHit = (p, d) => {
    let best = 1e9;
    for (const T of encl) {
      const v = T.v, e1 = [v[3] - v[0], v[4] - v[1], v[5] - v[2]], e2 = [v[6] - v[0], v[7] - v[1], v[8] - v[2]];
      const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2]; if (Math.abs(det) < 1e-9) continue;
      const inv = 1 / det, s = [p[0] - v[0], p[1] - v[1], p[2] - v[2]];
      const u = (s[0] * pv[0] + s[1] * pv[1] + s[2] * pv[2]) * inv; if (u < 0 || u > 1) continue;
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
      const wv = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv; if (wv < 0 || u + wv > 1) continue;
      const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv; if (t > 0 && t < best) best = t;
    }
    return best;
  };
  const exposed = [];
  const zd = wall === 'z' ? [0, 0, 1] : [1, 0, 0];
  leafGroups.forEach((lg, i) => {
    const b = boxOfNode(lg); let bad = 0, tot = 0; const samples = [];
    for (let fx = 0.1; fx < 1; fx += 0.2) for (let fy = 0.1; fy < 1; fy += 0.2) {
      // sample across the leaf face; only points still inside the door's slab length are considered (skip sampling past the wall edge)
      const p = [b.mn[0] + (b.mx[0] - b.mn[0]) * fx, b.mn[1] + (b.mx[1] - b.mn[1]) * fy, b.mn[2] + (b.mx[2] - b.mn[2]) * (wall === 'z' ? 0.5 : fx)];
      if (wall === 'z') p[2] = (b.mn[2] + b.mx[2]) / 2; else p[0] = (b.mn[0] + b.mx[0]) / 2;
      const hi = rayHit(p, zd), lo = rayHit(p, zd.map((v) => -v));
      tot++;
      if (hi > 0.45 || lo > 0.45) { bad++; if (samples.length < 4) samples.push({ at: p.map((v) => +v.toFixed(2)), plus: +Math.min(hi, 9).toFixed(2), minus: +Math.min(lo, 9).toFixed(2) }); }
    }
    exposed.push({ leaf: lg.name || lg.type, box: { min: b.mn.map((v) => +v.toFixed(2)), max: b.mx.map((v) => +v.toFixed(2)) }, unenclosedSamples: bad, samples: tot, examples: samples });
  });
  res.enclosure = exposed;

  // reverse sanity: meshes under leaf groups far from the door footprint (wrong parent)
  const wrong = [];
  const fy = door.floor ?? 0; // (stage 3a: a Deck-2 door's leaves stand on its floor)
  const toLocal = (wx, wy, wz) => { const dx = wx - px, dz = wz - pz; return wall === 'z' ? [dx, wy - fy, dz] : [dz, wy - fy, -dx]; };
  for (const lg of root.children) lg.traverse((m) => {
    if (!m.isMesh || m.name?.endsWith(':status') || !m.geometry) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox, M = m.matrixWorld.elements, c = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
    const l = toLocal(M[0] * c[0] + M[4] * c[1] + M[8] * c[2] + M[12], M[1] * c[0] + M[5] * c[1] + M[9] * c[2] + M[13], M[2] * c[0] + M[6] * c[1] + M[10] * c[2] + M[14]);
    const slideX = door.spec.kind === 'std' ? w + 0.3 : w / 2 + 0.3, slideY = door.spec.kind === 'std' ? h + 0.5 : h + 2.2;
    if (Math.abs(l[0]) > slideX || l[1] > slideY || l[1] < -2.2 || Math.abs(l[2]) > 0.5) wrong.push({ mesh: nameOf(m)[0], material: matNames(m.material), local: l.map((v) => +v.toFixed(2)), group: lg.name || lg.type });
  });
  res.wrong = wrong;
  return res;
}

/** In page. stage 'pre' | 'mid' | 'post': snapshot world matrices under the level root; 'post' returns the analysis. */
function machineStage({ stage, o }) {
  const g = window.__game; g.scene.updateMatrixWorld(true);
  const snap = () => { const m = new Map(); g.level.root.traverse((x) => { if (!x.isInstancedMesh) m.set(x, Float64Array.from(x.matrixWorld.elements)); }); return m; };
  if (stage === 'pre') { window.__pre = snap(); return null; }
  if (stage === 'mid') { window.__mid = snap(); return null; }
  const pre = window.__pre, mid = window.__mid, post = snap();
  const diff = (a, b) => { if (!a || !b) return 0; let d = 0; for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; };
  const continuous = new Set(), moved = new Set();
  for (const [x] of post) { if (diff(mid.get(x), post.get(x)) > 0.003) continuous.add(x); else if (diff(pre.get(x), post.get(x)) > 0.03) moved.add(x); }
  const inSet = (x, S) => { for (let p = x; p; p = p.parent) if (S.has(p)) return true; return false; };
  const top = [...moved].filter((x) => !x.parent || !inSet(x.parent, moved)).filter((x) => !inSet(x, continuous));
  const bboxOf = (node, mats) => {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; let any = false;
    node.traverse((x) => {
      if (!x.isMesh || !x.geometry) return; if (!x.geometry.boundingBox) x.geometry.computeBoundingBox();
      const bb = x.geometry.boundingBox, M = mats.get(x); if (!M) return; any = true;
      for (const px of [bb.min.x, bb.max.x]) for (const py of [bb.min.y, bb.max.y]) for (const pz of [bb.min.z, bb.max.z]) {
        const w = [M[0] * px + M[4] * py + M[8] * pz + M[12], M[1] * px + M[5] * py + M[9] * pz + M[13], M[2] * px + M[6] * py + M[10] * pz + M[14]];
        for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], w[i]); mx[i] = Math.max(mx[i], w[i]); }
      }
    });
    return any ? { mn, mx } : null;
  };
  const movedAll = new Set(); for (const t of top) t.traverse((x) => movedAll.add(x));
  const out = [];
  for (const node of top) {
    const B0 = bboxOf(node, pre), B1 = bboxOf(node, post);
    if (!B0 || !B1) continue;
    const sh = o.shrink;
    const inside = (p, B, k) => p[0] > B.mn[0] + k && p[0] < B.mx[0] - k && p[1] > B.mn[1] + k && p[1] < B.mx[1] - k && p[2] > B.mn[2] + k && p[2] < B.mx[2] - k;
    const hits = new Map();
    g.level.root.traverse((m) => {
      if (!m.isMesh || !m.visible || movedAll.has(m) || inSet(m, continuous) || !post.get(m)) return;
      if (Array.isArray(m.material) ? false : (m.material.depthWrite === false || m.material.visible === false || m.material.colorWrite === false)) return;
      if (/collider/i.test(m.name)) return;
      const geo = m.geometry, pos = geo.attributes.position, idx = geo.index, M = post.get(m);
      if (!geo.boundingBox) geo.computeBoundingBox();
      // quick reject on mesh bbox
      const bb = geo.boundingBox; const c = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
      const r = Math.hypot(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) / 2 * Math.max(Math.hypot(M[0], M[1], M[2]), 1e-6) * 1.5;
      const wc = [M[0] * c[0] + M[4] * c[1] + M[8] * c[2] + M[12], M[1] * c[0] + M[5] * c[1] + M[9] * c[2] + M[13], M[2] * c[0] + M[6] * c[1] + M[10] * c[2] + M[14]];
      if (!inside(wc, { mn: B0.mn.map((v) => v - r), mx: B0.mx.map((v) => v + r) }, 0)) return;
      const tc = (idx ? idx.count : pos.count) / 3; const arr = pos.array, st = pos.itemSize;
      for (let t = 0; t < tc; t++) {
        const cc = [0, 0, 0];
        for (let k = 0; k < 3; k++) { const vi = idx ? idx.array[t * 3 + k] : t * 3 + k; const x = arr[vi * st], y = arr[vi * st + 1], z = arr[vi * st + 2]; cc[0] += (M[0] * x + M[4] * y + M[8] * z + M[12]) / 3; cc[1] += (M[1] * x + M[5] * y + M[9] * z + M[13]) / 3; cc[2] += (M[2] * x + M[6] * y + M[10] * z + M[14]) / 3; }
        if (inside(cc, B0, sh) && !inside(cc, B1, 0)) {
          const k = m.name || m.parent?.name || m.type; let e = hits.get(k);
          if (!e) hits.set(k, e = { mesh: k, material: Array.isArray(m.material) ? '[multi]' : (m.material.name || `<anon #${m.material.id}>`), tris: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] });
          e.tris++; for (let i = 0; i < 3; i++) { e.min[i] = Math.min(e.min[i], cc[i]); e.max[i] = Math.max(e.max[i], cc[i]); }
        }
      }
    });
    out.push({ node: node.name || node.parent?.name || node.type, before: B0, after: B1, left: [...hits.values()].map((e) => ({ ...e, min: e.min.map((v) => +v.toFixed(2)), max: e.max.map((v) => +v.toFixed(2)) })) });
  }
  return { moved: top.length, continuousNodes: continuous.size, nodes: out };
}

const waitT = (page, id, goal) => page.waitForFunction(([id, goal]) => { const d = window.__game.level.doors.find((x) => x.id === id); return Math.abs(d.t - goal) < 1e-3; }, [id, goal], { timeout: 8000 }).catch(() => {});

async function shots(page, id, tag, pos, wall, outPrefix, noShot = false) {
  const files = [];
  for (const side of noShot ? [1] : [1, -1]) {
    const f = `shots/checks/door-${id}-${tag}${side > 0 ? 'A' : 'B'}.png`;
    await page.evaluate(({ pos, wall, side }) => {
      const g = window.__game, Vec = g.camera.position.constructor;
      const dx = wall === 'z' ? 0 : 3 * side, dz = wall === 'z' ? 3 * side : 0;
      const ex = pos[0] + dx, ez = pos[1] + dz;
      const lx = pos[0] - ex, lz = pos[1] - ez, ly = 1.3 - 1.6;
      g.player.teleport(new Vec(ex, 0, ez), Math.atan2(-lx, -lz), Math.atan2(ly, Math.hypot(lx, lz)));
    }, { pos, wall, side });
    await page.waitForTimeout(noShot ? 700 : 900);
    if (noShot) continue;
    await page.screenshot({ path: f });
    files.push(f);
  }
  return files;
}

const browser = await launch();
let bad = 0;
for (const level of levelsOf(args)) {
  const page = await bootLevel(browser, base, level);
  const ids = await page.evaluate(() => window.__game.level.doors.map((d) => d.id));
  const results = [];
  console.log(`\n=== DOORS level ${level}: ${ids.length} doors ===`);
  const recover = async () => { // the dev server hot-reloads the page when src/ changes under us: wait for the game again
    await page.waitForTimeout(3000);
    await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(2500);
  };
  for (const id of ids) {
    if (args.door && args.door !== id) continue;
    for (let attempt = 0; attempt < 3; attempt++) { try {
    const pp = await page.evaluate((id) => { const d = window.__game.level.doors.find((x) => x.id === id); d.unlock(); d.auto = false; return { pos: [d.position.x, d.position.z], wall: d.spec.wall }; }, id);
    // stand 3 m in front so room culling shows both rooms
    await shots(page, id, 'pre', pp.pos, pp.wall, null, true);
    await page.waitForTimeout(500);
    const rc = await page.evaluate(pageAnalyse, { id, mode: 'closed', ...opts });   // rule (c), door as it rests
    await page.evaluate((id) => window.__game.level.doors.find((x) => x.id === id).open(), id);
    await waitT(page, id, 1);
    await page.waitForTimeout(500);
    const r = await page.evaluate(pageAnalyse, { id, mode: 'open', ...opts });
    r.closedFindings = rc.findings;
    const staticLeft = r.findings.filter((f) => f.test === 'opening' && !f.own);
    const ownLeft = r.findings.filter((f) => f.test === 'opening' && f.own);
    const pocket = r.findings.filter((f) => f.test.startsWith('pocket') && !f.own);
    const baked = rc.findings.filter((f) => !f.own);
    const exposed = r.kind === 'std' ? (r.enclosure ?? []).filter((e) => e.unenclosedSamples > 0) : []; // wide/cage leaves rise/sink into slabs with no wall faces to test
    r.verdict = staticLeft.length || ownLeft.length || pocket.length || baked.length || exposed.length || r.wrong.length ? 'FINDINGS' : 'clean';
    if (r.t < 0.999) r.verdict += ' (door did not fully open: t=' + r.t.toFixed(2) + ')';
    console.log(`${id.padEnd(14)} ${r.kind.padEnd(5)} rooms=${r.rooms.join('/')} -> ${r.verdict}`);
    const fmt = (f) => `${f.mesh}{${f.material}}${f.glass ? ' [GLASS]' : ''} ${f.tris} tris${f.instanced ? ' (instanced)' : ''} (${f.min.join(', ')})-(${f.max.join(', ')})`;
    for (const f of staticLeft) console.log(`    A0 HANGING IN OPENING ${fmt(f)}`);
    for (const f of ownLeft) console.log(`    OWN PART IN OPENING ${fmt(f)}`);
    for (const f of pocket) console.log(`    A  POCKET OCCUPIED (${f.test}) ${fmt(f)}`);
    for (const e of exposed) console.log(`    B  OPEN LEAF NOT ENCLOSED ${e.leaf}: ${e.unenclosedSamples}/${e.samples} samples lack a wall face within 0.45 m on both sides, e.g. ${JSON.stringify(e.examples[0])}`);
    for (const f of baked) console.log(`    C  BAKED NEAR CLOSED LEAF (${f.test}) ${fmt(f)}`);
    for (const f of r.wrong) console.log(`    WRONG-PARENT? ${f.mesh}{${f.material}} local ${f.local.join(',')} under ${f.group}`);
    if (r.verdict.startsWith('FINDINGS')) bad++;
    if (!args.noshots) {
      r.shots = await shots(page, id, 'open', r.pos, r.wall);
      if (r.verdict.startsWith('FINDINGS')) {
        await page.evaluate((id) => window.__game.level.doors.find((x) => x.id === id).close(), id);
        await waitT(page, id, 0);
        await page.waitForTimeout(300);
        r.shots.push(...await shots(page, id, 'closed', r.pos, r.wall));
      }
    }
    await page.evaluate((id) => window.__game.level.doors.find((x) => x.id === id).close(), id);
    results.push(r);
    break;
    } catch (e) { console.log(`[retry ${id}] ${e.message.split('\n')[0]}`); await recover(); } }
  }
  const machines = [];
  if (args.machines && level === 2) {
    for (const name of ['l2_line', 'l2_tunnel', 'l2_core', 'l2_lift']) {
      await page.evaluate(machineStage, { stage: 'pre' });
      await page.evaluate((n) => window.__game.level.setMachine(n, 'active'), name);
      await page.waitForTimeout(5000);
      await page.evaluate(machineStage, { stage: 'mid' });
      await page.waitForTimeout(500);
      const r = await page.evaluate(machineStage, { stage: 'post', o: opts });
      console.log(`machine ${name}: ${r.moved} moved top nodes (${r.continuousNodes} continuously animated nodes ignored)`);
      for (const n of r.nodes) {
        console.log(`  node ${n.node}: ${n.left.length ? 'LEFT BEHIND ' : 'clean'}`);
        for (const f of n.left) console.log(`    ${f.mesh}{${f.material}} ${f.tris} tris (${f.min.join(', ')})-(${f.max.join(', ')})`);
        if (n.left.length) bad++;
      }
      machines.push({ name, ...r });
      await page.evaluate((n) => window.__game.level.setMachine(n, 'idle'), name);
    }
  }
  console.log('json:', writeJson('doors', level, { level, opts, doors: results, machines }));
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
