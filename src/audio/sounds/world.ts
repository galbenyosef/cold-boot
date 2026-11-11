import { crackleData, type SoundDef, type Synth } from '../synth/core';
import { saturate, stutter, decimate } from '../synth/post';
import { clack, scrape } from './weapons';

/** Heavy structural clunk (doors, breakers, bolts). */
export function clunk(s: Synth, t: number, f0: number, level: number, ring = 0.25, dst?: AudioNode): void {
  s.thump(t, f0 * 1.2, f0 * 0.5, 0.06, 0.07, level, dst);
  s.burst({ start: t, color: 'pink', type: 'lowpass', f: 1400, Q: 0.7, a: 0.001, tau: 0.03, level: level * 0.6, dst });
  s.modal({ start: t, level: level * 0.35, modes: s.modes(f0 * 1.9, [1, 2.31, 3.9, 5.6, 8.2], [ring, ring * 0.8, ring * 0.6, ring * 0.4, ring * 0.25], [1, 0.7, 0.5, 0.35, 0.2], 0.04), dst });
  s.click(t, level * 0.3, 2500, 0.002, dst);
}

/** Electric motor / servo whine segment. */
export function servo(s: Synth, t: number, dur: number, f0: number, f1: number, level: number, dst?: AudioNode): void {
  const o = s.osc('sawtooth', f0, t, dur + 0.1);
  s.env(o.frequency, [[t, f0], [t + dur * 0.25, (f0 + f1) * 0.5], [t + dur, f1]], 'exp');
  const o2 = s.osc('square', f0 * 0.5, t, dur + 0.1);
  s.env(o2.frequency, [[t, f0 * 0.5], [t + dur, f1 * 0.5]], 'exp');
  const g = s.gain(0);
  s.env(g.gain, [[t, 0], [t + Math.min(0.06, dur * 0.2), level], [t + dur * 0.85, level * 0.8], [t + dur, 0]]);
  const g2 = s.gain(0.25);
  const f = s.bp(f0 * 4, 1.2);
  s.env(f.frequency, [[t, f0 * 4], [t + dur, f1 * 4]], 'exp');
  o.connect(f); o2.connect(g2); g2.connect(f);
  // gear chatter AM
  const am = s.osc('square', s.r(28, 45), t, dur + 0.1);
  const amg = s.gain(0.25);
  const mix = s.gain(0.75);
  am.connect(amg); amg.connect(mix.gain);
  s.chain(f, mix, g, dst ?? s.out);
}

/** Pneumatic hiss. */
export function hiss(s: Synth, t: number, dur: number, level: number, f = 3500, dst?: AudioNode): void {
  const n = s.noise('white', t, dur + 0.1);
  const h = s.hp(1400);
  const b = s.bp(f, 0.6);
  s.env(b.frequency, [[t, f * 1.3], [t + dur, f * 0.6]], 'exp');
  const g = s.gain(0);
  s.env(g.gain, [[t, 0], [t + 0.02, level], [t + dur * 0.3, level * 0.7], [t + dur, 0]]);
  s.chain(n, h, b, g, dst ?? s.out);
}

/** Electrical crackle burst. */
export function crackle(s: Synth, t: number, dur: number, density: number, level: number, f = 3200, dst?: AudioNode): void {
  const d = crackleData(dur, density, s.rnd, { burst: 0.4, env: (x) => Math.max(0, 1 - x / dur) });
  const src = s.data(d, t);
  const g = s.gain(level);
  s.chain(src, s.hp(f * 0.4), s.pk(f, 1, 6), g, dst ?? s.out);
}

/** Mains hum with harmonics through a buzz shaper. */
function hum(s: Synth, t: number, dur: number, f: number, level: number, env: Array<[number, number]>, pitch?: Array<[number, number]>, dst?: AudioNode): void {
  const bus = s.gain(0);
  s.env(bus.gain, env.map(([a, b]) => [t + a, b * level] as [number, number]));
  const sh = s.shaper('tanh', 2.2);
  const lp = s.lp(1800);
  s.chain(sh, lp, bus, dst ?? s.out);
  for (const [h, a] of [[1, 1], [2, 0.6], [3, 0.35], [4, 0.2], [6, 0.12]] as const) {
    const o = s.osc('sine', f * h, t, dur);
    if (pitch) s.env(o.frequency, pitch.map(([a2, b]) => [t + a2, b * h] as [number, number]), 'exp');
    const g = s.gain(a * 0.5);
    s.chain(o, g, sh);
  }
}

/** Turbine whine sweep. */
function whine(s: Synth, t: number, dur: number, f0: number, f1: number, level: number, env: Array<[number, number]>, dst?: AudioNode): void {
  const bus = s.gain(0);
  s.env(bus.gain, env.map(([a, b]) => [t + a, b * level] as [number, number]));
  bus.connect(dst ?? s.out);
  for (const [h, a, type] of [[1, 1, 'sine'], [2.01, 0.3, 'triangle'], [3.02, 0.15, 'sine'], [0.5, 0.4, 'sawtooth']] as const) {
    const o = s.osc(type, f0 * h, t, dur);
    s.env(o.frequency, [[t, f0 * h], [t + dur, f1 * h]], 'exp');
    const g = s.gain(a * (type === 'sawtooth' ? 0.15 : 0.4));
    if (type === 'sawtooth') s.chain(o, s.lp(800), g, bus); else s.chain(o, g, bus);
  }
  const n = s.noise('pink', t, dur);
  const nb = s.bp(f0 * 2, 3);
  s.env(nb.frequency, [[t, f0 * 2], [t + dur, f1 * 2]], 'exp');
  const ng = s.gain(0.35);
  s.chain(n, nb, ng, bus);
}

export const worldSounds: SoundDef[] = [
  {
    id: 'door_open', variants: 2, dur: 2.0, vol: 0.6, ref: 3, maxVoices: 3, send: 1.0, when: 'load',
    render(s) {
      clunk(s, 0, s.r(85, 100), 0.8, 0.2);
      clack(s, 0.03, 1400, 0.3, 0.03);
      hiss(s, 0.06, s.r(0.45, 0.6), 0.55, s.r(3000, 4200));
      servo(s, 0.12, 1.15, s.r(130, 150), s.r(200, 230), 0.22);
      s.burst({ start: 0.12, color: 'brown', type: 'lowpass', f: 260, Q: 0.8, a: 0.1, hold: 0.9, tau: 0.08, level: 0.4 });
      clunk(s, 1.3, s.r(70, 85), 0.6, 0.18);
    },
  },
  {
    id: 'door_close', variants: 2, dur: 2.2, vol: 0.6, ref: 3, maxVoices: 3, send: 1.0, when: 'load',
    render(s) {
      clack(s, 0, 1600, 0.25, 0.02);
      servo(s, 0.03, 0.95, s.r(210, 235), s.r(140, 160), 0.22);
      s.burst({ start: 0.03, color: 'brown', type: 'lowpass', f: 260, Q: 0.8, a: 0.1, hold: 0.75, tau: 0.08, level: 0.4 });
      hiss(s, 0.85, 0.35, 0.35, 2600);
      const t = 1.05;
      s.thump(t, 80, 34, 0.1, 0.12, 1.0);
      s.burst({ start: t, color: 'pink', type: 'lowpass', f: 900, Q: 0.7, a: 0.001, tau: 0.06, level: 0.7 });
      s.modal({ start: t, level: 0.45, modes: s.modes(s.r(105, 120), [1, 2.36, 4.2, 6.3, 9.6, 13.1], [0.5, 0.42, 0.33, 0.25, 0.18, 0.12], [1, 0.8, 0.6, 0.45, 0.3, 0.2], 0.03) });
      clack(s, t + 0.09, 1100, 0.4, 0.04);
    },
  },
  {
    id: 'door_unlock', variants: 1, dur: 1.0, vol: 0.5, ref: 3,
    render(s) {
      servo(s, 0, 0.22, 320, 420, 0.15);
      clunk(s, 0.22, 120, 0.55, 0.12);
      clack(s, 0.3, 1800, 0.35, 0.02);
      for (const [t, f] of [[0.42, 988], [0.5, 1319]] as const) {
        const g = s.ad(t, 0.003, 0.1, 0.03, 0.04);
        s.chain(s.osc('square', f, t, 0.1), s.lp(3500), g, s.out);
      }
    },
  },
  {
    id: 'denied', variants: 1, dur: 0.6, vol: 0.4, ref: 3, maxVoices: 1, minInterval: 0.4, when: 'load',
    render(s) {
      clack(s, 0, 2200, 0.25, 0.01);
      const sh = s.shaper('hard', 3);
      const out = s.gain(0.35);
      s.chain(sh, s.bp(700, 0.7), s.lp(2500), out, s.out);
      for (const t of [0.02, 0.27]) {
        const g = s.gain(0);
        s.env(g.gain, [[t, 0], [t + 0.005, 1], [t + 0.17, 1], [t + 0.18, 0]]);
        s.chain(s.osc('square', 110, t, 0.2), g, sh);
        const g2 = s.gain(0);
        s.env(g2.gain, [[t, 0], [t + 0.005, 0.6], [t + 0.17, 0.6], [t + 0.18, 0]]);
        s.chain(s.osc('sawtooth', 166, t, 0.2), g2, sh);
      }
    },
  },
  {
    id: 'lever', variants: 1, dur: 3.0, vol: 0.85, ref: 4, send: 1.2, when: 'idle',
    render(s) {
      scrape(s, 0, 0.12, 1500, 0.15);
      // friction squeal of the throw
      const sq = s.osc('sawtooth', 620, 0.1, 0.25);
      s.env(sq.frequency, [[0.1, 620], [0.3, 410]], 'exp');
      const sg = s.gain(0);
      s.env(sg.gain, [[0.1, 0], [0.15, 0.05], [0.3, 0]]);
      s.chain(sq, s.bp(1800, 3), sg, s.out);
      // the massive clack
      const t = 0.32;
      s.thump(t, 90, 32, 0.12, 0.16, 1.2);
      s.burst({ start: t, color: 'pink', type: 'lowpass', f: 2200, Q: 0.7, a: 0.0006, tau: 0.04, level: 0.9 });
      s.modal({ start: t, level: 0.55, modes: s.modes(95, [1, 2.4, 4.3, 6.7, 10.3, 15.8], [0.8, 0.6, 0.45, 0.32, 0.22, 0.15], [1, 0.8, 0.6, 0.45, 0.3, 0.2], 0.03) });
      clack(s, t, 1200, 0.6, 0.05);
      // arcing contacts
      crackle(s, t + 0.01, 0.28, 900, 0.5);
      // hum surge
      hum(s, t + 0.05, 2.6, 46, 0.55, [[0, 0], [0.25, 1], [0.9, 0.55], [2.5, 0]], [[0, 44], [0.6, 50]]);
    },
  },
  {
    id: 'button', variants: 2, dur: 0.35, vol: 0.4, when: 'load',
    render(s) {
      clack(s, 0, s.r(1700, 2000), 0.5, 0.01);
      s.thump(0, 420, 200, 0.012, 0.01, 0.35);
      clack(s, 0.05, 1300, 0.3, 0.012);
      const g = s.ad(0.08, 0.002, 0.08, 0.025, 0.04);
      s.chain(s.osc('square', 1175, 0.08, 0.15), s.lp(3000), g, s.out);
    },
  },
  {
    id: 'terminal_beep', variants: 3, dur: 0.35, vol: 0.18, maxVoices: 2, minInterval: 0.05, when: 'load',
    render(s, v) {
      const pat = [[[0, 880, 0.07], [0.09, 1320, 0.09]], [[0, 1320, 0.06], [0.08, 990, 0.1]], [[0, 1047, 0.05], [0.07, 1047, 0.05], [0.14, 1568, 0.08]]][v];
      const sp = s.gain(1);
      s.chain(sp, s.shaper('tanh', 1.6), s.hp(400), s.lp(4500), s.out);
      for (const [t, f, d] of pat) {
        const g = s.gain(0);
        s.env(g.gain, [[t, 0], [t + 0.003, 0.4], [t + d, 0.35], [t + d + 0.006, 0]]);
        s.chain(s.osc('square', f, t, d + 0.02), g, sp);
      }
    },
  },
  {
    id: 'power_down', variants: 1, dur: 5.5, vol: 0.9, bus: 'sfx', ref: 6, send: 1.3, peak: 0.85, when: 'idle', priority: 4,
    render(s) {
      clunk(s, 0, 75, 1.0, 0.3);
      crackle(s, 0.01, 0.35, 1400, 0.6);
      whine(s, 0, 4.5, 880, 55, 0.5, [[0, 0.8], [0.4, 1], [3.0, 0.5], [4.5, 0]]);
      hum(s, 0, 4, 50, 0.45, [[0, 1], [0.3, 0.8], [3.4, 0]], [[0, 50], [3.4, 32]]);
      const relays = [0.45, 0.9, 1.3, 1.75, 2.4, 3.1];
      for (const t of relays) {
        const tt = t * s.r(0.92, 1.08);
        clunk(s, tt, s.r(110, 180), s.r(0.25, 0.45), 0.15);
        clack(s, tt, s.r(1200, 1800), 0.25, 0.03);
      }
      clunk(s, 3.7, 55, 0.6, 0.4);
    },
  },
  {
    id: 'power_up', variants: 1, dur: 6.0, vol: 0.9, ref: 6, send: 1.3, peak: 0.85, when: 'idle', priority: 4,
    render(s) {
      for (const t of [0, 0.42, 0.95, 1.55]) {
        clunk(s, t, s.r(70, 90), 1.0, 0.35);
        clack(s, t, s.r(900, 1300), 0.5, 0.05);
        crackle(s, t + 0.005, 0.15, 1500, 0.4);
      }
      whine(s, 0.3, 5.4, 50, 720, 0.45, [[0, 0], [1.2, 0.6], [3.5, 1], [5.4, 0.0]]);
      hum(s, 0.6, 5.3, 50, 0.6, [[0, 0], [1.5, 0.6], [3.4, 1], [5.2, 0]], [[0, 38], [2.5, 50]]);
      // the lights-on thoom
      s.thump(3.8, 70, 30, 0.4, 0.5, 1.0);
      s.burst({ start: 3.8, color: 'brown', type: 'lowpass', f: 500, Q: 0.7, a: 0.05, tau: 0.5, level: 0.6 });
      crackle(s, 3.8, 0.5, 600, 0.35, 2500);
    },
  },
  {
    id: 'alarm_blip', variants: 1, dur: 0.7, vol: 0.25, ref: 5, maxVoices: 3, send: 1.2,
    render(s) {
      const sh = s.shaper('tanh', 2);
      s.chain(sh, s.bp(1100, 0.8), s.out);
      for (const [t, f] of [[0, 660], [0.16, 880]] as const) {
        const g = s.gain(0);
        s.env(g.gain, [[t, 0], [t + 0.004, 0.6], [t + 0.14, 0.5], [t + 0.15, 0]]);
        s.chain(s.osc('square', f, t, 0.16), g, sh);
      }
    },
  },
  {
    id: 'metal_groan', variants: 3, dur: 5.0, vol: 0.6, ref: 8, rolloff: 0.8, send: 1.5, maxVoices: 2, when: 'idle', pitchVar: 0.12,
    render(s) {
      const len = s.r(3.5, 4.8);
      const out = s.gain(0);
      s.env(out.gain, [[0, 0], [len * 0.25, 1], [len * 0.7, 0.8], [len, 0]]);
      out.connect(s.out);
      // stick-slip creak excitation: pulse train sweeping 6 → 22 Hz
      const exc = s.osc('sawtooth', s.r(6, 9), 0, len + 0.1);
      s.env(exc.frequency, [[0, s.r(5, 8)], [len * 0.4, s.r(14, 24)], [len, s.r(7, 12)]], 'exp');
      const excG = s.gain(0.5);
      exc.connect(excG);
      const n = s.noise('brown', 0, len + 0.1);
      const nG = s.gain(1.2);
      n.connect(nG);
      // pitch-bending resonances
      const base = s.r(70, 110);
      for (const [r, q, a] of [[1, 35, 1], [1.53, 40, 0.7], [2.37, 45, 0.5], [3.61, 50, 0.35], [5.2, 60, 0.2]] as const) {
        const f = s.bp(base * r, q);
        const bend = s.r(-0.12, 0.08);
        s.env(f.frequency, [[0, base * r], [len * 0.5, base * r * (1 + bend)], [len, base * r * (1 + bend * 1.6)]], 'exp');
        const g = s.gain(a * 4);
        excG.connect(f); nG.connect(f);
        s.chain(f, g, out);
      }
      // sub rumble
      s.chain(s.noise('brown', 0, len), s.lp(60), s.gain(1.5), out);
      // a high stress ping near the peak
      if (s.chance(0.7)) s.modal({ start: len * s.r(0.3, 0.6), level: 0.08, modes: s.modes(s.r(900, 1400), [1, 2.7, 4.1], [0.6, 0.4, 0.25]) });
    },
  },
  {
    id: 'vent_scuttle', variants: 3, dur: 3.0, vol: 0.7, ref: 3, send: 1.0, maxVoices: 2, when: 'idle',
    render(s) {
      const duct = s.gain(1);
      s.chain(duct, s.pk(s.r(550, 750), 2, 8), s.lp(3500), s.out);
      let t = 0.02;
      const end = s.r(2.4, 2.9);
      while (t < end) {
        // gallop groups of 3-6 taps
        const n = s.ri(3, 6);
        for (let i = 0; i < n && t < end; i++) {
          const env = Math.sin((t / end) * Math.PI);
          const lv = (0.4 + 0.6 * env) * s.r(0.5, 1);
          s.modal({ start: t, level: lv * 0.5, modes: s.modes(s.r(280, 340), [1, 2.4, 4.17, 7.0], [0.05, 0.035, 0.025, 0.015], [1, 0.7, 0.5, 0.3], 0.05), dst: duct });
          s.click(t, lv * 0.3, 2500, 0.0012, duct);
          t += s.r(0.035, 0.06);
        }
        t += s.r(0.03, 0.2);
      }
      // body drag rumble
      const n = s.noise('brown', 0, end);
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [end * 0.5, 0.5], [end, 0]]);
      s.chain(n, s.lp(300), g, duct);
    },
  },
  {
    id: 'glitch', variants: 4, dur: 0.7, vol: 0.3, maxVoices: 2, minInterval: 0.1, when: 'load', pitchVar: 0,
    render(s) {
      const len = s.r(0.35, 0.65);
      const d = new Float32Array(Math.floor(len * 44100));
      let i = 0;
      while (i < d.length) {
        const seg = Math.floor(s.r(0.004, 0.04) * 44100);
        const kind = s.ri(0, 4);
        const f = s.r(80, 3000), a = s.r(0.3, 1);
        const q = s.ri(2, 6);
        let hold = 0;
        for (let k = 0; k < seg && i < d.length; k++, i++) {
          const t = k / 44100;
          let x = 0;
          if (kind === 0) x = Math.sign(Math.sin(2 * Math.PI * f * t)) * a;
          else if (kind === 1) { if (k % q === 0) hold = (s.rnd() * 2 - 1) * a; x = hold; }
          else if (kind === 2) x = 0;
          else if (kind === 3) x = Math.sin(2 * Math.PI * (f + 4000 * t) * t) * a;
          else x = (((f * t) % 1) * 2 - 1) * a;
          d[i] = Math.round(x * 6) / 6;
        }
      }
      s.chain(s.data(d, 0), s.hp(120), s.out);
    },
  },
  {
    id: 'steam_burst', variants: 2, dur: 2.0, vol: 0.6, ref: 3, send: 1.0, when: 'idle',
    render(s) {
      clack(s, 0, 900, 0.3, 0.05);
      s.burst({ start: 0, color: 'brown', type: 'lowpass', f: 300, Q: 0.7, a: 0.005, tau: 0.08, level: 0.6 });
      const len = s.r(1.2, 1.7);
      const n = s.noise('white', 0, len + 0.2);
      const b = s.bp(3500, 0.5);
      s.env(b.frequency, [[0, 5000], [len, 2200]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.02, 1], [0.3, 0.7], [len, 0]]);
      // sputter
      const am = s.noise('brown', 0, len + 0.2, 0.1);
      const amg = s.gain(0.6);
      am.connect(amg); amg.connect(g.gain);
      s.chain(n, s.hp(700), b, g, s.out);
    },
  },
  {
    id: 'spark_zap', variants: 4, dur: 0.7, vol: 0.55, ref: 2.5, maxVoices: 3, minInterval: 0.05, send: 0.8, when: 'load',
    render(s) {
      s.click(0, 1, 2000, 0.002);
      crackle(s, 0, s.r(0.15, 0.4), s.r(600, 1500), 0.8, s.r(2500, 4500));
      const len = s.r(0.08, 0.2);
      const o = s.osc('sawtooth', s.r(100, 130), 0, len);
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.003, 0.5], [len, 0]]);
      const am = s.noise('white', 0, len);
      const amg = s.gain(0.5);
      am.connect(amg); amg.connect(g.gain);
      s.chain(o, s.shaper('hard', 4), s.bp(1800, 0.7), g, s.out);
    },
  },
  {
    id: 'body_fall', variants: 3, dur: 1.3, vol: 0.7, ref: 3, send: 1.0, when: 'idle',
    render(s) {
      s.thump(0, 85, 38, 0.08, 0.09, 1.0);
      s.burst({ color: 'pink', type: 'lowpass', f: 500, Q: 0.7, a: 0.002, tau: 0.06, level: 0.8 });
      const t2 = s.r(0.14, 0.26);
      s.thump(t2, 95, 45, 0.05, 0.06, 0.55);
      s.burst({ start: t2, color: 'pink', type: 'lowpass', f: 700, Q: 0.7, a: 0.002, tau: 0.04, level: 0.4 });
      for (let i = 0; i < s.ri(3, 6); i++) s.modal({ start: s.r(0.01, 0.4), level: s.r(0.08, 0.2), modes: s.modes(s.r(500, 2200), [1, 2.6, 4.7], [0.08, 0.05, 0.03]) });
    },
  },
  {
    id: 'metal_clang', variants: 4, dur: 2.5, vol: 0.7, ref: 4, send: 1.3, maxVoices: 3, when: 'idle', pitchVar: 0.1,
    render(s) {
      const f0 = s.r(180, 380);
      s.modal({ level: 0.7, modes: s.modes(f0, [1, 2.32, 4.25, 6.63, 9.38, 12.8], [1.3, 0.9, 0.6, 0.4, 0.25, 0.15], [1, 0.8, 0.6, 0.45, 0.3, 0.2], 0.02) });
      s.burst({ color: 'white', type: 'bandpass', f: 3000, Q: 0.7, a: 0.0003, tau: 0.01, level: 0.5 });
      s.thump(0, 140, 60, 0.04, 0.05, 0.6);
    },
  },
  {
    id: 'sting', variants: 3, dur: 4.6, vol: 0.85, bus: 'music', priority: 4, maxVoices: 2, pitchVar: 0, send: 1.5, when: 'idle', channels: 2,
    render(s, v) {
      const hit = 0.55;
      const root = [73.4, 69.3, 77.8][v];
      const cluster = [1, 1.0595, 1.5, 1.587, 2.0, 2.828, 4.24];
      // reversed swell (rendered forward as rising noise + cluster)
      const sw = s.gain(0);
      s.env(sw.gain, [[0, 0.0001], [hit - 0.01, 0.9], [hit, 0]], 'exp');
      sw.connect(s.out);
      s.chain(s.noise('white', 0, hit), s.hp(800), s.pan(-0.3), sw);
      for (const r of cluster.slice(2)) s.chain(s.osc('sawtooth', root * r * 2, 0, hit), s.lp(3000), s.gain(0.08), sw);
      // the hit
      const H = s.gain(0);
      s.env(H.gain, [[hit, 0], [hit + 0.008, 1], [hit + 0.6, 0.45], [hit + 3.9, 0]]);
      H.connect(s.out);
      cluster.forEach((r, i) => {
        const o = s.osc(i % 2 ? 'sawtooth' : 'triangle', root * r * (1 + s.r(-0.004, 0.004)), hit, 4);
        const lpF = s.lp(4000, 2);
        s.env(lpF.frequency, [[hit, 5000], [hit + 2.5, 400]], 'exp');
        s.chain(o, lpF, s.pan(s.r(-0.7, 0.7)), s.gain(0.12), H);
      });
      s.thump(hit, 80, 28, 0.3, 0.5, 1.1);
      s.burst({ start: hit, color: 'brown', type: 'lowpass', f: 400, Q: 0.7, a: 0.004, tau: 0.6, level: 0.5 });
      // metallic scrape on top
      const sc = s.noise('white', hit, 3);
      const b1 = s.bp(s.r(2000, 3200), 25);
      const scg = s.gain(0);
      s.env(scg.gain, [[hit, 0], [hit + 0.05, 0.6], [hit + 2.5, 0]]);
      s.chain(sc, b1, scg, s.out);
    },
  },
  {
    id: 'explosion', variants: 2, dur: 3.5, vol: 1.0, ref: 10, rolloff: 0.7, send: 1.5, priority: 4, when: 'lazy',
    render(s) {
      const d = s.gain(1);
      s.chain(d, s.shaper('tanh', 3), s.out);
      s.click(0, 1, 800, 0.003);
      s.thump(0, 90, 24, 0.4, 0.5, 1.4, d);
      s.burst({ color: 'brown', type: 'lowpass', f: 1800, f1: 160, sweep: 1.5, Q: 0.7, a: 0.003, tau: 0.6, level: 1.2, dst: d });
      s.burst({ color: 'white', type: 'bandpass', f: 1500, Q: 0.5, a: 0.001, tau: 0.08, level: 0.8 });
      for (let i = 0; i < 12; i++) s.modal({ start: s.r(0.2, 1.8), level: s.r(0.05, 0.2), modes: s.modes(s.r(400, 3000), [1, 2.6, 4.9], [0.1, 0.06, 0.03]) });
    },
  },
  // ── bullet impacts
  {
    id: 'impact_metal', variants: 6, dur: 0.5, vol: 0.45, ref: 2.5, maxVoices: 4, minInterval: 0.02, priority: 1, send: 1.0, when: 'load',
    render(s) {
      s.click(0, 1, 3000, 0.0012);
      s.burst({ color: 'white', type: 'bandpass', f: s.r(3500, 5500), Q: 1, a: 0.0002, tau: 0.006, level: 0.8 });
      s.modal({ level: 0.45, modes: s.modes(s.r(900, 1800), [1, 2.21, 3.73, 5.4, 7.9], [0.1, 0.08, 0.05, 0.035, 0.02], [1, 0.8, 0.6, 0.4, 0.3], 0.05) });
      s.thump(0, 300, 120, 0.02, 0.015, 0.3);
    },
  },
  {
    id: 'ricochet', variants: 4, dur: 0.8, vol: 0.28, ref: 3, maxVoices: 2, minInterval: 0.08, send: 1.0, when: 'load',
    render(s) {
      const len = s.r(0.35, 0.6);
      const f0 = s.r(3000, 4200), f1 = f0 * s.r(0.4, 0.6);
      const o = s.osc('sine', f0, 0.01, len);
      s.env(o.frequency, [[0.01, f0], [0.01 + len, f1]], 'exp');
      const fm = s.osc('sine', s.r(40, 80), 0.01, len);
      const fmg = s.gain(s.r(60, 160));
      fm.connect(fmg); fmg.connect(o.frequency);
      const g = s.gain(0);
      s.env(g.gain, [[0.01, 0], [0.03, 0.6], [0.01 + len, 0]]);
      s.chain(o, g, s.out);
      s.burst({ start: 0.01, color: 'white', type: 'bandpass', f: 3000, f1: 1500, sweep: len, Q: 2, a: 0.02, tau: len * 0.3, level: 0.25 });
    },
  },
  {
    id: 'impact_concrete', variants: 5, dur: 0.45, vol: 0.4, ref: 2.5, maxVoices: 4, minInterval: 0.02, send: 1.0, when: 'load',
    render(s) {
      s.click(0, 0.5, 1800, 0.0015);
      s.burst({ color: 'white', type: 'bandpass', f: s.r(1400, 2200), Q: 0.8, a: 0.0003, tau: 0.012, level: 0.8 });
      s.burst({ color: 'pink', type: 'bandpass', f: s.r(700, 1000), Q: 0.9, a: 0.0005, tau: 0.02, level: 0.8 });
      s.burst({ color: 'pink', type: 'lowpass', f: 1500, Q: 0.6, a: 0.001, tau: 0.03, level: 0.5 });
      for (let i = 0; i < s.ri(6, 12); i++) s.click(s.r(0.01, 0.2), s.r(0.04, 0.12), 2500, 0.0012);
      s.burst({ start: 0.01, color: 'pink', type: 'highpass', f: 2000, Q: 0.5, a: 0.02, tau: 0.06, level: 0.15 });
    },
  },
  {
    id: 'impact_glass', variants: 3, dur: 0.7, vol: 0.4, ref: 2.5, maxVoices: 3, when: 'load',
    render(s) {
      s.click(0, 1, 3000, 0.001);
      for (let i = 0; i < s.ri(8, 14); i++) s.modal({ start: s.r(0, 0.25), level: s.r(0.08, 0.25), modes: s.modes(s.r(2500, 8000), [1, 1.8, 2.9], [0.05, 0.03, 0.015]) });
    },
  },
  {
    id: 'impact_rubber', variants: 3, dur: 0.3, vol: 0.4, ref: 2, maxVoices: 3, when: 'load',
    render(s) {
      s.thump(0, 200, 90, 0.02, 0.02, 0.8);
      s.burst({ color: 'pink', type: 'lowpass', f: 800, Q: 0.7, a: 0.0005, tau: 0.02, level: 0.7 });
      s.click(0, 0.3, 2500, 0.001);
    },
  },
  {
    id: 'impact_robot', variants: 5, dur: 0.45, vol: 0.5, ref: 2.5, maxVoices: 4, minInterval: 0.025, when: 'load',
    render(s) {
      s.click(0, 1, 2500, 0.0012);
      s.burst({ color: 'white', type: 'bandpass', f: s.r(1500, 2500), Q: 1, a: 0.0003, tau: 0.012, level: 0.8 });
      s.modal({ level: 0.35, modes: s.modes(s.r(600, 1100), [1, 1.7, 2.9, 4.4], [0.04, 0.03, 0.02, 0.015], undefined, 0.08) });
      if (s.chance(0.6)) crackle(s, 0.005, s.r(0.06, 0.18), 1500, 0.4);
      s.thump(0, 220, 100, 0.02, 0.02, 0.4);
    },
  },
  {
    id: 'impact_flesh', variants: 3, dur: 0.3, vol: 0.4, ref: 2, maxVoices: 3, when: 'load',
    render(s) {
      s.thump(0, 140, 60, 0.03, 0.03, 0.8);
      s.burst({ color: 'pink', type: 'lowpass', f: 600, Q: 1, a: 0.001, tau: 0.03, level: 0.7 });
      s.burst({ start: 0.005, color: 'white', type: 'bandpass', f: 900, Q: 2, a: 0.002, tau: 0.02, level: 0.25 });
    },
  },
  // ── story / special
  {
    id: 'elevator_start', variants: 1, dur: 4.5, vol: 0.85, ref: 4, send: 1.2, when: 'lazy', priority: 3,
    render(s) {
      clunk(s, 0, 70, 0.9, 0.3); // contactor
      hum(s, 0.05, 4.3, 50, 0.3, [[0, 0], [0.4, 1], [4.2, 0.6], [4.3, 0]]);
      hiss(s, 0.5, 0.6, 0.45, 2500); // brake release
      clunk(s, 0.65, 60, 1.0, 0.45);
      // lurch
      s.thump(1.0, 60, 28, 0.2, 0.25, 1.0);
      for (let i = 0; i < 10; i++) s.modal({ start: s.r(1.0, 1.6), level: s.r(0.1, 0.25), modes: s.modes(s.r(500, 2400), [1, 2.4, 4.1], [0.06, 0.04, 0.02]) });
      // cable creak
      const cr = s.osc('sawtooth', 9, 1.1, 1.2);
      s.env(cr.frequency, [[1.1, 9], [2.2, 18]], 'exp');
      const crg = s.gain(0);
      s.env(crg.gain, [[1.1, 0], [1.5, 0.35], [2.3, 0]]);
      s.chain(cr, s.bp(520, 18), crg, s.out);
      // motor whine rising
      whine(s, 0.9, 3.6, 70, 180, 0.35, [[0, 0], [1.5, 1], [3.6, 0.8]]);
    },
  },
  {
    id: 'elevator_arrive', variants: 1, dur: 3.5, vol: 0.8, ref: 5, send: 1.3, when: 'lazy',
    render(s) {
      whine(s, 0, 2.0, 160, 60, 0.35, [[0, 0.8], [1.6, 0.6], [2.0, 0]]);
      s.burst({ start: 0, color: 'brown', type: 'lowpass', f: 250, Q: 0.7, a: 0.3, hold: 1.4, tau: 0.2, level: 0.5 });
      clunk(s, 2.0, 60, 1.0, 0.5);
      for (let i = 0; i < 6; i++) s.modal({ start: s.r(2.0, 2.4), level: s.r(0.1, 0.2), modes: s.modes(s.r(500, 2400), [1, 2.4, 4.1], [0.06, 0.04, 0.02]) });
      hiss(s, 2.3, 0.6, 0.4, 2800);
      clunk(s, 2.8, 110, 0.5, 0.2);
    },
  },
  {
    id: 'pa_on', variants: 1, dur: 0.8, vol: 0.3, bus: 'voice',
    render(s) {
      s.click(0, 0.8, 300, 0.004);
      s.thump(0, 120, 60, 0.02, 0.03, 0.4);
      hum(s, 0, 0.8, 60, 0.15, [[0, 0], [0.05, 1], [0.6, 0]]);
    },
  },
  {
    id: 'glitch_long', variants: 2, dur: 1.6, vol: 0.45, when: 'lazy', pitchVar: 0,
    render(s) {
      const sh = s.shaper('crush', 3);
      s.chain(sh, s.hp(200), s.out);
      for (let i = 0; i < 6; i++) {
        const t = s.r(0, 1.3);
        s.chain(s.osc(s.pick(['square', 'sawtooth'] as const), s.r(60, 1500), t, s.r(0.03, 0.25)), s.gain(s.r(0.2, 0.5)), sh);
      }
      s.chain(s.noise('white', 0, 1.5), s.gain(0.3), sh);
    },
    post(ch, rnd) { stutter(ch, rnd, 5, 10, 50); decimate(ch, rnd, 4, 60, 200, 12, 3); saturate(ch, 1.5); },
  },
];

