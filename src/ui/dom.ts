/** Small DOM helpers shared by the UI modules (no framework). */
import type { GameContext, Quality } from '../core/types';

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement | null, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function toggle(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export const sleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));

/** Two-span reveal (visible + transparent rest) so the layout never reflows while typing. */
export class Typewriter {
  private shown: HTMLSpanElement;
  private rest: HTMLSpanElement;
  private caret: HTMLSpanElement | null;
  private n = 0;
  private acc = 0;
  text = '';
  done = true;
  onChar: ((ch: string) => void) | null = null;

  constructor(private host: HTMLElement, private cps: number, caret = false) {
    this.shown = h('span', '', host);
    this.caret = caret ? h('span', 'caret', host) : null;
    this.rest = h('span', 'rest', host);
  }

  start(text: string, cps?: number): void {
    this.text = text;
    if (cps) this.cps = cps;
    this.n = 0; this.acc = 0; this.done = text.length === 0;
    this.shown.textContent = '';
    this.rest.textContent = text;
    if (this.caret) this.caret.style.display = this.done ? 'none' : '';
  }

  finish(): void {
    if (this.done) return;
    this.n = this.text.length;
    this.render();
  }

  update(dt: number): void {
    if (this.done) return;
    this.acc += dt * this.cps;
    let steps = Math.floor(this.acc);
    if (steps <= 0) return;
    this.acc -= steps;
    const before = this.n;
    while (steps-- > 0 && this.n < this.text.length) {
      const ch = this.text[this.n++];
      // Linger on punctuation that ends a phrase — reads as speech, not a printer.
      const next = this.text[this.n];
      if (next !== undefined && next !== ' ' && next !== '\n') continue;
      if (ch === '.' || ch === '?' || ch === '!' || ch === '—' || ch === ':') { this.acc -= this.cps * 0.12; break; }
      if (ch === ',') { this.acc -= this.cps * 0.05; break; }
    }
    if (this.n !== before) {
      this.onChar?.(this.text[this.n - 1]);
      this.render();
    }
  }

  private render(): void {
    this.shown.textContent = this.text.slice(0, this.n);
    this.rest.textContent = this.text.slice(this.n);
    if (this.n >= this.text.length) {
      this.done = true;
      if (this.caret) this.caret.style.display = 'none';
    }
  }
}

const GLYPHS = '▚▞▙▟░▒▓#/\\<>01ΞΔΣ¦=+';
export const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

/** "Decode" text into place: characters resolve left-to-right out of noise. */
export class Scrambler {
  private t = 0;
  private dur = 0;
  private target = '';
  active = false;
  constructor(private el: HTMLElement) {}
  start(text: string, duration = 0.7): void {
    this.target = text; this.t = 0; this.dur = duration; this.active = text.length > 0;
    if (!this.active) this.el.textContent = '';
  }
  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const k = Math.min(1, this.t / this.dur);
    const solid = Math.floor(this.target.length * k);
    let s = this.target.slice(0, solid);
    const noiseLen = Math.min(this.target.length - solid, 6);
    for (let i = 0; i < noiseLen; i++) s += this.target[solid + i] === ' ' ? ' ' : glyph();
    this.el.textContent = s;
    if (k >= 1) { this.el.textContent = this.target; this.active = false; }
  }
}

export function sfx(ctx: GameContext, id: string, volume = 0.6): void {
  try { ctx.audio?.play(id, { volume }); } catch { /* ignore */ }
}

/** Hover / click sounds for a button. */
export function wireButton(ctx: GameContext, b: HTMLElement, onClick: () => void): void {
  b.addEventListener('mouseenter', () => sfx(ctx, 'ui_hover', 0.35));
  b.addEventListener('click', (e) => { e.stopPropagation(); sfx(ctx, 'ui_click', 0.6); onClick(); });
}

export function button(ctx: GameContext, parent: HTMLElement, label: string, n: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h('button', 'btn interactive ' + cls, parent);
  h('span', 'n', b, n);
  h('span', '', b, label);
  wireButton(ctx, b, onClick);
  return b;
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60), r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// ───────────────────────────────────────── persisted settings

export interface Settings { quality: Quality | null; volume: number; sensitivity: number | null }
const KEY = 'coldboot.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        quality: ['low', 'medium', 'high', 'ultra'].includes(s.quality) ? s.quality : null,
        volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : 0.8,
        sensitivity: typeof s.sensitivity === 'number' ? s.sensitivity : null,
      };
    }
  } catch { /* ignore */ }
  return { quality: null, volume: 0.8, sensitivity: null };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ───────────────────────────────────────── icons

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(viewBox: string, paths: string[], parent?: HTMLElement): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
  }
  parent?.appendChild(s);
  return s;
}

export const ICONS: Record<string, { vb: string; d: string[] }> = {
  pistol: { vb: '0 0 64 26', d: [
    'M3 4.5 H48 L50 2.5 H60 V11 H43 L40 12.5 H33 L28.5 24 H19 L22.5 12.5 H9 L6 9.5 H3 Z',
    'M33 12.5 C33 17 30 18 27 17.5', 'M12 7.5 H44', 'M52 5.5 H58',
  ] },
  shotgun: { vb: '0 0 110 24', d: [
    'M2 6 H70 V10.5 H2 Z', 'M14 10.5 H40 V14.5 H14 Z',
    'M70 4.5 H84 L90 7 L108 13 L106 21 L86 16 L80 16 L76 13 H70 Z',
    'M74 13 L72 18 H78', 'M4 8.2 H66',
  ] },
  // compact carbine: stamped upper with rail, flash hider, curved 30-round magazine, side-folded stock
  carbine: { vb: '0 0 96 28', d: [
    'M22 6 H74 V12 H22 Z', 'M74 7.5 H92 V10.5 H74', 'M89 6.5 V11.5', 'M30 4 H62', 'M64 4 V6',
    'M22 8 H4 V14 H22', 'M4 8 V14',
    'M44 12 L46 17 H55 L58 12',
    'M38 12 C37 19 40 24 46 26 L52 25 C48 22 46 18 46 12', 'M26 12 L24 19 H30 L33 12',
  ] },
};

/** Touch play (phones / tablets): hints name taps and on-screen buttons instead of keys. */
export function touchUI(): boolean {
  return !!(window as unknown as { __game?: { input?: { touchMode?: boolean } } }).__game?.input?.touchMode;
}

/** What the player plays with right now: a connected gamepad wins, then touch, then keyboard. */
export function inputDevice(): 'pad' | 'touch' | 'kb' {
  try { for (const g of navigator.getGamepads?.() ?? []) if (g && g.connected && g.mapping === 'standard') return 'pad'; } catch { /* ignore */ }
  return touchUI() ? 'touch' : 'kb';
}

/** Keyboard key named in a hint → [on-screen button, gamepad button] (src/ui/touch.ts, src/core/gamepad.ts). */
const KEY_LABELS: Record<string, [string, string]> = {
  E: ['USE', 'RB'], F: ['LIGHT', 'LB'], R: ['RLD', 'X'], C: ['CROUCH', 'B'], Q: ['RADIO', 'D-PAD UP'],
  SPACE: ['JUMP', 'A'], ESC: ['II', 'START'],
};

/** A keyboard key's name for the current input device ('E' → 'USE' on touch, 'RB' on a gamepad). */
export function keyLabel(key: string): string {
  const d = inputDevice(), l = KEY_LABELS[key.toUpperCase()];
  return d === 'kb' || !l ? key : l[d === 'touch' ? 0 : 1];
}

/**
 * A story hint written for the keyboard ('F  flashlight', 'Q — radio Kessler', 'C  crouch · F  light off', the WASD line)
 * rewritten for touch / gamepad play. Only a single key letter at the start of a segment is replaced.
 */
export function deviceText(text: string): string {
  const d = inputDevice();
  if (d === 'kb') return text;
  if (/^W A S D\b/.test(text)) return d === 'touch' ? 'LEFT THUMB  move   ·   PUSH TO THE EDGE  run' : 'LEFT STICK  move   ·   PUSH FULLY  run';
  return text
    .replace(/(^|·\s+)([A-Z])(?=  | — )/g, (_m, pre: string, k: string) => pre + keyLabel(k))
    // 'CROUCH  crouch' → 'CROUCH', 'LIGHT  light off' → 'LIGHT off'
    .replace(/(^|·\s+)([A-Z][A-Z-]+)  (\w+)/g, (m, pre: string, lab: string, w: string) => (lab.toLowerCase() === w.toLowerCase() ? pre + lab : m));
}
