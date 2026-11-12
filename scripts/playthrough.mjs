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
// Per step it prints state / objective / room / enemies / fps / draw calls. Exit 1 on failure.
// The run "hurries" the story's quiet windows (story.hurry()) so it does not sit through every pause.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const SCARES = argv.includes('--scares');
const CHECKPOINTS = argv.includes('--checkpoints');
const ONLY_CP = argv.find((a) => a.startsWith('--cp='))?.slice(5) ?? null;
const SAVE_KEY = 'coldboot.save.v1';
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
  await page.goto(`${base}/?autostart=1&god=1${query}`);
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
if (!FULL) notes.push('level/enemies revision 2 not fully present — fallback paths were exercised');

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
