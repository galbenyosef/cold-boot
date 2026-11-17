# Stage 3c — rules for every build agent

You build ONE task of stage 3c "POST 4" (technical level 5) of COLD BOOT (three.js r187, TypeScript, Vite).

1. **First command, in your worktree: `git merge --ff-only main`** (worktrees are created from an old commit). It is
   the ONLY git command that changes anything you may run: no add / commit / stash / checkout / reset. Then confirm
   `docs/plans/stage-3c.md` has a filled §13 and that `docs/plans/stage-3c-k-notes.md` exists (K's result is merged).
2. Read: `CLAUDE.md`; `docs/plans/stage-3c.md` — §0, your task's row in §11, every section it cites, §10.0 (the story
   hook contract) if you touch the story or the tests, and §13 (changes after review; **§13 wins** wherever an older
   sentence disagrees); `docs/plans/stage-3c-k-notes.md` (what the contract task left for you — every `// K placeholder`
   in your files); `src/core/types.ts` (the contract). The plan is authoritative: do not invent coordinates, ids,
   numbers or text it gives. Where it is silent or wrong, decide, and list the decision in your report.
3. **One owner per file.** Edit ONLY the files your §11 row owns (plus the `// K placeholder` lines K left in them).
   The coordinator merges your uncommitted work as a patch **restricted to the paths your row owns** — anything else
   is dropped. If you need a change in a file you do not own (a contract member, a shared helper, a script), do not
   make it: describe the exact change in your report.
4. Other agents build the other tasks at the same time, in other worktrees, on the same machine. So:
   - build into YOUR OWN directory: `npx vite build --outDir <scratchpad>/dist-<task id> --emptyOutDir`, preview with
     `npx vite preview --outDir <that dir> --port <your port> --strictPort --host 127.0.0.1`; never port 5173, never
     the shared `dist`; never touch another agent's server or files;
   - **browser checks one at a time** (headless runs are expensive and falsify each other's timing): run your own test
     and the one or two existing checks your change can really affect — NOT the whole suite (the coordinator runs the
     full checklist from a frozen copy at the merge point);
   - stop every server and process you started before you finish.
5. Levels 1–4 must behave exactly as before unless your row says otherwise. `LEVELS[4].next` stays `null` on main:
   level 4 ends for a player exactly as today; the 4 → 5 hand-over is tested only with `?next=4:5`.
6. Every task ends with `npm run typecheck`, `npm run build` (or the vite build above), its own test, and the level 1–4
   checks it could affect.
7. Look at what you built (screenshots with `scripts/shot.mjs`, frame sequences, your dev page) and fix what reads
   wrong before reporting. Look at moving things in motion, not only stills. Nobody can listen to sounds or voices but
   the user: for audio, report what to listen to.
8. Final report (short): files changed; decisions the plan did not spell out; changes you need in files you do not
   own; checks run with results (and from which build); an honest "still weak" list.

## Lessons (binding for everything new)

From the user's play of stages 3a and 3b and from the 3b integration (`docs/plans/stage-3b-integration.md`):

- **Markers, not story coordinates.** Characters, props, cameras, line sources, spawn-distance points: every story
  position is a `mk5_` level marker (§8.10). The story never writes a coordinate; a missing marker is an error the
  playthrough fails on.
- **Timed beats start with their line** (≤ 0.12 s from the cue), from recorded durations (`lineLog` `cue`); never from
  wall clock; subtract `fxLead` where an fx puts a squelch / click before the voice.
- **Sounds are owned once** (§8.11 table, D25): a vignette's sounds are the level's, line audio the story's, combat
  sounds the enemy module's, keypad / radio clicks the UI's, the gate's two sounds the door's. Never play a sound that
  another owner already plays (3b played `decon_hiss` twice). `--scares` audits it with `audio.debug.log`.
- **Tests against the hook contract** (§10.0). T builds `playthrough-l5.mjs` to the table, not to ST's code; ST
  implements exactly the table. Neither renames or adds a hook without editing §10.0 first.
- **Checks must stand inside rooms.** Every check view, stand-off point, marker and spawn is asserted inside a room
  interior (`roomAt` + 0.3 m inset); a check that stands in a wall or a void passes for the wrong reason (3b).
- **Register fx volumes** (D23): every glow / particle / fog / wet-patch volume declares `rooms` (and `seenFrom` where
  it is seen through an opening), is hidden by `render.prepare`'s visibility pass, and `check:fxleak --level 5` sees
  it. Nothing glows through a gap or a pane from an unintended place.
- **Budgets with portal culling** (D24, §2.7): ≤ 6 point lights / ≤ 2 shadow slots per view on LOW (the flashlight is
  one); portals with see-ranges; far rooms not drawn; pickups room-culled; one frame zone for the sub-bay doors;
  60 fps on LOW / MEDIUM within the per-space budgets. Measure with `shot.mjs --perf` on the views of §10.6.
- **Waves that must arrive are rushed** (husks, `enemies.rush`), soldiers never rush; arrival times are nav cases at
  real speeds (husk 4.0 m/s rushed, soldier 1.6 m/s).
- **Spawns** sit beside their opening (vent / drain), under a solid ceiling, never inside a void; spawn visibility is
  tested (a member visible at spawn fails unless through an opening that opened in the last 3 s).
- In-person speech is audible at distance and never occluded by the speaker's own body; after lights-out the level stays
  readable on LOW and MEDIUM.

## Three systems now in the game (merged on main — facts, not to be rebuilt)

- **Flashlight battery** (`src/player/flashlight.ts` `TORCH`): burn 10 s, recharge 4 s only while off after a 0.25 s
  settle, cannot switch on below 15 %, the last 2 s sag and stutter, 0.5 s death flicker; no drain in cutscenes, safe
  state, pause, death; saved in checkpoints (`PlayerSave.torch`, restored ≥ 50 % if it was saved on); **not carried**
  between levels — a new level starts with a full cell. `player:flashlight` `cause: 'toggle' | 'empty' | 'refused' |
  'story'`. Tests: `?torch=inf` (no drain) and `player.debug.torch(v)` (set the cell). Design every dark space to be
  followable with the lamp OFF (strips, lit panels, emergency pools; D16: no dark stretch on the main route > 8 m) and
  readable with it on; `check:dark` judges both.
- **Carbine aim down the sights** (`WEAPON_STATS.carbine.ads`, `AIM_BINDINGS`): **right mouse button, hold** — raise
  0.20 s / drop 0.15 s, FOV 72° → 50°, aimed spread at 20 m 0.8 cm (hip 4.3 cm), climb × 0.6, walk × 0.55, no sprint;
  reload and switch drop the aim; `Player.aiming` 0 … 1, `player.debug.ads()`. Encounters are tuned for aimed fire at
  15–30 m.
- **Enemy dark-room marks** (`RigBuilder.mark()` in `src/enemies/shared/rig.ts`): small emissive points merged into the
  rig (no light, no extra draw call, ≥ 2.2 px to 25 m): red steady when awake / hunting, dim cyan in powered standby /
  dormant / worker, out when dead. The soldier's Clasp LED + halo and radio LED are marks with HIS rule — **red
  blinking 1 Hz in every living state, never cyan** (W3a adds a per-mark blink option; other types' marks unchanged).

## Practical

- `?level=5[&autostart=1][&choice=stop|command][&units=N][&continue=1]` starts level 5 directly (pistol, shotgun,
  carbine 30 + 90, armour 50, flashlight on, `testHour 62.5`); `?level=4&next=4:5&handoff=1` + `story.end()` hands 4 over
  to 5 in a test; `?nostory=1&noenemies=1` for level-only checks.
- Until the real modules land, level 5 is K's stub room (`l5_stub_end` button). `?level=5` keeps working through every
  merge: never leave `src/level/l5/index.ts` or `src/story/l5/index.ts` in a state that does not boot.
