# Stage 3c — what task K left for wave 1 (read with docs/plans/stage-3c.md §8, §10.0, §11, §13)

K added the contract (`src/core/types.ts`, all new members REQUIRED, D28), the chain (level 5 in `LEVELS`, the
next-aware level-4 end, `?next=4:5`), stubs and placeholders. Every placeholder line is marked `// K placeholder` in
the code; replace it (and delete the marker) in the file your §11 row owns. Levels 1–4 run exactly as before.

## Contract decisions the plan left open (types.ts has the doc comments)

- `LevelInfo.cast.soldier: boolean` (new, required): true only on level 5 — "the level has a soldier ACTOR" (§8.2.6
  pre-warm). Levels 1–4 false.
- `EnemyManager.holding(group): number` (new, required): living members of `group` in hold. ST's level-5 `calm()` and
  `debugState.groups[g].holding` read it; W3b implements it.
- `EnemyManager.corpsePoint(id, 'chest')`: the MANAGER applies the B2 lift — x/z of the chest bone, y =
  `max(chest.y, wreckBox.max.y + 0.08)`. null = unknown / alive / removed. It tracks the body while it falls; ST reads
  it after the fall (≥ 1.6 s after `enemy:died`).
- `EnemyManager.release(group)` emits `enemy:alerted` per released soldier; on any other type it is `wakeGroup`.
- `EnemySpawn.pose: 'hold'` is the hold spawn pose (soldiers, `mode: 'spawn'`); `EnemySpawn.arms?: 'pistol' | 'carbine'`
  (absent = carbine), `EnemySpawn.cover?: string` (absent = no preferred set). Type `SoldierArms`.
- `CoverPoint` as §8.1; `Level.cover: readonly CoverPoint[]` (levels 1–4 `[]`, via `assembleLevel`'s new `cover` option).
- `RoomFloor.nav?: boolean` (absent = true) and `RoomFloor.exits?: [x, y, z][]` are contract DATA (the plan called them
  level-internal; they are on `Level.rooms`, so the enemies can read them). `Level.floorAt(p): FloorInfo | null` is a
  REQUIRED contract member (the plan put it on `LevelEx`; W3b and W4 build in parallel, so it needs one typed home) with
  a working default in `level/assemble.ts` (`floorOf`): the room by `roomAt`, then the floor (main = index −1, or
  `floors[i]` whose box contains p) with the greatest y ≤ p.y + 0.5, else the lowest; `nav`, `exits` as Vector3s.
- `ActorOpts.name?: string` (a soldier actor's name tape). `GameEvents['enemy:fired']` as §8.1.
- `UISystem.radio(o | null)`, `UISystem.keypad({ digits, title, panel? }): Promise<string | null>`, `closeKeypad()`.
  A second `keypad()` while one is open closes the first (null). The STORY sets `player.controlsEnabled = false` while
  it is open (UI does not).
- `DebugFlags.keypadInput: string | null` (tests only, never from the URL; always null at boot; `__game.debug` is
  `ctx.debug`). K's stub keypad resolves with it and clears it (one code per `keypad()` call).
- Record shapes for the debug hooks (types only, not members): `SoldierDebug` (H12, `enemies.debug.soldiers()`, W3b)
  and `AudioLogEntry` (H14, `audio.debug.log`, W2b). Both are module extras read through a cast.
- `Level.vignette('<id>:snap')` — the snap convention is documented on the contract (W4 implements it in
  `level/context.ts`).
- `VoiceFxName` += `radio`, `throat` (in `FX_NAMES`; the `radio → headset` alias is gone from `parseFx`; no existing line
  used it). `ScreenKind` += `keypad`, `launch`, `dock_status`, `onpost`. `SignStyle` += `navy` (falls back to stencil
  in `signs.ts` without a change). `MaterialName` += `NavyDockMaterialName` (8 names, §8.9).
- `ProgressL5` extends `ProgressL3` with `scares: string[]` and `codeWrong: number` (the plan wrote `= ProgressL3` and
  listed both fields beside it); `emptyProgressL5()` fills them; `validSave` accepts them when present.
- **Carry and the flashlight cell:** the cell is NOT carried. `CarryV2.flashlight` is only lamp on/off; a new level
  starts with a full cell (as built; check-chain asserts it on 4 → 5).
- The direct-start carbine `30 + 90` goes through the same pickup path as every direct start (`give(weapon, clip)` then
  `give(ammo, reserve)`), so it lands as **30 / 120** (as pistol 12 + 24 lands as 12 / 36 since level 2).

## Per task

- **W2a (ui):** `src/ui/index.ts` — `radio()` is a no-op, `keypad()` resolves at once with `ctx.debug.keypadInput`
  (then clears it) or null, `closeKeypad()` a no-op. Replace all three. The real overlay must still honour
  `ctx.debug.keypadInput` (contract): when it is set as `keypad()` opens, consume it, type it key by key (visible,
  with the clicks) and press ENT — so ST's H10 `keypad(code)` works the same on your UI and on K's stub.
- **W2b (audio):** `voicefx.ts` `chainOf`: `radio → headset`, `throat → choir` (placeholder lines) — build the real
  chains, `fxLead('radio') = 0.04` (it is 0.07 today through `headset`), `radio:1`. `voice.ts` `POS.radio` /
  `POS.throat` are copies of `headset` / `choir` — set the real profiles (`throat` ref 5.5). `audio/index.ts`
  `ENEMY_Y.soldier = 1.4` is a placeholder (the contract's `Record<EnemyType>` needed a value). `audio.debug.log` does
  not exist yet (entries typed `AudioLogEntry`). `flashlight_die` / `flashlight_dead` and every §8.11 id are yours.
- **W3a (soldier body):** `EnemyType 'soldier'`, `ActorOpts.name`, `LevelInfo.cast.soldier` exist. No rig, no template:
  `enemies.actor('soldier', …)` builds a HUSK today (through the placeholder factory, one console warning).
- **W3b (soldier AI):** `src/enemies/index.ts` — the `soldier` factory is a husk with a warning (placeholder): register
  the real one and pre-warm when `enemySpawns` hold a soldier OR `levelOf(ctx).cast.soldier`. `src/enemies/manager.ts`
  — `release` = `wakeGroup`, `holding` = 0, `corpsePoint` = null (placeholders). Emit `enemy:fired`. Add
  `debug.soldiers(): SoldierDebug[]` on the manager. Read `level.floorAt(p)` (nav / exits) and `level.cover`; both exist
  (exits are `[]` until W4 passes them through).
- **W4 (greybox):** replace `src/level/l5/index.ts` entirely (K stub: one room `lock5` x −4 … 4, z −3 … 5, button
  `l5_stub_end`, screen `l5_stub_screen`, marker `mk5_start`; `SPAWN5`, `STUB_END_ID5` exports — nothing imports them).
  The story stub finds its end button by the literal id `l5_stub_end` and otherwise ends via `story.end()`; once your
  greybox has no such button, check-chain skips that one case by itself. `assembleLevel` takes `cover` (default `[]`)
  and provides `floorAt` (`floorOf`) — keep both when you change `assemble.ts` (bounds from the lowest floor).
  `LevelBuild.room(…, { floors })` (context.ts) still types floors as `{ y, box }`: add `nav` / `exits` there and copy
  them onto `Room.floors` (the contract fields exist). `StairDef.y0` / `nav` are level-internal (`l3/grey.ts`) — not in
  the contract. `levelsOf('all')` is [1 … 5]: the stub is in `npm run check` today (zfight, doors, reach, decals
  pass on it); your greybox enters it as soon as it lands. `check:nav` has no level-5 cases yet (yours).
- **W5 (materials):** `src/materials/defs/index.ts` — remove `NavyDockMaterialName` from the `Exclude<>` of `SPECS` when
  you add the eight materials (until then `get` warns once per name and returns `painted_dark`). `src/materials/
  screens.ts` — `keypad`, `launch`, `dock_status`, `onpost` draw as `terminal_idle` (placeholder `case` line) with
  placeholder `INTENSITY` / `RATE` values; draw the real kinds. `SignStyle 'navy'` falls into the stencil branch of
  `signs.ts`; add its branch.
- **W6 (fx):** nothing of yours is in the contract. `fx.tracer(from, to, o?)` lives on your `FxSystemEx`; W3b calls it
  through a cast — publish the exact signature in your report (suggested: `tracer(from: Vector3, to: Vector3, o?:
  { color?: ColorRepresentation; speed?: number }): void`).
- **W7, W8:** nothing left by K.
- **W9 (voices):** fx names `radio`, `radio:1`, `throat` parse (they render as `headset` / `choir` until W2b).
- **ST (story, wave 2):** replace `src/story/l5/index.ts` (K stub on `createStagePage`: start loadout, title card
  `POST 4` / `ERIDU DEEP — NAVAL DETACHMENT`, end). Keep the end's contract (check-chain reads it): `end()`,
  `checkpoint(id)`, `next()`, carry `from: 5` with `kills5` + `testHour` (≥ 62.5; arrival `facts.testHour ?? 62.5`),
  card `POST 4` / `` / `TO BE CONTINUED` 12 s skippable (`POST 4` alone, 6 s, when `nextOf(5)` is set), stored level 5,
  level-5 checkpoint cleared; `debugState.loadout`, `restoredFrom`, `arrival { from, armor }`. `SPEC_L5`,
  `CHECKPOINT_IDS_L5`, `ProgressL5`, `emptyProgressL5` are in `story/save.ts`.
- **T (tests, wave 2):** `npm run play:l5` and `npm run check:soldier` go through `scripts/lib/optional.mjs` (exit 0
  with a note while the script is missing). Do not edit `package.json`.
- **Coordinator / IA:** `LEVELS[4].next = 5` in `core/progress.ts` makes the hand-over live; then `play:l4` (no flag)
  asserts the hand-over card and stored level 5 by itself (`story.next()`), and check-chain's "L4 end WITHOUT
  `?next=`" case must be rewritten to the live hand-over (as 3b's IA did for level 3).

## Scripts

- `scripts/check-chain.mjs`: new cases (boot 1–5, `?level=6/9` → 5, stored 5 / 6, level-5 direct start + HUD, L4 end
  on main, L4 → L5 for both choices, carried armour 4 → 5, real reload, L5 end, the stub's button, menu on a stored 5,
  pre-3c level-4 checkpoint, level-5 checkpoint round trip).
- `scripts/playthrough-l4.mjs`: `--next=4:5` (every page gets `&next=4:5`); the end card / stored level are asserted
  per `story.next()`.
- `scripts/lib/check-common.mjs` `levelsOf('all')` → [1 … 5].
