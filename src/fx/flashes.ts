/** Pooled short-lived point lights routed through ctx.render.lights (never THREE.Light directly). */
import * as THREE from 'three';
import type { LightHandle, LightManager } from '../core/types';

interface Slot {
  h: LightHandle;
  age: number;
  dur: number;
  peak: number;
  /** 0 = smooth decay, >0 = crackle (random flicker) */
  crackle: number;
  busy: boolean;
}

const tmpColor = new THREE.Color();
const tmpP = new THREE.Vector3();

export class Flashes {
  private slots: Slot[] = [];
  /** Camera position (updated by the owner). Flash lights are pulled slightly toward it so a light
   *  spawned on a surface does not blow out a tiny hotspot on that surface. */
  readonly cam = new THREE.Vector3();

  private place(h: LightHandle, p: THREE.Vector3) {
    tmpP.subVectors(this.cam, p);
    const d = tmpP.length();
    if (d > 1e-3) tmpP.multiplyScalar(Math.min(0.3, d * 0.3) / d);
    h.position.copy(p).add(tmpP);
  }

  constructor(lights: LightManager, count = 4) {
    for (let i = 0; i < count; i++) {
      const h = lights.add({
        type: 'point', position: new THREE.Vector3(0, -50, 0), color: 0xffaa66, intensity: 1, distance: 8,
        priority: 50, enabled: false, castShadow: false, flicker: 'none', group: 'fx_flash',
      });
      h.intensityScale = 0;
      this.slots.push({ h, age: 0, dur: 0, peak: 0, crackle: 0, busy: false });
    }
  }

  /** Returns slot index (for re-positioning by arcs) or -1. */
  fire(p: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, duration: number, distance: number, crackle = 0): number {
    if (this.slots.length === 0) return -1;
    // free slot, else the one with the least remaining energy
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.busy) { best = i; break; }
      const rem = s.peak * Math.max(0, 1 - s.age / s.dur);
      if (rem < bestScore) { bestScore = rem; best = i; }
    }
    if (!this.slots[best].busy || bestScore < intensity) {
      const s = this.slots[best];
      s.busy = true; s.age = 0; s.dur = Math.max(0.016, duration); s.peak = intensity; s.crackle = crackle;
      this.place(s.h, p);
      tmpColor.set(color);
      s.h.setColor(tmpColor);
      s.h.desc.distance = distance;
      s.h.intensityScale = intensity;
      s.h.enabled = true;
      return best;
    }
    return -1;
  }

  move(slot: number, p: THREE.Vector3) { if (slot >= 0) this.place(this.slots[slot].h, p); }

  update(dt: number) {
    for (const s of this.slots) {
      if (!s.busy) continue;
      s.age += dt;
      const t = s.age / s.dur;
      if (t >= 1) { s.busy = false; s.h.enabled = false; s.h.intensityScale = 0; continue; }
      // fast attack (first 8%), then quadratic decay
      let env = t < 0.08 ? 0.4 + 0.6 * (t / 0.08) : Math.pow(1 - (t - 0.08) / 0.92, 2);
      if (s.crackle > 0) env = (1 - t * 0.3) * (Math.random() < 0.15 ? 0.1 : 0.45 + Math.random() * 0.75);
      s.h.intensityScale = s.peak * env;
    }
  }
}
