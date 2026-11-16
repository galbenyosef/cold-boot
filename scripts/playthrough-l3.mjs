// Scripted end-to-end run of level 3 "THE QUIET SIDE" (stage 3a, docs/plans/stage-3a.md §10.1).
//
//   node scripts/playthrough-l3.mjs [baseUrl]                   default: the level end to end once per carried choice
//        [--choice=stop,command] [--frames]                      (beats, phase doors per step, R4 (no enemy before its
//                                                               beat), cutscene durations + end state, no input effect
//                                                               during scenes, purge timing, end card + carry). Frame
//                                                               sequences of C1 / C2 / the breach → shots/l3/ (--frames,
//                                                               or always for the first choice). Prints LEVEL3 OK.
//   node scripts/playthrough-l3.mjs [baseUrl] --checkpoints [--cp=cp3_canteen]
//                                                               per cp3_*: play to it, die, load, assert the restored
//                                                               world + phase, play on to the end. LEVEL3 CHECKPOINTS OK.
//   node scripts/playthrough-l3.mjs [baseUrl] --impatient       sprints / teleports, shoots everything on sight (doors,
//                                                               glass, Halvorsen, the viewport, cabin 3), later doors
//                                                               first, never waits; a test-side oracle judges EVERY
//                                                               spoken line from world state; soft-lock oracle.
//                                                               LEVEL3 IMPATIENT OK.
//   node scripts/playthrough-l3.mjs [baseUrl] --skip            second viewing: both scenes skipped; the end state equals
//                                                               a natural run's. LEVEL3 SKIP OK.
//
// Run it on a static build (`vite build` + `vite preview`). Timing-sensitive steps wait IN THE PAGE on game state /
// game time (`waitForFunction`), never on this script's wall clock: the machine may be loaded.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const base = argv.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173';
const MODE = argv.includes('--checkpoints') ? 'checkpoints' : argv.includes('--impatient') ? 'impatient' : argv.includes('--skip') ? 'skip' : 'default';
const ONLY_CP = argv.find((a) => a.startsWith('--cp='))?.slice(5) ?? null;
const CHOICES = argv.find((a) => a.startsWith('--choice='))?.slice(9).split(',') ?? ['stop', 'command'];
const FRAMES = argv.includes('--frames');
const SAVE_KEY = 'coldboot.save.l3.v2', SEEN_KEY = 'coldboot.seen.v1', CARRY_KEY = 'coldboot.carry.v2', LEVEL_KEY = 'coldboot.level';
const CPS = ['cp3_start', 'cp3_office', 'cp3_canteen', 'cp3_balcony'];
mkdirSync('shots/l3', { recursive: true });
const LINES = Object.fromEntries(JSON.parse(readFileSync('voice/lines.l3.json', 'utf8')).flatMap((l) => [[l.id, l.text], ['@' + l.id, l.speaker]]));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
const bad = (m) => { problems.push(m); console.log('  !! ' + m); };
const ok = (cond, m) => { if (!cond) bad(m); else console.log('  ok ' + m); return cond; };
page.on('console', (m) => { if (m.type() === 'error') console.log(`  [error] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log('  [pageerror]', e.message); });

// ───────────────────────────────────────────────────────────── in-page log + R4 watcher + (impatient) oracle
await page.addInitScript(([LINES, ORACLE]) => {
  let game;
  const L = window.__L3 = { beats: [], beatAt: {}, subs: [], toasts: [], spawned: [], early: [], firedInScene: [], fired: [], hits: [], denied: {}, reads: {}, viol: [], said: [], lines: [], noOracle: [], softLocks: [], died: {} };
  const NEED = { g3_admin: 'l3_admin_fight', g3_canteen_ha: 'l3_canteen_fight', g3_canteen_hb: 'l3_canteen_fight', g3_canteen_k: 'l3_canteen_fight', g3_breach: 'l3_breach', g3_garden: 'l3_breach', g3_breach_2: 'l3_purge' };
  Object.defineProperty(window, '__game', {
    configurable: true,
    get() { return game; },
    set(g) {
      game = g;
      const t = () => g.time;
      const beat = (id) => L.beats.includes(id);
      g.events.on('story:beat', (e) => { L.beats.push(e.id); L.beatAt[e.id] = t(); });
      g.events.on('story:toast', (e) => L.toasts.push(e.text));
      g.events.on('weapon:fired', () => { L.fired.push(t()); if (g.state === 'cutscene') L.firedInScene.push({ t: t(), state: g.state }); });
      g.events.on('bullet:impact', (e) => L.hits.push({ t: t(), p: [e.point.x, e.point.y, e.point.z], s: e.surface }));
      g.events.on('door:denied', (e) => { L.denied[e.id] = t(); });
      g.events.on('story:log', (e) => { L.reads[e.id] = t(); });
      g.events.on('enemy:died', (e) => { L.died[e.group] = (L.died[e.group] ?? 0) + 1; });
      // R4: nothing hostile before its beat; nothing at all before the takeover
      setInterval(() => {
        if (!g.ready || !g.enemies || !g.story?.debugState) return;
        // (the record's beats: a checkpoint load fast-forwards the earlier ones without emitting them)
        const rec = g.story.debugState.beats;
        const beat = (id) => rec.includes(id);
        for (const e of g.enemies.all) {
          if (!e.alive) continue;
          const need = NEED[e.group];
          if (!beat('l3_takeover') || (need && !beat(need))) {
            const k = `${e.group}@${need ?? 'takeover'}`;
            if (!L.early.includes(k)) L.early.push(k);
          }
        }
      }, 100);
      if (!ORACLE) return;
      // ── the impatient oracle: every spoken line judged from WORLD state at the instant its subtitle appears ──
      const P = () => g.player.position;
      const room = () => g.level.roomAt(P())?.id ?? null;
      const within = (at, s) => at !== undefined && t() - at <= s;
      const dbg = () => g.story.debugState;
      const choice = () => g.facts.choice;
      const alive = (n) => g.enemies.all.filter((e) => e.group === n && e.alive);
      const box = (x0, x1, y0, y1, z0, z1, p = P()) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p.z >= z0 && p.z <= z1;
      const inView = (group) => alive(group).some((e) => {
        const eye = g.player.eye, f = g.player.forward, c = e.position.clone(); c.y += 1.3;
        const d = c.clone().sub(eye), l = d.length() || 1;
        return Math.acos(Math.max(-1, Math.min(1, d.dot(f) / l))) * 180 / Math.PI <= 50 && g.physics.lineOfSight(eye, c);
      });
      const doorHit = (id, s) => { const d = g.level.door(id); return L.hits.some((h) => t() - h.t <= s && Math.hypot(h.p[0] - d.position.x, h.p[2] - d.position.z) < 0.9); };
      const doorHitEver = (id) => { const d = g.level.door(id); return L.hits.some((h) => Math.hypot(h.p[0] - d.position.x, h.p[2] - d.position.z) < 0.9 && h.p[1] > (d.y ?? 0) && h.p[1] < (d.y ?? 0) + 2.5); };
      const viewportHit = (s) => L.hits.some((h) => t() - h.t <= s && h.s === 'glass' && ((Math.abs(h.p[2] + 44) < 0.4 && Math.abs(h.p[0]) < 8.3) || (Math.abs(h.p[0] + 24) < 0.4 && h.p[2] > -42.2 && h.p[2] < -36.8)));
      const scene = (id) => g.state === 'cutscene' && dbg().scenes.cut?.id === id;
      const lastFired = () => L.fired.filter((x) => x < (L.beatAt.l3_meet ?? t()) + 1).slice(-1)[0] ?? -1e9;
      const phaseF = () => ['F', 'F_kitchen'].includes(dbg().phase);
      const said = (id) => L.said.includes(id);
      const control = () => dbg().t.control;
      const awakeNear = (r) => g.enemies.all.some((e) => e.alive && e.state !== 'dormant' && e.position.distanceTo(P()) <= r);
      const OR = {
        l3_unit_lift_arrive: () => within(L.beatAt.l3_arrive, 4) && room() === 'lift3',
        l3_halv_c1_1: () => scene('l3_c1') && (L.beatAt.l3_meet ?? t()) - lastFired() > 59,
        l3_halv_c1_1_shots: () => scene('l3_c1') && (L.beatAt.l3_meet ?? t()) - lastFired() <= 61,
        l3_halv_c1_2: () => scene('l3_c1') && g.player.currentWeapon !== null,
        l3_halv_c1_2b: () => scene('l3_c1') && g.player.currentWeapon === null,
        l3_reyes_phone: () => scene('l3_c1'), l3_halv_c1_3: () => scene('l3_c1'),
        l3_halv_c2_1: () => scene('l3_c2'), l3_halv_c2_2: () => scene('l3_c2'),
        l3_halv_c2_3: () => scene('l3_c2') && !g.level.door('d3_pressure').closed,
        l3_halv_c2_4: () => scene('l3_c2'), l3_halv_c2_6: () => scene('l3_c2'),
        l3_choir_told_stop: () => scene('l3_c2') && choice() === 'stop', l3_choir_told_command: () => scene('l3_c2') && choice() === 'command',
        l3_choir_quiet: () => scene('l3_c2'), l3_halv_c2_7: () => scene('l3_c2'), l3_reyes_come: () => scene('l3_c2'), l3_halv_c2_9: () => scene('l3_c2'),
        l3_halv_go_1: () => room() === 'office' && beat('l3_office') && !beat('l3_leave') && t() - control() >= 19.5,
        l3_halv_go_2: () => room() === 'office' && beat('l3_office') && !beat('l3_leave') && t() - control() >= 44.5 && said('l3_halv_go_1'),
        l3_halv_signed: () => room() === 'office' && (g.ui.noteOpen || within(L.reads.note3_schedule, 12)),
        l3_halv_memo: () => room() === 'office' && (g.ui.noteOpen || within(L.reads.note3_memo, 12)),
        l3_halv_pad: () => room() === 'office' && (g.ui.noteOpen || within(L.reads.note3_pad, 12)),
        l3_halv_lock: () => within(L.beatAt.l3_leave, 3),
        l3_halv_door: () => room() === 'admin' && Math.hypot(P().x + 30, P().z + 20) <= 3.2 && (within(L.denied.d3_office, 3.2) || doorHit('d3_office', 3.2)),
        l3_choir_pa_residents: () => beat('l3_leave') && room() !== 'office',
        l3_choir_canteen_stop: () => choice() === 'stop' && ['canteen', 'stair_w'].includes(room()) && phaseF() && g.enemies.activeCount <= 2,
        l3_choir_canteen_command: () => choice() === 'command' && ['canteen', 'stair_w'].includes(room()) && phaseF() && g.enemies.activeCount <= 2,
        l3_choir_breach_stop: () => choice() === 'stop' && inView('g3_breach'),
        l3_choir_breach_command: () => choice() === 'command' && inView('g3_breach'),
        l3_choir_breach_far_stop: () => choice() === 'stop' && beat('l3_breach') && alive('g3_breach').length + alive('g3_garden').length > 0,
        l3_choir_breach_far_command: () => choice() === 'command' && beat('l3_breach') && alive('g3_breach').length + alive('g3_garden').length > 0,
        l3_choir_glass_stop: () => choice() === 'stop' && beat('l3_leave') && viewportHit(2.4),
        l3_choir_glass_command: () => choice() === 'command' && beat('l3_leave') && viewportHit(2.4),
        l3_choir_purge_stop: () => choice() === 'stop' && beat('l3_purge') && !beat('l3_bio_open') && t() - L.beatAt.l3_purge >= 3.9 && (box(9, 12, 4.3, 8, -40, -12) || box(5.5, 12, 4.3, 8, -32, -29)),
        l3_choir_purge_command: () => choice() === 'command' && beat('l3_purge') && !beat('l3_bio_open') && t() - L.beatAt.l3_purge >= 3.9 && (box(9, 12, 4.3, 8, -40, -12) || box(5.5, 12, 4.3, 8, -32, -29)),
        l3_choir_end_stop: () => choice() === 'stop' && beat('l3_bio_sealed') && !g.enemies.all.some((e) => e.alive && e.position.x > 12 && e.position.x < 16 && e.position.z > -40 && e.position.z < -36 && e.position.y > 4),
        l3_choir_end_command: () => choice() === 'command' && beat('l3_bio_sealed') && !g.enemies.all.some((e) => e.alive && e.position.x > 12 && e.position.x < 16 && e.position.z > -40 && e.position.z < -36 && e.position.y > 4),
        l3_unit_bio_reader: () => g.player.hasKey('facilities_badge'),
        l3_unit_bio_denied: () => !g.player.hasKey('facilities_badge'),
        l3_unit_sector: () => !g.player.hasKey('facilities_badge') && beat('l3_takeover') && Object.values(L.denied).some((x) => t() - x <= 2.5),
        l3_unit_sector_badge: () => g.player.hasKey('facilities_badge') && beat('l3_takeover') && Object.values(L.denied).some((x) => t() - x <= 2.5),
        l3_resident_1: () => beat('l3_leave') && box(21.5, 24.5, -1, 3, -30.5, -28.2) && !awakeNear(12) && !doorHitEver('d3_q3'),
        l3_resident_2: () => said('l3_resident_1') && box(21.5, 24.5, -1, 3, -30.5, -28.2) && !awakeNear(12) && !doorHitEver('d3_q3'),
      };
      g.events.on('story:subtitle', (e) => {
        const log = g.story.lineLog ?? [];
        let id = null;
        for (let i = log.length - 1; i >= Math.max(0, log.length - 4); i--) if (log[i].said && LINES[log[i].said] === e.text) { id = log[i].said; break; }
        if (!id) return;
        let okk = true, why = '';
        try {
          if (LINES['@' + id] === 'choir' && !beat('l3_office_scene')) { okk = false; why = 'CHOIR before l3_choir_told_* (D5)'; }
          else if (OR[id]) { okk = !!OR[id](); if (!okk) why = 'oracle false'; }
          else if (!L.noOracle.includes(id)) L.noOracle.push(id);
        } catch (err) { okk = false; why = 'oracle threw: ' + err.message; }
        const rec = { id, t: +t().toFixed(1), ok: okk, room: room(), pos: [P().x, P().y, P().z].map((v) => +v.toFixed(1)) };
        L.lines.push(rec); L.said.push(id);
        if (!okk) L.viol.push({ ...rec, why, text: e.text });
      });
      // SOFT-LOCK oracle: the phase's goal door is locked, nothing hunting, nothing pending, for > 15 s (purge: its 15 s clock + 3)
      let stuck = 0, last = null;
      setInterval(() => {
        if (!g.ready || g.state !== 'playing') return;
        const d = dbg(); const ph = d.phase;
        const GOAL = { B: 'd3_pressure', H: 'd3_bio', H_ring: 'd3_bio' };
        const id = GOAL[ph]; const door = id ? g.level.door(id) : null;
        const isStuck = !!door && door.locked && g.enemies.activeCount === 0 && !g.ui.noteOpen && !d.talking;
        if (ph !== last) { last = ph; stuck = 0; }
        if (!isStuck) stuck = 0;
        else if ((stuck += 0.1) > (ph.startsWith('H') ? 18 : 15) && stuck < 1e8) { stuck = 1e9; L.softLocks.push({ phase: ph, door: id, t: +t().toFixed(1), pos: [P().x, P().z].map((v) => +v.toFixed(1)) }); }
        if (ph === 'J' && !beat('l3_end') && g.enemies.activeCount === 0 && t() - (L.beatAt.l3_bio_sealed ?? t()) > 30) { if (!L.softLocks.some((x) => x.phase === 'J')) L.softLocks.push({ phase: 'J', why: 'no end 30 s after the latch' }); }
      }, 100);
    },
  });
}, [LINES, MODE === 'impatient']);

// ───────────────────────────────────────────────────────────── helpers
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const boot = async (query = '') => {
  await page.evaluate(() => { window.__stale = true; }).catch(() => {});
  for (let i = 0; ; i++) {
    try { await page.goto(`${base}/?level=3&autostart=1&god=1${query}`); } catch (e) { if (i >= 2) throw e; await wait(700); continue; }
    if (await ev(() => !window.__stale).catch(() => false)) break;
    if (i >= 2) throw new Error('boot: stale page');
  }
  await page.waitForFunction(() => window.__game?.ready && window.__game.story?.debugState, null, { timeout: 120000 });
};
const clearAll = (seen = true) => ev(([k, s]) => { for (const x of k) localStorage.removeItem(x); if (s) localStorage.removeItem('coldboot.seen.v1'); }, [[SAVE_KEY, CARRY_KEY], seen]);
const dbg = () => ev(() => window.__game.story.debugState);
const L3 = () => ev(() => window.__L3);
const tp = (x, y, z, yawDeg = 0, pitchDeg = 0) => ev(([x, y, z, yaw, pitch]) => {
  const g = window.__game; const V = g.player.position.constructor;
  g.player.teleport(new V(x, y, z), yaw * Math.PI / 180, pitch * Math.PI / 180);
}, [x, y, z, yawDeg, pitchDeg]);
const use = (id) => ev((id) => { const g = window.__game; const i = g.interactables.get(id); if (!i) return 'missing'; if (!i.enabled) return 'disabled'; g.interactables.use(i); return 'ok'; }, id);
const closeNote = () => ev(() => window.__game.ui.closeNote?.());
/** Wait IN THE PAGE (game state) for a condition; false on timeout (wall-clock cap only). */
const until = async (fn, arg, ms = 60000) => { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch { return false; } };
const waitBeat = async (id, ms = 60000) => ok(await until((id) => window.__game.story.debugState.beats.includes(id), id, ms), `beat ${id}`);
const phaseIs = async (p, ms = 8000) => ok(await until((p) => window.__game.story.debugState.phaseApplied === p, p, ms), `phase ${p}`);
const door = (id) => ev((id) => { const d = window.__game.level.door(id); return d ? { locked: d.locked, open: d.isOpen, closed: d.closed } : null; }, id);
const doors = (ids) => ev((ids) => Object.fromEntries(ids.map((id) => { const d = window.__game.level.door(id); return [id, d ? (d.locked ? 'L' : d.isOpen ? 'O' : 'S') : '?']; })), ids);
const heard = (id) => ev((id) => window.__game.story.lineLog.some((l) => l.said === id), id);
const saidOneOf = (ids) => ev((ids) => window.__game.story.lineLog.filter((l) => l.said && ids.includes(l.said)).map((l) => l.said), ids);
const kill = (groups) => ev((groups) => {
  const g = window.__game; const V = g.player.position.constructor; let n = 0;
  for (const e of [...g.enemies.all]) {
    if (!e.alive || (groups && !groups.includes(e.group)) || e.state === 'dormant') continue;
    for (let k = 0; k < 8 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1));
    n++;
  }
  return n;
}, groups ?? null);
/** Keep killing until `beat` (or groups dead), in the page: the kills happen on game time. */
const killUntil = (cond, ms = 60000) => until((cond) => {
  const g = window.__game; const V = g.player.position.constructor;
  for (const e of [...g.enemies.all]) {
    if (!e.alive || e.state === 'dormant') continue;
    for (let k = 0; k < 8 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1));
  }
  return new Function('g', 'd', `return (${cond});`)(g, g.story.debugState);
}, cond, ms);
const fireAt = (x, y, z, n = 1) => ev(async ([x, y, z, n]) => {
  const g = window.__game;
  for (let i = 0; i < n; i++) {
    const e = g.player.eye; const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    await new Promise((r) => setTimeout(r, 60));
    const w = g.player.currentWeapon ? g.player.weapons[g.player.currentWeapon] : null;
    if (w && w.clip === 0) { g.player.debug.reload(); await new Promise((r) => setTimeout(r, 1900)); }
    g.player.debug.fire();
    await new Promise((r) => setTimeout(r, 330));
  }
}, [x, y, z, n]);
const frames = async (prefix, until_, every = 450, max = 120) => {
  for (let i = 0; i < max; i++) {
    if (await ev(until_).catch(() => true)) break;
    await page.screenshot({ path: `shots/l3/${prefix}-${String(i).padStart(3, '0')}.png` });
    await wait(every);
  }
};
/** Inputs during a scene: none may have an effect (no fire, no move off the scene's body path, no reload). */
const pokeInputs = async () => {
  await ev(() => { const g = window.__game; try { g.player.debug.fire(); g.player.debug.reload?.(); g.player.debug.move?.(1, 0, true); } catch { /* ignore */ } });
  await page.keyboard.down('KeyW'); await wait(250); await page.keyboard.up('KeyW');
  await page.mouse.down(); await wait(120); await page.mouse.up();
  await ev(() => { try { window.__game.player.debug.move?.(0, 0, false); } catch { /* ignore */ } });
};
const worldState = () => ev(() => {
  const g = window.__game, p = g.player, d = g.story.debugState, r = (v) => Math.round(v * 100) / 100;
  const ids = ['d3_lift', 'd3_pressure', 'd3_lobby', 'd3_lobby_inner', 'd3_office', 'd3_stair_w', 'd3_shutter_ne', 'd3_kitchen', 'd3_ring_e', 'd3_bio', 'd3_q3'];
  const doors = Object.fromEntries(ids.map((id) => { const x = g.level.door(id); return [id, x.locked ? 'L' : x.isOpen ? 'O' : 'S']; }));
  const scr = (n) => g.level.screen(n)?.userData?.screenKind ?? null;
  const lights = Object.fromEntries(['office', 'office_emerg', 'atrium_day', 'atrium_emerg', 'gallery_n', 'feed_l2'].map((n) => [n, g.render.lights.group(n).some((h) => h.enabled)]));
  return {
    state: g.state, phase: d.phase, phaseApplied: d.phaseApplied, pos: [p.position.x, p.position.y, p.position.z].map(r), yaw: r(p.yaw), pitch: r(p.pitch), fov: r(g.camera.fov),
    controls: p.controlsEnabled, safe: !!p.safe, keys: [...p.keys].sort(), flags: d.flags, doors, lights,
    screens: { monitor: scr('office_monitor'), thumb: scr('office_thumb_1'), admin: scr('admin_screen_1'), pdoor: scr('pdoor_panel'), lobby: scr('lobby_status') },
    halv: d.halv ? { at: d.halv.at, pose: d.halv.pose } : null, puppets: d.puppets.length, feedActors: d.feedActors, feeds: d.feeds,
    alive: g.enemies.all.filter((e) => e.alive).map((e) => e.group).sort(), restoredFrom: d.restoredFrom,
  };
});

// ───────────────────────────────────────────────────────────── the segments (a run is these in order)
const T0 = { start: null };
async function segLock() {
  console.log('── arrival, the lift latch');
  await waitBeat('l3_arrive', 30000);
  ok(await until(() => window.__game.story.debugState.beats.includes('#lift_open'), null, 20000), 'the lift opens (A2)');
  ok(await heard('l3_unit_lift_arrive'), 'lift announcement');
  await phaseIs('A2');
  await tp(0, 4.8, -3.5, 0);
  await waitBeat('l3_lock', 20000);
  await phaseIs('B');
  const d = await door('d3_lift'); ok(d.locked, `d3_lift latched (${JSON.stringify(d)})`);
  ok(await until(() => window.__game.story.debugState.checkpoints.includes('cp3_start'), null, 20000), 'cp3_start saved');
  const c = await dbg();
  const [hh, mm, ss] = c.countdown.split(':').map(Number);
  const left = hh * 3600 + mm * 60 + ss;
  ok(Math.abs(left - (36000 - c.clock)) <= 1.5, `countdown ${c.countdown} = 10:00:00 − clock ${c.clock.toFixed(1)} (±1 s)`);
}
async function segRelease() {
  console.log('── the release');
  await tp(0, 4.8, -5.6, 0);
  const t0 = await ev(() => window.__game.story.debugState.now);
  await waitBeat('l3_release', 20000);
  const t1 = (await dbg()).t.l3_release;
  ok(t1 - t0 >= 1.9 && t1 - t0 < 3.5, `equalising ≈ 2.0 s (${(t1 - t0).toFixed(2)} s)`);
  await phaseIs('B2');
  await until(() => window.__game.level.door('d3_pressure').isOpen, null, 8000);
  await tp(0, 4.8, -9.6, 90);
  await waitBeat('l3_quiet', 20000);
  await phaseIs('C');
  const d = await doors(['d3_pressure', 'd3_lobby', 'd3_lobby_inner', 'd3_shutter_ne', 'd3_bio']);
  ok(d.d3_pressure === 'L' && d.d3_lobby_inner === 'L' && d.d3_shutter_ne === 'O' && d.d3_bio === 'L', `phase C doors ${JSON.stringify(d)}`);
}
async function segQuiet() {
  console.log('── the quiet side (reads, the BIO reader denies)');
  for (const id of ['term3_lobby', 'note3_board', 'note3_guestbook']) { ok((await use(id)) === 'ok', `read ${id}`); await wait(400); await closeNote(); await wait(300); }
  await tp(10.6, 4.8, -39.0, -90);
  await use('bio_reader');
  ok(await until(() => window.__game.story.lineLog.some((l) => l.said === 'l3_unit_bio_denied'), null, 8000), 'reader denies without the badge');
  const s = await L3();
  ok(!s.said.some((id) => id.startsWith('l3_choir')) && !(await ev(() => window.__game.story.lineLog.some((l) => l.said?.startsWith('l3_choir')))), 'no CHOIR line before C2 (D5)');
}
let sceneStates = {};
async function segMeet({ skip = false, film = false, poke = true } = {}) {
  console.log(`── C1 → C2${skip ? ' (skipped)' : ''}`);
  await tp(-17.0, 4.8, -9.0, 90);
  await wait(300);
  await tp(-18.9, 4.8, -9.0, 90);
  ok(await until(() => window.__game.story.debugState.scenes.cut?.id === 'l3_c1', null, 15000), 'C1 starts at the inner door');
  const firedBefore = (await L3()).fired.length;
  if (skip) {
    await wait(600);
    await page.keyboard.down('Space'); await until(() => window.__game.story.debugState.scenes.cut?.id === 'l3_c2', null, 8000); await page.keyboard.up('Space');
    await wait(500);
    await page.keyboard.down('Space'); await until(() => window.__game.state === 'playing', null, 8000); await page.keyboard.up('Space');
  } else {
    if (film) await frames('c1', () => window.__game.story.debugState.scenes.cut?.id !== 'l3_c1', 400);
    else if (poke) { for (let i = 0; i < 4; i++) { await pokeInputs(); await wait(800); } }
    if (film) await frames('c2', () => window.__game.state === 'playing', 400);
    else if (poke) { for (let i = 0; i < 6; i++) { await pokeInputs(); await wait(1500); } }
  }
  ok(await until(() => window.__game.state === 'playing' && window.__game.story.debugState.beats.includes('l3_office'), null, 90000), 'control back after C2');
  const d = await dbg();
  const log = d.scenes.cut?.log ?? [];
  const c1 = log.find((x) => x.id === 'l3_c1'), c2 = log.find((x) => x.id === 'l3_c2');
  console.log('  scenes:', JSON.stringify(log), 'C2 schedule end', d.scenes.times.c2?.end);
  if (!skip) {
    ok(c1 && c1.result === 'done' && c1.t <= 14.6 + 0.5, `C1 ${c1?.t?.toFixed(2)} s (≤ 13 + 1.6 black)`);
    ok(c2 && c2.result === 'done' && c2.t <= 30.0, `C2 ${c2?.t?.toFixed(2)} s (≤ 30)`);
    const s = await L3();
    ok(s.firedInScene.length === 0 && s.fired.length === firedBefore, `no weapon fired during the scenes (${s.firedInScene.length})`);
  } else ok(c1?.result === 'skipped' && c2?.result === 'skipped', `both scenes skipped (${c1?.result}, ${c2?.result})`);
  const w = await worldState();
  const dy = Math.abs(Math.atan2(Math.sin(w.yaw - 3.02), Math.cos(w.yaw - 3.02))) * 180 / Math.PI;
  ok(Math.hypot(w.pos[0] + 29.4, w.pos[2] + 23.6) < 0.1 && dy <= 1, `end place (−29.4, −23.6) yaw 3.02: ${w.pos} yaw ${w.yaw} (Δ ${dy.toFixed(2)}°)`);
  ok(w.safe && w.keys.includes('facilities_badge') && w.phase === 'E' && w.fov > 71 && w.fov < 73, `safe ${w.safe}, badge, phase ${w.phase}, fov ${w.fov}`);
  ok(w.puppets === 3 && w.halv?.at === 'h2' && w.feedActors === 0 && !w.feeds.cam01 && !w.feeds.cam04, `3 units sealed at the inner door, Halvorsen at H2 (${JSON.stringify(w.halv)}), feeds gone`);
  ok(w.doors.d3_lobby === 'L' && w.doors.d3_lobby_inner === 'L' && w.doors.d3_pressure === 'L' && w.doors.d3_shutter_ne === 'L', `sector sealed ${JSON.stringify(w.doors)}`);
  ok(!w.lights.office && w.lights.office_emerg && !w.lights.atrium_day && w.lights.atrium_emerg, `takeover lights ${JSON.stringify(w.lights)}`);
  ok(await until(() => window.__game.story.debugState.checkpoints.includes('cp3_office'), null, 5000), 'cp3_office saved at once');
  const choirSaid = await saidOneOf(['l3_choir_told_stop', 'l3_choir_told_command']);
  const choice = await ev(() => window.__game.facts.choice);
  if (!skip) ok(choirSaid.length === 1 && choirSaid[0] === `l3_choir_told_${choice}`, `CHOIR's line by the carried choice (${choice}): ${choirSaid}`);
  sceneStates[skip ? 'skip' : 'natural'] = w;
  return w;
}
async function segOffice() {
  console.log('── the office (E): the weapon stowed, his reaction, the latch');
  const f0 = (await L3()).fired.length;
  await ev(() => { try { window.__game.player.debug.fire(); } catch { /* ignore */ } });
  await wait(400);
  ok((await L3()).fired.length === f0, 'no shot in phase E (weapon stowed)');
  ok((await use('note3_memo')) === 'ok', 'read the memo (in the office)');
  ok(await until(() => window.__game.story.lineLog.some((l) => l.said === 'l3_halv_memo'), null, 15000), 'Halvorsen reacts to the memo');
  await closeNote(); await wait(300);
  await tp(-30, 4.8, -18.3, 0);
  await waitBeat('l3_leave', 15000);
  await phaseIs('F');
  const w = await worldState();
  ok(!w.safe && w.doors.d3_office === 'L', `weapon up, office latched (${w.doors.d3_office})`);
  ok(await until(() => window.__game.story.lineLog.some((l) => l.said === 'l3_halv_lock'), null, 8000), "he locks it ('l3_halv_lock')");
  const l = await L3();
  ok(!l.early.length, `nothing hostile before its beat so far (${l.early})`);
  await waitBeat('l3_admin_fight', 12000);
  const g = await ev(() => window.__game.enemies.all.filter((e) => e.alive && e.group === 'g3_admin').length);
  const dd = await ev(() => window.__game.story.debugState.t);
  ok(g === 3, `g3_admin: the three units promoted (${g}); inner door at leave + ${(dd.l3_admin_fight - dd.l3_leave).toFixed(2)} s`);
  await killUntil('g.enemies.all.every((e) => !(e.alive && e.group === "g3_admin"))', 20000);
  ok(await until(() => window.__game.story.lineLog.some((l) => l.said === 'l3_choir_pa_residents'), null, 20000), 'CHOIR PA to the residents');
}
async function segCanteenCp() {
  console.log('── the west stair: cp3_canteen');
  await tp(-17.5, 4.8, -19.5, 180);
  await wait(500);
  await tp(-17.5, 0, -32.6, 180);
  ok(await until(() => window.__game.story.debugState.checkpoints.includes('cp3_canteen'), null, 20000), 'cp3_canteen saved');
}
async function segCanteen() {
  console.log('── the canteen (g3_canteen)');
  await tp(-15.5, 0, -37.2, 180);
  await waitBeat('l3_canteen_fight', 10000);
  ok(await until(() => window.__L3.beats.includes('l3_canteen_fight') && window.__game.enemies.all.filter((e) => e.group.startsWith('g3_canteen')).length >= 2, null, 20000), 'two canteen units arrive (hatch + kitchen)');
  ok(await until(() => window.__game.story.debugState.phaseApplied === 'F_kitchen' || window.__game.enemies.all.filter((e) => e.group.startsWith('g3_canteen_h')).length >= 2, null, 8000), 'the kitchen door opened for its unit (F_kitchen) or the other hatch dropped');
  await killUntil('g.enemies.all.every((e) => !(e.alive && e.group.startsWith("g3_canteen"))) && !d.flags.kitchenOpen', 40000);
  ok(await until(() => window.__game.story.debugState.phaseApplied === 'F', null, 20000), 'kitchen shut again (F)');
  // (stays until CHOIR has had its chance: the line waits for a free channel)
  await until(() => window.__game.story.lineLog.some((l) => l.id.startsWith('l3_choir_canteen')), null, 15000);
  const said = await saidOneOf(['l3_choir_canteen_stop', 'l3_choir_canteen_command']);
  const clog = await ev(() => window.__game.story.lineLog.filter((l) => l.id.includes('canteen')));
  ok(said.length === 1, `canteen line once (${said}) ${JSON.stringify(clog)}`);
}
async function segBreach({ film = false } = {}) {
  console.log('── the breach (g3_breach in the lock, the shutter, the sentry)');
  await tp(-10.6, 0, -39.0, -160, 12);   // the canteen garden door, looking at the gallery and the shutter
  await waitBeat('l3_breach', 10000);
  const s0 = await ev(() => window.__game.story.debugState.t.l3_breach);
  if (film) await frames('breach', () => window.__game.story.debugState.flags.garden && window.__game.time - window.__L3.beatAt.l3_breach > 9, 450, 40);
  ok(await until(() => window.__game.story.debugState.flags.shutter, null, 20000), 'the shutter opens (G)');
  await phaseIs('G', 4000);
  const dt = await ev(() => window.__game.story.debugState.t);
  ok(dt.shutter - s0 <= 8.6, `shutter at breach + ${(dt.shutter - s0).toFixed(2)} s (≤ 8)`);
  ok(await until(() => window.__game.story.debugState.flags.garden, null, 15000), 'the sentry spawned in the roof hatch (g3_garden)');
  const desc = await until(() => window.__game.enemies.all.some((e) => e.group === 'g3_garden' && e.alive && e.position.y < 10), null, 25000);
  ok(desc, 'the sentry descends from the roof void (y < 10)');
  await killUntil('d.flags.garden && g.enemies.all.every((e) => !(e.alive && (e.group === "g3_breach" || e.group === "g3_garden")))', 40000);
  await tp(0, 0, -22, 180);
  ok(await until(() => window.__game.story.debugState.checkpoints.includes('cp3_balcony'), null, 25000), 'cp3_balcony saved');
}
async function segPurge() {
  console.log('── the purge (15 s), breach 2, the inner lock, the end');
  await tp(10.6, 4.8, -39.1, -90);
  ok((await use('bio_reader')) === 'ok', 'badge on the reader');
  await waitBeat('l3_purge', 8000);
  await phaseIs('H', 3000);
  ok(await until(() => window.__game.story.lineLog.some((l) => l.said === 'l3_unit_bio_reader'), null, 8000), 'reader: badge accepted');
  await killUntil('d.beats.includes("l3_bio_open")', 40000);
  const d = await dbg();
  ok(Math.abs(d.purge.len - 15) <= 0.2, `purge ${d.purge.len} s (15 ± 0.2)`);
  await phaseIs('I', 3000);
  await killUntil('g.enemies.all.every((e) => !e.alive)', 30000);
  await tp(14.2, 4.8, -38, -90);
  await waitBeat('l3_bio_sealed', 15000);
  await phaseIs('J', 3000);
  ok(await until(() => window.__game.state === 'ended', null, 40000), 'the end (state ended)');
  const card = await ev(() => document.querySelector('.cb')?.innerText?.replace(/\s+/g, ' ') ?? '');
  ok(/THE QUIET SIDE/.test(card) && /TO BE CONTINUED/.test(card), `end card "${card.slice(0, 60)}"`);
  const endLine = await saidOneOf(['l3_choir_end_stop', 'l3_choir_end_command']);
  const choice = await ev(() => window.__game.facts.choice);
  ok(endLine.length === 1 && endLine[0] === `l3_choir_end_${choice}`, `end line ${endLine}`);
  const s = await ev((K) => ({ carry: JSON.parse(localStorage.getItem(K[0]) ?? 'null'), level: localStorage.getItem(K[1]), save: localStorage.getItem(K[2]) }), [CARRY_KEY, LEVEL_KEY, SAVE_KEY]);
  ok(s.carry?.from === 3 && s.carry.facts?.badge === true && s.carry.facts?.halvorsenAlive === true && s.carry.facts?.choice === choice && typeof s.carry.facts?.kills3 === 'number', `carry for 3b ${JSON.stringify(s.carry?.facts)}`);
  ok(s.level === '3' && s.save === null, `stored level stays 3 (${s.level}), checkpoint cleared`);
  const l = await L3();
  ok(!l.early.length, `R4: no enemy before its beat (${l.early})`);
}
const SEGS = [segLock, segRelease, segQuiet, segMeet, segOffice, segCanteenCp, segCanteen, segBreach, segPurge];
const CP_AFTER = { cp3_start: 0, cp3_office: 3, cp3_canteen: 5, cp3_balcony: 7 };
const PHASE_OF = { cp3_start: 'B', cp3_office: 'E', cp3_canteen: 'F', cp3_balcony: 'G' };

// ───────────────────────────────────────────────────────────── modes
if (MODE === 'default') {
  for (const [i, choice] of CHOICES.entries()) {
    console.log(`\n══════════ LEVEL 3 — choice ${choice} ══════════`);
    await boot(`&choice=${choice}&handoff=1`); await clearAll(); await boot(`&choice=${choice}&handoff=1`);
    const film = FRAMES || i === 0;
    for (const s of SEGS) {
      if (s === segMeet) await segMeet({ film: film || choice === 'command', poke: !film });
      else if (s === segBreach) await segBreach({ film });
      else await s();
    }
  }
} else if (MODE === 'checkpoints') {
  for (const cp of CPS) {
    if (ONLY_CP && cp !== ONLY_CP) continue;
    console.log(`\n══════════ ${cp} ══════════`);
    await boot('&handoff=1'); await clearAll(); await boot('&handoff=1');
    for (let i = 0; i <= CP_AFTER[cp]; i++) await SEGS[i]();
    ok(await until((cp) => window.__game.story.debugState.checkpoints.includes(cp), cp, 20000), `${cp} written`);
    await wait(300);
    const want = await worldState();
    const saved = await ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), SAVE_KEY);
    ok(saved?.id === cp, `the save holds ${cp} (${saved?.id})`);
    await ev(() => { const g = window.__game; g.debug.god = false; g.player.damage(9999); });
    ok(await until(() => window.__game.state === 'dead', null, 8000), 'died');
    await boot('&handoff=1&continue=1');
    ok(await until(() => window.__game.state === 'playing', null, 20000), 'playing after the load');
    await wait(1500);
    const got = await worldState();
    await page.screenshot({ path: `shots/l3/${cp}-restored.png` });
    console.log('  restored:', JSON.stringify({ phase: got.phase, pos: got.pos, doors: got.doors, halv: got.halv, puppets: got.puppets, safe: got.safe, alive: got.alive }));
    ok(got.restoredFrom === cp && got.phase === PHASE_OF[cp] && got.phaseApplied === PHASE_OF[cp], `${cp}: restoredFrom ${got.restoredFrom}, phase ${got.phase}/${got.phaseApplied}`);
    const sp = saved.player.position;
    ok(Math.hypot(got.pos[0] - sp[0], got.pos[2] - sp[2]) < 0.8, `${cp}: position ${got.pos}`);
    // (auto doors open / shut with whoever stands near them: compare locked-ness)
    const lockOf = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === 'L' ? 'L' : 'U']));
    want.doors = lockOf(want.doors); got.doors = lockOf(got.doors);
    for (const k of ['doors', 'keys', 'safe', 'halv', 'puppets']) ok(JSON.stringify(got[k]) === JSON.stringify(want[k]), `${cp}: ${k} ${JSON.stringify(got[k])} = ${JSON.stringify(want[k])}`);
    for (const k of ['office', 'emergency']) void k;
    ok(JSON.stringify(got.lights) === JSON.stringify(want.lights), `${cp}: lights ${JSON.stringify(got.lights)}`);
    ok(got.alive.length === 0, `${cp}: nobody alive after the load (${got.alive})`);
    const l = await L3();
    const replayed = l.beats.filter((b) => saved.story.beats.includes(b) && b !== 'habitat_takeover');
    ok(!replayed.length, `${cp}: no beat replayed by the load (${replayed})`);
    ok(l.toasts.includes('CHECKPOINT RESTORED'), `${cp}: toast`);
    for (let i = CP_AFTER[cp] + 1; i < SEGS.length; i++) await SEGS[i]();
  }
} else if (MODE === 'skip') {
  console.log('\n══════════ natural run (marks both scenes seen) ══════════');
  await boot('&handoff=1'); await clearAll(); await boot('&handoff=1');
  for (let i = 0; i <= 2; i++) await SEGS[i]();
  const nat = await segMeet({ poke: false });
  console.log('\n══════════ second viewing: both skipped ══════════');
  await clearAll(false); await boot('&handoff=1');
  ok((await ev((k) => JSON.parse(localStorage.getItem(k) ?? '[]'), SEEN_KEY)).includes('l3_c2'), 'seen: l3_c1, l3_c2');
  for (let i = 0; i <= 2; i++) await SEGS[i]();
  const sk = await segMeet({ skip: true });
  for (const k of ['phase', 'pos', 'yaw', 'pitch', 'fov', 'controls', 'safe', 'keys', 'doors', 'lights', 'screens', 'halv', 'puppets', 'feedActors', 'feeds']) {
    ok(JSON.stringify(nat[k]) === JSON.stringify(sk[k]), `skip = natural: ${k} ${JSON.stringify(sk[k])}`);
  }
  const fl = (o) => { const { shotDoors, ...r } = o.flags; return r; };
  ok(JSON.stringify(fl(nat)) === JSON.stringify(fl(sk)), 'skip = natural: flags');
  const jumped = await ev(() => window.__game.player.velocity.y);
  ok(Math.abs(jumped) < 0.5, `no jump after the skip (vy ${jumped})`);
  for (let i = 4; i < SEGS.length; i++) await SEGS[i]();
} else if (MODE === 'impatient') {
  await runImpatient();
}

async function runImpatient() {
  console.log('\n══════════ IMPATIENT ══════════');
  await boot('&handoff=1&choice=command'); await clearAll(); await boot('&handoff=1&choice=command');
  await waitBeat('#lift_open', 20000);
  // shoots the lift door, runs into the lock before the cab has settled, back into the lift, out again
  await fireAt(0, 6, 0.2, 2);
  await tp(0, 4.8, -1.0, 0); await tp(0, 4.8, 1.0, 180); await wait(400); await tp(0, 4.8, -6.0, 0);
  await waitBeat('l3_lock', 20000);
  await waitBeat('l3_release', 20000);
  // stands in the pressure doorway while it latches (latch fails, reopens, re-arms), then goes through
  await tp(0, 4.8, -8.4, 0); await wait(200); await tp(0, 4.8, -7.0, 0); await wait(3000);
  await tp(0, 4.8, -10.5, 90);
  await waitBeat('l3_quiet', 30000);
  // later doors first: the BIO reader, the stair door, cabin 3; shoots the glazing, the viewport, cabin 3
  await tp(10.6, 4.8, -39.1, -90); await use('bio_reader'); await wait(300); await use('bio_reader');
  await fireAt(0, 2, -44, 2);                                  // the viewport before the takeover: CHOIR must say nothing
  await tp(23, 0, -29.6, 0); await fireAt(23, 1.2, -28, 2);     // cabin 3
  await tp(-19.0, 4.8, -18.5, 90); await wait(300);            // the staff door from the stair landing (locked in C)
  await tp(-4, 4.8, -9.6, 180); await fireAt(-4, 6, -12, 2);    // the gallery glass
  // runs at the inner door having fired: the shots variant
  await tp(-18.9, 4.8, -9.0, 90);
  ok(await until(() => window.__game.story.debugState.scenes.cut?.id === 'l3_c1', null, 15000), 'C1 starts');
  for (let i = 0; i < 8; i++) { await pokeInputs(); await wait(900); }
  ok(await until(() => window.__game.state === 'playing' && window.__game.story.debugState.beats.includes('l3_office'), null, 90000), 'control after C2');
  // tries to shoot Halvorsen, stands in the doorway (weapon stowed: no shot), leaves at once
  const f0 = (await L3()).fired.length;
  await fireAt(-32.15, 6.0, -24.2, 3);
  await tp(-30, 4.8, -19.7, 0); await ev(() => window.__game.player.debug.fire()); await wait(3000); await ev(() => window.__game.player.debug.fire());
  ok((await L3()).fired.length === f0, 'no shot while in phase E (stowed), also in the doorway');
  await use('note3_pad'); await wait(300); await closeNote();
  await tp(-30, 4.8, -17.8, 0);
  await waitBeat('l3_leave', 15000);
  // his door: tries it and shoots it
  await tp(-30, 4.8, -18.6, 180); await fireAt(-30, 5.8, -20, 2);
  await ev(() => window.__game.events.emit('door:denied', { id: 'd3_office', position: window.__game.level.door('d3_office').position }));
  await wait(2500);
  // sprints past the admin group, down the stair, through the canteen into the garden, shooting what it sees
  await tp(-21, 4.8, -18.5, -90); await wait(300); await tp(-17.5, 0, -32.6, 180); await wait(400);
  await tp(-15.5, 0, -37.2, 180); await wait(1500); await kill(); await wait(1500); await kill();
  await tp(-6, 0, -30, 160);
  await waitBeat('l3_breach', 10000);
  await wait(3500);
  await fireAt(1, 2, -44, 2);                                   // the viewport after the takeover: once
  await killUntil('d.flags.garden && g.enemies.all.filter((e) => e.alive && ["g3_breach","g3_garden"].includes(e.group)).length === 0', 50000);
  // the quarters: cabin 3 was shot before, so the resident never speaks
  await tp(23, 0, -29.4, 0); await wait(6000);
  await kill();
  await tp(10.6, 4.8, -39.1, -90); await use('bio_reader');
  await waitBeat('l3_purge', 8000);
  await killUntil('d.beats.includes("l3_bio_open")', 40000);
  await kill();
  await tp(14.2, 4.8, -38, -90);
  ok(await until(() => window.__game.state === 'ended', null, 60000), 'the end');
  const l = await L3();
  console.log(`\n  ORACLE: ${l.lines.length} lines judged, ${l.viol.length} false; no oracle for: ${l.noOracle.join(', ') || '—'}`);
  for (const v of l.viol) bad(`line said while false: ${JSON.stringify(v)}`);
  for (const x of l.softLocks) bad(`SOFT-LOCK: ${JSON.stringify(x)}`);
  if (l.noOracle.length) bad(`lines without an oracle: ${l.noOracle}`);
  ok(!l.early.length, `R4 (${l.early})`);
  ok(!l.said.includes('l3_resident_1') && !l.said.includes('l3_resident_2'), 'cabin 3 was shot: the resident stays silent');
  ok(l.said.includes('l3_halv_c1_1_shots'), 'C1: the shots variant after firing');
  ok(!l.firedInScene.length, 'no shot during the scenes');
  console.log('  lines:', l.lines.map((x) => `${x.t} ${x.id}`).join(' | '));
}

await browser.close();
const okLine = { default: 'LEVEL3 OK', checkpoints: 'LEVEL3 CHECKPOINTS OK', impatient: 'LEVEL3 IMPATIENT OK', skip: 'LEVEL3 SKIP OK' }[MODE];
console.log(problems.length ? `\nFAILED:\n - ${problems.join('\n - ')}` : `\n${okLine}`);
process.exit(problems.length ? 1 : 0);
