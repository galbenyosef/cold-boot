// Scripted end-to-end run of the REVISION 2 story flow (teleports + API calls, god mode).
//
//   node scripts/playthrough.mjs [baseUrl]            full flow; asserts key state changes; prints
//                                                     PLAYTHROUGH OK; screenshots → shots/pt-*.png
//   node scripts/playthrough.mjs [baseUrl] --scares   fires every vignette id and every actor scare in
//                                                     place and screenshots each → shots/scares/*.png
//
//   node scripts/playthrough.mjs [baseUrl] --checkpoints [--cp=cp_key]
//                                                     REVISION 3 acceptance matrix: for EACH checkpoint id,
//                                                     play up to just after it, check the save, die, LOAD
//                                                     (reload with ?autostart=1&continue=1), assert the
//                                                     restored world, then play on to the ending. Prints
//                                                     CHECKPOINTS OK. `--cp=` runs a single checkpoint.
//
//   node scripts/playthrough.mjs [baseUrl] --level2 [--ending=shutdown|rewrite]
//                                                     level 2 "LINE TWO" (REVISION 5 flow): boots ?level=2, drives the
//                                                     level end to end once per ending, asserts the beats, the
//                                                     phase doors and the taking's timings; frame sequences of
//                                                     the taking → shots/l2/take-*.png; prints LEVEL2 OK.
//   node scripts/playthrough.mjs [baseUrl] --level2 --checkpoints [--cp=cp2_relay]
//                                                     for each cp2_* checkpoint: play to it, die, load, assert
//                                                     the restored world + phase, play on to an ending.
//                                                     LEVEL2 CHECKPOINTS OK.
//   node scripts/playthrough.mjs [baseUrl] --level2 --impatient
//                                                     the impatient player (REVISION 5.1): shoots every unit on
//                                                     sight, wrong order, never waits for dialogue; a test-side
//                                                     oracle judges every spoken line from world state; timing
//                                                     cases at closing doors. LEVEL2 IMPATIENT OK.
//
// Per step it prints state / objective / room / enemies / fps / draw calls. Exit 1 on failure.
// The run "hurries" the story's quiet windows (story.hurry()) so it does not sit through every pause.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const SCARES = argv.includes('--scares');
const CHECKPOINTS = argv.includes('--checkpoints');
const ONLY_CP = argv.find((a) => a.startsWith('--cp='))?.slice(5) ?? null;
const LEVEL2 = argv.includes('--level2');
const SAVE_KEY = LEVEL2 ? 'coldboot.save.l2.v2' : 'coldboot.save.l1.v2';
const CP_IDS = ['cp_armed', 'cp_fab', 'cp_lockout', 'cp_key', 'cp_breaker', 'cp_lobby'];
const base = argv.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173';
mkdirSync('shots', { recursive: true });
if (SCARES) mkdirSync('shots/scares', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const problems = [];
const notes = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log('  [pageerror]', e.message); });
// A reload nobody asked for (dev-server HMR, a crash guard) ruins a run: say so instead of dying on a stale handle.
let expectNav = true;
page.on('framenavigated', (f) => { if (f === page.mainFrame() && !expectNav) console.log(`  [navigated] ${f.url()} — unexpected page load`); });
// Event log from the very first frame (a checkpoint load fast-forwards before `ready` is visible to us).
await page.addInitScript(() => {
  let game;
  window.__log = { beats: [], subs: [], subAt: [], toasts: [], woke: [], spawned: [], pickups: [], attacks: [] };
  window.__woke = []; window.__spawned = [];
  Object.defineProperty(window, '__game', {
    configurable: true,
    get() { return game; },
    set(g) {
      game = g;
      try {
        const L = window.__log;
        const group = (id) => g.enemies?.all.find((e) => e.id === id)?.group ?? '?';
        g.events.on('story:beat', (e) => L.beats.push(e.id));
        g.events.on('story:subtitle', (e) => { L.subs.push(`${e.speaker}: ${e.text}`); try { L.subAt.push({ text: e.text, t: g.time, room: g.level.roomAt(g.player.position)?.id ?? null }); } catch { /* early */ } });
        g.events.on('story:toast', (e) => L.toasts.push(e.text));
        g.events.on('pickup', (e) => L.pickups.push(e.kind));
        g.events.on('enemy:attack', (e) => L.attacks.push({ group: group(e.id), t: g.time }));
        g.events.on('enemy:woke', (e) => { const r = { type: e.type, group: group(e.id) }; L.woke.push(r); window.__woke.push(r); });
        // The group is resolved a moment later (the enemy is not in `all` yet while the event fires).
        g.events.on('enemy:spawned', (e) => { const r = { type: e.type, group: '?', t: g.time }; L.spawned.push(r); window.__spawned.push(r); setTimeout(() => { r.group = group(e.id); }, 100); });
      } catch (err) { console.error('init hook failed', err); }
    },
  });
});
const boot = async (query = '') => {
  const url = `${base}/?autostart=1&god=1${LEVEL2 && !/[?&]level=/.test(query) && !query.includes('nolevel') ? '&level=2' : ''}${query}`;
  // Navigating while the previous page still streams voice files can abort once: retry.
  expectNav = true;
  // Mark the outgoing page: `ready` must come from a NEW page. An aborted / retried navigation must never let the
  // previous run's page (its beats, its choice) pass for a fresh boot.
  await page.evaluate(() => { window.__stalePage = true; }).catch(() => {});
  for (let i = 0; ; i++) {
    try { await page.goto(url); } catch (e) { if (i >= 2) throw e; await page.waitForTimeout(700); continue; }
    const fresh = await page.evaluate(() => !window.__stalePage).catch(() => false);
    if (fresh) break;
    if (i >= 2) throw new Error('boot: the page did not reload (stale page after goto)');
    await page.waitForTimeout(700);
  }
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
  expectNav = false;
};
await boot();
if (!SCARES) { await page.evaluate((k) => localStorage.removeItem(k), SAVE_KEY); await boot(); }

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const tp = (x, y, z, yawDeg = 0, pitchDeg = 0) => ev(([x, y, z, yaw, pitch]) => {
  const g = window.__game; const V = g.player.position.constructor;
  g.player.teleport(new V(x, y, z), yaw * Math.PI / 180, pitch * Math.PI / 180);
}, [x, y, z, yawDeg, pitchDeg]);
const use = (id) => ev((id) => { const g = window.__game; const i = g.interactables.get(id); if (!i) return 'missing'; if (!i.enabled) return 'disabled'; g.interactables.use(i); return 'ok'; }, id);
const has = (id) => ev((id) => !!window.__game.interactables.get(id), id);
const killAll = () => ev(() => {
  const g = window.__game; const V = g.player.position.constructor; let n = 0;
  for (const e of [...g.enemies.all]) {
    if (!e.alive || e.state === 'dormant') continue;
    for (let k = 0; k < 6 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1));
    n++;
  }
  return n;
});
const hurry = () => ev(() => window.__game.story.hurry?.());
const status = () => ev(() => {
  const g = window.__game; const d = g.story.debugState ?? { beats: [] };
  return {
    state: g.state, objective: g.story.objective, room: g.level.roomAt(g.player.position)?.id, active: g.enemies.activeCount,
    alive: g.enemies.all.filter((e) => e.alive).length, fps: Math.round(g.debug.fps), calls: g.renderer.info.render.calls,
    locked: g.level.doors.filter((d) => d.locked).map((d) => d.id).join(','),
    note: !!g.ui.noteOpen, mood: d.mood, actors: d.actors,
    beats: d.beats,
  };
});
const step = async (name, expect) => {
  const s = await status();
  await page.screenshot({ path: `shots/pt-${name}.png` });
  const { beats, ...short } = s;
  console.log(`[${name}]`, JSON.stringify(short));
  if (expect) { const why = expect(s); if (why) { problems.push(`${name}: ${why}`); console.log('  !! ' + why); } }
  return s;
};
/** Wait until a beat / cue marker is recorded (hurrying the quiet windows). */
const waitBeat = async (id, seconds = 30, opts = {}) => {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const b = await ev(() => window.__game.story.debugState?.beats ?? []);
    if (b.includes(id)) return true;
    if (!opts.noHurry) await hurry();
    await wait(250);
  }
  if (!opts.optional) { problems.push(`beat/cue "${id}" never fired (${seconds}s)`); console.log(`  !! beat/cue "${id}" never fired`); }
  else console.log(`  (optional cue "${id}" did not fire)`);
  return false;
};
const closeNote = async () => { await wait(900); await ev(() => window.__game.ui.closeNote?.()); await wait(350); };
/** Use a readable; assert the compact note opens and the world keeps running. */
const read = async (id, { optional = false } = {}) => {
  if (!(await has(id))) { (optional ? notes : problems).push(`interactable ${id} missing`); console.log(`  ${id}: missing${optional ? ' (level not updated?)' : ''}`); return false; }
  const r = await use(id);
  await wait(500);
  const s = await status();
  console.log(`  read ${id}: ${r} note=${s.note} state=${s.state}`);
  if (r !== 'ok') problems.push(`${id}: ${r}`);
  else if (!s.note) problems.push(`${id}: note card did not open`);
  else if (s.state !== 'playing') problems.push(`${id}: world paused while reading (${s.state})`);
  await closeNote();
  return true;
};

// Feature detection (the level / enemies modules land separately; fallbacks are exercised otherwise).
const feat = await ev(() => {
  const g = window.__game;
  return {
    vignette: typeof g.level.vignette === 'function', actor: typeof g.enemies.actor === 'function',
    quarters: g.level.rooms.some((r) => r.id === 'quarters'), pump: g.level.rooms.some((r) => r.id === 'pump'),
    key: g.level.pickupSpawns.find((p) => p.kind === 'keycard')?.id ?? null,
    groups: [...new Set(g.level.enemySpawns.map((s) => s.group))].join(','),
    rooms: g.level.rooms.map((r) => r.id).join(','),
  };
});
console.log('features:', JSON.stringify(feat));
const FULL = feat.vignette && feat.actor && feat.quarters && feat.pump && feat.groups.includes('g_fab_return') && !feat.groups.includes('g_sec');
if (!FULL && !LEVEL2) notes.push('level/enemies revision 2 not fully present — fallback paths were exercised');

// ───────────────────────────────────────────────────────────────────────── --scares
if (SCARES) {
  // name → [x, z, yawDeg, pitchDeg] viewpoint (yaw 0 faces -Z, +90 faces -X).
  const VIEW = {
    med_monitor_spike: [0.45, 7.0, 180, -8], med_arm_drop: [-1.6, 4.4, 90, -18],
    corr_lights_chase: [0, -1.5, 0, 0], corr_silhouette: [0, -6, 0, 0],
    quarters_locker_bang: [-5.5, -7, 90, 0], quarters_curtain: [-5.5, -7, 0, 0], quarters_figure: [-3, -6.5, 60, 0],
    sec_vent_drop: [-5.5, -17, 90, 25], storage_canister: [4.5, -17, -90, -10],
    airlock_cycle: [0, -21.5, 0, 0],
    fab_conveyor_step: [0, -30, 0, 20], fab_arms_watch: [0, -31, 0, 5], fab_skitter: [0, -29, 0, 22], fab_figure: [0, -30, 0, 0],
    gen_ripple: [14, -38, -90, 0], gen_lever_throw: [17, -38, -90, 0],
    pump_knock: [-13.5, -38, 90, 15], pump_bubbles: [-15, -38, 90, -20],
    lobby_tarp: [0.2, -51.6, -22, -22], elev_gate_rattle: [0, -56.5, 0, 0],
  };
  // Open everything, quieten the story's own scheduling, light things up.
  await ev(() => { const g = window.__game; for (const d of g.level.doors) d.unlock(); });
  await page.keyboard.press('KeyF');
  const names = await ev(() => window.__game.story.fire ? null : 'no story.fire');
  if (names) { console.log('story.fire missing'); await browser.close(); process.exit(1); }
  let fired = 0, missing = 0;
  for (const [name, [x, z, yaw, pitch]] of Object.entries(VIEW)) {
    await tp(x, 0, z, yaw, pitch);
    await wait(1200);
    const r = await ev(([name]) => {
      const g = window.__game; const V = g.player.position.constructor;
      const at = g.story.fire(name);
      // Actor scares report where to look: face it.
      if (at && (at.x || at.z)) {
        const p = g.player.eye; const dx = at.x - p.x, dy = at.y - p.y, dz = at.z - p.z;
        g.player.teleport(g.player.position.clone(), Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      }
      void V;
      return at;
    }, [name]);
    if (!r) { missing++; console.log(`[scare ${name}] NOT AVAILABLE (level.vignette / enemies.actor missing)`); }
    else fired++;
    for (let i = 0; i < 3; i++) {
      await wait(i === 0 ? 700 : 900);
      await page.screenshot({ path: `shots/scares/${name}-${i}.png` });
    }
    const s = await status();
    console.log(`[scare ${name}]`, JSON.stringify({ fired: !!r, room: s.room, fps: s.fps, calls: s.calls, actors: s.actors }));
    if (name === 'fab_arms_watch') await ev(() => window.__game.story.fire('fab_arms_watch')); // release the toggle
    await wait(1500);
  }
  await browser.close();
  console.log(`\nSCARES: ${fired} fired, ${missing} unavailable — screenshots in shots/scares/`);
  console.log(problems.length ? `FAILED:\n - ${problems.join('\n - ')}` : 'SCARES OK');
  process.exit(problems.length ? 1 : 0);
}

// ───────────────────────────────────────────────────────────────────────── full flow
// The flow is cut into segments, each ending just after one checkpoint (REVISION 3). The full run plays
// them all in order; --checkpoints replays a prefix, dies, loads, and plays the rest.
const skitters = () => ev(() => window.__game.enemies.all.filter((e) => e.type === 'skitter' && e.alive && e.state !== 'dormant').length);
const lockedHas = (s, id) => s.locked.split(',').includes(id);
/** `fast`: only what the story needs (no optional scares / long reads) — used by the checkpoint matrix. */
let fast = false;
let shotPrefix = 'shots/pt-';
const stepShot = step;
const st = async (name, expect) => {
  if (!fast) return stepShot(name, expect);
  const s = await status();
  const { beats, ...short } = s;
  console.log(`[${name}]`, JSON.stringify(short));
  if (expect) { const why = expect(s); if (why) { problems.push(`${shotPrefix}${name}: ${why}`); console.log('  !! ' + why); } }
  return s;
};
const atLever = () => ev(() => { const g = window.__game; const i = g.interactables.get('gen_lever'); const V = g.player.position.constructor; g.player.teleport(new V(i.position.x - 1.4, 0, i.position.z), -Math.PI / 2, 0); });
const readSave = () => ev((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, SAVE_KEY);
/** Wait for the auto-save `id` to be written (the story defers it until the moment is calm). */
const waitCheckpoint = async (id, seconds = 20) => {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const sv = await readSave();
    if (sv?.id === id) { console.log(`  checkpoint ${id} saved @ ${sv.place} ${JSON.stringify(sv.player.position)}`); return sv; }
    await wait(200);
  }
  const d = await ev(() => { const d = window.__game.story.debugState; return { pending: d.pendingCheckpoint, calm: d.calm, last: d.checkpoint, triggered: d.triggered, cleared: d.cleared, active: window.__game.enemies.activeCount }; });
  problems.push(`checkpoint ${id} was not saved within ${seconds}s (${JSON.stringify(d)})`);
  console.log(`  !! checkpoint ${id} not saved`, JSON.stringify(d));
  return null;
};

if (LEVEL2) { await runLevel2(); }

// A — medical → corridor → quarters → junction hold → security: console, pistol.            → cp_armed
async function segArmed() {
  await wait(fast ? 800 : 2500);
  await st('01-med', (s) => {
    if (s.objective !== 'Find someone') return `objective "${s.objective}"`;
    if (!lockedHas(s, 'd_fab_outer')) return 'd_fab_outer should start locked';
    if (lockedHas(s, 'd_storage')) return 'd_storage should start unlocked';
    if (feat.pump && !lockedHas(s, 'd_pump')) return 'd_pump should start locked';
    if (s.active > 0) return 'enemies active at start';
    return null;
  });
  {
    const r = await use('log_gen');
    if (r === 'ok') problems.push('log_gen usable before power');
  }
  if (!fast) {
    await waitBeat('#med_monitor_spike', 25);
    await tp(-0.2, 0, 3.2, 0); await waitBeat('#med_arm_drop', 25); await st('02-med-arm');
    await tp(1.4, 0, 1.2, 0); await read('log_med');
    await waitBeat('#pa_wake', 15); await wait(2500); await st('03-pa-wake');

    // corridor: lights chase + silhouette, only while facing the junction end.
    await tp(0, 0, -3, 180); await hurry(); await wait(1500);
    {
      const b = await ev(() => window.__game.story.debugState.beats);
      if (b.includes('corr_first_dark')) problems.push('corridor scare fired while the player faced away');
    }
    await tp(0, 0, -3, 0); await waitBeat('corr_first_dark', 25); await wait(2600);
    await st('04-corridor', (s) => (feat.actor && s.actors < 1 ? 'no silhouette actor during the lights chase' : null));
    await wait(6500);
    await st('05-corridor-after', (s) => (s.actors > 0 && !feat.quarters ? 'silhouette actor was not removed' : null));

    // quarters (optional room).
    if (feat.quarters) {
      await tp(-3, 0, -6.5, -90); await waitBeat('quarters', 10); await wait(800);
      // The figure in the canteen corner: look at it, look away, look back — it must be gone.
      await tp(-4, 0, -6.5, 51.6); await wait(1600);
      await st('06-quarters-figure', (s) => (feat.actor && s.actors < 1 ? 'no figure in the canteen corner' : null));
      await tp(-4, 0, -6.5, -120); await wait(700);
      await tp(-4, 0, -6.5, 51.6); await wait(600);
      await st('06b-quarters-figure-gone', (s) => (s.actors > 0 ? 'the figure was not removed while off-screen' : !s.beats.includes('#quarters_figure') ? 'quarters_figure cue not recorded' : null));
      const figAt = await ev(() => { const g = window.__game; const i = g.interactables.get('note_quarters_badges'); return i ? [i.position.x, i.position.z] : null; });
      console.log('  badges note at', JSON.stringify(figAt));
      await read('note_quarters_badges', { optional: true });
      await waitBeat('#quarters_locker_bang', 60); await wait(1800); await st('07-quarters-locker');
      await read('note_quarters_bunk', { optional: true });
      await waitBeat('#quarters_curtain', 90); await wait(1500); await st('08-quarters-curtain');
    } else console.log('  (no quarters room in this level build — skipped)');
  } else {
    // The matrix still reads one fragment and takes a hit, so "read" and a non-default health are restored.
    await tp(1.4, 0, 1.2, 0); await read('log_med');
    await ev(() => { window.__game.debug.god = false; window.__game.player.damage(37); window.__game.debug.god = true; });
  }

  // junction: the hold.
  await tp(0, 0, -18.6, 0); await wait(900); console.log('  fab door:', await use('door_d_fab_outer')); await wait(700);
  await st('09-junction-hold', (s) => {
    if (!lockedHas(s, 'd_fab_outer')) return 'd_fab_outer should be locked before the console';
    if (!/Security 3/.test(s.objective)) return `objective "${s.objective}"`;
    if (s.active > 0) return 'something is already awake';
    return null;
  });
  if (!fast) { await waitBeat('#pa_hold', 20); await wait(7500); }

  // security: tablet, console, pistol.
  if (!fast) { await tp(-6.6, 0, -14.6, 0); await wait(800); await read('log_sec'); }
  await tp(-8.8, 0, -17, 90); await wait(600);
  console.log('  console:', await use('term_sec_unlock')); await wait(500);
  await st('10-console', (s) => (lockedHas(s, 'd_fab_outer') ? 'console did not release d_fab_outer' : !s.note ? 'console note did not open' : !/sidearm/.test(s.objective) ? `objective "${s.objective}"` : null));
  await closeNote();
  await tp(-8, 0, -19.6, 180); await wait(600);
  console.log('  pistol:', await use('p_pistol')); await wait(800);
  await waitBeat('armed', 6);
  await st('11-armed', (s) => (s.active > 0 ? 'enemy active right after taking the pistol' : null));
  return waitCheckpoint('cp_armed');
}

// B — the vent, the first android, storage, into the airlock.                                → cp_fab
async function segFab() {
  await tp(-6.5, 0, -17, 90, 25);
  await waitBeat('#sec_vent_drop', 20); await wait(2500);
  await st('12-vent', (s) => (s.active > 0 ? 'the vent must stay empty' : null));
  if ((await skitters()) > 0) problems.push('a skitter exists in Security');

  // junction: FIRST ENEMY, the android that stands up.
  await tp(-1.6, 0, -17, -90); await waitBeat('husk_wakes', 15); await wait(6500);
  await st('13-husk-wakes', (s) => (s.active < 1 ? 'junction husk did not wake' : null));
  {
    const woke = await ev(() => window.__woke);
    console.log('  woke so far:', JSON.stringify(woke));
    if (!woke.length || woke[0].type !== 'husk' || woke[0].group !== 'g_junction') problems.push(`first enemy should be the junction husk, got ${JSON.stringify(woke[0])}`);
    const sv = await readSave();
    if (sv && sv.id !== 'cp_armed') problems.push(`a checkpoint (${sv.id}) was written while the first android was up`);
  }
  console.log('  killed', await killAll()); await wait(1500);
  if (!fast) {
    await waitBeat('#pa_husk', 40); await wait(6500); await st('14-after-husk');
    // storage (optional).
    await tp(5, 0, -17, -90); await wait(800); await read('log_storage');
    await waitBeat('#storage_canister', 25); await wait(1500); await st('15-storage', (s) => (s.active > 0 ? 'storage must have no enemies' : null));
  }
  await tp(0, 0, -22, 0);
  const sv = await waitCheckpoint('cp_fab');
  await waitBeat('#airlock_cycle', 15); if (!fast) await wait(2500); await st('16-airlock');
  return sv;
}

// C — the hall, the android at the bench, the breaker is locked out.                         → cp_lockout
async function segLockout() {
  await tp(0, 0, -27.6, 0); await waitBeat('fab_reveal', 10); await wait(fast ? 1500 : 4000); await st('17-fab-reveal', (s) => (s.mood !== 'tension' ? `music mood ${s.mood}` : null));
  if (!fast) {
    await wait(16000); await st('18-fab-choir');
    await tp(2.2, 0, -39.6, 180); await wait(500); await read('log_fab');
  }
  await tp(-1.2, 0, -37.2, 90); await waitBeat('fab_first_fight', 10); await wait(4500);
  await st('19-fab-first', (s) => (s.active < 1 ? 'g_fab_first did not wake' : null));
  console.log('  killed', await killAll()); await wait(1000);
  {
    const n = await skitters(); const sp = await ev(() => window.__spawned.filter((e) => e.type === 'skitter'));
    if (FULL && (n > 0 || sp.length > 0)) problems.push(`skitter before the pump room (${n} alive, ${sp.length} spawned)`);
    else if (n > 0) notes.push(`old level build: ${n} skitter(s) in g_fab_first before the pump room`);
    await killAll();
  }
  await tp(0, 0, -48.5, 0); await wait(500); console.log('  lobby door:', await use('door_d_lobby')); await wait(800);

  // gen: the breaker is locked out.
  await tp(14, 0, -38, -90);
  if (!fast) { await waitBeat('#gen_ripple', 20); await wait(1200); } else await wait(600);
  const before = await st('20-gen', (s) => (feat.pump && !lockedHas(s, 'd_pump') ? 'd_pump unlocked before the tag was read' : null));
  await atLever();
  await wait(800);
  console.log('  lever (no key):', await use('gen_lever')); await wait(700);
  await st('21-lockout', (s) => {
    if (!s.note) return 'lock-out tag note did not open';
    if (!s.beats.includes('lockout_found')) return 'lockout_found not emitted';
    if (s.beats.includes('power_restored')) return 'lever threw without the key';
    if (feat.pump && lockedHas(s, 'd_pump')) return 'd_pump still locked after reading the tag';
    if (lockedHas(before, 'd_lobby') !== lockedHas(s, 'd_lobby')) return 'lobby lock changed';
    return null;
  });
  {
    const sv = await readSave();
    if (sv?.id === 'cp_lockout') problems.push('cp_lockout was written while the tag note was still open');
  }
  await closeNote();
  const sv = await waitCheckpoint('cp_lockout');
  console.log('  lever again (no key):', await use('gen_lever')); await wait(600);
  await st('22-lever-no-key', (s) => (s.beats.includes('power_restored') ? 'lever threw without the key' : !lockedHas(s, 'd_lobby') ? 'd_lobby opened without power' : null));
  await closeNote();
  return sv;
}

// D — pump room: first skitter, Hale, the key, the sump grate pair.                           → cp_key
async function segKey() {
  if (!feat.pump) {
    console.log('  (no pump room in this level build — the story hands the key over after the tag)');
    await wait(4000);
    const k = await ev(() => window.__game.player.keys.size);
    if (!k) problems.push('fallback: key was not granted after the tag');
    await waitBeat('key_taken', 8);
    return waitCheckpoint('cp_key');
  }
  await st('23-objective-key', (s) => (/key/i.test(s.objective) ? null : `objective "${s.objective}"`));
  if (!fast) {
    await waitBeat('#pa_lockout', 25); await wait(7000);
    await tp(6, 0, -38, 90); await wait(1500);
    await tp(-3, 0, -38, 90); await waitBeat('#fab_conveyor_step', 20, { optional: true }); await wait(1500); await st('24-fab-cross');
  }
  await tp(-13.4, 0, -38, 90); await waitBeat('pump_enter', 10);
  if (!fast) { await waitBeat('#pump_knock', 25); await wait(2000); }
  await st('25-pump');
  if ((await ev(() => window.__spawned.filter((e) => e.type === 'skitter').length)) > 0) problems.push('skitter spawned before t_pump_deep');
  await tp(-18.5, 0, -38, 90); await waitBeat('pump_first_skitter', 10); await wait(3500);
  await st('26-pump-skitter', (s) => (s.alive < 1 ? 'g_pump_a did not spawn' : null));
  {
    const sp = await ev(() => window.__spawned.filter((e) => e.type === 'skitter'));
    console.log('  skitters spawned:', JSON.stringify(sp));
    if (!sp.length || sp[0].group !== 'g_pump_a') problems.push('first skitter should be g_pump_a');
  }
  console.log('  killed', await killAll()); await wait(800);
  if (!fast) { await waitBeat('#pump_bubbles', 30); await wait(1500); }
  const keyPos = await ev((id) => { const i = window.__game.interactables.get(id); return i ? [i.position.x, i.position.z] : null; }, feat.key);
  if (keyPos) { await tp(keyPos[0] + 1.0, 0, keyPos[1], 90, -40); await wait(800); }
  if (!fast) await read('log_pump', { optional: true });
  await st('27-hale');
  console.log('  shotgun:', await use('p_shotgun'));
  console.log('  key:', await use(feat.key)); await wait(600);
  await waitBeat('key_taken', 8); await wait(4500);
  await st('28-key-taken', (s) => (s.alive < 1 ? 'g_pump_b did not spawn' : !/breaker/i.test(s.objective) ? `objective "${s.objective}"` : null));
  {
    const sv = await readSave();
    if (sv?.id === 'cp_key') problems.push('cp_key was written while g_pump_b was alive');
  }
  console.log('  killed', await killAll()); await wait(800);
  const sv = await waitCheckpoint('cp_key');
  if (!fast) { await waitBeat('#pa_key', 30); await wait(6000); }
  return sv;
}

// E — back across the hall with the key, to the breaker.                                     → cp_breaker
async function segBreaker() {
  if (feat.pump) {
    await tp(-8, 0, -38, -90); await waitBeat('fab_return', 10); await wait(5500);
    await st('29-fab-return', (s) => (s.active < 1 && feat.groups.includes('g_fab_return') ? 'g_fab_return did not wake/spawn' : null));
    if (!feat.groups.includes('g_fab_return')) notes.push('level has no g_fab_return group yet');
    console.log('  killed', await killAll()); await wait(800);
  } else {
    await tp(0, 0, -38, -90); await waitBeat('fab_return', 10); await wait(3000); await killAll();
  }
  await atLever();
  await wait(1200);
  await st('30-gen-key', (s) => (/breaker/i.test(s.objective) ? null : `objective "${s.objective}"`));
  return waitCheckpoint('cp_breaker');
}

// F — close the breaker; CHOIR; Hale's terminal; the hall ambush.                             → cp_lobby
async function segLobby() {
  await atLever(); await wait(400);
  console.log('  lever (key):', await use('gen_lever')); await wait(2500);
  await st('31-power', (s) => (s.beats.includes('power_restored') ? null : 'power_restored not emitted'));
  await wait(4500);
  console.log('  gen terminal:', await use('log_gen')); await wait(700);
  await st('32-gen-terminal', (s) => (!s.note ? 'log_gen did not open after power' : s.beats.includes('fab_ambush') ? 'ambush did not wait for the terminal' : null));
  await wait(3000); await closeNote();
  await waitBeat('fab_ambush', 30, { noHurry: true });
  await st('33-ambush-start', (s) => (lockedHas(s, 'd_lobby') || lockedHas(s, 'd_elev') ? 'lobby/elevator still locked after power' : null));
  await tp(9, 0, -38, 90); await wait(11000);
  await st('34-fab-ambush', (s) => (s.active >= 4 ? null : `expected rack husks + sentry active, got ${s.active}`));
  {
    const sv = await readSave();
    if (sv?.id === 'cp_lobby') problems.push('cp_lobby was written during the hall ambush');
  }
  console.log('  killed', await killAll());
  return waitCheckpoint('cp_lobby');
}

// G — lobby, elevator, down.
async function segEnd() {
  await tp(0, 0, -51.5, 0); await waitBeat('#lobby_ambush', 10); await wait(5500);
  await st('35-lobby', (s) => (s.active > 0 ? null : 'g_lobby did not wake'));
  console.log('  killed', await killAll());
  if (!fast) await read('note_lobby', { optional: true });
  await tp(0, 0, -60.5, 0); await waitBeat('#elev_gate_rattle', 10); await wait(1500);
  await st('36-elevator', (s) => (/elevator/i.test(s.objective) ? null : `objective "${s.objective}"`));
  console.log('  button:', await use('elev_button')); await wait(6000);
  await st('37-descent', (s) => (s.state === 'cutscene' ? null : 'descent cutscene not running: ' + s.state));
  await page.waitForFunction(() => window.__game.state === 'ended', null, { timeout: 90000 }).catch(() => problems.push('never reached state "ended"'));
  await wait(fast ? 1500 : 6000);
  const s = await st('38-end', (s) => (s.state === 'ended' ? null : 'not ended'));
  const sv = await ev((k) => localStorage.getItem(k), SAVE_KEY);
  if (sv) problems.push('the save was not cleared by the ending');
  return s.state === 'ended';
}

const SEGMENTS = [segArmed, segFab, segLockout, segKey, segBreaker, segLobby];

if (!CHECKPOINTS) {
  for (const seg of SEGMENTS) await seg();
  await segEnd();
  await browser.close();
  if (notes.length) console.log(`\nNOTES:\n - ${[...new Set(notes)].join('\n - ')}`);
  console.log(problems.length ? `\nFAILED:\n - ${problems.join('\n - ')}` : '\nPLAYTHROUGH OK');
  process.exit(problems.length ? 1 : 0);
}

// ───────────────────────────────────────────────────────────────────────── --checkpoints
mkdirSync('shots/cp', { recursive: true });
fast = true;
/** Everything a restored world must reproduce (read right before dying and again after the load). */
const worldState = () => ev(() => {
  const g = window.__game; const p = g.player; const d = g.story.debugState;
  const lights = {};
  for (const grp of ['gen', 'fab', 'lobby', 'elevator', 'corr_a_emergency', 'fab_emergency', 'gen_emergency', 'lobby_emergency']) {
    const hs = g.render.lights.group(grp);
    lights[grp] = hs.length ? `${hs.filter((h) => h.enabled).length}/${hs.length}` : 'none';
  }
  const en = (id) => { const i = g.interactables.get(id); return i ? i.enabled : null; };
  const groups = {};
  for (const e of g.enemies.all) groups[e.group] = (groups[e.group] ?? 0) + 1;
  return {
    state: g.state, pos: [p.position.x, p.position.y, p.position.z].map((v) => +v.toFixed(2)), health: Math.round(p.health), yaw: +p.yaw.toFixed(3),
    weapons: Object.fromEntries(Object.entries(p.weapons).map(([k, w]) => [k, [w.owned, w.clip, w.reserve]])), current: p.currentWeapon,
    keys: [...p.keys].sort(), flashlight: p.flashlightOn,
    pickupsLeft: p.pickups.remaining.map((s) => s.id).sort(),
    locked: g.level.doors.filter((x) => x.locked).map((x) => x.id).sort().join(','),
    lights, interact: { elev_button: en('elev_button'), log_gen: en('log_gen'), gen_lever: en('gen_lever'), p_pistol: en('p_pistol'), p_shotgun: en('p_shotgun') },
    groups, active: g.enemies.activeCount,
    beats: d.beats, flags: d.flags, restoredFrom: d.restoredFrom, triggered: d.triggered, cleared: d.cleared, mood: d.mood,
    objective: g.story.objective, logs: [...g.story.logs].sort(), kills: g.story.stats.kills, time: g.story.stats.time,
    arm: (() => { const o = g.level.object('gen_lockout'); return o ? +o.getWorldPosition(new p.position.constructor()).y.toFixed(2) : null; })(),
  };
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const results = [];

for (const [idx, cp] of CP_IDS.entries()) {
  if (ONLY_CP && cp !== ONLY_CP) continue;
  console.log(`\n══════════ ${cp} ══════════`);
  shotPrefix = `${cp}/`;
  const startProblems = problems.length;
  await ev((k) => localStorage.removeItem(k), SAVE_KEY).catch(() => {});
  await boot();
  await page.keyboard.press('KeyF').catch(() => {});

  // 1 — play up to just after the checkpoint.
  let saved = null;
  for (let i = 0; i <= idx; i++) saved = await SEGMENTS[i]();
  if (!saved || saved.id !== cp) {
    problems.push(`${cp}: the save does not hold this checkpoint (${saved?.id ?? 'none'})`);
    results.push({ cp, restored: false, ended: false });
    continue;
  }
  await wait(300);
  await page.screenshot({ path: `shots/cp/${cp}-0-saved.png` });
  const want = await worldState();
  console.log('  before:', JSON.stringify({ pos: want.pos, health: want.health, weapons: want.weapons, keys: want.keys, locked: want.locked, lights: want.lights, interact: want.interact, groups: want.groups, cleared: want.cleared }));

  // 2 — die (no god mode). The death screen must offer LOAD CHECKPOINT.
  await ev(() => { const g = window.__game; g.debug.god = false; g.player.damage(9999); });
  await page.waitForFunction(() => window.__game.state === 'dead', null, { timeout: 5000 }).catch(() => problems.push(`${cp}: player did not die`));
  await wait(4200);
  const deathButtons = await ev(() => [...document.querySelectorAll('.cb .death .btn')].map((b) => b.textContent));
  console.log('  death screen:', JSON.stringify(deathButtons));
  if (!deathButtons.some((t) => /load checkpoint/i.test(t))) problems.push(`${cp}: death screen has no LOAD CHECKPOINT`);
  if (!deathButtons.some((t) => /restart level/i.test(t))) problems.push(`${cp}: death screen has no RESTART LEVEL`);
  await page.screenshot({ path: `shots/cp/${cp}-1-death.png` });
  {
    const sv = await readSave();
    if (!sv || sv.id !== cp) problems.push(`${cp}: dying changed the save (${sv?.id})`);
  }

  // 3 — LOAD: reload the page and resume from the save.
  await boot('&continue=1');
  await wait(4000);
  await page.screenshot({ path: `shots/cp/${cp}-2-restored.png` });
  const got = await worldState();
  // (dormant machines are created at boot, t = 0: those `enemy:spawned` events are not spawns in play)
  const log = await ev(() => { const L = window.__log; return { ...L, spawned: L.spawned.filter((e) => e.t > 0) }; });
  console.log('  after: ', JSON.stringify({ pos: got.pos, health: got.health, weapons: got.weapons, keys: got.keys, locked: got.locked, lights: got.lights, interact: got.interact, groups: got.groups, objective: got.objective }));
  console.log('  events since load:', JSON.stringify(log));
  const bad = (why) => { problems.push(`${cp}: ${why}`); console.log('  !! ' + why); };
  if (got.state !== 'playing') bad(`state after load is ${got.state}`);
  if (got.restoredFrom !== cp) bad(`story.debugState.restoredFrom = ${got.restoredFrom}`);
  const sp = saved.player.position;
  if (Math.hypot(got.pos[0] - sp[0], got.pos[2] - sp[2]) > 0.6 || Math.abs(got.pos[1] - sp[1]) > 0.4) bad(`player position ${got.pos} ≠ saved ${sp}`);
  { const dy = got.yaw - saved.player.yaw; if (Math.abs(Math.atan2(Math.sin(dy), Math.cos(dy))) > 0.05) bad(`yaw ${got.yaw} ≠ saved ${saved.player.yaw}`); }
  if (got.health !== saved.player.health) bad(`health ${got.health} ≠ saved ${saved.player.health}`);
  if (saved.player.health === 100) bad('test setup: the saved health should not be 100');
  for (const k of ['weapons', 'current', 'keys', 'flashlight', 'pickupsLeft', 'locked', 'lights', 'interact', 'flags', 'objective', 'logs', 'kills', 'arm']) {
    if (!same(got[k], want[k])) bad(`${k} not restored: ${JSON.stringify(got[k])} ≠ ${JSON.stringify(want[k])}`);
  }
  // Story progress: every beat / cue from before is recorded, none of them was replayed.
  const before = saved.story.beats;
  const missing = before.filter((b) => !got.beats.includes(b));
  if (missing.length) bad(`beats lost by the load: ${missing}`);
  const replayed = log.beats.filter((b) => before.includes(b) && b !== 'power_restored');
  if (replayed.length) bad(`beats replayed by the load: ${replayed}`);
  if (log.subs.length) bad(`lines spoken right after the load: ${JSON.stringify(log.subs)}`);
  if (!log.toasts.includes('CHECKPOINT RESTORED')) bad('no CHECKPOINT RESTORED toast');
  if (log.toasts.some((t) => t !== 'CHECKPOINT RESTORED' && !/LOCKED|HOLD|NO POWER/.test(t))) bad(`old toasts replayed: ${JSON.stringify(log.toasts)}`);
  if (log.pickups.length) bad(`pickup events on restore: ${log.pickups}`);
  if (log.woke.length || log.spawned.length) bad(`enemies woke/spawned on load: ${JSON.stringify([log.woke, log.spawned])}`);
  // Fights that were over stay over: the groups are gone for good.
  for (const g of want.cleared) if (got.groups[g]) bad(`group ${g} is back (${got.groups[g]})`);
  if (got.active > 0) bad(`${got.active} enemies active right after the load`);
  if (got.time < want.time - 30 || got.time > want.time + 30) bad(`play time ${got.time} ≠ ${want.time}`);
  // Checkpoint-specific expectations.
  const lk = (id) => got.locked.split(',').includes(id);
  if (idx >= 0 && (lk('d_fab_outer') || !got.weapons.pistol[0] || got.interact.p_pistol !== null)) bad('cp_armed state: hold released + pistol owned + pistol pickup gone expected');
  if (idx >= 1 && got.groups.g_junction) bad('junction husk should be gone');
  if (idx >= 2 && (lk('d_pump') || !got.flags.tagRead || got.groups.g_fab_first)) bad('cp_lockout state: d_pump unlocked, tag read, bench husk gone expected');
  if (idx >= 3 && (!got.keys.length || !got.weapons.shotgun[0] || got.groups.g_pump_a || got.groups.g_pump_b)) bad('cp_key state: key + shotgun, pump groups gone expected');
  if (idx >= 4 && got.groups.g_fab_return) bad('g_fab_return should be gone');
  if (idx <= 4 && (!lk('d_lobby') || !lk('d_elev') || got.interact.elev_button || got.interact.log_gen || got.lights.fab_emergency.startsWith('0/') === false && got.lights.fab_emergency !== 'none')) bad('before power: lobby/elevator locked, button + terminal off, emergency lights off expected');
  if (idx === 5) {
    if (lk('d_lobby') || lk('d_elev')) bad('after power: d_lobby / d_elev must be unlocked');
    if (!got.interact.elev_button || !got.interact.log_gen || got.interact.gen_lever) bad(`after power: interactables ${JSON.stringify(got.interact)}`);
    for (const grp of ['fab_emergency', 'gen_emergency', 'lobby_emergency', 'corr_a_emergency']) if (got.lights[grp] !== 'none' && got.lights[grp].startsWith('0/')) bad(`emergency group ${grp} is off`);
    if (!got.lights.fab.startsWith('0/')) bad(`fab work lights should be off after CHOIR took the hall (${got.lights.fab})`);
    if (got.lights.gen.startsWith('0/') || got.lights.lobby.startsWith('0/') || got.lights.elevator.startsWith('0/')) bad(`gen / lobby / elevator lights should be on (${JSON.stringify(got.lights)})`);
    if (got.groups.g_fab_rack || got.groups.g_fab_sentry) bad('ambush groups should be gone');
    if (got.arm === null || got.arm > 0.3) bad(`the lock-out padlock should lie on the floor (y=${got.arm})`);
  }
  // Nothing from before the checkpoint fires later either; removed groups do not come back when re-triggered.
  await ev((groups) => { const g = window.__game; for (const id of groups) { g.enemies.wakeGroup(id); g.enemies.spawnGroup(id); } }, want.cleared);
  await hurry(); await wait(2500);
  {
    const again = await worldState();
    for (const g of want.cleared) if (again.groups[g]) bad(`group ${g} respawned after wake/spawnGroup`);
    const log2 = await ev(() => { const L = window.__log; return { ...L, spawned: L.spawned.filter((e) => e.t > 0) }; });
    const replayed2 = log2.beats.filter((b) => before.includes(b) && b !== 'power_restored');
    if (replayed2.length) bad(`beats replayed after the load: ${replayed2}`);
    if (log2.woke.length || log2.spawned.length) bad(`enemies woke/spawned after the load: ${JSON.stringify([log2.woke, log2.spawned])}`);
  }
  const restoredOk = problems.length === startProblems;
  console.log(restoredOk ? `  RESTORED OK (${cp})` : `  RESTORE FAILED (${cp})`);

  // 4 — and on to the ending from here: no checkpoint may soft-lock.
  for (let i = idx + 1; i < SEGMENTS.length; i++) await SEGMENTS[i]();
  const ended = await segEnd();
  await page.screenshot({ path: `shots/cp/${cp}-3-end.png` });
  results.push({ cp, restored: restoredOk, ended, ok: problems.length === startProblems });
}

// Storage rules: plain ?autostart=1 ignores the save; a corrupt / wrong-version blob is discarded.
if (!ONLY_CP) {
  console.log('\n══════════ storage rules ══════════');
  const blob = { v: 2, level: 1, rev: 1, facts: {}, id: 'cp_armed', place: 'SECURITY 3', player: { position: [-8, 0, -19.6], yaw: 0, health: 50, weapons: { pistol: { owned: true, clip: 5, reserve: 7 }, shotgun: { owned: false, clip: 0, reserve: 0 } }, current: 'pistol', keys: [], flashlight: false, pickups: ['p_pistol'] },
    story: { beats: ['wake', 'hold_released', 'armed'], read: [], visited: ['med', 'sec'], flags: { holdReleased: true, armed: true }, triggered: [], cleared: [], checkpoints: ['cp_armed'] }, logs: [], stats: { time: 60, kills: 0 }, cleared: [] };
  await ev(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [SAVE_KEY, blob]);
  await boot();
  await wait(1000);
  let r = await ev((k) => ({ from: window.__game.story.debugState.restoredFrom, z: window.__game.player.position.z, kept: !!localStorage.getItem(k) }), SAVE_KEY);
  console.log('  ?autostart=1          →', JSON.stringify(r));
  if (r.from || r.z < 0 || !r.kept) problems.push(`plain ?autostart=1 must ignore (and keep) the save: ${JSON.stringify(r)}`);
  await boot('&continue=1&nostory=1');
  await wait(600);
  r = await ev(() => ({ from: window.__game.story.debugState.restoredFrom, z: window.__game.player.position.z }));
  console.log('  &continue=1&nostory=1 →', JSON.stringify(r));
  if (r.from || r.z < 0) problems.push(`?nostory=1 must ignore the save: ${JSON.stringify(r)}`);
  await boot('&continue=1');
  await wait(1000);
  r = await ev(() => ({ from: window.__game.story.debugState.restoredFrom, z: window.__game.player.position.z, clip: window.__game.player.weapons.pistol.clip }));
  console.log('  &continue=1           →', JSON.stringify(r));
  if (r.from !== 'cp_armed' || r.clip !== 5) problems.push(`a hand-written valid save was not loaded: ${JSON.stringify(r)}`);
  for (const [name, raw] of [['garbage', '{not json'], ['other version', JSON.stringify({ ...blob, v: 99 })], ['wrong shape', JSON.stringify({ v: 2, level: 1, rev: 1, id: 'cp_key' })], ['other level', JSON.stringify({ ...blob, level: 2 })]]) {
    await ev(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, raw]);
    await boot('&continue=1');
    await wait(600);
    r = await ev((k) => ({ from: window.__game.story.debugState.restoredFrom, z: window.__game.player.position.z, kept: !!localStorage.getItem(k), state: window.__game.state }), SAVE_KEY);
    console.log(`  ${name.padEnd(21)} →`, JSON.stringify(r));
    if (r.from || r.kept || r.state !== 'playing' || r.z < 0) problems.push(`${name} save must be discarded and the game start fresh: ${JSON.stringify(r)}`);
  }
  // §8.1: a v1 save (schema before the level chain) is deleted on boot, once; the level starts over.
  await ev(([k, v]) => { localStorage.removeItem(k); localStorage.setItem('coldboot.save.v1', JSON.stringify(v)); }, [SAVE_KEY, { ...blob, v: 1 }]);
  await boot('&continue=1');
  await wait(600);
  r = await ev(() => ({ from: window.__game.story.debugState.restoredFrom, z: window.__game.player.position.z, v1: localStorage.getItem('coldboot.save.v1'), state: window.__game.state }));
  console.log('  v1 save              →', JSON.stringify(r));
  if (r.from || r.v1 !== null || r.state !== 'playing' || r.z < 0) problems.push(`a v1 save must be discarded once and the level start over: ${JSON.stringify(r)}`);
}

await browser.close();
console.log('\nMATRIX:');
for (const r of results) console.log(`  ${r.cp.padEnd(11)} restored ${r.restored ? 'OK  ' : 'FAIL'}  reached ending ${r.ended ? 'YES' : 'NO '}`);
if (notes.length) console.log(`\nNOTES:\n - ${[...new Set(notes)].join('\n - ')}`);
console.log(problems.length ? `\nFAILED:\n - ${problems.join('\n - ')}` : '\nCHECKPOINTS OK');
process.exit(problems.length ? 1 : 0);

// ───────────────────────────────────────────────────────────────────────── --level2 (REVISION 5 / 5.1)
/**
 * In-page test oracle for `--level2 --impatient` (REVISION 5.1): for every spoken line it decides — from WORLD
 * state sampled at the instant the subtitle appears (enemies, player, doors, events it recorded itself), never
 * from the story's own predicates — whether what the line says is true. Runs as an init script.
 */
function installOracle(LINES) {
  const O = window.__O = { lines: [], viol: [], said: [], shots: [], glass: [], died: {}, diedAt: {}, husksDied: 0, husksVanished: 0, foremanDied: false, stirAt: -1e9, workerDiedAt: -1e9, denied: {}, hurtAt: -1e9,
    read: [], rooms: [], beats: [], moveAt: 0, last: null, noOracle: [], spawned: {}, foremanEarly: false, unit32Early: false, minTunnelX: 9, maxTunnelX: -9, softLocks: [], stuckFor: 0, stuckPhase: null };
  const WORKERS = ['g2_dock', 'g2_intake', 'g2_fit_tread'];
  const timer = setInterval(() => {
    const g = window.__game;
    if (!g || !g.events || !g.story || !g.level || !g.player) return;
    clearInterval(timer);
    const t = () => g.time;
    const P = () => g.player.position;
    const grp = (n) => g.enemies.all.filter((e) => e.group === n);
    const alive = (n) => grp(n).filter((e) => e.alive);
    const awake = (n) => alive(n).filter((e) => e.state !== 'dormant');
    const calm = (n) => { const a = alive(n); return a.length > 0 && a.every((e) => e.state === 'dormant'); };
    const room = () => g.level.roomAt(P())?.id ?? null;
    const beat = (id) => O.beats.includes(id);
    const said = (id) => O.said.includes(id);
    const within = (at, s) => t() - at <= s;
    const dist = (x, z) => Math.hypot(P().x - x, P().z - z);
    const angle = (x, y, z) => { const e = g.player.eye, f = g.player.forward; const dx = x - e.x, dy = y - e.y, dz = z - e.z; const l = Math.hypot(dx, dy, dz) || 1; return Math.acos(Math.max(-1, Math.min(1, (dx * f.x + dy * f.y + dz * f.z) / l))) * 180 / Math.PI; };
    const dbg = () => g.story.debugState;
    const locked = (id) => { try { return g.level.door(id).locked; } catch { return null; } };
    const lastShot = () => O.shots[O.shots.length - 1] ?? -1e9;
    const lastGlass = () => O.glass[O.glass.length - 1] ?? -1e9;
    const workerKills = () => WORKERS.reduce((n, w) => n + (O.died[w] ?? 0), 0) + (O.died.g2_unit14 ?? 0);
    const power = () => beat('l2_power');
    const pre = () => !power();
    const inRelay = () => room() === 'relay' && pre();
    const treadCalm = () => room() === 'fitting' && calm('g2_fit_tread');
    const tomas = () => dbg().tomas;                 // actor position (world), null when he is gone
    const escortsAt = () => (dbg().escorts ?? []).filter(Boolean);
    const heldNow = () => { const T = tomas(); const E = escortsAt(); return !!T && E.length >= 1 && E.every((e) => Math.hypot(e[0] - T[0], e[2] - T[2]) < 2.3); };
    const onBeltTomas = () => { const T = tomas(); return !!T && T[1] > 0.3 && T[0] > 4 && T[0] < 6 && T[2] < -44; };
    const WIN = [[-49.5, -47.8], [-44.2, -42.5]];
    const atWindow = () => {
      const T = tomas(); const e = g.player.eye;
      if (!T || e.x > -17 || T[0] < -17) return false;
      const k = (-17 - e.x) / (T[0] - e.x); const z = e.z + (T[2] - e.z) * k;
      return WIN.some(([a, b]) => z > a && z < b && Math.hypot(e.x + 17, e.z - (a + b) / 2) < 4);
    };
    const inTunnel = () => { const p = P(); return p.x > 2.5 && p.x < 7.5 && p.z < -50.35 && p.z > -62; };
    const ghost = () => dbg().ghost;                  // hologram actor position (world) + what it is doing
    const ghostBehind = () => { const G = ghost(); return !!G && G.mode === 'station' && angle(G.at[0], 1.55, G.at[2]) > 95 && dist(G.at[0], G.at[2]) < 26; };
    const u32 = () => alive('g2_unit32').length > 0;
    const u14 = () => alive('g2_unit14');
    // REVISION 6.1 — the core. Units gone = husks that died + husks that vanished alive (the story's stranded-unit
    // last resort; the groups north of the partition are only out of sight). The backstory needs the supervisor
    // dead and nothing hostile awake; the offer lines need the player in the room.
    const gone = () => O.husksDied + O.husksVanished;
    const backstory = () => O.foremanDied && !g.enemies.all.some((e) => e.type === 'foreman' && e.alive) && g.enemies.activeCount === 0 && !beat('l2_choice_shutdown') && !beat('l2_choice_rewrite');
    const inCoreRoom = () => room() === 'core' && !beat('l2_choice_shutdown') && !beat('l2_choice_rewrite');
    // id → is what the line says true right now?
    const OR = {
      l2_choir_arrive: () => !O.rooms.includes('line'),
      l2_choir_dock: () => room() === 'dock' && calm('g2_dock'),
      l2_choir_provoked: () => within(Math.max(O.stirAt, O.workerDiedAt), 14),
      l2_choir_intake: () => room() === 'intake',
      l2_choir_gauge: () => room() === 'intake' || room() === 'line',
      l2_unit_fitting_denied: () => locked('d2_fitting') === true && dist(10, -34) < 3,
      l2_tomas_fitting_wait: () => locked('d2_fitting') === true && beat('l2_intercom'),
      l2_tomas_hello_2: pre, l2_tomas_hello_3: pre,
      l2_tomas_unlock: () => locked('d2_fitting') === false,
      l2_tomas_hello_4: () => said('l2_tomas_hello_3') && pre(),
      l2_tomas_reyes: pre, l2_tomas_oneway: pre, l2_tomas_estop_1: pre, l2_tomas_estop_2: () => pre() && said('l2_tomas_estop_1'),
      l2_tomas_sulking: pre, l2_tomas_ask: pre, l2_tomas_handset: pre, l2_tomas_go: pre,
      l2_tomas_pass: () => !g.player.hasKey('section_pass'),
      l2_tomas_guide_east: () => !g.player.hasKey('section_pass') && !O.rooms.includes('fitting') && locked('d2_fitting') === false,
      l2_tomas_order_1: pre, l2_tomas_order_2: pre, l2_tomas_order_3: () => said('l2_tomas_order_2'), l2_tomas_order_4: () => said('l2_tomas_order_2'), l2_tomas_order_5: () => said('l2_tomas_order_3'),
      l2_tomas_stealth_1: treadCalm, l2_tomas_stealth_2: treadCalm, l2_tomas_treadmills: treadCalm, l2_tomas_sync: treadCalm,
      l2_tomas_unit14: () => ghost()?.mode === 'rig' && room() === 'fitting',
      l2_tomas_unit14_off: () => !ghost() && O.rooms.includes('fitting'),
      l2_tomas_rig_1: () => dbg().rigPattern && !O.read.includes('tag2_rig') && room() === 'fitting',
      l2_tomas_rig_2: () => O.read.includes('tag2_rig'), l2_tomas_rig_3: () => said('l2_tomas_rig_2'), l2_tomas_rig_4: () => said('l2_tomas_rig_2') && !g.player.hasKey('section_pass'),
      l2_tomas_pass_taken: () => alive('g2_fit_wake').some((e) => e.state === 'dormant'),
      l2_tomas_pass_taken_quiet: () => alive('g2_fit_wake').length === 0 && g.player.hasKey('section_pass'),
      l2_tomas_fit_fight: () => awake('g2_fit_wake').some((e) => dist(e.position.x, e.position.z) <= 10.5 && (angle(e.position.x, e.position.y + 1.4, e.position.z) > 55 || !g.physics.lineOfSight(g.player.eye, e.position.clone().setY(e.position.y + 1.4)))),
      l2_tomas_fit_fight_front: () => awake('g2_fit_wake').length > 0,
      l2_tomas_fit_after_1: () => within(lastShot(), 6.6) && (O.died.g2_fit_wake ?? 0) > 0,
      l2_tomas_fit_after_quiet: () => (O.died.g2_fit_wake ?? 0) > 0 || alive('g2_fit_wake').length === 0,
      l2_tomas_fit_after_2: () => said('l2_tomas_hello_3') && g.enemies.activeCount === 0,
      l2_tomas_cross_1: () => g.player.hasKey('section_pass') && !O.rooms.includes('relay') && pre(),
      l2_tomas_cross_wave: () => dbg().tomasPose === 'wave' && room() === 'line' && P().z > -50.35 && angle(-9.7, 1.5, -46) < 50,
      l2_tomas_coffee_1: pre, l2_tomas_mum: pre,
      l2_tomas_hall_fight: () => awake('g2_hall_mid').length > 0,
      l2_tomas_hall_after: () => alive('g2_hall_mid').length === 0 && (O.died.g2_hall_mid ?? 0) > 0 && pre(),
      l2_tomas_relay_1: inRelay, l2_tomas_relay_2: inRelay, l2_tomas_relay_cam: inRelay, l2_tomas_relay_breaker: pre, l2_tomas_relay_wait_1: inRelay,
      l2_tomas_relay_wait_2: () => O.read.includes('note2_relay') && pre(),
      l2_choir_power_2: power,
      l2_tomas_power_1: () => power() && !beat('l2_trap'), l2_tomas_power_2: () => said('l2_tomas_power_1') && !beat('l2_trap'), l2_tomas_power_3: () => power() && !beat('l2_trap') && locked('d2_booth') === true,
      l2_tomas_run_1: () => power() && !beat('l2_trap') && !!tomas() && Math.hypot(tomas()[0] + 16.3, tomas()[2] + 46) < 1.2,
      l2_tomas_run_3: () => power() && !beat('l2_trap'), l2_tomas_run_wait: () => power() && !beat('l2_trap') && said('l2_tomas_run_3'),
      l2_tomas_run_4: () => beat('l2_trap') && !heldNow() && !beat('l2_booth_open'),
      l2_tomas_window_1: () => beat('l2_trap') && atWindow(),
      l2_tomas_window_1_far: () => beat('l2_trap') && !atWindow(),
      l2_tomas_window_3: () => !O.glass.some((x) => x >= (O.trapAt ?? 1e9)),
      l2_tomas_shot_glass: () => within(lastGlass(), 3.6),
      l2_tomas_window_2: heldNow, l2_unit_take_1: heldNow, l2_unit_take_2: heldNow, l2_tomas_window_5: heldNow,
      l2_tomas_window_4: () => heldNow() && said('l2_tomas_mum'), l2_tomas_window_4_plain: () => heldNow() && !said('l2_tomas_mum'),
      l2_tomas_window_6: () => onBeltTomas() && said('l2_tomas_coffee_1'), l2_tomas_window_6_plain: () => onBeltTomas() && !said('l2_tomas_coffee_1'),
      l2_choir_window: () => locked('d2_booth_hall') === true && !beat('l2_loaded') && beat('l2_window'),
      l2_choir_glass: () => within(lastGlass(), 6.6),
      l2_choir_tunnel: inTunnel,
      l2_choir_nudge: () => beat('l2_escort') && alive('g2_escort').length === 0 && !inTunnel() && !beat('l2_tunnel'),
      l2_choir_apron: () => beat('l2_apron') && grp('g2_unit32').length === 0 && !(O.died.g2_unit32 > 0),
      l2_unit32_1: () => u32() && said('l2_tomas_hello_3'), l2_unit32_plain: () => u32() && !said('l2_tomas_hello_3'),
      l2_unit32_2: () => u32() && said('l2_tomas_hello_4'), l2_unit32_3: () => u32() && said('l2_tomas_run_3'), l2_unit32_4: () => u32() && said('l2_tomas_go'), l2_unit32_5: () => u32() && said('l2_tomas_cross_wave'),
      l2_unit32_die: () => said('l2_tomas_coffee_1'), l2_unit32_die_plain: () => !said('l2_tomas_coffee_1'),
      l2_choir_unit32_1: () => (O.died.g2_unit32 ?? 0) > 0 && !beat('l2_foreman'), l2_choir_unit32_2: () => (O.died.g2_unit32 ?? 0) > 0 && !beat('l2_foreman'),
      l2_unit14_door: () => u14().some((e) => e.state === 'dormant' && dist(e.position.x, e.position.z) < 6.5),
      l2_choir_unit14_shot: () => within(O.u14HitAt ?? -1e9, 13),
      l2_choir_core_2: backstory, l2_choir_core_3: backstory, l2_choir_core_4: backstory, l2_choir_core_6: backstory, l2_choir_core_8: backstory,
      l2_choir_core_7: () => backstory() && gone() < 4, l2_choir_core_7_killed: () => backstory() && gone() >= 4,
      l2_choir_core_1: inCoreRoom, l2_choir_offer: inCoreRoom, l2_choir_offer_stop: inCoreRoom, l2_choir_offer_command: inCoreRoom, l2_choir_core_14: inCoreRoom,
      l2_choir_core_idle_1: () => !beat('l2_choice_shutdown') && !beat('l2_choice_rewrite') && g.interactables.get('core_shutdown')?.enabled === true,
      l2_choir_core_idle_2: () => beat('l2_intercom') && !beat('l2_choice_shutdown') && !beat('l2_choice_rewrite'),
      l2_choir_shutdown_1: () => beat('l2_choice_shutdown'), l2_choir_shutdown_2: () => beat('l2_choice_shutdown'), l2_choir_shutdown_3: () => beat('l2_choice_shutdown'),
      l2_choir_rewrite_1: () => beat('l2_choice_rewrite'), l2_choir_rewrite_2: () => beat('l2_choice_rewrite'), l2_choir_rewrite_3: () => beat('l2_choice_rewrite'),
      l2_unit14_wait: () => u14().length > 0, l2_unit_wait: () => u14().length === 0,
      l2_tomas_bark_stop_1: () => t() - O.moveAt > 18, l2_tomas_bark_stop_2: () => t() - O.moveAt > 18,
      l2_tomas_bark_shots_1: () => within(lastShot(), 6.6), l2_tomas_bark_shots_2: () => within(lastShot(), 6.6),
      l2_tomas_bark_killed_worker: () => within(O.workerDiedAt, 11),
      l2_tomas_bark_quiet_1: pre, l2_tomas_bark_quiet_2: pre, l2_tomas_bark_quiet_3: pre,
      l2_tomas_bark_back: () => room() === 'intake' || room() === 'dock',
      l2_tomas_bark_left: () => room() === 'line' && !g.player.hasKey('section_pass') && !O.rooms.includes('fitting'),
      l2_tomas_bark_relay_locked: () => !g.player.hasKey('section_pass') && said('l2_tomas_pass') && within(O.denied.d2_relay ?? -1e9, 6),
      l2_tomas_relay_needs_pass: () => !g.player.hasKey('section_pass') && within(O.denied.d2_relay ?? -1e9, 6),
      l2_tomas_bark_spine_dead: () => pre() && said('l2_tomas_bark_dead_first'),
      l2_tomas_bark_dead_first: () => pre() && ['d2_spine', 'd2_bulkhead_s', 'd2_bulkhead_n', 'd2_booth'].some((d) => within(O.denied[d] ?? -1e9, 6)),
      l2_tomas_bark_core_door: () => room() === 'line' && P().z < -65.5 && pre(),
      l2_tomas_bark_glass_1: () => dist(-10, -46) < 6.5 && !!tomas(), l2_tomas_bark_glass_2: () => dist(-10, -46) < 6.5 && !!tomas(),
      l2_tomas_bark_hurt: () => within(O.hurtAt, 4.6), l2_tomas_bark_lowhp: () => g.player.health < 35,
      l2_tomas_bark_provoked: () => WORKERS.some((w) => awake(w).length > 0),
      l2_tomas_bark_light: () => g.player.flashlightOn,
      l2_tomas_bark_read: () => !!g.ui.noteOpen,
      l2_tomas_bark_unit14: () => ghostBehind() && said('l2_tomas_bark_unit14_first'), l2_tomas_bark_unit14_first: ghostBehind,
      l2_tomas_shot_at: () => within(lastGlass(), 3.6) && !!tomas() && !beat('l2_trap'),
    };
    // Every radio line of Tomas also needs: the handset was taken, and he is not through the mouth.
    const onAir = () => beat('l2_intercom') && !beat('l2_loaded');
    g.events.on('story:beat', (e) => { O.beats.push(e.id); if (e.id === 'l2_trap') O.trapAt = t(); });
    g.events.on('weapon:fired', () => O.shots.push(t()));
    g.events.on('bullet:impact', (e) => {
      if (e.surface !== 'glass') return;
      const p = e.point;
      if ((Math.abs(p.x + 10) < 0.5 && p.z > -50.3 && p.z < -41.7) || (Math.abs(p.x + 17) < 0.55 && p.z > -50 && p.z < -42)) O.glass.push(t());
    });
    const deadIds = new Set(), husks = new Map(), NORTH_G = ['g2_dock', 'g2_intake', 'g2_fit_tread', 'g2_fit_wake'];
    g.events.on('enemy:died', (e) => { O.died[e.group] = (O.died[e.group] ?? 0) + 1; O.diedAt[e.group] = t(); deadIds.add(e.id); if (e.type === 'husk') O.husksDied++; if (e.type === 'foreman') O.foremanDied = true; if (WORKERS.includes(e.group) || e.group === 'g2_unit14') O.workerDiedAt = t(); });
    const stir = (e) => { const x = g.enemies.all.find((q) => q.id === e.id); if (x && WORKERS.includes(x.group)) O.stirAt = t(); if (x && x.group === 'g2_unit14') O.u14HitAt = t(); };
    g.events.on('enemy:woke', stir); g.events.on('enemy:alerted', stir); g.events.on('enemy:damaged', stir);
    g.events.on('door:denied', (e) => { O.denied[e.id] = t(); });
    g.events.on('player:damaged', () => { O.hurtAt = t(); });
    g.events.on('story:log', (e) => { if (!O.read.includes(e.id)) O.read.push(e.id); });
    g.events.on('story:subtitle', (e) => {
      const log = g.story.lineLog ?? [];
      let id = null;
      for (let i = log.length - 1; i >= Math.max(0, log.length - 4); i--) if (log[i].said && LINES[log[i].said] === e.text) { id = log[i].said; break; }
      if (!id) return; // not a story line (units' own mutter, the supervisor's heads)
      const speaker = LINES['@' + id];
      let ok = true, why = '';
      try {
        if (speaker === 'tomas' && !onAir()) { ok = false; why = 'Tomas on the radio without the handset / after the mouth'; }
        else if (OR[id]) { ok = !!OR[id](); if (!ok) why = 'oracle false'; }
        else if (!O.noOracle.includes(id)) O.noOracle.push(id);
      } catch (err) { ok = false; why = 'oracle threw: ' + err.message; }
      const rec = { id, t: +t().toFixed(1), ok, room: room(), pos: [P().x, P().z].map((v) => +v.toFixed(1)) };
      O.lines.push(rec);
      O.said.push(id);
      if (!ok) O.viol.push({ ...rec, why, text: e.text });
    });
    setInterval(() => {
      if (!g.ready || g.state !== 'playing') return;
      const r = room();
      if (r && !O.rooms.includes(r)) O.rooms.push(r);
      const p = P();
      if (!O.last || Math.hypot(p.x - O.last[0], p.z - O.last[1]) > 1.1) { O.last = [p.x, p.z]; O.moveAt = t(); }
      // husks that vanish alive (no death): the story's last resort for a stranded unit — gone from the line
      { const now = new Set();
        for (const e of g.enemies.all) if (e.type === 'husk' && e.alive) { now.add(e.id); if (!NORTH_G.includes(e.group)) husks.set(e.id, e.group); }
        for (const id of [...husks.keys()]) if (!now.has(id)) { husks.delete(id); if (!deadIds.has(id)) O.husksVanished++; } }
      // R4: nothing of a later beat exists early.
      if (!beat('l2_foreman') && g.enemies.all.some((e) => e.group === 'g2_foreman')) O.foremanEarly = true;
      if (!beat('l2_apron') && g.enemies.all.some((e) => e.group === 'g2_unit32')) O.unit32Early = true;
      if (inTunnel() && p.z < -51 && p.z > -61.5) { O.minTunnelX = Math.min(O.minTunnelX, p.x); O.maxTunnelX = Math.max(O.maxTunnelX, p.x); }
      // SOFT-LOCK oracle (generic): the current phase's goal door is locked, the player stands at it, nothing hostile
      // is hunting them — and that stays so for SOFT_N s. Whatever the gate waits on (an enemy asleep or stranded, a
      // line that never comes) the player cannot make happen: the game is stuck. Reported once per phase.
      {
        const SOFT_N = 15, GOAL = { D: 'd2_relay', G: 'd2_mouth', G2: 'd2_mouth', H: 'd2_core' };
        const ph = dbg()?.phase, id = GOAL[ph];
        const d = id ? g.level.door(id) : null;
        const stuck = !!d && d.locked && g.enemies.activeCount === 0 && Math.hypot(p.x - d.position.x, p.z - d.position.z) < 5.5 && !g.ui.noteOpen;
        if (ph !== O.stuckPhase) { O.stuckPhase = ph; O.stuckFor = 0; }
        if (!stuck) { if (O.stuckFor > 0) O.stuckFor = 0; }
        else if (O.stuckFor >= 0 && (O.stuckFor += 0.1) > SOFT_N) {
          O.stuckFor = -1e9;
          O.softLocks.push({ phase: ph, door: id, t: +t().toFixed(1), pos: [p.x, p.z].map((v) => +v.toFixed(1)), alive: g.enemies.all.filter((e) => e.alive).map((e) => `${e.group}:${e.state}`), speaking: dbg()?.speaking ?? null });
        }
      }
    }, 100);
  }, 20);
}

async function runLevel2() {
  mkdirSync('shots/l2', { recursive: true });
  const IMPATIENT = argv.includes('--impatient');
  const ENDINGS = argv.find((a) => a.startsWith('--ending='))?.slice(9).split(',') ?? ['shutdown', 'rewrite'];
  const CP2 = ['cp2_start', 'cp2_hall', 'cp2_talk', 'cp2_pass', 'cp2_relay', 'cp2_taken', 'cp2_escort', 'cp2_foreman', 'cp2_core'];
  const ORDER = ['l2_arrive', 'l2_dock', 'l2_intake', 'l2_hall_reveal', 'l2_tomas_seen', 'l2_intercom', 'l2_guided', 'l2_rig', 'l2_pass',
    'l2_fit_fight', 'l2_hall_cross', 'l2_relay_enter', 'l2_power', 'l2_trap', 'l2_window', 'l2_booth_open', 'l2_loaded', 'l2_escort', 'l2_tunnel',
    'l2_apron', 'l2_unit32', 'l2_foreman', 'l2_core'];
  const NORTH = ['g2_dock', 'g2_intake', 'g2_fit_tread', 'g2_fit_wake'];
  const dbg = () => ev(() => window.__game.story.debugState);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const fastTalk = () => ev(() => window.__game.story.hurry?.(true));
  const shot = (name) => page.screenshot({ path: `shots/l2/${name}.png` });
  const bad = (why) => { problems.push(why); console.log('  !! ' + why); };
  const info = async (name, expect) => {
    const s = await status();
    const { beats, ...short } = s;
    console.log(`[${name}]`, JSON.stringify(short));
    if (expect) { const why = expect(s); if (why) bad(`${name}: ${why}`); }
    return s;
  };
  const posOf = (id) => ev((id) => { const i = window.__game.interactables.get(id); return i ? [i.position.x, i.position.y, i.position.z] : null; }, id);
  /** Stand ~1.2 m from an interactable, on the side toward `toward` [x, z], facing it. */
  const goTo = async (id, toward) => {
    const p = await posOf(id);
    if (!p) return false;
    const dx = toward[0] - p[0], dz = toward[1] - p[2]; const l = Math.hypot(dx, dz) || 1;
    const x = p[0] + dx / l * 1.2, z = p[2] + dz / l * 1.2;
    await tp(x, 0, z, Math.atan2(-(p[0] - x), -(p[2] - z)) * 180 / Math.PI);
    await wait(400);
    return true;
  };
  const readIf = async (id, toward) => { if (await goTo(id, toward)) await read(id, { optional: true }); else { notes.push(`interactable ${id} missing`); console.log(`  ${id}: missing`); } };
  const waitFlag = async (fn, label, seconds = 30, arg) => {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) { if (await ev(fn, arg)) return true; await hurry(); await wait(200); }
    bad(`${label} did not happen (${seconds}s)`);
    return false;
  };
  const feat2 = async () => ev(() => {
    const g = window.__game;
    return {
      level: g.levelId, rooms: g.level.rooms.map((r) => r.id).join(','), doors: g.level.doors.map((d) => d.id).join(','),
      groups: [...new Set(g.level.enemySpawns.map((s) => `${s.group}:${s.mode}`))].join(','),
      say: typeof g.audio.say === 'function', actor: typeof g.enemies.actor === 'function', carry: typeof g.player.setCarry === 'function',
      regions: Object.keys(g.level.regions ?? {}).join(','), lineLog: Array.isArray(g.story.lineLog),
      ints: g.interactables.all.map((i) => i.id).join(','),
    };
  });
  // Every stored run key of every schema (saves of all levels, carry, level pointer, v1 keys) and the one-shot
  // session flags (continue / begin / skip-intro); settings and `coldboot.seen.v1` stay.
  const clearL2 = () => ev(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('coldboot.') && k !== 'coldboot.settings' && k !== 'coldboot.seen.v1') localStorage.removeItem(k);
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('coldboot.')) sessionStorage.removeItem(k);
  });
  const doorIs = (id) => ev((id) => { try { const d = window.__game.level.door(id); return { locked: d.locked, open: d.isOpen, closed: d.closed }; } catch { return null; } }, id);
  const groupsNow = () => ev(() => { const o = {}; for (const e of window.__game.enemies.all) o[e.group] = (o[e.group] ?? 0) + (e.alive ? 1 : 0); return o; });
  const pPos = () => ev(() => { const p = window.__game.player.position; return [p.x, p.y, p.z]; });
  const marks = async () => (await dbg()).t;
  /** Screenshot sequence from where the player stands (look at these with an image viewer). */
  const frames = async (name, n, interval) => { for (let i = 0; i < n; i++) { await shot(`${name}-${String(i).padStart(2, '0')}`); await wait(interval); } };
  const noForemanYet = async (where) => { const g = await groupsNow(); if ('g2_foreman' in g) bad(`${where}: the supervisor's group exists before l2_foreman (R4)`); };
  const u32State = () => ev(() => { const g = window.__game; const e = g.enemies.all.find((x) => x.group === 'g2_unit32' && x.alive); const p = g.player.position;
    return e ? { state: e.state, pos: [e.position.x, e.position.y, e.position.z].map((v) => +v.toFixed(2)), dist: +Math.hypot(e.position.x - p.x, e.position.z - p.z).toFixed(2), t: g.time } : { state: null, t: g.time }; });
  const HUNTING = ['alert', 'chase', 'attack', 'stagger'];
  /**
   * The ride WALKED (the user's bug, REVISION 5.1): through the tunnel on foot with real movement input — no
   * teleport past the boarding point, never waiting to be carried — along one side of the belt (strafing into that
   * guard), walking or sprinting, jumping now and then; then straight off the apron, down its steps and away to
   * the south-west without stopping. Asserts Unit 32 is hunting within a few seconds of the player leaving the
   * tunnel and reaches / attacks them, wherever they went. Returns { out, hunting, attacked } (game times).
   */
  const walkBelt = async ({ side, sprint, jump, label }) => {
    const mv = (f, s = 0, sp = false) => ev(([f, s, sp]) => window.__game.player.debug.move(f, s, sp), [f, s, sp]);
    const face = (yawDeg) => ev((y) => { window.__game.player.yaw = y * Math.PI / 180; window.__game.player.pitch = 0; }, yawDeg);
    const by = await ev(() => { const g = window.__game; const V = g.player.position.constructor; const h = g.physics.raycast(new V(5, 2.2, -45.6), new V(0, -1, 0), 3); return h ? h.point.y : 0.55; });
    const x0 = side === 'west' ? 4.3 : 5.7, strafe = side === 'west' ? -0.45 : 0.45;
    await tp(x0, by + 0.05, -45.6, 0); await wait(250);
    const t0 = await ev(() => window.__game.time);
    let out = null, xs = [9, -9], i = 0;
    for (const end = Date.now() + 30000; Date.now() < end; i++) {
      await mv(1, strafe, sprint);
      if (jump && i % 7 === 3) await ev(() => window.__game.player.debug.jump());
      const p = await pPos();
      if (p[2] < -51 && p[2] > -61.5) { xs[0] = Math.min(xs[0], p[0]); xs[1] = Math.max(xs[1], p[0]); }
      if (p[2] < -62.4) { out = await ev(() => window.__game.time); break; }
      await wait(120);
    }
    if (out === null) { await mv(0); bad(`${label}: walking the belt did not get the player out of the tunnel`); return { out: null }; }
    console.log(`  ${label}: walked the belt (${side}, ${sprint ? 'sprint' : 'walk'}${jump ? ', jumping' : ''}) out of the tunnel in ${(out - t0).toFixed(1)} s; x in the tunnel ${xs.map((v) => v.toFixed(2))}`);
    if (side === 'west' && xs[0] > 4.6) notes.push(`${label}: the walk did not hug the west guard (min x ${xs[0].toFixed(2)})`);
    if (side === 'east' && xs[1] < 5.4) notes.push(`${label}: the walk did not hug the east guard (max x ${xs[1].toFixed(2)})`);
    // Keep going: to the south end of the apron, west down its steps, away across the hall. No waiting.
    let hunting = null, attacked = null, last = null;
    const watch = async () => {
      const u = await u32State(); last = u;
      if (hunting === null && u.state && HUNTING.includes(u.state)) hunting = u.t;
      if (attacked === null) { const a = await ev(() => (window.__log.attacks ?? []).find((x) => x.group === 'g2_unit32')?.t ?? null); if (a !== null) attacked = a; else if (u.state && u.dist < 1.9) attacked = u.t; }
    };
    for (const end = Date.now() + 6000; Date.now() < end; ) { await mv(1, 0, sprint); const p = await pPos(); await watch(); if (p[2] < -65.0) break; await wait(100); }
    await face(90);
    for (const end = Date.now() + 9000; Date.now() < end; ) { await mv(1, 0, sprint); const p = await pPos(); await watch(); if (p[0] < 0.3) break; await wait(100); }
    await face(0);
    for (const end = Date.now() + 5000; Date.now() < end; ) { await mv(1, 0, sprint); const p = await pPos(); await watch(); if (p[2] < -67.6) break; await wait(100); }
    await mv(0);
    // Stand at the core door (as a player waiting for it to open would). It must come for them.
    for (const end = Date.now() + 25000; Date.now() < end && (hunting === null || attacked === null); ) { await watch(); await wait(200); }
    console.log(`  ${label}: Unit 32 hunting ${hunting === null ? 'NEVER' : `${(hunting - out).toFixed(1)} s`} after leaving the tunnel, attacking ${attacked === null ? 'NEVER' : `${(attacked - out).toFixed(1)} s`} (${JSON.stringify(last)})`);
    if (hunting === null || hunting - out > 6) bad(`${label}: Unit 32 was not awake and hunting within 6 s of the player walking out of the tunnel (${JSON.stringify(last)})`);
    if (attacked === null) bad(`${label}: Unit 32 never came for the player who walked away from the apron (${JSON.stringify(last)})`);
    return { out, hunting, attacked };
  };
  /**
   * After everything alive is dead: the goal door opens on its own, without the player shooting at anything
   * else (the user's soft-lock: only a shot at the door woke the unit that gated it).
   */
  const coreOpensUnaided = async (label, seconds = 12) => {
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) { if (!(await doorIs('d2_core'))?.locked) { console.log(`  ${label}: d2_core unlocked ${((Date.now() - t0) / 1000).toFixed(1)} s after the last kill`); return true; } await wait(200); }
    const s = await ev(() => { const g = window.__game; const d = g.story.debugState; return { phase: d.phase, alive: g.enemies.all.filter((e) => e.alive).map((e) => `${e.group}:${e.state}`), speaking: d.speaking }; });
    bad(`${label}: SOFT-LOCK — d2_core still locked ${seconds} s after everything was killed (${JSON.stringify(s)})`);
    return false;
  };

  // ── segments (each ends just after one checkpoint) ──
  async function s2Start() {
    await fastTalk(); await wait(800);
    await info('01-cab', (s) => (!s.beats.includes('l2_arrive') ? 'l2_arrive missing' : lockedHas(s, 'd2_cab') ? 'd2_cab still locked after arrival'
      : !['d2_core', 'd2_relay', 'd2_lift', 'd2_fitting', 'd2_mouth'].every((d) => lockedHas(s, d)) ? `core / relay / lift / fitting / mouth should start locked (${s.locked})` : null));
    const w = await ev(() => Object.entries(window.__game.player.weapons).map(([k, w]) => [k, w.owned]));
    if (!w.some((x) => x[1])) bad('no weapon at the start of level 2');
    await noForemanYet('start');
    await tp(2.8, 0, -3, 0); await waitBeat('l2_dock', 10);
    await ev(() => { window.__game.debug.god = false; window.__game.player.damage(23); window.__game.debug.god = true; });
    await info('02-dock', (s) => (s.active > 0 ? 'something is hostile in the dock' : null));
    return waitCheckpoint('cp2_start');
  }
  async function s2Hall() {
    await tp(0, 0, -12, 0); await waitBeat('l2_intake', 10);
    if (!fast) { await readIf('note2_dock', [3, -3]); await tp(0, 0, -12, 0); await readIf('note2_intake', [0, -14]); await readIf('term2_intake', [0, -18]); }
    await tp(0, 0, -20.5, 0); await waitBeat('#intake_gauge', 10); await wait(600);
    await info('03-intake', (s) => (s.active > 0 ? 'the folding units turned hostile' : null));
    await tp(0, 0, -24.5, 0); await waitBeat('l2_hall_reveal', 10);
    await info('04-hall');
    return waitCheckpoint('cp2_hall');
  }
  async function s2Talk() {
    // R1: without the talk there is no fitting bay. The door is dark and says so.
    await tp(8.9, 0, -34, -90); await wait(900);
    { const d = await doorIs('d2_fitting'); const t = await ev(() => window.__log.toasts.slice(-3)); if (!d?.locked) bad('d2_fitting is not locked before the intercom talk'); if (!t.some((x) => /FITTING BAYS/.test(x))) notes.push(`no "fitting bays closed" toast at the dark door (${t})`); }
    await tp(-7, 0, -46, 90); await waitBeat('l2_tomas_seen', 20); await waitBeat('#booth_write_2', 25);
    if (!fast) await shot('05-tomas');
    { const d = await dbg(); if (!d.tomas) notes.push('no Tomas actor (enemies.actor("human") unavailable)'); }
    await info('05-seen', (s) => (/intercom/i.test(s.objective) ? null : `objective "${s.objective}"`));
    console.log('  intercom:', await use('intercom_hall'));
    await waitBeat('l2_intercom', 12);
    { const t = await ev(() => window.__log.toasts); if (!t.some((x) => /HANDSET/.test(x))) bad('pressing the intercom did not take the handset (no toast)'); }
    await waitBeat('#fit_open', 30); await waitBeat('l2_guided', 10);
    { const d = await doorIs('d2_fitting'); if (d?.locked) bad('d2_fitting still locked after his first three lines'); }
    { const subs = await ev(() => window.__log.subs); if (!subs.some((t) => /canteen coffee/.test(t))) bad('the coffee joke was not in the first three lines'); }
    await info('06-intercom', (s) => (/pass/i.test(s.objective) ? null : `objective "${s.objective}"`));
    return waitCheckpoint('cp2_talk');
  }
  async function s2Pass() {
    await waitBeat('#first_talk_over', 90);
    await tp(11.6, 0, -34, -90); await waitBeat('#fit_stealth', 15); await wait(800);
    await info('07-fitting', (s) => (s.active > 0 ? 'treadmill units turned hostile on entry' : null));
    if (!fast) { await wait(2500); await shot('07-ghost'); const d = await dbg(); console.log('  ghost:', JSON.stringify(d.ghost), 'intro flag:', d.flags.ghostIntro); if (!d.flags.ghostIntro) bad('the projection was not introduced on entering the fitting bays'); await readIf('note2_rig14', [14, -34]); }
    if (await goTo('tag2_rig', [14, -34])) { await waitBeat('l2_rig', 10); if (!(await dbg()).rigPattern) notes.push('no holo_tech reference pattern on the rig'); if (!fast) await shot('07-rig'); await read('tag2_rig'); await waitBeat('#rig_read', 10); }
    else { notes.push('tag2_rig missing'); await tp(17.5, 0, -36.5, 0); await waitBeat('l2_rig', 10, { optional: true }); }
    const passId = await ev(() => window.__game.level.pickupSpawns.find((p) => p.kind === 'keycard')?.id ?? null);
    if (passId && await goTo(passId, [14, -34])) console.log('  pass:', await use(passId));
    else { notes.push('section pass pickup missing — key granted by the test'); await ev(() => window.__game.player.addKey('section_pass')); }
    await waitBeat('l2_pass', 10); await waitBeat('l2_fit_fight', 10); await wait(2500);
    await info('08-fit-fight', (s) => (lockedHas(s, 'd2_relay') ? 'd2_relay still locked with the pass' : null));
    console.log('  killed', await killAll()); await wait(600); await killAll();
    await waitBeat('#fit_over', 20);
    return waitCheckpoint('cp2_pass');
  }
  async function s2Relay() {
    await tp(-4, 0, -40, 0); await waitBeat('l2_hall_cross', 10);
    await tp(-4, 0, -56, 0); await waitBeat('#hall_mid', 10); await wait(2500);
    console.log('  killed', await killAll()); await wait(800); await killAll();
    await tp(13, 0, -61, -90); await waitBeat('l2_relay_enter', 10);
    await info('09-relay', (s) => (/Section C/i.test(s.objective) ? null : `objective "${s.objective}"`));
    const sv = await waitCheckpoint('cp2_relay', 30);
    if (!fast) await readIf('note2_relay', [13, -61]);
    return sv;
  }
  /** The switch → the trap → the window → the loading, as seen from the spine and the booth. Ends at cp2_taken. */
  async function s2Taken() {
    if (!(await goTo('relay_switch', [13, -61]))) notes.push('relay_switch missing');
    const before = await status();
    if (!lockedHas(before, 'd2_spine') || !lockedHas(before, 'd2_booth')) bad(`spine / booth doors should be locked before Section C (${before.locked})`);
    await noForemanYet('before the switch');
    console.log('  switch:', await use('relay_switch'));
    await waitBeat('l2_power', 8); await waitBeat('#line_running', 5); await wait(500);
    await info('10-power', (s) => (!lockedHas(s, 'd2_relay') ? 'd2_relay must hold (ARC INTERLOCK) until the relay fight is over' : !lockedHas(s, 'd2_gate') ? 'd2_gate must lock when the line runs'
      : !lockedHas(s, 'd2_booth') || !lockedHas(s, 'd2_booth_hall') ? 'the booth doors must stay shut (CYCLING)' : /interlock|relay/i.test(s.objective) ? null : `objective "${s.objective}"`));
    { const g = await groupsNow(); const left = NORTH.filter((n) => n in g); if (left.length) bad(`groups north of the partition still exist after l2_power: ${left}`); }
    await wait(4200); console.log('  killed', await killAll()); await wait(900); await killAll();
    await waitBeat('#relay_clear', 60); await wait(500);
    await info('10-relay-clear', (s) => (lockedHas(s, 'd2_relay') ? 'd2_relay did not release after the fight' : lockedHas(s, 'd2_spine') || lockedHas(s, 'd2_bulkhead_s') ? 'spine not open after Section C' : /spine/i.test(s.objective) ? null : `objective "${s.objective}"`));
    if (!fast) await shot('10-line-running');
    await waitFlag(() => window.__game.story.debugState.tomasSpot === 'door', 'Tomas going to his own door', 12);
    // Nothing proceeds without the player: south of the bulkhead no scene starts.
    await tp(-19, 0, -58, 0); await wait(1500);
    { const d = await dbg(); if (d.beats.includes('l2_trap')) bad('the trap latched with the player south of the bulkhead'); }
    await tp(-19, 0, -53, 0); await waitBeat('l2_trap', 8, { noHurry: true });
    { const p = await pPos(); const d = await doorIs('d2_bulkhead_s'); if (p[2] < -55.6) bad(`trap latched with the player on the wrong side (z ${p[2].toFixed(2)})`); if (!d?.locked) bad('d2_bulkhead_s not locked after the latch'); }
    await info('11-trap', (s) => (!lockedHas(s, 'd2_bulkhead_n') ? 'd2_bulkhead_n must stay locked' : !lockedHas(s, 'd2_booth') ? 'player could walk into the booth during the window scene' : null));
    // At the south window, face to face. Frames every 1.5 s through the whole window scene.
    await tp(-18.15, 0, -48.65, -90, -2);
    if (!fast) await frames('take-window', 13, 1500); else await wait(3000);
    { const d = await dbg(); if (d.tomas && !fast && d.tomasSpot === 'window' && Math.abs(d.tomas[2] + 48.65) > 0.6) bad(`Tomas is not at the window the player stands at (${d.tomas})`); }
    await waitBeat('#taken', 30, { noHurry: true }); await waitBeat('l2_booth_open', 4, { noHurry: true });
    { const d = await doorIs('d2_booth'); const en = await ev(() => ['term2_booth', 'booth_headset'].map((id) => window.__game.interactables.get(id)?.enabled ?? null)); if (d?.locked) bad('d2_booth did not open after they left'); if (en.includes(false)) bad(`booth console / recorder not enabled after he is gone (${en})`); }
    // Into the booth: the loading is seen through the hall glass.
    await tp(-11.3, 0, -45.4, -90, -3);
    if (!fast) await frames('take-loading', 10, 1500);
    await waitBeat('l2_loaded', 30, { noHurry: true });
    await info('12-loaded', (s) => (!lockedHas(s, 'd2_mouth') ? 'd2_mouth must latch behind him (LOADING INTERLOCK)' : !lockedHas(s, 'd2_booth_hall') && !s.beats.includes('l2_escort') ? 'd2_booth_hall open before the escorts return' : null));
    { const d = await dbg(); if (d.tomas) bad('Tomas actor still exists after the mouth'); }
    return waitCheckpoint('cp2_taken', 8);
  }
  /** The escorts come back as real enemies; the mouth stays shut until they are dead. Ends at cp2_escort. */
  async function s2Escort() {
    await waitBeat('l2_escort', 25, { noHurry: true });
    await waitFlag(() => window.__game.enemies.activeCount > 0, 'the escorts turning hostile', 6);
    { const g = await groupsNow(); if ((g.g2_escort ?? 0) !== 2) bad(`expected 2 real escorts in g2_escort, got ${g.g2_escort ?? 0}`); }
    await info('13-escort', (s) => (!lockedHas(s, 'd2_mouth') ? 'the mouth must stay shut while the escorts are alive (B4)' : lockedHas(s, 'd2_booth_hall') ? 'd2_booth_hall did not open for the escorts' : s.active < 1 ? 'the escorts are not hostile' : null));
    if (!fast) await shot('13-escorts');
    {
      const t = await marks();
      const span = (a, b) => (t[a] !== undefined && t[b] !== undefined ? +(t[b] - t[a]).toFixed(1) : null);
      const T = { window: span('latch', 'taken'), boothOpen: span('taken', 'booth_open'), loaded: span('taken', 'loaded'), seenFromBooth: span('booth_open', 'loaded'), toAttack: span('latch', 'attack'), held: span('latch', 'held'), scan: span('at_deck', 'laid') };
      console.log('  TIMINGS (s):', JSON.stringify(T));
      if (t.latch !== undefined) {
        if (!(T.window >= 17 && T.window <= 23)) bad(`l2_window took ${T.window}s (target 18–22)`);
        if (!(T.boothOpen <= 1.2)) bad(`d2_booth opened ${T.boothOpen}s after the hall door shut (≤ 1)`);
        if (!(T.loaded >= 14 && T.loaded <= 22)) bad(`l2_loaded took ${T.loaded}s from the hall door closing (target 16–21)`);
        if (!(T.toAttack <= 55)) bad(`latch → escorts' attack took ${T.toAttack}s (≤ 55)`);
        if (T.scan > 5.2) bad(`the scanner hold lasted ${T.scan}s (≤ 5)`);
      }
    }
    await wait(900); console.log('  killed', await killAll()); await wait(600); await killAll();
    await waitBeat('#escort_dead', 20);
    await wait(1200);
    { const d = await doorIs('d2_mouth'); if (d?.locked) bad('d2_mouth did not reopen after the escorts'); }
    await info('14-escorts-dead', (s) => (/line/i.test(s.objective) ? null : `objective "${s.objective}"`));
    if (!fast) { await shot('14-booth-empty'); await readIf('booth_headset', [-14, -46]); await readIf('term2_booth', [-14, -46]); }
    return waitCheckpoint('cp2_escort', 25);
  }
  /** The ride (really carried by the belt), Unit 32. Ends at cp2_foreman. */
  async function s2Foreman() {
    { const g = await groupsNow(); if ('g2_unit32' in g) bad('Unit 32 exists before the ride (R4)'); }
    if (CHECKPOINTS) {
      // After a load the belt is crossed on foot (sprinting, west guard): Unit 32 must still come for the player.
      const r = await walkBelt({ side: 'west', sprint: true, jump: true, label: 'checkpoint run: walked ride' });
      if (r.out !== null) {
        await waitBeat('l2_unit32', 6);
        // Away from the core end (as below): the supervisor comes for a player south of z −60 once Unit 32 is dead.
        await tp(-3, 0, -57.5, 0); await wait(300);
        console.log('  killed', await killAll());
        await waitBeat('#unit32_dead', 20);
        return waitCheckpoint('cp2_foreman', 40);
      }
    }
    const by = await ev(() => { const g = window.__game; const V = g.player.position.constructor; const h = g.physics.raycast(new V(4.95, 2.2, -45.6), new V(0, -1, 0), 3); return h ? h.point.y : 0.55; });
    await tp(4.95, by + 0.05, -45.6, 180);
    let xs = [9, -9], z = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const p = await pPos(); z = p[2];
      if (z < -51 && z > -61.5) { xs[0] = Math.min(xs[0], p[0]); xs[1] = Math.max(xs[1], p[0]); }
      if (z < -62.6) break;
      await wait(150);
    }
    const rode = (Date.now() - t0) / 1000;
    console.log(`  belt carried the player to z = ${z.toFixed(2)} in ${rode.toFixed(1)} s (x in the tunnel ${xs.map((v) => v.toFixed(2))})`);
    if (z > -62.6) { bad('the belt did not carry the player through the tunnel'); await tp(5, by + 0.05, -64, 180); }
    if (!fast) await shot('15-apron');
    await waitBeat('l2_tunnel', 5); await waitBeat('l2_apron', 10);
    await info('15-apron', (s) => (!lockedHas(s, 'd2_mouth') ? 'd2_mouth should be latched in phase H' : null));
    await waitBeat('l2_unit32', 12);
    await waitFlag(() => window.__game.enemies.all.some((e) => e.group === 'g2_unit32' && e.alive), 'Unit 32 spawning', 10);
    await wait(2500); if (!fast) await shot('16-unit32');
    { const subs = await ev(() => window.__log.subs); if (!subs.some((t) => /canteen coffee/.test(t) && /UNIT 32/.test(t))) bad('Unit 32 did not say the joke (its set-up was heard)'); }
    console.log('  killed', await killAll());
    // Away from the core end: the supervisor comes for a player south of z −60 once the checkpoint is behind them.
    await tp(-3, 0, -57.5, 0);
    await waitBeat('#unit32_dead', 20);
    return waitCheckpoint('cp2_foreman', 40);
  }
  async function s2Core(shoot14) {
    await noForemanYet('before the trigger');
    await tp(-3, 0, -57.5, 0); await wait(2500);
    { const d = await dbg(); if (d.beats.includes('l2_foreman')) bad('the supervisor came before the player crossed z −60'); }
    await tp(-3, 0, -61.5, 0); await waitBeat('l2_foreman', 8);
    await info('17-foreman', (s) => (!lockedHas(s, 'd2_core') ? 'd2_core open before the foreman is dead' : null));
    if (!fast) await frames('17-foreman', 4, 1200); else await wait(3500);
    await waitFlag(() => window.__game.enemies.all.some((e) => e.type === 'foreman' && e.alive), 'the supervisor arriving', 12);
    for (let i = 0; i < 6; i++) {
      await ev(() => {
        const g = window.__game; const V = g.player.position.constructor;
        for (const e of [...g.enemies.all]) {
          if (e.type !== 'foreman' || !e.alive) continue;
          for (const part of ['head_a', 'head_b', 'head_c']) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part }, 400, new V(0, 0, -1));
        }
      });
      await killAll(); await wait(700);
    }
    await waitBeat('#foreman_dead', 40);
    await wait(800);
    const u14 = await ev(() => { const e = window.__game.enemies.all.find((x) => x.group === 'g2_unit14'); return e ? { state: e.state, alive: e.alive } : null; });
    console.log('  unit 14:', JSON.stringify(u14));
    if (!u14) notes.push('g2_unit14 did not spawn (level spawn missing?)');
    else if (u14.state !== 'dormant') bad(`Unit 14 should stand dormant, is ${u14.state}`);
    if (!shoot14 && u14 && !fast) {
      // The projection's last appearance: it walks into the real unit.
      await tp(-3, 0, -58.5, 0, -3); await waitBeat('#ghost_last', 12, { optional: true }); await frames('18-ghost-last', 3, 1200);
    }
    if (shoot14 && u14) {
      await ev(() => { const g = window.__game; const V = g.player.position.constructor; const e = g.enemies.all.find((x) => x.group === 'g2_unit14'); g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 3, part: 'torso' }, 8, new V(0, 0, -1)); });
      await waitBeat('#unit14_shot', 8);
      // Shot, it wakes (as designed). The run goes on with it put down, so the core checkpoint can be taken.
      await wait(1200); console.log('  killed', await killAll()); await waitBeat('#unit14_dead', 8);
    }
    await info('18-core-door', (s) => (lockedHas(s, 'd2_core') ? 'd2_core still locked after the foreman' : null));
    // REVISION 6.1: before entry the side walls are CHOIR's waveform; the plates are not armed.
    { const k = await ev(() => ['core_wall_2', 'core_wall_4'].map((n) => window.__game.level.screen(n)?.userData.screenKind)); if (k.some((x) => x !== 'choir')) bad(`side walls should show the waveform before entry (${k})`); }
    await tp(0, 0, -75, 0); await waitBeat('l2_core', 10);
    if (!CHECKPOINTS) {
      // Straight out again, before CHOIR's first line: the scanners still go live ≤ 8 s after entering (their own
      // clock), nothing of the offer is said to an empty room, and the lines start from the first one on re-entry.
      await tp(0, 0, -68.5, 180); await wait(400);
      await waitFlag(() => window.__game.interactables.get('core_shutdown')?.enabled && window.__game.interactables.get('core_rewrite')?.enabled, 'scanners going live with the player outside the room', 10);
      const d = await dbg(); const dt = d.t.core_live - d.t.l2_core;
      console.log(`  scanners live ${dt.toFixed(2)} s after entering (player outside, no line spoken)`);
      if (!(dt <= 8.05)) bad(`scanners went live ${dt.toFixed(2)} s after t2_core (≤ 8)`);
      const early = (await ev(() => window.__log.subAt)).filter((x) => ENTRY_TEXT.includes(x.text));
      if (early.length) bad(`offer lines were spoken while the player was outside the room: ${JSON.stringify(early)}`);
      await tp(0, 0, -75, 0);
    }
    return waitCheckpoint('cp2_core', 40);
  }
  // REVISION 6 / 6.1 — the core's lines (texts from voice/lines.l2.json: subtitles carry text, not ids)
  const L2 = JSON.parse(readFileSync('voice/lines.l2.json', 'utf8'));
  const textOf = (id) => L2.find((l) => l.id === id)?.text ?? `<<missing ${id}>>`;
  const idOfText = (text) => L2.find((l) => l.text === text)?.id ?? null;
  const ENTRY = ['l2_choir_core_1', 'l2_choir_offer', 'l2_choir_offer_stop', 'l2_choir_offer_command', 'l2_choir_core_14'];
  const ENTRY_TEXT = ENTRY.map(textOf);
  const BACKSTORY = ['l2_choir_core_2', 'l2_choir_core_3', 'l2_choir_core_4', 'l2_choir_core_6', 'l2_choir_core_7', 'l2_choir_core_7_killed', 'l2_choir_core_8'];
  const REMOVED = ['l2_choir_core_5', 'l2_choir_core_9', 'l2_choir_core_10', 'l2_choir_core_11', 'l2_choir_core_11_killed', 'l2_choir_core_12', 'l2_choir_core_13'];
  const core = async () => (await dbg()).core;
  const screenOf = (name) => ev((name) => { const m = window.__game.level.screen(name); return m ? { kind: m.userData.screenKind, text: m.userData.screenText } : null; }, name);
  const PLATE = { shutdown: { at: [-4.5, -80], yaw: 90, far: [-3.1, -80], obj: 'core_plate_stop' }, rewrite: { at: [4.5, -80], yaw: -90, far: [3.1, -80], obj: 'core_plate_command' } };
  const palm = () => ev(() => window.__game.player.debug.palm());
  /** Every story line spoken so far (this page load), from the story's line log: { id, t } in story time. */
  const spokenIds = async () => (await ev(() => (window.__game.story.lineLog ?? []).filter((l) => l.said).map((l) => ({ id: l.said, t: l.t }))));
  /** …and where the player stood when each subtitle appeared (ids resolved from the text). */
  const spokenRooms = async () => (await ev(() => window.__log.subAt)).map((x) => ({ id: idOfText(x.text), room: x.room })).filter((x) => x.id);
  /** No removed line id anywhere: line files, story sources, the test oracle, and nothing of it spoken. */
  const noRemovedIds = async (label) => {
    for (const id of REMOVED) {
      if (L2.some((l) => l.id === id)) bad(`${label}: removed line id ${id} is still in voice/lines.l2.json`);
      for (const f of ['src/story/l2/script.ts', 'src/story/l2/dialogue.ts', 'src/story/l2/taking.ts', 'src/story/l2/base.ts', 'src/story/l2/ghost.ts']) {
        if (new RegExp(`${id}\\b(?!_)`).test(readFileSync(f, 'utf8'))) bad(`${label}: removed line id ${id} is still referenced in ${f}`);
      }
    }
    const log = await ev(() => (window.__game.story.lineLog ?? []).map((l) => [l.id, l.said]));
    const hit = log.flat().filter((id) => REMOVED.includes(id));
    if (hit.length) bad(`${label}: removed line ids in the line log: ${[...new Set(hit)]}`);
  };
  /**
   * The core (REVISION 6 / 6.1): cards, focus, the scan through the real path (the `interact` press → the story →
   * player.palm → only completion chooses), both aftermaths, the lift panel, the count.
   */
  async function s2End(choice) {
    mkdirSync('shots/core', { recursive: true });
    const cshot = (name) => page.screenshot({ path: `shots/core/${name}.png` });
    await waitBeat('#core_offered', 20);
    await wait(500);
    const en = await ev(() => ['core_shutdown', 'core_rewrite'].map((id) => window.__game.interactables.get(id)?.enabled ?? null));
    if (en.includes(false)) bad(`both scanners must be live at once (${en})`);
    if (en.includes(null)) bad('core_shutdown / core_rewrite interactable missing');
    { const d = await dbg(); const dt = d.t.core_live - d.t.core_enter; if (d.restoredFrom !== 'cp2_core' && !(d.t.core_live - d.t.l2_core <= 8.05)) bad(`scanners went live ${(d.t.core_live - d.t.l2_core).toFixed(2)} s after t2_core (≤ 8)`); void dt; }
    // No interactable on the cells or the pedestal: the room holds exactly the two plates and the library terminal.
    { const ids = await ev(() => window.__game.interactables.all.filter((i) => Math.abs(i.position.x) < 8 && i.position.z < -72.2 && i.position.z > -88).map((i) => `${i.id}:${i.kind}`).sort());
      if (JSON.stringify(ids) !== JSON.stringify(['core_rewrite:palm', 'core_shutdown:palm', 'term2_core:terminal'])) bad(`interactables in the core room: ${ids} (expected the two plates and term2_core only)`);
      const near = await ev(() => { const g = window.__game; const at = [[-4.6, -83.2], [0, -84.6], [4.6, -83.2], [0, -79.4]]; return g.interactables.all.filter((i) => at.some(([x, z]) => Math.hypot(i.position.x - x, i.position.z - z) < 1.6)).map((i) => i.id); });
      if (near.length) bad(`an interactable sits on a cell / the pedestal: ${near}`); }
    await info('19-core', (s) => (!lockedHas(s, 'd2_lift') ? 'd2_lift open before a choice' : /STOP or COMMAND/i.test(s.objective) ? null : `objective "${s.objective}"`));
    // The cards are on the side walls with the story's count.
    const c0 = await core();
    { const w = await screenOf('core_wall_4'), e = await screenOf('core_wall_2');
      console.log(`  cards: west ${JSON.stringify(w)} east ${JSON.stringify(e)} · units ${c0.units}`);
      if (w?.kind !== 'choice_stop' || e?.kind !== 'choice_command') bad(`option cards not on the side walls (${JSON.stringify([w, e])})`);
      if (w?.text !== String(c0.units) || e?.text !== String(c0.units)) bad(`card count ${w?.text}/${e?.text} ≠ units left ${c0.units}`); }
    if (!fast) { await tp(0, 0, -73.2, 0); await wait(700); await cshot(`30-${choice}-run-room-from-door`); await shot('19-core'); }
    // ── the five lines: each once, in order (the two descriptions may swap), none of the backstory before the last ──
    { const end = Date.now() + 25000; let ids = [];
      while (Date.now() < end) { ids = (await spokenIds()).map((x) => x.id); if (ENTRY.every((id) => ids.includes(id))) break; await hurry(); await wait(250); }
      const d = await dbg(); const after = (await spokenIds()).filter((x) => x.t >= d.t.l2_core - 0.01 || d.restoredFrom === 'cp2_core');
      const seq = after.map((x) => x.id).filter((id) => ENTRY.includes(id) || BACKSTORY.includes(id));
      console.log('  lines after entry:', seq.join(' → '));
      const heardBefore = d.restoredFrom === 'cp2_core' ? ENTRY.filter((id) => !seq.includes(id)) : [];
      for (const id of ENTRY) { const n = seq.filter((x) => x === id).length; if (n > 1) bad(`${id} was spoken ${n} times`); if (n === 0 && !heardBefore.includes(id)) bad(`${id} was never spoken in the room`); }
      const i14 = seq.indexOf('l2_choir_core_14');
      const early = seq.slice(0, i14 < 0 ? seq.length : i14).filter((id) => BACKSTORY.includes(id));
      if (early.length) bad(`approach-monologue line(s) spoken after entry, before the offer was complete: ${early}`);
      const order = seq.filter((id) => ENTRY.includes(id));
      const rank = (id) => (id === 'l2_choir_offer_command' ? 2 : ENTRY.indexOf(id));
      for (let i = 1; i < order.length; i++) if (rank(order[i]) < rank(order[i - 1])) bad(`offer lines out of order: ${order.join(' → ')}`);
      const outside = (await spokenRooms()).filter((x) => ENTRY.includes(x.id) && x.room !== 'core');
      if (outside.length) bad(`offer line(s) started while the player was outside the room: ${JSON.stringify(outside)}`); }
    if (!fast) await readIf('term2_core', [-4.9, -74.2]);
    // ── focus: a sweep across the room switches the eye and the pedestal once per option, with no flicker ──
    {
      const setYaw = (y, p = 0) => ev(([y, p]) => { const g = window.__game; g.player.yaw = y * Math.PI / 180; g.player.pitch = p * Math.PI / 180; }, [y, p]);
      await tp(0, 0, -76, 0); await wait(600);
      const before = await core();
      const seen = [];
      for (let y = 84; y >= -84; y -= 3) { await setYaw(y); await wait(70); const c = await core(); if (seen[seen.length - 1] !== c.focus) seen.push(c.focus); }
      await wait(400);
      const c1 = await core();
      console.log(`  focus sweep west → east: ${seen.map((x) => x || '—').join(' → ')} (${c1.focusChanges - before.focusChanges} change(s))`);
      const want = before.focus === 'stop' ? ['stop', 'command'] : before.focus === 'command' ? ['command', 'stop', 'command'] : ['', 'stop', 'command'];
      if (JSON.stringify(seen) !== JSON.stringify(want)) bad(`focus sweep: ${JSON.stringify(seen)}, expected ${JSON.stringify(want)}`);
      { const eye = await screenOf('core_eye'), ped = await screenOf('core_pedestal'); if (eye?.kind !== 'choice_command' || ped?.kind !== 'choice_command') bad(`eye / pedestal do not mirror COMMAND after focusing it (${JSON.stringify([eye, ped])})`); if (eye?.text !== String(c1.units)) bad(`mirror count ${eye?.text} ≠ ${c1.units}`); }
      if (!fast) { await setYaw(0, 8); await wait(500); await cshot(`31-${choice}-run-focus-command`); }
      // latched: looking at neither keeps the last one; the north and south walls stay CHOIR's
      await setYaw(0); await wait(700);
      { const c = await core(); if (c.focus !== 'command') bad(`focus was not latched (looking at neither: "${c.focus}")`); }
      { const n = await screenOf('core_wall_1'), s3 = await screenOf('core_wall_3'); if (n?.kind !== 'choir' || s3?.kind !== 'choir') bad(`north / south walls should stay the waveform (${n?.kind}, ${s3?.kind})`); }
      // hysteresis: hovering at the edge of the STOP zone (inside 16°, out to 21°, in again, every 80 ms) switches once, never back
      const aim = await ev(() => { const g = window.__game; const o = g.level.object('core_plate_stop'); const p = o.getWorldPosition(new g.player.position.constructor()); const e = g.player.eye; return { yaw: Math.atan2(-(p.x - e.x), -(p.z - e.z)) * 180 / Math.PI, pitch: Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z)) * 180 / Math.PI }; });
      const c2 = await core();
      for (let i = 0; i < 26; i++) { await setYaw(aim.yaw - (i % 2 ? 20.5 : 14), aim.pitch); await wait(80); }
      const c3 = await core();
      console.log(`  focus at the edge of the STOP zone (14° ↔ 20.5°, 26 flips): ${c3.focusChanges - c2.focusChanges} change(s), focus "${c3.focus}"`);
      if (c3.focus !== 'stop' || c3.focusChanges - c2.focusChanges !== 1) bad(`focus flickered at the zone edge (${c3.focusChanges - c2.focusChanges} changes, now "${c3.focus}")`);
      // 19° off (between enter and leave) from scratch never enters
      await setYaw(-60); await wait(600);
      const c4 = await core();
      await setYaw(aim.yaw - 19, aim.pitch); await wait(900);
      { const c = await core(); if (c.focus !== c4.focus) bad(`focus entered at 19° (enter threshold is 16°): "${c4.focus}" → "${c.focus}"`); }
      { const eye = await screenOf('core_eye'); if (eye?.kind !== (c4.focus === 'stop' ? 'choice_stop' : 'choice_command')) bad(`eye shows ${eye?.kind} with focus "${c4.focus}"`); }
      // outside the room nothing is focused anew
      await tp(0, 0, -68.5, 0); await setYaw(40); await wait(700);
      { const c = await core(); if (c.focus !== c4.focus || c.candidate) bad(`focus changed from outside the room ("${c.focus}", candidate "${c.candidate}")`); }
      await tp(0, 0, -76, 0);
      if (!fast) { await setYaw(aim.yaw, aim.pitch + 6); await wait(900); await cshot(`32-${choice}-run-focus-stop`); }
    }
    // ── the backstory that was not heard on the way in is said in the idle slots, after the offer — each line once ──
    {
      const base = BACKSTORY.filter((id) => id !== 'l2_choir_core_7_killed');
      const all = (h) => base.every((id) => h.includes(id) || (id === 'l2_choir_core_7' && h.includes('l2_choir_core_7_killed')));
      const end = Date.now() + 30000; let heard = [];
      while (Date.now() < end) { heard = (await dbg()).heard; if (all(heard)) break; await hurry(); await wait(300); }
      if (!all(heard)) bad(`backstory never completed in the idle slots: heard ${heard.filter((id) => BACKSTORY.includes(id))}`);
      const said = (await spokenIds()).map((x) => x.id);
      const dup = BACKSTORY.filter((id) => said.filter((x) => x === id).length > 1);
      if (dup.length) bad(`backstory line(s) spoken twice: ${dup}`);
      if (said.includes('l2_choir_core_7') && said.includes('l2_choir_core_7_killed')) bad('both variants of core_7 were spoken');
      const i14 = said.indexOf('l2_choir_core_14');
      const inIdle = said.slice(i14 < 0 ? said.length : i14 + 1).filter((id) => BACKSTORY.includes(id));
      console.log(`  backstory: all heard; in the idle slots after the offer: ${inIdle.join(', ') || 'none (all heard on the way in)'}`);
    }
    // ── the count: Unit 14 shot dead from inside the room → both cards (and the mirror) lose one at once ──
    let unitsWant = (await core()).units;
    if (choice === 'shutdown') {
      const had = await ev(() => { const g = window.__game; const V = g.player.position.constructor; const e = g.enemies.all.find((x) => x.group === 'g2_unit14' && x.alive); if (!e) return false;
        for (let k = 0; k < 8 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 6, part: 'torso' }, 500, new V(0, 0, -1)); return true; });
      if (had) {
        await waitBeat('#unit14_dead', 6); await wait(500);
        const c = await core(); const w = await screenOf('core_wall_4'), e = await screenOf('core_wall_2'), eye = await screenOf('core_eye');
        console.log(`  Unit 14 shot from inside the room: units ${unitsWant} → ${c.units}; cards ${w?.text}/${e?.text}, eye ${eye?.text}`);
        if (c.units !== unitsWant - 1) bad(`units left did not drop by one when Unit 14 died (${unitsWant} → ${c.units})`);
        if (w?.text !== String(c.units) || e?.text !== String(c.units) || eye?.text !== String(c.units)) bad(`cards not redrawn after Unit 14 died: ${w?.text}/${e?.text}/${eye?.text} ≠ ${c.units}`);
        unitsWant = c.units;
        await killAll();
      } else notes.push('Unit 14 was not alive to be shot from inside the core');
    }
    const P = PLATE[choice], OTHER = PLATE[choice === 'shutdown' ? 'rewrite' : 'shutdown'];
    const id = `core_${choice}`, otherId = choice === 'shutdown' ? 'core_rewrite' : 'core_shutdown';
    const chosen = async () => (await dbg()).flags.choice;
    // ── a press from 2 m: refused — no scan, no choice ──
    {
      await tp(P.far[0], 0, P.far[1], P.yaw, -15); await wait(500);
      const c = await core();
      console.log(`  ${id} from 2 m:`, await use(id));
      await wait(500);
      const c2 = await core(); const pm = await palm();
      if (c2.scans.refused !== c.scans.refused + 1 || c2.scans.started !== c.scans.started || pm.active || c2.scanning) bad(`a press from 2 m was not refused (${JSON.stringify(c2.scans)}, palm ${JSON.stringify(pm)})`);
      if (await chosen()) bad('a press from 2 m chose');
      // …and the prompt is not offered from there either (use radius = start distance)
      const f = await ev(() => window.__game.player.focus?.id ?? null); if (f === id) bad(`the prompt for ${id} shows from 2 m`);
    }
    // ── abandoned scans (on the OTHER plate: the real path each time) choose nothing ──
    {
      const oid = otherId, Q = OTHER;
      const startScan = async (label) => {
        await tp(Q.at[0], 0, Q.at[1], Q.yaw, -10); await wait(500);
        const f = await ev(() => window.__game.player.focus?.id ?? null); if (f !== oid) bad(`${label}: standing at the plate the prompt is "${f}", expected ${oid}`);
        const r = await use(oid); await wait(450);
        const pm = await palm(); const c = await core();
        if (r !== 'ok' || !pm.active || c.scanning !== (oid === 'core_shutdown' ? 'shutdown' : 'rewrite')) bad(`${label}: the scan did not start (${r}, ${JSON.stringify(pm)}, scanning "${c.scanning}")`);
        return pm;
      };
      const ended = async (label, want) => {
        await wait(350);
        const pm = await palm(); const c = await core(); const pl = await screenOf(Q.obj);
        console.log(`  ${label}: palm ${pm.active ? 'active' : 'ended'}, scans ${JSON.stringify(c.scans)}, plate "${pl?.text}", choice "${await chosen()}"`);
        if (pm.active || c.scanning) bad(`${label}: the scan was not cancelled`);
        if (c.scans.abandoned !== want) bad(`${label}: abandoned scans ${c.scans.abandoned}, expected ${want}`);
        if (await chosen()) bad(`${label}: an abandoned scan chose`);
        if (!/\|fail\|/.test(pl?.text ?? '')) bad(`${label}: the plate does not read SCAN INCOMPLETE (${pl?.text})`);
        const en2 = await ev((oid) => window.__game.interactables.get(oid)?.enabled, oid); if (!en2) bad(`${label}: the plate is not re-armed`);
      };
      const a0 = (await core()).scans.abandoned;
      // 1. walk away (real movement, backwards from the plate)
      { const pm = await startScan('walk away'); if (!(pm.lower > 0.5)) bad(`weapon not lowered during the scan (lower ${pm.lower})`);
        await wait(250); const down = await palm();
        if (!down.down || !down.contact || Math.max(...down.contact.map(Math.abs)) > 3) bad(`the hand does not lie on the plate during the scan (${JSON.stringify(down)})`);
        if (!fast) await cshot(`33-${choice}-run-scan-other-plate-hand-down`);
        await ev(() => window.__game.player.debug.move(-1, 0, false)); await wait(700); await ev(() => window.__game.player.debug.move(0, 0, false));
        await ended('walk away', a0 + 1); }
      // 2. hurt
      { await startScan('hurt'); await ev(() => { const g = window.__game; g.debug.god = false; g.player.damage(3); g.debug.god = true; }); await ended('hurt', a0 + 2); }
      // 3. pause
      { await startScan('pause'); await ev(() => window.__game.setState('paused')); await wait(200); await ev(() => window.__game.setState('playing')); await ended('pause', a0 + 3); }
      // 4. a note opens
      { await startScan('note'); await ev(() => { const g = window.__game; g.interactables.use(g.interactables.get('term2_core')); }); await wait(300); await ended('note', a0 + 4); await closeNote(); }
      // no checkpoint is written during a scan, and nothing of it is persisted
      { await startScan('checkpoint'); const d = await dbg(); if (d.calm) bad('the story is "calm" (may save) during a palm scan'); await ev(() => window.__game.player.cancelPalm()); await wait(300); }
    }
    // ── hold to the end on the chosen plate: only completion chooses ──
    await tp(P.at[0], 0, P.at[1], P.yaw, -10); await wait(1500);
    const t0 = (await dbg()).now;
    console.log(`  ${id}:`, await use(id));
    await wait(300);
    if (await chosen()) bad('the press chose before the scan completed');
    if (!fast) { await wait(500); await cshot(`34-${choice}-run-scan`); }
    await waitBeat(`l2_choice_${choice}`, 6, { noHurry: true });
    { const d = await dbg(); const took = d.t[`l2_choice_${choice}`] - t0; console.log(`  scan → choice in ${took.toFixed(2)} s`); if (!(took >= 1.5 && took <= 2.1)) bad(`the scan took ${took.toFixed(2)} s (1.6)`); }
    { const pl = await screenOf(P.obj), other = await screenOf(OTHER.obj); if (!/\|done\|/.test(pl?.text ?? '')) bad(`the chosen plate does not read REYES, S. — LIVING — ROSTERED (${pl?.text})`); if (!/\|off\|/.test(other?.text ?? '')) notes.push(`the other plate is "${other?.text}" after the choice`); }
    { const other = await use(otherId); if (other === 'ok') bad('the second choice was still usable'); const same = await use(id); if (same === 'ok') bad('the chosen plate was still usable'); }
    await waitFlag(() => !window.__game.level.door('d2_lift').locked, 'd2_lift unlocking', 60);
    await waitBeat('#choice_done', 60);
    // nothing of the offer / backstory / idle lines after the choice
    { const d = await dbg(); const late = (await spokenIds()).filter((x) => x.t > d.t[`l2_choice_${choice}`] + 0.05 && (ENTRY.includes(x.id) || BACKSTORY.includes(x.id) || /core_idle/.test(x.id))); if (late.length) bad(`lines of the offer spoken after the choice: ${JSON.stringify(late)}`); }
    if (!fast) { await tp(0, 0, -74, 0, 6); await wait(choice === 'shutdown' ? 2500 : 1200); await shot(`20-${choice}`); await cshot(`35-${choice}-aftermath-from-door`); await tp(P.at[0] * 0.6, 0, -78, P.yaw, 5); await wait(600); await cshot(`36-${choice}-aftermath-card`); }
    await tp(0.6, 0, -90.2, -90, -6); await wait(600);
    { const lp = await screenOf('lift_panel'); const want = choice === 'shutdown' ? /NODE 5 — OFFLINE\nNODES ONLINE: 5 OF 6/ : /NODE 5 — SUPERVISED\nNODES ONLINE: 6 OF 6/; console.log('  lift panel:', JSON.stringify(lp?.text)); if (!want.test(lp?.text ?? '')) bad(`lift panel reads ${JSON.stringify(lp?.text)}`); }
    if (!fast) { await ev(() => { const g = window.__game; const e = g.player.eye; const dx = 1.875 - e.x, dy = 1.42 - e.y, dz = -89.4 - e.z; g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }); await wait(500); await cshot(`37-${choice}-lift-panel`); }
    await tp(0, 0, -90.5, 0); await wait(600);
    console.log('  lift:', await use('lift_button'));
    await waitBeat('l2_end', 15);
    await page.waitForFunction(() => window.__game.state === 'ended', null, { timeout: 60000 }).catch(() => bad('never reached state "ended"'));
    await wait(fast ? 1500 : 5000);
    await shot(`21-end-${choice}`);
    const end = await ev(() => ({ state: window.__game.state, save: localStorage.getItem('coldboot.save.l2.v2'), level: localStorage.getItem('coldboot.level'), beats: window.__game.story.debugState.beats.filter((b) => !b.startsWith('#')),
      husks: window.__game.story.debugState.flags.husksKilled, units: window.__game.story.debugState.core.units, text: document.querySelector('.cb')?.innerText?.replace(/\s+/g, ' ').slice(0, 1200) ?? '' }));
    console.log('  ending text:', end.text);
    if (end.save) bad('the level-2 checkpoint was not cleared by the ending');
    if (end.level !== '2') bad(`stored level after finishing level 2 is ${end.level}, expected 2`);
    // D20 (stage 3a): level 2's card stays, without "TO BE CONTINUED" — the chain hands over to level 3.
    if (/TO BE CONTINUED/i.test(end.text)) bad('level 2\'s end card still says "TO BE CONTINUED" (D20)');
    // The ending counts what is left: never "thirty-two" once units were shot — and it is the cards' number.
    if (end.husks > 0 && /thirty-two/i.test(end.text)) bad('the ending card claims thirty-two units although the player shot some');
    { const m = choice === 'shutdown' ? /UNITS STANDING: 0 OF (\d+)/i.exec(end.text) : /UNITS AWAITING ORDERS: (\d+)/i.exec(end.text);
      console.log(`  ending number ${m?.[1]} · cards showed ${unitsWant}`);
      if (!m || Number(m[1]) !== unitsWant) bad(`the ending's number (${m?.[1]}) is not the number the cards showed (${unitsWant})`); }
    if (!(choice === 'shutdown' ? /You stopped the line\./i : /You took the line\./i).test(end.text)) bad(`end card wording: "${end.text.slice(0, 120)}"`);
    await noRemovedIds(choice);
    return end;
  }
  const checkOrder = (beats, choice, order = ORDER) => {
    const want = [...order, `l2_choice_${choice}`, 'l2_end'];
    let at = -1;
    for (const b of want) {
      const i = beats.indexOf(b);
      if (i < 0) { bad(`beat ${b} never happened`); continue; }
      if (i < at) bad(`beat ${b} happened out of order`);
      at = Math.max(at, i);
    }
    if (beats.includes(choice === 'shutdown' ? 'l2_choice_rewrite' : 'l2_choice_shutdown')) bad('both choices were recorded');
  };
  /** The story's own record: no line was spoken while its condition was false; print what was skipped / replaced. */
  const lineReport = async (label) => {
    const log = await ev(() => window.__game.story.lineLog ?? []);
    const spoken = log.filter((l) => l.said), skipped = log.filter((l) => !l.said), variants = log.filter((l) => l.said && l.said !== l.id);
    console.log(`  [lines ${label}] spoken ${spoken.length} (conditional ${spoken.filter((l) => l.cond !== null).length}), skipped ${skipped.length}, replaced by a variant ${variants.length}`);
    if (variants.length) console.log('    variants:', variants.map((l) => `${l.id}→${l.said}`).join(', '));
    if (skipped.length) console.log('    skipped:', [...new Set(skipped.map((l) => l.id))].join(', '));
    return { spoken, skipped, variants };
  };
  const SEG2 = [s2Start, s2Hall, s2Talk, s2Pass, s2Relay, s2Taken, s2Escort, s2Foreman, s2Core];

  if (IMPATIENT) await page.addInitScript(installOracle, await (async () => {
    const o = {};
    for (const l of JSON.parse(readFileSync('voice/lines.l2.json', 'utf8'))) { o[l.id] = l.text; o['@' + l.id] = l.fx ? l.fx : l.speaker; }
    return o;
  })());
  await boot(); await clearL2(); await boot();
  const f2 = await feat2();
  console.log('features:', JSON.stringify(f2));
  if (f2.level !== 2) { console.log('FAILED: ?level=2 did not boot level 2'); await browser.close(); process.exit(1); }

  if (IMPATIENT) { await runImpatient(); return; }

  if (!CHECKPOINTS) {
    for (const choice of ENDINGS) {
      console.log(`\n══════════ level 2 → ${choice} ══════════`);
      await clearL2(); await boot();
      { const b0 = await ev(() => ({ beats: window.__game.story.debugState.beats, from: window.__game.story.debugState.restoredFrom }));
        if (b0.from || b0.beats.some((x) => /^l2_choice_|^l2_end$/.test(x))) bad(`the ${choice} run did not start fresh: ${JSON.stringify(b0)}`); }
      for (const seg of SEG2) await seg(choice === 'rewrite');
      const end = await s2End(choice);
      checkOrder(end.beats, choice);
      console.log('  beats:', end.beats.join(' → '));
      await lineReport(choice);
    }
    // ?nostory=1: no beats; line held, gate open, mouth and exit shut, every other door unlocked.
    await clearL2(); await boot('&nostory=1'); await wait(800);
    { const s = await status(); console.log('[nostory]', JSON.stringify({ locked: s.locked, beats: s.beats }));
      const rest = s.locked.split(',').filter((d) => d && d !== 'd2_mouth' && d !== 'd2_exit');
      if (rest.length) bad(`?nostory=1 left doors locked: ${rest}`); if (s.beats.length) bad('?nostory=1 ran beats'); }
    // An old save (removed checkpoint id / older story revision) is discarded, and the level starts over.
    const SAVE_V = Number(/SAVE_VERSION = (\d+)/.exec((await import('node:fs')).readFileSync('src/story/save.ts', 'utf8'))?.[1] ?? 1);
    for (const old of [{ id: 'cp2_apron', rev: 5 }, { id: 'cp2_pass' }]) {
      await clearL2(); await boot(); await wait(300);
      await ev(([old, v]) => {
        const g = window.__game;
        const s = { v, level: 2, facts: {}, place: 'X', player: g.player.snapshot(), story: { beats: ['l2_arrive'], read: [], visited: [], flags: {}, triggered: [], cleared: [], checkpoints: [] }, logs: [], stats: { time: 1, kills: 0 }, cleared: [], ...old };
        localStorage.setItem('coldboot.save.l2.v2', JSON.stringify(s));
      }, [old, SAVE_V]);
      await boot('&continue=1'); await wait(1500);
      const r = await ev(() => ({ restored: window.__game.story.debugState.restoredFrom, save: localStorage.getItem('coldboot.save.l2.v2'), state: window.__game.state, beats: window.__game.story.debugState.beats }));
      console.log(`[old save ${JSON.stringify(old)}]`, JSON.stringify({ restored: r.restored, kept: !!r.save, state: r.state }));
      if (r.restored) bad(`an old save (${JSON.stringify(old)}) was loaded instead of discarded`);
      if (r.state !== 'playing' || !r.beats.includes('l2_arrive')) bad('after discarding an old save the level did not start from the beginning');
    }
    // Level 1 → level 2 hand-over: stored level, carried loadout.
    await clearL2(); await boot('&level=1&handoff=1'); await wait(500);
    await ev(() => { const g = window.__game; g.player.give('pistol', 12); g.player.give('ammo_pistol', 7); g.story.handoff(); });
    const ho = await ev(() => ({ level: localStorage.getItem('coldboot.level'), carry: JSON.parse(localStorage.getItem('coldboot.carry.v2') ?? 'null'), l1: localStorage.getItem('coldboot.save.l1.v2') }));
    console.log('[handoff]', JSON.stringify(ho));
    if (ho.level !== '2' || ho.carry?.v !== 2 || ho.carry?.from !== 1 || !ho.carry?.weapons?.pistol?.owned || ho.l1) bad(`hand-over did not store level 2 + loadout / clear the level-1 save: ${JSON.stringify(ho)}`);
    await boot('&nolevel=1'); await wait(800);
    { const r = await ev(() => ({ level: window.__game.levelId, pistol: window.__game.player.weapons.pistol, shotgun: window.__game.player.weapons.shotgun.owned }));
      console.log('[handoff → reload]', JSON.stringify(r));
      if (r.level !== 2) bad('after the hand-over the page did not boot level 2');
      else if (!r.pistol.owned || r.shotgun) bad(`carried loadout not applied: ${JSON.stringify(r)}`); }
    await clearL2();
    await browser.close();
    if (notes.length) console.log(`\nNOTES:\n - ${[...new Set(notes)].join('\n - ')}`);
    console.log(problems.length ? `\nFAILED:\n - ${problems.join('\n - ')}` : '\nLEVEL2 OK');
    process.exit(problems.length ? 1 : 0);
  }

  // ── --level2 --checkpoints ──
  fast = true;
  const PHASE_OF = { cp2_start: 'A', cp2_hall: 'A', cp2_talk: 'B', cp2_pass: 'C', cp2_relay: 'C', cp2_taken: 'F', cp2_escort: 'G2', cp2_foreman: 'H', cp2_core: 'I' };
  const world2 = () => ev(() => {
    const g = window.__game; const p = g.player; const d = g.story.debugState;
    const groups = {};
    for (const e of g.enemies.all) groups[e.group] = (groups[e.group] ?? 0) + 1;
    return {
      state: g.state, pos: [p.position.x, p.position.y, p.position.z].map((v) => +v.toFixed(2)), health: Math.round(p.health),
      weapons: Object.fromEntries(Object.entries(p.weapons).map(([k, w]) => [k, [w.owned, w.clip, w.reserve]])), keys: [...p.keys].sort(),
      locked: g.level.doors.filter((x) => x.locked).map((x) => x.id).sort().join(','), groups, active: g.enemies.activeCount,
      beats: d.beats, flags: d.flags, restoredFrom: d.restoredFrom, cleared: d.cleared, objective: g.story.objective, logs: [...g.story.logs].sort(),
      tomas: !!d.tomas, phase: d.phase, phaseApplied: d.phaseApplied, heard: d.heard.length,
    };
  });
  const results = [];
  for (const [idx, cp] of CP2.entries()) {
    if (ONLY_CP && cp !== ONLY_CP) continue;
    console.log(`\n══════════ ${cp} ══════════`);
    const start = problems.length;
    await clearL2(); await boot();
    let saved = null;
    for (let i = 0; i <= idx; i++) saved = await SEG2[i](false);
    if (!saved || saved.id !== cp) { bad(`${cp}: the save does not hold this checkpoint (${saved?.id ?? 'none'})`); results.push({ cp, restored: false, ended: false }); continue; }
    await wait(200);
    const want = await world2();
    await ev(() => { const g = window.__game; g.debug.god = false; g.player.damage(9999); });
    await page.waitForFunction(() => window.__game.state === 'dead', null, { timeout: 5000 }).catch(() => bad(`${cp}: player did not die`));
    await wait(1500);
    // cp2_taken turns into the escort fight two seconds after the load: look at it before that.
    await boot('&continue=1'); await wait(cp === 'cp2_taken' ? 900 : 3000);
    await page.screenshot({ path: `shots/l2/${cp}-restored.png` });
    await fastTalk();
    const got = await world2();
    const log = await ev(() => window.__log);
    console.log('  after:', JSON.stringify({ pos: got.pos, health: got.health, keys: got.keys, locked: got.locked, groups: got.groups, objective: got.objective, tomas: got.tomas, phase: got.phase }));
    if (got.state !== 'playing') bad(`${cp}: state after load is ${got.state}`);
    if (got.restoredFrom !== cp) bad(`${cp}: restoredFrom = ${got.restoredFrom}`);
    if (got.phase !== PHASE_OF[cp] || got.phaseApplied !== PHASE_OF[cp]) bad(`${cp}: loaded into phase ${got.phase} (applied ${got.phaseApplied}), expected ${PHASE_OF[cp]}`);
    const sp = saved.player.position;
    if (Math.hypot(got.pos[0] - sp[0], got.pos[2] - sp[2]) > 0.8) bad(`${cp}: player position ${got.pos} ≠ saved ${sp}`);
    // REVISION 6.1: loading cp2_core arms the scanners at once (the save is taken on entering, before they go live):
    // `offered` and the objective are the live ones after the load, whatever they were at the save.
    const liveOnLoad = cp === 'cp2_core';
    if (liveOnLoad) { if (!got.flags.offered) bad('cp2_core: scanners not live (flag offered) after the load'); if (!/STOP or COMMAND/.test(got.objective)) bad(`cp2_core: objective after the load "${got.objective}"`); }
    for (const k of ['health', 'weapons', 'keys', 'locked', 'objective', 'logs']) if (!(liveOnLoad && k === 'objective') && !same(got[k], want[k])) bad(`${cp}: ${k} not restored: ${JSON.stringify(got[k])} ≠ ${JSON.stringify(want[k])}`);
    for (const k of Object.keys(want.flags)) if (!(liveOnLoad && k === 'offered') && got.flags[k] !== want.flags[k]) bad(`${cp}: flag ${k} = ${got.flags[k]}, was ${want.flags[k]}`);
    if (got.heard < (saved.story.heard ?? []).length) bad(`${cp}: heard lines lost by the load (${got.heard} < ${(saved.story.heard ?? []).length})`);
    const lost = saved.story.beats.filter((b) => !got.beats.includes(b));
    if (lost.length) bad(`${cp}: beats lost by the load: ${lost}`);
    const replayed = log.beats.filter((b) => saved.story.beats.includes(b) && b !== 'l2_power');
    if (replayed.length) bad(`${cp}: beats replayed by the load: ${replayed}`);
    if (log.subs.length) bad(`${cp}: lines spoken right after the load: ${JSON.stringify(log.subs)}`);
    if (!log.toasts.includes('CHECKPOINT RESTORED')) bad(`${cp}: no CHECKPOINT RESTORED toast`);
    for (const g of want.cleared) if (got.groups[g]) bad(`${cp}: group ${g} is back`);
    if (got.active > 0) bad(`${cp}: ${got.active} enemies active right after the load`);
    if (idx <= 4 && !got.tomas && want.tomas) bad(`${cp}: Tomas is not in the booth after the load`);
    if (idx >= 5 && got.tomas) bad(`${cp}: Tomas is back in the booth`);
    if (idx < 8 && got.groups.g2_foreman) bad(`${cp}: the supervisor exists after the load (R4)`);
    if (cp === 'cp2_taken') {
      // No scene: booth open, he is gone, mouth shut; then the hall door opens and two real husks come.
      const dz = await doorIs('d2_booth'), dm = await doorIs('d2_mouth');
      if (dz?.locked || !dz?.open) bad(`cp2_taken: d2_booth should stand open (${JSON.stringify(dz)})`);
      if (!dm?.locked) bad('cp2_taken: d2_mouth should be latched');
      await waitBeat('l2_escort', 8, { noHurry: true }); await wait(500);
      const g = await groupsNow(); const dh = await doorIs('d2_booth_hall');
      if ((g.g2_escort ?? 0) !== 2) bad(`cp2_taken: expected 2 escorts after the load, got ${g.g2_escort ?? 0}`);
      if (dh?.locked) bad('cp2_taken: d2_booth_hall did not open 2 s after the load');
    }
    if (cp === 'cp2_core') {
      // REVISION 6.1: the cards are drawn by the load, the scanners are live at once, nothing is focused,
      // and CHOIR resumes from the first line of the offer that was not heard — not at once.
      const st = await ev(() => { const g = window.__game; const k = (n) => g.level.screen(n)?.userData; return { w: k('core_wall_4'), e: k('core_wall_2'), eye: k('core_eye')?.screenKind, en: ['core_shutdown', 'core_rewrite'].map((id) => g.interactables.get(id)?.enabled), core: g.story.debugState.core, plates: ['core_plate_stop', 'core_plate_command'].map((n) => k(n)?.screenText) }; });
      console.log('  core after load:', JSON.stringify(st));
      if (st.w?.screenKind !== 'choice_stop' || st.e?.screenKind !== 'choice_command') bad(`cp2_core: option cards not drawn by the load (${st.w?.screenKind}, ${st.e?.screenKind})`);
      if (st.w?.screenText !== String(st.core.units) || st.e?.screenText !== String(st.core.units)) bad(`cp2_core: card count ${st.w?.screenText} ≠ ${st.core.units}`);
      if (st.en.includes(false) || st.en.includes(undefined)) bad(`cp2_core: scanners not live at once after the load (${st.en})`);
      if (!st.plates.every((t) => /\|idle\|/.test(t ?? ''))) bad(`cp2_core: plates not armed after the load (${st.plates})`);
      if (st.eye !== 'choir' || st.core.focus) bad(`cp2_core: something is focused right after the load (${st.eye}, "${st.core.focus}")`);
      const heard = saved.story.heard ?? [];
      const first = ENTRY.find((id) => !heard.includes(id));
      const end = Date.now() + 15000; let got1 = null;
      while (Date.now() < end && !got1) { got1 = (await spokenIds()).find((x) => ENTRY.includes(x.id) || BACKSTORY.includes(x.id))?.id ?? null; await wait(250); }
      console.log(`  first line after the load: ${got1} (first not heard at the save: ${first})`);
      if (first && got1 !== first) bad(`cp2_core: CHOIR resumed with ${got1}, expected the first line not heard (${first})`);
    }
    const restoredOk = problems.length === start;
    console.log(restoredOk ? `  RESTORED OK (${cp})` : `  RESTORE FAILED (${cp})`);
    for (let i = idx + 1; i < SEG2.length; i++) await SEG2[i](false);
    const end = await s2End('shutdown');
    results.push({ cp, restored: restoredOk, ended: end.state === 'ended' });
  }
  await clearL2();
  await browser.close();
  console.log('\nMATRIX:');
  for (const r of results) console.log(`  ${r.cp.padEnd(12)} restored ${r.restored ? 'OK  ' : 'FAIL'}  reached ending ${r.ended ? 'YES' : 'NO '}`);
  if (notes.length) console.log(`\nNOTES:\n - ${[...new Set(notes)].join('\n - ')}`);
  console.log(problems.length ? `\nFAILED:\n - ${problems.join('\n - ')}` : '\nLEVEL2 CHECKPOINTS OK');
  process.exit(problems.length ? 1 : 0);

  // ───────────────────────────────────────────────────────────── --level2 --impatient
  /**
   * The impatient player (REVISION 5.1): shoots every unit on sight with the real weapon, uses things in the
   * wrong order, never waits for a line to finish (lines play at their real length and queue). Asserts:
   *   – no soft-lock: every stage is reached within its time-out, and the level ends correctly;
   *   – no line was spoken while false: the ORACLE (installOracle, world state only) judged every subtitle;
   *   – R4: nothing of a later beat existed early;
   *   – timing cases the flood fill cannot see: sprinting back through the closing bulkhead, standing in a
   *     doorway while it closes, running past the escorts to the belt.
   */
  async function runImpatient() {
    const stage = async (name, fn, seconds, label) => {
      const end = Date.now() + seconds * 1000;
      while (Date.now() < end) { if (await ev(fn)) return true; await wait(150); }
      bad(`SOFT-LOCK? ${name}: ${label ?? 'condition'} not reached in ${seconds}s — ${JSON.stringify(await ev(() => { const g = window.__game; const d = g.story.debugState; return { phase: d.phase, objective: g.story.objective, room: g.level.roomAt(g.player.position)?.id, speaking: d.speaking, locked: g.level.doors.filter((x) => x.locked).map((x) => x.id).join(',') }; }))}`);
      return false;
    };
    const hasBeat = (id) => ev((id) => window.__game.story.debugState.beats.includes(id), id);
    const beatIn = async (id, seconds) => { const end = Date.now() + seconds * 1000; while (Date.now() < end) { if (await hasBeat(id)) return true; await wait(150); } bad(`SOFT-LOCK? beat/cue ${id} not reached in ${seconds}s`); return false; };
    const move = (fwd, strafe = 0, sprint = false) => ev(([f, s, sp]) => window.__game.player.debug.move(f, s, sp), [fwd, strafe, sprint]);
    const look = (yawDeg, pitchDeg = 0) => ev(([y, p]) => { const g = window.__game; g.player.yaw = y * Math.PI / 180; g.player.pitch = p * Math.PI / 180; }, [yawDeg, pitchDeg]);
    /** Aim at a world point and fire the real weapon `n` times. */
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
    /** Shoot every living unit of the groups (the real weapon; the last resort is the damage API). Returns kills. */
    const shootGroup = (groups, shots = 7) => ev(async ([groups, shots]) => {
      const g = window.__game; const V = g.player.position.constructor; let killed = 0, api = 0;
      for (const e of [...g.enemies.all]) {
        if (!e.alive || !groups.includes(e.group)) continue;
        for (let i = 0; i < shots && e.alive; i++) {
          const eye = g.player.eye; const h = e.type === 'skitter' ? 0.25 : e.type === 'sentry' ? 0.0 : 1.35;
          const dx = e.position.x - eye.x, dy = e.position.y + h - eye.y, dz = e.position.z - eye.z;
          g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
          await new Promise((r) => setTimeout(r, 50));
          const w = g.player.currentWeapon ? g.player.weapons[g.player.currentWeapon] : null;
          if (w && w.clip === 0) { g.player.debug.reload(); await new Promise((r) => setTimeout(r, 1900)); }
          g.player.debug.fire();
          await new Promise((r) => setTimeout(r, 300));
        }
        if (e.alive) { api++; for (let k = 0; k < 8 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1)); }
        killed++;
      }
      return { killed, finishedByApi: api };
    }, [groups, shots]);
    const killAwake = async (label) => {
      for (let i = 0; i < 12; i++) {
        const n = await ev(() => window.__game.enemies.all.filter((e) => e.alive && e.state !== 'dormant').map((e) => e.group));
        if (!n.length) return;
        const r = await shootGroup([...new Set(n)], 5);
        console.log(`  ${label}: shot ${JSON.stringify(r)} of ${[...new Set(n)]}`);
        await wait(400);
      }
    };
    const O = () => ev(() => window.__O);
    /** The run is about behaviour, not about ammunition: keep the guns fed. */
    const ammo = () => ev(() => { const p = window.__game.player; p.give('ammo_pistol', 60); p.give('ammo_shotgun', 30); });
    const say = async (label) => { const o = await O(); console.log(`  [${label}] lines so far ${o.lines.length}, violations ${o.viol.length}${o.viol.length ? ' ' + JSON.stringify(o.viol.slice(-3)) : ''}`); };
    const region = (name) => ev((name) => { const g = window.__game; const p = g.player.position; return (g.level.regions?.[name] ?? []).some((b) => p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z); }, name);

    console.log('\n══════════ level 2 — the impatient player ══════════');
    await clearL2(); await boot('&give=all'); await wait(600);
    if (!(await ev(() => !!window.__O))) { bad('oracle not installed'); }

    // ── dock / intake: shoot the working units on sight ──
    await tp(1.5, 0, -1.5, 0); await beatIn('l2_dock', 8);
    console.log('  dock:', JSON.stringify(await shootGroup(['g2_dock'])));
    await tp(0, 0, -10, 0); await beatIn('l2_intake', 8);
    console.log('  intake:', JSON.stringify(await shootGroup(['g2_intake'])));
    await killAwake('intake');
    await tp(0, 0, -20.5, 0); await wait(400);
    await tp(0, 0, -24.5, 0); await beatIn('l2_hall_reveal', 8);
    await say('tidy place');

    // ── wrong order: every door and place of later phases first, before ever talking to him ──
    const tryDoor = async (x, z, yaw, id, mustStay) => {
      await tp(x, 0, z, yaw); await wait(700);
      const d = await doorIs(id);
      if (mustStay && !d?.locked) bad(`${id} is not locked in phase A`);
      return d;
    };
    await tryDoor(8.9, -34, -90, 'd2_fitting', true);          // the fitting bays (dark)
    await tryDoor(8.9, -61, -90, 'd2_relay', true);            // the relay room (no pass)
    await tryDoor(-8.9, -66, 90, 'd2_spine', true);            // the spine link (no power)
    await tryDoor(0, -68.8, 0, 'd2_core', true);               // the core
    await noForemanYet('impatient, hall south in phase A');
    { const by = await ev(() => { const g = window.__game; const V = g.player.position.constructor; const h = g.physics.raycast(new V(5, 2.2, -47), new V(0, -1, 0), 3); return h ? h.point.y : 0.55; });
      // On the held belt, walking at the tunnel mouth: it is shut (a real barrier, nobody comments).
      await tp(5, by + 0.05, -47, 0); await move(1, 0, true); await wait(2500); await move(0);
      const p = await pPos(); console.log(`  walked the held belt toward the mouth: stopped at z ${p[2].toFixed(2)}`);
      if (p[2] < -50.6) bad(`the player walked into the tunnel in phase A (z ${p[2].toFixed(2)})`); }
    // Shoot the booth glass at him before saying hello.
    await tp(-6.5, 0, -46.5, 90); await beatIn('l2_tomas_seen', 10);
    await fireAt(-10.4, 1.5, -47.3, 2);
    await say('before the talk');
    { const o = await O(); if (o.said.some((id) => /^l2_tomas_/.test(id))) bad(`Tomas spoke before the intercom was pressed: ${o.said.filter((id) => /^l2_tomas_/.test(id))}`); }

    // ── the intercom: press it and leave at once; try the fitting door while he is still unlocking it ──
    console.log('  intercom:', await use('intercom_hall'));
    await beatIn('l2_intercom', 5);
    await tp(8.9, 0, -34, -90); await wait(500);
    { const d = await doorIs('d2_fitting'); console.log('  fitting door right after the press:', JSON.stringify(d)); }
    await stage('fitting unlock', () => !window.__game.level.door('d2_fitting').locked, 30, 'd2_fitting unlocking after three lines');
    const tUnlock = await ev(() => window.__game.story.debugState.t);
    console.log(`  fitting unlocked ${(tUnlock.fit_open - tUnlock.l2_intercom).toFixed(1)} s after the press`);

    // ── fitting bays: everything on sight — treadmill units, the alcove units asleep, both holograms ──
    await tp(11.4, 0, -34, -90); await wait(500);
    console.log('  fitting:', JSON.stringify(await shootGroup(['g2_fit_tread', 'g2_fit_wake'], 8)));
    await killAwake('fitting');
    { const d = await dbg(); if (d.ghost) { await fireAt(d.ghost.at[0], d.ghost.at[1] + 1.2, d.ghost.at[2], 2); await wait(1500); const d2 = await dbg(); console.log('  shot the projection:', JSON.stringify(d.ghost), '→', JSON.stringify(d2.ghost)); if (d2.ghost && d2.ghost.mode !== 'none') notes.push('the projection did not collapse when shot'); } else console.log('  (no projection on stage to shoot)'); }
    await say('fitting');
    await ammo();
    // The pass, with the alcove units already dead: no "Behind you!", no fight beat.
    const passId = await ev(() => window.__game.level.pickupSpawns.find((p) => p.kind === 'keycard')?.id ?? null);
    if (passId && await goTo(passId, [14, -34])) console.log('  pass:', await use(passId)); else await ev(() => window.__game.player.addKey('section_pass'));
    await beatIn('l2_pass', 6); await beatIn('#fit_over', 12);
    { const d = await dbg(); if (d.beats.includes('l2_fit_fight')) bad('a fight beat ran although the alcove units were dead before the pass was taken'); }

    // ── south: the ambush, the relay room's slumped unit shot before the switch, the switch at once ──
    await tp(-4, 0, -56, 0); await wait(1500); await killAwake('hall ambush');
    await tp(13, 0, -61, -90); await beatIn('l2_relay_enter', 6);
    console.log('  relay:', JSON.stringify(await shootGroup(['g2_relay'], 8)));
    await goTo('relay_switch', [13, -61]);
    console.log('  switch:', await use('relay_switch'));
    await beatIn('l2_power', 5);
    // Straight at the door: it holds (ARC INTERLOCK) while anything hostile is alive.
    await tp(11.2, 0, -61, 90); await move(1, 0, true); await wait(1500); await move(0);
    { const r = await ev(() => window.__game.level.roomAt(window.__game.player.position)?.id); if (r !== 'relay') bad(`the player left the relay room during the arc interlock (now in ${r})`); }
    await wait(1800); await killAwake('relay fight'); await wait(1200); await killAwake('relay fight');
    await beatIn('#relay_clear', 60);
    await say('section C');
    { const g = await groupsNow(); const left = NORTH.filter((n) => n in g); if (left.length) bad(`north groups still exist after l2_power: ${left}`); }

    // ── TIMING CASE 1: sprint into the trap trigger and straight back out through the closing bulkhead ──
    {
      await tp(-19, 0, -57.6, 180); await wait(400);
      await look(180); await move(1, 0, true);   // north is +Z: yaw 180
      await stage('reach the trap trigger', () => window.__game.player.position.z > -55.2, 5, 'running north through the bulkhead');
      await look(0); // turn round and sprint back south at once
      await wait(2600); await move(0); await wait(900);
      const p = await pPos(); const d = await dbg(); const door = await doorIs('d2_bulkhead_s');
      const trapped = d.beats.includes('l2_trap');
      console.log(`  sprint-back: player z ${p[2].toFixed(2)}, trapped ${trapped}, latch retries ${d.t.latch_retries ?? 0}, door ${JSON.stringify(door)}`);
      if (trapped && p[2] < -55.6) bad(`the scene started with the player SOUTH of the bulkhead (z ${p[2].toFixed(2)})`);
      if (!trapped && p[2] > -55.6 && door?.locked) bad('the player is north of a locked bulkhead and no scene started');
      if (Math.abs(p[2] + 56) < 0.28 && door?.closed) bad(`the player is stuck inside the closed bulkhead (z ${p[2].toFixed(2)})`);
      if (!trapped) {
        // TIMING CASE 2: stop IN the doorway while it closes.
        await tp(-19, 0, -57.6, 180); await wait(600); await look(180); await move(1, 0, false);
        await stage('reach the trap trigger again', () => window.__game.player.position.z > -55.3, 6, 'walking north through the bulkhead');
        await look(0); await move(1, 0, false);
        await stage('back in the doorway', () => window.__game.player.position.z < -55.75 || window.__game.story.debugState.beats.includes('l2_trap'), 4, 'stepping back into the doorway');
        await move(0); await wait(2500);
        const p2 = await pPos(); const d2 = await dbg(); const door2 = await doorIs('d2_bulkhead_s');
        console.log(`  doorway: player z ${p2[2].toFixed(2)}, trapped ${d2.beats.includes('l2_trap')}, latch retries ${d2.t.latch_retries ?? 0}, door ${JSON.stringify(door2)}`);
        if (d2.beats.includes('l2_trap') && p2[2] < -55.6) bad(`doorway: the scene started with the player south of the bulkhead (z ${p2[2].toFixed(2)})`);
        if (Math.abs(p2[2] + 56) < 0.28 && door2?.closed) bad(`doorway: the player is stuck inside the closed bulkhead (z ${p2[2].toFixed(2)})`);
        if (!d2.beats.includes('l2_trap')) { await tp(-19, 0, -57.6, 180); await wait(500); await look(180); await move(1, 0, true); await stage('into the trap', () => window.__game.player.position.z > -53, 5); await move(0); }
      }
      await beatIn('l2_trap', 10);
      const p3 = await pPos(); if (p3[2] < -55.6) bad(`after the latch the player is south of the bulkhead (z ${p3[2].toFixed(2)})`);
    }

    // ── the taking: shoot the glass, run between the windows, try his door, never go into the booth ──
    await ammo();
    {
      const t0 = Date.now();
      await tp(-18.2, 0, -48.65, -90); await wait(2600);
      await fireAt(-16.6, 1.5, -48.65, 3);                         // at him, through the window
      await wait(600);
      await tp(-18.2, 0, -43.35, -90); await wait(1600);            // other window: he follows until they have him
      { const d = await dbg(); console.log(`  moved to the north window at ${((Date.now() - t0) / 1000).toFixed(1)} s: Tomas ${JSON.stringify(d.tomas)} (${d.tomasSpot})`); }
      await tp(-18.1, 0, -46, -90); await move(1, 0, true); await wait(1500); await move(0);   // his door: CYCLING
      { const p = await pPos(); if (p[0] > -17.3) bad(`the player got into the booth during the window scene (x ${p[0].toFixed(2)})`); }
      await tp(-18.2, 0, -43.35, -90);
      await beatIn('#taken', 30); await beatIn('l2_booth_open', 4);
      // Stay in the corridor: the laying must not wait for the player for ever (12 s rule).
      await beatIn('l2_loaded', 30);
      const o = await O(); const d = await dbg();
      if (!o.said.includes('l2_choir_glass')) notes.push('CHOIR did not say the glass is rated although the window was shot');
      const hits = o.glass.filter((x) => x >= (o.trapAt ?? 1e9)).length;
      console.log(`  shots that hit the spine window during the scene: ${hits}`);
      if (!hits) bad('the test never hit the spine window (no ammo?) — the glass lines were not exercised');
      if (hits && o.said.includes('l2_tomas_window_3') && o.lines.find((l) => l.id === 'l2_tomas_window_3').t > o.glass.find((x) => x >= o.trapAt)) bad('"Don\'t shoot the glass" was said after the player shot it');
      console.log('  scene timings:', JSON.stringify(Object.fromEntries(['latch', 'held', 'taken', 'booth_open', 'at_deck', 'laid', 'loaded'].map((k) => [k, d.t[k] !== undefined ? +(d.t[k] - d.t.latch).toFixed(1) : null]))));
      if (d.t.laid - d.t.booth_open > 13.5) bad(`the laying waited ${(d.t.laid - d.t.booth_open).toFixed(1)} s for a player who never entered the booth (≤ 12 + walk)`);
    }
    await say('the taking');

    // ── TIMING CASE 3: run past the escorts to the belt the moment the hall door opens ──
    {
      await tp(-11.2, 0, -43, -90); // standing in the hall door's doorway as it opens
      await beatIn('l2_escort', 25);
      await move(1, 0, true); await wait(700); await move(0);
      const by = await ev(() => { const g = window.__game; const V = g.player.position.constructor; const h = g.physics.raycast(new V(5, 2.2, -47), new V(0, -1, 0), 3); return h ? h.point.y : 0.55; });
      await tp(5, by + 0.05, -46, 0); await move(1, 0, true);
      let minZ = 0;
      for (let i = 0; i < 40; i++) { const p = await pPos(); minZ = Math.min(minZ, p[2]); await wait(150); }
      await move(0);
      const dm = await doorIs('d2_mouth'); const g = await groupsNow();
      console.log(`  ran for the belt with ${g.g2_escort ?? 0} escort(s) alive: deepest z ${minZ.toFixed(2)}, mouth ${JSON.stringify(dm)}`);
      if (minZ < -50.6 && (g.g2_escort ?? 0) > 0) bad(`the player rode into the tunnel past living escorts (z ${minZ.toFixed(2)})`);
      if (!dm?.locked && (g.g2_escort ?? 0) > 0) bad('the mouth is not latched while the escorts are alive');
      await tp(-3, 0, -40, 160); await wait(300);
      await killAwake('escorts');
      console.log('  escorts:', JSON.stringify(await shootGroup(['g2_escort'], 8)));
      await beatIn('#escort_dead', 70);
      await stage('mouth reopening', () => !window.__game.level.door('d2_mouth').locked, 8);
    }

    // ── the ride, WALKED (the user's soft-lock): on foot along each side of the belt, never carried, never waiting.
    //    A: east guard, walking and jumping. Then die and load cp2_escort. B: west guard, sprinting. Unit 32 must be
    //    hunting within seconds of the player leaving the tunnel each time, wherever they go after it. ──
    let oracleA = null;
    {
      await waitCheckpoint('cp2_escort', 40);
      await walkBelt({ side: 'east', sprint: false, jump: true, label: 'walk A (east guard, walking, jumping)' });
      const o = await O();
      console.log(`  walk A: x inside the tunnel ${o.minTunnelX.toFixed(2)} … ${o.maxTunnelX.toFixed(2)}`);
      if (o.minTunnelX < 3.7 || o.maxTunnelX > 6.3) bad(`the player left the belt inside the tunnel (x ${o.minTunnelX.toFixed(2)} … ${o.maxTunnelX.toFixed(2)})`);
      await beatIn('l2_apron', 2); await beatIn('l2_unit32', 2);
      oracleA = o;
      // Die on the apron with Unit 32 alive; load the checkpoint before the ride.
      await ev(() => { const g = window.__game; g.debug.god = false; g.player.damage(9999); });
      await page.waitForFunction(() => window.__game.state === 'dead', null, { timeout: 8000 }).catch(() => bad('walk A: the player did not die'));
      await wait(1200);
      await boot('&continue=1&give=all');
      // The reloaded page's oracle starts empty: give it what was said / killed before the load (its premises).
      await ev((o) => { const O = window.__O; if (!O) return; O.said.push(...o.said); for (const [k, v] of Object.entries(o.died)) O.died[k] = (O.died[k] ?? 0) + v; }, { said: oracleA.said, died: oracleA.died });
      await wait(2500);
      { const d = await dbg(); if (d.restoredFrom !== 'cp2_escort') bad(`walk B: loaded ${d.restoredFrom}, expected cp2_escort`); }
      await ammo();
      await walkBelt({ side: 'west', sprint: true, jump: false, label: 'walk B (west guard, sprinting, after loading cp2_escort)' });
      { const o2 = await O(); if (o2.minTunnelX < 3.7 || o2.maxTunnelX > 6.3) bad(`walk B: the player left the belt inside the tunnel (x ${o2.minTunnelX.toFixed(2)} … ${o2.maxTunnelX.toFixed(2)})`); }
      // Only Unit 32 is shot here; nothing else is touched until the core door is checked.
      console.log('  unit 32:', JSON.stringify(await shootGroup(['g2_unit32'], 8)));
      await beatIn('#unit32_dead', 15);
    }
    await say('unit 32');
    await ammo();

    // ── the supervisor: straight at the core door; then Unit 14 on sight; the core without listening ──
    await noForemanYet('impatient, before the trigger');
    await tp(-3, 0, -62, 0); await beatIn('l2_foreman', 8);
    await stage('the supervisor', () => window.__game.enemies.all.some((e) => e.type === 'foreman' && e.alive), 15, 'the supervisor arriving');
    await fireAt(-3.5, 2.2, -66.5, 4);
    for (let i = 0; i < 8; i++) {
      await ev(() => { const g = window.__game; const V = g.player.position.constructor; for (const e of [...g.enemies.all]) { if (e.type !== 'foreman' || !e.alive) continue; for (const part of ['head_a', 'head_b', 'head_c']) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part }, 400, new V(0, 0, -1)); } });
      await killAwake('supervisor'); await wait(500);
      if (await hasBeat('#foreman_dead')) break;
    }
    await beatIn('#foreman_dead', 40);
    await coreOpensUnaided('impatient, after the supervisor');
    console.log('  unit 14:', JSON.stringify(await shootGroup(['g2_unit14'], 8)));
    await wait(600); await killAwake('unit 14');
    // REVISION 6.1 — the core: sprint in (real movement) straight to the STOP plate, shoot the pedestal and a cell
    // on the way (nothing breaks, nothing is a control), press the plate the moment it is live, hold.
    { const o = await O(); const b = o.said.filter((id) => /^l2_choir_core_[2-8]/.test(id)); console.log(`  approach monologue heard before entering: ${b.join(', ') || 'none'}`); }
    await tp(0, 0, -71.3, 0); await look(0); await move(1, 0, true);
    await beatIn('l2_core', 5);
    const tEnter = (await dbg()).now;
    { // run at the plate: steer every 100 ms
      const end = Date.now() + 6000;
      while (Date.now() < end) {
        const d = await ev(() => { const g = window.__game; const p = g.player.position; const dx = -4.5 - p.x, dz = -80 - p.z; g.player.yaw = Math.atan2(-dx, -dz); return Math.hypot(dx, dz); });
        if (d < 0.35) break;
        await wait(60);
      }
      await move(0); await look(90, -12); await wait(150);
      const d = await dbg(); console.log(`  sprinted to the STOP plate in ${(d.now - tEnter).toFixed(1)} s; scanners live: ${d.core.live}`);
    }
    await fireAt(0, 1.2, -79.4, 2);                                // the pedestal: nothing breaks
    await fireAt(-4.6, 2.0, -83.2, 1);                             // a cell: nothing breaks
    { const en = await ev(() => window.__game.interactables.all.filter((i) => ['core_cells', 'core_pedestal'].includes(i.id)).length); if (en) bad('the cells / the pedestal are interactable'); }
    // A press before the scanners are live does nothing (the plate is on STANDBY: a real state, shown).
    { const live = await ev(() => window.__game.interactables.get('core_shutdown')?.enabled); if (!live) { const r = await use('core_shutdown'); if (r === 'ok') bad('the plate could be used before it was live'); } }
    await stage('scanners live', () => window.__game.interactables.get('core_shutdown')?.enabled, 9, 'the scanners going live');
    { const d = await dbg(); const dt = d.t.core_live - d.t.l2_core; console.log(`  scanners live ${dt.toFixed(2)} s after entering`); if (!(dt <= 8.05)) bad(`scanners went live ${dt.toFixed(2)} s after t2_core (≤ 8)`); }
    await look(90, -12); await wait(120);
    const tLive = (await dbg()).t.core_live;
    console.log('  core_shutdown:', await use('core_shutdown'));
    { const d = await dbg(); console.log(`  pressed ${(d.now - tLive).toFixed(2)} s after the scanners went live`); if (d.now - tLive > 2) notes.push(`impatient: the press came ${(d.now - tLive).toFixed(2)} s after the scanners went live (wanted ≤ 2 s)`); if (!d.core.scanning) bad(`the scan did not start (${JSON.stringify(d.core)})`); }
    await beatIn('l2_choice_shutdown', 5);
    { const d = await dbg(); const took = d.t.l2_choice_shutdown - tLive; console.log(`  chose ${took.toFixed(2)} s after the scanners went live, ${(d.t.l2_choice_shutdown - d.t.l2_core).toFixed(2)} s after entering`); }
    await stage('lift', () => window.__game.interactables.get('lift_button')?.enabled, 60, 'the lift button');
    await tp(0, 0, -90.5, 0); await wait(400);
    console.log('  lift:', await use('lift_button'));
    await beatIn('l2_end', 10);
    await page.waitForFunction(() => window.__game.state === 'ended', null, { timeout: 60000 }).catch(() => bad('never reached state "ended"'));
    await wait(1500);
    const end = await ev(() => ({ state: window.__game.state, beats: window.__game.story.debugState.beats.filter((b) => !b.startsWith('#')), flags: window.__game.story.debugState.flags,
      text: document.querySelector('.cb')?.innerText?.replace(/\s+/g, ' ').slice(0, 900) ?? '' }));
    console.log('  ending text:', end.text);
    if (end.state !== 'ended') bad('the impatient run did not end');
    if (/thirty-two/i.test(end.text)) bad('the ending card claims thirty-two units after the player shot them');
    checkOrder(end.beats, 'shutdown', ORDER.filter((b) => !['l2_fit_fight', 'l2_rig'].includes(b)));
    console.log('  beats:', end.beats.join(' → '));

    // ── the oracle's verdict ──
    const o = await O();
    // The page was reloaded once (cp2_escort): what the oracle judged before the load counts too.
    if (oracleA) { o.lines = [...oracleA.lines, ...o.lines]; o.viol = [...oracleA.viol, ...o.viol]; o.said = [...oracleA.said, ...o.said]; o.noOracle = [...new Set([...oracleA.noOracle, ...o.noOracle])]; o.softLocks = [...(oracleA.softLocks ?? []), ...(o.softLocks ?? [])]; o.foremanEarly ||= oracleA.foremanEarly; o.unit32Early ||= oracleA.unit32Early; }
    for (const x of o.softLocks ?? []) bad(`SOFT-LOCK oracle: ${JSON.stringify(x)}`);
    const rep = await lineReport('impatient');
    console.log(`\n  ORACLE: ${o.lines.length} story lines spoken, ${o.lines.filter((l) => l.ok).length} true when spoken, ${o.viol.length} false; ${o.noOracle.length} unconditional ids without an oracle`);
    console.log('    unconditional:', o.noOracle.join(', '));
    for (const v of o.viol) bad(`line spoken while false: ${v.id} "${v.text}" @${v.t}s in ${v.room} ${JSON.stringify(v.pos)} (${v.why})`);
    if (o.foremanEarly) bad('R4: the supervisor group existed before l2_foreman');
    if (o.unit32Early) bad('R4: Unit 32 existed before the ride was over');
    // Lines that must NOT have been said in this run (their premise was destroyed by the player).
    const never = { l2_choir_dock: 'the dock unit was shot on sight', l2_tomas_stealth_1: 'the treadmill units were shot', l2_tomas_fit_fight: 'the alcove units were dead', l2_tomas_pass_taken: 'the alcove units were dead',
      l2_choir_core_7: 'four or more units were destroyed', l2_unit14_wait: 'Unit 14 was shot down', l2_tomas_bark_belt: 'the line was removed' };
    for (const [id, why] of Object.entries(never)) if (o.said.includes(id)) bad(`${id} was said although ${why}`);
    for (const id of REMOVED) if (o.said.includes(id)) bad(`removed line ${id} was spoken`);
    // REVISION 6.1: a clean ending — after the completed scan nothing that was queued before it plays: only the
    // count, the unit(s) and the lift speak.
    { const d = await dbg(); const tc = d.t.l2_choice_shutdown;
      const after = (await ev(() => (window.__game.story.lineLog ?? []).filter((l) => l.said).map((l) => ({ id: l.said, t: l.t })))).filter((l) => l.t > tc + 0.02).map((l) => l.id);
      console.log('  lines after the completed scan:', after.join(' → '));
      const ok = /^l2_(choir_shutdown_[123]|unit_lift|unit14_die|choir_unit14_shot)$/;
      const stray = after.filter((id) => !ok.test(id));
      if (stray.length) bad(`lines queued before the scan played after it: ${stray}`);
      if (!['l2_choir_shutdown_1', 'l2_choir_shutdown_2', 'l2_choir_shutdown_3'].every((id) => after.includes(id))) bad(`the count was not spoken after the scan (${after})`);
      const inRoomBefore = o.said.filter((id) => ENTRY.includes(id));
      console.log(`  offer lines heard before the scan: ${inRoomBefore.join(', ') || 'none'}`); }
    await noRemovedIds('impatient');
    void rep;
    await clearL2();
    await browser.close();
    if (notes.length) console.log(`\nNOTES:\n - ${[...new Set(notes)].join('\n - ')}`);
    console.log(problems.length ? `\nFAILED:\n - ${problems.join('\n - ')}` : '\nLEVEL2 IMPATIENT OK');
    process.exit(problems.length ? 1 : 0);
  }
}
