# voice/lines.l2.json — changes for REVISION 5 / 5.1 (story agent)

Text is final. Regenerate with `npm run voice` (only changed hashes are rebuilt), then `npm run voice:check`.
`voice/lines.l1.json` is unchanged.

## Rewritten (same id, new text → regenerate)
- `l2_tomas_oneway` — "Handset's one-way…" (the intercom press takes the handset)
- `l2_tomas_estop_1` — no longer "See the red button?" (heard anywhere over the handset)
- `l2_tomas_handset` — "Keep the handset…"
- `l2_tomas_unit14`, `l2_tomas_unit14_off` — describe a projection, not a unit stepping off a treadmill
- `l2_tomas_rig_1` — the rig is not empty any more: something is walking on it
- `l2_choir_power_2` — no "Line Control is open" (the doors show CYCLING)
- `l2_tomas_power_1` — no "Door's green!"
- `l2_tomas_power_3` — "My door says cycling. It's not opening. Come round…"
- `l2_tomas_run_1`, `l2_tomas_run_wait` — dawdle lines that claim nothing the player can disprove
- `l2_tomas_run_4` — "The hall door. It's opening. That one never opens." (opens the taking)
- `l2_tomas_window_3` — trimmed (scene clock)
- `l2_choir_tunnel` — the single riding line ("Hold still, Technician. The arms are only measuring.")
- `l2_choir_core_7`, `l2_choir_core_11` — no head count ("All but a few…", "Nearly all of them…")
- `l2_tomas_bark_provoked` — no "I said don't"

## Added
- `l2_unit_fitting_denied` (unit) — the fitting door before Tomas unlocks it
- `l2_tomas_fitting_wait` — same door, tried while he is still unlocking it
- `l2_tomas_unlock` — fitting unlock (fourth line of the first talk)
- `l2_tomas_pass_taken_quiet` — pass taken, alcove units already dead
- `l2_tomas_fit_fight_front` — "The alcoves!" when nothing is behind the player
- `l2_tomas_fit_after_quiet` — after the fight when nobody fired ("that was loud" variant)
- `l2_tomas_window_1_far` — the player is not at a window
- `l2_tomas_shot_glass` — the player shoots the spine window during the taking
- `l2_tomas_window_4_plain`, `l2_tomas_window_6_plain` — mum / coffee setups never heard
- `l2_choir_glass` — "The glass is rated, Technician."
- `l2_choir_nudge` — "The line is the way through, Technician."
- `l2_unit32_plain`, `l2_unit32_die_plain` (tomas, fx unit) — Unit 32 when the joke setups were never heard
- `l2_choir_core_7_killed`, `l2_choir_core_11_killed` — the player shot working units
- `l2_unit_wait` (anand, fx unit) — "morning — what's the job" when Unit 14 is dead
- `l2_tomas_bark_killed_worker` — "Okay. That's one way."
- `l2_tomas_relay_needs_pass` — relay door tried before the pass was ever mentioned
- `l2_tomas_bark_dead_first` — first dead Section C door (the existing `_spine_dead` says "too")
- `l2_tomas_bark_unit14_first` — first "behind you" about the projection (the existing one says "again")
- `l2_tomas_shot_at` — the player shoots the booth glass at him (hall side)

## Removed (delete `public/voice/<id>.mp3` and the manifest entries)
- `l2_tomas_run_2`, `l2_tomas_run_glass`, `l2_tomas_run_5`, `l2_unit14_booth`, `l2_choir_belt`, `l2_tomas_bark_belt`

# voice/lines.l3.json — stage 3a (P9)

45 lines from docs/plans/stage-3a.md §6.2 (halvorsen 19, choir 16, unit 5, reyes 3 incl. murmur, resident 2). Generated, `voice:check` 241/241 ok.
New cast: `halvorsen`, `reyes`, `resident` (+ halvorsen `whisper` variant, derived, matches note "whisper": c2_7, go_1, go_2).
Nobody has listened. Choices are by measurement (median F0 Hz / spectral centroid Hz / voiced fraction / mean clone similarity / ASR of samples; all candidates: ref ASR ok, samples score 1.00).
Existing refs for comparison: choir 180/1542, tomas 190/1851, hale 184/1216, voss 235/1745, anand 163/1318, okafor 137/1766, unit 269/1969.

| char | audition | description, seed | F0 | centroid | voiced | role |
|---|---|---|---|---|---|---|
| halvorsen | 7 | male, middle-aged, moderate pitch, british accent, 1 | 113.5 | 2475 | 0.71 | PICKED |
| halvorsen | 9 | same, 3 | 117.6 | 2407 | 0.47 | runner-up |
| halvorsen | 8 | same, 2 | 100.6 | 2949 | 0.58 | alt (brightest) |
| halvorsen | 6 | male, elderly, moderate pitch, 3 | 210.5 | 1643 | 0.78 | runner-up (a different kind: higher, no accent) |
| halvorsen | 1-3 | male, middle-aged, low pitch, 1-3 | 166-168 | 1724-1996 | 0.5-0.59 | rejected: within 25 Hz of CHOIR/Anand/Hale |
| halvorsen | 4,5 | male, elderly, moderate pitch, 1-2 | 186/182 | 1407/1654 | 0.79/0.86 | rejected: CHOIR-like (180) |
| reyes | 1 | male, middle-aged, low pitch, 2 | 152.4 | 2199 | 0.74 | PICKED |
| reyes | 2 | same, 3 | 145.5 | 1852 | 0.72 | runner-up |
| reyes | 3 | male, young adult, low pitch, 2 | 142.9 | 2090 | 0.67 | runner-up (close to Okafor 137) |
| reyes | 4,5,6 | young adult low 3 / elderly very low 2,3 | 140 / 112 / 124 | 1654/1613/1396 | | not picked (5 is near Halvorsen 113) |
| resident | 3 | female, young adult, high pitch, 2 | 313.7 | 2475 | 0.74 | PICKED (sim 0.90-0.92) |
| resident | 4 | female, young adult, high pitch, 3 | 340.4 | 2010 | 0.70 | runner-up (sim 0.86-0.97) |
| resident | 1 | female, young adult, moderate pitch, 2 | 246.2 | 2320 | 0.61 | runner-up (close to Voss 235) |
| resident | 2,5,6 | moderate / middle-aged | 271 / 267 / 258 | | | rejected: Unit 269 |

All takes: voice/auditions/<char>/ (index.html; swap with `npm run voice:cast -- <char> --pick N` then `npm run voice`).
Deviations from plan §6.1: halvorsen "male, middle-aged, low pitch" came out at 166 Hz (near CHOIR) so the British-accent description was used; resident "high pitch" instead of moderate (moderate = Voss/Unit).
Murmur: `l3_reyes_murmur` has `text: ""` (no subtitle) and `spoken: "I came up from Line Two and they're all…"`; the mp3 is the CLEAN intelligible take; the unintelligible treatment (room + low-pass 400 Hz, -10 dB) is run-time (src/audio/voicefx).
Retries: 8 Halvorsen lines needed 2-5 tries (c1_3 5, c1_2b 4); all passed. No text edits.

# 2026-11-16 — user feedback on voice/preview.html (whispers, breathless, UNIT, stress)

Nobody listened; every choice is by measurement (`audio.voice_metrics`, `audio.envelope_similarity`).
Old takes: `voice/auditions/_old/` (gitignored), comparison numbers in `voice/auditions/_old/compare.json`.

- **Whispers** (tomas, hale, halvorsen): the DSP-derived variant refs (`derive.whisper`) are gone. Each whisper
  variant is now a *designed* reference of its own (`describe` = the character's short description +
  `whispering`, a whispered `refText`, a seed picked by audition). Picks: tomas:whisper 2, hale:whisper 12,
  halvorsen:whisper 17 (see each variant's `why` in cast.json; runner-ups listed there).
- **tomas:breathless**: no reference of its own any more (base voice, speed 1.0); `l2_tomas_fit_after_1` got
  `spoken: "[sigh] You alright? ... That was loud. ... Everything heard that."`.
- **UNIT**: `female, moderate pitch, monotone`, seed 3 (audition 33), same refText. Runner-ups 22, 39.
- **Stress in UPPERCASE** (new `spoken`, subtitles unchanged): `l1_hale_recorder` (LISTEN, the user's own
  wording; note no longer describes the emphasis), `l2_tomas_unit14_off` (ONLY), `l2_tomas_run_4` (NEVER),
  `l2_tomas_bark_relay_locked` (SAID), `l2_tomas_bark_spine_dead` (EVERYTHING's), `l2_tomas_rig_2` (YOU),
  `l2_tomas_ask` (WHOLE), `l3_halv_c2_6` (ALWAYS).
- Regenerated 36 lines (16 whisper, 1 breathless, 14 UNIT, 5 stress-only); 205 untouched.
