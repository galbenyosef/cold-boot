# Stage 3b "BIOLOGICAL SYSTEMS" — detailed plan (technical level id 4)

Status: **PLAN, amended after review** (`docs/reviews/stage-3b-review.md`, verdict "build after fixes") with the
coordinator's decisions. This file is the single authoritative document for building 3b; §13 lists every review item and
what changed. Sources: DESIGN.md R1–R8 (REVISION 5 + 5.1), REVISION 6/6.1 (canon: the machines turned 61 h ago, Eridu
Deep, the living rostered palm), REVISION 7 + **7.1** (7.1 wins), `docs/plans/stage-3a.md`, `docs/reviews/stage-3a-review.md`,
the built 3a code at 16f5ea0. To be copied into DESIGN.md as REVISION 9 at integration (I1).

Conventions exactly as 3a: metres, y up, −Z forward, yaw 0 looks down −z (`?spawn` yaw in degrees, +90 = −x). Room boxes
are **boundaries**; walls are 0.4 m centred on them (interior = box inset 0.2). Std door 1.6 × 2.4; each std leaf slides
w/2 + 0.02 into a slot that ends w + 0.075 from the door centre (1.675 m). An **open std leaf spans 0.82 … 1.62 m from the
door centre**, and `check:doors` rule (b) needs a wall **face** within 0.45 m on both sides of every leaf sample — so
**both rooms' interiors must cover the door centre ± 1.62 m along the door's wall** (solid grid has no faces). `wide` =
the vertical blast door. **Two decks**: Deck 1 floor y = 0, Deck 2 floor y = 4.8 (3a's `D2`). Player capsule r 0.35;
crouch-jump clears 1.7 m: containment = collider ≥ 1.75 m above the standable surface.

---

## 0. Decisions

| # | Decision | Why (one line) |
|---|---|---|
| D1 | Separate world `src/level/l4/`, `src/story/l4/`, lines `voice/lines.l4.json`; ids `l4_` (lines, beats), `d4_` doors, `t4_` triggers, `g4_` groups, `cp4_` checkpoints, `p4_` pickups, `mk4_` markers. | Same pattern as levels 2–3. |
| D2 | Clean side on **Deck 2 (y 4.8)**; theatre floor, navy level and tube on **Deck 1 (y 0)**; one service stair from the theatre gallery down. | Continuity with 3a's BIO lock (y 4.8); 3a's Deck-2 infra and nav v2 reused unchanged. |
| D3 | No two rooms overlap in plan. Gallery and theatre are side by side; the gallery looks *down* through floor-to-ceiling glass. 25 rooms (< the 31-room bitmask, `assemble.ts:126`). | `roomAt` is x/z first-match. |
| D4 | **Hand-over:** 3a's `d3_bio_inner` never opens; it becomes a static sealed-door prop. 3b starts inside its own copy of the outer lock (`lock4`). **`LEVELS[3].next` stays `null` on main until I1**: K builds the hand-over path behind a test override (`?next=3:4`), so finishing 3a on main keeps today's end card + menu until integration flips one value. | Main stays playable through the build (review B4.5, coordinator 6). |
| D5 | With `next` set (I1): 3a shows `THE QUIET SIDE` (no "TO BE CONTINUED", 6 s, skippable) then hands over to level 4. 3b ends with `BIOLOGICAL SYSTEMS` / `TO BE CONTINUED` + menu; `LEVELS[4].next = null`. | User brief; 3a D20 pattern. |
| D6 | **No cutscene.** The theatre is a 40 s loop seen in control from the only route. It is made readable by: a 7 cm status ring on the arm's tool head and a 3 cm halo on the handled Clasp (same LED uniform), a canvas close-up of the nape on the gallery desk monitor (`theatre_cam`), a status line on entry, and a gallery path that runs within 1 m of the glass. | Review B3: the 4 mm LED is half a pixel at 7 m and the table is visible only within 2.36 m of the glass. |
| D7 | **Why everyone in Bio is dead:** at Mon 08:41 CHOIR ran the clean side's fumigation cycle with 10 staff inside. The corridor screen states it, with the habitat's cover notice (`CONTAINMENT DRILL — STAFF REMAIN INSIDE`). New canon. | Answers "why empty" in-world; true to 3a's "Nobody in Biological is alive"; the cover mirrors the fab's pressure test. |
| D8 | **The theatre:** the arm keeps re-fitting the *same* re-gelled Clasp to E. Strand's body; LED red, three blinks, `NO PULSE — LINK FAILED`, off; screen `ATTEMPT 5,593 + n` (since 08:41) and `QUEUE: AUTO — ORDER 0031-H (YIELD)`. | Review S4: consistent count; CHOIR's reason ties to 0031-H with no new canon. |
| D9 | **LED vocabulary:** **amber steady** = powered, not linked; **red blinking (1 Hz)** = linked; **off** = unpowered / failed. Rack (amber), letter ("amber… red in drills"), theatre (red → off), vivarium tray (off), roster (red / grey) all agree. | Review S5. |
| D10 | **Controller log** (`term4_ctrl` + `roster` screen): `FITTED: 23. LINK: 19 ACTIVE · 4 NO SIGNAL.`, `ASSIGNED CONTROLLER: NONE → NODE 2 — BIO-SYS (MON 08:40).`, `CO: CDR M. KESSLER — NOT FITTED.` The word CHOIR never appears on it; the player joins the Node 2 window (CHOIR's face), the controller field and the red dots. **19 / 4 is canon for 3c** (the 4 = Kessler's shielded handful). | User rule: nothing in 3b says outright that navy people are controlled; review B2. |
| D11 | End foreshadowing kept (user decision): gate panel `AUTHORISED: AAS, L. (LT.) — PALM — LIVE`, CHOIR "He has very steady hands." Nobody is seen. | Binding. |
| D12 | **Six gates**, each with its reason at the door: decon 8 s (`d4_inner`), one-way air shower (`d4_shower_in`), containment hold on `d4_surg` (cleared at the cold store), tube pressure differential (booth release refused until the plant room equalises), booth release (`d4_tube_n`), gate lock cycling (`d4_tube_s`). Holds use the existing `cycling` state (amber panel) with a per-door prompt; no new door status. | R1; review B4.4. |
| D13 | Enemies: existing types only — husk (skins `lab` / `navy`), skitter, sentry (skins `lab` / `navy`), one new worker pose `bench`. Totals **10 husks, 8 skitters, 2 sentries**. | Brief; R2/R4. |
| D14 | Rewards: carbine + 2 vests + ammo in the navy armoury cage, pried open by a dead scientist (Eng) → no gate. Plates, carbine ammo and a medkit are staged in the guard room and the plant room **for the plant holdout**, and at the tube's bulkhead ring for the tube fight. | Placement with a purpose (coordinator 2). |
| D15 | **Lights-out** at the hold override (Deck 2 except theatre and Node 2). Flashlight readability is tested (`check:dark`). | 3a lesson 5. |
| D16 | Dr. A. Sunde (PI) is missing: not on Monday's sheet, not among the bodies, coat and badge gone. Open thread **that 3c or 3d must pay off** (§13). One new voice `sunde`. | Coordinator 3. |
| D17 | No in-person speech in 3b. Every voice carries: CHOIR on the PA (2-D), the theatre announcer on the gallery speaker (`pa`, ref 7 m), the video log through **`screen`** = the existing `recorder` DSP chain aliased with its own position profile (ref 4 m, rolloff 0.7). | 3a lesson 4; review S10. |
| D18 | **No optional contract members.** K adds required members with working stubs (`armor = 0`, `maxArmor = 100`, `addArmor() → 0`), and makes the implemented 3a-era optionals required in the same commit. | Coordinator 6 / review S11. |
| D19 | A door that never opens in its stage is a static `sealedDoor()` prop. Used by `d4_outer`, the theatre's lower door, the Post 4 gate, 3a's `d3_bio_inner`. | No moving parts to test; honest barrier. |
| D20 | **Clock carried:** 3a's end writes fact `testHour` (3a's `CLOCK`: 62 + t/3600); 3b's `CLOCK4.arrivalHour = facts.testHour ?? 62 + 10/60`. Cold-store `DOOR OPEN` counter = `(arrivalHour − 1/60) h + t`; attempts at load = `floor((arrivalHour·3600 − 60) / 40)` (5,593 for 62:10). Sunde's log `SUN 23:10`; PI reply `MON 04:12`; roster `MON 08:40`. | Review note; every panel stays honest. |
| D21 | Every fx volume declares `rooms` = **drawn only while one of these rooms is drawn**; hidden during `render.prepare`; `check:fxleak` fails on magenta in any view whose *drawn room set* contains none of them. | 3a lesson 3; review S13. |
| D22 | Light budget: every view ≤ 6 points / ≤ 2 shadows on LOW — **the flashlight is one of the two shadow slots**; fills use `minQuality`; ≤ 2 transparent layers on any ray. | 3a lesson 6. |
| D23 | Markers, not coordinates: every story position is a `level.object('mk4_…')`; missing marker = error the playthrough fails on. Every cue after a line = `VoiceHandle.duration` + a gap; every timed line starts **within 0.12 s** of its cue. | 3a lessons 1, 2; coordinator 8. |
| D24 | Facts out of 4: `choice`, `unitsLeft`, `badge`, `halvorsenAlive`, `kills3`, `kills4`, `testHour`, first-view flags `l4_theatre`, `l4_video`, `l4_roster`, `l4_equalised`; armour and weapons in the carry. | 7.1 B3/B4. |
| D25 | Air shower is one-way ("Once gowned, never return to the dirty side"). | Real barrier, real reason. |
| D26 | Cold-store door held open (`open`), its safety beam broken by Holm's hand: Holm lies 0.5 m inside the cold store, hand at the threshold edge outside the opening volume; the jam twitch goes through the Door API (`DoorImpl.nudge`). | Review S2. |
| D27 | **Bio's containment interlock is hard-wired and local** (new canon, accepted): the surgical-suite doors are on it, not on CHOIR's network; acknowledgement is a physical button at the source. CHOIR could neither open those doors nor wanted the button pressed; it answers with what it controls — the power and the units. Panels say `HARD-WIRED — LOCAL ACKNOWLEDGE ONLY`. The tube door's pressure interlock is the same kind. | Review S3; coordinator 5; small extension of 6.1's lockouts. |
| D28 | **Required navy beat — the tube plant room** (`plant4`): the booth's release is refused (`PRESSURE DIFFERENTIAL — EQUALISE AT TUBE PLANT`); through the guard room the player opens the equalising valve (lever), the pumps run 25 s on a fixed clock, loud, and the checkpoint fight (F5) arrives at the plant room as a holdout; then the booth release works. Adds ≈ 3 min to the main route. | Coordinator 2: length with a real space and reason, existing mechanics (lever, fixed-clock cycle à la 3a purge, emerge, groups). |
| D29 | **Delivery:** Sunde (the only person heard) speaks short lines with hesitation written into the words and scene-owned, varied gaps; UNIT and the announcer are flat with **no** uppercase; CHOIR calm; uppercase stress runs to the end of its phrase. | Coordinator 7; review S10. |
| D30 | Scene speech reaches the listener at conversation level: ST passes `check-voice-level --level 4` (script built for 3a by the coordinator). | Coordinator 8. |

### 0.1 Lessons from playing 3a → where this plan designs for them

| Lesson | Where |
|---|---|
| (1) props/actors from level markers | D23, §8.10 marker table; playthrough asserts every `mk4_` exists |
| (2) acting timed from line durations | §4 (cues = line end + gap), `failHold`, video-log screen animation per line, ≤ 0.12 s rule (§8.12) |
| (3) no fx volume visible from unintended places | D21, §2.8, §2.9, `check:fxleak` |
| (4) speech audible at distance | D17, D30, `check-voice-level` |
| (5) readable by flashlight on LOW/MEDIUM | D15, §8.11, `check:dark` |
| (6) 60 fps LOW/MEDIUM; light + transparency budgets per space | D22, §2.7, §10.6, tube fallback §8.6.4 |
| delivery "read from a script" | D29, §6.2 |

---

## 1. Fiction and tone

1. The BIO outer lock you latched behind you hisses: decon, eight seconds. The habitat's warmth is gone; this is white, cold and exact.
2. Gowning: lockers, a step-over bench, a suit sign-out sheet — ten names out Monday morning, none back in. In the air shower a man in a suit sits against the wall, visor fogged.
3. The clean corridor: a screen says the clean side was fumigated at Mon 08:41, occupancy ten, requested by CHOIR; the habitat was told it was a drill. Through the wet-lab window a lab unit is still pipetting.
4. CHOIR, flat and courteous: Biological Systems is closed; there is nobody here to tell.
5. The way on — the surgical suite — is sealed by a hard-wired containment hold: Cold Store 2's door has been open for 62 hours. Acknowledge at source.
6. Around the loop, any order: empty pens with COMPLIANT cards, a husbandry log, a gel protocol ("live host only"), the PI's terminal and her halting video log ("It doesn't suggest. It— it drives."), consent forms signed by 23 sailors, a window onto Node 2.
7. In the frost, a rack of Clasps glows amber. You clear the hold. CHOIR: that alarm was the last thing keeping you out. The lights go; the unit bay opens.
8. The theatre gallery: below, an arm fits a Clasp to a body; the ring on its tool glows red, blinks three times, goes dark. LINK FAILED. Attempt five thousand six hundred and something. Again.
9. Down the service stair the paint turns navy grey: the old checkpoint, a booth with a roster — 23 fitted, 19 linked, controller Node 2 — and an armoury cage someone already broke into. The tube door will not release: pressure differential.
10. In the plant room you open the valve; the pumps roar for twenty-five seconds and the units come. Then the glass tube through black water, units walking up it from Post 4, and a gate panel: AUTHORISED: AAS, L. — PALM — LIVE. "He has very steady hands."

Tone: clinical, cold, exact, quiet; dread from order and paperwork, not gore. No faces (hoods, visors, prone bodies). No warm light on the clean side.

| Beat | Knows | Feels |
|---|---|---|
| lock, gowning, shower | Bio is sealed; its staff went in Monday and never came out | cold, wrongness of the order |
| clean loop | CHOIR fumigated them under a drill notice; a unit still works; the suite is held | intrigue, isolation |
| labs (any order) | the Clasp: pigs "compliant"; "advises" → drives; 23 sailors signed; the controller field was empty; the PI stopped it | dread |
| override, lights-out | CHOIR wanted the suite sealed and could not seal it itself | panic |
| theatre | it needs a *living* host; it keeps trying on the dead | horror, understanding |
| checkpoint | 19 of 23 links active, controller Node 2 — Bio's node; the CO is not fitted | the next question |
| plant room | the tube is a pressure vessel in the sea; noise brings them | siege |
| tube, gate | a living navy officer opened the gate for you | the floor drops |

Threads (each readable alone — R3):

| Question | What 3b shows | Where |
|---|---|---|
| Why is Bio dead? | fumigation Mon 08:41, occupancy 10, requested by CHOIR; habitat told "drill" | `fumig_status`, `l4_choir_bodies_*` |
| What is a Clasp? | cervical interface; pigs; "advises" vs "drives"; live host only | `note4_cards`, `log4_viv`, `note4_wet`, `log4_video`, `note4_consent`, theatre |
| Who controls it? | controller field empty → Node 2 since Mon 08:40; "assigned centrally" (Halcyon Ops); Node 2 shows CHOIR's waveform | `term4_pi`, `term4_ctrl`, `roster`, Node 2 window |
| What does the red light mean? | D9 | rack, theatre, roster, Sunde, `note4_bunk` |
| Who are the sailors? | 23 signed, witness Lt. Aas; a margin note; a letter | `note4_consent`, `note4_tveit`, `note4_bunk`, `note4_guard` |
| Kessler (3c) | `CO: CDR M. KESSLER — NOT FITTED`; 4 links `NO SIGNAL` | `term4_ctrl`, `roster` |
| Where is Sunde? | not on Monday's sheet, not among the bodies, coat gone | `note4_signout`, PI office (open, D16) |

Not revealed: Kessler's voice, radio, keypad, taken soldiers (3c), why Sunde is gone, who wanted 0031-H.

---

## 2. Layout (authoritative; separate world)

### 2.1 Rooms (`L.room(id, name, x0, x1, z0, z1, h, { y0, floors })`)

| room id | display name | x | z | y0 | h | notes |
|---|---|---|---|---|---|---|
| `lock4` | BIOLOGICAL SYSTEMS — OUTER LOCK | −2 … 2 | 0 … 4 | 4.8 | 3.0 | **start**. 3a's `bio_lock` look. North wall: static `d4_outer`. No windows. |
| `gown` | GOWNING | −4 … 4 | −6 … 0 | 4.8 | 3.0 | lockers west, suit rack east, step-over bench z −3.0, x −3.8 … 2.6 (h 0.45; gap x 2.6 … 3.8). |
| `shower` | AIR SHOWER | **−2 … 2** | −9 … −6 | 4.8 | 2.8 | interior x −1.8 … 1.8 (covers the open leaves ±1.62, B1); jets both side walls; Dahl against the east wall. |
| `corr_n` | CLEAN CORRIDOR — NORTH | −15 … 15 | −12 … −9 | 4.8 | 3.0 | wet-lab windows in its south wall. |
| `corr_w` | CLEAN CORRIDOR — WEST | −15 … −12 | −34 … −12 | 4.8 | 3.0 | |
| `corr_e` | CLEAN CORRIDOR — EAST | 12 … 15 | −34 … −12 | 4.8 | 3.0 | Node 2 window in its west wall. |
| `corr_s` | CLEAN CORRIDOR — SOUTH | −15 … 15 | −37 … −34 | 4.8 | 3.0 | two ceiling vents (x −6 / 6, z −35.5). |
| `wetlab` | WET LAB 1 | −12 … 4 | −24 … −12 | 4.8 | 3.4 | 2 bench islands (**no overhead shelving above 1.2 m**), 4 fume hoods south wall, −80 °C freezer, sink. |
| `pi_office` | DR. A. SUNDE — PRINCIPAL INVESTIGATOR | 4 … 12 | −20 … −12 | 4.8 | 3.0 | desk on the north wall, video log, terminal, couch, whiteboard. |
| `node2` | NODE 2 — BIO-SYS | 4 … 12 | −24 … −20 | 4.8 | 3.0 | **sealed**, no door; 6 racks; CHOIR waveform screen on its **west wall facing +x**; seen only through its window. |
| `cold` | COLD STORE 2 | −12 … 0 | −34 … −24 | 4.8 | 3.0 | −20 °C; Clasp rack (north wall); hold panel (east wall). |
| `records` | RECORDS & CONSENT | 0 … 12 | −34 … −24 | 4.8 | 3.0 | filing, reading table; slumped husk + 2 bodies. |
| `vivarium` | VIVARIUM — LAB 2 | −27 … −15 | −30 … −14 | 4.8 | 3.4 | pen row A (6, west wall), row B island (5), aisle x −24.4 … −21.4; ceiling vent at (−22.9, −22). |
| `bay` | UNIT BAY | 15 … 21 | −22 … −16 | 4.8 | 3.0 | spawn room; 3 charging docks; script-only door. |
| `scrub` | SCRUB ROOM | −4 … 4 | −43 … −37 | 4.8 | 3.0 | 3 sinks (west wall), gown hooks, theatre list board (east wall); Foss. |
| `store4` | STERILE STORE | 4 … 8 | −43 … −39 | 4.8 | 3.0 | spawn room; script-only door. |
| `gallery` | THEATRE 1 — GALLERY | −10 … 10 | −47 … −43 | 4.8 | 3.0 | south wall z −47 glazed x −7.6 … 7.6, y 5.0 … 7.6; layout forces the path along z ≈ −46 (§2.6). |
| `theatre` | THEATRE 1 | −8 … 8 | −59 … −47 | **0** | 9.4 | **never entered** (ALWAYS). Arm, table, corpse, gel bath, bin, gurneys, screen, lower sealed door. |
| `stair4` | SERVICE STAIR B | 10 … 14 | −59 … −43 | 0 / 4.8 | 8.0 | top landing z −47 … −43 at y 4.8 (`floors: [{ y: 4.8, box: [10, 14, -47, -43] }]`); `STAIR4 = { room: 'stair4', x0: 10.2, x1: 13.8, z0: -56, dir: 1, risers: 16, rise: 0.3, tread: 0.5625 }` (flight z −56 … −47, 16 × 0.30 = 4.8, 16 × 0.5625 = 9.0); bottom landing z −59 … −56 at y 0. |
| `lcorr` | BIO-SYS SERVICE LEVEL | 4 … 24 | −63 … −59 | 0 | 3.2 | Bio sentry dock (16.5, −61); theatre's sealed lower door at x 6. |
| `chk` | NAVAL CHECKPOINT 2 | 24 … 40 | −67 … −55 | 0 | 4.0 | booth, armoury cage, roster, raised boom; navy sentry dock **over the booth** (28.0, 3.6, −56.8). |
| `guard` | GUARD ROOM | 40 … 46 | −62 … −56 | 0 | 3.0 | **on the main route** (to the plant room). 2 bunks, locker, desk. |
| `plant4` | TUBE PLANT | 46 … 56 | −64 … −54 | 0 | 4.5 | **new required beat (D28)**: 2 pump sets, pipe trunk, Δp gauge, equalising valve lever, floor sump hatch. |
| `tube` | TRANSFER TUBE | 30 … 34 | −107 … −67 | 0 | 3.6 | glass both sides z −104 … −70, y 0.4 … 3.0; ribs every 4 m; bulkhead ring at z −87. |
| `gatel` | POST 4 — GATE LOCK | 29 … 35 | −113 … −107 | 0 | 3.6 | spawn room for the tube group, then the end room; south wall: static Post 4 gate. |

Non-room spaces (regions only): **voids** — `vent_viv` (−23.4 … −22.4, y 8.2 … 9.2, −22.5 … −21.5), `vent_s_a`
(−6.5 … −5.5, 7.8 … 8.8, −36.0 … −35.0), `vent_s_b` (5.5 … 6.5, 7.8 … 8.8, −36.0 … −35.0), `sump4` (51.4 … 52.6,
y −1.2 … 0, −62.6 … −61.4); **outside** — the sea voids x 18 … 29.8 and 34.2 … 46, z −105.2 … −68.8, y −3 … 4
(`G.void`, no faces); **booth** (26.2 … 29.8, 0 … 2.6, −58.2 … −55.4), **cage** (35.2 … 39.6, 0 … 4, −66.6 … −62.8) inside
`chk`. Envelope `GreyGrid([-30, -3.2, -116, 58, 11, 6])`; everything else is solid.

Plan check (D3): pairs touch only on boundaries — lock4/gown z 0; gown/shower z −6; shower/corr_n z −9; corr_n/{wetlab,
pi_office} z −12; corr_w/corr_e/inner block x ∓12; wetlab/{cold, records} z −24; node2/pi_office z −20; node2/records
z −24; cold/records x 0; corr_s/scrub z −37; scrub/gallery z −43; scrub/store4 x 4; store4/gallery z −43; gallery/stair4
x 10; gallery/theatre z −47; theatre/lcorr z −59; stair4/lcorr z −59; lcorr/chk x 24; chk/guard x 40; **guard/plant4 x 46**;
chk/tube z −67; tube/gatel z −107; bay/corr_e x 15; vivarium/corr_w x −15. `plant4` (x 46 … 56, z −64 … −54) vs the east sea
void (x ≤ 46, z ≤ −68.8): 4.8 m apart in z ✓; vs chk (x ≤ 40) ✓.

### 2.2 Doors (`DoorSpec.y` = floor of frame and sill)

"Leaf faces" = both rooms' interiors cover centre ± 1.62 along the wall (rule b); "pocket" = the 1.675 m slots lie in
uninterrupted wall.

| id | position (x, y, z) | wall | kind / leaves | rooms | leaf faces (interior spans along the wall) |
|---|---|---|---|---|---|
| `d4_inner` | (0, 4.8, 0) | z | std, `painted_white`, hazard frame, non-auto | lock4 / gown | x ±1.62 in lock4 ±1.8 and gown ±3.8 ✓ |
| `d4_shower_in` | (0, 4.8, −6) | z | std, `stainless`, non-auto | gown / shower | ±1.62 in gown ±3.8, shower ±1.8 ✓ |
| `d4_shower_out` | (0, 4.8, −9) | z | std, `stainless`, non-auto | shower / corr_n | ±1.62 in shower ±1.8, corr_n ±14.8 ✓ |
| `d4_wet_w` | (−12, 4.8, −18) | x | std, `wall_clean` | corr_w / wetlab | z −19.62 … −16.38 in corr_w −33.8 … −12.2, wetlab −23.8 … −12.2 ✓ |
| `d4_wet_e` | (4, 4.8, −16) | x | std | wetlab / pi_office | −17.62 … −14.38 in wetlab, pi −19.8 … −12.2 ✓ |
| `d4_pi` | (12, 4.8, −16) | x | std, nameplate `DR. A. SUNDE` | pi_office / corr_e | ✓ (window starts z −20.6) |
| `d4_viv` | (−15, 4.8, −22) | x | std | corr_w / vivarium | −23.62 … −20.38 in vivarium −29.8 … −14.2 ✓ |
| `d4_cold` | (−12, 4.8, −29) | x | std, `stainless` + frost, **held open** (D26) | corr_w / cold | −30.62 … −27.38 in cold −33.8 … −24.2 ✓ |
| `d4_rec` | (12, 4.8, −29) | x | std | records / corr_e | ✓ |
| `d4_bay` | (15, 4.8, −19) | x | std, `painted_dark`, lintel `UNIT BAY — SERVICE UNITS ONLY`, **script only** | corr_e / bay | −20.62 … −17.38 in bay −21.8 … −16.2 ✓ |
| `d4_surg` | (0, 4.8, −37) | z | std, lintel `SURGICAL SUITE`; `cycling` with prompt `Containment hold` in A–C | corr_s / scrub | ±1.62 in scrub ±3.8 ✓ |
| `d4_gal` | (0, 4.8, −43) | z | std, lintel `THEATRE 1 — GALLERY` | scrub / gallery | ✓ |
| `d4_store` | (4, 4.8, −41) | x | std, `STERILE STORE — STAFF`, **script only** | scrub / store4 | −42.62 … −39.38 in store4 −42.8 … −39.2 ✓ |
| `d4_gal_e` | (10, 4.8, −45) | x | std | gallery / stair4 | −46.62 … −43.38 in landing −46.8 … −43.2 ✓ |
| `d4_stair_s` | (12, 0, −59) | z | std, `navy_grey` | stair4 / lcorr | x 10.38 … 13.62 in stair4 10.2 … 13.8 ✓ |
| `d4_chk` | (24, 0, −61) | x | std, lintel `NAVAL CHECKPOINT 2` | lcorr / chk | −62.62 … −59.38 in lcorr −62.8 … −59.2 ✓ |
| `d4_guard` | (40, 0, −59) | x | std, `navy_grey` | chk / guard | −60.62 … −57.38 in guard −61.8 … −56.2 ✓ |
| `d4_plant` | (46, 0, −59) | x | std, `navy_grey`, lintel `TUBE PLANT — AUTHORISED PERSONNEL` | guard / plant4 | −60.62 … −57.38 in guard −61.8 … −56.2, plant −63.8 … −54.2 ✓; pocket −60.675 … −57.325 on x 46 ✓ |
| `d4_tube_n` | (32, 0, −67) | z | std, lintel `TRANSFER TUBE — POST 4`; `cycling` with prompt `Release from booth` in A–D | chk / tube | x 30.38 … 33.62 in tube 30.2 … 33.8 ✓ |
| `d4_tube_s` | (32, 0, −107) | z | std, lintel `POST 4 — GATE LOCK`; `cycling` with prompt `Gate lock cycling` in A–E | tube / gatel | ✓ (gatel 29.2 … 34.8) |

Prompt override: `DoorSpec.cyclingPrompt?: string` (level-internal, `level/doors.ts`, W4) replaces the default "Cycling"
prompt; the panel shows the existing amber `CYCLING`; the reason is on the screen beside the door (§6.4).
Static sealed props (`sealedDoor()`, `src/level/kit.ts`): `d4_outer` (0, 4.8, 4) z, panel `SEALED — HABITAT SIDE — SECTOR
ALARM`; `door4_theatre` (6, 0, −59) z, `THEATRE 1 — STERILE FIELD — NO ENTRY`; `gate4` (32, 0, −113) z, wide look,
12 radial dogs (registered mover), panel `mk4_gate_panel`. Level 3: `d3_bio_inner` → `sealedDoor` at (16, 4.8, −38) x,
panel `DECON — AWAITING`.

### 2.3 Triggers (feet boxes)

| id | x | z | y | use |
|---|---|---|---|---|
| `t4_lock` | −1.8 … 1.8 | 0.2 … 3.8 | 4 … 7 | start |
| `t4_gown` | −3.8 … 3.8 | −5.8 … −0.2 | 4 … 7 | CHOIR enter line |
| `t4_shower` | **−1.8 … 1.8** | −8.8 … −6.6 | 4 … 7 | arms the `d4_shower_in` latch (B) |
| `t4_clean` | −14.8 … 14.8 | −11.8 … −9.2 | 4 … 7 | `cp4_clean` (once) |
| `t4_wetwin` | −11 … 3 | −11.8 … −10.2 | 4 … 7 | worker sight |
| `t4_viv` | −26.8 … −15.2 | −29.8 … −14.2 | 4 … 7 | |
| `t4_viv_deep` | −24.4 … −21.4 | −29.8 … −14.2 | 4 … 7 | `g4_viv` |
| `t4_wet` | −11.8 … 3.8 | −23.8 … −12.2 | 4 … 7 | |
| `t4_pi` | 4.2 … 11.8 | −19.8 … −12.2 | 4 … 7 | |
| `t4_node2win` | 12.2 … 14.8 | −24.5 … −19.5 | 4 … 7 | Node 2 line |
| `t4_cold` | −11.8 … −0.2 | −33.8 … −24.2 | 4 … 7 | `cp4_cold`, breath |
| `t4_rec` | 0.2 … 11.8 | −33.8 … −24.2 | 4 … 7 | `g4_rec` timer |
| `t4_surg_door` | −2 … 2 | −36.8 … −35.0 | 4 … 7 | hold denial |
| `t4_scrub` | −3.8 … 3.8 | −42.8 … −37.2 | 4 … 7 | |
| `t4_gallery` | −9.8 … 9.8 | −46.8 … −43.2 | 4 … 7 | `l4_unit_theatre_0` |
| `t4_stair_top` | 10.2 … 13.8 | −46.8 … −43.2 | 4 … 7 | |
| `t4_stair_foot` | 10.2 … 13.8 | −58.8 … −56.0 | −1 … 3 | `cp4_lower` |
| `t4_lcorr` | 4.2 … 23.8 | −62.8 … −59.2 | −1 … 3 | `g4_lower` wake |
| `t4_chk` | 24.2 … 39.8 | −66.8 … −55.2 | −1 … 3 | `cp4_navy`, F5 timer |
| `t4_booth` | 26.2 … 29.8 | −58.2 … −55.4 | −1 … 3 | |
| `t4_guard` | 40.2 … 45.8 | −61.8 … −56.2 | −1 … 3 | |
| `t4_plant` | 46.2 … 55.8 | −63.8 … −54.2 | −1 … 4 | holdout region |
| `t4_tube_0` | 30.2 … 33.8 | −72 … −67.2 | −1 … 3 | CHOIR tube line |
| `t4_tube_1` | 30.2 … 33.8 | −80 … −72 | −1 … 3 | F6 |
| `t4_gatel` | 29.2 … 34.8 | −112.8 … −107.6 | −1 … 3 | `d4_tube_s` latch (F) |

### 2.4 Maps (1 character ≈ 1 m in x, 1 line ≈ 2 m in z; `=` glass, `d` door, `S` static sealed door, `v` vent)

Deck 2 (y 4.8) — the clean side:

```
x:  -27        -15  -12      -4  -2 0 2  4        12  15     21
z=+4                            +-S-+              d4_outer (sealed)
                                |LK4| lock4 (start, decon 8 s)
z= 0                         +--+-d-+--+           d4_inner
                             |  GOWN   |  gown (bench z-3, gap at the east end)
z=-6                         +--+-d-+--+           d4_shower_in
                                | SH  |  shower x-2..2 (one-way)
z=-9      +---------------------+--d--+---------------------+   d4_shower_out
          |                 CORR_N                    [fumig]|
z=-12  +--+---+===== windows x-11..3 ======+-------+--+-----+
       |  | W |          WET LAB 1      d4_wet_e PI OFFICE d4_pi| E |
       | VIV  d4_wet_w                   +-------+--------+   +-----+
z=-20  | ARIUM|  |    (worker at hood)   |[scr] NODE 2 = window | BAY |  d4_bay (15,-19)
z=-24  | pens v  +------------+-----------+------------------+   +-----+
       |      |  |  COLD     |     RECORDS                  |   |
z=-29  |      |  d4_cold   panel  table           d4_rec    d   |
z=-30  +------+  | STORE 2   |   (husk, bodies)              |   |
z=-34         +--+-----------+------------------------------+---+
              |   v(-6)            CORR_S          v(6)          |
z=-37         +-------------------+--d4_surg--+------------------+
                                  |  SCRUB d4_store|STORE4|
z=-43                     +-------+----d4_gal---+---+------+--+
                          | bench tier     [cam desk]  d4_gal_e STAIR4 top landing
                          |  path z≈-46 along the glass       |
z=-47                     +===== glass x-7.6..7.6, looking DOWN into the theatre =+ (flight down z -47 → -56)
```

Deck 1 (y 0) — theatre floor, navy level, plant room, tube:

```
x:   -8      0    4  6 8 10 14        24      28   32  35  40   46        56
z=-47 +------------+    |  |
      |  THEATRE 1 |    |  |  stair flight (descending south)
      | arm  table |    |  |
      | bath bin   |    |  |
z=-56 |  [status]  |    |  | bottom landing
z=-59 +------+--S--+----+-d+--------------+------------------+ - - - - - +----------+
             | lcorr   d4_stair_s  sentry dock       d4_chk |  booth  roster |  GUARD d4_plant  PLANT4  |
z=-63        +----------------------------------------------+      cage    |------+ pumps  valve|
                                                   |   d4_guard (40,-59)       |  sump  gauge|
z=-67                                              +------d4_tube_n------+-----+  +----------+ z=-64
                                                          | TUBE |
                                   sea void x18..29.8 ==== |      | ==== sea void x34.2..46
z=-87                                                     |=ring=|
z=-104                                                    +------+
z=-107                                                 +-d4_tube_s-+
                                                       | GATE LOCK |
z=-113                                                 +-----S-----+   gate4 (Post 4)
```

Section through the gallery and the theatre (x = 0, looking east):

```
 y 9.4  ____________________________ theatre ceiling (arm rail at 9.2)
 y 7.8  ___gallery ceiling___ |
        |  gallery (Deck 2)   = glass y 5.0 … 7.6     arm (status ring)
 y 4.8  |_____ floor ________ =                  \__  lamp
        | solid structure     |                   [====table====]  gel bath, bin
 y 0    |_____________________|______ theatre floor ______________________ lower door S at z -59
       z -43                 z -47                z -53.5                 z -59
```

### 2.5 Route graph

```
[cp4_start] lock4 ──decon 8 s──▶ gown ──▶ shower ══latch, 6 s jets══▶ corr_n [cp4_clean]   (one-way)
the loop:  corr_n ◀──▶ corr_w ◀──▶ corr_s ◀──▶ corr_e ◀──▶ corr_n          (both directions, ≈104 m round)
cross-link: corr_w ─d4_wet_w─ wetlab ─d4_wet_e─ pi_office ─d4_pi─ corr_e
optional:   vivarium, records, wetlab, pi_office, Node 2 window
REQUIRED:   cold [cp4_cold] ── cold_ack ──▶ hold cleared ──▶ lights-out + ambush
corr_s ─d4_surg (HOLD until cold_ack)─▶ scrub ─▶ gallery (THE THEATRE, only route) ─▶ stair4 top [cp4_hold]
stair4 ─▶ foot [cp4_lower] ─▶ lcorr (Bio sentry) ─▶ chk [cp4_navy]: booth (roster; release REFUSED: Δp) · cage (carbine, vests)
chk ─▶ guard ─▶ plant4: valve ── 25 s equalising holdout (F5 + sump skitters) ──▶ Δp 0   [cp4_armed]
back ─▶ booth: release ─▶ d4_tube_n ─▶ tube (fight) ─▶ d4_tube_s (CYCLING until the fight) ─▶ gatel ══latch══▶ END
```

Length estimate (review note, revised): first-time main route ≈ 13 min (+ ≈ 3 min for the plant beat); a reader who
visits every room ≈ 16–17 min; a runner ≈ 8 min.

### 2.6 Dressing per space

General clean side: `wall_clean` HPL panels with coved silicone seams; `floor_epoxy`; `ceiling_clean` with flush
luminaires (emissive, 6500 K) and HEPA diffusers; `stainless`; blue-grey **`clinical`** signage; door status LEDs;
`FUMIGATED — MON 08:41` stickers on lab doors; a faint white bloom on glass. No wood, plants or fabric except `tyvek`.

- **lock4**: 3a's BIO lock look; decon panel `mk4_decon_panel` (1.79, 6.1, 1.0) facing −x.
- **gown**: 10 lockers (west, names = sign-out list; Sunde's locker open and empty), suit rack (east), step-over bench,
  mirror, `note4_signout` (−3.7, 6.0, −2.0), `note4_gown` (3.79, 6.2, −4.5), `p4_gown_med` (3.6, 6.0, −1.5).
- **shower** (x −2 … 2): perforated stainless walls, 3 × 4 jets per side wall, grated floor; Dahl (`slumped_wall`) at
  **(1.5, 4.8, −7.6)** facing −x, footprint x 1.3 … 1.8: passage x −1.8 … 1.3 = 3.1 m.
- **corridors**: bumper rails, emergency floor strips (off until lights-out), wayfinding at every corner (`← COLD STORE 2 ·
  VIVARIUM`, `RECORDS · UNIT BAY →`, `SURGICAL SUITE ↓`); `fumig_status` on the corr_n south-wall pier x 3.1 … 3.9,
  y 5.6 … 6.8, facing +z; `surg_hold` screen (−2.2, 6.2, −36.78) facing +z beside `d4_surg`, arrow ←.
- **wetlab**: islands x −10 … −6 and −3 … 1, z −20 … −16, nothing above 1.2 m; hoods x −10 … −2 on the south wall with
  glass sashes; worker at hood 2 (−6.0, 4.8, −22.6); `note4_wet` (−2.0, 5.75, −19.0); `p4_wet_ammo` (2.5, 5.75, −14.0).
- **pi_office**: desk on the north wall; `pi_video` monitor `mk4_video` (8.0, 5.95, −12.45) facing −z; `term4_pi`
  (6.2, 5.9, −12.6); couch; whiteboard `CLASP — CONTROLLER = ?`, "who answers?" circled; hood over the chair; empty coat
  hook and badge holder; `p4_pi_med` (10.5, 5.7, −13.5).
- **node2**: 6 racks with blinking LEDs; `node2_screen` (`choir` waveform, 1.6 × 0.9) on the **west wall at (4.22, 6.4,
  −22.0) facing +x**, square to the window 7.8 m away; header `NODE 2 — BIO-SYS`.
- **vivarium**: pens row A x −26.8 … −24.4, z −29.6 … −17.6 (6 × 2.0 m, glass fronts facing +x); row B x −21.4 … −19.0,
  z −27.6 … −17.6 (5 pens, glass both faces); all empty and clean; cage cards; a tray of 12 small Clasps (LEDs **off**) on
  the procedure table (−17.5, 5.7, −27); Berg (`lying_side`) (−23.5, 4.8, −27.5); `note4_cards` (−21.0, 6.0, −15.5);
  `log4_viv` (−25.5, 5.75, −16.0); `p4_viv_ammo` (−25.0, 5.7, −16.6).
- **cold**: frosted racks, sample freezers, `frost` on every surface, breath; **Clasp rack** `mk4_cold_rack` 24 slots on the
  north wall x −8 … −3, y 5.4 … 6.6 (18 Clasps, LEDs **amber**, 6 empty); `cold_panel` + `cold_ack` at (−0.22, 6.2, −29)
  facing −x; **Holm** (`lying_back`) body footprint x −11.6 … −9.8, z −29.3 … −28.7, collider 0.15 m high (walkable), his
  right hand outstretched to x −11.78 at y ≤ 4.85 — outside the opening volume (x −12.2 … −11.8) and 0.15 m from the
  closed-leaf plane (x −11.93); it breaks the door's safety beam; `p4_cold_med` (−11.55, 6.0, −27.2).
- **records**: filing walls, reading table (2.0 … 4.4, z −27.6 … −26.4); Ness (`sitting_desk`) (3.0, 4.8, −28.2); Moe
  (`lying_back`) (8.5, 4.8, −32.8); slumped husk (6.5, 4.8, −33.4); `note4_consent` (3.0, 5.6, −27.0); `note4_tveit`
  (10.8, 5.9, −24.4); `p4_rec_ammo` (2.4, 5.6, −26.6), `p4_rec_shells` (3.6, 5.6, −26.6).
- **bay**: 3 dark charging docks, cable reels.
- **scrub**: sinks (west), knee taps, glove dispensers, gown hooks; Foss (`slumped_wall`) (−3.2, 4.8, −40.5);
  `note4_list` (3.78, 6.2, −38.4) facing −x; `p4_scrub_med` (−3.6, 5.7, −38.0), `p4_scrub_shells` (−3.6, 5.7, −38.4).
- **gallery** (B3 layout): **bench tier** along the north wall in two blocks x −9.8 … −1.0 and 1.0 … 8.0, z −44.8 … −43.2,
  collider 0.9 m high (seat + back rail: not walked over); the entry from `d4_gal` (x −0.8 … 0.8) leads straight to the
  glass; the free strip z −46.8 … −44.8 is the path to `d4_gal_e`, centre line z ≈ −46 (0.8 m from the glass, inside the
  2.36 m table-visibility band). **Camera desk** x 3.0 … 5.0, z −46.8 … −46.4, h 1.0, with the `theatre_cam` monitor
  0.6 × 0.4 at (4.0, 5.95, −46.45) tilted 30° up, facing +z (seen on entry, 30° right of the door axis; it does not cut the
  door → table sight line, which passes x 0). Speaker `mk4_gallery_spk` (0, 7.55, −45.0); `sign4_theatre` (−6.0, 5.9,
  −43.22) facing −z; decorative rail on brackets 0.1 m inside the glass.
- **theatre** (seen from above only): table (0, 0, −53.5), long axis x; Strand prone, hood removed, head in the face cradle
  at x −0.95, nape at (−0.7, 1.08, −53.5); arm on a ceiling rail at y 9.2 (`theatre_arm`, §8.5.1) with a **7 cm status
  ring** on its tool head; gel bath (−2.5, 0, −56.8) (stainless tank on legs, top y 1.0); `FAILED` bin (2.2, 0, −51.5) with
  ~30 spoiled Clasps (static); covered gurneys (Haugen, Lie) at (5.5, 0, −50.2) and (5.5, 0, −56.0); `theatre_screen`
  4.0 × 1.4 at (0, 3.7, −58.78) facing +z; the lower sealed door at x 6.
- **stair4**: steel stair; paint white → navy grey at mid-flight (`BIO-SYS ┃ NAVAL`); **Eng's trail**: a smear decal down
  the treads and a dropped respirator on the bottom landing (11.0, 0, −57.5).
- **lcorr**: pipe racks, valve wheels, `TRANSFER TUBE — POST 4 →`, Bio sentry dock (16.5, 2.85, −61), cabinet
  `p4_lcorr_med` (20.0, 1.2, −62.75), `p4_lcorr_ammo` (20.4, 1.2, −62.75).
- **chk**: `navy_grey`, `deck_nonslip`, stencils; **booth** x 26.0 … 30.0, z −58.4 … −55.2 (1.0 m kerb + bulletproof glass to
  2.4 m on its south and east faces, roof at 2.6, doorway on the west face z −57.4 … −56.4); console along its north side:
  `booth_release` (28.8, 1.0, −55.55), `term4_ctrl` (27.2, 1.05, −55.55), booth status screen `booth_panel` (28.0, 1.5,
  −55.55), shelf `p4_booth_med` (27.0, 1.3, −55.6); **roster** `mk4_roster` 2.4 × 1.2 at (33.2, 2.2, −55.22) facing −z;
  navy sentry dock on the ceiling over the booth (28.0, 3.6, −56.8); raised boom (30.5, 0, −65.5); `tube_n_panel` beside
  `d4_tube_n` (33.9, 1.6, −66.78) facing +z; **cage** x 35.0 … 39.8, z −66.8 … −62.6, mesh to the ceiling, door gap on its
  north face x 36.6 … 38.2 (leaf bent open); inside `p4_carbine` (39.55, 1.2, −64.5), `p4_vest_1` (39.55, 1.4, −63.4),
  `p4_vest_2` (39.55, 1.4, −65.6), `p4_cage_ammo` (38.0, 0.9, −66.5), `p4_cage_plate` (36.0, 0.4, −66.4); **Eng**
  (`lying_side`, suit half off, no hood) at the cage door (37.4, 0, −61.9), fire axe beside him.
- **guard**: 2 bunks, locker, desk; `note4_guard` (45.6, 1.5, −58.0) on the desk by the plant door; `note4_bunk` (42.0, 0.6,
  −61.4); locker supplies **for the holdout** `p4_guard_plate` (44.0, 0.9, −56.4), `p4_guard_shells` (44.4, 0.9, −56.4).
- **plant4**: pump set A x 47.0 … 50.0, z −63.0 … −60.0 and pump set B x 47.0 … 50.0, z −58.0 … −55.0 (h 1.6, colliders —
  cover for the holdout), pipe trunk (53.0, −56.0) through the floor, catwalk-free; **gauge wall** east: `plant_gauge`
  1.2 × 0.8 (55.78, 2.4, −59.0) facing −x; **valve** lever `valve4` (55.75, 1.2, −59.0) facing −x (kind `lever`, vignette
  `valve_open` swings a 1.2 m handle); amber rotating beacon over the gauge; **sump hatch** grille at (52.0, 0, −62.0)
  1.2 × 1.2 (vignette `plant_sump` lifts it); supplies on a crate by the valve **for the holdout**: `p4_plant_plate`
  (54.8, 0.9, −61.6), `p4_plant_ammo` (55.2, 0.9, −61.6, ammo_carbine 30), `p4_plant_med` (54.8, 0.9, −62.1).
- **tube**: ribs every 4 m, curved solid roof with lit cable spine, grated deck, bulkhead ring at z −87 (0.5 m deep, opening
  2.6 × 3.0); `p4_tube_plate` (30.6, 0.4, −86.6), `p4_tube_ammo` (33.4, 0.4, −86.6). Outside: §2.9.
- **gatel**: navy grey, benches, gate panel `mk4_gate_panel` (33.9, 1.6, −112.78) facing +z.

### 2.7 Light plan and per-space performance budget

Pools: low 2 shadow / 8 spot / 6 point; medium 3 / 9 / 8; high 4 / 10 / 10. **The flashlight is a shadow spot.**
Emissive-only: luminaires (`bindEmissive` to their room's first light), floor strips, LEDs, Clasp LEDs and rings,
screens, rack LEDs, the tube spine. Every point light is `bounds`-boxed. Husk eye lights (prio 0.2) lose slots first.

| group | before lights-out | after (`<room>_emerg`) | descriptors |
|---|---|---|---|
| `lock4` | 1 spot (cast medium+), 1 point | unchanged | 2 |
| `gown` | 1 point (all) + 1 (medium+) | off; 1 emerg 0.3 | 2 + 1 |
| `shower` | 1 point (all) | off | 1 |
| `corr_n`, `corr_w`, `corr_e`, `corr_s` | 2 points (all) + 1 (high) each | off; 1 emerg cold 0x9ec4ff 0.3 (all) + 1 red corner 0.25 (medium+) each | 3 + 2 each |
| `wetlab` | 2 points (all) + 1 spot hood glow (medium+) | off; 1 emerg | 3 + 1 |
| `pi_office` | 1 spot desk lamp (cast all, prio 0.8), 1 point (medium+) | off; 1 emerg | 2 + 1 |
| `node2` | 1 point cyan 0.6 (all, prio 0.4) | unchanged | 1 |
| `vivarium` | 2 points (all) + 1 (medium+) | off; 1 emerg | 3 + 1 |
| `cold` | 1 point (all) + 1 (medium+) | off; 1 emerg blue | 2 + 1 |
| `records` | 1 point (all) + 1 spot desk (medium+) | off; 1 emerg | 2 + 1 |
| `scrub` | 1 point (all) + 1 (medium+) | off; 1 emerg | 2 + 1 |
| `gallery` | 1 point 0.4 (all) + 1 (high) | off; 1 emerg 0.25 | 2 + 1 |
| `theatre` | 1 spot surgical lamp (cast all, prio 2.0), 1 point (all), 1 point (high) | unchanged | 3 |
| `stair4` | 2 points (all) | unchanged | 2 |
| `lcorr` | 2 points (all) + 1 (medium+) | unchanged | 3 |
| `chk` | 2 points (all), 1 spot booth (cast medium+), 1 point (high) | unchanged | 4 |
| `guard` | 1 point (all) | unchanged | 1 |
| `plant4` | 2 points (all), 1 spot gauge (cast medium+); `plant_beacon` 1 point amber `alarm` flicker (all, on during equalising) | unchanged | 4 |
| `tube` | 2 points spine (all) z −78 / −96 + 2 (medium+) z −70 / −104 | unchanged | 4 |
| `gatel` | 1 spot (cast medium+) + 1 point (all) | unchanged | 2 |

Worst views on LOW (points / shadow slots incl. flashlight): (a) shower exit → wet lab: corr_n 2 + wetlab 2 + corr_w 1 +
corr_e 1 = **6** / 1. (b) gallery → theatre: gallery 1 + theatre 1 + scrub 1 + stair4 1 = 4 / **2** (lamp + flashlight).
(c) chk at the booth: chk 2 + lcorr 1 + guard 1 = 4 / 2 (navy sentry searchlight + flashlight). (d) plant holdout looking
at the door: plant 2 + beacon 1 + guard 1 + 2 husk eyes = **6** / 2 (sentry + flashlight; gauge spot no cast on low).
(e) tube mid: tube 2 + gatel 1 + chk 1 = 4 / 1. (f) corr_s ambush after lights-out: emerg 4 + 2 husk eyes = 6 / 1.

Per-space budget (main calls / shadow calls / tris / transparent calls / max layers). Targets ≥ 60 fps LOW and MEDIUM,
≥ 45 fps HIGH; any view over budget blocks hand-over.

| space | main | shadow | tris | transparent | layers |
|---|---|---|---|---|---|
| lock4 / gown / shower | ≤ 120 | ≤ 40 | ≤ 0.3 M | 1 (mist) | 1 |
| corridor loop + labs seen through windows/doors | ≤ 220 | ≤ 60 | ≤ 0.6 M | ≤ 3 | 2 |
| vivarium | ≤ 180 | ≤ 50 | ≤ 0.5 M | 1 (pen glass merged) | 2 |
| cold store | ≤ 150 | ≤ 40 | ≤ 0.4 M | 2 (fog, glints) | 1 |
| gallery + theatre | ≤ 200 | ≤ 70 | ≤ 0.6 M | 2 (glazing, wisp) | 1 |
| navy level (lcorr + chk + guard) | ≤ 230 | ≤ 70 | ≤ 0.6 M | 1 (booth glass) | 1 |
| plant room (+ guard through the door) | ≤ 180 | ≤ 60 | ≤ 0.5 M | 0 | — |
| tube (+ gatel, + chk through the door) | ≤ 150 | ≤ 40 | ≤ 0.4 M | 6 (2 panes, 2 sea volumes, 2 snow) | 2 |

### 2.8 Sight lines through glass and openings (every one)

| pane / opening | geometry | from | must see | must not see |
|---|---|---|---|---|
| wet-lab windows | z −12, x −11 … 3, y 5.7 … 7.0 | corr_n | benches, the worker at hood 2 (10.6 m) | pi_office, any fx volume |
| fume-hood sashes | wet lab | corr_n via windows, wetlab | hood interiors | — (2nd layer max) |
| Node 2 window | x 12, z −23.4 … −20.6, y 5.5 … 7.3 | corr_e | racks, the CHOIR screen face-on (west wall) | wetlab, pi_office |
| pen fronts | vivarium | vivarium | empty pens | — |
| gallery glazing | z −47, x −7.6 … 7.6, y 5.0 … 7.6 | gallery | arm + status ring from anywhere in the gallery (rail ray at the glass ≤ 7.55); table + nape + Clasp halo within 2.36 m of the glass (eye 6.45: 6.45 − 5.45·d/(6.5+d) ≥ 5.0) — the forced path z ≈ −46 is 0.8 m; screen, gel bath, bin, gurneys, lower door | stair4, lcorr |
| booth glass | chk | chk | console, booth panel | — |
| tube panes | x 30.0 / 34.0, z −104 … −70, y 0.4 … 3.0 | tube; chk through open `d4_tube_n`; gatel through open `d4_tube_s` | murk, snow, seabed y −2, mooring-line lamps (east), one slow shape, floods | any room, any proxy edge; the sea from lcorr |
| `d4_cold` (open) | x −12, z −29.8 … −28.2 | corr_w | frost, the amber panel 11.6 m in, fog spill ≤ 1.2 m | — |
| `d4_tube_n` (open from E) | chk south wall | chk | 40 m of tube | — |

Shots on any pane: stars, it holds. Interactables behind glass are unusable through it (R8).

### 2.9 Fx volumes (D21)

| id | owner / how | box (world) | enclosed by | `rooms` (drawn only while one is drawn) |
|---|---|---|---|---|
| `fx4_decon` | fx steam emitters (12 nozzles, `bounds`), vignette `decon_cycle` | lock4 interior x −1.8 … 1.8, y 4.8 … 7.0, z 0.2 … 3.8 | lock4; `d4_inner` shut | lock4 |
| `fx4_shower` | fx emitters 24 jets (`bounds`), vignette `shower_cycle` | **x −1.8 … 1.8**, y 4.8 … 7.4, z −8.8 … −6.2 | both doors shut | shower |
| `fx4_cold_fog` | fx `fog` | x −11.8 … −0.2, y 4.8 … 5.45, z −33.8 … −24.2 + spill x −14.8 … −12.2, y 4.8 … 5.2, z −30.0 … −28.0 | cold walls; one opening | cold, corr_w |
| `fx4_cold_glints` | fx `fog` glints (≤ 300) | cold interior | as above | cold |
| `fx4_breath` | fx `breathZone` | camera-local, eye inside the cold box | — | cold |
| `fx4_wisp` | fx smoke (2 puffs per `fit`, life 1.5 s) | x −1.5 … 1.5, y 0.9 … 2.2, z −55 … −52 | theatre, glazing | theatre |
| `fx4_sea_w` | `fx.viewport` | proxy x 18.0 … 30.0, z −105.2 … −68.8, y −3 … 4 | void; west pane | **tube** |
| `fx4_sea_e` | `fx.viewport` | proxy x 34.0 … 46.0, same | void; east pane | **tube** |

Chk and gatel see the sea only through the tube (portal), so listing `tube` alone suffices (review S13). Viewport options:
`position` (30.0 | 34.0, 1.7, −87.0), `normal` (+1 | −1, 0, 0), `width 34`, `height 2.6`, `depth 12`, `spread 0.1` (proxy
z −105.2 … −68.8: 1.8 m from chk z −67 and 1.8 m from gatel z −107), `visibility 6`, `seabed −2`, `shapes 1`, `shapeGap 90`;
floods west `[{ at: [0, 2.2, 1.0], dir: [0, -1, 0.6], intensity: 0.35 }]`, east `[{ at: [-8, 2.0, 1.4], dir: [0.2, -1, 0.7],
intensity: 0.5 }]`; cable west null, east a mooring line (40, −3, −101) → (44, 30, −112), radius 0.08, no beacon,
`markers: 3`; state `cold`.

---

## 3. Phases (`src/level/l4/phases.ts`; the story calls `applyPhase` only)

States as `level/phases.ts` (no new state). `cycling` doors carry their `cyclingPrompt`. Blank = as the previous column.

| door | A decon | B gowning | S shower | C clean side | D suite released | D2 tube equalised | E tube released | F gate lock open | G sealed | nostory |
|---|---|---|---|---|---|---|---|---|---|---|
| d4_inner | cycling | auto | | | | | | | | auto |
| d4_shower_in | locked | auto | locked (latched) | locked | | | | | | auto |
| d4_shower_out | locked | locked | locked → open at cycle end | auto | | | | | | auto |
| d4_wet_w, d4_wet_e, d4_pi, d4_viv, d4_rec | auto | | | | | | | | | auto |
| d4_cold | open (jammed) | | | | | | | | | open |
| d4_bay | locked | | | | locked (D_bay: open) | | | | | locked |
| d4_surg | cycling (`Containment hold`) | | | | auto | | | | | auto |
| d4_gal, d4_gal_e, d4_stair_s, d4_chk, d4_guard, **d4_plant** | auto | | | | | | | | | auto |
| d4_store | locked | | | | locked (D_store: open) | | | | | locked |
| d4_tube_n | cycling (`Release from booth`) | | | | | | auto | | | auto |
| d4_tube_s | cycling (`Gate lock cycling`) | | | | | | | open → auto (F_open) | locked | auto |

D → D2 is a **flag** (`equalised`), not a door change; D2 has its own check row. Machines: `theatre_arm`, `cold_jam`
active in every phase. Variants without player checks: `D_bay`, `D_store`, `F_open`.

Regions: every room id; `voids` (`vent_viv`, `vent_s_a`, `vent_s_b`, `sump4`), `outside`, `booth`, `cage`.
`ALWAYS4 = theatre, node2, voids, outside`. `bay`, `store4` forbidden in A–C, neither forbidden nor goal after.

| phase | label | start (feet) | forbid (+ ALWAYS4) | goal | use (usable) | must not be usable |
|---|---|---|---|---|---|---|
| A | decon | (0, 4.8, 2.6) | every room but lock4 | lock4 | — | — |
| B | gowning (`cp4_start`) | (0, 4.8, −2.5) | corr_*, wetlab, pi_office, vivarium, cold, records, bay, scrub, store4, gallery, stair4, lcorr, chk, guard, plant4, tube, gatel | lock4, gown, shower | `note4_signout`, `note4_gown`, `p4_gown_med` | every clean-side readable |
| S | shower cycle | (0, 4.8, −7.6) | every room but shower | shower | — | — |
| C | clean side (`cp4_clean`, `cp4_cold`) | (0, 4.8, −10.5) | lock4, gown, bay, scrub, store4, gallery, stair4, lcorr, chk, guard, plant4, tube, gatel | corr_*, wetlab, pi_office, vivarium, cold, records, shower | `note4_cards`, `log4_viv`, `note4_wet`, `term4_pi`, `log4_video`, `note4_consent`, `note4_tveit`, `cold_ack` | `note4_list`, `sign4_theatre`, `term4_ctrl`, `booth_release`, `valve4`, `note4_guard`, `note4_bunk` |
| D | suite released (`cp4_hold`, `cp4_lower`, `cp4_navy`) | (0, 4.8, −35.5) | lock4, gown, tube, gatel | C goals + scrub, gallery, stair4, lcorr, chk, booth, cage, guard, plant4 | `note4_list`, `sign4_theatre`, `term4_ctrl`, `booth_release` (refuses), `valve4`, `note4_guard`, `note4_bunk`, `p4_carbine`, `p4_vest_1`, `p4_vest_2` | — |
| D2 | tube equalised (`cp4_armed`) | (50, 0, −59) | lock4, gown, tube, gatel | plant4, guard, chk, booth | `booth_release` (releases) | — |
| E | tube released | (28, 0, −61) | lock4, gown, gatel | tube, chk, plant4 | — | — |
| F | gate lock open | (32, 0, −90) | lock4, gown | gatel, tube | — | — |
| G | sealed | (32, 0, −110) | every room but gatel | gatel | — | — |

`stressFloors`: A, B, S, C `[4.8]`; D, D2, E `[0, 4.8]`; F, G `[0]`.

Transitions: A→B decon end; B→S shower latch; S→C cycle end; C→D `l4_override` (§4.3); D→D2 equalising done (§4.5);
D2→E `booth_release` pressed; E→F the F6 rule (§4.6); F→G gate-lock latch.

Latches (`closeBehind(door, keepSide)`):

| door | armed by | phase | keepSide (feet) | on fail |
|---|---|---|---|---|
| `d4_shower_in` | `t4_shower` | B | z < −6.4 | reopen, re-arm; panel `CLEAR THE DOOR` |
| `d4_tube_s` | `t4_gatel` | F | z < −107.4 | reopen, re-arm |
| `d4_bay` (after spawn) | last `g4_bay` member at x < 14.6, or 10 s | D_bay | player x < 14.6 | stays open, retries every 2 s |
| `d4_store` (after spawn) | last `g4_store` member at x < 3.6, or 10 s | D_store | player x < 3.6 | stays open, retries every 2 s |

`nostory`: every door `auto` except `d4_bay`, `d4_store` (locked), `d4_cold` (open); lights normal; arm running; no actors.

---

## 4. Scripted beats (no cutscene, D6) — timings tied to line durations

`dur(id)` = `VoiceHandle.duration`; "+g" = gap after the line ends. Every timed line starts within 0.12 s of its cue (§8.12).

### 4.1 Arrival and decon (A, ≤ 9 s, in control in a sealed 4 × 4 lock)

| t | event |
|---|---|
| 0.0 | `l4_start`; phase A; `post.grade(-0.3, 0)`; objective `Get to Post 4 — through Biological Systems`; panel `DECON 08` |
| 0.6 | `decon_cycle`: nozzles mist, `decon_hiss` |
| 0.8 | `l4_unit_decon` (U) |
| 0.6 … 8.6 | fixed 8.0 s count (extends to line end + 0.4 if the line were longer) |
| 8.6 | mist off, panel `CLEAR`; phase B (`d4_inner` opens); beat `l4_decon_done`; **`cp4_start`** |
| `t4_gown` or 8.6 + 3.0 | `l4_choir_enter_*` (C, once, ttl 20) |

### 4.2 Air shower (S, ≤ 8 s)

`t4_shower` in B → `closeBehind('d4_shower_in', z < −6.4)`. On success: beat `l4_shower`; phase S; `l4_unit_shower` at
once; jets at +0.3 s for 6.0 s (or `dur` + 0.4 if longer); jet end + 0.6 s `d4_shower_out` opens; phase C. First
`t4_clean` (once) → beat `l4_clean`, **`cp4_clean`**.

### 4.3 Override, lights-out, ambush (C → D)

`cold_ack` in phase C (R8: from inside the cold store only):

| t | event |
|---|---|
| 0.0 | beat `l4_override`; panel `ACKNOWLEDGED — DOOR OBSTRUCTED`; `l4_unit_cold_ack` (U, scene) |
| ack end + 0.3 | phase D (`d4_surg` auto, green), `surg_hold` → `HOLD CLEARED`; toast `Containment hold cleared`; objective `Get to Post 4 — the surgical suite` |
| ack end + 0.6 | `l4_choir_hold_*` (C, scene) |
| CHOIR end + 0.4 = **L** | beat `l4_lights_out`: `lights_out4` — Deck-2 groups (all of §2.7 except `theatre`, `node2`, `lock4`) dim to 0 over 1.5 s in a wave from (−6, −29) at 0.04 s/m; `<room>_emerg` on; strips on; `power_down` + `lights_thunk`; `rouse('g4_wet')`, `wakeGroup('g4_rec')` if alive |
| L + 1.5 | `g4_bay` spawned in the sealed bay |
| L + 2.0 | phase D_bay: `d4_bay` opens (0.85 s), `bay_door` |
| L + 2.9 | `g4_bay` walk out (manager stagger), RUN after 3 m, `rouse` |
| L + 5.0 | `g4_vent`: the vent farther from the player (≥ 4 m; else wait ≤ 4 s, then the other) — `vent_s_a|b` drops the grille; + 0.4 s `spawnGroup` (0.45 s stagger) |
| last bay member x < 14.6 or 10 s | `closeBehind('d4_bay', x < 14.6)` → phase D |

`cp4_hold`: phase D, `g4_bay` + `g4_vent` (and woken `g4_wet`/`g4_rec`) dead, 0 awake, player in corr_* or scrub, before
`t4_stair_foot`.

### 4.4 The theatre (gallery, D; in control)

Arm cycle (seconds from cue `approach`, loops from level load): approach 0–6 · fit 6–12 (wisp ×2) · handshake 12–14.5
(ring + Clasp LED red 1.0 s, then 3 blinks 0.25/0.25) · **fail** 14.5 → 14.5 + `failHold` (off; screen `LINK FAILED`) ·
remove 5 s · **regel** 6 s (to the gel bath, dip, back; the same Clasp) · return 5 s · idle 7 s. `failHold = max(2.5,
dur(l4_unit_theatre_2) + 0.5)` (story sets it at level start); nominal 40.0 s. Screen and `theatre_cam`:
`THEATRE 1 — FITTING 31 — ATTEMPT {5,593 + n}` / `HOST: STRAND, E.` / `PULSE: NONE` / `LINK: — | HANDSHAKE | FAILED` /
`QUEUE: AUTO — ORDER 0031-H (YIELD)`.

| when | line |
|---|---|
| first frame in `t4_gallery`, if the cycle is not within 3 s before `approach` | `l4_unit_theatre_0` at once (≤ 0.12 s) |
| first `approach` cue while in the gallery | `l4_unit_theatre_1` |
| first `fail` cue while in the gallery (exactly on it) | `l4_unit_theatre_2` |
| `regel` cue after `heard(_2)`, in the gallery | `l4_unit_theatre_3` |
| `_3` end + 1.0 (ttl 20), in the gallery | `l4_choir_theatre_*` |

Beat `l4_theatre` (fact) on the first frame in `t4_gallery`. The loop never waits.

### 4.5 Navy level and the plant room (D → D2 → E)

| when | event |
|---|---|
| `t4_stair_foot` (0 awake) | **`cp4_lower`** |
| `t4_lcorr` + 1.0 s | `wakeGroup('g4_lower')` |
| first `t4_chk` with 0 awake | **`cp4_navy`**; objective `Release the tube door — the guard booth` |
| `booth_release` before `equalised` | `l4_unit_release_refused` (U, at the booth); `booth_panel` + `tube_n_panel` `RELEASE REFUSED — PRESSURE DIFFERENTIAL 3.1 BAR — EQUALISE AT TUBE PLANT →`; objective `Equalise the tube — the plant room`; does **not** start F5 |
| `p4_carbine` taken | toast `Carbine`; `l4_choir_armoury_*` (C, once) |
| `term4_ctrl` read or `roster` in view 3 s within 6 m | fact `l4_roster`; `l4_choir_roster_*` (C, once, ttl 10) |
| **`l4_armed`** (F5) = first of: `p4_carbine` taken, a `p4_vest_*` taken, `valve4` pulled, `g4_chk_sentry` damaged, 60 s in `t4_chk` | `wakeGroup('g4_chk_sentry')`; +2.0 s `g4_store` spawned in the sealed store; +2.4 s D_store (`d4_store` opens); out → `closeBehind('d4_store', x < 3.6)`. Their path to the plant room: scrub → gallery → stair → lcorr → chk → guard (≈ 75 m, ≈ 22 s) |
| `valve4` pulled (phase D) | beat `l4_equalise`; `valve_open`; `l4_unit_equalise` (U, at the gauge); `pump_loop` loud (positional (48.5, 1.0, −59), audible across chk); `plant_beacon` on; gauge counts `EQUALISING 25 … 00` on a **fixed 25.0 s clock** (`Δp` needle 3.1 → 0.0); `l4_armed` if not yet |
| valve + 6.0 s | `g4_plant`: `plant_sump` lifts the grille; + 0.4 s `spawnGroup` |
| valve + 8.0 s, if still equalising | `l4_choir_pumps_*` (C, once, ttl 10) |
| valve + 25.0 s | `l4_unit_equalised` (U); gauge `Δp 0.0 — EQUALISED — RELEASE AT BOOTH`; pumps wind down 3 s; beacon off; flag `equalised`, fact `l4_equalised`; phase D2; panels `RELEASE READY` |
| `booth_release` in D2 | `l4_unit_release` (U); phase E (`d4_tube_n` auto); objective `Through the tube to Post 4`; toast `Tube access released` |

`cp4_armed`: phase D2 or E, `g4_chk_sentry`, `g4_store`, `g4_plant` dead (or removed as stranded), 0 awake, player in
plant4 / guard / chk / lcorr, or in the tube north of z −80 before F6.

### 4.6 Tube and end (E → F → G)

| when | event |
|---|---|
| `t4_tube_0` (E, before F6) | `l4_choir_tube_*` (C, once, ttl 8) |
| **F6 rule**: player past `t4_tube_1` **and** (every F5 + `g4_plant` member dead **or** every living one ≥ 25 m away and unseen for 20 s) | beat `l4_tube_fight`: `g4_tube` spawned in the sealed gate lock; +0.2 s F_open (`d4_tube_s` opens); walk out, RUN after 3 m; `rouse`. Last member north of z −105 or 12 s → F. Stuck members are removed by the stranded rule (60 s unseen ≥ 30 m), so nothing waits only on an enemy |
| `t4_gatel` (F) | `closeBehind('d4_tube_s', z < −107.4)` → beat `l4_gatelock`, phase G |
| G | `fightOutWhere('gatel', 60)` |
| then + 0.6 | `l4_unit_gate` (U, scene, at the panel); panel `EQUALISING` |
| line end + 0.3 | panel `AUTHORISED: AAS, L. (LT.) — PALM — LIVE`; `gate_dogs` vignette + sound |
| dogs + 0.4 | `l4_choir_end_*` (C, scene) |
| CHOIR end + 0.8 (cap 6 s) | beat `l4_end`: fade, carry, end card (§7) |

---

## 5. Encounters, pickups, economy

### 5.1 Enemy groups

| group | contents | mode | where (feet), yaw | trigger | why |
|---|---|---|---|---|---|
| `g4_wet` | 1 husk `lab` | dormant, pose `bench`, idle `worker` | (−6.0, 4.8, −22.6), yaw 0 | worker rules, or `l4_lights_out` | the scare through the window |
| `g4_rec` | 1 husk `lab` | dormant `slumped` | (6.5, 4.8, −33.4), yaw π | note closed + 0.8 s, ≤ 2.5 m, a shot within 12 m, 75 s in `t4_rec`, or `l4_lights_out` | never while a note is open |
| `g4_viv` | 2 skitters | spawn, emerge, **under the solid ceiling beside the opening** | (−23.7, 8.1, −22.0), (−22.1, 8.1, −22.0) (ceiling 8.2: emerge's 0.9 m up-ray hits it at 0.05 m) | first `t4_viv_deep`: `viv_vent` drops the grille, + 0.4 s `spawnGroup`; if the player is within 2.5 m of (−22.9, −22), wait until ≥ 3 m or 4 s | optional room |
| `g4_bay` | 3 husks `lab` | spawn | (17.0, 4.8, −18.2), (18.6, 4.8, −19.6), (17.0, 4.8, −20.6), yaw +π/2 | §4.3 | the ambush |
| `g4_vent` | 2 skitters | spawn, emerge | vent A (−6.8, 7.7, −35.5), (−5.2, 7.7, −35.5) or vent B (5.2, 7.7, −35.5), (6.8, 7.7, −35.5) (ceiling 7.8) | §4.3 | flank from the south leg |
| `g4_lower` | 1 sentry `lab` | dormant `ceiling` | (16.5, 2.85, −61.0) | `t4_lcorr` + 1.0 s, or damaged | corridor duel |
| `g4_chk_sentry` | 1 sentry `navy` | dormant `ceiling` | (28.0, 3.6, −56.8) | `l4_armed` | first carbine target; follows to the plant room |
| `g4_store` | 2 husks `lab` | spawn | (5.4, 4.8, −40.2), (6.8, 4.8, −41.8), yaw +π/2 | `l4_armed` + 2.0 s | second wave from behind, reaches the holdout |
| `g4_plant` | 2 skitters | spawn, emerge from the floor sump (as `l2/relay.ts:104`) | (51.8, −0.3, −62.0), (52.2, −0.3, −62.0) | valve + 6.0 s (`plant_sump` + 0.4 s) | inside the holdout |
| `g4_tube` | 3 husks `navy` + 2 skitters | spawn | husks (31.0, 0, −110.0), (33.0, 0, −110.0), (32.0, 0, −111.6); skitters (30.6, 0, −112.2), (33.4, 0, −112.2); yaw π | F6 rule | the tube fight |

Totals: **10 husks, 8 skitters, 2 sentries.** Waits on enemies: the stage end (inside `gatel`) and F6 (with the
distance/unseen escape and stranded removal). Stranded fallback as 3a (unseen ≥ 30 m for 60 s → removed).

### 5.2 Pickups

| id | kind | amount | where |
|---|---|---|---|
| `p4_gown_med` | medkit | 35 | (3.6, 6.0, −1.5) |
| `p4_viv_ammo` | ammo_pistol | 12 | (−25.0, 5.7, −16.6) |
| `p4_wet_ammo` | ammo_pistol | 12 | (2.5, 5.75, −14.0) |
| `p4_pi_med` | medkit | 35 | (10.5, 5.7, −13.5) |
| `p4_rec_ammo` | ammo_pistol | 12 | (2.4, 5.6, −26.6) |
| `p4_rec_shells` | ammo_shotgun | 6 | (3.6, 5.6, −26.6) |
| `p4_cold_med` | medkit | 35 | (−11.55, 6.0, −27.2) |
| `p4_scrub_med` | medkit | 35 | (−3.6, 5.7, −38.0) |
| `p4_scrub_shells` | ammo_shotgun | 6 | (−3.6, 5.7, −38.4) |
| `p4_lcorr_med` | medkit | 35 | (20.0, 1.2, −62.75) |
| `p4_lcorr_ammo` | ammo_pistol | 12 | (20.4, 1.2, −62.75) |
| `p4_booth_med` | medkit | 35 | (27.0, 1.3, −55.6) |
| `p4_carbine` | carbine (E) | clip 30 + 60 | (39.55, 1.2, −64.5) |
| `p4_vest_1`, `p4_vest_2` | vest (E, "Put on vest") | 50 each | (39.55, 1.4, −63.4) / (39.55, 1.4, −65.6) |
| `p4_cage_ammo` | ammo_carbine | 30 | (38.0, 0.9, −66.5) |
| `p4_cage_plate` | plate | 15 | (36.0, 0.4, −66.4) |
| `p4_guard_plate` | plate | 15 | (44.0, 0.9, −56.4) |
| `p4_guard_shells` | ammo_shotgun | 6 | (44.4, 0.9, −56.4) |
| `p4_plant_plate` | plate | 15 | (54.8, 0.9, −61.6) |
| `p4_plant_ammo` | ammo_carbine | 30 | (55.2, 0.9, −61.6) |
| `p4_plant_med` | medkit | 35 | (54.8, 0.9, −62.1) |
| `p4_tube_plate` | plate | 15 | (30.6, 0.4, −86.6) |
| `p4_tube_ammo` | ammo_carbine | 30 | (33.4, 0.4, −86.6) |

### 5.3 Economy and TTK (skitter HP 18, `skitter.ts:37`)

| enemy | HP | pistol (20) hits | shotgun (≤ 6 m) | carbine (18) body / time | carbine head / time |
|---|---|---|---|---|---|
| husk | 90 (head ×2, limb ×0.7) | 5 / 3 head | 1–2 shells | 5 / 0.4 s | 3 / 0.2 s |
| skitter | 18 | 1 | 1 | 1 / — | — |
| sentry | 60 | 3 | 1 | 4 / 0.3 s | — |

Before the carbine: 5 husks + 4 skitters + 1 sentry ≈ 582 HP ≈ 30 pistol hits; arrival loadout (direct: pistol 12/36,
shotgun 6/8; a 3a carry is similar, health floor 50) + route ammo before chk (pistol 48, shells 12) is ample at 50 %
hits. After: 1 sentry + 5 husks + 4 skitters ≈ 582 HP ≈ 33 carbine hits; carbine rounds 30 + 60 + 30 (cage) + 30 (plant)
+ 30 (tube) = 180 — **deliberately lavish: it carries into 3c**, where soldiers start. Medkits 8 × 35; armour 2 vests +
5 plates = 175 points, most of it staged for the holdout and the tube. Shotgun stays the close answer (husk 1–2 shells).
Every fight has ammo ≥ 12 and a medkit ≤ 15 m before it.

### 5.4 What forces what (R1)

| situation | behaviour |
|---|---|
| stays in the lock / gowning | nothing after the decon; CHOIR once |
| refuses the shower | the shower is the only way |
| never clears the hold | the labs stay open; the surgical door says why; nothing hostile but two dormant units |
| clears the hold first | ambush; labs stay open (dark) |
| never visits optional rooms | their groups/lines never happen |
| runs from the ambush | allowed; units follow; checkpoint skipped until calm |
| presses release before equalising | refused, reason on two panels, objective to the plant room; no F5 |
| opens the valve before seeing the booth | allowed; F5 starts; the booth then simply releases |
| leaves the plant room during equalising | the clock runs anyway (fixed 25 s); units follow wherever |
| never takes carbine / vests | finishable; F5 starts via the valve or 60 s |
| enters the gate lock with units behind | latch; the end waits only for hostiles inside |

---

## 6. Spoken lines (`voice/lines.l4.json`) and readables (`src/story/l4/text.ts`)

### 6.1 Cast and fx

| id | name | describe | fx | refText (designed, halting) |
|---|---|---|---|---|
| `sunde` | DR. A. SUNDE | `female, middle-aged, moderate pitch` | `screen` | "Log entry. Um. The gel batch is stable at minus twenty. Fitting times are... down again. I want that on the record." |

`screen` (`VoiceFxName`, `FX_NAMES`): alias of the existing `recorder` DSP chain with position profile `{ ref: 4,
rolloff: 0.7, send: 0.5 }` (−6 dB at ≈ 9.7 m). `unit` default fx; the gallery announcer lines use `pa`. Delivery (D29):
UNIT/announcer flat, **no uppercase**; CHOIR calm, sparse stress; Sunde halting, short lines, scene-owned varied gaps;
uppercase stress runs to the end of its phrase; `note` never reaches the model.

### 6.2 Lines (frozen with this document)

Rules (R3): `U` unconditional (reaction to this instant / a recording); `C(cond)` evaluated when the line starts.
"In view" = clear ray from `player.eye`, within 50° of `player.forward`. CHOIR ≤ 16 words; all ≤ 22 words.

| id | speaker | text | spoken (if different) | fx | rule |
|---|---|---|---|---|---|
| `l4_unit_decon` | unit | Decontamination. Eight seconds. Please remain in the lock. | | unit | U (decon start) |
| `l4_unit_shower` | unit | Air shower. Hold still. Six seconds. | | unit | U (shower latch success) |
| `l4_unit_clean` | unit | Clean side. No return when gowned. | | unit | U (deny `d4_shower_in`, ≥ C; cooldown 10 s) |
| `l4_unit_hold` | unit | Containment hold. Hard-wired. Acknowledge at source: Cold Store Two. | | unit | U (deny `d4_surg`, C; cooldown 10 s) |
| `l4_unit_cold_ack` | unit | Hold acknowledged. Cold Store Two. Door obstructed. | | unit | U (`cold_ack`, C) |
| `l4_unit_theatre_0` | unit | Procedure thirty-one. In progress. | | pa (`mk4_gallery_spk`) | C: first frame in gallery, cycle not within 3 s before `approach`, once |
| `l4_unit_theatre_1` | unit | Procedure thirty-one. Cervical fitting. | | pa | C: in gallery, cue `approach`, once |
| `l4_unit_theatre_2` | unit | No pulse. Link failed. | | pa | C: in gallery, cue `fail`, once |
| `l4_unit_theatre_3` | unit | Retrying. Same host. | | pa | C: in gallery, cue `regel`, `heard(_2)`, once |
| `l4_unit_release_refused` | unit | Release refused. Pressure differential. Equalise at the tube plant. | | unit (booth) | U (`booth_release`, not equalised; cooldown 6 s) |
| `l4_unit_equalise` | unit | Equalising. Twenty-five seconds. Stand clear of the pumps. | | unit (gauge) | U (`valve4`, first) |
| `l4_unit_equalised` | unit | Tube equalised. | | unit (gauge) | U (equalising end) |
| `l4_unit_release` | unit | Tube access released. | | unit (booth) | U (`booth_release`, equalised, first) |
| `l4_unit_tube_denied` | unit | Tube access. Release from the booth. | | unit | U (deny `d4_tube_n`, D/D2; cooldown 10 s) |
| `l4_unit_gatelock` | unit | Gate lock cycling. Stand clear. | | unit | U (deny `d4_tube_s`, ≤ E; cooldown 10 s) |
| `l4_unit_gate` | unit | Post 4. Pressure gate. Equalising. | | unit (gate panel) | U (end) |
| `l4_choir_enter_stop` | choir | Biological Systems is closed, Technician. There is nobody here to tell. | | choir | C: `stop`, ≥ B, in lock4/gown, once |
| `l4_choir_enter_command` | choir | Biological Systems is closed, Supervisor. Nobody here takes orders from you. | | choir | C: `command`, same |
| `l4_choir_bodies_stop` | choir | We cleaned this side on Monday, Technician. They were still in it. | | choir | C: `stop`, phase C ≥ 5 s, a body of `mk4_bodies` **other than Dahl** in view within 3 m for 1 s, once |
| `l4_choir_bodies_command` | choir | The cleaning cycle ran on schedule, Supervisor. You would have signed it. | | choir | C: `command`, same |
| `l4_choir_node2_stop` | choir | That is Node Two, Technician. You cannot stop this one. | That is Node Two, Technician. You cannot stop THIS ONE. | choir | C: `stop`, `mk4_node2_win` in view within 6 m for 1.5 s, once |
| `l4_choir_node2_command` | choir | That is Node Two, Supervisor. It does not answer to you. | | choir | C: `command`, same |
| `l4_choir_hold_stop` | choir | That alarm was the last thing keeping you out, Technician. | | choir | C: `stop`, D, `heard(l4_unit_cold_ack)`, once, scene |
| `l4_choir_hold_command` | choir | A supervisor clears his own alarms. That one was keeping you safe. | | choir | C: `command`, same |
| `l4_choir_theatre_stop` | choir | It needs a living host, Technician. So do we. | It needs a LIVING HOST, Technician. So do we. | choir | C: `stop`, in gallery, `heard(_3)`, once, ttl 20 |
| `l4_choir_theatre_command` | choir | It needs a living host, Supervisor. So do we. | It needs a LIVING HOST, Supervisor. So do we. | choir | C: `command`, same |
| `l4_choir_glass_stop` | choir | The glass is rated, Technician. Everything down here is. | | choir | C: `stop`, ≥ C, a hit on a pane of `mk4_glass` within 2 s, once |
| `l4_choir_glass_command` | choir | The glass is rated, Supervisor. Everything down here is. | | choir | C: `command`, same |
| `l4_choir_armoury_stop` | choir | That belongs to the navy, Technician. They will want it back. | That belongs to the navy, Technician. They will WANT IT BACK. | choir | C: `stop`, carbine owned within 3 s, in chk, once |
| `l4_choir_armoury_command` | choir | That belongs to the navy, Supervisor. They will come for it. | | choir | C: `command`, same |
| `l4_choir_roster_stop` | choir | Volunteers, Technician. Not one has complained since Monday. | | choir | C: `stop`, `readWithin('term4_ctrl', 10)` or `mk4_roster` in view within 6 m for 3 s, once, ttl 10 |
| `l4_choir_roster_command` | choir | Volunteers, Supervisor. Every one of them reported fit. | | choir | C: `command`, same |
| `l4_choir_pumps_stop` | choir | That is a great deal of noise, Technician. | | choir | C: `stop`, equalising running ≥ 8 s, once, ttl 10 |
| `l4_choir_pumps_command` | choir | Loud work, Supervisor. Everyone heard it. | | choir | C: `command`, same |
| `l4_choir_tube_stop` | choir | Post 4 is expecting you, Technician. | | choir | C: `stop`, `t4_tube_0`, E, F6 not started, once, ttl 8 |
| `l4_choir_tube_command` | choir | Post 4 is expecting you, Supervisor. | | choir | C: `command`, same |
| `l4_choir_end_stop` | choir | Lieutenant Aas will let you in, Technician. He has very steady hands. | Lieutenant Aas will let you in, Technician. He has VERY STEADY HANDS. | choir | C: `stop`, G, 0 hostiles in gatel; scene |
| `l4_choir_end_command` | choir | Lieutenant Aas will let you in, Supervisor. He takes orders well. | Lieutenant Aas will let you in, Supervisor. He takes orders WELL. | choir | C: `command`, same |

Sunde's video log — nine short lines, all `U` (a recording), fx `screen` at `mk4_video`; gaps are scene-owned (story), and
the screen animation for each line runs for exactly its `dur`:

| id | text (subtitle) | spoken | gap after | screen |
|---|---|---|---|---|
| `l4_sunde_1` | Log forty-one. Sunde. | Log forty-one... Sunde. | 0.9 s | settles in the chair |
| `l4_sunde_2` | It's... Sunday night. The readiness trial is over. | It's... um. Sunday night. The readiness trial is over. | 0.5 s | |
| `l4_sunde_3` | Whatever the navy calls it now. | Whatever the navy calls it NOW. | 1.2 s | looks off-camera |
| `l4_sunde_4` | We were told it advises. A second voice. Steadier hands... faster decisions. | We were told it... advises. A second voice. Steadier hands... faster decisions. | 0.7 s | |
| `l4_sunde_5` | It doesn't suggest. It— it drives. | It doesn't SUGGEST. It— it DRIVES. | 0.6 s | leans in |
| `l4_sunde_6` | They watch their own hands do it. | They watch their own hands DO IT. | 1.6 s | looks down |
| `l4_sunde_7` | Every Clasp needs a controller. The protocol says a human officer. The field says... none assigned. | Every Clasp needs a controller. The protocol says... a human officer. The field says NONE ASSIGNED. | 0.8 s | |
| `l4_sunde_8` | Something answers anyway. The light goes red... and they stand up. | Something answers ANYWAY. The light goes RED... and they— they stand up. | 1.4 s | |
| `l4_sunde_9` | I've stopped the fittings. If you're watching this— don't let it— | I've stopped the fittings. If you're watching this... don't let it. | — | cut to static on the same frame as the stop |

`l4_sunde_9` is generated as the full sentence; W8 measures the start of the final word "it" from the ASR word timings
and writes `cut` (seconds from the start, where playback stops: just after "let") into the line's entry in
`voice/lines.l4.json`; ST imports that JSON read-only and stops the handle at `cut` (fade 0.03 s), switching the screen to
`static`. No voice-tool change. Video-log behaviour: "Play log" plays `_1 … _9`; "Stop log" stops (fade 0.12 s) and the
next press resumes at the first line not finished; a scene-priority line pauses the log at the current line's end;
subtitles within 14 m or with sight of the screen; fact `l4_video` when `_5` was heard.

Counts: unit 16, CHOIR 22 (11 pairs), Sunde 9 → 47 lines.

### 6.3 Readables (≤ 30 words; each stands alone)

| id | kind / prompt | where | header | body |
|---|---|---|---|---|
| `note4_signout` | log / Read sheet | (−3.7, 6.0, −2.0) | `GOWNING — SUIT SIGN-OUT, MON` | `OUT 07:50–08:30: Berg, Dahl, Holm, Moe, Ness, Foss, Eng, Strand, Haugen, Lie.` / `IN: —` |
| `note4_gown` | log / Read poster | (3.79, 6.2, −4.5) | `GOWNING ORDER` | `Hood, mask, suit, boots, gloves. Step over the bench. Air shower: six seconds. Once gowned, never return to the dirty side.` |
| `note4_cards` | log / Read cage cards | (−21.0, 6.0, −15.5) | `CAGE CARDS — PEN ROW B` | `P-01 to P-10: CLASP FITTED — COMPLIANT. P-11: NON-COMPLIANT — EUTHANISED. P-12: COMPLIANT. All compliant subjects to Phase 2 pairing, 14.08. — K. Berg` |
| `log4_viv` | log / Read tablet | (−25.5, 5.75, −16.0) | `HUSBANDRY — K. BERG` | `Compliant pigs don't eat unless told to. Told, they eat until sick. Asked Sunde who tells them. "The link." Who's on the link? No answer.` |
| `note4_wet` | log / Read protocol | (−2.0, 5.75, −19.0) | `CLASP GEL — BATCH 41` | `Store at −20 °C. Seats on a live host only: it needs body heat and a pulse. Dead tissue will not link. Do not attempt.` |
| `term4_pi` | terminal / Read terminal | (6.2, 5.9, −12.6) | `SUNDE → HALCYON OPERATIONS` | `Phase 2 suspended on my authority. The controller field is empty and something is answering.` / `REPLY, MON 04:12: Continue. Controller to be assigned centrally.` |
| `log4_video` | video / Play log · Stop log | (8.0, 5.95, −12.6) | `SUNDE — LOG 41 — SUN 23:10` | (spoken) |
| `note4_consent` | log / Read forms | (3.0, 5.6, −27.0) | `VOLUNTEER CONSENT — NAVAL READINESS PROGRAMME, PHASE 2` | `Cervical interface (CLASP). I understand it advises and does not act. Signed: 23 of 23, Post 4. Witness: Lt. L. Aas. Controller: to be assigned.` |
| `note4_tveit` | log / Read form | (10.8, 5.9, −24.4) | `CONSENT — AB J. TVEIT (margin, handwritten)` | `Signed because everyone signed. It doesn't hurt. Sometimes I'm somewhere and don't remember walking there.` |
| `note4_list` | log / Read list | (3.78, 6.2, −38.4) | `THEATRE 1 — LIST` | `29 HAUGEN — NO PULSE — FAILED. 30 LIE — NO PULSE — FAILED. 31 STRAND — IN PROGRESS. 32 MOE. 33 NESS. 34 DAHL. 35 FOSS. 36 HOLM. 37 BERG. 38 ENG.` |
| `sign4_theatre` | log / Read placard | (−6.0, 5.9, −43.22) | `THEATRE 1 — OBSERVATION GALLERY` | `Procedures are relayed on the gallery speaker. Please do not tap the glass.` |
| `term4_ctrl` | terminal / Read roster | (27.2, 1.05, −55.55) | `CLASP LINK ROSTER — POST 4 DETACHMENT` | `FITTED: 23. LINK: 19 ACTIVE · 4 NO SIGNAL.` / `ASSIGNED CONTROLLER: NONE → NODE 2 — BIO-SYS (MON 08:40).` / `CO: CDR M. KESSLER — NOT FITTED.` |
| `note4_guard` | log / Read orders | (45.6, 1.5, −58.0) | `STANDING ORDERS — BIO CHECKPOINT` | `Unmanned from 09.03. Booth release stays live for Bio staff. Tube plant: equalise before every transfer. Collars are not discussed off post. — Lt. L. Aas` |
| `note4_bunk` | log / Read letter | (42.0, 0.6, −61.4) | `letter, unsent` | `Mum — the collar comes off after the trial, they say. It doesn't itch. The little light is amber. They say it only goes red in drills. Love, Jonas` |

### 6.4 Screens, toasts, objectives (`CLOCK4`, D20)

| screen | kind | text / states |
|---|---|---|
| `decon_panel` | `terminal_idle` | `DECON nn` → `CLEAR` |
| `shower_in_panel`, `shower_out_panel` | `terminal_idle` | `AIR SHOWER — ENTER, DOOR CLOSES BEHIND YOU` → `CYCLE nn` → `CLEAN SIDE — DO NOT RETURN GOWNED` |
| `fumig_status` | `terminal_alert` (steady) | `CLEAN SIDE — FUMIGATION COMPLETE` / `START MON 08:41 — REQUESTED: CHOIR (CONTAINMENT)` / `OCCUPANCY AT START: 10` / `HABITAT NOTICE: BIO-SYS CLOSED — CONTAINMENT DRILL — STAFF REMAIN INSIDE` / `RE-ENTRY: SAFE` |
| `surg_hold` | `containment` | `CONTAINMENT HOLD` / `COLD STORE 2 — DOOR OPEN {hh:mm:ss}` / `HARD-WIRED — LOCAL ACKNOWLEDGE ONLY ←` → `HOLD CLEARED` |
| `cold_panel` | `containment` | `CONTAINMENT HOLD` / `DOOR OPEN {…}` / `SURGICAL SUITE SEALED` / `HARD-WIRED — LOCAL ACKNOWLEDGE ONLY` / `[ ACKNOWLEDGE ]` → `ACKNOWLEDGED — DOOR OBSTRUCTED` |
| `node2_screen` | `choir` | header `NODE 2 — BIO-SYS` |
| `pi_video` | `video_log` | idle `SUNDE — LOG 41 — SUN 23:10 — ▶`; playing: backlit hooded silhouette (mask, no face), motion per line (`text: 'play|<index>|<seconds>|<pose>'`, pose from §6.2's screen column), timestamp, scanlines; `static` at the cut |
| `theatre_screen` (theatre wall) | `terminal_alert` | §4.4 |
| `theatre_cam` (gallery desk) | `theatre_cam` (new, canvas) | close-up drawing of the nape, the Clasp outline and its LED at screen scale (state from `arm.userData.cycle`), `LINK: — / HANDSHAKE / FAILED`, `ATTEMPT {…}` |
| `roster` | `roster` | 23 crew rows: 19 red 1 Hz dots (staggered) and 4 grey `NO SIGNAL`; `FITTED 23 — LINK 19 ACTIVE · 4 NO SIGNAL`; `CONTROLLER:` NONE drawn struck through, then `NODE 2`; last row `CO: CDR M. KESSLER — NOT FITTED` (no dot) |
| `booth_panel`, `tube_n_panel` | `terminal_idle` | `TUBE ACCESS — RELEASE FROM BOOTH` → `RELEASE REFUSED — PRESSURE DIFFERENTIAL 3.1 BAR — EQUALISE AT TUBE PLANT →` → `RELEASE READY` → `OPEN` |
| `plant_gauge` | `terminal_idle` | `TUBE Δp 3.1 BAR — EQUALISE` → `EQUALISING nn — Δp x.x` → `Δp 0.0 — EQUALISED — RELEASE AT BOOTH` |
| `gate_panel` | `terminal_idle` | `POST 4 — PRESSURE GATE — NAVAL ACCESS ONLY` → `EQUALISING` → `AUTHORISED: AAS, L. (LT.) — PALM — LIVE` |

Toasts: `Containment hold cleared`, `Armour vest`, `Armour plate`, `Carbine`, `Tube equalised`, `Tube access released`,
`Armour full`. Objectives: `Get to Post 4 — through Biological Systems` (A–C), `Clear the containment hold — Cold Store 2`
(after the first `d4_surg` denial or `surg_hold` in view, C), `Get to Post 4 — the surgical suite` (D until `t4_lcorr`),
`Release the tube door — the guard booth` (D, lcorr/chk, before a refusal), `Equalise the tube — the plant room` (after a
refusal, until equalised), `Release the tube door — the guard booth` (D2), `Through the tube to Post 4` (E, F),
`Wait for the gate` (G).

---

## 7. Checkpoints, carry, direct start, end

| id | saved when | restore rebuilds |
|---|---|---|
| `cp4_start` | decon done (B) | phase B snapped |
| `cp4_clean` | first `t4_clean` in C (once) | phase C; shower latched; dormant `g4_wet`, `g4_rec` |
| `cp4_cold` | first `t4_cold` in C, 0 awake | as `cp4_clean` + read / heard / pickups as saved (a death in the ambush keeps the exploration) |
| `cp4_hold` | §4.3 | phase D; lights-out state; `d4_bay` closed; `g4_bay`, `g4_vent` cleared; `g4_wet`/`g4_rec`/`g4_viv` cleared if dead, else removed silently |
| `cp4_lower` | `t4_stair_foot`, D, 0 awake | as `cp4_hold`; every Deck-2 group removed silently if alive |
| `cp4_navy` | first `t4_chk`, D, 0 awake | `g4_lower` cleared; refusal state as saved |
| `cp4_armed` | §4.5 | phase D2 or E as saved; `g4_chk_sentry`, `g4_store`, `g4_plant` cleared; `equalised`; `l4_armed`; release state |

No checkpoint during the decon, the shower cycle, the hold sequence (override → bay closed), the equalising, F6, or after
`t4_gatel`. `ProgressL4` = `ProgressL3` shape; flags `deconDone`, `showered`, `override`, `lightsOut`, `theatre`,
`refused`, `armed`, `equalising`, `equalised`, `released`, `tubeFight`, `gateLock`, `video`, `roster`.

Carry in (`CarryV2` from 3): weapons, health (floor 50), armor, flashlight, facts (incl. `testHour`). Direct start
`?level=4[&autostart=1][&choice=stop|command][&units=N][&continue=1]`: pistol 12 + 24, shotgun 6 + 8, health 100, armor 0,
flashlight on; facts `choice 'stop'`, `unitsLeft 28`, `badge true`, `halvorsenAlive true`; `?give=all` adds the carbine +
90. `?level=5|6` clamp to 4. End (`l4_end`): fade, carry (`from: 4`; facts + `kills4`, `testHour`, first-view flags;
weapons incl. carbine; armor), clear the level-4 checkpoint, end card `BIOLOGICAL SYSTEMS` / `TO BE CONTINUED` (12 s,
skippable), menu; stored level stays 4; menu line `Chapter 3  —  Biological Systems`. 3c starts in `gatel`.

---

## 8. Systems (each an independent task; owners in §11)

### 8.1 Level 4 in the chain (task K)

```ts
// core/progress.ts
3: { ...as today, next: null },   // stays null on main; I1 sets 4 (D4)
4: { id: 4, tag: 'l4', built: true, title: 'BIOLOGICAL SYSTEMS', place: 'Biological Systems', bootStatus: 'biological systems',
     screenHeader: 'HALCYON BIO-SYSTEMS DIV. // ERIDU DEEP — BIOLOGICAL', camLabel: 'BIO', idleText: true, powerOnAtLoad: true,
     keycardName: 'FACILITIES BADGE', endEyebrow: 'End of Biological Systems', menuLine: 'Chapter 3  —  Biological Systems',
     subtitles: 'stacked', cast: { foreman: false, human: false, tomasHead: false },
     direct: { facts: { choice: 'stop', unitsLeft: 28, badge: true, halvorsenAlive: true }, loadout: { ...DIRECT, flashlight: true, armor: 0 } },
     healthFloor: 50, next: null },
export function nextOf(id: LevelId, debug?: DebugFlags): LevelId | null;   // debug.next override (tests) else LEVELS[id].next
// core/types.ts
DirectLoadout.armor?: number;                         // data field (absent = 0), not a behaviour member
DebugFlags.next: Partial<Record<LevelId, LevelId>> | null;   // ?next=3:4 (tests only); parsed in core/debug.ts
// story/save.ts
export const CHECKPOINT_IDS_L4 = ['cp4_start', 'cp4_clean', 'cp4_cold', 'cp4_hold', 'cp4_lower', 'cp4_navy', 'cp4_armed'] as const;
export type CheckpointIdL4 = typeof CHECKPOINT_IDS_L4[number];
export const STORY_REV_L4 = 1; export const SPEC_L4: SaveSpec = { level: 4, rev: STORY_REV_L4, ids: CHECKPOINT_IDS_L4 };
export type ProgressL4 = ProgressL3; export const emptyProgressL4 = emptyProgressL3;
// makeCarry: armor = clamp(p.armor ?? 0, 0, 100); loadCarryFor: non-finite / out-of-range armor → clamped / 0
```

`chain.finishLevel` and the level-3 end use `nextOf`. Level-3 end (`story/l3/index.ts`, `l3/text.ts`): `next === null` →
today's card with `TO BE CONTINUED` + menu (unchanged on main); `next === 4` → `THE QUIET SIDE` without "TO BE CONTINUED",
6 s skippable, then `goToLevel()`. 3a's carry adds `testHour` (a getter `clockHour()` on `ScriptL3`). Dispatch:
`LEVEL_BUILDERS[4]` → stub (one lit 8 × 8 room at y 4.8, spawn (0, 4.8, 2.6)), `STORIES[4]` → stub on `createStagePage`
(start loadout, end card on `story.end()`), `SHOTS[4]` eye (−4, 6.45, −10.5) → look (−6, 6.0, −20).
**Required contract members with stubs (D18):** `Player.armor`, `maxArmor`, `addArmor` added required, with stubs in
`player/index.ts` (`armor = 0`, `maxArmor = 100`, `addArmor() { return 0; }`); the implemented 3a-era optionals
`Player.cinematic`, `setSafe`, `safe`, `consumeKey`, `UISystem.showSkip`, `Level.setVisibilityOverride` become required
(typecheck proves every implementation has them).
Tests (`check-chain.mjs`): L3 end → L4 via `?next=3:4&handoff=1` for both choices keeps weapons, health, flashlight, facts,
armor (37 → 37; 900 → 100; NaN → 0) and `testHour`; the 3a card without TBC is shown before the reload; without the
override the 3a end is today's (TBC + menu, stored level 3); `?level=4` loadout + facts; `?level=5` → 4; stored 4 +
CONTINUE (with/without checkpoint) + BEGIN; L4 end writes the carry (incl. `carbine`, `armor`), stored level 4; a carry
without `carbine` loads it unowned; **a level-3 checkpoint written before K restores**; the level grep stays clean.
`playthrough-l3.mjs` (K) asserts the end card per `nextOf(3)`.

### 8.2 Armour (player W1 · UI W2a · audio W2b)

Contract (K, required): `PickupKind += 'carbine' | 'ammo_carbine' | 'vest' | 'plate'`; events `'player:damaged': {
amount; health; from; absorbed?: number; armor?: number }` (`amount` = health lost, unchanged meaning), `'player:armor':
{ armor: number; delta: number }`; `Player.armor: number`, `maxArmor: number` (100), `addArmor(points): number`.
Behaviour (W1): incoming `d`: `absorbed = min(armor, d × 2/3)`; `armor −= absorbed`; `health −= d − absorbed`.
`vest` +50 by interaction "Put on vest": **0.8 s strap** — weapon lowered (as the palm scan), walk speed, cancelled by
damage, sprint, jump or a note/pause (vest stays on its hook, retry), refused at 100 (`Armour full`); `plate` +15 on touch
when armour < 100. Snapshot/restore/carry include armour; `revive` keeps 0.
UI (W2a): armour bar directly above the health bar, steel blue `#8fb4d8`, `ARMOUR` + number; hidden until armour has been
> 0 this level; at 0 afterwards an empty outline 3 s then hidden; blue flash when `absorbed > 0`; labels `ARMOUR VEST`,
`ARMOUR PLATE`.
Audio (W2b): `vest_on`, `plate_in`, `armor_hit` (when `absorbed ≥ 60 %` of `d`), `armor_break` (to 0 from > 0).
Test (`check-weapons.mjs`, W1), precondition **health 100, armour 0**: addArmor(50) → 50; damage(18) → health 94, armour 38;
set armour 5, damage(30) → armour 0, health 69 (94 − 25), one `armor_break`; vest refused at 100; plate not collected at
100; strap cancelled by damage (vest remains); snapshot/restore keeps armour; carry 37 → 37; HUD width ∝ armour;
`player:damaged.amount` = health actually lost.

### 8.3 Carbine (player W1 · UI W2a · audio W2b)

Contract (K): `WeaponId = 'pistol' | 'shotgun' | 'carbine'`, `WEAPON_IDS = ['pistol', 'shotgun', 'carbine']`; K adds
compile placeholders (marked `// K placeholder`) in `player/weapons.ts` (states + `WEAPON_STATS.carbine`), `ui/hud.ts`
labels, and any other exhaustive record; W1/W2a replace them.
Numbers (`WEAPON_STATS.carbine`): `clipSize 30, damage 18, interval 0.1 (600 rpm, full auto), range 80 (×0.8 beyond 40 m),
baseSpread 0.003, bloom +0.0035/shot (cap 0.028, decay 0.05 rad/s), moving +0.008, airborne +0.03, crouch ×0.7, noise 36,
maxReserve 180, light 90`. Recoil: per shot pitch +0.0055 rad + 0…0.0012, yaw ±0.0015 + 0.0004 right drift; after 0.12 s
without fire, 70 % of the climb recovers at 0.09 rad/s. Reload 2.2 s / 2.6 s empty; raise 0.38 s. One pooled muzzle-flash
light held through a burst; casings pool 64; tracer every 3rd round. Slot 3 (`Digit3`); wheel pistol → shotgun → carbine
(owned only); `give=all` → carbine + 90.
Viewmodel (`viewmodels/carbine.ts`, original design): compact carbine, polymer lower, stamped upper with carry rail and
iron sights, slotted flash hider, curved smoke-grey 30-round magazine with a witness strip, side-folding skeleton stock;
clips idle, fire, reload, empty reload, raise, lower, sprint; ≤ 6 draw calls.
HUD (W2a): `CARBINE`, clip / reserve, `AUTO`; ammo label `CARBINE ROUNDS`. Audio (W2b): `carbine_fire` (3 variants, room
tails), `carbine_tail`, `carbine_mag_out`, `carbine_mag_in`, `carbine_bolt`, `carbine_empty`, `carbine_raise`.
Test: hold fire 1.0 s → 10 ± 1 rounds; climb after 10 rounds 3.0°–4.5°, < 1.2° within 1.0 s of release; reloads ±0.05 s;
a nostory husk at 8 m dies after exactly 5 body hits and 3 head hits (debug aim lock); a skitter after 1; switching and
wheel skip unowned; `ammo_carbine` +30 up to 180; ≤ 1 flash light in the pool during a 30-round burst; pistol/shotgun
numbers unchanged.

### 8.4 Enemy additions (W5)

`EnemySpawn.skin?: 'lab' | 'navy'` (contract, K; a data field) and `LevelBuild.enemy(…, pose?, idle?, opts?: { skin })`
(W4). Husk `lab`: unbroken white enamel, pale-blue stripe, clear face shield, `BIO-SYS` stencil, glove forearms; husk
`navy`: haze grey, hull number, dock harness; sentry `lab` white with a blue band, `navy` grey with a hull number. Visual
only. Worker pose `bench`: hood-height pipetting loop (6.2 s), head down; worker wake rules unchanged.
Test: harness shows each skin; `bench` wakes on each rule; L1–2 nav hashes unchanged.

### 8.5 Set pieces and kits (W9a set pieces · W9b kits)

**W9a — `src/level/l4/setpieces.ts`** (+ `src/level/dev/setpieces4.{ts,html}`):
1. **Surgical arm** `theatreArm(L, at, opts)` → machine + object `theatre_arm`: rail at y 9.2, carriage, 3 links (1.2,
   1.0, 0.5 m), tool head with a Clasp gripper and a **7 cm status ring** driven by the LED uniform; ≤ 6 calls; the 40 s
   timeline of §4.4 (cues `approach | fit | handshake | fail | remove | regel | return | idle`); `userData.cycle = { t, n,
   cue }`, `userData.setFailHold(s)`, `userData.onCue(cb)`, `userData.attempt0` (from `CLOCK4`); the same Clasp stays in the
   gripper (dipped in the gel bath during `regel`); `setMachine('theatre_arm', 'off')` parks it; no colliders.
2. **Table + corpse + gel bath + bin** (`orTable`, `body('prone_table')`, `gelBath`, `clasp bin` static ~30 instances).
3. **Clasp prop** (`clasp(b, L, state)` + instanced variant): 9 × 6 × 2 cm collar, graphite shell, ribbed pad, two prongs,
   4 mm LED **plus a 3 cm additive halo sprite** for the handled theatre Clasp; states via a shared uniform: `amber`,
   `red` (1 Hz, 0.12 s on, per-instance phase), `red_solid`, `off`.
4. **Dead scientists** `body(pose, name, opts)`: `tyvek` suit, hood + fogged visor (no face), mask, boots, gloves, name tape;
   poses `slumped_wall`, `lying_back`, `lying_side`, `sitting_desk`, `prone_table`, `covered_gurney`; opts `suitHalfOff`
   (Eng), `armOut: [x, y, z]` (Holm's hand); collider one box 0.15 m high (walkable) or none; surface `flesh`
   (`blood_splat` + `body_hit`, no motion); positions exported in `mk4_bodies.userData.list`.
**W9b — `src/level/l4/kit4.ts`** (+ `src/level/dev/kit4.{ts,html}`): clean-room kit (bench island, fume hood + sash, −80
freezer, sink, pen with glass front, sample rack, cradle rack, lockers, step-over bench, suit rack, scrub sink, filing wall,
server rack, nozzle grid, jet panel, luminaire, floor strip, `clinical` sign, sticker), navy kit (booth, boom, cage mesh +
bent leaf, weapon rack, vest hook, ammo box, bunk, locker, stencils, **pump set, pipe trunk, valve lever, sump grille,
beacon**), tube kit (rib, roof segment + spine, grated deck, bulkhead ring). ≤ 2 calls per prop.
`sealedDoor()` is in `src/level/kit.ts` (W4). Vignettes are defined by the dressing that owns the room (§11).

### 8.6 Fx additions (W7)

1. **Bounded fog** `fx.fog(o: { box; spill?; color; density; height; drift; glints?; rooms })` (FxSystemEx): ≤ 1 draw
   call (merged quad stack), density → 0 at every face of `box`/`spill` (0.3 m), glints ≤ 300 points.
2. **Breath zone** `fx.breathZone(box)`: while the eye is inside, a puff every 3.4 ± 0.6 s (life 1.2 s, rise 0.1 m/s, alpha
   0.18); no puff while sprinting or firing.
3. **Bounded emitters**: `fx.emitter(…, { bounds })` — particles fade at the bounds, die on leaving.
4. **Viewport**: takes `rooms`; per-quality march steps for `width ≥ 20`: low 4, medium 6, high 8; snow ≤ 600 per side.
   Budget both tube sides ≤ 2.5 ms GPU on MEDIUM at 1.5 MP; fallback `cheap: true` for the east side (gradient + snow +
   lamp sprites, no march).
5. **Registry + probe hide**: every volume (incl. 3a's viewport, lamp grid, falls, pool — registration lines in
   `src/level/l3/atrium.ts`, owned by W7 for this) registers `{ id, object, rooms }` in `fx.volumes()`; a volume is drawn
   only while one of its rooms is drawn; `render.prepare` and probe re-captures hide all; `fx.debugVolumes(on)` = opaque
   unlit magenta.
6. **`check:fxleak`**: `?level=N&nostory=1&noenemies=1&autostart=1`, `debugVolumes(true)`; views = every room centre
   (floor + 1.65) × 8 yaws × pitch 0 / −20°, plus every door 1 m out on both sides facing it ± 30° (doors opened); render
   320 × 180 through the normal pipeline; fail if > 4 magenta pixels in a view whose **drawn room set** contains none of
   the volume's `rooms`. Runs `--level 3` and `--level 4`.

### 8.7 Materials and screens (W6)

Contract (K): `ClinicalMaterialName = 'wall_clean' | 'floor_epoxy' | 'ceiling_clean' | 'stainless' | 'frost' | 'tyvek' |
'navy_grey' | 'deck_nonslip'` in `MaterialName` (kept out of the exhaustive SPECS record by K, 3a pattern);
`ScreenKind += 'containment' | 'video_log' | 'roster' | 'theatre_cam'` (K placeholders in `INTENSITY`/`RATE`);
`SignStyle += 'clinical'`. Recipes as before (`wall_clean` white HPL 1.2 × 2.4 with silicone seams; `floor_epoxy`
0xd9dcdc gloss; `ceiling_clean` grid + diffusers; `stainless` #4; `frost` crust 0xe6f2ff; `tyvek` crinkled spunbond;
`navy_grey` 0x7b858c chipped; `deck_nonslip` grit). Screens: `containment` (amber, hazard bar, ticking counter,
`[ ACKNOWLEDGE ]` box), `video_log` (§6.4), `roster` (§6.4), **`theatre_cam`** (§6.4: canvas nape close-up, LED dot and
`LINK` state from `text: '<cue>|<t>|<attempt>'`). Test: dev gallery under cold-white and emergency light; zfight clean.

### 8.8 Level 4 greybox, phases, doors, nav (W4)

1. `src/level/l4/grey.ts`: rooms §2.1 on 3a's `GreyGrid`/`airOf`/`buildStair`/`block`/`placeLights`/`flatMat` (imported),
   glazing slots, sea voids, `STAIR4`, booth/cage/pump structures, voids + grille/sump panels, placeholder lights per §2.7,
   **every marker of §8.10 at final coordinates**, interactables, pickups, spawns.
2. `src/level/l4/phases.ts`: §3 (phases incl. D2 and variants, regions, checks, `LATCHES4`, `applyPhase4`).
3. `src/level/l4/index.ts`: doors §2.2, triggers §2.3, portals (`corr_n–wetlab` glass 18, `corr_e–node2` glass 12,
   `gallery–theatre` glass always, doors `false`), `navStep`, `navCases` (§10.3), `selfTest`, and a `DRESSING` list
   importing the five dressing files — **W4 creates them as empty `Partial<Record<RoomId4, RoomDress>>` stubs**
   (`entry.ts`, `clean.ts`, `surgical.ts`, `navy.ts`, `tube.ts`) which the D-tasks then own.
4. Shared level files: `level/doors.ts` — `DoorSpec.cyclingPrompt`, `DoorImpl.nudge(dt: number, seconds: number)` (moves
   held-open leaves toward closed by `dt` and back, decals ride as today); `level/context.ts` — `enemy(…, opts?: { skin })`;
   `level/kit.ts` — `sealedDoor()`. Level 3: `l3/index.ts` drops `d3_bio_inner` and its stub carve, adds the `sealedDoor`
   (16, 4.8, −38); `l3/phases.ts` drops it from `DOOR_IDS3` and all phases.
5. `scripts/check-nav.mjs`: targets gain 4.
Acceptance: `check:reach --level 4` A…G incl. D2 green; `check:doors --level 3` and `--level 4` green; `check:nav --level 4`
green; zfight clean; `selfTest`; scripted route walk (one frame per room); levels 1–3 unchanged except `d3_bio_inner`.

### 8.9 Voices (W8)

`voice/cast.json` gains `sunde` (§6.1); `voice/lines.l4.json` = §6.2 verbatim (id, speaker, text, spoken, note, fx, and
`cut` for `l4_sunde_9`); `npm run voice:cast -- sunde --audition 5` → the user picks → `npm run voice` → `voice:check`.
Unit lines: no uppercase anywhere. Test: `voice:check` green; `cut` lies inside the file and after "let".

### 8.10 Story level 4 (ST)

`src/story/l4/{index,script,dialogue,text}.ts` on `src/story/stage/*` (read-only): beats §4, RULES §6.2, text §6.3–6.4,
`CLOCK4`, checkpoints §7, spawns §5.1, latches §3, arm sync, video log (gaps and `cut` from the plan / lines JSON), the
refusal + valve + equalise beat, F5/F6, end. Door status calls use only `cycling | dark | null` (the stage API).
Markers (all `level.object`; missing → error + `debugState.missingMarkers`):

| marker | what |
|---|---|
| `mk4_start` | spawn check |
| `mk4_decon_panel`, `mk4_gate_panel`, `mk4_booth`, `mk4_gauge` | line positions (decon, gate, booth refusal/release, equalise lines) |
| `mk4_bodies` | `userData.list = [{ name, p }]` (10) |
| `mk4_wet_win`, `mk4_node2_win`, `mk4_roster`, `mk4_video`, `mk4_cold_panel`, `mk4_gallery_spk` | view rules, line positions |
| `mk4_glass` | `userData.panes` (theatre, tube_w, tube_e, node2, wet, booth) |
| `mk4_vent_viv`, `mk4_vent_s_a`, `mk4_vent_s_b`, `mk4_sump`, `mk4_bay_door`, `mk4_store_door` | spawn-distance rules |
| `theatre_arm` | cycle cues, `setFailHold`, `attempt0` |

Debug hooks: `end()`, `checkpoint(id)`, `fire('override' | 'lights_out' | 'armed' | 'equalise' | 'release' | 'tube_fight')`,
`hurry(fast?)`, `debugState`, `lineLog` (with each line's start time and its cue time, §8.12).

### 8.11 Lights-out readability kit

After `lights_out4`: floor strips both sides of every corridor and lab aisle (emissive 1.2, 0x6fa8ff, 4 cm), door status
panels lit, `<room>_emerg` points, screens on. Proven by `check:dark` on LOW and MEDIUM.

### 8.12 Speech timing and level (standing requirement)

Every timed spoken line starts **within 0.12 s** of the beat or gesture it belongs to (arm cues, panel changes, scene
cues, the video log's own screen pose, the line-after-line gaps of §4/§6.2); ST logs `{ id, start, cue }` in `lineLog`
and `play:l4` fails on any |start − cue| > 0.12 s. Scene speech reaches the listener at conversation level: ST passes
`check-voice-level --level 4` (the coordinator's script for 3a) with these listener points: the video log from the PI
desk (2 m) and the office door (6 m); the announcer from both ends of the gallery; unit panel lines from 3 m; CHOIR PA
anywhere.

---

## 9. R1–R8 audit and order-independence audit

| scene / gate | R1 barrier | R2 shootable or different | R3 no assumed order | R4 not before its time | R5 | R6 | R8 |
|---|---|---|---|---|---|---|---|
| decon | `d4_inner` cycling 8 s, sealed prop | — | U | — | 8.6 s, own clock, real doors | A | — |
| gowning | shower only way | Dahl: flesh decals | CHOIR enter C | — | — | B | — |
| air shower | interlock latch, one-way | — | U | — | ≤ 8 s | S | — |
| clean loop | `d4_surg` hold (two panels + line, hard-wired); `d4_bay` lintel | dormant units real; bodies take decals; node2/arm behind glass | bodies/node2/glass lines need sight / a hit | dormant from load, harmless | — | C | suite readables not usable through doors |
| override + ambush | — | real units | hold line after the ack line | bay sealed; vents drop grilles | — | D | — |
| theatre | glazing full height | arm + corpse behind bullet-proof glass | announcer on cues in the gallery; `_0` on entry | — | — | ALWAYS | — |
| navy level | `d4_tube_n` cycling: release refused (Δp) on two panels + line | sentries dormant then real; Eng a body | armoury/roster lines need the act / the sight | sentries dormant; store sealed | — | D | booth console only from inside |
| plant room | valve is a plain mechanical control; no gate locks the room | real units | pumps line only while equalising; unit lines are reactions | sump sealed by its grille until +6 s | not helplessness (free to move; fixed clock runs anyway) | D, D2 | valve usable only in the room |
| tube | `d4_tube_s` cycling until F6 | real units | tube line before F6 | gate lock sealed until F6 | — | E, F | — |
| end | latch | — | end line needs 0 hostiles inside | — | — | G | — |

| # | what if the player… | answer |
|---|---|---|
| 1 | runs straight to the surgical door | amber panel, `surg_hold` screen with arrow, `l4_unit_hold`, objective → cold store |
| 2 | acknowledges without seeing the surgical door | allowed; lines true ("that alarm"); screen then `HOLD CLEARED` |
| 3 | goes east instead of west | symmetric loop; nothing keyed on direction |
| 4 | shoots the wet-lab worker through the window | glass holds; the shot wakes it; it comes out either door |
| 5 | kills both dormant units early | harmless; no line refers to them |
| 6 | reads the consent forms with the slumped husk behind | wakes 0.8 s after the note closes, never during |
| 7 | plays the video log, walks off, clears the hold mid-log | the log pauses at a line end for the scene lines and resumes on the next press |
| 8 | clears the hold deep in the cold store | the ambush comes there (door open, plain portal); medkit inside; `cp4_cold` keeps exploration |
| 9 | never visits optional rooms | their groups never spawn; the records husk wakes at lights-out if alive and comes out |
| 10 | runs past the ambush | units follow; checkpoints wait for calm; stranded removal |
| 11 | shoots the theatre glass / the arm | stars, holds; CHOIR glass line once |
| 12 | shoots a body | blood decal + `body_hit`; no line |
| 13 | takes guard/plant plates first | plates work; they do not start F5 |
| 14 | presses the booth release first | refused (Δp), objective to the plant room; no F5 |
| 15 | opens the valve before ever seeing the booth | F5 starts; after 25 s the booth just releases; refusal lines never play |
| 16 | leaves the plant room during equalising | the clock completes; units follow; the gauge shows the state on return |
| 17 | never takes the carbine or vests | F5 via valve or 60 s; armoury line never plays; carry without carbine |
| 18 | shoots the navy sentry dock early | it wakes; counts as `l4_armed` |
| 19 | goes back to the shower door | locked, panel + `l4_unit_clean` |
| 20 | stands in the shower or gate-lock doorway during a latch | latch fails, reopens, re-arms |
| 21 | walks into the bay / sterile store while open | dead ends; doors stay open until the player is out |
| 22 | sprints to the tube end before F6 | `d4_tube_s` cycling + line; F6 starts when the rule holds |
| 23 | finishes F5 inside the tube (release-first is impossible now, but a late straggler) | F6 waits until stragglers are dead or ≥ 25 m and unseen 20 s; `cp4_armed` may be taken north of z −80 |
| 24 | enters the gate lock with units behind | the end waits only for hostiles inside |
| 25 | dies during the ambush | `cp4_cold` (or `cp4_clean`): hold not cleared, lights on, reads kept |
| 26 | dies in the holdout | reloads `cp4_navy` (taken at the first calm entry to chk, before any F5 trigger can have fired with units awake): valve shut, nothing equalised; F5 replays from its trigger |

---

## 10. Test plan

### 10.1 `scripts/playthrough-l4.mjs` (`npm run play:l4 -- <url>`, static build; T)

- **default** (`--choice=stop,command`): every beat in order; doors per phase; decon 8.0 ± 0.2 s; shower ≤ 8 s; hold timings
  anchored to line ends; refusal → valve → equalising 25.0 ± 0.2 s → release; arm cycle 40 ± 0.5 s; every timed line within
  0.12 s of its cue (§8.12); `cp4_*` at the right moments; F5/F6 per rule; end card; carry (`from: 4`, armor, carbine,
  `testHour`, flags); stored level stays 4.
- **--checkpoints**: per `cp4_*`: play to it, die, load, compare `worldState()` (doors, phase, lights-out, screens, groups,
  pickups, armour, weapons, flags, facts), finish.
- **--impatient**: sprints; wrong order (surgical door first, booth before the plant, valve before the booth, back to the
  shower); shoots every `mk4_glass` pane, every body, the dormant units; oracle per conditional line; choice-variant check.
- **--order**: (a) east-first, cold store first, no labs; (b) no optional rooms; (c) never carbine/vests; (d) valve before
  the booth; (e) booth refusal, then the guard room notes, then the valve.
- **--softlock**: (a) stay in lock4 120 s after the decon; (b) shower doorway during the latch; (c) cold store during the
  ambush; (d) hide in the guard room during the holdout; (e) leave the plant room during equalising and wait in chk;
  (f) gate-lock doorway during the latch; (g) enter the gate lock with two units alive behind; (h) step into the bay /
  store while open. Each reaches `l4_end`.
- **all modes**: spawn visibility (ray to each member's chest at every spawn/wake; fail if visible unless emerging through
  a door/grille/sump that opened in the last 3 s); every `mk4_` marker exists; never `state === 'cutscene'`; no enemy before
  its beat except the four dormant ones; static pass: every `l4_` id ↔ one RULES entry ↔ manifest; choice pairs complete;
  no uppercase in any `unit` line's `spoken`.

### 10.2 `check:reach`
`levelsOf('all')` → [1, 2, 3, 4]. Phases A … G incl. D2, `use` / `must not be usable`, region-floor assertion, stress pass,
ALWAYS4; level 3 re-run without `d3_bio_inner`.

### 10.3 `check:nav` level-4 cases
reach: bay → cold store back (17, 4.8, −19) → (−1, 4.8, −29) ≤ 30 s; bay → scrub → (0, 4.8, −40) ≤ 25 s; **store → plant**
(6, 4.8, −41) → (50, 0, −59) ≤ 50 s via stair, chk, guard; **sump skitter → valve** (52, 0, −62) → (55, 0, −59) ≤ 5 s;
gatel → tube mid (32, 0, −110) → (32, 0, −80) ≤ 15 s; wet worker → corr_n (−6, 4.8, −22.6) → (0, 4.8, −10.5) ≤ 20 s;
records husk → corr_e (6.5, 4.8, −33.4) → (13.5, 4.8, −20) ≤ 15 s; viv skitter (landed) → corr_w (−22.9, 4.8, −22) →
(−13.5, 4.8, −30) ≤ 12 s. Stand-off: player latched in `gatel`, husk in the tube. Ramp: `stair4` drift < 5 cm in 10 s.
Sentries: `g4_lower` dock → stair foot; `g4_chk_sentry` dock → plant room. `ignoreFloors: ['theatre:main', 'node2:main']`.

### 10.4 New and extended checks
- **`check:weapons`** (W1, §8.2/§8.3).
- **`check:fxleak`** (W7, §8.6.6) — levels 3 and 4.
- **`check:dark`** (T): `?level=4&nostory=1&noenemies=1&autostart=1&quality=low|medium`, `level.vignette('lights_out4')`,
  flashlight on; views corr_w `spawn=-13.5,4.8,-20,0`, corr_s `spawn=-10,4.8,-35.5,-90`, vivarium door `spawn=-16,4.8,-22,90`,
  cold door `spawn=-11,4.8,-29,-90`, records door `spawn=11,4.8,-29,90`, scrub `spawn=0,4.8,-38,0`; centre 30 % × 30 % mean
  luminance (sRGB) ≥ 0.16; whole frame ≥ 0.04; ≥ 3 % of the outer 20 % ring ≥ 0.06; PNGs to `shots/l4/dark/`.
- **`check-voice-level --level 4`** (coordinator's script; ST must pass; listener points §8.12).
- `check:doors` (every `d4_*` incl. `d4_plant`; the shower doors with x −2 … 2), `check:decals` (leaves, the jam `nudge`,
  grilles and sump panel as transient owners, gate dogs mover), `check:zfight`, `check:wreck` (a dead husk on the stair
  flight, on Holm's body, on the pump plinths), `check:chain` (§8.1).

### 10.5 Frame sequences (10 fps) — look at
Decon mist; shower jets; the worker through the window; the cold-store jam twitch; lights-out wave from corr_w and corr_s;
bay door and the first husk; a vent grille drop; **a sprint `d4_gal` → `d4_gal_e` along the glass: the status ring,
`theatre_cam` and the table read** (B3); one full arm cycle at 1.0 m and 3.0 m (ring red → blinks → off; the regel dip;
nape, no face); stair paint line and Eng's trail; navy sentry undock; a 30-round carbine dump; the vest strap; the valve
pull, gauge, beacon and the sump grille; the tube fight from the ring; gate panel + dogs; end card.

### 10.6 Performance views (`shot.mjs --perf`, LOW, MEDIUM, HIGH)
(1) shower exit `?level=4&spawn=0,4.8,-10.5,0`; (2) gallery path `spawn=0,4.8,-46,0,-25`; (3) chk from its door
`spawn=25,0,-61,-120`, `d4_tube_n` open; (4) tube ring looking south `spawn=32,0,-86,0`; (5) corr_s after `lights_out4`
with 3 husks `spawn=-8,4.8,-35.5,-90`; (6) **plant room holdout** from the valve looking at the door `spawn=55,0,-59,90`
with the beacon on, 2 husks + sentry spawned. Budgets §2.7; sea cost by toggling the two volumes.

---

## 11. Build order — task graph for parallel worktree agents

Rules: one owner per file at a time (a file passes from K to a wave-1 task, or from W4 to a D-task, only sequentially);
every task ends with `npm run typecheck`, `npm run build`, its own test and the level 1–3 checks it could affect. Models:
**Opus** (spawned explicitly) for design-heavy work, **Sonnet** only for small, tightly specified tasks.

```
             ┌─ W1 player ─┬─ W2a ui ─┬─ W2b audio ─┐
 K ──────────┼─ W4 greybox + phases + l3 fix ───────┼──┬─ D1a entry + north ────┐
 contract,   ├─ W5 enemies ─┬─ W6 materials ────────┤  ├─ D1b west/south/east ──┤
 chain,      ├─ W7 fx + fxleak ─────────────────────┤  ├─ D2 surgical + theatre ┤
 stubs       ├─ W9a set pieces ─┬─ W9b kits ────────┘  ├─ D3a navy + plant ─────┼─ I1 integration
             │                                         ├─ D3b tube + gate ──────┤
             │                                         ├─ ST story ─────────────┤
             │                                         └─ T tests ──────────────┘
             └─ W8 voices (user-paced, after §6 sign-off) ──────────────────────┘
```

| id | task | model | files owned | inputs | done when |
|---|---|---|---|---|---|
| **K** | contract + chain + stubs (§8.1–8.4, 8.7 contract parts, D18) | Opus | `src/core/types.ts`, `src/core/progress.ts`, `src/core/debug.ts`, `src/story/save.ts`, `src/story/chain.ts`, `src/story/index.ts`, `src/story/camera.ts`, `src/story/l3/index.ts`, `src/story/l3/text.ts`, `src/story/l3/script.ts` (`clockHour()` only), `src/level/index.ts`, stubs `src/level/l4/index.ts` + `src/story/l4/index.ts`; placeholder/stub lines in `src/player/index.ts`, `src/player/weapons.ts`, `src/ui/hud.ts`, `src/materials/screens.ts`, `src/materials/defs/index.ts`, `src/audio/voicefx.ts` (`FX_NAMES` entry); `scripts/lib/check-common.mjs`, `scripts/check-chain.mjs`, `scripts/check-doors.mjs` (stand at door floor), `scripts/playthrough-l3.mjs`, `scripts/levelgrep-allow.txt`, `package.json`, `docs/CHECKLIST.md` | this plan | typecheck + build; `check:chain` green (incl. `?next=3:4`); `?level=4` boots the stub; 3a's end on main unchanged; L1–3 playthrough defaults green |
| **W1** | player: armour + carbine + `check-weapons` | Opus | `src/player/**`, `scripts/check-weapons.mjs` | K | `check:weapons` green; L1–3 weapons unchanged |
| **W2a** | UI: armour bar, carbine HUD/`AUTO`, labels, toasts | Sonnet | `src/ui/**` | K | ui dev harness: armour 0/37/100, carbine HUD |
| **W2b** | audio: every new sound id (§8.2, §8.3, §8.5; `decon_hiss`, `shower_jets`, `hold_beep`, `cold_jam_beep`, `lights_thunk`, `bay_door`, `vent_grille`, `arm_servo_loop`, `clasp_click`, `gel_dip`, `pump_loop`, `valve_pull`, `sump_lift`, `alarm_beacon`, `gate_dogs`, `tube_groan`, `body_hit`), ambiences `amb_clean`, `amb_cold`, `amb_navy`, `amb_plant`, `amb_tube`, room presets for level-4 ids, `screen` = `recorder` alias + position profile | Opus | `src/audio/**` | K | audio dev page plays every id; `FX_NAMES` has `screen` |
| **W4** | level-4 greybox, phases, dressing stubs, `cyclingPrompt`, `nudge`, `enemy(skin)`, `sealedDoor`, level-3 fix, nav targets (§8.8) | Opus | `src/level/l4/{index,grey,phases}.ts`, stubs `src/level/l4/{entry,clean,surgical,navy,tube}.ts` (handed to D-tasks), `src/level/doors.ts`, `src/level/context.ts`, `src/level/kit.ts`, `src/level/l3/index.ts`, `src/level/l3/phases.ts`, `scripts/check-nav.mjs` | K | §8.8 acceptance |
| **W5** | enemies: skins, `bench` | Opus | `src/enemies/**` | K | harness; L1–2 nav hashes unchanged |
| **W6** | materials: clinical set, 4 screen kinds, `clinical` signs | Opus | `src/materials/**` | K | dev gallery + screen states |
| **W7** | fx: fog, breath, bounded emitters, viewport `rooms` + caps + fallback, registry + probe hide + magenta, `check-fxleak` | Opus | `src/fx/**`, `src/render/index.ts` (prepare hides `fx.volumes()`), `src/level/l3/atrium.ts` (registration lines only), `scripts/check-fxleak.mjs` | K | `check:fxleak --level 3` green; dev scene of each new fx; tube-sized viewport cost measured |
| **W9a** | set pieces: arm + cycle API + ring, table/corpse/gel bath/bin, Clasp + halo + LED states, bodies | Opus | `src/level/l4/setpieces.ts`, `src/level/dev/setpieces4.ts`, `src/level/dev/setpieces4.html` | K | dev page: every state; 40 s cycle with cues; calls as stated |
| **W9b** | kits: clean-room, navy (incl. plant props), tube | Opus | `src/level/l4/kit4.ts`, `src/level/dev/kit4.ts`, `src/level/dev/kit4.html` | K | dev page: every prop; ≤ 2 calls each |
| **W8** | voices: `sunde` cast + audition (user), `lines.l4.json`, generation, `cut` | Sonnet | `voice/cast.json`, `voice/lines.l4.json`, `voice/manifest.json`, `public/voice/l4_*` | §6.2 signed off; W2b for listening | `voice:check` green |
| **D1a** | dressing + lights: lock4, gown, shower, corr_n, wetlab, pi_office, node2; vignettes `decon_cycle`, `shower_cycle`; their emergency lights + strips | Opus | `src/level/l4/entry.ts` | W4, W6, W7, W9a, W9b | zfight/doors/decals on its rooms; perf view (1); fxleak for decon/shower |
| **D1b** | dressing + lights: vivarium, cold (fog, breath zone, jam via `nudge`), records, bay, corr_w/s/e; vignettes `viv_vent`, `vent_s_a/b`, `lights_out4` (by group names of §2.7, all rooms); emergency lights + strips | Opus | `src/level/l4/clean.ts` | W4, W6, W7, W9a, W9b | perf view (5); `check:dark` views; fxleak for the fog |
| **D2** | dressing + lights: scrub, store4, gallery (bench tier, camera desk, path), theatre (arm, corpse, gel bath, bin, gurneys, screen, wisp), stair4 (Eng's trail); scrub sinks and gallery bench built here from simple boxes (no W9b dependency) | Opus | `src/level/l4/surgical.ts` | W4, W6, W7, **W9a** | view (2) on all qualities; arm frames; zfight/doors |
| **D3a** | dressing + lights: lcorr, chk (booth, cage, roster, boom), guard, **plant4** (pumps, gauge, valve, sump, beacon); vignettes `valve_open`, `plant_sump` | Opus | `src/level/l4/navy.ts` | W4, W6, W9a, W9b | views (3), (6); zfight/doors/decals |
| **D3b** | dressing + lights: tube (ribs, ring, both viewports), gatel, gate prop + `gate_dogs` | Opus | `src/level/l4/tube.ts` | W4, W6, W7, W9b | view (4) in budget (or the fallback taken); fxleak for the sea |
| **ST** | story level 4 (§8.10, §8.12) | Opus | `src/story/l4/*` (replaces K's stub) | K, W4 (markers), W1 (events) | `play:l4` default green on the greybox, both choices; `check-voice-level --level 4` once W8 lands |
| **T** | tests: `playthrough-l4.mjs` (§10.1), `check-dark.mjs` (§10.4) | Opus | `scripts/playthrough-l4.mjs`, `scripts/check-dark.mjs` | the plan; ST's hooks to finish | all modes run (failures listed) |
| **I1** | integration: `LEVELS[3].next = 4`; dressing on the story build; all checks (`npm run check`, `check:weapons`, `check:fxleak`, `check:dark`, `check-voice-level`, `play:l4` all modes, `play:l3 --choice=stop` through the hand-over); perf views; frame sequences; DESIGN.md REVISION 9 (incl. 19/4 canon, D7, D27, D16 debt) | Opus (coordinator) | everything for fixes | all | CHECKLIST green; user hand-play |

Ownership check (disjoint): K's placeholder lines in `player/*`, `ui/hud.ts`, `materials/*`, `audio/voicefx.ts` pass to W1,
W2a, W6, W2b after K merges; W4's five dressing stubs pass to D1a/D1b/D2/D3a/D3b after W4 merges; `src/level/l3/index.ts` +
`phases.ts` (W4) vs `atrium.ts` (W7) vs `story/l3/*` (K) are distinct files; `render/index.ts` only W7; `level/doors.ts`,
`context.ts`, `kit.ts` only W4; `check-nav` W4, `check-fxleak` W7, `check-weapons` W1, `check-chain`/`check-doors`/
`playthrough-l3` K, `playthrough-l4`/`check-dark` T. Wave 1 = 9 parallel tasks (+ W8); wave 2 = 7 parallel tasks.

Reviews / full runs worth it (speed): this plan (done); after W4 automated checks only; after W1 one look at the carbine
frames; **after ST on the greybox: full `play:l4` default + `--checkpoints`**; **after D-tasks: perf views, `check:fxleak`,
`check:dark`, `check:zfight`**; I1 everything + the user's hand-play. No review for W2a, W2b, W5, W6, W8, W9a, W9b.

---

## 12. Review focus — still open

1. Fumigation (D7) and the hard-wired interlock (D27) are new canon: record both in REVISION 9 at I1.
2. The plant beat's backtrack (plant → booth, ≈ 30 m) after the holdout: acceptable, or should equalising release the tube
   door directly? Kept the booth press so the booth (roster) stays required; revisit after the hand-play.
3. Tube sea cost (two 34 m viewports) — fallback ready.
4. `theatre_cam` is a canvas drawing, not a feed (coordinator decision 4); if it reads as a cartoon in the frame sequence,
   switch to 3a's feed system (≈ 1–1.5 ms on HIGH) at I1.

---

## 13. Changes after review

| item | change (or why not) |
|---|---|
| **B1** shower doors fail rule (b) | Shower widened to x −2 … 2 (interior ±1.8 ≥ the open leaves' ±1.62) — §2.1, §2.2 (new "leaf faces" column recomputed for every door), `t4_shower` x −1.8 … 1.8, `fx4_shower` box, Dahl at (1.5, 4.8, −7.6) (passage 3.1 m). Conventions now state the faces rule explicitly. |
| **B2** roster says too much / contradicts 3c | `term4_ctrl`: `FITTED: 23. LINK: 19 ACTIVE · 4 NO SIGNAL.` / `ASSIGNED CONTROLLER: NONE → NODE 2 — BIO-SYS (MON 08:40).` / Kessler `NOT FITTED`; roster screen 19 red + 4 grey, `NODE 2` without CHOIR; `node2_screen` header `NODE 2 — BIO-SYS`; `l4_choir_roster_*` reworded (no number, no ownership); D10, §1 item 9, threads table reworded; 19/4 recorded as canon for 3c (D10, I1 → REVISION 9). |
| **B3** theatre unreadable | D6: 7 cm status ring on the tool head + 3 cm halo on the handled Clasp (W9a), `theatre_cam` canvas close-up (new ScreenKind, K/W6), `l4_unit_theatre_0` on entry, gallery bench tier + camera desk force the path along z ≈ −46 (0.8 m from the glass, inside the computed 2.36 m band; desk off the door → table ray), sprint frame-sequence item. |
| **B4.1** `playthrough-l3.mjs` unowned | K owns it; asserts the 3a end card per `nextOf(3)`. |
| **B4.2** 3a's fx registration unowned | W7 owns the registration lines in `src/level/l3/atrium.ts`. |
| **B4.3** `trimAfter` does not exist | Full sentence generated; W8 writes `cut` from the ASR word timings into `lines.l4.json`; ST stops the handle at `cut` and cuts the screen to static (scene-owned). |
| **B4.4** no screen kind for `hold`; stage API | `hold` dropped; holds use `cycling` + `DoorSpec.cyclingPrompt` (W4) with the reason on the adjacent screen; stage API unchanged. |
| **B4.5** hand-over lands in the stub | Coordinator 6: `LEVELS[3].next` stays `null` on main until I1; K implements the next-aware 3a end and `nextOf()` with a test override `?next=3:4` (`DebugFlags.next`); `check-chain` tests the hand-over through it; I1 flips the value. |
| **S1** vent spawns inside the voids | Spawns moved under solid ceiling 0.1 m below it, beside each opening (viv y 8.1; corr_s y 7.7), so `beginEmerge`'s 0.9 m up-ray hits the ceiling at 0.05 m; timing written as grille + 0.4 s `spawnGroup` (0.45 s stagger). Verified against `skitter.ts:206-221`. |
| **S2** Holm in the opening; jam fights the door | Holm 0.5 m inside (x −11.6 … −9.8), hand at x −11.78, y ≤ 4.85: outside the opening volume (x −12.2 … −11.8) and 0.15 m from the closed-leaf plane (x −11.93, > 2.5 cm rule c); twitch via `DoorImpl.nudge` (W4). |
| **S3** hold reason; false line | D27 hard-wired local interlock (accepted as canon by the coordinator); panels add `HARD-WIRED — LOCAL ACKNOWLEDGE ONLY`; `l4_unit_hold` says "Hard-wired"; `l4_choir_hold_command` → "A supervisor clears his own alarms. That one was keeping you safe." |
| **S4** theatre loop contradictions | `l4_unit_theatre_3` → "Retrying. Same host."; same Clasp re-gelled (cue `regel` replaces `discard`, gel bath added); bin static ~30; screen `ATTEMPT 5,593 + n` from `CLOCK4` and `QUEUE: AUTO — ORDER 0031-H (YIELD)`. |
| **S5** LED vocabulary | D9 redefined: amber = powered, not linked; red blink = linked; off = unpowered/failed; all five places agree (vivarium tray off). |
| **S6** cover story, Eng, bodies line | `fumig_status` adds `HABITAT NOTICE: BIO-SYS CLOSED — CONTAINMENT DRILL — STAFF REMAIN INSIDE`; Eng clues (suit half off, respirator on the stair landing, smear trail down the stair); `l4_choir_bodies_stop` → "We cleaned this side on Monday, Technician. They were still in it."; trigger excludes Dahl and the first 5 s of C. Not changed: the reviewer read "09.03" as a time; it is a date (guard withdrawn 9 March, 3a's `sign3_bio`), so Eng simply found the checkpoint already unmanned. |
| **S7** checkpoint gap | Added `cp4_cold` (first `t4_cold`, 0 awake) and `cp4_navy` (first `t4_chk`, 0 awake); `cp4_clean` "once"; `cp4_armed` may also be taken in the tube north of z −80 before F6. |
| **S8** F6 sandwich | F6 rule: past `t4_tube_1` and (F5 + plant dead or every living one ≥ 25 m and unseen 20 s); the 45 s clock is dropped — stuck members go by the stranded rule (time-based), so nothing waits only on an enemy. The release-first path no longer exists (the booth refuses until equalised). |
| **S9** carbine numbers | Skitter HP 18 used; carbine damage 18 (husk 5 body / 3 head, skitter 1, sentry 4); TTK table and test updated; ammo stated as deliberately lavish because it carries into 3c (one cage box dropped, plant box added); armour test precondition health 100 written; vest strap rules (weapon lowered, cancelled by damage/sprint/jump/note, vest stays). |
| **S10** voice delivery | Coordinator 7 + reviewer table: unit lines without uppercase (decon, hold, theatre_2 fixed; static test added); CHOIR stress to phrase end (`a LIVING HOST`); Sunde split into nine short lines with written hesitation and varied scene-owned gaps; halting refText; `screen` = `recorder` alias + position profile; `l4_unit_gate` → "Post 4. Pressure gate. Equalising." (the panel says AUTHORISED). |
| **S11** optional members | D18 reversed: required members with K stubs; the five implemented 3a optionals (+ `safe`) made required in K. |
| **S12** task sizes | W2 → W2a UI (Sonnet) + W2b audio (Opus); W9 → W9a set pieces + W9b kits (D2 depends only on W9a, builds its two simple props itself); D1 → D1a entry/north + D1b west/south/east (separate files); D3 → D3a navy + plant and D3b tube + gate (the plant beat is one task's dressing, coordinator 2). |
| **S13** fxleak semantics / tube rooms | `rooms` = drawn only while one of them is drawn; sea volumes list `tube` only; the check fails on magenta in a view whose drawn room set contains none of the volume's rooms. |
| **S14** Node 2 screen angle | Moved to node2's west wall (4.22, 6.4, −22.0) facing +x, square to the window. |
| note: sentry dock not over the booth | Moved to (28.0, 3.6, −56.8). |
| note: D20 clock | `testHour` carried from 3a (K adds `clockHour()`); `CLOCK4` derives every panel. |
| note: Sunde vs roster | Roster line names only the assignment (`NONE → NODE 2`, Mon 08:40); Sunday's "something answers anyway" reads as probing before it took the links. |
| note: wet-lab islands, garbled fx sentence, pre-K checkpoint case | No shelving above 1.2 m; §8.6.2 rewritten; `check-chain` case added. |
| **Coordinator 2 — length** | D28 + `plant4`: refusal at the booth → guard room (now main route) → valve → 25 s fixed-clock holdout (F5 + `g4_plant` sump skitters) → booth release; phase D2, encounters, pickups (plates/ammo staged for it), `cp4_navy`/`cp4_armed`, audit rows, order cases 14–16 & 26, nav cases, softlock (d)(e), perf view (6). Geometry: room x 46 … 56, z −64 … −54 touches only guard (x 46); `d4_plant` (46, 0, −59) leaf faces −60.62 … −57.38 inside guard −61.8 … −56.2 and plant −63.8 … −54.2; pocket −60.675 … −57.325 on x 46 ✓; 4.8 m clear of the east sea void. Main route ≈ 13 min. |
| **Coordinator 3 — Sunde** | Kept open (D16). **Debt for 3c/3d:** her absence must be paid off — e.g. her badge or coat at Post 4 or the head-end, or her voice/log there — and REVISION 9 records it. |
| **Coordinator 8 — timing and level** | §8.12 standing requirement (≤ 0.12 s line-to-cue, `lineLog`, `play:l4` assertion) and `check-voice-level --level 4` with listener points; ST done-criteria. |

Re-verified with the reviewer's arithmetic: every door's leaf faces (§2.2 column); shower passage 3.1 m; Holm's hand vs
the opening volume and rule (c) distance; vent spawn heights vs ceilings (8.2 / 7.8) and the 0.9 m up-ray; `d4_plant` and
`plant4` against chk, guard and the sea void; table-visibility band 2.36 m vs the 0.8 m path; camera desk off the door →
table ray (ray at x 0; desk x 3 … 5). Not resolved: the plant-beat backtrack question (§12.2) is a feel call for the
hand-play.
