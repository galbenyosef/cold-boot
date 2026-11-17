# Stage 3c "POST 4" — detailed plan (technical level id 5)

Status: **PLAN, amended after review** (`docs/reviews/stage-3c-review.md`, verdict "build after fixes") with the
coordinator's decisions. This file is the single authoritative document for building 3c; §13 lists every review item and
what changed (§13 wins where any older sentence still disagrees). Merged on main since the draft and treated as facts:
the flashlight battery (`TORCH`), carbine aim (`WEAPON_STATS.carbine.ads`, `AIM_BINDINGS`) and the enemy dark-room marks
(`RigBuilder.mark`) — commits 071d1e6, df63fd1. Sources: DESIGN.md R1–R8 (REVISION 5 + 5.1), REVISION 6/6.1
(canon: 61 h, Eridu Deep, the living rostered palm, lockouts), REVISION 7 + **7.1** (7.1 wins: taken soldiers are plain
enemies that cannot be saved, no friendly units, Commander Kessler, fixed keypad code, first-person cutscene rules),
`docs/plans/stage-3b.md` (format, conventions, as-built ids), `docs/reviews/stage-3b-review.md`, the 3b notes and the 3b
integration list, and the code on main at 5af877f. To be copied into DESIGN.md as REVISION 10 at integration (IA).

Conventions exactly as 3b: metres, y up, −Z forward, yaw 0 looks down −z (`?spawn` yaw in degrees, +90 = −x). Room boxes
are **boundaries**; walls are 0.4 m centred on them (interior = box inset 0.2). Std door 1.6 × 2.4; an **open std leaf
spans 0.82 … 1.62 m from the door centre**, its slot ends 1.675 m from it, and `check:doors` rule (b) needs a wall face
within 0.45 m on both sides of every leaf sample — so **both rooms' interiors must cover the door centre ± 1.62 m along the
door's wall** ("leaf faces" column). `wide` = a vertical pressure leaf (no side pockets). One main deck, floor y 0; the
sub bay has a gallery deck at y 4.8 (its `floors`); the crawlway is a floor of the spine at y −1.4 and the magazine a floor
of the armoury at y −2.6. Player capsule r 0.35, h 1.8 standing / **1.1 crouched** (eye 1.65 / 0.98, crouch speed 1.8 m/s,
toggle **C**, `canStand` needs ≈ 1.85 m of head room, no jump while crouched — `player/controller.ts:10-27, 95-104`);
crouch-jump clears 1.7 m, so containment = collider ≥ 1.75 m above the standable surface.

---

## 0. Decisions

| # | Decision | Why (one line) |
|---|---|---|
| D1 | Separate world `src/level/l5/`, `src/story/l5/`, lines `voice/lines.l5.json`; ids `l5_` (lines, beats), `d5_` doors, `t5_` triggers, `g5_` groups, `cp5_` checkpoints, `p5_` pickups, `mk5_` markers, `cv5_` cover points, `v5_` scare vignettes. | Same pattern as levels 2–4. |
| D2 | **Hand-over:** 3b's `gate4` stays a sealed prop; 3c starts inside its own copy of the gate lock (`lock5`) with the gate (`d5_gate`, a real `wide` door) rising. **`LEVELS[4].next` stays `null` on main until IA**; K builds the 4 → 5 path behind the existing test override (`?next=4:5`). With `next` set, 3b's end card loses "TO BE CONTINUED" (6 s, skippable) and hands over, as 3a → 3b. | Main stays playable through the build (3b D4 lesson). |
| D3 | 3c ends in the cable tunnel with `POST 4` / `TO BE CONTINUED` + menu; `LEVELS[5].next = null`; stored level 5. | 3d is not planned here. |
| D4 | 13 rooms, none overlapping in plan; the crawlway and the magazine are **floors** of the spine and the armoury (`roomAt` is x/z first-match). The command module is a void (never entered). | `assemble.ts` bitmask; D3 of 3b. |
| D5 | **The taken soldier is a new enemy type `soldier`** (src/enemies/soldier/): human rig, ranged, cover from level data, telegraphed and fair fire, suppression, slow deliberate movement, CHOIR's voice through `throat` fx. Not saveable, no weak spot, no counts beyond `kills5` (7.1). | User brief 2; 7.1. |
| D6 | **The cutscene soldier is an actor** (`enemies.actor('soldier', …)`) that exists only while the camera is taken; at hand-back he is behind a closed door and is replaced, out of sight, by the real enemy `g5_s1` at the ready room's far end. **A holding soldier** (`hold`) reports `state 'idle'`, not hunting, awake; the story releases him with the new required `EnemyManager.release(group)`; `g5_s1` / `g5_patrol` are spawned with `spawnGroup` (not `engage`) and enter `prog.triggered` only when released; `afterReplay` re-spawns `g5_s1` in hold whenever `radio` is false (review B1). | R2/R4 (7.1); checkpoints never lose the radio. |
| D7 | The cutscene is first-person (`rig.cutscene`, 3a pattern): the camera is taken at the duty-room door, the door opens on him; lines decoded before the camera is taken (`linesReady`); every gesture on a recorded line end + gap; ≤ 25 s; gate already latched; checkpoint `cp5_duty` at hand-back; the two units enter **9.3 m** away **2.5 s** after control returns. | 7.1; R5. |
| D8 | **Radio:** only on the first soldier's body (`radio5` at `mk5_radio` = the corpse chest's x/z at `max(chest.y, wreckBox.max.y + 0.08)`, from `EnemyManager.corpsePoint(id, 'chest')`; its R8 ray ignores the owner's own wreck box — review B2). Kessler powers the keypad; the keypad is the only way on; no timer opens it. Squawks from the body 30 s after his death until taken. Carried fact `radio`. **Q** = "ask Kessler" (repeat code / current task). | REVISION 7 rules table; R1. |
| D9 | **Keypad code 4719**, fixed, said in one recorded line (`l5_kes_4`); the panel is `NO AUTHORITY` (dark, UI will not open) until her power cue **at `l5_kes_4`'s end**; Q works from the same cue (S2). | 7.1. |
| D10 | **Why the four:** the four `NO SIGNAL` sailors (Risa, Ødegård, Hagen, Knutsen — 3b's roster) had the **module watch** Monday 08:00–12:00; the module is shielded; Kessler and Dr. Sunde joined them at 08:38; the links went at 08:40. If the door opens, they are his. | Pays 3b's 19/4 canon with a readable reason (duty roster card). |
| D11 | **Sunde's debt paid**: she is alive in the command module; the visitor log shows her `IN 08:12 — URGENT, TO CO — OUT: —`; Kessler says it in one line at her door. | 3b D16 debt. |
| D12 | **The command module door** never opens (sealed prop). It has a 0.25 m armoured **viewing port** (Kessler's silhouette, never a face) and a door camera. The scripted beat there is **interactive**: the camera says he is clean, but the cameras are CHOIR's, so she checks his neck with her own eyes — the player stands on the yellow line with his **horizontal yaw within ±50° of −x** (back to the door; pitch ignored) for 1.2 s, with live feedback (tally amber → white, the silhouette moves); only then does she release the tunnel. Real gate, no timer, repeats calmly (review B3). | User brief (second short beat may be interactive); gives the door a job; R1. |
| D13 | **Sub bay: the submersible (SDV *TERN*) sits in a cradle on rails that run into a horizontal launch lock** (5 m round door in the south wall), **not** a moon pool. Dry dock, 12 m high, gallery deck + bridge over the boat. | 3d owns the moon pool; a dry hall reads different; the empty cradle in 3d is then unmistakable. |
| D14 | **Set-up for 3d's ending:** the launch console on the bridge reads `LAUNCH AUTHORITY: OFFICER PALM — CO / XO` and `PRE-LAUNCH CHECK — COMPLETE (REQUESTED: CHOIR)`; the boat runs its pre-launch check in front of the player (scare `v5_sub_check`); Kessler: "It launches on an officer's palm. Mine, or my XO's." | 7.1: the sub launches on a navy palm; the open ending uses the empty cradle. |
| D15 | **Lieutenant Aas** (the palm that opened the gate) is the XO; never seen and **never explained in 3c** (coordinator 1: 3c must not spell out 3d's ending). The evidence is physical: the booth's palm plate (seen through the glass) reads `AAS, L. (LT.) — PALM — LIVE — {arrival − 0:40}` and the booth's back door has just swung shut (a sound on arrival, no figure) (S6). | Keeps the thread alive without saying it. |
| D16 | **Darkness is designed for the flashlight battery as built** (`player/flashlight.ts` `TORCH`: burn 10 s, recharge 4 s only while off after a 0.25 s settle, cannot switch on below 15 %, the last 2 s sag and stutter, 0.5 s death flicker; no drain in cutscenes, safe state, pause, death; saved in checkpoints, restored ≥ 50 % if saved on; a new level starts full; `?torch=inf`, `player.debug.torch(v)`; `player:flashlight` `cause: 'toggle' \| 'empty' \| 'refused' \| 'story'`): no dark stretch on the main route is longer than **8 m** between readable light pools; every dark space keeps doors, stairs, rails and required interactables readable **without** the flashlight; the flashlight is for detail and faces. | User brief 6. |
| D17 | **CHOIR's answer to the neck check is the lights** (`lights_out5`): spine and sub bay mains die; emergency lighting is hard-wired (a lockout — CHOIR cannot touch it, Kessler says so). The sub-bay climax is fought in the dark by beacon, strips, Clasp LEDs, weapon lights and muzzle flashes. | Brief 6; honest reason why emergency light stays. |
| D18 | **Soldiers see less in the dark**: in a `dark` region with the flashlight off, a soldier's sight range is 12 m and he must see the player for 0.8 s; with the flashlight on, 30 m at once; **a player who fires is "lit" for 1.5 s** (full sight, 30 m) for any soldier with an eye ray to him (S3: darkness is not one-sided). | Makes "off to recharge" a choice, not a free win. |
| D19 | **Crawlway**: a spine floor hatch (`hatch5_spine`, opens from above) → 24 m crouch tunnel under the spine's grating (1.35 m clear) → steps down into the **magazine** under the armoury (standing height) → a steep stair up to a magazine hatch in the armoury floor **dogged from below** (one-way; its plate says so and is the hint). Optional reward; never a dead end. | User brief 4; R1. |
| D20 | Crawl floor and magazine are `nav: false` floors; while the player is on one, enemies target that floor's **exits** (the two hatch tops) and stand off **2–5 m from the exit, never inside the walkway box x 36.2 … 38.6, z −15.4 … −14.2**. Bullets, sight and melee do not pass the grating (solid collider; impacts spark; melee needs `seesPlayer` — a rule, do not "fix" the LOS). The hatch pit is a nav obstacle from load. | No enemy in a tunnel it cannot fit; honest grating; the corridor stays free. |
| D21 | **Scares** are vignettes (`level.vignette(id)`, level-owned geometry + sound), fired by the story under one rule set (§5.5): once, only when calm, never in a doorway or on the route's collider set, order-independent, replayed as end state on load via the `id:snap` convention. Ten placed, escalating. | User brief 5; 3b lesson "sounds owned twice". |
| D22 | Every story position is a `mk5_` marker; the cutscene camera too. Missing marker = error, playthrough fails. Every timed line starts ≤ 0.12 s from its cue. | 3a/3b lessons 1–2. |
| D23 | Every fx volume declares `rooms` (and `seenFrom` where seen through an opening); hidden in `render.prepare`; `check:fxleak --level 5`. | 3b D21. |
| D24 | LOW: every view ≤ 6 points / ≤ 2 shadow slots, **the flashlight is one**; soldier weapon lights are non-shadow spots (prio 0.5, on only while aiming — and for the patrol during `v5_boots`); every soldier's dark-room glow is `RigBuilder.mark()` (no light, no extra draw call); muzzle flashes are pooled `fx.flash`; enemy eye lights lose slots first. | 3b D22; brief budgets. |
| D25 | **One owner per sound** (§8.11 table): vignette sounds are the level's, line audio the story's, combat sounds the enemy module's, keypad/radio UI clicks the UI's. | 3b integration item 7. |
| D26 | Story waves that must arrive are `rush`ed (husks); soldiers never rush — they advance cover to cover at 1.6 m/s; arrival times are nav cases with real speeds. | 3b integration item 8. |
| D27 | Carbine aim **as built** (`WEAPON_STATS.carbine.ads`, `AIM_BINDINGS`): **right mouse button (hold) only**, raise 0.20 s / drop 0.15 s, FOV 72° → 50°, aimed spread at 20 m mean 0.8 cm (hip 4.3 cm), climb × 0.6, walk × 0.55 (1.98 m/s), no sprint; reload and switch drop the aim. Encounters are tuned for aimed carbine fire at 15–30 m (§5.3). | User brief 3; coordinator 3. |
| D28 | No optional contract members: K adds every new member required, with working stubs (`Level.cover = []` in levels 1–4, `ui.radio()` / `ui.keypad()` stubs). | 3b D18. |
| D29 | Facts out of 5: everything in, plus `kills5`, `radio: true`, `kessler: true`, `l5_door` (neck check done), `l5_boat` (launch console seen), `testHour`. | 7.1 B3/B4. |
| D30 | Delivery: Kessler controlled and tired, hesitation written into the words, scene-owned varied gaps, breaks off when CHOIR cuts in (`cut` from ASR word times, as 3b's `l4_sunde_9`); soldiers speak CHOIR's take through `throat` — calm, never raised; UNIT flat, **no uppercase**; CHOIR sparse stress; uppercase stress runs to the end of its phrase; `note` never reaches the model. | TTS rules; 3b S10. |

### 0.1 3b lessons → where this plan designs for them

| Lesson (review / integration list) | Here |
|---|---|
| doors failing rule (b): leaf faces / pockets | §2.2 column recomputed per door; shower-class rooms avoided (every door room ≥ 3.6 m along its wall) |
| roster/canon said too much | §1 threads: no navy screen says CHOIR controls anyone (CHOIR may appear as the facility system that requests maintenance); Kessler names it ("him", "that thing"); 3d's ending is not spelled out (no Aas line) |
| an unreadable "unskippable sight" | the nape LED is read in a 30° FOV close shot at 6.7 m (4 cm mark halo = 12 px at 1080p) + its 1 Hz blink held 1.6 s (§4.2) |
| done-criteria needing unowned files | §11 ownership table lists every script and shared file |
| story-side coordinates | D22; §8.10 marker table; every coordinate in §4 is a marker |
| tests written blind | §10.0 hook contract written here; T builds to it from day one and runs `--contract` against ST's greybox |
| sounds owned twice | D25, §8.11 owner column |
| waves that walk | D26; §10.3 arrival bounds |
| checks standing outside rooms | §10.4: every check view and stand-off point asserted inside a room interior (`roomAt` + inset) |
| far rooms drawn / budgets broken | §2.7 portals with see-ranges, frame zones per room pair, pickups room-culled (3b IB fix kept), sub-bay view budget with enemies |
| vent spawns inside voids | spawns 0.1 m under the solid ceiling beside each opening (§5.1) |
| checkpoint gaps | one checkpoint per fight boundary (§7), incl. `cp5_ready` between the units and the soldier |

---

## 1. Fiction and tone

1. The gate rises on Post 4. Warm-white fluorescent light, haze-grey paint, a turnstile, a guard booth with a mug on it.
   Lights on, nobody about — though behind the booth glass a palm plate still glows `AAS, L. (LT.) — PALM — LIVE`, and
   the booth's back door has just swung shut. The turnstile clicks round once; the board counts you in: `ON POST 26 → 27`.
2. The duty-room door opens on a sailor in fatigues, vest, helmet, balaclava. Reyes talks — the machines, Line Two, he
   needs the commander. The sailor only looks. Then, in CHOIR's voice, close and calm: the situation is under control;
   put the weapon down. He turns away. On his nape, a Clasp; the light is red and blinking. He walks out. Two units walk in.
3. He waits at the far end of the ready room, weapon low. When it starts, it is the first real gunfight: he takes cover,
   he aims for a long half-second before he fires, he never hurries, he never shouts.
4. His radio: a tired woman's voice. Commander Kessler, in the shielded command module with the four who had the watch
   — and Dr. Sunde. She powers the keypad and gives the code, and the job: cut the trunk, the one cable to the surface.
   CHOIR cuts in: it hears every word. She knows. She talks anyway.
5. Behind the keypad: the spine, berths under red night lights, a mess with a cake order on the board, a galley, a
   washroom, an armoury issue sheet signed by nobody. Units and taken sailors together now.
6. At her door she will not open it. The camera says he is clean, but the cameras are his; she needs to see his neck
   with her own eyes. He turns his back to the door. "Clean." She releases the tunnel. CHOIR turns her lights off.
7. The sub bay in the dark: beacons, the boat in its cradle, sailors' weapon lights on the gallery, red dots on their
   necks. A wheel on the gallery, the tunnel door below, and the boat that launches on an officer's palm — Kessler's, or
   her XO's.

Tone: navy order, wet steel, a hull that groans under 2.1 km of water; people-shaped enemies that move like machines.
Dread from stillness and courtesy, not gore. No faces (balaclavas, helmets, goggles); the only living faces are behind a
port you cannot see through clearly.

| Beat | Knows | Feels |
|---|---|---|
| gate, gatehouse | Post 4 is staffed and lit; something counts arrivals | relief that is wrong |
| cutscene | the navy is CHOIR's; the red LED = linked (3b's language) | the floor drops |
| ready room | a person can be an enemy, and a careful one | fear, focus |
| radio | the four are shielded; CHOIR hears the channel; the trunk is the mission | a plan, and an ear on it |
| quarters | the detachment armed itself at 08:43 and stopped signing; the sub is being prepared | dread, curiosity |
| her door | she trusts nothing she cannot see; the four are why the door stays shut | intimacy, cost |
| sub bay | the boat launches on an officer's palm; somebody carried Aas's palm to the gate | siege, the next question |

Threads (each readable alone — R3):

| Question | What 3c shows | Where |
|---|---|---|
| Who are the soldiers? | 19 linked sailors of the detachment, CHOIR-driven; PO1 H. Brekke is the first | cutscene name tape, `note5_locker`, `l5_kes_brekke` |
| Why 4 NO SIGNAL? | module watch Mon 08:00–12:00, shielded module | `note5_watch`, `l5_kes_door_5` |
| Where is Sunde? | in the module, alive; came at 08:12 to warn | `note5_visitors`, `note5_watch`, `l5_kes_door_sunde` |
| What does CHOIR want here? | the boat (pre-launch check requested by CHOIR), the trunk | `note5_dive`, launch console, `v5_sub_check`, `l5_choir_sub_*` |
| Aas | his palm opened the gate minutes ago (booth plate, back door just shut); he is the XO (launch console). Nothing more is said in 3c | booth `aas_palm` + `gate_log` screens, launch console, `l5_kes_boat` |
| Kessler's Clasp | not explained (7.1 open thread) | — |

Not revealed: why Kessler has none; who wanted 0031-H; whether the boat leaves (3d).

---

## 2. Layout (authoritative; separate world)

### 2.1 Rooms (`L.room(id, name, x0, x1, z0, z1, h, { y0, floors })`)

| room id | display name | x | z | y0 | h | notes |
|---|---|---|---|---|---|---|
| `lock5` | POST 4 — GATE LOCK | −3 … 3 | 0 … 6 | 0 | 3.6 | **start**. 3b `gatel` look (copy, not import). North wall: static `door5_tube`. South wall: `d5_gate`. |
| `gate5` | POST 4 — GATEHOUSE | −6 … 6 | −10 … 0 | 0 | 3.4 | guard booth NE (x 2.4 … 5.8, z −4.0 … −0.2, glazed west face), turnstile line z −5.0. |
| `duty5` | DUTY ROOM | −8 … 8 | −22 … −10 | 0 | 3.4 | watch desk, duty board (west wall), keypad door (east), ready door (south). |
| `ready5` | READY ROOM | −12 … 4 | −38 … −22 | 0 | 3.4 | two locker rows, gear crates, kit rack (south wall). First gunfight. |
| `spine5` | THE SPINE | 8 … 44 | −18 … −14 | 0 | 3.2 | main corridor, 36 m; grating strip over the crawlway; hatch pit at the east end; Kessler's door on the east wall. `floors: [{ y: -1.4, box: [16.4, 36.2, -16.6, -15.4], nav: false }, { y: -1.4, box: [36.2, 38.6, -17.6, -15.4], nav: false }, { y: -1.4, box: [16.4, 17.6, -18.0, -16.6], nav: false }]` |
| `berths5` | BERTHING — 1 | 12 … 24 | −14 … −2 | 0 | 3.0 | 6 triple bunks, curtains, red night lights. |
| `heads5` | WASHROOM | 12 … 20 | −2 … 4 | 0 | 2.8 | sinks + mirror (west), 3 showers (east). |
| `mess5` | MESS | 24 … 38 | −14 … −2 | 0 | 3.2 | 4 fixed tables, serving counter (north wall), board. |
| `galley5` | GALLEY | 28 … 38 | −2 … 4 | 0 | 3.0 | ranges, cold room with frosted window (east). |
| `arm5` | ARMOURY | 14 … 22 | −28 … −18 | 0 | 3.2 | cage racks; magazine below. `floors: [{ y: -1.4, box: [16.4, 17.6, -20.0, -18.0], nav: false }, { y: -2.6, box: [14.2, 21.8, -27.8, -21.4], nav: false }]` |
| `sub5` | SUB BAY | 22 … 46 | −56 … −18 | 0 | 12.0 | the boat, cradle, rails, launch lock (south wall). Gallery deck y 4.8: `floors: [{ y: 4.8, box: [22.2, 25.0, -55.8, -18.2] }, { y: 4.8, box: [43.0, 45.8, -55.8, -18.2] }, { y: 4.8, box: [25.0, 43.0, -21.0, -18.2] }, { y: 4.8, box: [25.0, 43.0, -36.0, -34.0] }]` (west, east, north galleries; the bridge). |
| `dive5` | DIVE LOCKER | 46 … 52 | −40 … −28 | 0 | 3.2 | suits on hooks, a dry chamber (prop); spawn room for `g5_spine`, script-only door. |
| `lockacc5` | LAUNCH LOCK — ACCESS | 38 … 46 | −62 … −56 | 0 | 3.2 | spawn room for `g5_bay_a/b`, script-only door. |
| `tunnel5` | TRUNK TUNNEL — ENTRANCE | 14 … 22 | −56 … −50 | 0 | 3.0 | cable trays, the trunk cable west into the dark; static `door5_headend` on its west wall. **End.** |

Non-room spaces (regions only): `cmd` (the command module, x 44 … 52, y 0 … 3.2, z −18 … −8 — solid behind the sealed door,
ALWAYS forbidden); `outside` (the flooded launch lock behind its port, x 30 … 38, y −1 … 6, z −64 … −56.4, `G.void`);
`voids` — `vent5_spine` (29.6 … 30.4, y 3.2 … 4.0, −16.4 … −15.6), `drain5_a` (27.5 … 28.5, y −1.0 … 0, −48.5 … −47.5),
`drain5_b` (38.5 … 39.5, y −1.0 … 0, −37.0 … −36.0) (moved clear of `STAIR5_E`'s stringer, the equipment boxes and CC). Regions also: `crawl` (the three spine floor boxes above, y −1.4 …
−0.05), `magazine` (the arm5 floors, y −2.6 … −0.1), `dark` (§2.7.3), `booth` (gate5's booth). Envelope
`GreyGrid([-14, -3.2, -66, 54, 12.5, 8])`; everything else is solid.

**K / W4 level-internal additions** this needs (no contract change): `RoomFloor`-like level option `nav?: false` on a
floor (no nav nodes sampled on it), `exits?: [x, y, z][]` on a `nav: false` floor (§8.4), and `room()` bounds `y` from
`min(y0, floors[].y) − 0.5` (today's bounds start at `y0 − 0.5`, which would cut the crawl at −0.5 — 3b only had floors
*above* y0); `nav: false` floors are excluded from `level/nav.ts`'s "floor with no reachable node" warning and from
`check:nav`'s floor test (S5). **Stairs** (S1m): `StairDef` gains `y0` (bottom floor y; `buildStair` builds from y 0
today) and `nav?: false` (no `navStair` link — today `buildStair` always registers one, `l3/grey.ts:375`): the three
lower stairs `STAIR5_HATCH`, `STAIR5_MAG_IN`, `STAIR5_MAG_OUT` are built with `y0` −1.4 / −2.6 / −2.6 and `nav: false`.
**Nav obstacle:** the hatch pit box (x 36.2 … 38.6, z −17.6 … −15.4) is an `L.obstacles` box from load (no nav node in it,
lid open or shut), and so is the magazine hatch (x 20.4 … 21.6, z −27.0 … −24.3) on the armoury floor.

Plan check (D4) — pairs touch only on boundaries: lock5/gate5 z 0; gate5/duty5 z −10 (x −6 … 6); duty5/ready5 z −22
(x −8 … 4); duty5/spine5 x 8 (z −18 … −14); spine5/{berths5, mess5} z −14; berths5/mess5 x 24; berths5/heads5 z −2;
mess5/galley5 z −2 (x 28 … 38); spine5/{arm5, sub5} z −18; arm5/sub5 x 22 (z −28 … −18); sub5/dive5 x 46 (z −40 … −28);
sub5/lockacc5 z −56 (x 38 … 46); sub5/tunnel5 x 22 (z −56 … −50); spine5/cmd x 44; sub5/cmd z −18 (x 44 … 46).
Non-touching pairs checked: heads5 (x ≤ 20) vs galley5 (x ≥ 28): 8 m of solid; dive5 (z ≤ −28) vs cmd (z ≥ −18) 10 m;
arm5 (z ≥ −28) vs tunnel5 (z ≤ −50) 22 m; ready5 (x ≤ 4) vs arm5 (x ≥ 14) 10 m; lockacc5 (x ≥ 38) vs `outside`
(x ≤ 38) touch at x 38 below the lock door only (wall). 13 rooms (< 31).

### 2.2 Doors (`DoorSpec.y` = floor of frame and sill)

| id | position (x, y, z) | wall | kind / style | rooms | leaf faces (interior spans along the wall) |
|---|---|---|---|---|---|
| `d5_gate` | (0, 0, 0) | z | `wide` 2.4 × 2.6, pressure (hazard frame, 12 retracted dogs as decoration) | lock5 / gate5 | vertical leaf (no pockets); jambs ±1.4 inside lock5 ±2.8 and gate5 ±5.8 ✓ |
| `d5_duty` | (0, 0, −10) | z | std, `navy`, non-auto (scene opens it) | gate5 / duty5 | x ±1.62 in gate5 ±5.8, duty5 ±7.8 ✓; pockets ±1.675 in uninterrupted wall (booth is at x ≥ 2.4, z ≥ −4) ✓ |
| `d5_ready` | (−4, 0, −22) | z | std, `navy`, lintel `READY ROOM` | duty5 / ready5 | x −5.62 … −2.38 in duty5 −7.8 … 7.8, ready5 −11.8 … 3.8 ✓ |
| `d5_key` | (8, 0, −16) | x | std, `navy`, keypad panel on the duty side, lintel `SPINE — AUTHORISED` | duty5 / spine5 | z −17.62 … −14.38 in duty5 −21.8 … −10.2, spine5 −17.8 … −14.2 ✓; pocket −17.675 … −14.325 on x 8 ✓ (0.125 m from the spine corners) |
| `d5_berth` | (18, 0, −14) | z | std, `navy`, lintel `BERTHING 1` | spine5 / berths5 | x 16.38 … 19.62 in spine5 8.2 … 43.8, berths5 12.2 … 23.8 ✓ |
| `d5_mess` | (31, 0, −14) | z | std, `navy`, lintel `MESS` | spine5 / mess5 | x 29.38 … 32.62 in spine5, mess5 24.2 … 37.8 ✓ |
| `d5_berth_mess` | (24, 0, −8) | x | std, `navy` | berths5 / mess5 | z −9.62 … −6.38 in berths5 −13.8 … −2.2, mess5 −13.8 … −2.2 ✓ |
| `d5_heads` | (16, 0, −2) | z | std, `navy` | berths5 / heads5 | x 14.38 … 17.62 in berths5 12.2 … 23.8, heads5 12.2 … 19.8 ✓ |
| `d5_galley` | (33, 0, −2) | z | std, `navy` | mess5 / galley5 | x 31.38 … 34.62 in mess5 24.2 … 37.8, galley5 28.2 … 37.8 ✓ |
| `d5_arm` | (17, 0, −18) | z | std, `navy`, lintel `ARMOURY` | spine5 / arm5 | x 15.38 … 18.62 in spine5, arm5 14.2 … 21.8 ✓ (the crawl passes under its sill at y −1.4 … −0.05) |
| `d5_arm_bay` | (22, 0, −23) | x | std, `navy` | arm5 / sub5 | z −24.62 … −21.38 in arm5 −27.8 … −18.2, sub5 −55.8 … −18.2 ✓; pocket −24.675 … −21.325, 0.225 m clear of the magazine hatch (z ≤ −24.9) ✓ |
| `d5_bay` | (34, 0, −18) | z | std, `navy`, lintel `SUB BAY` | spine5 / sub5 | x 32.38 … 35.62 in spine5, sub5 22.2 … 45.8 ✓; pocket x 32.325 … 35.675 (spine hatch pit starts x 36.2) ✓ |
| `d5_dive` | (46, 0, −34) | x | std, `navy`, lintel `DIVE LOCKER`, **script only** | sub5 / dive5 | z −35.62 … −32.38 in sub5, dive5 −39.8 … −28.2 ✓ |
| `d5_lockside` | (42, 0, −56) | z | std, `navy`, lintel `LAUNCH LOCK — ACCESS`, **script only** | sub5 / lockacc5 | x 40.38 … 43.62 in sub5, lockacc5 38.2 … 45.8 ✓; 3.9 m clear of the launch door (x ≤ 36.5) ✓ |
| `d5_tunnel` | (22, 0, −53) | x | std, pressure (hazard frame), lintel `TRUNK TUNNEL`; `locked` then `cycling` with `cyclingPrompt` | sub5 / tunnel5 | z −54.62 … −51.38 in sub5, tunnel5 −55.8 … −50.2 ✓ |

`cyclingPrompt` (3b W4, `level/doors.ts`) values: `d5_tunnel` in V: `Hydraulics isolated — gallery wheel`.
Static sealed props (`sealedDoor()`, `src/level/kit.ts`): `door5_tube` (0, 0, 6) z, panel `TRANSFER TUBE — CYCLING`;
`door5_cmd` (44, 0, −16) x — **hardened module door** (W7 set piece: 2.0 × 2.6 leaf, 16 dogs, the port, door camera with a
red tally, intercom grille, yellow stand line on the spine floor at x 42.5), panel `COMMAND MODULE — SHIELDED — SEALED FROM
INSIDE`; `door5_headend` (14, 0, −53) x, panel `TRUNK — HEAD-END 200 M — CYCLING`; `lock5_launch` (34, 3.0, −56) z — the
5.0 m round launch-lock door (W7) with a 0.6 m port at (34, 2.2, −55.9).

### 2.3 Triggers (feet boxes)

| id | x | z | y | use |
|---|---|---|---|---|
| `t5_lock` | −2.8 … 2.8 | 0.2 … 5.8 | −1 … 3 | start |
| `t5_gate` | −5.8 … 5.8 | −9.8 … −1.2 | −1 … 3 | arms the `d5_gate` latch |
| `t5_turnstile` | −3.0 … 1.2 | −5.8 … −4.2 | −1 … 3 | `v5_turnstile` |
| `t5_dutydoor` | −2.0 … 2.0 | −9.8 … −8.0 | −1 … 3 | **the cutscene** — **polled every frame** (`at('t5_dutydoor')` in B2), not an enter event: a sprinter reaches it before the gate has shut, and a player waiting inside must still start it (S2) |
| `t5_duty` | −7.8 … 7.8 | −21.8 … −10.2 | −1 … 3 | |
| `t5_ready` | −11.8 … 3.8 | −37.8 … −24.0 | −1 … 3 | `g5_s1` engage (entering past the door) |
| `t5_spine_w` | 8.2 … 22.0 | −17.8 … −14.2 | −0.5 … 3 | |
| `t5_spine_mid` | 22.0 … 30.0 | −17.8 … −14.2 | −0.5 … 3 | `g5_spine` |
| `t5_cmd` | 40.0 … 43.8 | −17.8 … −14.2 | −0.5 … 3 | the door beat region |
| `t5_cmd_line` | 41.9 … 43.1 | −17.4 … −14.6 | −0.5 … 3 | the yellow line (neck check stand) |
| `t5_hatch` | 36.2 … 38.6 | −15.4 … −14.2 | −0.5 … 3 | the walkway beside the pit: stencil in view, hatch prompt |
| `t5_crawl_e` | 33.0 … 36.2 | −16.6 … −15.4 | −1.6 … −0.2 | crawl entry (`Crouch — C` hint); `v5_boots` armed at first entry + 2 s |
| `t5_landing` | 36.2 … 37.4 | −17.6 … −15.4 | −1.6 … −0.2 | the pit landing (crouch toast if standing) |
| `t5_mag` | 14.2 … 21.8 | −27.8 … −21.4 | −2.8 … −1.0 | magazine; `g5_mag` rules |
| `t5_berths` | 12.2 … 23.8 | −13.8 … −2.2 | −1 … 3 | `v5_bunk_radio`, `v5_body` |
| `t5_heads` | 12.2 … 19.8 | −1.8 … 3.8 | −1 … 3 | `v5_water` |
| `t5_mess` | 24.2 … 37.8 | −13.8 … −2.2 | −1 … 3 | `v5_trays` |
| `t5_galley` | 28.2 … 37.8 | −1.8 … 3.8 | −1 … 3 | `v5_galley_shape` |
| `t5_arm` | 14.2 … 21.8 | −27.8 … −18.2 | −0.5 … 3 | |
| `t5_bay` | 22.2 … 45.8 | −55.8 … −18.2 | −0.5 … 8 | sub bay (both decks) |
| `t5_bridge` | 25.0 … 43.0 | −36.0 … −34.0 | 4.3 … 7 | launch console region |
| `t5_wheel` | 22.2 … 25.0 | −53.0 … −49.0 | 4.3 … 7 | the wheel |
| `t5_tunnel` | 14.2 … 21.6 | −55.8 … −50.2 | −1 … 3 | `d5_tunnel` latch (X) |

### 2.4 Maps (1 character ≈ 1 m in x, 1 line ≈ 2 m in z; `d` door, `S` sealed prop, `#` grating, `H` hatch, `=` glass/port, `^` stair up)

Deck 1 (y 0), north part:

```
x:   -12   -8 -6  -3 0 3  6 8      12      16   20  24        31   33  38    44    52
z=+6               +-S-+                            door5_tube (sealed)
                   |LK5|  lock5 (start)
z= 0         +-----+-d-+-----+                      d5_gate (wide)     +---------+   z=+4
             | GATEHOUSE [booth=]|               +--------+          | GALLEY  |
z=-5         |  turnstiles  ---  |               | HEADS  |          | [cold=] |
z=-10        +--------d------+---+       z=-2   +---d----+---------+---d-----+
          +--+     d5_duty      +--+            | BERTHS  d5_berth_mess  MESS |
          |      DUTY ROOM        |             | (red night)  d   tables     |
          | [board]  desk     keypad d5_key     |  bunks       |  counter     |
z=-14     |                      d+------d-------+--------------+----d--------+--------+
          |                       | SPINE  ######## grating ############ [H pit]  S  |  door5_cmd
z=-18     +-----d----------------+-----d---+------------d-------------------+-----+  (cmd void)
          |    d5_ready           | ARMOURY | d5_arm      d5_bay (34,-18)          |
          |                       |  (mag   d5_arm_bay                             |
          |  READY ROOM           |  below) |                SUB BAY ...         |
z=-28     |  lockers  crates      +---------+                                    |
z=-38     +--------[kit rack]----+
```

Sub bay (x 22 … 46, z −18 … −56), plan; galleries at y 4.8 shown with `:`; stairs `^` point uphill:

```
x:  14     22  25   27.4      32.5  35.5     40.6 42.6 43  46     52
z=-18       +---:::::::::::::::d5_bay:::::::::::::::::::::+
            |:::::  north gallery (y 4.8, z -21..-18)  ::::|
z=-23 ARM  d5_arm_bay                                     :|
z=-25       |::|                 +-----+         ^      ::|
z=-27       |::|    crates       | sail|  forklift ^ STAIR5_E (z -25 → -34)
z=-28       |::|                 | SUB |         ^      ::+------+
            |::|                 | on  |         ^      ::|DIVE  |
z=-34       |::+====bridge (y 4.8, z -36..-34) [launch console]=+::d5_dive
            |::|^ STAIR5_W       |     |                ::|      |
z=-40       |::|^ (z -45 → -36)  |cradle               ::+------+
z=-45       |::|^                +-----+  gas racks     ::|
z=-48       |::|   drain_a                               ::|
+------+    |::| [wheel @ z -52 on the west gallery]     ::|
|TUNNEL d5_tunnel (22,-53)        rails → [ LAUNCH LOCK S ] d5_lockside
+------+    +--------------------(34,-56)-------------(42,-56)--+
z=-56                                               |LOCKACC|  z -62
```

Crawlway and magazine (section along the spine, looking north; y up):

```
 y 3.2 ___________________ spine ceiling ______________________________
 y 0   ___[d5_arm sill]___################ grating x 16.4 … 36.2 ###[H pit]_____  spine floor
 y-0.05     |        crawl (1.35 m clear), crouch only                 |  stair ^ (z -17.6 → -15.5)
 y-1.4      |______________________________________________________|__|
            | turn south x 16.4 … 17.6 (z -18.0 … -20.0)
 y-1.4 … -2.6  steps down (4 risers, z -20.0 → -21.4)
 y-2.6      MAGAZINE (x 14.2 … 21.8, z -27.8 … -21.4), standing (2.5 m) — exit stair ^ (x 20.4 … 21.6,
            z -27.6 → -24.9) to the armoury hatch (dogged from below)
```

### 2.5 Route graph

```
[cp5_start] lock5 ──gate rises──▶ gatehouse ══gate latches══▶ duty door ── CUTSCENE ──▶ [cp5_duty]
duty: 2 units from the ready door (+2.5 s) ──▶ [cp5_ready] ──▶ ready room: soldier g5_s1 ──▶ radio (body)
radio: Kessler powers the keypad, code 4719 ──▶ [cp5_radio] ──keypad──▶ spine
the loop (both directions):  spine ─ d5_berth ─ berths ─ d5_berth_mess ─ mess ─ d5_mess ─ spine
                             spine ─ d5_arm ─ armoury ─ d5_arm_bay ─ sub bay ─ d5_bay ─ spine
spurs: heads (berths), galley (mess); crawl: spine hatch → crawl → magazine → armoury hatch (one-way up)
spine wave g5_spine (from the dive locker via the sub bay) ──▶ [cp5_spine]
REQUIRED: Kessler's door (t5_cmd): neck check ──▶ tunnel released (CYCLING) ──▶ lights_out5 ──▶ [cp5_door]
sub bay in the dark: g5_cmd (vent skitters + one soldier), g5_bay_a ──▶ [cp5_bay]
gallery wheel (4 s, g5_bay_b) ──▶ d5_tunnel opens ──▶ tunnel5 ══latch══▶ END
```

Length (estimate): first-time main route ≈ 12.5 min (gate + gatehouse 1.0, scene 0.4, duty fight 1.0, ready room 1.5,
radio + keypad 1.2, spine wave 1.5, door beat 1.5, dark + vent wave 1.0, sub bay + wheel + tunnel 3.4); a reader who visits
every room and the crawlway ≈ 17 min; a runner ≈ 8 min.

### 2.6 Dressing per space

General: haze-grey `navy_grey` (3b) on frames and doors; **`hull_white`** (new: off-white enamel on curved pressure-hull
plating with weld seams, rivet rows, condensation streaks) on the outer walls of the spine and sub bay; `deck_nonslip`
floors; `deck_grate` bar grating on the crawl strip, galleries, bridge and stairs; hull ribs every 3 m in the spine (visual,
ceiling arch) and pipe risers for cover; cable trays and pipe runs (`copper`, `rubber`); stencils (`navy` sign style, new); red "darken ship"
night lights in berthing; wet patches and drips on the hull (§2.9). Warm-white 4000 K fluorescents (lit rooms), emergency
fittings with a red lens. No wood. Fabric only curtains, mattresses, fatigues.

- **lock5**: copy of `gatel`'s look (benches, gauge board); `door5_tube` behind; `d5_gate` with the 3b gate's dog ring.
- **gate5**: guard booth x 2.4 … 5.8, z −4.0 … −0.2 (kerb 1.0 m, bulletproof glass to 2.4 m on its west face, roof 2.6,
  no door on the gatehouse side — booth is entered from its own east door into solid: never entered; region `booth` ALWAYS);
  in the booth: a mug, a monitor with `gate_log` (seen through the glass), a desk fan running, and the gate's **palm
  plate** on the booth's inner counter `mk5_aas_palm` (4.6, 1.1, −2.0) facing −x, screen `aas_palm` (kind `palm`, state
  `done`, label `AAS, L. (LT.) — PALM — LIVE — {arrival − 0:40}`), seen through the glass at ≥ 1.8 m, not usable (R8);
  the booth's back door (east face, into solid) is a hinged prop that settles shut at t 1.2 s with `booth_door_shut`
  (vignette `gate5_booth`, part of the arrival; no figure ever); **turnstile line** at z −5.0:
  two tripod turnstiles x −3.0 … −2.1 and −2.0 … −1.1, an open equipment gate x −1.0 … 1.2 (the route), fence x 1.2 … 2.4
  (h 1.2) to the booth and x −5.8 … −3.0 (h 1.2); `ON POST` counter board `mk5_onpost` (−4.0, 2.6, −0.22) facing −z;
  `note5_visitors` clipboard on the booth's west ledge (2.3, 1.05, −2.0) facing −x (R8: on the gatehouse side);
  `p5_gate_med` (5.4, 1.0, −6.0) in a first-aid cabinet on the east wall; weapon-clearing barrel (−5.2, 0, −8.6); notices.
- **duty5**: watch desk x −3.0 … 0.0, z −16.0 … −15.0 (h 1.0, collider) with `note5_watch` (−1.2, 1.02, −15.5) and a
  phone off the hook; **duty board** screen `dock_status` 3.0 × 1.2 on the west wall at (−7.78, 1.7, −18.0) facing +x;
  `note5_roster` (module watch card) pinned at (−7.78, 1.4, −14.0) facing +x; filing cabinets x 4.4 … 5.6, z −21.8 … −21.2
  (h 1.3, low cover); **keypad** `key5_duty` panel `mk5_keypad` (7.78, 1.35, −13.9) facing −x, beside `d5_key` (north of it, clear of
  the pocket that ends at z −14.325); duty camera (east wall high, red tally); `p5_duty_ammo` (7.5, 1.2, −11.0) shelf.
- **ready5**: locker rows L1 x −8.0 … −7.4, z −33.0 … −26.0 and L2 x −0.4 … 0.2, z −33.0 … −26.0 (h 2.0, colliders;
  Brekke's locker 7 on L1's east face at z −29.0 with `note5_locker` (−7.38, 1.5, −29.0) facing +x); gear crates
  **(h 1.2)** C1 x −4.6 … −3.4, z −29.9 … −29.1; C2 x −4.6 … −3.4, z −34.4 … −33.6; C3 x 1.4 … 2.6, z −35.6 … −34.8; kit
  rack along the south wall x −11.8 … 3.8, z −37.8 … −37.2 (h 2.2); benches between the rows (h 0.45, walkable). The locker
  `mk5_locker_slam` (L2 west face, z −31.5) is ajar (`v5_hull_groan`). A **ready-room camera** high on the north wall at
  (−10.0, 3.0, −22.25) facing −z with a red tally (Kessler's squawk "I can see you on the camera" is true in both rooms,
  S6). `p5_ready_med` (3.4, 1.0, −23.0), `p5_ready_ammo` (−11.4, 1.0, −30.0).
- **spine5**: hull ribs every 3 m from x 9.5 (0.12 m proud, visual); **pipe risers** (0.6 wide × 0.5 deep, full height,
  colliding — the spine's high cover), placed clear of every door pocket: R1 south wall x 11.7 … 12.3, R2 north x 13.7 …
  14.3, R3 south x 21.7 … 22.3, R4 north x 25.7 … 26.3, R5 south x 27.7 … 28.3, R6 north x 34.7 … 35.3 (ends 0.9 m before the hatch
  pit, so the 1.2 m walkway beside the pit stays whole), R7 south x 40.7 … 41.3 (south risers z −17.8 … −17.3, north −14.7
  … −14.2; corridor left 3.1 m); grating strip x 16.4 … 36.2, z −16.6 … −15.4 (flush, `deck_grate`, colliding); **hatch pit**
  x 36.2 … 38.6, z −17.6 … −15.4: lid `hatch5_spine` (W7, 2.4 × 2.2, wheel on top; interact `Open hatch` at (37.0, 0.3,
  −14.9), radius 1.4, from the walkway z > −15.4); open lid stands up against a frame on the pit's south side; rails 1.0 m
  on the pit's west (x 36.2) and east (x 38.6) sides and its north side over the landing (x 36.2 … 37.4, z −15.4); the
  stair top x 37.4 … 38.6 at z −15.4 is the entry; walkway beside the pit z −15.4 … −14.2 (1.2 m); stencil
  `BILGE ACCESS — CRAWLWAY TO MAGAZINE — CROUCH` on the pit frame facing +z; Kessler's door and its yellow line at x 42.5;
  vent grille `vent5_spine` (30.0, 3.2, −16.0); fire hose box, pipe valves; `p5_spine_ammo` (43.4, 1.0, −14.6).
- **crawl** (spine floors): bilge plating floor y −1.4, side walls `hull_white` with pipe bundles, red LED strip at both
  floor edges (emissive), 2 dim red points (§2.7); water film (decal + gloss) and 3 drips; the grating above (y −0.05 …
  0) lets the spine's light in as bars where the spine's grating lamp casts (MEDIUM+). Stair `STAIR5_HATCH = { room:
  'spine5', x0: 37.4, x1: 38.6, z0: -17.6, dir: 1, risers: 5, rise: 0.28, tread: 0.42, y0: -1.4, nav: false }` (z −17.6 →
  −15.5, y −1.4 → 0; its top tread meets the walkway edge z −15.4, so the crawl exit is outside the walkway box);
  landing x 36.2 … 37.4. Clearances: crawl 1.35 m (crouched 1.1 ✓, standing ✗: `canStand` needs ≈ 1.85); width 1.2 m
  (capsule 0.7 ✓). Turn south x 16.4 … 17.6 at z −16.6 … −20.0 (under `d5_arm`).
- **magazine** (arm5 floor y −2.6): steps down `STAIR5_MAG_IN = { room: 'arm5', x0: 16.4, x1: 17.6, z0: -21.4, dir: 1,
  risers: 4, rise: 0.3, tread: 0.35, y0: -2.6, nav: false }` (bottom z −21.4, top z −20.0 at y −1.4); steel racks of ammo
  tins, **per-shelf colliders with an open front**: west rack x 14.4 … 15.4, z −27.4 … −22.4; east rack x 18.6 … 19.6,
  **z −26.2 … −22.4** (h 2.0); a flooded corner (water 3 cm, decal + gloss); a fire-party board; one caged emergency lamp
  (the one that pops); exit `STAIR5_MAG_OUT = { room: 'arm5', x0: 20.4, x1: 21.6, z0: -27.0, dir: 1, risers: 9, rise:
  0.2889, tread: 0.3, y0: -2.6, nav: false }` (z −27.0 → −24.3, y −2.6 → 0; 0.8 m of floor in front of its first riser,
  approached freely from x 18.6 … 21.8, z −27.8 … −26.2) under `hatch5_mag` (1.2 × 2.7 lid in the armoury floor, x 20.4 …
  21.6, z −27.0 … −24.3, **hinged on its south edge**: open, it stands at z −27.0 … −27.1, the exit is north); underside
  interact `Open hatch` with its use point **on the lid underside (21.0, −0.08, −26.4), radius 1.6** — reached from the
  stair foot (eye ≈ −0.95 at z −27.3: 1.25 m) and the lower treads, the ray from the eye stays above the treads; usable only
  with the eye below y −0.2 (R8); top side plate `MAGAZINE — DOGGED FROM BELOW — ACCESS VIA SPINE CRAWLWAY`. Pickups §5.2
  (at the rack faces). Navy husk (dormant `slumped`) against the west rack's east face. `note5_mag` tally sheet (19.0,
  −1.4, −22.0) on the east rack's end.
- **berths5**: 6 triple bunks (x 12.8 … 14.8 and 21.2 … 23.2 rows, z −12.8 … −3.2), curtains, lockers, red night lights;
  the bunk radio on a shelf `mk5_bunk_radio` (13.6, 1.3, −7.6); the body of **a Halcyon catering contractor** (white
  chef's jacket, face to the floor, hair; not on the navy roster, so no canon conflict) at `mk5_body_a` (19.6, 0, −12.4)
  inside the door; later at `mk5_body_b` (14.2, 0, −16.9) in the spine, with a drag smear between (§5.5 `v5_body`);
  `p5_berth_med` (23.4, 0.7, −3.0), `p5_berth_shells` (13.8, 0.7, −2.9) on the bunk-end shelf.
- **heads5**: 4 sinks + mirror on the west wall, 3 shower stalls (east), drain grates; `mk5_taps` (12.4, 1.0, 1.0).
- **mess5**: 4 fixed tables (1.0 × 2.4, h 0.75) at x 27/31 × z −10/−6; serving counter along the north wall x 26 … 36,
  z −2.8 … −2.2 (h 1.0) with tray stacks (`mk5_trays`, 30.0, 1.0, −2.5); board `note5_mess` (24.22, 1.6, −4.0) facing +x;
  `p5_mess_ammo` (37.4, 1.0, −13.4).
- **galley5**: ranges, steel benches, the walk-in cold room behind a frosted window on the east wall (window x 37.78,
  z 0.0 … 2.0, y 1.0 … 2.0; the cold room itself is a 1.2 m-deep shallow box behind the window, never entered); oilskin on
  a hook behind the glass `mk5_oilskin`; `p5_galley_med` (28.6, 1.0, 3.4).
- **arm5**: cage racks on the west wall (empty carbine slots: 19 gaps of 23), issue desk with `note5_arm` (15.0, 1.0,
  −19.6); `p5_arm_vest` (21.4, 1.4, −19.4), `p5_arm_ammo_1/2` (14.6, 1.0, −22.0 / −22.5), `p5_arm_shells` (14.6, 1.0,
  −24.0), `p5_arm_plate` (14.6, 0.4, −25.0); `p5_arm_carbine` (14.45, 1.3, −20.6); the magazine hatch with its rail
  (1.0 m on its west and south sides, x 20.2 and z −27.2; the wall x 21.8 is its east side; open side north at z −24.3,
  0.5 m south of `d5_arm_bay`'s opening edge z −23.8 — the hole is in the corner, never on the route).
- **sub5**: the **boat** SDV *TERN* (W7): hull ⌀ 3.0, x 32.5 … 35.5, z −27.0 … −43.0, keel y 0.6 on the cradle (cradle
  x 31.8 … 36.2, h 0.6, five saddles), sail z −30.0 … −32.5 (top y 4.5), top hatch on the sail, a dome port forward, nav
  lights (red/green), name `TERN`; rails x 33.0 / 35.0 from z −19.0 to −55.6 (0.15 high, walkable); **launch lock door**
  ⌀ 5.0 at (34, 3.0, −56) with its port; **galleries** y 4.8 with 1.1 m rails on the inner edges, **steel parapet plates**
  (h 1.1, colliding — low cover) on the west gallery z −50 … −40 and −30 … −22, the east gallery z −48 … −38 and −30 …
  −22, the bridge's north edge x 28 … 32 and 36 … 40; stairs `STAIR5_W = { room: 'sub5', x0: 25.4, x1: 27.4, z0: -45, dir:
  1, risers: 16, rise: 0.3, tread: 0.5625 }` (z −45 → −36, top lands on the bridge's south edge) and `STAIR5_E = { room:
  'sub5', x0: 40.6, x1: 42.6, z0: -25, dir: -1, risers: 16, rise: 0.3, tread: 0.5625 }` (z −25 → −34, top lands on the
  bridge's north edge); floor cover (§5.4 cover points): crate stacks CA x 26.0 … 28.0, z −30.0 … −28.0 (h 1.2), CB x 26.0 …
  27.2, z −51.0 … −49.0 (h 1.2), CC x 38.0 … 40.0, z −46.0 … −44.0 (h 1.2), CD x 43.6 … 45.0, z −24.0 … −22.0 (h 2.0);
  forklift x 37.6 … 39.0, z −28.0 … −25.6 (h 2.2); gas bottle racks x 38.4 … 40.4, z −52.4 … −51.6 (h 1.8);
  **cradle-side equipment boxes** (h 1.3, low cover; S1b): EW1 x 30.4 … 31.6, z −33.0 … −31.0; EW2 x 30.4 … 31.6, z −41.0 …
  −39.0; EE1 x 36.4 … 37.6, z −33.0 … −31.0; EE2 x 36.4 … 37.6, z −41.0 … −39.0 (0.2 m from the cradle); the
  **launch console** on the bridge `mk5_launch` (34.0, 4.8, −34.15) facing −z (h 1.1) with palm plate `launch5_palm`
  (interact `Hold palm — LAUNCH`, R8 from the bridge only) and screen `launch`; the **wheel** `wheel5` (W7, ⌀ 0.8) on the
  west wall at `mk5_wheel` (22.25, 5.9, −52.0) facing +x, interact radius 1.2; floor drains `drain5_a`, `drain5_b`; the dock
  sentry dock (navy) in the roof at (34.0, 9.0, −45.0); `TERN — CRADLE — LAUNCH READY` board `mk5_tern_board` on the north
  wall at (34.0, 7.2, −18.22) facing −z; puddles; hull drips.
- **dive5**: 6 suits on hooks (hard hats on a shelf above), a dry decompression chamber (prop, ⌀ 1.8, x 49 … 51.6,
  z −39.6 … −36.0), `note5_dive` board (51.78, 1.6, −30.0) facing −x; `p5_dive_shells` (51.4, 1.0, −29.0).
- **lockacc5**: bare, flood valves, a panel `LAUNCH LOCK — FLOODED — 210 BAR`.
- **tunnel5**: cable trays both walls, the trunk cable (⌀ 0.25, armoured, yellow bands) from the sub bay wall west to
  `door5_headend`; `p5_tunnel_med` (21.0, 1.0, −50.6); stencil `TRUNK — HEAD-END 200 M ←`.

### 2.7 Light plan, darkness and per-space performance budget

Pools: low 2 shadow / 8 spot / 6 point; medium 3 / 9 / 8; high 4 / 10 / 10. **The flashlight is a shadow spot.**
Emissive-only: fluorescent tubes (`bindEmissive` to their room's first light), strips, LEDs, Clasp LEDs + halos, screens,
the boat's nav lights, beacons' lenses. Every point light is `bounds`-boxed to its room **and floor** (S5: `roomLightBox`
is unbounded in y today): the crawl's to the crawl floor boxes; the spine's and the armoury's to y ≥ 0; `mag5` to
y ≤ −0.1. Every enemy's dark-room glow is `RigBuilder.mark()` (merged: red steady awake, dim cyan standby, out dead;
≥ 2.2 px to 25 m; no extra call) — the soldier's Clasp mark is **always red, blinking 1 Hz, never cyan** (S6). Husk eye lights (prio 0.2) lose slots first; soldier weapon lights are spots (prio 0.5,
no shadow, on only while aiming — §8.2.4).

#### 2.7.1 Groups

| group | lit (A … S) | after `lights_out5` (V on) | descriptors |
|---|---|---|---|
| `lock5` | 1 spot (cast medium+), 1 point | unchanged | 2 |
| `gate5` | 2 points (all) + booth point (medium+) | unchanged | 3 |
| `duty5` | 2 points (all) + desk lamp spot (cast medium+, prio 0.8) | unchanged | 3 |
| `ready5` | 2 points (all) + 1 (medium+) | unchanged | 3 |
| `spine5` | 3 points (all) x 13 / 25 / 37 + grating spot over x 28 aimed down (cast **medium+**, prio 0.6: grating bars into the crawl) | off; `spine5_emerg`: 2 red points 0.3 (all) x 16 / 34, strips both walls (emissive 1.0), the yellow line glows | 4 + 2 |
| `crawl5` | 2 red points 0.25 (all) x 22 / 32, `bounds` = crawl boxes; LED strips | unchanged | 2 |
| `berths5` | **night**: 2 red points 0.35 (all) + reading lamp point (medium+) | unchanged | 3 |
| `heads5` | 1 point (all), fluorescent `fluorescent` flicker | unchanged | 1 |
| `mess5` | 2 points (all) + 1 (medium+) | unchanged | 3 |
| `galley5` | 1 point (all) + cold-room glow point (medium+, behind the frosted window) | unchanged | 2 |
| `arm5` | 1 point (all) + cage spot (cast medium+, prio 0.7 — the vest and racks read from the door) | unchanged | 2 |
| `mag5` | 1 caged emergency point 0.4 (all) | (popped by `v5_magazine`: off; strips at the stair stay) | 1 |
| `sub5` | 2 high-bay spots (cast medium+, prio 0.8) aimed at the boat and the bridge; 2 points (all) at the galleries' north corners; 2 points (medium+) south; the boat's interior glow (point 0.3, medium+, in the sail) | mains off; `sub5_emerg`: 2 amber rotating beacons `alarm` (point, all) on the north and south walls (34, 9, −18.6) / (34, 9, −55.4); 1 red point 0.35 **(all)** over the tunnel door (the wheel and the door must read without the flashlight on LOW, S5); gallery-edge and stair-nosing strips (emissive 1.2); boat nav lights (emissive); door panels lit | 7 + 3 |
| `dive5` | 1 red point 0.3 (all) | unchanged | 1 |
| `lockacc5` | 1 point (all) | unchanged | 1 |
| `tunnel5` | 1 point (all) + tray LEDs (emissive) | unchanged | 1 |

#### 2.7.2 Worst views on LOW (points / shadow slots incl. flashlight)

(a) duty room through the open ready door: duty 2 + ready 2 + gate 1 = 5 / 1. (b) spine from `d5_key` looking east,
before V: spine 3 + mess 1 (open door) + sub 1 = 5 / 1. (c) the crawl: crawl 2 + spine 1 (through the grating) + muzzle
flash 1 = 4 / 1. (d) sub bay in the dark from the north gallery: beacons 2 + spine_emerg 1 + muzzle 1 + 2 husk eyes = 6 /
2 (flashlight + sentry searchlight); spots: 2 soldier weapon lights + flashlight + sentry searchlight = 4 of 8; points
on LOW: the tunnel red point (now `all`) takes the slot of one husk eye light (prio 0.2 loses first) — 6. (e) sub bay lit from `d5_bay`:
sub 2 + spine 1 + boat 0 (medium+) = 3 / 1 (high-bay casts are medium+). (f) berths: 2 red + spine 1 = 3 / 1.

#### 2.7.3 Darkness for the battery (D16, D18)

`regions.dark` (the soldier and `check:dark` read it): the crawl boxes; the magazine; `berths5`; `dive5`; and, **from V
on**, `spine5` and `sub5` (the story toggles `level.vignette('dark5_on')`, which swaps the region list; restore re-applies
it). Rules for every dark space, checked by `check:dark` (§10.4):
- **without the flashlight** every door, stair (nosing strips), gallery edge, required interactable (wheel, tunnel door
  panel, hatch wheels) within 10 m in line of sight reads at p95 luma ≥ 0.10 on LOW and MEDIUM;
- the merged `check-dark` lamp-OFF rule (≥ 1.5 % of pixels lit, frame mean ≥ 0.015) holds in every level-5 view;
- the main route has **no unreadable run longer than 8 m** (samples every 2 m, flashlight off; ≤ 4 consecutive failing
  samples) — at walk speed 3.6 m/s that is ≤ 2.2 s, well inside the 10 s cell; a player who runs the cell empty waits
  ≥ 0.6 s (15 %) plus the 0.25 s settle before he can light it again, so every dark fight space has a readable floor without
  it;
- the crawl (24 m at 1.8 m/s ≈ 13 s, longer than a battery) is readable by its red strips alone; the flashlight shows the
  detail (water, the boots, the dead hand on the stair).

Lit refuges where a player can switch off to recharge with no penalty: gatehouse, duty, ready, mess, galley, armoury,
tunnel. Every dark fight space has a lit or emergency-lit escape within 15 m.

#### 2.7.4 Portals (`[roomA, roomB, door | null, see]`)

Doors are `false` (drawn only through the open door); glass/openings as listed. `gate5`–`booth` (booth glass, 8 m);
`galley5`–cold room (frosted window, 6 m, the cold room is a dressing box of galley5 — no portal needed); `spine5`–crawl
(same room; the grating). `sub5`–`outside`: launch-lock port (6 m, `fx5_lock_water` only). Frame zones per room pair
(3b `frameZone`) — **the five sub-bay doors share one frame zone** (3b actuals: 8 calls per far door) — pickups
room-culled. **The sub bay is only drawn through `d5_bay`, `d5_arm_bay`, `d5_dive`,
`d5_lockside`, `d5_tunnel` when open**; from the spine with `d5_bay` shut the sub bay costs nothing.

#### 2.7.5 Per-space budget (main calls / shadow calls / tris / transparent calls / max layers)

Targets ≥ 60 fps LOW and MEDIUM, ≥ 45 fps HIGH; any view over budget blocks hand-over. Counts **include** the enemies the
plan puts there (soldier ≤ 10 calls LOD0 / ≤ 6 LOD1, husk 12 (3b actual), skitter ≤ 6, sentry ≤ 8).

| space | main | shadow | tris | transparent | layers |
|---|---|---|---|---|---|
| lock5 / gatehouse | ≤ 150 | ≤ 45 | ≤ 0.35 M | 1 (booth glass) | 1 |
| duty + ready (scene, 2 husks + soldier) | ≤ 200 | ≤ 60 | ≤ 0.5 M | 0 | — |
| spine (+ open side rooms) with 2 husks + 1 soldier | ≤ 220 | ≤ 60 | ≤ 0.55 M | 1 (grating alpha) | 1 |
| crawl + magazine | ≤ 120 | ≤ 30 | ≤ 0.3 M | 1 | 1 |
| berths / heads / mess / galley | ≤ 200 | ≤ 55 | ≤ 0.5 M | 1 (frosted window) | 1 |
| armoury | ≤ 160 | ≤ 45 | ≤ 0.4 M | 1 (cage mesh alpha) | 1 |
| **sub bay** (boat, cradle, galleries, 3 soldiers + 3 husks + 2 skitters + sentry, beacons) | ≤ 270 | ≤ 80 | ≤ 0.8 M | 2 (grating, lock port) | 1 |
| tunnel (+ sub bay through the door) | ≤ 180 | ≤ 50 | ≤ 0.45 M | 1 | 1 |

Sub-bay rules that make the 270 possible: the galleries, rails, parapets and stair stringers are merged per side (≤ 8
calls), grating is one alpha-tested material per deck, the boat ≤ 12 calls, crates instanced (≤ 3), the cradle 1, rails 1;
enemies beyond 12 m on LOD1; enemy shadows only for LOD0 within 15 m.

### 2.8 Sight lines through glass, grating and openings (every one)

| pane / opening | geometry | from | must see | must not see |
|---|---|---|---|---|
| booth glass | x 2.4, z −4.0 … −0.2, y 1.0 … 2.4 | gatehouse | mug, fan, `gate_log` screen, Aas's palm plate (`aas_palm`) | the booth's east door, solid behind |
| frosted cold-room window | x 37.78, z 0 … 2, y 1 … 2 | galley | a soft lit blur; the oilskin's shape moving (`v5_galley_shape`) | anything sharp |
| command-module port | ⌀ 0.25 at (43.8, 1.62, −16.0), 0.2 m thick armoured, yellowed | spine at the line | warm light, a moving silhouette (Kessler, a 2-D card + parallax, never a face) | a room interior |
| launch-lock port | ⌀ 0.6 at (34, 2.2, −55.9) | sub bay floor | black water, slow particles (cheap viewport) | proxy edges |
| spine grating | y 0, x 16.4 … 36.2 | crawl (looking up) | spine lights as bars, boots, the patrol's weapon light, a Clasp LED halo | — (bullets and sight blocked) |
| spine grating | same | spine (looking down) | darkness, the red strips below, a hand on the stair (flashlight) | the magazine |
| `d5_bay` (open) | z −18, x 32.4 … 35.6 | spine | the boat's sail, the beacon light after V | the lock port's water |
| galleries / bridge grating | y 4.8 | sub bay floor | silhouettes, LEDs, weapon lights overhead | — |

Shots on the booth glass and the module port: stars, hold (3b glass star). Interactables behind glass are not usable
through it (R8): the booth's monitor is not an interactable; the module door has none.

### 2.9 Fx volumes and water (D23)

| id | owner / how | box (world) | enclosed by | `rooms` / `seenFrom` |
|---|---|---|---|---|
| `fx5_drips_sub` | `fx.emitter('drip', …, { bounds })` × 6 on hull seams (x 22.3 / 45.7, z −24/−38/−50; y 8 → floor) | sub5 interior | sub walls | sub5 / spine5, arm5 |
| `fx5_drips_crawl` | × 3 (x 20 / 28 / 34, y −0.1 → −1.4) | crawl boxes | crawl | spine5 (crawl) / — |
| `fx5_drips_mag` | × 2 (x 15.0 / 20.0, z −26, y −0.2 → −2.6) | magazine box | magazine | arm5 (magazine) / — |
| `fx5_lock_water` | `fx.viewport({ cheap: true, state: 'dark' })` | proxy x 31.0 … 37.0, y −1 … 5, z −62 … −56.4 | void; the 0.6 m port | sub5 / — |
| `fx5_taps` | 4 short water streams (emitter, `bounds`) during `v5_water` | heads5 sinks | heads | heads5 / berths5 |
| `fx5_galley_mist` | cold-room mist behind the frosted window (`fx.fog`, box x 37.8 … 39.0, y 0 … 2.2, z −0.2 … 2.2) | the cold room box | window | galley5 / mess5 |

**Wet floors within budget:** no screen-space reflection. Puddles = `water_stain` decals plus a `wet_steel` overlay
material (W5: roughness 0.06, metalness 0.2, its own normal ripple, lit by the room's reflection probe) on flat patches
(sub bay ≤ 8 patches, crawl, magazine corner, heads); cost = one extra material per room, 0 lights. Footsteps on wet
patches use the `wet` footstep variant (audio, §8.11).

---

## 3. Phases (`src/level/l5/phases.ts`; the story calls `applyPhase` only)

States as `level/phases.ts` (`auto | open | shut | locked | cycling | dark | oneway`). Blank = as the previous column.

| door | A arrival | B gatehouse | B2 gate shut | C scene | D0 hand-back | D duty | K keypad live | S post 4 | V verified | W tunnel released | X sealed | nostory |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| d5_gate | shut → open (0.4 … 2.8 s) | open | locked (latched) | | | | | | | | | open |
| d5_duty | locked | | | open (scene) | auto | | | | | | | auto |
| d5_ready | locked | | | open → shut (scene) | locked | auto (opened at +2.5 s) | | | | | | auto |
| d5_key | locked (panel `dark`) | | | | | | locked (panel live) | auto | | | | auto |
| d5_berth, d5_mess, d5_berth_mess, d5_heads, d5_galley, d5_arm, d5_arm_bay, d5_bay | auto | | | | | | | | | | | auto |
| d5_dive | locked | | | | | | | locked (S_dive: open) | | | | locked |
| d5_lockside | locked | | | | | | | | locked (V_lock: open) | | | locked |
| d5_tunnel | locked | | | | | | | | cycling (`Hydraulics isolated — gallery wheel`) | auto | locked (latched) | auto |

Machines: `tern` (boat idle hum, nav lights) active every phase; `wheel5` off until pulled. Variants without player
checks: `S_dive`, `V_lock`, `W_lock`.

Regions: every room id; `crawl`, `magazine`, `booth`, `cmd`, `outside`, `voids`. `ALWAYS5 = booth, cmd, outside, voids`.
`dive5` and `lockacc5` are forbidden until their variant, neither forbidden nor goal after.

| phase | label | start (feet) | forbid (+ ALWAYS5) | goal | use (usable) | must not be usable |
|---|---|---|---|---|---|---|
| A | arrival (`cp5_start`) | (0, 0, 3.0) | every room but lock5 | lock5 | — | — |
| B | gatehouse | (0, 0, −3.0) | duty5 and beyond, crawl, magazine | lock5, gate5 | `note5_visitors`, `p5_gate_med` | `key5_duty`, `note5_watch` |
| B2 | gate shut | (0, 0, −6.0) | lock5, duty5 and beyond | gate5 | as B | as B |
| C | scene | (0, 0, −12.4) | every room but gate5, duty5 | — | — | — |
| D | duty (`cp5_duty`, `cp5_ready`) | (0.4, 0, −13.8) | lock5, spine5 and beyond, crawl, magazine, dive5, lockacc5, tunnel5 | gate5, duty5, ready5 | `note5_watch`, `note5_roster`, `note5_locker`, `p5_duty_ammo`, `p5_ready_med`, `p5_ready_ammo` | `key5_duty` (dark: no UI) |
| K | keypad live (`cp5_radio`) | (2.0, 0, −16.0) (clear of the watch desk, S1f) | as D | as D | `key5_duty`, D's pickups | `hatch5_spine` |
| S | post 4 (`cp5_spine`) | (10.0, 0, −16.0) | lock5, dive5, lockacc5, tunnel5 | gate5 … ready5, spine5, berths5, heads5, mess5, galley5, arm5, sub5 (both decks), crawl, magazine | `hatch5_spine`, `hatch5_mag` (from below only), `launch5_palm` (refuses), every readable, **every `p5_*` of §5.2 in these rooms incl. the magazine's** (S1i: each pickup reachable within its 2.2 m radius) | `wheel5` (disabled), `hatch5_mag` from above |
| V | verified (`cp5_door`, `cp5_bay`) | (41.0, 0, −16.0) | lock5, lockacc5, tunnel5 | S goals | `wheel5`, `p5_bay_*`, `p5_wheel_*`, `p5_dive_shells` | — |
| W | tunnel released | (24.0, 4.8, −51.0) | lock5, lockacc5 | tunnel5, sub5 | `p5_tunnel_med` | — |
| X | sealed | (18.0, 0, −53.0) | every room but tunnel5 | tunnel5 | — | — |

`stressFloors`: A … K `[0]`; S, V `[−2.6, −1.4, 0, 4.8]`; W `[0, 4.8]`; X `[0]`. **One-way** (`reachHints.oneway`):
`hatch5_mag` (magazine → armoury only); the crawl is two-way through the spine hatch. **New check field** (W4, `check-reach`):
`mustNotUse: string[]` — the flood fill reports any listed interactable whose use point is within its radius of a reachable
capsule **with line of sight** from that capsule's eye (R8 made testable).

Transitions: A→B gate open (2.8 s); B→B2 gate latch; B2→C `t5_dutydoor`; C→D0 hand-back; D0→D +2.5 s; D→K `l5_kes_4`
end (power cue, S2); K→S code accepted; S→V neck check complete + `l5_kes_door_7` start; V→W wheel done + 4 s; W→X tunnel
latch.

Latches (`closeBehind(door, keepSide)`):

| door | armed by | phase | keepSide (feet) | on fail |
|---|---|---|---|---|
| `d5_gate` | `t5_gate` | B | z < −0.6 | reopen (gate rises), re-arm; panel `CLEAR THE GATE` |
| `d5_dive` (after spawn) | last `g5_spine` member at x < 45.6, or 10 s | S_dive | player x < 45.6 | stays open, retries every 2 s |
| `d5_lockside` (after spawn) | last member of the wave at z > −55.6, or 10 s | V_lock / W_lock | player z > −55.6 | stays open, retries every 2 s |
| `d5_tunnel` | `t5_tunnel` | W | x < 21.6 | reopen, re-arm |

`nostory`: every door `auto` except `d5_dive`, `d5_lockside` (locked); lights lit; hatches closed; no actors.
`regions.dark` is a region list for the soldier and `check:dark` only: `check:reach` ignores it (neither goal nor forbid).

---

## 4. Scripted beats — timings tied to line durations

`dur(id)` = `VoiceHandle.duration` (manifest, lead skipped); "+g" = gap after the line ends. Every timed line starts
within 0.12 s of its cue (§8.13). Every position below is a marker (§8.10).

### 4.1 Arrival (A → B → B2)

| t | event |
|---|---|
| 0.0 | `l5_start`; phase A; fade in 0.8 s; objective `Find the navy — Post 4`; `gate_panel5` `AUTHORISED: AAS, L. (LT.) — PALM — LIVE` (3b's last state) |
| 0.4 | `d5_gate` opens: the leaf rises 2.4 s (`gate_open_heavy` — **the door's own sound**; the door also owns `gate_close_heavy`, S1o); vignette `gate5_open` only drives the (already retracted) dogs and the panel |
| 1.2 | vignette `gate5_booth`: the booth's back door settles shut (`booth_door_shut`, level-owned); no figure |
| 2.8 | phase B (`d5_gate` open); **`cp5_start`** |
| `t5_turnstile` (B/B2) | `v5_turnstile` (§5.5) |
| `t5_gate` (B) | `closeBehind('d5_gate', z < −0.6)`; on success the leaf descends 2.4 s (`gate_close_heavy`, the door's own sound), panel `GATE 4 — CLOSED — TUBE CYCLE`, `l5_unit_gate` (U, at `mk5_gate_panel`); phase B2 |

### 4.2 The cutscene "Under control" (B2 → C → D0), first person, ≤ 25 s

Precondition (7.1, S2): phase B2 (gate latched); **no awake hostile, none hunting, none in gate5 / duty5 / ready5** (only `g5_mag` exists, dormant, far below the armoury); lines `l5_reyes_c1_*`, `l5_sol_c1_*`
decoded (`linesReady(ids, 1.5)` — preloaded from level start, 20 s timeout). The trigger is `t5_dutydoor` **polled every frame** in B2 (feet within 1.8 m of the closed duty door; a player who
reached it before the gate shut starts the scene the moment B2 applies). If the lines are not ready the scene waits ≤ 1.5 s with the player held in place
(`cinematic(true)` but camera free) — never longer.

Cast: the soldier **actor** `enemies.actor('soldier', mk5_c1_sol, yaw +π/2, 'hold', { name: 'BREKKE' })` — created on the
scene's first frame (the door is shut until then; nothing visible), removed at hand-back behind the shut ready door.
Markers: `mk5_c1_cam0` (0, 1.65, −8.6), `mk5_c1_cam1` (0.4, 1.65, −13.8), `mk5_c1_sol` (−3.6, 0, −19.2), `mk5_c1_door`
(−4.0, 0, −21.4), `mk5_c1_out` (−4.0, 0, −23.2), `mk5_c1_end` (0.4, 0, −13.8). Distances: camera end → soldier 6.7 m
(in-person speech: ≥ −3 dB of the reference by §8.13), camera end → ready door 9.3 m (≥ 8 m for the units, 7.1).

Times, nominal durations in brackets (real values from the manifest; the schedule is recomputed from them):

| cue | t (nominal) | camera (shot) | world / actor | line |
|---|---|---|---|---|
| S1 | 0.00 | taken; eye blends from the player's eye to `cam0` over 0.6 s, look door centre (0, 1.5, −10), fov 72 | `d5_duty` opens at 0.20 (0.85 s, the door's sound) | — |
| S2 | 0.60 | dolly `cam0` → `cam1` over 3.0 s (`linear`, 1.7 m/s), look = actor head (live), fov 72 → 60 | 1.00 head turns to the camera (pinned to `cut.eye`); 1.50 body turns on the spot to face it (0.8 s) | — |
| T1 | 2.20 | | | `l5_reyes_c1_1` "Navy. Thank God." [1.3] (Reyes, 2-D) |
| T2 | T1 + d + 0.35 = 3.85 | S3 hold at `cam1`, look head, fov 60 → 52 over the whole shot, sway 0.6 | stillness: no idle sway, breathing only | `l5_reyes_c1_2` [3.4] |
| T3 | T2 + d + 0.30 = 7.55 | | | `l5_reyes_c1_3` "I need your commander. Now." [1.6] |
| T4 | T3 + d + 1.20 = 10.35 | | 1.2 s of nothing — he only looks; head tilts 4° at T3 + d + 0.6 | `l5_reyes_c1_4` "Are you listening to me?" [1.4] |
| T5 | T4 + d + 0.90 = 12.65 | | `speak(dur)` head micro-motion (no jaw: balaclava) | `l5_sol_c1_1_<choice>` [2.4] (throat fx, at his head) |
| T6 | T5 + d + 0.50 = 15.55 | | | `l5_sol_c1_2` "Put the weapon down." [1.3] |
| T7 | T6 + d + 0.60 = 17.45 | S4 look → actor nape (live), fov 52 → 30 over 1.2 s from T7 + 0.3 (`inOut`) | turns away toward `mk5_c1_door` (1.0 s): his back faces the camera within 11° | — |
| T8 | T7 + 1.60 = 19.05 | hold on the nape: the Clasp's `mark()` blinks red (1 Hz, 0.12 s on; 4 cm halo = 12 px at 1080p, 8 px at 720p, at 6.7 m / 30°) — two blinks in view | | — |
| T9 | T8 + 1.60 = 20.65 | S5 look → actor chest (live), fov 30 → 60 over 0.8 s | `d5_ready` opens (0.85 s); at T9 + 0.3 he walks `mk5_c1_sol` → `mk5_c1_door` → `mk5_c1_out` at 1.4 m/s (4.0 m; upright, unhurried) | at T9 + 1.0: `l5_reyes_c1_5` "Wait—" [0.5] |
| T10 | T9 + 2.30 = 22.95 | | he is 0.6 m past the door plane (2.83 m walked); `d5_ready` closes (0.85 s); he walks on to `mk5_c1_out` unseen | — |
| H | T10 + 0.30 = 23.25 | **hand-back** (continuous, `handback: true`): eye at `cam1`, yaw toward `mk5_c1_door`, weapon raised from lowered (0.34 s), loaded (`topUp`) | phase D0; actor removed (behind the shut door); `g5_s1` spawned with `spawnGroup` (not `engage`, B1) at its marker in `hold`; **`cp5_duty`** saved at once | — |

Cap: if the measured lines push H past 25.0 s, the gaps after T3 and T6 shrink first (to 0.6 / 0.3), then the T8 hold
(to 1.2 s); `play:l5` asserts H ≤ 25.0. Skippable only once seen (cutscene module rule); the skip applies the same end
state. Shots never let the camera pass through the door leaf (the dolly crosses z −10 at t ≈ 1.41 s; the door is fully
open at 1.05 s).

After hand-back (D0, in control):

| t after H | event |
|---|---|
| 0.0 | objective `Survive`; `g5_duty` spawned **inside ready5 behind the shut door** at `mk5_duty_u1/u2` (hidden, spawn-visibility rule satisfied: door shut) — spawned at H + 1.5 |
| 2.5 | phase D: `d5_ready` opens (the door's own sound); `rush('g5_duty', 20)`; the two units walk in (run after 2 m) — 9.3 m from the player's placement; `g5_s1` stands in `hold` at the far end of the ready room, weapon low (he is **not** in sight from the hand-back placement — S1l: the ray through the door meets locker row L1; he is seen once the player stands in line with the door, ≈ x −4 … −2, z ≤ −18) |
| `g5_duty` dead + 1.5 s, calm (the level-5 `calm()` ignores a group still in `hold`, B1) | **`cp5_ready`** (if `g5_s1` is still holding); objective `The ready room` |

### 4.3 The first soldier (D)

`g5_s1` (`hold`): stands at `mk5_s1` (−4.0, 0, −36.6) facing north, pistol low, head tracking the player whenever it has
sight (it does not fire in `hold`; it reports `state 'idle'`, not hunting, awake). The story calls `enemies.release('g5_s1')`
(→ normal soldier AI, §8.2; flag `s1Free`; only now does `g5_s1` enter `prog.triggered`) on the first of: the player enters
`t5_ready` (feet past z −24.0); it takes damage or a player bullet passes/impacts within 1.5 m of it; `g5_duty` dead +
20 s with the player in duty5 or ready5; 45 s after H (a passive player is fought, not waited out — R1). The soldier
module also releases itself on damage / a near miss / sight within 6 m (§8.2.4) and the story mirrors that in `s1Free`. One
throat line when it leaves `hold` with sight of the player: `l5_sol_down_<choice>` (C, §6.2).

On its death (`enemy:died`, group `g5_s1`): `enemies.corpsePoint(id, 'chest')` gives the radio point `mk5_radio` = the
chest's x/z at `max(chest.y, wreckBox.max.y + 0.08)` (B2; followed each frame until the death animation ends, then fixed);
the radio's green LED stays lit; interactable `radio5` `Take radio` (radius 1.6, enabled only with a clear ray from the eye
**ignoring the owner's own wreck box** — R8). **Checkpoints (B1):** `afterReplay` re-spawns `g5_s1` in `hold` at
`mk5_s1` whenever the flag `radio` is false — this covers `cp5_duty`, `cp5_ready`, and "killed him, died before taking the
radio" (he stands again; the radio comes with him).
Pistol rounds `ammo_pistol` 8 are collected on touch (soldier module, §8.2.7).

| when | event |
|---|---|
| death + 30 s, radio not taken | `radio_squawk` (story) + `l5_kes_squawk_1` at `mk5_radio` (fx `radio`, positional, ref 2 m); objective `Take the radio` |
| then every 25 s (4 ×), then every 40 s | `l5_kes_squawk_1` / `_2` alternately (`_2` only when the player is within 12 m of the radio and in duty5 or ready5 — both have a camera, S6) |
| `radio5` used | toast `Radio`; HUD radio strip on (`ui.radio({ label: 'POST 4 — CMD — CH 1', live })`); fact `radio`; phase stays D; **the pickup sequence** (§4.4) |

### 4.4 Kessler on the radio (D → K)

Radio priority `scene` (not cut by barks); the player is free (no camera taken). Lines 2-D through `radio` fx; Reyes's
answers 2-D `clean`. Kessler's lines are never paused for combat (a radio), but a CHOIR bark never overlaps them.

| cue | line | effect |
|---|---|---|
| 0.4 s after the take | `l5_kes_1` | |
| +g 0.5 | `l5_reyes_r1` | |
| +g 0.6 | `l5_kes_2` | |
| +g 0.5 | `l5_kes_3` | |
| +g 0.7 | `l5_kes_4` (the code) | **at its end: power cue** (S2) — `key5_duty` panel lights (`keypad_power_on`, level vignette `key5_power`), screen `keypad` `ENTER CODE`; phase K; prompt `Use keypad`; **Q enabled** (toast `Q — radio Kessler`); objective `Open the spine door — keypad`; `cp5_radio` armed (taken now when calm, else at the next calm moment in duty5/ready5 while in K) |
| +g 0.8 | `l5_kes_5` | |
| +g 0.4 | `l5_kes_6` → stopped at its `cut` (just after "every metre of") | |
| at the cut (−0.05 s overlap) | `l5_choir_radio` (fx `radio:1`) | |
| +g 0.9 | `l5_kes_7` | |
| +g 0.5 | `l5_reyes_r2` | |
| +g 0.6 | `l5_kes_8` | |
| +g 0.5 | `l5_kes_9` — or **`l5_kes_9b`** if the code was already accepted (R3, S2) | sequence done |
| `_9` end + 6 s, calm, once | `l5_kes_brekke` (C: radio taken from `g5_s1`'s body — always true here) | |

The sequence holds `scene` priority; `l5_kes_contact` and other Kessler C-lines queue behind it (S7). `v5_hull_groan` (no
voice) is allowed to run over the sequence's gaps (§5.5).

### 4.5 The keypad (K → S)

`key5_duty` interact (`Use keypad`, radius 1.2, duty side only): before K the prompt is `Keypad — no power`, pressing it
plays `keypad_dead` (UI) and does **not** open the UI. In K it opens `ui.keypad({ digits: 4, title: 'SPINE — AUTHORISED
ACCESS' })` (§8.5). Entered `4719` → `keypad_ok`, panel `ACCEPTED`, phase S (`d5_key` auto), beat `l5_keypad`,
`l5_choir_key` (C: once, radio, ≤ 2 s after), objective `Kessler's door — the end of the spine`. Wrong code →
`keypad_err`, panel `CODE REJECTED` 1.2 s; after the first wrong code toast `Q — ask Kessler for the code`; after three
wrong codes the objective adds the code (`Open the spine door — 4719`). No lockout.

### 4.6 Post 4 (S): the spine wave, quarters, crawl

| when | event |
|---|---|
| first `t5_spine_mid` (S), or 45 s in S outside crawl/magazine, or first `t5_bay` in S, **or first `t5_cmd` in S if it never spawned** (S2: the loop via the mess skips `t5_spine_mid`) | beat `l5_spine_wave`: `g5_spine` spawned in the sealed dive locker; +0.4 s S_dive (`d5_dive` opens); `rush('g5_spine', 30)`; the soldier walks; path dive → sub bay → `d5_bay` → spine (≈ 30 m: husks ≈ 8 s, soldier ≈ 19 s); `l5_kes_contact` (C) |
| last `g5_spine` member x < 45.6 or 10 s | `closeBehind('d5_dive', x < 45.6)` |
| `g5_spine` dead + 1.5 s, calm, player in spine5/berths5/heads5/mess5/galley5/arm5/sub5 (not crawl/magazine) | **`cp5_spine`** |
| `hatch5_spine` used (S+) | vignette `hatch5_spine_open` (lid swings up 1.2 s; `hatch_unlatch` + `hatch_open` — the vignette's); stays open; toast `Crouch — C` when the player reaches the landing (`t5_landing`) standing |
| first `t5_crawl_e` + 2.0 s, calm | `v5_boots` (§5.5): the patrol stops above `x = clamp(playerX + 1, 18, 34)` (S2: ahead of a player crawling west) |
| `t5_mag` | `g5_mag` rules (§5.1); `v5_magazine` |
| `hatch5_mag` used from below | vignette `hatch5_mag_open` (lid up, `hatch_unlatch`, `hatch_open`); stays open; the armoury side plate light turns green |
| Q from the power cue on (cooldown 5 s; ignored while the keypad or a note is open) | `l5_kes_ack` then the context line (§6.2: code until S; door until V; wheel until W; tunnel in W; `l5_kes_busy` while hostiles are awake within 25 m; **during the door check: `_3` or `door_hold` per the facing rule**, S2) |
| `launch5_palm` pressed (S+) | `player.palm()` 1.6 s → refused at the end: palm screen `NOT ROSTERED — REYES, S.`, `l5_unit_launch_refused` (U, cooldown 6), fact `l5_boat`; `l5_kes_boat` (C) |
| `d5_tunnel` denied | S: `l5_unit_tunnel_co` (U, cooldown 10) + objective unchanged; V: `l5_unit_tunnel_hyd` |

### 4.7 Kessler's door (S → V), interactive

Region `t5_cmd`. The beat starts on the first frame the player is in `t5_cmd` in phase S **and** `g5_spine` has been
fought (if it never spawned, entering `t5_cmd` spawns it at once and plays `l5_kes_door_wait`) **and** door-calm: no hostile
awake or holding **that is in `spine5` or has a nav path ≤ 30 m to the line** (S2; a holding patrol at the door counts,
a soldier searching in the far sub bay does not). Not calm → `l5_kes_door_wait` (C, cooldown 20 s); the beat starts at
the next door-calm frame there. **Stray rule** (level-wide, during any calm wait — the door, checkpoints, scares): an
awake hostile unseen ≥ 30 s and ≥ 25 m away is removed silently (3b's stranded rule used outside `fightOutWhere`).

| cue | line / event |
|---|---|
| start | `l5_kes_door_1`; the yellow line pulses (vignette `cmd5_line`); the door camera's tally goes from red to amber (it watches) |
| +g 0.5 | `l5_kes_door_2`; objective `Stand on the yellow line — turn your back to the door` |
| `_2` end + 0.6, or later when the player stands in `t5_cmd_line` | the **check** runs (B3): feet in `t5_cmd_line` **and the horizontal yaw within ±50° of −x** (facing down the spine, back to the door; pitch ignored) for **1.2 s** continuous. The line said depends on the facing at that moment: yaw within ±90° of +x (facing the door) → `l5_kes_door_3` "Turn around."; otherwise → `l5_kes_door_hold` "Stay like that.". **Feedback while the 1.2 s count runs:** the door camera's tally goes amber → white and `cmd5_port_look` starts (the silhouette moves close behind the port); both stop and the count resets the moment the condition breaks |
| not done 8 s after the first line | `l5_kes_door_3b` (cooldown 8 s; only while facing the door, else `door_hold` again); leaving `t5_cmd_line` mid-check → `l5_kes_door_away` (cooldown 10) |
| check done | `l5_kes_door_4`; fact `l5_door`; beat `l5_verified` |
| +g 0.7 | `l5_kes_door_5` |
| +g 0.5 | `l5_kes_door_6` |
| +g 0.8 | `l5_kes_door_sunde` |
| +g 0.6 | `l5_kes_door_7`: at its start phase V (`d5_tunnel` → cycling, its panel `CO RELEASE — HYDRAULICS ISOLATED ↑`), objective `The gallery wheel — sub bay, west side` |
| `_7` end + 0.4 | `l5_choir_door_<choice>` (fx `radio:1`) |
| CHOIR end + 0.3 = **L** | beat `l5_dark`: `lights_out5` (vignette): spine5 and sub5 mains off over 1.2 s, a breaker thunk travelling from the sub bay to the spine (`lights_out_dock`), `*_emerg` on, beacons start (`alarm_beacon`); `dark5_on` (regions.dark extended); ambience → `amb_dark` |
| L + 1.0 | `l5_kes_dark` |
| L + 1.5 | **`cp5_door`** (state V, dark; nothing hostile yet) |
| L + 3.0 | `g5_cmd`: `vent5_spine` drops its grille (vignette) + 0.4 s `spawnGroup` skitters (≥ 4 m from the player — the vent is 11 m from the line; if the player stands within 4 m of it, wait ≤ 4 s for ≥ 4 m, else skip the skitters); the soldier of `g5_cmd` spawns in the sealed launch-lock access (V_lock) and walks north through the sub bay toward the spine |

The door never opens; shooting it, the port or the camera: sparks/stars, no reaction except `l5_kes_shot` once (C).

### 4.8 The sub bay in the dark (V → W → X)

| when | event |
|---|---|
| first `t5_bay` in V (or `g5_cmd`'s soldier reaches the sub bay's north half while the player is there) | beat `l5_bay`: `g5_bay_a` spawned in lockacc5; +0.4 s V_lock (`d5_lockside` opens); `rush('g5_bay_a', 30)` (husks); soldiers take cover sets `floor` / `gallery_e`; `l5_kes_bay` (C) |
| last member out or 10 s | `closeBehind('d5_lockside', z > −55.6)` |
| `g5_bay_a` + `g5_cmd` dead (or removed as stranded) + 1.5 s, calm, player in sub5/spine5/arm5 | **`cp5_bay`** (V or W as found) |
| `wheel5` used (V, from the west gallery) | beat `l5_wheel`: vignette `wheel5_turn` (the wheel spins 4.0 s on a fixed clock, `wheel_crank` + `hydraulic_release` — the vignette's); `g5_bay_b`: the dock sentry wakes (+0.5 s), drains `drain5_a`/`_b` lift (+1.0 s) and their skitters spawn (+0.4 s each), one husk from lockacc5 (W_lock: `d5_lockside` opens at +1.5 s); `rush('g5_bay_b', 30)` |
| wheel + 4.0 s | `l5_unit_wheel`; phase W (`d5_tunnel` auto, opens on approach; panel `OPEN`); objective `The trunk tunnel — floor level, south-west` |
| `l5_unit_wheel` end + 0.4 | `l5_kes_tunnel` (C, S7) |
| `t5_tunnel` (W) | `closeBehind('d5_tunnel', x < 21.6)` → beat `l5_tunnel`, phase X |
| X | `fightOutWhere('tunnel5', 60)` |
| then + 0.6 | `l5_kes_end` |
| `_end` end + 0.5 | `l5_choir_end_<choice>` (fx `radio:1`) |
| CHOIR end + 0.8 (cap 8 s after X) | beat `l5_end`: fade, carry, end card (§7) |

The sub bay, the wheel and the tunnel never wait on an enemy: the wheel is usable while the wave is alive; the tunnel
opens on the wheel's fixed clock; the end waits only for hostiles inside the tunnel (stranded rule: unseen ≥ 30 m for 60 s
→ removed).

---

## 5. Encounters, pickups, economy, cover, scares

### 5.1 Enemy groups

Soldier spawn data (contract, K): `EnemySpawn.arms?: 'pistol' | 'carbine'`, `EnemySpawn.cover?: string` (preferred
cover set), pose `hold`. Husks are `navy` skin.

| group | contents | mode | where (feet), yaw | trigger | why |
|---|---|---|---|---|---|
| `g5_duty` | 2 husks `navy` | spawn | `mk5_duty_u1` (−5.0, 0, −23.6), `mk5_duty_u2` (−3.0, 0, −23.6), yaw π | H + 1.5 (hidden), door at H + 2.5, `rush` 20 s | 7.1: two units walk in |
| `g5_s1` | 1 soldier, pistol, cover set `ready` | spawn (`spawnGroup`, B1), pose `hold`; released by the story | `mk5_s1` (−4.0, 0, −36.6), yaw π | H (behind the shut door, 13.4 m from it) | the first gunfight; the radio |
| `g5_spine` | 1 soldier pistol (set `spine`) + 2 husks `navy` | spawn | soldier (48.0, 0, −34.0) (clear of the chamber, S1g); husks (48.0, 0, −31.0), (50.0, 0, −31.0); yaw +π/2 (−x) | §4.6 | first mixed fight, in a 36 m corridor (aimed carbine at 15–30 m) |
| `g5_patrol` | 1 soldier carbine (set `spine`) | spawn (`spawnGroup`), weapon light on while walking (`setLight(true)`), pose `hold` at its end; absent after any load (B1) | (34.0, 0, −20.0) in the sub bay, yaw 0 → walks through `d5_bay` | `v5_boots` only | the boots; optional (never exists unless the crawl beat fires) |
| `g5_mag` | 1 husk `navy` | dormant `slumped` (story wake rules) | (15.85, −2.6, −26.0) against the west rack's east face (rack x 14.4 … 15.4), yaw −π/2 (faces +x, into the aisle x 15.4 … 18.6) | first of: player within 2.2 m; any `p5_mag_*` taken; a shot within 10 m; flashlight on its head 1.5 s; 25 s in `t5_mag`. 0.8 s after `bulb_pop` | the thing down there; optional |
| `g5_cmd` | 2 skitters + 1 soldier carbine (set `floor` → `spine`) | spawn | skitters at `vent5_spine` beside the opening, under the solid ceiling: (29.4, 3.1, −16.0), (30.6, 3.1, −16.0) (ceiling 3.2, emerge up-ray hits it at 0.1 m); soldier (42.0, 0, −60.0), yaw 0 | L + 3.0 (§4.7) | CHOIR's answer; skitters glow in the dark spine |
| `g5_bay_a` | 2 soldiers carbine (sets `floor`, `gallery_e`) + 2 husks `navy` | spawn | soldiers (40.0, 0, −60.0), (44.0, 0, −60.0); husks (41.0, 0, −57.6), (43.0, 0, −57.6); yaw 0 | §4.8 | the climax, in the dark |
| `g5_bay_b` | 1 sentry `navy` + 2 skitters + 1 husk `navy` | sentry dormant `ceiling` (34.0, 9.0, −45.0); skitters spawn emerge from the drains (28.0, −0.3, −48.0), (39.0, −0.3, −36.5); husk spawn (42.0, 0, −58.0) | `wheel5` (§4.8) | pressure while the clock runs |

Totals: **5 soldiers** (+1 optional patrol), **7 husks** (+1 optional), **4 skitters**, **1 sentry**. Waits on
enemies: only the end (inside `tunnel5`). Stranded fallback as 3b (unseen ≥ 30 m for 60 s → removed). `rush` for every
husk group; soldiers are never rushed (D26).

### 5.2 Pickups

| id | kind | amount | where |
|---|---|---|---|
| `p5_gate_med` | medkit | 35 | (5.4, 1.0, −6.0) |
| `p5_duty_ammo` | ammo_pistol | 12 | (7.5, 1.2, −11.0) |
| `p5_ready_med` | medkit | 35 | (3.4, 1.0, −23.0) |
| `p5_ready_ammo` | ammo_carbine | 30 | (−11.4, 1.0, −30.0) |
| (drop) `g5_s1` | ammo_pistol | 8 | on its body (touch) |
| `p5_berth_med` | medkit | 35 | (23.4, 0.7, −3.0) |
| `p5_berth_shells` | ammo_shotgun | 6 | (13.8, 0.7, −2.9) (bunk-end shelf, S1i) |
| `p5_mess_ammo` | ammo_carbine | 30 | (37.4, 1.0, −13.4) |
| `p5_galley_med` | medkit | 35 | (28.6, 1.0, 3.4) |
| `p5_arm_vest` | vest (E, "Put on vest") | 50 | (21.4, 1.4, −19.4) |
| `p5_arm_carbine` | carbine | 30 | (14.45, 1.3, −20.6) (the one carbine left in the 23-slot rack) |
| `p5_arm_ammo_1`, `_2` | ammo_carbine | 30 each | (14.6, 1.0, −22.0), (14.6, 1.0, −22.5) |
| `p5_arm_shells` | ammo_shotgun | 12 | (14.6, 1.0, −24.0) |
| `p5_arm_plate` | plate | 15 | (14.6, 0.4, −25.0) |
| `p5_mag_ammo_1 … _3` | ammo_carbine | 30 each | (18.5, −1.8, −23.0), (18.5, −1.8, −23.6), (18.5, −1.8, −24.2) (east rack face, S1i) |
| `p5_mag_pistol` | ammo_pistol | 24 | (15.5, −1.8, −23.0) (west rack face) |
| `p5_mag_plate_1`, `_2` | plate | 15 each | (17.0, −2.2, −27.4), (17.6, −2.2, −27.4) |
| `p5_mag_med` | medkit | 35 | (15.5, −1.8, −24.0) |
| `p5_spine_ammo` | ammo_carbine | 30 | (43.4, 1.0, −14.6) |
| (drop) each carbine soldier | ammo_carbine 15 — **or the carbine itself (30 rounds) if the player owns none** (S6) | | on its body (touch) |
| (drop) `g5_spine` soldier | ammo_pistol | 8 | on its body |
| `p5_bay_med_1`, `p5_bay_ammo_1` | medkit 35, ammo_carbine 30 | | (24.0, 1.0, −22.0), (24.4, 1.0, −22.0) (locker by `d5_arm_bay`) |
| `p5_wheel_plate`, `p5_wheel_ammo` | plate 15, ammo_carbine 30 | | (22.6, 5.6, −50.6), (22.6, 5.6, −51.0) (gallery locker by the wheel) |
| `p5_bay_med_2` | medkit | 35 | (44.6, 1.0, −50.0) |
| `p5_dive_shells` | ammo_shotgun | 6 | (51.4, 1.0, −29.0) (S1h) |
| `p5_tunnel_med` | medkit | 35 | (21.0, 1.0, −50.6) |

### 5.3 Economy and TTK (player weapons as built: pistol 20, shotgun 9 × 9, carbine 18 ×0.8 beyond 40 m)

| enemy | HP | head / limb | pistol hits (body / head) | shotgun ≤ 6 m | carbine body / time | carbine head / time |
|---|---|---|---|---|---|---|
| soldier | 100 | ×2.0 / ×0.7; **torso ×0.8** (plate carrier, S3) | 7 / 3 | 2 shells | 7 / 0.6 s | 3 / 0.2 s (aimed at 20 m: mean spread 0.8 cm as built — head shots are a skill, not luck) |
| husk | 90 | ×2 / ×0.7 | 5 / 3 | 1–2 | 5 / 0.4 s | 3 / 0.2 s |
| skitter | 18 | | 1 | 1 | 1 | — |
| sentry | 60 | | 3 | 1 | 4 / 0.3 s | — |

Soldier fire at the player (§8.2.5, the S3 table): pistol 9 per hit, carbine 7 per hit; hit chance by range 0.75 (≤ 8 m)
→ 0.55 (15 m) → 0.35 (25 m) → 0.20 (35 m), × modifiers; aim 0.45 s; a burst is cancelled only by a hit ≥ 25 or to the
head. Expected damage per second from **one** soldier in the open: pistol at 15 m ≈ 4.5/s, carbine at 20 m ≈ 4.0/s; two
carbine soldiers at 20 m ≈ 8/s; the 18/s cap stays as a guard. With 50 armour the first 75 points of incoming damage cost
25 health. A still player in the open against the two bay soldiers loses 100 health in ≈ 12 s (≈ 18 s with a vest). A
lone soldier ignored is a real threat; aimed fire beats him (the 0.6 s carbine kill fits inside his 0.45 s aim + rise
only if the player starts first — which the tells allow). Confirmed or retuned at the soldier-in-motion review after
W3a + W3b (coordinator 2).

HP to clear (main route): 5 soldiers 500 + 7 husks 630 + 4 skitters 72 + sentry 60 = **1,262 HP** ≈ 70 carbine hits ≈
140 rounds at 50 %. Carbine rounds on the main route: ready 30 + mess 30 + armoury 60 + spine 30 + bay 30 + wheel 30 +
drops 4 × 15 = **270** (+ the carry, 3b gave 180; + magazine 90). Deliberately generous: this is the gunfight stage, and
the cap (180 reserve) keeps it from piling up. Pistol: 12 + 8 + 8 (+ 24 magazine) on top of the carry. A player who skipped
the carbine in 3b finds `p5_arm_carbine` (the direct start always has one, §7). Medkits 8 × 35 (+1 magazine);
armour: vest 50 + 3 plates (+2 magazine). Every fight has carbine ammo ≥ 30 and a medkit ≤ 15 m before it: duty
(`p5_duty_ammo`, `p5_gate_med`), ready (`p5_ready_*`), spine (mess/armoury), door (`p5_spine_ammo`), bay (`p5_bay_*`,
`p5_wheel_*`).

**Why soldiers are a step up, not a military shooter:** they hit from range and use cover (husks never do); but they
fire only after a visible aim (light and glint from the start of the rise), miss the first burst of every engagement, never sprint, never throw anything, never
flank faster than 1.6 m/s, and at most two fire at once. The fear is the stillness and the voice, not the damage.

### 5.4 Cover points (level data, `Level.cover`, §8.3)

`n` = the direction the soldier faces when he uses it (toward the threat side; the cover object lies 0.3 … 0.7 m along
`n`). `low` (≤ 1.3 m: crouch, rise to fire over) or `high` (≥ 1.8 m: stand, lean out to the side with sight). Each point
is 0.55 m from its object's face (capsule 0.35 + 0.2).

| set | id | feet (x, y, z) | n | h | object (its face) |
|---|---|---|---|---|---|
| `ready` | `cv5_r1` | (−4.0, 0, −34.95) | +z | low | C2 (south face z −34.4) |
| | `cv5_r2` | (−4.0, 0, −30.45) | +z | low | C1 (south face −29.9) |
| | `cv5_r3` | (−8.55, 0, −27.0) | +x | high | L1 (west face x −8.0) |
| | `cv5_r4` | (0.75, 0, −30.0) | −x | high | L2 (east face 0.2) |
| | `cv5_r5` | (−0.95, 0, −30.0) | +x | high | L2 (west face −0.4) |
| | `cv5_r6` | (2.0, 0, −36.15) | +z | low | C3 (south face −35.6; kit rack 1.05 m behind) |
| | `cv5_r7` | (−4.0, 0, −28.55) | −z | low | C1 (north face −29.1; player south of it) |
| | `cv5_r8` | (2.0, 0, −34.25) | −z | low | C3 (north face −34.8) |
| `duty` | `cv5_d1` | (−1.5, 0, −16.55) | +z | low | watch desk (south face −16.0) |
| | `cv5_d2` | (5.0, 0, −20.65) | −z | low | cabinets (north face −21.2) |
| `spine` | `cv5_s1` | (12.85, 0, −17.35) | −x | high | R1 (east face 12.3) |
| | `cv5_s2` | (14.85, 0, −14.65) | −x | high | R2 (east face 14.3) |
| | `cv5_s3` | (22.85, 0, −17.35) | −x | high | R3 (east face 22.3) |
| | `cv5_s8` | (21.15, 0, −17.35) | +x | high | R3 (west face 21.7) |
| | `cv5_s4` | (26.85, 0, −14.65) | −x | high | R4 (east face 26.3) |
| | `cv5_s5` | (27.15, 0, −17.35) | +x | high | R5 (west face 27.7) |
| | `cv5_s6` | (34.15, 0, −14.65) | +x | high | R6 (west face 34.7) |
| | `cv5_s7` | (40.15, 0, −17.35) | +x | high | R7 (west face 40.7) |
| `floor` | `cv5_f1` / `f2` / `f3` | (27.0, 0, −27.45) / (27.0, 0, −30.55) / (28.55, 0, −29.0) | −z / +z / −x | low | CA (north −28.0 / south −30.0 / east 28.0) |
| | `cv5_f4` / `f5` | (26.6, 0, −48.45) / (27.75, 0, −50.0) | −z / −x | low | CB (north −49.0 / east 27.2) |
| | `cv5_f6` / `f7` / `f8` | (39.0, 0, −43.45) / (39.0, 0, −46.55) / (37.45, 0, −45.0) | −z / +z / +x | low | CC (north −44.0 / south −46.0 / west 38.0) |
| | `cv5_f9` / `f10` | (43.05, 0, −23.0) / (44.3, 0, −24.55) | +x / +z | high | CD (west 43.6 / south −24.0) |
| | `cv5_f11` / `f12` | (37.05, 0, −26.8) / (38.3, 0, −28.55) | +x / +z | high | forklift (west 37.6 / south −28.0) |
| | `cv5_f13` | (39.4, 0, −51.05) | −z | high | gas racks (north −51.6) |
| | `cv5_f14` / `f15` | (29.85, 0, −32.0) / (29.85, 0, −40.0) | +x | low | EW1 / EW2 (west face 30.4) |
| | `cv5_f16` / `f17` | (38.15, 0, −32.0) / (38.15, 0, −40.0) | −x | low | EE1 / EE2 (east face 37.6) |
| `gallery_w` | `cv5_g1` / `g2` | (24.45, 4.8, −45.0) / (24.45, 4.8, −26.0) | +x | low | west parapet (x 25.0) |
| `gallery_e` | `cv5_g3` / `g4` | (43.55, 4.8, −43.0) / (43.55, 4.8, −26.0) | −x | low | east parapet (x 43.0) |
| | `cv5_g5` / `g6` | (30.0, 4.8, −34.55) / (38.0, 4.8, −34.55) | +z | low | bridge parapet (z −34.0) |

Re-verified (S1a/b/c): every point is 0.55 m from the face of the object that lies along its `n`; spine points keep 0.1 m
from the corridor walls (z −17.35 / −14.65 vs faces −17.8 / −14.2, capsule r 0.35); low objects are ≥ 1.2 m (crates 1.2,
equipment boxes and cabinets 1.3, parapets 1.1 on a 4.8 m deck where the shooter below sees only up to it); with the
crouch eye 0.85 (§8.2.2) and the safety ray testing **chest and head**, no helmet shows over low cover. **41 points**
(8 + 2 + 8 + 17 + 2 + 4); W4 self-tests each (§8.3).

### 5.5 Scares in the quiet moments (vignettes, D21)

Common rule (story, `scareOk(id)`): not yet fired; phase allows it; **calm** (no hostile awake within 30 m, no shot by
anyone within 4 s, no cutscene, no note open, not during a Kessler line of priority `scene`); ≥ 45 s since the last
scare, ≥ 90 s between two **loud** ones (L); the player is not standing in a doorway (no scare fires within 1.0 m of a
door plane). A scare never adds or moves a collider on a walkable route (debris is non-colliding; the moved body keeps its
0.15 m walkable box). Fired ids go into progress `scares`; restoring a checkpoint calls `level.vignette(id + ':snap')` for
each (end state, silent, §8.7). A scare whose window passes (player left the room) re-arms on the next entry.
**Exemptions (S2):** `v5_hull_groan` has no voice and may run over the gaps of Kessler's pickup sequence (it ignores
the "no Kessler `scene` line" condition); `v5_magazine` is the wake's own tell and is exempt from every spacing rule (it
always fires with the `g5_mag` wake).

| # | id | room | trigger (beyond the common rule) | what the player sees and hears | sounds (level-owned) | snap (end state) | L | honest because |
|---|---|---|---|---|---|---|---|---|
| 1 | `v5_turnstile` | gate5 | first `t5_turnstile` | the left tripod turnstile clicks a quarter turn by itself; the `ON POST` board ticks `26 → 27` | `turnstile_click`, `counter_tick` | board `27` | | the gate system counts arrivals; nobody has left since Monday (`note5_visitors`); it is CHOIR's system and it counts him in |
| 2 | `v5_hull_groan` | ready5 | `g5_s1` dead, ≥ 4 s calm (Kessler's radio lines allowed), player 3 … 9 m from `mk5_locker_slam`, it within 70° of view | a long deep groan through the hull (6 s); the locker rows rattle at +2.2 s; at +3.4 the ajar locker bangs open and a helmet drops and rolls 2.5 m toward him, wobbles, stops | `hull_groan_long`, `locker_rattle`, `locker_bang`, `helmet_roll` | door open, helmet at `mk5_helmet_rest` | L | 2.1 km of sea on a pressure hull |
| 3 | `v5_bunk_radio` | berths5 | first entry with `radio` owned, ≥ 3 s inside | a sailor's bunk radio clicks on: static, then CHOIR, softly, reading names — "Brekke. Solberg. Tveit. Nilsen. Lund…" — the dial glows green; it clicks off after ≈ 6 s | `radio_on_click`, `radio_static_bed` + line `l5_choir_names` (story-spoken, positional at `mk5_bunk_radio`, fx `radio:1`) | radio off | | every radio is on CHOIR's repeater (Kessler said so); `l5_kes_names` answers |
| 4 | `v5_trays` | mess5 | first entry past z −12.5 | a pump thumps behind the galley wall, the deck shudders (shake 0.15), thirty trays and the cutlery bin slide off the counter and crash across the floor | `pump_thump`, `tray_crash`, `cutlery_scatter` | trays on the floor (static layout) | L | the dock pumps cycle; the counter is unsecured |
| 5 | `v5_galley_shape` | galley5 | player looks at the frosted window (≤ 60°) for 0.5 s at 3 … 8 m | the cold-room fan starts; a human-sized shape swings across the frost and back; a hook creaks. Close up (≤ 1.5 m), a clear corner of the glass shows an oilskin's sleeve on a hook | `fan_start`, `fan_loop`, `hook_creak` | fan running, oilskin swaying idle | | it is an oilskin in a draught; the corner shows it |
| 6 | `v5_water` | heads5 | first entry, ≥ 2 s inside | all four taps open at once with a hammer-bang in the pipes; water runs 2.5 s; the drains gurgle; the mirror strip flickers | `water_hammer`, `taps_run`, `drain_gurgle` | taps off, mirror light steady | | water pressure surge (the pumps again) |
| 7 | `v5_body` | berths5 → spine5 | the body at `mk5_body_a` has been in view (≤ 10 m, 1 s); **a living `g5_spine` member has been unseen by the player for ≥ 15 s** (S2: it is the one that dragged it); the player has had no sight of either `mk5_body_a` or `_b` for ≥ 15 s and is ≥ 12 m from both | **nothing is seen moving**: the body is now at `mk5_body_b` in the spine, face down, with a drag smear from the berths door toward the sub bay door | — (silent) | body at B, smear decals | | the units drag the dead (the theatre's queue, 3b); the smear points where they came from |
| 8 | `v5_boots` | crawl | first `t5_crawl_e` + 2.0 s (player still in the crawl), no `g5_*` soldier alive within 40 m | boots on the grating above: `g5_patrol` enters from the sub bay with its weapon light on, walks west along the grating, stops right above and ahead of the player at x = `clamp(playerX + 1, 18, 34)`, z −16.0 (default marker `mk5_boots_stop` 26.0, 0, −16.0) for 3.5 s — his weapon light spills down through the bars, the red dot of his Clasp blinks above; he walks east to `mk5_patrol_end` (40.5, 0, −14.9) and holds there in `hold` (he does not see the player: the grating blocks sight); he leaves `hold` the moment he has sight of the player out of the crawl, or is shot at | his own steps (`soldier_step` grate variant), `gear_rattle` | patrol absent after any load (B1: optional group, not restored) | L | a real soldier; if the player does not reload, he is fought at Kessler's door (he holds near it) |
| 9 | `v5_magazine` | magazine | `g5_mag` wake rule | the caged lamp pops; only the stair strips and the husk's eye glow remain; 0.8 s later the shape against the rack sits up | `bulb_pop`, `glass_tinkle` | lamp dead (`mag5` off) | L | a real unit, and the lamp is the one on its circuit |
| 10 | `v5_sub_check` | sub5 | ≥ 3 s in the sub bay (floor or gallery), phase ≥ S | the boat runs its pre-launch check: ballast blow hiss with mist along the hull, the sail hatch swings open with a deep clang and warm light inside, the cradle clamps cycle, the board flips `PRE-LAUNCH CHECK — RUNNING` → `COMPLETE — AWAITING OFFICER PALM`, the hatch shuts | `sub_ballast_hiss`, `sub_hatch_clang`, `clamp_cycle`, `sub_systems_hum` | board `COMPLETE`, hatch shut | L | CHOIR requested the check (dive board); it is preparing the boat (D14) |

Escalation (by intensity, whatever the room order): 1 a click → 2 the hull → 3 a voice → 4/6 loud objects, water → 5 a
shape that is explained → 7 a body that moved → 8 a real enemy over your head → 9 a real enemy in the dark with you →
10 the whole bay wakes up. Never two loud ones within 90 s; at most one per room.

### 5.6 What forces what (R1)

| situation | behaviour |
|---|---|
| stays in the gate lock | the gate stays open; nothing comes; the tube door is sealed |
| goes back to the gate after the latch | locked, panel `GATE 4 — CLOSED — TUBE CYCLE` |
| never goes to the duty door | nothing happens; the objective stays |
| shoots the duty door before the scene | decals ride the leaf (`check:decals`); nobody exists behind it yet (R4) |
| never enters the ready room | `g5_s1` leaves `hold` 20 s after the units die or 45 s after H and comes to him |
| never takes the radio | squawks; keypad dead; no timer opens the door |
| tries the keypad first / the right code before power | `NO AUTHORITY`, no UI, `keypad_dead` |
| goes straight to Kessler's door after the keypad | the door beat runs (calm) |
| tries the tunnel door before the neck check | locked: `l5_unit_tunnel_co`; Q → "My door." |
| never turns his back at the door | Kessler repeats (`_3` / `_3b` alternating, 8 s); the tunnel stays locked |
| never uses the wheel | `d5_tunnel` stays cycling; objective + Q hint |
| runs into the tunnel during the bay fight | latch; the end waits only for hostiles inside |
| hides in the crawl during a fight | enemies go to the hatch tops (exits) and hold there; fights resume when he comes out; no checkpoint below |
| never visits optional rooms / the crawl | their scares and groups never happen; `g5_patrol` never exists |

---

## 6. Spoken lines (`voice/lines.l5.json`) and readables (`src/story/l5/text.ts`)

### 6.1 Cast and voice fx

| id | name | describe | fx | refText (designed, tired, halting) |
|---|---|---|---|---|
| `kessler` (new) | CDR M. KESSLER | audition three: **A** `female, middle-aged, low pitch` · **B** `female, middle-aged, low pitch, scottish accent` · **C** `female, elderly, low pitch` (4 seeds each; W9 makes a **provisional pick by measurement** — the steadiest take with envelope similarity ≤ 0.6 to `hale` and `sunde` — and the build goes on; the user may swap it later with `voice:cast -- kessler --pick N`, coordinator 3) | `radio` | "Post 4, Kessler. I haven't slept since Monday. Listen to me... I'll say this once. And then I'll say it again." |
| `soldier` (alias → `choir`) | — (subtitle label from the line's `label`) | CHOIR's reference (no new voice) | `throat` | — |
| `reyes` | REYES | existing | `clean` | existing |

New voice fx (`VoiceFxName`, `FX_NAMES`, W2b):
- **`radio`** (today only an alias of `headset`; becomes its own name): the `headset` chain (HP 420, peak 1.9 kHz +6,
  shaper 3.2, LP 2900, 1–2 dropouts) **plus** a squelch open (40 ms band noise) and a key-up click with a 0.12 s tail at
  the end; 2-D by default (the HUD radio) at conversation level; with a `position` (the radio on the body) it uses POS
  profile `radio` `{ ref: 2, rolloff: 1.0, send: 0.3 }` and normal occlusion. **`radio:1`** = CHOIR on the channel: the
  `choir` layering (arg 1: light) before the radio band. The parse alias table drops `radio → headset`.
- **`throat`** (taken soldier): CHOIR's take → `choir` layering at arg 1 (one −12 st copy at −14 dB, the −5/+4 copies at
  −18 dB: plural but close) → contact-mic body: HP 280, LP 3200, peak 750 Hz +5 dB (Q 1.2), dip 2.4 kHz −6 dB, shaper 1.6,
  a 35 ms body comb at −20 dB; **plus** a bleed of the same signal through the `radio` band at −14 dB delayed 12 ms (his
  vest radio is on the net). Positional at the soldier's head, POS profile `throat` `{ ref: 5.5, rolloff: 1.0, send: 0.25 }` (S5: with the `inverse` model 5.5 / 6.7 = −1.7 dB at the cutscene distance, inside §8.13's −3 dB);
  the occlusion test ignores the speaker's own capsule (checklist: never occluded by his own body).

Delivery (D30): Kessler controlled, tired, short sentences, the hesitation in the words (`...`), uppercase stress
only in three places (`_5` EVERYWHERE, `door_2` OWN EYES — S7) and to the end of its phrase; CHOIR and the soldiers calm, never raised; UNIT flat, **no uppercase**; Reyes
low, plain, out of breath only where written.

### 6.2 Lines (frozen with this document after review)

Rules (R3): `U` unconditional (a reaction to this instant / a recording); `C(cond)` evaluated when the line starts. "In
view" = clear ray from `player.eye`, within 50° of `player.forward`. CHOIR ≤ 16 words; all ≤ 22 words. `label` = the
subtitle speaker when it differs from the cast name; soldier lines use the CHOIR subtitle colour.

**Cutscene and soldiers**

| id | speaker | label | text | spoken (if different) | fx | rule |
|---|---|---|---|---|---|---|
| `l5_reyes_c1_1` | reyes | | Navy. Thank God. | Navy... thank God. | clean | U (scene T1) |
| `l5_reyes_c1_2` | reyes | | I'm Reyes. Fabrication. The machines killed everyone on my line. | I'm Reyes. Fabrication. The machines... they killed EVERYONE ON MY LINE. | clean | U (T2) |
| `l5_reyes_c1_3` | reyes | | I need your commander. Now. | I need your commander. NOW. | clean | U (T3) |
| `l5_reyes_c1_4` | reyes | | Are you listening to me? | | clean | U (T4) |
| `l5_sol_c1_1_stop` | soldier | BREKKE | The situation is under control, Technician. | | throat | C: `stop` (T5) |
| `l5_sol_c1_1_command` | soldier | BREKKE | The situation is under control, Supervisor. | | throat | C: `command` (T5) |
| `l5_sol_c1_2` | soldier | BREKKE | Put the weapon down. | | throat | U (T6) |
| `l5_reyes_c1_5` | reyes | | Wait— | | clean | U (T9 + 1.0) |
| `l5_sol_down_stop` | soldier | SOLDIER | Put the weapon down, Technician. | | throat | C: `stop`, a soldier leaves `hold` or first sees the player, sight ≤ 15 m, bark gate (below) |
| `l5_sol_down_command` | soldier | SOLDIER | Put the weapon down, Supervisor. | | throat | C: `command`, same |
| `l5_sol_need_stop` | soldier | SOLDIER | There is no need for this, Technician. | | throat | C: `stop`, the speaker was hit in the last 3 s, alive, bark gate |
| `l5_sol_need_command` | soldier | SOLDIER | There is no need for this, Supervisor. | | throat | C: `command`, same |
| `l5_sol_felt_stop` | soldier | SOLDIER | He felt that, Technician. | | throat | C: `stop`, another soldier died ≤ 4 s ago within 20 m of the speaker, speaker has sight of the player, bark gate |
| `l5_sol_felt_command` | soldier | SOLDIER | He felt that, Supervisor. | | throat | C: `command`, same |
| `l5_sol_rounds_stop` | soldier | SOLDIER | You are wasting rounds, Technician. | | throat | C: `stop`, player fired ≥ 15 rounds in the last 8 s with 0 hits on anything, bark gate |
| `l5_sol_rounds_command` | soldier | SOLDIER | You are wasting rounds, Supervisor. | | throat | C: `command`, same |
| `l5_sol_light_stop` | soldier | SOLDIER | We can see your light, Technician. | | throat | C: `stop`, player in `regions.dark` with the flashlight on, the speaker has sight, bark gate |
| `l5_sol_light_command` | soldier | SOLDIER | We can see your light, Supervisor. | | throat | C: `command`, same |

Bark gate: one soldier line per 20 s across all soldiers; never during a Kessler `scene` line; the speaker is alive,
≤ 15 m (≤ 25 m for `_light`) and has sight of the player; each id ≤ 2 times per level.

**Kessler (radio)**

| id | text | spoken (if different) | fx | rule |
|---|---|---|---|---|
| `l5_kes_squawk_1` | Post 4, this is Kessler. Anyone on this channel. Anyone. | Post 4, this is Kessler... Anyone on this channel. Anyone. | radio (positional at `mk5_radio`) | U (§4.3 timer) |
| `l5_kes_squawk_2` | Pick up the radio. I can see you on the camera. Pick it up. | | radio (positional) | C: radio not taken, player within 12 m of `mk5_radio` **and in duty5 or ready5** (both rooms have a camera, S6) |
| `l5_kes_1` | This is Commander Kessler. Who is this? | This is Commander Kessler... Who is this? | radio | U (pickup) |
| `l5_kes_2` | You're not fitted. I watched you come through the gate. You're the first in three days who isn't. | You're not fitted. I watched you come through the gate. You're the first in three days who isn't. | radio | U |
| `l5_kes_3` | The keypad by the door is dead. I'm giving it power from here. | | radio | U |
| `l5_kes_4` | Code is four. Seven. One. Nine. | Code is... four. Seven. One. Nine. | radio | U (pickup; **its end = power cue**; also Q before S) |
| `l5_kes_5` | There's one cable to the surface. The trunk. If that thing gets up it, it's everywhere. | There's one cable to the surface. The trunk. If that thing gets up it... it's EVERYWHERE. | radio | U |
| `l5_kes_6` | You're going to cut it. And I'm going to talk you through every metre of— | You're going to cut it. And I'm going to talk you through every metre of it. | radio | U; **`cut`** written by W9 from ASR word times (just after "of"); ST stops the handle there (fade 0.03 s) |
| `l5_kes_7` | ...Yes. It hears every word on this channel. I can't help that. So listen anyway. | Yes... It hears every word on this channel. I can't help that. So listen anyway. | radio | U (after `l5_choir_radio`) |
| `l5_kes_8` | I've four of my people in here. Fitted. This room is shielded. Out there, they're his. | I've four of my people in here. Fitted. This room is shielded... Out there, they're his. | radio | U |
| `l5_kes_9` | I'm not opening my door, Reyes. Use the keypad. Come aft, to the end of the spine. | | radio | C: code not yet accepted |
| `l5_kes_9b` | Good. Come aft, to the end of the spine. I'm not opening my door. | | radio | C: code already accepted (S2) |
| `l5_kes_brekke` | That radio was Brekke's. ...I know. Keep moving. | That radio was Brekke's... I know. Keep moving. | radio | C: §4.4 (calm, once) |
| `l5_kes_ack` | Kessler. | | radio | U (Q, before the context line) |
| `l5_kes_hint_door` | My door. The end of the spine. | | radio | C: Q, phase S |
| `l5_kes_hint_wheel` | The wheel. West gallery, above the tunnel door. | | radio | C: Q, phase V |
| `l5_kes_hint_tunnel` | Tunnel door's open. South-west corner, floor level. Go. | | radio | C: Q, phase W |
| `l5_kes_busy` | Not now. Fight. | | radio | C: Q while a hostile is awake within 25 m |
| `l5_kes_contact` | Movement in the sub bay. Two units. And one of mine. Coming to you. | Movement in the sub bay. Two units. And one of mine... Coming to you. | radio | C: `g5_spine` spawned, player not in sub5, once; queued behind the pickup sequence (`scene`), dropped if a wave member is already in sight (S7) |
| `l5_kes_names` | Ignore it. He does that. | | radio | C: `heard(l5_choir_names)`, + 1.0 s, once |
| `l5_kes_boat` | Forget the boat. It launches on an officer's palm. Mine, or my XO's. | | radio | C: fact `l5_boat` (palm refused) **or** `mk5_launch` in view ≤ 4 m for 2 s; radio; once |
| `l5_kes_door_wait` | Not with them on you. Deal with them. Then come back. | | radio | C: in `t5_cmd`, phase S, not calm; cooldown 20 s |
| `l5_kes_door_1` | Stop there. On the yellow line. | | radio | C: door beat start |
| `l5_kes_door_2` | The camera says you're clean. The cameras are his. I need to see your neck. With my own eyes. | The camera says you're clean. The cameras are his... I need to see your neck. With my OWN EYES. | radio | U (beat) |
| `l5_kes_door_3` | Turn around. | | radio | C: check pending, on the line, yaw within ±90° of +x (facing the door) |
| `l5_kes_door_hold` | Stay like that. | | radio | C: check pending, on the line, not facing the door (B3) |
| `l5_kes_door_3b` | Turn around, Reyes. Please. | | radio | C: check pending 8 s after the first line and still facing the door; cooldown 8 s |
| `l5_kes_door_away` | Where are you going? Back on the line. | | radio | C: left `t5_cmd_line` with the check pending; cooldown 10 s |
| `l5_kes_door_4` | ...Clean. God. Clean. | Clean... God. Clean. | radio | U (check done) |
| `l5_kes_door_5` | Risa. Ødegård. Hagen. Knutsen. They had the module watch when it happened. | Risa. Oedegaard. Hagen. Knutsen. They had the module watch when it happened. | radio | U |
| `l5_kes_door_6` | In here they're still themselves. The second this door opens, they're his. So it doesn't open. | In here they're still themselves. The second this door opens, they're his. So it doesn't open. | radio | U |
| `l5_kes_door_sunde` | Dr. Sunde's in here too. She came up on Monday to warn me. I listened. Too late for the rest. | Dr. Sunde's in here too. She came up on Monday to warn me. I listened... Too late for the rest. | radio | U |
| `l5_kes_door_7` | The cable tunnel's off the sub bay. I've released it. Hydraulics are isolated at the gallery wheel, west side. | | radio | U (start = phase V) |
| `l5_kes_shot` | That door takes a torpedo. Save your rounds. | | radio | C: a player bullet hits `door5_cmd` / the port, radio, once |
| `l5_kes_dark` | That's him. Emergency lighting's hard-wired. He can't take that. Use it. | That's him. Emergency lighting's hard-wired... He can't take that. Use it. | radio | C: beat `l5_dark`, once |
| `l5_kes_bay` | Four in the launch-lock access. Two of them mine. Take the high ground if you can. | | radio | C: `g5_bay_a` spawned, once |
| `l5_kes_tunnel` | Tunnel door's open. Go. Don't stop for anything. | | radio | C: phase W, `l5_unit_wheel` end + 0.4 s, once (S7) |
| `l5_kes_end` | You're in. The head-end is two hundred metres on. I'll be here. | You're in. The head-end is two hundred metres on... I'll be here. | radio | C: phase X, 0 hostiles in tunnel5 |

**Reyes (radio answers, 2-D)**

| id | text | spoken | fx | rule |
|---|---|---|---|---|
| `l5_reyes_r1` | Reyes. I'm— Fabrication. I came up through Bio. | Reyes. I'm... Fabrication. I came up through Bio. | clean | U (pickup) |
| `l5_reyes_r2` | Then... come out here. Help me. | | clean | U (pickup) |

**CHOIR**

| id | text | spoken | fx | rule |
|---|---|---|---|---|
| `l5_choir_radio` | We can hear you, Commander. We always could. | | radio:1 | U (at `l5_kes_6`'s cut) |
| `l5_choir_key` | Four, seven, one, nine. Thank you, Commander. | | radio:1 | C: code accepted ≤ 2 s ago, once |
| `l5_choir_names` | Brekke. Solberg. Tveit. Nilsen. Lund. Vik. Holte. Myhre. Bakke. | | radio:1 (positional at `mk5_bunk_radio`) | U (`v5_bunk_radio`; the vignette fades it out at 6 s) |
| `l5_choir_door_stop` | Four, Commander. We will wait for them. We are good at waiting. | | radio:1 | C: `stop`, after `l5_kes_door_7` |
| `l5_choir_door_command` | Four, Commander. We will wait. The Supervisor taught us patience. | | radio:1 | C: `command`, same |
| `l5_choir_sub_stop` | A fine boat, Technician. It needs only a steady hand. | A fine boat, Technician. It needs only a STEADY HAND. | choir (2-D PA) | C: `stop`, `heard` nothing of Kessler in the last 4 s, after `v5_sub_check` (or the board in view ≥ 2 s in V), once |
| `l5_choir_sub_command` | A fine boat, Supervisor. It needs only a steady hand. | A fine boat, Supervisor. It needs only a STEADY HAND. | choir | C: `command`, same |
| `l5_choir_end_stop` | It is a long way to the head-end, Technician. We will keep you company. | | radio:1 | C: `stop`, phase X, after `l5_kes_end` |
| `l5_choir_end_command` | It is a long way to the head-end, Supervisor. We will walk with you. | | radio:1 | C: `command`, same |

**UNIT (flat, no uppercase)**

| id | text | fx | rule |
|---|---|---|---|
| `l5_unit_gate` | Gate four. Closing. Tube cycle. | unit (at `mk5_gate_panel`) | U (gate latch success) |
| `l5_unit_tunnel_co` | Trunk tunnel. Commanding officer's authority. | unit (at the tunnel panel) | U (deny `d5_tunnel` in S; cooldown 10 s) |
| `l5_unit_tunnel_hyd` | Trunk tunnel. Hydraulics isolated. Gallery wheel. | unit | U (deny in V; cooldown 10 s) |
| `l5_unit_wheel` | Hydraulics restored. Tunnel door released. | unit (at the tunnel panel) | U (wheel + 4.0 s) |
| `l5_unit_launch_refused` | Launch authority. Officer palm only. | unit (at `mk5_launch`) | U (palm refused; cooldown 6 s) |

Counts: Reyes 7, soldier 13 (scene 3 + 5 bark pairs), Kessler 38 (−`_aas`, +`_door_hold`, +`_9b`), CHOIR 9, UNIT 5 →
**72 lines**. Spoken "Aas" nowhere (the name appears only on screens and readables).
Choice pairs complete: `l5_sol_c1_1`, `_down`, `_need`, `_felt`, `_rounds`, `_light`, `l5_choir_door`, `_sub`, `_end`.

### 6.3 Readables (≤ 30 words; each stands alone)

| id | kind / prompt | where | header | body |
|---|---|---|---|---|
| `note5_visitors` | log / Read log | (2.3, 1.05, −2.0) | `VISITOR LOG — GATE 4 — MON` | `05:10 HALCYON SUPPLY — IN — OUT 05:40.` / `08:12 SUNDE, A. (DR.) — BIO-SYS — URGENT, TO CO — IN.` / `OUT: —` |
| `note5_watch` | log / Read watch log | (−1.2, 1.02, −15.5) | `WATCH LOG — DUTY ROOM — MON` | `08:12 Dr. Sunde for CO, urgent. 08:38 CO to module with Dr. Sunde. 08:40 All stations: link drill. 08:41` (the pen line trails off the page) |
| `note5_roster` | log / Read card | (−7.78, 1.4, −14.0) | `MODULE WATCH — MON 08:00–12:00` | `LS RISA · AB ØDEGÅRD · PO1 HAGEN · AB KNUTSEN. Module sealed on watch. Phones only.` |
| `note5_locker` | log / Read note | (−7.38, 1.5, −29.0) | `LOCKER 7 — PO1 H. BREKKE` (note taped inside) | `Brekke — collar check moved to 08:40 Monday, all hands. Bring your forms. Don't be the last one again. — L. Aas` |
| `note5_mess` | log / Read board | (24.22, 1.6, −4.0) | `MESS BOARD` | `READINESS TRIAL — DAY 9. WELL DONE ALL. CAKE 15:00 MON (CO's treat).` |
| `note5_arm` | log / Read issue sheet | (15.0, 1.0, −19.6) | `ARMOURY ISSUE — MON` | `08:43 — CARBINE × 19, SIDEARM × 19, MAGS × 76. ISSUED BY: —  SIGNED: —  REASON: —` |
| `note5_mag` | log / Read tally | (19.0, −1.4, −22.0) | `MAGAZINE TALLY — 5.56 / 9 MM` | `5.56: 40 TINS. DRAWN MON 08:44: 19. 9 MM: 30 TINS. DRAWN: 6. Fire party access: crawlway from the spine.` |
| `note5_dive` | log / Read board | (51.78, 1.6, −30.0) | `DIVE BOARD — SDV TERN` | `TUE: NO DIVES. TUE 22:00: PRE-LAUNCH CHECK — REQUESTED: CHOIR (MAINTENANCE). WED: PRE-LAUNCH CHECK — REQUESTED: CHOIR.` |

Plates/stencils (not readables): `BILGE ACCESS — CRAWLWAY TO MAGAZINE — CROUCH`; `MAGAZINE — DOGGED FROM BELOW — ACCESS VIA
SPINE CRAWLWAY`; `TRUNK — HEAD-END 200 M ←`; `COMMAND MODULE — SHIELDED — SEALED FROM INSIDE`.

### 6.4 Screens, toasts, objectives (`CLOCK5`: arrival hour = `facts.testHour ?? 62.5`, day/time derived as 3b)

| screen | kind | text / states |
|---|---|---|
| `gate_panel5` | `terminal_idle` | `AUTHORISED: AAS, L. (LT.) — PALM — LIVE` → `GATE 4 — CLOSED — TUBE CYCLE` |
| `gate_log` (booth monitor) | `terminal_idle` | `GATE 4 — LAST AUTHORISED: AAS, L. (LT.) — PALM — LIVE — {hh:mm}` / `PREVIOUS: AAS, L. (LT.) — TUE 21:52` / `PREVIOUS: AAS, L. (LT.) — TUE 03:15` |
| `aas_palm` (booth counter, behind glass) | `palm` (existing) | `white|done|AAS, L. (LT.) — PALM — LIVE — {arrival − 0:40}` (fixed; S6) |
| `onpost` | `onpost` (new, canvas) | `ON POST` + a big number (26 → 27 at `v5_turnstile`) |
| `dock_status` (duty board) | `dock_status` (new) | `SDV TERN — CRADLE — LAUNCH READY` / `TRUNK — NOMINAL` / `COMMAND MODULE — SEALED (INSIDE)` / `LINK DRILL — IN PROGRESS {d h m}` |
| `key5_panel` | `keypad` (new) | `NO AUTHORITY` (dark red, dim) → `ENTER CODE` → `* * * _` (while typing, mirrors the UI) → `CODE REJECTED` 1.2 s → `ACCEPTED` → `OPEN` |
| `launch` (bridge console) | `launch` (new) | `SDV TERN — LAUNCH CONTROL` / `PRE-LAUNCH CHECK: — | RUNNING | COMPLETE (REQUESTED: CHOIR)` / `LAUNCH AUTHORITY: OFFICER PALM — CO / XO` / `AWAITING PALM` |
| `launch5_palm` | `palm` (existing) | `white|standby|LAUNCH` → scan → `fail|NOT ROSTERED — REYES, S.` |
| `tern_board` | `dock_status` | `TERN — CRADLE — LAUNCH READY` → (`v5_sub_check`) `PRE-LAUNCH CHECK — RUNNING` → `COMPLETE — AWAITING OFFICER PALM` |
| `tunnel_panel` | `terminal_idle` | `TRUNK TUNNEL — CO'S AUTHORITY` → `CO RELEASE — HYDRAULICS ISOLATED ↑` → `HYDRAULICS RESTORED — OPEN` |
| `cmd_panel` | `terminal_idle` | `COMMAND MODULE — SHIELDED — SEALED FROM INSIDE` |

Toasts: `Radio`, `Q — radio Kessler`, `Q — ask Kessler for the code`, `Crouch — C`, `Armour vest`, `Armour plate`,
`Hatch dogged from below`. Objectives: `Find the navy — Post 4` (A, B, B2), `Survive` (D0, D with `g5_duty` alive), `The
ready room` (D, `g5_duty` dead), `Take the radio` (after the first squawk), `Open the spine door — keypad` (K; `— 4719`
after three wrong codes), `Kessler's door — the end of the spine` (S), `Stand on the yellow line — turn your back to the
door` (door beat, B3), `The gallery wheel — sub bay, west side` (V), `The trunk tunnel — floor level, south-west` (W).

---

## 7. Checkpoints, carry, direct start, end

| id | saved when | restore rebuilds |
|---|---|---|
| `cp5_start` | A → B (gate open) | phase B; gate open; scares none |
| `cp5_duty` | hand-back (7.1: at once) | phase D0, player at `mk5_c1_end`; `g5_s1` re-spawned in `hold` by `afterReplay` (flag `radio` false; it was never in `triggered`, B1); `g5_duty` replays from H + 1.5 / H + 2.5; scene seen (never replayed) |
| `cp5_ready` | `g5_duty` dead + 1.5 s, calm (the level-5 `calm()` ignores a holding group), `g5_s1` holding | phase D; `g5_duty` cleared; `g5_s1` re-spawned in `hold` by `afterReplay` (its 45 s timer restarts) — **also when he had been killed but the radio not taken**: he stands again and the radio comes with him (B1) |
| `cp5_radio` | after `l5_kes_4`, calm (or the next calm moment in K) | phase K (keypad powered, Q live); radio owned; strip on; remaining pickup lines resume from the first not heard (`_5` …); `g5_s1` cleared (`radio` true, so `afterReplay` does not re-spawn him); `v5_hull_groan` as saved |
| `cp5_spine` | §4.6 | phase S; `g5_spine` cleared; `d5_dive` closed; hatches as saved; scares as saved (`:snap`); **`g5_patrol` absent** (optional; never restored, B1) |
| `cp5_door` | L + 1.5 (§4.7) | phase V; `lights_out5` + `dark5_on` applied silently (and beat `l5_dark` re-emitted for audio); `g5_cmd` replays from L + 3.0; patrol absent |
| `cp5_bay` | §4.8 | phase V or W as saved (wheel done → W); `g5_cmd`, `g5_bay_a` cleared; `g5_bay_b` cleared if dead, else (if the wheel was done) removed silently |

No checkpoint during the scene, the pickup sequence before `_4`, the door beat, the wheel's 4 s, in the crawl or the
magazine, or after `t5_tunnel`. `ProgressL5` = `ProgressL3` shape; flags `gateOpen`, `gateLatched`, `scene`, `unitsIn`,
`s1Free`, `radio`, `powered`, `keypad`, `spineWave`, `hatchSpine`, `hatchMag`, `boots`, `door`, `verified`, `dark`,
`bayA`, `wheel`, `released`, `tunnel`, `patrolFree`; `scares: string[]`; `codeWrong: number`. The flashlight cell is
saved by the player module (as built: restored ≥ 50 % if it was saved on); a new level starts with a full cell.

Carry in (`CarryV2` from 4): weapons, health (floor 50), armour, flashlight, facts (incl. `testHour`). Direct start
`?level=5[&autostart=1][&choice=stop|command][&units=N][&continue=1]`: pistol 12 + 24, shotgun 6 + 6, **carbine 30 + 90**,
health 100, **armour 50**, flashlight on; facts `choice 'stop'`, `unitsLeft 28`, `badge true`, `halvorsenAlive true`,
`testHour 62.5`. `?level=6` clamps to 5. End (`l5_end`): fade, carry (`from: 5`; facts + `kills5`, `radio`, `kessler`,
`l5_door`, `l5_boat`, `testHour`; weapons; armour), clear the level-5 checkpoint, end card `POST 4` / `TO BE CONTINUED`
(12 s, skippable), menu; stored level 5; menu line `Chapter 3  —  Post 4`.

---

## 8. Systems (each an independent task; owners in §11)

### 8.1 Level 5 in the chain + contract (task K)

```ts
// core/progress.ts
4: { ...as today, next: null },   // stays null on main; IA sets 5 (D2)
5: { id: 5, tag: 'l5', built: true, title: 'POST 4', place: 'Post 4', bootStatus: 'post 4',
     screenHeader: 'NAVAL DETACHMENT // ERIDU DEEP — POST 4', camLabel: 'POST4', idleText: true, powerOnAtLoad: true,
     keycardName: 'FACILITIES BADGE', endEyebrow: 'End of Post 4', menuLine: 'Chapter 3  —  Post 4', subtitles: 'stacked',
     cast: { foreman: false, human: false, tomasHead: false },
     direct: { facts: { choice: 'stop', unitsLeft: 28, badge: true, halvorsenAlive: true, testHour: 62.5 },
               loadout: { weapons: { pistol: { clip: 12, reserve: 24 }, shotgun: { clip: 6, reserve: 6 }, carbine: { clip: 30, reserve: 90 } },
                          health: 100, flashlight: true, armor: 50 } },
     healthFloor: 50, next: null },
// core/types.ts (all required; stubs where a module has nothing yet — D28)
export type EnemyType = 'skitter' | 'husk' | 'sentry' | 'foreman' | 'soldier';
EnemySpawn.arms?: 'pistol' | 'carbine';        // data (soldier only)
EnemySpawn.cover?: string;                     // data: preferred cover set id
export interface CoverPoint {
  id: string; position: THREE.Vector3;         // feet, on a floor
  normal: THREE.Vector3;                       // horizontal unit: the direction he faces using it (object lies 0.3–0.7 m along it)
  height: 'low' | 'high'; room: string; set: string;
}
Level.cover: readonly CoverPoint[];            // levels 1–4: []
export type VoiceFxName = … | 'radio' | 'throat';
UISystem.radio(o: { label: string; live: boolean } | null): void;              // HUD radio strip (stub: no-op)
UISystem.keypad(o: { digits: number; title: string; panel?: string }): Promise<string | null>;
                                               // code or null; K stub resolves with __game.debug.keypadInput (a test-injected
                                               // string) or null, so ST can judge codes and H10 works before W2a (S4)
UISystem.closeKeypad(): void;
EnemyManager.release(group: string): void;     // B1: a soldier in `hold` (state 'idle', not hunting, awake) → normal AI;
                                               // other types / levels 1–4: wakes the group (stub = wakeGroup)
EnemyManager.corpsePoint(id: number, part: 'chest'): THREE.Vector3 | null;   // S4: world point on a corpse (null: none)
ActorOpts.name?: string;                       // a soldier actor's name tape ('BREKKE')
GameEvents['enemy:fired']: { id: number; type: EnemyType; origin: THREE.Vector3; point: THREE.Vector3; hit: boolean };
// story/save.ts
export const CHECKPOINT_IDS_L5 = ['cp5_start', 'cp5_duty', 'cp5_ready', 'cp5_radio', 'cp5_spine', 'cp5_door', 'cp5_bay'] as const;
export const STORY_REV_L5 = 1; export const SPEC_L5: SaveSpec = { level: 5, rev: STORY_REV_L5, ids: CHECKPOINT_IDS_L5 };
export type ProgressL5 = ProgressL3; export const emptyProgressL5 = emptyProgressL3;
```

Level-4 end (`story/l4`): `nextOf(4) === null` → today's card + menu (unchanged on main); `=== 5` → `BIOLOGICAL SYSTEMS`
without "TO BE CONTINUED", 6 s skippable, then `goToLevel()`; 3b's carry already writes `testHour`
(`story/l4/index.ts:68`), so `story/l4/script.ts` is not touched (S5). Dispatch: `LEVEL_BUILDERS[5]` → stub (one lit 8 × 8 room, spawn (0, 0, 3)), `STORIES[5]` → stub on
`createStagePage`, `SHOTS[5]` eye (0, 1.7, −2) → look (0, 1.5, −10). **Placeholders** (marked `// K placeholder`): the
enemies factory map gets `soldier` = a husk with a console warning (manager falls back today; K makes it explicit);
`FX_NAMES` gains `radio` (renders as `headset`) and `throat` (renders as `choir`) with the alias `radio → headset`
removed from `parseFx`; `ui.radio`/`keypad` stubs; `enemies.release` (= `wakeGroup`) and `corpsePoint` (null) stubs; `Level.cover = []` in levels 1–4 and the stub; `screens.ts`
placeholders for the new kinds `keypad`, `launch`, `dock_status`, `onpost`; `ScreenKind` and `MaterialName` additions
(`NavyDockMaterialName`, kept out of the exhaustive record as 3b did). `scripts/lib/check-common.mjs` `levelsOf('all')`
→ [1 … 5]. Tests (`check-chain.mjs`): L4 end → L5 via `?next=4:5&handoff=1` for both choices keeps weapons (incl. the
carbine), health, armour (37 → 37; 900 → 100; NaN → 0), flashlight, facts and `testHour`; without the override the L4 end
is today's; `?level=5` loadout + facts; `?level=6` → 5; stored 5 + CONTINUE (with/without checkpoint) + BEGIN; L5 end
writes the carry, stored level 5; a level-4 checkpoint written before K restores; the level grep stays clean.

### 8.2 The taken soldier — enemy `soldier` (W3a model, W3b behaviour)

#### 8.2.1 Body (W3a, `src/enemies/soldier/model.ts`, `rig.ts`)
On the human skeleton (Tomas/Halvorsen precedent, `enemies/human/model.ts`, `shared/rig.ts`), smooth-skinned, original
geometry: navy fatigues (`fatigue_navy`, W5) with knee and elbow pads; plate carrier vest with pouches and a shoulder
radio (green LED); combat boots (`rubber`/dark); gloves; **helmet** (`helmet_navy`) with goggles (dark lenses, a faint
grey reflection) over a **knit balaclava** (`knit_black`) — no face, no skin anywhere; **the Clasp** on the nape below the
helmet rim (3b's `clasp()` geometry at 1:1); its LED **and 4 cm halo are a `RigBuilder.mark()`** (merged system: no
extra draw call, ≥ 2.2 px to 25 m) with its own state: **red, blinking 1 Hz with a per-soldier phase, in every living
state including `hold` — never cyan** (red blinking = linked, 3b's language, S6); `fail` at death, then out. It reads from
behind and ≤ 60° off behind (12 px at 1080p at 6.7 m / 30°); the green radio LED is a second small mark; a name tape on the vest (`BREKKE` for `g5_s1`
and the cutscene actor; other soldiers draw names from the 19 linked crew of `screens4.ts` `CREW`). Weapons: a navy
pistol (right hand) or a carbine (the player carbine's world-scale mesh, ≤ 2 calls) with a small **weapon light**.
Draw calls ≤ 10 at LOD0 (fatigues, vest+pouches, helmet+goggles, balaclava, boots/gloves, glow (the marks), weapon,
shadow proxy), ≤ 6 at LOD1 (beyond 12 m), shadow proxy only within 15 m. One template, cloned (≤ 6 alive).

#### 8.2.2 Rig API (W3a → W3b; both build to this from day one)

```ts
export type SoldierPose = 'hold' | 'walk' | 'walk_aim' | 'aim' | 'crouch' | 'rise_aim' | 'lean_l' | 'lean_r' | 'reload' | 'flinch' | 'stagger';
export interface SoldierRig {
  readonly root: THREE.Object3D; readonly drawCalls: number; readonly volumes: HitVolume[];   // head, torso, 4 limbs
  setPose(p: SoldierPose, blend?: number): void;       // procedural, blended (human.ts style); no clips
  setMove(speed: number, heading: number): void;       // leg IK; walk ≤ 1.6, retreat ≤ 3.0 m/s
  aim(p: THREE.Vector3 | null): void;                  // torso/arms/head toward p (±70° yaw, +35/−45° pitch); null = low ready
  readonly eye: THREE.Vector3; readonly muzzle: THREE.Vector3; readonly nape: THREE.Vector3; readonly chest: THREE.Vector3;  // world, per frame
  setLight(on: boolean): void;                         // weapon light (spot via ctx.render.lights, no shadow, prio 0.5, 14 m, 0.35 rad)
  setLed(s: 'red' | 'fail' | 'off'): void;            // the Clasp mark: 'red' blinks 1 Hz (every living state), 'fail' = 3 fast
                                                       // blinks then off (3b's theatre pattern); no cyan state exists
  fire(): void;                                        // muzzle flash (fx.flash 0.05 s), recoil kick, casing
  die(kind: 'fwd' | 'back' | 'side', dir: THREE.Vector3): Promise<void>;   // keyed fall 1.2–1.6 s, then still
  speak(seconds: number): void;                        // head/shoulder micro-motion (no jaw)
  lod(level: 0 | 1): void; dispose(): void;
}
```

Poses: `hold` — upright, weapon low at 45°, head tracking, no idle fidget (a person held still); `walk_aim` — slow
heel-to-toe, weapon up, torso stable; `crouch` behind low cover (eye **0.85**, below every 1.2 m object; S1e); `rise_aim` 0.35 s to standing aim (the weapon
light and a lens glint come on **at the start of the rise**, S3); `lean_l/r`
0.35 m out from high cover; `reload` 2.4 s (pistol 1.8 s) with a visible magazine drop; `flinch` 0.25 s; `stagger`
0.6 s. **Death** keyed by the hit direction: `fwd` (knees give, falls forward onto the hands, flat), `back` (sits back
against cover if within 0.8 m behind, slumps sideways; else falls back), `side` (turns and drops on the side); the LED
then plays `fail` and goes off (the link fails — 3b's language). The body is a walkable 0.15 m box (`check:wreck`);
corpse cap shared with the manager (12).

#### 8.2.3 Perception (W3b, `src/enemies/soldier/soldier.ts`)
- Sight: eye ray to the player's eye (and chest as a fallback) through `physics.lineOfSight` at ≤ 6 Hz; range **30 m**,
  cone **±70°**; always notices within 4 m (any direction, as husks within 3.5 m). In `regions.dark` with the flashlight
  **off**: range 12 m and sight must hold 0.8 s before notice (D18). The flashlight beam on him for 0.5 s within 25 m =
  notice. **A player who fires is lit for 1.5 s**: any soldier with an eye ray to him sees him at 30 m at once,
  dark or not (S3). Glass passes sight (re-cast, ≤ 3); **grating and every collider block it**.
- Hearing: `alertNoise` like the other enemies (gunshots alert within the weapon's noise radius); a player's sprint
  footsteps within 8 m alert; crouched steps never.
- Shared knowledge: when one soldier of a group notices, every member of that group knows the player's position at that
  moment (CHOIR — no shouting, no hand signals; they simply all turn).
- Last known position held 6 s, then a slow search: walk to it, look around 4 s, return to cover.

#### 8.2.4 Movement and cover (W3b, `cover.ts`)
- Cover choice every 2.5–4 s, on suppression (≥ 1.0), on a hit ≥ 40 within 3 s, and when the current point is flanked
  (the player has sight of his chest at it). Candidates: `Level.cover` points within 14 m of him, of his `set` first (others
  ×0.6 score), not claimed by another soldier (claims expire 2 s after he leaves), nav-reachable (path ≤ 20 m).
  Score = safety (eye→chest **and eye→head** at the point, crouched for low / standing for high, **blocked** from the
  player's eye: required)
  × usefulness (from the peek position — standing for low, 0.35 m lateral for high — sight to the player's eye: required)
  × range fit (pistol 6–18 m, carbine 10–28 m: 1.0 inside, falling to 0.3 outside) × advance (+0.15 if ≤ 6 m closer than
  the current point, never closer than 7 m) × flank (+0.2 if the bearing from the player changes 15–40°; never > 40° per
  move) × novelty (−0.3 for the last two points). Rays: ≤ 12 candidates × 2 = 24 per choice (≈ 8/s).
- Moving between points: walk 1.6 m/s with `walk_aim` (deliberate; never sprints at the player); retreat 3.0 m/s only
  when suppressed ≥ 1.5 or below 35 HP; never moves while firing.
- No cover available (none passes): stands and fights from where he is, sidestepping 1–2 m between bursts.
- `hold` (spawn pose, the patrol's end): reports `state 'idle'`, not hunting, awake (B1: not counted in `activeCount`;
  the level-5 `calm()` ignores a holding group); stands still, head tracks with sight, never fires; leaves `hold` on
  `enemies.release(group)` (story), or by itself when shot at / a bullet within 1.5 m / it sees the player within 6 m —
  then emits `enemy:alerted` so the story mirrors it (`s1Free`, `patrolFree`).
- Nav: nav v2 as husks (decks, stairs, the galleries); `nav: false` floors are never entered; while the player is on one,
  targets resolve to that floor's `exits` (§8.4) and he holds a stand-off 2–5 m from the nearest exit, **never inside the
  walkway box x 36.2 … 38.6, z −15.4 … −14.2** (S1n), with sight of the exit.
- Separation: never within 1.2 m of another enemy; never in a doorway (door plane ± 1.0 m) except passing.

#### 8.2.5 Firing — fair and readable; **the one tuning table** (`src/enemies/soldier/fire.ts` `SOLDIER_TUNING`)

All numbers below live in one exported table so IA can retune without touching behaviour. Values are the reviewer's S3
set (coordinator 2: "a real threat if ignored"), to be confirmed or changed at the soldier-in-motion review after W3a +
W3b.

| key | value | note |
|---|---|---|
| `hp` | 100 | |
| `mult` | head 2.0 · torso **0.8** · limb 0.7 | plate carrier (S3): pistol 7 body / 3 head, carbine 7 / 3, shotgun 2 shells |
| `rise` | 0.35 s (low cover) / 0.35 s lean (high) | weapon light **on and glint toward the camera from the start of the rise** |
| `aim` | **0.45 s** | steady aim pose, `soldier_aim_click` at aim start |
| `burst` | pistol 2 × 0.35 s · carbine 3 × 0.11 s | |
| `gap` | pistol 1.6–2.4 s · carbine 1.8–2.6 s | between bursts |
| `hold_after` / `back` | 0.3 s / 0.4 s | then light off |
| `damage` | pistol 9 · carbine 7 per hit | `player.damage(d, muzzle)`; armour absorbs ⅔ while it lasts (as built) |
| `hit_base` | 0.75 (≤ 8 m) → 0.55 (15 m) → 0.35 (25 m) → 0.20 (35 m) | linear between; resolved per shot, not sprayed |
| `hit_mods` | × 0.5 crossing ≥ 3 m/s · × 0.7 sprinting · × 0.6 partly visible (≤ 2 of 4 axis points, `sentry.ts:404`) · × 0.7 crouched · × 0.4 while suppressed ≥ 0.5 | |
| `lag` | aims at the player eye from 0.25 s ago − 0.35 y | |
| `first_miss` | the first burst of every engagement misses; **reset only after ≥ 12 s unseen** | S3 (6 s let peek-and-hide be safe) |
| `cancel` | a burst in its aim/rise is cancelled only by **one hit ≥ 25 damage or a head hit** | S3 (any hit cancelling made a lone soldier harmless); every hit still flinches 0.25 s |
| `stagger` | head hit or ≥ 25 in one hit → 0.6 s | |
| `retreat` | ≥ 40 within 3 s, or suppression ≥ 1.5, or HP < 35 → next cover away at 3.0 m/s | |
| `supp_gain` | + 0.25 per carbine round · + 0.35 pistol · + 0.6 shotgun shell passing within 1.5 m of his head or impacting within 1.5 m — **capped at 0.8 / s per shooter** | S3: no permanent pin from one held trigger |
| `supp_decay` | 0.5 / s | ≥ 0.5: hit chance × 0.4; ≥ 1.0: no peeks until 1.5 s after it drops below 1.0 |
| `lit` | 1.5 s full sight (30 m) after the player fires | S3 |
| `dark_sight` | 12 m and 0.8 s to notice in `regions.dark` with the lamp off | D18 |
| `tokens` | 2 soldiers in aim/burst at once, level-wide | a third waits in cover |
| `cap` | ≤ 18 health+armour per second from all soldiers | a guard (excess shots resolve as misses) |
| `walk` / `retreat_speed` | 1.6 / 3.0 m/s | never sprints at the player |
| `reload` | every 12 / 30 rounds, always in cover, `soldier_reload` audible ≤ 20 m | a window to push |

Behaviour around the table:
- **Telegraph (every burst):** rise/lean (light + glint on) → aim → burst → hold → back into cover, light off. In the dark
  the light is the warning.
- **Misses land near the player**: the shot ray goes to a point 0.4–1.2 m off the player's body (random side, slightly
  high/low) and hits whatever is behind: sparks / `bullet_metal` decal / glass star; a `bullet_whiz` (pistol) or
  `bullet_crack` (carbine) at the ray's closest point to the player's head when it passes within 2.5 m. A tracer
  (`fx.tracer`, W6) every carbine round.
- **Hits:** the existing directional damage feedback shows the source. `enemy:attack` kind `ranged`; `enemy:fired` for
  every shot (tests).
- **Friendly line:** another enemy's capsule within 0.5 m of the shot line → he waits 0.3 s (re-checks, max 3).

#### 8.2.6 Being hit, death, drops
- Hit volumes: head r 0.13 incl. helmet, torso spine2 + hips, limbs. Multipliers, flinch, cancel, stagger, retreat and
  suppression per the table.
- Death (§8.2.2): `die(kind)`; `enemy:died`; the Clasp mark `fail` → out; the dropped weapon stays visually; on touch
  within 1.2 m (once per body): pistol soldier `ammo_pistol` 8; carbine soldier `ammo_carbine` 15 — **or the carbine
  itself with 30 rounds if the player owns no carbine** (S6) — via `player.give` + `pickup` event + HUD label.
- `corpsePoint(id, 'chest')` returns the chest bone's world point (radio, B2); the wreck box is the manager's walkable
  0.15 m box as for machines.
- **Pre-warm** (S4): `createEnemies` warms the soldier template whenever the level's `enemySpawns` hold a soldier
  **or** the level's `LevelInfo` marks a soldier actor (level 5) — the cutscene's door must not open on a shader compile.

#### 8.2.7 With husks and skitters
Soldiers hang back (their range bands) while husks rush and skitters swarm; they never stand in a husk's path; they fire
only with a clear line (8.2.5); a soldier never takes a cover point within 3 m of an awake husk. The mix teaches itself:
the close threat (units) pushes the player into the long threat's sight lines (soldiers).

#### 8.2.8 Actor mode (W3a)
`enemies.actor('soldier', pos, yaw, pose, { name })`: the same rig as a puppet (cutscene): `moveTo`, `setPose` (`hold`,
`walk`), `lookAt` (pinned/live), `speak(seconds)`, `prop('led', state)`, `prop('name', text)`, `setEyes` = LED on/off. Not
in `all`, never perceives. `ActorOpts.name?: string` (contract, K).

#### 8.2.9 Cost
CPU ≤ 0.15 ms per soldier per frame on MEDIUM (rig + AI), rays ≤ 20/s per soldier (perception 6, cover ≈ 8, shots ≤ 6);
5 soldiers + 4 husks in the bay ≤ 1.5 ms total enemies update. GPU per §2.7.5. One weapon light per firing soldier
(tokens ⇒ ≤ 2 spot slots).

#### 8.2.10 Tests (`scripts/check-soldier.mjs`, W3b; on `src/enemies/dev/soldier.html` + a greybox room in the dev page; W3b ships a
`StubSoldierRig` (boxes for head / torso / limbs; eye / muzzle / chest / nape points) in its own files so 1–16 run before
W3a's rig lands; the motion review needs **both** merged)
1. TTK with the debug aim lock: pistol 7 body / 3 head; carbine 7 body / 3 head; shotgun 2 shells at 5 m; limbs ×0.7.
2. First burst of an engagement never hits (20 engagements); a peek-and-hide cycle under 12 s unseen gets no new free miss.
3. Hit fraction, player still in the open, 60 s each: 8 / 15 / 25 m within ±0.08 of 0.75 / 0.55 / 0.35; strafing
   3.6 m/s ≤ 0.6 × those; crouched behind a 1.0 m crate ≤ 0.45 ×.
4. Every burst preceded by rise + aim (≥ 0.75 s) with the weapon light on from the rise (log of states);
   `soldier_aim_click` once per burst; one 18-damage carbine hit during the aim does **not** cancel it, a head hit does.
5. Cover: room with 6 cover points, player firing at him: his chest is not visible from the player's eye ≥ 70 % of his
   non-firing time; he changes points within 1.5 s of being flanked.
6. Suppression: one shooter's 3 s of carbine fire within 1 m of his head → gain ≤ 0.8 / s (reaches ≤ 2.4 − decay), he
   stays in cover while ≥ 1.0; after the fire stops he peeks again within 1.5 s + decay time.
7. Misses: every miss impact lies 0.4 … 1.5 m from the player's body axis; a whiz/crack plays for each that passes within
   2.5 m.
8. Damage cap: 4 soldiers firing at a still player → ≤ 18 per second measured over every 1 s window.
9. Tokens: with 4 soldiers aware, never more than 2 in aim/burst.
10. Death: mark off ≤ 2.5 s after `enemy:died`; body walkable (`check:wreck` case); ammo (or the carbine, none owned)
    given once; **the radio interactable at `corpsePoint` is enabled from 1.5 m for each death kind (fwd / back against
    a crate / side)** — the R8 ray ignores the corpse's own box (B2).
11. Perception: behind him at 10 m, quiet, 5 s → not noticed; flashlight on him 0.5 s at 20 m → noticed; `dark` region,
    flashlight off, 14 m in front → not noticed in 5 s, at 10 m noticed after 0.8 s; the same player fires once at 20 m
    → noticed at once (lit 1.5 s).
15. Hold: a holding soldier is `state 'idle'`, not in `activeCount`; `release(group)` starts the AI; shooting near him
    releases him by itself and emits `enemy:alerted`; the Clasp mark is red-blinking in hold and in combat, never cyan.
16. Exits (moved here from W4, S5): player in the crawl at (26, −1.4, −16) → every awake enemy goes to `mk5_exit_spine`
    (or `mk5_exit_mag` when open) and holds 2–5 m from it, never inside the walkway box; husk melee never lands through
    the grating (`seesPlayer` needs LOS).
12. Grating: soldier above, player below: no sight either way, player bullets stop at the grating.
13. Actor: puppet poses, `lookAt`, `speak`, LED props.
14. Cost: 5 soldiers + 4 husks fighting, enemies update ≤ 1.5 ms on MEDIUM (measured in the page).

### 8.3 Cover data (W4)
`src/level/l5/cover.ts` exports §5.4's table; `level.cover` returns it as `CoverPoint[]`. `selfTest` per point: feet on a
floor (ray down ≤ 0.1 m); capsule free (r 0.35, h 1.1 low / 1.8 high); a collider within 0.3 … 0.8 m along `n` at y + 0.5
(and + 1.5 for high); peek position free (stand-up capsule for low, 0.6 m lateral either side for high — at least one);
a nav node within 1.5 m; inside its room's interior; not within 1.0 m of a door plane; not in a `nav: false` floor.
`check:nav` adds: every point reachable from the soldier spawn of its set. Safety and peek in the self-test use the
chest **and** head heights (crouch eye 0.85 for low).

### 8.4 Crawlway, hatches, `nav: false` floors (W4 level; W3b reads exits)
- `L.room(…, { floors: [{ y, box, nav: false, exits: [[x, y, z], …] }] })`: no nav nodes on that floor; `exits` = the
  standing positions at the top of each hatch: spine floor exits `mk5_exit_spine` (37.9, 0, −14.8) (on the walkway at
  the stair top — a target point only; enemies stand off 2–5 m from it and never inside the walkway box x 36.2 … 38.6,
  z −15.4 … −14.2, S1n), `mk5_exit_mag` (21.0, 0, −24.0) (only once `hatch5_mag` is open). The level exposes `level.floorAt(p) → { room, floor,
  nav: boolean, exits }` (level-internal on `LevelEx`; the enemies module reads it through the level object as husk nav
  does today).
- Room bounds from the lowest floor − 0.5 (§2.1).
- Hatch lids are dynamic boxes (walkable when shut: top flush at y 0), registered movers (decals ride them,
  `check:decals`), opened by their vignettes; an open lid is a collider standing beside the pit. `hatch5_mag` interact
  exists only on the underside (use point on the lid underside **(21.0, −0.08, −26.4), radius 1.6** — S1j — enabled only
  with the player's eye below y −0.2 and a clear ray; the lid is hinged on its south edge, S1k) — from above the plate
  prompt is `Hatch dogged from below` (prompt only; pressing it toasts the same).
- The hatch pit and the magazine hatch are `L.obstacles` boxes from load (no nav node in them, S1m); the three lower stairs
  are built with `StairDef.y0` and `nav: false` (no `navStair`).
- Grating: solid collider (bullets, sight, nav); `deck_grate` alpha-tested; the crawl ceiling y −0.05. **Rule (S5): melee
  and soldier fire need `seesPlayer` (line of sight); the grating is what keeps the crawl honest — never "fix" that LOS
  check.**
- Player: **no player change needed** — crouch (C, toggle, 1.1 m capsule, `canStand`) exists. The story shows `Crouch — C`
  when the player stands on the landing; `player.debug.crouchHold` (exists) drives tests.

### 8.5 Keypad (W2a UI · W4 interactable · W5 screen)
`ui.keypad({ digits: 4, title, panel })`: an overlay (not a pause) centred low, 3 × 4 keys (1–9, `CLR`, 0, `ENT`),
display of four cells; **the pointer stays locked** (S4): a virtual cursor driven by the mouse deltas plus left click,
and the number keys / numpad, Backspace, Enter; while it is open the story sets `player.controlsEnabled = false` (no
movement, no fire, and Digit1–3 do not switch weapons; the camera still reads yaw/pitch but the deltas drive the cursor —
the UI consumes them); Esc / E / taking damage / any non-`playing` state closes it (resolves `null`) and restores
control; nothing ever needs a re-lock gesture; key clicks `keypad_beep` (UI-owned). Resolves with the 4-digit string on `ENT` (the story judges it and calls
`ui.keypad` again on a wrong code only if the player presses E again). The world panel `key5_panel` mirrors the entry
(`* * * _`) via the story. Interactable `key5_duty` (kind `keypad`) at `mk5_keypad` + 0.3 m out, radius 1.2, R8 from the
duty side (the panel faces −x; use requires the eye at x < 7.8).

### 8.6 Radio item, HUD strip, voice fx (ST · W2a · W2b)
- Item: fact `radio`; carried to 3d; no weapon slot. **Q** → story (`ctx.input.pressed('KeyQ')`, live from the power cue,
  ignored while a note or the keypad is open).
- HUD strip (W2a, `ui.radio`): like the intercom strip (mic icon, live dot, 5 bars) above the vitals, label
  `POST 4 — CMD — CH 1`, `Q` key hint under it; live while a `radio`/`radio:1` line plays; Kessler's subtitles use a new
  colour class `radio` (pale amber), CHOIR on the radio keeps the CHOIR class.
- Voice fx (W2b): `radio`, `radio:1`, `throat` exactly as §6.1, POS profiles `radio` and `throat`; `fxLead('radio') =
  0.04` (the squelch) — the story's cues subtract it (`lead` as today).

### 8.7 Scare vignettes kit (W4 convention · D-tasks own each vignette)
- Convention (`level/context.ts`, W4): `L.vignette(id, run, { snap })`; `level.vignette('<id>:snap')` runs `snap`
  (instant end state, silent, idempotent); unknown snap warns once. Every `v5_*`, `hatch5_*`, `gate5_open`, `lights_out5`,
  `dark5_on`, `key5_power`, `wheel5_turn`, `drain5_a/b`, `cmd5_line`, `cmd5_port_look` has a snap.
- Story side (ST): `scareOk(id)` (§5.5), fires each scare once, logs `{ id, t, room }` in `scareLog`, snaps on restore.
- Each vignette owns its sounds (§8.11) and its debris (fx debris, no colliders). `v5_body` moves a `body()` prop (3b
  W9a) between two markers and adds the smear decals.

### 8.8 Set pieces (W7, `src/level/l5/setpieces.ts` + dev page)
1. **SDV *TERN*** `tern(L, at)` → object `tern` + machine `tern`: hull ⌀ 3.0 × 16 m, sail, top hatch (moving part,
   registered mover), dome port, nav lights (emissive), ballast vent points for the mist emitters, interior glow point
   (medium+), cradle with five saddles and clamp arms (`clampCycle()`), rails; ≤ 12 calls; `userData.check()` runs the
   pre-launch sequence for `v5_sub_check` (hiss mist 3 s → hatch open 1.0 s → light on → clamps → hatch shut).
2. **Launch lock door** ⌀ 5.0 (sealed, 16 dogs, hazard ring) with its 0.6 m port.
3. **Command-module door** (sealed): hardened leaf, dog wheel, the armoured port (yellowed glass, a warm light, a 2-D
   silhouette card on a slow parallax track behind it — `userData.look(on)` for `cmd5_port_look`), door camera with a
   tally (red/amber), intercom grille, the yellow stand line (emissive paint, `pulse(on)`).
4. **Gate** `d5_gate` leaf look (3b `gate4` dog ring, retracted) — a door look for `level/doors.ts` kind `wide`.
5. **Hatch lids** `hatch5_spine` (2.4 × 2.2), `hatch5_mag` (1.2 × 2.7) with wheels and hinges; `open(k)`.
6. **Wheel** `wheel5` (⌀ 0.8, on a manifold with gauges) `spin(t)`.
7. **Launch console** with palm plate + `launch` screen mount.

### 8.9 Navy/dock materials, screens, props kit (W5 materials · W8 kit)
Materials (`NavyDockMaterialName`, W5): `hull_white` (curved plate enamel, weld seams, rivets, condensation streaks),
`deck_grate` (bar grating 30 × 5 mm at 40 mm, alpha-tested, double-sided, casts), `wet_steel` (overlay: roughness 0.06,
ripple normal), `fatigue_navy` (rip-stop, navy blue-grey), `knit_black` (balaclava knit), `helmet_navy` (matte, scuffed),
`webbing` (vest, pouches), `rubber_mat` (ready room). Screens (W5): `keypad`, `launch`, `dock_status`, `onpost` (canvas,
§6.4 formats). Sign style `navy` (white stencil on grey, hull numbers). Test: dev gallery under lit, red-night and dark
(beacon) light; zfight clean.
Kit (W8, `src/level/l5/kit5.ts` + dev page, ≤ 2 calls per prop, 3b kit conventions): tripod turnstile (rotating arms),
guard booth, watch desk, duty board frame, lockers (with a hinged door for `v5_hull_groan`), benches, gear crates, kit
rack, pipe riser, hull rib, triple bunk with curtain and red night light, bunk radio (dial LED), mess table, serving
counter + tray stack (instanced 30 + debris variants), galley range, frosted window + oilskin on hook, sink/mirror/tap,
shower stall, armoury cage rack (23 slots), issue desk, ammo-tin rack, caged emergency lamp (breakable), gallery deck
segment + rail + parapet plate (merged per side), stair dressing (nosing strips), floor drain grille (lifts, as 3b
`sumpGrille`), crate stack, forklift, gas bottle rack, dive suit on hook, decompression chamber, cable tray + trunk cable,
amber rotating beacon (3b `rotBeacon`), floor strip (3b `stripMat`).

### 8.10 Story level 5 (ST) — markers
`src/story/l5/{index,script,dialogue,text,scenes}.ts` on `src/story/stage/*` (read-only): beats §4, RULES §6.2, text
§6.3–6.4, `CLOCK5`, checkpoints §7, spawns §5.1, latches §3, the cutscene (§4.2) on `rig.cutscene`, the radio sequence,
keypad judging, the door check, scares (§5.5), Q, the end. Door status calls only `cycling | dark | null`.

| marker | what |
|---|---|
| `mk5_start`, `mk5_gate_panel`, `mk5_aas_palm` | spawn check; gate line; the booth plate (screen only) |
| `mk5_c1_cam0`, `mk5_c1_cam1`, `mk5_c1_sol`, `mk5_c1_door`, `mk5_c1_out`, `mk5_c1_end` | the cutscene (§4.2) |
| `mk5_duty_u1`, `mk5_duty_u2`, `mk5_s1` | spawns used by the scene timing (also in `enemySpawns`) |
| `mk5_keypad`, `mk5_port`, `mk5_launch`, `mk5_wheel`, `mk5_tern_board`, `mk5_bunk_radio`, `mk5_onpost` | view rules, line positions |
| `mk5_locker_slam`, `mk5_helmet_rest`, `mk5_trays`, `mk5_oilskin`, `mk5_taps`, `mk5_body_a`, `mk5_body_b`, `mk5_boots_stop`, `mk5_patrol_end` | scares |
| `mk5_exit_spine`, `mk5_exit_mag`, `mk5_vent_spine`, `mk5_drain_a`, `mk5_drain_b`, `mk5_dive_door`, `mk5_lockside_door` | spawn-distance rules, exits |
| `mk5_radio` | created by the story at the corpse point (B2) — not a level marker |
| `mk5_glass` | `userData.panes` (booth, port, lock port) |
| `tern` | `userData.check()`, board state |

Debug hooks: §10.0.

### 8.11 Audio ids and their one owner (W2b builds all; the owner is who plays it)

| id(s) | owner |
|---|---|
| `turnstile_click`, `counter_tick`, `hull_groan_long`, `locker_rattle`, `locker_bang` (exists), `helmet_roll`, `radio_on_click`, `radio_static_bed`, `pump_thump`, `tray_crash`, `cutlery_scatter`, `fan_start`, `fan_loop`, `hook_creak`, `water_hammer`, `taps_run`, `drain_gurgle`, `bulb_pop`, `glass_tinkle`, `sub_ballast_hiss`, `sub_hatch_clang`, `clamp_cycle`, `sub_systems_hum`, `hatch_unlatch`, `hatch_open`, `lights_out_dock`, `alarm_beacon` (exists), `wheel_crank`, `hydraulic_release`, `keypad_power_on`, `sump_lift` (exists, drains), `vent_grille` (exists), `booth_door_shut` | level vignettes (D-tasks) |
| `gate_open_heavy`, `gate_close_heavy` | the door `d5_gate` itself (`level/doors.ts` kind `wide` sound hook, W4) — both, never the vignette (S1o) |
| `soldier_pistol_fire`, `soldier_carbine_fire` (3 variants each, distance tails), `soldier_aim_click`, `soldier_light_on`, `soldier_reload`, `bullet_whiz`, `bullet_crack`, `soldier_step` (deck / grate / wet), `gear_rattle`, `soldier_hit_vest` (dull + plate ping), `soldier_fall`, `clasp_fail` (three short beeps, quiet) | enemies (W3a/W3b) |
| `keypad_beep`, `keypad_err`, `keypad_ok`, `keypad_dead` | UI (W2a calls `audio.play`) |
| `flashlight_die` (fizzle then click, for `player:flashlight` `cause: 'empty'`), `flashlight_dead` (dry click, for `cause: 'refused'`) — **all levels** (coordinator 5a) | audio itself, on the event (W2b) |
| `radio_squawk` (static burst before a body squawk) | story |
| debug play log `audio.debug.log` (`{ id, t, pos }` of every `play`/`say`, ring of 512) for `--scares`' owner audit (S4) | audio (W2b adds it) |
| footstep surface `wet` (puddle patches), ambiences `amb_post` (lit Post 4), `amb_berth`, `amb_crawl`, `amb_bay`, `amb_dark` (after `lights_out5`), room presets for every level-5 room id | audio itself (events / `setRoom`) |

### 8.12 Fx additions (W6)
1. `fx.tracer(from, to, o?)` on `FxSystemEx` for enemy rounds (pooled, 32; the player's tracer look; distinct from the
   private player pool).
2. Drips with `bounds` registered as volumes (§2.9); a wet-patch helper `fx.wetPatch(box, rooms)` placing the overlay quad
   (W5's `wet_steel`) — counted as a volume for `check:fxleak` (it is opaque-ish; magenta in debug).
3. Cheap viewport for the lock port (`cheap: true`, 0.6 m, state `dark`).
4. Ballast mist emitter preset (`steam`, low speed, `bounds` around the hull).
5. `check:fxleak --level 5` views: every room centre and door as 3b.

### 8.13 Speech timing and level (standing requirement)
Every timed line ≤ 0.12 s from its cue (`lineLog { id, start, cue }`, `play:l5` fails otherwise) — scene cues, radio
sequence gaps, the cut on `l5_kes_6`, the door check, the scare voices. `check-voice-level --level 5` (the coordinator's
script; **ST hands a diff with its listener points, IA applies it** — S5): the cutscene at 6.7 m (soldier, throat: ≥ −3 dB of the reference, never occluded
by his own capsule; Reyes 2-D); Kessler's radio 2-D = conversation level; the body squawk at 2, 6, 12 m; a soldier bark at
5 and 15 m; CHOIR on the bunk radio at 3 m.

### 8.14 What 3c takes from the merged systems (facts on main, not built here)
- **Carbine aim** (`WEAPON_STATS.carbine.ads`, `AIM_BINDINGS`; RMB hold only): raise 0.20 s, drop 0.15 s, FOV 72° → 50°,
  aimed spread at 20 m mean 0.8 cm (hip 4.3 cm), climb × 0.6, walk × 0.55 (1.98 m/s), no sprint, reload/switch drop the
  aim; `player.debug.ads()` reports it. Used by: encounter ranges (§5.3), T's `--ads` run (hit rate on soldiers at 20 m
  with aim ≥ 2 × hip fire).
- **Flashlight battery** (`player/flashlight.ts` `TORCH`, D16): `?torch=inf` and `player.debug.torch(v)` (T forces the
  cell full for `check:dark`'s lamp-on view, empty for the no-light view); `player:flashlight` `cause` drives the two new
  sounds (§8.11). The story never toggles the lamp except with `cause: 'story'` (none planned in 3c). The cell does not
  drain in the cutscene (as built).
- **Enemy dark-room marks** (`RigBuilder.mark`): husk sensor + sternum + spine diodes, skitter antenna points, sentry nose
  + tail, foreman sensors + hull; red steady awake/hunting, dim cyan powered standby / dormant / worker, out when dead;
  ≥ 2.2 px up to 25 m; no extra draw call. The soldier builds his Clasp LED + halo and radio LED with `mark()` (W3a) but
  with his own state rule — **red blinking in every living state, never cyan** (S6). `g5_mag` (dormant) shows dim cyan
  until it wakes: honest — it is a powered unit. `check:dark` (T) verifies the soldier's mark at 10/20/30 m.

## 9. R1–R8 audit and order-independence audit

| scene / gate | R1 barrier | R2 shootable or different | R3 no assumed order | R4 not before its time | R5 | R6 | R8 |
|---|---|---|---|---|---|---|---|
| arrival, gatehouse | gate latches behind (real door, panel, line); tube door sealed prop | nothing enemy-like; the booth (mug, Aas's palm plate) is behind bullet-proof glass; its back door is a prop into solid, never opens on anyone | `l5_unit_gate` is a reaction | nobody exists yet | — | A, B, B2 | visitor log on the gatehouse ledge only |
| cutscene | gate latched before; duty door opens only in the scene | the soldier is an actor only while the camera is taken; at hand-back he is behind a shut door and replaced by a real enemy out of sight | scene lines are U, played on the scene clock | `g5_duty`/`g5_s1` spawned at hand-back, hidden | camera taken at once, own clock, ≤ 25 s, door shut until the scene | C | — |
| duty / ready | keypad dead (`NO AUTHORITY`); the gate latched | units and soldier real; the soldier in `hold` reacts to shots and near-misses (releases himself) | `_down` needs sight; `l5_kes_brekke` true by construction | units at H + 2.5 from behind a shut door | not helplessness | D, K | keypad only from the duty side; radio only with a clear ray |
| radio | the keypad is the only way on; no timer | — | every pickup line is a reaction to the take; `l5_kes_4` repeated by Q | Kessler exists only on the channel | free movement | K | — |
| keypad | the door stays locked until the code | — | `l5_choir_key` within 2 s of acceptance | — | — | K → S | — |
| quarters, crawl | magazine hatch dogged from below (plate says so); crawl two-way via the spine hatch | the boots are a real soldier; the magazine thing is a real unit; the moved body is a body (blood decals) | scare voices keyed to the scare; `l5_kes_names` after `heard` | `g5_patrol` exists only for `v5_boots`; `g5_mag` dormant from load (harmless) | — | S | hatch underside use only from below |
| Kessler's door | the door is a sealed prop; the tunnel stays locked until the check | the port is bullet-proof (stars); behind it a 2-D card silhouette (never a solid puppet within reach) | every door line is a reaction; `_3` / `_hold` / `_3b` chosen by the facing at that moment (B3); `_wait`/`_away` conditional | — | not helplessness | S → V | — |
| sub bay, wheel | `d5_tunnel` cycling until the wheel, with the reason on its panel and a line | soldiers, units, sentry real; the boat is a machine (sparks, no reaction) | `_bay`, `_tunnel`, `_boat`, `_sub` conditional | `g5_bay_a` sealed in lockacc5 until V; `g5_bay_b` until the wheel | — | V, W | launch palm only on the bridge |
| end | latch | — | end lines need 0 hostiles in the tunnel | — | — | X | — |

| # | what if the player… | answer |
|---|---|---|
| 1 | shoots the duty door before the scene | bullet decals on the leaf ride it when it opens (`check:decals`); no reaction — nobody exists behind it yet |
| 2 | runs back to the gate after the latch | `d5_gate` locked; panel `GATE 4 — CLOSED — TUBE CYCLE`; nothing else; the lock is a dead end anyway |
| 3 | stands in the gate doorway when the latch arms | the latch fails, the gate rises again, re-arms (`CLEAR THE GATE`) |
| 4 | approaches the duty door from the side, sprinting, backwards, mid-reload, with a note open | the trigger box covers the approach and is polled; the scene takes the camera from any of these (`check:cutscene`'s awkward entries, level 5 case); the note closes |
| 4b | sprints to the duty door before the gate has shut and waits there | nothing until B2; the polled trigger starts the scene on the first B2 frame (S2) |
| 5 | never takes the radio | squawks every 25 s then 40 s; objective `Take the radio`; the keypad stays dead forever; nothing opens by timer |
| 6 | tries the keypad before Kessler powers it, with the right code | `Keypad — no power`; the UI does not open; `keypad_dead` |
| 7 | types wrong codes | `CODE REJECTED`; after one, the Q hint; after three, the code in the objective |
| 8 | kills `g5_s1` before the units (shoots him through the open ready door) | allowed: he releases himself when shot; the radio sits at his corpse point (B2: above his wreck box, its ray ignores that box); the units keep coming; the pickup sequence runs over the fight (radio) |
| 8b | kills `g5_s1`, then dies before taking the radio | `cp5_ready` (or `cp5_duty`) restores; `afterReplay` sees `radio` false and re-spawns him in `hold` — the radio comes with him (B1) |
| 9 | never enters the ready room | `g5_s1` leaves `hold` 20 s after the units die / 45 s after H and comes for him |
| 10 | tries Kessler's door before anything else post-keypad (or reaches it through berths → mess, skipping `t5_spine_mid`) | entering `t5_cmd` spawns `g5_spine` if it never spawned and plays `l5_kes_door_wait`; the beat starts once it is fought and door-calm holds (S2) |
| 10b | a stray (a searching soldier, a skitter in the pit) keeps door-calm false | door-calm counts only hostiles in the spine or within a 30 m path; the stray rule removes an awake hostile unseen ≥ 30 s and ≥ 25 m away (S2) |
| 11 | tries the tunnel door first | `l5_unit_tunnel_co`; Q → `l5_kes_hint_door` |
| 12 | stands on the line already facing down the spine, looking at his feet | yaw within ±50° of −x counts, pitch is ignored: he hears `l5_kes_door_hold` "Stay like that." and passes in 1.2 s with the tally turning white (B3) |
| 12b | turns his back, then walks off mid-check | `l5_kes_door_away`; tally back to amber, the silhouette stops; the check resets and resumes when he returns |
| 13 | enters the crawl first (before the spine wave) | allowed; `t5_spine_mid` is above y −0.5 so the wave does not fire from the crawl; the 45 s timer waits until he is out; `v5_boots` fires 2 s after `t5_crawl_e` and stops the patrol ahead of him; `g5_mag` wakes per its rule (its lamp-pop tell is exempt from scare spacing) |
| 14 | enters the crawl during a fight | enemies target the exits and stand off 2–5 m from them, never in the walkway beside the pit (the corridor stays passable); no scare fires (not calm); no checkpoint below; skitters cannot follow (nav false; the pit is a nav obstacle) |
| 15 | goes down the open spine hatch with a soldier at the top | the soldier can shoot down into the pit (no grating there); the player can shoot back; fair |
| 16 | shoots up through the grating at the patrol | sparks; the grating stops rounds; the patrol is alerted by the noise and goes to the hatch exit |
| 17 | opens the magazine hatch from below, then never goes back into the crawl | fine — that is the second way out |
| 18 | drops off a gallery to the sub-bay floor | allowed (rail 1.1 m); stairs both ends bring him back up |
| 19 | uses the wheel before the bay wave A is dead | allowed: `g5_bay_b` joins; the tunnel opens at + 4 s; `cp5_bay` only if a calm moment comes |
| 20 | runs into the tunnel with enemies behind | latch; the end waits only for hostiles inside (stranded rule) |
| 21 | never visits the sub bay before V | `v5_sub_check` waits for a calm moment there; the boards say `COMPLETE` after V anyway (the set-up holds) |
| 22 | presses the launch palm | refused (`NOT ROSTERED — REYES, S.`), the unit line, `l5_kes_boat` (C), fact `l5_boat` |
| 23 | dies in the duty fight | `cp5_duty`: placed at `mk5_c1_end`, scene not replayed, units again from H + 1.5 / 2.5, `g5_s1` holding |
| 24 | dies to the first soldier | `cp5_ready` (units cleared, soldier re-spawned holding) — or `cp5_duty` if he engaged before the units died |
| 25 | dies in the spine wave / in the magazine | `cp5_radio` (keypad powered, radio owned, lines resume from the first not heard) |
| 26 | dies after the door beat (vent wave, bay wave A) | `cp5_door`: V, dark, Kessler's lines not repeated, `g5_cmd` replays |
| 27 | dies during the wheel's wave | `cp5_bay` (V or W as saved) |
| 28 | arrives by `?level=5` cold | direct loadout (§7) incl. carbine 30/90 and armour 50, facts default `stop`; starts in lock5; every beat works (no fact a beat needs is missing: `testHour` defaults) |
| 29 | arrives with no carbine in the carry (3b lets him skip it) | the first carbine soldier he kills drops **the carbine** (`g5_cmd`'s soldier is on the main route before the bay; `g5_patrol` if met); `p5_arm_carbine` in the armoury too (S6); before that pistol + shotgun suffice (2 husks, 2 pistol soldiers) |
| 30 | stands still in the open against two soldiers | ≈ 12 s to die (≈ 18 s with a vest); first bursts miss; whizzes and impacts tell him where fire comes from |
| 31 | runs the flashlight empty in the dark sub bay | it dies with the 0.5 s flicker and `flashlight_die`; he can relight at 15 % (0.6 s of recharge + 0.25 s settle); the floor, stairs and wheel stay readable meanwhile (§2.7.3); soldiers see him at 12 m unless he fires |

---

## 10. Test plan

### 10.0 Story hook contract (written first; T builds to it, ST implements **exactly** this list — S4)

On `window.__game.story` (level 5), the same shape as level 4 plus the additions marked +:

| hook | contract |
|---|---|
| H1 `end()` | jump to `l5_end` (carry written) |
| H2 `checkpoint(id)` | load / write a `cp5_*` |
| H3 `fire(name)` | `gate`, `scene`, `units`, `release_s1`, `radio` (take it), `power`, `code` (enter 4719), `spine_wave`, `boots`, `door` (start the beat), `verify` (complete the check), `dark`, `cmd_wave`, `bay_a`, `wheel`, `bay_b`, `tunnel`, or any vignette id (incl. `id:snap`) |
| H4 `hurry(fast?)` | shorten `wait`s (never `hold`s, never line gaps) |
| H5 `lineLog` | `{ id, t, said, q, dur, end, cue }` per line (`|t − cue| ≤ 0.12`) |
| H6 `rules` | the RULES table (id → when/else/once) |
| H7 `debugState` | `{ level, now, beats, t, phase, phaseApplied, flags, checkpoints, checkpoint, restoredFrom, calm, doorCalm, heard, missingMarkers, loadout, arrival, ended }` + `scares: string[]`, `scareLog: { id, t, room }[]`, `radio: { owned, live, pos: [x,y,z] \| null, enabled }`, `keypad: { powered, open, wrong, accepted }`, `door: { started, check (0 … 1), facing: 'door' \| 'away' \| 'side', done }`, `wheel: { startedAt \| null, doneAt \| null }`, `groups: Record<id, { spawned, alive, awake, holding, triggered }>`, `scene: { times, result, h }`, `spawnLog: { group, id, t, pos: [x,y,z], visible }[]`, `strays: { id, t }[]` |
| H8 | beats `l5_*` on `story:beat`; `__game.facts` |
| H9 | `story:objective` / `story:toast` texts as §6.4 |
| + H10 `keypad(code)` | types `code` into the open keypad UI (opens it if the player is at the panel) and presses ENT; with K's stub UI it sets `__game.debug.keypadInput` and presses `Use keypad` |
| + H11 `radioAsk()` | = pressing Q |
| + H12 `soldiers()` | `[{ id, group, pos: [x,y,z], state, aware, holding, token, light, cover, hp, suppression, shots, hits, bursts }]` (from `enemies.debug.soldiers()`, W3b) |
| + H13 `worldState()` | `{ doors: Record<id, { open, locked, status }>, hatches: { spine, mag }, lightsOut, dark: string[] (regions.dark room ids), screens: Record<id, string>, pickups: string[] (taken), groups, scares, flags, torch: number }` — the object `--checkpoints` compares before death and after load |
| + H14 `audioLog()` | `audio.debug.log` (W2b): `{ id, t, pos }[]` — `--scares`' one-owner audit |

T's first deliverable is `playthrough-l5.mjs --contract`: asserts every hook and field exists on ST's greybox build.
T may not assume anything not in this table; ST may not rename or add to it without editing this table first.

### 10.1 `scripts/playthrough-l5.mjs` (`npm run play:l5 -- <url>`, static build; T)

- **default** (`--choice=stop,command`): every beat in order; doors per phase; gate 2.4 s; the scene: camera taken on
  `t5_dutydoor`, H ≤ 25.0 s, every scene line ≤ 0.12 s from its cue, units visible ≥ 8 m away 2.5 ± 0.1 s after H,
  `cp5_duty` at H; `g5_s1` holds (state `idle`, not in `activeCount`) then is released; the radio point sits above
  his wreck box and `radio5` is enabled from 1.5 m; squawk at death + 30 s if not taken (a variant
  waits); pickup sequence order; keypad dead before the power cue (end of `_4`), alive after, Q live from it; 4719 accepted (and `_9b` when typed
  during the sequence); the spine wave; the door check (yaw set by the script: ±50° of −x passes at pitch −60°, the facing
  line is `_3` / `_hold` by the start facing; tally white during the count) and V; `lights_out5`; `cp5_door`; bay waves; the wheel's 4.0 ± 0.1 s; the tunnel latch;
  end card; carry (`from: 5`, `kills5`, `radio`, `kessler`, `l5_door`, `testHour`); stored level 5.
- **--checkpoints**: per `cp5_*`: play to it, die, load, compare H13 `worldState()` + phase, armour, weapons, facts,
  finish. Extra cases (B1): kill `g5_s1`, die before the radio, load `cp5_ready` → soldier holding at `mk5_s1`, radio
  takeable after he dies again; die with the patrol holding → after the load it is absent and `cp5_spine` was takeable.
- **--impatient**: sprints; wrong order (keypad before power, tunnel door before the beat, wheel before V — disabled,
  palm on the launch console); wrong codes (1, 3); shoots the duty door, the port, the booth glass, the boat, every
  body; kills `g5_s1` through the door during the unit fight; oracle per conditional line; choice-variant check.
- **--order** (a–f): (a) straight to Kessler's door after the keypad; (b) every optional room first, crawl last; (c)
  crawl first, then the door; (d) sub bay before the door (`v5_sub_check`, the locked tunnel); (e) never the armoury or
  the crawl; (f) the launch palm before the door.
- **--softlock** (a–i): (a) stay in lock5 120 s; (b) gate doorway during the latch; (c) never take the radio for 180 s,
  then take it; (d) hide in the crawl during the spine wave for 60 s, then come out; (e) hide in the magazine during the
  bay wave A; (f) leave `t5_cmd_line` five times during the check; (g) jump off the gallery during wave B; (h) enter the
  tunnel with two enemies alive behind; (i) tunnel doorway during the latch. Each reaches `l5_end`.
- **--scares**: each `v5_*` fires exactly once on a calm route; none fires with a hostile awake within 30 m (forced
  fights during their triggers); ≥ 45 s apart; loud ones ≥ 90 s apart; snaps on every checkpoint restore; their sounds
  played once each (audio log) — no doubles from story and level.
- **--ads** (carbine aim is merged: RMB hold, `player.debug` aim hook): spine and bay soldiers at 20 m — hit rate aimed
  ≥ 2 × hip fire over 60 s each.
- **--frames**: 10 fps sequences of §10.5 → `shots/l5/frames/`.
- **all modes**: spawn visibility (ray to each member's chest at every spawn; fail if visible unless through a door,
  vent or drain that opened in the last 3 s); every `mk5_` marker exists and lies inside a room interior; never
  `state === 'cutscene'` outside the scene; no enemy before its beat (only `g5_mag` dormant from load); static pass: every
  `l5_` id ↔ one RULES entry ↔ manifest; choice pairs complete; no uppercase in any `unit` line's `spoken`; every
  `soldier` line has `label` and fx `throat`; every `kessler` line fx `radio`.

### 10.2 `check:reach`
`levelsOf('all')` → [1 … 5]. Phases A … X, `use` and the new `mustNotUse` (R8 with line of sight), region-floor
assertion, stress floors (incl. −2.6, −1.4, 4.8), ALWAYS5, the one-way `hatch5_mag`. Levels 1–4 unchanged.

### 10.3 `check:nav` level-5 cases (real speeds; husks rushed = 4.0 m/s, soldiers 1.6 m/s)
Reach: ready spawn → duty (−4, 0, −23.6) → (0, 0, −13) ≤ 6 s (husk rushed); dive → spine mid (49, 0, −31) → (26, 0, −16)
≤ 12 s husk / ≤ 30 s soldier; lockacc → north gallery via `STAIR5_E` (42, 0, −58) → (34, 4.8, −20) ≤ 40 s soldier;
lockacc → west gallery wheel via `STAIR5_W` (41, 0, −57.6) → (23.6, 4.8, −52) ≤ 15 s husk; drains → bridge (28, 0, −48)
and (39, 0, −36.5) → (34, 4.8, −35) ≤ 8 s skitter; vent landing → `t5_cmd` (30, 0, −16) → (42, 0, −16) ≤ 4 s skitter.
No nav node on any `nav: false` floor; no node inside the hatch pit or the magazine hatch box (obstacles from load); the
lower stairs carry no `navStair`; `nav: false` floors excluded from the floor-without-node test. (The exits behaviour is
W3b's `check:soldier` 16 — it needs the enemy code, S5.) Stand-off: player latched in
tunnel5, husk outside. Ramps: `STAIR5_W`, `STAIR5_E` drift < 5 cm in 10 s; the ship stairs `STAIR5_HATCH`,
`STAIR5_MAG_OUT` for the player capsule (climbable, rise 0.28 / 0.289 < 0.55 step). Cover: every `cv5_*` reachable from
its set's spawn. `ignoreFloors: ['cmd:main']`.

### 10.4 New and extended checks
- **`check:soldier`** (W3b, §8.2.10).
- **`check:dark` with the battery** (T; `scripts/check-dark.mjs` gains `--level 5` and battery-aware views):
  `?level=5&nostory=1&noenemies=1&autostart=1&quality=low|medium`, `level.vignette('lights_out5')`,
  `level.vignette('dark5_on')`. The merged script already judges every view twice (lamp on at full charge; lamp OFF:
  ≥ 1.5 % of pixels lit, frame mean ≥ 0.015) — kept for level 5, with three level-5 measures added (luma, sRGB):
  1. **no-light** (`player.debug.torch(0)`, lamp off): every door frame, stair nosing, gallery edge and required
     interactable within 10 m in line of sight p95 ≥ 0.10; outer-ring strips ≥ 3 %; frame mean ≥ 0.025;
  2. **light** (`player.debug.torch(1)` or `?torch=inf`, lamp on): the existing metric (cone ≥ 0.16, detail ≥ 0.08,
     frame ≥ 0.04, targets p95 ≥ 0.12);
  3. **glow** (`noenemies=0`, debug `enemies.spawn` of a soldier in `hold`, a husk, a skitter at 10 / 20 / 30 m in the
     dark sub bay and the crawl): each enemy's `mark()` covers ≥ 2.2 px with luma ≥ 0.5 (lamp off); the soldier's mark is
     red (hue check), never cyan.
  Views (inside rooms, asserted with `roomAt` and a 0.3 m inset): spine `spawn=12,0,-16,-90` and `=38,0,-15,90`; crawl
  `=34,-1.4,-16,90` and `=20,-1.4,-16,90` (crouched); magazine `=17,-2.6,-24,180`; berths `=18,0,-8,0`; sub bay floor
  `=34,0,-22,0`, `=30,0,-46,-90`; west gallery `=23.6,4.8,-30,0`; the wheel `=23.6,4.8,-50,90`; bridge `=34,4.8,-35,0`;
  dive `=48,0,-34,-90`. **Dark run**: a scripted walk of the main route after V (spine → `d5_bay` → `STAIR5_E` → bridge →
  west gallery → wheel → `STAIR5_W` → tunnel door) sampling every 2 m with the flashlight off — fails on > 4 consecutive
  failing samples of measure 1. PNGs to `shots/l5/dark/`. Thresholds calibrated with `--measure` on real frames at IA (as
  3b IA item 9), never loosened below these.
- **`check-voice-level --level 5`** (coordinator's script; ST hands a diff with the listener points of §8.13, IA applies it).
- **`check:cutscene`**: the level-5 scene in the awkward-entry set (sprint, backwards, mid-jump, mid-reload, note open,
  fire held, crouched); camera = shot table; hand-back continuity; skip only once seen; ≤ 25 s.
- `check:doors` (every `d5_*`, incl. the `wide` gate), `check:decals` (leaves, hatch lids, drain grilles, the boat's
  hatch, the wheel), `check:zfight`, `check:wreck` (a dead soldier on a stair, on a gallery, on the grating; a dead husk
  on the crawl hatch lid), `check:fxleak --level 5`, `check:chain` (§8.1), `check:cards` (the `POST 4` card),
  `check:weapons` unchanged.

### 10.5 Frame sequences (10 fps) — look at
The gate rising; the turnstile + counter; **the whole cutscene** (door opening on him, his stillness, the turn, the nape
LED blinking at 30° FOV, the walk-out); the units through the door; `g5_s1` coming into view as the player steps in line with the door;
his first engagement from cover (rise with the light on, aim, burst, back into cover) at 12 m; his death and the mark
failing; the radio pickup
with the HUD strip; the keypad UI; a soldier reload heard and seen; the spine wave in a 36 m corridor with ADS; the crawl
from the hatch to the magazine including the boots overhead; the magazine lamp popping; each scare once; Kessler's door
with the port silhouette; `lights_out5` from the spine; the dark sub bay from the north gallery (beacons, LEDs, weapon
lights, muzzle flashes); the wheel under fire; the boat's pre-launch check; the end card.

### 10.6 Performance views (`shot.mjs --perf`, LOW, MEDIUM, HIGH)
(1) gatehouse `?level=5&spawn=0,0,-2,0`; (2) duty → ready through the open door with 2 husks + soldier
`spawn=0.4,0,-13.8,20`; (3) spine from `d5_key` looking east `spawn=9,0,-16,-90` (side doors open, 2 husks + soldier);
(4) crawl `spawn=34,-1.4,-16,90` crouched; (5) **sub bay lit** from `d5_bay` `spawn=34,0,-19,0`; (6) **sub bay dark**
from the north gallery `spawn=34,4.8,-20,0,-15` with `g5_bay_a` + `g5_bay_b` spawned and fighting — **run on W4's greybox
with the nine enemies as soon as W3a + W4 merge**, before D3 dresses, and give D3 the real room budget (review note); (7) bridge looking at
the console `spawn=34,4.8,-35.5,0`; (8) tunnel looking back into the bay `spawn=18,0,-53,-90`. Budgets §2.7.5.

---

## 11. Build order — task graph for parallel worktree agents

Rules (3b's `stage-3b-agent-rules.md`, copied by K to `docs/plans/stage-3c-agent-rules.md` with "3b" → "3c", plus the 3b
integration lessons — coordinator 6):
1. **Every task starts with `git merge --ff-only main`** in its worktree (worktrees are created from an old commit); that
   is the only git command that changes anything a task may run. No add / commit / stash / checkout.
2. One owner per file at a time; the coordinator merges each task's patch **restricted to the paths its row owns**; a
   change needed elsewhere is described in the report, not made.
3. Every task builds into **its own dist directory and port** (`npx vite build --outDir <scratchpad>/dist-<id>`,
   `vite preview --port <own> --strictPort`), never 5173 or the shared `dist`, and stops its servers at the end.
4. **Browser checks one at a time** (they falsify each other's timing); run your own test and the one or two checks your
   change can affect, not the suite.
5. **T writes the hook contract (§10.0) into its script first; ST implements exactly that list.** Neither renames or adds
   a hook without editing §10.0.
6. Every task ends with `npm run typecheck`, `npm run build`, its own test and the level 1–4 checks it could affect.
Models: **Opus** (spawned explicitly) for design-heavy work, **Sonnet** only for small, tightly specified tasks.

```
             ┌─ W2a ui (radio strip, keypad overlay) ──────────────┐
             ├─ W2b audio (ids, radio/throat fx, torch sounds, log)┤
 K ──────────┼─ W3a soldier body + rig + marks + actor ─┐           │
 contract,   ├─ W3b soldier AI + StubSoldierRig + check-soldier ─┴─► soldier-in-motion REVIEW (needs W3a + W3b)
 chain,      ├─ W4 greybox + phases + cover + crawl/nav + stairs + snap ─┬─► perf view (6) on greybox (W3a + W4)
 stubs       ├─ W5 materials + screens ───────┤                         │
             ├─ W6 fx (tracer, drips, wet, port, fxleak 5) ┤             ├─ D1 fore (lock5 … ready5) ────────────┐
             ├─ W7 set pieces (boat, doors, hatches, wheel)┤             ├─ D2a spine + crawl + armoury/magazine ┤
             ├─ W8 kit5 (props) ──────────────────┘          wave 2 ──► ├─ D2b berths, heads, mess, galley ─────┤
             └─ W9 voices (provisional Kessler pick by measurement) ┐   ├─ D3 sub bay, dive, lockacc, tunnel ───┼─► IA logic ─► IB look ─► user
                                                                    │   ├─ ST story (implements §10.0) ─────────┤
                                                                    │   └─ T tests (writes §10.0 first) ────────┘
                                                                    └───────────────────────────────────────────► (IA: check-voice-level)
  merged on main before this plan's build: flashlight battery, carbine aim, enemy dark-room marks (facts, §8.14).
```

| id | task | model | files owned | inputs | done when |
|---|---|---|---|---|---|
| **K** | contract + chain + stubs (§8.1) | Opus | `src/core/types.ts`, `src/core/progress.ts`, `src/core/debug.ts`, `src/story/save.ts`, `src/story/chain.ts`, `src/story/index.ts`, `src/story/camera.ts`, `src/story/l4/index.ts`, `src/story/l4/text.ts` (hand-over card), `src/level/index.ts`, stubs `src/level/l5/index.ts` + `src/story/l5/index.ts`; placeholder lines (`// K placeholder`) in `src/enemies/index.ts`, `src/enemies/manager.ts` (`release` = `wakeGroup`, `corpsePoint` = null), `src/audio/voicefx.ts`, `src/audio/voice.ts` (POS stubs), `src/ui/index.ts` (radio no-op; keypad stub resolving `__game.debug.keypadInput`), `src/materials/screens.ts`, `src/materials/defs/index.ts`, `src/level/assemble.ts` (`cover` default `[]`); `scripts/lib/check-common.mjs`, `scripts/check-chain.mjs`, `scripts/playthrough-l4.mjs` (end-card assertion per `nextOf(4)` only), `scripts/levelgrep-allow.txt`, `package.json` (`play:l5`, `check:soldier` via `optional.mjs`), `docs/CHECKLIST.md`, `docs/plans/stage-3c-agent-rules.md`, `docs/plans/stage-3c-k-notes.md` | this plan | typecheck + build; `check:chain` green incl. `?next=4:5`; `?level=5` boots the stub; 3b's end on main unchanged; L1–4 playthrough defaults green; `play:l4` default |
| **W2a** | UI: radio strip, keypad overlay (pointer stays locked: virtual cursor + digit keys; closes on damage without unlocking), `radio` subtitle class, soldier labels in CHOIR colour, toasts | Sonnet | `src/ui/**` | K | ui dev harness: strip live/idle; keypad by mouse deltas, keys, Esc, damage close — pointer never unlocks; subtitle classes |
| **W2b** | audio: every id of §8.11 not marked "exists" — incl. **`flashlight_die` / `flashlight_dead` on `player:flashlight` `cause: 'empty' / 'refused'` (all levels, coordinator 5a)** and **`audio.debug.log`** (S4); `radio` / `radio:1` / `throat` fx + POS profiles (`throat` ref 5.5); ambiences; room presets; `wet` footsteps | Opus | `src/audio/**` | K | audio dev page plays every id and fx; the torch sounds on a real empty / refused toggle in level 4; `check-voice-level` unaffected on L1–4 |
| **W3a** | soldier body, rig API (§8.2.2), LODs, Clasp/radio **marks** (red blinking, never cyan) + mark blink option, weapon light, death ×3, actor mode | Opus | `src/enemies/soldier/{model,rig,actor}.ts`, `src/enemies/dev/soldier.html`, `src/enemies/dev/soldier.ts`, `src/enemies/shared/rig.ts` (a per-mark blink option only; husk/skitter/sentry/foreman marks unchanged) | K, W5 materials (fallbacks until then) | dev page: every pose, death ×3, mark states, actor; draw calls as stated; L1–4 enemies' marks unchanged (dark-room frames) |
| **W3b** | soldier AI (§8.2.3–8.2.7, 8.2.9, the tuning table), `hold` / `release`, `corpsePoint`, registration + pre-warm in `index.ts` / `manager.ts` (tokens, damage cap, `enemy:fired`, `debug.soldiers()`), nav `exits` + stand-off in `enemies/nav.ts` and `enemies/ai.ts` (S5), `StubSoldierRig`, `scripts/check-soldier.mjs` (incl. 15 hold, 16 exits) | Opus | `src/enemies/soldier/{soldier,cover,fire,stubrig}.ts`, `src/enemies/index.ts`, `src/enemies/manager.ts`, `src/enemies/nav.ts`, `src/enemies/ai.ts`, `scripts/check-soldier.mjs` | K, the rig interface §8.2.2 (stub rig until W3a lands) | `check:soldier` 1–16 green; `check:nav all` green; L1–4 nav hashes unchanged |
| **W4** | greybox §2, phases §3, cover §5.4 + self-test, crawl floors (`nav: false`, exits, bounds from floors), `StairDef.y0` / `nav: false`, nav obstacles (pit, magazine hatch), hatch lids as movers, the `wide` gate's two sounds, keypad / radio / wheel / palm interactables, `:snap` vignette convention, `mustNotUse`, markers §8.10, dressing stubs | Opus | `src/level/l5/{index,grey,phases,cover}.ts`, stubs `src/level/l5/{fore,spine,quarters,bay}.ts`, `src/level/context.ts`, `src/level/nav.ts`, `src/level/assemble.ts` (bounds from floors), `src/level/doors.ts` (wide-door sound hook), `src/level/l3/grey.ts` (`buildStair` `y0` / `nav` only), `scripts/check-reach.mjs`, `scripts/check-nav.mjs` | K | `check:reach --level 5` A … X green (every `p5_*` in `use`), and `check:reach all` + `check:nav all` once (shared files); `check:doors`, `check:nav --level 5` green; zfight clean; `selfTest` (cover, markers inside rooms); scripted route walk (one frame per room) |
| **W5** | materials + screens (§8.9; `aas_palm` uses `palm`) | Opus | `src/materials/**` | K | dev gallery under lit / red / beacon light; screen states |
| **W6** | fx (§8.12) + `check:fxleak --level 5` views | Opus | `src/fx/**`, `scripts/check-fxleak.mjs` | K | fx dev scenes; fxleak levels 3, 4, 5 |
| **W7** | set pieces (§8.8) | Opus | `src/level/l5/setpieces.ts`, `src/level/dev/setpieces5.{ts,html}` | K, W5 (fallbacks) | dev page: boat check sequence, doors (incl. the booth back door), hatches (south hinge), wheel; calls as stated |
| **W8** | kit5 props (§8.9, incl. the four equipment boxes, per-shelf rack colliders) | Opus | `src/level/l5/kit5.ts`, `src/level/dev/kit5.{ts,html}` | K | dev page: every prop, ≤ 2 calls each, breakable lamp, tray debris, locker door |
| **W9** | voices: `kessler` auditions + **provisional pick by measurement** (coordinator 3; the user may swap later), `soldier` alias, `lines.l5.json` = §6.2 verbatim (id, speaker, label, text, spoken, note, fx, `cut` for `l5_kes_6`), generation | Sonnet | `voice/cast.json`, `voice/lines.l5.json`, `voice/manifest.json`, `voice/auditions/kessler*`, `public/voice/l5_*` | this plan; W2b for listening by the user later | `voice:check` green; `cut` inside the file after "of"; the pick and its measurements in the report |
| **D1** | dressing + lights: lock5, gate5 (booth with Aas's palm plate and back door), duty5, ready5 (camera); vignettes `gate5_open`, `gate5_booth`, `v5_turnstile`, `v5_hull_groan`, `key5_power` | Opus | `src/level/l5/fore.ts` | W4, W5, W7, W8 | perf views (1), (2); zfight/doors/decals on its rooms |
| **D2a** | dressing + lights: spine5 (risers, grating, hatch pit, Kessler's door + port + line), crawl, arm5 + magazine (bounded lights); vignettes `hatch5_spine_open`, `hatch5_mag_open`, `v5_magazine`, `cmd5_line`, `cmd5_port_look`, `vent5_spine`, the spine half of `lights_out5` (by group); the `v5_body` smear decals and the B position's floor | Opus | `src/level/l5/spine.ts` | W4, W5, W6, W7, W8 | perf (3), (4); `check:dark` crawl/magazine/spine views (with T's script) |
| **D2b** | dressing + lights: berths5, heads5, mess5, galley5; vignettes `v5_bunk_radio`, `v5_water`, `v5_trays`, `v5_galley_shape`, `v5_body` (its code and the body prop) | Opus | `src/level/l5/quarters.ts` | W4, W5, W6, W8 | zfight/doors; frames of each scare |
| **D3** | dressing + lights: sub5 (galleries, stairs, parapets, boat placement, cradle, equipment boxes, rails, crates, forklift, racks, beacons, strips, wet patches, drips, lock port, one frame zone for the five doors), dive5, lockacc5, tunnel5; vignettes `v5_sub_check`, `wheel5_turn`, `drain5_a/b`, the bay half of `lights_out5`, `dark5_on` | Opus | `src/level/l5/bay.ts` | W4, W5, W6, W7, W8; the greybox perf view (6) numbers | perf (5)–(8) in budget; fxleak for drips/port; `check:dark` bay views |
| **ST** | story level 5 (§4, §5, §6, §7, §8.6, §8.7, §8.10, §8.13, §10.0): `spawnGroup` + `release` for held soldiers, level-5 `calm()` / door-calm / stray rule, `afterReplay` re-spawn of `g5_s1`, radio point, neck check, scares, Q, keypad judging; a diff for `check-voice-level` | Opus | `src/story/l5/*` (replaces K's stub) | K, W4 (markers), W3a actor (falls back to a husk actor until it lands — logged) | `play:l5 --contract` + default + `--checkpoints` green on the greybox, both choices |
| **T** | tests: `playthrough-l5.mjs` (§10.1, **`--contract` first**), `check-dark.mjs` level 5 (no-light / light via `player.debug.torch`, glow, dark run) | Opus | `scripts/playthrough-l5.mjs`, `scripts/check-dark.mjs` | §10.0 (not ST's code); ST's greybox to run | all modes run; failures listed with the hook/beat that failed |
| **IA** | integration — logic, tests, sound: `LEVELS[4].next = 5` (3b → 3c hand-over live; `play:l4` through it); dressing + story + soldiers together; every `play:l5` mode on the DRESSED level; `--scares` owner audit with `audio.debug.log`; rushed-wave arrival times measured; `check:dark` thresholds calibrated (never below §10.4); ST's `check-voice-level --level 5` diff applied and passed; full CHECKLIST levels 1–5; **`docs/DESIGN.md` controls line updated for aim (RMB hold), crouch, flashlight cell, Q radio (coordinator 5c)**; DESIGN.md REVISION 10 (D10, D11, D13–D15, D17, D18 canon) | Opus (coordinator) | everything for fixes | all wave 2 | CHECKLIST green |
| **IB** | integration — look and performance: every perf view on LOW/MEDIUM in budget (report HIGH); lights-out mood (a blackout, not a blue corridor); the nape mark read in the scene frames; the boat hero shot; soldiers in the dark; wet floors; the crawl; door frames (`navy` styler, pressure doors hazard); walk every room lit and dark in frames. **Plus three dim emergency glows where a walkable spot is fully black with the lamp off (coordinator 5b):** level 3 kitchen after the takeover at (−22.7, 0, −47), level 3 `ring_e` after the takeover at (29.6, 0, −29.9), level 4 `bay` under lights-out at (16.3, 4.8, −19) — each must pass the merged lamp-OFF rule | Opus | everything for fixes (after IA's merge), incl. `src/level/l3/*`, `src/level/l4/clean.ts` for the three glows | IA | frames looked at; budgets met; `check:dark` levels 3, 4, 5 lamp-off green; user hand-play |

Ownership check (disjoint, per wave): **K** alone first. **Wave 1** — `src/ui/**` W2a; `src/audio/**` W2b;
`src/enemies/soldier/{model,rig,actor}.ts`, `enemies/dev/soldier.*`, `enemies/shared/rig.ts` W3a;
`src/enemies/soldier/{soldier,cover,fire,stubrig}.ts`, `enemies/{index,manager,nav,ai}.ts`, `check-soldier` W3b;
`src/level/l5/{index,grey,phases,cover}.ts` + the four stubs, `level/{context,nav,assemble,doors}.ts`, `level/l3/grey.ts`,
`check-reach`, `check-nav` W4; `src/materials/**` W5; `src/fx/**`, `check-fxleak` W6; `level/l5/setpieces.ts` +
`level/dev/setpieces5.*` W7; `level/l5/kit5.ts` + `level/dev/kit5.*` W8; `voice/**` (listed) W9. K's placeholder lines
pass to W2a (`ui/index.ts`), W2b (`audio/*`), W3b (`enemies/index.ts`, `manager.ts`), W4 (`assemble.ts`), W5
(`materials/*`) after K merges. **Wave 2** — `fore.ts` D1, `spine.ts` D2a, `quarters.ts` D2b, `bay.ts` D3, `story/l5/*` ST,
`playthrough-l5`, `check-dark` T. `v5_body`: its code and prop are D2b's (`quarters.ts`); D2a only places the smear decals
in the spine and the B floor in `spine.ts`. Wave 1 = 10 parallel tasks + W9; wave 2 = 6 parallel tasks.

Reviews / full runs worth it (speed): this plan (done); after K `check:chain` + `play:l4` default; after W4 `check:reach /
nav / doors` level 5 plus `check:reach all` + `check:nav all` once; **after W3a + W3b: the soldier-in-motion review on the
dev page** (the stage's risk; the S3 numbers are confirmed or retuned there); **after W3a + W4: perf view (6) on the
greybox with the nine enemies**; after ST on the greybox: `play:l5 --contract` + default + `--checkpoints`; after
D-tasks: their perf views, `check:fxleak`, `check:dark`, `check:zfight`; IA everything once; IB frames; then the user's
hand-play. No review for W2a, W2b, W5, W6, W8, W9.

---

## 12. Review focus — still open

1. **Soldier tuning** (§8.2.5) — the S3 table is the starting point; the soldier-in-motion review after W3a + W3b
   confirms or retunes it (one table, `SOLDIER_TUNING`).
2. **The neck check** (§4.7) now measures horizontal yaw with live feedback (B3); if the hand-play still finds it odd, the
   fallback (Kessler checks on the door camera, no player action) remains — not planned.
3. **The sub-bay budget** (≤ 270 calls with nine enemies in the dark) — measured on the greybox after W3a + W4, before D3
   dresses; fallbacks: LOD1 at 10 m, enemy shadows only for soldiers, the boat's interior glow dropped on LOW.
4. **`g5_s1` not visible from the hand-back** (S1l, not adopted — §13): he is first seen when the player steps in line
   with the ready door. If the scene's frames want him visible at once, the fix is to move the ready door, not him.

---

## 13. Changes after review

Review: `docs/reviews/stage-3c-review.md` (verdict "build after fixes"). Coordinator decisions 1–6 applied as final.

| item | change (or why not) |
|---|---|
| **B1** holding soldier vs the stage base | Contract: a holding soldier reports `state 'idle'`, not hunting, awake; new required `EnemyManager.release(group)` (stub = `wakeGroup` in L1–4). `g5_s1` / `g5_patrol` are spawned with `spawnGroup`, enter `prog.triggered` only when released (`s1Free`, `patrolFree`); the level-5 `calm()` ignores a holding group; `afterReplay` re-spawns `g5_s1` in hold whenever `radio` is false (covers `cp5_duty`, `cp5_ready`, "killed him, died before the radio"); the patrol is absent after any load. D6, §4.2, §4.3, §5.1, §5.5 #8, §7, §8.1, §8.2.4, `check:soldier` 15, `--checkpoints` extra cases, order cases 8b, 24. |
| **B2** radio ray ends in the corpse box | `mk5_radio` = chest x/z at `max(chest.y, wreckBox.max.y + 0.08)` from the new required `EnemyManager.corpsePoint(id, 'chest')`; the R8 ray ignores the owner's own wreck box; `check:soldier` 10 tests the radio from 1.5 m for fwd / back-against-a-crate / side. D8, §4.3, §8.1, §8.2.6. |
| **B3** neck check measured the wrong thing | Test = feet in `t5_cmd_line` and horizontal yaw within ±50° of −x (pitch ignored) for 1.2 s; the line said depends on the facing (`_3` "Turn around." only when facing the door, else new `l5_kes_door_hold` "Stay like that."); feedback during the count (tally amber → white, the port silhouette moves; both stop on a reset); objective "turn your back to the door". The door stays interactive; §12's fallback is not needed. D12, §1, §4.7, §6.2, §6.4, H7 `door.facing`, order cases 12, 12b. |
| **S1a** 8 inverted cover normals | d2 −z, f3 −x, f5 −x, f8 +x, f9 +x, f10 +z, f11 +x, f12 +z; the wrong note under the table removed; the table now names each object's face. |
| **S1b** boat "high" cover fails the probe | f14–f17 now stand at four new cradle-side equipment boxes EW1/EW2/EE1/EE2 (h 1.3, `low`): (29.85, −32 / −40) n +x and (38.15, −32 / −40) n −x; boxes in §2.6 and W8. |
| **S1c** spine points tangent to riser and wall | x = riser face ± 0.55 (12.85, 14.85, 22.85, 21.15, 26.85, 27.15, 34.15, 40.15); z **−17.35 / −14.65** (0.1 m clear of the walls — the reviewer's −17.4 / −14.6 leaves 0.05 m, so 0.05 m more inward; still in the riser's lee). |
| **S1d** count | 41 points (8 + 2 + 8 + 17 + 2 + 4). |
| **S1e** low cover vs crouch eye | ready crates h 1.2; crouch eye 0.85; the safety ray (and the W4 self-test) tests chest **and** head. |
| **S1f** K start in the desk | (2.0, 0, −16.0). |
| **S1g** spine soldier in the chamber | (48.0, 0, −34.0). |
| **S1h** dive shells in the chamber | (51.4, 1.0, −29.0). |
| **S1i** pickups inside racks / out of reach | magazine racks have per-shelf colliders with open fronts and the pickups sit at the rack faces (x 18.5 / 15.5); berth shells on the bunk-end shelf (13.8, 0.7, −2.9); every `p5_*` is in `check:reach`'s `use` list (§3). |
| **S1j** magazine hatch use point under the stair | use point on the lid underside (21.0, −0.08, −26.4), radius 1.6 (eye at the stair foot ≈ 1.25 m away; the ray stays above the treads). |
| **S1k** magazine stair foot against the wall | `STAIR5_MAG_OUT` z0 −27.0 → top −24.3; hatch z −27.0 … −24.3; east rack z −26.2 … −22.4 (approach x 18.6 … 21.8, z −27.8 … −26.2 open); lid hinged on its south edge; the armoury rail moved accordingly (west + south, the wall is the east side; open north 0.5 m from `d5_arm_bay`'s opening). |
| **S1l** `g5_s1` not visible from the hand-back | **Not adopted as proposed**: recomputed, the line from `mk5_c1_end` (0.4, −13.8) to the suggested (−4.6, −36.6) still crosses z −22 at x −1.40, outside the door (x −4.8 … −3.2), and no point at the ready room's far end lies on a ray through the door from the placement without passing L1. The claim is dropped instead (§4.2, §10.5): he is first seen when the player steps in line with the door. `mk5_s1` stays (−4.0, 0, −36.6). |
| **S1m** nav over the pit; lower stairs | the hatch pit and the magazine hatch are nav obstacles from load; `StairDef` gains `y0` and `nav: false`; the three lower stairs use both (W4 owns `l3/grey.ts`'s `buildStair` change). §2.1, §2.6, §8.4. |
| **S1n** exit on the only route | enemies stand off 2–5 m from an exit, never inside the walkway box x 36.2 … 38.6, z −15.4 … −14.2. D20, §8.2.4, §8.4, `check:soldier` 16. |
| **S1o** gate sound with two owners | the door `d5_gate` owns both `gate_open_heavy` and `gate_close_heavy`; `gate5_open` only drives the dogs and the panel (§4.1, §8.11). |
| **S2** spine wave during the door beat | the beat starts only after `g5_spine` is fought; entering `t5_cmd` spawns it if it never spawned (+ `_door_wait`). |
| **S2** strays block door-calm | door-calm counts only hostiles in `spine5` or within a 30 m nav path; level-wide stray rule (unseen ≥ 30 s, ≥ 25 m → removed) during calm waits. |
| **S2** `t5_dutydoor` | polled every frame in B2. |
| **S2** cutscene precondition | "no awake hostile, none hunting, none in gate5 / duty5 / ready5". |
| **S2** radio sequence order / Q | power cue at `l5_kes_4`'s end; `l5_kes_9b` when the code is already in; Q enabled at the power cue; during the door check Q plays `_3` / `_door_hold`. |
| **S2** scare spacing / boots / body / hull groan | `v5_magazine` exempt from spacing (the wake's tell); `v5_boots` at `t5_crawl_e` + 2 s, the patrol stops at `clamp(playerX + 1, 18, 34)` (`t5_crawl_mid` replaced by `t5_landing`); `v5_body` needs a living `g5_spine` member unseen ≥ 15 s; `v5_hull_groan` may run over the radio sequence's gaps (it has no voice). |
| **S3** soldier tuning | Coordinator 2: the reviewer's numbers, all in one table (`SOLDIER_TUNING`, §8.2.5): aim 0.45 s with light + glint from the rise; a burst cancelled only by one hit ≥ 25 or a head hit; suppression gain ≤ 0.8 / s per shooter; torso × 0.8 (pistol / carbine 7 body hits); the player is lit 1.5 s after firing; first-burst reset only after ≥ 12 s unseen. TTK table, DPS figures, tests 1, 2, 4, 6, 11 updated. Confirmed at the soldier-in-motion review after W3a + W3b. |
| **S4** contract / hooks | `corpsePoint`, `release` required (stubs); H3 `release_s1`; H7 adds `doorCalm`, `radio { owned, live, pos, enabled }`, `door.facing`, `wheel { startedAt, doneAt }`, `groups.holding/triggered`, `spawnLog`, `strays`; H12 adds `pos`, `aware`, `holding`, `token`, `light`; new H13 `worldState()` (defined), H14 `audioLog()` (W2b's `audio.debug.log`). K's keypad stub resolves `__game.debug.keypadInput`; H10 uses it. Keypad overlay keeps the pointer locked (virtual cursor + digit keys), the story disables player control while it is open, a damage-close needs no re-lock. D27 / §8.14: RMB hold only; §6.1: provisional Kessler pick by measurement. Soldier template pre-warmed (W3b). |
| **S5** ownership / dependencies | W3b owns `enemies/ai.ts`; the LOS rule for the grating is written down (§8.4); the exits case moved from W4's `check:nav` to W3b's `check:soldier` 16; W3b ships `StubSoldierRig`; the motion review needs W3a + W3b merged; ST hands a `check-voice-level` diff, IA applies it; light bounds by floor (arm5 y ≥ 0, `mag5` y ≤ −0.1), the tunnel red point `all`; `throat` ref 5.5 (−1.7 dB at 6.7 m); `story/l4/script.ts` removed from K; `nav: false` floors excluded from the nav floor warning and test. W4 also gets `level/doors.ts` (gate sound) and `level/l3/grey.ts` (`buildStair`); W3a gets `enemies/shared/rig.ts` (a mark blink option only). |
| **S6** fiction | `door_2` → "The camera says you're clean. The cameras are his. I need to see your neck. With my own eyes."; `squawk_2` only in duty5 / ready5, and the ready room gets a camera; Aas's palm plate in the booth (screen `aas_palm`) and the booth's back door settling shut on arrival (`gate5_booth`, no figure); §1 ON POST 26 → 27; the naming rule reworded ("no navy screen says CHOIR controls anyone"); a carbine soldier's body gives the carbine if the player has none (+ `p5_arm_carbine` kept); the soldier's Clasp LED and halo are `RigBuilder.mark()`, red blinking in every living state, never cyan; halo 4 cm = 12 px at 1080p. |
| **S7** voice lines | `l5_kes_aas` cut (coordinator 1 — so its `spoken` is moot; "Aas" is spoken nowhere); Reyes `c1_2` stress to the phrase end; Kessler's uppercase kept only in `_5` and `door_2`; Reyes `r1` / `r2` with hesitation; `door_1` "Stop there. On the yellow line."; `_felt` without uppercase; `l5_kes_tunnel` at `l5_unit_wheel`'s end + 0.4; `l5_kes_contact` queued behind the pickup sequence and dropped if the wave is in sight; new `l5_kes_door_hold`, `l5_kes_9b`. 72 lines. |
| review note: budget | the five sub-bay doors in one frame zone; perf view (6) on the greybox after W3a + W4; §2.7.2 (d) counts the sentry's searchlight (4 of 8 spots). |
| review note: patrol light | the patrol walks with its weapon light on during `v5_boots` (D24, §5.1). |
| review note: battery debug | merged as `player.debug.torch(v)` / `?torch=inf` — used by `check:dark` (§10.4). |
| **Coordinator 1** | `l5_kes_aas` removed from §1, §6.2, §9, D15, threads; `_boat` and CHOIR's "steady hand" kept. |
| **Coordinator 2** | S3 numbers, one table, review after W3b (above). |
| **Coordinator 3** | aim = RMB hold only (D27, §8.14); Kessler: auditions + provisional pick by measurement, build does not wait (§6.1, W9). |
| **Coordinator 4** | merged systems as facts: battery numbers (D16, §2.7.3, §7, §8.14, `check:dark` keeps the merged lamp-OFF judgment and adds level 5's), carbine aim numbers (D27, §5.3, §8.14), dark-room marks (§2.7, §8.2.1, §8.14; soldier never cyan). |
| **Coordinator 5** | (a) `flashlight_die` / `flashlight_dead` in W2b (§8.11, §11); (b) the three dim emergency glows (L3 kitchen, L3 `ring_e`, L4 `bay`) in IB; (c) the DESIGN.md controls line in IA. |
| **Coordinator 6** | §11 rules: own dist and port, `git merge --ff-only main` first, browser checks one at a time, patches restricted to owned paths, T writes §10.0 first and ST implements exactly it (§10.0 completed per S4). |

Re-verified with the reviewer's arithmetic: every cover point against its object's face (0.55 m along `n`) and the
corridor walls (spine 0.1 m clear); the equipment boxes clear of the cradle (0.2 m), the stairs (`STAIR5_W` x ≤ 27.4,
`STAIR5_E` x ≥ 40.6), CA, CC, the forklift and the moved drain (38.5 … 39.5, z −37 … −36); the moved spine soldier and dive
shells clear of the chamber (x ≥ 49, z ≤ −36); the magazine stair foot (0.8 m of floor), the lid's south hinge, the use
point's reach (≈ 1.25 m from the stair-foot eye) and ray; the crawl exit (stair top z −15.5 meets the walkway edge −15.4;
stand-offs outside the walkway box); the hatch pit and magazine hatch as nav obstacles; the K start clear of the desk;
the hand-back sightline (not achievable — S1l). Ownership re-checked per wave after the W3a/W3b/W4 additions (§11).

Classes the 3b review attacked, handled up front in the draft (kept):

| 3b class | where handled |
|---|---|
| B1 leaf faces vs solid | §2.2 recomputed for 15 doors (the 3c review confirmed all 14 std doors) |
| B2 a screen says too much | no navy screen says CHOIR controls anyone; 3d's ending not spelled out |
| B3 the one sight cannot be read | the nape mark in a 30° FOV hold, two blinks, 12 px at 1080p |
| B4 unowned files | §11 ownership incl. `playthrough-l4.mjs`, `check-reach` / `check-nav`, `enemies/nav.ts`, `ai.ts`, `rig.ts`, `doors.ts`, `l3/grey.ts` |
| S1 spawns inside voids | vent/drain spawns beside the openings under solid ceiling / at y −0.3 |
| S7 checkpoint gaps | `cp5_ready`, `cp5_bay` |
| S8 sandwiches | bay waves sequential; the vent wave is skitters + one slow soldier |
| S11 optional members | D28 (`release`, `corpsePoint` required with stubs) |
| S12 task sizes | soldier W3a/W3b; dressing D1/D2a/D2b/D3 |
| integration lessons | §10.0 contract first; D26 rush; §8.11 owners + audio log; checks inside rooms; portals and one frame zone |
