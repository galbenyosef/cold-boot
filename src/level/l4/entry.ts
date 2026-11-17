/**
 * BIOLOGICAL SYSTEMS — entry and north (stage 3b §2.6, §2.7, §2.9; task D1a). STUB from W4: D1a owns this file.
 *
 * Contract (see ./index.ts `RoomDress`, ./grey.ts header):
 *   export const ENTRY_DRESS: Partial<Record<RoomId4, RoomDress>>
 * for the rooms lock4, gown, shower, corr_n, wetlab, pi_office, node2. Per room:
 *   build(L)  props / geometry / vignettes, run after the room's shell inside its build pass (culled with the room);
 *   lights    replaces LIGHTS4[room] (keep the §2.7 group names `<room>`, `<room>_emerg`);
 *   look      { floor, wall, ceiling } materials of the shell faces looking into the room;
 *   label     false = drop the greybox wayfinding labels.
 * The shell already made (do NOT re-create; restyle / hide stand-in visuals with l3/kit3.ts `restyle(…, isStandin, …)`):
 *   screens decon_panel, shower_in_panel, shower_out_panel, fumig_status, node2_screen, pi_video; interactables
 *   note4_signout, note4_gown, note4_wet, term4_pi, log4_video; markers mk4_start, mk4_decon_panel, mk4_wet_win,
 *   mk4_video; the wet-lab and Node 2 panes; stand-ins: gown bench, wet-lab islands + hood counter, PI desk;
 *   the sealed `d4_outer` (+ `d4_outer_panel`).
 * Vignettes this task defines (greybox no-op placeholders exist until it does): `decon_cycle`, `shower_cycle`.
 */
import type { RoomId4 } from './grey';
import type { RoomDress } from './index';

export const ENTRY_DRESS: Partial<Record<RoomId4, RoomDress>> = {};
