# Stage 3b — what task K left for wave 1 (read with docs/plans/stage-3b.md §8, §11, §13)

K added the contract, the chain and stubs. Placeholders are marked `// K placeholder` in the code.

- **W1 (player):** replace the armour stub (`armor: 0` is a plain property; make it a getter) and the `switchTo` guard and
  `setActive` cast in `weapons.ts`. `applyLoadout` and `restore` must apply `save.armor`; `snapshot` must write it (the
  chain relies on it). `addArmor(points)` returns the points actually added (0 when full or `points <= 0`);
  `player:armor` is not emitted on restore/carry snaps. Once `addArmor` works, check-chain switches by itself to strict
  `player.armor` checks. `?give=all` does not give the carbine yet. `player.give('carbine'|'ammo_carbine'|'vest'|'plate')`
  is a no-op today. `WEAPON_STATS.carbine` holds the plan's numbers.
- **W2a (ui):** the HUD pickup class `'armour'` is a placeholder string with no CSS.
- **W2b (audio):** `voice.ts` `POS` has no `screen` entry yet; the `screen` → `recorder` mapping is the placeholder line in
  `renderVoiceFx` (`voicefx.ts`). Keep `fxLead`, the take lead-in skip and `check-voice-level` working.
- **W4 (level 4 greybox):** replacing `src/level/l4/index.ts` also replaces `STUB_END_ID` and `SPAWN4` (nothing imports
  them); the stub story finds its end button by the literal id `l4_stub_end` and otherwise ends via `story.end()`.
  `levelsOf('all')` includes 4, so the greybox enters `npm run check` as soon as it lands; check-decals needs at least
  one door on level 4 to run its last two tests; check-nav has no level-4 cases yet (W4 adds them). `check-doors` now
  stands on `door.floor`; `d3_bio_inner` passes today — its replacement by a sealed-door prop (§8.8) is W4's.
  `DoorSpec.cyclingPrompt`, `DoorImpl.nudge`, `sealedDoor()`, `LevelBuild.enemy(…, { skin })` are level-internal: W4's.
- **W5 (enemies):** `EnemySpawn.skin?: EnemySkin` (`'lab' | 'navy'`) exists in the contract and is ignored today.
- **W6 (materials):** remove `ClinicalMaterialName` from the `Exclude<>` in `defs/index.ts`; add `case` branches for the
  screen kinds `containment`, `video_log`, `roster`, `theatre_cam` in `screens.ts` `draw()` (blank panels today) and a
  `clinical` branch in `signs.ts` (falls back to `stencil`). Clinical materials fall back to `painted_dark` with a warning.
- **W7 (fx):** the fx API of §8.6 (fog, breathZone, bounded emitters, viewport `rooms`, volumes registry) is NOT in core
  types; the plan puts it on `FxSystemEx` in `src/fx/index.ts`, which W7 owns.
- **ST (story, wave 2):** keep the `end()` and `checkpoint(id)` hooks, the end contract (`kills4`, `testHour`) and
  `debugState.loadout`, `restoredFrom`, `arrival` (check-chain reads them). `ProgressL4` is `ProgressL3`.
- **Package scripts** `play:l4`, `check:weapons`, `check:fxleak`, `check:dark` go through `scripts/lib/optional.mjs`
  (exit 0 with a note while the script is missing; run it once it exists). Do not edit `package.json`.
- `LEVELS[3].next` stays `null` until integration; `?level=3&next=3:4` is the test-only hand-over; `?level=4` starts
  level 4 directly.
