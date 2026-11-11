import type { SoundDef, Synth } from '../synth/core';
import { saturate } from '../synth/post';

/** Small metallic mechanism clack (slide, bolt, latch). */
export function clack(s: Synth, t: number, f0: number, level: number, ring = 0.03, dst?: AudioNode): void {
  s.click(t, level * 0.8, 3500, 0.0015, dst);
  s.modal({ start: t, level: level * 0.5, modes: s.modes(f0, [1, 1.63, 2.41, 3.37, 4.6], [ring, ring * 0.8, ring * 0.6, ring * 0.5, ring * 0.35], [1, 0.8, 0.6, 0.45, 0.3], 0.05), dst });
  s.burst({ start: t, color: 'white', type: 'bandpass', f: f0 * 2.2, Q: 1.2, a: 0.0003, tau: 0.006, level: level * 0.6, dst });
}

/** Friction slide noise (metal-on-metal). */
export function scrape(s: Synth, t: number, dur: number, f: number, level: number, dst?: AudioNode): void {
  const n = s.noise('white', t, dur + 0.05);
  const b = s.bp(f, 2.5);
  s.env(b.frequency, [[t, f * 0.8], [t + dur, f * 1.3]], 'exp');
  const g = s.gain(0);
  s.env(g.gain, [[t, 0], [t + dur * 0.3, level], [t + dur, level * 0.6], [t + dur + 0.02, 0]]);
  s.chain(n, b, g, dst ?? s.out);
}

function brassBounce(s: Synth, t: number, f0: number, level: number, hits: number, dst?: AudioNode): void {
  let tt = t, lv = level, gap = s.r(0.09, 0.14);
  for (let i = 0; i < hits; i++) {
    s.modal({ start: tt, level: lv, modes: s.modes(f0 * s.r(0.97, 1.03), [1, 2.76, 5.4, 8.9], [0.12, 0.07, 0.04, 0.02], [1, 0.6, 0.35, 0.2], 0.02), dst });
    s.click(tt, lv * 0.5, 6000, 0.0008, dst);
    tt += gap; gap *= s.r(0.45, 0.75); lv *= s.r(0.45, 0.7);
    if (gap < 0.012) gap = 0.012;
  }
}

export const weaponSounds: SoundDef[] = [
  {
    id: 'pistol_fire', variants: 4, dur: 0.9, vol: 0.85, maxVoices: 3, priority: 3, send: 1.4, ref: 6, peak: 0.95, when: 'load',
    render(s) {
      const o = s.out;
      const k = s.r(0.92, 1.08);
      // transient: hard broadband click
      s.click(0, 1.0, 1500, 0.0009);
      // crack: band-passed noise bursts 1-6 kHz
      s.burst({ color: 'white', type: 'bandpass', f: 2600 * k, Q: 0.7, a: 0.0003, tau: 0.018, level: 1.4 });
      s.burst({ color: 'white', type: 'bandpass', f: 5200 * k, Q: 0.9, a: 0.0002, tau: 0.012, level: 0.9 });
      s.burst({ color: 'white', type: 'bandpass', f: 1200 * k, Q: 0.8, a: 0.0004, tau: 0.025, level: 0.8 });
      // body: driven pink noise, mid-low
      const body = s.gain(1);
      s.chain(body, s.shaper('tanh', 2.5), o);
      s.burst({ color: 'pink', type: 'lowpass', f: 1500, Q: 0.8, a: 0.0006, tau: 0.04, level: 0.9, dst: body });
      // thump: sine drop 180 → 55 Hz
      s.thump(0, 180 * k, 55, 0.05, 0.035, 0.7, body);
      s.thump(0.002, 95, 42, 0.08, 0.06, 0.2);
      // mechanical slide cycle (slide back + forward clack)
      clack(s, s.r(0.03, 0.04), 2100 * k, 0.22, 0.025);
      clack(s, s.r(0.065, 0.08), 1500 * k, 0.16, 0.03);
      // own tail (short slap before the room reverb)
      s.burst({ start: 0.004, color: 'pink', type: 'lowpass', f: 2200, f1: 260, sweep: 0.45, Q: 0.6, a: 0.008, tau: 0.16, level: 0.22 });
      s.burst({ start: 0.035, color: 'pink', type: 'bandpass', f: 900, Q: 0.6, a: 0.006, tau: 0.08, level: 0.12 });
    },
    post(ch) { saturate(ch, 1.6); },
  },
  {
    id: 'shotgun_fire', variants: 3, dur: 1.7, vol: 1.0, maxVoices: 2, priority: 3, send: 1.6, ref: 8, peak: 0.97, when: 'load',
    render(s) {
      const k = s.r(0.93, 1.06);
      const drive = s.gain(1);
      s.chain(drive, s.shaper('tanh', 3), s.out);
      s.click(0, 1.0, 1000, 0.0015);
      s.burst({ color: 'white', type: 'bandpass', f: 1800 * k, Q: 0.6, a: 0.0004, tau: 0.035, level: 1.3, dst: drive });
      s.burst({ color: 'white', type: 'bandpass', f: 3800 * k, Q: 0.7, a: 0.0003, tau: 0.03, level: 1.6 });
      s.burst({ color: 'white', type: 'bandpass', f: 6000 * k, Q: 0.8, a: 0.0002, tau: 0.015, level: 0.9 });
      s.burst({ color: 'white', type: 'bandpass', f: 900 * k, Q: 0.7, a: 0.0005, tau: 0.05, level: 0.9, dst: drive });
      s.burst({ color: 'pink', type: 'lowpass', f: 1100, Q: 0.7, a: 0.001, tau: 0.085, level: 0.8, dst: drive });
      // the boom
      s.thump(0, 125 * k, 40, 0.1, 0.07, 0.7, drive);
      s.thump(0.003, 62, 30, 0.2, 0.15, 0.35);
      // long rolling tail
      s.burst({ start: 0.01, color: 'brown', type: 'lowpass', f: 900, f1: 120, sweep: 1.2, Q: 0.7, a: 0.02, tau: 0.42, level: 0.35 });
      s.burst({ start: 0.02, color: 'pink', type: 'bandpass', f: 700, f1: 200, sweep: 0.8, Q: 0.5, a: 0.015, tau: 0.25, level: 0.3 });
      // slapbacks
      for (const [dt, lv] of [[0.085, 0.22], [0.17, 0.14], [0.29, 0.08]] as const) {
        s.burst({ start: dt * s.r(0.9, 1.1), color: 'pink', type: 'lowpass', f: 1400, Q: 0.6, a: 0.004, tau: 0.05, level: lv });
      }
    },
    post(ch) { saturate(ch, 1.4); },
  },
  {
    id: 'shotgun_pump', variants: 3, dur: 0.6, vol: 0.55, maxVoices: 2, priority: 2, send: 0.6,
    render(s) {
      // back stroke
      clack(s, 0, 1150 * s.r(0.95, 1.05), 0.55, 0.035);
      scrape(s, 0.005, 0.07, 2800, 0.18);
      s.thump(0.01, 260, 140, 0.03, 0.02, 0.25);
      // forward stroke — heavier
      const t2 = s.r(0.19, 0.24);
      scrape(s, t2 - 0.06, 0.06, 2400, 0.14);
      clack(s, t2, 800 * s.r(0.95, 1.05), 0.8, 0.05);
      s.thump(t2, 200, 90, 0.04, 0.035, 0.45);
    },
  },
  {
    id: 'pistol_mag_out', variants: 2, dur: 0.4, vol: 0.4, send: 0.4,
    render(s) {
      clack(s, 0, 3800, 0.4, 0.012); // release button
      scrape(s, 0.02, 0.07, 2300, 0.2);
      clack(s, 0.09, 1600, 0.25, 0.02);
    },
  },
  {
    id: 'pistol_mag_in', variants: 2, dur: 0.4, vol: 0.45, send: 0.4,
    render(s) {
      scrape(s, 0, 0.06, 2000, 0.25);
      clack(s, 0.065, 1700 * s.r(0.95, 1.05), 0.8, 0.03);
      s.thump(0.065, 240, 110, 0.03, 0.02, 0.45);
    },
  },
  {
    id: 'pistol_slide', variants: 2, dur: 0.5, vol: 0.5, send: 0.5,
    render(s) {
      clack(s, 0, 2600, 0.35, 0.015);
      scrape(s, 0.005, 0.06, 3100, 0.2);
      const t2 = s.r(0.11, 0.14);
      clack(s, t2, 1350 * s.r(0.95, 1.05), 0.9, 0.04);
      s.thump(t2, 220, 100, 0.03, 0.025, 0.4);
    },
  },
  {
    id: 'shell_insert', variants: 4, dur: 0.3, vol: 0.4, maxVoices: 3, send: 0.4,
    render(s) {
      s.thump(0, 320 * s.r(0.9, 1.1), 150, 0.02, 0.018, 0.6);
      s.burst({ color: 'pink', type: 'bandpass', f: 1200, Q: 1, a: 0.001, tau: 0.012, level: 0.4 });
      clack(s, s.r(0.03, 0.045), 2500 * s.r(0.9, 1.1), 0.35, 0.015);
      // spring
      s.modal({ start: 0.035, level: 0.08, modes: [[s.r(850, 1000), 0.06, 1], [s.r(2100, 2400), 0.03, 0.4]] });
    },
  },
  {
    id: 'dry_fire', variants: 2, dur: 0.25, vol: 0.45, send: 0.4,
    render(s) {
      clack(s, 0, 3000 * s.r(0.95, 1.05), 0.8, 0.012);
      s.thump(0, 400, 200, 0.015, 0.01, 0.2);
    },
  },
  {
    id: 'casing_metal', variants: 6, dur: 0.9, vol: 0.16, maxVoices: 4, priority: 0, ref: 1.5, send: 0.5,
    render(s) { brassBounce(s, s.r(0, 0.01), s.r(4200, 6200), 1, s.ri(3, 5)); },
  },
  {
    id: 'shell_drop', variants: 3, dur: 0.8, vol: 0.2, maxVoices: 3, priority: 0, ref: 1.5, send: 0.5,
    render(s) {
      // plastic hull thock + brass head clink, bouncing
      let t = 0, lv = 1;
      for (let i = 0; i < 3; i++) {
        s.modal({ start: t, level: lv * 0.7, modes: s.modes(s.r(700, 1100), [1, 1.7, 2.9], [0.02, 0.012, 0.008]) });
        s.modal({ start: t + 0.002, level: lv * 0.3, modes: s.modes(s.r(3200, 4200), [1, 2.7], [0.06, 0.03]) });
        t += s.r(0.12, 0.2) * Math.pow(0.6, i); lv *= 0.45;
      }
    },
  },
  {
    id: 'weapon_switch', variants: 3, dur: 0.6, vol: 0.35, maxVoices: 2, send: 0.3,
    render(s) {
      // cloth rustle
      const n = s.noise('pink', 0, 0.35);
      const g = s.gain(0);
      s.env(g.gain, [[0, 0], [0.06, 0.35], [0.16, 0.15], [0.3, 0]]);
      s.chain(n, s.bp(s.r(1200, 1800), 0.8), g, s.out);
      // gear rattle
      for (let i = 0; i < 5; i++) s.modal({ start: s.r(0.02, 0.2), level: s.r(0.05, 0.12), modes: s.modes(s.r(2500, 5000), [1, 2.3], [0.01, 0.006]) });
      // grip settle
      clack(s, s.r(0.22, 0.28), s.r(1100, 1500), 0.6, 0.03);
    },
  },
];
