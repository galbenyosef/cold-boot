/**
 * UI — every DOM element of COLD BOOT lives under `ctx.uiRoot`. One injected stylesheet, no framework.
 * Implements UISystem plus the module-internal UIInternal extras the story uses (eyelids, blur, ...).
 */
import type { GameContext, UISystem } from '../core/types';
import type { StoryInternal, UIInternal } from './types';
import { buildCss, noiseDataUrl } from './style';
import { h, loadSettings, toggle } from './dom';
import { Hud } from './hud';
import { Subtitles } from './subtitles';
import { MainMenu } from './menu';
import { Cards, DeathScreen, EndingScreen, LogReader, PauseMenu, resumeGate } from './screens';
import { CHOIR, ENDING } from '../story/text';
import { NoteCard } from './note';

export async function createUI(ctx: GameContext): Promise<UISystem> {
  if (!document.getElementById('cb-style')) {
    const style = document.createElement('style');
    style.id = 'cb-style';
    style.textContent = buildCss(noiseDataUrl());
    document.head.appendChild(style);
  }
  const host = ctx.uiRoot;
  host.innerHTML = '';
  const root = h('div', 'cb', host);

  // Persisted settings (quality only if not forced via ?quality=).
  const settings = loadSettings();
  try { ctx.audio?.setMasterVolume(settings.volume); } catch { /* ignore */ }
  if (settings.quality && !ctx.debug.quality && ctx.render && ctx.render.quality !== settings.quality) {
    try { ctx.render.setQuality(settings.quality); } catch { /* ignore */ }
  }
  const pl = ctx.player as unknown as { sensitivity?: number } | undefined;
  if (pl && typeof pl.sensitivity === 'number' && settings.sensitivity) pl.sensitivity *= settings.sensitivity;

  // Layers (z-order bottom → top is set in CSS).
  const blurEl = h('div', 'layer wake-blur hidden', root);
  const lidTop = h('div', 'lid top hidden', root);
  const lidBot = h('div', 'lid bot hidden', root);
  const hud = new Hud(ctx, root);
  const subs = new Subtitles(ctx, root);
  const note = new NoteCard(ctx, root);
  const black = h('div', 'layer black', root);
  const log = new LogReader(ctx, root);
  const cards = new Cards(ctx, root);
  const menu = new MainMenu(ctx, settings, root);
  const pause = new PauseMenu(ctx, settings, root, () => hud.roomName);
  const death = new DeathScreen(ctx, root, CHOIR.deathTaunts, () => hud.roomName);
  const ending = new EndingScreen(ctx, root, ENDING);

  let hudWanted = true;
  const syncHud = () => hud.setVisible(hudWanted && ctx.state === 'playing');
  ctx.events.on('game:state', (e) => {
    syncHud();
    if (e.state !== 'paused' && pause.open_) {
      // Something else (story/death) changed state while the pause menu was up.
      pause.open_ = false;
      pause.root.classList.remove('show');
      pause.root.classList.add('hidden');
    }
  });

  // Pointer lock refused (Chrome cool-down after Esc): fall back to the pause screen.
  document.addEventListener('pointerlockerror', () => {
    if (ctx.debug.autostart) return;
    if (ctx.state === 'playing' || ctx.state === 'cutscene') { pause.open(); pause.lockRefused(); }
    else if (pause.open_) pause.lockRefused();
  });
  // Clicking the game while playing without a lock (e.g. autostart in a real browser) grabs the mouse.
  ctx.canvas.addEventListener('click', () => {
    if (ctx.state === 'playing' && !ctx.input.pointerLocked) ctx.input.requestPointerLock();
  });

  // Animated lids/blur helpers.
  let lidsOpen = 1;
  const setLids = (open: number, seconds: number) => {
    lidsOpen = open;
    const show = open < 0.999;
    if (show) { lidTop.classList.remove('hidden'); lidBot.classList.remove('hidden'); }
    for (const [el, sign] of [[lidTop, -1], [lidBot, 1]] as const) {
      el.style.transitionDuration = `${Math.max(0, seconds)}s`;
      el.style.transform = `translateY(${sign * open * 108}%)`;
    }
    if (!show) setTimeout(() => { if (lidsOpen >= 0.999) { lidTop.classList.add('hidden'); lidBot.classList.add('hidden'); } }, seconds * 1000 + 50);
  };
  let blurPx = 0;
  const setBlur = (px: number, seconds: number) => {
    blurPx = px;
    if (px > 0) blurEl.classList.remove('hidden');
    const v = `blur(${px}px)`;
    blurEl.style.transition = `backdrop-filter ${seconds}s ease, -webkit-backdrop-filter ${seconds}s ease`;
    blurEl.style.backdropFilter = v;
    (blurEl.style as any).webkitBackdropFilter = v;
    if (px <= 0) setTimeout(() => { if (blurPx <= 0) blurEl.classList.add('hidden'); }, seconds * 1000 + 50);
  };

  let lastLock = false;
  const ui: UIInternal = {
    showMenu() {
      return menu.open().then(() => { pause.grace = 1.5; });
    },
    showCard(lines, opts) { return cards.show(lines, opts); },
    showLog(title, body) { return log.open(title, body); },
    showDeath() { return death.show(); },
    showEnding() { return ending.show(); },
    setHudVisible(v) { hudWanted = v; syncHud(); },

    eyelids(open, seconds) { setLids(open, seconds); },
    blur(px, seconds) { setBlur(px, seconds); },
    blackout(on, seconds = 0.6) {
      black.style.transitionDuration = `${seconds}s`;
      toggle(black, 'on', on);
    },
    showResumeGate() { return resumeGate(ctx, root).then(() => { pause.grace = 1.5; }); },
    showNote(header, body, style) { return note.open(header, body, style); },
    closeNote() { note.close(); },
    get noteOpen() { return note.isOpen; },
    setTorchHint(on) { hud.torchHintWanted = on; },

    update(dt) {
      const s = ctx.state;
      syncHud();
      hud.promptSuppressed = note.isOpen;
      hud.update(dt);
      subs.update(dt);
      log.update(dt);
      // Esc on an open note only closes the note (it must not also open the pause menu this frame).
      const noteEsc = note.isOpen && ctx.input.pressed('Escape');
      note.update(dt);
      menu.update(dt);
      death.update(dt);
      ending.update(dt);

      // Pause handling: Esc (when the browser delivers it) or losing pointer lock while in play.
      const locked = ctx.input.pointerLocked;
      if (pause.grace > 0) pause.grace -= dt;
      if (log.isOpen && lastLock && !locked && !ctx.debug.autostart) log.close();
      if (note.isOpen && lastLock && !locked && !ctx.debug.autostart) note.close();
      if (!ctx.debug.autostart && !log.isOpen && (s === 'playing' || s === 'cutscene')) {
        if ((ctx.input.pressed('Escape') && !noteEsc) || (!locked && pause.grace <= 0)) pause.open();
      } else if (pause.open_ && ctx.input.pressed('Escape') && pause.grace <= 0) {
        pause.resume();
      }
      lastLock = locked;

      // Scripted camera that must run after player.update (menu drift, wake-up lying offset).
      (ctx.story as StoryInternal | undefined)?.lateUpdate?.(dt);
    },
  };
  return ui;
}
