/**
 * Streak particles: one instanced draw call for sparks (emissive HDR streaks), oil / blood droplets,
 * debris chips, glass glitter, water drops and floating dust motes. CPU simulated (cheap plane collision),
 * GPU expanded (camera-facing capsules stretched along velocity).
 */
import * as THREE from 'three';
import { PlaneRing, SlotPool } from './pool';
import { createStreakMaterial } from './shaders';

export const ST = {
  SPARK: 0, MINI: 1, OIL: 2, BLOOD: 3, CHIP: 4, GLASS: 5, MOTE: 6, DROP: 7, SPLASH: 8,
} as const;
export type ST = number;

/** Scratch spawn parameters (fill, then call spawn()). Avoids per-spawn allocation. */
export interface StreakSpawn {
  type: ST;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  life: number; size: number;
  r: number; g: number; b: number;
  alpha: number;
  drag: number; grav: number; rest: number;
  heat: number;
  planeA: number; planeB: number;
  /** Initial age (prewarm), seconds. */
  age0: number;
}

export type LandHook = (type: ST, x: number, y: number, z: number, nx: number, ny: number, nz: number, speed: number) => void;

const STRIDE = 12;

export class Streaks {
  readonly mesh: THREE.Mesh;
  readonly planes = new PlaneRing(256);
  readonly s: StreakSpawn = {
    type: ST.SPARK, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 0.01,
    r: 1, g: 1, b: 1, alpha: 1, drag: 0, grav: 1, rest: 0.3, heat: 1, planeA: -1, planeB: -1, age0: 0,
  };
  /** Plane index of the most recent collision (valid inside onLand). */
  hitPlane = -1;
  onLand: LandHook | null = null;
  gravity = -9.81;

  private pool: SlotPool;
  private buf: Float32Array;
  private ib: THREE.InstancedInterleavedBuffer;
  private geo: THREE.InstancedBufferGeometry;
  private F: Record<string, Float32Array>;
  private type: Uint8Array;
  private pa: Int16Array;
  private pb: Int16Array;
  private bounces: Uint8Array;
  private dt = 0;
  private sweepFn: (s: number) => boolean;

  constructor(readonly cap: number, pixelScale: THREE.IUniform<number>) {
    this.pool = new SlotPool(cap);
    const f = (n = cap) => new Float32Array(n);
    this.F = {
      px: f(), py: f(), pz: f(), vx: f(), vy: f(), vz: f(), age: f(), life: f(), size: f(),
      r: f(), g: f(), b: f(), alpha: f(), drag: f(), grav: f(), rest: f(), heat: f(), seed: f(),
    };
    this.type = new Uint8Array(cap);
    this.pa = new Int16Array(cap);
    this.pb = new Int16Array(cap);
    this.bounces = new Uint8Array(cap);

    this.buf = new Float32Array(cap * STRIDE);
    this.ib = new THREE.InstancedInterleavedBuffer(this.buf, STRIDE, 1);
    this.ib.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('a0', new THREE.InterleavedBufferAttribute(this.ib, 4, 0));
    geo.setAttribute('a1', new THREE.InterleavedBufferAttribute(this.ib, 4, 4));
    geo.setAttribute('a2', new THREE.InterleavedBufferAttribute(this.ib, 4, 8));
    geo.instanceCount = 0;
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, createStreakMaterial(pixelScale));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'fx_streaks';
    this.sweepFn = (s) => this.step(s);
  }

  get count() { return this.pool.count; }

  spawn(): number {
    const slot = this.pool.alloc();
    if (slot < 0) return -1;
    const s = this.s, F = this.F;
    F.px[slot] = s.px; F.py[slot] = s.py; F.pz[slot] = s.pz;
    F.vx[slot] = s.vx; F.vy[slot] = s.vy; F.vz[slot] = s.vz;
    F.age[slot] = s.age0; F.life[slot] = s.life; F.size[slot] = s.size;
    F.r[slot] = s.r; F.g[slot] = s.g; F.b[slot] = s.b; F.alpha[slot] = s.alpha;
    F.drag[slot] = s.drag; F.grav[slot] = s.grav; F.rest[slot] = s.rest; F.heat[slot] = s.heat;
    F.seed[slot] = Math.random();
    this.type[slot] = s.type;
    this.pa[slot] = s.planeA; this.pb[slot] = s.planeB;
    this.bounces[slot] = 0;
    return slot;
  }

  update(dt: number) {
    this.dt = dt;
    if (dt > 0) this.pool.sweep(this.sweepFn);
    this.write();
  }

  private step(i: number): boolean {
    const F = this.F, dt = this.dt;
    const age = (F.age[i] += dt);
    if (age >= F.life[i]) return false;
    const t = this.type[i];
    let vx = F.vx[i], vy = F.vy[i], vz = F.vz[i];
    if (t === ST.MOTE) {
      // gentle brownian wander, slight sink
      const k = 0.06 * dt;
      vx += (Math.random() - 0.5) * k; vy += (Math.random() - 0.52) * k * 0.6; vz += (Math.random() - 0.5) * k;
      const damp = 1 - 0.15 * dt;
      vx *= damp; vy *= damp; vz *= damp;
    } else {
      const damp = Math.max(0, 1 - F.drag[i] * dt);
      vx *= damp; vy *= damp; vz *= damp;
      vy += this.gravity * F.grav[i] * dt;
    }
    let px = F.px[i] + vx * dt, py = F.py[i] + vy * dt, pz = F.pz[i] + vz * dt;

    // plane collisions
    for (let k = 0; k < 2; k++) {
      const pl = k === 0 ? this.pa[i] : this.pb[i];
      if (pl < 0) continue;
      const P = this.planes.data, o = pl * 4;
      const nx = P[o], ny = P[o + 1], nz = P[o + 2];
      const dist = nx * px + ny * py + nz * pz + P[o + 3];
      if (dist >= 0) continue;
      px -= nx * dist; py -= ny * dist; pz -= nz * dist;
      const vn = nx * vx + ny * vy + nz * vz;
      if (vn >= 0) continue;
      this.hitPlane = pl;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (t === ST.OIL || t === ST.BLOOD || t === ST.DROP || t === ST.SPLASH) {
        if (this.onLand) this.onLand(t, px, py, pz, nx, ny, nz, speed);
        return false;
      }
      const rest = F.rest[i];
      // reflect normal component, damp tangential
      vx -= nx * vn; vy -= ny * vn; vz -= nz * vn;
      const fr = t === ST.SPARK || t === ST.MINI ? 0.7 : 0.55;
      vx *= fr; vy *= fr; vz *= fr;
      vx -= nx * vn * rest; vy -= ny * vn * rest; vz -= nz * vn * rest;
      const b = ++this.bounces[i];
      if (t === ST.SPARK) {
        if (b === 1 && F.heat[i] * (1 - age / F.life[i]) > 0.3 && this.onLand) this.onLand(t, px, py, pz, nx, ny, nz, speed);
        F.life[i] -= (F.life[i] - age) * 0.35; // bounced sparks cool faster
        if (b > 3) return false;
      } else if (t === ST.MINI) {
        if (b > 1) return false;
      } else if (speed < 0.35) {
        vx = vy = vz = 0;
        F.grav[i] = 0;
      }
    }
    F.px[i] = px; F.py[i] = py; F.pz[i] = pz;
    F.vx[i] = vx; F.vy[i] = vy; F.vz[i] = vz;
    return true;
  }

  private write() {
    const F = this.F, buf = this.buf, act = this.pool.active, n = this.pool.count;
    for (let k = 0; k < n; k++) {
      const i = act[k], o = k * STRIDE;
      const t = this.type[i];
      const lf = F.age[i] / F.life[i];
      let r = F.r[i], g = F.g[i], b = F.b[i], a = F.alpha[i], kind = 1, shutter = 0.028, size = F.size[i];
      if (t === ST.SPARK || t === ST.MINI) {
        const h = F.heat[i] * Math.pow(1 - lf, 0.75);
        // blackbody-ish ramp (linear HDR)
        if (h > 0.75) { const u = (h - 0.75) * 4; r = 7 + 2 * u; g = 3.6 + 3.4 * u; b = 0.9 + 3.6 * u; }
        else if (h > 0.5) { const u = (h - 0.5) * 4; r = 4.5 + 2.5 * u; g = 1.3 + 2.3 * u; b = 0.15 + 0.75 * u; }
        else if (h > 0.22) { const u = (h - 0.22) / 0.28; r = 1.2 + 3.3 * u; g = 0.13 + 1.17 * u; b = 0.02 + 0.13 * u; }
        else { const u = h / 0.22; r = 1.2 * u * u; g = 0.13 * u * u * u; b = 0.02 * u * u * u; }
        const fl = 0.7 + 0.6 * Math.random();
        r *= fl; g *= fl; b *= fl;
        kind = 0;
        shutter = t === ST.MINI ? 0.03 : 0.05;
        size *= 0.6 + 0.4 * (1 - lf);
      } else if (t === ST.MOTE) {
        kind = 2;
        shutter = 0;
        const fin = Math.min(1, lf * 5), fout = Math.min(1, (1 - lf) * 4);
        a *= fin * fout * (0.75 + 0.25 * Math.sin(F.age[i] * 2.3 + F.seed[i] * 40));
      } else {
        kind = t === ST.OIL ? 1.55 : t === ST.GLASS ? 1.9 : t === ST.DROP || t === ST.SPLASH ? 1.8 : t === ST.BLOOD ? 1.35 : 1.08;
        if (t === ST.CHIP || t === ST.GLASS) a *= Math.min(1, (1 - lf) * 5);
        shutter = t === ST.DROP ? 0.045 : 0.025;
      }
      let tx = F.vx[i] * shutter, ty = F.vy[i] * shutter, tz = F.vz[i] * shutter;
      const tl2 = tx * tx + ty * ty + tz * tz;
      const maxL = t === ST.SPARK ? 0.6 : 0.25;
      if (tl2 > maxL * maxL) { const s = maxL / Math.sqrt(tl2); tx *= s; ty *= s; tz *= s; }
      buf[o] = F.px[i]; buf[o + 1] = F.py[i]; buf[o + 2] = F.pz[i]; buf[o + 3] = size;
      buf[o + 4] = tx; buf[o + 5] = ty; buf[o + 6] = tz; buf[o + 7] = a;
      buf[o + 8] = r; buf[o + 9] = g; buf[o + 10] = b; buf[o + 11] = kind;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.ib.clearUpdateRanges();
      this.ib.addUpdateRange(0, n * STRIDE);
      this.ib.needsUpdate = true;
    }
  }
}
