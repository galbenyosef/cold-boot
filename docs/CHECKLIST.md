# Before handing a build over

Run everything here and fix what it finds. When the user finds a new class of defect, add a check for it.

## Automated
- `npm run typecheck` and `npm run build`
- `npm run check` — runs (levels 1–5 where a check takes `--level`; `all` = every built level):
  - `check:zfight` — overlapping coplanar surfaces (flickering "double layer" walls). Zero findings.
  - `check:doors` — parts left hanging when a door / moving machine part moves (e.g. bolts in mid-air).
  - `check:wreck` — a dead robot on the floor is walked over, not into.
  - `check:reach` — per story phase, the player cannot reach what must be sealed and can reach what is needed.
  - `check:decals` — bullet holes / decals shot onto every door leaf (and registered movers) ride with it or vanish when it opens; none left hanging in mid-air.
  - `check:chain` — the level chain + save/carry v2: every built level (1–6) boots directly (`?level=7+` clamps to 6, a
    bad `?level=` falls back to the stored level), L1 → L2 → L3 hand-overs keep loadout and facts (both choices), level
    3's end card + carry (incl. `testHour`) and its live hand-over to level 4, the 3 → 4 test override `?next=3:4` (both
    choices: card without TO BE CONTINUED, weapons, health, flashlight, facts, armour 37 → 37 / 900 → 100 / NaN → 0,
    real reload), level 4's direct start, the LIVE 4 → 5 hand-over (`LEVELS[4].next = 5`, no override; both choices:
    card without TO BE CONTINUED, stored 5, weapons incl. the carbine, health floor 50, armour 37 → 37 / 900 → 100 /
    NaN → 0, flashlight, facts, `testHour`; the flashlight CELL is not carried — a new level starts full; real reload),
    level 5's direct start (pistol 12 + 24, shotgun 6 + 6, carbine 30 + 90, armour 50, flashlight on, `testHour 62.5`;
    HUD with carbine / armour / cell) and its end WITHOUT `?next=` (carry from 5 incl. `kills5`, `testHour`, `radio`,
    `kessler`, `l5_door`, `l5_boat`; `POST 4` / TO BE CONTINUED, stored level stays 5 — `LEVELS[5].next` is null until
    stage 3d's integration), the 5 → 6 hand-over through `?next=5:6&handoff=1` (both choices: `POST 4` alone, stored 6,
    weapons, health, armour 37 / 900 / NaN, the lamp, facts; a full cell; real reload), level 6's direct start (12 / 36,
    6 / 12, 30 / 120, armour 50, facts incl. `radio`, `testHour 62.75`) and the chapter end (carry from 6 incl. `kills6`,
    `THE TRUNK` / TO BE CONTINUED then `END OF CHAPTER 3`, stored level 6), menu CONTINUE / BEGIN on a stored level 3,
    4, 5 and 6, v1 saves discarded once, corrupt carries ignored, a carry without the carbine loads it unowned, a pre-3b
    level-3, a pre-3c level-4 and a pre-3d level-5 checkpoint restore, a level-6 checkpoint round trip; plus a source
    grep that fails on a binary level branch (allow-list `scripts/levelgrep-allow.txt`). Static build:
    `node scripts/check-chain.mjs --url http://127.0.0.1:<port>` (`--only chain5` for the 4 → 5 → 6 part).
  - `check:physics` (stage 3d K) — the two collider sets (`rayOnly` water stops rays / sight, not bodies; `moveOnly`
    guards stop bodies, not rays; `raycastSolid` = the moves set), the kill height (`setKillY`, `Level.killY`), the
    slope-seam rule (no sideways drift up a stair slab; a control run without it drifts), `Interactable.requireRegion`,
    and a walk straight up level 5's `STAIR5_W`. `node scripts/check-physics.mjs --url http://127.0.0.1:<port>`.
  - `check:nav` — enemy navigation (nav v2, two decks): nodes on their floors and in their rooms, every link walked by a husk capsule, no unlinked deck, enemies can follow the player into every phase's goal regions; real husks reach the player across decks (greybox) and in levels 1–2, stand off when cut off, no drift on ramps (greybox + levels 1–2; prints the L1/L2 nav hash). `node scripts/check-nav.mjs --url http://127.0.0.1:<port>`.
  - `check:cutscene` — cutscene camera + player cinematic + safe state on the dev scene (`?cutdev=1`, greybox): no input moves / fires during a scene, awkward entries (sprint, backwards, mid-jump, mid-reload, palm scan, note, pause, fire held, dying), camera = shot table, end pose / weapon exact, hand-back continuity, skip only once seen (same end state, no jump), no shot in or across the safe state; levels 1–2 unaffected. `--url`, `--frames` (shots/p4/).
  - `check:voice` (`scripts/check-voice-level.mjs`) — speech MEASURED at the listener: a tap on the voice bus and the
    master, the speech RMS of every line of a level-3 run (the lift, C1 at his real distances, C2 across the desk, the
    office, his door, CHOIR's PA = the reference). A person in the scene at ≤ 4 m ≥ the reference, ≥ −5 dB at 10–12 m,
    ≥ −8 dB through a door; never occluded by his own body / the desk between two people; every C1/C2 line's speech
    onset within 0.12 s of its cue (the gesture). `--choice command`, `--mode from2` (the L2 → L3 chain),
    `--mode level2` (level 2's lines through the same path), `--evict` (nothing cached when the scene starts),
    `--json <file>`. Add every new speaking character's scenes to it.
- `node scripts/playthrough.mjs <url>` (level 1), `--checkpoints`, `--level2`, `--level2 --checkpoints`,
  `--level2 --impatient` — on a static build (`vite build` + `vite preview`), not the dev server.
- `node scripts/playthrough-l3.mjs <url>` (`npm run play:l3 -- <url>`; level 3, both choices), `--checkpoints`, `--impatient`, `--skip`
  — static build; frame sequences of C1 / C2 / the breach in `shots/l3/` (look at them).
- `npm run voice:check` after any change to `voice/lines.*.json` (and `npm run voice` before it). `npm run voice` also
  writes every line's `lead` (seconds before the first word: breath, click, pause) into the manifest; the game skips
  it, so a scene's line starts with its gesture.
- `playthrough-l3`: the end card is asserted per `nextOf(3)` — since stage 3b `LEVELS[3].next = 4`, so the default
  run ends with the hand-over (card without TO BE CONTINUED, stored level 4); `--next 3:4` forces the same end.
- Stage 3b (docs/plans/stage-3b.md §10), on a static build:
  - `npm run play:l4 -- <url>` (level 4, both choices; `LEVEL4 OK`), `--checkpoints`, `--impatient`, `--order` (a–e),
    `--softlock` (a–h; (c) and (h: bay) run in their own page), `--frames` (10 fps sequences of §10.5 → `shots/l4/frames/`;
    look at them); `node scripts/playthrough-l4-cases.mjs <url>` (§9 #7, #10, #15, #22).
  - `npm run check:weapons -- --url <url>` (armour + carbine; `--only ads` carbine aim down the sights: aimed vs hip
    spread and climb over 30 rounds at 20 m, fov 50, walk × 0.55 / no sprint, aim + reload / sprint / switch / safe /
    cinematic, levels 1–3 unaffected; `--only torch` flashlight battery: drain 10 s, recharge 4 s, warning sag, death
    flicker + `cause: 'empty'`, refused below 15 %, HUD cell meter, no drain in a scene / safe state / pause, checkpoint
    save + restore, `?torch=inf`), `npm run check:fxleak -- --url <url> --level 3|4` (fx
    volumes drawn only with their rooms). (`check:dark` is NOT part of the checklist — the user's decision 2026-11-19:
    dark stretches are fine, the player switches the lamp on.)
  - Flashlight battery (player/flashlight.ts `TORCH`): dark sections are allowed — the player switches the lamp on
    and off (user, 2026-11-19); they must be readable with the lamp on. `?torch=inf` (no drain) is for tests that are not
    about the lamp; `player.debug.torch(v)` sets the cell.
  - `npm run check:voice -- --url <url> --level 4 [--choice command]` — Sunde's log from the PI desk and the office door,
    a unit panel line, the gallery announcer at both ends: level + sync as level 3's scenes.
  - `check:nav` runs level 4's cases with the others.
- Stage 3c (docs/plans/stage-3c.md §10), on a static build (rules for building it: `docs/plans/stage-3c-agent-rules.md`):
  - `npm run play:l4 -- <url> --choice=stop` stays green on main: `LEVELS[4].next = 5` is live, so the end asserts the
    hand-over card (without TBC) and stored level 5 per `story.next()`.
  - `npm run play:l5 -- <url>` (level 5, both choices; `--contract` = every hook of §10.0 exists), `--checkpoints`,
    `--impatient`, `--order` (a–f), `--softlock` (a–i), `--scares` (each `v5_*` once, calm, spaced, sounds owned once
    via `audio.debug.log`), `--ads`, `--frames` (10 fps sequences of §10.5 → `shots/l5/frames/`; look at them).
  - `npm run check:soldier -- --url <url>` (the taken soldier on its dev page: TTK, first-burst miss, hit fractions,
    telegraph, cover, suppression, misses near the player, damage cap, tokens, death + radio point, perception in the
    dark, hold / release, grating, exits stand-off, actor, cost).
  - `check:fxleak --level
    5`, `check:reach --level 5` (phases A … X, `mustNotUse`), `check:nav` (level-5 cases at real speeds), `check:doors`,
    `check:decals`, `check:wreck`, `check:zfight`, `check:cutscene` (the level-5 scene), `check:voice --level 5`,
    `check:cards` (the `POST 4` card), `check:weapons` unchanged.
  - Every check view / stand-off / marker stands inside a room interior (`roomAt` + 0.3 m inset) — a check standing in
    a wall passes for the wrong reason.
- Stage 3d (docs/plans/stage-3d.md §10), on a static build (rules: `docs/plans/stage-3d-agent-rules.md`; until 3d's
  integration its TEST POLICY holds — the items below are run by the coordinator at the end, `docs/plans/deferred-final.md`):
  - `npm run play:l5 -- <url>` stays green on main (`LEVELS[5].next` null: TO BE CONTINUED); with `?next=5:6` the end
    hands over (POST 4 alone, stored 6). After IA sets `LEVELS[5].next = 6`, `play:l5` asserts the hand-over itself.
  - `npm run play:l6 -- <url>` (`--contract` first, default, `--checkpoints` incl. the B4 / B5 cases, `--boss`, `--dry`,
    `--scares`, `--order`, `--frames`), `check:loader` (1–15), `check:water`, `check:physics`, `check:soldier` (level-6
    cases), `check:reach --level 6` (the hazard rule on every simulated step, jump arcs, `requireRegion`, the trench row,
    `B_hold`), `check:nav --level 6`, `check:doors --level 6`, `check:fxleak --level 6`,
    `check:cutscene` (the ending), `check:wreck` (no wreck box in deep water), `check:voice --level 6` (incl. Aas's ASR
    pass), `check:cards` (`THE TRUNK`, `END OF CHAPTER 3`), the perf views of §10.6 on LOW / MEDIUM / HIGH.
  - Levels 1–5 unchanged: their playthrough defaults (the kill height stays −30 there; the physics' slope-seam rule
    changed stair contacts on levels 3–5 — `check:nav`'s ramp / stair cases re-run).
- `node scripts/check-cards.mjs <url>` — title / intro / end cards keep their number of text lines and stay on screen
  through the letter-spacing animation, at four window sizes.

## Design rules to check every scene against (docs/DESIGN.md → REVISION 5, R1–R7)
- No gate that is only a spoken instruction; real barriers.
- Anything enemy-looking within reach of the player or a bullet reacts to shots, or is clearly a hologram.
- No line that assumes the player did things in order; every world-referring line has a condition.
- No enemy of a later beat present early; bosses never.
- Helplessness scenes: player locked in by real doors, scene runs on its own clock, short, room not enterable early.
- No interactable usable through glass, walls or closed doors (R8).

## Process
- Plan the scene fully first (what the player can do at every moment and what happens), have a reviewer
  subagent attack the plan, then implement.
- Agents' "still weak" lists are to-dos to resolve or consciously accept before hand-over, not disclaimers.
- Look at moving things in motion (frame sequences / short clips), not only stills.
