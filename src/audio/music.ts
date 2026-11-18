/**
 * Generative adaptive score. Context-agnostic (works in a live AudioContext and in an
 * OfflineAudioContext for analysis): every event is scheduled ahead of time by `tick(now)`.
 * Layers crossfade with setTargetAtTime, so transitions can never click.
 */
import type { MusicState } from '../core/types';
import { noiseBuffers } from './synth/core';

export type MusicMode = MusicState | 'menu';

type BufGetter = (id: string) => AudioBuffer[] | undefined;

const E1 = 41.2;
const LOOKAHEAD = 0.3;

abstract class Layer {
  readonly out: GainNode;
  protected srcs = new Set<AudioScheduledSourceNode>();
  protected next = 0;
  dead = false;
  constructor(protected m: Music, readonly t0: number, protected level: number, fadeIn: number) {
    this.out = m.ctx.createGain();
    this.out.gain.setValueAtTime(0, t0);
    this.out.gain.setTargetAtTime(level, t0, fadeIn / 3);
    this.out.connect(m.out);
    this.next = t0;
  }
  abstract schedule(until: number): void;

  kill(at: number, tau: number) {
    if (this.dead) return;
    this.dead = true;
    const g = this.out.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0, at, tau);
    const end = at + tau * 7 + 0.05;
    for (const s of this.srcs) { try { s.stop(end); } catch { /* */ } }
    const sentinel = this.m.ctx.createConstantSource();
    sentinel.offset.value = 0;
    sentinel.connect(this.out);
    sentinel.onended = () => { this.out.disconnect(); };
    sentinel.start(at); sentinel.stop(end + 0.05);
  }

  // helpers
  protected hold<T extends AudioScheduledSourceNode>(s: T, at: number, stopAt?: number): T {
    s.start(at);
    if (stopAt !== undefined) s.stop(stopAt);
    else this.srcs.add(s);
    s.onended = () => { this.srcs.delete(s); s.disconnect(); };
    return s;
  }
  protected gain(v: number) { const g = this.m.ctx.createGain(); g.gain.value = v; return g; }
  protected filt(type: BiquadFilterType, f: number, Q = 0.707) { const b = this.m.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; return b; }
  protected osc(type: OscillatorType, f: number, at: number, stopAt?: number) {
    const o = this.m.ctx.createOscillator(); o.type = type; o.frequency.value = f; return this.hold(o, at, stopAt);
  }
  protected lfo(f: number, depth: number, param: AudioParam, at: number) {
    const o = this.osc('sine', f, at);
    const g = this.gain(depth);
    o.connect(g); g.connect(param);
  }
  protected noise(color: 'white' | 'pink' | 'brown', at: number, stopAt?: number) {
    const s = this.m.ctx.createBufferSource();
    s.buffer = noiseBuffers()[color]; s.loop = true;
    s.loopStart = 0; s.loopEnd = s.buffer.duration;
    return this.hold(s, at, stopAt);
  }
  /** Sustained drone voice (auto-stopped on kill). */
  protected drone(type: OscillatorType, f: number, level: number, at: number, dst: AudioNode = this.out): { osc: OscillatorNode; g: GainNode } {
    const o = this.osc(type, f, at);
    const g = this.gain(level);
    o.connect(g); g.connect(dst);
    return { osc: o, g };
  }
  /** One-shot from the music bank. */
  protected hit(id: string, at: number, vol: number, rate = 1, pan = 0, send = 0.3): void {
    const bufs = this.m.buf(id);
    if (!bufs || this.dead || at < this.m.lastNow - 0.08) return; // late (scheduler starved): drop, never burst
    const c = this.m.ctx;
    const s = c.createBufferSource();
    s.buffer = bufs[Math.floor(this.m.rnd() * bufs.length)];
    s.playbackRate.value = rate;
    const g = this.gain(vol);
    const p = c.createStereoPanner(); p.pan.value = pan;
    s.connect(g); g.connect(p); p.connect(this.out);
    if (send > 0 && this.m.plate) { const sg = this.gain(send); g.connect(sg); sg.connect(this.m.plate); s.onended = () => { s.disconnect(); g.disconnect(); p.disconnect(); sg.disconnect(); }; }
    else s.onended = () => { s.disconnect(); g.disconnect(); p.disconnect(); };
    s.start(at);
  }
  protected r(a: number, b: number) { return a + (b - a) * this.m.rnd(); }
}

// ─────────────────────────────────────────── ambient

class Ambient extends Layer {
  private nextBowed: number; private nextPulse: number;
  constructor(m: Music, t: number, level = 0.3) {
    super(m, t, level, 6);
    const sub = this.drone('sine', E1, 0.32, t);
    this.lfo(0.047, 0.1, sub.g.gain, t);
    const fifth = this.drone('sine', E1 * 1.5, 0.1, t);
    this.lfo(0.031, 0.06, fifth.g.gain, t);
    // slow detuned partials through a breathing low-pass
    const lp = this.filt('lowpass', 240, 0.6);
    this.lfo(0.021, 90, lp.frequency, t);
    const pg = this.gain(0.07);
    lp.connect(pg); pg.connect(this.out);
    for (const [f, d] of [[82.4, -4], [82.4, 5], [123.5, 3], [164.8, -6]] as const) {
      const o = this.osc('sawtooth', f, t); o.detune.value = d;
      this.lfo(this.r(0.01, 0.03), 6, o.detune, t);
      o.connect(lp);
    }
    // air
    const n = this.noise('brown', t);
    const bp = this.filt('bandpass', 170, 0.8);
    const ng = this.gain(0.09);
    n.connect(bp); bp.connect(ng); ng.connect(this.out);
    this.nextBowed = t + this.r(3, 9);
    this.nextPulse = t + this.r(15, 30);
  }
  schedule(until: number) {
    while (this.nextBowed < until) {
      const f = [82.4, 98, 110, 116.5, 123.5, 146.8][Math.floor(this.m.rnd() * 6)];
      this.hit('mus_bowed', this.nextBowed, this.r(0.25, 0.5), f / 220, this.r(-0.6, 0.6), 0.7);
      this.nextBowed += this.r(13, 32);
    }
    while (this.nextPulse < until) {
      this.hit('mus_pulse', this.nextPulse, 0.22, 0.9, 0, 0.4);
      this.nextPulse += this.r(18, 40);
    }
  }
}

// ─────────────────────────────────────────── tension

const CLUSTER = [1, 1.0595, 1.189, 1.414, 1.498, 2, 2.119, 2.245];

class Tension extends Layer {
  private nextSwell: number; private nextPulse: number; private nextTick: number; private tickPan = 0.4;
  constructor(m: Music, t: number) {
    super(m, t, 0.65, 2.5);
    const sub = this.drone('sine', E1, 0.18, t);
    this.lfo(0.11, 0.08, sub.g.gain, t);
    const n = this.noise('brown', t);
    const lp = this.filt('lowpass', 130);
    const ng = this.gain(0.12);
    n.connect(lp); lp.connect(ng); ng.connect(this.out);
    this.nextSwell = t;
    this.nextPulse = t + 0.8;
    this.nextTick = t + 1.5;
  }
  private swell(at: number) {
    if (at < this.m.lastNow - 0.08) return;
    const c = this.m.ctx;
    const len = this.r(9, 15);
    const root = [82.4, 87.3, 77.8, 92.5][Math.floor(this.m.rnd() * 4)];
    const lp = this.filt('lowpass', 300, 3);
    lp.frequency.setValueAtTime(260, at);
    lp.frequency.exponentialRampToValueAtTime(this.r(1100, 1800), at + len * 0.65);
    lp.frequency.exponentialRampToValueAtTime(320, at + len);
    const env = this.gain(0);
    env.gain.setValueAtTime(0, at);
    env.gain.setTargetAtTime(1, at, len * 0.22);
    env.gain.setTargetAtTime(0, at + len * 0.68, len * 0.09);
    lp.connect(env); env.connect(this.out);
    if (this.m.plate) { const sg = this.gain(0.25); env.connect(sg); sg.connect(this.m.plate); }
    const picks = [...CLUSTER].sort(() => this.m.rnd() - 0.5).slice(0, 4);
    for (const r of picks) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = root * r;
      o.detune.setValueAtTime(this.r(-12, 12), at);
      o.detune.linearRampToValueAtTime(this.r(40, 90), at + len); // the slow rise
      const g = this.gain(0.09);
      const p = c.createStereoPanner(); p.pan.value = this.r(-0.8, 0.8);
      o.connect(g); g.connect(p); p.connect(lp);
      this.hold(o, at, at + len + 0.5);
    }
  }
  schedule(until: number) {
    while (this.nextSwell < until) { this.swell(this.nextSwell); this.nextSwell += this.r(5, 9); }
    while (this.nextPulse < until) {
      this.hit('mus_pulse', this.nextPulse, 0.6, 1, 0, 0.2);
      if (this.m.rnd() < 0.3) this.hit('mus_pulse', this.nextPulse + 0.24, 0.35, 1.05, 0, 0.2);
      this.nextPulse += this.r(0.9, 2.6);
    }
    while (this.nextTick < until) {
      if (this.m.rnd() > 0.35) {
        this.tickPan = -this.tickPan;
        this.hit('mus_tick', this.nextTick, this.r(0.3, 0.5), this.r(0.95, 1.05), this.tickPan, 0.15);
        if (this.m.rnd() < 0.1) for (let k = 1; k < 3; k++) this.hit('mus_tick', this.nextTick + k * 0.09, 0.15, 1.1, this.tickPan, 0.1);
      }
      this.nextTick += 0.5;
    }
  }
}

// ─────────────────────────────────────────── combat

const BPM = 132;
const STEP = 60 / BPM / 4;
const KICKS = [
  [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
  [1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0],
];
// bass riffs: [step, semitones above E1, length in steps]
const RIFFS: Array<Array<[number, number, number]>> = [
  [[0, 12, 2], [3, 12, 1], [6, 12, 2], [8, 13, 2], [11, 12, 1], [14, 15, 2]],
  [[0, 12, 2], [2, 12, 1], [5, 12, 2], [8, 18, 3], [11, 17, 2], [14, 13, 2]],
  [[0, 0, 3], [3, 12, 1], [4, 0, 2], [6, 12, 1], [8, 1, 3], [11, 13, 1], [12, 0, 2], [14, 10, 2]],
  [[0, 12, 1], [1, 12, 1], [3, 12, 2], [6, 15, 2], [8, 13, 4], [12, 12, 2], [14, 6, 2]],
];

class Combat extends Layer {
  step = 0;
  stepT: number;
  private kick = KICKS[0];
  private riff = RIFFS[0];
  private readonly droneG: GainNode;
  private readonly bassBus: GainNode;
  constructor(m: Music, t: number) {
    super(m, t, 0.42, 0.25);
    this.stepT = t + 0.05;
    this.droneG = super.drone('sine', E1, 0.22, t).g;
    const n = this.noise('brown', t);
    const lp = this.filt('lowpass', 200);
    const ng = this.gain(0.08);
    n.connect(lp); lp.connect(ng); ng.connect(this.out);
    this.bassBus = this.gain(1);
    const sh = this.m.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 3) / Math.tanh(3); }
    sh.curve = curve;
    const post = this.filt('lowpass', 1600, 0.7);
    const bg = this.gain(0.55);
    this.bassBus.connect(sh); sh.connect(post); post.connect(bg); bg.connect(this.out);
  }
  private bass(at: number, semi: number, steps: number) {
    if (at < this.m.lastNow - 0.08) return;
    const c = this.m.ctx;
    const f = E1 * Math.pow(2, semi / 12);
    const dur = steps * STEP * 0.92;
    const lp = this.filt('lowpass', 1000, 6);
    lp.frequency.setValueAtTime(this.r(900, 1500), at);
    lp.frequency.setTargetAtTime(180, at + 0.004, 0.07);
    const env = this.gain(0);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.3, at + 0.004);
    env.gain.setTargetAtTime(0.22, at + 0.02, 0.05);
    env.gain.setTargetAtTime(0, at + dur, 0.025);
    lp.connect(env); env.connect(this.bassBus);
    for (const [type, mul, det, lv] of [['sawtooth', 1, -7, 0.5], ['sawtooth', 1, 7, 0.5], ['square', 0.5, 0, 0.35]] as const) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f * mul; o.detune.value = det;
      const g = this.gain(lv);
      o.connect(g); g.connect(lp);
      o.start(at); o.stop(at + dur + 0.25);
      o.onended = () => { o.disconnect(); g.disconnect(); lp.disconnect(); env.disconnect(); };
    }
  }

  schedule(until: number) {
    while (this.stepT < until) {
      const t = this.stepT, n = this.step, s = n % 16, bar = Math.floor(n / 16), pb = bar % 8;
      if (s === 0) {
        this.kick = pb === 7 ? KICKS[2] : KICKS[Math.floor(this.m.rnd() * 4)];
        if (pb % 2 === 0) this.riff = RIFFS[Math.floor(this.m.rnd() * RIFFS.length)];
        if (pb === 0) this.hit('mus_boom', t, 0.7, 1, 0, 0.5);
        if (pb === 5) this.hit('mus_riser', t + 3 * 16 * STEP - 4.0, 0.55, 1, 0, 0.4);
      }
      if (this.kick[s]) {
        this.hit('mus_kick', t, 0.95, 1, 0, 0.05);
        const g = this.droneG.gain; // sidechain pump
        g.setTargetAtTime(0.05, t, 0.005);
        g.setTargetAtTime(0.22, t + 0.03, 0.09);
      }
      const intense = pb >= 4;
      if (s === 8 || (intense && s === 12 && this.m.rnd() < 0.6)) this.hit('mus_snare', t, 0.75, this.r(0.95, 1.05), this.r(-0.15, 0.15), 0.4);
      if (pb === 7 && s >= 12) this.hit('mus_snare', t, 0.35 + (s - 12) * 0.12, 1.1, 0, 0.3);
      if (this.m.rnd() < 0.78) this.hit('mus_hat', t, s % 2 ? 0.55 : 0.3, this.r(0.95, 1.1), this.r(-0.5, 0.5), 0);
      if (s % 4 !== 0 && this.m.rnd() < 0.13) this.hit('mus_metal', t, this.r(0.25, 0.45), this.r(0.6, 1.3), this.r(-0.8, 0.8), 0.4);
      for (const [st, semi, len] of this.riff) if (st === s) this.bass(t, semi, len);
      this.step++;
      this.stepT += STEP;
    }
  }
}

// ─────────────────────────────────────────── the boss layer (stage 3d §8.12)

/**
 * The dock loader's layer over `combat` (from `boss:stage`): a low ostinato on combat's own 16th grid, rising per stage —
 * stage 1 E (8ths, E E E F), stage 2 F (8ths + 16th pickups, an octave double), stage 3 G (driving 16ths, the octave,
 * a high tremolo cluster). Each stage enters on the next bar line with a `mus_boom`.
 */
const BOSS_PAT: Array<Array<number | null>> = [
  // semitones over the stage root, per 16th (null = rest)
  [0, null, 0, null, 0, null, 1, null, 0, null, 0, null, 0, null, 1, null],
  [0, null, 0, 0, 12, null, 1, null, 0, null, 0, 0, 13, null, 1, 3],
  [0, 0, 12, 0, 0, 1, 0, 13, 0, 0, 12, 0, 3, 1, 0, 1],
];
const BOSS_ROOT = [0, 1, 3];

class Boss extends Layer {
  private stepT: number;
  private step = 0;
  private readonly bus: GainNode;
  constructor(m: Music, t: number, readonly stage: number, grid: { stepT: number; step: number } | null) {
    super(m, t, [0.42, 0.5, 0.58][stage - 1] ?? 0.5, 0.4);
    // align to the combat layer's next bar line
    if (grid) {
      let st = grid.stepT, n = grid.step;
      while (st < t + 0.02 || n % 16 !== 0) { st += STEP; n++; }
      this.stepT = st; this.step = 0;
    } else this.stepT = t + 0.05;
    this.bus = this.gain(1);
    const sh = m.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
    sh.curve = curve;
    const lp = this.filt('lowpass', 700 + 250 * stage, 0.8);
    this.bus.connect(sh); sh.connect(lp); lp.connect(this.out);
    if (this.m.plate) { const sg = this.gain(0.12); lp.connect(sg); sg.connect(this.m.plate); }
    if (stage >= 3) {
      // the high tremolo cluster: E5 / F5 / A#5 saws, a 16th gate, quiet
      const hp = this.filt('bandpass', 1400, 0.7);
      const trem = this.gain(0.0);
      const lfo = this.osc('square', 1 / (STEP * 2), t); const lg = this.gain(0.018); lfo.connect(lg); lg.connect(trem.gain);
      trem.gain.setValueAtTime(0.02, t);
      hp.connect(trem); trem.connect(this.out);
      for (const f of [659.3, 698.5, 932.3]) { const o = this.osc('sawtooth', f, t); o.detune.value = this.r(-8, 8); o.connect(hp); }
    }
  }
  private note(at: number, semi: number, steps: number) {
    if (at < this.m.lastNow - 0.08) return;
    const c = this.m.ctx;
    const f = E1 * 2 * Math.pow(2, (BOSS_ROOT[this.stage - 1] + semi) / 12);
    const dur = steps * STEP * 0.85;
    const env = this.gain(0);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.32, at + 0.006);
    env.gain.setTargetAtTime(0.18, at + 0.02, 0.06);
    env.gain.setTargetAtTime(0, at + dur, 0.03);
    env.connect(this.bus);
    const parts: Array<[OscillatorType, number, number, number]> = [['sawtooth', 1, -6, 0.5], ['sawtooth', 1, 6, 0.5], ['sine', 0.5, 0, 0.6]];
    if (this.stage >= 2) parts.push(['square', 2, 0, 0.12]);
    parts.forEach(([type, mul, det, lv], i) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f * mul; o.detune.value = det;
      const g = this.gain(lv);
      o.connect(g); g.connect(env);
      o.start(at); o.stop(at + dur + 0.2);
      o.onended = () => { o.disconnect(); g.disconnect(); if (i === 0) env.disconnect(); };
    });
  }
  schedule(until: number) {
    while (this.stepT < until) {
      const t = this.stepT, n = this.step, s = n % 16;
      if (n === 0) this.hit('mus_boom', t, 0.5 + 0.1 * this.stage, 0.9 - 0.05 * this.stage, 0, 0.5);
      const pat = BOSS_PAT[this.stage - 1] ?? BOSS_PAT[0];
      const v = pat[s];
      if (v !== null) {
        let len = 1; while (len < 4 && pat[(s + len) % 16] === null && s + len < 16) len++;
        this.note(t, v, len);
      }
      if (this.stage >= 2 && s === 12 && Math.floor(n / 16) % 4 === 3) this.hit('mus_metal', t, 0.35, 0.5, 0, 0.5);
      this.step++;
      this.stepT += STEP;
    }
  }
}

// ─────────────────────────────────────────── aftermath

class Aftermath extends Layer {
  private nextBell: number; private bellVol = 0.45;
  constructor(m: Music, t: number) {
    super(m, t, 0.55, 2);
    this.drone('sine', 82.4, 0.05, t);
    this.drone('sine', 82.9, 0.05, t);
    const sub = this.drone('sine', E1, 0.2, t);
    sub.g.gain.setValueAtTime(0.2, t);
    sub.g.gain.setTargetAtTime(0.05, t + 5, 25);
    const n = this.noise('brown', t);
    const bp = this.filt('bandpass', 300, 1.5);
    this.lfo(0.03, 120, bp.frequency, t);
    const ng = this.gain(0.07);
    n.connect(bp); bp.connect(ng); ng.connect(this.out);
    this.nextBell = t + 0.4;
  }
  schedule(until: number) {
    while (this.nextBell < until) {
      const rate = [0.75, 0.5, 0.667, 0.561][Math.floor(this.m.rnd() * 4)];
      this.hit('mus_bell', this.nextBell, this.bellVol, rate, this.r(-0.5, 0.5), 0.9);
      this.bellVol = Math.max(0.15, this.bellVol * 0.85);
      if (this.m.rnd() < 0.3) this.hit('mus_bowed', this.nextBell + 2, 0.2, 0.375, this.r(-0.5, 0.5), 0.8);
      this.nextBell += this.r(7, 14);
    }
  }
}

// ─────────────────────────────────────────── menu

class Menu extends Layer {
  private nextBowed: number;
  constructor(m: Music, t: number) {
    super(m, t, 0.8, 3);
    this.drone('sine', E1, 0.25, t);
    const pad = this.gain(0.0);
    this.lfo(0.045, 0.035, pad.gain, t);
    pad.gain.setValueAtTime(0.05, t);
    const lp = this.filt('lowpass', 1800);
    lp.connect(pad); pad.connect(this.out);
    if (this.m.plate) { const sg = this.gain(0.5); pad.connect(sg); sg.connect(this.m.plate); }
    const formants = [[570, 6, 1], [840, 8, 0.6], [2400, 10, 0.2]] as const;
    const fb = formants.map(([f, q, a]) => { const b = this.filt('bandpass', f, q); const g = this.gain(a * 3); b.connect(g); g.connect(lp); return b; });
    for (const [f, d] of [[82.4, -3], [123.5, 4], [164.8, -5], [82.4, 6]] as const) {
      const o = this.osc('sawtooth', f, t); o.detune.value = d;
      this.lfo(this.r(0.05, 0.1), 5, o.detune, t);
      for (const b of fb) o.connect(b);
    }
    this.nextBowed = t + 4;
  }
  schedule(until: number) {
    while (this.nextBowed < until) {
      this.hit('mus_bowed', this.nextBowed, 0.3, [0.375, 0.5, 0.561][Math.floor(this.m.rnd() * 3)], this.r(-0.5, 0.5), 0.8);
      this.nextBowed += this.r(12, 24);
    }
  }
}

export class Music {
  mode: MusicMode = 'silence';
  private layers: Layer[] = [];
  /** Stage 3d: the boss stage (0 = no boss layer); played over `combat` only. */
  bossStage = 0;
  private boss: Boss | null = null;
  rnd: () => number = Math.random;
  lastNow = 0;
  constructor(readonly ctx: BaseAudioContext, readonly out: AudioNode, readonly plate: AudioNode | null, readonly buf: BufGetter) {}

  set(mode: MusicMode, at = this.ctx.currentTime): void {
    if (mode === this.mode) return;
    this.lastNow = Math.max(this.lastNow, at);
    const prev = this.mode;
    this.mode = mode;
    const outTau = mode === 'combat' ? 0.5 : prev === 'combat' ? 1.0 : mode === 'silence' ? 1.5 : 2.0;
    for (const l of this.layers) l.kill(at, outTau);
    // hard cap on overlapping dying layers
    this.layers = this.layers.filter((l) => !l.dead);
    let layer: Layer | null = null;
    switch (mode) {
      case 'ambient': layer = new Ambient(this, at); break;
      case 'tension': layer = new Tension(this, at); break;
      case 'combat': layer = new Combat(this, at); break;
      case 'aftermath': layer = new Aftermath(this, at); break;
      case 'menu': layer = new Menu(this, at); break;
      case 'silence': break;
    }
    if (layer) { this.layers.push(layer); layer.schedule(at + LOOKAHEAD); }
    this.boss = null;
    this.refreshBoss(at);
  }

  /** Stage 3d (`boss:stage`): the boss layer's stage, 0 = off. Takes effect at once while `combat` plays. */
  setBoss(stage: number, at = this.ctx.currentTime): void {
    stage = Math.max(0, Math.min(3, Math.floor(stage) || 0));
    if (stage === this.bossStage) return;
    this.bossStage = stage;
    this.lastNow = Math.max(this.lastNow, at);
    this.refreshBoss(at);
  }

  private refreshBoss(at: number): void {
    const want = this.mode === 'combat' ? this.bossStage : 0;
    if (this.boss && !this.boss.dead && this.boss.stage === want) return;
    if (this.boss) { this.boss.kill(at, want ? 0.35 : 0.8); this.boss = null; }
    this.layers = this.layers.filter((l) => !l.dead);
    if (!want) return;
    const combat = this.layers.find((l): l is Combat => l instanceof Combat && !l.dead) ?? null;
    this.boss = new Boss(this, at, want, combat);
    this.layers.push(this.boss);
    this.boss.schedule(at + LOOKAHEAD);
  }

  tick(now = this.ctx.currentTime): void {
    this.lastNow = now;
    for (const l of this.layers) if (!l.dead) l.schedule(now + LOOKAHEAD);
  }
}
