/**
 * Procedural stereo impulse responses. Frequency-dependent decay (three bands with their own RT60),
 * early reflections, optional flutter echo (parallel walls) and metallic ringing modes.
 */
import { mulberry } from './synth/core';

export type IrName = 'padded' | 'corridor' | 'hall' | 'machine' | 'shaft' | 'plate';

interface IrSpec {
  len: number;
  /** RT60 seconds for low / mid / high bands. */
  rt: [number, number, number];
  predelay: number;
  /** Number of discrete early reflections and the window they fall in. */
  early: number; earlyWin: number; earlyGain: number;
  /** Flutter echo period (s) + gain (0 = none). */
  flutter?: number; flutterGain?: number;
  /** Ringing modes (Hz) mixed in at low level (metal surfaces). */
  ring?: number[]; ringGain?: number;
  /** Seconds over which the diffuse tail builds up (large spaces have a slow onset). */
  build: number;
  /** Extra overall level trim. */
  gain: number;
}

const SPECS: Record<IrName, IrSpec> = {
  padded: { len: 0.9, rt: [0.45, 0.35, 0.18], predelay: 0.004, early: 10, earlyWin: 0.025, earlyGain: 0.5, build: 0.01, gain: 0.8 },
  corridor: { len: 2.2, rt: [1.3, 1.1, 0.6], predelay: 0.006, early: 16, earlyWin: 0.05, earlyGain: 0.6, flutter: 0.0095, flutterGain: 0.35, ring: [310, 740, 1290, 2210], ringGain: 0.05, build: 0.02, gain: 1 },
  hall: { len: 5.5, rt: [5.0, 4.0, 2.2], predelay: 0.03, early: 22, earlyWin: 0.16, earlyGain: 0.45, ring: [97, 184, 431], ringGain: 0.03, build: 0.18, gain: 1.1 },
  machine: { len: 2.8, rt: [1.9, 1.6, 0.9], predelay: 0.01, early: 18, earlyWin: 0.07, earlyGain: 0.55, ring: [220, 540, 1100, 1850], ringGain: 0.05, build: 0.04, gain: 1 },
  shaft: { len: 4.0, rt: [3.6, 2.6, 1.2], predelay: 0.008, early: 12, earlyWin: 0.04, earlyGain: 0.5, flutter: 0.0145, flutterGain: 0.45, ring: [130, 410, 880], ringGain: 0.06, build: 0.03, gain: 1 },
  plate: { len: 3.2, rt: [2.4, 2.8, 2.2], predelay: 0.012, early: 0, earlyWin: 0.01, earlyGain: 0, build: 0.005, gain: 1 },
};

export function makeIR(name: IrName, sampleRate: number): AudioBuffer {
  const sp = SPECS[name];
  const len = Math.floor(sp.len * sampleRate);
  const buf = new AudioBuffer({ length: len, sampleRate, numberOfChannels: 2 });
  const rnd = mulberry(name.length * 7777 + len);
  const a1 = Math.exp((-2 * Math.PI * 350) / sampleRate); // low split
  const a2 = Math.exp((-2 * Math.PI * 3500) / sampleRate); // high split
  const k = [6.91 / sp.rt[0], 6.91 / sp.rt[1], 6.91 / sp.rt[2]];
  const pre = Math.floor(sp.predelay * sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp1 = 0, lp2 = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const w = rnd() * 2 - 1;
      lp1 = (1 - a1) * w + a1 * lp1;
      lp2 = (1 - a2) * w + a2 * lp2;
      const low = lp1, high = w - lp2, mid = lp2 - lp1;
      const build = sp.build > 0 ? 1 - Math.exp(-t / sp.build) : 1;
      d[i] = (low * Math.exp(-k[0] * t) * 1.3 + mid * Math.exp(-k[1] * t) + high * Math.exp(-k[2] * t) * 0.8) * build;
    }
    // early reflections
    for (let e = 0; e < sp.early; e++) {
      const t = sp.predelay + Math.pow(rnd(), 1.3) * sp.earlyWin;
      const i = Math.floor(t * sampleRate);
      if (i < len) d[i] += (rnd() < 0.5 ? -1 : 1) * sp.earlyGain * (1 - t / (sp.earlyWin + sp.predelay + 0.01)) * (0.5 + rnd() * 0.5) * 4;
    }
    // flutter echo
    if (sp.flutter && sp.flutterGain) {
      const per = sp.flutter * (c ? 1.04 : 1);
      for (let n = 1; n * per < Math.min(sp.len, 0.5); n++) {
        const i = Math.floor((sp.predelay + n * per) * sampleRate);
        if (i < len) d[i] += sp.flutterGain * Math.exp(-n * per * k[1] * 1.6) * (n % 2 ? 1 : -1) * 3;
      }
    }
    // metallic ringing modes
    if (sp.ring && sp.ringGain) {
      for (const f of sp.ring) {
        const ff = f * (c ? 1.013 : 1);
        const w = (2 * Math.PI * ff) / sampleRate;
        const tau = sp.rt[1] * 0.35;
        for (let i = pre; i < len; i++) {
          const t = (i - pre) / sampleRate;
          d[i] += Math.sin(w * i) * Math.exp(-t / tau) * sp.ringGain * (1 - Math.exp(-t / 0.01));
        }
      }
    }
    // fade the end
    const fade = Math.floor(0.05 * sampleRate);
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  }
  // normalise energy so wet levels are comparable between presets
  let e = 0;
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) e += d[i] * d[i]; }
  const norm = sp.gain / Math.sqrt(e / 2 || 1) * 0.5;
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] *= norm; }
  return buf;
}

export interface RoomPreset {
  ir: IrName;
  /** Reverb return level. */
  wet: number;
  /** Ambience bed mix: loop id → level. */
  bed: Record<string, number>;
  /** Generative distant-event palette: id → weight. */
  events: Record<string, number>;
}

const CORRIDOR_EVENTS = { drip: 3, dist_knock: 2, vent_scuttle: 1.5, metal_groan: 1, dist_voice: 0.6, dist_clank: 1 };
const ROOM_EVENTS = { drip: 2, dist_knock: 2, vent_scuttle: 1, metal_groan: 1, dist_voice: 0.5, dist_clank: 0.8 };

export const ROOMS: Record<string, RoomPreset> = {
  med: { ir: 'padded', wet: 0.35, bed: { amb_room: 0.8 }, events: ROOM_EVENTS },
  corr_a: { ir: 'corridor', wet: 0.55, bed: { amb_room: 1 }, events: CORRIDOR_EVENTS },
  junction: { ir: 'corridor', wet: 0.6, bed: { amb_room: 1 }, events: CORRIDOR_EVENTS },
  sec: { ir: 'padded', wet: 0.4, bed: { amb_room: 0.85 }, events: ROOM_EVENTS },
  storage: { ir: 'machine', wet: 0.45, bed: { amb_room: 0.9 }, events: ROOM_EVENTS },
  airlock: { ir: 'corridor', wet: 0.6, bed: { amb_room: 0.7, amb_fab: 0.35 }, events: CORRIDOR_EVENTS },
  fab: { ir: 'hall', wet: 0.75, bed: { amb_fab: 1 }, events: { dist_clank: 3, metal_groan: 3, dist_knock: 1, drip: 1, vent_scuttle: 1, dist_voice: 0.5 } },
  gen: { ir: 'machine', wet: 0.55, bed: { amb_gen: 1, amb_room: 0.3 }, events: { dist_clank: 2, metal_groan: 2, spark_zap: 1, dist_knock: 1 } },
  lobby: { ir: 'machine', wet: 0.5, bed: { amb_room: 0.9, amb_fab: 0.25 }, events: { metal_groan: 2, dist_clank: 2, dist_voice: 1, drip: 1, dist_knock: 1 } },
  elevator: { ir: 'shaft', wet: 0.6, bed: { amb_room: 0.6, amb_fab: 0.2 }, events: { metal_groan: 3, dist_clank: 2, dist_voice: 0.8 } },
};
export const DEFAULT_ROOM: RoomPreset = { ir: 'corridor', wet: 0.5, bed: { amb_room: 0.8 }, events: ROOM_EVENTS };
