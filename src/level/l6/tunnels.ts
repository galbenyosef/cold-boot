/**
 * LEVEL 6 — dressing of lock6, tun6_a, rep6 (tent, drums), bay6, tun6_b (dark); vignettes `v6_tent`, `tun6_far_out`.
 * STUB (W4a): task D1 fills it (stage 3d §11).
 *
 * Contract (`RoomDress`, l6/index.ts): per room an optional `build(L)` (run after the room's greybox shell inside its
 * build pass, culled with the room), `lights` (replaces the room's placeholder light table `LIGHTS6[room]`; keep the
 * §2.7.1 group names and the floor bounds), `look` (materials of the shell faces), `label: false` (no greybox label).
 * Two files may dress one room (pool6: pool.ts, then dockdress.ts): their `build`s both run, in that order; `lights` /
 * `look` of the later file win. Never edit the shell's colliders, doors, triggers, phases, screens, interactables or
 * markers (grey.ts header); containment colliders (coaming, bar guards, cage, shaft well guards) stay the shell's.
 * A vignette registered here replaces the greybox placeholder of the same id (grey.ts `placeholders6`); give it a snap.
 */
import type { RoomId6 } from './grey';
import type { RoomDress } from './index';

export const TUNNELS_DRESS: Partial<Record<RoomId6, RoomDress>> = {};
