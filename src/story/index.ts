/**
 * STORY — owns the whole flow (menu → intro → wake → scripted beats → descent → ending) and every
 * scripted beat. See docs/DESIGN.md → Story beats. The script itself lives in ./script.ts.
 */
import type { GameContext, StorySystem } from '../core/types';
import type { StoryInternal, StoryStats, UIInternal } from '../ui/types';
import { SKIP_INTRO_KEY } from '../ui/types';
import { Sequencer } from './sequencer';
import { MusicDirector } from './director';
import { CameraRig } from './camera';
import { World } from './world';
import { Script } from './script';
import { INTRO_CARDS, LOG_IDS, TITLE_CARD } from './text';

export async function createStory(ctx: GameContext): Promise<StorySystem> {
  const seq = new Sequencer(ctx.events);
  const director = new MusicDirector(ctx);
  const rig = new CameraRig(ctx);
  const world = new World(ctx);
  const logs = new Set<string>();
  const stats: StoryStats = { time: 0, kills: 0, logs: 0, logsTotal: LOG_IDS.length };
  let objective = '';

  const script = new Script(ctx, seq, director, rig, world, logs, {
    setObjective(text: string) {
      if (text === objective) return;
      objective = text;
      ctx.events.emit('story:objective', { text });
    },
  });

  ctx.events.on('enemy:died', () => { stats.kills++; });

  const realSleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));
  const ui = () => ctx.ui as UIInternal;

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
        script.start();
        ctx.events.emit('story:beat', { id: 'wake' });
        ctx.setState('playing');
        script.afterWake(true);
        return;
      }

      let skip = false;
      try { skip = sessionStorage.getItem(SKIP_INTRO_KEY) === '1'; sessionStorage.removeItem(SKIP_INTRO_KEY); } catch { /* ignore */ }

      ctx.setState('menu');
      if (skip) {
        world.fade(1, 0);
        ui().blackout?.(true, 0);
        await ui().showResumeGate();
      } else {
        rig.startMenu();
        await ctx.ui.showMenu();
        ui().blackout?.(true, 0.8);
        await realSleep(0.9);
        rig.stopMenu();
        world.fade(1, 0);
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
  return story;
}
