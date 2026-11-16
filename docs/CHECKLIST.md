# Before handing a build over

Run everything here and fix what it finds. When the user finds a new class of defect, add a check for it.

## Automated
- `npm run typecheck` and `npm run build`
- `npm run check` — runs:
  - `check:zfight` — overlapping coplanar surfaces (flickering "double layer" walls). Zero findings.
  - `check:doors` — parts left hanging when a door / moving machine part moves (e.g. bolts in mid-air).
  - `check:wreck` — a dead robot on the floor is walked over, not into.
  - `check:reach` — per story phase, the player cannot reach what must be sealed and can reach what is needed.
  - `check:decals` — bullet holes / decals shot onto every door leaf (and registered movers) ride with it or vanish when it opens; none left hanging in mid-air.
- `node scripts/playthrough.mjs <url>` (level 1), `--checkpoints`, `--level2`, `--level2 --checkpoints`,
  `--level2 --impatient` — on a static build (`vite build` + `vite preview`), not the dev server.
- `npm run voice:check` after any change to `voice/lines.*.json` (and `npm run voice` before it).

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
