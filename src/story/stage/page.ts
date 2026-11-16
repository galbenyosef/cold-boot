/**
 * Shared story scaffolding — the page-level flow of a level's story (moved from level 2's index.ts, §8.13).
 *
 * One level per page load. `createStagePage` owns: the sequencer, music director, camera rig, world wrappers,
 * logs and stats; the checkpoint writer (v2 save: `SaveV2<P>` with `ctx.facts`, validated on load against the
 * level's `SaveSpec`); resume from a checkpoint (fast-forward → player restore → `start()`); and `run()` — the
 * menu / one-click gate / autostart / CONTINUE / BEGIN flow every level shares. The level supplies its script
 * (a `StageBase` subclass, built with the page's hooks) and a few flow hooks (`StageFlow`).
 *
 * Test hooks on the returned story (scripts/playthrough.mjs, check-chain.mjs): `fire(name)`, `hurry(fast?)`,
 * `debugState`, `lineLog` (+ whatever the level adds with `Object.assign`).
 */
import type { GameContext, SaveV2, StorySystem } from '../../core/types';
import type { StoryInternal, StoryStats, UIInternal } from '../../ui/types';
import { SKIP_INTRO_KEY } from '../../ui/types';
import { Sequencer } from '../sequencer';
import { MusicDirector } from '../director';
import { CameraRig } from '../camera';
import { World } from '../world';
import { SAVE_VERSION, clearAllProgress, clearLevelSave, loadLevelSave, requestBegin, takeContinueRequest, writeLevelSave, type SaveSpec } from '../save';
import { setStoredLevel } from '../../core/progress';
import type { StageHooks, StageProgress } from './base';
import type { LineLog } from './dialogue';

/** What the page needs of the level's script (a `StageBase` subclass has all of it). */
export interface StageScript<P extends StageProgress, Cp extends string> {
  snapshot(): P;
  fastForward(saved: P, from: Cp, cleared: readonly string[]): void;
  start(): void;
  tick(dt: number): void;
  hurry(fast?: boolean): void;
  readonly talk: { readonly log: LineLog[] };
  readonly debugState: unknown;
  fire?(name: string): unknown;
}

/** The level's part of the flow. */
export interface StageFlow<P extends StageProgress, Cp extends string> {
  /** A new run: loadout, title card (`card`), the arrival (`short` = no cutscene: tests, restart). */
  begin(card: boolean, short: boolean): Promise<void>;
  /** `?nostory=1`, before the menu: the level's `nostory` phase etc. */
  noStory?(): void;
  /** Resume, right after the fast-forward, before the player is restored (re-announce lasting audio state…). */
  afterFastForward?(save: SaveV2<P, Cp>): void;
  /** Resume, after `start()` and `setState('playing')` (level 2: `resumeLive`). */
  resumed?(save: SaveV2<P, Cp>): void;
  /** Toast after a resume. */
  restoredToast?: string;
}

export interface StagePage<P extends StageProgress, Cp extends string> {
  readonly seq: Sequencer;
  readonly director: MusicDirector;
  readonly rig: CameraRig;
  readonly world: World;
  readonly logs: Set<string>;
  readonly stats: StoryStats;
  readonly objective: string;
  /** The hooks a `StageBase` script takes (objective, checkpoint writer). Add the level's own with a spread. */
  readonly hooks: StageHooks<Cp>;
  /** The level's checkpoint, validated (null: none / invalid — deleted). */
  load(): SaveV2<P, Cp> | null;
  clear(): void;
  realSleep(s: number): Promise<void>;
  /** Wire the script and the flow; returns the `StorySystem` (with the test hooks). Call once. */
  finish(script: StageScript<P, Cp>, flow: StageFlow<P, Cp>): StoryInternal;
}

export function createStagePage<P extends StageProgress, Cp extends string>(ctx: GameContext, spec: SaveSpec, logsTotal: number): StagePage<P, Cp> {
  const seq = new Sequencer(ctx.events);
  const director = new MusicDirector(ctx);
  const rig = new CameraRig(ctx);
  const world = new World(ctx);
  const logs = new Set<string>();
  const stats: StoryStats = { time: 0, kills: 0, logs: 0, logsTotal };
  let objective = '';
  let script: StageScript<P, Cp> | null = null;
  const ui = () => ctx.ui as UIInternal;
  const realSleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));
  const load = () => loadLevelSave<P>(spec) as SaveV2<P, Cp> | null;
  const clear = () => clearLevelSave(spec.level);

  function saveCheckpoint(id: Cp): void {
    if (!script) return;
    const progress = script.snapshot();
    let place = '';
    try { place = ctx.level.roomAt(ctx.player.position)?.name ?? ''; } catch { /* ignore */ }
    const data: SaveV2<P, Cp> = {
      v: SAVE_VERSION, rev: spec.rev, level: spec.level, id, place, facts: { ...ctx.facts },
      player: ctx.player.snapshot(),
      story: progress,
      logs: [...logs],
      stats: { time: Math.round(stats.time * 10) / 10, kills: stats.kills },
      cleared: [...progress.cleared],
    };
    if (!writeLevelSave(data)) return;
    try { ui().showCheckpoint?.(); } catch { /* ignore */ }
  }

  const hooks: StageHooks<Cp> = {
    setObjective(text: string) {
      if (text === objective) return;
      objective = text;
      ctx.events.emit('story:objective', { text });
    },
    checkpoint: saveCheckpoint,
  };

  function finish(s: StageScript<P, Cp>, flow: StageFlow<P, Cp>): StoryInternal {
    script = s;

    async function resume(save: SaveV2<P, Cp>, instant: boolean): Promise<void> {
      ctx.setState('cutscene');
      ctx.ui.setHudVisible(false);
      for (const id of save.logs) logs.add(id);
      stats.time = save.stats.time;
      stats.kills = save.stats.kills;
      s.fastForward(save.story, save.id, save.cleared);
      flow.afterFastForward?.(save);
      try { ctx.player.restore(save.player); } catch (e) { console.error('[story] player.restore failed', e); }
      ctx.player.controlsEnabled = true;
      s.start();
      ctx.setState('playing');
      flow.resumed?.(save);
      if (!instant) await realSleep(0.35);
      ui().blackout?.(false, instant ? 0 : 1.2);
      world.fade(0, instant ? 0.3 : 1.2);
      if (flow.restoredToast) ctx.events.emit('story:toast', { text: flow.restoredToast });
    }

    ctx.events.on('enemy:died', () => { stats.kills++; });

    const story: StoryInternal = {
      get objective() { return objective; },
      get logs() { return logs; },
      get stats() { stats.logs = logs.size; return stats; },

      async run() {
        const d = ctx.debug;
        if (d.noStory) {
          flow.noStory?.();
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
          let wantSave = false;
          try { wantSave = new URLSearchParams(location.search).get('continue') === '1'; } catch { /* ignore */ }
          const save = wantSave ? load() : null;
          if (save) { await resume(save, true); return; }
          await flow.begin(false, true);
          return;
        }

        let skip = false;
        try { skip = sessionStorage.getItem(SKIP_INTRO_KEY) === '1'; sessionStorage.removeItem(SKIP_INTRO_KEY); } catch { /* ignore */ }
        // One click: arriving from the previous level's hand-over, or LOAD CHECKPOINT from the death / pause screen.
        const oneClick = takeContinueRequest();

        ctx.setState('menu');
        if (oneClick || skip) {
          const save = oneClick ? load() : null;
          world.fade(1, 0);
          ui().blackout?.(true, 0);
          await ui().showResumeGate(save?.place);
          if (save) { await resume(save, false); return; }
          if (skip) clear();
          await flow.begin(!skip, false);
          return;
        }
        rig.startMenu();
        await ctx.ui.showMenu();
        const choice = ui().menuChoice;
        ui().blackout?.(true, 0.8);
        await realSleep(0.9);
        rig.stopMenu();
        world.fade(1, 0);
        if (choice === 'continue') {
          const save = load();
          if (save) { await resume(save, false); return; }
          await flow.begin(true, false);
          return;
        }
        // BEGIN: everything cleared, back to level 1 (unless this page was forced to this level by its URL).
        clearAllProgress();
        if (d.level !== spec.level) {
          requestBegin();
          location.reload();
          return;
        }
        setStoredLevel(spec.level);
        await flow.begin(true, false);
      },

      update(dt: number) {
        const active = ctx.state === 'playing' || ctx.state === 'cutscene';
        if (ctx.state === 'playing') stats.time += dt;
        seq.update(dt, active);
        director.update(dt);
        s.tick(dt);
      },

      lateUpdate(dt: number) { rig.lateUpdate(dt); },
    };
    Object.assign(story, { fire: (name: string) => s.fire?.(name) ?? null, hurry: (fast?: boolean) => s.hurry(fast) });
    Object.defineProperty(story, 'debugState', { get: () => s.debugState });
    // R3: every spoken line with its condition result (the impatient playthrough's oracle reads it).
    Object.defineProperty(story, 'lineLog', { get: () => s.talk.log });
    return story;
  }

  return {
    seq, director, rig, world, logs, stats, hooks, load, clear, realSleep, finish,
    get objective() { return objective; },
  };
}

export type { StorySystem };
