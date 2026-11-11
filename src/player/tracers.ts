/**
 * Bullet tracers: pooled camera-facing streaks on the world layer (HDR additive, a few frames long) that run
 * from the muzzle to the hit point. One dynamic mesh for the whole pool; nothing is allocated per shot.
 */
import * as THREE from 'three';

const MAX = 32;


const _dir = new THREE.Vector3(), _side = new THREE.Vector3(), _to = new THREE.Vector3();
const _h = new THREE.Vector3(), _t = new THREE.Vector3();

export class Tracers {
  /** m/s — fast enough to read as a flash of light, slow enough to see the direction (debug hook can slow it). */
  speed = 190;
  readonly mesh: THREE.Mesh;
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  // per tracer: origin xyz, dir xyz, dist, travelled, length, width, r, g, b
  private readonly data = new Float32Array(MAX * 13);
  private readonly live = new Uint8Array(MAX);
  private next = 0;
  private active = 0;

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(MAX * 12), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(MAX * 12), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(MAX * 8), idx: number[] = [];
    for (let i = 0; i < MAX; i++) {
      uv.set([0, 0, 0, 1, 1, 0, 1, 1], i * 8); // (along, across): tail-left, tail-right, head-left, head-right
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    g.setAttribute('position', this.pos);
    g.setAttribute('color', this.col);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    // soft profile: bright core, falloff across the width, tapered toward the tail and rounded at the head
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
    const mat = new THREE.MeshBasicMaterial({
      map: tex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
    g.setDrawRange(0, 0);
    scene.add(this.mesh);
  }

  /** Streak from `from` to `to`. `r,g,b` are HDR (values above 1 bloom). */
  spawn(from: THREE.Vector3, to: THREE.Vector3, width: number, r: number, g: number, b: number) {
    _dir.copy(to).sub(from);
    const dist = _dir.length();
    if (dist < 1.2) return;
    _dir.multiplyScalar(1 / dist);
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const d = this.data, o = i * 13;
    d[o] = from.x; d[o + 1] = from.y; d[o + 2] = from.z;
    d[o + 3] = _dir.x; d[o + 4] = _dir.y; d[o + 5] = _dir.z;
    d[o + 6] = dist;
    d[o + 7] = 0.5 + Math.random() * 1.2; // start a little ahead of the muzzle
    d[o + 8] = Math.min(dist * 0.6, 5.5 + Math.random() * 2.5);
    d[o + 9] = width;
    d[o + 10] = r; d[o + 11] = g; d[o + 12] = b;
    if (!this.live[i]) { this.live[i] = 1; this.active++; }
  }

  update(dt: number, cam: THREE.Vector3) {
    if (this.active === 0) { if (this.mesh.visible) this.mesh.visible = false; return; }
    const d = this.data, P = this.pos.array as Float32Array, C = this.col.array as Float32Array;
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      if (!this.live[i]) continue;
      const o = i * 13;
      const dist = d[o + 6], len = d[o + 8];
      d[o + 7] += this.speed * dt;
      const head = Math.min(d[o + 7], dist), tail = Math.max(0, d[o + 7] - len);
      if (tail >= dist) { this.live[i] = 0; this.active--; continue; }
      _dir.set(d[o + 3], d[o + 4], d[o + 5]);
      _h.set(d[o], d[o + 1], d[o + 2]).addScaledVector(_dir, head);
      _t.set(d[o], d[o + 1], d[o + 2]).addScaledVector(_dir, tail);
      _to.copy(_h).add(_t).multiplyScalar(0.5).sub(cam);
      // keep a minimum apparent width in the distance so the streak never aliases away
      const w = Math.max(d[o + 9], _to.length() * 0.0016) * 0.5;
      _side.crossVectors(_dir, _to).normalize().multiplyScalar(w);
      const p = n * 12;
      P[p] = _t.x - _side.x; P[p + 1] = _t.y - _side.y; P[p + 2] = _t.z - _side.z;
      P[p + 3] = _t.x + _side.x; P[p + 4] = _t.y + _side.y; P[p + 5] = _t.z + _side.z;
      P[p + 6] = _h.x - _side.x; P[p + 7] = _h.y - _side.y; P[p + 8] = _h.z - _side.z;
      P[p + 9] = _h.x + _side.x; P[p + 10] = _h.y + _side.y; P[p + 11] = _h.z + _side.z;
      // fade out as the tail catches up with the impact
      const k = Math.min(1, (head - tail) / (len * 0.5));
      const r = d[o + 10] * k, g = d[o + 11] * k, b = d[o + 12] * k;
      for (let v = 0; v < 4; v++) { C[p + v * 3] = r; C[p + v * 3 + 1] = g; C[p + v * 3 + 2] = b; }
      n++;
    }
    this.pos.needsUpdate = true; this.col.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, n * 6);
    this.mesh.visible = n > 0;
  }
}
