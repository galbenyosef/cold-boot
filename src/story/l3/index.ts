/**
 * STORY, level 3 — "THE QUIET SIDE" (stage 3a). STUB (task K2): the flow of a page load (menu / one-click gate →
 * title card → play in the stub room), checkpoints in the v2 schema and the level end (carry for 3b + the end card
 * `THE QUIET SIDE` / `TO BE CONTINUED` + the menu), so the chain can be tested before task P10 writes the story.
 * Debug hooks on `__game.story`: `end()` runs the level end, `checkpoint(id)` writes a checkpoint, `debugState`.
 */
import type { GameContext, StorySystem } from '../../core/types';
import type { StoryInternal, StoryStats, UIInternal } from '../../ui/types';
import { SKIP_INTRO_KEY } from '../../ui/types';
import { Sequencer } from '../sequencer';
import { MusicDirector } from '../director';
import { CameraRig } from '../camera';
import { World } from '../world';
import {
  SAVE_VERSION, SPEC_L3, STORY_REV_L3, clearAllProgress, clearLevelSave, emptyProgressL3, loadLevelSave, requestBegin, takeContinueRequest,
  writeLevelSave, type CheckpointIdL3, type ProgressL3, type SaveDataL3,
} from '../save';
import { levelOf, setStoredLevel } from '../../core/progress';
import { applyStartLoadout, carryOut, chainMode, finishLevel, goToLevel } from '../chain';
import { END_CARD_L3, TITLE_CARD_L3 } from './text';

const OBJECTIVE_STUB = 'LEVEL 3 — NOT BUILT YET';

export async function createStoryL3(ctx: GameContext): Promise<StorySystem> {
  const seq = new Sequencer(ctx.events);
  const director = new MusicDirector(ctx);
  const rig = new CameraRig(ctx);
  const world = new World(ctx);
  const logs = new Set<string>();
  const stats: StoryStats = { time: 0, kills: 0, logs: 0, logsTotal: 0 };
  const progress: ProgressL3 = emptyProgressL3();
  let objective = '';
  let restoredFrom: string | null = null;
  let loadout: 'carry' | 'direct' | 'none' | 'save' = 'none';
  let ended = false;
  const ui = () => ctx.ui as UIInternal;
  const realSleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));
  const setObjective = (text: string) => {
    if (text === objective) return;
    objective = text;
    ctx.events.emit('story:objective', { text });
  };

  function load(): SaveDataL3 | null { return loadLevelSave<ProgressL3>(SPEC_L3) as SaveDataL3 | null; }

  function saveCheckpoint(id: CheckpointIdL3): boolean {
    let place = '';
    try { place = ctx.level.roomAt(ctx.player.position)?.name ?? ''; } catch { /* ignore */ }
    if (!progress.checkpoints.includes(id)) progress.checkpoints.push(id);
    const data: SaveDataL3 = {
      v: SAVE_VERSION, level: 3, rev: STORY_REV_L3, id, place, facts: { ...ctx.facts },
      player: ctx.player.snapshot(),
      story: JSON.parse(JSON.stringify(progress)) as ProgressL3,
      logs: [...logs],
      stats: { time: Math.round(stats.time * 10) / 10, kills: stats.kills },
      cleared: [...progress.cleared],
    };
    if (!writeLevelSave(data)) return false;
    try { ui().showCheckpoint?.(); } catch { /* ignore */ }
    return true;
  }

  function play(): void {
    ctx.player.controlsEnabled = true;
    ctx.setState('playing');
    setObjective(OBJECTIVE_STUB);
  }

  async function resume(save: SaveDataL3, instant: boolean): Promise<void> {
    for (const id of save.logs) logs.add(id);
    stats.time = save.stats.time;
    stats.kills = save.stats.kills;
    Object.assign(progress, JSON.parse(JSON.stringify(save.story)));
    if (JSON.stringify(save.facts) !== JSON.stringify(ctx.facts)) console.warn('[story] level-3 save facts differ from this load', save.facts, ctx.facts);
    try { ctx.player.restore(save.player); } catch (e) { console.error('[story] player.restore failed', e); }
    restoredFrom = save.id;
    loadout = 'save';
    play();
    if (!instant) await realSleep(0.35);
    ui().blackout?.(false, instant ? 0 : 1.2);
    world.fade(0, instant ? 0.3 : 1.2);
  }

  async function begin(card: boolean): Promise<void> {
    loadout = applyStartLoadout(ctx);
    if (card) await ctx.ui.showCard(TITLE_CARD_L3, { style: 'title', skippable: true, seconds: 4.2 });
    ctx.events.emit('story:beat', { id: 'l3_arrive' });
    progress.beats.push('l3_arrive');
    play();
    ui().blackout?.(false, 0.6);
    world.fade(0, 1.2);
  }

  /**
   * D19: the stage end. The carry for 3b (`from: 3`, facts + `badge`, `halvorsenAlive`, `kills3`) is written, the
   * level-3 checkpoint cleared; `LEVELS[3].next === null` → the stored level stays 3. Then the end card and the menu.
   * Test runs (`?autostart=1`) store only with `&handoff=1` and stay on the card.
   */
  async function end(): Promise<void> {
    if (ended) return;
    ended = true;
    const mode = chainMode(ctx);
    if (mode === 'off') clearLevelSave(3);
    else {
      let next: ReturnType<typeof finishLevel> = null;
      try { next = finishLevel(ctx, carryOut(ctx, { badge: true, halvorsenAlive: true, kills3: stats.kills })); }
      catch (err) { console.error('[story] level-3 end not stored', err); clearLevelSave(3); }
      if (next !== null && mode === 'reload') { goToLevel(); return; }
    }
    progress.beats.push('l3_end');
    ctx.events.emit('story:beat', { id: 'l3_end' });
    try { ctx.input.exitPointerLock(); } catch { /* ignore */ }
    world.fade(1, 1.0);
    ctx.setState('ended');
    ctx.ui.setHudVisible(false);
    try { await ctx.ui.showCard(END_CARD_L3, { style: 'ending', skippable: true, seconds: 12 }); } catch (err) { console.error('[story] end card failed', err); }
    if (mode === 'reload') location.reload();
  }

  ctx.events.on('enemy:died', () => { stats.kills++; });

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
        let wantSave = false;
        try { wantSave = new URLSearchParams(location.search).get('continue') === '1'; } catch { /* ignore */ }
        const save = wantSave ? load() : null;
        if (save) { await resume(save, true); return; }
        await begin(false);
        return;
      }

      let skip = false;
      try { skip = sessionStorage.getItem(SKIP_INTRO_KEY) === '1'; sessionStorage.removeItem(SKIP_INTRO_KEY); } catch { /* ignore */ }
      // One click: arriving from level 2's hand-over, or LOAD CHECKPOINT from the death / pause screen.
      const oneClick = takeContinueRequest();
      ctx.setState('menu');
      if (oneClick || skip) {
        const save = oneClick ? load() : null;
        world.fade(1, 0);
        ui().blackout?.(true, 0);
        await ui().showResumeGate(save?.place);
        if (save) { await resume(save, false); return; }
        if (skip) clearLevelSave(3);
        await begin(!skip);
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
        await begin(true);
        return;
      }
      // BEGIN: everything cleared, back to level 1 (unless this page was forced to this level by its URL).
      clearAllProgress();
      if (d.level !== ctx.levelId) {
        requestBegin();
        location.reload();
        return;
      }
      setStoredLevel(ctx.levelId);
      await begin(true);
    },

    update(dt: number) {
      const active = ctx.state === 'playing' || ctx.state === 'cutscene';
      if (ctx.state === 'playing') { stats.time += dt; progress.t += dt; }
      seq.update(dt, active);
      director.update(dt);
    },

    lateUpdate(dt: number) { rig.lateUpdate(dt); },
  };
  Object.assign(story, {
    end,
    checkpoint: (id: CheckpointIdL3 = 'cp3_start') => saveCheckpoint(id),
    fire: () => {}, hurry: () => {},
  });
  Object.defineProperty(story, 'debugState', {
    get: () => ({
      level: levelOf(ctx).id, stub: true, facts: { ...ctx.facts }, restoredFrom, loadout, ended,
      beats: [...progress.beats], checkpoints: [...progress.checkpoints], t: progress.t, flags: { ...progress.flags },
    }),
  });
  return story;
}
