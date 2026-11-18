/**
 * POST 4 — the sub bay, the dive locker, the launch-lock access, the trunk tunnel (stage 3c §2.6, §2.7, §2.9, §4.8,
 * §5.5; task D3). STUB (W4): the greybox shell runs without it. D3 replaces the body; keep the export and its type.
 *
 * Contract (see ./index.ts `RoomDress`, ./grey.ts header):
 *   export const BAY_DRESS: Partial<Record<RoomId5, RoomDress>>
 * for the rooms sub5, dive5, lockacc5, tunnel5. Per room: `build(L)`, `lights` (the sub-bay table also holds
 * `sub5_emerg`; keep the group names), `look`, `label: false`.
 *
 * The shell already made (do NOT re-create; restyle / hide stand-in visuals, one collider per object):
 *  - sub5: the four gallery decks (y 4.65 … 4.8: west x 22.2 … 25.0, east x 43.0 … 45.8, north z −21.0 … −18.2, the
 *    bridge z −36 … −34), the 1.1 m rails on their inner edges, the steel parapet plates (h 1.1, colliding, low cover
 *    `cv5_g*`: west x 25.0 … 25.08 at z −50 … −40 / −30 … −22, east x 42.92 … 43.0 at z −48 … −38 / −30 … −22, the
 *    bridge's north edge x 28 … 32 / 36 … 40); `STAIR5_W` and `STAIR5_E` (nav stairs); the boat stand-ins (cradle
 *    x 31.8 … 36.2, z −43.4 … −26.6 h 0.6, hull, sail — W7's `tern` replaces the look; keep the colliders or replace
 *    both), the two rails x 33 / 35; the floor cover stand-ins CA CB CC CD, the forklift, the gas racks, the four
 *    equipment boxes EW1 / EW2 / EE1 / EE2 (§5.4 `cv5_f*`), the locker by `d5_arm_bay`, the gallery locker by the
 *    wheel; the launch console (x 33.3 … 34.7, z −34.3 … −34.0, h 1.1) with screens `launch`, `launch5_palm` and the
 *    interactable `launch5_palm` (phase-gated: S on); interactable `wheel5` (22.25, 5.9, −52.0) r 1.2 (phase-gated:
 *    V on) and a manifold plate PLACEHOLDER (replaced when W7's `wheel5()` registers `wheel5`); the drains (voids under `drain5_a_grille` / `drain5_b_grille`,
 *    `userData.open('lift', snap?)`, nav obstacles); the sentry's roof dock; the launch-lock port opening + pane
 *    into the `outside` void (z −55.8 … −56.4); the port pane and a frame ring are a PLACEHOLDER
 *    replaced when W7's `launchLockDoor()` registers `lock5_launch`; screens `tern_board`, `tunnel_panel`; markers `mk5_launch`, `mk5_wheel`, `mk5_tern_board`,
 *    `mk5_drain_a/b`, `mk5_dive_door`, `mk5_lockside_door`.
 *  - dive5: the decompression chamber stand-in (x 49 … 51.6, z −39.6 … −36.0), interactable `note5_dive`, a shelf.
 *  - lockacc5: the flood-valve stencil. tunnel5: the sealed `door5_headend` (x 14), a cable tray, the trunk cable,
 *    the stencil, a shelf under `p5_tunnel_med`.
 * Vignettes this task defines (each with its `:snap`; greybox placeholders until then): `v5_sub_check` (drives
 * `tern.userData.check()`), `wheel5_turn`, `drain5_a`, `drain5_b`, the bay half of `lights_out5`, `dark5_on` (adds
 * spine5 + sub5 to `level.regions.dark`, idempotent). The greybox object `tern` (a marker with `userData.check()`) and
 * the machines `tern`, `wheel5` are placeholders W7 replaces. One frame zone `frames5_sub5` holds the five sub-bay doors.
 * Puddles: add each wet patch's box with `addWet(L, box)` (grey.ts) — the same box you give `fx.wetPatch` — so
 * `level.regions.wet` (audio's `wet` footsteps) matches what is drawn.
 */
import type { RoomId5 } from './grey';
import type { RoomDress } from './index';

export const BAY_DRESS: Partial<Record<RoomId5, RoomDress>> = {};
