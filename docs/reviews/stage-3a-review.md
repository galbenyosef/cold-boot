# Review of the stage 3a plan (`docs/plans/stage-3a.md`) — reviewer subagent, static read of the code

Line numbers are from the working tree at review time (other agents are editing `src/`; they may shift).
"§" = section of the plan. Coordinates: plan conventions (−Z forward, yaw 0 = −z, `?spawn` yaw in degrees).

## Blockers

- **B1 Halvorsen can be shot through the open office door in phase E.** `d3_office` is `auto` in E (§3). The safe flag
  comes from `roomAt` (§8.3), which is x/z only and first-match (`level/assemble.ts:162-167`); office is z −28…−20,
  admin z −20…−2, so the player is "admin" (weapon raised in 0.34 s) from z > −20, but `t3_office_out` only starts at
  z −19.4 (§3). In the 0.5 m band z −20…−19.4 the door stays open, nothing latches, and Halvorsen sits 6 m away at H2.
  Human actors have hit volumes only for the R2 warning (`enemies/human/human.ts:133-135`, `enemies/manager.ts:181-183`):
  bullets pass through him, nothing reacts. He also has no collider: the player can walk round the desk
  (x −34…−31.4 / −28.6…−26 are open) and through his body.
  Fix: in phase E the weapon is stowed everywhere (safe = office **or** phase E; there are no hostiles in E) and is
  raised only when `closeBehind('d3_office')` returns true. Give Halvorsen a dynamic box (seated footprint + chair)
  and a desk-to-wall blocker so the player cannot reach his side of the desk.

- **B2 Deck 2 does not exist in the level API.** Only nav and trigger y are planned (§8.9, §8.10). Also needed:
  - `LevelBuild.room()` makes bounds y −0.5…h and a probe at y 1.6 (`level/context.ts:189-193`). Every room is a
    region (`assemble.ts:147`) and `check-reach` tests regions in 3-D at feet + 0.9 (`scripts/check-reach.mjs:161-164`).
    A Deck-2 room (`lock`, `gallery_n`, `lobby`, `admin`, `office`, `bio_lock`) built that way is y −0.5…3.4: forbidding
    it always passes and requiring it as a goal always fails. Its reflection probe sits in the void under the deck.
  - Door frames are built at y 0 (`level/doors.ts:284` `b.push(sp.x, 0, sp.z, ry)`), while leaves, blockers and the
    prompt use `y0` (`doors.ts:90-91,123,190`). `y0` is a sill height (belt shutters), not a floor.
  - The enemy auto-open test has no lower bound (`doors.ts:247` `e.position.y < this.y0 + 3.2`). A husk in the colonnade
    under the balcony (y 0, within 2.4 m of (12, −38)) opens `d3_bio` while it is `auto` (phase I).
  - `buildCab` has no floor y (`level/rooms/elevator.ts:44-52`). Lift3 floor is 4.8.
  Fix: one level-infrastructure task before T12. `room(…, { y0 })` gives bounds y0−0.5…y0+h and a probe at y0+1.6;
  `DoorSpec.y` is the floor (frame + sill) and `y0` stays the sill; the enemy-near test checks
  `|e.y − floor| < 2`; the cab takes a y offset. `check-reach` asserts that every room region contains its own floor.

- **B3 The feed dioramas are below the physics safety net.** `moveBody` teleports any body below y −30 to y 2 at the same
  x/z (`physics/physics.ts:197`). Husk actors walk through `moveBody` (`enemies/husk/husk.ts:546,554`). The 16 Line Two
  and rack puppets at y −40 (D10, §2.1) would pop up at (60…72, 2, …) on the first frame.
  Fix: build `feed_l2` / `feed_racks` at y 0 (x ≥ 60 overlaps no room in x/z, and no portal reaches it), or at y −20.

- **B4 The feed pass as sketched shows no actors and lights them wrongly** (§8.4).
  - Visibility is decided in three places, all from the main camera:
    - the level's tagged rooms (`assemble.ts:93-113`);
    - the render module's `occludeForeign` (`render/index.ts:100-121`);
    - the enemies module's `cullOne` (`enemies/manager.ts:200-218`).
    All three use `roomVisible` (`assemble.ts:85-92`). `Level.withRooms` would cover only the first, so the gallery
    puppets and the diorama units stay hidden in the feed.
  - `lights.update` mutates pool slots, fades and hysteresis (`render/lights.ts:342-530`). Scoring the pool again for a
    feed camera and then "restoring" it is not possible without a second code path, and a moved shadow slot draws a
    stale map.
  - The renderer has `NoToneMapping` and tone-maps at the end of the post chain (`render/index.ts:64`), so the feed's
    render target is linear HDR.
  - CAM 01 framed with the gallery glazing in view must also draw the atrium (~300 calls + leaves) at 12 Hz.
  Fix (smallest):
  - `render.feed` sets one visibility override (a set of room ids) that `roomVisible`, the tagged-room pass and
    `cullOne` all honour while it renders.
  - No new scoring. During C2 the feed rooms' bounded lights carry a `pin` flag that keeps them in the main pool
    (the office uses 3 descriptors). None of them cast shadows.
  - The `feed` screen shader applies ACES and sRGB.
  - CAM 01 sits at about (9, 7.5, −11.5) looking north-west at `d3_pressure`, with the glazing behind it, so only
    `gallery_n` and `lock` are drawn.
  - Build this as a spike first (§ Build order).

- **B5 The stage end hands off to a level that does not exist.** D18 and §7 carry out to level 4; `createLevel` is
  `{1, 2, 3}` (§8.1); `LevelId` 1…6 lets `?level=4` parse; `storedLevel()` today returns 1 or 2 only
  (`core/progress.ts:10`). A finished 3a would reload into nothing.
  Fix: `LEVELS[3].next = null` until 3b is built. The level-3 end writes the carry and shows a short end card
  (TO BE CONTINUED) and the menu. `handOff` does nothing when `next` is null. `resolveLevel` clamps to built levels.

- **B6 The riser can shut the player in.** `d3_admin_svc` opens for the promote and "locks 3 s after both are out
  (or 10 s)" (§5.2). The riser is a 2 × 3.2 m dead end (§2.1) on the player's route, 13 m from the office door. Nothing
  stops the player stepping in, and `check-reach` snaps phase F with the door locked, so it cannot see this.
  Fix: lock it only through `closeBehind('d3_admin_svc', () => player outside riser)`. If the player is inside, leave
  it `auto` and retry. Or never lock it: the riser is empty once they are out.

## Holes

- **H1 `g3_breach` appears in plain view.** The spawn points (8…11, 4.8, −9.6) are in the gallery, behind the full-height
  glazing that faces the garden (§2.1, §2.8). `l3_breach` fires on the first `t3_garden`, i.e. as the player steps
  out of the canteen glass front looking east/north-east, where the empty gallery is visible through two layers of
  glass (the gallery is empty from C2 to G).
  Fix: at the takeover, `d3_pressure` shuts and locks again (`SECTOR SEALED`). `g3_breach` spawns inside the lock
  (no windows). At `l3_breach` the pressure door opens (2.6 s, a visible and audible event that matches CAM 01) and
  then the shutter opens. Add an automated spawn-visibility assertion (Checks).

- **H2 Jump height is 1.7 m, not 1.0.** Crouching in the air lifts the feet by `height − crouchHeight` = 0.7 m
  (`player/controller.ts:115-119`), and `check-reach` models it (`check-reach.mjs:92-93`). The balcony balustrade
  collider (1.45 m, §2.8) is crossable from the deck, and from a desk the admin glass partitions (1.8 m) are too.
  Nothing is lost: every phase that has the balcony also allows the garden. But the claim "jump 1.0 cannot clear it"
  is false, and the §10.3 remedy (an invisible collider to 2.2 m along the whole balcony edge) would stop the
  player's bullets from the garden at husks on the balcony (bullets ray-test colliders).
  Fix: drop the 2.2 m extension. State which barriers are containment (only the full-height ones). Add 1.7 m as the
  rule for any barrier that must hold.

- **H3 Gantry spawns do not work.**
  - Breach-2 uses the husk `drop` emerge, which starts at landing + 4 m (`husk.ts:292-297`), i.e. y 8.8: the capsule
    then spans the gantry floor at y 9.0 (the gantry sits right above the balcony, x 9…12, z −20…−28, §2.1). It is
    either pushed up onto the gantry (stranded in view: nothing removes it, because `fightOut` covers only the lock)
    or seen popping in mid-air under the gantry.
  - The sentry spawns at (0, 9.5, −30) inside the gantry's 1.4 m mesh sides. Its hover height comes from the ground
    under it (`sentry/sentry.ts:215`), which is the gantry. If the mesh has a collider it shields the sentry, and
    `cp3_balcony` needs `g3_garden` dead (§7).
  Fix:
  - Cut a drop hatch in the gantry floor above each breach-2 point and start the drop with the feet above the gantry
    deck (+4.4).
  - The sentry docks under the lamp grid (a ceiling cradle, y ≈ 12), boots and descends into open air.
  - The gantry mesh gets no bullet collider. Or the sentry is not needed for `cp3_balcony`.

- **H4 Three doors do not fit their walls** (`check:doors` will fail).
  - `d3_shutter_ne`: a `std` door slides each leaf w/2 + 0.02 = 1.52 m sideways (`doors.ts:199-205`). The west leaf
    goes into the gallery glazing (which ends at x 9). The east leaf goes past the gallery's east wall (x 12) into
    empty space. The clear opening is about 2.8 m (east wall face at 11.8), not 3.0.
    Fix: glazing x −12…6, solid wall x 6…9 as the pocket, opening 2.6 m.
  - `d3_canteen_atr`: `wide` in code is a vertical blast door (`doors.ts:4,208-214`), not glass sliding. As `std` with
    w 3.0 each leaf needs 1.52 m of pocket; the planned piers are 0.8 m (§2.2), so the leaves end inside the glass
    front. Fix: `std` w 2.4 with 1.3 m piers each side.
  - `d3_stair_w` (−20, −19): the clear wall between the admin/office wall (z −20, face −19.8) and the stair's north wall
    (z −18, face −18.2) is exactly 1.6 m, the leaf width, with no room for jambs. Fix: run the top landing z −22…−16
    (the lobby starts at −14) and put the door at z −18.5.

- **H5 The light budget is not met on low or medium** (§2.5). The "worst spot" view has 14 points (atrium 5 +
  gallery 3 + lobby 2 + canteen 4). The pools are low 6 / medium 8 / high 10 points and low 2 / medium 3 shadow slots
  (`render/quality.ts:31-46`). Shadow requests at the breach are atrium 2 + lock 1 + sentry 1 = 4.
  Fix: merge the canteen and lobby lights into one descriptor each when seen from the atrium (lower priority), or
  bound them so they are not scored from the gallery. Set a per-quality cap. Measure on `low` too (§10.6 measures
  high only). The draw-call budget (§2.6) counts no shadow passes: the two atrium casters redraw the garden twice.

- **H6 C2 hands control back with a 180° whip-pan, after ~57 s without control.**
  - O7 ends looking at the badge at −z (§4.3, 39–41 s).
  - The placement is yaw π (+z, the door), reached in 0.5 s.
  - C1 13 s + 2.6 s black + C2 41 s = 56.6 s uninterrupted, against "short and smooth".
  Fix:
  - Place at yaw ≈ 0.25 (facing the desk), blend 0.8 s; the player turns to the door.
  - Trim C2 to ≤ 30 s: O1 one line (4 s); O4 one Line Two feed (5 s, racks dropped or shown on a thumb); O7 two lines
    + Reyes (8 s).

- **H7 Cutscene eyelines are off.** Human `auto` attention aims at `player.eye` (contract `core/types.ts:844-850`), but
  the cutscene camera is not the player's eye. In C1 the body stays wherever it entered the trigger
  (x −20…−18.4, z −10.6…−7.4) while the camera sits at (−18.7, 6.45, −9); in C2 the body's eye is 6.45 and the seated
  camera is 6.0, which is 8° at 3.1 m. Fix: while a cutscene runs, human actors are pinned to the camera object
  (`lookAt(ctx.camera)`). C1 also snaps the body to (−18.7, 4.8, −9) at t 0 under the 0.35 s blend.

- **H8 The C2 puppets walk through a closed door.**
  - `d3_pressure` opens from 7.6 s over 2.6 s (`wide` leaves, `doors.ts:208`). At 8.4 s it is 22 % open (≈ 0.6 m gap),
    yet the three units "come out" at 8.4 s (§4.3).
  - The riser puppets "step into the riser from its far end" on a live CAM 22 feed (11.4 s): the riser is a closet
    (x −36…−34), so they would appear from nothing.
  Fix: the units start at 10.3 s. The riser gets a floor hatch or ladder head they climb out of, outside the CAM 22
  frustum.

- **H9 Spawn and door data are missing.**
  - No trigger table: `t3_garden`, `t3_canteen` and `t3_pdoor` have no coordinates, and the cause of `l3_release` is
    not stated (timer? trigger?).
  - The kitchen door at (−22, 0, −46) and the "second hatch" at (−14.5, −37.5) are not in §2.2 or §2.8.
  - Canteen husk B spawns at (−22, −45.6), inside the counter band z −46…−43 (§2.1 canteen), with no gap or nav out.
  - No proximity rule for B if the player stands at the kitchen door.
  Fix: add the triggers to §2 with x/z/y; add `d3_kitchen` (std, `locked`, script-only) and the hatch; leave a 1.2 m
  aisle behind the counter with a gap at its west end; spawn B only when the player is more than 3 m away from it.

- **H10 The clock contradicts the countdown.** D4 fixes arrival at 21:40, but D25 makes the remaining time depend on
  `facts.elapsed`. The test started Mon 08:40 (`note3_schedule`), and 61 h later is Wed 21:40, which is when Reyes
  wakes (`story/text.ts:34` 61 h 04 m). Arrival is therefore 21:40 + elapsed: 22:40 with the debug default.
  `lobby_status` "21:40 + t" and `term3_lobby` "LAST REPORT 60:00 / NEXT 66:00" are both wrong once elapsed is
  over 5 h.
  Fix: one source, `testHour = 61 + elapsed/3600 + t/3600`. The clock is Wed 21:40 + that offset; the report lines are
  derived from `floor(testHour / 6)`. A later arrival (22:40+) also makes "everyone is in their cabins" more plausible.

- **H11 `fightOut` cannot do "members inside bio_lock".** It is per group and removes the whole group
  (`story/l2/base.ts:343-357`). Fix: add `fightOutWhere(pred, stranded)`, a predicate over `enemies.all`
  (inside the lock's box). Inside a 4 × 4 lock `engaged()` (within 9 m) is always true, so the 60 s removal never
  fires there, which is correct.

- **H12 `bio_reader` before the badge.** The plan says both "NOT usable in C" (§3) and that it answers with a denial
  in C (§5.4). `check-reach` cannot assert "not usable" for something outside a forbidden region
  (`check-reach.mjs:202-208`). Fix: it is usable and denies in C; drop it from the "NOT usable" list.

- **H13 Resident doors under fire.** A living person is behind `d3_q3`. Shooting the door gets no reaction, and the
  resident lines then play as if nothing happened (R2/R3 for people). Fix: a hit on `d3_q*` within 3 s → that door
  goes silent for good (or a scream variant once); `resident_1/2` require no shot at `d3_q3` in this level.

- **H14 Phase S2 snaps doors with the player's capsule in the doorway.** The black (§4.2) snaps `d3_lobby_inner` shut
  and only then teleports the player. If the player stands in the doorway, the snap sets t = 0 with the blocker
  inside them (`doors.ts:148-153`). The visitor chair at the seat (−30, 4.8, −22.9) will also overlap the teleported
  capsule. Fix: teleport first, then snap; no collider on the visitor chair.

## Lines / texts that assume order or state

| Line / text | Problem | Needs |
|---|---|---|
| `l3_choir_glass` "…Technician." | Single line; after COMMAND CHOIR says "Supervisor" everywhere else | `_stop` / `_command` pair |
| `l3_choir_breach_*` "These are not Line Two…" (U at +2 s) | With H1 (or as planned, from the canteen door) the units may not be in view at +2 s; "These" is deictic | Condition: a `g3_breach` member in view, else wait ≤ 6 s; else a variant without "These" |
| `l3_halv_c2_8` "You've got the gun." | c1_2 has an unarmed variant, c2_8 does not | Same `currentWeapon` variant, or guarantee a weapon at C1 (assert) |
| `l3_halv_c1_1` startled, holding a mug | The player may have fired in the habitat seconds before; he stood 1 m behind the door | Variant if `weapon:fired` within 60 s in phase C ("Was that you? Was that a—") |
| `l3_choir_end_*` "Nobody in Biological will stop you." | 3b is units and fights (REVISION 7); reads as a lie the player disproves at once | "Nobody in Biological is alive to stop you." or cut |
| `l3_resident_2` "If you're facilities, please open it." | The player holds the facilities badge; the cabin door only says locked | `d3_q*` with badge → panel `SECTOR SEALED — PRESSURE ALARM` + `l3_unit_sector`; the line stays |
| `l3_halv_go_1` "…in this corridor." | Admin is open-plan (§2.1) | "…before they're out there." |
| `l3_choir_canteen_*` | No "once"; may repeat on every re-entry | Once |
| `term3_lobby` "ALL 32 SAFE" + D14 "31 staff + 1" | Canon already disagrees: intro "31 STAFF" (`story/text.ts:239`), intake RECEIVED 31 + PENDING Reyes (`story/l2/text.ts:27-30`), Tomas = 32 (`l2/text.ts:80`), "32 OF 32" (`:60`). The "+1" is unexplained | Pick the habitat's believed headcount and write it in the plan; or report "ALL STAFF SAFE" with no number |
| `note3_canteen` "FAB TRAYS (31, three a day)" | The fab has its own canteen (`story/text.ts:39` "CANTEEN — back of a menu card") | "FAB GALLEY RESUPPLY — CANCELLED BY CHOIR" |
| `note3_clinic_post4` "neck stiffness … readiness programme" | Two of 3b's reveal words in one sheet (REVISION 7 3b: "cervical … naval readiness programme") | Keep one: "poor sleep, one says humming; refer to Bio-Sys" |
| `l3_reyes_murmur` with `door` fx | We are Reyes, in the room; a through-the-wall filter is the wrong point of hearing | `room` fx, ducked under the black |
| `l3_halv_c1_2` "glance down at the player's hands" | The viewmodel is hidden in scenes (§4.1, §8.2): he looks at a gun the player is not shown holding | Keep the weapon visible and lowered in C1 |
| `lobby_status` / `term3_lobby` / `pdoor_panel` times | See H10 | One clock |

## Mismatches with the code

- `TriggerSpec` lives in `level/triggers.ts:4`, not in the contract (T3 lists it under `core/types.ts`). The y gate is
  hard-coded `p.y > −1 && p.y < 4` (`triggers.ts:31`). Every Deck-2 trigger needs y0/y1.
- Nav: nodes are created at y 0 (`level/nav.ts:47`); obstacles are only colliders with y 0.2…1.5
  (`level/context.ts:169`), so Deck-2 furniture is not an obstacle at all; door portal nodes are x/z only
  (`assemble.ts:58`). The enemy side already uses y in places (`enemies/nav.ts:56,75`; `enemies/ai.ts:298` direct
  chase needs |dy| < 1.2). A ramp collider as an obstacle AABB blocks every garden node under the stair; standing
  capsules on a 28° slope get a downhill push-out component (`physics.ts:170-193`), so test idle drift on stairs.
- Binary level branches the §8.1 list misses:
  - `materials/index.ts:123`, `enemies/dev/harness.ts:46`, `ui/progress.ts:56,72,99`;
  - `core/progress.ts:10` (`=== '2' ? 2 : 1`), `story/save.ts:238-244` (`saveInfo`), `core/debug.ts:36` (`level` parse);
  - `enemies/index.ts:39-42` gates the whole human template on level 2 (Halvorsen needs it on 3).
  The CI grep `levelId === 2` misses `(ctx.levelId ?? 1) === 2`, `!== 1`, `=== '2'` and `lvl2`.
  Grep `levelId|storedLevel|=== 2|'2'` instead.
- `Carry` / `loadCarry` validate pistol and shotgun only (`story/save.ts:206-222`); `PlayerSave.weapons` is a full
  `Record<WeaponId>` (`core/types.ts:768`), while `CarryV2.weapons` is `Partial`. Pick one; `snapshot`/`restore`
  hard-code the two ids (`player/index.ts:305-306,319`).
- `ScreenKind` maps are exhaustive `Record`s (`materials/screens.ts:34,38`): each new kind (`pressure`,
  `habitat_status`, `badge`, `feed`) must be added there, together with the 512 px canvas text path (`screens.ts:112-148`).
- Post has no LUT step. The grade is fixed in the composite shader (`render/shaders.ts:295-301`, "cold teal shadows"),
  so `grade(+0.15)` at load has to counter the built-in teal. `PostFx` (`core/types.ts:370-381`) has no `grade`.
- `CameraRig` has menu shots and the wake rig only (`story/camera.ts:30-104`); a shot sequencer is new.
  `level.update` computes room visibility from the camera pose `player.update` set (`main.ts:103-104`,
  `assemble.ts:107`), before `lateUpdate` overrides it. Rule: the player's body must be in the room the cutscene
  camera is in.
- `stats.time` counts only `playing` (`story/index.ts:200`), so `elapsed` excludes cutscenes. That is fine, but say so.
- Pickup id filter `/^p_/ : /^p2_/` (`player/pickups.ts:209`) drops nothing correctly for `p3_*` only by accident.
  Make it `mine || runtime`.
- `cast.json` per-line fx uses `fxRules` (exists, e.g. `choir`). Halvorsen's `room` / `door` split must be expressed
  that way. `FX_NAMES` (`audio/voicefx.ts:28`) needs `room`, `door`.

## Checks / tests

- `check-reach` stress (+0.6 m wreck box) only applies where `n.p.y < 0.65` (`check-reach.mjs:145`), so Deck 2 and the
  stairs are never stress-tested. Use "within 0.65 of the node's floor", with the floor taken from the room.
- B2 test: assert every room region contains a point 0.9 m above its own floor, and every Deck-2 trigger contains a
  reachable node.
- Spawn visibility (automatable): at each `spawnGroup` / `promote` / `drop`, ray-test from `player.eye` to each
  member's chest. Fail if visible and the member is not emerging from a door / hatch that opened in the last 3 s
  (H1, H3, H8). Run it in `--impatient` and `--softlock`.
- Add to `--softlock`:
  - (e) step into the riser when `d3_admin_svc` opens (B6);
  - (f) stand in the office doorway at z −19.7 for 10 s in phase E: assert no `weapon:fired`, and that the weapon is
    stowed (B1);
  - (g) stand under each breach-2 point when the purge starts.
- Feeds (B4): assert the actor `object.visible` during the feed pass (hook in `render.feed`), plus a pixel test
  (non-black, mean luminance in range) on the RT. A `shot.mjs` view of the monitor alone does not prove the units
  are drawn.
- C2 placement: assert |Δyaw| between the last shot's look and `place` is ≤ 60° (H6).
- `--skip` world-state equality must include `ctx.camera.fov` reset, pinned actor attention released, and
  `controlsEnabled`.
- Cannot be automated; must be looked at in frame sequences:
  - eyelines in C1/C2 (H7);
  - the feed image reading as CCTV of the real door;
  - the release frame;
  - Halvorsen's head at 1.8 m and 3.1 m;
  - warm → cold grade;
  - leaf cards against the lamp grid;
  - pop-ins the ray test allows (through hatches);
  - whether the BIO sign reads from the gallery (it is about 67° off-axis from mid-gallery, so likely not).
- §10.6 view (2) `spawn=-10,4.8,-9.5,140` faces north-west (yaw is degrees, 0 = −z, +90 = −x, `core/debug.ts:13`).
  South-east is `-135`.
- §8.1 `check:chain` must also cover `storedLevel = 3` + CONTINUE + BEGIN, and a v1 save present (discarded once, D20).

## Build order and risks

- **De-risk first, in this order:**
  1. **T7 feeds spike**: CAM 01 + one diorama + 3 puppets in a test scene, using the visibility override and pinned
     lights (B4). If it costs more than 1.5 ms on high, fall back to a 4 Hz feed or a canvas-composited still.
  2. The level-infrastructure task for B2.
  3. **T4 nav v2** with a greybox of the atrium, balcony and two stairs: a husk balcony → pool in < 25 s.
  4. `check:reach` on a greybox 3a (no dressing) for phases A…J.
  5. Atrium perf with stub materials and the 14 000 leaf instances on `low` and `medium`.
  Only then dressing (T8, T9, T12 props).
- **File collisions between "parallel" tasks:**
  - T5 and T6 both edit `player/index.ts` and `player/weapons.ts`;
  - T7 and T8 both edit `materials/screens.ts`;
  - T4, T7 and the B2 task edit `level/context.ts` / `assemble.ts`;
  - T1 and T3 both edit `core/types.ts` (T3 says "one commit": fold T3 into T1's last commit);
  - T10 and T1 both edit `enemies/index.ts`.
  Serialise each pair or give one owner.
- **T2 (story scaffolding move)** rewrites `story/l2/*`, which is being edited now (`git status`: `base.ts`,
  `script.ts`, `dialogue.ts`, `taking.ts`, `text.ts` modified). Start it only after those land, with
  `--level2 --checkpoints --impatient` green before and after.
- **Sizes are underestimated:**
  - T13: level 2's story is `script.ts` 1497 + `dialogue.ts` 582 + `base.ts` 602 + `taking.ts` 538 lines; 3a with
    two scenes, feeds and 40 rules is ≈ 2 000+ even with T2.
  - T15: `playthrough.mjs` is 2005 lines and level-2-specific (`LEVEL2` flag `:39`, oracle `:703-`); generalising it
    to `--level N` is L, not M.
  - T7: L, given B4.
  - T12: XL is right; add greybox → dress as two milestones.
- **Missing tasks:**
  - the B2 infrastructure;
  - the visibility override shared by level, render and enemies;
  - human actors pinned to the camera in scenes (H7);
  - Halvorsen's collider (B1);
  - the skip ring UI (ui owner; T5 says story);
  - the level-3 end card (B5);
  - `docs/ASSETS.md` licence verification as a gate before T10's head attach.
- **Voices:** T11 needs the final line texts, and this review changes ~10 of them. Freeze texts after the review
  decisions, before auditions.

## Smaller

- `note3_schedule` (−26.02, 6.2, −24.0) and `office_thumb_2` (x −26.02, z −24.0, y 6.3) are the same spot (§4.3, §6.3).
  The badge lands at (−29.8, 5.57, −23.9), on top of `note3_memo` (−29.9, 5.57, −23.95).
- `p3_admin_ammo` at (−22.6, −15.0) is 8.9 m from `d3_office` (−30, −20), not "4 m" (§5.3).
- `stair_w`'s glazed slit at x −15, z −33…−31 looks into a 3 m void: the garden starts at x −12 (§2.1, §2.4).
- From the lock (§2.7) the lamp grid at 13.2 is hidden by the gallery ceiling (8.0): the sight ray through the door top
  reaches 8.1 at z −12. The tree at (2, −38), 6–8 m tall, sits on the beacon ray (the ray is at x 0.9, y 5.95 there).
  Move that tree to x ≥ 5.
- Viewport murk "visibility 2–6 m" vs the beacon 18 m past the glass (1.5, 5.2, −62): the beacon and cable must
  ignore the fog or be drawn inside the murk volume.
- "From anywhere on the garden floor the shutter is visible" (§2.7) is false under the colonnade (x 9…12, under the
  slab). The tree at (4, −16) is 2.4 m off the canteen-door ray at y 5.3, so a canopy over 2.4 m wide occludes it.
- `d3_pressure` (`wide`): the bottom leaf sinks 1.6 m below the Deck-2 floor (`doors.ts:208`), into the void under the
  gallery. The slab must be ≥ 1.7 m deep there, or the leaf must be split differently (`check:doors` "hanging parts").
- Skip by holding Space (jump): consume the key on release so the first frame in control does not jump
  (`controller.ts:151` jump buffer).
- C2 uses fov zooms 60 → 38 inside a "first-person, seated" shot. This is a taste call; it reads as a camera, not
  eyes.
- Halvorsen `describe` "elderly" for a 58-year-old may audition too old.
- `d3_q*` panel `dark` + sign "NIGHT": `dark` sets the prompt to "No power" (`doors.ts:179`). Use a sign-only overlay
  or a new status.
- D9 (global `seen`) deviates from 7.1 ("first-view flags" carried as facts). Record it in REVISION 8.
- `l3_unit_lift_arrive` "Mind the step" echoes `l2_choir_core_1`. Good, keep it, but it is the unit voice, so D5
  holds.
