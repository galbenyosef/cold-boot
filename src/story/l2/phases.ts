/**
 * Level 2 story phases (docs/DESIGN.md → REVISION 5 "Phases and containment", REVISION 5.1).
 *
 * The door / line state of each phase is owned by the LEVEL (`src/level/l2/phases.ts`): the story calls
 * `applyPhase` at every transition and in checkpoint fast-forward and sets no phase door state by hand.
 * The level's table has the nine phases A–I plus the sub-states 5.1 needs:
 *   D  relay fight (d2_relay CYCLING)   → D2 relay cleared
 *   G  escorts attack (mouth CYCLING)   → G2 escorts dead (mouth open)
 *   I  foreman dead (core open)         → I2 choice made (lift open)
 *
 * What the story still does itself are the moves INSIDE a phase that the design gives to the story: the
 * latches (`closeBehind`: south bulkhead, mouth, gate) and the hall door opening for the escorts while the
 * player is sealed in the trap.
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { applyPhase as levelApplyPhase, type PhaseId2 } from '../../level/l2/phases';

export type PhaseId = Exclude<PhaseId2, 'nostory'>;
/** The design's letter (A–I) of a phase id. */
export type PhaseLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';
export const letterOf = (id: PhaseId): PhaseLetter => id[0] as PhaseLetter;

/** Put every door and the line into the state of phase `id`. `snap`: no door animation (checkpoint load). Never throws. */
export function applyPhase(ctx: GameContext, id: PhaseId | 'nostory', snap = false): void {
  try {
    levelApplyPhase(ctx, id, { snap });
  } catch (e) {
    console.warn(`[story] applyPhase ${id} failed`, e);
  }
}

// ── regions (level.regions, REVISION 5.1) with the design document's boxes as the fallback ──

const B = (x0: number, x1: number, z0: number, z1: number) => new THREE.Box3(new THREE.Vector3(x0, -1, z0), new THREE.Vector3(x1, 12, z1));
const REGION_FALLBACK: Record<string, THREE.Box3[]> = {
  hall_north: [B(-10, 10, -50.35, -22)],
  hall_south: [B(-10, 2.5, -70, -50.35), B(7.5, 10, -70, -50.35), B(2.5, 7.5, -70, -62)],
  tunnel: [B(2.5, 7.5, -62, -50.35)],
  trap: [B(-21, -17, -56, -36)],
  spine_south: [B(-21, -17, -68, -56), B(-17, -10, -68, -64)],
  spine_north: [B(-21, -17, -36, -30)],
};

export function regionBoxes(ctx: GameContext, name: string): readonly THREE.Box3[] {
  try {
    const r = ctx.level.regions?.[name];
    if (r && r.length) return r;
  } catch { /* ignore */ }
  return REGION_FALLBACK[name] ?? [];
}

/** Is the point (feet position) inside the named region? Only x/z are tested. */
export function inRegion(ctx: GameContext, name: string, p: THREE.Vector3): boolean {
  for (const b of regionBoxes(ctx, name)) if (p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z) return true;
  return false;
}
