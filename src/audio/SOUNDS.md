# Audio ids and auto-triggers

Everything is synthesised (no assets). One-shots are pre-rendered offline at load into several variations.
The `load` set is awaited in `createAudio` (about 0.4–0.6 s). The `idle` set renders in the background right
after (about 0.3–0.4 s), then the `late` set (about 0.25 s; rare Revision-2 vignette sounds). `lazy` sounds
render on first use and still play if they are ready within 0.3 s.
Unknown ids warn once and do nothing. Calls made before `unlock()` are safe: one-shots are dropped, and
loops and music start when the context resumes.

## Which events trigger sounds automatically (do NOT also call `play` for these)

| event | sound(s) |
|---|---|
| `weapon:fired` pistol | `pistol_fire` (2D) + `casing_metal` on the floor to the right, about 0.4–0.6 s later |
| `weapon:fired` shotgun | `shotgun_fire` + `shotgun_pump` at +0.36 s + `shell_drop` at about +0.8 s |
| `weapon:empty` | `dry_fire` |
| `weapon:reload` pistol | `pistol_mag_out` → `gear_rattle` → `pistol_mag_in` → `pistol_slide`, spread over `duration` |
| `weapon:reload` shotgun | if `duration` < 0.8 s: one `shell_insert` (per-shell reloads). Otherwise one insert per missing shell across `duration`, plus `shotgun_pump` at the end if the tube was empty |
| `weapon:switched` | `weapon_switch` |
| `bullet:impact` | `impact_<surface>` at the point (`metal`, `concrete`, `glass`, `rubber`, `robot`, `flesh`). Metal adds `ricochet` 22% of the time. Max 3 per 50 ms, so shotgun pellets are fine |
| `player:footstep` | `step_metal`, `step_grate` (metal in `corr_a` / `elevator`), `step_concrete`, `step_rubber` (also flesh), `step_glass`. Running is louder and adds `gear_rattle` |
| `player:jump` / `player:land` | `jump` / `land` (volume follows landing speed) |
| `player:damaged` | `hurt_impact`. When amount ≥ 12, also `ear_ring` and a short concussion muffle |
| `player:died` | `player_death` |
| `player:flashlight` | `flashlight_on` / `flashlight_off` |
| `pickup` | `pickup_weapon` (pistol / shotgun), `pickup_ammo`, `pickup_medkit`, `pickup_keycard` |
| `door:opening` / `door:closing` / `door:denied` | `door_open` / `door_close` / `denied` (3D, at the door) |
| `interact` | kind `terminal` or `log` → `terminal_beep`; `lever` → `lever`; `button` → `button` |
| `enemy:spawned` | skitter → `skitter_chitter` |
| `enemy:woke` | `husk_wake`, `skitter_chitter`, `sentry_wake` |
| `enemy:alerted` | `skitter_screech`, `husk_vocal` (glitched "customer service" vocaliser), `sentry_alert` |
| `enemy:attack` | `skitter_attack`, `husk_attack` (+35% `husk_vocal`), sentry → `sentry_fire` (the laser shot itself) |
| `enemy:damaged` | `impact_robot` at the hit point, plus sometimes `skitter_hurt` / `husk_hurt` / `sentry_hurt` |
| `enemy:died` | `skitter_death`, `husk_death`, `sentry_death` |
| `enemy:step` | `skitter_step`, `husk_step` (+20% `husk_joint`), `foreman_step`. Sentry steps are ignored |
| foreman (`enemy:woke` / `alerted` / `attack` / `damaged` / `died`) | woke → `husk_wake` (low) + `foreman_step`; alerted → three `husk_vocal`s out of sync (three staff voices); attack → `foreman_slam` (melee) or `arm_reach` (ranged/throw); damaged → `impact_robot` + 40% `husk_hurt`; died → `husk_death` ×3 staggered + `foreman_slam`. `foreman_loop` (idle servos + three murmuring vocalisers) is **not** automatic: loop it on the foreman if wanted |
| `story:beat` `wake` | two `heartbeat`s |
| `story:beat` `corr_blackout` *(legacy, Rev 1)* | `power_down` + `vent_scuttle` moving through the ceiling from behind the player to ahead of them (starts +1.4 s) |
| `story:beat` `sec_ambush` *(legacy)* | `metal_clang` at `level.object('sec_vent')` |
| `story:beat` `storage_unlocked` *(legacy)* | `door_unlock` at d_storage |
| `story:beat` `power_restored` | `power_up`. The fab ambience bed also gains a mains-hum layer |
| `story:beat` `choir_speaks` | `glitch` |
| `story:beat` `fab_ambush` | `sting` + 3× `alarm_blip`. Does NOT start `alarm_loop`: loop it yourself if wanted |
| `story:beat` `elevator_ready` | `elevator_arrive` at the elevator |
| `story:beat` `descent` | `elevator_start` (one-shot). Story/level should `loop('elevator_loop')` for the ride itself |
| other / Revision-2 beats | nothing. The story and level play their own vignette sounds; beat ids audio doesn't know are ignored, and the legacy cases above simply never fire |
| `game:state` | `paused` → muffle 0.85; `dead` → muffle 0.6 + `sting`, music silence; `menu` → quiet menu drone (until `setMusic` is called during the menu); `ended` → slight muffle |

## Automatic (no calls needed)

- **Room reverb and ambience bed:** in `update`, `level.roomAt(player.position)` picks the convolution IR
  (padded / corridor / hall / machine / shaft / dead / cistern), the wet level and the base bed loops
  (`amb_room` / `amb_fab` / `amb_gen` / `amb_quarters` / `amb_pump`), with crossfades. `setRoom(id)` forces a
  room. Unknown room ids map by name (`*quarter*|bunk|crew` → quarters, `pump|sump|coolant` → pump, `corr*` →
  corridor, …) and otherwise fall back to a generic corridor preset. Don't loop `amb_*` yourself unless you want
  an extra layer.
  - `quarters`: tiny dead fabric IR, very quiet bed (low air + faint 60 Hz transformer hum), and a
    `lamp_creak` from the pendant lamp at (-5.5, 2.6, -7) every 6–15 s.
  - `pump`: long wet metallic `cistern` IR, bed of standing pipe resonances + a thin trickle (no pump running),
    `drip`s at random points in the room every 1–7 s, distant `water_slosh` / `pipe_knock` / groans.
- **Room-local events:** the presets above (`local`), independent of the distant-event slot.
- **Generative distant events — one at a time, never stacked.**
  - *Quiet "dread" rooms* (`med`, `corr_a`, `quarters`, `junction`, `sec`, `storage`): `far_steps` (a limp,
    often one floor up, drifting), `drag_far`, a door servo two rooms away (`door_open`, low-passed),
    `breath_far`, a single distant `husk_whisper` (≤ 1 per 4 min), `pipe_tick`, `dist_knock`, rare groans and
    scuttles. Mostly behind the player, 20–60 s of silence between them (×1.5 under tension music), the first
    one 12–35 s after entering. Never while enemies are active or combat music plays. Each one's peak at the
    listener is capped analytically below the player's own walking footstep (measured 0.13–0.5×).
  - *Room tone drops out:* in quiet rooms, every ~1.5–3 min, the ambience bed falls to ~5 % (−25 dB) and music
    to 45 % for 2–4 s, then returns; 45 % of the time a distant event follows 2.5–5 s later.
  - *Other rooms:* the denser industrial palette (`dist_clank`, `metal_groan`, `dist_knock`, `drip`,
    `vent_scuttle`, `dist_voice`, `spark_zap`, `water_slosh`, …) every 9–30 s, suppressed during combat.
- **Low health:** a `heartbeat` that speeds up below 40 hp, plus a `tinnitus` loop below 25 hp.
- **Music auto-escalation:** if the story requested `ambient` or `tension` and `enemies.activeCount > 0`
  for more than 1.2 s, the music switches to `combat`. After 4 s with no active enemies it plays
  `aftermath` for about 22 s, then returns to the requested state. `setMusic('combat' | 'silence')`
  overrides it.
- **Recorded voices (REVISION 4):** see *Voice lines* below. Speech ducks music/ambience slightly
  (music −22 %, ambience −18 %; CHOIR −37 % / −30 %) while it plays.
- **CHOIR (synthesised fallback):** `choirVoice(text, duration)` renders the line offline (about 70–130 ms) and plays it on the
  voice bus. It ducks music by 6 dB and ambience by 4 dB while it speaks. It includes the PA switch-on and
  switch-off sounds.

## Direct-use ids (call `audio.play` / `audio.loop`)

**One-shots (2D if no `position`)**

- UI: `ui_hover`, `ui_click`, `ui_open`, `ui_close`
- World: `terminal_beep`, `lever`, `button`, `denied`, `power_down`, `power_up`, `alarm_blip`, `metal_groan`,
  `vent_scuttle`, `glitch`, `glitch_long`, `steam_burst`, `spark_zap`, `body_fall`, `metal_clang`, `sting`,
  `heartbeat`, `explosion`, `door_unlock`, `elevator_start`, `elevator_arrive`, `pa_on`
- Enemies: **`sentry_charge`** (the enemies module should play it at the start of the sentry's telegraph.
  Audio cannot know when that starts, and the shot itself is automatic on `enemy:attack`)

- Revision 2 (vignettes / story; all 3D with `position`):
  - `pa_chime` — soft two-tone PA chime through a cheap ceiling speaker (voice bus). Play it right before
    `choirVoice` (which adds its own PA switch-on). 2D or positional.
  - `locker_bang` — fist on a steel locker door from inside (one variant is a double hit). Call 3× for the vignette.
  - `pipe_knock` — single knock on a water-filled pipe. **Variants are cycled in pitch order** (ping-pong, restarting
    after a 2.5 s pause), so a knock sequence moved along a pipe run reads as travelling.
  - `glass_thump` — wet palm slap + squeak on thick glass. `monitor_beep` — medical monitor beep.
  - `conveyor_clunk` — the overhead conveyor indexing one notch (ratchet + chain + structure ring).
  - `canister_roll` — gas cylinder tips over, clangs, rolls ~2.5 s, knocks into something (≈ 3.4 s total).
  - `curtain_rail` — curtain rings dragged along a rail (~0.8 s). `gate_rattle` — cage gate hit from the shaft side.
  - `water_slosh` — something large moving in shallow water.
  - `husk_whisper` — a husk vocaliser muttering a polite fragment, small and close (6 variants).
  - `breath_far` — distant not-quite-human exhale ending in a valve click (very quiet).
  - also: `far_steps`, `drag_far`, `pipe_tick`, `lamp_creak` (used by the ambience layer, playable).

- Revision 4 (level 2; one-shots render in the background, loops on first use; all 3D with `position`):
  - line: `belt_start` (contactor, motor wind-up, chain snaps tight, ~3.4 s), `press_slam` (valve, slam,
    exhaust, release), `arm_reach` (fast servo + hydraulic stop), `contactor_arc` (clang, arc, bus hum rises),
    `bulkhead_grind` (≈ 4 s, ends with the seat clunk), `cell_pull` (ratchet, latch, the cell winds down).
  - booth: `intercom_click` (button + speaker pop), `intercom_static` (1.6 s burst; `loop()` it for a bed),
    `glass_bang` (fist on thick laminated glass; variant 3 is a double), `marker_squeak` (1–3 strokes).
  - `shoe_slide` (a shoe pushed back into line), `foreman_step`, `foreman_slam`.

**Loops**

Revision 4: `belt_loop` (rollers + chain, put it on the belt), `treadmill_loop` (motor + human-rhythm
footfalls), `polisher_loop`, `siren_loop` (motor siren, 4 s up/down), `core_hum` (stereo: 40 Hz + a faint
high cluster), `lift_loop` (service lift ride, 2D), `foreman_loop`.

`amb_room`, `amb_fab`, `amb_gen`, `steam_loop`, `spark_loop`, `machine_loop`, `arm_servo_loop`,
`conveyor_loop`, `elevator_loop`, `alarm_loop`, `skitter_loop`, `husk_loop`, `sentry_loop`, `monitor_hum`,
`fluorescent_buzz`, `tinnitus`, `amb_quarters`, `amb_pump`. Pass `{ position }` for 3D. Move them with `setPosition` (allocation-free).
3D loops get distance air-absorption and occlusion: a low-pass plus an attenuation when
`physics.lineOfSight` is blocked, re-checked round-robin at low rate.

## Other one-shot ids (used internally, also playable)

Weapons: `pistol_fire`, `shotgun_fire`, `shotgun_pump`, `pistol_mag_out`, `pistol_mag_in`, `pistol_slide`,
`shell_insert`, `dry_fire`, `casing_metal`, `shell_drop`, `weapon_switch`.

Player: `step_metal`, `step_grate`, `step_concrete`, `step_rubber`, `step_glass`, `gear_rattle`, `jump`,
`land`, `hurt_impact`, `ear_ring`, `flashlight_on`, `flashlight_off`, `pickup_ammo`, `pickup_medkit`,
`pickup_weapon`, `pickup_keycard`, `player_death`.

Impacts: `impact_metal`, `impact_concrete`, `impact_glass`, `impact_rubber`, `impact_robot`,
`impact_flesh`, `ricochet`.

Enemies: `skitter_step`, `skitter_chitter`, `skitter_screech`, `skitter_attack`, `skitter_hurt`,
`skitter_death`, `husk_step`, `husk_joint`, `husk_vocal`, `husk_wake`, `husk_attack`, `husk_hurt`,
`husk_death`, `sentry_charge`, `sentry_fire`, `sentry_alert`, `sentry_hurt`, `sentry_death`,
`sentry_wake`.

Ambient events: `dist_clank`, `dist_knock`, `drip`, `dist_voice`.

Music instruments (music bus): `mus_kick`, `mus_snare`, `mus_hat`, `mus_metal`, `mus_pulse`, `mus_tick`,
`mus_bowed`, `mus_riser`, `mus_boom`, `mus_bell`.

## Music states

`setMusic('silence' | 'ambient' | 'tension' | 'combat' | 'aftermath')` crossfades generative layers.
`setTargetAtTime` is used everywhere, so transitions can't click.

- **ambient:** sub drone, slow detuned partials and occasional bowed metal.
- **tension:** rising detuned-saw cluster swells, irregular low pulses and ticking.
- **combat:** 132 BPM industrial pulse with a distorted kick, half-time clank snare, metal percussion,
  an E-phrygian saw bass riff and 8-bar riser/boom phrases.
- **aftermath:** hollow beating drone, decaying bells and wind.

## Voice lines (REVISION 4)

`say(id, { position?, volume?, pitch? })` plays a recorded line; `preloadVoice(['l2_tomas_', 'l2_choir_core_1'])`
fetches + decodes + processes ahead (ids or id prefixes). Data: `voice/manifest.json` (bundled: file, duration,
speaker, subtitle text, fx) and `voice/lines.l*.json` (for lines not generated yet). Files: `voice/<id>.mp3`
relative to the page (`import.meta.env.BASE_URL`), so it works under a GitHub Pages sub-path. The bytes of the
current level's lines are fetched in the background ~1.5 s after `createAudio` (≈ 2–4 MB); decoding and the fx
render (5–30 ms, CHOIR ≈ 80–200 ms) happen on first use and are cached (LRU, 24 MB of PCM).

- **Handle:** `duration` is the manifest duration (clean take) and is known at once; `done` resolves when the
  audio ends or `stop(fade)` finishes. Positional lines (`position`) use a panner + occlusion low-pass like
  other 3D sounds; `setPosition` moves them. 2D lines go to the voice bus (CHOIR / PA also into the plate).
- **Never throws.** Unknown id → warns once, silent handle (2.5 s). Not generated / file missing / decode
  error → warns once; CHOIR lines fall back to the synthesised `choirVoice`, others are silent; `done`
  still resolves after the (estimated) duration. Before `unlock()` lines are silent but keep their timing.
  A line whose audio is ready > 1 s after `say()` is skipped (subtitle sync) — preload long scenes.
- **Run-time fx** (`voicefx.ts`, chosen per line by the generator: `line.fx` › cast `fxRules` › character):
  `clean`; `choir` (the take + copies at −5 / +4 / −12 semitones and a detuned double, small delays, wide,
  "every speaker" slap copies, plate; `choir:N` keeps N layers — the shutdown lines thin out to one voice);
  `intercom` (300–3600 Hz, light drive, hiss, squelch on/off); `headset`/`radio` (420–2900 Hz, more drive,
  static crackle, 1–2 short dropouts); `unit` (comb resonance + ring modulation + light bit-crush, 1–3
  dropouts, one stutter); `foreman` (each layer of a multi-voice line through `unit`, offsets 0 / 85 / 190 ms);
  `recorder` (tape clunks, wow/flutter, hiss, small-speaker band); `pa` (ceiling speaker + small hard room).
  Output speech RMS is the same for every chain (relative take level kept, so whispers stay quieter); peak ≤ 0.95.

## Room presets (level 2)

`cab` shaft · `dock` machine, quiet · `intake` padded, quiet · `line` hall, fab bed (+ mains hum layer: level 2
starts powered) · `booth` dead, quarters bed, quiet · `fitting` machine · `relay` machine, gen bed, sparks ·
`spine` corridor, quiet · `core` new bright `clean` IR, almost no bed, no distant events · `lift` dead.
Level-2 quiet rooms use a dread palette without husk whispers.

## Dev harness

`/dev/audio.html` (`?mode=sounds|music|choir|live|ambience|voice`, `&filter=regex`). `mode=voice&ids=l2_tomas_&fx=all`
renders recorded lines through the fx chains (stats per line × chain, click a spectrogram to listen; `&live=1`
runs `say()` through a real `createAudio()`; `&dump=1` adds the processed PCM to the report for an ASR check).
The other modes: shows per-sound stats on
`window.__audioReport` and draws spectrograms. `mode=ambience` (~2 min, real time) measures the dread layer:
footstep reference peak vs every quiet-room event, the room-tone dropout depth, combat suppression, room-id
mapping and per-room bed levels.
