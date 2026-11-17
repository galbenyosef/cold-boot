// Decal-follow check (REVISION 5.2): persistent decals must never be left hanging where a moving thing used to be.
// Usage: node scripts/check-decals.mjs [--url http://127.0.0.1:5173] [--level 1|2|all] [--door <id>]
//          [--shots d_med,d2_gate]   (before / in motion / after screenshots of those doors → shots/decals/)
//          [--selftest]  shots drop the hit owner (the pre-5.2 world-space decals): door lines must FAIL
//  * every door: two bullets through the real path (physics.raycast + the 'bullet:impact' event the player's
//    hitscan emits, owner included) onto the closed leaves (std: left + right, wide / cage / shutters: upper +
//    lower). The new decal must sit within 2 cm of a leaf surface; then the door opens and the decal must be
//    either hidden / gone, or still within 2 cm of a leaf surface (it moved with the leaf). A decal still drawn
//    with no leaf surface under it is a FAIL.
//  * every registered mover (physics.movers: lift cabs, locker door, hatches, grille, lockout): a decal on its
//    surface (bullet path when a static collider coincides with it, fx.decal otherwise), the mover is moved
//    0.4 m (must follow), detached from the scene (must disappear), put back.
//  * a dynamic box with no owner (wreck boxes, hanging loads, tunnel arms default to 'transient'): a shot onto
//    it must leave no persistent decal. A shot onto the static world must leave an unanchored decal as before.
// Exit code 1 on any failure.
import { mkdirSync } from 'node:fs';
import { parseArgs, levelsOf, launch, bootLevel, writeJson } from './lib/check-common.mjs';

const args = parseArgs();
const base = args.url ?? 'http://127.0.0.1:5173';
const shotIds = new Set((args.shots ?? '').split(',').filter(Boolean));
const TOL = 0.02;
const SELFTEST = !!args.selftest;

/** In page: helpers (installed once per page). */
function install(selftest) {
  const g = window.__game;
  const H = {};
  // ray vs triangles of every visible mesh under `node` (world space, exact, independent of the game's code)
  H.rayNode = (node, o, d, far, frontOnly = false) => {
    let best = Infinity;
    node.updateWorldMatrix(true, true);
    node.traverse((m) => {
      if (!m.isMesh || !m.geometry || m.isInstancedMesh) return;
      if (!m.visible) return; // (ancestors may be room-culled for a frame: geometry still counts)
      const pos = m.geometry.attributes.position, idx = m.geometry.index, M = m.matrixWorld.elements;
      const n = idx ? idx.count : pos.count;
      const W = (i) => { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]; };
      for (let t = 0; t + 2 < n; t += 3) {
        const a = W(idx ? idx.getX(t) : t), b = W(idx ? idx.getX(t + 1) : t + 1), c = W(idx ? idx.getX(t + 2) : t + 2);
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
        const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
        if (Math.abs(det) < 1e-12 || (frontOnly && det < 0)) continue; // det > 0: front face (CCW) seen from the origin
        const inv = 1 / det, s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
        const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv; if (u < 0 || u > 1) continue;
        const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
        const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv; if (v < 0 || u + v > 1) continue;
        const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
        if (tt >= 0 && tt <= far && tt < best) best = tt;
      }
    });
    return best;
  };
  /** Distance from a decal centre to the nearest surface of `nodes` along its own normal (both ways, ±15 cm). */
  H.surfDist = (nodes, p, n) => {
    // centre + four points 4 mm around it in the decal plane (a hole shot exactly onto a leaf edge must not
    // fail on float noise once the leaf has moved)
    const t = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]], ul = Math.hypot(...u);
    const U = u.map((v) => v / ul), W = [n[1] * U[2] - n[2] * U[1], n[2] * U[0] - n[0] * U[2], n[0] * U[1] - n[1] * U[0]];
    let best = Infinity;
    for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = [0, 1, 2].map((k) => p[k] + (U[k] * a + W[k] * b) * 0.004 + n[k] * 0.15);
      for (const node of nodes) {
        const f = H.rayNode(node, q, [-n[0], -n[1], -n[2]], 0.3);
        if (f < Infinity) best = Math.min(best, Math.abs(f - 0.15));
      }
    }
    return best;
  };
  H.snapshot = () => g.fx.decalList().reduce((m, e) => Math.max(m, e.serial), 0);
  /** Decals placed since `before` (placement serials), newest first. */
  H.fresh = (before) => g.fx.decalList().filter((e) => e.serial > before).sort((a, b) => b.serial - a.serial);
  H.info = (key) => {
    const e = g.fx.decalList().find((x) => `${x.name}#${x.slot}` === key);
    if (!e) return null;
    const m = e.matrix.elements, nl = Math.hypot(m[8], m[9], m[10]) || 1;
    return { key, visible: e.visible, p: [m[12], m[13], m[14]], n: [m[8] / nl, m[9] / nl, m[10] / nl], anchor: e.anchor ? (e.anchor.name || e.anchor.type) : null, anchorObj: e.anchor };
  };
  H.door = (id) => g.level.doors.find((d) => d.id === id);
  H.leaves = (d) => [d.leaf(0), d.leaf(1)].filter(Boolean);
  H.bbox = (node) => {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    node.updateWorldMatrix(true, true);
    node.traverse((x) => {
      if (!x.isMesh || !x.geometry) return;
      if (!x.geometry.boundingBox) x.geometry.computeBoundingBox();
      const bb = x.geometry.boundingBox, M = x.matrixWorld.elements;
      for (const a of [bb.min.x, bb.max.x]) for (const b of [bb.min.y, bb.max.y]) for (const c of [bb.min.z, bb.max.z]) {
        const q = [M[0] * a + M[4] * b + M[8] * c + M[12], M[1] * a + M[5] * b + M[9] * c + M[13], M[2] * a + M[6] * b + M[10] * c + M[14]];
        for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], q[i]); mx[i] = Math.max(mx[i], q[i]); }
      }
    });
    return { mn, mx, c: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2] };
  };
  /** The player's hitscan, minus enemies: physics ray + the same event (owner included). */
  H.shoot = (o, d) => {
    const V = g.camera.position.constructor;
    const hit = g.physics.raycast(new V(...o), new V(...d).normalize(), 60);
    if (!hit) return null;
    g.events.emit('bullet:impact', { point: hit.point, normal: hit.normal, surface: hit.surface, owner: selftest ? undefined : hit.owner });
    return { point: hit.point.toArray(), owner: hit.owner === undefined ? 'static' : hit.owner === 'transient' ? 'transient' : (hit.owner.name || hit.owner.type), distance: hit.distance };
  };
  window.__dc = H;
}

const frames = (page, n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

/** In page: close + park the door; pick a side + distance from which a straight shot reaches each leaf; stand there. */
function doorSetup(id) {
  const g = window.__game, H = window.__dc, d = H.door(id), V = g.camera.position.constructor;
  d.unlock(); d.auto = false; d.close(); d.snap();
  const wall = d.spec.wall, px = d.position.x, pz = d.position.z, y0 = d.y0 ?? 0;
  const std = d.spec.kind === 'std';
  const targets = H.leaves(d).map((lf, i) => {
    const b = H.bbox(lf);
    // std: middle of each leaf, 1.2 m up; wide/cage/shutters: upper leaf 0.5 m above the seam, lower 0.45 m above the sill
    const tgt = [b.c[0], std ? y0 + 1.2 : i === 0 ? y0 + 1.75 : y0 + 0.45, b.c[2]];
    if (!std) { if (wall === 'z') tgt[0] = px + 0.35; else tgt[2] = pz - 0.35; } // off the centre tooth / bar
    return { lf, tgt };
  });
  for (const side of [1, -1]) for (const dist of [2.5, 1.5, 0.8]) {
    const nrm = wall === 'z' ? [0, 0, side] : [side, 0, 0];
    const aims = targets.map(({ lf, tgt }, i) => ({ leaf: lf.name || `leaf${i}`, o: [tgt[0] + nrm[0] * dist, tgt[1], tgt[2] + nrm[2] * dist], d: [-nrm[0], 0, -nrm[2]], lf }));
    const ok = aims.every((a) => { const h = g.physics.raycast(new V(...a.o), new V(...a.d), 5); return h && h.owner === a.lf; });
    if (!ok) continue;
    const ex = px + nrm[0] * 3, ez = pz + nrm[2] * 3;
    g.player.teleport(new V(ex, y0, ez), Math.atan2(-(px - ex), -(pz - ez)), Math.atan2(1.3 - 1.6, 3));
    return { kind: d.spec.kind, wall, side, dist, aims: aims.map(({ lf, ...a }) => a), y0 };
  }
  return { kind: d.spec.kind, wall, aims: [], y0, unreachable: true };
}

function shootLeaf(aim) {
  const H = window.__dc, g = window.__game;
  window.__before = H.snapshot();
  const hit = H.shoot(aim.o, aim.d);
  return hit;
}

function readFresh({ id }) {
  const H = window.__dc, d = H.door(id);
  const f = H.fresh(window.__before);
  if (!f.length) return null;
  const info = H.info(`${f[0].name}#${f[0].slot}`);
  return { key: info.key, visible: info.visible, p: info.p, anchor: info.anchor, onLeaf: H.surfDist(H.leaves(d), info.p, info.n) };
}

function readDecal({ id, key }) {
  const H = window.__dc, d = H.door(id);
  const info = H.info(key);
  if (!info) return { gone: true };
  return { visible: info.visible, p: info.p, anchor: info.anchor, onLeaf: info.visible ? H.surfDist(H.leaves(d), info.p, info.n) : null, t: d.t };
}

const waitT = (page, id, goal) => page.waitForFunction(([id, goal]) => Math.abs(window.__dc.door(id).t - goal) < 1e-3, [id, goal], { timeout: 8000 }).catch(() => {});
const f3 = (v) => v == null ? '-' : v === Infinity ? 'none' : (v * 100).toFixed(1) + 'cm';

async function doorShots(page, id, tag, setup) {
  mkdirSync('shots/decals', { recursive: true });
  const f = `shots/decals/l${setup.level}-${id}-${tag}.png`;
  await page.screenshot({ path: f });
  return f;
}

const browser = await launch();
let bad = 0;
const summary = [];
for (const level of levelsOf(args)) {
  const page = await bootLevel(browser, base, level);
  await page.evaluate(install, SELFTEST);
  const ids = await page.evaluate(() => window.__game.level.doors.map((d) => d.id));
  const out = { level, doors: [], movers: [], other: [] };
  console.log(`\n=== DECALS level ${level}: ${ids.length} doors ===`);
  for (const id of ids) {
    if (args.door && args.door !== id) continue;
    const setup = await page.evaluate(doorSetup, id);
    setup.level = level;
    if (setup.unreachable) { bad++; console.log(`${id.padEnd(16)} ${setup.kind.padEnd(5)} FAIL no straight shot reaches its leaves from either side`); out.doors.push({ id, ok: false, problems: ['unreachable'] }); continue; }
    await frames(page, 4);
    const wantShots = shotIds.has(id);
    const placed = [];
    const problems = [];
    // in shot mode: a few extra holes on each leaf so they read on screen
    const aims = wantShots ? setup.aims.flatMap((a) => [-0.25, 0, 0.25].flatMap((dx) => [-0.15, 0.2].map((dy) => ({ ...a, o: setup.wall === 'z' ? [a.o[0] + dx, a.o[1] + dy, a.o[2]] : [a.o[0], a.o[1] + dy, a.o[2] + dx] })))) : setup.aims;
    for (const aim of aims) {
      const hit = await page.evaluate(shootLeaf, aim);
      await frames(page, 2);
      const r = await page.evaluate(readFresh, { id });
      if (!hit) { problems.push(`${aim.leaf}: shot hit nothing`); continue; }
      if (!r) { problems.push(`${aim.leaf}: no decal placed (hit ${hit.owner} at ${hit.distance.toFixed(2)} m)`); continue; }
      if (!(r.onLeaf <= TOL)) problems.push(`${aim.leaf}: decal placed ${f3(r.onLeaf)} off the closed leaf (owner ${hit.owner}, anchor ${r.anchor})`);
      placed.push({ aim: aim.leaf, owner: hit.owner, key: r.key, p0: r.p, anchor: r.anchor, onLeaf0: r.onLeaf });
    }
    if (wantShots) {
      // step in to 1.8 m and let the sparks die down so the holes read
      await page.evaluate(({ id, side }) => {
        const g = window.__game, d = window.__dc.door(id), V = g.camera.position.constructor, s = side ?? 1;
        const ex = d.position.x + (d.spec.wall === 'z' ? 0 : 1.8 * s), ez = d.position.z + (d.spec.wall === 'z' ? 1.8 * s : 0);
        g.player.teleport(new V(ex, d.y0 ?? 0, ez), Math.atan2(-(d.position.x - ex), -(d.position.z - ez)), -0.05);
      }, { id, side: setup.side });
      await page.evaluate(() => { const p = window.__game.player; p.debug?.flashlight(true); if (!p.weapons.pistol.owned) p.give('pistol', 60); });
      await page.waitForTimeout(1200); // draw animation
      // the player's own weapon (player.debug.fire → weapons.ray): a few rounds at the leaves
      const before = await page.evaluate(() => { window.__imp = []; window.__game.events.on('bullet:impact', (e) => window.__imp.push([e.point.toArray().map((v) => +v.toFixed(2)), e.owner?.name ?? e.owner ?? 'static'])); return window.__dc.snapshot(); });
      for (const a of setup.aims) for (const [dx, dy] of [[-0.3, 0.25], [0.2, -0.1], [0, 0.45]]) {
        await page.evaluate(({ a, dx, dy, wall, dist }) => {
          const g = window.__game, e = g.camera.getWorldPosition(g.camera.position.clone());
          const t = [a.o[0] + a.d[0] * dist + (wall === 'z' ? dx : 0), a.o[1] + dy, a.o[2] + a.d[2] * dist + (wall === 'z' ? 0 : dx)];
          const v = [t[0] - e.x, t[1] - e.y, t[2] - e.z];
          g.player.yaw = Math.atan2(-v[0], -v[2]); g.player.pitch = Math.atan2(v[1], Math.hypot(v[0], v[2]));
        }, { a, dx, dy, wall: setup.wall, dist: setup.dist });
        await page.waitForTimeout(120);
        await page.evaluate(() => window.__game.player.debug.fire());
        await page.waitForTimeout(450);
      }
      const real = await page.evaluate(({ id, before }) => {
        const H = window.__dc, lv = H.leaves(H.door(id));
        const f = H.fresh(before);
        return { n: f.length, onLeaf: f.filter((e) => lv.includes(e.anchor)).length, list: f.map((e) => [e.anchor?.name ?? null, e.matrix.elements.slice(12, 15).map((v) => +v.toFixed(2))]), ev: window.__imp };
      }, { id, before });
      console.log(`    (player weapon: ${real.n} decals, ${real.onLeaf} anchored to this door's leaves)`);
      if (args.verbose) console.log(JSON.stringify(real));
      if (real.n === 0 || real.onLeaf !== real.n) problems.push(`player weapon: ${real.n - real.onLeaf} of ${real.n} decals not on the leaves`);
      await page.evaluate(({ id }) => { const g = window.__game, d = window.__dc.door(id); const e = g.camera.getWorldPosition(g.camera.position.clone()); g.player.yaw = Math.atan2(-(d.position.x - e.x), -(d.position.z - e.z)); g.player.pitch = -0.05; }, { id });
      await page.waitForTimeout(1500);
      await doorShots(page, id, '1-shot', setup);
    }
    await page.evaluate((id) => window.__dc.door(id).open(), id);
    if (wantShots) { await page.waitForTimeout(setup.kind === 'std' ? 330 : 700); await doorShots(page, id, '2-opening', setup); }
    await waitT(page, id, 1);
    await frames(page, 3);
    for (const pl of placed) {
      const r = await page.evaluate(readDecal, { id, key: pl.key });
      pl.after = r;
      const moved = r.p ? Math.hypot(r.p[0] - pl.p0[0], r.p[1] - pl.p0[1], r.p[2] - pl.p0[2]) : null;
      pl.moved = moved;
      if (r.gone || !r.visible) pl.verdict = 'hidden';
      else if (r.onLeaf <= TOL) pl.verdict = `follows (moved ${moved.toFixed(2)} m, ${f3(r.onLeaf)} off leaf)`;
      else { pl.verdict = `HANGING (moved ${moved.toFixed(2)} m, nearest leaf surface ${f3(r.onLeaf)})`; problems.push(`${pl.aim}: decal left hanging after open`); }
    }
    if (wantShots) await doorShots(page, id, '3-open', setup);
    await page.evaluate((id) => { const d = window.__dc.door(id); d.close(); d.snap(); }, id);
    const ok = problems.length === 0;
    if (!ok) bad++;
    console.log(`${id.padEnd(16)} ${setup.kind.padEnd(5)} ${ok ? 'ok  ' : 'FAIL'} ${placed.map((p) => `${p.aim}: ${p.verdict}`).join(' | ')}`);
    for (const p of problems) console.log(`    ! ${p}`);
    out.doors.push({ id, kind: setup.kind, ok, placed, problems });
  }

  // ── registered movers
  const movers = await page.evaluate(() => (window.__game.physics.movers ?? []).map((m, i) => ({ i, name: m.name || m.parent?.name || m.type })));
  for (const mv of movers) {
    await page.evaluate(({ i }) => {
      const g = window.__game, H = window.__dc, m = g.physics.movers[i], V = g.camera.position.constructor;
      const b = H.bbox(m);
      g.player.teleport(new V(b.c[0], 0, b.c[2] + 0.01), 0, 0);
    }, mv);
    await frames(page, 4);
    const r = await page.evaluate(({ i }) => {
      const g = window.__game, H = window.__dc, m = g.physics.movers[i], V = g.camera.position.constructor;
      const b = H.bbox(m);
      // find a face of the mover: rays from six sides; prefer one where the physics ray lands on it (bullet path)
      const dirs = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
      let pick = null;
      for (const via of ['bullet', 'fx']) {
        for (const d of dirs) for (const off of [[0, 0], [0.12, 0.1], [-0.12, -0.1]]) {
          const o = b.c.slice(), side = [0, 1, 2].filter((k) => !d[k]);
          o[side[0]] += off[0]; o[side[1]] += off[1];
          for (let k = 0; k < 3; k++) if (d[k]) o[k] = d[k] > 0 ? b.mn[k] - 0.6 : b.mx[k] + 0.6;
          const t = H.rayNode(m, o, d, 5, true); // a bullet / the game's raycaster only sees front faces
          if (t === Infinity) continue;
          const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
          if (via === 'bullet') {
            const hit = g.physics.raycast(new V(...o), new V(...d), 5);
            if (!hit || hit.owner !== undefined || Math.abs(hit.distance - t) > 0.04) continue;
          }
          pick = { via, o, d, p }; break;
        }
        if (pick) break;
      }
      if (!pick) {
        // no clear axis ray: a front-facing triangle of the mover itself, approached along its own normal
        m.updateWorldMatrix(true, true);
        m.traverse((x) => {
          if (pick || !x.isMesh || !x.geometry || x.isInstancedMesh || !x.visible) return;
          const pos = x.geometry.attributes.position, idx = x.geometry.index, M = x.matrixWorld.elements, n = idx ? idx.count : pos.count;
          const W = (i) => { const a = pos.getX(i), b2 = pos.getY(i), c = pos.getZ(i); return [M[0] * a + M[4] * b2 + M[8] * c + M[12], M[1] * a + M[5] * b2 + M[9] * c + M[13], M[2] * a + M[6] * b2 + M[10] * c + M[14]]; };
          for (let t = 0; t + 2 < n && !pick; t += 3 * Math.max(1, Math.floor(n / 60))) {
            const A = W(idx ? idx.getX(t) : t), B = W(idx ? idx.getX(t + 1) : t + 1), C = W(idx ? idx.getX(t + 2) : t + 2);
            const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
            const nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], L = Math.hypot(...nn);
            if (L < 1e-4) continue; // tiny / degenerate
            const nu = nn.map((v) => v / L), cc = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
            const o = cc.map((v, k) => v + nu[k] * 0.3), d = nu.map((v) => -v);
            if (Math.abs(H.rayNode(m, o, d, 1) - 0.3) > 0.003) continue; // occluded by another part of it
            pick = { via: 'fx', o, d, p: cc };
          }
        });
      }
      if (!pick) return { name: m.name, skip: 'no reachable face' };
      window.__before = H.snapshot();
      if (pick.via === 'bullet') H.shoot(pick.o, pick.d);
      else g.fx.decal('bullet_metal', new V(...pick.p), new V(-pick.d[0], -pick.d[1], -pick.d[2]), 0.08);
      return { name: m.name, via: pick.via, at: pick.p.map((v) => +v.toFixed(3)), dir: pick.d.map((v) => +v.toFixed(3)) };
    }, mv);
    if (r.skip) { console.log(`mover ${mv.name.padEnd(18)} skip (${r.skip})`); out.movers.push({ ...mv, ...r }); continue; }
    await frames(page, 2);
    const s0 = await page.evaluate(() => { const H = window.__dc; const f = H.fresh(window.__before); if (!f.length) return null; const i = H.info(`${f[0].name}#${f[0].slot}`); return { key: i.key, anchor: i.anchor, p: i.p }; });
    const problems = [];
    let verdict = '';
    if (!s0) problems.push('no decal placed');
    else if (!s0.anchor) problems.push(`decal not anchored to the mover (decal at ${s0.p.map((v) => v.toFixed(3))}, aimed at ${r.at} along ${r.dir})`);
    else {
      // move it 0.4 m and turn it a little: the decal must stay on its surface
      const mv1 = await page.evaluate(({ i, key }) => {
        const g = window.__game, H = window.__dc, m = g.physics.movers[i];
        window.__mvSave = { p: m.position.clone(), r: m.rotation.clone(), parent: m.parent };
        m.position.x += 0.4; m.position.y += 0.25; m.rotation.y += 0.2;
        return null;
      }, { i: mv.i, key: s0.key });
      await frames(page, 3);
      const a = await page.evaluate(({ i, key }) => { const H = window.__dc, m = window.__game.physics.movers[i], inf = H.info(key); return inf ? { visible: inf.visible, on: inf.visible ? H.surfDist([m], inf.p, inf.n) : null } : null; }, { i: mv.i, key: s0.key });
      if (!a || !a.visible) verdict += 'moved: hidden (room culled?)';
      else if (a.on <= TOL) verdict += `moved: follows (${f3(a.on)} off)`;
      else { verdict += `moved: HANGING (${f3(a.on)})`; problems.push('decal did not follow the mover'); }
      // gone from the scene: the decal must not stay
      await page.evaluate(({ i }) => { const m = window.__game.physics.movers[i]; m.parent.remove(m); }, { i: mv.i });
      await frames(page, 3);
      const gone = await page.evaluate(({ key }) => { const inf = window.__dc.info(key); return inf ? inf.visible : false; }, { key: s0.key });
      verdict += gone ? ', removed: STILL DRAWN' : ', removed: gone';
      if (gone) problems.push('decal stayed after its mover left the scene');
      await page.evaluate(({ i }) => {
        const g = window.__game, m = g.physics.movers[i], s = window.__mvSave;
        s.parent.add(m); m.position.copy(s.p); m.rotation.copy(s.r);
      }, { i: mv.i });
    }
    const ok = problems.length === 0;
    if (!ok) bad++;
    console.log(`mover ${mv.name.padEnd(18)} ${ok ? 'ok  ' : 'FAIL'} via ${r.via}: ${verdict}`);
    for (const p of problems) console.log(`    ! ${p}`);
    out.movers.push({ ...mv, ...r, ok, verdict, problems });
  }

  // ── unowned dynamic box (wreck / hanging load / tunnel arm default) and static world (aimed from the first door;
  //    a level without doors — stage 3b K's level-4 stub — skips them)
  if (!ids.length) console.log('transient box / static world: skipped (the level has no doors)');
  else {
    // a 30 cm unowned box 1.2 m in front of the first door, shot from 2.6 m out at eye height
    const res = await page.evaluate(() => {
      const g = window.__game;
      const d = g.level.doors[0];
      const nrm = d.spec.wall === 'z' ? [0, 0, 1] : [1, 0, 0];
      const eye = [d.position.x + nrm[0] * 2.6, (d.y0 ?? 0) + 1.5, d.position.z + nrm[2] * 2.6];
      const c = [eye[0] - nrm[0] * 1.2, eye[1], eye[2] - nrm[2] * 1.2];
      return { eye, c, nrm };
    });
    // (no THREE import in the page: the Box3 constructor comes from a mesh bounding box)
    const t = await page.evaluate(({ eye, c, nrm }) => {
      const g = window.__game, H = window.__dc, V = g.camera.position.constructor;
      let Box3 = null;
      g.level.root.traverse((m) => { if (!Box3 && m.isMesh && m.geometry) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); Box3 = m.geometry.boundingBox.constructor; } });
      const db = g.physics.addBox(new Box3(new V(c[0] - 0.15, c[1] - 0.15, c[2] - 0.15), new V(c[0] + 0.15, c[1] + 0.15, c[2] + 0.15)), 'metal');
      window.__before = H.snapshot();
      const hit = H.shoot(eye, [-nrm[0], -nrm[1], -nrm[2]]);
      db.remove();
      return { hit };
    }, res);
    await frames(page, 6);
    const left = await page.evaluate((hp) => window.__dc.fresh(window.__before).map((e) => e.matrix.elements).filter((m) => hp && Math.hypot(m[12] - hp[0], m[13] - hp[1], m[14] - hp[2]) < 0.3).length, t.hit?.point ?? null);
    const okT = t.hit && t.hit.owner === 'transient' && left === 0;
    if (!okT) bad++;
    console.log(`transient box      ${okT ? 'ok  ' : 'FAIL'} hit=${t.hit?.owner ?? 'nothing'} persistent decals left: ${left}`);
    out.other.push({ test: 'transient', ok: okT, hit: t.hit, left });
    // static world: the same shot without the box lands on whatever is behind (the closed door) or a wall: shoot a wall instead
    const s = await page.evaluate(() => {
      const g = window.__game, H = window.__dc, V = g.camera.position.constructor;
      const mb = (g.physics.movers ?? []).map((m) => H.bbox(m));
      const inMover = (p) => mb.some((b) => p.x > b.mn[0] - 0.1 && p.x < b.mx[0] + 0.1 && p.y > b.mn[1] - 0.1 && p.y < b.mx[1] + 0.1 && p.z > b.mn[2] - 0.1 && p.z < b.mx[2] + 0.1);
      // 2.6 m in front of a door, shoot sideways along the wall plane until plain static world (no mover) is hit
      for (const d of g.level.doors) {
        const nrm = d.spec.wall === 'z' ? [0, 0, 1] : [1, 0, 0];
        const eye = [d.position.x + nrm[0] * 2.6, (d.y0 ?? 0) + 1.4, d.position.z + nrm[2] * 2.6];
        for (const dir of [[nrm[2], 0, nrm[0]], [-nrm[2], 0, -nrm[0]], [0, -1, 0]]) {
          const h = g.physics.raycast(new V(...eye), new V(...dir).normalize(), 30);
          if (!h || h.owner !== undefined || h.distance < 0.05 || inMover(h.point)) continue;
          g.player.teleport(new V(eye[0], d.y0 ?? 0, eye[2]), 0, 0);
          window.__before = H.snapshot();
          const hit = H.shoot(eye, dir);
          return { hit, door: d.id };
        }
      }
      return { hit: null };
    });
    await frames(page, 2);
    const st = await page.evaluate((hp) => {
      const H = window.__dc; if (!hp) return null;
      const f = H.fresh(window.__before).map((e) => H.info(`${e.name}#${e.slot}`)).sort((a, b) => Math.hypot(a.p[0] - hp[0], a.p[1] - hp[1], a.p[2] - hp[2]) - Math.hypot(b.p[0] - hp[0], b.p[1] - hp[1], b.p[2] - hp[2]));
      return f.length ? { anchor: f[0].anchor, p: f[0].p, visible: f[0].visible } : null;
    }, s.hit?.point ?? null);
    const dist = st && s.hit ? Math.hypot(st.p[0] - s.hit.point[0], st.p[1] - s.hit.point[1], st.p[2] - s.hit.point[2]) : null;
    const okS = !!st && st.visible && st.anchor === null && dist !== null && dist < 0.012;
    if (!okS) bad++;
    console.log(`static world       ${okS ? 'ok  ' : 'FAIL'} ${st ? `anchor=${st.anchor ?? 'none'} ${(dist * 100).toFixed(1)}cm off the hit point` : 'no decal'}`);
    out.other.push({ test: 'static', ok: okS, hit: s.hit, decal: st, dist });
  }
  console.log('json:', writeJson('decals', level, out));
  summary.push(out);
  await page.close();
}
await browser.close();
console.log(bad ? `\nDECALS: ${bad} FAILED` : '\nDECALS OK');
process.exit(bad ? 1 : 0);
