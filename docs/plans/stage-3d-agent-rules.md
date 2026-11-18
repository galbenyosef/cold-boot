# Stage 3d — rules for every build agent

You build ONE task of stage 3d "THE TRUNK" (technical level 6) of COLD BOOT (three.js r187, TypeScript, Vite). Copied
from `docs/plans/stage-3c-agent-rules.md` with "3c" → "3d", level 5 → 6, plus rules 9–11 (stage-3d.md §11) and the
TEST POLICY below.

## TEST POLICY (the user's rule — binding, overrides "run your own test" in the agent rules)

Binding for EVERY stage-3d agent until stage 3d's integration (IA). Copied verbatim from `docs/plans/stage-3c-finish.md`:

> No long or global test runs now. Allowed: `npm run typecheck`, one vite build into your own dir, screenshots / short frame
> sequences of what you changed, and a SHORT targeted scripted segment (≤ ~2 min wall clock each, few of them) when you need
> it to decide "better or not". NOT allowed now: the CHECKLIST, any full `play:lN` mode, `check:* all`, `check:reach/nav`
> across levels, voice-level sweeps, perf sweeps over every view. Anything you would have run goes into your report's
> **"deferred checks"** list; the coordinator collects it in `docs/plans/deferred-final.md` and runs it after stage 3d.

Where a rule below or a "done when" column of stage-3d.md §11 says "run", "green" or "the level 1–5 checks it could
affect", read it through this policy: run only what the policy allows, list the rest under **"deferred checks"**.

## Rules

1. **First command, in your worktree: `git merge --ff-only main`** (worktrees are created from an old commit). It is
   the ONLY git command that changes anything you may run: no add / commit / stash / checkout / reset. Then confirm
   `docs/plans/stage-3d.md` has a filled §13 and that `docs/plans/stage-3d-k-notes.md` exists (K's result is merged).
2. Read: `CLAUDE.md`; `docs/plans/stage-3d.md` — §0, your task's row in §11, every section it cites, §10.0 (the story
   hook contract) if you touch the story or the tests, and §13 (changes after review; **§13 wins** wherever an older
   sentence disagrees); the header table ("3c dependency", verified by K); `docs/plans/stage-3d-k-notes.md` (what the
   contract task left for you — every `// K placeholder` in your files, and the 3c verification); `src/core/types.ts`
   (the contract). The plan is authoritative: do not invent coordinates, ids, numbers or text it gives. Where it is
   silent or wrong, decide, and list the decision in your report.
3. **One owner per file.** Edit ONLY the files your §11 row owns (plus the `// K placeholder` lines K left in them).
   The coordinator merges your uncommitted work as a patch **restricted to the paths your row owns** — anything else
   is dropped. If you need a change in a file you do not own (a contract member, a shared helper, a script), do not
   make it: describe the exact change in your report.
4. Other agents build the other tasks at the same time, in other worktrees, on the same machine. So:
   - build into YOUR OWN directory: `npx vite build --outDir <scratchpad>/dist-<task id> --emptyOutDir`, preview with
     `npx vite preview --outDir <that dir> --port <your port> --strictPort --host 127.0.0.1`; never port 5173, never
     the shared `dist`; never touch another agent's server or files;
   - **browser checks one at a time** (headless runs are expensive and falsify each other's timing): run your own test
     and the one or two existing checks your change can really affect — NOT the whole suite (and see the TEST POLICY);
   - stop every server and process you started before you finish.
5. Levels 1–5 must behave exactly as before unless your row says otherwise. `LEVELS[5].next` stays `null` on main:
   level 5 ends for a player exactly as today (POST 4 / TO BE CONTINUED); the 5 → 6 hand-over is tested only with
   `?next=5:6`. (`LEVELS[4].next = 5` is live since 3c's finish: level 4 hands over to level 5.)
6. Every task ends with `npm run typecheck`, its own vite build, its own (short) test, and lists the level 1–5 checks it
   could affect under "deferred checks" (TEST POLICY).
7. Look at what you built (screenshots with `scripts/shot.mjs`, frame sequences, your dev page) and fix what reads
   wrong before reporting. Look at moving things in motion, not only stills. Nobody can listen to sounds or voices but
   the user: for audio, report what to listen to.
8. Final report (short): files changed; decisions the plan did not spell out; changes you need in files you do not
   own; checks run with results (and from which build); **"deferred checks"**; an honest "still weak" list.
9. **No task edits a 3c file** except where its §11 row lists it (W3c: `enemies/soldier/{soldier,cover}.ts`; W4a:
   `level/context.ts`, `level/assemble.ts`; W4b: `level/nav.ts`, `scripts/check-reach.mjs`, `scripts/check-nav.mjs`;
   T: `scripts/check-cutscene.mjs`, `scripts/check-wreck.mjs` (level-6 cases only)). Level-5 helpers you need (the
   scare kit, the stray rule, `linesReady`, `eyeGate`, `hatchLid`, `airIn`, `selfTestCover` — see the K notes) are
   COPIED into your level-6 file, not imported from or edited in `src/*/l5/`.
10. Agents' "still weak" lists are to-dos for IA / IB, not disclaimers (CHECKLIST).
11. After ANY `npm run voice`, re-set `manifest.lines.l4_sunde_8.lead = 0.08` (3c W9 note). Line `cut`s are in FILE time
    incl. `lead`.

Models: **Opus** (spawned explicitly) for design-heavy work; **Sonnet** only for small, tightly specified tasks (W2a, W9).

## Lessons (binding for everything new)

From the user's play of stages 3a–3c and from the 3b / 3c integrations:

- **Markers, not story coordinates.** Characters, props, cameras, line sources, spawn-distance points: every story
  position is a `mk6_` level marker (§8.11). The story never writes a coordinate; a missing marker is an error the
  playthrough fails on.
- **Timed beats start with their line** (≤ 0.12 s from the cue), from recorded durations (`lineLog` `cue`); never from
  wall clock; subtract `fxLead` where an fx puts a squelch / click before the voice.
- **Sounds are owned once** (§8.12 table, D25): a vignette's sounds are the level's, line audio the story's, combat
  sounds (incl. the loader) the enemy module's, keypad / grip / radio clicks the UI's, a door's sounds the door's. Never
  play a sound that another owner already plays. `--scares` audits it with `audio.debug.log`.
- **Tests against the hook contract** (§10.0). T builds `playthrough-l6.mjs` to the table, not to ST's code; ST
  implements exactly the table. Neither renames or adds a hook without editing §10.0 first.
- **Checks must stand inside rooms.** Every check view, stand-off point, marker and spawn is asserted inside a room
  interior (`roomAt` + 0.3 m inset); a check that stands in a wall or a void passes for the wrong reason.
- **Register fx volumes** (D23): every glow / particle / fog / water / well volume declares `rooms` (and `seenFrom` /
  `apertures` where it is seen through an opening), is hidden by `render.prepare`'s visibility pass, and `check:fxleak
  --level 6` sees it.
- **Budgets with portal culling** (D24, §2.7): ≤ 6 point lights / ≤ 8 spots / ≤ 2 shadow slots per view on LOW (the
  flashlight is one); the loader's floods non-shadow on LOW and MEDIUM; far rooms not drawn; 60 fps on LOW / MEDIUM
  within the per-space budgets (§2.7.5). The chamber's perf view is measured on the greybox before dressing (§11 gate).
- **Waves that must arrive are rushed** (husks, `enemies.rush`), soldiers never rush; arrival times are nav cases at
  real speeds (husk 4.0 m/s rushed, soldier 1.6 m/s).
- **Spawns** sit beside their opening (vent / drain / ladder), under a solid ceiling, never inside a void; spawn
  visibility is tested.
- **Water is ray-only, guards are move-only** (D14, K): water surfaces are collider meshes with `userData.rayOnly`
  (rounds and sight stop, bodies pass); rails / bar and mesh guards / the tarp `userData.moveOnly` (bodies stop, rounds
  and sight pass). Every GROUND or HEADROOM query uses `physics.raycastSolid`, never `raycast` (water is never a floor).
- **Containment** (conventions of stage-3d.md): a barrier is ≥ 2.35 m above any floor where a body can lie; `check:reach`
  tests the hazard on every simulated step down to the level's lowest point (−36).
- In-person speech is audible at distance and never occluded by the speaker's own body; dark spaces stay readable on
  LOW and MEDIUM with the lamp off (strips, pools) and on.

## Systems in the game (merged on main — facts, not to be rebuilt)

- **Flashlight battery** (`src/player/flashlight.ts` `TORCH`): burn 10 s, recharge 4 s only while off after a 0.25 s
  settle, cannot switch on below 15 %; **not carried** between levels — a new level starts with a full cell. Tests:
  `?torch=inf`, `player.debug.torch(v)`.
- **Carbine aim down the sights** (right mouse button, hold; `Player.aiming`, `player.debug.ads()`). Encounters are
  tuned for aimed fire at 15–30 m.
- **Enemy dark-room marks** (`RigBuilder.mark()`): red steady when awake, dim cyan in standby, out when dead; the
  soldier's marks blink red 1 Hz in every living state.
- **The taken soldier** (3c, `src/enemies/soldier/*`): `SOLDIER_TUNING` (`fire.ts`), hold / release, tokens, damage cap,
  cover choice from `Level.cover`, `enemies.debug.soldiers()`.
- **K's 3d contract** (see `docs/plans/stage-3d-k-notes.md`): two collider sets + `raycastSolid`, `setKillY` /
  `Level.killY`, `Level.water` / `Level.dock`, `CoverPoint.enabled`, `Interactable.requireRegion` (+ `allowedAt`), the
  grip / wading / `removeKey` / rescue player members, `BossControl` / `boss()` / `patrol()`, `boss:stage`,
  `player:rescued`, `VoiceFxName 'phone'`, five screen kinds, `TrunkMaterialName`, `ProgressL6`.

## Practical

- `?level=6[&autostart=1][&choice=stop|command][&units=N][&continue=1]` starts level 6 directly (pistol 12 / 36, shotgun
  6 / 12, carbine 30 / 120, armour 50, flashlight on, `testHour 62.75`, facts incl. `radio`, `kessler`);
  `?level=5&next=5:6&handoff=1` + `story.end()` hands 5 over to 6 in a test; `?nostory=1&noenemies=1` for level-only
  checks.
- Until the real modules land, level 6 is K's stub room (`lock6`, `l6_stub_end` button, `mk6_start`). `?level=6` keeps
  working through every merge: never leave `src/level/l6/index.ts` or `src/story/l6/index.ts` in a state that does not
  boot.
- Playwright: if its browser revision is missing (`npx playwright install` not run after an update),
  `scripts/lib/check-common.mjs` `launch()` falls back to the newest installed `chromium_headless_shell-*`; a script of
  your own should use `launch()` from there.
