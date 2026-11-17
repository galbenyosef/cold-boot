# Stage 3b — integration list (everything is merged on main; this is what is left before the user plays)

State: K, wave 1 (player, UI, audio, greybox, enemies, materials, fx, set pieces, kits, voices), wave 2 (five dressing files,
story, tests) are all on main. The story was tested by its author on the bare greybox only; the dressing was built without the
story; the test script was written blind. Nothing has run together yet. Coordinator's last run on the dressed level (before
the story merge): typecheck, build, reach (all phases), fxleak (levels 3, 4), weapons — pass; zfight — 0 errors, 22 warnings.

## A — logic, tests, sound (agent IA)
1. `LEVELS[3].next = 4` (the hand-over from 3a goes live); `play:l3 --choice=stop` through the hand-over.
2. Level: remove the placeholder button `l4_stub_end`; split `g4_vent` into `g4_vent_a` / `g4_vent_b` (the story spawns the
   chosen pair; drop its `spawnPose` workaround); optional `mk4_pumps` marker for the pump loop. `mk4_bodies` list must match
   where the dressing really put the bodies (Eng moved to (36.2, −62.32); Holm's origin (−10.25, −29.0)).
3. `src/story/voice.ts`: add `lines.l4.json` to the line DB like level 3's; keep Sunde's 14 m subtitle rule (give `speak` a
   flag if needed) and drop the story's own subtitle wrapper.
4. Audio: the `screen` voice fx must not start every Sunde line with the recorder's 0.28 s tape clunk (nine clunks in one
   log): `fxLead('screen') = 0`, no lead in the chain; `l4_sunde_4` arrives ~1 dB low (raise `POS.screen.gain` or renormalise
   the take) — decide by measurement.
5. `scripts/check-voice-level.mjs`: add `--level 4` (diff from the story agent: `docs/plans/stage-3b-handoff/
   st-check-voice-level-l4.diff`); for fx chains with a lead, detect the voice after the lead.
6. `scripts/playthrough-l4.mjs`: the nine fixes listed by the story agent (below), then make every mode pass on the DRESSED
   level: default (both choices), `--checkpoints`, `--impatient`, `--order` (a–e), `--softlock` (a–h; (c) and (h: bay) in
   separate runs), `--frames`. The story agent's own driver for cases the script lacks: `docs/plans/stage-3b-handoff/
   st-cases.mjs` (fold its cases #7, #10, #15, #22 into the script or keep it as `scripts/` helper).
   Fixes: (1) `_9` cut compared with `cut + fxLead('screen')` (0 after item 4); (2) arm cycle: wait for two `approach` cues on
   game time (~90 s), not 45 s wall clock; (3) wait for the previous CHOIR/unit line's `end` before taking the carbine;
   (4) skip "worker at hood 2, dormant" in impatient mode; (5) shoot the navy sentry dock from about (28, 0, −61) (the booth
   glass blocks the old spot); (6) armour-carried check only when the cage segment ran; (7) softlock (b): enter the shower
   doorway within ~0.1 s of arming; (8) softlock (c) and (h: bay) in separate runs; (9) spawn-visibility on the vent pair.
7. Dressing vs story ownership of sounds and vignettes: the story does NOT play `decon_hiss`, `shower_jets`, `gate_dogs`
   (their vignettes do — verify once each, no doubles); the dressing's real `theatre_arm` (W9a API) replaced the placeholder —
   verify the announcer lines still land on the arm's cues (≤ 0.12 s) and the `theatre_cam`/`theatre_screen` are driven once
   (the surgical dressing drives them from `cycle`; the story must not also write them, or the reverse — pick one).
8. Husks walk at 1.3 m/s when alerted: the store wave reaches the plant holdout late and the plan's nav time bounds were
   loosened. Decide and implement: the story `rouse`s groups that must arrive (or the enemies API gets a "run to" for
   story-called groups) so the holdout and the tube fight have pressure. Measure arrival times.
9. `check-dark` on the real lights-out (LOW, MEDIUM): calibrate thresholds with `--measure` on real frames, then pass.
10. `check-chain`: green (stub button gone; allow-list is already updated on main).
11. Full CHECKLIST on levels 1–4 at the end (one run at a time), incl. `check:voice`, `check:weapons`, `check:fxleak`.

## B — look, readability, performance (agent IB)
1. **Bodies (set pieces):** Eng with the suit half off has a bare brown mannequin head ("crash-test dummy"); bodies read as
   smooth mannequins. Fix so no body shows a bare featureless head (hood up / respirator and visor on / face turned into the
   floor with hair) and suits have folds/creases enough to read as people in suits.
2. **Clinical door style:** clean-side doors still have the industrial yellow/black chevron frames of levels 1–2. One door
   styler per level: give level 4 a styler that draws clinical frames (white/stainless, small status light) on Deck 2 and
   navy frames (grey, stencil) on Deck 1; pressure doors (lock, tube, gate) keep hazard markings.
3. **Theatre readability from the gallery:** the table is small from the path and the Clasp is a few pixels; the amber/red
   read is carried by the ring and by the desk monitor. Make the lesson unmissable without breaking the calm: larger status
   ring/halo within reason, the desk monitor (`theatre_cam`) showing the AMBER stage (cue `fit`, t ≥ 3.45) and a clearer nape,
   the wall screen without the built-in footer "CHOIR PRIORITY OVERRIDE" (use a kind/variant without it). Judge from the
   path frames and a sprint-through.
4. **Armoury cage reward:** the carbine on its rack and the vests are dark silhouettes behind the mesh — light and place them
   so the eye goes there from the checkpoint door (LOW and MEDIUM).
5. **Kit z-fight warnings (22):** `floorStrip` lens 2 mm above the channel (gallery, scrub), `tubeRib` crown splice plate 5 mm
   from the rafter faces, `labSink` towel dispenser bottom; door frames `frames4_*` at y 0 and the gate jamb bottom. Fix in
   the kit; remove the local copies the dressing files made only if trivial.
6. **Performance (budget: 60 fps LOW/MEDIUM; per-space draw-call limits in the plan §2):** records view 222 (limit 220),
   corr_s after lights-out with 3 husks 217 (limit 220), shower-exit view 232–237 (limit 220), shower interior 135 (120).
   Causes found: pickups are not room-culled (118 pickup meshes in one frustum); door-frame zones of far rooms drawn (8 calls
   each); a lab husk costs 12 calls (worn: 9), three ≈ 86 with shadows; the `theatre` point light takes a LOW slot in corr_s
   and records views (needs bounds); from records the portals draw corr_s, corr_w and cold; MEDIUM selects 9 points in perf
   view (1) (pool 8). Bring every plan perf view inside its budget on LOW and MEDIUM and report HIGH.
7. **Lights-out mood:** corridor emergency lights are "lower-key but still bright and blue" — it must stay readable by
   flashlight (check-dark) but feel like a blackout, not a blue-lit corridor; no hot spots on walls. Store4 is pitch black
   when entered (husks come from there): keep it dark but readable by flashlight.
8. **Gate panel:** the `gate_panel` screen fills with generic log lines that compete with `AUTHORISED: AAS, L. (LT.) — PALM —
   LIVE`; make that line the content. **Tube:** one flood lamp outside reads as a hazy bright blob through the glass in the
   hero frame — it must read as a lamp in water, not as an unexplained glow (the user reported exactly this class in 3a);
   flood cones are a saturated electric blue.
9. Smaller: decon/shower read as milky haze rather than jets; Node 2 racks nearly black, LEDs faint through the window; Eng's
   smears faint on dark steel; Clasps on the cold-store rack barely visible (pips carry the amber); glass impact decal is
   dark on dark panes everywhere except the gallery (a light star decal for glass in fx); `stainless` mottle on large panels;
   level 3: `d3_clinic`'s frosted leaf is see-through while its portal is `see: false`.
10. Walk the whole level in frames (lit and after lights-out, LOW and MEDIUM), look at every frame, fix what reads wrong.
