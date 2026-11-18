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
- 3d W2b: `check-voice-level` L1–5 (L5 body radio ref 2 → 5) and `--level 6` incl. ASR of `l6_aas_2` through `phone`;
  `play:l5` body squawk leads at 6–12 m; `play:l6 --scares` owner audit; listening pass of the boss layer and beds in
  dressed rooms (user: see W2b's listen list in the dev audio page `?mode=sounds&filter=…`, `?mode=l6&music=1&voice=1`).
  Re-measure music RMS after the boss-layer raise. Weak: hanging handset at 3 m −21 dB may be too faint; sea_groan /
  far_lock_flood sub-bass on laptops; crank/pump bright; gallery-grate rule hard-coded y > −13.5 → level data.
  Contracts for others: ST re-emits `l6_quiet` on restore past the quiet; W3b plays loader ids itself, `loader_hum` via
  `loop()`, re-emits `boss:stage` on `boss.restore()`; W7/ST fire `ping_far`/`ping_near` from the ping6 machine.
- 3d W5: `check:zfight --level 6` (screens, stencil quads); L1–5 screen frames (screens.ts `sizeFor` + `delete s.aux.key6`
  touched shared paths, incl. level-5 navy boards); L6 bake time/memory LOW/MEDIUM; chamber perf with 2048 px boards
  uploading; E1/E2 cutscene frames. Weak: tunnel_shotcrete repeat on 80 m tunnel A; dock_board rows just readable at
  24–30 m (≤ 6 lines); wear not edge-aware; manifest re-types if rewritten off-screen mid-typing.
- 3d W4b: `check:reach --level 6` all phases with stress + `check:nav --level 6` on the real level; `check:reach all` /
  `check:nav all` (L1–5 unchanged: lowest point −5, no hazards, L1–2 nav hashes); `check:loader` with `target`.
  Weak: `target` sees only `L.solids`; rotated ramps as AABB; jump-arc pass 35–55 s per phase; `extraCollider` wrapper is a
  stopgap (needs a flagged-collider API in context.ts).
- Coordinator: physics slope hold widened to n.y < 0.995 (≈ 5.7°+) for the 12.5° wet ramps — re-run `check:nav` ramp /
  stair cases L3–5 and `check:physics`; `check-physics` "level 6 stub" case is stale (expects no water/dock) → rewrite
  for the real level 6.
- 3d W3a: `check:loader` 1–15 (with W3b); loader-in-motion review on the greybox chamber; perf view (9) LOW/MEDIUM/HIGH
  incl. FL1/FL2 shadows; `check:fxleak` floods. Weak: jaws read as petals, not a spreader; ropes through the pod on
  big swings; pod sensor cluster odd up close; floods without shafts weak at 30 m (render: per-light volumetric scale).
  Optional contract: `LightHandle.inPool` instead of reading `Handle.slot`.
- Coordinator: `look.mistFollow` (render/post.ts) — level 6 sets `render.settings.mistFollow = true`; look at the mist
  in the shaft/chamber and the level-5 magazine/crawl (still fixed base there: check they are not over-misted).
- 3d W3c: `check:soldier` full; `check:nav all` + L1–5 nav hashes (walkable/groundAt on raycastSolid); `check:wreck`;
  `check:chain` levelgrep; `check-soldier --real` L5; `check:nav` L6 cases; `check-soldier --only level6` on real
  water/ladders/gates; W2 climb frames. Open: enemy rounds into water skip `bullet:impact` → no impact sound (decide:
  audio plays from the splash); no body-splash sound id; enemies no splash footsteps (W2b did `wade_enemy` by depth —
  verify). Weak: climb pose two keys, no IK.
- 3d W8: in-situ zfight per room (pool6, tunnels ~16–18 mm tolerance; gallery strip/fascia, runway buffers, wall backs
  at 10–16 mm); perf views (1)–(11) with the kit placed; `check:reach`/`check:nav` L6 with move-only boxes. Weak: OLT
  rows ~37k tris each (thin first); deck-grate infill faint; tunnel ring plain alone; slack coil spring-like; hanging
  fitting doesn't sway; pawl small; container door label near the corner; tent work lamp hard to see; jointer bodies
  (J. Rød, M. Lie) not built — owner? (D2/ST). User listens: ratchet clacks, brake bang, bulb pop, grille drop.
- 3d W8: in-situ zfight per room (pool6, tunnels ~16–18 mm tolerance; gallery strip/fascia, runway buffers, wall backs
  at 10–16 mm); perf views (1)–(11) with the kit placed; `check:reach`/`check:nav` L6 with move-only boxes. Weak: OLT
  rows ~37k tris each (thin first); deck-grate infill faint; tunnel ring plain alone; slack coil spring-like; hanging
  fitting doesn't sway; pawl small; container door label near the corner; tent work lamp hard to see; jointer bodies
  (J. Rød, M. Lie) not built — owner? (D2/ST). User listens: ratchet clacks, brake bang, bulb pop, grille drop.
- 3d W3b: foreman playthrough / `play:l2` + L1–5 enemy checks (manager: cull by body position, half-rate skip, deep-water
  wreck); `check:soldier` incl. patrol + flood-lit through `boss()`/`patrol()`; `check-loader` on the real chamber;
  fairness at 100 trials; loader-in-motion review (frames of every attack); perf view (9). Untested §5.6.10 cases: 6b
  (body on a container / grab top → wait then shove), 6 (C(6,4) flood-fill), 7 SWING, 11 (200 knock-backs vs guards),
  1 (container occlusion of the slam). SHIFT across the dock ≈ 40 s at 1.6 m/s — maybe too slow. Optional contract:
  `DockArena.well`. Chamber too dark to judge the look in the arena.
- 3d W6: `check:fxleak` L3–5 (shared fx edits) + `--level 6 --selftest` after W4a/D3a; perf (8)–(10); `check:weapons`
  impacts L1–5 (floorPlane on raycastSolid). OPEN (blocks D3a): "lighting fails below y ≈ 0" — W6 saw scenes at level-6
  heights render black (fine with `&lift=40`). First suspect: the floor mist (fixed base 0, clamp exp(1.3·4)); retest
  `src/fx/dev/trunk.html` with `render.settings.mistFollow = true` (or mistBase −40) before touching lights.ts.
  Weak: well floor reads as a crisp rectangle from above; wake rings perfect circles; heavy splash smoky; marine snow
  faint; spray not seen in motion. D3a: keep the well's surface quad opaque; aim outside floods at the tether.
- Coordinator: the "black below y 0" (W6, W7) IS the height mist; `mistFollow` is now ON by default (base = min(0, feet))
  — only spots below y 0 change on L1–5 (L5 magazine −2.6 / crawl, L4 pits): look at them. W4a need not set it.
- 3d W7: zfight on dressed rooms; `check:physics`/`check:reach` with W7's move-only mesh (cage holds, frame usable only
  from `t6_cage`) — W4a must push `moveOnlyColliders6(L)` from BOTH kit6.ts and setpieces6.ts (same name, two modules);
  feed spike on a weaker GPU + E2 in the real level; fxleak fibre glow/beacons; user listens to the set-piece sounds.
  ST-b: E2 feed from `feed6.userData` (cam/target/fov 52, pinLights, exposure 1.8) then `console6.page('feed', …)`;
  `fire()` cues: splash ≈1.07 s (key the splash sound on `part` at 0.25 if the plan's timing is wanted). D3a: frame work
  lamp at `frame6.userData.lampPoint`→`lampTarget`, bj glow at `bj6.userData.glowPoint`. Weak: tether poorly visible,
  winch greybox-level, no fibre stubs on the ripped connector, lever guard a box, puddles flat black in the feed set.
- 3d W4a: `check:nav --level 6` + `check:nav all`; `check:reach all`; zfight + doors L1–5 (context.ts touched);
  `check:physics` (rewrite its stale level-6-stub case); `check:chain` (stub button `l6_stub_end` until ST-a);
  fxleak/dark L6; perf views; `play:l5`. Unify the three flagged-collider paths (context.ts `L.flagged`/`extraColliders`
  vs W4b `extraCollider` vs kit6/setpieces6 `moveOnlyColliders6`). check-reach: reload per row so snaps don't leak.
  Rail/guard tops are dynamic boxes that stop rounds in a 0.3 m band (acceptable? look). Plan deviations to fold into
  DESIGN at IA: trench treads 0.35, tent 0.8 m south, shaft guard on L2 north edge dropped, cover moves (COVER6_NOTES).
- Run gates 3/4 of the 3d plan (loader-in-motion review on the chamber, perf view (9) with loader + six enemies) were
  NOT run before wave 2 (user's test rule) — do them at 3d IA/IB; D3a measures its own views meanwhile.
- 3d F1: zfight L6 19 → 8 ERROR. Remaining: loader `model.ts` `authorBridge` girder × flange lips coplanar at y=h/0
  (shorten girder body 0.04 per end, rails from h+0.02), trolley beams × end beams < 5 mm, flood glow × loader_dark
  7–9 mm; `bj6_leafW` × `bj6_leafE` (vault6 −12, 1.03, −178.5) and a bj6 floor face at y 0 (find the owner: W7
  beachJoint6 / D2); grey guard-vs-deck 3–6 mm and pool6/tun6_b wall WARNs. Decide: cap `galleryRun` parapets (9 cm
  flat static top at 1.1 m)? Re-run `check:reach`/nav L6 (stopper, walkable, rail caps); play a hatch shut → open.
- 3d T: every `play:l6` mode after ST-a (`--contract`, default to the reveal, `--checkpoints` to `cp6_shaft` + B4) and
  after ST-b (all modes, `--boss` 3 seeds × 2 choices, `--dry`); `check:dark --level 6` full + `--level 4/5` (targets5
  refactor); `check:wreck` all (L6 wet dock: one of four directions stopped, two crossings rose 0.00 m — look);
  `check:cutscene` all + `l6 --strict6`. Expect test-side fixes on first runs against ST. Confirm ids used by tests:
  `ping_far`/`ping_near`, `shear_fire`, `splash_big`, `winch_brake`. `--dry`/B5 write `player.weapons[*].reserve` (needs
  to be writable or a hook). `--scares` is long by design (caps up to 90 s per scare).
- 3d D1: PERF RISK views (1) 176 / (2) 166 calls with no enemies (budget 200 incl. F1's 2 soldiers + 2 husks; greybox
  alone 140 in view 1) — IB must cut the greybox base; perf (1),(2) with F1 and (3) with F2; `check:dark` tunnel views;
  doors `d6_tube`/`d6_bay`/`d6_he`; `check:decals`; reach/nav L6 (kerb, shelves, body box, bay coil; stand points
  `p6_lock_ammo`, `p6_rep_*`, `p6_bay_*`); `--scares` audit `v6_tent`, `tun6_far_out`. Fix §10.6 rep6 perf view yaw
  (use `1,0,-81,-45`). Weak: body lumpy close up, coverall grease blotchy, flap dark outside, rep6 dim/brown, vault
  haunch reads as a beam, trunk yellow bands wider than the cable. User listens: tarp_flap/lamp_creak timing,
  lights_out_dock at 0.6.
- 3d ST-a: `play:l6 --contract`, default to the reveal, `--checkpoints` to `cp6_shaft` (both choices); check-chain L6
  end + stub-button case (button removed b25aa01 → case should skip); APPLY ST-a's `check-voice-level --level 6` diff
  (in its report: listeners l6_kes_start 2-D SYNC, l6_unit_tube ~3 m, choir_he at kes_he_3 cut, aas_1 at 0.8 m, second
  ring at 3 m, aas_2 held, aas_3 to its cut; exempt fx `phone` from the ≤ 4 m reference rule) + ST-b's additions;
  `--scares` audit. Decide: `interlock_deny` played 2-D by the story (UI never plays it). Weak: radio sharing in
  compressed runs; "both soldiers in cover + 6 s" rule unseen with real AI; handset follow-point not seen in motion;
  Q silent during sequences; `v6_thud` rarely fires (launchAt = pull + 90 for most).
- 3d D3b: `check:dark --level 6` shaft views (L0 −26.5,0,−170.5,180,−30; L1 −23.3,−3,−163,20,−30; L2 −26.8,−6,−169.8,180,−25;
  bottom −26.8,−12,−163,0,0; bottom-door −24,−12,−168,90,0) after `v6_shaft_lights:snap` LOW/MEDIUM (MEDIUM L0 lit 1.43 %
  < 1.5 %, LOW bottom-door mean 0.0117 < 0.015 — fix at IB); zfight shaft6/pool6/stores6 (stencils vs D3a overlays);
  fxleak with D3a handles; nav (W1 from stores6 to `cv6_gn1` ≤ 8 s); reach incl. locker `use` and re-seated `p6_*`;
  perf (7),(11) with the feed, pool views with D3a + enemies; scares audit; user listens: bulb pops + glass, sea_groan.
  Weak: shaft flights solid wedges (not open grating); deck grating heavy/dark; undercroft + stores6 sparse; wreck an
  approximation of the crane; container labels small; faint room-name text at the top of shaft shots (find source).
