/**
 * Electric arcs: jagged camera-facing ribbons (main bolt + forks) re-randomised ~30x/s, one draw call
 * for all arcs. HDR cyan-white core + soft glow.
 */
import * as THREE from 'three';
import { createArcMaterial } from './shaders';

const MAIN = 33;      // 2^5 + 1 points
const FORK = 13;
const FORKS = 3;
const PTS = MAIN + FORK * FORKS;
const MAX_ARCS = 4;

export interface ArcSlot {
  active: boolean;
  a: THREE.Vector3;
  b: THREE.Vector3;
  age: number;
  dur: number;
  regen: number;
  intensity: number;
  light: number;
  sparkTimer: number;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const u = new THREE.Vector3();
const v = new THREE.Vector3();
const d = new THREE.Vector3();

export class Arcs {
  readonly mesh: THREE.Mesh;
  readonly slots: ArcSlot[] = [];
  private pos: Float32Array;
  private tan: Float32Array;
  private si: Float32Array;
  private geo: THREE.BufferGeometry;
  private line = new Float32Array(MAIN * 3);
  private off = new Float32Array(MAIN * 2);

  constructor(pixelScale: THREE.IUniform<number>) {
    const nv = MAX_ARCS * PTS * 2;
    this.pos = new Float32Array(nv * 3);
    this.tan = new Float32Array(nv * 3);
    this.si = new Float32Array(nv * 2);
    const idx: number[] = [];
    for (let a = 0; a < MAX_ARCS; a++) {
      const strip = (start: number, n: number) => {
        for (let i = 0; i < n - 1; i++) {
          const p0 = (start + i) * 2, p1 = (start + i + 1) * 2;
          idx.push(p0, p0 + 1, p1 + 1, p0, p1 + 1, p1);
        }
      };
      const base = a * PTS;
      strip(base, MAIN);
      for (let f = 0; f < FORKS; f++) strip(base + MAIN + f * FORK, FORK);
    }
    for (let i = 0; i < nv; i++) this.si[i * 2] = i % 2 === 0 ? -1 : 1;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('tangent3', new THREE.BufferAttribute(this.tan, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('sideI', new THREE.BufferAttribute(this.si, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, createArcMaterial(pixelScale));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
    this.mesh.name = 'fx_arcs';
    for (let i = 0; i < MAX_ARCS; i++) {
      this.slots.push({ active: false, a: new THREE.Vector3(), b: new THREE.Vector3(), age: 0, dur: 0, regen: 0, intensity: 0, light: -1, sparkTimer: 0 });
    }
  }

  start(a: THREE.Vector3, b: THREE.Vector3, dur: number): ArcSlot {
    let s = this.slots.find((x) => !x.active);
    if (!s) { s = this.slots[0]; for (const x of this.slots) if (x.dur - x.age < s.dur - s.age) s = x; }
    s.active = true; s.a.copy(a); s.b.copy(b); s.age = 0; s.dur = dur; s.regen = 0; s.intensity = 1; s.sparkTimer = 0;
    this.build(this.slots.indexOf(s), s);
    return s;
  }

  /** Advance; returns true while any arc is active. Calls `onTick` per active arc each frame. */
  update(dt: number, onTick: (s: ArcSlot, dt: number) => void) {
    let any = false;
    for (let i = 0; i < MAX_ARCS; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.dur) { s.active = false; this.clear(i); continue; }
      any = true;
      s.regen -= dt;
      if (s.regen <= 0) {
        s.regen = 0.025 + Math.random() * 0.035;
        // flicker: occasional dropout, strong re-strikes
        const r = Math.random();
        s.intensity = r < 0.12 ? 0.08 : r < 0.3 ? 1.6 : 0.6 + Math.random() * 0.6;
        const fade = Math.min(1, (s.dur - s.age) / 0.12);
        s.intensity *= fade;
        this.build(i, s);
      }
      onTick(s, dt);
    }
    this.mesh.visible = any;
    if (any) {
      (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.tangent3 as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.sideI as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private clear(i: number) {
    const base = i * PTS * 2;
    for (let k = 0; k < PTS * 2; k++) this.si[(base + k) * 2 + 1] = 0;
    (this.geo.attributes.sideI as THREE.BufferAttribute).needsUpdate = true;
  }

  private build(i: number, s: ArcSlot) {
    d.subVectors(s.b, s.a);
    const len = d.length();
    if (len < 1e-4) return;
    d.multiplyScalar(1 / len);
    u.set(0, 1, 0);
    if (Math.abs(d.y) > 0.9) u.set(1, 0, 0);
    u.cross(d).normalize();
    v.crossVectors(d, u);
    // midpoint displacement on 2D perpendicular offsets
    const off = this.off;
    off.fill(0);
    let step = MAIN - 1, amp = len * 0.2;
    while (step > 1) {
      const h = step >> 1;
      for (let k = h; k < MAIN; k += step) {
        off[k * 2] = (off[(k - h) * 2] + off[(k + h) * 2]) * 0.5 + (Math.random() - 0.5) * amp;
        off[k * 2 + 1] = (off[(k - h) * 2 + 1] + off[(k + h) * 2 + 1]) * 0.5 + (Math.random() - 0.5) * amp;
      }
      step = h; amp *= 0.62;
    }
    const L = this.line;
    for (let k = 0; k < MAIN; k++) {
      const t = k / (MAIN - 1);
      L[k * 3] = s.a.x + d.x * len * t + u.x * off[k * 2] + v.x * off[k * 2 + 1];
      L[k * 3 + 1] = s.a.y + d.y * len * t + u.y * off[k * 2] + v.y * off[k * 2 + 1];
      L[k * 3 + 2] = s.a.z + d.z * len * t + u.z * off[k * 2] + v.z * off[k * 2 + 1];
    }
    const base = i * PTS;
    this.writeStrip(base, L, MAIN, s.intensity, 0);
    // forks
    const tmp = this.forkBuf;
    for (let f = 0; f < FORKS; f++) {
      const k0 = 3 + ((Math.random() * (MAIN - 8)) | 0);
      tmpA.set(L[k0 * 3], L[k0 * 3 + 1], L[k0 * 3 + 2]);
      const flen = len * (0.12 + Math.random() * 0.22);
      tmpB.copy(d).multiplyScalar(0.6)
        .addScaledVector(u, (Math.random() - 0.5) * 2)
        .addScaledVector(v, (Math.random() - 0.5) * 2).normalize();
      let a = flen * 0.25;
      let x = tmpA.x, y = tmpA.y, z = tmpA.z;
      const seg = flen / (FORK - 1);
      for (let k = 0; k < FORK; k++) {
        tmp[k * 3] = x; tmp[k * 3 + 1] = y; tmp[k * 3 + 2] = z;
        x += tmpB.x * seg + (Math.random() - 0.5) * a;
        y += tmpB.y * seg + (Math.random() - 0.5) * a;
        z += tmpB.z * seg + (Math.random() - 0.5) * a;
        a *= 0.92;
      }
      const on = Math.random() < 0.75 ? 1 : 0;
      this.writeStrip(base + MAIN + f * FORK, tmp, FORK, s.intensity * 0.7 * on, 1);
    }
  }
  private forkBuf = new Float32Array(FORK * 3);

  private writeStrip(start: number, P: Float32Array, n: number, intensity: number, taper: number) {
    for (let k = 0; k < n; k++) {
      const kp = Math.max(0, k - 1), kn = Math.min(n - 1, k + 1);
      const tx = P[kn * 3] - P[kp * 3], ty = P[kn * 3 + 1] - P[kp * 3 + 1], tz = P[kn * 3 + 2] - P[kp * 3 + 2];
      const t = k / (n - 1);
      const I = intensity * (taper ? Math.pow(1 - t, 1.5) : 1 - 0.25 * Math.abs(t - 0.5) * 2);
      for (let s = 0; s < 2; s++) {
        const vi = (start + k) * 2 + s;
        this.pos[vi * 3] = P[k * 3]; this.pos[vi * 3 + 1] = P[k * 3 + 1]; this.pos[vi * 3 + 2] = P[k * 3 + 2];
        this.tan[vi * 3] = tx; this.tan[vi * 3 + 1] = ty; this.tan[vi * 3 + 2] = tz;
        this.si[vi * 2 + 1] = I;
      }
    }
  }
}
