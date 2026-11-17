# Before handing a build over

Run everything here and fix what it finds. When the user finds a new class of defect, add a check for it.

## Automated
- `npm run typecheck` and `npm run build`
- `npm run check` — runs (levels 1–4 where a check takes `--level`; `all` = every built level):
  - `check:zfight` — overlapping coplanar surfaces (flickering "double layer" walls). Zero findings.
  - `check:doors` — parts left hanging when a door / moving machine part moves (e.g. bolts in mid-air).
  - `check:wreck` — a dead robot on the floor is walked over, not into.
  - `check:reach` — per story phase, the player cannot reach what must be sealed and can reach what is needed.
  - `check:decals` — bullet holes / decals shot onto every door leaf (and registered movers) ride with it or vanish when it opens; none left hanging in mid-air.
  - `check:chain` — the level chain + save/carry v2: every built level boots directly (`?level=5+` clamps to 4, a bad
    `?level=` falls back to the stored level), L1 → L2 → L3 hand-overs keep loadout and facts (both choices), level 3's
    end card + carry (incl. `testHour`) — today's end without `?next=`, the hand-over to level 4 through the test
    override `?next=3:4` (both choices: card without TO BE CONTINUED, weapons, health, flashlight, facts, armour
    37 → 37 / 900 → 100 / NaN → 0, real reload), level 4's direct start and end (carry incl. carbine + armour, stored
    level stays 4), menu CONTINUE / BEGIN on a stored level 3 and 4, v1 saves discarded once, corrupt carries ignored,
    a carry without the carbine loads it unowned, a pre-3b level-3 checkpoint restores; plus a source grep that fails
    on a binary level branch (allow-list `scripts/levelgrep-allow.txt`). Static build:
    `node scripts/check-chain.mjs --url http://127.0.0.1:<port>`.
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
- `playthrough-l3`: the end card is asserted per `nextOf(3)`: add `--next 3:4` to run the hand-over end (card without
  TO BE CONTINUED, stored level 4).
- Stage 3b (docs/plans/stage-3b.md §10; each runs once its task has written the script — before that the npm entry
  prints a note and exits 0): `npm run check:weapons -- --url <url>` (armour + carbine, W1), `npm run check:fxleak --
  --url <url> --level 3|4` (fx volumes drawn only with their rooms, W7), `npm run check:dark -- --url <url>` (level 4
  lights-out readable by flashlight on LOW / MEDIUM, T), `npm run play:l4 -- <url>` (`--checkpoints`, `--impatient`,
  `--order`, `--softlock`; T), `npm run check:voice-level -- --url <url> --level 4` (scene speech at conversation
  level). `check:nav --level 4` once W4 adds level 4's cases.

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
