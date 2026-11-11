/**
 * Always-on small motion: breathing curtains, swaying cable bundles, damped swings. Everything here is
 * allocation-free per frame and only runs while its room is being drawn (see LevelBuild.ambient).
 */
import * as THREE from 'three';
import type { Mat } from './builder';
import type { LevelBuild } from './context';
import { hose } from './kit';

const PI = Math.PI;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

let curtainUnit: THREE.BufferGeometry | null = null;
/** 1 × 1 m rippled cloth hanging from y = 0 (top edge) down to y = -1, centred in X. */
export function unitCurtain(): THREE.BufferGeometry {
  if (curtainUnit) return curtainUnit;
  const g = new THREE.PlaneGeometry(1, 1, 36, 4);
  g.translate(0, -0.5, 0);
  const p = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, Math.sin(x * 9 * 2 * PI) * 0.028 * (0.55 - 0.45 * y) + Math.sin(x * 5.3 + y * 3) * 0.012);
    uv.setXY(i, uv.getX(i) * 1.4, uv.getY(i) * 1.8);
  }
  g.computeVertexNormals();
  return (curtainUnit = g);
}

/**
 * All the hanging cloth of one room as ONE instanced mesh. Each panel hangs from its top edge and
 * breathes: a slow swing about the rail plus a little billow, every panel on its own phase.
 */
export class Curtains {
  private items: { x: number; y: number; z: number; ry: number; w: number; h: number; ph: number; amp: number }[] = [];
  constructor(private L: LevelBuild, private room: string, private mat: THREE.Material) {}
  /** `(x, yTop, z)` = middle of the rail edge; the panel hangs in the plane facing `ry`. */
  add(x: number, yTop: number, z: number, ry: number, w: number, h: number, amp = 1): this {
    this.items.push({ x, y: yTop, z, ry, w, h, ph: this.items.length * 2.39 + x, amp });
    return this;
  }
  finish(): THREE.InstancedMesh {
    const it = this.items;
    const mesh = new THREE.InstancedMesh(unitCurtain(), this.mat, it.length);
    mesh.name = `${this.room}:curtains`;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    const write = (t: number) => {
      for (let i = 0; i < it.length; i++) {
        const c = it[i];
        const a = (Math.sin(t * 0.61 + c.ph) * 0.03 + Math.sin(t * 1.37 + c.ph * 1.7) * 0.012) * c.amp;
        _q.setFromEuler(_e.set(a, c.ry, 0, 'YXZ'));
        _m.compose(_p.set(c.x, c.y, c.z), _q, _s.set(c.w * (1 + Math.sin(t * 0.43 + c.ph * 0.7) * 0.012 * c.amp), c.h, 1 + Math.sin(t * 0.8 + c.ph) * 0.25 * c.amp));
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    write(0);
    mesh.computeBoundingSphere(); mesh.computeBoundingBox();
    mesh.userData.rooms = [this.room];
    this.L.root.add(mesh);
    this.L.ambient(this.room, (_dt, t) => write(t));
    return mesh;
  }
}

export interface Strand { dx: number; dz: number; len: number; r?: number; bow?: number }
/**
 * A bundle of cables / hoses / chains hanging from one point, swaying as one object (one draw call).
 * Returns the group (pivot at the anchor) so callers can hang more things on it.
 */
export function hangingBundle(L: LevelBuild, room: string, x: number, y: number, z: number, strands: Strand[],
  o: { amp?: number; period?: number; mat?: Mat; cast?: boolean; weight?: (b: ReturnType<LevelBuild['part']>) => void } = {}): THREE.Group {
  const b = L.part(`${room}:hanging`);
  const mat = o.mat ?? 'rubber';
  for (const s of strands) {
    const bow = s.bow ?? 0.06;
    hose(b, mat, [[s.dx, 0, s.dz], [s.dx + bow, -s.len * 0.35, s.dz + bow * 0.6], [s.dx + bow * 0.4, -s.len * 0.7, s.dz - bow * 0.3], [s.dx, -s.len, s.dz]], s.r ?? 0.014, 5, 4);
  }
  o.weight?.(b);
  const g = b.build(false);
  g.position.set(x, y, z);
  for (const m of g.children) { m.castShadow = !!o.cast; m.matrixAutoUpdate = false; }
  g.userData.rooms = [room];
  L.root.add(g);
  const amp = o.amp ?? 0.035, w = (2 * PI) / (o.period ?? 4.2), ph = x * 1.3 + z * 0.7;
  L.ambient(room, (_dt, t) => {
    g.rotation.x = Math.sin(t * w + ph) * amp + Math.sin(t * w * 2.3 + ph * 2) * amp * 0.25;
    g.rotation.z = Math.sin(t * w * 0.83 + ph * 1.9) * amp * 0.8;
  });
  return g;
}

/** Damped pendulum integrator (angle about a pivot, radians). */
export class Swing {
  a: number; v = 0;
  constructor(public rest: number, public w2: number, public damp: number, a0 = rest) { this.a = a0; }
  /** Advance; returns the angle. `w2` = g/L-style stiffness, `damp` 1/s. */
  step(dt: number): number {
    // semi-implicit Euler in two half steps: stable at 20 fps for the stiffnesses used here
    for (let i = 0; i < 2; i++) {
      const h = dt * 0.5;
      this.v += (-this.w2 * Math.sin(this.a - this.rest) - this.damp * this.v) * h;
      this.a += this.v * h;
    }
    return this.a;
  }
  get energy(): number { return Math.abs(this.v) + Math.abs(this.a - this.rest) * Math.sqrt(this.w2); }
}

export const easeInOut = (k: number) => k * k * (3 - 2 * k);
export const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
export const easeIn = (k: number) => k * k;
/** Overshoots by ~10 % and settles. */
export const easeBack = (k: number) => { const c = 1.70158; const x = k - 1; return 1 + (c + 1) * x * x * x + c * x * x; };

/** [cx, cy, cz, rx, ry, rz] — solid the cloth lies over. */
export type DrapeBlob = [number, number, number, number, number, number];
/**
 * Cloth thrown over a set of ellipsoids standing on the floor: a height field (top surface of the solids),
 * relaxed so the cloth spans gaps and falls away from every high point at `slope`, then smoothed and
 * creased a little. Footprint x0…x1 × z0…z1; the hem reaches the floor inside it.
 */
export function drapeGeo(blobs: DrapeBlob[], x0: number, x1: number, z0: number, z1: number, nx: number, nz: number, slope = 2.4, wallZ: number | null = null): THREE.BufferGeometry {
  const W = nx + 1, D = nz + 1, dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;
  let h = new Float32Array(W * D);
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
    const x = x0 + i * dx, z = z0 + j * dz;
    let y = 0;
    for (const [cx, cy, cz, rx, ry, rz] of blobs) {
      const u = (x - cx) / rx, v = (z - cz) / rz, q = 1 - u * u - v * v;
      if (q > 0) y = Math.max(y, cy + ry * Math.sqrt(q));
    }
    h[j * W + i] = y;
  }
  // tent relaxation (cone dilation), a few sweeps in each direction
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < D; j++) for (let i = 1; i < W; i++) h[j * W + i] = Math.max(h[j * W + i], h[j * W + i - 1] - slope * dx);
    for (let j = 0; j < D; j++) for (let i = W - 2; i >= 0; i--) h[j * W + i] = Math.max(h[j * W + i], h[j * W + i + 1] - slope * dx);
    for (let j = 1; j < D; j++) for (let i = 0; i < W; i++) h[j * W + i] = Math.max(h[j * W + i], h[(j - 1) * W + i] - slope * dz);
    for (let j = D - 2; j >= 0; j--) for (let i = 0; i < W; i++) h[j * W + i] = Math.max(h[j * W + i], h[(j + 1) * W + i] - slope * dz);
  }
  for (let pass = 0; pass < 2; pass++) {
    const o = new Float32Array(W * D);
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
      const a = h[j * W + Math.max(0, i - 1)], b = h[j * W + Math.min(W - 1, i + 1)], c = h[Math.max(0, j - 1) * W + i], d = h[Math.min(D - 1, j + 1) * W + i];
      o[j * W + i] = h[j * W + i] * 0.4 + (a + b + c + d) * 0.15;
    }
    h = o;
  }
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
  g.rotateX(-PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const p = g.getAttribute('position');
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), z = p.getZ(k);
    const i = Math.round((x - x0) / dx), j = Math.round((z - z0) / dz);
    let y = h[j * W + i];
    // hem: down to the floor at the border (but not on the side leaning against a wall)
    let e = Math.min(x - x0, x1 - x, z - z0, wallZ !== null && wallZ > z ? 1 : z1 - z);
    if (wallZ !== null && wallZ <= z0 + 1e-6) e = Math.min(x - x0, x1 - x, z1 - z);
    y *= Math.min(1, Math.max(0, e) / 0.1);
    y += 0.012 + 0.012 * Math.sin(x * 21 + z * 9) * Math.sin(z * 15 - x * 7) * Math.min(1, y * 6 + 0.3);
    p.setY(k, y);
  }
  g.computeVertexNormals();
  return g;
}
