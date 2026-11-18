/**
 * POST 4 — the phase table (stage 3c §3; R6): the single source of truth for door state (and the interactables a
 * phase switches) per story phase. The story calls `level.applyPhase(id)` (or `applyPhase5`) at every transition and in
 * checkpoint fast-forward and sets none of these doors by hand; scripts/check-reach.mjs applies the same phases and
 * proves the `check` data.
 *
 *   A   arrival (cp5_start: the story opens d5_gate 0.4 … 2.8 s)   B   gatehouse        B2  gate shut (latched)
 *   C   the cutscene (d5_duty opened, d5_ready scripted)            D0  hand-back        D   duty (units in)
 *   K   keypad live (cp5_radio)                                     S   Post 4 (cp5_spine)
 *   V   verified (cp5_door, cp5_bay)                                W   tunnel released  X   sealed in the tunnel
 *   S_dive / V_lock / W_lock — the script-only spawn doors standing open for their waves (no player checks)
 *   nostory — `?nostory=1`: every door auto except d5_dive, d5_lockside (locked)
 * Check-only variants (never applied by the story): S_out (start in the magazine, spine hatch open: the way back
 * out through the crawl), S_up (start in the magazine, magazine hatch open from below: the one-way exit).
 *
 * Interactables switched per phase (`INTERACT5`, applied by `applyPhase` with the doors): `hatch5_spine` usable from
 * S on, `launch5_palm` from S on (refuses), `wheel5` from V on (disabled in S, §3 "must not be usable"). The story still
 * owns everything else (prompts, `radio5`, `key5_duty`'s power state) and may disable these after use.
 *
 * Corrections (W4): `d5_dive` is `auto` from V on (the table left it latched from S, which made `note5_dive` and
 * `p5_dive_shells` — in V's `use` list — unreachable for ever); `note5_dive` / `p5_dive_shells` are therefore proved
 * in V, not S. `d5_gate` in A is `shut` (unlocked, closed, not auto: the story opens it at 0.4 s).
 */
import * as THREE from 'three';
import type { GameContext, Level } from '../../core/types';
import type { MachineState } from '../context';
import { applyPhaseState, installPhaseTable, type DoorState, type Phase, type PhaseCheck } from '../phases';
import { BOOTH5, CMD5, COLDROOM5, CRAWL5, CRAWL_LOW5, MAG5, OUTSIDE5, ROOM_IDS5, ROOMS5, VOIDS5, WALKWAY5, box3, type RoomId5 } from './grey';
export { inRegion } from '../phases';

export type PhaseId5 = 'A' | 'B' | 'B2' | 'C' | 'D0' | 'D' | 'K' | 'S' | 'S_dive' | 'V' | 'V_lock' | 'W' | 'W_lock' | 'X' | 'nostory' | 'S_out' | 'S_up';

/** §3 named regions (each room id is a region too, added by assembleLevel: lowest floor − 0.5 … floor + h). */
/** `wet` = the dressing's puddle boxes (grey.ts `addWet`; audio's `wet` footsteps). */
export function REGIONS5(wet: THREE.Box3[] = []): Record<string, THREE.Box3[]> {
  const room = (id: RoomId5) => { const r = ROOMS5[id]; return box3([r.x0, r.y0 - 0.5, r.z0, r.x1, r.y0 + r.h, r.z1]); };
  return {
    crawl: CRAWL5.map(box3),
    magazine: MAG5.map(box3),
    /** (check data) the crouch-only part of the crawl — no standing node may exist in it. */
    crawl_low: CRAWL_LOW5.map(box3),
    /** (check data) the sub-bay gallery decks and the bridge (§3 S goal "sub5 (both decks)"). */
    sub5_deck: (ROOMS5.sub5.floors ?? []).map((f) => box3([f.box[0], f.y - 0.1, f.box[2], f.box[1], f.y + 2.5, f.box[3]])),
    wet,
    walkway: [box3(WALKWAY5)],
    /** §8.4 / S1n (W3b reads it): enemies standing off a crawl exit never stand inside this box (the walkway by the pit). */
    exit_keepout: [box3(WALKWAY5)],
    /** (check data) the spine's / armoury's main floor only (their room regions also hold the crawl / magazine). */
    spine5_main: [box3([8, -0.05, -18, 44, 3.2, -14])],
    arm5_main: [box3([14, -0.05, -28, 22, 3.2, -18])],
    booth: [box3(BOOTH5)],
    cmd: [box3(CMD5)],
    outside: [box3(OUTSIDE5), box3(COLDROOM5)],
    voids: Object.values(VOIDS5).map(box3),
    /** §2.7.3 `regions.dark` (the soldier and check:dark read it; check:reach ignores it). `dark5_on` adds spine5 + sub5. */
    dark: [...CRAWL5.map(box3), ...MAG5.map(box3), room('berths5'), room('dive5')],
  };
}
/** Forbidden in every phase (§3 `ALWAYS5`; the cold room behind the galley pane counts as `outside`). */
export const ALWAYS5 = ['booth', 'cmd', 'outside', 'voids'];

export const DOOR_IDS5 = [
  'd5_gate', 'd5_duty', 'd5_ready', 'd5_key', 'd5_berth', 'd5_mess', 'd5_berth_mess', 'd5_heads', 'd5_galley', 'd5_arm',
  'd5_arm_bay', 'd5_bay', 'd5_dive', 'd5_lockside', 'd5_tunnel',
] as const;
export type DoorId5 = (typeof DOOR_IDS5)[number];
type Doors = Record<DoorId5, DoorState>;

const A: Doors = {
  d5_gate: 'shut', d5_duty: 'locked', d5_ready: 'locked', d5_key: 'locked',
  d5_berth: 'auto', d5_mess: 'auto', d5_berth_mess: 'auto', d5_heads: 'auto', d5_galley: 'auto', d5_arm: 'auto', d5_arm_bay: 'auto', d5_bay: 'auto',
  d5_dive: 'locked', d5_lockside: 'locked', d5_tunnel: 'locked',
};
const B: Doors = { ...A, d5_gate: 'open' };
const B2: Doors = { ...B, d5_gate: 'locked' };
const C: Doors = { ...B2, d5_duty: 'open', d5_ready: 'shut' };
const D0: Doors = { ...C, d5_duty: 'auto', d5_ready: 'locked' };
const D: Doors = { ...D0, d5_ready: 'auto' };
const K: Doors = { ...D };
const S: Doors = { ...K, d5_key: 'auto' };
const V: Doors = { ...S, d5_dive: 'auto', d5_tunnel: 'cycling' };
const W: Doors = { ...V, d5_tunnel: 'auto' };
const X: Doors = { ...W, d5_tunnel: 'locked' };
const NOSTORY: Doors = Object.fromEntries(DOOR_IDS5.map((id) => [id, 'auto'])) as Doors;
Object.assign(NOSTORY, { d5_gate: 'open', d5_dive: 'locked', d5_lockside: 'locked' });

/** Interactables a phase switches (enabled) — see the header. */
type Interact = Record<string, boolean>;
const I_PRE: Interact = { hatch5_spine: false, launch5_palm: false, wheel5: false };
const I_S: Interact = { hatch5_spine: true, launch5_palm: true, wheel5: false };
const I_V: Interact = { hatch5_spine: true, launch5_palm: true, wheel5: true };

const MACHINES: Record<string, MachineState> = { tern: 'active' };

/** §3 check rows (+ W4 fields read by scripts/check-reach.mjs: `mustNotUse`, `snaps`, `crouchOnly`, `stressFloors`). */
export type Check5 = PhaseCheck & {
  stressFloors?: number[];
  /** Interactables that must NOT be usable (R8 with line of sight; a disabled one passes). `eye` = [min, max] eye y. */
  mustNotUse?: (string | { id: string; eye?: [number, number] })[];
  /** Vignette snaps applied before the flood (world state the story would have made: an opened hatch). */
  snaps?: string[];
  /** Regions where no reachable node may stand up (crouch only). */
  crouchOnly?: string[];
};
const ck = (c: Check5): Check5 => ({ ...c, forbid: [...new Set([...c.forbid, ...ALWAYS5])] });
const but = (...keep: RoomId5[]) => ROOM_IDS5.filter((r) => !keep.includes(r));
const BEYOND_DUTY: RoomId5[] = ['spine5', 'berths5', 'heads5', 'mess5', 'galley5', 'arm5', 'sub5', 'dive5', 'lockacc5', 'tunnel5'];
const READ_S = ['note5_visitors', 'note5_watch', 'note5_roster', 'note5_locker', 'note5_mess', 'note5_arm', 'note5_mag'];
const PICK_FORE = ['p5_gate_med', 'p5_duty_ammo', 'p5_ready_med', 'p5_ready_ammo'];
const PICK_S = [
  ...PICK_FORE, 'p5_berth_med', 'p5_berth_shells', 'p5_mess_ammo', 'p5_galley_med', 'p5_arm_vest', 'p5_arm_carbine', 'p5_arm_ammo_1', 'p5_arm_ammo_2',
  'p5_arm_shells', 'p5_arm_plate', 'p5_mag_ammo_1', 'p5_mag_ammo_2', 'p5_mag_ammo_3', 'p5_mag_pistol', 'p5_mag_plate_1', 'p5_mag_plate_2', 'p5_mag_med',
  'p5_spine_ammo', 'p5_bay_med_1', 'p5_bay_ammo_1', 'p5_wheel_plate', 'p5_wheel_ammo', 'p5_bay_med_2',
];
const S_GOALS = ['gate5', 'duty5', 'ready5', 'spine5', 'berths5', 'heads5', 'mess5', 'galley5', 'arm5', 'sub5', 'sub5_deck', 'crawl', 'magazine'];
const STRESS_LOW = [-2.6, -1.4, 0, 4.8];

const P = (id: PhaseId5, label: string, doors: Doors, interact: Interact, check?: Check5): Phase & { interact: Interact } =>
  ({ id, label, doors, machines: MACHINES, interact, ...(check ? { check } : {}) });

export const PHASES5: (Phase & { interact: Interact })[] = [
  P('A', 'arrival (cp5_start): in the gate lock, d5_gate shut (the story raises it)', A, I_PRE, ck({ start: [0, 0, 3.0], forbid: but('lock5'), goal: ['lock5'], stressFloors: [0] })),
  P('B', 'gatehouse: the gate open; the duty door locked', B, I_PRE, ck({
    start: [0, 0, -3.0], forbid: [...BEYOND_DUTY, 'duty5', 'ready5', 'crawl', 'magazine'], goal: ['lock5', 'gate5'],
    use: ['note5_visitors', 'p5_gate_med'], mustNotUse: ['key5_duty', 'note5_watch'], stressFloors: [0],
  })),
  P('B2', 'gate shut (latched): the gatehouse alone', B2, I_PRE, ck({
    start: [0, 0, -6.0], forbid: ['lock5', ...BEYOND_DUTY, 'duty5', 'ready5', 'crawl', 'magazine'], goal: ['gate5'],
    use: ['note5_visitors', 'p5_gate_med'], mustNotUse: ['key5_duty', 'note5_watch'], stressFloors: [0],
  })),
  P('C', 'the cutscene: d5_duty open, d5_ready scripted (shut)', C, I_PRE, ck({ start: [0, 0, -12.4], forbid: but('gate5', 'duty5'), goal: [], stressFloors: [0] })),
  P('D0', 'hand-back: d5_ready locked until +2.5 s', D0, I_PRE),
  P('D', 'duty (cp5_duty, cp5_ready): the units, the first soldier', D, I_PRE, ck({
    start: [0.4, 0, -13.8], forbid: ['lock5', ...BEYOND_DUTY, 'crawl', 'magazine'], goal: ['gate5', 'duty5', 'ready5'],
    use: ['note5_watch', 'note5_roster', 'note5_locker', 'p5_duty_ammo', 'p5_ready_med', 'p5_ready_ammo'], stressFloors: [0],
  })),
  P('K', 'keypad live (cp5_radio): same doors as D', K, I_PRE, ck({
    start: [2.0, 0, -16.0], forbid: ['lock5', ...BEYOND_DUTY, 'crawl', 'magazine'], goal: ['gate5', 'duty5', 'ready5'],
    use: ['key5_duty', ...PICK_FORE], mustNotUse: ['hatch5_spine'], stressFloors: [0],
  })),
  P('S', 'Post 4 (cp5_spine): the spine, quarters, armoury, sub bay, crawl and magazine', S, I_S, ck({
    start: [10.0, 0, -16.0], forbid: ['lock5', 'dive5', 'lockacc5', 'tunnel5'], goal: S_GOALS,
    use: ['hatch5_spine', 'hatch5_mag', 'hatch5_mag_plate', 'launch5_palm', ...READ_S, ...PICK_S],
    mustNotUse: ['wheel5', { id: 'hatch5_mag', eye: [-0.2, 99] }, { id: 'hatch5_mag_plate', eye: [-99, -0.2] }],
    snaps: ['hatch5_spine_open'], crouchOnly: ['crawl_low'], stressFloors: STRESS_LOW,
  })),
  P('S_dive', 'S with d5_dive opened by the script for g5_spine', { ...S, d5_dive: 'open' }, I_S),
  P('V', 'verified (cp5_door, cp5_bay): the tunnel released to the wheel; lights out', V, I_V, ck({
    start: [41.0, 0, -16.0], forbid: ['lock5', 'lockacc5', 'tunnel5'], goal: [...S_GOALS, 'dive5'],
    use: ['wheel5', 'p5_bay_med_1', 'p5_bay_ammo_1', 'p5_bay_med_2', 'p5_wheel_plate', 'p5_wheel_ammo', 'p5_dive_shells', 'note5_dive'],
    snaps: ['hatch5_spine_open'], crouchOnly: ['crawl_low'], stressFloors: STRESS_LOW,
  })),
  P('V_lock', 'V with d5_lockside opened by the script (g5_cmd soldier, g5_bay_a)', { ...V, d5_lockside: 'open' }, I_V),
  P('W', 'tunnel released (wheel done): d5_tunnel auto', W, I_V, ck({
    start: [24.0, 4.8, -51.0], forbid: ['lock5', 'lockacc5'], goal: ['tunnel5', 'sub5', 'sub5_deck'], use: ['p5_tunnel_med'], stressFloors: [0, 4.8],
  })),
  P('W_lock', 'W with d5_lockside opened by the script (g5_bay_b husk)', { ...W, d5_lockside: 'open' }, I_V),
  P('X', 'sealed in the tunnel (latched)', X, I_V, ck({ start: [18.0, 0, -53.0], forbid: but('tunnel5'), goal: ['tunnel5'], stressFloors: [0] })),
  P('nostory', '?nostory=1: every door auto except d5_dive, d5_lockside (locked)', NOSTORY, I_V),
  // check-only variants (the crawl, W4)
  P('S_out', 'check: from the magazine back out through the crawl and the spine hatch (magazine hatch shut, no one-way)', S, I_S, ck({
    start: [17.0, -2.6, -24.5], forbid: ['lock5', 'dive5', 'lockacc5', 'tunnel5'], goal: ['magazine', 'crawl', 'walkway', 'spine5_main', 'arm5_main'],
    oneway: false, snaps: ['hatch5_spine_open'], crouchOnly: ['crawl_low'], stressFloors: [-2.6],
  })),
  P('S_up', 'check: from the magazine up the stair through the hatch opened from below (spine hatch shut, no one-way)', S, I_S, ck({
    start: [17.0, -2.6, -24.5], forbid: ['lock5', 'dive5', 'lockacc5', 'tunnel5'], goal: ['magazine', 'crawl', 'arm5_main', 'spine5_main'],
    oneway: false, snaps: ['hatch5_mag_open'], crouchOnly: ['crawl_low'], stressFloors: [-2.6, 0],
  })),
];

/** Apply a phase to a level object directly (build time, before `ctx.level` is set). */
export function applyPhaseTo5(ctx: GameContext, level: Level, id: PhaseId5, snap = true) {
  const p = PHASES5.find((x) => x.id === id)!;
  applyPhaseState({ level } as unknown as GameContext, p, { snap });
  applyInteract(ctx, p.interact);
}

function applyInteract(ctx: GameContext, map: Interact) {
  for (const [id, on] of Object.entries(map)) {
    const it = ctx.interactables.get(id);
    if (it) it.enabled = on; else console.warn(`[phases] unknown interactable "${id}"`);
  }
}

/** THE call the story makes at each transition (`{ snap: true }` in checkpoint fast-forward). */
export function applyPhase5(ctx: GameContext, id: PhaseId5, opts: { snap?: boolean } = {}): boolean {
  const p = PHASES5.find((x) => x.id === id);
  if (!p) { console.warn(`[phases] unknown phase "${id}"`); return false; }
  applyPhaseState(ctx, p, opts);
  applyInteract(ctx, p.interact);
  return true;
}

// ───────────────────────────────────────────────────────────── latches (§3)

export interface Latch5 {
  door: DoorId5;
  /** Trigger that arms it (`trigger:enter`), or the rule (story) for the spawn doors; and the phase it is armed in. */
  armedBy: string; phase: PhaseId5;
  /** Phase applied when the latch holds. */
  then: PhaseId5;
  /** Feet on the keep side (the side the player must end up on). */
  keepSide: (p: THREE.Vector3) => boolean;
  onFail: string;
  note: string;
}
export const LATCHES5: Latch5[] = [
  { door: 'd5_gate', armedBy: 't5_gate', phase: 'B', then: 'B2', keepSide: (p) => p.z < -0.6, onFail: 'reopen (the gate rises), re-arm; panel CLEAR THE GATE', note: '§4.1: the leaf descends 2.4 s (gate_close_heavy, the door\'s own sound); l5_unit_gate' },
  { door: 'd5_dive', armedBy: 'last g5_spine member at x < 45.6, or 10 s', phase: 'S_dive', then: 'S', keepSide: (p) => p.x < 45.6, onFail: 'stays open, retries every 2 s', note: '§4.6 (after the spawn)' },
  { door: 'd5_lockside', armedBy: 'last member of the wave at z > −55.6, or 10 s', phase: 'V_lock', then: 'V', keepSide: (p) => p.z > -55.6, onFail: 'stays open, retries every 2 s', note: '§4.7 / §4.8 (after the spawn); W_lock → W' },
  { door: 'd5_tunnel', armedBy: 't5_tunnel', phase: 'W', then: 'X', keepSide: (p) => p.x < 21.6, onFail: 'reopen, re-arm', note: '§4.8: beat l5_tunnel' },
];

export function installPhases5(ctx: GameContext, level: Level) {
  installPhaseTable(ctx, level, PHASES5, (id) => { const p = PHASES5.find((x) => x.id === id); if (p) applyInteract(ctx, p.interact); });
  (level as unknown as { latches: Latch5[] }).latches = LATCHES5;
}
