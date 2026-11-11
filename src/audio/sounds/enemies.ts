import type { SoundDef, Synth } from '../synth/core';
import { buildVoice, planText } from '../synth/formant';
import { decimate, dropouts, saturate, stutter } from '../synth/post';
import { clack } from './weapons';
import { clunk, crackle, servo } from './world';

function tick(s: Synth, t: number, f: number, level: number, dst?: AudioNode): void {
  s.modal({ start: t, level, modes: s.modes(f, [1, 1.9, 3.2], [0.012, 0.008, 0.005], [1, 0.6, 0.3], 0.08), dst });
  s.click(t, level * 0.6, 4000, 0.0006, dst);
}

const POLITE = [
  'how may i help you', 'please remain calm', 'thank you for waiting', 'have a nice day',
  'your safety is our priority', 'please hold still', 'we apologise for the delay', 'welcome back',
  'please return to your station', 'this will not hurt',
];

function vocaliser(s: Synth, text: string, f0: number, glitchy: number): void {
  const plan = planText(text, 0, s.rnd);
  const dst = s.gain(1);
  // ring modulator (inline AM with an audio-rate carrier)
  const ring = s.gain(0);
  const car = s.osc('sine', s.r(180, 600), 0, plan.length + 0.5);
  const carG = s.gain(glitchy);
  car.connect(carG); carG.connect(ring.gain);
  const dry = s.gain(1 - glitchy * 0.6);
  dst.connect(ring); dst.connect(dry);
  const speaker = s.gain(1);
  ring.connect(speaker); dry.connect(speaker);
  s.chain(speaker, s.hp(350), s.pk(2200, 1.2, 8), s.shaper('hard', 2.5 + glitchy * 3), s.lp(5500), s.out);
  buildVoice(s, plan, { f0, fscale: 1.18, level: 1, delay: 0.02, jitter: 0.005, contour: 5, style: 'cheerful', vibrato: 0.004, breath: 0.1, dst, saw: true, pitchJumps: glitchy * 9 });
}

export const enemySounds: SoundDef[] = [
  // ── skitter
  {
    id: 'skitter_step', variants: 6, dur: 0.12, vol: 0.22, ref: 1.5, maxVoices: 6, minInterval: 0.02, priority: 0, send: 0.7, when: 'load', pitchVar: 0.1,
    render(s) { tick(s, 0, s.r(2400, 4200), 1); if (s.chance(0.5)) tick(s, s.r(0.012, 0.03), s.r(2000, 3500), 0.5); },
  },
  {
    id: 'skitter_chitter', variants: 4, dur: 0.8, vol: 0.4, ref: 2, maxVoices: 3, minInterval: 0.15, send: 0.8, when: 'load', pitchVar: 0.08,
    render(s) {
      const len = s.r(0.3, 0.6);
      const o = s.osc('square', s.r(1100, 1700), 0, len);
      s.env(o.frequency, [[0, s.r(1000, 1500)], [len * 0.5, s.r(1600, 2300)], [len, s.r(900, 1400)]], 'exp');
      const gate = s.osc('square', s.r(35, 60), 0, len);
      const gg = s.gain(0.5);
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.02, 0.25], [len * 0.7, 0.2], [len, 0]]);
      const am = s.gain(0.5);
      gate.connect(gg); gg.connect(am.gain);
      s.chain(o, s.bp(2200, 1.5), am, g, s.out);
      servo(s, 0.02, len * 0.6, s.r(500, 700), s.r(800, 1100), 0.1);
      for (let i = 0; i < 6; i++) tick(s, s.r(0, len), s.r(3000, 5000), 0.3);
    },
  },
  {
    id: 'skitter_screech', variants: 3, dur: 1.1, vol: 0.45, ref: 3, maxVoices: 2, minInterval: 0.3, priority: 2, send: 1.2, when: 'load', pitchVar: 0.08,
    render(s) {
      const len = s.r(0.6, 0.9);
      const f0 = s.r(2600, 3400);
      const o = s.osc('sawtooth', f0, 0, len);
      s.env(o.frequency, [[0, f0 * 0.7], [0.08, f0 * 1.2], [len * 0.6, f0], [len, f0 * 0.55]], 'exp');
      const fm = s.osc('sine', s.r(25, 40), 0, len);
      const fmg = s.gain(f0 * 0.06);
      fm.connect(fmg); fmg.connect(o.frequency);
      const o2 = s.osc('square', f0 * 1.06, 0, len);
      s.env(o2.frequency, [[0, f0 * 0.75], [0.1, f0 * 1.25], [len, f0 * 0.6]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.04, 0.5], [len * 0.7, 0.4], [len, 0]]);
      const mix = s.gain(1);
      o.connect(mix); s.chain(o2, s.gain(0.4), mix);
      s.chain(mix, s.shaper('hard', 2), s.bp(3000, 0.8), g, s.out);
      s.burst({ color: 'white', type: 'highpass', f: 5000, a: 0.02, tau: len * 0.3, hold: len * 0.4, level: 0.15 });
    },
  },
  {
    id: 'skitter_attack', variants: 3, dur: 0.5, vol: 0.55, ref: 2, maxVoices: 2, minInterval: 0.1, priority: 2, when: 'load',
    render(s) {
      servo(s, 0, 0.18, s.r(600, 800), s.r(1400, 1800), 0.2);
      s.burst({ color: 'white', type: 'bandpass', f: 1500, f1: 3500, sweep: 0.15, Q: 1, a: 0.05, tau: 0.04, level: 0.3 });
      for (let i = 0; i < 3; i++) clack(s, 0.16 + i * s.r(0.035, 0.05), s.r(2200, 3200), 0.6 - i * 0.12, 0.012);
    },
  },
  {
    id: 'skitter_hurt', variants: 3, dur: 0.45, vol: 0.45, ref: 2, maxVoices: 2, minInterval: 0.08, when: 'load', pitchVar: 0.1,
    render(s) {
      crackle(s, 0, s.r(0.1, 0.2), 1800, 0.6);
      const len = s.r(0.15, 0.3);
      const o = s.osc('square', s.r(1800, 2400), 0, len);
      s.env(o.frequency, [[0, 2400], [len, 900]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.01, 0.25], [len, 0]]);
      s.chain(o, s.bp(2000, 1.5), g, s.out);
    },
  },
  {
    id: 'skitter_death', variants: 2, dur: 1.6, vol: 0.6, ref: 3, maxVoices: 2, send: 1.0, when: 'load',
    render(s) {
      s.click(0, 1, 2000, 0.002);
      crackle(s, 0, 0.6, 2500, 0.8, 3500);
      servo(s, 0, 0.9, 1300, 70, 0.25);
      for (let i = 0; i < 7; i++) s.modal({ start: s.r(0.1, 0.8), level: s.r(0.1, 0.3), modes: s.modes(s.r(800, 3500), [1, 2.5, 4.3], [0.05, 0.03, 0.02]) });
      s.thump(0.12, 160, 70, 0.03, 0.03, 0.5);
    },
  },
  // ── husk
  {
    id: 'husk_step', variants: 6, dur: 0.6, vol: 0.45, ref: 2.5, maxVoices: 4, minInterval: 0.05, priority: 0, send: 0.9, when: 'load',
    render(s) {
      s.thump(0, 95, 42, 0.05, 0.05, 1.0);
      s.burst({ color: 'pink', type: 'lowpass', f: 550, Q: 0.8, a: 0.002, tau: 0.03, level: 0.7 });
      s.modal({ start: 0.002, level: 0.25, modes: s.modes(s.r(250, 330), [1, 2.7, 5.0, 7.9], [0.08, 0.06, 0.04, 0.025]) });
      servo(s, s.r(0.04, 0.1), s.r(0.2, 0.3), s.r(280, 340), s.r(380, 460), 0.08);
      if (s.chance(0.5)) clack(s, s.r(0.05, 0.15), s.r(1200, 1800), 0.2, 0.02);
    },
  },
  {
    id: 'husk_joint', variants: 4, dur: 0.9, vol: 0.35, ref: 2, maxVoices: 2, minInterval: 0.2, send: 0.7, when: 'load',
    render(s) {
      const len = s.r(0.35, 0.7);
      const n = s.noise('white', 0, len);
      const exc = s.osc('sawtooth', s.r(18, 35), 0, len);
      s.env(exc.frequency, [[0, s.r(15, 25)], [len, s.r(30, 50)]], 'exp');
      const excG = s.gain(0.5);
      const ng = s.gain(0.5);
      exc.connect(excG); excG.connect(ng.gain);
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.05, 0.8], [len * 0.8, 0.6], [len, 0]]);
      const sum = s.gain(1);
      for (const f of [s.r(600, 900), s.r(1300, 1800), s.r(2500, 3200)]) s.chain(ng, s.bp(f, 18), s.gain(1.5), sum);
      n.connect(ng);
      s.chain(sum, g, s.out);
    },
  },
  {
    id: 'husk_vocal', variants: 6, dur: 2.4, vol: 0.35, ref: 3, maxVoices: 2, minInterval: 0.6, priority: 2, send: 1.1, when: 'load', pitchVar: 0.06,
    render(s, v) { vocaliser(s, POLITE[v % POLITE.length], s.r(170, 230), 0.35 + (v % 3) * 0.2); },
    post(ch, rnd) { stutter(ch, rnd, 2 + Math.floor(rnd() * 3), 25, 70); decimate(ch, rnd, 2, 60, 200, 10, 4); dropouts(ch, rnd, 3); saturate(ch, 1.8); },
  },
  {
    id: 'husk_wake', variants: 2, dur: 1.8, vol: 0.6, ref: 3, maxVoices: 2, send: 1.0, when: 'load',
    render(s) {
      clunk(s, 0, 120, 0.4, 0.1);
      const o = s.osc('sawtooth', 80, 0.05, 1.3);
      s.env(o.frequency, [[0.05, 70], [1.25, s.r(520, 680)]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0.05, 0], [0.4, 0.3], [1.1, 0.25], [1.35, 0]]);
      s.chain(o, s.lp(2200), g, s.out);
      const o2 = s.osc('sine', 160, 0.05, 1.3);
      s.env(o2.frequency, [[0.05, 140], [1.25, s.r(1100, 1400)]], 'exp');
      const g2 = s.gain(0);
      s.env(g2.gain, [[0.05, 0], [0.5, 0.15], [1.35, 0]]);
      s.chain(o2, g2, s.out);
      for (const t of [0.3, 0.55, 0.9]) clack(s, t * s.r(0.9, 1.1), s.r(1500, 2500), 0.25, 0.02);
      // boot chirp
      for (const [t, f] of [[1.32, 1568], [1.4, 2093]] as const) {
        const cg = s.ad(t, 0.002, 0.08, 0.02, 0.04);
        s.chain(s.osc('square', f, t, 0.1), s.lp(3000), cg, s.out);
      }
      servo(s, 1.4, 0.25, 300, 500, 0.15); // head snap
      clunk(s, 1.62, 150, 0.35, 0.08);
    },
  },
  {
    id: 'husk_attack', variants: 3, dur: 0.7, vol: 0.6, ref: 2.5, maxVoices: 2, minInterval: 0.15, priority: 2, when: 'load',
    render(s) {
      servo(s, 0, 0.3, s.r(250, 320), s.r(600, 800), 0.2);
      const n = s.noise('pink', 0.1, 0.35);
      const f = s.bp(400, 1.2);
      s.env(f.frequency, [[0.1, 400], [0.25, 2200], [0.4, 600]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0.1, 0], [0.24, 0.7], [0.42, 0]]);
      s.chain(n, f, g, s.out);
      // tool motor
      const m = s.osc('sawtooth', s.r(160, 220), 0.05, 0.4);
      const mg = s.gain(0);
      s.env(mg.gain, [[0.05, 0], [0.1, 0.15], [0.4, 0.1], [0.45, 0]]);
      s.chain(m, s.shaper('hard', 3), s.bp(900, 1), mg, s.out);
    },
  },
  {
    id: 'husk_hurt', variants: 3, dur: 0.6, vol: 0.3, ref: 2.5, maxVoices: 2, minInterval: 0.1, when: 'load',
    render(s) {
      s.burst({ color: 'white', type: 'bandpass', f: s.r(1800, 2600), Q: 0.9, a: 0.0005, tau: 0.02, level: 0.6 });
      s.modal({ level: 0.3, modes: s.modes(s.r(900, 1400), [1, 1.5, 2.3, 3.1], [0.03, 0.02, 0.015, 0.01]) });
      vocaliser(s, s.pick(['eh', 'pa', 'oh no', 'sir']), s.r(200, 260), 0.7);
    },
    post(ch, rnd) { stutter(ch, rnd, 2, 15, 40); saturate(ch, 2); },
  },
  {
    id: 'husk_death', variants: 2, dur: 2.8, vol: 0.65, ref: 3, maxVoices: 2, send: 1.1, when: 'idle',
    render(s) {
      const o = s.osc('sawtooth', 600, 0, 1.6);
      s.env(o.frequency, [[0, 620], [1.5, 40]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.05, 0.3], [1.5, 0]]);
      s.chain(o, s.lp(1800), g, s.out);
      crackle(s, 0, 0.5, 1500, 0.5);
      // collapse
      const t = s.r(1.0, 1.3);
      s.thump(t, 90, 36, 0.08, 0.1, 1.0);
      s.burst({ start: t, color: 'pink', type: 'lowpass', f: 600, Q: 0.7, a: 0.002, tau: 0.06, level: 0.7 });
      for (let i = 0; i < 6; i++) s.modal({ start: t + s.r(0, 0.5), level: s.r(0.1, 0.25), modes: s.modes(s.r(400, 2500), [1, 2.5, 4.4], [0.08, 0.05, 0.03]) });
      clunk(s, t + s.r(0.2, 0.35), 110, 0.5, 0.15);
    },
  },
  // ── sentry
  {
    id: 'sentry_charge', variants: 2, dur: 1.1, vol: 0.5, ref: 4, maxVoices: 2, priority: 2, send: 0.9, when: 'load', pitchVar: 0.03,
    render(s) {
      const len = 0.95;
      const o = s.osc('sine', 400, 0, len);
      s.env(o.frequency, [[0, 380], [len, 3200]], 'exp');
      const o2 = s.osc('sawtooth', 200, 0, len);
      s.env(o2.frequency, [[0, 190], [len, 1600]], 'exp');
      const trem = s.osc('square', 8, 0, len);
      s.env(trem.frequency, [[0, 8], [len, 45]], 'exp');
      const tg = s.gain(0.4);
      const am = s.gain(0.6);
      trem.connect(tg); tg.connect(am.gain);
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [len * 0.9, 0.5], [len, 0]]);
      o.connect(am); s.chain(o2, s.lp(2500), s.gain(0.3), am);
      s.chain(am, g, s.out);
      const n = s.noise('white', 0, len);
      const ng = s.gain(0);
      s.env(ng.gain, [[0, 0], [len, 0.15]]);
      s.chain(n, s.hp(4000), ng, s.out);
    },
  },
  {
    id: 'sentry_fire', variants: 3, dur: 0.7, vol: 0.7, ref: 5, maxVoices: 3, priority: 3, send: 1.3, when: 'load',
    render(s) {
      s.click(0, 1, 1500, 0.0015);
      s.burst({ color: 'white', type: 'bandpass', f: 5000, Q: 0.7, a: 0.0002, tau: 0.01, level: 1 });
      const o = s.osc('sawtooth', 4500, 0, 0.12);
      s.env(o.frequency, [[0, s.r(4000, 5000)], [0.1, s.r(250, 400)]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.002, 0.8], [0.11, 0]]);
      s.chain(o, s.shaper('hard', 2), g, s.out);
      s.thump(0, 220, 60, 0.04, 0.04, 0.6);
      crackle(s, 0.02, 0.35, 900, 0.3, 5000);
    },
  },
  {
    id: 'sentry_alert', variants: 2, dur: 0.9, vol: 0.3, ref: 4, maxVoices: 1, minInterval: 0.5, priority: 2, when: 'load',
    render(s) {
      for (const [t, f0, f1] of [[0, 900, 1800], [0.18, 1800, 900], [0.36, 900, 2400]] as const) {
        const o = s.osc('square', f0, t, 0.16);
        s.env(o.frequency, [[t, f0], [t + 0.15, f1]], 'exp');
        const g = s.ad(t, 0.004, 0.25, 0.04, 0.1);
        s.chain(o, s.lp(4000), g, s.out);
      }
      servo(s, 0.05, 0.4, 400, 600, 0.12);
    },
  },
  {
    id: 'sentry_hurt', variants: 2, dur: 0.4, vol: 0.45, ref: 3, maxVoices: 2, minInterval: 0.08, when: 'load',
    render(s) {
      s.modal({ level: 0.5, modes: s.modes(s.r(1500, 2200), [1, 2.4, 3.9], [0.06, 0.04, 0.02]) });
      crackle(s, 0, 0.15, 2000, 0.5);
    },
  },
  {
    id: 'sentry_death', variants: 2, dur: 2.6, vol: 0.75, ref: 5, maxVoices: 2, send: 1.2, when: 'idle',
    render(s) {
      crackle(s, 0, 0.8, 2500, 0.8, 3000);
      const o = s.osc('sine', 1500, 0, 1.4);
      s.env(o.frequency, [[0, 1500], [1.3, 90]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0, 0.3], [1.3, 0]]);
      s.chain(o, g, s.out);
      s.thump(0.05, 120, 40, 0.1, 0.15, 0.7);
      s.burst({ start: 0.05, color: 'brown', type: 'lowpass', f: 1200, Q: 0.7, a: 0.002, tau: 0.2, level: 0.7 });
      const t = s.r(1.1, 1.4);
      s.thump(t, 100, 40, 0.06, 0.08, 0.8);
      for (let i = 0; i < 8; i++) s.modal({ start: t + s.r(0, 0.4), level: s.r(0.1, 0.25), modes: s.modes(s.r(600, 3000), [1, 2.5, 4.3], [0.08, 0.05, 0.03]) });
    },
  },
  {
    id: 'sentry_wake', variants: 1, dur: 1.6, vol: 0.5, ref: 4, when: 'idle',
    render(s) {
      clack(s, 0, 1600, 0.3, 0.02);
      const n = s.noise('pink', 0, 1.5);
      const f = s.bp(200, 2);
      s.env(f.frequency, [[0, 150], [1.2, 900]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [1.0, 0.6], [1.5, 0]]);
      s.chain(n, f, g, s.out);
      const o = s.osc('sine', 300, 0, 1.5);
      s.env(o.frequency, [[0, 200], [1.2, 1600]], 'exp');
      const og = s.gain(0);
      s.env(og.gain, [[0, 0], [1.0, 0.2], [1.5, 0]]);
      s.chain(o, og, s.out);
    },
  },
];

export { vocaliser, POLITE };
