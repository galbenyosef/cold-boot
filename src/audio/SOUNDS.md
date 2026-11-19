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
    exhaust, release), `arm_reach` (fast servo + hydraulic stop), `servo` (a small arm's light whir out and back, ~1.3 s; the intake
    vignettes; added at 3d IA — was played but never defined), `contactor_arc` (clang, arc, bus hum rises),
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

`/dev/audio.html` (`?mode=sounds|music|choir|live|ambience|voice|hab|l4`, `&filter=regex`). `mode=voice&ids=l2_tomas_&fx=all`
renders recorded lines through the fx chains (stats per line × chain, click a spectrogram to listen; `&live=1`
runs `say()` through a real `createAudio()`; `&dump=1` adds the processed PCM to the report for an ASR check).
The other modes: shows per-sound stats on
`window.__audioReport` and draws spectrograms. `mode=ambience` (~2 min, real time) measures the dread layer:
footstep reference peak vs every quiet-room event, the room-tone dropout depth, combat suppression, room-id
mapping and per-room bed levels.

## Level 3 — HALCYON HABITAT (stage 3a, `sounds/rev7.ts`)

Everything is `levels: [3]`: pre-rendered in the background on level 3 only, rendered on demand elsewhere. Positional ids take
`{ position }`; loops are started/stopped by the story (`handle.stop(fade)`).

**Loops**: `fountain_loop` (stereo, 8 s; `fountain_stop` one-shot when it dies) · `lamp_hum_warm` / `lamp_hum_cold` (failing ballast) ·
`vending_hum`, `fridge_hum` · `aquarium_loop` (pump + bubbles; stop at the takeover) · `radio_music` (20 s, an original 8-bar
tune through a small kitchen radio; positional so a door muffles it) and `radio_static` (the takeover: start it, later stop) ·
`hvac_loop` (supply grille) · `viewport_rumble` (sub-bass, 31 / 47 Hz) · `purge_air` (nozzle blast, if the story wants to time
the purge itself). Beds (via room presets, not played by hand): `amb_hab` warm, `amb_hab_cold`, `amb_garden`, `amb_lock`.

**One-shots**: `pool_lap` · `lamp_flicker` · `lamps_die` (the grid going out, 3.5 s) · `emerg_on` · `vending_kick`, `vending_drop` ·
`hull_creak` · pressure door `pdoor_release` (dogs, 1.5 s), `pdoor_travel` (leaves, exactly 2.6 s of motion), `pdoor_seal`,
and the composites `pdoor_open` (dogs 0.6 s, then the leaves; also the C2 `pdoor_open_feed` beat) and `pdoor_close`
(travel then seal) · `shutter_slam`, `shutter_roll` (1.8 s) · `door_chime`, `desk_bell` · `badge_ok`, `badge_deny` ·
purge `purge_cycle` (15.6 s composite: valves, 1 Hz amber ticks → 2 Hz after 10.4 s, air blast 0.6–12.4 s, equalise 10.6–13.4 s,
latch at 13.5, all-clear chime 13.85 s; positional at the lock/door), `purge_tick`, `purge_end` · cutscene `chair_creak`,
`mug_clink`, `monitor_switch`, `screen_die` (4 variants, one per screen), `office_die`, `phone_dead`, `alarm_soft` (far) ·
`habitat_takeover` (7 s; **playing it, or a `story:beat` with id `habitat_takeover`, switches the habitat to the cold bed**) ·
`impact_glass_hold` · `step_carpet`, `step_wood`, `step_tile`.

**Automatic on level 3** (do not also play): `bullet:impact` on `glass` plays `impact_glass_hold` instead of `impact_glass`;
`player:footstep` picks the floor by room id (carpet: gallery_n lobby admin office stair_w quarters; tile: canteen atrium clinic
bio_lock), any surface except glass/flesh/robot; lock and lift3 keep the metal step. `step_wood` is for story use only.

**Mood**: `play('habitat_takeover')` or `story:beat habitat_takeover` → cold; `story:beat habitat_restore` → warm. Each level-3
room preset has a `cold` form (bed crossfades over ~1.2 s, reverb changes, the room becomes a quiet "dread" room with
`far_steps door_far pipe_tick hull_creak alarm_soft …`; the atrium loses its `pool_lap` events).

**Rooms** (`ROOMS_L3`, only when `levelId === 3`): lift3 dead · lock `lock` IR (steel box) · gallery_n corridor · lobby/admin/quarters
`office` IR (carpet, short) · office dead · stair_w corridor · canteen/clinic/bio_lock `tiled` IR · atrium `atrium` IR (long, airy;
`pool_lap` every 2.5–7 s at the pool).

**Voice fx**: `room` (small desk speaker, 200 Hz–5.5 kHz + early reflections; `room:400` = unintelligible murmur) and `door`
(through a sealed door: 900 Hz two-pole low-pass, 150/330 Hz body, −6 dB).

Dev: `/dev/audio.html?mode=sounds&filter=^(pdoor_|purge_)` (click a spectrogram to hear it), `?mode=hab` (every room × warm/cold),
`?mode=hab&live=1` (real system on level 3), `?mode=voice&ids=<line>&fx=room,room:400,door`.

## Level 4 — BIOLOGICAL SYSTEMS (stage 3b, `sounds/rev9.ts`)

Carbine + armour ids pre-render (`idle`) on level 4 and later (they carry); everything else is `levels: [4]` (one-shots
`late`, loops `lazy`, beds + `decon_hiss` / `body_hit` / `tube_groan` `idle`). All render on demand anywhere.

**Automatic** (do not also play):

| event | sound(s) |
|---|---|
| `weapon:fired` carbine | `carbine_fire` (2D, 3 variants) + `casing_metal`; when no round for 0.11 s, **`carbine_tail`** once — variant by the room's IR: 0 small (dead/padded/office/lock), 1 medium (whiteroom/tiled/corridor/machine), 2 large (hall/shaft/cistern/atrium/clean/tube) |
| `weapon:empty` carbine | `carbine_empty` (not `dry_fire`) |
| `weapon:switched` carbine | `carbine_raise` (not `weapon_switch`) |
| `weapon:reload` carbine | `carbine_mag_out` → `gear_rattle` → `carbine_mag_in`; from empty (clip 0 or duration ≥ 2.45 s) + `carbine_bolt` at 0.78 × duration |
| `player:armor` with `delta > 0` | `vest_on` when delta ≥ 30 (vest +50, at the end of the strap), else `plate_in` (+15). Losses are silent here |
| `player:damaged` with `absorbed > 0` | `armor` left 0 → `armor_break`; else absorbed ≥ 60 % of the hit → `armor_hit`; `hurt_impact` stays, at 0.7 × volume |
| `pickup` | `carbine` → `pickup_weapon`, `ammo_carbine` → `pickup_ammo`; `vest` / `plate` → nothing (the `player:armor` above) |
| `bullet:impact` `flesh` (level 4) | `body_hit` (the dead in tyvek; the enemies are machines) instead of `impact_flesh` |
| `player:footstep` (level 4) | `step_tile` on the clean side (gown shower corr_* wetlab pi_office cold records vivarium scrub store4 gallery bay), `step_grate` in tube / gatel; navy rooms keep the surface's step. Any surface but glass / flesh / robot |
| `story:beat` `l4_lights_out` (level 4) | the clean side's lights-out mood: Deck-2 rooms (not theatre, node2, lock4) switch to their dark preset — bed `amb_hab_cold` (air handling and the cold store stop), dread palette. **Emit it again when restoring a checkpoint past lights-out** (as level 3 does with `habitat_takeover`) |

**Story / level one-shots** (positional, `{ position }`): `decon_hiss` (8.0 s mist from 0 to 8.0 + valve/bleed, 8.8 s; play at the
decon cue) · `shower_jets` (stereo; spin-up 0.5 s, jets to 6.0 s, spin-down to 7.5 s; play at the jets cue) · `hold_beep`
(two tones, 0.47 s; repeat every 2–4 s while a hold panel is amber) · `cold_jam_beep` (actuator twitch + obstruction chirp; with
each `nudge`) · `lights_thunk` (2.6 s contactor wave; with `power_down` at L) · `bay_door` (bolts, 0.85 s travel, stop at 0.9 s) ·
`vent_grille` (push, screws, lands ≈ 0.77 s, rattles; spawn at + 0.4 s) · `clasp_click` (servo, collar closes at 0.14 s; theatre
cue `fit`) · `gel_dip` (cue `regel`) · `valve_pull` (ratchet, lever home at 0.42 s, water moves) · `sump_lift` (two blows from
below, the grille lands at 0.85 s) · `gate_dogs` (8 dogs 0.25–1.45 s, last at 1.85 s, 2.8 s) · `tube_groan` (also the tube's
room-local event) · `body_hit`.

**Loops**: `pump_loop` (stereo, two pump sets, loud: ref 8, rolloff 0.6 — audible across chk; `stop(3)` = the 3 s wind-down) ·
`alarm_beacon` (800/600 Hz two-tone sounder + beacon motor, 2 s period) · `arm_servo_loop` is the level-1 id, unchanged.
Beds via the presets: `amb_clean`, `amb_cold`, `amb_navy`, `amb_plant`, `amb_tube` (+ `amb_lock`, `amb_gen`, `amb_hab_cold` reused).

**Rooms** (`ROOMS_L4`, only when `levelId === 4`; new IRs `whiteroom` — white panels, short and bright — and `tube` — 40 m of
glass, long with a cylinder flutter): lock4/shower/cold/gatel `lock` · gown, corr_*, wetlab, vivarium, scrub, gallery `whiteroom`
· pi_office, records `office` · store4, guard `dead` · node2, bay, chk `machine` · theatre `clean` · stair4 `shaft` · lcorr
`corridor` · plant4 `cistern` (+ drips) · tube `tube` (+ `tube_groan` every 9–22 s). Clean side quiet (dread palette, no husk
whispers except the vivarium); navy palette `hull_creak metal_groan dist_clank pipe_tick dist_knock far_steps drip`.

**Voice fx `screen`** (D17): a monitor's speaker playing a recording = the `recorder` chain (`voicefx.chainOf`, same lead
0.28 s), placed with `POS.screen` = ref 4 m, rolloff 0.7, gain 1.3 (the in-room gain of `clean`, conversation level).

Dev: `/dev/audio.html?mode=l4` (every level-4 room normal / dark with a 3-round burst + tail; `&live=1` runs the real system on
level 4 and lists which ids each event triggers), `?mode=sounds&filter=^(carbine_|armor_|vest_on|plate_in|decon_|shower_|hold_|cold_jam|lights_thunk|bay_door|vent_grille|clasp_|gel_dip|pump_loop|valve_pull|sump_lift|alarm_beacon|gate_dogs|tube_groan|body_hit|amb_(clean|cold|navy|plant|tube))`
(click a spectrogram to hear it), `?mode=voice&ids=l1_hale_recorder&fx=recorder,screen`.

## Level 5 — POST 4 (stage 3c, `sounds/rev10.ts`)

**Owners (plan §8.11, D25 — the owner is who plays it; never play an id another owner plays):**

| who plays | ids |
|---|---|
| level vignettes | `turnstile_click` `counter_tick` `hull_groan_long` `locker_rattle` `locker_bang` `helmet_roll` `radio_on_click` `radio_static_bed` (loop) `pump_thump` `tray_crash` `cutlery_scatter` `fan_start` `fan_loop` (loop) `hook_creak` `water_hammer` `taps_run` `drain_gurgle` `bulb_pop` `glass_tinkle` `sub_ballast_hiss` `sub_hatch_clang` `clamp_cycle` `sub_systems_hum` (loop) `hatch_unlatch` `hatch_open` `lights_out_dock` `alarm_beacon` (loop) `wheel_crank` `hydraulic_release` `keypad_power_on` `sump_lift` `vent_grille` `booth_door_shut` |
| door `d5_gate` (W4's wide-door hook) | `gate_open_heavy` (2.4 s rise + top stop), `gate_close_heavy` (2.4 s descent, slam at 2.45 s, dogs). Audio plays NO `door_open` / `door_close` for `d5_gate`. |
| enemies (W3b) | `soldier_carbine_fire` `soldier_pistol_fire` (at the muzzle), `soldier_aim_click`, `soldier_light_on`, `soldier_reload`, `bullet_whiz` (pistol) / `bullet_crack` (carbine) at the ray's closest point to the head (never occluded), `soldier_hit_vest`, `soldier_fall`, `clasp_fail`, `gear_rattle` |
| UI (W2a) | `keypad_beep` `keypad_err` `keypad_ok` `keypad_dead` (2-D, UI bus) |
| story | `radio_squawk` (static burst before a body squawk) |
| audio itself | `flashlight_die` / `flashlight_dead` (every level), `soldier_step`, `soldier_fire_tail`, `step_wet`, the beds |

**Automatic:**
- `player:flashlight` (every level): `cause: 'empty'` → `flashlight_die` (fizzle, the driver whine falling, the tailcap click),
  `'refused'` → `flashlight_dead` (dry click); `'toggle'` / `'story'` → `flashlight_on` / `_off` as before.
- Soldiers: audio plays nothing on `enemy:woke / alerted / attack / damaged / died` for type `soldier` (the enemies module plays
  his sounds). `enemy:step` (soldier, actors too) → `soldier_step` with the surface by position (variants 0–2 deck, 3–5 grate,
  6–8 wet); `audio.play('soldier_step', { position })` picks the surface the same way. After every soldier burst (rounds of
  one shooter within 2 m, 0.42 s after the last) audio adds `soldier_fire_tail` at the shooter, by the listener's room size.
- Footsteps on level 5: a puddle in `level.regions.wet` → `step_wet`; the spine's grating (over its crawl floors), the sub-bay
  galleries (y > 4) and `lock5` → `step_grate`; `ready5` / `berths5` rubber; `heads5` / `mess5` / `galley5` tile.
- Rooms: every level-5 room id has a preset (`impulses.ts ROOMS_L5`); the crawlway (spine5 / arm5 below their main floor) is
  `crawl5`, the magazine (arm5 below −2 m) `mag5`. Beds `amb_post` (lit Post 4), `amb_berth`, `amb_crawl`, `amb_bay`,
  `amb_dark`. `story:beat l5_dark` (lights_out5; re-emit on restore past it) turns spine5 / sub5 / crawl5 to `amb_dark` — the
  level plays `lights_out_dock` itself.
- `audio.debug.log`: the last 512 `play` / `loop` / `say` calls `{ id, t, pos }` as asked (also audio's own) — the `--scares`
  one-owner audit.

**Voice fx:** `radio` = the headset band + a 40 ms squelch open (`fxLead` 0.04) + key-up click and 0.12 s squelch tail; 2-D at
conversation level, positioned (the body's radio) `POS.radio` ref 2, rolloff 1.0. `radio:1` = CHOIR on the channel (light
layering first). `throat` = light layering → contact-mic body + the radio band bleed at −14 dB / 12 ms; `POS.throat` ref 5.5,
rolloff 1.0, send 0.25, gain 1.3 (measured: −1.1 dB of the in-ear reference at 6.7 m).

Pre-render on level 5: `gate_open_heavy`, `booth_door_shut` with the load set (the load set honours `levels`); combat, beds,
keypad, `turnstile_click`, `counter_tick`, `gate_close_heavy` idle; the other scares late; loops lazy.

Dev: `/dev/audio.html?mode=l5` (every room normal / dark with the tray crash; `&live=1` the event wiring and the play log;
`&voice=1` the three chains and their levels), `?mode=sounds&filter=^(tray_|hull_groan|helmet|locker_rattle|…)` (click a
spectrogram to hear it).

## Level 6 — THE TRUNK (stage 3d, `sounds/rev11.ts`)

**Owners (plan §8.12, D25 — the owner is who plays it; never play an id another owner plays):**

| who plays | ids |
|---|---|
| level vignettes / set pieces (fired by the story) | `tarp_flap` · `phone_howler` (**one call = the three buzzes**: 0.0–0.9, 1.5–2.4, 3.0–3.9 s, ends 4.0 s) · `phone_dead_click` · `line_hiss` (3 s, fades) · `handset_drop` · `ratchet_run` + `drum_rumble` (together, 4.6 s) → `drum_brake` · `ping_close` + `hull_ring` + `dust_sift` (v6_ring) · `far_lock_flood` (11 s: thud at 0, water from 1.2 s) + `lights_dip` · `sea_groan` (8 s) · `castell_turn` (bolt at 0.66 s) · `bj_doors` (stops at 1.3 s) · `fibre_strain` (bj6_strain 0.3 / 0.7) · `fibre_rip` · `crank_turn` (**one turn**, 0.6 s — play per turn) · `mode_clunk` · `pin_draw` · `pump_stroke` (one stroke) · `gauge_tick` · `shear_fire` (§4.8.1 0.05 s) · `tether_whip` (0.25 s; carries the drum's free spin to 1.4 s) · `winch_brake` (**at 1.4 s**) · `splash_big` · `gate_squeal` · existing `lamp_creak` `bulb_pop` `glass_tinkle` `lights_out_dock` `alarm_beacon` `sump_lift` `vent_grille` |
| level machine `ping6` | `ping_far` (20 s rate, at the hull transducer; ref 6) · `ping_near` (4 s rate, at the well; ref 8) |
| enemies (the loader) | `loader_hum` (**loop**, at the trolley) · `loader_travel` (one move ≈ 2.6 s; overlap for long runs) · `loader_track` · `loader_jaws` · `loader_brake` · `loader_impact` · `loader_squeal` · `loader_hoist` · `flood_pop` · `ram_hit` · `ram_burst` · `cowl_open` · `loader_death` (7 s composite: blast, failing drive to 2.3 s, brakes off, ropes 2.3–3.6 s, buffer screech, stops at 6.5 s — the plunge's `splash_big` is separate) · `rope_whip` · `armour_clank` (×0 hits; minInterval 0.3 s) |
| UI (W2a) | `interlock_deny`, `grip_tick` (2-D, UI bus) |
| audio itself | `wade_shallow` / `wade` (player:footstep surface `water`, by `player.wading` < / ≥ 0.35), `wade_enemy` (enemy:step inside `level.water`, ≥ 0.1 m), `impact_water` (bullet:impact surface `water`), `drown_rescue` (player:rescued), the beds |

**Automatic on level 6:** audio plays NOTHING for enemy type `loader` (spawned / woke / alerted / attack / damaged / died /
step). `boss:stage` → the boss music layer (over `combat` only) + stage ≥ 2 = lights_out6 → the chamber's dark beds;
`enemy:died` loader → boss layer off; `story:beat l6_quiet` → music silence + the chamber's quiet beds (re-emit on restore
past it). Footsteps on the shaft and the chamber's galleries (y > −13.5) are `step_grate`.

**Rooms** (`ROOMS_L6`; new IRs `tunnel` — 80 m concrete run, cross flutter — and `chamber` — the 3.5 s steel hall):
lock6 lock · tun6_a / tun6_b tunnel · rep6, he6, vault6 machine · bay6 lock · hold6, stores6 dead · shaft6 shaft · pool6
chamber · sub-rooms `trench6` (vault6 / he6 below −0.7 m) and `under6` (the undercroft). Beds `amb_tunnel`,
`amb_tunnel_dark`, `amb_headend`, `amb_vault`, `amb_trench`, `amb_shaft`, `amb_pool` → `amb_pool_dark` (cold) →
`amb_pool_quiet` (after). Room state precedence: after > cold > normal (`engine.setMood(cold, after)`).

**Music:** `combat` + the boss layer: a low ostinato on combat's 16th grid, entering on the next bar with `mus_boom` —
stage 1 E (8ths), stage 2 F (+16th pickups, octave), stage 3 G (16ths + a high tremolo cluster).

**Voice fx `phone`** (§6.1): sound-powered handset — no squelch, no hiss bed; 350–2,600 Hz, carbon honk, soft clip 2.4,
crackle −32 dB, slight pumping, chain −6 dB; fxLead 0. Positional `POS.phone` ref 0.8, rolloff 1.2, send 0.1 (hanging);
2-D (held) × 2 (+6 dB). **`pa_dock`**: a positional `pa` line on level 6 (or fx `pa_dock`) uses POS ref 12, rolloff 0.6,
send 1.6, gain 1.3. **`radio`** POS ref 2 → 5 (3d coordinator: the body's squawk must guide the player at 6–12 m;
`radio_squawk` ref 2 → 5 likewise).

Dev: `/dev/audio.html?mode=l6` (rooms normal / dark / quiet; `&live=1` the wiring; `&voice=1` phone / pa levels;
`&music=1` the boss layer), `?mode=sounds&filter=^(loader_|ping_|phone_|wade)` (click a spectrogram to hear it).
