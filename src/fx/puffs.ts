/**
 * Billboard puffs: one sorted, instanced draw call for smoke, dust, steam, fireballs (fire → smoke over
 * life in the same particle), shockwave rings and glow flares.
 */
import * as THREE from 'three';
import { PlaneRing, SlotPool } from './pool';
import { createPuffMaterial } from './shaders';

export const SHAPE = { SMOKE: 0, RING: 1, GLOW: 2 } as const;

export interface PuffSpawn {
  shape: number;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  /** Negative = delay before appearing. */
  delay: number;
  life: number;
  s0: number; s1: number;
  rot: number; rotV: number;
  alpha: number;
  /** Fire emission at birth (0 = none) and its exponential decay rate per second. */
  emit: number; emitDecay: number;
  r: number; g: number; b: number;
  drag: number; buoy: number;
  er0: number; er1: number;
  /** Henyey-Greenstein g for forward scattering (steam ~0.5, dust ~0.25). */
  phase: number;
  fadeIn: number;
  /** Size ease exponent: size = s0 + (s1 - s0) * (1 - (1 - t)^grow). 1 = linear, 2.2 = fast then slow. */
  grow: number;
  /** Alpha fade-out exponent: alpha *= (1 - t)^fadePow. */
  fadePow: number;
  /** Collision planes (PlaneRing indices, -1 none): the puff centre is kept ~0.5 size off them. */
  planeA: number; planeB: number;
}

const STRIDE = 16;
const _bp = new THREE.Vector3();

export class Puffs {
  readonly mesh: THREE.Mesh;
  readonly s: PuffSpawn = {
    shape: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, delay: 0, life: 2, s0: 0.2, s1: 1, rot: 0, rotV: 0,
    alpha: 0.5, emit: 0, emitDecay: 3, r: 0.5, g: 0.5, b: 0.5, drag: 1, buoy: 0, er0: 0, er1: 0.5, phase: 0.3, fadeIn: 0.1, grow: 2.2, fadePow: 1.3, planeA: -1, planeB: -1,
  };
  private pool: SlotPool;
  private F: Record<string, Float32Array>;
  private shape: Uint8Array;
  private tile: Uint8Array;
  private pa: Int16Array;
  private pb: Int16Array;
  private inOrder: Uint8Array;
  private order: Int32Array;
  private orderN = 0;
  private key: Float32Array;
  private buf: Float32Array;
  private ib: THREE.InstancedInterleavedBuffer;
  private geo: THREE.InstancedBufferGeometry;
  private dt = 0;
  private sweepFn: (s: number) => boolean;
  private camPos = new THREE.Vector3();
  private camDir = new THREE.Vector3();
  /**
   * Stage 3b §8.6.3: a bounded set (its own instance): puffs die when their centre leaves the box and fade to 0
   * toward its faces (over `boundsFade` m, or 0.4 × the puff's size when larger, so no billboard pokes far out).
   */
  bounds: THREE.Box3 | null = null;
  boundsFade = 0.3;

  constructor(readonly cap: number, tex: THREE.Texture, private planes: PlaneRing) {
    this.pool = new SlotPool(cap);
    const f = () => new Float32Array(cap);
    this.F = {
      px: f(), py: f(), pz: f(), vx: f(), vy: f(), vz: f(), age: f(), life: f(), s0: f(), s1: f(), rot: f(), rotV: f(),
      alpha: f(), grow: f(), fadePow: f(), emit: f(), emitDecay: f(), r: f(), g: f(), b: f(), drag: f(), buoy: f(), er0: f(), er1: f(), phase: f(), fadeIn: f(),
    };
    this.shape = new Uint8Array(cap);
    this.tile = new Uint8Array(cap);
    this.pa = new Int16Array(cap);
    this.pb = new Int16Array(cap);
    this.inOrder = new Uint8Array(cap);
    this.order = new Int32Array(cap);
    this.key = new Float32Array(cap);
    this.buf = new Float32Array(cap * STRIDE);
    this.ib = new THREE.InstancedInterleavedBuffer(this.buf, STRIDE, 1);
    this.ib.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    for (let k = 0; k < 4; k++) geo.setAttribute('a' + k, new THREE.InterleavedBufferAttribute(this.ib, 4, k * 4));
    geo.instanceCount = 0;
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, createPuffMaterial(tex));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'fx_puffs';
    this.sweepFn = (s) => this.step(s);
  }

  get count() { return this.pool.count; }

  /** Spawn from this instance's scratch `s`, or from another instance's (bounded sets reuse the global fill code). */
  spawn(s: PuffSpawn = this.s): number {
    if (this.bounds && !this.bounds.containsPoint(_bp.set(s.px, s.py, s.pz))) return -1;
    const slot = this.pool.alloc();
    if (slot < 0) return -1;
    const F = this.F;
    F.px[slot] = s.px; F.py[slot] = s.py; F.pz[slot] = s.pz;
    F.vx[slot] = s.vx; F.vy[slot] = s.vy; F.vz[slot] = s.vz;
    F.age[slot] = -Math.max(0, s.delay); F.life[slot] = s.life;
    F.s0[slot] = s.s0; F.s1[slot] = s.s1; F.rot[slot] = s.rot; F.rotV[slot] = s.rotV;
    F.alpha[slot] = s.alpha; F.emit[slot] = s.emit; F.emitDecay[slot] = s.emitDecay;
    F.r[slot] = s.r; F.g[slot] = s.g; F.b[slot] = s.b;
    F.drag[slot] = s.drag; F.buoy[slot] = s.buoy; F.er0[slot] = s.er0; F.er1[slot] = s.er1;
    F.phase[slot] = s.phase; F.grow[slot] = s.grow; F.fadePow[slot] = s.fadePow; F.fadeIn[slot] = Math.max(0.01, s.fadeIn);
    this.shape[slot] = s.shape;
    this.tile[slot] = (Math.random() * 4) | 0;
    this.inOrder[slot] = 0;
    this.pa[slot] = s.planeA; this.pb[slot] = s.planeB;
    return slot;
  }

  update(dt: number, camera: THREE.Camera) {
    this.dt = dt;
    if (dt > 0) this.pool.sweep(this.sweepFn);
    camera.getWorldPosition(this.camPos);
    camera.getWorldDirection(this.camDir);
    this.sort();
    this.write();
  }

  private step(i: number): boolean {
    const F = this.F, dt = this.dt;
    const age = (F.age[i] += dt);
    if (age >= F.life[i]) { this.inOrder[i] = 0; return false; }
    if (age < 0) return true;
    const damp = Math.max(0, 1 - F.drag[i] * dt);
    F.vx[i] *= damp; F.vz[i] *= damp;
    F.vy[i] = F.vy[i] * damp + F.buoy[i] * dt;
    F.px[i] += F.vx[i] * dt; F.py[i] += F.vy[i] * dt; F.pz[i] += F.vz[i] * dt;
    if (this.bounds && !this.bounds.containsPoint(_bp.set(F.px[i], F.py[i], F.pz[i]))) { this.inOrder[i] = 0; return false; }
    const pa = this.pa[i], pb = this.pb[i];
    if (pa >= 0 || pb >= 0) {
      const t = age / F.life[i];
      const size = F.s0[i] + (F.s1[i] - F.s0[i]) * (1 - Math.pow(1 - t, F.grow[i]));
      const minD = size * 0.75;
      const P = this.planes.data;
      for (let k = 0; k < 2; k++) {
        const pl = k === 0 ? pa : pb;
        if (pl < 0) continue;
        const o = pl * 4;
        const nx = P[o], ny = P[o + 1], nz = P[o + 2];
        const dist = nx * F.px[i] + ny * F.py[i] + nz * F.pz[i] + P[o + 3];
        if (dist >= minD) continue;
        const push = Math.min(minD - dist, 2.5 * dt + 0.02); // ease out instead of popping
        F.px[i] += nx * push; F.py[i] += ny * push; F.pz[i] += nz * push;
        const vn = nx * F.vx[i] + ny * F.vy[i] + nz * F.vz[i];
        if (vn < 0) { F.vx[i] -= nx * vn; F.vy[i] -= ny * vn; F.vz[i] -= nz * vn; }
      }
    }
    F.rot[i] += F.rotV[i] * dt;
    F.rotV[i] *= 1 - 0.3 * dt;
    return true;
  }

  private sort() {
    const order = this.order, inO = this.inOrder, act = this.pool.active, n = this.pool.count, key = this.key;
    const F = this.F, cx = this.camPos.x, cy = this.camPos.y, cz = this.camPos.z;
    const dx = this.camDir.x, dy = this.camDir.y, dz = this.camDir.z;
    // keep previous order (minus dead), append newcomers
    let w = 0;
    for (let r = 0; r < this.orderN; r++) { const s = order[r]; if (inO[s]) order[w++] = s; }
    for (let k = 0; k < n; k++) { const s = act[k]; if (!inO[s]) { inO[s] = 1; order[w++] = s; } }
    this.orderN = w;
    for (let k = 0; k < w; k++) {
      const s = order[k];
      key[s] = (F.px[s] - cx) * dx + (F.py[s] - cy) * dy + (F.pz[s] - cz) * dz;
    }
    // insertion sort, far → near (mostly sorted frame to frame)
    for (let k = 1; k < w; k++) {
      const s = order[k], kv = key[s];
      let j = k - 1;
      while (j >= 0 && key[order[j]] < kv) { order[j + 1] = order[j]; j--; }
      order[j + 1] = s;
    }
  }

  private write() {
    const F = this.F, buf = this.buf, order = this.order, n = this.orderN;
    let k = 0;
    for (let q = 0; q < n; q++) {
      const i = order[q];
      const age = F.age[i];
      if (age < 0) continue;
      if (this.key[i] < -1.5) continue; // well behind the camera
      const life = F.life[i];
      const t = age / life;
      const shape = this.shape[i];
      const ease = 1 - Math.pow(1 - t, F.grow[i]);
      const size = F.s0[i] + (F.s1[i] - F.s0[i]) * ease;
      const fin = Math.min(1, t / F.fadeIn[i]);
      let alpha: number, emit: number;
      if (shape === 0) {
        alpha = F.alpha[i] * fin * Math.pow(1 - t, F.fadePow[i]);
        emit = F.emit[i] > 0 ? F.emit[i] * Math.exp(-F.emitDecay[i] * age) : 0;
      } else {
        alpha = fin;
        emit = F.emit[i] * (1 - t) * (1 - t);
      }
      if (this.bounds) {
        const b = this.bounds, x = F.px[i], y = F.py[i], z = F.pz[i];
        const d = Math.min(x - b.min.x, b.max.x - x, y - b.min.y, b.max.y - y, z - b.min.z, b.max.z - z);
        const f = Math.max(this.boundsFade, size * 0.4);
        alpha *= d <= 0 ? 0 : d >= f ? 1 : (d / f) * (d / f) * (3 - 2 * d / f);
        emit *= d <= 0 ? 0 : Math.min(1, d / f);
        if (alpha <= 0.001 && emit <= 0.001) continue;
      }
      const o = k * STRIDE;
      buf[o] = F.px[i]; buf[o + 1] = F.py[i]; buf[o + 2] = F.pz[i]; buf[o + 3] = size;
      buf[o + 4] = F.rot[i]; buf[o + 5] = alpha; buf[o + 6] = emit; buf[o + 7] = shape;
      buf[o + 8] = F.r[i]; buf[o + 9] = F.g[i]; buf[o + 10] = F.b[i]; buf[o + 11] = this.tile[i];
      buf[o + 12] = F.er0[i] + (F.er1[i] - F.er0[i]) * t; buf[o + 13] = F.phase[i]; buf[o + 14] = 0; buf[o + 15] = 0;
      k++;
    }
    this.geo.instanceCount = k;
    this.mesh.visible = k > 0;
    if (k > 0) {
      this.ib.clearUpdateRanges();
      this.ib.addUpdateRange(0, k * STRIDE);
      this.ib.needsUpdate = true;
    }
  }
}
