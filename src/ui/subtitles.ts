/**
 * Subtitles: speaker label + typewriter line. CHOIR lines get a distinct glitchy cyan treatment;
 * speaker 'PA' is CHOIR over the public-address system: a chime icon, calmer, no glitching.
 */
import type { GameContext } from '../core/types';
import { h, setText, toggle, Typewriter, glyph, svg } from './dom';

export class Subtitles {
  readonly root: HTMLDivElement;
  private spk: HTMLDivElement;
  private spkName: HTMLSpanElement;
  private line: HTMLDivElement;
  private tw: Typewriter;
  private waveBars: HTMLElement[] = [];
  private left = 0;
  private choir = false;
  private joltLeft = 0;
  private glitchLeft = 0;
  private glitchIdx = -1;

  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.root = h('div', 'subs', parent);
    this.spk = h('div', 'spk', this.root);
    const wave = h('span', 'wave', this.spk);
    for (let i = 0; i < 7; i++) this.waveBars.push(h('i', '', wave));
    // PA chime icon: a small horn with two sound arcs.
    const chime = h('span', 'chime', this.spk);
    svg('0 0 22 14', ['M1 5 H4 L9 1.5 V12.5 L4 9 H1 Z', 'M12.5 4.2 C14 5.6 14 8.4 12.5 9.8', 'M15.5 2 C18.6 4.8 18.6 9.2 15.5 12'], chime);
    this.spkName = h('span', '', this.spk, '');
    this.line = h('div', 'line', this.root);
    this.tw = new Typewriter(this.line, 42);
    ctx.events.on('story:subtitle', (e) => this.show(e.speaker, e.text, e.duration));
  }

  show(speaker: string, text: string, duration: number): void {
    const pa = /^pa$/i.test(speaker.trim());
    this.choir = /^choir$/i.test(speaker.trim());
    toggle(this.root, 'choir', this.choir);
    toggle(this.root, 'pa', pa);
    setText(this.spkName, pa ? 'CHOIR · PUBLIC ADDRESS' : speaker.toUpperCase());
    toggle(this.spk, 'hidden', !speaker);
    // Reveal so the whole line is readable for at least ~45% of its time on screen.
    const cps = Math.max(28, Math.min(70, text.length / Math.max(0.6, duration * 0.55)));
    this.glitchIdx = -1;
    this.glitchLeft = 0;
    this.tw.start(text, cps);
    this.left = Math.max(1.5, duration) + 0.6;
    this.root.classList.add('show');
  }

  update(dt: number): void {
    if (this.left <= 0) return;
    const visibleState = this.ctx.state === 'playing' || this.ctx.state === 'cutscene' || this.ctx.state === 'paused';
    // Subtitles never time out while the game is paused.
    if (this.ctx.state === 'playing' || this.ctx.state === 'cutscene') this.left -= dt;
    toggle(this.root, 'show', visibleState && this.left > 0.4);
    this.tw.update(dt);
    if (!this.choir) return;

    // Waveform bars: cheap transform-only animation.
    const t = performance.now() / 1000;
    const talking = !this.tw.done || this.left > 1;
    for (let i = 0; i < this.waveBars.length; i++) {
      const a = talking ? 0.35 + Math.abs(Math.sin(t * (7 + i * 1.7) + i * 1.3)) * (0.65 + 0.35 * Math.sin(t * 3.1 + i)) : 0.3;
      this.waveBars[i].style.transform = `scaleY(${(a * 3).toFixed(2)})`;
    }
    // Occasional jolt + single-glyph corruption.
    if ((this.joltLeft -= dt) <= 0) {
      this.joltLeft = 0.6 + Math.random() * 1.8;
      this.root.classList.add('jolt');
      setTimeout(() => this.root.classList.remove('jolt'), 70 + Math.random() * 60);
    }
    if (this.glitchLeft > 0) {
      if ((this.glitchLeft -= dt) <= 0 && this.glitchIdx >= 0) { this.glitchIdx = -1; this.tw.finish(); this.restoreLine(); }
    } else if (this.tw.done && Math.random() < dt * 1.2) {
      const txt = this.tw.text;
      const i = (Math.random() * txt.length) | 0;
      if (txt[i] && txt[i] !== ' ') {
        this.glitchIdx = i;
        this.glitchLeft = 0.09;
        const shown = this.line.firstChild as HTMLElement | null;
        if (shown) shown.textContent = txt.slice(0, i) + glyph() + txt.slice(i + 1);
      }
    }
  }

  private restoreLine(): void {
    const shown = this.line.firstChild as HTMLElement | null;
    if (shown) shown.textContent = this.tw.text;
  }
}
