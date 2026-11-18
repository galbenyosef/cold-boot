# Stage 3c — what wave 1 built that wave 2 must know (as built; wins over the plan where the plan was silent)

## UI (W2a)
- `ui.radio(...)` strip (CSS class `rstrip`); `ui.keypad()` overlay: virtual cursor from mouse deltas, digit/numpad keys,
  Backspace, CLR, Enter; Esc/E close with `null` (ignored for the first 0.2 s); any `player:damaged` or non-`playing` state
  closes it with `null`; a second `keypad()` closes the first; `ctx.debug.keypadInput` is typed key by key then ENT.
- **ST:** set `player.controlsEnabled = false` while the pad is open (the UI does not). The UI plays only `keypad_beep` and
  `keypad_err` on a short ENT; the STORY plays `keypad_ok` / `keypad_dead` / `keypad_err` for its verdict. The `panel?`
  option is unused — the story mirrors the entry on the world panel itself.
- Subtitle speakers `KESSLER` / `RADIO` get the `radio` class; `SOLDIER` / `BREKKE` the CHOIR class with their own label.

## Voices (W9)
- 72 lines in `voice/lines.l5.json`. Kessler: fx `radio`; soldier lines: speaker alias of CHOIR with fx `throat`; CHOIR's
  radio lines carry fx `radio:1`; `l5_choir_names` is the one positional CHOIR line (see its note).
- `l5_kes_6` has `"cut": 4.08` in FILE time; its `lead` is 0.32 s — measured from the end of the lead the cut is 3.76 s
  (same convention as `l4_sunde_9`).
- After ANY `npm run voice`, re-set `manifest.lines.l4_sunde_8.lead = 0.08` (generation recomputes every lead).
