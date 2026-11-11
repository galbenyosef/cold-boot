/**
 * Procedural gloved hands + sleeved forearms.
 *
 * Canonical RIGHT hand frame: origin = wrist pivot, +Y toward the fingers, +Z = back of the hand
 * (dorsal), -Z = palm, thumb on the -X side. The left hand is the same rig mirrored (scale.x = -1).
 * Fingers are a live joint hierarchy (one mesh per phalanx) so grips can be posed and blended.
 */
import * as THREE from 'three';
import { M, Parts, rbox, sweep, sphere, deform, type G, type Station } from '../geom';
import type { VmMats } from './mats';
import { rng } from '../math';

/** Finger: [splay, curl0, curl1, curl2] ×4 (index, middle, ring, pinky), thumb: [ry, rx, rz, curl1, curl2]. */
export type HandPose = number[];
export const POSE_LEN = 21;

export function pose(fingers: number[][], thumb: number[]): HandPose {
  const p: number[] = [];
  for (const f of fingers) p.push(f[0], f[1], f[2], f[3]);
  p.push(...thumb);
  return p;
}
const D = Math.PI / 180;
/** Helper: degrees → pose. */
export function poseDeg(fingers: number[][], thumb: number[]): HandPose {
  return pose(fingers.map((f) => f.map((v) => v * D)), thumb.map((v) => v * D));
}

export const POSES = {
  relaxed: poseDeg([[2, 18, 22, 12], [0, 22, 26, 14], [-2, 26, 30, 16], [-5, 30, 34, 18]], [0, 0, 0, 10, 10]),
  open: poseDeg([[4, 4, 4, 2], [0, 4, 4, 2], [-4, 4, 6, 2], [-8, 6, 6, 4]], [-10, 0, 10, 0, 0]),
  fist: poseDeg([[0, 85, 95, 50], [0, 88, 98, 50], [0, 90, 98, 50], [0, 92, 96, 50]], [30, 30, 10, 30, 40]),
};

interface FingerSpec { x: number; y: number; z: number; len: [number, number, number]; r: [number, number, number, number]; }
const FINGERS: FingerSpec[] = [
  { x: -0.0285, y: 0.093, z: -0.001, len: [0.044, 0.026, 0.023], r: [0.0098, 0.0090, 0.0084, 0.0076] },
  { x: -0.0095, y: 0.098, z: 0.0, len: [0.048, 0.030, 0.024], r: [0.0101, 0.0094, 0.0087, 0.0078] },
  { x: 0.0095, y: 0.095, z: -0.0005, len: [0.045, 0.028, 0.023], r: [0.0097, 0.0089, 0.0083, 0.0075] },
  { x: 0.0275, y: 0.086, z: -0.002, len: [0.035, 0.021, 0.020], r: [0.0086, 0.0079, 0.0073, 0.0066] },
];

/** Tapered phalanx along +Y from 0 (joint centre) to len, rounded both ends. `tip` makes a fingertip. */
function phalanx(len: number, r0: number, r1: number, tip: boolean, seed: number): G {
  const st: Station[] = [];
  const domeN = 4;
  for (let k = 0; k <= domeN; k++) {
    const a = (k / domeN) * (Math.PI / 2);
    const rr = r0 * Math.sin(a);
    st.push({ z: -r0 * 0.82 * Math.cos(a), w: rr * 1.06, h: rr * 0.94 });
  }
  const mid = 5;
  for (let k = 1; k < mid; k++) {
    const t = k / mid;
    const r = r0 + (r1 - r0) * t;
    const bulge = 1 + Math.sin(t * Math.PI) * 0.05;
    // pad on the palm side: station y maps to -z (palm is -z) after rotation, so +y = palm side
    st.push({ z: len * t, w: r * 1.06 * bulge, h: r * 0.95 * bulge, y: r * 0.06 * Math.sin(t * Math.PI) });
  }
  const tipLen = tip ? r1 * 1.45 : r1 * 0.85;
  for (let k = 0; k <= domeN + (tip ? 1 : 0); k++) {
    const n = domeN + (tip ? 1 : 0);
    const a = (k / n) * (Math.PI / 2);
    const rr = r1 * Math.cos(a);
    st.push({ z: len + tipLen * Math.sin(a), w: Math.max(rr * 1.06, 1e-4), h: Math.max(rr * (tip ? 0.86 : 0.94), 1e-4), y: tip ? r1 * 0.12 * Math.sin(a) : 0 });
  }
  const g = sweep(st, 14, false, false);
  g.rotateX(-Math.PI / 2); // +Z → +Y, station y → -Z (palm)
  // fabric wrinkles across the joints
  const rand = rng(seed);
  const ph = rand() * 6;
  deform(g, (v) => {
    const t = v.y / len;
    const wr = Math.sin(t * 26 + ph + v.x * 300) * 0.00018 * (v.z > 0 ? 1 : 0.4);
    const s = 1 + wr / Math.max(r0, 1e-3);
    v.x *= s; v.z *= s;
  });
  g.computeVertexNormals();
  return g;
}

export class Hand {
  readonly root = new THREE.Group();
  /** Joints [finger][segment]. */
  readonly joints: THREE.Object3D[][] = [];
  readonly thumb: THREE.Object3D[] = [];
  /** Child of the palm where held objects (mag, shell) attach. */
  readonly holdSocket = new THREE.Object3D();
  readonly current: HandPose = POSES.relaxed.slice();
  target: HandPose = POSES.relaxed.slice();
  /** Additional per-frame offsets (e.g. trigger squeeze), added after blending. */
  readonly offset: HandPose = new Array(POSE_LEN).fill(0);
  blendSpeed = 14;

  constructor(m: VmMats, readonly left: boolean) {
    const glove = m.glove, armor = m.gloveArmor;
    const palm = Object.assign(new Parts(), { uvScale: 3 });
    // Palm body: rounded-rect sections from wrist to knuckles.
    const st: Station[] = [
      { z: -0.004, w: 0.029, h: 0.0145, n: 2.6, y: 0.001 },
      { z: 0.004, w: 0.033, h: 0.0162, n: 2.8, y: 0.0 },
      { z: 0.025, w: 0.038, h: 0.0172, n: 3.0, y: -0.0005 },
      { z: 0.055, w: 0.0425, h: 0.0168, n: 3.2, y: -0.001 },
      { z: 0.080, w: 0.0445, h: 0.0150, n: 3.4, y: -0.0012 },
      { z: 0.094, w: 0.0432, h: 0.0128, n: 3.0, y: -0.0006 },
      { z: 0.101, w: 0.0385, h: 0.0098, n: 2.6, y: 0.0 },
      { z: 0.104, w: 0.030, h: 0.006, n: 2.2, y: 0.0 },
    ];
    const pg = sweep(st, 28, true, true);
    pg.rotateX(-Math.PI / 2);
    palm.add(pg, glove);
    // Thenar (thumb muscle) and hypothenar pads, palm side.
    palm.add(sphere(1, 16, 12), glove, M(-0.022, 0.034, -0.007, 0.2, 0, 0.5, 0.017, 0.032, 0.0125));
    palm.add(sphere(1, 14, 10), glove, M(0.026, 0.036, -0.006, 0, 0, -0.1, 0.0125, 0.034, 0.011));
    // Wrist knuckle: rounded closure so the hand can bend against the forearm's glove cuff.
    palm.add(sphere(1, 20, 14), glove, M(0, 0.002, 0.0005, 0, 0, 0, 0.0318, 0.024, 0.0198));
    // Knuckle armour: plate + 4 segmented bumps, back of hand.
    palm.add(rbox(0.074, 0.017, 0.007, 0.0028), armor, M(0, 0.088, 0.0172, -0.18, 0, 0));
    FINGERS.forEach((f, i) => {
      palm.add(rbox(0.0175, 0.016, 0.0075, 0.0034, 3), armor, M(f.x, f.y - 0.004, 0.0198, -0.25, 0, (i - 1.5) * -0.05));
    });
    // Back-of-hand padding with two stitched channels.
    palm.add(rbox(0.058, 0.044, 0.005, 0.0022), armor, M(0.002, 0.048, 0.0182, 0.05, 0, 0));
    palm.add(rbox(0.06, 0.0018, 0.004, 0.0008), glove, M(0.002, 0.04, 0.0206, 0.05, 0, 0));
    palm.add(rbox(0.06, 0.0018, 0.004, 0.0008), glove, M(0.002, 0.057, 0.0206, 0.05, 0, 0));
    // Palm reinforcement patch (slightly raised).
    palm.add(rbox(0.06, 0.05, 0.004, 0.0018), armor, M(0.006, 0.062, -0.0168, 0.05, 0, 0));
    palm.build(this.root);

    // Fingers
    FINGERS.forEach((f, fi) => {
      const chain: THREE.Object3D[] = [];
      let parent: THREE.Object3D = this.root;
      for (let s = 0; s < 3; s++) {
        const j = new THREE.Object3D();
        if (s === 0) j.position.set(f.x, f.y, f.z);
        else j.position.set(0, f.len[s - 1], 0);
        parent.add(j);
        const seg = phalanx(f.len[s], f.r[s], f.r[s + 1], s === 2, fi * 7 + s);
        const p = Object.assign(new Parts(), { uvScale: 3 }).add(seg, glove);
        if (s === 0) {
          // padded knuckle / proximal pad on the back of the finger
          p.add(rbox(0.012, f.len[0] * 0.5, 0.004, 0.0018), armor, M(0, f.len[0] * 0.5, f.r[0] * 0.9, 0, 0, 0));
        }
        if (s === 1) p.add(rbox(0.0105, f.len[1] * 0.45, 0.003, 0.0013), armor, M(0, f.len[1] * 0.5, f.r[1] * 0.92, 0, 0, 0));
        p.build(j);
        chain.push(j);
        parent = j;
      }
      this.joints.push(chain);
    });

    // Thumb: CMC near the wrist on the -X / palm side.
    const t0 = new THREE.Object3D();
    t0.position.set(-0.024, 0.016, -0.004);
    this.root.add(t0);
    const tLen = [0.046, 0.032, 0.029];
    const tR = [0.0128, 0.0112, 0.0102, 0.0090];
    let parent: THREE.Object3D = t0;
    for (let s = 0; s < 3; s++) {
      const j = s === 0 ? t0 : new THREE.Object3D();
      if (s > 0) { j.position.set(0, tLen[s - 1], 0); parent.add(j); }
      const p = Object.assign(new Parts(), { uvScale: 3 }).add(phalanx(tLen[s], tR[s], tR[s + 1], s === 2, 40 + s), glove);
      if (s === 1) p.add(rbox(0.012, 0.018, 0.004, 0.0018), armor, M(0, 0.016, 0.0105, 0, 0, 0));
      p.build(j);
      this.thumb.push(j);
      parent = j;
    }

    this.holdSocket.position.set(0, 0.06, -0.035);
    this.root.add(this.holdSocket);
    if (left) this.root.scale.x = -1;
    this.apply();
  }

  setPose(p: HandPose, instant = false) {
    this.target = p;
    if (instant) for (let i = 0; i < POSE_LEN; i++) this.current[i] = p[i];
  }

  update(dt: number) {
    const k = 1 - Math.exp(-this.blendSpeed * dt);
    for (let i = 0; i < POSE_LEN; i++) this.current[i] += (this.target[i] - this.current[i]) * k;
    this.apply();
  }

  apply() {
    const c = this.current, o = this.offset;
    for (let f = 0; f < 4; f++) {
      const b = f * 4;
      const ch = this.joints[f];
      ch[0].rotation.set(-(c[b + 1] + o[b + 1]), 0, c[b] + o[b], 'ZXY');
      ch[1].rotation.set(-(c[b + 2] + o[b + 2]), 0, 0);
      ch[2].rotation.set(-(c[b + 3] + o[b + 3]), 0, 0);
    }
    // Thumb rest orientation: points up/out toward -X, slightly palmward.
    const t = 16;
    this.thumb[0].rotation.set(-0.35 - (c[t + 1] + o[t + 1]), -0.25 + c[t] + o[t], 0.72 + c[t + 2] + o[t + 2], 'YZX');
    this.thumb[1].rotation.set(-(c[t + 3] + o[t + 3]), 0, 0);
    this.thumb[2].rotation.set(-(c[t + 4] + o[t + 4]), 0, 0);
  }
}

/**
 * Sleeved forearm. Origin at the wrist, geometry runs along -Y toward the elbow.
 * Oriented every frame so it points from the wrist to an elbow target.
 */
export class Forearm {
  readonly root = new THREE.Group();
  /** LED bar (drawRange driven) — only on the device arm. */
  ledMesh: THREE.Mesh | null = null;
  ledSegVerts = 0;
  private ledCount = 6;
  private readonly bx = new THREE.Vector3();
  private readonly by = new THREE.Vector3();
  private readonly bz = new THREE.Vector3();
  private readonly mtx = new THREE.Matrix4();

  constructor(m: VmMats, withDevice: boolean, deviceAngle = 0) {
    const p = Object.assign(new Parts(), { uvScale: 3 });
    const L = 0.46;
    const st: Station[] = [];
    const rand = rng(withDevice ? 11 : 23);
    const N = 16;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const w = 0.0385 + t * 0.021 + (t < 0.12 ? 0.004 * (1 - t / 0.12) : 0);
      const h = 0.0335 + t * 0.018 + (t < 0.12 ? 0.004 * (1 - t / 0.12) : 0);
      st.push({ z: -0.072 - t * L, w, h, n: 2.15 });
    }
    st.reverse();
    const sl = sweep(st, 30, false, false);
    sl.rotateX(-Math.PI / 2); // along -Y now; station y → -z
    // Fabric folds: low-frequency bunching near the wrist + ridges.
    const ph = rand() * 10;
    deform(sl, (v) => {
      const a = Math.atan2(v.z, v.x);
      const d = -v.y;
      const fold = Math.sin(d * 55 + Math.sin(a * 3 + ph) * 1.6) * Math.exp(-d * 7) * 0.0022
        + Math.sin(a * 5 + d * 18 + ph) * 0.0008 + Math.sin(a * 2 - d * 9) * 0.0012;
      const r = Math.hypot(v.x, v.z);
      const s = (r + fold) / Math.max(r, 1e-4);
      v.x *= s; v.z *= s;
    });
    sl.computeVertexNormals();
    p.add(sl, m.sleeve);
    // Glove gauntlet over the wrist (bends with the forearm), velcro strap + tab
    const gl = sweep([
      { z: -0.085, w: 0.0372, h: 0.031, n: 2.2 }, { z: -0.078, w: 0.0392, h: 0.0328, n: 2.2 },
      { z: -0.05, w: 0.0362, h: 0.0298, n: 2.3 }, { z: -0.02, w: 0.0335, h: 0.026, n: 2.4 },
      { z: 0.0, w: 0.0318, h: 0.0232, n: 2.5 }, { z: 0.006, w: 0.026, h: 0.018, n: 2.4 }, { z: 0.009, w: 0.012, h: 0.009, n: 2.2 },
    ], 26, false, false);
    gl.rotateX(-Math.PI / 2);
    p.add(gl, m.glove);
    const strap = sweep([
      { z: -0.044, w: 0.0382, h: 0.0318, n: 2.3 }, { z: -0.042, w: 0.0392, h: 0.0328, n: 2.3 },
      { z: -0.022, w: 0.0362, h: 0.0292, n: 2.4 }, { z: -0.02, w: 0.0352, h: 0.0282, n: 2.4 },
    ], 26, false, false);
    strap.rotateX(-Math.PI / 2);
    p.add(strap, m.gloveArmor);
    p.add(rbox(0.03, 0.021, 0.006, 0.0025), m.gloveArmor, M(0.004, -0.032, 0.0318, 0, 0, 0));

    // Sleeve hem: rolled cuff band
    const hem = sweep([
      { z: -0.08, w: 0.0438, h: 0.0388, n: 2.15 }, { z: -0.076, w: 0.0452, h: 0.0402, n: 2.15 },
      { z: -0.066, w: 0.0446, h: 0.0396, n: 2.15 }, { z: -0.061, w: 0.0418, h: 0.0368, n: 2.15 },
    ], 30, false, false);
    hem.rotateX(-Math.PI / 2);
    p.add(hem, m.sleeve);
    p.build(this.root);

    if (withDevice) {
      // Wrist unit: rugged housing on two rubber straps, angled screen + LED bar + buttons.
      const dev = new THREE.Group();
      dev.rotation.y = deviceAngle;
      this.root.add(dev);
      const d = Object.assign(new Parts(), { uvScale: 3 });
      const yC = -0.13;
      for (const y of [yC + 0.022, yC - 0.022]) {
        const s = sweep([
          { z: y - 0.008, w: 0.0458, h: 0.0405, n: 2.2 }, { z: y - 0.007, w: 0.0468, h: 0.0415, n: 2.2 },
          { z: y + 0.007, w: 0.0468, h: 0.0415, n: 2.2 }, { z: y + 0.008, w: 0.0458, h: 0.0405, n: 2.2 },
        ], 30, false, false);
        s.rotateX(-Math.PI / 2); // station z → y
        d.add(s, m.rubber);
      }
      const zTop = 0.046;
      d.add(rbox(0.05, 0.064, 0.016, 0.004, 3), m.polymer, M(0, yC, zTop));
      d.add(rbox(0.054, 0.012, 0.012, 0.003), m.gloveArmor, M(0, yC + 0.034, zTop - 0.002));
      d.add(rbox(0.054, 0.012, 0.012, 0.003), m.gloveArmor, M(0, yC - 0.034, zTop - 0.002));
      // bezel + screen
      d.add(rbox(0.038, 0.034, 0.003, 0.0012), m.gunmetal, M(0, yC + 0.006, zTop + 0.0085));
      d.add(rbox(0.033, 0.029, 0.0012), m.interior, M(0, yC + 0.006, zTop + 0.0103));
      // side buttons and screws
      for (const s of [-1, 1]) {
        d.add(rbox(0.004, 0.009, 0.006, 0.0015), m.steel, M(s * 0.026, yC + 0.012, zTop + 0.002));
        for (const yy of [yC + 0.025, yC - 0.025]) d.add(sphere(0.0016, 8, 6), m.steel, M(s * 0.021, yy, zTop + 0.0085, 0, 0, 0, 1, 1, 0.5));
      }
      d.add(rbox(0.012, 0.005, 0.003, 0.0012), m.rubber, M(-0.009, yC - 0.02, zTop + 0.0085));
      d.add(rbox(0.012, 0.005, 0.003, 0.0012), m.rubber, M(0.009, yC - 0.02, zTop + 0.0085));
      // small amber status pip
      d.add(sphere(0.0013, 8, 6), m.emAmber, M(0.016, yC + 0.02, zTop + 0.0105));
      d.build(dev);
      // LED segments (health bar) — drawRange controls how many are lit.
      const segs: G[] = [];
      for (let i = 0; i < this.ledCount; i++) {
        const g = new THREE.BoxGeometry(0.0038, 0.0145, 0.0006).toNonIndexed();
        g.translate(-0.0125 + i * 0.005, yC + 0.009, zTop + 0.0112);
        segs.push(g);
      }
      const led = Object.assign(new Parts(), { uvScale: 3 });
      segs.forEach((g) => led.add(g, m.wristLed));
      led.build(dev);
      this.ledMesh = dev.children[dev.children.length - 1] as THREE.Mesh;
      this.ledSegVerts = 36;
      // tiny readout line under the bar
      const line = Object.assign(new Parts(), { uvScale: 3 }).add(new THREE.BoxGeometry(0.026, 0.0016, 0.0006), m.emCyan, M(0, yC - 0.006, zTop + 0.0112));
      line.build(dev);
    }
  }

  /** Lit LED count = ceil(fraction * segments). */
  setLevel(frac: number) {
    if (!this.ledMesh) return;
    const n = Math.max(0, Math.min(this.ledCount, Math.ceil(frac * this.ledCount - 1e-3)));
    this.ledMesh.geometry.setDrawRange(0, n * this.ledSegVerts);
  }

  /**
   * Place at `wrist` (parent space) pointing toward `elbow`, twisted so the forearm's +Z follows `dorsal`.
   */
  orient(wrist: THREE.Vector3, elbow: THREE.Vector3, dorsal: THREE.Vector3) {
    this.by.copy(wrist).sub(elbow).normalize();
    this.bz.copy(dorsal).addScaledVector(this.by, -dorsal.dot(this.by)).normalize();
    this.bx.crossVectors(this.by, this.bz);
    this.mtx.makeBasis(this.bx, this.by, this.bz);
    this.root.quaternion.setFromRotationMatrix(this.mtx);
    this.root.position.copy(wrist);
  }
}
