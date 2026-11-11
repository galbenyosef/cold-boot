/** Small allocation-free math helpers used by the player module (springs, noise, easing). */
import * as THREE from 'three';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth01 = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
/** Frame-rate independent exponential approach. */
export const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export const dampV3 = (a: THREE.Vector3, b: THREE.Vector3, lambda: number, dt: number) => a.lerp(b, 1 - Math.exp(-lambda * dt));

/** Wrap an angle into [-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/**
 * Damped harmonic spring on a scalar (semi-implicit Euler, sub-stepped for stiffness).
 * `freq` in Hz, `zeta` damping ratio (1 = critical).
 */
export class Spring {
  x = 0;
  v = 0;
  target = 0;
  constructor(public freq = 6, public zeta = 1) {}
  update(dt: number): number {
    const w = Math.PI * 2 * this.freq;
    const k = w * w, c = 2 * this.zeta * w;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = k * (this.target - this.x) - c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  impulse(v: number) { this.v += v; }
  reset(x = 0) { this.x = x; this.v = 0; this.target = x; }
}

export class Spring3 {
  readonly x = new THREE.Vector3();
  readonly v = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  constructor(public freq = 6, public zeta = 1) {}
  update(dt: number): THREE.Vector3 {
    const w = Math.PI * 2 * this.freq;
    const k = w * w, c = 2 * this.zeta * w;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    const x = this.x, v = this.v, t = this.target;
    for (let i = 0; i < steps; i++) {
      v.x += (k * (t.x - x.x) - c * v.x) * h;
      v.y += (k * (t.y - x.y) - c * v.y) * h;
      v.z += (k * (t.z - x.z) - c * v.z) * h;
      x.x += v.x * h; x.y += v.y * h; x.z += v.z * h;
    }
    return x;
  }
  impulse(x: number, y: number, z: number) { this.v.x += x; this.v.y += y; this.v.z += z; }
  reset() { this.x.set(0, 0, 0); this.v.set(0, 0, 0); this.target.set(0, 0, 0); }
}

/** Deterministic smooth 1D value noise in [-1, 1]. */
export function noise1(t: number, seed = 0): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i + seed * 131.7), hash(i + 1 + seed * 131.7), u) * 2 - 1;
}
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Mulberry32 PRNG — deterministic geometry jitter. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
