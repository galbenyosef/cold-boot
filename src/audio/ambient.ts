/**
 * Ambience: per-room base bed (crossfaded loops) + a generative layer of distant, randomly positioned
 * events at long irregular intervals — more frequent when it's quiet.
 */
import * as THREE from 'three';
import type { AudioEngine, LoopVoice } from './engine';

const BED_IDS = ['amb_room', 'amb_fab', 'amb_gen'] as const;

export class Ambience {
  private beds = new Map<string, LoopVoice>();
  private levels: Record<string, number> = {};
  private next = 0;
  private readonly pos = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  /** 0..1 how "busy" the soundscape is (combat, music) — fewer random events when high. */
  busy = 0;
  enabled = true;
  powerOn = false;

  constructor(private readonly eng: AudioEngine) {}

  /** Crossfade the bed to the current room's preset. */
  applyRoom(): void {
    const bed = this.eng.room.bed;
    for (const id of BED_IDS) {
      let lv = bed[id] ?? 0;
      if (id === 'amb_gen' && this.powerOn && this.eng.roomId === 'fab') lv = Math.max(lv, 0.25);
      this.levels[id] = lv;
      let l = this.beds.get(id);
      if (lv > 0 && !l) {
        l = this.eng.loop(id, { volume: 0 }) as LoopVoice;
        this.beds.set(id, l);
      }
      l?.setVolume(lv, 2.5);
    }
  }

  stopAll(fade = 1.5): void {
    for (const l of this.beds.values()) l.stop(fade);
    this.beds.clear();
  }

  update(): void {
    const e = this.eng;
    if (!this.enabled || !e.running) return;
    const now = e.now;
    if (this.next === 0) { this.next = now + 6 + Math.random() * 8; return; }
    if (now < this.next) return;
    // quieter → more frequent; busy → postpone
    if (this.busy > 0.5) { this.next = now + 6 + Math.random() * 6; return; }
    this.next = now + (9 + Math.random() * 20) * (0.75 + this.busy);
    const palette = e.room.events;
    let total = 0;
    for (const k in palette) total += palette[k];
    let r = Math.random() * total, id = 'drip';
    for (const k in palette) { r -= palette[k]; if (r <= 0) { id = k; break; } }
    // random direction around the listener, mostly behind / to the sides, at distance
    const a = Math.random() * Math.PI * 2;
    const d = id === 'drip' ? 4 + Math.random() * 8 : 10 + Math.random() * 16;
    this.pos.set(e.listener.x + Math.cos(a) * d, e.listener.y + (Math.random() * 4 - 1), e.listener.z + Math.sin(a) * d);
    const vol = 0.35 + Math.random() * 0.4;
    if (id === 'vent_scuttle') {
      // faint skittering that crosses overhead / behind a wall
      const b = a + (Math.random() < 0.5 ? 1 : -1) * (0.8 + Math.random());
      this.to.set(e.listener.x + Math.cos(b) * d, this.pos.y + 1, e.listener.z + Math.sin(b) * d);
      e.play(id, { position: this.pos, moveTo: this.to, moveDur: 2.8, volume: vol * 0.35, pitch: 0.85 + Math.random() * 0.3 });
    } else if (id === 'metal_groan') {
      e.play(id, { position: this.pos, volume: vol * 0.7, pitch: 0.7 + Math.random() * 0.3, send: 1.5 });
    } else {
      e.play(id, { position: this.pos, volume: vol, send: 1.4 });
    }
  }
}
