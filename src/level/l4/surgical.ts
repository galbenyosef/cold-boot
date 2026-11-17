/**
 * BIOLOGICAL SYSTEMS — the surgical suite (stage 3b §2.6, §2.7, §2.8, §4.4; task D2). STUB from W4: D2 owns this file.
 *
 * Contract (see ./index.ts `RoomDress`, ./grey.ts header):
 *   export const SURGICAL_DRESS: Partial<Record<RoomId4, RoomDress>>
 * for the rooms scrub, store4, gallery, theatre, stair4. Per room: build(L) / lights / look / label as in entry.ts.
 * The shell already made (do NOT re-create): screens theatre_screen, theatre_cam; interactables note4_list,
 *   sign4_theatre; markers mk4_gallery_spk, mk4_store_door; the gallery glazing; stand-ins: bench tier (two blocks,
 *   0.9 m) and camera desk (1.0 m) — their colliders force the path; the stair (`STAIR4`, colliders + nav) and its
 *   landing; the sealed theatre lower door `door4_theatre` (+ `door4_theatre_panel`).
 * The arm: W9a's `theatreArm(L, at, opts)` registers object + machine `theatre_arm` — call it from theatre.build and
 *   it replaces the greybox placeholder (grey.ts `placeholders4`, same `userData` API).
 */
import type { RoomId4 } from './grey';
import type { RoomDress } from './index';

export const SURGICAL_DRESS: Partial<Record<RoomId4, RoomDress>> = {};
