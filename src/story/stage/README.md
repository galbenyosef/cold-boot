# Story scaffolding (`src/story/stage/`)

Shared machinery for a level's story (stage 3a §8.13); level 2 (`src/story/l2`) is built on it.

- `base.ts` — `StageBase<Flags, PhaseId, CheckpointId, Facts, Progress>`: the record (`prog`, `f`), `beat` / `once` /
  `consequence` (replayed on load by `fastForward`), threads `S`, waits (`wait` — tests shorten it, `hold` — they
  don't, `until`, `untilOr`, `quiet` + `cue`, `hurry()`), doors and latches (`closeBehind`, `holdOpen`), fights
  (`engage`, `rouse`, `fightOut(group)`, `fightOutWhere(target)`, `removeSilently`), place / view queries (`inRoom`,
  `region`, `region3`, `at(trigger)`, `isLookingAt`, `inView`), actors (`actor`, `place`, `walk` = `moveTo` wrapper,
  `pose`, `lookAt`), readables (`openNote`), the calm checkpoint rule + `checkpointNow`, `commonFacts()`.
- `dialogue.ts` — the line channel: priorities scene / talk / bark, `ttl`, `next`, caller `when` / `else`, the
  level's RULES table (`U`, `C`, plus `once` / `max` / `cooldown`), `heard`, `log` (= `story.lineLog`, the oracle).
- `phases.ts` — `applyPhaseSafe` (hand a phase to the level's table), regions with a fallback, 3-D `inRegion3`.
- `page.ts` — `createStagePage`: sequencer, director, rig, world, the v2 checkpoint writer (`SaveSpec`,
  `ctx.facts`), resume, the menu / gate / autostart / CONTINUE / BEGIN flow, test hooks (`hurry`, `fire`,
  `debugState`, `lineLog`).

A level supplies only: its flags type + `emptyProgress()`, its facts object, its RULES table, its `phase` getter +
`applyPhaseTo`, its checkpoint ids + `CHECKPOINTS` table, `consequence`, `baseline`, `baselineMood`, `objective`,
`start()` and the threads. Hooks with no-op defaults: `afterReplay`, `afterSnap`, `onFrame`, `onStep`,
`afterObjective`, `checkpointBlocked`, `onRemoved`, `onPose`, `onNoteOpened`.

```ts
// src/story/l3/script.ts (sketch)
const RULES: Rules<F3> = {
  l3_halv_c1_1: C((F) => !F.firedWithin(60), 'did not fire in the last 60 s', 'l3_halv_c1_1_shots'),
  l3_halv_c1_1_shots: U('the scene line, after shooting'),
  l3_choir_breach_stop: C((F) => F.fact('choice') === 'stop' && F.inView('g3_breach'), 'stop; member in view', 'l3_choir_breach_far_stop'),
  l3_halv_door: C((F) => F.room === 'admin' && F.deniedWithin('d3_office', 3), 'tried his door', undefined, { cooldown: 60, max: 2 }),
};
class ScriptL3 extends StageBase<Flags3, PhaseId3, CheckpointIdL3, F3, ProgressL3> {
  protected readonly checkpointIds = CHECKPOINT_IDS_L3;
  protected readonly CHECKPOINTS = { cp3_start: { when: () => this.f.latched, valid: () => !this.f.released }, /* … */ };
  protected readonly facts = extendFacts(this.commonFacts(), { get phase() { /* … */ } });
  constructor(...a: Args) { super(...a, { rules: RULES }); this.trackPlayer(); }
  protected emptyProgress() { return emptyProgressL3(); }
  protected get phase(): PhaseId3 { return this.f.sealed ? 'J' : /* … */ 'A'; }
  protected applyPhaseTo(id: PhaseId3, snap: boolean) { applyPhaseSafe(this.ctx, levelApplyPhaseL3, id, snap); }
  start() {
    this.started = true;
    this.S('end', async () => {
      await this.until(() => this.f.sealed);                                  // d3_bio latched (closeBehind)
      await this.fightOutWhere('bio_lock', 60);                               // hostiles INSIDE the lock, any group
      await this.say('l3_choir_end_stop', { else: 'l3_choir_end_command' });  // rule checked when it starts
    });
  }
}
// index.ts: const page = createStagePage<ProgressL3, CheckpointIdL3>(ctx, SPEC_L3, LOG_IDS_L3.length);
//           const script = new ScriptL3(ctx, page.seq, page.director, page.world, page.logs, page.hooks);
//           return page.finish(script, { begin: async (card, short) => { …; script.start(); } });
```

`fightOutWhere(target, stranded = 60, { stop, keep })`: `target` is a predicate `(e: Enemy) => boolean`, a region
name (tested in 3-D) or a `Box3`. It resolves when no living hostile matches (dead, or walked out), roused every
second. Stranded fallback (nothing matching near or in view for `stranded` s): groups whose living members all match
are removed silently; members of mixed groups are only released from the wait (the enemy contract has no per-unit
removal). Never while one is seen or a `keep` member lives.

Cutscenes (`src/story/cutscene.ts`, built in parallel): a beat thread awaits the scene where the design puts it —
`this.beat('l3_meet'); await runScene(...)` inside an `S(...)` thread — with the record already moved (`beat` before
the scene) so a load lands after it; pin human actors with `lookAt(a, ctx.camera)` during the scene and release with
`lookAt(a, null)`; a phase change inside a scene is a `beat` / flag at the scene's instant (`syncPhase` applies it).
No checkpoint is due during a scene: return true from `checkpointBlocked()` while one runs.

Lines (R3): every spoken id has exactly one rule; a rule is evaluated when the line STARTS, never when it is queued;
`U` only for a pure reaction to what the player did this instant; anything that names a place, a person, a count or
an earlier line is `C(...)` on facts (`heard`, `inRegion`, `inView`, `fact('choice')` for the carried choice);
variants are `else` chains, each with its own rule; scene lines on a clock get a `ttl`; never assume an order.
