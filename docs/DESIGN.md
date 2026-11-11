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
  Ctrl/C crouch, LMB fire, R reload, 1/2/wheel switch, F flashlight, E use, Esc pause.

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
