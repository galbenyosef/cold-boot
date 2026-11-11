/**
 * Offline synthesis toolkit. Every one-shot / loop is a `SoundDef` whose `render()` builds a node graph
 * inside an OfflineAudioContext through the `Synth` helper (all times relative to the variant's t0).
 * JS-side generators (modal ringing, crackle, glitch data) produce Float32Arrays that are played as
 * buffer sources inside the same graph.
 */

export const SR = 44100;

export type BusName = 'sfx' | 'ambience' | 'music' | 'voice' | 'ui';

export interface SoundDef {
  id: string;
  /** Number of pre-rendered variations. */
  variants: number;
  /** Seconds per variation (for loops: the loop length). */
  dur: number;
  loop?: boolean;
  channels?: 1 | 2;
  bus?: BusName;
  /** Base playback volume. */
  vol?: number;
  /** ± random playback-rate variation (fraction). Default 0.04 (loops 0). */
  pitchVar?: number;
  /** ± random volume variation (fraction). Default 0.12. */
  volVar?: number;
  /** Per-id simultaneous voice cap (default 4). */
  maxVoices?: number;
  /** Minimum seconds between two starts of this id (default 0.015). */
  minInterval?: number;
  /** Voice-steal priority: higher survives. Default 1. */
  priority?: number;
  /** Panner refDistance (default 2.5) and rolloff (default 1.1). */
  ref?: number;
  rolloff?: number;
  /** Reverb send multiplier (default 1). */
  send?: number;
  /** 'load' (awaited in createAudio), 'idle' (rendered in the background right after), 'late' (background,
   *  after the idle set), 'lazy' (on first use). */
  when?: 'load' | 'idle' | 'late' | 'lazy';
  /** Variant selection: 'random' (default, never the same twice) or 'cycle' (step through the variants in
   *  order, ping-pong; restarts at 0 after a 2.5 s pause — sequences that should sound like they move). */
  order?: 'random' | 'cycle';
  /** Peak normalisation target (default 0.9). 0 = no normalisation. */
  peak?: number;
  render(s: Synth, v: number): void;
  /** Optional JS post-process per variation (after render, before normalise). */
  post?(ch: Float32Array[], rnd: () => number, v: number): void;
}

// ───────────────────────────────────────────── rng

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ───────────────────────────────────────────── shared noise + curves (context independent)

let noiseBufs: Record<'white' | 'pink' | 'brown', AudioBuffer> | null = null;
const NOISE_LEN = SR * 4;

function makeNoiseBuffer(fill: (d: Float32Array, rnd: () => number) => void): AudioBuffer {
  const b = new AudioBuffer({ length: NOISE_LEN, sampleRate: SR, numberOfChannels: 1 });
  const d = b.getChannelData(0);
  fill(d, mulberry(1234 + d.length));
  // normalise to peak 1
  let pk = 0;
  for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  const k = 1 / (pk || 1);
  for (let i = 0; i < d.length; i++) d[i] *= k;
  // seamless loop: crossfade the last 2048 into the head
  const xf = 2048;
  for (let i = 0; i < xf; i++) {
    const a = i / xf;
    d[i] = d[i] * Math.sqrt(a) + d[d.length - xf + i] * Math.sqrt(1 - a);
  }
  return b;
}

export function noiseBuffers() {
  if (noiseBufs) return noiseBufs;
  const white = makeNoiseBuffer((d, r) => { for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; });
  const pink = makeNoiseBuffer((d, r) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    }
  });
  const brown = makeNoiseBuffer((d, r) => {
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (r() * 2 - 1)) / 1.02; d[i] = last; }
    // remove DC drift
    let m = 0; for (let i = 0; i < d.length; i++) m += d[i]; m /= d.length;
    for (let i = 0; i < d.length; i++) d[i] -= m;
  });
  noiseBufs = { white, pink, brown };
  return noiseBufs;
}

const curveCache = new Map<string, Float32Array<ArrayBuffer>>();
export function curve(kind: 'tanh' | 'hard' | 'fold' | 'crush' | 'asym', amt: number): Float32Array<ArrayBuffer> {
  const key = kind + amt;
  let c = curveCache.get(key);
  if (c) return c;
  const n = 2048;
  c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y: number;
    switch (kind) {
      case 'tanh': y = Math.tanh(x * amt) / Math.tanh(amt); break;
      case 'hard': y = Math.max(-1, Math.min(1, x * amt)); break;
      case 'fold': y = Math.sin(x * amt * Math.PI * 0.5); break;
      case 'crush': { const q = Math.pow(2, amt); y = Math.round(x * q) / q; break; }
      case 'asym': y = x >= 0 ? Math.tanh(x * amt) : Math.tanh(x * amt * 0.6) * 0.8; y /= Math.tanh(amt); break;
    }
    c[i] = y;
  }
  curveCache.set(key, c);
  return c;
}

// ───────────────────────────────────────────── JS generators

/** Sum of exponentially decaying sines. modes: [freqHz, tau(s), amp]. */
export function modalData(dur: number, modes: Array<[number, number, number]>, rnd: () => number, opts?: { attack?: number }): Float32Array<ArrayBuffer> {
  const len = Math.max(1, Math.floor(dur * SR));
  const out = new Float32Array(len);
  for (const [f, tau, amp] of modes) {
    if (f <= 0 || f >= SR * 0.47) continue;
    const w = (2 * Math.PI * f) / SR;
    const d = Math.exp(-1 / (tau * SR));
    const c = 2 * Math.cos(w) * d, d2 = d * d;
    const ph = rnd() * Math.PI * 2;
    let y1 = Math.sin(ph) * amp, y2 = Math.sin(ph - w) * amp / d;
    const n = Math.min(len, Math.floor(tau * SR * 9));
    for (let i = 0; i < n; i++) {
      const y = c * y1 - d2 * y2;
      out[i] += y1;
      y2 = y1; y1 = y;
    }
  }
  const att = Math.floor((opts?.attack ?? 0.0006) * SR);
  for (let i = 0; i < att && i < len; i++) out[i] *= i / att;
  return out;
}

/** Sparse random impulses (electrical crackle / grit). density = impulses per second. */
export function crackleData(dur: number, density: number, rnd: () => number, opts?: { burst?: number; env?: (t: number) => number }): Float32Array<ArrayBuffer> {
  const len = Math.floor(dur * SR);
  const out = new Float32Array(len);
  const burst = opts?.burst ?? 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const e = opts?.env ? opts.env(t) : 1;
    if (rnd() < (density * e) / SR) {
      const a = (rnd() * 0.7 + 0.3) * (rnd() < 0.5 ? -1 : 1);
      const w = 1 + Math.floor(rnd() * (3 + burst * 40));
      for (let k = 0; k < w && i + k < len; k++) out[i + k] += a * (1 - k / w) * (rnd() * 2 - 1 > -0.6 ? 1 : -1);
    }
  }
  return out;
}

// ───────────────────────────────────────────── the Synth helper

type Pt = [number, number];

export class Synth {
  t0 = 0;
  rnd: () => number = Math.random;
  readonly out: GainNode;
  constructor(readonly ctx: BaseAudioContext, out?: GainNode) {
    this.out = out ?? ctx.createGain();
    if (!out) this.out.connect(ctx.destination);
  }
  at(t: number) { return this.t0 + Math.max(0, t); }
  r(a: number, b: number) { return a + (b - a) * this.rnd(); }
  ri(a: number, b: number) { return Math.floor(this.r(a, b + 1)); }
  pick<T>(a: readonly T[]): T { return a[Math.floor(this.rnd() * a.length) % a.length]; }
  chance(p: number) { return this.rnd() < p; }

  gain(v = 1): GainNode { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  filt(type: BiquadFilterType, f: number, Q = 0.707, gainDb = 0): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type; b.frequency.value = Math.min(f, SR * 0.45); b.Q.value = Q; b.gain.value = gainDb;
    return b;
  }
  lp(f: number, Q = 0.707) { return this.filt('lowpass', f, Q); }
  hp(f: number, Q = 0.707) { return this.filt('highpass', f, Q); }
  bp(f: number, Q = 1) { return this.filt('bandpass', f, Q); }
  pk(f: number, Q: number, db: number) { return this.filt('peaking', f, Q, db); }
  shaper(kind: 'tanh' | 'hard' | 'fold' | 'crush' | 'asym', amt: number, oversample: OverSampleType = 'none'): WaveShaperNode {
    const w = this.ctx.createWaveShaper(); w.curve = curve(kind, amt); w.oversample = oversample; return w;
  }
  pan(p: number): StereoPannerNode { const n = this.ctx.createStereoPanner(); n.pan.value = p; return n; }
  delay(t: number, max = 1): DelayNode { const d = this.ctx.createDelay(max); d.delayTime.value = t; return d; }

  /** Connect nodes in series; returns the last. */
  chain(...nodes: AudioNode[]): AudioNode {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }

  noise(color: 'white' | 'pink' | 'brown', start: number, dur: number, rate = 1): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffers()[color];
    src.loop = true;
    src.playbackRate.value = rate;
    const off = this.rnd() * 3.5;
    src.start(this.at(start), off);
    src.stop(this.at(start + dur));
    return src;
  }
  osc(type: OscillatorType, f: number, start: number, dur: number, wave?: PeriodicWave): OscillatorNode {
    const o = this.ctx.createOscillator();
    if (wave) o.setPeriodicWave(wave); else o.type = type;
    o.frequency.value = f;
    o.start(this.at(start));
    o.stop(this.at(start + dur));
    return o;
  }
  data(d: Float32Array<ArrayBuffer>, start: number, rate = 1): AudioBufferSourceNode {
    const b = new AudioBuffer({ length: d.length, sampleRate: SR, numberOfChannels: 1 });
    b.copyToChannel(d, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    src.start(this.at(start));
    return src;
  }

  /** Breakpoint automation. Points relative to t0. 'exp' ramps clamp to >= 1e-4. */
  env(p: AudioParam, pts: Pt[], mode: 'lin' | 'exp' = 'lin'): void {
    if (!pts.length) return;
    p.setValueAtTime(mode === 'exp' ? Math.max(pts[0][1], 1e-4) : pts[0][1], this.at(pts[0][0]));
    for (let i = 1; i < pts.length; i++) {
      const [t, v] = pts[i];
      if (mode === 'exp') p.exponentialRampToValueAtTime(Math.max(v, 1e-4), this.at(t));
      else p.linearRampToValueAtTime(v, this.at(t));
    }
  }
  /** Attack → (hold) → exponential decay (setTargetAtTime). Returns a GainNode. */
  ad(start: number, attack: number, peak: number, tau: number, hold = 0): GainNode {
    const g = this.ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0, this.at(start));
    p.linearRampToValueAtTime(peak, this.at(start + Math.max(attack, 0.0003)));
    p.setTargetAtTime(0, this.at(start + attack + hold), Math.max(tau, 0.0005));
    return g;
  }
  /** Gain that swells in and out: 0 → peak over a, hold h, release r (all linear-ish smooth). */
  swell(start: number, a: number, peak: number, h: number, r: number): GainNode {
    const g = this.ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0, this.at(start));
    p.setTargetAtTime(peak, this.at(start), a / 3);
    p.setTargetAtTime(0, this.at(start + a + h), r / 3);
    return g;
  }

  // ─────────── patches

  /** Filtered noise burst. */
  burst(o: { start?: number; color?: 'white' | 'pink' | 'brown'; type?: BiquadFilterType; f?: number; Q?: number; a?: number; tau: number; level: number; hold?: number; f1?: number; sweep?: number; rate?: number; dst?: AudioNode }): void {
    const st = o.start ?? 0;
    const dur = (o.a ?? 0.001) + (o.hold ?? 0) + o.tau * 7;
    const n = this.noise(o.color ?? 'white', st, dur, o.rate ?? 1);
    const f = this.filt(o.type ?? 'bandpass', o.f ?? 2000, o.Q ?? 1);
    if (o.f1 !== undefined) this.env(f.frequency, [[st, o.f ?? 2000], [st + (o.sweep ?? dur), o.f1]], 'exp');
    const g = this.ad(st, o.a ?? 0.001, o.level, o.tau, o.hold ?? 0);
    this.chain(n, f, g, o.dst ?? this.out);
  }
  /** Oscillator with exponential pitch sweep + envelope. */
  tone(o: { start?: number; type?: OscillatorType; f: number; f1?: number; sweep?: number; a?: number; tau: number; level: number; hold?: number; dst?: AudioNode; wave?: PeriodicWave; lp?: number }): OscillatorNode {
    const st = o.start ?? 0;
    const dur = (o.a ?? 0.001) + (o.hold ?? 0) + o.tau * 7;
    const osc = this.osc(o.type ?? 'sine', o.f, st, dur, o.wave);
    if (o.f1 !== undefined) this.env(osc.frequency, [[st, o.f], [st + (o.sweep ?? dur * 0.5), o.f1]], 'exp');
    const g = this.ad(st, o.a ?? 0.001, o.level, o.tau, o.hold ?? 0);
    if (o.lp) this.chain(osc, this.lp(o.lp), g, o.dst ?? this.out);
    else this.chain(osc, g, o.dst ?? this.out);
    return osc;
  }
  /** Modal (struck object) ring. Mode amplitudes are relative; `level` scales the whole thing. */
  modal(o: { start?: number; modes: Array<[number, number, number]>; level: number; dur?: number; rate?: number; dst?: AudioNode; attack?: number }): void {
    const longest = o.modes.reduce((m, x) => Math.max(m, x[1]), 0);
    const dur = o.dur ?? Math.min(6, longest * 7 + 0.01);
    const d = modalData(dur, o.modes, this.rnd, { attack: o.attack });
    const src = this.data(d, o.start ?? 0, o.rate ?? 1);
    const g = this.gain(o.level);
    this.chain(src, g, o.dst ?? this.out);
  }
  /** Generate modes from a base frequency and ratio list with jitter. */
  modes(f0: number, ratios: number[], taus: number[], amps?: number[], jitter = 0.03): Array<[number, number, number]> {
    return ratios.map((r, i) => [f0 * r * (1 + (this.rnd() * 2 - 1) * jitter), taus[i % taus.length] * (0.85 + this.rnd() * 0.3), (amps ? amps[i % amps.length] : 1 / (i + 1)) * (0.7 + this.rnd() * 0.6)] as [number, number, number]);
  }
  /** Very short broadband click (impulse-ish). */
  click(start: number, level: number, bright = 4000, tau = 0.0012, dst?: AudioNode): void {
    this.burst({ start, color: 'white', type: 'highpass', f: bright, Q: 0.5, a: 0.0002, tau, level, dst });
  }
  /** Sine thump with downward pitch sweep (kick-like). */
  thump(start: number, f0: number, f1: number, sweep: number, tau: number, level: number, dst?: AudioNode): void {
    this.tone({ start, f: f0, f1, sweep, a: 0.0015, tau, level, dst });
  }
}

// ───────────────────────────────────────────── glottal periodic wave

const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
export function periodic(ctx: BaseAudioContext, key: string, amp: (n: number) => number, n = 48): PeriodicWave {
  let m = waveCache.get(ctx);
  if (!m) waveCache.set(ctx, (m = new Map()));
  let w = m.get(key);
  if (w) return w;
  const real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
  for (let i = 1; i <= n; i++) imag[i] = amp(i);
  w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  m.set(key, w);
  return w;
}
