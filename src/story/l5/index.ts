/**
 * STORY, level 5 — "POST 4" (stage 3c). K STUB (// K placeholder, the whole file) on the shared page flow
 * (../stage/page.ts): the start loadout (carry / direct start), a title card, and the level end — replaced by task ST
 * (§8.10, implementing the hook contract §10.0 exactly), which keeps the end's contract: carry `from: 5` (facts +
 * `kills5`, `radio`, `kessler`, `l5_door`, `l5_boat`, `testHour`; weapons incl. the carbine; armour), the level-5
 * checkpoint cleared, end card `POST 4` / `TO BE CONTINUED` (12 s, skippable), the menu; stored level 5
 * (`LEVELS[5].next === null`; with a next — a test `?next=5:N` — the card drops TO BE CONTINUED, 6 s, and hands over).
 *
 * The stub ends when the player presses the stub room's green button (`l5_stub_end`, src/level/l5) or a test calls
 * `__game.story.end()`. Test hooks (the subset of §10.0 that check-chain reads): H1 `end()`, H2 `checkpoint(id)`,
 * H3 `fire()` (always null here), H4 `hurry()`, H5 `lineLog` (empty), H6 `rules` ({}), H7 `debugState` (level, now,
 * beats, flags, checkpoints, checkpoint, restoredFrom, loadout, arrival, ended, stub: true), `next()` → `nextOf(5)`.
 */
import type { GameContext, StorySystem } from '../../core/types';
import { SPEC_L5, clearLevelSave, emptyProgressL5, loadCarryFor, type CheckpointIdL5, type ProgressL5 } from '../save';
import { applyStartLoadout, carryOut, chainMode, finishLevel, goToLevel } from '../chain';
import { createStagePage, type StageScript } from '../stage/page';
import type { LineLog } from '../stage/dialogue';
import { levelOf, nextOf } from '../../core/progress';
/** The stub room's end button (src/level/l5 stub; a literal, so W4 can replace that file without breaking this one). */
const STUB_END_ID = 'l5_stub_end';

export const TITLE_CARD_L5 = ['POST 4', 'ERIDU DEEP — NAVAL DETACHMENT'];
/** §7 / D3: the stage-end card (`style: 'ending'`, 12 s, skippable). */
export const END_CARD_L5 = ['POST 4', '', 'TO BE CONTINUED'];
/** The end card when the chain has a next level (tests only while `LEVELS[5].next` is null): 6 s, skippable. */
export const END_CARD_L5_NEXT = ['POST 4'];
/** §6.4 `CLOCK5`: the test hour at arrival when no carry brings one (62:30). */
const ARRIVAL_DEFAULT = 62.5;

export async function createStoryL5(ctx: GameContext): Promise<StorySystem> {
  const page = createStagePage<ProgressL5, CheckpointIdL5>(ctx, SPEC_L5, 0);
  const { stats, world } = page;
  let prog: ProgressL5 = emptyProgressL5();
  let restoredFrom: CheckpointIdL5 | null = null;
  let lastCheckpoint: CheckpointIdL5 | null = null;
  let loadout: 'carry' | 'direct' | 'none' | 'save' = 'none';
  let started = false;
  let ended = false;
  const log: LineLog[] = [];
  const arrivalHour = typeof ctx.facts.testHour === 'number' && Number.isFinite(ctx.facts.testHour) ? ctx.facts.testHour : ARRIVAL_DEFAULT;
  /** What the chain handed over at arrival (check-chain reads it). */
  const arrival = (() => {
    const c = loadCarryFor(5, ctx.debug);
    return { from: c?.from ?? null, armor: c ? c.armor : levelOf(ctx).direct.loadout?.armor ?? 0 };
  })();

  const script: StageScript<ProgressL5, CheckpointIdL5> = {
    snapshot: () => JSON.parse(JSON.stringify(prog)) as ProgressL5,
    fastForward(saved, from) {
      prog = { ...emptyProgressL5(), ...JSON.parse(JSON.stringify(saved)) };
      restoredFrom = from;
      loadout = 'save';
    },
    start() { started = true; },
    tick(dt: number) { if (started && (ctx.state === 'playing' || ctx.state === 'cutscene')) prog.t += dt; },
    hurry() { /* nothing timed in the stub */ },
    talk: { log },
    get debugState() {
      return {
        level: 5, stub: true, now: +prog.t.toFixed(2), beats: [...prog.beats], flags: { ...prog.flags }, arrivalHour,
        restoredFrom, loadout, arrival, checkpoints: [...prog.checkpoints], checkpoint: lastCheckpoint, started, ended,
        scares: [...prog.scares],
      };
    },
    fire: () => null,
  };

  /** The stage end (§7). Test runs (`?autostart=1`) store only with `&handoff=1` and stay on the card. */
  async function end(): Promise<void> {
    if (ended) return;
    ended = true;
    const mode = chainMode(ctx);
    const next = nextOf(5, ctx.debug);
    if (mode === 'off') clearLevelSave(5);
    else {
      try { finishLevel(ctx, carryOut(ctx, { kills5: stats.kills, testHour: arrivalHour + prog.t / 3600 })); }
      catch (err) { console.error('[story] level-5 end not stored', err); clearLevelSave(5); }
    }
    if (!prog.beats.includes('l5_end')) { prog.beats.push('l5_end'); ctx.events.emit('story:beat', { id: 'l5_end' }); }
    try { ctx.input.exitPointerLock(); } catch { /* ignore */ }
    world.fade(1, 1.0);
    ctx.setState('ended');
    ctx.ui.setHudVisible(false);
    const card = next === null ? END_CARD_L5 : END_CARD_L5_NEXT;
    try { await ctx.ui.showCard(card, { style: 'ending', skippable: true, seconds: next === null ? 12 : 6 }); } catch (err) { console.error('[story] end card failed', err); }
    try { ctx.render.post.grade?.(0, 0); } catch { /* ignore */ }
    if (mode === 'reload') { if (next !== null) goToLevel(); else location.reload(); }
  }

  ctx.events.on('interact', (e) => { if (e.id === STUB_END_ID && started && !ctx.debug.noStory) void end(); });

  const story = page.finish(script, {
    async begin(card: boolean, short: boolean) {
      loadout = applyStartLoadout(ctx);
      if (card) await ctx.ui.showCard(TITLE_CARD_L5, { style: 'title', skippable: true, seconds: 4.2 });
      script.start();
      ctx.player.controlsEnabled = true;
      ctx.ui.setHudVisible(true);
      ctx.setState('playing');
      page.hooks.setObjective('Placeholder build: press the green button to end the level');
      (ctx.ui as unknown as { blackout?: (on: boolean, sec?: number) => void }).blackout?.(false, 0.6);
      world.fade(0, short ? 0.3 : 1.6);
    },
    restoredToast: 'Checkpoint restored',
  });
  Object.assign(story, {
    end,
    /** Debug / check-chain: write a checkpoint now (the stub's record as it is). */
    checkpoint: (id: CheckpointIdL5 = 'cp5_start') => {
      try { if (!prog.checkpoints.includes(id)) prog.checkpoints.push(id); lastCheckpoint = id; page.hooks.checkpoint(id); return true; } catch { return false; }
    },
    rules: {},
    next: () => nextOf(5, ctx.debug),
  });
  return story;
}
