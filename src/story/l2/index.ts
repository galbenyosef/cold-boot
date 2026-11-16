/**
 * STORY, level 2 — "LINE TWO" (REVISION 4). Owns the flow of this page load: menu / one-click gate →
 * title card → the lift arrives → the script (./script.ts) → one of two endings. Shares the sequencer,
 * music director, world wrappers and save helpers with level 1.
 */
import type { GameContext, PlayerSave, StorySystem } from '../../core/types';
import type { StoryInternal, StoryStats, UIInternal } from '../../ui/types';
import { SKIP_INTRO_KEY } from '../../ui/types';
import { Sequencer } from '../sequencer';
import { MusicDirector } from '../director';
import { CameraRig } from '../camera';
import { World } from '../world';
import { preload } from '../voice';
import {
  SAVE_VERSION, STORY_REV_L2, clearAllProgress, clearSaveL2, loadCarry, loadSaveL2, requestBegin, takeContinueRequest, writeSaveL2,
  type CheckpointIdL2, type SaveDataL2,
} from '../save';
import { setStoredLevel } from '../../core/progress';
import { ScriptL2 } from './script';
import { END_CARDS, ENDING_L2, LOG_IDS_L2, TITLE_CARD_L2, TOAST2 } from './text';

export async function createStoryL2(ctx: GameContext): Promise<StorySystem> {
  preload(ctx, ['l2_']);
  const seq = new Sequencer(ctx.events);
  const director = new MusicDirector(ctx);
  const rig = new CameraRig(ctx);
  const world = new World(ctx);
  const logs = new Set<string>();
  const stats: StoryStats = { time: 0, kills: 0, logs: 0, logsTotal: LOG_IDS_L2.length };
  let objective = '';
  const ui = () => ctx.ui as UIInternal;
  const realSleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));

  function saveCheckpoint(id: CheckpointIdL2): void {
    const progress = script.snapshot();
    let place = '';
    try { place = ctx.level.roomAt(ctx.player.position)?.name ?? ''; } catch { /* ignore */ }
    const data: SaveDataL2 = {
      v: SAVE_VERSION, rev: STORY_REV_L2, level: 2, id, place,
      player: ctx.player.snapshot(),
      story: progress,
      logs: [...logs],
      stats: { time: Math.round(stats.time * 10) / 10, kills: stats.kills },
      cleared: [...progress.cleared],
    };
    if (!writeSaveL2(data)) return;
    try { ui().showCheckpoint?.(); } catch { /* ignore */ }
  }

  const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  /**
   * Both endings: one card (`ui.showCard`, style 'ending') — what was done, what Unit 14 got, the stats,
   * "TO BE CONTINUED". The stored level stays 2; its checkpoint is cleared. Afterwards: back to the menu.
   */
  async function ending(choice: 'shutdown' | 'rewrite', unit14: 'spared' | 'shot' | 'killed', left: number): Promise<void> {
    clearSaveL2();
    setStoredLevel(2);
    const e = ENDING_L2[choice];
    try { ctx.input.exitPointerLock(); } catch { /* ignore */ }
    const lines = [
      e.eyebrow, '',
      ...END_CARDS[choice](left), END_CARDS.unit14[unit14], '',
      e.status(left),
      `TIME: ${fmtTime(stats.time)}`, `MACHINES STOPPED: ${stats.kills}`, `RECORDS RECOVERED: ${logs.size} / ${LOG_IDS_L2.length}`, '',
      ENDING_L2.tbc,
    ];
    try {
      await ctx.ui.showCard(lines, { style: 'ending', skippable: true, seconds: 34 });
    } catch (err) { console.error('[story] ending card failed', err); }
    if (!ctx.debug.autostart) location.reload();
  }

  const script = new ScriptL2(ctx, seq, director, world, logs, {
    setObjective(text: string) {
      if (text === objective) return;
      objective = text;
      ctx.events.emit('story:objective', { text });
    },
    checkpoint: saveCheckpoint,
    ending,
  });

  /**
   * The loadout the level starts with: what level 1 ended with (`coldboot.carry`), or — arriving by a
   * debug URL — pistol + shotgun with modest ammo. Skipped when the player module already armed the
   * player (it may apply the carry itself).
   */
  function applyLoadout(): void {
    const p = ctx.player;
    try {
      if (p.weapons.pistol.owned || p.weapons.shotgun.owned) return;
      const carry = loadCarry();
      if (carry) {
        const save: PlayerSave = { ...p.snapshot(), health: Math.max(40, carry.health), weapons: carry.weapons, current: carry.current, flashlight: carry.flashlight };
        const apply = (p as unknown as { applyLoadout?: (s: PlayerSave) => void }).applyLoadout;
        if (typeof apply === 'function') apply.call(p, save); else p.restore(save);
        return;
      }
      p.give('pistol', 12);
      p.give('shotgun', 6);
      p.give('ammo_pistol', 24);
      p.give('ammo_shotgun', 8);
    } catch (e) { console.warn('[story] loadout failed', e); }
  }

  async function resume(save: SaveDataL2, instant: boolean): Promise<void> {
    ctx.setState('cutscene');
    ctx.ui.setHudVisible(false);
    for (const id of save.logs) logs.add(id);
    stats.time = save.stats.time;
    stats.kills = save.stats.kills;
    script.fastForward(save.story, save.id, save.cleared);
    if (save.story.flags.power) {
      try { ctx.audio.setMuffle(1); } catch { /* ignore */ }
      ctx.events.emit('story:beat', { id: 'l2_power' });
      setTimeout(() => { try { if (ctx.state !== 'paused') ctx.audio.setMuffle(0); } catch { /* ignore */ } }, 2600);
    }
    try { ctx.player.restore(save.player); } catch (e) { console.error('[story] player.restore failed', e); }
    ctx.player.controlsEnabled = true;
    script.start();
    ctx.setState('playing');
    script.resumeLive();
    if (!instant) await realSleep(0.35);
    ui().blackout?.(false, instant ? 0 : 1.2);
    world.fade(0, instant ? 0.3 : 1.2);
    ctx.events.emit('story:toast', { text: TOAST2.restored });
  }

  /** A new run of this level: loadout, title card, the lift arrives. */
  async function begin(card: boolean, short: boolean): Promise<void> {
    applyLoadout();
    if (card) await ctx.ui.showCard(TITLE_CARD_L2, { style: 'title', skippable: true, seconds: 4.2 });
    script.start();
    await script.arrival(short);
  }

  ctx.events.on('enemy:died', () => { stats.kills++; });

  const story: StoryInternal = {
    get objective() { return objective; },
    get logs() { return logs; },
    get stats() { stats.logs = logs.size; return stats; },

    async run() {
      const d = ctx.debug;
      if (d.noStory) {
        script.openEverything();
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
        const save = wantSave ? loadSaveL2() : null;
        if (save) { await resume(save, true); return; }
        await begin(false, true);
        return;
      }

      let skip = false;
      try { skip = sessionStorage.getItem(SKIP_INTRO_KEY) === '1'; sessionStorage.removeItem(SKIP_INTRO_KEY); } catch { /* ignore */ }
      // One click: arriving from level 1's ending, or LOAD CHECKPOINT from the death / pause screen.
      const oneClick = takeContinueRequest();

      ctx.setState('menu');
      if (oneClick || skip) {
        const save = oneClick ? loadSaveL2() : null;
        world.fade(1, 0);
        ui().blackout?.(true, 0);
        await ui().showResumeGate(save?.place);
        if (save) { await resume(save, false); return; }
        if (skip) clearSaveL2();
        await begin(!skip, false);
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
        const save = loadSaveL2();
        if (save) { await resume(save, false); return; }
        await begin(true, false);
        return;
      }
      // BEGIN: everything cleared, back to level 1 (unless this page was forced to level 2 by its URL).
      clearAllProgress();
      if (d.level !== 2) {
        requestBegin();
        location.reload();
        return;
      }
      setStoredLevel(2);
      await begin(true, false);
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
  Object.assign(story, { fire: (name: string) => script.fire(name), hurry: (fast?: boolean) => script.hurry(fast) });
  Object.defineProperty(story, 'debugState', { get: () => script.debugState });
  // REVISION 5: every spoken line with its condition result (the impatient playthrough's oracle reads it).
  Object.defineProperty(story, 'lineLog', { get: () => script.talk.log });
  return story;
}
