/**
 * LEVEL 6 — water volumes and their `rayOnly` surfaces (stage 3d §2.9, D12, D14). K STUB (// K placeholder, the whole
 * file): replaced by task W4b. W4a's `l6/index.ts` passes the result to `assembleLevel({ water })`.
 *
 * W4b: build every `wat6_*` volume (`WaterVolume`: id, room, box, surface, stand) and its surface quad as a collider mesh
 * with `userData.rayOnly = true` and `userData.surface = 'water'` (physics puts it in the RAYS set only: rounds and sight
 * stop at it, bodies and `raycastSolid` pass it).
 */
import type { WaterVolume } from '../../core/types';
import type { LevelBuild } from '../context';

export function buildWater6(_L: LevelBuild): WaterVolume[] {
  return []; // K placeholder
}
