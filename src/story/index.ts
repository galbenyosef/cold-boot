// STUB — replaced by the story task.
import type { GameContext, StorySystem } from '../core/types';

export async function createStory(ctx: GameContext): Promise<StorySystem> {
  return {
    objective: '', logs: new Set<string>(),
    async run() {
      if (!ctx.debug.autostart) { ctx.setState('menu'); await ctx.ui.showMenu(); }
      ctx.setState('playing');
    },
    update() {},
  };
}
