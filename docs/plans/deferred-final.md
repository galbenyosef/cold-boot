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
- 3d W2a: add `check-cards` cases `{title: ['END OF CHAPTER 3']}` and `{ending: ['THE TRUNK','','TO BE CONTINUED']}`; run
  `check:cards`; grip ring live with real `gripProgress`; loader pips with real `part-destroyed` / 0-damage `part`
  (assumes `enemy:damaged` carries `part`); HUD unchanged on L1–5 (`check:weapons`); W2b must define `grip_tick`;
  subtitles `phone` class matches speaker labels AAS / LT. AAS / HANDSET — check the story's label.
- 3c IB5b: `check:dark` L3–5; `check:fxleak` L4 + L5 (portal culling now on level 5: duty-room feed, crawl turn, sub-bay
  doors pop-in); zfight on set pieces; `play:l5` `cmd5_port_look`, rounds through the port, magazine hatch walkable,
  vent grille drop, checkpoint restore of strips/emergency; `play:l3`/`play:l4` + a look at smoke/fog/puffs on L1–4
  (IBL feedback change + fxLight hemisphere-0 fix make fx darker where spuriously lit); re-shoot L3 kitchen + ring_e glows
  after takeover; perf §10.6 LOW/MEDIUM/HIGH. Still weak: ADS receiver still dark; bay beacons bright on end walls; dive
  locker mostly red.
- 3c IA5: every `play:l5` mode (default, `--checkpoints`, `--softlock` esp. the new guards, `--scares`, `--impatient`,
  `--order`, `--ads`); `check:nav --level 5` full, `check:reach --level 5`, `check-soldier --real`, `check:dark --level 5`;
  WRITE `check-voice-level --level 5` (never written: listeners soldier 6.7 m in the cutscene, body squawk 2/6/12 m,
  barks 5/15 m, bunk radio 3 m); look: Clasp at 20–30 m in the dark bay, vent grille drop in motion, gate_log screen in
  its bezel; soldier-in-motion review of `SOLDIER_TUNING.search.fresh`. Open decisions: the `gallery_e` soldier in wave A
  never climbs to the gallery (left as is); level-5 end-card cap measured from CHOIR's last line, not 8 s after phase X.
- 3c IB5c: `check:fxleak --level 5` (tap columns/splash in heads5); `check:dark` berths5 + galley5 lamp off; LOW point-light
  count berths5 from the spine doorway (3 points now); zfight tray rims vs deck; replay `v5_trays` fall (rims follow);
  `v5_galley_shape` with the fan. Cleanup: remove the no-op recolour in `bay.ts` `emergStrips5`. Weak: splash crowns
  geometric; tray bodies maybe too dark; berths ceiling over the first dome brightest.
- Coordinator look (f0204a6, level-5 start view): a faint second sign text "POST 4 — GATE LOCK" shows through/above the
  "POST 4 — PRESSURE GATE — NAVAL ACCESS ONLY" sign on the lock wall — two signs overlap; keep one.
- 3d W1: `check:water --part level` once W4b water is in (B3 walk-out from every 0.5 m cell of `wat6_wet` ≤ 10 s, rescue
  onto real exit markers, sight from `mk6_boss_safe` under the well's surface), then full `check:water`; `check:weapons`
  L1–5 (aimLock now also steers the pistol; wall pull-back on raycastSolid); palm-scan cases L1–5 + `check:soldier`;
  `check:physics`; `play:l4`/`play:l5` (crouch/stand); `play:l6` real grips; frames of grips with the HUD meter; user
  listens: wading steps, rescue muffle/fade. Weak: grip hands small / arms long at 0.9–1.3 m (shoulder lean), crank+pin
  hands share a knob, no lean-back on pull, no bubbles, grounded flicker in deep water; `keyName` not on the Player
  contract (W2a reads `hasKey` + its own names — dedupe with `src/player/keys.ts`).
