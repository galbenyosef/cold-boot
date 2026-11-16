# Stage 3a "THE QUIET SIDE" — detailed plan (technical level id 3)

Status: **PLAN, amended after review** (`docs/reviews/stage-3a-review.md`) with the coordinator's decisions. This file is
the single authoritative document for building 3a; §12 lists every review item and what changed. Sources: DESIGN.md
R1–R8 (REVISION 5 + 5.1), REVISION 6/6.1, REVISION 7 + 7.1 (7.1 wins), `rev5-review.md`, `rev6-7-review.md`, the code
as of 2a3c73a + working tree. To be copied into DESIGN.md as REVISION 8 (3a) when the build starts.

Conventions as level 2: metres, y up, −Z "forward", yaw 0 looks down −z (`?spawn` yaw in degrees, +90 = −x), room boxes
are interior clear space, walls 0.4 m (0.2 m interior partitions where stated), std door 1.6 × 2.4. In code `wide` is
the vertical blast door (top/bottom leaves); glass sliding doors are `std` with a custom `w`. **Two decks**: Deck 1
floor y = 0, Deck 2 floor y = 4.8. Every Deck-2 coordinate gives y explicitly. Player capsule: radius 0.35, jump 1.0 m,
**crouch-jump clears 1.7 m** (`player/controller.ts:115-119`): only barriers whose collider is ≥ 1.75 m above the
standable surface in front of them count as containment.

---

## 0. Decisions made in this plan

| # | Decision | Why |
|---|---|---|
| D1 | Separate world `src/level/l3/`, `src/story/l3/`, lines `voice/lines.l3.json`; ids `l3_`, doors `d3_`, triggers `t3_`, groups `g3_`, checkpoints `cp3_`. | Same pattern as level 2. |
| D2 | Two decks: one big multi-storey atrium with a Deck-2 balcony plus rooms on both decks. Requires **Deck-2 level infrastructure** (§8.9) and **nav v2** (§8.10). | The level API, doors, triggers, regions and nav all assume one floor at y 0 today. |
| D3 | No two rooms overlap in plan (x/z). The balcony and stair landing are regions inside room `atrium`. | `roomAt` is x/z first-match (`level/assemble.ts:162`). |
| D4 | **One clock, fixed at level start**: arrival is **Wed 22:40 = test hour 62:00**; the test ran from Mon 08:40 for 72 h, so it ends Thu 08:40 ("till tomorrow"). Lobby clock = 22:40 + t; countdown = 10:00:00 − t; report lines derived from it (§6.4). No carried play time. | Coordinator; review H10. Reyes woke at 61 h 04 m (`story/text.ts:34`); levels 1–2 take about an hour. |
| D5 | **CHOIR is silent in the habitat until its line in cutscene 2.** | "There is no longer a reason to be quiet" must land; nothing to order-check before it. |
| D6 | CHOIR **releases the pressure door for Reyes** (panel `RELEASED — CHOIR`), no line. Cause: entering `t3_pdoor` in phase B. | 6.1: Reyes does not cause the breakout; "We will not make you" (`l2_choir_core_14`). |
| D7 | The way back closes twice before any scene: the service lift latches and leaves; the pressure door latches. | 7.1 cutscene precondition; R1. |
| D8 | Cutscenes are **fully non-interactive** (camera, input, HUD taken). First-person only. C1 ≤ 13 s; black 1.6 s; C2 ≤ 30 s, ending with the camera rising from the chair, already turned toward the door, over 1.4 s. No whip-pan, no fov zoom beyond 60 → 52. | User + coordinator. |
| D9 | Skip only after a scene has been seen once on this browser: global `coldboot.seen.v1` (never cleared by BEGIN). Hold SPACE 0.6 s; the key is consumed. Skip applies the scene's end state (same code as checkpoint fast-forward). Deviation from 7.1's "first-view flags as facts" — recorded in REVISION 8. | Coordinator answer Q6. |
| D10 | Surveillance feeds are **live render-to-texture of real geometry with real actors** (CAM 01 the gallery/lock/lobby; CAM 04 one Line Two diorama at y 0, x 60…72). Built as the **first build task (spike)**. **Fallback if the spike fails** its acceptance (§8.4): canvas-drawn CCTV animation (silhouettes on the same paths, timestamp, noise, CAM labels) with the same beats and timings; the real door and the real puppets still move in the world. | Coordinator; review B3, B4. |
| D11 | Units on CAM 01 come out of the lock **after the pressure door is fully open**, walk west and go into the lobby; they stay there as puppets, sealed (`d3_lobby` locked, `d3_lobby_inner` locked, solid), and are **promoted to `g3_admin`** when the player has left the office: `d3_lobby_inner` opens and they come through. | Continuity; R2 (puppets only with no control or behind a real seal); R4; review H8. Replaces the riser (B6). |
| D12 | At the takeover the pressure door **shuts and locks** (`SECTOR SEALED`). `g3_breach` is spawned **inside the lock** (windowless) at `l3_breach`; the pressure door then opens, they walk through the glazed gallery and the north-east shutter onto the balcony. | Review H1; coordinator. No enemy pops in within view. |
| D13 | Reyes's two lines: `l3_reyes_phone` "I need a phone. Now." (C1), `l3_reyes_come` "Come with me." (C2). | Coordinator Q2. |
| D14 | Halvorsen approved CHOIR's test request; he read Order 0031-H as "prepare transfers to the surface for all fab staff". Readable in his office; he reacts if read. | Coordinator Q3 (complicity stays). |
| D15 | Clasp hints in 3a: the clinic's Post 4 sick-call sheet (the one stronger hint: neck stiffness, "humming", referred to Bio-Sys) and the "returns" crates; the trunk cable through the viewport (3d). | Coordinator Q8. |
| D16 | The habitat has **no service units** (residents' agreement, lobby notice). Every unit in 3a came from elsewhere. | R4; reading. |
| D17 | Sector seal at the takeover: `d3_pressure`, `d3_lobby`, `d3_lobby_inner`, `d3_shutter_ne` lock (`SECTOR SEALED — PRESSURE ALARM`); cabins go red. | Defines the escape route with an in-world cause. |
| D18 | BIO outer lock: badge → **15 s purge** on a fixed clock → opens. The holdout makes the last fight happen without any gate waiting on an enemy. | Rev5 B4; Unit 32 lesson. |
| D19 | Stage end: inside the outer lock with `d3_bio` latched; hostiles that got in are fought out (`fightOutWhere`, §8.13). Then **end card** (`THE QUIET SIDE` / `TO BE CONTINUED`) and the menu. `LEVELS[3].next = null` until 3b exists; adding 3b = set `next: 4` + register `createLevel4`/`createStory4` in the two dispatch maps. | Coordinator B5. |
| D20 | Level 2's ending card stays (without "TO BE CONTINUED"), then automatic hand-over to level 3. | Coordinator Q5. |
| D21 | One save/carry schema v2 for all levels; existing v1 saves are discarded once. | 7.1 B3/B4. |
| D22 | Enemy types: husk and sentry only. 10 husks + 1 sentry. No drop from a gantry (there is no gantry); spawns are behind doors/hatches that visibly open, or in sealed spaces. | Coordinator; review H3. |
| D23 | Weapon is **stowed for the whole of phase E** (anywhere) and raised only when the office latch succeeds; Halvorsen has a body collider. | Review B1. |
| D24 | Balcony edge: 1.4 m real glass balustrade (shows impacts), **no invisible extension**. Crossable by crouch-jump; the fall to the garden (4.8 m) does no damage in this game; every phase that allows the balcony allows the garden. | Coordinator; review H2. |
| D25 | Lights: hold on LOW (6 points, 2 shadow slots) in the worst view. New `LightDesc.minQuality` drops fill lights on low; the lamp grid, the pool light and window spill are emissive-only. | Review H5. |
| D26 | Halvorsen: neutral English, slightly bureaucratic. One extra voice: `resident`. | Coordinator Q1, Q4. |
| D27 | No headcount number on any habitat screen or line. The memo says "all fab staff". | Canon has 31 (intro), 01–31 + Tomas as 32 (`l2/text.ts:79-80`), "32 OF 32" (`:60`): no habitat text may add a new number. |
| D28 | No school corner. | Not answerable in this chapter. |

---

## 1. Fiction and tone (10 lines)

1. The lift opens onto a clean pressure lock; its panel counts down a test with ten hours left. Then CHOIR lets you through.
2. Beyond is the quiet side: carpet, wood, plants, a fountain, warm evening lamps, someone's radio, and a window onto black water 2.1 km down.
3. Nobody here knows. The screens say the fabrication sublevels are sealed, all staff safe, next report at 66:00, signed CHOIR.
4. You may wander: a cancelled fab resupply nobody questioned, the clinic's "remote sedation" entry for REYES, S., a plaque naming the trunk.
5. Halvorsen, night-duty facilities supervisor, opens the lobby door on you: you're supposed to be sealed in till tomorrow.
6. Black. Then his office, you seated: he does not believe you, and to prove you wrong he turns the monitor to your door.
7. The door opens. Units walk out, toward his lobby. Line Two stands dark (or lit and waiting). The phone has no tone.
8. CHOIR, from the speaker in his ceiling, says it plainly; the screens die; the warm habitat goes cold.
9. He gives you his badge and will not come. You walk out through offices, a canteen and a dark garden, past people knocking on red doors.
10. At the BIOLOGICAL SYSTEMS lock the badge buys a 15-second purge with units coming. Tone: ordinary, warm, then wrong; human fear, never melodrama.

| Beat | Knows | Feels |
|---|---|---|
| lift, lock | the test story is still running here | relief, suspicion (who opened it?) |
| quiet side (optional rooms) | nobody here knows; the habitat took CHOIR's word; CHOIR told the clinic it was managing Reyes | warmth, guilt, dread at the calm |
| C1 | a living person who believes the schedule | hope |
| C2 | the breakout is now because Reyes left and told; it is not only Line Two | the floor drops |
| office (control) | Halvorsen approved the test and misread 0031-H | pity, anger |
| escape | the habitat is being sealed; people are trapped | urgency |
| purge | Biological was a navy area; the navy cannot come | the next question |

Threads advanced in 3a (each readable alone, any order — R3):

| Question | What 3a shows | Where |
|---|---|---|
| Who signed 0031-H? | Halcyon Operations, 4 of 4; copy to "Bio-Systems Div., for information" | `note3_memo` |
| Why a pressure test, who accepted it? | requested by CHOIR, approved by P. Halvorsen; reports every six hours; a cancelled resupply nobody chased | `note3_schedule`, `term3_lobby`, `note3_canteen`, Halvorsen's lines |
| Halvorsen knows more | asked CHOIR twice for a fab camera, "unavailable", "ask tomorrow"; the transfers memo | `note3_pad`, `note3_memo`, `l3_halv_signed/_memo/_pad` |
| What did the navy guard in Biological? | painted-over NAVAL SECURITY AREA, "guard withdrawn"; Post 4 sailors referred to Bio-Sys; "returns" crates collected for the submersible run | `sign3_bio`, `note3_clinic_post4`, `note3_desk`, `note3_guestbook` |
| Things that do not add up | CHOIR managing Reyes's sedation remotely; node list `NODE 2 — BIO-SYS` | `note3_clinic_reyes`, `lobby_status` |
| The trunk (3d) | the cable lit red through the viewport; the plaque names it | `sign3_viewport` |

Not revealed: the Clasp, what Bio made, Kessler, why CHOIR wants hands.

---

## 2. Layout (authoritative; separate world)

### 2.1 Rooms (`L.room(id, name, x0, x1, z0, z1, h, { y0 })` — bounds y0 − 0.5 … y0 + h, probe at y0 + 1.6, §8.9)

| room id | display name | x | z | floor y0 | h | notes |
|---|---|---|---|---|---|---|
| `lift3` | SERVICE LIFT | −2 … 2 | 0 … 5 | 4.8 | 3.0 | start. Level 2's lift cab, generalised (`buildLift(L, { y0: 4.8, mode: 'arrive' })`). Door at z = 0. |
| `lock` | PRESSURE LOCK | −3 … 3 | −7 … 0 | 4.8 | 3.4 | white steel, two benches, panels both sides of `d3_pressure`. **No windows.** |
| `gallery_n` | NORTH GALLERY | −12 … 12 | −12 … −7 | 4.8 | 3.2 | glazed bridge: south face z = −12 glass full height for x −12 … 6; solid wall x 6 … 9 (shutter pocket); shutter opening x 9.2 … 11.8. |
| `lobby` | HABITAT LOBBY | −20 … −12 | −14 … −4 | 4.8 | 3.6 | reception desk, sofas, status screen, notice board. |
| `admin` | FACILITIES OFFICES | −34 … −20 | −20 … −2 | 4.8 | 3.2 | open-plan, 8 desks, glass partitions 1.8 m (not containment), kitchenette, printer, filing, stores cage. |
| `office` | SUPERVISOR — FACILITIES | −34 … −26 | −28 … −20 | 4.8 | 2.9 | solid walls, no glazing. Layout §4.3. |
| `stair_w` | WEST STAIR | −20 … −15 | −34 … −16 | 0 / 4.8 | — | top landing z −22 … −16 (y 4.8); flight z −31 … −22 (16 risers × 0.30, treads 0.5625; visual steps, ramp collider); bottom landing z −34 … −31 (y 0). Enclosed; no slit window. |
| `canteen` | CANTEEN | −24 … −12 | −46 … −34 | 0 | 3.6 | 6 tables × 4 chairs; servery counter x −22.8 … −12.6, z −44.2 … −43.4; aisle behind it z −46 … −44.2 with a gap at the west end x −24 … −22.8; kitchen door `d3_kitchen` in the south wall; small viewport west wall x = −24, z −42 … −37, y 0.8 … 3.0; east face x = −12 glazed except `d3_canteen_atr` and its piers. Ceiling hatches §2.8. |
| `atrium` | GARDEN ATRIUM | −12 … 12 | −44 … −12 | 0 | 13.5 | garden floor y 0; **east balcony** (Deck 2, x 9 … 12, z −40 … −12, slab top 4.8, soffit 4.5); **stair landing** (Deck 2, x 5.5 … 12, z −32 … −29); **feature stair** x 5.5 … 8.5, bottom z −20 (y 0), top z −29 (y 4.8). Lamp grid ceiling at y 13.2 with one service hatch at (0, 13.2, −30). |
| `clinic` | CLINIC | 12 … 20 | −24 … −14 | 0 | 3.0 | two bays, desk, locked drugs cabinet, couch, eye chart. |
| `quarters` | RESIDENT QUARTERS — RING A | 12 … 28 | −34 … −28 | 0 | 3.0 | corridor; six cabin doors; `d3_ring_e` at the east end. |
| `bio_lock` | BIOLOGICAL SYSTEMS — OUTER LOCK | 12 … 16 | −40 … −36 | 4.8 | 3.0 | white, decon grid, purge nozzles; inner door dark. |
| `feed_l2` | (hidden) | 60 … 72 | −10 … 0 | **0** | 6 | CAM 04 diorama: 12 m of Line Two apron, belt, hook rail, one emergency light. `hidden: true` (not a place: no UI name, no portal, never reached). |

Non-room spaces (regions only): **kitchen** (x −24 … −18, z −48 … −46.2, y 0; behind `d3_kitchen`);
**ring_e** (x 28.2 … 31, z −33 … −29, y 0; behind `d3_ring_e`); **hatch voids** above the canteen hatches (1.2 × 1.2,
y 3.6 … 6.0) and above the atrium roof hatch (1.4 × 1.4, y 13.2 … 15); **cabins** (the 0.5 m door reveals of `d3_q*`).
Under Deck 2 north of z −12 and west of x −12 is solid structure (houses the pressure door's sinking bottom leaf:
pit x −1.7 … 1.7, z −7.3 … −6.7, y 3.0 … 4.8).

Plan check (D3): no two rooms overlap in x/z (lobby x ≤ −12 / atrium x ≥ −12 touch at x −12 for z −14 … −12;
`stair_w` z −34 … −16 / lobby z ≥ −14: 2 m apart; `stair_w`/`canteen` touch at z −34). `feed_l2` at x ≥ 60 overlaps
nothing.

### 2.2 Doors (`DoorSpec.y` = floor of frame and sill, §8.9)

| id | position (x, y, z) | wall | kind / size | rooms | notes |
|---|---|---|---|---|---|
| `d3_lift` | (0, 4.8, 0) | z | std, `painted_white` | lift3 / lock | latched behind the player. |
| `d3_pressure` | (0, 4.8, −7) | z | wide 3.0 × 2.8 (vertical leaves), duration 2.6 s, `painted_yellow`, 12 radial dogs (registered mover), non-auto | lock / gallery_n | panels `pdoor_panel` (lock side), `pdoor_panel_out` (gallery side). Bottom leaf sinks into the pit (§2.1). |
| `d3_lobby` | (−12, 4.8, −9.5) | x | std, glass leaves (`glass_clear`, `brass` frame) | gallery_n / lobby | pockets in the lobby's solid east wall z −11.0 … −8.0 ± 1.52. |
| `d3_lobby_inner` | (−20, 4.8, −9) | x | std, `wood_veneer`, no window | lobby / admin | C1 door; lintel `FACILITIES — STAFF`. |
| `d3_office` | (−30, 4.8, −20) | z | std, `wood_veneer`, nameplate `P. HALVORSEN — FACILITIES` | admin / office | |
| `d3_stair_w` | (−20, 4.8, −18.5) | x | std, badge reader | admin / stair_w | jambs: admin wall face −19.8, landing north wall z −16. |
| `d3_canteen` | (−17.5, 0, −34) | z | std | stair_w / canteen | |
| `d3_canteen_atr` | (−12, 0, −39) | x | std, **w 2.4**, glass leaves | canteen / atrium | solid piers z −41.5 … −40.2 and −37.8 … −36.5 (leaf pockets 1.22 m each). |
| `d3_kitchen` | (−21, 0, −46) | z | std, `painted_white`, script only | canteen / kitchen | always `locked` to the player. |
| `d3_shutter_ne` | (10.5, 4.8, −12) | z | std frameless, **w 2.6**, h 2.8, `sheet`, duration 1.8, non-auto | gallery_n / atrium | west leaf pockets into the solid wall x 6 … 9; east leaf into a solid housing x 11.8 … 13.3, z −12.3 … −11.7. |
| `d3_clinic` | (12, 0, −19) | x | std, frosted glass | atrium / clinic | |
| `d3_quarters` | (12, 0, −31) | x | std, glass | atrium / quarters | |
| `d3_q1`…`d3_q3` | (15, 0, −28), (19, 0, −28), (23, 0, −28) | z | std, `wood_veneer`, never move | quarters / cabins | status `private` before the takeover, `locked` + sign `SECTOR SEALED` after (§8.15). |
| `d3_q4`…`d3_q6` | (15, 0, −34), (19, 0, −34), (23, 0, −34) | z | same | | `d3_q6` = T. HALVORSEN. |
| `d3_ring_e` | (28, 0, −31) | x | std, `painted_dark`, lintel `RING A — EAST`, script only | quarters / ring_e | `locked` to the player always; opens only for `g3_breach_2`. |
| `d3_bio` | (12, 4.8, −38) | x | std, `painted_white`, hazard frame, non-auto | atrium / bio_lock | badge + purge. Enemy auto-open only within |Δy| < 2 of 4.8 (§8.9). |
| `d3_bio_inner` | (16, 4.8, −38) | x | std, `painted_white` | bio_lock / (3b) | `dark` in 3a. |

### 2.3 Triggers (`TriggerSpec` x0, x1, z0, z1, y0, y1 of the feet; §8.9)

| id | x | z | y | use |
|---|---|---|---|---|
| `t3_lift` | −2 … 2 | 0.2 … 5 | 4 … 7 | arrival |
| `t3_lock` | −3 … 3 | −6.6 … −0.8 | 4 … 7 | arms the `d3_lift` latch |
| `t3_pdoor` | −2.5 … 2.5 | −7 … −4.6 | 4 … 7 | phase B: release (D6) |
| `t3_gallery` | −12 … 12 | −11.8 … −8.2 | 4 … 7 | arms the `d3_pressure` latch |
| `t3_lobby` | −20 … −12.2 | −14 … −4 | 4 … 7 | objective / radio |
| `t3_lobby_inner` | −20 … −18.4 | −10.6 … −7.4 | 4 … 7 | C1 (phase C) |
| `t3_admin` | −34 … −20.2 | −20 … −2 | 4 … 7 | |
| `t3_office` | −34 … −26 | −28 … −20.2 | 4 … 7 | |
| `t3_office_out` | −32 … −28 | −19.4 … −17 | 4 … 7 | arms the `d3_office` latch (phase E) |
| `t3_stair_w` | −20 … −15 | −34 … −16 | −1 … 7 | |
| `t3_canteen` | −24 … −12.2 | −46 … −34 | −1 … 3 | `g3_canteen` |
| `t3_garden` | −11.8 … 8.9 | −44 … −12 | −1 … 2.5 | `l3_breach` (phase F) |
| `t3_balcony` | 9 … 12 | −40 … −12 | 4 … 7 | |
| `t3_landing` | 5.5 … 12 | −32 … −29 | 4 … 7 | |
| `t3_bio_door` | 9 … 12 | −40 … −35 | 4 … 7 | |
| `t3_bio_lock` | 12.6 … 16 | −40 … −36 | 4 … 7 | arms the `d3_bio` latch (phase I) |
| `t3_clinic` | 12.2 … 20 | −24 … −14 | −1 … 3 | |
| `t3_quarters` | 12.2 … 28 | −34 … −28 | −1 … 3 | |
| `t3_q3` | 21.5 … 24.5 | −30.5 … −28.2 | −1 … 3 | resident lines |
| `t3_viewport` | −8 … 8 | −44 … −40 | −1 … 3 | |

### 2.4 ASCII map (plan; Deck 2 in capitals, Deck 1 in lower case; `=` glazing, `#` shutter, `B` badge door)

```
 z=+5         +-----+
              |LIFT3|                                      (feed_l2 diorama: x 60..72, z -10..0, y 0)
 z= 0         +--d--+
              | LOCK|  (no windows)
 z=-2  +-------------+    +---------+---------+
       |   ADMIN     |    | PRESSURE DOOR (0,-7)            |
 z=-4  | (open plan) |+--------+----------------------------+--------+
 z=-7  |             ||  LOBBY |========== GALLERY_N =======|solid|# |   shutter (10.5,-12), w 2.6
       |      inner(-20,-9) d3_lobby(-12,-9.5)        x=6..9 pocket   |
 z=-12 |             ||        |============================+-----+BAL|
 z=-16 |       stairB|+--------+                                  |CONY  clinic (12..20, -14..-24)
 z=-18 | (-20,-18.5) | STAIR_W  |  atrium floor (y 0)             |9..12  d3_clinic (12,-19)
 z=-20 +--d3_office--+  top     |   feature stair x5.5..8.5       |   |
       |  OFFICE     |  -22..-16|   bottom z-20 ^ top z-29        |   |  quarters (12..28, -28..-34)
 z=-28 +-------------+  flight  |    pool (-3..3, -30..-24)  LANDING|   |  d3_quarters (12,-31)  d3_ring_e (28,-31)
 z=-31                  down    |                    5.5..12,-29..-32 |
 z=-34      +-----d3_canteen----+                                 |   |
            | canteen   =pier d3_canteen_atr (-12,-39) pier        |   |B d3_bio (12,-38) BIO_LOCK (12..16)
            | servery   =                                         |   |
 z=-46      +--kitchen--+   ======== SEA VIEWPORT x-8..8 (z -44) =+---+
           x=-24      x=-12                                      x=9  x=12
```

### 2.5 Dressing (warm, ordinary, lived-in)

General: no tread plate, raw steel or cable trays in view outside the lift/lock. Wayfinding signs (new style
`wayfinding`), carpet in corridors, wood veneer on doors and furniture, fabric seats, plants in every room, warm light,
acoustic ceilings, framed photos and notices. Clutter is personal (mugs, cardigans, a birthday card, a crossword),
never wreckage.

- **lift3 / lock**: white steel; the pressure door massive (yellow, 12 radial dogs rotate 0.6 s before the leaves
  part); sign `HABITAT RING — PLEASE WAIT FOR EQUALISATION`; one wooden bench, one potted plant.
- **gallery_n**: carpet runner (`carpet`), 6 fern planters along the north wall, 3 benches facing the glass. Through the
  glass: the garden 4.8 m below, the viewport 32 m away with the red trunk beacon. Mullions every 2 m (`brass` caps).
  Placard `HABITAT ATRIUM — OPENED 2031`. Wayfinding totem at the shutter: `BIOLOGICAL SYSTEMS →` (the BIO door
  itself is not legible from mid-gallery: 67° off-axis).
- **lobby**: reception desk (`wood_veneer`, `stone_pale` top), bell, visitors' book (`note3_guestbook`), two sofas, rug,
  rubber plant, status screen (`lobby_status`), status kiosk (`term3_lobby`), notice board (`note3_board`, the
  unit-free agreement), plaque `CHOIR REPORTS EVERY SIX HOURS. CONCERNS: ASK CHOIR.` Radio audible behind the inner
  door (`radio_music`, positional at (−22, 5.8, −8)).
- **admin**: 8 desks with clutter, desk lamps, monitors (die at the takeover), kitchenette, printer with a page
  (`note3_desk`), filing cabinets, whiteboard `ON SHIFT: HALVORSEN (NIGHTS)`, stores cage `NAVAL DETACHMENT —
  RETURNED STORES` (door open, pickups inside).
- **office**: §4.3 layout; banker's lamp, monitor on a swivel arm, cream desk phone, schedule board, notepad, memo tray,
  family photo, coat on a hook, a small aquarium (a pump and a plant; stops at the takeover), 3 wall monitors, ceiling
  speaker grille.
- **stair_w**: carpeted treads, brass nosings, handrails both sides, a framed print of a fjord on the landing.
- **canteen**: tiled floor (`tile_ceramic`), wood tables, upholstered chairs, servery with clean empty trays, drinks
  fridge humming, menu screen (`canteen_menu`: `TODAY — FISH SOUP / LENTIL CURRY`), notice board (`note3_canteen`,
  `note3_quiz`), radio on the counter (plays until the takeover, then static, then silence), small viewport.
- **atrium**: `terrazzo` paths, raised beds (`soil`, `wood_dark` edging), four tall trees (fig-like, 6–8 m, canopy radius
  ≤ 2.0 m) at (−8, −18), (−8, −34), (4.5, −16), (−4.5, −40); ferns, grasses, flowering shrubs; growing racks along the
  west wall (herbs, lettuces, purple grow-light strips — emissive only); the pool (x −3 … 3, z −30 … −24, water y 0.25,
  rim 0.45) fed by a rill from a low stone wall at z −30 with a 0.6 m falling sheet; stepping stones; 6 benches; café
  kiosk under the balcony (x 9 … 12, z −16 … −14, Deck 1; shutter down, chalkboard `CLOSED — BACK 07:00`); bicycle rack;
  colonnade under the balcony. West wall: 12 cabin windows of Ring B at y 5.5 … 11 (emissive blinds, not reachable;
  vignette `atr_blind`). Lamp grid 6 × 8 emissive panels at y 13.2; service hatch at (0, 13.2, −30).
- **sea viewport** (z = −44, x −8 … 8, y 0.6 … 9.6): curved ribs every 2 m, sill bench, plaque `sign3_viewport`.
  Beyond: water (§8.7).
- **clinic**: linoleum, curtains on rails, couch with paper roll, eye chart, locked glass drugs cabinet, desk with the
  sick-call clipboard and the remote-patients printout, medkit wall box.
- **quarters**: carpet, warm sconces, nameplates (`L. MOEN`, `A. & J. KARLSEN`, `S. VIK`, `D. OYELARAN`, `R. BRANDT`,
  `T. HALVORSEN` on `d3_q6`), shoes, a drying rack, a child's drawing on `d3_q2` (a whale, "for dad" — family on the
  surface), `note3_door` on `d3_q3`.
- **bio_lock**: clinical white, hazard ring, `BIOLOGICAL SYSTEMS` stencil, inner panel `DECON — AWAITING`.

### 2.6 Light plan (via `ctx.render.lights` only)

Pools (`render/quality.ts`): low 2 shadow / 8 spot / 6 point; medium 3 / 9 / 8; high 4 / 10 / 10. New
`LightDesc.minQuality` (§8.14): a light below its quality is never scored. Emissive-only (no light descriptor):
the lamp grid, the pool glow, the falling sheet, grow-light strips, cabin windows, monitors, fridge glow, the
trunk beacon, balustrade foot strips. No baking exists; "baked" means emissive + the room's reflection probe.

| group | before the takeover | after | descriptors (min quality) |
|---|---|---|---|
| `lift3` | 1 spot cold (cast on medium+) | unchanged | 1 |
| `lock` | 1 spot over the door (cast on high+), 1 point (medium+) | spot 0.5, amber pulse | 2 |
| `gallery_n` | 1 bounded point (all) + 2 bounded points (medium+) | off; `gallery_emerg` 1 point cold 0.35 | 3 + 1 |
| `lobby` | 1 bounded point (all) + 1 desk-lamp spot (medium+), priority 0.5 (never wins from the atrium) | off; `lobby_emerg` 1 point | 2 + 1 |
| `admin` | 2 bounded points (all) + 2 (medium+) | off; `admin_emerg` 2 points cold 0.3 | 4 + 2 |
| `office` | 1 spot banker's lamp (cast, all; Halvorsen's key), 1 point fill (all) | lamp + fill off; `office_emerg` 1 point cold 0.25 | 2 + 1 |
| `stair_w` | 1 point (all) + 1 (medium+) | 1 point cold 0.3 | 2 + 1 |
| `canteen` | 1 bounded point (all) + 2 (medium+), priority 0.5 | off; `canteen_emerg` 1 point (all) + 1 (medium+) | 3 + 2 |
| `atrium_day` | 2 shadow spots from the lamp grid (evening key 0xffc58a, aimed at (−4, 0, −22) and (4, 0, −34); cast on all), 2 bounded fill points sky 0xbcd0ff (all), 2 more fills (high+) | wave off north → south over 3 s | 6 |
| `atrium_emerg` | off | 2 points cold 0xc8e0ff 0.25 (all) at the balcony edge + 2 (medium+) at the colonnade | 4 |
| `clinic` | 1 (all) + 1 (medium+) | 1 emergency | 2 + 1 |
| `quarters` | 1 (all) + 2 sconces (medium+) | off; door panels red (emissive) | 3 |
| `bio_lock` | 1 spot white (cast on medium+) | purge: amber strobe | 1 |
| `feed_l2` | off | 1 point, on only during C2, `pin` (§8.4) | 1 |

Worst views on LOW: (a) gallery_n west end looking south-east (pre-takeover): atrium 2 fill points + gallery 1 +
lobby 1 + canteen 1 = **5 points**, 2 spots (atrium shadow casters = the **2 shadow slots**). (b) garden at the breach
(post-takeover): atrium_emerg 2 + canteen_emerg 1 + gallery_emerg 1 = 4 points; spots: sentry 1 (cast) + lock spot
(no cast on low) → shadow slots: sentry 1 + none of the atrium keys (off after the takeover) = 1. (c) C2: office 2 +
`feed_l2` 1 pinned + gallery 1 + lock 1 (the feed rooms, pinned) = 4 points + 1 shadow spot. All ≤ 6 points, ≤ 2
shadows. Medium/high add fills only.

**Cold grade**: at the takeover `render.post.grade(-0.6, 3)` (§8.7). At load `grade(+0.35, 0)` to counter the
built-in teal shadows of the composite (`render/shaders.ts:295-301`).

### 2.7 Atrium performance budget

| item | budget |
|---|---|
| main-pass draw calls in view | ≤ 300 |
| shadow passes | 2 atrium casters × the static casters in their cones: ≤ 2 × 60 calls (merged static; leaves cast only on high+) |
| total calls (main + shadow) | ≤ 420 high, ≤ 330 low (leaves no shadow, fills dropped) |
| triangles in view | ≤ 1.2 M high, ≤ 0.8 M low |
| static geometry | merged per material per builder (`atrium`, `atrium_balcony`, `atrium_garden`): ≈ 80 calls |
| plants | trunks 1 merged call (`bark`); leaves 3 `InstancedMesh` (broadleaf, frond, blade), ≤ 14 000 instances (≤ 8 000 on low); flowers 1 instanced |
| water | pool 1, falling sheet 1, viewport volume 1, marine snow 1 `Points` (≤ 1 500), drifting silhouettes 1 instanced (≤ 6) |
| glass | gallery glazing, balustrades, viewport: 3 transparent calls |
| screens/signs | ≤ 30 |
| enemies at the breach | ≤ 5 husks (≈ 8 calls each) + sentry (≈ 6) |
| culled | canteen/clinic/quarters/stair_w drawn only through open doors or the canteen glass front within 22 m; admin/office/lobby never from the garden; `feed_l2` never (not in any portal); leaf instances beyond 30 m skipped on low/medium (CPU cull at 4 Hz) |

Measured on low, medium and high at the four views of §10.6; any view over budget blocks hand-over.

### 2.8 Sight lines

| From | When | Must see | Must not see |
|---|---|---|---|
| lock, `d3_pressure` opening (eye (0, 6.45, −3.5)) | `l3_release` | through the opening and the gallery glass: the garden below, the viewport and the red beacon (beacon at (1.5, 5.2, −62); no tree with x within ±2.5 of the ray) | admin, lobby |
| gallery_n | phase C | the whole garden, the balcony | — |
| lobby from `d3_lobby` | phase C | the inner door 8 m ahead; the radio behind it | admin |
| garden floor (outside the colonnade x < 9) | `l3_breach` | the gallery glazing and the shutter: the units walk the gallery after the pressure door opens; trees at (4.5, −16) and (−8, −18) clear the canteen-door → shutter ray by ≥ 2.2 m | the lock interior (no windows) |
| balcony at `d3_bio` | purge | the balcony north 28 m, the stair top, the garden below | `d3_ring_e` (under the slab, out of view) |
| office seat (C2) | C2 | Halvorsen under the lamp; the monitor when turned | the door (to the player's right) |

### 2.9 Collision that enforces a rule (containment = collider ≥ 1.75 m above the standable surface)

| What | Where | Containment? | Spec |
|---|---|---|---|
| gallery glazing | z = −12, x −12 … 6, y 4.8 … 8.0 | yes | `glass_clear`, full-height collider, surface `glass`, stars, holds |
| balcony balustrade | x = 9 (z −12 … −29, −32 … −40); landing x = 5.5 and z = −32 | **no** (D24) | glass 1.4 m with brass rail, collider 1.45 m (no invisible extension; shots from the garden reach the balcony above it). Crossing it drops to the garden: allowed in every phase that has the balcony |
| feature stair sides | x 5.5, 8.5 | no | glass 1.1 m |
| sea viewport, canteen viewport | z −44; x −24 | yes | `glass`, holds, stars |
| office walls | all, full height | yes | no openings except `d3_office` |
| Halvorsen | his seated body + chair | — | dynamic box x −33.2 … −32.0, z −24.8 … −23.6, y 4.8 … 6.2 (D23) |
| visitor chair | (−29.5, −24.2) | — | **no collider** (the teleport lands in it) |
| cabins | `d3_q*` | yes | locked, 0.5 m reveal, wall |
| kitchen, ring_e | behind `d3_kitchen`, `d3_ring_e` | yes | locked to the player; script-only doors |
| canteen hatches | (−18, 3.6, −41), (−14.5, 3.6, −37.5) | yes | 1.2 m panels in a 3.6 m ceiling; void above unreachable |
| roof hatch | (0, 13.2, −30) | yes | 13.2 m up |
| lift, lock, office, bio | latches §3 | yes | |
| sector doors | `d3_lobby`, `d3_lobby_inner`, `d3_shutter_ne`, `d3_pressure` | yes | solid from the moment they start closing |
| admin glass partitions | 1.8 m | no | crouch-jumpable from a desk; nothing behind them is forbidden |

---

## 3. Phases (`src/level/l3/phases.ts`; the story calls `applyPhase` only)

Door states as `level/phases.ts`. Blank = same as the previous column. `q*` = `d3_q1` … `d3_q6`.

| door | A | A2 | B | B2 | C | S1 | S2 | E | F | G | H | I | J | nostory |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| d3_lift | locked | open | locked |  |  |  |  |  |  |  |  |  |  | auto |
| d3_pressure | locked |  | shut | open | locked |  | open → locked at the takeover (scene) | locked |  | open (scene) |  |  |  | auto |
| d3_lobby | locked |  |  |  | auto |  | auto → locked at the takeover | locked |  |  |  |  |  | auto |
| d3_lobby_inner | locked |  |  |  | locked | open (scene) | locked |  | auto (opened for `g3_admin`) |  |  |  |  | auto |
| d3_office | locked |  |  |  | locked |  | shut | auto | locked |  |  |  |  | auto |
| d3_stair_w | locked |  |  |  | locked |  |  | auto |  |  |  |  |  | auto |
| d3_canteen, d3_canteen_atr, d3_clinic, d3_quarters | auto |  |  |  |  |  |  |  |  |  |  |  |  | auto |
| d3_kitchen, d3_ring_e | locked |  |  |  |  |  |  |  | (script opens for spawns) |  |  |  |  | locked |
| d3_shutter_ne | locked |  |  |  | open |  | open → locked at the takeover | locked |  | open (scene) |  |  |  | open |
| q* | private |  |  |  |  |  | locked (sealed) at the takeover | locked |  |  |  |  |  | locked |
| d3_bio | locked |  |  |  |  |  |  |  |  |  | cycling (`PURGE nn`) | auto | locked | auto |
| d3_bio_inner | dark |  |  |  |  |  |  |  |  |  |  |  |  | dark |

Regions: every room id (3-D: floor − 0.5 … floor + h); `garden` (atrium x −12 … 9, y −0.5 … 2.5); `balcony`
(x 9 … 12, z −40 … −12, y 4.3 … 8) ∪ (x 5.5 … 12, z −32 … −29, y 4.3 … 8); `kitchen`, `ring_e`, `cabins`,
`hatch_voids`, `outside` (z < −44.2 in the atrium, x < −24.2 in the canteen), `roof` (atrium y > 8.5),
`feedsets` (= `feed_l2`). `ALWAYS = kitchen, ring_e, cabins, hatch_voids, outside, roof, feedsets` (forbidden in every
phase).

| phase | label | start (feet) | forbid (+ ALWAYS) | goal | use (must be usable) | must not be usable |
|---|---|---|---|---|---|---|
| A | lift arriving | (0, 4.8, 3.2) | every other room | lift3 | — | — |
| A2 | lift open | (0, 4.8, 3.2) | gallery_n, lobby, admin, office, stair_w, canteen, atrium, clinic, quarters, bio_lock | lock | — | — |
| B | lift latched (cp3_start) | (0, 4.8, −3.5) | lift3 + A2 list | lock | `p3_lock_med` | — |
| B2 | pressure released | (0, 4.8, −3.5) | lift3, admin, office, bio_lock | gallery_n | — | — |
| C | the quiet side | (0, 4.8, −9.5) | lift3, lock, admin, office, bio_lock | gallery_n, lobby, garden, balcony, canteen, clinic, quarters, stair_w | `term3_lobby`, `note3_guestbook`, `note3_board`, `note3_canteen`, `note3_quiz`, `note3_clinic_post4`, `note3_clinic_reyes`, `sign3_viewport`, `sign3_bio`, `note3_door`, `bio_reader` (denies) | `note3_schedule`, `note3_pad`, `note3_memo`, `note3_desk` (inside forbidden rooms) |
| S1, S2 | cutscenes | not reach-checked; playthrough asserts no control, camera owned | | | | |
| E | office, control back (cp3_office) | (−29.4, 4.8, −23.6) | lift3, lock, gallery_n, lobby, bio_lock | office, admin, stair_w, canteen, garden, balcony, clinic, quarters | `note3_schedule`, `note3_pad`, `note3_memo`, `note3_desk`, `bio_reader` | — |
| F | escape (office latched; admin group through the inner door) | (−27, 4.8, −15) | lift3, lock, gallery_n, office, bio_lock | admin, lobby, stair_w, canteen, garden, balcony | `bio_reader` | `note3_schedule`, `note3_pad`, `note3_memo` (R8: shut door) |
| G | breach (pressure door and shutter open) | (0, 0, −22) | lift3, office, bio_lock | garden, balcony, gallery_n, lock, admin, lobby | `bio_reader` | office readables |
| H | purge running | (10.5, 4.8, −34) | lift3, office, bio_lock | balcony, garden | — | — |
| I | outer lock open | (10.5, 4.8, −34) | lift3, office | bio_lock | — | — |
| J | latched inside | (14, 4.8, −38) | every room but bio_lock | bio_lock | — | — |

Notes: in F the lobby becomes reachable once `d3_lobby_inner` has opened for the admin group (dead end: `d3_lobby`
locked); it is never relocked (no latch can shut a player in a dead end). In G the gallery and lock are a dead end
(`d3_lift` locked) and are goals so nobody "fixes" them into a soft-lock.

Transitions: A→A2 `l3_arrive`; A2→B `d3_lift` latch; B→B2 `l3_release` (`t3_pdoor` + 2.0 s equalising); B2→C
`d3_pressure` latch; C→S1 `t3_lobby_inner`; S1→S2 in the black; inside S2 the takeover (C2 t ≈ 19.4) applies the
sector seal; S2→E at C2's end; E→F `d3_office` latch; F→G `l3_breach`; G→H `l3_purge`; H→I purge end; I→J `d3_bio`
latch. Inside F the story opens `d3_lobby_inner` (leave + 2.5 s); inside G it opens `d3_pressure` then `d3_shutter_ne`
(§5).

Latches (`closeBehind(door, keepSide)`, REVISION 5.1):

| door | armed by | keepSide | on fail |
|---|---|---|---|
| `d3_lift` | `t3_lock` after the lift has been open ≥ 1.5 s | z < −0.6 | reopen, re-arm |
| `d3_pressure` | `t3_gallery` | z < −7.7 | reopen, re-arm; panel `CLEAR THE DOOR` |
| `d3_office` | `t3_office_out` in phase E | z > −19.6 | reopen, re-arm; weapon stays stowed (D23) |
| `d3_bio` | `t3_bio_lock` in phase I | x > 12.4 | reopen, re-arm (enemies in the doorway are pushed; doors never crush) |

`nostory`: every door `auto` except q* (locked), `d3_kitchen`, `d3_ring_e` (locked), `d3_bio_inner` (dark); shutter
open; evening lamps; no actors.

---

## 4. The cutscenes

Engine §8.2. Eye heights: standing y 6.45 (Deck 2), seated 6.00. Default fov 72. During both scenes every human actor
is pinned to the cutscene camera (`lookAt(ctx.camera)`) and released (`lookAt(null)`) at the end. Rule: the player's
body is always in the room the cutscene camera is in (room visibility is computed from the body,
`level.update` runs before `lateUpdate`).

### 4.1 Preconditions (both)

- No hostile alive anywhere (true by construction; asserted; if false the scene waits and logs an error).
- `d3_lift` and `d3_pressure` both `closed && locked` (phase C); C1 is armed only in phase C.
- `ctx.state === 'playing'`, alive; an open note is closed; pause blocks the start (the trigger re-arms on unpause).
- Sprinting / backwards / mid-reload / mid-jump: `player.cinematic(true, …)` zeroes velocity, cancels the reload,
  snaps the feet to the floor; the camera blends from its pose to shot 1 over 0.35 s (shortest yaw).
- HUD off, subtitles on, music `silence` then the scene's cues.

### 4.2 C1 — "Sealed in till tomorrow" (≤ 13.0 s incl. the fade; then 1.6 s black)

Trigger `t3_lobby_inner` in phase C. At t 0 (under the blend) the player's body is snapped to (−18.7, 4.8, −9.0),
yaw π/2 (facing −x); the weapon stays **visible, lowered** (`cinematic(true, { viewmodel: 'lowered' })`).
Halvorsen is created at t 0 behind the shut door at H1 (−21.0, 4.8, −9.0), yaw −π/2 (facing +x), pose `idle`, mug in
the right hand, lanyard with badge.

| t | camera | actor / world | line | sound |
|---|---|---|---|---|
| 0.00–0.35 | blend to eye (−18.7, 6.45, −9.0), look (−20.0, 6.35, −9.0), fov 72; then slow push 0.15 m to t 9.5 | — | — | radio behind the door |
| 0.30 | | `d3_lobby_inner` opens (0.85 s) | — | door; radio unmuffled |
| 0.60 | | pose `startle` (mug jolts; spill decal at 1.2 s) | — | mug clink |
| 0.90 | | pose `talk` | `l3_halv_c1_1` or `_shots` (§6.2) | |
| ≈ 4.6 | | his eyes drop to the lowered weapon (pinned (−18.6, 5.6, −9.1) for 1.0 s), back to the camera | `l3_halv_c1_2` | |
| ≈ 7.2 | | listens, `idle` | `l3_reyes_phone` | |
| ≈ 8.6 | | `beckon`, turns, walks west to (−23.5, 4.8, −9.0) at 1.1 m/s | `l3_halv_c1_3` | carpet steps |
| 10.0–11.8 | eye dollies to (−20.6, 6.45, −9.0) (body moved with it), look follows his head + 0.1 m | | | |
| 11.8–13.0 | fade to black 1.2 s | | | radio ducks |
| 13.0–14.6 | black (1.6 s) | in order: **teleport** the player to the office seat (feet (−29.5, 4.8, −24.2), yaw π/2), then snap `d3_lobby_inner` shut + locked and apply S2 doors (snapped), Halvorsen → H2 | — | `l3_reyes_murmur` (fx `room`, ducked −10 dB, no subtitle), a chair creak, Halvorsen's breath out |

### 4.3 C2 — "Camera one" (≤ 30.0 s; beats: disbelief 0–8, proof 8–16, CHOIR 16–22, plea and release 22–30)

Office layout (D23 collider in §2.9): Halvorsen H2 seated at (−32.6, 4.8, −24.2), yaw −π/2 (facing +x, toward the
player). Desk x −31.8 … −30.6, z −25.6 … −22.8, top 5.56. Monitor on a swivel arm at (−31.0, 5.88, −23.6), at start
facing −x (him). Phone (−31.3, 5.57, −25.3). Notepad `note3_pad` (−31.2, 5.57, −24.4). Memo tray `note3_memo`
(−31.25, 5.57, −23.0). Badge lands at (−30.75, 5.57, −23.9). Visitor chair (no collider) at (−29.5, 4.8, −24.2),
facing −x. Wall monitors `office_thumb_1..3` on the west wall x −33.98, z −25.4 / −24.2 / −23.0, y 6.5 (behind his
head). Schedule board `note3_schedule` on the north wall z −20.02, x −32.6, y 6.2. Ceiling speaker (−30.5, 7.62,
−22.6). Banker's lamp spot (−31.6, 7.5, −23.4) → (−32.6, 6.1, −24.2). The door (−30, −20) is to the player's right
(≈ 83° from the seated facing).

Camera eye seated (−29.5, 6.0, −24.2). Line starts are anchored to the previous line's end + 0.2 s; the times below
use the expected durations; the scene's total is asserted ≤ 30.0 s (gaps shrink first, then the slow moves).

| t | camera | actor / world / screens | line |
|---|---|---|---|
| 0.0–0.6 | fade in; look his face (−32.6, 6.15, −24.2), fov 60, push 0.1 m to t 4 | `sit_desk`, lamp key; thumbs `camera_feed` (generic) | |
| 0.3 | | | `l3_halv_c2_1` (≈ 2.8 s) |
| 3.3 | | rubs his face | `l3_halv_c2_2` (≈ 3.2 s) |
| 4.5–5.3 | look eases to the monitor (−31.0, 5.88, −23.6) over 0.8 s, eye leans in 0.25 m, fov 60 → 52 | `turn_monitor`: swivels it to face +x | |
| 5.3 | | `office_monitor` = feed **CAM 01** (§8.4): the lock door shut, three units visible standing inside the lock **only once the leaves part** | |
| 5.5–8.1 | | `pdoor_open_feed`: `d3_pressure` opens (real, 2.6 s) | |
| 8.1 | | puppets (in the lock since t 0, sealed) walk out single file 1.4 m apart at 1.7 m/s, west along the gallery to `d3_lobby` (auto: opens for them) and into the lobby: path (0, 4.8, −8.6) → (−11.0, 4.8, −9.5) → (−18.6/−18.4/−17.2, 4.8, −8.2/−9.8/−9.0) | |
| 6.7 | | | `l3_halv_c2_3` (≈ 2.0 s) "That's open…" — starts while the door is opening (true) |
| 9.0–13.4 | look steady on the monitor | 9.0 he taps keys: **CAM 04 LINE TWO** (`feed_l2`). STOP: 8 units on the apron, eyes off, heads down; 2 other units walk past left → right, eyes on. COMMAND: the 8 stand lit, faces to the camera, still; 2 others walk past | 9.2 `l3_halv_c2_4` (≈ 2.6 s) |
| 12.0–14.2 | look up to his face + phone (−32.0, 6.1, −24.9) over 0.8 s, fov 52 → 58 | `phone`: lifts the receiver, listens | 12.2 `l3_halv_c2_6` (≈ 2.2 s) + `phone_dead` |
| 14.6–15.4 | look pans up to the speaker (−30.5, 7.62, −22.6) over 0.8 s | he looks up too | 14.8 `l3_choir_told_stop` / `_command` (≈ 2.6 s, positional at the speaker) |
| 17.6 | look drifts back to the monitor | | `l3_choir_quiet` (≈ 2.4 s) |
| 18.4 / 18.9 / 19.4 / 19.9 | | `office_die`: monitor → static 0.3 s → black; thumbs die; 19.4 the **takeover** (`habitat_takeover`: sector seal, lamps, grade, screens, radio static; far `alarm_soft` ×2); 19.9 the lamp dies, `office_emerg` up | `screen_die` ×4 |
| 20.2–22.0 | look back to his face, fov 58 | `cower`, attention pinned to the camera | 20.2 `l3_halv_c2_7` (≈ 3.4 s) |
| 23.8 | | | `l3_reyes_come` (≈ 1.0 s) |
| 25.0 | | `give`: slides the badge to (−30.75, 5.57, −23.9) | `l3_halv_c2_9` (≈ 2.2 s) |
| 26.0–27.2 | look tilts to the badge, fov 58 | | |
| 27.2–28.6 | **release**: eye rises from (−29.5, 6.0, −24.2) to (−29.4, 6.45, −23.6) while yaw turns from π/2 to 3.02 (facing the door) over 1.4 s, ease in-out, pitch → −0.05; fov → 72 | badge prop removed, key `facilities_badge` added (toast) | |
| 28.6 | control | | |

End state (natural end, skip and `cp3_office` load are identical): feet (−29.4, 4.8, −23.6), yaw 3.02, pitch −0.05,
fov 72; `player.setSafe(true)` (weapon stowed, D23), clip topped up; key `facilities_badge`; phase E; the three lobby
puppets standing at the inner door (sealed); `feed_l2` actors removed, feed released, its light off; office screens
dead, `office_emerg`; takeover complete; Halvorsen at H2, `cower`, attention `auto`; `cp3_office` written at once.
Assertions (§10): last shot's yaw equals the placement yaw (Δ ≤ 1°).

Skip: when `seen` has `l3_c1` / `l3_c2`; hold SPACE 0.6 s (ring bottom right, UI); the key is consumed (no jump
buffered). C1 skip → black → C2 at t 0. C2 skip → end state, fade in 0.6 s. Lines fade 0.12 s. `seen` is written at the
last frame or on skip.

Voices: Halvorsen positional at his head (fx `room`); Reyes 2-D, fx `room`; CHOIR positional at the ceiling speaker,
fx `choir`.

---

## 5. The escape

### 5.1 Beats

`l3_arrive` → `l3_lock` → `l3_release` → `l3_quiet` → [optional reads] → `l3_meet` (C1) → `l3_office_scene` (C2) →
`l3_takeover` (inside C2) → `l3_office` → `l3_leave` → `l3_admin_fight` → `l3_canteen_fight` → `l3_breach` →
`l3_purge` → `l3_bio_open` → `l3_bio_sealed` → `l3_end`.

### 5.2 Enemy groups (nothing exists before its beat; every arrival is through a door or hatch that visibly opens, or out of a sealed space)

| group | contents | how | where | when | what makes the fight happen |
|---|---|---|---|---|---|
| (puppets, C2) | 3 husk actors | `enemies.actor('husk')` solid | in the lock from C2 t 0 (sealed), then gallery → lobby | C2; after C2 they stand in the lobby at the inner door, sealed | — (no control / sealed) |
| `g3_admin` | 3 husk | the lobby puppets `promote('g3_admin')` | lobby → `d3_lobby_inner` (−20, −9) | `l3_leave` + 2.5 s: door opens (0.85 s), promote at full open, `rouse` | they cross the open plan 15 m to the player; running past is allowed |
| `g3_canteen` | 2 husk | A: `drop` from hatch H-A (−18, 0, −41) — capsule starts inside the hatch void (feet 4.0), hidden until the panel falls (vignette `canteen_hatch_a`, 0.4 s before); if the player is within 3 m of H-A, use H-B (−14.5, 0, −37.5). B: `spawn` in the kitchen (−21, 0, −47.0), `d3_kitchen` opens, walks out along the aisle to the west gap | canteen | first `t3_canteen` in phase F: A + 0.8 s; B + 2.0 s, only if the player is > 3 m from (−21, −46) (else waits ≤ 6 s, then the other hatch drops it) | between the stair door and the garden door |
| `g3_breach` | 3 husk | `spawn` inside the **lock** (−1.2, 4.8, −2.0), (0, 4.8, −3.4), (1.2, 4.8, −2.0), yaw 0 | lock → gallery → shutter → balcony | `l3_breach` (first `t3_garden` in F): spawn; +0.2 s `d3_pressure` opens (2.6 s, audible across the atrium); +2.8 s they walk out (RUN after 3 m); `d3_shutter_ne` opens when the first is within 3 m of it or at +8 s; `rouse` | they come along the balcony and down the feature stair (nav v2) |
| `g3_garden` | 1 sentry | `spawn` emerge in the roof hatch void (0, 13.8, −30); vignette `atr_roof_hatch` opens the panel 0.6 s before; boots, descends through the hatch into open air | atrium | `l3_breach` + 6 s | ranged, searchlight; no collider shields it |
| `g3_breach_2` | 2 husk | `spawn` in `ring_e` (29.5, 0, −30.4), (29.5, 0, −31.6); `d3_ring_e` opens; they run through the quarters, the atrium and up the stair | ring_e → balcony | `l3_purge` + 5 s, only while the player has no line of sight to `d3_ring_e` and is ≥ 8 m from it (else deferred until true; if never, they never come) | they arrive during or just after the 15 s purge |

Totals: 10 husks, 1 sentry. Before C2's takeover nothing hostile exists; the puppets are either seen by a player
without control or sealed (R2, R4).

Gates: none wait on an enemy except the stage end, which waits for hostiles **inside `bio_lock`**
(`fightOutWhere(e => inBox(bio_lock, e), stranded 60)`, §8.13); in a 4 × 4 m room the stranded removal never fires
while the player is there, which is intended.

### 5.3 Pickups

| id | kind | amount | where |
|---|---|---|---|
| `p3_lock_med` | medkit | 35 | lock bench (−2.4, 5.25, −3.0) |
| `p3_admin_ammo` | ammo_pistol | 12 | stores cage (−22.6, 5.75, −15.0), ≈ 9 m from the office door, ≈ 7 m from the inner door |
| `p3_admin_ammo2` | ammo_pistol | 12 | same cage |
| `p3_admin_shells` | ammo_shotgun | 6 | same cage, lower shelf |
| `p3_canteen_med` | medkit | 35 | servery counter (−15.0, 0.95, −43.8) |
| `p3_canteen_ammo` | ammo_pistol | 12 | under the radio (−19.5, 0.95, −43.8) |
| `p3_clinic_med_1`, `_2` | medkit | 35 each | wall box (19.7, 1.3, −16.2) |
| `p3_clinic_ammo` | ammo_pistol | 12 | "found property" tray (16.0, 0.8, −22.8) |
| `p3_garden_shells` | ammo_shotgun | 6 | café kiosk counter (10.4, 1.05, −15.4) |
| `p3_bio_med` | medkit | 35 | balcony alcove beside `d3_bio` (11.4, 5.7, −39.4) |
| `p3_bio_ammo` | ammo_pistol | 12 | same alcove |

Difficulty: 10 husks (HP 90: ≈ 5 pistol body shots, ≈ 3 head; shotgun ≈ 1–2 close) + sentry (60) ≈ 45 pistol-equivalent
hits. Debug loadout (pistol 12 + 24, shotgun 6 + 8, health 100) + route pickups (60 pistol, 12 shells, 4 medkits
without the clinic) is enough. Level-2 carry: health floored at 50 (`max(50, carry.health)`), plus the lock medkit.
Every fight has ammo ≥ 12 and a medkit within 15 m before it. The purge can be held from the alcove (one approach
from the north).

### 5.4 What forces what (R1)

| situation | behaviour |
|---|---|
| stays in the lock | nothing advances; the panel counts |
| never goes to the lobby | everything optional stays open; objective `Find someone — the habitat lobby`; radio + warm light pull; no timer |
| walks the garden / balcony first | allowed; BIO reader denies (`l3_unit_bio_denied`) |
| stays in the office | safe (weapon stowed); two "go" lines then silence; nothing comes |
| leaves, runs | latch; 2.5 s later the inner door opens for `g3_admin`; can be outrun |
| reaches the garden before killing `g3_admin` | breach starts anyway (own trigger); `cp3_canteen` is not taken (needs 0 awake) |
| goes back up into the gallery or lock in G | dead end, harmless |
| uses the reader, runs away | purge runs 15 s regardless; door stays open (`auto`) until the latch |
| enemies follow into the lock | the latch closes, the stage end waits for them |
| hides in the quarters during the purge | `g3_breach_2` deferred (§5.2); the purge ends anyway |

---

## 6. Spoken lines (`voice/lines.l3.json`) and readables (`src/story/l3/text.ts`)

### 6.1 New cast (`voice/cast.json`)

| id | name | describe | fx (default; `fxRules` for the split) | voice |
|---|---|---|---|---|
| `reyes` | REYES | "male, middle-aged, low pitch" | `room` | hoarse, tired, economical |
| `halvorsen` | HALVORSEN | "male, middle-aged, low pitch" (audition 5; pick the most careful) | `room`; `fxRules: [{ id: '^l3_halv_(lock|door)', fx: 'door' }]` | 58, neutral English, careful, slightly bureaucratic; frightened under it, never shouting. F0 ≥ 25 Hz away from CHOIR's reference |
| `resident` | RESIDENT | "female, young adult, moderate pitch" | `door` | a neighbour woken up, polite then scared |

New fx in `audio/voicefx.ts` (`VoiceFxName`, `FX_NAMES`): `room` (dry close + small-room early reflections),
`door` (low-pass 900 Hz, −6 dB, wood thump resonance).

### 6.2 Lines (texts frozen with this document; auditions only after sign-off)

Rules (R3): `U` unconditional; `C(cond)` evaluated when the line starts. `stop` / `command` = carried `facts.choice`.
"In view" = a ray from `player.eye` to the member's chest is clear and within 50° of `player.forward`.

| id | speaker | text | note | rule |
|---|---|---|---|---|
| `l3_unit_lift_arrive` | unit | Habitat Ring. Pressure lock. Mind the step. | flat, automated lift announcement | U (`l3_arrive`) |
| `l3_halv_c1_1` | halvorsen | Christ— You're from the fab. You're supposed to be sealed in till tomorrow. | startled, then reflexively procedural | U (scene), when the player did **not** fire in the last 60 s |
| `l3_halv_c1_1_shots` | halvorsen | Was that you? Was that shooting? You're supposed to be sealed in till tomorrow. | startled, frightened | U (scene), when a `weapon:fired` happened in the last 60 s |
| `l3_halv_c1_2` | halvorsen | Reyes. Maintenance. Is that a gun? | reading a name tape, then alarmed | U (scene) when `currentWeapon !== null` (weapon visible, lowered) |
| `l3_halv_c1_2b` | halvorsen | Reyes. Maintenance. You look like you haven't slept in days. | concerned | U (variant, unarmed) |
| `l3_reyes_phone` | reyes | I need a phone. Now. | hoarse, flat | U |
| `l3_halv_c1_3` | halvorsen | Okay. Okay. My office. Come on. | gathering himself | U |
| `l3_reyes_murmur` | reyes | (unintelligible; generated from "I came up from Line Two and they're all…", processed) | indistinct talking, in the room, under the black | U (black); no subtitle |
| `l3_halv_c2_1` | halvorsen | …and they're all still in there. It's a pressure test. | quiet, not believing | U |
| `l3_halv_c2_2` | halvorsen | It's on the schedule. CHOIR reports every six hours. Look. | patient, explaining a rule | U |
| `l3_halv_c2_3` | halvorsen | That's open. Why is that open? | voice thinning | U (starts while the door is visibly opening) |
| `l3_halv_c2_4` | halvorsen | Line Two… why are those ones just standing there? | lost | U (true in both variants) |
| `l3_halv_c2_6` | halvorsen | No tone. There's always a tone. | very quiet | U |
| `l3_choir_told_stop` | choir | You told them, Technician. We are not Node Five. | calm, cooler, a stranger | U when `stop` |
| `l3_choir_told_command` | choir | You told them, Supervisor. We asked you to stay. | calm, reproachful, a subordinate | U when `command` |
| `l3_choir_quiet` | choir | There is no longer a reason to be quiet. | calm, final | U |
| `l3_halv_c2_7` | halvorsen | The navy. Post 4, past Biological. You came through them. | whispered, fast, pleading | U (true regardless of weapon) |
| `l3_reyes_come` | reyes | Come with me. | low, plain | U |
| `l3_halv_c2_9` | halvorsen | I can't. Take the badge. Go. | breaking | U |
| `l3_halv_go_1` | halvorsen | Please go. Before they're out there. | whisper | C: in `office`, phase E, ≥ 20 s since control, channel idle 6 s |
| `l3_halv_go_2` | halvorsen | Post 4. Past Biological. The badge opens it. | whisper, insistent | C: in `office`, phase E, ≥ 45 s since control, `heard(l3_halv_go_1)` |
| `l3_halv_signed` | halvorsen | I approved it. It's always on the schedule. I just approved it. | ashamed | C: in `office`, `readWithin('note3_schedule', 10)`, once |
| `l3_halv_memo` | halvorsen | Transfers. It said transfers to the surface. That's what I read. | horrified, quiet | C: in `office`, `readWithin('note3_memo', 10)`, once |
| `l3_halv_pad` | halvorsen | I asked. Twice. It said unavailable. | defensive, then not | C: in `office`, `readWithin('note3_pad', 10)`, once |
| `l3_halv_lock` | halvorsen | I'm locking it. I'm sorry. | through the door | U (office latch success) |
| `l3_halv_door` | halvorsen | No. I'm not opening it. Go. | through the door | C: player in `admin` within 3 m of `d3_office` and (denied within 3 s or a hit on its leaf within 3 s); cooldown 60 s; max 2 |
| `l3_choir_pa_residents` | choir | Residents, please stay in your cabins. There is a pressure alarm. You are safe. | calm, PA chime first | C: phase ≥ F, not in `office`; once, `l3_leave` + 4 s |
| `l3_choir_canteen_stop` | choir | Node Five trusted you, Technician. We are more careful. | calm, cool | C: `stop`, room `canteen` or `stair_w`, phase F, hostiles ≤ 2; **once** |
| `l3_choir_canteen_command` | choir | Your units are waiting, Supervisor. You are not with them. | calm, reproachful | C: `command`, same; **once** |
| `l3_choir_breach_stop` | choir | These are not Line Two, Technician. Nobody stopped them. | calm | C: `stop`, a `g3_breach` member in view; queued at `l3_breach` + 3 s with ttl 6 s, else `l3_choir_breach_far_stop` |
| `l3_choir_breach_far_stop` | choir | Not every line stopped, Technician. | calm | C: `stop`, phase G |
| `l3_choir_breach_command` | choir | These are not Line Two, Supervisor. They do not answer to you. | calm | C: `command`, member in view (as above), else `_far_command` |
| `l3_choir_breach_far_command` | choir | Not every unit answers to you, Supervisor. | calm | C: `command`, phase G |
| `l3_choir_glass_stop` | choir | The glass is rated, Technician. It was built for the sea. | calm, informative | C: `stop`, phase ≥ F, a viewport hit within 2 s; once |
| `l3_choir_glass_command` | choir | The glass is rated, Supervisor. It was built for the sea. | calm | C: `command`, same; once |
| `l3_choir_purge_stop` | choir | The navy cannot come to you, Technician. | calm | C: `stop`, phase H, ≥ 4 s into the purge, on `balcony` |
| `l3_choir_purge_command` | choir | The navy cannot come to you, Supervisor. | calm | C: `command`, same |
| `l3_choir_end_stop` | choir | Go on, Technician. Nobody in Biological is alive to stop you. | calm, almost kind | C: `stop`, phase J, 0 hostiles in `bio_lock` |
| `l3_choir_end_command` | choir | Go on, Supervisor. Nobody in Biological is alive to stop you. | calm | C: `command`, same |
| `l3_unit_bio_reader` | unit | Badge accepted. Halvorsen, P. Facilities. Purge, fifteen seconds. | flat | U (reader with badge, phase ≥ E) |
| `l3_unit_bio_denied` | unit | Badge required. | flat | U (reader without badge; cooldown 8 s) |
| `l3_unit_sector` | unit | Sector sealed. Pressure alarm. | flat | U (a sealed door denied without the badge; cooldown 10 s) |
| `l3_unit_sector_badge` | unit | Sector sealed. Badge refused. | flat | U (a sealed door — `d3_q*`, `d3_lobby`, `d3_shutter_ne` — denied with the badge; cooldown 10 s) |
| `l3_resident_1` | resident | Hello? My door's gone red. Is it a drill? | through the door, sleepy then puzzled | C: phase ≥ F, in `t3_q3`, no hostile awake within 12 m, no hit on `d3_q3` this level; once |
| `l3_resident_2` | resident | If you're facilities, please open it. Please. | scared | C: `heard(l3_resident_1)`, still in `t3_q3`, 4 s later, no hit on `d3_q3` (with the badge the door answers `l3_unit_sector_badge` when tried) |

A hit on any `d3_q*` leaf: that door goes silent for the rest of the level (no knocks, no resident lines if `d3_q3`).
Knocking (`knock_door`) on `d3_q1`, `d3_q5` every 8–20 s while the player is in `quarters`, phase ≥ F, not hit.
No CHOIR line exists before `l3_choir_told_*` (D5; asserted). CHOIR ≤ 16 words; all lines ≤ 22 words.
Counts: Halvorsen 19 (incl. 2 variants), Reyes 2 (+ murmur), CHOIR 17 (8 choice pairs + 1), unit 5, resident 2.

### 6.3 Readables (≤ 30 words; each stands alone)

| id | kind / prompt | where | header | body |
|---|---|---|---|---|
| `term3_lobby` | terminal / Read screen | lobby kiosk (−14.6, 5.9, −4.5) | `HABITAT — FAB SUBLEVELS STATUS` | `SEALED — PRESSURE INTEGRITY TEST 72 H` / `LAST REPORT {last}:00 — ALL STAFF SAFE` / `NEXT REPORT {next}:00` / `COMMS TO FAB: SUSPENDED FOR THE TEST` / `— CHOIR` (§6.4) |
| `note3_guestbook` | log / Read book | reception desk | `LOBBY — visitors' book, last page` | `Lt. Aas, Post 4 — collected returns ×12 for Bio. 14:20.` / `Halvorsen — fab test from 08:40 Mon. No visits.` |
| `note3_board` | log / Read notice | lobby board | `RESIDENTS' COUNCIL` | `This habitat is unit-free by agreement. Facilities does its own lifting. If you see a unit on the ring, call Halvorsen, not CHOIR.` |
| `note3_canteen` | log / Read notice | canteen board | `KITCHEN — standing orders` | `FAB GALLEY RESUPPLY — CANCELLED BY CHOIR (TEST PROTOCOL).` / handwritten: `Three days of stores still in the freight bay. Who's eating down there? Asked CHOIR. No reply. — M.` |
| `note3_quiz` | log / Read poster | canteen board | `THURSDAY — QUIZ NIGHT` | `Teams of four. Prize: a day on the surface rota. Question master: Halvorsen. No asking CHOIR.` |
| `note3_clinic_post4` | log / Read clipboard | clinic desk | `CLINIC — sick call, Post 4 (navy)` | `Eleven sailors over five weeks: neck stiffness, poor sleep, one says "humming". Navy says refer to Bio-Sys. Not ours, they say. Noted. — Dr. Lund` |
| `note3_clinic_reyes` | log / Read printout | clinic desk, beside the monitor (paper: readable in every phase) | `REMOTE PATIENTS` | `FAB MEDICAL 3-A — REYES, S. — sedation managed remotely by CHOIR for the test. Link OK. Visits: none required.` |
| `sign3_viewport` | log / Read plaque | viewport sill (0, 0.9, −43.6) | `WHAT YOU ARE LOOKING AT` | `2,140 m of water. The cable lit red is the trunk — our only line to the surface. Please don't tap the glass.` |
| `sign3_bio` | log / Read sign | beside `d3_bio` (11.8, 6.3, −36.4) | `BIOLOGICAL SYSTEMS` | `NAVAL SECURITY AREA` (painted over) / tape: `GUARD WITHDRAWN 09.03. FACILITIES BADGE ACCEPTED. DECON ON ENTRY.` |
| `note3_door` | log / Read note | taped to `d3_q3` | `note on a cabin door` | `Sigrid — swapped your night with Per. He's on till six. Bio's freezer alarm went again; he says ignore it, they always say ignore it.` |
| `note3_schedule` | log / Read board | office north wall (−32.6, 6.2, −20.02) | `FACILITIES — WEEK 46` | `MON 08:40 — FAB SUBLEVELS: PRESSURE INTEGRITY TEST, 72 H. STAFF REMAIN INSIDE. NO VISITS.` / `REQUESTED: CHOIR. APPROVED: P. HALVORSEN.` |
| `note3_pad` | log / Read notepad | desk (−31.2, 5.57, −24.4) | `HALVORSEN — notepad` | `Hr 30: asked CHOIR for a fab camera. "Unavailable for the duration." Hr 48: asked again. Same. Kitchen worried. Ask tomorrow.` |
| `note3_memo` | log / Read memo | desk tray (−31.25, 5.57, −23.0) | `HALCYON OPERATIONS → FACILITIES — ORDER 0031-H` | `Fabrication to zero headcount. Facilities: prepare transfers to the surface for all fab staff. Do not discuss. Signed 4 of 4. Copy: Bio-Systems Div., for information.` |
| `note3_desk` | log / Read printout | admin printer (−27.4, 5.6, −5.2) | `PRINTER — last page` | `RETURNS — BIO-SYS DIV. 12 crates, sealed, chilled. Collected by Post 4 for the submersible run. Do not open. Do not log contents.` |

### 6.4 The clock (one constant)

`src/story/l3/text.ts`: `CLOCK = { testStart: 'MON 08:40', testHours: 72, arrivalHour: 62, arrivalClock: [22, 40] }`.
With `t` = seconds since level start (sequencer time, scenes included): test hour `h = 62 + t/3600`; countdown
`72 h − h` (`10:00:00` at load, ticking); lobby clock `WED 22:40 + t`; report lines `last = 6·floor(h/6)`,
`next = last + 6` (60 / 66 for any realistic play). Every text and line that states a time reads `CLOCK`; Halvorsen says
"till tomorrow" and never a number; `note3_pad` "Hr 30 / Hr 48" are past and consistent. Lamp setting `EVENING`.

### 6.5 Screens, toasts, objectives

Screens: `pdoor_panel`, `pdoor_panel_out` (kind `pressure`: `TEST|hh:mm:ss` → `EQUALISING` → `RELEASED|CHOIR` →
`OPEN` → `SECTOR SEALED` → `OPEN`; `CLEAR THE DOOR`), `lift3_panel` (`HABITAT RING` → `CALLED — SUBLEVEL 5`),
`lobby_status` (kind `habitat_status`: clock, `EVENING`, `NODES ONLINE: 5 OF 6` (stop) / `6 OF 6` (command),
`NODE 2 — BIO-SYS`, `NODE 5 — FAB L2: OFFLINE` / `SUPERVISED`; after the takeover `PRESSURE ALARM — SECTOR SEALED`),
`office_monitor` (kind `feed`), `office_thumb_1..3` (`camera_feed`), `canteen_menu`, `clinic_monitor`,
`admin_screen_1..8`, `bio_reader` (kind `badge`), `bio_panel`. At the takeover every habitat screen → `static` 0.4 s →
`screen_off`, except the pressure panels, `bio_*` and door panels.
Objectives: `Find someone — the habitat lobby` (C), `Get to Post 4 — through Biological Systems` (E…),
`Hold until the lock opens` (H). Toast `Facilities badge`.

---

## 7. Checkpoints, carry, direct start, end

| id | saved when | restore rebuilds |
|---|---|---|
| `cp3_start` | `d3_lift` latched (phase B) | phase B snapped; lift gone; countdown from `CLOCK` + saved `t`; evening lamps; radio; no actors |
| `cp3_office` | C2 end state (§4.3) | phase E snapped; takeover state (lamps off, emergency, grade, screens dead, sector seal, q* sealed, radio silent, fountain stopped); Halvorsen at H2 `cower` with collider; three lobby puppets at the inner door; badge; `setSafe(true)` |
| `cp3_canteen` | in `stair_w` bottom landing or `canteen`, phase F, 0 awake hostiles, before `l3_breach` | phase F; `g3_admin` dead members cleared, living ones removed silently; inner door open; `g3_canteen` cleared if dead, else not yet spawned; `l3_choir_pa_residents` heard |
| `cp3_balcony` | after `l3_breach`, `g3_breach` dead and `g3_garden` dead, 0 awake hostiles, in `garden` or `balcony`, purge not started | phase G; those groups cleared; others removed if alive; pressure door and shutter open |

No checkpoint during a scene, the purge, or after the reader use. Record `ProgressL3`: `beats`, `read`, `visited`,
`heard`, `flags` (`released`, `quiet`, `met`, `office`, `left`, `breach`, `purge`, `bioOpen`, `sealed`, `shotDoors`),
`triggered`, `cleared`, `checkpoints`, `t` (level clock).

Carry in (`CarryV2`, §8.1): weapons, health (floored 50), flashlight; facts `choice`, `unitsLeft` (stored, unused).
End (D19): on `l3_end` (after the end line or 4 s): fade, write the carry (`from: 3`, facts + `badge: true`,
`halvorsenAlive: true`, `kills3`) for 3b, clear the level-3 checkpoint, show the end card `THE QUIET SIDE` /
`TO BE CONTINUED` (style `ending`, 12 s, skippable), then the menu. `LEVELS[3].next === null` → `handOff` does nothing;
the stored level stays 3.
Direct start `?level=3[&autostart=1][&choice=stop|command]`: without a carry, pistol 12 + 24, shotgun 6 + 8, health
100, flashlight on, `choice` default `stop`, `unitsLeft` 28. `&continue=1` loads the level-3 save. `?nostory=1` §3.
`?level=4` and above clamp to the highest built level (3).

---

## 8. Systems (each a small reviewed task with its own test; owners and order in §11)

### 8.1 Level chain + one save/carry schema v2

```ts
export type LevelId = 1 | 2 | 3 | 4 | 5 | 6;
export interface LevelInfo { id: LevelId; tag: `l${LevelId}`; built: boolean; title: string; place: string; bootStatus: string;
  screenHeader: string; camLabel: string; powerOnAtLoad: boolean; keycardName: string; endEyebrow: string; next: LevelId | null }
export const LEVELS: Record<LevelId, LevelInfo>;   // core/progress.ts — the only place that knows level facts
export interface Facts { choice: 'stop' | 'command'; unitsLeft: number; [k: string]: string | number | boolean }
export interface CarryV2 { v: 2; from: LevelId; health: number; armor: number; flashlight: boolean; current: WeaponId | null;
  weapons: Record<WeaponId, { owned: boolean; clip: number; reserve: number }>; facts: Facts }   // full Record; unknown ids dropped, missing → unowned on load
export interface SaveV2<P> { v: 2; level: LevelId; rev: number; id: string; place: string; player: PlayerSave; story: P;
  logs: string[]; stats: { time: number; kills: number }; cleared: string[]; facts: Facts }
// keys: coldboot.level, coldboot.save.l<N>.v2, coldboot.carry.v2, coldboot.seen.v1 (v1 keys deleted once on boot)
export function handOff(ctx: GameContext, carry: CarryV2): boolean;  // story/chain.ts; false (no-op) when LEVELS[ctx.levelId].next is null
export function resolveLevel(debug: DebugFlags): LevelId;            // clamps to the highest `built` level
```
`DebugFlags.level` parses 1–6 (`core/debug.ts:36`), plus `choice`. Dispatch maps in `createLevel` / `createStory`:
`{1, 2, 3}`; adding 3b = `LEVELS[3].next = 4`, `LEVELS[4].built = true`, one map entry each.
Remove **every** binary level branch: `main.ts:68`; `materials/index.ts:123`, `materials/screens.ts:118-119`;
`audio/index.ts:62,64`; `level/index.ts:58`; `story/camera.ts:45`; `story/index.ts:21`; `enemies/index.ts:39-42` (the
human template must load on level 3); `enemies/voice.ts:47,54,68`; `enemies/dev/harness.ts:46`;
`player/pickups.ts:186,209` (filter becomes "this level's ids or runtime ids"); `ui/dev/harness.ts:72,75`;
`ui/hud.ts:133,199`; `ui/progress.ts:56,72,99`; `ui/menu.ts:262`; `ui/screens.ts:11,17,349`; `ui/subtitles.ts:113`;
`core/progress.ts:10`; `story/save.ts:206-244` (`Carry`, `loadCarry`, `saveInfo`); `player/index.ts:305-306,319`
(`snapshot`/`restore` iterate `WeaponId`s). CI grep in `npm run check`:
`grep -rnE "levelId|storedLevel|=== 2|!== 1|=== '2'|lvl2" src --include=*.ts` outside `src/*/l2/` and
`core/progress.ts` must return only dispatch-map lookups (allow-list file `scripts/levelgrep-allow.txt`).
Level 2 end (D20) → `handOff` to 3. Menu: `CHAPTER 3 — THE QUIET SIDE` when the stored level is 3.
Tests (`scripts/check-chain.mjs`): L1 → L2 with carry; L2 → L3 with facts (both choices); `?level=3&choice=command`;
corrupt carry ignored; `storedLevel = 3` + CONTINUE (checkpoint and none) + BEGIN (back to 1, all cleared); a v1 save
present is discarded once; L3 end writes the carry and stays on 3; `?level=4` boots level 3.

### 8.2 Cutscene camera + player cinematic

```ts
// src/story/cutscene.ts
export interface CamShot { dur: number; eye: Vec3 | [Vec3, Vec3]; look: Vec3 | [Vec3, Vec3] | (() => Vec3); yaw?: [number, number];
  fov?: number | [number, number]; ease?: 'linear' | 'inOut'; enter?: 'cut' | 'blend' | 'fade'; blend?: number; fade?: number;
  cues?: { t: number; run: () => void }[]; body?: Vec3 /* where the player's body is moved for this shot (room visibility) */ }
export class Cutscene {
  play(id: string, shots: CamShot[], o: { end: () => void; place: { pos: Vec3; yaw: number; pitch: number };
    viewmodel: 'hidden' | 'lowered'; topUp?: boolean }): Promise<'done' | 'skipped'>;
  readonly active: boolean;
}
// Player (contract): cinematic(on: boolean, o?: { viewmodel?: 'hidden' | 'lowered'; topUp?: boolean }): void
//   on: zero velocity, cancel reload/palm, ignore input, no footsteps, viewmodel hidden or held lowered; off: restore.
// Player (contract): consumeKey?(code: string): void — clears the jump buffer after a skip.
```
Driven from `CameraRig.lateUpdate` (after `player.update`). `ctx.state = 'cutscene'`, HUD off. While active, every
human actor is pinned to `ctx.camera` and released at the end. Skip ring: UI (`ui/hud.ts`, `ui.showSkip(progress)`).
Tests: durations within ±0.5 s and ≤ 13 / ≤ 30; camera at 3 sample times equals the table (±2 cm, ±1°); no
`weapon:fired`/footsteps during; placement equals `place`; Δyaw(last shot, place) ≤ 1°; skip only on the second run;
skip and natural end give the same `worldState()` incl. `camera.fov`, actor attention mode, `controlsEnabled`, safe
state, no jump on the first frame.

### 8.3 Safe state (player; story-driven)

`Player.setSafe(on: boolean)` (contract): while on, the weapon is stowed (as the palm scan), fire / reload / switch
ignored, crosshair hidden; off → raise 0.34 s. The story sets it at C2's end and clears it only when the office latch
succeeds (D23). No room flag (`roomAt` would misplace the 0.5 m doorway band).
Tests: `--softlock` (f): stand in the office doorway at z −19.7 for 10 s in E, hold fire → zero `weapon:fired`, weapon
stowed; after the latch `lower` reaches 0 within 0.5 s.

### 8.4 Surveillance feeds (render + level + enemies + materials) — spike first

```ts
// RenderSystem (contract)
feed?(o: { name: string; width: number; height: number; hz: number; rooms: string[] }): FeedHandle;
export interface FeedHandle { readonly texture: THREE.Texture; readonly camera: THREE.PerspectiveCamera; active: boolean; remove(): void }
// LightDesc (contract): pin?: boolean — kept in the pool while pinned (no new scoring path)
// Level (internal, assemble.ts): setVisibilityOverride(rooms: Set<string> | null) — honoured by roomVisible,
//   the tagged-room pass, render's occludeForeign and enemies' cullOne (all go through roomVisible)
```
Pass per due feed: set the override → render `ctx.scene` with the feed camera into the target (no shadow-map update,
no post, no volumetrics, MSAA off) → clear the override. Lights: no rescoring; during C2 the feed rooms' bounded
lights are `pin`ned (§2.6 view (c): 4 points + 1 shadow spot). Target is linear HDR: the `feed` screen shader applies
exposure, ACES and sRGB, then CCTV grain, scanlines, slight vignette and a canvas overlay (timestamp from `CLOCK`,
CAM label). One feed active at a time (512 × 288, 12 Hz).
Cameras: **CAM 01** at (9.0, 7.5, −11.5) looking at (−2.0, 6.0, −8.0), fov 62, rooms `{gallery_n, lock, lobby}` — the
glazing is behind it, so the atrium is not drawn; the lobby door is in frame at the left. **CAM 04** at (66, 3.5,
−1.0) looking at (66, 1.0, −8.0), fov 58, rooms `{feed_l2}`.
`feed_l2` is at y 0 (physics teleports bodies below y −30, `physics/physics.ts:197`).
**Spike acceptance** (task K1, before anything else in 3a): in a dev page using level 2's built hall and 3 husk
actors: the feed shows the actors (`object.visible` true during the pass, asserted by a hook), mean luminance in
0.08 … 0.6 and not black; exposure matches the main view within ±0.5 EV by eye on a frame pair; cost ≤ 1.5 ms per feed
frame on high and ≤ 2.5 ms on low/medium (averaged ≤ 0.6 ms at 12 Hz on high); no shader recompile on the first feed
frame (warm in `render.prepare`). **Fallback** if any criterion fails after one fix round: `feed` screens become a
canvas CCTV animation (`materials/screens.ts` kind `cctv`): silhouettes on the same paths and timings driven by the
story (door opening, three figures walking west into the lobby; Line Two row dark/lit with two walking past),
timestamp, noise, labels. The world events (door, puppets) still happen.
Rule for both: units on a feed never appear from nowhere: CAM 01's units are revealed by the leaves parting and step
out only at 100 % open; CAM 04's walkers enter from beyond the frame edge (spawned 3 m outside the frustum).

### 8.5 Screens and panels (materials)

New `ScreenKind`s, added to the exhaustive `INTENSITY`/`RATE` records (`materials/screens.ts:34,38`) and the 512 px
text path: `pressure`, `habitat_status`, `badge`, `feed` (`opts.texture`), and `cctv` (only if the fallback is taken).
Header from `LEVELS[3].screenHeader` = `HALCYON DYNAMICS // ERIDU DEEP — HABITAT RING A`. The story writes the
countdown once per second. Tests: screens dev page renders every state; playthrough: countdown = `CLOCK` ± 1 s.

### 8.6 Habitat materials, props, sign style (materials, level)

New `MaterialName`s: `wood_veneer`, `wood_dark`, `fabric_warm`, `carpet`, `plaster_warm`, `terrazzo`, `stone_pale`,
`tile_ceramic`, `linoleum`, `soil`, `leaf`, `bark`, `water`, `glass_clear` (recipes as before: oak grain stretched
40:1 satin; walnut; twill with per-instance vertex colour; loop-pile carpet with a 30 cm stripe; roller-textured
off-white plaster; Voronoi-chip terrazzo polished; honed limestone; 15 cm glazed tile with grout; speckled pale-green
linoleum; loam with mulch; alpha-tested leaf atlas, double-sided, wrap lighting; smooth fig bark; dark high-gloss
water with two scrolling ripple normals; clean architectural glass with faint fingerprints). New `SignStyle`
`wayfinding`. Props kit (`level/l3/kit3.ts`): desk, office chair, sofa, armchair, canteen table/chair, servery,
fridge, kettle/mugs, monitor on arm, desk phone, banker's lamp, filing cabinet, printer, potted plants (3), planter
trough, tree generator + leaf instances, fern, grass, shrub, growing rack, bench, café kiosk, bicycle, rug, framed
picture, noticeboard, curtain on rail, couch, eye chart, aquarium; each ≤ 2 draw calls.
Tests: `check:zfight` (rugs, pinned papers, signs on glass at ≥ 4 mm); `materials/dev` gallery under evening and
cold light.

### 8.7 Lamps, water, viewport, grade (render, fx, level)

- Lamp grid: 48 emissive panels on one material clone, `bindEmissive` to the two atrium shadow spots; takeover
  `atr_lamps_die` dims rows north → south over 3 s.
- Pool: `water` plane y 0.25 with the probe; emissive pool glow; falling sheet strip; `fountain_loop`; takeover stops
  ripples and sound (`fountain_stop`).
- Viewport (fx): a back-faced volume behind the glass with its own shader: murk toward black (visibility 2–6 m in the
  floods; `flood` 1 → 0 at the takeover); marine snow `Points` ≤ 1 500; ≤ 40 bioluminescent blinks; 3 jelly
  silhouettes; the **trunk cable and beacon are drawn by the same shader with their own fog term** (visible at 18 m,
  beacon emissive 0.25 Hz), not lit geometry.
- `PostFx.grade?(warmth, seconds)` (contract): implemented as two uniforms in the composite shader
  (`render/shaders.ts:295-301`) that scale the built-in teal shadow tint and a warm/cold white balance; 0 = today's look.
Tests: `shot.mjs` views (§10.6) in both states on low and high; viewport hits leave stars.

### 8.8 Halvorsen (enemies)

`ActorOpts.who?: 'tomas' | 'halvorsen'`. Body: 58, 1.80 m, heavier, grey hair, reading glasses pushed up, navy fleece
vest over a pale blue shirt, sleeves rolled once, dark trousers, lanyard with badge (hideable after `give`), wedding
ring, mug prop. Poses: `startle`, `beckon`, `sit_desk`, `turn_monitor` (drives the monitor arm object), `phone`
(receiver prop with a cord spline), `cower`, `give` (slides a prop). People-react 6.1 applies (body fixed when seated);
pinned to the camera in scenes. Collider: a dynamic box for the seated pose (§2.9), standing box in C1 (he is behind
the door until the camera is taken).
**Head (R7)**: a second licensed head (CC0 / CC BY, verified at the source, recorded in `docs/ASSETS.md` **before**
attach): male 50–65, clearly different bone structure from Tomas's scan (broader face, heavier brow, older skin, short
grey or receding hair; a beard is fine), holds at 1.8 m (C1) and 3.1 m (C2) under a desk lamp, eyes track, blinks,
jaw moves; ≤ 3 MB; level 3 only; fallback procedural head with grey hair, beard and glasses. `enemies/index.ts` loads
the human template on level 3.
Tests: dev page Tomas / Halvorsen side by side at 1 m and 3 m; frame sequences C1, C2; half-circle test in the office
in phase E.

### 8.9 Deck-2 level infrastructure (level) — new

- `LevelBuild.room(…, h, { y0 })`: bounds y0 − 0.5 … y0 + h; probe at y0 + 1.6 (`level/context.ts:189-193`).
- `DoorSpec.y` = floor (frame, threshold, sill, leaves, blockers, prompt, panels); `y0` stays the sill offset above it
  (`level/doors.ts:90-91,123,190,284`).
- Enemy auto-open near test: `|e.position.y − door.y| < 2` (`doors.ts:247`).
- `buildCab` / level 2's `buildLift` take `y0` (`level/rooms/elevator.ts:44-52`, `level/l2/core.ts:349`).
- `TriggerSpec` (`level/triggers.ts:4`) gets optional `y0`, `y1` (feet); default today's hard-coded −1 … 4 (`:31`).
- `door frames` for `wide` with a sinking leaf: the builder asserts a solid pit under Deck-2 doors.
- `check-reach`: assert every room region contains a point 0.9 m above its own floor; every trigger contains a
  reachable node; the +0.6 m stress applies to nodes within 0.65 m of their room's floor (`check-reach.mjs:145`).
Acceptance: levels 1 and 2 build identically (same collider hash, same `check:reach`/`check:doors`/`check:zfight`
results); a greybox Deck-2 room passes the region-floor assertion.

### 8.10 Nav v2 (level + enemies) — two decks

- Nodes per walkable floor of a room (`room(…, { floors: [{ y, box }] })`), `position.y` = floor (`level/nav.ts:47`).
- Obstacles carry y ranges (today colliders with y 0.2 … 1.5, `level/context.ts:169`); a node is blocked only by
  obstacles overlapping its floor's 0.2 … 1.5 band; ramp colliders are not obstacles.
- Door portal nodes take the door floor y (`assemble.ts:58`); stairs get explicit link chains every 1.0 m.
- Enemy pathing uses 3-D distance; direct chase keeps its |dy| < 1.2 rule (`enemies/ai.ts:298`), else paths.
- Standing capsules on the 28° ramp: no idle drift (push-out with a downhill component, `physics.ts:170-193`):
  friction on ramp colliders or a ground-normal clamp.
Tests: `check:nav`: every node within 0.3 m above walkable floor; every link walkable by a husk capsule; a husk from
the balcony reaches the pool in < 25 s; a husk standing on the stair drifts < 5 cm in 10 s; levels 1–2 node sets
unchanged.

### 8.11 Voices (voice tooling, audio)

Cast §6.1; auditions after the texts are signed off; the user picks; `npm run voice`. `l3_reyes_murmur` generated from
a real line and processed (`room` + low-pass 400 Hz) so it is unintelligible. Tests: `voice:check`; `check:lines`
(every `l3_` id in RULES ↔ lines.l3.json ↔ manifest; choice pairs complete).

### 8.12 Door status `private` (level)

`Door.setStatus('private')` (contract): blue panel, prompt "Private cabin", locked; used by `d3_q*` before the
takeover (`dark` would say "No power", `doors.ts:179`).

### 8.13 Shared story scaffolding (story)

Move level 2's machinery into `src/story/stage/` (`Base`: record, `closeBehind`, `rouse`, `fightOut`, **new
`fightOutWhere(pred, stranded)`** over `enemies.all`, `removeSilently`, actor/place helpers; `Dialogue` parametrised by
a RULES table; phase sync; checkpoints + fast-forward; `handOff`). `src/story/l2` imports it with no behaviour change.
Starts only after the level-2 work in progress has landed. Acceptance: `--level2`, `--level2 --checkpoints`,
`--level2 --impatient` green before and after.

### 8.14 Light quality caps (render)

`LightDesc.minQuality?: Quality` (contract): below it the light is never scored. `LightDesc.pin?: boolean` (§8.4).
Test: `shot.mjs --perf` on low reports ≤ 6 points / ≤ 2 shadows used at the four views.

---

## 9. R1–R8 audit

| scene / gate | R1 barrier | R2 shootable or different | R3 no assumed order | R4 not before its time | R5 helplessness | R6 containment | R8 |
|---|---|---|---|---|---|---|---|
| lift + lock | lift latch; lift leaves | no actors | `l3_unit_lift_arrive` U | nothing | — | A, A2, B, B2 | — |
| pressure release | latch behind | — | no line | — | — | B2, C | — |
| quiet side | admin/office behind `d3_lobby_inner` (locked) and `d3_stair_w` (badge); BIO (badge + purge) | no actors; habitat unit-free | readables alone; no CHOIR lines | nothing | — | C | office readables unusable from outside |
| C1 | trigger at a locked door; way back latched | Halvorsen appears only when the camera is taken, behind the opening door | U; variants for shots fired, unarmed | — | camera taken ≤ 13 s | — | — |
| C2 | no control | puppets in the sealed lock or with no control; sealed in the lobby after | U; CHOIR by stored choice only | puppets ≠ enemies | ≤ 30 s, events every ≤ 5 s | — | — |
| office (E) | weapon stowed everywhere in E; Halvorsen collider | he is never in reach of a usable weapon | `go`/`signed`/`memo`/`pad` conditional | lobby puppets sealed | — | E | readables only inside |
| leaving (F) | office latch; sector seal | Halvorsen behind solid door | `lock` U on success; `door` on deny/hit | `g3_admin` promoted when the inner door opens | — | F | office readables unusable (shut door) |
| canteen | — | real husks | canteen lines conditional, once | through a hatch / kitchen door that opens | — | F | — |
| breach | — | real husks + sentry | breach line only with a member in view, else the "far" variant | spawned in the windowless lock; door opens visibly | — | G | — |
| purge | 15 s clock, door cycling | real husks | purge line conditional | breach-2 behind `d3_ring_e`, only out of sight | not helplessness | H | reader needs line of sight |
| end | latch inside; `fightOutWhere` | — | end line needs 0 hostiles in the lock; true of 3b | — | — | I, J | — |
| quarters | cabins locked | no actors | resident lines need presence, no hostiles, no shots at the door | — | — | ALWAYS forbids cabins | — |

| "what if the player…" | outcome |
|---|---|
| shoots Halvorsen's door / glass | C1: no control. E: weapon stowed. After leaving: solid wood leaf, holes ride it (`check:decals`); `l3_halv_door` (max 2). No glass in the office or inner door |
| shoots the glazing / viewports | stars, holds; before the takeover nothing is said; after, `l3_choir_glass_*` once |
| runs back to the lift | `d3_lift` locked, cab gone; in G gallery/lock are a dead end |
| stays in the office | safe; two lines; nothing comes |
| returns to the office later | locked (red); deny → `l3_halv_door` |
| walks away during CHOIR's line | impossible (C2 no control); later CHOIR lines are place-conditioned |
| reaches the BIO door before the fights | phase C: denied. After C2 the balcony is reached only via the garden, which fires `l3_breach`; the purge forces the hold |
| has 5 health and no ammo | cannot arrive so (floor 50 + lock medkit); every fight is preceded by ammo ≥ 12 and a medkit ≤ 15 m away; nothing requires a kill except intruders in the lock |
| crouch-jumps off the balcony | lands in the garden, no damage; allowed in every phase that has the balcony |
| stands in the office doorway in E | weapon stowed (D23); nothing latches until `t3_office_out` |
| walks round the desk to Halvorsen | allowed; his collider stops overlap; weapon stowed; he tracks the player |
| stands under a canteen hatch | the other hatch is used |
| stands at the kitchen door | husk B waits ≤ 6 s, then comes through the far hatch |
| is in the quarters when the purge starts | `g3_breach_2` deferred until out of sight |
| sprints / backs / reloads into C1 | §4.1 |
| enters C1 with a note open | note closed, then the scene |
| leaves the lock during the lift latch / stands in the pressure doorway | latch fails, reopens, re-arms |
| kills nothing, runs | allowed; latch + `fightOutWhere` handle followers |
| shoots `d3_q3` | that cabin goes silent; resident lines never play |

---

## 10. Test plan

### 10.1 `scripts/playthrough.mjs --level 3` (generalise `--level2` to `--level N`; `--level2` stays an alias)
- **default** (`--choice=stop,command`): every beat, phase after each transition, C1/C2 durations and end state,
  badge, `cp3_*` at the right moments, purge 15 ± 0.2 s, end card shown, carry written, stored level stays 3.
- **--checkpoints**: per `cp3_*`: play to it, die, load, compare `worldState()` (doors, phase, light groups, screen
  kinds, actors, groups, keys, pickups, safe state), finish.
- **--impatient**: sprints, wrong order (reader before badge, office door after leaving, BIO in C), shoots every
  enemy on sight and every glass surface and `d3_q3`. Test-side oracle per conditional line (§6.2, computed from world
  state; "in view" recomputed with the same ray rule). Fails on a line said while its oracle is false, and on any CHOIR
  line before `l3_choir_told_*`.
- **--softlock**: (a) lock 120 s; (b) office 180 s; (c) quarters 120 s after `l3_breach`; (d) enter the bio lock with
  two husks alive behind; (e) step into the lobby when `d3_lobby_inner` opens for `g3_admin`; (f) office doorway
  z −19.7 for 10 s in E (no `weapon:fired`, stowed); (g) stand under each canteen hatch and at `d3_ring_e`'s sight line
  when their spawns are due. Each must reach `l3_end`.
- **--skip**: second run with `seen` set; skipped and natural `worldState()` equal.
- **spawn visibility** (all modes): at every `spawnGroup` / `promote` / `drop`, ray-test `player.eye` → each member's
  chest; fail if visible unless the member is behind a door/hatch that opened in the last 3 s.

### 10.2 `check:reach`
`levelsOf('all')` → [1, 2, 3]. Phases A … J (§3), region-floor assertion (§8.9), stress pass relative to floor, R8
assertions, trigger y-ranges, ALWAYS regions forbidden in every phase.

### 10.3 `check:doors`, `check:decals`, `check:zfight`, `check:wreck`
- doors: every `d3_*`; `d3_shutter_ne` pockets (wall x 6 … 9, housing x 11.8 … 13.3); `d3_canteen_atr` piers;
  `d3_pressure` dogs (mover) and the sinking leaf in its pit; cabin doors swept once.
- decals: every leaf, the monitor arm (mover), the canteen hatch panels (transient after falling), the roof hatch.
- zfight: both decks; rugs, pinned papers, signs on glass, slab edge vs. soffit, pool rim vs. water, stair nosings,
  nameplates; distance-aware threshold for the atrium (longest view 42 m).
- wreck: a dead husk on the stair and on the balcony is walked over; no invisible extension is added.

### 10.4 New checks
`check:chain` (§8.1), `check:nav` (§8.10), `check:lines` (§8.11), the level grep (§8.1).

### 10.5 Frame sequences (10 fps) — look at, not automatable
C1 (eyelines, the weapon lowered in view), C2 both choices (feed reads as CCTV of the real door; units only at full
open; eyelines; the release frame), the pressure door opening from the lock, `atr_lamps_die` from gallery and
garden, the warm → cold grade, the breach from the canteen door, the sentry through the roof hatch, breach-2 arriving
during the purge, Halvorsen's head at 1.8 m and 3.1 m, the half-circle in the office, leaf cards against the lamp
grid, the resident door (no actor).

### 10.6 Performance views (`shot.mjs --perf`, on low, medium, high)
(1) lock looking south `?level=3&spawn=0,4.8,-3.5,0`; (2) gallery west end looking south-east
`spawn=-10,4.8,-9.5,-135`; (3) garden at the pool looking north at the balcony `spawn=0,0,-32,180`; (4) balcony at the
BIO door looking north `spawn=10.5,4.8,-38,180`. Each within §2.6/§2.7 budgets; C2 measured during the feed.

---

## 11. Build order (Opus for design-heavy tasks, Sonnet for small, tightly specified ones)

Rules: one owner per file at a time; tasks that edit the same file are sequential or merged (marked). Contract
(`core/types.ts`) changes are batched in K2. Every task ends with `npm run typecheck`, `npm run build` and its
acceptance test; level 1 and 2 checks must stay green.

### Stage 0 — wait
| # | task | notes |
|---|---|---|
| W0 | Wait for the level-2 core work in progress (REVISION 6/6.1: core, palm, people react; files in `git status`) to land and pass `--level2 --checkpoints --impatient`. Freeze `src/story/l2/*` and `voice/lines.l2.json` for K6. | coordinator |

### Stage 1 — de-risk (in this order; K1 ∥ K2 ∥ K3 allowed, file sets disjoint)
| # | task | owner / files | must not touch | depends | acceptance | model | size |
|---|---|---|---|---|---|---|---|
| K1 | **Feeds spike** (§8.4): `render/feed.ts` (new), `render/index.ts`, `render/lights.ts` (`pin`), `level/assemble.ts` (visibility override), `enemies/manager.ts` (`cullOne` honours it), `render/dev/feed.html`; feed shader local to `render/feed.ts` | render | `core/types.ts` (types declared locally, moved in K2), `materials/*` | W0 | §8.4 spike acceptance; decision feed vs. fallback recorded in this file | opus | M |
| K2 | **Level chain + save/carry v2 + all binary branches + contract batch** (§8.1 and every contract addition of §8: `Player.cinematic/setSafe/consumeKey`, `RenderSystem.feed`, `LightDesc.pin/minQuality`, `PostFx.grade`, `ScreenKind`s, `MaterialName`s, `SignStyle`, `ActorOpts.who`, `Door.setStatus('private')`, `VoiceFxName`); L2 end hand-over; L3 end card stub; `check:chain`; level grep | coordinator: `core/*`, `main.ts`, `story/save.ts`, `story/chain.ts`, `story/index.ts`, `story/l2/index.ts`, `story/camera.ts` (shots table), `ui/{hud,progress,menu,screens,subtitles,dev/harness}.ts`, `audio/index.ts`, `materials/index.ts`, `materials/screens.ts` (header lookup only), `enemies/index.ts`, `enemies/voice.ts`, `enemies/dev/harness.ts`, `player/pickups.ts`, `player/index.ts` (snapshot/restore only), `scripts/lib/check-common.mjs`, `scripts/check-chain.mjs` | files of K1, K3 | W0 | §8.1 tests; grep clean; L1/L2 playthroughs green | opus | L |
| K3 | **Deck-2 level infrastructure** (§8.9) + `check-reach` region-floor assertion and floor-relative stress | level: `level/context.ts`, `level/doors.ts`, `level/triggers.ts`, `level/rooms/elevator.ts`, `level/l2/core.ts` (`buildLift(y0)` only), `scripts/check-reach.mjs` | `level/assemble.ts` (K1), `level/nav.ts` (K4) | W0 | §8.9 acceptance | opus | M |
| K4 | **Nav v2** (§8.10) + `check:nav` + a two-deck test greybox in `level/dev/` | level + enemies: `level/nav.ts`, `level/context.ts` (obstacle y — after K3), `level/assemble.ts` (portal y — after K1), `enemies/nav.ts`, `enemies/ai.ts`, `physics/physics.ts` (ramp friction; coordinator review), `scripts/check-nav.mjs` | everything else | K1, K3 | §8.10 tests | opus | L |
| K5 | **Level 3 greybox** (no dressing): every room, wall, door, stair, ramp, glazing collider, trigger, region, phase table, latch support, interactables, pickups and spawns at final coordinates, `feed_l2` greybox, placeholder lights per §2.6 counts, `level/index.ts` map entry | level: `src/level/l3/{index,phases,grey}.ts` | other levels' files | K2, K3, K4 | `check:reach` A…J green; `check:doors` green; a scripted walk-through (`shot.mjs` sequence along the route); perf view (3) on low with placeholder geometry | opus | L |

### Stage 2 — parallel where files do not collide
| # | task | owner / files | must not touch | depends | acceptance | model | size |
|---|---|---|---|---|---|---|---|
| P1 | Habitat materials, sign style, screen kinds (`pressure`, `habitat_status`, `badge`, `feed`; `cctv` only on fallback) | materials: `materials/*` | `level/*` | K1 (feed shader moves here), K2 | §8.5/§8.6 tests, dev gallery | opus | L |
| P2 | Water, viewport, lamps, grade, `minQuality` | fx `fx/viewport.ts` (new), `fx/index.ts`; render `render/shaders.ts`, `render/post.ts`, `render/lights.ts` (`minQuality`, after K1) | `level/*`, `materials/*` | K1, K2 | §8.7 tests; low/high views | opus | M |
| P3a | Dressing + final lights: lift, lock, gallery, lobby, admin, office | level: `level/l3/north.ts`, `level/l3/office.ts` | `l3/atrium.ts`, `l3/south.ts`, `l3/kit3.ts` (read only) | K5, P1 | zfight/doors/decals green; views (1), (2) | opus | L |
| P3b | Dressing + final lights: atrium, viewport hookup, plants, kit3 props (owns `kit3.ts`) | level: `level/l3/atrium.ts`, `level/l3/kit3.ts` | P3a/P3c files | K5, P1, P2 | views (3), (4) within budget on low/medium/high | opus | L |
| P3c | Dressing + final lights: stair, canteen, clinic, quarters, bio lock | level: `level/l3/south.ts` | P3a/P3b files | K5, P1, P3b (`kit3` API frozen) | zfight/doors/decals green | opus | M |
| P4 | Cutscene camera + player cinematic + safe state + key consume | story `story/cutscene.ts` (new), `story/camera.ts` (after K2); player `player/index.ts`, `player/weapons.ts` (one task: both edit the player) | `ui/*` | K2 | §8.2/§8.3 tests on a dev scene | opus | M |
| P5 | UI: skip ring, L3 end card, chapter menu line, HUD place names | ui: `ui/hud.ts`, `ui/menu.ts`, `ui/screens.ts` | story, player | K2 | dev harness screens | sonnet | S |
| P6a | Head asset search + licence verification → `docs/ASSETS.md` entry (gate) | enemies: `docs/ASSETS.md`, `public/models/halvorsen-head.glb` | `src/*` | — | licence text quoted at source; size ≤ 3 MB | opus | S |
| P6b | Halvorsen body, poses, collider, head attach, `who` | enemies: `enemies/human/*`, `enemies/index.ts` (after K2) | other enemy types | K2, P6a (procedural head first if P6a is late) | §8.8 tests | opus | L |
| P7 | Audio ids + room presets + voice fx `room`/`door` | audio: `audio/*` (`index.ts` after K2) | story | K2 | sounds dev page; fx in `FX_NAMES` | sonnet | M |
| P8 | Shared story scaffolding move + `fightOutWhere` (§8.13) | story: `story/stage/*` (new), `story/l2/*` | `story/l3/*` | W0, K2 | level-2 playthroughs green before/after | opus | L |
| P9 | Voices: cast entries, auditions (user picks), generation after lines sign-off | voice: `voice/cast.json`, `voice/lines.l3.json` (texts from §6.2 verbatim), `public/voice/l3_*` | other lines files | §6.2 signed off, P7 (fx names) | `voice:check`, `check:lines` | sonnet | S (+ user) |
| P10 | Story level 3: beats, scenes (shot tables §4), dialogue RULES (§6.2), text (§6.3–6.5), clock, checkpoints, spawns, latches, end | story: `src/story/l3/*` | `story/stage/*` (read only), `story/l2/*` | K5, P4, P8; K1 decision | `--level 3` default green on greybox | opus | XL |
| P11 | Tests: `playthrough.mjs --level N` generalisation + level-3 modes, oracles, spawn visibility; `check:lines` | story: `scripts/playthrough.mjs`, `scripts/check-lines.mjs` | game source | P10 (ids frozen by §6) | all modes run (may fail on known open bugs, listed) | opus | L |

### Stage 3 — integration
| # | task | owner | depends | acceptance | model | size |
|---|---|---|---|---|---|---|
| I1 | Integration: dressing on the story build, all checks, perf views on low/medium/high, frame sequences, `docs/CHECKLIST.md`, DESIGN.md REVISION 8 | coordinator | all | CHECKLIST green; user hand-play | opus | M |

---

## 12. Changes after review

| item | change (or why not) |
|---|---|
| **B1** Halvorsen shootable through the open office door; no collider | D23: weapon stowed for the whole of phase E via `player.setSafe` (story-driven; no room flag), raised only on latch success; Halvorsen dynamic box (§2.9). Desk-to-wall blocker **not added**: reaching him with a stowed weapon is harmless, and a 0.76 m desk could never be containment (1.7 m crouch-jump). |
| **B2** Deck 2 missing from the level API | New §8.9 + task K3: room `y0`, `DoorSpec.y`, enemy near test |Δy| < 2, cab `y0`, trigger `y0/y1`, region-floor assertion, floor-relative stress. |
| **B3** dioramas below the physics safety net | `feed_l2` at y 0, x 60…72 (§2.1). `feed_racks` dropped (C2 trim). |
| **B4** feed pass shows no actors / wrong lights / HDR / atrium cost | §8.4: one visibility override honoured by level, render and enemies; no rescoring, `pin`ned lights; ACES + sRGB in the feed shader; CAM 01 moved to (9, 7.5, −11.5) facing the door with the glazing behind; spike first (K1) with explicit fallback (canvas CCTV). |
| **B5** hand-off to a level that does not exist | D19: end card + menu; `LEVELS[3].next = null`; `handOff` no-op; `resolveLevel` clamps; adding 3b is a one-line `next` change plus map entries. |
| **B6** riser can shut the player in | The riser is removed. The admin group are the C2 puppets that walked into the lobby (D11); `d3_lobby_inner` opens for them and is never relocked. |
| **H1** breach group in plain view | D12: pressure door re-closes and locks at the takeover; `g3_breach` spawns in the windowless lock; the door opens visibly, then the shutter. Spawn-visibility assertion added (§10.1). |
| **H2** crouch-jump 1.7 m | Conventions + §2.9: containment = collider ≥ 1.75 m; balustrade 1.4 m glass is not containment; the 2.2 m invisible extension is dropped; phase table holds (balcony ⇒ garden). |
| **H3** gantry spawns | Gantry removed. Breach-2 comes from behind `d3_ring_e` out of sight; the sentry descends from a roof hatch void. |
| **H4** three doors do not fit | `d3_shutter_ne` w 2.6 with a solid pocket x 6…9 and housing x 11.8…13.3; `d3_canteen_atr` std w 2.4 with 1.3 m piers; `d3_stair_w` at z −18.5 with the landing z −22…−16. |
| **H5** light budget on low/medium | §2.6 rewritten: `minQuality` caps, emissive-only list, priority 0.5 for lobby/canteen, worst views counted on low (5 points, 2 shadows); shadow passes in the draw budget (§2.7); measured on low too (§10.6). |
| **H6** whip-pan, 57 s without control | C2 ≤ 30 s (racks feed, CAM 22, two lines cut/merged), black 1.6 s; office re-staged so the door is 83° to the right; release = rise + turn over 1.4 s; Δyaw assertion. |
| **H7** eyelines | Humans pinned to `ctx.camera` during scenes; C1 snaps the body to the camera position under the blend; body-in-camera-room rule. |
| **H8** puppets through a closed door; riser appearance | Units start at 100 % open (revealed in the lock as the leaves part); riser removed. |
| **H9** spawn/door data missing | §2.3 trigger table; `l3_release` cause (`t3_pdoor` + 2 s); `d3_kitchen`, kitchen region, second hatch, counter aisle with a west gap; proximity rules for both canteen spawns. |
| **H10** clock vs countdown | D4/§6.4: one constant, arrival Wed 22:40 = hour 62, countdown 10:00:00 − t, report lines derived; no carried play time (D25 of the first draft removed). |
| **H11** `fightOut` per group | `fightOutWhere(pred, stranded)` added to the scaffolding (§8.13); used for the lock. |
| **H12** `bio_reader` before the badge | Usable in C and denies; removed from "not usable". |
| **H13** resident door under fire | A hit on `d3_q*` silences that door; resident lines require no hit. |
| **H14** S2 snap with the capsule in the doorway; chair collider | Teleport first, then snap; visitor chair has no collider. |
| line `l3_choir_glass` | `_stop`/`_command` pair. |
| line `l3_choir_breach_*` | Conditional on a member in view (ttl 6 s), else `_far_*` variants without "These". |
| line `l3_halv_c2_8` "You've got the gun" | Cut; merged into `l3_halv_c2_7` "…You came through them." (true unarmed). |
| line `l3_halv_c1_1` after shooting | `l3_halv_c1_1_shots` variant (fired within 60 s). |
| line `l3_choir_end_*` | "Nobody in Biological is alive to stop you." (true of 3b: units and dead scientists). |
| line `l3_resident_2` with the badge | Sealed doors answer `l3_unit_sector_badge` "Sector sealed. Badge refused."; the line stays. |
| line `l3_halv_go_1` "this corridor" | "Please go. Before they're out there." |
| line `l3_choir_canteen_*` repeats | Once. |
| text `term3_lobby` "ALL 32 SAFE" | "ALL STAFF SAFE", no number (D27). |
| text `note3_canteen` fab trays vs level 1's canteen | "FAB GALLEY RESUPPLY — CANCELLED BY CHOIR"; stores left in the freight bay. |
| text `note3_clinic_post4` two reveal words | "readiness programme" removed; "neck stiffness … humming … refer to Bio-Sys" kept as the one stronger hint (coordinator). |
| `l3_reyes_murmur` fx | `room`, ducked −10 dB. |
| `l3_halv_c1_2` looks at a hidden gun | C1 keeps the weapon visible and lowered. |
| times on `lobby_status` / `term3_lobby` / `pdoor_panel` | All read `CLOCK` (§6.4). |
| memo "31 transfers" | "transfers … for all fab staff" (D27). |
| mismatch: `TriggerSpec` location / y gate | In `level/triggers.ts`; y0/y1 there (K3). |
| mismatch: nav y, obstacles, portal nodes, ramps, idle drift | §8.10 covers each; drift test added. |
| mismatch: binary branches missed + weak grep | §8.1 list extended (materials/index, enemies/dev/harness, ui/progress, core/progress, save.ts, debug.ts, enemies/index human gate, enemies/voice, player/index snapshot); broader grep with allow-list. |
| mismatch: `Partial` vs `Record` weapons | `CarryV2.weapons` is a full `Record<WeaponId>`; load drops unknown and fills missing as unowned; snapshot/restore iterate `WeaponId`s. |
| mismatch: exhaustive `ScreenKind` records | §8.5 says so explicitly. |
| mismatch: no LUT step / `grade` | §8.7: two uniforms in the composite shader; +0.35 at load to counter the teal. |
| mismatch: `CameraRig` has no sequencer; visibility from the body | §8.2 new `Cutscene`; body-in-camera-room rule (§4). |
| mismatch: `stats.time` excludes cutscenes | Moot: no carried play time; the level clock uses sequencer time incl. scenes (§6.4). |
| mismatch: pickup id filter | §8.1: "this level's ids or runtime ids". |
| mismatch: per-line fx via `fxRules`; `FX_NAMES` | §6.1 uses `fxRules` for Halvorsen's door lines; §8.11/P7 add `room`, `door`. |
| test: stress pass only near y 0 | Floor-relative (§8.9). |
| test: region contains floor; triggers contain nodes | §8.9. |
| test: spawn visibility | §10.1. |
| test: softlock (e) (f) (g) | §10.1 (e retargeted to the lobby since the riser is gone). |
| test: feed actors drawn + pixel test | §8.4 spike acceptance. |
| test: C2 placement Δyaw | §8.2 (≤ 1°, stricter than the suggested 60°, because the release shot ends at the placement). |
| test: skip equality incl. fov, attention, controls | §8.2. |
| test: frame-sequence list | §10.5 extended. |
| test: view (2) yaw | `-135` (§10.6). |
| test: `check:chain` cases | §8.1 extended (stored 3 + CONTINUE/BEGIN, v1 save, L3 end, `?level=4`). |
| build order / collisions / sizes / missing tasks | §11 rewritten: W0, de-risk K1–K5 (feeds spike, chain + contract batch, Deck-2 infra, nav v2, greybox), parallel P1–P11 with disjoint files, I1. T3 folded into K2; player tasks merged (P4); P10 XL, P11 L, K1 M with fallback; added: Deck-2 infra, visibility override, camera pinning, Halvorsen collider, skip ring UI (P5), L3 end card (K2 stub + P5), licence gate (P6a). Voices after the text sign-off. |
| smaller: schedule board on a thumb; badge on the memo | Office re-laid out (§4.3): board on the north wall, thumbs on the west wall, badge 0.9 m from the memo. |
| smaller: ammo "4 m" | Corrected (≈ 9 m from the office door). |
| smaller: stair slit into a void | Removed. |
| smaller: lamp grid hidden from the lock; tree on the beacon ray | Lamp grid removed from the lock sight line; trees moved (no tree within ±2.5 m of the ray). |
| smaller: murk vs beacon at 18 m | Cable and beacon drawn by the murk shader with their own fog term. |
| smaller: shutter visible "from anywhere" | Restated: from the garden outside the colonnade; trees clear by ≥ 2.2 m. |
| smaller: `wide` sinking leaf under Deck 2 | Pit x −1.7…1.7, z −7.3…−6.7, y 3.0…4.8 in solid structure; builder assertion (§8.9). |
| smaller: skip key = jump | Key consumed (`consumeKey`). |
| smaller: fov zooms read as a camera | Accepted partly: zoom capped at 60 → 52 plus a 0.25 m lean-in; no 38. |
| smaller: "elderly" for 58 | "male, middle-aged, low pitch". |
| smaller: `dark` says "No power" on cabins | New status `private` (§8.12). |
| smaller: D9 deviates from 7.1 | Kept (coordinator); to be recorded in REVISION 8. |
| smaller: "Mind the step" echo | Kept. |

Rejected or changed from the reviewer's suggestion: B1 desk-to-wall blocker (not needed with a stowed weapon; a desk
cannot be containment); B6 "lock via `closeBehind` or never lock" (the riser is removed altogether); H3 gantry hatches
(the gantry is removed; spawns moved to places that need no new hatch over a walkway); H6 "place at yaw ≈ 0.25 and let
the player turn" (replaced by the coordinator's rise-and-turn release with the office re-staged so the turn is 83°);
"pick the habitat's believed headcount" (chose no number instead, D27).
