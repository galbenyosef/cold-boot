/**
 * BIOLOGICAL SYSTEMS — the navy level and the tube plant (stage 3b §2.6, §2.7, §4.5; task D3a). STUB from W4: D3a owns
 * this file.
 *
 * Contract (see ./index.ts `RoomDress`, ./grey.ts header):
 *   export const NAVY_DRESS: Partial<Record<RoomId4, RoomDress>>
 * for the rooms lcorr, chk, guard, plant4. Per room: build(L) / lights / look / label as in entry.ts.
 * The shell already made (do NOT re-create): screens roster, booth_panel, tube_n_panel, plant_gauge; interactables
 *   term4_ctrl, booth_release, note4_guard, note4_bunk, valve4; markers mk4_booth, mk4_roster, mk4_gauge, mk4_sump;
 *   the booth (kerb, glass, posts, headers, roof, console — stand-ins), the cage mesh + colliders (gap x 36.6 … 38.2),
 *   pump sets A / B, pipe trunk, supply crate (stand-ins); `plant_sump_grille` (`userData.open('lift')`);
 *   `valve4_lever` (L.objects; a stand-in handle the dressing may hide and replace).
 * Vignettes this task defines (greybox placeholders exist until it does): `valve_open`, `plant_sump`.
 * Light group `plant_beacon` (off at load, the story switches it) stays as named.
 */
import type { RoomId4 } from './grey';
import type { RoomDress } from './index';

export const NAVY_DRESS: Partial<Record<RoomId4, RoomDress>> = {};
