# Review of the stage 3b plan (`docs/plans/stage-3b.md`): reviewer subagent, static read of the code at 16f5ea0

"§" means a section of the plan. Coordinates follow the plan's conventions. File:line references are to the tree at review time.

## Verdict: **build after fixes**

The layout is mostly sound. Of 19 doors, 17 fit their walls. Rooms touch only on boundaries. The stair fits (16 × 0.30 = 4.8,
16 × 0.5625 = 9.0 m, z −56 → −47). Triggers and markers lie inside their rooms. The phase table holds together, and the
hard-rule audit is better than 3a's. Four things must change before K starts:
- two doors that `check:doors` will fail;
- a roster that contradicts 3c and, under the user's rule, says too much;
- a theatre "sight" that the player cannot actually read;
- build-graph done-criteria that need files no task owns.

---

## BLOCKERS

### B1: Both air-shower doors fail `check:doors` (rule b, "open leaf not enclosed")

- **Where:** §2.1 `shower` x −1.2…1.2 (interior x −1.0…1.0); §2.2 `d4_shower_in` (0, 4.8, −6) and `d4_shower_out`
  (0, 4.8, −9).
- **Why it fails:**
  - An open std leaf spans |x| 0.82…1.62 (§ conventions).
  - Rule b (`scripts/check-doors.mjs:154-180`) casts a ray from each leaf sample along ±z. It needs a wall *face* within
    0.45 m on both sides.
  - On the shower side, the only face is the shower's end wall at z −6.2 / −8.8, and it spans |x| ≤ 1.0. For |x| 1.0…1.62
    the ray runs through solid grid, which has no faces (GreyGrid emits faces only where air meets solid).
  - Result: 4 of 5 sample columns of every leaf fail. The plan's check ("south of it solid for |x| > 1.0 ✓") tests the
    wrong thing. Solid is not enough; the test wants faces.
- **Fix:** widen the shower to x −2…2, the same as lock4 (interior ±1.8 covers 1.62).
  - Update `t4_shower` to x −1.8…1.8, the `fx4_shower` box and the jets.
  - Move Dahl to (1.5, 4.8, −7.6). The passage stays ≥ 2.4 m.
  - Alternatively, use 1.2 m doors (`w: 1.2`, leaf to 1.22) in a shower of x −1.6…1.6. The wider shower is simpler.

### B2: The navy roster states the takeover outright, and its count contradicts 3c (user rule + canon)

- **Where:** D10; §6.3 `term4_ctrl`; §6.4 `roster`, `node2_screen`; §6.2 `l4_choir_roster_*`.
- **Canon conflict:**
  - REVISION 7 (3c) and 7.1 say Kessler's handful *are clasped* but sit in the shielded command module, "the one room
    CHOIR's signal does not reach".
  - A roster that reads `LINKS ACTIVE: 23 / 23` with 23 red dots says every fitted sailor is linked. When 3c reveals the
    shielded soldiers, this screen is wrong.
- **User rule (coordinator message):** nothing in 3b may say outright that the sailors are being controlled.
  - `ASSIGNED CONTROLLER: … — CHOIR, NODE 2 (MON 08:40, OVERRIDE)` is exactly such a statement.
  - With D9's "red = driven", 23 red dots plus the word CHOIR is no longer a guess.
- **Fix (every text in 3b that states it explicitly, reworded so it stays implied):**

| id | as planned | reworded (implied) |
|---|---|---|
| `term4_ctrl` | `LINKS ACTIVE: 23 / 23.` / `ASSIGNED CONTROLLER: NONE [OVERWRITTEN] — CHOIR, NODE 2 (MON 08:40, OVERRIDE).` / `CO: CDR M. KESSLER — NOT FITTED.` | `FITTED: 23. LINK: 19 ACTIVE · 4 NO SIGNAL.` / `ASSIGNED CONTROLLER: NONE → NODE 2 — BIO-SYS (MON 08:40).` / `CO: CDR M. KESSLER — NOT FITTED.` |
| `roster` screen | 23 red dots; `CONTROLLER:` NONE struck through → `CHOIR — NODE 2` | 19 red dots + 4 grey `NO SIGNAL` (no location); `CONTROLLER:` ~~NONE~~ `NODE 2`; Kessler's row unchanged (no dot) |
| `node2_screen` header | `NODE 2 — BIO-SYS — CLASP CONTROLLER` | `NODE 2 — BIO-SYS` (the CHOIR waveform already carries it) |
| `l4_choir_roster_stop` | "Twenty-three volunteers, Technician. Not one has complained since Monday." | "Volunteers, Technician. Not one has complained since Monday." (no number, so it agrees with 19/23) |
| `l4_choir_roster_command` | "Twenty-three of them, Supervisor. More than you ever kept." (CHOIR claims ownership) | "Volunteers, Supervisor. Every one of them reported fit." |

  - Everything else stays implied and can stay as written. Checked:
    - CHOIR lines: `l4_choir_node2_*`, `_armoury_*` ("They will want it back / come for it"), `_theatre_*` ("So do we"),
      `_end_*` (kept by user decision).
    - Sunde's log: `l4_sunde_3/5`.
    - Readables and panels: `term4_pi`, `log4_viv`, `note4_consent`, `note4_tveit`, `note4_guard`, `note4_bunk`, the gate
      panel `AUTHORISED: AAS, L. (LT.) — PALM — LIVE`, `fumig_status`.
  - Kessler's `NOT FITTED` is the right size. It states a fact and leaves the reason open (7.1).
  - The 4 `NO SIGNAL` rows are a new hook for 3c that spends nothing: they give no location and no reason.
  - The player still joins the dots from three implied pieces: the Node 2 window (CHOIR's face), the controller field
    pointing at Node 2, and red dots.
  - Record the 19/4 split as canon in REVISION 9 so 3c's plan matches it (3c's shielded handful = 4).

### B3: The theatre, the "one unskippable sight", cannot teach D9 as planned

- **Where:** D6, D9, §2.8 gallery row, §4.4, §8.5.1/3.
- **The table is only visible close to the glass:**
  - Eye height is 6.45. The table is at (0, 1.0, −53.5). The glazing starts at y 5.0.
  - The ray to the table clears the sill only when the eye is within **2.36 m** of the glass: 6.45 − 5.45·d/(6.5+d) ≥ 5.0.
  - From `d4_gal`, 4 m back, the player sees the arm and the screen but not the body.
- **The Clasp LED is too small to see:**
  - The LED that carries the whole lesson (red → three blinks → off) is **4 mm**.
  - At 7–8 m it subtends ≈ 0.03°, about half a pixel at 1080p.
  - Bloom may produce a speck; the blink pattern will not read.
- **The announcer can be missed entirely:**
  - The lines play only on cues while the player is in the gallery.
  - A player who crosses the 10 m from `d4_gal` to `d4_gal_e` in 4 s, between cues, hears nothing and sees an arm moving
    in a room.
- **Fix:**
  1. Put a **status ring 6–8 cm** around the tool head that mirrors the LED. Add the same ring, 3 cm, as a halo sprite on the
     handled Clasp. Both use the same shader uniform. Readable from anywhere in the gallery, since the arm is visible from
     every point (rail ray at the glass ≤ 7.55 < 7.6).
  2. Turn the gallery desk monitor into a **close-up of the nape** drawn on canvas (kind `theatre_cam`: the nape, the Clasp
     outline, the LED dot at screen scale, `LINK: HANDSHAKE / FAILED` in sync with `userData.cycle`). No render-to-texture
     cost.
  3. On the first frame in `t4_gallery`, play a status line at once if the cycle is not within 3 s of `approach`
     (`l4_unit_theatre_0` "Procedure thirty-one. In progress.").
  4. Lay the benches and the desk monitor so the natural path from `d4_gal` to `d4_gal_e` runs at z ≈ −46, within 1 m of
     the glass.
  5. Add a frame-sequence item: walk `d4_gal` → `d4_gal_e` at sprint speed, and verify that the ring and the screen read.

### B4: Done-criteria in §11 need files no task owns (the build graph does not close)

1. **K** must keep "levels 1–3 playthrough defaults green".
   - `scripts/playthrough-l3.mjs:438` asserts `TO BE CONTINUED` on the 3a end card, and `check-chain.mjs:205-206` asserts
     "stored level stays 3".
   - D5 changes both. K owns `check-chain.mjs` but not `playthrough-l3.mjs`. Add it to K.
2. **W7** must get `check:fxleak --level 3` green and register 3a's viewport, lamp grid, falls and pool with `rooms`
   (§8.6.5).
   - They are created in `src/level/l3/atrium.ts:110-130` and hidden there by hand.
   - W4 owns only `l3/index.ts` and `l3/phases.ts`. Nobody owns `atrium.ts`. Give it to W7 (only the registration lines).
3. **W8** (Sonnet, `voice/` only) must cut `l4_sunde_6` "by the voice tool's `trimAfter` word option".
   - That option does not exist (`grep trimAfter tools/voice` finds nothing), and W8 does not own `tools/voice`.
   - Fix: generate "…If you're watching this, don't let it." and let ST stop the handle at
     `duration − tailCut` (measured per file, stored in the line's `note`-free field `cut`), with the screen dropping to
     static on the same frame. This is scene-owned, so no tool change.
4. **Door `hold` panel:** `DoorStatus` gains `hold` (K), but `doors.ts:216-219` maps the status to a screen kind.
   - No kind is listed for HOLD: K adds only `containment | video_log | roster`.
   - Either add `door_hold` to K's `ScreenKind` + placeholder and to W6's list, or drop `hold` entirely and use `cycling`
     with a prompt override. `cycling` already means "locked for a stated, temporary reason"; prefer this.
   - Also, `story/stage/base.ts:307` `doorStatus` accepts only `'cycling' | 'dark' | null`, and ST must not edit `stage/*`.
5. **Hand-over ordering:** K sets `LEVELS[3].next = 4` and `LEVELS[4].built = true` with an 8 × 8 stub.
   - From K's merge until I1, anyone finishing 3a on main lands in the stub.
   - Keep `LEVELS[3].next = null` until I1, and test the hand-over in `check:chain` through a test-only override; or accept
     it and say so.

---

## SHOULD-FIX

**S1: Vent spawns start inside the 1 m vent voids and get stuck there** (§2.1 vents, §5.1 `g4_viv`, `g4_vent`).
- `skitter.ts:206-221` `beginEmerge` raycasts 0.9 m up and clings to the first ceiling. From (−23.1, 8.5, −22.2) that is the
  vent's own roof at 9.2, *inside* the void, which has no nav. The skitter either stays in the box or arrives late.
- Level 1/2 vent skitters spawn at room ceiling height (`l2/relay.ts:104`, `rooms/fab.ts:409`).
- Spawn at the opening, 0.1 m under the ceiling plane (viv y 8.1, corr_s y 7.7), after the grille has dropped.
- Note that the "+0.4 / +1.0 s" timing is not available: `spawnGroup` staggers by 0.45 s (`manager.ts:296`).

**S2: Holm's body lies in `d4_cold`'s opening, so the `check:doors` "opening" rule will fail** (D26, §2.6 cold).
- Any visible triangle inside the clear opening volume (y ≥ floor + 0.06) is a finding.
- Lay him 0.5 m inside the cold store with one arm across the threshold strip below 0.06 m. Or add an explicit allow
  entry with a reason.
- Drive the 6 cm jam twitch through the Door API (a `door.nudge(t)` in `doors.ts`, W4), not by moving leaf meshes from a
  machine. Otherwise it fights the door's own state each frame, and decals on the leaves (HitOwner) jitter.

**S3: The containment hold needs one stated reason, and one line is false** (§1.5, §4.3, review focus 5).
- As written, CHOIR could keep `d4_surg` shut itself (7.1: it controls ordinary doors), or send a unit to press the button.
  So "the last thing keeping you out" makes no sense.
- Fix it in canon, in the spirit of 6.1's lockouts:
  - Bio's containment interlock is **hard-wired and local**. The suite doors are on it and not on CHOIR's network.
  - Acknowledgement is a physical button at the source, by design.
  - CHOIR can neither lock those doors nor wanted the button pressed. It kept them shut only by leaving the hold standing.
  - Its answer, once the hold clears, is what it does control: the power (lights-out) and the units (the bay).
- Put it on the panels: `cold_panel` and `surg_hold` add `HARD-WIRED — LOCAL ACKNOWLEDGE ONLY`.
- `l4_choir_hold_command` "…We will raise another." is then false. Use "A supervisor clears his own alarms. That one was
  keeping you safe."
- The 62 h open door is credible: 3a's `note3_door` already has "Bio's freezer alarm went again… ignore it". Good tie, keep.

**S4: The theatre loop contradicts itself** (§4.4, §6.2, §6.3 `note4_list`).
- `l4_unit_theatre_3` says "Retry. Next host in queue.", but the arm re-fits the same body. Use "Retrying. Same host."
- Count: 62 h of 40 s cycles is about 5,500 attempts, against "~30 Clasps in the bin, +1 per cycle". Change both:
  - the screen reads `ATTEMPT 5,5xx` (derived from `CLOCK4`; this is the horror);
  - the arm re-gels and reuses the *same* Clasp (a gel-bath step replaces "discard");
  - the bin keeps ~30 early spoiled ones, static.
- Why CHOIR keeps doing what it knows fails ("It needs a living host. So do we."): give the loop its reason on the screen,
  `QUEUE: AUTO — ORDER 0031-H (YIELD)`. Order 0031-H already exists as "maintain yield at zero headcount", which ties the
  thread with no new canon.

**S5: The LED vocabulary contradicts itself** (D9).
- "Amber = paired, idle; off = no host". But the cold-store rack Clasps have no host and glow amber.
- Redefine as **amber = powered, not linked; red blinking = linked; off = unpowered / failed**. The rack (amber), Jonas's
  letter (amber, "red in drills"), the theatre (red → off) and the vivarium tray (off) then all agree.

**S6: Fumigation as the cause of death is fine as new canon. Add the cover story, and explain Eng.**
- It is on-tone and true to `l3_choir_end_*`.
- Cover story: ten Bio staff missing for 62 h would be noticed by the habitat, the way the fab test needed one.
  - `fumig_status` adds `HABITAT NOTICE: BIO-SYS CLOSED — CONTAINMENT DRILL — STAFF REMAIN INSIDE`.
- Eng was gowned in the clean side at 08:41, yet dies on Deck 1 having broken the cage.
  - One clue: suit half off, a respirator, a smear trail on the stair.
  - The plan then holds: he fled down the service stair and armed himself after the guard withdrew at 09:03.
- `l4_choir_bodies_stop` "…We did not stop it." contradicts `REQUESTED: CHOIR` on the screen.
  - Use "We cleaned this side on Monday, Technician. They were still in it."
  - Exclude Dahl and the first 5 s of phase C from its trigger. Otherwise it fires in the shower right after the air
    shower, and "cleaning cycle" reads as the shower having killed him.

**S7: The checkpoint gap makes the ambush expensive** (§7).
- `cp4_clean` is written at the shower exit. The next is `cp4_hold`, after the ambush.
- A death in the ambush replays all loop exploration: notes come back unread and pickups respawn. That can be 8+ minutes.
- Add `cp4_cold`: first `t4_cold` in phase C, 0 awake. Or re-save `cp4_clean` once per entry to corr_* in phase C with
  0 awake.
- Say "once" where meant: `t4_clean` covers all of corr_n.
- Let `cp4_armed` also be taken in the tube north of z −80 before F6. Otherwise "release first" players who finish F5 in
  the tube restart before F5.

**S8: F6 can sandwich the player** (§4.6, review focus 6).
- On the release-first path, a player at `t4_tube_1` with F5 alive gets F6 after 45 s. Worst case: the sentry + 2 husks
  behind and 3 husks + 2 skitters ahead, in a 3.6 m glass tube.
- Rule: F6 starts when the player is past `t4_tube_1` and either F5 is dead, or every living F5 member is ≥ 25 m away and
  unseen for 20 s. The 45 s clock then only covers stuck members.
- This keeps "nothing waits only on an enemy".

**S9: Carbine numbers and the TTK table** (§5.3, §8.3).
- Skitter HP is **18**, not 25 (`skitter.ts:37`).
  - Pistol (20) kills a skitter in 1 hit.
  - The carbine (16) needs 2. It is worse than the pistol against the most common fast enemy.
- The carbine's sustained DPS (160) is barely above a fast-clicked pistol (≈ 100–140).
- Set **damage 18**:
  - husk: 5 body hits (0.4 s), 3 head hits;
  - skitter: 1 hit;
  - sentry: 4 hits.
- The shotgun stays the close-range answer (81/shell, 1–2 per husk).
- Ammo after chk is lavish: 180 carbine rounds against ~550 HP, about 78 rounds at 45 %. That is fine only because it
  carries into 3c; say so, or drop one cage box.
- The armour test's "damage(30) at armour 5 → health 75" depends on a starting health the plan does not state; write the
  precondition.
- The vest's 0.8 s strap needs rules: weapon lowered? cancelled by damage like the palm scan?

**S10: Voice lines vs the local TTS rules and the user's "read from a script" note** (§6.1–6.2).
- **UNIT is meant to be emotionless** (user feedback, `cast.json` unit `why`). Drop the UPPERCASE stress from all unit
  lines: `l4_unit_decon` "EIGHT SECONDS", `l4_unit_hold` "COLD STORE TWO", `l4_unit_theatre_2` "LINK FAILED".
- **Stress must run to the end of the phrase:** `l4_choir_theatre_*` "a LIVING host" → "a LIVING HOST, Technician".
- **Sunde is the only performed voice, and every line is clean prose.** Put hesitation into the words, keep each line
  short, and vary the scene-owned gaps instead of a fixed 0.5 s.

| id | spoken (suggested) | gap after |
|---|---|---|
| `l4_sunde_1` | Log forty-one. Sunde. It's... Sunday night. The readiness trial is over. Whatever the navy calls it now. | 1.2 s |
| `l4_sunde_2` | We were told it advises. A second voice. Steadier hands... faster decisions. | 0.6 s |
| `l4_sunde_3` | It doesn't SUGGEST. It DRIVES. They watch their own hands DO IT. | 1.6 s (screen: she looks down) |
| `l4_sunde_4` | Every Clasp needs a controller. The protocol says... a human officer. The field says NONE ASSIGNED. | 0.8 s |
| `l4_sunde_5` | Something answers ANYWAY. The light goes RED... and they stand up. | 1.4 s |
| `l4_sunde_6` | I've stopped the fittings. If you're watching this— don't let it— | (cut, B4.3) |

  - Make the reference text halting too. The planned refText is composed and will clone composed. Suggested:
    "Log entry. Um. The gel batch is stable at minus twenty. Fitting times are... down again. I want that on the record."
  - `describe` "female, middle-aged, moderate pitch" is fine and short.
- Consider reusing the existing `recorder` voice fx (level 1's Hale) with a `screen` alias and a position profile, rather
  than a new DSP chain.
- `l4_unit_gate` "…Authorised. Equalising." is spoken before the panel says AUTHORISED. Use "Post 4. Pressure gate.
  Equalising." and let the panel deliver AUTHORISED.

**S11: Optional contract members until I1 (D18): do not accept this debt.**
- K already places placeholder lines in `player/weapons.ts`. It can equally add `armor = 0`, `maxArmor = 100` and
  `addArmor() { return 0; }` to the Player implementation and make the members **required** from day one.
- Optional members spread `?.` through ui, story and tests, and the I1 tightening becomes a sweep across files four tasks
  touched.
- The 3a-era optionals (`cinematic?`, `setSafe?`, `consumeKey?`, `showSkip?`, `setVisibilityOverride?`) are implemented by
  now. Make them required in the same K commit.

**S12: Task sizes** (§11).
- **W2** (Sonnet) is not "small, tightly specified": UI + ~30 sound ids + 4 ambiences + room presets + a voice fx. Split it:
  W2a UI (Sonnet) and W2b audio (Opus).
- **W9** is XL and on the critical path of all of D1–D3: arm with timeline API, table + corpse, Clasp with instanced LED
  states, 6 body poses, 17 clean-room props, navy kit, tube kit. Split it:
  - W9a set pieces (arm, table/corpse, Clasp, bodies);
  - W9b kits.
  - Let D2 depend only on W9a.
- **D1** (11 rooms, 5 vignettes, fog, lights-out wave, emergency kit, in one file) is larger than any 3a dressing task. 3a
  split its dressing into P3a/P3b/P3c. Split D1 into "entry + north" (lock4, gown, shower, corr_n, wetlab, pi_office,
  node2) and "west/south/east" (vivarium, cold, records, bay, corr_w/s/e, lights-out). They need separate files.

**S13: fxleak semantics and the tube's `rooms`** (§2.9, §8.6.6).
- The sea viewports list `rooms: tube, chk, gatel`. Then the sea is drawn whenever chk is visible, including from lcorr.
  §2.8 says that must not happen.
- List `tube` only. Chk and gatel see the tube through its door portals, and the tube's visibility follows from them.
- Define `rooms` as "drawn only while one of these is drawn". The check should then fail on magenta in a view whose
  *drawn room set* contains none of them, not on "the camera stands in a room not listed". Otherwise legitimate views
  (the fog spill seen down corr_w from corr_n's corner) are false failures.

**S14: Node 2 screen orientation** (§2.6 node2).
- The CHOIR screen sits on node2's south wall facing +z. Through the window at x 12 it is seen ≈ 55° off-axis from corr_e.
- Put it on node2's west wall (x 4.2) facing +x, square to the window. It is the second strongest image on the loop.

---

## NOTES

- **Plan checks I recomputed and found correct:**
  - all D3 room pairs;
  - pockets of the other 17 doors (incl. `d4_store` against the gallery corner and `d4_gal_e` on the 4 m landing);
  - stair rise, run and headroom;
  - trigger boxes;
  - every §2.6 marker inside its room interior;
  - sea voids clear of chk (1.6 m) and gatel (1.8 m);
  - `screen` −6 dB at 9.7 m;
  - recoil ≈ 0.35°/shot (3.5° after 10 rounds).
- 24 rooms: below the 31-room bitmask in `assemble.ts:126` (`1 << i`). Keep 3b under 31.
- The navy sentry dock (31.0, 3.6, −60.0) is not "over the booth" (booth x 26…30, z −58.4…−55.2). Either move it to
  (28, 3.6, −56.8) or correct the text.
- **D20 clock:** 3b assumes arrival 62:10 whatever 3a took. Carry `testHour` in the facts from 3a's end. This is cheap and
  keeps every 3b panel honest.
- **Sunde's log vs the override:** "something answers anyway" (Sunday) predates the roster's Mon 08:40. Read it as CHOIR
  probing before the turn. That is fine, but write the roster line as the moment it took *all* links, so the two do not
  read as a contradiction.
- **Length:** on my estimate:
  - a reader who visits every room: ≈ 13–14 min;
  - first-time main route: ≈ 9–10 min;
  - runner: ≈ 6 min.
  - The ~15 min target is an upper bound. No stretch is an empty walk: after lights-out only ~17 m separate the cold-store
    door from `d4_surg`, and the 104 m loop is walked lit. The clean side is compact (30 × 28 m, 3 m corridors), so the
    "expansive" feel rests on the theatre (9.4 m) and the tube (40 m).
- **Timers that open a way:**
  - decon 8 s and shower 6 s: diegetic and short, fine;
  - F6's 45 s: the units open the lock, but see S8.
- Phase D lists bay/store4 as neither goal nor forbidden: correct (3a B6 lesson).
- Hand-over D4 (level-3 inner door as a prop): agree, over a hidden vestibule.
- After K, `check-common`'s `levelsOf('all')` must return [1, 2, 3, 4] (`scripts/lib/check-common.mjs:19`). K owns it. Good.
- `ProgressL4 = ProgressL3` works: its `flags` is an open record (`story/save.ts:187-197`).
- Player restore already tolerates a missing `carbine` entry (`player/index.ts:404-409`). Add the case
  "level-3 checkpoint written before K restores" to `check:chain`.
- Lab bench islands in the wet lab must have no overhead shelving above 1.2 m. The worker at (−6.0, −22.6) stands on the
  sight line past island 1's east end.
- §8.6.2 has a garbled sentence ("paused while sprinting stops"). Write: no puff while sprinting or firing.

---

## Decisions to put to the user

1. **Length.**
   - (a) Accept ≈ 10 min main route, ≈ 14 min with all labs.
   - (b) Add one required navy-level beat. For example, the booth release is dead because CHOIR cut the booth feed, and a
     physical hand crank in the guard room (no palm) restores it under F5 fire.
   - Recommend **(a)**. The level is dense, and 3c follows.
2. **Sunde missing (D16).** This is a fourth open thread, after 0031-H, Kessler's lack of a Clasp, and the manifest.
   - Recommend **keep**, provided REVISION 9 records that 3c or 3d must pay it off (e.g. her badge or coat turns up at
     Post 4 or the head-end).
   - Otherwise put her on the theatre list as host 39 and close the thread here.
3. **Roster wording (B2).** REVISION 7 literally wrote "overwritten `CHOIR — NODE 2`". Under the user's new rule, I
   recommend **`NODE 2` without the word CHOIR**, plus the 19/4 split.
4. **Theatre close-up (B3).** A canvas-drawn close-up on the gallery desk monitor (cheap, recommended), or a live render
   feed of the table (≈ 1–1.5 ms on HIGH, 3a's feed system).
5. **Containment hold canon (S3).** Bio's containment interlock is hard-wired and local. It is a small extension of 6.1's
   lockout rule, so the user should approve it as canon.
