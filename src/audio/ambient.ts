/**
 * Ambience: per-room base bed (crossfaded loops), room-local recurring one-offs (lamp creak, drips) and a
 * generative layer of distant, positional events with ONE event slot (never two at once).
 *
 * Quiet "dread" rooms (preset.quiet — med, corr_a, quarters, junction, sec, storage): sparse unsettling
 * one-offs placed mostly behind / above the listener with 20–60 s of silence between them, never while
 * enemies are active or combat music plays, and each capped so its peak at the listener stays below the
 * player's own walking footstep. Occasionally the room tone itself drops out for 2–4 s.
 * Other rooms keep the denser industrial palette (9–30 s), still one event at a time.
 */
import * as THREE from 'three';
import type { AudioEngine, LoopVoice } from './engine';
import { SOUND_MAP } from './sounds';

const BED_IDS = ['amb_room', 'amb_fab', 'amb_gen', 'amb_quarters', 'amb_pump'] as const;

/** Peak of the player's own walking footstep at the listener: step vol 0.2 × walk 0.75 × peak 0.9. */
const FOOTSTEP_PEAK = 0.2 * 0.75 * 0.9;
/** The HRTF panner can add up to ~+3 dB over the inverse-distance estimate (measured in the harness). */
const HRTF_HEADROOM = 1.45;

interface Spec {
  /** Distance range (m). */
  d: [number, number];
  /** Height offset range relative to the listener's ear. */
  y?: [number, number];
  /** Probability of being placed one floor up (+3.2 m) instead of `y`. */
  above?: number;
  /** Probability of being placed in the rear half-plane (otherwise anywhere). */
  behind?: number;
  /** Glide this many metres sideways over the sound's duration. */
  move?: number;
  /** Extra low-pass (Hz) — through walls / floors. */
  lp?: number;
  /** Peak cap as a fraction of the player's footstep peak (quiet rooms). */
  cap: number;
  /** Seconds before this id may be picked again. */
  cool: number;
  /** Play a different sound id (e.g. `door_far` → `door_open`). */
  play?: string;
  pitch?: [number, number];
}

const SPECS: Record<string, Spec> = {
  far_steps: { d: [9, 16], y: [-1.4, -1.2], above: 0.5, behind: 0.8, move: 4, lp: 1000, cap: 0.75, cool: 50 },
  drag_far: { d: [10, 18], y: [-1.4, -1.2], above: 0.4, behind: 0.7, move: 2, lp: 1200, cap: 0.7, cool: 70 },
  door_far: { play: 'door_open', d: [18, 28], y: [-0.3, 0], behind: 0.5, lp: 650, cap: 0.5, cool: 80, pitch: [0.82, 0.95] },
  breath_far: { d: [6, 11], y: [-0.4, 0.6], behind: 0.9, cap: 0.45, cool: 90 },
  husk_whisper: { d: [12, 19], y: [-0.4, 0.2], behind: 0.85, lp: 1700, cap: 0.45, cool: 240 },
  pipe_tick: { d: [5, 12], y: [0.8, 1.6], cap: 0.6, cool: 25 },
  dist_knock: { d: [12, 20], y: [-1, 2], lp: 1500, cap: 0.7, cool: 30 },
  drip: { d: [4, 10], y: [-1, 2], cap: 0.6, cool: 0 },
  metal_groan: { d: [14, 24], y: [-1, 3], cap: 0.7, cool: 60, pitch: [0.7, 1] },
  vent_scuttle: { d: [8, 14], y: [1.2, 1.8], move: 6, cap: 0.5, cool: 120, pitch: [0.85, 1.15] },
  dist_clank: { d: [14, 24], y: [-1, 3], cap: 0.7, cool: 30 },
  dist_voice: { d: [14, 22], y: [-1, 1], cap: 0.5, cool: 200 },
  water_slosh: { d: [8, 16], y: [-2, -1.5], cap: 0.9, cool: 20 },
  pipe_knock: { d: [8, 16], y: [0, 2], cap: 0.8, cool: 15 },
};

export class Ambience {
  private beds = new Map<string, LoopVoice>();
  private levels: Record<string, number> = {};
  private next = 0;
  private slotUntil = 0;
  private lastId = '';
  private lastPlayed = new Map<string, number>();
  private localNext: number[] = [];
  private bounds: THREE.Box3 | null = null;
  private dropUntil = 0;
  private nextDrop = 0;
  private readonly pos = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  /** 0..1 how "busy" the soundscape is (combat 1, enemies active 0.7, tension 0.3). */
  busy = 0;
  enabled = true;
  powerOn = false;
  /** Debug log of generated events (dev harness). */
  readonly log: Array<{ t: number; id: string; d: number; vol: number }> = [];

  constructor(private readonly eng: AudioEngine) {}

  /** Crossfade the bed to the current room's preset. `bounds` = the room's box (for room-local events). */
  applyRoom(bounds?: THREE.Box3 | null): void {
    if (bounds !== undefined) this.bounds = bounds;
    const room = this.eng.room;
    const bed = room.bed;
    for (const id of BED_IDS) {
      let lv = bed[id] ?? 0;
      if (id === 'amb_gen' && this.powerOn && (this.eng.roomId === 'fab' || this.eng.roomId === 'line')) lv = Math.max(lv, 0.25);
      this.levels[id] = lv;
      let l = this.beds.get(id);
      if (lv > 0 && !l) {
        l = this.eng.loop(id, { volume: 0 }) as LoopVoice;
        this.beds.set(id, l);
      }
      l?.setVolume(lv, 2.5);
    }
    const now = this.eng.now;
    this.localNext = (room.local ?? []).map((e) => now + 1 + Math.random() * e.every[0]);
    if (!room.quiet) this.endDrop(0.6);
    else if (this.nextDrop === 0 || this.nextDrop < now + 25) this.nextDrop = now + 40 + Math.random() * 60;
    // entering a quiet room: give it a moment of nothing first
    if (room.quiet && this.next < now + 12) this.next = now + 12 + Math.random() * 14;
  }

  stopAll(fade = 1.5): void {
    for (const l of this.beds.values()) l.stop(fade);
    this.beds.clear();
  }

  get dropping(): boolean { return this.dropUntil > 0; }

  private endDrop(tau: number): void {
    if (!this.dropUntil) return;
    this.dropUntil = 0;
    this.eng.setRoomTone(1, 1, tau);
  }

  update(): void {
    const e = this.eng;
    if (!e.running) return;
    const now = e.now;
    if (!this.enabled) { this.endDrop(0.3); return; }
    const room = e.room;
    const quiet = !!room.quiet;

    // ── room-tone dropout
    if (this.dropUntil) {
      if (this.busy >= 0.5) this.endDrop(0.25);
      else if (now >= this.dropUntil) {
        this.endDrop(0.6);
        this.nextDrop = now + 90 + Math.random() * 90;
        // sometimes the silence was hiding something
        if (Math.random() < 0.45) this.next = Math.min(this.next, now + 2.5 + Math.random() * 2.5);
        else this.next = Math.max(this.next, now + 8);
      }
      return; // no events, no local layer: true silence
    }
    if (quiet && this.nextDrop && now >= this.nextDrop) {
      if (this.busy < 0.25 && now >= this.slotUntil) {
        this.dropUntil = now + 2 + Math.random() * 2;
        e.setRoomTone(0.05, 0.45, 0.12);
        return;
      }
      this.nextDrop = now + 15 + Math.random() * 15;
    }

    // ── room-local recurring one-offs
    const local = room.local;
    if (local) {
      for (let i = 0; i < local.length; i++) {
        if (now < this.localNext[i]) continue;
        const ev = local[i];
        this.localNext[i] = now + ev.every[0] + Math.random() * (ev.every[1] - ev.every[0]);
        if (ev.at) this.pos.set(ev.at[0], ev.at[1], ev.at[2]);
        else if (this.bounds && !this.bounds.isEmpty()) {
          const b = this.bounds;
          const y0 = ev.y ? ev.y[0] + Math.random() * (ev.y[1] - ev.y[0]) : 1;
          this.pos.set(b.min.x + Math.random() * (b.max.x - b.min.x), b.min.y + y0, b.min.z + Math.random() * (b.max.z - b.min.z));
        } else {
          const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 5;
          this.pos.set(e.listener.x + Math.cos(a) * d, e.listener.y + 1, e.listener.z + Math.sin(a) * d);
        }
        e.play(ev.id, { position: this.pos, volume: ev.vol[0] + Math.random() * (ev.vol[1] - ev.vol[0]) });
      }
    }

    // ── distant events (one slot)
    if (this.next === 0) { this.next = now + (quiet ? 18 + Math.random() * 17 : 6 + Math.random() * 8); return; }
    if (now < this.next || now < this.slotUntil) return;
    if (quiet ? this.busy >= 0.5 : this.busy > 0.5) { this.next = now + 6 + Math.random() * 6; return; }

    const id = this.pick(room.events, now);
    if (!id) { this.next = now + 10; return; }
    const sp = SPECS[id];
    const playId = sp?.play ?? id;
    const def = SOUND_MAP.get(playId);
    if (!def) { this.next = now + 10; return; }
    const dur = e.buffers(playId)?.[0]?.duration ?? def.dur;
    if (quiet) this.spawnQuiet(id, playId, sp, def.vol ?? 0.7, def.volVar ?? 0.12, def.peak ?? 0.9, def.ref ?? 2.5, def.rolloff ?? 1.1, dur);
    else this.spawnLegacy(id);
    this.lastId = id;
    this.lastPlayed.set(id, now);
    this.slotUntil = now + dur;
    this.next = quiet
      ? now + dur + (20 + Math.random() * 40) * (this.busy > 0.2 ? 1.5 : 1)
      : now + Math.max(dur + 2, (9 + Math.random() * 20) * (0.75 + this.busy));
  }

  /** Dev: spawn one quiet-room event now (bypasses timing / slot). */
  debugSpawn(id: string): void {
    const sp = SPECS[id];
    const playId = sp?.play ?? id;
    const def = SOUND_MAP.get(playId);
    if (!def) return;
    const dur = this.eng.buffers(playId)?.[0]?.duration ?? def.dur;
    this.spawnQuiet(id, playId, sp, def.vol ?? 0.7, def.volVar ?? 0.12, def.peak ?? 0.9, def.ref ?? 2.5, def.rolloff ?? 1.1, dur);
  }

  /** Dev: force timers ('event' | 'drop') to fire on the next update. */
  debugForce(what: 'event' | 'drop' | 'hold'): void {
    const now = this.eng.now;
    if (what === 'event') { this.next = now; this.slotUntil = 0; } else if (what === 'drop') this.nextDrop = now;
    else { this.next = now + 1e6; this.nextDrop = now + 1e6; }
  }

  private pick(palette: Record<string, number>, now: number): string | null {
    let total = 0;
    for (const k in palette) if (this.ok(k, now)) total += palette[k];
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const k in palette) {
      if (!this.ok(k, now)) continue;
      r -= palette[k];
      if (r <= 0) return k;
    }
    return null;
  }

  private ok(id: string, now: number): boolean {
    if (id === this.lastId && id !== 'drip') return false;
    const cool = SPECS[id]?.cool ?? 0;
    const lp = this.lastPlayed.get(id);
    return lp === undefined || now - lp >= cool;
  }

  /** Random point at distance `d`, `behind` = probability of the rear half-plane. */
  private place(out: THREE.Vector3, d: number, behind: number, yOff: number): number {
    const e = this.eng;
    const f = e.listenerFwd;
    let a: number;
    if (Math.random() < behind) a = Math.atan2(-f.z, -f.x) + (Math.random() * 2 - 1) * 1.2;
    else a = Math.random() * Math.PI * 2;
    out.set(e.listener.x + Math.cos(a) * d, e.listener.y + yOff, e.listener.z + Math.sin(a) * d);
    return a;
  }

  private spawnQuiet(id: string, playId: string, sp: Spec | undefined, vol: number, vv: number, peak: number, ref: number, rolloff: number, dur: number): void {
    const e = this.eng;
    const s = sp ?? { d: [10, 18] as [number, number], cap: 0.6, cool: 0 };
    const d = s.d[0] + Math.random() * (s.d[1] - s.d[0]);
    const up = s.above !== undefined && Math.random() < s.above;
    const yOff = up ? 3.2 : s.y ? s.y[0] + Math.random() * (s.y[1] - s.y[0]) : 0;
    const a = this.place(this.pos, d, s.behind ?? 0, yOff);
    // peak at the listener (inverse distance model) must stay under the player's own footstep
    const dist = this.pos.distanceTo(e.listener);
    const g = ref / (ref + rolloff * (Math.max(dist, ref) - ref));
    const maxVol = (s.cap * FOOTSTEP_PEAK) / Math.max(1e-4, vol * (1 + vv) * peak * g * HRTF_HEADROOM);
    const want = 0.6 + Math.random() * 0.4;
    const v = Math.min(want, maxVol);
    const pitch = s.pitch ? s.pitch[0] + Math.random() * (s.pitch[1] - s.pitch[0]) : 1;
    let moveTo: THREE.Vector3 | undefined;
    if (s.move) {
      const side = (Math.random() < 0.5 ? 1 : -1) * s.move;
      this.to.set(this.pos.x - Math.sin(a) * side, this.pos.y, this.pos.z + Math.cos(a) * side);
      moveTo = this.to;
    }
    e.play(playId, { position: this.pos, volume: v, pitch, lowpass: s.lp, moveTo, moveDur: moveTo ? dur : undefined, send: 1.4 });
    this.log.push({ t: +e.now.toFixed(2), id, d: +dist.toFixed(1), vol: +v.toFixed(3) });
    if (this.log.length > 60) this.log.shift();
  }

  /** The original denser industrial layer (fab, gen, lobby, elevator, airlock, pump, unknown rooms). */
  private spawnLegacy(id: string): void {
    const e = this.eng;
    const sp = SPECS[id];
    const a = Math.random() * Math.PI * 2;
    const d = id === 'drip' ? 4 + Math.random() * 8 : sp && id !== 'metal_groan' && id !== 'dist_clank' ? sp.d[0] + Math.random() * (sp.d[1] - sp.d[0]) : 10 + Math.random() * 16;
    const yOff = sp?.y ? sp.y[0] + Math.random() * (sp.y[1] - sp.y[0]) : Math.random() * 4 - 1;
    this.pos.set(e.listener.x + Math.cos(a) * d, e.listener.y + yOff, e.listener.z + Math.sin(a) * d);
    const vol = 0.35 + Math.random() * 0.4;
    const playId = sp?.play ?? id;
    if (id === 'vent_scuttle') {
      const b = a + (Math.random() < 0.5 ? 1 : -1) * (0.8 + Math.random());
      this.to.set(e.listener.x + Math.cos(b) * d, this.pos.y + 1, e.listener.z + Math.sin(b) * d);
      e.play(id, { position: this.pos, moveTo: this.to, moveDur: 2.8, volume: vol * 0.35, pitch: 0.85 + Math.random() * 0.3 });
    } else if (id === 'metal_groan') {
      e.play(id, { position: this.pos, volume: vol * 0.7, pitch: 0.7 + Math.random() * 0.3, send: 1.5 });
    } else {
      e.play(playId, { position: this.pos, volume: id === 'breath_far' ? vol * 0.6 : vol, send: 1.4, lowpass: sp?.lp });
    }
    this.log.push({ t: +e.now.toFixed(2), id, d: +d.toFixed(1), vol: +vol.toFixed(3) });
    if (this.log.length > 60) this.log.shift();
  }
}
