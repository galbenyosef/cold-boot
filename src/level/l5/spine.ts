/**
 * POST 4 — the spine, the crawlway, the armoury and the magazine (stage 3c §2.6, §2.7, §4.6, §4.7, §5.5; task D2a).
 * STUB (W4): the greybox shell runs without it. D2a replaces the body; keep the export and its type.
 *
 * Contract (see ./index.ts `RoomDress`, ./grey.ts header):
 *   export const SPINE_DRESS: Partial<Record<RoomId5, RoomDress>>
 * for the rooms spine5 (+ the crawl: its floors) and arm5 (+ the magazine: its floors). Per room: `build(L)`, `lights`
 * (replaces `LIGHTS5[room]` — the spine table also holds `spine5_emerg` and `crawl5`, the armoury table `mag5`; keep
 * the group names AND the floor bounds of S5 — `LightRow5.bounds`), `look`, `label: false`.
 *
 * The shell already made (do NOT re-create; restyle / hide stand-in visuals, one collider per object):
 *  - spine5: the grating strip x 16.4 … 36.2, z −16.6 … −15.4, y −0.05 … 0 (floor_grate, colliding: bullets, sight,
 *    bodies — §8.4: never make it non-solid); the crawl air under it (y −1.4 … 0) and the turn south x 16.4 … 17.6 (to
 *    z −20.0, ceiling −0.05); the hatch pit x 36.2 … 38.6, z −17.6 … −15.4 with `STAIR5_HATCH` (nav: false) and rails
 *    1.0 m (west, east, north over the landing); the lid `hatch5_spine` — a greybox PLACEHOLDER with W7's API (`userData.open(k)`, `k`, `box`), built only if
 *    no set piece registered the id: call W7's `hatchLid(L, b, HATCH5_SPINE)` in your build and it replaces it (one
 *    lid, one collider); interactable `hatch5_spine` (37.0, 0.3, −14.9) r 1.4 (phase-gated: S on);
 *    the stencil on the pit's north rail; pipe risers R1 … R7 (0.6 × 0.5, full height; cover `cv5_s*`); the vent void
 *    and `vent5_spine_grille` (`userData.open('drop', snap?)`); the 2.5 × 3.0 opening of `door5_cmd` at x 44 (the greybox door + port pane + `cmd_panel` in it are a
 *    PLACEHOLDER: W7's `cmdDoor(L, b)` registering `door5_cmd` replaces them), the yellow line at x 42.5; markers `mk5_port`, `mk5_vent_spine`, `mk5_exit_spine`, `mk5_body_b`, `mk5_boots_stop`, `mk5_patrol_end`;
 *    a shelf under `p5_spine_ammo`.
 *  - arm5: the magazine air (x 14.2 … 21.8, z −27.8 … −21.4, y −2.6 … −0.1), `STAIR5_MAG_IN` / `STAIR5_MAG_OUT`
 *    (nav: false), the ammo-tin racks (stand-ins h 2.0 — give them per-shelf colliders with open fronts and replace
 *    the block: one collider set), the hatch hole x 20.4 … 21.6, z −27.0 … −24.3 with its rails (west x 20.2, south
 *    z −27.2) and the lid `hatch5_mag` (placeholder as the spine lid; W7's `hatchLid(L, b, HATCH5_MAG)` replaces it); interactables `hatch5_mag`
 *    (underside, eye gate y < −0.2 while the lid is shut) and `hatch5_mag_plate` (top side, eye gate y ≥ −0.2, toasts
 *    `Hatch dogged from below`), `note5_mag`, `note5_arm`; the plate stencil on the east wall by the hatch; the cage
 *    rack stand-in (west wall, x 14.2 … 14.45), the issue desk; shelves; marker `mk5_exit_mag`.
 * Vignettes this task defines (each with its `:snap`; greybox placeholders until then): `hatch5_spine_open`,
 * `hatch5_mag_open` (drive the lids through `userData.open(k)`), `v5_magazine` (the `mag5` group off), `cmd5_line`,
 * `cmd5_port_look` (toggles), `vent5_spine`, and the spine half of `lights_out5` (greybox: `LIGHTS_OUT5` in grey.ts).
 * The `v5_body` smear decals and the B position's floor in the spine are yours (the body prop is D2b's).
 * Puddles: add each wet patch's box with `addWet(L, box)` (grey.ts) — the same box you give `fx.wetPatch` — so
 * `level.regions.wet` (audio's `wet` footsteps) matches what is drawn.
 */
import type { RoomId5 } from './grey';
import type { RoomDress } from './index';

export const SPINE_DRESS: Partial<Record<RoomId5, RoomDress>> = {};
