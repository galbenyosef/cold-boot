/**
 * POST 4 — the gate lock, the gatehouse, the duty room, the ready room (stage 3c §2.6, §2.7, §4.1, §5.5; task D1).
 * STUB (W4): the greybox shell runs without it. D1 replaces the body; keep the export and its type.
 *
 * Contract (see ./index.ts `RoomDress`, ./grey.ts header):
 *   export const FORE_DRESS: Partial<Record<RoomId5, RoomDress>>
 * for the rooms lock5, gate5, duty5, ready5. Per room: `build(L)` (runs after the room's shell, culled with the room),
 * `lights` (replaces `LIGHTS5[room]`; keep the §2.7.1 group names), `look` (shell face materials), `label: false`.
 *
 * The shell already made (do NOT re-create; restyle / hide the stand-in visuals — material `grey_standin` — and keep
 * exactly one collider per object):
 *  - lock5: the sealed `door5_tube` (z 6, panel `door5_tube_panel`), screen `gate_panel5` (lock face (−2.3, 1.6, 0.22)
 *    and a second face on the gatehouse side, one material), marker `mk5_start`. The gate `d5_gate` is a `wide` door
 *    (3.0 × 2.8, rises 2.4 s) that plays its own `gate_open_heavy` / `gate_close_heavy` (DoorSpec.sounds).
 *  - gate5: the guard booth stand-ins (kerb x 2.4 … 2.6 with the west ledge x 2.25 … 2.6 at y 1.0, south face,
 *    roof solid 2.6 … 3.4, inner counter x 4.4 … 5.6), the booth glass (x 2.485 … 2.515, y 1.0 … 2.4, `mk5_glass`
 *    pane `booth`), screens `aas_palm` (4.6, 1.1, −2.0) −x, `gate_log` (4.38, 1.35, −1.1) −x and `onpost` (−4.0, 2.6,
 *    −0.22) −z; the turnstile line (tripods x −3.0 … −2.1 / −2.0 … −1.1 h 1.0, fences x 1.2 … 2.4 / −5.8 … −3.0 h 1.2,
 *    z −5.15 … −4.85), the clearing barrel (−5.2, −8.6), a shelf under `p5_gate_med`; interactable `note5_visitors`;
 *    markers `mk5_gate_panel`, `mk5_aas_palm`, `mk5_onpost`. The booth's back door is yours (a prop into solid).
 *  - duty5: watch desk x −3.0 … 0.0, z −16 … −15 (h 1.0), cabinets x 4.4 … 5.6, z −21.8 … −21.2 (h 1.3; cover
 *    `cv5_d2` stands east of them); screens `dock_status` (west wall), `key5_panel` (7.78, 1.35, −13.9) −x;
 *    interactables `note5_watch`, `note5_roster`, `key5_duty` (R8 eye gate x < 7.8); markers `mk5_keypad`,
 *    `mk5_c1_cam0/cam1/sol/door/end`; a shelf under `p5_duty_ammo`. The duty camera is yours.
 *  - ready5: locker rows L1 / L2 (h 2.0), crates C1 C2 C3 (h 1.2), the kit rack (h 2.2) — every one a cover object
 *    (§5.4 `cv5_r*`); interactables `note5_locker`, `radio5` (disabled; the story moves it to the corpse point);
 *    markers `mk5_locker_slam`, `mk5_helmet_rest`, `mk5_c1_out`, `mk5_duty_u1/u2`, `mk5_s1`; shelves under
 *    `p5_ready_med` / `p5_ready_ammo`. The ready-room camera (−10.0, 3.0, −22.25) −z with a red tally and the benches
 *    (h 0.45, walkable) are yours.
 * Vignettes this task defines (each with its `:snap`: `L.vignette(id, run, { snap })`; a greybox placeholder exists
 * until it does): `gate5_open`, `gate5_booth`, `v5_turnstile`, `v5_hull_groan`, `key5_power`. Their sounds are yours
 * (§8.11); the gate's two are the door's own, never the vignette's.
 * Puddles: add each wet patch's box with `addWet(L, box)` (grey.ts) — the same box you give `fx.wetPatch` — so
 * `level.regions.wet` (audio's `wet` footsteps) matches what is drawn.
 */
import type { RoomId5 } from './grey';
import type { RoomDress } from './index';

export const FORE_DRESS: Partial<Record<RoomId5, RoomDress>> = {};
