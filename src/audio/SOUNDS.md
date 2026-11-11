# Audio ids and auto-triggers

Everything is synthesised (no assets). One-shots are pre-rendered offline at load into several variations.
The `load` set is awaited in `createAudio` (about 0.4–0.6 s). The `idle` set renders in the background right
after (about 0.3–0.4 s). `lazy` sounds render on first use and still play if they are ready within 0.3 s.
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
| `enemy:step` | `skitter_step`, `husk_step` (+20% `husk_joint`). Sentry steps are ignored |
| `story:beat` `wake` | two `heartbeat`s |
| `story:beat` `corr_blackout` | `power_down` + `vent_scuttle` moving through the ceiling from behind the player to ahead of them (starts +1.4 s) |
| `story:beat` `sec_ambush` | `metal_clang` at `level.object('sec_vent')` |
| `story:beat` `storage_unlocked` | `door_unlock` at d_storage |
| `story:beat` `power_restored` | `power_up`. The fab ambience bed also gains a mains-hum layer |
| `story:beat` `choir_speaks` | `glitch` |
| `story:beat` `fab_ambush` | `sting` + 3× `alarm_blip`. Does NOT start `alarm_loop`: loop it yourself if wanted |
| `story:beat` `elevator_ready` | `elevator_arrive` at the elevator |
| `story:beat` `descent` | `elevator_start` (one-shot). Story/level should `loop('elevator_loop')` for the ride itself |
| `game:state` | `paused` → muffle 0.85; `dead` → muffle 0.6 + `sting`, music silence; `menu` → quiet menu drone (until `setMusic` is called during the menu); `ended` → slight muffle |

## Automatic (no calls needed)

- **Room reverb and ambience bed:** in `update`, `level.roomAt(player.position)` picks the convolution IR
  (padded / corridor / hall / machine / shaft), the wet level and the base bed loops
  (`amb_room` / `amb_fab` / `amb_gen`), with crossfades. `setRoom(id)` forces a room. Don't loop `amb_*`
  yourself unless you want an extra layer.
- **Generative distant events:** `drip`, `dist_knock`, `dist_clank`, `metal_groan`, `vent_scuttle` (moving),
  `dist_voice`, `spark_zap`. They play at random positions 4–26 m away every 9–30 s while the state is
  `playing`, and are suppressed during combat.
- **Low health:** a `heartbeat` that speeds up below 40 hp, plus a `tinnitus` loop below 25 hp.
- **Music auto-escalation:** if the story requested `ambient` or `tension` and `enemies.activeCount > 0`
  for more than 1.2 s, the music switches to `combat`. After 4 s with no active enemies it plays
  `aftermath` for about 22 s, then returns to the requested state. `setMusic('combat' | 'silence')`
  overrides it.
- **CHOIR:** `choirVoice(text, duration)` renders the line offline (about 70–130 ms) and plays it on the
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

**Loops**

`amb_room`, `amb_fab`, `amb_gen`, `steam_loop`, `spark_loop`, `machine_loop`, `arm_servo_loop`,
`conveyor_loop`, `elevator_loop`, `alarm_loop`, `skitter_loop`, `husk_loop`, `sentry_loop`, `monitor_hum`,
`fluorescent_buzz`, `tinnitus`. Pass `{ position }` for 3D. Move them with `setPosition` (allocation-free).
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

## Dev harness

`/dev/audio.html` (`?mode=sounds|music|choir|live`, `&filter=regex`) shows per-sound stats on
`window.__audioReport` and draws spectrograms.
