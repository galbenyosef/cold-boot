/**
 * Level 3's dialogue (stage 3a §6.2): the FACTS a line's condition may ask and the RULES table — one entry per id
 * in `voice/lines.l3.json` (R3). The channel is the shared one (src/story/stage/dialogue.ts); rules are evaluated
 * when a line STARTS, never when it is queued. Variants are `else` chains, each with its own rule.
 */
import { C, U, type DialogueConfig, type Rules } from '../stage/dialogue';
import type { CommonFacts } from '../stage/base';
import type { PhaseId3 } from '../../level/l3/phases';

/** The phases in story order ("phase ≥ F" = rank ≥ rank('F')). Script-only variants rank as their phase. */
export const PHASE_ORDER: PhaseId3[] = ['A', 'A2', 'B', 'B2', 'C', 'S1', 'S2', 'S2T', 'E', 'F', 'G', 'H', 'I', 'J'];
export function phaseRank(p: PhaseId3): number {
  const base = p === 'F_kitchen' ? 'F' : p === 'H_ring' ? 'H' : p;
  return PHASE_ORDER.indexOf(base as PhaseId3);
}

export interface Facts3 extends CommonFacts {
  readonly phase: PhaseId3;
  /** `phaseRank(phase) >= phaseRank(p)`. */
  atLeast(p: PhaseId3): boolean;
  /** The carried choice (level 2's ending). */
  readonly choice: 'stop' | 'command';
  /** The player holds a weapon (C1: visible, lowered). */
  readonly armed: boolean;
  readonly hasBadge: boolean;
  /** Seconds since control came back after C2 (∞ before). */
  readonly controlFor: number;
  /** Seconds since the dialogue channel last spoke / was busy. */
  readonly channelIdle: number;
  /** The player stands in the office. */
  readonly inOffice: boolean;
  /** A bullet hit the leaf of `door` within the last `s` seconds. */
  shotDoorWithin(door: string, s: number): boolean;
  /** A bullet hit the leaf of `door` at some point of this run (saved). */
  shotDoorEver(door: string): boolean;
  /** Horizontal distance from the player's feet to a door. */
  distToDoor(door: string): number;
  /** A sea-viewport (or canteen viewport) hit within `s` seconds. */
  viewportHitWithin(s: number): boolean;
  /** Seconds since the purge started (−1 when not running). */
  readonly purgeFor: number;
  /** Awake hostiles within `r` m (3-D) of the player. */
  awakeNear(r: number): number;
  /** The d3_pressure leaves are open / opening (C2: the feed). */
  readonly pressureOpen: boolean;
}

const stop = (F: Facts3) => F.choice === 'stop';
const command = (F: Facts3) => F.choice === 'command';
const officeE = (F: Facts3) => F.inOffice && (F.phase === 'E');
const canteenPlace = (F: Facts3) => (F.room === 'canteen' || F.room === 'stair_w') && (F.phase === 'F' || F.phase === 'F_kitchen') && F.hostiles <= 2;
const residentOk = (F: Facts3) => F.atLeast('F') && F.inTrigger('t3_q3') && F.awakeNear(12) === 0 && !F.shotDoorEver('d3_q3');

export const RULES3: Rules<Facts3> = {
  // ── arrival
  l3_unit_lift_arrive: U('the lift announcement as it arrives (l3_arrive)'),
  // ── C1 (no control; rules decide the variants at the instant the line starts)
  l3_halv_c1_1: C((F) => !F.firedWithin(60), 'no shot in the last 60 s', 'l3_halv_c1_1_shots'),
  l3_halv_c1_1_shots: C((F) => F.firedWithin(60), 'a weapon:fired in the last 60 s'),
  l3_halv_c1_2: C((F) => F.armed, 'a weapon is held (visible, lowered)', 'l3_halv_c1_2b'),
  l3_halv_c1_2b: C((F) => !F.armed, 'unarmed'),
  l3_reyes_phone: U('C1, Reyes answers him'),
  l3_halv_c1_3: U('C1, he takes Reyes to his office'),
  l3_reyes_murmur: U('under the black between C1 and C2; no subtitle'),
  // ── C2
  l3_halv_c2_1: U('C2'),
  l3_halv_c2_2: U('C2'),
  l3_halv_c2_3: C((F) => F.pressureOpen, 'the pressure door is opening on the feed (true)'),
  l3_halv_c2_3b: C((F) => F.pressureOpen, 'the pressure door is open on the feed (true)'),
  l3_halv_c2_4: U('C2: Line Two on CAM 04'),
  l3_halv_c2_4b: U('C2: Line Two on CAM 04 — the units stand there in both variants (dark or lit)'),
  l3_halv_c2_6: U('C2: the phone has no tone'),
  l3_halv_c2_6b: U('C2: the phone has no tone'),
  l3_choir_told_stop: C(stop, 'carried choice stop', 'l3_choir_told_command'),
  l3_choir_told_command: C(command, 'carried choice command'),
  l3_choir_quiet: U('C2'),
  l3_halv_c2_7: U('C2'),
  l3_halv_c2_7b: U('C2'),
  l3_halv_c2_7c: U('C2 (true regardless of the weapon)'),
  l3_reyes_come: U('C2'),
  l3_halv_c2_9: U('C2'),
  l3_halv_c2_9b: U('C2'),
  // ── the office (phase E)
  l3_halv_go_1: C((F) => officeE(F) && F.controlFor >= 20 && F.channelIdle >= 6, 'in the office, phase E, ≥ 20 s since control, channel idle 6 s'),
  l3_halv_go_2: C((F) => officeE(F) && F.controlFor >= 45 && F.heard('l3_halv_go_1'), 'in the office, phase E, ≥ 45 s, heard go_1'),
  l3_halv_signed: C((F) => F.inOffice && F.readWithin('note3_schedule', 10), 'in the office, read the schedule within 10 s', undefined, { once: true }),
  l3_halv_memo: C((F) => F.inOffice && F.readWithin('note3_memo', 10), 'in the office, read the memo within 10 s', undefined, { once: true }),
  l3_halv_pad: C((F) => F.inOffice && F.readWithin('note3_pad', 10), 'in the office, read the notepad within 10 s', undefined, { once: true }),
  l3_halv_lock: U('the office latch held (through the door)'),
  l3_halv_door: C((F) => F.room === 'admin' && F.distToDoor('d3_office') <= 3 && (F.deniedWithin('d3_office', 3) || F.shotDoorWithin('d3_office', 3)),
    'in admin within 3 m of his door, tried or shot it within 3 s', undefined, { cooldown: 60, max: 2 }),
  // ── the escape
  l3_choir_pa_residents: C((F) => F.atLeast('F') && !F.inOffice, 'phase ≥ F, not in the office', undefined, { once: true }),
  l3_choir_canteen_stop: C((F) => stop(F) && canteenPlace(F), 'stop; canteen / west stair, phase F, ≤ 2 hostiles', 'l3_choir_canteen_command', { once: true }),
  l3_choir_canteen_command: C((F) => command(F) && canteenPlace(F), 'command; canteen / west stair, phase F, ≤ 2 hostiles', undefined, { once: true }),
  l3_choir_breach_stop: C((F) => stop(F) && F.inView('g3_breach'), 'stop; a g3_breach member in view', 'l3_choir_breach_far_stop'),
  l3_choir_breach_far_stop: C((F) => stop(F) && F.atLeast('F') && F.alive('g3_breach') + F.alive('g3_garden') > 0, 'stop; after the breach, its units alive'),
  l3_choir_breach_command: C((F) => command(F) && F.inView('g3_breach'), 'command; a g3_breach member in view', 'l3_choir_breach_far_command'),
  l3_choir_breach_far_command: C((F) => command(F) && F.atLeast('F') && F.alive('g3_breach') + F.alive('g3_garden') > 0, 'command; after the breach, its units alive'),
  l3_choir_glass_stop: C((F) => stop(F) && F.atLeast('F') && F.viewportHitWithin(2), 'stop; phase ≥ F; a viewport hit within 2 s', 'l3_choir_glass_command', { once: true }),
  l3_choir_glass_command: C((F) => command(F) && F.atLeast('F') && F.viewportHitWithin(2), 'command; phase ≥ F; a viewport hit within 2 s', undefined, { once: true }),
  l3_choir_purge_stop: C((F) => stop(F) && (F.phase === 'H' || F.phase === 'H_ring') && F.purgeFor >= 4 && F.inRegion('balcony'), 'stop; purge ≥ 4 s; on the balcony', 'l3_choir_purge_command', { once: true }),
  l3_choir_purge_command: C((F) => command(F) && (F.phase === 'H' || F.phase === 'H_ring') && F.purgeFor >= 4 && F.inRegion('balcony'), 'command; purge ≥ 4 s; on the balcony', undefined, { once: true }),
  l3_choir_end_stop: C((F) => stop(F) && F.phase === 'J' && F.hostilesWhere('bio_lock') === 0, 'stop; latched inside; 0 hostiles in the lock', 'l3_choir_end_command', { once: true }),
  l3_choir_end_command: C((F) => command(F) && F.phase === 'J' && F.hostilesWhere('bio_lock') === 0, 'command; latched inside; 0 hostiles in the lock', undefined, { once: true }),
  // ── machines
  l3_unit_bio_reader: C((F) => F.hasBadge && F.atLeast('E'), 'the reader, used with the badge'),
  l3_unit_bio_denied: C((F) => !F.hasBadge, 'the reader, used without the badge', undefined, { cooldown: 8 }),
  l3_unit_sector: C((F) => !F.hasBadge && F.atLeast('S2T'), 'a sealed door, tried without the badge', undefined, { cooldown: 10 }),
  l3_unit_sector_badge: C((F) => F.hasBadge && F.atLeast('S2T'), 'a sealed door, tried with the badge', undefined, { cooldown: 10 }),
  // ── the quarters
  l3_resident_1: C(residentOk, 'phase ≥ F, at cabin 3, nothing awake within 12 m, its door never shot', undefined, { once: true }),
  l3_resident_2: C((F) => residentOk(F) && F.heard('l3_resident_1'), 'heard resident_1, still at cabin 3, door never shot', undefined, { once: true }),
};

export const L3_DIALOGUE: DialogueConfig<Facts3> = {
  rules: RULES3,
  offStageFx: ['unit', 'recorder', 'pa'],
};
