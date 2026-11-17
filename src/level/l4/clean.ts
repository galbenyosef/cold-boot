/**
 * BIOLOGICAL SYSTEMS — west, south and east of the clean loop (stage 3b §2.6, §2.7, §2.9, §8.11; task D1b). STUB from
 * W4: D1b owns this file.
 *
 * Contract (see ./index.ts `RoomDress`, ./grey.ts header):
 *   export const CLEAN_DRESS: Partial<Record<RoomId4, RoomDress>>
 * for the rooms vivarium, cold, records, bay, corr_w, corr_s, corr_e. Per room: build(L) / lights / look / label as
 * in entry.ts.
 * The shell already made (do NOT re-create): screens surg_hold, cold_panel; interactables note4_cards, log4_viv,
 *   note4_consent, note4_tveit, cold_ack; markers mk4_node2_win, mk4_vent_viv, mk4_vent_s_a, mk4_vent_s_b, mk4_cold_panel,
 *   mk4_cold_rack, mk4_bay_door; grille panels `vent_viv_grille`, `vent_s_a_grille`, `vent_s_b_grille` (L.objects,
 *   `userData.open('drop')`, `userData.box`); stand-ins: pens A / B, procedure table, reading table.
 * Vignettes this task defines (greybox placeholders exist until it does): `viv_vent`, `vent_s_a`, `vent_s_b`,
 *   `lights_out4` (grey.ts `LIGHTS_OUT4` lists the groups, origin and timing, for every room).
 * Machine `cold_jam` (greybox placeholder in grey.ts): register the real one with `L.machines.set('cold_jam', …)`; twitch
 *   `d4_cold` through `(L.doors.get('d4_cold') as DoorImpl).nudge(dt, seconds)` (doors exist from `L.afterDoors`).
 */
import type { RoomId4 } from './grey';
import type { RoomDress } from './index';

export const CLEAN_DRESS: Partial<Record<RoomId4, RoomDress>> = {};
