// Scripted end-to-end run of level 5 "POST 4" (stage 3c, docs/plans/stage-3c.md §10.1). Task T.
//
//   node scripts/playthrough-l5.mjs [baseUrl] [mode] [--choice=stop,command] [--frames] [--max-min=N]
//   modes (one per run; default when none):
//     --contract      only checks that every hook / field / id below exists with the right SHAPE; prints the full list
//                     of what is missing grouped by OWNER (ST, W4, W3b, …); never plays, never hangs. LEVEL5 CONTRACT OK.
//     (default)       the level end to end once per choice (§10.1): every beat in order, doors per phase (§3), gate
//                     2.4 s, the scene (camera on t5_dutydoor, H ≤ 25.0 s, lines ≤ 0.12 s from their cues, units ≥ 8 m
//                     at H + 2.5 ± 0.1, cp5_duty at H), g5_s1 holds then is released, the radio point and its 1.5 m
//                     reach, the squawk at death + 30 s (choice stop waits for it), the pickup sequence order and gaps,
//                     keypad dead before the power cue / live after / Q live, 4719 (and `_9b` when typed during the
//                     sequence — choice command), the spine wave, the neck check (start facing the door → `_3`, start
//                     turned → `_hold`; ±50° of −x passes at pitch −60°), V, lights-out, cp5_door, the bay waves, the
//                     wheel's 4.0 ± 0.1 s, the tunnel latch, end card, carry, stored level. LEVEL5 OK.
//     --checkpoints [--cp=cp5_door]  per cp5_*: play to it, die, load, compare worldState() (H13) + phase, armour,
//                     weapons, facts; finish. + the B1 cases: kill g5_s1, die before the radio → he holds again, the radio
//                     comes back with him; die with the patrol holding → it is absent after the load. LEVEL5 CHECKPOINTS OK.
//     --impatient     wrong order (keypad before power — incl. the right code, the tunnel door before the beat, the wheel
//                     before V, the launch palm), wrong codes (1, then 3), shoots the duty door, the port, the booth
//                     glass, the boat, every body, kills g5_s1 through the door during the unit fight; the line oracle is
//                     strict; choice variants. LEVEL5 IMPATIENT OK.
//     --order [--variant=a,…,f]  §10.1 (a) straight to Kessler's door; (b) every optional room first, crawl last;
//                     (c) crawl first, then the door; (d) sub bay before the door; (e) never the armoury or the crawl;
//                     (f) the launch palm before the door. LEVEL5 ORDER OK.
//     --softlock [--case=a,…,m]  §10.1 (a)–(i) + the review's cases (j) the neck check at the line's edge, (k) `?level=5`
//                     cold (no god, no choice), (l) the keypad code before the power, (m) dying before the radio is taken.
//                     Each reaches l5_end. LEVEL5 SOFTLOCK OK.
//     --scares        each v5_* fires exactly once on a calm route, never with a hostile awake within 30 m (forced fights
//                     on their own pages), ≥ 45 s apart / loud ≥ 90 s, restored by snap on load, every vignette sound
//                     played once (H14 audio log: no doubles story + level). LEVEL5 SCARES OK.
//     --ads           the carbine aimed vs hip at a soldier 20 m away in the spine and in the sub bay, 60 s each:
//                     aimed hit rate ≥ 2 × hip. LEVEL5 ADS OK.
//     --frames        (with any mode) 10 fps sequences of §10.5 → shots/l5/frames/ (expensive; look at them).
//     --probe[=N] [--near=mk_a,mk_b]  dev aid: on level N (default 5, `nostory`) search a stand point in every trigger,
//                     beside every interactable (and 4 m from each `--near` marker) with the same helpers the route uses,
//                     teleport there, report spots not found / pushed.
//   all modes: spawn visibility (watcher + H7.spawnLog), every mk5_ marker inside a room, never `cutscene` outside the
//   scene, no enemy before its beat (only g5_mag dormant from load), every timed line ≤ 0.12 s from its cue, the static
//   pass (lines.l5.json ↔ RULES ↔ manifest, choice pairs, unit lines without uppercase, soldier lines `label` + `throat`,
//   Kessler lines `radio`).
//
// HOW IT IS BUILT (the 3b lessons): positions come from the PAGE (markers, trigger boxes `__game.__triggers`, room
// boxes and floors, interactable and door positions) — never from coordinates written here; every stand point is
// searched free of colliders inside a room interior (0.3 m inset). Every wait is on GAME time / story state with a
// timeout that names what was awaited; a wall-clock cap only catches a stalled game. Every segment declares its needs
// and is SKIPPED with the missing names (and their owners) when any is absent. Cases that cannot share state run in
// their own browser context (own storage). Every failure says which side to suspect: [story] [level] [enemies] [audio]
// [ui] [voices] [test]. A global watchdog (--max-min, default per mode) ends a stuck run with the summary.
//
// ═══════════════════════════════════════════════════════════════════════ HOOK CONTRACT (§10.0 — ST implements)
// On `window.__game.story` (level 5). (K) = exists in K's stub today.
//  H1  end()                     the stage end of §7 (carry, l5_end, card, stored level). (K)
//  H2  checkpoint(id)            write cp5_* now from the current record → true. (K)
//  H3  fire(name) → truthy|null  'gate' 'scene' 'units' 'release_s1' 'radio' 'power' 'code' 'spine_wave' 'boots' 'door'
//                                'verify' 'dark' 'cmd_wave' 'bay_a' 'wheel' 'bay_b' 'tunnel', any vignette id, '<id>:snap'.
//                                null = refused / unknown. (this script uses it only where a case names it)
//  H4  hurry(fast?)              shortens `wait`s, never `hold`s or line gaps. (K)
//  H5  lineLog: { id, t, said, q, dur, end, cue }[]   t = start (script clock = debugState.now), said = the voice line
//                                id (null = dropped), dur + end for every spoken line (end = stopped / cut / finished),
//                                cue for every TIMED line (§4 tables, sequence gaps, the cut, door lines, scare voices);
//                                |t − cue| ≤ 0.12.
//  H6  rules: Record<lineId, { when, else?, once? }>   one entry per l5_ id of voice/lines.l5.json, nothing else.
//  H7  debugState (getter): level 5, now, beats[], t{}, phase, phaseApplied, flags{}, checkpoints[], checkpoint,
//        restoredFrom, calm, doorCalm, heard[], missingMarkers[], loadout, arrival, ended,
//        scares: string[], scareLog: { id, t, room }[],
//        radio: { owned, live, pos: [x,y,z] | null, enabled }, keypad: { powered, open, wrong, accepted },
//        door: { started, check (0 … 1), facing: 'door' | 'away' | 'side', done }, wheel: { startedAt | null, doneAt | null },
//        groups: Record<id, { spawned, alive, awake, holding, triggered }>, scene: { times, result, h },
//        spawnLog: { group, id, t, pos: [x,y,z], visible }[], strays: { id, t }[]
//  H8  beats on `story:beat` (and in debugState.beats): l5_start l5_keypad l5_spine_wave l5_verified l5_dark l5_bay
//        l5_wheel l5_tunnel l5_end (§4); facts on `__game.facts` as earned (l5_door, l5_boat, radio, kessler at the end).
//  H9  `story:objective` / `story:toast` with the exact texts of §6.4.
//  H10 keypad(code)              types `code` into the keypad (opens it when the player is at the panel) and presses ENT.
//  H11 radioAsk()                = pressing Q.
//  H12 soldiers(): { id, group, pos: [x,y,z], state, aware, holding, token, light, cover, hp, suppression, shots, hits,
//        bursts }[]               (enemies.debug.soldiers(), W3b)
//  H13 worldState(): { doors: Record<id, { open, locked, status }>, hatches: { spine, mag }, lightsOut, dark: string[],
//        screens: Record<id, string>, pickups: string[], groups, scares, flags, torch: number }
//  H14 audioLog(): { id, t, pos }[]   (audio.debug.log, W2b)
//      next() → nextOf(5). (K)
// How this script READS the table where §10.0 leaves the detail open (ST: implement it this way):
//  · H7.t = the FIRST script time of every beat id, of `phase:<id>` each phase / variant applied (A B B2 C D0 D K S
//    S_dive V V_lock W W_lock X) and of `vignette:<id>` each vignette the story fires (as level 4).
//  · H7.scene.times = Record<cue, s since the camera was taken> for S1 S2 T1 … T10 H; scene.h = times.H;
//    scene.result = null (not yet) | 'played' | 'skipped'.
//  · H7.door.facing: 'away' = yaw within ±50° of −x (passes), 'door' = within ±90° of +x, 'side' = neither (B3).
//  · H7.groups[g] / H13.groups[g]: spawned (bool), alive / awake / holding (counts), triggered (bool, in prog.triggered).
//  · H7.keypad.wrong = wrong codes so far (number); H7.scareLog.t and spawnLog.t on the script clock.
//  · H13.doors[id].status = 'cycling' | 'dark' | null; hatches.spine / .mag = lid open (bool); screens = text as shown;
//    pickups = taken p5_ ids; torch = the cell 0 … 1.
// NEW — needed by the tests, NOT in §10.0 / §8.10 yet (coordinator: add them there and pass them on):
//  N1 [W4 / D1] `level.object('mk5_glass').userData.panes` = { id, p: [x, y, z] }[] (ids `booth`, `port`, `lock_port`;
//     p = the pane's centre) — --impatient shoots each pane; §8.10 names the list but not where a pane is.
//  (Read from the engine, no change needed: `__game.__triggers` (level/triggers.ts) — the t5_ boxes the script stands
//   in; `audio.debug.log` time is the audio clock, so the watcher stamps each entry with game time when it appears.)
// LEVEL SIDE the script reads [owner]: rooms §2.1, doors §2.2, triggers §2.3 [W4]; markers §8.10 [W4]; interactables
// key5_duty radio5 (story) hatch5_spine hatch5_mag launch5_palm wheel5 + readables §6.3 [W4]; pickups §5.2 [W4];
// screens §6.4 [W4/W5]; groups §5.1 in enemySpawns [W4]; cover 41 points §5.4 [W4]; regions dark crawl magazine booth
// cmd outside voids [W4]; light groups `<room>`, `spine5_emerg`, `sub5_emerg` [D2a/D3]; vignettes §5.5 / §8.7 with
// snaps [D1 D2a D2b D3]; object `tern` (userData.check) [W7]; enemies.release / holding / corpsePoint / rush /
// debug.soldiers [W3b]; audio.debug.log [W2b]; ui.keypad / ui.radio [W2a, K stub]; voice/lines.l5.json + manifest [W9].
// ═══════════════════════════════════════════════════════════════════════
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const base = (argv.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const flagv = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const MODES = ['contract', 'checkpoints', 'impatient', 'order', 'softlock', 'scares', 'ads'];
const MODE = argv.some((a) => a === '--probe' || a.startsWith('--probe=')) ? 'probe' : MODES.find((m) => argv.includes(`--${m}`)) ?? 'default';
const PROBE_LEVEL = Number(flagv('probe') ?? 5);
const CHOICES = flagv('choice')?.split(',') ?? ['stop', 'command'];
const ONLY_CP = flagv('cp');
const VARIANTS = flagv('variant')?.split(',') ?? ['a', 'b', 'c', 'd', 'e', 'f'];
const CASES = flagv('case')?.split(',') ?? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'];
const FRAMES = argv.includes('--frames');
const MAX_MIN = Number(flagv('max-min') ?? { probe: 10, contract: 4, default: 30, checkpoints: 90, impatient: 30, order: 90, softlock: 120, scares: 60, ads: 15 }[MODE]);
const SAVE_KEY = 'coldboot.save.l5.v2', CARRY_KEY = 'coldboot.carry.v2', LEVEL_KEY = 'coldboot.level';
mkdirSync('shots/l5', { recursive: true });
if (FRAMES) mkdirSync('shots/l5/frames', { recursive: true });

// ───────────────────────────────────────────────────────────── the plan's ids (never positions)
const CPS = ['cp5_start', 'cp5_duty', 'cp5_ready', 'cp5_radio', 'cp5_spine', 'cp5_door', 'cp5_bay'];
const ROOMS5 = ['lock5', 'gate5', 'duty5', 'ready5', 'spine5', 'berths5', 'heads5', 'mess5', 'galley5', 'arm5', 'sub5', 'dive5', 'lockacc5', 'tunnel5'];
const SIDE_DOORS = ['d5_berth', 'd5_mess', 'd5_berth_mess', 'd5_heads', 'd5_galley', 'd5_arm', 'd5_arm_bay', 'd5_bay'];
const DOORS5 = ['d5_gate', 'd5_duty', 'd5_ready', 'd5_key', ...SIDE_DOORS, 'd5_dive', 'd5_lockside', 'd5_tunnel'];
const TRIGS5 = ['t5_lock', 't5_gate', 't5_turnstile', 't5_dutydoor', 't5_duty', 't5_ready', 't5_spine_w', 't5_spine_mid', 't5_cmd', 't5_cmd_line', 't5_hatch', 't5_crawl_e', 't5_landing', 't5_mag', 't5_berths', 't5_heads', 't5_mess', 't5_galley', 't5_arm', 't5_bay', 't5_bridge', 't5_wheel', 't5_tunnel'];
/** §8.10 markers; `stand` ones must lie inside a room interior with the 0.3 m inset, the rest (wall-mounted) inside a room. */
const MARKERS_STAND = ['mk5_start', 'mk5_c1_cam0', 'mk5_c1_cam1', 'mk5_c1_sol', 'mk5_c1_door', 'mk5_c1_out', 'mk5_c1_end', 'mk5_duty_u1', 'mk5_duty_u2', 'mk5_s1', 'mk5_helmet_rest', 'mk5_body_a', 'mk5_body_b', 'mk5_boots_stop', 'mk5_patrol_end'];
const MARKERS_WALL = ['mk5_gate_panel', 'mk5_aas_palm', 'mk5_keypad', 'mk5_port', 'mk5_launch', 'mk5_wheel', 'mk5_tern_board', 'mk5_bunk_radio', 'mk5_onpost', 'mk5_locker_slam', 'mk5_trays', 'mk5_oilskin', 'mk5_taps', 'mk5_exit_spine', 'mk5_exit_mag', 'mk5_vent_spine', 'mk5_drain_a', 'mk5_drain_b', 'mk5_dive_door', 'mk5_lockside_door', 'mk5_glass'];
const READABLES5 = ['note5_visitors', 'note5_watch', 'note5_roster', 'note5_locker', 'note5_mess', 'note5_arm', 'note5_mag', 'note5_dive'];
const USES5 = ['key5_duty', 'hatch5_spine', 'hatch5_mag', 'launch5_palm', 'wheel5', ...READABLES5];
const PICKUPS5 = ['p5_gate_med', 'p5_duty_ammo', 'p5_ready_med', 'p5_ready_ammo', 'p5_berth_med', 'p5_berth_shells', 'p5_mess_ammo', 'p5_galley_med', 'p5_arm_vest', 'p5_arm_carbine', 'p5_arm_ammo_1', 'p5_arm_ammo_2', 'p5_arm_shells', 'p5_arm_plate', 'p5_mag_ammo_1', 'p5_mag_ammo_2', 'p5_mag_ammo_3', 'p5_mag_pistol', 'p5_mag_plate_1', 'p5_mag_plate_2', 'p5_mag_med', 'p5_spine_ammo', 'p5_bay_med_1', 'p5_bay_ammo_1', 'p5_wheel_plate', 'p5_wheel_ammo', 'p5_bay_med_2', 'p5_dive_shells', 'p5_tunnel_med'];
const SCREENS5 = ['gate_panel5', 'gate_log', 'aas_palm', 'onpost', 'dock_status', 'key5_panel', 'launch', 'launch5_palm', 'tern_board', 'tunnel_panel', 'cmd_panel'];
/** §5.1: group → members. */
const GROUPS5 = { g5_duty: 2, g5_s1: 1, g5_spine: 3, g5_patrol: 1, g5_mag: 1, g5_cmd: 3, g5_bay_a: 4, g5_bay_b: 4 };
const DORMANT5 = ['g5_mag'];
/** R4: each spawned group's beat (a debugState.t key or a beat id). */
const NEED5 = { g5_duty: 'phase:D0', g5_s1: 'phase:D0', g5_spine: 'l5_spine_wave', g5_patrol: 'vignette:v5_boots', g5_cmd: 'l5_dark', g5_bay_a: 'l5_bay', g5_bay_b: 'l5_wheel' };
/** Spawn visibility: what may have opened in front of a group in the last 3 s (doors | vignettes). */
const OPENING5 = { g5_spine: { doors: ['d5_dive'] }, g5_patrol: { doors: ['d5_bay'] }, g5_cmd: { vig: ['vent5_spine'], doors: ['d5_lockside'] }, g5_bay_a: { doors: ['d5_lockside'] }, g5_bay_b: { vig: ['drain5_a', 'drain5_b'], doors: ['d5_lockside'] } };
/** §5.5 scares: room, loud, sounds (level-owned, the one-owner audit). */
const SCARES5 = {
  v5_turnstile: { room: 'gate5', loud: false, sounds: ['turnstile_click', 'counter_tick'] },
  v5_hull_groan: { room: 'ready5', loud: true, sounds: ['hull_groan_long', 'locker_rattle', 'locker_bang', 'helmet_roll'] },
  v5_bunk_radio: { room: 'berths5', loud: false, sounds: ['radio_on_click', 'radio_static_bed'], line: 'l5_choir_names' },
  v5_trays: { room: 'mess5', loud: true, sounds: ['pump_thump', 'tray_crash', 'cutlery_scatter'] },
  v5_galley_shape: { room: 'galley5', loud: false, sounds: ['fan_start', 'hook_creak'] },
  v5_water: { room: 'heads5', loud: false, sounds: ['water_hammer', 'taps_run', 'drain_gurgle'] },
  v5_body: { room: 'spine5', loud: false, sounds: [] },
  v5_boots: { room: 'spine5', loud: true, sounds: [] },   // its steps are the soldier's (enemies)
  v5_magazine: { room: 'arm5', loud: true, sounds: ['bulb_pop', 'glass_tinkle'], exempt: true },
  v5_sub_check: { room: 'sub5', loud: true, sounds: ['sub_ballast_hiss', 'sub_hatch_clang', 'clamp_cycle', 'sub_systems_hum'] },
};
/** Vignettes and their dressing owner (the contract's snap probe). */
const VIGNETTES5 = {
  D1: ['gate5_open', 'gate5_booth', 'v5_turnstile', 'v5_hull_groan', 'key5_power'],
  D2a: ['hatch5_spine_open', 'hatch5_mag_open', 'v5_magazine', 'cmd5_line', 'cmd5_port_look', 'vent5_spine', 'lights_out5'],
  D2b: ['v5_bunk_radio', 'v5_water', 'v5_trays', 'v5_galley_shape', 'v5_body'],
  D3: ['v5_sub_check', 'wheel5_turn', 'drain5_a', 'drain5_b', 'dark5_on'],
};
const REGIONS5 = ['dark', 'crawl', 'magazine', 'booth', 'cmd', 'outside', 'voids'];
const LIGHT_GROUPS5 = [...ROOMS5.filter((r) => r !== 'lock5'), 'lock5', 'crawl5', 'mag5', 'spine5_emerg', 'sub5_emerg'];
const FIRE5 = ['gate', 'scene', 'units', 'release_s1', 'radio', 'power', 'code', 'spine_wave', 'boots', 'door', 'verify', 'dark', 'cmd_wave', 'bay_a', 'wheel', 'bay_b', 'tunnel'];
const BEATS5 = ['l5_start', 'l5_keypad', 'l5_spine_wave', 'l5_verified', 'l5_dark', 'l5_bay', 'l5_wheel', 'l5_tunnel', 'l5_end'];
const DS_FIELDS = {
  level: 'number', now: 'number', beats: 'array', t: 'object', phase: 'any', phaseApplied: 'any', flags: 'object', checkpoints: 'array',
  checkpoint: 'any', restoredFrom: 'any', calm: 'boolean', doorCalm: 'boolean', heard: 'array', missingMarkers: 'array', loadout: 'any',
  arrival: 'object', ended: 'boolean', scares: 'array', scareLog: 'array', radio: 'object', keypad: 'object', door: 'object', wheel: 'object',
  groups: 'object', scene: 'object', spawnLog: 'array', strays: 'array',
};
const DS_SUB = { radio: ['owned', 'live', 'pos', 'enabled'], keypad: ['powered', 'open', 'wrong', 'accepted'], door: ['started', 'check', 'facing', 'done'], wheel: ['startedAt', 'doneAt'], scene: ['times', 'result', 'h'], arrival: ['from', 'armor'] };
const WS_FIELDS = ['doors', 'hatches', 'lightsOut', 'dark', 'screens', 'pickups', 'groups', 'scares', 'flags', 'torch'];
const SOLDIER_FIELDS = ['id', 'group', 'pos', 'state', 'aware', 'holding', 'token', 'light', 'cover', 'hp', 'suppression', 'shots', 'hits', 'bursts'];
/** §6.2 (frozen with the plan): the 72 line ids. */
const PLAN_LINES = [
  'l5_reyes_c1_1', 'l5_reyes_c1_2', 'l5_reyes_c1_3', 'l5_reyes_c1_4', 'l5_reyes_c1_5', 'l5_reyes_r1', 'l5_reyes_r2',
  'l5_sol_c1_1_stop', 'l5_sol_c1_1_command', 'l5_sol_c1_2',
  ...['down', 'need', 'felt', 'rounds', 'light'].flatMap((k) => [`l5_sol_${k}_stop`, `l5_sol_${k}_command`]),
  'l5_kes_squawk_1', 'l5_kes_squawk_2', 'l5_kes_1', 'l5_kes_2', 'l5_kes_3', 'l5_kes_4', 'l5_kes_5', 'l5_kes_6', 'l5_kes_7', 'l5_kes_8', 'l5_kes_9', 'l5_kes_9b',
  'l5_kes_brekke', 'l5_kes_ack', 'l5_kes_hint_door', 'l5_kes_hint_wheel', 'l5_kes_hint_tunnel', 'l5_kes_busy', 'l5_kes_contact', 'l5_kes_names', 'l5_kes_boat',
  'l5_kes_door_wait', 'l5_kes_door_1', 'l5_kes_door_2', 'l5_kes_door_3', 'l5_kes_door_hold', 'l5_kes_door_3b', 'l5_kes_door_away', 'l5_kes_door_4', 'l5_kes_door_5',
  'l5_kes_door_6', 'l5_kes_door_sunde', 'l5_kes_door_7', 'l5_kes_shot', 'l5_kes_dark', 'l5_kes_bay', 'l5_kes_tunnel', 'l5_kes_end',
  'l5_choir_radio', 'l5_choir_key', 'l5_choir_names', 'l5_choir_door_stop', 'l5_choir_door_command', 'l5_choir_sub_stop', 'l5_choir_sub_command', 'l5_choir_end_stop', 'l5_choir_end_command',
  'l5_unit_gate', 'l5_unit_tunnel_co', 'l5_unit_tunnel_hyd', 'l5_unit_wheel', 'l5_unit_launch_refused',
];
const PAIRS5 = ['l5_sol_c1_1', 'l5_sol_down', 'l5_sol_need', 'l5_sol_felt', 'l5_sol_rounds', 'l5_sol_light', 'l5_choir_door', 'l5_choir_sub', 'l5_choir_end'];
/** §4.4 the pickup sequence: [line, gap after the previous line's end (s)]; the first is 0.4 after the take. */
const SEQ5 = [['l5_kes_1', null], ['l5_reyes_r1', 0.5], ['l5_kes_2', 0.6], ['l5_kes_3', 0.5], ['l5_kes_4', 0.7], ['l5_kes_5', 0.8], ['l5_kes_6', 0.4], ['l5_choir_radio', -0.05], ['l5_kes_7', 0.9], ['l5_reyes_r2', 0.5], ['l5_kes_8', 0.6], ['l5_kes_9|l5_kes_9b', 0.5]];
/** §4.7 after the check: gaps after each line's end. */
const DOOR_AFTER = [['l5_kes_door_5', 0.7], ['l5_kes_door_6', 0.5], ['l5_kes_door_sunde', 0.8], ['l5_kes_door_7', 0.6]];
const LINES_FILE = 'voice/lines.l5.json';
const LINES_JSON = existsSync(LINES_FILE) ? JSON.parse(readFileSync(LINES_FILE, 'utf8')) : null;
const MANIFEST = JSON.parse(readFileSync('voice/manifest.json', 'utf8')).lines ?? {};
const SPEAKER = Object.fromEntries((LINES_JSON ?? []).map((l) => [l.id, l.speaker]));
const KES6_CUT = LINES_JSON?.find((l) => l.id === 'l5_kes_6')?.cut ?? null;
/** §3 doors per phase: L locked (incl. cycling), A auto, O open (held or auto-open), * not judged. */
const PH = {};
PH.A = { d5_gate: '*', d5_duty: 'L', d5_ready: 'L', d5_key: 'L', ...Object.fromEntries(SIDE_DOORS.map((d) => [d, 'A'])), d5_dive: 'L', d5_lockside: 'L', d5_tunnel: 'L' };
PH.B = { ...PH.A, d5_gate: 'O' };
PH.B2 = { ...PH.B, d5_gate: 'L' };
PH.C = { ...PH.B2, d5_duty: '*', d5_ready: '*' };
PH.D0 = { ...PH.C, d5_duty: 'A', d5_ready: 'L' };
PH.D = { ...PH.D0, d5_ready: 'A' };
PH.K = { ...PH.D };
PH.S = { ...PH.K, d5_key: 'A' };
PH.V = { ...PH.S, d5_tunnel: 'L' };
PH.W = { ...PH.V, d5_tunnel: 'A' };
PH.X = { ...PH.W, d5_tunnel: 'L' };
const PH_VARIANT = { S_dive: ['d5_dive', 'O'], V_lock: ['d5_lockside', 'O'], W_lock: ['d5_lockside', 'O'] };
const PH_STATUS = { V: { d5_tunnel: 'cycling' }, K: {}, A: { d5_key: 'dark' } };

// ───────────────────────────────────────────────────────────── report
const problems = [], notes = [];
const bad = (m, suspect = 'test') => { const s = `[${suspect}] ${m}`; problems.push(s); console.log('  !! ' + s); return false; };
const ok = (cond, m, suspect = 'story') => { if (!cond) return bad(m, suspect); console.log('  ok ' + m); return true; };
const note = (m) => { notes.push(m); console.log('  .. ' + m); };
const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));
function finish(code) {
  const okLine = { probe: 'PROBE OK', contract: 'LEVEL5 CONTRACT OK', default: 'LEVEL5 OK', checkpoints: 'LEVEL5 CHECKPOINTS OK', impatient: 'LEVEL5 IMPATIENT OK', order: 'LEVEL5 ORDER OK', softlock: 'LEVEL5 SOFTLOCK OK', scares: 'LEVEL5 SCARES OK', ads: 'LEVEL5 ADS OK' }[MODE];
  if (notes.length) console.log(`\nNOTES (${notes.length}):\n - ${notes.join('\n - ')}`);
  if (problems.length) {
    const by = {};
    for (const p of problems) (by[/^\[(\w+)\]/.exec(p)?.[1] ?? 'test'] ??= []).push(p);
    console.log(`\nFAILED (${problems.length}) — by the side to suspect: ${Object.entries(by).map(([k, v]) => `${k} ${v.length}`).join(', ')}\n - ${problems.join('\n - ')}`);
  } else console.log(`\n${okLine}`);
  process.exit(code ?? (problems.length ? 1 : 0));
}
const watchdog = setTimeout(() => { bad(`WATCHDOG: the ${MODE} run exceeded ${MAX_MIN} min — stopped (the last line above is where it hung)`, 'test'); finish(1); }, MAX_MIN * 60000);
watchdog.unref?.();

// ───────────────────────────────────────────────────────────── in-page watcher + helper library
const INIT = ([C]) => {
  let game;
  const L = window.__L5 = {
    beats: [], beatAt: {}, toasts: [], objectives: [], denied: {}, opened: {}, closing: {}, uses: {}, pickups: [], died: [], spawns: [],
    early: [], cutBad: [], phases: [], phaseAt: {}, doorsAt: {}, lines: [], viol: [], noOracle: [], softLocks: [], cpAt: {}, cpState: {},
    hits: [], fired: [], audio: [], flags: {}, scares: [], dmg: [], states: [], doorCheck: null, seen: {},
  };
  const S = window.__S5 = {};
  Object.defineProperty(window, '__game', { configurable: true, get() { return game; }, set(g) { game = g; install(g); } });
  function install(g) {
    const T = () => g.time;
    const ds = () => { try { return g.story?.debugState ?? null; } catch { return null; } };
    const now = () => ds()?.now ?? null;
    const stamp = () => ({ g: +T().toFixed(3), s: now() });
    const V = () => g.player.position.constructor;
    const doorOf = (id) => g.level?.doors?.find((d) => d.id === id) ?? null;
    S.doorState = (id) => { const d = doorOf(id); return d ? (d.locked ? 'L' : d.isOpen && !d.auto ? 'O' : d.auto ? (d.isOpen ? 'O|A' : 'A') : 'S') : '?'; };
    g.events.on('story:beat', (e) => { L.beats.push(e.id); L.beatAt[e.id] ??= stamp(); });
    g.events.on('story:toast', (e) => L.toasts.push({ ...stamp(), text: e.text }));
    g.events.on('story:objective', (e) => L.objectives.push({ ...stamp(), text: e.text }));
    g.events.on('weapon:fired', () => L.fired.push(T()));
    g.events.on('bullet:impact', (e) => L.hits.push({ t: T(), p: [e.point.x, e.point.y, e.point.z], s: e.surface }));
    g.events.on('door:denied', (e) => { L.denied[e.id] = stamp(); });
    g.events.on('door:opening', (e) => { (L.opened[e.id] ??= []).push(stamp()); });
    g.events.on('door:closing', (e) => { (L.closing[e.id] ??= []).push(stamp()); });
    g.events.on('interact', (e) => { L.uses[e.id] = stamp(); });
    g.events.on('pickup', (e) => L.pickups.push({ ...stamp(), kind: e.kind, amount: e.amount }));
    g.events.on('enemy:died', (e) => L.died.push({ ...stamp(), id: e.id, group: e.group, type: e.type, pos: e.position ? [e.position.x, e.position.y, e.position.z] : null }));
    g.events.on('player:damaged', (e) => L.dmg.push({ t: T(), amount: e.amount }));
    g.events.on('game:state', (e) => L.states.push({ ...stamp(), state: e.state, phase: ds()?.phaseApplied ?? null }));
    // spawn visibility: a new member seen from the eye (frustum + clear ray to its chest) is a pop-in unless its door /
    // vent / drain opened in the last 3 s (doors on game time, vignettes on the script clock)
    g.events.on('enemy:spawned', (ev) => setTimeout(() => {
      const e = g.enemies?.all?.find((x) => x.id === ev.id); if (!e || !g.player || !g.camera) return;
      if (C.DORMANT5.includes(e.group) || /^test/.test(e.group)) return;
      const cam = g.camera; cam.updateMatrixWorld();
      const chest = e.position.clone(); chest.y += e.type === 'skitter' ? 0.3 : 1.3;
      const v = chest.clone().project(cam);
      const seen = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && g.physics.lineOfSight(g.player.eye, chest);
      const op = C.OPENING5[e.group] ?? {}; const d = ds();
      const opened = (op.doors ?? []).some((id) => (L.opened[id] ?? []).some((o) => T() - o.g <= 3)) || (op.vig ?? []).some((id) => d && d.now - (d.t?.['vignette:' + id] ?? -1e9) <= 3);
      L.spawns.push({ group: e.group, id: e.id, type: e.type, t: +T().toFixed(2), s: now(), seen, opened, pos: [e.position.x, e.position.y, e.position.z].map((n) => +n.toFixed(2)), room: g.level.roomAt(e.position)?.id ?? null });
    }, 0));
    setInterval(() => {
      if (!g.ready) return;
      const d = ds(); if (!d) return;
      // never `cutscene` outside the scene (phase C)
      if (g.state === 'cutscene' && d.phaseApplied !== 'C' && d.phase !== 'C') { const k = `${d.phaseApplied}`; if (!L.cutBad.includes(k)) L.cutBad.push(k); }
      // R4: nothing alive before its beat (g5_mag dormant from load; test-spawned groups excepted)
      if (g.enemies) for (const e of g.enemies.all) {
        if (!e.alive || C.DORMANT5.includes(e.group) || /^test/.test(e.group)) continue;
        const need = C.NEED5[e.group];
        const has = need && (d.t?.[need] !== undefined || (d.beats ?? []).includes(need) || L.beats.includes(need));
        if (!has) { const k = `${e.group}@${need ?? '?'}`; if (!L.early.includes(k)) L.early.push(k); }
      }
      // phase changes: when, and the doors 0.3 s later
      const ph = d.phaseApplied;
      if (ph && L.phases[L.phases.length - 1]?.id !== ph) {
        L.phases.push({ id: ph, ...stamp() });
        L.phaseAt[ph] ??= stamp();
        setTimeout(() => {
          const ws = (() => { try { return g.story.worldState?.() ?? null; } catch { return null; } })();
          L.doorsAt[ph] ??= Object.fromEntries(C.DOORS5.map((id) => [id, { st: S.doorState(id), status: ws?.doors?.[id]?.status ?? undefined }]));
        }, 300);
      }
      // flags: first script time each became true (the radio take, the release, the power cue are not beats)
      for (const [k, v] of Object.entries(d.flags ?? {})) if (v && L.flags[k] === undefined) L.flags[k] = stamp();
      // checkpoint written: when, and the world at that instant (compared after the load)
      const cp = d.checkpoint;
      if (cp && !L.cpAt[cp]) { L.cpAt[cp] = { ...stamp(), phase: ph }; try { L.cpState[cp] = g.story.worldState?.() ?? null; } catch { L.cpState[cp] = null; } }
      // the door check: first frame the count runs, the frame it is done
      const dc = d.door;
      if (dc && typeof dc.check === 'number') {
        L.doorCheck ??= { runs: [], done: null };
        const r = L.doorCheck.runs; const last = r[r.length - 1];
        if (dc.check > 0 && (!last || last.end !== undefined)) r.push({ start: T(), s: now(), facing: dc.facing });
        else if (dc.check === 0 && last && last.end === undefined && !dc.done) last.end = T();
        if (dc.done && !L.doorCheck.done) L.doorCheck.done = { ...stamp() };
      }
      // the audio log (H14): stamp every new entry with game time
      try {
        const al = g.story.audioLog?.(); if (Array.isArray(al)) {
          L.audioN ??= 0; L.audioLast ??= null;
          // ring of 512: find the new tail by the last entry seen
          let from = 0;
          if (L.audioLast) { const i = al.findIndex((x) => x === L.audioLast || (x.t === L.audioLast.t && x.id === L.audioLast.id)); from = i >= 0 ? i + 1 : 0; }
          for (let i = from; i < al.length; i++) L.audio.push({ id: al[i].id, at: T(), s: now(), pos: al[i].pos });
          if (al.length) L.audioLast = al[al.length - 1];
        }
      } catch { /* no H14 */ }
      // scares: which fired, with the hostiles around at that moment
      for (const x of d.scareLog ?? []) if (!L.scares.some((y) => y.id === x.id && y.t === x.t)) {
        const p = g.player.position;
        const near = (g.enemies?.all ?? []).filter((e) => e.alive && e.state !== 'dormant' && e.state !== 'dead' && !(d.groups?.[e.group]?.holding > 0 && e.state === 'idle') && e.position.distanceTo(p) <= 30).map((e) => e.group);
        L.scares.push({ ...x, at: T(), near, inCutscene: g.state === 'cutscene' });
      }
    }, 100);
    // ── the line oracle: every spoken line judged from WORLD state on the first poll after it starts (§6.2 rules)
    const P = () => g.player.position;
    const room = () => g.level.roomAt(P())?.id ?? null;
    const phase = () => { const d = ds(); return String(d?.phaseApplied ?? d?.phase ?? ''); };
    const base = () => phase().split('_')[0];
    const RANK = ['A', 'B', 'B2', 'C', 'D0', 'D', 'K', 'S', 'V', 'W', 'X'];
    const rank = () => RANK.indexOf(base());
    const heard = (id) => (ds()?.heard ?? []).includes(id) || (g.story?.lineLog ?? []).some((l) => l.said === id && l.t < (now() ?? 0) - 0.05);
    const within = (st, s) => !!st && T() - st.g <= s;
    const inTrig = (id) => { const t = (g.__triggers ?? []).find((x) => x.id === id); const p = P(); return !!t && p.x >= t.x0 && p.x <= t.x1 && p.z >= t.z0 && p.z <= t.z1 && p.y > (t.y0 ?? -1) && p.y < (t.y1 ?? 4); };
    const yawDeg = () => ((g.player.yaw * 180 / Math.PI) % 360 + 540) % 360 - 180;   // 0 = −z, +90 = −x, −90 = +x
    const facingDoor = () => Math.abs(yawDeg() + 90) <= 90;
    const awayFromDoor = () => Math.abs(yawDeg() - 90) <= 50;
    const hostiles = (r) => (g.enemies?.all ?? []).some((e) => e.alive && e.state !== 'dormant' && e.state !== 'dead' && e.position.distanceTo(P()) <= r && !(ds()?.groups?.[e.group]?.holding > 0 && e.state === 'idle'));
    const mk = (n) => { const o = g.level.object(n); return o ? o.getWorldPosition(o.position.clone()) : null; };
    const radioPos = () => { const p = ds()?.radio?.pos; return Array.isArray(p) ? new (V())(p[0], p[1], p[2]) : null; };
    const soldierNear = (r) => (g.enemies?.all ?? []).some((e) => e.alive && e.type === 'soldier' && e.position.distanceTo(P()) <= r);
    const C2 = (id, pre) => g.facts.choice === id.split('_').pop() && pre;
    const OR = {
      l5_unit_gate: () => base() === 'B2' || within(L.phaseAt.B2, 2),
      l5_unit_tunnel_co: () => within(L.denied.d5_tunnel, 2.5) && base() === 'S',
      l5_unit_tunnel_hyd: () => within(L.denied.d5_tunnel, 2.5) && base() === 'V',
      l5_unit_wheel: () => base() === 'W' || !!ds()?.wheel?.doneAt,
      l5_unit_launch_refused: () => within(L.uses.launch5_palm, 4),
      l5_kes_squawk_2: () => { const r = radioPos(); return !ds()?.radio?.owned && !!r && r.distanceTo(P()) <= 12 && ['duty5', 'ready5'].includes(room()); },
      l5_kes_9: () => !ds()?.keypad?.accepted,
      l5_kes_9b: () => !!ds()?.keypad?.accepted,
      l5_kes_brekke: () => !!ds()?.radio?.owned,
      l5_kes_hint_door: () => base() === 'S',
      l5_kes_hint_wheel: () => base() === 'V',
      l5_kes_hint_tunnel: () => base() === 'W',
      l5_kes_busy: () => hostiles(25),
      l5_kes_contact: () => !!ds()?.groups?.g5_spine?.spawned && room() !== 'sub5',
      l5_kes_names: () => heard('l5_choir_names'),
      l5_kes_boat: () => g.facts.l5_boat === true || (() => { const p = mk('mk5_launch'); return !!p && p.distanceTo(g.player.eye) <= 4.5; })(),
      l5_kes_door_wait: () => inTrig('t5_cmd') && base() === 'S',
      l5_kes_door_1: () => !!ds()?.door?.started,
      l5_kes_door_3: () => inTrig('t5_cmd_line') && facingDoor(),
      l5_kes_door_hold: () => inTrig('t5_cmd_line') && !facingDoor(),
      l5_kes_door_3b: () => facingDoor(),
      l5_kes_door_away: () => !inTrig('t5_cmd_line'),
      l5_kes_shot: () => { const p = mk('mk5_port'); return !!p && L.hits.some((h) => T() - h.t <= 3 && Math.hypot(h.p[0] - p.x, h.p[2] - p.z) <= 2.0); },
      l5_kes_dark: () => (ds()?.beats ?? []).includes('l5_dark'),
      l5_kes_bay: () => !!ds()?.groups?.g5_bay_a?.spawned,
      l5_kes_tunnel: () => base() === 'W' || base() === 'X',
      l5_kes_end: () => base() === 'X' && !(g.enemies?.all ?? []).some((e) => e.alive && g.level.roomAt(e.position)?.id === 'tunnel5'),
      l5_choir_key: () => within(L.beatAt.l5_keypad, 2.2),
    };
    for (const c of ['stop', 'command']) {
      OR[`l5_sol_c1_1_${c}`] = () => C2(`x_${c}`, base() === 'C');
      OR[`l5_choir_door_${c}`] = () => C2(`x_${c}`, heard('l5_kes_door_7'));
      OR[`l5_choir_sub_${c}`] = () => C2(`x_${c}`, (ds()?.scares ?? []).includes('v5_sub_check') || rank() >= RANK.indexOf('V'));
      OR[`l5_choir_end_${c}`] = () => C2(`x_${c}`, base() === 'X' && heard('l5_kes_end'));
      for (const k of ['down', 'need', 'felt', 'rounds']) OR[`l5_sol_${k}_${c}`] = () => C2(`x_${c}`, soldierNear(15.5));
      OR[`l5_sol_light_${c}`] = () => C2(`x_${c}`, soldierNear(25.5) && g.player.flashlightOn);
    }
    const UNCOND = new Set(C.UNCOND);
    let judged = 0;
    setInterval(() => {
      const log = g.story?.lineLog; if (!Array.isArray(log)) return;
      for (; judged < log.length; judged++) {
        const l = log[judged]; const id = l?.said; if (!id) continue;
        let okk = true, why = '';
        try {
          if (OR[id]) { okk = !!OR[id](); if (!okk) why = 'oracle false'; }
          else if (!UNCOND.has(id) && !L.noOracle.includes(id)) L.noOracle.push(id);
          if (/_(stop|command)$/.test(id) && !id.endsWith('_' + g.facts.choice)) { okk = false; why = `variant of the other choice (${g.facts.choice})`; }
        } catch (err) { okk = false; why = 'oracle threw: ' + err.message; }
        const rec = { id, t: +T().toFixed(1), s: l.t, ok: okk, room: room(), phase: phase(), pos: [P().x, P().y, P().z].map((v) => +v.toFixed(1)) };
        L.lines.push(rec);
        if (!okk) L.viol.push({ ...rec, why });
      }
    }, 100);
    // ── the soft-lock oracle (§9): a timed transition that never comes
    const since = {};
    const mark = (k, on, lim, why) => { if (!on) { delete since[k]; return; } since[k] ??= T(); if (T() - since[k] > lim && !L.softLocks.some((x) => x.k === k)) L.softLocks.push({ k, t: +T().toFixed(1), why, phase: phase() }); };
    setInterval(() => {
      if (!g.ready || !['playing', 'cutscene'].includes(g.state)) return;
      const d = ds(); if (!d) return;
      mark('A', base() === 'A', 8, 'the gate never opened (phase A > 8 s; §4.1: B at 2.8 s)');
      mark('B2', base() === 'B2' && inTrig('t5_dutydoor'), 4, 'B2 with the player at the duty door for 4 s and no scene (polled trigger + ≤ 1.5 s line wait)');
      mark('C', base() === 'C', 28, 'the scene lasted > 28 s (H ≤ 25 s)');
      mark('D0', base() === 'D0', 5, 'D0 > 5 s (units door at H + 2.5)');
      mark('W', !!d.wheel?.startedAt && !d.wheel?.doneAt, 7, 'the wheel never finished (4.0 s fixed clock)');
      mark('X', base() === 'X' && !(d.beats ?? []).includes('l5_end') && !(g.enemies?.all ?? []).some((e) => e.alive && g.level.roomAt(e.position)?.id === 'tunnel5'), 16, 'no end 16 s after the latch with the tunnel clear (cap 8 s after X + lines)');
    }, 200);

    // ── the helper library the node side calls (positions FROM THE PAGE)
    const los = (a, b) => g.physics.lineOfSight(a, b);
    S.trig = (id) => (g.__triggers ?? []).find((t) => t.id === id) ?? null;
    S.mk = (n) => { const p = mk(n); return p ? [p.x, p.y, p.z] : null; };
    S.interior = (x, z, inset = 0.3) => {
      const r = g.level.roomAt(new (V())(x, 0, z)); if (!r) return null;
      const b = r.bounds, k = 0.2 + inset;
      return x >= b.min.x + k && x <= b.max.x - k && z >= b.min.z + k && z <= b.max.z - k ? r.id : null;
    };
    /** Walkable floor heights at (x, z): the room's main floor and every `floors` box containing it. */
    S.floors = (x, z) => {
      const r = g.level.roomAt(new (V())(x, 0, z)); if (!r) return [];
      const ys = [r.floor ?? r.y0 ?? 0];
      for (const f of r.floors ?? []) if (x >= f.box[0] && x <= f.box[1] && z >= f.box[2] && z <= f.box[3]) ys.push(f.y);
      return [...new Set(ys)];
    };
    /** A capsule-sized free spot (floor under, nothing within 0.45 m at knee and chest — capsule r 0.35 + 0.1, head room). */
    S.free = (x, y, z, crouch = false) => {
      const v = (a, b, c) => new (V())(a, b, c);
      if (los(v(x, y + 0.35, z), v(x, y - 0.35, z))) return false;   // no floor
      const hs = crouch ? [0.35, 0.8] : [0.45, 1.25];
      for (const h of hs) for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, o = v(x + Math.cos(a) * 0.45, y + h, z + Math.sin(a) * 0.45), c = v(x, y + h, z);
        if (!los(c, o) || !los(o, c)) return false;
      }
      return los(v(x, y + 0.4, z), v(x, y + (crouch ? 1.12 : 1.85), z));
    };
    const face = (from, to) => { const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]; return { yaw: Math.atan2(-dx, -dz) * 180 / Math.PI, pitch: Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI }; };
    /** Nearest free spot to (cx, cz) on floor y inside the plan box b = [x0, x1, z0, z1] and a room interior. */
    S.search = (cx, cz, y, b, o = {}) => {
      for (let r = 0; r <= (o.maxR ?? 3.2); r += 0.3) {
        const n = r === 0 ? 1 : Math.max(8, Math.round(2 * Math.PI * r / 0.3));
        for (let k = 0; k < n; k++) {
          const a = k * 2 * Math.PI / n, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
          if (b && (x < b[0] || x > b[1] || z < b[2] || z > b[3])) continue;
          if ((o.away ?? []).some((id) => { const t = S.trig(id); return t && x >= t.x0 - 0.4 && x <= t.x1 + 0.4 && z >= t.z0 - 0.4 && z <= t.z1 + 0.4; })) continue;
          const rm = S.interior(x, z, 0.3); if (!rm || (o.room && rm !== o.room)) continue;
          if (!S.floors(x, z).some((fy) => Math.abs(fy - y) < 0.05)) continue;
          if (!S.free(x, y, z, o.crouch)) continue;
          return [x, y, z, rm];
        }
      }
      return null;
    };
    /** Stand points. kind: trig | use | mk | room | door. Returns { x, y, z, yaw, pitch, room } or { err }. */
    S.spot = (kind, id, o = {}) => {
      let p = null, why = '';
      if (kind === 'trig') {
        const t = S.trig(id); if (!t) return { err: `trigger ${id} missing (level: __game.__triggers)` };
        const cx = t.x0 + (t.x1 - t.x0) * (o.fx ?? 0.5), cz = t.z0 + (t.z1 - t.z0) * (o.fz ?? 0.5);
        const ys = S.floors(cx, cz).filter((y) => y > (t.y0 ?? -1) && y < (t.y1 ?? 4));
        const y = o.y ?? ys.sort((a, b) => b - a)[0];
        if (y === undefined) return { err: `trigger ${id}: no floor of room ${g.level.roomAt(new (V())(cx, 0, cz))?.id ?? '—'} within its y range ${t.y0}…${t.y1}` };
        const m = 0.38;
        p = S.search(cx, cz, y, [t.x0 + m, t.x1 - m, t.z0 + m, t.z1 - m], o);
        why = `no free spot in ${id}`;
      } else if (kind === 'use' || kind === 'near') {
        // 'use': beside interactable `id` within its radius; 'near': `o.dist` m from marker `id` (or point o.p)
        let ip, r;
        if (kind === 'use') { const i = g.interactables.get(id); if (!i) return { err: `interactable ${id} missing` }; ip = i.position; r = i.radius ?? 2.2; }
        else { const m = o.p ? new (V())(...o.p) : mk(id); if (!m) return { err: `marker ${id} missing` }; ip = m; r = Infinity; }
        const eyeH = o.crouch ? 0.98 : 1.65;
        let dist = o.dist ?? Math.min(1.1, r - 0.4);
        if (o.eye) { const fy = S.floors(ip.x, ip.z).filter((y) => y <= ip.y + 0.3).sort((a2, b2) => b2 - a2)[0] ?? ip.y; const dy = fy + eyeH - ip.y; dist = Math.sqrt(Math.max(0.09, o.eye * o.eye - dy * dy)); }
        for (const dd of [dist, dist - 0.25, dist + 0.25, dist + 0.5, dist - 0.45, dist + 0.75, dist + 1.0]) {
          if (dd <= 0.3) continue;
          for (let k = 0; k < 24 && !p; k++) {
            const a = k * Math.PI / 12, x = ip.x + Math.cos(a) * dd, z = ip.z + Math.sin(a) * dd;
            const rm = S.interior(x, z, 0.3); if (!rm || (o.room && rm !== o.room)) continue;
            const y = S.floors(x, z).filter((fy) => fy <= ip.y + 0.3 && fy >= ip.y - 2.8).sort((a2, b2) => b2 - a2)[0];
            if (y === undefined || !S.free(x, y, z, o.crouch)) continue;
            const eye = new (V())(x, y + eyeH, z), to = ip.clone().add(eye.clone().sub(ip).setLength(0.12));
            if (eye.distanceTo(ip) > r - 0.05 || (o.los !== false && !los(eye, to))) continue;
            p = [x, y, z, rm];
          }
          if (p) break;
        }
        why = `no free spot ${dist.toFixed(2)} m from ${id} with a clear eye ray${o.room ? ' in ' + o.room : ''}`;
        if (p) { const f = face([p[0], p[1] + eyeH, p[2]], [ip.x, ip.y, ip.z]); return { x: p[0], y: p[1], z: p[2], room: p[3], yaw: o.yaw ?? f.yaw, pitch: o.pitch ?? f.pitch }; }
      } else if (kind === 'mk') {
        const m = mk(id); if (!m) return { err: `marker ${id} missing` };
        const y = o.y ?? m.y;
        p = o.exact ? [m.x, y, m.z, S.interior(m.x, m.z, 0.3)] : S.search(m.x, m.z, y, null, { ...o, maxR: o.maxR ?? 2.0 });
        why = `no free spot within 2 m of ${id}`;
      } else if (kind === 'room') {
        const r = g.level.rooms.find((x) => x.id === id); if (!r) return { err: `room ${id} missing` };
        const b = r.bounds, k = 0.55;
        const cx = b.min.x + (b.max.x - b.min.x) * (o.fx ?? 0.5), cz = b.min.z + (b.max.z - b.min.z) * (o.fz ?? 0.5);
        p = S.search(cx, cz, o.y ?? r.floor ?? r.y0 ?? 0, [b.min.x + k, b.max.x - k, b.min.z + k, b.max.z - k], { ...o, room: id, maxR: o.maxR ?? 5 });
        why = `no free spot in room ${id}`;
      } else if (kind === 'door') {
        const d = doorOf(id); if (!d) return { err: `door ${id} missing` };
        const r = g.level.rooms.find((x) => x.id === o.room); if (!r) return { err: `room ${o.room} missing` };
        const dp = d.position, c = r.bounds.getCenter(new (V())());
        // the door sits on the room's boundary: step into the room along the axis whose bound it lies on
        const b = r.bounds, onX = Math.min(Math.abs(dp.x - b.min.x), Math.abs(dp.x - b.max.x)) < Math.min(Math.abs(dp.z - b.min.z), Math.abs(dp.z - b.max.z));
        const dist = o.dist ?? 1.5;
        const cx = onX ? dp.x + Math.sign(c.x - dp.x) * dist : dp.x, cz = onX ? dp.z : dp.z + Math.sign(c.z - dp.z) * dist;
        p = S.search(cx, cz, d.y ?? 0, null, { ...o, maxR: o.maxR ?? 1.2 });
        why = `no free spot ${dist} m into ${o.room} from ${id}`;
      }
      if (!p) return { err: why };
      const look = o.look ?? null;
      const f = look ? face([p[0], p[1] + 1.65, p[2]], look) : { yaw: o.yaw ?? 0, pitch: o.pitch ?? 0 };
      return { x: p[0], y: p[1], z: p[2], room: p[3], yaw: o.yaw ?? f.yaw, pitch: o.pitch ?? f.pitch };
    };
    S.tp = (s, crouch = false) => {
      if (crouch) g.player.debug.crouch?.(true);
      g.player.teleport(new (V())(s.x, s.y, s.z), s.yaw * Math.PI / 180, s.pitch * Math.PI / 180);
      return true;
    };
    S.kill = (groups) => {
      let n = 0;
      for (const e of [...g.enemies.all]) {
        if (!e.alive || e.state === 'dormant' || (groups && !groups.includes(e.group))) continue;
        for (let k = 0; k < 10 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone().setY(e.position.y + 1.2), normal: new (V())(0, 0, 1), distance: 1, part: 'torso' }, 500, new (V())(0, 0, -1));
        n++;
      }
      return n;
    };
    S.alive = (group) => g.enemies.all.filter((e) => e.alive && e.group === group).map((e) => ({ id: e.id, type: e.type, state: e.state, pos: [e.position.x, e.position.y, e.position.z].map((v) => +v.toFixed(2)) }));
    S.view = (p, deg = 50) => { const eye = g.player.eye, f = g.player.forward, d = new (V())(p[0], p[1], p[2]).sub(eye), l = d.length() || 1; return Math.acos(Math.max(-1, Math.min(1, d.dot(f) / l))) * 180 / Math.PI <= deg && los(eye, new (V())(p[0], p[1], p[2])); };
    S.face = face;
  }
};

// ───────────────────────────────────────────────────────────── browser, sessions (own storage per case)
const UNCOND = ['l5_reyes_c1_1', 'l5_reyes_c1_2', 'l5_reyes_c1_3', 'l5_reyes_c1_4', 'l5_reyes_c1_5', 'l5_sol_c1_2', 'l5_kes_squawk_1', 'l5_kes_1', 'l5_kes_2', 'l5_kes_3', 'l5_kes_4', 'l5_kes_5', 'l5_kes_6', 'l5_kes_7', 'l5_kes_8', 'l5_kes_ack', 'l5_kes_door_2', 'l5_kes_door_4', 'l5_kes_door_5', 'l5_kes_door_6', 'l5_kes_door_sunde', 'l5_kes_door_7', 'l5_reyes_r1', 'l5_reyes_r2', 'l5_choir_radio', 'l5_choir_names'];
const CONST = { DORMANT5, NEED5, OPENING5, DOORS5, UNCOND };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
let ctxB = null, page = null, sessionLabel = '';
async function session(label) {
  if (ctxB) await ctxB.close().catch(() => {});
  sessionLabel = label;
  ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await ctxB.addInitScript(INIT, [CONST]);
  page = await ctxB.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  [console.error] ${m.text().slice(0, 240)}`); });
  page.on('pageerror', (e) => bad(`pageerror (${sessionLabel}): ${e.message}`, 'story'));
}
const ev = async (fn, arg, ms = 30000) => {
  let to;
  try { return await Promise.race([page.evaluate(fn, arg), new Promise((_, rej) => { to = setTimeout(() => rej(new Error(`page.evaluate timed out after ${ms / 1000} s`)), ms); })]); }
  finally { clearTimeout(to); }
};
const evs = (fn, arg, ms) => ev(fn, arg, ms).catch((e) => ({ __err: e.message }));
const pwait = (ms) => page.waitForTimeout(ms);   // pacing only (input cadence, frames) — never to wait for a game event
/** Wait IN THE PAGE until `cond` (JS expression over g = __game, d = debugState, L = watcher, S = helpers) holds, for at
 *  most `gameSec` seconds of GAME time; a wall cap (3 × + 20 s) only catches a stalled clock. Fails naming `what`. */
async function untilG(cond, gameSec, what, suspect = 'story', { quiet = false } = {}) {
  const t0 = await evs(() => window.__game?.time ?? 0);
  if (t0?.__err) return quiet ? false : bad(`waited for ${what}: the page did not answer (${t0.__err})`, 'test');
  const cap = (gameSec * 3 + 20) * 1000;
  let res = 'wall';
  try {
    const h = await page.waitForFunction(([cond, t0, gs]) => {
      const g = window.__game; if (!g) return false;
      let d = null; try { d = g.story?.debugState ?? null; } catch { /* ignore */ }
      let v = false; try { v = !!new Function('g', 'd', 'L', 'S', `return (${cond});`)(g, d, window.__L5, window.__S5); } catch { v = false; }
      if (v) return 'ok';
      if (g.time - t0 > gs) return 'timeout';
      return false;
    }, [cond, t0, gameSec], { timeout: cap, polling: 100 });
    res = await h.jsonValue();
  } catch { res = 'wall'; }
  if (res === 'ok') return true;
  if (!quiet) {
    const st = await evs(() => ({ state: window.__game?.state, phase: window.__game?.story?.debugState?.phaseApplied, now: window.__game?.story?.debugState?.now }));
    bad(`waited for ${what}: ${res === 'timeout' ? `not within ${gameSec} s of game time` : `game clock stalled (wall cap ${Math.round(cap / 1000)} s)`} (state ${st.state}, phase ${st.phase}, now ${f2(st.now)})`, suspect);
  }
  return false;
}
const gameWait = (sec) => untilG('false', sec, `${sec} s of game time`, 'test', { quiet: true });   // a deliberate idle on GAME time
async function boot(query = '', { god = true } = {}) {
  // `handoff=1`: a test run stores the end (carry, stored level) as a real one does (K stub / chain.ts)
  const url = `${base}/?level=5&autostart=1&handoff=1${god ? '&god=1' : ''}${query}`;
  for (let i = 0; ; i++) {
    try { await page.goto(url, { waitUntil: 'load', timeout: 60000 }); break; } catch (e) { if (i >= 2) return bad(`boot ${url}: ${e.message}`, 'test'); await pwait(700); }
  }
  try { await page.waitForFunction(() => window.__game?.ready && window.__game.story && window.__game.levelId, null, { timeout: 120000 }); }
  catch { return bad(`level 5 did not become ready in 120 s (${url})`, 'story'); }
  return true;
}
const dbg = async () => { const d = await evs(() => { try { return window.__game.story.debugState ?? null; } catch (e) { return { __err: e.message }; } }); return d && !d.__err ? d : {}; };
const L5 = () => ev(() => window.__L5);
const S5 = (name, ...a) => ev(([name, a]) => window.__S5[name](...a), [name, a]);
/** Stand somewhere the page says (see S.spot); false (and a [test]/[level] failure) if no such spot. */
async function stand(kind, id, o = {}, crouch = false) {
  const s = await S5('spot', kind, id, o).catch((e) => ({ err: e.message }));
  if (!s || s.err) return bad(`stand at ${kind} ${id}: ${s?.err ?? 'no answer'}`, /missing/.test(s?.err ?? '') ? 'level' : 'test');
  await S5('tp', s, crouch || !!o.crouch);
  await gameWait(0.15);
  const p = await ev(() => window.__game.player.position.toArray());
  if (Math.hypot(p[0] - s.x, p[2] - s.z) > 0.35) note(`stand ${kind} ${id}: pushed from (${[s.x, s.y, s.z].map(f2)}) to (${p.map(f2)}) — a collider the free-spot probe missed`);
  if (FRAMES_SPOTS) await page.screenshot({ path: `shots/l5/spot-${kind}-${id}.png` }).catch(() => {});
  return s;
}
const FRAMES_SPOTS = argv.includes('--spots');
const look = (p, pitchOverride) => ev(([p, po]) => { const g = window.__game, e = g.player.eye; const dx = p[0] - e.x, dy = p[1] - e.y, dz = p[2] - e.z; g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = po ?? Math.atan2(dy, Math.hypot(dx, dz)); }, [p, pitchOverride ?? null]);
const setYaw = (deg, pitchDeg = 0) => ev(([y, p]) => { const g = window.__game; g.player.yaw = y * Math.PI / 180; g.player.pitch = p * Math.PI / 180; }, [deg, pitchDeg]);
const use = (id) => ev((id) => { const g = window.__game; const i = g.interactables.get(id); if (!i) return 'missing'; if (!i.enabled) return 'disabled'; g.interactables.use(i); return 'ok'; }, id);
const deny = (id) => ev((id) => { const g = window.__game; const d = g.level.doors.find((x) => x.id === id); if (!d) return false; g.events.emit('door:denied', { id, position: d.position }); return true; }, id);
const closeNote = () => ev(() => window.__game.ui.closeNote?.());
const heard = (id) => ev((id) => (window.__game.story.lineLog ?? []).some((l) => l.said === id), id);
const lineOf = (id) => ev((id) => (window.__game.story.lineLog ?? []).filter((l) => l.said === id).slice(-1)[0] ?? null, id);
const heardWait = (id, gs, suspect = 'story', why = '') => untilG(`(g.story.lineLog ?? []).some((l) => l.said === ${JSON.stringify(id)})`, gs, `line ${id}${why ? ' (' + why + ')' : ''}`, suspect);
const beatWait = (id, gs, why = '') => untilG(`(d.beats ?? []).includes(${JSON.stringify(id)})`, gs, `beat ${id}${why ? ' (' + why + ')' : ''}`);
const phaseWait = (p, gs, why = '') => untilG(`d.phaseApplied === ${JSON.stringify(p)} || d.phase === ${JSON.stringify(p)}`, gs, `phase ${p}${why ? ' (' + why + ')' : ''}`);
const phaseSeen = (p, gs) => untilG(`L.phaseAt[${JSON.stringify(p)}] !== undefined`, gs, `phase ${p} applied`);
const cpWait = (cp, gs, why = '') => untilG(`(d.checkpoints ?? []).includes(${JSON.stringify(cp)})`, gs, `${cp} written${why ? ' (' + why + ')' : ''}`);
const objectiveSeen = (text, gs = 4) => untilG(`L.objectives.some((x) => x.text === ${JSON.stringify(text)})`, gs, `objective "${text}"`, 'story');
const toastSeen = (re, gs = 4) => untilG(`L.toasts.some((x) => new RegExp(${JSON.stringify(re)}, 'i').test(x.text))`, gs, `toast /${re}/`, 'story');
const kill = (groups) => S5('kill', groups ?? null);
/** Kill awake members (of `groups`) until `cond` holds, on game time. */
const killUntil = (cond, gs, what, groups = null) => untilG(`(S.kill(${JSON.stringify(groups)}), ${cond})`, gs, what, 'enemies');
const tOf = async (k) => (await dbg()).t?.[k] ?? null;
const choiceOf = () => ev(() => window.__game.facts.choice);
const ws = () => evs(() => { try { return window.__game.story.worldState?.() ?? null; } catch (e) { return { __err: e.message }; } });
const film = async (name, cond, maxGame = 12) => {
  if (!FRAMES) return;
  const t0 = await ev(() => window.__game.time);
  for (let i = 0; i < 400; i++) {
    const st = await evs(([c, t0, m]) => { const g = window.__game; let d = null; try { d = g.story.debugState; } catch { /* */ } let v = false; try { v = c ? !!new Function('g', 'd', 'L', `return (${c});`)(g, d, window.__L5) : false; } catch { /* */ } return v || g.time - t0 > m; }, [cond, t0, maxGame]);
    if (st === true) break;
    await page.screenshot({ path: `shots/l5/frames/${name}-${String(i).padStart(3, '0')}.png` }).catch(() => {});
    await pwait(60);
  }
};
/** §3: the doors recorded 0.3 s after `phase` was applied match the table. */
async function checkDoors(phase) {
  await untilG(`!!L.doorsAt[${JSON.stringify(phase)}]`, 2, `doors recorded at phase ${phase}`, 'test', { quiet: true });
  const got = (await L5()).doorsAt[phase];
  if (!got) return bad(`doors at phase ${phase}: not recorded (phase never applied?)`, 'story');
  const match = (st, w) => w === '*' || st === '?' || (w === 'O' ? /^O/.test(st) : w === 'A' ? /A/.test(st) : st === w);
  if (PH_VARIANT[phase]) { const [id, w] = PH_VARIANT[phase]; return ok(match(got[id].st, w), `phase ${phase}: ${id} ${got[id].st} (want ${w})`, 'story'); }
  const want = PH[phase]; if (!want) return true;
  const diff = Object.entries(want).filter(([id, w]) => !match(got[id]?.st ?? '?', w)).map(([id, w]) => `${id} ${got[id]?.st}≠${w}`);
  for (const [id, s] of Object.entries(PH_STATUS[phase] ?? {})) if (got[id]?.status !== undefined && got[id].status !== s) diff.push(`${id} status ${got[id].status}≠${s}`);
  return ok(!diff.length, `phase ${phase}: doors per §3${diff.length ? ' — ' + diff.join(', ') : ''}`, 'story');
}
/** A line's start relative to a reference (script clock), with the plan's value and tolerance. */
const near = (v, want, tol = 0.12) => typeof v === 'number' && Math.abs(v - want) <= tol;

// ───────────────────────────────────────────────────────────── needs → owners (for skips and --contract)
const OWNER_OF_VIG = Object.fromEntries(Object.entries(VIGNETTES5).flatMap(([o, ids]) => ids.map((i) => [i, o])));
function ownerOf(need) {
  const [k, id] = need.split(':');
  if (k === 'hook' || k === 'ds' || k === 'ws' || k === 'shape') return 'ST';
  if (k === 'vig') return OWNER_OF_VIG[id.split(' ')[0]] ?? 'D*';
  if (k === 'light') return /^(spine5|crawl5|arm5|mag5)/.test(id) ? 'D2a' : /^(sub5|dive5|lockacc5|tunnel5)/.test(id) ? 'D3' : /^(berths5|heads5|mess5|galley5)/.test(id) ? 'D2b' : 'D1';
  if (k === 'enemies') return 'W3b';
  if (k === 'audio') return 'W2b';
  if (k === 'ui') return 'W2a';
  if (k === 'voice') return 'W9';
  if (k === 'obj' && id === 'tern') return 'W7';
  return 'W4';
}
/** In-page existence test of needs: door: room: trig: mk: use: pickup: screen: group: region: cover: hook: ds: light: obj: enemies: audio: ui: */
const missingOf = (needs) => evs((needs) => {
  const g = window.__game, s = g.story; let d = {}; try { d = s.debugState ?? {}; } catch { d = {}; }
  const lg = g.render?.lights?.groups; const groups = lg instanceof Map ? [...lg.keys()] : Object.keys(lg ?? {});
  const out = [];
  for (const n of needs) {
    const [k, id] = n.split(':');
    const has = {
      door: () => g.level.doors.some((x) => x.id === id),
      room: () => g.level.rooms.some((r) => r.id === id),
      trig: () => (g.__triggers ?? []).some((t) => t.id === id),
      mk: () => !!g.level.object(id),
      obj: () => !!g.level.object(id),
      use: () => !!g.interactables.get(id),
      pickup: () => g.level.pickupSpawns.some((p) => p.id === id),
      screen: () => !!g.level.screen(id),
      group: () => g.level.enemySpawns.some((e) => e.group === id),
      region: () => Array.isArray(g.level.regions?.[id]),
      cover: () => (g.level.cover ?? []).some((c) => c.set === id),
      hook: () => typeof s?.[id] === 'function' || (id === 'lineLog' && Array.isArray(s?.lineLog)) || (id === 'rules' && s?.rules && typeof s.rules === 'object' && Object.keys(s.rules).length > 0),
      ds: () => d[id] !== undefined,
      light: () => groups.includes(id),
      enemies: () => id === 'debug.soldiers' ? typeof g.enemies.debug?.soldiers === 'function' : typeof g.enemies[id] === 'function',
      audio: () => Array.isArray(g.audio.debug?.log) || typeof g.audio.debug?.log === 'function',
      ui: () => typeof g.ui[id] === 'function',
    }[k];
    if (!has || !has()) out.push(n);
  }
  return out;
}, needs).then((r) => (Array.isArray(r) ? r : needs));

// ───────────────────────────────────────────────────────────── --contract (and the preflight of every mode)
async function contract({ full = true } = {}) {
  console.log('── contract: §10.0 hooks, debugState fields and shapes, level ids, module extras');
  const need = [
    ...['end', 'checkpoint', 'fire', 'hurry', 'lineLog', 'rules', 'keypad', 'radioAsk', 'soldiers', 'worldState', 'audioLog', 'next'].map((h) => `hook:${h}`),
    ...Object.keys(DS_FIELDS).map((k) => `ds:${k}`),
    ...ROOMS5.map((r) => `room:${r}`), ...DOORS5.map((x) => `door:${x}`), ...TRIGS5.map((x) => `trig:${x}`),
    ...[...MARKERS_STAND, ...MARKERS_WALL].map((m) => `mk:${m}`), 'obj:tern', ...USES5.map((u) => `use:${u}`), ...PICKUPS5.map((p) => `pickup:${p}`),
    ...SCREENS5.map((x) => `screen:${x}`), ...Object.keys(GROUPS5).map((x) => `group:${x}`), ...REGIONS5.map((r) => `region:${r}`),
    ...['ready', 'duty', 'spine', 'floor', 'gallery_w', 'gallery_e'].map((c) => `cover:${c}`), ...LIGHT_GROUPS5.map((l) => `light:${l}`),
    ...['release', 'holding', 'corpsePoint', 'rush', 'debug.soldiers'].map((x) => `enemies:${x}`), 'audio:debug.log', ...['keypad', 'radio', 'closeKeypad'].map((x) => `ui:${x}`),
  ];
  const miss = await missingOf(need);
  // shapes of what exists
  const shape = await evs(([DSF, DSS, WSF, SOLF, BEATS]) => {
    const g = window.__game, s = g.story, out = [];
    const ty = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
    let d = null; try { d = s.debugState; } catch (e) { out.push(`debugState getter throws: ${e.message}`); }
    if (d) {
      if (d.level !== 5) out.push(`debugState.level ${d.level} (want 5)`);
      for (const [k, t] of Object.entries(DSF)) if (d[k] !== undefined && t !== 'any' && ty(d[k]) !== t) out.push(`debugState.${k}: ${ty(d[k])} (want ${t})`);
      for (const [k, sub] of Object.entries(DSS)) if (d[k] && typeof d[k] === 'object') for (const f of sub) if (!(f in d[k])) out.push(`debugState.${k}.${f} missing`);
      if (d.door && d.door.facing !== undefined && !['door', 'away', 'side', null].includes(d.door.facing)) out.push(`debugState.door.facing "${d.door.facing}" (want door | away | side)`);
      if (d.door && d.door.check !== undefined && !(typeof d.door.check === 'number' && d.door.check >= 0 && d.door.check <= 1)) out.push(`debugState.door.check ${d.door.check} (want 0 … 1)`);
      if (d.radio && d.radio.pos !== undefined && d.radio.pos !== null && !(Array.isArray(d.radio.pos) && d.radio.pos.length === 3)) out.push(`debugState.radio.pos ${JSON.stringify(d.radio.pos)} (want [x,y,z] | null)`);
      if (d.keypad && d.keypad.wrong !== undefined && typeof d.keypad.wrong !== 'number') out.push(`debugState.keypad.wrong: ${ty(d.keypad.wrong)} (want number)`);
      if (d.groups && typeof d.groups === 'object') {
        const gs = Object.keys(d.groups);
        for (const gid of ['g5_duty', 'g5_s1', 'g5_spine', 'g5_patrol', 'g5_mag', 'g5_cmd', 'g5_bay_a', 'g5_bay_b']) if (!gs.includes(gid)) out.push(`debugState.groups.${gid} missing`);
        for (const [gid, v] of Object.entries(d.groups)) for (const f of ['spawned', 'alive', 'awake', 'holding', 'triggered']) if (!v || !(f in v)) { out.push(`debugState.groups.${gid}.${f} missing`); break; }
      }
      if (d.scene && d.scene.times !== undefined && d.scene.times !== null && typeof d.scene.times !== 'object') out.push(`debugState.scene.times: ${ty(d.scene.times)} (want Record<cue, s>)`);
      if (d.t && typeof d.t === 'object' && d.beats?.includes('l5_start') && d.t.l5_start === undefined) out.push('debugState.t has no l5_start (t = first script time of each beat)');
      if (d.t && d.phaseApplied && d.t[`phase:${d.phaseApplied}`] === undefined) out.push(`debugState.t has no phase:${d.phaseApplied} (t keeps phase:<id>)`);
    }
    if (Array.isArray(s.lineLog)) for (const l of s.lineLog.slice(0, 20)) {
      if (typeof l.t !== 'number' || !('said' in l)) { out.push(`lineLog entry without t / said: ${JSON.stringify(l).slice(0, 120)}`); break; }
      if (l.said && (typeof l.dur !== 'number' || !('end' in l))) { out.push(`lineLog ${l.said}: no dur / end (H5)`); break; }
    }
    if (s.rules && typeof s.rules === 'object') {
      const bad = Object.entries(s.rules).filter(([, v]) => !v || typeof v !== 'object' || !('when' in v)).map(([k]) => k);
      if (bad.length) out.push(`rules entries without \`when\` (H6 id → when/else/once): ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? ` (+${bad.length - 8})` : ''}`);
    }
    if (typeof s.worldState === 'function') {
      try { const w = s.worldState(); if (!w || typeof w !== 'object') out.push('worldState() is not an object'); else { for (const f of WSF) if (!(f in w)) out.push(`worldState().${f} missing`); if (w.hatches && !('spine' in w.hatches && 'mag' in w.hatches)) out.push('worldState().hatches wants { spine, mag }'); if (w.doors && typeof w.doors === 'object') { const any = Object.values(w.doors)[0]; if (any && !('open' in any && 'locked' in any && 'status' in any)) out.push('worldState().doors[id] wants { open, locked, status }'); } if (w.torch !== undefined && typeof w.torch !== 'number') out.push('worldState().torch wants a number'); } }
      catch (e) { out.push(`worldState() throws: ${e.message}`); }
    }
    if (typeof s.soldiers === 'function') { try { const r = s.soldiers(); if (!Array.isArray(r)) out.push('soldiers() is not an array'); else if (r[0]) for (const f of SOLF) if (!(f in r[0])) out.push(`soldiers()[].${f} missing`); } catch (e) { out.push(`soldiers() throws: ${e.message}`); } }
    if (typeof s.audioLog === 'function') { try { const r = s.audioLog(); if (!Array.isArray(r)) out.push('audioLog() is not an array'); else if (r[0] && !('id' in r[0] && 't' in r[0] && 'pos' in r[0])) out.push('audioLog()[] wants { id, t, pos }'); } catch (e) { out.push(`audioLog() throws: ${e.message}`); } }
    if (typeof s.fire === 'function') { try { const r = s.fire('__contract_probe__'); if (r !== null && r !== undefined && r !== false) out.push(`fire('<unknown>') returned ${JSON.stringify(r)} (want null)`); } catch (e) { out.push(`fire('<unknown>') throws: ${e.message}`); } }
    // markers inside rooms (stand markers with the 0.3 m inset)
    return out;
  }, [DS_FIELDS, DS_SUB, WS_FIELDS, SOLDIER_FIELDS, BEATS5]);
  const shapeBad = Array.isArray(shape) ? shape : [`shape probe failed: ${shape?.__err}`];
  // markers: inside a room (stand ones inside an interior with the inset)
  const mkBad = await evs(([stand, wall]) => {
    const S = window.__S5, g = window.__game, out = [];
    for (const m of [...stand, ...wall]) {
      const p = S.mk(m); if (!p) continue;
      const inset = stand.includes(m) ? 0.3 : -0.2;
      if (!S.interior(p[0], p[2], inset)) out.push(`${m} at (${p.map((v) => v.toFixed(2))}) not inside a room${inset > 0 ? ' interior (0.3 m inset)' : ''} (roomAt ${g.level.roomAt(new (g.player.position.constructor)(p[0], p[1], p[2]))?.id ?? '—'})`);
    }
    return out;
  }, [MARKERS_STAND, MARKERS_WALL]);
  // the story's own marker report (D22)
  const d = await dbg();
  const mm = Array.isArray(d.missingMarkers) ? d.missingMarkers : [];
  // cover: 41 points, every set, inside rooms
  const cov = await evs(() => { const g = window.__game, S = window.__S5; const c = g.level.cover ?? []; return { n: c.length, sets: [...new Set(c.map((x) => x.set))], out: c.filter((x) => !S.interior(x.position.x, x.position.z, 0.15)).map((x) => x.id) }; });
  // vignettes and their snaps — probed on a THROWAWAY page (a snap changes the level), warnings collected
  let vigMissing = [];
  if (full) vigMissing = await probeVignettes();
  // voices (static)
  const voice = [];
  if (!LINES_JSON) voice.push(`${LINES_FILE} missing`);
  else { const ids = LINES_JSON.map((l) => l.id); const mi = PLAN_LINES.filter((i) => !ids.includes(i)); if (mi.length) voice.push(`lines.l5.json lacks ${mi.length}: ${mi.slice(0, 10).join(', ')}${mi.length > 10 ? '…' : ''}`); }
  const noMan = PLAN_LINES.filter((i) => !MANIFEST[i]); if (noMan.length) voice.push(`manifest lacks ${noMan.length} l5_ lines${noMan.length < 72 ? ': ' + noMan.slice(0, 8).join(', ') : ' (none generated yet)'}`);
  // report grouped by owner
  const all = [...miss, ...shapeBad.map((x) => `shape:${x}`), ...mkBad.map((x) => `mkpos:${x}`), ...mm.map((x) => `story-marker:${x}`), ...vigMissing.map((x) => `vig:${x}`), ...voice.map((x) => `voice:${x}`)];
  if (cov.n !== undefined && cov.n !== 41) all.push(`coverN:level.cover has ${cov.n} points (want 41, §5.4)`);
  for (const id of cov.out ?? []) all.push(`coverpos:${id} not inside a room interior`);
  const by = {};
  for (const m of all) {
    const k = m.split(':')[0];
    const o = k === 'mkpos' || k === 'coverN' || k === 'coverpos' || k === 'story-marker' ? 'W4' : k === 'voice' ? 'W9' : ownerOf(m);
    (by[o] ??= []).push(m.replace(/^(shape|mkpos|story-marker|coverN|coverpos|voice):/, ''));
  }
  const ORDER = ['ST', 'W4', 'W3b', 'W2a', 'W2b', 'W7', 'W9', 'D1', 'D2a', 'D2b', 'D3', 'D*'];
  for (const o of [...ORDER, ...Object.keys(by).filter((k) => !ORDER.includes(k))]) if (by[o]) bad(`MISSING / WRONG — owner ${o} (${by[o].length}):\n      ${by[o].join('\n      ')}`, o === 'ST' ? 'story' : o === 'W3b' ? 'enemies' : o === 'W2b' ? 'audio' : o === 'W2a' ? 'ui' : o === 'W9' ? 'voices' : 'level');
  if (!all.length) console.log('  ok every hook, field, shape and id of the contract exists');
  return all;
}
/** Every vignette id (and its snap) on a fresh page: `vignette('<id>:snap')` must not warn "unknown". */
async function probeVignettes() {
  const prev = { ctxB, page };
  const c2 = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const p2 = await c2.newPage();
  const warns = [];
  p2.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text()); });
  const out = [];
  try {
    await p2.goto(`${base}/?level=5&autostart=1&nostory=1&noenemies=1`, { waitUntil: 'load', timeout: 60000 });
    await p2.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
    const ids = Object.values(VIGNETTES5).flat();
    for (const id of ids) {
      const n = warns.length;
      await p2.evaluate((id) => window.__game.level.vignette(`${id}:snap`), id).catch(() => {});
      await p2.waitForTimeout(30);
      const w = warns.slice(n).find((x) => x.includes(id) && /unknown|no snap|snap/i.test(x));
      if (w) out.push(`${id} (snap): ${w.slice(0, 90)}`);
    }
  } catch (e) { out.push(`probe page failed: ${e.message}`); }
  await c2.close().catch(() => {});
  void prev;
  return out;
}
/** Static pass (all modes): lines ↔ RULES ↔ manifest, pairs, unit uppercase, soldier label + throat, Kessler radio. */
async function staticPass() {
  console.log('── static: lines.l5.json ↔ RULES ↔ manifest (§10.1 all modes)');
  if (!LINES_JSON) { bad(`${LINES_FILE} missing — static pass not possible`, 'voices'); return; }
  const ids = LINES_JSON.map((l) => l.id);
  ok(ids.length === 72, `72 lines in ${LINES_FILE} (${ids.length})`, 'voices');
  const notPlan = ids.filter((i) => !PLAN_LINES.includes(i)), notFile = PLAN_LINES.filter((i) => !ids.includes(i));
  ok(!notPlan.length && !notFile.length, `lines = §6.2${notPlan.length ? ' — extra ' + notPlan.join(', ') : ''}${notFile.length ? ' — missing ' + notFile.join(', ') : ''}`, 'voices');
  const man = Object.keys(MANIFEST).filter((k) => k.startsWith('l5_'));
  const noMan = ids.filter((i) => !MANIFEST[i]), extraMan = man.filter((i) => !ids.includes(i));
  ok(!noMan.length && !extraMan.length, `manifest = lines${noMan.length ? ' — missing ' + noMan.slice(0, 8).join(', ') : ''}${extraMan.length ? ' — extra ' + extraMan.join(', ') : ''}`, 'voices');
  const rules = await evs(() => { const r = window.__game.story.rules; return r && typeof r === 'object' ? Object.keys(r) : null; });
  if (!Array.isArray(rules) || !rules.length) bad('story.rules (H6) missing or empty — RULES ↔ lines not checkable', 'story');
  else {
    const l5r = rules.filter((k) => k.startsWith('l5_'));
    const noRule = ids.filter((i) => !l5r.includes(i)), extra = l5r.filter((i) => !ids.includes(i));
    ok(!noRule.length, `every line has a RULES entry${noRule.length ? ' — missing: ' + noRule.join(', ') : ''}`, 'story');
    ok(!extra.length, `no RULES entry without a line${extra.length ? ' — ' + extra.join(', ') : ''}`, 'story');
  }
  const unpaired = PAIRS5.filter((p) => !ids.includes(`${p}_stop`) || !ids.includes(`${p}_command`));
  ok(!unpaired.length, `choice pairs complete (${PAIRS5.length})${unpaired.length ? ' — ' + unpaired.join(', ') : ''}`, 'voices');
  const upper = LINES_JSON.filter((l) => l.speaker === 'unit' && /\b[A-Z]{2,}\b/.test(l.spoken ?? l.text)).map((l) => l.id);
  ok(!upper.length, `no uppercase in a unit line's spoken text${upper.length ? ' — ' + upper.join(', ') : ''}`, 'voices');
  const sol = LINES_JSON.filter((l) => l.speaker === 'soldier' && (!l.label || l.fx !== 'throat')).map((l) => `${l.id} (label ${l.label}, fx ${l.fx})`);
  ok(!sol.length, `every soldier line has a label and fx throat${sol.length ? ' — ' + sol.join(', ') : ''}`, 'voices');
  const kes = LINES_JSON.filter((l) => l.speaker === 'kessler' && !/^radio\b/.test(String(l.fx ?? ''))).map((l) => `${l.id} (${l.fx})`);
  ok(!kes.length, `every kessler line has fx radio${kes.length ? ' — ' + kes.join(', ') : ''}`, 'voices');
  ok(typeof KES6_CUT === 'number' && (!MANIFEST.l5_kes_6?.duration || KES6_CUT < MANIFEST.l5_kes_6.duration), `l5_kes_6 cut ${KES6_CUT} inside the file (${MANIFEST.l5_kes_6?.duration ?? '?'} s)`, 'voices');
  const aas = LINES_JSON.filter((l) => /\baas\b/i.test(l.spoken ?? l.text)).map((l) => l.id);
  ok(!aas.length, `"Aas" spoken nowhere (coordinator 1)${aas.length ? ' — ' + aas.join(', ') : ''}`, 'voices');
}

// ───────────────────────────────────────────────────────────── segments
let routeBroken = null, skipped = [];
async function seg(name, needs, fn) {
  if (routeBroken) { skipped.push(name); console.log(`  -- ${name}: skipped (route broken at "${routeBroken}")`); return false; }
  const miss = await missingOf(needs);
  if (miss.length) {
    const by = {}; for (const m of miss) (by[ownerOf(m)] ??= []).push(m);
    bad(`${name}: SKIPPED — needs ${Object.entries(by).map(([o, m]) => `${o}: ${m.join(', ')}`).join(' · ')}`, miss.some((m) => /^(hook|ds):/.test(m)) ? 'story' : 'level');
    routeBroken = name; return false;
  }
  console.log(`── ${name}`);
  try {
    const r = await fn();
    if (r === false) { routeBroken = name; bad(`${name}: did not reach its exit — later segments skipped`, 'story'); return false; }
  } catch (e) { routeBroken = name; bad(`${name}: threw ${e.message}`, 'test'); return false; }
  return true;
}
const H = (...h) => h.map((x) => `hook:${x}`);
const DSN = (...k) => k.map((x) => `ds:${x}`);
const N = {
  base: [...H('end', 'checkpoint', 'lineLog'), ...DSN('now', 'beats', 't', 'phaseApplied', 'flags', 'checkpoints')],
  arrival: ['door:d5_gate', 'trig:t5_gate', 'room:gate5', 'screen:gate_panel5'],
  gatehouse: ['trig:t5_turnstile', 'trig:t5_gate', 'use:note5_visitors', 'screen:onpost'],
  scene: ['trig:t5_dutydoor', 'door:d5_duty', 'door:d5_ready', 'mk:mk5_c1_end', 'ds:scene', 'group:g5_duty', 'group:g5_s1'],
  units: ['group:g5_duty', 'ds:groups', 'room:ready5'],
  s1: ['group:g5_s1', 'trig:t5_ready', 'mk:mk5_s1', 'ds:radio', 'enemies:corpsePoint', 'enemies:release'],
  radio: ['ds:radio', 'ds:keypad', 'use:key5_duty'],
  keypad: [...H('keypad'), 'use:key5_duty', 'door:d5_key', 'ds:keypad'],
  spine: ['trig:t5_spine_mid', 'group:g5_spine', 'door:d5_dive', 'room:spine5'],
  door: ['trig:t5_cmd_line', 'trig:t5_cmd', 'ds:door', 'mk:mk5_port', ...H('worldState')],
  vent: ['group:g5_cmd'],
  bay: ['trig:t5_bay', 'group:g5_bay_a', 'door:d5_lockside'],
  wheel: ['use:wheel5', 'ds:wheel', 'group:g5_bay_b', 'door:d5_tunnel'],
  tunnel: ['trig:t5_tunnel', 'door:d5_tunnel', 'room:tunnel5'],
  crawl: ['use:hatch5_spine', 'trig:t5_crawl_e', 'trig:t5_landing', 'region:crawl'],
  mag: ['trig:t5_mag', 'group:g5_mag', 'use:hatch5_mag'],
  quarters: ['room:berths5', 'room:heads5', 'room:mess5', 'room:galley5'],
  armoury: ['room:arm5', 'use:p5_arm_vest'],
  palm: ['use:launch5_palm'],
};
const opt = {};

async function segBoot(expect = { choice: null, god: true }) {
  const s = await ev(() => { const g = window.__game, p = g.player; let d = {}; try { d = g.story.debugState ?? {}; } catch { /* */ } return { level: g.levelId, state: g.state, w: Object.fromEntries(Object.entries(p.weapons).map(([k, v]) => [k, [!!v.owned, v.clip, v.reserve]])), hp: p.health, armor: p.armor, fl: p.flashlightOn, torch: p.flashlightCharge ?? null, facts: { ...g.facts }, loadout: d.loadout ?? null }; });
  ok(s.level === 5 && ['playing', 'loading'].includes(s.state), `level 5 running (${s.level}, ${s.state})`, 'story');
  // §7 direct start: pistol 12 + 24 → 12/36, shotgun 6 + 6 → 6/12, carbine 30 + 90 → 30/120 (K notes: one pickup path)
  const w = s.w, want = { pistol: [true, 12, 36], shotgun: [true, 6, 12], carbine: [true, 30, 120] };
  const wBad = Object.entries(want).filter(([k, v]) => JSON.stringify(w[k]) !== JSON.stringify(v)).map(([k, v]) => `${k} ${JSON.stringify(w[k])}≠${JSON.stringify(v)}`);
  ok(s.loadout === 'direct' && !wBad.length && s.hp === 100 && s.armor === 50 && s.fl, `direct loadout: weapons ${wBad.length ? wBad.join(', ') : 'ok'}, health ${s.hp}, armour ${s.armor} (50), flashlight ${s.fl}, loadout ${s.loadout}`, 'story');
  // (the lamp is on through the 4.2 s title card: 10 s burn → ≥ 0.85 when control comes)
  if (s.torch !== null) ok(s.torch >= 0.85, `a new level starts with a full cell (${f2(s.torch)} after the card)`, 'story');
  const f = s.facts;
  ok(f.unitsLeft === 28 && f.badge === true && f.halvorsenAlive === true && f.testHour === 62.5 && f.choice === (expect.choice ?? 'stop'), `direct facts ${JSON.stringify(f)}`, 'story');
}
async function segArrival() {
  await beatWait('l5_start', 6);
  await phaseSeen('A', 2);
  await checkDoors('A');
  await objectiveSeen('Find the navy — Post 4', 4);
  await film('gate_rise', 'd.phaseApplied === "B"', 5);
  if (!await phaseWait('B', 6, 'the gate opens at 0.4 s, 2.4 s leaf → B at 2.8 s')) return false;
  const d = await dbg(), l = await L5();
  const st = d.t?.l5_start, pb = d.t?.['phase:B'], op = l.opened.d5_gate?.[0]?.s;
  ok(near(pb - st, 2.8, 0.15), `phase B at start + 2.8 ± 0.15 (${f2(pb - st)})`, 'story');
  ok(near(op - st, 0.4, 0.15), `d5_gate opens at start + 0.4 (${f2(op - st)})`, 'level');
  ok(near(pb - op, 2.4, 0.2), `gate leaf 2.4 s (opening → B ${f2(pb - op)})`, 'level');
  await checkDoors('B');
  await cpWait('cp5_start', 3, 'A → B');
}
async function segGatehouse() {
  if (opt.reads) { if (await stand('use', 'note5_visitors')) { ok((await use('note5_visitors')) === 'ok', 'read note5_visitors', 'level'); await gameWait(0.6); await closeNote(); } }
  if (opt.turnstile !== false) {
    await stand('trig', 't5_turnstile', { look: null });
    await film('turnstile', null, 3);
    ok(await untilG('(d.scares ?? []).includes("v5_turnstile")', 4, 'v5_turnstile on the first t5_turnstile (calm)', 'story', { quiet: true }), 'v5_turnstile fired', 'story');
    ok(await untilG('/27/.test(g.level.screen("onpost")?.userData?.screenText ?? "")', 3, 'ON POST 27', 'level', { quiet: true }), 'onpost board reads 27', 'level');
  }
  if (opt.gateDoorway) return segGateDoorway();
  return segLatch();
}
async function segLatch() {
  if (!await stand('trig', 't5_gate', { fz: 0.7, away: ['t5_turnstile', 't5_dutydoor'] })) return false;
  if (!await phaseWait('B2', 8, 'gate latch: t5_gate → leaf 2.4 s down')) return false;
  ok(await untilG('g.level.door("d5_gate").locked && g.level.door("d5_gate").closed', 3, 'd5_gate locked and shut', 'level', { quiet: true }), 'd5_gate locked and shut (latched)', 'level');
  await heardWait('l5_unit_gate', 4);
  ok(/GATE 4 — CLOSED — TUBE CYCLE/.test(await ev(() => window.__game.level.screen('gate_panel5')?.userData?.screenText ?? '')), 'gate_panel5: GATE 4 — CLOSED — TUBE CYCLE', 'story');
  await checkDoors('B2');
}
async function segGateDoorway() {   // softlock (b): stand in the gate doorway when the latch arms
  console.log('   (b) gate doorway during the latch');
  if (!await stand('trig', 't5_gate', { fz: 0.7, away: ['t5_turnstile', 't5_dutydoor'] })) return false;
  // the instant the leaf starts down, step into the doorway (the door's own position, feet on its sill)
  const ran = await untilG('(L.closing.d5_gate ?? []).length > 0 && (() => { const d = g.level.door("d5_gate"); g.player.teleport(d.position.clone().setY(d.y ?? 0), 0, 0); return true; })()', 6, 'd5_gate starts closing (latch armed)', 'story');
  if (!ran) return false;
  await gameWait(3.0);
  const st = await ev(() => ({ locked: window.__game.level.door('d5_gate').locked, ph: window.__game.story.debugState.phaseApplied, panel: window.__game.level.screen('gate_panel5')?.userData?.screenText ?? '' }));
  ok(!st.locked && st.ph !== 'B2', `latch with the player in the gate doorway: not latched (locked ${st.locked}, phase ${st.ph})`, 'story');
  ok(/CLEAR THE GATE/.test(st.panel), `panel CLEAR THE GATE (${st.panel.slice(0, 40)})`, 'story');
  ok(await untilG('g.level.door("d5_gate").isOpen', 4, 'gate rises again', 'level', { quiet: true }), 'the gate rises again', 'story');
  return segLatch();
}
async function segScene() {
  await stand('trig', 't5_dutydoor', { fz: 0.4, look: await S5('mk', 'mk5_c1_cam1') });
  const took = await untilG('g.state === "cutscene"', 2.0, 'the camera taken on the polled t5_dutydoor (≤ 1.5 s line wait)');
  if (!took) return false;
  ok((await dbg()).phaseApplied === 'C', `phase C with the camera (${(await dbg()).phaseApplied})`, 'story');
  await film('cutscene', 'g.state !== "cutscene"', 27);
  if (!await untilG('g.state === "playing" && d.phaseApplied === "D0"', 27, 'hand-back (phase D0, playing)')) return false;
  const d = await dbg();
  const h = d.scene?.h ?? (d.t?.['phase:D0'] - d.t?.['phase:C']);
  ok(typeof h === 'number' && h <= 25.0, `H ≤ 25.0 s (${f2(h)}; scene.times ${JSON.stringify(d.scene?.times ?? null)})`, 'story');
  ok(d.scene?.result === 'played', `scene.result played (${d.scene?.result})`, 'story');
  const lines = await ev(() => (window.__game.story.lineLog ?? []).filter((l) => /^l5_(reyes_c1|sol_c1)_/.test(l.said ?? '')).map((l) => ({ id: l.said, t: l.t, cue: l.cue })));
  ok(lines.length >= 7, `scene lines spoken (${lines.map((l) => l.id).join(', ')})`, 'story');
  const late = lines.filter((l) => typeof l.cue !== 'number' || Math.abs(l.t - l.cue) > 0.12);
  ok(!late.length, `every scene line ≤ 0.12 s from its cue${late.length ? ' — ' + late.map((l) => `${l.id} ${typeof l.cue === 'number' ? f2(l.t - l.cue) : 'no cue'}`).join(', ') : ''}`, 'story');
  const c = await choiceOf();
  ok(lines.some((l) => l.id === `l5_sol_c1_1_${c}`), `the ${c} variant of l5_sol_c1_1`, 'story');
  const l = await L5();
  const cp = l.cpAt.cp5_duty;
  ok(cp && typeof cp.s === 'number' && cp.s - d.t['phase:D0'] <= 0.3, `cp5_duty at H (${cp ? f2(cp.s - d.t['phase:D0']) : 'not written'})`, 'story');
  const pos = await ev(() => window.__game.player.position.toArray()), end = await S5('mk', 'mk5_c1_end');
  if (end) ok(Math.hypot(pos[0] - end[0], pos[2] - end[2]) <= 0.6, `hand-back at mk5_c1_end (${pos.map(f2)})`, 'story');
  const s1 = await S5('alive', 'g5_s1');
  ok(s1.length === 1 && s1[0].state === 'idle', `g5_s1 spawned at H, holding (state ${s1[0]?.state})`, 'enemies');
  await checkDoors('D0');
}
async function segUnits({ killS1First = false } = {}) {
  if (!await phaseWait('D', 4, 'd5_ready opens at H + 2.5')) return false;
  const d = await dbg();
  ok(near(d.t?.['phase:D'] - d.t?.['phase:D0'], 2.5, 0.1), `units door at H + 2.5 ± 0.1 (${f2(d.t?.['phase:D'] - d.t?.['phase:D0'])})`, 'story');
  await gameWait(0.3);
  const u = await ev(() => { const g = window.__game, e = g.player.eye; return g.enemies.all.filter((x) => x.alive && x.group === 'g5_duty').map((x) => ({ dist: +x.position.distanceTo(g.player.position).toFixed(2), vis: g.physics.lineOfSight(e, x.position.clone().setY(x.position.y + 1.3)) })); });
  ok(u.length === 2 && u.every((x) => x.dist >= 8), `two units ≥ 8 m away (${u.map((x) => x.dist).join(', ')})`, 'level');
  ok(u.some((x) => x.vis), `a unit visible through the ready door at H + 2.8 (${u.map((x) => x.vis)})`, 'level');
  await checkDoors('D');
  await film('units', null, 3);
  const act = await ev(() => ({ active: window.__game.enemies.activeCount, hold: window.__game.story.debugState.groups?.g5_s1?.holding }));
  ok(act.hold === 1, `g5_s1 holding while the units come (${act.hold})`, 'story');
  if (killS1First) {   // impatient: shoot g5_s1 through the open ready door during the unit fight (§9 #8)
    const s = await S5('alive', 'g5_s1');
    if (s[0]) { await stand('door', 'd5_ready', { room: 'duty5', dist: 1.2, look: [s[0].pos[0], s[0].pos[1] + 1.3, s[0].pos[2]] }); await fireAt([s[0].pos[0], s[0].pos[1] + 1.3, s[0].pos[2]], 3); }
    await killUntil('!g.enemies.all.some((e) => e.alive && e.group === "g5_s1")', 10, 'g5_s1 dead through the door', ['g5_s1']);
    ok(await untilG('!!d.flags?.s1Free || !!d.groups?.g5_s1?.triggered', 2, 's1Free mirrored', 'story', { quiet: true }), 'g5_s1 released himself when shot (s1Free)', 'story');
  }
  await killUntil('!g.enemies.all.some((e) => e.alive && e.group === "g5_duty")', 20, 'g5_duty dead', ['g5_duty']);
  if (!killS1First) {
    await cpWait('cp5_ready', 6, 'g5_duty dead + 1.5 s, calm, g5_s1 holding');
    const a = await ev(() => window.__game.enemies.activeCount);
    ok(a === 0, `the holding soldier is not in activeCount (${a})`, 'enemies');
    await objectiveSeen('The ready room', 4);
  }
}
async function segS1({ squawk = false, leave = false } = {}) {
  const s1 = await S5('alive', 'g5_s1');
  if (s1.length) {
    const mk = await S5('mk', 'mk5_s1');
    ok(mk && Math.hypot(s1[0].pos[0] - mk[0], s1[0].pos[2] - mk[2]) <= 0.6, `g5_s1 at mk5_s1 (${s1[0].pos})`, 'enemies');
    if (!await stand('trig', 't5_ready', { fz: 0.92, look: [s1[0].pos[0], s1[0].pos[1] + 1.4, s1[0].pos[2]] })) return false;
    ok(await untilG('!!d.flags?.s1Free && !!d.groups?.g5_s1?.triggered', 2, 'release on t5_ready (s1Free, triggered)'), 'g5_s1 released on entering t5_ready', 'story');
    const row = await evs(() => window.__game.story.soldiers?.().find((x) => x.group === 'g5_s1') ?? null);
    if (row && !row.__err) ok(row.holding === false, `soldiers(): g5_s1 not holding (${JSON.stringify(row).slice(0, 120)})`, 'enemies');
    await film('s1_engage', null, 5);
    await killUntil('!g.enemies.all.some((e) => e.alive && e.group === "g5_s1")', 15, 'g5_s1 dead', ['g5_s1']);
  }
  const died = (await L5()).died.filter((x) => x.group === 'g5_s1').slice(-1)[0];
  if (!died) return bad('g5_s1 death not seen (enemy:died)', 'enemies');
  await film('s1_death', null, 2.5);
  if (!await untilG('Array.isArray(d.radio?.pos)', 3, 'radio point (mk5_radio) after the fall')) return false;
  const rp = await ev((id) => { const g = window.__game; const c = g.enemies.corpsePoint(id, 'chest'); return { pos: g.story.debugState.radio.pos, cp: c ? c.toArray() : null }; }, died.id);
  ok(rp.cp && Math.hypot(...rp.pos.map((v, i) => v - rp.cp[i])) <= 0.06, `radio point = corpsePoint(chest) (${rp.pos?.map(f2)} vs ${rp.cp?.map(f2)})`, 'story');
  if (squawk) {   // a variant waits for the body squawk at death + 30 s
    if (await heardWait('l5_kes_squawk_1', 33, 'story', 'death + 30 s, radio not taken')) {
      const sq = await lineOf('l5_kes_squawk_1');
      ok(near(sq.t - died.s, 30, 0.5), `squawk at death + 30 ± 0.5 s (${f2(sq.t - died.s)})`, 'story');
      await objectiveSeen('Take the radio', 3);
    }
  }
  if (leave) return true;
  // the radio is usable from 1.5 m (R8 ray ignoring the owner's wreck box)
  await stand('use', 'radio5', { eye: 1.5 });
  ok(await untilG('d.radio?.enabled === true', 1.5, 'radio5 enabled from 1.5 m', 'story', { quiet: true }), 'radio5 enabled from 1.5 m (debugState.radio.enabled)', 'story');
}
async function segKeypadDead({ withCode = false } = {}) {   // §9 #6: before power, with the right code too
  if (!await stand('use', 'key5_duty', { room: 'duty5' })) return;
  const prompt = await ev(() => window.__game.interactables.get('key5_duty')?.prompt ?? null);
  ok(/no power/i.test(prompt ?? ''), `keypad prompt before power: "${prompt}"`, 'story');
  if (withCode) await evs(() => window.__game.story.keypad?.('4719'));
  else await use('key5_duty');
  await gameWait(0.6);
  const k = (await dbg()).keypad ?? {};
  ok(k.open === false && k.accepted === false && k.powered === false, `keypad dead before the power cue: UI not open, nothing accepted (${JSON.stringify(k)})`, 'story');
  const al = (await L5()).audio.filter((a) => a.id === 'keypad_dead').length;
  ok(al >= 1, `keypad_dead played (${al}; H14)`, 'ui');
}
async function segRadio({ codeDuring = false, ask = true } = {}) {
  if ((await use('radio5')) !== 'ok') { await stand('use', 'radio5', { dist: 1.2 }); if ((await use('radio5')) !== 'ok') return bad('use radio5', 'story'); }
  if (!await untilG('!!d.radio?.owned && !!d.flags?.radio', 1, 'radio owned (fact radio)')) return false;
  await toastSeen('^Radio$', 2);
  ok(await ev(() => window.__game.facts.radio === true), 'fact radio', 'story');
  await film('radio_pickup', 'g.story.lineLog.some((l) => l.said === "l5_kes_2")', 8);
  if (!await heardWait('l5_kes_4', 40, 'story', 'the pickup sequence')) return false;
  if (!await phaseWait('K', 12, 'power cue at the end of l5_kes_4')) return false;
  const d = await dbg(), k4 = await lineOf('l5_kes_4');
  ok(near(d.t['phase:K'] - k4.end, 0, 0.12), `power cue (phase K) at l5_kes_4's end (${f2(d.t['phase:K'] - k4.end)})`, 'story');
  ok(d.keypad?.powered === true, 'keypad powered', 'story');
  await toastSeen('Q — radio Kessler', 3);
  await objectiveSeen('Open the spine door — keypad', 3);
  if (codeDuring) {   // the code typed during the sequence → `_9b`
    await stand('use', 'key5_duty', { room: 'duty5' });
    await ev(() => window.__game.story.keypad('4719'));
    ok(await untilG('d.keypad?.accepted === true', 3, 'code accepted during the sequence'), '4719 accepted during the sequence', 'story');
  }
  if (!await heardWait(codeDuring ? 'l5_kes_9b' : 'l5_kes_9', 70, 'story', codeDuring ? 'code already in' : 'code not yet in')) return false;
  ok(!(await heard(codeDuring ? 'l5_kes_9' : 'l5_kes_9b')), `only ${codeDuring ? '_9b' : '_9'} of the pair`, 'story');
  // order and gaps
  const log = await ev(() => (window.__game.story.lineLog ?? []).filter((l) => l.said));
  const take = (await L5()).flags.radio?.s;
  let prev = null;
  for (const [ids, gap] of SEQ5) {
    const l = log.find((x) => ids.split('|').includes(x.said));
    if (!l) { bad(`pickup sequence: ${ids} not spoken`, 'story'); continue; }
    if (prev) {
      ok(l.t >= prev.t, `${l.said} after ${prev.said}`, 'story');
      if (typeof prev.end === 'number') ok(near(l.t - prev.end, gap, 0.12), `${prev.said} → ${l.said}: gap ${f2(l.t - prev.end)} (plan ${gap})`, 'story');
    } else if (typeof take === 'number') ok(near(l.t - take, 0.4, 0.2), `l5_kes_1 at the take + 0.4 (${f2(l.t - take)}; take stamped at 10 Hz)`, 'story');
    prev = l;
  }
  const k6 = log.find((x) => x.said === 'l5_kes_6');
  if (k6 && typeof KES6_CUT === 'number') ok(typeof k6.end === 'number' && Math.abs(k6.end - k6.t - KES6_CUT) <= 0.16, `l5_kes_6 stopped at its cut ${KES6_CUT} (+ fxLead ≤ 0.04) (${f2(k6.end - k6.t)})`, 'story');
  if (ask && !codeDuring) {   // Q live in K: the ack, then the code again
    await gameWait(5.2);
    await ev(() => window.__game.story.radioAsk?.());
    await heardWait('l5_kes_ack', 3, 'story', 'Q → ack');
    const n4 = await ev(() => window.__game.story.lineLog.filter((l) => l.said === 'l5_kes_4').length);
    ok(await untilG('g.story.lineLog.filter((l) => l.said === "l5_kes_4").length >= 2', 8, 'Q in K repeats the code (l5_kes_4)', 'story', { quiet: true }), `Q in K repeats l5_kes_4 (${n4} → ≥ 2)`, 'story');
  }
  await cpWait('cp5_radio', 12, 'after l5_kes_4, calm');
  await checkDoors('K');
  await untilG('(d.heard ?? []).includes("l5_kes_brekke") || g.story.lineLog.some((l) => l.said === "l5_kes_brekke")', 12, 'l5_kes_brekke (_9 end + 6 s, calm)', 'story');
}
async function segKeypad({ wrong = 0 } = {}) {
  const k0 = (await dbg()).keypad ?? {};
  if (k0.accepted) { await phaseWait('S', 3); return; }
  if (!await stand('use', 'key5_duty', { room: 'duty5' })) return false;
  for (let i = 1; i <= wrong; i++) {
    await ev(() => window.__game.story.keypad('0000'));
    ok(await untilG(`d.keypad?.wrong >= ${i}`, 2, `wrong code ${i} counted`), `wrong code ${i}: CODE REJECTED (keypad.wrong ${i})`, 'story');
    if (i === 1) await toastSeen('Q — ask Kessler for the code', 3);
    if (i === 3) await objectiveSeen('Open the spine door — 4719', 3);
    await gameWait(1.4);
  }
  await film('keypad', null, 2);
  await ev(() => window.__game.story.keypad('4719'));
  if (!await untilG('d.keypad?.accepted === true', 3, '4719 accepted')) return false;
  if (!await phaseWait('S', 2, 'code accepted → S')) return false;
  await beatWait('l5_keypad', 1);
  await checkDoors('S');
  if (await heardWait('l5_choir_key', 3, 'story', '≤ 2 s after acceptance')) { const c = await lineOf('l5_choir_key'); ok(c.t - (await tOf('l5_keypad')) <= 2.0, `l5_choir_key ≤ 2 s after acceptance (${f2(c.t - (await tOf('l5_keypad')))})`, 'story'); }
  await objectiveSeen("Kessler's door — the end of the spine", 3);
}
async function segSpine({ hideInCrawl = 0, bodyScare = false } = {}) {
  // (the wave may already have fired: first t5_bay / t5_cmd in S, or 45 s in S — §4.6)
  if (((await dbg()).beats ?? []).includes('l5_spine_wave')) note('the spine wave fired before t5_spine_mid (t5_bay / t5_cmd / 45 s rule)');
  else {
    if (!await stand('trig', 't5_spine_mid')) return false;
    if (!await beatWait('l5_spine_wave', 2, 'first t5_spine_mid in S')) return false;
    ok(await untilG('S.alive("g5_spine").length === 3', 2, 'g5_spine spawned (3)', 'enemies', { quiet: true }), 'g5_spine: soldier + 2 husks spawned in the dive locker', 'story');
    await phaseSeen('S_dive', 2); await checkDoors('S_dive');
  }
  if (bodyScare) {   // --scares: v5_body needs a living g5_spine member unseen ≥ 15 s and no sight of either body spot
    await killUntil('!g.enemies.all.some((e) => e.alive && e.group === "g5_spine" && e.type !== "soldier")', 15, 'the two husks of g5_spine dead (the soldier spared)', ['g5_spine']);
    await stand('room', 'galley5', { fx: 0.8, fz: 0.8 });
    ok(await untilG('(d.scares ?? []).includes("v5_body")', 70, 'v5_body (a living g5_spine member unseen ≥ 15 s, both body spots unseen ≥ 15 s, ≥ 12 m away)', 'story', { quiet: true }), 'v5_body fired (the body moved, unseen)', 'story');
  }
  if (hideInCrawl) {   // softlock (d): into the crawl while the wave is alive, 60 s, then out
    await segCrawlEnter();
    const t0 = await ev(() => window.__game.time);
    await gameWait(hideInCrawl);
    const st = await ev(() => { const g = window.__game, d = g.story.debugState; return { onLow: g.enemies.all.filter((e) => e.alive && e.position.y < -0.5).map((e) => e.group), inWalk: g.enemies.all.filter((e) => e.alive && e.position.x > 36.2 - 1e-6 && e.position.x < 38.6 && e.position.z > -15.4 && e.position.z < -14.2 && e.position.y > -0.3).length, cps: d.checkpoints }; });
    void t0;
    ok(!st.onLow.length, `no enemy followed into the crawl (nav: false floors) (${st.onLow})`, 'enemies');
    ok(st.inWalk === 0, `nobody stands in the walkway beside the pit (box from §2.3 t5_hatch) (${st.inWalk})`, 'enemies');
    ok(!st.cps.includes('cp5_spine'), 'no checkpoint while hiding below', 'story');
    await stand('trig', 't5_spine_w');
  }
  await untilG('S.alive("g5_spine").every((e) => e.pos[0] < 45.6)', 12, 'g5_spine out of the dive locker (or 10 s)', 'enemies', { quiet: true });
  await film('spine_wave', null, 4);
  await killUntil('!g.enemies.all.some((e) => e.alive && e.group === "g5_spine")', 25, 'g5_spine dead', ['g5_spine']);
  await stand('trig', 't5_spine_w');
  await cpWait('cp5_spine', 8, 'g5_spine dead + 1.5 s, calm, in the spine');
  ok(await untilG('g.level.door("d5_dive").locked', 12, 'd5_dive closed behind (closeBehind)', 'story', { quiet: true }), 'd5_dive latched behind the wave', 'story');
}
async function segDoor({ startFacing = 'door', edge = false, leaveTimes = 0 } = {}) {
  const yawDoor = -90, yawAway = 90;   // +90 = −x (down the spine, back to the door)
  const s = await stand('trig', 't5_cmd_line', edge ? { fx: 0.12, fz: 0.15 } : {});
  if (!s) return false;
  await setYaw(startFacing === 'door' ? yawDoor : yawAway, startFacing === 'door' ? 0 : -60);
  if (!await untilG('d.door?.started === true', 4, 'the door beat starts (t5_cmd in S, g5_spine fought, door-calm)')) return false;
  await heardWait('l5_kes_door_1', 3); await heardWait('l5_kes_door_2', 12);
  await objectiveSeen('Stand on the yellow line — turn your back to the door', 6);
  const facingLine = startFacing === 'door' ? 'l5_kes_door_3' : 'l5_kes_door_hold';
  await heardWait(facingLine, 8, 'story', `facing ${startFacing} at the check start`);
  ok(!(await heard(startFacing === 'door' ? 'l5_kes_door_hold' : 'l5_kes_door_3')), `only ${facingLine} (start facing ${startFacing})`, 'story');
  if (startFacing === 'door') { await gameWait(0.3); await setYaw(yawAway, -60); }
  for (let i = 0; i < leaveTimes; i++) {   // softlock (f): leave the line mid-count, come back
    await untilG('d.door?.check > 0.2', 3, `count running (leave ${i + 1})`);
    await stand('trig', 't5_cmd', { fx: 0.2, away: ['t5_cmd_line'] });
    ok(await untilG('d.door?.check === 0 && !d.door?.done', 1.0, `count reset when off the line (${i + 1})`), `leave ${i + 1}: the count resets`, 'story');
    await stand('trig', 't5_cmd_line'); await setYaw(yawAway, -60);
  }
  if (leaveTimes) await heardWait('l5_kes_door_away', 4, 'story', 'left t5_cmd_line mid-check');
  if (!await untilG('d.door?.check > 0', 3, 'the 1.2 s count runs (yaw within ±50° of −x, pitch −60°)')) return false;
  const mid = await dbg();
  ok(mid.door.facing === 'away', `door.facing away during the count (${mid.door.facing})`, 'story');
  ok(await untilG('d.t?.["vignette:cmd5_port_look"] !== undefined', 1, 'cmd5_port_look during the count', 'story', { quiet: true }), 'cmd5_port_look started with the count (silhouette)', 'story');
  if (!await untilG('d.door?.done === true', 3, 'the check done')) return false;
  const run = (await L5()).doorCheck?.runs?.slice(-1)[0], done = (await L5()).doorCheck?.done;
  if (run && done) ok(near(done.g - run.start, 1.2, 0.2), `count 1.2 s (${f2(done.g - run.start)}; 10 Hz stamps)`, 'story');
  await heardWait('l5_kes_door_4', 3);
  ok(await ev(() => window.__game.facts.l5_door === true), 'fact l5_door', 'story');
  await beatWait('l5_verified', 2);
  // after-check sequence and gaps; V at _7's start
  let prev = await lineOf('l5_kes_door_4');
  for (const [id, gap] of DOOR_AFTER) {
    if (!await heardWait(id, 20)) return false;
    const l = await lineOf(id);
    if (prev && typeof prev.end === 'number') ok(near(l.t - prev.end, gap, 0.12), `${prev.said} → ${id}: gap ${f2(l.t - prev.end)} (plan ${gap})`, 'story');
    prev = l;
  }
  await phaseSeen('V', 2);
  const k7 = await lineOf('l5_kes_door_7');
  ok(near((await tOf('phase:V')) - k7.t, 0, 0.12), `phase V at l5_kes_door_7's start (${f2((await tOf('phase:V')) - k7.t)})`, 'story');
  await checkDoors('V');
  const c = await choiceOf();
  if (!await heardWait(`l5_choir_door_${c}`, 20)) return false;
  const ch = await lineOf(`l5_choir_door_${c}`);
  const k7b = await lineOf('l5_kes_door_7');
  ok(near(ch.t - k7b.end, 0.4, 0.12), `CHOIR at _7 end + 0.4 (${f2(ch.t - k7b.end)})`, 'story');
  await film('lights_out', '(d.beats ?? []).includes("l5_dark") && d.now - d.t.l5_dark > 2', 14);
  if (!await beatWait('l5_dark', 12)) return false;
  const ch2 = await lineOf(`l5_choir_door_${c}`), Lt = await tOf('l5_dark');
  ok(near(Lt - ch2.end, 0.3, 0.12), `lights-out L at CHOIR end + 0.3 (${f2(Lt - ch2.end)})`, 'story');
  const w = await ws();
  ok(w && w.lightsOut === true && Array.isArray(w.dark) && w.dark.includes('spine5') && w.dark.includes('sub5'), `worldState: lightsOut, dark ⊇ spine5, sub5 (${JSON.stringify(w?.dark)})`, 'story');
  const lights = await ev(() => { const L = window.__game.render.lights; const n = L.groups instanceof Map ? [...L.groups.keys()] : []; const on = (x) => n.includes(x) ? L.group(x).filter((h) => h.enabled && h.factor > 0.01).length : null; return { spine: on('spine5'), sub: on('sub5'), se: on('spine5_emerg'), be: on('sub5_emerg') }; });
  ok(lights.spine === 0 && lights.sub === 0 && lights.se > 0 && lights.be > 0, `spine5 / sub5 mains off, *_emerg on (${JSON.stringify(lights)})`, 'level');
  if (await heardWait('l5_kes_dark', 4)) ok(near((await lineOf('l5_kes_dark')).t - Lt, 1.0, 0.12), `l5_kes_dark at L + 1.0 (${f2((await lineOf('l5_kes_dark')).t - Lt)})`, 'story');
  if (await cpWait('cp5_door', 4, 'L + 1.5')) ok(near((await L5()).cpAt.cp5_door.s - Lt, 1.5, 0.2), `cp5_door at L + 1.5 (${f2((await L5()).cpAt.cp5_door.s - Lt)})`, 'story');
}
async function segVent() {
  if (!await untilG('S.alive("g5_cmd").length >= 1', 6, 'g5_cmd at L + 3.0 (vent skitters + the soldier)', 'story')) return false;
  const sp = (await dbg()).spawnLog?.find((x) => x.group === 'g5_cmd');
  if (sp) ok(near(sp.t - (await tOf('l5_dark')), 3.0, 0.6), `g5_cmd spawned at L + 3.0 … 3.4 (${f2(sp.t - (await tOf('l5_dark')))})`, 'story');
  await killUntil('!g.enemies.all.some((e) => e.alive && e.group === "g5_cmd")', 40, 'g5_cmd dead', ['g5_cmd']);
}
async function segBay({ hideInMag = 0 } = {}) {
  if (!await stand('trig', 't5_bay', { fz: 0.92, y: 0 })) return false;
  if (!await beatWait('l5_bay', 2, 'first t5_bay in V')) return false;
  await untilG('S.alive("g5_bay_a").length === 4', 2, 'g5_bay_a spawned (4)', 'enemies');
  await phaseSeen('V_lock', 2); await checkDoors('V_lock');
  await film('dark_bay', null, 5);
  if (hideInMag) {   // softlock (e): into the magazine during bay wave A
    if (await stand('trig', 't5_mag')) {
      await gameWait(hideInMag);
      const st = await ev(() => ({ low: window.__game.enemies.all.filter((e) => e.alive && e.position.y < -1).map((e) => e.group), cps: window.__game.story.debugState.checkpoints }));
      ok(!st.low.filter((gp) => gp !== 'g5_mag').length, `no bay enemy in the magazine (${st.low})`, 'enemies');
      ok(!st.cps.includes('cp5_bay'), 'no checkpoint in the magazine', 'story');
      await stand('trig', 't5_bay', { fz: 0.92, y: 0 });
    }
  }
  await killUntil('!g.enemies.all.some((e) => e.alive && ["g5_bay_a", "g5_cmd"].includes(e.group))', 40, 'g5_bay_a dead', ['g5_bay_a', 'g5_cmd']);
  await cpWait('cp5_bay', 8, 'g5_bay_a + g5_cmd dead + 1.5 s, calm');
}
async function segWheel({ jumpOff = false, leaveTwo = false } = {}) {
  if (!await stand('use', 'wheel5')) return false;
  if ((await use('wheel5')) !== 'ok') return bad('use wheel5 (V)', 'story');
  if (!await beatWait('l5_wheel', 2)) return false;
  await film('wheel', 'd.wheel?.doneAt', 6);
  if (!await untilG('d.wheel?.doneAt != null', 6, 'the wheel done (4.0 s fixed clock)')) return false;
  const w = (await dbg()).wheel;
  ok(near(w.doneAt - w.startedAt, 4.0, 0.1), `wheel 4.0 ± 0.1 s (${f2(w.doneAt - w.startedAt)})`, 'story');
  await phaseWait('W', 1, 'wheel + 4.0'); await checkDoors('W');
  await heardWait('l5_unit_wheel', 3);
  await objectiveSeen('The trunk tunnel — floor level, south-west', 3);
  if (jumpOff) {   // softlock (g): off the west gallery's open edge to the bay floor during wave B
    const p = await ev(() => { const g = window.__game, r = g.level.rooms.find((x) => x.id === 'sub5'), pp = g.player.position; const f = (r.floors ?? []).find((q) => Math.abs(q.y - pp.y) < 0.2 && pp.x >= q.box[0] && pp.x <= q.box[1] && pp.z >= q.box[2] && pp.z <= q.box[3]); return f ? [f.box[1] + 0.5, f.y + 0.6, pp.z] : null; });
    if (!p) bad('softlock (g): the player is not on a gallery floor at the wheel', 'level');
    else {
      await ev((p) => { const g = window.__game; g.player.teleport(new (g.player.position.constructor)(p[0], p[1], p[2]), -Math.PI / 2, 0); }, p);
      ok(await untilG('g.player.position.y < 1.0', 4, 'fell to the bay floor', 'level', { quiet: true }), 'off the gallery edge to the floor (rail 1.1 m: by teleport over it)', 'level');
    }
  }
  if (leaveTwo) await untilG('S.alive("g5_bay_b").length >= 2', 4, 'g5_bay_b spawned', 'story');
  else await killUntil('!g.enemies.all.some((e) => e.alive && e.group === "g5_bay_b" && e.state !== "dormant")', 30, 'g5_bay_b dead', ['g5_bay_b']);
  await heardWait('l5_kes_tunnel', 8, 'story', 'l5_unit_wheel end + 0.4');
}
async function segTunnel({ doorway = false } = {}) {
  if (doorway) {   // softlock (i): the tunnel doorway during the latch
    if (!await stand('trig', 't5_tunnel', { fx: 0.3 })) return false;
    const ran = await untilG('(L.closing.d5_tunnel ?? []).length > 0 && (() => { const d = g.level.door("d5_tunnel"); g.player.teleport(d.position.clone().setY(d.y ?? 0), Math.PI / 2, 0); return true; })()', 6, 'd5_tunnel starts closing (latch armed)', 'story');
    if (ran) { await gameWait(2.5); ok(!(await ev(() => window.__game.level.door('d5_tunnel').locked)), 'tunnel latch with the player in the doorway: not latched', 'story'); }
  }
  if (!await stand('trig', 't5_tunnel', { fx: 0.3 })) return false;
  if (!await beatWait('l5_tunnel', 4, 'closeBehind d5_tunnel')) return false;
  await phaseWait('X', 2); await checkDoors('X');
  await killUntil('!g.enemies.all.some((e) => e.alive && g.level.roomAt(e.position)?.id === "tunnel5")', 20, 'tunnel5 clear');
  await heardWait('l5_kes_end', 12, 'story', 'X + 0.6, 0 hostiles in the tunnel');
  await heardWait(`l5_choir_end_${await choiceOf()}`, 15);
}
async function segEnd({ natural = true } = {}) {
  let end = await untilG('g.state === "ended" || (d.beats ?? []).includes("l5_end")', natural && !routeBroken ? 12 : 1, 'l5_end (CHOIR end + 0.8, cap 8 s after X)', 'story', { quiet: !natural || !!routeBroken });
  if (!end) {
    bad(`the level did not end by itself${routeBroken ? ` (route broken at "${routeBroken}")` : ''} — forcing story.end() (H1) to test the end contract`, routeBroken ? 'test' : 'story');
    const r = await evs(() => (typeof window.__game.story.end === 'function' ? (window.__game.story.end(), true) : false));
    if (r !== true) return bad('story.end (H1) missing: the end cannot be tested', 'story');
    end = await untilG('g.state === "ended"', 6, 'state ended after end()');
  }
  ok(end, 'state ended', 'story');
  await untilG('/POST 4/.test(document.querySelector(".cb")?.innerText ?? "")', 3, 'end card POST 4 on screen', 'story');
  const card = await ev(() => (document.querySelector('.cb')?.innerText ?? '').replace(/\s+/g, ' '));
  const next5 = await evs(() => window.__game.story.next?.() ?? null);
  const at = card.lastIndexOf('POST 4');
  ok(at >= 0 && /TO BE CONTINUED/.test(card.slice(at)) === (next5 === null), `end card "${card.slice(Math.max(0, at), at + 30)}" (next ${next5})`, 'story');
  await film('end_card', null, 2);
  const s = await ev((K) => ({ carry: JSON.parse(localStorage.getItem(K[0]) ?? 'null'), level: localStorage.getItem(K[1]), save: localStorage.getItem(K[2]) }), [CARRY_KEY, LEVEL_KEY, SAVE_KEY]);
  const c = s.carry, f = c?.facts ?? {};
  ok(c?.from === 5, `carry from 5 (${c?.from})`, 'story');
  ok(c && typeof c.armor === 'number' && 'carbine' in (c.weapons ?? {}), `carry armour ${c?.armor}, weapons ${c ? Object.keys(c.weapons ?? {}) : '—'}`, 'story');
  ok(typeof f.kills5 === 'number' && typeof f.testHour === 'number' && f.testHour > 62.5 && f.testHour < 64 && f.choice === await choiceOf(), `carry facts kills5 ${f.kills5}, testHour ${f2(f.testHour)}, choice ${f.choice}`, 'story');
  if (natural && !routeBroken) ok(f.radio === true && f.kessler === true && f.l5_door === true, `carry radio ${f.radio}, kessler ${f.kessler}, l5_door ${f.l5_door}, l5_boat ${f.l5_boat}`, 'story');
  ok(s.level === String(next5 ?? 5) && s.save === null, `stored level ${next5 ?? 5} (${s.level}), checkpoint cleared (${s.save === null})`, 'story');
}
// ── optional rooms, crawl, magazine, armoury, sub bay early, palm
async function segQuarters() {
  for (const [r, reads] of [['berths5', []], ['heads5', []], ['mess5', ['note5_mess']], ['galley5', []]]) {
    await stand('room', r); await gameWait(3.5);
    if (opt.reads) for (const id of reads) if (await stand('use', id)) { await use(id); await gameWait(0.5); await closeNote(); }
  }
  for (const id of ['p5_berth_med', 'p5_mess_ammo', 'p5_galley_med']) await touchPickup(id);
}
async function touchPickup(id) {
  const p = await ev((id) => { const x = window.__game.level.pickupSpawns.find((q) => q.id === id); return x ? [x.position.x, x.position.y, x.position.z] : null; }, id);
  if (!p) return bad(`pickup ${id} missing`, 'level');
  const s = await S5('spot', 'use', id, { dist: 0.6 }).catch(() => null);
  const sp = s && !s.err ? s : await ev((p) => { const S = window.__S5; const fy = S.floors(p[0], p[2]).filter((y) => y <= p[1] + 0.2).sort((a, b) => b - a)[0] ?? 0; const r = S.search(p[0], p[2], fy, null, { maxR: 1.2 }); return r ? { x: r[0], y: r[1], z: r[2], yaw: 0, pitch: 0 } : null; }, p);
  if (!sp) return bad(`pickup ${id}: no free stand point within 1.2 m (reachable? check:reach use list)`, 'level');
  await S5('tp', sp, false);
  const taken = await untilG(`(g.player.snapshot().pickups ?? []).includes(${JSON.stringify(id)})`, 2, `pickup ${id} collected on touch`, 'level', { quiet: true });
  if (!taken) note(`pickup ${id} not collected from (${[sp.x, sp.y, sp.z].map(f2)}) — touch radius vs stand point`);
  return taken;
}
async function segCrawlEnter() {
  if (!await stand('use', 'hatch5_spine')) return false;
  if ((await use('hatch5_spine')) !== 'ok') return bad('use hatch5_spine (S+)', 'story');
  await untilG('d.t?.["vignette:hatch5_spine_open"] !== undefined', 2, 'hatch5_spine_open', 'story');
  await ev(() => window.__game.player.debug.crouch?.(true));
  return stand('trig', 't5_crawl_e', {}, true);
}
async function segCrawl({ boots = true } = {}) {
  if (!await segCrawlEnter()) return false;
  if (boots) {
    await film('crawl_boots', null, 8);
    ok(await untilG('(d.scares ?? []).includes("v5_boots")', 3.5, 'v5_boots at t5_crawl_e + 2 s', 'story', { quiet: true }), 'v5_boots fired (t5_crawl_e + 2.0, calm)', 'story');
    ok(await untilG('S.alive("g5_patrol").length === 1', 2, 'g5_patrol spawned', 'story', { quiet: true }), 'g5_patrol exists only now', 'story');
  }
  const cps0 = (await dbg()).checkpoints?.length ?? 0;
  await gameWait(4);
  ok(((await dbg()).checkpoints?.length ?? 0) === cps0, 'no checkpoint written in the crawl', 'story');
  return true;
}
async function segMagazine() {
  if (!await stand('trig', 't5_mag')) return false;
  await film('magazine', 'd.scares?.includes("v5_magazine")', 26);
  ok(await untilG('(d.scares ?? []).includes("v5_magazine")', 27, 'v5_magazine with the g5_mag wake (≤ 25 s in t5_mag)', 'story', { quiet: true }), 'v5_magazine + g5_mag woke', 'story');
  await killUntil('!g.enemies.all.some((e) => e.alive && e.group === "g5_mag")', 15, 'g5_mag dead', ['g5_mag']);
  for (const id of ['p5_mag_ammo_1', 'p5_mag_med']) await touchPickup(id);
  if (await stand('use', 'hatch5_mag')) {
    ok((await use('hatch5_mag')) === 'ok', 'hatch5_mag used from below', 'story');
    await untilG('d.t?.["vignette:hatch5_mag_open"] !== undefined', 2, 'hatch5_mag_open', 'story');
  }
  await ev(() => window.__game.player.debug.crouch?.(false));
  await stand('room', 'arm5', { fz: 0.3 });
}
async function segArmoury() {
  await stand('room', 'arm5');
  if (await stand('use', 'p5_arm_vest')) { const a0 = await ev(() => window.__game.player.armor); await use('p5_arm_vest'); await untilG(`g.player.armor > ${a0} || g.player.armor >= 100`, 2, 'vest on', 'level'); }
  for (const id of ['p5_arm_ammo_1', 'p5_arm_plate']) await touchPickup(id);
}
async function segSubEarly() {   // order (d): the sub bay before the door — v5_sub_check, the locked tunnel
  await stand('trig', 't5_bay', { fz: 0.5, y: 0 });
  ok(await untilG('(d.scares ?? []).includes("v5_sub_check")', 50, 'v5_sub_check (≥ 3 s in the bay, phase ≥ S, scare spacing)', 'story', { quiet: true }), 'v5_sub_check fired', 'story');
  await stand('door', 'd5_tunnel', { room: 'sub5', dist: 1.2 });
  await deny('d5_tunnel');
  await heardWait('l5_unit_tunnel_co', 3, 'story', 'tunnel door before the beat');
  await ev(() => window.__game.story.radioAsk?.());
  await heardWait('l5_kes_hint_door', 5, 'story', 'Q in S → My door');
}
async function segPalm() {
  if (!await stand('use', 'launch5_palm')) return false;
  await use('launch5_palm');
  ok(await untilG('g.facts.l5_boat === true', 4, 'palm refused (1.6 s) → fact l5_boat'), 'launch palm refused, fact l5_boat', 'story');
  ok(/NOT ROSTERED — REYES, S\./.test(await ev(() => window.__game.level.screen('launch5_palm')?.userData?.screenText ?? '')), 'palm screen NOT ROSTERED — REYES, S.', 'story');
  await heardWait('l5_unit_launch_refused', 3);
  await heardWait('l5_kes_boat', 8, 'story', 'fact l5_boat');
}

/** All-mode checks at the end of a run (§10.1). */
async function runChecks(label) {
  if (skipped.length) bad(`${label}: ${skipped.length} segments not run after the break at "${routeBroken}": ${skipped.join(' · ')}`, 'test');
  skipped = [];
  const l = await L5().catch(() => null); if (!l) return bad(`${label}: watcher unreadable`, 'test');
  ok(!l.early.length, `${label}: R4 — no enemy before its beat (${l.early})`, 'story');
  const pop = l.spawns.filter((s) => s.seen && !s.opened);
  ok(!pop.length, `${label}: spawn visibility — nobody appears in view (watcher) ${JSON.stringify(pop)}`, 'level');
  const d = await dbg();
  const popS = (d.spawnLog ?? []).filter((s) => s.visible);
  ok(!popS.length, `${label}: spawn visibility — H7.spawnLog has no visible spawn ${JSON.stringify(popS).slice(0, 200)}`, 'story');
  ok(!l.cutBad.length, `${label}: never 'cutscene' outside the scene (${l.cutBad})`, 'story');
  const log = await ev(() => (window.__game.story.lineLog ?? []).filter((x) => x.said)).catch(() => []);
  const timed = log.filter((x) => typeof x.cue === 'number'), late = timed.filter((x) => Math.abs(x.t - x.cue) > 0.12);
  ok(!late.length, `${label}: every timed line ≤ 0.12 s from its cue (${timed.length} timed of ${log.length}) ${late.map((x) => `${x.said} ${f2(x.t - x.cue)}`).join(', ')}`, 'story');
  if (log.length && !timed.length) bad(`${label}: no lineLog entry carries a cue (H5)`, 'story');
  const noDur = [...new Set(log.filter((x) => typeof x.dur !== 'number' || typeof x.end !== 'number').map((x) => x.said))];
  if (log.length) ok(!noDur.length, `${label}: every spoken line logs dur + end (H5) ${noDur.slice(0, 6)}`, 'story');
  for (const s of l.softLocks) bad(`${label}: SOFT-LOCK ${JSON.stringify(s)}`, 'story');
  if (Array.isArray(d.missingMarkers) && d.missingMarkers.length) bad(`${label}: story reports missing markers ${d.missingMarkers}`, 'level');
}
function printOracle(l, strict) {
  if (!l) return;
  console.log(`\n  ORACLE: ${l.lines.length} lines judged, ${l.viol.length} false; no oracle for: ${l.noOracle.join(', ') || '—'}`);
  for (const v of l.viol) (strict ? (m) => bad(m, 'story') : note)(`line said while its rule was false: ${JSON.stringify(v)}`);
  if (l.noOracle.length) note(`lines without an oracle in this script: ${l.noOracle}`);
  console.log('  lines:', l.lines.map((x) => `${x.t} ${x.id}`).join(' | ') || '—');
}
async function fireAt(p, n = 1) {
  await ev(async ([p, n]) => {
    const g = window.__game;
    for (let i = 0; i < n; i++) {
      const e = g.player.eye, dx = p[0] - e.x, dy = p[1] - e.y, dz = p[2] - e.z;
      g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      await new Promise((r) => setTimeout(r, 60));
      const w = g.player.currentWeapon ? g.player.weapons[g.player.currentWeapon] : null;
      if (w && w.clip === 0) { g.player.debug.reload(); const t0 = g.time; while (g.player.weapons[g.player.currentWeapon]?.reloading || g.time - t0 < 0.2) { await new Promise((r) => setTimeout(r, 100)); if (g.time - t0 > 5) break; } }
      g.player.debug.fire();
      await new Promise((r) => setTimeout(r, 300));
    }
  }, [p, n], 60000);
}

// ───────────────────────────────────────────────────────────── the route
async function freshRun(label, query = '', o = {}) {
  routeBroken = null; skipped = [];
  await session(label);
  if (!await boot(query, o)) { routeBroken = 'boot'; return false; }
  // the title card (4.2 s, autostart) ends in 'playing'
  if (!await untilG('g.state === "playing"', 12, 'state playing after the title card', 'story')) { routeBroken = 'boot'; return false; }
  return true;
}
async function route(o = {}, hooks = {}) {
  Object.assign(opt, { reads: false, turnstile: true, gateDoorway: false }, o);
  const at = async (k) => { if (hooks[k] && !routeBroken) await hooks[k](); };
  await seg('arrival (A → B)', [...N.base, ...N.arrival], segArrival);
  await at('afterArrival');
  await seg('gatehouse, latch (B → B2)', N.gatehouse, segGatehouse);
  await seg('the scene "Under control" (B2 → C → D0)', N.scene, segScene);
  await seg('the units (D0 → D), cp5_ready', N.units, () => segUnits({ killS1First: !!o.killS1First }));
  await at('beforeS1');
  await seg('the first soldier, the radio point', N.s1, () => segS1({ squawk: !!o.squawk, leave: !!o.leaveRadio }));
  await at('beforeRadio');
  if (o.keypadDead !== false) await seg('keypad before the power cue', ['use:key5_duty', 'ds:keypad'], () => segKeypadDead({ withCode: !!o.codeBeforePower }));
  await seg('the radio, Kessler (D → K)', N.radio, () => segRadio({ codeDuring: !!o.codeDuring }));
  await seg('the keypad (K → S)', N.keypad, () => segKeypad({ wrong: o.wrong ?? 0 }));
  await at('afterKeypad');
  await seg('the spine wave (S), cp5_spine', N.spine, () => segSpine({ hideInCrawl: o.hideInCrawl ?? 0, bodyScare: !!o.bodyScare }));
  await at('beforeDoor');
  await seg("Kessler's door, the neck check (S → V), lights-out", N.door, () => segDoor({ startFacing: o.startFacing ?? 'door', edge: !!o.edge, leaveTimes: o.leaveTimes ?? 0 }));
  await seg('the vent wave (g5_cmd)', N.vent, segVent);
  await seg('the sub bay in the dark, cp5_bay', N.bay, () => segBay({ hideInMag: o.hideInMag ?? 0 }));
  await at('beforeWheel');
  await seg('the gallery wheel (V → W)', N.wheel, () => segWheel({ jumpOff: !!o.jumpOff, leaveTwo: !!o.leaveTwo }));
  await seg('the tunnel (W → X)', N.tunnel, () => segTunnel({ doorway: !!o.tunnelDoorway }));
  console.log('── the end');
  await segEnd({ natural: true });
}

// ───────────────────────────────────────────────────────────── modes
async function runContract() {
  await session('contract');
  if (!await boot('')) return;
  await gameWait(1.0);
  await contract({ full: true });
  await staticPass();
}
if (MODE === 'probe') {
  await session('probe');
  await page.goto(`${base}/?level=${PROBE_LEVEL}&autostart=1&god=1&nostory=1&noenemies=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
  const list = await ev(() => ({ trig: (window.__game.__triggers ?? []).map((t) => t.id), use: window.__game.interactables.all.filter((i) => i.kind !== 'door').map((i) => i.id) }));
  console.log(`── probe level ${PROBE_LEVEL}: ${list.trig.length} triggers, ${list.use.length} interactables`);
  let found = 0;
  const nearIds = flagv('near')?.split(',') ?? [];   // markers to stand 4 m from (the scare vantage points)
  for (const [kind, ids, o] of [['trig', list.trig, {}], ['use', list.use, {}], ['near', nearIds, { dist: 4 }]]) for (const id of ids) {
    const sp = await S5('spot', kind, id, o).catch((e) => ({ err: e.message }));
    if (!sp || sp.err) { note(`${kind} ${id}: ${sp?.err}`); continue; }
    await S5('tp', sp, false); await gameWait(0.25);
    const p = await ev(() => window.__game.player.position.toArray());
    const moved = Math.hypot(p[0] - sp.x, p[2] - sp.z);
    if (moved > 0.35 || Math.abs(p[1] - sp.y) > 0.4) bad(`${kind} ${id}: stood at (${[sp.x, sp.y, sp.z].map(f2)}) in ${sp.room} → pushed to (${p.map(f2)})`, 'test');
    else found++;
  }
  console.log(`  ${found} spots held`);
} else if (MODE === 'contract') {
  await runContract();
} else if (MODE === 'default') {
  for (const choice of CHOICES) {
    console.log(`\n══════════ LEVEL 5 — choice ${choice} ══════════`);
    if (!await freshRun(`default ${choice}`, `&choice=${choice}`)) continue;
    await segBoot({ choice });
    if (choice === CHOICES[0]) { await contract({ full: false }); await staticPass(); routeBroken = null; }
    // stop: wait for the squawk, take the radio after it, type the code after the sequence; start facing the door (_3)
    // command: take the radio at once, type the code during the sequence (_9b); start already turned (_hold)
    await route(choice === 'stop' ? { squawk: true, startFacing: 'door' } : { codeDuring: true, startFacing: 'away' });
    await runChecks(choice);
    printOracle(await L5().catch(() => null), false);
  }
} else if (MODE === 'checkpoints') {
  const UPTO = { cp5_start: 'arrival', cp5_duty: 'scene', cp5_ready: 'units', cp5_radio: 'radio', cp5_spine: 'spine', cp5_door: 'door', cp5_bay: 'bay' };
  const PHASE_OF = { cp5_start: ['B'], cp5_duty: ['D0', 'D'], cp5_ready: ['D'], cp5_radio: ['K'], cp5_spine: ['S'], cp5_door: ['V'], cp5_bay: ['V', 'W'] };
  const STEPS = [
    ['arrival', [...N.base, ...N.arrival], segArrival], ['gate', N.gatehouse, () => { opt.turnstile = false; return segLatch(); }], ['scene', N.scene, segScene],
    ['units', N.units, () => segUnits()], ['s1', N.s1, () => segS1()], ['radio', N.radio, () => segRadio({ ask: false })], ['keypad', N.keypad, () => segKeypad()],
    ['spine', N.spine, () => segSpine()], ['door', N.door, () => segDoor()], ['vent', N.vent, segVent], ['bay', N.bay, () => segBay()],
    ['wheel', N.wheel, () => segWheel()], ['tunnel', N.tunnel, () => segTunnel()],
  ];
  const playTo = async (name) => { let k = 0; for (; k < STEPS.length; k++) { await seg(STEPS[k][0], STEPS[k][1], STEPS[k][2]); if (STEPS[k][0] === name || routeBroken) break; } return k; };
  const finishFrom = async (k) => { routeBroken = null; for (k = k + 1; k < STEPS.length; k++) await seg(STEPS[k][0], STEPS[k][1], STEPS[k][2]); await segEnd({ natural: true }); };
  const dieAndLoad = async () => {
    await ev(() => { const g = window.__game; g.debug.god = false; g.player.damage(9999); g.player.damage(9999); });
    ok(await untilG('g.state === "dead"', 4, 'died'), 'died', 'test');
    await boot('&continue=1');
    return untilG('g.state === "playing"', 10, 'playing after the load', 'story');
  };
  let first = true;
  for (const cp of CPS) {
    if (ONLY_CP && cp !== ONLY_CP) continue;
    console.log(`\n══════════ ${cp} ══════════`);
    if (!await freshRun(cp, '&choice=stop')) continue;
    if (first) { await contract({ full: false }); routeBroken = null; first = false; }
    Object.assign(opt, { reads: false, turnstile: false });
    const k = await playTo(UPTO[cp]);
    if (routeBroken) { bad(`${cp}: not reached (route broken at "${routeBroken}")`, 'test'); await segEnd({ natural: false }); continue; }
    if (!await cpWait(cp, 12)) { await segEnd({ natural: false }); continue; }
    await gameWait(0.4);
    const want = (await L5()).cpState[cp] ?? await ws();
    const saved = await ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), SAVE_KEY);
    ok(saved?.id === cp, `the save holds ${cp} (${saved?.id})`, 'story');
    const beatsBefore = (await dbg()).beats ?? [];
    if (!await dieAndLoad()) { continue; }
    await gameWait(1.0);
    const got = await ws(), d = await dbg();
    await page.screenshot({ path: `shots/l5/${cp}-restored.png` }).catch(() => {});
    ok(d.restoredFrom === cp && PHASE_OF[cp].includes(d.phaseApplied), `${cp}: restoredFrom ${d.restoredFrom}, phase ${d.phaseApplied} (want ${PHASE_OF[cp]})`, 'story');
    if (!got || got.__err || !want) bad(`${cp}: worldState() (H13) unavailable — before ${!!want}, after ${got?.__err ?? !!got}`, 'story');
    else {
      const norm = (w) => ({ ...w, doors: Object.fromEntries(Object.entries(w.doors ?? {}).map(([k2, v]) => [k2, { locked: v.locked, status: v.status ?? null }])), screens: Object.fromEntries(Object.entries(w.screens ?? {}).map(([k2, v]) => [k2, String(v).replace(/\d\d:\d\d(:\d\d)?/g, '##')])) });
      const a = norm(got), b = norm(want);
      for (const key of ['doors', 'hatches', 'lightsOut', 'dark', 'screens', 'pickups', 'scares']) {
        const same = JSON.stringify(a[key]) === JSON.stringify(b[key]);
        ok(same, `${cp}: ${key} as saved${same ? '' : ` — ${JSON.stringify(a[key]).slice(0, 160)} ≠ ${JSON.stringify(b[key]).slice(0, 160)}`}`, 'story');
      }
      const fl = (f) => Object.fromEntries(Object.entries(f ?? {}).filter(([k2]) => !['s1Free', 'patrolFree', 'unitsIn'].includes(k2)));
      ok(JSON.stringify(fl(a.flags)) === JSON.stringify(fl(b.flags)), `${cp}: flags ${JSON.stringify(a.flags)}`, 'story');
      if (typeof b.torch === 'number' && typeof a.torch === 'number') ok(a.torch >= Math.min(0.5, b.torch) - 0.01, `${cp}: torch ${f2(a.torch)} (saved ${f2(b.torch)}; restored ≥ 50 % if it was on)`, 'story');
    }
    if (saved?.player) {
      const p = await ev(() => ({ pos: window.__game.player.position.toArray(), armor: window.__game.player.armor, w: Object.fromEntries(Object.entries(window.__game.player.weapons).map(([k2, w]) => [k2, { owned: !!w.owned, total: (w.clip ?? 0) + (w.reserve ?? 0) }])) }));
      const sp = saved.player.position;
      if (Array.isArray(sp)) ok(Math.hypot(p.pos[0] - sp[0], p.pos[2] - sp[2]) < 0.8, `${cp}: position ${p.pos.map(f2)}`, 'story');
      ok(p.armor === (saved.player.armor ?? 0), `${cp}: armour ${p.armor} = saved ${saved.player.armor}`, 'story');
      const sw = Object.fromEntries(Object.entries(saved.player.weapons ?? {}).map(([k2, w]) => [k2, { owned: !!w.owned, total: (w.clip ?? 0) + (w.reserve ?? 0) }]));
      ok(JSON.stringify(p.w) === JSON.stringify(sw), `${cp}: weapons ${JSON.stringify(p.w)}`, 'story');
    }
    // §7: what each restore rebuilds
    const gr = await ev(() => ({ s1: window.__S5.alive('g5_s1'), patrol: window.__S5.alive('g5_patrol'), duty: window.__S5.alive('g5_duty') }));
    if (['cp5_duty', 'cp5_ready'].includes(cp)) ok(gr.s1.length === 1 && gr.s1[0].state === 'idle', `${cp}: g5_s1 re-spawned holding (afterReplay, radio false) (${JSON.stringify(gr.s1)})`, 'story');
    if (cp === 'cp5_ready') ok(!gr.duty.length, `${cp}: g5_duty cleared (${gr.duty.length})`, 'story');
    if (['cp5_radio', 'cp5_spine', 'cp5_door', 'cp5_bay'].includes(cp)) ok(!gr.s1.length && d.radio?.owned === true, `${cp}: g5_s1 absent, radio owned (${gr.s1.length}, ${d.radio?.owned})`, 'story');
    ok(!gr.patrol.length, `${cp}: g5_patrol absent after the load`, 'story');
    if (cp === 'cp5_duty') {
      ok(await untilG('S.alive("g5_duty").length === 2', 3, 'units replay from H + 1.5'), `${cp}: units replay`, 'story');
      ok(!(await L5()).states.some((s) => s.state === 'cutscene'), `${cp}: the scene is not replayed`, 'story');
    }
    if (cp === 'cp5_radio') {
      const n = await ev(() => (window.__game.story.lineLog ?? []).filter((l) => /^l5_kes_[1-4]$/.test(l.said ?? '')).length);
      ok(n === 0, `${cp}: lines _1 … _4 not repeated after the load (${n})`, 'story');
    }
    const replayed = (await L5()).beats.filter((b) => beatsBefore.includes(b) && !(b === 'l5_dark' && ['cp5_door', 'cp5_bay'].includes(cp)));
    ok(!replayed.length, `${cp}: no beat re-emitted by the load (${replayed})`, 'story');
    if (['cp5_door', 'cp5_bay'].includes(cp)) ok((await L5()).beats.includes('l5_dark'), `${cp}: l5_dark re-emitted on restore (audio)`, 'story');
    await toastSeen('checkpoint restored', 3);
    await finishFrom(k);
    await runChecks(cp);
  }
  if (!ONLY_CP) {
    // B1 (i): kill g5_s1, die before the radio → he holds again; the radio comes with him
    console.log('\n══════════ B1 (i): killed g5_s1, died before the radio ══════════');
    if (await freshRun('B1 i', '&choice=stop')) {
      Object.assign(opt, { reads: false, turnstile: false });
      await playTo('units');
      await seg('kill g5_s1, leave the radio', N.s1, () => segS1({ leave: true }));
      if (!routeBroken && await dieAndLoad()) {
        await gameWait(1.0);
        const d = await dbg(), s1 = await S5('alive', 'g5_s1'), mk = await S5('mk', 'mk5_s1');
        ok(['cp5_ready', 'cp5_duty'].includes(d.restoredFrom), `restored ${d.restoredFrom}`, 'story');
        ok(s1.length === 1 && s1[0].state === 'idle' && mk && Math.hypot(s1[0].pos[0] - mk[0], s1[0].pos[2] - mk[2]) <= 0.6, `g5_s1 holding at mk5_s1 again (${JSON.stringify(s1)})`, 'story');
        ok(d.radio?.owned === false && !Array.isArray(d.radio?.pos), `the radio not owned, no radio point before he dies again (${JSON.stringify(d.radio)})`, 'story');
        await seg('kill him again, take the radio', N.s1, () => segS1());
        if (!routeBroken) { ok((await use('radio5')) === 'ok', 'radio5 takeable after he dies again', 'story'); ok(await untilG('!!d.radio?.owned', 1, 'radio owned'), 'radio owned', 'story'); }
      }
      await runChecks('B1 i');
    }
    // B1 (ii): die with the patrol holding → absent after the load, cp5_spine was takeable
    console.log('\n══════════ B1 (ii): died with the patrol holding ══════════');
    if (await freshRun('B1 ii', '&choice=stop')) {
      Object.assign(opt, { reads: false, turnstile: false });
      await playTo('spine');
      await seg('crawl, the boots, the patrol holds', N.crawl, () => segCrawl({ boots: true }));
      if (!routeBroken) {
        await untilG('S.alive("g5_patrol").some((e) => e.state === "idle")', 25, 'the patrol walks east and holds at mk5_patrol_end', 'story');
        ok((await dbg()).checkpoints?.includes('cp5_spine'), 'cp5_spine was takeable before the boots', 'story');
        if (await dieAndLoad()) {
          await gameWait(1.0);
          const d = await dbg();
          ok(d.restoredFrom === 'cp5_spine', `restored ${d.restoredFrom}`, 'story');
          ok(!(await S5('alive', 'g5_patrol')).length && !d.groups?.g5_patrol?.spawned, `g5_patrol absent after the load (${JSON.stringify(d.groups?.g5_patrol)})`, 'story');
        }
      }
      await runChecks('B1 ii');
    }
  }
} else if (MODE === 'impatient') {
  console.log('\n══════════ IMPATIENT ══════════');
  if (await freshRun('impatient', '&choice=command')) {
    await segBoot({ choice: 'command' });
    await contract({ full: false }); await staticPass(); routeBroken = null;
    await ev(() => window.__game.player.debug.switchTo('pistol'));
    await route({ codeDuring: false, wrong: 3, startFacing: 'door', killS1First: true, codeBeforePower: true }, {
      afterArrival: async () => {
        // the duty door before the scene: shots ride the leaf, no reaction (nobody exists yet)
        const dp = await ev(() => { const d = window.__game.level.door('d5_duty'); return [d.position.x, (d.y ?? 0) + 1.4, d.position.z]; });
        await stand('door', 'd5_duty', { room: 'gate5', dist: 3.0 }); await fireAt(dp, 3);
        ok(!(await ev(() => window.__game.enemies.all.some((e) => e.alive && e.state !== 'dormant'))), 'shooting the duty door wakes nothing (R4)', 'story');
        // the booth glass (N1: mk5_glass panes with positions)
        const panes = await ev(() => { const u = window.__game.level.object('mk5_glass')?.userData?.panes; return Array.isArray(u) ? u.map((p) => ({ id: p.id ?? p.name, p: Array.isArray(p.p) ? p.p : p.p?.toArray?.() ?? p.position?.toArray?.() ?? null })) : null; });
        const booth = panes?.find((p) => /booth/.test(p.id));
        if (!booth?.p) bad(`mk5_glass.userData.panes has no booth pane with a position (N1) (${JSON.stringify(panes)})`, 'level');
        else { await stand('room', 'gate5', { look: booth.p, fx: 0.3, fz: 0.75 }); await fireAt(booth.p, 2); ok((await L5()).hits.some((h) => h.s === 'glass'), 'the booth glass takes the rounds (stars)', 'level'); }
      },
      beforeRadio: async () => {
        // every body so far (the units, Brekke): shots on the dead — holes, no line, no reaction, the radio stays
        for (const b of (await L5()).died.filter((x) => x.pos)) {
          const p = [b.pos[0], b.pos[1] + 0.25, b.pos[2]];
          const at = await ev((p) => { const S = window.__S5, r = S.search(p[0] + 2, p[2], p[1] - 0.25, null, { maxR: 2.5 }); if (r) S.tp({ x: r[0], y: r[1], z: r[2], yaw: 0, pitch: 0 }); return !!r; }, p);
          if (at) await fireAt(p, 1); else note(`no stand point 2 m from the body of ${b.group} (${b.pos.map(f2)})`);
        }
        ok(!(await L5()).lines.some((x) => x.id === 'l5_kes_shot'), 'shooting bodies says nothing', 'story');
      },
      afterKeypad: async () => {
        // the tunnel door before the beat; Q in S; the wheel before V; the palm on the launch console
        await seg('sub bay first: v5_sub_check, tunnel before the beat', ['trig:t5_bay', 'door:d5_tunnel'], segSubEarly);
        routeBroken = null;
        if (await stand('use', 'wheel5')) { const r = await use('wheel5'); ok(r === 'disabled' || !(await ev(() => (window.__game.story.debugState.beats ?? []).includes('l5_wheel'))), `wheel before V: ${r}, no l5_wheel`, 'story'); }
        await seg('the launch palm (refused)', N.palm, segPalm);
        routeBroken = null;
        // the boat
        const tern = await ev(() => { const o = window.__game.level.object('tern'); if (!o) return null; const p = o.getWorldPosition(o.position.clone()); return [p.x, p.y + 1.5, p.z]; });
        if (tern) { await stand('trig', 't5_bay', { fz: 0.6, y: 0, look: tern }); await fireAt(tern, 2); }
        else bad('object tern missing (W7)', 'level');
      },
      beforeDoor: async () => {
        const port = await S5('mk', 'mk5_port');
        if (port) { await stand('trig', 't5_cmd', { fx: 0.1, away: ['t5_cmd_line'], look: port }); await fireAt(port, 2); await heardWait('l5_kes_shot', 5, 'story', 'a bullet on the module door / port'); }
      },
    });
    await runChecks('impatient');
    const l = await L5().catch(() => null);
    printOracle(l, true);
    if (l) {
      const ch = l.lines.filter((x) => /_(stop|command)$/.test(x.id));
      ok(ch.every((x) => x.id.endsWith('_command')), `every choice line is the command variant (${ch.map((x) => x.id)})`, 'story');
      const shot = l.lines.filter((x) => x.id === 'l5_kes_shot').length; ok(shot <= 1, `l5_kes_shot at most once (${shot})`, 'story');
    }
  }
} else if (MODE === 'order') {
  const V = {
    a: { label: '(a) straight to Kessler\'s door after the keypad', o: {} },
    b: { label: '(b) every optional room first, crawl last', o: { reads: true }, hooks: { afterKeypad: async () => { await seg('quarters', N.quarters, segQuarters); await seg('armoury', N.armoury, segArmoury); await seg('crawl', N.crawl, () => segCrawl()); await seg('magazine', N.mag, segMagazine); } } },
    c: { label: '(c) crawl first, then the door', o: {}, hooks: { afterKeypad: async () => { await seg('crawl first (before the spine wave)', N.crawl, () => segCrawl({ boots: true })); ok(!(await dbg()).beats?.includes('l5_spine_wave'), 'the spine wave does not fire from the crawl (t5_spine_mid above y −0.5)', 'story'); await seg('magazine', N.mag, segMagazine); } } },
    d: { label: '(d) sub bay before the door', o: {}, hooks: { afterKeypad: async () => { await seg('sub bay first', ['trig:t5_bay', 'door:d5_tunnel'], segSubEarly); } } },
    e: { label: '(e) never the armoury or the crawl', o: {} },
    f: { label: '(f) the launch palm before the door', o: {}, hooks: { afterKeypad: async () => { await seg('palm first', N.palm, segPalm); } } },
  };
  for (const v of VARIANTS) {
    if (!V[v]) continue;
    console.log(`\n══════════ ORDER ${V[v].label} ══════════`);
    if (!await freshRun(`order ${v}`, '&choice=stop')) continue;
    if (v === VARIANTS[0]) { await contract({ full: false }); routeBroken = null; }
    await route(V[v].o, V[v].hooks ?? {});
    const l = await L5().catch(() => null);
    if (l && (v === 'a' || v === 'e')) ok(!l.spawns.some((s) => s.group === 'g5_patrol'), `(${v}) g5_patrol never exists`, 'story');
    if (l && v === 'e') { const c = await ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), CARRY_KEY); ok(!!c, `(e) the level ends without armoury / crawl (carry ${!!c})`, 'story'); }
    await runChecks(`order ${v}`);
  }
} else if (MODE === 'softlock') {
  const has = (c) => CASES.includes(c);
  const sb = {};
  if (['a', 'b', 'f', 'i', 'j'].some(has)) {
    console.log('\n══════════ SOFTLOCK run 1: (a) lock5 120 s · (b) gate doorway · (f) leave the line ×5 · (i) tunnel doorway · (j) the line\'s edge ══════════');
    if (await freshRun('softlock 1', '&choice=stop')) {
      await route({ ...sb, gateDoorway: has('b'), leaveTimes: has('f') ? 5 : 0, tunnelDoorway: has('i'), edge: has('j'), startFacing: 'away' }, {
        afterArrival: has('a') ? async () => {
          console.log('   (a) 120 s in lock5');
          await stand('trig', 't5_lock');
          await gameWait(120);
          const s = await ev(() => ({ awake: window.__game.enemies.all.filter((e) => e.alive && e.state !== 'dormant').length, ph: window.__game.story.debugState.phaseApplied, open: window.__game.level.door('d5_gate').isOpen }));
          ok(s.awake === 0 && s.ph === 'B' && s.open, `(a) after 120 s in lock5: nothing came, phase ${s.ph}, gate open ${s.open}`, 'story');
        } : undefined,
      });
      await runChecks('softlock 1');
    }
  }
  if (has('c') || has('l')) {
    console.log('\n══════════ SOFTLOCK run 2: (c) never take the radio for 180 s, then take it · (l) the code before the power ══════════');
    if (await freshRun('softlock 2', '&choice=command')) {
      await route({ ...sb, leaveRadio: true, codeBeforePower: has('l') }, {
        beforeRadio: has('c') ? async () => {
          console.log('   (c) 180 s without the radio');
          await stand('room', 'ready5', { fz: 0.6 });
          await gameWait(180);
          const d = await dbg(), n = (await ev(() => window.__game.story.lineLog.filter((l) => /^l5_kes_squawk_/.test(l.said ?? '')).length));
          ok(n >= 5, `(c) squawks every 25 s then 40 s: ${n} in 180 s (≥ 5)`, 'story');
          ok(d.keypad?.powered === false && d.phaseApplied === 'D', `(c) keypad still dead, phase ${d.phaseApplied} (nothing opens by timer)`, 'story');
          await stand('use', 'radio5', { dist: 1.2 });
        } : undefined,
      });
      await runChecks('softlock 2');
    }
  }
  if (has('d')) {
    console.log('\n══════════ SOFTLOCK run 3: (d) hide in the crawl during the spine wave for 60 s ══════════');
    if (await freshRun('softlock 3', '&choice=stop')) { await route({ ...sb, hideInCrawl: 60 }); await runChecks('softlock 3'); }
  }
  if (['e', 'g', 'h'].some(has)) {
    console.log('\n══════════ SOFTLOCK run 4: (e) magazine during bay wave A · (g) off the gallery in wave B · (h) into the tunnel with two alive ══════════');
    if (await freshRun('softlock 4', '&choice=command')) { await route({ ...sb, hideInMag: has('e') ? 45 : 0, jumpOff: has('g'), leaveTwo: has('h') }); await runChecks('softlock 4'); }
  }
  if (has('k')) {
    console.log('\n══════════ SOFTLOCK run 5: (k) ?level=5 cold (no god, no choice) ══════════');
    if (await freshRun('softlock 5', '', { god: false })) {
      await segBoot({ choice: 'stop' });
      await seg('arrival (cold)', [...N.base, ...N.arrival], segArrival);
      await seg('gatehouse (cold)', N.gatehouse, segGatehouse);
      const st = await ev(() => ({ state: window.__game.state, hp: window.__game.player.health }));
      ok(st.state !== 'dead', `(k) cold start plays (${st.state}, health ${st.hp})`, 'story');
      await runChecks('softlock 5');
    }
  }
  if (has('m')) {
    console.log('\n══════════ SOFTLOCK run 6: (m) dying before the radio is taken ══════════');
    if (await freshRun('softlock 6', '&choice=stop')) {
      await route({ ...sb, leaveRadio: true }, {
        beforeRadio: async () => {
          await ev(() => { const g = window.__game; g.debug.god = false; g.player.damage(9999); g.player.damage(9999); });
          await untilG('g.state === "dead"', 4, 'died before the radio', 'test');
          await boot('&continue=1&choice=stop');
          await untilG('g.state === "playing"', 10, 'playing after the load');
          await gameWait(1.0);
          ok((await S5('alive', 'g5_s1')).length === 1, '(m) g5_s1 stands again after the load (afterReplay, radio false)', 'story');
          await seg('the first soldier again', N.s1, () => segS1());
        },
      });
      await runChecks('softlock 6');
    }
  }
} else if (MODE === 'scares') {
  // one calm route that visits every scare's room (waits on game time for the spacing rule), then forced fights
  console.log('\n══════════ SCARES: the calm route ══════════');
  if (await freshRun('scares', '&choice=stop')) {
    /** Let the spacing rule allow `id` (≥ 45 s since the last scare, ≥ 90 s since the last loud one — §5.5), on game
     *  time, then set up its trigger and wait for it. */
    const scareWait = async (id, gs, setup) => {
      await seg(`scare ${id}`, [], async () => {
        const d = await dbg(), log = d.scareLog ?? [];
        const last = Math.max(-1e9, ...log.filter((x) => !SCARES5[x.id]?.exempt).map((x) => x.t));
        const lastLoud = Math.max(-1e9, ...log.filter((x) => SCARES5[x.id]?.loud && !SCARES5[x.id]?.exempt).map((x) => x.t));
        const until = SCARES5[id]?.exempt ? 0 : Math.max(last + 45, SCARES5[id]?.loud ? lastLoud + 90 : -1e9) + 0.5;
        const idle = until - (d.now ?? 0);
        if (idle > 0) { console.log(`   (waiting ${idle.toFixed(1)} s of game time for the spacing rule before ${id})`); await gameWait(idle); }
        if (setup) await setup();
        ok(await untilG(`(d.scares ?? []).includes(${JSON.stringify(id)})`, gs, `${id} (calm, spacing ≥ 45 s / loud ≥ 90 s)`, 'story', { quiet: true }), `${id} fired`, 'story');
      });
      routeBroken = null;
    };
    await route({ turnstile: true, bodyScare: true }, {
      beforeRadio: async () => {
        // 3 … 9 m from mk5_locker_slam, it within 70° of view (§5.5 #2)
        await scareWait('v5_hull_groan', 20, async () => { const m = await S5('mk', 'mk5_locker_slam'); await stand('near', 'mk5_locker_slam', { dist: 6, room: 'ready5' }); void m; });
      },
      afterKeypad: async () => {
        await scareWait('v5_bunk_radio', 20, () => stand('room', 'berths5'));
        { const b = await S5('mk', 'mk5_body_a'); if (b) { await stand('mk', 'mk5_body_a', { look: [b[0], b[1] + 0.3, b[2]], maxR: 3 }); await gameWait(1.5); } else bad('marker mk5_body_a missing (v5_body)', 'level'); }
        await untilG('(d.heard ?? []).includes("l5_kes_names") || g.story.lineLog.some((l) => l.said === "l5_kes_names")', 10, 'l5_kes_names after the bunk radio', 'story');
        await scareWait('v5_water', 20, () => stand('room', 'heads5'));
        await scareWait('v5_trays', 20, () => stand('room', 'mess5', { fz: 0.6 }));
        // looks at the frosted window (≤ 60°) for 0.5 s at 3 … 8 m (§5.5 #5)
        await scareWait('v5_galley_shape', 20, async () => { const m = await S5('mk', 'mk5_oilskin'); await stand('near', 'mk5_oilskin', { dist: 5, room: 'galley5', los: false }); });
        await scareWait('v5_sub_check', 20, () => stand('trig', 't5_bay', { fz: 0.5, y: 0 }));
        await scareWait('v5_boots', 20, () => segCrawl({ boots: false }));
        await scareWait('v5_magazine', 30, () => stand('trig', 't5_mag'));
        await killUntil('!g.enemies.all.some((e) => e.alive && ["g5_mag", "g5_patrol"].includes(e.group))', 20, 'g5_mag + patrol dead', ['g5_mag', 'g5_patrol']);
        await ev(() => window.__game.player.debug.crouch?.(false));
      },
      beforeDoor: async () => {},
    });
    const l = await L5().catch(() => null), d = await dbg();
    if (routeBroken) bad(`scares not judged: the calm route broke at "${routeBroken}" (see the skip above)`, 'test');
    else if (l) {
      const ids = (d.scareLog ?? []).map((x) => x.id);
      for (const id of Object.keys(SCARES5)) { const n = ids.filter((x) => x === id).length; ok(n === 1, `${id} fired ${n} × (exactly once)`, 'story'); }
      const log = [...(d.scareLog ?? [])].sort((a, b) => a.t - b.t);
      for (let i = 1; i < log.length; i++) {
        const a = log[i - 1], b = log[i];
        if (SCARES5[b.id]?.exempt || SCARES5[a.id]?.exempt) continue;
        ok(b.t - a.t >= 45 - 0.2, `${a.id} → ${b.id}: ${f2(b.t - a.t)} s apart (≥ 45)`, 'story');
      }
      const loud = log.filter((x) => SCARES5[x.id]?.loud && !SCARES5[x.id]?.exempt);
      for (let i = 1; i < loud.length; i++) ok(loud[i].t - loud[i - 1].t >= 90 - 0.2, `loud ${loud[i - 1].id} → ${loud[i].id}: ${f2(loud[i].t - loud[i - 1].t)} s (≥ 90)`, 'story');
      for (const s of l.scares) ok(!s.near.length && !s.inCutscene, `${s.id}: no hostile awake within 30 m when it fired (${s.near})`, 'story');
      // one owner per sound: each vignette sound once in the 12 s after its scare
      if (!l.audio.length) bad('audio log (H14 audioLog / audio.debug.log) empty: the owner audit cannot run', 'audio');
      else for (const s of l.scares) for (const snd of SCARES5[s.id]?.sounds ?? []) {
        const n = l.audio.filter((a) => a.id === snd && a.at >= s.at - 0.5 && a.at <= s.at + 12).length;
        ok(n === 1, `${s.id}: ${snd} played ${n} × (once; 0 = missing in the vignette, 2 = owned twice)`, n === 0 ? 'level' : 'story');
      }
      if (l.audio.length) {
        for (const snd of ['gate_open_heavy', 'gate_close_heavy']) { const n = l.audio.filter((a) => a.id === snd).length; ok(n === 1, `${snd} once (the door d5_gate owns it, S1o) (${n})`, n === 0 ? 'level' : 'story'); }
        const ok1 = l.audio.filter((a) => a.id === 'keypad_ok').length; ok(ok1 === 1, `keypad_ok once (UI-owned) (${ok1})`, 'ui');
      }
    }
    await runChecks('scares');
    // snaps on restore: die after the scares, load the last checkpoint, the end states come back
    console.log('\n── scares: restored by snap on load');
    const before = (await ws())?.scares ?? null;
    const cp = (await dbg()).checkpoint;
    if (cp) {
      await ev(() => { const g = window.__game; g.debug.god = false; g.player.damage(9999); g.player.damage(9999); });
      await untilG('g.state === "dead"', 4, 'died', 'test');
      await boot('&continue=1&choice=stop'); await untilG('g.state === "playing"', 10, 'playing after the load');
      await gameWait(1.0);
      const after = (await ws())?.scares ?? null, saved = await ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), SAVE_KEY);
      ok(Array.isArray(after) && JSON.stringify([...after].sort()) === JSON.stringify([...(saved?.story?.scares ?? before ?? [])].sort()), `scares as saved after the load (${after})`, 'story');
      if (after?.includes('v5_turnstile')) ok(/27/.test(await ev(() => window.__game.level.screen('onpost')?.userData?.screenText ?? '')), 'v5_turnstile snap: ON POST 27 after the load', 'level');
      const al = (await L5()).audio.filter((a) => Object.values(SCARES5).some((s) => s.sounds.includes(a.id)));
      ok(!al.length, `snaps are silent (${al.map((a) => a.id)})`, 'level');
    } else bad('no checkpoint written on the scares route: the snap restore was not tested', 'story');
  }
  // forced fights: a scare's trigger with a hostile awake within 30 m must not fire it (own page each)
  for (const [id, setup] of [['v5_turnstile', async () => { await stand('trig', 't5_turnstile'); }]]) {
    console.log(`\n══════════ SCARES: ${id} during a fight ══════════`);
    if (!await freshRun(`scares fight ${id}`, '&choice=stop')) continue;
    await seg('arrival', [...N.base, ...N.arrival], segArrival);
    if (routeBroken) { await runChecks(`fight ${id}`); continue; }
    const sp = await ev(() => { const g = window.__game, p = g.player.position, S = window.__S5; const r = S.search(p.x, p.z - 6, 0, null, { maxR: 3 }); if (!r) return null; const e = g.enemies.spawn('husk', new (p.constructor)(r[0], r[1], r[2]), 0, 'test_fight'); return !!e; });
    ok(sp, 'a husk awake within 30 m (test group)', 'test');
    await setup();
    await gameWait(4);
    ok(!(await dbg()).scares?.includes(id), `${id} does not fire with a hostile awake within 30 m`, 'story');
    await kill(['test_fight']); await gameWait(2);
    await stand('room', 'gate5'); await setup();
    ok(await untilG(`(d.scares ?? []).includes(${JSON.stringify(id)})`, 8, `${id} after the fight (re-armed on the next entry)`, 'story', { quiet: true }), `${id} fires once it is calm again`, 'story');
  }
} else if (MODE === 'ads') {
  // aimed vs hip at a soldier 20 m away (spine, sub bay); hits / shots over 60 s each; aimed ≥ 2 × hip
  for (const [label, roomId] of [['spine', 'spine5'], ['sub bay', 'sub5']]) {
    console.log(`\n══════════ ADS: ${label} ══════════`);
    if (!await freshRun(`ads ${label}`, '&nostory=1')) continue;
    const need = await missingOf([`room:${roomId}`, 'enemies:debug.soldiers']);
    if (need.length) { bad(`ads ${label}: SKIPPED — needs ${need.map((m) => `${ownerOf(m)}: ${m}`).join(', ')}`, 'level'); continue; }
    const res = {};
    for (const aimed of [false, true]) {
      const setup = await ev(([roomId]) => {
        const g = window.__game, S = window.__S5, r = g.level.rooms.find((x) => x.id === roomId), b = r.bounds;
        const long = (b.max.x - b.min.x) > (b.max.z - b.min.z);
        const a = long ? [b.min.x + 2, (b.min.z + b.max.z) / 2] : [(b.min.x + b.max.x) / 2, b.max.z - 3];
        const p0 = S.search(a[0], a[1], 0, null, { maxR: 2 }); if (!p0) return null;
        const t = long ? [p0[0] + 20, p0[2]] : [p0[0], p0[2] - 20];
        const p1 = S.search(t[0], t[1], 0, null, { maxR: 2.5 }); if (!p1) return null;
        return { me: p0, them: p1 };
      }, [roomId]);
      if (!setup) { bad(`ads ${label}: no two free spots 20 m apart in ${roomId}`, 'test'); break; }
      const r = await ev(async ([s, aimed]) => {
        const g = window.__game, V = g.player.position.constructor;
        g.player.teleport(new V(s.me[0], s.me[1], s.me[2]), 0, 0);
        g.player.debug.switchTo('carbine');
        await new Promise((q) => setTimeout(q, 600));
        let hits = 0, shots = 0, target = null;
        const onHit = (e) => { if (target && e.id === target.id) hits++; };
        g.events.on('enemy:damaged', onHit);
        const t0 = g.time;
        while (g.time - t0 < 60) {
          if (!target || !target.alive) target = g.enemies.spawn('soldier', new V(s.them[0], s.them[1], s.them[2]), Math.PI, 'test_ads');
          g.player.debug.aim(aimed);
          const e = g.player.eye, c = target.position.clone().setY(target.position.y + 1.25);
          g.player.yaw = Math.atan2(-(c.x - e.x), -(c.z - e.z)); g.player.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
          const w = g.player.weapons.carbine;
          if (w.clip === 0 && !w.reloading) g.player.debug.reload();
          if (!w.reloading && w.clip > 0) { g.player.debug.fire(); shots++; }
          await new Promise((q) => setTimeout(q, 140));
        }
        g.player.debug.aim(false);
        for (const x of g.enemies.all) if (x.group === 'test_ads' && x.alive) for (let k = 0; k < 10 && x.alive; k++) g.enemies.damage({ enemy: x, point: x.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1));
        return { hits, shots };
      }, [setup, aimed], 120000).catch((e) => ({ err: e.message }));
      res[aimed ? 'aimed' : 'hip'] = r;
      console.log(`  ${aimed ? 'aimed' : 'hip'}: ${JSON.stringify(r)}`);
    }
    const rate = (x) => (x?.shots ? x.hits / x.shots : 0);
    if (res.aimed && res.hip) ok(rate(res.aimed) >= 2 * rate(res.hip) && res.aimed.shots > 20, `${label}: aimed hit rate ${f2(rate(res.aimed))} ≥ 2 × hip ${f2(rate(res.hip))}`, 'enemies');
  }
}

await ctxB?.close().catch(() => {});
await browser.close();
clearTimeout(watchdog);
finish();
