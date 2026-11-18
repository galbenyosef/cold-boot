/**
 * POST 4 — berthing, the washroom, the mess, the galley (stage 3c §2.6, §2.7, §5.5; task D2b).
 * STUB (W4): the greybox shell runs without it. D2b replaces the body; keep the export and its type.
 *
 * Contract (see ./index.ts `RoomDress`, ./grey.ts header):
 *   export const QUARTERS_DRESS: Partial<Record<RoomId5, RoomDress>>
 * for the rooms berths5, heads5, mess5, galley5. Per room: `build(L)`, `lights` (keep the §2.7.1 group names), `look`,
 * `label: false`.
 *
 * The shell already made (do NOT re-create; restyle / hide stand-in visuals, one collider per object):
 *  - berths5: six triple-bunk stand-ins (2.0 × 0.9, h 2.2) at x 12.8 … 14.8 / 21.2 … 23.2, z −12.8 … −11.9,
 *    −8.6 … −7.7, −4.1 … −3.2; shelves under `p5_berth_med`, `p5_berth_shells`; markers `mk5_bunk_radio`, `mk5_body_a`.
 *  - heads5: the sink counter (west wall, x 12.2 … 12.8, z −1.0 … 3.0, h 0.9), two shower partitions (x 18.4 … 19.8 at
 *    z 0.4 / 1.9, h 2.0); marker `mk5_taps`.
 *  - mess5: four tables 1.0 × 2.4 (h 0.75) at x 27 / 31 × z −10 / −6, the serving counter z −2.8 … −2.2 (h 1.0)
 *    in two runs x 26 … 31.2 / 34.8 … 36 (W4: the plan's x 26 … 36 blocked d5_galley); interactable `note5_mess`; marker `mk5_trays`; a shelf under `p5_mess_ammo`.
 *  - galley5: ranges (x 28.2 … 29.0, z −0.5 … 2.5) and a bench on the north wall; the cold room behind the frosted
 *    window (air x 38.2 … 39.4, y 0 … 2.2, z −0.2 … 2.2; window opening x 37.8 … 38.2, y 1 … 2, z 0 … 2; the pane at
 *    x 37.765 … 37.795, `mk5_glass` `cold`) — region `outside` (never entered); marker `mk5_oilskin`; a shelf under
 *    `p5_galley_med`.
 * Vignettes this task defines (each with its `:snap`; greybox placeholders until then): `v5_bunk_radio`, `v5_water`,
 * `v5_trays`, `v5_galley_shape`, `v5_body` (its code and the body prop; D2a places the smear decals in the spine).
 * Puddles: add each wet patch's box with `addWet(L, box)` (grey.ts) — the same box you give `fx.wetPatch` — so
 * `level.regions.wet` (audio's `wet` footsteps) matches what is drawn.
 */
import type { RoomId5 } from './grey';
import type { RoomDress } from './index';

export const QUARTERS_DRESS: Partial<Record<RoomId5, RoomDress>> = {};
