# Review of the stage 3c plan (`docs/plans/stage-3c.md`): reviewer subagent, static read of the code at 9558cc3

"§" means a section of the plan. Coordinates use the plan's conventions. File:line references are to the tree at review time.

## Verdict: **build after fixes**

The plan holds together in most places:
- Rooms touch only on boundaries.
- All 14 std doors have leaf faces inside both rooms' interiors (recomputed: every one passes rule b).
- The four regular stairs fit their rise and run (16 × 0.3 = 4.8, 16 × 0.5625 = 9.0).
- The cutscene distances are right (6.72 m to the soldier, 9.31 m to the ready door).
- The 19/4 roster names match `src/materials/screens4.ts:303-310`.
- The line counts add up: 71 lines.

Three things will break when this is built and played: two soft-locks and one gate that can fail without telling the player why. All three need decisions in the plan, not just in code. Below them is a set of geometry and data errors that `selfTest` or the checks will catch, but whose fixes should be stated here so W4 does not have to guess.

Kessler's door can stay interactive. The neck check cannot soft-lock: it is repeatable and resets cleanly. It will confuse players as written (B3). With B3's fix it can't fail silently any more.

---

## BLOCKERS

### B1: The holding soldier does not survive the stage base. A death in the duty or ready fight soft-locks the level.

- **Where:** §4.2 H ("`g5_s1` spawned … in `hold`; `cp5_duty` saved at once"); §4.3; §7 `cp5_duty` and `cp5_ready` ("`g5_s1` in `hold`"); §4.8 / §5.5 #8 (the patrol "holding"); §8.1 contract.
- **Why it fails (code as it is):**
  1. `StageScript.fastForward` (`src/story/stage/base.ts:770-800`) calls `enemies.removeGroup(g)` for every group in `prog.triggered`.
     - `removeGroup` makes `spawnGroup` / `wakeGroup` permanent no-ops for that id (`src/core/types.ts`, the `removeGroup` doc; `src/enemies/manager.ts:123`).
     - `g5_s1` is spawned at H, before `cp5_duty` is written. If ST spawns it the normal way (`engage`), it is in `triggered` in the save.
     - Restore runs on a fresh page (`src/story/stage/page.ts:112-128`), so the restored world has **no** `g5_s1`, can never spawn one, and has no radio. The keypad stays dead forever.
     - The same happens at `cp5_ready`.
     - It also happens if the player killed `g5_s1` but died before taking the radio: the restore removes the group, so the body is gone and the radio with it.
  2. The base calm rule (`base.ts:719-727`) requires every triggered group to be `fought` (dead). While `g5_s1` holds, `calm()` is false, so `cp5_ready` ("`g5_duty` dead + 1.5 s, calm, `g5_s1` holding") can never be saved. A holding `g5_patrol` blocks `cp5_spine` the same way.
  3. Nothing in the contract lets the story release a hold.
     - `wakeGroup` only acts on members with `!e.awake` (`manager.ts:308-316`); the hold state is undefined.
     - `Enemy.state` has no `hold`, and `activeCount` counts `hunting`.
     - So it is undefined whether a holding soldier is "hunting". That decides `lastCombat`, `calm` and every scare gate.
- **Fix (write it into §4.3, §7, §8.1, §8.2.4):**
  - **Contract (K):** A soldier in `hold` reports `state: 'idle'`, `hunting: false`, `awake: true`. Add the required `EnemyManager.release(group: string): void`, which turns `hold` into normal AI. Stub in levels 1–4: it wakes the group.
  - **Story (ST):**
    - `g5_s1` and `g5_patrol` are spawned with `w.spawnGroup`, **not** `engage`. They enter `prog.triggered` only when they leave hold (flags `s1Free` / `patrolFree`).
    - The level-5 `calm()` override ignores a group that is still holding.
    - `afterReplay` re-spawns `g5_s1` in hold whenever the flag `radio` is false. That covers `cp5_duty` and `cp5_ready`, including "killed him, died before the radio".
    - Drop "patrol state as saved (holding)" at `cp5_spine`. After a load the patrol is simply absent; it is optional.
  - **Tests:** `play:l5 --checkpoints` gets the case "kill `g5_s1`, die before the radio, load `cp5_ready` → soldier holding, radio takeable".

### B2: The radio can never be enabled. Its R8 ray ends inside the corpse's own walkable box.

- **Where:** §4.3 (`radio5` at the corpse's chest marker, "enabled only with a clear ray from the eye — R8"); §8.2.2 (body = walkable 0.15 m box).
- **Why it fails:**
  - A dead machine gets a `physics.addBox(…)` with `walkable = true` (`manager.ts:260`).
  - `physics.raycast` / `lineOfSight` test every enabled dynamic box (`src/physics/physics.ts:87-104`).
  - A soldier lying `fwd` or `side` has his chest at y ≈ 0.1–0.25, inside or just over his own 0.15 m box. A `back` death against cover puts the chest behind the box.
  - So the eye→chest ray hits the box first, `radio5` stays disabled, and the keypad door is the only way on. Soft-lock.
- **Fix:**
  - `mk5_radio` = the chest's x/z at `max(chest.y, box.max.y + 0.08)`.
  - The R8 test ignores the owner's own wreck box. This is the same rule §6.1 already states for the throat voice.
  - `check:soldier` 10 adds "radio interactable enabled from 1.5 m for each death kind (fwd / back against a crate / side)".

### B3: The neck check measures the wrong thing. It fails silently for a player who turned round correctly.

- **Where:** §4.7 cue `_3`: "the port … more than 140° from `player.forward` … 1.2 s"; trigger `t5_cmd_line` z −17.4 … −14.6; port `mk5_port` (43.8, 1.62, −16.0).
- **Why it fails:**
  1. **The forward vector is 3-D.** A player on the line looks down at the yellow line he was told to stand on. Facing straight down the spine (−x) with pitch −45° gives 120°; with pitch −60° it gives 110°. Both are below 140°, so he fails while doing exactly what was asked.
  2. **The angle is taken to the port, not to the door.** From the line (x 42.5, 1.3 m from the port), facing due west passes only where |z + 16| < 1.09.
     - The trigger is 2.8 m wide, so its outer 0.31 m on each side fails a correct turn (at z −14.6: 133°).
  3. **"Turn around." assumes he is facing the port** (R3). A player who already has his back turned hears it, turns to face the door and resets the check.
  4. **The player gets no feedback while the 1.2 s runs.** With 1–3, the beat reads as broken.
- **Fix:**
  - The test becomes: feet in `t5_cmd_line` **and horizontal yaw within ±50° of −x** (pitch ignored) for 1.2 s.
  - `_3` becomes conditional:
    - "Turn around." if yaw is within ±90° of +x;
    - otherwise a new line `l5_kes_door_hold` "Stay like that." (radio, U).
  - Feedback during the count: the door camera's tally goes from amber to white and `cmd5_port_look` starts (the silhouette moves). Both stop when the check resets.
  - Objective text: `Stand on the yellow line — turn your back to the door` ("door", not "port": the port is 25 cm).
  - With this the door stays interactive (the coordinator's condition holds). The fallback in §12.2 is not needed.

---

## SHOULD-FIX

### S1: Geometry and data errors (each would fail `selfTest`, a check, or play)

| # | what | where | why | fix |
|---|---|---|---|---|
| a | 8 cover normals inverted (object is on the −n side) | §5.4 `cv5_d2` (5.0, −20.65) "+z": cabinets are at z −21.8…−21.2, i.e. −z; `cv5_f3` (28.55, −29) "+x": CA is at x ≤ 28.0; `cv5_f5` (27.75, −50) "+x": CB is at x ≤ 27.2; `cv5_f8` (37.45, −45) "−x": CC is at x ≥ 38.0; `cv5_f9` (43.05, −23) "−x": CD is at x ≥ 43.6; `cv5_f10` (44.3, −24.55) "−z": CD is at z ≥ −24; `cv5_f11` (37.05, −26.8) "−x": forklift is at x ≥ 37.6; `cv5_f12` (38.3, −28.55) "−z": forklift is at z ≥ −28 | the plan's own definition: "the object lies 0.3…0.7 m along `n`" | d2 −z; f3 −x; f5 −x; f8 +x; f9 +x; f10 +z; f11 +x; f12 +z. The notes under the table ("f3 faces +x: the threat east of CA") are wrong the same way: a soldier east of CA is covered from the **west**. |
| b | boat "high" cover fails the y+1.5 probe | `cv5_f14…f17` (x 31.25 / 36.75) | at y 1.5 the hull (⌀ 3.0, centre y 2.1, x 32.5…35.5) is at x 32.63: 1.38 m from the point. Even at y 2.1 it is 1.25 m (probe window 0.3…0.8). The 0.6 m cradle is not low cover either (crouched eye 1.0) | drop the four points, or add cradle-side equipment boxes (x 30.4…31.6 / 36.4…37.6, h 1.3, 2 m long at z −32 / −40) and make them `low` |
| c | all 8 spine points are 0.35 m from their riser, not 0.55, and 0.35 m from the wall | `cv5_s1…s8` (e.g. s1 12.65 vs R1 face 12.3; z −17.45 vs wall face −17.8) | the capsule is exactly tangent to two colliders, so "capsule free" fails on rounding | x = riser face ± 0.55 (s1 12.85, s2 14.85, s3 22.85, s8 21.15, s4 26.85, s5 27.15, s6 34.15, s7 40.15); z −17.4 / −14.6 |
| d | the count is 41, not 42 | §5.4 last line | 8 + 2 + 8 + 17 + 2 + 4 | correct the figure |
| e | low cover too low for the crouch eye | ready crates C1–C3 h 1.0 vs `crouch` eye 1.0 (§8.2.2) | the helmet shows over the crate. The safety ray tests the chest only, so it passes anyway | crates h 1.2 (as in the bay), crouch eye 0.85; the safety ray tests chest **and** head |
| f | K-phase start inside the watch desk | §3 phase K start (0, 0, −16.0); desk x −3.0…0.0, z −16.0…−15.0 | the `check:reach` seed would sit inside a collider | (2.0, 0, −16.0) |
| g | `g5_spine` soldier spawns touching the decompression chamber | §5.1 (49.0, 0, −36.0); chamber x 49…51.6, z −39.6…−36.0 | the capsule overlaps the prop | (48.0, 0, −34.0) |
| h | pickup inside the chamber | `p5_dive_shells` (51.4, 1.0, −39.4) | inside the chamber footprint | (51.4, 1.0, −29.0) |
| i | pickups inside rack colliders / out of reach | `p5_mag_ammo_1…3`, `p5_mag_pistol`, `p5_mag_med` at x 18.9 / 14.9, y −1.8 (racks x 18.6…19.6 / 14.4…15.4 are 2.0 m solid boxes); `p5_berth_shells` (12.6, 0.7, −8.0) is in the 0.6 m gap between the wall (12.2) and bunk row 1 (12.8) | the nearest standable point is ≥ 2.55 m away (pickup radius 2.2, `player/pickups.ts:233`) | rack colliders are per shelf with an open front, or the pickups move to the rack face (x 18.5 / 15.5); shells go on the bunk-end shelf at (13.8, 0.7, −2.9). Add every `p5_*` to `check:reach`'s `use` list |
| j | the magazine hatch's use point is under the stair surface | `hatch5_mag` use (21.0, −0.6, −25.4); `STAIR5_MAG_OUT` tread at z −25.4 is y −0.48 | the ray from the eye is blocked by the stair, so the one-way exit never opens. Standing feet must also be ≤ −1.85 under the closed lid (z ≤ −26.8) | use point on the lid underside (21.0, −0.08, −26.4), radius 1.6 |
| k | the magazine stair's foot is against the wall | `STAIR5_MAG_OUT` z0 −27.6, `dir: 1`; magazine box ends at z −27.8; east rack to z −27.4 | 0.2 m in front of the first riser; the only approach is a 0.8 m slot between the rack and the stair side | z0 −27.0 (top at −24.3, hatch z −27.0…−24.3); east rack z −26.2…−22.4. State the hinge: lid hinged on its **south** edge (a north hinge blocks the exit) |
| l | ready-room soldier not visible from the hand-back placement | §4.2 D0 "behind them … `g5_s1` stands … looking at the player"; §10.5 frame | the line from `mk5_c1_end` (0.4, −13.8) to `mk5_s1` (−4, −36.6) crosses z −22 at x −1.18, outside the door (x −4.8…−3.2). The ray through the door centre continues to x −7.7 at z −29, which is L1 | move `mk5_s1` to (−4.6, 0, −36.6) **and** turn the hand-back yaw to the door. Then confirm by a frame. Otherwise drop the claim; he is seen when the player reaches the door |
| m | the door pit puts a nav node over a hole | §2.6 pit x 36.2…38.6, z −17.6…−15.4 (rails on three sides, open at the stair entry) | nav is built once with the lid shut (`level/nav.ts:157-190`). A node inside the rails stays after the lid opens, enemies path into the pit, and the pit is a `nav: false` floor | the pit box is a nav obstacle from load (`L.obstacles`); the crawl and magazine stairs are built **without** `navStair` (`buildStair` always registers one, `l3/grey.ts:375`). Note too that `buildStair` builds from y 0, so W4 needs a `y0` on `StairDef` for the three lower stairs |
| n | `mk5_exit_spine` (37.9, 0, −14.8) is on the only route east | the 1.2 m walkway z −15.4…−14.2 beside the pit is the main route to Kessler's door | enemies told to "hold ≤ 3 m from it" block the corridor and stand at the stair top | exit stand-off = 2–5 m from the exit, never inside the walkway box x 36.2…38.6 |
| o | the gate's sound has two owners | §4.1: the open sound is the vignette's (`gate_open_heavy`), the close sound is "the door's own" | the 3b integration item-7 class (double or missing sound) | the door owns both; the vignette `gate5_open` only drives the dogs |

### S2: The stage base and story rules: two silent stalls

- **The spine wave can fire during the door beat.**
  - Via the loop (spine x < 22 → berths → mess → `d5_mess` at x 31 → east) `t5_spine_mid` (x 22…30) is never crossed.
  - The 45 s timer then fires `g5_spine` while the door lines run, and the wave arrives mid-check.
  - Fix: the door beat starts only after `g5_spine` has been fought. If it was never spawned, entering `t5_cmd` spawns it at once and plays `_door_wait`.
- **The door beat's calm (awake within 25 m) is blocked by strays.**
  - A stray inside 25 m keeps it from starting forever, with "Not with them on you" and nothing in sight. Examples: a `g5_spine` soldier searching in the sub bay (x ≥ 34, z ≥ −40 is within 25 m), or a skitter in the pit or crawl.
  - Fix: count only hostiles in `spine5` or with a nav path ≤ 30 m to the line.
  - Add a level-wide stray rule: an awake hostile unseen ≥ 30 s and ≥ 25 m away, during a calm wait, is removed (the 3b stranded rule, used outside `fightOutWhere`).
- **`t5_dutydoor` must be polled, not fired on enter.**
  - A sprinting player reaches it (8 m, 1.3 s) before B2 (the gate takes 2.4 s to close).
  - If he waits inside, an enter-trigger never fires.
- **The cutscene precondition says "no hostile exists in the level"** (§4.2), but `g5_mag` is dormant from load (§10.1).
  - Write it as 7.1 does: "no awake hostile, none hunting, none in gate5 / duty5 / ready5".
- **The radio sequence assumes an order** (R3).
  - `l5_kes_9` "Use the keypad" (and `_5`…`_8` "on the way") can play after the code is already in: the keypad is live from `_3`'s end.
  - Fix: power the keypad at `_4`'s **end**, and give `_9` a variant `l5_kes_9b` ("Good. Come aft, to the end of the spine. I'm not opening my door.") if `keypad.accepted`.
- **Q is announced before it works.**
  - The toast `Q — ask Kessler for the code` appears after the first wrong code, possibly before `_9`, when Q is still disabled.
  - Fix: enable Q at the power cue.
- **Q at the door during the check** plays `l5_kes_hint_door` ("My door. The end of the spine."), which is wrong there.
  - Fix: in the beat, Q plays `_3` / `door_hold`.
- **Scare spacing kills the magazine.**
  - `v5_boots` (loud) fires at x 27…31, about 13 s of crawling before the magazine.
  - The 90 s loud rule then blocks `v5_magazine`, so the husk wakes with no lamp pop, or the plan is silent on it.
  - Fix: `v5_magazine` is the wake's tell, exempt from spacing. Also `v5_boots` arrives behind the player:
    - the patrol walks ≈ 10 m (6.4 s), by which time the player, moving west at 1.8 m/s, is at x ≈ 19;
    - fix: fire it on `t5_crawl_e` + 2 s and stop him above `clamp(playerX + 1, 18, 34)`.
- **`v5_body` is not honest when every `g5_spine` member is dead.**
  - "Died ≤ 60 s ago" lets the body move after the player has watched the last husk die.
  - Fix: require a living member unseen ≥ 15 s.
- **`v5_hull_groan` will almost never fire.**
  - It needs calm and no Kessler `scene` line, but the 50 s radio sequence starts right after `g5_s1` dies, and then the player leaves.
  - Fix: allow it during the radio sequence's gaps, or accept that it is rare (say so).

### S3: Soldier tuning: as specified, an attentive carbine player is never shot by a lone soldier

Checked against `WEAPON_STATS` and the plan's numbers:
- **TTK both ways:**
  - Carbine body: 6 hits, 0.5 s. Carbine head: 3 hits, 0.2 s. Pistol body: 5 hits. Shotgun: 2 shells.
  - Soldier at the player: one soldier ≈ 3.7–4.2/s; two ≈ 7.4/s.
  - A still player dies in ≈ 13 s (≈ 20 s with the vest). The arithmetic is correct.
- **Each peek exposes him ≈ 1.0 s before his first round** (rise 0.35–0.4 + aim 0.6). An ADS carbine kills in 0.5 s, and any hit during the aim cancels the burst.
- **Suppression is unbounded:** 10 rounds/s × 0.25 = 2.5/s against a decay of 0.5/s. Holding the trigger near him pins him for a whole magazine. With 270+ carbine rounds the player can do this indefinitely.
- **The 18/s damage cap never binds.** With two fire tokens the worst case is two carbines at ≤ 8 m ≈ 12.6/s. It is invisible, and test 8 passes trivially. Harmless; keep it as a guard.
- **"First burst misses" resets after 6 s out of sight.** A peek-and-hide player is never hit by a first burst.
- **Darkness is one-sided** (D18):
  - With the flashlight off, soldiers see 12 m.
  - The player sees their glow marks at 25 m+: the existing `RigBuilder.mark` never drops below 2.2 px (`enemies/shared/rig.ts`).
  - The player's own muzzle flash does not reveal him, so a carbine in the dark sub bay at 15–25 m is safe.

Fix (numbers into `fire.ts`, then judged at the W3b motion review):
- Telegraph 0.45 s aim (glint and light from the start of the rise).
- A hit cancels the burst only if it does ≥ 25 damage in one hit, or hits the head.
- Suppression gain ≤ 0.8/s from any one shooter.
- Plate carrier: torso ×0.8, so 7 body hits.
- A player who fires is "lit" for 1.5 s (full sight, 30 m) for any soldier with an eye ray to him.
- The first-burst reset only after ≥ 12 s unseen.

### S4: Contract and hook gaps (§8.1, §10.0). The test agent will need these, and the 3b script was written blind.

- **Corpse chest point:**
  - `corpse(id).chest` is used by the story (§4.3) but is not in the contract.
  - Add `EnemyManager.corpsePoint?(id, 'chest')`. It would be a debug-free required member (D28: stub returns null in levels 1–4).
- **H12 `soldiers()` has no position.**
  - Add `pos`, `aware`, `token` (holding a fire token) and `light`.
- **H7 lacks what `--checkpoints` compares** in "`worldState()` (doors, phase, lights, regions.dark, screens, groups, pickups, scares, hatches…)".
  - Define H13 `worldState()` in the contract: `{ doors: Record<id, {open, locked, status}>, hatches: {spine, mag}, lightsOut, dark: string[], screens: Record<id, string>, pickups: string[] (taken), groups, scares, flags }`.
  - Without it, T and ST will each invent one.
- **Also missing:**
  - `radio: { owned, live, pos, enabled }`;
  - `spawnLog` (the spawn-visibility rule in §10.1 needs it; level 4 had one);
  - an audio play log for the `--scares` sound-owner audit (the audio module has no contract for it: name who adds it, W2b);
  - `wheel: { startedAt, doneAt }`.
- **The keypad stub.**
  - `ui.keypad` is a stub (resolves null) until W2a lands, so ST cannot test code judging and H10 has no UI to type into.
  - Fix: K's stub resolves with a debug-injected string (`__game.debug.keypadInput`), and H10 uses it when the real UI is absent.
- **The keypad overlay itself (W2a), three problems:**
  1. It unlocks the pointer and closes on damage. Re-locking needs a user gesture, so a damage-close leaves the game unlocked mid-fight.
  2. Digit1–3 switch weapons (`player/index.ts:634`) while the player types "4719".
  3. Fix: keep the pointer locked (a virtual cursor driven by mouse deltas, plus the digit keys), and have the story set `player.controlsEnabled = false` while it is open.
- **Wrong in the plan text** against the coordinator decisions:
  - D27 and §8.14 still say "RMB hold + a second binding". The decision is RMB hold only.
  - §6.1 says "the user picks" Kessler's voice. The decision is a provisional pick by measurement.
- **Soldier template pre-warm.**
  - `createEnemies` pre-warms only the types it knows (`enemies/index.ts:118-134`). The first soldier on screen is the cutscene actor as the door opens on him, which would be a shader-compile hitch on the reveal.
  - W3b adds `soldier` to the warm list when the level has soldier spawns.

### S5: Ownership and dependency gaps in the build graph (§11)

- **The exits behaviour may need code outside W3b's files.**
  - Husk and skitter chasing (partial path, stand-off, `holding`) lives in `src/enemies/ai.ts`, which no task owns.
  - Retargeting the player node in `enemies/nav.ts` may be enough, but the attack and direct-chase tests in `husk.ts:1384` / `ai.ts:375` use `w.playerPos`.
  - Give W3b `ai.ts` explicitly.
  - The grating keeps melee honest only because `seesPlayer` needs line of sight (`husk.ts:779`). Write that into §8.4 as a rule so nobody "fixes" the LOS.
- **W4's done criterion depends on W3b.** "`check:nav` … Exits: every awake enemy goes to `mk5_exit_spine`" needs W3b's enemy code, but both are wave 1. Move that case to W3b (`check-soldier` or a `check-nav --exits` W3b adds) or to IA.
- **W3b against the rig.**
  - W3b is built "against W3a's rig interface". `check:soldier` 1–14 need a body to hit.
  - W3b ships a `StubSoldierRig` (boxes for head / torso / limbs, eye / muzzle / chest points) in its own files.
  - The motion review after W3b needs **both** W3a and W3b merged. State that.
- **`check-voice-level` is the coordinator's script, but ST "adds its listener points".** As in 3b: ST hands a diff, and IA applies it.
- **Lights below floors.**
  - `roomLightBox` is unbounded in Y (`level/context.ts:285-300`). The armoury's point light and cage spot (no shadow on LOW) light the magazine through the slab, so `v5_magazine`'s "only the stair strips and the husk's eye remain" never happens on LOW.
  - The plan bounds only the crawl's and the spine's lights.
  - Add: every arm5 light `bounds` y ≥ 0; `mag5` y ≤ −0.1. Also the red point over the tunnel door is medium+ only, yet the wheel must read without the flashlight on LOW: make it `all`.
- **Throat voice level.**
  - POS `throat { ref: 4, rolloff: 1.0 }` with the `inverse` model (`audio/voice.ts:444-445`) gives 4/6.7 = −4.5 dB at the cutscene's 6.7 m.
  - §8.13 requires ≥ −3 dB.
  - Fix: ref 5.5 (−1.7 dB), or `gain: 1.25`.
- **Remove `src/story/l4/script.ts` from K's files.** Level 4 already carries `testHour` (`story/l4/index.ts:68`).
- **Unused field.** `nav.ts` warns about "floors with no reachable node" (`level/nav.ts:290`). `nav: false` floors must be excluded from that report and from `check:nav`'s floor test.

### S6: Fiction

- **Kessler contradicts herself.**
  - `l5_kes_2` "I watched you come through the gate. You're not fitted" and `squawk_2` "I can see you on the camera" both say she trusts the cameras.
  - `door_2` "The cameras are his" says she doesn't.
  - Fix `door_2`: "The camera says you're clean. The cameras are his. I need to see your neck. With my own eyes."
  - For `squawk_2`: either the ready room gets its own camera with a tally (D1), or the line's condition requires the player in `duty5`.
- **Who pressed Aas's live palm?**
  - The gate opened on `AAS, L. (LT.) — PALM — LIVE` seconds before the player walks into an empty gatehouse.
  - Use it rather than leave a hole: put the palm plate inside the booth (seen through the glass), its screen `AAS, L. — PALM — LIVE — {now − 0:40}`, and the booth's back door just swung shut (sound on arrival, no figure; R2-safe behind glass).
  - It is the stage's best piece of evidence that Aas is alive and being carried. It costs one prop.
- **The ON POST numbers disagree:** §1 says `24 → 25`; §5.5 and §6.4 say `26 → 27`. 26 is right (23 fitted + CO + XO + Sunde). Fix §1.
- **The CHOIR-naming rule contradicts the plan's own texts.**
  - §0.1 / §13 claim "CHOIR never named on a navy screen", but `note5_dive` and the `launch` screen show `REQUESTED: CHOIR`.
  - The texts are fine: CHOIR is the facility's system, and requesting maintenance is ordinary.
  - Reword the rule: "no navy screen says CHOIR controls anyone".
- **A player without a carbine** (planner Q3, reviewer's call): every carbine soldier's body gives the **carbine** if the player has none, otherwise 15 rounds. `g5_cmd`'s soldier is on the main route before the bay. Keep `p5_arm_carbine` as well.
- **Never cyan on a soldier.** The merged glow-mark system uses "cyan standby, red hunting". The soldier's Clasp LED must stay red (blinking) in every state, including `hold`; red means linked (3b). Build the LED and halo with `RigBuilder.mark()` (no extra draw call, a 2.2 px floor) instead of a separate sprite.
- **Halo size is given twice:** §4.2 says 3 cm = 12 px; §8.2.1 says 4 cm. 4 cm at 6.7 m / 30° is ≈ 8 px at 720p and 12 px at 1080p. State 4 cm and "12 px at 1080p".

### S7: Voice lines (TTS rules, R3)

| line | problem | fix |
|---|---|---|
| `l5_kes_aas` | no `spoken`: the model will say "Aas" as written. 3b says "Oss" (`l4_choir_end_*` spoken) | spoken "Oss isn't fitted... They don't need him fitted. They need him BREATHING." (and any other "Aas" spoken) |
| `l5_reyes_c1_2` | stress mid-phrase ("killed EVERYONE on my line") | "…they killed EVERYONE ON MY LINE." |
| Kessler overall | 11 uppercase stresses in 37 lines for a "tired, controlled" voice; `squawk_1` "ANYONE." and `door_6` "DOESN'T OPEN." will come out raised | keep stress only in `_5` (EVERYWHERE), `door_2` (OWN EYES), `_aas` (BREATHING); drop it from `squawk_1`, `_2`, `_7`, `_8`, `door_6`, `_dark`, `_contact` |
| `l5_reyes_r1`, `_r2` | read from a script (no hesitation), the user's criticism | "Reyes. I'm— Fabrication. I came up through Bio." / "Then... come out here. Help me." |
| `l5_kes_door_1` | "That's close enough." and then she asks him to step forward 2.5 m | "Stop there. On the yellow line." |
| `l5_sol_felt_*` | uppercase THAT makes CHOIR's soldiers stress, against "calm, never raised" | no uppercase |
| `l5_kes_tunnel` + `l5_unit_wheel` | both at wheel + 4.0 s | the unit line first, Kessler at its end + 0.4 |
| `l5_kes_contact` | can land inside the pickup sequence (wave fired at `t5_spine_mid` during `_6`…`_9`) | queue after the sequence (`scene` priority), drop if the wave is already in sight |
| new | B3 | `l5_kes_door_hold` "Stay like that." (radio) |
| new | S2 | `l5_kes_9b` "Good. Come aft, to the end of the spine. I'm not opening my door." |

---

## NOTES

- **Recomputed, correct:**
  - The leaf spans of all 14 std doors. Rule b exempts `wide` (`check-doors.mjs:318`), so `d5_gate`'s top leaf rising to 4.22 m inside the 3.4 / 3.6 m rooms' solid is fine. Its bottom leaf sinks into the solid at y 0.
  - The stairs: `STAIR5_W` z −45 → −36, `STAIR5_E` z −25 → −34, `HATCH` 33.7°, `MAG_IN` 40.6°, `MAG_OUT` 43.9°. All are under the 60° hold-slope limit (`physics.ts:132`).
  - The crawl: 1.35 m clear vs 1.1 m crouched; `canStand` ray 0.9 m from +0.95; no jump while crouched (`controller.ts:151`). Space un-toggles the crouch, but `canStand` holds him down: harmless.
  - The grating blocks sight, bullets and melee (the husk windup needs `seesPlayer`). A player in the pit (open above) can be hit from the walkway. That is fair and the plan says so (#15).
- **Budget (§2.7.5), honest only with door frames merged.**
  - From 3b's actuals: a husk is 12 calls (≈ 29 with shadows), and frame zones cost 8 per far door.
  - Nine enemies in the sub bay ≈ 86 main calls at LOD0 and five sub-bay doors ≈ 40 if frames are per door, which leaves ≈ 140 for the room, boat, pickups, decals, tracers and the viewmodel.
  - Put the sub-bay doors in one frame zone. Run perf view (6) on W4's greybox with the nine enemies **as soon as W3a + W4 merge**, before D3 dresses, so D3 knows its real room budget.
  - §2.7.2 (d) undercounts spots: add the sentry's searchlight (4 of 8 spots).
- **Fiction holds:**
  - Sunde (3b: "not on Monday's sheet", Sunday-night log "I've stopped the fittings"; 3c: 08:12 to the CO, 08:38 into the module, 08:40 links), the four NO SIGNAL as the module watch, the hard-wired emergency lighting, the horizontal launch lock (it leaves 3d the moon pool), and the empty cradle.
  - The 61 h clock: MON 08:40 + 62.5 h = WED 23:10, so "three days" and "since Monday" are fine.
  - The `v5_boots` patrol needs `setLight(true)` outside aiming (D24 says the light is on only while aiming).
- **User's brief:** the plan covers all six points.
  - The first real gunfights are modest (five soldiers, one of them optional): acceptable for the first soldier stage.
  - ~12.5 min is plausible.
  - There is no dead stretch except the two listening beats (radio ≈ 50 s, door ≈ 35 s); both leave the player free.
- **Checks worth running where (speed):**
  - K: `check:chain`, `play:l4` default.
  - W4: `check:reach` / `check:nav` / `check:doors` for level 5, **and** `check:reach all` + `check:nav all` once (shared `context.ts`, `nav.ts`, `assemble.ts`).
  - W3b: `check:soldier`, `check:nav all` (`enemies/nav.ts`).
  - W6: `fxleak` 3, 4, 5.
  - D-tasks: `zfight` / `doors` / `decals` for their rooms only, plus the perf views they own.
  - ST: `play:l5 --contract` + default + `--checkpoints` on greybox.
  - IA: everything, once.
  - `--frames` and `check:dark` calibration go to IB/IA only.
  - Skip the reviews for W2a / W2b / W5 / W6 / W8 / W9, as planned.
  - Keep the one extra review: the soldier in motion after W3a + W3b. It is the stage's risk, and S3's numbers are decided there.
- **Dependency on the parallel systems:** `check:dark`'s "battery forced full" needs a debug hook from the battery task (`player.debug.battery = 1`); ask for it now. ADS is only used by `--ads`. The glow marks are merged: use them (S6).

---

## Decisions to put to the user

1. **How loudly 3c points at the ending.**
   - `l5_kes_boat` ("Mine, or my XO's") + `l5_kes_aas` ("They need him breathing") + CHOIR's "It needs only a steady hand" together nearly spell out 3d's empty cradle and "We needed hands".
   - **Recommendation:** keep `_boat` and CHOIR's line, cut `_aas` from 3c (or move it into 3d's first minutes). The booth palm plate (S6) keeps Aas alive in the player's mind without saying it.
2. **Soldier difficulty target.**
   - (a) As planned: tense but forgiving. A lone soldier rarely lands a hit on an attentive player.
   - (b) With S3's numbers: a lone soldier is a real threat if ignored and beatable with aimed fire.
   - **Recommendation:** (b), confirmed at the W3b motion review on the dev page.
