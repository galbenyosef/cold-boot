# Stage 3b — what wave 1 built that wave 2 must know (as built; wins over the plan where the plan was silent)

## Screens (W6, `src/materials/screens4.ts`) — text formats
- `containment`: `suite|hold|62:09:14[|<]` → `suite|cleared`; `store|hold|62:09:14` → `store|ack|<clock>`. The DOOR OPEN
  counter counts up by itself from the value written (write once). Arrow on the suite panel defaults to `<`; `>` flips it.
- `video_log`: `idle` | `paused|<line>` | `play|<line>|<seconds>|<pose>` | `static`. Poses: `settle`, `off`, `lean`, `down`,
  or empty. Each pose eases from the previous; the mask moves for `<seconds>`.
- `theatre_cam`: `<cue>|<seconds into the cue>|<attempt number>`; cue `off` = "NO PROCEDURE". The screen advances the cue
  time itself; write once per cue. LED: red 1.0 s then 3 blinks (0.25 on / 0.25 off) during `handshake`; off otherwise.
- `roster`: fixed content, `text` ignored. 23 names in `CREW`; NO SIGNAL: RISA, ØDEGÅRD, HAGEN, KNUTSEN; Aas is not listed.
- Legible at: `surg_hold` 0.8 m panel at 5 m; `cold_panel` 0.6 m at 3 m; `theatre_cam` 0.6 m LED at 3 m, text at 1 m;
  `video_log` 0.6 m at 1.2–2.5 m; `roster` 2.4 m summary at 6 m, names at 3 m. Size and place screens accordingly.
- `clinical` signs: pictogram by keyword (biohazard, snowflake, document, rack, flask, cross, stairs, warning, person) or a
  `[name]` prefix; text starting `FUMIGATED` draws a yellow sticker; arrows only at the very start or end of the text.
- Materials: `wall_clean`, `floor_epoxy`, `ceiling_clean`, `stainless`, `frost`, `tyvek`, `navy_grey`, `deck_nonslip`.
  `stainless` shows cloudy mottle on large flat panels — use it on benches, doors, trims, not whole walls.

## Audio (W2b)
- Sound ids exist as the plan names them; `decon_hiss` is a fixed 8.0 s one-shot (8.8 s with the bleed), `shower_jets` a
  fixed stereo one-shot (jets 0.5–6.0 s, spin-down to 7.5 s) — keep the vignette timings to these. `pump_loop` and
  `alarm_beacon` are loops (`stop(3)` = 3 s wind-down). `arm_servo_loop` is level 1's (industrial): play it with lower
  `pitch`/`volume` in the theatre.
- **ST:** emit `story:beat l4_lights_out` at lights-out AND again when restoring a checkpoint past it (`cp4_hold` onward).
- Theatre sounds are heard through the gallery glass (may be low-passed as occluded); `clasp_click` and `gel_dip` are
  built to survive that.
- Voice fx `screen` (Sunde's log) has its own distance profile at conversation level.

## Enemies (W5)
- `EnemySpawn.skin: 'lab' | 'navy'` works for husks and sentries. `pose: 'bench', idle: 'worker'` = pipetting at a fume
  hood: work surface ≈ 0.9 m, sash plane ≈ 0.55 m ahead of the unit's feet, opening up to ≈ 1.3 m. With the plan's spawn
  (−6.0, 4.8, −22.6), yaw 0, the hood front must be at z ≈ −23.15.
- A lab husk costs 12 draw calls (worn: 9), a navy husk 11.

## Voices (W8)
- 47 lines in `voice/lines.l4.json`; `l4_sunde_9` has `"cut": 3.27` (stop playback there). Sunde's lines have `lead` 0.
