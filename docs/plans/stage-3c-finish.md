# Stage 3c finish + stage 3d start — task split (coordinator, 2026-11-18)

Read with `docs/plans/stage-3c-integration.md` (the item lists B1–B10, A1–A7) and `docs/plans/stage-3c-agent-rules.md`
(rules 1–8 and the lessons still bind, except where this file says otherwise).

## Changed since the integration list
- `LEVELS[4].next = 5` is LIVE on main (38bb9fd). Rule 5 of the agent rules no longer applies: level 4 hands over to 5.
- The level-5 story (`src/story/l5/*`) is on main **unfinished and untested** (merged as the ST agent left it when stopped).
  Fixed since: the first door, the tunnel latch (end), the level-4 gate-lock latch.
- The earlier IB worktree produced nothing; IB starts from scratch, split in two.

## TEST POLICY (the user's rule — binding, overrides "run your own test" in the agent rules)
No long or global test runs now. Allowed: `npm run typecheck`, one vite build into your own dir, screenshots / short frame
sequences of what you changed, and a SHORT targeted scripted segment (≤ ~2 min wall clock each, few of them) when you need
it to decide "better or not". NOT allowed now: the CHECKLIST, any full `play:lN` mode, `check:* all`, `check:reach/nav`
across levels, voice-level sweeps, perf sweeps over every view. Anything you would have run goes into your report's
**"deferred checks"** list; the coordinator collects it in `docs/plans/deferred-final.md` and runs it after stage 3d.

## Tasks (one owner per file; your patch is merged restricted to your paths)

| id | items | model | files owned | port |
|---|---|---|---|---|
| **IA5** | Finish + make the level-5 story work end to end (compare `src/story/l5/*` against stage-3c.md §4, §6, §7, §10.0 and list/finish what is missing); A3 vignette ownership; A4 nav (not the stair drift); A5 cutscene on the real soldier body; A6 story follow-ups; A7 DESIGN.md (controls, REVISION 10); B5's `grey.ts` grille fix | Opus | `src/story/l5/**`, `src/level/l5/{index,grey,phases,cover}.ts`, `src/enemies/**` except `soldier/{model,rig}.ts`, `src/level/nav.ts`, `scripts/**` except `check-chain.mjs`, `check-physics.mjs`, `lib/check-common.mjs`, `levelgrep-allow.txt`; `docs/DESIGN.md` | 4311 |
| **IB5a** | B1 (every fore / quarters room reads as a vessel; mess + ready room lived-in), B3 (oilskin behind the frosted window), B4 (navy body prop for `v5_body` and the stair hand; soldier fold detail; non-symmetric back death pose — pose data in the rig/model) | Opus | `src/level/l5/{fore,quarters,kit5}.ts`, `src/level/dev/kit5.*`, `src/enemies/soldier/{model,rig}.ts`, `src/materials/**` | 4312 |
| **IB5b** | B2 (one strip colour, `setStrips5` drives all), B5 (set-piece z-fights; report grey.ts change to IA5), B6 (lighting details incl. LOW room culling for level 5), B7 (readability in the dark), B8 (levels 3/4 black spots, level 4 lights-out rooms reading lit), B9 (carbine aimed receiver block) | Opus | `src/level/l5/{spine,bay,setpieces}.ts`, `src/level/dev/setpieces5.*`, `src/level/l3/**`, `src/level/l4/**`, `src/player/viewmodels/**`, `src/render/**`, `src/fx/**` | 4313 |
| **K6** | Stage 3d task K (stage-3d.md §11 row K + §13), MINUS: placeholders in `src/enemies/{index,manager}.ts` and `src/level/l5/cover.ts` (IA5 owns them — write the exact lines into the K notes for W3b / IA5), PLUS: the `STAIR5_W` drift (A4 last item, `src/physics/physics.ts`), PLUS: `check-chain` rewritten for the live 4 → 5 (A1). Its "L1–5 playthrough defaults green" is deferred. | Opus | its §11 row minus the above, plus `scripts/check-chain.mjs` | 4314 |
| **W9-6** | Stage 3d task W9 (voices) | Sonnet | its §11 row | — |

Stage 3d wave 1 starts after K6 merges; wave 2 after wave 1 (same test policy until IA/IB of 3d).

## Started 2026-11-18 after K6 merged (f089863): stage 3d wave 1, part 1
W1 (minus `player/viewmodels/**`), W2a, W2b, W3a, W4a, W4b, W5 (new files + registration lines only), W6 (new files +
minimal fx edits), W7, W8 — ports 4321–4330. **Held until IA5 merges** (they own IA5's files): W3b (`enemies/index.ts`,
`manager.ts`), W3c (`enemies/nav.ts`, `ai.ts`, husk, soldier).

## State at the usage-limit stop (2026-11-18)
Merged: all of 3c finish (IA5, IB5a, IB5b, IB5c) and 3d K, W1, W2a, W2b, W3a (+ follow-up), W3b, W3c, W4b, W5, W6, W8, W9.
Still running / unmerged at the stop: **W4a** (greybox, worktree agent-ab148b3f00163b184) and W7 (set pieces — MERGED 7a95cc9,
worktree agent-ad05c77a7c4e86e06) — merge their patches restricted to their rows when they report.
Next: resolve the below-y-0 lighting question (deferred list, W6), then wave 2 (D1, D2, D3a, D3b, ST-a, T → ST-b), then
IA/IB of 3d, then the whole deferred list.

## Final phase (stage 3d built: 4048d8a) — IA split for the deferred list
| id | scope | fixes in | port |
|---|---|---|---|
| **IA-g** | global + levels 1–4: `docs/CHECKLIST.md` items for L1–4, `check:chain` (with 5 → 6 live), `check:physics` (rewrite the stale L6-stub case), `check:nav all`, `check:reach all`, `check:doors`, `check:zfight`, `check:weapons`, `check:wreck`, `check:decals`, `check:cards`, `check:cutscene` (L1–4 cases), `play:l1`…`play:l4`, fxleak/dark L3–4, voice-level L1–4; `LEVELS[5].next = 6` | `src/core/**`, `src/physics/**`, `src/render/**`, `src/player/**`, `src/ui/**`, `src/audio/**`, `src/enemies/{manager,index,nav,ai}.ts`, `src/fx/**`, `src/materials/**`, `src/level/{l1..l4,context,assemble,nav}*`, `src/story/{l1..l4,stage,index,save,chain,camera}*`, `scripts/**` except the L5/L6-only scripts | 4351 |
| **IA-5** | level 5: every `play:l5` mode, `check-soldier` full + `--real`, `check:nav/reach/dark/fxleak/zfight --level 5`, WRITE + run `check-voice-level --level 5`, the 4 → 5 hand-over, the L5 deferred items | `src/story/l5/**`, `src/level/l5/**`, `src/enemies/soldier/**`, `scripts/playthrough-l5.mjs`, voice-level L5 mode | 4352 |
| **IA-6** | level 6: every `play:l6` mode, `check:loader` (100 trials), `check:water`, nav/reach/dark/fxleak/zfight/cutscene L6, `check-voice-level --level 6` (ST-a + ST-b diffs), the loader-in-motion review, perf views, the L6 deferred items and FIX items | `src/story/l6/**`, `src/level/l6/**`, `src/enemies/loader/**`, `scripts/playthrough-l6.mjs`, `scripts/check-loader.mjs`, `scripts/check-water.mjs`, voice-level L6 mode | 4353 |
Browser runs: three agents run in parallel on one machine — a timing-sensitive failure (arrival times, cue sync, perf) is re-run ALONE before it is "fixed". Changes needed in another IA's files: message via the report.
