/**
 * Stage 3d §5.6.6 (W3b): LOADER_TUNING — the dock loader's one table. Every number of the boss's behaviour lives here
 * (IA retunes here only). Per-stage arrays are indexed [stage 1, stage 2, stage 3].
 */

export const LOADER_TUNING = {
  hp: { flood: 40, ram: 200, pod: 500 },
  mult: { ramExtended: 1.0, ramRetracted: 0, podOpen: 1.0, podShut: 0, body: 0.05, flood: 1.0 },
  /** A no-damage hit (retracted ram, shut pod): `armour_clank` at most once per this many seconds. */
  clankEvery: 0.3,
  sight: {
    range: 60,
    /** Flood slew toward the player (rad/s). */
    slew: 1.2,
    /** FULL cone angles (rad): narrow while tracking a target, wide while sweeping the work area (§5.6.6 14°–22°). */
    coneNarrow: 14 * Math.PI / 180, coneWide: 22 * Math.PI / 180,
    floodRange: 45,
    /** Line-of-sight test period (s) — rays ≤ 20/s total (§5.6.10 #14). */
    losEvery: 0.2,
  },
  slam: {
    track: [1.4, 1.1, 0.9],
    /** Ring lag behind his feet (s); with no floods alive it aims by its sensor alone. */
    lag: 0.25, lagNoFloods: 0.75,
    lock: 0.8,
    /** Grab bottom above his deck while tracking (m). */
    hover: 3.5,
    drop: 0.45,
    radius: 1.8, damage: 35, knock: 6,
    shockRadius: 4, shake: 0.5,
    recover: [2.4, 2.4, 1.8],
    rise: 1.0,
    cooldown: [5.5, 4.2, 3.2],
    /** Another enemy within this of the target → wait `waitStep` and re-check, at most `waitTries` times. */
    enemyClear: 2.0, waitStep: 0.5, waitTries: 3,
  },
  shift: {
    period: 18,
    /** He stands within this of an occupied slot's box, his feet within ± `deckBand` of the slot's floor. */
    near: 3, deckBand: 1,
    /** A body's feet within this above the load's top → never lift (wait, re-check, then shove at `shove` m/s). */
    liftGuard: 0.3, shove: 2, shoveAfter: 1.5,
    clamp: 1.0, lift: 2.0, carry: 1.6,
    /** The destination's outline is lit this long before the set-down / release (s). */
    outline: 1.6,
    damage: 40,
    /** Carry height of the load's bottom over the decks (m). */
    carryHeight: 4.5,
  },
  drop: {
    stages: [2, 3],
    near: 6, strobe: 1.6, height: 4.5, damage: 40,
    cooldown: [9, 9, 7],
  },
  swing: {
    wind: 1.2, sweep: 1.4, arc: 9, bottom: 1.15, damage: 30, knock: 7, cooldown: 5,
    /** A crouched capsule is this tall: it passes under the grab's bottom. */
    crouchHeight: 1.1,
  },
  guard: { after: 2, grace: 3 },
  speed: {
    bridge: [2.0, 2.0, 3.0], trolley: [2.5, 2.5, 3.5], hoist: 2.0, drop: 7.8,
    /** Crane inertia: drive acceleration / braking (m/s²). */
    accel: 1.6, brake: 2.2,
  },
  /** Plan margin round `Level.dock.noSlam` (m, horizontal; applied by `DockArena.target`). */
  noSlamMargin: 3.5,
  /** ≤ `cap.amount` health + armour to the player in any `cap.window` s. */
  cap: { amount: 40, window: 2 },
  waveCap: 6,
  /** The grab carries a box only while its bottom is below this above a deck (B2). */
  grabBoxBelow: 2.5,
  /** Working state: patrol drive speed scale; lowering B-14 into the well (water at +1.5 s, gone by +6.0 s). */
  working: { patrolScale: 0.45, lowerWater: 1.5, lowerGone: 6.0, sway: 0.05 },
  death: { reach: 2.0, floodsOut: 1.5, plunge: 9.0 },
} as const;

export type LoaderTuning = typeof LOADER_TUNING;
