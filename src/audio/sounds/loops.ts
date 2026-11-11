import type { SoundDef, Synth } from '../synth/core';
import { buildVoice, planText } from '../synth/formant';
import { clack } from './weapons';
import { clunk, crackle, hiss, servo } from './world';

/** A steady oscillator (whole-loop) through optional chain. */
function drone(s: Synth, type: OscillatorType, f: number, dur: number, level: number, ...chain: AudioNode[]): OscillatorNode {
  const o = s.osc(type, f, 0, dur);
  s.chain(o, ...chain, s.gain(level), s.out);
  return o;
}

/** Noise bed with slow random-ish amplitude wobble. */
function bed(s: Synth, color: 'white' | 'pink' | 'brown', dur: number, level: number, wobble: number, ...chain: AudioNode[]): void {
  const n = s.noise(color, 0, dur);
  const g = s.gain(level);
  if (wobble > 0) {
    const l = s.osc('sine', s.r(0.07, 0.2), 0, dur);
    const lg = s.gain(level * wobble);
    l.connect(lg); lg.connect(g.gain);
  }
  s.chain(n, ...chain, g, s.out);
}

/** Loop length helper: the full rendered span includes the crossfade tail. */
const L = (s: Synth, d: number) => d + 0.7;

export const loopSounds: SoundDef[] = [
  {
    id: 'amb_room', loop: true, variants: 1, dur: 10, vol: 0.5, bus: 'ambience', channels: 2, when: 'idle',
    render(s) {
      const D = L(s, 10);
      bed(s, 'brown', D, 1.0, 0.25, s.lp(160), s.pan(-0.2));
      bed(s, 'brown', D, 1.0, 0.25, s.lp(170), s.pan(0.2));
      bed(s, 'pink', D, 0.08, 0.5, s.bp(520, 0.8), s.pan(0.4));
      bed(s, 'pink', D, 0.03, 0.6, s.bp(1800, 2), s.pan(-0.4));
      drone(s, 'sine', 60, D, 0.025);
      drone(s, 'sine', 120, D, 0.018);
      drone(s, 'sine', 180, D, 0.008);
    },
  },
  {
    id: 'amb_fab', loop: true, variants: 1, dur: 12, vol: 0.6, bus: 'ambience', channels: 2, when: 'idle',
    render(s) {
      const D = L(s, 12);
      bed(s, 'brown', D, 1.2, 0.35, s.lp(110));
      // wind in the ducts (moving resonances)
      for (const p of [-0.6, 0.5]) {
        const n = s.noise('pink', 0, D);
        const f = s.bp(s.r(380, 650), 7);
        s.env(f.frequency, [[0, s.r(350, 500)], [D * 0.3, s.r(500, 800)], [D * 0.7, s.r(380, 600)], [D, s.r(400, 700)]], 'exp');
        const g = s.gain(0);
        s.env(g.gain, [[0, 0.05], [D * 0.4, 0.14], [D * 0.8, 0.06], [D, 0.09]]);
        s.chain(n, f, g, s.pan(p), s.out);
      }
      // distant machinery pulse (slow, low)
      const pulse = s.gain(1);
      s.chain(pulse, s.lp(220), s.gain(0.5), s.out);
      for (let t = 0.3; t < D; t += 1.45) s.thump(t, 70, 45, 0.08, 0.12, 0.25, pulse);
      // ticking metal, sparse
      for (let i = 0; i < 10; i++) {
        const t = s.r(0, D - 0.2);
        s.modal({ start: t, level: s.r(0.02, 0.05), modes: s.modes(s.r(1500, 4000), [1, 2.6], [0.04, 0.02]), dst: s.pan(s.r(-0.9, 0.9)).connect(s.out) as AudioNode });
      }
      drone(s, 'sine', 41.25, D, 0.04);
    },
  },
  {
    id: 'amb_gen', loop: true, variants: 1, dur: 8, vol: 0.4, bus: 'ambience', channels: 2, when: 'idle',
    render(s) {
      const D = L(s, 8);
      const sh = s.shaper('tanh', 2.5);
      const hum = s.gain(0.4);
      s.chain(sh, s.lp(1500), hum, s.out);
      for (const [h, a] of [[1, 1], [2, 0.9], [3, 0.5], [4, 0.35], [5, 0.2], [6, 0.18], [8, 0.08]] as const) {
        const o = s.osc('sine', 50 * h, 0, D);
        s.chain(o, s.gain(a * 0.35), sh);
      }
      // transformer buzz at 100 Hz modulated slowly
      const b = s.osc('sawtooth', 100, 0, D);
      const bg = s.gain(0.03);
      const lfo = s.osc('sine', 0.25, 0, D);
      const lg = s.gain(0.015);
      lfo.connect(lg); lg.connect(bg.gain);
      s.chain(b, s.bp(1200, 2), bg, s.out);
      bed(s, 'brown', D, 0.6, 0.2, s.lp(200));
      bed(s, 'pink', D, 0.03, 0.3, s.hp(3000));
    },
  },
  {
    id: 'machine_loop', loop: true, variants: 1, dur: 4, vol: 0.55, ref: 4, send: 1.0, when: 'lazy',
    render(s) {
      const D = L(s, 4);
      drone(s, 'sawtooth', 75, D, 0.12, s.lp(400));
      drone(s, 'sine', 37.5, D, 0.2);
      for (let t = 0; t < D; t += 1) {
        clunk(s, t, 60, 0.6, 0.15);
        hiss(s, t + 0.35, 0.3, 0.12, 2500);
        servo(s, t + 0.55, 0.3, 300, 420, 0.06);
      }
      bed(s, 'pink', D, 0.05, 0.2, s.bp(2600, 3));
    },
  },
  {
    id: 'arm_servo_loop', loop: true, variants: 1, dur: 6, vol: 0.5, ref: 4, send: 1.0, when: 'lazy',
    render(s) {
      const D = L(s, 6);
      let t = 0;
      while (t < D - 0.3) {
        const d = s.r(0.3, 0.9);
        servo(s, t, d, s.r(180, 320), s.r(300, 650), s.r(0.12, 0.2));
        if (s.chance(0.5)) hiss(s, t + d * 0.8, 0.25, 0.08, 3000);
        if (s.chance(0.6)) clunk(s, t + d, s.r(90, 140), 0.3, 0.1);
        t += d + s.r(0.05, 0.4);
      }
      bed(s, 'brown', D, 0.3, 0.2, s.lp(200));
    },
  },
  {
    id: 'conveyor_loop', loop: true, variants: 1, dur: 6, vol: 0.5, ref: 5, send: 1.0, when: 'lazy',
    render(s) {
      const D = L(s, 6);
      for (let t = 0; t < D; t += 0.125) {
        s.modal({ start: t + s.r(-0.004, 0.004), level: s.r(0.05, 0.1), modes: s.modes(s.r(900, 1300), [1, 2.4, 4.1], [0.03, 0.02, 0.012]) });
      }
      for (let t = 0.7; t < D; t += 1.5) {
        const o = s.osc('sine', s.r(1100, 1400), t, 0.2);
        s.env(o.frequency, [[t, 1200], [t + 0.18, 1500]], 'exp');
        s.chain(o, s.ad(t, 0.03, 0.03, 0.05, 0.08), s.out);
      }
      bed(s, 'brown', D, 0.5, 0.15, s.lp(250));
      drone(s, 'sawtooth', 100, D, 0.04, s.lp(500));
    },
  },
  {
    id: 'elevator_loop', loop: true, variants: 1, dur: 8, vol: 0.7, bus: 'sfx', channels: 2, when: 'lazy',
    render(s) {
      const D = L(s, 8);
      bed(s, 'brown', D, 1.0, 0.3, s.lp(180));
      // shaft wind
      const n = s.noise('pink', 0, D);
      const f = s.bp(600, 3);
      s.env(f.frequency, [[0, 500], [D * 0.5, 900], [D, 550]], 'exp');
      s.chain(n, f, s.gain(0.12), s.out);
      drone(s, 'sawtooth', 140, D, 0.03, s.lp(600));
      // cage rattle
      for (let i = 0; i < 70; i++) {
        s.modal({ start: s.r(0, D - 0.1), level: s.r(0.02, 0.08), modes: s.modes(s.r(600, 3000), [1, 2.4, 4.1], [0.03, 0.02, 0.01]), dst: s.pan(s.r(-1, 1)).connect(s.out) as AudioNode });
      }
      // rail joints passing
      for (let t = 0.8; t < D; t += 2.0) {
        clunk(s, t, 70, 0.4, 0.15);
        clunk(s, t + 0.12, 80, 0.25, 0.1);
      }
    },
  },
  {
    id: 'alarm_loop', loop: true, variants: 1, dur: 2, vol: 0.45, ref: 6, send: 1.3, when: 'lazy',
    render(s) {
      const D = L(s, 2);
      const sh = s.shaper('tanh', 2.5);
      s.chain(sh, s.bp(900, 0.7), s.out);
      for (let t = 0; t < D; t += 2) {
        const o = s.osc('sawtooth', 440, t, 1.05);
        s.env(o.frequency, [[t, 380], [t + 0.15, 470], [t + 1.0, 450]], 'exp');
        const o2 = s.osc('square', 442 * 1.5, t, 1.05);
        s.env(o2.frequency, [[t, 570], [t + 0.15, 705], [t + 1.0, 675]], 'exp');
        const g = s.gain(0);
        s.env(g.gain, [[t, 0], [t + 0.03, 0.6], [t + 0.95, 0.5], [t + 1.0, 0]]);
        o.connect(g); s.chain(o2, s.gain(0.3), g);
        g.connect(sh);
      }
    },
  },
  {
    id: 'steam_loop', loop: true, variants: 1, dur: 5, vol: 0.4, ref: 2.5, send: 0.8, when: 'lazy',
    render(s) {
      const D = L(s, 5);
      const n = s.noise('white', 0, D);
      const g = s.gain(0.4);
      const am = s.noise('brown', 0, D, 0.15);
      const ag = s.gain(0.25);
      am.connect(ag); ag.connect(g.gain);
      s.chain(n, s.hp(900), s.bp(3800, 0.5), g, s.out);
      bed(s, 'pink', D, 0.08, 0.3, s.bp(700, 1));
    },
  },
  {
    id: 'spark_loop', loop: true, variants: 1, dur: 7, vol: 0.6, ref: 2.5, send: 0.8, when: 'lazy',
    render(s) {
      const D = L(s, 7);
      let t = 0.1;
      while (t < D - 0.5) {
        const d = s.r(0.05, 0.35);
        crackle(s, t, d, s.r(500, 1800), s.r(0.3, 0.8), s.r(2500, 4500));
        if (s.chance(0.3)) s.click(t, 0.5, 2000, 0.002);
        t += d + s.r(0.1, 1.2);
      }
      drone(s, 'sawtooth', 50, D, 0.01, s.bp(1500, 2));
    },
  },
  {
    id: 'skitter_loop', loop: true, variants: 1, dur: 3, vol: 0.45, ref: 1.8, send: 0.6, when: 'idle',
    render(s) {
      const D = L(s, 3);
      for (let i = 0; i < 26; i++) {
        const t = s.r(0, D - 0.05);
        s.modal({ start: t, level: s.r(0.1, 0.3), modes: s.modes(s.r(2500, 4500), [1, 1.9, 3.2], [0.01, 0.007, 0.004]) });
      }
      for (let i = 0; i < 3; i++) servo(s, s.r(0, D - 0.4), s.r(0.1, 0.3), s.r(700, 1000), s.r(900, 1400), 0.05);
      drone(s, 'sawtooth', 120, D, 0.012, s.bp(2400, 4));
    },
  },
  {
    id: 'husk_loop', loop: true, variants: 1, dur: 6, vol: 0.32, ref: 2.2, send: 0.6, when: 'idle',
    render(s) {
      const D = L(s, 6);
      drone(s, 'sine', 120, D, 0.08);
      drone(s, 'sawtooth', 240, D, 0.015, s.lp(700));
      // flickering electrical whine
      const w = s.osc('sine', 2100, 0, D);
      const wg = s.gain(0.01);
      const fl = s.noise('brown', 0, D, 0.3);
      const fg = s.gain(0.015);
      fl.connect(fg); fg.connect(wg.gain);
      s.chain(w, wg, s.out);
      // twitch servo bursts + plastic creak
      for (let i = 0; i < 3; i++) {
        const t = s.r(0.2, D - 0.6);
        servo(s, t, s.r(0.1, 0.25), s.r(300, 400), s.r(450, 600), 0.12);
        if (s.chance(0.6)) clack(s, t + 0.2, s.r(900, 1400), 0.15, 0.02);
      }
      if (s.chance(0.8)) crackle(s, s.r(0.5, D - 1), 0.2, 600, 0.15);
    },
  },
  {
    id: 'sentry_loop', loop: true, variants: 1, dur: 4, vol: 0.4, ref: 3, send: 0.7, when: 'idle',
    render(s) {
      const D = L(s, 4);
      // rotor wash: noise AM at blade rate
      const n = s.noise('pink', 0, D);
      const g = s.gain(0.3);
      const rotor = s.osc('sine', 28, 0, D);
      const rg = s.gain(0.15);
      rotor.connect(rg); rg.connect(g.gain);
      s.chain(n, s.bp(320, 1.2), g, s.out);
      s.chain(s.noise('white', 0, D), s.bp(1100, 2), s.gain(0.06), s.out);
      // turbine whine with wobble
      const w = s.osc('sine', 1650, 0, D);
      const wob = s.osc('sine', 0.5, 0, D);
      const wobg = s.gain(12);
      wob.connect(wobg); wobg.connect(w.frequency);
      s.chain(w, s.gain(0.03), s.out);
      drone(s, 'sine', 3300, D, 0.006);
      drone(s, 'sine', 56, D, 0.1);
    },
  },
  {
    id: 'monitor_hum', loop: true, variants: 1, dur: 4, vol: 0.2, ref: 1.5, send: 0.4, when: 'lazy',
    render(s) {
      const D = L(s, 4);
      drone(s, 'sine', 7812.5, D, 0.012);
      drone(s, 'sine', 60, D, 0.08);
      drone(s, 'sine', 120, D, 0.04);
      for (let i = 0; i < 8; i++) s.click(s.r(0, D - 0.05), s.r(0.02, 0.06), 3000, 0.001);
      bed(s, 'pink', D, 0.015, 0.4, s.hp(2000));
    },
  },
  {
    id: 'fluorescent_buzz', loop: true, variants: 1, dur: 3, vol: 0.22, ref: 1.8, send: 0.5, when: 'lazy',
    render(s) {
      const D = L(s, 3);
      const sh = s.shaper('hard', 6);
      const g = s.gain(0.08);
      s.chain(sh, s.bp(1800, 0.5), g, s.out);
      s.chain(s.osc('sine', 120, 0, D), sh);
      drone(s, 'sine', 120, D, 0.05);
      drone(s, 'sine', 240, D, 0.02);
      for (let i = 0; i < 3; i++) s.click(s.r(0, D - 0.05), 0.08, 1500, 0.004);
    },
  },
  {
    id: 'tinnitus', loop: true, variants: 1, dur: 2, vol: 0.06, bus: 'ui', when: 'idle', peak: 0.5,
    render(s) {
      const D = L(s, 2);
      drone(s, 'sine', 4100, D, 0.5);
      drone(s, 'sine', 4100.5, D, 0.3);
    },
  },
  // ── generative-ambience event buffers
  {
    id: 'dist_clank', variants: 4, dur: 2.5, vol: 0.5, ref: 6, rolloff: 0.6, send: 2.0, when: 'idle', pitchVar: 0.15,
    render(s) {
      const lp = s.lp(1800);
      lp.connect(s.out);
      s.modal({ level: 0.6, modes: s.modes(s.r(120, 260), [1, 2.32, 4.25, 6.63, 9.38], [1.4, 1.0, 0.6, 0.4, 0.25]), dst: lp });
      s.thump(0, 100, 45, 0.05, 0.08, 0.5, lp);
      if (s.chance(0.5)) s.modal({ start: s.r(0.2, 0.5), level: 0.3, modes: s.modes(s.r(150, 300), [1, 2.32, 4.25], [0.8, 0.5, 0.3]), dst: lp });
    },
  },
  {
    id: 'dist_knock', variants: 3, dur: 1.4, vol: 0.5, ref: 5, rolloff: 0.6, send: 1.8, when: 'idle',
    render(s) {
      const n = s.ri(2, 4);
      let t = 0;
      for (let i = 0; i < n; i++) {
        s.thump(t, 140, 70, 0.03, 0.04, 0.8);
        s.modal({ start: t, level: 0.3, modes: s.modes(s.r(220, 320), [1, 2.5, 4.2], [0.12, 0.08, 0.04]) });
        t += s.r(0.18, 0.4);
      }
    },
  },
  {
    id: 'drip', variants: 5, dur: 0.5, vol: 0.25, ref: 3, rolloff: 0.7, send: 2.0, when: 'idle', pitchVar: 0.12,
    render(s) {
      const f = s.r(900, 1500);
      const o = s.osc('sine', f, 0, 0.06);
      s.env(o.frequency, [[0, f], [0.02, f * s.r(1.6, 2.4)]], 'exp');
      s.chain(o, s.ad(0, 0.001, 0.8, 0.012), s.out);
      s.click(0, 0.2, 3000, 0.0008);
    },
  },
  {
    id: 'dist_voice', variants: 3, dur: 3.0, vol: 0.3, ref: 5, rolloff: 0.6, send: 2.2, when: 'lazy', pitchVar: 0.05,
    render(s, v) {
      const txt = ['help me', 'is anyone there', 'it is still in the walls'][v];
      const plan = planText(txt, s.r(1.6, 2.4), s.rnd);
      const d = s.gain(1);
      s.chain(d, s.hp(250), s.lp(1300), s.out);
      buildVoice(s, plan, { f0: s.r(95, 140), fscale: 1.05, level: 1, delay: 0.1, jitter: 0.01, contour: 3, style: 'calm', vibrato: 0.01, breath: 0.65, dst: d });
    },
  },
  // ── UI
  {
    id: 'ui_hover', variants: 2, dur: 0.06, vol: 0.18, bus: 'ui', minInterval: 0.03, maxVoices: 2, when: 'load',
    render(s) { s.chain(s.osc('sine', s.r(2000, 2300), 0, 0.03), s.ad(0, 0.001, 0.4, 0.006), s.out); s.click(0, 0.15, 5000, 0.0006); },
  },
  {
    id: 'ui_click', variants: 2, dur: 0.15, vol: 0.3, bus: 'ui', when: 'load',
    render(s) {
      clack(s, 0, 2200, 0.5, 0.008);
      s.thump(0, 300, 150, 0.015, 0.012, 0.3);
      s.chain(s.osc('square', 1480, 0.02, 0.05), s.lp(3500), s.ad(0.02, 0.002, 0.08, 0.015, 0.02), s.out);
    },
  },
  {
    id: 'ui_open', variants: 1, dur: 0.45, vol: 0.3, bus: 'ui', when: 'load',
    render(s) {
      const n = s.noise('pink', 0, 0.35);
      const f = s.bp(400, 1.2);
      s.env(f.frequency, [[0, 400], [0.25, 2400]], 'exp');
      s.chain(n, f, s.swell(0, 0.12, 0.4, 0.05, 0.15), s.out);
      const o = s.osc('sine', 330, 0.05, 0.35);
      s.env(o.frequency, [[0.05, 330], [0.3, 660]], 'exp');
      s.chain(o, s.swell(0.05, 0.08, 0.12, 0.1, 0.15), s.out);
    },
  },
  {
    id: 'ui_close', variants: 1, dur: 0.45, vol: 0.3, bus: 'ui', when: 'load',
    render(s) {
      const n = s.noise('pink', 0, 0.35);
      const f = s.bp(2400, 1.2);
      s.env(f.frequency, [[0, 2400], [0.25, 400]], 'exp');
      s.chain(n, f, s.swell(0, 0.06, 0.4, 0.05, 0.15), s.out);
      const o = s.osc('sine', 660, 0.02, 0.3);
      s.env(o.frequency, [[0.02, 660], [0.25, 330]], 'exp');
      s.chain(o, s.swell(0.02, 0.05, 0.12, 0.08, 0.12), s.out);
    },
  },
];
