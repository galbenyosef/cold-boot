# Deferred checks — run after stage 3d is built (user's rule, 2026-11-18: no long/global tests until then)

Collected from agents' reports and coordinator notes. At the end: run every item, fix, re-run.

## Global
- Full `docs/CHECKLIST.md`, levels 1–6, from a frozen copy.
- `play:l1` … `play:l6` every mode; `check:reach all`, `check:nav all`, `check:doors`, `check:zfight`, `check:fxleak` 3–6,
  `check:dark` 3–6, `check-voice-level` 4–6, perf views LOW/MEDIUM/HIGH per level.

## Specific (added as they come)
- Level 4 gate-lock latch fix (38bb9fd) and level-5 tunnel latch fix (90c7605): play the end of level 4 → hand-over → level 5 → its end.
- `check:chain` with `LEVELS[4].next = 5` live; `play:l4` through the hand-over.
- 3d W9: `check-voice-level --level 6` incl. SYNC for leads and the ASR pass of `l6_aas_2` through the `phone` band; the user
  listens to `aas` (audition 18, runner-ups 19 / 12), `l6_kes_he_3` and `l6_aas_3` cuts (aas_3 cut moved to 2.66 vs the
  plan's formula 2.58), `l6_kes_end_3` (EMPTY stress dropped for ASR); W2b must define `phone` / `pa` fx in `src/audio/voice.ts`.
