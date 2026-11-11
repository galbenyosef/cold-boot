import type { SoundDef, Synth } from '../synth/core';
import { clack } from './weapons';

function heel(s: Synth, t: number, f: number, level: number): void {
  s.thump(t, f * 1.6, f, 0.025, 0.018, level);
  s.burst({ start: t, color: 'pink', type: 'lowpass', f: 700, Q: 0.7, a: 0.0015, tau: 0.014, level: level * 0.7 });
}

function scuff(s: Synth, t: number, f: number, dur: number, level: number): void {
  const n = s.noise('white', t, dur + 0.03);
  const g = s.gain(0);
  s.env(g.gain, [[t, 0], [t + dur * 0.2, level], [t + dur, 0]]);
  s.chain(n, s.bp(f, 0.9), g, s.out);
}

const STEP_BASE = { variants: 6, dur: 0.45, vol: 0.2, maxVoices: 3, priority: 0, minInterval: 0.06, ref: 1.5, send: 0.6, when: 'load' as const };

export const playerSounds: SoundDef[] = [
  {
    ...STEP_BASE, id: 'step_metal',
    render(s) {
      heel(s, 0, s.r(65, 80), 0.9);
      s.modal({ start: 0.001, level: 0.32, modes: s.modes(s.r(300, 380), [1, 2.9, 5.1, 8.3, 12.6], [0.07, 0.06, 0.045, 0.03, 0.02], [1, 0.8, 0.6, 0.4, 0.25], 0.06) });
      s.click(0, 0.25, 3000, 0.002);
      const t2 = s.r(0.05, 0.075);
      heel(s, t2, s.r(80, 95), 0.35);
      s.modal({ start: t2, level: 0.14, modes: s.modes(s.r(450, 600), [1, 2.7, 4.9, 7.7], [0.05, 0.04, 0.03, 0.02], undefined, 0.06) });
    },
  },
  {
    ...STEP_BASE, id: 'step_grate',
    render(s) {
      heel(s, 0, s.r(70, 85), 0.7);
      s.modal({ start: 0.001, level: 0.35, modes: s.modes(s.r(500, 600), [1, 2.62, 4.76, 7.8, 11.9], [0.18, 0.16, 0.12, 0.09, 0.06], [1, 0.9, 0.7, 0.5, 0.35], 0.05) });
      // grate rattle: a few loose bar chatters
      for (let i = 0; i < s.ri(3, 5); i++) {
        s.modal({ start: s.r(0.006, 0.07), level: s.r(0.06, 0.12), modes: s.modes(s.r(1400, 3200), [1, 2.4], [0.02, 0.012]) });
      }
      heel(s, s.r(0.055, 0.08), 95, 0.3);
    },
  },
  {
    ...STEP_BASE, id: 'step_concrete',
    render(s) {
      heel(s, 0, s.r(60, 75), 1.0);
      s.burst({ color: 'pink', type: 'bandpass', f: s.r(900, 1300), Q: 0.8, a: 0.001, tau: 0.02, level: 0.45 });
      scuff(s, s.r(0.03, 0.05), s.r(2800, 4200), s.r(0.04, 0.07), 0.22);
      // grit
      for (let i = 0; i < s.ri(2, 5); i++) s.click(s.r(0.01, 0.09), s.r(0.04, 0.1), 5000, 0.0007);
      heel(s, s.r(0.05, 0.07), 85, 0.35);
    },
  },
  {
    ...STEP_BASE, id: 'step_rubber',
    render(s) {
      heel(s, 0, s.r(55, 68), 1.0);
      s.burst({ color: 'pink', type: 'lowpass', f: 450, Q: 0.8, a: 0.002, tau: 0.025, level: 0.6 });
      scuff(s, s.r(0.03, 0.05), s.r(1500, 2200), 0.05, 0.08);
      if (s.chance(0.35)) s.tone({ start: s.r(0.05, 0.08), f: s.r(1700, 2400), f1: s.r(2000, 2800), sweep: 0.03, a: 0.005, tau: 0.012, level: 0.04 });
      heel(s, s.r(0.05, 0.07), 75, 0.3);
    },
  },
  {
    ...STEP_BASE, id: 'step_glass',
    render(s) {
      heel(s, 0, 70, 0.8);
      for (let i = 0; i < s.ri(5, 9); i++) s.modal({ start: s.r(0, 0.08), level: s.r(0.05, 0.15), modes: s.modes(s.r(3000, 7500), [1, 1.9, 3.1], [0.03, 0.02, 0.012]) });
      scuff(s, 0.03, 4500, 0.05, 0.15);
    },
  },
  {
    id: 'gear_rattle', variants: 4, dur: 0.3, vol: 0.09, maxVoices: 2, priority: 0, minInterval: 0.08,
    render(s) {
      for (let i = 0; i < s.ri(4, 7); i++) s.modal({ start: s.r(0, 0.12), level: s.r(0.3, 0.7), modes: s.modes(s.r(2200, 5200), [1, 2.2, 3.9], [0.025, 0.015, 0.008]) });
      const n = s.noise('pink', 0, 0.2);
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.03, 0.25], [0.15, 0]]);
      s.chain(n, s.bp(1400, 0.7), g, s.out);
    },
  },
  {
    id: 'jump', variants: 2, dur: 0.45, vol: 0.22, when: 'load',
    render(s) {
      const n = s.noise('pink', 0, 0.35);
      const f = s.bp(700, 0.8);
      s.env(f.frequency, [[0, 600], [0.18, 1600]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.08, 0.5], [0.3, 0]]);
      s.chain(n, f, g, s.out);
      for (let i = 0; i < 4; i++) s.modal({ start: s.r(0.02, 0.15), level: 0.08, modes: s.modes(s.r(2500, 4500), [1, 2.3], [0.015, 0.008]) });
    },
  },
  {
    id: 'land', variants: 3, dur: 0.6, vol: 0.4, ref: 1.5, send: 0.8, when: 'load',
    render(s) {
      s.thump(0, 110, 42, 0.06, 0.06, 1.0);
      s.burst({ color: 'pink', type: 'lowpass', f: 650, Q: 0.7, a: 0.002, tau: 0.04, level: 0.7 });
      s.modal({ start: 0.002, level: 0.25, modes: s.modes(s.r(260, 340), [1, 2.8, 5.2, 8.1], [0.12, 0.09, 0.06, 0.04]) });
      for (let i = 0; i < 5; i++) s.modal({ start: s.r(0.01, 0.12), level: 0.08, modes: s.modes(s.r(2500, 4800), [1, 2.3], [0.02, 0.01]) });
    },
  },
  {
    id: 'hurt_impact', variants: 4, dur: 0.45, vol: 0.45, maxVoices: 2, priority: 2, when: 'load',
    render(s) {
      const d = s.gain(1);
      s.chain(d, s.shaper('tanh', 3), s.out);
      s.thump(0, 95, 38, 0.05, 0.06, 1.0, d);
      s.burst({ color: 'pink', type: 'lowpass', f: 450, Q: 0.9, a: 0.001, tau: 0.045, level: 0.8, dst: d });
      s.burst({ color: 'white', type: 'bandpass', f: s.r(900, 1400), Q: 0.8, a: 0.0005, tau: 0.018, level: 0.45 });
    },
  },
  {
    id: 'ear_ring', variants: 2, dur: 3.2, vol: 0.09, maxVoices: 1, bus: 'ui', pitchVar: 0.08, priority: 2,
    render(s) {
      const f = s.r(3600, 4600);
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.04, 1], [0.4, 0.7], [3.1, 0]]);
      s.chain(s.osc('sine', f, 0, 3.2), g, s.out);
      const g2 = s.gain(0);
      s.env(g2.gain, [[0, 0], [0.08, 0.45], [2.6, 0]]);
      s.chain(s.osc('sine', f * 1.0021, 0, 3.2), g2, s.out);
    },
  },
  {
    id: 'flashlight_on', variants: 2, dur: 0.12, vol: 0.25, when: 'load',
    render(s) { clack(s, 0, s.r(2600, 3000), 0.6, 0.006); clack(s, 0.022, s.r(1700, 2000), 0.4, 0.008); },
  },
  {
    id: 'flashlight_off', variants: 2, dur: 0.12, vol: 0.25, when: 'load',
    render(s) { clack(s, 0, s.r(1700, 2000), 0.45, 0.008); clack(s, 0.018, s.r(2600, 3000), 0.5, 0.006); },
  },
  {
    id: 'pickup_ammo', variants: 2, dur: 0.6, vol: 0.4,
    render(s) {
      for (let i = 0; i < s.ri(7, 11); i++) s.modal({ start: s.r(0, 0.22), level: s.r(0.15, 0.35), modes: s.modes(s.r(3500, 5500), [1, 2.7, 5.1], [0.05, 0.03, 0.015]) });
      s.thump(0.01, 260, 130, 0.03, 0.03, 0.4);
      s.burst({ color: 'pink', type: 'bandpass', f: 900, Q: 0.8, a: 0.002, tau: 0.03, level: 0.25 });
    },
  },
  {
    id: 'pickup_medkit', variants: 2, dur: 1.1, vol: 0.35,
    render(s) {
      clack(s, 0, 1800, 0.4, 0.01); // latch
      s.thump(0.01, 300, 160, 0.02, 0.015, 0.3);
      // injector hiss
      s.burst({ start: 0.16, color: 'white', type: 'highpass', f: 3200, Q: 0.6, a: 0.02, tau: 0.22, hold: 0.1, level: 0.45 });
      s.burst({ start: 0.16, color: 'white', type: 'bandpass', f: 4500, Q: 1.2, a: 0.01, tau: 0.12, level: 0.25 });
      clack(s, 0.14, 3200, 0.25, 0.008);
    },
  },
  {
    id: 'pickup_weapon', variants: 2, dur: 0.9, vol: 0.5,
    render(s) {
      const n = s.noise('pink', 0, 0.25);
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.05, 0.3], [0.2, 0]]);
      s.chain(n, s.bp(1300, 0.8), g, s.out);
      clack(s, 0.08, 900, 0.6, 0.05);
      s.thump(0.08, 180, 90, 0.03, 0.03, 0.4);
      clack(s, 0.32, 2400, 0.4, 0.015);
      clack(s, 0.44, 1300, 0.8, 0.04);
    },
  },
  {
    id: 'pickup_keycard', variants: 1, dur: 0.5, vol: 0.35,
    render(s) {
      s.modal({ start: 0, level: 0.5, modes: s.modes(1600, [1, 2.3, 4.1], [0.015, 0.01, 0.006]) });
      for (const [t, f] of [[0.08, 1760], [0.15, 2350]] as const) {
        const o = s.osc('square', f, t, 0.06);
        const g = s.ad(t, 0.002, 0.12, 0.02, 0.03);
        s.chain(o, s.lp(4000), g, s.out);
      }
    },
  },
  {
    id: 'heartbeat', variants: 2, dur: 0.75, vol: 0.55, bus: 'ui', maxVoices: 2, pitchVar: 0.02, when: 'load',
    render(s) {
      const lp = s.lp(260);
      lp.connect(s.out);
      s.thump(0, 62, 38, 0.06, 0.06, 1.0, lp);
      s.burst({ color: 'brown', type: 'lowpass', f: 140, Q: 0.7, a: 0.008, tau: 0.04, level: 0.6, dst: lp });
      const t2 = s.r(0.17, 0.2);
      s.thump(t2, 70, 44, 0.05, 0.05, 0.7, lp);
      s.burst({ start: t2, color: 'brown', type: 'lowpass', f: 160, Q: 0.7, a: 0.006, tau: 0.03, level: 0.4, dst: lp });
    },
  },
  {
    id: 'player_death', variants: 1, dur: 4.0, vol: 0.8, bus: 'ui', priority: 4,
    render(s) {
      // collapse
      s.thump(0, 90, 35, 0.08, 0.1, 1.0);
      s.burst({ color: 'pink', type: 'lowpass', f: 500, Q: 0.7, a: 0.002, tau: 0.06, level: 0.8 });
      s.modal({ start: 0.01, level: 0.3, modes: s.modes(280, [1, 2.8, 5.2], [0.15, 0.1, 0.06]) });
      s.thump(0.25, 80, 40, 0.06, 0.07, 0.5);
      // heart slowing to a stop
      let t = 0.6;
      for (let i = 0; i < 4; i++) {
        const lv = 0.7 * Math.pow(0.7, i);
        s.thump(t, 58, 36, 0.06, 0.06, lv); s.thump(t + 0.2, 66, 40, 0.05, 0.05, lv * 0.7);
        t += 0.75 + i * 0.25;
      }
      // the floor drops away
      const o = s.osc('sine', 70, 0.2, 3.7);
      s.env(o.frequency, [[0.2, 70], [3.9, 24]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0.2, 0], [1.0, 0.45], [3.9, 0]]);
      s.chain(o, g, s.out);
      const r = s.osc('sine', 3900, 0.1, 3.8);
      const rg = s.gain(0);
      s.env(rg.gain, [[0.1, 0], [0.3, 0.05], [3.9, 0]]);
      s.chain(r, rg, s.out);
    },
  },
];
