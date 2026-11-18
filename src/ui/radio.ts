/**
 * HUD radio strip (stage 3c §8.6): the intercom strip's sibling — handset icon, live dot, five level bars, the channel
 * label, and a `Q` key hint under it. Idle (radio owned, nobody talking) it is dim and still; live it breathes.
 * `ui.radio(null)` hides it. Shown in playing / cutscene / paused states like the intercom strip.
 */
import type { GameContext } from '../core/types';
import { h, setText, toggle, svg } from './dom';

export class RadioStrip {
  readonly root: HTMLDivElement;
  private lbl: HTMLSpanElement;
  private bars: HTMLElement[] = [];
  private opts: { label: string; live: boolean } | null = null;
  private liveHold = 0;
  private wasLive = false;

  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.root = h('div', 'rstrip', parent);
    const row = h('div', 'rrow', this.root);
    const ic = h('span', 'ic', row);
    // handset: a bar with the earpiece / mouthpiece cups and an aerial
    svg('0 0 16 16', ['M2.5 9.5 H13.5 V14 H2.5 Z', 'M5 9.5 V6.5 H11 V9.5', 'M11.5 6.5 L13 1.5', 'M5.5 12 H10.5'], ic);
    h('i', 'live', row);
    this.lbl = h('span', 'lbl', row, '');
    const bars = h('span', 'bars', row);
    for (let i = 0; i < 5; i++) this.bars.push(h('i', '', bars));
    const hint = h('div', 'rhint', this.root);
    h('b', '', hint, 'Q');
    h('span', '', hint, 'radio');
  }

  set(o: { label: string; live: boolean } | null): void {
    this.opts = o;
    if (o) setText(this.lbl, o.label);
  }

  update(dt: number): void {
    const st = this.ctx.state;
    const visible = !!this.opts && (st === 'playing' || st === 'cutscene' || st === 'paused');
    toggle(this.root, 'show', visible);
    if (!visible) return;
    // a short hold so the bars do not snap off between two lines of one exchange
    if (this.opts!.live) this.liveHold = 0.35; else if (this.liveHold > 0) this.liveHold -= dt;
    const live = this.opts!.live || this.liveHold > 0;
    if (live !== this.wasLive) { this.wasLive = live; toggle(this.root, 'live', live); }
    const t = performance.now() / 1000;
    for (let i = 0; i < this.bars.length; i++) {
      const a = live ? 0.25 + Math.abs(Math.sin(t * (9 + i * 2.3) + i * 1.7)) * (0.55 + 0.45 * Math.sin(t * 2.7 + i)) : 0.15;
      this.bars[i].style.transform = `scaleY(${Math.max(0.15, a).toFixed(2)})`;
    }
  }
}
