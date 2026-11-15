// Door / moving-part detector: opens every door and looks for render geometry left hanging in the opening.
// Usage: node scripts/check-doors.mjs [--url http://127.0.0.1:5173] [--level 1|2|all] [--door <id>] [--noshots]
//          [--shrink 0.03] [--shrink-x 0.1] [--depth 0.6] [--floor 0.06] [--machines]
//  * opening volume (door-local): x within the clear width (+-w/2), y floor..lintel, z +-depth (frame thickness is 0.2; default 0.6 so things hung in front of / behind the opening count too),
//    shrunk by --shrink (y, z) and --shrink-x (across the opening: the frame's own chevron strips and foot blocks poke 5 cm in); --floor = lowest y considered (threshold strips are below it).
//  * every triangle of every visible mesh that intersects the volume is a finding, unless it belongs to a mesh
//    under the door's own group (the leaves) AND that mesh is not inside... (those are reported separately as "own part in opening").
//  * reverse check: meshes under a leaf group whose bounding box is far from the door footprint (wrong parent).
//  * --machines: for level-2 named machines (setMachine) also report static geometry left inside the volume vacated by moved nodes.
// Exit code 1 when anything is found.
import { parseArgs, levelsOf, launch, bootLevel, writeJson } from './lib/check-common.mjs';

const args = parseArgs();
const base = args.url ?? 'http://127.0.0.1:5173';
const opts = { shrink: Number(args.shrink ?? 0.03), shrinkX: Number(args['shrink-x'] ?? 0.1), depth: Number(args.depth ?? 0.6), floor: Number(args.floor ?? 0.06) };

/** In page: shared triangle iteration over visible meshes. cb(mesh, info, tri world verts Float64Array(9), underDoorRoot) */
function pageAnalyse(o) {
  const g = window.__game;
  g.scene.updateMatrixWorld(true);
  const door = g.level.doors.find((d) => d.id === o.id);
  const root = g.level.object(o.id);
  const w = door.w, h = door.h, wall = door.spec.wall;
  const px = door.position.x, pz = door.position.z;
  const hw = w / 2 - o.shrinkX, hd = o.depth - o.shrink;
  const y0 = Math.max(o.floor, 0) , y1 = h - o.shrink;
  // world AABB of the opening volume (wall 'z': opening along x; 'x': along z)
  const B = wall === 'z' ? { c: [px, (y0 + y1) / 2, pz], e: [hw, (y1 - y0) / 2, hd] } : { c: [px, (y0 + y1) / 2, pz], e: [hd, (y1 - y0) / 2, hw] };
  const vm = g.render?.viewmodelLayer;
  const out = new Map();
  const hit = (mesh, name, tag, mats, centroid) => {
    const k = `${name}|${mats}`; let e = out.get(k);
    if (!e) out.set(k, e = { mesh: name, nameSrc: tag, material: mats, tris: 0, own: false, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], instanced: !!mesh.isInstancedMesh });
    e.tris++;
    for (let i = 0; i < 3; i++) { e.min[i] = Math.min(e.min[i], centroid[i]); e.max[i] = Math.max(e.max[i], centroid[i]); }
    return e;
  };
  // triangle / AABB SAT (Akenine-Moller)
  const triBox = (v) => {
    const c = B.c, e = B.e;
    const a = [v[0] - c[0], v[1] - c[1], v[2] - c[2]], b = [v[3] - c[0], v[4] - c[1], v[5] - c[2]], d = [v[6] - c[0], v[7] - c[1], v[8] - c[2]];
    for (let i = 0; i < 3; i++) { if (Math.min(a[i], b[i], d[i]) > e[i] || Math.max(a[i], b[i], d[i]) < -e[i]) return false; }
    const f = [[b[0] - a[0], b[1] - a[1], b[2] - a[2]], [d[0] - b[0], d[1] - b[1], d[2] - b[2]], [a[0] - d[0], a[1] - d[1], a[2] - d[2]]];
    const ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (const fe of f) for (const u of ax) {
      const n = [u[1] * fe[2] - u[2] * fe[1], u[2] * fe[0] - u[0] * fe[2], u[0] * fe[1] - u[1] * fe[0]];
      const p0 = a[0] * n[0] + a[1] * n[1] + a[2] * n[2], p1 = b[0] * n[0] + b[1] * n[1] + b[2] * n[2], p2 = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
      const r = e[0] * Math.abs(n[0]) + e[1] * Math.abs(n[1]) + e[2] * Math.abs(n[2]);
      if (Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r) return false;
    }
    const nn = [fe0(f)[0], fe0(f)[1], fe0(f)[2]];
    const dd = a[0] * nn[0] + a[1] * nn[1] + a[2] * nn[2];
    const r = e[0] * Math.abs(nn[0]) + e[1] * Math.abs(nn[1]) + e[2] * Math.abs(nn[2]);
    return Math.abs(dd) <= r;
  };
  const fe0 = (f) => [f[0][1] * f[1][2] - f[0][2] * f[1][1], f[0][2] * f[1][0] - f[0][0] * f[1][2], f[0][0] * f[1][1] - f[0][1] * f[1][0]];

  const nameOf = (obj) => { if (obj.name) return [obj.name, 'mesh.name']; for (let p = obj.parent; p; p = p.parent) if (p.name) return [`${p.name}/<unnamed>`, 'parent.name']; return [`<${obj.type}#${obj.id}>`, 'none']; };
  const matNames = (m) => (Array.isArray(m) ? m : [m]).map((x) => x?.name || `<anon ${x?.type}#${x?.id}>`).join(',');
  const skipMat = (m) => m && (m.depthWrite === false || m.visible === false || m.colorWrite === false || m.opacity === 0);
  const sph = new Float64Array(4);
  let skippedHidden = 0;
  const walk = (obj, own) => {
    if (!obj.visible) { skippedHidden++; return; } // hidden by its owner (pooled fx, stashed props) or room-culled (player is placed at the door first)
    if (obj.isSprite || obj.isLine || obj.isPoints || obj.isLight || obj.isCamera) return;
    if (obj === root) own = true;
    if (obj.isMesh) tryMesh(obj, own);
    for (const c of obj.children) walk(c, own);
  };
  const tryMesh = (mesh, own) => {
    if (!mesh.visible && !own) { /* room-culled meshes are still real geometry; keep them */ }
    if (vm !== undefined && mesh.layers.isEnabled(vm)) return;
    const [nm, tag] = nameOf(mesh);
    if (/collider/i.test(nm)) return;
    const m = mesh.material;
    if (Array.isArray(m) ? m.every(skipMat) : skipMat(m)) return;
    const geo = mesh.geometry; const pos = geo?.attributes?.position; if (!pos) return;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const bs = geo.boundingSphere; const M = mesh.matrixWorld.elements;
    const n = mesh.isInstancedMesh ? mesh.count : 1;
    const idx = geo.index, tc = (idx ? idx.count : pos.count) / 3;
    const stride = pos.data ? pos.data.stride : pos.itemSize, off = pos.offset ?? 0, arr = pos.data ? pos.data.array : pos.array, ia = idx ? idx.array : null;
    const IM = new Array(16), e = new Array(16);
    const rad = Math.hypot(...B.e);
    const W = new Float64Array(9);
    for (let i = 0; i < n; i++) {
      let mm = M;
      if (mesh.isInstancedMesh) { const t = mesh.instanceMatrix.array; for (let k = 0; k < 16; k++) e[k] = t[i * 16 + k]; for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += M[k * 4 + r] * e[c * 4 + k]; IM[c * 4 + r] = s; } mm = IM; }
      const sc = Math.max(Math.hypot(mm[0], mm[1], mm[2]), Math.hypot(mm[4], mm[5], mm[6]), Math.hypot(mm[8], mm[9], mm[10]));
      const cx = mm[0] * bs.center.x + mm[4] * bs.center.y + mm[8] * bs.center.z + mm[12], cy = mm[1] * bs.center.x + mm[5] * bs.center.y + mm[9] * bs.center.z + mm[13], cz = mm[2] * bs.center.x + mm[6] * bs.center.y + mm[10] * bs.center.z + mm[14];
      const dx = cx - B.c[0], dy = cy - B.c[1], dz = cz - B.c[2];
      if (Math.hypot(dx, dy, dz) > bs.radius * sc + rad) continue;
      for (let t = 0; t < tc; t++) {
        for (let k = 0; k < 3; k++) {
          const vi = ia ? ia[t * 3 + k] : t * 3 + k, x = arr[vi * stride + off], y = arr[vi * stride + off + 1], z = arr[vi * stride + off + 2];
          W[k * 3] = mm[0] * x + mm[4] * y + mm[8] * z + mm[12]; W[k * 3 + 1] = mm[1] * x + mm[5] * y + mm[9] * z + mm[13]; W[k * 3 + 2] = mm[2] * x + mm[6] * y + mm[10] * z + mm[14];
        }
        if (triBox(W)) { const ent = hit(mesh, nm, tag, matNames(m), [(W[0] + W[3] + W[6]) / 3, (W[1] + W[4] + W[7]) / 3, (W[2] + W[5] + W[8]) / 3]); ent.own = ent.own || own; }
      }
    }
  };
  walk(g.scene, false);

  // reverse sanity: meshes under the door's leaf groups whose bounding box is far from the door footprint
  const wrong = [];
  const leafGroups = root.children.filter((c) => c.children.length || c.isMesh);
  root.updateMatrixWorld(true);
  const toLocal = (wx, wy, wz) => { const dx = wx - px, dz = wz - pz; return wall === 'z' ? [dx, wy, dz] : [dz * 1, wy, -dx]; };
  for (const lg of root.children) {
    lg.traverse((m) => {
      if (!m.isMesh || m.name?.endsWith(':status')) return;
      const geo = m.geometry; if (!geo) return; if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox, M = m.matrixWorld.elements;
      const ctr = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
      const wx = M[0] * ctr[0] + M[4] * ctr[1] + M[8] * ctr[2] + M[12], wy = M[1] * ctr[0] + M[5] * ctr[1] + M[9] * ctr[2] + M[13], wz = M[2] * ctr[0] + M[6] * ctr[1] + M[10] * ctr[2] + M[14];
      const l = toLocal(wx, wy, wz);
      // expected: within the door footprint when closed +- the open travel (std leaves slide w/2 sideways, wide/cage move 1.6 vertically)
      const slideX = door.spec.kind === 'std' ? w + 0.3 : w / 2 + 0.3, slideY = door.spec.kind === 'std' ? h + 0.5 : h + 2.2;
      const far = Math.abs(l[0]) > slideX || l[1] > slideY || l[1] < -2.2 || Math.abs(l[2]) > 0.5;
      if (far) wrong.push({ mesh: nameOf(m)[0], material: matNames(m.material), local: l.map((v) => +v.toFixed(2)), group: lg.name || lg.type });
    });
  }
  const leaves = root.children.map((c) => ({ name: c.name || c.type, pos: c.position.toArray().map((v) => +v.toFixed(3)), meshes: (() => { let k = 0; c.traverse((x) => x.isMesh && k++); return k; })() }));
  const findings = [...out.values()].map((f) => ({ ...f, min: f.min.map((v) => +v.toFixed(2)), max: f.max.map((v) => +v.toFixed(2)) }));
  return { skippedHiddenNodes: skippedHidden, id: o.id, kind: door.spec.kind, wall, pos: [px, pz], t: door.t, locked: door.locked, rooms: door.spec.rooms, volume: B, leaves, findings, wrong };
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
  for (const id of ids) {
    if (args.door && args.door !== id) continue;
    await page.evaluate((id) => { const d = window.__game.level.doors.find((x) => x.id === id); d.unlock(); d.auto = false; d.open(); }, id);
    await page.evaluate((id) => { /* park the player away so nothing else interferes */ }, id);
    await waitT(page, id, 1);
    // stand 3 m in front so the level's room culling shows both rooms the door connects
    const pp = await page.evaluate((id) => { const d = window.__game.level.doors.find((x) => x.id === id); return { pos: [d.position.x, d.position.z], wall: d.spec.wall }; }, id);
    await shots(page, id, 'pre', pp.pos, pp.wall, null, true);
    await page.waitForTimeout(500);
    const r = await page.evaluate(pageAnalyse, { id, ...opts });
    const left = r.findings;
    const ownLeft = left.filter((f) => f.own), staticLeft = left.filter((f) => !f.own);
    r.verdict = staticLeft.length || r.wrong.length || ownLeft.length ? 'FINDINGS' : 'clean';
    if (r.t < 0.999) r.verdict += ' (door did not fully open: t=' + r.t.toFixed(2) + ')';
    console.log(`${id.padEnd(14)} ${r.kind.padEnd(5)} rooms=${r.rooms.join('/')} -> ${r.verdict}`);
    for (const f of staticLeft) console.log(`    HANGING ${f.mesh}{${f.material}} ${f.tris} tris${f.instanced ? ' (instanced)' : ''} between (${f.min.join(', ')}) and (${f.max.join(', ')})`);
    for (const f of ownLeft) console.log(`    OWN-PART-IN-OPENING ${f.mesh}{${f.material}} ${f.tris} tris (${f.min.join(', ')})-(${f.max.join(', ')})`);
    for (const f of r.wrong) console.log(`    WRONG-PARENT? ${f.mesh}{${f.material}} local ${f.local.join(',')} under ${f.group}`);
    if (r.verdict.startsWith('FINDINGS')) bad++;
    if (!args.noshots) {
      r.shots = await shots(page, id, 'open', r.pos, r.wall);
      if (r.verdict.startsWith('FINDINGS')) {
        await page.evaluate((id) => { const d = window.__game.level.doors.find((x) => x.id === id); d.close(); }, id);
        await waitT(page, id, 0);
        await page.waitForTimeout(300);
        r.shots.push(...await shots(page, id, 'closed', r.pos, r.wall));
      }
    }
    await page.evaluate((id) => window.__game.level.doors.find((x) => x.id === id).close(), id);
    results.push(r);
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
