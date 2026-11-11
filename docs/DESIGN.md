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
