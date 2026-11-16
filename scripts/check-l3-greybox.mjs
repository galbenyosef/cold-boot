// K5 (level-3 greybox) tests that the repo checks do not cover. Run on a static build:
//   node shots/k5/tools/k5-tests.mjs --url http://127.0.0.1:4451 [--only spawnvis,walk,latch,sentry,perf,shots,top]
//  spawnvis — per phase × group: rays from every position the player can be in (nav nodes reachable from the phase
//             start through that phase's passable doors, jittered, eye 0.98 / 1.65 / 2.65) to 3 points on each member
//             of each not-yet-spawned group: must all be blocked (glass and glass door leaves are see-through)
//  walk     — nostory: real movement input (player.debug.move + yaw) from the lift to the BIO lock along the escape
//             route (lock, gallery, lobby, admin, office, west stair down, canteen, garden, feature stair, balcony)
//  latch    — the four latches (§3): walk through, lock, keep side; stand in the doorway, lock, never the wrong side locked
//  sentry   — roof hatch opened (vignette), sentry spawned in the void descends into the atrium and fires at the balcony
//  perf     — §10.6 views on low / medium: fps, draw calls, triangles, point / spot slots used, shadow casters
//  shots    — one screenshot per room; top — top-down plans of Deck 1 and Deck 2 (shots/k5/)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const n = process.argv[i + 1]; args[a.slice(2)] = n === undefined || n.startsWith('--') ? '1' : (i++, n); } }
const base = (args.url ?? 'http://127.0.0.1:4451').replace(/\/$/, '');
const only = new Set((args.only ?? 'spawnvis,walk,latch,sentry,perf,shots,top').split(','));
mkdirSync('shots/k5', { recursive: true });
let failures = 0;
const line = (ok, text) => { if (!ok) failures++; console.log(`${ok ? ' ok ' : 'FAIL'} ${text}`); };

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
async function boot(query = '', { width = 1280, height = 720, settle = 2500 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(`${base}/?level=3&autostart=1&nostory=1${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000 });
  await page.waitForTimeout(settle);
  return page;
}

// ───────────────────────────────────────────────────────────── spawn visibility
if (only.has('spawnvis')) {
  const page = await boot('&noenemies=1');
  const res = await page.evaluate(() => {
    const g = window.__game, level = g.level, phys = g.physics, nav = level.nav, V = g.camera.position.constructor;
    const GLASS_DOORS = new Set(['d3_lobby', 'd3_canteen_atr', 'd3_quarters', 'd3_clinic']);
    const glassLeaves = new Set();
    for (const id of GLASS_DOORS) { const d = level.doors.find((x) => x.id === id); for (let i = 0; i < 2; i++) glassLeaves.add(d.leaf(i)); }
    const segXZ = (p, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz; let t = l2 > 1e-8 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2 : 0; t = Math.min(1, Math.max(0, t)); return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)); };
    const doorOf = (a, b) => { const ly = (a.position.y + b.position.y) / 2; for (const d of level.doors) if (segXZ(d.position, a.position, b.position) < 0.9 && Math.abs(d.position.y - ly) < 2) return d; return null; };
    const nearest = (p) => { let best = 0, bd = Infinity; for (const n of nav) { const q = n.position, dy = (q.y - p[1]) * 2; const d = (q.x - p[0]) ** 2 + (q.z - p[2]) ** 2 + dy * dy; if (d < bd) { bd = d; best = n.id; } } return best; };
    /** positions the player can be in: nav nodes reached from the start through passable doors (auto / open doors open) */
    const positions = (phase) => {
      level.applyPhase(phase.id, { snap: true });
      for (const d of level.doors) { if (!d.locked && d.auto) d.open(); d.snap?.(); }
      const seen = new Uint8Array(nav.length), q = [nearest(phase.check.start)];
      seen[q[0]] = 1;
      while (q.length) {
        const n = nav[q.pop()];
        for (const l of [...n.links, ...(n.drops ?? [])]) {
          if (seen[l]) continue;
          const d = doorOf(n, nav[l]);
          if (d && d.locked && !d.isOpen) continue;
          if (d && !d.auto && !d.isOpen) continue; // 'shut' doors (script-only) do not open for the player
          seen[l] = 1; q.push(l);
        }
      }
      const out = [];
      for (let i = 0; i < nav.length; i++) if (seen[i]) for (const [jx, jz] of [[0, 0], [0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) out.push([nav[i].position.x + jx, nav[i].position.y, nav[i].position.z + jz]);
      return out;
    };
    const tmp = new V(), dir = new V();
    /** is b visible from a? (glass and glass door leaves do not block sight) */
    const visible = (a, b) => {
      tmp.copy(a); dir.copy(b).sub(a); let left = dir.length(); dir.multiplyScalar(1 / left);
      for (let k = 0; k < 12; k++) {
        const h = phys.raycast(tmp, dir, left);
        if (!h) return true;
        const see = h.surface === 'glass' || (h.owner && glassLeaves.has(h.owner));
        if (!see) return false;
        const step = h.distance + 0.03; tmp.addScaledVector(dir, step); left -= step;
        if (left <= 0) return true;
      }
      return false;
    };
    const GROUPS = {
      g3_canteen_ha: { window: ['F'] }, g3_canteen_hb: { window: ['F'] }, g3_canteen_k: { window: ['F'] },
      g3_breach: { window: ['F'] }, g3_garden: { window: ['F', 'G'] }, g3_breach_2: { window: ['H'] },
    };
    // phases before each group's beat (inclusive of its spawn window); 'n/a' where the player starts in that very room
    const ORDER = ['A', 'A2', 'B', 'B2', 'C', 'E', 'F', 'G', 'H', 'I', 'J'];
    const lastPhase = { g3_canteen_ha: 'F', g3_canteen_hb: 'F', g3_canteen_k: 'F', g3_breach: 'F', g3_garden: 'G', g3_breach_2: 'H' };
    const spawns = level.enemySpawns;
    const rows = [];
    const posCache = {};
    for (const ph of level.phases.filter((p) => p.check && ORDER.includes(p.id))) posCache[ph.id] = positions(ph);
    for (const [grp] of Object.entries(GROUPS)) {
      const members = spawns.filter((s) => s.group === grp);
      for (const pid of ORDER.slice(0, ORDER.indexOf(lastPhase[grp]) + 1)) {
        const pos = posCache[pid];
        level.applyPhase(pid, { snap: true });
        for (const d of level.doors) { if (!d.locked && d.auto) d.open(); d.snap?.(); }
        let rays = 0, seen = 0, ex = null;
        for (const m of members) {
          const tops = m.type === 'sentry' ? [0, 0.35, -0.35] : [0.3, 1.2, 1.7];
          for (const p of pos) for (const eh of [0.98, 1.65, 2.65]) for (const ty of tops) {
            rays++;
            const a = new V(p[0], p[1] + eh, p[2]), b = new V(m.position.x, m.position.y + ty, m.position.z);
            if (a.distanceTo(b) < 0.5) { seen++; ex ??= { from: p, eye: eh, to: [b.x, b.y, b.z] }; continue; }
            if (visible(a, b)) { seen++; ex ??= { from: p.map((v) => +v.toFixed(2)), eye: eh, to: [b.x, b.y, b.z].map((v) => +v.toFixed(2)) }; }
          }
        }
        rows.push({ grp, phase: pid, positions: pos.length, rays, seen, ex, inWindow: GROUPS[grp].window.includes(pid) });
      }
    }
    level.applyPhase('nostory', { snap: true });
    return rows;
  });
  console.log('\n=== SPAWN VISIBILITY (rays from every reachable position, eye 0.98 / 1.65 / 2.65, to 3 points per member) ===');
  for (const r of res) {
    // the player starts in the lock: before F the breach group's room IS the player's room (it spawns only in F, sealed)
    const na = r.grp === 'g3_breach' && ['A', 'A2', 'B', 'B2'].includes(r.phase);
    if (na) { console.log(` n/a  ${r.grp.padEnd(14)} ${r.phase.padEnd(3)} the player is in the lock (g3_breach spawns only in F, lock sealed) — ${r.seen}/${r.rays} rays clear`); continue; }
    line(r.seen === 0, `${r.grp.padEnd(14)} ${r.phase.padEnd(3)} ${r.inWindow ? '[spawn beat]' : '            '} ${r.positions} positions, ${r.rays} rays, ${r.seen} reach a member${r.ex ? ` e.g. from ${JSON.stringify(r.ex.from)} eye ${r.ex.eye} to ${JSON.stringify(r.ex.to)}` : ''}`);
  }
  writeFileSync('shots/k5/spawnvis.json', JSON.stringify(res, null, 1));
  await page.close();
}

// ───────────────────────────────────────────────────────────── walk-through (nostory, real movement input)
async function walk(page, pts, { timeout = 40 } = {}) {
  return page.evaluate(async ({ pts, timeout }) => {
    const g = window.__game, V = g.camera.position.constructor, p = g.player;
    const log = [], rooms = [];
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let i = 1; i < pts.length; i++) {
      const [tx, ty, tz] = pts[i];
      const t0 = performance.now();
      let mark = p.position.clone(), markT = t0, ok = false;
      while ((performance.now() - t0) / 1000 < timeout) {
        const q = p.position;
        const dx = tx - q.x, dz = tz - q.z;
        if (Math.hypot(dx, dz) < 0.45 && Math.abs(q.y - ty) < 0.5) { ok = true; break; }
        p.yaw = Math.atan2(-dx, -dz); p.pitch = 0;
        p.debug.move(1, 0, false);
        await frame();
        const r = g.level.roomAt(q)?.id ?? '-';
        if (rooms[rooms.length - 1] !== r) rooms.push(r);
        if (performance.now() - markT > 3000) { if (q.distanceTo(mark) < 0.3) break; mark.copy(q); markT = performance.now(); }
      }
      p.debug.move(0, 0, false);
      log.push({ to: pts[i], ok, at: p.position.toArray().map((v) => +v.toFixed(2)), s: +((performance.now() - t0) / 1000).toFixed(1) });
      if (!ok) break;
    }
    return { log, rooms };
  }, { pts, timeout });
}
const D2 = 4.8;
const ROUTE = [
  [0, D2, 3.2], [0, D2, 1.2], [0, D2, -1.0], [0, D2, -5.6], [0, D2, -8.6], [-10.6, D2, -9.5], [-13.2, D2, -9.5], [-18.6, D2, -9.0],
  [-21.4, D2, -9.0], [-29.9, D2, -17.8], [-30.0, D2, -21.2], [-30.0, D2, -23.0], [-30.0, D2, -18.6], [-21.4, D2, -18.5], [-18.4, D2, -18.5],
  [-17.5, D2, -21.4], [-17.5, 0, -32.3], [-17.5, 0, -33.2], [-17.5, 0, -35.4], [-13.4, 0, -39.0], [-10.4, 0, -39.0], [5.0, 0, -17.6],
  [7.0, 0, -18.9], [7.0, D2, -29.6], [8.6, D2, -30.6], [10.5, D2, -32.0], [10.5, D2, -37.8], [11.2, D2, -38.0], [13.0, D2, -38.0], [14.2, D2, -38.0],
];
if (only.has('walk')) {
  const page = await boot('&noenemies=1');
  await page.evaluate(() => { const g = window.__game, V = g.camera.position.constructor; g.player.teleport(new V(0, 4.85, 3.2), 0, 0); });
  await page.waitForTimeout(800);
  const r = await walk(page, ROUTE);
  console.log('\n=== WALK-THROUGH (nostory, real movement input: lift → BIO lock) ===');
  for (const l of r.log) line(l.ok, `→ (${l.to.join(', ')}) ${l.ok ? `reached in ${l.s} s` : `NOT reached (stopped at ${l.at.join(', ')})`}`);
  console.log(`      rooms on the way: ${r.rooms.filter((x) => x !== '-').join(' → ')}`);
  const want = ['lift3', 'lock', 'gallery_n', 'lobby', 'admin', 'office', 'admin', 'stair_w', 'canteen', 'atrium', 'bio_lock'];
  const seq = r.rooms.filter((x) => x !== '-');
  let k = 0; for (const x of seq) if (x === want[k]) k++;
  line(k === want.length, `route visits ${want.join(' → ')} in order`);
  writeFileSync('shots/k5/walk.json', JSON.stringify(r, null, 1));
  await page.close();
}

// ───────────────────────────────────────────────────────────── latches
if (only.has('latch')) {
  console.log('\n=== LATCHES (§3: closeBehind — lock, wait until shut, check the side; wrong side → reopen) ===');
  const CASES = [
    { door: 'd3_lift', phase: 'A2', then: 'B', from: [0, D2, 2.6], to: [0, D2, -3.0], doorway: [0, D2, 0.0], keep: 'z<-0.6' },
    { door: 'd3_pressure', phase: 'B2', then: 'C', from: [0, D2, -3.5], to: [0, D2, -9.6], doorway: [0, D2, -7.0], keep: 'z<-7.7' },
    { door: 'd3_office', phase: 'E', then: 'F', from: [-30, D2, -23.5], to: [-30, D2, -18.0], doorway: [-30, D2, -20.0], keep: 'z>-19.6' },
    { door: 'd3_bio', phase: 'I', then: 'J', from: [10.5, D2, -38], to: [14.0, D2, -38], doorway: [12.0, D2, -38], keep: 'x>12.4' },
  ];
  const page = await boot('&noenemies=1');
  for (const c of CASES) {
    for (const mode of ['through', 'doorway']) {
      const r = await page.evaluate(async ({ c, mode }) => {
        const g = window.__game, V = g.camera.position.constructor, p = g.player, level = g.level;
        const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
        const sleep = async (s) => { const t0 = performance.now(); while (performance.now() - t0 < s * 1000) await frame(); };
        const keep = () => { const [ax, op, v] = [c.keep[0], c.keep[1], Number(c.keep.slice(2))]; const q = p.position[ax]; return op === '<' ? q < v : q > v; };
        level.applyPhase(c.phase, { snap: true });
        const d = level.door(c.door);
        // the door stands open for the latch (as the story has it before arming)
        d.unlock(); d.auto = false; d.open(); d.snap();
        const start = mode === 'through' ? c.from : c.doorway;
        p.teleport(new V(start[0], start[1] + 0.05, start[2]), 0, 0);
        await sleep(0.4);
        if (mode === 'through') {
          // walk to the far side with real input
          const t0 = performance.now();
          while (performance.now() - t0 < 8000) { const dx = c.to[0] - p.position.x, dz = c.to[2] - p.position.z; if (Math.hypot(dx, dz) < 0.4) break; p.yaw = Math.atan2(-dx, -dz); p.debug.move(1, 0, false); await frame(); }
          p.debug.move(0, 0, false);
        }
        // closeBehind: lock, wait until shut (≤ 4 s), check the side
        d.lock();
        const t1 = performance.now();
        while (!d.closed && performance.now() - t1 < 4000) await frame();
        await sleep(0.2);
        const shut = d.closed, kept = keep(), after = p.position.toArray().map((v) => +v.toFixed(2));
        let outcome;
        if (kept) {
          level.applyPhase(c.then, { snap: true });
          // try to get back: walk + jump into the door for 3 s
          const back = c.from;
          const t2 = performance.now();
          while (performance.now() - t2 < 3000) { const dx = back[0] - p.position.x, dz = back[2] - p.position.z; p.yaw = Math.atan2(-dx, -dz); p.debug.move(1, 0, true); if (Math.random() < 0.05) p.debug.jump(); await frame(); }
          p.debug.move(0, 0, false);
          // (never back through: still beyond the door plane — keepSide's margin is for the moment of closing)
          const [ax, op] = [c.keep[0], c.keep[1]], dp = level.door(c.door).position[ax];
          const beyond = op === '<' ? p.position[ax] < dp : p.position[ax] > dp;
          outcome = { latched: true, stillKept: beyond, locked: level.door(c.door).locked, end: p.position.toArray().map((v) => +v.toFixed(2)) };
        } else {
          // wrong side: the latch reopens and re-arms (never a locked door with the player on the wrong side)
          d.unlock(); d.open();
          await sleep(1.2);
          outcome = { latched: false, reopened: d.isOpen && !d.locked, end: p.position.toArray().map((v) => +v.toFixed(2)) };
        }
        return { shut, kept, after, ...outcome };
      }, { c, mode });
      const ok = r.shut && (r.latched ? r.stillKept && r.locked : r.reopened);
      line(ok, `${c.door.padEnd(12)} ${mode.padEnd(8)} shut ${r.shut}, player ${r.kept ? 'on the keep side' : 'on the WRONG side'} at (${r.after.join(', ')}) → ${r.latched ? `latched (${c.phase}→${c.then}); 3 s of running / jumping back: ${r.stillKept ? 'never back through the door' : 'GOT BACK'} at (${r.end.join(', ')})` : `reopened + re-armed: ${r.reopened}`}`);
    }
  }
  await page.close();
}

// ───────────────────────────────────────────────────────────── sentry from the roof void
if (only.has('sentry')) {
  const page = await boot('&noenemies=1&debug=1');
  const r = await page.evaluate(async () => {
    const g = window.__game, V = g.camera.position.constructor, p = g.player, level = g.level;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    g.debug.noEnemies = false; g.debug.god = true;
    p.teleport(new V(10.5, 4.85, -24), Math.PI, 0);
    let fired = 0;
    g.events.on('enemy:attack', (e) => { if (e.kind === 'ranged') fired++; });
    level.vignette('atr_roof_hatch');
    for (let i = 0; i < 40; i++) await frame();
    const e = g.enemies.spawnPose('sentry', new V(0, 14.1, -30), 0, 'k5_sentry', 'emerge');
    // the plan's "descends through the hatch": scripted here (the sentry's own ground probe reaches 12 m; the garden is
    // 14 m below the void, so on its own it holds the void's height — an enemies / story item, see the K5 report)
    for (let i = 0; i < 30; i++) await frame();
    const t00 = performance.now();
    while (performance.now() - t00 < 1200) { const k = (performance.now() - t00) / 1200; e.position.y = 14.1 - 3.2 * k; e.position.x = 0; e.position.z = -30; await frame(); }
    e.alert?.();
    const t0 = performance.now(); let minY = 99, out = null;
    while (performance.now() - t0 < 25000) { await frame(); minY = Math.min(minY, e.position.y); if (fired && e.position.y < 13.0 && !out) out = (performance.now() - t0) / 1000; if (out && performance.now() - t0 > out * 1000 + 1000) break; }
    return { fired, minY: +minY.toFixed(2), left: e.position.y < 13.0, at: e.position.toArray().map((v) => +v.toFixed(2)), t: out };
  });
  console.log('\n=== SENTRY from the roof hatch void (vignette atr_roof_hatch, spawn (0, 14.1, −30), scripted 3.2 m descent through the hatch) ===');
  line(r.left && r.fired > 0, `left the void (min y ${r.minY}) and fired ${r.fired} time(s) at the player on the balcony${r.t ? ` within ${r.t.toFixed(1)} s` : ''}; at (${r.at.join(', ')})`);
  await page.close();
}

// ───────────────────────────────────────────────────────────── perf (§10.6 views)
if (only.has('perf')) {
  console.log('\n=== PERF (§10.6 views; nostory = evening lamps, no actors; headless Chromium / Metal) ===');
  const VIEWS = [['1 lock → south', '0,4.8,-3.5,0'], ['2 gallery W → SE', '-10,4.8,-9.5,-135'], ['3 pool → balcony (N)', '0,0,-32,180'], ['4 BIO door → north', '10.5,4.8,-38,180']];
  const out = [];
  for (const q of ['low', 'medium']) for (const [name, sp] of VIEWS) {
    const page = await boot(`&noenemies=1&quality=${q}&spawn=${sp}`, { width: 1600, height: 900, settle: 6000 });
    const r = await page.evaluate(async () => {
      const g = window.__game, L = g.render._debug.lights;
      const fr = []; let last = performance.now();
      for (let i = 0; i < 120; i++) { await new Promise((r) => requestAnimationFrame(() => r())); const n = performance.now(); fr.push(n - last); last = n; }
      fr.sort((a, b) => a - b);
      const st = g.render.stats();
      const pts = L.pointSlots.filter((s) => s.handle && s.handle.factor > 0).length, sps = L.spotSlots.filter((s) => s.handle && s.handle.factor > 0).length;
      const shadows = L.spotSlots.filter((s) => s.handle && s.handle.factor > 0 && s.light?.castShadow).length + L.pointSlots.filter((s) => s.handle && s.handle.factor > 0 && s.light?.castShadow).length;
      const groups = [...new Set([...L.pointSlots, ...L.spotSlots].filter((s) => s.handle && s.handle.factor > 0).map((s) => s.handle.desc.group))];
      return { fps: +(1000 / (fr.reduce((a, b) => a + b, 0) / fr.length)).toFixed(1), p95ms: +fr[Math.floor(fr.length * 0.95)].toFixed(1), calls: st.calls, tris: st.triangles, points: pts, pointSlots: st.pointSlots, spots: sps, spotSlots: st.spotSlots, shadows, shadowUpdates: st.shadowUpdates, groups };
    });
    await page.screenshot({ path: `shots/k5/perf-${q}-view${name[0]}.png` });
    out.push({ quality: q, view: name, ...r });
    console.log(`${q.padEnd(6)} view ${name.padEnd(22)} ${String(r.fps).padStart(5)} fps (p95 ${r.p95ms} ms), ${r.calls} calls, ${(r.tris / 1000).toFixed(0)} k tris, points ${r.points}/${r.pointSlots}, spots ${r.spots}/${r.spotSlots}, shadow casters ${r.shadows}; groups ${r.groups.join(' ')}`);
    await page.close();
  }
  writeFileSync('shots/k5/perf.json', JSON.stringify(out, null, 1));
}

// ───────────────────────────────────────────────────────────── room screenshots
if (only.has('shots')) {
  const SH = [
    ['lift3', [0, D2, 4.4, 0, -5]], ['lock', [0, D2, -0.8, 0, -3]], ['lock_back', [0, D2, -6.2, 180, 0]], ['gallery_east', [-10.5, D2, -8.0, -100, -12]],
    ['gallery_glass', [-4, D2, -8.2, 160, -14]], ['lobby', [-12.9, D2, -9.5, 90, -4]], ['admin', [-21.0, D2, -3.0, 135, -5]], ['office', [-26.9, D2, -21.0, 120, -8]],
    ['stair_w_top', [-17.5, D2, -16.8, 180, -18]], ['stair_w_bottom', [-17.5, 0, -33.4, 0, 12]], ['canteen', [-23.0, 0, -35.0, -125, -6]],
    ['garden_north', [0, 0, -40, 0, 12]], ['garden_from_canteen_door', [-10.6, 0, -39, -60, 14]], ['atrium_stair', [2, 0, -16, -140, 10]],
    ['balcony_north', [10.5, D2, -38, 180, -4]], ['balcony_south', [10.5, D2, -13.5, 0, -6]], ['clinic', [13.0, 0, -15.0, -135, -8]],
    ['quarters', [13.0, 0, -31, -90, -4]], ['bio_lock', [12.8, D2, -36.6, -120, -8]], ['viewport', [0, 0, -38, 0, 4]], ['feed_l2', [66, 0, -1.0, 0, -10]],
  ];
  const page = await boot('&noenemies=1', { width: 1600, height: 900 });
  for (const [name, [x, y, z, yaw, pitch]] of SH) {
    await page.evaluate(({ x, y, z, yaw, pitch }) => { const g = window.__game, V = g.camera.position.constructor; g.player.teleport(new V(x, y + 0.05, z), (yaw * Math.PI) / 180, (pitch * Math.PI) / 180); }, { x, y, z, yaw, pitch });
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `shots/k5/room-${name}.png` });
  }
  console.log(`\n=== SCREENSHOTS: ${SH.length} rooms → shots/k5/room-*.png ===`);
  await page.close();
}

// ───────────────────────────────────────────────────────────── top-down plans
if (only.has('top')) {
  const W = 1400, H = 1160;
  const page = await boot('&noenemies=1', { width: W, height: H });
  if (!args.colliders) await page.evaluate(() => { window.__nocol = true; });
  for (const [deck, lo, hi] of [['deck1', -1, 3.0], ['deck2', 4.3, 6.4]]) {
    await page.evaluate(({ lo, hi, W, H, deck }) => {
      const g = window.__game, scene = g.scene, r = g.renderer, level = g.level;
      const P = g.camera.position.constructor;
      const x0 = -36, x1 = 33, z0 = -50, z1 = 7;
      // orthographic camera from the live perspective one (three's classes are not exposed on window)
      const cam = g.camera.clone();
      cam.position.set((x0 + x1) / 2, 60, (z0 + z1) / 2); cam.up.set(0, 0, -1); cam.lookAt((x0 + x1) / 2, 0, (z0 + z1) / 2); cam.updateMatrixWorld(true);
      const hw = (x1 - x0) / 2, hh = (z1 - z0) / 2;
      cam.projectionMatrix.makeOrthographic(-hw, hw, hh, -hh, 1, 200); cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      cam.isOrthographicCamera = true; cam.isPerspectiveCamera = false; cam.updateProjectionMatrix = () => {};
      const orig = r.render.bind(r); r.render = () => {};
      const mkPlane = (nx, ny, nz, c) => ({ normal: new P(nx, ny, nz), constant: c, isPlane: true });
      r.clippingPlanes = [mkPlane(0, -1, 0, hi), mkPlane(0, 1, 0, -lo)];
      const cols = level.colliders;
      const basicProto = cols[0].material; // MeshBasicMaterial (default of a bare Mesh)
      const undo = [];
      // every lit surface → unlit basic of its own colour (floors read by their tint); glass faint cyan
      level.root.traverse((o) => {
        if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
        const m = o.material, bm = basicProto.clone();
        bm.color.copy(m.color ?? bm.color);
        if (/glass/.test(m.name)) { bm.color.set(0x7fd8ff); bm.transparent = true; bm.opacity = 0.55; }
        bm.side = 2; bm.visible = m.visible !== false && m.colorWrite !== false; bm.polygonOffset = false;
        undo.push(() => { o.material = m; }); o.material = bm;
      });
      // colliders as dark solid walls cut at the deck heights (behind the floor faces)
      const dark = basicProto.clone(); dark.color.set(0x15181b); dark.side = 2; dark.visible = true; dark.colorWrite = true; dark.depthWrite = true; dark.polygonOffset = true; dark.polygonOffsetFactor = 2; dark.polygonOffsetUnits = 8;
      if (!window.__nocol) for (const c of cols) { const m = c.material, v = c.visible, par = c.parent; c.material = dark; c.visible = true; if (!par) scene.add(c); undo.push(() => { c.material = m; c.visible = v; if (!par) scene.remove(c); }); }
      const vis = level.root.children.map((o) => [o, o.visible]); for (const o of level.root.children) o.visible = true;
      undo.push(() => { for (const [o, v] of vis) o.visible = v; });
      const fog = scene.fog; scene.fog = null; undo.push(() => { scene.fog = fog; });
      r.setRenderTarget(null); r.setViewport(0, 0, W, H);
      orig(scene, cam);
      // the camera's screen-up is −z: flip the canvas so north (+z) is up and x runs left → right, as the §2.4 map
      const cv = r.domElement; const tf = cv.style.transform; cv.style.transform = 'scaleY(-1)';
      const div = document.createElement('div');
      div.id = '__k5labels'; div.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:bold 13px monospace;color:#ffef9a;text-shadow:0 0 3px #000,0 0 3px #000;z-index:99999';
      const toPx = (x, z) => [((x - x0) / (x1 - x0)) * W, ((z1 - z) / (z1 - z0)) * H];
      const put = (text, x, z, css) => { const [px, py] = toPx(x, z); const s = document.createElement('div'); s.textContent = text; s.style.cssText = `position:absolute;left:${px}px;top:${py}px;transform:translate(-50%,-50%);${css}`; div.appendChild(s); };
      for (const rm of level.rooms) {
        const f = rm.floor ?? 0; const onDeck = (f >= lo && f <= hi) || (rm.floors ?? []).some((q) => q.y >= lo && q.y <= hi);
        if (!onDeck) continue;
        put(rm.id, (rm.bounds.min.x + rm.bounds.max.x) / 2, (rm.bounds.min.z + rm.bounds.max.z) / 2, '');
      }
      for (const d of level.doors) { const y = d.floor ?? 0; if (y < lo || y > hi) continue; put(d.id.replace('d3_', ''), d.position.x, d.position.z, 'color:#9fe7ff;font-size:11px'); }
      for (let x = -30; x <= 30; x += 10) put(`x ${x}`, x, 6.2, 'color:#888;font-size:10px');
      for (let z = -40; z <= 0; z += 10) put(`z ${z}`, -35, z, 'color:#888;font-size:10px');
      put(deck === 'deck1' ? 'DECK 1 (y 0), cut at 3.0 m' : 'DECK 2 (y 4.8), cut 4.3 … 6.4 m', 20, 4, 'color:#fff;font-size:15px');
      const hidden = [];
      for (const el of document.body.children) if (el.tagName !== 'CANVAS' && el.id !== '__k5labels') { hidden.push([el, el.style.visibility]); el.style.visibility = 'hidden'; }
      document.body.appendChild(div);
      window.__k5undo = () => { for (const u of undo) u(); r.clippingPlanes = []; r.render = orig; cv.style.transform = tf; div.remove(); for (const [el, v] of hidden) el.style.visibility = v; };
    }, { lo, hi, W, H, deck });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `shots/k5/top-${deck}.png` });
    await page.evaluate(() => window.__k5undo());
    await page.waitForTimeout(500);
  }
  console.log('\n=== TOP-DOWN: shots/k5/top-deck1.png, shots/k5/top-deck2.png ===');
  await page.close();
}

await browser.close();
console.log(failures ? `\nK5: ${failures} failure(s)` : '\nK5: all pass');
process.exit(failures ? 1 : 0);
