# Review of the REVISION 6 / 7 plans (reviewer subagent, static read) — summary of evidence

Decisions: docs/DESIGN.md → REVISION 6.1 and 7.1. Line numbers from the tree at review time.

## REVISION 6 — core
- Foreman lands (−3.5, −66.5) `level/l2/hall.ts:32`; core door z −70, auto in phase I `level/l2/phases.ts:109`;
  `#foreman_dead` 1.5 s after the fight `story/l2/script.ts:892`; entering `t2_core` (z −88…−72, `level/l2/index.ts:88`)
  runs `talk.flush()` (`script.ts:933`, `dialogue.ts:156-161`) → a walk-in hears 1–3 s of a 35–40 s monologue.
- `l2_choir_core_2…_8` rules use `inCore = F.core && !F.choice` (`dialogue.ts:391,518-525`); `F.core` is set on entry
  (`script.ts:162-163`). Oracle repeats it (`scripts/playthrough.mjs:814-816`).
- Mirrors: north screen z −72.24 y 4.4, south z −87.76, eye (0, 3.7, −79.4): ≥ 30° from either side card.
- Count: `32 − husksKilled` (`script.ts:844,1059`); `_7` keyed on `workersKilled` (`dialogue.ts:523`); Unit 14 at
  (1.6, −68.5) shootable from inside (`hall.ts:48`); silent removal of Unit 32 after 60 s (`script.ts:813`).
- Restore: `cp2_core` saved 0.6 s after entering (`script.ts:314,341`); non-fresh branch `hold(6)` → `core_9` →
  `#core_offered` (`script.ts:942-944`); `l2_core` consequence only sets `'choir'` (`script.ts:164-165`).
- Level animation on raw `interact` (`core.ts:128-131`); `choose()` plays `cell_pull` ×3 (`script.ts:972-975`).
- `l2_unit14_door` scene line ttl 4 (`script.ts:904`); `l2_unit14_shot` (`script.ts:917-921`).
- Texts: `OBJ2.choose` (`story/l2/text.ts:104`), test `/cells/i` (`playthrough.mjs:1233`), `END_CARDS` (`text.ts:158-159`),
  removed ids referenced at `script.ts:939-949`, `playthrough.mjs:816,1717`, `dialogue.ts:526-531`; order id 0031-H
  (`core.ts:139`) vs 7-114 (`text.ts:139,142`).
- Walls: `core_wall_4` west (x −7.96), `core_wall_2` east (x 7.96), both 12 × 3.6 at y 1.5…5.1, z −86…−74 (`core.ts:59,61`).
  PATTERN LIBRARY terminal (−8, −76.5) and sign at x −7.97 y 2.25 (`core.ts:145-148`) sit on the west card.
  Cell colliders ±0.9 (`core.ts:16,107`); pedestal collider ±0.5 (`core.ts:137`); pedestal tori r 2.6/3.1 (`core.ts:50-51`);
  floor seams x −6,−4,4,6 at y 0.002 (`core.ts:52`); cyan rings/cells (`core.ts:47-51,82`); battery amber (`core.ts:55`).
- Sight: from the door the card centre is at 45°, south end 60°; the station hides the card's lower band near z −79…−80;
  from the vestibule the near half (z > −76) is hidden by the 3.0 m opening.
- Screens: canvas 512 px wide (`materials/screens.ts:112-116`), text via `opts.text` (`screens.ts:142-148`);
  `INTENSITY`/`RATE` are `Record<ScreenKind>` (`screens.ts:33-38`); `ScreenKind` (`core/types.ts:454`).
- Prompt cone `dot ≥ 0.9`, LOS ray to `i.position` (`player/index.ts:136-140`); tests call `interactables.use`
  directly (`playthrough.mjs:102`); `check-reach` `usable()` (`check-reach.mjs:178-193`), phase I at `level/l2/phases.ts:110`;
  waits to replace: `playthrough.mjs:1227` (120 s), `:1687` (150 s).

## REVISION 6 — people
- `look()` eyes → head → torso exists (`enemies/human/human.ts:889-929`): head ±1.15 rad, pitch −0.55…+0.6, eyes ±0.55/±0.4,
  torso ±0.5, centres beyond 2.4 rad (`:913`); body turn when free and > 1.35 rad at 1.5 rad/s (`:919-920`).
- No live tracking: `puppetLook` copies the point once (`human.ts:181`); callers `script.ts:550,602`, `taking.ts:239`;
  `lookAt(t, null)` at `taking.ts:135,278,373`; contract `core/types.ts:810-811`.
- Two yaw writers: story facing → `adoptFacing`/`turnToGoal` (`human.ts:279-286,323-331`) vs `faceToward` (`:920`);
  `place(t, X, FACE_WEST)` (`taking.ts:140,231`); `back_away` pinned to the hall door (`taking.ts:218-219`);
  escorts' grip computed from the mark (`taking.ts:248-249`); glass squaring (`human.ts:293-312`).
- `physics.lineOfSight` treats glass as solid (`physics/physics.ts:96-102`); `raycast` first hit only (`:65-74`).
- Booth (−10.5, −46) to the lay mark (4.6, −45.2) = 15.1 m. Path-look while walking (`human.ts:906`); speech bob (`:963`).

## REVISION 7
- `Carry` = health, weapons, flashlight (`story/save.ts:206-214`), validates pistol/shotgun only (`:217-222`);
  `saveInfo` knows levels 1–2 (`:238-244`); `LevelId = 1 | 2` (`core/types.ts:20`); 14 binary `levelId === 2` branches in
  `main.ts`, `materials/screens.ts`, `audio/index.ts`, `level/index.ts`, `story/camera.ts`, `story/index.ts`,
  `enemies/index.ts`, `player/pickups.ts`, `ui/dev/harness.ts`.
- Core waits on `unit32Dead` (`script.ts:875`), also set by the 60 s removal (`:813,831-832`).
- Enemy AI targets only the player (`enemies/ai.ts:19-25,266-323`). Only the sentry is ranged (`enemies/sentry/sentry.ts:419`).
  `enemy:damaged.part` exists (`core/types.ts:131,762`). `WeaponId = 'pistol'|'shotgun'` (`types.ts:87`), `PickupKind` (`:91`).
  `CameraRig` has menu shots and the wake rig only (`story/camera.ts:25-45`).
- Suggested build order: level chain + save/carry schema → cutscene camera (latch, placement) → soldier enemy with a
  test arena → carbine + armour → keypad + radio → water/atrium rendering → voices.
- Missing from the outline: story scaffolding shared by levels 3–6 (level 2 is 1261 + 588 lines of level-specific
  script), phase table and regions per stage.
