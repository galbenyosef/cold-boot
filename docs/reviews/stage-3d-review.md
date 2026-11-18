# Review of the stage 3d plan (`docs/plans/stage-3d.md`): reviewer subagent, static read of the code at e8373e2

This review was done by reading the code, with nothing run. At e8373e2 the 3c K task is merged (`src/core/types.ts` has `soldier`, `release`, `holding`, `corpsePoint`, `CoverPoint`, `RoomFloor.nav/exits`, `floorAt`); the rest of 3c is not built yet. "§" means a section of the plan. Coordinates use the plan's conventions. File:line references are to the tree at review time.

## Verdict: **build after fixes**

### What holds up (recomputed)

**Room plan**
- The 12 rooms touch only on the boundaries listed in §2.1.
- None of the non-touching pairs overlap.
- `feed6` is inside the envelope.

**Doors**
- All 8 doors have their leaf spans (± 1.62) inside both rooms' interiors.
- Their pockets keep 0.3 m or more from the side walls (`d6_he` 0.625, `d6_shaft` 0.325).
- The `d6_hold` leaf is 0.88 m from CD3.

**Shaft**
- Each flight is 10 × 0.3 / 0.4 = 3.0 / 4.0 m at 36.9°. Landings on the same half are 6 m apart, with 2.7 m clear above the bottom floor under L3.
- `d6_pool` (y −12 … −9.6) sits under L2.

**Chamber stairs**
- Each flight is 14 × 0.2857 = 4.0 m over a 5.6 m run.
- `ST6_W` / `ST6_M` and `ST6_NE` / `ST6_M2` do not overlap.
- There is 0.8 m of floor at every foot.

**Cover**
- All 75 points sit 0.55 m from the face named, with the normal pointing at the object.
- The tunnel points keep 0.1 m to the walls.
- The count is right (12 + 8 + 6 + 6 + 6 + 4 + 3 + 3 + 5 + 18 + 4).

**Spawn concealment**
- F1 soldiers: the worst ray crosses z −80 at x 5.39 / 7.84.
- F1 husks: the rays cross z −89 at x −0.82 / −0.25 / 0.56, all inside DS2.
- F2 soldier: the worst ray from (15.8, −80.2) meets RH1's north face at x 10.93 (limit 11.1).
- F6 husk: from L2 over the well rail, the ray passes y −9.3 at z −164.28, just under L3.
- All of these hold, but with 0.05–0.2 m to spare (see NOTES).

**Loader reach**
- The grab's footprint (centre x −71 … −33, ± 1.2) clears the side galleries by 0.6 m.
- The bridge travel clears the north gallery by 0.6 m and the window walk by 0.8 m.

**Slam escape**
- With the controller's real acceleration (`groundAccel` 11), a walker from rest covers 2.55 m in the 0.8 s lock and 4.17 m by impact (lock + 0.45 s drop).
- A knee-deep wader covers 2.5 m. Both clear 1.8 + 0.35.

**Damage and speech**
- TTK table: 200 / 18 → 12 hits, 278 shut, 28 open.
- Line counts: Kessler 52, Reyes 4, Aas 3, Sunde 2, CHOIR 22, UNIT 11, soldiers 6, total **100**.
- Kessler's uppercase is in only two lines, each to the end of its phrase. No `unit` line has uppercase. "Aas" is spoken only as "Oss".

**Containment arithmetic**
- §2.10 uses g = 9.8. The physics uses **−19** (`physics.ts:6`), so the jump apex comes at 0.324 s, not 0.45 s.
- Every R in that table is therefore an over-estimate. The distance rows are conservative and stand.

### What fails

Six things break when this is built and played:
- three ways into the 13.7 m well;
- one soft-lock pit in the wet dock;
- one 3c-B1-class key soft-lock;
- one ammo soft-lock at the boss restore.

A seventh problem is the physics kill-plane at y −30, which sits inside this level's world. It turns a normal W2 kill into a corpse teleported to the roof.

Most of the rest are data errors that the checks would catch late, or that W4 / ST would otherwise have to guess.

---

## BLOCKERS

### B1: The well's "real barrier" is not one: the coaming top, the ladder-exit steps and wreck boxes are steps. The containment check as specified cannot see a fall into the well.

- **Where:** D12, §2.6.9 (coaming 0.8 + rail 1.1; ladder gates; "a 3-rung step down the coaming's outer face"), §2.10, §3 `stressFloors`, §10.2.

**Why it fails**
1. **The coaming top is a ledge.**
   - It is 0.4 m wide and 0.8 m above the dock. A plain jump (1.0 m) lands on it.
   - The plan does not say the rail is flush with the outer face. With the rail on the coaming's centre or inner edge, a capsule can stand on the outer ledge. The capsule grounds on an edge while its centre is within r·sin60° ≈ 0.30 m of it.
   - From that ledge the rail top is **1.1 m** up, and a crouch-jump clears 1.7 m. Over it and down into the well.
2. **The ladder-exit steps defeat the coaming.**
   - The "3-rung step down the coaming's outer face" at `mk6_lw_exit` / `mk6_le_exit` is a stair onto the coaming top, right at the ladder gate.
   - The gate is "the rail" when closed, so it is 1.1 m above the top rung. Same result as point 1.
3. **Wreck boxes are steps.**
   - A dead husk's box is 0.36–0.44 m high and walkable (`husk.ts:1476`; `manager.ts:260`).
   - W2 husks die on the dock beside the coaming, which is where they climb out.
   - On one, the barrier is 1.46–1.54 m < 1.7.
   - The 2.0 m mid-deck bar guard drops to 1.56 m on a corpse. A sprint-jump from a corpse on the mid deck at the bar guard's x −58 … −55 / −49 … −46 sections clears the bar at its apex (feet −13.86 vs −14.0) and then falls 0.68 s × 6 m/s = 4.1 m. That takes it from z −166 to z ≈ −170.1, past the coaming's inner face (−170) and into the well.
4. **`check:reach` already models this, and the plan's design fails it.**
   - Its stress pass jumps from +0.6 m (a wreck box) on every flat floor node (`check-reach.mjs:160-185`).
   - Containment there needs 1.7 + 0.6 = **2.3 m**. The plan has 1.9 m (dock) and 2.0 m (bar guard).
5. **The check is blind to the failure.**
   - `simulate()` returns `{ end: null }` as soon as the body is below **y −5** (`check-reach.mjs:127`).
   - Every pool6 / shaft6 floor (−6 … −21.3) is below −5, so as written the K phase reaches nothing in the chamber.
   - A jump into the well ends at no grounded node. The region test only looks at end nodes (`regionsAt(node)`), so `deep` is never "touched" even when it is entered.
   - The plan's own probe ("standable samples above y −18.6") excludes the coaming top (−19.2), the rungs and the dock with a corpse on it. That is exactly where the holes are.

**Fix (§2.6.9, §2.10, §10.2, D12)**
- **Barrier heights.**
  - Rail → a **1.6 m vertical-bar guard (move-only) flush with the coaming's outer face**, with no horizontal mid-rail: 0.8 + 1.6 = **2.4 m** above the dock and 3.2 m above the wet floor.
  - Ladder gates at the same height. The exit rungs visual only, with no collider.
  - Mid-deck bar guard **2.4 m**.
  - Rule in §0 conventions: "containment = 2.35 m above any floor where a wreck can lie; 1.75 m only where no body can lie (a ledge < 0.6 m wide)".
- **`check:reach` (W4).**
  - Replace the y −5 cut-off with the level's envelope minimum (`GreyGrid` y −36).
  - Test hazard regions **on every simulated step**, not only on end nodes.
  - Make `deep` a `hazard` that fails on any sample inside it.
  - Drop the "above y −18.6" limit: probe every standable surface, including the coaming and rungs if they stay standable.
- **Optional second layer (W3b, `manager.ts`).** A `level.noWreck` box list (1.0 m band round the coaming and along the bar guard) where no wreck box is registered. This is the same mechanism as the doorway exclusion at `manager.ts:250-256`.

### B2: The moving loader is a lift. The grab top and carried containers can carry the player over the well.

- **Where:** §5.6.2, §5.6.4 (SHIFT carries a container "the player is using"; the grab sits 2.4 s on a deck, then rises), §2.10 ("container top in a slot" rows), §8.1 `CargoHandle.box: DynamicBox`.
- **Why it fails:**
  - A `DynamicBox` marked `walkable` lifts a body onto its top when the step is ≤ 0.55 m (`physics.ts:159-163`). A moving walkable box therefore carries a standing body up with it a few cm per frame.
  - The plan lists container tops as "standable" (§2.10). A player who drops onto a container from a gallery (5.4 m) stays within 3 m of its slot, which triggers SHIFT.
  - SHIFT lifts 4 m and carries at 1.6 m/s. The path sl6_2 → sl6_4 runs straight across the well at z −175.2.
  - If he steps off, he goes into the well.
  - The grab on a deck (1.6 m tall; crouch-jump reaches 1.7) is the same: after a mid-deck slam at x ≈ −62 it rises with him, and the plan does not say whether it has a collider at all.
  - None of this is in the §2.10 table or the jump-arc probe, which only covers static container tops in slots.
- **Fix:**
  - Containers and the grab are **non-walkable** `DynamicBox`es.
    - With the physics as built, a capsule cannot rest on a non-walkable box: it is pushed out horizontally (`physics.ts:154-176`).
    - The grab gets a box only while its bottom is < 2.5 m above a deck, so nobody can stand inside it.
  - The loader never lifts or rises while a body's feet are within 0.3 m above the top of what it is lifting. It waits, re-checks, and if it has to, drops the body (a 2 m/s shove off) before rising.
  - Drop the container-top rows from §2.10; replace them with "not standable".
  - `check-loader` test 6b: a bot dropped onto a container top, and onto the grab top, ends on a deck within 0.5 s.

### B3: The sluice channel is a pit with no way out under the wading rules.

- **Where:** §2.6.9 decks table (channel x −62.4 … −41.6, z −184.0 … −182.4 at y −21.3; flat floor −20.8; ramps from −20.0 to −20.8), D13 (0.7–1.25 m: no jump).
- **Why it fails:**
  - The channel is 0.5 m lower than the flat floor on its south side and at both ends, where the ramps end at −20.8. Its north side is the coaming.
  - Static geometry has no step-up. A capsule (r 0.35) is pushed back horizontally by a 0.5 m vertical face (`resolveSegment`).
  - D13 forbids jumping at d ≥ 0.7, and the channel is 1.0 m deep. A player who steps or is knocked into it cannot get out.
  - Nothing catches it:
    - `check:reach` floods forward only and jumps regardless of wading, which is a player rule, not physics.
    - `check:water` tests speeds only.
- **Fix:**
  - Give the channel a sloped south side (z −184.0 → −185.5, −21.3 → −20.8, about 18°), or ramps at both ends.
  - Add to `check:water`: "from every water cell, a bot under the wading caps walks out to dry floor in ≤ 10 s".

### B4: Key A spent, then a checkpoint, then a death: a soft-lock (the 3c B1 class).

- **Where:** §4.6 `vault6_lock` (`removeKey('key6_a')`, vignette `bj6_open`); §7 `cp6_manual` row ("Key A in keys", "enclosure shut"); §7 `ProgressL6` flags (no enclosure flag).
- **Why it fails:**
  - `cp6_manual` is due when F4 is dead. F4 spawns at manual + 4 s and takes about 8 s (husks) to 19 s (soldier) to arrive.
  - The crank → lock walk is about 25 m (7 s), so a player can insert Key A **before** F4 dies.
  - The calm save then writes keys = [] (Key A trapped) and `manual` true. There is no flag saying the enclosure is open.
  - If he dies before the pull, the load restores no Key A and, by the §7 row, a shut enclosure. "Insert key A" refuses for good.
- **Fix:**
  - Add flag `bjOpen`, set in the same action as `removeKey('key6_a')`. `afterReplay` runs `bj6_open:snap` and enables `vault6_loom` from it.
  - Rewrite §7's restore column **by flags, not by checkpoint id**: "every flag's world consequence is replayed".
  - `cp6_manual` valid only while `!bjOpen && !pulled`, so a later save wins.
  - `--checkpoints` case: crank → insert A → kill F4 (cp) → die → load → loom usable.

### B5: A boss restore can leave the player with no ammunition and an unkillable wave.

- **Where:** D21 / §5.6.9 (health floored at 60; nothing about ammo), §5.3, §9 #28.
- **Why it fails:**
  - `PlayerSave` stores ammo and the **collected pickups** (`types.ts:1207-1215`). `restore` removes those pickups (`types.ts:1190`).
  - There is no melee. Husks drop nothing.
  - Take a player who spends the arena's lockers before milestone n and has, say, 5 rounds at `cp6_m<n>`. After a death the latest wave re-spawns fresh. If that is W2 (4 husks), he is restored with 5 rounds, no pickups left and no drops coming. He cannot finish.
  - The `--dry` test starts from a full arena once, so it never meets this case.
- **Fix:**
  - On every boss restore, top the carbine (or the best owned weapon) to **≥ 90 reserve** and refill `p6_ge_*` / `p6_gw_*`. They become restocking "dock ammo lockers": a fiction-neutral fire point, re-armed per milestone.
  - `--checkpoints` case: reach m2 with 0 reserve and every arena pickup taken, die, load, finish.

### B6: The physics kill-plane at y −30 is inside this level. W2 corpses and anything that falls into the well get teleported to the roof.

- **Where:** `physics.ts:217` (`if (body.position.y < -30) { body.position.y = 2; … }`); §2.6.9 (sea gate at y −34); §5.1 W2 spawns at y −23.2 / −25.6; §8.3 drown fail-safe; §8.4 climb.
- **Why it fails:**
  - Water is `rayOnly`, so bodies fall straight through it.
  - Husks shot on the ladder ("shootable from the moment its head clears the water") die through `tickDying`, which calls `moveBody` for 1.6 s (`husk.ts:1443`).
  - From y −23 at g 19 such a body passes y −30 in 0.86 s and is set to y = 2, the plane of pool6's roof. It is a corpse in the roof slab, or one that drops 22 m onto the dock.
  - A W2 husk whose climb is not fully kinematic does the same at spawn.
  - The player's own fail-safe cannot run either. It needs 1.5 s under water, and he passes y −30 about 1 s after entering at −20.3.
- **Fix:**
  - **K:** a per-level kill-plane (`physics.setKillY(envelope.min.y)`, −36 here, unchanged elsewhere). Owner K; test in `check-physics`.
  - **W3c:**
    - A body that dies or spawns in `deep` water sinks at 0.6 m/s with no `moveBody` and is removed when it reaches y −26.
    - A climber is kinematic from spawn to `exit`.
    - No wreck box is made in water deeper than 0.6 m.
  - **W1:** in water deeper than `stand`, the player is held (vertical speed clamped to −0.5 m/s), and see Decision 2.

---

## SHOULD-FIX

### S1: Geometry and data errors (each would fail `selfTest`, a check, or play)

- **a. `mk6_he_s` (12.0, 0, −164.0) is on R1's north face line** (R1 x 5 … 15, z −164.6 … −164.0). The soldier's capsule overlaps the rack. Move it to (12.0, 0, −162.0).
- **b. Pickups the player cannot take.** Auto kinds (ammo, medkit, plate) are taken only with feet within 1.0 m horizontally, the item centre −0.6 … 1.4 m above the feet, and a clear chest ray (feet + 0.9) to within 0.4 m of the item (`pickups.ts:294-301`). The §5.2 "stand ≤ 1.6 m from the eye" is not the rule.
  - **Too high:**
    - `p6_tun_med`, `p6_tun_ammo`, `p6_tun_plate` (1.85 on JB);
    - `p6_tunb_ammo`, `p6_tunb_med` (2.0 on RH);
    - `p6_vault_plate` (1.8 on NR);
    - `p6_uc_ammo_1/2`, `p6_uc_med`, `p6_uc_plate` (1.8 on P1 / P2).
  - **Chest ray blocked** (the item is more than 0.4 m behind the face it is approached from, below the top edge):
    - `p6_rep_shells` (LC2 centre);
    - `p6_mid_ammo` (MC1 centre);
    - `p6_he_ammo_1/2` (0.5 m into the desk);
    - `p6_mid_med` is borderline (0.4 m).
  - **Effect on the arena:** the arena then holds 150 reachable carbine rounds, not 240 (see S9).
  - **Fix:** items ≤ 1.3 m above the floor and ≤ 0.3 m from a face; put §5.2 into a table of (item, surface top, distance to the face, stand point).
- **c. The 2nd W2 climber takes too long.** It starts at y −25.6: 6.4 m at 1.0 m/s + 0.8 + 0.6 = **7.8 s**, but §8.4's test says "≤ 6 s". Raise the bound to 8 s, or spawn it at −24.4.
- **d. Slot layout count.** `check-loader` 6 says "2⁶ layouts with 4 containers". It is C(6,4) = **15** layouts.
- **e. Dock nav grid over the wet dock and the well.** pool6's own floor (y0 −20) covers the whole room box, so its grid lays nodes over the wet dock and the well.
  - The §2.6.9 decks table says "minus the well … and the wet dock", but rooms take floor boxes, not holes.
  - The obstacles that remove those nodes must sit in the y −20 band (−19.8 … −18.5) **without** reaching the wet floor's band (−20.6 … −19.3; `level/nav.ts:76-88`).
  - Give the boxes (y −19.25 … −18.5 over x −66 … −38, z −194 … −182.4; and the coaming footprint), or build the dock as explicit floor boxes.
- **f. `hatch6_vault` hinge not given.** Hinged on the north edge, the open lid would stand on the exit (z −158.0). Specify the south edge, as `hatch6_he`.
- **g. Grille G1 (−12.4, 0, −170.0) is on the vault route** (d6_vault → d6_shaft, z ≈ −168 … −170). After F5 it is an open 0.8 m hole. The lifted grilles must drop shut, and their snap state must be shut. Otherwise move G1 to z −174.
- **h. `mk6_end_screen` (z −158.6) is on the desk's south edge**, but the text says the screen stands "above its north edge" (−157.8). Pick one, then recheck the 0.4 m camera move.
- **i. Shaft L0's north edge on the east half (x −24.2 … −22.2, z −168.4) is an open 3–6 m drop onto F2.** "Rails on every well edge" does not cover it. Rail it.
- **j. The enclosure leaves sweep a 1.2 m radius from their hinges.** A player at the lock off-centre (x −12.9, z −178.0) is inside the sweep, and the leaves only become colliders when open. Either the swing waits until no body is within 1.6 m of a hinge, or the leaves are movers that push.

### S2: The boss restore, as specified, contradicts itself and puts the player beside the incoming wave

- **Where:** D21, §5.6.9, §7.1, §9 #24–25.
- **The twin scheme works with the stage base:**
  - `spawnGroup` takes a pending spawn once per page (`manager.ts:288-300`).
  - A load is a fresh page (`page.ts:112-128`).
  - `fastForward` removes only `triggered ∪ cleared` (`base.ts:777-799`).
  - A twin spawned with `spawnGroup`, never `engage`, is in neither until it dies.
- **What does not:**
  - **a. Which wave comes back.** D21 says "re-spawns the **latest** wave". §7.1 says "the twin of **each** wave that was `pending` or `alive`".
    - Example: a save at pressure + 1.0 with W2 alive and W3 pending (it waits for ≤ 3 hostiles). §7.1 spawns 4 + 3 = 7 enemies, over the cap of 6.
    - Decide: **latest only**. A pending wave is re-queued **under its own rule** (W3 still waits for ≤ 3), not spawned after the grace.
  - **b. W1's twin needs the stores door.** It spawns in stores6 behind `d6_stores`, which is latched again after K_stores. §7.1 must re-apply K_stores and its latch for the twin.
  - **c. The safe marker is beside W3's door.** `mk6_boss_safe` (−30, −12, −166) is 3.8 m from `d6_pool`, and W3 (2 soldiers + 1 husk) comes through that door 3 s after the grace.
    - Use a restore point per latest wave (W3 → west gallery (−74.3, −12, −170), yaw −90).
    - Or bring the W3 twin from stores6.
  - **d. Milestone saves need `checkpointNow`.** A milestone is mid-fight, and the base's calm saver never fires there (`base.ts:719-756`). Say "written with `checkpointNow`".
    - Define the "mid-grip of another task" case: **deferred** to the grip's end (+1.0 s) if alive, not skipped. A ram killed during the 6 s pump would otherwise lose its checkpoint.
  - **e. The loader stays out of the stage base's group lists only while alive.** When it dies, `enemy:group-cleared` adds `g6_loader` to `prog.cleared`, so the next load `removeGroup`s it. That is harmless only because `loaderDead` → `removeSilently` comes first. Say so in §7.1.
  - **f. The calm override needs `EnemyManager.holding()`.** That member exists since the 3c K task (`stage-3c-k-notes.md`). The level-6 `calm()` must ignore holding F3 / patrol soldiers as level 5 does.

### S3: Cheese: the cage and the galleries let the player win by attrition, and the cage is perfectly safe once W1 is dead

- **Where:** D9, D11, §5.6.4 GUARD (park at (−52, −12.8, −163), 3 m north of the cage's opening), §5.6.5 (retracted ×0.1, shut pod ×0.1).
- **Why:**
  - W2 and W3 only come at the pin and the pressure. After W1 (2 soldiers) is dead, a player standing in the cage touching nothing faces nothing: no slam, no wave.
  - GUARD parks the grab in front of him at 3–4 m, a stationary target.
  - At ×0.1 the rams take 2 × 112 hits and the pod 28, about 250 rounds at near 100 % accuracy. The direct start carries 150; the route carries up to 180 reserve + 30, plus the arena.
  - The same works from a gallery at about 20 m. SHIFT triggers there too: the slots extend under the side galleries (sl6_1 … 4, x −74 … −72.8 / −31.2 … −30), so "within 3 m of an occupied slot" holds from the gallery, exposing the rams during the clamp.
- **Fix:**
  - Retracted rams and the shut pod are **×0**: sparks, a hard clank and the HUD pip shaking. That is R2's "different".
  - GUARD parks out of a straight line from the cage: over the dock at (−52, −8, −186) or at the far end of the bridge.
  - SHIFT's "near" is measured on the player's **deck** (same floor ± 1 m).
  - `--boss` adds "a bot in the cage with W1 dead deals 0 to the rams in 120 s".

### S4: The scare spacing rule eats the shaft beat (and F6, `cp6_shaft`) on the main route

- **Where:** §5.7 common rule (≥ 45 s since the last scare, ≥ 90 s between loud ones); #6 `v6_thud` (L) "after the pull ≥ 20 s, calm, in vault / he6 / **shaft6**"; #7 `v6_shaft_lights` (L), which also spawns F6 and adds `dark += shaft6`; `cp6_shaft` needs "F6 dead".
- **Why:**
  - On the normal route the thud fires as soon as F5 is cleared. The walk to the stair door, Key B and the descent below L1 then takes about 15–25 s.
  - So `v6_shaft_lights` fails `scareOk` (< 90 s after a loud one). F6 never spawns, the shaft never goes dark, `cp6_shaft` is never written, and §9 #23's "dies at stage 1 → `cp6_shaft`" becomes "→ `cp6_pulled`".
  - `v6_well_eyes` (after the shaft lights and F6) usually fails the 45 s rule the same way.
- **Fix:**
  - Beats that carry a fight or a checkpoint are not scares. `v6_shaft_lights` and `v6_well_eyes` are exempt from spacing; they keep only "once" and "calm".
  - Restrict the thud to vault6 / he6. Make it fire only before the Key B turn, else skip it (launchAt then = pull + 90 s).
  - `--scares` asserts the shaft beat fires on the default route.

### S5: The physics flags are underspecified: water becomes a floor for every "ground" query

- **Where:** §2.1 (K additions), §8.1 (`rayOnly`, `moveOnly`), D14.
- **Why:**
  - `Physics.build` merges every collider into one BVH, and `raycastFirst` cannot skip triangles (`physics.ts:36-73`). The flags need **two sets**: rays = solid ∪ rayOnly, moves = solid ∪ moveOnly.
  - The plan does not say which query uses which, and several existing calls use `raycast` to find the **floor**:
    - `nav.walkable(…, ground)`, the shortcut test (`enemies/nav.ts:134`). With water in the ray set, husks shortcut off the kerb into the 1.0 m channel, breaking D13's "never path into d > 0.6".
    - `ai.groundAt` (`ai.ts:468`).
    - `StageBase.groundY` (`base.ts:605`).
    - `fx` floor planes (`fx/index.ts:157`).
    - Player footsteps (`player/index.ts:177`).
    - `Controller.canStand` (an up-ray; under a move-only ceiling it would let him stand into the bars).
  - `SURFACES` in `physics.ts:5` needs `'water'`.
- **Fix (§8.1):**
  - `raycast` / `lineOfSight` use the ray set.
  - Add `physics.raycastSolid` (move set + dynamic boxes) and use it for every ground or headroom query in the list above, in W3c / W1 / W6 / ST.
  - `check-physics` cases:
    - a down-ray over water from the ground API hits the floor under it;
    - `canStand` under a move-only bar;
    - a nav shortcut over the wet dock never ends in the channel.
  - Owners named per file.

### S6: The loader vs the arena: nav, slam footprint, cover

- **a. Enemy nav does not follow moved containers.** The nav grid is built once (`level/nav.ts`) and has no dynamic blocking, so containers moved by SHIFT / DROP are invisible to husk and soldier paths. They walk into them and rely on unstick. Make all six slot boxes permanent nav obstacles. The 2 m passages stay, and enemies route round slots whether occupied or not. Add a `check:nav` case.
- **b. `Level.dock.target(p)` does not check the grab's footprint.** The grab could slam onto MC1 / MC2, the console (x −46 … −42 lies partly outside the no-slam margin −42.5), a container beside the player, or the bar guard. Add: "the grab box at its lowest is clear of every collider except the deck", and the same for the SHIFT set-down.
- **c. Slam damage has no occlusion rule.** Add: damage only with a clear ray from the grab's bottom centre to the player's chest, so a container between them shields him.

### S7: The shaft's open well: a 12 m drop that breaks the shaft beat

- **Where:** §2.6.8 (rails 1.1 m; "drop down the well: allowed").
- **Why:**
  - A crouch-jump clears 1.1 m. The drop from L0 takes 1.12 s, and `t6_shaft_l1` fires at y −2.5.
  - F6 then spawns at +1.0 s at `mk6_shaft_u` (−26.8, −12, −163.0), about 3 m from where he has just landed, in plain view. That fails the spawn-visibility rule (R4) and the `--all` check.
  - "The lamps below him pop" happens above him.
- **Fix:**
  - Close the well with a 1.8 m mesh guard (move-only, so rays pass, which keeps the look). Recommended.
  - Or keep the drop, and fire `v6_shaft_lights` and F6 only while the player is above y −6. A player who dropped then skips the beat and F6, and `cp6_shaft` must not wait for F6.

### S8: Contract and interface gaps against the merged 3c K (types.ts at e8373e2)

- **a. No patrol API exists.** `EnemyManager.patrol(group, points, …)` is neither in 3c's contract nor in K's §8.1 block. F3's "walks out through `d6_he` to `mk6_tunb_hold` and holds" needs the same API.
  - Put it in the §8.1 block as a required member, with a stub that teleports to the last point and holds. W3c implements it.
  - Don't swap the walks for an actor: an actor in an open tunnel breaks R2.
- **b. `LevelInfo.cast.soldier` is now required** (`types.ts:61`). LEVELS[6] in §8.1 lacks it, which is a typecheck error. Set it to `false`.
- **c. `emerge: 'climb'` (§5.1, D26) vs `pose: 'climb'` (§8.4).** `EnemySpawn.pose` is the existing field. Use `pose: 'climb'`.
- **d. `--boss` aims at named parts but has no part positions.** `enemies.debug.loader()` (H15) gives only `grab: [x,y,z]`, while `player.debug.aimLock(x, y, z)` exists (`player/index.ts:740`). Add `parts: Record<id, { hp, pos: [x,y,z], mult }>`. `--dry`'s "forced 50 % hit rate" needs a named hook (W1's `debug.hitRate(k)`). Neither is in §10.0.
- **e. File clash.** `src/level/l6/dock.ts` is owned by **W4** (the `Level.dock` arena logic) **and** by **D3b** (chamber dressing). Rename D3b's file to `src/level/l6/dockdress.ts`.
- **f. Unowned tests.** `check:cutscene`'s level-6 case and `check:wreck`'s level-6 cases (§10.4) have no owner. Give them to T.
- **g. `check:reach` needs feet-region gating.** It has no notion of "usable only with the feet in `t6_cage`". Its R8 test will report `frame6_*` usable through the bars from outside. W4 adds `Interactable`-side `requireRegion` support to the check.

### S9: Ammunition accounting

- **Where:** §5.3.
- **The arithmetic:**
  - The arena needs, in hits:
    - rams 24;
    - pod 28;
    - 4 soldiers × 7 = 28 (with the 0.8 torso multiplier, not 400 / 18);
    - 5 husks × 5 = 25.
  - That is 105 hits, **210 rounds at 50 %**.
  - With S1b's unreachable pickups the arena holds 150 + 60 in drops = 210, so `--dry` fails outright. Even at the plan's 240 + 60 = 300 it is 1.43 ×, not 1.5 ×, leaving 30 % exactly with no margin.
- **Fix:**
  - Fix S1b.
  - Add 60 arena rounds (a third locker on the north gallery).
  - Restate the budget in hits, not HP.

### S10: Fiction and timeline

- **a. B-14 has two dispatch times.**
  - `note6_transfer` says `WED 21:40 B-14 CYCLE START … 22:05 CLOSED`. The E1 manifest says `B-14 WED 22:05 — DISPATCHED`.
  - But the player **watches** the loader lower B-14 into the well at the reveal, and `CLOCK6` puts that near Wed 23:45 (62.75 h).
  - `note6_queue` (head-end) still lists B-14 as `QUEUED`.
  - **Fix:** B-14 is being lowered now.
    - The log: `B-14 CYCLE START {reveal}`, `SEA GATE: AWAITING SEALED CYCLE`.
    - The manifest: `B-14 {date} × 240 — IN WELL`, `TOTAL DISPATCHED 2,880 · IN TRANSFER 240`.
    - Sunde's "Three thousand of them" still stands. Or make the reveal's container an empty return. One version, used in all four texts.
- **b. Sea gate vs chamber pressure.** The canon note says the gate's hatch "opens only in a sealed, unmanned transfer cycle". That implies flooding the whole 48 m chamber, its 24 m window and its doors to 210 bar.
  - Make the gate a **two-door cargo lock** (inner door = the well floor, a lock chamber, an outer door), so the chamber never sees sea pressure.
  - The wet dock's water is then a well overflow, which fits `DEWATERING 34 %`.
- **c. "Sixty-one hours" is stale.** `l6_choir_dark_command` says "sixty-one hours" at test hour about 63 (62.75 + time in level). CHOIR is exact. Use "sixty-three hours", or "since Monday".
- **d. `launchAt` can come before the thud.** `launchAt` = pull + 90 s "unless `v6_thud` sets it first". If the thud comes later (F5 lasted long), the OSD's launch time is earlier than the sound the player heard as the launch. Thud only within pull + 20 … + 90 s; otherwise no thud.
- **e. Kessler would know the sound.** As CO she would recognise her own launch lock flooding ("What was that? … From my end."). Keep the line ambiguous ("…That's from my end. That's the bay.") so E2 pays it off without her naming it.

### S11: R3 and the ending for a player who skipped everything

- **a. The OSD names nobody for a skipper.** For a player who never answered the handset and never triggered 3c's `l5_kes_boat`, `AAS, L. (LT.)` is a name he has never heard: K4 is skipped and nobody says who that is.
  - Add `l6_kes_end_4b` "...That's my XO's palm." (C: not `heard(l6_aas_2)`), so the empty cradle lands on a person for everyone.
  - CHOIR's last line is then earned in both branches.
- **b. §4.5 (queue read) omits `l6_reyes_queue`**, which §6.2 places first. Pick one.
- **c. `l6_kes_he_contact` assumes he is in he6.** "Movement in the vault. Coming through to you." is wrong when he is already in the vault. F4 comes from hold6 *into* the vault. Add a variant for "player in vault6": "Movement in the cable store. Behind you."
- **d. The handset and the crank both need hands.** While the handset is held (left hand), a `grip` needs both hands. State that a grip start drops the handset (`handset_drop`, the rest plays positional).
- **e. The ending's "none hunting" precondition can wait forever.** A wave soldier who followed him to the vault can block it. Apply the 3c stray rule to that wait.

### S12: The Aas voice (TTS rules, coordinator note)

- **Where:** §6.1 cast row (`describe: … whispering` + refText); D29.
- **The plan does not say how the whisper is made.** The coordinator's note and `voice/cast.json`'s `_doc` both say a whisper is a **designed reference**: a short describe + `whispering` + a *whispered* refText, auditioned. It is not a description on a normal reference, and never `derive` (the user judged DSP whispers robotic). Aas has no normal voice, so his **base** reference is the designed whisper. Say so.
- **The faintness risk.** Measure ASR on every audition. `tomas:whisper`'s short describe "failed ASR on 3 of 4 seeds (too faint)" (`cast.json:54`).
- **The similarity test is aimed at the wrong voices.** Compare envelope similarity against the **other designed whispers** (`tomas:whisper`, and the female whisper in `cast.json:88`) as well as `reyes` / `choir` / `halvorsen`. Whispers converge.
- **The `cut` on `l6_aas_3` is mid-word.** It cannot come from ASR word times, which give word starts and ends. Define it as `start("boat") + 0.10 s`, checked on the waveform.
- **Intelligibility on the phone.** The `phone` fx (350–2,600 Hz band, carbon grit, "very low level") on a whisper is a real risk. `check-voice-level` must include an ASR-intelligibility pass on the held (2-D) take.
- **Stale fallback.** Remove §12 item 5's "no new voice" fallback; it is decided.

### S13: The performance budget is optimistic where it matters

- **Shadow passes.** On MEDIUM the flashlight and FL1 / FL2 cast. The floods slew every frame, so their maps refresh every frame (`shadowEvery` applies to static lights), in a 48 m hall: three shadow passes over the chamber's casters. ≤ 95 shadow calls is unlikely.
  - Make the floods non-shadow on MEDIUM too (casting only on HIGH).
  - Or allow one flood shadow, measured at the greybox gate.
- **Husk cost.** A husk is 12 main calls, but about 29 with shadows (3b integration item 6: "three ≈ 86").
- **Spot pool on LOW.** View (h) counts 2 soldier weapon lights. W1 + W3 can be alive together (4 soldiers + 2 husks fits the cap of 6), which gives 4 soldier lights + 4 floods + the frame lamp: 9 non-shadow spots vs 8 on LOW.
  - A flood evicted from the pool still makes him "lit" for soldiers (D20 is a cone test), which is unfair.
  - `floodLit` must require the flood's light to be in the pool, or the floods take priority over soldier lights.
- **The undercroft refuge on LOW.** The undercroft's point is "medium+" in §2.7.1 but "stays on after `lights_out6`" as a refuge in §2.7.3. On LOW the refuge does not exist. Make it "all".

---

## NOTES

- **R4, "bosses never exist early".** The loader is a level spawn from load (dormant `working`), and its floods show through the `d6_pool` porthole once phase K starts. The chamber is unreachable and unseen before K, so this is harmless, but it breaks the letter of R4. See Decision 3.
- **Concealment margins.** F2's soldier at `mk6_rep_s` (10.4, −111.0): the line from (15.8, −80.2) to his right shoulder (10.75, −111) meets RH1's face at x 11.24 > 11.1. Move him to (10.2, −111.6). F6 under L3 passes by 0.12 m; move `mk6_shaft_u` to z −162.8.
- **Winch hood.** The "62°, not standable" winch hood has a standable ridge: a capsule grounds on an edge. It is irrelevant (15.6 m from the well), but don't cite it as a barrier.
- **Stage-3 speeds.** The trolley goes 2.5 → 3.5 m/s, which is 1.4 ×, not "1.5 ×".
- **DROP fall time.** The 0.96 s fall uses g 9.8; under the physics' g 19 it is 0.69 s. The telegraph (1.6 s strobe) is unaffected.
- **End card text.** D3 says `END OF CHAPTER 3`; §7.2 says `END OF CHAPTER 3 — THE QUIET SIDE`.
- **`stand` field.** `WaterVolume.stand` ("max standable depth") is not in the §2.9 table. The well needs `stand: 1.25`.
- **Under-wall trench crossing.** The trench crosses under the he6 / vault6 wall at x 2.0 (T-b → T-c), as 3c's crawl crosses spine / arm at z −18. Make sure W4 uses 3c's built way of opening a wall below floor level, and add a `check:reach` row walking T-b → T-c.
- **Task sizes.** W4 is the largest task in the graph: 12 rooms incl. the chamber, phases, 75 cover points, water, the dock arena, interactables, markers, nav wade, the trench, the check-reach changes of B1. Split it into W4a (rooms / doors / phases / markers / interactables / cover) and W4b (water / dock / hazard checks / nav wade). ST is similar: give `story/l6/boss.ts` + `scenes.ts` their own task (ST-b) after ST-a lands the route.
- **The loader-in-motion gate.** It lists W1 + W3a + W3b + W4. It should also need W3c for the W2 climb and enemies in water, which it reviews.
- **`hold6` latch.** If the player stands in hold6 when F4 / F5 come, the latch retries forever while he stays. That is fine, but the waves then fight him in a forbidden-until-variant room. `check:reach`'s B_hold row should allow hold6.
- **Lines.** Every line I checked against its rule holds, apart from S11c.
  - The ±0.12 s cue rule, the cut on `l6_kes_he_3` ("by" → "By accident") and the 22-word / CHOIR 16-word limits all hold.
  - Hesitation is written into `spoken`, and UNIT / DOCK LOADER stay flat.
  - `l6_choir_pool_command` "We kept the lights on" lands just after CHOIR killed the shaft lights. It reads as irony, so keep it.

---

## Decisions for the coordinator

1. **Containment heights (B1).**
   - **Option a:** raise the barriers to 2.4 m (coaming guard and bar guard; vertical bars, move-only, so the look and the "shoot through" rule survive).
   - **Option b:** keep 1.9 / 2.0 and add `noWreck` bands, with check-reach taught to skip wreck stress there.
   - **Recommendation: a** (the check stays strict, and nobody has to trust a manager rule).
2. **The drown fail-safe.**
   - It exists for bugs only, so it should not cost the player a milestone.
   - **Recommendation:** a **rescue**, not a death. After 1.0 s under, black for 0.5 s, then the player is placed at the nearest ladder exit (or `mk6_boss_safe`) with −15 health, a toast, and a `console.error` for the test logs.
3. **R4 and the loader.**
   - Spawn `g6_loader` (dormant `working`) when Key B turns (phase K), or keep it from load.
   - **Recommendation:** spawn at K. It costs one `spawnGroup` + `afterReplay` line, and keeps the hard rule literal.
4. **Retracted rams and the shut pod: ×0 or ×0.1 (S3).** **Recommendation: ×0** with a distinct clank and pip shake. With S3's GUARD move this removes the cage / gallery attrition win.
5. **The shaft's well: closed or a 12 m shortcut (S7).** **Recommendation: closed** with a mesh guard. The drop gains nothing and breaks the stage's one climbing scare.
6. **B-14 (S10a).** Lowered now and "in transfer", or an empty return container. **Recommendation:** lowered now. The player sees the last shipment go, and E1's "IN WELL" line lands on what he watched.
