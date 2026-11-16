/**
 * Story phases as data (REVISION 5.1): for each phase, the state of every door and machine, plus what the
 * reachability check (`scripts/check-reach.mjs`) must prove about it. One table per level; `applyPhase` is the
 * only code that turns a phase into world state, and the story calls it (never sets those doors by hand).
 */
import * as THREE from 'three';
import type { GameContext, Level } from '../core/types';
import type { LevelBuild, MachineState } from './context';

/**
 * Door states:
 *  'auto'    — unlocked, opens for whoever comes near (default panel: green)
 *  'open'    — unlocked, held open by script (not auto)
 *  'shut'    — unlocked, closed, not auto (opens only by script)
 *  'locked'  — locked and closed (red)
 *  'cycling' — locked and closed, amber CYCLING panel (locked for a stated, temporary reason)
 *  'dark'    — locked and closed, panel off (unpowered)
 *  'oneway'  — level logic decides (d2_exit: opens only for a body inside the tunnel)
 */
export type DoorState = 'auto' | 'open' | 'shut' | 'locked' | 'cycling' | 'dark' | 'oneway';

export interface PhaseCheck {
  /** Where the flood fill starts (feet). */
  start: [number, number, number];
  /** Region ids the player must not be able to touch. */
  forbid: string[];
  /** Region ids that must be reachable. */
  goal: string[];
  /** Interactable / pickup ids that must be usable from a reachable spot. */
  use?: string[];
  /** Model the level's one-way edges (d2_exit) — default true. */
  oneway?: boolean;
}

export interface Phase {
  id: string;
  /** What this phase is, in one line (report). */
  label: string;
  doors: Record<string, DoorState>;
  machines?: Record<string, MachineState>;
  check?: PhaseCheck;
}

export interface ApplyOpts {
  /** Finish door strokes instantly (checkpoint fast-forward, checks). Default false: doors move visibly. */
  snap?: boolean;
}

type DoorLike = Level['doors'][number] & { snap?(): void };

/** Set every door (and machine) listed in the phase. Unknown ids warn once. */
export function applyPhaseState(ctx: GameContext, phase: Phase, opts: ApplyOpts = {}) {
  const level = ctx.level;
  for (const [id, st] of Object.entries(phase.doors)) {
    const d = level.doors.find((x) => x.id === id) as DoorLike | undefined;
    if (!d) { console.warn(`[phases] ${phase.id}: unknown door "${id}"`); continue; }
    switch (st) {
      case 'auto': d.setStatus(null); d.unlock(); d.auto = true; break;
      case 'open': d.setStatus(null); d.unlock(); d.auto = false; d.open(); break;
      case 'shut': d.setStatus(null); d.unlock(); d.auto = false; d.close(); break;
      case 'locked': d.setStatus(null); d.lock(); break;
      case 'cycling': d.lock(); d.setStatus('cycling'); break;
      case 'dark': d.lock(); d.setStatus('dark'); break;
      case 'oneway': d.setStatus(null); d.unlock(); d.auto = false; break;
    }
    if (opts.snap) d.snap?.();
  }
  for (const [name, s] of Object.entries(phase.machines ?? {})) level.setMachine(name, s);
}

/** Region test helper (used by story and checks): is p inside any box of the region? */
export function inRegion(level: Level, region: string, p: THREE.Vector3): boolean {
  const boxes = level.regions[region];
  if (!boxes) return false;
  for (const b of boxes) if (b.containsPoint(p)) return true;
  return false;
}

// ───────────────────────────────────────────────────────────── level 1

/** Level 1: its locked-door progression (the story unlocks in this order). */
export const PHASES1: Phase[] = [
  {
    id: 'L1_start', label: 'wake-up: fab access lock shut',
    doors: { d_fab_outer: 'locked', d_pump: 'locked', d_lobby: 'locked', d_elev: 'locked', d_med: 'auto', d_sec: 'auto', d_quarters: 'auto', d_storage: 'auto', d_fab_inner: 'auto', d_gen: 'auto' },
    check: { start: [0, 0, 6], forbid: ['airlock', 'fab', 'pump', 'gen', 'lobby', 'elevator'], goal: ['sec', 'storage', 'quarters', 'junction'] },
  },
  {
    id: 'L1_fab', label: 'fab access open',
    doors: { d_fab_outer: 'auto', d_pump: 'locked', d_lobby: 'locked', d_elev: 'locked' },
    check: { start: [0, 0, -15], forbid: ['pump', 'lobby', 'elevator'], goal: ['fab', 'gen'] },
  },
  {
    id: 'L1_pump', label: 'pump room open',
    doors: { d_fab_outer: 'auto', d_pump: 'auto', d_lobby: 'locked', d_elev: 'locked' },
    check: { start: [0, 0, -38], forbid: ['lobby', 'elevator'], goal: ['pump'] },
  },
  {
    id: 'L1_lobby', label: 'freight lobby + elevator open',
    doors: { d_fab_outer: 'auto', d_pump: 'auto', d_lobby: 'auto', d_elev: 'auto' },
    check: { start: [0, 0, -38], forbid: [], goal: ['lobby', 'elevator'] },
  },
];

// ───────────────────────────────────────────────────────────── wiring

/** Expose the level's phases on the Level object (console: `__game.level.applyPhase('D')`). */
export function installPhaseTable(ctx: GameContext, level: Level, phases: Phase[], extra?: (id: string) => void) {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const api = level as unknown as { phases: Phase[]; applyPhase(id: string, opts?: ApplyOpts): boolean };
  api.phases = phases;
  api.applyPhase = (id: string, opts: ApplyOpts = {}) => {
    const p = byId.get(id);
    if (!p) { console.warn(`[phases] unknown phase "${id}"`); return false; }
    applyPhaseState(ctx, p, opts);
    extra?.(id);
    return true;
  };
}

export function installPhases1(ctx: GameContext, _L: LevelBuild, level: Level) { installPhaseTable(ctx, level, PHASES1); }
