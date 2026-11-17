/**
 * BIOLOGICAL SYSTEMS — the transfer tube and the Post 4 gate lock (stage 3b §2.6, §2.7, §2.9, §4.6; task D3b). STUB
 * from W4: D3b owns this file.
 *
 * Contract (see ./index.ts `RoomDress`, ./grey.ts header):
 *   export const TUBE_DRESS: Partial<Record<RoomId4, RoomDress>>
 * for the rooms tube, gatel. Per room: build(L) / lights / look / label as in entry.ts.
 * The shell already made (do NOT re-create): the panes (x 30 / 34, split at the ring), the sea voids (no faces), the
 *   bulkhead ring (solid grid structure at z −87.25 … −86.75, opening x 30.7 … 33.3, y 0 … 3.0 — build the kit ring
 *   1 cm proud of it, no colliders); screen gate_panel; marker mk4_gate_panel; the sealed gate `gate4` with its dogs
 *   `gate4_dogs` (L.objects; `userData.set(k)` 0 engaged … 1 retracted, `userData.edges`; each edge a registered mover);
 *   the placeholder end button `l4_stub_end` (K's stub story; removed at I1).
 * Vignette this task defines (greybox placeholder exists until it does): `gate_dogs`.
 * Viewports: `fx.viewport` west / east per §2.9 with `rooms: ['tube']`.
 */
import type { RoomId4 } from './grey';
import type { RoomDress } from './index';

export const TUBE_DRESS: Partial<Record<RoomId4, RoomDress>> = {};
