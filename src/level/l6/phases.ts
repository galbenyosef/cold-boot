/**
 * THE TRUNK — the phase table (stage 3d §3; R6): the single source of truth for door state per story phase. The story
 * calls `level.applyPhase(id)` (or `applyPhase6`) at every transition and in checkpoint fast-forward and sets none of
 * these doors by hand; scripts/check-reach.mjs applies the same phases and proves the `check` data.
 *
 *   A  arrival (cp6_start)   T  tube open   U  latched (cp6_tunnel)   B  bay live (cp6_rep, cp6_he)
 *   B_hold  hold6's door standing open for F4 / F5 (variant)   K  shaft open (cp6_shaft, cp6_m*, cp6_quiet)
 *   K_stores  stores6's door standing open for W1 (variant)   nostory — `?nostory=1`
 * Check-only flag rows (never applied by the story; same doors as their base): U_man (manual: Key A held), U_pull (the
 * enclosure open: the loom usable), K_end (the ending pending: the console usable).
 *
 * Interactables are NOT switched by phases (W4a decision): every story-owned one (the loom, the console, the handset,
 * the lockers, the frame) keeps whatever the story set — a later `applyPhase` (a latch's B_hold → B) can therefore never
 * undo a key's consequence (the B4 class). The frame's controls are made unusable outside the cage by their
 * `requireRegion: 't6_cage'`; the chamber is unreachable before K anyway.
 *
 * Extra check-row fields (for W4b's check-reach): `stressFloors`, `mustNotUse` (as 3c; `{ id, eye }`), `snaps`,
 * `crouchOnly`, and the stage-3d ones W4b's check-reach reads: `hazards` (regions never entered on any simulated step,
 * incl. jump arcs — §2.10, §10.2) and `walks` (the trench crossing). The `requireRegion` interactables (frame6_*,
 * console6, shaft6_lock) are honoured by check-reach itself (S8g). U_pull / K_end do not list the loom / the console in
 * `use`: both are story-enabled, and a check-only enabling snap (`check6_loom`, `check6_console`, grey.ts) leaks into the
 * later phases of the same page (deferred: check-reach reloads per row — W4b).
 */
import * as THREE from 'three';
import type { GameContext, Level } from '../../core/types';
import type { MachineState } from '../context';
import { applyPhaseState, installPhaseTable, type DoorState, type Phase, type PhaseCheck } from '../phases';
import {
  CAGE6, DEEP6, ENCLOSURE6, GALLERIES6, OUTSIDE6, ROOMS6, ROOM_IDS6, TRENCH6, TRENCH_LOW6, UNDERCROFT6, VOIDS6, WETDOCK6, box3,
  type RoomId6,
} from './grey';
export { inRegion } from '../phases';

export type PhaseId6 = 'A' | 'T' | 'U' | 'B' | 'B_hold' | 'U_man' | 'U_pull' | 'K' | 'K_stores' | 'K_end' | 'nostory';

/** §2.3 trigger boxes that are also regions (`requireRegion` reads `level.regions`). */
export const T6_CAGE: [number, number, number, number, number, number] = [-55.0, -16.5, -172.0, -49.0, -13.0, -166.0];
/** In front of and beside the console desk (x −46 … −42, z −158.6 … −157.8), mid deck only (dock −20 / galleries −12 out). */
export const T6_CONSOLE: [number, number, number, number, number, number] = [-47.4, -16.5, -161.2, -40.6, -13.5, -157.8];

/** §2.1 / §3 named regions (each room id is a region too, added by assembleLevel). */
export function REGIONS6(): Record<string, THREE.Box3[]> {
  const room = (id: RoomId6) => { const r = ROOMS6[id]; return box3([r.x0, r.y0 - 0.5, r.z0, r.x1, r.y0 + r.h, r.z1]); };
  return {
    trench: TRENCH6.map(box3),
    /** (check data) the crouch-only part of the trench — no standing node may exist in it. */
    trench_low: TRENCH_LOW6.map(box3),
    cage: [box3(CAGE6)],
    t6_cage: [box3(T6_CAGE)],
    t6_console: [box3(T6_CONSOLE)],
    undercroft: [box3(UNDERCROFT6)],
    wet: [box3(WETDOCK6)],
    /** the dock deck (incl. the undercroft and the window walk), y −20 band. */
    dock: [box3([-75.8, -20.5, -195.8, -28.2, -16.3, -148.2])],
    mid: [box3([-72.8, -16.5, -166.0, -31.2, -13.0, -148.2]), box3(CAGE6)],
    gallery: GALLERIES6.map(([x0, x1, z0, z1]) => box3([x0, -12.5, z0, x1, -9.0, z1])),
    window_walk: [box3([-75.8, -20.5, -195.8, -28.2, -18.0, -194.0])],
    deep: [box3(DEEP6)],
    enclosure: [box3(ENCLOSURE6)],
    outside: [box3(OUTSIDE6)],
    voids: Object.values(VOIDS6).map(box3),
    /** (check data) the head-end's / vault's main floors only (their room regions also hold the trench). */
    he6_main: [box3([2, -0.05, -180, 22, 4.5, -160])],
    vault6_main: [box3([-22, -0.05, -180, 2, 6.0, -148])],
    /** §2.7.3 `regions.dark` (the soldier and check:dark read it; check:reach ignores it); vignettes extend it. */
    dark: [room('tun6_b'), ...TRENCH6.map(box3)],
  };
}
/** Forbidden in every phase (§3 `ALWAYS6`). */
export const ALWAYS6 = ['feed6', 'deep', 'enclosure', 'outside', 'voids'];

export const DOOR_IDS6 = ['d6_tube', 'd6_bay', 'd6_he', 'd6_vault', 'd6_hold', 'd6_shaft', 'd6_pool', 'd6_stores'] as const;
export type DoorId6 = (typeof DOOR_IDS6)[number];
type Doors = Record<DoorId6, DoorState>;

const A: Doors = { d6_tube: 'cycling', d6_bay: 'locked', d6_he: 'auto', d6_vault: 'auto', d6_hold: 'locked', d6_shaft: 'locked', d6_pool: 'auto', d6_stores: 'locked' };
const T: Doors = { ...A, d6_tube: 'open' };
const U: Doors = { ...T, d6_tube: 'locked' };
const B: Doors = { ...U, d6_bay: 'auto' };
const B_HOLD: Doors = { ...B, d6_hold: 'open' };
const K: Doors = { ...B, d6_shaft: 'auto', d6_hold: 'locked' };
const K_STORES: Doors = { ...K, d6_stores: 'open' };
const NOSTORY: Doors = Object.fromEntries(DOOR_IDS6.map((id) => [id, 'auto'])) as Doors;
Object.assign(NOSTORY, { d6_hold: 'locked', d6_stores: 'locked' });

/** `trench6` is the machine the one-way `hatch6_he` edge keys on (check-reach: a one-way edge needs a running machine). */
const MACHINES: Record<string, MachineState> = { trench6: 'active' };

export type Check6 = PhaseCheck & {
  stressFloors?: number[];
  mustNotUse?: (string | { id: string; eye?: [number, number] })[];
  snaps?: string[];
  crouchOnly?: string[];
  /** Regions never entered on any simulated step (walking, falling, jumping) — check-reach `hazards`. */
  hazards?: string[];
  /** Separate floods: from `from` (inside `within`) `to` must be reached (§10.2 (5): the under-wall crossing). */
  walks?: { id: string; from: [number, number, number]; to: [number, number, number]; within?: string[]; tol?: number }[];
};
const ck = (c: Check6): Check6 => ({ ...c, forbid: [...new Set([...c.forbid, ...ALWAYS6])] });
const but = (...keep: RoomId6[]) => ROOM_IDS6.filter((r) => !keep.includes(r));

const FRAME = ['frame6_pin', 'frame6_pump', 'frame6_lever'];
const PICK_U = [
  'p6_tun_med', 'p6_tun_ammo', 'p6_tun_plate', 'p6_rep_ammo_1', 'p6_rep_ammo_2', 'p6_rep_med', 'p6_rep_shells', 'p6_tunb_ammo', 'p6_tunb_med',
  'p6_he_vest', 'p6_he_ammo_1', 'p6_he_ammo_2', 'p6_he_med', 'p6_he_shells', 'p6_he_pistol', 'p6_vault_ammo', 'p6_vault_med', 'p6_vault_plate',
  'p6_trench_plate_1', 'p6_trench_plate_2', 'p6_trench_ammo_1', 'p6_trench_ammo_2', 'p6_trench_med',
];
const USE_U = ['he6_switch', 'note6_queue', 'note6_jobcard', 'note6_jointer', 'hatch6_vault', 'hatch6_he', 'vault6_lock', 'shaft6_lock', ...PICK_U];
const NOT_U: Check6['mustNotUse'] = [...FRAME, 'console6', { id: 'hatch6_he', eye: [-0.2, 99] }, { id: 'hatch6_he_plate', eye: [-99, -0.2] }, 'vault6_loom'];
const GOAL_U = ['tun6_a', 'rep6', 'tun6_b', 'he6', 'vault6', 'trench'];
const PICK_B = ['p6_bay_plate', 'p6_bay_ammo'];
const PICK_K = [
  'p6_shaft_ammo', 'p6_shaft_med', 'p6_ge_med', 'p6_gw_plate', 'p6_mid_ammo', 'p6_mid_med', 'p6_mid_plate', 'p6_uc_ammo_1', 'p6_uc_ammo_2',
  'p6_uc_med', 'p6_uc_plate', 'p6_ww_ammo', 'p6_ww_med', 'p6_cage_ammo', 'p6_cage_plate',
];
const USE_K = [...FRAME, ...PICK_K, 'locker6_e', 'locker6_w', 'locker6_n', 'note6_transfer'];
/**
 * §3 `stressFloors` minus the trench's −1.4 (W4a): the trench is crouch-only (1.35 m) and its pit floors are 0.45 m strips,
 * so no wreck box can lie under a standing node there and check-reach's stress pass reports the floor as untried.
 */
const STRESS_TOP = [0];
const STRESS_K = [0, -3, -6, -9, -12, -16, -20, -20.8, -21.3];
const SNAPS_U = ['hatch6_vault_open'];
/** §10.2 (5): T-b → T-c under the he6 / vault6 wall, inside the trench. */
const WALKS_U: Check6['walks'] = [{ id: 'trench_crossing', from: [-4.0, -1.4, -178.8], to: [3.0, -1.4, -178.8], within: ['trench'] }];
const GOAL_K = ['shaft6', 'pool6', 'dock', 'mid', 'cage', 'gallery', 'undercroft', 'wet', 'window_walk', ...GOAL_U, 'bay6'];

const P = (id: PhaseId6, label: string, doors: Doors, check?: Check6): Phase =>
  ({ id, label, doors, machines: MACHINES, ...(check ? { check } : {}) });

export const PHASES6: Phase[] = [
  P('A', 'arrival (cp6_start): the tube cycling (the story opens it at 3.0 s)', A, ck({ start: [0, 0, 3.0], forbid: but('lock6'), goal: ['lock6'], use: ['p6_lock_ammo'], stressFloors: [0] })),
  P('T', 'tube open', T, ck({
    start: [0, 0, 2.0], forbid: ['shaft6', 'pool6', 'stores6', 'hold6', 'bay6'], goal: ['lock6', 'tun6_a', 'rep6', 'tun6_b', 'he6', 'vault6'],
    use: USE_U, mustNotUse: NOT_U, snaps: SNAPS_U, crouchOnly: ['trench_low'], stressFloors: STRESS_TOP,
  })),
  P('U', 'latched (cp6_tunnel): the tube shut behind him', U, ck({
    start: [0, 0, -10.0], forbid: ['lock6', 'shaft6', 'pool6', 'stores6', 'hold6', 'bay6'], goal: GOAL_U,
    use: USE_U, mustNotUse: NOT_U, snaps: SNAPS_U, crouchOnly: ['trench_low'], walks: WALKS_U, stressFloors: STRESS_TOP,
  })),
  P('B', 'bay live (cp6_rep, cp6_he): d6_bay auto from the F2 spawn', B, ck({
    start: [4.0, 0, -86.0], forbid: ['lock6', 'shaft6', 'pool6', 'stores6', 'hold6'], goal: [...GOAL_U, 'bay6'],
    use: [...USE_U, ...PICK_B], mustNotUse: NOT_U, snaps: SNAPS_U, crouchOnly: ['trench_low'], stressFloors: STRESS_TOP,
  })),
  P('B_hold', 'F4 / F5 walking out: d6_hold open (hold6 neither forbidden nor goal)', B_HOLD, ck({
    start: [-14.0, 0, -152.0], forbid: ['lock6', 'shaft6', 'pool6', 'stores6'], goal: [...GOAL_U, 'bay6'],
    use: [...USE_U, ...PICK_B], mustNotUse: NOT_U, snaps: SNAPS_U, stressFloors: STRESS_TOP,
  })),
  P('U_man', 'check: manual (cp6_manual) — Key A held, the lock opens', B, ck({
    start: [18.0, 0, -171.0], forbid: ['lock6', 'shaft6', 'pool6', 'stores6', 'hold6'], goal: [...GOAL_U, 'bay6'],
    use: [...USE_U, ...PICK_B], mustNotUse: NOT_U, snaps: SNAPS_U, stressFloors: STRESS_TOP,
  })),
  P('U_pull', 'check: the enclosure open — the loom usable', B, ck({
    start: [-12.0, 0, -177.6], forbid: ['lock6', 'shaft6', 'pool6', 'stores6', 'hold6'], goal: [...GOAL_U, 'bay6'],
    use: [...USE_U, ...PICK_B], mustNotUse: NOT_U.filter((x) => x !== 'vault6_loom'), snaps: [...SNAPS_U, 'bj6_open'],
    stressFloors: STRESS_TOP,
  })),
  P('K', 'shaft open (cp6_shaft, cp6_m*, cp6_quiet): d6_shaft auto (Key B used)', K, ck({
    start: [-24.5, 0, -170.0], forbid: ['lock6', 'hold6', 'stores6'], goal: GOAL_K,
    use: USE_K, mustNotUse: ['console6'], hazards: ['deep'],
    snaps: SNAPS_U, stressFloors: STRESS_K,
  })),
  P('K_stores', 'K with d6_stores opened by the script for W1', K_STORES),
  P('K_end', 'check: the ending pending — the console usable', K, ck({
    start: [-44.0, -16, -160.4], forbid: ['lock6', 'hold6', 'stores6'], goal: GOAL_K,
    use: USE_K, hazards: ['deep'], snaps: SNAPS_U, stressFloors: STRESS_K,
  })),
  P('nostory', '?nostory=1: every door auto except d6_hold, d6_stores (locked)', NOSTORY),
];

/** Apply a phase to a level object directly (build time, before `ctx.level` is set). */
export function applyPhaseTo6(_ctx: GameContext, level: Level, id: PhaseId6, snap = true) {
  const p = PHASES6.find((x) => x.id === id)!;
  applyPhaseState({ level } as unknown as GameContext, p, { snap });
}

/** THE call the story makes at each transition (`{ snap: true }` in checkpoint fast-forward). */
export function applyPhase6(ctx: GameContext, id: PhaseId6, opts: { snap?: boolean } = {}): boolean {
  const p = PHASES6.find((x) => x.id === id);
  if (!p) { console.warn(`[phases] unknown phase "${id}"`); return false; }
  applyPhaseState(ctx, p, opts);
  return true;
}

// ───────────────────────────────────────────────────────────── latches (§3)

export interface Latch6 {
  door: DoorId6;
  armedBy: string; phase: PhaseId6;
  /** Phase applied when the latch holds. */
  then: PhaseId6;
  /** Feet on the keep side (the side the player must end up on). */
  keepSide: (p: THREE.Vector3) => boolean;
  onFail: string;
  note: string;
}
export const LATCHES6: Latch6[] = [
  { door: 'd6_tube', armedBy: 't6_tube', phase: 'T', then: 'U', keepSide: (p) => p.z < -0.6, onFail: 'reopen, re-arm; panel CLEAR THE TUBE', note: '§4.1' },
  { door: 'd6_hold', armedBy: 'last member at z < −148.6, or 10 s', phase: 'B_hold', then: 'B', keepSide: (p) => p.z < -148.6, onFail: 'stays open, retries every 2 s', note: '§4.5 / §4.6 (F4, F5)' },
  { door: 'd6_stores', armedBy: 'last W1 member at z < −148.6, or 10 s', phase: 'K_stores', then: 'K', keepSide: (p) => p.z < -148.6, onFail: 'stays open, retries every 2 s', note: '§4.8 (W1; its twin on restore)' },
];

export function installPhases6(ctx: GameContext, level: Level) {
  installPhaseTable(ctx, level, PHASES6);
  (level as unknown as { latches: Latch6[] }).latches = LATCHES6;
}
