import type { FlickerMode } from '../core/types';

/** Time-averaged brightness of each mode (used when baking reflection probes). */
export const FLICKER_MEAN: Record<FlickerMode, number> = {
  none: 1, fluorescent: 0.97, broken: 0.3, pulse: 0.55, strobe: 0.4, alarm: 0.45,
};

const TAU = Math.PI * 2;

/** Per-light flicker state machine. Deterministic per seed, allocation-free. */
export class Flicker {
  mode: FlickerMode = 'none';
  value = 1;
  /** Alarm beacon angle (radians). */
  angle = 0;
  private s: number;
  private t = 0;
  private timer = 0;
  private state = 0;
  private level = 1;
  private sub = 0;
  private n0 = 0;
  private n1 = 0;
  private nt = 0;

  constructor(seed: number) {
    this.s = (seed * 2654435761) >>> 0 || 1;
    this.t = this.rnd() * 10;
    this.angle = this.rnd() * TAU;
    this.n0 = this.rnd();
    this.n1 = this.rnd();
  }

  private rnd(): number {
    let x = (this.s += 0x6d2b79f5);
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  set(mode: FlickerMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.state = 0;
    this.sub = 0;
    this.level = 1;
    this.value = mode === 'broken' ? 0 : 1;
    this.timer = mode === 'broken' ? this.rnd() * 0.6 : mode === 'fluorescent' ? 1 + this.rnd() * 6 : 0;
  }

  /** Smooth 0..1 value noise at `rate` Hz. */
  private ripple(dt: number, rate: number): number {
    this.nt += dt * rate;
    while (this.nt >= 1) { this.nt -= 1; this.n0 = this.n1; this.n1 = this.rnd(); }
    const f = this.nt * this.nt * (3 - 2 * this.nt);
    return this.n0 + (this.n1 - this.n0) * f;
  }

  step(dt: number): number {
    if (dt <= 0) return this.value;
    this.t += dt;
    switch (this.mode) {
      case 'none':
        this.value = 1;
        break;

      case 'pulse':
        // Slow breathing, never fully dark.
        this.value = 0.55 + 0.45 * Math.sin(this.t * (TAU / 3.4));
        break;

      case 'strobe': {
        const ph = (this.t * 11) % 1;
        this.value = ph < 0.38 ? 1 : 0;
        break;
      }

      case 'alarm': {
        // Rotating beacon: for points a sharp sweep past the viewer, spots use `angle` to rotate.
        this.angle = (this.angle + dt * (TAU / 1.15)) % TAU;
        const c = Math.max(0, Math.cos(this.angle));
        this.value = 0.06 + 0.94 * c * c * c * c;
        break;
      }

      case 'fluorescent': {
        // Steady tube with mains ripple; every few seconds a double-blink or a sag.
        const rip = 0.955 + 0.045 * this.ripple(dt, 28);
        this.timer -= dt;
        if (this.state === 0) {
          this.level = 1;
          if (this.timer <= 0) {
            this.state = this.rnd() < 0.7 ? 1 : 2; // 1 = double blink, 2 = sag
            this.sub = 0;
            this.timer = 0.035 + this.rnd() * 0.04;
            this.level = this.state === 1 ? 0.04 : 0.45;
          }
        } else if (this.timer <= 0) {
          this.sub++;
          if (this.state === 1) {
            // off, on, off, (on, off)?, back
            const last = this.sub >= 3 && (this.sub >= 5 || this.rnd() < 0.6);
            if (last && this.sub % 2 === 1) { this.state = 0; this.timer = 2.5 + this.rnd() * 9; this.level = 1; }
            else { this.level = this.sub % 2 === 1 ? 0.9 : 0.03; this.timer = 0.03 + this.rnd() * 0.07; }
          } else {
            if (this.sub >= 4) { this.state = 0; this.timer = 2.5 + this.rnd() * 9; this.level = 1; }
            else { this.level = 0.35 + this.rnd() * 0.5; this.timer = 0.04 + this.rnd() * 0.08; }
          }
        }
        this.value = this.level * rip;
        break;
      }

      case 'broken': {
        // Long dark gaps, erratic arcing bursts, sometimes it catches and holds before dying again.
        this.timer -= dt;
        if (this.state === 0) {
          // dark, with the occasional faint ember blip
          this.level = 0;
          this.sub -= dt;
          if (this.sub <= 0) { this.sub = 0.4 + this.rnd() * 1.6; if (this.rnd() < 0.3) this.level = 0.08 + this.rnd() * 0.12; }
          if (this.timer <= 0) { this.state = 1; this.timer = 0.2 + this.rnd() * 1.1; this.sub = 0; }
        } else if (this.state === 1) {
          this.sub -= dt;
          if (this.sub <= 0) {
            this.sub = 0.022 + this.rnd() * 0.09;
            const r = this.rnd();
            this.level = r < 0.42 ? 0 : 0.25 + 0.75 * this.rnd() * this.rnd() + (r > 0.9 ? 0.25 : 0);
          }
          if (this.timer <= 0) {
            if (this.rnd() < 0.35) { this.state = 2; this.timer = 0.35 + this.rnd() * 2.0; }
            else { this.state = 0; this.timer = 0.5 + this.rnd() * this.rnd() * 5.5; this.sub = 0.3; }
          }
        } else {
          this.level = 0.82 + 0.18 * this.ripple(dt, 40);
          if (this.timer <= 0) { this.state = 1; this.timer = 0.12 + this.rnd() * 0.4; this.sub = 0; }
        }
        // Instant strike, very short afterglow.
        this.value = this.level >= this.value ? this.level : Math.max(this.level, this.value - dt * 22);
        break;
      }
    }
    return this.value;
  }
}
