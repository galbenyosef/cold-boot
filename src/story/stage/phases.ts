/**
 * Shared story scaffolding — phase plumbing and regions (stage 3a §3, §8.13).
 *
 * The door / line state of every phase is owned by the LEVEL (`src/level/lN/phases.ts` → `applyPhase`). A story
 * derives its phase from its record (`StageBase.phase`, a level-supplied getter) and hands it to the level here;
 * it sets no phase door state by hand. Regions come from `level.regions` (3-D boxes, REVISION 5.1), with the
 * design document's boxes as a per-level fallback for a level build without them.
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';

/** A level's `applyPhase` (its phase table): `snap` = no door animation (checkpoint load). */
export type LevelApplyPhase<P extends string> = (ctx: GameContext, id: P, opts: { snap: boolean }) => void;

/** Put every door into the state of phase `id` via the level's table. Never throws. */
export function applyPhaseSafe<P extends string>(ctx: GameContext, apply: LevelApplyPhase<P>, id: P, snap = false): void {
  try {
    apply(ctx, id, { snap });
  } catch (e) {
    console.warn(`[story] applyPhase ${id} failed`, e);
  }
}

/** Fallback region boxes per name (a level build without `level.regions`). */
export type RegionFallback = Readonly<Record<string, readonly THREE.Box3[]>>;

/** An x/z box with a tall y range (−1 … 12): the shape of the design document's single-deck regions. */
export const boxXZ = (x0: number, x1: number, z0: number, z1: number, y0 = -1, y1 = 12) =>
  new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));

export function regionBoxes(ctx: GameContext, name: string, fallback: RegionFallback = {}): readonly THREE.Box3[] {
  try {
    const r = ctx.level.regions?.[name];
    if (r && r.length) return r;
  } catch { /* ignore */ }
  return fallback[name] ?? [];
}

/** Is the point (feet position) inside the named region? Only x/z are tested (single-deck levels). */
export function inRegion(ctx: GameContext, name: string, p: THREE.Vector3, fallback: RegionFallback = {}): boolean {
  for (const b of regionBoxes(ctx, name, fallback)) if (p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z) return true;
  return false;
}

/** 3-D test (two-deck levels, stage 3a §8.9): x, y and z of the feet inside one of the region's boxes. */
export function inRegion3(ctx: GameContext, name: string, p: THREE.Vector3, fallback: RegionFallback = {}): boolean {
  for (const b of regionBoxes(ctx, name, fallback)) if (b.containsPoint(p)) return true;
  return false;
}
