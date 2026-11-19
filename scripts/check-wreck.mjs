// Dead robots on the floor must be walked OVER, not into (user-found defect class).
//   node scripts/check-wreck.mjs [baseUrl]   → prints one line per wreck, exit 1 on failure.
// Kills a husk and a sentry in an open room, waits for the wreck collider, then walks the player straight
// across each wreck with real movement input from four directions.
//   [--level 2|6]  only that level's cases (default: both). Level 6 (stage 3d §10.4, S8f, task T): a dead soldier on a
//   stair, on a gallery and on the grating (the mid deck) is walked over; a dead husk in the wet dock's 0.5 m water is
//   walked over (wading); a husk killed in the sluice channel (1.0 m) or the well (deep) leaves NO wreck box and sinks
//   (B6). Positions come from the level (nav stair nodes, `Room.floors`, `Level.water`) — none written here. A build
//   without the level-6 greybox (no pool6 / no water) SKIPS the level-6 cases with a note unless `--strict6`.
import { chromium } from 'playwright';
const base = process.argv.slice(2).find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? 'http://127.0.0.1:5173';
const lvArg = (() => { const i = process.argv.indexOf('--level'); return i > 0 ? Number(process.argv[i + 1]) : null; })();
const STRICT6 = process.argv.includes('--strict6');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
const ev = (fn, arg) => page.evaluate(fn, arg);
let failed = 0;
if (lvArg === null || lvArg === 2) {
await page.goto(`${base}/?level=2&autostart=1&god=1&nostory=1&noenemies=1&spawn=-4,0,-30,0`);
await page.waitForFunction(() => window.__game?.state === 'playing' || window.__game?.game?.state === 'playing' || window.__game?.player?.position, null, { timeout: 60000 });
await page.waitForTimeout(3000);
for (const type of ['husk', 'sentry']) {
  const made = await ev((type) => {
    const g = window.__game, V = g.player.position.constructor;
    const p = g.player.position;
    const e = g.enemies.spawn(type, new V(p.x, p.y + (type === 'sentry' ? 1.2 : 0), p.z - 4), 0, 'wreck_test');
    window.__wt = e;
    return !!e;
  }, type);
  if (!made) { console.log(`FAIL ${type}: could not spawn`); failed++; continue; }
  await page.waitForTimeout(800);
  // kill it through the real path: hitscan from above it, then damage until it is dead
  const dead = await ev(() => {
    const g = window.__game, V = g.player.position.constructor, e = window.__wt;
    for (let i = 0; i < 60 && g.enemies.aliveInGroup('wreck_test') > 0; i++) {
      const o = new V(e.position.x, e.position.y + 3, e.position.z + 0.02), d = new V(0, -1, 0);
      const hit = g.enemies.hitscan(o, d, 6) ?? g.enemies.hitscan(g.player.eye, new V().subVectors(e.position, g.player.eye).setY(0.3).normalize(), 12);
      if (hit) g.enemies.damage(hit, 400, d);
    }
    return g.enemies.aliveInGroup('wreck_test') === 0;
  });
  if (!dead) { console.log(`FAIL ${type}: could not kill it`); failed++; continue; }
  // move away so the collider is allowed to appear, then wait for the body to settle
  await ev(() => { const g = window.__game, V = g.player.position.constructor; g.player.teleport(new V(g.player.position.x + 7, g.player.position.y, g.player.position.z)); });
  let box = null;
  for (let i = 0; i < 60 && !box; i++) {
    await page.waitForTimeout(250);
    box = await ev(() => { const e = window.__wt; const b = (e.wreckBody ?? e.impl?.wreckBody)?.box; return b ? { min: b.min.toArray(), max: b.max.toArray(), walkable: !!(e.wreckBody ?? e.impl?.wreckBody).walkable } : null; });
  }
  if (!box) { console.log(`FAIL ${type}: no wreck collider appeared`); failed++; continue; }
  if (process.argv.includes('--selftest')) await ev(() => { const e = window.__wt; (e.wreckBody ?? e.impl?.wreckBody).walkable = false; }); // old behaviour: must FAIL
  const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2, top = box.max[1], h = box.max[1] - box.min[1];
  for (const [dx, dz, name] of [[0, 1, 'from +z'], [0, -1, 'from -z'], [1, 0, 'from +x'], [-1, 0, 'from -x']]) {
    const res = await (async () => {
      await ev(([x, y, z, yaw]) => { const g = window.__game, V = g.player.position.constructor; g.player.teleport(new V(x, y, z), yaw, 0); }, [cx + dx * 2.0, box.min[1] + 0.05, cz + dz * 2.0, Math.atan2(dx, dz)]);
      await page.waitForTimeout(300);
      let maxY = -1e9, crossed = false;
      for (const end = Date.now() + 4000; Date.now() < end; ) {
        await ev(() => window.__game.player.debug.move(1, 0, false));
        const p = await ev(() => window.__game.player.position.toArray());
        maxY = Math.max(maxY, p[1]);
        if ((p[0] - cx) * dx + (p[2] - cz) * dz < -1.2) { crossed = true; break; }
        await page.waitForTimeout(60);
      }
      await ev(() => window.__game.player.debug.move(0, 0, false));
      return { crossed, rose: maxY - box.min[1] };
    })();
    const ok = res.crossed && res.rose > h * 0.6;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${type} wreck (h ${h.toFixed(2)} m, walkable ${box.walkable}) ${name}: ${res.crossed ? 'walked across' : 'STOPPED'}, rose ${res.rose.toFixed(2)} m`);
  }
  await ev(() => { try { window.__game.enemies.removeGroup?.('wreck_test'); } catch {} });
}
}
if (lvArg === null || lvArg === 6) await level6();
await browser.close();
console.log(failed ? `WRECKS: ${failed} failure(s)` : 'WRECKS OK');
process.exit(failed ? 1 : 0);

// ───────────────────────────────────────────────────────────── level 6 (stage 3d §10.4, S8f; owner T)
async function level6() {
  console.log('── level 6: wrecks on a stair, a gallery, the grating, in the wet dock; none in the channel or the well');
  await page.goto(`${base}/?level=6&autostart=1&god=1&nostory=1&noenemies=1`);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const P = await ev(() => {
    const g = window.__game, V = g.player.position.constructor, los = (a, b) => g.physics.lineOfSight(a, b);
    const pool = g.level.rooms.find((r) => r.id === 'pool6');
    if (!pool || !(g.level.water?.length)) return { skip: `no pool6 room / Level.water on this build (rooms: ${g.level.rooms.map((r) => r.id).join(', ')})` };
    const free = (x, y, z) => { if (los(new V(x, y + 0.35, z), new V(x, y - 0.35, z))) return false; for (const h of [0.45, 1.25]) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, o = new V(x + Math.cos(a) * 0.45, y + h, z + Math.sin(a) * 0.45), c = new V(x, y + h, z); if (!los(c, o) || !los(o, c)) return false; } return los(new V(x, y + 0.4, z), new V(x, y + 1.85, z)); };
    // a lane: the point is free and 2.2 m to both sides along `dir` too (the approach and the exit)
    const lane = (x, y, z, d) => free(x, y, z) && free(x + d[0] * 2.2, y, z + d[1] * 2.2) && free(x - d[0] * 2.2, y, z - d[1] * 2.2);
    const out = {};
    // a stair: a nav stair node in pool6 / shaft6 with a linked neighbour on another height (its direction)
    const idx = new Map(g.level.nav.map((n) => [n.id, n]));
    for (const n of g.level.nav) {
      if (!n.stair || !['pool6', 'shaft6'].includes(n.room)) continue;
      const nb = n.links.map((l) => idx.get(l)).find((m) => m && Math.abs(m.position.y - n.position.y) > 0.15);
      if (!nb) continue;
      const dx = nb.position.x - n.position.x, dz = nb.position.z - n.position.z, l = Math.hypot(dx, dz) || 1;
      out.stair = { p: n.position.toArray(), dirs: [[dx / l, dz / l], [-dx / l, -dz / l]] }; break;
    }
    // decks of pool6 by height: a gallery (−12) and the grating mid deck (−16)
    const deck = (y, key) => {
      for (const f of (pool.floors ?? []).filter((q) => Math.abs(q.y - y) < 0.05)) {
        const [x0, x1, z0, z1] = f.box, long = (x1 - x0) > (z1 - z0), d = long ? [1, 0] : [0, 1];
        for (let t = 0.3; t <= 0.7; t += 0.05) { const x = long ? x0 + (x1 - x0) * t : (x0 + x1) / 2, z = long ? (z0 + z1) / 2 : z0 + (z1 - z0) * t; if (lane(x, y, z, d)) { out[key] = { p: [x, y, z], dirs: key === 'mid' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [d, [-d[0], -d[1]]] }; return; } }
      }
    };
    deck(-12, 'gallery'); deck(-16, 'mid');
    // water by the depth at the feet (surface − the solid floor under it, physics.raycastSolid): the wet dock (0.35 …
    // 0.65 m, a free lane), the sluice channel (0.8 … 1.25 m), the well (deep)
    // in water the vertical ray of `free` meets the ray-only surface: a wading lane tests chest height only
    const freeW = (x, y, z) => { for (const h of [0.8, 1.3]) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, o = new V(x + Math.cos(a) * 0.45, y + h, z + Math.sin(a) * 0.45), c = new V(x, y + h, z); if (!los(c, o) || !los(o, c)) return false; } return true; };
    const laneW = (x, y, z, d) => freeW(x, y, z) && freeW(x + d[0] * 2.2, y, z + d[1] * 2.2) && freeW(x - d[0] * 2.2, y, z - d[1] * 2.2);
    const floorAt = (x, y, z) => { const h = g.physics.raycastSolid(new V(x, y, z), new V(0, -1, 0), 40); return h ? h.point.y : null; };
    for (const w of g.level.water) {
      for (let x = w.box.min.x + 0.6; x <= w.box.max.x - 0.6; x += 0.5) for (let z = w.box.min.z + 0.6; z <= w.box.max.z - 0.6; z += 0.5) {
        const fy = floorAt(x, w.surface + 0.5, z); if (fy === null) continue;
        const depth = w.surface - fy;
        const kind = depth >= 0.35 && depth <= 0.65 ? 'wet' : depth >= 0.8 && depth <= 1.25 ? 'channel' : depth > 3 ? 'well' : null;
        if (!kind || out[kind]) continue;
        if (kind === 'wet' && !(laneW(x, fy, z, [1, 0]) && laneW(x, fy, z, [0, 1]))) continue;
        // (the wet lanes run on the open flat wet floor: chest-height rays pass over the dock's 0.8 m edge and the ramps,
        //  and from inside a container every ray passes — so the point and every lane end must meet that same floor first
        //  from 3 m over the surface, and the diagonals too (the body falls up to a metre off the spot) — else a walk
        //  "across" runs into the edge's wall or a container)
        if (kind === 'wet' && [[0, 0], [2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2], [1.6, 1.6], [1.6, -1.6], [-1.6, 1.6], [-1.6, -1.6]].some(([ox, oz]) => { const f = floorAt(x + ox, w.surface + 3, z + oz); return f === null || Math.abs(f - fy) > 0.05; })) continue;
        out[kind] = { p: [x, kind === 'well' ? w.surface - 0.4 : fy, z], depth, surface: w.surface, id: w.id, dirs: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
      }
    }
    return out;
  });
  if (P.skip) { if (STRICT6) { console.log(`FAIL level 6: ${P.skip}`); failed++; } else console.log(`  SKIP level 6: ${P.skip}`); return; }
  const killAt = (type, p, group) => ev(([type, p, group]) => {
    const g = window.__game, V = g.player.position.constructor;
    const e = g.enemies.spawn(type, new V(p[0], p[1], p[2]), 0, group);
    window.__wt = e;
    for (let k = 0; k < 12 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone().setY(e.position.y + 1.2), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1));
    return !e.alive;
  }, [type, p, group]);
  const wreckBox = async (tries = 40) => {
    for (let i = 0; i < tries; i++) {
      await page.waitForTimeout(250);
      const b = await ev(() => { const e = window.__wt; const w = e?.wreckBody ?? e?.impl?.wreckBody; return w?.box ? { min: w.box.min.toArray(), max: w.box.max.toArray(), walkable: !!w.walkable } : null; });
      if (b) return b;
    }
    return null;
  };
  for (const [type, where] of [['soldier', 'stair'], ['soldier', 'gallery'], ['soldier', 'mid'], ['husk', 'wet']]) {
    const c = P[where];
    if (!c) { console.log(`FAIL level 6 ${type} on the ${where}: no such place found in the level data`); failed++; continue; }
    // stand 6 m off along the lane while it dies (the wreck box waits for a clear capsule)
    await ev(([p, d]) => { const g = window.__game, V = g.player.position.constructor; g.player.teleport(new V(p[0] + d[0] * 6, p[1], p[2] + d[1] * 6), 0, 0); }, [c.p, c.dirs[0]]);
    await page.waitForTimeout(400);
    if (!await killAt(type, c.p, 'wreck6')) { console.log(`FAIL level 6 ${type} on the ${where}: could not kill it`); failed++; continue; }
    const box = await wreckBox();
    if (!box) { console.log(`FAIL level 6 ${type} on the ${where} (${c.p.map((v) => v.toFixed(1))}): no wreck collider appeared`); failed++; continue; }
    const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2, h = box.max[1] - box.min[1];
    for (const [dx, dz] of c.dirs) {
      // the start's floor from the solid set (a stair's foot is lower than its node)
      await ev(([x, y, z, yaw]) => { const g = window.__game, V = g.player.position.constructor; const h = g.physics.raycastSolid(new V(x, y + 2.0, z), new V(0, -1, 0), 5); g.player.teleport(new V(x, (h ? h.point.y : y) + 0.05, z), yaw, 0); }, [cx + dx * 2.0, c.p[1], cz + dz * 2.0, Math.atan2(dx, dz)]);
      await page.waitForTimeout(300);
      let maxY = -1e9, crossed = false;
      const y0s = await ev(() => window.__game.player.position.y);
      for (const end = Date.now() + (where === 'wet' ? 8000 : 4000); Date.now() < end;) {
        await ev(() => window.__game.player.debug.move(1, 0, false));
        const p = await ev(() => window.__game.player.position.toArray());
        maxY = Math.max(maxY, p[1]);
        if ((p[0] - cx) * dx + (p[2] - cz) * dz < -1.2) { crossed = true; break; }
        await page.waitForTimeout(60);
      }
      await ev(() => window.__game.player.debug.move(0, 0, false));
      // on a stair the floor itself rises and in water the step is waded: judged by crossing only there
      const ok = crossed && (where === 'stair' || where === 'wet' || maxY - y0s > h * 0.6);
      if (!ok) failed++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} level 6 ${type} wreck on the ${where} (h ${h.toFixed(2)} m, walkable ${box.walkable}) from (${dx.toFixed(1)}, ${dz.toFixed(1)}): ${crossed ? 'walked across' : 'STOPPED'}, rose ${(maxY - y0s).toFixed(2)} m`);
    }
    await ev(() => { try { window.__game.enemies.removeGroup?.('wreck6'); } catch { /* */ } });
  }
  // B6: in water deeper than 0.6 m a body makes no wreck box and sinks
  for (const where of ['channel', 'well']) {
    const c = P[where];
    if (!c) { console.log(`FAIL level 6 husk in the ${where}: no water volume of that depth in Level.water`); failed++; continue; }
    if (!await killAt('husk', c.p, 'wreck6')) { console.log(`FAIL level 6 husk in the ${where}: could not kill it`); failed++; continue; }
    const y0 = c.p[1];
    const box = await wreckBox(16);
    const st = await ev(() => { const e = window.__wt; return { y: e.position.y, gone: !window.__game.enemies.all.includes(e) }; });
    // the channel's floor is 1 m down: the body lies on it under the surface; the well's sinks out of reach
    const ok = !box && (st.gone || (where === 'channel' ? st.y < c.surface - 0.6 : st.y < y0 - 0.3));
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} level 6 husk dead in the ${where} (${c.depth.toFixed(2)} m deep, ${c.id}): wreck box ${box ? 'MADE' : 'none'}, ${st.gone ? 'removed' : `sank ${(y0 - st.y).toFixed(2)} m in 4 s`} (B6)`);
    await ev(() => { try { window.__game.enemies.removeGroup?.('wreck6'); } catch { /* */ } });
  }
}
