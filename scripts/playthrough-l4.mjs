// Scripted end-to-end run of level 4 "BIOLOGICAL SYSTEMS" (stage 3b, docs/plans/stage-3b.md §10.1). Task T.
//
//   node scripts/playthrough-l4.mjs [baseUrl] [--choice=stop,command] [--frames]
//        default — the level end to end once per carried choice: every beat in order, doors per phase (§3), decon
//        8.0 ± 0.2 s, shower ≤ 8 s, hold timings anchored to line ends (§4.3), the video log (gaps, `cut`), arm cycle
//        (§4.4), refusal → valve → equalising 25.0 ± 0.2 s → release (§4.5), F5 / F6 (§4.5–4.6), every `cp4_*` at its
//        moment, end card, carry (`from: 4`, armour, carbine, testHour, first-view flags), stored level stays 4.
//        LEVEL4 OK.
//   … --checkpoints [--cp=cp4_navy]   per `cp4_*`: play to it, die, load, compare the world (doors, phase, lights-out,
//        screens, groups, pickups, armour, weapons, flags, facts), finish. LEVEL4 CHECKPOINTS OK.
//   … --impatient   sprints / teleports, wrong order (surgical door first, booth before the plant, valve before the
//        booth, back to the shower), shoots every `mk4_glass` pane, every body, the dormant units; a test-side oracle
//        judges every spoken line from world state; choice variants. LEVEL4 IMPATIENT OK.
//   … --order [--variant=a,b,c,d,e]   §10.1 (a) east first, cold store first, no labs; (b) no optional rooms; (c) never
//        the carbine / vests; (d) valve before the booth; (e) booth refusal, guard-room notes, then the valve.
//        LEVEL4 ORDER OK.
//   … --softlock [--case=a,b,…,h]   §10.1 (a) 120 s in lock4 after the decon; (b) shower doorway during the latch;
//        (c) cold store during the ambush; (d) guard room during the holdout; (e) leave the plant room while
//        equalising, wait in chk; (f) gate-lock doorway during the latch; (g) into the gate lock with two units alive
//        behind; (h) into the bay / sterile store while open. Each reaches `l4_end`. LEVEL4 SOFTLOCK OK.
//   --frames   10 fps frame sequences of §10.5 → shots/l4/frames/ (with any mode; expensive).
//   all modes  spawn visibility (ray to each new member's chest; visible only through a door / grille / sump opened in
//        the last 3 s), every `mk4_` marker, never `state === 'cutscene'`, no enemy before its beat except the four
//        dormant ones, every timed line within 0.12 s of its cue (§8.12), static pass (every `l4_` id ↔ one RULES entry
//        ↔ manifest; choice pairs; no uppercase in a `unit` line).
//
// Run it on a static build (`vite build` + `vite preview`). Timing-sensitive steps wait IN THE PAGE on game state.
// Nothing here hangs on a missing piece: a preflight lists every missing hook / id, each segment names what it needs
// and is SKIPPED (a failure naming the missing thing) when any of it is absent; a segment that fails its exit
// condition breaks the route and the run goes straight to the end (`story.end()` as a last resort, itself a failure).
//
// ═════════════════════════════════════════════════════════════ HOOK CONTRACT (ST implements; [W4] = level side)
// Everything the playthrough reads beyond the engine's public API. On `window.__game.story`:
//  H1  end()                                  (K, exists) the stage end of §7.
//  H2  checkpoint(id)                         (K, exists) write `id` now from the current record (debug).
//  H3  fire(name) → truthy | null             §8.10: 'override' | 'lights_out' | 'armed' | 'equalise' | 'release' |
//                                             'tube_fight' run that beat as if its trigger happened (null = refused /
//                                             unknown); any level vignette id fires the vignette.
//  H4  hurry(fast?)                           (stage page, exists) shorten `wait`s (tests only; `hold`s untouched).
//  H5  lineLog: entries as stage/dialogue.ts (`t` = start on the script clock, `said`, `q`), PLUS for every line
//      spoken: `dur` (s, VoiceHandle.duration as played) and `end` (script clock when it ended or was stopped/cut);
//      and for every TIMED line (§4 tables, §4.4 arm cues, the video log's line-after-line gaps, scene cues) `cue` =
//      script-clock time of the beat / gesture / gap end it belongs to. §8.12: |t − cue| ≤ 0.12.
//  H6  rules: Record<lineId, { kind: 'U' | 'C', why: string, else?: string }> — the level's RULES table (one entry
//      per spoken `l4_` id of voice/lines.l4.json), read-only.
//  H7  debugState (getter), with at least:
//        level: 4; now: script clock (s, the clock of lineLog and `t`); beats: string[] (the record);
//        t: Record<string, number> — script time of: every beat id; `phase:<id>` each time a phase or variant is
//           applied (A B S C D D_bay D_store D2 E F_open F G); `vignette:<id>` each vignette the story fires
//           — the FIRST time of each key since the level loaded (never overwritten: D after D_bay keeps the first D);
//           (decon_cycle, shower_cycle, lights_out4, viv_vent, vent_s_a | vent_s_b, valve_open, plant_sump, gate_dogs);
//        phase (the record's phase), phaseApplied (last applied id incl. variants);
//        flags: { deconDone, showered, override, lightsOut, theatre, refused, armed, equalising, equalised, released,
//                 tubeFight, gateLock, video, roster } (§7 names);
//        checkpoints: string[] (written this run), checkpoint (last written id | null), restoredFrom, calm: boolean;
//        heard: string[]; missingMarkers: string[] (§8.10); failHold: number (s, as set on the arm);
//        loadout, arrival, ended (K, exist).
//  H8  beats emitted as `story:beat` AND kept in debugState.beats: l4_start, l4_decon_done, l4_shower, l4_clean,
//      l4_override, l4_lights_out, l4_theatre, l4_armed, l4_equalise, l4_tube_fight, l4_gatelock, l4_end (§4; no new
//      beat ids). Facts on `__game.facts` as soon as earned: l4_theatre, l4_video, l4_roster, l4_equalised (D24).
//  H9  objectives through `story:objective`, toasts through `story:toast` with the exact texts of §6.4.
//  [W4] level: rooms §2.1, doors §2.2 (ids), triggers §2.3, interactables / pickups §2.6 + §5.2 under their plan ids
//      (readables, `cold_ack`, `booth_release`, `valve4`), screens §6.4 under their plan names, markers of §8.10 with
//      `mk4_bodies.userData.list = [{ name, p: [x, y, z] | Vector3 }]` (10) and `mk4_glass.userData.panes` (6 ids),
//      `theatre_arm` (W9a API: userData.cycle, onCue), light groups `<room>` / `<room>_emerg` (§2.7).
// ═════════════════════════════════════════════════════════════
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const base = (argv.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const flagv = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const MODE = ['checkpoints', 'impatient', 'order', 'softlock'].find((m) => argv.includes(`--${m}`)) ?? 'default';
const ONLY_CP = flagv('cp');
const CHOICES = flagv('choice')?.split(',') ?? ['stop', 'command'];
const VARIANTS = flagv('variant')?.split(',') ?? ['a', 'b', 'c', 'd', 'e'];
const CASES = flagv('case')?.split(',') ?? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const FRAMES = argv.includes('--frames');
const SAVE_KEY = 'coldboot.save.l4.v2', SEEN_KEY = 'coldboot.seen.v1', CARRY_KEY = 'coldboot.carry.v2', LEVEL_KEY = 'coldboot.level';
const CPS = ['cp4_start', 'cp4_clean', 'cp4_cold', 'cp4_hold', 'cp4_lower', 'cp4_navy', 'cp4_armed'];
mkdirSync('shots/l4', { recursive: true });
if (FRAMES) mkdirSync('shots/l4/frames', { recursive: true });

// ───────────────────────────────────────────────────────────── the plan's ids
const LINES_JSON = JSON.parse(readFileSync('voice/lines.l4.json', 'utf8'));
const MANIFEST = JSON.parse(readFileSync('voice/manifest.json', 'utf8')).lines ?? {};
const LINES = Object.fromEntries(LINES_JSON.flatMap((l) => [[l.id, l.text], ['@' + l.id, l.speaker]]));
const DUR = Object.fromEntries(LINES_JSON.map((l) => [l.id, MANIFEST[l.id]?.duration ?? null]));
const DOORS4 = ['d4_inner', 'd4_shower_in', 'd4_shower_out', 'd4_wet_w', 'd4_wet_e', 'd4_pi', 'd4_viv', 'd4_cold', 'd4_rec', 'd4_bay', 'd4_surg', 'd4_gal', 'd4_store', 'd4_gal_e', 'd4_stair_s', 'd4_chk', 'd4_guard', 'd4_plant', 'd4_tube_n', 'd4_tube_s'];
const ROOMS4 = ['lock4', 'gown', 'shower', 'corr_n', 'corr_w', 'corr_e', 'corr_s', 'wetlab', 'pi_office', 'node2', 'cold', 'records', 'vivarium', 'bay', 'scrub', 'store4', 'gallery', 'theatre', 'stair4', 'lcorr', 'chk', 'guard', 'plant4', 'tube', 'gatel'];
const MARKERS4 = ['mk4_start', 'mk4_decon_panel', 'mk4_gate_panel', 'mk4_booth', 'mk4_gauge', 'mk4_bodies', 'mk4_wet_win', 'mk4_node2_win', 'mk4_roster', 'mk4_video', 'mk4_cold_panel', 'mk4_gallery_spk', 'mk4_glass', 'mk4_vent_viv', 'mk4_vent_s_a', 'mk4_vent_s_b', 'mk4_sump', 'mk4_bay_door', 'mk4_store_door', 'theatre_arm'];
const USES4 = ['note4_signout', 'note4_gown', 'note4_cards', 'log4_viv', 'note4_wet', 'term4_pi', 'log4_video', 'note4_consent', 'note4_tveit', 'note4_list', 'sign4_theatre', 'term4_ctrl', 'note4_guard', 'note4_bunk', 'cold_ack', 'booth_release', 'valve4'];
const PICKUPS4 = ['p4_gown_med', 'p4_viv_ammo', 'p4_wet_ammo', 'p4_pi_med', 'p4_rec_ammo', 'p4_rec_shells', 'p4_cold_med', 'p4_scrub_med', 'p4_scrub_shells', 'p4_lcorr_med', 'p4_lcorr_ammo', 'p4_booth_med', 'p4_carbine', 'p4_vest_1', 'p4_vest_2', 'p4_cage_ammo', 'p4_cage_plate', 'p4_guard_plate', 'p4_guard_shells', 'p4_plant_plate', 'p4_plant_ammo', 'p4_plant_med', 'p4_tube_plate', 'p4_tube_ammo'];
const SCREENS4 = ['decon_panel', 'shower_in_panel', 'shower_out_panel', 'fumig_status', 'surg_hold', 'cold_panel', 'node2_screen', 'pi_video', 'theatre_screen', 'theatre_cam', 'roster', 'booth_panel', 'tube_n_panel', 'plant_gauge', 'gate_panel'];
const GROUPS4 = { g4_wet: 1, g4_rec: 1, g4_viv: 2, g4_bay: 3, g4_vent: 2, g4_lower: 1, g4_chk_sentry: 1, g4_store: 2, g4_plant: 2, g4_tube: 5 };
const DORMANT4 = ['g4_wet', 'g4_rec', 'g4_lower', 'g4_chk_sentry'];
/** R4: a spawned group's beat (a `t` key in debugState). */
const NEED4 = { g4_viv: 'vignette:viv_vent', g4_bay: 'l4_lights_out', g4_vent: 'l4_lights_out', g4_store: 'l4_armed', g4_plant: 'l4_equalise', g4_tube: 'l4_tube_fight' };
/** Spawn visibility: what may have just opened in front of the group (door id | vignette ids). */
const OPENING4 = { g4_bay: { door: 'd4_bay' }, g4_store: { door: 'd4_store' }, g4_tube: { door: 'd4_tube_s' }, g4_vent: { vig: ['vent_s_a', 'vent_s_b'] }, g4_viv: { vig: ['viv_vent'] }, g4_plant: { vig: ['plant_sump'] } };
// §3 doors per phase: L locked / cycling, A auto, O held open
const LABS = ['d4_wet_w', 'd4_wet_e', 'd4_pi', 'd4_viv', 'd4_rec'], OPEN_ROUTE = ['d4_gal', 'd4_gal_e', 'd4_stair_s', 'd4_chk', 'd4_guard', 'd4_plant'];
const PH = {};
PH.A = { d4_inner: 'L', d4_shower_in: 'L', d4_shower_out: 'L', ...Object.fromEntries(LABS.map((d) => [d, 'A'])), d4_cold: 'O', d4_bay: 'L', d4_surg: 'L', ...Object.fromEntries(OPEN_ROUTE.map((d) => [d, 'A'])), d4_store: 'L', d4_tube_n: 'L', d4_tube_s: 'L' };
PH.B = { ...PH.A, d4_inner: 'A', d4_shower_in: 'A' };
PH.S = { ...PH.B, d4_shower_in: 'L' };
PH.C = { ...PH.S, d4_shower_out: 'A' };
PH.D = { ...PH.C, d4_surg: 'A' };
PH.D2 = { ...PH.D };
PH.E = { ...PH.D2, d4_tube_n: 'A' };
PH.F = { ...PH.E, d4_tube_s: 'A' };
PH.G = { ...PH.F, d4_tube_s: 'L' };
const PH_VARIANT = { D_bay: ['d4_bay', 'O'], D_store: ['d4_store', 'O'], F_open: ['d4_tube_s', 'O'] };
/** §6.2 video log gaps after each Sunde line (the scene owns them). */
const SUNDE_GAP = [0.9, 0.5, 1.2, 0.7, 0.6, 1.6, 0.8, 1.4];
const SUNDE_CUT = LINES_JSON.find((l) => l.id === 'l4_sunde_9')?.cut ?? null;

// ───────────────────────────────────────────────────────────── browser
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
const notes = [];
const bad = (m) => { problems.push(m); console.log('  !! ' + m); };
const ok = (cond, m) => { if (!cond) bad(m); else console.log('  ok ' + m); return !!cond; };
const note = (m) => { notes.push(m); console.log('  .. ' + m); };
page.on('console', (m) => { if (m.type() === 'error') console.log(`  [error] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log('  [pageerror]', e.message); });

// ───────────────────────────────────────────────────────────── in-page log, R4 / spawn / cutscene watchers, oracle
await page.addInitScript(([LINES, NEED4, OPENING4, DORMANT4, DOORS4]) => {
  let game;
  const L = window.__L4 = {
    beats: [], beatAt: {}, toasts: [], objectives: [], fired: [], hits: [], denied: {}, reads: {}, uses: {}, pickups: [], opened: {},
    died: {}, early: [], spawnSeen: [], cutscene: [], phases: [], phaseAt: {}, doorsAt: {}, lines: [], viol: [], said: [], noOracle: [],
    softLocks: [], cues: [], cpState: {}, seenIds: [],
  };
  Object.defineProperty(window, '__game', {
    configurable: true,
    get() { return game; },
    set(g) {
      game = g;
      const t = () => g.time;
      const ds = () => { try { return g.story?.debugState ?? null; } catch { return null; } };
      const now = () => ds()?.now ?? null;
      const doorOf = (id) => g.level?.doors?.find((d) => d.id === id) ?? null;
      const doorState = (id) => { const d = doorOf(id); return d ? (d.locked ? 'L' : d.auto ? 'A' : d.isOpen ? 'O' : 'S') : '?'; };
      g.events.on('story:beat', (e) => { L.beats.push(e.id); L.beatAt[e.id] = t(); });
      g.events.on('story:toast', (e) => L.toasts.push({ t: t(), text: e.text }));
      g.events.on('story:objective', (e) => L.objectives.push({ t: t(), text: e.text }));
      g.events.on('weapon:fired', () => L.fired.push(t()));
      g.events.on('bullet:impact', (e) => L.hits.push({ t: t(), p: [e.point.x, e.point.y, e.point.z], s: e.surface }));
      g.events.on('door:denied', (e) => { L.denied[e.id] = t(); });
      g.events.on('door:opening', (e) => { L.opened[e.id] = t(); });
      g.events.on('story:log', (e) => { L.reads[e.id] = t(); });
      g.events.on('interact', (e) => { L.uses[e.id] = t(); });
      g.events.on('pickup', (e) => L.pickups.push({ t: t(), kind: e.kind, amount: e.amount }));
      g.events.on('enemy:died', (e) => { L.died[e.group] = (L.died[e.group] ?? 0) + 1; });
      // spawn visibility (§10.1 all modes): a new unit seen from the eye (frustum + clear ray to its chest) is pop-in,
      // unless its door / grille / sump opened within the last 3 s
      g.events.on('enemy:spawned', (ev) => setTimeout(() => {
        const e = g.enemies?.all?.find((x) => x.id === ev.id); if (!e || !g.player) return;
        const cam = g.camera; cam.updateMatrixWorld();
        const chest = e.position.clone(); chest.y += e.type === 'skitter' ? 0.3 : 1.3;
        const v = chest.clone().project(cam);
        const inFrustum = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
        const seen = inFrustum && g.physics.lineOfSight(g.player.eye, chest);
        if (DORMANT4.includes(e.group)) return;   // present from load (or restored dormant): not a pop-in
        const op = OPENING4[e.group]; const d = ds();
        const opened = op ? (op.door ? t() - (L.opened[op.door] ?? -1e9) <= 3 : op.vig.some((id) => d && d.now - (d.t?.['vignette:' + id] ?? -1e9) <= 3)) : false;
        const rec = { group: e.group, t: +t().toFixed(2), seen, opened, pos: [e.position.x, e.position.y, e.position.z].map((n) => +n.toFixed(1)) };
        L.spawnSeen.push(rec);
      }, 0));
      setInterval(() => {
        if (!g.ready) return;
        if (g.state === 'cutscene' && !L.cutscene.length) L.cutscene.push(+t().toFixed(1));
        const d = ds(); if (!d || !g.enemies) return;
        // R4: nothing hostile before its beat (the four dormant ones excepted)
        const tk = d.t ?? {};
        for (const e of g.enemies.all) {
          if (!e.alive || DORMANT4.includes(e.group)) continue;
          if (!L.seenIds.includes(e.id)) L.seenIds.push(e.id);
          const need = NEED4[e.group];
          if (!need || tk[need] === undefined && !(d.beats ?? []).includes(need)) { const k = `${e.group}@${need ?? '?'}`; if (!L.early.includes(k)) L.early.push(k); }
        }
        // phase changes: when and the doors 0.3 s later
        const ph = d.phaseApplied;
        if (ph && L.phases[L.phases.length - 1]?.id !== ph) {
          L.phases.push({ id: ph, t: +t().toFixed(2), now: d.now });
          L.phaseAt[ph] = t();
          setTimeout(() => { L.doorsAt[ph] = Object.fromEntries(DOORS4.map((id) => [id, doorState(id)])); }, 300);
        }
        // checkpoint written: the world at that instant (compared after the load)
        const cp = d.checkpoint;
        if (cp && !L.cpState[cp] && window.__worldState) L.cpState[cp] = window.__worldState();
      }, 100);
      // ── the oracle: every spoken line judged from WORLD state when its subtitle appears (§6.2 rules)
      const P = () => g.player.position;
      const room = () => g.level.roomAt(P())?.id ?? null;
      const within = (at, s) => at !== undefined && t() - at <= s;
      const choice = () => g.facts.choice;
      const flags = () => ds()?.flags ?? {};
      const phase = () => ds()?.phaseApplied ?? ds()?.phase ?? null;
      const PHASES = ['A', 'B', 'S', 'C', 'D', 'D2', 'E', 'F', 'G'];
      const phaseRank = () => { const p = String(phase() ?? ''); return PHASES.indexOf(p.startsWith('D_') ? 'D' : p === 'F_open' ? 'F' : p); };
      const heard = (id) => (ds()?.heard ?? []).includes(id) || L.said.includes(id);
      const beat = (id) => L.beats.includes(id) || (ds()?.beats ?? []).includes(id);
      const viewOf = (p, deg = 50) => {
        const eye = g.player.eye, f = g.player.forward, d = p.clone().sub(eye), l = d.length() || 1;
        return Math.acos(Math.max(-1, Math.min(1, d.dot(f) / l))) * 180 / Math.PI <= deg && g.physics.lineOfSight(eye, p);
      };
      const markerP = (n) => { const o = g.level.object(n); if (!o) return null; const v = o.getWorldPosition(o.position.clone()); return v; };
      const V = () => g.player.position.constructor;
      const bodies = () => (g.level.object('mk4_bodies')?.userData?.list ?? []).map((b) => ({ name: b.name, p: Array.isArray(b.p) ? new (V())(b.p[0], b.p[1] + 0.3, b.p[2]) : b.p.clone().setY(b.p.y + 0.3) }));
      const armCue = () => g.level.object('theatre_arm')?.userData?.cycle?.cue ?? null;
      const hostilesIn = (r) => g.enemies.all.some((e) => e.alive && g.level.roomAt(e.position)?.id === r);
      const glassHit = (s) => L.hits.some((h) => t() - h.t <= s && h.s === 'glass');
      const C = (pre, id) => choice() === id.split('_').pop() && pre;
      const OR = {
        l4_unit_decon: () => room() === 'lock4',
        l4_unit_shower: () => within(L.beatAt.l4_shower, 1.5) || (beat('l4_shower') && room() === 'shower'),
        l4_unit_clean: () => within(L.denied.d4_shower_in, 2.5) && phaseRank() >= 3,
        l4_unit_hold: () => within(L.denied.d4_surg, 2.5) && phaseRank() === 3,
        l4_unit_cold_ack: () => within(L.beatAt.l4_override, 1.5),
        l4_unit_theatre_0: () => room() === 'gallery',
        l4_unit_theatre_1: () => room() === 'gallery' && armCue() === 'approach',
        l4_unit_theatre_2: () => room() === 'gallery' && armCue() === 'fail',
        l4_unit_theatre_3: () => room() === 'gallery' && armCue() === 'regel' && heard('l4_unit_theatre_2'),
        l4_unit_release_refused: () => within(L.uses.booth_release, 2) && !flags().equalised,
        l4_unit_equalise: () => within(L.beatAt.l4_equalise, 1.5),
        l4_unit_equalised: () => !!flags().equalised || phase() === 'D2',
        l4_unit_release: () => within(L.uses.booth_release, 2) && !!flags().equalised,
        l4_unit_tube_denied: () => within(L.denied.d4_tube_n, 2.5) && ['D', 'D2', 'D_bay', 'D_store'].includes(phase()),
        l4_unit_gatelock: () => within(L.denied.d4_tube_s, 2.5) && phaseRank() <= 6,
        l4_unit_gate: () => phase() === 'G',
      };
      for (const c of ['stop', 'command']) {
        OR[`l4_choir_enter_${c}`] = () => C(['lock4', 'gown'].includes(room()) && beat('l4_decon_done'), c);
        OR[`l4_choir_bodies_${c}`] = () => C(phaseRank() === 3 && t() - (L.phaseAt.C ?? t()) >= 4.9 && bodies().some((b) => !/dahl/i.test(b.name) && b.p.distanceTo(g.player.eye) <= 3.5 && viewOf(b.p, 60)), c);
        OR[`l4_choir_node2_${c}`] = () => C((() => { const p = markerP('mk4_node2_win'); return !!p && p.distanceTo(g.player.eye) <= 6.5 && viewOf(p, 60); })(), c);
        OR[`l4_choir_hold_${c}`] = () => C(phaseRank() >= 4 && heard('l4_unit_cold_ack'), c);
        OR[`l4_choir_theatre_${c}`] = () => C(room() === 'gallery' && heard('l4_unit_theatre_3'), c);
        OR[`l4_choir_glass_${c}`] = () => C(phaseRank() >= 3 && glassHit(2.5), c);
        OR[`l4_choir_armoury_${c}`] = () => C(!!g.player.weapons.carbine?.owned && L.pickups.some((p) => p.kind === 'carbine' && t() - p.t <= 3.5) && room() === 'chk', c);
        OR[`l4_choir_roster_${c}`] = () => C(within(L.reads.term4_ctrl, 10.5) || within(L.uses.term4_ctrl, 10.5) || (() => { const p = markerP('mk4_roster'); return !!p && p.distanceTo(g.player.eye) <= 6.5 && viewOf(p, 60); })(), c);
        OR[`l4_choir_pumps_${c}`] = () => C(!!flags().equalising && t() - (L.beatAt.l4_equalise ?? t()) >= 7.9, c);
        OR[`l4_choir_tube_${c}`] = () => C(phase() === 'E' && !beat('l4_tube_fight') && room() === 'tube', c);
        OR[`l4_choir_end_${c}`] = () => C(phase() === 'G' && !hostilesIn('gatel'), c);
      }
      for (let i = 1; i <= 9; i++) OR[`l4_sunde_${i}`] = () => L.uses.log4_video !== undefined;
      g.events.on('story:subtitle', (e) => {
        const log = g.story?.lineLog ?? [];
        let id = null;
        for (let i = log.length - 1; i >= Math.max(0, log.length - 4); i--) if (log[i].said && LINES[log[i].said] === e.text) { id = log[i].said; break; }
        if (!id) return;
        let okk = true, why = '';
        try {
          if (OR[id]) { okk = !!OR[id](); if (!okk) why = 'oracle false'; }
          else if (!L.noOracle.includes(id)) L.noOracle.push(id);
          if (LINES['@' + id] === 'choir' && !id.endsWith('_' + choice())) { okk = false; why = `variant of the other choice (${choice()})`; }
        } catch (err) { okk = false; why = 'oracle threw: ' + err.message; }
        const rec = { id, t: +t().toFixed(1), ok: okk, room: room(), phase: phase(), pos: [P().x, P().y, P().z].map((v) => +v.toFixed(1)) };
        L.lines.push(rec); L.said.push(id);
        if (!okk) L.viol.push({ ...rec, why });
      });
      // SOFT-LOCK oracle (§9): a timed gate that never opens, F6 that never starts, an end that never comes
      let since = {}; const mark = (k, on, lim, info) => { if (!on) { delete since[k]; return; } since[k] ??= t(); if (t() - since[k] > lim && !L.softLocks.some((x) => x.k === k)) L.softLocks.push({ k, t: +t().toFixed(1), ...info }); };
      setInterval(() => {
        if (!g.ready || g.state !== 'playing') return;
        const d = ds(); if (!d) return;
        const ph = d.phaseApplied, f = d.flags ?? {};
        mark('A', ph === 'A', 12, { why: 'decon never ended (≤ 9 s)' });
        mark('S', ph === 'S', 10, { why: 'shower cycle never ended (≤ 8 s)' });
        mark('eq', !!f.equalising && !f.equalised, 32, { why: 'equalising never completed (25 s fixed clock)' });
        const near = g.enemies.all.some((e) => e.alive && e.state !== 'dormant' && e.position.distanceTo(P()) < 25);
        mark('F6', ph === 'E' && P().z < -80 && !near && !f.tubeFight, 95, { why: 'F6 never started (20 s unseen + 60 s stranded rule)' });
        mark('G', ph === 'G' && !beat('l4_end') && !hostilesIn('gatel'), 30, { why: 'no end 30 s after the latch with the gate lock clear' });
      }, 200);
    },
  });
}, [LINES, NEED4, OPENING4, DORMANT4, DOORS4]);

// ───────────────────────────────────────────────────────────── helpers
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
/** Wait IN THE PAGE for a condition; false on timeout (a wall-clock cap only). */
const until = async (fn, arg, ms = 60000) => { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch { return false; } };
const installWorldState = () => ev(() => {
  window.__worldState = () => {
    const g = window.__game, p = g.player, d = g.story.debugState ?? {}, r = (v) => Math.round(v * 100) / 100;
    const doors = Object.fromEntries((g.level.doors ?? []).map((x) => [x.id, x.locked ? 'L' : 'U']));
    const scr = {};
    for (const n of ['decon_panel', 'shower_in_panel', 'shower_out_panel', 'surg_hold', 'cold_panel', 'booth_panel', 'tube_n_panel', 'plant_gauge', 'gate_panel']) { const m = g.level.screen(n); if (m) scr[n] = String(m.userData?.screenText ?? '').replace(/\d\d:\d\d:\d\d/g, '##'); }
    const L = g.render.lights; const names = L.groups instanceof Map ? [...L.groups.keys()] : [];
    const emerg = names.filter((n) => n.endsWith('_emerg')).some((n) => L.group(n).some((h) => h.enabled));
    const snap = p.snapshot();
    return {
      state: g.state, phase: d.phase ?? null, phaseApplied: d.phaseApplied ?? null, pos: [p.position.x, p.position.y, p.position.z].map(r),
      doors, screens: scr, lightsOut: emerg, flags: { ...(d.flags ?? {}) }, facts: { ...g.facts },
      alive: g.enemies.all.filter((e) => e.alive).map((e) => e.group).sort(), pickups: [...(snap.pickups ?? [])].sort(), armor: p.armor,
      weapons: Object.fromEntries(Object.entries(p.weapons).map(([k, w]) => [k, { owned: !!w.owned, total: (w.clip ?? 0) + (w.reserve ?? 0) }])),
      health: p.health, restoredFrom: d.restoredFrom ?? null,
    };
  };
});
const boot = async (query = '') => {
  await ev(() => { window.__stale = true; }).catch(() => {});
  for (let i = 0; ; i++) {
    try { await page.goto(`${base}/?level=4&autostart=1&god=1${query}`); } catch (e) { if (i >= 2) throw e; await wait(700); continue; }
    if (await ev(() => !window.__stale).catch(() => false)) break;
    if (i >= 2) throw new Error('boot: stale page');
  }
  await page.waitForFunction(() => window.__game?.ready && window.__game.story?.debugState, null, { timeout: 120000 });
  await installWorldState();
};
const clearAll = (seen = true) => ev(([k, s]) => { for (const x of k) localStorage.removeItem(x); if (s) localStorage.removeItem('coldboot.seen.v1'); }, [[SAVE_KEY, CARRY_KEY, LEVEL_KEY], seen]);
const dbg = () => ev(() => window.__game.story.debugState);
const L4 = () => ev(() => window.__L4);
const tp = (x, y, z, yawDeg = 0, pitchDeg = 0) => ev(([x, y, z, yaw, pitch]) => {
  const g = window.__game; const V = g.player.position.constructor;
  g.player.teleport(new V(x, y, z), yaw * Math.PI / 180, pitch * Math.PI / 180);
}, [x, y, z, yawDeg, pitchDeg]);
const use = (id) => ev((id) => { const g = window.__game; const i = g.interactables.get(id); if (!i) return 'missing'; if (!i.enabled) return 'disabled'; g.interactables.use(i); return 'ok'; }, id);
const closeNote = () => ev(() => window.__game.ui.closeNote?.());
const read = async (id, x, y, z, yaw) => { await tp(x, y, z, yaw); await wait(250); const r = await use(id); ok(r === 'ok', `read ${id} (${r})`); await wait(600); await closeNote(); await wait(300); return r === 'ok'; };
const deny = (id) => ev((id) => { const g = window.__game; const d = g.level.doors.find((x) => x.id === id); if (!d) return false; g.events.emit('door:denied', { id, position: d.position }); return true; }, id);
const hasBeat = (id) => ev((id) => window.__game.story.debugState.beats?.includes(id) ?? false, id);
const waitBeat = async (id, ms = 30000) => ok(await until((id) => (window.__game.story.debugState.beats ?? []).includes(id), id, ms), `beat ${id}`);
/** A short-lived variant (D_bay, D_store, F_open): applied at some point since the page loaded (polled every 0.1 s). */
const phaseSeen = async (p, ms = 6000) => ok(await until((p) => window.__L4.phaseAt[p] !== undefined, p, ms), `phase ${p} applied`);
const phaseIs = async (p, ms = 8000) => ok(await until((p) => window.__game.story.debugState.phaseApplied === p, p, ms), `phase ${p}`);
const cpWritten = async (cp, ms = 20000) => ok(await until((cp) => (window.__game.story.debugState.checkpoints ?? []).includes(cp), cp, ms), `${cp} saved`);
const heard = (id) => ev((id) => (window.__game.story.lineLog ?? []).some((l) => l.said === id), id);
const heardWait = async (id, ms = 15000, m = null) => ok(await until((id) => (window.__game.story.lineLog ?? []).some((l) => l.said === id), id, ms), m ?? `line ${id}`);
const lineOf = (id) => ev((id) => (window.__game.story.lineLog ?? []).filter((l) => l.said === id).slice(-1)[0] ?? null, id);
const tOf = (k) => ev((k) => window.__game.story.debugState.t?.[k] ?? null, k);
const toastSeen = (re, ms = 6000) => until((re) => window.__L4.toasts.some((x) => new RegExp(re, 'i').test(x.text)), re, ms);
const objectiveSeen = (text, ms = 8000) => until((text) => window.__L4.objectives.some((x) => x.text === text), text, ms);
const choiceOf = () => ev(() => window.__game.facts.choice);
const kill = (groups) => ev((groups) => {
  const g = window.__game; const V = g.player.position.constructor; let n = 0;
  for (const e of [...g.enemies.all]) {
    if (!e.alive || (groups && !groups.includes(e.group)) || e.state === 'dormant') continue;
    for (let k = 0; k < 8 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1));
    n++;
  }
  return n;
}, groups ?? null);
/** Keep killing awake units (optionally only some groups) until `cond` holds, in the page, on game time. */
const killUntil = (cond, ms = 60000, groups = null) => until(([cond, groups]) => {
  const g = window.__game; const V = g.player.position.constructor;
  for (const e of [...g.enemies.all]) {
    if (!e.alive || e.state === 'dormant' || (groups && !groups.includes(e.group))) continue;
    for (let k = 0; k < 8 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1));
  }
  return new Function('g', 'd', `return (${cond});`)(g, g.story.debugState);
}, [cond, groups], ms);
const awake = () => ev(() => window.__game.enemies.all.filter((e) => e.alive && e.state !== 'dormant').map((e) => e.group));
const fireAt = (x, y, z, n = 1) => ev(async ([x, y, z, n]) => {
  const g = window.__game;
  for (let i = 0; i < n; i++) {
    const e = g.player.eye; const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    await new Promise((r) => setTimeout(r, 60));
    const w = g.player.currentWeapon ? g.player.weapons[g.player.currentWeapon] : null;
    if (w && w.clip === 0) { g.player.debug.reload(); await new Promise((r) => setTimeout(r, 2700)); }
    g.player.debug.fire();
    await new Promise((r) => setTimeout(r, 330));
  }
}, [x, y, z, n]);
const doorStates = (ids) => ev((ids) => Object.fromEntries(ids.map((id) => { const d = window.__game.level.doors.find((x) => x.id === id); return [id, d ? (d.locked ? 'L' : d.auto ? 'A' : d.isOpen ? 'O' : 'S') : '?']; })), ids);
/** §3: the doors recorded 0.3 s after `phase` was applied match the table. */
async function checkDoors(phase) {
  await until((p) => !!window.__L4.doorsAt[p], phase, 3000);
  const got = (await L4()).doorsAt[phase];
  if (!got) return ok(false, `doors at phase ${phase}: not recorded (phase never applied?)`);
  if (PH_VARIANT[phase]) { const [id, want] = PH_VARIANT[phase]; return ok(got[id] === want, `phase ${phase}: ${id} ${got[id]} (want ${want})`); }
  const want = PH[phase]; const diff = Object.entries(want).filter(([id, w]) => got[id] !== '?' && got[id] !== w).map(([id, w]) => `${id} ${got[id]}≠${w}`);
  return ok(!diff.length, `phase ${phase}: doors per §3${diff.length ? ' — ' + diff.join(', ') : ''}`);
}
/** 10 fps frame sequence (approximate: a screenshot costs time) while `cond` is false, ≤ `max` s. */
const film = async (name, cond, max = 12) => {
  if (!FRAMES) return;
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < max * 1000; i++) {
    if (cond && await ev(cond).catch(() => true)) break;
    await page.screenshot({ path: `shots/l4/frames/${name}-${String(i).padStart(3, '0')}.png` });
    await wait(60);
  }
};

// ───────────────────────────────────────────────────────────── preflight: what exists, per hook / id
/** A segment's needs: 'door:id' 'room:id' 'marker:id' 'use:id' 'pickup:id' 'screen:id' 'group:id' 'hook:name' 'ds:key' 'arm'. */
const missingOf = (needs) => ev((needs) => {
  const g = window.__game, s = g.story, d = (() => { try { return s.debugState ?? {}; } catch { return {}; } })();
  const out = [];
  for (const n of needs) {
    const [k, id] = n.split(':');
    const has = {
      door: () => g.level.doors.some((x) => x.id === id),
      room: () => g.level.rooms.some((r) => r.id === id),
      marker: () => !!g.level.object(id),
      use: () => !!g.interactables.get(id),
      pickup: () => g.level.pickupSpawns.some((p) => p.id === id),
      screen: () => !!g.level.screen(id),
      group: () => g.level.enemySpawns.some((e) => e.group === id),
      hook: () => typeof s[id] === 'function' || (id === 'lineLog' && Array.isArray(s.lineLog)) || (id === 'rules' && s.rules && typeof s.rules === 'object'),
      ds: () => d[id] !== undefined,
      arm: () => typeof g.level.object('theatre_arm')?.userData?.onCue === 'function',
    }[k];
    if (!has || !has()) out.push(n);
  }
  return out;
}, needs);
const DS_KEYS = ['now', 'beats', 't', 'phase', 'phaseApplied', 'flags', 'checkpoints', 'checkpoint', 'restoredFrom', 'calm', 'heard', 'missingMarkers', 'failHold'];
async function preflight() {
  console.log('── preflight: the contract (hooks H1–H9, ids [W4])');
  const all = [
    ...['end', 'checkpoint', 'fire', 'hurry', 'lineLog', 'rules'].map((h) => `hook:${h}`), ...DS_KEYS.map((k) => `ds:${k}`),
    ...ROOMS4.map((r) => `room:${r}`), ...DOORS4.map((d) => `door:${d}`), ...MARKERS4.map((m) => `marker:${m}`),
    ...USES4.map((u) => `use:${u}`), ...PICKUPS4.map((p) => `pickup:${p}`), ...SCREENS4.map((x) => `screen:${x}`),
    ...Object.keys(GROUPS4).map((x) => `group:${x}`), 'arm',
  ];
  const miss = await missingOf(all);
  const by = {};
  for (const m of miss) (by[m.split(':')[0]] ??= []).push(m.split(':')[1] ?? m);
  for (const [k, ids] of Object.entries(by)) bad(`MISSING ${k} (${ids.length}): ${ids.join(', ')}`);
  if (!miss.length) console.log('  ok every hook and id of the contract exists');
  const d = await dbg();
  if (Array.isArray(d.missingMarkers)) ok(!d.missingMarkers.length, `story reports no missing marker (${d.missingMarkers})`);
  const extra = await ev(() => {
    const g = window.__game;
    const bodies = g.level.object('mk4_bodies')?.userData?.list;
    const panes = g.level.object('mk4_glass')?.userData?.panes;
    const n = (x) => (Array.isArray(x) ? x.length : x && typeof x === 'object' ? Object.keys(x).length : null);
    return { bodies: n(bodies), bodyNames: Array.isArray(bodies) ? bodies.map((b) => b.name) : null, panes: n(panes), paneIds: Array.isArray(panes) ? panes.map((p) => p.id ?? p.name) : panes ? Object.keys(panes) : null };
  });
  if (extra.bodies !== null) ok(extra.bodies === 10, `mk4_bodies lists 10 bodies (${extra.bodyNames})`);
  if (extra.panes !== null) ok(['theatre', 'tube_w', 'tube_e', 'node2', 'wet', 'booth'].every((p) => extra.paneIds.some((x) => String(x).includes(p))), `mk4_glass panes theatre, tube_w, tube_e, node2, wet, booth (${extra.paneIds})`);
  return miss;
}
/** Static pass (all modes): ids ↔ RULES ↔ manifest, choice pairs, unit lines without uppercase. */
async function staticPass() {
  console.log('── static: lines.l4.json ↔ RULES ↔ manifest');
  const ids = LINES_JSON.map((l) => l.id);
  const man = Object.keys(MANIFEST).filter((k) => k.startsWith('l4_'));
  ok(ids.length === 47, `47 lines in voice/lines.l4.json (${ids.length})`);
  const noMan = ids.filter((i) => !MANIFEST[i]), extraMan = man.filter((i) => !ids.includes(i));
  ok(!noMan.length && !extraMan.length, `manifest = lines (${noMan.length ? 'missing ' + noMan : ''}${extraMan.length ? ' extra ' + extraMan : ''})`);
  const rules = await ev(() => { const r = window.__game.story.rules; return r && typeof r === 'object' ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { kind: v?.kind ?? null, why: v?.why ?? null, else: v?.else ?? null }])) : null; });
  if (!rules) bad('hook story.rules (H6) missing: RULES ↔ lines not checkable');
  else {
    const l4r = Object.keys(rules).filter((k) => k.startsWith('l4_'));
    const noRule = ids.filter((i) => !rules[i]), extraRule = l4r.filter((i) => !ids.includes(i));
    ok(!noRule.length, `every line has a RULES entry${noRule.length ? ' — missing: ' + noRule.join(', ') : ''}`);
    ok(!extraRule.length, `no RULES entry without a line${extraRule.length ? ' — ' + extraRule.join(', ') : ''}`);
    const noWhy = l4r.filter((k) => !rules[k].why); ok(!noWhy.length, `every rule says why (${noWhy})`);
    const badElse = l4r.filter((k) => rules[k].else && !rules[rules[k].else]); ok(!badElse.length, `every else names a rule (${badElse})`);
  }
  const choir = ids.filter((i) => i.startsWith('l4_choir_'));
  const pairs = choir.filter((i) => i.endsWith('_stop')).map((i) => i.slice(0, -5));
  const unpaired = choir.filter((i) => !pairs.includes(i.replace(/_(stop|command)$/, '')) || !ids.includes(i.replace(/_stop$/, '_command')));
  ok(choir.length === 22 && !unpaired.length, `CHOIR: 11 stop/command pairs (${choir.length}; unpaired ${unpaired})`);
  const upper = LINES_JSON.filter((l) => l.speaker === 'unit' && /\b[A-Z]{2,}\b/.test(l.spoken ?? l.text)).map((l) => l.id);
  ok(!upper.length, `no uppercase stress in a unit line (${upper})`);
  ok(typeof SUNDE_CUT === 'number' && DUR.l4_sunde_9 && SUNDE_CUT < DUR.l4_sunde_9, `l4_sunde_9 cut ${SUNDE_CUT} inside the file (${DUR.l4_sunde_9} s)`);
}

// ───────────────────────────────────────────────────────────── segments (a run is these in order)
let routeBroken = null;
let skipped = [];
/** Run a segment if its needs exist and the route still stands; `exit` = the condition the next segment relies on. */
async function seg(name, needs, fn) {
  if (routeBroken) { skipped.push(name); console.log(`  -- ${name}: skipped (route broken at ${routeBroken})`); return false; }
  const miss = await missingOf(needs);
  if (miss.length) { bad(`${name}: SKIPPED — missing ${miss.join(', ')}`); routeBroken = name; return false; }
  console.log(`── ${name}`);
  try { const r = await fn(); if (r === false) { routeBroken = name; bad(`${name}: did not reach its exit — later segments skipped`); return false; } }
  catch (e) { routeBroken = name; bad(`${name}: threw ${e.message}`); return false; }
  return true;
}
const H = (...h) => h.map((x) => `hook:${x}`);
const DSN = (...k) => k.map((x) => `ds:${x}`);
const opt = { reads: true, video: true, theatre: 'full', carbine: true, vests: true, valveFirst: false, guardNotes: true, east: false, coldFirst: false, labsAfter: false };

async function segBoot() {
  console.log('── boot: loadout, facts, never a cutscene');
  const s = await ev(() => { const g = window.__game, p = g.player; return { level: g.levelId, state: g.state, w: Object.fromEntries(Object.entries(p.weapons).map(([k, v]) => [k, [!!v.owned, v.clip, v.reserve]])), hp: p.health, armor: p.armor, fl: p.flashlightOn, facts: { ...g.facts }, loadout: g.story.debugState.loadout }; });
  ok(s.level === 4 && s.state === 'playing', `level 4 playing (${s.level}, ${s.state})`);
  ok(s.loadout === 'direct' && JSON.stringify(s.w.pistol) === '[true,12,36]' && JSON.stringify(s.w.shotgun) === '[true,6,14]' && !s.w.carbine?.[0] && s.hp === 100 && s.armor === 0 && s.fl,
    `direct loadout pistol 12/36, shotgun 6/14, no carbine, health 100, armour 0, flashlight on (${JSON.stringify(s)})`);
  ok(s.facts.unitsLeft === 28 && s.facts.badge === true && s.facts.halvorsenAlive === true && ['stop', 'command'].includes(s.facts.choice), `direct facts ${JSON.stringify(s.facts)}`);
}
async function segDecon() {
  await waitBeat('l4_start', 10000);
  await phaseIs('A', 3000);
  await checkDoors('A');
  ok(await objectiveSeen('Get to Post 4 — through Biological Systems', 6000), 'objective: Get to Post 4 — through Biological Systems');
  await film('decon', () => window.__game.story.debugState.beats.includes('l4_decon_done'), 10);
  if (!await waitBeat('l4_decon_done', 15000)) return false;
  const t = await dbg();
  const mist = t.t?.['vignette:decon_cycle'], done = t.t?.l4_decon_done;
  ok(typeof mist === 'number' && Math.abs(done - mist - 8.0) <= 0.2, `decon 8.0 ± 0.2 s (mist ${mist} → done ${done}: ${(done - mist).toFixed(2)} s)`);
  ok(mist !== undefined && mist - (t.t?.l4_start ?? 0) <= 0.7, `mist at start + 0.6 (${((mist ?? 0) - (t.t?.l4_start ?? 0)).toFixed(2)})`);
  ok(await heard('l4_unit_decon'), 'l4_unit_decon');
  await phaseIs('B', 2000); await checkDoors('B');
  await cpWritten('cp4_start', 5000);
  const c = await choiceOf();
  await tp(0, 4.8, -2.5, 0);
  await heardWait(`l4_choir_enter_${c}`, 25000, `CHOIR enter line for ${c} (t4_gown or decon + 3 s)`);
}
async function segStayLock() {   // softlock (a)
  console.log('   (a) 120 s in lock4 after the decon');
  await tp(0, 4.8, 2.6, 0);
  const t0 = await ev(() => window.__game.time);
  ok(await until((t0) => window.__game.time - t0 >= 120, t0, 200000), '120 s waited in lock4');
  ok((await awake()).length === 0, 'nothing hostile came');
  const said = await ev(() => window.__game.story.lineLog.filter((l) => l.said?.startsWith('l4_choir_enter')).length);
  ok(said === 1, `CHOIR enter once (${said})`);
}
async function segShower({ doorway = false } = {}) {
  await tp(0, 4.8, -4.5, 0);
  await wait(300);
  if (doorway) {   // softlock (b): arm the latch, stand in the doorway (z −6), the latch fails, reopens, re-arms
    await tp(0, 4.8, -7.0, 0); await wait(250); await tp(0, 4.8, -6.05, 0);
    await wait(2500);
    const d = await doorStates(['d4_shower_in']);
    ok(d.d4_shower_in !== 'L' && !(await hasBeat('l4_shower')), `shower latch with the player in the doorway: door stays unlatched (${d.d4_shower_in}), no l4_shower yet`);
  }
  await tp(0, 4.8, -7.6, 0);
  await film('shower', () => window.__game.story.debugState.phaseApplied === 'C', 10);
  if (!await waitBeat('l4_shower', 12000)) return false;
  await phaseIs('S', 2000); await checkDoors('S');
  await heardWait('l4_unit_shower', 3000);
  if (!await phaseIs('C', 10000)) return false;
  await checkDoors('C');
  const t = (await dbg()).t ?? {};
  ok(t['phase:C'] - t.l4_shower <= 8.0, `shower ≤ 8 s (${(t['phase:C'] - t.l4_shower).toFixed(2)} s)`);
  const jets = t['vignette:shower_cycle'];
  // (§4.2 jets at latch + 0.3: the vignette may own that delay — fired at the latch … + 0.3, never later)
  ok(typeof jets === 'number' && jets - t.l4_shower >= -0.02 && jets - t.l4_shower <= 0.42, `shower_cycle fired at latch … + 0.3 (${(jets - t.l4_shower).toFixed(2)})`);
  await tp(0, 4.8, -10.5, 0);
  await waitBeat('l4_clean', 5000);
  await cpWritten('cp4_clean', 8000);
}
async function segBackToShower() {   // impatient: back to the shower door
  await tp(0, 4.8, -9.8, 180);
  await deny('d4_shower_out'); await deny('d4_shower_in');
  await tp(0, 4.8, -5.4, 180); await deny('d4_shower_in');
  const d = await doorStates(['d4_shower_in']);
  ok(d.d4_shower_in === 'L', `shower in stays locked from the clean side (${d.d4_shower_in})`);
  await heardWait('l4_unit_clean', 6000, 'l4_unit_clean on the denied shower door');
  await tp(0, 4.8, -10.5, 0);
}
async function segWetWindow() {
  await tp(-6, 4.8, -10.8, 0);
  await film('worker', null, 4);
  await wait(800);
  const w = await ev(() => window.__game.enemies.all.filter((e) => e.group === 'g4_wet').map((e) => ({ alive: e.alive, state: e.state })));
  ok(w.length === 1 && w[0].state === 'dormant', `the worker at hood 2, dormant (${JSON.stringify(w)})`);
}
async function segLabs() {
  if (opt.reads) {
    await read('note4_wet', -4.5, 4.8, -19, -90);
    await tp(4.2 + 1.5, 4.8, -16, -90); await wait(200);
    await read('term4_pi', 6.4, 4.8, -14.2, 0);
  }
  if (opt.video) {
    console.log('   the video log (9 lines, scene-owned gaps, cut)');
    await tp(8, 4.8, -14.4, 0);
    ok((await use('log4_video')) === 'ok', 'Play log');
    const done = await until(() => (window.__game.story.lineLog ?? []).some((l) => l.said === 'l4_sunde_9' && typeof l.end === 'number'), null, 80000);
    ok(done, 'the log played to l4_sunde_9 and ended');
    const log = await ev(() => (window.__game.story.lineLog ?? []).filter((l) => l.said?.startsWith('l4_sunde_')));
    for (let i = 1; i < 9; i++) {
      const a = log.find((l) => l.said === `l4_sunde_${i}`), b = log.find((l) => l.said === `l4_sunde_${i + 1}`);
      if (!a || !b) { bad(`video log: l4_sunde_${i} or _${i + 1} not in lineLog`); continue; }
      ok(typeof a.end === 'number' && Math.abs(b.t - a.end - SUNDE_GAP[i - 1]) <= 0.12, `video gap _${i} → _${i + 1}: ${(b.t - a.end).toFixed(2)} s (plan ${SUNDE_GAP[i - 1]})`);
    }
    const nine = log.find((l) => l.said === 'l4_sunde_9');
    if (nine) ok(typeof nine.end === 'number' && Math.abs(nine.end - nine.t - SUNDE_CUT) <= 0.1, `_9 stopped at cut ${SUNDE_CUT} (${nine.end !== undefined ? (nine.end - nine.t).toFixed(2) : '?'} s)`);
    ok(await ev(() => window.__game.facts.l4_video === true), 'fact l4_video');
    ok(await until(() => /static/.test(window.__game.level.screen('pi_video')?.userData?.screenText ?? ''), null, 2000), 'pi_video → static at the cut');
  }
  if (opt.reads) {
    await tp(10.5, 4.8, -14.6, 0); await wait(500);   // p4_pi_med (touch)
    // Node 2 window (corr_e)
    await tp(13.8, 4.8, -22, 90); await wait(2600);
  }
}
async function segVivarium() {
  await tp(-13.5, 4.8, -22, 90); await wait(200);
  await tp(-18, 4.8, -22, 90); await wait(300);
  if (opt.reads) { await read('note4_cards', -19.6, 4.8, -15.6, 90); await read('log4_viv', -24.6, 4.8, -17.2, 90); }
  await tp(-22.9, 4.8, -27, 0);
  ok(await until(() => (window.__game.story.debugState.t ?? {})['vignette:viv_vent'] !== undefined, null, 10000), 'viv_vent: the grille drops (t4_viv_deep)');
  ok(await until(() => window.__game.enemies.all.filter((e) => e.group === 'g4_viv').length === 2, null, 6000), 'g4_viv: 2 skitters');
  await killUntil('g.enemies.all.every((e) => !(e.alive && e.group === "g4_viv"))', 20000);
}
async function segRecords() {
  await tp(11, 4.8, -29, 90); await wait(200);
  if (opt.reads) { await read('note4_consent', 3, 4.8, -25.6, 0); await read('note4_tveit', 10.8, 4.8, -25.6, 180); }
  await killUntil('g.enemies.all.every((e) => !(e.alive && e.state !== "dormant"))', 15000);
}
async function segSurgDenied() {
  await tp(0, 4.8, -35.8, 0); await wait(300);
  await deny('d4_surg');
  await heardWait('l4_unit_hold', 6000, 'l4_unit_hold on the denied surgical door');
  ok(await objectiveSeen('Clear the containment hold — Cold Store 2'), 'objective → Cold Store 2');
  const d = await doorStates(['d4_surg']); ok(d.d4_surg === 'L', `d4_surg held (${d.d4_surg})`);
}
async function segColdEnter() {
  await tp(-13.5, 4.8, -29, -90); await wait(200);
  await killUntil('g.enemies.all.every((e) => !(e.alive && e.state !== "dormant"))', 15000);
  await tp(-6, 4.8, -29, -90);
  await film('cold_jam', null, 4);
  await cpWritten('cp4_cold', 10000);
}
async function segOverride({ stayInCold = false, intoBay = false } = {}) {
  await tp(-1.2, 4.8, -29, -90); await wait(300);
  ok((await use('cold_ack')) === 'ok', 'press cold_ack (inside the cold store)');
  if (!await waitBeat('l4_override', 3000)) return false;
  await heardWait('l4_unit_cold_ack', 3000);
  if (!stayInCold) await tp(-10, 4.8, -35.5, -90);   // the corr_s ambush view
  // §10.5: the lights-out wave, the bay door and the first husk, a vent grille drop (L + 5)
  await film('lights_out', () => { const t = window.__game.story.debugState.t ?? {}; const v = t['vignette:vent_s_a'] ?? t['vignette:vent_s_b']; return v !== undefined && window.__game.story.debugState.now - v > 2; }, 24);
  if (!await waitBeat('l4_lights_out', 20000)) return false;
  const ack = await lineOf('l4_unit_cold_ack'), hold = await lineOf(`l4_choir_hold_${await choiceOf()}`);
  const t = (await dbg()).t ?? {};
  ok(ack?.end !== undefined && Math.abs(t['phase:D'] - ack.end - 0.3) <= 0.12, `phase D at ack end + 0.3 (${ack?.end !== undefined ? (t['phase:D'] - ack.end).toFixed(2) : '?'})`);
  ok(hold && ack?.end !== undefined && Math.abs(hold.t - ack.end - 0.6) <= 0.12, `CHOIR hold line at ack end + 0.6 (${hold && ack ? (hold.t - ack.end).toFixed(2) : 'not said'})`);
  ok(hold?.end !== undefined && Math.abs(t.l4_lights_out - hold.end - 0.4) <= 0.12, `lights-out at CHOIR end + 0.4 (${hold?.end !== undefined ? (t.l4_lights_out - hold.end).toFixed(2) : '?'})`);
  ok(await toastSeen('Containment hold cleared'), 'toast Containment hold cleared');
  ok(await objectiveSeen('Get to Post 4 — the surgical suite'), 'objective → the surgical suite');
  ok(await until(() => window.__game.enemies.all.filter((e) => e.group === 'g4_bay').length === 3, null, 6000), 'g4_bay spawned (L + 1.5)');
  if (!await phaseSeen('D_bay', 6000)) return false;
  await checkDoors('D_bay');
  const t2 = (await dbg()).t ?? {};
  ok(Math.abs(t2['phase:D_bay'] - t2.l4_lights_out - 2.0) <= 0.15, `d4_bay opens at L + 2.0 (${(t2['phase:D_bay'] - t2.l4_lights_out).toFixed(2)})`);
  ok(await until(() => window.__game.enemies.all.filter((e) => e.group === 'g4_vent').length === 2, null, 12000), 'g4_vent: 2 skitters from a corr_s vent (L + 5.0, the far one)');
  const lit = await ev(() => { const L = window.__game.render.lights; const n = L.groups instanceof Map ? [...L.groups.keys()] : []; return { emerg: n.filter((x) => x.endsWith('_emerg') && L.group(x).some((h) => h.enabled)), stillOn: n.filter((x) => ['corr_n', 'corr_w', 'corr_e', 'corr_s', 'wetlab', 'cold', 'records', 'vivarium', 'scrub', 'gallery', 'gown', 'shower', 'pi_office'].includes(x) && L.group(x).some((h) => h.enabled && h.factor > 0.01)), keep: ['theatre', 'node2', 'lock4'].filter((x) => L.group(x).some((h) => h.enabled)) }; });
  ok(lit.emerg.length >= 4 && !lit.stillOn.length, `lights-out: emergency groups on (${lit.emerg.length}), Deck-2 groups off (${lit.stillOn})`);
  ok(lit.keep.length === 3, `theatre, node2, lock4 keep their lights (${lit.keep})`);
  if (intoBay) {   // softlock (h): step into the bay while it is open
    await until(() => window.__game.enemies.all.filter((e) => e.group === 'g4_bay' && e.alive && e.position.x < 14.6).length === 3, null, 12000);
    await tp(18, 4.8, -19, -90); await wait(4000);
    ok((await doorStates(['d4_bay'])).d4_bay !== 'L', 'bay: the door stays open while the player is inside');
    await tp(13.5, 4.8, -19, 90);
  }
  if (stayInCold) {   // softlock (c): the ambush comes into the cold store; fight it there
    ok(await until(() => window.__game.enemies.all.some((e) => e.alive && e.group === 'g4_bay' && window.__game.level.roomAt(e.position)?.id === 'cold'), null, 60000), 'a bay unit reaches the cold store');
  }
  await killUntil('g.enemies.all.every((e) => !(e.alive && e.state !== "dormant")) && d.phaseApplied === "D"', 60000);
  if (!await phaseIs('D', 15000)) return false;
  await checkDoors('D');
  await tp(-6, 4.8, -35.5, -90);
  await cpWritten('cp4_hold', 15000);
}
async function segTheatre() {
  await tp(0, 4.8, -40, 0); await wait(200);
  if (opt.reads) await read('note4_list', 2.8, 4.8, -38.4, -90);
  await ev(() => {
    const arm = window.__game.level.object('theatre_arm'); const L = window.__L4;
    if (arm && !L.armHooked) { L.armHooked = true; arm.userData.onCue((cue) => L.cues.push({ cue, t: window.__game.time, now: window.__game.story.debugState.now })); }
  });
  await tp(0, 4.8, -44.2, 0);
  if (!await waitBeat('l4_theatre', 3000)) return false;
  ok(await ev(() => window.__game.facts.l4_theatre === true), 'fact l4_theatre');
  if (opt.theatre === 'quick') { await film('gallery_sprint', null, 3); await tp(9, 4.8, -46, -90); return; }
  if (FRAMES) {   // §10.5 (B3): a sprint d4_gal → d4_gal_e along the glass (≈ 6 m/s, 10 fps → 0.6 m a frame)
    for (let i = 0; i <= 15; i++) { await tp(i * 0.6, 4.8, -46, -90 + 45 * Math.sin(i / 5), -15); await page.screenshot({ path: `shots/l4/frames/gallery_sprint-${String(i).padStart(3, '0')}.png` }); }
    await tp(0, 4.8, -44, 0, -25); await film('arm_cycle_3m', null, 42);
  }
  await tp(0, 4.8, -46, 0, -25);
  await film('arm_cycle_1m', null, 42);
  const c = await choiceOf();
  ok(await until((c) => (window.__game.story.lineLog ?? []).some((l) => l.said === `l4_choir_theatre_${c}`), c, 100000), `theatre lines through CHOIR's (l4_choir_theatre_${c})`);
  const s = await L4();
  await until(() => window.__L4.cues.filter((c) => c.cue === 'approach').length >= 2, null, 45000);
  const s2 = await L4(); s.cues = s2.cues;
  const appr = s.cues.filter((x) => x.cue === 'approach');
  const fh = (await dbg()).failHold;
  const wantHold = Math.max(2.5, (DUR.l4_unit_theatre_2 ?? 0) + 0.5);
  ok(typeof fh === 'number' && Math.abs(fh - wantHold) <= 0.05, `failHold ${fh} = max(2.5, dur(_2) + 0.5) = ${wantHold.toFixed(2)}`);
  if (appr.length >= 2) {
    const period = appr[1].t - appr[0].t;
    ok(Math.abs(period - (37.5 + wantHold)) <= 0.5, `arm cycle ${period.toFixed(2)} s (= 37.5 + failHold ±0.5; nominal 40)`);
  } else bad(`arm cycle: fewer than two approach cues seen (${appr.length})`);
  // the announcer exactly on its cues (script clock): _1 approach, _2 fail, _3 regel
  for (const [id, cue] of [['l4_unit_theatre_1', 'approach'], ['l4_unit_theatre_2', 'fail'], ['l4_unit_theatre_3', 'regel']]) {
    const l = await lineOf(id);
    const k = l ? s.cues.filter((x) => x.cue === cue && x.now <= l.t + 0.2).slice(-1)[0] : null;
    ok(l && k && Math.abs(l.t - k.now) <= 0.12, `${id} on cue ${cue} (${l && k ? (l.t - k.now).toFixed(3) : 'missing'} s)`);
  }
  const th = await lineOf(`l4_choir_theatre_${c}`), t3 = await lineOf('l4_unit_theatre_3');
  ok(th && t3?.end !== undefined && Math.abs(th.t - t3.end - 1.0) <= 0.12, `CHOIR theatre at _3 end + 1.0 (${th && t3?.end !== undefined ? (th.t - t3.end).toFixed(2) : '?'})`);
  await tp(9, 4.8, -46, -90);
}
async function segStairFoot() {
  await tp(12, 4.8, -45, 180); await wait(300);
  await tp(12, 2.4, -51.5, 180); await wait(300);
  await film('stair', null, 2);
  await tp(12, 0, -57.5, 180);
  await killUntil('g.enemies.all.every((e) => !(e.alive && e.state !== "dormant"))', 20000);
  await cpWritten('cp4_lower', 10000);
}
async function segLcorr() {
  await tp(14, 0, -61, -90);
  ok(await until(() => window.__game.enemies.all.some((e) => e.group === 'g4_lower' && e.alive && e.state !== 'dormant'), null, 6000), 'g4_lower wakes (t4_lcorr + 1.0)');
  await killUntil('g.enemies.all.every((e) => !(e.alive && e.group === "g4_lower"))', 20000);
  await tp(20.2, 0, -62.2, 180); await wait(400);   // the cabinet (medkit + ammo by touch)
  await tp(26, 0, -61, -90);
  await cpWritten('cp4_navy', 10000);
  ok(await objectiveSeen('Release the tube door — the guard booth'), 'objective → the guard booth');
  await deny('d4_tube_n');
  await heardWait('l4_unit_tube_denied', 5000, 'l4_unit_tube_denied on the tube door');
}
async function boothRefusal() {
  await tp(28, 0, -56.8, 180); await wait(300);
  ok((await use('booth_release')) === 'ok', 'press booth_release (before equalising)');
  await heardWait('l4_unit_release_refused', 4000);
  ok(await objectiveSeen('Equalise the tube — the plant room'), 'objective → the plant room');
  ok(await until(() => /REFUSED/.test(window.__game.level.screen('booth_panel')?.userData?.screenText ?? '') && /REFUSED/.test(window.__game.level.screen('tube_n_panel')?.userData?.screenText ?? ''), null, 3000), 'booth_panel + tube_n_panel say RELEASE REFUSED');
  const d = await dbg();
  ok(d.flags?.refused && !d.flags?.armed && !(d.beats ?? []).includes('l4_armed'), `refusal does not start F5 (refused ${d.flags?.refused}, armed ${d.flags?.armed})`);
  ok((await doorStates(['d4_tube_n'])).d4_tube_n === 'L', 'd4_tube_n still held');
}
async function segBooth() {
  await boothRefusal();
  if (opt.reads) {
    await read('term4_ctrl', 27.2, 0, -56.6, 180);
    ok(await until(() => window.__game.facts.l4_roster === true, null, 4000), 'fact l4_roster');
    const c = await choiceOf();
    await heardWait(`l4_choir_roster_${c}`, 12000);
  }
}
async function segCage() {
  await tp(37.4, 0, -62.2, 180); await wait(200);
  await tp(37.8, 0, -64.5, -90); await wait(300);
  ok((await use('p4_carbine')) === 'ok', 'take p4_carbine');
  ok(await toastSeen('^Carbine$'), 'toast Carbine');
  await waitBeat('l4_armed', 3000);
  ok(await ev(() => window.__game.player.weapons.carbine.owned), 'carbine owned');
  const c = await choiceOf();
  await heardWait(`l4_choir_armoury_${c}`, 8000);
  if (opt.vests) {
    for (const v of ['p4_vest_1', 'p4_vest_2']) {
      await ev(() => window.__game.player.debug.move?.(0, 0, false));
      await film('vest', null, 1.5);
      ok((await use(v)) === 'ok', `Put on vest ${v}`);
      await wait(1300);
    }
    ok(await ev(() => window.__game.player.armor === 100), `armour 100 after two vests (${await ev(() => window.__game.player.armor)})`);
  }
  await tp(37.4, 0, -61.6, 0); await wait(500);   // the cage plate / ammo by touch (plate only if < 100)
}
async function armedWaves({ inPlant = false } = {}) {
  ok(await until(() => window.__game.enemies.all.some((e) => e.group === 'g4_chk_sentry' && e.alive && e.state !== 'dormant') || window.__L4.died.g4_chk_sentry, null, 5000), 'g4_chk_sentry wakes (l4_armed)');
  if (FRAMES) {   // §10.5: the navy sentry undocking, then a 30-round carbine dump at it
    await tp(30, 0, -60, 30, 20); await film('sentry_undock', null, 4);
    if (await ev(() => window.__game.player.weapons.carbine.owned)) {
      await ev(() => { const p = window.__game.player; p.debug.switchTo?.('carbine'); });
      await wait(600); await ev(() => window.__game.player.debug.hold(true));
      await film('carbine_dump', null, 3.5); await ev(() => window.__game.player.debug.hold(false));
    }
  }
  ok(await until(() => window.__game.enemies.all.filter((e) => e.group === 'g4_store').length === 2, null, 6000), 'g4_store spawned (armed + 2.0)');
  ok(await phaseSeen('D_store', 5000), 'd4_store opens (D_store)');
  await checkDoors('D_store');
  void inPlant;
}
async function segPlant({ hideInGuard = false, leaveToChk = false, intoStore = false } = {}) {
  await tp(43, 0, -59, -90); await wait(300);
  if (opt.guardNotes && opt.reads) { await read('note4_guard', 45, 0, -58.4, -90); await read('note4_bunk', 42, 0, -60.4, 180); }
  await tp(54.6, 0, -59, -90); await wait(300);
  ok((await use('valve4')) === 'ok', 'pull valve4');
  if (!await waitBeat('l4_equalise', 3000)) return false;
  await heardWait('l4_unit_equalise', 3000);
  const d0 = await dbg();
  ok(d0.flags?.equalising, 'flag equalising');
  ok((d0.beats ?? []).includes('l4_armed'), 'the valve starts F5 if not yet (l4_armed)');
  ok(await until(() => (window.__game.story.debugState.t ?? {})['vignette:valve_open'] !== undefined, null, 1500), 'valve_open vignette');
  await film('valve', null, 10);
  if (intoStore) {   // softlock (h): into the sterile store while it is open
    await until(() => window.__game.story.debugState.phaseApplied === 'D_store', null, 6000);
    await until(() => window.__game.enemies.all.filter((e) => e.group === 'g4_store' && e.alive && e.position.x < 3.6).length === 2, null, 15000);
    await tp(6, 4.8, -41, -90); await wait(4000);
    ok((await doorStates(['d4_store'])).d4_store !== 'L', 'store: the door stays open while the player is inside');
    await tp(2.5, 4.8, -41, 90); await wait(2500);
  }
  if (hideInGuard) await tp(41, 0, -61, -90);
  if (leaveToChk) await tp(30, 0, -62, 0);
  ok(await until(() => window.__game.enemies.all.filter((e) => e.group === 'g4_plant').length === 2, null, 9000), 'g4_plant: the sump lifts, 2 skitters (valve + 6.4)');
  const c = await choiceOf();
  await heardWait(`l4_choir_pumps_${c}`, 12000, `CHOIR pumps line (equalising ≥ 8 s)`);
  if (!await until(() => window.__game.story.debugState.phaseApplied === 'D2', null, 32000)) { bad('phase D2 (equalised) never came'); return false; }
  const t = (await dbg()).t ?? {};
  ok(Math.abs(t['phase:D2'] - t.l4_equalise - 25.0) <= 0.2, `equalising 25.0 ± 0.2 s (${(t['phase:D2'] - t.l4_equalise).toFixed(2)})`);
  ok(Math.abs((t['vignette:plant_sump'] ?? -99) - t.l4_equalise - 6.0) <= 0.12, `plant_sump at valve + 6.0 (${((t['vignette:plant_sump'] ?? NaN) - t.l4_equalise).toFixed(2)})`);
  await heardWait('l4_unit_equalised', 4000);
  ok(await ev(() => window.__game.facts.l4_equalised === true), 'fact l4_equalised');
  await checkDoors('D2');
  await killUntil('g.enemies.all.every((e) => !(e.alive && e.state !== "dormant"))', 60000);
  await tp(50, 0, -59, -90);
  await cpWritten('cp4_armed', 20000);
}
async function segRelease() {
  await tp(28, 0, -56.8, 180); await wait(300);
  ok((await use('booth_release')) === 'ok', 'press booth_release (equalised)');
  await heardWait('l4_unit_release', 4000);
  if (!await phaseIs('E', 4000)) return false;
  await checkDoors('E');
  ok(await toastSeen('Tube access released'), 'toast Tube access released');
  ok(await objectiveSeen('Through the tube to Post 4'), 'objective → through the tube');
}
async function segTube({ leaveTwo = false, gateDoorway = false } = {}) {
  await tp(32, 0, -69, 180); await wait(300);
  await tp(32, 0, -69.5, 0);
  const c = await choiceOf();
  await heardWait(`l4_choir_tube_${c}`, 8000);
  await tp(32, 0, -76, 0); await wait(400);   // through t4_tube_1 (a teleport past a trigger never enters it)
  await tp(32, 0, -84, 0);
  if (!await waitBeat('l4_tube_fight', 10000)) return false;
  ok(await until(() => window.__game.enemies.all.filter((e) => e.group === 'g4_tube').length === 5, null, 4000), 'g4_tube: 3 husks + 2 skitters in the gate lock');
  ok(await phaseSeen('F_open', 3000), 'd4_tube_s opens (F_open)');
  await checkDoors('F_open');
  await film('tube_fight', null, 8);
  await tp(32, 0, -86, 0);   // the ring: plate + ammo by touch
  if (leaveTwo) {
    // softlock (g): kill three, leave two behind in the tube, north of the gate lock
    await until(() => window.__game.enemies.all.filter((e) => e.group === 'g4_tube' && e.alive && e.position.z > -105).length >= 5, null, 20000);
    await ev(() => { const g = window.__game, V = g.player.position.constructor; let n = 0; for (const e of g.enemies.all) if (e.alive && e.group === 'g4_tube' && n < 3) { for (let k = 0; k < 8 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1)); n++; } });
  } else await killUntil('g.enemies.all.every((e) => !(e.alive && e.group === "g4_tube"))', 40000);
  if (!await phaseIs('F', 15000)) return false;
  await checkDoors('F');
  if (gateDoorway) {   // softlock (f): arm the gate-lock latch, stand in the doorway (z −107)
    await tp(32, 0, -108.5, 180); await wait(250); await tp(32, 0, -107.05, 180); await wait(2500);
    ok((await doorStates(['d4_tube_s'])).d4_tube_s !== 'L', 'gate-lock latch with the player in the doorway: stays open');
  }
}
async function segEnd({ natural = true } = {}) {
  if (natural && !routeBroken) {
    await tp(32, 0, -110, 180);
    if (await waitBeat('l4_gatelock', 8000)) {
      await phaseIs('G', 3000); await checkDoors('G');
      await killUntil('!g.enemies.all.some((e) => e.alive && g.level.roomAt(e.position)?.id === "gatel")', 30000);
      await heardWait('l4_unit_gate', 15000);
      const c = await choiceOf();
      await film('gate', () => window.__game.state === 'ended', 14);
      await heardWait(`l4_choir_end_${c}`, 20000);
      const ug = await lineOf('l4_unit_gate'), t = (await dbg()).t ?? {};
      const dogs = t['vignette:gate_dogs'];
      ok(ug?.end !== undefined && dogs !== undefined && Math.abs(dogs - ug.end - 0.3) <= 0.12, `gate dogs at unit line end + 0.3 (${ug?.end !== undefined && dogs !== undefined ? (dogs - ug.end).toFixed(2) : '?'})`);
      ok(/AAS, L\. \(LT\.\) — PALM — LIVE/.test(await ev(() => window.__game.level.screen('gate_panel')?.userData?.screenText ?? '')), 'gate panel AUTHORISED: AAS, L. (LT.) — PALM — LIVE');
    }
  }
  let natEnd = await until(() => window.__game.state === 'ended' || (window.__game.story.debugState.beats ?? []).includes('l4_end'), null, natural && !routeBroken ? 30000 : 1500);
  if (!natEnd) {
    bad(`the level did not end by itself${routeBroken ? ` (route broken at ${routeBroken})` : ''} — forcing story.end() (H1) to test the end contract`);
    const r = await ev(() => typeof window.__game.story.end === 'function' ? (window.__game.story.end(), true) : false);
    if (!r) { bad('hook story.end (H1) missing: the end cannot be tested'); return; }
    natEnd = await until(() => window.__game.state === 'ended', null, 10000);
  }
  ok(natEnd, 'state ended');
  await wait(800);
  // (the UI root `.cb`, as playthrough-l3: the card's lines are in it while it shows)
  const card = await ev(() => (document.querySelector('.cb')?.innerText ?? '').replace(/\s+/g, ' '));
  const at = card.lastIndexOf('BIOLOGICAL SYSTEMS');
  ok(at >= 0 && /TO BE CONTINUED/.test(card.slice(at)), `end card "${at >= 0 ? card.slice(at, at + 40) : card.slice(0, 40)}"`);
  await film('end_card', null, 2);
  const s = await ev((K) => ({ carry: JSON.parse(localStorage.getItem(K[0]) ?? 'null'), level: localStorage.getItem(K[1]), save: localStorage.getItem(K[2]) }), [CARRY_KEY, LEVEL_KEY, SAVE_KEY]);
  const c = s.carry, choice = await choiceOf();
  ok(c?.from === 4, `carry from 4 (${c?.from})`);
  ok(c && typeof c.armor === 'number' && c.armor >= 0 && c.armor <= 100, `carry armour ${c?.armor}`);
  ok(c && c.weapons && 'carbine' in c.weapons, `carry weapons incl. carbine (${c ? Object.keys(c.weapons ?? {}) : '—'})`);
  ok(c?.facts?.choice === choice && typeof c.facts.testHour === 'number' && c.facts.testHour > 62 && c.facts.testHour < 64 && typeof c.facts.kills4 === 'number', `carry facts choice ${c?.facts?.choice}, testHour ${c?.facts?.testHour}, kills4 ${c?.facts?.kills4}`);
  if (!routeBroken && natural) {
    ok(c.facts.l4_theatre === true && c.facts.l4_equalised === true, `carry first-view flags l4_theatre ${c.facts.l4_theatre}, l4_equalised ${c.facts.l4_equalised}, l4_video ${c.facts.l4_video}, l4_roster ${c.facts.l4_roster}`);
    if (opt.carbine) ok(c.weapons.carbine?.owned, 'carbine carried');
    if (opt.vests) ok(c.armor > 0, `armour carried (${c.armor})`);
  }
  ok(s.level === '4' && s.save === null, `stored level stays 4 (${s.level}), checkpoint cleared (${s.save === null})`);
}
/** Checks every mode makes at the end of a run: R4, spawn visibility, cutscene, line timing, markers. */
async function runChecks(label) {
  if (skipped.length) bad(`${label}: ${skipped.length} segments not run after the break at ${routeBroken}: ${skipped.join(' · ')}`);
  skipped = [];
  const l = await L4();
  ok(!l.early.length, `${label}: R4 — no enemy before its beat (${l.early})`);
  const pop = l.spawnSeen.filter((s) => s.seen && !s.opened);
  ok(!pop.length, `${label}: spawn visibility — no unit appears in view (${JSON.stringify(pop)})`);
  ok(!l.cutscene.length, `${label}: never state 'cutscene' (${l.cutscene})`);
  const log = await ev(() => (window.__game.story.lineLog ?? []).filter((x) => x.said && typeof x.cue === 'number').map((x) => ({ id: x.said, start: x.t, cue: x.cue })));
  const late = log.filter((x) => Math.abs(x.start - x.cue) > 0.12);
  const said = await ev(() => (window.__game.story.lineLog ?? []).filter((x) => x.said).length);
  ok(!late.length, `${label}: §8.12 every timed line within 0.12 s of its cue (${log.length} timed of ${said} spoken) ${late.map((x) => `${x.id} ${(x.start - x.cue).toFixed(2)}`).join(', ')}`);
  if (said && !log.length) bad(`${label}: no lineLog entry carries a cue (H5) — §8.12 not checkable`);
  const tl = await ev(() => (window.__game.story.lineLog ?? []).filter((x) => x.said && (typeof x.end !== 'number' || typeof x.dur !== 'number')).map((x) => x.said));
  if (said) ok(!tl.length, `${label}: every spoken line logs dur + end (H5) (${[...new Set(tl)].slice(0, 6)})`);
  for (const s of l.softLocks) bad(`${label}: SOFT-LOCK ${JSON.stringify(s)}`);
  const mm = await ev(() => window.__game.story.debugState.missingMarkers ?? null);
  if (Array.isArray(mm) && mm.length) bad(`${label}: missing markers ${mm}`);
}
function printOracle(l, strict) {
  console.log(`\n  ORACLE: ${l.lines.length} lines judged, ${l.viol.length} false; no oracle for: ${l.noOracle.join(', ') || '—'}`);
  for (const v of l.viol) (strict ? bad : note)(`line said while false: ${JSON.stringify(v)}`);
  if (l.noOracle.length) (strict ? bad : note)(`lines without an oracle: ${l.noOracle}`);
  console.log('  lines:', l.lines.map((x) => `${x.t} ${x.id}`).join(' | ') || '—');
}

// ───────────────────────────────────────────────────────────── the runs
const N = (...x) => x;
const NEEDS = {
  decon: N(...H('lineLog'), ...DSN('t', 'phaseApplied', 'beats', 'checkpoints'), 'door:d4_inner', 'room:gown'),
  shower: N('door:d4_shower_in', 'door:d4_shower_out', 'room:shower', 'room:corr_n'),
  labs: N('use:note4_wet', 'use:term4_pi', 'use:log4_video', 'screen:pi_video', 'room:pi_office', 'marker:mk4_video'),
  wet: N('group:g4_wet', 'marker:mk4_wet_win'),
  viv: N('room:vivarium', 'use:note4_cards', 'use:log4_viv', 'group:g4_viv', 'marker:mk4_vent_viv'),
  rec: N('room:records', 'use:note4_consent', 'use:note4_tveit', 'group:g4_rec'),
  surg: N('door:d4_surg', 'screen:surg_hold'),
  cold: N('room:cold', 'use:cold_ack', 'door:d4_cold'),
  override: N('use:cold_ack', 'group:g4_bay', 'group:g4_vent', 'door:d4_bay', 'marker:mk4_vent_s_a', 'marker:mk4_vent_s_b'),
  theatre: N('room:gallery', 'arm', 'use:note4_list', 'ds:failHold', 'marker:mk4_gallery_spk'),
  stair: N('room:stair4', 'door:d4_stair_s'),
  lcorr: N('room:lcorr', 'room:chk', 'group:g4_lower', 'door:d4_tube_n'),
  booth: N('use:booth_release', 'use:term4_ctrl', 'screen:booth_panel', 'screen:tube_n_panel', 'marker:mk4_booth'),
  cage: N('use:p4_carbine', 'use:p4_vest_1', 'use:p4_vest_2', 'group:g4_chk_sentry', 'group:g4_store', 'door:d4_store'),
  plant: N('room:plant4', 'use:valve4', 'group:g4_plant', 'marker:mk4_sump', 'marker:mk4_gauge'),
  release: N('use:booth_release'),
  tube: N('room:tube', 'room:gatel', 'group:g4_tube', 'door:d4_tube_s'),
};
async function freshRun(query) {
  routeBroken = null; skipped = [];
  await boot(query); await clearAll(); await boot(query + '&handoff=1');
  await segBoot();
}
/** The main route with options; `hooks` = { at: segment name → async fn } for mode-specific insertions. */
async function route(o = {}, hooks = {}) {
  Object.assign(opt, { reads: true, video: true, theatre: 'full', carbine: true, vests: true, guardNotes: true }, o);
  const at = async (k) => { if (hooks[k] && !routeBroken) await hooks[k](); };
  await seg('decon (A → B)', NEEDS.decon, segDecon);
  await at('afterDecon');
  await seg('air shower (B → S → C)', NEEDS.shower, () => segShower(o.showerDoorway ? { doorway: true } : {}));
  await at('afterShower');
  if (!o.coldFirst) {
    await seg('wet-lab window', NEEDS.wet, segWetWindow);
    if (!o.noLabs) {
      await seg('labs, PI office, video log, Node 2', NEEDS.labs, segLabs);
      await seg('vivarium', NEEDS.viv, segVivarium);
      await seg('records', NEEDS.rec, segRecords);
    }
    await seg('surgical door (hold)', NEEDS.surg, segSurgDenied);
  }
  await seg('cold store (cp4_cold)', NEEDS.cold, segColdEnter);
  await at('beforeOverride');
  await seg('override → lights-out → ambush (C → D)', NEEDS.override, () => segOverride({ stayInCold: !!o.stayInCold, intoBay: !!o.intoBay }));
  await at('afterOverride');
  await seg('the theatre gallery', NEEDS.theatre, segTheatre);
  await seg('stair foot (cp4_lower)', NEEDS.stair, segStairFoot);
  await seg('lcorr → chk (cp4_navy)', NEEDS.lcorr, segLcorr);
  await at('atChk');
  if (!o.valveFirst) await seg('booth: refusal, roster', NEEDS.booth, segBooth);
  if (o.carbine !== false) {
    await seg('the cage: carbine, vests (l4_armed)', NEEDS.cage, async () => { await segCage(); await armedWaves(); });
  }
  await seg('plant room: valve, 25 s holdout (D → D2)', NEEDS.plant, () => segPlant({ hideInGuard: !!o.hideInGuard, leaveToChk: !!o.leaveToChk, intoStore: !!o.intoStore }));
  await seg('booth: release (D2 → E)', NEEDS.release, segRelease);
  await seg('the tube, F6 (E → F)', NEEDS.tube, () => segTube({ leaveTwo: !!o.leaveTwo, gateDoorway: !!o.gateDoorway }));
  console.log('── gate lock, the end');
  await segEnd({ natural: true });
}

if (MODE === 'default') {
  for (const choice of CHOICES) {
    console.log(`\n══════════ LEVEL 4 — choice ${choice} ══════════`);
    await freshRun(`&choice=${choice}`);
    const miss = await preflight();
    await staticPass();
    void miss;
    await route();
    await runChecks(choice);
    printOracle(await L4(), false);
  }
} else if (MODE === 'checkpoints') {
  // segment index after which each checkpoint is due, the phase it restores, and what may differ on purpose
  const ORDER = ['decon', 'shower', 'cold', 'override', 'stair', 'lcorr', 'plant'];
  const PHASE_OF = { cp4_start: ['B'], cp4_clean: ['C'], cp4_cold: ['C'], cp4_hold: ['D'], cp4_lower: ['D'], cp4_navy: ['D'], cp4_armed: ['D2', 'E'] };
  for (const [i, cp] of CPS.entries()) {
    if (ONLY_CP && cp !== ONLY_CP) continue;
    console.log(`\n══════════ ${cp} ══════════`);
    await freshRun('');
    if (i === 0) { await preflight(); }
    // play to the checkpoint: the route's segments up to ORDER[i], quick (no reads, no video, theatre walked through)
    Object.assign(opt, { reads: false, video: false, theatre: 'quick', carbine: true, vests: true });
    const stopAfter = ORDER[i];
    const steps = [
      ['decon', NEEDS.decon, segDecon], ['shower', NEEDS.shower, segShower], ['cold', NEEDS.cold, segColdEnter], ['override', NEEDS.override, segOverride],
      ['theatre', NEEDS.theatre, segTheatre], ['stair', NEEDS.stair, segStairFoot], ['lcorr', NEEDS.lcorr, segLcorr],
      ['booth', NEEDS.booth, boothRefusal], ['cage', NEEDS.cage, async () => { await segCage(); await armedWaves(); }], ['plant', NEEDS.plant, segPlant],
    ];
    let k = 0;
    for (; k < steps.length; k++) { await seg(steps[k][0], steps[k][1], steps[k][2]); if (steps[k][0] === stopAfter) break; }
    if (routeBroken) { bad(`${cp}: not reached (route broken at ${routeBroken})`); await segEnd({ natural: false }); continue; }
    if (!await cpWritten(cp, 20000)) { await segEnd({ natural: false }); continue; }
    await wait(400);
    const want = (await L4()).cpState[cp] ?? await ev(() => window.__worldState());
    const saved = await ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), SAVE_KEY);
    ok(saved?.id === cp, `the save holds ${cp} (${saved?.id})`);
    await ev(() => { const g = window.__game; g.debug.god = false; g.player.damage(9999); g.player.damage(9999); });
    ok(await until(() => window.__game.state === 'dead', null, 8000), 'died');
    await boot('&handoff=1&continue=1');
    ok(await until(() => window.__game.state === 'playing', null, 20000), 'playing after the load');
    await wait(1500);
    const got = await ev(() => window.__worldState());
    await page.screenshot({ path: `shots/l4/${cp}-restored.png` });
    ok(got.restoredFrom === cp && PHASE_OF[cp].includes(got.phaseApplied), `${cp}: restoredFrom ${got.restoredFrom}, phase ${got.phase}/${got.phaseApplied} (want ${PHASE_OF[cp]})`);
    const sp = saved?.player?.position;
    if (sp) ok(Math.hypot(got.pos[0] - sp[0], got.pos[2] - sp[2]) < 0.8, `${cp}: position ${got.pos}`);
    for (const key of ['doors', 'lightsOut', 'screens', 'facts']) ok(JSON.stringify(got[key]) === JSON.stringify(want[key]), `${cp}: ${key} ${JSON.stringify(got[key])}${JSON.stringify(got[key]) === JSON.stringify(want[key]) ? '' : ' ≠ ' + JSON.stringify(want[key])}`);
    const fl = (f) => { const { equalising, ...r } = f ?? {}; void equalising; return r; };
    ok(JSON.stringify(fl(got.flags)) === JSON.stringify(fl(want.flags)), `${cp}: flags ${JSON.stringify(got.flags)}`);
    if (saved?.player) {
      ok(JSON.stringify(got.pickups) === JSON.stringify([...(saved.player.pickups ?? [])].sort()), `${cp}: pickups as saved (${got.pickups.length})`);
      ok(got.armor === (saved.player.armor ?? 0), `${cp}: armour ${got.armor} = saved ${saved.player.armor}`);
      const sw = Object.fromEntries(Object.entries(saved.player.weapons ?? {}).map(([k, w]) => [k, { owned: !!w.owned, total: (w.clip ?? 0) + (w.reserve ?? 0) }]));
      ok(JSON.stringify(got.weapons) === JSON.stringify(sw), `${cp}: weapons ${JSON.stringify(got.weapons)}`);
    }
    // groups: the dormant ones survive a load at cp4_clean / cp4_cold; every awake / fought group is gone (§7)
    const keepDormant = ['cp4_clean', 'cp4_cold'].includes(cp);
    ok(keepDormant ? JSON.stringify(got.alive) === JSON.stringify(want.alive) : got.alive.every((g) => DORMANT4.includes(g) && want.alive.includes(g)), `${cp}: groups alive ${got.alive} (at the save ${want.alive})`);
    const l = await L4();
    const replayed = l.beats.filter((b) => saved?.story?.beats?.includes(b) && b !== 'l4_lights_out');
    ok(!replayed.length, `${cp}: no beat replayed by the load (${replayed})`);
    ok(l.toasts.some((x) => /checkpoint restored/i.test(x.text)), `${cp}: toast`);
    if (['cp4_hold', 'cp4_lower', 'cp4_navy', 'cp4_armed'].includes(cp)) ok(l.beats.includes('l4_lights_out'), `${cp}: story:beat l4_lights_out re-emitted on restore (wave-1 note, audio)`);
    // finish from here
    routeBroken = null;
    for (k = k + 1; k < steps.length; k++) await seg(steps[k][0], steps[k][1], steps[k][2]);
    await seg('booth: release', NEEDS.release, segRelease);
    await seg('the tube', NEEDS.tube, segTube);
    await segEnd({ natural: true });
    await runChecks(cp);
  }
} else if (MODE === 'impatient') {
  console.log('\n══════════ IMPATIENT ══════════');
  await freshRun('&choice=command');
  await preflight(); await staticPass();
  const shootGlass = async () => {
    // every pane of mk4_glass, from its legal side (plan coordinates §2.8)
    await tp(-4, 4.8, -10.6, 0); await fireAt(-4, 6.3, -12, 2);                 // wet-lab windows from corr_n
    await tp(13.6, 4.8, -22, 90); await fireAt(12, 6.4, -22, 2);                // Node 2 window from corr_e
  };
  await route({ reads: false, video: false, theatre: 'quick', carbine: true, vests: false, valveFirst: false }, {
    afterShower: async () => {
      await segBackToShower();
      await tp(-6, 4.8, -10.8, 0); await fireAt(-6, 5.9, -22.6, 2);            // the worker through the window: glass holds
      const w = await ev(() => window.__game.enemies.all.filter((e) => e.group === 'g4_wet').map((e) => e.state));
      note(`worker after shots through the glass: ${w}`);
      await killUntil('g.enemies.all.every((e) => !(e.alive && e.group === "g4_wet"))', 20000);
      await shootGlass();
      await tp(0, 4.8, -35.8, 0); await deny('d4_surg');                         // the surgical door first
      await heardWait('l4_unit_hold', 6000);
      // every body of mk4_bodies on the clean side (bullet holes, no line) and the dormant records husk
      const bodies = await ev(() => (window.__game.level.object('mk4_bodies')?.userData?.list ?? []).map((b) => ({ name: b.name, p: Array.isArray(b.p) ? b.p : [b.p.x, b.p.y, b.p.z] })));
      for (const b of bodies.filter((b) => b.p[1] > 4)) { await tp(b.p[0] + 1.6, b.p[1], b.p[2] + 1.6, 45); await fireAt(b.p[0], b.p[1] + 0.3, b.p[2], 1); }
      await tp(8.5, 4.8, -31.5, 135); await fireAt(6.5, 5.6, -33.4, 2);
      await killUntil('g.enemies.all.every((e) => !(e.alive && e.group === "g4_rec"))', 20000);
    },
    afterOverride: async () => {
      await tp(0, 4.8, -45.6, 0); await fireAt(-2, 6.0, -47.0, 2); await fireAt(0, 1.5, -53.5, 1);   // theatre glass and the arm
      ok((await doorStates(['d4_gal'])).d4_gal !== '?', 'the theatre glass holds');
    },
    atChk: async () => {
      // the booth first (refused), the tube door, the valve before anything else in the navy level
      await boothRefusal();
      await tp(32, 0, -65.8, 0); await deny('d4_tube_n'); await heardWait('l4_unit_tube_denied', 5000);
      await fireAt(29, 1.5, -58.2, 1);                                            // booth glass
      await tp(28, 0, -58.8, 0); await fireAt(28, 3.6, -56.8, 3);               // the navy sentry dock: wakes, counts as l4_armed
      ok(await until(() => (window.__game.story.debugState.beats ?? []).includes('l4_armed'), null, 4000), 'shooting the dock is l4_armed (§9 #18)');
      await killUntil('g.enemies.all.every((e) => !(e.alive && e.group === "g4_chk_sentry"))', 20000);
    },
  });
  // the tube panes (from the tube) were part of segTube's walk: shoot them after the fight is over? the run has ended
  await runChecks('impatient');
  const l = await L4();
  printOracle(l, true);
  const choir = l.said.filter((x) => x.startsWith('l4_choir_'));
  ok(choir.every((x) => x.endsWith('_command')), `every CHOIR line is the command variant (${choir})`);
  const glassLines = l.said.filter((x) => x.startsWith('l4_choir_glass_'));
  ok(glassLines.length <= 1, `CHOIR glass line at most once (${glassLines.length})`);
} else if (MODE === 'order') {
  const V = {
    a: { label: '(a) east first, cold store first, no labs', o: { reads: false, video: false, theatre: 'quick', coldFirst: true, noLabs: true }, hooks: { afterShower: async () => { await tp(13.5, 4.8, -15, 180); await wait(400); await tp(13.5, 4.8, -32, 180); await wait(400); await tp(0, 4.8, -35.5, 90); await wait(400); } } },
    b: { label: '(b) no optional rooms', o: { reads: false, video: false, theatre: 'quick', noLabs: true, guardNotes: false } },
    c: { label: '(c) never the carbine or vests', o: { reads: false, video: false, theatre: 'quick', noLabs: true, carbine: false, vests: false } },
    d: { label: '(d) valve before the booth', o: { reads: false, video: false, theatre: 'quick', noLabs: true, valveFirst: true, carbine: false } },
    e: { label: '(e) refusal, guard-room notes, then the valve', o: { reads: true, video: false, theatre: 'quick', noLabs: true, carbine: false } },
  };
  for (const v of VARIANTS) {
    if (!V[v]) continue;
    console.log(`\n══════════ ORDER ${V[v].label} ══════════`);
    await freshRun('&choice=stop');
    if (v === VARIANTS[0]) await preflight();
    await route(V[v].o, V[v].hooks ?? {});
    const l = await L4();
    if (v === 'c') {
      const s = await ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), CARRY_KEY);
      ok(s && !s.weapons?.carbine?.owned, `(c) carry without the carbine (${JSON.stringify(s?.weapons?.carbine)})`);
      ok(!l.said.some((x) => x.startsWith('l4_choir_armoury')), '(c) the armoury line never plays');
    }
    if (v === 'd') ok(!l.said.includes('l4_unit_release_refused'), '(d) the refusal line never plays (valve first)');
    if (v === 'a' || v === 'b') ok(!['g4_viv'].some((g) => l.spawnSeen.some((s) => s.group === g)), `(${v}) optional groups never spawn`);
    await runChecks(`order ${v}`);
  }
} else if (MODE === 'softlock') {
  const has = (c) => CASES.includes(c);
  if (['a', 'b', 'c', 'd', 'f', 'g', 'h'].some(has)) {
    console.log('\n══════════ SOFTLOCK run 1: (a) (b) (c) (d) (f) (g) (h: bay) ══════════');
    await freshRun('&choice=stop');
    await preflight();
    await route({ reads: false, video: false, theatre: 'quick', noLabs: true, vests: false, showerDoorway: has('b'), stayInCold: has('c'), intoBay: has('h'), hideInGuard: has('d'), leaveTwo: has('g'), gateDoorway: has('f') }, {
      afterDecon: has('a') ? segStayLock : undefined,
    });
    await runChecks('softlock 1');
  }
  if (has('e') || has('h')) {
    console.log('\n══════════ SOFTLOCK run 2: (e) leave the plant room while equalising; (h: store) ══════════');
    await freshRun('&choice=command');
    await route({ reads: false, video: false, theatre: 'quick', noLabs: true, vests: false, valveFirst: true, carbine: false, leaveToChk: has('e'), intoStore: has('h') });
    await runChecks('softlock 2');
  }
}

await browser.close();
const okLine = { default: 'LEVEL4 OK', checkpoints: 'LEVEL4 CHECKPOINTS OK', impatient: 'LEVEL4 IMPATIENT OK', order: 'LEVEL4 ORDER OK', softlock: 'LEVEL4 SOFTLOCK OK' }[MODE];
if (notes.length) console.log(`\nNOTES (${notes.length}):\n - ${notes.join('\n - ')}`);
console.log(problems.length ? `\nFAILED (${problems.length}):\n - ${problems.join('\n - ')}` : `\n${okLine}`);
process.exit(problems.length ? 1 : 0);
