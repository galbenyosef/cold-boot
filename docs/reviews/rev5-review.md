# Review of the REVISION 5 plan (reviewer subagent, static read of the code)

Coordinates are from the code at the time of review. Decisions taken on each item are in
docs/DESIGN.md → REVISION 5.1; this file keeps the evidence (file:line, numbers) the fixes need.

## Blockers
- **B1 Tunnel walkable beside the belt.** Mouth/exit face plates are render-only (`src/level/l2/line.ts:264-271`);
  side-bay floors render-only (`line.ts:296`); bay guard collider starts at belt height 0.55 (`line.ts:293`).
  A 1.14 m floor lane exists at x 2.7…3.84 and x 6.16…7.3 from z −50 to −62, exiting before the apron collider
  at −63.5. Needs colliders for both full faces (x 2.5…7.5, y 0…3.6) minus the belt aperture, solid bay floors.
- **B2 Closing a door behind the player has no mechanism.** `DoorImpl.lock()` only resizes two boxes
  (`src/level/doors.ts:112,136-146`); physics pushes a capsule out through the nearest face
  (`src/physics/physics.ts:123-147`). Sprint 6 m/s, door 0.85 s. Needs a latch: the scene starts only when the
  door is fully closed and the player is on the right side; otherwise reopen and re-arm. Same for the exit
  shutter, mouth shutter and gate (gate collider only switches on past x > −3.0, `line.ts:721`).
- **B3 Hostiles alive at the trap / stranded.** `g2_hall_mid` (`hall.ts:31-33`) and `g2_relay` are not required
  dead. `d2_spine` is auto and opens for enemies (`doors.ts:173-181`). Stranded enemies keep `calm()` false
  (`src/story/l2/script.ts:533-541`) so no later checkpoint saves.
- **B4 Nothing forces the escort fight before the ride.** Husk WALK 1.3, RUN 4.0 (`src/enemies/husk/husk.ts:38`),
  player sprint 6: the player can run past and board.
- **B5 Checkpoints.** Last checkpoint before the escorts is `cp2_relay`. `apron()` waits on `cp2_apron`
  (`script.ts:1263`), `CHECKPOINT_IDS_L2` lists it (`src/story/save.ts:134`). `spine_bulkheads` is in `LASTING`
  and replayed on load by `#line_running` (`script.ts:57,360`); it opens both bulkheads with a delayed `open()`
  (`spine.ts:115-123`).

## Holes
- **H1** Partition today is `cagePanel` at 2.3 m, see-through (`line.ts:685-697`). `t2_glass` spans z −51…−41
  (`src/level/l2/index.ts:60`), so it fires south of the partition.
- **H2** Things crossing z = −50.35: catwalk at y 4.4, x −9.8…−8.35, z −68.8…−23.2 (`hall.ts:126-135`); monorail
  x −3.5, y 7.8 (`hall.ts:119`); hook conveyor loads y ≈ 4.4…6.8 over the tunnel (`line.ts:737`); cable trays at
  x 2.2 and 8.2; tunnel roof walkable collider at y 3.85 (`line.ts:250`). Fence looks hoppable from the shell
  pallet at (−7.0, −52.5) with a 1.0 m jump (unverified).
- **H3** Rail colliders 1.05…1.3 m above belt/deck; `jumpHeight` 1.0 (`src/player/controller.ts:18`); corpse wreck
  boxes are standable (`src/enemies/manager.ts:166-188`). Belt can be left northward over the 0.55 m infeed stop.
- **H4** Hanging units on the hook conveyor: full robot bodies, bullets reach them, no reaction
  (`src/level/machines.ts`). `tunnel_silhouette` (`line.ts:436-453`) no longer makes sense.
- **H5** Tomas shot at through glass: no reaction (actors never in hitscan, `manager.ts:36,233`).
- **H6** Foreman "cannot be damaged before landing" breaks R2. Spawn (−3.6, −65.8) vs trigger `t2_core_door`
  full width at z < −66: lands on the player.
- **H7** `term2_booth` enabled from load (`src/level/l2/booth.ts:80`); opening it or the headset covers the scene.
  A headset on the floor cannot transmit him from the hall.
- **H8** Sight line booth → lay-down: from (−10.5, 1.65, −46) to (5, 0.7, −44.5) passes the loading arch's west
  post (x 3.65, z −44.6, `line.ts:192-196`); marker writing "INTERCOM →" at eye height z −45.9…−44.4
  (`booth.ts:215`); south of z −47 guards are 1.2 m high. Suggested lay mark z ≈ −45.2, x 4.6, with a key light.
- **H9** Spine wall 0.4 m thick, glass at x −17 (`booth.ts:29-38`, `spine.ts:28-30`): minimum face distance ≈ 1.05 m.
  `bang_glass` assumes glass 0.42 m away (`script.ts:64`); here ≈ 0.5 m. From the other window he is hidden by the
  reveal. `booth_light_fail` dims to 0.45 pulsing red (`booth.ts:199-203`) at the close-up.
- **H10** Door to deck ≈ 12.3 m: door (−8.4, −43), stair foot (1.0, −44.5), deck (3.7, −44.5). At 0.95 m/s 13 s,
  at 1.3 m/s 9.5 s. Three abreast at ±0.62 (`script.ts:1146-1148`) do not fit the 1.6 m door or 2.1 m stair gap.
  `moveTo` has no pathfinding. Units entering at (−10, −43) reach the north window mark before Tomas unless he
  starts at `d2_booth`, around (−16.3, −46).
- **H11** Lay-down wait can look frozen ≤ 5 s. A player in the `d2_booth` doorway (x −17) is outside `t2_booth`.
- **H12** First talk ≈ 70 s; unlocking `d2_fitting` at its end fails the impatient player. `cp2_hall` is invalid
  once met (`script.ts:525`) so a death replays the talk.
- **H13** Glass-hit / ghost-shot reactions need the ray, not the impact (actors are outside hitscan).

## Lines that still assume an order or state

| Line | Problem | Needs |
|---|---|---|
| `l2_choir_power_2` "Line Control is open" | Doors show CYCLING | Rewrite |
| `l2_tomas_power_1` "Door's green!" | Same | Rewrite |
| `l2_tomas_run_1` "Two of them in the spine" | Units now come through the hall door, after the trap | Rewrite; dawdle lines must not claim units the player can disprove |
| `l2_tomas_run_wait` | Same | Rewrite or cut |
| `l2_tomas_run_glass` | Glass unreachable in phase D | Cut |
| `l2_tomas_run_2` (chair against the door) | `booth_chair` sits at the console | Move the prop or cut |
| `l2_tomas_run_5`, `l2_unit14_booth` | Unit 14 no longer in the scene | Cut |
| `l2_tomas_window_1` "you made it" | Player may not be at a window | Only within 4 m of a window with line of sight; else variant |
| `l2_tomas_window_2`, `_5` | Assume he is already held | Only after `held` |
| `l2_tomas_window_3` "Don't shoot the glass" | Player may already have shot | Skip if shot |
| `l2_tomas_window_4` (mum) | Setup `l2_tomas_mum` skippable (`script.ts:917-924`) | Only if setup played; else variant |
| `l2_tomas_window_6`, `l2_unit32_die` (coffee, biscuit) | Setup `l2_tomas_coffee_1` skippable | Same |
| `l2_unit32_3`, `l2_unit32_5` | Setups `run_3`, `cross_wave` conditional | Same |
| `l2_tomas_rig_1` "the empty rig" | A hologram now walks on it | Rewrite |
| `l2_tomas_unit14`, `_unit14_off` | Describe a real unit stepping off a treadmill | Rewrite for a projection |
| `l2_tomas_bark_unit14` "again" | Assumes an earlier mention | Variant |
| `l2_tomas_pass_taken` "…oh no" | Assumes alcove units wake | Variant |
| `l2_tomas_bark_provoked` "I said don't" | Stealth line may never have been said | Replace |
| `l2_tomas_bark_spine_dead` "too" | Assumes an earlier dead door | Variant |
| `l2_tomas_treadmills`, `_sync`, `_stealth_*` | Need `g2_fit_tread` alive and calm | Condition |
| `l2_choir_belt` vs the new nudge | Contradict each other | Keep one |
| `l2_choir_core_7`, `_11`, `l2_choir_shutdown_2` ("thirty-two … still here") | False if the player killed units | Count-aware variant |
| `l2_unit14_wait` | Okafor's voice even when Unit 14 is dead (`script.ts:1437`) | Different speaker |
| `l2_tomas_hall_after` | Assumes the player killed them | Only if cleared by the player |
| `l2_tomas_handset` | "take the handset" with no action | Intercom press takes it |

Conditions must be evaluated when the line starts playing, inside `Dialogue` (lines queue,
`src/story/l2/dialogue.ts`), not before `say()` — add `SayOpts.when`.

## Enemy presence
- `g2_foreman` + its two husks exist from load (`hall.ts:26`, `line.ts:772`); spur hooks are static geometry.
- Any shot in the fitting bay provokes the three treadmill workers (within 14 m, `manager.ts:108-112`): the pass
  fight can be five husks.
- `g2_unit32` spawns at z −62.9 (`hall.ts:35`), outside the tunnel (ends −62): move to ≈ (5, 0.55, −60.5).
- `g2_spine` to delete (`spine.ts:111-112`, `script.ts:1058`).

## Mismatches with the built level
- **Open door leaves slide into windows.** `d2_booth` leaves reach z −47.64 and −44.36; spine windows start at
  −47.3 and −44.7 (`booth.ts:28-30`, `spine.ts:30`). `d2_booth_hall` south leaf reaches z −44.64, through the
  mullion at −44.2 into the pane from −44.15 (`hall.ts:17,108,174-176`). Likely the "hanging bolts".
- `booth_light_fail` fires at `l2_power` (`script.ts:996,360`).
- Door status has only locked/open screens (`doors.ts:70,124`).
- The fitting door's "blue light" is an always-on lamp in group `line` (`hall.ts:328`).
- The gate is a private closure driven by `l2_line` (`line.ts:42-48,685-730`).
- Only the player is carried by the belt (`line.ts:58-64`); Tomas is moved by hand (`script.ts:1198`).
- Hand-placed nav nodes at x 8.65 cross the east fence (`hall.ts:29`).
- `t2_belt` includes 1.5 m of belt tail on the apron side (`index.ts:69`).

## Checks
- `check:reach`: use the real physics capsule and real phase state; stress run with +0.6 m (wreck boxes); model
  one-way edges; assert each phase's goal is reachable from each checkpoint. Cannot catch timing cases.
- `check:doors`: triangle-level, expand InstancedMesh; rules: leaf pocket at t = 1 free of static geometry, wall
  openings and glass; open leaf fully inside solid wall; no static triangles within 3 cm of the closed leaf.
  Also shutters, gate, presses, arms.
- `check:zfight`: 2 mm is too tight — camera near 0.05 (`src/main.ts:40`) gives ≈ 1 mm depth resolution at 30 m,
  2.7 mm at 48 m. Use a distance-aware threshold (~3× resolution at the room's longest view); also back-to-back
  double-sided materials; exact duplicate triangles; instances; both door states.
- Impatient playthrough: oracles computed test-side from world state, not the story's own predicate.

## Smaller
- Banging loop stops after 40 hits (`script.ts:715`). South-hall pickups can be taken early. Medkit in the booth
  before the forced tunnel. `scripts/playthrough.mjs --level2` must follow the new flow.
