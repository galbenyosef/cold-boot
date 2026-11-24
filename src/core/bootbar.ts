/**
 * Loading progress bar under the boot status line (#boot-bar in index.html).
 *
 * Boot runs in a few long synchronous steps (on a phone one of them blocks the page for 10+ s), so the bar cannot be
 * driven from JS while a step runs. Instead every step gets an expected length and the bar is sent towards the step's
 * end with a CSS transform transition — the compositor animates it even while the main thread is busy. The lengths
 * are learned: each boot stores how long its steps really took (per device class and level) and the next boot uses
 * them, so the bar gets truthful after the first load.
 */
export type BootStep = 'renderer' | 'materials' | 'effects' | 'audio' | 'level' | 'player' | 'enemies' | 'interface' | 'lighting';

const STEPS: readonly BootStep[] = ['renderer', 'materials', 'effects', 'audio', 'level', 'player', 'enemies', 'interface', 'lighting'];

/** First-load guesses (seconds): an iPhone 15 Pro and an M3 Mac, level 1 (2026-11-24 measurements). */
const DEFAULTS: Record<'m' | 'd', Record<BootStep, number>> = {
  m: { renderer: 0.5, materials: 2.5, effects: 1, audio: 3, level: 5, player: 15.5, enemies: 2.6, interface: 1.5, lighting: 4 },
  d: { renderer: 0.1, materials: 0.4, effects: 0.3, audio: 0.5, level: 0.6, player: 0.9, enemies: 0.4, interface: 0.3, lighting: 1.2 },
};

/** The bar eases towards this share of a step while it runs, then waits (a step that runs long never shows done). */
const HOLD = 0.9;

export class BootBar {
  private readonly fill: HTMLElement | null;
  private readonly key: string;
  private readonly expect: Record<BootStep, number>;
  private readonly total: number;
  private readonly took: Partial<Record<BootStep, number>> = {};
  private cur: BootStep | null = null;
  private curT = 0;

  constructor(mobile: boolean, levelId: number) {
    this.fill = document.getElementById('boot-fill');
    this.key = `cb-boot-times:${mobile ? 'm' : 'd'}:${levelId}`;
    const base = { ...DEFAULTS[mobile ? 'm' : 'd'] };
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) ?? 'null') as Partial<Record<BootStep, number>> | null;
      if (saved) for (const s of STEPS) if (typeof saved[s] === 'number' && saved[s]! > 0) base[s] = saved[s]!;
    } catch { /* private mode / bad data: guesses */ }
    this.expect = base;
    this.total = STEPS.reduce((a, s) => a + base[s], 0);
  }

  /** Call as a step starts (after the status text is set). Resolves once the bar has been painted heading for it. */
  async step(s: BootStep): Promise<void> {
    const now = performance.now();
    if (this.cur) this.took[this.cur] = (now - this.curT) / 1000;
    this.cur = s;
    this.curT = now;
    const i = STEPS.indexOf(s);
    const from = this.share(i), to = this.share(i + 1);
    this.set(from, 0);
    // let the jump land before the long transition starts
    await frame();
    this.set(from + (to - from) * HOLD, this.expect[s]);
    // and let the transition reach the compositor before the step blocks the page (Safari starts it only on a commit)
    await frame(); await frame();
  }

  /** Boot finished: fill, and remember how long each step took. */
  done(): void {
    if (this.cur) this.took[this.cur] = (performance.now() - this.curT) / 1000;
    this.cur = null;
    this.set(1, 0.15);
    try {
      const next: Partial<Record<BootStep, number>> = {};
      // a little smoothing so one odd load (a cold cache, a background tab) does not throw the next bar off
      for (const s of STEPS) {
        const t = this.took[s];
        if (t !== undefined) next[s] = +(this.expect[s] * 0.3 + t * 0.7).toFixed(3);
      }
      localStorage.setItem(this.key, JSON.stringify(next));
    } catch { /* ignore */ }
  }

  private share(i: number): number {
    let a = 0;
    for (let k = 0; k < i && k < STEPS.length; k++) a += this.expect[STEPS[k]];
    return this.total > 0 ? a / this.total : 0;
  }

  private set(x: number, seconds: number): void {
    const f = this.fill;
    if (!f) return;
    f.style.transition = seconds > 0 ? `transform ${seconds.toFixed(2)}s cubic-bezier(.25,.6,.45,1)` : 'none';
    f.style.transform = `scaleX(${Math.max(0, Math.min(1, x)).toFixed(4)})`;
    if (seconds <= 0) void f.offsetWidth; // commit the jump before the next transition
  }
}

/** Next frame — or 50 ms, whichever first (no frames come in a background tab; boot must not wait for them). */
function frame(): Promise<void> {
  return new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 50); });
}
