/** Pre-rendered instruments used by the generative music engine (bus 'music', played via music.ts). */
import type { SoundDef } from '../synth/core';
import { saturate } from '../synth/post';

export const musicSounds: SoundDef[] = [
  {
    id: 'mus_kick', variants: 3, dur: 0.7, vol: 0.9, bus: 'music', when: 'idle', pitchVar: 0,
    render(s) {
      const d = s.gain(1);
      s.chain(d, s.shaper('tanh', 4), s.lp(2800), s.out);
      s.thump(0, 160, 44, 0.07, 0.16, 1.2, d);
      s.click(0, 0.5, 1500, 0.002, d);
      s.burst({ color: 'pink', type: 'lowpass', f: 600, Q: 0.7, a: 0.001, tau: 0.03, level: 0.5, dst: d });
    },
    post(ch) { saturate(ch, 1.5); },
  },
  {
    id: 'mus_snare', variants: 3, dur: 0.8, vol: 0.6, bus: 'music', when: 'idle', pitchVar: 0,
    render(s) {
      const d = s.gain(1);
      s.chain(d, s.shaper('tanh', 2.5), s.out);
      s.burst({ color: 'white', type: 'bandpass', f: s.r(1500, 2200), Q: 0.6, a: 0.001, tau: 0.09, level: 0.9, dst: d });
      s.thump(0, 220, 140, 0.03, 0.05, 0.6, d);
      s.modal({ level: 0.35, modes: s.modes(s.r(330, 420), [1, 2.32, 4.25, 6.63], [0.25, 0.18, 0.12, 0.08]), dst: d });
    },
  },
  {
    id: 'mus_hat', variants: 3, dur: 0.15, vol: 0.25, bus: 'music', when: 'idle', pitchVar: 0,
    render(s) {
      s.burst({ color: 'white', type: 'highpass', f: 7000, Q: 0.7, a: 0.0005, tau: s.r(0.01, 0.025), level: 0.8 });
      s.modal({ level: 0.2, modes: s.modes(s.r(5000, 7000), [1, 1.47, 2.03], [0.02, 0.015, 0.01]) });
    },
  },
  {
    id: 'mus_metal', variants: 6, dur: 0.8, vol: 0.4, bus: 'music', when: 'idle', pitchVar: 0,
    render(s) {
      const f0 = s.r(300, 1200);
      s.modal({ level: 0.6, modes: s.modes(f0, [1, 1.41, 2.13, 2.97, 4.07], [0.2, 0.15, 0.1, 0.06, 0.04], undefined, 0.05) });
      s.burst({ color: 'white', type: 'bandpass', f: f0 * 3, Q: 1, a: 0.0005, tau: 0.01, level: 0.5 });
    },
  },
  {
    id: 'mus_pulse', variants: 2, dur: 1.2, vol: 0.7, bus: 'music', when: 'idle', pitchVar: 0,
    render(s) {
      s.thump(0, 62, 38, 0.12, 0.25, 1.0);
      s.burst({ color: 'brown', type: 'lowpass', f: 160, Q: 0.7, a: 0.02, tau: 0.15, level: 0.5 });
    },
  },
  {
    id: 'mus_tick', variants: 3, dur: 0.1, vol: 0.2, bus: 'music', when: 'idle', pitchVar: 0,
    render(s) { s.modal({ level: 0.8, modes: s.modes(s.r(2800, 4200), [1, 2.3, 3.7], [0.01, 0.006, 0.004]) }); s.click(0, 0.3, 5000, 0.0005); },
  },
  {
    id: 'mus_bowed', variants: 3, dur: 7.0, vol: 0.45, bus: 'music', when: 'idle', pitchVar: 0, channels: 2,
    render(s, v) {
      // bowed metal at 220 Hz (pitched with playbackRate): friction noise + stick-slip saw into narrow resonators
      const f0 = 220;
      const len = 6.6;
      const env = s.gain(0);
      s.env(env.gain, [[0, 0], [1.8 + v * 0.3, 1], [4.0, 0.7], [len, 0]]);
      env.connect(s.out);
      const exc = s.gain(1);
      s.chain(s.noise('white', 0, len), s.gain(0.4), exc);
      const saw = s.osc('sawtooth', f0, 0, len);
      const jit = s.noise('brown', 0, len, 0.2);
      const jg = s.gain(3);
      jit.connect(jg); jg.connect(saw.frequency);
      s.chain(saw, s.gain(0.15), exc);
      const ratios = [1, 2.76, 5.4, 8.93, 1.502];
      ratios.forEach((r, i) => {
        const f = s.bp(f0 * r * (1 + s.r(-0.003, 0.003)), 120 + i * 40);
        s.chain(exc, f, s.gain([3, 1.6, 0.8, 0.4, 1][i] * 3), s.pan(s.r(-0.6, 0.6)), env);
      });
    },
  },
  {
    id: 'mus_riser', variants: 1, dur: 4.2, vol: 0.45, bus: 'music', when: 'idle', pitchVar: 0, channels: 2,
    render(s) {
      const len = 4;
      const n = s.noise('white', 0, len);
      const f = s.bp(300, 1.5);
      s.env(f.frequency, [[0, 250], [len, 6000]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0, 0.001], [len - 0.02, 0.7], [len, 0.0001]], 'exp');
      s.chain(n, f, g, s.out);
      for (const r of [1, 1.06, 1.5]) {
        const o = s.osc('sawtooth', 82 * r, 0, len);
        s.env(o.frequency, [[0, 82 * r], [len, 330 * r]], 'exp');
        const og = s.gain(0);
        s.env(og.gain, [[0, 0.001], [len - 0.02, 0.15], [len, 0.0001]], 'exp');
        s.chain(o, s.lp(2000), s.pan(s.r(-0.8, 0.8)), og, s.out);
      }
    },
  },
  {
    id: 'mus_boom', variants: 2, dur: 3.0, vol: 0.8, bus: 'music', when: 'idle', pitchVar: 0,
    render(s) {
      const d = s.gain(1);
      s.chain(d, s.shaper('tanh', 2), s.out);
      s.thump(0, 90, 30, 0.3, 0.5, 1.2, d);
      s.burst({ color: 'brown', type: 'lowpass', f: 700, f1: 120, sweep: 1.5, Q: 0.7, a: 0.003, tau: 0.5, level: 0.7, dst: d });
      s.modal({ level: 0.2, modes: s.modes(110, [1, 2.32, 4.25, 6.63], [1.5, 1.0, 0.6, 0.3]) });
    },
  },
  {
    id: 'mus_bell', variants: 2, dur: 7.0, vol: 0.35, bus: 'music', when: 'idle', pitchVar: 0, channels: 2,
    render(s) {
      const f0 = 110;
      const modes = s.modes(f0, [0.5, 1, 1.19, 1.56, 2, 2.51, 2.66, 3.01], [4, 3.2, 2.6, 2, 1.6, 1.2, 1, 0.8], [0.6, 1, 0.5, 0.6, 0.4, 0.3, 0.25, 0.15], 0.004);
      s.modal({ level: 0.5, modes: modes.slice(0, 4), dst: s.pan(-0.3).connect(s.out) as AudioNode, attack: 0.004 });
      s.modal({ level: 0.5, modes: modes.slice(4), dst: s.pan(0.3).connect(s.out) as AudioNode, attack: 0.004 });
    },
  },
];
