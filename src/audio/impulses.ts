/**
 * Procedural stereo impulse responses. Frequency-dependent decay (three bands with their own RT60),
 * early reflections, optional flutter echo (parallel walls) and metallic ringing modes.
 */
import { mulberry } from './synth/core';

export type IrName = 'padded' | 'corridor' | 'hall' | 'machine' | 'shaft' | 'plate' | 'dead' | 'cistern' | 'clean'
  | 'office' | 'tiled' | 'atrium' | 'lock' | 'whiteroom' | 'tube';

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
  // small fabric room with a low ceiling: short, dark, almost no flutter
  dead: { len: 0.55, rt: [0.32, 0.2, 0.09], predelay: 0.002, early: 14, earlyWin: 0.012, earlyGain: 0.35, build: 0.004, gain: 0.7 },
  // flooded concrete sump with steel pipework: long, wet, hard metallic ringing
  cistern: { len: 5.0, rt: [4.2, 3.4, 1.7], predelay: 0.014, early: 20, earlyWin: 0.08, earlyGain: 0.6, flutter: 0.0175, flutterGain: 0.3, ring: [118, 262, 557, 991, 1720], ringGain: 0.065, build: 0.05, gain: 1.05 },
  // level 2 core: big, bare, hard and bright — a long even tail with no metallic character
  clean: { len: 4.2, rt: [2.6, 3.0, 2.4], predelay: 0.024, early: 14, earlyWin: 0.09, earlyGain: 0.4, build: 0.06, gain: 1 },
  // level 3 (habitat): carpeted offices — short and soft but not dead (acoustic ceiling, desks, glass partitions)
  office: { len: 0.8, rt: [0.55, 0.42, 0.2], predelay: 0.003, early: 12, earlyWin: 0.02, earlyGain: 0.45, build: 0.006, gain: 0.75 },
  // canteen / clinic / decon room: hard tile and linoleum, mid-sized, a touch of flutter, no metal ring
  tiled: { len: 1.8, rt: [1.1, 1.25, 1.0], predelay: 0.004, early: 16, earlyWin: 0.03, earlyGain: 0.6, flutter: 0.0072, flutterGain: 0.18, build: 0.012, gain: 1 },
  // garden atrium: 13 m of glass, terrazzo and planting — long, airy, slow onset, no metallic ring
  atrium: { len: 4.6, rt: [3.4, 3.0, 1.7], predelay: 0.035, early: 20, earlyWin: 0.14, earlyGain: 0.35, build: 0.16, gain: 1.05 },
  // pressure lock: white steel box, small, ringing a little
  lock: { len: 1.6, rt: [1.0, 1.0, 0.7], predelay: 0.003, early: 14, earlyWin: 0.02, earlyGain: 0.6, flutter: 0.0062, flutterGain: 0.3, ring: [260, 610, 1180], ringGain: 0.04, build: 0.008, gain: 1 },
  // level 4 clean side: white laminate panels and epoxy floors — hard, bright, short, no metal ring, a little flutter
  whiteroom: { len: 1.4, rt: [0.8, 0.95, 0.85], predelay: 0.003, early: 16, earlyWin: 0.025, earlyGain: 0.6, flutter: 0.0068, flutterGain: 0.22, build: 0.008, gain: 1 },
  // level 4 transfer tube: 40 m of curved glass between steel ribs — long, bright, a strong short flutter (the
  // cylinder), the ribs ringing low
  tube: { len: 3.8, rt: [2.8, 2.6, 1.6], predelay: 0.006, early: 18, earlyWin: 0.05, earlyGain: 0.55, flutter: 0.0118, flutterGain: 0.4, ring: [143, 389, 1210], ringGain: 0.045, build: 0.03, gain: 1 },
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
  /** Quiet "dread" room: sparse positional one-offs (20–60 s apart), capped below the player's footsteps,
   *  and occasional room-tone dropouts. */
  quiet?: boolean;
  /** Room-local recurring one-offs (not "distant" — independent of the single distant-event slot). */
  local?: LocalEvent[];
  /** Level 3: the habitat after the takeover; level 4: the clean side after lights-out (engine.setMood(true)). Fields given
   *  here replace the normal ones. */
  cold?: Partial<Omit<RoomPreset, 'cold'>>;
}

export interface LocalEvent {
  id: string;
  /** Seconds between plays [min, max]. */
  every: [number, number];
  vol: [number, number];
  /** Fixed world position; otherwise a random point inside the room bounds at height `y`. */
  at?: [number, number, number];
  y?: [number, number];
}

const CORRIDOR_EVENTS = { drip: 3, dist_knock: 2, vent_scuttle: 1.5, metal_groan: 1, dist_voice: 0.6, dist_clank: 1 };
const ROOM_EVENTS = { drip: 2, dist_knock: 2, vent_scuttle: 1, metal_groan: 1, dist_voice: 0.5, dist_clank: 0.8 };
/** Quiet opening rooms: someone/something is still moving around the deck. `door_far` = a door servo two rooms away. */
const DREAD_ROOM = { far_steps: 2, drag_far: 1.1, door_far: 1, breath_far: 1.2, husk_whisper: 0.5, pipe_tick: 1.6, dist_knock: 0.8, drip: 0.6, metal_groan: 0.5, vent_scuttle: 0.25 };
const DREAD_CORRIDOR = { far_steps: 2.4, drag_far: 1.2, door_far: 1.2, breath_far: 0.8, husk_whisper: 0.5, pipe_tick: 1.2, dist_knock: 1, drip: 0.8, metal_groan: 0.7, vent_scuttle: 0.3 };

const L2_QUIET = { far_steps: 1.4, door_far: 1, pipe_tick: 1.6, dist_knock: 1, drip: 0.5, metal_groan: 0.6, dist_clank: 0.6, breath_far: 0.4 };
const L2_CORRIDOR = { far_steps: 2.2, drag_far: 1, door_far: 1.2, pipe_tick: 1.4, dist_knock: 1, drip: 0.8, metal_groan: 0.8, vent_scuttle: 0.4, breath_far: 0.6 };

export const ROOMS: Record<string, RoomPreset> = {
  med: { ir: 'padded', wet: 0.35, bed: { amb_room: 0.8 }, events: DREAD_ROOM, quiet: true },
  corr_a: { ir: 'corridor', wet: 0.55, bed: { amb_room: 1 }, events: DREAD_CORRIDOR, quiet: true },
  quarters: {
    ir: 'dead', wet: 0.28, bed: { amb_quarters: 1 }, events: DREAD_ROOM, quiet: true,
    local: [{ id: 'lamp_creak', every: [6, 15], vol: [0.45, 0.9], at: [-5.5, 2.6, -7] }],
  },
  junction: { ir: 'corridor', wet: 0.6, bed: { amb_room: 1 }, events: DREAD_CORRIDOR, quiet: true },
  sec: { ir: 'padded', wet: 0.4, bed: { amb_room: 0.85 }, events: DREAD_ROOM, quiet: true },
  storage: { ir: 'machine', wet: 0.45, bed: { amb_room: 0.9 }, events: DREAD_ROOM, quiet: true },
  airlock: { ir: 'corridor', wet: 0.6, bed: { amb_room: 0.7, amb_fab: 0.35 }, events: CORRIDOR_EVENTS },
  pump: {
    ir: 'cistern', wet: 0.72, bed: { amb_pump: 1 },
    events: { water_slosh: 2, pipe_knock: 1.2, metal_groan: 1.2, drip: 1, vent_scuttle: 1.2, breath_far: 0.4, dist_clank: 0.6 },
    local: [
      { id: 'drip', every: [0.9, 3.8], vol: [0.25, 0.75], y: [2.5, 4.3] },
      { id: 'drip', every: [2.5, 7], vol: [0.2, 0.5], y: [3, 4.4] },
    ],
  },
  fab: { ir: 'hall', wet: 0.75, bed: { amb_fab: 1 }, events: { dist_clank: 3, metal_groan: 3, dist_knock: 1, drip: 1, vent_scuttle: 1, dist_voice: 0.5 } },
  gen: { ir: 'machine', wet: 0.55, bed: { amb_gen: 1, amb_room: 0.3 }, events: { dist_clank: 2, metal_groan: 2, spark_zap: 1, dist_knock: 1 } },
  lobby: { ir: 'machine', wet: 0.5, bed: { amb_room: 0.9, amb_fab: 0.25 }, events: { metal_groan: 2, dist_clank: 2, dist_voice: 1, drip: 1, dist_knock: 1 } },
  elevator: { ir: 'shaft', wet: 0.6, bed: { amb_room: 0.6, amb_fab: 0.2 }, events: { metal_groan: 3, dist_clank: 2, dist_voice: 0.8 } },

  // ── level 2 "LINE TWO" (REVISION 4). Tidy, lit, wrong: the quiet rooms keep the dread palette but no
  // husk whispers (the units here are working, and the recorded mutters come from the enemies module).
  cab: { ir: 'shaft', wet: 0.5, bed: { amb_room: 0.55, amb_fab: 0.15 }, events: { metal_groan: 2, dist_clank: 1.5, dist_knock: 1 } },
  dock: { ir: 'machine', wet: 0.45, bed: { amb_room: 0.8 }, events: L2_QUIET, quiet: true },
  intake: { ir: 'padded', wet: 0.38, bed: { amb_room: 0.75 }, events: L2_QUIET, quiet: true },
  line: { ir: 'hall', wet: 0.78, bed: { amb_fab: 0.9, amb_room: 0.3 }, events: { dist_clank: 2.5, metal_groan: 2.5, dist_knock: 1, drip: 0.6, conveyor_clunk: 0.8 } },
  booth: { ir: 'dead', wet: 0.22, bed: { amb_quarters: 0.9 }, events: { pipe_tick: 1, dist_knock: 1, metal_groan: 0.5 }, quiet: true },
  fitting: { ir: 'machine', wet: 0.52, bed: { amb_room: 0.6, amb_gen: 0.25 }, events: { dist_clank: 1.2, metal_groan: 1, dist_knock: 1, pipe_tick: 0.8 } },
  relay: { ir: 'machine', wet: 0.48, bed: { amb_gen: 0.9, amb_room: 0.3 }, events: { spark_zap: 1.5, dist_clank: 1, metal_groan: 1, dist_knock: 0.8 } },
  spine: { ir: 'corridor', wet: 0.6, bed: { amb_room: 1 }, events: L2_CORRIDOR, quiet: true },
  core: { ir: 'clean', wet: 0.6, bed: { amb_room: 0.25 }, events: {} },
  lift: { ir: 'dead', wet: 0.3, bed: { amb_room: 0.6 }, events: { metal_groan: 1, dist_clank: 1 } },
};
// ── level 3 "HALCYON HABITAT" (stage 3a). Warm and ordinary until the takeover, then the same rooms gone cold.
// Room ids are the plan's (§2.1); `lobby` and `quarters` differ from the level-1 presets, so these are only
// consulted when the engine runs level 3 (presetFor(id, 3)).
const HAB_WARM = { door_far: 1, pipe_tick: 0.5 };
const HAB_COLD = { far_steps: 1.4, door_far: 0.8, pipe_tick: 1.2, hull_creak: 1.2, alarm_soft: 0.6, breath_far: 0.3, dist_knock: 0.6, metal_groan: 0.5 };
const COLD_ROOM = { quiet: true, events: HAB_COLD, ir: 'dead' as IrName, wet: 0.3, bed: { amb_hab_cold: 1 } };
export const ROOMS_L3: Record<string, RoomPreset> = {
  lift3: { ir: 'dead', wet: 0.3, bed: { amb_room: 0.55 }, events: { metal_groan: 1 }, cold: { bed: { amb_room: 0.45, amb_hab_cold: 0.4 } } },
  lock: { ir: 'lock', wet: 0.5, bed: { amb_lock: 0.9 }, events: {}, cold: { bed: { amb_lock: 0.45, amb_hab_cold: 0.5 }, wet: 0.6 } },
  gallery_n: { ir: 'corridor', wet: 0.45, bed: { amb_hab: 0.8, amb_garden: 0.3 }, events: HAB_WARM, cold: { ...COLD_ROOM, ir: 'corridor', wet: 0.55, bed: { amb_hab_cold: 0.9, amb_garden: 0.1 } } },
  lobby: { ir: 'office', wet: 0.3, bed: { amb_hab: 0.9 }, events: HAB_WARM, cold: { ...COLD_ROOM, ir: 'office', wet: 0.35 } },
  admin: { ir: 'office', wet: 0.32, bed: { amb_hab: 1 }, events: HAB_WARM, cold: { ...COLD_ROOM, ir: 'office', wet: 0.38 } },
  office: { ir: 'dead', wet: 0.22, bed: { amb_hab: 0.7 }, events: HAB_WARM, cold: { ...COLD_ROOM, wet: 0.26, bed: { amb_hab_cold: 0.8 } } },
  stair_w: { ir: 'corridor', wet: 0.5, bed: { amb_hab: 0.6 }, events: HAB_WARM, cold: { ...COLD_ROOM, ir: 'corridor', wet: 0.6 } },
  canteen: { ir: 'tiled', wet: 0.45, bed: { amb_hab: 0.8 }, events: HAB_WARM, cold: { ...COLD_ROOM, ir: 'tiled', wet: 0.5 } },
  atrium: {
    ir: 'atrium', wet: 0.62, bed: { amb_garden: 1 }, events: HAB_WARM,
    local: [{ id: 'pool_lap', every: [2.5, 7], vol: [0.45, 0.9], at: [0, 0.5, -27] }],
    cold: { ...COLD_ROOM, ir: 'atrium', wet: 0.7, bed: { amb_hab_cold: 0.9, amb_garden: 0.12 }, local: [] },
  },
  clinic: { ir: 'tiled', wet: 0.38, bed: { amb_hab: 0.7 }, events: HAB_WARM, cold: { ...COLD_ROOM, ir: 'tiled', wet: 0.45 } },
  quarters: { ir: 'office', wet: 0.28, bed: { amb_hab: 0.75 }, events: HAB_WARM, cold: { ...COLD_ROOM, ir: 'office', wet: 0.3, bed: { amb_hab_cold: 1 } } },
  bio_lock: { ir: 'tiled', wet: 0.5, bed: { amb_lock: 1 }, events: {}, cold: { bed: { amb_lock: 0.6, amb_hab_cold: 0.35 }, wet: 0.55 } },
};
// ── level 4 "BIOLOGICAL SYSTEMS" (stage 3b, plan §2.1). Room ids are the plan's; only consulted when the engine runs
// level 4 (presetFor(id, 4)). The `cold` form is the clean side after lights-out (§4.3: story:beat `l4_lights_out`; Deck 2
// except theatre, node2, lock4): the air handling and the cold store stop, the bed becomes the sealed hum, dread palette.
const CLEAN_QUIET = { pipe_tick: 1.2, door_far: 0.7, far_steps: 0.6, dist_knock: 0.5, hull_creak: 0.5, metal_groan: 0.3 };
const CLEAN_DARK = { far_steps: 1.4, drag_far: 1, door_far: 0.6, pipe_tick: 1, hull_creak: 1, breath_far: 0.4, vent_scuttle: 0.5, dist_knock: 0.6 };
const NAVY = { hull_creak: 1.2, metal_groan: 1, dist_clank: 0.8, pipe_tick: 1, dist_knock: 0.8, far_steps: 0.6, drip: 0.5 };
const DARK4 = { quiet: true, events: CLEAN_DARK, bed: { amb_hab_cold: 1 } };
export const ROOMS_L4: Record<string, RoomPreset> = {
  lock4: { ir: 'lock', wet: 0.5, bed: { amb_clean: 0.6, amb_lock: 0.5 }, events: {} },
  gown: { ir: 'whiteroom', wet: 0.4, bed: { amb_clean: 0.9 }, events: CLEAN_QUIET, quiet: true, cold: { ...DARK4, wet: 0.45 } },
  shower: { ir: 'lock', wet: 0.45, bed: { amb_clean: 0.8 }, events: {}, cold: { bed: { amb_hab_cold: 0.9 }, wet: 0.5 } },
  corr_n: { ir: 'whiteroom', wet: 0.55, bed: { amb_clean: 1 }, events: CLEAN_QUIET, quiet: true, cold: { ...DARK4, wet: 0.6 } },
  corr_w: { ir: 'whiteroom', wet: 0.55, bed: { amb_clean: 1 }, events: CLEAN_QUIET, quiet: true, cold: { ...DARK4, wet: 0.6 } },
  corr_e: { ir: 'whiteroom', wet: 0.55, bed: { amb_clean: 1 }, events: CLEAN_QUIET, quiet: true, cold: { ...DARK4, wet: 0.6 } },
  corr_s: { ir: 'whiteroom', wet: 0.55, bed: { amb_clean: 1 }, events: CLEAN_QUIET, quiet: true, cold: { ...DARK4, wet: 0.6 } },
  wetlab: { ir: 'whiteroom', wet: 0.45, bed: { amb_clean: 0.9 }, events: CLEAN_QUIET, quiet: true, cold: { ...DARK4, wet: 0.5 } },
  pi_office: { ir: 'office', wet: 0.3, bed: { amb_clean: 0.6 }, events: CLEAN_QUIET, quiet: true, cold: { ...DARK4, ir: 'office', wet: 0.32, bed: { amb_hab_cold: 0.8 } } },
  node2: { ir: 'machine', wet: 0.4, bed: { amb_clean: 0.6, amb_gen: 0.3 }, events: {} }, // sealed, keeps its power
  cold: {
    ir: 'lock', wet: 0.45, bed: { amb_cold: 1 }, events: CLEAN_QUIET, quiet: true,
    cold: { ...DARK4, wet: 0.5, bed: { amb_hab_cold: 0.9 } },
  },
  records: { ir: 'office', wet: 0.3, bed: { amb_clean: 0.75 }, events: CLEAN_QUIET, quiet: true, cold: { ...DARK4, ir: 'office', wet: 0.32 } },
  vivarium: { ir: 'whiteroom', wet: 0.5, bed: { amb_clean: 0.9 }, events: { ...CLEAN_QUIET, husk_whisper: 0.3 }, quiet: true, cold: { ...DARK4, wet: 0.55 } },
  bay: { ir: 'machine', wet: 0.45, bed: { amb_clean: 0.6, amb_gen: 0.2 }, events: {}, cold: { ...DARK4, ir: 'machine', wet: 0.5 } },
  scrub: { ir: 'whiteroom', wet: 0.45, bed: { amb_clean: 0.85 }, events: CLEAN_QUIET, quiet: true, cold: { ...DARK4, wet: 0.5 } },
  store4: { ir: 'dead', wet: 0.25, bed: { amb_clean: 0.6 }, events: {}, cold: { ...DARK4, ir: 'dead', wet: 0.28 } },
  gallery: { ir: 'whiteroom', wet: 0.5, bed: { amb_clean: 0.8 }, events: CLEAN_QUIET, quiet: true, cold: { ...DARK4, wet: 0.55 } },
  theatre: { ir: 'clean', wet: 0.55, bed: { amb_clean: 0.8 }, events: {} }, // never entered; keeps its power (the loop runs)
  stair4: { ir: 'shaft', wet: 0.5, bed: { amb_clean: 0.4, amb_navy: 0.5 }, events: NAVY, quiet: true, cold: { bed: { amb_hab_cold: 0.5, amb_navy: 0.5 }, events: CLEAN_DARK } },
  lcorr: { ir: 'corridor', wet: 0.55, bed: { amb_navy: 1 }, events: NAVY, quiet: true },
  chk: { ir: 'machine', wet: 0.55, bed: { amb_navy: 1 }, events: NAVY },
  guard: { ir: 'dead', wet: 0.25, bed: { amb_navy: 0.7 }, events: NAVY, quiet: true },
  plant4: {
    ir: 'cistern', wet: 0.55, bed: { amb_plant: 1, amb_navy: 0.3 }, events: { ...NAVY, water_slosh: 0.6, pipe_knock: 0.8 },
    local: [{ id: 'drip', every: [1.5, 5], vol: [0.25, 0.6], y: [2.5, 4.2] }],
  },
  tube: {
    ir: 'tube', wet: 0.62, bed: { amb_tube: 1 }, events: { hull_creak: 1, metal_groan: 0.6, dist_knock: 0.4 },
    local: [{ id: 'tube_groan', every: [9, 22], vol: [0.45, 0.9], y: [2.4, 3.4] }],
  },
  gatel: { ir: 'lock', wet: 0.5, bed: { amb_navy: 0.6, amb_tube: 0.45 }, events: NAVY },
};
const LEVEL_ROOMS: Record<number, Record<string, RoomPreset>> = { 3: ROOMS_L3, 4: ROOMS_L4 };
export const DEFAULT_ROOM: RoomPreset = { ir: 'corridor', wet: 0.5, bed: { amb_room: 0.8 }, events: ROOM_EVENTS };

/** Unknown / renamed room ids fall back to the closest known preset by name, then to DEFAULT_ROOM. */
const ALIASES: Array<[RegExp, string]> = [
  [/quarter|bunk|crew|dorm|canteen/, 'quarters'], [/pump|sump|coolant|flood/, 'pump'], [/med|infirm/, 'med'],
  [/sec|guard|monitor/, 'sec'], [/stor|ware|supply/, 'storage'], [/air ?lock|decon/, 'airlock'], [/fab|hall|line/, 'fab'],
  [/gen|power|switch/, 'gen'], [/lobby|freight/, 'lobby'], [/elev|shaft|lift/, 'elevator'], [/junc|hub/, 'junction'],
  [/corr|hall|pass|vent/, 'corr_a'],
];
const resolved = new Map<string, RoomPreset>();
const coldCache = new WeakMap<RoomPreset, RoomPreset>();
export function presetFor(id: string, level = 0, cold = false): RoomPreset {
  const table = LEVEL_ROOMS[level];
  if (table) {
    const p = table[id];
    if (p) {
      if (!cold || !p.cold) return p;
      let c = coldCache.get(p);
      if (!c) { c = { ...p, ...p.cold, cold: undefined }; coldCache.set(p, c); }
      return c;
    }
  }
  const hit = ROOMS[id];
  if (hit) return hit;
  let p = resolved.get(id);
  if (!p) {
    const k = id.toLowerCase();
    const a = ALIASES.find(([re]) => re.test(k));
    p = a ? ROOMS[a[1]] : DEFAULT_ROOM;
    resolved.set(id, p);
  }
  return p;
}
