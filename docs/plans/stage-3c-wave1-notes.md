# Stage 3c — what wave 1 built that wave 2 must know (as built; wins over the plan where the plan was silent)

## UI (W2a)
- `ui.radio(...)` strip (CSS class `rstrip`); `ui.keypad()` overlay: virtual cursor from mouse deltas, digit/numpad keys,
  Backspace, CLR, Enter; Esc/E close with `null` (ignored for the first 0.2 s); any `player:damaged` or non-`playing` state
  closes it with `null`; a second `keypad()` closes the first; `ctx.debug.keypadInput` is typed key by key then ENT.
- **ST:** set `player.controlsEnabled = false` while the pad is open (the UI does not). The UI plays only `keypad_beep` and
  `keypad_err` on a short ENT; the STORY plays `keypad_ok` / `keypad_dead` / `keypad_err` for its verdict. The `panel?`
  option is unused — the story mirrors the entry on the world panel itself.
- Subtitle speakers `KESSLER` / `RADIO` get the `radio` class; `SOLDIER` / `BREKKE` the CHOIR class with their own label.

## Voices (W9)
- 72 lines in `voice/lines.l5.json`. Kessler: fx `radio`; soldier lines: speaker alias of CHOIR with fx `throat`; CHOIR's
  radio lines carry fx `radio:1`; `l5_choir_names` is the one positional CHOIR line (see its note).
- `l5_kes_6` has `"cut": 4.08` in FILE time; its `lead` is 0.32 s — measured from the end of the lead the cut is 3.76 s
  (same convention as `l4_sunde_9`).
- After ANY `npm run voice`, re-set `manifest.lines.l4_sunde_8.lead = 0.08` (generation recomputes every lead).

## Fx (W6, on `FxSystemEx` = `ctx.fx as FxSystemEx`)
- `tracer(from, to, o?: { color?, speed? })` — pooled, no light. `muzzle(point, dir, o?: { kind?: 'carbine'|'pistol', light?, scale?, smoke? })`
  — one keyed muzzle light level-wide; never use a plain `fx.flash` per round (it strobes).
- **Soldier fire, per round (W3a/W3b/integration):** `fx.muzzle(rig.muzzle, aimDir, { kind })`; on a miss `fx.tracer(muzzle, end)`,
  emit `enemy:fired` with `point: end`, emit `bullet:impact` with the same point (the impact then gets no light). Do not
  call `fx.sparks` directly.
- `wetPatch(box, rooms, o?)` → `{ contains(p), remove() }`, `wetAt(p)` (for wet footsteps), `bulbPop(point)`, `dustFall(point)`,
  `dustSift(box)` (needs a light beam to read), emitters `'stream'` (taps) and `'mist'` (ballast), with `{ bounds, id, rooms }`.
- **D3:** the lock port: `fx.viewport({ id: 'fx5_lock_water', rooms: ['sub5'], cheap: true, state: 'dark', width: 0.6, height: 0.6,
  depth: 5.6, spread: 0.45, seabed: null, cable: null, shapes: 0, floods: [] })` behind a glass pane.
- `check:fxleak` now requires every view point to stand inside a room; register every volume with `id`, `rooms`, `seenFrom`.

## Audio (W2b)
- **Soldier:** audio plays NOTHING on soldier woke/alerted/attack/damaged/died. W3b calls `audio.play` for
  `soldier_carbine_fire` / `soldier_pistol_fire` (AT THE MUZZLE position — the burst tail `soldier_fire_tail` is added by audio
  and follows it), `soldier_aim_click`, `soldier_light_on`, `soldier_reload`, `bullet_whiz` / `bullet_crack`,
  `soldier_hit_vest`, `soldier_fall`, `clasp_fail`, gear rattle. Steps: emit `enemy:step` only — audio plays `soldier_step`
  itself and picks deck / grate / wet from the position; never also play it.
- **Level (W4 / dressing):** `d5_gate` plays `gate_open_heavy` / `gate_close_heavy` itself (audio does not auto-play door
  sounds for it). Put puddle boxes into `level.regions.wet` (flat boxes) or wet footsteps never trigger. `lights_out_dock`
  belongs to the level's `lights_out5` vignette.
- **ST:** emit `story:beat 'l5_dark'` at lights-out and again when restoring past it. The body radio is −12.5 dB at 6 m (the
  plan's profile) — check it guides the player to the corpse (`check-voice-level --level 5`).
- Scare sound ids (each has ONE owner — the vignette that fires it): `tray_crash`, `pump_thump`, `cutlery_scatter`,
  `hull_groan_long`, `locker_rattle`, `helmet_roll`, `water_hammer`, `taps_run`, `drain_gurgle`, `bulb_pop`, `glass_tinkle`,
  `turnstile_click`, `counter_tick`, `sub_ballast_hiss`, `sub_hatch_clang`, `clamp_cycle`, `sub_systems_hum`, `fan_start`,
  `fan_loop`, `hook_creak`, `radio_on_click`, `radio_static_bed`. Others: `wheel_crank`, `hydraulic_release`,
  `hatch_unlatch`, `hatch_open`, `keypad_power_on`, `keypad_*`, `radio_squawk`. Test hook: `audio.debug.log`.
- Voice fx: `radio` (lead 0.04 s), `radio:1`, `throat` (ref 5.5 m, −1.1 dB at 6.7 m).

## Materials and screens (W5)
- Materials: `hull_white`, `deck_grate` (alpha-tested, double-sided), `wet_steel` (transparent puddle overlay: UVs in metres,
  ~2 × 2 m patches, 3–5 mm above the deck; `fx.wetPatch` uses it), `fatigue_navy`, `knit_black`, `helmet_navy`, `webbing`,
  `rubber_mat`, plus `sub_coating`, `lino_navy`, `blanket_wool`, `hazard_deck`.
- Wet floors read as wet only where the reflection probe has something bright to mirror — place lamps/lit surfaces so the
  puddles catch them. Under a 3 cd red emergency light the dark floors go near-black away from the lamp: emergency lamp
  placement is the dressing tasks' job (and the flashlight lasts 10 s). Grating at a grazing angle with nothing lit beneath
  reads as sparse lines — put something lit under it (the crawlway's red light).
- Screens (`src/materials/screens5.ts`, formats in its header): `keypad` (`off | ready | typing|n | rejected | accepted | open`;
  `rejected` returns to ENTER CODE after 1.2 s), `launch` (`idle | running[|seconds] | complete`), `dock_status` (lines
  split by `\n`; one line = a big wall board; a value ending `2d 14h 30m` counts up by itself), `onpost` (a new number rolls
  in over 0.4 s). Palm plates: label `TITLE — rest`. Legible at: ON POST 1.2 × 0.6 m at 6 m; duty board 3 × 1.2 m at 7 m;
  keypad 0.16 m wide at 0.9 m; launch console 0.6 m at 1 m; TERN board 4 × 1 m at 20 m; `aas_palm` 0.3 m at 1.8 m;
  `gate_log` needs ≥ 0.55 m width or reading from ≤ 1.8 m.
- Sign style `navy` exists (white stencil on a dark backing; a line like `2-34-0-L` is drawn as a boxed hull number).
  Level-5 door lintels should use it (W4/IB: `level/doors.ts` draws lintels with `stencil` today).
- On level 5 `terminal_idle` uses a navy log (no stock CHOIR lines).

## Tests (T) — the hook contract is the comment block at the top of `scripts/playthrough-l5.mjs`
- **ST implements exactly that list** (H1–H14 on `window.__game.story`), incl. the readings the test assumes: `t` holds the
  first script time of every beat, `phase:<id>` (A B B2 C D0 D K S S_dive V V_lock W W_lock X) and `vignette:<id>`;
  `scene.times` maps each cue (S1, S2, T1…T10, H) to seconds since the camera was taken, `scene.h = times.H`, `scene.result`
  is `null | 'played' | 'skipped'`; `door.facing`: `away` = within ±50° of −x, `door` = within ±90° of +x, else `side`;
  `keypad.wrong` is a number; `fire(unknown)` returns null; the story reads the player's yaw for the neck check.
- **NEW for the level (W4 / D1):** `level.object('mk5_glass').userData.panes = { id, p: [x, y, z] }[]` with ids `booth`,
  `port`, `lock_port`.
- Run `node scripts/playthrough-l5.mjs <url> --contract` first (lists everything missing, grouped by owner), then the default
  mode. `node scripts/check-dark.mjs --url <url> --level 5` judges lamp-on, lamp-off (frame ≥ 0.025, edge strips ≥ 3 %,
  doors / stair nosings / gallery edges / required interactables at p95 ≥ 0.10), enemy glow at 10/20/30 m (the soldier's
  mark red, never cyan) and a dark run of the route sampled every 2 m.

## Set pieces (W7, `src/level/l5/setpieces.ts`; every function's doc comment gives size, origin, facing, colliders, calls, API)
- `tern(L, o)` → object + machine `tern`: boat (bow faces −z, toward the lock; hull z −27…−43), cradle with ten clamp arms,
  rails. `userData`: `check()` (19.4 s; cues `TERN_CUES`: power, lights, floods, ballast, ballast_end, dog, hatch_open, clang,
  thrusters, clamps, clamps_home, hatch_shut, latch, complete), `snap()`, `setTime(t)`, `onCue(cb)`, `clamps(k)`, `hatch(k)`,
  `dog(k)`; points `vents` (8 points + directions: **D3 places `emitter('mist', …)` there**), `drips`, `soundPoints` (the doc
  maps each cue to its sound — the vignette `v5_sub_check` plays them; no set piece plays a sound). The boat's own two lights
  are in light group `tern`, NOT `sub5`: `lights_out5` leaves them on. 11 draw calls + 1 cradle.
- `launchLockDoor(L, b)` (5 m round door, 0.6 m port, `userData.pane`), `cmdDoor(L, b)` (`look(on)`,
  `tally('red'|'amber'|'white'|'off')`, `watch(p)`, `pulse(on)`, `lineGlow(k)`; the yellow line at x 42.5), `gateLook(L, 'd5_gate')`
  (dog ring; `d5_gate_dogs.userData.set(k)`), `hatchLid(L, b, HATCH5_SPINE | HATCH5_MAG)` (south hinge; one dynamic box;
  `open(k)`, `dogs(k)`, `lamp()`; registers `hatch5_spine` / `hatch5_mag` — **if the greybox made lids under the same names,
  keep ONE**), `wheel5(L, b)` (`spin(t)` over 4 s), `launchConsole(L, b)` (screens `launch`, `launch5_palm`;
  `userData.palmPoint`), `boothBackDoor(L, b)` (`set(k)`, `settle(1.2, onLatch)`).
- `mk5_launch` is the console's back edge; the operator looks north over it at the sail.
- For integration (look): the boat uses private hull paint — swap in `sub_coating` keeping its self-light shader patch.
