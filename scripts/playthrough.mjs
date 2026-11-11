// Scripted end-to-end run of the REVISION 2 story flow (teleports + API calls, god mode).
//
//   node scripts/playthrough.mjs [baseUrl]            full flow; asserts key state changes; prints
//                                                     PLAYTHROUGH OK; screenshots → shots/pt-*.png
//   node scripts/playthrough.mjs [baseUrl] --scares   fires every vignette id and every actor scare in
//                                                     place and screenshots each → shots/scares/*.png
//
// Per step it prints state / objective / room / enemies / fps / draw calls. Exit 1 on failure.
// The run "hurries" the story's quiet windows (story.hurry()) so it does not sit through every pause.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const SCARES = argv.includes('--scares');
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
await page.goto(`${base}/?autostart=1&god=1`);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });

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
  window.__woke = [];
  window.__spawned = [];
  const group = (id) => g.enemies.all.find((e) => e.id === id)?.group ?? '?';
  g.events.on('enemy:woke', (e) => window.__woke.push({ type: e.type, group: group(e.id) }));
  // The group is resolved a moment later (the enemy is not in `all` yet while the event fires).
  g.events.on('enemy:spawned', (e) => { const r = { type: e.type, group: '?', t: g.time }; window.__spawned.push(r); setTimeout(() => { r.group = group(e.id); }, 100); });
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
const skitters = () => ev(() => window.__game.enemies.all.filter((e) => e.type === 'skitter' && e.alive && e.state !== 'dormant').length);
const lockedHas = (s, id) => s.locked.split(',').includes(id);

// 1 — medical: nothing but the room.
await wait(2500);
await step('01-med', (s) => {
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
await waitBeat('#med_monitor_spike', 25);
await tp(-0.2, 0, 3.2, 0); await waitBeat('#med_arm_drop', 25); await step('02-med-arm');
await tp(1.4, 0, 1.2, 0); await read('log_med');
await waitBeat('#pa_wake', 15); await wait(2500); await step('03-pa-wake');

// 2 — corridor: lights chase + silhouette, only while facing the junction end.
await tp(0, 0, -3, 180); await hurry(); await wait(1500);
{
  const b = await ev(() => window.__game.story.debugState.beats);
  if (b.includes('corr_first_dark')) problems.push('corridor scare fired while the player faced away');
}
await tp(0, 0, -3, 0); await waitBeat('corr_first_dark', 25); await wait(2600);
await step('04-corridor', (s) => (feat.actor && s.actors < 1 ? 'no silhouette actor during the lights chase' : null));
await wait(6500);
await step('05-corridor-after', (s) => (s.actors > 0 && !feat.quarters ? 'silhouette actor was not removed' : null));

// 3 — quarters (optional room).
if (feat.quarters) {
  await tp(-3, 0, -6.5, -90); await waitBeat('quarters', 10); await wait(800);
  // The figure in the canteen corner: look at it, look away, look back — it must be gone.
  await tp(-4, 0, -6.5, 51.6); await wait(1600);
  await step('06-quarters-figure', (s) => (feat.actor && s.actors < 1 ? 'no figure in the canteen corner' : null));
  await tp(-4, 0, -6.5, -120); await wait(700);
  await tp(-4, 0, -6.5, 51.6); await wait(600);
  await step('06b-quarters-figure-gone', (s) => (s.actors > 0 ? 'the figure was not removed while off-screen' : !s.beats.includes('#quarters_figure') ? 'quarters_figure cue not recorded' : null));
  const figAt = await ev(() => { const g = window.__game; const i = g.interactables.get('note_quarters_badges'); return i ? [i.position.x, i.position.z] : null; });
  console.log('  badges note at', JSON.stringify(figAt));
  await read('note_quarters_badges', { optional: true });
  await waitBeat('#quarters_locker_bang', 60); await wait(1800); await step('07-quarters-locker');
  await read('note_quarters_bunk', { optional: true });
  await waitBeat('#quarters_curtain', 90); await wait(1500); await step('08-quarters-curtain');
} else console.log('  (no quarters room in this level build — skipped)');

// 4 — junction: the hold.
await tp(0, 0, -18.6, 0); await wait(900); console.log('  fab door:', await use('door_d_fab_outer')); await wait(700);
await step('09-junction-hold', (s) => {
  if (!lockedHas(s, 'd_fab_outer')) return 'd_fab_outer should be locked before the console';
  if (!/Security 3/.test(s.objective)) return `objective "${s.objective}"`;
  if (s.active > 0) return 'something is already awake';
  return null;
});
await waitBeat('#pa_hold', 20); await wait(7500);

// 5 — security: tablet, console, pistol, vent.
await tp(-6.6, 0, -14.6, 0); await wait(800); await read('log_sec');
await tp(-8.8, 0, -17, 90); await wait(600);
console.log('  console:', await use('term_sec_unlock')); await wait(500);
await step('10-console', (s) => (lockedHas(s, 'd_fab_outer') ? 'console did not release d_fab_outer' : !s.note ? 'console note did not open' : !/sidearm/.test(s.objective) ? `objective "${s.objective}"` : null));
await closeNote();
await tp(-8, 0, -19.6, 180); await wait(600);
console.log('  pistol:', await use('p_pistol')); await wait(800);
await waitBeat('armed', 6);
await step('11-armed', (s) => (s.active > 0 ? 'enemy active right after taking the pistol' : null));
await tp(-6.5, 0, -17, 90, 25);
await waitBeat('#sec_vent_drop', 20); await wait(2500);
await step('12-vent', (s) => (s.active > 0 ? 'the vent must stay empty' : null));
if ((await skitters()) > 0) problems.push('a skitter exists in Security');

// 6 — junction: FIRST ENEMY, the android that stands up.
await tp(-1.6, 0, -17, -90); await waitBeat('husk_wakes', 15); await wait(6500);
await step('13-husk-wakes', (s) => (s.active < 1 ? 'junction husk did not wake' : null));
{
  const woke = await ev(() => window.__woke);
  console.log('  woke so far:', JSON.stringify(woke));
  if (!woke.length || woke[0].type !== 'husk' || woke[0].group !== 'g_junction') problems.push(`first enemy should be the junction husk, got ${JSON.stringify(woke[0])}`);
}
console.log('  killed', await killAll()); await wait(1500);
await waitBeat('#pa_husk', 40); await wait(6500); await step('14-after-husk');

// 7 — storage (optional), airlock.
await tp(5, 0, -17, -90); await wait(800); await read('log_storage');
await waitBeat('#storage_canister', 25); await wait(1500); await step('15-storage', (s) => (s.active > 0 ? 'storage must have no enemies' : null));
await tp(0, 0, -22, 0); await waitBeat('#airlock_cycle', 15); await wait(2500); await step('16-airlock');

// 8 — the hall.
await tp(0, 0, -27.6, 0); await waitBeat('fab_reveal', 10); await wait(4000); await step('17-fab-reveal', (s) => (s.mood !== 'tension' ? `music mood ${s.mood}` : null));
await wait(16000); await step('18-fab-choir');
await tp(2.2, 0, -39.6, 180); await wait(500); await read('log_fab');
await tp(-1.2, 0, -37.2, 90); await waitBeat('fab_first_fight', 10); await wait(4500);
await step('19-fab-first', (s) => (s.active < 1 ? 'g_fab_first did not wake' : null));
console.log('  killed', await killAll()); await wait(1000);
{
  const n = await skitters(); const sp = await ev(() => window.__spawned.filter((e) => e.type === 'skitter'));
  if (FULL && (n > 0 || sp.length > 0)) problems.push(`skitter before the pump room (${n} alive, ${sp.length} spawned)`);
  else if (n > 0) notes.push(`old level build: ${n} skitter(s) in g_fab_first before the pump room`);
  await killAll();
}
await tp(0, 0, -48.5, 0); await wait(500); console.log('  lobby door:', await use('door_d_lobby')); await wait(800);

// 9 — gen: the breaker is locked out.
await tp(14, 0, -38, -90); await waitBeat('#gen_ripple', 20); await wait(1200);
const before = await step('20-gen', (s) => (feat.pump && !lockedHas(s, 'd_pump') ? 'd_pump unlocked before the tag was read' : null));
await ev(() => { const g = window.__game; const i = g.interactables.get('gen_lever'); const V = g.player.position.constructor; g.player.teleport(new V(i.position.x - 1.4, 0, i.position.z), -Math.PI / 2, 0); });
await wait(800);
console.log('  lever (no key):', await use('gen_lever')); await wait(700);
await step('21-lockout', (s) => {
  if (!s.note) return 'lock-out tag note did not open';
  if (!s.beats.includes('lockout_found')) return 'lockout_found not emitted';
  if (s.beats.includes('power_restored')) return 'lever threw without the key';
  if (feat.pump && lockedHas(s, 'd_pump')) return 'd_pump still locked after reading the tag';
  if (lockedHas(before, 'd_lobby') !== lockedHas(s, 'd_lobby')) return 'lobby lock changed';
  return null;
});
await closeNote();
console.log('  lever again (no key):', await use('gen_lever')); await wait(600);
await step('22-lever-no-key', (s) => (s.beats.includes('power_restored') ? 'lever threw without the key' : !lockedHas(s, 'd_lobby') ? 'd_lobby opened without power' : null));
await closeNote();

// 10 — pump room: first skitter, Hale, the key.
if (feat.pump) {
  await step('23-objective-key', (s) => (/key/i.test(s.objective) ? null : `objective "${s.objective}"`));
  await waitBeat('#pa_lockout', 25); await wait(7000);
  await tp(6, 0, -38, 90); await wait(1500);
  await tp(-3, 0, -38, 90); await waitBeat('#fab_conveyor_step', 20, { optional: true }); await wait(1500); await step('24-fab-cross');
  await tp(-13.4, 0, -38, 90); await waitBeat('pump_enter', 10); await waitBeat('#pump_knock', 25); await wait(2000); await step('25-pump');
  if ((await ev(() => window.__spawned.filter((e) => e.type === 'skitter').length)) > 0) problems.push('skitter spawned before t_pump_deep');
  await tp(-18.5, 0, -38, 90); await waitBeat('pump_first_skitter', 10); await wait(3500);
  await step('26-pump-skitter', (s) => (s.alive < 1 ? 'g_pump_a did not spawn' : null));
  {
    const sp = await ev(() => window.__spawned.filter((e) => e.type === 'skitter'));
    console.log('  skitters spawned:', JSON.stringify(sp));
    if (!sp.length || sp[0].group !== 'g_pump_a') problems.push('first skitter should be g_pump_a');
  }
  console.log('  killed', await killAll()); await wait(800);
  await waitBeat('#pump_bubbles', 30); await wait(1500);
  const keyPos = await ev((id) => { const i = window.__game.interactables.get(id); return i ? [i.position.x, i.position.z] : null; }, feat.key);
  if (keyPos) { await tp(keyPos[0] + 1.0, 0, keyPos[1], 90, -40); await wait(800); }
  await read('log_pump', { optional: true });
  await step('27-hale');
  console.log('  key:', await use(feat.key)); await wait(600);
  await waitBeat('key_taken', 8); await wait(4500);
  await step('28-key-taken', (s) => (s.alive < 1 ? 'g_pump_b did not spawn' : !/breaker/i.test(s.objective) ? `objective "${s.objective}"` : null));
  console.log('  killed', await killAll()); await wait(800);
  await waitBeat('#pa_key', 30); await wait(6000);
  await tp(-8, 0, -38, -90); await waitBeat('fab_return', 10); await wait(5500);
  await step('29-fab-return', (s) => (s.active < 1 && feat.groups.includes('g_fab_return') ? 'g_fab_return did not wake/spawn' : null));
  if (!feat.groups.includes('g_fab_return')) notes.push('level has no g_fab_return group yet');
  console.log('  killed', await killAll()); await wait(800);
} else {
  console.log('  (no pump room in this level build — the story hands the key over after the tag)');
  await wait(4000);
  const k = await ev(() => window.__game.player.keys.size);
  if (!k) problems.push('fallback: key was not granted after the tag');
  await waitBeat('key_taken', 8);
  await tp(0, 0, -38, -90); await waitBeat('fab_return', 10); await wait(3000); await killAll();
}

// 11 — close the breaker.
await ev(() => { const g = window.__game; const i = g.interactables.get('gen_lever'); const V = g.player.position.constructor; g.player.teleport(new V(i.position.x - 1.4, 0, i.position.z), -Math.PI / 2, 0); });
await wait(1200);
await step('30-gen-key', (s) => (/breaker/i.test(s.objective) ? null : `objective "${s.objective}"`));
console.log('  lever (key):', await use('gen_lever')); await wait(2500);
await step('31-power', (s) => (s.beats.includes('power_restored') ? null : 'power_restored not emitted'));
await wait(4500);
console.log('  gen terminal:', await use('log_gen')); await wait(700);
await step('32-gen-terminal', (s) => (!s.note ? 'log_gen did not open after power' : s.beats.includes('fab_ambush') ? 'ambush did not wait for the terminal' : null));
await wait(3000); await closeNote();
await waitBeat('fab_ambush', 30, { noHurry: true });
await step('33-ambush-start', (s) => (lockedHas(s, 'd_lobby') || lockedHas(s, 'd_elev') ? 'lobby/elevator still locked after power' : null));
await tp(9, 0, -38, 90); await wait(11000);
await step('34-fab-ambush', (s) => (s.active >= 4 ? null : `expected rack husks + sentry active, got ${s.active}`));
console.log('  killed', await killAll());

// 12 — lobby, elevator, down.
await tp(0, 0, -51.5, 0); await waitBeat('#lobby_ambush', 10); await wait(5500);
await step('35-lobby', (s) => (s.active > 0 ? null : 'g_lobby did not wake'));
console.log('  killed', await killAll());
await read('note_lobby', { optional: true });
await tp(0, 0, -60.5, 0); await waitBeat('#elev_gate_rattle', 10); await wait(1500);
await step('36-elevator', (s) => (/elevator/i.test(s.objective) ? null : `objective "${s.objective}"`));
console.log('  button:', await use('elev_button')); await wait(6000);
await step('37-descent', (s) => (s.state === 'cutscene' ? null : 'descent cutscene not running: ' + s.state));
await page.waitForFunction(() => window.__game.state === 'ended', null, { timeout: 90000 }).catch(() => problems.push('never reached state "ended"'));
await wait(6000);
await step('38-end', (s) => (s.state === 'ended' ? null : 'not ended'));

await browser.close();
if (notes.length) console.log(`\nNOTES:\n - ${[...new Set(notes)].join('\n - ')}`);
console.log(problems.length ? `\nFAILED:\n - ${problems.join('\n - ')}` : '\nPLAYTHROUGH OK');
process.exit(problems.length ? 1 : 0);
