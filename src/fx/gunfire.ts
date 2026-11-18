/**
 * Stage 3c §8.12 (W6) — enemy gunfire: tracers and muzzle flashes. Each is ONE dynamic mesh for its whole pool
 * (additive HDR, depth-tested, no light, nothing allocated per shot); fx/index.ts owns the muzzle light (one keyed
 * flash) and the smoke wisp.
 *
 * Tracers (pool 32, the player's tracer look — `player/tracers.ts` — in a pool of their own):
 *   - camera-facing streak, bright rounded head and a long tapering tail: the head says which way the round flies;
 *   - **nearness**: the streak keeps a minimum apparent width in the distance (never aliases away) and a maximum one
 *     close up (a round passing 0.5 m from the eye is a hot line, not an orange wall); within ~4 m of the eye the
 *     round slows (to 0.4 × at the eye) so a miss passing close is on screen for 4–6 frames instead of 1–2, and its
 *     colour is pushed hotter there — the close ones are SEEN passing;
 *   - it fades out as the tail catches up with the end point (the impact marks it from there).
 * Muzzle flashes (pool 16): a star core (camera-facing; bigger the more the barrel points at the eye — a soldier
 * shooting AT you is a bright star) plus a flame tongue along the barrel (side view). Full on the frame it is fired,
 * a third on the next, gone after `life` — and always drawn at least one frame whatever the frame rate.
 */
import * as THREE from 'three';

const TMAX = 32;
const TSTRIDE = 14; // origin xyz, dir xyz, dist, travelled, length, width, r, g, b, speed
const MMAX = 16;
const MSTRIDE = 12; // pos xyz, dir xyz, age, life, size, rot, shown, len

const _dir = new THREE.Vector3(), _side = new THREE.Vector3(), _to = new THREE.Vector3();
const _h = new THREE.Vector3(), _t = new THREE.Vector3(), _c = new THREE.Vector3();
const _up = new THREE.Vector3(), _rt = new THREE.Vector3(), _f = new THREE.Vector3();

function quadIndex(n: number): number[] {
  const idx: number[] = [];
  for (let i = 0; i < n; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  return idx;
}

function additive(map: THREE.Texture, name: string): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    map, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: true,
  });
  m.name = name;
  return m;
}

/** The player's tracer profile (bright core, soft across, tapered tail, rounded head). */
function tracerTexture(): THREE.DataTexture {
  const W = 32, H = 16, px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / (W - 1), v = (y + 0.5) / H * 2 - 1;
    const across = Math.pow(Math.max(0, 1 - v * v), 2);
    const along = Math.pow(u, 1.6) * Math.min(1, (1 - u) / 0.06);
    const a = Math.round(255 * across * along);
    px.set([a, a, a, 255], (y * W + x) * 4);
  }
  const tex = new THREE.DataTexture(px, W, H, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Muzzle atlas 128 × 64: left square = the star core, right square = the flame tongue (u along the barrel). */
function muzzleTexture(): THREE.DataTexture {
  const W = 128, H = 64, px = new Uint8Array(W * H * 4);
  // star: hot disc + 5 uneven spikes + a soft halo
  const spikes = [0.0, 1.31, 2.42, 3.71, 5.02], lens = [1.0, 0.62, 0.86, 0.55, 0.78];
  for (let y = 0; y < H; y++) for (let x = 0; x < 64; x++) {
    const dx = (x + 0.5) / 32 - 1, dy = (y + 0.5) / 32 - 1;
    const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    let v = Math.exp(-r * r * 9) * 1.0 + Math.exp(-r * r * 2.5) * 0.3;
    for (let k = 0; k < spikes.length; k++) {
      let d = Math.abs(a - spikes[k]); d = Math.min(d, Math.PI * 2 - d);
      const w = 0.07 + 0.05 * (1 - r);
      if (r < lens[k]) v += Math.exp(-(d * d) / (w * w)) * Math.pow(1 - r / lens[k], 1.4) * 0.75;
    }
    v *= Math.max(0, 1 - r) ** 0.6;
    const c = Math.round(255 * Math.min(1, v));
    px.set([c, c, c, 255], (y * W + x) * 4);
  }
  // tongue: u 0 at the muzzle → 1 at the tip; three overlapping petals, a hot base
  for (let y = 0; y < H; y++) for (let x = 0; x < 64; x++) {
    const u = (x + 0.5) / 64, v = (y + 0.5) / 32 - 1;
    const width = 0.18 + 0.75 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - u * 0.55);
    const petal = 0.75 + 0.25 * Math.sin(u * 19.0) * Math.sin(u * 7.0 + 1.3);
    const across = Math.max(0, 1 - Math.pow(Math.abs(v) / Math.max(0.05, width * petal), 2));
    const along = Math.pow(1 - u, 1.3) * Math.min(1, u / 0.04 + 0.35);
    const core = Math.exp(-(v * v) / 0.02) * Math.pow(1 - u, 3);
    const c = Math.round(255 * Math.min(1, across * along * 0.85 + core * 0.9));
    px.set([c, c, c, 255], (y * W + 64 + x) * 4);
  }
  const tex = new THREE.DataTexture(px, W, H, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function quadMesh(n: number, mat: THREE.Material, name: string) {
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(n * 12), 3);
  const col = new THREE.BufferAttribute(new Float32Array(n * 12), 3);
  const uv = new THREE.BufferAttribute(new Float32Array(n * 8), 2);
  pos.setUsage(THREE.DynamicDrawUsage); col.setUsage(THREE.DynamicDrawUsage); uv.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pos); g.setAttribute('color', col); g.setAttribute('uv', uv);
  g.setIndex(quadIndex(n));
  g.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return { mesh, pos, col, uv };
}

export class EnemyTracers {
  /** Default speed, m/s (the player's is 190: a flash of light that still shows its direction). */
  speed = 170;
  readonly mesh: THREE.Mesh;
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  private readonly data = new Float32Array(TMAX * TSTRIDE);
  private readonly live = new Uint8Array(TMAX);
  private next = 0;
  private active = 0;

  constructor() {
    const q = quadMesh(TMAX, additive(tracerTexture(), 'fx:tracer5'), 'fx_enemy_tracers');
    this.mesh = q.mesh; this.pos = q.pos; this.col = q.col;
    const uv = q.uv.array as Float32Array;
    for (let i = 0; i < TMAX; i++) uv.set([0, 0, 0, 1, 1, 0, 1, 1], i * 8); // (along, across): tail-l, tail-r, head-l, head-r
    q.uv.needsUpdate = true;
    this.mesh.renderOrder = 9;
  }

  get count() { return this.active; }

  /** `r,g,b` are HDR (> 1 blooms). */
  spawn(from: THREE.Vector3, to: THREE.Vector3, r: number, g: number, b: number, speed: number) {
    _dir.copy(to).sub(from);
    const dist = _dir.length();
    if (dist < 1.0) return;
    _dir.multiplyScalar(1 / dist);
    const i = this.next;
    this.next = (this.next + 1) % TMAX;
    const d = this.data, o = i * TSTRIDE;
    d[o] = from.x; d[o + 1] = from.y; d[o + 2] = from.z;
    d[o + 3] = _dir.x; d[o + 4] = _dir.y; d[o + 5] = _dir.z;
    d[o + 6] = dist;
    d[o + 7] = 0.25 + Math.random() * 0.5; // just ahead of the flash
    d[o + 8] = Math.min(dist * 0.6, 4.5 + Math.random() * 2.0);
    d[o + 9] = 0.013;
    d[o + 10] = r; d[o + 11] = g; d[o + 12] = b;
    d[o + 13] = speed;
    if (!this.live[i]) { this.live[i] = 1; this.active++; }
  }

  update(dt: number, cam: THREE.Vector3) {
    if (this.active === 0) { if (this.mesh.visible) this.mesh.visible = false; return; }
    const d = this.data, P = this.pos.array as Float32Array, C = this.col.array as Float32Array;
    let n = 0;
    for (let i = 0; i < TMAX; i++) {
      if (!this.live[i]) continue;
      const o = i * TSTRIDE;
      const dist = d[o + 6], len = d[o + 8];
      _dir.set(d[o + 3], d[o + 4], d[o + 5]);
      // nearness: slow down near the eye (0.4 × at the eye, full speed from ~4 m)
      _h.set(d[o], d[o + 1], d[o + 2]).addScaledVector(_dir, Math.min(d[o + 7], dist));
      const dh = _h.distanceTo(cam);
      const near = Math.min(1, Math.max(0.4, 0.4 + dh / 6.5));
      d[o + 7] += d[o + 13] * near * dt;
      const head = Math.min(d[o + 7], dist), tail = Math.max(0, d[o + 7] - len);
      if (tail >= dist) { this.live[i] = 0; this.active--; continue; }
      _h.set(d[o], d[o + 1], d[o + 2]).addScaledVector(_dir, head);
      _t.set(d[o], d[o + 1], d[o + 2]).addScaledVector(_dir, tail);
      // the streak's closest point to the eye decides its apparent width
      _c.copy(cam).sub(_t);
      const s = Math.min(head - tail, Math.max(0, _c.dot(_dir)));
      _c.copy(_t).addScaledVector(_dir, s);
      const dc = Math.max(0.05, _c.distanceTo(cam));
      _to.copy(_h).add(_t).multiplyScalar(0.5).sub(cam);
      const w = Math.min(Math.max(d[o + 9], dc * 0.0018), dc * 0.016) * 0.5;
      _side.crossVectors(_dir, _to);
      if (_side.lengthSq() < 1e-10) _side.set(0, 1, 0).cross(_dir);
      _side.normalize().multiplyScalar(w);
      const p = n * 12;
      P[p] = _t.x - _side.x; P[p + 1] = _t.y - _side.y; P[p + 2] = _t.z - _side.z;
      P[p + 3] = _t.x + _side.x; P[p + 4] = _t.y + _side.y; P[p + 5] = _t.z + _side.z;
      P[p + 6] = _h.x - _side.x; P[p + 7] = _h.y - _side.y; P[p + 8] = _h.z - _side.z;
      P[p + 9] = _h.x + _side.x; P[p + 10] = _h.y + _side.y; P[p + 11] = _h.z + _side.z;
      // fade as the tail reaches the end; hotter (whiter) while it passes the eye
      const k = Math.min(1, (head - tail) / (len * 0.5));
      const hot = dc < 3 ? (3 - dc) / 3 : 0;
      const r = d[o + 10] * k * (1 + 0.3 * hot), g = d[o + 11] * k * (1 + 0.8 * hot), b = d[o + 12] * k * (1 + 1.4 * hot);
      for (let v = 0; v < 4; v++) { C[p + v * 3] = r; C[p + v * 3 + 1] = g; C[p + v * 3 + 2] = b; }
      n++;
    }
    this.pos.needsUpdate = true; this.col.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, n * 6);
    this.mesh.visible = n > 0;
  }

  /** Debug / checks: live tracers' heads. */
  heads(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < TMAX; i++) {
      if (!this.live[i]) continue;
      const o = i * TSTRIDE, d = this.data;
      out.push(new THREE.Vector3(d[o], d[o + 1], d[o + 2]).addScaledVector(new THREE.Vector3(d[o + 3], d[o + 4], d[o + 5]), Math.min(d[o + 7], d[o + 6])));
    }
    return out;
  }
}

export type MuzzleKind = 'carbine' | 'pistol';

export class MuzzleFlashes {
  readonly mesh: THREE.Mesh;
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  private readonly uv: THREE.BufferAttribute;
  private readonly data = new Float32Array(MMAX * MSTRIDE);
  private readonly live = new Uint8Array(MMAX);
  private next = 0;
  private active = 0;

  constructor() {
    const q = quadMesh(MMAX * 2, additive(muzzleTexture(), 'fx:muzzle5'), 'fx_muzzle_flashes');
    this.mesh = q.mesh; this.pos = q.pos; this.col = q.col; this.uv = q.uv;
    this.mesh.renderOrder = 10;
  }

  get count() { return this.active; }

  spawn(p: THREE.Vector3, dir: THREE.Vector3, kind: MuzzleKind, scale: number) {
    const i = this.next;
    this.next = (this.next + 1) % MMAX;
    const d = this.data, o = i * MSTRIDE;
    _f.copy(dir); if (_f.lengthSq() < 1e-8) _f.set(0, 0, -1); else _f.normalize();
    d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z;
    d[o + 3] = _f.x; d[o + 4] = _f.y; d[o + 5] = _f.z;
    d[o + 6] = 0;
    d[o + 7] = kind === 'pistol' ? 0.04 : 0.05;
    d[o + 8] = (kind === 'pistol' ? 0.13 : 0.17) * scale * (0.85 + Math.random() * 0.3);
    d[o + 9] = Math.random() * Math.PI * 2;
    d[o + 10] = 0;
    d[o + 11] = (kind === 'pistol' ? 0.22 : 0.34) * scale * (0.8 + Math.random() * 0.4);
    if (!this.live[i]) { this.live[i] = 1; this.active++; }
  }

  update(dt: number, cam: THREE.Camera, camPos: THREE.Vector3) {
    if (this.active === 0) { if (this.mesh.visible) this.mesh.visible = false; return; }
    const d = this.data, P = this.pos.array as Float32Array, C = this.col.array as Float32Array, U = this.uv.array as Float32Array;
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    _rt.set(1, 0, 0).applyQuaternion(cam.quaternion);
    let n = 0;
    for (let i = 0; i < MMAX; i++) {
      if (!this.live[i]) continue;
      const o = i * MSTRIDE;
      if (d[o + 10] > 0) d[o + 6] += dt; // age only once it has been drawn
      if (d[o + 6] >= d[o + 7]) { this.live[i] = 0; this.active--; continue; }
      d[o + 10] = 1;
      const t = d[o + 6] / d[o + 7];
      const k = t <= 0 ? 1 : 0.38 * (1 - t) * (1 - t);
      _h.set(d[o], d[o + 1], d[o + 2]);
      _dir.set(d[o + 3], d[o + 4], d[o + 5]);
      _to.copy(camPos).sub(_h);
      const dc = Math.max(0.1, _to.length());
      _to.multiplyScalar(1 / dc);
      const facing = Math.abs(_dir.dot(_to));
      // the core: bigger when the barrel points at the eye; never under ~3 px
      const size = Math.max(d[o + 8] * (0.55 + 0.9 * facing * facing), dc * 0.011);
      const cr = Math.cos(d[o + 9]) * size, sr = Math.sin(d[o + 9]) * size;
      // rotated billboard corners (−1,−1), (1,−1), (−1,1), (1,1) in (right, up)
      let p = n * 12;
      const corner = (k2: number, a: number, b: number) => {
        const x = a * cr - b * sr, y = a * sr + b * cr;
        P[p + k2 * 3] = _h.x + _rt.x * x + _up.x * y;
        P[p + k2 * 3 + 1] = _h.y + _rt.y * x + _up.y * y;
        P[p + k2 * 3 + 2] = _h.z + _rt.z * x + _up.z * y;
      };
      corner(0, -1, -1); corner(1, 1, -1); corner(2, -1, 1); corner(3, 1, 1);
      let u = n * 8;
      U.set([0, 0, 0.5, 0, 0, 1, 0.5, 1], u);
      const ic = 7.0 * k;
      for (let v = 0; v < 4; v++) { C[p + v * 3] = ic; C[p + v * 3 + 1] = ic * 0.62; C[p + v * 3 + 2] = ic * 0.28; }
      n++;
      // the tongue along the barrel, camera-facing around its axis (fades when seen end-on: the core covers that)
      p = n * 12;
      const len = d[o + 11] * (t <= 0 ? 1 : 0.8);
      _t.copy(_h).addScaledVector(_dir, len);
      _side.crossVectors(_dir, _to);
      if (_side.lengthSq() < 1e-8) _side.copy(_rt);
      _side.normalize().multiplyScalar(len * 0.32);
      P[p] = _h.x - _side.x; P[p + 1] = _h.y - _side.y; P[p + 2] = _h.z - _side.z;
      P[p + 3] = _h.x + _side.x; P[p + 4] = _h.y + _side.y; P[p + 5] = _h.z + _side.z;
      P[p + 6] = _t.x - _side.x; P[p + 7] = _t.y - _side.y; P[p + 8] = _t.z - _side.z;
      P[p + 9] = _t.x + _side.x; P[p + 10] = _t.y + _side.y; P[p + 11] = _t.z + _side.z;
      u = n * 8;
      const flip = (i & 1) === 0;
      U.set(flip ? [0.5, 0, 0.5, 1, 1, 0, 1, 1] : [0.5, 1, 0.5, 0, 1, 1, 1, 0], u);
      const it = 5.0 * k * (1 - facing * 0.8);
      for (let v = 0; v < 4; v++) { C[p + v * 3] = it; C[p + v * 3 + 1] = it * 0.55; C[p + v * 3 + 2] = it * 0.22; }
      n++;
    }
    this.pos.needsUpdate = true; this.col.needsUpdate = true; this.uv.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, n * 6);
    this.mesh.visible = n > 0;
  }
}
