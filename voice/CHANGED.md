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
