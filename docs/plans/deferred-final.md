# Deferred checks — run after stage 3d is built (user's rule, 2026-11-18: no long/global tests until then)

Collected from agents' reports and coordinator notes. At the end: run every item, fix, re-run.

## Global
- Full `docs/CHECKLIST.md`, levels 1–6, from a frozen copy.
- `play:l1` … `play:l6` every mode; `check:reach all`, `check:nav all`, `check:doors`, `check:zfight`, `check:fxleak` 3–6,
  `check:dark` 3–6, `check-voice-level` 4–6, perf views LOW/MEDIUM/HIGH per level.

## Specific (added as they come)
- Level 4 gate-lock latch fix (38bb9fd) and level-5 tunnel latch fix (90c7605): play the end of level 4 → hand-over → level 5 → its end.
- `check:chain` with `LEVELS[4].next = 5` live; `play:l4` through the hand-over.
