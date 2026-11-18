/**
 * STORY — owns the whole flow (menu → intro → wake → scripted beats → descent → ending) and every
 * scripted beat. See docs/DESIGN.md → Story beats. The script itself lives in ./script.ts.
 */
import type { GameContext, LevelId, StorySystem } from '../core/types';
import type { StoryInternal, StoryStats, UIInternal } from '../ui/types';
import { SKIP_INTRO_KEY } from '../ui/types';
import { Sequencer } from './sequencer';
import { MusicDirector } from './director';
import { CameraRig } from './camera';
import { World } from './world';
import { Script } from './script';
import { INTRO_CARDS, LOG_IDS, TITLE_CARD, TOASTS } from './text';
import { SAVE_VERSION, STORY_REV_L1, clearSave, loadSave, takeBeginRequest, takeContinueRequest, writeSave, type CheckpointId, type SaveData } from './save';
import { carryOut, handOff } from './chain';
import { preload } from './voice';
import { createStoryL2 } from './l2';
import { createStoryL3 } from './l3';
import { createStoryL4 } from './l4';
import { createStoryL5 } from './l5';
import { createStoryL6 } from './l6';

/** One level per page load (REVISION 4): the story of the level this page runs (§8.1: one entry per built level). */
const STORIES: Partial<Record<LevelId, (ctx: GameContext) => Promise<StorySystem>>> = { 1: createStoryL1, 2: createStoryL2, 3: createStoryL3, 4: createStoryL4, 5: createStoryL5, 6: createStoryL6 };

export async function createStory(ctx: GameContext): Promise<StorySystem> {
  const create = STORIES[ctx.levelId];
  if (!create) throw new Error(`[story] no story for level ${ctx.levelId} in STORIES`);
  return create(ctx);
}

async function createStoryL1(ctx: GameContext): Promise<StorySystem> {
  preload(ctx, ['l1_']);
  const seq = new Sequencer(ctx.events);
  const director = new MusicDirector(ctx);
  const rig = new CameraRig(ctx);
  const world = new World(ctx);
  const logs = new Set<string>();
  const stats: StoryStats = { time: 0, kills: 0, logs: 0, logsTotal: LOG_IDS.length };
  let objective = '';

  const ui = () => ctx.ui as UIInternal;

  /** Write the checkpoint (a few hundred bytes of JSON — no hitch) and blink the HUD indicator. */
  function saveCheckpoint(id: CheckpointId): void {
    const progress = script.snapshot();
    let place = '';
    try { place = ctx.level.roomAt(ctx.player.position)?.name ?? ''; } catch { /* ignore */ }
    const data: SaveData = {
      v: SAVE_VERSION, level: 1, rev: STORY_REV_L1, id, place,
      player: ctx.player.snapshot(),
      story: progress,
      logs: [...logs],
      stats: { time: Math.round(stats.time * 10) / 10, kills: stats.kills },
      cleared: [...progress.cleared],
      facts: { ...ctx.facts },
    };
    if (!writeSave(data)) return;
    try { ui().showCheckpoint?.(); } catch { /* ignore */ }
  }

  const script = new Script(ctx, seq, director, rig, world, logs, {
    setObjective(text: string) {
      if (text === objective) return;
      objective = text;
      ctx.events.emit('story:objective', { text });
    },
    checkpoint: saveCheckpoint,
    finished: clearSave,
    handoff,
  });

  /**
   * End of level 1 (REVISION 4 → Multi-level architecture; §8.1 chain): store the carry (loadout + facts) and level 2,
   * ask for the one-click continue, reload. The screen is already black. Headless test runs (`?autostart=1`) keep
   * the old ending screen and store nothing unless `&handoff=1` (then everything is stored but not reloaded).
   */
  function handoff(): boolean {
    try { return handOff(ctx, carryOut(ctx)); } catch (e) { console.warn('[story] hand-over failed', e); return false; }
  }

  /**
   * Resume from a checkpoint. The screen is black when this is called. Fast-forward the story (the
   * consequences of every beat before the save, no scenes), put the player back, start the beat threads
   * for what is still ahead, fade in.
   */
  async function resume(save: SaveData, instant: boolean): Promise<void> {
    ctx.setState('cutscene');
    ctx.ui.setHudVisible(false);
    for (const id of save.logs) logs.add(id);
    stats.time = save.stats.time;
    stats.kills = save.stats.kills;
    script.fastForward(save.story, save.id, save.cleared);
    if (save.story.flags.power) {
      // The audio module keeps its "bus is live" ambience flag on this beat event only. Re-announce it
      // fully muffled (the power-up thump stays under the black screen), then open the mix again.
      try { ctx.audio.setMuffle(1); } catch { /* ignore */ }
      ctx.events.emit('story:beat', { id: 'power_restored' });
      setTimeout(() => { try { if (ctx.state !== 'paused') ctx.audio.setMuffle(0); } catch { /* ignore */ } }, 2600);
    }
    try { ctx.player.restore(save.player); } catch (e) { console.error('[story] player.restore failed', e); }
    ctx.player.controlsEnabled = true;
    script.start();
    ctx.setState('playing');
    script.afterWake(true);
    // A beat of black while the first frames settle (doors, machines spinning up), then fade in.
    if (!instant) await realSleep(0.35);
    ui().blackout?.(false, instant ? 0 : 1.2);
    world.fade(0, instant ? 0.3 : 1.2);
    ctx.events.emit('story:toast', { text: TOASTS.restored });
  }

  ctx.events.on('enemy:died', () => { stats.kills++; });

  const realSleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));

  const story: StoryInternal = {
    get objective() { return objective; },
    get logs() { return logs; },
    get stats() { stats.logs = logs.size; return stats; },

    async run() {
      const d = ctx.debug;
      if (d.noStory) {
        if (!d.autostart) {
          ctx.setState('menu');
          rig.startMenu();
          await ctx.ui.showMenu();
          rig.stopMenu();
          world.fade(0, 1.2);
        }
        ctx.setState('playing');
        return;
      }
      if (d.autostart) {
        // Headless tests: the save is honoured only with &continue=1.
        let wantSave = false;
        try { wantSave = new URLSearchParams(location.search).get('continue') === '1'; } catch { /* ignore */ }
        const save = wantSave ? loadSave() : null;
        if (save) { await resume(save, true); return; }
        script.start();
        ctx.events.emit('story:beat', { id: 'wake' });
        ctx.setState('playing');
        script.afterWake(true);
        return;
      }

      let skip = false;
      try { skip = sessionStorage.getItem(SKIP_INTRO_KEY) === '1'; sessionStorage.removeItem(SKIP_INTRO_KEY); } catch { /* ignore */ }
      // LOAD CHECKPOINT (death / pause) reloaded the page: resume behind the one-click gate.
      const save = takeContinueRequest() ? loadSave() : null;

      ctx.setState('menu');
      if (save) {
        world.fade(1, 0);
        ui().blackout?.(true, 0);
        await ui().showResumeGate(save.place);
        await resume(save, false);
        return;
      }
      if (takeBeginRequest()) {
        // BEGIN chosen on a level-2 page: this is the new run it reloaded into — one click, then the intro.
        world.fade(1, 0);
        ui().blackout?.(true, 0);
        await ui().showResumeGate();
        clearSave();
        await ctx.ui.showCard(INTRO_CARDS, { style: 'intro', skippable: true });
        await ctx.ui.showCard(TITLE_CARD, { style: 'title', skippable: true, seconds: 4.2 });
      } else if (skip) {
        world.fade(1, 0);
        ui().blackout?.(true, 0);
        await ui().showResumeGate();
      } else {
        rig.startMenu();
        await ctx.ui.showMenu();
        const fromSave = ui().menuChoice === 'continue' ? loadSave() : null;
        ui().blackout?.(true, 0.8);
        await realSleep(0.9);
        rig.stopMenu();
        world.fade(1, 0);
        if (fromSave) { await resume(fromSave, false); return; }
        // BEGIN starts over: the old checkpoint is gone.
        clearSave();
        await ctx.ui.showCard(INTRO_CARDS, { style: 'intro', skippable: true });
        await ctx.ui.showCard(TITLE_CARD, { style: 'title', skippable: true, seconds: 4.2 });
      }
      script.start();
      await script.wakeCutscene(skip);
    },

    update(dt: number) {
      const active = ctx.state === 'playing' || ctx.state === 'cutscene';
      if (ctx.state === 'playing') stats.time += dt;
      seq.update(dt, active);
      director.update(dt);
      script.tick(dt);
    },

    lateUpdate(dt: number) { rig.lateUpdate(dt); },
  };
  // Review / test hooks (scripts/playthrough.mjs): fire a scare in place, read the script state.
  Object.assign(story, { fire: (name: string) => script.fire(name), hurry: () => script.hurry(), handoff });
  Object.defineProperty(story, 'debugState', { get: () => script.debugState });
  return story;
}
