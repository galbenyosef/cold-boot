// ═══════════════════════════════════════════════════════════════════════ HOOK CONTRACT (stage 3d §10.0 — ST implements)
// Written FIRST (§11 rule 5): this script is built to this table, never to ST's code; ST implements exactly it. Neither
// side renames or adds a hook without editing docs/plans/stage-3d.md §10.0 first.
// On `window.__game.story` (level 6) — 3c's contract shape plus the additions marked +. (K) = in K's stub today.
//  H1  end()                     jump to `l6_end` (carry written, cards, stored level 6). (K)
//  H2  checkpoint(id)            load / write a `cp6_*` now → true. (K: writes)
//  H3  fire(name) → truthy|null  'tube' 'latch' 'crossing' 'f1' 'f2' 'f3' 'release_f3' 'handset' 'answer' 'queue'
//                                'manual' (completes the crank) 'f4' 'bj' (opens the enclosure) 'pull' (completes) 'f5'
//                                'thud' 'shaft' (uses Key B) 'shaft_lights' 'reveal' 'hostile' 'pin' 'pump' (completes)
//                                'fire' (the shear) 'ram_e' 'ram_w' 'pod' (kills it) 'quiet' 'console', any vignette id,
//                                '<id>:snap'. null = refused / unknown. (K: always null)
//  H4  hurry(fast?)              shortens `wait`s, never `hold`s or line gaps. (K)
//  H5  lineLog: { id, t, said, q, dur, end, cue }[]   per line; every TIMED line has `cue`, |t − cue| ≤ 0.12. (K: [])
//  H6  rules: Record<lineId, { when, else?, once? }>   one entry per l6_ id of voice/lines.l6.json (+ the reused
//                                l5_sol_ barks, §6.2). (K: {})
//  H7  debugState (getter): 3c's fields  level (6), now, beats[], t{}, phase, phaseApplied, flags{}, checkpoints[],
//        checkpoint, restoredFrom, calm, heard[], missingMarkers[], loadout, arrival { from, armor }, ended, scares[],
//        scareLog: { id, t, room }[], groups: Record<id, { spawned, alive, awake, holding, triggered }>,
//        spawnLog: { group, id, t, pos, visible }[], strays: { id, t }[], radio
//      + keys: string[]
//      + grip: { id, progress, holding } | null
//      + frame: { pin: boolean, pressure: 0 … 1, fired: boolean }
//      + boss: { stage, mode, parts, floods: boolean[], slots: (string | null)[], waves: { w1, w2, w3 },
//               milestones: string[], hostileAt: number | null } | null
//      + launchAt: number | null
//      + ending: { pending, started, times, result }
//  H8  beats `l6_*` on `story:beat` (and in debugState.beats); facts on `__game.facts`.
//  H9  `story:objective` / `story:toast` texts exactly as §6.4.
//  H10 keypad(code) → false (3c's keypad hook: absent in 3d).
//  H11 radioAsk()                = pressing Q.
//  H12 soldiers()                = enemies.debug.soldiers() rows (3c).
//  H13 worldState(): { doors: Record<id, { open, locked, status }>, keys, hatches: { vault, he },
//        lights: Record<group, boolean>, dark: string[], screens: Record<id, string>, pickups: string[], groups, scares,
//        flags, torch, boss: BossState | null, slots: (string | null)[], frame, waves }   (--checkpoints compares it)
//  H14 audioLog(): { id, t, pos }[]   (audio.debug.log)
//  + H15 boss()                  enemies.debug.loader() (or null) incl. parts: Record<id, { hp, pos: [x,y,z], mult }>
//                                (flood_1 … flood_4, ram_e, ram_w, pod) — what --boss aims player.debug.aimLock at.
//  + H16 grip(id, mode)          drives the RUNNING grip of interactable `id`: 'done' completes it, 'abandon' cancels,
//                                a number = holds E for that many seconds (real progress). Falsy = no such grip.
//  + H17 wade()                  { depth: player.wading, cap, canCrouch, canJump, canSprint, rescued: number }
//  + H18 hitRate(k)              = player.debug.hitRate(k): the fraction k of the player's shots hits the aim-lock.
//  + H19 lockers()               { e, w, n: { armed: boolean } } — the dock ammo lockers (B5).
//      next() → nextOf(6). (K)
// How this script READS the table where §10.0 leaves the detail open (ST: implement it this way):
//  · H7.t = the FIRST script time (debugState.now clock) of every beat id, of `phase:<id>` each phase / variant applied
//    (A T U B B_hold K K_stores), and of `vignette:<id>` each vignette the story fires (as levels 4 / 5).
//  · H7.groups[g]: spawned (bool), alive / awake / holding (counts), triggered (bool). Every §5.1 group is listed from
//    load (spawned false until it is), the twins g6_w1_r / g6_w2_r / g6_w3_r included.
//  · H7.grip.id = the interactable id the grip serves (he6_switch, vault6_loom, frame6_pin, frame6_pump, frame6_lever).
//  · H7.boss.parts = Record<part, hp> (H15 carries pos / mult); waves.wN = 'pending' | 'alive' | 'dead' | null
//    (+ `latest` as ProgressL6.waves); milestones = the done ones in order, ids 'pin' 'pressure' 'cut' 'ram_e' 'ram_w'
//    'pod'; hostileAt on the script clock.
//  · H7.ending.times = Record<cue, s since the camera was taken> for S1 S2 K1 SU1 SU2 R1 K2 E2 K3 O1 K4 C1 B END (§4.9);
//    result = null | 'played' | 'skipped'. launchAt on the script clock (CLOCK6: hour = arrival hour + launchAt / 3600).
//  · H13.lights[group] = any light of the group lit; hatches.vault / .he = lid open; screens = text as shown;
//    pickups = taken p6_ ids; torch = the cell 0 … 1; waves as H7.boss.waves.
// NEW — needed by the tests, NOT in §10.0 yet: none. (Read from the engine: `__game.__triggers` (level/triggers.ts) for
//  the t6_ boxes; `enemies.debug.loader()` row fields lastAttack / ring / outline / grab / mode (W3b, as built) for the
//  --boss telegraph log; audio ids of §8.12 (ping_far / ping_near, shear_fire, splash_big, winch_brake) in H14.)
// ═══════════════════════════════════════════════════════════════════════
//
// Scripted end-to-end run of level 6 "THE TRUNK" (stage 3d, docs/plans/stage-3d.md §10.1). Task T.
//
//   node scripts/playthrough-l6.mjs [baseUrl] [mode] [--choice=stop,command] [--frames] [--max-min=N]
//   modes (one per run; default when none):
//     --contract      every hook / field / shape of the table above and every plan id (rooms, doors, triggers, markers
//                     inside rooms, interactables, pickups, screens, groups, regions, cover, light groups, vignettes +
//                     snaps, water / dock / killY, enemy + player + audio members, voices) — the list of what is missing
//                     grouped by OWNER (ST-a, ST-b, W4a, W4b, W3b, W1, W2b, W7, D1 …). Never plays. LEVEL6 CONTRACT OK.
//     (default)       §10.1 default, once per choice: every beat in order, doors per phase (§3), the tube at 3.0 s and
//                     the latch, the crossing seen ≥ 40 m away ≥ 2 s, F1 released, F3 walks out and holds then released,
//                     the handset answered (stop) / ignored (command), the crank by a real 3.0 s hold → Key A, the lock →
//                     the loom, the pull 3.0 s → Key B, screens flip, the ping 20 → 4 s, F5, v6_thud / launchAt, Key B →
//                     K, the lamps die, F6, cp6_shaft, the reveal + cue('lower'), the hostile start in reveal + 10 … 18 s,
//                     W1 / W2 / W3 at their steps, pin, pump (6.0 s over two holds), lever, the shear's timings (± 0.1 s),
//                     the loader killed by debug part damage (ram_e, ram_w, pod), the quiet, the console, E1 / E2 on the
//                     shot table (lines ≤ 0.12 s from cue, each beat ≤ 25 s), the OSD's launchAt, the cards, the carry,
//                     stored level 6, the menu. LEVEL6 OK.
//     --checkpoints [--cp=cp6_he] [--case=route,d,e,f,twice,dead,b4,b5,pump]  per cp6_* up to cp6_quiet: play to it,
//                     die, load, compare H13 + phase + armour + weapons + keys + facts, finish; the boss cases (orders
//                     d, e, f with every wave state), twice at one milestone, the loader dead before the cut, B4, B5,
//                     a milestone during the pump (S2d). LEVEL6 CHECKPOINTS OK.
//     --impatient     wrong order (enclosure before the crank, stair door before the pull, pump before the pin, lever
//                     before pressure, console before the end), shoots the handset, tent, boards, containers, tether,
//                     console glass, the well, the windows; kills F3 from 60 m; strict oracle; choice variants.
//     --order [--variant=a,…,f]   §10.1 (a)–(f).                                       LEVEL6 ORDER OK.
//     --softlock [--case=a,…,j]   §10.1 (a)–(j); each reaches l6_end.                   LEVEL6 SOFTLOCK OK.
//     --scares        each v6_* once on a calm route, calm, spacing (exempt ring / shaft_lights / well_eyes), the shaft
//                     beat on the default route, v6_thud only in pull + 20 … + 90 s before Key B, none in the boss but
//                     v6_well_eyes, snapped on restore, their sounds once (H14). LEVEL6 SCARES OK.
//     --boss [--seeds=1,2,3]   the boss combat bot (real movement, aim-lock on H15 parts, real hitscan / ammo / ADS):
//                     dodges every telegraph, shoots rams in windows, floods when flood-lit, the pod once open, uses the
//                     frame between waves; asserts telegraph times ≥ §5.6.4, no damage from a dodged telegraphed
//                     attack, kill ≤ 6 min, wave cap ≤ 6, flood-lit sight, stage order, the death in the well; the cage
//                     and the gallery bots deal 0 to rams / pod in 120 s (S3). Seeds × both choices. LEVEL6 BOSS OK.
//     --dry           the boss from 0 reserve + 10 in the clip at a forced 50 % hit rate (H18), only the arena's pickups,
//                     lockers and drops: kills the parts and W1–W3 with ≥ 30 % of the rounds left. LEVEL6 DRY OK.
//     --ads           soldiers 25–40 m away in tun6_a: aimed hit rate ≥ 2 × hip over 60 s each. LEVEL6 ADS OK.
//     --frames        (with any mode) 10 fps sequences of §10.5 → shots/l6/frames/.
//     --probe[=N]     dev aid: stand in every trigger / beside every interactable of level N (default 6, nostory).
//   all modes: spawn visibility (watcher + H7.spawnLog), every mk6_ marker inside a room, never `cutscene` outside E1/E2,
//   no enemy before its beat (only g6_tunb_k dormant from load; g6_loader absent until Key B turns — D31), every timed
//   line ≤ 0.12 s from its cue, the static pass (lines.l6.json ↔ RULES ↔ manifest, choice pairs, unit lines without
//   uppercase, soldier lines `label` + `throat`, kessler / sunde `radio`, aas `phone`, "Aas" never spoken).
//
// HOW IT IS BUILT (3b / 3c lessons): positions come from the PAGE (markers, `__game.__triggers`, room boxes and floors,
// interactables, doors, Level.water / Level.dock) — never from coordinates written here; every stand point is searched
// free of colliders inside a room interior (0.3 m inset). Every wait is on GAME time / story state with a timeout that
// names what was awaited. Every segment declares its needs and is SKIPPED (a named failure with the owner) when any is
// absent — the run never hangs on a missing hook. Every failure names the side to suspect: [story] [level] [enemies]
// [player] [audio] [ui] [voices] [test]. A global watchdog (--max-min) ends a stuck run with the summary.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { launch } from './lib/check-common.mjs';

const argv = process.argv.slice(2);
const base = (argv.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const flagv = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const MODES = ['contract', 'checkpoints', 'impatient', 'order', 'softlock', 'scares', 'boss', 'dry', 'ads'];
const MODE = argv.some((a) => a === '--probe' || a.startsWith('--probe=')) ? 'probe' : MODES.find((m) => argv.includes(`--${m}`)) ?? 'default';
const PROBE_LEVEL = Number(flagv('probe') ?? 6);
const CHOICES = flagv('choice')?.split(',') ?? ['stop', 'command'];
const ONLY_CP = flagv('cp');
const VARIANTS = flagv('variant')?.split(',') ?? ['a', 'b', 'c', 'd', 'e', 'f'];
const CASE_LIST = flagv('case')?.split(',') ?? null;
const SEEDS = (flagv('seeds') ?? '1,2,3').split(',').map(Number);
const FRAMES = argv.includes('--frames');
const MAX_MIN = Number(flagv('max-min') ?? { probe: 10, contract: 4, default: 40, checkpoints: 150, impatient: 40, order: 120, softlock: 160, scares: 70, boss: 120, dry: 30, ads: 15 }[MODE]);
const SAVE_KEY = 'coldboot.save.l6.v2', CARRY_KEY = 'coldboot.carry.v2', LEVEL_KEY = 'coldboot.level';
mkdirSync('shots/l6', { recursive: true });
if (FRAMES) mkdirSync('shots/l6/frames', { recursive: true });

// ───────────────────────────────────────────────────────────── the plan's ids (never positions)
const CPS = ['cp6_start', 'cp6_tunnel', 'cp6_rep', 'cp6_he', 'cp6_manual', 'cp6_pulled', 'cp6_shaft', 'cp6_m1', 'cp6_m2', 'cp6_m3', 'cp6_m4', 'cp6_m5', 'cp6_quiet'];
const ROOMS6 = ['lock6', 'tun6_a', 'rep6', 'tun6_b', 'bay6', 'he6', 'vault6', 'hold6', 'shaft6', 'pool6', 'stores6', 'feed6'];
const DOORS6 = ['d6_tube', 'd6_bay', 'd6_he', 'd6_vault', 'd6_hold', 'd6_shaft', 'd6_pool', 'd6_stores'];
const TRIGS6 = ['t6_lock', 't6_tube', 't6_tun_mid', 't6_tun_end', 't6_rep', 't6_rep_in', 't6_tunb', 't6_tunb_dark', 't6_tunb_sentry', 't6_bay', 't6_he', 't6_phone', 't6_vault', 't6_trench', 't6_hatch_v', 't6_shaft', 't6_shaft_l1', 't6_shaft_bot', 't6_reveal', 't6_floor', 't6_cage', 't6_wet', 't6_windows', 't6_console'];
/** §8.11. STAND markers (feet of a body / the player) lie inside a room interior (0.3 m inset); the rest inside a room. */
const MARKERS_STAND = ['mk6_start', 'mk6_cross_0', 'mk6_cross_1', 'mk6_tun_s1', 'mk6_tun_s2', 'mk6_tun_u1', 'mk6_tun_u2', 'mk6_rep_s', 'mk6_bay_u1', 'mk6_bay_u2', 'mk6_he_s', 'mk6_tunb_hold', 'mk6_hold_1', 'mk6_hold_2', 'mk6_hold_3', 'mk6_shaft_u', 'mk6_reveal', 'mk6_boss_safe', 'mk6_boss_safe_w', 'mk6_w1_a', 'mk6_w1_b', 'mk6_w3_a', 'mk6_w3_b', 'mk6_w3_u', 'mk6_end_stand'];
const MARKERS_WALL = ['mk6_tube_panel', 'mk6_vent_rep', 'mk6_sentry', 'mk6_switch', 'mk6_queue', 'mk6_handset', 'mk6_phone', 'mk6_bj', 'mk6_loom', 'mk6_shaft_lock', 'mk6_grille_1', 'mk6_grille_2', 'mk6_grille_3', 'mk6_vent_vault', 'mk6_exit_vault', 'mk6_exit_he', 'mk6_drum', 'mk6_ll0', 'mk6_ll1', 'mk6_ll2', 'mk6_ll3', 'mk6_llb', 'mk6_lw_exit', 'mk6_le_exit', 'mk6_ladder_w', 'mk6_ladder_e', 'mk6_cage', 'mk6_pin', 'mk6_pump', 'mk6_lever', 'mk6_sheave', 'mk6_horn', 'mk6_console', 'mk6_end_cam0', 'mk6_end_cam1', 'mk6_end_screen', 'mk6_feed_cam', 'mk6_windows'];
const READABLES6 = ['note6_jobcard', 'note6_queue', 'note6_jointer', 'note6_transfer'];
const OBJECTIVES6 = ['he6_switch', 'vault6_lock', 'vault6_loom', 'shaft6_lock', 'frame6_pin', 'frame6_pump', 'frame6_lever', 'he6_phone', 'console6', 'hatch6_vault', 'hatch6_he'];
const LOCKERS6 = ['locker6_e', 'locker6_w', 'locker6_n'];
const USES6 = [...OBJECTIVES6, ...LOCKERS6, ...READABLES6];
const FRAME_USES = ['frame6_pin', 'frame6_pump', 'frame6_lever'];
const PICKUPS6 = ['p6_lock_ammo', 'p6_tun_med', 'p6_tun_ammo', 'p6_tun_plate', 'p6_rep_ammo_1', 'p6_rep_ammo_2', 'p6_rep_med', 'p6_rep_shells', 'p6_bay_plate', 'p6_bay_ammo', 'p6_tunb_ammo', 'p6_tunb_med', 'p6_he_vest', 'p6_he_ammo_1', 'p6_he_ammo_2', 'p6_he_med', 'p6_he_shells', 'p6_he_pistol', 'p6_vault_ammo', 'p6_vault_med', 'p6_vault_plate', 'p6_trench_plate_1', 'p6_trench_plate_2', 'p6_trench_ammo_1', 'p6_trench_ammo_2', 'p6_trench_med', 'p6_shaft_ammo', 'p6_shaft_med', 'p6_ge_med', 'p6_gw_plate', 'p6_mid_ammo', 'p6_mid_med', 'p6_mid_plate', 'p6_uc_ammo_1', 'p6_uc_ammo_2', 'p6_uc_med', 'p6_uc_plate', 'p6_ww_ammo', 'p6_ww_med', 'p6_cage_ammo', 'p6_cage_plate'];
const ARENA_PICKUPS = PICKUPS6.filter((p) => /^p6_(ge|gw|mid|uc|ww|cage)_/.test(p));
const SCREENS6 = ['tube_panel6', 'mimic6', 'queue6', 'switch6', 'bj6', 'shaft6_panel', 'dock_board', 'gauge6', 'console6', 'feed6_board'];
/** §5.1: group → members (twins included). */
const GROUPS6 = { g6_tun_s: 2, g6_tun_u: 2, g6_rep_s: 1, g6_rep_u: 2, g6_rep_k: 2, g6_tunb_s: 1, g6_tunb_k: 1, g6_he: 3, g6_vault: 3, g6_vault_k: 3, g6_shaft: 1, g6_loader: 1, g6_w1: 2, g6_w1_r: 2, g6_w2: 4, g6_w2_r: 4, g6_w3: 3, g6_w3_r: 3 };
const DORMANT6 = ['g6_tunb_k'];
/** R4: what must have happened before a group is alive: beat:<id> | flag:<name> | trig:<id> | vig:<id> | restore. */
const NEED6 = {
  g6_tun_s: 'beat:l6_crossing', g6_tun_u: 'beat:l6_crossing', g6_rep_s: 'beat:l6_rep', g6_rep_u: 'beat:l6_rep', g6_rep_k: 'beat:l6_rep',
  g6_tunb_s: 'trig:t6_tunb_dark', g6_he: 'flag:manual', g6_vault: 'flag:pulled', g6_vault_k: 'flag:pulled', g6_shaft: 'vig:v6_shaft_lights',
  g6_loader: 'flag:shaftOpen', g6_w1: 'flag:hostile', g6_w2: 'flag:pin', g6_w3: 'flag:pressure', g6_w1_r: 'restore', g6_w2_r: 'restore', g6_w3_r: 'restore',
};
/** Spawn visibility: what may have opened in front of a group in the last 3 s (doors | vignette-id patterns). */
const OPENING6 = { g6_rep_u: { doors: ['d6_bay'] }, g6_rep_k: { vig: ['vent6_rep'] }, g6_tunb_s: { doors: ['d6_he'] }, g6_he: { doors: ['d6_hold'] }, g6_vault: { doors: ['d6_hold'] }, g6_vault_k: { vig: ['grille', 'vent6_vault'] }, g6_w1: { doors: ['d6_stores'] }, g6_w1_r: { doors: ['d6_stores'] }, g6_w3: { doors: ['d6_pool', 'd6_stores'] }, g6_w3_r: { doors: ['d6_pool', 'd6_stores'] } };
/** §5.7 scares: room, loud, level-owned sounds (the one-owner audit), exempt from spacing. */
const SCARES6 = {
  v6_crossing: { room: 'tun6_a', loud: false, sounds: [] },
  v6_tent: { room: 'rep6', loud: false, sounds: ['tarp_flap', 'lamp_creak'] },
  v6_handset: { room: 'he6', loud: false, sounds: ['phone_howler', 'phone_dead_click', 'line_hiss'] },
  v6_drum: { room: 'vault6', loud: true, sounds: ['ratchet_run', 'drum_rumble', 'drum_brake'] },
  v6_ring: { room: 'vault6', loud: true, sounds: ['ping_close', 'hull_ring', 'dust_sift'], exempt: true },
  v6_thud: { room: ['vault6', 'he6'], loud: true, sounds: ['far_lock_flood', 'lights_dip'] },
  v6_shaft_lights: { room: 'shaft6', loud: true, sounds: ['bulb_pop', 'glass_tinkle'], exempt: true },
  v6_well_eyes: { room: 'pool6', loud: false, sounds: [], exempt: true, boss: true },
  v6_window: { room: 'pool6', loud: false, sounds: ['sea_groan'] },
};
/** Level vignettes by dressing owner; `snap` = a `:snap` is required (§5.7, §7). */
const VIGNETTES6 = {
  D1: [['v6_tent', true], ['tun6_far_out', true], ['vent6_rep', true]],
  D2: [['v6_handset', true], ['v6_drum', true], ['v6_ring', false], ['v6_thud', false], ['bj6_open', true], ['bj6_strain', false], ['bj6_rip', true], ['vent6_vault', true]],
  D3a: [['lights_out6', true]],
  D3b: [['v6_shaft_lights', true], ['v6_well_eyes', true], ['v6_window', false], ['loader_dead6', true]],
};
const REGIONS6 = ['trench', 'cage', 'undercroft', 'wet', 'dock', 'mid', 'gallery', 'deep', 'enclosure', 'outside', 'voids', 'feed6', 'dark'];
const LIGHT_GROUPS6 = ['lock6', 'tun6_a', 'rep6', 'tun6_b', 'bay6', 'he6', 'vault6', 'trench6', 'shaft6', 'shaft6_emerg', 'pool6', 'stores6', 'feed6'];
const COVER_SETS6 = ['tunnel', 'rep', 'tunb', 'he', 'vault', 'gal_n', 'gal_w', 'gal_e', 'mid', 'uc', 'dock'];
const FIRE6 = ['tube', 'latch', 'crossing', 'f1', 'f2', 'f3', 'release_f3', 'handset', 'answer', 'queue', 'manual', 'f4', 'bj', 'pull', 'f5', 'thud', 'shaft', 'shaft_lights', 'reveal', 'hostile', 'pin', 'pump', 'fire', 'ram_e', 'ram_w', 'pod', 'quiet', 'console'];
const BEATS6 = ['l6_start', 'l6_crossing', 'l6_rep', 'l6_manual', 'l6_pulled', 'l6_shaft_open', 'l6_reveal', 'l6_loader', 'l6_cut', 'l6_quiet', 'l6_end'];
const HOOKS_A = ['end', 'checkpoint', 'fire', 'hurry', 'lineLog', 'rules', 'keypad', 'radioAsk', 'soldiers', 'worldState', 'audioLog', 'next', 'grip', 'wade'];
const HOOKS_B = ['boss', 'hitRate', 'lockers'];
const DS_FIELDS = {
  level: 'number', now: 'number', beats: 'array', t: 'object', phase: 'any', phaseApplied: 'any', flags: 'object', checkpoints: 'array',
  checkpoint: 'any', restoredFrom: 'any', calm: 'boolean', heard: 'array', missingMarkers: 'array', loadout: 'any', arrival: 'object',
  ended: 'boolean', scares: 'array', scareLog: 'array', groups: 'object', spawnLog: 'array', strays: 'array', radio: 'any',
  keys: 'array', grip: 'any', frame: 'object', boss: 'any', launchAt: 'any', ending: 'object',
};
const DS_B = ['frame', 'boss', 'ending'];
const DS_SUB = { arrival: ['from', 'armor'], frame: ['pin', 'pressure', 'fired'], ending: ['pending', 'started', 'times', 'result'] };
const BOSS_SUB = ['stage', 'mode', 'parts', 'floods', 'slots', 'waves', 'milestones', 'hostileAt'];
const WS_FIELDS = ['doors', 'keys', 'hatches', 'lights', 'dark', 'screens', 'pickups', 'groups', 'scares', 'flags', 'torch', 'boss', 'slots', 'frame', 'waves'];
const SOLDIER_FIELDS = ['id', 'group', 'pos', 'state', 'aware', 'holding', 'token', 'light', 'cover', 'hp', 'suppression', 'shots', 'hits', 'bursts'];
const PARTS = ['flood_1', 'flood_2', 'flood_3', 'flood_4', 'ram_e', 'ram_w', 'pod'];
/** §6.2 (frozen with the plan): 102 l6_ lines. */
const PAIRS6 = ['l6_choir_start', 'l6_choir_dark', 'l6_choir_he', 'l6_choir_queue', 'l6_choir_manual', 'l6_choir_pull', 'l6_choir_pool', 'l6_choir_pin', 'l6_choir_pump', 'l6_choir_loader', 'l6_choir_last', 'l6_sol_frame', 'l6_sol_reach', 'l6_sol_lost'];
const PLAN_LINES = [
  'l6_kes_start', 'l6_unit_tube', 'l6_kes_start_2', 'l6_kes_contact_a', 'l6_kes_tun_done', 'l6_kes_rep', 'l6_kes_contact_rep', 'l6_kes_tunb', 'l6_kes_tunb_soldier',
  'l6_kes_he_1', 'l6_kes_he_2', 'l6_kes_he_2b', 'l6_reyes_he', 'l6_kes_he_3', 'l6_aas_1', 'l6_aas_2', 'l6_reyes_aas', 'l6_aas_3', 'l6_kes_aas', 'l6_reyes_queue', 'l6_kes_queue',
  'l6_unit_manual', 'l6_kes_manual', 'l6_kes_he_contact', 'l6_kes_he_contact_b', 'l6_kes_vault', 'l6_unit_deny_a', 'l6_kes_bj', 'l6_unit_pull', 'l6_kes_pull_1', 'l6_kes_pull_2',
  'l6_kes_thud', 'l6_unit_deny_b', 'l6_unit_shaft', 'l6_kes_shaft', 'l6_kes_pool_1', 'l6_kes_pool_2', 'l6_kes_pool_2b', 'l6_unit_loader_1', 'l6_unit_loader_2', 'l6_unit_loader_3',
  'l6_kes_boss_1', 'l6_kes_boss_ram', 'l6_kes_boss_flood', 'l6_kes_boss_frame', 'l6_kes_pin', 'l6_kes_pump_half', 'l6_kes_pump_done', 'l6_unit_shear_pin', 'l6_unit_shear_low',
  'l6_kes_boss_pod', 'l6_kes_loader_dead', 'l6_kes_dark', 'l6_kes_cut_loader', 'l6_kes_console', 'l6_kes_console_2',
  'l6_kes_end_1', 'l6_kes_end_1b', 'l6_sunde_end_1', 'l6_sunde_end_2', 'l6_reyes_end', 'l6_kes_end_2', 'l6_kes_end_3', 'l6_kes_end_4', 'l6_kes_end_4b',
  'l6_kes_ack', 'l6_kes_busy', 'l6_kes_hint_he', 'l6_kes_hint_switch', 'l6_kes_hint_bj', 'l6_kes_hint_shaft', 'l6_kes_hint_frame', 'l6_kes_hint_loader', 'l6_kes_hint_console',
  ...PAIRS6.flatMap((p) => [`${p}_stop`, `${p}_command`]),
];
const REUSED_BARKS = ['down', 'need', 'felt', 'rounds', 'light'].flatMap((k) => [`l5_sol_${k}_stop`, `l5_sol_${k}_command`]);
const SCENE_LINES = ['l6_kes_end_1', 'l6_kes_end_1b', 'l6_sunde_end_1', 'l6_sunde_end_2', 'l6_reyes_end', 'l6_kes_end_2', 'l6_kes_end_3', 'l6_kes_end_4', 'l6_kes_end_4b', 'l6_choir_last_stop', 'l6_choir_last_command'];
const LINES_FILE = 'voice/lines.l6.json';
const LINES_JSON = existsSync(LINES_FILE) ? JSON.parse(readFileSync(LINES_FILE, 'utf8')) : null;
const MANIFEST = JSON.parse(readFileSync('voice/manifest.json', 'utf8')).lines ?? {};
/** §3 doors per phase: L locked (incl. cycling), A auto, O open (held or auto-open), * not judged. */
const PH = {};
PH.A = { d6_tube: '*', d6_bay: 'L', d6_he: 'A', d6_vault: 'A', d6_hold: 'L', d6_shaft: 'L', d6_pool: 'A', d6_stores: 'L' };
PH.T = { ...PH.A, d6_tube: 'O' };
PH.U = { ...PH.T, d6_tube: 'L' };
PH.B = { ...PH.U, d6_bay: 'A' };
PH.K = { ...PH.B, d6_hold: 'L', d6_shaft: 'A' };
const PH_VARIANT = { B_hold: ['d6_hold', 'O'], K_stores: ['d6_stores', 'O'] };
const PH_STATUS = { A: { d6_tube: 'cycling' } };
/** §6.4 objectives. */
const OBJ = {
  start: 'The head-end — 200 m', switch: 'The changeover switch — east wall', bj: 'The beach joint — vault, south wall', stair: 'The stair door — vault, west wall',
  pool: 'The moon pool — down the stairs', cut: 'Cut the tether — the frame over the well', loader: 'Destroy the loader', console: 'The dock console — mid deck',
};
/** Unconditional lines (no oracle needed beyond the choice). */
const UNCOND = ['l6_kes_start', 'l6_kes_he_3', 'l6_aas_1', 'l6_aas_2', 'l6_reyes_aas', 'l6_aas_3', 'l6_kes_pull_1', 'l6_kes_dark', 'l6_sunde_end_1', 'l6_sunde_end_2', 'l6_reyes_end', 'l6_kes_end_2', 'l6_kes_end_3', 'l6_kes_ack', 'l6_unit_loader_2', 'l6_unit_loader_3'];

// ───────────────────────────────────────────────────────────── report
const problems = [], notes = [];
const bad = (m, suspect = 'test') => { const s = `[${suspect}] ${m}`; problems.push(s); console.log('  !! ' + s); return false; };
const ok = (cond, m, suspect = 'story') => { if (!cond) return bad(m, suspect); console.log('  ok ' + m); return true; };
const note = (m) => { notes.push(m); console.log('  .. ' + m); };
const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));
function finish(code) {
  const okLine = { probe: 'PROBE OK', contract: 'LEVEL6 CONTRACT OK', default: 'LEVEL6 OK', checkpoints: 'LEVEL6 CHECKPOINTS OK', impatient: 'LEVEL6 IMPATIENT OK', order: 'LEVEL6 ORDER OK', softlock: 'LEVEL6 SOFTLOCK OK', scares: 'LEVEL6 SCARES OK', boss: 'LEVEL6 BOSS OK', dry: 'LEVEL6 DRY OK', ads: 'LEVEL6 ADS OK' }[MODE];
  if (notes.length) console.log(`\nNOTES (${notes.length}):\n - ${notes.join('\n - ')}`);
  if (problems.length) {
    const by = {};
    for (const p of problems) (by[/^\[([\w-]+)\]/.exec(p)?.[1] ?? 'test'] ??= []).push(p);
    console.log(`\nFAILED (${problems.length}) — by the side to suspect: ${Object.entries(by).map(([k, v]) => `${k} ${v.length}`).join(', ')}\n - ${problems.join('\n - ')}`);
  } else console.log(`\n${okLine}`);
  process.exit(code ?? (problems.length ? 1 : 0));
}
const watchdog = setTimeout(() => { bad(`WATCHDOG: the ${MODE} run exceeded ${MAX_MIN} min — stopped (the last line above is where it hung)`, 'test'); finish(1); }, MAX_MIN * 60000);
watchdog.unref?.();

// ───────────────────────────────────────────────────────────── in-page watcher + helper library
const INIT = ([C]) => {
  let game;
  const L = window.__L6 = {
    beats: [], beatAt: {}, toasts: [], objectives: [], denied: {}, opened: {}, closing: {}, uses: {}, pickups: [], died: [], spawns: [],
    early: [], cutBad: [], phases: [], phaseAt: {}, doorsAt: {}, lines: [], viol: [], noOracle: [], softLocks: [], cpAt: {}, cpState: {},
    hits: [], fired: [], audio: [], flags: {}, scares: [], dmg: [], states: [], trigAt: {}, keysAt: {}, mile: [], stages: [], parts: [],
    cross: { seen: 0, minDist: null }, maxHostiles: 0, gripLog: [], rescued: [],
  };
  const S = window.__S6 = {};
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
    g.events.on('weapon:fired', (e) => L.fired.push({ t: T(), w: e.weapon }));
    g.events.on('bullet:impact', (e) => L.hits.push({ t: T(), p: [e.point.x, e.point.y, e.point.z], s: e.surface }));
    g.events.on('door:denied', (e) => { L.denied[e.id] = stamp(); });
    g.events.on('door:opening', (e) => { (L.opened[e.id] ??= []).push(stamp()); });
    g.events.on('door:closing', (e) => { (L.closing[e.id] ??= []).push(stamp()); });
    g.events.on('interact', (e) => { L.uses[e.id] = stamp(); });
    g.events.on('pickup', (e) => L.pickups.push({ ...stamp(), kind: e.kind, amount: e.amount, id: e.id ?? null }));
    g.events.on('enemy:died', (e) => L.died.push({ ...stamp(), id: e.id, group: e.group, type: e.type, pos: e.position ? [e.position.x, e.position.y, e.position.z] : null }));
    g.events.on('enemy:part-destroyed', (e) => L.parts.push({ ...stamp(), type: e.type, part: e.part }));
    g.events.on('boss:stage', (e) => L.stages.push({ ...stamp(), group: e.group, stage: e.stage }));
    g.events.on('player:damaged', (e) => L.dmg.push({ t: T(), amount: e.amount, from: e.from ? [e.from.x, e.from.y, e.from.z] : null, pos: g.player.position.toArray() }));
    g.events.on('player:rescued', (e) => L.rescued.push({ ...stamp(), from: e.from?.toArray?.(), to: e.to?.toArray?.() }));
    g.events.on('game:state', (e) => L.states.push({ ...stamp(), state: e.state, phase: ds()?.phaseApplied ?? null }));
    // spawn visibility: a new member seen from the eye (frustum + clear ray to its chest) is a pop-in unless its door /
    // vent / grille opened in the last 3 s (doors on game time, vignettes on the script clock)
    g.events.on('enemy:spawned', (ev) => setTimeout(() => {
      const e = g.enemies?.all?.find((x) => x.id === ev.id); if (!e || !g.player || !g.camera) return;
      if (C.DORMANT6.includes(e.group) || /^test/.test(e.group) || e.type === 'loader') return;
      const cam = g.camera; cam.updateMatrixWorld();
      const chest = e.position.clone(); chest.y += e.type === 'skitter' ? 0.3 : 1.3;
      const v = chest.clone().project(cam);
      const seen = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && g.physics.lineOfSight(g.player.eye, chest);
      const op = C.OPENING6[e.group] ?? {}; const d = ds();
      const opened = (op.doors ?? []).some((id) => (L.opened[id] ?? []).some((o) => T() - o.g <= 3))
        || (op.vig ?? []).some((pat) => d && Object.entries(d.t ?? {}).some(([k, t]) => k.startsWith('vignette:') && k.includes(pat) && d.now - t <= 3));
      L.spawns.push({ group: e.group, id: e.id, type: e.type, t: +T().toFixed(2), s: now(), seen, opened, pos: [e.position.x, e.position.y, e.position.z].map((n) => +n.toFixed(2)), room: g.level.roomAt(e.position)?.id ?? null });
    }, 0));
    const P = () => g.player.position;
    const room = () => g.level.roomAt(P())?.id ?? null;
    const inTrig = (id) => { const t = (g.__triggers ?? []).find((x) => x.id === id); const p = P(); return !!t && p.x >= t.x0 && p.x <= t.x1 && p.z >= t.z0 && p.z <= t.z1 && p.y > (t.y0 ?? -1) && p.y < (t.y1 ?? 4); };
    const awake = (e) => e.alive && e.state !== 'dormant' && e.state !== 'dead' && !(ds()?.groups?.[e.group]?.holding > 0 && e.state === 'idle');
    const hostiles = (r) => (g.enemies?.all ?? []).some((e) => awake(e) && e.type !== 'loader' && e.position.distanceTo(P()) <= r);
    const mk = (n) => { const o = g.level.object(n); return o ? o.getWorldPosition(o.position.clone()) : null; };
    const los = (a, b) => g.physics.lineOfSight(a, b);
    S.inTrig = inTrig;
    S.awake = () => (g.enemies?.all ?? []).filter((e) => awake(e) && e.type !== 'loader').map((e) => e.group);
    S.view = (p, deg = 50) => { const eye = g.player.eye, f = g.player.forward, dd = new (V())(p[0], p[1], p[2]).sub(eye), l = dd.length() || 1; return Math.acos(Math.max(-1, Math.min(1, dd.dot(f) / l))) * 180 / Math.PI <= deg && los(eye, new (V())(p[0], p[1], p[2])); };
    setInterval(() => {
      if (!g.ready) return;
      const d = ds(); if (!d) return;
      // never `cutscene` outside the ending (E1 / E2)
      if (g.state === 'cutscene' && !d.ending?.started) { const k = `${d.phaseApplied}`; if (!L.cutBad.includes(k)) L.cutBad.push(k); }
      // triggers: first entry (game + script time)
      for (const t of g.__triggers ?? []) if (L.trigAt[t.id] === undefined && inTrig(t.id)) L.trigAt[t.id] = stamp();
      // flags / keys: first time each became true / was held
      for (const [k, v] of Object.entries(d.flags ?? {})) if (v && L.flags[k] === undefined) L.flags[k] = stamp();
      for (const k of d.keys ?? [...(g.player.keys ?? [])]) if (L.keysAt[k] === undefined) L.keysAt[k] = stamp();
      // R4: nothing alive before its beat (g6_tunb_k dormant from load; test groups excepted); the chamber's head-count
      if (g.enemies) {
        let n = 0;
        for (const e of g.enemies.all) {
          if (!e.alive || /^test/.test(e.group)) continue;
          if (e.type !== 'loader' && ['pool6', 'shaft6'].includes(g.level.roomAt(e.position)?.id)) n++;
          if (C.DORMANT6.includes(e.group)) continue;
          const need = C.NEED6[e.group]; if (!need) continue;
          const [k, id] = need.split(':');
          const has = k === 'beat' ? (d.beats ?? []).includes(id) || L.beats.includes(id)
            : k === 'flag' ? !!d.flags?.[id] || L.flags[id] !== undefined
            : k === 'trig' ? L.trigAt[id] !== undefined
            : k === 'vig' ? (d.scares ?? []).includes(id) || d.t?.['vignette:' + id] !== undefined
            : k === 'restore' ? /^cp6_m/.test(String(d.restoredFrom ?? '')) : true;
          if (!has) { const key = `${e.group}@${need}`; if (!L.early.includes(key)) L.early.push(key); }
        }
        L.maxHostiles = Math.max(L.maxHostiles, n);
      }
      // phase changes: when, and the doors 0.3 s later
      const ph = d.phaseApplied;
      if (ph && L.phases[L.phases.length - 1]?.id !== ph) {
        L.phases.push({ id: ph, ...stamp() });
        L.phaseAt[ph] ??= stamp();
        setTimeout(() => {
          const w = (() => { try { return g.story.worldState?.() ?? null; } catch { return null; } })();
          L.doorsAt[ph] ??= Object.fromEntries(C.DOORS6.map((id) => [id, { st: S.doorState(id), status: w?.doors?.[id]?.status ?? undefined }]));
        }, 300);
      }
      // checkpoint written: when, and the world at that instant (compared after the load)
      const cp = d.checkpoint;
      if (cp && !L.cpAt[cp]) {
        L.cpAt[cp] = { ...stamp(), phase: ph, grip: d.grip ? { ...d.grip } : null };
        try { L.cpState[cp] = { ws: g.story.worldState?.() ?? null, boss: d.boss ? JSON.parse(JSON.stringify(d.boss)) : null, flags: { ...d.flags }, keys: [...(d.keys ?? [])], health: g.player.health }; } catch { L.cpState[cp] = null; }
      }
      // boss milestones as they are done
      const ms = d.boss?.milestones ?? [];
      for (let i = L.mile.length; i < ms.length; i++) L.mile.push({ id: ms[i], ...stamp(), grip: d.grip ? d.grip.id : null });
      // grips: start / end
      const gr = d.grip, lg = L.gripLog[L.gripLog.length - 1];
      if (gr && (!lg || lg.end !== undefined || lg.id !== gr.id)) L.gripLog.push({ id: gr.id, start: T(), s: now(), max: gr.progress });
      else if (gr && lg) lg.max = Math.max(lg.max, gr.progress);
      if (!gr && lg && lg.end === undefined) { lg.end = T(); lg.se = now(); }
      // the crossing seen (§10.1: ≥ 40 m away for ≥ 2 s)
      if (g.enemies) for (const e of g.enemies.all) if (e.alive && e.group === 'g6_tun_s' && !d.flags?.f1Free) {
        const c = [e.position.x, e.position.y + 1.3, e.position.z], dist = e.position.distanceTo(P());
        if (S.view(c, 50) && dist >= 40) { L.cross.seen += 0.1; L.cross.minDist = Math.min(L.cross.minDist ?? 1e9, dist); }
      }
      // the audio log (H14): stamp every new entry with game time
      try {
        const al = g.story.audioLog?.(); if (Array.isArray(al)) {
          let from = 0;
          if (L.audioLast) { const i = al.findIndex((x) => x === L.audioLast || (x.t === L.audioLast.t && x.id === L.audioLast.id)); from = i >= 0 ? i + 1 : 0; }
          for (let i = from; i < al.length; i++) L.audio.push({ id: al[i].id, at: T(), s: now(), pos: al[i].pos });
          if (al.length) L.audioLast = al[al.length - 1];
        }
      } catch { /* no H14 */ }
      // scares: which fired, with the hostiles around at that moment
      for (const x of d.scareLog ?? []) if (!L.scares.some((y) => y.id === x.id && y.t === x.t)) {
        const near = (g.enemies?.all ?? []).filter((e) => awake(e) && e.type !== 'loader' && e.position.distanceTo(P()) <= 30).map((e) => e.group);
        L.scares.push({ ...x, at: T(), near, inCutscene: g.state === 'cutscene', boss: !!d.flags?.hostile && !d.flags?.quiet });
      }
    }, 100);
    // ── the line oracle: every spoken line judged from WORLD state on the first poll after it starts (§6.2 rules)
    const F = (k) => !!ds()?.flags?.[k];
    const phase = () => { const d = ds(); return String(d?.phaseApplied ?? d?.phase ?? ''); };
    const heard = (id) => (ds()?.heard ?? []).includes(id) || (g.story?.lineLog ?? []).some((l) => l.said === id && l.t < (now() ?? 0) - 0.05);
    const within = (st, s) => !!st && T() - st.g <= s;
    const grp = (id) => ds()?.groups?.[id] ?? {};
    const part = (k) => { try { return g.story.boss?.()?.parts?.[k]?.hp ?? null; } catch { return null; } };
    const loaderPos = () => { const e = (g.enemies?.all ?? []).find((x) => x.type === 'loader' && x.alive); return e ? [e.position.x, e.position.y, e.position.z] : null; };
    const loaderInView = () => { try { const B = g.story.boss?.(); const ps = Object.values(B?.parts ?? {}).map((p) => p.pos).filter((p) => Array.isArray(p) && p.length === 3); const lp = loaderPos(); if (lp) ps.push(lp); return ps.some((p) => S.view(p, 50)); } catch { return false; } };
    const C2 = (id, pre) => g.facts.choice === id.split('_').pop() && pre;
    const inPoolShaft = () => ['pool6', 'shaft6'].includes(room());
    const FLOODS = ['flood_1', 'flood_2', 'flood_3', 'flood_4'];
    const OR = {
      l6_unit_tube: () => ['A', 'T'].includes(phase()),
      l6_kes_start_2: () => F('tubeLatched') || phase() === 'U',
      l6_kes_contact_a: () => F('f1Free') && grp('g6_tun_s').alive >= 1,
      l6_kes_tun_done: () => !grp('g6_tun_s').alive,
      l6_kes_rep: () => room() === 'rep6' || inTrig('t6_rep'),
      l6_kes_contact_rep: () => !!grp('g6_rep_s').spawned || !!grp('g6_rep_u').spawned,
      l6_kes_tunb: () => room() === 'tun6_b' || inTrig('t6_tunb'),
      l6_kes_tunb_soldier: () => grp('g6_tunb_s').holding > 0 && !g.player.flashlightOn,
      l6_kes_he_1: () => room() === 'he6' || inTrig('t6_he'),
      l6_kes_he_2: () => !F('manual'),
      l6_kes_he_2b: () => F('manual'),
      l6_reyes_he: () => heard('l6_kes_he_2'),
      l6_kes_aas: () => heard('l6_aas_2'),
      l6_reyes_queue: () => F('queue') || g.facts.manifest === true,
      l6_kes_queue: () => heard('l6_reyes_queue'),
      l6_unit_manual: () => F('manual'),
      l6_kes_manual: () => F('manual') && !F('bjOpen'),
      l6_kes_he_contact: () => !!grp('g6_he').spawned && room() !== 'vault6',
      l6_kes_he_contact_b: () => !!grp('g6_he').spawned && room() === 'vault6',
      l6_kes_vault: () => room() === 'vault6' && !F('pulled'),
      l6_unit_deny_a: () => within(L.uses.vault6_lock, 3) && !(g.player.keys?.has?.('key6_a')),
      l6_kes_bj: () => F('bjOpen') && !F('pulled'),
      l6_unit_pull: () => F('pulled'),
      l6_kes_pull_2: () => F('pulled') && !!doorOf('d6_shaft')?.locked,
      l6_kes_thud: () => (ds()?.scares ?? []).includes('v6_thud'),
      l6_unit_deny_b: () => within(L.uses.shaft6_lock, 3) && !(g.player.keys?.has?.('key6_b')),
      l6_unit_shaft: () => F('shaftOpen'),
      l6_kes_shaft: () => (ds()?.scares ?? []).includes('v6_shaft_lights'),
      l6_kes_pool_1: () => F('reveal') || L.beats.includes('l6_reveal'),
      l6_kes_pool_2: () => heard('l6_kes_pool_1') && loaderInView(),
      l6_kes_pool_2b: () => heard('l6_kes_pool_1') && !loaderInView(),
      l6_unit_loader_1: () => F('hostile') && !!loaderPos(),
      l6_kes_boss_1: () => F('hostile'),
      l6_kes_boss_ram: () => (part('ram_e') ?? 1) > 0 && (part('ram_w') ?? 1) > 0,
      l6_kes_boss_flood: () => FLOODS.some((k) => (part(k) ?? 0) > 0),
      l6_kes_boss_frame: () => inTrig('t6_cage'),
      l6_kes_pin: () => F('pin'),
      l6_kes_pump_half: () => (ds()?.frame?.pressure ?? 0) >= 0.5 || F('pressure'),
      l6_kes_pump_done: () => F('pressure') && !F('trunkCut'),
      l6_unit_shear_pin: () => !F('pin') && (within(L.uses.frame6_pump, 3) || within(L.uses.frame6_lever, 3)),
      l6_unit_shear_low: () => !F('pressure') && within(L.uses.frame6_lever, 3),
      l6_kes_boss_pod: () => part('ram_e') === 0 && part('ram_w') === 0,
      l6_kes_loader_dead: () => F('loaderDead') && !F('trunkCut'),
      l6_kes_cut_loader: () => F('trunkCut') && !F('loaderDead'),
      l6_kes_console: () => F('quiet'),
      l6_kes_console_2: () => F('quiet') && !ds()?.ending?.started,
      l6_kes_end_1: () => g.facts.manifest !== true && !F('queue'),
      l6_kes_end_1b: () => g.facts.manifest === true || F('queue'),
      l6_kes_end_4: () => heard('l6_aas_2'),
      l6_kes_end_4b: () => !heard('l6_aas_2'),
      l6_kes_busy: () => hostiles(25) && !inPoolShaft(),
      l6_kes_hint_he: () => !F('manual') && !['he6', 'vault6'].includes(room()),
      l6_kes_hint_switch: () => !F('manual') && (['he6', 'vault6'].includes(room()) || inTrig('t6_trench')),
      l6_kes_hint_bj: () => F('manual') && !F('pulled'),
      l6_kes_hint_shaft: () => F('pulled') && !F('shaftOpen'),
      l6_kes_hint_frame: () => F('shaftOpen') && !F('trunkCut'),
      l6_kes_hint_loader: () => F('trunkCut') && !F('loaderDead'),
      l6_kes_hint_console: () => F('quiet') && !ds()?.ending?.started,
    };
    for (const c of ['stop', 'command']) {
      OR[`l6_choir_start_${c}`] = () => C2(`x_${c}`, heard('l6_kes_start_2'));
      OR[`l6_choir_dark_${c}`] = () => C2(`x_${c}`, !!grp('g6_tunb_s').spawned);
      OR[`l6_choir_he_${c}`] = () => C2(`x_${c}`, (g.story?.lineLog ?? []).some((l) => l.said === 'l6_kes_he_3'));
      OR[`l6_choir_queue_${c}`] = () => C2(`x_${c}`, heard('l6_kes_queue'));
      OR[`l6_choir_manual_${c}`] = () => C2(`x_${c}`, F('manual'));
      OR[`l6_choir_pull_${c}`] = () => C2(`x_${c}`, F('pulled'));
      OR[`l6_choir_pool_${c}`] = () => C2(`x_${c}`, F('hostile'));
      OR[`l6_choir_pin_${c}`] = () => C2(`x_${c}`, F('pin'));
      OR[`l6_choir_pump_${c}`] = () => C2(`x_${c}`, heard('l6_kes_pump_half'));
      OR[`l6_choir_loader_${c}`] = () => C2(`x_${c}`, F('loaderDead'));
      OR[`l6_choir_last_${c}`] = () => C2(`x_${c}`, !!ds()?.ending?.started);
      OR[`l6_sol_frame_${c}`] = () => C2(`x_${c}`, inTrig('t6_cage'));
      OR[`l6_sol_reach_${c}`] = () => C2(`x_${c}`, F('shaftOpen') && !F('pin'));
      OR[`l6_sol_lost_${c}`] = () => C2(`x_${c}`, true);
      for (const k of ['down', 'need', 'felt', 'rounds']) OR[`l5_sol_${k}_${c}`] = () => C2(`x_${c}`, (g.enemies?.all ?? []).some((e) => e.alive && e.type === 'soldier' && e.position.distanceTo(P()) <= 15.5));
      OR[`l5_sol_light_${c}`] = () => C2(`x_${c}`, g.player.flashlightOn && (g.enemies?.all ?? []).some((e) => e.alive && e.type === 'soldier' && e.position.distanceTo(P()) <= 25.5));
    }
    const UNC = new Set(C.UNCOND);
    let judged = 0;
    setInterval(() => {
      const log = g.story?.lineLog; if (!Array.isArray(log)) return;
      for (; judged < log.length; judged++) {
        const l = log[judged]; const id = l?.said; if (!id) continue;
        let okk = true, why = '';
        try {
          if (OR[id]) { okk = !!OR[id](); if (!okk) why = 'oracle false'; }
          else if (!UNC.has(id) && !L.noOracle.includes(id)) L.noOracle.push(id);
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
      mark('A', phase() === 'A', 7, 'the tube never opened (phase A > 7 s; §4.1: T at 3.9 s)');
      mark('T', phase() === 'T' && inTrig('t6_tube') && P().z < -0.6, 5, 'feet in t6_tube past the doorway in T for 5 s and no latch (U)');
      mark('reveal', !!d.flags?.reveal && !d.flags?.hostile, 22, 'the reveal without a hostile start for 22 s (cap reveal + 18)');
      mark('quiet', !!d.flags?.trunkCut && !!d.flags?.loaderDead && !d.flags?.quiet && !(g.enemies?.all ?? []).some((e) => awake(e)), 70, 'cut + loader dead, nothing awake, no quiet for 70 s (fightOutWhere 60 s + 2 s)');
      mark('ending', !!d.ending?.started && !(d.beats ?? []).includes('l6_end'), 60, 'the ending started > 60 s ago and no l6_end (E1 + E2 ≤ 50 s)');
    }, 200);

    // ── the helper library the node side calls (positions FROM THE PAGE)
    S.trig = (id) => (g.__triggers ?? []).find((t) => t.id === id) ?? null;
    S.mk = (n) => { const p = mk(n); return p ? [p.x, p.y, p.z] : null; };
    S.roomOf = (x, y, z) => g.level.roomAt(new (V())(x, y, z))?.id ?? null;
    S.interior = (x, z, inset = 0.3, y = 0) => {
      const r = g.level.roomAt(new (V())(x, y, z)); if (!r) return null;
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
    /** A capsule-sized free spot (floor under, nothing within 0.45 m at knee and chest, head room). */
    S.free = (x, y, z, crouch = false) => {
      const v = (a, b, c) => new (V())(a, b, c);
      if (los(v(x, y + 0.35, z), v(x, y - 0.35, z))) return false;
      const hs = crouch ? [0.35, 0.8] : [0.45, 1.25];
      for (const h of hs) for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, o = v(x + Math.cos(a) * 0.45, y + h, z + Math.sin(a) * 0.45), c = v(x, y + h, z);
        if (!los(c, o) || !los(o, c)) return false;
      }
      return los(v(x, y + 0.4, z), v(x, y + (crouch ? 1.12 : 1.85), z));
    };
    const face = (from, to) => { const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]; return { yaw: Math.atan2(-dx, -dz) * 180 / Math.PI, pitch: Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI }; };
    S.face = face;
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
    S.inRegion = (id, x, y, z) => (g.level.regions?.[id] ?? []).some((b) => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && y >= b.min.y - 0.5 && y <= b.max.y + 0.5);
    /** Stand points. kind: trig | use | near | mk | room | at. Returns { x, y, z, yaw, pitch, room } or { err }. */
    S.spot = (kind, id, o = {}) => {
      let p = null, why = '';
      if (kind === 'trig') {
        const t = S.trig(id); if (!t) return { err: `trigger ${id} missing (level: __game.__triggers)` };
        const cx = t.x0 + (t.x1 - t.x0) * (o.fx ?? 0.5), cz = t.z0 + (t.z1 - t.z0) * (o.fz ?? 0.5);
        const ys = S.floors(cx, cz).filter((y) => y > (t.y0 ?? -1) && y < (t.y1 ?? 4));
        const y = o.y ?? ys.sort((a, b) => b - a)[0];
        if (y === undefined) return { err: `trigger ${id}: no floor of room ${S.roomOf(cx, 0, cz) ?? '—'} within its y range ${t.y0}…${t.y1}` };
        const m = 0.38;
        p = S.search(cx, cz, y, [t.x0 + m, t.x1 - m, t.z0 + m, t.z1 - m], o);
        why = `no free spot in ${id}`;
      } else if (kind === 'use' || kind === 'near') {
        let ip, r;
        if (kind === 'use') { const i = g.interactables.get(id); if (!i) return { err: `interactable ${id} missing` }; ip = i.position; r = i.radius ?? 2.2; }
        else { const m = o.p ? new (V())(...o.p) : mk(id); if (!m) return { err: `marker ${id} missing` }; ip = m; r = Infinity; }
        const eyeH = o.crouch ? 0.98 : 1.65;
        const dist = o.dist ?? Math.min(1.1, r - 0.4);
        for (const dd of [dist, dist - 0.25, dist + 0.25, dist + 0.5, dist - 0.45, dist + 0.75, dist + 1.0]) {
          if (dd <= 0.3) continue;
          for (let k = 0; k < 24 && !p; k++) {
            const a = k * Math.PI / 12, x = ip.x + Math.cos(a) * dd, z = ip.z + Math.sin(a) * dd;
            const rm = S.interior(x, z, 0.3); if (!rm || (o.room && rm !== o.room)) continue;
            if (o.trig) { const t = S.trig(o.trig); if (!t || x < t.x0 + 0.3 || x > t.x1 - 0.3 || z < t.z0 + 0.3 || z > t.z1 - 0.3) continue; }
            if (o.notTrig) { const t = S.trig(o.notTrig); if (t && x >= t.x0 - 0.3 && x <= t.x1 + 0.3 && z >= t.z0 - 0.3 && z <= t.z1 + 0.3) continue; }
            const y = S.floors(x, z).filter((fy) => fy <= ip.y + 0.3 && fy >= ip.y - 2.8).sort((a2, b2) => b2 - a2)[0];
            if (y === undefined || !S.free(x, y, z, o.crouch)) continue;
            const eye = new (V())(x, y + eyeH, z), to = ip.clone().add(eye.clone().sub(ip).setLength(0.12));
            if (eye.distanceTo(ip) > r - 0.05 || (o.los !== false && !los(eye, to))) continue;
            p = [x, y, z, rm];
          }
          if (p) break;
        }
        why = `no free spot ${dist.toFixed(2)} m from ${id} with a clear eye ray${o.room ? ' in ' + o.room : ''}${o.trig ? ' inside ' + o.trig : ''}`;
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
      } else if (kind === 'at') {
        const [x, y, z] = o.p; p = S.search(x, z, y, null, { ...o, maxR: o.maxR ?? 2.0 }); why = `no free spot within 2 m of (${o.p})`;
      }
      if (!p) return { err: why };
      const look = o.look ?? null;
      const f = look ? face([p[0], p[1] + 1.65, p[2]], look) : { yaw: o.yaw ?? 0, pitch: o.pitch ?? 0 };
      return { x: p[0], y: p[1], z: p[2], room: p[3], yaw: o.yaw ?? f.yaw, pitch: o.pitch ?? f.pitch };
    };
    S.tp = (s, crouch = false) => {
      g.player.debug.crouch?.(!!crouch);
      g.player.teleport(new (V())(s.x, s.y, s.z), s.yaw * Math.PI / 180, s.pitch * Math.PI / 180);
      return true;
    };
    S.kill = (groups, o = {}) => {
      let n = 0;
      for (const e of [...g.enemies.all]) {
        if (!e.alive || e.type === 'loader' || (e.state === 'dormant' && !o.dormant) || (groups && !groups.includes(e.group))) continue;
        for (let k = 0; k < 10 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone().setY(e.position.y + 1.2), normal: new (V())(0, 0, 1), distance: 1, part: 'torso' }, 500, new (V())(0, 0, -1));
        n++;
      }
      return n;
    };
    S.alive = (group) => g.enemies.all.filter((e) => e.alive && e.group === group).map((e) => ({ id: e.id, type: e.type, state: e.state, pos: [e.position.x, e.position.y, e.position.z].map((v) => +v.toFixed(2)) }));
    S.hostileCount = () => g.enemies.all.filter((e) => e.alive && e.type !== 'loader' && ['pool6', 'shaft6'].includes(g.level.roomAt(e.position)?.id)).length;
    // ── nav paths and a steering walker (real movement input: player.debug.move) — the bots use these
    const navIdx = () => (S._idx ??= new Map(g.level.nav.map((n, i) => [n.id, i])));
    S.nearestNode = (p) => { const nav = g.level.nav; let best = -1, bd = 1e9; for (let i = 0; i < nav.length; i++) { const n = nav[i].position, d = Math.hypot(n.x - p[0], n.z - p[2]) + Math.abs(n.y - p[1]) * 4; if (d < bd) { bd = d; best = i; } } return best; };
    S.path = (from, to) => {
      const nav = g.level.nav; if (!nav?.length) return null;
      const a = S.nearestNode(from), b = S.nearestNode(to), idx = navIdx();
      const dist = new Float64Array(nav.length).fill(Infinity), prev = new Int32Array(nav.length).fill(-1), done = new Uint8Array(nav.length);
      dist[a] = 0;
      for (;;) {
        let u = -1, du = Infinity; for (let i = 0; i < nav.length; i++) if (!done[i] && dist[i] < du) { du = dist[i]; u = i; }
        if (u < 0 || u === b) break; done[u] = 1;
        for (const l of nav[u].links) { const v = idx.get(l); if (v === undefined || done[v]) continue; const w = nav[u].position.distanceTo(nav[v].position); if (du + w < dist[v]) { dist[v] = du + w; prev[v] = u; } }
      }
      if (!Number.isFinite(dist[b])) return null;
      const out = []; for (let v = b; v >= 0; v = prev[v]) out.unshift(nav[v].position.toArray()); out.push(to); return out;
    };
    /** Steer along `pts` with debug.move (yaw turned to the next point unless `keepYaw`: then a strafe mix). */
    S.walk = (pts, o = {}) => {
      if (S._walk?.timer) clearInterval(S._walk.timer);
      const W = S._walk = { pts, i: 0, done: false, ok: false, stuck: 0, last: null, sprint: !!o.sprint, keepYaw: !!o.keepYaw };
      W.timer = setInterval(() => {
        if (W.done || g.state !== 'playing') return;
        const p = g.player.position;
        while (W.i < W.pts.length - 1 && Math.hypot(W.pts[W.i][0] - p.x, W.pts[W.i][2] - p.z) < 0.6) W.i++;
        const q = W.pts[W.i], dx = q[0] - p.x, dz = q[2] - p.z, d = Math.hypot(dx, dz) || 1e-3;
        if (W.i === W.pts.length - 1 && d < (o.tol ?? 0.5)) { W.done = true; W.ok = true; g.player.debug.move(0, 0, false); return; }
        if (W.last && Math.hypot(W.last[0] - p.x, W.last[1] - p.z) < 0.02) W.stuck += 0.05; else W.stuck = 0;
        W.last = [p.x, p.z];
        if (W.stuck > 3) { W.done = true; W.ok = false; W.why = `stuck at (${[p.x, p.y, p.z].map((v) => v.toFixed(2))})`; g.player.debug.move(0, 0, false); return; }
        if (!W.keepYaw) { g.player.yaw = Math.atan2(-dx, -dz); g.player.debug.move(1, 0, W.sprint); }
        else { const y = g.player.yaw, fx = -Math.sin(y), fz = -Math.cos(y), rx = Math.cos(y), rz = -Math.sin(y); g.player.debug.move((dx * fx + dz * fz) / d, (dx * rx + dz * rz) / d, W.sprint); }
      }, 50);
      return true;
    };
    S.walkState = () => (S._walk ? { done: S._walk.done, ok: S._walk.ok, i: S._walk.i, n: S._walk.pts.length, why: S._walk.why ?? null } : null);
    S.walkStop = () => { if (S._walk) { clearInterval(S._walk.timer); S._walk.done = true; } g.player.debug.move(0, 0, false); return true; };
    // ── the boss bot (--boss / --dry): runs in the page every 100 ms; node supervises
    S.bot = (o = {}) => {
      if (S._bot?.timer) clearInterval(S._bot.timer);
      let seed = ((o.seed ?? 1) * 2654435761) >>> 0;
      const B = S._bot = { o, log: { attacks: [], dmg: [], shots: 0, frames: 0, lit: 0, litSoldier: 0, targets: {} }, rng: () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296), crouchUntil: 0 };
      g.events.on('player:damaged', (e) => { if (!B.stopped) B.log.dmg.push({ t: g.time, amount: e.amount, from: e.from ? e.from.toArray() : null }); });
      g.events.on('weapon:fired', () => { if (!B.stopped) B.log.shots++; });
      B.timer = setInterval(() => {
        if (B.stopped || g.state !== 'playing') return;
        const p = g.player;
        let R = null; try { R = g.story.boss?.() ?? g.enemies.debug?.loader?.() ?? null; } catch { R = null; }
        B.log.frames++;
        // telegraph log from the loader's debug row (W3b as built: lastAttack, ring, outline; times on the world clock)
        if (R && R.lastAttack && R.lastAttack.kind && R.lastAttack.telegraphStart >= 0) {
          let a = B.log.attacks[B.log.attacks.length - 1];
          if (!a || a.ts !== R.lastAttack.telegraphStart) { a = { kind: R.lastAttack.kind, ts: R.lastAttack.telegraphStart, seenAt: g.time, lock: -1, impact: -1, outlineAt: -1, dodgeAt: -1, stage: R.stage }; B.log.attacks.push(a); }
          if (R.lastAttack.lockStart >= 0 && a.lock < 0) a.lock = R.lastAttack.lockStart;
          if (R.lastAttack.impact >= 0 && a.impact < 0) a.impact = R.lastAttack.impact;
          if (R.outline && a.outlineAt < 0) a.outlineAt = g.time;
          // dodge: 3 m away at the lock (slam), out of the slot at the outline (shift / drop), crouch at the lane (swing)
          const ring = R.ring?.pos, me = p.position;
          if (a.dodgeAt < 0 && o.dodge !== false) {
            if (a.kind === 'slam' && a.lock >= 0) {
              if (ring) { const dx = me.x - ring[0], dz = me.z - ring[2], l = Math.hypot(dx, dz); if (l < 2.6) { const s = B.rng() < 0.5 ? 1 : -1; const ux = l > 0.1 ? dx / l : s, uz = l > 0.1 ? dz / l : 0; S.walk([[me.x + ux * 3, me.y, me.z + uz * 3]], { keepYaw: true, tol: 0.4 }); } }
              a.dodgeAt = g.time;
            } else if ((a.kind === 'shift' || a.kind === 'drop') && a.outlineAt >= 0) {
              const sl = (g.level.dock?.slots ?? []).find((s2) => s2.id === R.outline);
              if (sl && me.x >= sl.box.min.x - 0.4 && me.x <= sl.box.max.x + 0.4 && me.z >= sl.box.min.z - 0.4 && me.z <= sl.box.max.z + 0.4) { const c = sl.box.getCenter(new (V())()); const dx = me.x - c.x, dz = me.z - c.z, l = Math.hypot(dx, dz) || 1; S.walk([[me.x + dx / l * 3, me.y, me.z + dz / l * 3]], { keepYaw: true, tol: 0.4 }); }
              a.dodgeAt = g.time;
            } else if (a.kind === 'swing') { p.debug.crouch?.(true); B.crouchUntil = g.time + 3.0; a.dodgeAt = g.time; }
          }
        }
        if (B.crouchUntil && g.time > B.crouchUntil) { p.debug.crouch?.(false); B.crouchUntil = 0; }
        // flood-lit sight (D20)
        let lit = false; try { lit = !!g.enemies.boss?.('g6_loader')?.floodLit(p.position); } catch { lit = false; }
        if (lit) { B.log.lit++; if ((g.enemies.debug?.soldiers?.() ?? []).some((s2) => s2.aware && Math.hypot(s2.pos[0] - p.position.x, s2.pos[2] - p.position.z) >= 20)) B.log.litSoldier++; }
        if (o.shoot === false) return;
        // target: an extended ram → a close hostile → a flood when flood-lit → the open pod → any hostile in sight
        const parts = R?.parts ?? {};
        const live = (k) => parts[k] && parts[k].hp > 0 && Array.isArray(parts[k].pos) && parts[k].pos.length === 3;
        let tgt = null, tk = null;
        const near = g.enemies.all.filter((e) => awake(e) && e.type !== 'loader' && e.position.distanceTo(p.position) <= 40 && los(p.eye, e.position.clone().setY(e.position.y + 1.2))).sort((a2, b2) => a2.position.distanceTo(p.position) - b2.position.distanceTo(p.position))[0];
        if (o.only) { for (const k of o.only) if (!tgt && live(k)) { tgt = parts[k].pos; tk = k; } }
        else {
          for (const k of ['ram_e', 'ram_w']) if (!tgt && live(k) && parts[k].mult > 0) { tgt = parts[k].pos; tk = k; }
          if (!tgt && near && near.position.distanceTo(p.position) < 14) { tgt = [near.position.x, near.position.y + 1.2, near.position.z]; tk = 'enemy'; }
          if (!tgt && lit) for (const k of FLOODS) if (!tgt && live(k)) { tgt = parts[k].pos; tk = k; }
          if (!tgt && live('pod') && parts.pod.mult > 0) { tgt = parts.pod.pos; tk = 'pod'; }
          if (!tgt && near) { tgt = [near.position.x, near.position.y + 1.2, near.position.z]; tk = 'enemy'; }
        }
        if (!tgt) { p.debug.aimLock(null); p.debug.aim?.(false); return; }
        B.log.targets[tk] = (B.log.targets[tk] ?? 0) + 1;
        const e = p.eye, dx = tgt[0] - e.x, dy = tgt[1] - e.y, dz = tgt[2] - e.z;
        p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        p.debug.aimLock(tgt[0], tgt[1], tgt[2]);
        p.debug.aim?.(true);
        const cw = p.currentWeapon, w = cw ? p.weapons[cw] : null;
        if (w && w.clip === 0 && !w.reloading && w.reserve > 0) p.debug.reload();
        else if (w && w.clip > 0 && !w.reloading) p.debug.fire();
      }, 100);
      return true;
    };
    S.botStop = () => { if (S._bot) { S._bot.stopped = true; clearInterval(S._bot.timer); } try { g.player.debug.aimLock(null); g.player.debug.aim?.(false); g.player.debug.crouch?.(false); } catch { /* */ } S.walkStop(); return S._bot?.log ?? null; };
    S.botLog = () => S._bot?.log ?? null;
  }
};

// ───────────────────────────────────────────────────────────── browser, sessions (own storage per case)
const CONST = { DORMANT6, NEED6, OPENING6, DOORS6, UNCOND };
const browser = await launch();
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
      let v = false; try { v = !!new Function('g', 'd', 'L', 'S', `return (${cond});`)(g, d ?? {}, window.__L6, window.__S6); } catch { v = false; }
      if (v) return 'ok';
      if (g.time - t0 > gs) return 'timeout';
      return false;
    }, [cond, t0, gameSec], { timeout: cap, polling: 100 });
    res = await h.jsonValue();
  } catch { res = 'wall'; }
  if (res === 'ok') return true;
  if (!quiet) {
    const st = await evs(() => { let d = {}; try { d = window.__game?.story?.debugState ?? {}; } catch { /* */ } return { state: window.__game?.state, phase: d.phaseApplied, now: d.now }; });
    bad(`waited for ${what}: ${res === 'timeout' ? `not within ${gameSec} s of game time` : `game clock stalled (wall cap ${Math.round(cap / 1000)} s)`} (state ${st.state}, phase ${st.phase}, now ${f2(st.now)})`, suspect);
  }
  return false;
}
const gameWait = (sec) => untilG('false', sec, `${sec} s of game time`, 'test', { quiet: true });
async function boot(query = '', { god = true } = {}) {
  // `handoff=1`: a test run stores the end (carry, stored level) as a real one does (chain.ts)
  const url = `${base}/?level=6&autostart=1&handoff=1${god ? '&god=1' : ''}${query}`;
  for (let i = 0; ; i++) {
    try { await page.goto(url, { waitUntil: 'load', timeout: 60000 }); break; } catch (e) { if (i >= 2) return bad(`boot ${url}: ${e.message}`, 'test'); await pwait(700); }
  }
  try { await page.waitForFunction(() => window.__game?.ready && window.__game.story && window.__game.levelId, null, { timeout: 120000 }); }
  catch { return bad(`level 6 did not become ready in 120 s (${url})`, 'story'); }
  return true;
}
const dbg = async () => { const d = await evs(() => { try { return window.__game.story.debugState ?? null; } catch (e) { return { __err: e.message }; } }); return d && !d.__err ? d : {}; };
const L6 = () => ev(() => window.__L6);
const S6 = (name, ...a) => ev(([name, a]) => window.__S6[name](...a), [name, a]);
/** Stand somewhere the page says (see S.spot); false (and a [test]/[level] failure) if no such spot. */
async function stand(kind, id, o = {}, crouch = false) {
  const s = await S6('spot', kind, id, o).catch((e) => ({ err: e.message }));
  if (!s || s.err) return bad(`stand at ${kind} ${id}: ${s?.err ?? 'no answer'}`, /missing/.test(s?.err ?? '') ? 'level' : 'test');
  await S6('tp', s, crouch || !!o.crouch);
  await gameWait(0.15);
  const p = await ev(() => window.__game.player.position.toArray());
  if (Math.hypot(p[0] - s.x, p[2] - s.z) > 0.35) note(`stand ${kind} ${id}: pushed from (${[s.x, s.y, s.z].map(f2)}) to (${p.map(f2)}) — a collider the free-spot probe missed`);
  return s;
}
const look = (p) => ev((p) => { const g = window.__game, e = g.player.eye; const dx = p[0] - e.x, dy = p[1] - e.y, dz = p[2] - e.z; g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }, p);
const setYaw = (deg, pitchDeg = 0) => ev(([y, p]) => { const g = window.__game; g.player.yaw = y * Math.PI / 180; g.player.pitch = p * Math.PI / 180; }, [deg, pitchDeg]);
/** The press on an interactable (what E does): 'ok' | 'missing' | 'disabled' | 'refused' (feet outside its region). */
const use = (id) => ev((id) => { const g = window.__game; const i = g.interactables.get(id); if (!i) return 'missing'; if (!i.enabled) return 'disabled'; if (g.interactables.allowedAt && !g.interactables.allowedAt(i, g.player.position)) return 'refused'; g.interactables.use(i); return 'ok'; }, id);
const usable = (id) => ev((id) => { const g = window.__game; const i = g.interactables.get(id); if (!i) return 'missing'; if (!i.enabled) return 'disabled'; return g.interactables.allowedAt && !g.interactables.allowedAt(i, g.player.position) ? 'refused' : 'ok'; }, id);
const closeNote = () => ev(() => window.__game.ui.closeNote?.());
const heard = (id) => ev((id) => (window.__game.story.lineLog ?? []).some((l) => l.said === id), id);
const lineOf = (id) => ev((id) => (window.__game.story.lineLog ?? []).filter((l) => l.said === id).slice(-1)[0] ?? null, id);
const heardWait = (id, gs, suspect = 'story', why = '') => untilG(`(g.story.lineLog ?? []).some((l) => l.said === ${JSON.stringify(id)})`, gs, `line ${id}${why ? ' (' + why + ')' : ''}`, suspect);
const beatWait = (id, gs, why = '') => untilG(`(d.beats ?? []).includes(${JSON.stringify(id)})`, gs, `beat ${id}${why ? ' (' + why + ')' : ''}`);
const phaseWait = (p, gs, why = '') => untilG(`d.phaseApplied === ${JSON.stringify(p)} || d.phase === ${JSON.stringify(p)}`, gs, `phase ${p}${why ? ' (' + why + ')' : ''}`);
const flagWait = (f, gs, why = '') => untilG(`!!d.flags?.[${JSON.stringify(f)}]`, gs, `flag ${f}${why ? ' (' + why + ')' : ''}`);
const cpWait = (cp, gs, why = '') => untilG(`(d.checkpoints ?? []).includes(${JSON.stringify(cp)})`, gs, `${cp} written${why ? ' (' + why + ')' : ''}`);
const objectiveSeen = (text, gs = 4) => untilG(`L.objectives.some((x) => x.text === ${JSON.stringify(text)})`, gs, `objective "${text}"`, 'story');
const toastSeen = (re, gs = 4) => untilG(`L.toasts.some((x) => new RegExp(${JSON.stringify(re)}, 'i').test(x.text))`, gs, `toast /${re}/`, 'story');
const kill = (groups) => S6('kill', groups ?? null);
const killUntil = (cond, gs, what, groups = null) => untilG(`(S.kill(${JSON.stringify(groups)}), ${cond})`, gs, what, 'enemies');
const spawnedWait = (grp, gs, why = '') => untilG(`S.alive(${JSON.stringify(grp)}).length > 0 || !!d.groups?.[${JSON.stringify(grp)}]?.spawned`, gs, `${grp} spawned${why ? ' (' + why + ')' : ''}`);
const tOf = async (k) => (await dbg()).t?.[k] ?? null;
const ws = () => evs(() => { try { return window.__game.story.worldState?.() ?? null; } catch (e) { return { __err: e.message }; } });
const fire = (name) => evs((n) => { try { const r = window.__game.story.fire?.(n); return r === undefined ? null : r; } catch (e) { return { __err: e.message }; } }, name);
const fireOk = async (name, why = '') => { const r = await fire(name); return ok(r !== null && r !== false && !r?.__err, `fire('${name}')${why ? ' — ' + why : ''} accepted (${JSON.stringify(r)})`, 'story'); };
const screenText = (id) => ev((id) => window.__game.level.screen(id)?.userData?.screenText ?? null, id);
const bossRow = () => evs(() => { try { return window.__game.story.boss?.() ?? null; } catch (e) { return { __err: e.message }; } });
/** H16: press `id`, wait for its grip, hold E `sec` s (or 'done'); resolves with the grip's progress at the end. */
async function grip(id, sec, { press = true } = {}) {
  if (press) { const u = await use(id); if (u !== 'ok') return bad(`grip ${id}: the press was ${u}`, u === 'missing' ? 'level' : 'story'); }
  if (!await untilG(`d.grip?.id === ${JSON.stringify(id)}`, 1.5, `grip ${id} started by the press (H7.grip)`)) return false;
  const r = await evs(([id, sec]) => window.__game.story.grip?.(id, sec) ?? null, [id, sec]);
  if (!r || r?.__err) return bad(`story.grip('${id}', ${sec}) (H16) refused (${JSON.stringify(r)})`, 'story');
  if (typeof sec === 'number') await gameWait(sec + 0.15);
  return true;
}
const film = async (name, cond, maxGame = 12) => {
  if (!FRAMES) return;
  const t0 = await ev(() => window.__game.time);
  for (let i = 0; i < 400; i++) {
    const st = await evs(([c, t0, m]) => { const g = window.__game; let d = null; try { d = g.story.debugState; } catch { /* */ } let v = false; try { v = c ? !!new Function('g', 'd', 'L', `return (${c});`)(g, d ?? {}, window.__L6) : false; } catch { /* */ } return v || g.time - t0 > m; }, [cond, t0, maxGame]);
    if (st === true) break;
    await page.screenshot({ path: `shots/l6/frames/${name}-${String(i).padStart(3, '0')}.png` }).catch(() => {});
    await pwait(60);
  }
};
/** §3: the doors recorded 0.3 s after `phase` was applied match the table. */
async function checkDoors(phase) {
  await untilG(`!!L.doorsAt[${JSON.stringify(phase)}]`, 2, `doors recorded at phase ${phase}`, 'test', { quiet: true });
  const got = (await L6()).doorsAt[phase];
  if (!got) return bad(`doors at phase ${phase}: not recorded (phase never applied?)`, 'story');
  const match = (st, w) => w === '*' || st === '?' || (w === 'O' ? /^O/.test(st) : w === 'A' ? /A/.test(st) : st === w);
  if (PH_VARIANT[phase]) { const [id, w] = PH_VARIANT[phase]; return ok(match(got[id].st, w), `phase ${phase}: ${id} ${got[id].st} (want ${w})`, 'story'); }
  const want = PH[phase]; if (!want) return true;
  const diff = Object.entries(want).filter(([id, w]) => !match(got[id]?.st ?? '?', w)).map(([id, w]) => `${id} ${got[id]?.st}≠${w}`);
  for (const [id, s] of Object.entries(PH_STATUS[phase] ?? {})) if (got[id]?.status !== undefined && got[id].status !== s) diff.push(`${id} status ${got[id].status}≠${s}`);
  return ok(!diff.length, `phase ${phase}: doors per §3${diff.length ? ' — ' + diff.join(', ') : ''}`, 'story');
}
const near = (v, want, tol = 0.12) => typeof v === 'number' && Math.abs(v - want) <= tol;
/** A line `id` starts `gap` s after line `prev` ENDS (lineLog end; ± tol), and ≤ 0.12 s from its cue. */
async function gapAfter(prev, id, gap, tol = 0.15) {
  const a = await lineOf(prev), b = await lineOf(id);
  if (!a || !b) return bad(`gap ${prev} → ${id}: ${!a ? prev : id} not in lineLog`, 'story');
  const dt = b.t - (a.end ?? a.t + (a.dur ?? 0));
  return ok(near(dt, gap, tol), `${id} ${f2(dt)} s after ${prev} ends (want ${gap} ± ${tol})`, 'story');
}
/** CLOCK6: hh:mm of a script time (arrival hour = facts.testHour ?? 62.75). */
const hhmm = (hour) => { const h = ((hour % 24) + 24) % 24; const m = Math.floor((h - Math.floor(h)) * 60 + 1e-6); return `${String(Math.floor(h)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

// ───────────────────────────────────────────────────────────── needs → owners (for skips and --contract)
const OWNER_OF_VIG = Object.fromEntries(Object.entries(VIGNETTES6).flatMap(([o, ids]) => ids.map(([i]) => [i, o])));
const LIGHT_OWNER = { lock6: 'D1', tun6_a: 'D1', rep6: 'D1', tun6_b: 'D1', bay6: 'D1', he6: 'D2', vault6: 'D2', trench6: 'D2', shaft6: 'D3b', shaft6_emerg: 'D3b', pool6: 'D3a', stores6: 'D3b', feed6: 'W7' };
function ownerOf(need) {
  const [k, id] = need.split(':');
  if (k === 'hook') return HOOKS_B.includes(id) ? 'ST-b' : 'ST-a';
  if (k === 'ds') return DS_B.includes(id) ? 'ST-b' : 'ST-a';
  if (k === 'ws' || k === 'shape') return 'ST-a';
  if (k === 'vig') return OWNER_OF_VIG[id.split(' ')[0]] ?? 'D*';
  if (k === 'light') return LIGHT_OWNER[id] ?? 'D*';
  if (k === 'enemies') return 'W3b';
  if (k === 'player') return 'W1';
  if (k === 'audio') return 'W2b';
  if (k === 'ui') return 'W2a';
  if (k === 'voice') return 'W9';
  if (k === 'level' && ['water', 'dock'].includes(id)) return 'W4b';
  return 'W4a';
}
const suspectOf = (o) => (/^ST/.test(o) ? 'story' : o === 'W3b' ? 'enemies' : o === 'W1' ? 'player' : o === 'W2b' ? 'audio' : o === 'W2a' ? 'ui' : o === 'W9' ? 'voices' : 'level');
/** In-page existence test of needs (door: room: trig: mk: use: pickup: screen: group: region: cover: hook: ds: light:
 *  enemies: player: audio: ui: level:). */
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
      use: () => !!g.interactables.get(id),
      pickup: () => g.level.pickupSpawns.some((p) => p.id === id),
      screen: () => !!g.level.screen(id),
      group: () => g.level.enemySpawns.some((e) => e.group === id),
      region: () => Array.isArray(g.level.regions?.[id]) && g.level.regions[id].length > 0,
      cover: () => (g.level.cover ?? []).some((c) => c.set === id),
      hook: () => typeof s?.[id] === 'function' || (id === 'lineLog' && Array.isArray(s?.lineLog)) || (id === 'rules' && s?.rules && typeof s.rules === 'object' && Object.keys(s.rules).length > 0),
      ds: () => d[id] !== undefined,
      light: () => groups.includes(id),
      enemies: () => { const p = id.split('.'); let o = g.enemies; for (const q of p) o = o?.[q]; return typeof o === 'function'; },
      player: () => { const p = id.split('.'); let o = g.player; for (const q of p) o = o?.[q]; return id === 'wading' ? typeof o === 'number' : typeof o === 'function'; },
      audio: () => Array.isArray(g.audio.debug?.log) || typeof g.audio.debug?.log === 'function',
      ui: () => typeof g.ui[id] === 'function',
      level: () => (id === 'water' ? Array.isArray(g.level.water) && g.level.water.length > 0 : id === 'dock' ? !!g.level.dock : id === 'killY' ? g.level.killY === -36 && g.physics.killY === -36 : false),
    }[k];
    if (!has || !has()) out.push(n);
  }
  return out;
}, needs).then((r) => (Array.isArray(r) ? r : needs));

// ───────────────────────────────────────────────────────────── --contract (and the preflight of every mode)
async function contract({ full = true } = {}) {
  console.log('── contract: §10.0 hooks, debugState fields and shapes, level ids, module members');
  const need = [
    ...[...HOOKS_A, ...HOOKS_B].map((h) => `hook:${h}`), ...Object.keys(DS_FIELDS).map((k) => `ds:${k}`),
    ...ROOMS6.map((r) => `room:${r}`), ...DOORS6.map((x) => `door:${x}`), ...TRIGS6.map((x) => `trig:${x}`),
    ...[...MARKERS_STAND, ...MARKERS_WALL].map((m) => `mk:${m}`), ...USES6.map((u) => `use:${u}`), ...PICKUPS6.map((p) => `pickup:${p}`),
    ...SCREENS6.map((x) => `screen:${x}`), ...Object.keys(GROUPS6).map((x) => `group:${x}`), ...REGIONS6.map((r) => `region:${r}`),
    ...COVER_SETS6.map((c) => `cover:${c}`), ...LIGHT_GROUPS6.map((l) => `light:${l}`), 'level:water', 'level:dock', 'level:killY',
    ...['release', 'holding', 'corpsePoint', 'rush', 'boss', 'patrol', 'debug.soldiers', 'debug.loader'].map((x) => `enemies:${x}`),
    ...['grip', 'removeKey', 'debug.hitRate', 'debug.aimLock', 'debug.grip', 'debug.gripHold', 'debug.water', 'wading'].map((x) => `player:${x}`),
    'audio:debug.log', ...['radio', 'showCard'].map((x) => `ui:${x}`),
  ];
  const miss = await missingOf(need);
  const shape = await evs(([DSF, DSS, BS, WSF, SOLF, PARTS, GROUPS]) => {
    const g = window.__game, s = g.story, out = [];
    const ty = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
    let d = null; try { d = s.debugState; } catch (e) { out.push(`debugState getter throws: ${e.message}`); }
    if (d) {
      if (d.level !== 6) out.push(`debugState.level ${d.level} (want 6)`);
      if (d.stub) out.push('debugState.stub is set — K\'s story stub is running (ST-a / ST-b replace src/story/l6/index.ts)');
      for (const [k, t] of Object.entries(DSF)) if (d[k] !== undefined && t !== 'any' && ty(d[k]) !== t) out.push(`debugState.${k}: ${ty(d[k])} (want ${t})`);
      for (const [k, sub] of Object.entries(DSS)) if (d[k] && typeof d[k] === 'object') for (const f of sub) if (!(f in d[k])) out.push(`debugState.${k}.${f} missing`);
      if (d.grip !== undefined && d.grip !== null && !(typeof d.grip === 'object' && 'id' in d.grip && 'progress' in d.grip && 'holding' in d.grip)) out.push(`debugState.grip ${JSON.stringify(d.grip)} (want { id, progress, holding } | null)`);
      if (d.frame && d.frame.pressure !== undefined && !(typeof d.frame.pressure === 'number' && d.frame.pressure >= 0 && d.frame.pressure <= 1)) out.push(`debugState.frame.pressure ${d.frame.pressure} (want 0 … 1)`);
      if (d.boss && typeof d.boss === 'object') { for (const f of BS) if (!(f in d.boss)) out.push(`debugState.boss.${f} missing`); if (d.boss.waves && !['w1', 'w2', 'w3'].every((w) => w in d.boss.waves)) out.push('debugState.boss.waves wants { w1, w2, w3 }'); }
      if (d.ending && d.ending.times !== undefined && d.ending.times !== null && typeof d.ending.times !== 'object') out.push(`debugState.ending.times: ${ty(d.ending.times)} (want Record<cue, s>)`);
      if (d.launchAt !== undefined && d.launchAt !== null && typeof d.launchAt !== 'number') out.push(`debugState.launchAt: ${ty(d.launchAt)} (want number | null)`);
      if (d.groups && typeof d.groups === 'object') {
        const gs = Object.keys(d.groups);
        const lack = GROUPS.filter((gid) => !gs.includes(gid)); if (lack.length) out.push(`debugState.groups lacks ${lack.join(', ')}`);
        for (const [gid, v] of Object.entries(d.groups)) for (const f of ['spawned', 'alive', 'awake', 'holding', 'triggered']) if (!v || !(f in v)) { out.push(`debugState.groups.${gid}.${f} missing`); break; }
      }
      if (d.t && typeof d.t === 'object' && d.beats?.includes('l6_start') && d.t.l6_start === undefined) out.push('debugState.t has no l6_start (t = first script time of each beat)');
      if (d.t && d.phaseApplied && d.t[`phase:${d.phaseApplied}`] === undefined) out.push(`debugState.t has no phase:${d.phaseApplied} (t keeps phase:<id>)`);
    }
    if (Array.isArray(s.lineLog)) for (const l of s.lineLog.slice(0, 20)) {
      if (typeof l.t !== 'number' || !('said' in l)) { out.push(`lineLog entry without t / said: ${JSON.stringify(l).slice(0, 120)}`); break; }
      if (l.said && (typeof l.dur !== 'number' || !('end' in l))) { out.push(`lineLog ${l.said}: no dur / end (H5)`); break; }
    }
    if (s.rules && typeof s.rules === 'object') {
      const bad = Object.entries(s.rules).filter(([, v]) => !v || typeof v !== 'object' || !('when' in v)).map(([k]) => k);
      if (bad.length) out.push(`rules entries without \`when\` (H6): ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? ` (+${bad.length - 8})` : ''}`);
    }
    const call = (name, f) => { if (typeof s[name] !== 'function') return; try { f(s[name]()); } catch (e) { out.push(`${name}() throws: ${e.message}`); } };
    call('worldState', (w) => {
      if (!w || typeof w !== 'object') { out.push('worldState() is not an object'); return; }
      for (const f of WSF) if (!(f in w)) out.push(`worldState().${f} missing`);
      if (w.hatches && !('vault' in w.hatches && 'he' in w.hatches)) out.push('worldState().hatches wants { vault, he }');
      if (w.doors && typeof w.doors === 'object') { const any = Object.values(w.doors)[0]; if (any && !('open' in any && 'locked' in any && 'status' in any)) out.push('worldState().doors[id] wants { open, locked, status }'); }
      if (w.torch !== undefined && typeof w.torch !== 'number') out.push('worldState().torch wants a number');
      if (w.lights !== undefined && (typeof w.lights !== 'object' || Array.isArray(w.lights))) out.push('worldState().lights wants Record<group, boolean>');
    });
    call('soldiers', (r) => { if (!Array.isArray(r)) out.push('soldiers() is not an array'); else if (r[0]) for (const f of SOLF) if (!(f in r[0])) out.push(`soldiers()[].${f} missing`); });
    call('audioLog', (r) => { if (!Array.isArray(r)) out.push('audioLog() is not an array'); else if (r[0] && !('id' in r[0] && 't' in r[0] && 'pos' in r[0])) out.push('audioLog()[] wants { id, t, pos }'); });
    call('wade', (r) => { if (!r || typeof r !== 'object') out.push('wade() is not an object'); else for (const f of ['depth', 'cap', 'canCrouch', 'canJump', 'canSprint', 'rescued']) if (!(f in r)) out.push(`wade().${f} missing`); });
    call('lockers', (r) => { if (!r || typeof r !== 'object') out.push('lockers() is not an object'); else for (const k of ['e', 'w', 'n']) if (!r[k] || typeof r[k].armed !== 'boolean') out.push(`lockers().${k}.armed missing`); });
    call('boss', (r) => { if (r === null) return; if (!r || typeof r !== 'object' || !r.parts) { out.push('boss() wants null or { parts, … }'); return; } for (const k of PARTS) { const p = r.parts[k]; if (!p || typeof p.hp !== 'number' || !Array.isArray(p.pos) || typeof p.mult !== 'number') { out.push(`boss().parts.${k} wants { hp, pos: [x,y,z], mult }`); break; } } });
    if (typeof s.fire === 'function') { try { const r = s.fire('__contract_probe__'); if (r !== null && r !== undefined && r !== false) out.push(`fire('<unknown>') returned ${JSON.stringify(r)} (want null)`); } catch (e) { out.push(`fire('<unknown>') throws: ${e.message}`); } }
    if (typeof s.keypad === 'function') { try { const r = s.keypad('0000'); if (r !== false) out.push(`keypad() returned ${JSON.stringify(r)} (H10: false in 3d)`); } catch (e) { out.push(`keypad() throws: ${e.message}`); } }
    if (typeof s.grip === 'function') { try { const r = s.grip('__contract_probe__', 'abandon'); if (r && r !== false) out.push(`grip('<no such grip>', 'abandon') returned ${JSON.stringify(r)} (want falsy)`); } catch (e) { out.push(`grip() throws: ${e.message}`); } }
    return out;
  }, [DS_FIELDS, DS_SUB, BOSS_SUB, WS_FIELDS, SOLDIER_FIELDS, PARTS, Object.keys(GROUPS6)]);
  const shapeBad = Array.isArray(shape) ? shape : [`shape probe failed: ${shape?.__err}`];
  // markers: inside a room (stand ones inside an interior with the inset); cover inside rooms; requireRegion on the frame
  const lv = await evs(([stand, wall, FRAME]) => {
    const S = window.__S6, g = window.__game, out = [];
    for (const m of [...stand, ...wall]) {
      const p = S.mk(m); if (!p) continue;
      const inset = stand.includes(m) ? 0.3 : -0.2;
      if (!S.interior(p[0], p[2], inset, p[1])) out.push(`mkpos:${m} at (${p.map((v) => v.toFixed(2))}) not inside a room${inset > 0 ? ' interior (0.3 m inset)' : ''} (roomAt ${S.roomOf(p[0], p[1], p[2]) ?? '—'})`);
    }
    const c = g.level.cover ?? [];
    if (c.length !== 75) out.push(`cover:level.cover has ${c.length} points (want 75, §5.4)`);
    for (const x of c) { if (!S.interior(x.position.x, x.position.z, 0.15, x.position.y)) out.push(`cover:${x.id} not inside a room interior`); if (typeof x.enabled !== 'boolean') out.push(`cover:${x.id}.enabled not boolean`); }
    for (const id of FRAME) { const i = g.interactables.get(id); if (i && i.requireRegion !== 't6_cage') out.push(`use:${id}.requireRegion = ${i.requireRegion} (want 't6_cage', S8g)`); }
    const reg = g.level.regions?.t6_cage; if (FRAME.some((id) => g.interactables.get(id)) && !(Array.isArray(reg) && reg.length)) out.push("region:t6_cage missing (the frame's requireRegion — level.regions['t6_cage'])");
    if (g.level.dock && (g.level.dock.slots?.length ?? 0) !== 6) out.push(`dock:Level.dock.slots ${g.level.dock.slots?.length} (want 6)`);
    return out;
  }, [MARKERS_STAND, MARKERS_WALL, FRAME_USES]);
  const lvBad = Array.isArray(lv) ? lv : [`level probe failed: ${lv?.__err}`];
  const d = await dbg();
  const mm = Array.isArray(d.missingMarkers) ? d.missingMarkers : [];
  let vigMissing = [];
  if (full) vigMissing = await probeVignettes();
  const voice = [];
  if (!LINES_JSON) voice.push(`${LINES_FILE} missing`);
  else { const ids = LINES_JSON.map((l) => l.id); const mi = PLAN_LINES.filter((i) => !ids.includes(i)); if (mi.length) voice.push(`lines.l6.json lacks ${mi.length} of §6.2: ${mi.join(', ')}`); }
  const noMan = PLAN_LINES.filter((i) => !MANIFEST[i]); if (noMan.length) voice.push(`manifest lacks ${noMan.length} l6_ lines: ${noMan.slice(0, 10).join(', ')}${noMan.length > 10 ? '…' : ''}`);
  const all = [...miss, ...shapeBad.map((x) => `shape:${x}`), ...lvBad, ...mm.map((x) => `mkstory:${x}`), ...vigMissing.map((x) => `vig:${x}`), ...voice.map((x) => `voice:${x}`)];
  const by = {};
  for (const m of all) {
    const k = m.split(':')[0];
    const o = ['mkpos', 'cover', 'mkstory'].includes(k) ? 'W4a' : k === 'dock' ? 'W4b' : ownerOf(m);
    (by[o] ??= []).push(m.replace(/^(shape|mkpos|mkstory|cover|voice|dock):/, ''));
  }
  const ORDER = ['ST-a', 'ST-b', 'W4a', 'W4b', 'W3b', 'W1', 'W2a', 'W2b', 'W7', 'W9', 'D1', 'D2', 'D3a', 'D3b', 'D*'];
  for (const o of [...ORDER, ...Object.keys(by).filter((k) => !ORDER.includes(k))]) if (by[o]) bad(`MISSING / WRONG — owner ${o} (${by[o].length}):\n      ${by[o].join('\n      ')}`, suspectOf(o));
  if (!all.length) console.log('  ok every hook, field, shape and id of the contract exists');
  return all;
}
/** Every level vignette on a fresh page: `vignette('<id>:snap')` warns "unknown id" (missing) or "registered without
 *  one" (no snap — a failure only where §5.7 / §7 needs one). */
async function probeVignettes() {
  const c2 = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const p2 = await c2.newPage();
  const warns = [];
  p2.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text()); });
  const out = [];
  try {
    await p2.goto(`${base}/?level=6&autostart=1&nostory=1&noenemies=1`, { waitUntil: 'load', timeout: 60000 });
    await p2.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
    for (const [id, needSnap] of Object.values(VIGNETTES6).flat()) {
      const n = warns.length;
      await p2.evaluate((id) => window.__game.level.vignette(`${id}:snap`), id).catch(() => {});
      await p2.waitForTimeout(30);
      const w = warns.slice(n).find((x) => x.includes(id));
      if (w && /unknown id/.test(w)) out.push(`${id}: not registered by the level`);
      else if (w && /without one/.test(w) && needSnap) out.push(`${id}: registered without a :snap (§5.7 / §7 restore needs one)`);
      else if (w && /failed/.test(w)) out.push(`${id}:snap threw: ${w.slice(0, 120)}`);
    }
  } catch (e) { out.push(`probe page failed: ${e.message}`); }
  await c2.close().catch(() => {});
  return out;
}
/** Static pass (all modes): lines ↔ RULES ↔ manifest, pairs, unit uppercase, soldier label + throat, kessler / sunde
 *  radio, aas phone, the two cuts, "Aas" never spoken. */
async function staticPass() {
  console.log('── static: lines.l6.json ↔ RULES ↔ manifest (§10.1 all modes)');
  if (!LINES_JSON) { bad(`${LINES_FILE} missing — static pass not possible`, 'voices'); return; }
  const ids = LINES_JSON.map((l) => l.id);
  const notPlan = ids.filter((i) => !PLAN_LINES.includes(i)), notFile = PLAN_LINES.filter((i) => !ids.includes(i));
  ok(!notPlan.length && !notFile.length, `lines = §6.2 (${ids.length} in the file, ${PLAN_LINES.length} in the plan)${notPlan.length ? ' — extra ' + notPlan.join(', ') : ''}${notFile.length ? ' — missing ' + notFile.join(', ') : ''}`, 'voices');
  const man = Object.keys(MANIFEST).filter((k) => k.startsWith('l6_'));
  const noMan = ids.filter((i) => !MANIFEST[i]), extraMan = man.filter((i) => !ids.includes(i));
  ok(!noMan.length && !extraMan.length, `manifest = lines${noMan.length ? ' — missing ' + noMan.slice(0, 8).join(', ') : ''}${extraMan.length ? ' — extra ' + extraMan.join(', ') : ''}`, 'voices');
  const rules = await evs(() => { const r = window.__game.story.rules; return r && typeof r === 'object' ? Object.keys(r) : null; });
  if (!Array.isArray(rules) || !rules.length) bad('story.rules (H6) missing or empty — RULES ↔ lines not checkable', 'story');
  else {
    const l6r = rules.filter((k) => k.startsWith('l6_'));
    const noRule = ids.filter((i) => !l6r.includes(i)), extra = l6r.filter((i) => !ids.includes(i));
    ok(!noRule.length, `every line has a RULES entry${noRule.length ? ' — missing: ' + noRule.join(', ') : ''}`, 'story');
    ok(!extra.length, `no RULES entry without a line${extra.length ? ' — ' + extra.join(', ') : ''}`, 'story');
    const barks = REUSED_BARKS.filter((i) => !rules.includes(i));
    ok(!barks.length, `the reused 3c barks are in RULES6 (§6.2)${barks.length ? ' — missing ' + barks.join(', ') : ''}`, 'story');
  }
  const unpaired = PAIRS6.filter((p) => !ids.includes(`${p}_stop`) || !ids.includes(`${p}_command`));
  ok(!unpaired.length, `choice pairs complete (${PAIRS6.length})${unpaired.length ? ' — ' + unpaired.join(', ') : ''}`, 'voices');
  const spoken = (l) => String(l.spoken ?? l.text ?? '');
  const upper = LINES_JSON.filter((l) => l.speaker === 'unit' && /\b[A-Z]{2,}\b/.test(spoken(l))).map((l) => l.id);
  ok(!upper.length, `no uppercase in a unit line's spoken text${upper.length ? ' — ' + upper.join(', ') : ''}`, 'voices');
  const sol = LINES_JSON.filter((l) => l.speaker === 'soldier' && (!l.label || l.fx !== 'throat')).map((l) => `${l.id} (label ${l.label}, fx ${l.fx})`);
  ok(!sol.length, `every soldier line has a label and fx throat${sol.length ? ' — ' + sol.join(', ') : ''}`, 'voices');
  const rad = LINES_JSON.filter((l) => ['kessler', 'sunde'].includes(l.speaker) && !/^radio\b/.test(String(l.fx ?? ''))).map((l) => `${l.id} (${l.fx})`);
  ok(!rad.length, `every kessler / sunde line has fx radio${rad.length ? ' — ' + rad.join(', ') : ''}`, 'voices');
  const ph = LINES_JSON.filter((l) => l.speaker === 'aas' && l.fx !== 'phone').map((l) => `${l.id} (${l.fx})`);
  ok(!ph.length, `every aas line has fx phone${ph.length ? ' — ' + ph.join(', ') : ''}`, 'voices');
  for (const id of ['l6_kes_he_3', 'l6_aas_3']) {
    const cut = LINES_JSON.find((l) => l.id === id)?.cut, dur = MANIFEST[id]?.duration;
    ok(typeof cut === 'number' && (!dur || cut < dur), `${id} cut ${cut} inside the file (${dur ?? '?'} s; file time incl. lead)`, 'voices');
  }
  const aas = LINES_JSON.filter((l) => /\baas\b/i.test(spoken(l))).map((l) => l.id);
  ok(!aas.length, `"Aas" spoken nowhere (D29: "Oss")${aas.length ? ' — ' + aas.join(', ') : ''}`, 'voices');
}

// ───────────────────────────────────────────────────────────── segments
let routeBroken = null, skipped = [];
async function seg(name, needs, fn) {
  if (routeBroken) { skipped.push(name); console.log(`  -- ${name}: skipped (route broken at "${routeBroken}")`); return false; }
  const miss = await missingOf(needs);
  if (miss.length) {
    const by = {}; for (const m of miss) (by[ownerOf(m)] ??= []).push(m);
    bad(`${name}: SKIPPED — needs ${Object.entries(by).map(([o, m]) => `${o}: ${m.join(', ')}`).join(' · ')}`, suspectOf(Object.keys(by)[0]));
    routeBroken = name; return false;
  }
  console.log(`── ${name}`);
  try {
    const r = await fn();
    if (r === false) { routeBroken = name; bad(`${name}: did not reach its exit — later segments skipped`, 'story'); return false; }
  } catch (e) { routeBroken = name; bad(`${name}: threw ${e.message}`, 'test'); return false; }
  return true;
}
async function runChecks(label) {
  if (skipped.length) bad(`${label}: ${skipped.length} segments not run after the break at "${routeBroken}": ${skipped.join(' · ')}`, 'test');
  skipped = [];
  const l = await L6().catch(() => null); if (!l) return bad(`${label}: watcher unreadable`, 'test');
  ok(!l.early.length, `${label}: R4 — no enemy before its beat (${l.early})`, 'story');
  const pop = l.spawns.filter((s) => s.seen && !s.opened);
  ok(!pop.length, `${label}: spawn visibility — nobody appears in view (watcher) ${JSON.stringify(pop).slice(0, 300)}`, 'level');
  const d = await dbg();
  const popS = (d.spawnLog ?? []).filter((s) => s.visible);
  ok(!popS.length, `${label}: spawn visibility — H7.spawnLog has no visible spawn ${JSON.stringify(popS).slice(0, 200)}`, 'story');
  ok(!l.cutBad.length, `${label}: never 'cutscene' outside E1 / E2 (${l.cutBad})`, 'story');
  ok(l.maxHostiles <= 6, `${label}: ≤ 6 non-loader hostiles in pool6 + shaft6 at any time (max ${l.maxHostiles})`, 'story');
  const log = await ev(() => (window.__game.story.lineLog ?? []).filter((x) => x.said)).catch(() => []);
  const timed = log.filter((x) => typeof x.cue === 'number'), late = timed.filter((x) => Math.abs(x.t - x.cue) > 0.12);
  ok(!late.length, `${label}: every timed line ≤ 0.12 s from its cue (${timed.length} timed of ${log.length}) ${late.map((x) => `${x.said} ${f2(x.t - x.cue)}`).join(', ')}`, 'story');
  if (log.length && !timed.length) bad(`${label}: no lineLog entry carries a cue (H5)`, 'story');
  const noDur = [...new Set(log.filter((x) => typeof x.dur !== 'number' || typeof x.end !== 'number').map((x) => x.said))];
  if (log.length) ok(!noDur.length, `${label}: every spoken line logs dur + end (H5) ${noDur.slice(0, 6)}`, 'story');
  for (const s of l.softLocks) bad(`${label}: SOFT-LOCK ${JSON.stringify(s)}`, 'story');
  for (const r of l.rescued) bad(`${label}: the deep-water rescue fired (a bug fail-safe, D12): ${JSON.stringify(r)}`, 'level');
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
async function touchPickup(id) {
  const p = await ev((id) => { const x = window.__game.level.pickupSpawns.find((q) => q.id === id); return x ? [x.position.x, x.position.y, x.position.z] : null; }, id);
  if (!p) return bad(`pickup ${id} missing`, 'level');
  const s = await S6('spot', 'use', id, { dist: 0.6 }).catch(() => null);
  const sp = s && !s.err ? s : await ev((p) => { const S = window.__S6; const fy = S.floors(p[0], p[2]).filter((y) => y <= p[1] + 0.2).sort((a, b) => b - a)[0] ?? 0; const r = S.search(p[0], p[2], fy, null, { maxR: 1.2 }); return r ? { x: r[0], y: r[1], z: r[2], yaw: 0, pitch: 0 } : null; }, p);
  if (!sp) return bad(`pickup ${id}: no free stand point within 1.2 m (reachable? check:reach use list)`, 'level');
  await S6('tp', sp, false);
  const taken = await untilG(`(g.player.snapshot().pickups ?? []).includes(${JSON.stringify(id)})`, 2, `pickup ${id} collected on touch`, 'level', { quiet: true });
  if (!taken) note(`pickup ${id} not collected from (${[sp.x, sp.y, sp.z].map(f2)}) — touch radius vs stand point`);
  return taken;
}
/** Walk (real movement) along the nav path to `p` (feet); fails naming where it stuck. */
async function walkTo(p, gs = 30, { sprint = true, tol = 0.6 } = {}) {
  const from = await ev(() => window.__game.player.position.toArray());
  const path = await S6('path', from, p).catch(() => null);
  if (!path) return bad(`walk to (${p.map(f2)}): no nav path from (${from.map(f2)})`, 'level');
  await S6('walk', path, { sprint, tol });
  const done = await untilG('S.walkState()?.done', gs, `walk to (${p.map(f2)})`, 'test', { quiet: true });
  const st = await S6('walkState');
  await S6('walkStop');
  if (!done || !st?.ok) return bad(`walk to (${p.map(f2)}): ${st?.why ?? 'not there in ' + gs + ' s of game time'}`, 'level');
  return true;
}

// ───────────────────────────────────────────────────────────── the route's segments (§4, in order)
const H = (...h) => h.map((x) => `hook:${x}`);
const DSN = (...k) => k.map((x) => `ds:${x}`);
const N = {
  base: [...H('end', 'checkpoint', 'lineLog', 'fire', 'grip', 'worldState'), ...DSN('now', 'beats', 't', 'phaseApplied', 'flags', 'checkpoints', 'groups', 'keys', 'grip')],
  arrival: ['door:d6_tube', 'trig:t6_lock', 'room:lock6', 'screen:tube_panel6', 'mk:mk6_tube_panel'],
  latch: ['trig:t6_tube', 'door:d6_tube', 'room:tun6_a'],
  crossing: ['trig:t6_tun_mid', 'group:g6_tun_s', 'group:g6_tun_u', 'mk:mk6_cross_0', 'mk:mk6_cross_1', 'enemies:patrol', 'enemies:release', 'enemies:rush'],
  rep: ['trig:t6_rep', 'trig:t6_rep_in', 'room:rep6', 'group:g6_rep_s', 'group:g6_rep_u', 'group:g6_rep_k', 'door:d6_bay'],
  tunb: ['trig:t6_tunb', 'trig:t6_tunb_dark', 'trig:t6_tunb_sentry', 'group:g6_tunb_s', 'group:g6_tunb_k', 'mk:mk6_tunb_hold', 'door:d6_he', 'enemies:holding'],
  he: ['trig:t6_he', 'room:he6', 'use:he6_switch', 'screen:mimic6', 'mk:mk6_switch'],
  handset: ['trig:t6_phone', 'use:he6_phone', 'mk:mk6_handset', 'vig:v6_handset'],
  queue: ['use:note6_queue'],
  crank: ['use:he6_switch', 'player:grip', 'group:g6_he', 'door:d6_hold', 'room:hold6'],
  vault: ['trig:t6_vault', 'room:vault6', 'use:vault6_lock', 'use:vault6_loom', 'screen:bj6', 'vig:bj6_open', 'vig:bj6_rip'],
  f5: ['group:g6_vault', 'group:g6_vault_k'],
  shaftOpen: ['use:shaft6_lock', 'door:d6_shaft', 'room:shaft6', 'group:g6_loader', 'hook:boss'],
  shaft: ['trig:t6_shaft_l1', 'trig:t6_shaft_bot', 'group:g6_shaft', 'vig:v6_shaft_lights', 'light:shaft6', 'light:shaft6_emerg'],
  reveal: ['trig:t6_reveal', 'room:pool6', 'door:d6_pool', 'mk:mk6_reveal', 'screen:dock_board', 'vig:v6_well_eyes', 'ds:boss', 'enemies:boss'],
  hostile: ['group:g6_w1', 'door:d6_stores', 'room:stores6'],
  frame: ['trig:t6_cage', 'region:t6_cage', 'use:frame6_pin', 'use:frame6_pump', 'use:frame6_lever', 'screen:gauge6', 'group:g6_w2', 'group:g6_w3', 'ds:frame', 'vig:lights_out6'],
  kill: ['hook:boss', 'ds:boss'],
  quiet: ['use:console6', 'trig:t6_console'],
  ending: ['use:console6', 'trig:t6_console', 'mk:mk6_end_cam0', 'mk:mk6_end_cam1', 'mk:mk6_end_screen', 'ds:ending', 'screen:console6'],
};
const opt = {};

async function segBoot(expect = { choice: 'stop' }) {
  const s = await ev(() => { const g = window.__game, p = g.player; let d = {}; try { d = g.story.debugState ?? {}; } catch { /* */ } return { level: g.levelId, state: g.state, w: Object.fromEntries(Object.entries(p.weapons).map(([k, v]) => [k, [!!v.owned, v.clip, v.reserve]])), hp: p.health, armor: p.armor, fl: p.flashlightOn, torch: p.flashlightCharge ?? null, facts: { ...g.facts }, loadout: d.loadout ?? null, killY: [g.level.killY, g.physics.killY] }; });
  ok(s.level === 6 && ['playing', 'loading'].includes(s.state), `level 6 running (${s.level}, ${s.state})`, 'story');
  // §7.2 direct start: pistol 12 + 24 → 12/36, shotgun 6 + 6 → 6/12, carbine 30 + 90 → 30/120
  const w = s.w, want = { pistol: [true, 12, 36], shotgun: [true, 6, 12], carbine: [true, 30, 120] };
  const wBad = Object.entries(want).filter(([k, v]) => JSON.stringify(w[k]) !== JSON.stringify(v)).map(([k, v]) => `${k} ${JSON.stringify(w[k])}≠${JSON.stringify(v)}`);
  ok(s.loadout === 'direct' && !wBad.length && s.hp === 100 && s.armor === 50 && s.fl, `direct loadout: weapons ${wBad.length ? wBad.join(', ') : 'ok'}, health ${s.hp}, armour ${s.armor} (50), flashlight ${s.fl}, loadout ${s.loadout}`, 'story');
  if (s.torch !== null) ok(s.torch >= 0.85, `a new level starts with a full cell (${f2(s.torch)} after the card)`, 'story');
  const f = s.facts;
  ok(f.unitsLeft === 28 && f.badge === true && f.halvorsenAlive === true && f.testHour === 62.75 && f.radio === true && f.kessler === true && f.l5_door === true && f.l5_boat === false && f.choice === expect.choice,
    `direct facts (§7.2) ${JSON.stringify(f)}`, 'story');
  ok(s.killY[0] === -36 && s.killY[1] === -36, `kill height −36 (level ${s.killY[0]}, physics ${s.killY[1]}; B6)`, 'level');
}
async function segArrival() {
  await beatWait('l6_start', 6);
  await untilG('L.phaseAt.A !== undefined', 2, 'phase A applied');
  await checkDoors('A');
  await objectiveSeen(OBJ.start, 4);
  ok(/HEAD-END TUBE — CYCLING/.test(await screenText('tube_panel6') ?? ''), 'tube_panel6: HEAD-END TUBE — CYCLING', 'story');
  await film('tube', 'd.phaseApplied === "T"', 6);
  if (!await phaseWait('T', 6, 'd6_tube opens at 3.0 s, phase T at 3.9 s')) return false;
  const d = await dbg(), l = await L6();
  const st = d.t?.l6_start, pt = d.t?.['phase:T'], op = l.opened.d6_tube?.[0]?.s;
  ok(near(pt - st, 3.9, 0.15), `phase T at start + 3.9 ± 0.15 (${f2(pt - st)})`, 'story');
  ok(near(op - st, 3.0, 0.15), `d6_tube opens at start + 3.0 ± 0.15 (${f2(op - st)})`, 'story');
  const k1 = await lineOf('l6_kes_start');
  ok(k1 && near(k1.t - st, 0.6), `l6_kes_start at start + 0.6 (${k1 ? f2(k1.t - st) : 'not said'})`, 'story');
  const u = await lineOf('l6_unit_tube');
  ok(u && near(u.t - op, 0, 0.15), `l6_unit_tube with the door (${u ? f2(u.t - op) : 'not said'})`, 'story');
  await checkDoors('T');
  await cpWait('cp6_start', 2, 'A → T');
}
async function segLatch({ doorway = false } = {}) {
  if (doorway) {   // softlock (b): stand in the tube doorway when the latch arms → it must not latch
    if (!await stand('trig', 't6_tube', { fz: 0.8 })) return false;
    const ran = await untilG('(L.closing.d6_tube ?? []).length > 0 && (() => { const d = g.level.door("d6_tube"); g.player.teleport(d.position.clone().setY(d.y ?? 0), 0, 0); return true; })()', 6, 'd6_tube starts closing (latch armed)');
    if (!ran) return false;
    await gameWait(3.0);
    const st = await ev(() => ({ locked: window.__game.level.door('d6_tube').locked, ph: window.__game.story.debugState.phaseApplied, panel: window.__game.level.screen('tube_panel6')?.userData?.screenText ?? '' }));
    ok(!st.locked && st.ph !== 'U', `latch with the player in the tube doorway: not latched (locked ${st.locked}, phase ${st.ph})`, 'story');
    ok(/CLEAR THE TUBE/.test(st.panel), `panel CLEAR THE TUBE (${st.panel.slice(0, 40)})`, 'story');
    ok(await untilG('g.level.door("d6_tube").isOpen', 4, 'the tube reopens', 'level', { quiet: true }), 'the tube reopens and re-arms', 'story');
  }
  if (!await stand('trig', 't6_tube', { fz: 0.3 })) return false;
  if (!await phaseWait('U', 8, 'tube latch: t6_tube → closeBehind(z < −0.6)')) return false;
  ok(await untilG('g.level.door("d6_tube").locked', 3, 'd6_tube latched', 'level', { quiet: true }), 'd6_tube locked (latched)', 'story');
  await checkDoors('U');
  if (await heardWait('l6_kes_start_2', 8, 'story', 'C: tube latched')) {
    await heardWait(`l6_choir_start_${opt.choice}`, 10);
    await gapAfter('l6_kes_start_2', `l6_choir_start_${opt.choice}`, 0.6);
  }
}
async function segCrossing({ runPast = false } = {}) {
  if (runPast) {   // §9 #3: past z −70 before the spawn cancels F1 for good
    if (!await stand('trig', 't6_tun_end', { fz: 0.6 })) return false;
    await gameWait(3);
    const d = await dbg();
    ok(!(await S6('alive', 'g6_tun_s')).length && !d.groups?.g6_tun_s?.spawned && !!d.flags?.f1Cancelled, `F1 cancelled (spawned ${d.groups?.g6_tun_s?.spawned}, f1Cancelled ${d.flags?.f1Cancelled})`, 'story');
    return true;
  }
  // stand mid-tunnel looking south (yaw 0 = −z): the crossing at the mouth, ≥ 40 m off
  if (!await stand('trig', 't6_tun_mid', { fz: 0.7, yaw: 0, pitch: 0 })) return false;
  if (!await beatWait('l6_crossing', 4, 'first t6_tun_mid in U, calm, z > −40')) return false;
  await spawnedWait('g6_tun_s', 2);
  ok(await untilG('(d.scares ?? []).includes("v6_crossing")', 2, 'v6_crossing', 'story', { quiet: true }), 'v6_crossing fired (player z > −40)', 'story');
  await film('crossing', 'd.flags?.f1Free', 10);
  if (!await flagWait('f1Free', 14, 'released: crossing end + 2.0 s')) return false;
  const l = await L6();
  ok(l.cross.seen >= 2 && (l.cross.minDist ?? 0) >= 40, `the crossing seen ≥ 40 m away for ≥ 2 s (${f2(l.cross.seen)} s, nearest ${f2(l.cross.minDist)} m)`, 'level');
  await untilG('d.t?.["vignette:tun6_far_out"] !== undefined', 2, 'tun6_far_out with the release', 'story', { quiet: true });
  await heardWait('l6_kes_contact_a', 6);
  // kill one soldier → g6_tun_u spawns (cover + 6 s, or one dead)
  const s = await S6('alive', 'g6_tun_s');
  if (s[0]) await ev((id) => { const g = window.__game, e = g.enemies.all.find((x) => x.id === id), V = g.player.position.constructor; for (let k = 0; k < 10 && e?.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone().setY(e.position.y + 1.2), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1)); }, s[0].id);
  if (!await spawnedWait('g6_tun_u', 8, 'both in cover + 6 s, or one dead')) return false;
  await killUntil('!S.alive("g6_tun_s").length && !S.alive("g6_tun_u").length', 25, 'F1 dead', ['g6_tun_s', 'g6_tun_u']);
  await cpWait('cp6_tunnel', 6, 'F1 dead + 1.5 s, calm');
  await heardWait('l6_kes_tun_done', 6);
}
async function segRep() {
  if (opt.reads) { if (await stand('use', 'note6_jobcard')) { await use('note6_jobcard'); await gameWait(0.6); await closeNote(); } }
  if (!await stand('trig', 't6_rep', { fz: 0.95 })) return false;
  await heardWait('l6_kes_rep', 6);
  if (opt.tent) { await stand('use', 'note6_jobcard', { dist: 3 }); await untilG('(d.scares ?? []).includes("v6_tent")', 5, 'v6_tent (the tent in view ≤ 8 m 0.5 s)', 'story', { quiet: true }); }
  if (!await stand('trig', 't6_rep_in', { fz: 0.5 })) return false;
  if (!await beatWait('l6_rep', 4, 'first t6_rep_in')) return false;
  await phaseWait('B', 2);
  const d = await dbg(), l = await L6();
  const op = l.opened.d6_bay?.[0]?.s;
  ok(near(op - d.t?.l6_rep, 0.4, 0.15), `d6_bay opens at l6_rep + 0.4 (${f2(op - d.t?.l6_rep)})`, 'story');
  await checkDoors('B');
  for (const gname of ['g6_rep_s', 'g6_rep_u', 'g6_rep_k']) await spawnedWait(gname, 3);
  await heardWait('l6_kes_contact_rep', 6);
  await killUntil('!["g6_rep_s","g6_rep_u","g6_rep_k"].some((x) => S.alive(x).length)', 30, 'F2 dead', ['g6_rep_s', 'g6_rep_u', 'g6_rep_k']);
  await cpWait('cp6_rep', 6, 'F2 dead + 1.5 s, calm');
  if (opt.bay) { await stand('room', 'bay6'); for (const p of ['p6_bay_plate', 'p6_bay_ammo']) await touchPickup(p); }
}
async function segTunB({ killFrom60 = false } = {}) {
  if (!await stand('trig', 't6_tunb', { fz: 0.98, yaw: 0 })) return false;
  await heardWait('l6_kes_tunb', 6);
  if (!await stand('trig', 't6_tunb_dark', { fz: 0.93, yaw: 0 })) return false;
  if (!await spawnedWait('g6_tunb_s', 3, 'first t6_tunb_dark')) return false;
  await film('tunb_walkout', 'd.groups?.g6_tunb_s?.holding > 0', 12);
  // he walks out through d6_he on patrol to mk6_tunb_hold and holds; the door closes behind him
  if (!await untilG('d.groups?.g6_tunb_s?.holding > 0', 15, 'g6_tunb_s holds at mk6_tunb_hold (patrol, end hold)', 'enemies')) return false;
  const [s] = await S6('alive', 'g6_tunb_s'), hold = await S6('mk', 'mk6_tunb_hold');
  ok(s && hold && Math.hypot(s.pos[0] - hold[0], s.pos[2] - hold[2]) <= 0.8, `F3 holds at mk6_tunb_hold (${s?.pos})`, 'enemies');
  ok(await untilG('!g.level.door("d6_he").isOpen', 6, 'd6_he shut behind him', 'level', { quiet: true }), 'd6_he closes behind him', 'level');
  await heardWait(`l6_choir_dark_${opt.choice}`, 4);
  if (killFrom60) {   // impatient: kill F3 from 60 m (aimed carbine, debug aim-lock on his chest)
    const p = await ev(([s]) => { const S = window.__S6; return S.search(12, s.pos[2] + 60, 0, null, { maxR: 2 }); }, [s]);
    if (p) await S6('tp', { x: p[0], y: p[1], z: p[2], yaw: 0, pitch: 0 });
    await ev(() => { const g = window.__game; g.player.debug.switchTo('carbine'); g.player.debug.aim(true); });
    const chest = [s.pos[0], s.pos[1] + 1.3, s.pos[2]];
    await ev((c) => window.__game.player.debug.aimLock(c[0], c[1], c[2]), chest);
    await fireAt(chest, 10);
    await ev(() => { const g = window.__game; g.player.debug.aimLock(null); g.player.debug.aim(false); });
    ok(await untilG('!S.alive("g6_tunb_s").length', 20, 'F3 dead from 60 m', 'enemies', { quiet: true }) || !!(await dbg()).flags?.f3Free, 'F3 killed / released by fire from 60 m', 'story');
  } else {
    // approach to within 30 m → released
    const p = await ev(([s]) => window.__S6.search(12, s.pos[2] + 26, 0, null, { maxR: 2 }), [s]);
    if (p) await S6('tp', { x: p[0], y: p[1], z: p[2], yaw: 0, pitch: 0 });
    await flagWait('f3Free', 4, 'the player within 30 m');
  }
  await killUntil('!S.alive("g6_tunb_s").length', 20, 'F3 dead', ['g6_tunb_s']);
  // the sentry: woken by t6_tunb_sentry (or the release) → dead
  await stand('trig', 't6_tunb_sentry', { fz: 0.5, yaw: 0 });
  ok(await untilG('S.alive("g6_tunb_k").some((e) => e.state !== "dormant")', 4, 'g6_tunb_k woken', 'story', { quiet: true }), 'g6_tunb_k woken', 'story');
  await killUntil('!S.alive("g6_tunb_k").length', 15, 'the sentry dead', ['g6_tunb_k']);
}
async function segHeadEnd() {
  if (!await stand('trig', 't6_he', { fz: 0.95, look: await S6('mk', 'mk6_switch') })) return false;
  await cpWait('cp6_he', 3, 'first t6_he, no awake hostile within 30 m');
  await heardWait('l6_kes_he_1', 4);
  await heardWait('l6_kes_he_2', 12);
  await gapAfter('l6_kes_he_1', 'l6_kes_he_2', 0.5);
  await heardWait('l6_reyes_he', 12); await gapAfter('l6_kes_he_2', 'l6_reyes_he', 0.6);
  await heardWait('l6_kes_he_3', 6); await gapAfter('l6_reyes_he', 'l6_kes_he_3', 0.4);
  await heardWait(`l6_choir_he_${opt.choice}`, 10);
  const h3 = await lineOf('l6_kes_he_3'), ch = await lineOf(`l6_choir_he_${opt.choice}`);
  ok(h3 && ch && near(ch.t - h3.end, -0.05, 0.12), `CHOIR at _he_3's cut − 0.05 (${h3 && ch ? f2(ch.t - h3.end) : '—'})`, 'story');
  await objectiveSeen(OBJ.switch, 6);
}
async function segHandset({ answer = true } = {}) {
  if (!await stand('trig', 't6_phone', { fz: 0.5 })) return false;
  if (!await untilG('(d.scares ?? []).includes("v6_handset")', 30, 'v6_handset (calm, feet in t6_phone)')) return false;
  await film('handset', null, 6);
  await heardWait('l6_aas_1', 6);
  if (answer) {
    if (!await stand('use', 'he6_phone')) return false;
    ok((await use('he6_phone')) === 'ok', 'he6_phone picked up', 'story');
    await heardWait('l6_aas_2', 6);
    const u = (await L6()).uses.he6_phone, a2 = await lineOf('l6_aas_2');
    ok(a2 && near(a2.t - u.s, 0.4, 0.15), `l6_aas_2 at the pick-up + 0.4 (${a2 ? f2(a2.t - u.s) : '—'})`, 'story');
    await heardWait('l6_reyes_aas', 8); await gapAfter('l6_aas_2', 'l6_reyes_aas', 0.5);
    await heardWait('l6_aas_3', 6); await gapAfter('l6_reyes_aas', 'l6_aas_3', 0.3);
    ok(await untilG('g.facts.aas === true || !!d.flags?.aas', 6, 'fact aas'), 'fact aas', 'story');
    await heardWait('l6_kes_aas', 6);
    const a3 = await lineOf('l6_aas_3'), ka = await lineOf('l6_kes_aas');
    if (a3 && ka) ok(near(ka.t - a3.end, 1.2, 0.15), `l6_kes_aas at _aas_3 end + 1.2 (${f2(ka.t - a3.end)})`, 'story');
  } else {
    // not picked up in 12 s → once more 25 s later, then disabled for good
    await untilG('(g.story.lineLog ?? []).filter((l) => l.said === "l6_aas_1").length >= 2', 45, 'l6_aas_1 a second time (12 s + 25 s)');
    ok(await untilG('!g.interactables.get("he6_phone")?.enabled', 20, 'he6_phone disabled for good', 'story', { quiet: true }), 'he6_phone disabled after the second try', 'story');
    ok(!(await dbg()).flags?.aas && (await ev(() => window.__game.facts.aas)) !== true, 'no fact aas when ignored', 'story');
  }
}
async function segQueue() {
  if (!await stand('use', 'note6_queue')) return false;
  ok((await use('note6_queue')) === 'ok', 'read note6_queue', 'level');
  await gameWait(0.8); await closeNote();
  ok(await untilG('g.facts.manifest === true || !!d.flags?.queue', 3, 'fact manifest'), 'fact manifest (queue read)', 'story');
  await heardWait('l6_reyes_queue', 6);
  await heardWait('l6_kes_queue', 8); await gapAfter('l6_reyes_queue', 'l6_kes_queue', 0.5);
  await heardWait(`l6_choir_queue_${opt.choice}`, 10); await gapAfter('l6_kes_queue', `l6_choir_queue_${opt.choice}`, 0.5);
}
async function segCrank({ inVault = false } = {}) {
  if (!await stand('use', 'he6_switch')) return false;
  await film('crank', 'd.flags?.manual', 6);
  if (!await grip('he6_switch', 3.3)) return false;
  if (!await flagWait('manual', 1.5, 'the crank done after a real 3.0 s hold')) return false;
  const l = await L6(), gl = l.gripLog.find((x) => x.id === 'he6_switch');
  ok(gl && gl.end !== undefined && gl.end - gl.start >= 2.9, `the crank took a real hold (${gl ? f2(gl.end - gl.start) : '—'} s ≥ 3.0)`, 'story');
  ok(await untilG('g.player.keys.has("key6_a")', 1, 'Key A'), 'Key A in the keys', 'story');
  await toastSeen('Key A — head-end mode', 2);
  await beatWait('l6_manual', 1);
  ok(/MANUAL/.test(await screenText('mimic6') ?? ''), `mimic6 MANUAL (${(await screenText('mimic6'))?.slice(0, 50)})`, 'story');
  await heardWait('l6_unit_manual', 3);
  await heardWait('l6_kes_manual', 8);
  await heardWait(`l6_choir_manual_${opt.choice}`, 10);
  await objectiveSeen(OBJ.bj, 6);
  // F4 at manual + 4.0, B_hold at + 0.4
  if (inVault) await stand('trig', 't6_vault', { fx: 0.6, fz: 0.5 });
  if (!await spawnedWait('g6_he', 6, 'manual + 4.0 s')) return false;
  const d = await dbg();
  ok(near(d.t?.['phase:B_hold'] - (d.t?.l6_manual ?? 0), 4.4, 0.2), `B_hold at manual + 4.4 (${f2(d.t?.['phase:B_hold'] - d.t?.l6_manual)})`, 'story');
  await checkDoors('B_hold');
  await heardWait(inVault ? 'l6_kes_he_contact_b' : 'l6_kes_he_contact', 6);
  if (opt.f4Hook) await opt.f4Hook();
  await killUntil('!S.alive("g6_he").length', 40, 'F4 dead', ['g6_he']);
  ok(await untilG('g.level.door("d6_hold").locked', 14, 'd6_hold latched back', 'story', { quiet: true }), 'd6_hold latched back (B)', 'story');
  if (!opt.skipManualCp) await cpWait('cp6_manual', 6, 'F4 dead + 1.5 s, calm');
}
async function segVault({ deny = false } = {}) {
  if (!await stand('trig', 't6_vault', { fx: 0.7, fz: 0.5 })) return false;
  await heardWait('l6_kes_vault', 6);
  if (opt.drum) { await stand('near', 'mk6_drum', { dist: 8 }); await look(await S6('mk', 'mk6_drum')); await untilG('(d.scares ?? []).includes("v6_drum")', 8, 'v6_drum', 'story', { quiet: true }); }
  if (!await stand('use', 'vault6_lock')) return false;
  if (deny) return true;
  ok((await use('vault6_lock')) === 'ok', 'vault6_lock pressed with Key A', 'story');
  if (!await flagWait('bjOpen', 2, 'the key turns (0.6 s) and is trapped')) return false;
  ok(await untilG('!g.player.keys.has("key6_a")', 1, 'Key A trapped'), 'Key A trapped (removeKey) with bjOpen in one action (B4)', 'story');
  await untilG('d.t?.["vignette:bj6_open"] !== undefined', 2, 'bj6_open', 'story', { quiet: true });
  ok(await untilG('g.interactables.get("vault6_loom")?.enabled', 3, 'the loom enabled'), 'vault6_loom enabled', 'story');
  await heardWait('l6_kes_bj', 6);
}
async function segPull() {
  if (!await stand('use', 'vault6_loom')) return false;
  await film('pull', 'd.flags?.pulled', 6);
  if (!await grip('vault6_loom', 3.3)) return false;
  if (!await flagWait('pulled', 1.5, 'the pull done after 3.0 s')) return false;
  ok(await untilG('g.player.keys.has("key6_b")', 1, 'Key B'), 'Key B in the keys', 'story');
  await toastSeen('Key B — moon pool', 2);
  await beatWait('l6_pulled', 1);
  const d = await dbg(), tp = d.t?.l6_pulled;
  ok(typeof d.launchAt === 'number' && near(d.launchAt - tp, 90, 0.3), `launchAt = pull + 90 s pending (${f2(d.launchAt - tp)})`, 'story');
  ok(/LOS/.test(await screenText('bj6') ?? '') && /LOS/.test(await screenText('mimic6') ?? ''), 'screens flip: TRUNK FIBRE — LOS', 'story');
  await heardWait('l6_unit_pull', 2);
  await heardWait('l6_kes_pull_1', 8); await gapAfter('l6_unit_pull', 'l6_kes_pull_1', 0.5);
  await heardWait('l6_kes_pull_2', 10); await gapAfter('l6_kes_pull_1', 'l6_kes_pull_2', 0.6);
  await heardWait(`l6_choir_pull_${opt.choice}`, 10);
  await objectiveSeen(OBJ.stair, 6);
  ok(await untilG('(d.scares ?? []).includes("v6_ring")', 6, 'v6_ring at pull + 4.0', 'story', { quiet: true }), 'v6_ring at the first fast ping', 'story');
  const ring = (await L6()).scares.find((x) => x.id === 'v6_ring');
  if (ring) ok(near(ring.t - tp, 4.0, 0.3), `v6_ring at pull + 4.0 (${f2(ring.t - tp)})`, 'story');
}
async function segF5({ inTrench = false } = {}) {
  if (inTrench) { await stand('trig', 't6_trench', { fx: 0.05, fz: 0.5, crouch: true }); }
  if (!await spawnedWait('g6_vault', 7, 'pull + 5.0 s')) return false;
  await spawnedWait('g6_vault_k', 2);
  const k = await S6('alive', 'g6_vault_k'), vent = await S6('mk', 'mk6_vent_vault');
  if (k.length && vent) { const fromVent = k.every((e) => Math.hypot(e.pos[0] - vent[0], e.pos[2] - vent[2]) < 2); ok(fromVent === inTrench, `F5 skitters from ${fromVent ? 'the vent' : 'the trench grilles'} (player ${inTrench ? 'in' : 'not in'} the trench)`, 'story'); }
  if (opt.trenchWait) { await gameWait(opt.trenchWait); ok(!(await dbg()).checkpoints?.includes('cp6_pulled'), 'no checkpoint while in the trench', 'story'); }
  await killUntil('!S.alive("g6_vault").length && !S.alive("g6_vault_k").length', 40, 'F5 dead', ['g6_vault', 'g6_vault_k']);
  if (inTrench) await stand('trig', 't6_vault', { fx: 0.7, fz: 0.5 });
  await cpWait('cp6_pulled', 6, 'F5 dead + 1.5 s, calm, not in the trench');
  // pings: the audio log's interval after the pull (20 → 4 s)
  const pings = (await L6()).audio.filter((a) => /^ping_(far|near)$/.test(a.id));
  const tp = (await dbg()).t?.l6_pulled ?? 0;
  const after = pings.filter((p) => p.s > tp + 1).map((p) => p.s), before = pings.filter((p) => p.s < tp).map((p) => p.s);
  const gap = (a) => (a.length >= 2 ? (a[a.length - 1] - a[0]) / (a.length - 1) : null);
  if (gap(after) !== null) ok(near(gap(after), 4, 0.5), `the ping every 4 s after the pull (${f2(gap(after))} over ${after.length})`, 'level');
  else bad(`no buoy pings in the audio log after the pull (${pings.length} total) — ping6 machine / H14`, 'level');
  if (gap(before) !== null) ok(near(gap(before), 20, 1.5), `the ping every 20 s before the pull (${f2(gap(before))})`, 'level');
}
async function segThud() {
  // v6_thud only within pull + 20 … + 90 s, calm, player in vault6 / he6, before Key B → launchAt = its time
  await stand('trig', 't6_vault', { fx: 0.7, fz: 0.5 });
  const tp = (await dbg()).t?.l6_pulled ?? 0;
  const fired = await untilG('(d.scares ?? []).includes("v6_thud")', Math.max(5, tp + 92 - ((await dbg()).now ?? 0)), 'v6_thud within pull + 90 s', 'story', { quiet: true });
  const th = (await L6()).scares.find((x) => x.id === 'v6_thud'), d = await dbg();
  if (fired && th) {
    ok(th.t - tp >= 20 && th.t - tp <= 90, `v6_thud at pull + ${f2(th.t - tp)} (20 … 90)`, 'story');
    ok(near(d.launchAt, th.t, 0.3), `launchAt = the thud (${f2(d.launchAt)} vs ${f2(th.t)})`, 'story');
    await heardWait('l6_kes_thud', 4);
  } else ok(near(d.launchAt - tp, 90, 0.3), `no thud → launchAt = pull + 90 (${f2(d.launchAt - tp)})`, 'story');
}
async function segShaftOpen() {
  if (!await stand('use', 'shaft6_lock', { room: 'vault6' })) return false;
  ok((await use('shaft6_lock')) === 'ok', 'shaft6_lock pressed with Key B', 'story');
  if (!await phaseWait('K', 3, 'Key B turns → phase K')) return false;
  ok(!await ev(() => window.__game.player.keys.has('key6_b')), 'Key B trapped (removeKey)', 'story');
  await beatWait('l6_shaft_open', 1);
  await checkDoors('K');
  await heardWait('l6_unit_shaft', 3);
  await objectiveSeen(OBJ.pool, 4);
  const b = await bossRow();
  ok(b && !b.__err && b.alive !== false && (b.mode === 'working' || b.mode === undefined), `the loader spawned when Key B turned, working (D31) (${b?.mode ?? JSON.stringify(b)})`, 'enemies');
}
async function segShaft({ lampEmpty = false } = {}) {
  if (!await stand('trig', 't6_shaft_l1', { fz: 0.3 })) return false;
  if (!await untilG('(d.scares ?? []).includes("v6_shaft_lights")', 4, 'v6_shaft_lights (first below y −2.5, calm; exempt from spacing)')) return false;
  await film('shaft_lights', null, 5);
  ok(await untilG('!(g.story.worldState?.()?.lights?.shaft6) && !!g.story.worldState?.()?.lights?.shaft6_emerg', 5, 'shaft6 out, shaft6_emerg on', 'story', { quiet: true }), 'the landing lamps die, shaft6_emerg on', 'level');
  if (!await spawnedWait('g6_shaft', 3, 'v6_shaft_lights + 1.0')) return false;
  await heardWait('l6_kes_shaft', 6);
  const sl = (await L6()).scares.find((x) => x.id === 'v6_shaft_lights'), k = await lineOf('l6_kes_shaft');
  if (sl && k) ok(near(k.t - sl.t, 4.4), `l6_kes_shaft at the lamps + 4.4 (${f2(k.t - sl.t)})`, 'story');
  if (lampEmpty) {   // softlock (j): run the lamp empty in the dark shaft, then keep going
    await ev(() => { const p = window.__game.player; p.debug.torch(0.0); p.debug.flashlight(true); });
    await gameWait(5);
  }
  await killUntil('!S.alive("g6_shaft").length', 25, 'F6 dead', ['g6_shaft']);
  if (!await stand('trig', 't6_shaft_bot', { fz: 0.5 })) return false;
  await cpWait('cp6_shaft', 4, 'F6 dead, calm, the shaft bottom');
}
async function segReveal({ stay = true } = {}) {
  if (!await stand('trig', 't6_reveal', { fz: 0.5, look: await S6('mk', 'mk6_reveal') ?? undefined })) return false;
  if (!await beatWait('l6_reveal', 3, 'first t6_reveal')) return false;
  await film('reveal', 'd.flags?.hostile', 20);
  const tr = (await dbg()).t?.l6_reveal;
  ok(await untilG('(d.scares ?? []).includes("v6_well_eyes")', 3, 'v6_well_eyes', 'story', { quiet: true }), 'v6_well_eyes at the reveal (exempt)', 'story');
  await heardWait('l6_kes_pool_1', 4);
  const p1 = await lineOf('l6_kes_pool_1'); if (p1) ok(near(p1.t - tr, 0.6), `l6_kes_pool_1 at reveal + 0.6 (${f2(p1.t - tr)})`, 'story');
  await untilG('(g.story.lineLog ?? []).some((l) => /^l6_kes_pool_2b?$/.test(l.said ?? ""))', 10, 'l6_kes_pool_2 / _2b');
  ok(await untilG('/IN WELL/.test(g.level.screen("dock_board")?.userData?.screenText ?? "")', 10, 'dock_board IN WELL', 'story', { quiet: true }), 'dock_board: B-14 IN WELL — AWAITING LOCK CYCLE', 'story');
  if (!stay) return true;
  // a passive player is fought: the hostile start within reveal + 10 … 18 s
  if (!await flagWait('hostile', 20, 'hostile start ≤ reveal + 18 s')) return false;
  const d = await dbg(), th = d.boss?.hostileAt ?? d.t?.l6_loader;
  const p2 = await lineOf('l6_kes_pool_2') ?? await lineOf('l6_kes_pool_2b');
  const want = Math.min(Math.max(tr + 10, (p2?.end ?? tr) + 0.5), tr + 18);
  ok(near(th, want, 0.3), `hostile start at max(reveal + 10, _pool_2 end + 0.5) capped + 18 (${f2(th - tr)} after the reveal, want ${f2(want - tr)})`, 'story');
  await segHostile();
}
async function segHostile() {
  await beatWait('l6_loader', 2);
  const b = await bossRow();
  ok(b && b.stage >= 1, `boss stage ≥ 1 at the hostile start (${b?.stage})`, 'enemies');
  ok((await L6()).stages.some((s) => s.group === 'g6_loader' && s.stage === 1), 'boss:stage 1 emitted', 'enemies');
  await heardWait('l6_unit_loader_1', 3);
  await heardWait(`l6_choir_pool_${opt.choice}`, 4);
  if (!await spawnedWait('g6_w1', 4, 'W1 at the hostile start + 2.0')) return false;
  const d = await dbg(), th = d.boss?.hostileAt ?? d.t?.l6_loader;
  ok(near(d.t?.['phase:K_stores'] - th, 2.0, 0.25), `K_stores at hostile + 2.0 (${f2(d.t?.['phase:K_stores'] - th)})`, 'story');
  const op = (await L6()).opened.d6_stores?.[0]?.s; ok(near(op - th, 2.4, 0.25), `d6_stores opens at hostile + 2.4 (${f2(op - th)})`, 'story');
  await heardWait('l6_kes_boss_1', 8);
  await objectiveSeen(OBJ.cut, 4);
}
async function enterCage() {
  const s = await S6('spot', 'trig', 't6_cage', { fz: 0.5 });
  if (!s || s.err) return bad(`stand in t6_cage: ${s?.err}`, 'level');
  await S6('tp', s, false);
  return untilG('S.inTrig("t6_cage")', 1, 'feet in t6_cage', 'test');
}
async function segPin() {
  if (!await enterCage()) return false;
  if (!await grip('frame6_pin', 1.4)) return false;
  if (!await flagWait('pin', 1, 'pin out (1.2 s hold)')) return false;
  const tp = (await L6()).flags.pin.s;
  ok(await untilG('(d.boss?.stage ?? 0) >= 2 || (g.story.boss?.()?.stage ?? 0) >= 2', 2, 'stage ≥ 2 at the pin'), 'stage ≥ 2 at the pin', 'story');
  ok(await untilG('d.t?.["vignette:lights_out6"] !== undefined || !!d.flags?.lights_out6', 2, 'lights_out6'), 'lights_out6 with stage 2', 'story');
  await heardWait('l6_kes_pin', 6);
  ok(/0 BAR/.test(await screenText('gauge6') ?? ''), 'gauge6: 0 BAR — PUMP', 'story');
  if (!await spawnedWait('g6_w2', 3, 'W2 at pin + 1.5')) return false;
  const w2 = (await L6()).spawns.find((s) => s.group === 'g6_w2'); if (w2) ok(near(w2.s - tp, 1.5, 0.25), `W2 at pin + 1.5 (${f2(w2.s - tp)})`, 'story');
  await film('w2_climb', null, 8);
}
async function segPump({ twoHolds = true, releases = 0 } = {}) {
  if (!await enterCage()) return false;
  for (let i = 0; i < releases; i++) {   // softlock (g): release at 90 % ten times — progress kept, never lost
    if (!await grip('frame6_pump', 0)) return false;
    await ev(() => window.__game.story.grip?.('frame6_pump', 'abandon'));
    await gameWait(0.3);
  }
  if (twoHolds) {
    if (!await grip('frame6_pump', 3.2)) return false;
    await ev(() => window.__game.story.grip?.('frame6_pump', 'abandon'));
    const pr = (await dbg()).frame?.pressure ?? 0;
    ok(pr > 0.45 && pr < 0.6, `pressure kept after the first hold (${f2(pr)} ≈ 0.53)`, 'story');
    ok(!(await dbg()).flags?.pressure, 'not full after 3.2 of 6.0 s', 'story');
    await heardWait('l6_kes_pump_half', 4);
  }
  if (!await grip('frame6_pump', twoHolds ? 3.1 : 6.3)) return false;
  if (!await flagWait('pressure', 1.5, 'full pressure after 6.0 s cumulative')) return false;
  ok(/210 BAR/.test(await screenText('gauge6') ?? ''), 'gauge6: 210 BAR — READY', 'story');
  ok(await untilG('(d.boss?.stage ?? 0) >= 3', 2, 'stage 3 at pressure'), 'stage 3 at full pressure', 'story');
  await heardWait('l6_kes_pump_done', 6);
}
async function segW3() {
  await killUntil('S.hostileCount() <= 3', 30, '≤ 3 non-loader hostiles (W3\'s rule)', ['g6_w1', 'g6_w2', 'g6_w1_r', 'g6_w2_r']);
  if (!await spawnedWait('g6_w3', 6, 'W3 once ≤ 3 non-loader hostiles live')) return false;
}
async function segShear() {
  if (!await enterCage()) return false;
  if (!await grip('frame6_lever', 0.8)) return false;
  if (!await untilG('!!d.frame?.fired', 1, 'the shear fired')) return false;
  await film('shear', null, 6);
  const t0 = (await L6()).gripLog.filter((x) => x.id === 'frame6_lever').slice(-1)[0]?.se ?? (await dbg()).now;
  await gameWait(5.0);
  const l = await L6(), A = (id) => l.audio.find((a) => a.id === id && a.s >= t0 - 0.05);
  const sf = A('shear_fire'), sp = A('splash_big'), wb = A('winch_brake');
  ok(sf && near(sf.s - t0, 0.05, 0.1), `shear_fire at + 0.05 (${sf ? f2(sf.s - t0) : 'not played'})`, 'level');
  ok(sp && near(sp.s - t0, 0.25, 0.1), `the tether parts: splash_big at + 0.25 (${sp ? f2(sp.s - t0) : 'not played'})`, 'level');
  ok(wb && near(wb.s - t0, 1.4, 0.1), `winch_brake at + 1.4 (${wb ? f2(wb.s - t0) : 'not played'})`, 'level');
  const pingAfter = l.audio.filter((a) => /^ping_/.test(a.id) && a.s > t0 + 0.3);
  ok(!pingAfter.length, `the ping stops at + 0.3 (${pingAfter.length} after)`, 'level');
  ok(/TRUNK: LOS · BUOY: LOS/.test(await screenText('dock_board') ?? '') || /LOS/.test(await screenText('gauge6') ?? ''), 'screens: TRUNK: LOS · BUOY: LOS', 'story');
  const kd = await lineOf('l6_kes_dark');
  ok(kd && near(kd.t - t0, 1.2, 0.1), `l6_kes_dark at + 1.2 ± 0.1 (${kd ? f2(kd.t - t0) : 'not said'})`, 'story');
  ok(await untilG('g.facts.trunkCut === true || !!d.flags?.trunkCut', 1, 'trunkCut'), 'fact trunkCut', 'story');
  await beatWait('l6_cut', 1);
  const loaderAlive = !(await dbg()).flags?.loaderDead;
  if (loaderAlive) { await heardWait('l6_kes_cut_loader', 6); if (kd) await gapAfter('l6_kes_dark', 'l6_kes_cut_loader', 0.4); await objectiveSeen(OBJ.loader, 4); }
  const choirAfter = l.lines.filter((x) => /^l6_choir_/.test(x.id) && x.s > t0 && x.s < t0 + 5);
  ok(!choirAfter.length, `CHOIR says nothing at the cut (${choirAfter.map((x) => x.id)})`, 'story');
}
async function segKillParts(order = ['ram_e', 'ram_w', 'pod']) {
  for (const p of order) {
    const r = await fire(p);
    ok(r !== null && !r?.__err, `fire('${p}') — debug part damage (${JSON.stringify(r)})`, 'story');
    if (p !== 'pod') ok(await untilG(`(g.story.boss?.()?.parts?.${p}?.hp ?? 1) === 0`, 2, `${p} destroyed`, 'enemies', { quiet: true }), `${p} destroyed`, 'enemies');
    await gameWait(1.6);
  }
  await heardWait('l6_kes_boss_pod', 1, 'story', 'both rams gone (said after the second ram)');
  if (!await flagWait('loaderDead', 6, 'the pod destroyed')) return false;
  await film('loader_death', null, 6);
  const dead = (await L6()).died.filter((x) => x.type === 'loader');
  ok(dead.length === 1, `enemy:died once for the loader (${dead.length})`, 'enemies');
  if (!(await dbg()).flags?.trunkCut) await heardWait('l6_kes_loader_dead', 6);
  await heardWait(`l6_choir_loader_${opt.choice}`, 8);
}
async function segQuiet({ waitConsole = 0 } = {}) {
  await killUntil('!S.awake().length', 30, 'every hostile dead');
  if (!await beatWait('l6_quiet', 70, 'cut + loader dead, fightOutWhere + 2.0 s calm')) return false;
  await cpWait('cp6_quiet', 2);
  await heardWait('l6_kes_console', 6);
  const q = (await dbg()).t?.l6_quiet, c = await lineOf('l6_kes_console'); if (c) ok(near(c.t - q, 3.0, 0.15), `l6_kes_console at quiet + 3.0 (${f2(c.t - q)})`, 'story');
  await objectiveSeen(OBJ.console, 4);
  ok(await untilG('g.interactables.get("console6")?.enabled', 2, 'console6 enabled'), 'console6 enabled', 'story');
  if (opt.window) { await stand('trig', 't6_windows', { fz: 0.5, look: await S6('mk', 'mk6_windows') ?? undefined }); await untilG('(d.scares ?? []).includes("v6_window")', 8, 'v6_window', 'story', { quiet: true }); }
  if (waitConsole) {   // softlock (i): never press the console for `waitConsole` s → Kessler asks every 60 s
    await gameWait(waitConsole);
    const n = (await ev(() => window.__game.story.lineLog ?? [])).filter((l) => l.said === 'l6_kes_console_2').length;
    ok(n >= Math.floor((waitConsole - 3) / 60), `l6_kes_console_2 every 60 s (${n} in ${waitConsole} s)`, 'story');
  }
}
async function segEnding({ awkward = null } = {}) {
  if (!await stand('use', 'console6', { trig: 't6_console' })) return false;
  if (awkward === 'sprint') await ev(() => window.__game.player.debug.move(1, 0, true));
  if (awkward === 'reload') await ev(() => { const p = window.__game.player; p.debug.switchTo('carbine'); p.weapons.carbine.clip = 5; p.debug.reload(); });
  if (awkward === 'crouch') { await ev(() => window.__game.player.debug.crouch(true)); await gameWait(0.4); }
  ok((await use('console6')) === 'ok', 'console6 pressed (feet in t6_console)', 'story');
  if (!await untilG('g.state === "cutscene"', 2, 'the camera taken (E1)')) return false;
  await ev(() => window.__game.player.debug.move(0, 0, false));
  await film('ending', 'g.state !== "cutscene"', 55);
  // the camera never moves more than 0.4 m (cam0 → cam1 dolly); sampled during the scene
  const c0 = await S6('mk', 'mk6_end_cam0'), c1 = await S6('mk', 'mk6_end_cam1');
  let maxOff = 0;
  for (let i = 0; i < 30; i++) {
    const r = await evs(() => ({ s: window.__game.state, c: window.__game.camera.getWorldPosition(window.__game.camera.position.clone()).toArray(), t: window.__game.story.debugState?.ending?.times ?? {} }));
    if (r.s !== 'cutscene') break;
    if (c0 && c1 && Object.keys(r.t).includes('S2')) { const dd = Math.min(Math.hypot(r.c[0] - c0[0], r.c[1] - c0[1], r.c[2] - c0[2]), Math.hypot(r.c[0] - c1[0], r.c[1] - c1[1], r.c[2] - c1[2])); maxOff = Math.max(maxOff, dd); }
    await gameWait(1.5);
  }
  ok(maxOff <= 0.45, `the camera stays on the cam0 → cam1 dolly (max ${f2(maxOff)} m off; never > 0.4 m of travel)`, 'story');
  if (!await untilG('(d.beats ?? []).includes("l6_end")', 55, 'l6_end after E2 (B + 0.8)')) return false;
  const d = await dbg(), t = d.ending?.times ?? {};
  ok(d.ending?.result === 'played', `ending.result played (${d.ending?.result})`, 'story');
  const cues = ['S1', 'S2', 'K1', 'SU1', 'SU2', 'R1', 'K2', 'E2', 'K3', 'O1', 'K4', 'C1', 'B', 'END'];
  const lack = cues.filter((k) => typeof t[k] !== 'number'); ok(!lack.length, `ending.times has every cue (${lack.length ? 'missing ' + lack : 'ok'})`, 'story');
  ok(t.E2 - (t.S1 ?? 0) <= 25 && (t.END ?? 0) - t.E2 <= 25, `E1 ${f2(t.E2 - (t.S1 ?? 0))} s, E2 ${f2((t.END ?? 0) - t.E2)} s (each ≤ 25)`, 'story');
  ok(t.E2 <= 24.0 + 0.12, `E2 at ≤ 24.0 (cap) (${f2(t.E2)})`, 'story');
  const lines = await ev((ids) => (window.__game.story.lineLog ?? []).filter((l) => ids.includes(l.said)).map((l) => ({ id: l.said, t: l.t, cue: l.cue })), SCENE_LINES);
  const late = lines.filter((l) => typeof l.cue !== 'number' || Math.abs(l.t - l.cue) > 0.12);
  ok(lines.length >= 9 && !late.length, `scene lines ≤ 0.12 s from their cues (${lines.length}) ${late.map((l) => `${l.id} ${typeof l.cue === 'number' ? f2(l.t - l.cue) : 'no cue'}`).join(', ')}`, 'story');
  const man = await ev(() => window.__game.facts.manifest === true), aas2 = await heard('l6_aas_2');
  ok(lines.some((l) => l.id === (man ? 'l6_kes_end_1b' : 'l6_kes_end_1')), `K1 = ${man ? '_end_1b (queue read)' : '_end_1'}`, 'story');
  ok(lines.some((l) => l.id === (aas2 ? 'l6_kes_end_4' : 'l6_kes_end_4b')), `K4 = ${aas2 ? '_end_4 (Aas heard)' : '_end_4b (S11a)'}`, 'story');
  ok(lines.some((l) => l.id === `l6_choir_last_${opt.choice}`), `C1 = l6_choir_last_${opt.choice}`, 'story');
  // (the OSD's launchAt is judged by checkOsd from the console's screen log)
}
/** The console screen's texts as they pass (the OSD is shown only during E2): sampled into L.osd by this poller. */
async function watchConsole() {
  await ev(() => { const L = window.__L6, g = window.__game; L.osd = []; setInterval(() => { const t = g.level.screen('console6')?.userData?.screenText; if (t && L.osd[L.osd.length - 1] !== t) L.osd.push(t); }, 200); });
}
async function checkOsd() {
  const d = await dbg(), osd = (await L6()).osd ?? [];
  const txt = osd.join('\n');
  ok(/MANIFEST 0031-H/.test(txt) && /DISPATCHED 2,880 · IN TRANSFER 240/.test(txt), 'console: the manifest scroll (DISPATCHED 2,880 · IN TRANSFER 240)', 'story');
  ok(/LAUNCH AUTHORITY: AAS, L\. \(LT\.\) — PALM — LIVE/.test(txt), 'console OSD: LAUNCH AUTHORITY: AAS, L. (LT.) — PALM — LIVE', 'story');
  const m = /SDV TERN — LAUNCHED (\d\d:\d\d)/.exec(txt);
  if (typeof d.launchAt === 'number') {
    const want = hhmm(62.75 + d.launchAt / 3600);
    ok(m && m[1] === want, `OSD launchAt ${m?.[1] ?? 'not shown'} = CLOCK6(launchAt) ${want}`, 'story');
  } else bad('debugState.launchAt is not a number at the end', 'story');
}
async function segEnd({ natural = true } = {}) {
  let end = await untilG('g.state === "ended" || (d.beats ?? []).includes("l6_end")', natural && !routeBroken ? 4 : 1, 'l6_end', 'story', { quiet: !natural || !!routeBroken });
  if (!end) {
    bad(`the level did not end by itself${routeBroken ? ` (route broken at "${routeBroken}")` : ''} — forcing story.end() (H1) to test the end contract`, routeBroken ? 'test' : 'story');
    const r = await evs(() => (typeof window.__game.story.end === 'function' ? (window.__game.story.end(), true) : false));
    if (r !== true) return bad('story.end (H1) missing: the end cannot be tested', 'story');
    end = await untilG('g.state === "ended"', 6, 'state ended after end()');
  }
  ok(end, 'state ended', 'story');
  // the cards (as check-chain reads them: `.cb`): THE TRUNK / TO BE CONTINUED (14 s, skippable), then END OF CHAPTER 3
  const cardIs = (re, ms) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.cb')?.innerText ?? ''), re.source, { timeout: ms, polling: 100 }).then(() => true).catch(() => false);
  const c1 = await cardIs(/THE TRUNK[\s\S]*TO BE CONTINUED/, 15000);
  await film('end_cards', null, 2);
  ok(c1, 'end card THE TRUNK / TO BE CONTINUED', 'story');
  await page.keyboard.press('Space');
  ok(await cardIs(/END OF CHAPTER 3/, 8000), 'then END OF CHAPTER 3', 'story');
  const s = await ev((K) => ({ carry: JSON.parse(localStorage.getItem(K[0]) ?? 'null'), level: localStorage.getItem(K[1]), save: localStorage.getItem(K[2]) }), [CARRY_KEY, LEVEL_KEY, SAVE_KEY]);
  const c = s.carry, f = c?.facts ?? {};
  ok(c?.from === 6, `carry from 6 (${c?.from})`, 'story');
  ok(c && typeof c.armor === 'number' && 'carbine' in (c.weapons ?? {}), `carry armour ${c?.armor}, weapons ${c ? Object.keys(c.weapons ?? {}) : '—'}`, 'story');
  ok(typeof f.kills6 === 'number' && typeof f.testHour === 'number' && f.testHour > 62.75 && typeof f.launchHour === 'number' && typeof f.manifest === 'boolean' && typeof f.aas === 'boolean',
    `carry facts kills6 ${f.kills6}, testHour ${f2(f.testHour)}, launchHour ${f2(f.launchHour)}, manifest ${f.manifest}, aas ${f.aas}`, 'story');
  if (natural && !routeBroken) {
    ok(f.trunkCut === true && f.loaderDead === true, `carry trunkCut ${f.trunkCut}, loaderDead ${f.loaderDead}`, 'story');
    const d = await dbg(); if (typeof d.launchAt === 'number') ok(near(f.launchHour, 62.75 + d.launchAt / 3600, 0.01), `launchHour = arrival + launchAt (${f2(f.launchHour)})`, 'story');
  }
  ok(s.level === '6' && s.save === null, `stored level 6 (${s.level}), level-6 checkpoint cleared (${s.save === null})`, 'story');
  // the menu on a stored 6: `Chapter 3 — The Trunk`
  const p2 = await ctxB.newPage();
  try {
    await p2.goto(`${base}/?god=1`, { waitUntil: 'load', timeout: 60000 });
    await p2.waitForFunction(() => window.__game?.state === 'menu' && !!document.querySelector('.menu.show'), null, { timeout: 30000 });
    const line = await p2.evaluate(() => document.querySelector('.menu .lvlline')?.textContent ?? '');
    ok(/Chapter 3\s+—\s+The Trunk/.test(line), `menu line "${line}" on a stored 6`, 'ui');
  } catch (e) { bad(`the menu did not open on a stored level 6 (${e.message.slice(0, 80)})`, 'ui'); }
  await p2.close().catch(() => {});
}

// ───────────────────────────────────────────────────────────── the route
async function freshRun(label, query = '', o = {}) {
  routeBroken = null; skipped = [];
  await session(label);
  if (!await boot(query, o)) { routeBroken = 'boot'; return false; }
  if (!await untilG('g.state === "playing"', 12, 'state playing after the title card', 'story')) { routeBroken = 'boot'; return false; }
  return true;
}
/** The STEPS of the main route, in order; `o` = options, `hooks[name]` runs after the step of that name. */
function steps(o = {}) {
  const ans = o.answer ?? opt.choice === 'stop';
  return [
    ['arrival', [...N.base, ...N.arrival], segArrival],
    ['latch', N.latch, () => segLatch({ doorway: !!o.tubeDoorway })],
    ['crossing', N.crossing, () => segCrossing({ runPast: !!o.runPast })],
    ['rep', N.rep, segRep],
    ['tunb', N.tunb, () => segTunB({ killFrom60: !!o.killFrom60 })],
    ['he', N.he, segHeadEnd],
    ...(o.handset === false ? [] : [['handset', N.handset, () => segHandset({ answer: ans })]]),
    ...(o.queue ?? ans ? [['queue', N.queue, segQueue]] : []),
    ['crank', N.crank, () => segCrank({ inVault: !!o.f4InVault })],
    ['vault', N.vault, () => segVault()],
    ['pull', N.vault, segPull],
    ['f5', N.f5, () => segF5({ inTrench: !!o.f5InTrench })],
    ...(o.thud === false ? [] : [['thud', ['ds:launchAt'], segThud]]),
    ['shaftOpen', N.shaftOpen, segShaftOpen],
    ['shaft', N.shaft, () => segShaft({ lampEmpty: !!o.lampEmpty })],
    ['reveal', N.reveal, () => segReveal({ stay: true })],
    ...bossSteps(o.bossOrder ?? 'default'),
    ['quiet', N.quiet, () => segQuiet({ waitConsole: o.waitConsole ?? 0 })],
    ['ending', N.ending, async () => { await watchConsole(); await segEnding({ awkward: o.awkward ?? null }); await checkOsd(); }],
  ];
}
/** The boss in a named order (§10.1 order cases d, e, f; default = pin, pump, W3, lever, rams, pod). */
function bossSteps(order) {
  const pin = ['pin', N.frame, segPin], pump = ['pump', N.frame, () => segPump({ twoHolds: true, releases: opt.pumpReleases ?? 0 })], w3 = ['w3', N.frame, segW3], shear = ['shear', N.frame, segShear];
  const part = (p) => [p, N.kill, () => segKillParts([p]).then((r) => (p === 'pod' ? r : true))];
  const kw = ['waves', N.kill, () => killUntil('!S.awake().length', 30, 'the waves dead', null)];
  return {
    default: [pin, pump, w3, shear, part('ram_e'), part('ram_w'), part('pod')],
    d: [part('ram_e'), part('ram_w'), part('pod'), kw, pin, pump, w3, shear],
    e: [pin, pump, w3, shear, part('ram_e'), part('ram_w'), part('pod')],
    f: [pin, part('ram_e'), pump, part('ram_w'), w3, shear, part('pod')],
  }[order];
}
async function route(o = {}, hooks = {}) {
  Object.assign(opt, { reads: false, tent: false, drum: false, window: false, bay: false }, o);
  for (const [name, needs, fn] of steps(o)) {
    await seg(name, needs, fn);
    if (hooks[name] && !routeBroken) await hooks[name]();
  }
  console.log('── the end');
  await segEnd({ natural: true });
}
const dieAndLoad = async (query = '') => {
  await ev(() => { const g = window.__game; g.debug.god = false; g.player.damage(9999); g.player.damage(9999); });
  ok(await untilG('g.state === "dead"', 4, 'died'), 'died', 'test');
  await boot(`&continue=1&choice=${opt.choice}${query}`);
  return untilG('g.state === "playing"', 12, 'playing after the load', 'story');
};
const wsNorm = (w) => ({ ...w, doors: Object.fromEntries(Object.entries(w?.doors ?? {}).map(([k, v]) => [k, { locked: v.locked, status: v.status ?? null }])), screens: Object.fromEntries(Object.entries(w?.screens ?? {}).map(([k, v]) => [k, String(v).replace(/\d\d:\d\d(:\d\d)?/g, '##').replace(/\d+ BAR/g, 'n BAR')])) });
/** After a load: H13 equal to the save's world (keys, flags, doors, screens, lights, hatches, pickups, scares, frame). */
async function compareLoad(cp, before) {
  const got = await ws(), d = await dbg();
  if (!got || got.__err || !before?.ws) return bad(`${cp}: worldState() (H13) unavailable — before ${!!before?.ws}, after ${got?.__err ?? !!got}`, 'story');
  const a = wsNorm(got), b = wsNorm(before.ws);
  for (const key of ['doors', 'keys', 'hatches', 'lights', 'dark', 'screens', 'pickups', 'scares', 'frame', 'slots']) {
    const same = JSON.stringify(a[key]) === JSON.stringify(b[key]);
    ok(same, `${cp}: ${key} as saved${same ? '' : ` — ${JSON.stringify(a[key]).slice(0, 160)} ≠ ${JSON.stringify(b[key]).slice(0, 160)}`}`, 'story');
  }
  const fl = (f) => Object.fromEntries(Object.entries(f ?? {}).filter(([k]) => !['f1Free', 'f3Free', 'ending'].includes(k)));
  ok(JSON.stringify(fl(a.flags)) === JSON.stringify(fl(b.flags)), `${cp}: flags as saved ${JSON.stringify(fl(a.flags)).slice(0, 200)}`, 'story');
  ok(JSON.stringify([...(d.keys ?? [])].sort()) === JSON.stringify([...(before.keys ?? [])].sort()), `${cp}: keys ${d.keys} = saved ${before.keys}`, 'story');
  return d;
}
/** Boss restore (§5.6.9): parts / stage as saved, health ≥ 60, reserve ≥ 90, lockers armed, the restore point by the
 *  latest wave, only the latest wave back (twin after 3.0 s if alive; re-queued if pending), earlier waves absent. */
async function checkBossRestore(cp, before) {
  const d = await dbg(), b = before?.boss;
  if (!b) return bad(`${cp}: no boss record in debugState at the save`, 'story');
  ok(JSON.stringify(d.boss?.parts) === JSON.stringify(b.parts) && d.boss?.stage === b.stage, `${cp}: loader parts + stage as saved (${JSON.stringify(d.boss?.parts)}, stage ${d.boss?.stage})`, 'story');
  const p = await ev(() => ({ hp: window.__game.player.health, res: window.__game.player.weapons.carbine?.reserve ?? 0, pos: window.__game.player.position.toArray() }));
  ok(p.hp >= 60, `${cp}: health ≥ 60 (${p.hp}, saved ${before.health})`, 'story');
  ok(p.res >= 90, `${cp}: carbine reserve topped to ≥ 90 (${p.res}) (B5)`, 'story');
  const lk = await evs(() => window.__game.story.lockers?.() ?? null);
  ok(lk && ['e', 'w', 'n'].every((k) => lk[k]?.armed === true), `${cp}: the three dock lockers re-armed (${JSON.stringify(lk)})`, 'story');
  const w = b.waves ?? {}, latest = w.latest ?? (['w3', 'w2', 'w1'].find((k) => w[k] && w[k] !== null) ?? null);
  const safe = await S6('mk', latest === 'w3' ? 'mk6_boss_safe_w' : 'mk6_boss_safe');
  ok(safe && Math.hypot(p.pos[0] - safe[0], p.pos[2] - safe[2]) < 1.0, `${cp}: at the restore point of the latest wave (${latest}: ${latest === 'w3' ? 'mk6_boss_safe_w' : 'mk6_boss_safe'})`, 'story');
  if (b.dead || d.flags?.loaderDead) ok(!(await bossRow()) || (await bossRow())?.alive === false, `${cp}: the loader removed silently (loader dead at the save)`, 'story');
  // the latest wave per its state; earlier ones absent
  // (atCp waited 1.0 s after the load) → judged at ≈ 2.2 s, then after the grace at ≈ 3.8 s
  await gameWait(1.2);
  const early = await ev(() => window.__game.enemies.all.filter((e) => e.alive && /^g6_w\d_r$/.test(e.group)).length);
  ok(early === 0, `${cp}: no twin inside the 3.0 s grace (${early} at ≈ 2.2 s)`, 'story');
  await gameWait(1.6);
  for (const k of ['w1', 'w2', 'w3']) {
    const twin = await S6('alive', `g6_${k}_r`), orig = await S6('alive', `g6_${k}`);
    ok(!orig.length, `${cp}: the original ${k} never comes back (${orig.length})`, 'story');
    if (k === latest && w[k] === 'alive') ok(twin.length > 0, `${cp}: latest wave ${k} alive at the save → its twin is back (${twin.length})`, 'story');
    else if (k === latest && w[k] === 'pending') note(`${cp}: latest wave ${k} pending at the save → re-queued (twin now ${twin.length}; spawns only under its rule)`);
    else ok(!twin.length, `${cp}: wave ${k} (${w[k]}${k === latest ? ', latest' : ', earlier'}) not back (${twin.length})`, 'story');
  }
  if (latest === 'w1' && w.w1 === 'alive') ok((await L6()).opened.d6_stores?.length > 0, `${cp}: W1's twin through a re-opened d6_stores (S2b)`, 'story');
  ok(await ev(() => window.__S6.hostileCount()) <= 6, `${cp}: ≤ 6 hostiles after the restore`, 'story');
}

// ───────────────────────────────────────────────────────────── modes
async function runContract() {
  await session('contract');
  if (!await boot('')) return;
  await gameWait(1.0);
  await contract({ full: true });
  await staticPass();
}
const caseOn = (k) => !CASE_LIST || CASE_LIST.includes(k);
if (MODE === 'probe') {
  await session('probe');
  await page.goto(`${base}/?level=${PROBE_LEVEL}&autostart=1&god=1&nostory=1&noenemies=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
  const list = await ev(() => ({ trig: (window.__game.__triggers ?? []).map((t) => t.id), use: window.__game.interactables.all.filter((i) => i.kind !== 'door').map((i) => i.id) }));
  console.log(`── probe level ${PROBE_LEVEL}: ${list.trig.length} triggers, ${list.use.length} interactables`);
  let found = 0;
  for (const [kind, ids] of [['trig', list.trig], ['use', list.use]]) for (const id of ids) {
    const sp = await S6('spot', kind, id, {}).catch((e) => ({ err: e.message }));
    if (!sp || sp.err) { note(`${kind} ${id}: ${sp?.err}`); continue; }
    await S6('tp', sp, false); await gameWait(0.25);
    const p = await ev(() => window.__game.player.position.toArray());
    if (Math.hypot(p[0] - sp.x, p[2] - sp.z) > 0.35 || Math.abs(p[1] - sp.y) > 0.4) bad(`${kind} ${id}: stood at (${[sp.x, sp.y, sp.z].map(f2)}) in ${sp.room} → pushed to (${p.map(f2)})`, 'test');
    else found++;
  }
  console.log(`  ${found} spots held`);
} else if (MODE === 'contract') {
  await runContract();
} else if (MODE === 'default') {
  for (const choice of CHOICES) {
    console.log(`\n══════════ LEVEL 6 — choice ${choice} ══════════`);
    opt.choice = choice;
    if (!await freshRun(`default ${choice}`, `&choice=${choice}`)) continue;
    await segBoot({ choice });
    if (choice === CHOICES[0]) { await contract({ full: false }); await staticPass(); routeBroken = null; }
    // stop: answer the handset, read the queue; command: ignore both (E1 _end_1, E2 _end_4b)
    await route({ answer: choice === 'stop', queue: choice === 'stop' });
    await runChecks(choice);
    printOracle(await L6().catch(() => null), false);
  }
} else if (MODE === 'checkpoints') {
  opt.choice = 'stop';
  const ROUTE_O = { answer: true, queue: true, thud: false };
  const UPTO = { cp6_start: 'arrival', cp6_tunnel: 'crossing', cp6_rep: 'rep', cp6_he: 'he', cp6_manual: 'crank', cp6_pulled: 'f5', cp6_shaft: 'shaft', cp6_m1: 'pin', cp6_m2: 'pump', cp6_m3: 'shear', cp6_m4: 'ram_e', cp6_m5: 'ram_w', cp6_quiet: 'quiet' };
  const PHASE_OF = { cp6_start: ['T'], cp6_tunnel: ['U'], cp6_rep: ['B'], cp6_he: ['B'], cp6_manual: ['B'], cp6_pulled: ['B'], cp6_shaft: ['K'], cp6_quiet: ['K', 'K_stores'] };
  const S0 = () => steps(ROUTE_O);
  const playTo = async (name, list = S0()) => { let k = 0; for (; k < list.length; k++) { await seg(list[k][0], list[k][1], list[k][2]); if (list[k][0] === name || routeBroken) break; } return k; };
  const finishFrom = async (k, list = S0()) => { routeBroken = null; for (k = k + 1; k < list.length; k++) await seg(list[k][0], list[k][1], list[k][2]); await segEnd({ natural: true }); };
  const atCp = async (cp, { boss = false } = {}) => {
    if (!await cpWait(cp, 14)) return null;
    await gameWait(0.4);
    const before = (await L6()).cpState[cp];
    const saved = await ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), SAVE_KEY);
    ok(saved?.id === cp, `the save holds ${cp} (${saved?.id})`, 'story');
    const beatsBefore = (await dbg()).beats ?? [];
    if (!await dieAndLoad()) return null;
    await gameWait(1.0);
    const d = await compareLoad(cp, before);
    ok(d?.restoredFrom === cp, `${cp}: restoredFrom ${d?.restoredFrom}`, 'story');
    if (PHASE_OF[cp]) ok(PHASE_OF[cp].includes(d?.phaseApplied), `${cp}: phase ${d?.phaseApplied} (want ${PHASE_OF[cp]})`, 'story');
    if (boss) await checkBossRestore(cp, before);
    const replayed = (await L6()).beats.filter((b) => beatsBefore.includes(b));
    ok(!replayed.length, `${cp}: no beat re-emitted by the load (${replayed})`, 'story');
    await page.screenshot({ path: `shots/l6/${cp}-restored.png` }).catch(() => {});
    return before;
  };
  if (caseOn('route')) for (const cp of CPS) {
    if (ONLY_CP && cp !== ONLY_CP) continue;
    console.log(`\n══════════ ${cp} ══════════`);
    if (!await freshRun(cp, '&choice=stop')) continue;
    const k = await playTo(UPTO[cp]);
    if (routeBroken) { bad(`${cp}: not reached (route broken at "${routeBroken}")`, 'test'); await segEnd({ natural: false }); continue; }
    if (!await atCp(cp, { boss: /^cp6_m/.test(cp) })) { await segEnd({ natural: false }); continue; }
    await toastSeen('checkpoint restored', 3);
    await finishFrom(k);
    await runChecks(cp);
  }
  // the boss orders (d, e, f): die at every milestone reached, with the wave states as they fall
  for (const ord of ['d', 'e', 'f']) {
    if (!caseOn(ord) || ONLY_CP) continue;
    console.log(`\n══════════ boss order (${ord}): die at every milestone ══════════`);
    if (!await freshRun(`order ${ord}`, '&choice=stop')) continue;
    const list = steps({ ...ROUTE_O, bossOrder: ord });
    let k = await playTo('reveal', list);
    for (let n = 1; n <= 5 && !routeBroken; n++) {
      // play the next step that writes a milestone
      for (k = k + 1; k < list.length; k++) { await seg(list[k][0], list[k][1], list[k][2]); if (routeBroken || (await dbg()).checkpoints?.includes(`cp6_m${n}`) || ['pin', 'pump', 'shear', 'ram_e', 'ram_w', 'pod'].includes(list[k][0])) break; }
      if (routeBroken) break;
      const before = await atCp(`cp6_m${n}`, { boss: true });
      if (!before) break;
      if (ord === 'f' && n === 2 && caseOn('twice')) { console.log('   die twice at the same milestone'); await atCp(`cp6_m${n}`, { boss: true }); }
      if (ord === 'd' && n === 3 && caseOn('dead')) ok(!!(await dbg()).flags?.loaderDead && !(await dbg()).flags?.trunkCut, 'order (d): the loader dead, the frame as saved, before the cut', 'story');
    }
    await finishFrom(k, list);
    await runChecks(`order ${ord}`);
  }
  // B4: crank → insert Key A → kill F4 (calm save) → die → load → the loom usable
  if (caseOn('b4') && !ONLY_CP) {
    console.log('\n══════════ B4: Key A spent, a calm save, death ══════════');
    if (await freshRun('B4', '&choice=stop')) {
      opt.skipManualCp = true;
      opt.f4Hook = async () => { await segVault(); };   // insert Key A while F4 is on its way
      const list = steps(ROUTE_O); const k = await playTo('crank', list);
      opt.f4Hook = null; opt.skipManualCp = false;
      if (!routeBroken) {
        await untilG('!!d.checkpoint', 8, 'a calm save after F4', 'story');
        const cp = (await dbg()).checkpoint;
        if (await dieAndLoad()) {
          await gameWait(1.0);
          const d = await dbg();
          ok(!!d.flags?.bjOpen && !d.keys?.includes('key6_a'), `B4: bjOpen ${d.flags?.bjOpen}, Key A trapped (keys ${d.keys}) after ${cp}`, 'story');
          ok(await untilG('g.interactables.get("vault6_loom")?.enabled', 3, 'the loom enabled after the load'), 'B4: the loom usable after the load', 'story');
          await seg('pull after the load', N.vault, segPull);
          await finishFrom(list.findIndex((s) => s[0] === 'pull'), list);
        }
      }
      void k;
      await runChecks('B4');
    }
  }
  // B5: reach cp6_m2 with 0 reserve and every arena pickup and locker taken, die, load → reserve ≥ 90, lockers armed
  if (caseOn('b5') && !ONLY_CP) {
    console.log('\n══════════ B5: a boss restore with no ammo ══════════');
    if (await freshRun('B5', '&choice=stop')) {
      const list = steps(ROUTE_O); const k = await playTo('pin', list);
      if (!routeBroken) {
        for (const p of ARENA_PICKUPS) await touchPickup(p);
        for (const id of LOCKERS6) if (await stand('use', id)) ok((await use(id)) === 'ok', `${id} taken`, 'story');
        const z = await ev(() => { const g = window.__game; for (const w of Object.values(g.player.weapons)) w.reserve = 0; return Object.values(g.player.weapons).every((w) => w.reserve === 0); });
        if (!z) bad('B5: could not empty the reserves (player.weapons[*].reserve not writable — add a debug hook)', 'test');
        const lk = await evs(() => window.__game.story.lockers?.() ?? null);
        ok(lk && ['e', 'w', 'n'].every((x) => lk[x]?.armed === false), `B5: lockers taken before the save (${JSON.stringify(lk)})`, 'story');
        await seg('pump', N.frame, () => segPump({ twoHolds: false }));
        if (await atCp('cp6_m2', { boss: true })) await finishFrom(list.findIndex((s) => s[0] === 'pump'), list);
      }
      void k;
      await runChecks('B5');
    }
  }
  // S2d: a milestone during the pump is saved at the grip's end + 1.0 s
  if (caseOn('pump') && !ONLY_CP) {
    console.log('\n══════════ S2d: a milestone during a grip ══════════');
    if (await freshRun('S2d', '&choice=stop')) {
      const list = steps(ROUTE_O); await playTo('pin', list);
      if (!routeBroken && await enterCage() && await grip('frame6_pump', 0)) {
        await ev(() => window.__game.story.grip?.('frame6_pump', 6.5));
        await gameWait(1.0);
        await fireOk('ram_e', 'a milestone while the pump grip runs');
        await gameWait(2.0);
        const n = (await dbg()).boss?.milestones?.length ?? 0;
        ok(!(await dbg()).checkpoints?.includes(`cp6_m${n}`), `cp6_m${n} not written while the grip runs`, 'story');
        await untilG('!d.grip', 6, 'the pump grip ends');
        const endT = (await L6()).gripLog.filter((x) => x.id === 'frame6_pump').slice(-1)[0]?.se;
        await cpWait(`cp6_m${n}`, 3, 'deferred save at the grip end + 1.0');
        const at = (await L6()).cpAt[`cp6_m${n}`]?.s;
        ok(near(at - endT, 1.0, 0.25), `cp6_m${n} at the grip end + 1.0 (${f2(at - endT)})`, 'story');
      }
      await runChecks('S2d');
    }
  }
} else if (MODE === 'impatient') {
  console.log('\n══════════ IMPATIENT ══════════');
  opt.choice = 'command';
  if (await freshRun('impatient', '&choice=command')) {
    await segBoot({ choice: 'command' });
    await contract({ full: false }); await staticPass(); routeBroken = null;
    const shootAt = async (label, p, n = 3) => { if (!p) return note(`impatient: no position for ${label}`); const sp = await S6('spot', 'near', null, { p, dist: 6 }); if (sp && !sp.err) await S6('tp', sp); const h0 = (await L6()).hits.length; await fireAt(p, n); const h = (await L6()).hits.slice(h0); ok(h.length > 0, `shot ${label}: ${h.length} impacts (${[...new Set(h.map((x) => x.s))]}) — nothing broke`, 'level'); };
    await route({ answer: false, queue: false, killFrom60: true }, {
      he: async () => {
        // the enclosure before the crank; then the handset
        if (await stand('use', 'vault6_lock')) { await use('vault6_lock'); await toastSeen('Interlock key A required', 2); await heardWait('l6_unit_deny_a', 3); ok(!(await dbg()).flags?.bjOpen, 'no bjOpen without Key A', 'story'); }
        await shootAt('the handset', await S6('mk', 'mk6_handset'));
      },
      pull: async () => {
        if (await stand('use', 'console6')) ok((await usable('console6')) !== 'ok', 'console6 not usable before the end', 'story');
        await shootAt('the tent (job card pole)', await ev(() => window.__game.interactables.get('note6_jobcard')?.position.toArray() ?? null));
      },
      f5: async () => {},
      thud: async () => {},
      shaftOpen: async () => {},
      reveal: async () => {
        await shootAt('the dock board', await ev(() => window.__game.level.screen('dock_board')?.getWorldPosition?.(window.__game.level.screen('dock_board').position.clone()).toArray() ?? null));
        await shootAt('the well (splashes)', await ev(() => { const b = window.__game.level.regions?.deep?.[0]; return b ? [(b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2] : null; }));
        for (const sl of await ev(() => (window.__game.level.dock?.slots ?? []).filter((s) => s.container).map((s) => { const c = s.box.getCenter(s.box.min.clone()); return [c.x, c.y, c.z]; }))) await shootAt('a container', sl, 2);
        await shootAt('the tether (sheave)', await S6('mk', 'mk6_sheave'));
        await shootAt('the windows', await S6('mk', 'mk6_windows'));
        await shootAt('the console glass', await S6('mk', 'mk6_end_screen'));
        const hw = (await L6()).hits.filter((x) => x.s === 'water');
        ok(hw.length > 0, `rounds splash on the water surface (${hw.length} water impacts, D14)`, 'level');
        // the pump before the pin, the lever before pressure
        if (await enterCage()) {
          await use('frame6_pump'); await heardWait('l6_unit_shear_pin', 3); ok(!(await dbg()).grip, 'no pump grip with the pin in', 'story');
          await gameWait(6.5); await use('frame6_lever'); await heardWait('l6_unit_shear_pin', 3, 'story', 'lever before the pin');
        }
      },
      pin: async () => { await use('frame6_lever'); await heardWait('l6_unit_shear_low', 3); ok(/PRESSURE LOW/.test(await screenText('gauge6') ?? ''), 'gauge6 PRESSURE LOW', 'story'); },
    });
    await runChecks('impatient');
    printOracle(await L6().catch(() => null), true);
  }
} else if (MODE === 'order') {
  const O = {
    a: { label: 'the vault and the enclosure before the switch', o: {}, hooks: { he: async () => { await segVault({ deny: true }); ok((await use('vault6_lock')) === 'ok', 'the lock pressed without Key A', 'story'); await toastSeen('Interlock key A required', 2); } } },
    b: { label: 'every optional first: bay6, the trench, the queue, the handset', o: { bay: true, answer: true, queue: true }, hooks: { he: async () => { for (const p of ['p6_trench_plate_1', 'p6_trench_ammo_1', 'p6_trench_med']) await touchPickup(p); } } },
    c: { label: 'the trench first, exiting into he6, then the switch', o: {}, hooks: { tunb: async () => { await stand('trig', 't6_trench', { fx: 0.05, fz: 0.5, crouch: true }); if (await stand('use', 'hatch6_he', { crouch: true })) { await use('hatch6_he'); await gameWait(2); } } } },
    d: { label: 'kill the loader before the pin', o: { bossOrder: 'd' } },
    e: { label: 'cut without fighting, then kill it', o: { bossOrder: 'e' } },
    f: { label: 'interleaved: pin, ram, pump, ram, fire, pod', o: { bossOrder: 'f' } },
  };
  for (const v of VARIANTS) {
    const c = O[v]; if (!c) continue;
    console.log(`\n══════════ ORDER (${v}): ${c.label} ══════════`);
    opt.choice = 'stop';
    if (!await freshRun(`order ${v}`, '&choice=stop')) continue;
    await route({ answer: true, ...c.o }, c.hooks ?? {});
    await runChecks(`order ${v}`);
    printOracle(await L6().catch(() => null), false);
  }
} else if (MODE === 'softlock') {
  const C = {
    a: ['120 s in lock6', { }, { arrival: () => gameWait(120) }],
    b: ['the tube doorway during the latch', { tubeDoorway: true }, {}],
    c: ['60 s in the trench during F5', { f5InTrench: true }, {}],
    d: ['leave into the shaft mid-boss for 60 s', {}, { pin: async () => { await stand('trig', 't6_shaft', { fz: 0.5 }); await gameWait(60); } }],
    e: ['120 s in the undercroft at stage 1', {}, { reveal: async () => { const b = await ev(() => { const r = window.__game.level.regions?.undercroft?.[0]; return r ? [(r.min.x + r.max.x) / 2, r.min.y, (r.min.z + r.max.z) / 2] : null; }); if (b) await stand('at', null, { p: b }); await gameWait(120); } }],
    f: ['120 s in the cage touching nothing', {}, { reveal: async () => { await enterCage(); await gameWait(120); } }],
    g: ['release the pump at 90 % ten times', {}, {}],
    h: ['die during W2\'s climb, twice', {}, { pin: async () => { for (let i = 0; i < 2; i++) { await gameWait(1.8); await dieAndLoad(); await gameWait(1); } } }],
    i: ['never press the console for 180 s', { waitConsole: 180 }, {}],
    j: ['run the lamp empty in the shaft and the chamber after lights_out6', { lampEmpty: true }, { pin: async () => { await ev(() => { const p = window.__game.player; p.debug.torch(0); p.debug.flashlight(true); }); await gameWait(6); } }],
  };
  for (const k of CASE_LIST ?? Object.keys(C)) {
    const c = C[k]; if (!c) continue;
    console.log(`\n══════════ SOFTLOCK (${k}): ${c[0]} ══════════`);
    opt.choice = 'stop'; opt.trenchWait = k === 'c' ? 60 : 0; opt.pumpReleases = k === 'g' ? 10 : 0;
    if (!await freshRun(`softlock ${k}`, '&choice=stop')) continue;
    await route({ answer: false, queue: false, ...c[1] }, c[2]);
    await runChecks(`softlock ${k}`);
  }
} else if (MODE === 'scares') {
  console.log('\n══════════ SCARES (calm route, waits for each) ══════════');
  opt.choice = 'stop';
  if (await freshRun('scares', '&choice=stop')) {
    await route({ answer: true, queue: true, tent: true, drum: true, window: true });
    const l = await L6(), d = await dbg();
    const ids = Object.keys(SCARES6);
    for (const id of ids) {
      const n = l.scares.filter((x) => x.id === id);
      ok(n.length === 1, `${id} fired exactly once (${n.length})`, 'story');
      const x = n[0]; if (!x) continue;
      if (!SCARES6[id].exempt) ok(!x.near.length, `${id}: no hostile awake within 30 m (${x.near})`, 'story');
      ok(!x.inCutscene, `${id}: not in a cutscene`, 'story');
      if (!SCARES6[id].boss) ok(!x.boss, `${id}: not during the boss (hostile → quiet)`, 'story');
      const rooms = [].concat(SCARES6[id].room); ok(rooms.includes(x.room ?? rooms[0]), `${id} in ${x.room} (${rooms})`, 'story');
    }
    const seq = l.scares.filter((x) => !SCARES6[x.id]?.exempt).sort((a, b) => a.t - b.t);
    for (let i = 1; i < seq.length; i++) ok(seq[i].t - seq[i - 1].t >= 45, `${seq[i - 1].id} → ${seq[i].id} ${f2(seq[i].t - seq[i - 1].t)} s apart (≥ 45)`, 'story');
    const loud = seq.filter((x) => SCARES6[x.id]?.loud);
    for (let i = 1; i < loud.length; i++) ok(loud[i].t - loud[i - 1].t >= 90, `loud ${loud[i - 1].id} → ${loud[i].id} ${f2(loud[i].t - loud[i - 1].t)} s (≥ 90)`, 'story');
    ok(l.scares.some((x) => x.id === 'v6_shaft_lights') && (d.checkpoints ?? []).includes('cp6_shaft'), 'v6_shaft_lights (and cp6_shaft) on the default route (S4)', 'story');
    const th = l.scares.find((x) => x.id === 'v6_thud'), tp = d.t?.l6_pulled, tk = d.t?.l6_shaft_open;
    if (th) ok(th.t - tp >= 20 && th.t - tp <= 90 && (tk === undefined || th.t < tk), `v6_thud inside pull + 20 … + 90 and before Key B (${f2(th.t - tp)})`, 'story');
    // sounds once each (H14): every vignette sound played at most once, none by two owners
    for (const id of ids) for (const snd of SCARES6[id].sounds) {
      const n = l.audio.filter((a) => a.id === snd).length;
      if (snd === 'bulb_pop') ok(n === 5, `${id}: bulb_pop × 5 (${n})`, 'audio'); else ok(n <= 1 || ['ping_close'].includes(snd), `${id}: ${snd} played once (${n})`, 'audio');
    }
    await runChecks('scares');
  }
  // snapped on restore: die after the vault, load → every fired scare in debugState.scares, none replayed
  console.log('\n══════════ SCARES: snapped on restore ══════════');
  if (await freshRun('scares restore', '&choice=stop')) {
    const list = steps({ answer: true, queue: false, thud: false });
    let k = 0; for (; k < list.length; k++) { await seg(list[k][0], list[k][1], list[k][2]); if (list[k][0] === 'f5' || routeBroken) break; }
    if (!routeBroken && await cpWait('cp6_pulled', 8)) {
      const before = (await dbg()).scares ?? [];
      if (await dieAndLoad()) {
        await gameWait(1.5);
        const d = await dbg(), l = await L6();
        ok(JSON.stringify([...(d.scares ?? [])].sort()) === JSON.stringify([...before].sort()), `scares restored (${d.scares})`, 'story');
        ok(!l.audio.some((a) => Object.values(SCARES6).some((s) => s.sounds.includes(a.id))), `no scare sound replayed by the load (${l.audio.map((a) => a.id).slice(0, 8)})`, 'audio');
      }
    }
  }
} else if (MODE === 'boss' || MODE === 'dry') {
  /** Play to the reveal by hooks (fast: fire), then the bot fights the boss with real movement and weapons. */
  const toBoss = async (choice, q = '') => {
    opt.choice = choice;
    if (!await freshRun(`boss ${choice}`, `&choice=${choice}${q}`)) return false;
    const need = await missingOf([...H('fire', 'boss', 'grip'), 'ds:boss', 'ds:frame', 'group:g6_loader', 'trig:t6_reveal', 'player:debug.aimLock']);
    if (need.length) { bad(`${MODE}: SKIPPED — needs ${need.map((m) => `${ownerOf(m)}: ${m}`).join(', ')}`, suspectOf(ownerOf(need[0]))); return false; }
    for (const f of ['tube', 'latch', 'f1', 'f2', 'f3', 'manual', 'f4', 'bj', 'pull', 'f5', 'shaft']) { if ((await fire(f)) === null) return bad(`fire('${f}') refused on the way to the boss`, 'story'); await gameWait(0.3); await kill(null); }
    await S6('kill', null);
    if (!await seg('shaft', N.shaft, () => segShaft())) return false;
    if (!await seg('reveal', N.reveal, () => segReveal({ stay: false }))) return false;
    return true;
  };
  const telegraphs = (log) => {
    for (const a of log.attacks) {
      if (a.kind === 'slam' && a.lock >= 0) { ok(a.lock - a.ts >= 0.9 - 0.05, `slam track ${f2(a.lock - a.ts)} s (≥ 0.9)`, 'enemies'); if (a.impact >= 0) ok(a.impact - a.lock >= 0.8 - 0.05, `slam lock ${f2(a.impact - a.lock)} s (≥ 0.8)`, 'enemies'); }
      if ((a.kind === 'shift' || a.kind === 'drop') && a.outlineAt >= 0 && a.impact >= 0) ok(a.impact - a.outlineAt >= 1.6 - 0.1, `${a.kind} outline ${f2(a.impact - a.outlineAt)} s before the set-down (≥ 1.6)`, 'enemies');
      if (a.kind === 'swing' && a.impact >= 0) ok(a.impact - a.ts >= 1.2 - 0.05, `swing wind ${f2(a.impact - a.ts)} s (≥ 1.2)`, 'enemies');
      if (a.dodgeAt >= 0 && a.impact >= 0 && a.dodgeAt <= (a.lock >= 0 ? a.lock : a.ts) + 0.15) {
        const hit = log.dmg.filter((x) => Math.abs(x.t - a.impact) <= 0.25);
        ok(!hit.length, `${a.kind} at ${f2(a.impact)}: dodged on time, no damage (${hit.map((x) => x.amount)})`, 'enemies');
      }
    }
  };
  const fightUntil = async (cond, gs, frameToo) => {
    const t0 = await ev(() => window.__game.time);
    while ((await ev(() => window.__game.time)) - t0 < gs) {
      if (await ev((c) => { try { return !!new Function('g', 'd', 'S', `return (${c});`)(window.__game, window.__game.story.debugState ?? {}, window.__S6); } catch { return false; } }, cond)) return true;
      // between waves: the frame (pin → pump → lever) with real grips
      if (frameToo && !(await ev(() => window.__S6.awake().length))) {
        const d = await dbg();
        if (!d.flags?.trunkCut) {
          await S6('botStop');
          const cs = await S6('spot', 'trig', 't6_cage', {});
          if (!cs || cs.err || !await walkTo([cs.x, cs.y, cs.z], 40)) await enterCage();
          if (!d.flags?.pin) await grip('frame6_pin', 1.4);
          else if (!d.flags?.pressure) await grip('frame6_pump', 6.3);
          else await grip('frame6_lever', 0.8);
          await S6('bot', { seed: opt.seed });
        }
      }
      await gameWait(1.0);
    }
    return false;
  };
  if (MODE === 'boss') for (const choice of CHOICES) for (const seed of SEEDS) {
    console.log(`\n══════════ BOSS — choice ${choice}, seed ${seed} ══════════`);
    opt.seed = seed;
    if (!await toBoss(choice)) continue;
    const t0 = (await dbg()).now;
    await ev(() => window.__game.player.debug.switchTo('carbine'));
    await S6('bot', { seed });
    const won = await fightUntil('!!d.flags?.loaderDead && !!d.flags?.trunkCut', 420, true);
    const log = await S6('botStop'), d = await dbg(), l = await L6();
    const ttk = (l.flags.loaderDead?.s ?? Infinity) - (d.boss?.hostileAt ?? t0);
    ok(won, `the bot won (cut + loader dead) in 7 min`, 'enemies');
    ok(ttk <= 360, `time to kill ${f2(ttk)} s (≤ 6 min)`, 'enemies');
    telegraphs(log ?? { attacks: [], dmg: [] });
    ok(l.maxHostiles <= 6, `wave cap ≤ 6 (max ${l.maxHostiles})`, 'story');
    const st = l.stages.filter((s) => s.group === 'g6_loader').map((s) => s.stage);
    ok(st.every((s, i) => i === 0 || s >= st[i - 1]) && st.includes(3), `stage order ${st}`, 'enemies');
    ok((log?.lit ?? 0) > 0, `the floods lit the player (${log?.lit} frames; with an aware soldier ≥ 20 m: ${log?.litSoldier})`, 'enemies');
    const B = await bossRow(); const deep = await ev(() => { const b = window.__game.level.regions?.deep?.[0]; return b ? [b.min.x, b.max.x, b.min.z, b.max.z] : null; });
    if (B?.grab && deep) ok(B.grab[0] >= deep[0] - 1 && B.grab[0] <= deep[1] + 1 && B.grab[2] >= deep[2] - 1 && B.grab[2] <= deep[3] + 1, `the grab ended in the well (${B.grab})`, 'enemies');
    console.log(`  shots ${log?.shots}, hits taken ${log?.dmg?.length}, targets ${JSON.stringify(log?.targets)}, attacks ${log?.attacks?.length}`);
    await runChecks(`boss ${choice} ${seed}`);
  }
  // S3: from the cage and from a gallery with W1 dead, 120 s firing at rams and pod → 0 damage
  if (MODE === 'boss') for (const where of ['cage', 'gallery']) {
    console.log(`\n══════════ BOSS S3: ${where}, W1 dead, 120 s at the rams and the pod ══════════`);
    if (!await toBoss('stop')) continue;
    await flagWait('hostile', 20);
    await killUntil('!S.alive("g6_w1").length', 20, 'W1 dead', ['g6_w1']);
    if (where === 'cage') await enterCage(); else await stand('mk', 'mk6_boss_safe');
    const before = (await bossRow())?.parts;
    await S6('bot', { only: ['ram_e', 'ram_w', 'pod'] });
    await gameWait(120);
    await S6('botStop');
    const after = (await bossRow())?.parts;
    const dealt = ['ram_e', 'ram_w', 'pod'].map((k) => (before?.[k]?.hp ?? 0) - (after?.[k]?.hp ?? 0));
    ok(dealt.every((x) => x === 0), `${where}: 0 damage to rams / pod in 120 s (${dealt})`, 'enemies');
  }
  if (MODE === 'dry') for (const choice of CHOICES.slice(0, 1)) {
    console.log('\n══════════ DRY: 0 reserve + 10 in the clip, 50 % hit rate ══════════');
    if (!await toBoss(choice)) continue;
    const set = await ev(() => { const g = window.__game, p = g.player; for (const w of Object.values(p.weapons)) w.reserve = 0; p.debug.switchTo('carbine'); p.weapons.carbine.clip = 10; return p.weapons.carbine.clip === 10 && Object.values(p.weapons).every((w) => w.reserve === 0); });
    if (!set) bad('dry: could not set the ammo (player.weapons not writable — add a debug hook)', 'test');
    const hr = await evs(() => window.__game.story.hitRate?.(0.5));
    ok(hr === 0.5, `hitRate(0.5) (H18) → ${JSON.stringify(hr)}`, 'story');
    const p0 = (await L6()).pickups.length;
    await S6('bot', { seed: 1 });
    // collect the arena's pickups and the lockers between waves (real walking), fight otherwise
    const tEnd = (await ev(() => window.__game.time)) + 480;
    const pend = [...ARENA_PICKUPS, ...LOCKERS6];
    while ((await ev(() => window.__game.time)) < tEnd) {
      const d = await dbg(); if (d.flags?.loaderDead && d.flags?.trunkCut) break;
      const w = await ev(() => window.__game.player.weapons.carbine);
      if (w.reserve < 30 && pend.length && !(await ev(() => window.__S6.awake().length))) {
        const id = pend.shift();
        const pos = await ev((id) => (window.__game.level.pickupSpawns.find((p) => p.id === id) ?? window.__game.interactables.get(id))?.position.toArray() ?? null, id);
        if (pos) { await S6('botStop'); await walkTo(pos, 40); if (LOCKERS6.includes(id)) await use(id); await S6('bot', { seed: 1 }); }
      }
      if (!(await ev(() => window.__S6.awake().length)) && !d.flags?.trunkCut) { await fightUntil('true', 1, true); }
      await gameWait(1.0);
    }
    const log = await S6('botStop'), d = await dbg(), l = await L6();
    const got = l.pickups.slice(p0).filter((x) => /ammo/.test(x.kind)).reduce((s, x) => s + (x.amount ?? 0), 0);
    const left = await ev(() => { const w = window.__game.player.weapons.carbine; return (w.clip ?? 0) + (w.reserve ?? 0); });
    ok(!!d.flags?.loaderDead && !!d.flags?.trunkCut, `dry: the parts and the frame done (loaderDead ${d.flags?.loaderDead}, trunkCut ${d.flags?.trunkCut})`, 'story');
    ok(left / (10 + got) >= 0.3, `dry: ${left} of ${10 + got} rounds left (${f2(left / (10 + got))} ≥ 0.30; shots ${log?.shots})`, 'story');
  }
} else if (MODE === 'ads') {
  // aimed vs hip at a soldier 25–40 m away in tun6_a; hits / shots over 60 s each; aimed ≥ 2 × hip
  console.log('\n══════════ ADS: tun6_a ══════════');
  if (await freshRun('ads', '&nostory=1&give=all')) {
    const need = await missingOf(['room:tun6_a', 'enemies:debug.soldiers']);
    if (need.length) bad(`ads: SKIPPED — needs ${need.map((m) => `${ownerOf(m)}: ${m}`).join(', ')}`, 'level');
    else {
      const res = {};
      for (const aimed of [false, true]) {
        const setup = await ev(() => { const S = window.__S6, g = window.__game, r = g.level.rooms.find((x) => x.id === 'tun6_a'), b = r.bounds; const p0 = S.search(0, b.max.z - 6, 0, null, { maxR: 2 }); if (!p0) return null; const p1 = S.search(0, p0[2] - 32, 0, null, { maxR: 2.5 }); return p1 ? { me: p0, them: p1 } : null; });
        if (!setup) { bad('ads: no two free spots 32 m apart in tun6_a', 'test'); break; }
        const r = await ev(async ([s, aimed]) => {
          const g = window.__game, V = g.player.position.constructor;
          g.player.teleport(new V(s.me[0], s.me[1], s.me[2]), 0, 0);
          g.player.debug.switchTo('carbine');
          await new Promise((q) => setTimeout(q, 600));
          let hits = 0, shots = 0, target = null;
          g.events.on('enemy:damaged', (e) => { if (target && e.id === target.id) hits++; });
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
          return { hits, shots };
        }, [setup, aimed], 120000).catch((e) => ({ err: e.message }));
        res[aimed ? 'aimed' : 'hip'] = r;
        console.log(`  ${aimed ? 'aimed' : 'hip'}: ${JSON.stringify(r)}`);
      }
      const rate = (x) => (x?.shots ? x.hits / x.shots : 0);
      if (res.aimed && res.hip) ok(rate(res.aimed) >= 2 * rate(res.hip) && res.aimed.shots > 20, `aimed hit rate ${f2(rate(res.aimed))} ≥ 2 × hip ${f2(rate(res.hip))}`, 'enemies');
    }
  }
}

await ctxB?.close().catch(() => {});
await browser.close();
clearTimeout(watchdog);
finish();
