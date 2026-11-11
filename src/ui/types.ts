/**
 * Module-internal extensions shared by src/ui and src/story (both owned by the same task).
 * Everything here is additive to the core contract; other modules never need it.
 */
import type { StorySystem, UISystem } from '../core/types';

/** sessionStorage flag: set by the death screen's RESTART so the reload skips menu + intro cards. */
export const SKIP_INTRO_KEY = 'coldboot.skipIntro';

export interface StoryStats {
  /** Seconds of play (unpaused) time. */
  time: number;
  kills: number;
  logs: number;
  logsTotal: number;
}

export interface UIInternal extends UISystem {
  /** Wake-up eyelids: 0 = closed, 1 = fully open, animated over `seconds`. */
  eyelids(open: number, seconds: number): void;
  /** Full-screen backdrop blur in px, animated over `seconds`. */
  blur(px: number, seconds: number): void;
  /** Minimal "click to resume" gate after a death restart (needs a user gesture for audio + pointer lock). */
  showResumeGate(): Promise<void>;
  /** Solid black cover above the canvas (between cards and the first frame of a scene). */
  blackout(on: boolean, seconds?: number): void;
}

export interface StoryInternal extends StorySystem {
  readonly stats: StoryStats;
  /** Runs after player.update every frame (called at the end of ui.update). */
  lateUpdate(dt: number): void;
}
