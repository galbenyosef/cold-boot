/**
 * Animated set-pieces: articulated industrial robot arms and the overhead android conveyor.
 * (Turbine, breaker lever and elevator live with their rooms.)
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameContext } from '../core/types';
import type { Builder, Mat } from './builder';
import type { LevelBuild, MachineState } from './context';
import { hose, ibeam } from './kit';
import { androidArm, androidLeg, androidTorso } from './props';

const PI = Math.PI;
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export type ArmTool = 'welder' | 'gripper' | 'saw' | 'probe';
export interface ArmSpec { x: number; z: number; ry: number; tool: ArmTool; seed: number; color: Mat }

/** [yaw, shoulder, elbow, wrist] — working poses over the line, then wild ones used only in frenzy. */
const POSES: number[][] = [
  [0.0, 0.5, 1.25, 1.0], [0.42, 0.62, 1.1, 1.0], [-0.42, 0.62, 1.1, 1.0], [0.15, 0.86, 1.15, 0.65],
  [-0.2, 0.3, 1.5, 0.95], [0.0, -0.15, 1.85, 0.9], [0.3, 0.12, 0.95, 0.8], [-0.3, 0.7, 0.9, 1.2],
  // wild
  [1.7, 0.35, 0.6, -0.5], [-1.5, 0.95, 0.3, 0.2], [2.7, -0.4, 2.2, 1.2], [-2.4, 0.2, 1.0, -0.8], [0.9, 1.05, 0.2, 0.1], [0, -0.6, 0.4, 0.3],
];
const WORK_POSES = 8;

/**
 * Rigid skinning: every part is bound 100 % to one bone, and all parts sharing a material become ONE
 * SkinnedMesh — a whole articulated machine costs a draw call per material instead of per segment.
 * Bones must already be parented under `root` in their bind pose.
 */
export function skinParts(root: THREE.Object3D, bones: THREE.Bone[], parts: { b: Builder; bone: number }[], casts: (m: THREE.Material) => boolean,
  boundCenter: THREE.Vector3, boundRadius: number): THREE.SkinnedMesh[] {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const m = new THREE.Matrix4();
  for (const p of parts) {
    const g = p.b.build(false);
    m.multiplyMatrices(inv, bones[p.bone].matrixWorld);
    for (const mesh of g.children as THREE.Mesh[]) {
      const geo = mesh.geometry;
      geo.applyMatrix4(m);
      const n = geo.getAttribute('position').count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = p.bone; sw[i * 4] = 1; }
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      const mat = mesh.material as THREE.Material;
      let list = byMat.get(mat);
      if (!list) byMat.set(mat, (list = []));
      list.push(geo);
    }
  }
  const skeleton = new THREE.Skeleton(bones);
  const out: THREE.SkinnedMesh[] = [];
  for (const [mat, geos] of byMat) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)!;
    const mesh = new THREE.SkinnedMesh(merged, mat);
    mesh.name = `${root.name}:${mat.name}`;
    mesh.castShadow = casts(mat);
    mesh.receiveShadow = true;
    root.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(skeleton);
    mesh.boundingSphere = new THREE.Sphere(boundCenter.clone(), boundRadius);
    mesh.boundingBox = new THREE.Box3().setFromCenterAndSize(boundCenter, new THREE.Vector3(boundRadius * 2, boundRadius * 2, boundRadius * 2));
    out.push(mesh);
  }
  return out;
}

export class RobotArm {
  readonly root = new THREE.Group();
  private j1 = new THREE.Bone();
  private j2 = new THREE.Bone();
  private j3 = new THREE.Bone();
  private j4 = new THREE.Bone();
  private j5 = new THREE.Bone();
  private tip = new THREE.Object3D();
  private cur = new Float32Array(5);
  private from = new Float32Array(5);
  private to = new Float32Array(5);
  private frozen = new Float32Array(5);
  private t = 1;
  private dur = 1;
  private dwell = 0;
  private seed: number;
  private spin = 0;
  private sparkTimer = 0;
  private phase: number;
  readonly tool: ArmTool;

  constructor(L: LevelBuild, spec: ArmSpec) {
    this.seed = spec.seed * 2654435761 >>> 0;
    this.tool = spec.tool;
    this.phase = spec.seed * 1.7;
    const Y = spec.color, J: Mat = 'robot_joint', D: Mat = 'painted_dark';
    this.root.position.set(spec.x, 0.45, spec.z);
    this.root.rotation.y = spec.ry;
    this.root.name = 'robot_arm';
    this.root.add(this.j1);
    this.j2.position.set(0, 0.62, 0.1); this.j1.add(this.j2);
    this.j3.position.set(0, 1.4, 0); this.j2.add(this.j3);
    this.j4.position.set(0, 1.25, 0); this.j3.add(this.j4);
    this.j5.position.set(0, 0.3, 0); this.j4.add(this.j5);
    this.tip.position.set(0, 0.46, 0); this.j5.add(this.tip);

    const parts: { b: Builder; bone: number }[] = [];
    // turret
    let b = L.part('arm:turret');
    b.cyl(Y, 0, 0.14, 0, 0.44, 0.28, 'y', 18);
    b.box(Y, 0, 0.44, -0.08, 0.62, 0.36, 0.78);
    for (const s of [-1, 1]) { b.box(Y, s * 0.27, 0.62, 0.1, 0.08, 0.5, 0.5); b.cyl(Y, s * 0.27, 0.62, 0.1, 0.25, 0.08, 'x', 14); }
    b.cyl(D, 0.42, 0.62, 0.1, 0.17, 0.24, 'x', 12);
    b.cyl(D, -0.36, 0.62, 0.1, 0.1, 0.1, 'x', 10);
    b.box(D, 0, 0.5, -0.5, 0.4, 0.4, 0.12);
    b.box(D, 0, 0.3, 0.0, 0.66, 0.05, 0.84);
    for (let i = 0; i < 6; i++) b.box(D, -0.15 + i * 0.06, 0.5, -0.565, 0.03, 0.3, 0.02);
    hose(b, D, [[0.2, 0.3, -0.5], [0.45, 0.2, -0.3], [0.5, 0.05, 0.0]], 0.03, 5);
    parts.push({ b, bone: 0 });

    // upper arm
    b = L.part('arm:upper');
    b.box(Y, 0, 0.7, 0, 0.26, 1.2, 0.3);
    b.box(Y, 0, 0.7, 0.16, 0.14, 1.0, 0.06);
    b.cyl(Y, 0, 0, 0, 0.21, 0.44, 'x', 14);
    b.cyl(Y, 0, 1.4, 0, 0.18, 0.4, 'x', 14);
    b.cyl(J, 0, 0, 0, 0.12, 0.47, 'x', 12);
    b.cyl(J, 0, 1.4, 0, 0.1, 0.5, 'x', 12);
    b.cyl(J, 0, 0.55, -0.2, 0.045, 0.7, 'y', 8);
    b.cyl(J, 0, 1.0, -0.2, 0.028, 0.5, 'y', 8);
    b.box(J, 0, 0.2, -0.2, 0.1, 0.08, 0.1).box(J, 0, 1.26, -0.2, 0.08, 0.06, 0.1);
    hose(b, J, [[0.15, 0.1, -0.1], [0.17, 0.5, -0.12], [0.16, 1.0, -0.1], [0.15, 1.35, -0.02]], 0.022, 5);
    hose(b, J, [[-0.15, 0.1, -0.1], [-0.17, 0.6, -0.14], [-0.15, 1.3, -0.04]], 0.016, 5);
    parts.push({ b, bone: 1 });

    // forearm
    b = L.part('arm:fore');
    b.box(Y, 0, 0.62, 0, 0.2, 1.1, 0.22);
    b.box(Y, 0, 0.1, -0.22, 0.26, 0.4, 0.26);
    b.cyl(Y, 0, 1.25, 0, 0.13, 0.3, 'x', 12);
    b.cyl(J, 0, 1.25, 0, 0.075, 0.36, 'x', 10);
    b.cyl(J, 0, 0.1, -0.38, 0.1, 0.1, 'z', 10);
    b.box(J, 0.105, 0.65, 0, 0.012, 0.8, 0.12).box(J, -0.105, 0.65, 0, 0.012, 0.8, 0.12);
    hose(b, J, [[0.13, 0.05, -0.1], [0.14, 0.5, -0.06], [0.12, 1.15, 0]], 0.018, 5);
    parts.push({ b, bone: 2 });

    // wrist
    b = L.part('arm:wrist');
    b.box(Y, 0, 0.14, 0, 0.16, 0.26, 0.17);
    b.cyl(J, 0, 0.28, 0, 0.1, 0.05, 'y', 12);
    parts.push({ b, bone: 3 });

    // tool
    b = L.part('arm:tool');
    b.cyl(J, 0, 0.03, 0, 0.09, 0.06, 'y', 12);
    if (spec.tool === 'welder') {
      b.box(J, 0, 0.14, 0, 0.12, 0.18, 0.12);
      b.cyl(J, 0, 0.3, 0, 0.03, 0.2, 'y', 8, 0.018);
      b.cyl(J, 0, 0.42, 0, 0.018, 0.06, 'y', 6, 0.008);
      b.sphere('emissive_cyan', 0, 0.455, 0, 0.012, 6);
      hose(b, J, [[0.06, 0.1, 0], [0.12, 0.2, 0.04], [0.06, 0.3, 0.02]], 0.012, 4);
    } else if (spec.tool === 'gripper') {
      b.box(J, 0, 0.12, 0, 0.2, 0.12, 0.12);
      for (let i = 0; i < 3; i++) {
        const a = (i * 2 * PI) / 3;
        b.push(Math.cos(a) * 0.07, 0.18, Math.sin(a) * 0.07, -a + PI / 2, 0, 0);
        b.rbox(J, 0, 0.08, 0.02, 0.035, 0.18, 0.03, 0.35, 0, 0);
        b.rbox(J, 0, 0.22, 0.03, 0.03, 0.14, 0.025, -0.45, 0, 0);
        b.pop();
      }
    } else if (spec.tool === 'saw') {
      b.box(J, 0, 0.15, 0, 0.14, 0.22, 0.16);
      b.cyl(J, 0, 0.32, 0, 0.19, 0.012, 'x', 20);
      b.cyl(J, 0.03, 0.32, 0, 0.05, 0.05, 'x', 8);
      b.box(J, -0.02, 0.24, 0, 0.02, 0.2, 0.3);
    } else {
      b.box(J, 0, 0.14, 0, 0.16, 0.2, 0.14);
      b.cyl(J, 0, 0.3, 0, 0.06, 0.14, 'y', 10);
      b.cyl('emissive_red', 0, 0.375, 0, 0.03, 0.012, 'y', 10);
      for (let i = 0; i < 3; i++) { const a = (i * 2 * PI) / 3; b.rod(J, Math.cos(a) * 0.07, 0.2, Math.sin(a) * 0.07, Math.cos(a) * 0.05, 0.46, Math.sin(a) * 0.05, 0.006, 4); }
    }
    parts.push({ b, bone: 4 });

    // frozen mid-task pose
    const r = this.rand.bind(this);
    const pa = POSES[Math.floor(r() * WORK_POSES)], pb = POSES[Math.floor(r() * WORK_POSES)], k = 0.3 + r() * 0.5;
    for (let i = 0; i < 4; i++) this.frozen[i] = pa[i] + (pb[i] - pa[i]) * k;
    this.frozen[4] = r() * 6;
    this.cur.set(this.frozen); this.from.set(this.frozen); this.to.set(this.frozen);
    L.root.add(this.root);
    const paint = b.mat(Y);
    skinParts(this.root, [this.j1, this.j2, this.j3, this.j4, this.j5], parts, (m) => m === paint, new THREE.Vector3(0, 1.4, 0), 4.2);
    this.apply();
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private apply() {
    this.j1.rotation.y = this.cur[0];
    this.j2.rotation.x = this.cur[1];
    this.j3.rotation.x = this.cur[2];
    this.j4.rotation.x = this.cur[3];
    this.j5.rotation.y = this.cur[4];
  }

  update(dt: number, time: number, state: MachineState, ctx: GameContext) {
    if (state === 'off') return;
    const c = this.cur;
    if (state === 'idle') {
      // servo hunting around the frozen pose
      const f = this.frozen, p = this.phase;
      c[0] += (f[0] + Math.sin(time * 0.31 + p) * 0.06 - c[0]) * Math.min(1, dt * 1.5);
      c[1] += (f[1] + Math.sin(time * 0.23 + p * 2) * 0.04 - c[1]) * Math.min(1, dt * 1.5);
      c[2] += (f[2] + Math.sin(time * 0.27 + p * 3) * 0.05 - c[2]) * Math.min(1, dt * 1.5);
      c[3] += (f[3] + Math.sin(time * 0.4 + p) * 0.08 - c[3]) * Math.min(1, dt * 1.5);
      this.apply();
      return;
    }
    const frenzy = state === 'frenzy';
    if (this.t >= 1) {
      this.dwell -= dt;
      if (this.dwell <= 0) {
        const n = frenzy ? POSES.length : WORK_POSES;
        const pose = POSES[Math.floor(this.rand() * n)];
        for (let i = 0; i < 4; i++) { this.from[i] = c[i]; this.to[i] = pose[i] + (this.rand() - 0.5) * (frenzy ? 0.5 : 0.12); }
        this.t = 0;
        this.dur = frenzy ? 0.22 + this.rand() * 0.45 : 1.1 + this.rand() * 1.3;
        this.dwell = frenzy ? this.rand() * this.rand() * 0.5 : 0.6 + this.rand() * 1.6;
      }
    }
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const x = this.t, e = frenzy ? 1 - (1 - x) * (1 - x) * (1 - x) : x * x * (3 - 2 * x);
      for (let i = 0; i < 4; i++) c[i] = this.from[i] + (this.to[i] - this.from[i]) * e;
    }
    this.apply();
    if (frenzy) {
      // twitch: wrong, high-frequency, slightly out of phase per joint
      const p = this.phase;
      this.j1.rotation.y += Math.sin(time * 31 + p) * 0.025;
      this.j2.rotation.x += Math.sin(time * 43 + p * 2) * 0.03 * (Math.sin(time * 1.3 + p) > 0.2 ? 1 : 0);
      this.j3.rotation.x += Math.sin(time * 37 + p * 3) * 0.04;
      this.j4.rotation.x += Math.sin(time * 53 + p) * 0.09;
    }
    // tool
    const working = this.t >= 1;
    if (this.tool !== 'saw') {
      this.spin += dt * (this.tool === 'gripper' ? (frenzy ? 9 : 1.2) : frenzy ? 4 : 0.5);
      c[4] = this.spin;
      this.j5.rotation.y = this.spin;
    }
    if (this.tool === 'welder' || (frenzy && this.tool === 'saw')) {
      this.sparkTimer -= dt;
      if ((working || frenzy) && this.sparkTimer <= 0) {
        this.sparkTimer = frenzy ? 0.12 + this.rand() * 0.5 : 0.15 + this.rand() * 0.35;
        this.tip.getWorldPosition(_v);
        ctx.fx.sparks(_v, _up, frenzy ? 10 : 5, frenzy ? 5 : 3);
        if (this.rand() < 0.5) ctx.fx.flash(_v, 0x9fd8ff, frenzy ? 60 : 30, 0.07, 6);
      }
    }
  }
}

/** Static pedestal for an arm (goes into the room batch). */
export function armPedestal(b: Builder, x: number, z: number) {
  b.cyl('painted_dark', x, 0.2, z, 0.56, 0.4, 'y', 18);
  b.cyl('trim_steel', x, 0.425, z, 0.5, 0.05, 'y', 18);
  b.cyl('hazard_stripes', x, 0.03, z, 0.72, 0.06, 'y', 20);
  b.detail(() => { for (let i = 0; i < 8; i++) { const a = (i * PI) / 4; b.inst('bolt', x + Math.cos(a) * 0.64, 0.06, z + Math.sin(a) * 0.64, -PI / 2, 0, 0, 2.2); } });
  b.collide(x - 0.45, 0, z - 0.45, x + 0.45, 1.5, z + 0.45);
}

// ───────────────────────────────────────────────────────────── conveyor

/** Rounded-rectangle loop: straights at x = ±hw between z0 (north) and z1 (south), semicircle ends. */
export class LoopPath {
  readonly length: number;
  private straight: number;
  private arc: number;
  constructor(readonly hw: number, readonly zN: number, readonly zS: number) {
    this.straight = zN - zS;
    this.arc = PI * hw;
    this.length = 2 * this.straight + 2 * this.arc;
  }
  /** Position + tangent at arc-length s. Travel: east side southwards, round the south end, west side northwards. */
  at(s: number, out: { x: number; z: number; tx: number; tz: number }) {
    s = ((s % this.length) + this.length) % this.length;
    const { hw, straight, arc, zN, zS } = this;
    if (s < straight) { out.x = hw; out.z = zN - s; out.tx = 0; out.tz = -1; return out; }
    s -= straight;
    if (s < arc) { const a = s / hw; out.x = Math.cos(a) * hw; out.z = zS - Math.sin(a) * hw; out.tx = -Math.sin(a); out.tz = -Math.cos(a); return out; }
    s -= arc;
    if (s < straight) { out.x = -hw; out.z = zS + s; out.tx = 0; out.tz = 1; return out; }
    s -= straight;
    const a = s / hw; out.x = -Math.cos(a) * hw; out.z = zN + Math.sin(a) * hw; out.tx = Math.sin(a); out.tz = Math.cos(a);
    return out;
  }
}

export type HookLoad = 'husk' | 'empty' | 'torso' | 'torso_head' | 'torso_arm' | 'legs' | 'arms';

export class Conveyor {
  state: MachineState = 'off';
  private amp = 0;
  private hangers: { obj: THREE.Object3D; phase: number; still: boolean; rx: number; rz: number }[] = [];
  private sprockets: THREE.Object3D[] = [];
  private spin = 0;
  private lurch = 0;
  readonly hookPositions: { x: number; z: number; yaw: number; load: HookLoad }[] = [];

  constructor(L: LevelBuild, b: Builder, path: LoopPath, railY: number, loads: HookLoad[], offset: number) {
    const p = { x: 0, z: 0, tx: 0, tz: 0 };
    // rail: I-beam segments along the path
    const segs = 96;
    for (let i = 0; i < segs; i++) {
      const s0 = (i / segs) * path.length, s1 = ((i + 1) / segs) * path.length;
      path.at(s0, p); const x0 = p.x, z0 = p.z;
      path.at(s1, p); const x1 = p.x, z1 = p.z;
      const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0);
      b.push((x0 + x1) / 2, railY, (z0 + z1) / 2, ry);
      ibeam(b, 'painted_yellow', 'z', 0, 0, 0, len + 0.02, 0.14, 0.2, 0.02, 0.014);
      b.detail(() => b.box('robot_joint', 0, -0.13, 0, 0.03, 0.05, len + 0.02)); // chain
      b.pop();
    }
    const root = new THREE.Group();
    root.name = 'conveyor_hangers';
    const bones: THREE.Bone[] = [];
    const parts: { b: Builder; bone: number }[] = [];
    const spacing = path.length / loads.length;
    for (let k = 0; k < loads.length; k++) {
      path.at(offset + k * spacing, p);
      const yaw = Math.atan2(-p.tx, -p.tz); // facing along travel (yaw 0 = -Z)
      this.hookPositions.push({ x: p.x, z: p.z, yaw, load: loads[k] });
      const hb = L.part('hook');
      const F: Mat = 'robot_frame';
      // trolley + drop rod + yoke (origin at rail centre)
      hb.box(F, 0, -0.02, 0, 0.2, 0.1, 0.3);
      for (const s of [-1, 1]) for (const q of [-1, 1]) hb.cyl(F, s * 0.09, 0.02, q * 0.1, 0.045, 0.03, 'x', 8);
      hb.cyl(F, 0, -0.32, 0, 0.022, 0.5, 'y', 6);
      hb.box(F, 0, -0.58, 0, 0.5, 0.04, 0.05);
      for (const s of [-1, 1]) { hb.box(F, s * 0.24, -0.66, 0, 0.03, 0.16, 0.05); hb.box(F, s * 0.2, -0.74, 0.03, 0.1, 0.03, 0.1); }
      const load = loads[k];
      if (load === 'torso' || load === 'torso_head' || load === 'torso_arm') {
        hb.push(0, -1.56, 0.02); androidTorso(hb, load === 'torso_head', load === 'torso_arm' ? 1 : 0); hb.pop();
      } else if (load === 'legs') {
        hb.box(F, 0, -0.8, 0, 0.34, 0.06, 0.1);
        for (const s of [-1, 1]) { hb.push(s * 0.11, -0.86, 0, 0, 0, s * 0.05); androidLeg(hb); hb.pop(); }
      } else if (load === 'arms') {
        for (let i = 0; i < 3; i++) { hb.push(-0.2 + i * 0.2, -0.74, 0, i * 1.3, 0, (i - 1) * 0.12); androidArm(hb); hb.pop(); }
      }
      const bone = new THREE.Bone();
      bone.position.set(p.x, railY - 0.16, p.z);
      bone.rotation.order = 'YXZ';
      bone.rotation.y = yaw + PI; // model front (+Z) faces along travel
      root.add(bone);
      bones.push(bone);
      parts.push({ b: hb, bone: k });
      const rx = (k * 0.37 % 1 - 0.5) * 0.05, rz = (k * 0.61 % 1 - 0.5) * 0.07;
      this.hangers.push({ obj: bone, phase: k * 2.1, still: load === 'husk', rx, rz });
    }
    L.root.add(root);
    skinParts(root, bones, parts, () => true, new THREE.Vector3(0, railY - 1, (path.zN + path.zS) / 2), 12);
    for (const h of this.hangers) if (!h.still) { h.obj.rotation.x = h.rx; h.obj.rotation.z = h.rz; }
  }

  addSprocket(o: THREE.Object3D) { this.sprockets.push(o); }

  update(dt: number, time: number) {
    const target = this.state === 'off' ? 0 : this.state === 'idle' ? 0.012 : this.state === 'active' ? 0.05 : 0.15;
    if (this.amp === 0 && target === 0) return;
    this.amp += (target - this.amp) * Math.min(1, dt * 1.2);
    if (target === 0 && this.amp < 0.0005) this.amp = 0;
    const fast = this.state === 'frenzy' ? 2.2 : 1;
    if (this.state === 'active' || this.state === 'frenzy') {
      this.lurch -= dt;
      if (this.lurch <= 0) this.lurch = (this.state === 'frenzy' ? 0.5 : 2.5) + Math.sin(time * 7.3) * 0.3;
      this.spin += dt * (this.lurch > 0.35 ? 1.4 * fast : -3 * fast);
      for (let i = 0; i < this.sprockets.length; i++) this.sprockets[i].rotation.y = this.spin * (i % 2 ? -1 : 1);
    }
    for (let i = 0; i < this.hangers.length; i++) {
      const h = this.hangers[i];
      if (h.still) continue;
      h.obj.rotation.x = h.rx + Math.sin(time * 1.9 * fast + h.phase) * this.amp;
      h.obj.rotation.z = h.rz + Math.sin(time * 2.3 * fast + h.phase * 1.7) * this.amp * 1.4;
    }
  }
}
