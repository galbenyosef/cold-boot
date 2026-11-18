/**
 * STORY, level 6 — "THE TRUNK" (stage 3d). K STUB (// K placeholder, the whole file) on the shared page flow
 * (../stage/page.ts): the start loadout (carry / direct start), a title card, and the chapter end — replaced by tasks
 * ST-a / ST-b (§8.10, implementing the hook contract §10.0 exactly), which keep the end's contract (§7.2, D3):
 * carry `from: 6` (facts + `kills6`, `manifest`, `aas`, `launchHour`, `trunkCut`, `loaderDead`, `testHour`; weapons;
 * armour), the level-6 checkpoint cleared, end card `THE TRUNK` / `` / `TO BE CONTINUED` (14 s, skippable, style
 * `ending`), then `END OF CHAPTER 3` (4 s, style `title`), then the menu; stored level 6 (`LEVELS[6].next === null`).
 *
 * The stub ends when the player presses the stub room's green button (`l6_stub_end`, src/level/l6) or a test calls
 * `__game.story.end()`. Test hooks (the subset check-chain reads): `end()`, `checkpoint(id)`, `fire()` (null), `hurry()`,
 * `lineLog` (empty), `rules` ({}), `debugState` (level, now, beats, flags, checkpoints, checkpoint, restoredFrom,
 * loadout, arrival, arrivalHour, ended, cards, stub: true), `next()` → `nextOf(6)`.
 */
import type { GameContext, StorySystem } from '../../core/types';
import { SPEC_L6, clearLevelSave, emptyProgressL6, loadCarryFor, type CheckpointIdL6, type ProgressL6 } from '../save';
import { applyStartLoadout, carryOut, chainMode, finishLevel, goToLevel } from '../chain';
import { createStagePage, type StageScript } from '../stage/page';
import type { LineLog } from '../stage/dialogue';
import { levelOf, nextOf } from '../../core/progress';
/** The stub room's end button (src/level/l6 stub; a literal, so W4a can replace that file without breaking this one). */
const STUB_END_ID = 'l6_stub_end';

export const TITLE_CARD_L6 = ['THE TRUNK', 'ERIDU DEEP — NAVAL DETACHMENT'];
/** §7.2 / D3: the chapter-end card (`style: 'ending'`, 14 s, skippable), then `END_CARD_L6_CHAPTER` (4 s, `title`). */
export const END_CARD_L6 = ['THE TRUNK', '', 'TO BE CONTINUED'];
export const END_CARD_L6_CHAPTER = ['END OF CHAPTER 3'];
/** The end card when the chain has a next level (never on main: `LEVELS[6].next` is null; a test `?next=6:N`). */
export const END_CARD_L6_NEXT = ['THE TRUNK'];
/** §6.4 `CLOCK6`: the test hour at arrival when no carry brings one (62:45). */
const ARRIVAL_DEFAULT = 62.75;

export async function createStoryL6(ctx: GameContext): Promise<StorySystem> {
  const page = createStagePage<ProgressL6, CheckpointIdL6>(ctx, SPEC_L6, 0);
  const { stats, world } = page;
  let prog: ProgressL6 = emptyProgressL6();
  let restoredFrom: CheckpointIdL6 | null = null;
  let lastCheckpoint: CheckpointIdL6 | null = null;
  let loadout: 'carry' | 'direct' | 'none' | 'save' = 'none';
  let started = false;
  let ended = false;
  const cards: string[] = [];
  const log: LineLog[] = [];
  const arrivalHour = typeof ctx.facts.testHour === 'number' && Number.isFinite(ctx.facts.testHour) ? ctx.facts.testHour : ARRIVAL_DEFAULT;
  /** What the chain handed over at arrival (check-chain reads it). */
  const arrival = (() => {
    const c = loadCarryFor(6, ctx.debug);
    return { from: c?.from ?? null, armor: c ? c.armor : levelOf(ctx).direct.loadout?.armor ?? 0 };
  })();

  const script: StageScript<ProgressL6, CheckpointIdL6> = {
    snapshot: () => JSON.parse(JSON.stringify(prog)) as ProgressL6,
    fastForward(saved, from) {
      prog = { ...emptyProgressL6(), ...JSON.parse(JSON.stringify(saved)) };
      restoredFrom = from;
      loadout = 'save';
    },
    start() { started = true; },
    tick(dt: number) { if (started && (ctx.state === 'playing' || ctx.state === 'cutscene')) prog.t += dt; },
    hurry() { /* nothing timed in the stub */ },
    talk: { log },
    get debugState() {
      return {
        level: 6, stub: true, now: +prog.t.toFixed(2), beats: [...prog.beats], flags: { ...prog.flags }, arrivalHour,
        restoredFrom, loadout, arrival, checkpoints: [...prog.checkpoints], checkpoint: lastCheckpoint, started, ended,
        scares: [...prog.scares], cards: [...cards],
      };
    },
    fire: () => null,
  };

  /** The chapter end (§7.2). Test runs (`?autostart=1`) store only with `&handoff=1` and stay on the last card. */
  async function end(): Promise<void> {
    if (ended) return;
    ended = true;
    const mode = chainMode(ctx);
    const next = nextOf(6, ctx.debug);
    if (mode === 'off') clearLevelSave(6);
    else {
      try {
        finishLevel(ctx, carryOut(ctx, {
          kills6: stats.kills, testHour: arrivalHour + prog.t / 3600,
          // the stub's values for the chapter-4 facts (ST-a / ST-b write the real ones)
          manifest: !!prog.flags.queue, aas: !!prog.flags.aas, launchHour: arrivalHour, trunkCut: true, loaderDead: true,
        }));
      } catch (err) { console.error('[story] level-6 end not stored', err); clearLevelSave(6); }
    }
    if (!prog.beats.includes('l6_end')) { prog.beats.push('l6_end'); ctx.events.emit('story:beat', { id: 'l6_end' }); }
    try { ctx.input.exitPointerLock(); } catch { /* ignore */ }
    world.fade(1, 1.0);
    ctx.setState('ended');
    ctx.ui.setHudVisible(false);
    try {
      if (next === null) {
        cards.push(END_CARD_L6.join('|'));
        await ctx.ui.showCard(END_CARD_L6, { style: 'ending', skippable: true, seconds: 14 });
        cards.push(END_CARD_L6_CHAPTER.join('|'));
        await ctx.ui.showCard(END_CARD_L6_CHAPTER, { style: 'title', skippable: true, seconds: 4 });
      } else {
        cards.push(END_CARD_L6_NEXT.join('|'));
        await ctx.ui.showCard(END_CARD_L6_NEXT, { style: 'ending', skippable: true, seconds: 6 });
      }
    } catch (err) { console.error('[story] end card failed', err); }
    try { ctx.render.post.grade?.(0, 0); } catch { /* ignore */ }
    if (mode === 'reload') { if (next !== null) goToLevel(); else location.reload(); }
  }

  ctx.events.on('interact', (e) => { if (e.id === STUB_END_ID && started && !ctx.debug.noStory) void end(); });

  const story = page.finish(script, {
    async begin(card: boolean, short: boolean) {
      loadout = applyStartLoadout(ctx);
      if (card) await ctx.ui.showCard(TITLE_CARD_L6, { style: 'title', skippable: true, seconds: 4.2 });
      script.start();
      ctx.player.controlsEnabled = true;
      ctx.ui.setHudVisible(true);
      ctx.setState('playing');
      page.hooks.setObjective('Placeholder build: press the green button to end the chapter');
      (ctx.ui as unknown as { blackout?: (on: boolean, sec?: number) => void }).blackout?.(false, 0.6);
      world.fade(0, short ? 0.3 : 1.6);
    },
    restoredToast: 'Checkpoint restored',
  });
  Object.assign(story, {
    end,
    /** Debug / check-chain: write a checkpoint now (the stub's record as it is). */
    checkpoint: (id: CheckpointIdL6 = 'cp6_start') => {
      try { if (!prog.checkpoints.includes(id)) prog.checkpoints.push(id); lastCheckpoint = id; page.hooks.checkpoint(id); return true; } catch { return false; }
    },
    rules: {},
    next: () => nextOf(6, ctx.debug),
  });
  return story;
}
