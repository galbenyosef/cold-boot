/**
 * LINE TWO — the phase table (REVISION 5, R6 + REVISION 5.1): the single source of truth for door / line state
 * in each story phase. The story calls `applyPhase(ctx, id)` at every transition and in checkpoint
 * fast-forward and sets none of these doors by hand; `scripts/check-reach.mjs` applies the same phases and
 * proves the containment listed in `check`.
 *
 * Phases (DESIGN.md → REVISION 5 table, with the sub-states 5.1 needs):
 *   A   arrival … before the first intercom talk          B   after the talk (d2_fitting unlocked)
 *   C   pass taken (d2_relay unlocked)                     D   section C power: relay fight (d2_relay CYCLING)
 *   D2  relay cleared: the way is the spine                E   trapped (bulkhead latched behind the player)
 *   F   booth opened                                       G   escorts attack (mouth CYCLING until they are dead)
 *   G2  escorts cleared: the belt is the way through       H   after the ride (mouth latched, exit one-way)
 *   I   foreman dead (core open)                           I2  choice made (lift open)
 *   nostory — ?nostory=1 defaults: line held, gate open, mouth and exit shut, every other door unlocked
 */
import * as THREE from 'three';
import type { GameContext, Level } from '../../core/types';
import type { LevelBuild } from '../context';
import { applyPhaseState, installPhaseTable, type DoorState, type Phase } from '../phases';
export { inRegion } from '../phases';
import { BELT, PARTITION_Z, SHUTTER, TUN } from './line';

export type PhaseId2 = 'A' | 'B' | 'C' | 'D' | 'D2' | 'E' | 'F' | 'G' | 'G2' | 'H' | 'I' | 'I2' | 'nostory';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));

/** Named regions (REVISION 5.1). Each room id is a region too (added by assembleLevel). */
export function REGIONS2(): Record<string, THREE.Box3[]> {
  const P = PARTITION_Z, mz = SHUTTER.mouthZ, ez = SHUTTER.exitZ, H = 9.5;
  return {
    hall_north: [box(-10, -0.5, mz, 10, H, -22), box(-10, -0.5, P, TUN.x0, H, mz), box(TUN.x1, -0.5, P, 10, H, mz)],
    hall_south: [box(-10, -0.5, -70, TUN.x0, H, P), box(TUN.x1, -0.5, -70, 10, H, P), box(TUN.x0, -0.5, -70, TUN.x1, H, ez)],
    tunnel: [box(TUN.x0, -0.5, ez, TUN.x1, TUN.roof, mz)],
    tunnel_roof: [box(TUN.x0, TUN.roof, ez, TUN.x1, H, P)],
    trap: [box(-21, -0.5, -56, -17, 3, -36)],
    spine_south: [box(-21, -0.5, -68, -17, 3, -56), box(-17.2, -0.5, -67, -10, 3, -65)],
    spine_north: [box(-21, -0.5, -36, -17, 3, -30)],
  };
}

/** Every door of level 2 in the order of the table. */
export const DOOR_IDS2 = ['d2_cab', 'd2_intake', 'd2_line', 'd2_fitting', 'd2_relay', 'd2_spine', 'd2_bulkhead_s', 'd2_bulkhead_n', 'd2_booth', 'd2_booth_hall', 'd2_core', 'd2_lift', 'd2_gate', 'd2_mouth', 'd2_exit'] as const;
type Doors = Record<(typeof DOOR_IDS2)[number], DoorState>;

const NORTH = { d2_cab: 'auto', d2_intake: 'auto', d2_line: 'auto' } as const;
// everything outside the hall that is not the scene's concern, sealed
const base: Doors = {
  ...NORTH, d2_fitting: 'dark', d2_relay: 'locked', d2_spine: 'locked', d2_bulkhead_s: 'locked', d2_bulkhead_n: 'locked',
  d2_booth: 'locked', d2_booth_hall: 'locked', d2_core: 'locked', d2_lift: 'locked', d2_gate: 'open', d2_mouth: 'locked', d2_exit: 'locked',
};
const with_ = (d: Partial<Doors>): Doors => ({ ...base, ...d });
const ALL_ROOMS_NORTH = ['cab', 'dock', 'intake', 'fitting'];
const P_D: Partial<Doors> = { d2_fitting: 'auto', d2_relay: 'auto', d2_spine: 'auto', d2_bulkhead_s: 'open', d2_booth: 'cycling', d2_booth_hall: 'cycling', d2_gate: 'locked', d2_mouth: 'open', d2_exit: 'oneway' };

export const PHASES2: Phase[] = [
  {
    id: 'A', label: 'arrival … before the first intercom talk',
    doors: with_({}), machines: { l2_line: 'off' },
    check: { start: [0, 0, -4], forbid: ['fitting', 'relay', 'spine', 'booth', 'core', 'lift', 'tunnel', 'tunnel_roof'], goal: ['hall_north', 'hall_south'], use: ['intercom_hall'] },
  },
  {
    id: 'B', label: 'after the talk: d2_fitting unlocked (blue)',
    doors: with_({ d2_fitting: 'auto' }), machines: { l2_line: 'off' },
    check: { start: [-8.8, 0, -46], forbid: ['relay', 'spine', 'booth', 'core', 'lift', 'tunnel', 'tunnel_roof'], goal: ['fitting'], use: ['p2_section_pass'] },
  },
  {
    id: 'C', label: 'pass taken: d2_relay unlocked',
    doors: with_({ d2_fitting: 'auto', d2_relay: 'auto' }), machines: { l2_line: 'off' },
    check: { start: [15, 0, -34], forbid: ['spine', 'booth', 'core', 'lift', 'tunnel', 'tunnel_roof'], goal: ['relay'], use: ['relay_switch'] },
  },
  {
    id: 'D', label: 'section C power: the relay fight (d2_relay CYCLING — ARC INTERLOCK)',
    doors: with_({ ...P_D, d2_relay: 'cycling' }), machines: { l2_line: 'active' },
    check: { start: [14, 0, -61], forbid: ['line', 'spine', 'booth', 'core', 'lift', 'fitting', 'tunnel', 'tunnel_roof'], goal: ['relay'] },
  },
  {
    id: 'D2', label: 'relay cleared: the only way is the spine',
    doors: with_(P_D), machines: { l2_line: 'active' },
    check: { start: [14, 0, -61], forbid: ['hall_north', ...ALL_ROOMS_NORTH, 'booth', 'tunnel', 'tunnel_roof', 'core', 'lift', 'spine_north'], goal: ['hall_south', 'spine_south', 'trap'] },
  },
  {
    id: 'E', label: 'the taking: trapped between the bulkheads',
    doors: with_({ ...P_D, d2_bulkhead_s: 'locked', d2_spine: 'locked' }), machines: { l2_line: 'active' },
    check: { start: [-19, 0, -52], forbid: ['line', 'booth', 'spine_south', 'spine_north', 'relay', 'core', 'lift', ...ALL_ROOMS_NORTH], goal: ['trap'] },
  },
  {
    id: 'F', label: 'booth opened (d2_booth open, hall door shut behind the units)',
    doors: with_({ ...P_D, d2_bulkhead_s: 'locked', d2_spine: 'locked', d2_booth: 'open', d2_booth_hall: 'locked' }), machines: { l2_line: 'active' },
    check: { start: [-19, 0, -50], forbid: ['line', 'spine_south', 'spine_north', 'relay', 'core', 'lift', ...ALL_ROOMS_NORTH], goal: ['booth', 'trap'] },
  },
  {
    id: 'G', label: 'escorts attack (d2_booth_hall open; mouth CYCLING — LOADING INTERLOCK)',
    doors: with_({ ...P_D, d2_bulkhead_s: 'locked', d2_spine: 'locked', d2_booth: 'auto', d2_booth_hall: 'auto', d2_mouth: 'cycling', d2_relay: 'locked' }), machines: { l2_line: 'active' },
    check: { start: [-13.5, 0, -46], forbid: ['hall_south', 'tunnel', 'tunnel_roof', 'relay', 'core', 'lift', 'spine_south', 'spine_north'], goal: ['booth', 'hall_north', 'fitting', 'intake', 'dock'] },
  },
  {
    id: 'G2', label: 'escorts cleared: the belt is the way through (mouth open)',
    doors: with_({ ...P_D, d2_bulkhead_s: 'locked', d2_spine: 'locked', d2_booth: 'auto', d2_booth_hall: 'auto', d2_mouth: 'open', d2_relay: 'locked' }), machines: { l2_line: 'active' },
    // walking (no ride) must not reach the south; the ride itself is the one-way edge checked as goal 'ride'
    check: { start: [-13.5, 0, -46], forbid: ['hall_south', 'tunnel_roof', 'relay', 'core', 'lift', 'spine_south', 'spine_north'], goal: ['tunnel', 'ride'], oneway: false },
  },
  {
    id: 'H', label: 'after the ride: mouth latched, exit one-way',
    doors: with_({ ...P_D, d2_bulkhead_s: 'locked', d2_booth: 'locked', d2_booth_hall: 'locked', d2_mouth: 'locked', d2_relay: 'auto', d2_spine: 'auto' }), machines: { l2_line: 'active' },
    check: { start: [5, 0.55, -65.2], forbid: ['hall_north', 'tunnel', 'tunnel_roof', 'booth', 'trap', 'spine_north', 'core', 'lift', ...ALL_ROOMS_NORTH], goal: ['hall_south', 'relay', 'spine_south'] },
  },
  {
    id: 'I', label: 'foreman dead: the core is open',
    doors: with_({ ...P_D, d2_bulkhead_s: 'locked', d2_booth: 'locked', d2_booth_hall: 'locked', d2_mouth: 'locked', d2_relay: 'auto', d2_spine: 'auto', d2_core: 'auto' }), machines: { l2_line: 'active' },
    check: { start: [-3, 0, -64], forbid: ['tunnel_roof', 'lift'], goal: ['core'] },
  },
  {
    id: 'I2', label: 'choice made: the lift is open',
    doors: with_({ ...P_D, d2_bulkhead_s: 'locked', d2_booth: 'locked', d2_booth_hall: 'locked', d2_mouth: 'locked', d2_relay: 'auto', d2_spine: 'auto', d2_core: 'auto', d2_lift: 'auto' }), machines: { l2_line: 'active' },
    check: { start: [0, 0, -80], forbid: ['tunnel_roof'], goal: ['lift'] },
  },
  {
    id: 'nostory', label: '?nostory=1: line held, gate open, mouth and exit shut, everything else unlocked',
    doors: {
      d2_cab: 'auto', d2_intake: 'auto', d2_line: 'auto', d2_fitting: 'auto', d2_relay: 'auto', d2_spine: 'auto', d2_bulkhead_s: 'auto', d2_bulkhead_n: 'auto',
      d2_booth: 'auto', d2_booth_hall: 'auto', d2_core: 'auto', d2_lift: 'auto', d2_gate: 'open', d2_mouth: 'shut', d2_exit: 'shut',
    },
    machines: { l2_line: 'off' },
  },
];

const BY_ID = new Map(PHASES2.map((p) => [p.id, p]));

/**
 * THE call the story makes at each phase transition (and in checkpoint fast-forward with `{ snap: true }`).
 * Doors move visibly unless snapped. Returns false for an unknown id.
 */
export function applyPhase(ctx: GameContext, id: PhaseId2, opts: { snap?: boolean } = {}): boolean {
  const p = BY_ID.get(id);
  if (!p) { console.warn(`[phases] unknown phase "${id}"`); return false; }
  applyPhaseState(ctx, p, opts);
  return true;
}

export function installPhases(ctx: GameContext, _L: LevelBuild, level: Level) {
  installPhaseTable(ctx, level, PHASES2);
  // facts the reachability check needs about moving floors and one-way doors (boxes: x0,y0,z0,x1,y1,z1 of the feet)
  (level as unknown as { reachHints: unknown }).reachHints = {
    carry: [{ machine: 'l2_line', box: [BELT.x0 - 0.05, BELT.y - 0.15, BELT.zS - 0.2, BELT.x1 + 0.05, BELT.y + 0.3, BELT.zN], v: [0, 0, -BELT.speed] }],
    oneway: [{ door: 'd2_exit', machine: 'l2_line', from: [TUN.x0 + 0.2, -0.5, SHUTTER.exitZ + 0.05, TUN.x1 - 0.2, BELT.y + 2.4, SHUTTER.exitZ + 2.0], to: [5, BELT.y, SHUTTER.exitZ - 0.9] }],
  };
}
