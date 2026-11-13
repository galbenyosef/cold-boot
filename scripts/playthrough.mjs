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
//                                                     REVISION 4, level 2 "LINE TWO": boots ?level=2, drives the
//                                                     level end to end once per ending, asserts the beats
//                                                     happened in order; prints LEVEL2 OK.
//   node scripts/playthrough.mjs [baseUrl] --level2 --checkpoints [--cp=cp2_relay]
//                                                     for each cp2_* checkpoint: play to it, die, load, assert
//                                                     the restored world, play on to an ending. LEVEL2 CHECKPOINTS OK.
//
// Per step it prints state / objective / room / enemies / fps / draw calls. Exit 1 on failure.
// The run "hurries" the story's quiet windows (story.hurry()) so it does not sit through every pause.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const SCARES = argv.includes('--scares');
const CHECKPOINTS = argv.includes('--checkpoints');
const ONLY_CP = argv.find((a) => a.startsWith('--cp='))?.slice(5) ?? null;
const LEVEL2 = argv.includes('--level2');
const SAVE_KEY = LEVEL2 ? 'coldboot.save.l2.v1' : 'coldboot.save.v1';
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
// Event log from the very first frame (a checkpoint load fast-forwards before `ready` is visible to us).
await page.addInitScript(() => {
  let game;
  window.__log = { beats: [], subs: [], toasts: [], woke: [], spawned: [], pickups: [] };
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
        g.events.on('story:subtitle', (e) => L.subs.push(`${e.speaker}: ${e.text}`));
        g.events.on('story:toast', (e) => L.toasts.push(e.text));
        g.events.on('pickup', (e) => L.pickups.push(e.kind));
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
  for (let i = 0; ; i++) {
    try { await page.goto(url); break; } catch (e) { if (i >= 2) throw e; await page.waitForTimeout(700); }
  }
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
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
  const blob = { v: 1, id: 'cp_armed', place: 'SECURITY 3', player: { position: [-8, 0, -19.6], yaw: 0, health: 50, weapons: { pistol: { owned: true, clip: 5, reserve: 7 }, shotgun: { owned: false, clip: 0, reserve: 0 } }, current: 'pistol', keys: [], flashlight: false, pickups: ['p_pistol'] },
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
  for (const [name, raw] of [['garbage', '{not json'], ['other version', JSON.stringify({ ...blob, v: 99 })], ['wrong shape', JSON.stringify({ v: 1, id: 'cp_key' })]]) {
    await ev(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, raw]);
    await boot('&continue=1');
    await wait(600);
    r = await ev((k) => ({ from: window.__game.story.debugState.restoredFrom, z: window.__game.player.position.z, kept: !!localStorage.getItem(k), state: window.__game.state }), SAVE_KEY);
    console.log(`  ${name.padEnd(21)} →`, JSON.stringify(r));
    if (r.from || r.kept || r.state !== 'playing' || r.z < 0) problems.push(`${name} save must be discarded and the game start fresh: ${JSON.stringify(r)}`);
  }
}

await browser.close();
console.log('\nMATRIX:');
for (const r of results) console.log(`  ${r.cp.padEnd(11)} restored ${r.restored ? 'OK  ' : 'FAIL'}  reached ending ${r.ended ? 'YES' : 'NO '}`);
if (notes.length) console.log(`\nNOTES:\n - ${[...new Set(notes)].join('\n - ')}`);
console.log(problems.length ? `\nFAILED:\n - ${problems.join('\n - ')}` : '\nCHECKPOINTS OK');
process.exit(problems.length ? 1 : 0);

// ───────────────────────────────────────────────────────────────────────── --level2 (REVISION 4)
async function runLevel2() {
  mkdirSync('shots/l2', { recursive: true });
  const ENDINGS = argv.find((a) => a.startsWith('--ending='))?.slice(9).split(',') ?? ['shutdown', 'rewrite'];
  const CP2 = ['cp2_start', 'cp2_hall', 'cp2_pass', 'cp2_relay', 'cp2_apron', 'cp2_foreman', 'cp2_core'];
  const ORDER = ['l2_arrive', 'l2_dock', 'l2_intake', 'l2_hall_reveal', 'l2_tomas_seen', 'l2_intercom', 'l2_guided', 'l2_rig', 'l2_pass',
    'l2_fit_fight', 'l2_hall_cross', 'l2_relay_enter', 'l2_power', 'l2_run', 'l2_window', 'l2_booth_empty', 'l2_loaded', 'l2_tunnel',
    'l2_apron', 'l2_unit32', 'l2_foreman', 'l2_core'];
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
  const waitFlag = async (fn, label, seconds = 30) => {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) { if (await ev(fn)) return true; await hurry(); await wait(250); }
    bad(`${label} did not happen (${seconds}s)`);
    return false;
  };
  const feat2 = async () => ev(() => {
    const g = window.__game;
    return {
      level: g.levelId, rooms: g.level.rooms.map((r) => r.id).join(','), doors: g.level.doors.map((d) => d.id).join(','),
      groups: [...new Set(g.level.enemySpawns.map((s) => s.group))].join(','),
      say: typeof g.audio.say === 'function', actor: typeof g.enemies.actor === 'function', carry: typeof g.player.setCarry === 'function',
      ints: g.interactables.all.map((i) => i.id).join(','),
    };
  });
  const clearL2 = () => ev(() => { for (const k of ['coldboot.save.l2.v1', 'coldboot.carry', 'coldboot.level']) localStorage.removeItem(k); });

  // ── segments (each ends just after one checkpoint) ──
  async function s2Start() {
    await fastTalk(); await wait(800);
    await info('01-cab', (s) => (!s.beats.includes('l2_arrive') ? 'l2_arrive missing' : lockedHas(s, 'd2_cab') ? 'd2_cab still locked after arrival'
      : !lockedHas(s, 'd2_core') || !lockedHas(s, 'd2_relay') || !lockedHas(s, 'd2_lift') ? `core / relay / lift should start locked (${s.locked})` : null));
    const w = await ev(() => Object.entries(window.__game.player.weapons).map(([k, w]) => [k, w.owned]));
    if (!w.some((x) => x[1])) bad('no weapon at the start of level 2');
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
  async function s2Pass() {
    await tp(-7, 0, -46, 90); await waitBeat('l2_tomas_seen', 20); await waitBeat('#booth_write_2', 25);
    if (!fast) await shot('05-tomas');
    { const d = await dbg(); if (!d.tomas) notes.push('no Tomas actor (enemies.actor("human") unavailable)'); }
    console.log('  intercom:', await use('intercom_hall'));
    await waitBeat('l2_intercom', 12); await waitBeat('#first_talk_over', 60);
    await info('06-intercom', (s) => (/pass/i.test(s.objective) ? null : `objective "${s.objective}"`));
    await tp(0, 0, -34, -90); await waitBeat('l2_guided', 10);
    await tp(11.6, 0, -34, -90); await waitBeat('#fit_stealth', 15); await wait(800);
    await info('07-fitting', (s) => (s.active > 0 ? 'treadmill units turned hostile on entry' : null));
    if (await goTo('tag2_rig', [14, -34])) { await waitBeat('l2_rig', 10); await read('tag2_rig'); await waitBeat('#rig_read', 10); }
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
  async function s2Apron() {
    if (!(await goTo('relay_switch', [13, -61]))) notes.push('relay_switch missing');
    const before = await status();
    if (!lockedHas(before, 'd2_spine') || !lockedHas(before, 'd2_booth')) bad(`spine / booth doors should be locked before Section C (${before.locked})`);
    console.log('  switch:', await use('relay_switch'));
    await waitBeat('l2_power', 8); await waitBeat('#line_running', 25); await wait(2500);
    console.log('  killed', await killAll());
    await waitBeat('l2_run', 40);
    await info('10-power', (s) => (lockedHas(s, 'd2_spine') || lockedHas(s, 'd2_bulkhead_s') ? 'spine not open after Section C' : !lockedHas(s, 'd2_booth') ? 'the booth door must stay shut for the player until he is gone' : null));
    if (!fast) await shot('10-line-running');
    // He is taken only once the player is in the spine — however long that takes.
    await wait(1500);
    { const d = await dbg(); if (d.unitsInside || d.windowStarted) bad('the units went in before the player reached the spine'); }
    await tp(-19, 0, -62, 0); await waitFlag(() => window.__game.story.debugState.unitsInside, 'units entering the booth', 15);
    await wait(1500); await killAll();
    await tp(-18.4, 0, -48.4, -90); await waitBeat('l2_window', 60);
    await wait(2500); if (!fast) await shot('11-window');
    await info('11-window', (s) => (!lockedHas(s, 'd2_bulkhead_n') ? 'd2_bulkhead_n must be locked behind the units' : !lockedHas(s, 'd2_booth') ? 'player could walk into the booth during the window scene' : null));
    await waitBeat('#booth_open', 90);
    await tp(-14, 0, -46, -90); await waitBeat('l2_booth_empty', 10); await waitBeat('l2_loaded', 30); await waitBeat('#booth_hall_open', 10);
    if (!fast) { await shot('12-booth-empty'); await readIf('booth_headset', [-14, -46]); await readIf('term2_booth', [-14, -46]); }
    await info('12-booth', (s) => (lockedHas(s, 'd2_booth_hall') ? 'd2_booth_hall did not open' : /line/i.test(s.objective) ? null : `objective "${s.objective}"`));
    // Onto the belt, through the tunnel behind him.
    await tp(5, 1.2, -46, 180); await wait(1500);
    { const z = await ev(() => window.__game.player.position.z); console.log('  belt carried the player to z =', z.toFixed(2)); if (z > -46.5) notes.push('the belt did not carry the player (t2_belt / setCarry not there yet?)'); }
    await tp(5, 1.2, -51.5, 180); await waitBeat('l2_tunnel', 10); if (!fast) await shot('13-tunnel');
    await tp(5, 1.2, -56.5, 180); await wait(1200);
    await tp(5, 0.5, -64, 180); await waitBeat('l2_apron', 10);
    await info('13-apron', (s) => (s.beats.includes('l2_unit32') ? 'Unit 32 came before the apron checkpoint' : null));
    return waitCheckpoint('cp2_apron', 30);
  }
  async function s2Foreman() {
    await waitBeat('l2_unit32', 40);
    await waitFlag(() => window.__game.enemies.all.some((e) => e.group === 'g2_unit32' && e.alive), 'Unit 32 spawning', 10);
    await wait(2500); if (!fast) await shot('14-unit32');
    { const subs = await ev(() => window.__log.subs); if (!subs.some((t) => /canteen coffee/.test(t) && /UNIT 32/.test(t))) bad('Unit 32 did not say the joke'); }
    console.log('  killed', await killAll());
    await waitBeat('#unit32_dead', 20);
    return waitCheckpoint('cp2_foreman', 40);
  }
  async function s2Core(shoot14) {
    await tp(0, 0, -67.5, 0); await waitBeat('l2_foreman', 10);
    await info('15-foreman', (s) => (!lockedHas(s, 'd2_core') ? 'd2_core open before the foreman is dead' : null));
    await wait(4000); if (!fast) await shot('15-foreman');
    for (let i = 0; i < 4; i++) {
      await ev(() => {
        const g = window.__game; const V = g.player.position.constructor;
        for (const e of [...g.enemies.all]) {
          if (e.type !== 'foreman' || !e.alive) continue;
          for (const part of ['head_a', 'head_b', 'head_c']) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part }, 400, new V(0, 0, -1));
        }
      });
      await killAll(); await wait(600);
    }
    await waitBeat('#foreman_dead', 40);
    await wait(800);
    const u14 = await ev(() => { const e = window.__game.enemies.all.find((x) => x.group === 'g2_unit14'); return e ? { state: e.state, alive: e.alive } : null; });
    console.log('  unit 14:', JSON.stringify(u14));
    if (!u14) notes.push('g2_unit14 did not spawn (level spawn missing?)');
    else if (u14.state !== 'dormant') bad(`Unit 14 should stand dormant, is ${u14.state}`);
    if (shoot14 && u14) {
      await ev(() => { const g = window.__game; const V = g.player.position.constructor; const e = g.enemies.all.find((x) => x.group === 'g2_unit14'); g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 3, part: 'torso' }, 8, new V(0, 0, -1)); });
      await waitBeat('#unit14_shot', 8);
      // Shot, it wakes (as designed). The run goes on with it put down, so the core checkpoint can be taken.
      await wait(1200); console.log('  killed', await killAll()); await waitBeat('#unit14_dead', 8);
    }
    await info('16-core-door', (s) => (lockedHas(s, 'd2_core') ? 'd2_core still locked after the foreman' : null));
    await tp(0, 0, -75, 0); await waitBeat('l2_core', 10);
    return waitCheckpoint('cp2_core', 40);
  }
  async function s2End(choice) {
    await waitBeat('#core_offered', 120);
    if (!fast) { await shot('17-core'); await readIf('term2_core', [0, -78]); }
    await wait(500);
    const en = await ev(() => ['core_shutdown', 'core_rewrite'].map((id) => window.__game.interactables.get(id)?.enabled ?? null));
    if (en.includes(false)) bad(`both choices must be live at once (${en})`);
    if (en.includes(null)) notes.push('core_shutdown / core_rewrite interactable missing');
    await info('17-core', (s) => (!lockedHas(s, 'd2_lift') ? 'd2_lift open before a choice' : /cells/i.test(s.objective) ? null : `objective "${s.objective}"`));
    const id = `core_${choice}`;
    console.log(`  ${id}:`, await use(id));
    await waitBeat(`l2_choice_${choice}`, 10);
    { const other = await use(choice === 'shutdown' ? 'core_rewrite' : 'core_shutdown'); if (other === 'ok') bad('the second choice was still usable'); }
    await waitFlag(() => !window.__game.level.door('d2_lift').locked, 'd2_lift unlocking', 60);
    if (!fast) await shot(`18-${choice}`);
    await tp(0, 0, -90.5, 0); await wait(600);
    console.log('  lift:', await use('lift_button'));
    await waitBeat('l2_end', 15);
    await page.waitForFunction(() => window.__game.state === 'ended', null, { timeout: 60000 }).catch(() => bad('never reached state "ended"'));
    await wait(fast ? 1500 : 5000);
    await shot(`19-end-${choice}`);
    const end = await ev(() => ({ state: window.__game.state, save: localStorage.getItem('coldboot.save.l2.v1'), level: localStorage.getItem('coldboot.level'), beats: window.__game.story.debugState.beats.filter((b) => !b.startsWith('#')),
      text: document.querySelector('.cb')?.innerText?.replace(/\s+/g, ' ').slice(0, 1200) ?? '' }));
    console.log('  ending text:', end.text);
    if (end.save) bad('the level-2 checkpoint was not cleared by the ending');
    if (end.level !== '2') bad(`stored level after finishing level 2 is ${end.level}, expected 2`);
    if (!/TO BE CONTINUED/i.test(end.text)) notes.push('ending text "TO BE CONTINUED" not found in the DOM');
    return end;
  }
  const checkOrder = (beats, choice) => {
    const want = [...ORDER, `l2_choice_${choice}`, 'l2_end'];
    let at = -1;
    for (const b of want) {
      const i = beats.indexOf(b);
      if (i < 0) { bad(`beat ${b} never happened`); continue; }
      if (i < at) bad(`beat ${b} happened out of order`);
      at = Math.max(at, i);
    }
    if (beats.includes(choice === 'shutdown' ? 'l2_choice_rewrite' : 'l2_choice_shutdown')) bad('both choices were recorded');
  };
  const SEG2 = [s2Start, s2Hall, s2Pass, s2Relay, s2Apron, s2Foreman, s2Core];

  await boot(); await clearL2(); await boot();
  const f2 = await feat2();
  console.log('features:', JSON.stringify(f2));
  if (f2.level !== 2) { console.log('FAILED: ?level=2 did not boot level 2'); await browser.close(); process.exit(1); }

  if (!CHECKPOINTS) {
    for (const choice of ENDINGS) {
      console.log(`\n══════════ level 2 → ${choice} ══════════`);
      await clearL2(); await boot();
      for (const seg of SEG2) await seg(choice === 'rewrite');
      const end = await s2End(choice);
      checkOrder(end.beats, choice);
      console.log('  beats:', end.beats.join(' → '));
    }
    // ?nostory=1: no beats, every door unlocked.
    await clearL2(); await boot('&nostory=1'); await wait(800);
    { const s = await status(); console.log('[nostory]', JSON.stringify({ locked: s.locked, beats: s.beats })); if (s.locked) bad(`?nostory=1 left doors locked: ${s.locked}`); if (s.beats.length) bad('?nostory=1 ran beats'); }
    // Level 1 → level 2 hand-over: stored level, carried loadout.
    await clearL2(); await boot('&level=1&handoff=1'); await wait(500);
    await ev(() => { const g = window.__game; g.player.give('pistol', 12); g.player.give('ammo_pistol', 7); g.story.handoff(); });
    const ho = await ev(() => ({ level: localStorage.getItem('coldboot.level'), carry: JSON.parse(localStorage.getItem('coldboot.carry') ?? 'null'), l1: localStorage.getItem('coldboot.save.v1') }));
    console.log('[handoff]', JSON.stringify(ho));
    if (ho.level !== '2' || !ho.carry?.weapons?.pistol?.owned || ho.l1) bad(`hand-over did not store level 2 + loadout / clear the level-1 save: ${JSON.stringify(ho)}`);
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
  const world2 = () => ev(() => {
    const g = window.__game; const p = g.player; const d = g.story.debugState;
    const groups = {};
    for (const e of g.enemies.all) groups[e.group] = (groups[e.group] ?? 0) + 1;
    return {
      state: g.state, pos: [p.position.x, p.position.y, p.position.z].map((v) => +v.toFixed(2)), health: Math.round(p.health),
      weapons: Object.fromEntries(Object.entries(p.weapons).map(([k, w]) => [k, [w.owned, w.clip, w.reserve]])), keys: [...p.keys].sort(),
      locked: g.level.doors.filter((x) => x.locked).map((x) => x.id).sort().join(','), groups, active: g.enemies.activeCount,
      beats: d.beats, flags: d.flags, restoredFrom: d.restoredFrom, cleared: d.cleared, objective: g.story.objective, logs: [...g.story.logs].sort(),
      tomas: !!d.tomas,
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
    await wait(300);
    const want = await world2();
    await ev(() => { const g = window.__game; g.debug.god = false; g.player.damage(9999); });
    await page.waitForFunction(() => window.__game.state === 'dead', null, { timeout: 5000 }).catch(() => bad(`${cp}: player did not die`));
    await wait(1500);
    await boot('&continue=1'); await wait(3000);
    await page.screenshot({ path: `shots/l2/${cp}-restored.png` });
    await fastTalk();
    const got = await world2();
    const log = await ev(() => window.__log);
    console.log('  after:', JSON.stringify({ pos: got.pos, health: got.health, keys: got.keys, locked: got.locked, groups: got.groups, objective: got.objective, tomas: got.tomas }));
    if (got.state !== 'playing') bad(`${cp}: state after load is ${got.state}`);
    if (got.restoredFrom !== cp) bad(`${cp}: restoredFrom = ${got.restoredFrom}`);
    const sp = saved.player.position;
    if (Math.hypot(got.pos[0] - sp[0], got.pos[2] - sp[2]) > 0.8) bad(`${cp}: player position ${got.pos} ≠ saved ${sp}`);
    for (const k of ['health', 'weapons', 'keys', 'locked', 'objective', 'logs']) if (!same(got[k], want[k])) bad(`${cp}: ${k} not restored: ${JSON.stringify(got[k])} ≠ ${JSON.stringify(want[k])}`);
    for (const k of Object.keys(want.flags)) if (got.flags[k] !== want.flags[k]) bad(`${cp}: flag ${k} = ${got.flags[k]}, was ${want.flags[k]}`);
    const lost = saved.story.beats.filter((b) => !got.beats.includes(b));
    if (lost.length) bad(`${cp}: beats lost by the load: ${lost}`);
    const replayed = log.beats.filter((b) => saved.story.beats.includes(b) && b !== 'l2_power');
    if (replayed.length) bad(`${cp}: beats replayed by the load: ${replayed}`);
    if (log.subs.length) bad(`${cp}: lines spoken right after the load: ${JSON.stringify(log.subs)}`);
    if (!log.toasts.includes('CHECKPOINT RESTORED')) bad(`${cp}: no CHECKPOINT RESTORED toast`);
    for (const g of want.cleared) if (got.groups[g]) bad(`${cp}: group ${g} is back`);
    if (got.active > 0) bad(`${cp}: ${got.active} enemies active right after the load`);
    if (idx <= 3 && !got.tomas && want.tomas) bad(`${cp}: Tomas is not in the booth after the load`);
    if (idx >= 4 && got.tomas) bad(`${cp}: Tomas is back in the booth`);
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
}
