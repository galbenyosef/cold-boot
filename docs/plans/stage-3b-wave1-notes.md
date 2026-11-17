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

## Set pieces (W9a, `src/level/l4/setpieces.ts`)
- `theatreArm(L, at, opts)` → object `theatre_arm`; `userData`: `cycle {t, n, cue, attempt, period, led}`, `setFailHold(s)`,
  `onCue(cb)`, `cueTimes()`, `timeTo(cue)`, `onWisp(cb(worldPos))`, `setTime(t)`, `claspWorld()`, `attempt0`.
  Timeline: approach 0, fit 6, handshake 12, fail 14.5, remove 14.5+failHold, regel +5, return +6, idle +5 (7 s) = 40.0 s at
  failHold 2.5. LED: off until 9.45, amber 9.45–12 (seated, powered, not linked), red steady 12–13, three blinks 13–14.5,
  off from fail. `setMachine('theatre_arm','off')` parks it over 3 s. Default rail x −1.7, z −50.4…−58.4, y 9.2 (fixed 3 m
  mast + telescope). ≤ 6 draw calls. **ST/D2:** drive the `theatre_cam` screen from `cycle.cue` and `cycle.led`.
- `clasp(b, L, state, phase?, led?, mono?)`, `defineClaspInstances(L)`, `claspInst(b, …)`; states `amber`, `red`, `red_solid`,
  `off`. `orTable`, `gelBath` (gel surface y 0.92), `claspBin(n = 30)`.
- `body(L, b, pose, name, opts)`: six poses; options `suitHalfOff`, `armOut`, `nape`, `collider`, `deskY`, `chair`; lying poses
  have the head at local −z, origin at the pelvis (ry = +π/2 → head toward −x). **D1b:** Ness (sitting_desk) needs the desk
  front edge ≈ 0.4 m ahead of her origin — place her at z ≈ −28.0, not −28.2.

## Kits (W9b, `src/level/l4/kit4.ts`)
- Conventions in the file header: floor props origin on the floor, front = local +z; wall props origin on the wall face;
  `b.at(x, y, z, ry, () => prop(b, L, opts))`; every collider can be switched off with `collide: false`.
- Returns worth using: `cradleRack` → 24 slot matrices (for Clasps); `nozzleGrid`/`jetPanel` → tip points + spray direction
  (fx emitters); `boothConsole` → terminal / status panel / release button points; `gaugePanel` → screen point.
- Moving parts: `valveLever().set(k)`, `sumpGrille().lift(k)`, `rotBeacon().set(on)`, `gaugePanel().set(bar)`.
- Emergency strips: `stripMat(L)` shared; `setStrips(L, 1)` for `lights_out4`. Emissives ≤ 0.35 by default.
- Booth: origin (28.0, 0, −55.2), ry π puts the console recesses on the plan's coordinates.
- Weak, fix while dressing if cheap: cage mesh reads as bar grating; `vestHooks` faint; pumps show no sign of running.
