# Stage 3d "THE TRUNK" — detailed plan (technical level id 6)

Status: **PLAN, amended after review** (`docs/reviews/stage-3d-review.md`, verdict "build after fixes", read against
e8373e2 with 3c's K contract merged) with the coordinator's six decisions. This file is the single authoritative document
for building 3d; §13 lists every review item and what changed (**§13 wins** where any older sentence still disagrees). Sources: DESIGN.md R1–R8 (REVISION 5 + 5.1), REVISION 6/6.1
(canon: 61 h, Eridu Deep, the living rostered palm, lockouts), REVISION 7 + **7.1** (7.1 wins: the trunk is cut in a
**fixed order by layout** — head-end → cable vault → moon pool; the objectives are **physical and irreversible**, no palm
plates; the ending beats happen **at the moon pool**; the open ending uses the submersible — the cradle at Post 4 is empty;
boss = the dock's autonomous loader; taken soldiers are plain enemies that cannot be saved), `docs/plans/stage-3c.md`
(after review, incl. §13 — **3d's canon and toolbox**), `docs/reviews/stage-3c-review.md`, `docs/plans/stage-3b.md` §13,
`docs/plans/stage-3b-integration.md`, `docs/plans/stage-3c-agent-rules.md`, `docs/plans/stage-3c-k-notes.md`,
`docs/plans/stage-3c-wave1-notes.md`, and the code on main at 3596764 (flashlight battery, carbine aim, dark-room marks;
3c's K contract, 3c W2a UI and W9 voices merged; the rest of 3c is being built). To be copied into DESIGN.md as REVISION 11 at integration (IA).

**3c dependency.** 3d is built only after 3c is merged. Each interface 3d uses from 3c is either **merged (fact)** —
in `src/core/types.ts` or a merged task's notes — or **assumed** (still being built), cited with its 3c plan section.
**K's first job (§11 rule 7) is to verify every "assumed" row against merged code before wave 1** and edit this table
and every citation if 3c built it differently:

| from 3c | status | interface 3d uses | 3d uses it for |
|---|---|---|---|
| soldier contract (3c §8.1, K) | **merged** (`types.ts`) | `EnemyType 'soldier'`, `EnemySpawn.pose 'hold'` / `.arms` (absent = carbine) / `.cover`, `EnemyManager.release(group)` (emits `enemy:alerted`), **`holding(group)`**, `corpsePoint(id, 'chest')`, `GameEvents['enemy:fired']`, `LevelInfo.cast.soldier` (required), `SoldierDebug` row type | every gunfight; the level-6 `calm()` |
| soldier body + AI (3c §8.2, W3a/W3b) | assumed | `SOLDIER_TUNING` (one table), the `lit` flag (3c D18), tokens, damage cap, bark gate, `enemies.debug.soldiers()`, cover choice reading `Level.cover` | gunfights; the flood-lit rule (D20) |
| cover points (3c §5.4, §8.3) | **merged** type + `Level.cover` (via `assembleLevel`'s `cover` option); 3c W4's `selfTest` assumed | `CoverPoint { id, position, normal, height, room, set }` | all cover; 3d adds `enabled` (§8.1) |
| floors below the main floor (3c §8.4) | **merged**: `RoomFloor.nav?`, `RoomFloor.exits?`, required `Level.floorAt(p)` (default `floorOf`); assumed: `LevelBuild.room(…, { floors })` copying `nav` / `exits`, room bounds from the lowest floor, `StairDef.y0` / `nav` (level-internal, `l3/grey.ts`), nav obstacles, opening a wall below floor level (the crawl under `d5_arm`) | the vault's cable trench (§2.6.7) |
| hatches (3c §8.4, W7) | assumed | lid as a registered mover, `open(k)`, underside-only interact with the eye rule | trench hatches |
| radio + Q (3c §8.6) | **merged**: `ui.radio(o \| null)` (strip `rstrip`), subtitle class `radio` for `KESSLER` / `RADIO`, voice fx `radio`, `radio:1`, `throat` in `FX_NAMES`; assumed: Q handling in the story, POS `radio` / `throat` (W2b) | Kessler and CHOIR all stage |
| scare kit (3c §5.5, §8.7) | `Level.vignette('<id>:snap')` convention **merged** (documented, 3c W4 builds it); assumed: `scareOk(id)`, `scares` in progress (`ProgressL5` merged with `scares`), `audio.debug.log` (`AudioLogEntry` type merged) | §5.7 |
| stage base additions (3c §4.7, B1) | assumed (ST 3c) | the level `calm()` override pattern ignoring holding groups, door-calm, **stray rule** (unseen ≥ 30 s and ≥ 25 m during a calm wait → removed), `afterReplay` re-spawn | checkpoints, boss restore |
| `mustNotUse` in `check-reach` (3c §3) | assumed (3c W4) | R8 with line of sight | §3 |
| voices (3c W9) | **merged**: 72 lines, `kessler` provisional pick, `soldier` alias, **`cut` in FILE time** (incl. `lead`), the `l4_sunde_8` lead re-set after any `npm run voice` | lines (§6) |
| first-person cutscene (3a `rig.cutscene`, 3c §4.2) | built (3a) | `linesReady(ids, s)`, shot table, skip only once seen, `check:cutscene` | the ending (§4.9) |
| level 5 end (3c §7, K) | **merged** (K stub) / ST assumed | carry `from: 5` with `kills5`, `testHour` (≥ 62.5); facts `radio`, `kessler`, `l5_door`, `l5_boat` (ST 3c); `nextOf(5)` | the hand-over (D2) |
| soldier patrol path | **does not exist** (S8a) | 3d's K adds `EnemyManager.patrol(…)` (§8.1), W3b / W3c implement | `v6_crossing`, F3's walk-out |

Conventions exactly as 3c: metres, y up, −Z forward, yaw 0 looks down −z (`?spawn` yaw in degrees, +90 = −x). Room boxes
are **boundaries**; walls are 0.4 m centred on them (interior = box inset 0.2). Std door 1.6 × 2.4; an **open std leaf spans
0.82 … 1.62 m from the door centre**, its slot ends 1.675 m from it, and `check:doors` rule (b) needs a wall face within
0.45 m on both sides of every leaf sample — so **both rooms' interiors must cover the door centre ± 1.62 m along the door's
wall** ("leaf faces" column). `DoorSpec.y` = the floor of the frame. Player capsule r 0.35, h 1.8 standing / 1.1 crouched
(eye 1.65 / 0.98, walk 3.6, sprint 6.0, crouch 1.8 m/s, jump 1.0 m, ground accel 11 — `player/controller.ts:10-27`);
**gravity 19 m/s²** (`physics.ts:6`: take-off 6.16 m/s, apex at 0.324 s); **no fall damage exists (as built)**; crouch-jump
clears 1.7 m. **Containment rule:** a barrier is ≥ **2.35 m** above any floor where a body (a wreck box, 0.36–0.6 m, is a
walkable step) can lie, and ≥ 1.75 m only where no body can lie (a ledge < 0.6 m wide). A **sprint-jump** from a standable
surface at height h above a hazard's rim travels at most `R(h) = 6.0 × (0.324 + √(2(h + 1.0)/19))` m before it falls
below the rim (§2.10). **Pickup rule (as built, `pickups.ts:294-301`):** an auto pickup is taken with the feet within
1.0 m horizontally, the item centre −0.6 … 1.4 m above the feet, and a clear chest-height ray (feet + 0.9) to within
0.4 m of it — so every item here is ≤ 1.3 m above its floor and ≤ 0.3 m from the face it is approached from. Points on
decks are given as (x, y, z) with y = the deck.

---

## 0. Decisions

| # | Decision | Why (one line) |
|---|---|---|
| D1 | Separate world `src/level/l6/`, `src/story/l6/`, lines `voice/lines.l6.json`; ids `l6_` (lines, beats), `d6_` doors, `t6_` triggers, `g6_` groups, `cp6_` checkpoints, `p6_` pickups, `mk6_` markers, `cv6_` cover, `v6_` vignettes, `sl6_` cargo slots, `wat6_` water volumes. | Same pattern as levels 2–5. |
| D2 | **Hand-over:** 3c's `door5_headend` stays a sealed prop in level 5; 3d starts in its own copy of the tunnel end (`lock6`) with the head-end tube door (`d6_tube`, a real door) cycling open. **`LEVELS[5].next` stays `null` on main until IA**; K builds 5 → 6 behind the test override `?next=5:6`. With `next` set, 3c's end card loses "TO BE CONTINUED" (6 s, skippable) and hands over, as 3a → 3b → 3c. | Main stays playable through the build (3b D4). |
| D3 | **The chapter ends here:** `LEVELS[6].next = null`; end card `THE TRUNK` / `TO BE CONTINUED` (14 s, skippable once seen), then `END OF CHAPTER 3` (4 s), then the menu; stored level 6; menu line `Chapter 3  —  The Trunk`. | The game's current end; open ending (user). |
| D4 | 12 rooms, none overlapping in plan (§2.1); the cable trench is **floors** of the vault and the head-end (3c's crawl mechanism); the stair shaft's landings are floors of the shaft; the moon-pool chamber's decks are floors of the chamber; the Post-4 feed set `feed6` is a sealed room in the void, drawn only by the feed pass. | `assemble.ts` bitmask; `roomAt` x/z first-match. |
| D5 | **Fixed order by mechanism, not by instruction (7.1, R1): a trapped-key interlock chain** (real naval/industrial practice — Castell keys). The head-end changeover switch, cranked to MANUAL, releases **Key A**; Key A opens the vault's beach-joint enclosure; pulling the fibre loom out frees **Key B**; Key B opens the stair door to the moon pool. Each key is given (and a used key trapped) atomically **with its flag** (`manual`, `bjOpen`, `pulled`, `shaftOpen`) inside one action; every checkpoint restore replays the flags' world consequences (§7, B4). | The order cannot be broken, and the reason is on every plate. |
| D6 | **Objectives are physical and irreversible (7.1):** the crank (the key comes out and nobody can switch back without it), the **pulled fibre** (the connector rips out of a 96-fibre splice: "a jointing team and a week"), the **cut tether** (a hydraulic guillotine: pin → pump → fire). No palm plate anywhere on them. | 7.1 B5; nothing a taken sailor can undo. |
| D7 | **Hold-to-work is a player API**, `player.grip(o)` (§8.3), built on the palm-scan machinery: the press on an interactable starts it, progress advances only while **E is held**, the weapon is lowered and both hands go to the handle (IK), the feet are planted while held, the view is eased onto the handle; releasing pauses (progress kept for cumulative tasks); a hit flinches (0.3 s pause) but never cancels; walking > 1.3 m away pauses. Uses: crank 3.0 s, pull 3.0 s, pin 1.2 s, pump 6.0 s cumulative, lever 0.6 s. | The user's "hold-to-pull"; feedback the player can read; no silent failure. |
| D8 | **The boss is the dock's autonomous loader** (`EnemyType 'loader'`, `src/enemies/loader/`): an overhead gantry crane — a bridge on wall rails, a trolley, four wire ropes, a heavy four-jaw grab, four work floods, a control pod under the trolley, a PA horn. It belongs to the place: on arrival it is **working** (lowering cargo into the well). It never walks; it moves on its rails. | User brief; not a monster. |
| D9 | **Boss = three zones, three answers:** the **dock** is the loader's (slam, container shift/drop, swing); the **tether frame** (a bar-guarded cage over the well) is a **no-slam zone** — CHOIR will not risk its own link — so there the danger is the **hands** (soldiers, units) that its floods point at; the **galleries and the undercroft** are out of the grab's reach but open to soldiers. The player chooses where to be. | Readable, fair, verticality with a purpose. |
| D10 | **Boss stages tied to the objective (or to damage, whichever first):** stage 1 at the hostile start; stage 2 when the shear pin is out **or** the first jaw ram is destroyed; stage 3 when the shear is pressurised **or** both rams are destroyed. **Waves join at set moments**: W1 at the hostile start, W2 when the pin is out, W3 when the pressure is full (§5.5). The trunk goes dark on the shear; the **ending needs both**: the tether cut **and** the loader destroyed, then calm. | Order-independent: kill first, cut first, or mix. |
| D11 | **Weak points (R2: everything enemy-looking reacts):** four floods (40 each; each one dark makes the loader worse at finding the player and stops it lighting him for the soldiers); two jaw rams (200 each, ×1.0 **only while extended** — jaws open: the slam lock, its recovery, the 1.0 s clamp / release of a container on the player's deck — amber sight glasses glow then; **×0 retracted**: a hard clank, sparks, the HUD pip shakes); the control pod (500, **×0 with its cowl shut** — same clank — until **both** rams are gone, then its cowl opens ×1.0); everything else ×0.05 with sparks (R2: it reacts). Windows open only on a deck the grab can reach, so the fight cannot be won from the cage or a gallery (S3). Kill = the pod. | Foreman lesson: three readable weak points = three phases, a clear end. |
| D12 | **Water:** the wet dock is wadeable to **1.0 m** (knee 0.5 m on its floor, waist 1.0 m in the sluice channel, which has a sloped side to walk out on); the well is 13.7 m deep and **never reachable**: its rim is a 0.8 m steel coaming with a **1.6 m vertical-bar guard flush with its outer face** = **2.4 m** above the dock (3.2 m above the wet floor), ladder gates as high, exit rungs without colliders; a **2.4 m** bar guard along the mid deck's south edge; the frame's 2.6 m roofed cage; containers and the grab not standable; the §2.10 jump-arc rule; `check:reach` proves it on every simulated step (B1). Deep water is a real barrier: the coaming and its guard. A fail-safe exists only for bugs: in water deeper than `stand` the player is held (sink ≤ 0.5 m/s) and after 1.0 s **rescued, not killed** — 0.5 s black, placed at the nearest ladder exit / `mk6_boss_safe`, −15 health, a toast, a `console.error` for the test logs (coordinator 2); the per-level kill height (−36) keeps him reachable for it (B6). | R1 + R6; "a real barrier, not an invisible wall". |
| D13 | **Wading** (player, §8.3): depth `d` at the feet: < 0.1 dry; 0.1–0.35 walk × 0.85, sprint × 0.8; 0.35–0.7 walk × 0.6 (2.16 m/s), no sprint, jump × 0.5; 0.7–1.25 walk × 0.4 (1.44 m/s), no sprint, no jump, **no crouch** (toast `Too deep to crouch`); splash footsteps, wake rings. From every water cell a walk out to dry floor exists under these caps (`check:water`, B3). Enemies: husks and soldiers × 0.7 at d ≥ 0.35 and never path into d > 0.6; skitters never into d > 0.1; a body that dies or spawns in water deeper than 0.6 m makes no wreck box and sinks (B6). | User brief; slow water = a risk the loader exploits honestly. |
| D14 | **Water stops rounds and sight:** water surfaces are **ray-only** colliders (`userData.rayOnly`, physics, K): bullets splash at the surface, nobody is hit under water, `lineOfSight` stops at it. Rails and bar guards are **move-only** colliders (`userData.moveOnly`): bodies stop, rounds and sight pass (a spark on 15 % of passes). Solid plate (coaming, parapets, containers) stops both. Physics keeps **two sets** (rays = solid ∪ rayOnly; moves = solid ∪ moveOnly) and a new `raycastSolid` (moves set + dynamic boxes) that every ground / headroom query uses, so water is never a floor (S5, §8.1). | Honest physics; the cage is not a bullet shield. |
| D15 | **The Clasp manifest (open-ending beat 1)** is the head-end's outbound queue: an optional readable on the head-end console (`note6_queue`) and, at the end, the dock console (a labelled head-end repeater) showing the last buffered outbound traffic — **13 batches of cervical Clasp assemblies dispatched through the moon pool to a subsea shuttle since last spring and the 14th (B-14) in transfer — the one the player watches the loader lower at the reveal — no consignee**. Order-independent: lines key on whether the queue was read. | 7.1; seen without assuming order. |
| D16 | **The empty cradle (beat 2)** is a live CCTV feed (3a `render.feed`) of `feed6` — a sealed copy of 3c's sub-bay south end (cradle, rails, launch-lock door) — shown on the dock console, with CHOIR's OSD `SDV TERN — LAUNCHED {hh:mm}` / `LAUNCH AUTHORITY: AAS, L. (LT.) — PALM — LIVE`. `{hh:mm}` is the moment the player heard the launch through the hull (`v6_thud`, which fires only within pull + 20 … + 90 s), else the fibre pull + 90 s. Canvas `cctv` fallback if the feed spike fails. | 7.1: "the cradle at Post 4 is empty". |
| D17 | **The ending is a first-person cutscene started by the player** at the dock console (`console6`, "Use console"), only once the tether is cut, the loader is destroyed and the chamber is calm; two beats E1 (manifest) + E2 (cradle) on recorded line ends, each ≤ 25 s; then black, CHOIR's last line, `THE TRUNK` / `TO BE CONTINUED`. Before it: the shear (the trunk going dark) is the player's own act, in control, never a taken camera. | R5-style rules for scenes; no fight is ever interrupted by a camera. |
| D18 | **One new voice, Lt. L. Aas (spoken "Oss")** — decided — three whispered lines on a sound-powered phone handset in the head-end (`v6_handset`, optional): the man whose palm opens everything, alive, unfitted, being walked to the boat by taken sailors. His **base reference is a designed whisper** (short describe + `whispering` + a whispered refText, auditioned; never a description alone on a normal reference, never DSP-derived — S12). **Dr. Sunde speaks twice** on Kessler's channel in E1 (existing voice). For a player who skipped the handset, Kessler names the palm in E2 (`l6_kes_end_4b`, S11a). Argued in §6.1. | The ending's "hands" land on a person, not a name. |
| D19 | **Darkness for the battery as built** (3c D16): tunnel B is dark from the start (hard-wired emergency strips and red pools ≤ 8 m apart), the shaft goes dark as the player descends (`v6_shaft_lights`), the trench is red-strip lit, and the moon pool's mains go at boss stage 2 (`lights_out6`) — the fight then lives in the loader's floods, the emergency strips, the sea windows and muzzle flashes; every dark stretch follows 3c §2.7.3's rules. | User brief; battery 10 s / 4 s. |
| D20 | **Soldiers see by the loader's floods:** a player inside a live flood's beam is "lit" (3c D18: full sight 30 m) for every soldier with an eye ray to him. Shooting floods out is how the player takes the light back. | The fight changes the light; a reason to shoot lamps. |
| D21 | **Boss checkpoints at milestones, restored with a floor**: six milestones (pin, pressure, cut, ram E, ram W, loader dead) — each writes `cp6_m<n>` (n = how many are done) with **`checkpointNow`** 1.0 s after it if the player is alive (deferred to a running grip's end + 1.0 s, never skipped); a restore puts him at the **restore point of the latest wave** (§5.6.9), sets **health = max(saved, 60)** and **tops the carbine (or the best owned weapon) to ≥ 90 reserve**, re-arms the three **dock ammo lockers**, rebuilds the loader with its saved parts, stage, slot layout and floods, clears earlier waves and re-spawns **only the latest** wave fresh from its twin (a pending wave is re-queued under its own rule) after a 3 s grace. A death never replays more than one milestone (B5, S2). | User brief (~2 min); no death-loop at 10 HP. |
| D22 | **Every story position is a `mk6_` marker**; missing marker = error. Every timed line starts ≤ 0.12 s from its cue (`lineLog`). | 3a/3b/3c lessons. |
| D23 | Every fx volume declares `rooms` (and `seenFrom` / `apertures` where seen through an opening); hidden in `render.prepare`; `check:fxleak --level 6`. | 3b D21. |
| D24 | LOW: every view ≤ 6 points / ≤ 8 spots / ≤ 2 shadow slots (the flashlight is one); the loader's floods are non-shadow spots on LOW **and MEDIUM** (the two trolley floods cast on HIGH only; one flood shadow on MEDIUM only if the greybox gate measures it in budget — S13); the floods out-rank soldier weapon lights in the pool (prio 0.9 vs 0.5) and `floodLit` counts only a flood whose light is in the pool this frame; muzzle flashes pooled; enemy eye lights lose slots first. | 3c D24. |
| D25 | **One owner per sound** (§8.12 table): vignette sounds the level's, line audio the story's, enemy combat sounds (incl. the loader) the enemies module's, UI clicks the UI's, the buoy ping motif the level's (driven by a story value). | 3b integration item 7. |
| D26 | Waves that must arrive are `rush`ed (husks); soldiers never rush; W2 units climb out of the well (`EnemySpawn.pose: 'climb'`, kinematic from spawn to exit) and are rushed from the dock. | 3c D26. |
| D27 | No optional contract members: K adds every new member with working stubs (`Level.water = []`, `Level.dock = null`, `enemies.boss() = null`, `enemies.patrol()` teleporting to the last point and holding, `player.grip` stub resolving 'done' after `seconds`, `physics.setKillY`, `physics.raycastSolid`). | 3c D28. |
| D28 | Facts in from 5: everything carried; out of 6 (for chapter 4): `kills6`, `manifest` (queue read), `aas` (handset answered), `launchHour`, `trunkCut: true`, `loaderDead: true`, `testHour`. | Open ending; later chapters. |
| D29 | Delivery (TTS rules): Kessler controlled and tired, hesitation in the words, scene-owned varied gaps, **cut once by CHOIR** (`l6_kes_he_3`, `cut` from ASR word times, in file time incl. `lead` — 3c W9 convention); Reyes hoarse, few words; Aas whispering, broken; Sunde quiet, precise; CHOIR calm, two variants by the choice for every CHOIR line, sparse stress to the phrase end; UNIT and the loader's PA flat, **no uppercase**; soldiers CHOIR through `throat`; "Aas" spoken "Oss"; `note` never reaches the model. | TTS rules; 3b S10, 3c D30. |
| D30 | Target ≈ 15 min on the main route (§2.5); every room holds something to do, read or fight; the moon pool is the largest space of the game so far (48 × 48 × 22 m). |
| D31 | **R4 kept literally (coordinator 3): the loader is spawned when Key B turns** (`spawnGroup('g6_loader')` in pose `working` at the phase-K transition, and by `afterReplay` whenever `shaftOpen && !loaderDead`) — it does not exist before the chamber can be reached or seen. | R4 "bosses never exist early". |
| D32 | **The shaft's well is closed** (coordinator 5): 2.4 m move-only mesh guards on every well edge and over the two open landing edges; no 12 m drop. | The climbing scare (F6) depends on the descent. | User brief. |

### 0.1 Review lessons → where this plan designs for them

| Lesson (3b/3c reviews, 3b integration) | Here |
|---|---|
| a death before a key item soft-locks the level (3c B1) | keys given atomically at the end of their action (D5); the radio is carried in (fact); the boss restore rebuilds state, never deletes it (D21); every flag pair (done, taken) collapsed into one |
| interaction ray ends inside a collider (3c B2) | every use point is 0.4–0.5 m off its surface (§2.6 lists the stand point); the frame's interactables require the feet inside `t6_cage` (bars pass rays, so R8 alone would allow use from outside, §8.5) |
| a check that rejects a player who did the right thing (3c B3) | `grip` never needs a held look direction after it starts; damage only pauses; progress is kept; the gauge shows it (§8.3) |
| cover normals inverted / tangent capsules (3c S1a, S1c) | §5.4 names each object's face; every point 0.55 m from its face and ≥ 0.1 m from walls, recomputed |
| pickups inside racks / out of reach (3c S1i) | the as-built pickup rule in the conventions; every item ≤ 1.3 m above its floor, ≤ 0.3 m from its approach face (§5.2 table); all `p6_*` in `check:reach` `use` |
| enemies path into pits (3c S1m) | the shaft's well is closed; the trench hatch pits, the six cargo slots, the coaming and the wet dock's band are nav obstacles; water deeper than 0.6 m has no nodes; ground queries use `raycastSolid` (water is no floor); the loader is rail-bound (no nav) |
| an exit stand-off on the only route (3c S1n) | trench exits are off-route (§2.6); stand-off never inside the hatch walkway |
| lines that contradict each other (3c S6) | §6 written against one fact list (§1 threads); Kessler never claims cameras (they are his) |
| sounds owned twice (3b item 7) | D25 + §8.12 owner column + `--scares` audit |
| waves that walk (3b item 8) | D26; §10.3 arrival bounds |
| tests written blind (3b) | §10.0 hook contract first; T builds to it from day one |
| budgets broken in big rooms (3b IB 6, 3c note) | §2.7.5 per space with enemies counted; the chamber is drawn only through `d6_pool` / `d6_stores`; **perf view of the chamber with the loader + 6 enemies on the greybox before dressing** (§11 gate) |
| checkpoint gaps | one per fight boundary + six boss milestones (D21) |

---

## 1. Fiction and tone

1. The tube door cycles open on the cable tunnel: two hundred metres of shotcrete, cable trays, the trunk — a yellow-banded
   armoured cable as thick as a wrist — running to the head-end. Kessler is still on the radio. She is tired. CHOIR said
   it would keep him company; it does.
2. A sailor crosses the far end of the tunnel, unhurried, weapon light on. Then two of them, in cover, patient, at fifty
   metres. Repeater Two: cable drums, a jointer's tent with its lamp still burning, the jointer's boots inside.
3. The second tunnel is dark: CHOIR took the mains, the navy's emergency strips are wired direct. A man waits at the
   head-end door, backlit, for the player to light himself up.
4. The head-end: racks of green lasers, a mimic board drawing the trunk from the station to the surface, a console in
   AUTOMATIC. On the console's outbound queue, a manifest nobody at Post 4 has ever seen. On the wall a navy phone handset
   hangs off its hook, and a man is whispering into the other end of it: Lieutenant Aas, unfitted, being walked somewhere,
   his hand put on things. Then the line goes dead.
5. The changeover crank: MANUAL. A brass key comes out. The vault: dry air, the hush of dehumidifiers, armoured cable on
   drums four metres high — one of them turning by itself — and the beach joint where the sea cable meets the station.
   Key A in; the doors swing; the fibre loom glows green. He pulls it out by hand. The green dies. Key B drops free.
   Every screen says it: BACKUP LINK — ACOUSTIC BUOY. The buoy's ping, slow until now, quickens. Through the hull, far
   off, a long deep thud and a hiss.
6. The stair door, Key B. A shaft going down twelve metres; the lamps on the landings die one below the other; something
   climbs toward him.
7. The moon pool: a flooded steel hall under 2.1 km of sea. A well of black water, a sea gate glowing far down in it, the
   buoy's tether running from a winch over a caged frame into the water and, beyond the great windows, rising into the
   dark toward a red beacon. The dock loader is lowering a container marked B-14 into the well. Its floods swing round
   and find him. "Dock loader. Personnel in the work area. Clear the area."
8. Pin. Pressure. Fire. The loader wants him on the dock; CHOIR's sailors want him in the cage. Units climb out of the
   well. When the tether parts, the ping stops mid-breath. Kessler: "That's it. He's down here with us and nowhere else."
9. Quiet. The dock console: the last thing the trunk sent — the manifest. Then the screen changes by itself: Post 4's
   sub bay, the cradle empty, the launch lock flooded, LAUNCH AUTHORITY: AAS, L. (LT.) — PALM — LIVE. CHOIR: "We did not
   need the trunk, Technician. We needed hands." TO BE CONTINUED.

Tone: the finale. Industrial-oceanic: armour wire, tar, dry nitrogen, wet steel, cold water, a crane's brake squeal, the
sea outside. Dread from patience and courtesy (CHOIR), from the machine that only does its job (the loader's PA), from a
whisper on a phone. No gore beyond 3c's. The loader is never a monster: it is the dock.

| Beat | Knows | Feels |
|---|---|---|
| tunnel, repeater | CHOIR's sailors hold the trunk route; they wait | focus, range, patience |
| tunnel B | darkness is shared; light is a choice | stealth, nerve |
| head-end | the trunk's mechanism (keys); something has been leaving the site; Aas is alive and being walked | intrigue, dread |
| vault | the fibre is gone; the buoy carries everything now; something happened at Post 4 | momentum, unease |
| shaft | it is waiting below | fear |
| moon pool | the backup is the tether; the loader is the dock; the frame is the target | spectacle, a fight for the place |
| the cut | CHOIR is sealed in Eridu Deep | relief |
| the console | it shipped its devices out for months; and its hands just left by boat | the floor drops again — the game is not over |

Threads (each readable alone — R3):

| Question | What 3d shows | Where |
|---|---|---|
| How is the trunk cut? | key chain → fibre → tether | Kessler's radio, plates on every lock, mimic board |
| What was leaving? | 14 batches of Clasps, through the moon pool, no consignee | `note6_queue` (optional), E1 (always), container `B-14` at the reveal, Sunde in E1 |
| Aas | alive, unfitted, being walked; then his palm launches the boat | `v6_handset` (optional), the feed OSD in E2 (always) |
| The boat | launched while the player was in the vault | `v6_thud` (optional), E2 (always) |
| Is CHOIR stopped? | sealed in Eridu Deep — but it does not need out | Kessler at the cut; CHOIR's last line |
| Sunde | alive, in the module; she made the Clasps' lot numbering; she thought they were for trials | E1 |
| Kessler's Clasp; who wanted 0031-H; the consignee; where the boat goes; what passes outside the windows | **not explained** (chapter 4) | — |

Canon kept: 61-hour clock (`CLOCK6` from `facts.testHour`); 2.1 km under the Barents Sea; roster 23 fitted, 19 linked,
4 no signal with Kessler in the shielded module; Sunde in the module; Aas the unfitted XO; the submersible launches on an
officer's palm; LED language (amber powered-not-linked, red blinking linked, off failed); enemy marks (red hunting, cyan
standby); CHOIR's voice by the level-2 choice. **Physics of the moon pool (canon note for REVISION 11, S10b):** a 1-atm
chamber cannot sit open to 210 bar of sea; the well is a **flooded wet well** whose floor (y −34) is the **inner door of a
two-door cargo lock** — inner door, a lock chamber, an outer sea door — so the chamber never sees sea pressure; the tether
passes the lock in pressure glands; cargo goes down in an unmanned lock cycle, which is why the dock's loader is
autonomous. The wet dock is the well's overflow: the last cycle's dewatering stopped at 34 % (the dock board says so).
**B-14** is the batch being lowered when the player arrives (it waits in the well for its lock cycle — "in transfer");
B-01 … B-13 left before. The sea itself is outside the great windows.

---

## 2. Layout (authoritative; separate world)

Compass as 3c: **north = +z, south = −z** (the player travels south down the tunnels), east = +x, west = −x.

### 2.1 Rooms (`L.room(id, name, x0, x1, z0, z1, h, { y0, floors })`)

| room id | display name | x | z | y0 | h | notes |
|---|---|---|---|---|---|---|
| `lock6` | TRUNK TUNNEL — HEAD-END TUBE | −4 … 4 | 0 … 6 | 0 | 3.0 | **start**; look of 3c's `tunnel5` (copy, not import). North wall: static `door6_tunnel` (3c's tunnel door, this side). South wall: `d6_tube`. |
| `tun6_a` | CABLE TUNNEL — SECTION 1 | −2.5 … 2.5 | −80 … 0 | 0 | 4.0 | 80 m straight, lit; long-range fight F1. |
| `rep6` | REPEATER 2 | −6 … 16 | −92 … −80 | 0 | 5.0 | the bend; open frames to both tunnels (no doors). Fight F2. |
| `tun6_b` | CABLE TUNNEL — SECTION 2 | 9.5 … 14.5 | −160 … −92 | 0 | 4.0 | 68 m straight, **dark** (emergency only). F3. |
| `bay6` | JOINT BAY 2 | 14.5 … 20.5 | −106 … −98 | 0 | 3.2 | F2's husks spawn here (script door), a reward afterwards. |
| `he6` | TRUNK HEAD-END | 2 … 22 | −180 … −160 | 0 | 4.5 | objective 1. `floors: [{ y: -1.4, box: [2.0, 3.6, -179.4, -175.4], nav: false, exits: [[3.0, 0, -174.8]] }]` (the trench's end + exit stair). |
| `vault6` | CABLE VAULT | −22 … 2 | −180 … −148 | 0 | 6.0 | objective 2. `floors: [{ y: -1.4, box: [-13.0, -11.8, -179.4, -158.0], nav: false, exits: [[-12.4, 0, -157.4]] }, { y: -1.4, box: [-13.0, 2.0, -179.4, -178.2], nav: false }]` (the cable trench, T-a and T-b). |
| `hold6` | CABLE STORE | −22 … −8 | −148 … −140 | 0 | 4.0 | spawn room (F4, F5), script door. |
| `shaft6` | STAIR SHAFT — MOON POOL | −28 … −22 | −172 … −162 | −12 | 15.2 | 12 m of switchback stairs round an open well. `floors` = the landings (§2.6). |
| `pool6` | MOON POOL | −76 … −28 | −196 … −148 | −20 | 22.0 | the boss arena; three decks (§2.6). |
| `stores6` | DOCK STORES | −76 … −64 | −148 … −140 | −12 | 3.6 | spawn room (W1), script door onto the north gallery. |
| `feed6` | POST 4 — SUB BAY (CAM 2) | 100 … 124 | 0 … 24 | 0 | 12.0 | **sealed feed set**: no doors, no portals, drawn only by the E2 feed pass; region ALWAYS forbidden. |

12 rooms (< 31). Room bounds start at `min(y0, floors[].y) − 0.5` (3c W4).

Non-room spaces (regions only): `outside` (the sea behind the chamber's south wall: the viewport proxy x −66 … −38,
y −24 … −10, z −222 … −196.4, `G.void`); `deep` (the well's water x −58 … −46, y −34 … −20.3, z −182 … −170, ALWAYS
forbidden); `enclosure` (the beach joint's inside x −13.0 … −11.0, y 0 … 2.2, z −179.8 … −178.8, ALWAYS); `voids` —
`vent6_rep` (5.6 … 6.4, y 5.0 … 5.8, −84.4 … −83.6), `vent6_vault` (−6.4 … −5.6, y 6.0 … 6.8, −160.4 … −159.6);
`feed6` (ALWAYS). Regions also: `trench` (the vault/head-end floors at y −1.4 … −0.05), `cage` (x −55 … −49, y −16 … −14,
z −172 … −166), `undercroft` (x −72.8 … −31.2, y −20 … −16.3, z −166 … −148.2), `wet` (the wet dock), `dark` (§2.7.3),
`dock`, `mid`, `gallery`. Envelope `GreyGrid([-80, -36, -226, 128, 13, 28])`; everything else solid.

**Plan check (D4)** — pairs touch only on boundaries: lock6/tun6_a z 0 (x −2.5 … 2.5); tun6_a/rep6 z −80 (x −2.5 … 2.5);
rep6/tun6_b z −92 (x 9.5 … 14.5); tun6_b/bay6 x 14.5 (z −106 … −98); tun6_b/he6 z −160 (x 9.5 … 14.5); he6/vault6 x 2
(z −180 … −160); vault6/hold6 z −148 (x −22 … −8); vault6/shaft6 x −22 (z −172 … −162); shaft6/pool6 x −28 (z −172 …
−162); pool6/stores6 z −148 (x −76 … −64). Non-touching pairs checked: rep6 (z ≥ −92) vs bay6 (z ≤ −98): 6 m; rep6
(x ≥ −6) vs vault6/hold6 (z ≤ −140): 48 m; bay6 (z ≥ −106) vs he6 (z ≤ −160): 54 m; vault6 (x ≥ −22) vs pool6 (x ≤ −28):
6 m of solid except the shaft (z −172 … −162); hold6 (x ≥ −22) vs stores6 (x ≤ −64): 42 m; shaft6 (z ≤ −162) vs hold6
(z ≥ −148): 14 m; stores6 (y −12 … −8.4) vs pool6's north wall: touch at z −148 only; feed6 is 76 m from everything.

**K / W4a / W4b level-internal additions** (no contract change beyond §8.1): water volumes (§2.9), cargo slots (§2.6.9), the
3c mechanisms (`nav: false` floors, exits, `StairDef.y0` / `nav: false`, obstacles, hatches) reused unchanged, and two
collider flags owned by the physics (K, §8.1): `mesh.userData.rayOnly` (water surfaces: rays and sight stop, bodies pass)
and `mesh.userData.moveOnly` (rails, bar guards, mesh guards, the tent's tarp: bodies stop, rays and sight pass), with
`physics.raycastSolid` for ground / headroom queries and the per-level kill height `physics.setKillY(−36)` (B6).

### 2.2 Doors (`DoorSpec.y` = floor of frame and sill)

| id | position (x, y, z) | wall | kind / style | rooms | leaf faces (interior spans along the wall) |
|---|---|---|---|---|---|
| `d6_tube` | (0, 0, 0) | z | std, pressure (hazard frame), lintel `HEAD-END TUBE`; `cycling` then open, then latched | lock6 / tun6_a | x −1.62 … 1.62 in lock6 −3.8 … 3.8, tun6_a −2.3 … 2.3 ✓; pocket ±1.675 (0.625 m from the tunnel walls) ✓ |
| `d6_bay` | (14.5, 0, −102) | x | std, `navy`, lintel `JOINT BAY 2`, **script only** (opens for F2, then auto) | tun6_b / bay6 | z −103.62 … −100.38 in tun6_b −159.8 … −92.2, bay6 −105.8 … −98.2 ✓ |
| `d6_he` | (12, 0, −160) | z | std, `navy`, lintel `TRUNK HEAD-END`, a 0.3 m porthole in the leaf (warm light: F3's backlight) | tun6_b / he6 | x 10.38 … 13.62 in tun6_b 9.7 … 14.3 (0.68 m), he6 2.2 … 21.8 ✓; pocket 10.325 … 13.675 ✓ |
| `d6_vault` | (2, 0, −168) | x | std, `navy`, lintel `CABLE VAULT — KEEP DRY` | he6 / vault6 | z −169.62 … −166.38 in he6 −179.8 … −160.2, vault6 −179.8 … −148.2 ✓ |
| `d6_hold` | (−14, 0, −148) | z | std, `navy`, lintel `CABLE STORE`, **script only** | vault6 / hold6 | x −15.62 … −12.38 in vault6 −21.8 … 1.8, hold6 −21.8 … −8.2 ✓ (CD3 ends x −16.5: 0.88 m from the leaf end) |
| `d6_shaft` | (−22, 0, −169.8) | x | std, pressure (hazard), **interlock**: `locked`, panel `MOON POOL ACCESS — INTERLOCK KEY B`; Key B unlocks it (then auto) | vault6 / shaft6 | z −171.42 … −168.18 in vault6 ✓, shaft6 −171.8 … −162.2 ✓ (pocket −171.475 … −168.125: 0.325 m from the shaft's south face); opening −170.6 … −169.0 lands on landing L0 (z −171.8 … −168.4) ✓ |
| `d6_pool` | (−28, −12, −169.8) | x | std, pressure (hazard), auto, 0.3 m porthole (the chamber's light) | shaft6 / pool6 | z −171.42 … −168.18 in shaft6 ✓ and pool6 −195.8 … −148.2 ✓; opening lands on the shaft bottom (y −12, whole floor) and the east gallery (x −31.2 … −28.2, y −12) ✓ |
| `d6_stores` | (−70, −12, −148) | z | std, `navy`, lintel `DOCK STORES`, **script only** | pool6 / stores6 | x −71.62 … −68.38 in pool6 −75.8 … −28.2, stores6 −75.8 … −64.2 ✓; opening lands on the north gallery (z −151.2 … −148.2, y −12) ✓ |

`cyclingPrompt` values (3b W4): `d6_tube` in A `Tube cycling`. Interlock prompts (story-set, §8.5): `d6_shaft`
`Interlock — key B` (no key: `Interlock key B required`). Static sealed props (`sealedDoor()`): `door6_tunnel` (0, 0, 6)
z, panel `TRUNK TUNNEL — SEALED — CO RELEASE` (the way back is latched in 3c too).
Rule (b) note: `d6_pool`'s leaf pocket lies in the shaft's west wall below landing L2 (y −6) and the chamber's east wall
below the east gallery (y −12); both wall faces are continuous from y −20 / −12 to the ceilings ✓.

### 2.3 Triggers (feet boxes)

| id | x | z | y | use |
|---|---|---|---|---|
| `t6_lock` | −3.8 … 3.8 | 0.2 … 5.8 | −1 … 3 | start |
| `t6_tube` | −2.3 … 2.3 | −8.0 … −1.0 | −1 … 3 | arms the `d6_tube` latch (keep z < −0.6) |
| `t6_tun_mid` | −2.3 … 2.3 | −26.0 … −18.0 | −1 … 3 | `v6_crossing`, F1 |
| `t6_tun_end` | −2.3 … 2.3 | −79.8 … −70.0 | −1 … 3 | |
| `t6_rep` | −5.8 … 15.8 | −91.8 … −80.2 | −1 … 4 | Kessler's repeater line |
| `t6_rep_in` | −5.8 … 15.8 | −91.8 … −81.5 | −1 … 4 | F2 (feet past the opening) |
| `t6_tunb` | 9.7 … 14.3 | −159.8 … −92.2 | −1 … 3 | dark tunnel |
| `t6_tunb_dark` | 9.7 … 14.3 | −159.8 … −96.0 | −1 … 3 | F3 spawn (the walk-out) |
| `t6_tunb_sentry` | 9.7 … 14.3 | −132.0 … −124.0 | −1 … 3 | sentry wake |
| `t6_bay` | 14.7 … 20.3 | −105.8 … −98.2 | −1 … 3 | |
| `t6_he` | 2.2 … 21.8 | −179.8 … −160.2 | −0.5 … 3 | head-end beats |
| `t6_phone` | 18.8 … 21.8 | −166.5 … −161.5 | −0.5 … 3 | `v6_handset` proximity |
| `t6_vault` | −21.8 … 1.8 | −179.8 … −148.2 | −0.5 … 5 | vault beats |
| `t6_trench` | −13.0 … 3.6 | −179.4 … −158.0 | −1.6 … −0.2 | the trench (crouch toast at the hatch landing, rules) |
| `t6_hatch_v` | −13.6 … −11.2 | −158.0 … −156.4 | −0.5 … 3 | the walkway north of the vault hatch (prompt, stencil) |
| `t6_shaft` | −27.8 … −22.2 | −171.8 … −162.2 | −12.5 … 3 | |
| `t6_shaft_l1` | −27.8 … −22.2 | −171.8 … −162.2 | −12.5 … −2.5 | `v6_shaft_lights`, F6 (first time below L1) |
| `t6_shaft_bot` | −27.8 … −22.2 | −171.8 … −162.2 | −12.5 … −10.0 | `cp6_shaft` |
| `t6_reveal` | −31.2 … −28.2 | −172.0 … −167.0 | −12.5 … −9.0 | **the reveal** (first entry onto the east gallery) |
| `t6_floor` | −75.8 … −28.2 | −195.8 … −148.2 | −21.6 … −13.5 | in the chamber below the galleries (dock, wet dock, undercroft, mid deck): the hostile start |
| `t6_cage` | −55.0 … −49.0 | −172.0 … −166.0 | −16.5 … −13.0 | the frame's interactables require the feet here (§8.5) |
| `t6_wet` | −66.0 … −38.0 | −194.0 … −182.4 | −21.6 … −19.5 | wading region (also `Level.water`) |
| `t6_windows` | −66.0 … −38.0 | −195.8 … −190.0 | −21.6 … −19.0 | `v6_window` |
| `t6_console` | −46.0 … −42.0 | −160.4 … −158.6 | −16.5 … −13.5 | the ending's stand |

### 2.4 Maps (1 character ≈ 1 m in x; z per line as noted; `d` door, `S` sealed prop, `H` hatch, `=` glass, `#` grating /
trench under the floor, `^` stair up, `o` drum, `B` beach joint, `W` winch, `C` cage)

Deck y 0 — the tunnels (1 line ≈ 8 m in z):

```
x:      -6  -2.5 0 2.5    9.5 12 14.5  20.5
z=+6          +-S-+                         door6_tunnel (sealed, the way back)
z= 0          | d |  lock6 → d6_tube (0,0,0)
              | | |
z=-24         |JB1|  tun6_a, 80 m: frames every 16 m, JB1..4, DT1..2
z=-40         | |J|
z=-56         |J| |
z=-80   +-----+   +------------+
        | RB  DS2   LC1    DS1 |  rep6 (REPEATER 2): drums, crates, jointer's tent [T] by the east wall
z=-92   +----------------+   +-+
                         | d |  tun6_b, 68 m, DARK — d6_bay east at z -102 → bay6 (x 14.5..20.5)
z=-110                   |R  |  RH1 (west)
z=-126                   |  R|  RH2 (east), sentry dock overhead at z -134
z=-142                   |R  |  RH3
z=-160          +--------+ d +--------+   d6_he (12,0,-160)
```

Deck y 0 — head-end, vault, shaft top (1 line ≈ 2 m in z):

```
x:  -28  -22        -14   -12.4      -4    2     5          15     22
z=-140    +---------------------+                        (hold6 north of d6_hold)
          |   CABLE STORE (hold6)|
z=-148    +-------d--------------+-----------+            d6_hold (-14,0,-148)
          | o CD3                 DH  DH     |
z=-152    | o                      NR        |
z=-156    | o CD1          H (hatch6_vault)  |
          |                #                 +----d6_he (12,0,-160)--+
z=-162 +--+ o CD2          #                 | locker    R1 ======   | phone (east wall)
       |^ |                #  G2             |                       |
z=-168 |SH d6_shaft (-22,-169.8)  # G1     d6_vault (2,0,-168)  R2 ===|  SW (switch, east wall)
       |  |                #                 |                       |
z=-172 +--+                #                 |                       |
          |          [B]####### G3 ##########H(hatch6_he)  console   |
z=-180    +------------------------------------+-----------------------+
                                          (trench T-b runs under the south strip, T-c ends under hatch6_he)
```

Shaft (section along z, looking west; y up) — switchback, flights 2.0 m wide on the west (x −27.8 … −25.8) and east
(x −24.2 … −22.2) halves round a 1.6 m open well:

```
 y  0   L0 (south, z -171.8..-168.4) ── d6_shaft (vault, east wall) ── F1 (west) ↓ north
 y -3                                      L1 (north, z -164.4..-162.2) ── F2 (east) ↓ south
 y -6   L2 (south)  ── F3 (west) ↓ north
 y -9                                      L3 (north) ── F4 (east) ↓ south
 y -12  bottom (whole floor) ── d6_pool (west wall, z -169.8) → the chamber's east gallery
```

Moon-pool chamber, **dock deck y −20** (1 line ≈ 2 m in z; the mid deck above is shown dotted `:`; `SLn` = cargo slot `sl6_n`):

```
x:  -76 -72 -68  -64 -60 -58.4    -52    -45.6 -42  -38 -36 -32 -28.2
z=-148 +--------------------------------------------------------------+
       |::::::::::::::::: UNDERCROFT (mid deck overhead y -16) :::::::|  P1 (-64..-62), P2 (-42..-40) pumps
z=-156 |::: P1 ::::::::::::::::: W (winch, on the mid deck) :::: P2 :::|
z=-166 |:::::^ ST6_M::::::::::::::::::::::::::::::::::::::::::^ST6_M2::|  stairs down south from the mid deck edge
z=-170 |      ^             +====coaming====+                 ^       |
       |  [SL2]   ladder LW>|  THE WELL     |<LE ladder   [SL4]       |  SL2 (-74..-68, z -176.4..-174)
z=-176 |                    | 12 x 12 m     |                         |  SL4 (-36..-30, z -176.4..-174)
       |  [SL1]             |  13.7 m deep  |             [SL3]       |  SL1 / SL3 (z -182..-179.6)
z=-182 |       +-ramp-------+====coaming====+--------ramp-+           |
       |       | W  ~~~~ sluice channel 1.0 m ~~~~~~~~~ E |           |  wet dock x -66..-38, z -194..-182.4
z=-188 |       | E  ~~~ [SL5] ~~~~~~ [SL6] ~~~~~~~~~~~~~~ A |           |  floor -20.8 (0.5 m water)
z=-194 |       +-S--------------------------------------T-+           |
       |  window walk (dry, y -20)  ==== SEA WINDOWS 24 x 3.6 ====    |  viewport x -64..-40
z=-196 +--------------------------------------------------------------+
```

**Mid deck y −16** and **galleries y −12**:

```
x:  -76 -72.8 -70.6        -55  -52  -49              -35 -31.2 -28.2
z=-148 +-d6_stores(-70)------------------------------------------------+
       |G| north gallery y -12 (z -151.2..-148.2), parapets x -66..-58 and -46..-38 |
z=-152 |G|^ST6_W     [MC1]       W winch          [MC2]  ^ST6_NE     |G|
z=-158 |G+landing       console6 (-46..-42, z -158.6..-157.8)  landing+G|  landings y -12 join the side galleries
z=-162 |G|   mid deck y -16 (x -72.8..-31.2, z -166..-148.2)          |G|
z=-166 |G|^ST6_M ====bar guard 2.0 m==+ C C +====bar guard====^ST6_M2  |G|  stairs at the edge (x -72..-70, -34..-32)
z=-172 |G|                            | CAGE| (x -55..-49, z -172..-166, over the well)  |G| ← d6_pool (-28,-12,-169.8)
       |G| west gallery y -12                                  east gallery |G|  parapets: §2.6.9
z=-196 +-+--------------------------------------------------------------+-+
```

Section through the chamber at x −52, looking west (y up):

```
 y +2  ═════════════════════════ roof ═════════════════════════
 y -4  ══ runway rails (x -75.4 / -28.6) ═══ BRIDGE (z travel -192..-152) ══ trolley + pod (y -5..-4) ═
           four ropes ║║   grab (2.4 x 2.4 x 1.6; top y -6.4 raised … bottom y -20 on the dock)
 y -12 ─ north gallery ─┐                                              (east gallery at x > -31.2)
 y -16 ── mid deck ── W ─ trough ─┤C│ (cage over the well, sheave at z -171.6)
 y -19.2           ┌coaming┐ tether ║            ┌coaming┐  wet dock -20.8 │ window walk -20
 y -20  dock ──────┘       └~~~~~ water -20.3 ~~~~┘       └~~~~~~~~~~~~~~~~┘ ═ windows (z -196) ═
 y -34             sea gate (closed; gland for the tether; ring of amber lamps) │ the tether outside rises past the windows
```

### 2.5 Route graph and length

```
[cp6_start] lock6 ─tube opens─▶ tun6_a ══tube latches══▶ (v6_crossing) F1: 2 soldiers + 2 units, 25–50 m ─▶ [cp6_tunnel]
rep6 (v6_tent): F2 soldier + units from bay6 + vent skitters ─▶ [cp6_rep] ─▶ tun6_b DARK: F3 soldier at the far door + sentry
he6 [cp6_he]: (note6_queue) (v6_handset: Aas) ─ crank 3 s → MANUAL → KEY A ─▶ F4 (from hold6 through the vault) ─▶ [cp6_manual]
vault6: (v6_drum) ─ Key A → enclosure → pull 3 s → KEY B ─▶ (v6_ring, v6_thud) F5 (hold6 + trench skitters) ─▶ [cp6_pulled]
   optional: hatch6_vault → trench (42 m crouch, reward) → hatch6_he (dogged from below) → he6 (never a dead end)
d6_shaft (Key B) ─▶ shaft6 (v6_shaft_lights, F6 unit climbing) ─▶ [cp6_shaft] ─▶ d6_pool ─▶ east gallery: REVEAL (v6_well_eyes)
pool6 BOSS: hostile start → W1 ─ pin (W2, stage 2, lights_out6) ─ pump 6 s (W3, stage 3) ─ fire → TRUNK DARK
            rams ×2 → pod opens → loader destroyed      milestones → [cp6_m1 … cp6_m5]
both + calm ─▶ [cp6_quiet] (v6_window) ─▶ console6 ─▶ E1 manifest ─▶ E2 empty cradle ─▶ CHOIR ─▶ THE TRUNK / TO BE CONTINUED
```

Length (estimate, first-time main route): arrival 0.4; tunnel A + F1 2.2; repeater F2 1.2; tunnel B dark + F3 1.6;
head-end (queue, handset, crank, F4) 2.2; vault (enclosure, pull, F5) 2.0; shaft 0.9; moon pool boss 4.4; quiet + ending
0.9 ≈ **15.8 min**; a reader who takes the trench and every readable ≈ 18 min; a runner ≈ 9 min.

### 2.6 Dressing per space (objects with colliders are given as boxes; every use point is 0.4–0.5 m off its surface)

General: **`tunnel_shotcrete`** (new: sprayed-concrete lining with rebound texture, damp streaks, chalk survey marks) in
the tunnels; **`cable_armour`** (new: galvanised armour wires in a lay, tar serving, yellow bands every 2 m) for the trunk
and the sea cable; `navy_grey` frames and doors; `deck_nonslip` and `floor_concrete`; **`dock_steel`** (new: worn heavy
deck plate, wet sheen, weld seams, painted walkways) in the chamber; **`crane_yellow`** (new: chipped safety-yellow with rust
runs and hazard bands) on the loader; **`rope_wire`** (new) for the ropes; **`container_navy`**, **`container_orange`**
(new: corrugated painted steel, stencils `HALCYON BIO-SYSTEMS DIV.`, `B-01 … B-14`); `deck_grate` (3c) on galleries, stairs,
the trench; `hull_white` (3c) on the chamber's curved upper walls. Emergency fittings with red lenses; stencils `navy`
style. Cable trays and every collider-bearing prop **start at y 2.0 in the tunnels** (the body corridor is the full tunnel
width up to 2.0 m).

#### 2.6.1 lock6 (interior x −3.8 … 3.8, z 0.2 … 5.8)
3c `tunnel5` look: cable trays both walls (y 2.0 / 2.6), the trunk on the west tray into a cable transit beside `d6_tube`
(transit box x −2.7 … −2.0 in the south wall, y 2.0 … 2.6); stencil `TRUNK — HEAD-END 200 M` on the west wall facing +x;
`d6_tube` panel `HEAD-END TUBE — CYCLING` → `OPEN`; `p6_lock_ammo` on a tray-end shelf. Spawn `mk6_start` (0, 0, 3.0)
yaw 0 (facing the tube door).

#### 2.6.2 tun6_a (interior x −2.3 … 2.3, z −79.8 … −0.2)
Shotcrete lining, concrete invert with a flush grated drain down the centre line; trays west y 2.0 / 2.6 / 3.2, east
y 2.0 / 2.6 with the **trunk** on the east tray at y 2.2 (readable at eye level from anywhere in the tunnel); structural
**rings** every 16 m at z −16, −32, −48, −64 (jambs 0.3 m proud, x ±2.0 … 2.3, z ±0.2, header y 3.4 … 4.0 — visual
rhythm, too shallow for cover); caged fluorescent fittings every 8 m (emissive), survey marks, a dewatering pipe on the
west wall at y 0.2 (0.15 m, walkable kerb).
Cover objects: **junction boxes** (h 1.8, high) JB1 x −2.3 … −1.4, z −24.8 … −23.2; JB2 x 1.4 … 2.3, z −40.8 … −39.2;
JB3 x −2.3 … −1.4, z −56.8 … −55.2; JB4 x 1.4 … 2.3, z −70.8 … −69.2 (corridor beside each 2.8 m); **drum trolleys**
(a Ø 1.2 cable drum on a 0.1 m trolley, h 1.3, low) DT1 x 0.4 … 2.0, z −30.5 … −29.5; DT2 x −2.0 … −0.4, z −62.5 … −61.5
(corridor beside each 2.7 m). Pickups on small bracket shelves on the JBs' corridor faces at y 1.0 (≤ 0.3 m from
the face; the JB tops at 1.8 are out of the pickup rule's 1.4 m — S1b). The far end opens into rep6
through the full tunnel width.

#### 2.6.3 rep6 (interior x −5.8 … 15.8, z −91.8 … −80.2, ceiling 5.0)
The bend: a vaulted shotcrete chamber. **RB** repeater bank (line-amplifier cabinets, green LEDs) against the west wall
x −5.8 … −4.6, z −91.0 … −83.0 (h 2.2); **DS1** large cable drum on its cradle x 9.0 … 11.6, z −83.0 … −81.6 (h 2.6);
**DS2** x −2.0 … 0.6, z −90.4 … −89.0 (h 2.6); low crates **LC1** x 5.0 … 6.4, z −89.6 … −88.4 (h 1.2) and **LC2**
x 7.0 … 8.2, z −82.8 … −81.6 (h 1.2) — all ≥ 3 m off the straight line from the north opening (0, −80, tunnel A) to
the south opening (12, −92, tunnel B); the **jointer's tent** x 12.4 … 14.8, z −85.6 … −83.2 (yellow tarp, h 2.2, frame
poles; tarp walls **move-only**: rounds pass, D14) with its work lamp still on, a splicing table, the jointer (J. Rød, a
**Halcyon Subsea** cable jointer — orange coverall, not on the navy roster — a body, seated, slumped over the table, face
down; `v6_tent`) and `note6_jobcard` on the pole at the open north side (13.6, 1.4,
−83.15) facing +z; ceiling vent `vent6_rep` (6.0, 5.0, −84.0); an equipment shelf on the east wall x 15.4 … 15.8,
z −90.0 … −88.0, y 1.0 (two carbine boxes); first-aid box on the west wall at z −82.0 (x −5.6, y 1.0). Stencils `REPEATER 2
— 1.1 KM` and `HEAD-END ↓` at the north opening.

#### 2.6.4 tun6_b (interior x 9.7 … 14.3, z −159.8 … −92.2) — dark
As tun6_a, but the mains are dead (fittings dark, one hanging by its cable at z −118); **emergency**: red caged points
every 16 m (z −100, −116, −132, −148) and green-amber **floor strips** along both wall bases, continuous; the trunk's
yellow bands catch the red. **Repeater housings** (h 2.0, high, 1.4 m deep from the wall — deep enough that RH1 hides F2's
soldier from every point of rep6, §4.3) RH1 x 9.7 … 11.1, z −110 … −108; RH2 x 12.9 … 14.3, z −126 … −124; RH3 x 9.7 …
11.1, z −142 … −140 (corridor beside each 3.2 m). Sentry dock in the ceiling at (12.0, 3.9, −134.0). `d6_bay` in the east
wall at z −102. At the far end `d6_he`'s porthole glows warm (the backlight F3 is seen against). Pickups on bracket shelves on the RH corridor faces at y 1.0 (S1b).

#### 2.6.5 bay6 (interior x 14.7 … 20.3, z −105.8 … −98.2)
A side joint bay: a cable joint box on trestles (x 16.0 … 18.0, z −103.0 … −101.0, h 1.2), a coil of spare cable, a wall
shelf on the east wall (x 19.9 … 20.3, z −105.0 … −103.0, y 1.0) with `p6_bay_plate` and `p6_bay_ammo`. F2's two husks
spawn here at `mk6_bay_u1` (16.0, 0, −99.6) and `mk6_bay_u2` (18.6, 0, −99.6) (both ≥ 0.6 m clear of the joint box).

#### 2.6.6 he6 (interior x 2.2 … 21.8, z −179.8 … −160.2, ceiling 4.5)
Raised-floor computer room look (floor tiles over the trench), cold white light. **R1** OLT racks x 5 … 15, z −164.6 …
−164.0 (h 2.2), **R2** x 5 … 15, z −169.6 … −169.0 (h 2.2), green laser LEDs, fibre patch panels. **Console** along the
south wall x 8 … 16, z −179.8 … −178.8 (desk h 1.0); **mimic board** on the south wall above it x 7 … 17, y 1.6 … 3.6
(screen `mimic`, facing +z): the trunk drawn from `HEAD-END` through `VAULT — BEACH JOINT` to `SURFACE 2.1 KM`, and the
`ACOUSTIC BUOY — STANDBY` branch through `MOON POOL — TETHER`. **Outbound queue** screen on the console (9.0, 1.25, −179.0)
facing +z: interactable `note6_queue` "Read queue", use point (9.0, 1.25, −178.4), radius 1.3. **Changeover switch**
cabinet SW on the east wall x 21.0 … 21.8, z −172.0 … −170.0 (h 2.0): mode plate `HEAD-END MODE — AUTO | MANUAL`, a big
two-handed crank on its west face (20.95, 1.2, −171.0), the Castell key barrel beside it (`KEY A — RELEASED IN MANUAL
ONLY`); interactable `he6_switch` "Crank to manual", use point (20.5, 1.2, −171.0), radius 1.3. **Phone station** (a navy
sound-powered phone, howler, selector dial `HEAD-END / POST 4 / DOCK / CMD`) on the east wall (21.78, 1.4, −164.0) facing
−x, its handset hanging off the hook on its cord at (21.55, 0.85, −164.3); interactable `he6_phone` "Pick up handset",
use point (21.2, 1.1, −164.0), radius 1.5, enabled only while `v6_handset` runs. **Wall locker** NW x 2.4 … 4.0, z −160.8 …
−160.2 (h 2.0), door open, a navy vest on a hook: `p6_he_vest` (vest, "Put on vest") at (3.2, 1.3, −160.75), stand
(3.2, 0, −161.6). Shelf on the west wall x 2.2 … 2.6, z −173 … −171, y 1.0. Two carbine boxes on the console's east end at its north edge
(z −179.0, 0.2 m from the desk's north face). First-aid box on the east wall at (21.5, 1.0,
−176.0). **Under-wall crossing**: T-b passes under the he6 / vault6 wall at x 2.0 by 3c's built way of opening a wall below
floor level (the crawl under `d5_arm` — K verifies; a `check:reach` row walks T-b → T-c). **Trench exit**: stair `STAIR6_HE = { room: 'he6', x0: 2.4, x1: 3.6, z0: -177.6, dir: 1, risers: 5, rise: 0.28,
tread: 0.42, y0: -1.4, nav: false }` (z −177.6 → −175.5, y −1.4 → 0) under `hatch6_he` (lid 1.2 × 2.2 in the floor,
x 2.4 … 3.6, z −177.6 … −175.4, **dogged from below**, hinged on its south edge — open, it stands at z −177.6 … −177.7;
exit north), rails 1.0 m on its east (x 3.6) and south (z −177.6) sides (the west wall is 0.2 m away); top plate `TRENCH —
DOGGED FROM BELOW — ACCESS VIA VAULT`; underside interact `Open hatch` with its use point on the lid underside (3.0, −0.08,
−176.8), radius 1.6, enabled only with the eye below y −0.2 (3c S1j pattern).

#### 2.6.7 vault6 (interior x −21.8 … 1.8, z −179.8 … −148.2, ceiling 6.0)
The dry-room hush: dehumidifier hum, low blue-white light, dust in the lamp cones (`fx6_vault_dust`), floor of grey
epoxy with the trench as a flush grating strip. **Cable drums** (Ø 4.0 steel drums of spare sea cable on stands, h 4.4,
axis along z) **CD1** x −20.5 … −16.5, z −158.2 … −155.8; **CD2** x −20.5 … −16.5, z −164.2 … −161.8 (the one that turns —
`v6_drum`; its brake handle and ratchet pawl on its east stand at x −16.5); **CD3** x −20.5 … −16.5, z −152.2 … −149.8.
**Beach joint enclosure** BJ against the south wall x −13.2 … −10.8, z −179.8 … −178.6 (h 2.2): **bi-parting sliding
doors** on its north face (two 1.2 m leaves running in a guide channel z −178.6 … −178.5 out to x −14.4 … −13.2 and
−10.8 … −9.6 in front of the south wall — no sweep, so nobody at the lock is in their path; registered movers, colliders
in every state — S1j); a Castell lock barrel at (−12.0, 1.2, −178.55) — interactable
`vault6_lock` "Insert key A", use point (−12.0, 1.2, −178.1), radius 1.3 (without the key: plate prompt `Interlock key A
required`); inside, the **fibre loom**: the sea cable's 96 fibres fanned into a splice tray glowing laser-green, ending in
a heavy multi-pin connector with a T-handle, and the trapped **Key B** in a barrel that frees when the connector leaves
its housing — interactable `vault6_loom` "Pull the fibre", use point (−12.0, 1.1, −178.75), radius 1.3, enabled only
with the doors open. **Sea cable penetrator** on the south wall (−8.0, 1.0, −179.8): a flanged hull gland Ø 1.2, a small
armoured port beside it showing black water (`fx` none — a dark lens; see §2.8), the sea cable bending down into the
trench. **Dehumidifiers** DH1 x −6.0 … −4.0, DH2 x −2.0 … 0.0, both z −149.0 … −148.2 (h 2.0); **nitrogen racks** NR
x −4.0 … −2.0, z −152.0 … −150.8 (h 1.8) with a bracket shelf on its north face at y 1.0. A wall shelf on the east wall x 1.4 … 1.8, z −152 … −149.6, y 1.0. **Trench
grilles** G1 (−12.4, 0, −174.0), G2 (−12.4, 0, −164.0), G3 (−6.0, 0, −178.8) (lifting 0.8 × 0.8 grilles in the grating,
3b `sumpGrille`; G1 moved off the door-to-door line, S1g); every grille **drops shut 1.2 s after its skitter is out** and
its snap state is shut. Ceiling vent `vent6_vault` (−6.0, 6.0, −160.0).
**Cable trench** (3c crawl mechanism): T-a x −13.0 … −11.8 (z −179.4 … −158.0) and T-b x −13.0 … 2.0 (z −179.4 … −178.2)
at y −1.4, 1.35 m clear (crouch only), walls `hull_white`-free plain concrete with cable brackets, the sea cable running
along it, a 3 cm water film (decal + gloss), red LED strips at both floor edges, the buoy ping loud down here; T-c in he6
(§2.6.6). Entry **`hatch6_vault`** (lid 1.2 × 2.4 in the floor, x −13.0 … −11.8, z −160.4 … −158.0, opens from above,
two-way, **hinged on its south edge** — open, it stands at z −160.4 … −160.5, the exit north stays clear, S1f) over `STAIR6_T = { room: 'vault6', x0: -13.0, x1: -11.8, z0: -160.3, dir: 1, risers: 5, rise: 0.28, tread: 0.42,
y0: -1.4, nav: false }` (z −160.3 → −158.2, y −1.4 → 0; the top tread meets the floor edge z −158.0, the exit is north);
rails 1.0 m on the pit's west, east and south sides; interact `Open hatch` at (−12.4, 0.3, −157.5), radius 1.4, from the
floor north of the pit; stencil `CABLE TRENCH — TO HEAD-END — CROUCH` on the pit frame facing +z. The pit is 8 m north of
the door-to-door line (d6_vault → d6_shaft runs at z ≈ −168 … −170) and 3.5 m east of the drums: never on the route. Both
hatch pits are nav obstacles from load (3c S1m). **Reward** at the T-a/T-b corner: a dead Halcyon Subsea jointer (M. Lie,
orange coverall; a static prop with a 0.15 m collider, not an enemy wreck) at (−12.4, −1.4, −177.2) along T-a, his kit: `p6_trench_plate_1/2`, `p6_trench_ammo_1/2`,
`p6_trench_med` (§5.2), `note6_jointer` (a notebook on a cable bracket (−12.85, −0.9, −176.4) facing +x).
Length: hatch → corner 21 m, corner → he6 15 m, he6 run 2 m, stairs 2 × 2.1 m ≈ 42 m (≈ 23 s at 1.8 m/s): readable by its
strips alone (§2.7.3).

#### 2.6.8 shaft6 (interior x −27.8 … −22.2, z −171.8 … −162.2; y −12 … 3.2)
Bare painted steel, `deck_grate` treads, a 1.6 m well down the middle (x −25.8 … −24.2) between the halves — **closed**
(D32): a **2.4 m mesh guard** (move-only: bodies stop, rays and sight pass, so the look down the well stays) on every
well edge of every flight and landing, and over the two landing edges that would drop onto a flight: **L0's and L2's
north edges on the east half** (x −24.2 … −22.2 at z −168.4, over F2's / F4's feet — S1i). The outer flight sides are the
walls. Landings (`floors`): **L0** y 0 [−27.8, −22.2, −171.8, −168.4] (the vault door);
**L1** y −3 [−27.8, −22.2, −164.4, −162.2]; **L2** y −6 [−27.8, −22.2, −171.8, −168.4]; **L3** y −9 [−27.8, −22.2,
−164.4, −162.2]; **bottom** y −12 [−27.8, −22.2, −171.8, −162.2] (the chamber door). Flights (all rise 0.3 × 10,
tread 0.4 = 4.0 m run, 36.9°):
`F1 = { room: 'shaft6', x0: -27.8, x1: -25.8, z0: -164.4, dir: -1, risers: 10, rise: 0.3, tread: 0.4, y0: -3 }` (L1 → L0),
`F2 = { x0: -24.2, x1: -22.2, z0: -168.4, dir: 1, …, y0: -6 }` (L2 → L1),
`F3 = { x0: -27.8, x1: -25.8, z0: -164.4, dir: -1, …, y0: -9 }` (L3 → L2),
`F4 = { x0: -24.2, x1: -22.2, z0: -168.4, dir: 1, …, y0: -12 }` (bottom → L3).
Headroom: every flight and landing is 6.0 m below the one above it on the same half (5.7 m clear under the slab); the
bottom door (y −12 … −9.6) is under L2 (y −6); 2.7 m clear above the bottom floor under L3. **Landing lamps** (caged,
mains, the ones that die): LL0 (−27.7, 2.4, −170.6), LL1 (−27.7, −0.6, −163.3), LL2 (−27.7, −3.6, −170.6), LL3 (−27.7,
−6.6, −163.3), LLB (−27.7, −9.6, −166.0); **emergency** (hard-wired): amber nosing strips on every tread, landing-edge
strips, a red point at L2 and at the bottom. A fire-point cabinet on the east wall at L2 (x −22.6 … −22.2, z −171.6 …
−170.6, y −6 … −4.6) with `p6_shaft_ammo` on its shelf (1.0 m above L2, 0.2 m from the cabinet face); a box at the bottom
south-west (x −27.8 … −27.0, z −171.8 … −171.0, h 0.8) with `p6_shaft_med`. The guarded well is a nav obstacle on every
level. No way down but the stairs.

#### 2.6.9 pool6 — the moon-pool chamber (interior x −75.8 … −28.2, z −195.8 … −148.2; y −20 … +2)
The largest space of the game: a flooded steel hall, three decks, the well, the windows, the gantry overhead.

**Decks (`floors`):**

| deck | y | plan box(es) | notes |
|---|---|---|---|
| dock | −20 | [−75.8, −28.2, −195.8, −148.2] | the room's main floor; its nav grid is cut over the wet dock and the coaming by **nav obstacle boxes in the dock band only** (y −19.25 … −18.5 over x −66 … −38, z −194 … −182.4 and over the coaming footprint x −58.4 … −45.6, z −182.4 … −169.6 — clear of the wet floor's band −20.6 … −19.3, `level/nav.ts:76-88`; S1e); includes the **undercroft** under the mid deck and the **window walk** z −195.8 … −194.0 |
| wet dock | −20.8 | [−62.4, −41.6, −194.0, −185.5] | flat floor, 0.5 m of water; ramps W x −66.0 … −62.4 and E x −41.6 … −38.0 (z −194.0 … −182.4) from −20.0 to −20.8 (12.5°); the **sluice channel** x −62.4 … −41.6: a **sloped side** z −185.5 → −184.0 from −20.8 down to −21.3 (18.4°, walkable both ways — B3) and a flat bottom z −184.0 … −182.4 at y −21.3 (1.0 m of water; no nav node where `wade` > 0.6) |
| mid deck | −16 | [−72.8, −31.2, −166.0, −148.2] + the cage cantilever [−55.0, −49.0, −172.0, −166.0] | 0.3 m slab; the undercroft below has 3.7 m |
| galleries | −12 | east [−31.2, −28.2, −195.8, −148.2], west [−75.8, −72.8, −195.8, −148.2], north [−72.8, −31.2, −151.2, −148.2], landings [−35.0, −31.2, −159.6, −157.6] and [−72.8, −70.6, −159.6, −157.6] | 3.0 m wide; rails 1.1 m (move-only) on the inner edges except where parapet plates are (below) |

**The well**: opening x −58 … −46, z −182 … −170 (12 × 12), water at −20.3; its floor is the **inner door of a two-door
cargo lock** at y −34 (a steel iris with a ring of eight amber lamps and the tether's pressure gland at its centre-north
(−52, −34, −171.9)); below it a lock chamber and an outer sea door (never seen) — so the chamber never sees sea pressure
(S10b). The **coaming** is 0.4 m thick, x −58.4 … −45.6, z −182.4 … −169.6, top y −19.2 (0.8 m above the dock, 1.6 m
above the wet dock), solid (stops rounds), hazard-striped; on it a **1.6 m vertical-bar guard flush with the coaming's
outer face** (move-only; no horizontal mid-rail; top y −17.6 = **2.4 m above the dock**, 3.2 m above the wet floor, 3.7 m
above the channel floor) — the coaming top is behind the bars and cannot be stood on (B1). Two **ladders** on the inner
walls (west wall x −57.8 at z −176; east wall x −46.2 at z −176) from the lock door to the coaming top, each with a
self-closing **ladder gate** in the guard (0.9 m wide, the guard's full height; it swings open only toward the well, only
for a kinematic climber, and shuts behind him — the player can never open it); the 3 exit rungs down the coaming's outer
face are **visual only (no collider)**; the climber steps down kinematically to the exits `mk6_lw_exit` (−59.3, −20,
−176.0), `mk6_le_exit` (−44.7, −20, −176.0). **Sluice ports** in the coaming's south face below the water: the wet dock is
the well's overflow (the dock board's `DEWATERING 34 % — STOPPED`).

**The wet dock**: x −66 … −38, z −194 … −182.4, recessed (flat floor −20.8), water −20.3; kerb faces 0.8 m to the dry
dock on its north side (x −66 … −58.4 and −45.6 … −38) and its south side (the window walk); ramps W and E; the channel's
sloped side lets a wader walk out anywhere along it (B3). Two cargo slots in it (`sl6_5`, `sl6_6`). Wading rules D13.

**Sea windows**: one viewport pane 24 × 3.6 m in the south wall, x −64 … −40, y −19.6 … −16.0, z −195.8, normal +z, with
two 0.3 m mullions at x −56 and −48 (three bays) and a thick frame; outside, the station's floods on the sea floor and
the **tether** rising from the cargo lock's outer sheave (−52, −40, −206) toward the surface, its red beacon at y +18.
The window walk (dry, y −20) runs along it.

**The mid deck** (y −16): the **winch** WI x −54.0 … −50.0, z −154.0 … −150.0 (h 3.0; a ridged steel hood — its ridge
is standable, which is harmless at 15.6 m from the well, §2.10), the tether paying off its drum into a **trough** (x −52.3
… −51.7, h 0.25, walkable over) running south from z −150 to the cage; crates **MC1** x −66.0 … −64.8, z −160.0 … −158.8
(h 1.2) and **MC2** x −40.0 … −38.8, z −160.0 … −158.8 (h 1.2); the **dock console** `console6` (desk x −46.0 … −42.0,
z −158.6 … −157.8, h 1.0; a 3.2 × 1.4 m screen on a stand **above the desk's north edge** (screen plane z −157.9, facing
−z), labelled `HEAD-END REPEATER — DOCK`, bullet-resistant glass: stars, holds); interactable `console6` "Use console"
at (−44.0, −15.0, −159.1), radius 1.3, enabled only in the ending's pending state (§4.9); stand `mk6_end_stand` (−44.0,
−16, −159.6) yaw 180° (facing +z). South edge: a **2.4 m bar guard** (move-only) x −68.0 … −55.0 and −49.0 … −36.0
(B1: 1.8 m above a corpse ≥ 1.7); 1.1 m rails x −72.8 … −72.0, −70.0 … −68.0, −36.0 … −34.0, −32.0 … −31.2 (≥ 10.3 m
from the well, §2.10); the stair heads at x −72.0 … −70.0 (`ST6_M`) and −34.0 … −32.0 (`ST6_M2`); the **cage** in the
middle. East and west edges (x −31.2 / −72.8, the drop to the dock under the side galleries): 1.1 m rails; the space
under `ST6_NE` / `ST6_W` is closed by a mesh screen. North edge: the chamber wall.

**The tether frame and its cage** (cantilevered over the well's north edge): platform x −55 … −49, z −172 … −166, y −16;
a **2.6 m bar cage** (move-only) on its west (x −55), east (x −49) and south (z −172) sides with a **bar roof at y −13.4**
(a corpse inside cannot become a step out of it), its north side open x −53.0 … −51.0 (bars x −55 … −53 and −51 … −49 at
z −166); the trough runs across it to the **sheave** (−52.0, −15.2, −171.6) where the tether turns down into the well (it
hangs at z −171.9). On the trough: the **shear** SH x −52.6 … −51.4, z −169.0 … −168.0 (h 1.4) — a hydraulic guillotine
round the tether, its **safety pin** on its east face (−51.38, −15.0, −168.5), its pressure gauge (screen `gauge`,
0 → 210 bar) on top; the **hand pump** stand PS x −54.2 … −53.4, z −169.0 … −168.2 (h 1.0) with a long lever handle; the
**firing lever** post LV x −50.5 … −50.0, z −169.0 … −168.4 (h 1.3), a red lever under a hinged guard. Interactables
(feet in `t6_cage` required — enforced by the interactables' `requireRegion`, §8.5): `frame6_pin` "Pull safety pin" at
(−51.0, −15.0, −168.5), `frame6_pump` "Pump" at (−53.8, −15.0, −167.8), `frame6_lever` "Fire the shear" at (−50.25,
−14.8, −167.9), each radius 1.2. A box in the cage's north-west corner (x −54.8 … −54.2, z −167.2 … −166.2, h 1.0) holds
`p6_cage_ammo` / `p6_cage_plate`. A hard-wired work lamp over the frame (spot) and a lit instruction plate `TETHER SHEAR —
1 PIN — 2 PRESSURE 210 BAR — 3 FIRE` on the cage's north bars facing +z.

**Stairs** (`StairDef`, all along z, rise 0.2857 × 14 = 4.0 m, tread 0.4, run 5.6 m, 35.5°):
`ST6_NE = { room: 'pool6', x0: -35.0, x1: -33.2, z0: -152.0, dir: -1, risers: 14, rise: 0.2857, tread: 0.4, y0: -16 }`
(mid deck z −152 → landing z −157.6 at y −12, joining the east gallery);
`ST6_W = { x0: -72.6, x1: -70.8, z0: -152.0, dir: -1, …, y0: -16 }` (→ the west landing, joining the west gallery);
`ST6_M = { x0: -72.0, x1: -70.0, z0: -171.6, dir: 1, …, y0: -20 }` (dock z −171.6 → mid deck edge z −166.0);
`ST6_M2 = { x0: -34.0, x1: -32.0, z0: -171.6, dir: 1, …, y0: -20 }`.
ST6_W (z −152 … −157.6) and ST6_M (z −166 … −171.6) are both at the mid deck's west end without overlap; ST6_NE and
ST6_M2 likewise in the east. 0.8 m of floor in front of every stair foot.

**Galleries** (y −12): 3.0 m wide; **parapet plates** (h 1.1, solid — low cover): east gallery inner edge x −31.2 at
z −192 … −184 and −182 … −174; west gallery x −72.8 at z −192 … −184, −182 … −174 and −168 … −160; north gallery
z −151.2 at x −66 … −58 and −46 … −38; rails elsewhere. The galleries are **out of the grab's reach** (§2.6.10). **Dock
ammo lockers** (fire-point lockers, story-owned interactables "Take ammo", **re-armed at every boss restore** — B5):
`locker6_e` on the east gallery wall (−28.4, −11.0, −194.6) (carbine 60), `locker6_w` on the west gallery wall (−75.6,
−11.0, −194.6) (carbine 30 + shells 8), `locker6_n` on the north gallery wall under the dock board (−52.0, −11.0,
−148.4) (carbine 60 — S9); use points 0.5 m out from each, radius 1.3; beside each a medkit / plate pickup (§5.2).

**The undercroft** (dock level under the mid deck, z −166 … −148.2): pump housings **P1** x −64.0 … −62.0, z −156.0 …
−154.0 and **P2** x −42.0 … −40.0, z −156.0 … −154.0 (h 1.8) with a tool shelf on each north face (y −19.0), a hose reel,
the drain sump grille, the dewatering panel with `note6_transfer`; out of the grab's reach (it cannot pass the mid deck);
its point light is hard-wired and on in **all** qualities (the refuge, S13).

**Cargo slots** (`Level.dock`, §8.1; painted yellow hatched outlines on the deck, stencil `CARGO SLOT n`; containers
6.0 × 2.4 × 2.6, long axis x; a slot is "free" or holds one container; every slot is ≥ 6.5 m from the coaming, §2.10, and
off every route corridor; **all six slot boxes are permanent nav obstacles** (occupied or not), in their floor's band —
S6a):

| slot | box (x, z) | floor y | at load |
|---|---|---|---|
| `sl6_1` | −74 … −68, −182.0 … −179.6 | −20 | container B-09 |
| `sl6_2` | −74 … −68, −176.4 … −174.0 | −20 | free |
| `sl6_3` | −36 … −30, −182.0 … −179.6 | −20 | container B-11 |
| `sl6_4` | −36 … −30, −176.4 … −174.0 | −20 | container B-12 |
| `sl6_5` | −60 … −54, −192.0 … −189.6 | −20.8 (wet) | container B-10 |
| `sl6_6` | −50 … −44, −192.0 … −189.6 | −20.8 (wet) | free |

**Containers and the grab are non-walkable dynamic boxes** (B2): with the physics as built a capsule cannot rest on a
non-walkable box (it is pushed off horizontally, `physics.ts:154-176`), so no container top and no grab top is ever a
floor; the grab has a box only while its bottom is < 2.5 m above a deck. B-14 hangs in the grab when the loader is
spawned (phase K) and is lowered into the well at the reveal (§4.8). Slot clearances: sl6_2 / sl6_4 are 2.4 m south of the
stair feet (z −171.6) and their floors in front; sl6_1 / sl6_3 leave 2.0 m passages north of them; sl6_5 / sl6_6 leave
the wet dock's flat floor between them (x −54 … −50) and 1.6 m to the ramps.

**Signs and boards**: the **dock board** on the north wall above the north gallery (x −58 … −46, y −8.0 … −5.0,
z −148.22, facing −z, screen `dock_board`, §6.4) — readable from everywhere in the chamber; `MOON POOL — 2,140 M`;
`CARGO LOCK — INNER DOOR CLOSED`; hazard stencils on the coaming `NO ENTRY — WET WELL`; `LOADER WORKING AREA — KEEP
CLEAR` on the dock.

#### 2.6.10 The loader (rig owned by W3a; its rails and end stops are level geometry)
Runway rails on corbels along both side walls at y −4.0 (x −75.4 and −28.6), z −194 … −150 with end-stop buffers; a
**festoon** cable on a catenary along the north wall feeding the bridge. **Bridge**: two box girders x −75.0 … −29.0
(1.4 m high, y −4.0 … −2.6), end trucks 4 m long; travel z −192 … −153 (the grab's centre). **Trolley** on the girders (y −2.6 …
−1.0), travel x −71 … −33 (the grab's centre — it must reach the slot centres x −71 / −33; its 2.4 m footprint stays
0.6 m clear of the side galleries' inner edges x −72.8 / −31.2 and can never descend onto a gallery, a stair or under the
mid deck, §5.6); the bridge's travel keeps the grab's footprint 0.6 m clear of the north gallery's edge z −151.2 and 0.8 m off the window walk; the
**control pod** hangs under the trolley between the girders (1.6 × 1.2 × 1.0, y −5.0 …
−4.0) with a red sensor cluster and a louvred armour cowl; the **PA horn** on the trolley; two **trolley floods** (FL1,
FL2) on the trolley's south corners and two **bridge floods** (FL3, FL4) under the girders at x −66 and −40, each a big
lamp head on a pan/tilt yoke. **Hoist**: four wire ropes to the **grab** (2.4 × 2.4 × 1.6, four jaws on hinge pins, a
hydraulic power pack on top with two **jaw rams** — chrome rods with amber sight glasses — on its east and west sides, a
ring light under it, its CHOIR status mark). The grab and a carried container are **non-walkable** dynamic boxes; the
grab has its box only while its bottom is < 2.5 m above a deck (B2). Grab top at y −6.4 when raised; its bottom reaches the dock (−20), the wet
dock (−20.8), the mid deck (−16) and down into the well (cargo to −26).

### 2.7 Light plan, darkness and per-space performance budget

Pools: low 2 shadow / 8 spot / 6 point; medium 3 / 9 / 8; high 4 / 10 / 10. **The flashlight is a shadow spot.**
Emissive-only: tubes (bound to their room's first light), strips, LEDs, screens, the viewport, the well's gate lamps (drawn
by the well shader), Clasp and enemy marks. Every point light is `bounds`-boxed to its room **and floor** (3c S5): the
trench's to the trench boxes (y ≤ −0.05); the vault's and he6's to y ≥ 0; the undercroft's to y ≤ −16.3; the galleries'
and mid deck's to their decks.

#### 2.7.1 Groups

| group | lit | after its beat | descriptors |
|---|---|---|---|
| `lock6` | 1 point (all) | — | 1 |
| `tun6_a` | 5 points (all) at z −8, −24, −40, −56, −72, tubes | **`tun6_far_out`** at F1's start: z −56, −72 off (CHOIR); red emergency points at z −60, −76 (all) on; strips | 5 + 2 |
| `rep6` | 2 points (all) + the tent's work lamp (point 0.5, `pulse` flicker, medium+) | — | 3 |
| `tun6_b` | **dark from load**: 4 red points 0.3 (all) at z −100, −116, −132, −148; strips (emissive 1.0); `d6_he` porthole glow | — | 4 |
| `bay6` | 1 point (all) | — | 1 |
| `he6` | 2 points (all) + 1 (medium+), rack LEDs, the mimic board | — | 3 |
| `vault6` | 2 spots (cast medium+, prio 0.7) down the drum row and onto the enclosure + 1 point (all) | after the pull: the enclosure's green dies (emissive) | 3 |
| `trench6` | 2 red points 0.25 (all) at z −170 (T-a) and x −4 (T-b), `bounds` = trench boxes; LED strips | — | 2 |
| `shaft6` | 5 landing lamps (points; LL0, LL2, LLB all; LL1, LL3 medium+) | **`v6_shaft_lights`**: they die one below the other; `shaft6_emerg`: red points at L2 and the bottom (all), nosing strips | 5 + 2 |
| `pool6` | high-bay points HB1 (−62, −2, −160), HB2 (−42, −2, −160) (all), HB3 (−62, −2, −186), HB4 (−42, −2, −186) (medium+); the frame lamp (spot, all, prio 0.7, cast medium+) at (−52, −13.8, −166.2) aimed at the shear; the undercroft point (**all**, hard-wired 0.35 — the refuge, S13); the loader's 4 floods (spots, prio 0.9, above every soldier weapon light; **non-shadow on LOW and MEDIUM**, FL1/FL2 cast on HIGH — S13) | **beacons** BC1 (−52, −6, −148.6), BC2 (−52, −6, −195.4) (amber rotating, all) from the hostile start; **`lights_out6`** at stage 2: HB1–4 off, red points ER1 (−73, −10, −150), ER2 (−31, −10, −194) (all, 0.45), the viewport → state `dark` (outside floods off, the beacon on the tether stays) | 8 + 4 |
| `stores6` | 1 point (all) | — | 1 |
| `feed6` | 2 amber beacons + 1 red point over the launch lock (pinned only during the E2 feed pass) | — | 3 |

#### 2.7.2 Worst views on LOW (points / spots / shadow slots incl. flashlight)

(a) tun6_a from the tube door looking south, lit: 5 + rep6 1 = 6 / 1 / 1. (b) tun6_a during F1 (far half out): 3 + 2 red
+ muzzle 1 = 6 / soldier lights 2 + flashlight = 3 / 1. (c) rep6: 2 + tun6_b red 1 + tun6_a 2 + muzzle 1 = 6 (the tent
lamp is medium+) / 3 / 1. (d) tun6_b dark: 4 red + muzzle 1 + sentry eye 1 = 6 / soldier 1 + sentry searchlight 1 +
flashlight = 3 / 2. (e) he6 → vault: he6 2 + vault 1 + muzzle 1 + husk eye 1 = 5 / vault spots 0 on LOW-cast (spots
still lit, no shadow: 2) + soldier 1 + flashlight = 4 / 1. (f) vault fight: 1 + trench 1 + he6 1 + muzzle 1 + eyes 2 = 6 /
2 + 1 + 1 = 4 / 1. (g) shaft after the lamps die: red 2 + chamber spill (emissive) + eye 1 = 3 / 1 / 1. (h) **pool6 stage 1**
from the cage looking south-east: HB1, HB2, BC1, BC2 + muzzle 1 + husk eye 1 = 6 (the undercroft point loses to them by
distance when unseen) / floods 4 + frame lamp 1 + flashlight 1 = 6, leaving **2 slots for soldier weapon lights**: with
W1 + W3 alive (4 soldiers, ≤ 2 aiming by the token rule) the floods out-rank them (prio 0.9 vs 0.5), so a flood is never
evicted; `floodLit` counts only a flood whose light is in the pool this frame (S13) / 1 (the flashlight; no flood casts
below HIGH). A destroyed flood frees a slot. (i) **pool6 after `lights_out6`**: BC1, BC2, ER1, ER2 + muzzle 1 + eye 1 = 6 / ≤ 8 / 1. (j) the
ending (feed pass): pool6 as (i) minus enemies; the feed pass pins feed6's 3 lights in its own pass only.

#### 2.7.3 Darkness for the battery (D19)

`regions.dark` (the soldier's D18 rule and `check:dark` read it): `tun6_b` (from load); the trench; `tun6_a` z < −52
(from `tun6_far_out`); `shaft6` (from `v6_shaft_lights`); `pool6` (from `lights_out6`, with the flood rule D20 on top).
Rules for every dark space (3c §2.7.3, kept): **without the flashlight** every door, stair nosing, gallery edge, coaming
top, cage, required interactable (crank, lock barrel, loom, pin, pump, lever, console, hatch wheels) within 10 m in line
of sight reads at p95 luma ≥ 0.10 on LOW and MEDIUM; the merged lamp-OFF rule (≥ 1.5 % of pixels lit, frame mean ≥ 0.015)
holds in every level-6 view; **no unreadable run longer than 8 m** on the main route (samples every 2 m, lamp off,
≤ 4 consecutive failures); the trench (42 m crouched ≈ 23 s — over two battery cycles) is readable by its strips alone.
Specific: tun6_b's floor strips are continuous and its red pools 16 m apart (≤ 8 m from any point to the nearest) ✓;
the shaft's nosing strips are on every tread; in the chamber after `lights_out6` the coaming top, the gallery edges, the
stair nosings, the bar guards' base strip, the cage's instruction plate and the console glow, and the wet dock's kerbs
carry amber strips.
Lit refuges (switch off to recharge with no penalty): lock6, tun6_a's north half, rep6, bay6, he6, vault6, the shaft
before the beat, the chamber's undercroft (its point stays on after `lights_out6` — hard-wired, 0.35).

#### 2.7.4 Portals (`[roomA, roomB, door | null, see]`)

`lock6–tun6_a d6_tube`; `tun6_a–rep6 null 85`; `rep6–tun6_b null 70`; `tun6_b–bay6 d6_bay`; `tun6_b–he6 d6_he` (porthole:
`see` 1 m, the glow only); `he6–vault6 d6_vault`; `vault6–hold6 d6_hold`; `vault6–shaft6 d6_shaft`; `shaft6–pool6 d6_pool`
(porthole: glow only when shut); `pool6–stores6 d6_stores`; `pool6–outside` the viewport pane (`fx6_sea` only). `feed6`:
none (drawn by the feed pass with the visibility override, 3a §8.4). Frame zones per room pair (3b `frameZone`); the
chamber's two doors share one frame zone; pickups room-culled (3b IB fix). **The chamber is drawn only through `d6_pool`
and `d6_stores` when open**: from the shaft with the door shut it costs nothing.

#### 2.7.5 Per-space budget (main calls / shadow calls / tris / transparent calls / max layers)

Targets ≥ 60 fps LOW and MEDIUM, ≥ 45 fps HIGH; any view over budget blocks hand-over. Counts **include** the enemies the
plan puts there (soldier ≤ 10 calls LOD0 / ≤ 6 LOD1, **husk 12 main + ≈ 17 shadow** (3b integration item 6: three
husks ≈ 86 with shadows), skitter ≤ 6, sentry ≤ 8, **loader ≤ 14**). The pool6 fight's shadow budget assumes the
flashlight as the only moving shadow caster on MEDIUM (S13); a measured second caster is allowed only at the greybox
gate.

| space | main | shadow | tris | transparent | layers |
|---|---|---|---|---|---|
| lock6 + tun6_a (lit), F1 2 soldiers + 2 husks | ≤ 200 | ≤ 55 | ≤ 0.5 M | 0 | — |
| rep6 (+ both tunnels through the frames), F2 1 soldier + 2 husks + 2 skitters | ≤ 210 | ≤ 60 | ≤ 0.5 M | 1 (tarp alpha) | 1 |
| tun6_b dark (+ he6 glow), soldier + sentry | ≤ 160 | ≤ 40 | ≤ 0.35 M | 0 | — |
| he6 (+ vault through the door), 1 soldier + 2 husks | ≤ 230 | ≤ 65 | ≤ 0.55 M | 1 (rack glass) | 1 |
| vault6 + trench, 1 soldier + 2 husks + 3 skitters | ≤ 230 | ≤ 65 | ≤ 0.6 M | 2 (dust, grating) | 1 |
| shaft6 (+ chamber through the open door) | ≤ 170 | ≤ 40 | ≤ 0.4 M | 2 (grating, porthole) | 1 |
| **pool6 reveal** (no enemies; the loader working, B-14, water, windows) | ≤ 250 | ≤ 70 | ≤ 0.9 M | 5 (well surface, wet dock surface, ripples, viewport, bar-guard alpha) | 2 |
| **pool6 fight**: loader + ≤ 6 enemies (§5.5 cap) + muzzle fx | ≤ 300 | ≤ 95 | ≤ 1.1 M | 6 (+ spray) | 2 |
| pool6 ending (+ the feed pass ≤ 1.5 ms HIGH) | ≤ 260 | ≤ 70 | ≤ 0.9 M | 5 | 2 |

Chamber rules that make 300 possible: galleries, rails, parapets, stairs and the bar guards merged per side (≤ 8
calls), one alpha-tested grating material per deck, the coaming + rail 1, the wet dock 1, containers instanced (1 call + 1
for the one in the grab), the loader ≤ 14, the winch + trough + cage + shear ≤ 8, the well fx 2, the viewport 2, the wet
dock surface 1 + wake rings 1; enemies beyond 12 m on LOD1; enemy shadows only for LOD0 within 15 m; the loader's shadow
proxy only for the grab.

### 2.8 Sight lines through glass, water, grating and openings (every one)

| pane / opening | geometry | from | must see | must not see |
|---|---|---|---|---|
| `d6_he` porthole | ⌀ 0.3, leaf at z −160, centre y 1.6 | tun6_b | a warm glow (backlight for F3) | he6's interior detail |
| `d6_pool` porthole | ⌀ 0.3, leaf at x −28, y −10.4 | shaft bottom | moving light (the floods sweeping) | the chamber's geometry |
| vault penetrator port | ⌀ 0.25 dark lens at (−7.2, 1.0, −179.8) | vault | black water, one slow fleck (an emissive card) | proxy edges (no volume) |
| **well surface** | x −58 … −46, z −182 … −170, y −20.3 | galleries, mid deck, cage, dock (over the rail) | black glossy water with the floods' reflections, cold mist, the tether going down, the sea gate's amber ring deep below, the ladders' rungs fading, `v6_well_eyes`' cyan points (stage 0 only) | anything under water sharply; any enemy before W2 (they are not in the scene) |
| **wet dock surface** | x −66 … −38, z −194 … −182.4, y −20.3 | everywhere in the chamber | dark water, wake rings, the floor's hazard paint dimly under 0.5 m, the containers' feet | — |
| **sea windows** | 24 × 3.6 at z −195.8, x −64 … −40, y −19.6 … −16.0 | wet dock, window walk, galleries (south ends), mid deck | the sea: outside floods (until `lights_out6`), marine snow, the tether rising to its red beacon, `v6_window`'s shape (after the boss) | proxy edges; the chamber reflected as a second chamber (the pane's probe reflection is faint) |
| dock console screen | 3.2 × 1.4 at (−44, −14.2, −158.6) facing −z | mid deck | the repeater pages; in E2 the feed | — (bullet-resistant: stars, holds) |
| bar guards / cage / rails | move-only bars | everywhere | through them, clearly | — (rounds and sight pass, D14) |
| gallery / stair / trench grating | `deck_grate` | below / above | silhouettes, marks, weapon lights | — (grating floors stop rounds and sight, 3c) |

Shots: the well and wet dock surfaces splash (`fx.splash`), no decal; panes and the console star and hold.

### 2.9 Water volumes (`Level.water`, §8.1) and fx volumes (D23)

| water id | box (world) | surface y | depth map (d at the feet) | room / region |
|---|---|---|---|---|
| `wat6_wet` | x −66 … −38, y −21.4 … −20.3, z −194 … −182.4 | −20.3 | ramps 0 → 0.5; flat floor 0.5 (knee); channel side slope 0.5 → 1.0; channel bottom 1.0 (waist); `stand` 1.25 | pool6 / `wet` |
| `wat6_well` | x −58 … −46, y −34 … −20.3, z −182 … −170 | −20.3 | 13.7 (**deep**: unreachable, ALWAYS forbidden); `stand` 1.25 (the rescue fail-safe, D12) | pool6 / `deep` |

Each water surface is a `rayOnly` collider quad (K, D14) plus its visible mesh (W6/D3a).

| fx id | owner / how | box (world) | enclosed by | `rooms` / `seenFrom` |
|---|---|---|---|---|
| `fx6_well` | `fx.well(…)` (W6, new): surface + depth proxy | x −58 … −46, y −34 … −20.3, z −182 … −170 | coaming, well walls | pool6 / shaft6 (aperture: `d6_pool`) |
| `fx6_wet` | `fx.wake(…)` rings + the wet dock surface | x −66 … −38, y −20.4 … −20.2, z −194 … −182.4 | kerbs | pool6 / shaft6 |
| `fx6_sea` | `fx.viewport({ state: 'calm', cable, beacon, cableCut })` | pane above; proxy x −66 … −38, y −24 … −10, z −222 … −196 | the void; the pane | pool6 / shaft6 (aperture: the pane) |
| `fx6_mist` | `fx.fog` cold mist | x −58 … −46, y −20.3 … −18.6, z −182 … −170 | coaming | pool6 / shaft6 |
| `fx6_spray` | hydraulic spray at a hit ram (emitter, `bounds` 3 m round the grab, follows it) | moving | — | pool6 |
| `fx6_splash` | pooled splash bursts (grab, containers, bodies, bullets) | the two water boxes | — | pool6 |
| `fx6_drips_pool` | 8 drips from roof seams (`bounds`) | pool6 interior | walls | pool6 / shaft6 |
| `fx6_vault_dust` | `fx.fog` dust in the vault's spot cones | x −21 … 1, y 0 … 6, z −179 … −149 | vault walls | vault6 / he6 |
| `fx6_drips_trench` | 3 drips in the trench | trench boxes | trench | vault6 (trench) / — |
| `fx6_shaft_drips` | 2 drips down the guarded well | shaft interior | walls | shaft6 / vault6 |

### 2.10 Containment arithmetic — the well (D12, R6; recomputed after review B1 with g = 19)

The well's barrier top is the coaming guard's top, **y −17.6**. A sprint-jump from a standable surface h metres above it
(h includes **+0.6 m for a wreck box** lying on that surface) crosses at most `R(h) = 6.0 × (0.324 + √(2(h + 1.0)/19))` m
horizontally before it falls below the barrier top. Every standable surface in the chamber:

| surface | y | h (+ wreck) | R | distance to the guard line | barrier |
|---|---|---|---|---|---|
| dock / window walk / undercroft | −20 | — | — | 0 … | coaming 0.8 + bar guard 1.6 = **2.4 m** (≥ 2.35 with a corpse ✓) |
| wet dock floor / channel | −20.8 / −21.3 | — | — | 0 … | 3.2 / 3.7 m ✓ |
| coaming top | −19.2 | — | — | — | behind the flush guard: not standable |
| container tops, the grab top | — | — | — | — | **not standable** (non-walkable dynamic boxes, B2) |
| mid deck south edge x −68 … −36 | −16 | 2.2 | 5.43 m | 3.6 … 10.25 m | **2.4 m bar guard** ✓ (1.8 m above a corpse) and the cage |
| mid deck edge x −72.8 … −68 / −36 … −31.2, stair heads | −16 | 2.2 | 5.43 m | ≥ 10.3 m ✓ | distance (1.1 m rail) |
| `ST6_M` / `ST6_M2` flights | −20 … −16 | ≤ 2.2 | ≤ 5.43 m | ≥ 12.1 m ✓ | distance |
| winch hood ridge (standable) | −13 | 5.2 | 6.79 m | 15.6 m ✓ | distance only (the hood is no barrier) |
| galleries / landings | −12 | 6.2 | 7.17 m | ≥ 14.4 m ✓ | distance |
| inside the cage | −16 | — | — | — | 2.6 m bars + bar roof at −13.4: closed |

**`check:reach` (W4b, §10.2)** proves it: the simulation runs down to the level's lowest point (`GreyGrid` y −36, not
the old y −5 cut-off), tests hazard regions (`deep`) **on every simulated step** (not only end nodes), and its jump-arc
probes start from **every** standable surface in pool6 (no "above y −18.6" limit), with the +0.6 m wreck stress, sprint
speed, 16 directions. Any prop added by dressing re-runs it.

---

## 3. Phases (`src/level/l6/phases.ts`; the story calls `applyPhase` only)

States as `level/phases.ts` (`auto | open | shut | locked | cycling | dark | oneway`). Blank = as the previous column.
Story progress that changes no door (manual, pulled, boss stages, the cut) is flags, with its own `check:reach` rows.

| door | A arrival | T tube open | U latched | B bay live | B_hold | K shaft open | K_stores | nostory |
|---|---|---|---|---|---|---|---|---|
| d6_tube | cycling → open at 3.0 s | open | locked (latched) | | | | | open |
| d6_bay | locked | | | auto (opened at the F2 spawn, stays open) | | auto | | auto |
| d6_he | auto | | | | | | | auto |
| d6_vault | auto | | | | | | | auto |
| d6_hold | locked | | | | open (spawn) | locked | | locked |
| d6_shaft | locked (interlock panel) | | | | | auto (Key B used) | | auto |
| d6_pool | auto | | | | | | | auto |
| d6_stores | locked | | | | | | open (W1) | locked |

Machines: the loader is an enemy spawned when Key B turns (D31; pose `working`, §5.6.1) — not a level machine; `winch6` idle; `ping6` (the buoy ping, rate from the story:
20 s before the pull, 4 s after, off after the cut). Variants without player checks: `B_hold`, `K_stores` (each latched
closed again behind its wave).

Regions: every room id; `trench`, `cage`, `undercroft`, `wet`, `dock`, `mid`, `gallery`, `deep`, `enclosure`, `outside`,
`voids`, `feed6`. `ALWAYS6 = feed6, deep, enclosure, outside, voids`. `hold6`, `bay6`, `stores6` are forbidden until their
variant; `bay6` is a goal after B (the reward); `hold6` / `stores6` neither after.

| phase / row | label | start (feet) | forbid (+ ALWAYS6) | goal | use (usable) | must not be usable |
|---|---|---|---|---|---|---|
| A | arrival (`cp6_start`) | (0, 0, 3.0) | every room but lock6 | lock6 | `p6_lock_ammo` | — |
| T | tube open | (0, 0, 2.0) | shaft6, pool6, stores6, hold6, bay6 | lock6, tun6_a, rep6, tun6_b, he6, vault6 | as U | as U |
| U | latched (`cp6_tunnel`) | (0, 0, −10.0) | lock6, shaft6, pool6, stores6, hold6, bay6 | tun6_a, rep6, tun6_b, he6, vault6, trench | `he6_switch`, `note6_queue`, `note6_jobcard`, `hatch6_vault`, `hatch6_he` (from below), `vault6_lock` (refuses: no key), `shaft6_lock` (refuses), every `p6_*` in these rooms incl. the trench's | `frame6_*`, `console6`, `hatch6_he` from above, `vault6_loom` (doors shut) |
| B | bay live (`cp6_rep`, `cp6_he`) | (4.0, 0, −86.0) | lock6, shaft6, pool6, stores6, hold6 | U goals + bay6 | U + `p6_bay_*` | as U |
| B_hold (variant row) | F4 / F5 walking out | (−14.0, 0, −152.0) | as B **minus hold6** (neither forbidden nor goal while the door is open — a player inside it is fought there; the latch waits for him) | as B | as B | as B |
| U_man (flag row: manual) | `cp6_manual` | (18.0, 0, −171.0) | as B | as B | B + `vault6_lock` (opens: Key A held) | as B |
| U_pull (flag row: enclosure open) | — | (−12.0, 0, −177.6) | as B | as B | B + `vault6_loom` | as B |
| K | shaft open (`cp6_pulled` is B-phase; `cp6_shaft`, `cp6_m*`, `cp6_quiet`) | (−24.5, 0, −170.0) (L0) | lock6, hold6, stores6 | everything else incl. every pool6 deck, the cage, the wet dock, the window walk | `frame6_pin`, `frame6_pump`, `frame6_lever` (feet in `t6_cage`), every `p6_*` of pool6 and shaft6 | `frame6_*` with the feet outside `t6_cage` (the interactables' `requireRegion: 't6_cage'`, which `check:reach` honours — S8g), `console6` (until the ending), `deep` (a hazard: never entered on any simulated step, incl. jump arcs) |
| K_end (flag row) | ending pending | (−44.0, −16, −160.4) | as K | as K | K + `console6` | — |

`stressFloors`: A … B `[0, −1.4]`; K `[0, −1.4, −3, −6, −9, −12, −16, −20, −20.8, −21.3]`. **One-way** (`reachHints.oneway`):
`hatch6_he` (trench → head-end only). The trench is two-way through `hatch6_vault`. **New check** (W4, §10.2): the
jump-arc probe (§2.10) and a `hazard` list (`deep`) whose rule is "never entered by walking, falling or jumping".

Transitions: A→T `d6_tube` open (3.0 s); T→U tube latch; U→B F2 spawn (`t6_rep_in`); B→B_hold→B for F4 and F5 (latched
back); B→K `shaft6_lock` with Key B; K→K_stores→K for W1.

Latches (`closeBehind(door, keepSide)`):

| door | armed by | phase | keepSide (feet) | on fail |
|---|---|---|---|---|
| `d6_tube` | `t6_tube` | T | z < −0.6 | reopen, re-arm; panel `CLEAR THE TUBE` |
| `d6_hold` (after spawn) | last member at z < −148.6, or 10 s | B_hold | player z < −148.6 | stays open, retries every 2 s |
| `d6_stores` (after spawn) | last W1 member at z < −148.6, or 10 s | K_stores | player z < −148.6 | stays open, retries every 2 s |

`nostory`: every door `auto` except `d6_hold`, `d6_stores` (locked); no loader (nothing spawns it);
lights lit; hatches closed; no actors.
`regions.dark` is for the soldier rule and `check:dark` only; `check:reach` ignores it.

---

## 4. Scripted beats — timings tied to line durations

`dur(id)` = `VoiceHandle.duration` (manifest, lead skipped); "+g" = gap after the line ends. Every timed line starts
within 0.12 s of its cue (§8.14). Every position below is a marker (§8.11). Kessler's radio lines are never paused for
combat (a radio), but a CHOIR bark never overlaps them (3c §4.4 rule).

### 4.1 Arrival (A → T → U)

| t | event |
|---|---|
| 0.0 | `l6_start`; phase A; fade in 0.8 s; HUD radio strip on (fact `radio`: label `POST 4 — CMD — CH 1`, Q live from here); objective `The head-end — 200 m`; `d6_tube` panel `HEAD-END TUBE — CYCLING` |
| 0.6 | `l6_kes_start` |
| 3.0 | `d6_tube` opens (0.85 s, the door's sound); `l6_unit_tube` at the panel (`mk6_tube_panel` (1.2, 1.4, 0.22)) |
| 3.9 | phase T; **`cp6_start`** |
| `t6_tube` (T) | `closeBehind('d6_tube', z < −0.6)` → on success phase U; `l6_kes_start_2` (C, once); +g 0.6 `l6_choir_start_<choice>` (radio:1) |

### 4.2 Tunnel A and the first fight (U)

| when | event |
|---|---|
| first `t6_tun_mid` in U, calm, player z > −40 — **or** 35 s in U with the player still at z > −70 | beat `l6_crossing`; `g6_tun_s` (2 soldiers, carbine) spawned in rep6 at `mk6_tun_s1` (10.0, 0, −86.0) and `mk6_tun_s2` (12.0, 0, −87.5) — hidden from every tunnel point north of z −70 (worst case (−2.3, −70) → (10, −86) crosses z −80 at x 5.4, outside the mouth's ±2.5); **if the player reaches z −70 before this spawn, F1 is cancelled for good** (R4: it never exists; rep6's F2 takes over); `v6_crossing` (only when the player is at z > −40) (§5.7): s1 walks `enemies.patrol('g6_tun_s', …)` (§8.1; 3d's K adds the member — no patrol API exists in 3c's contract, S8a) `mk6_cross_0` (10.0, 0, −86.0) → `mk6_cross_1` (−3.0, 0, −86.0) at 1.4 m/s, light on, not looking — seen through the tunnel mouth for ≈ 3 s at ≥ 60 m |
| crossing end (s1 at `mk6_cross_1`) + 2.0 s, or the player fires / is within 40 m of either | `enemies.release('g6_tun_s')`; both advance cover to cover up the tunnel (`cover: 'tunnel'`); `tun6_far_out` (lights z −56, −72 off, red points on, `dark` extended to z < −52); `l6_kes_contact_a` (C) |
| both soldiers in cover + 6 s, or one dead | `g6_tun_u` (2 husks `navy`) spawned at `mk6_tun_u1` (−1.2, 0, −91.3), `mk6_tun_u2` (0.0, 0, −91.3), in DS2's shadow (from any tunnel point, and from rep6's north mouth, the ray to their chests meets the 2.6 m drum: e.g. (2.3, −70) → (−1.2, −91.3) passes z −89.0 at x −0.82, inside DS2's x −2.0 … 0.6); `rush('g6_tun_u', 25)`; if the player is already in rep6 they spawn only if the spawn-visibility ray test (§10.1) passes from his eye at that moment, else they are skipped (R4) |
| `g6_tun_s` + `g6_tun_u` dead + 1.5 s, calm | **`cp6_tunnel`**; `l6_kes_tun_done` (C, once) |

Running past z −40 before the crossing skips it (never seen from closer than 40 m) and releases F1 at once; past z −70
before the spawn cancels F1 (§9 #3).

### 4.3 Repeater 2 (U → B)

| when | event |
|---|---|
| first `t6_rep`, calm | `l6_kes_rep` (C) |
| first `t6_rep_in` (feet past z −81.5), **or** 25 s in rep6 | beat `l6_rep`; `g6_rep_s` (1 soldier, carbine, `cover: 'rep'`) spawned at `mk6_rep_s` (10.2, 0, −111.6) in tun6_b (behind RH1: hidden from every point of rep6, §2.6.4) — he walks north into rep6's covers; phase B: `d6_bay` opens at +0.4; `g6_rep_u` (2 husks) from bay6 (`mk6_bay_u1/u2`) rushed 25 s (they walk into tun6_b and north); `vent6_rep` grille drops at +1.0, +0.4 s `g6_rep_k` (2 skitters) at (5.6, 4.9, −84.0), (6.4, 4.9, −84.0) (0.1 m under the ceiling beside the opening, 3b S1); `l6_kes_contact_rep` (C) |
| F2 dead + 1.5 s, calm, player in rep6 / tunnels / bay6 | **`cp6_rep`** |

### 4.4 Tunnel B in the dark (B)

| when | event |
|---|---|
| first `t6_tunb` | `l6_kes_tunb` (C, once) |
| first `t6_tunb_dark` (z < −96) | `g6_tunb_s` (1 soldier, carbine) spawned in he6 at `mk6_he_s` (12.0, 0, −162.0) (2 m clear of R1's north face; he6 behind the shut `d6_he`: hidden — S1a); +0.5 s he walks out through `d6_he` on **`enemies.patrol('g6_tunb_s', [mk6_he_s, mk6_tunb_hold], { speed: 1.4, light: false, end: 'hold' })`** (§8.1 — a real soldier walking, never an actor, R2; the door opens for him: the spill of warm light down the dark tunnel) to `mk6_tunb_hold` (12.0, 0, −153.0) and holds (pose `hold`, yaw π — facing north up the tunnel, the porthole glowing behind him); `d6_he` closes behind him. Released (3c `release` + self-release) by: the player within 30 m; a shot or near miss; the flashlight on him 0.5 s within 25 m; 60 s after he holds. +1.0 after he holds: `l6_choir_dark_<choice>` (radio:1) |
| the soldier in view ≥ 1 s at > 25 m with the lamp off | `l6_kes_tunb_soldier` (C, once) |
| first `t6_tunb_sentry`, a shot within 12 m of the dock, or the soldier released | `wakeGroup('g6_tunb_k')` (sentry `navy`, dormant `ceiling` at (12.0, 3.9, −134.0) from load — harmless while dormant, R4) |

### 4.5 The head-end (B)

| when | event |
|---|---|
| first `t6_he`, no awake hostile in he6 / tun6_b within 30 m | **`cp6_he`**; `l6_kes_he_1` (C); +g 0.5 `l6_kes_he_2`; +g 0.6 `l6_reyes_he`; +g 0.4 `l6_kes_he_3` → stopped at its **`cut`** (just after "by"; fade 0.03 s); at the cut (−0.05 s overlap) `l6_choir_he_<choice>` (radio:1); objective `The changeover switch — east wall` |
| `v6_handset` (§5.7 #3): calm, feet in `t6_phone` or ≥ 25 s in he6, no `scene` line playing | the howler buzzes three times (`phone_howler`); then `l6_aas_1` from the handset (positional at `mk6_handset` (21.55, 0.85, −164.3), fx `phone`, POS `phone` ref 0.8 m — audible within ≈ 4 m, D29); `he6_phone` enabled. Not picked up within 12 s → `l6_aas_1` once more 25 s later, then `phone_dead_click` and `he6_phone` disabled for good |
| `he6_phone` used | the handset lifts off its cord into the left hand (prop `held`, no camera; the player keeps control and his weapon in the right hand); the HUD strip shows `SOUND-POWERED — POST 4`; the voice becomes 2-D close (fx `phone`); +0.4 `l6_aas_2`; +g 0.5 `l6_reyes_aas`; +g 0.3 `l6_aas_3` → stopped at its `cut` ("bo—"), `phone_dead_click` + line hiss; the handset drops back onto its cord; fact `aas`; +1.2 `l6_kes_aas` (C: heard `l6_aas_2`). Walking > 2 m from the station while it talks: the handset swings back (`handset_drop`), the remaining lines play positional from it |
| `note6_queue` read (closed) | fact `manifest`; +1.0, calm: `l6_reyes_queue` (C, once); +g 0.5 `l6_kes_queue` (C); +g 0.5 `l6_choir_queue_<choice>` (radio:1) (S11b: the same order as §6.2) |
| `he6_switch` used | `player.grip({ seconds: 3.0, hold: true, motion: 'crank' })` (§8.3; a grip needs both hands — if the handset is held it drops first, `handset_drop`, and the call's remaining lines play positional from it, S11d); the mode plate's pointer travels AUTO → MANUAL with the progress; at done: **Key A** (`player.addKey('key6_a')`, toast `Key A — head-end mode`), fact `manual`, beat `l6_manual`; mimic board `MODE: MANUAL — PROTECTION SWITCHING OFF`; `l6_unit_manual` (at `mk6_switch`); +g 0.4 `l6_kes_manual` (C); +g 0.4 `l6_choir_manual_<choice>`; objective `The beach joint — vault, south wall` |
| manual + 4.0 s | F4: `g6_he` (1 soldier carbine `cover: 'he'`, 2 husks) spawned in hold6 at `mk6_hold_1` (−16.0, 0, −143.0), `mk6_hold_2` (−19.0, 0, −144.0), `mk6_hold_3` (−13.0, 0, −144.0); +0.4 s phase B_hold (`d6_hold` opens); `rush` the husks 30 s; route hold6 → vault → `d6_vault` → he6 (≈ 30 m: husks ≈ 8 s, soldier ≈ 19 s); `l6_kes_he_contact` (C: none in view, player not in vault6) or `l6_kes_he_contact_b` (C: player in vault6 — S11c) (queued behind any `scene` line, dropped if one is in sight); latch `d6_hold` behind them |
| F4 dead + 1.5 s, calm, player in he6 / vault6 / tun6_b | **`cp6_manual`** |

### 4.6 The vault (B → K)

| when | event |
|---|---|
| first `t6_vault`, calm | `l6_kes_vault` (C, once) |
| `vault6_lock` used | without Key A: plate prompt `Interlock key A required`, `interlock_deny`, Q hint; with it, **in one action**: the key turns (0.6 s, `castell_turn`) and stays trapped (`player.removeKey('key6_a')`, §8.1) and flag **`bjOpen`** is set (B4); vignette `bj6_open` (the sliding doors part 1.2 s, the loom's green floods out, `bj_doors`), `vault6_loom` enabled; `l6_kes_bj` (C). On every restore with `bjOpen && !pulled`, `afterReplay` runs `bj6_open:snap` and enables the loom |
| `vault6_loom` used | `player.grip({ seconds: 3.0, hold: true, motion: 'pull' })`; vignette `bj6_strain` follows the progress (0.3: the connector creaks; 0.7: the green flickers, fibres start to snap); at done: vignette `bj6_rip` (the connector tears out, `fibre_rip`, the green dies in a cascade along the tray 0.8 s), **Key B** (`player.addKey('key6_b')`, toast `Key B — moon pool`), fact `pulled`, beat `l6_pulled`; every screen `TRUNK FIBRE — LOS` / `BACKUP LINK — ACOUSTIC BUOY — ACTIVE`; ping rate 20 s → 4 s; `launchAt` = now + 90 s (game clock) unless `v6_thud` sets it first; +0.3 `l6_unit_pull` (at `mk6_bj`); +g 0.5 `l6_kes_pull_1`; +g 0.6 `l6_kes_pull_2`; +g 0.5 `l6_choir_pull_<choice>`; objective `The stair door — vault, west wall` |
| pull + 4.0 s (the first fast ping) | `v6_ring` (§5.7 #5; exempt from spacing — the pull's own consequence) |
| pull + 5.0 s | F5: `g6_vault` (1 soldier carbine `cover: 'vault'`, 2 husks) in hold6 (`mk6_hold_1/2/3`), phase B_hold, husks rushed 30 s; `g6_vault_k` (3 skitters): player **not** in the trench → spawned in the trench under grilles G1, G2, G3 (y −1.0), each grille lifts (`sump_lift`) +0.4 s and they jump out; player in the trench → from `vent6_vault` instead (0.1 m under the ceiling beside it); latch `d6_hold` |
| `v6_thud` (§5.7 #6): **only within pull + 20 … + 90 s**, calm, player in vault6 / he6, before Key B turns (else it never fires) | `launchAt` = now (else `launchAt` = pull + 90 s, S10d); +1.2 `l6_kes_thud` (C) |
| F5 dead + 1.5 s, calm, player in vault6 / he6 (not the trench) | **`cp6_pulled`** |
| `shaft6_lock` used (`mk6_shaft_lock` (−21.78, 1.3, −167.6), use point (−21.3, 1.3, −167.6), radius 1.3, vault side only) | without Key B: `Interlock key B required`; with it: the key turns, `removeKey('key6_b')`, phase K (`d6_shaft` auto), `l6_unit_shaft`, beat `l6_shaft_open`, objective `The moon pool — down the stairs` |

### 4.7 The shaft (K)

| when | event |
|---|---|
| first `t6_shaft_l1` (feet below y −2.5), no hostile within 20 m (**exempt from scare spacing** — it carries F6 and `cp6_shaft`, S4; the closed well means he arrives by the stairs, S7) | `v6_shaft_lights` (§5.7 #7): LL2 pops (+0.0), LL3 (+0.7), LLB (+1.4), then above him LL1 (+3.0), LL0 (+3.6); `shaft6_emerg` on; `dark` += shaft6; at +1.0 `g6_shaft` (1 husk) spawned at `mk6_shaft_u` (−26.8, −12, −162.8) under L3 (hidden by L3's slab from every point above it, with 0.3 m more margin than the review's −163.0) and rushed 20 s up the stairs; +4.4 `l6_kes_shaft` (C) |
| F6 dead, calm, feet in `t6_shaft_bot` (or calm anywhere in shaft6 below y −6 before the reveal) | **`cp6_shaft`** |

### 4.8 The moon pool (K): reveal, boss, the cut

| when | event |
|---|---|
| first `t6_reveal` | beat `l6_reveal`; `boss.cue('lower')`: the loader (spawned in pose `working` when Key B turned — D31 — B-14 held over the well) lowers container B-14 into the well; it meets the water at +1.5 s (`splash_big`), sinks out of sight by +6.0 (it waits in the well for its lock cycle: `IN TRANSFER`), the grab rises empty; `v6_well_eyes` (§5.7 #8; exempt from spacing, S4); +0.6 `l6_kes_pool_1`; +g 0.5 `l6_kes_pool_2` (variant `_2b` when the loader is not in view); ambience `amb_pool`; `dock_board` `TRANSFER B-14: LOWERING` → `IN WELL — AWAITING LOCK CYCLE` |
| **hostile start** = the first of: `max(reveal + 10.0, l6_kes_pool_2 end + 0.5)` capped at reveal + 18.0; feet in `t6_floor`; any damage to the loader; a player shot fired in pool6; any `frame6_*` use | beat `l6_loader`; boss **stage 1** (§5.6): B-14 is let go if still held (it drops into the well), the grab rises, the floods swing to the player (1.5 s) and the CHOIR mark turns red; `l6_unit_loader_1` (the loader's PA, at the trolley); beacons on (`alarm_beacon`); boss pips on (`DOCK LOADER`); +0.4 `l6_choir_pool_<choice>` (radio:1); **W1** at +2.0 (phase K_stores, `d6_stores` opens +2.4); `l6_kes_boss_1` (C) at `_choir_pool` end + 0.4; objective `Cut the tether — the frame over the well` |
| boss events, attacks, teaching lines | §5.6, §6.2. Every milestone writes `cp6_m<n>` with **`checkpointNow`** 1.0 s later (deferred to a running grip's end + 1.0 s, never skipped — S2d) |
| `frame6_pin` used (grip 1.2 s, press-and-hold) | milestone; **stage ≥ 2** (`lights_out6`: high-bays off over 1.0 s with `lights_out_dock`, ER points on, the viewport → `dark`, `dark` += pool6); **W2** at +1.5 s; `l6_kes_pin` (C); gauge `0 BAR — PUMP` |
| `frame6_pump` (grip 6.0 s cumulative, hold) | the gauge climbs 0 → 210 bar with the progress; `l6_kes_pump_half` (C, at ≥ 50 %, once); at done: milestone, **stage 3**, **W3** when ≤ 3 non-loader hostiles live (§5.5); `l6_kes_pump_done` (C); the lever's guard springs open |
| `frame6_lever` used (grip 0.6 s, press) | without full pressure: `PRESSURE LOW` on the gauge, `interlock_deny`; with it: **the shear** (§4.8.1) |
| ram E / ram W destroyed | milestones (each); `l6_kes_boss_pod` (C) when both are gone |
| pod destroyed | milestone; the loader's death (§5.6.8); `l6_kes_loader_dead` (C: tether not cut) / nothing (cut: the quiet follows); +0.6 `l6_choir_loader_<choice>` (radio:1) |
| `trunkCut && loaderDead` | `fightOutWhere(e => anywhere in the level, 60)` with **3c's stray rule** applied to the wait (a wave soldier who followed him to the vault is fought or, unseen ≥ 30 s and ≥ 25 m away, removed — S11e); then + 2.0 s calm → beat **`l6_quiet`**: music to silence, ambience `amb_pool_quiet` (the hum, the water, no ping), **`cp6_quiet`**; + 3.0 s `l6_kes_console` (C); objective `The dock console — mid deck`; `console6` enabled; `v6_window` armed |
| `console6` not used, 60 s after `l6_kes_console`, calm | `l6_kes_console_2` (C, cooldown 60 s) |

#### 4.8.1 The shear — the trunk goes dark (in control; no camera is taken)

| t | event |
|---|---|
| 0.00 | the lever's grip completes |
| 0.05 | `shear_fire` (a hydraulic slam and the blade's shriek), spray from the shear (fx), shake 0.3 |
| 0.25 | the tether parts: the winch side whips back along the trough 1.5 m (no collider change; sparks off cut armour wires), the drum spins free and brakes at 1.4 s (`winch_brake`); the well side drops into the water (`splash_big`, wake ring) |
| 0.30 | the buoy ping stops — the next ping (due within 4 s) never comes |
| 0.60 | `dock_board`, the gauge and the console: `TRUNK: LOS · BUOY: LOS`; outside the windows the tether's beacon goes out and the cable's upper run drifts slowly up out of the light (`fx6_sea.cutCable()`, 6 s) |
| 1.20 | `l6_kes_dark` (radio) |
| `_dark` end + 0.4 | C: loader alive → `l6_kes_cut_loader`; dead → nothing (the quiet follows) |
| — | CHOIR says nothing (the silence is the beat). Fact `trunkCut`; milestone; beat `l6_cut` |

### 4.9 The ending — first-person cutscene at the dock console (E1, E2)

Precondition (D17): `trunkCut && loaderDead`, `cp6_quiet` written, **no awake hostile anywhere, none hunting** (the stray rule ends a stalemate, S11e),
lines `l6_kes_end_*`, `l6_sunde_end_*`, `l6_reyes_end`, `l6_choir_last_<choice>` decoded (`linesReady(ids, 1.5)` —
preloaded from `l6_quiet`), the feed set built (feed spike passed, else the `cctv` fallback). Trigger: `console6` used
(feet in `t6_console`). Markers: `mk6_end_cam0` (−44.0, −14.35, −159.4) (the stand's eye), `mk6_end_cam1` (−44.0,
−14.3, −159.0), `mk6_end_screen` (−44.0, −14.2, −157.9) (the screen plane above the desk's north edge, S1h: 1.5 m from
`cam0`, 1.1 m from `cam1`). The camera never moves more than 0.4 m (no leaf or wall is near); damage is impossible (calm; cinematic).

Times, nominal durations in brackets (the schedule is recomputed from the manifest):

| cue | t (nominal) | camera (shot) | world | line |
|---|---|---|---|---|
| S1 | 0.00 | taken; the eye blends to `cam0` over 0.6 s, look → `mk6_end_screen`, fov 72 → 55 | the screen wakes: `HEAD-END REPEATER — DOCK` / `TRUNK: LOS · BUOY: LOS` / `LAST OUTBOUND (BUFFERED): 1 ITEM` | — |
| S2 | 0.90 | dolly `cam0` → `cam1` over the whole of E1 (linear), fov 55 → 48 over 12 s | the manifest scrolls in (`manifest` screen, a line per 0.35 s, §6.4) | — |
| K1 | 2.40 | | | `l6_kes_end_1` [4.5] — or `l6_kes_end_1b` if `manifest` (read at the head-end) |
| SU1 | K1 end + 0.6 | | the totals highlight `DISPATCHED 2,880 · IN TRANSFER 240` (S10a) | `l6_sunde_end_1` [2.8] |
| SU2 | SU1 end + 0.5 | | | `l6_sunde_end_2` [3.0] |
| R1 | SU2 end + 0.8 | | | `l6_reyes_end` [1.2] |
| K2 | R1 end + 1.0 | | the cursor blinks on `CONSIGNEE: —` | `l6_kes_end_2` [3.5] |
| E2 | K2 end + 1.2 (nominal 21.2; **cap 24.0**: gaps after K1 and SU2 shrink first, to 0.3) | hold; fov 48 | **the screen changes by itself**: static 0.3 s → `POST 4 — SUB BAY — CAM 2`, the live feed of `feed6`: the empty cradle, open clamps, wet rails, the launch-lock door's red `FLOODED` lamp, an amber beacon turning | — |
| K3 | E2 + 1.6 | push in 0.15 m over 3 s | | `l6_kes_end_3` [3.8] |
| O1 | K3 end + 0.4 | | the OSD types `SDV TERN — LAUNCHED {launchAt hh:mm}` (0.8 s), then `LAUNCH AUTHORITY: AAS, L. (LT.) — PALM — LIVE` (1.2 s) | — |
| K4 | O1 + 2.4 | | | C: heard `l6_aas_2` → `l6_kes_end_4` "...Lars." [0.9]; else **`l6_kes_end_4b`** "...That's my XO's palm." [1.8] (S11a: the name lands on a person for every player) |
| C1 | K4 end + 1.0 | still | the beacon turns on the feed | `l6_choir_last_<choice>` (radio:1) [4.0] |
| B | C1 end + 1.5 | | the screen cuts to CHOIR's waveform for 0.6 s, then everything to black over 0.8 s, ambience out | — |
| END | B + 0.8 | | beat `l6_end`: carry, end cards (§7) | — |

E1 ≈ 21 s, E2 ≈ 17.3 s with `_end_4b` (each ≤ 25 s). Skippable only once seen (cutscene rule); the skip applies the same end state and
lands on the card. Interactive vs not: the shear (§4.8.1) and the quiet walk are the player's; the console press is his
choice of moment; E1 + E2 are the only taken camera of the stage.

---

## 5. Encounters, pickups, economy, cover, the boss, scares

### 5.1 Enemy groups

Soldier data as 3c (`EnemySpawn.arms`, `.cover`, pose `hold`); husks are `navy` skin. Every soldier carries a carbine in
3d (Kessler's detachment armed itself at 08:43 Monday — 3c `note5_arm`).

| group | contents | mode | where (feet), yaw | trigger | why |
|---|---|---|---|---|---|
| `g6_tun_s` | 2 soldiers (set `tunnel`) | spawn, pose `hold`; s1 walks the crossing path; released by the story | `mk6_tun_s1` (10.0, 0, −86.0), `mk6_tun_s2` (12.0, 0, −87.5), yaw +π/2 (−x) | §4.2 | long-range fight in an 80 m tunnel (aimed carbine 25–50 m) |
| `g6_tun_u` | 2 husks | spawn (behind DS2) | `mk6_tun_u1` (−1.2, 0, −91.3), `mk6_tun_u2` (0.0, 0, −91.3), yaw π | §4.2 | the close threat pushes him into their sight lines |
| `g6_rep_s` | 1 soldier (set `rep`) | spawn | `mk6_rep_s` (10.2, 0, −111.6), yaw π (facing +z) | §4.3 | mixed fight in a cluttered room |
| `g6_rep_u` | 2 husks | spawn in bay6 (`d6_bay` opens) | `mk6_bay_u1` (16.0, 0, −99.6), `mk6_bay_u2` (18.6, 0, −99.6), yaw +π/2 | §4.3 | |
| `g6_rep_k` | 2 skitters | spawn under `vent6_rep` | (5.6, 4.9, −84.0), (6.4, 4.9, −84.0) | §4.3 | |
| `g6_tunb_s` | 1 soldier (set `tunb`) | spawn in he6, walks out, pose `hold` | `mk6_he_s` (12.0, 0, −162.0) → `mk6_tunb_hold` (12.0, 0, −153.0) by `patrol`, yaw π | §4.4 | the duel in the dark |
| `g6_tunb_k` | 1 sentry `navy` | dormant `ceiling` from load (harmless, R4) | (12.0, 3.9, −134.0) | §4.4 | |
| `g6_he` | 1 soldier (set `he`) + 2 husks | spawn in hold6 | `mk6_hold_1` (−16.0, 0, −143.0) soldier; `mk6_hold_2` (−19.0, 0, −144.0), `mk6_hold_3` (−13.0, 0, −144.0); yaw 0 (−z) | manual + 4 s | CHOIR answers the switch |
| `g6_vault` | 1 soldier (set `vault`) + 2 husks | spawn in hold6 | same markers | pull + 5 s | |
| `g6_vault_k` | 3 skitters | spawn in the trench under G1/G2/G3 (y −1.0), or under `vent6_vault` (−5.6, 5.9, −160.0), (−6.4, 5.9, −160.0), (−6.0, 5.9, −159.4) | | pull + 5 s | |
| `g6_shaft` | 1 husk | spawn under L3 | `mk6_shaft_u` (−26.8, −12, −162.8), yaw π | §4.7 | the thing climbing in the dark |
| `g6_loader` | **the loader** | `mode: 'spawn'`, pose `working`; **spawned when Key B turns** (D31) and by `afterReplay` while `shaftOpen && !loaderDead` — never in `triggered` (§7.1) | rig on its rails, grab over the well holding B-14 | §4.6 (Key B), §4.8 | the boss |
| `g6_w1` (+ twin `g6_w1_r`) | 2 soldiers (sets `gal_n`, `gal_w`) | spawn in stores6 | `mk6_w1_a` (−72.0, −12, −144.0), `mk6_w1_b` (−68.0, −12, −144.0), yaw 0 | hostile start + 2 s | long-range fire from the galleries |
| `g6_w2` (+ `g6_w2_r`) | 4 husks, `pose: 'climb'` (§8.4; kinematic from spawn to exit) | spawn under water at the ladder feet | (−57.3, −23.2, −176.4), (−57.3, −24.4, −175.6) west; (−46.7, −23.2, −176.4), (−46.7, −24.4, −175.6) east (head ≥ 1.0 m under the surface: hidden, the water stops sight; the second climber 5.2 m up = 6.6 s to its exit, S1c) | pin + 1.5 s | "something in the water" made real |
| `g6_w3` (+ `g6_w3_r`) | 2 soldiers (set `gal_e`) + 1 husk | spawn at the shaft bottom, `d6_pool` shut and the player not in shaft6 (else in stores6, phase K_stores) | `mk6_w3_a` (−24.0, −12, −163.4), `mk6_w3_b` (−26.6, −12, −163.4), `mk6_w3_u` (−26.8, −12, −170.8) (all under L3 / L2) | pressure full, when ≤ 3 non-loader hostiles live (else as soon as it holds) | CHOIR brings hands from behind him |

Totals: **10 soldiers**, **14 husks**, **5 skitters**, **1 sentry**, **the loader**. Waits on enemies: the boss end (the
loader must die) and the quiet (`fightOutWhere` pool6 / shaft6, stranded rule as 3c). `rush` for every husk group;
soldiers never rushed. **Chamber cap:** never more than 6 non-loader hostiles alive in pool6 + shaft6 (W3 waits, §4.8);
the 3c damage cap (18 health+armour / s from all soldiers) and 2 fire tokens hold; the loader's own cap §5.6.6.

### 5.2 Pickups

Every auto pickup obeys the as-built rule (conventions; S1b): item ≤ 1.3 m above the floor it is taken from, ≤ 0.3 m
behind the face it is approached from, a stand point ≤ 1.0 m horizontally from it. Columns: item centre; the surface it
lies on (top y above its floor); distance to the approach face; the stand point.

| id | kind | amount | item centre | surface (top above floor) | to face | stand (feet) |
|---|---|---|---|---|---|---|
| `p6_lock_ammo` | ammo_carbine | 30 | (3.4, 1.0, 1.2) | tray-end shelf (1.0) | 0.2 (west face) | (2.6, 0, 1.2) |
| `p6_tun_med` | medkit | 35 | (−1.25, 1.0, −24.0) | bracket shelf on JB1's corridor face x −1.4 (1.0) | 0.15 | (−0.5, 0, −24.0) |
| `p6_tun_ammo` | ammo_carbine | 30 | (1.25, 1.0, −40.0) | bracket shelf on JB2 (face x 1.4) | 0.15 | (0.5, 0, −40.0) |
| `p6_tun_plate` | plate | 15 | (−1.25, 1.0, −56.0) | bracket shelf on JB3 | 0.15 | (−0.5, 0, −56.0) |
| `p6_rep_ammo_1`, `_2` | ammo_carbine | 30 each | (15.6, 1.0, −89.5), (15.6, 1.0, −88.6) | east-wall shelf x 15.4 … 15.8 (1.0) | 0.2 | (14.8, 0, −89.0) |
| `p6_rep_med` | medkit | 35 | (−5.55, 1.0, −82.0) | first-aid box on the west wall (1.0) | 0.25 | (−4.8, 0, −82.0) |
| `p6_rep_shells` | ammo_shotgun | 8 | (7.6, 1.25, −82.6) | LC2 top (1.2), at its south edge | 0.2 (south face −82.8) | (7.6, 0, −83.5) |
| `p6_bay_plate`, `p6_bay_ammo` | plate 15, ammo_carbine 30 | | (20.1, 1.0, −104.4), (20.1, 1.0, −103.6) | bay shelf x 19.9 … 20.3 (1.0) | 0.2 | (19.3, 0, −104.0) |
| `p6_tunb_ammo` | ammo_carbine | 30 | (12.75, 1.0, −125.0) | bracket shelf on RH2's face x 12.9 | 0.15 | (12.0, 0, −125.0) |
| `p6_tunb_med` | medkit | 35 | (11.25, 1.0, −141.0) | bracket shelf on RH3's face x 11.1 | 0.15 | (12.0, 0, −141.0) |
| `p6_he_vest` | vest (E, "Put on vest") | 50 | (3.2, 1.3, −160.75) | locker hook (interaction, not auto) | — | (3.2, 0, −161.6) |
| `p6_he_ammo_1`, `_2` | ammo_carbine | 30 each | (15.6, 1.05, −179.0), (15.0, 1.05, −179.0) | console desk (1.0), at its north edge | 0.2 (north face −178.8) | (15.3, 0, −178.2) |
| `p6_he_med` | medkit | 35 | (21.55, 1.0, −176.0) | first-aid box on the east wall (1.0) | 0.25 | (20.8, 0, −176.0) |
| `p6_he_shells`, `p6_he_pistol` | ammo_shotgun 8, ammo_pistol 24 | | (2.4, 1.0, −172.0), (2.4, 1.0, −171.4) | west shelf x 2.2 … 2.6 (1.0) | 0.2 | (3.2, 0, −171.7) |
| `p6_vault_ammo`, `p6_vault_med` | ammo_carbine 30, medkit 35 | | (1.6, 1.0, −150.0), (1.6, 1.0, −151.0) | east shelf x 1.4 … 1.8 (1.0) | 0.2 | (0.8, 0, −150.5) |
| `p6_vault_plate` | plate | 15 | (−3.0, 1.0, −150.65) | bracket shelf on NR's north face −150.8 | 0.15 | (−3.0, 0, −149.9) |
| `p6_trench_plate_1`, `_2` | plate | 15 each | (−12.4, −1.25, −176.4), (−12.4, −1.25, −175.8) | the trench floor (0.15) | — | crouched in T-a |
| `p6_trench_ammo_1`, `_2` | ammo_carbine | 30 each | (−10.0, −1.25, −178.8), (−9.4, −1.25, −178.8) | the trench floor | — | crouched in T-b |
| `p6_trench_med` | medkit | 35 | (−8.6, −1.25, −178.8) | the trench floor | — | crouched in T-b |
| `p6_shaft_ammo` | ammo_carbine | 30 | (−22.4, −5.0, −171.1) | fire-point cabinet shelf at L2 (1.0) | 0.2 | (−23.2, −6, −171.1) |
| `p6_shaft_med` | medkit | 35 | (−27.4, −11.2, −171.4) | the bottom box (0.8) | 0.2 | (−26.6, −12, −171.4) |
| `locker6_e` | **dock ammo locker** (interaction "Take ammo", re-armed each boss restore) | carbine 60 | (−28.4, −11.0, −194.6), use point (−28.9, −11.0, −194.6) | east gallery wall | — | (−29.6, −12, −194.6) |
| `p6_ge_med` | medkit | 35 | (−28.5, −11.0, −193.6) | the locker's shelf (1.0) | 0.3 | (−29.4, −12, −193.6) |
| `locker6_w` | dock ammo locker | carbine 30 + shells 8 | (−75.6, −11.0, −194.6), use point (−75.1, −11.0, −194.6) | west gallery wall | — | (−74.4, −12, −194.6) |
| `p6_gw_plate` | plate | 15 | (−75.5, −11.0, −193.6) | the locker's shelf | 0.3 | (−74.6, −12, −193.6) |
| `locker6_n` | dock ammo locker (S9) | carbine 60 | (−52.0, −11.0, −148.4), use point (−52.0, −11.0, −148.9) | north gallery wall, under the dock board | — | (−52.0, −12, −149.6) |
| `p6_mid_ammo` | ammo_carbine | 30 | (−65.4, −14.75, −159.0) | MC1 top (1.2), at its north edge | 0.2 (north face −158.8) | (−65.4, −16, −158.1) |
| `p6_mid_med`, `p6_mid_plate` | medkit, plate | | (−39.8, −14.75, −159.0), (−39.0, −14.75, −159.0) | MC2 top, north edge | 0.2 | (−39.4, −16, −158.1) |
| `p6_uc_ammo_1`, `_2` | ammo_carbine | 30 each | (−63.4, −19.0, −153.8), (−62.6, −19.0, −153.8) | tool shelf on P1's north face −154.0 (1.0) | 0.2 | (−63.0, −20, −153.0) |
| `p6_uc_med`, `p6_uc_plate` | medkit, plate | | (−41.4, −19.0, −153.8), (−40.6, −19.0, −153.8) | tool shelf on P2's north face | 0.2 | (−41.0, −20, −153.0) |
| `p6_ww_ammo`, `p6_ww_med` | ammo_carbine 30, medkit | | (−70.0, −19.0, −195.5), (−34.0, −19.0, −195.5) | window-walk fire points on the south wall (1.0) | 0.3 | (−70.0, −20, −194.7), (−34.0, −20, −194.7) |
| `p6_cage_ammo`, `p6_cage_plate` | ammo_carbine 30, plate | | (−54.5, −15.0, −167.0), (−54.5, −15.0, −166.5) | the cage box (1.0) | 0.3 (east face −54.2) | (−53.7, −16, −166.8) |
| (drop) each soldier | ammo_carbine 15 — **or the carbine itself (30) if the player owns none** (3c S6) | | on its body (touch; a body in water deeper than 0.6 m drops nothing — it sinks) | | | |

### 5.3 Economy and TTK (player weapons as built: pistol 20, shotgun 9 × 9, carbine 18 × 0.8 beyond 40 m; aim RMB)

| target | HP | multipliers | pistol | shotgun ≤ 6 m | carbine (hits / aimed time) |
|---|---|---|---|---|---|
| soldier | 100 | head 2.0 · torso 0.8 · limb 0.7 (3c) | 7 / 3 head | 2 shells | 7 / 0.6 s; head 3 / 0.2 s |
| husk | 90 | head 2 · limb 0.7 | 5 | 1–2 | 5 / 0.4 s |
| skitter | 18 | — | 1 | 1 | 1 |
| sentry | 60 | — | 3 | 1 | 4 |
| loader flood (× 4) | 40 | 1.0 | 2 | 1 | 3 |
| loader jaw ram (× 2) | 200 | **1.0 extended** (amber glass lit) / **0 retracted** (clank, sparks, pip shake — S3) | 10 | 3 shells | 12 / ≈ 1.2 s (a 3.2 s window: the lock 0.8 + recovery 2.4) |
| loader pod | 500 | **0 cowl shut → 1.0 open** (after both rams) | 25 | (out of range) | 28 / ≈ 2.8 s on target |
| loader body | — | 0.05 (sparks, R2) | | | |

**Budget in hits (S9):** the main route needs soldiers 10 × 7 = 70, husks 14 × 5 = 70, skitters 5, the sentry 4, the
loader's rams 2 × 12 = 24 and pod 28 → **201 carbine hits ≈ 402 rounds at 50 %**. Carbine rounds on the main route (all
reachable under the pickup rule, §5.2): 300 before the arena + 300 in it (pickups and the dock lockers) = **600** (+ 60 in the trench) + 150 in drops = **750** (+ the carry; the 180 reserve cap keeps it sane). **The arena
alone** needs rams 24 + pod 28 + W1/W3 soldiers 4 × 7 = 28 + W2/W3 husks 5 × 5 = 25 = **105 hits = 210 rounds at 50 %**; it
holds the three dock lockers 150 + mid deck 30 + undercroft 60 + window walk 30 + cage 30 = **300** + 4 drops × 15 = 60 →
**360 (1.71 ×, 42 % left over)**; `--dry` proves ≥ 30 % (§10.1). And **every boss restore tops the reserve to ≥ 90 and
re-arms the lockers** (B5), so a restore never leaves him dry. Medkits 11 (+1 trench), plates 9 (+2 trench), vest 50. Every fight has ≥ 30 carbine
rounds and a medkit ≤ 15 m before it. A player with no carbine (3b skippable) gets one from the first soldier he kills
(3c S6 rule) — the direct start always has one.

**Why it stays fair as a finale:** soldiers as 3c (visible aim, first burst misses, ≤ 2 firing, never sprint, cap);
the loader telegraphs everything for ≥ 1.4 s (§5.6.4) and never fires at range; the frame's cage is never slammed; the
galleries are never reached by the grab; checkpoints at every milestone.

### 5.4 Cover points (level data, `Level.cover`, 3c §8.3)

`n` = the direction the soldier faces using it (the object lies 0.3 … 0.7 m along `n`); every point 0.55 m from its
object's face, ≥ 0.1 m clear of walls (capsule r 0.35). `low` ≤ 1.3 m (crouch eye 0.85, chest **and** head tested),
`high` ≥ 1.8 m. **New (§8.1): `enabled`** — a dock point is enabled only while its slot holds a container.

| set | id | feet (x, y, z) | n | h | object (its face) |
|---|---|---|---|---|---|
| `tunnel` | `cv6_t1` / `t1b` | (−1.85, 0, −25.35) / (−1.85, 0, −22.65) | +z / −z | high | JB1 (south −24.8 / north −23.2) |
| | `cv6_t2` / `t2b` | (1.85, 0, −41.35) / (1.85, 0, −38.65) | +z / −z | high | JB2 (−40.8 / −39.2) |
| | `cv6_t3` / `t3b` | (−1.85, 0, −57.35) / (−1.85, 0, −54.65) | +z / −z | high | JB3 (−56.8 / −55.2) |
| | `cv6_t4` / `t4b` | (1.85, 0, −71.35) / (1.85, 0, −68.65) | +z / −z | high | JB4 (−70.8 / −69.2) |
| | `cv6_t5` / `t5b` | (1.2, 0, −31.05) / (1.2, 0, −28.95) | +z / −z | low | DT1 (−30.5 / −29.5) |
| | `cv6_t6` / `t6b` | (−1.2, 0, −63.05) / (−1.2, 0, −60.95) | +z / −z | low | DT2 (−62.5 / −61.5) |
| `rep` | `cv6_r1` | (12.15, 0, −82.3) | −x | high | DS1 (east face 11.6) |
| | `cv6_r2` | (10.3, 0, −83.55) | +z | high | DS1 (south face −83.0) |
| | `cv6_r3` | (−0.7, 0, −90.95) | +z | high | DS2 (south face −90.4) |
| | `cv6_r4` | (−2.55, 0, −89.7) | +x | high | DS2 (west face −2.0) |
| | `cv6_r5` | (5.7, 0, −90.15) | +z | low | LC1 (south face −89.6) |
| | `cv6_r6` | (6.95, 0, −89.0) | −x | low | LC1 (east face 6.4) |
| | `cv6_r7` | (8.75, 0, −82.2) | −x | low | LC2 (east face 8.2) |
| | `cv6_r8` | (7.6, 0, −83.35) | +z | low | LC2 (south face −82.8) |
| `tunb` | `cv6_b1` / `b1b` | (10.4, 0, −110.55) / (10.4, 0, −107.45) | +z / −z | high | RH1 (−110 / −108) |
| | `cv6_b2` / `b2b` | (13.6, 0, −126.55) / (13.6, 0, −123.45) | +z / −z | high | RH2 (−126 / −124) |
| | `cv6_b3` / `b3b` | (10.4, 0, −142.55) / (10.4, 0, −139.45) | +z / −z | high | RH3 (−142 / −140) |
| `he` | `cv6_h1` / `h2` | (4.45, 0, −164.3) / (4.45, 0, −169.3) | +x | high | R1 / R2 west ends (x 5) |
| | `cv6_h3` | (10.0, 0, −163.45) | −z | high | R1 (north face −164.0) |
| | `cv6_h4` | (10.0, 0, −170.15) | +z | high | R2 (south face −169.6) |
| | `cv6_h5` / `h6` | (15.55, 0, −164.3) / (15.55, 0, −169.3) | −x | high | R1 / R2 east ends (x 15) |
| `vault` | `cv6_v1` / `v2` | (−18.5, 0, −155.25) / (−18.5, 0, −161.25) | −z | high | CD1 / CD2 (north faces −155.8 / −161.8) |
| | `cv6_v3` / `v4` / `v6` | (−15.95, 0, −157.0) / (−15.95, 0, −163.0) / (−15.95, 0, −151.0) | −x | high | CD1 / CD2 / CD3 (east faces −16.5) |
| | `cv6_v5` | (−3.0, 0, −150.25) | −z | high | NR (north face −150.8) |
| `gal_n` | `cv6_gn1` … `gn4` | (−62.0 / −60.0 / −42.0 / −40.0, −12, −150.65) | −z | low | north parapets (z −151.2) |
| `gal_w` | `cv6_gw1` / `gw2` / `gw3` | (−73.35, −12, −188.0 / −178.0 / −164.0) | +x | low | west parapets (x −72.8) |
| `gal_e` | `cv6_ge1` / `ge2` / `ge3` | (−30.65, −12, −188.0 / −186.0 / −176.0) | −x | low | east parapets (x −31.2) |
| `mid` | `cv6_m1` / `m2` | (−65.4, −16, −158.25) / (−39.4, −16, −158.25) | −z | low | MC1 / MC2 (north faces −158.8) |
| | `cv6_m3` | (−52.0, −16, −149.45) | −z | high | winch (north face −150.0) |
| | `cv6_m4` / `m5` | (−49.45, −16, −152.0) / (−54.55, −16, −152.0) | −x / +x | high | winch (east −50.0 / west −54.0) |
| `dock` (enabled with the slot) | `cv6_s1n` / `s1s` / `s1e` | (−71.0, −20, −179.05) / (−71.0, −20, −182.55) / (−67.45, −20, −180.8) | −z / +z / −x | high | sl6_1 container (north −179.6 / south −182.0 / east −68) |
| | `cv6_s2n` / `s2s` / `s2e` | (−71.0, −20, −173.45) / (−71.0, −20, −176.95) / (−67.45, −20, −175.2) | −z / +z / −x | high | sl6_2 |
| | `cv6_s3n` / `s3s` / `s3w` | (−33.0, −20, −179.05) / (−33.0, −20, −182.55) / (−36.55, −20, −180.8) | −z / +z / +x | high | sl6_3 |
| | `cv6_s4n` / `s4s` / `s4w` | (−33.0, −20, −173.45) / (−33.0, −20, −176.95) / (−36.55, −20, −175.2) | −z / +z / +x | high | sl6_4 |
| | `cv6_s5n` / `s5s` / `s5w` | (−57.0, −20.8, −189.05) / (−57.0, −20.8, −192.55) / (−60.55, −20.8, −190.8) | −z / +z / +x | high | sl6_5 (wet) |
| | `cv6_s6n` / `s6s` / `s6e` | (−47.0, −20.8, −189.05) / (−47.0, −20.8, −192.55) / (−43.45, −20.8, −190.8) | −z / +z / −x | high | sl6_6 (wet) |
| `uc` | `cv6_u1` / `u2` | (−63.0, −20, −153.45) / (−41.0, −20, −153.45) | −z | high | P1 / P2 (north faces −154.0) |
| | `cv6_u3` / `u4` | (−61.45, −20, −155.0) / (−42.55, −20, −155.0) | −x / +x | high | P1 east −62.0 / P2 west −42.0 |

**75 points** (12 + 8 + 6 + 6 + 6 + 4 + 3 + 3 + 5 + 18 + 4). Re-verified: each `n` points at its object (the face named),
0.55 m; spine-like corridors (tunnels) keep 0.1 m to the walls (x ±1.85 vs ±2.3; ±10.4 / 13.6 vs 9.7 / 14.3: 0.35);
`cv6_s2n` / `s4n` leave the stair-foot aprons (z −172.4) 0.7 m clear; `cv6_m3` stands under the north gallery (3.7 m
head room); no point within 1.0 m of a door plane (nearest: `cv6_h1` 2.45 m from `d6_vault`); none in a `nav: false` floor
or in water deeper than 0.6 m (the wet points stand in 0.5 m). W4a self-tests each (3c §8.3) incl. `enabled`.

### 5.5 Boss waves (set moments) and the cap

| wave | at | contents | route / behaviour | restore |
|---|---|---|---|---|
| W1 | hostile start + 2.0 s | 2 soldiers from stores6 onto the north gallery | covers `gal_n`, then `gal_w`; they shoot at the cage and the dock at 18–35 m; the loader's floods light the player for them (D20) | twin `g6_w1_r` (the restore re-applies phase K_stores and the `d6_stores` latch for it, S2b); restore point `mk6_boss_safe` (east gallery) |
| W2 | pin out + 1.5 s | 4 husks climb out of the well (2 per ladder, 1.5 s apart) | over the coaming, down to the dock, rushed 30 s; up `ST6_M` / `ST6_M2` to the mid deck and the cage if he is there | `g6_w2_r`; restore point `mk6_boss_safe` |
| W3 | pressure full, once ≤ 3 non-loader hostiles live | 2 soldiers + 1 husk from the shaft bottom through `d6_pool` (or stores6) | covers `gal_e` (behind the player when he is at the frame) | `g6_w3_r` (from the shaft bottom as the original); restore point **`mk6_boss_safe_w`** (−74.3, −12, −170.0) on the west gallery, yaw −90 (looking east), 46 m from W3's door — never beside it (S2c) |

Whatever the order: killing the loader first does not cancel a wave (each keys on its step); skipping the frame for a
while does not start them (each needs its step). A wave's members that leave the chamber (into the shaft) are fought
there; the stranded rule removes members unseen ≥ 30 m for 60 s during the quiet's `fightOutWhere`. **On a restore only
the latest wave comes back** (the one whose step is latest among those done): fresh from its twin if it was `alive` at the
save; if it was `pending` (W3 waiting for ≤ 3 hostiles) it is re-queued under its own rule, never spawned after the grace
regardless; a wave `dead` at the save stays dead; earlier waves never come back (S2a). This keeps a restore within the
cap of 6.

### 5.6 The boss — the dock loader (`EnemyType 'loader'`, W3a body + W3b behaviour)

#### 5.6.1 What it is, and how it reads
An autonomous overhead gantry crane built for unmanned cargo transfer through the moon pool's sea gate: bridge, trolley,
four ropes, a four-jaw grab with a hydraulic power pack, four floods, a control pod, a PA horn. Painted crane-yellow,
rust runs, hazard bands, worn decals `HALCYON DOCK SYSTEMS — DL-2 — SWL 32 T`. Its **marks** (`RigBuilder.mark()`): the
pod's sensor cluster and a status lamp on the grab — **cyan while working (dormant), red from the hostile start, out
when dead** (the merged marks' language). It is never a creature: it moves with a crane's inertia (accelerate, coast,
brake, sway), it announces itself on its PA in a crane's safety phrases, it lights what it is about to do.
States: `working` (from its spawn when Key B turns, D31: a scripted loop — B-14 lowered into the well, the grab returning empty, a slow
patrol over the dock; floods sweeping its work area; reacts to damage at once: hostile), `stage1`, `stage2`, `stage3`,
`guard` (a sub-state of every stage), `dying`, `dead`.

#### 5.6.2 Body and rig (W3a, `src/enemies/loader/{model,rig}.ts`)
Bones/parts: `bridge` (translate z), `trolley` (translate x), `hoist` (rope length), `grab` (pendulum pivot under the
trolley: sway x/z ±0.4 rad as a damped spring — the sway is real, it reads as weight), `jaw_n/s/e/w` (open 0 … 1),
`ram_e` / `ram_w` (extension follows the jaws; sight glasses emissive while extended), `pod` + `cowl` (louvres 0 … 1),
`flood_1 … 4` (pan/tilt yokes; lamp heads), `pa` (horn). Draw calls ≤ 14 (bridge + end trucks 1, trolley 1, ropes 1
(a scaled cylinder set, one material), grab body 1, jaws 1 (one skinned mesh), rams 1, pod + cowl 1, flood heads 1, lenses
(emissive) 1, festoon 0 (level), marks 0 (merged), shadow proxy 1 (grab only), the carried container 1 (the level's
instance swapped to a dynamic mesh while carried)). **Hit volumes**: `flood_1 … 4` (spheres r 0.32 at the lamp heads),
`ram_e` / `ram_w` (capsules r 0.12 × 1.0 m on the grab's east and west sides; ×1.0 only while extended, else **0** —
the volume stays, the multiplier changes), `pod` (box 1.6 × 1.0 × 1.2; **0** until `cowl` opens), `grab` (box, ×0.05),
`bridge` / `trolley` (boxes, ×0.05; volumes merged per part). Part names in `EnemyHit.part`: `flood_n`, `ram_e`,
`ram_w`, `pod`, `body`. Light: each flood is a `ctx.render.lights` spot (14° … 22° cone, 45 m, prio 0.9; FL1/FL2 cast
on MEDIUM+), the grab's ring light is emissive only.

#### 5.6.3 Perception
Eyes = the pod's sensor (y ≈ −4.5), range 60 m, `lineOfSight` (move-only rails and bars pass, slabs and plate block, water
stops it); the floods aim at the player whenever it sees him (slew 1.2 rad/s; each flood alive adds to the beam set).
**Flood-lit** (D20): the player inside a live flood's cone within 45 m = "lit" for every soldier with an eye ray to him
(3c's `lit` flag, not only after firing). With 0 floods alive the loader can still see (its sensor) but cannot light him,
and its slam tracking lags 0.5 s more (it aims by its sensor alone).

#### 5.6.4 Attacks and telegraphs (all numbers in `LOADER_TUNING`, `src/enemies/loader/tuning.ts` — the one table)

| attack | stages | telegraph (what the player sees / hears) | timing | effect | rules |
|---|---|---|---|---|---|
| **SLAM** (drop the grab on him) | 1, 2, 3 (rams alive) | the floods converge on him and a **bright ring** tracks his feet with a 0.25 s lag (0.75 s with no floods) while the grab hovers 3.5 m above his deck (`loader_track` whine); then the ring **stops and turns red**, the jaws open with a hiss (`loader_jaws`), the brakes clack (`loader_brake`) | track 1.4 / 1.1 / 0.9 s; **lock 0.8 s (all stages)**; drop 0.45 s | impact r 1.8 m: **35** + knock-back 6 m/s away (horizontal only); shock r 4 m: shake 0.5, no damage; then the grab **sits 2.4 s (stage 3: 1.8 s) with the jaws open — rams extended, amber glasses lit** (the weak-point window); rise 1.0 s | a target only on the dock / wet dock (d ≤ 0.7) / mid deck, ≥ 3.5 m from the no-slam zone (plan x −58 … −46, z −174 … −149: the cage, the frame, the trough and the winch), not under the mid deck or a gallery, not on a stair ± 1.5 m, **the grab's box at its lowest clear of every collider but the deck** (no slam onto MC1 / MC2, the console, a container, the bar guard — S6b), no other enemy within 2.0 m (it waits 0.5 s and re-checks, max 3); **damage only with a clear ray from the grab's bottom centre to the player's chest** (a container between them shields him — S6c); cooldown 5.5 / 4.2 / 3.2 s. Escape (controller as built, ground accel 11): a walker from rest covers 2.55 m in the 0.8 s lock and 4.17 m by impact; a knee-deep wader 2.5 m by impact — both clear 1.8 + 0.35; waist-deep: never targeted |
| **SHIFT** (moves the cover) | 1, 2 | the floods leave him and fix on the container he is using; the jaws hiss open over it; the **destination slot's painted outline lights and strobes amber** | clamp 1.0 s; lift 2.0 s; carry 1.6 m/s; outline lit **1.6 s before** the set-down | the container (and its cover points) leave; set down in the free slot farthest from him (stage 1); **40** + a push out if he stands inside the destination slot at contact | every 18 s while he is within 3 m of an occupied slot's box **on his own deck** (feet within ± 1 m of the slot's floor — never from a gallery, S3); never a slot holding an enemy; never lifts while a body's feet are within 0.3 m above the container's top (it waits, re-checks, then shoves the body off at 2 m/s — B2); the set-down footprint clear of every collider but the deck (S6b) |
| **DROP** (cargo on the head) | 2, 3 | as SHIFT, but the destination is the free slot **nearest** him within 6 m, and the outline strobes red; the container hangs 4.5 m over it | strobe **1.6 s**, release, fall 0.69 s (g 19) | **40** if inside the slot box at contact, else nothing; the container becomes cover there | cooldown 9 / 7 s; only into slots (never onto a route) |
| **SWING** (wrecking-ball) | 3, **both rams gone** (the jaws hang dead) | the trolley winds back 1.2 s with a brake squeal (`loader_squeal`) while the floods swing into a **lit lane** along the swing line; the ropes creak | wind 1.2 s; sweep 1.4 s along a 9 m arc at chest height (the grab's bottom 1.15 m above the deck) | **30** + knock-back 7 m/s; **a crouched player passes under it** (1.1 m capsule) | lanes only where the trolley can run (x −67 … −37, keeping 4.2 m from the galleries' edges) and only where the whole arc is clear of colliders at the swing height (bar guard, cage, containers, stairs, the winch — `Level.dock.target` checks the lane); on his deck only (a wader in the wet dock stands below a dock-level swing); cooldown 5 s |
| **GLARE** | all | the floods on him | continuous | flood-lit (D20); exposure bump 0.15 (no damage) | — |
| **GUARD** | all | the grab parks high over the south dock at (−52, −8, −186) (grab centre; out of the cage's line, ~18 m off), jaws closed (rams retracted: ×0), the floods on him | while he is unreachable (a gallery, the undercroft, the cage, the shaft) for ≥ 2 s | — | nobody is under it (it hangs 11 m over the wet dock); it leaves the moment he steps onto a slam-target deck (S3) |

Damage cap: the loader deals ≤ 40 health+armour per 2 s (a guard). It never damages enemies (CHOIR's hands) and never
knocks the player through a rail (knock-back is horizontal; rails are move-only colliders — a body stops).

#### 5.6.5 Damage model and stages

| part | HP | multiplier | on destroy |
|---|---|---|---|
| `flood_1 … 4` | 40 each | 1.0 | lamp head shatters (`flood_pop`, glass), its spot goes out, a sparking stub; the beam set shrinks (D20); the chamber darkens with each |
| `ram_e`, `ram_w` | 200 each | 1.0 extended (amber glass lit) / **0 retracted** (a hard clank `armour_clank`, sparks, the HUD pip shakes — R2's "different"; coordinator 4) | the ram bursts (spray, `ram_burst`), that side's jaws hang open; milestone; first one → stage ≥ 2; both → stage 3, **SLAM becomes a dead-weight drop** (same telegraph, no jaw hiss) and **SWING** is added; the pod's cowl opens (`cowl_open`: louvres snap open, steam, the red glow inside, PA `Control fault. Cooling.`) |
| `pod` | 500 | **0 cowl shut** (the same clank) / **1.0 open** | death (§5.6.8) |
| `body` (bridge, trolley, grab, ropes) | — | 0.05 | sparks, `impact_metal` |

Stage = max(objective stage, damage stage): **1** at the hostile start; **2** at pin out or the first ram; **3** at the
pressure full or both rams. Stage 2 adds `lights_out6` (once, whichever triggered it) and DROP; stage 3 shortens every
timing as the table and makes the bridge 1.5 × and the trolley 1.4 × faster (bridge 2.0 → 3.0 m/s, trolley 2.5 → 3.5
m/s, hoist 2.0 m/s, drop 7.8 m/s). **No risk-free win (S3):** the rams are extended only in a slam's lock and recovery
and in a clamp / release on his own deck, and the loader slams only decks it can reach — so from the cage, the undercroft
or a gallery every ram and the shut pod take 0; the floods can be shot from anywhere (they are optional).

#### 5.6.6 `LOADER_TUNING` (the one table; IA retunes here only)

| key | value |
|---|---|
| `hp` | floods 40, rams 200, pod 500 |
| `mult` | ram extended 1.0 / **retracted 0** · pod open 1.0 / **shut 0** (clank + pip shake) · body 0.05 |
| `sight` | 60 m, sensor at the pod; flood slew 1.2 rad/s; flood cone 14°–22°, 45 m |
| `slam` | track 1.4 / 1.1 / 0.9 s · lag 0.25 s (0.75 s no floods) · lock 0.8 s · hover 3.5 m · drop 0.45 s · r 1.8 m dmg 35 knock 6 m/s · shock r 4 m shake 0.5 · recover 2.4 / 2.4 / 1.8 s · rise 1.0 s · cooldown 5.5 / 4.2 / 3.2 s |
| `shift` | period 18 s · near 3 m on his deck (± 1 m) · lift guard 0.3 m · clamp 1.0 s · lift 2.0 s · carry 1.6 m/s · outline 1.6 s · dmg 40 |
| `drop` | stages 2–3 · near 6 m on his deck · strobe 1.6 s · height 4.5 m (fall 0.69 s) · dmg 40 · cooldown 9 / 7 s |
| `swing` | stage 3 + both rams · wind 1.2 s · sweep 1.4 s · arc 9 m · bottom 1.15 m · dmg 30 knock 7 m/s · cooldown 5 s |
| `guard` | after 2 s unreachable · park `Level.dock.park` = (−52, −8, −186) |
| `speed` | bridge 2.0 / 3.0 m/s (× 1.5) · trolley 2.5 / 3.5 m/s (× 1.4) · hoist 2.0 m/s · drop 7.8 m/s |
| `noSlam` | plan box x −58 … −46, z −174 … −149 (the cage, the frame, the trough, the winch; `Level.dock.noSlam`) + 3.5 m horizontal margin, applied on the mid deck; on the dock the same plan area is the well and its coaming (never a target) |
| `cap` | ≤ 40 per 2 s to the player |
| `waveCap` | 6 non-loader hostiles in pool6 + shaft6 |

Confirmed or retuned at the **loader-in-motion review** on the greybox (§11 gate).

#### 5.6.7 Arena data the loader reads (level, W4)
Everything through `Level.dock` (§8.1), so the enemy code holds no coordinates: the six slots (box, floor, container,
cover point ids) with `lift` / `place` / `drop` handing a container's dynamic box and mesh to the loader and back (decals
ride it — `HitOwner` = the container object; `check:decals`); `noSlam` (plan box + margin rule); `rails` (`{ xMin, xMax,
zMin, zMax, railY }` — the trolley's and bridge's travel); `park` (the guard point); and `target(p)` — the one slam-target
test (deck kind, depth ≤ 0.7, not under the mid deck / cage / a gallery, not on a stair ± 1.5 m, outside the no-slam
margin, hover height clear of the decks above).

#### 5.6.8 Death (the clear, satisfying end)
The pod's last hit: the pod blows (`fx.explosion(pod, 0.8)`, `loader_death`), the PA says half a word and dies, the CHOIR
mark goes out; the trolley lurches toward the well (2.0 s of failing drive: the bridge and trolley run to put the grab
over the well's centre (−52, −176) — "it dies reaching for the water"), the brakes let go: the grab plunges into the well
(`splash_big`, a column of spray, the ropes run out whipping and go slack into the water), a carried container goes with
it; the floods die one by one over 1.5 s; the bridge coasts into its end-stop buffers with a long screech. Nothing lands
on a deck (no wreck box to route around); no damage to the player from the death. Milestone; boss pips off.

#### 5.6.9 Boss checkpoints (D21; amended for B5, S2)
Milestones: pin, pressure, cut, ram E, ram W, pod. 1.0 s after each, if the player is alive, `cp6_m<n>` is written
**with `checkpointNow`** (the base's calm saver never fires mid-fight, `base.ts:719-756`); if a grip is running at that
moment the save is **deferred to the grip's end + 1.0 s** (never skipped — a ram killed during the 6 s pump keeps its
checkpoint). n = milestones done, 1 … 5; the sixth ends the fight, after which `cp6_quiet` follows when calm. Saved: the
flags (`pin`, `pressure`, `trunkCut`, `ramE`, `ramW`, `loaderDead`, `bjOpen` …), the loader's `BossState` (parts' HP,
floods alive, stage, slot layout, B-14 in the well), `waves` (`pending` / `alive` / `dead` per wave and which is latest),
`lights_out6`, `launchAt`. **Restore** (a fresh page): the player at the **latest wave's restore point** — `mk6_boss_safe`
(−30.0, −12, −166.0) on the east gallery yaw +90 for W1 / W2 / none, **`mk6_boss_safe_w`** (−74.3, −12, −170.0) on the west
gallery yaw −90 when W3 is latest (S2c) — **health = max(saved, 60)**, armour as saved, **the carbine's reserve topped to
≥ 90** (the best owned weapon's if he has no carbine) and the three **dock ammo lockers re-armed** (B5); the loader
rebuilt with `boss.restore(state)` in `guard` for 3.0 s (grace) then its stage; **only the latest wave** handled per §5.5
(twin if `alive`, re-queued under its rule if `pending`, nothing if `dead`), W1's twin with phase K_stores and its latch
re-applied; earlier waves never come back; the frame as saved (pin out, gauge full or 0 — partial pump progress is not
saved); slots as saved. When the loader dies, `enemy:group-cleared` puts `g6_loader` into `prog.cleared`; that is harmless
because every later load has `loaderDead` and calls `removeSilently()` first (S2e). The level-6 `calm()` ignores holding
soldiers through `EnemyManager.holding(group)` (merged in 3c's K, S2f). A death never replays more than one milestone.

#### 5.6.10 Tests (`scripts/check-loader.mjs`, W3b; on `src/enemies/dev/loader.html` with a greybox arena that copies the
chamber's rails, decks, well, slots and the no-slam box; W3b ships a `StubLoaderRig` (boxes) so 1–14 run before W3a lands)
1. Telegraph: every SLAM has track ≥ 0.9 s + lock 0.8 s before the drop (state log); the ring stops at the lock start;
   `loader_jaws` once per slam; no damage outside r 1.8 m; no damage without the grab-to-chest ray (a container between).
2. Fairness: a bot walking straight from rest (ground accel 11) from the lock start leaves r 1.8 + capsule in every trial
   (100); wading 0.5 m deep likewise; no slam ever targets d > 0.7, the no-slam box + 3.5 m (mid deck), under-deck, a stair
   ± 1.5 m, a gallery, or a point where the grab box at its lowest would touch a collider other than the deck.
3. Windows: after a slam the rams are ×1.0 for 2.4 s (stage 3: 1.8 s) and **0** otherwise; a debug aim-lock carbine kills
   one ram in one window at 10 m.
4. Damage model: floods 3 carbine hits; rams 12 extended / **∞ retracted (0 damage, `armour_clank` once per 0.3 s, pip
   shake)**; pod 28 open / **0 shut**; body ×0.05.
5. Stages: pin → 2; first ram → 2; pressure → 3; both rams → 3 + cowl open + SWING enabled; whichever first.
6. SHIFT / DROP: every set-down and drop is preceded by the outline ≥ 1.6 s; only into slots; never a slot with an enemy;
   never triggered by a player on another deck (a gallery); a bot standing in the slot takes 40 and is pushed out (never
   inside a box afterwards); the route corridors (§2.6.9) stay passable for every slot layout (**C(6,4) = 15** layouts with
   4 containers: a capsule flood fill per layout — S1d).
   6b. (B2) A bot dropped onto a container top, and onto the grab top, ends on a deck within 0.5 s; the loader never lifts
   with a body on its load.
7. SWING: lit lane ≥ 1.2 s before; a crouched bot passes under; never reaches a gallery; never through a collider.
8. GUARD: unreachable player ≥ 2 s → the grab parks at `Level.dock.park`; leaves it when he steps onto a target deck.
9. Flood-lit: a soldier with an eye ray sees a player inside a live flood beam at 30 m (dark region), not after the flood
   dies, and not while that flood's light is out of the light pool (S13).
10. Cap: ≤ 40 per 2 s, every 2 s window; never damages an enemy.
11. Knock-back: 200 knock-backs next to rails, the coaming guard and the bar guard: the player never ends beyond a guard.
12. Death: the grab ends in the well, nothing on a deck; marks out ≤ 2.5 s; pips off; `enemy:died` once.
13. Restore round-trip: `boss.snapshot()` → `restore()` reproduces parts, stage, floods, slots; grace 3.0 s.
14. Cost: the loader's update ≤ 0.25 ms on MEDIUM; rays ≤ 20/s (sight 6, slam-target checks, flood occlusion).
15. (S3) A bot in the cage, and one on the east gallery, with W1 dead, firing at the rams and the pod for 120 s: 0 damage
    to either.

### 5.7 Scares in the quiet moments (vignettes, 3c §5.5 kit and rules)

Common rule as 3c (`scareOk`): once; calm (no hostile awake within 30 m, no shot within 4 s, no cutscene, no note, no
`scene` line); ≥ 45 s since the last scare, ≥ 90 s between loud ones (L); never within 1.0 m of a door plane; no collider
on a route; snapped on restore (`id:snap`). **Boss rule:** no scare from the hostile start until `l6_quiet` except where
stated. Exemptions noted per row.

| # | id | room | trigger (beyond the common rule) | what the player sees and hears | sounds (level-owned) | snap | L | honest because |
|---|---|---|---|---|---|---|---|---|
| 1 | `v6_crossing` | tun6_a | §4.2 | far down the tunnel, 60 m off, a sailor crosses the mouth into Repeater 2 left to right, unhurried, weapon light on, never turning his head | (his own steps, the enemy module's) | — (he is a real soldier) | | a real enemy, shootable; F1 follows |
| 2 | `v6_tent` | rep6 | the tent in view ≤ 8 m for 0.5 s | a draught through the bend: the tent flap lifts and falls back; the work lamp inside swings on its hook; for a second, a pair of boots under the splicing table, not moving | `tarp_flap`, `lamp_creak` (exists) | flap shut, lamp still | | the bend's ventilation; Rød died at his work Monday (`note6_jobcard`) |
| 3 | `v6_handset` | he6 | §4.5 | the phone's howler buzzes three times; a man's whisper from the hanging handset; if answered, Aas | `phone_howler`, `phone_dead_click`, `line_hiss` + lines `l6_aas_*` (story-spoken, fx `phone`) | handset on its hook, howler silent | | the navy's sound-powered phones are hard-wired, outside CHOIR's network; Aas found a station |
| 4 | `v6_drum` | vault6 | CD2 in view ≤ 12 m for 1 s, ≥ 4 s in the vault | the 4 m drum starts to turn by itself, its ratchet clacking louder and faster, cable paying out into the trench in loops; it brakes with a bang and rocks still | `ratchet_run`, `drum_rumble`, `drum_brake` | drum stopped, 6 m of cable slack on the floor (decal + a static coil, no collider) | L | its brake was left off (the jointers' job card); the hull's flex turns it — and CHOIR runs the drum stands (it does not deny it) |
| 5 | `v6_ring` | vault6 | the first fast ping after the pull (exempt from spacing and calm: the pull's consequence) | the ping, much closer now, and the whole vault rings with it like a bell; dust sifts from the trays; the drums hum | `ping_close`, `hull_ring`, `dust_sift` | — | L | the buoy's transducer is bolted to the hull below; the backup carries everything now |
| 6 | `v6_thud` | vault6 / he6 | §4.6 — only within pull + 20 … + 90 s and before Key B turns, else never (S4, S10d) | a long deep thud through the structure, felt (shake 0.25), then a long hiss of water filling something, far off; the lights dip once | `far_lock_flood`, `lights_dip` | — | L | it is Post 4's launch lock flooding: the boat leaving (E2 shows it) |
| 7 | `v6_shaft_lights` | shaft6 | §4.7 — **exempt from spacing** (it carries F6 and `cp6_shaft`; only "once" and "calm" apply, S4) | the landing lamps below him pop one after the other — pop, pop, pop — then the ones above; only the nosing strips; and two red points climbing toward him from the bottom | `bulb_pop` × 5, `glass_tinkle` | lamps dead, `shaft6_emerg` on | L | CHOIR kills the mains (as 3c); the emergency strips are hard-wired; the unit is real (F6) |
| 8 | `v6_well_eyes` | pool6 | the reveal (exempt from the boss rule **and from spacing**, S4; ends at the hostile start) | deep in the black well, past where the light goes, four faint cyan points, still, in two pairs by the walls | — (silent) | gone | | they are the units of W2, dormant at the ladder feet (cyan = powered standby); they climb out when the pin comes out |
| 9 | `v6_window` | pool6 | after `l6_quiet`, feet in `t6_windows` or the windows in view ≤ 20 m for 2 s | outside, beyond the last of the light, something very large passes slowly across the windows and is gone; the marine snow swirls in its wake | `sea_groan` (sub-bass, far) | — | | something lives down here; it is not explained (later chapters) |

Escalation (whatever the room order): a man walking away → a tent's draught → a voice → a machine turning by itself → the
hull ringing → something leaving through the hull → darkness coming up to meet him → eyes in the water → the sea itself.
At most one per room; never two loud ones within 90 s (exempt: the ring — it is the pull — and the beats that carry a
fight or a checkpoint, `v6_shaft_lights` and `v6_well_eyes`). `--scares` asserts the shaft beat fires on the default
route.

### 5.8 What forces what (R1)

| situation | behaviour |
|---|---|
| stays in lock6 | the tube is open; nothing comes; the way back is sealed (3c) |
| goes back to the tube after the latch | locked, panel `TRUNK TUNNEL — HEAD-END TUBE — CLOSED` |
| runs down the tunnels without fighting | F1 / F2 / F3 come after him; checkpoints wait for calm |
| tries the vault enclosure before the crank | `Interlock key A required`; Q → the switch |
| tries the stair door before the pull | `Interlock key B required`; Q → the beach joint |
| never answers the handset / never reads the queue | the voice stops after its second try; the queue is in the ending anyway |
| hides in the trench during F5 | enemies hold 2–5 m off the exits (3c rule, never inside the hatch rails); the skitters came from the vent; no checkpoint below |
| stays on the gallery at the reveal | hostile start at reveal + 10 … 18 s anyway (a passive player is fought, R1) |
| never goes to the frame | the loader can be killed; the waves wait for their steps; the end needs the cut: objective + Q hint |
| never fights the loader | the tether can be cut; the loader then must die before the quiet (`l6_kes_cut_loader`) |
| leaves the arena mid-fight | the loader guards; the waves follow him into the shaft and vault; nothing resets; he can come back |
| never presses the console | no timer; Kessler asks every 60 s; objective |

---

## 6. Spoken lines (`voice/lines.l6.json`) and readables (`src/story/l6/text.ts`)

### 6.1 Cast and voice fx

| id | name | describe | fx | notes |
|---|---|---|---|---|
| `kessler` | CDR M. KESSLER | as picked in 3c (W9) | `radio` | the same take settings as 3c |
| `reyes` | REYES | existing | `clean` | hoarse: written short |
| `choir` | CHOIR | existing | `radio:1` (on the channel) | two variants per line by the stored choice |
| `soldier` (alias → `choir`) | label from the line | — | `throat` | 3c's alias |
| `unit` | UNIT / label `DOCK LOADER` for the loader's PA | existing | `unit` (panels); `pa` positional for the loader (POS `pa_dock` ref 12 m, the chamber's long reverb) | flat, **no uppercase** |
| `sunde` | DR. A. SUNDE | existing (3b) | `radio` | two lines in E1 |
| **`aas`** (new) | LT. L. AAS | his **base reference is a DESIGNED whisper** (S12): a short describe + `whispering` + a **whispered** refText, auditioned — never a description alone on a normal reference, never `derive` / DSP (the user judged DSP whispers robotic; `voice/cast.json` `_doc`). Audition two describes, **A** `male, young adult, low pitch, whispering` · **B** `male, middle-aged, moderate pitch, whispering`, 4 seeds each, refText written as a whisper: "Hello?... Is somebody there... They've got me walking. I can't... I can't stop my hands." W9 picks provisionally by measurement: **ASR on every seed** (reject any take ASR cannot transcribe — `tomas:whisper`'s short describe failed on 3 of 4 seeds as too faint, `cast.json:54`), then envelope similarity ≤ 0.6 against the **other designed whispers** (`tomas:whisper`, the female whisper at `cast.json:88`) **and** `reyes`, `choir`, `halvorsen`; the user may swap with `voice:cast -- aas --pick N` | **`phone`** (new) | three lines |

**Why a new voice (D18):** the ending says "we needed hands"; through 3b and 3c Aas is only a name on a panel. One living
man on a hard-wired navy phone — unfitted, frightened, being walked, his hand put on plates — turns the cradle in E2 from
a plot fact into a person taken. Three lines, optional, never needed to understand the ending (the OSD carries it).
**Why Sunde speaks:** 3b's debt was paid in 3c by her silent presence; in E1 she is the one person who can read the
manifest's lot numbers, and her two lines open chapter 4's question (who received them) without answering it.

New voice fx (`VoiceFxName`, `FX_NAMES`, W2b): **`phone`** — a sound-powered handset: no electronics, so no squelch and no
hiss bed of the radio; band 350 … 2,600 Hz, a carbon-mic grit (soft clipping 2.4 + a 60 Hz-free granular crackle at
−32 dB), slight level pumping, very low level; positional at the handset (POS `phone` `{ ref: 0.8, rolloff: 1.2, send:
0.1 }` — audible within ≈ 4 m) until picked up, then 2-D close (gain +6 dB) while held. `fxLead('phone') = 0`.

Delivery (D29): Kessler controlled, tired, halting, uppercase stress in **two** places only (`l6_kes_pool_1` none;
`l6_kes_dark` none — it must be quiet; stress only in `l6_kes_he_2` MANUAL and `l6_kes_end_3` EMPTY); CHOIR and the
soldiers calm, never raised; UNIT flat, no uppercase; Reyes low, plain; Aas whispering, broken mid-word where written;
Sunde quiet and exact. Kessler is cut by CHOIR once (`l6_kes_he_3`, `cut` from ASR word times, as 3c `l5_kes_6`); Aas's
last line is cut by the line going dead (`l6_aas_3`, `cut`).

### 6.2 Lines (frozen with this document after review)

Rules (R3): `U` unconditional (a reaction to this instant / a recording); `C(cond)` evaluated when the line starts. "In
view" = clear ray from `player.eye`, within 50° of `player.forward`. CHOIR ≤ 16 words; all ≤ 22 words. `label` = the
subtitle speaker when it differs from the cast name.

**Arrival, tunnels**

| id | speaker | text | spoken (if different) | fx | rule |
|---|---|---|---|---|---|
| `l6_kes_start` | kessler | Tube's cycling. ...It's slow. It was always slow. | Tube's cycling... It's slow. It was always slow. | radio | U (start + 0.6) |
| `l6_unit_tube` | unit | Head-end tube. Cycle complete. | | unit (at `mk6_tube_panel`) | U (the door opens) |
| `l6_kes_start_2` | kessler | Two hundred metres to the head-end. Some of mine will be down there. Take your time with them. | Two hundred metres to the head-end... Some of mine will be down there. Take your time with them. | radio | C: tube latched, once |
| `l6_choir_start_stop` | choir | This is our cable, Technician. Everything down here listens to it. | | radio:1 | C: `stop`, after `_start_2` |
| `l6_choir_start_command` | choir | This is our cable, Supervisor. You never asked what it was for. | | radio:1 | C: `command`, same |
| `l6_kes_contact_a` | kessler | Two of mine. Far end. ...They won't rush you. Don't rush them. | Two of mine. Far end... They won't rush you. Don't rush them. | radio | C: `g6_tun_s` released, both alive, once |
| `l6_kes_tun_done` | kessler | I heard that. ...Who was it? No. Don't tell me. | I heard that... Who was it? No. Don't tell me. | radio | C: `g6_tun_s` dead, calm, once |
| `l6_kes_rep` | kessler | Repeater Two. You're halfway. The next tunnel's in the south wall, east end. | | radio | C: first `t6_rep`, calm, once |
| `l6_kes_contact_rep` | kessler | More coming from the head-end side. Units with them. | | radio | C: F2 spawned, none of it in view, once |
| `l6_kes_tunb` | kessler | He's taken the lights in two. The strips are wired direct. Follow the strips. | He's taken the lights in two... The strips are wired direct. Follow the strips. | radio | C: first `t6_tunb`, once |
| `l6_choir_dark_stop` | choir | We do not need the light, Technician. Do you? | | radio:1 | C: `stop`, `g6_tunb_s` holding + 1.0 |
| `l6_choir_dark_command` | choir | We have worked in the dark since Monday, Supervisor. You never asked. | | radio:1 | C: `command`, same (S10c: no hour count CHOIR would get wrong) |
| `l6_kes_tunb_soldier` | kessler | There's one at the door. He's waiting for you to light yourself up. | | radio | C: `g6_tunb_s` holding, in view ≥ 1 s at > 25 m, lamp off, once |

**Head-end**

| id | speaker | text | spoken | fx | rule |
|---|---|---|---|---|---|
| `l6_kes_he_1` | kessler | That's the head-end. Everything that leaves this place goes through that room. | That's the head-end... Everything that leaves this place goes through that room. | radio | C: first `t6_he`, once |
| `l6_kes_he_2` | kessler | The console's in automatic. In automatic the vault stays locked. Switch it to manual. It gives you a key. | The console's in automatic... In automatic the vault stays locked. Switch it to MANUAL. It gives you a key. | radio | C: not `manual` |
| `l6_kes_he_2b` | kessler | Manual already. Good. Keep that key. | | radio | C: `manual` (cranked during `_1`) |
| `l6_reyes_he` | reyes | A key. | | clean | C: after `_2` (not `_2b`) |
| `l6_kes_he_3` | kessler | Key to key. The navy built it so nobody could cut the trunk by— | Key to key. The navy built it so nobody could cut the trunk by accident. | radio | U; **`cut`** written by W9 from ASR word times (just after "by"); ST stops the handle there (fade 0.03 s) |
| `l6_choir_he_stop` | choir | By accident. Yes, Commander. We have read the manual too. | | radio:1 | C: `stop`, at `_he_3`'s cut |
| `l6_choir_he_command` | choir | By accident. Yes, Commander. The Supervisor always read the manual. | | radio:1 | C: `command`, same |
| `l6_aas_1` | aas | ...Hello? Head-end? Is anybody on this line? | Hello?... Head-end? Is anybody on this line? | phone (positional at `mk6_handset`) | U (`v6_handset`) |
| `l6_aas_2` | aas | This is Lieutenant Aas, Post 4. They've got me walking. They keep putting my hand on things. | This is Lieutenant Oss... Post 4. They've got me walking. They keep putting my hand on things. | phone (held: 2-D) | U (handset picked up) |
| `l6_reyes_aas` | reyes | Where are you? | | clean | U |
| `l6_aas_3` | aas | I don't— the bay. They're taking me down to the bo— | I don't... the bay. They're taking me down to the boat. | phone | U; **`cut`** = `start("boat") + 0.10 s` from the ASR word start, **checked on the waveform** (word ends cannot give a mid-word cut, S12), in FILE time incl. `lead` (3c W9 convention) — the line goes dead |
| `l6_kes_aas` | kessler | ...That was Lars. My XO. He's not fitted. ...I can't reach him. Neither can you. The trunk, Reyes. | That was Lars... My XO. He's not fitted... I can't reach him. Neither can you. The trunk, Reyes. | radio | C: `heard(l6_aas_2)`, + 1.2, once |
| `l6_reyes_queue` | reyes | There's a manifest here. Fourteen batches. Clasps. | | clean | C: `note6_queue` read (closed), calm, once |
| `l6_kes_queue` | kessler | Out of here? ...We never shipped a thing. Not one crate. | Out of here?... We never shipped a thing. Not one crate. | radio | C: after `l6_reyes_queue` |
| `l6_choir_queue_stop` | choir | Fourteen, Technician. We have been very busy. | | radio:1 | C: `stop`, after `l6_kes_queue` |
| `l6_choir_queue_command` | choir | Fourteen, Supervisor. You would have liked the yield. | | radio:1 | C: `command`, same |
| `l6_unit_manual` | unit | Head-end. Manual mode. Interlock key A released. | | unit (at `mk6_switch`) | U (crank done) |
| `l6_kes_manual` | kessler | That's the key. The vault's the west door. The beach joint is on the sea wall. | | radio | C: `manual`, not yet in the vault's enclosure, once |
| `l6_choir_manual_stop` | choir | Manual. How old-fashioned, Technician. | | radio:1 | C: `stop`, after `l6_kes_manual` (or the crank + 1.0 if it was skipped) |
| `l6_choir_manual_command` | choir | Manual, Supervisor. You never did trust us with the switches. | | radio:1 | C: `command`, same |
| `l6_kes_he_contact` | kessler | Movement in the vault. Coming through to you. | | radio | C: F4 spawned, none in view, **player not in vault6**; queued behind `scene` lines, dropped once one is in sight; once |
| `l6_kes_he_contact_b` | kessler | Movement in the cable store. Behind you. | | radio | C: F4 spawned, none in view, player in vault6 (S11c); same queueing; once |

**Vault, shaft**

| id | speaker | text | spoken | fx | rule |
|---|---|---|---|---|---|
| `l6_kes_vault` | kessler | The vault. ...The beach joint's against the sea wall. That's where the cable comes in. | The vault... The beach joint's against the sea wall. That's where the cable comes in. | radio | C: first `t6_vault`, calm, not `pulled`, once |
| `l6_unit_deny_a` | unit | Beach joint. Interlock key A required. | | unit (at `mk6_bj`) | U (lock pressed without Key A; cooldown 10 s) |
| `l6_kes_bj` | kessler | That's the loom. Every fibre to the surface. ...Pull it out. | That's the loom. Every fibre to the surface... Pull it out. | radio | C: enclosure open, not `pulled`, once |
| `l6_unit_pull` | unit | Trunk fibre. Loss of signal. Backup link. Acoustic buoy. | | unit (at `mk6_bj`) | U (pull done) |
| `l6_kes_pull_1` | kessler | That's the fibre. He's on the buoy now. Slower. Not slow enough. | That's the fibre... He's on the buoy now. Slower. Not slow enough. | radio | U (after `l6_unit_pull`) |
| `l6_kes_pull_2` | kessler | The buoy's tether comes up through the moon pool. The stairs are off the vault. Key B. | | radio | C: after `_pull_1`, `d6_shaft` still locked |
| `l6_choir_pull_stop` | choir | That was rude, Technician. We were in the middle of a sentence. | | radio:1 | C: `stop`, after `_pull_2` (or `_pull_1`) |
| `l6_choir_pull_command` | choir | Supervisor. We were in the middle of a sentence. | | radio:1 | C: `command`, same |
| `l6_kes_thud` | kessler | ...What was that? ...That's from my end. That's the bay. | What was that?... That's from my end... That's the bay. | radio | C: `v6_thud` fired ≤ 3 s ago, once (S10e: she knows where, not yet what; E2 pays it off) |
| `l6_unit_deny_b` | unit | Moon pool access. Interlock key B required. | | unit (at `mk6_shaft_lock`) | U (pressed without Key B; cooldown 10 s) |
| `l6_unit_shaft` | unit | Moon pool access. Interlock key B. Accepted. | | unit (at `mk6_shaft_lock`) | U (Key B used) |
| `l6_kes_shaft` | kessler | He's doing it again. ...Stay on the strips. | He's doing it again... Stay on the strips. | radio | C: `v6_shaft_lights` fired 4.4 s ago, once |

**Moon pool**

| id | speaker | text | spoken | fx | rule |
|---|---|---|---|---|---|
| `l6_kes_pool_1` | kessler | That's the moon pool. The buoy's tether comes up the well to the winch. There's a shear on the frame. | That's the moon pool... The buoy's tether comes up the well to the winch. There's a shear on the frame. | radio | C: first `t6_reveal` |
| `l6_kes_pool_2` | kessler | Pin. Pressure. Fire. ...And that's the dock loader. It works on its own. | Pin. Pressure. Fire... And that's the dock loader. It works on its own. | radio | C: after `_pool_1`, the loader in view |
| `l6_kes_pool_2b` | kessler | Pin. Pressure. Fire. ...Watch the dock loader. It works on its own. | Pin. Pressure. Fire... Watch the dock loader. It works on its own. | radio | C: after `_pool_1`, the loader not in view |
| `l6_unit_loader_1` | unit (label DOCK LOADER) | Personnel in the work area. Clear the area. | | pa (at the horn) | U (hostile start); again C: player on the dock, cooldown 25 s, ≤ 4 × |
| `l6_unit_loader_2` | unit (DOCK LOADER) | Load moving. Stand clear. | | pa | U (a SHIFT / DROP starts; cooldown 20 s) |
| `l6_unit_loader_3` | unit (DOCK LOADER) | Control fault. Cooling. | | pa | U (the cowl opens) |
| `l6_choir_pool_stop` | choir | We wondered when you would come down, Technician. | | radio:1 | C: `stop`, hostile start + 0.4 |
| `l6_choir_pool_command` | choir | We wondered when you would come down, Supervisor. We kept the lights on. | | radio:1 | C: `command`, same |
| `l6_kes_boss_1` | kessler | It drops that grab where its lights are. Keep moving. | | radio | C: stage 1, after `_choir_pool`, once |
| `l6_kes_boss_ram` | kessler | The rams on the grab. When it's down, they open. Hit those. | | radio | C: a slam recovery in view (rams extended), no ram destroyed yet, once |
| `l6_kes_boss_flood` | kessler | Its lights tell mine where you are. Put them out. | | radio | C: player flood-lit ≥ 2 s with an aware soldier, a flood alive, once |
| `l6_kes_boss_frame` | kessler | It won't drop on the frame. It's protecting the tether. ...They aren't. | It won't drop on the frame. It's protecting the tether... They aren't. | radio | C: first feet in `t6_cage` with a soldier alive, once |
| `l6_kes_pin` | kessler | Pin's out. Now the pump. Keep at it. | | radio | C: pin out |
| `l6_choir_pin_stop` | choir | We can hear you working, Technician. | | radio:1 | C: `stop`, pin out + 2.0, no Kessler line playing, once |
| `l6_choir_pin_command` | choir | We can hear you working, Supervisor. You were always good with your hands. | | radio:1 | C: `command`, same |
| `l6_kes_pump_half` | kessler | Halfway. Keep pumping. | | radio | C: pressure ≥ 50 %, once |
| `l6_choir_pump_stop` | choir | The surface is two kilometres up, Technician. They never call. | | radio:1 | C: `stop`, after `_pump_half`, once |
| `l6_choir_pump_command` | choir | The surface never calls, Supervisor. We stopped waiting for it. | | radio:1 | C: `command`, same |
| `l6_kes_pump_done` | kessler | That's pressure. The red lever. | | radio | C: pressure full, not `trunkCut` |
| `l6_unit_shear_pin` | unit | Tether shear. Safety pin in. | | unit (at the shear) | U (pump or lever pressed before the pin; cooldown 6 s) |
| `l6_unit_shear_low` | unit | Tether shear. Pressure low. | | unit (at the shear) | U (lever pressed before full pressure; cooldown 6 s) |
| `l6_kes_boss_pod` | kessler | The box under the trolley. It's open. Now. | | radio | C: both rams gone, pod alive, once |
| `l6_kes_loader_dead` | kessler | It's down. ...The frame, Reyes. Finish it. | It's down... The frame, Reyes. Finish it. | radio | C: loader dead, not `trunkCut`, once |
| `l6_choir_loader_stop` | choir | That was a good machine, Technician. It never asked for anything. | | radio:1 | C: `stop`, loader dead + 0.6 (after any Kessler line) |
| `l6_choir_loader_command` | choir | That was a good machine, Supervisor. It did as it was told. | | radio:1 | C: `command`, same |
| `l6_kes_dark` | kessler | That's it. He's down here with us and nowhere else. | That's it... He's down here with us. And nowhere else. | radio | U (the cut + 1.2) |
| `l6_kes_cut_loader` | kessler | Now that thing. Then we're done. | | radio | C: `trunkCut`, loader alive, after `_dark` |
| `l6_kes_console` | kessler | Reyes. The dock console. ...I want to see the last thing it sent. | Reyes... The dock console. I want to see the last thing it sent. | radio | C: `l6_quiet` + 3.0 |
| `l6_kes_console_2` | kessler | The console, Reyes. Please. | | radio | C: ending pending, 60 s since the last ask, calm; cooldown 60 s |

**Ending (E1, E2 — scene lines on the scene clock, §4.9)**

| id | speaker | text | spoken | fx | rule |
|---|---|---|---|---|---|
| `l6_kes_end_1` | kessler | ...Thirteen batches. Since last spring. And the fourteenth is down my well. | Thirteen batches... Since last spring. And the fourteenth is down my well. | radio | C: E1, not `manifest` |
| `l6_kes_end_1b` | kessler | That list you found. ...Thirteen went. You watched the last one go down. | That list you found... Thirteen went. You watched the last one go down. | radio | C: E1, `manifest` |
| `l6_sunde_end_1` | sunde | Those are Clasps. That's my lot numbering. | Those are Clasps... That's my lot numbering. | radio | U (E1) |
| `l6_sunde_end_2` | sunde | Three thousand of them. I thought they were for the trials. | Three thousand of them... I thought they were for the trials. | radio | U (E1) |
| `l6_reyes_end` | reyes | Where did they go? | | clean | U (E1) |
| `l6_kes_end_2` | kessler | There's no consignee. ...There's always a consignee. | There's no consignee... There's always a consignee. | radio | U (E1) |
| `l6_kes_end_3` | kessler | No... That's my bay. That's— the cradle's empty. | No... That's my bay. That's... the cradle's EMPTY. | radio | U (E2 + 1.6) |
| `l6_kes_end_4` | kessler | ...Lars. | Lars... | radio | C: `heard(l6_aas_2)` (E2) |
| `l6_kes_end_4b` | kessler | ...That's my XO's palm. | That's... my XO's palm. | radio | C: not `heard(l6_aas_2)` (E2; S11a — the name lands on a person for a player who skipped every optional beat) |
| `l6_choir_last_stop` | choir | We did not need the trunk, Technician. We needed hands. | | radio:1 | C: `stop` (E2) |
| `l6_choir_last_command` | choir | We did not need the trunk, Supervisor. We needed hands. | | radio:1 | C: `command` (E2) |

**Kessler on Q** (from the start; cooldown 5 s; ignored while a note or a grip is open). In pool6 and shaft6 Q always
answers with the boss hint (never `busy`), elsewhere `l6_kes_busy` while a hostile is awake within 25 m:

| id | text | rule |
|---|---|---|
| `l6_kes_ack` | Kessler. | U (Q, before the context line) |
| `l6_kes_busy` | Not now. Fight. | C: Q, hostile awake within 25 m, not in pool6 / shaft6 |
| `l6_kes_hint_he` | The head-end. Keep on down the tunnel. | C: Q, not in he6 / vault6, not `manual` |
| `l6_kes_hint_switch` | The changeover switch. East wall of the head-end. | C: Q, in he6 / vault6 / trench, not `manual` |
| `l6_kes_hint_bj` | The beach joint. South wall of the vault. Key A. | C: Q, `manual`, not `pulled` |
| `l6_kes_hint_shaft` | The stair door. West wall of the vault. Key B. | C: Q, `pulled`, shaft locked |
| `l6_kes_hint_frame` | The frame over the well. Pin. Pressure. Fire. | C: Q, phase K, not `trunkCut` |
| `l6_kes_hint_loader` | The loader. The rams on the grab, then the box under the trolley. | C: Q, `trunkCut`, loader alive |
| `l6_kes_hint_console` | The dock console. Mid deck. | C: Q, ending pending |

**Soldiers (CHOIR through `throat`)** — the six 3c bark pairs are reused by id (`l5_sol_down_*`, `_need_*`, `_felt_*`,
`_rounds_*`, `_light_*`; K adds `lines.l5.json`'s `l5_sol_` entries to level 6's line DB; rules copied into RULES6 with
3c's bark gate: one soldier line per 20 s, never over a Kessler `scene` line, speaker alive with sight, ≤ 15 m (≤ 25 m
for `_light`), each id ≤ 2 × per level) plus:

| id | label | text | rule |
|---|---|---|---|
| `l6_sol_frame_stop` / `_command` | SOLDIER | Step away from the frame, Technician. / … Supervisor. | C: choice, player in `t6_cage`, speaker has sight ≤ 30 m, bark gate |
| `l6_sol_reach_stop` / `_command` | SOLDIER | You cannot cut what you cannot reach, Technician. / … Supervisor. | C: choice, phase K, pin not out, speaker has sight at ≥ 15 m, bark gate |
| `l6_sol_lost_stop` / `_command` | SOLDIER | We know where you went, Technician. / … Supervisor. | C: choice, the speaker lost sight ≥ 3 s with a last-known position, bark gate |

Counts: Kessler 54 (incl. 9 Q lines; + `_he_contact_b`, `_end_4b` after review), Reyes 4, Aas 3, Sunde 2, CHOIR 22
(11 pairs), UNIT 11 (incl. the loader's 3), soldiers 6 (3 new pairs; + 12 reused from 3c) → **102 new lines**. "Aas" spoken nowhere except `l6_aas_2` ("Oss").
Choice pairs complete: `l6_choir_start`, `_dark`, `_he`, `_queue`, `_manual`, `_pull`, `_pool`, `_pin`, `_pump`,
`_loader`, `_last`; `l6_sol_frame`, `_reach`, `_lost`.

### 6.3 Readables (≤ 30 words; each stands alone)

| id | kind / prompt | where | header | body |
|---|---|---|---|---|
| `note6_jobcard` | card / Read card | rep6 tent pole (13.6, 1.4, −83.15), use point (13.6, 1.4, −82.7) | `JOB CARD — SPARE TRUNK JOINT — REPEATER 2` | `J. RØD (HALCYON SUBSEA) — MON 07:30. STATUS: IN PROGRESS. Drum stand brakes OFF for pay-out (vault, CD2). Back by 09:00.` |
| `note6_queue` | screen / Read queue | he6 console (9.0, 1.25, −179.0) | `HEAD-END — OUTBOUND QUEUE` | `QUEUED: MANIFEST 0031-H / B-14. CLASP ASSY (CERVICAL) × 240. DISPATCH: MOON POOL → SUBSEA SHUTTLE. SENT: B-01 … B-13. CONSIGNEE: —` |
| `note6_jointer` | notebook / Read notebook | trench (−12.85, −0.9, −176.4), use point (−12.4, −0.9, −176.4) | `NOTEBOOK — M. LIE, HALCYON SUBSEA` | `Mon. Fibre's live, no outage window. Navy says the buoy takes everything if the fibre drops. Slow, but it carries. Told them: then cut the tether too.` |
| `note6_transfer` | log / Read log | undercroft panel (−48.0, −18.5, −148.25), use point (−48.0, −18.5, −148.7) | `TRANSFER LOG — DOCK LOADER DL-2` | `B-14 CYCLE START {reveal hh:mm}. LOADING WELL. CARGO LOCK: AWAITING SEALED CYCLE. DEWATERING 34 % — STOPPED. HOLD: CHOIR. PERSONNEL: NONE (UNMANNED CYCLE).` (S10a: one version of B-14 everywhere) |

Both bodies on the route (Rød in the tent, Lie in the trench) are **Halcyon Subsea contractors** in orange coveralls —
not on the navy roster (3c's catering-contractor rule: the 23 / 19 / 4 canon is untouched).

### 6.4 Screens, toasts, objectives (`CLOCK6`: arrival hour = `facts.testHour ?? 62.75`; day/time derived as 3b)

| screen | kind | text / states |
|---|---|---|
| `tube_panel6` | `terminal_idle` | `HEAD-END TUBE — CYCLING` → `OPEN` → `CLOSED` |
| `mimic6` (he6 south wall) | `mimic` (new) | the trunk drawn `HEAD-END — VAULT (BEACH JOINT) — SURFACE 2.1 KM` green; branch `MOON POOL — TETHER — ACOUSTIC BUOY: STANDBY`; `MODE: AUTO` → `MANUAL — PROTECTION OFF` → (pull) fibre red `LOS`, buoy branch green `ACTIVE` → (cut) all red `LOS` |
| `queue6` | `manifest` (new) | the queue (§6.3) |
| `switch6` | `terminal_idle` | `HEAD-END MODE: AUTO` → `MANUAL — KEY A OUT` |
| `bj6` | `interlock` (new) | `BEACH JOINT — INTERLOCK KEY A` → `KEY A IN — OPEN` → `FIBRE — LOS` |
| `shaft6_panel` | `interlock` | `MOON POOL ACCESS — INTERLOCK KEY B` → `KEY B IN — OPEN` |
| `dock_board` | `dock_board` (new; 12 × 3 m) | `MOON POOL — DOCK — 2,140 M` / `TRANSFER B-14: LOWERING` → `IN WELL — AWAITING LOCK CYCLE` / `CARGO LOCK: INNER DOOR CLOSED` / `DEWATERING: 34 % — STOPPED` / `TETHER: TAUT — BUOY: STANDBY` → `LINK ACTIVE` → `LOS` / `LOADER DL-2: WORKING` → `HAZARD — PERSONNEL ON DOCK` → `CONTROL FAULT` → `OFFLINE` |
| `gauge6` | `gauge` (new) | `PIN IN` → `0 BAR — PUMP` → `n BAR` (live) → `210 BAR — READY` → `FIRED` / `PRESSURE LOW` (1.2 s) |
| `console6` | `manifest` + `feed` | `HEAD-END REPEATER — DOCK` (idle: the dock board's lines); E1: `TRUNK: LOS · BUOY: LOS` / `LAST OUTBOUND (BUFFERED): 1 ITEM` then the manifest scroll: `MANIFEST 0031-H — DISPATCH VIA MOON POOL — SUBSEA SHUTTLE` / `B-01  14 APR  CLASP ASSY (CERVICAL) × 120` / `B-02  12 MAY  × 120` / `B-03 … B-13` (× 240, roughly monthly to 02 MAR) / `B-14  WED {reveal hh:mm}  × 240  — IN WELL` / `TOTAL: CLASP ASSY (CERVICAL) — DISPATCHED 2,880 · IN TRANSFER 240` / `CONSIGNEE: —`; E2: the feed with the OSD `POST 4 — SUB BAY — CAM 2 — {hh:mm:ss}`, `SDV TERN — LAUNCHED {launchAt hh:mm}`, `LAUNCH AUTHORITY: AAS, L. (LT.) — PALM — LIVE` |
| `feed6_board` (in the feed set) | `dock_status` (3c) | `TERN — CRADLE — EMPTY` / `LAUNCH LOCK — FLOODED` |

Toasts: `Key A — head-end mode`, `Key B — moon pool`, `Hold E` (first grip), `Too deep to crouch`, `Crouch — C`, `Armour
vest`, `Armour plate`, `Hatch dogged from below`. Objectives: `The head-end — 200 m` (A … until he6), `The changeover
switch — east wall` (he6, not manual), `The beach joint — vault, south wall` (manual), `The stair door — vault, west wall`
(pulled), `The moon pool — down the stairs` (shaft open), `Cut the tether — the frame over the well` (hostile start, not
cut), `Destroy the loader` (cut, loader alive), `The dock console — mid deck` (quiet).

---

## 7. Checkpoints, carry, direct start, the chapter end

**A restore replays every flag's world consequence, whatever checkpoint it is** (B4): the checkpoint id only says when a
save was written and where the player stands; `afterReplay` rebuilds the world from the flags in this order — `tubeOpen` /
`tubeLatched` (phase), `bayLive`, `manual` (the switch at MANUAL, mimic), `bjOpen` (`bj6_open:snap`, the loom enabled),
`pulled` (`bj6_rip:snap`, ping 4 s, screens), `shaftOpen` (phase K, **the loader spawned** in `working` — D31),
`lights6` (`v6_shaft_lights:snap`), `reveal` (B-14 in the well), `hostile` (`boss.restore`), `lights_out6`, `pin`,
`pressure`, `trunkCut`, `loaderDead` (`removeSilently`, `loader_dead6:snap`), `quiet`; keys come from `PlayerSave.keys`.

| id | saved when | valid while | restore (beyond the flag replay) |
|---|---|---|---|
| `cp6_start` | A → T (tube open) | not `tubeLatched` | at `mk6_start` |
| `cp6_tunnel` | F1 dead (or cancelled) + 1.5 s, calm | not `bayLive` | `g6_tun_*` cleared; `tun6_far_out` silently |
| `cp6_rep` | F2 dead + 1.5 s, calm | not in he6 yet | `g6_rep_*` cleared; the vent open (snap) |
| `cp6_he` | first in he6, no awake hostile within 30 m | not `manual` | `g6_tunb_*` cleared (dead or removed by the stray rule); he6 lines resume from the first not heard |
| `cp6_manual` | F4 dead + 1.5 s, calm | **not `bjOpen` and not `pulled`** (a later save wins — B4) | Key A in keys; `g6_he` cleared; handset / queue as saved |
| `cp6_pulled` | F5 dead + 1.5 s, calm, not in the trench | not `shaftOpen` | Key B in keys (Key A trapped); `launchAt` as saved (or pending: pull + 90 s on the game clock); `g6_vault*` cleared |
| `cp6_shaft` | the shaft bottom, calm (§4.7) | not `reveal` | the loader present in `working`, B-14 held (spawned by the `shaftOpen` replay); `g6_shaft` cleared |
| `cp6_m1` … `cp6_m5` | the n-th boss milestone + 1.0 s, `checkpointNow` (D21) | — | §5.6.9 (restore point by the latest wave, health ≥ 60, reserve ≥ 90, lockers re-armed) |
| `cp6_quiet` | `l6_quiet` (§4.8) | — | every wave absent; the cut tether and the viewport's cut cable (snap); `console6` enabled; objective `The dock console — mid deck` |

No checkpoint during a grip (a boss milestone's is deferred to its end), the tube latch, the trench, the handset call, or
the cutscene. `ProgressL6` = 3c's `ProgressL5` shape (`ProgressL3` + `scares: string[]`, as merged) plus `boss: BossState
| null`, `waves: { w1, w2, w3: 'pending' | 'alive' | 'dead' | null; latest: 'w1' | 'w2' | 'w3' | null }`, `launchAt: number
| null`, `lockers: Record<'e' | 'w' | 'n', boolean>` (taken since the last milestone); flags `tubeOpen`, `tubeLatched`,
`crossing`, `f1Free`, `f1Cancelled`, `bayLive`, `f3Free`, `manual`, `queue`, `handset`, `aas`, **`bjOpen`**, `pulled`,
`thud`, `shaftOpen`, `lights6`, `reveal`, `hostile`, `lights_out6`, `pin`, `pressure`, `trunkCut`, `ramE`, `ramW`,
`loaderDead`, `quiet`, `ending`.

### 7.1 Boss restore mechanics (the 3c B1 class, designed out)

The stage base removes every group in `prog.triggered ∪ prog.cleared` on a load (`base.ts:777-799`; a load is a fresh page,
`page.ts:112-128`; `spawnGroup` takes a pending spawn once per page, `manager.ts:288-300`). Therefore:
- `g6_loader` is spawned with `spawnGroup` when Key B turns (D31), woken only through `enemies.boss('g6_loader').wake()`
  (never `engage`) and **never enters `triggered`**; the level-6 `calm()` override counts the loader explicitly (alive and
  past `working` = not calm) and ignores holding soldiers via `EnemyManager.holding(group)` (merged 3c K — S2f).
  `afterReplay`: `shaftOpen` → spawn it; then `loaderDead` → `boss.removeSilently()`; else `hostile` →
  `boss.restore(prog.boss)`; else it stays `working`. Its death puts `g6_loader` into `prog.cleared` — harmless, because
  every later load has `loaderDead` and removes it silently before anything else (S2e).
- **Boss waves** W1–W3 are spawned with `spawnGroup` (never `engage`) and **never enter `triggered`**; their state lives in
  `prog.waves`. On a boss checkpoint load (a fresh page), `afterReplay` handles **only the latest wave** (S2a): `alive` at
  the save → its twin `g6_wN_r` after the 3 s grace (W1's with phase K_stores and its latch re-applied, S2b); `pending` →
  re-queued under its own rule (W3 still waits for ≤ 3 non-loader hostiles); `dead` → nothing. A twin never appears in a
  save written before it existed, so it is never in that save's `cleared` list; a second death before the next milestone
  restores the same save on a fresh page and the twin spawns again. Earlier waves never come back — a restore stays inside
  the cap of 6.
- Keys are in `PlayerSave.keys` (player-owned, restored by `player.restore`); a trapped key is removed (`removeKey`) inside
  the same action that sets its flag (`bjOpen`, `shaftOpen`), so no save can hold a used key or miss a released one.
- Ammunition (B5): every boss restore tops the carbine reserve to ≥ 90 (the best owned weapon if no carbine) through
  `player.give` and resets `prog.lockers` (the three dock lockers are story interactables, not `PickupSpawn`s, so
  `PlayerSave.pickups` never removes them).
- `--checkpoints` (§10.1) kills the player at every milestone with every wave state and compares H13 `worldState()`.

### 7.2 Carry, direct start, end

Carry in (`CarryV2` from 5): weapons, health (floor 50), armour, flashlight (the cell starts full in a new level), facts
(`choice`, `unitsLeft`, `radio`, `kessler`, `l5_door`, `l5_boat`, `kills5`, `testHour`, …). Direct start
`?level=6[&autostart=1][&choice=stop|command][&units=N][&continue=1]`: `DirectLoadout` pistol `{ clip 12, reserve 24 }`,
shotgun `{ 6, 6 }`, **carbine `{ 30, 90 }`** — which land as **12 / 36, 6 / 12, 30 / 120** through the pickup path
(`give(weapon, clip)` then `give(ammo, reserve)`, 3c K note) — health 100, **armour 50**, flashlight on; facts `choice 'stop'`, `unitsLeft 28`, `badge true`, `halvorsenAlive true`,
`radio true`, `kessler true`, `l5_door true`, `l5_boat false`, `kills5 0`, `testHour 62.75`. `?level=7`+ clamps to 6
(`parseLevel` already caps at 6). **End (`l6_end`)**: fade, write the carry (`from: 6`; facts + `kills6`, `manifest`,
`aas`, `launchHour`, `trunkCut`, `loaderDead`, `testHour`; weapons; armour — kept stored for a future chapter, nothing
reads it yet), clear the level-6 checkpoint, card `THE TRUNK` / `TO BE CONTINUED` (14 s, skippable once seen, style
`ending`), card `END OF CHAPTER 3` (4 s, style `title`; one text everywhere), then the menu; stored level 6; menu line
`Chapter 3  —  The Trunk`; CONTINUE on a stored 6 without a checkpoint starts level 6 from its start (as 3c).

---

## 8. Systems (each an independent task; owners in §11)

### 8.1 Level 6 in the chain + contract (task K)

```ts
// core/progress.ts
5: { ...as 3c built, next: null },   // stays null on main; IA sets 6 (D2)
6: { id: 6, tag: 'l6', built: true, title: 'THE TRUNK', place: 'The Trunk', bootStatus: 'the trunk',
     screenHeader: 'NAVAL DETACHMENT // ERIDU DEEP — TRUNK HEAD-END', camLabel: 'DOCK', idleText: true, powerOnAtLoad: true,
     keycardName: 'INTERLOCK KEY', endEyebrow: 'End of Chapter 3', menuLine: 'Chapter 3  —  The Trunk', subtitles: 'stacked',
     cast: { foreman: false, human: false, tomasHead: false, soldier: false },   // cast.soldier is required since 3c's K (S8b)
     direct: { facts: { choice: 'stop', unitsLeft: 28, badge: true, halvorsenAlive: true, radio: true, kessler: true,
                        l5_door: true, l5_boat: false, kills5: 0, testHour: 62.75 },
               loadout: { weapons: { pistol: { clip: 12, reserve: 24 }, shotgun: { clip: 6, reserve: 6 }, carbine: { clip: 30, reserve: 90 } },
                          health: 100, flashlight: true, armor: 50 } },     // lands as 12/36, 6/12, 30/120 (3c K note)
     healthFloor: 50, next: null },
// core/types.ts — all required, stubs where a module has nothing yet (D27)
export type EnemyType = … | 'soldier' | 'loader';
export type Surface = … | 'water';                            // splash, wade footsteps; no decal (physics SURFACES += 'water')
export interface WaterVolume { id: string; room: string; box: THREE.Box3; surface: number; /** max standable depth */ stand: number }
Level.water: readonly WaterVolume[];                          // levels 1–5: []
export interface CargoSlot { id: string; box: THREE.Box3; floorY: number; container: string | null; cover: string[] }
export interface CargoHandle { readonly id: string; readonly object: THREE.Object3D; readonly box: DynamicBox }   // box: walkable false (B2)
export interface DockArena {
  readonly slots: readonly CargoSlot[];
  lift(slot: string): CargoHandle | null;                     // detach a container (its cover points disabled)
  place(h: CargoHandle, slot: string): void;                  // set down (cover enabled; slot occupied)
  drop(h: CargoHandle, slot: string, from: number): void;     // free-fall into a slot from a height
  /** A legal slam / set-down / swing target: deck kind, depth ≤ 0.7, not under the mid deck / cage / a gallery, not a stair
   *  ± 1.5 m, outside the no-slam margin, the grab box at its lowest (or the swing arc) clear of every collider but the deck
   *  (S6b). `lane` given = a SWING lane from p to lane. */
  target(p: THREE.Vector3, lane?: THREE.Vector3): boolean;
  readonly noSlam: THREE.Box3; readonly park: THREE.Vector3;  // park = (−52, −8, −186)
  readonly rails: { xMin: number; xMax: number; zMin: number; zMax: number; railY: number };
}
Level.dock: DockArena | null;                                 // levels 1–5: null
CoverPoint.enabled: boolean;                                  // mutable; levels 1–5 data: true (3c's CoverPoint gains it)
Interactable.requireRegion?: string;                          // data (like `radius?`): usable only with the feet in this region;
                                                              // the registry's pick and check:reach honour it (S8g)
export interface GripOpts { id: string; point: THREE.Vector3; normal: THREE.Vector3; seconds: number; start?: number;
                            hold: boolean; maxDist?: number; motion: 'crank' | 'pull' | 'pump' | 'lever' | 'pin' }
export interface GripHandle { readonly progress: number; readonly holding: boolean; readonly done: Promise<'done' | 'cancelled'>; cancel(): void }
Player.grip(o: GripOpts): GripHandle;                         // K stub: resolves 'done' after `seconds`
Player.readonly gripProgress: number;                         // −1 when none (HUD meter)
Player.removeKey(key: string): void;
Player.readonly wading: number;                               // water depth at the feet, 0 dry
GameEvents['player:rescued']: { from: THREE.Vector3; to: THREE.Vector3 };   // the deep-water fail-safe (D12; never a death)
export interface BossState { stage: 0 | 1 | 2 | 3; parts: Record<string, number>; slots: (string | null)[]; carried: string | null; dead: boolean }
export interface BossControl {
  readonly id: number; readonly stage: number; readonly dead: boolean;
  cue(name: 'lower'): void;                                   // working-state cue: lower the held cargo into the well
  wake(): void;                                               // working → stage 1; idempotent
  setStage(s: 1 | 2 | 3): void;                               // the objective stage (the loader uses max(objective, damage))
  partHp(part: string): number;                               // flood_1..4, ram_e, ram_w, pod
  floodLit(p: THREE.Vector3): boolean;                        // D20: inside a live flood's cone AND that flood's light in the pool (S13)
  snapshot(): BossState; restore(s: BossState): void; removeSilently(): void;
}
EnemyManager.boss(group: string): BossControl | null;         // stub: null
/** S8a: a soldier walks a path (weapon light as given) and ends in `hold` (state 'idle', counted by holding()). A real
 *  enemy the whole way (R2). Released as any holding soldier. Stub: teleports to the last point and holds. */
EnemyManager.patrol(group: string, points: THREE.Vector3[], o: { speed?: number; light?: boolean; end: 'hold' }): void;
GameEvents['boss:stage']: { group: string; stage: number };   // music / UI
export type VoiceFxName = … | 'phone';
export type ScreenKind = … | 'mimic' | 'manifest' | 'interlock' | 'dock_board' | 'gauge';
export type TrunkMaterialName = 'tunnel_shotcrete' | 'cable_armour' | 'dock_steel' | 'crane_yellow' | 'rope_wire'
  | 'container_navy' | 'container_orange' | 'coverall_orange';          // kept out of the exhaustive record until W5 (3b pattern)
// physics (src/physics — coordinator's, K): TWO collider sets (S5)
//   rays  = solid ∪ rayOnly   → raycast, lineOfSight        (water surfaces stop rounds and sight)
//   moves = solid ∪ moveOnly  → moveBody, resolveSphere      (rails / bars / mesh guards / tarp stop bodies)
mesh.userData.rayOnly = true;    // water surfaces
mesh.userData.moveOnly = true;   // rails, bar and mesh guards, the tent's tarp
Physics.raycastSolid(origin, dir, max?): RayHit | null;       // moves set + enabled dynamic boxes: every GROUND / HEADROOM query
Physics.setKillY(y: number): void;                            // the kill-plane (today hard-coded −30, physics.ts:217); level 6: −36 (B6)
// story/save.ts
export const CHECKPOINT_IDS_L6 = ['cp6_start', 'cp6_tunnel', 'cp6_rep', 'cp6_he', 'cp6_manual', 'cp6_pulled', 'cp6_shaft',
  'cp6_m1', 'cp6_m2', 'cp6_m3', 'cp6_m4', 'cp6_m5', 'cp6_quiet'] as const;
export const STORY_REV_L6 = 1; export const SPEC_L6: SaveSpec = { level: 6, rev: STORY_REV_L6, ids: CHECKPOINT_IDS_L6 };
export type ProgressL6 = ProgressL5 & { boss; waves; launchAt; lockers };   // §7; emptyProgressL6()
```

**Who switches which ground / headroom query to `raycastSolid`** (S5; each in its owner's file): `enemies/nav.ts`
`walkable(…, ground)` shortcut test and `enemies/ai.ts` `groundAt` — W3c; `story/stage/base.ts` `groundY` (`base.ts:605`)
— **K** (one call, stage base); `fx/index.ts` floor planes (`:157`) — W6; player footsteps (`player/index.ts:177`) and
`Controller.canStand`'s up-ray — W1. The level's own builders and checks — W4a / W4b. The kill height is set by the
level at build (`level.killY`, read by main.ts → `physics.setKillY`; levels 1–5 keep −30).

**The 3c interfaces** — merged ones used as they are (header table); assumed ones (soldier AI, `lit`, cover choice, the
greybox conventions for floors below the main floor, hatches, `scareOk` / the scare kit, the stage-base calm / stray /
`afterReplay` pattern, Q handling, `mustNotUse`) K verifies against merged code before wave 1 (§11 rule 7), and records
the result in `docs/plans/stage-3d-k-notes.md`.
Level-5 end (`story/l5`, 3c ST): `nextOf(5) === null` → today's card + menu; `=== 6` → `POST 4` alone, 6 s skippable,
then `goToLevel()` (3c K note: the card logic is ST 3c's; 3d's K only checks it through `?next=5:6`). Dispatch:
`LEVEL_BUILDERS[6]` → stub (one lit 8 × 8 room), `STORIES[6]` → stub on `createStagePage`, `SHOTS[6]` eye (0, 1.7, −2) →
look (0, 1.5, −10). Placeholders (`// K placeholder`): the enemies factory map gets `loader` = a sentry with a warning;
`enemies.boss` null; `enemies.patrol` = teleport + hold; `FX_NAMES` gains `phone` (renders as `headset`); `ui` grip meter
no-op; `Level.water = []`, `Level.dock = null` in levels 1–5 and the stub; `CoverPoint.enabled = true` in level 5's data;
`screens.ts` placeholders for the five new kinds; `TrunkMaterialName` kept out of the exhaustive record.
`scripts/lib/check-common.mjs` `levelsOf('all')` → [1 … 6]. Tests (`check-chain.mjs`): L5 end → L6 via
`?next=5:6&handoff=1` for both choices keeps weapons, health, armour (37 → 37; 900 → 100; NaN → 0), the lamp on/off (the
cell is not carried — it starts full), facts incl. `radio` and `testHour`; without the override the L5 end is today's;
`?level=6` loadout (12/36, 6/12, 30/120, armour 50) + facts; `?level=7` → 6; stored 6 + CONTINUE (with/without
checkpoint) + BEGIN; the L6 end writes the carry (`from: 6`), stored level 6, the two cards and the menu; a level-5
checkpoint written before K restores; the level grep stays clean. **`scripts/check-physics.mjs`** (K): a ray through a
`rayOnly` quad stops at it, a capsule walks through it; a capsule stops at a `moveOnly` box, a ray passes it; a
`raycastSolid` down-ray over water hits the floor under it; `canStand` under a move-only bar is false; a body at y −34
is not teleported with `setKillY(−36)` and is below −36; a nav shortcut over the wet dock never ends in the channel (with
W3c's nav once merged).

### 8.2 The dock loader (W3a body + rig, W3b behaviour)

Everything in §5.6. Files: W3a `src/enemies/loader/{model,rig}.ts`, `src/enemies/dev/loader.{html,ts}` (rig + poses
+ marks + death in motion); W3b `src/enemies/loader/{loader,tuning,stubrig}.ts`, registration + pre-warm (the template
is warmed whenever the level's `enemySpawns` hold a `loader`), `EnemyManager.boss()`, `boss:stage`, `enemies.debug.loader()`
(`{ stage, mode, parts, floods, target, ring, grab: [x,y,z], jaws, rams: 'extended' | 'retracted', carried, slots,
lastAttack: { kind, telegraphStart, lockStart, impact } }`), the D20 hook the soldier reads, `scripts/check-loader.mjs`
(§5.6.10). Sounds the loader plays (enemies-owned, W2b builds them): `loader_hum` (loop, positional at the trolley),
`loader_travel` (bridge / trolley drives), `loader_track`, `loader_jaws`, `loader_brake`, `loader_impact`,
`loader_squeal`, `loader_hoist`, `flood_pop`, `ram_hit`, `ram_burst`, `cowl_open`, `loader_death`, `rope_whip`; the PA
lines are the story's (`l6_unit_loader_*` through `say` at the horn's position).
The `working` state is the enemy's own behaviour (the machine at work): from load it holds B-14 over the well, the grab
swaying slightly, floods sweeping its work area; the story calls `boss.cue('lower')` at the reveal (the grab lowers B-14
into the well — water at +1.5 s, gone by +6.0 — and rises empty, then patrols the dock slowly) and `boss.wake()` at the
hostile start. `cue` is part of `BossControl` (`cue(name: 'lower'): void`, no-op once awake).

### 8.3 Player: wading, grip, the deep-water rescue (task W1)

- **Wading** (D13): per frame the depth at the feet from `level.water` (feet x/z inside a box, y below its surface);
  speed caps through `MoveInput.maxSpeed` and the sprint / jump / crouch gates; crouch refused at d ≥ 0.7 (toast `Too
  deep to crouch`); footsteps `wade_shallow` (0.1 … 0.35) / `wade` (≥ 0.35) on `player:footstep` with surface `water`
  (the footstep ground ray uses `raycastSolid`, so it finds the floor under the water — S5); wake rings via `fx.wake(p, r)`
  every 0.35 s while moving in water ≥ 0.1; a slow sway of the view (0.6°) in waist water. `player.wading` exposes d.
  `Controller.canStand`'s up-ray uses `raycastSolid` (a move-only bar overhead stops him standing into it).
- **Deep-water rescue** (D12, coordinator 2; never reachable by design, `check:reach`): in water deeper than its volume's
  `stand`, the vertical speed is clamped to −0.5 m/s (he is held, not falling to the kill-plane); after 1.0 s under
  (screen tints, `audio.setMuffle(0.9)`, bubbles) the screen goes black 0.5 s and he is placed at the nearest ladder exit
  (`mk6_lw_exit` / `mk6_le_exit`) or `mk6_boss_safe`, −15 health (never below 1), toast `You pulled yourself out`,
  `player:rescued` emitted and a `console.error('[player] deep-water rescue', pos)` for the test logs. No death, no
  checkpoint lost. Reachable for the fail-safe because the level's kill height is −36 (B6).
- **Rays stop at water**: the weapons' hitscan and the enemy hitscan go through `physics.raycast` → the `rayOnly` water
  quads (K) stop them; the weapon module plays `fx.splash` + `impact_water` for surface `water` and places no decal.
- **Grip** (D7): `player.grip(o)` on the palm machinery (`player/palm.ts`): starts only alive, in control, `playing`,
  within `maxDist` (default 1.3 m, horizontal) on the front side of `normal`; weapon lowered (reload cancelled); both hands
  IK-posed to `point` with the `motion` clip (crank: a two-handed circle, 0.6 s per turn; pull: a braced two-handed draw
  with the body leaning back; pump: a lever stroke every 0.7 s; lever: one heavy pull; pin: a twist-and-draw);
  **progress advances only while E is held** (`hold: true`; the player module reads E during a grip and consumes it so it
  never re-triggers `interact`) or runs once started (`hold: false`); feet planted while E is held, free when released
  (released = paused; progress kept when `start` is used by the caller); look damped to 40 % while held, the view eased
  toward `point` over 0.4 s; a hit pauses advancing for 0.3 s (flinch) and **never cancels**; dying, a pause, a note,
  cinematic, a teleport or `cancel()` → 'cancelled'; walking beyond `maxDist` pauses (hold) / cancels (press). A grip
  start while the handset is held drops it first (the story's `phone6.drop()`, S11d). HUD meter via `gripProgress` (W2a
  draws it). Not persisted. Debug: `player.debug.grip('done' | 'abandon')`.
- `removeKey(key)`; the HUD key strip names keys by id (`key6_a` → `KEY A — HEAD-END`, `key6_b` → `KEY B — MOON POOL`;
  W2a).
- Debug for T (§10.0 H18): `player.debug.hitRate(k)` — forces the fraction k of the player's shots to hit what the aim
  lock points at (the rest miss by 0.5 m), for `--dry`'s accounting (S8d); `player.debug.aimLock(x, y, z)` exists
  (`player/index.ts:740`).
- Tests: `scripts/check-water.mjs` (W1): speeds per depth band (± 3 %), no sprint ≥ 0.35, no jump ≥ 0.7, crouch refused
  ≥ 0.7, footsteps surface `water`; **from every water cell (a 0.5 m grid over `wat6_wet`, incl. the channel's bottom and
  its ends), a bot under the wading caps walks out to dry floor in ≤ 10 s** (B3); a carbine burst into the wet dock
  splashes at the surface (no floor decal, no hit on a husk's submerged legs, a hit on its torso), `lineOfSight` from the
  gallery to a point under the well's surface false; the rescue at a debug teleport into `deep` (held, rescued at 1.0 s,
  −15 health, alive, `player:rescued`, never below the kill height); grip: hold advances, release pauses, progress resumes
  from `start`, a 35-damage hit pauses 0.3 s and does not cancel, 1.4 m walk-away pauses, E never fires `interact` during a
  grip, the weapon is lowered and raised back; levels 1–5 unaffected (`check:weapons` unchanged).

### 8.4 Enemies in water, the climb, patrols, flood-lit soldiers, cover enabled (task W3c, with W3b's manager lines)

- Nav (shared with W4b's level nav): nodes carry `wade` (the water depth at the node); husk / soldier paths cost × 1.4
  through `wade` ≥ 0.35 and exclude `wade` > 0.6; skitters exclude `wade` > 0.1; wading speed × 0.7 at ≥ 0.35; splash
  steps (`enemy:step` → audio variant by the node's `wade`). `nav.walkable`'s shortcut test and `ai.groundAt` use
  `raycastSolid` (water is no floor; a shortcut off the kerb into the channel is impossible — S5).
- **`pose: 'climb'`** spawn (husk — the existing `EnemySpawn.pose` field, S8c): the unit appears at the given point under
  water (hidden: the water stops sight) and climbs the nearest level ladder (`level.object('ladder6_w' | 'ladder6_e')
  .userData` = `{ foot, top, exit, gate }`) at 1.0 m/s, opens the ladder gate (`userData.gate.open(k)`), goes over the
  coaming top (0.8 s), steps down to `exit` (0.6 s) — **kinematic from spawn to `exit`** (no `moveBody`, B6) — then awake;
  shootable from the moment its head clears the water (R2). If it dies on the ladder it falls back into the well.
- **Bodies in deep water** (B6): an enemy that dies or is spawned (not climbing) in water deeper than 0.6 m sinks at
  0.6 m/s with no `moveBody` and is removed at y −26; no drop. The **manager** (W3b) makes **no wreck box** for a body in
  water deeper than 0.6 m (the doorway-exclusion mechanism of `manager.ts:250-256`).
- **Patrol** (S8a): `EnemyManager.patrol(group, points, o)` — the manager member is W3b's (one line delegating to the
  soldier); the walk itself is W3c's in `soldier.ts`: weapon light per `o.light`, `walk` pose at `o.speed` (default 1.4),
  `hold` at the last point (counted by `holding()`), released by `release(group)` or by itself as any holding soldier
  (shot at, a near miss, sight within 6 m). Used by `v6_crossing` and F3's walk-out.
- Soldier (`soldier.ts`, `cover.ts` — 3c's files, now W3c's): perception treats `boss.floodLit(player)` as `lit` (D20);
  `CoverPoint.enabled` respected (a point whose container leaves is dropped: the soldier re-chooses within 0.5 s); wading
  as husks.
- Tests (in `check-soldier.mjs` + `check-nav.mjs`'s level-6 cases, W3c adds them): a husk path from the dock to the wet
  dock's flat floor uses the ramps and never enters the channel; skitters never path into the wet dock; a climb from each
  ladder ends at its exit in ≤ 6 s (first climber, from −23.2) / ≤ 7 s (second, from −24.4) (S1c), the gate shut behind
  it, shootable from the head clearing the water; a husk killed on the ladder sinks and is removed, no wreck box, never
  teleported to the roof; a patrol walks its path and holds (`holding()` = 1), and releases on a near miss; a soldier sees
  a flood-lit player at 30 m in a dark region and loses that when the flood dies; a soldier at a dock point re-chooses
  within 0.5 s after its container is lifted; husks route round all six slot boxes (permanent nav obstacles, S6a).

### 8.5 The objectives with the existing interactable API (W4a interactables · W7 set pieces · ST-a / ST-b logic)

Every objective is an `Interactable` (`kind`, `position` = the use point, `radius`, `prompt`, `enabled`) — the press emits
`interact`; **the story owns what follows** (3c / REVISION 6.1 rule: level animations never run on the raw press):

| interactable | press → story | then | level / set piece driven by the story |
|---|---|---|---|
| `he6_switch` "Crank to manual" | `grip({ seconds 3.0, hold, motion 'crank' })` | done → Key A, flags, lines | `switch6.setProgress(k)` (the crank turns 5 times; the mode pointer travels), `switch6.keyOut()` |
| `vault6_lock` "Insert key A" | no key → deny; key → 0.6 s turn (`hold: false`) | `removeKey`, `bj6_open` | `bj6.unlock()`, `bj6.open(k)` |
| `vault6_loom` "Pull the fibre" | `grip({ seconds 3.0, hold, motion 'pull' })` | done → Key B, fibre LOS | `bj6.strain(k)`, `bj6.rip()` |
| `shaft6_lock` "Insert key B" | no key → deny; key → 0.6 s turn | `removeKey`, phase K | `shaft6.unlock()` |
| `frame6_pin` "Pull safety pin" | **feet in `t6_cage`** (bars pass rays, so R8 alone would allow it from outside) → `grip({ 1.2 s, hold, 'pin' })` | done → pin, stage, W2 | `frame6.pin(k)` |
| `frame6_pump` "Pump" | feet in cage; pin out (else `l6_unit_shear_pin`) → `grip({ 6.0 s, hold, 'pump', start: pressure })` | progress → the gauge; done → pressure, stage 3, W3 | `frame6.pump(k)` (the lever strokes, the gauge needle) |
| `frame6_lever` "Fire the shear" | feet in cage; full pressure (else `l6_unit_shear_low`) → `grip({ 0.6 s, press, 'lever' })` | done → the shear (§4.8.1) | `frame6.fire()` (blade, tether parts, whip, splash) |
| `he6_phone` "Pick up handset" | while `v6_handset` runs | the call | `phone6.lift()`, `phone6.drop()` |
| `console6` "Use console" | ending pending | the cutscene | `console6.page(id)` |

The frame's enabled flags also require `t6_cage` (the prompt does not show outside it) — `check:reach`'s `mustNotUse` row
tests the frame from outside the cage (§3).

### 8.6 Water surfaces, the well, wakes, the sea (task W6)

1. **`fx.well(o)`** (new, `FxHabitat`): the moon pool's horizontal "viewport": a back-faced box proxy from the surface down
   to the sea gate; its shader marches **down** from the surface plane: cold green-black extinction (red dies first,
   visibility 3 m), the sea gate's ring of eight amber lamps at the floor with their own fog term (they read through 13 m),
   the tether as an analytic capsule from the sheave line to the gate gland, faint ladder rungs near the walls, up to six
   **eye points** (uniform array: position, colour, on — for `v6_well_eyes`), marine snow (≤ 300 points), a slow caustic
   flicker; draws only along rays that cross the well's surface rectangle (3b W7's pane clip, horizontal). The surface
   itself is the level's `water` material quad (D3a) with the floods' reflections from the probe. ≤ 2 calls. States
   `calm` / `dark` (the gate lamps dim after `lights_out6`), `eyes(on, list)`.
2. **`fx.wake(p, r)`** — pooled ring ripples (≤ 24 quads, one additive call) on any registered water surface; `fx.splash(p,
   size)` pooled bursts (spray + ring + foam) for bullets, steps, the grab, containers, bodies.
3. **Viewport additions**: `cable` already exists; add `beacon` toggle and **`cutCable()`** (the cable's upper run drifts up
   and out of the floods over 6 s, the beacon off) and a `shapes` "pass" trigger for `v6_window` (one large shape crossing
   in 4 s); the chamber's pane is ≥ 20 m wide → the capped steps (3b W7).
4. Cold mist over the well (`fx.fog`, 0.6 density, bounded), hydraulic spray emitter preset (`spray`), dust motes for the
   vault (`fx.fog` dust), drips (bounded) — all registered volumes (§2.9).
5. `check:fxleak --level 6` views: every room centre and door as 3b, plus the reveal view, the window walk, the shaft
   bottom with `d6_pool` open and shut.

### 8.7 Set pieces (task W7, `src/level/l6/setpieces6.ts` + `src/level/dev/setpieces6.{ts,html}`)

1. **Changeover switch** `switch6`: cabinet, mode plate, two-handed crank (`setProgress(k)`), Castell barrel and key
   (`keyOut()`), ≤ 3 calls.
2. **Beach joint** `bj6`: enclosure with hinged doors (`open(k)`, registered movers, colliders when open), the Castell
   barrel (`unlock()`), the fibre loom (laser-green fibres in a splice tray, emissive; `strain(k)` flicker; `rip()`: the
   connector tears out, the fibres go dark in a cascade, Key B's barrel frees), ≤ 4 calls.
3. **Shaft interlock** `shaft6`: panel + barrel (`unlock()`).
4. **Tether frame** `frame6`: the cage (bars, move-only colliders, one alpha-free merged mesh), the shear (`pin(k)`,
   `fire()`), the pump (`pump(k)`, gauge needle + `gauge6` screen), the firing lever with its guard, the sheave, the
   **tether** (armoured cable from the winch drum along the trough over the sheave and down into the well; after `fire()`
   the winch end whips back 1.5 m and the well end drops into the water — two meshes, no collider change), the **winch**
   (drum turning when it pays out; `brake()`), ≤ 8 calls.
5. **Well furniture**: two ladders + self-closing ladder gates (`userData = { foot, top, exit, gate }`, `gate.open(k)`),
   the sea gate (a disc at y −34 with the lamp ring — geometry for the probe; the fx draws its look under water), the
   coaming's sluice ports.
6. **Dock console** `console6`: desk + screen stand, the screen (`manifest` / `feed` kinds), `page(id)`.
7. **Phone station** `phone6`: the station, the howler, the handset on its cord (`lift()`, `drop()`: a short cord sim).
8. **The feed set** `feed6` (in its void room): 3c's sub-bay south end rebuilt cheaply: the cradle (empty, clamps open),
   rails, the 5 m launch-lock door (shut, its port black, a red `FLOODED` lamp), wet floor patches, two amber beacons, the
   board `feed6_board`; a feed camera marker `mk6_feed_cam` (112, 7.2, 21.5) looking at (112, 1.0, 8.0); ≤ 20 calls (drawn
   only by the feed pass).

### 8.8 Materials, screens (W5) and props kit (W8)

Materials (`TrunkMaterialName`, W5): `tunnel_shotcrete`, `cable_armour`, `dock_steel` (with a wet-sheen variant for the
dock), `crane_yellow`, `rope_wire`, `container_navy`, `container_orange` (corrugation normal, stencil atlas `B-01 … B-14`,
`HALCYON BIO-SYSTEMS DIV.`), `coverall_orange` (the contractors). Screens (W5): `mimic` (canvas: the trunk diagram with
states), `manifest` (scrolling list with a cursor; `setLines`, `scrollTo`), `interlock` (key panel), `dock_board` (12 × 3
board, line states), `gauge` (needle + numerals); `feed` gains an OSD text overlay (`opts.text`). Test: dev gallery under
lit, emergency-red, flood-only light; zfight clean.
Kit (W8, `src/level/l6/kit6.ts` + `src/level/dev/kit6.{ts,html}`, ≤ 2 calls per prop, 3b/3c kit conventions): tunnel
ring frame, cable trays (merged per run), the trunk run with yellow bands, junction box, drum trolley, large cable drum on a
cradle / on a stand (with ratchet + brake handle for `v6_drum`), repeater cabinet bank, repeater housing, jointer's tent
(tarp, poles, work lamp, splicing table), OLT rack, mimic board frame, console desk, wall locker, dehumidifier, nitrogen
rack, trench grating + lifting grille, hatch lids (3c), landing lamp (breakable), fire-point cabinet, gallery segment +
rail + parapet (merged per side), bar guard, coaming + rail, cargo container (instanced; B-xx labels), slot paint, pump
housing, hose reel, fenders, bollards, life ring, the festoon, runway rail + corbels + end-stop buffers, emergency strips
(3b `stripMat`), amber beacon (3b `rotBeacon`).

### 8.9 The ending and the feed (ST · W7 · render as built)

The cutscene runs on `rig.cutscene` (3a pattern, 3c §4.2 conventions); the E2 feed is `render.feed({ name: 'cam_tern',
width: 640, height: 360, hz: 15, rooms: ['feed6'] })` bound to the console screen (`feed` kind + OSD); the feed is
created at `l6_quiet` (warm-up) and active only during E2; fallback: the `cctv` canvas kind drawing the same shot
(decided by the feed spike at W7: ≤ 1.5 ms on HIGH, ≤ 1.0 ms on MEDIUM; else canvas). `check:cutscene` gains the level-6
scene in its awkward-entry set (sprinting into the console, mid-reload, crouched, lamp on, a grip just finished).

### 8.10 Story level 6 (tasks ST-a, then ST-b — "ST" below means both)

`src/story/l6/{index,script,dialogue,text}.ts` (ST-a) and `{boss,scenes}.ts` (ST-b) on `src/story/stage/*` (read-only;
K changes only `groundY`): beats §4, RULES §6.2, text
§6.3–6.4, `CLOCK6`, checkpoints §7 (incl. §7.1), spawns §5.1, latches §3, grips §8.5, the boss orchestration
(`boss.ts`: stages, waves, milestones, the frame, the cap on waves, the restore), scares §5.7, Q, the ending (§4.9), the
carry. Door status calls only `cycling | dark | null`. A diff for `check-voice-level` (§8.14).

### 8.11 Markers (W4a places every one; missing = error)

| marker | what |
|---|---|
| `mk6_start`, `mk6_tube_panel` | spawn check; the tube line |
| `mk6_cross_0`, `mk6_cross_1`, `mk6_tun_s1`, `mk6_tun_s2`, `mk6_tun_u1`, `mk6_tun_u2` | F1, the crossing |
| `mk6_rep_s`, `mk6_bay_u1`, `mk6_bay_u2`, `mk6_vent_rep` | F2 |
| `mk6_he_s`, `mk6_tunb_hold`, `mk6_sentry` | F3 |
| `mk6_switch`, `mk6_queue`, `mk6_handset`, `mk6_phone` | he6 |
| `mk6_hold_1`, `mk6_hold_2`, `mk6_hold_3`, `mk6_bj`, `mk6_loom`, `mk6_shaft_lock`, `mk6_grille_1/2/3`, `mk6_vent_vault`, `mk6_exit_vault`, `mk6_exit_he`, `mk6_drum` | vault |
| `mk6_shaft_u`, `mk6_ll0 … mk6_ll3`, `mk6_llb` | shaft |
| `mk6_reveal`, `mk6_boss_safe`, `mk6_boss_safe_w`, `mk6_w1_a/b`, `mk6_w3_a/b`, `mk6_w3_u`, `mk6_lw_exit`, `mk6_le_exit`, `mk6_ladder_w/e`, `mk6_cage`, `mk6_pin`, `mk6_pump`, `mk6_lever`, `mk6_sheave`, `mk6_horn` (the loader's PA position is the trolley's — the enemy supplies it) | the arena |
| `mk6_console`, `mk6_end_stand`, `mk6_end_cam0`, `mk6_end_cam1`, `mk6_end_screen`, `mk6_feed_cam` | the ending |
| `mk6_windows` | `v6_window` |

Debug hooks: §10.0.

### 8.12 Audio ids and their one owner (W2b builds all; the owner is who plays it)

| id(s) | owner |
|---|---|
| `tarp_flap`, `lamp_creak` (exists), `phone_howler`, `phone_dead_click`, `line_hiss`, `handset_drop`, `ratchet_run`, `drum_rumble`, `drum_brake`, `ping_close`, `hull_ring`, `dust_sift`, `far_lock_flood`, `lights_dip`, `bulb_pop`, `glass_tinkle` (3c), `sea_groan`, `castell_turn`, `bj_doors`, `fibre_strain`, `fibre_rip`, `crank_turn`, `mode_clunk`, `pin_draw`, `pump_stroke`, `gauge_tick`, `shear_fire`, `winch_brake`, `tether_whip`, `splash_big`, `gate_squeal` (ladder gates), `lights_out_dock` (3c), `alarm_beacon` (exists), `sump_lift` (exists), `vent_grille` (exists) | level vignettes / set pieces (D-tasks, W7) — fired by the story through `level.vignette` / the set-piece methods |
| the **buoy ping** `ping_far` / `ping_near` (rate from `level.setMachine('ping6', …)` and a story value; positional at the hull transducer under the vault and, in the chamber, at the well) | the level (machine `ping6`) |
| `loader_*`, `flood_pop`, `ram_hit`, `ram_burst`, `cowl_open`, `rope_whip`, soldier and husk sounds, wading steps of enemies | enemies (W3a/W3b/W3c) |
| `wade_shallow`, `wade` (player footsteps), `impact_water` (bullet), `drown_rescue` (the fail-safe), `armour_clank` (retracted ram / shut pod hit — enemies-owned, listed here for W2b) | the player / audio on events (W1 + W2b) |
| `interlock_deny`, grip meter tick (`grip_tick`) | UI (W2a calls `audio.play`) |
| ambiences `amb_tunnel`, `amb_tunnel_dark`, `amb_headend` (laser fans), `amb_vault` (dehumidifier hush), `amb_trench`, `amb_shaft`, `amb_pool` (huge, water, the hum of the loader), `amb_pool_dark` (after `lights_out6`), `amb_pool_quiet` (after the cut and the loader: water and hull only); room presets for every level-6 room (the chamber: a 3.5 s steel-hall tail) | audio itself (events / `setRoom`) |
| music: `combat` during the boss with a **boss layer** (low ostinato from `boss:stage`, rising per stage); silence at `l6_quiet`; the end card's `mus_bell` | audio (`setMusic` + `boss:stage`) |

### 8.13 UI (task W2a)
Boss pips generalised (`ui/boss.ts`): label `DOCK LOADER`, three pips (`ram_w`, `ram_e`, `pod`) read from
`enemy:part-destroyed` for type `loader` (the foreman's unchanged); a **grip meter** (a thin ring under the crosshair,
`player.gripProgress`, with the `Hold E` hint on the first grip); key strip names (§8.3); the `phone` subtitle class
(Aas: pale grey, small); the `END OF CHAPTER 3` card style (`title`) after the ending card; `check:cards` covers both.

### 8.14 Speech timing and level (standing requirement)
Every timed line ≤ 0.12 s from its cue (`lineLog { id, start, cue }`, `play:l6` fails otherwise) — the radio sequences,
the cut on `l6_kes_he_3`, the handset's cut, the shear's line, the ending's scene lines. `check-voice-level --level 6`
(the coordinator's script; **ST hands a diff with its listener points, IA applies it**): Kessler's radio 2-D at
conversation level; Aas on the handset at 0.8 m / 3 m (positional) and held (2-D), **plus an ASR-intelligibility pass on the held take** (every word of `l6_aas_2` recovered through the `phone` fx; a whisper through a 350–2,600 Hz band is the risk — S12); the loader's PA at 10 m and 30 m in the
chamber's long reverb (≥ −6 dB of the reference at 10 m, intelligible); Sunde on the radio = Kessler's level ± 2 dB; a
soldier bark at 5 and 15 m (as 3c); CHOIR's last line 2-D (radio:1) ≥ the reference.

---

## 9. R1–R8 audit and order-independence audit

| scene / gate | R1 barrier | R2 shootable or different | R3 no assumed order | R4 not before its time | R5 | R6 | R8 |
|---|---|---|---|---|---|---|---|
| arrival, tunnels | the tube latches behind (real door, panel); the way back sealed (3c) | the crossing sailor is a real soldier; the tent's body is a body (blood decals, it rocks when shot); the drums and trays spark | `_start_2` after the latch; `_contact_a` needs both alive and released; `_tun_done` needs both dead | F1/F2 spawn hidden (rays computed, §4.2–4.3); bay husks behind a shut door; the sentry dormant (harmless) | — | A, T, U, B | — |
| tunnel B (dark) | — | the holding soldier is real (releases himself when shot near, 3c) | `_tunb_soldier` needs him holding and in view | he walks out of he6 through a door that opens for him | — | B | — |
| head-end | the vault enclosure is a real interlock (Key A) | racks, phone, console spark; the handset swings | `_he_2` / `_he_2b` by `manual`; `_reyes_he` only after `_2`; `_queue` lines only after the read; `_aas` only after `heard(l6_aas_2)`; CHOIR's queue line claims nothing of the world | F4 spawns in the sealed hold6 | — | B, U_man | the switch, queue and phone from the room side only; the trench hatch underside only from below |
| vault | the stair door is a real interlock (Key B); the trench exit dogged from below | drums, enclosure spark; skitters real | `_bj` needs the doors open; `_pull_2` needs the shaft locked; `_thud` needs the thud | F5 in hold6 / under the grilles (spawned in the trench only while he is not in it) | — | B, U_pull | the lock and loom from the north side; the stair-door barrel from the vault side |
| shaft | — | the climbing unit is real | `_shaft` after the lamps | the unit spawns under L3, hidden | — | K | — |
| moon pool | the well: coaming + flush bar guard 2.4 m, mid-deck bar guard 2.4 m, roofed 2.6 m cage, non-walkable cargo, hazard tested on every step (§2.10); the frame's order is mechanical (pin → pump → lever) | the loader reacts everywhere (×0.05 sparks at least; floods, rams, pod; a retracted ram or the shut pod clanks and shakes its pip — 'different', 0 damage); W2 units shootable the moment their heads clear the water; containers spark | every teaching line conditional on the thing in view / not yet done; `_pool_2` / `_2b` by view; `_cut_loader` / `_loader_dead` by the other condition; CHOIR's lines claim nothing false | the loader does not exist until Key B turns (D31) and the chamber is unseen and unreachable before that; W1–W3 spawned at their steps, hidden (stores door, water, shaft door) | — | K | the frame needs the feet in the cage; the console only in the ending |
| the ending | the console press is the player's; the camera is taken only when calm | — | `_end_1` / `_1b` by `manifest`; `_end_4` by `heard(l6_aas_2)`; the OSD time = the measured `launchAt` | the feed set is sealed, never reachable | camera taken at once, own clock, each beat ≤ 25 s, no hostile alive | K_end | — |

| # | what if the player… | answer |
|---|---|---|
| 1 | arrives by `?level=6` cold | the direct loadout (§7.2) incl. the carbine 30/120, armour 50, `radio` true (HUD strip, Q live), facts default `stop`; starts in lock6; every beat works (`testHour`, `l5_*` facts default) |
| 2 | never uses the radio (never presses Q) | Kessler's lines are pushed by the story anyway; Q is only hints; objectives and plates carry every gate |
| 3 | runs down tunnel A before the crossing | past z −40: the crossing is skipped (never seen from closer than 40 m) and F1 is released at once; past z −70 before F1 spawned: F1 never exists (R4) and rep6's F2 is the first fight |
| 4 | kills the crossing soldier at 60 m | allowed (he is real): F1 starts with one soldier; `_contact_a` (needs both alive) is skipped |
| 5 | sprints past F2 into tunnel B | F2 follows; F3's soldier walks out ahead of him; checkpoints wait for calm (the stray rule ends a stalemate) |
| 6 | kills F3's soldier before he releases (60 m in the dark) | allowed: shots release him by rule anyway; `_tunb_soldier` already played or skipped |
| 7 | tries the enclosure before the crank | `Interlock key A required` + `l6_unit_deny_a`; Q → `hint_switch` |
| 8 | cranks before Kessler's head-end lines end | `_he_2b` instead of `_2`; Reyes's "A key." skipped; `_he_3` and CHOIR's cut still play (true in both) |
| 9 | never answers the handset / is never near it | the voice tries twice and the line dies; fact `aas` false; E2 skips `_end_4`; the OSD still names Aas |
| 10 | answers the handset and walks away mid-call | the handset swings back on its cord; the rest plays positional from it; Kessler's `_aas` still needs `heard(l6_aas_2)` |
| 11 | **skips the manifest** | E1 shows it on the console; `_end_1` (not `_1b`); fact `manifest` false |
| 12 | reads the manifest after the boss (walks back to the head-end) | `l6_reyes_queue` / `_kes_queue` / CHOIR play (none claims the batch is still coming); E1 uses `_1b` |
| 13 | tries the stair door before the pull | `Interlock key B required` + `l6_unit_deny_b`; Q → `hint_bj` |
| 14 | takes the trench during F4 or F5 | enemies stand off 2–5 m from the exits (never inside the hatch rails); F5's skitters come from the vent instead; no checkpoint below; he can exit into he6 (one-way) or back up |
| 15 | dies after the crank but before the next checkpoint | `cp6_he` restores: no Key A, the switch at AUTO — he cranks again (consistent: flags and key saved together) |
| 16 | dies after the pull but before `cp6_pulled` | `cp6_manual` restores: Key A held, the enclosure shut — he opens and pulls again |
| 17 | stays on the gallery at the reveal | the hostile start comes at reveal + 10 … 18 s anyway |
| 18 | shoots the loader during the reveal | the hostile start at once (B-14 is let go into the well) |
| 19 | **kills the loader before cutting anything** | possible on slam windows (rams), then the pod; stage 3 by damage; W2 / W3 still join at the pin / pressure; `_loader_dead` "The frame, Reyes. Finish it."; after the cut the quiet follows directly |
| 20 | **cuts without fighting** (the cage is never slammed) | pin, pump (6 s, exposed to soldiers and units), lever → the trunk dark with the loader alive; `_cut_loader`; objective `Destroy the loader`; the quiet waits for its death |
| 21 | **falls or wades into deep water** | not possible by walking, jumping, falling, standing on a corpse, a container or the grab (§2.10: 2.4 m guards, non-walkable cargo; `check:reach` tests the hazard on every simulated step); the wet dock's deepest wade is 1.0 m (waist; the channel's sloped side walks out, B3: slow, no crouch, no jump); a bug that puts him there anyway triggers the rescue (§8.3: held, out at 1.0 s, −15 health, **no death**) |
| 22 | wades the channel while the loader is in stage 1 | the loader never slams d > 0.7; units do come; it is slow — a real, honest risk |
| 23 | **dies at stage 1** (before any milestone) | `cp6_shaft` (written on the default route — the shaft beat is exempt from scare spacing, S4): shaft bottom, the loader spawned in `working` with B-14, the reveal replays (≈ 10 s) |
| 24 | **dies after the pin / a ram / the pressure / the cut** | `cp6_m<n>` (`checkpointNow`): at the latest wave's restore point (east gallery, or the west gallery when W3 is latest), health ≥ 60, carbine reserve ≥ 90, the dock lockers re-armed, the loader rebuilt with its parts and stage in a 3 s guard, **only the latest wave**: fresh from its twin if alive, re-queued under its rule if pending (§5.5, §7.1) |
| 25 | dies twice at the same milestone | the same save on a fresh page: the twin spawns again (never in that save's `cleared`) |
| 26 | **leaves the arena mid-fight** (back up the shaft) | the loader guards (it cannot follow); the waves follow and are fought in the shaft / vault; nothing resets; he can return; Q in the shaft still gives the boss hint |
| 27 | hides in the undercroft or on a gallery | the loader guards; soldiers and units come; floods light him when they can see him |
| 28 | **runs out of ammo in the finale** | the arena holds 1.71 × what its fights need (§5.3; `--dry` proves ≥ 30 % left): 300 carbine rounds — three re-arming dock lockers (150), MC1, the undercroft shelves, the window walk, the cage — all reachable under the pickup rule, + soldier drops; **a restore tops him to ≥ 90 reserve and re-arms the lockers** (B5); the shotgun kills a ram in 3 shells on a slam window; the pistol works on every part (25 hits on the open pod) |
| 29 | releases the pump at 90 % again and again | progress is kept (cumulative); the gauge shows it; no penalty |
| 30 | presses the lever before full pressure / the pump before the pin | `PRESSURE LOW` / `PIN IN` on the gauge + the unit line; nothing breaks |
| 31 | stands inside a cargo slot as a container comes down | the outline strobes 1.6 s first; if he stays, 40 and pushed out — never trapped inside a box |
| 32 | shoots the tether | sparks; armoured, nothing happens (it needs the shear) — it is the job the frame exists for |
| 33 | never presses the console | no timer; `_console_2` every 60 s; the objective; Q |
| 34 | runs the flashlight empty in the shaft or the dark chamber | the 0.5 s death flicker and `flashlight_die`; the strips, nosings, coaming and cage stay readable (§2.7.3); soldiers see him at 12 m unless he fires — **or he stands in a live flood** (D20) |
| 35 | arrives with no carbine in the carry | the first soldier he kills (the crossing pair) drops it (3c S6); before that, pistol and shotgun suffice for two soldiers at range in cover — harder, honest |
| 36 | cranks, inserts Key A before F4 dies, then dies after `cp6_manual`'s calm save (B4) | the save holds `bjOpen` (set with `removeKey`); `cp6_manual` was no longer valid (`!bjOpen` fails), so the latest valid save is `cp6_he` (no key, switch at AUTO: he cranks again) — or, if `cp6_manual` was written first, its restore replays `bjOpen` and the loom is usable; never a trapped key and a shut enclosure |
| 37 | tries to win from the cage or a gallery (S3) | rams and the shut pod take 0 there (clank, pip shake); GUARD parks far off; he must come down to a slam deck to open a window; floods are optional targets |
| 38 | drops onto a container top or the grab from a gallery (B2) | non-walkable boxes push him off onto the deck; the loader never lifts with a body on its load |
| 39 | dies at a milestone with 0 reserve and every arena pickup taken (B5) | the restore tops the carbine to ≥ 90 and re-arms the three dock lockers; `--checkpoints` plays this case to the end |
| 40 | holds the handset and starts the crank (S11d) | the handset drops onto its cord (`handset_drop`), the call goes on positional; the crank runs |
| 41 | kills a W2 husk on the ladder (B6) | it falls back into the well, sinks at 0.6 m/s and is removed at y −26 — no wreck, no body on the roof |

---

## 10. Test plan

### 10.0 Story hook contract (written first; T builds to it, ST implements **exactly** this list)

On `window.__game.story` (level 6), the shape of 3c's contract (3c §10.0) plus the additions marked +:

| hook | contract |
|---|---|
| H1 `end()` | jump to `l6_end` (carry written) |
| H2 `checkpoint(id)` | load / write a `cp6_*` |
| H3 `fire(name)` | `tube`, `latch`, `crossing`, `f1`, `f2`, `f3`, `release_f3`, `handset`, `answer`, `queue`, `manual` (complete the crank), `f4`, `bj` (open the enclosure), `pull` (complete), `f5`, `thud`, `shaft` (use Key B), `shaft_lights`, `reveal`, `hostile`, `pin`, `pump` (complete), `fire` (the shear), `ram_e`, `ram_w`, `pod` (kill it), `quiet`, `console`, or any vignette id (incl. `id:snap`) |
| H4 `hurry(fast?)` | shorten `wait`s (never `hold`s, never line gaps) |
| H5 `lineLog` | `{ id, t, said, q, dur, end, cue }` per line (`\|t − cue\| ≤ 0.12`) |
| H6 `rules` | the RULES table |
| H7 `debugState` | 3c's fields (`level, now, beats, t, phase, phaseApplied, flags, checkpoints, checkpoint, restoredFrom, calm, heard, missingMarkers, loadout, arrival, ended, scares, scareLog, groups, spawnLog, strays, radio`) + `keys: string[]`, `grip: { id, progress, holding } \| null`, `frame: { pin, pressure (0 … 1), fired }`, `boss: { stage, mode, parts, floods: boolean[], slots: (string \| null)[], waves: { w1, w2, w3 }, milestones: string[], hostileAt \| null }`, `launchAt`, `ending: { pending, started, times, result }` |
| H8 | beats `l6_*` on `story:beat`; `__game.facts` |
| H9 | `story:objective` / `story:toast` texts as §6.4 |
| H10 | (3c's keypad hook: absent in 3d — `keypad(code)` returns false) |
| H11 `radioAsk()` | = pressing Q |
| H12 `soldiers()` | as 3c (from `enemies.debug.soldiers()`) |
| H13 `worldState()` | `{ doors: Record<id, { open, locked, status }>, keys, hatches: { vault, he }, lights: Record<group, boolean>, dark: string[], screens: Record<id, string>, pickups: string[], groups, scares, flags, torch, boss: BossState \| null, slots: (string \| null)[], frame, waves }` — what `--checkpoints` compares before death and after load |
| H14 `audioLog()` | `audio.debug.log` (3c W2b) |
| + H15 `boss()` | `enemies.debug.loader()` (§8.2) incl. **`parts: Record<id, { hp, pos: [x,y,z], mult }>`** (world position and current multiplier of every flood, ram and the pod — what `--boss` aims `player.debug.aimLock` at, S8d) |
| + H16 `grip(id, mode)` | drives a grip: `'done'` completes it, `'abandon'` cancels, a number = holds E for that many seconds (real progress) |
| + H17 `wade()` | `{ depth: player.wading, cap, canCrouch, canJump, canSprint, rescued: number }` |
| + H18 `hitRate(k)` | = `player.debug.hitRate(k)` (W1, §8.3): forces the fraction k of the player's shots to hit the aim-locked point (`--dry`) |
| + H19 `lockers()` | `{ e, w, n: { armed: boolean } }` — the dock ammo lockers (B5) |

T's first deliverable is `playthrough-l6.mjs --contract`: asserts every hook and field on ST's greybox build. T may not
assume anything not in this table; ST may not rename or add to it without editing this table first.

### 10.1 `scripts/playthrough-l6.mjs` (`npm run play:l6 -- <url>`, static build; T)

- **default** (`--choice=stop,command`): every beat in order; doors per phase; the tube at 3.0 s and the latch; the
  crossing seen ≥ 40 m away for ≥ 2 s; F1 released; F3 walks out and holds, then is released; the handset in one run
  answered, in the other ignored; the crank by a real 3.0 s hold → Key A; the lock → doors; the pull 3.0 s → Key B;
  screens flip; the ping rate 20 → 4 s; F5; `v6_thud` / `launchAt`; the shaft key → K; the lamps die; F6; `cp6_shaft`;
  the reveal and `cue('lower')`; the hostile start within reveal + 10 … 18 s; W1 / W2 / W3 at their steps; pin, pump
  (6.0 s cumulative over two holds), lever; the shear's timings (§4.8.1, ± 0.1 s); the loader killed by debug part damage
  (`ram_e`, `ram_w`, `pod`); the quiet; the console; E1 / E2 on the shot table, every scene line ≤ 0.12 s from its cue,
  each beat ≤ 25 s; the OSD shows `launchAt`; end cards; carry (`from: 6`, `kills6`, `manifest`, `aas`, `launchHour`,
  `trunkCut`, `loaderDead`, `testHour`); stored level 6; the menu.
- **--checkpoints**: per `cp6_*` up to `cp6_quiet`: play to it, die, load, compare H13 `worldState()` + phase + armour +
  weapons + keys + facts, finish. Boss: die at every `cp6_m1 … m5` reached in the order cases (d), (e), (f) below, with each
  wave state (pending / alive / dead) — after the load: the loader's parts and stage equal, health ≥ 60, the restore point
  by the latest wave, **only** the latest wave back (twin after 3.0 s if alive; re-queued if pending; ≤ 6 hostiles), earlier
  waves absent, W1's twin through a re-opened `d6_stores`; die **twice** at the same milestone; kill the loader, die before
  the cut → `cp6_m<n>` restores with the loader dead (`removeSilently`) and the frame as saved. **B4 case:** crank →
  insert Key A → kill F4 (calm save) → die → load → the loom usable. **B5 case:** reach `cp6_m2` with 0 reserve and every
  arena pickup and locker taken, die, load → reserve ≥ 90, lockers armed → finish. A milestone during the pump is saved
  at the grip's end + 1.0 s (S2d).
- **--impatient**: sprints; wrong order (the enclosure before the crank, the stair door before the pull, the pump before
  the pin, the lever before pressure, the console before the end); shoots the handset, the tent, the boards, the
  containers, the tether, the console glass, the well (splashes), the windows; kills F3 from 60 m; oracle per conditional
  line; the choice-variant check.
- **--order** (a–f): (a) the vault and the enclosure before the switch (denied, then the switch, then back); (b) every
  optional first: bay6, the trench, the queue, the handset; (c) the trench first, exiting into he6, then the switch;
  (d) **kill the loader before the pin** (rams on slam windows, then the pod), then the frame; (e) **cut without fighting**
  (`?god=1` for this case only: pin, pump, lever with the loader untouched), then kill it; (f) interleaved: pin, ram, pump,
  ram, fire, pod.
- **--softlock** (a–j): (a) 120 s in lock6; (b) the tube doorway during the latch; (c) 60 s in the trench during F5, then
  out; (d) leave into the shaft mid-boss for 60 s, return; (e) 120 s in the undercroft at stage 1; (f) 120 s in the cage
  touching nothing; (g) release the pump at 90 % ten times; (h) die during W2's climb, twice; (i) never press the
  console for 180 s, then press; (j) run the lamp empty in the shaft and in the chamber after `lights_out6`. Each reaches
  `l6_end`.
- **--scares**: each `v6_*` fires exactly once on a calm route; none with a hostile awake within 30 m (forced fights at
  their triggers) except the stated exemptions; ≥ 45 s apart, loud ≥ 90 s (exempt: `v6_ring`, `v6_shaft_lights`,
  `v6_well_eyes`); **`v6_shaft_lights` (and with it F6 and `cp6_shaft`) fires on the default route** (S4); `v6_thud` only
  inside pull + 20 … + 90 s and before Key B; none during the boss but `v6_well_eyes`; snapped on every restore; their
  sounds once each (audio log) — no doubles.
- **--boss** (**the boss combat test**, on the dressed level): a bot with real movement and real weapons (debug aim-lock on
  a named part from H15's `parts[id].pos`, real hitscan, real ammo, ADS) plays the whole boss: dodges every telegraph by walking 3 m perpendicular at
  the lock / outline / lane start; shoots rams only in their windows, floods when flood-lit, the pod once open; uses the
  frame between waves. Logs every telegraph (asserts ≥ the §5.6.4 times), every hit taken (asserts **no damage from a
  telegraphed loader attack it dodged on time**), ammo spent, time to kill (asserts ≤ 6 min), the wave cap (≤ 6), the
  flood-lit sight, the stage order, the death ending in the well; **a bot in the cage and one on a gallery with W1 dead deal
  0 to the rams and the pod in 120 s** (S3). Three seeds × both choices.
- **--dry**: the boss started with 0 reserve and 10 rounds in the clip; the bot kills the required parts and W1–W3 using
  only the arena's pickups, lockers and drops, at a forced 50 % hit rate (H18 `hitRate(0.5)`), with ≥ 30 % of the rounds
  left over (an accounting in hits, §5.3).
- **--ads**: soldiers at 25–40 m in tun6_a: aimed hit rate ≥ 2 × hip fire over 60 s each.
- **--frames**: 10 fps sequences of §10.5 → `shots/l6/frames/`.
- **all modes**: spawn visibility (ray to each member's chest at every spawn; fail if visible unless through a door,
  vent or grille opened ≤ 3 s ago — water planes block sight by construction); every `mk6_` marker exists and lies inside
  a room interior; never `state === 'cutscene'` outside E1/E2; no enemy before its beat (only `g6_tunb_k` dormant from load;
  `g6_loader` absent until Key B turns — D31); static pass: every `l6_` id ↔ one RULES entry ↔ manifest; choice pairs complete; no uppercase in any
  `unit` line's `spoken`; every `soldier` line has `label` and fx `throat`; every `kessler` / `sunde` line fx `radio`;
  every `aas` line fx `phone`; "Aas" never in a `spoken` field.

### 10.2 `check:reach`
`levelsOf('all')` → [1 … 6]. Phases A … K_end with `use` and `mustNotUse` (the frame from outside the cage; the console
before the end; the trench hatch from above), stress floors (§3), ALWAYS6, the one-way `hatch6_he`, the region-floor
assertion. **New (W4b; B1, coordinator 1):** (1) `simulate()` runs down to the **level's lowest point** (the envelope's
y min, −36 here) instead of today's y −5 cut-off (`check-reach.mjs:127`), so the K phase reaches the chamber at all;
(2) **hazard regions** (`deep`) are tested **on every simulated step**, not only on end nodes — any sample inside fails;
(3) the jump-arc probes start from **every** standable surface in pool6 (no "above y −18.6" limit, the +0.6 m wreck
stress included; 16 directions, real capsule, sprint speed; containers and the grab are not standable by construction);
(4) interactables with `requireRegion` are usable only from feet inside that region (`frame6_*` from outside the cage
report as not usable — S8g); (5) a row walks T-b → T-c under the he6 / vault6 wall; (6) the B_hold row allows hold6.
Levels 1–5 unchanged (their lowest point is today's floor; the hazard list is empty).

### 10.3 `check:nav` level-6 cases (real speeds; husks rushed = 4.0 m/s, soldiers 1.6 m/s)
Arrivals: `g6_tun_u` (−4, 0, −90) → (0, 0, −30) ≤ 17 s; bay6 (17, 0, −100) → rep6 (4, 0, −86) ≤ 6 s; hold6 (−16, 0,
−143) → he6 (12, 0, −170) ≤ 9 s husk / ≤ 25 s soldier; hold6 → the enclosure (−12, 0, −177.6) ≤ 8 s; the shaft bottom
→ L1 ≤ 10 s (stairs); W2 ladder exits → the cage (−52, −16, −167) ≤ 14 s (via `ST6_M` / `ST6_M2`); W3 shaft bottom → `cv6_ge2`
≤ 15 s soldier; W1 stores6 → `cv6_gn1` ≤ 8 s. **No node** with `wade` > 0.6, in the trench (nav false), in the shaft's well
guard, in either hatch pit, inside the coaming, **inside any of the six slot boxes** (permanent obstacles, occupied or
not — a case moves a container and re-checks, S6a), over the wet dock on the dock grid (the y −19.25 … −18.5 obstacle
band, S1e); skitter paths never into `wade` > 0.1; a husk shortcut across the wet dock never ends in the channel (S5); ramps and stairs drift < 5 cm in 10 s;
every `cv6_*` reachable from its set's spawn; the loader has no nav. `ignoreFloors: ['feed6:main']`.

### 10.4 New and extended checks
- **`check:loader`** (W3b, §5.6.10), **`check:water`** (W1, §8.3), **`check:soldier`** level-6 cases (W3c, §8.4).
- **`check:dark --level 6`** (T): `?level=6&nostory=1&noenemies=1&autostart=1&quality=low|medium` plus the vignettes
  `tun6_far_out`, `v6_shaft_lights:snap`, `lights_out6:snap`; the merged lamp-on / lamp-off judgments and 3c's three
  measures (no-light p95 ≥ 0.10 on every door / nosing / gallery edge / coaming top / cage / required interactable within
  10 m; light; glow at 10 / 20 / 30 m incl. **the loader's marks and a flood-lit soldier**). Views (inside rooms,
  asserted with `roomAt` + 0.3 m inset): tun6_a `spawn=0,0,-50,0`; tun6_b `=12,0,-100,0`, `=12,0,-140,0`; the trench
  `=-12.4,-1.4,-165,0` and `=-4,-1.4,-178.8,-90` (crouched); the shaft L2 `=-24.0,-6,-169.5,0` after the lamps; pool6 after
  `lights_out6` with 0 floods: east gallery `=-30,-12,-166,90`, the cage `=-52,-16,-167,0`, the dock west `=-70,-20,-178,-90`,
  the wet dock `=-52,-20.8,-186,0`, the undercroft `=-52,-20,-158,0`, the mid deck `=-44,-16,-161,0`. **Dark runs**: tun6_b
  north → south, the shaft L0 → bottom, and in pool6 east gallery → `ST6_NE` → mid deck → the cage → `ST6_M2` → the dock →
  the wet dock → the window walk, lamp off, sampled every 2 m (≤ 4 consecutive failures). PNGs to `shots/l6/dark/`.
- `check-voice-level --level 6` (§8.14, incl. the ASR-intelligibility pass on Aas's held take — S12), **`check:cutscene`
  level-6 case (the ending; owner T, S8f)**, `check:fxleak --level 6` (W6), `check:doors` (every `d6_*`; the enclosure's
  sliding doors and the ladder gates as movers), `check:decals` (leaves, hatch lids, enclosure doors, **containers in the
  grab**, ladder gates), `check:zfight`, **`check:wreck` level-6 cases (owner T, S8f)**: a dead soldier on a stair, a
  gallery, the grating; a dead husk in the wet dock's 0.5 m (its box walked over); none in the channel or the well (no box,
  it sinks — B6); `check:chain` (§8.1), `check:cards` (`THE TRUNK`, `END OF CHAPTER 3`), `check:weapons` unchanged,
  `check:physics` (§8.1).

### 10.5 Frame sequences (10 fps) — look at
The tube opening; the crossing at 60 m; F1's first engagement up the tunnel with ADS; the tent's draught; tunnel B in the
dark with the soldier walking out of the warm door; the head-end and the handset call; the crank and the key; the drum
turning by itself; the enclosure opening, the pull, the green dying; the ring; the shaft lamps dying and the unit
climbing; **the reveal** (B-14 into the well, the eyes in the water, the floods finding him); a full slam (track, lock,
drop, recovery with the amber rams, rise) from the dock and from the gallery; a SHIFT and a DROP with the outline; W2
climbing out of the well; `lights_out6` from the cage; a ram burst; the cowl opening; a SWING passing over a crouched
player; the pod's death and the grab plunging into the well; the shear; the tether's beacon going out beyond the windows;
the quiet and `v6_window`; E1 and E2 whole; the end cards.

### 10.6 Performance views (`shot.mjs --perf`, LOW, MEDIUM, HIGH)
(1) tun6_a from the tube `?level=6&spawn=0,0,-2,0`; (2) tun6_a in F1 with 2 soldiers + 2 husks `spawn=0,0,-30,0`; (3) rep6
`spawn=0,0,-82,-135`; (4) tun6_b dark `spawn=12,0,-96,0`; (5) he6 → vault `spawn=14,0,-168,90`; (6) the vault + trench
`spawn=-5,0,-165,90`; (7) the shaft from L0 down the well `spawn=-24.8,0,-169,0,-60`; (8) **the reveal** `spawn=-30,-12,-169.8,90`;
(9) **the boss** from the cage looking south-east with the loader + W1 + W2 alive (6 enemies) `spawn=-52,-16,-167,-45` —
**run on the greybox (W4a + W4b) with W3a's loader and the enemies as soon as W3a + W3c + W4a + W4b merge, before D3a / D3b dress, and give
them the real budget** (3c review note); (10) the wet dock toward the windows `spawn=-52,-20.8,-184,0`; (11) the ending's
console with the feed active. Budgets §2.7.5.

---

## 11. Build order — task graph for parallel worktree agents

Rules (`docs/plans/stage-3c-agent-rules.md`, copied by K to `docs/plans/stage-3d-agent-rules.md` with "3c" → "3d",
level 5 → 6, plus 7–10):
1. **Every task starts with `git merge --ff-only main`** in its worktree; that is the only git command that changes
   anything a task may run. No add / commit / stash / checkout / reset. Then confirm this plan has a filled §13 and that
   `docs/plans/stage-3d-k-notes.md` exists.
2. One owner per file at a time; the coordinator merges each task's patch **restricted to the paths its row owns**; a
   change needed elsewhere is described in the report, not made. Replace every `// K placeholder` in your files.
3. Every task builds into **its own dist directory and port** (`npx vite build --outDir <scratchpad>/dist-<id>
   --emptyOutDir`, `vite preview --outDir <that dir> --port <own> --strictPort --host 127.0.0.1`), never 5173 or the shared
   `dist`, and stops its servers at the end.
4. **Browser checks one at a time**; run your own test and the one or two checks your change can affect, not the suite.
5. **T writes the hook contract (§10.0) into its script first; ST implements exactly that list.**
6. Every task ends with `npm run typecheck`, `npm run build`, its own test and the level 1–5 checks it could affect.
   Levels 1–5 behave as before; `LEVELS[5].next` stays `null` on main (5 → 6 only with `?next=5:6`).
7. **K verifies every "assumed" 3c interface** (the header table) against merged code before wave 1, records the result
   in `stage-3d-k-notes.md` and edits this plan's citations if 3c built something differently; wave 1 starts only after.
8. **No task edits a 3c file** except where its row lists it (W3c: `enemies/soldier/{soldier,cover}.ts`; W4a:
   `level/context.ts`, `level/assemble.ts`; W4b: `level/nav.ts`, `scripts/check-reach.mjs`, `scripts/check-nav.mjs`;
   K: `src/level/l5/cover.ts` (`enabled: true` only), `story/stage/base.ts` (`groundY` → `raycastSolid` only); T:
   `scripts/check-cutscene.mjs`, `scripts/check-wreck.mjs` (level-6 cases only)).
9. Agents' "still weak" lists are to-dos for IA / IB, not disclaimers (CHECKLIST).
10. After ANY `npm run voice`, re-set `manifest.lines.l4_sunde_8.lead = 0.08` (3c W9 note). Line `cut`s are in FILE
    time incl. `lead`.
Models: **Opus** (spawned explicitly) for design-heavy work; **Sonnet** only for small, tightly specified tasks (W2a, W9).

```
              ┌─ W1  player: wading, grip, removeKey, rescue, raycastSolid (player), hitRate, check-water ─┐
              ├─ W2a ui: grip meter, loader pips, key names, cards (Sonnet) ─────────────────────────────┤
              ├─ W2b audio: ids, phone fx, ambiences, boss music layer, ping ─────────────────────────────┤
 K ───────────┼─ W3a loader body + rig + marks + death anim ───────────────┐                                │
 contract,    ├─ W3b loader behaviour + BossControl + patrol (manager) + check-loader ─┤                      │
 chain,       ├─ W3c enemies in water, climb, sinking, patrol walk, flood-lit, raycastSolid (enemies) ─┤      │
 physics:     ├─ W4a greybox, doors, phases, cover, interactables, markers, stairs, trench ─┤──► LOADER-IN-MOTION REVIEW
 2 sets,      ├─ W4b water, dock arena, nav obstacles + wade, check-reach hazard / arcs ────┤    (W1 + W3a + W3b + W3c + W4a + W4b)
 raycastSolid,├─ W5  materials + screens ──────────────┤                                    └─► perf view (9) on greybox
 killY,       ├─ W6  fx: well, wake/splash, viewport cut, raycastSolid (fx), fxleak 6 ─┤          (W3a + W3c + W4a + W4b)
 requireRegion├─ W7  set pieces (switch, beach joint, frame, ladders, console, phone, feed set) ─┤
 stubs        ├─ W8  kit6 props ───────────────────────┤        wave 2 ─► D1, D2, D3a, D3b, ST-a, T ──► ST-b ──► IA ─► IB ─► user
              └─ W9  voices (aas designed-whisper audition + pick) (Sonnet) ───────────────────────► (IA: check-voice-level)
  merged before this plan's build: stage 3c in full + its integration.
```

| id | task | model | files owned | inputs | done when |
|---|---|---|---|---|---|
| **K** | contract + chain + stubs (§8.1): physics two sets, `raycastSolid`, `setKillY` + `Level.killY`, `Interactable.requireRegion` (registry pick honours it), `EnemyManager.patrol` / `boss` stubs; verify the 3c assumptions (rule 7) | Opus | `src/core/types.ts`, `src/core/progress.ts`, `src/core/debug.ts`, `src/core/interactables.ts`, `src/physics/physics.ts`, `src/main.ts` (kill height wiring only), `src/story/stage/base.ts` (`groundY` only), `src/story/save.ts`, `src/story/chain.ts`, `src/story/index.ts`, `src/story/camera.ts`, `src/level/index.ts`, stubs `src/level/l6/{index,dock,water}.ts` + `src/story/l6/index.ts`; placeholder lines (`// K placeholder`) in `src/enemies/index.ts`, `src/enemies/manager.ts` (`boss` null, `patrol` teleport + hold), `src/audio/voicefx.ts`, `src/player/index.ts` (`grip` stub, `removeKey`, `wading` 0, `gripProgress` −1), `src/ui/index.ts`, `src/materials/screens.ts`, `src/materials/defs/index.ts`, `src/level/assemble.ts` (`water` `[]`, `dock` null, `killY` −30), `src/level/l5/cover.ts` (`enabled: true` only); `scripts/lib/check-common.mjs`, `scripts/check-chain.mjs`, `scripts/check-physics.mjs` (new), `scripts/levelgrep-allow.txt`, `package.json` (`play:l6`, `check:loader`, `check:water`, `check:physics` via `optional.mjs`), `docs/CHECKLIST.md`, `docs/plans/stage-3d-agent-rules.md`, `docs/plans/stage-3d-k-notes.md`, this plan (citations only) | this plan, main with 3c | typecheck + build; `check:chain` green incl. `?next=5:6` (the 5 → 6 card is 3c ST's; K only tests it); `?level=6` boots the stub; `check:physics` green; L1–5 playthrough defaults green (the kill height −30 unchanged there) |
| **W1** | player (§8.3): wading, grip, `removeKey`, the deep-water rescue, rays stop at water (weapon side), footsteps / `canStand` on `raycastSolid`, `debug.hitRate`, key names data | Opus | `src/player/**`, `scripts/check-water.mjs` | K | `check:water` green (incl. the walk-out from every water cell, the rescue); `check:weapons` unchanged; L1–5 palm scans unchanged |
| **W2a** | UI (§8.13): grip meter, loader pips (incl. the shake on a 0-damage hit), key strip names, `phone` subtitle class, `END OF CHAPTER 3` card | Sonnet | `src/ui/**` | K | ui dev harness: meter, pips (foreman unchanged), key names, cards; `check:cards` |
| **W2b** | audio: every id of §8.12 not marked "exists" (incl. `armour_clank`, `drown_rescue`); `phone` fx + POS; `pa_dock` POS; ambiences; room presets; the boss music layer; the ping | Opus | `src/audio/**` | K | audio dev page plays every id and fx; `check-voice-level` unaffected on L1–5 |
| **W3a** | loader body, rig (§5.6.2), marks, floods (lights via `ctx.render.lights`), death animation, LOD | Opus | `src/enemies/loader/{model,rig}.ts`, `src/enemies/dev/loader.{html,ts}` | K, W5 (fallbacks until then) | dev page: every part moving, jaws / rams / cowl, marks cyan → red → out, death into a well; ≤ 14 calls |
| **W3b** | loader behaviour (§5.6.3–5.6.9), `LOADER_TUNING`, `BossControl` + `boss()`, `boss:stage`, registration + pre-warm (when `enemySpawns` hold a `loader`), `debug.loader()` incl. `parts[].pos`, the **manager** lines: `patrol` (delegates to the soldier), **no wreck box in water deeper than 0.6 m** (B6), `StubLoaderRig`, `check-loader` | Opus | `src/enemies/loader/{loader,tuning,stubrig}.ts`, `src/enemies/index.ts`, `src/enemies/manager.ts`, `scripts/check-loader.mjs` | K, the rig interface (stub until W3a) | `check:loader` 1–15 green; L1–5 enemies unchanged (foreman playthrough) |
| **W3c** | enemies in water (§8.4): nav `wade` costs, `pose: 'climb'` (kinematic), bodies sinking in deep water, the patrol **walk** in the soldier, flood-lit soldiers, `CoverPoint.enabled`, `raycastSolid` in `nav.walkable` / `ai.groundAt` | Opus | `src/enemies/nav.ts`, `src/enemies/ai.ts`, `src/enemies/husk/husk.ts`, `src/enemies/soldier/{soldier,cover}.ts`, `scripts/check-soldier.mjs` (level-6 cases) | K, W4a/W4b's water + ladders (stub data until then), 3c's soldier merged | `check:soldier` incl. level-6 cases; `check:nav all` green; L1–5 nav hashes unchanged |
| **W4a** | greybox §2 (rooms, doors, walls, decks, the closed shaft well, the coaming + guards, the cage, stairs, the trench with 3c's floors-below mechanism and the under-wall crossing), phases §3, cover §5.4 + self-test, interactables §8.5 (with `requireRegion`), markers §8.11, `level.killY = −36`, dressing stubs; imports `buildWater6(L)` / `buildDock6(L)` from W4b's files (K stubs them first) | Opus | `src/level/l6/{index,grey,phases,cover}.ts`, stubs `src/level/l6/{tunnels,headend,vault,pool,shaft,dockdress}.ts`, `src/level/context.ts`, `src/level/assemble.ts` | K | `check:doors --level 6`; zfight clean; `selfTest` (cover, markers inside rooms, use points off colliders); a scripted route walk (one frame per room) |
| **W4b** | water volumes + `rayOnly` quads (§2.9), `Level.dock` (slots, `target` with the footprint / lane tests, no-slam, rails, park; non-walkable container boxes), nav obstacles (six slots, the wet-dock band, the coaming, the shaft well), nav `wade` on nodes, `check-reach` changes (§10.2: lowest point, hazard on every step, arcs from every surface, `requireRegion`, the trench row, B_hold), `check-nav` level-6 cases | Opus | `src/level/l6/{dock,water}.ts`, `src/level/nav.ts`, `scripts/check-reach.mjs`, `scripts/check-nav.mjs` | K; W4a's rooms (merged first or read from its branch) | `check:reach --level 6` A … K_end green incl. the hazard rule, and `check:reach all` + `check:nav all` once; `check:nav --level 6`; slots ≥ 6.5 m from the coaming |
| **W5** | materials + screens (§8.8) | Opus | `src/materials/**` | K | dev gallery under lit / red / flood-only; screen states |
| **W6** | fx (§8.6) + `check:fxleak --level 6`; `fx/index.ts` floor planes on `raycastSolid` | Opus | `src/fx/**`, `scripts/check-fxleak.mjs` | K | fx dev scenes (the well from above, wakes, splash, cut cable, the window shape); fxleak levels 3 … 6 |
| **W7** | set pieces (§8.7) incl. the sliding enclosure doors, the 2.6 m cage, ladder gates, the feed set and the feed spike | Opus | `src/level/l6/setpieces6.ts`, `src/level/dev/setpieces6.{ts,html}` | K, W5 (fallbacks) | dev page: every method (crank, enclosure, loom rip, frame pin / pump / fire with the tether whip, ladders + gates, phone cord, console pages), the feed spike measured; calls as stated |
| **W8** | kit6 props (§8.8), incl. the bracket shelves and tool shelves the pickups sit on | Opus | `src/level/l6/kit6.ts`, `src/level/dev/kit6.{ts,html}` | K | dev page: every prop ≤ 2 calls, the breakable lamp, the drum's ratchet |
| **W9** | voices: `aas` as a **designed whisper** (§6.1, S12: whispered refText, ASR on every seed, similarity against the other designed whispers and `reyes` / `choir` / `halvorsen`), provisional pick; `lines.l6.json` = §6.2 verbatim (id, speaker, label, text, spoken, note, fx, `cut` for `l6_kes_he_3` from ASR word times and for `l6_aas_3` = `start("boat") + 0.10 s` checked on the waveform, both in file time); generation | Sonnet | `voice/cast.json`, `voice/lines.l6.json`, `voice/manifest.json`, `voice/auditions/aas*`, `public/voice/l6_*` | this plan | `voice:check` green; both `cut`s inside their files; the pick and its ASR / similarity measurements in the report; `l4_sunde_8` lead re-set |
| **D1** | dressing + lights: lock6, tun6_a, rep6 (tent, drums), bay6, tun6_b (dark); vignettes `v6_tent`, `tun6_far_out` | Opus | `src/level/l6/tunnels.ts` | W4a, W4b, W5, W7, W8 | perf views (1)–(4); zfight / doors / decals on its rooms; `check:dark` tunnel views |
| **D2** | dressing + lights: he6, vault6 (drums, enclosure, penetrator, dehumidifiers), the trench + reward, hold6; vignettes `v6_handset` (level side), `v6_drum`, `v6_ring`, `v6_thud`, `bj6_*`, `ping6` machine | Opus | `src/level/l6/headend.ts`, `src/level/l6/vault.ts` | W4a, W4b, W5, W6, W7, W8 | perf views (5), (6); `check:dark` trench views; frames of each scare |
| **D3a** | the chamber's structure look, decks, galleries, stairs, coaming + guard look, wet dock, water surfaces (with W6), sea windows, rails + festoon, lights and groups (`lights_out6`), emergency strips, slots' paint | Opus | `src/level/l6/pool.ts` | W4a, W4b, W5, W6, W8; **the loader review and perf view (9) numbers** | perf views (8)–(10) in budget; `check:dark` pool views; fxleak for the well / sea / wake; zfight; `check:reach` hazard re-run (any prop) |
| **D3b** | the chamber's dressing (containers dressed, pumps + tool shelves, console placement, the cage dressing, signs, the dock board, the undercroft panel, the dock lockers' look), the shaft (lamps, strips, cabinet, mesh guards' look), stores6, the feed set's placement, vignettes `v6_shaft_lights`, `v6_well_eyes`, `v6_window`, `loader_dead6:snap` | Opus | `src/level/l6/shaft.ts`, **`src/level/l6/dockdress.ts`** (renamed — `dock.ts` is W4b's, S8e) | W4a, W4b, W5, W6, W7, W8, D3a's file read-only | perf views (7), (11); frames of each scare; `check:dark` shaft views; `check:reach` hazard re-run |
| **ST-a** | story level 6, the route (§4.1–4.7, §5.7, §6, §7 flags replay, §8.10 minus the boss): keys + flags, grips, scares, Q, the handset, the carry; the level-6 `calm()` (holding via `holding()`), stray rule; stubs `boss.ts` / `scenes.ts` for ST-b; a diff for `check-voice-level` | Opus | `src/story/l6/{index,script,dialogue,text}.ts` + the two stubs (then handed to ST-b) | K, W4a (markers), 3c's stage-base pattern | `play:l6 --contract` + default (to the reveal) + `--checkpoints` (to `cp6_shaft`, incl. the B4 case) green on the greybox, both choices |
| **ST-b** | story level 6, the boss and the end (§4.8–4.9, §5.5, §5.6.9, §7.1): stages, waves + twins + latest-only restore, milestones with `checkpointNow`, the lockers and the ammo top-up, the shear, the quiet, the cutscene, the feed | Opus | `src/story/l6/{boss,scenes}.ts` | ST-a merged, W3b `BossControl` (stub until it lands — logged) | `play:l6` default to the end + `--checkpoints` (boss cases incl. B5) + `--boss` (stub rig acceptable for the logic) on the greybox |
| **T** | tests: `playthrough-l6.mjs` (§10.1, **`--contract` first**, `--boss`, `--dry`), `check-dark.mjs` level 6, the level-6 cases of `check-cutscene.mjs` and `check-wreck.mjs` (S8f) | Opus | `scripts/playthrough-l6.mjs`, `scripts/check-dark.mjs`, `scripts/check-cutscene.mjs` (level-6 case), `scripts/check-wreck.mjs` (level-6 cases) | §10.0 (not ST's code); ST's greybox to run | all modes run; failures listed with the hook / beat that failed |
| **IA** | integration — logic, tests, sound: `LEVELS[5].next = 6` (3c → 3d live; `play:l5` through it); dressing + story + enemies together; every `play:l6` mode on the DRESSED level incl. `--boss` and `--dry`; `--scares` owner audit; arrival times measured; `check:dark` thresholds calibrated (never below §10.4); ST's `check-voice-level --level 6` diff applied and passed (incl. Aas's ASR pass); full CHECKLIST levels 1–6; DESIGN.md REVISION 11 (D5, D12, D15, D16, D18, D31, D32, the two-door cargo lock canon) | Opus (coordinator) | everything for fixes | all wave 2 | CHECKLIST green |
| **IB** | integration — look and performance: every perf view on LOW / MEDIUM in budget (report HIGH); the reveal as a hero frame; the loader reading as a crane, not a creature; the 2.4 m guards reading as a moon pool's railing (bars, not a wall); the dark fight readable by floods and strips; the water reading as cold and deep; the windows; the ending frames; walk every room lit and dark in frames | Opus | everything for fixes (after IA's merge) | IA | frames looked at; budgets met; `check:dark` levels 3 … 6 green; user hand-play |

Ownership check (disjoint, per wave): **K** alone first. **Wave 1** — `src/player/**`, `check-water` W1; `src/ui/**` W2a;
`src/audio/**` W2b; `enemies/loader/{model,rig}`, `enemies/dev/loader.*` W3a; `enemies/loader/{loader,tuning,stubrig}`,
`enemies/{index,manager}.ts`, `check-loader` W3b; `enemies/{nav,ai}.ts`, `enemies/husk/husk.ts`,
`enemies/soldier/{soldier,cover}.ts`, `check-soldier` W3c; `level/l6/{index,grey,phases,cover}` + the six dressing stubs,
`level/{context,assemble}.ts` W4a; `level/l6/{dock,water}`, `level/nav.ts`, `check-reach`, `check-nav` W4b; `src/materials/**`
W5; `src/fx/**`, `check-fxleak` W6; `level/l6/setpieces6.ts` + `level/dev/setpieces6.*` W7; `level/l6/kit6.ts` +
`level/dev/kit6.*` W8; `voice/**` (listed) W9. No file has two owners in wave 1 (the patrol member: W3b owns the manager
line, W3c the walk; ground queries: each in its owner's file, §8.1). K's placeholder lines pass to W1 (`player/index.ts`),
W2a (`ui/index.ts`), W2b (`audio/voicefx.ts`), W3b (`enemies/index.ts`, `manager.ts`), W4a (`assemble.ts`, `level/l6/
index.ts`), W4b (`level/l6/{dock,water}.ts`), W5 (`materials/*`) after K merges. **Wave 2** — `tunnels.ts` D1, `headend.ts` +
`vault.ts` D2, `pool.ts` D3a, `shaft.ts` + `dockdress.ts` D3b, `story/l6/{index,script,dialogue,text}` ST-a (+ the two
stubs until ST-b), `playthrough-l6` + `check-dark` + the level-6 cases of `check-cutscene` / `check-wreck` T; then **ST-b**
`story/l6/{boss,scenes}`. Wave 1 = 13 parallel tasks; wave 2 = 6, then ST-b.

**Run gates** (speed + risk):
1. After K — `check:chain`, `check:physics`, `play:l5` default.
2. After W4a + W4b — `check:reach` (incl. the hazard rule on every step and the arcs) / `check:nav` / `check:doors` level 6
   plus `check:reach all` + `check:nav all` once; `check:water` on the greybox once W1 is in.
3. **After W1 + W3a + W3b + W3c + W4a + W4b: the loader-in-motion review** on the greybox chamber (frame sequences of every
   attack, window and the W2 climb, `check:loader`, the coordinator plays it with wading): `LOADER_TUNING` confirmed or
   retuned **before D3a / D3b start** — the stage's risk.
4. **After W3a + W3c + W4a + W4b: perf view (9) on the greybox** with the loader and six enemies (shadow passes counted;
   one flood shadow on MEDIUM only if it fits) → D3a / D3b get the real room budget.
5. After ST-a on the greybox: `play:l6 --contract` + default to the reveal + `--checkpoints` to `cp6_shaft`; after ST-b:
   default to the end + boss `--checkpoints` + `--boss` (stub rig acceptable for the logic).
6. After the D-tasks: their perf views, `check:fxleak`, `check:dark`, `check:zfight`, the `check:reach` hazard re-run.
7. IA everything once; IB frames; then the user's hand-play. No review for W2a, W2b, W5, W6, W8, W9.

---

## 12. Review focus — still open

1. **The loader's fairness and feel** (§5.6.4–5.6.6): the numbers are a starting point (foreman-derived: telegraphs ≥ 1.4 s,
   damage 30–40); the loader-in-motion review decides. Fallbacks: lock 1.0 s, recovery 3.0 s, one fewer flood.
2. **Boss checkpoints** (D21, §7.1): the latest-only twin scheme was checked by the reviewer against `base.ts` /
   `page.ts` / `manager.ts` and holds; still to feel: the health floor of 60 and the ≥ 90 reserve top-up — generous by
   design, confirmed or trimmed at the hand-play.
3. **The chamber's budget** (≤ 300 calls with the loader, six enemies, two water surfaces, the viewport and the well fx;
   the floods non-shadow below HIGH): measured on the greybox before dressing; fallbacks: the viewport's march steps to 3
   on LOW, the well's snow off on LOW, enemies LOD1 at 10 m.
4. **The feed** for E2 (a live `render.feed` of a void set vs the `cctv` canvas): decided by W7's spike.
5. **The 2.4 m guards' look**: a moon pool with a head-high bar railing must still read as open water from the dock (bars,
   no mid-rail, the coaming's hazard paint) — judged in IB's frames.

---

## 13. Changes after review

Review: `docs/reviews/stage-3d-review.md` (verdict "build after fixes", read against e8373e2 with 3c's K merged).
Coordinator decisions 1–6 applied as final. **§13 wins** wherever an older sentence still disagrees. Every item was
applied as the reviewer proposed unless the row says otherwise.

| item | change (where) |
|---|---|
| **B1** the well's barrier is not one (coaming ledge, exit rungs, wreck steps; the check blind below y −5) | Coordinator 1 (option a): a **1.6 m vertical-bar guard flush with the coaming's outer face** (no mid-rail) = 2.4 m above the dock, 3.2 above the wet floor; ladder gates as high; the exit rungs **visual only**; the mid-deck bar guard **2.4 m**; the cage **2.6 m with a bar roof at −13.4**; containment rule in the conventions ("2.35 m above any floor where a body can lie; 1.75 m only where none can"). `check:reach` (W4b): simulation to the level's lowest point (−36, not −5), hazard regions tested **on every simulated step**, jump-arc probes from **every** standable surface with the +0.6 m wreck stress, no "above −18.6" limit. The reviewer's optional `noWreck` band is **not** adopted as a barrier layer (the 2.4 m guards hold with a corpse); the manager's no-wreck rule is used only for deep water (B6). D12, conventions, §2.6.9, §2.10 (recomputed with g 19), §10.2. |
| **B2** the loader is a lift | Containers and the grab are **non-walkable** dynamic boxes (`CargoHandle.box`), the grab boxed only while < 2.5 m above a deck; the loader never lifts with a body on its load (waits, then a 2 m/s shove); container-top rows removed from §2.10; `check-loader` 6b. §2.6.9, §2.6.10, §5.6.4, §8.1, §5.6.10. |
| **B3** the sluice channel is a pit | The channel's south side is a **slope** z −185.5 → −184.0 (−20.8 → −21.3, 18.4°); the flat floor ends at −185.5; `check:water` walks a bot out of every water cell in ≤ 10 s. §2.6.9 decks table, §2.9, D13, §8.3. |
| **B4** Key A spent, calm save, death → soft-lock | Flag **`bjOpen`** set in the same action as `removeKey('key6_a')`; §7 rewritten: **every restore replays every flag's world consequence**, by flags, not by checkpoint id; `cp6_manual` valid only while `!bjOpen && !pulled`; `--checkpoints` B4 case; order case #36. D5, §4.6, §7, §10.1. |
| **B5** a boss restore with no ammo | Every boss restore **tops the carbine (or the best owned weapon) to ≥ 90 reserve** and re-arms three **dock ammo lockers** (`locker6_e`, `_w`, `_n`: story interactables, so `PlayerSave.pickups` never removes them); `--checkpoints` B5 case; order case #39. D21, §2.6.9, §5.2, §5.3, §5.6.9, §7.1, H19. |
| **B6** the kill-plane at y −30 inside the level | K: **`physics.setKillY(y)`** + `Level.killY` (−36 here, −30 elsewhere), tested in `check:physics`. W3c: a body dying or spawned in water deeper than 0.6 m sinks at 0.6 m/s without `moveBody`, removed at −26; climbers kinematic from spawn to exit. W3b: no wreck box in water deeper than 0.6 m. W1: held at ≤ 0.5 m/s sink in deep water, then the rescue (coordinator 2). §8.1, §8.3, §8.4, order case #41. |
| **S1a** `mk6_he_s` in R1 | → (12.0, 0, −162.0). §4.4, §5.1. |
| **S1b** pickups the player cannot take | The as-built pickup rule written into the conventions; §5.2 rewritten as a table (item, surface, distance to the face, stand point): JB / RH items on bracket shelves at y 1.0; NR and P1 / P2 items on face shelves; LC2, MC1, MC2 and console items at their approach edges (≤ 0.3 m). §2.6.2–2.6.9, §5.2. |
| **S1c** the 2nd W2 climber too slow | Spawned at y −24.4 (6.6 s to its exit); tests: ≤ 6 s first, ≤ 7 s second. §5.1, §8.4. |
| **S1d** slot layouts | C(6,4) = 15. §5.6.10 #6. |
| **S1e** dock nav grid over the wet dock and the well | Nav obstacle boxes in the dock band only (y −19.25 … −18.5) over the wet dock and the coaming footprint. §2.6.9, §10.3. |
| **S1f** `hatch6_vault` hinge | South edge. §2.6.7. |
| **S1g** grille G1 on the route | G1 → (−12.4, 0, −174.0); every grille drops shut 1.2 s after its skitter; snap = shut. §2.6.7. |
| **S1h** the console screen's position | Above the desk's north edge, plane z −157.9; `mk6_end_screen` (−44.0, −14.2, −157.9): 1.5 m from `cam0`, 1.1 m from `cam1`. §2.6.9, §4.9. |
| **S1i** shaft L0's open east edge | Covered by the closed well (S7): mesh guards over L0's and L2's north edges on the east half. §2.6.8. |
| **S1j** enclosure leaves sweep the player | **Bi-parting sliding doors** in a guide channel along the face — no sweep. §2.6.7, §4.6. |
| **S2a** which wave comes back | **Latest only**; a pending wave re-queued under its own rule; a dead one stays dead. §5.5, §5.6.9, §7.1, D21. |
| **S2b** W1's twin needs the stores door | The restore re-applies K_stores and its latch for `g6_w1_r`. §5.5, §5.6.9, §7.1. |
| **S2c** the safe marker beside W3's door | Restore point per latest wave: W3 → `mk6_boss_safe_w` (−74.3, −12, −170.0), yaw −90; otherwise `mk6_boss_safe`. §5.5, §5.6.9, §8.11. |
| **S2d** milestone saves | Written with **`checkpointNow`**; during a grip **deferred** to its end + 1.0 s, never skipped. D21, §4.8, §5.6.9, §10.1. |
| **S2e** the loader in `cleared` after death | Stated: harmless because `loaderDead` → `removeSilently` runs first. §5.6.9, §7.1. |
| **S2f** calm override | Uses the merged `EnemyManager.holding(group)`. §5.6.9, §7.1. |
| **S3** attrition cheese from the cage / galleries | Coordinator 4: retracted rams and the shut pod take **0** (a distinct `armour_clank`, sparks, the pip shakes); rams extend only in a slam's lock and recovery and in a clamp / release **on the player's own deck**; SHIFT / DROP "near" measured on his deck; GUARD parks at (−52, −8, −186), far from the cage's line; `check-loader` 15 and `--boss`: a bot in the cage / on a gallery deals 0 in 120 s; order case #37. D11, §5.3, §5.6.4–5.6.6, §5.6.10. |
| **S4** scare spacing eats the shaft beat | `v6_shaft_lights` and `v6_well_eyes` exempt from spacing (only "once" and "calm"); `v6_thud` only in vault6 / he6, only within pull + 20 … + 90 s and before Key B (else never); `--scares` asserts the shaft beat on the default route. §4.6, §4.7, §4.8, §5.7, §10.1. |
| **S5** water as a floor for ground queries | Physics keeps **two sets** (rays = solid ∪ rayOnly; moves = solid ∪ moveOnly); **`physics.raycastSolid`** for every ground / headroom query, assigned per file (W3c `nav.walkable` / `ai.groundAt`; K `base.ts` `groundY`; W6 fx floor planes; W1 footsteps / `canStand`); `SURFACES += 'water'`; `check:physics` cases. D14, §8.1, §8.3, §8.4, §11. |
| **S6a** nav ignores moved containers | All six slot boxes are permanent nav obstacles, occupied or not; a `check:nav` case. §2.6.9, §8.4, §10.3. |
| **S6b** the grab's footprint | `Level.dock.target` checks the grab box at its lowest (and SWING lanes, SHIFT set-downs) clear of every collider but the deck. §5.6.4, §5.6.7, §8.1. |
| **S6c** slam occlusion | Damage only with a clear ray from the grab's bottom centre to the player's chest. §5.6.4, §5.6.10 #1. |
| **S7** the shaft's open well | Coordinator 5: **closed** with 2.4 m move-only mesh guards (2.4 not the reviewer's 1.8, so a corpse on a landing is no step over it — the B1 rule). D32, §2.6.8, §4.7. |
| **S8a** no patrol API | **`EnemyManager.patrol(group, points, { speed, light, end: 'hold' })`** is a required member added by 3d's K (stub: teleport + hold); W3b the manager line, W3c the walk; used by `v6_crossing` and F3's walk-out (a real soldier, never an actor). Header table, §4.2, §4.4, §8.1, §8.4. |
| **S8b** `cast.soldier` | `false` in `LEVELS[6]`. §8.1. |
| **S8c** `emerge` vs `pose` | `EnemySpawn.pose: 'climb'` everywhere. D26, §5.1, §8.4. |
| **S8d** `--boss` / `--dry` hooks | H15 gains `parts[id].{hp, pos, mult}`; new H18 `hitRate(k)` (`player.debug.hitRate`, W1). §8.3, §10.0, §10.1. |
| **S8e** `dock.ts` with two owners | D3b's file renamed **`dockdress.ts`**; `dock.ts` is W4b's. §11. |
| **S8f** unowned tests | The level-6 cases of `check-cutscene.mjs` and `check-wreck.mjs` belong to **T**. §10.4, §11. |
| **S8g** `check:reach` and feet-gated use | `Interactable.requireRegion` (contract data, honoured by the registry's pick and by `check:reach`); `frame6_*` use `'t6_cage'`. §2.6.9, §3, §8.1, §10.2. |
| **S9** ammo accounting | Budget restated in **hits** (main route 201, arena 105 = 210 rounds at 50 %); a third dock locker on the north gallery (+60); the arena holds 300 + 60 drops = 360 (1.71 ×). §5.2, §5.3. |
| **S10a** B-14's two dispatch times | **Coordinator 6: B-14 is lowered now and is "in transfer"**: `note6_transfer` `B-14 CYCLE START {reveal}`, `CARGO LOCK: AWAITING SEALED CYCLE`; the manifest `B-14 … IN WELL`, `DISPATCHED 2,880 · IN TRANSFER 240`; the dock board `IN WELL — AWAITING LOCK CYCLE`; `note6_queue` (read earlier) still `QUEUED`; Kessler's `_end_1` / `_1b` say thirteen went and the fourteenth is down the well; Sunde's "three thousand" stands (3,120). D15, §1 canon, §4.8, §4.9, §6.2–6.4. |
| **S10b** sea gate vs chamber pressure | The well's floor is the **inner door of a two-door cargo lock** (inner door, lock chamber, outer sea door); the wet dock is the well's overflow. §1 canon, §2.6.9. |
| **S10c** "sixty-one hours" | `l6_choir_dark_command` → "We have worked in the dark since Monday, Supervisor. You never asked." §6.2. |
| **S10d** `launchAt` before the thud | The thud fires only within pull + 20 … + 90 s (and before Key B); otherwise none and `launchAt` = pull + 90 s. D16, §4.6, §5.7. |
| **S10e** Kessler would know the sound | `l6_kes_thud` → "...What was that? ...That's from my end. That's the bay." §6.2. |
| **S11a** the OSD names nobody for a skipper | New **`l6_kes_end_4b`** "...That's my XO's palm." (C: not `heard(l6_aas_2)`); E2 ≈ 17.3 s. D18, §4.9, §6.2. |
| **S11b** queue lines' order | §4.5 now plays `l6_reyes_queue` → `l6_kes_queue` → CHOIR, as §6.2. |
| **S11c** `l6_kes_he_contact` in the vault | New **`l6_kes_he_contact_b`** "Movement in the cable store. Behind you." (player in vault6). §4.5, §6.2. |
| **S11d** handset and grip both need hands | A grip start drops the handset (`handset_drop`), the call goes on positional. §4.5, §8.3, order case #40. |
| **S11e** the ending's wait | The quiet's `fightOutWhere` and the ending's precondition use 3c's stray rule and cover the whole level. §4.8, §4.9. |
| **S12** the Aas voice | His **base reference is a DESIGNED whisper** (short describe + `whispering` + a whispered refText, auditioned; never a description alone, never DSP / `derive`); **ASR on every audition seed**; similarity also against the other designed whispers (`tomas:whisper`, the female whisper at `cast.json:88`); the `l6_aas_3` cut = `start("boat") + 0.10 s` checked on the waveform, in file time; an ASR-intelligibility pass on the held take in `check-voice-level`; the "no new voice" fallback **removed** (decided). D18, §6.1, §6.2, §8.14, §10.4, §11 W9, §12. |
| **S13** performance | The floods are **non-shadow on LOW and MEDIUM** (FL1 / FL2 cast on HIGH; one on MEDIUM only if the greybox gate measures it in budget); husks counted at ≈ 29 calls with shadows; the floods out-rank soldier weapon lights in the pool and `floodLit` counts only a flood whose light is in the pool; the undercroft's point is `all` (the refuge exists on LOW). D24, §2.7.1, §2.7.2 (h), §2.7.5, §8.1, §5.6.10 #9. |
| note: R4 and the loader | **Coordinator 3:** the loader is **spawned when Key B turns** (D31), not at load; `afterReplay` spawns it whenever `shaftOpen && !loaderDead`. §3, §4.8, §5.1, §5.6.1, §7, §9. |
| note: concealment margins | F2's soldier → (10.2, 0, −111.6); F6's spawn → (−26.8, −12, −162.8). §4.3, §4.7, §5.1. |
| note: winch hood | No longer cited as a barrier (its ridge is standable; harmless at 15.6 m). §2.6.9, §2.10. |
| note: stage-3 speeds | Bridge × 1.5, trolley × 1.4. §5.6.5, §5.6.6. |
| note: DROP fall | 0.69 s under g 19. §5.6.4, §5.6.6. |
| note: end card text | `END OF CHAPTER 3` everywhere. §7.2. |
| note: `stand` field | In the §2.9 water table (1.25 for both). |
| note: under-wall trench crossing | Done by 3c's built way (K verifies); a `check:reach` row walks T-b → T-c. §2.6.6, §10.2. |
| note: task sizes | W4 split into **W4a** (rooms, doors, phases, markers, interactables, cover) and **W4b** (water, dock arena, nav obstacles + wade, the check-reach / check-nav changes); ST split into **ST-a** (the route) and **ST-b** (`boss.ts` + `scenes.ts`, after ST-a). §8.10, §11. |
| note: the loader-in-motion gate | Now needs W1 + W3a + W3b + **W3c** + W4a + W4b (it reviews the W2 climb and enemies in water). §11. |
| note: `hold6` latch | A `B_hold` row in `check:reach` with hold6 neither forbidden nor goal. §3, §10.2. |
| **3c alignment** (merged since the draft) | The header table now marks each 3c interface **merged** (K contract: `soldier`, `release`, `holding`, `corpsePoint`, `cast.soldier`, `floorAt`, `RoomFloor.nav` / `exits`, `keypadInput`, `ProgressL5`; W2a UI: radio strip, keypad; W9 voices: 72 lines, Kessler provisional pick, `cut` in file time with `lead`, the `l4_sunde_8` lead caveat) or **assumed** (soldier body / AI, greybox floors below the main floor, hatches, fx tracers, props, the story's scare kit and radio / Q handling), and K verifies every assumed one before wave 1 (§11 rule 7). The direct start is written in `DirectLoadout` terms (12 + 24, 6 + 6, 30 + 90 → lands 12 / 36, 6 / 12, 30 / 120); the flashlight cell is not carried (it starts full); `ProgressL6` extends `ProgressL5`; §11 rules copied from `stage-3c-agent-rules.md` plus rule 10 (the `l4_sunde_8` lead). |

Classes the 3b and 3c reviews attacked, handled up front in the draft (kept):

| class (review item) | where handled |
|---|---|
| 3c B1 — a holding / restored group deleted by the stage base; a death before a key item | D5 atomic keys; §7.1 (loader and boss waves never in `triggered`; twins); keys in `PlayerSave` |
| 3c B2 — an interaction ray ending in a collider | every use point 0.4–0.5 m off its surface (§2.6); the frame's feet rule (§8.5) because bars pass rays |
| 3c B3 — a check that rejects a correct player | `grip`: no look requirement after the start, damage pauses only, progress kept, live meter (§8.3) |
| 3c S1a / S1c — inverted cover normals, tangent capsules | §5.4 with each object's face; 0.55 m and ≥ 0.1 m from walls; the tunnels' trays start at y 2.0 so points at x ±1.85 are clear |
| 3c S1i — pickups in racks / out of reach | §5.2 shelves with stand points; all in `check:reach` `use` |
| 3c S1m — nav over a hole | the closed shaft well, both hatch pits, the coaming, the six slots, the wet dock's band, water > 0.6 m: no nodes |
| 3c S1n — a stand-off on the only route | trench exits off the routes (§2.6.7) |
| 3c S2 — lines and beats assuming an order | §4 conditions; `_he_2b`, `_pool_2b`, `_end_1b`, `_cut_loader` vs `_loader_dead`; §9 #8–#12 |
| 3c S5 — lights through floors, voice level | bounds by floor (§2.7); `phone` and `pa_dock` POS profiles measured (§8.14) |
| 3c S6 — contradicting fiction | the bodies are Halcyon contractors (roster untouched); Kessler never claims a camera; the OSD names Aas whatever was heard |
| 3c S7 — TTS delivery | two uppercase stresses for Kessler, none for UNIT / soldiers; `cut`s from ASR; hesitation written into the words |
| 3c note — the arena budget | perf view (9) on the greybox before dressing (§11 gate) |
| 3b B1 — door leaf faces | §2.2 column for all 8 doors |
| 3b S8 — sandwiches | the chamber's wave cap (6) and W3 waiting; waves sequential by step |
| 3b integration — sounds owned twice, waves that walk, tests written blind | D25 / §8.12, D26, §10.0 first |

Arithmetic re-checked after review (the reviewer's method, the controller as built: gravity 19, take-off 6.16 m/s,
apex 0.324 s, ground accel 11, crouch-jump 1.7 m, sprint 6.0 m/s, the pickup rule ≤ 1.4 m above the feet with a clear
chest ray to within 0.4 m): the containment table (§2.10) with the 2.4 m guards, the +0.6 m wreck stress and R(h) for every
standable surface; the channel's slope (0.5 m over 1.5 m, 18.4°); every moved pickup against its surface and face (§5.2);
`mk6_he_s` 2 m clear of R1; F2's soldier at (10.2, −111.6) and F6's spawn at z −162.8 against the review's concealment
rays; the second climber's 5.2 m (6.6 s); the console screen at z −157.9 (1.5 / 1.1 m from the cameras); G1 at z −174.0 off
the door-to-door line (z −168 … −170); the west restore point (−74.3, −12, −170.0) on the west gallery, 1.15 m from its
parapet and 46 m from `d6_pool`; the slam escape (2.55 m in the lock, 2.5 m knee-deep by impact); the arena's ammo in hits
(105 needed, 360 rounds held); E2's length with `_end_4b` (≈ 17.3 s); file ownership per wave (no file with two owners;
`dockdress.ts`). Draft arithmetic that still stands: room plan (§2.1, 12 rooms, touching pairs listed); the eight doors' leaf faces and
pockets (§2.2); the shaft's flights (10 × 0.3 / 0.4, 36.9°; 6.0 m between flights on a half, the doors under landings);
the chamber's stairs (14 × 0.2857 / 0.4, 35.5°, run 5.6 m, landings at y −12); the slots ≥ 6.5 m from the coaming; the trolley's reach to every
slot centre (x −71 / −33) and its 0.6 m clearance to the galleries; every cover point against its face; F1 / F2 / F6 spawn concealment rays (§4.2, §4.3, §4.7); the crawl's
length and battery (§2.6.7); the light pools per worst view (§2.7.2).

