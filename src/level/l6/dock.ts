/**
 * LEVEL 6 — the moon pool's dock arena as the loader reads it (stage 3d §5.6.7, §8.1, B2, S6b). K STUB (// K placeholder,
 * the whole file): replaced by task W4b. W4a's `l6/index.ts` passes the result to `assembleLevel({ dock })`.
 *
 * W4b: the six cargo slots (`sl6_*`), the containers as NON-walkable dynamic boxes (`CargoHandle.box`), `lift` / `place` /
 * `drop` (cover points of a lifted container `enabled = false`), `target(p, lane?)` with the footprint / lane tests, the
 * no-slam box, `park` (−52, −8, −186) and the rails.
 */
import type { DockArena } from '../../core/types';
import type { LevelBuild } from '../context';

export function buildDock6(_L: LevelBuild): DockArena | null {
  return null; // K placeholder
}
