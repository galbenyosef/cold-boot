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
- 3d K: playthrough defaults L1–5 (`play:l3`, `play:l4` through the live hand-over, `play:l5`, `playthrough.mjs` L1–2);
  `check:nav` stair/ramp cases L3–5 (slope-seam rule changed stair contacts) + `check:nav all`; `check:reach all`,
  `check:doors`, `check:wreck`, `check:weapons`; full `check:chain` re-run with the final allow-list.
- To-dos from K: `src/enemies/nav.ts:200` per-level branch (`levelId === 5`) → level data; patrol stub only teleports;
  check-chain's two `LEVELS[5].next === null` cases rewritten when 5 → 6 goes live; rayOnly/moveOnly on dynamic boxes.
- 3c IB5a: `check:zfight` level 5 rooms + kit5 dev `&zroom=bay`; `check:nav`/`check:reach` for the mess tea-counter
  collider (x 37.18–37.8, z −9.27…−6.73); `check-dark --level 5` fore/quarters (lights moved, lighter walls); `play:l5`
  `v5_body` + snap with the new body; `check-soldier` death poses; soldier perf at LOD0 with 3 soldiers in the bay
  (+2–3k tris each); perf MEDIUM/HIGH berths + galley. To-dos: plan §2.6 "catering contractor" → "navy cook"; locker
  aisles in the ready room plain; lino/mess floors pale and glossy.
