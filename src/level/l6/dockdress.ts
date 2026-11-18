/**
 * LEVEL 6 — pool6's dressing (containers dressed, pumps + tool shelves, console placement, the cage dressing, signs, the
 * dock board, the undercroft panel, the lockers' look), stores6, the feed set's placement; vignettes `v6_well_eyes`,
 * `v6_window`, `loader_dead6:snap`. STUB (W4a): task D3b fills it (stage 3d §11; renamed from `dock.ts`, S8e).
 *
 * Contract: see `tunnels.ts`. pool6 is dressed by two files: `pool.ts` first, then this one (both `build`s run).
 */
import type { RoomId6 } from './grey';
import type { RoomDress } from './index';

export const DOCK_DRESS: Partial<Record<RoomId6, RoomDress>> = {};
