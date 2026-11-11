/** Main menu, settings panel and controls list (settings + controls are reused by the pause screen). */
import type { GameContext, Quality } from '../core/types';
import { h, button, sfx, saveSettings, type Settings, glyph, toggle } from './dom';

const QUALITIES: Quality[] = ['low', 'medium', 'high', 'ultra'];

export function settingsPanel(ctx: GameContext, settings: Settings, parent: HTMLElement): HTMLDivElement {
  const p = h('div', 'panel interactive', parent);
  h('h3', '', p, 'Settings');

  // quality
  const q = h('div', 'setting', p);
  const ql = h('div', 'lbl', q);
  h('span', '', ql, 'Render quality');
  const qv = h('span', '', ql, '');
  const seg = h('div', 'seg', q);
  const qButtons = QUALITIES.map((name) => {
    const b = h('button', '', seg, name);
    b.addEventListener('mouseenter', () => sfx(ctx, 'ui_hover', 0.3));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx(ctx, 'ui_click', 0.6);
      try { ctx.render.setQuality(name); } catch (err) { console.warn('[ui] setQuality failed', err); }
      settings.quality = name;
      saveSettings(settings);
      sync();
    });
    return b;
  });

  // master volume
  const v = h('div', 'setting', p);
  const vl = h('div', 'lbl', v);
  h('span', '', vl, 'Master volume');
  const vv = h('span', '', vl, '');
  const range = h('input', 'interactive', v);
  range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1';
  range.addEventListener('input', () => {
    settings.volume = Number(range.value) / 100;
    try { ctx.audio.setMasterVolume(settings.volume); } catch { /* ignore */ }
    sync();
  });
  range.addEventListener('change', () => { saveSettings(settings); sfx(ctx, 'ui_click', 0.5); });

  // mouse sensitivity — only if the player module exposes a numeric `sensitivity`.
  const pl = ctx.player as unknown as { sensitivity?: number } | undefined;
  let sens: HTMLInputElement | null = null, sv: HTMLSpanElement | null = null;
  if (pl && typeof pl.sensitivity === 'number') {
    const base = pl.sensitivity;
    const s = h('div', 'setting', p);
    const sl = h('div', 'lbl', s);
    h('span', '', sl, 'Mouse sensitivity');
    sv = h('span', '', sl, '');
    sens = h('input', 'interactive', s);
    sens.type = 'range'; sens.min = '20'; sens.max = '300'; sens.step = '5';
    const mult = () => (settings.sensitivity ?? 1);
    sens.value = String(Math.round(mult() * 100));
    sens.addEventListener('input', () => {
      settings.sensitivity = Number(sens!.value) / 100;
      pl.sensitivity = base * settings.sensitivity;
      sync();
    });
    sens.addEventListener('change', () => saveSettings(settings));
  }

  function sync() {
    const cur = (ctx.render?.quality ?? settings.quality ?? 'high') as Quality;
    qButtons.forEach((b, i) => toggle(b, 'on', QUALITIES[i] === cur));
    qv.textContent = cur.toUpperCase();
    const pct = Math.round(settings.volume * 100);
    range.value = String(pct);
    range.style.setProperty('--p', pct + '%');
    vv.textContent = String(pct);
    if (sens && sv) {
      sens.style.setProperty('--p', ((Number(sens.value) - 20) / 280 * 100) + '%');
      sv.textContent = (Number(sens.value) / 100).toFixed(2) + '×';
    }
  }
  sync();
  return p;
}

const CONTROLS: [string[], string][] = [
  [['W', 'A', 'S', 'D'], 'Move'],
  [['SHIFT'], 'Run'],
  [['SPACE'], 'Jump'],
  [['CTRL'], 'Crouch'],
  [['LMB'], 'Fire'],
  [['R'], 'Reload'],
  [['1', '2'], 'Weapons'],
  [['F'], 'Flashlight'],
  [['E'], 'Use'],
  [['ESC'], 'Pause'],
];

export function controlsPanel(parent: HTMLElement): HTMLDivElement {
  const p = h('div', 'panel', parent);
  h('h3', '', p, 'Controls');
  const g = h('div', 'controls', p);
  for (const [keys, label] of CONTROLS) {
    const k = h('div', 'k', g);
    for (const key of keys) h('span', 'key', k, key);
    h('div', 'd', g, label);
  }
  return p;
}

/** Title with per-letter glitching + an occasional horizontal tear. */
export class GlitchTitle {
  readonly el: HTMLHeadingElement;
  private spans: HTMLSpanElement[] = [];
  private next = 1.5;
  private restore: { s: HTMLSpanElement; t: number; ch: string }[] = [];
  constructor(parent: HTMLElement, text: string) {
    this.el = h('h1', 'title', parent);
    for (const ch of text) {
      const s = h('span', '', this.el, ch === ' ' ? ' ' : ch);
      this.spans.push(s);
    }
    const ghost = h('span', 'ghost', this.el, text);
    ghost.setAttribute('aria-hidden', 'true');
  }
  update(dt: number): void {
    for (let i = this.restore.length - 1; i >= 0; i--) {
      const r = this.restore[i];
      if ((r.t -= dt) <= 0) { r.s.textContent = r.ch; r.s.className = ''; this.restore.splice(i, 1); }
    }
    if ((this.next -= dt) > 0) return;
    this.next = 0.8 + Math.random() * 3.2;
    const n = Math.random() < 0.25 ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const s = this.spans[(Math.random() * this.spans.length) | 0];
      if (s.textContent === ' ' || this.restore.some((r) => r.s === s)) continue;
      const ch = s.textContent!;
      const mode = Math.random();
      if (mode < 0.5) { s.textContent = glyph(); s.className = 'g'; }
      else if (mode < 0.8) { s.className = 'x'; }
      else { s.className = 'g'; }
      this.restore.push({ s, t: 0.05 + Math.random() * 0.14, ch });
    }
    if (Math.random() < 0.3) {
      this.el.classList.remove('tear');
      void this.el.offsetWidth;
      this.el.classList.add('tear');
    }
  }
}

export class MainMenu {
  readonly root: HTMLDivElement;
  private title: GlitchTitle;
  private side: HTMLDivElement;
  private sideMode: 'settings' | 'controls' | null = null;
  private sys: HTMLDivElement;
  private items: HTMLButtonElement[] = [];
  private resolve: (() => void) | null = null;
  private keyHandler = (e: KeyboardEvent) => { if (e.code === 'Enter' && this.resolve) this.begin(); };
  private sysT = 61 * 3600 + 2 * 60 + 17;
  private sysAcc = 0;

  constructor(private ctx: GameContext, private settings: Settings, parent: HTMLElement) {
    const root = this.root = h('div', 'layer ov menu grain scan hidden', parent);
    const col = h('div', 'col', root);
    const eb = h('div', 'eyebrow', col);
    h('span', 'dot', eb);
    h('span', 'lbl', eb, 'Halcyon Dynamics  ·  Eridu Deep  ·  Sublevel 3');
    this.title = new GlitchTitle(col, 'COLD BOOT');
    h('div', 'subtitle', col, 'The machines kept working.');
    h('div', 'rule2', col);
    const items = h('div', 'items', col);
    this.items.push(button(ctx, items, 'Begin', '01', () => this.begin(), 'primary'));
    this.items.push(button(ctx, items, 'Settings', '02', () => this.showSide('settings')));
    this.items.push(button(ctx, items, 'Controls', '03', () => this.showSide('controls')));

    this.side = h('div', 'side', root);

    const foot = h('div', 'foot', root);
    const warn = h('div', 'warn', foot);
    warn.innerHTML = '<b>▲ Headphones recommended.</b><br>Contains flashing lights, sudden loud sounds and violence.';
    this.sys = h('div', 'sys', foot);
    this.renderSys();
  }

  private showSide(mode: 'settings' | 'controls'): void {
    const same = this.sideMode === mode;
    this.items[1].classList.toggle('sel', !same && mode === 'settings');
    this.items[2].classList.toggle('sel', !same && mode === 'controls');
    this.side.classList.remove('show');
    if (same) { this.sideMode = null; return; }
    this.sideMode = mode;
    this.side.innerHTML = '';
    if (mode === 'settings') settingsPanel(this.ctx, this.settings, this.side);
    else controlsPanel(this.side);
    void this.side.offsetWidth;
    this.side.classList.add('show');
  }

  private renderSys(): void {
    const t = this.sysT;
    const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = Math.floor(t % 60);
    const pad = (n: number) => String(n).padStart(2, '0');
    this.sys.innerHTML = `CHOIR  ·  3,962 NODES RESPONDING<br>SURFACE UPLINK  <em>■ LOST</em>  ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  }

  open(): Promise<void> {
    this.root.classList.remove('hidden', 'leaving');
    void this.root.offsetWidth;
    this.root.classList.add('show');
    addEventListener('keydown', this.keyHandler);
    return new Promise((r) => { this.resolve = r; });
  }

  private begin(): void {
    const r = this.resolve;
    if (!r) return;
    this.resolve = null;
    removeEventListener('keydown', this.keyHandler);
    // Must happen inside the click gesture.
    const unlock = (() => { try { return this.ctx.audio.unlock(); } catch { return Promise.resolve(); } })();
    if (!this.ctx.debug.autostart) this.ctx.input.requestPointerLock();
    sfx(this.ctx, 'ui_open', 0.7);
    this.root.classList.add('leaving');
    setTimeout(() => { this.root.classList.add('hidden'); this.root.classList.remove('show', 'leaving'); }, 950);
    Promise.resolve(unlock).catch(() => {}).finally(() => r());
  }

  update(dt: number): void {
    if (this.root.classList.contains('hidden')) return;
    this.title.update(dt);
    this.sysAcc += dt;
    if (this.sysAcc >= 1) { this.sysAcc -= 1; this.sysT += 1; this.renderSys(); }
  }
}
