/**
 * Level 3 "HALCYON HABITAT" (stage 3a, plan §2 / §4 / §5 / §8.11): the sounds of a warm, ordinary, lived-in
 * habitat — falling water, daylight lamps, a vending machine, someone's radio, soft air handling, carpet — and of
 * it going cold: the pressure door, shutters, badge reader, the purge, the takeover.
 * Nothing here is in the awaited load set. Everything is `levels: [3]` (pre-rendered in the background on level 3
 * only; still renders on demand anywhere). One-shots render 'late', loops 'lazy', beds and footsteps 'idle'.
 *
 * Ids (one-shots): pool_lap fountain_stop lamp_flicker lamps_die vending_kick vending_drop hull_creak
 *   pdoor_release pdoor_travel pdoor_seal pdoor_open pdoor_close shutter_slam shutter_roll door_chime desk_bell
 *   badge_ok badge_deny purge_cycle purge_tick purge_end chair_creak mug_clink monitor_switch screen_die
 *   office_die phone_dead habitat_takeover alarm_soft emerg_on impact_glass_hold step_carpet step_wood step_tile
 * Loops: fountain_loop lamp_hum_warm lamp_hum_cold vending_hum fridge_hum aquarium_loop radio_music radio_static
 *   hvac_loop viewport_rumble purge_air; ambience beds amb_hab amb_hab_cold amb_garden amb_lock.
 */
import type { SoundDef, Synth } from '../synth/core';
import { clack, scrape } from './weapons';
import { clunk, crackle, hiss, servo } from './world';

const L = (_s: Synth, d: number) => d + 0.7;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function drone(s: Synth, type: OscillatorType, f: number, dur: number, level: number, ...chain: AudioNode[]): OscillatorNode {
  const o = s.osc(type, f, 0, dur);
  s.chain(o, ...chain, s.gain(level), s.out);
  return o;
}

/** Noise bed with a slow random-ish amplitude wobble. */
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

function bloop(s: Synth, t: number, f0: number, level: number, dst?: AudioNode): void {
  s.tone({ start: t, f: f0, f1: f0 * s.r(1.5, 2.1), sweep: 0.07, a: 0.004, tau: 0.035, level, dst });
}

function metal(s: Synth, t: number, f0: number, level: number, ring: number, dst?: AudioNode): void {
  s.modal({ start: t, level, modes: s.modes(f0, [1, 2.13, 3.47, 5.1, 7.3], [ring, ring * 0.8, ring * 0.6, ring * 0.4, ring * 0.3], [1, 0.7, 0.5, 0.35, 0.25], 0.05), dst });
}

/** A fixed row of panners feeding the output (cheap stereo scatter for many small events). */
function scatter(s: Synth, n = 5): AudioNode[] {
  return Array.from({ length: n }, (_, i) => { const p = s.pan(-0.8 + (1.6 * i) / (n - 1)); p.connect(s.out); return p; });
}

// ───────────────────────────── footsteps (same shape as player.ts: STEP_BASE)
const STEP = { variants: 6, dur: 0.45, vol: 0.2, maxVoices: 3, priority: 0, minInterval: 0.06, ref: 1.5, send: 0.6, when: 'idle' as const, levels: [3] as const };
function heel(s: Synth, t: number, f: number, level: number): void {
  s.thump(t, f * 1.6, f, 0.025, 0.018, level);
  s.burst({ start: t, color: 'pink', type: 'lowpass', f: 700, Q: 0.7, a: 0.0015, tau: 0.014, level: level * 0.7 });
}

// ───────────────────────────── pressure door parts (plan §2.2: 12 radial dogs, 2.6 s leaves)
function dogs(s: Synth, t: number, dur: number, lvl: number): void {
  servo(s, t, dur, 140, 260, lvl * 0.35);
  for (let i = 0; i < 12; i++) {
    const tt = t + (i * dur) / 12 + s.r(-0.008, 0.008);
    clack(s, tt, s.r(450, 800), lvl * 0.4, 0.05);
    s.thump(tt, 120, 55, 0.03, 0.045, lvl * 0.45);
  }
}
function travel(s: Synth, t: number, dur: number, lvl: number, dir: 1 | -1): void {
  servo(s, t, dur, dir > 0 ? 52 : 78, dir > 0 ? 88 : 56, lvl * 0.4);
  s.burst({ start: t, color: 'brown', type: 'lowpass', f: 190, Q: 0.7, a: 0.25, hold: dur - 0.6, tau: 0.14, level: lvl * 0.9 });
  scrape(s, t + 0.1, dur - 0.3, 1700, lvl * 0.12);
  for (let x = t + 0.15; x < t + dur - 0.2; x += 0.23) s.thump(x, 95, 55, 0.03, 0.04, lvl * 0.14); // wheels on the track
  clunk(s, t + dur - 0.05, 68, lvl * 0.55, 0.22);
}
function seal(s: Synth, t: number, lvl: number): void {
  s.thump(t, 76, 27, 0.13, 0.2, lvl);
  s.burst({ start: t, color: 'brown', type: 'lowpass', f: 420, Q: 0.7, a: 0.002, tau: 0.12, level: lvl * 0.8 });
  metal(s, t, 120, lvl * 0.5, 0.7);
  dogs(s, t + 0.18, 0.55, lvl * 0.8);
  hiss(s, t + 0.75, 0.7, lvl * 0.35, 2400);
  clunk(s, t + 0.95, 90, lvl * 0.5, 0.2);
}

// ───────────────────────────── purge parts (plan D18: 15 s on a fixed clock)
function purgeTick(s: Synth, t: number, level: number, f = 1760): void {
  s.tone({ start: t, type: 'square', f, a: 0.002, hold: 0.025, tau: 0.012, level, lp: 3200 });
  s.click(t, level * 0.5, 3000, 0.002);
}
function purgeChime(s: Synth, t: number, level: number): void {
  for (const [dt, f] of [[0, 880], [0.34, 1174.7]] as const) {
    s.tone({ start: t + dt, f, a: 0.006, tau: 0.3, level });
    s.tone({ start: t + dt, f: f * 2.005, a: 0.004, tau: 0.12, level: level * 0.25 });
  }
}
function purgeEnd(s: Synth, t: number): void {
  clunk(s, t, 100, 0.55, 0.2);
  clack(s, t + 0.1, 1200, 0.3, 0.03);
  purgeChime(s, t + 0.35, 0.3);
}

// ───────────────────────────── cooler hum (vending machine / drinks fridge)
function cooler(s: Synth, dur: number, f0: number, fan: number): void {
  const D = L(s, dur);
  const sh = s.shaper('tanh', 2.0);
  s.chain(sh, s.lp(1100), s.gain(0.35), s.out);
  for (const [h, a] of [[1, 1], [2, 0.55], [3, 0.3], [4, 0.12]] as const) s.chain(s.osc('sine', f0 * h, 0, D), s.gain(a * 0.35), sh);
  drone(s, 'sine', f0 / 4, D, 0.07); // compressor shell
  bed(s, 'pink', D, fan, 0.2, s.bp(720, 0.8));
  bed(s, 'pink', D, fan * 0.35, 0.3, s.hp(3500));
}

// ───────────────────────────── the radio tune: original, 8 bars of A minor, 96 BPM, an electric piano trio
const BPM = 96, BEAT = 60 / BPM, BAR = BEAT * 4; // 20 s
const PROG: Array<{ root: number; chord: number[] }> = [
  { root: 45, chord: [60, 64, 67] }, // Am7
  { root: 50, chord: [60, 65, 69] }, // Dm7
  { root: 43, chord: [59, 62, 65] }, // G7
  { root: 48, chord: [59, 64, 67] }, // Cmaj7
  { root: 41, chord: [57, 60, 64] }, // Fmaj7
  { root: 47, chord: [57, 62, 65] }, // Bm7b5
  { root: 40, chord: [56, 62, 64] }, // E7
  { root: 45, chord: [60, 64, 67] }, // Am7
];
/** [bar, beat, midi, beats] */
const MELODY: Array<[number, number, number, number]> = [
  [0, 0, 72, 1.5], [0, 1.5, 71, 0.5], [0, 2, 69, 2],
  [1, 0, 72, 1], [1, 1, 69, 1], [1, 2, 65, 2],
  [2, 0, 67, 1.5], [2, 1.5, 65, 0.5], [2, 2, 62, 2],
  [3, 0, 64, 3],
  [4, 0.5, 69, 1], [4, 1.5, 72, 1], [4, 2.5, 76, 1.5],
  [5, 0, 74, 1.5], [5, 1.5, 72, 0.5], [5, 2, 69, 2],
  [6, 0, 68, 1], [6, 1, 71, 1], [6, 2, 68, 1], [6, 3, 64, 1],
  [7, 0, 69, 3],
];
function epiano(s: Synth, t: number, midi: number, level: number, tau: number, dst: AudioNode): void {
  const f = mtof(midi);
  const e = s.ad(t, 0.006, level, tau);
  e.connect(dst);
  s.chain(s.osc('sine', f, t, tau * 7 + 0.1), e);
  const e2 = s.ad(t, 0.003, level * 0.35, tau * 0.25);
  e2.connect(dst);
  s.chain(s.osc('sine', f * 2.003, t, tau * 2 + 0.1), e2);
  const e3 = s.ad(t, 0.001, level * 0.12, 0.03); // the tine's bark
  e3.connect(dst);
  s.chain(s.osc('sine', f * 7.01, t, 0.3), e3);
}
function bassNote(s: Synth, t: number, midi: number, level: number, dst: AudioNode): void {
  const e = s.ad(t, 0.012, level, 0.22);
  e.connect(dst);
  s.chain(s.osc('triangle', mtof(midi), t, 1.8), e);
}
function radioScore(s: Synth, P: number, dst: AudioNode): void {
  // every event also rendered one period later while t + P < the rendered span (seamless loop fold)
  const span = P + 0.7;
  const place = (t: number, fn: (tt: number) => void) => { fn(t); if (t + P < span) fn(t + P); };
  PROG.forEach((c, b) => {
    const t0 = b * BAR;
    place(t0, (tt) => bassNote(s, tt, c.root, 0.5, dst));
    place(t0 + BEAT * 2.5, (tt) => bassNote(s, tt, c.root + 7, 0.34, dst));
    for (const bt of [1, 2.67]) c.chord.forEach((m, i) => place(t0 + BEAT * bt + i * 0.012, (tt) => epiano(s, tt, m, 0.1, 0.34, dst)));
    // brushes: backbeat 2 & 4, soft offbeat eighths
    for (const bt of [1, 3]) place(t0 + BEAT * bt, (tt) => s.burst({ start: tt, color: 'white', type: 'highpass', f: 5500, Q: 0.5, a: 0.002, tau: 0.04, level: 0.07, dst }));
    for (const bt of [0.67, 1.67, 2.67, 3.67]) place(t0 + BEAT * bt, (tt) => s.burst({ start: tt, color: 'white', type: 'highpass', f: 7000, Q: 0.5, a: 0.001, tau: 0.015, level: 0.025, dst }));
  });
  for (const [b, bt, m, d] of MELODY) place(b * BAR + bt * BEAT, (tt) => epiano(s, tt, m, 0.24, 0.12 + d * BEAT * 0.22, dst));
}

// ───────────────────────────── level-3 sounds
export const rev7Sounds: SoundDef[] = [
  // ═════════ water
  {
    id: 'fountain_loop', loop: true, variants: 1, dur: 8, vol: 0.5, channels: 2, ref: 4, rolloff: 1.0, send: 1.0, when: 'lazy', levels: [3],
    render(s) {
      const D = L(s, 8);
      for (const p of [-0.5, 0.5]) {
        bed(s, 'pink', D, 0.5, 0.35, s.bp(2200, 0.6), s.pan(p)); // the 0.6 m falling sheet
        bed(s, 'white', D, 0.05, 0.5, s.hp(5200), s.pan(-p)); // sparkle
      }
      bed(s, 'brown', D, 0.9, 0.3, s.lp(260)); // plunge body
      const pans = scatter(s);
      for (let t = 0; t < D; t += s.r(0.03, 0.06)) s.burst({ start: t, color: 'white', type: 'bandpass', f: s.r(2500, 7000), Q: 2, a: 0.0005, tau: 0.006, level: s.r(0.02, 0.06), dst: s.pick(pans) });
      for (let t = 0; t < D; t += s.r(0.18, 0.5)) bloop(s, t, s.r(380, 1100), s.r(0.015, 0.045), s.pick(pans));
    },
  },
  {
    id: 'pool_lap', variants: 4, dur: 1.8, vol: 0.35, ref: 3, send: 1.0, maxVoices: 2, minInterval: 0.4, when: 'late', levels: [3],
    render(s) {
      const t = 0.02;
      s.burst({ start: t, color: 'pink', type: 'bandpass', f: s.r(500, 900), Q: 0.8, a: 0.12, tau: 0.25, level: 0.5 });
      s.burst({ start: t + 0.1, color: 'white', type: 'bandpass', f: s.r(2500, 4000), Q: 1.5, a: 0.05, tau: 0.15, level: 0.1 });
      for (let i = 0; i < s.ri(2, 4); i++) bloop(s, t + s.r(0.05, 0.7), s.r(250, 600), s.r(0.06, 0.1));
    },
  },
  {
    id: 'fountain_stop', variants: 1, dur: 3.6, vol: 0.6, ref: 5, send: 1.1, priority: 2, when: 'late', levels: [3],
    render(s) {
      const n = s.noise('pink', 0, 3.3);
      const f = s.bp(2200, 0.6);
      s.env(f.frequency, [[0, 2200], [1.5, 900]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0, 0.6], [0.5, 0.5], [1.5, 0.1], [2.4, 0.03], [3.2, 0]]);
      s.chain(n, f, g, s.out);
      const b = s.gain(0);
      s.env(b.gain, [[0, 0.5], [1.3, 0.2], [1.8, 0]]);
      s.chain(s.noise('brown', 0, 2), s.lp(280), b, s.out);
      s.tone({ start: 1.35, f: 110, f1: 190, sweep: 0.4, a: 0.05, tau: 0.2, level: 0.08 }); // air in the pipe
      for (const t of [1.7, 2.1, 2.65, 3.2]) { bloop(s, t, s.r(500, 900), 0.08); s.click(t, 0.05, 4000, 0.002); }
    },
  },

  // ═════════ lamps
  {
    id: 'lamp_hum_warm', loop: true, variants: 1, dur: 4, vol: 0.16, ref: 2.5, send: 0.5, when: 'lazy', levels: [3],
    render(s) {
      const D = L(s, 4);
      const sh = s.shaper('tanh', 1.4);
      s.chain(sh, s.lp(900), s.gain(1), s.out);
      for (const [h, a] of [[1, 1], [2, 0.45], [3, 0.22], [5, 0.08]] as const) s.chain(s.osc('sine', 100 * h, 0, D), s.gain(a * 0.4), sh);
      bed(s, 'pink', D, 0.01, 0, s.bp(2400, 1));
    },
  },
  {
    id: 'lamp_hum_cold', loop: true, variants: 1, dur: 4, vol: 0.2, ref: 2.5, send: 0.5, when: 'lazy', levels: [3],
    render(s) {
      const D = L(s, 4);
      const m = s.gain(1);
      s.env(m.gain, [[0, 1], [0.88, 1], [0.9, 0.15], [1.02, 0.15], [1.04, 1], [2.18, 1], [2.2, 0.2], [2.27, 0.2], [2.3, 1], [3.08, 1], [3.1, 0.1], [3.2, 0.1], [3.22, 1], [D, 1]]);
      const sh = s.shaper('hard', 2.2);
      s.chain(sh, s.lp(2600), s.gain(0.5), m, s.out);
      for (const [f, a] of [[100, 1], [100.25, 0.6], [300, 0.7], [500, 0.45], [700, 0.3], [900, 0.15]] as const) s.chain(s.osc('sine', f, 0, D), s.gain(a * 0.3), sh);
      // flutter: the ballast is failing
      const lfo = s.osc('sine', 8, 0, D);
      const lg = s.gain(0.12);
      lfo.connect(lg); lg.connect(m.gain);
      drone(s, 'sine', 2400, D, 0.012);
      bed(s, 'white', D, 0.006, 0, s.hp(4000));
    },
  },
  {
    id: 'lamp_flicker', variants: 3, dur: 1.5, vol: 0.35, ref: 3, send: 0.8, maxVoices: 2, when: 'late', levels: [3],
    render(s) {
      const on: Array<[number, number]> = [[0, 0.08], [0.13, 0.19], [0.3, 0.34], [0.5, 0.72], [0.78, 0.8], [0.9, 1.2]].map(([a, b]) => [a + s.r(-0.02, 0.02), b + s.r(-0.02, 0.02)] as [number, number]);
      const g = s.gain(0);
      const pts: Array<[number, number]> = [[0, 0]];
      for (const [a, b] of on) { pts.push([Math.max(a, pts[pts.length - 1][0] + 0.001), 0], [a + 0.004, 1], [b, 1], [b + 0.004, 0]); }
      pts.push([1.5, 0]);
      s.env(g.gain, pts);
      const o = s.osc('sawtooth', 100, 0, 1.5);
      s.chain(o, s.bp(320, 1.2), s.shaper('hard', 3), s.lp(2200), g, s.gain(0.3), s.out);
      for (const [a, b] of on) { s.click(a, 0.35, 3000, 0.002); s.click(b, 0.2, 2500, 0.002); }
    },
  },
  {
    id: 'lamps_die', variants: 1, dur: 3.8, vol: 0.5, ref: 8, send: 1.3, priority: 3, when: 'late', levels: [3],
    render(s) {
      const sh = s.shaper('tanh', 2);
      const bus = s.gain(0);
      s.env(bus.gain, [[0, 0], [0.1, 0.32], [0.5, 0.3], [2.4, 0.12], [3.5, 0]]);
      s.chain(sh, s.lp(1400), bus, s.out);
      const fs: Array<[number, number]> = [[0, 100], [3.5, 38]];
      for (const [h, a] of [[1, 1], [2, 0.5], [3, 0.25]] as const) {
        const o = s.osc('sine', 100 * h, 0, 3.7);
        s.env(o.frequency, fs.map(([t, v]) => [t, v * h] as [number, number]), 'exp');
        s.chain(o, s.gain(a * 0.4), sh);
      }
      clunk(s, 0.1, 85, 0.45, 0.2);
      for (let i = 0; i < 8; i++) { // the grid goes row by row, north to south
        const t = 0.35 + i * 0.36 + s.r(-0.03, 0.03);
        clack(s, t, s.r(700, 1100), 0.34 * Math.exp(-i * 0.14), 0.03);
        s.thump(t, 150, 80, 0.03, 0.05, 0.12);
      }
      crackle(s, 3.0, 0.5, 14, 0.04, 2800);
    },
  },
  {
    id: 'emerg_on', variants: 1, dur: 1.8, vol: 0.4, ref: 3, send: 0.9, priority: 2, when: 'late', levels: [3],
    render(s) {
      clunk(s, 0, 110, 0.55, 0.14);
      clack(s, 0.02, 1500, 0.3, 0.02);
      const g = s.gain(0);
      s.env(g.gain, [[0.08, 0], [0.12, 0.3], [0.3, 0.05], [0.34, 0.3], [0.5, 0.12], [0.55, 0.3], [1.5, 0.22], [1.8, 0]]);
      s.chain(s.osc('sawtooth', 120, 0.08, 1.75), s.lp(900), s.shaper('tanh', 2), g, s.out);
      s.tone({ start: 0.1, f: 2400, a: 0.01, hold: 1.3, tau: 0.15, level: 0.006 });
    },
  },

  // ═════════ vending machine, drinks fridge, aquarium
  {
    id: 'vending_hum', loop: true, variants: 1, dur: 4, vol: 0.2, ref: 2.5, send: 0.5, when: 'lazy', levels: [3],
    render(s) { cooler(s, 4, 120, 0.05); },
  },
  {
    id: 'fridge_hum', loop: true, variants: 1, dur: 4, vol: 0.18, ref: 3, send: 0.6, when: 'lazy', levels: [3],
    render(s) { cooler(s, 4, 100, 0.04); },
  },
  {
    id: 'vending_kick', variants: 2, dur: 2.0, vol: 0.45, ref: 3.5, send: 0.9, maxVoices: 2, minInterval: 0.5, when: 'late', levels: [3],
    render(s) {
      clack(s, 0, 1600, 0.5, 0.03); // relay
      const o = s.osc('sawtooth', 20, 0.05, 1.7);
      s.env(o.frequency, [[0.05, 20], [0.5, 110], [1.7, 108]], 'exp');
      const g = s.gain(0);
      s.env(g.gain, [[0.05, 0], [0.2, 0.22], [0.6, 0.14], [1.4, 0.1], [1.9, 0]]);
      s.chain(o, s.lp(500), g, s.out);
      const h = s.gain(0);
      s.env(h.gain, [[0.2, 0], [0.5, 0.2], [1.9, 0]]);
      s.chain(s.osc('sine', 120, 0.2, 1.7), h, s.out);
      clunk(s, 0.42, s.r(90, 105), 0.45, 0.12); // the compressor shudders on its mounts
      for (let i = 0; i < 4; i++) s.modal({ start: s.r(0.45, 1.0), level: s.r(0.04, 0.08), modes: s.modes(s.r(1800, 3200), [1, 2.4], [0.04, 0.02]) }); // cans rattle
    },
  },
  {
    id: 'vending_drop', variants: 2, dur: 1.4, vol: 0.5, ref: 3, send: 0.9, maxVoices: 2, when: 'late', levels: [3],
    render(s) {
      servo(s, 0, 0.5, 220, 270, 0.1);
      const t = 0.56;
      s.thump(t, 150, 70, 0.04, 0.06, 0.7);
      s.burst({ start: t, color: 'pink', type: 'lowpass', f: 1200, Q: 0.7, a: 0.001, tau: 0.03, level: 0.5 });
      s.modal({ start: t, level: 0.3, modes: s.modes(s.r(650, 900), [1, 2.4, 4.1], [0.12, 0.07, 0.04]) });
      clack(s, t + 0.2, 1100, 0.3, 0.03); // the flap
    },
  },
  {
    id: 'aquarium_loop', loop: true, variants: 1, dur: 6, vol: 0.2, ref: 2, send: 0.5, when: 'lazy', levels: [3],
    render(s) {
      const D = L(s, 6);
      drone(s, 'sine', 50, D, 0.05);
      drone(s, 'sine', 100, D, 0.03);
      bed(s, 'pink', D, 0.05, 0.5, s.bp(650, 1));
      for (let t = 0.1; t < D; t += s.r(0.12, 0.5)) bloop(s, t, s.r(800, 2400), s.r(0.02, 0.05));
    },
  },

  // ═════════ radio
  {
    id: 'radio_music', loop: true, variants: 1, dur: 20, vol: 0.32, ref: 3, rolloff: 1.0, send: 0.8, when: 'lazy', levels: [3],
    render(s) {
      // a kitchen radio in another room: 300 Hz – 3.4 kHz, a bump near 1.6 kHz, a little drive, hiss
      const tape = s.gain(1);
      s.chain(tape, s.hp(300), s.hp(300), s.pk(1600, 0.9, 4), s.shaper('tanh', 1.6), s.lp(3400), s.lp(3400), s.gain(0.9), s.out);
      radioScore(s, 20, tape);
      bed(s, 'white', 20.7, 0.004, 0, s.bp(2600, 0.5));
    },
  },
  {
    id: 'radio_static', loop: true, variants: 1, dur: 3, vol: 0.28, ref: 3, send: 0.6, when: 'lazy', levels: [3],
    render(s) {
      const D = L(s, 3);
      bed(s, 'white', D, 0.4, 0.6, s.bp(1500, 0.7), s.hp(300));
      bed(s, 'pink', D, 0.1, 0.5, s.lp(500));
      for (const t of [0, 1, 2]) crackle(s, t, 1.0, 16, 0.07, 2600);
    },
  },

  // ═════════ air handling, sea
  {
    id: 'hvac_loop', loop: true, variants: 1, dur: 5, vol: 0.22, ref: 3, send: 0.6, when: 'lazy', levels: [3],
    render(s) {
      const D = L(s, 5);
      bed(s, 'pink', D, 0.3, 0.3, s.bp(1100, 0.7), s.hp(500));
      bed(s, 'brown', D, 0.5, 0.2, s.lp(150));
      drone(s, 'sine', 100, D, 0.01);
    },
  },
  {
    id: 'viewport_rumble', loop: true, variants: 1, dur: 10, vol: 0.45, ref: 8, rolloff: 0.6, send: 1.0, when: 'lazy', levels: [3],
    render(s) {
      const D = L(s, 10);
      bed(s, 'brown', D, 1.0, 0.3, s.lp(75));
      drone(s, 'sine', 31, D, 0.5);
      const am = s.gain(0.5);
      const lfo = s.osc('sine', 0.2, 0, D);
      const lg = s.gain(0.25);
      lfo.connect(lg); lg.connect(am.gain);
      s.chain(s.osc('sine', 47.5, 0, D), am, s.gain(0.5), s.out);
      bed(s, 'pink', D, 0.03, 0.5, s.bp(210, 2)); // water moving past the glass
    },
  },
  {
    id: 'hull_creak', variants: 4, dur: 4.6, vol: 0.5, ref: 8, rolloff: 0.8, send: 1.5, maxVoices: 2, minInterval: 1, when: 'late', levels: [3],
    render(s) {
      const d = s.r(3, 4.0), f0 = s.r(55, 95);
      s.thump(0, 70, 38, 0.12, 0.2, 0.4); // the pressure tick before the groan
      const o = s.osc('sawtooth', f0, 0.1, d + 0.1);
      s.env(o.frequency, [[0.1, f0], [0.1 + d * 0.4, f0 * s.r(1.3, 1.8)], [0.1 + d, f0 * s.r(0.9, 1.2)]], 'exp');
      const mix = s.gain(0.5); // stick-slip
      const lfo = s.osc('square', s.r(6, 13), 0.1, d + 0.1);
      const lg = s.gain(0.4);
      lfo.connect(lg); lg.connect(mix.gain);
      const env = s.gain(0);
      s.env(env.gain, [[0.1, 0], [0.1 + d * 0.3, 0.3], [0.1 + d * 0.7, 0.35], [0.1 + d, 0]]);
      s.chain(o, s.bp(f0 * s.r(3, 5), 5), s.lp(900), mix, env, s.out);
      const o2 = s.osc('triangle', f0 * 1.51, 0.1, d + 0.1);
      s.chain(o2, s.lp(500), s.gain(0.1), env, s.out);
    },
  },

  // ═════════ pressure door, shutters
  {
    id: 'pdoor_release', variants: 1, dur: 1.5, vol: 0.9, ref: 8, rolloff: 0.8, send: 1.4, maxVoices: 2, priority: 4, when: 'late', levels: [3],
    render(s) {
      hiss(s, 0, 0.8, 0.5, 3500);
      dogs(s, 0.1, 0.6, 0.7);
      clunk(s, 0.78, 100, 0.5, 0.2);
    },
  },
  {
    id: 'pdoor_travel', variants: 1, dur: 3.0, vol: 0.9, ref: 8, rolloff: 0.8, send: 1.4, maxVoices: 2, priority: 4, when: 'late', levels: [3],
    render(s) { travel(s, 0, 2.6, 1, 1); },
  },
  {
    id: 'pdoor_seal', variants: 1, dur: 2.2, vol: 0.95, ref: 8, rolloff: 0.8, send: 1.4, maxVoices: 2, priority: 4, when: 'late', levels: [3],
    render(s) { seal(s, 0, 1); },
  },
  {
    id: 'pdoor_open', variants: 1, dur: 4.2, vol: 0.9, ref: 9, rolloff: 0.8, send: 1.5, maxVoices: 2, priority: 5, when: 'late', levels: [3],
    // dogs turn for 0.6 s, then the leaves part for 2.6 s (also the `pdoor_open_feed` beat of cutscene C2)
    render(s) {
      hiss(s, 0, 0.8, 0.5, 3500);
      dogs(s, 0.05, 0.6, 0.7);
      clunk(s, 0.68, 100, 0.5, 0.2);
      travel(s, 0.65, 2.6, 1, 1);
    },
  },
  {
    id: 'pdoor_close', variants: 1, dur: 4.6, vol: 0.95, ref: 9, rolloff: 0.8, send: 1.5, maxVoices: 2, priority: 5, when: 'late', levels: [3],
    render(s) { travel(s, 0, 2.6, 1, -1); seal(s, 2.55, 1); },
  },
  {
    id: 'shutter_slam', variants: 3, dur: 2.8, vol: 0.85, ref: 7, rolloff: 0.8, send: 1.4, maxVoices: 2, priority: 4, when: 'late', levels: [3],
    render(s) {
      const fall = s.r(0.28, 0.4);
      s.burst({ start: 0, color: 'white', type: 'bandpass', f: 2400, Q: 0.8, a: 0.02, hold: fall - 0.05, tau: 0.04, level: 0.35 });
      for (let t = 0; t < fall; t += s.r(0.012, 0.02)) {
        s.click(t, 0.1 + 0.4 * (t / fall), s.r(2000, 4000), 0.002);
        if (s.chance(0.35)) s.modal({ start: t, level: 0.05, modes: s.modes(s.r(900, 2400), [1, 2.3], [0.03, 0.02]) });
      }
      const tb = fall;
      s.thump(tb, 92, 34, 0.08, 0.14, 1.0);
      s.burst({ start: tb, color: 'pink', type: 'lowpass', f: 1100, Q: 0.7, a: 0.001, tau: 0.05, level: 0.7 });
      metal(s, tb, s.r(160, 210), 0.7, 0.6);
      clack(s, tb, 1200, 0.6, 0.05);
      let t = tb + 0.1;
      for (let i = 0; i < 14; i++) { // the slats shiver
        clack(s, t, s.r(800, 2000), 0.25 * Math.exp(-i * 0.25), 0.03);
        t += s.r(0.05, 0.09) * (1 + i * 0.1);
      }
    },
  },
  {
    id: 'shutter_roll', variants: 1, dur: 2.2, vol: 0.5, ref: 6, rolloff: 0.9, send: 1.0, maxVoices: 2, when: 'late', levels: [3],
    render(s) {
      servo(s, 0, 1.8, 180, 200, 0.18);
      s.burst({ start: 0, color: 'brown', type: 'lowpass', f: 220, Q: 0.7, a: 0.1, hold: 1.5, tau: 0.1, level: 0.5 });
      for (let t = 0.05; t < 1.8; t += 0.047) s.click(t, 0.05 + 0.03 * Math.sin(t * 9), 2600, 0.0015);
      clunk(s, 1.85, 90, 0.45, 0.15);
    },
  },

  // ═════════ chimes, bell, badge reader
  {
    id: 'door_chime', variants: 1, dur: 2.2, vol: 0.35, ref: 4, send: 1.2, maxVoices: 2, when: 'late', levels: [3],
    render(s) {
      [659.3, 523.3].forEach((f, i) => {
        const t = i * 0.55;
        s.tone({ start: t, f, a: 0.004, tau: 0.38, level: 0.4 });
        s.tone({ start: t, f: f * 2.01, a: 0.003, tau: 0.15, level: 0.12 });
        s.tone({ start: t, f: f * 3.99, a: 0.002, tau: 0.05, level: 0.05 });
      });
    },
  },
  {
    id: 'desk_bell', variants: 2, dur: 2.0, vol: 0.4, ref: 3, send: 1.1, maxVoices: 2, when: 'late', levels: [3],
    render(s) {
      s.click(0, 0.4, 4000, 0.001);
      s.modal({ start: 0, level: 0.5, modes: s.modes(s.r(2300, 2600), [1, 2.32, 4.1, 6.3], [1.1, 0.5, 0.25, 0.12], [1, 0.5, 0.3, 0.15], 0.01) });
      s.thump(0, 220, 150, 0.02, 0.03, 0.15);
    },
  },
  {
    id: 'badge_ok', variants: 1, dur: 0.7, vol: 0.4, ref: 3, maxVoices: 2, minInterval: 0.3, when: 'late', levels: [3],
    render(s) {
      clack(s, 0, 2000, 0.25, 0.01);
      for (const [t, f] of [[0.04, 1319], [0.13, 1760]] as const) {
        const g = s.ad(t, 0.003, 0.14, 0.035, 0.05);
        s.chain(s.osc('square', f, t, 0.2), s.lp(3500), g, s.out);
      }
      clunk(s, 0.3, 120, 0.4, 0.1); // the strike releases
    },
  },
  {
    id: 'badge_deny', variants: 1, dur: 0.9, vol: 0.4, ref: 3, maxVoices: 2, minInterval: 0.3, when: 'late', levels: [3],
    render(s) {
      clack(s, 0, 2000, 0.2, 0.01);
      const sh = s.shaper('hard', 3), out = s.gain(0.3);
      s.chain(sh, s.bp(900, 0.7), s.lp(2500), out, s.out);
      for (const [t, f, d] of [[0.04, 740, 0.12], [0.2, 494, 0.3]] as const) {
        const g = s.gain(0);
        s.env(g.gain, [[t, 0], [t + 0.005, 1], [t + d, 1], [t + d + 0.01, 0]]);
        const o = s.osc('square', f, t, d + 0.05);
        s.chain(o, g, sh);
      }
    },
  },

  // ═════════ purge (15 s on a fixed clock: tick, air blast, equalise, end tone)
  {
    id: 'purge_cycle', variants: 1, dur: 15.6, vol: 0.8, ref: 7, rolloff: 0.8, send: 1.3, maxVoices: 1, priority: 5, when: 'late', levels: [3],
    render(s) {
      // 0 – 1: valves and pumps
      clunk(s, 0.05, 110, 0.5, 0.15);
      clunk(s, 0.28, 90, 0.4, 0.15);
      servo(s, 0.1, 1.3, 70, 210, 0.16);
      // the amber strobe: a tick a second, then twice a second for the last third
      for (let t = 0.4; t < 10.4; t += 1) purgeTick(s, t, 0.1);
      for (let t = 10.4; t < 14.0; t += 0.5) purgeTick(s, t, 0.12, 1980);
      // the air blast from the nozzles (swirling), 0.7 – 12 s
      const n = s.noise('white', 0.6, 12);
      const bp = s.bp(2600, 0.5);
      s.env(bp.frequency, [[0.6, 1800], [2.2, 3000], [10.5, 2600], [12.4, 900]], 'exp');
      const sw = s.osc('sine', 0.4, 0.6, 12);
      const sg = s.gain(500);
      sw.connect(sg); sg.connect(bp.frequency);
      const g = s.gain(0);
      s.env(g.gain, [[0.6, 0], [1.6, 0.5], [10.6, 0.5], [12.4, 0]]);
      s.chain(n, s.hp(800), bp, g, s.out);
      const g2 = s.gain(0);
      s.env(g2.gain, [[0.6, 0], [1.8, 0.4], [10.4, 0.35], [12.5, 0]]);
      s.chain(s.noise('pink', 0.6, 12), s.lp(700), g2, s.out);
      // 10.6 – 13.4: pressure equalises — a falling note under a dying hiss
      const e = s.osc('sine', 100, 10.6, 3.2);
      s.env(e.frequency, [[10.6, 100], [13.2, 40]], 'exp');
      const eg = s.gain(0);
      s.env(eg.gain, [[10.6, 0], [11.2, 0.3], [12.8, 0.25], [13.4, 0]]);
      s.chain(e, eg, s.out);
      for (const t of [12.4, 12.9]) clack(s, t, 700, 0.18, 0.04);
      // 13.5 – 15.2: the latch, then the all-clear
      purgeEnd(s, 13.5);
    },
  },
  {
    id: 'purge_tick', variants: 1, dur: 0.2, vol: 0.4, ref: 5, maxVoices: 2, minInterval: 0.2, when: 'late', levels: [3],
    render(s) { purgeTick(s, 0, 0.6); },
  },
  {
    id: 'purge_end', variants: 1, dur: 2.2, vol: 0.6, ref: 6, send: 1.2, maxVoices: 1, priority: 4, when: 'late', levels: [3],
    render(s) { purgeEnd(s, 0); },
  },
  {
    id: 'purge_air', loop: true, variants: 1, dur: 4, vol: 0.55, ref: 6, rolloff: 0.8, send: 1.1, when: 'lazy', levels: [3],
    render(s) {
      const D = L(s, 4);
      const bp = s.bp(2600, 0.5);
      const sw = s.osc('sine', 0.5, 0, D);
      const sg = s.gain(500);
      sw.connect(sg); sg.connect(bp.frequency);
      s.chain(s.noise('white', 0, D), s.hp(800), bp, s.gain(0.5), s.out);
      bed(s, 'pink', D, 0.4, 0.2, s.lp(700));
    },
  },

  // ═════════ cutscene bits
  {
    id: 'chair_creak', variants: 3, dur: 1.3, vol: 0.4, ref: 2.5, send: 0.7, maxVoices: 2, minInterval: 0.25, when: 'late', levels: [3],
    render(s) {
      s.thump(0, 120, 70, 0.03, 0.04, 0.3); // the spring takes weight
      s.burst({ start: 0.02, color: 'pink', type: 'bandpass', f: 1800, Q: 0.7, a: 0.1, tau: 0.08, level: 0.06 }); // cloth
      s.burst({ start: 0.05, color: 'brown', type: 'lowpass', f: 300, Q: 0.7, a: 0.05, tau: 0.1, level: 0.1 }); // swivel bearing
      for (let k = 0; k < s.ri(2, 3); k++) {
        const t = 0.05 + k * s.r(0.18, 0.3), f = s.r(600, 1100), d = s.r(0.12, 0.25);
        const o = s.osc('sawtooth', f, t, d + 0.05);
        s.env(o.frequency, [[t, f], [t + d, f * s.r(0.85, 1.2)]], 'exp');
        const am = s.gain(0.5);
        const lf = s.osc('square', s.r(24, 40), t, d + 0.05);
        const lg = s.gain(0.4);
        lf.connect(lg); lg.connect(am.gain);
        const g = s.gain(0);
        s.env(g.gain, [[t, 0], [t + 0.02, 0.08], [t + d, 0]]);
        s.chain(o, s.bp(f * 1.5, 10), am, g, s.out);
      }
    },
  },
  {
    id: 'mug_clink', variants: 3, dur: 0.7, vol: 0.4, ref: 2.5, maxVoices: 2, when: 'late', levels: [3],
    render(s) {
      s.click(0, 0.3, 4000, 0.001);
      s.modal({ start: 0, level: 0.6, modes: s.modes(s.r(2600, 3800), [1, 2.3, 3.9], [0.08, 0.04, 0.02]) });
      s.modal({ start: 0, level: 0.3, modes: s.modes(s.r(850, 1000), [1, 2.4], [0.15, 0.08]) });
      s.modal({ start: 0.09, level: 0.25, modes: s.modes(s.r(3000, 4000), [1, 2.3], [0.05, 0.03]) });
    },
  },
  {
    id: 'monitor_switch', variants: 2, dur: 0.9, vol: 0.4, ref: 3, send: 0.6, maxVoices: 2, when: 'late', levels: [3],
    render(s) {
      clack(s, 0, 1700, 0.4, 0.02);
      s.burst({ start: 0.03, color: 'white', type: 'bandpass', f: 3000, Q: 0.5, a: 0.002, hold: 0.1, tau: 0.03, level: 0.25 }); // sync loss
      const o = s.osc('sine', 60, 0.04, 0.5);
      const g = s.gain(0);
      s.env(g.gain, [[0.04, 0], [0.05, 0.4], [0.5, 0]]);
      s.env(o.frequency, [[0.04, 70], [0.5, 56]], 'exp');
      s.chain(o, g, s.out); // degauss thud
    },
  },
  {
    id: 'screen_die', variants: 4, dur: 1.0, vol: 0.35, ref: 3, send: 0.7, maxVoices: 4, minInterval: 0.1, when: 'late', levels: [3],
    render(s, v) {
      const f0 = 5600 - v * 650;
      s.tone({ start: 0, f: f0, f1: 380, sweep: 0.35, a: 0.003, tau: 0.09, level: 0.12 });
      s.thump(0, 95 - v * 6, 45, 0.05, 0.08, 0.4);
      s.click(0, 0.3, 3500, 0.002);
      s.burst({ start: 0.05, color: 'white', type: 'highpass', f: 5000, Q: 0.5, a: 0.002, tau: 0.03, level: 0.04 });
    },
  },
  {
    id: 'office_die', variants: 1, dur: 1.4, vol: 0.5, ref: 3, send: 0.8, priority: 3, when: 'late', levels: [3],
    // monitor → static 0.3 s → black
    render(s) {
      s.thump(0, 90, 50, 0.03, 0.05, 0.25);
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.01, 0.45], [0.3, 0.45], [0.31, 0]]);
      const am = s.gain(0.6);
      const lf = s.osc('square', 60, 0, 0.35);
      const lg = s.gain(0.4);
      lf.connect(lg); lg.connect(am.gain);
      s.chain(s.noise('white', 0, 0.35), s.bp(2500, 0.4), am, g, s.out);
      s.tone({ start: 0.31, f: 4200, f1: 260, sweep: 0.3, a: 0.003, tau: 0.08, level: 0.12 });
      s.thump(0.31, 85, 40, 0.05, 0.1, 0.5);
      s.click(0.31, 0.35, 3500, 0.002);
      s.click(0.75, 0.08, 3000, 0.001);
    },
  },
  {
    id: 'phone_dead', variants: 1, dur: 4.2, vol: 0.45, ref: 2.5, send: 0.5, when: 'late', levels: [3],
    // handset lifted: a dial tone (a cabin line should have one) — then the line drops to hiss and nothing
    render(s) {
      clack(s, 0, 320, 0.5, 0.05);
      s.thump(0.01, 130, 70, 0.03, 0.05, 0.3);
      scrape(s, 0.04, 0.12, 2200, 0.05);
      const tone = s.gain(0);
      s.env(tone.gain, [[0.35, 0], [0.4, 0.4], [1.2, 0.4], [1.21, 0]]);
      s.chain(s.osc('sine', 425, 0.35, 0.9), s.bp(425, 0.7), tone, s.out);
      s.click(1.22, 0.2, 2500, 0.002);
      const hs = s.gain(0);
      s.env(hs.gain, [[1.2, 0], [1.3, 0.12], [3.4, 0.09], [4.1, 0]]);
      s.chain(s.noise('white', 1.2, 2.9), s.bp(2400, 0.6), hs, s.out);
      for (const t of [1.6, 2.3, 3.0]) s.click(t, 0.15, 3500, 0.001);
    },
  },
  {
    id: 'habitat_takeover', variants: 1, dur: 7.0, vol: 0.95, ref: 14, rolloff: 0.5, send: 1.5, priority: 6, peak: 0.85, when: 'late', levels: [3],
    // sector seal, lamps, HVAC winding down — the plant AI takes the habitat. Playing this id also flips the mood to cold.
    render(s) {
      s.thump(0, 62, 24, 0.25, 0.4, 1.0);
      s.burst({ start: 0, color: 'brown', type: 'lowpass', f: 160, Q: 0.7, a: 0.01, tau: 0.4, level: 0.8 });
      for (let i = 0; i < 7; i++) clunk(s, 0.25 + i * 0.3 + s.r(-0.03, 0.03), s.r(70, 110), 0.6 * Math.exp(-i * 0.13), 0.2); // relays all down the ring
      const sh = s.shaper('tanh', 2);
      const bus = s.gain(0);
      s.env(bus.gain, [[0, 0], [0.1, 0.3], [2.8, 0.1], [3.6, 0]]);
      s.chain(sh, s.lp(1400), bus, s.out);
      for (const [h, a] of [[1, 1], [2, 0.5]] as const) {
        const o = s.osc('sine', 100 * h, 0, 3.7);
        s.env(o.frequency, [[0, 100 * h], [3.5, 42 * h]], 'exp');
        s.chain(o, s.gain(a * 0.4), sh);
      }
      // air handling spins down
      const w = s.osc('sawtooth', 180, 0.2, 3.6);
      s.env(w.frequency, [[0.2, 180], [3.6, 40]], 'exp');
      const wg = s.gain(0);
      s.env(wg.gain, [[0.2, 0], [0.5, 0.1], [3.0, 0.07], [3.8, 0]]);
      s.chain(w, s.lp(420), wg, s.out);
      const ng = s.gain(0);
      s.env(ng.gain, [[0, 0.4], [1.4, 0.4], [3.0, 0]]);
      s.chain(s.noise('pink', 0, 3.2), s.bp(500, 0.7), ng, s.out);
      // the emergency lamps come up thin and wrong
      clack(s, 3.9, 900, 0.3, 0.04);
      for (const t of [4.0, 4.07, 4.22]) s.click(t, 0.06, 3000, 0.002);
      s.tone({ start: 4.1, type: 'sawtooth', f: 120, a: 0.05, hold: 1.4, tau: 0.5, level: 0.1, lp: 800 });
    },
  },
  {
    id: 'alarm_soft', variants: 1, dur: 3.4, vol: 0.3, ref: 8, rolloff: 0.6, send: 1.5, maxVoices: 2, minInterval: 1, when: 'late', levels: [3],
    // a far, soft pressure-alarm: two slow falling pulses
    render(s) {
      for (const t of [0.1, 1.5]) {
        for (const [dt, f] of [[0, 520], [0.38, 390]] as const) {
          const g = s.ad(t + dt, 0.04, 0.3, 0.12, 0.25);
          s.chain(s.osc('triangle', f, t + dt, 1.2), s.lp(1300), g, s.out);
        }
      }
    },
  },

  // ═════════ glass that holds
  {
    id: 'impact_glass_hold', variants: 4, dur: 0.9, vol: 0.42, ref: 2.5, maxVoices: 3, minInterval: 0.02, when: 'idle', levels: [3],
    // a bullet into thick laminated glass: a dull thock, a short low ring, a couple of ply ticks — it does not break
    render(s) {
      s.burst({ color: 'pink', type: 'bandpass', f: s.r(800, 1100), Q: 1, a: 0.0004, tau: 0.012, level: 0.8 });
      s.click(0, 0.45, 3000, 0.001);
      s.thump(0, 190, 95, 0.02, 0.04, 0.35);
      s.modal({ start: 0, level: 0.35, modes: s.modes(s.r(700, 1100), [1, 1.6, 2.4, 3.7], [0.12, 0.08, 0.05, 0.03], [1, 0.7, 0.5, 0.3], 0.04) });
      for (let i = 0; i < s.ri(2, 4); i++) s.click(s.r(0.02, 0.18), s.r(0.04, 0.1), s.r(2500, 4500), 0.0012);
    },
  },

  // ═════════ footsteps: carpet, wood, tile (mapped by room in index.ts; the contract's Surface has none of them)
  {
    ...STEP, id: 'step_carpet', vol: 0.15,
    render(s) {
      heel(s, 0, s.r(55, 68), 0.9);
      s.burst({ color: 'pink', type: 'lowpass', f: 380, Q: 0.7, a: 0.003, tau: 0.03, level: 0.5 });
      s.burst({ start: 0.02, color: 'white', type: 'bandpass', f: s.r(1800, 2600), Q: 0.6, a: 0.02, tau: 0.04, level: 0.05 }); // fibre
      heel(s, s.r(0.055, 0.075), 70, 0.28);
    },
  },
  {
    ...STEP, id: 'step_wood', vol: 0.22,
    render(s) {
      heel(s, 0, s.r(70, 85), 0.8);
      s.modal({ start: 0.001, level: 0.4, modes: s.modes(s.r(190, 260), [1, 2.1, 3.3, 5.2], [0.07, 0.05, 0.035, 0.02], [1, 0.6, 0.4, 0.25], 0.05) });
      s.burst({ color: 'pink', type: 'bandpass', f: s.r(900, 1300), Q: 1, a: 0.001, tau: 0.015, level: 0.35 });
      if (s.chance(0.25)) s.tone({ start: 0.03, f: s.r(500, 800), f1: s.r(420, 700), sweep: 0.12, a: 0.01, tau: 0.05, level: 0.04 }); // a board creaks
      const t2 = s.r(0.055, 0.075);
      heel(s, t2, 90, 0.3);
      s.modal({ start: t2, level: 0.12, modes: s.modes(s.r(210, 280), [1, 2.2], [0.05, 0.03]) });
    },
  },
  {
    ...STEP, id: 'step_tile', vol: 0.22,
    render(s) {
      heel(s, 0, s.r(65, 80), 0.8);
      s.click(0, 0.35, 3500, 0.0015);
      s.modal({ start: 0.0005, level: 0.22, modes: s.modes(s.r(1800, 2600), [1, 1.9, 3.2], [0.04, 0.03, 0.02], [1, 0.6, 0.4], 0.05) });
      s.burst({ color: 'pink', type: 'bandpass', f: s.r(1300, 1900), Q: 0.9, a: 0.0008, tau: 0.018, level: 0.35 });
      const t2 = s.r(0.05, 0.07);
      heel(s, t2, 85, 0.3);
      s.click(t2, 0.12, 3500, 0.001);
    },
  },

  // ═════════ ambience beds (stereo, bus ambience; levels via room presets)
  {
    id: 'amb_hab', loop: true, variants: 1, dur: 12, vol: 0.45, bus: 'ambience', channels: 2, when: 'idle', levels: [3],
    // the warm bed: soft air handling, a daylight-lamp hum far under it. Softer than the plant's rumble (amb_room).
    render(s) {
      const D = L(s, 12);
      bed(s, 'brown', D, 1.0, 0.2, s.lp(150), s.pan(-0.2));
      bed(s, 'brown', D, 1.0, 0.2, s.lp(160), s.pan(0.2));
      bed(s, 'pink', D, 0.06, 0.5, s.bp(420, 0.7), s.pan(0.3)); // air handling
      bed(s, 'pink', D, 0.03, 0.6, s.bp(1500, 0.8), s.pan(-0.3)); // diffuser hiss
      drone(s, 'sine', 100, D, 0.008);
      drone(s, 'sine', 200, D, 0.004);
    },
  },
  {
    id: 'amb_hab_cold', loop: true, variants: 1, dur: 12, vol: 0.45, bus: 'ambience', channels: 2, when: 'idle', levels: [3],
    // after the takeover: no air moving, a sealed hum that beats, the sea leaning on the hull, the odd tick
    render(s) {
      const D = L(s, 12);
      bed(s, 'brown', D, 0.8, 0.3, s.lp(120), s.pan(-0.3));
      bed(s, 'brown', D, 0.8, 0.3, s.lp(125), s.pan(0.3));
      drone(s, 'sine', 55, D, 0.03);
      const a = s.osc('sine', 110.25, 0, D), b = s.osc('sine', 109.75, 0, D);
      s.chain(a, s.gain(0.02), s.pan(-0.5), s.out); s.chain(b, s.gain(0.02), s.pan(0.5), s.out);
      const am = s.gain(0.5);
      const lf = s.osc('sine', 0.25, 0, D);
      const lg = s.gain(0.3);
      lf.connect(lg); lg.connect(am.gain);
      s.chain(s.osc('sine', 33, 0, D), am, s.gain(0.06), s.out);
      drone(s, 'sawtooth', 120, D, 0.006, s.lp(500)); // emergency-lamp ballast
      for (let i = 0; i < 3; i++) s.modal({ start: s.r(0.5, D - 0.5), level: s.r(0.025, 0.04), modes: s.modes(s.r(1800, 3200), [1, 2.5], [0.05, 0.03]), dst: s.pan(s.r(-0.9, 0.9)).connect(s.out) as AudioNode });
    },
  },
  {
    id: 'amb_garden', loop: true, variants: 1, dur: 12, vol: 0.5, bus: 'ambience', channels: 2, when: 'idle', levels: [3],
    // the atrium: air moving through leaves, the fountain across the hall, a lamp grid humming 13 m up
    render(s) {
      const D = L(s, 12);
      bed(s, 'brown', D, 0.9, 0.2, s.lp(130), s.pan(-0.2));
      bed(s, 'brown', D, 0.9, 0.2, s.lp(140), s.pan(0.2));
      bed(s, 'pink', D, 0.05, 0.8, s.bp(2800, 0.5), s.pan(-0.6)); // leaves
      bed(s, 'pink', D, 0.05, 0.8, s.bp(3100, 0.5), s.pan(0.6));
      bed(s, 'pink', D, 0.05, 0.3, s.bp(1100, 0.6), s.pan(0.15)); // the fountain, far
      drone(s, 'sine', 100, D, 0.005);
      const n = s.noise('pink', 0, D);
      const f = s.bp(s.r(500, 700), 4);
      s.env(f.frequency, [[0, 500], [D * 0.5, 800], [D, 500]], 'exp');
      s.chain(n, f, s.gain(0.04), s.pan(0.4), s.out); // slow air through the ducts
    },
  },
  {
    id: 'amb_lock', loop: true, variants: 1, dur: 8, vol: 0.45, bus: 'ambience', channels: 2, when: 'idle', levels: [3],
    // lock / decon room: clean air handling and a pump behind the wall
    render(s) {
      const D = L(s, 8);
      bed(s, 'brown', D, 0.9, 0.2, s.lp(140), s.pan(-0.2));
      bed(s, 'pink', D, 0.05, 0.3, s.bp(2000, 0.8), s.pan(0.2));
      bed(s, 'pink', D, 0.03, 0.5, s.bp(300, 4), s.pan(-0.3));
      drone(s, 'sine', 50, D, 0.04);
      drone(s, 'sine', 100, D, 0.03);
    },
  },
];
