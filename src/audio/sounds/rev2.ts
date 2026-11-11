/**
 * Revision 2 one-shots (vignettes, PA chime, dread ambience) and the beds for `quarters` / `pump`.
 * Everything renders in the background ('idle' / 'late'), nothing is added to the awaited load set.
 */
import { SR, modalData, type SoundDef, type Synth } from '../synth/core';
import { buildVoice, planText } from '../synth/formant';
import { decimate, dropouts, saturate, stutter } from '../synth/post';
import { clack, scrape } from './weapons';
import { clunk, servo } from './world';

type Mode = [number, number, number];

/** Modal ring that is guaranteed to end (faded) by `end` (variant-relative), so long rings never
 *  bleed into the next variation's slot of the shared offline render. */
function ring(s: Synth, start: number, modes: Mode[], level: number, end: number, dst?: AudioNode): void {
  const dur = Math.max(0.05, end - start);
  const d = modalData(dur, modes, s.rnd);
  const fade = Math.min(d.length, Math.floor(0.12 * SR));
  for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
  s.chain(s.data(d, start), s.gain(level), dst ?? s.out);
}

const cents = (c: number) => Math.pow(2, c / 1200);

/** Bell-ish electronic chime tone (sine + weak partials, slight beating partner). */
function chimeTone(s: Synth, t: number, f: number, level: number, dst: AudioNode, sag = 0): void {
  const parts: Array<[number, number, number]> = [[1, 1, 0.62], [1.0035, 0.28, 0.55], [2, 0.2, 0.3], [3.01, 0.06, 0.16]];
  for (const [r, a, tau] of parts) {
    const o = s.tone({ start: t, f: f * r, a: 0.009, tau, level: level * a, dst });
    if (sag) s.env(o.frequency, [[t, f * r], [t + 0.9, f * r * (1 - sag)]], 'exp');
  }
}

/** Short heavy step (muffled through a floor / at distance). */
function farStep(s: Synth, t: number, lv: number, heavy: boolean, dst: AudioNode): void {
  s.thump(t, heavy ? 92 : 112, 40, 0.04, heavy ? 0.065 : 0.04, lv, dst);
  s.burst({ start: t, color: 'pink', type: 'lowpass', f: 500, Q: 0.8, a: 0.003, tau: 0.035, level: lv * 0.6, dst });
  s.modal({ start: t, level: lv * 0.16, modes: s.modes(s.r(220, 300), [1, 2.7, 5.1], [0.09, 0.06, 0.04]), dst });
}

const WHISPER = ['please hold still', 'thank you for', 'how may i', 'mind the step', 'almost there', 'sorry, sorry'];

/** Pipe knock fundamentals: monotonic so a cycled sequence reads as moving along the run. */
const PIPE_F = [176, 192, 209, 228, 248, 270];

export const rev2Sounds: SoundDef[] = [
  // ───────────────────────────── PA chime (before CHOIR announcements)
  {
    id: 'pa_chime', variants: 4, dur: 3.6, vol: 0.32, bus: 'voice', ref: 8, rolloff: 0.5, send: 1.1, maxVoices: 1, minInterval: 1,
    priority: 3, pitchVar: 0, volVar: 0.04, when: 'idle',
    render(s, v) {
      // cheap ceiling speaker: band-limited, a little overdriven, then a hard room tail
      const sum = s.gain(1);
      const band = s.chain(sum, s.hp(480, 0.9), s.pk(1500, 1.2, 5), s.shaper('tanh', 2.2), s.lp(3200), s.hp(380)) as AudioNode;
      band.connect(s.out);
      const fbIn = s.gain(1), fbD = s.delay(0.137), fbG = s.gain(0.42);
      (s.chain(band, s.delay(0.019), s.lp(2600), s.gain(0.3)) as AudioNode).connect(s.out);
      s.chain(band, s.gain(0.5), fbIn);
      s.chain(fbIn, fbD, s.lp(1800), fbG, fbIn);
      s.chain(fbIn, s.gain(0.55), s.out);
      // speaker opening + hiss under the chime
      s.click(0, 0.05, 800, 0.003, sum);
      const hissG = s.gain(0);
      s.env(hissG.gain, [[0, 0], [0.05, 0.012], [2.2, 0.012], [2.6, 0]]);
      s.chain(s.noise('white', 0, 2.7), s.bp(2400, 0.8), hissG, sum);
      const pats: Array<Array<[number, number, number, number?]>> = [
        [[0.06, 784, 1], [0.64, 622.3 * cents(-38), 0.9]],
        [[0.06, 880, 1], [0.6, 698.5 * cents(-30), 0.85]],
        [[0.06, 659.3, 0.9], [0.44, 830.6, 0.9], [0.86, 587.3 * cents(-25), 0.8]],
        [[0.06, 740, 1], [0.68, 554.4, 0.85, 0.03]],
      ];
      for (const [t, f, lv, sag] of pats[v]) chimeTone(s, t, f, lv * 0.5, sum, sag ?? 0);
    },
  },
  // ───────────────────────────── quarters
  {
    id: 'locker_bang', variants: 4, dur: 1.3, vol: 0.75, ref: 3, send: 1.1, maxVoices: 2, minInterval: 0.12, pitchVar: 0.05, when: 'idle',
    render(s, v) {
      const hits: Array<[number, number]> = v === 3 ? [[0, 1], [0.15, 0.7]] : [[0, s.r(0.85, 1)]];
      const panelF = s.r(95, 125);
      for (const [t, lv] of hits) {
        s.thump(t, s.r(120, 140), s.r(50, 60), 0.05, 0.07, lv);
        s.burst({ start: t, color: 'pink', type: 'lowpass', f: 450, Q: 0.7, a: 0.002, tau: 0.045, level: lv * 0.8 });
        // sheet-steel panel: dense inharmonic modes
        ring(s, t, s.modes(panelF, [1, 1.62, 2.13, 2.87, 3.4, 4.31, 5.2, 6.6, 8.1], [0.3, 0.26, 0.22, 0.19, 0.16, 0.13, 0.1, 0.08, 0.06], [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25], 0.05), lv * 0.5, 1.28);
        // door rattling in its frame (1–4 kHz micro impacts at ~30/s)
        let tt = t + 0.012, a = lv * 0.55;
        const gap = 1 / s.r(28, 40);
        while (a > 0.02 && tt < t + 0.65) {
          s.modal({ start: tt, level: a, modes: s.modes(s.r(1400, 3600), [1, 1.7, 2.6], [0.012, 0.009, 0.006]) });
          s.click(tt, a * 0.35, 3000, 0.0006);
          tt += gap * s.r(0.7, 1.3); a *= s.r(0.8, 0.92);
        }
        // latch buzz
        const n = s.noise('white', t, 0.45);
        const am = s.osc('square', s.r(55, 80), t, 0.45);
        const amg = s.gain(0.5), mix = s.gain(0.5);
        am.connect(amg); amg.connect(mix.gain);
        s.chain(n, s.bp(s.r(1900, 2600), 4), mix, s.ad(t + 0.005, 0.003, lv * 0.45, 0.07), s.out);
      }
    },
  },
  {
    id: 'curtain_rail', variants: 3, dur: 1.2, vol: 0.45, ref: 2.5, send: 0.9, maxVoices: 1, minInterval: 0.3, when: 'idle',
    render(s) {
      const len = s.r(0.65, 0.82);
      // ring-on-rail friction
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.05, 0.22], [len * 0.7, 0.18], [len, 0]]);
      const sum = s.gain(1);
      const n = s.noise('white', 0, len + 0.05);
      s.chain(n, s.bp(s.r(2800, 3600), 6), sum);
      s.chain(n, s.bp(s.r(4500, 5600), 8), s.gain(0.6), sum);
      const wob = s.gain(0.6);
      s.chain(s.noise('brown', 0, len + 0.05, 0.3), wob); wob.connect(sum.gain);
      s.chain(sum, g, s.out);
      // individual rings clicking over the rail joints
      for (let t = 0.01; t < len; t += s.r(0.012, 0.05)) {
        s.modal({ start: t, level: s.r(0.05, 0.18), modes: s.modes(s.r(2200, 5500), [1, 1.9, 3.1], [0.03, 0.02, 0.01]) });
      }
      // fabric swish
      s.chain(s.noise('pink', 0, len + 0.3), s.bp(1300, 0.6), s.swell(0, len * 0.4, 0.14, len * 0.3, 0.2), s.out);
      // rings bunch up at the end
      const k = s.ri(4, 6);
      let t = len;
      for (let i = 0; i < k; i++) { clack(s, t, s.r(2000, 3200), 0.1 * (1 - i * 0.12), 0.02); t += s.r(0.012, 0.025); }
    },
  },
  {
    id: 'lamp_creak', variants: 4, dur: 1.4, vol: 0.2, ref: 2, send: 0.6, maxVoices: 1, minInterval: 1, pitchVar: 0.06, when: 'idle',
    render(s) {
      // a pendant lamp's chain link: stick-slip squeak on the swing out and back
      const f = s.r(1100, 1900);
      for (let k = 0; k < 2; k++) {
        const t = 0.02 + k * s.r(0.45, 0.62), len = s.r(0.16, 0.3), lv = k ? s.r(0.4, 0.7) : 1;
        const exc = s.osc('sawtooth', s.r(25, 45), t, len + 0.05);
        s.env(exc.frequency, [[t, s.r(22, 35)], [t + len, s.r(40, 60)]], 'exp');
        const nz = s.noise('white', t, len + 0.05);
        const src = s.gain(1);
        s.chain(exc, s.gain(0.6), src); s.chain(nz, s.gain(0.15), src);
        const g = s.gain(0);
        s.env(g.gain, [[t, 0], [t + len * 0.3, lv], [t + len, 0]]);
        const out = s.gain(1);
        s.chain(src, s.bp(f * (k ? 0.97 : 1), 12), s.gain(3), out);
        s.chain(src, s.bp(f * 1.9, 14), s.gain(1.5), out);
        s.chain(out, g, s.out);
        if (s.chance(0.6)) s.modal({ start: t + len * s.r(0.3, 0.9), level: 0.12, modes: s.modes(s.r(3000, 4200), [1, 2.3], [0.02, 0.01]) });
      }
    },
  },
  // ───────────────────────────── med
  {
    id: 'monitor_beep', variants: 3, dur: 0.3, vol: 0.22, ref: 2, maxVoices: 2, minInterval: 0.08, pitchVar: 0.002, volVar: 0.03, send: 0.6, when: 'idle',
    render(s, v) {
      const f = [960, 960, 1000][v], len = [0.11, 0.13, 0.1][v];
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.003, 0.5], [len, 0.5], [len + 0.012, 0]]);
      const mix = s.gain(1);
      s.chain(s.osc('sine', f, 0, len + 0.03), mix);
      s.chain(s.osc('sine', f * 2, 0, len + 0.03), s.gain(0.03), mix);
      s.chain(mix, g, s.out);
      s.click(0, 0.04, 3000, 0.0005);
    },
  },
  // ───────────────────────────── airlock
  {
    id: 'glass_thump', variants: 3, dur: 0.9, vol: 0.6, ref: 2.5, send: 1.0, maxVoices: 2, minInterval: 0.15, when: 'late',
    render(s) {
      s.thump(0, s.r(150, 180), s.r(70, 85), 0.03, 0.05, 1);
      s.burst({ color: 'pink', type: 'lowpass', f: 700, Q: 0.8, a: 0.002, tau: 0.03, level: 0.8 });
      // thick pane: dull low modes
      s.modal({ level: 0.35, modes: s.modes(s.r(160, 210), [1, 2.3, 3.9, 5.6], [0.09, 0.06, 0.04, 0.025], [1, 0.6, 0.4, 0.2], 0.04) });
      // wet splat
      for (let k = 0; k < s.ri(3, 6); k++) s.burst({ start: s.r(0.002, 0.04), color: 'white', type: 'bandpass', f: s.r(1200, 3000), Q: 2, a: 0.0005, tau: s.r(0.003, 0.008), level: s.r(0.1, 0.25) });
      // squeak of skin dragging on glass
      const t = s.r(0.12, 0.25), len = s.r(0.15, 0.35), f0 = s.r(700, 1100);
      const o = s.osc('sawtooth', f0, t, len + 0.05);
      s.env(o.frequency, [[t, f0], [t + len * 0.4, f0 * s.r(1.15, 1.35)], [t + len, f0 * s.r(0.8, 1)]], 'exp');
      const fm = s.osc('sine', s.r(30, 50), t, len + 0.05);
      const fmg = s.gain(f0 * 0.03);
      fm.connect(fmg); fmg.connect(o.frequency);
      const ss = s.osc('square', s.r(25, 45), t, len + 0.05);
      const ssg = s.gain(0.5), am = s.gain(0.5);
      ss.connect(ssg); ssg.connect(am.gain);
      const g = s.gain(0);
      s.env(g.gain, [[t, 0], [t + 0.03, 0.32], [t + len * 0.7, 0.25], [t + len, 0]]);
      s.chain(o, s.bp(1800, 3), am, g, s.out);
    },
  },
  // ───────────────────────────── fab
  {
    id: 'conveyor_clunk', variants: 3, dur: 5.0, vol: 0.85, ref: 7, rolloff: 0.7, send: 1.6, maxVoices: 2, minInterval: 0.5, priority: 3, when: 'late',
    render(s) {
      servo(s, 0, 0.35, s.r(70, 90), s.r(110, 130), 0.18);
      const t = s.r(0.3, 0.38);
      // ratchet pawl
      let tt = t - 0.16;
      for (let i = 0; i < s.ri(3, 5); i++) { clack(s, tt, s.r(900, 1300), 0.35, 0.04); tt += s.r(0.035, 0.06); }
      // the clunk
      clunk(s, t, s.r(55, 70), 1.0, 0.5);
      s.thump(t, 70, 30, 0.15, 0.25, 1.1);
      // whole structure rings (hall IR adds the long tail)
      ring(s, t, s.modes(s.r(48, 60), [1, 1.53, 2.47, 3.6, 5.1, 7.3], [0.7, 0.62, 0.5, 0.4, 0.3, 0.2], [1, 0.8, 0.6, 0.45, 0.3, 0.2], 0.02), 0.45, 4.95);
      ring(s, t + 0.01, s.modes(s.r(380, 520), [1, 2.7, 5.2], [0.5, 0.3, 0.15]), 0.12, 4.95);
      // chain rattle, then two smaller swings of the hooks
      for (const [st, n, a, span] of [[0.02, 40, 0.25, 1.1], [0.85, 14, 0.1, 0.4], [1.5, 9, 0.06, 0.35]] as const) {
        for (let i = 0; i < n; i++) {
          const dt = Math.pow(s.rnd(), 1.8) * span;
          s.modal({ start: t + st + dt, level: a * (1 - dt / (span * 1.1)) * s.r(0.4, 1), modes: s.modes(s.r(600, 2500), [1, 2.1, 3.4], [0.02, 0.014, 0.008]) });
        }
      }
      s.burst({ start: t, color: 'brown', type: 'lowpass', f: 220, Q: 0.7, a: 0.01, tau: 0.5, level: 0.5 });
    },
  },
  // ───────────────────────────── storage
  {
    id: 'canister_roll', variants: 3, dur: 4.0, vol: 0.7, ref: 4, send: 1.3, maxVoices: 1, minInterval: 1, priority: 2, when: 'late',
    render(s) {
      scrape(s, 0, 0.18, s.r(1200, 1800), 0.12);
      const f0 = s.r(320, 420);
      const CYL = [1, 1.47, 2.09, 2.83, 3.71, 4.68];
      const t1 = s.r(0.22, 0.3);
      // falls over: clang
      ring(s, t1, s.modes(f0, CYL, [0.45, 0.38, 0.3, 0.24, 0.18, 0.12], [1, 0.8, 0.7, 0.5, 0.35, 0.25], 0.02), 0.6, 3.95);
      s.thump(t1, 160, 60, 0.04, 0.06, 0.9);
      s.click(t1, 0.5, 2500, 0.002);
      // one bounce
      const t2 = t1 + s.r(0.12, 0.18);
      ring(s, t2, s.modes(f0, CYL, [0.3, 0.25, 0.2, 0.15, 0.1, 0.08], [1, 0.7, 0.6, 0.4, 0.3, 0.2], 0.02), 0.25, 3.95);
      s.thump(t2, 150, 70, 0.03, 0.04, 0.4);
      // roll
      const r0 = t2 + 0.05, rLen = s.r(2.2, 2.5), tEnd = r0 + rLen;
      const env = (g: GainNode, pk: number) => s.env(g.gain, [[r0, 0], [r0 + 0.15, pk], [r0 + rLen * 0.6, pk * 0.65], [tEnd, pk * 0.25], [tEnd + 0.08, 0]]);
      const rot = s.osc('sine', 4.5, r0, rLen + 0.1);
      s.env(rot.frequency, [[r0, 4.5], [tEnd, 1.8]], 'exp');
      const rotG = s.gain(0.35);
      rot.connect(rotG);
      const rum = s.gain(0); env(rum, 0.8);
      const rumAm = s.gain(1); rotG.connect(rumAm.gain);
      s.chain(s.noise('brown', r0, rLen + 0.1), s.lp(220), rumAm, rum, s.out);
      const hol = s.gain(0); env(hol, 0.5);
      const hn = s.noise('pink', r0, rLen + 0.1);
      for (const [r, q, a] of [[1, 30, 1], [1.47, 30, 0.7], [2.09, 25, 0.5]] as const) s.chain(hn, s.bp(f0 * r, q), s.gain(a * 3), hol);
      hol.connect(s.out);
      // seam bump each rotation, slowing
      let tb = r0 + 0.1, per = 0.22;
      while (tb < tEnd - 0.1) {
        const k = 1 - (tb - r0) / rLen;
        s.thump(tb, 140, 80, 0.02, 0.03, 0.25 * k + 0.08);
        s.modal({ start: tb, level: 0.08 * k + 0.02, modes: s.modes(f0, [1, 1.47, 2.09], [0.15, 0.1, 0.07]) });
        tb += per; per *= 1.11;
      }
      // stops against something
      s.thump(tEnd, 130, 55, 0.04, 0.06, 0.45);
      ring(s, tEnd, s.modes(f0 * 0.98, CYL, [0.25, 0.2, 0.16, 0.12, 0.1, 0.08], [1, 0.8, 0.6, 0.45, 0.3, 0.2], 0.03), 0.22, 3.95);
      clack(s, tEnd + 0.01, s.r(700, 1000), 0.12, 0.05);
    },
  },
  // ───────────────────────────── elevator
  {
    id: 'gate_rattle', variants: 3, dur: 3.6, vol: 0.8, ref: 5, send: 1.4, maxVoices: 1, minInterval: 0.6, priority: 2, when: 'late',
    render(s) {
      s.thump(0, 120, 45, 0.05, 0.08, 1.1);
      s.burst({ color: 'pink', type: 'lowpass', f: 1800, Q: 0.7, a: 0.0005, tau: 0.03, level: 0.9 });
      ring(s, 0, s.modes(s.r(140, 190), [1, 2.32, 3.9, 5.6, 7.7, 10.4], [0.45, 0.35, 0.28, 0.2, 0.14, 0.09], [1, 0.8, 0.6, 0.45, 0.3, 0.2], 0.04), 0.5, 3.55);
      s.click(0, 0.6, 2500, 0.002);
      // gate bouncing in its frame: chain-link bursts at a slowing swing rate
      let t = 0.02, a = 0.5, per = 1 / s.r(7, 9);
      while (t < 2.9 && a > 0.012) {
        for (let k = 0; k < s.ri(3, 7); k++) s.modal({ start: t + s.r(0, per * 0.5), level: a * s.r(0.3, 1), modes: s.modes(s.r(900, 3800), [1, 1.8, 2.9], [0.03, 0.02, 0.012]) });
        s.modal({ start: t, level: a * 0.3, modes: s.modes(s.r(300, 420), [1, 2.6, 4.4], [0.12, 0.07, 0.04]) });
        t += per; per *= 1.04; a *= 0.87;
      }
      // the hanging chain keeps jingling a little
      for (let i = 0; i < 12; i++) s.modal({ start: s.r(0.4, 2.6), level: s.r(0.02, 0.06), modes: s.modes(s.r(2500, 5000), [1, 2.2], [0.03, 0.015]) });
    },
  },
  // ───────────────────────────── pump
  {
    id: 'pipe_knock', variants: 6, dur: 2.0, vol: 0.6, ref: 4, rolloff: 0.8, send: 1.5, maxVoices: 3, minInterval: 0.08, pitchVar: 0.008, when: 'idle', order: 'cycle',
    render(s, v) {
      const f0 = PIPE_F[v];
      const d = s.lp(1800, 0.7);
      d.connect(s.out);
      s.click(0, 0.4, 2500, 0.0015, d);
      s.thump(0, f0 * 0.9, f0 * 0.45, 0.03, 0.04, 0.8, d);
      ring(s, 0, s.modes(f0, [1, 2.76, 5.4, 8.93], [0.26, 0.14, 0.07, 0.04], [1, 0.55, 0.25, 0.1], 0.01), 0.6, 1.95, d);
      ring(s, 0, [[f0 * 0.5, 0.11, 1]], 0.35, 1.95, d); // water column
      ring(s, 0.005, [[f0 * 1.003, 0.28, 1]], 0.12, 1.95, d);
    },
  },
  {
    id: 'water_slosh', variants: 3, dur: 3.0, vol: 0.55, ref: 4, send: 1.5, maxVoices: 2, minInterval: 0.5, when: 'late',
    render(s) {
      const len = s.r(1.6, 2.3);
      for (const [t, d, lv] of [[0, len * 0.5, 1], [len * 0.42, len * 0.55, 0.75]] as const) {
        const f = s.r(350, 600);
        const b = s.bp(f, 1.2);
        s.env(b.frequency, [[t, f * 0.7], [t + d * 0.4, f * 1.4], [t + d, f * 0.8]], 'exp');
        s.chain(s.noise('pink', t, d + 0.4), b, s.swell(t, d * 0.35, lv * 0.5, d * 0.25, d * 0.5), s.out);
        s.chain(s.noise('brown', t, d + 0.4), s.lp(180), s.swell(t, d * 0.4, lv * 0.6, d * 0.2, d * 0.5), s.out);
      }
      // bubbles
      for (let i = 0; i < s.ri(10, 18); i++) {
        const t = s.r(0.05, len), f = s.r(250, 1100), dd = s.r(0.02, 0.05);
        const o = s.osc('sine', f, t, dd + 0.08);
        s.env(o.frequency, [[t, f], [t + dd, f * s.r(1.5, 2.5)]], 'exp');
        s.chain(o, s.ad(t, 0.002, s.r(0.05, 0.16), s.r(0.01, 0.03)), s.out);
      }
      // water falling back
      for (let i = 0; i < s.ri(8, 14); i++) {
        const t = s.r(0.3, len + 0.4);
        s.burst({ start: t, color: 'white', type: 'bandpass', f: s.r(2000, 4000), Q: 1.5, a: 0.001, tau: s.r(0.004, 0.012), level: s.r(0.04, 0.12) });
      }
    },
  },
  // ───────────────────────────── husk whisper (single, small, close)
  {
    id: 'husk_whisper', variants: 6, dur: 2.2, vol: 0.28, ref: 2, rolloff: 1.2, send: 0.9, maxVoices: 1, minInterval: 1.2, pitchVar: 0.05, when: 'idle',
    render(s, v) {
      const plan = planText(WHISPER[v], s.r(0.9, 1.4), s.rnd);
      const dst = s.gain(1);
      s.chain(dst, s.hp(450), s.pk(1800, 1.4, 6), s.shaper('hard', 2.2), s.lp(3400), s.gain(0.8), s.out);
      buildVoice(s, plan, { f0: s.r(150, 200), fscale: 1.2, level: 1, delay: 0.03, jitter: 0.008, contour: 4, style: 'cheerful', vibrato: 0.003, breath: 0.45, dst, saw: true, pitchJumps: 6 });
    },
    post(ch, rnd) { stutter(ch, rnd, 2 + Math.floor(rnd() * 2), 25, 60, 0.1, 0.8); dropouts(ch, rnd, 2, 10, 40); decimate(ch, rnd, 1, 40, 120, 8, 4); saturate(ch, 1.4); },
  },
  // ───────────────────────────── dread ambience (played by the generative layer)
  {
    id: 'breath_far', variants: 3, dur: 4.0, vol: 0.2, ref: 3, rolloff: 0.8, send: 1.6, maxVoices: 1, minInterval: 4, pitchVar: 0.05, when: 'idle',
    render(s) {
      const t0 = 0.05, len = s.r(2.2, 3.0);
      const src = s.gain(1);
      s.chain(s.noise('pink', 0, len + 0.4), s.gain(0.8), src);
      s.chain(s.noise('white', 0, len + 0.4), s.gain(0.2), src);
      // mechanical "fry": the exhale is chopped very slightly
      const fry = s.gain(0.8);
      const fo = s.osc('square', s.r(22, 32), 0, len + 0.4);
      const fg = s.gain(0.2);
      fo.connect(fg); fg.connect(fry.gain);
      const amp = s.gain(0);
      s.env(amp.gain, [[t0, 0], [t0 + len * 0.15, 0.5], [t0 + len * 0.35, 1], [t0 + len * 0.65, 0.75], [t0 + len * 0.9, 0.2], [t0 + len, 0]]);
      src.connect(fry); fry.connect(amp);
      const sum = s.gain(1);
      for (const [f, q, a] of [[s.r(460, 540), 4, 1], [s.r(1250, 1500), 6, 0.6], [s.r(2300, 2700), 8, 0.25]] as const) {
        const b = s.bp(f, q);
        s.env(b.frequency, [[t0, f], [t0 + len, f * 0.9]], 'exp');
        s.chain(amp, b, s.gain(a * 2), sum);
      }
      s.chain(sum, s.lp(1800), s.hp(120), s.out);
      // valve closes
      const tv = t0 + len + s.r(0.05, 0.15);
      clack(s, tv, s.r(1200, 1700), 0.05, 0.02);
      s.thump(tv, 300, 150, 0.01, 0.012, 0.05);
    },
  },
  {
    id: 'far_steps', variants: 3, dur: 6.5, vol: 0.5, ref: 5, rolloff: 0.6, send: 1.8, maxVoices: 1, minInterval: 3, pitchVar: 0.04, when: 'idle',
    render(s) {
      const d = s.lp(1100);
      d.connect(s.out);
      // a limp: firm step, long hang, weak dragged step, quick recovery
      const n = s.ri(6, 9);
      const longGap = s.r(0.8, 1.0), shortGap = s.r(0.42, 0.52);
      let t = 0.3;
      for (let i = 0; i < n && t < 6.0; i++) {
        const heavy = i % 2 === 0;
        if (!heavy) {
          const g = s.gain(0);
          s.env(g.gain, [[t - 0.24, 0], [t - 0.12, 0.25], [t, 0]]);
          s.chain(s.noise('pink', t - 0.24, 0.26), s.bp(700, 0.8), g, d);
        }
        farStep(s, t, heavy ? 1 : 0.5, heavy, d);
        t += heavy ? longGap : shortGap;
        if (i === Math.floor(n / 2) && s.chance(0.6)) t += s.r(0.7, 1.1); // stops... listens... goes on
      }
    },
  },
  {
    id: 'drag_far', variants: 3, dur: 4.6, vol: 0.5, ref: 5, rolloff: 0.6, send: 1.8, maxVoices: 1, minInterval: 3, when: 'idle',
    render(s) {
      const d = s.lp(1400);
      d.connect(s.out);
      let t = 0.05;
      const pulls = s.ri(2, 3);
      for (let k = 0; k < pulls && t < 3.6; k++) {
        const len = Math.min(s.r(0.6, 1.1), 4.0 - t);
        const ss = s.osc('sawtooth', s.r(9, 16), t, len + 0.1);
        s.env(ss.frequency, [[t, s.r(8, 12)], [t + len, s.r(12, 18)]], 'exp');
        const ssg = s.gain(0.6), slip = s.gain(0.4);
        ss.connect(ssg); ssg.connect(slip.gain);
        const g = s.gain(0);
        s.env(g.gain, [[t, 0], [t + len * 0.25, 0.7], [t + len * 0.8, 0.6], [t + len, 0]]);
        s.chain(s.noise('pink', t, len + 0.1), s.bp(s.r(350, 600), 1.5), slip, g, d);
        s.chain(s.noise('brown', t, len + 0.1), s.lp(160), s.swell(t, len * 0.3, 0.6, len * 0.4, len * 0.3), d);
        if (s.chance(0.5)) scrape(s, t + len * 0.2, len * 0.5, s.r(900, 1400), 0.05, d);
        t += len + s.r(0.4, 0.9);
      }
    },
  },
  {
    id: 'pipe_tick', variants: 4, dur: 2.4, vol: 0.35, ref: 3, rolloff: 0.8, send: 1.6, maxVoices: 1, minInterval: 1, pitchVar: 0.08, when: 'idle',
    render(s) {
      let t = 0.02, gap = s.r(0.15, 0.3);
      const n = s.ri(3, 6);
      for (let i = 0; i < n && t < 2.0; i++) {
        s.modal({ start: t, level: s.r(0.3, 0.7), modes: s.modes(s.r(1600, 2800), [1, 2.4, 3.9], [0.05, 0.03, 0.015]) });
        s.click(t, 0.2, 3500, 0.0008);
        s.modal({ start: t, level: 0.15, modes: [[s.r(400, 600), 0.15, 1]] });
        t += gap; gap *= s.r(1.2, 1.6);
      }
    },
  },
  // ───────────────────────────── room beds
  {
    id: 'amb_quarters', loop: true, variants: 1, dur: 12, vol: 0.2, bus: 'ambience', channels: 2, when: 'idle',
    render(s) {
      const D = 12.7;
      for (const p of [-0.2, 0.2]) s.chain(s.noise('brown', 0, D), s.lp(120), s.gain(0.9), s.pan(p), s.out);
      // fabric-dead air
      s.chain(s.noise('pink', 0, D), s.bp(700, 0.7), s.gain(0.015), s.out);
      // faint electrical hum from a wall transformer, slowly breathing
      const sh = s.shaper('tanh', 2.0);
      const hb = s.gain(0.05);
      const lfo = s.osc('sine', 1 / 6, 0, D);
      const lg = s.gain(0.015);
      lfo.connect(lg); lg.connect(hb.gain);
      s.chain(sh, s.hp(90), s.lp(900), hb, s.pan(0.3), s.out);
      for (const [h, a] of [[1, 1], [2, 0.7], [3, 0.4], [5, 0.2]] as const) s.chain(s.osc('sine', 60 * h, 0, D), s.gain(a * 0.4), sh);
      s.chain(s.osc('sawtooth', 120, 0, D), s.bp(2400, 3), s.gain(0.006), s.pan(0.3), s.out);
    },
  },
  {
    id: 'amb_pump', loop: true, variants: 1, dur: 14, vol: 0.5, bus: 'ambience', channels: 2, when: 'idle',
    render(s) {
      const D = 14.7;
      // standing pipe resonances (no pump running: just the pipework ringing with air and water)
      for (const [f, q, a, p] of [[44, 9, 1.0, -0.3], [69, 11, 0.7, 0.3], [113, 14, 0.4, -0.1], [187, 18, 0.2, 0.25]] as const) {
        const g = s.gain(a * 3);
        const l = s.osc('sine', s.r(0.05, 0.12), 0, D);
        const lg = s.gain(a * 1.2);
        l.connect(lg); lg.connect(g.gain);
        s.chain(s.noise('brown', 0, D), s.bp(f, q), g, s.pan(p), s.out);
      }
      s.chain(s.osc('sine', 33, 0, D), s.gain(0.03), s.out);
      // a thin trickle somewhere
      const tr = s.gain(0.035);
      const tm = s.gain(0.035);
      s.chain(s.noise('brown', 0, D, 0.4), tm); tm.connect(tr.gain);
      s.chain(s.noise('white', 0, D), s.bp(2400, 2), tr, s.pan(0.55), s.out);
      // hollow air in a large pipe
      const hb = s.bp(420, 14);
      s.env(hb.frequency, [[0, 400], [D * 0.5, 470], [D, 400]], 'exp');
      s.chain(s.noise('pink', 0, D), hb, s.gain(0.05), s.pan(-0.5), s.out);
    },
  },
];
