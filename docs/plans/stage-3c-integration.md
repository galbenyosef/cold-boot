# Stage 3c — integration list (everything but the story is merged on main; this is what is left before the user plays)

State: K, wave 1 (UI, audio, voices, fx, materials, set pieces, props kit, soldier body + behaviour joined and tuned,
greybox, tests) and the four dressing files are on main. The dressing was built without the story and without each other.
As-built facts: `docs/plans/stage-3c-wave1-notes.md`.

## B — look, readability, performance (agent IB)
1. **One ship, not a bunker (the main item).** The spine (`spine.ts`) and the sub bay (`bay.ts`) read as the inside of a
   vessel: riveted `hull_white` plating, ribs, pipe risers, cable trays, frame numbers. The gatehouse, duty room, ready room
   (`fore.ts`) and the berths, heads, mess, galley (`quarters.ts`) kept the greybox's default shell: bare grey concrete walls
   and office drop-ceiling tiles — a bunker/office. Give every room the vessel's language (wall plating, ribs/frames at the
   same pitch, overhead pipes and trays, deck materials — `lino_navy` in quarters, `deck_nonslip`/`rubber_mat` in working
   rooms — ceilings of plate and beams, not tiles), consistent with the spine, within budgets. The mess and ready room are
   also bare and monotone: they need the lived-in detail the bay and spine have.
2. **Emergency strips one colour** across the level (the bay's are red on a private material; the spine uses the kit's
   `emerg` channel, yellow-green; crawl red). Decide once (red for "follow me in the dark" is the bay's working answer) and
   make `setStrips5` drive all of them.
3. **The shape behind the galley's frosted window** is a figure made of rectangles with a round head, sharp-edged: it reads
   as a toy figure, and as a person before the scare fires. It must be an oilskin on a hook (shoulders on a hanger, hood
   hanging, cloth drape, soft through frost) that only becomes "someone" when it swings.
4. **Bodies and the soldier:** the `v5_body` body is level 4's white lab suit (wrong place: it should be a navy cook/sailor,
   and its pose "dragged", not "fell on its side"); the soldier's on-the-back death is a symmetric star; soldiers are smooth
   mannequins (fold/crease detail as level 4's suits got); the planned "dead hand on the stair" was not built for lack of a
   navy body prop — build the navy body once and use it for both.
5. **Set-piece z-fights** (4 clusters, `setpieces.ts`): in `launchLockDoor` the rail-gate boxes sit on the sill top (raise to
   0.51 and face + 0.515) and the hinge plate's front is coplanar with a dog at x ≈ 36.58; in `launchConsole` the toe kick
   is 1 mm proud. Also in other owners' pieces, worked around locally by dressing: `hatchLid` curb and knuckles on the pit
   walls and its box lacking `walkable`; `cmdDoor`'s collider covering the port; `grillePanel.open('drop')` in `grey.ts`
   rotating about the world origin and grilles lacking `userData.rooms` (grey.ts is IA's — report the exact change);
   `stairDressing`'s top post through a lid.
6. **Lighting details:** Kessler's door after lights-out is dark (nearest emergency pool 10 m away); berths dark between the
   two red pools, hot spots on the ceiling above the domes; galley floor very dark on LOW; the bay's rotating beacons (230)
   sweep a hot pool over the far walls; the dive locker is very red; the magazine hatch underside dark before the pop;
   `gate_log` screen 0.42 m wide read from 2.4 m (needs ≥ 0.55 m or ≤ 1.8 m); the level-5 light pool is not room-culled on
   LOW (a far lamp takes a slot) — install level 4's room-scored lights / portal culling for level 5 if it helps.
7. **Readability in the dark with a 10 s flashlight:** soldier Clasp marks hard to pick out at 20–30 m in the bay; tap water
   in the heads barely visible at 4 m (the scare is mostly sound); ballast mist subtle; fallen trays read as pale sheets.
8. **Carried over from stage 3b (all levels):** three walkable spots fully black with the lamp off need a dim emergency
   glow — level 3 kitchen after the takeover (−22.7, 0, −47), level 3 `ring_e` after the takeover (29.6, 0, −29.9), level 4
   `bay` under lights-out (16.3, 4.8, −19); level 4's lights-out rooms still read as lit (vivarium, cold, records, scrub).
9. The carbine's aimed view has a heavy dark receiver block at the bottom centre (player viewmodel) — lighten if cheap.
10. Walk the whole level in frames — lit, after lights-out, flashlight on and off, LOW and MEDIUM, every room incl. the
    crawl and magazine, looking back as well as forward — and fix what reads wrong. Perf views of the plan §2 on LOW /
    MEDIUM / HIGH before and after.

## A — logic, tests, sound (agent IA; starts when the story is merged)
1. `LEVELS[4].next = 5` live; `play:l4` through the hand-over; `check-chain` case rewritten for it.
2. Story + dressing + soldiers together: every `play:l5` mode on the DRESSED level (`--contract` first), `check-soldier
   --real`, `check-dark --level 5`, `check-voice-level --level 5` (the story task's diff).
3. Vignette ownership: `lights_out5` has two halves (spine, bay) that chain — verify one `lights_out_dock`, both halves
   run whoever registers first, and on a checkpoint restore; `v5_body` (code in quarters, smear in spine); each scare's
   sound played once (`--scares` owner audit with `audio.debug.log`).
4. Nav: `dive_spine_soldier` stuck at its spawn; `lockacc_north` does not use the stair; `drain_b_bridge` > 14 s with the
   real hull; the player drifts ~0.8 m west walking straight up `STAIR5_W` (suspected `src/physics/physics.ts` edge
   resolution on the slope slab's diagonal) and manages 3 of 6 stair legs in the check.
5. The cutscene on the real soldier body: the nape shot (the Clasp mark shows only from behind the neck, ±60°), gestures on
   line durations, lines at conversation level.
6. Story follow-ups from dressing: start `l5_choir_names` at `mk5_bunk_radio.userData.v5.voiceAt` (0.9 s) after
   `v5_bunk_radio`; `body()` registers a `mk4_bodies` marker in level 5 (rename/guard); the body radio is −12.5 dB at 6 m.
7. `docs/DESIGN.md`: controls line (right mouse = aim), REVISION 10 (stage 3c as built, flashlight battery, enemy marks).
8. Full CHECKLIST on levels 1–5 at the end, one run at a time.
