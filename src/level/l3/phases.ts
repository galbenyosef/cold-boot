/**
 * THE QUIET SIDE — the phase table (stage 3a §3; R6): the single source of truth for door state per story phase.
 * The story calls `level.applyPhase(id)` (or `applyPhase3`) at every transition and in checkpoint fast-forward and
 * sets none of these doors by hand; `scripts/check-reach.mjs` applies the same phases and proves the `check` data
 * (start / forbid / goal / use) on both decks.
 *
 *   A   lift arriving                  A2  lift open                       B   lift latched (cp3_start)
 *   B2  pressure released              C   the quiet side                  S1  C1 (scene: the inner door opens)
 *   S2  C2 before the takeover         S2T the takeover (sector seal)      E   office, control back (cp3_office)
 *   F   escape (office latched)        G   breach (pressure door + shutter open)
 *   H   purge running                  I   outer lock open                 J   latched inside the outer lock
 *   F_kitchen / H_ring — F / H with the script-only spawn door (d3_kitchen / d3_ring_e) held open for its group
 *   nostory — `?nostory=1`: every door auto except the cabins, kitchen, ring_e (locked) and bio_inner (dark); shutter open
 *
 * Latches (REVISION 5.1 `closeBehind(door, keepSide)`): `LATCHES3` — door, the trigger that arms it, the phase it is
 * armed in, the keep-side test on the player's feet. The story owns the timing (lift open ≥ 1.5 s etc.).
 */
import * as THREE from 'three';
import type { Door, GameContext, Level } from '../../core/types';
import { applyPhaseState, installPhaseTable, type DoorState, type Phase, type PhaseCheck } from '../phases';
import { D2 } from './grey';
export { inRegion } from '../phases';

export type PhaseId3 = 'A' | 'A2' | 'B' | 'B2' | 'C' | 'S1' | 'S2' | 'S2T' | 'E' | 'F' | 'F_kitchen' | 'G' | 'H' | 'H_ring' | 'I' | 'J' | 'nostory';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));

/** §3 named regions (each room id is a region too, added by assembleLevel: floor − 0.5 … floor + h). */
export function REGIONS3(): Record<string, THREE.Box3[]> {
  const cab = (x: number, z0: number, z1: number) => box(x - 0.8, -0.5, z0, x + 0.8, 3.0, z1);
  return {
    garden: [box(-12, -0.5, -44, 9, 2.5, -12)],
    balcony: [box(9, D2 - 0.5, -40, 12, 8, -12), box(5.5, D2 - 0.5, -32, 12, 8, -29)],
    // the plan's regions for the two spaces built as rooms (their interiors)
    kitchen: [box(-24, -0.5, -48, -18, 3, -46.2)],
    ring_e: [box(28.2, -0.5, -33, 31, 3, -29)],
    cabins: [15, 19, 23].flatMap((x) => [cab(x, -27.8, -27.3), cab(x, -34.7, -34.2)]),
    hatch_voids: [box(-18.6, 3.6, -41.6, -17.4, 6.0, -40.4), box(-15.1, 3.6, -38.1, -13.9, 6.0, -36.9), box(-0.7, 13.2, -30.7, 0.7, 15, -29.3)],
    outside: [box(-12, -1, -60, 12, 14, -44.2), box(-40, -1, -46, -24.2, 4, -34)],
    roof: [box(-12, 8.5, -44, 12, 20, -12)],
    feedsets: [box(60, -0.5, -10, 72, 6, 0)],
    // the lock medkit is collected on touch (no interactable): reaching it = feet within ~1 m of it on the lock floor
    p3_lock_med: [box(-3.4, D2 + 0.4, -4.0, -1.4, D2 + 1.6, -2.0)],
  };
}
/** Forbidden in every phase. */
export const ALWAYS3 = ['kitchen', 'ring_e', 'cabins', 'hatch_voids', 'outside', 'roof', 'feedsets'];

export const DOOR_IDS3 = [
  'd3_lift', 'd3_pressure', 'd3_lobby', 'd3_lobby_inner', 'd3_office', 'd3_stair_w', 'd3_canteen', 'd3_canteen_atr', 'd3_kitchen',
  'd3_shutter_ne', 'd3_clinic', 'd3_quarters', 'd3_q1', 'd3_q2', 'd3_q3', 'd3_q4', 'd3_q5', 'd3_q6', 'd3_ring_e', 'd3_bio', 'd3_bio_inner',
] as const;
export type DoorId3 = (typeof DOOR_IDS3)[number];
type Doors = Record<DoorId3, DoorState>;
export const CABINS3: DoorId3[] = ['d3_q1', 'd3_q2', 'd3_q3', 'd3_q4', 'd3_q5', 'd3_q6'];
const cabins = (s: DoorState) => Object.fromEntries(CABINS3.map((id) => [id, s])) as Partial<Doors>;

/** Phase A (lift arriving): everything the story has not opened yet. Cabins: locked + status `private` (§8.12). */
const A: Doors = {
  d3_lift: 'locked', d3_pressure: 'locked', d3_lobby: 'locked', d3_lobby_inner: 'locked', d3_office: 'locked', d3_stair_w: 'locked',
  d3_canteen: 'auto', d3_canteen_atr: 'auto', d3_clinic: 'auto', d3_quarters: 'auto', d3_kitchen: 'locked', d3_ring_e: 'locked',
  d3_shutter_ne: 'locked', ...cabins('locked'), d3_bio: 'locked', d3_bio_inner: 'dark',
} as Doors;
const A2 = { ...A, d3_lift: 'open' } as Doors;
const B = { ...A2, d3_lift: 'locked', d3_pressure: 'shut' } as Doors;
const B2 = { ...B, d3_pressure: 'open' } as Doors;
/**
 * I1 (the user's hand-play): no exploring an empty habitat before the meeting. The north gallery is the whole of C:
 * the shutter at its east end stays down (night setting, signed) and the lobby door is Halvorsen's — he opens it in C1,
 * which starts as soon as the pressure door has latched behind the player.
 */
const C = { ...B2, d3_pressure: 'locked' } as Doors;
const S1 = { ...C, d3_lobby: 'open' } as Doors;
/** C2 at t 0 (snapped in the black): the pressure door shut (the scene opens it on the feed), office shut. */
const S2 = { ...C, d3_lobby: 'auto', d3_lobby_inner: 'locked', d3_office: 'shut' } as Doors;
/** The takeover (C2 t ≈ 19.4, D17): sector seal — pressure, lobby, inner, shutter, cabins locked. */
const SEAL: Partial<Doors> = { d3_pressure: 'locked', d3_lobby: 'locked', d3_lobby_inner: 'locked', d3_shutter_ne: 'locked', ...cabins('locked') };
const S2T = { ...S2, ...SEAL } as Doors;
const E = { ...S2T, d3_office: 'auto', d3_stair_w: 'auto' } as Doors;
const F = { ...E, d3_office: 'locked', d3_lobby_inner: 'auto' } as Doors;
const G = { ...F, d3_pressure: 'open', d3_shutter_ne: 'open' } as Doors;
const H = { ...G, d3_bio: 'cycling' } as Doors;
const I = { ...G, d3_bio: 'auto' } as Doors;
const J = { ...G, d3_bio: 'locked' } as Doors;
const NOSTORY: Doors = Object.fromEntries(DOOR_IDS3.map((id) => [id, 'auto'])) as Doors;
Object.assign(NOSTORY, { ...cabins('locked'), d3_kitchen: 'locked', d3_ring_e: 'locked', d3_bio_inner: 'dark', d3_shutter_ne: 'open' });

/** Phases in which the cabins show `private` (before the takeover). */
const PRIVATE = new Set<PhaseId3>(['A', 'A2', 'B', 'B2', 'C', 'S1', 'S2']);

/** §3 check rows. `stressFloors`: both decks get wreck-box jumps (the stress pass is floor-relative, §8.9). */
type Check3 = PhaseCheck & { stressFloors?: number[] };
const ROOMS_ALL = ['lift3', 'lock', 'gallery_n', 'lobby', 'admin', 'office', 'stair_w', 'canteen', 'atrium', 'clinic', 'quarters', 'bio_lock'];
const ck = (c: Check3): Check3 => ({ ...c, forbid: [...c.forbid, ...ALWAYS3] });
const A2_FORBID = ['gallery_n', 'lobby', 'admin', 'office', 'stair_w', 'canteen', 'atrium', 'clinic', 'quarters', 'bio_lock'];
/** Before the scenes everything east and south of the north gallery (and the lobby) is out of reach (I1). */
const NORTH_ONLY = ['lobby', 'admin', 'office', 'stair_w', 'canteen', 'atrium', 'garden', 'balcony', 'clinic', 'quarters', 'bio_lock'];
const START_LIFT: [number, number, number] = [0, D2, 3.2];
const START_LOCK: [number, number, number] = [0, D2, -3.5];
const START_BIO_DOOR: [number, number, number] = [10.5, D2, -34];

const P = (id: PhaseId3, label: string, doors: Doors, check?: Check3): Phase => ({ id, label, doors, ...(check ? { check } : {}) });

export const PHASES3: Phase[] = [
  P('A', 'lift arriving (d3_lift locked)', A, ck({ start: START_LIFT, forbid: ROOMS_ALL.filter((r) => r !== 'lift3'), goal: ['lift3'], stressFloors: [D2] })),
  P('A2', 'lift open: the lock, nothing beyond', A2, ck({ start: START_LIFT, forbid: A2_FORBID, goal: ['lock', 'lift3'], stressFloors: [D2] })),
  P('B', 'lift latched (cp3_start): pressure door shut', B, ck({ start: START_LOCK, forbid: ['lift3', ...A2_FORBID], goal: ['lock', 'p3_lock_med'], stressFloors: [D2] })),
  P('B2', 'pressure released: the gallery (shutter down, lobby locked)', B2, ck({ start: START_LOCK, forbid: ['lift3', ...NORTH_ONLY], goal: ['gallery_n', 'lock'], stressFloors: [D2] })),
  P('C', 'the pressure door latched: the north gallery only (C1 starts at once)', C, ck({
    start: [0, D2, -9.5], forbid: ['lift3', 'lock', ...NORTH_ONLY], goal: ['gallery_n'], stressFloors: [D2],
  })),
  P('S1', 'C1 (scene, no control): Halvorsen opens the lobby door and comes to meet the player in the gallery', S1),
  P('S2', 'C2 before the takeover (scene, no control)', S2),
  P('S2T', 'C2 after the takeover: sector seal (scene, no control)', S2T),
  P('E', 'office, control back (cp3_office): weapon stowed', E, ck({
    start: [-29.4, D2, -23.6], forbid: ['lift3', 'lock', 'gallery_n', 'lobby', 'bio_lock'],
    goal: ['office', 'admin', 'stair_w', 'canteen', 'garden', 'balcony', 'clinic', 'quarters'],
    use: ['note3_schedule', 'note3_pad', 'note3_memo', 'note3_desk', 'bio_reader'], stressFloors: [0, D2],
  })),
  P('F', 'escape: office latched, admin group through the inner door', F, ck({
    start: [-27, D2, -15], forbid: ['lift3', 'lock', 'gallery_n', 'office', 'bio_lock'],
    goal: ['admin', 'lobby', 'stair_w', 'canteen', 'garden', 'balcony'], stressFloors: [0, D2],
    // (I1: the habitat's readables are found after the takeover now — in the dark, by torch)
    use: ['bio_reader', 'term3_lobby', 'note3_guestbook', 'note3_board', 'note3_canteen', 'note3_quiz', 'note3_clinic_post4', 'note3_clinic_reyes', 'sign3_viewport', 'sign3_bio', 'note3_door'],
  })),
  P('G', 'breach: pressure door and shutter open (gallery + lock a dead end)', G, ck({
    start: [0, 0, -22], forbid: ['lift3', 'office', 'bio_lock'], goal: ['garden', 'balcony', 'gallery_n', 'lock', 'admin', 'lobby'], use: ['bio_reader'], stressFloors: [0, D2],
  })),
  P('H', 'purge running (d3_bio CYCLING)', H, ck({ start: START_BIO_DOOR, forbid: ['lift3', 'office', 'bio_lock'], goal: ['balcony', 'garden'], stressFloors: [0, D2] })),
  P('I', 'outer lock open', I, ck({ start: START_BIO_DOOR, forbid: ['lift3', 'office'], goal: ['bio_lock'], stressFloors: [D2] })),
  P('J', 'latched inside the outer lock', J, ck({ start: [14, D2, -38], forbid: ROOMS_ALL.filter((r) => r !== 'bio_lock'), goal: ['bio_lock'], stressFloors: [D2] })),
  // the two script-only spawn doors standing open for their groups (§5.2: g3_canteen's kitchen husk in F, g3_breach_2 in H)
  P('F_kitchen', 'F with d3_kitchen opened by the script for g3_canteen (no player check: the kitchen stays ALWAYS-forbidden)', { ...F, d3_kitchen: 'open' } as Doors),
  P('H_ring', 'H with d3_ring_e opened by the script for g3_breach_2', { ...H, d3_ring_e: 'open' } as Doors),
  P('nostory', '?nostory=1: every door auto except cabins / kitchen / ring_e (locked), bio_inner (dark); shutter open', NOSTORY),
];

/** Cabin panels: `private` before the takeover (§8.12; drawn as plain locked until the level implements it). */
function cabinStatus(level: Level, id: string) {
  const s = PRIVATE.has(id as PhaseId3) ? 'private' : null;
  for (const c of CABINS3) {
    const d = level.doors.find((x) => x.id === c);
    try { (d as Door | undefined)?.setStatus(s); } catch { /* a build without 'private' */ }
  }
}

/** Apply a phase to a level object directly (build time, before `ctx.level` is set). */
export function applyPhaseTo(level: Level, id: PhaseId3, snap = true) {
  const p = PHASES3.find((x) => x.id === id)!;
  applyPhaseState({ level } as unknown as GameContext, p, { snap });
  cabinStatus(level, id);
}

/** THE call the story makes at each transition (`{ snap: true }` in checkpoint fast-forward). */
export function applyPhase3(ctx: GameContext, id: PhaseId3, opts: { snap?: boolean } = {}): boolean {
  const p = PHASES3.find((x) => x.id === id);
  if (!p) { console.warn(`[phases] unknown phase "${id}"`); return false; }
  applyPhaseState(ctx, p, opts);
  cabinStatus(ctx.level, id);
  return true;
}

// ───────────────────────────────────────────────────────────── latches (§3)

export interface Latch3 {
  door: DoorId3;
  /** Trigger that arms it (`trigger:enter`), and the phase in which it is armed. */
  armedBy: string; phase: PhaseId3;
  /** Phase applied when the latch holds. */
  then: PhaseId3;
  /** Feet on the keep side (the side the player must end up on). */
  keepSide: (p: THREE.Vector3) => boolean;
  /** Plain-language note for the story (extra arming conditions). */
  note: string;
}
export const LATCHES3: Latch3[] = [
  { door: 'd3_lift', armedBy: 't3_lock', phase: 'A2', then: 'B', keepSide: (p) => p.z < -0.6, note: 'only after the lift has been open ≥ 1.5 s; on fail: reopen, re-arm' },
  { door: 'd3_pressure', armedBy: 't3_gallery', phase: 'B2', then: 'C', keepSide: (p) => p.z < -7.7, note: 'on fail: reopen, re-arm; panel CLEAR THE DOOR' },
  { door: 'd3_office', armedBy: 't3_office_out', phase: 'E', then: 'F', keepSide: (p) => p.z > -19.6, note: 'on fail: reopen, re-arm; the weapon stays stowed (D23)' },
  { door: 'd3_bio', armedBy: 't3_bio_lock', phase: 'I', then: 'J', keepSide: (p) => p.x > 12.4, note: 'on fail: reopen, re-arm (enemies in the doorway are pushed; doors never crush)' },
];

export function installPhases3(ctx: GameContext, level: Level) {
  installPhaseTable(ctx, level, PHASES3, (id) => cabinStatus(ctx.level ?? level, id));
  (level as unknown as { latches: Latch3[] }).latches = LATCHES3;
}
