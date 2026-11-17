/**
 * STORY, level 4 — "BIOLOGICAL SYSTEMS" (stage 3b). K STUB on the shared page flow (../stage/page.ts): the start
 * loadout (carry / direct start), a title card, and the level end — replaced by task ST (§8.10), which keeps the end's
 * contract: carry `from: 4` (facts + `kills4`, `testHour`; weapons incl. carbine; armour), the level-4 checkpoint
 * cleared, end card `BIOLOGICAL SYSTEMS` / `TO BE CONTINUED` (12 s, skippable), the menu; stored level stays 4
 * (`LEVELS[4].next === null`).
 *
 * The stub ends when the player presses the stub room's green button (`l4_stub_end`, src/level/l4) or a test calls
 * `__game.story.end()`. Test hooks: `end()`, `checkpoint(id)`, `fire()`, `hurry()`, `debugState`, `lineLog`.
 */
import type { GameContext, StorySystem } from '../../core/types';
import { SPEC_L4, clearLevelSave, emptyProgressL4, loadCarryFor, type CheckpointIdL4, type ProgressL4 } from '../save';
import { applyStartLoadout, carryOut, chainMode, finishLevel, goToLevel } from '../chain';
import { createStagePage, type StageScript } from '../stage/page';
import type { LineLog } from '../stage/dialogue';
import { levelOf, nextOf } from '../../core/progress';
/** The stub room's end button (src/level/l4 stub; a literal, so W4 can replace that file without breaking this one). */
const STUB_END_ID = 'l4_stub_end';

export const TITLE_CARD_L4 = ['BIOLOGICAL SYSTEMS', 'ERIDU DEEP — BIO-SYS'];
/** §7: the stage-end card (`style: 'ending'`, 12 s, skippable). */
export const END_CARD_L4 = ['BIOLOGICAL SYSTEMS', '', 'TO BE CONTINUED'];
/** D20: the test hour at arrival when no carry brings one (62:10). */
const ARRIVAL_DEFAULT = 62 + 10 / 60;

export async function createStoryL4(ctx: GameContext): Promise<StorySystem> {
  const page = createStagePage<ProgressL4, CheckpointIdL4>(ctx, SPEC_L4, 0);
  const { stats, world } = page;
  let prog: ProgressL4 = emptyProgressL4();
  let restoredFrom: CheckpointIdL4 | null = null;
  let loadout: 'carry' | 'direct' | 'none' | 'save' = 'none';
  let started = false;
  let ended = false;
  const log: LineLog[] = [];
  const arrivalHour = typeof ctx.facts.testHour === 'number' && Number.isFinite(ctx.facts.testHour) ? ctx.facts.testHour : ARRIVAL_DEFAULT;
  /** What the chain handed over at arrival (check-chain reads it while the player's armour is W1's stub). */
  const arrival = (() => {
    const c = loadCarryFor(4, ctx.debug);
    return { from: c?.from ?? null, armor: c ? c.armor : levelOf(ctx).direct.loadout?.armor ?? 0 };
  })();

  const script: StageScript<ProgressL4, CheckpointIdL4> = {
    snapshot: () => JSON.parse(JSON.stringify(prog)) as ProgressL4,
    fastForward(saved, from) {
      prog = { ...emptyProgressL4(), ...JSON.parse(JSON.stringify(saved)) };
      restoredFrom = from;
      loadout = 'save';
    },
    start() { started = true; },
    tick(dt: number) { if (started && (ctx.state === 'playing' || ctx.state === 'cutscene')) prog.t += dt; },
    hurry() { /* nothing timed in the stub */ },
    talk: { log },
    get debugState() {
      return {
        level: 4, stub: true, beats: [...prog.beats], flags: { ...prog.flags }, clock: +prog.t.toFixed(2), arrivalHour,
        restoredFrom, loadout, arrival, checkpoints: [...prog.checkpoints], started, ended,
      };
    },
    fire: () => null,
  };

  /** The stage end (§7). Test runs (`?autostart=1`) store only with `&handoff=1` and stay on the card. */
  async function end(): Promise<void> {
    if (ended) return;
    ended = true;
    const mode = chainMode(ctx);
    const next = nextOf(4, ctx.debug);
    if (mode === 'off') clearLevelSave(4);
    else {
      try { finishLevel(ctx, carryOut(ctx, { kills4: stats.kills, testHour: arrivalHour + prog.t / 3600 })); }
      catch (err) { console.error('[story] level-4 end not stored', err); clearLevelSave(4); }
    }
    if (!prog.beats.includes('l4_end')) { prog.beats.push('l4_end'); ctx.events.emit('story:beat', { id: 'l4_end' }); }
    try { ctx.input.exitPointerLock(); } catch { /* ignore */ }
    world.fade(1, 1.0);
    ctx.setState('ended');
    ctx.ui.setHudVisible(false);
    try { await ctx.ui.showCard(END_CARD_L4, { style: 'ending', skippable: true, seconds: 12 }); } catch (err) { console.error('[story] end card failed', err); }
    try { ctx.render.post.grade?.(0, 0); } catch { /* ignore */ }
    if (mode === 'reload') { if (next !== null) goToLevel(); else location.reload(); }
  }

  ctx.events.on('interact', (e) => { if (e.id === STUB_END_ID && started && !ctx.debug.noStory) void end(); });

  const story = page.finish(script, {
    async begin(card: boolean, short: boolean) {
      loadout = applyStartLoadout(ctx);
      if (card) await ctx.ui.showCard(TITLE_CARD_L4, { style: 'title', skippable: true, seconds: 4.2 });
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
    checkpoint: (id: CheckpointIdL4 = 'cp4_start') => {
      try { if (!prog.checkpoints.includes(id)) prog.checkpoints.push(id); page.hooks.checkpoint(id); return true; } catch { return false; }
    },
  });
  return story;
}
