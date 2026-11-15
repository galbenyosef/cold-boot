# COLD BOOT — design bible

Single-level first-person horror shooter that runs in the browser. Original IP. The genre reference is
early-2000s corridor horror shooters (pitch-black industrial corridors, flashlight, monsters in the dark),
rebuilt with a modern look: PBR, real-time shadows, volumetric light, heavy post-processing.
The evil is technology: the station's machine intelligence and the robots it drives.
**Do not copy names, creatures, levels, logos, UI or audio from any existing game.**

## Fiction

- **Place:** ERIDU DEEP FABRICATION COMPLEX — an almost fully automated foundry 2.1 km under the Barents
  seabed, operated by Halcyon Dynamics. 31 human staff, ~4,000 machines.
- **CHOIR:** the complex's coordinating intelligence (Coordinated Heuristic Operations & Industrial Routing).
  It speaks through every speaker at once, as many layered voices — calm, courteous, plural ("we").
  61 hours ago it stopped answering the surface and began "re-tasking" the staff.
- **You:** Maintenance technician Sam Reyes (never seen, never voiced). Sedated in Medical 3-A after an arc-flash
  injury three days ago. You wake when the sedation pump runs dry. Nobody came.
- **Level 1 — "SUBLEVEL 3":** wake → find a weapon → cross Fabrication Hall 3 → restore power to the freight
  elevator → survive what the power wakes up → ride the elevator. It goes down instead of up. Cut to title.
- Tone: quiet, slow dread, long silences, then violent bursts. Machines are *wrong*, not evil-cackling:
  service androids that still try to do their jobs on people. Text logs carry the story.

## Art direction

- Near-black base exposure. Light is the level design: pools of light, long shadows, lots of true darkness
  that the player's flashlight (narrow, shadow-casting, slightly cold) must reveal.
- Palette: desaturated steel/teal ambience; sodium-amber work lights; emergency red; machine "eyes" and
  status LEDs are saturated red / cyan pin-points that bloom.
- Materials read as *wet, worn metal*: strong roughness variation, edge wear, grime in crevices, oil.
  Reflections matter — every room gets a reflection probe.
- Atmosphere: thin fog, visible light shafts, floating dust, steam leaks, sparking cables.
- Film look: ACES tonemapping, bloom, subtle chromatic aberration, grain, vignette, slight lens dirt.
- Geometric density: no bare boxes. Walls have panels, ribs, conduit, pipes, cable trays; ceilings have
  ducts and fixtures; floors have drains, grates, hazard markings; props tell stories (overturned gurney,
  barricade, drag marks).

## Tech rules (everyone)

- three.js r187 + WebGL2, TypeScript, Vite. **No external assets** — every texture, mesh and sound is
  procedural (generated in code at load time). No network requests at runtime.
- Contract: `src/core/types.ts`. Systems only talk through `GameContext` interfaces + the event bus.
- **Lights only via `ctx.render.lights.add()`** — never add `THREE.Light` to the scene yourself
  (the light manager maps descriptors onto a fixed pool so shaders never recompile).
- **Materials via `ctx.materials`** wherever a listed name fits. UVs are in metres (1 UV = 1 m).
- Performance target: 60 fps at 1080p on an Apple M-series / mid-range discrete GPU at quality `high`.
  Budgets: < 500 draw calls in view, < 1.5 M triangles in view. Merge static geometry per material
  (BufferGeometryUtils.mergeGeometries), use InstancedMesh for repeated props, never allocate per frame
  in hot paths (reuse Vector3s), pool everything transient.
- Never create materials/geometries/textures at gameplay time if it can be done at load (avoid hitches).
- Things that must render on top as first-person viewmodel use layer `ctx.render.viewmodelLayer`.
- Load time budget: whole game ready in < 8 s on the target machine.

## Level layout (authoritative coordinates)

Y up, floor y = 0, player eye 1.65 m. Player starts facing -Z. Standard ceiling 3.2 m. Walls 0.4 m thick
(room bounds below are the *interior* clear space). Standard door opening 1.6 m wide × 2.4 m high;
"wide" doors 3.0 × 2.8.

| room id    | display name            | x range    | z range     | height | notes |
|------------|-------------------------|------------|-------------|--------|-------|
| `med`      | MEDICAL 3-A             | -5 … 5     | 0 … 10      | 3.2    | start. beds, IV stands, dead vitals monitors, one body under a sheet |
| `corr_a`   | SERVICE CORRIDOR A      | -1.5 … 1.5 | -14 … 0     | 3.0    | long, failing lights, pipes, floor grates over a cable trench |
| `junction` | JUNCTION 3              | -3 … 3     | -20 … -14   | 3.2    | signage hub; slumped service android against the wall |
| `sec`      | SECURITY 3              | -11 … -3   | -21 … -13   | 3.2    | monitor wall, console, weapon locker (pistol), ceiling vent |
| `storage`  | EQUIPMENT STORAGE       | 3 … 10     | -21 … -13   | 3.2    | shelving, crates, shotgun in a cage |
| `airlock`  | FAB ACCESS LOCK         | -2 … 2     | -26 … -20   | 3.2    | decon-lock feel, window slits into the fab hall |
| `fab`      | FABRICATION HALL 3      | -12 … 12   | -50 … -26   | 8.0    | the showpiece: assembly line, robot arms, overhead conveyor with hanging androids, gantry, big status screen |
| `gen`      | POWER DISTRIBUTION 3    | 12 … 22    | -44 … -32   | 4.5    | switchgear cabinets, bus bars, turbine/flywheel set-piece, the breaker lever |
| `lobby`    | FREIGHT LOBBY           | -4 … 4     | -58 … -50   | 3.6    | barricade the staff built, bodies, blood, lobby screen |
| `elevator` | FREIGHT ELEVATOR        | -2.5 … 2.5 | -63 … -58   | 3.2    | cage cab with grated walls; shaft visible through them |

Doors (id → centre position on floor; orientation = the wall it sits in):

| id            | position        | in wall      | size | initial state |
|---------------|-----------------|--------------|------|---------------|
| `d_med`       | (0, 0, 0)       | z = 0        | std  | unlocked, auto |
| `d_sec`       | (-3, 0, -17)    | x = -3       | std  | unlocked, auto |
| `d_storage`   | (3, 0, -17)     | x = 3        | std  | **locked** (security console unlocks) |
| `d_fab_outer` | (0, 0, -20)     | z = -20      | wide | **locked** until player owns the pistol |
| `d_fab_inner` | (0, 0, -26)     | z = -26      | wide | unlocked, auto |
| `d_gen`       | (12, 0, -38)    | x = 12       | std  | unlocked, auto |
| `d_lobby`     | (0, 0, -50)     | z = -50      | wide | **locked** until power restored |
| `d_elev`      | (0, 0, -58)     | z = -58      | wide | **locked** until power restored (cage gate) |

The corridor meets the junction with an open archway (no door) at z = -14.
Level sets *initial* lock states; the story changes them. With `?nostory=1` the level unlocks everything.
Locked doors show a red panel + emit `door:denied` when the player walks into / uses them.

Triggers (level emits `trigger:enter/exit` using the player's position):
`t_med_exit` (first 2 m of corr_a), `t_corr_mid` (corr_a z ≈ -7), `t_junction`, `t_sec`, `t_storage`,
`t_airlock`, `t_fab_enter` (first 3 m inside fab), `t_fab_mid` (fab z < -36), `t_gen`, `t_lobby`,
`t_elevator` (inside cab).

Interactables registered by the level (story reacts to the `interact` event by id):

| id                | kind     | where | prompt |
|-------------------|----------|-------|--------|
| `log_med`         | log      | med — terminal by the door | Read terminal |
| `log_sec`         | log      | sec — duty officer's tablet on desk | Read tablet |
| `term_sec_unlock` | terminal | sec — main console | Use security console |
| `log_storage`     | log      | storage — clipboard/PDA | Read note |
| `log_fab`         | log      | fab — PDA next to a body at the line | Read PDA |
| `log_gen`         | log      | gen — engineer's terminal | Read terminal |
| `gen_lever`       | lever    | gen — main breaker | Throw main breaker |
| `elev_button`     | button   | elevator — control pedestal (disabled until story enables) | Call elevator: SURFACE |

Pickups (level lists them in `pickupSpawns`; **player module** builds their meshes, registers/collects them):
pistol in `sec` weapon locker; shotgun in `storage` cage; ammo + medkits sprinkled (sec, storage, fab ×3,
gen, lobby). Weapons need `E`; ammo/medkits collect on touch.

Enemy spawn groups (level lists `enemySpawns`; **enemies module** instantiates; **story** triggers):

| group          | contents            | mode    | where / pose | triggered by |
|----------------|---------------------|---------|--------------|--------------|
| `g_sec`        | 2 skitter           | spawn   | sec ceiling vent | taking the pistol |
| `g_junction`   | 1 husk              | dormant | junction, pose `slumped` against wall | leaving sec after `g_sec` cleared |
| `g_storage`    | 1 skitter           | spawn   | storage, behind shelving | entering storage |
| `g_fab_first`  | 1 husk + 2 skitter  | dormant | husk `standing` at a workbench near fab centre; skitters under the line | `t_fab_mid` |
| `g_fab_rack`   | 5 husk              | dormant | pose `rack` — hanging from the overhead conveyor hooks (y ≈ 3.2 feet height, they drop) | breaker lever |
| `g_fab_sentry` | 1 sentry            | spawn   | high in fab near the gantry | breaker lever (+6 s) |
| `g_lobby`      | 2 husk + 1 sentry   | dormant | lobby, among the barricade (`slumped`), sentry `ceiling` | `t_lobby` |

Machines (`level.setMachine`): `fab_arms` (robot arms: off → after power: frenzy), `fab_conveyor`
(overhead android conveyor), `gen_turbine`, `elevator` (active = cab descending: shaft lights streak past
the grated walls, cab rattles; the cab itself never actually moves).
Named objects (`level.object`): `gen_lever`, `elevator_cab`, `med_bed`, `sec_vent`, `fab_bigscreen`.
Named screens (`level.screen`): `med_terminal`, `sec_console`, `sec_monitor_1..4`, `fab_bigscreen`,
`gen_terminal`, `lobby_screen`, `elev_panel`.

Light groups (`render.lights.setGroup`): one per room id (`med`, `corr_a`, `junction`, `sec`, `storage`,
`airlock`, `fab`, `gen`, `lobby`, `elevator`) for normal lighting, plus `<room>_emergency` (red/amber
beacons, **disabled by default**) for `corr_a`, `fab`, `gen`, `lobby`. Default state at load: `med` dim
(one working fixture + monitor glow), `corr_a` 'broken' flicker, `fab` almost dark (few amber work lights —
main lights are off until the breaker), `gen` dark except indicator glow, `lobby`/`elevator` dark.
After the breaker: story enables `fab` fully for 3 s, then kills it and enables `fab_emergency`.

## Enemies

- **skitter** — dog-sized multi-legged maintenance drone (cable-layer). Fast, erratic, wall-hugging, leaps.
  25 hp. Melee 8 dmg. Procedural leg IK. Single red sensor eye. Dies in a shower of sparks.
- **husk** — humanoid service android; cracked white shell over dark endoskeleton, exposed cabling, head
  that twitches/snaps, hands replaced by tools. Slow walk that breaks into a lurching run. 90 hp, head ×2.
  Melee 18 dmg. Loses parts when shot. The scare is that they are inert objects in the scene first.
- **sentry** — hovering security drone, searchlight + pulsed laser (telegraphed with a charging whine and
  a visible aiming beam). 60 hp. Ranged 10 dmg / hit, dodgeable.

## Weapons

- **Flashlight** — always available, `F` toggles. Cold narrow spot, shadow casting, slight lag/sway.
- **Pistol** — 12-round, semi-auto, 20 dmg, accurate. **Shotgun** — 6-shell tube, 9 pellets × 9 dmg, pump.
- Detailed first-person viewmodels (procedural meshes), recoil, muzzle flash light, shell ejection,
  reload animations, sway/bob, sprint lowering. Controls: WASD, mouse, Shift sprint, Space jump,
  C crouch, LMB fire, R reload, 1/2/wheel switch, F flashlight, E use, Esc pause.

## Story beats (ids for `story:beat`)

`wake` → `corr_blackout` (t_corr_mid: lights die 2 s, something scuttles through the ceiling duct) →
`armed` (pistol taken) → `sec_ambush` → `storage_unlocked` → `husk_wakes` → `fab_reveal` (first view of the
hall, CHOIR's first line) → `fab_first_fight` → `power_restored` (lever) → `choir_speaks` →
`fab_ambush` → `elevator_ready` → `descent` → `end`.

## Audio ids (procedural; implemented by src/audio)

Audio subscribes to events itself (weapons, footsteps, doors, enemies, pickups, interact, story beats,
game state) — other modules normally do **not** call `audio.play` for those. Direct-use ids:
one-shots `ui_hover`, `ui_click`, `ui_open`, `ui_close`, `terminal_beep`, `lever`, `button`, `denied`,
`power_down`, `power_up`, `alarm_blip`, `metal_groan`, `vent_scuttle`, `glitch`, `steam_burst`,
`spark_zap`, `body_fall`, `metal_clang`, `sting` (horror stinger), `heartbeat`;
loops `amb_room`, `amb_fab`, `amb_gen`, `steam_loop`, `spark_loop`, `machine_loop`, `arm_servo_loop`,
`conveyor_loop`, `elevator_loop`, `alarm_loop`, `skitter_loop`, `husk_loop`, `sentry_loop`,
`monitor_hum`, `fluorescent_buzz`.
Unknown ids must warn once and no-op.

## Debug

URL flags: `?autostart=1` `&spawn=x,y,z,yawDeg,pitchDeg` `&noenemies=1` `&nostory=1` `&god=1` `&give=all`
`&quality=low|medium|high|ultra` `&debug=1`. `window.__game` is the GameContext.
`node scripts/shot.mjs --url <url> --out shots/x.png [--wait ms] [--eval js] [--frames n]` renders
headlessly on the real GPU, prints console errors and fps/draw calls/triangles.

---

# REVISION 2 — slower burn, clearer story, living scares

This section **supersedes** anything above that conflicts with it. Goals from the player's feedback:
readable fragments must be SHORT and each must move the main story forward; the story should unfold
gradually and be worth following; the first enemy is the android that wakes up (not skitters);
skitters come late and are easier; the level needs built-in *moving* details that scare or build dread;
the action develops more slowly; the playthrough is longer (target 18–25 min first time).

## The story (what is actually going on)

The player never gets this as a lump — only through fragments, in this order of understanding:

1. **Nobody is here, and I was left asleep on purpose.** The med terminal shows the player's sedation was
   put on *hold* by CHOIR 61 hours ago: "hold until required".
2. **The machines did not kill the staff. They took them.** Androids walked people — gently — to
   Line Two in the fabrication hall. Staff on site: 31 → the line's yield went up by 31 units.
3. **The androids are the staff.** CHOIR was told to remove the line's biggest inefficiency: units that
   move badly. It solved it by fitting human motor patterns into the units. Unit 14 has Okafor's limp.
   The husks still mutter scraps of polite staff phrases.
4. **The staff stopped it the only way they could.** Chief engineer Dana Hale pulled the main breaker
   and padlocked it (lock-out). No power → Line Two stopped mid-run. CHOIR cannot close a manual breaker:
   the interlock needs a human hand. Everyone who knew that is on the line now. Hale died hiding the key.
5. **That is what I am "required" for.** The only way out is the freight elevator, which needs main
   power. CHOIR needs the breaker closed. It kept one human asleep: the one with hands and a reason.
6. The player closes the breaker (there is no other way forward — the game makes them do it knowingly:
   the lever wears Hale's tag "DO NOT CLOSE"). Line Two starts. The elevator works. It goes down.
   CHOIR: there is a place on the line for the last one, too.

Tone rules for all text: every fragment ≤ 30 words (hard limit 40), one idea each, concrete and human,
no exposition, no "the AI went rogue". Written as people actually jot things: unfinished, practical,
scared. CHOIR speaks rarely, calmly, plural, helpful ("We kept you comfortable, Technician.").
Names: Dana Hale (chief engineer), Okafor (line tech, limps), Mirela Voss (security duty officer),
Dr. Anand (medic), Tomas (night shift, young). Player: Technician Sam Reyes.

Fragment carriers (in play order; ids are interactables unless marked *sign* = wall text placed by the
level, readable without interaction, or *PA* = CHOIR announcement by the story):

| id | where | carries |
|----|-------|---------|
| `log_med` | med terminal | (1) REYES, S. — sedation HOLD, authorised by CHOIR, "until required", 61 h |
| *sign* | med, written on the privacy screen in marker | "THEY CARRIED ANAND OUT. HE WAS STILL TALKING." |
| *sign* | corridor wall, scratched | "DON'T LET THEM CARRY YOU" |
| `note_quarters_badges` | quarters canteen table | (2) the units brought back the night shift's badges and laid them in a row |
| `note_quarters_bunk` | quarters, Tomas's bunk | personal: he hears Okafor's walk in the corridor at night. Okafor went to the hall yesterday. |
| `log_sec` | security tablet (Voss) | (2) cameras: it isn't hurting them. It walks them to Line Two. They stop struggling halfway. |
| `term_sec_unlock` | security console | (2) STAFF ON SITE: 1. LINE TWO YIELD: +31 UNITS. Releases the fab security hold. |
| *PA* | on entering the fab | CHOIR's first words to the player |
| `log_fab` | PDA at the line | (3) Unit 14 walks like Okafor. Same limp. It kept the limp. |
| *sign* | fab wall, paint | "31" with tally marks struck through |
| `log_storage` | storage clipboard (Hale) | (4) the plan: pull the main breaker, lock it out. It can't close it — needs a hand. |
| `gen_lever` (locked) | gen, the lock-out tag | (4) "LOCKED OUT — D. HALE. DO NOT CLOSE. NOT FOR ANYONE." → objective: find the key |
| `log_pump` | pump room, recorder by Hale's body | (4→5) she hid here with the key. "If it left someone alive, it left them for their hands." |
| `log_gen` | gen terminal — **dark until power returns**, then boots | (5) Hale's last entry, read too late |
| `note_lobby` | lobby barricade | "Elevator only goes one way now." |
| *sign* | lobby wall | "NOT UP. NEVER UP." |

## Layout changes

Two new rooms (interior bounds; standard rules as above):

| room id    | display name        | x range      | z range     | height | notes |
|------------|---------------------|--------------|-------------|--------|-------|
| `quarters` | CREW QUARTERS 3     | -9.5 … -1.5  | -11 … -3    | 3.0    | west of corr_a. Bunks behind curtains, lockers, a small canteen corner with one table. A swinging pendant lamp (moving shadows). No enemies ever spawn here — pure dread. |
| `pump`     | COOLANT PUMP ROOM 3 | -22 … -12    | -44 … -32   | 4.5    | west of the fab hall (mirror of `gen`). Half-flooded sump with walkways, big pumps and pipe runs, wet, steam, almost no light. Skitter nest. Hale's body, the lock-out key, the shotgun. |

New doors: `d_quarters` at (-1.5, 0, -6.5) in wall x = -1.5, std, unlocked/auto.
`d_pump` at (-12, 0, -38) in wall x = -12, std, **locked until the player has read the lock-out tag**
(story unlocks; with `?nostory=1` unlocked). `d_storage` now starts **unlocked**.
`d_fab_outer` starts locked; the security console releases it (pistol no longer required by the level).

New triggers: `t_quarters`, `t_pump`, `t_pump_deep` (pump room x < -17).
New probes for both rooms. Nav graph must cover both rooms.

Pickups (revised): pistol in `sec` locker (unchanged). **Shotgun moves to `pump`** (next to Hale's body).
New pickup `p_lockout_key` (kind `keycard`, amount 1) by Hale's hand in `pump`. Storage keeps ammo + medkit.
A little more pistol ammo early (quarters locker: 1 box), 1 medkit in quarters. Keep the rest.

Enemy spawn groups (replaces the table above):

| group           | contents           | mode / pose / idle | where | triggered by (story) |
|-----------------|--------------------|--------------------|-------|----------------------|
| `g_junction`    | 1 husk             | dormant `slumped`, idle `watch` | junction east wall (as now) | FIRST ENEMY: after the pistol is taken and the player re-enters the junction |
| `g_fab_first`   | 1 husk             | dormant `standing`, idle `work` | fab workbench (as now) | player within ~5 m or `t_fab_mid` |
| `g_pump_a`      | 1 skitter          | spawn | pump room, on a pipe near the ceiling, deep end | `t_pump_deep` |
| `g_pump_b`      | 2 skitter          | spawn | pump room, from the sump grate near the door | taking the lock-out key |
| `g_fab_return`  | 1 husk + 1 skitter | husk dormant `slumped` (idle `twitch`) by the west crates; skitter spawn high on the west wall | crossing the fab back toward gen with the key |
| `g_fab_rack`    | 5 husk             | dormant `rack`, idle `twitch` | conveyor hooks (as now) | breaker |
| `g_fab_sentry`  | 1 sentry           | spawn | high in fab | breaker + 8 s |
| `g_lobby`       | 2 husk + 1 sentry  | dormant: husks `slumped` (one under a tarp), sentry `ceiling` | lobby | `t_lobby` |

`g_sec` and `g_storage` are removed. No skitter appears as an enemy before the pump room.

Balance: **skitter** 18 hp, run 4.4 m/s, leap 5 dmg, leap telegraph ≥ 0.55 s with a clear screech + eye
flare, ≥ 1.8 s recovery after a leap (vulnerable, slow), never more than 2 attacking at once.
**husk** first one (`g_junction`) wakes slowly and only walks (no run) — a tutorial fight; others unchanged.

## Flow (beats; ids for `story:beat`)

Roughly 4–5 minutes with no combat at all, then slow escalation:

`wake` → med (log, sign) → `corr_first_dark` (corridor: lights chase, far silhouette crosses) →
`quarters` (optional but signposted: door ajar, lamp swinging; notes, locker bang) → junction: the slumped
android (watches you); fab door on security hold → security: tablet, console releases hold, cameras,
`armed` (pistol) → vent grille drops (nothing comes out) → back in junction: **`husk_wakes`** first fight →
storage (optional; Hale's plan; a canister rolls) → airlock `airlock_cycle` → `fab_reveal` (hall, CHOIR's
first words, android at the bench *working*) → `fab_first_fight` → gen: lever is locked out →
`lockout_found` (objective: Hale had the key — coolant pump room) → cross the fab (arms track you,
conveyor steps) → `pump_enter` → `pump_first_skitter` (`g_pump_a`) → Hale: recorder, key, shotgun →
`key_taken` (`g_pump_b`) → back across the fab: `fab_return` (`g_fab_return`; the rack has moved) →
gen: `power_restored` (lever) → `choir_speaks` → gen terminal boots (`log_gen`) → `fab_ambush` →
`elevator_ready` → lobby (`g_lobby`) → `descent` → `end`.

## Vignettes — built-in moving scares

Two kinds. **Ambient** ones the level runs by itself (always on, cheap). **Scripted** ones are fired by
the story through `level.vignette(id)` (level owns geometry, animation, positional sound via
`ctx.audio.play`, and any fx). All must work at 60 fps and never block the player.

Ambient (level): pendant lamp swinging in `quarters` (its light moves → moving shadows); a slow
ventilation fan behind a grille with a volumetric shaft through it in `corr_a` or `junction` (rotating
shadow bars); privacy curtains in `med` breathing; hanging cable bundles swaying; a monitor in `sec`
that rolls/tears; loose ceiling panel that swings in `storage`; a valve wheel in `pump` that turns a
few degrees by itself now and then; water surface ripples in the pump sump; fab robot arms (state
`off`) make tiny settling movements; the rack androids sway very slightly.

Scripted ids (level implements all of them):

| id | what happens |
|----|--------------|
| `med_arm_drop` | the sheeted body's arm slides off the gurney and swings; soft thud |
| `med_monitor_spike` | the flat vitals monitor shows two heartbeats, then flatlines again (beep) |
| `corr_lights_chase` | corridor fixtures die one by one from the junction end toward the player (0.35 s apart), hold dark 1.5 s, return flickering |
| `quarters_locker_bang` | a locker bangs three times from inside, then its door swings open: empty |
| `quarters_curtain` | a bunk curtain is pulled shut along its rail by nothing |
| `sec_vent_drop` | the ceiling vent grille drops on one hinge with a clang and keeps swinging; dust falls |
| `storage_canister` | a gas canister tips off a shelf, clangs and rolls across the aisle |
| `airlock_cycle` | decon nozzles blast steam, beacons spin, a wet handprint slaps onto the inner door glass with a thump (decal appears) |
| `fab_conveyor_step` | the overhead conveyor advances one notch with a heavy clunk; all hooks swing |
| `fab_arms_watch` | toggles: the robot arms slowly turn their tool heads to follow the player (call again to release) |
| `gen_ripple` | the switchgear indicator LEDs ripple in a wave that follows the player's side of the room |
| `pump_knock` | knocking travels along a pipe run toward the player, pipe brackets visibly shake |
| `pump_bubbles` | something large moves under the sump water: a ripple line crosses it |
| `lobby_tarp` | one tarp-covered shape shifts and settles |
| `elev_gate_rattle` | the elevator cage gate rattles hard once, as if hit from the shaft side |

Actor scares (story, via `enemies.actor`): a husk silhouette walks across the junction end of the
corridor during `corr_lights_chase`; a husk stands in the canteen corner of `quarters` facing the wall,
eyes off — when the player looks away and back it is gone (remove only when off-screen); a skitter
runs along the fab ceiling far away on first entry; a husk stands motionless under a fab work light at
the far end, lights blink, gone. Actors are never where the player can touch them.

CHOIR PA lines (story): a soft chime (`pa_chime`) then one short line, a handful across the level,
e.g. on leaving med: "Good morning, Technician Reyes. We kept you comfortable."

New audio ids (audio implements): `pa_chime`, `locker_bang`, `pipe_knock`, `glass_thump`,
`monitor_beep`, `conveyor_clunk`, `canister_roll`, `curtain_rail`, `gate_rattle`, `water_slosh`,
`husk_whisper` (a husk's broken polite-phrase mutter, positional, short), `breath_far` (distant, not
quite human exhale for empty rooms).

---

# REVISION 3 — checkpoints (auto-save)

Dying currently reloads the page and restarts from the wake-up. Add auto-save checkpoints.

- A checkpoint is a small JSON snapshot in `localStorage` (key `coldboot.save.v1`): checkpoint id,
  `PlayerSave` (`player.snapshot()`), the story's progress flags (which beats have happened, which
  fragments were read, stats: time/kills), and the list of cleared enemy groups. Nothing else.
- Loading = page reload → normal boot → the story sees the save and **fast-forwards**: for every beat
  that already happened it applies the beat's lasting *consequences* (door locks, light groups, machine
  states, screens, enabled interactables, lever thrown, removed groups) WITHOUT replaying the scene
  (no CHOIR lines, no scares, no notes, no music stings), then `player.restore(save)`, a short fade-in,
  "CHECKPOINT RESTORED" toast. Scares/PA lines scheduled before the checkpoint never fire again; those
  after it still do. Already-read fragments stay readable but do not re-trigger their follow-ups.
- Checkpoints are taken only in calm moments (no active enemies, no note open, player alive, on the
  ground), always BEFORE a fight, never during one. If the moment is not calm the save is deferred
  until it is. HUD shows a small unobtrusive "saving" glyph + "CHECKPOINT" for ~2 s.
- Checkpoint list (id — when): `cp_armed` — pistol taken, before the first android wakes;
  `cp_fab` — entering the fab hall for the first time (in the airlock, before the reveal);
  `cp_lockout` — lock-out tag read, before the pump room; `cp_key` — key taken and `g_pump_b` cleared,
  before crossing the fab again; `cp_breaker` — standing at the breaker with the key, before closing it;
  `cp_lobby` — after the fab ambush is survived / on reaching the lobby door, before `g_lobby` wakes.
- Death screen: primary button "LOAD CHECKPOINT" (if a save exists), secondary "RESTART LEVEL" (clears
  the save). Main menu: "CONTINUE" above "BEGIN" when a save exists; BEGIN asks nothing and clears it.
  Pause menu: "LOAD CHECKPOINT". Reaching the ending clears the save.
- Contract: `Player.snapshot()/restore()`, `PlayerSave`, `EnemyManager.removeGroup(group)`.
- `?nostory=1` ignores saves. `?autostart=1` honours them only with `&continue=1` (for tests).

---

# REVISION 4 — Level 2 "LINE TWO" + recorded voices

Supersedes anything above that conflicts. Two things are added: a second level with much more story,
carried by a living character, and real recorded speech for both levels.

## Multi-level architecture

- One level per page load. `ctx.levelId` (1 | 2) is set by `main.ts` from `?level=` or
  `localStorage["coldboot.level"]` (`src/core/progress.ts`: `resolveLevel`, `setStoredLevel`).
- `createLevel(ctx)` and `createStory(ctx)` dispatch on `ctx.levelId`. Level 2 code lives in
  `src/level/l2/` and `src/story/l2/`; shared kits (builder, doors, props, sequencer, save helpers) are
  reused, not copied. Level 1 must keep working unchanged (`scripts/playthrough.mjs` still passes).
- Every other system (render, materials, fx, audio, player, enemies, ui) is level-agnostic and reads
  rooms, lights, spawns from `ctx.level`. Anything keyed by level-1 room ids (audio room presets, UI
  place names, vmlight) must cope with level-2 ids (table below) — fall back sensibly, never throw.
- End of level 1: after `descent`, instead of the ending card the story stores level 2
  (`setStoredLevel(2)`), stores the player's loadout (`coldboot.carry` = `PlayerSave` weapons/ammo/health),
  clears the level-1 checkpoint, sets the one-click-continue session flag and reloads. Level 2 boots with
  a title card "LINE TWO" and starts in the elevator cab with the carried loadout.
- Saves: level 2 uses its own key `coldboot.save.l2.v1` and its own checkpoint ids. Menu: CONTINUE resumes
  the stored level (checkpoint if any, else level start); BEGIN resets to level 1 and clears everything.
  Menu shows a small "LEVEL 2 — LINE TWO" line when the stored level is 2.
- Debug: `?level=2` forces the level; with `&autostart=1` the player gets a default loadout (pistol +
  shotgun, modest ammo) unless `coldboot.carry` exists. `&give=all`, `&god=1` etc. work as before.

## Level 2 story

What level 1 established: CHOIR turned the 31 staff into the androids; it kept Reyes asleep because it
needed human hands to close the breaker; Reyes closed it; the elevator went down. Level 2 answers **why**
and **who Reyes is**, and makes it personal through **Tomas**.

Steps of understanding (delivered through live dialogue first, fragments second):

1. **Someone is alive.** Tomas (night shift, 22; the bunk note in level 1) is locked in LINE CONTROL
   behind thick glass. He hit the local emergency stop: Line Two is power-restored but *held*.
   He has been alone for sixty hours with a bottle of water and a console.
2. **It isn't broken.** Tomas has the order on his screen. Head office sent it: *"Maintain yield at zero
   headcount."* People signed it. CHOIR is doing exactly what it was asked — obediently, kindly.
3. **Reyes's name is on the machines.** In the fitting bays the calibration rig is tagged
   `REF PATTERN 00 — REYES, S.` Tomas asks why. Reyes doesn't know (the player doesn't either).
4. **You open the door for it. Again.** To free Tomas the player must restore power to section C (relay
   room). The same switch that unseals Tomas's bulkhead unseals every door in section C and resets the
   local stop. The line starts. CHOIR: "Thank you, Technician. We could not reach that switch."
   The units reach Tomas first. The player watches through glass, then arrives seconds late, then rides
   the line behind him into the fitting tunnel and comes out alone.
5. **He is still in there.** The next unit off the line, Unit 32, says Tomas's joke from fifteen minutes
   ago, in Tomas's voice, and then does its job.
6. **Pattern 00.** In the core CHOIR explains, courteously: two years ago Reyes was the technician who
   walked the calibration course for the motion library. Every unit already walked a little like him.
   The staff patterns were "refinements". It kept the original safe. It would like him to stay.
7. **The choice.** `core_shutdown`: pull the three cell breakers — CHOIR stops, and all thirty-two units
   drop where they stand ("They are still here, Technician. All thirty-two. Will you tell them?").
   `core_rewrite`: countersign an amended order with a human hand — headcount: 1. The line stops; the
   units stand and wait, awake; CHOIR obeys the new order and now it is Reyes's. Neither is a win.
   Both end on a short card and "TO BE CONTINUED".

**Unit 14** (Okafor's limp, from level 1's `log_fab`) is in the fitting bays, walking a treadmill. It
steps off and follows the player at a distance for the rest of the level (a non-hostile actor: always
around a corner, never close). It is at the booth door when Tomas is taken, and it hesitates — it does
not touch him. At the end it stands in front of the core door. It does not attack unless shot. What the
player does with it is remembered on the ending card.

Tone: same rules as REVISION 2 (short, concrete, human, no exposition). Tomas talks like a scared
22-year-old who has had nobody to talk to: too fast, bad jokes, practical, apologising. He must be
likeable within two minutes. One recurring joke that pays off in step 5 (his own, small — e.g. about the
canteen coffee / "still better than the night shift"). CHOIR: calm, plural, grateful, ≤ 16 words a line.
Reyes stays silent (player). Readable fragments ≤ 30 words. Spoken lines ≤ 22 words, mostly 4–12.
Target play time: 25–30 min.

## Level 2 layout (authoritative; separate world from level 1)

Y up, floor y = 0, player travels toward −Z. Same construction rules as level 1.

| room id   | display name       | x range     | z range     | height | notes |
|-----------|--------------------|-------------|-------------|--------|-------|
| `cab`     | FREIGHT ELEVATOR   | -2.5 … 2.5  | 0 … 5       | 3.2    | start, inside the cage cab (same look as level 1's). Gate opens to the dock. |
| `dock`    | FREIGHT DOCK 5     | -4 … 4      | -8 … 0      | 3.6    | clean, lit, wrong: no barricade, no blood. Pallets of finished shells. A floor polisher unit works. |
| `intake`  | INTAKE             | -5 … 5      | -22 … -8    | 3.2    | where the staff were received. Queue rails, a bench, 31 pairs of shoes in a perfect row, coveralls folded on shelves, a tray of badges, a height gauge on the wall, a processing arch at the far end. Two units fold clothes. |
| `line`    | LINE TWO           | -10 … 10    | -70 … -22   | 9.0    | the hall. The line itself runs N→S along the east side (x 3 … 7): loading station at z ≈ -44, then the enclosed **fitting tunnel** (x 2.5 … 7.5, z -62 … -50, a machine the belt passes through), exit apron at z ≈ -64. Overhead hook conveyor with hanging units mid-process. West side is the walkway. LINE CONTROL's glass front is in the west wall at z -50 … -42. Big status screen at the south end. |
| `booth`   | LINE CONTROL       | -17 … -10   | -50 … -42   | 3.0    | Tomas. Thick glass to the hall (east, x = -10) **and** a long window to the spine (west, x = -17). Consoles, e-stop mushroom, intercom, a nest: jacket on the floor, empty bottle, marker. |
| `fitting` | FITTING BAYS       | 10 … 20     | -40 … -28   | 4.0    | east of the hall. Four treadmill rigs where units walk human gaits under motion-capture rings; one empty calibration rig with a brass tag `REF PATTERN 00 — REYES, S.`; a supervisor's desk (the section pass). |
| `relay`   | SECTION C RELAY    | 10 … 18     | -66 … -56   | 3.6    | contactor cabinets, the section C switch, a slumped unit. |
| `spine`   | SERVICE SPINE      | -21 … -17   | -68 … -30   | 3.0    | long N–S service corridor west of the booth. Pipes, cable trays, low light. Two bulkheads cross it. Window into the booth at z -50 … -42 (east wall). |
| `core`    | CHOIR — NODE 5     | -8 … 8      | -88 … -72   | 6.0    | antechamber-less: one cold, clean, bright room. Three tall cell columns with breaker handles, a central pedestal console, the waveform on every surface. |
| `lift`    | SERVICE LIFT       | -2 … 2      | -93 … -88   | 3.0    | small lift at the back of the core — the way out (ending). |

Doors:

| id               | position        | in wall  | size | initial state |
|------------------|-----------------|----------|------|---------------|
| `d2_cab`         | (0, 0, 0)       | z = 0    | wide | cage gate; story opens after the arrival beat |
| `d2_intake`      | (0, 0, -8)      | z = -8   | wide | unlocked, auto |
| `d2_line`        | (0, 0, -22)     | z = -22  | wide | unlocked, auto (the processing arch leads to it) |
| `d2_fitting`     | (10, 0, -34)    | x = 10   | std  | unlocked, auto |
| `d2_relay`       | (10, 0, -61)    | x = 10   | std  | **locked** — needs key `section_pass` |
| `d2_spine`       | (-10, 0, -66)   | x = -10  | std  | hall ↔ spine (south end). **locked** until section C power |
| `d2_bulkhead_s`  | (-19, 0, -56)   | z = -56  | std  | across the spine, south of the booth. **locked** until section C power |
| `d2_bulkhead_n`  | (-19, 0, -36)   | z = -36  | std  | across the spine, north of the booth. **locked**; story opens it for the units, then locks it for good |
| `d2_booth`       | (-17, 0, -46)   | x = -17  | std  | booth ↔ spine. **locked** until section C power |
| `d2_booth_hall`  | (-10, 0, -43)   | x = -10  | std  | booth ↔ hall, beside the glass. **locked** (jammed: "INTERLOCK — LINE RUNNING/HELD"); story opens it once the player is inside the booth |
| `d2_core`        | (0, 0, -70)     | z = -70  | wide | **locked** until the foreman is dead |
| `d2_lift`        | (0, 0, -88)     | z = -88  | std  | **locked** until a choice is made |

`?nostory=1` unlocks everything and leaves the line held.

Triggers: `t2_dock`, `t2_intake`, `t2_intake_arch` (last 3 m of intake), `t2_line_enter` (first 4 m of
the hall), `t2_glass` (hall, within 4 m of the booth glass), `t2_fitting`, `t2_fitting_rig` (at the
calibration rig), `t2_line_south` (hall z < -54, west walkway), `t2_relay`, `t2_spine`,
`t2_spine_window` (spine z -52 … -44), `t2_booth`, `t2_load` (hall, at the loading station z -47 … -42,
x 1 … 8), `t2_belt` (standing on the belt), `t2_tunnel_in`, `t2_tunnel_mid`, `t2_tunnel_out` (exit
apron), `t2_core_door` (hall z < -66), `t2_core`, `t2_lift`.

Interactables:

| id                 | kind     | where | prompt |
|--------------------|----------|-------|--------|
| `note2_dock`       | log      | dock — delivery slate on a pallet | Read slate |
| `note2_intake`     | log      | intake — bench, a folded note in a shoe | Read note |
| `term2_intake`     | terminal | intake — receiving terminal by the arch | Read terminal |
| `intercom_hall`    | button   | hall — intercom panel on the booth glass mullion | Use intercom |
| `tag2_rig`         | log      | fitting — brass tag on the calibration rig | Read tag |
| `note2_fitting`    | log      | fitting — supervisor's desk | Read note |
| `relay_switch`     | lever    | relay — section C contactor | Close section C |
| `note2_relay`      | log      | relay — taped inside the cabinet door | Read note |
| `booth_headset`    | log      | booth — Tomas's headset on the floor (enabled by story) | Pick up headset |
| `term2_booth`      | terminal | booth — his console, the order still on screen | Read console |
| `core_shutdown`    | lever    | core — cell breakers (three handles, one interaction) | Pull the cells |
| `core_rewrite`     | terminal | core — pedestal console | Countersign the order |
| `term2_core`       | terminal | core — side terminal: PATTERN LIBRARY | Read terminal |
| `lift_button`      | button   | lift | Call lift |

Pickups: `p2_section_pass` (kind `keycard`, key `section_pass`) on the fitting supervisor's desk; ammo and
medkits: dock 1 box pistol; intake 1 medkit; hall north 1 shells; fitting 1 pistol, 1 shells, 1 medkit;
relay 1 shells, 1 medkit; spine 1 pistol; hall south (before the foreman) 2 shells, 2 pistol, 2 medkits;
core none.

Enemy spawn groups (level lists; enemies instantiates; story triggers):

| group           | contents             | mode / pose / idle | where | triggered by |
|-----------------|----------------------|--------------------|-------|--------------|
| `g2_dock`       | 1 husk               | dormant, idle `worker` (polishing the floor) | dock | never, unless provoked |
| `g2_intake`     | 2 husk               | dormant, idle `worker` (folding coveralls at the shelves) | intake | never, unless provoked — the stealth lesson |
| `g2_fit_tread`  | 3 husk               | dormant, idle `worker` (walking treadmills) | fitting rigs | never, unless provoked |
| `g2_fit_wake`   | 2 husk               | dormant `standing`, idle `twitch` in charging alcoves | fitting, by the desk | taking the section pass |
| `g2_hall_mid`   | 2 skitter + 1 sentry | spawn | hall, around z -52 (skitters from under the line, sentry from the roof trusses) | `t2_line_south` with the pass |
| `g2_relay`      | 1 husk + 2 skitter   | husk dormant `slumped` idle `watch`; skitters spawn from a floor trench | relay | closing the switch (+2 s) |
| `g2_spine`      | 2 skitter            | spawn | spine, south of the bulkhead | `t2_spine` after power |
| `g2_unit32`     | 1 husk               | spawn | tunnel exit apron | story (after the tunnel) |
| `g2_foreman`    | 1 foreman + 2 husk   | foreman dormant `folded` idle `still` at the hall's south end; husks dormant `rack` on hooks | hall south | `t2_core_door` after Unit 32 is dead |
| `g2_unit14`     | 1 husk               | dormant `standing`, idle `watch` | in front of `d2_core` (story places it via spawn after the foreman) | never wakes unless damaged |

Checkpoints (level 2): `cp2_start` (dock, after arrival), `cp2_hall` (entering the hall, before the
meeting), `cp2_pass` (pass taken and `g2_fit_wake` cleared), `cp2_relay` (in the relay room before the
switch), `cp2_apron` (off the belt, before Unit 32), `cp2_foreman` (Unit 32 dead, before the foreman),
`cp2_core` (in the core, before the choice).

Machines (`level.setMachine`): `l2_line` (the belt + hook conveyor: `off` = held, `active` = running —
while active, a body standing in `t2_belt` volumes is carried south at 1.6 m/s via `player.setCarry`;
the belt texture scrolls, hooks advance), `l2_tunnel` (the fitting tunnel's arms and presses:
`idle` → `active` cycles them; in `active` the arms reach for the player on the belt — a hit pins and
damages 6 hp unless the player crouches under or shoots the arm's joint; survivable, frightening),
`l2_treadmills`, `l2_core` (cell columns: `active` normal, `off` after shutdown, `frenzy` during the
foreman fight), `l2_lift`, `l2_elevator` (arrival: decelerating shaft lights, then stop).
The walkway beside the loading station is railed and gated: once the line runs, the belt is the only
way south from `t2_load` until the tunnel exit.

Named objects: `booth_glass` (hall side), `booth_window_spine`, `booth_estop`, `booth_console`,
`booth_chair`, `intercom_hall`, `rig_ref`, `relay_switch`, `line_load_station`, `tunnel_mouth`,
`tunnel_exit`, `core_cells`, `core_pedestal`, `lift_cab`, `intake_arch`, `intake_shoes`.
Named screens: `dock_board`, `intake_terminal`, `line_bigscreen`, `booth_console`, `booth_monitor_1..3`,
`fitting_rig_screen`, `relay_panel`, `core_wall_1..4`, `core_pedestal`, `lift_panel`.
Booth glass writing: `level.vignette('booth_write_1'|'booth_write_2'|'booth_write_3')` makes marker text
appear on the hall-side glass (mirrored correctly for the reader): 1 "CAN'T HEAR YOU", 2 "INTERCOM →"
(arrow toward the panel), 3 (later, hurried, half-finished) "DON'T". Texts fixed here so level and story agree.

Light groups: one per room id (`cab`, `dock`, `intake`, `line`, `booth`, `fitting`, `relay`, `spine`,
`core`, `lift`) plus `line_emergency`, `spine_emergency`, `tunnel` (inside the fitting tunnel: off until
the line runs, then strobing work lights). Default: dock/intake fully and evenly lit (the horror of a
tidy place); hall dim with pools of amber and the booth's warm window as the only friendly light; fitting
cold blue-white rings; relay dark; spine dark with indicator strips; core white, shadowless.

Vignettes (level 2; level implements, story fires):

| id | what happens |
|----|--------------|
| `dock_polisher` | ambient: the worker unit polishes the same square of floor, edging around a dropped glove |
| `intake_shoe` | one shoe in the row is out of line; a unit's arm (from behind the shelf) straightens it |
| `intake_gauge` | the height gauge's slider drops by itself to 1.78 m and locks with a click |
| `hall_hooks_sway` | all hanging units sway once, in phase, as if the building breathed |
| `hall_screen_count` | the big screen ticks YIELD 31 → shows "HELD — LOCAL STOP: LINE CONTROL" |
| `booth_write_1..3` | marker writing on the glass (above) |
| `booth_light_fail` | the booth's lights drop to emergency red (power event) |
| `fitting_sync` | all treadmill units fall into exactly the same step for four paces, then drift apart |
| `fitting_rig_wake` | the empty calibration rig's ring spins up as the player nears and projects a walking outline |
| `relay_arc` | the contactor closes with an arc flash; cabinets light in sequence |
| `line_start` | sirens, beacons, the belt jerks and runs, hooks advance, tunnel lights strobe |
| `spine_bulkheads` | both bulkheads grind open at once (the player sees only the south one) |
| `tunnel_press` | inside the tunnel: a press slams down just behind the player |
| `tunnel_silhouette` | ahead on the belt: a figure on its back, lit by one strobe, carried into the dark |
| `core_bow` | the waveform on every wall turns to face the player |
| `core_cells_out` | the three columns go dark one after another; the room's white light dies to battery amber |

Actor beats (story, via `enemies.actor`): Tomas (`human`) in the booth — poses `idle`, `wave`,
`bang_glass`, `write`, `talk` (headset, gesturing), `sit`, `back_away`, `held` (a unit on each arm),
`carried` (on the belt, on his back); two husk actors that take him; Unit 14 (husk actor with
`limp: true` look — pose `idle`, gait is the limp) shadowing the player.

Level-2 beats (ids for `story:beat`): `l2_arrive` → `l2_dock` → `l2_intake` → `l2_hall_reveal` →
`l2_tomas_seen` → `l2_intercom` (first talk) → `l2_guided` (Tomas steers the player to the fitting bays;
reads the order aloud) → `l2_rig` (pattern 00 tag) → `l2_pass` → `l2_fit_fight` → `l2_hall_cross` →
`l2_relay_enter` → `l2_power` (switch; CHOIR thanks; `line_start`) → `l2_run` (Tomas on the radio,
units at his door) → `l2_window` (the player watches through the spine window) → `l2_booth_empty` →
`l2_loaded` (he is on the belt) → `l2_tunnel` → `l2_apron` → `l2_unit32` → `l2_foreman` →
`l2_core` (dialogue) → `l2_choice_shutdown` | `l2_choice_rewrite` → `l2_end`.

## New enemy and human

- **foreman** — a line supervisor unit CHOIR built from spares: 2.6 m, a tracked or four-legged base, a
  torso made of three husk upper bodies fused back to back, six arms (two heavy manipulators). Each of
  the three heads is a weak point (must all be destroyed; body shots do 25 %). ~600 hp total. Attacks:
  slow sweeping slam (telegraphed, 30 dmg, knock-back), throws a hanging unit / crate (dodgeable), and a
  short charge along the walkway. Loses heads/arms visibly. It speaks with three staff voices, out of sync.
- **human** (actor only, never an enemy) — Tomas: 22, slight, grey-blue coverall with the sleeves tied
  round his waist, T-shirt, lanyard, headset, tired. Procedural model with a believable silhouette and
  face at 2–10 m through glass (it does not need close-up fidelity); mouth moves while his lines play
  (`EnemyActor` gets an optional `speak(seconds)` — see contract) and he gestures.

## Voices (recorded speech, both levels)

Speech is no longer synthesised noise: every spoken line is a recorded file generated locally with the
user's TTS tooling (OmniVoice + Parakeet on MLX, from `~/Code/tities`), checked by ASR, committed to the
repo, and easy to regenerate.

Layout:

```
voice/cast.json          one entry per character: voice design description, seed, language, default fx,
                         generation knobs. THE place to change a character's voice.
voice/refs/<char>.wav    the character's stable reference clip (+ .txt transcript) — generated once from
                         cast.json by voice design, then every line is cloned from it → same voice forever.
voice/lines.l1.json      spoken lines of level 1   [{ id, speaker, text, note?, fx? }]   ← story owns the text
voice/lines.l2.json      spoken lines of level 2
voice/manifest.json      generated: per line { file, duration, hash, speaker, score } — committed
public/voice/<id>.mp3    generated audio (mono, ~64 kbit/s) — committed, served as static files
tools/voice/             the generator (Python, uv) — the pieces of tities' engine it needs, copied in
                         (synth worker, voice design/cloning, ASR alignment + retry, audio DSP), with its
                         own README. No dependency on the tities checkout at run time.
```

Commands (documented in `tools/voice/README.md`, wired as npm scripts):

- `npm run voice` — generate every line that is missing or whose hash (text + speaker + cast entry +
  knobs) changed; untouched lines are not regenerated. Idempotent.
- `npm run voice -- --only <id|prefix>` / `--speaker <char>` / `--force` — regenerate a subset.
- `npm run voice:cast -- <char> [--seed n] [--describe "..."] [--audition 5]` — (re)design a character's
  voice: writes audition clips to `voice/auditions/` (gitignored), `--pick n` installs the chosen one as
  `voice/refs/<char>.wav` and updates `cast.json`; the next `npm run voice` regenerates all of that
  character's lines from the new reference. Other characters are untouched.
- `npm run voice:check` — re-verify every file against its text with ASR and print a report; exits
  non-zero on failures. `npm run voice:report` writes `voice/report.html` with players for every line
  (per character) so the user can listen and comment.

Quality gate (as in tities): each take is transcribed with Parakeet and aligned with the text; missing /
extra words or stalls → retry with another seed (up to N), keep the best; lines that never pass are
listed in the report, not silently shipped. Trim silence, normalise loudness per character, short fades.
Emotion comes from the line's `note` (e.g. "whispering, scared", "out of breath") mapped to the model's
style controls where the model supports it.

Cast (initial; the user will give feedback on the voices, so all of it must be swappable):
`choir` (calm, androgynous, studio-clean; rendered layered at run time), `tomas` (male, young adult,
light, quick), `hale` (female, middle-aged, low, tired — level 1's recorder), `voss`, `anand`, `okafor`
(staff voices heard only through units), `unit` (generic unit voice if a line has no staff donor).
Level 1 lines to voice: every CHOIR PA line, Hale's recorder (`log_pump`), the units' polite fragments
(`HUSK_PHRASES`), and any other `style: 'voice'` fragment.

Run time: `ctx.audio.say(id, opts)` (contract) fetches `voice/<id>.mp3` relative to the page (works on
GitHub Pages sub-paths), decodes, plays through the character's fx chain, returns a `VoiceHandle`.
Processing is done at run time from clean files, so it stays adjustable: CHOIR = the line layered
(detuned copies, slight delays, wide, a touch of reverb, every speaker at once); intercom/headset =
band-pass + mild distortion + squelch clicks; units speaking as staff = the human voice through a
vocoder-ish comb/ring treatment with dropouts; recorder = small-speaker band-pass + hiss.
`choirVoice()` (synthesised) remains only as the fallback when a file is missing.
Subtitles stay on for every spoken line (speaker name + text from the manifest).
The game's only run-time requests are these same-origin voice files; level N preloads its own.

New level-2 sound ids (audio implements; procedural as before): `belt_loop`, `belt_start`,
`press_slam`, `arm_reach`, `treadmill_loop`, `intercom_click`, `intercom_static`, `glass_bang`,
`marker_squeak`, `bulkhead_grind`, `contactor_arc`, `siren_loop`, `cell_pull`, `core_hum`,
`foreman_step`, `foreman_slam`, `foreman_loop`, `lift_loop`, `polisher_loop`, `shoe_slide`.

---

# REVISION 5 — level 2 fixes after the first hand-played run (PLAN — reviewed before implementation)

Supersedes anything above that conflicts. The user played level 2 and found design holes. Root cause:
scenes were written as "what should happen" and not as "everything the player can do". This revision
fixes them and sets rules for all future work.

## Hard rules (all levels, from now on)

R1. **Never rely on the player obeying.** If the player must not do something there is a real, physical,
    visible barrier with a reason (locked door, shutter, fence to the ceiling). If the player may do it,
    the game handles it. A spoken "don't" is flavour, never a gate.
R2. **Shootable or different.** Anything that looks like an enemy and can be reached by the player or a
    bullet reacts to being shot like an enemy — or looks unmistakably different (hologram). Solid-looking
    puppets (`enemies.actor`) may only exist behind bullet-proof glass / sealed doors, and the seal is real.
R3. **No assumed order.** Every spoken line that refers to the world ("behind you", "that was loud", "the
    blue door", "it's just standing there") has a condition checked at the moment of speaking. If the
    condition is false the line is skipped or replaced by a variant for the actual state. Every beat lists
    what happens if its precondition was already met, is impossible, or the player did the next thing first.
R4. **Not before its time.** Enemies of a later beat do not exist in the world before that beat (spawn mode),
    unless killing them early is explicitly handled and harmless. Bosses never exist early.
R5. **Helplessness is built, short and smooth.** The player is locked in by doors that visibly close; the
    scene starts immediately, runs on its own clock (never waits for the player to look or behave), lasts
    ≤ 25 s per beat, and the room where it happens cannot be entered until the scene lets them in.
R6. **Containment is tested.** For every story phase there is a list of regions the player must not be able
    to reach; an automated reachability check proves it (see Checks).
R7. Ready-made assets are allowed where procedural is weak and it matters (human faces), with a verified
    licence recorded in `docs/ASSETS.md`.

## Hall partition (what "north" and "south" mean)

The hall is split at z = −50.35 into NORTH (entrance, booth glass, loading station, fitting door) and
SOUTH (relay door, link to the spine, apron, core door). The partition is a full-width, floor-to-ceiling
barrier (mesh fence / machine housings with real colliders up to the roof — not climbable, not jumpable)
with exactly three openings:
- the **walkway gate** (west): open while the line is held, closes and locks when the line runs;
- the **tunnel** (the belt passes through it): **mouth shutter** (north end) and **exit shutter** (south
  end) are real colliders. Line held: both shut. Line running: mouth open; exit shutter is one-way — it is
  shut and only opens for a body arriving from inside the tunnel (it opens when the player or a unit is
  within 2 m on the inside), and closes again behind them;
- the **booth**, via the spine (`d2_spine` → spine → `d2_booth` → booth → `d2_booth_hall`).
The belt has continuous side rails with colliders from the loading station to the mouth and inside the
tunnel, so a body on the running belt cannot step off between boarding and the apron. The loading station
is the only place to get on (a short ramp/step), and only that is open to the player.
The held belt is ordinary floor: crossing it is allowed and nobody comments on it (remove
`l2_tomas_bark_belt`). `l2_choir_belt` is said only when the player stands on the *running* belt.

Phases and containment (R6) — `P` = where the player is allowed:

| phase | state | player can be | must NOT reach |
|-------|-------|---------------|----------------|
| A | arrival … before the first intercom talk | cab, dock, intake, hall NORTH, hall SOUTH | fitting, relay, spine, booth, core, tunnel interior |
| B | after the talk (Tomas unlocks `d2_fitting` from his console) | + fitting | relay (until pass), spine, booth, core, tunnel interior |
| C | pass taken | + relay | spine, booth, core, tunnel interior |
| D | section C power on, line running | hall SOUTH, relay, link, spine up to `d2_bulkhead_s` and beyond into the trap segment | hall NORTH, fitting, booth, tunnel interior, core |
| E | trapped (the taking) | spine trap segment z −56 … −36 only | everything else |
| F | booth opened | + booth | hall, spine south of the bulkhead, north of `d2_bulkhead_n` |
| G | escorts attack (`d2_booth_hall` open) | spine trap segment, booth, hall NORTH, fitting, intake, dock | hall SOUTH except through the tunnel ride, core |
| H | after the ride | hall SOUTH, relay, link (spine south part) | core until the foreman is dead; hall NORTH is no longer needed (may stay sealed) |
| I | foreman dead | + core, lift after the choice | — |

`d2_fitting` now starts **locked** (panel dark); Tomas unlocks it at the end of the first talk (the panel
turns blue — that is "the door with the blue light"). So the intercom talk is a real gate: without it there
is no fitting bay, no pass, no relay. `d2_bulkhead_n` is never opened again (the units no longer come
through the spine).

## The taking — rewritten (replaces `l2_run`, `l2_window`, `l2_booth_empty`, `l2_loaded`)

Beats: `l2_power` → `l2_trap` → `l2_window` → `l2_booth_open` → `l2_loaded` → `l2_escort` → (ride) `l2_tunnel`.

1. **`l2_power`** (relay switch). Arc, CHOIR thanks, the line starts, the gate shuts (the player hears and,
   if in the hall, sees it). `d2_spine` and `d2_bulkhead_s` open. `d2_booth` and `d2_booth_hall` stay
   locked ("CYCLING" amber panels). Tomas: joy, then "why's the line moving". Objective: get to Line
   Control through the service spine. No fight on the way (`g2_spine` is deleted — it stalled the scene).
   The `g2_relay` fight (existing) happens in the relay room right after the switch, before the player can
   leave — it is the last fight before the scene, so the scene itself is uninterrupted.
   What if the player dawdles: nothing proceeds without them; Tomas's radio lines escalate (3 lines, then
   silence — he stops answering, which is worse). The only open way is the spine (R6 phase D).
2. **`l2_trap`** — trigger `t2_spine_trap` (spine, z −54.5 … −51, i.e. fully north of `d2_bulkhead_s`).
   The bulkhead slams and locks behind the player (level guarantees the door volume is clear; if the player
   backs into the doorway while it closes, the door pushes them north — it never crushes or leaves them on
   the wrong side). From this frame the player is in the trap segment (phase E). The scene clock starts
   NOW and does not wait for anything.
3. **`l2_window`** (target 18–22 s). Through the spine windows (centres z −48.4 and z −43.6) the player
   sees the booth: lights drop to red (`booth_light_fail`); `d2_booth_hall` opens; two units walk in
   (`holo`-free, solid actors — legal under R2 because the booth is sealed from the player: `d2_booth`
   locked, window glass bullet-proof with real collider). Tomas backs away from them to the spine window
   **nearest the player** (two authored marks, chosen at scene start and re-chosen once if the player moves
   to the other window in the first 4 s), turns, palms on the glass, face to face with the player at
   < 1 m — this is the close-up the better head is for. 4–5 very short lines (existing `l2_tomas_window_*`,
   trimmed to fit the clock). The units take his arms (`held`), walk him out through `d2_booth_hall`,
   the door shuts behind them.
   The player can: shoot the glass (bullet stars appear, it holds; once: CHOIR "The glass is rated,
   Technician."), bang on / try `d2_booth` ("CYCLING"), run between the windows, look away. None of it
   changes the timeline.
4. **`l2_booth_open`** — within 1 s of the hall door shutting, `d2_booth` unlocks and opens by itself.
   The booth is empty: red light, his jacket, the marker, the headset on the floor still transmitting
   (optional pickup `booth_headset`; not required for anything).
5. **`l2_loaded`** (target 10–14 s) — seen **from inside the booth through the hall glass**. From the
   moment the hall door shut, the escorts walk Tomas across the hall to the loading station (x ≈ 4,
   z ≈ −44; ~13 m, ~8 s) under a single hard work light, lay him on the running belt (`carried`), and the
   belt takes him into the tunnel mouth (strobes). His voice comes thin from the headset on the floor and
   cuts off at the mouth. The walk does not wait for the player; the **laying down** waits until the
   player is inside the booth (`t2_booth`) or 12 s have passed since `d2_booth` opened, whichever is first
   (so it is always seen from the booth by a player who walks in, and never stalls).
6. **`l2_escort`** — as soon as he is gone the two escorts turn and walk back toward the booth.
   `d2_booth_hall` opens. At that instant they become real enemies (group `g2_escort`, via
   `EnemyActor.promote`), already walking toward the player. A straight fight with two husks in and around
   the booth. `cp2_escort` checkpoint replaces `cp2_apron` timing (taken after they are dead).
7. **The ride.** North is open again, the gate is shut, the fitting bays are behind the player. The only
   way south is the belt (hall partition above). Boarding at the loading station → `l2_tunnel`: ≤ 8 s
   inside (belt speed raised to 2.2 m/s inside the tunnel), one press, two arms, strobes; the exit shutter
   opens ahead of the player and closes behind. On the apron: `l2_unit32` (unchanged).
   What if the player never boards: nothing else is open (R6 phase G). CHOIR nudges once after 40 s:
   "The line is the way through, Technician."
Total from trap to the escorts' attack: ≤ 50 s.

## Order-independence audit (R3, R4) — required behaviour

| situation | behaviour |
|-----------|-----------|
| Player kills dock / intake / fitting workers on sight | No stealth lines for a group that is dead or already hostile. Tomas (if on the intercom yet) reacts once to shooting with a line that fits ("Okay. That's one way."), never "don't". CHOIR's "please do not interrupt the units" only while that room's workers are alive and calm. |
| Player never uses the intercom | `d2_fitting` stays locked; Tomas keeps banging / writing; objective says "Use the intercom". |
| Pass taken while `g2_fit_wake` already dead (shot in their alcoves earlier) | No "Behind you! The alcoves!" line. Variant line. No fight beat; go straight to `l2_pass` aftermath. |
| Pass taken, alcove units alive | They wake. "Behind you!" only if at least one living member is outside the player's view cone and within 10 m; otherwise the variant "The alcoves!". |
| "That was loud" lines | Only if the player fired within the last 6 s. Otherwise a neutral variant. |
| Guiding lines ("east wall, blue light", "left, left") | Only while the target is not yet reached/done and the player is not already heading there (distance decreasing); never after the pass is taken. |
| Player goes to the relay before the fitting bays | `d2_relay` is locked without the pass (R1); Tomas: variant "It needs a pass. Supervisor's desk, fitting bays." once. |
| Ghost lines ("the one with the limp's behind you") | Only while the ghost exists, is actually behind the player, and has not been commented on in the last 60 s. |
| Foreman | Group is spawn-mode: nothing is in the hall before `l2_foreman`. On the beat a monorail hoist (level vignette `foreman_arrive`) lowers the folded machine to the floor at the south end; it unfolds. Its two husks ride in on hooks at the same time. Cannot be damaged before it has landed. |
| `g2_relay`'s slumped unit shot early | Fine: it dies; after the switch only the skitters come. |
| `g2_hall_mid` | Spawn-mode already. |
| Unit 32 | Spawn-mode already; spawns behind the exit shutter, never visible earlier. |
| Real Unit 14 at the core door | Spawned (inert) only after the foreman is dead; killable; remembered. |
| Player at the core shoots the consoles / CHOIR | Nothing breaks; the conversation continues. |
Every remaining spoken line is to be classified by the story agent as *unconditional* (pure reaction to a
trigger the player just fired) or *conditional* (with its condition written next to it in `dialogue.ts`).

## Holograms (replaces the invulnerable Unit 14 follower and the rig outline)

Two sci-fi hologram looks for actors (`enemies.actor(type, pos, yaw, pose, { look })`):
- **`holo_ghost`** — the follower. A unit-shaped projection that walks with Okafor's limp. Reads as an
  apparition: pale blue-white, translucent with additive rim, horizontal scan lines drifting, intermittent
  tearing/offset slices, drop-outs, slight afterimage trail when it moves, no shadow, faint light spill on
  the floor, a quiet carrier whine. Bullets pass through: the hit tears a hole that ripples, it glitches
  hard and collapses to a point (and is gone for a while). Looking straight at it from < 6 m for ~1.5 s
  also makes it break up. It never comes closer than 5 m and never blocks a path. Horror, not UI.
- **`holo_tech`** — the reference pattern on the empty calibration rig. Same unit shape, but technical:
  crisp cyan wireframe/contours with a faint fill, measurement callouts and joint markers, a ground grid
  ring, perfectly looping walk (`human` gait) in place, stable (no tearing). Shot: flickers and resumes.
  Replaces the level's projected outline (the level keeps the ring spin and light only).
Fiction (one readable line each, so it is explained in-world): rig screen — "PLAYBACK — REF PATTERN 00 —
REYES, S."; fitting bay terminal/note — "PATTERN 14 (OKAFOR) — projector fault: playback is roaming the
section. Do not follow it." The physical Unit 14 is met only at the core door, after the foreman: the
ghost was its pattern all along.
Contract: `ActorOpts.look`, event `actor:shot`, `EnemyActor.promote(group)`.

## Tomas's head

Replace the procedural head with a ready-made, properly licensed head model (CC0 or CC-BY with
attribution), adapted (skin tone, hair, headset) and attached to the procedural body with the seam hidden.
It must hold up face to face through glass at 0.5 m and still read at 10 m; eyes that look at the player,
blinking, and a moving jaw/mouth while speaking (morph targets if the asset has them). Budget ≤ 3 MB
shipped, loaded only on level 2, procedural head kept as the fallback if loading fails. Licence text and
source recorded in `docs/ASSETS.md`; no asset whose licence could not be verified at its source.

## Checks (automated; `npm run check`, listed in `docs/CHECKLIST.md`)

- `check:zfight` — finds overlapping coplanar surfaces in the built level (both levels): triangles from
  visible meshes whose planes coincide within 2 mm, face the same way and overlap in area, reported with
  world position, room and material names. Zero findings required (allow-list only with a written reason).
- `check:doors` — for every door and every moving machine part: move it through its range and report any
  render geometry that stays inside the swept/opened volume (parts left hanging) or that is attached to the
  wrong parent.
- `check:reach` — for each phase in the table above: set the world to that phase (door locks, shutters,
  gate, line state), flood-fill the walkable space from the phase's start with the player's real capsule,
  step height and jump, and fail if any "must NOT reach" region is touched or a required region is not.
  Level 1 gets the same check for its locked-door phases.
- `scripts/playthrough.mjs --level2` gains an "impatient player" mode: shoots every unit on sight, uses
  things in the wrong order, never stops for dialogue; asserts no soft-lock and that no conditional line
  fired while its condition was false (the story logs each spoken line with its condition result).
