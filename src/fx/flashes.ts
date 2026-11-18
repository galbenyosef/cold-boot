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
  /** Stage 3c (W6): keyed flashes (the soldiers' muzzle light) — one slot per key, re-triggered without a dip. */
  key: string | null;
  /**
   * Keyed envelope (0 = the plain flash): a hard pulse of `pulse` s from the peak, over a `tail` (fraction of the peak)
   * that fades linearly over the whole duration — the light never drops to black between the rounds of a burst.
   */
  pulse: number;
  tail: number;
  /** Keyed: not aged by the update right after the fire (the first rendered frame shows the full peak). */
  fresh: boolean;
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
      this.slots.push({ h, age: 0, dur: 0, peak: 0, crackle: 0, busy: false, key: null, pulse: 0, tail: 0, fresh: false });
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
      s.busy = true; s.age = 0; s.dur = Math.max(0.016, duration); s.peak = intensity; s.crackle = crackle; s.key = null; s.pulse = 0; s.tail = 0;
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

  /**
   * Stage 3c (W6): a keyed flash — at most ONE light per key level-wide (the soldiers' muzzle light: D24 counts one
   * muzzle point per view). Envelope: a hard `pulse` (s) from `intensity` over a `tail` (fraction) that fades linearly
   * across `duration`. While the key's light is still lit, a new fire moves and re-triggers it (never a second light),
   * so a burst reads as one flickering flare that never blacks out between rounds — not a strobe. Returns true when it
   * was a re-trigger.
   */
  fireKeyed(key: string, p: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, duration: number, distance: number,
    pulse: number, tail: number): boolean {
    let s = this.slots.find((x) => x.busy && x.key === key);
    const again = !!s;
    if (!s) {
      const i = this.fire(p, color, intensity, duration, distance);
      if (i < 0) return false;
      s = this.slots[i];
    }
    s.key = key; s.age = 0; s.dur = Math.max(0.016, duration); s.peak = intensity; s.crackle = 0;
    s.pulse = Math.max(0.016, pulse); s.tail = tail; s.fresh = true;
    this.place(s.h, p);
    tmpColor.set(color); s.h.setColor(tmpColor);
    s.h.desc.distance = distance;
    s.h.intensityScale = intensity;
    s.h.enabled = true;
    return again;
  }

  move(slot: number, p: THREE.Vector3) { if (slot >= 0) this.place(this.slots[slot].h, p); }

  update(dt: number) {
    for (const s of this.slots) {
      if (!s.busy) continue;
      if (s.fresh) { s.fresh = false; s.h.intensityScale = s.peak; continue; }
      s.age += dt;
      const t = s.age / s.dur;
      if (t >= 1) { s.busy = false; s.h.enabled = false; s.h.intensityScale = 0; s.key = null; continue; }
      let env: number;
      if (s.pulse > 0) {
        // keyed: the pulse over a linearly fading tail
        const tp = s.age / s.pulse;
        env = Math.max(tp < 1 ? (1 - tp) * (1 - tp) : 0, s.tail * (1 - t));
      } else {
        // fast attack (first 8%), then quadratic decay
        env = t < 0.08 ? 0.4 + 0.6 * (t / 0.08) : Math.pow(1 - (t - 0.08) / 0.92, 2);
      }
      if (s.crackle > 0) env = (1 - t * 0.3) * (Math.random() < 0.15 ? 0.1 : 0.45 + Math.random() * 0.75);
      s.h.intensityScale = s.peak * env;
    }
  }
}
