# User's fixes after playing levels 5–6 (2026-11-19)

## Now (small, obvious)
1. [done 7baf931] **`console6` "Use console"**: the use area is too small — standing close at various spots shows nothing. Enlarge it
   (radius + the `t6_console` requireRegion) so anywhere near the desk front works.
2. [done 6875c21] **Level 5 radio on the first navy soldier's body**: the prompt only appeared when crouching. Must be obvious standing
   anywhere next to the body.
3. [done 7baf931] **Level 6 objectives for the loader** must say how: (1) destroy the rams that extend when the jaws open, (2) destroy
   the core under the ceiling.
4. [done 7baf931] **The opened core** must be a more obvious target: amber, bigger glow.
5. [done 6875c21] **Enemy marks** (esp. robots/units and spiders/skitters): too strong at distance and too big. Visible, but subtle.
6. [done 6875c21] **Level 5 door code**: once the radio tells the code, show it in the objective.

## Later (planned, not now)
7. [done 9d2d08c] **Level 6 hand actions** (grip: crank, lever, pin, pump, pull, key turns): the hands do not line up with the moved
   object — they are somewhere else than the lever etc. Rework hand IK targets to the set pieces' real handle points and
   keep them attached while the part moves.
- Darkness: dropped by the user (no test, no rule). Still parked: performance (L5 spine view (3)).
- Skitter red at close range comes mostly from its own point light (skitter.ts:224, 0.6) and red emissive parts, not the marks — tone down if spiders still read too red.
- Hand actions: each grip finishes ~0.21 s later (part waits for the hands); playthrough-l6 holds E 3.3 s on 3.0 s grips (0.09 s margin) — re-run play:l6; hands render very dark in dim level-6 spots outside the flashlight.
