# Stage 3d — what task K left for wave 1 (read with docs/plans/stage-3d.md §8.1, §10.0, §11, §13)

K (task K6 of the 3c-finish split, `docs/plans/stage-3c-finish.md`) added the contract (`src/core/types.ts`, all new
members REQUIRED, D27), the chain entry for level 6 (`LEVELS[6]` built, `LEVELS[5].next` stays null, `?next=5:6`),
physics with two collider sets, stubs and placeholders. Every placeholder line is marked `// K placeholder`; replace
it (and delete the marker) in the file your §11 row owns. Levels 1–5 run as before (one physics change: the slope-seam
rule, below). Rules: `docs/plans/stage-3d-agent-rules.md` (incl. the binding TEST POLICY).

## Placeholder lines in files K did NOT own (apply at the merge)

Five files belonged to other agents while K worked (IA5: `src/enemies/**`, `src/level/l5/cover.ts`; IB5a:
`src/materials/**`). K did **not** change them; the contract needs these lines, or main does not typecheck. They
were applied in K's worktree only to typecheck / build / test, then removed. The coordinator (or the owner) adds them
on top of IA5's / IB5a's versions:

```diff
--- src/enemies/index.ts   (W3b replaces in 3d)
-  const manager = createManager(ctx, { husk, skitter, sentry, foreman, soldier }, extra);
+  // K placeholder (stage 3d D8, W3b): the loader is a sentry (with one warning) until W3b registers the real one
+  let loaderWarned = false;
+  const loader: EnemyFactory = (world, group, position, yaw, o) => {
+    if (!loaderWarned) { loaderWarned = true; console.warn('[enemies] loader not built yet (K placeholder): a sentry stands in'); }
+    return sentry(world, group, position, yaw, o);
+  };
+  const manager = createManager(ctx, { husk, skitter, sentry, foreman, soldier, loader }, extra);

--- src/enemies/manager.ts   (inside the `manager` object literal, after `corpsePoint(id, _part) { … },`; W3b / W3c)
+    // K placeholder (stage 3d §8.1, W3b): no boss exists until the loader is registered
+    boss(_group) { return null; },
+    // K placeholder (stage 3d S8a, W3b manager line + W3c walk): every living soldier of `group` is put at the last point (no walk)
+    patrol(group, points, _o) {
+      const last = points[points.length - 1];
+      if (!last) return;
+      for (let i = 0; i < all.length; i++) { const e = all[i]; if (e.group === group && e.alive && e.type === 'soldier') { e.body.position.copy(last); e.body.velocity.set(0, 0, 0); } }
+    },

--- src/enemies/soldier/arena.ts:101   (the check-soldier arena's cover points; W3c)
-    ({ id, position: new THREE.Vector3(x, 0, z), normal: new THREE.Vector3(nx, 0, nz), height: h, room: 'arena', set: 'yard' });
+    ({ id, position: new THREE.Vector3(x, 0, z), normal: new THREE.Vector3(nx, 0, nz), height: h, room: 'arena', set: 'yard', enabled: true });

--- src/level/l5/cover.ts:87   (`enabled: true` only — the one 3c-file change §11 rule 8 allows K)
-  return { id: r.id, position: new THREE.Vector3(...r.p), normal: new THREE.Vector3(nx, 0, nz), height: r.h, room: r.room, set: r.set };
+  return { id: r.id, position: new THREE.Vector3(...r.p), normal: new THREE.Vector3(nx, 0, nz), height: r.h, room: r.room, set: r.set, enabled: true };

--- src/materials/defs/index.ts   (W5 removes the exclusion when it adds the eight materials)
-import type { MaterialName } from '../../core/types';
+import type { MaterialName, TrunkMaterialName } from '../../core/types';
-export const SPECS: Record<Exclude<MaterialName, `emissive_${string}`> | NavyExtraName, MatSpec> = {
+export const SPECS: Record<Exclude<MaterialName, `emissive_${string}` | TrunkMaterialName> | NavyExtraName, MatSpec> = { // K placeholder (stage 3d): W5 removes `| TrunkMaterialName`

--- src/materials/screens.ts   (W5 draws the real kinds)
   (INTENSITY, after `keypad: 2.6, launch: 2.4, dock_status: 2.5, onpost: 3.0,`)
+  mimic: 2.6, manifest: 2.6, interlock: 2.6, dock_board: 2.6, gauge: 2.6, // K placeholder (stage 3d, W5)
   (RATE, after `keypad: 8, launch: 8, dock_status: 12, onpost: 12,`)
+  mimic: 10, manifest: 10, interlock: 10, dock_board: 10, gauge: 10, // K placeholder (stage 3d, W5)
   (ScreenManager.draw's switch, after `case 'onpost': onpost(this.s5(s)); break;`)
+      case 'mimic': case 'manifest': case 'interlock': case 'dock_board': case 'gauge': this.terminal(s); break; // K placeholder (stage 3d, W5)
```

Until the materials lines land, `get('<TrunkMaterialName>')` warns once per name and returns the fallback (`get`'s
unknown-name path) — no change needed there.

## Contract decisions the plan left open (types.ts has the doc comments)

- **Physics, two sets (S5, D14):** `build` splits only when a collider mesh carries `userData.rayOnly` or
  `userData.moveOnly`; otherwise ONE set serves both (levels 1–5 bake exactly as before). `raycastSolid(origin, dir,
  max?)` = the moves set + enabled dynamic boxes. Dynamic boxes have no ray-only / move-only flag (none needed by the
  plan). `Physics.killY` (readonly) is new beside `setKillY(y)` (non-finite → −30). `Surface += 'water'` (physics
  `SURFACES` index 6).
- **`Level.killY: number`** (required), default −30 through `assembleLevel`'s new `killY` option; main.ts calls
  `physics.setKillY(level.killY)` right after `physics.build`. Also new options `water` (default `[]`) and `dock`
  (default null) on `assembleLevel` (K placeholder defaults, `level/assemble.ts`, W4a's file in 3d).
- **`Interactable.requireRegion?: string`** (data) + **`InteractableRegistry.allowedAt(i, feet): boolean`** (new,
  required) + `pick(eye, forward, feet?)`. A `requireRegion` interactable is a candidate only when feet are given and
  inside one box of `level.regions[id]` (tested at feet + 0.05 m); an unknown region id = never usable, warns once.
  `createInteractables(events, regions?)` takes `() => ctx.level?.regions` (main.ts). The player's own focus scan
  (`player/index.ts` `pickVisible`, not the registry's `pick`) calls `allowedAt` with the capsule's feet (one line,
  real). `use(i)` does not test the region (the story / tests may use an interactable directly). W4b: `check:reach`
  honours `requireRegion` itself.
- **`CoverPoint.enabled: boolean`** required, mutable; level data starts true.
- **`WaterVolume`**, **`CargoSlot`**, **`CargoHandle`**, **`DockArena`** as §8.1; `Level.water` / `Level.dock`
  required (levels 1–5 and the stub: `[]` / null).
- **Player:** `grip(o: GripOpts): GripHandle`, `gripProgress`, `removeKey(key)`, `wading` required. `removeKey` is
  real (deletes from the key set). The grip stub (`player/index.ts`, K placeholder block "the grip stub"): starts unless
  the player is dead, advances `1/seconds` per second of game time while `ctx.state === 'playing'` from `start`, resolves
  'done' at 1; a new grip cancels the old; `holding` = it is the running stub; no hands, no E, no distance test.
  `gripProgress` −1 when none; `wading` 0.
- **Enemies:** `EnemyType += 'loader'`; `EnemyManager.boss(group): BossControl | null`, `patrol(group, points, o)`
  required; `BossState` / `BossControl` as §8.1 (`cue('lower')`, `wake`, `setStage`, `partHp`, `floodLit`, `snapshot`,
  `restore`, `removeSilently`). The patrol stub only moves living soldiers of the group to the last point (they keep
  whatever hold state they had). `EnemySpawn.pose` doc: `'climb'` (husks, W3c) and `'working'` (the loader, W3b).
- **Events:** `GameEvents['player:rescued'] { from, to }`, `GameEvents['boss:stage'] { group, stage }`.
- **Audio:** `VoiceFxName += 'phone'` (both the contract and `audio/voicefx.ts`'s own copy); `chainOf('phone') =
  'headset'`, POS `phone` = a copy of `headset` (K placeholders, W2b). `ENEMY_Y.loader = 6`, `STEP_ID.water` /
  `IMPACT_ID.water` = the concrete ids (K placeholders, `audio/index.ts`, W2b: `wade_shallow` / `wade`, `impact_water`).
- **Materials / screens:** `ScreenKind += mimic | manifest | interlock | dock_board | gauge`; `TrunkMaterialName` (8
  names) in `MaterialName`, kept out of SPECS by the exclusion above.
- **Story save:** `CHECKPOINT_IDS_L6` (13 ids), `STORY_REV_L6 = 1`, `SPEC_L6`, `ProgressL6 extends ProgressL5 { boss:
  BossState | null; waves: { w1, w2, w3: 'pending' | 'alive' | 'dead' | null; latest: 'w1' | 'w2' | 'w3' | null };
  launchAt: number | null; lockers: Record<'e' | 'w' | 'n', boolean> }`, `emptyProgressL6()`, `WaveStateL6`;
  `validSave` shape-checks `boss` / `waves` / `launchAt` / `lockers` when present (a corrupt boss record discards the
  save — check-chain).
- **`LEVELS[6]`** exactly as §8.1 (`cast` all false, `next: null`). The now-unused `unbuilt()` helper stays exported for
  a future level. `?level=7`+ → 6 (`parseLevel` caps).
- `story/stage/base.ts` `groundY` uses `raycastSolid` (the one line §8.1 gives K).

## The slope-seam rule (the STAIR5_W drift, A4)

Cause: a stair's slope slab is a box whose top face is two triangles split along its diagonal. Walking UP, the capsule
sinks into the rising slope every sub-step; once past the diagonal it still touches the other triangle exactly AT the
diagonal, and that contact was resolved along the edge→capsule direction, which has a sideways (here westward)
component — 0.34 … 1.1 m over the 9 m flight depending on the line (measured; walking down never sinks, so no drift).
Fix (`physics.ts`): at build, edges shared by two coplanar walkable-slope triangles (|n.y| in [0.5, 0.97)) are
collected ("seams"); with `holdSlopes`, a contact whose closest point lies on such a seam (and only on seams) is resolved
against the triangle's plane, vertically, like the face contact the neighbour triangle stands for. Measured after:
max |Δx| ≤ 0.002 m on three lines up STAIR5_W; the synthetic slab case drifts 0.34 / 0.69 / 1.0 m with the rule off
(`physics._seamFix = false`, a test hook) and 0 with it on. Affects every level with `holdSlopes` (3, 4, 5): only slope
seam contacts change. `check:nav`'s ramp / stair cases on levels 3–5 are in the deferred list.

## Per task

- **W1 (player):** `player/index.ts` — the grip stub block, `gripProgress`, `wading` getters (K placeholders) — replace
  with the real grip / wading / rescue; `removeKey` and the `allowedAt` line in `pickVisible` are real (keep). Footsteps
  (`:177`) and `Controller.canStand`'s up-ray → `raycastSolid`. Emit `player:rescued`.
- **W2a (ui):** nothing in `ui/index.ts` (the grip meter reads `player.gripProgress`; no contract member).
- **W2b (audio):** `voicefx.ts` `chainOf` (`phone → headset`), `voice.ts` POS `phone`, `audio/index.ts` `ENEMY_Y.loader`,
  `STEP_ID.water`, `IMPACT_ID.water` — all K placeholders.
- **W3b:** the two foreign-file blocks above (`enemies/index.ts` loader factory, `manager.ts` `boss` / `patrol`) —
  replace them; emit `boss:stage`.
- **W3c:** `soldier/arena.ts` / `soldier/cover.ts`: `CoverPoint.enabled`; the D20 flood input to `lit` (see the 3c
  verification: `lit` has no outside hook today); `nav.walkable` / `ai.groundAt` → `raycastSolid`; the patrol walk.
  Also: `enemies/nav.ts:200` has a real binary level branch (`this.ctx.levelId === 5`, the level-5 walkway fallback,
  3c) — allow-listed by K in `scripts/levelgrep-allow.txt` with a note; fold it into level data when you own the file.
- **W4a:** replace `src/level/l6/index.ts` entirely (K stub: one room `lock6` x −4 … 4, z −3 … 5, h 3.0, button
  `l6_stub_end`, screen `l6_stub_screen`, marker `mk6_start` (0, 0, 3); `SPAWN6`, `STUB_END_ID6` exports — nothing
  imports them). Keep calling `buildWater6(L)` / `buildDock6(L)` and pass `water`, `dock`, `killY: -36` to
  `assembleLevel`. `assemble.ts`'s `water` / `dock` / `killY` defaults are K placeholders (keep the defaults for 1–5).
  Interactables with `requireRegion` are plain data on the `Interactable` (add the field to `L.interact` or set it after).
- **W4b:** replace `src/level/l6/{water,dock}.ts` (stubs return `[]` / null). Water quads: collider meshes with
  `userData.rayOnly = true`, `userData.surface = 'water'`; guards / rails: `userData.moveOnly = true`.
  `check-reach.mjs`: honour `requireRegion` (`interactables.allowedAt(i, feet)` exists in the page).
- **W5:** the two materials blocks above; the five screen kinds.
- **W6:** `fx/index.ts` `floorPlane()` (`:197-201`) → `raycastSolid`.
- **W9:** `phone` parses (renders as `headset` until W2b).
- **ST-a / ST-b:** replace `src/story/l6/index.ts` (K stub on `createStagePage`). Keep the end's contract (check-chain
  reads it): `end()`, `checkpoint(id)`, `next()`, carry `from: 6` with `kills6`, `testHour` (≥ 62.75), `manifest`,
  `aas`, `launchHour`, `trunkCut`, `loaderDead` (booleans / number); cards `THE TRUNK` / `` / `TO BE CONTINUED` (14 s,
  `ending`) then `END OF CHAPTER 3` (4 s, `title`); stored level 6; level-6 checkpoint cleared; `debugState.loadout`,
  `restoredFrom`, `arrival { from, armor }`. The stub's `debugState.cards` is a stub extra. Level-5 story helpers you
  need are level-5-internal (see below) — copy them.
- **T:** `play:l6`, `check:loader`, `check:water`, `check:physics` are in `package.json` through
  `scripts/lib/optional.mjs` (check-physics exists now; `check` runs it after `check-chain`).
- **IA:** `LEVELS[5].next = 6` makes 5 → 6 live; then rewrite check-chain's "L5 end WITHOUT `?next=`" and the
  "without ?next=5:6 a carry from 5 is not level 6's" cases to the live hand-over (as K6 did for 4 → 5).

## 3c verification (§11 rule 7; against main 2f98f84 — the header table of stage-3d.md is rewritten with these)

| assumed interface | result |
|---|---|
| `SOLDIER_TUNING`, tokens, damage cap, `enemies.debug.soldiers()`, cover choice | exist as assumed (`enemies/soldier/fire.ts:12`, `:166`, `:206-224`; `manager.ts:489`; `soldier/cover.ts:68-70`) |
| the `lit` flag (3c D18) | **differs**: only "player fired ≤ 1.5 s ago" (`fire.ts:169`, `:251`; read `soldier.ts:307`, `:338`); **no outside input** — W3c adds the flood hook (D20) |
| bark gate | **differs**: it is the story's (`story/l5/dialogue.ts:111` `barkOk`, `story/l5/script.ts:1325`), not the enemies' |
| `CoverPoint.enabled` read by cover choice | missing (expected: 3d adds it) — W3c |
| cover `selfTest` | exists as `selfTestCover(ctx, level)` (`level/l5/cover.ts:101`) |
| `room(…, { floors: { nav, exits } })`, bounds from the lowest floor, `StairDef.y0` / `nav` | exist as assumed (`level/context.ts:70`, `:262-272`; `level/l3/grey.ts:88-90`) |
| nav obstacles | **differs**: no API; `navCases.noNodes` is a check field (`level/l5/index.ts:264`, `check-nav.mjs`) |
| opening a wall below floor level (crawl under `d5_arm`) | **differs**: a GreyGrid air box over two rooms (`airIn`, `level/l5/grey.ts:404`, `:508`), level-internal |
| hatches (mover, `open(k)`, underside interact + eye rule) | exist (`hatchLid`, `level/l5/setpieces.ts:1555-1635`; greybox `grey.ts:336`; `eyeGate`, `grey.ts:381`; story re-check `story/l5/script.ts:1365-1378`), level-5-internal |
| Q handling, POS `radio` / `throat`, fx chains | exist; Q is `ScriptL5.radioAsk` (`story/l5/script.ts:236`, `:770`); POS / chains real (`audio/voice.ts:97,101`, `voicefx.ts:339,365`), `fxLead('radio') = 0.04` |
| `scareOk(id)`, `scares`, `audio.debug.log` | exist; `scareOk` is **private to `ScriptL5`** (`story/l5/script.ts:1235`); log at `audio/engine.ts:95` |
| level `calm()` override, door-calm, stray rule, `afterReplay` | exist; `calm` / `doorCalm` / `strayRule` are in **`story/l5/base.ts`** (`:413`, `:395`, `:371-392`; the stray rule removes whole groups silently); `afterReplay()` is the shared `story/stage/base.ts:222` |
| `mustNotUse` | exists (`level/l5/phases.ts:99`, read `scripts/check-reach.mjs:271`) |
| `linesReady(ids, s)` | **differs**: a story-base method of level 5 (`story/l5/base.ts:501`), not the cutscene module |
| `fx.tracer` | exists (`fx/index.ts:155`, `FxCombat`, `TracerOpts { color?, speed? }`) |
| level-5 end (facts, cards, `goToLevel`, hooks) | exists as assumed (`story/l5/index.ts:41-112`, `story/l5/text.ts:10,12`); the stub button is gone |
| plan citations | fixed in stage-3d.md: `base.ts:770-799`, `page.ts:111-129`, `manager.ts:306-317`, `manager.ts:268-273` (wreck doorway exclusion), `fx/index.ts:197-201`, `player/index.ts:773` (`aimLock`); `controller.ts:10-27`, `physics.ts:6`, `pickups.ts:294-302`, `player/index.ts:177`, `cast.json:88` (`hale:whisper`) confirmed |

## Scripts

- `scripts/check-physics.mjs` (new): two sets, kill height, the seam rule + its control, `requireRegion`, the level-6
  stub's live values, a walk up STAIR5_W (`--stair 0` skips it). ~8 s.
- `scripts/check-chain.mjs`: boot 1–6, `?level=7/9` → 6, stored 6 / 8; `?level=6` direct start; new part `chain5`:
  LIVE 4 → 5 (both choices, armour, real reload), L5 end without override, L5 → L6 via `?next=5:6` (both choices,
  armour, real reload), the L6 chapter end (two cards), the stub's button; menu on a stored 6; storage: a pre-3d
  level-5 checkpoint, a level-6 round trip, a corrupt boss record. The old "L4 end WITHOUT ?next= (next null)" case is
  gone (4 → 5 is live).
- `scripts/lib/check-common.mjs`: `levelsOf('all')` → [1 … 6]; `launch()` falls back to the newest installed
  `chromium_headless_shell-*` when playwright's own revision is missing (it was, on this machine: playwright 1.65.1
  wants 1255, 1254 is installed).
- `scripts/levelgrep-allow.txt`: three 3c hits added (two index comparisons, one real level branch — see W3c).
