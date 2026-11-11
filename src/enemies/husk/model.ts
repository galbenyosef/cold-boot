/**
 * HUSK — Halcyon "HD-7" humanoid service android. Cracked white composite shell plates over a dark
 * endoskeleton. Built once; every instance shares geometry + materials (rigid skinning, ~9 draw calls).
 *
 * Model space: feet on y = 0, facing +Z, the android's LEFT is +X. Bind pose: standing straight, arms down.
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { buildRigLods, glowMaterial, tintOf, type RigBuilder, type RigTemplate } from '../shared/rig';
import { bcyl, bolt, box, cyl, hlathe, keyLerp, patch, plate, rod, rng, shell, sphere, spow, torus, tube, wedge, xf, type V3 } from '../shared/prims';

export const HUSK_DIM = {
  hipsY: 0.98,
  hipX: 0.095, hipY: 0.93,
  thigh: 0.43, shin: 0.415, ankle: 0.085,
  shoulderX: 0.215, shoulderY: 1.455, shoulderZ: -0.015,
  uarm: 0.29, larm: 0.27,
  headY: 1.6,
};

export interface PistonDef { cyl: string; rod: string; a: THREE.Vector3; b: THREE.Vector3; }

export interface HuskTemplate {
  rig: RigTemplate;
  pistons: PistonDef[];
  /** Alternative sign materials (unit numbers) — instance picks one for the 'sign' mesh. */
  signs: THREE.Material[];
  /** Shell plates that can break off: bone name → parent region. */
  plates: { bone: string; region: string }[];
}

const D = Math.PI / 180;

function vnoise(x: number, y: number): number {
  const h = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x), yi = Math.floor(y), xf_ = x - xi, yf = y - yi;
  const u = xf_ * xf_ * (3 - 2 * xf_), v = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}

/** Mask helper: jagged bite taken out of a plate around (cu, cv). */
function chip(u: number, v: number, cu: number, cv: number, r: number, seed = 0, aspect = 1): boolean {
  const du = (u - cu) * aspect, dv = v - cv;
  const d = Math.hypot(du, dv);
  const n = vnoise(u * 9 + seed * 7.3, v * 9 + seed * 3.1) * 0.9 + vnoise(u * 23 + seed, v * 23) * 0.35;
  return d < r * (0.45 + n);
}

/** Thin jagged crack line from (u0,v0) to (u1,v1). */
function crack(u: number, v: number, u0: number, v0: number, u1: number, v1: number, w: number, seed = 0): boolean {
  const dx = u1 - u0, dy = v1 - v0;
  const l2 = dx * dx + dy * dy;
  let t = ((u - u0) * dx + (v - v0) * dy) / l2;
  if (t < 0 || t > 1) return false;
  const off = (vnoise(t * 7 + seed * 5.1, seed) - 0.5) * 0.09;
  const px = u0 + dx * t - dy * off / Math.sqrt(l2) * 1, py = v0 + dy * t + dx * off / Math.sqrt(l2) * 1;
  return Math.hypot(u - px, v - py) < w * (1 - t * 0.6);
}

export function buildHuskTemplate(ctx: GameContext): HuskTemplate {
  const M = ctx.materials;
  const signs = ['HD7-0417', 'HD7-0388', 'HD7-0452', 'HD7-0291'].map((t) => M.sign(t, 'stencil', 3));
  const mats: Record<string, THREE.Material> = {
    glow: glowMaterial(),
    shell: huskShell(ctx), frame: M.get('robot_frame'), joint: M.get('robot_joint'), rubber: M.get('rubber'),
    chrome: M.get('chrome'), steel: M.get('steel_raw'), painted: M.get('painted_orange'), glass: M.get('screen_off'),
    red: M.get('emissive_red'), cyan: M.get('emissive_cyan'), sign: signs[0],
  };
  const { template, data } = buildRigLods(authorHusk, mats, {
    radius: 1.5, center: new THREE.Vector3(0, 0.95, 0),
    fold: { red: 'glow', cyan: 'glow', chrome: 'steel' }, tint: { red: tintOf(0xff0702, 2.2), cyan: tintOf(0x10c8ff, 2.5) },
    lod: { k: 0.55, minFeature: 0.012, remap: { chrome: 'joint', steel: 'joint', glass: 'frame', rubber: 'frame', sign: 'shell' } },
    proxy: { k: 0.25, minFeature: 0.03, exclude: ['glass', 'red', 'cyan', 'sign', 'chrome', 'rubber'] },
    colorize: { shell: shellGrime },
  });
  return { rig: template, pistons: data.pistons, signs, plates: data.plates };
}

function authorHusk(b: RigBuilder): { pistons: PistonDef[]; plates: { bone: string; region: string }[] } {
  const R = rng(417);
  const pistons: PistonDef[] = [];
  const plates: { bone: string; region: string }[] = [];
  const K = HUSK_DIM;

  // ── skeleton ───────────────────────────────────────────────────────────
  b.bone('hips', null, 0, K.hipsY, 0);
  b.bone('spine1', 'hips', 0, 1.07, -0.01);
  b.bone('spine2', 'spine1', 0, 1.22, -0.012);
  b.bone('neck', 'spine2', 0, 1.515, -0.02);
  b.bone('head', 'neck', 0, K.headY, -0.008);
  for (const [sfx, s] of [['l', 1], ['r', -1]] as const) {
    b.bone('clav_' + sfx, 'spine2', 0.07 * s, 1.47, -0.015);
    b.bone('uarm_' + sfx, 'clav_' + sfx, K.shoulderX * s, K.shoulderY, K.shoulderZ);
    b.bone('larm_' + sfx, 'uarm_' + sfx, K.shoulderX * s, K.shoulderY - K.uarm, K.shoulderZ);
    b.bone('hand_' + sfx, 'larm_' + sfx, K.shoulderX * s, K.shoulderY - K.uarm - K.larm, K.shoulderZ);
    b.bone('thigh_' + sfx, 'hips', K.hipX * s, K.hipY, 0);
    b.bone('shin_' + sfx, 'thigh_' + sfx, K.hipX * s, K.hipY - K.thigh, 0);
    b.bone('foot_' + sfx, 'shin_' + sfx, K.hipX * s, K.ankle, 0);
    // breakable shell plates
    b.bone('p_shoulder_' + sfx, 'uarm_' + sfx, (K.shoulderX + 0.03) * s, K.shoulderY + 0.02, K.shoulderZ);
    b.bone('p_thigh_' + sfx, 'thigh_' + sfx, K.hipX * s, 0.72, 0.03);
    b.bone('p_shin_' + sfx, 'shin_' + sfx, K.hipX * s, 0.3, 0.03);
    b.bone('p_chest_' + sfx, 'spine2', 0.08 * s, 1.38, 0.09);
    // pistons
    b.bone('kcyl_' + sfx, 'thigh_' + sfx, K.hipX * s, 0.70, -0.058);
    b.bone('krod_' + sfx, 'shin_' + sfx, K.hipX * s, 0.41, -0.052);
    b.bone('ecyl_' + sfx, 'uarm_' + sfx, K.shoulderX * s, 1.36, -0.058);
    b.bone('erod_' + sfx, 'larm_' + sfx, K.shoulderX * s, 1.10, -0.05);
    b.bone('scyl_' + sfx, 'hips', 0.075 * s, 1.0, -0.06);
    b.bone('srod_' + sfx, 'spine2', 0.085 * s, 1.26, -0.075);
    pistons.push({ cyl: 'kcyl_' + sfx, rod: 'krod_' + sfx, a: new THREE.Vector3(K.hipX * s, 0.70, -0.058), b: new THREE.Vector3(K.hipX * s, 0.41, -0.052) });
    pistons.push({ cyl: 'ecyl_' + sfx, rod: 'erod_' + sfx, a: new THREE.Vector3(K.shoulderX * s, 1.36, -0.058), b: new THREE.Vector3(K.shoulderX * s, 1.10, -0.05) });
    pistons.push({ cyl: 'scyl_' + sfx, rod: 'srod_' + sfx, a: new THREE.Vector3(0.075 * s, 1.0, -0.06), b: new THREE.Vector3(0.085 * s, 1.26, -0.075) });
  }
  b.bone('p_larm_l', 'larm_l', K.shoulderX, 1.03, 0.0);
  b.bone('p_back', 'spine2', 0, 1.38, -0.12);
  b.bone('p_abdomen', 'spine1', 0, 1.14, 0.08);
  b.bone('p_pelvis', 'hips', 0, 0.97, 0.09);
  b.bone('p_face', 'head', 0, 1.69, 0.08);
  b.bone('p_cranium', 'head', 0, 1.76, -0.03);
  b.bone('eye', 'head', 0.035, 1.712, 0.07); // scaled to 0 while dormant (sensor glow)
  b.bone('led', 'spine2', 0, 1.36, 0.1);      // status LEDs glow
  // left hand fingers
  b.bone('fing_l', 'hand_l', K.shoulderX, 0.79, 0.0);
  b.bone('fing2_l', 'fing_l', K.shoulderX, 0.75, 0.0);
  b.bone('thumb_l', 'hand_l', K.shoulderX - 0.03, 0.85, 0.02);
  // right hand tools (two of the three are scaled to 0 per instance)
  b.bone('tool_clamp', 'hand_r', -K.shoulderX, 0.86, K.shoulderZ);
  b.bone('jaw_a', 'tool_clamp', -K.shoulderX - 0.028, 0.80, K.shoulderZ);
  b.bone('jaw_b', 'tool_clamp', -K.shoulderX + 0.028, 0.80, K.shoulderZ);
  b.bone('tool_saw', 'hand_r', -K.shoulderX, 0.86, K.shoulderZ);
  b.bone('blade', 'tool_saw', -K.shoulderX, 0.745, K.shoulderZ + 0.01);
  b.bone('tool_inj', 'hand_r', -K.shoulderX, 0.86, K.shoulderZ);
  b.bone('needle', 'tool_inj', -K.shoulderX, 0.76, K.shoulderZ);

  for (const n of ['p_shoulder_l', 'p_shoulder_r', 'p_thigh_l', 'p_thigh_r', 'p_shin_l', 'p_shin_r', 'p_chest_l', 'p_chest_r',
    'p_larm_l', 'p_back', 'p_abdomen', 'p_pelvis', 'p_face', 'p_cranium', 'uarm_l', 'uarm_r', 'larm_l', 'larm_r', 'hand_l', 'head',
    'shin_l', 'shin_r', 'foot_l', 'foot_r']) b.debrisBones.add(n);
  plates.push(
    { bone: 'p_chest_l', region: 'torso' }, { bone: 'p_chest_r', region: 'torso' }, { bone: 'p_back', region: 'torso' },
    { bone: 'p_abdomen', region: 'torso' }, { bone: 'p_pelvis', region: 'torso' },
    { bone: 'p_shoulder_l', region: 'arm_l' }, { bone: 'p_shoulder_r', region: 'arm_r' }, { bone: 'p_larm_l', region: 'arm_l' },
    { bone: 'p_thigh_l', region: 'leg_l' }, { bone: 'p_thigh_r', region: 'leg_r' }, { bone: 'p_shin_l', region: 'leg_l' }, { bone: 'p_shin_r', region: 'leg_r' },
    { bone: 'p_face', region: 'head' }, { bone: 'p_cranium', region: 'head' },
  );

  /** Point + outward yaw on a superelliptic tube surface (same parametrisation as shell()). */
  const onTube = (rx: [number, number][], rz: [number, number][], cz: [number, number][] | undefined, y0: number, y1: number, n: number) =>
    (aDeg: number, v: number, lift = 0, rxDeg = 0, rzDeg = 0, quadLike = false): THREE.Matrix4 => {
      const e = 2 / n, a = aDeg * D;
      const f = (aa: number): [number, number] => [keyLerp(rx, v) * spow(Math.sin(aa), e), (cz ? keyLerp(cz, v) : 0) + keyLerp(rz, v) * spow(Math.cos(aa), e)];
      const [x, z] = f(a), [x1, z1] = f(a + 0.01), [x0, z0] = f(a - 0.01);
      const tx = x1 - x0, tz = z1 - z0, nl = Math.hypot(tx, tz) || 1;
      const nx = -tz / nl, nz = tx / nl;
      return xf(x + nx * lift, y0 + (y1 - y0) * v, z + nz * lift, (quadLike ? 0 : 90 * D) + rxDeg * D, Math.atan2(nx, nz), rzDeg * D);
    };

  /** addL shorthand */
  const L = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => b.addL(geo, xf(x, y, z, rx, ry, rz, sx, sy, sz));
  const bolts = (pts: V3[], nrm: 'x' | 'y' | 'z' | '-z' | '-x', r = 0.005) => {
    for (const p of pts) {
      const rot: V3 = nrm === 'x' ? [0, 0, -90 * D] : nrm === '-x' ? [0, 0, 90 * D] : nrm === 'z' ? [90 * D, 0, 0] : nrm === '-z' ? [-90 * D, 0, 0] : [0, 0, 0];
      L(bolt(r, r * 0.7), p[0], p[1], p[2], rot[0], rot[1], rot[2]);
    }
  };
  const piston = (cylBone: string, rodBone: string, a: V3, bb: V3, r: number) => {
    // geometry authored in the current frame along a → b
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...bb);
    const dir = B.clone().sub(A);
    const mid = A.clone().addScaledVector(dir, 0.58);
    const near = B.clone().addScaledVector(dir, -0.92);
    b.bind(cylBone).mat('frame'); L(rod(a, mid.toArray() as V3, r, 10));
    b.mat('joint'); L(rod(A.clone().addScaledVector(dir, 0.52).toArray() as V3, A.clone().addScaledVector(dir, 0.6).toArray() as V3, r * 1.25, 10));
    L(sphere(r * 1.35, 8, 6), a[0], a[1], a[2]);
    b.bind(rodBone).mat('chrome'); L(rod(bb, near.toArray() as V3, r * 0.5, 8));
    b.mat('joint'); L(sphere(r * 1.2, 8, 6), bb[0], bb[1], bb[2]);
  };

  // ── HIPS ───────────────────────────────────────────────────────────────
  b.use('hips').mat('frame');
  L(box(0.19, 0.085, 0.115, 0.012), 0, -0.005, -0.005);
  L(wedge(0.08, 0.07, 0.17, 0.11, 0.075), 0, -0.085, -0.005);                 // crotch keel
  L(box(0.07, 0.05, 0.03, 0.008), 0, 0.03, -0.068);                            // sacrum block
  L(box(0.235, 0.02, 0.03, 0.006), 0, 0.045, 0.0);                             // top cross-member
  for (const s of [-1, 1]) {
    b.mat('joint');
    L(bcyl(0.052, 0.062, 0.006, 16), 0.105 * s, -0.05, 0, 0, 0, 90 * D);       // hip rotary actuator housing
    L(bcyl(0.034, 0.03, 0.005, 12), 0.142 * s, -0.05, 0, 0, 0, 90 * D);
    b.mat('frame');
    L(torus(0.045, 0.006, 6, 16), 0.136 * s, -0.05, 0, 0, 90 * D, 0);
    bolts([0, 1, 2, 3, 4, 5].map((i) => [0.137 * s, -0.05 + Math.cos(i * 60 * D) * 0.022, Math.sin(i * 60 * D) * 0.022] as V3), s > 0 ? 'x' : '-x', 0.0045);
    L(box(0.03, 0.035, 0.04, 0.006), 0.075 * s, 0.02, -0.06);                  // spine piston mount
  }
  // lower-back shell (stays with hips), cracked pelvis front plate (breakable)
  b.mat('shell');
  L(shell({ y0: -0.07, y1: 0.075, rx: [[0, 0.125], [1, 0.135]], rz: [[0, 0.092], [1, 0.1]], cz: [[0, -0.008], [1, -0.008]], a0: 118 * D, a1: 242 * D, nu: 14, nv: 5, n: 3,
    mask: (u, v) => !(Math.abs(u - 0.5) < 0.13 && v > 0.3) }));
  b.bind('p_pelvis');
  L(shell({ y0: -0.125, y1: 0.07, rx: [[0, 0.07], [0.45, 0.118], [1, 0.128]], rz: [[0, 0.07], [0.45, 0.094], [1, 0.1]], cz: [[0, -0.005], [1, -0.005]], a0: -66 * D, a1: 66 * D, nu: 20, nv: 11, n: 2.8,
    mask: (u, v) => v > Math.abs(u - 0.5) * 2.1 - 0.3 && !chip(u, v, 0.86, 0.8, 0.16, 3) && !crack(u, v, 0.8, 0.62, 0.56, 0.3, 0.03, 2)
      && !(v > 0.78 && v < 0.83 && Math.abs(u - 0.5) < 0.2) }));
  b.bind('hips').mat('frame');
  L(box(0.26, 0.022, 0.05, 0.006), 0, 0.066, 0.0);                              // belt rail
  b.mat('joint');
  for (const s of [-1, 1]) L(bcyl(0.014, 0.012, 0.003, 10), 0.05 * s, 0.03, 0.098, 90 * D);
  b.mat('cyan'); b.bind('led'); L(box(0.012, 0.004, 0.004), 0.0, 0.066, 0.027);

  // ── SPINE1 (waist): exposed spine, cable bundle, actuators ─────────────
  b.use('spine1');
  for (let i = 0; i < 5; i++) {
    const y = -0.07 + i * 0.045;
    b.mat('joint'); L(bcyl(0.03, 0.022, 0.005, 12), 0, y, -0.04);
    b.mat('frame'); L(box(0.022, 0.014, 0.03, 0.004), 0, y, -0.072);            // spinous process
    L(box(0.075, 0.012, 0.016, 0.004), 0, y, -0.04);                            // transverse process
  }
  b.mat('rubber'); L(cyl(0.018, 0.018, 0.24, 10), 0, 0.02, -0.04);
  b.mat('frame');
  L(shell({ y0: 0.0, y1: 0.15, rx: [[0, 0.075], [1, 0.088]], rz: [[0, 0.055], [1, 0.062]], cz: [[0, 0.005], [1, 0.005]], a0: 0, a1: 360 * D, nu: 12, nv: 3, thickness: 0.004, n: 2.4 })); // waist gimbal sleeve
  b.mat('joint');
  L(torus(0.086, 0.008, 6, 20), 0, 0.0, 0.004, 90 * D, 0, 0, 1, 0.74, 1);
  L(torus(0.094, 0.007, 6, 20), 0, 0.15, 0.004, 90 * D, 0, 0, 1, 0.72, 1);
  // cable bundle across the belly (flexes between hips and chest)
  b.mat('rubber');
  for (let i = 0; i < 7; i++) {
    const a = (-52 + i * 17.5 + (R() - 0.5) * 6) * D;
    const r0 = 0.07, r1 = 0.082, bulge = 0.012 + R() * 0.012;
    const p = (rr: number, y: number): V3 => [Math.sin(a) * rr, y, Math.cos(a) * rr * 0.72 + 0.004];
    b.cable(tube([p(r0, 1.0), p(r0 + bulge, 1.06), p(r1 + bulge, 1.14), p(r1, 1.21), p(r1 - 0.01, 1.25)], 0.0065 + R() * 0.0035, 6, 10),
      'hips', 'spine2', new THREE.Vector3(0, 1.03, 0), new THREE.Vector3(0, 1.21, 0));
  }
  b.use('hips');
  for (const s of [-1, 1]) piston('scyl_' + (s > 0 ? 'l' : 'r'), 'srod_' + (s > 0 ? 'l' : 'r'), [0.075 * s, 0.02, -0.06], [0.085 * s, 0.28, -0.075], 0.012);
  b.use('spine1').bind('p_abdomen').mat('shell');
  L(shell({ y0: 0.0, y1: 0.145, rx: [[0, 0.112], [1, 0.128]], rz: [[0, 0.088], [1, 0.1]], cz: [[0, 0.0], [1, 0.0]], a0: -46 * D, a1: 46 * D, nu: 14, nv: 6, n: 3,
    mask: (u, v) => !chip(u, v, 0.1, 0.2, 0.3, 5) && !chip(u, v, 0.95, 1.0, 0.16, 9) }));

  // ── SPINE2 (chest) ─────────────────────────────────────────────────────
  b.use('spine2').mat('frame');
  const chestRx: [number, number][] = [[0, 0.118], [0.45, 0.165], [0.8, 0.172], [1, 0.14]];
  const chestRz: [number, number][] = [[0, 0.08], [0.45, 0.108], [0.8, 0.105], [1, 0.08]];
  const chestCz: [number, number][] = [[0, 0.004], [0.5, 0.012], [1, -0.004]];
  const inset = (k: [number, number][], d: number) => k.map(([t, v]) => [t, v - d] as [number, number]);
  // inner dark pressure hull
  L(shell({ y0: 0.0, y1: 0.285, rx: inset(chestRx, 0.016), rz: inset(chestRz, 0.016), cz: chestCz, a0: 0, a1: 360 * D, nu: 19, nv: 5, thickness: 0.004, n: 2.8 }));
  L(box(0.2, 0.012, 0.13, 0.005), 0, 0.285, -0.002);                            // shoulder deck
  L(box(0.14, 0.02, 0.1, 0.006), 0, 0.0, 0.002);
  // ribs visible in the side gaps
  b.mat('joint');
  for (let i = 0; i < 4; i++) {
    const v = 0.2 + i * 0.2;
    L(torus(1, 0.007, 4, 20), 0, v * 0.285, keyLerp(chestCz, v), 90 * D, 0, 0, keyLerp(chestRx, v) - 0.008, keyLerp(chestRz, v) - 0.008, 1);
  }
  // spine continues up the back in the channel
  for (let i = 0; i < 6; i++) {
    const y = 0.03 + i * 0.043;
    b.mat('joint'); L(bcyl(0.024, 0.02, 0.004, 10), 0, y, -0.094);
    b.mat('frame'); L(box(0.02, 0.014, 0.026, 0.004), 0, y, -0.116);
  }
  b.mat('rubber'); L(cyl(0.014, 0.014, 0.27, 8), 0, 0.14, -0.096);
  // sternum panel between the pectoral plates, with status LEDs
  b.mat('frame');
  L(box(0.036, 0.17, 0.014, 0.004), 0, 0.165, 0.112, -4 * D);
  for (let i = 0; i < 5; i++) L(box(0.026, 0.004, 0.006), 0, 0.1 + i * 0.012, 0.1185, -4 * D); // vent louvres
  b.bind('led').mat('cyan');
  for (let i = 0; i < 3; i++) L(box(0.006, 0.006, 0.004), -0.009 + i * 0.009, 0.215, 0.1165, -4 * D);
  b.mat('red'); L(box(0.006, 0.006, 0.004), 0, 0.2, 0.1175, -4 * D);
  b.bind('spine2');
  // shoulder yokes
  for (const s of [-1, 1]) {
    b.mat('frame');
    L(bcyl(0.036, 0.075, 0.006, 12), 0.165 * s, 0.25, -0.004, 0, 0, 90 * D);
    L(box(0.05, 0.03, 0.07, 0.008), 0.13 * s, 0.27, -0.004);
    b.mat('joint'); L(torus(0.037, 0.006, 6, 14), 0.2 * s, 0.25, -0.004, 0, 90 * D, 0);
  }
  // collar
  b.mat('joint'); L(torus(0.05, 0.011, 6, 18), 0, 0.292, -0.008, 90 * D);
  b.mat('frame'); L(bcyl(0.046, 0.02, 0.005, 14), 0, 0.296, -0.008);
  // pectoral shell plates (breakable), left cracked + unit number
  const chestAt = onTube(chestRx, chestRz, chestCz, 0.0, 0.285, 2.9);
  for (const s of [1, -1]) {
    const sfx = s > 0 ? 'l' : 'r';
    b.use('spine2', s).bind('p_chest_' + sfx).mat('shell');
    L(shell({ y0: 0.0, y1: 0.285, rx: chestRx, rz: chestRz, cz: chestCz, a0: 5 * D, a1: 100 * D, nu: 20, nv: 16, n: 2.9, thickness: 0.009,
      trim0: [[0, 10 * D], [0.3, 1 * D], [0.75, 0], [1, 7 * D]], trim1: [[0, -22 * D], [0.35, -3 * D], [1, -8 * D]],
      mask: s > 0
        ? (u, v) => v > 0.1 + (1 - u) * 0.06 && !chip(u, v, 0.02, 0.1, 0.16, 11) && !crack(u, v, 0.06, 0.18, 0.5, 0.5, 0.028, 4) && !crack(u, v, 0.34, 0.38, 0.7, 0.26, 0.02, 6)
        : (u, v) => v > 0.1 + (1 - u) * 0.06 && !chip(u, v, 1.0, 0.4, 0.17, 21) && !(v > 0.6 && v < 0.64 && u > 0.25 && u < 0.7) && !(v > 0.69 && v < 0.73 && u > 0.25 && u < 0.7) }));
    b.mat('joint');
    for (const [a, v] of [[12, 0.93], [84, 0.9], [14, 0.24], [50, 0.93]] as const) b.addL(bolt(0.005, 0.004), chestAt(a, v, 0.008));
  }
  b.use('spine2').bind('p_chest_l').mat('sign');
  b.addL(quad(0.07, 0.0233), chestAt(30, 0.72, 0.0105, 0, 0, true), true);
  // back plate with spine channel
  b.use('spine2').bind('p_back').mat('shell');
  L(shell({ y0: 0.02, y1: 0.292, rx: chestRx, rz: chestRz, cz: chestCz, a0: 106 * D, a1: 254 * D, nu: 23, nv: 11, n: 2.9, thickness: 0.009,
    mask: (u, v) => !(Math.abs(u - 0.5) < 0.085 && v < 0.86) && !chip(u, v, 0.18, 0.0, 0.2, 31) && !(v > 0.5 && v < 0.56 && Math.abs(Math.abs(u - 0.5) - 0.27) < 0.1) && !(v > 0.62 && v < 0.68 && Math.abs(Math.abs(u - 0.5) - 0.27) < 0.1) }));
  b.bind('spine2').mat('rubber');
  // hoses from the back into the neck
  for (const s of [-1, 1]) {
    b.cable(tube([[0.03 * s, 1.44, -0.11], [0.04 * s, 1.5, -0.105], [0.035 * s, 1.56, -0.075], [0.03 * s, 1.62, -0.06]], 0.008, 6, 10), 'spine2', 'head', new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 1.61, 0));
    b.cable(tube([[0.05 * s, 1.5, 0.03], [0.045 * s, 1.545, 0.035], [0.04 * s, 1.585, 0.03], [0.038 * s, 1.62, 0.02]], 0.0055, 5, 8), 'spine2', 'head', new THREE.Vector3(0, 1.51, 0), new THREE.Vector3(0, 1.61, 0));
  }

  // ── NECK ───────────────────────────────────────────────────────────────
  b.use('neck').mat('joint');
  L(cyl(0.021, 0.026, 0.1, 12), 0, 0.045, 0.0);
  for (let i = 0; i < 4; i++) L(torus(0.027, 0.005, 5, 14), 0, 0.012 + i * 0.022, 0, 90 * D);
  b.mat('chrome');
  for (const s of [-1, 1]) { L(rod([0.034 * s, -0.005, -0.012], [0.03 * s, 0.09, -0.004], 0.0045, 6)); }
  b.mat('frame');
  for (const s of [-1, 1]) { L(rod([0.034 * s, -0.01, -0.012], [0.032 * s, 0.04, -0.008], 0.008, 8)); }

  // ── HEAD ───────────────────────────────────────────────────────────────
  // Egg-shaped cranium tilted slightly forward; face is a blank smooth plate with a single cracked visor slot.
  b.use('head');
  const hRx: [number, number][] = [[0, 0.03], [0.1, 0.052], [0.3, 0.071], [0.55, 0.082], [0.78, 0.076], [0.93, 0.05], [1, 0.006]];
  const hRz: [number, number][] = [[0, 0.036], [0.1, 0.064], [0.3, 0.086], [0.55, 0.099], [0.78, 0.093], [0.93, 0.062], [1, 0.006]];
  const hCz: [number, number][] = [[0, 0.03], [0.3, 0.012], [0.6, 0.0], [1, -0.012]];
  const HY0 = -0.025, HY1 = 0.218;
  const headShell = (a0: number, a1: number, nu: number, nv: number, v0: number, v1: number, d: number, th: number, mask?: (u: number, v: number) => boolean) =>
    patch((u, v, out) => {
      const vv = v0 + (v1 - v0) * v, a = a0 + (a1 - a0) * u;
      const e = 2 / 2.3;
      out.set((keyLerp(hRx, vv) - d) * spow(Math.sin(a), e), HY0 + (HY1 - HY0) * vv, keyLerp(hCz, vv) + (keyLerp(hRz, vv) - d) * spow(Math.cos(a), e));
    }, { nu, nv, thickness: th, mask });
  // dark skull core
  b.mat('frame');
  L(headShell(0, 360 * D, 18, 9, 0.02, 1, 0.012, 0.004));
  L(box(0.07, 0.03, 0.05, 0.008), 0, -0.012, 0.012);                             // jaw block
  // visor glass band (dead-black) behind the face plate
  const headPt = (aDeg: number, vv: number, d: number): V3 => {
    const a = aDeg * D, e = 2 / 2.3;
    return [(keyLerp(hRx, vv) - d) * spow(Math.sin(a), e), HY0 + (HY1 - HY0) * vv, keyLerp(hCz, vv) + (keyLerp(hRz, vv) - d) * spow(Math.cos(a), e)];
  };
  const SLOT0 = 0.505, SLOT1 = 0.625, SV = 0.565;          // visor slot (fraction of head height)
  b.mat('glass');
  L(headShell(-66 * D, 66 * D, 18, 4, SLOT0 - 0.03, SLOT1 + 0.03, 0.0065, 0.003));
  // sensor cluster behind the broken end of the visor: lens barrels + glow (bone 'eye', scaled 0 when off)
  const lens = (aDeg: number, vv: number, d: number, r: number, len: number, mat: string, bone: string, squash = 1) => {
    const p = headPt(aDeg, vv, d);
    b.bind(bone).mat(mat);
    if (len > 0) L(bcyl(r, len, r * 0.18, 12), p[0], p[1], p[2], 90 * D, aDeg * D * 0.9, 0);
    else L(sphere(r, 10, 6), p[0], p[1], p[2], 0, aDeg * D * 0.9, 0, 1, 1, squash);
  };
  lens(30, SV, 0.024, 0.0165, 0.03, 'joint', 'head');
  lens(30, SV, 0.011, 0.0125, 0.006, 'frame', 'head');
  lens(30, SV, 0.0085, 0.0098, 0, 'red', 'eye', 0.45);
  lens(52, SV + 0.03, 0.02, 0.0085, 0.02, 'joint', 'head');
  lens(52, SV + 0.03, 0.011, 0.0048, 0, 'cyan', 'eye', 0.5);
  lens(50, SV - 0.045, 0.02, 0.007, 0.02, 'joint', 'head');
  lens(50, SV - 0.045, 0.012, 0.0038, 0, 'cyan', 'eye', 0.5);
  // faint second sensor glowing through the intact end of the glass
  lens(-27, SV, 0.0052, 0.0045, 0, 'red', 'eye', 0.3);
  b.bind('head');
  // face plate: breakable. Visor slot; the glass is smashed at its left end, cracks run over brow and cheek.
  b.bind('p_face').mat('shell');
  const FV = 0.86; // face plate covers 0..FV of the head height
  L(headShell(-80 * D, 80 * D, 38, 32, 0.0, FV, 0, 0.007, (u, v) => {
    const vv = v * FV;
    if (vv > SLOT0 && vv < SLOT1 && u > 0.17 && u < 0.83) return false;
    if (chip(u, v, 0.7, SV / FV, 0.105, 13, 1.5)) return false;
    if (crack(u, v, 0.74, 0.7, 0.9, 1.0, 0.024, 8)) return false;
    if (crack(u, v, 0.7, 0.6, 0.6, 0.2, 0.02, 12)) return false;
    if (crack(u, v, 0.63, 0.38, 0.84, 0.28, 0.016, 15)) return false;
    return true;
  }));
  // cranium: breakable; chunk missing at the back-right
  b.bind('p_cranium');
  L(headShell(80 * D, 280 * D, 26, 20, 0.12, 1.0, 0, 0.007, (u, v) => !chip(u, v, 0.72, 0.5, 0.2, 17, 1.4) && !crack(u, v, 0.66, 0.6, 0.35, 0.95, 0.02, 19)));
  L(headShell(-80 * D, 80 * D, 16, 4, 0.86, 1.0, 0, 0.007));
  b.bind('head');
  // ear hubs + chin sensor + rear vent
  for (const s of [-1, 1]) {
    b.mat('joint'); L(bcyl(0.024, 0.012, 0.003, 14), 0.083 * s, 0.11, -0.004, 0, 0, 90 * D);
    b.mat('frame'); L(bcyl(0.013, 0.02, 0.003, 10), 0.086 * s, 0.11, -0.004, 0, 0, 90 * D);
  }
  b.mat('frame');
  L(rod([-0.088, 0.115, -0.006], [-0.094, 0.2, -0.03], 0.0028, 5));               // bent antenna stub
  L(box(0.024, 0.012, 0.012, 0.003), 0, -0.018, 0.058);
  for (let i = 0; i < 4; i++) L(box(0.04, 0.005, 0.008), 0, 0.045 + i * 0.012, -0.085, 14 * D);
  b.mat('sign');
  b.addL(quad(0.05, 0.0167), xf(0, 0.085, -0.1055, 0, 180 * D, 0), true);

  // ── ARMS ───────────────────────────────────────────────────────────────
  for (const s of [1, -1]) {
    const sfx = s > 0 ? 'l' : 'r';
    // upper arm
    b.use('uarm_' + sfx, s).mat('joint');
    L(sphere(0.043, 14, 10));
    L(bcyl(0.03, 0.05, 0.005, 12), 0, -K.uarm, 0, 0, 0, 90 * D);                   // elbow hinge
    b.mat('frame');
    L(wedge(0.04, 0.04, 0.05, 0.05, 0.2), 0, -0.135, 0);
    L(box(0.058, 0.05, 0.05, 0.008), 0, -K.uarm + 0.025, 0);
    L(box(0.012, 0.06, 0.07, 0.004), 0.034, -K.uarm + 0.01, 0);                    // hinge cheeks
    L(box(0.012, 0.06, 0.07, 0.004), -0.034, -K.uarm + 0.01, 0);
    bolts([[0.04, -K.uarm, 0], [0.04, -K.uarm + 0.03, 0.02], [0.04, -K.uarm + 0.03, -0.02]], 'x', 0.005);
    b.mat('shell');
    L(shell({ y0: -0.245, y1: -0.07, rx: [[0, 0.037], [0.5, 0.048], [1, 0.05]], rz: [[0, 0.04], [0.5, 0.052], [1, 0.052]], a0: -35 * D, a1: 215 * D, nu: 16, nv: 8, n: 2.6,
      trim0: [[0, 30 * D], [0.5, 0], [1, 0]], trim1: [[0, -30 * D], [0.5, 0], [1, 0]],
      mask: s > 0 ? (u, v) => !(v > 0.42 && v < 0.5 && u > 0.3 && u < 0.7) : (u, v) => !chip(u, v, 0.35, 0.05, 0.3, 41) && !crack(u, v, 0.4, 0.3, 0.6, 0.95, 0.03, 42) }));
    // pauldron: a domed cap hugging the shoulder ball
    b.bind('p_shoulder_' + sfx);
    L(patch((u, v, out) => {
      const a = (-112 + 224 * u) * D, e = (4 + 100 * v) * D;
      const r = 0.006 + Math.sin(e) * 0.068;
      out.set(-0.004 + r * Math.cos(a) * 0.98, 0.004 + Math.cos(e) * 0.07 - v * v * 0.022, r * Math.sin(a) * 1.08);
    }, { nu: 17, nv: 10, thickness: 0.008, mask: s > 0 ? (u, v) => !chip(u, v, 0.92, 0.95, 0.15, 43) : (u, v) => !crack(u, v, 0.25, 1.0, 0.55, 0.35, 0.035, 44) && !chip(u, v, 0.1, 1.0, 0.18, 45) }));
    b.bind('uarm_' + sfx);
    piston('ecyl_' + sfx, 'erod_' + sfx, [0, -0.095, -0.043], [0, -K.uarm - 0.065, -0.035], 0.0095);
    // forearm
    b.use('larm_' + sfx, s).mat('frame');
    L(rod([0.016, -0.02, 0.006], [0.014, -K.larm + 0.02, 0.004], 0.011, 8));
    L(rod([-0.016, -0.02, -0.004], [-0.014, -K.larm + 0.02, 0.0], 0.009, 8));
    L(box(0.05, 0.035, 0.045, 0.007), 0, -0.02, 0);
    L(box(0.03, 0.03, 0.03, 0.006), 0, -0.065, -0.035);                            // piston clevis
    L(bcyl(0.03, 0.035, 0.005, 12), 0, -K.larm + 0.012, 0);                        // wrist collar
    b.mat('joint');
    L(bcyl(0.024, 0.062, 0.004, 12), 0, 0, 0, 0, 0, 90 * D);
    L(torus(0.031, 0.005, 5, 14), 0, -K.larm + 0.03, 0, 90 * D);
    b.mat('rubber');
    L(tube([[0.0, -0.03, 0.022], [0.004, -0.1, 0.03], [-0.002, -0.19, 0.026], [0, -K.larm + 0.03, 0.018]], 0.0055, 5, 10));
    L(tube([[-0.01, -0.03, -0.02], [-0.02, -0.12, -0.022], [-0.008, -0.2, -0.02], [-0.006, -K.larm + 0.03, -0.016]], 0.0045, 5, 10));
    if (s > 0) {
      b.bind('p_larm_l').mat('shell');
      L(shell({ y0: -K.larm + 0.035, y1: -0.045, rx: [[0, 0.034], [0.6, 0.044], [1, 0.04]], rz: [[0, 0.036], [0.6, 0.046], [1, 0.042]], a0: -30 * D, a1: 215 * D, nu: 14, nv: 6, n: 2.6,
        mask: (u, v) => !chip(u, v, 0.55, 0.0, 0.2, 51) && !crack(u, v, 0.5, 0.2, 0.3, 0.8, 0.03, 52) }));
    }
    // elbow cable (flexes)
    b.use('uarm_' + sfx, s).mat('rubber');
    {
      const o = new THREE.Vector3(K.shoulderX * s, K.shoulderY, K.shoulderZ);
      const P = (x: number, y: number, z: number): V3 => [o.x + x * s, o.y + y, o.z + z];
      b.cable(tube([P(0.012, -0.2, 0.03), P(0.014, -0.26, 0.042), P(0.012, -0.32, 0.04), P(0.008, -0.37, 0.028)], 0.006, 5, 10),
        'uarm_' + sfx, 'larm_' + sfx, new THREE.Vector3(0, o.y - 0.25, 0), new THREE.Vector3(0, o.y - 0.33, 0));
      // shoulder cable from chest
      b.cable(tube([P(-0.07, 0.035, -0.045), P(-0.035, 0.06, -0.06), P(0.0, 0.03, -0.062), P(0.006, -0.05, -0.05)], 0.0065, 5, 10),
        'spine2', 'uarm_' + sfx, new THREE.Vector3(o.x - 0.06 * s, 0, 0), new THREE.Vector3(o.x, 0, 0));
    }
  }
  // left hand: palm + fingers
  b.use('hand_l').mat('frame');
  L(box(0.07, 0.075, 0.028, 0.008), 0, -0.05, 0);
  L(bcyl(0.02, 0.03, 0.004, 10), 0, -0.006, 0);
  b.mat('shell'); L(box(0.06, 0.055, 0.008, 0.003), 0, -0.05, -0.017);
  b.mat('joint'); L(rod([-0.034, -0.092, 0], [0.034, -0.092, 0], 0.008, 8));
  for (let i = 0; i < 3; i++) {
    const x = -0.024 + i * 0.024;
    b.bind('fing_l').mat('frame'); L(box(0.017, 0.042, 0.017, 0.004), x, -0.118, 0);
    b.mat('joint'); L(rod([x - 0.009, -0.142, 0], [x + 0.009, -0.142, 0], 0.007, 6));
    b.bind('fing2_l').mat('frame'); L(wedge(0.011, 0.011, 0.015, 0.015, 0.045), x, -0.168, 0);
    b.mat('rubber'); L(box(0.011, 0.02, 0.005), x, -0.176, 0.008);
  }
  b.bind('thumb_l').mat('frame');
  L(rod([-0.03, -0.045, 0.02], [-0.045, -0.075, 0.035], 0.009, 6));
  L(rod([-0.045, -0.075, 0.035], [-0.04, -0.105, 0.045], 0.007, 6));
  b.mat('joint'); L(sphere(0.011, 8, 6), -0.03, -0.045, 0.02);

  // right hand: tool mount + three interchangeable tools
  b.use('hand_r', -1).mat('frame');
  L(bcyl(0.026, 0.03, 0.004, 12), 0, -0.008, 0);
  L(box(0.05, 0.022, 0.05, 0.006), 0, -0.03, 0);
  // clamp
  b.use('tool_clamp', -1).mat('painted');
  L(box(0.085, 0.035, 0.04, 0.006), 0, -0.012, 0);
  b.mat('joint');
  L(rod([-0.028, -0.06, -0.026], [-0.028, -0.06, 0.026], 0.01, 8));
  L(rod([0.028, -0.06, -0.026], [0.028, -0.06, 0.026], 0.01, 8));
  b.mat('frame');
  L(box(0.07, 0.04, 0.03, 0.005), 0, -0.04, 0);
  const jawShape: [number, number][] = [[-0.012, 0.01], [0.012, 0.012], [0.03, -0.03], [0.034, -0.085], [0.02, -0.125], [-0.008, -0.15], [-0.014, -0.138], [0.004, -0.115], [0.012, -0.085], [0.008, -0.04], [-0.012, -0.012]];
  b.bind('jaw_a').mat('steel'); b.addL(plate(jawShape, 0.022, 0.003), xf(0.028, -0.06, 0));
  for (let i = 0; i < 4; i++) L(box(0.006, 0.008, 0.022), 0.03, -0.14 - i * 0.012 + 0.03, 0, 0, 0, 30 * D); // teeth
  b.bind('jaw_b'); b.addL(plate(jawShape, 0.022, 0.003), xf(-0.028, -0.06, 0, 0, 180 * D, 0));
  // saw
  b.use('tool_saw', -1).mat('painted');
  L(box(0.05, 0.07, 0.045, 0.007), 0, -0.035, 0);
  b.mat('frame');
  L(box(0.016, 0.09, 0.03, 0.004), 0.022, -0.09, 0.005);
  L(patch((u, v, out) => { const a = (-200 + 220 * u) * D; out.set(-0.012 + v * 0.02, -0.115 + Math.cos(a) * 0.082, 0.01 + Math.sin(a) * 0.082); }, { nu: 14, nv: 1, thickness: 0.003 }));
  b.mat('joint'); L(bcyl(0.016, 0.03, 0.003, 10), 0.008, -0.115, 0.01, 0, 0, 90 * D);
  b.bind('blade').mat('steel');
  {
    const teeth = 22, pts: [number, number][] = [];
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2, a1 = ((i + 0.75) / teeth) * Math.PI * 2;
      pts.push([Math.cos(a0) * 0.076, Math.sin(a0) * 0.076], [Math.cos(a1) * 0.066, Math.sin(a1) * 0.066]);
    }
    b.addL(plate(pts, 0.003, 0.0008), xf(0, -0.115, 0.01, 0, 90 * D, 0));
  }
  // injector
  b.use('tool_inj', -1).mat('painted');
  L(bcyl(0.024, 0.07, 0.005, 12), 0, -0.04, 0);
  b.mat('frame');
  L(bcyl(0.016, 0.05, 0.004, 10), 0, -0.095, 0);
  L(box(0.012, 0.09, 0.012, 0.003), 0.03, -0.06, 0);
  L(rod([0.03, -0.1, 0], [0.008, -0.118, 0], 0.004, 5));
  b.mat('glass'); L(cyl(0.012, 0.012, 0.05, 10), -0.034, -0.05, 0);
  b.mat('cyan'); L(cyl(0.008, 0.008, 0.03, 8), -0.034, -0.056, 0);
  b.mat('frame'); L(bcyl(0.014, 0.008, 0.002, 10), -0.034, -0.022, 0); L(bcyl(0.014, 0.008, 0.002, 10), -0.034, -0.078, 0);
  b.bind('needle').mat('chrome');
  L(rod([0, -0.1, 0], [0, -0.25, 0], 0.0035, 6, 0.0008));
  L(bcyl(0.008, 0.02, 0.002, 8), 0, -0.125, 0);

  // ── LEGS ───────────────────────────────────────────────────────────────
  for (const s of [1, -1]) {
    const sfx = s > 0 ? 'l' : 'r';
    b.use('thigh_' + sfx, s).mat('joint');
    L(sphere(0.05, 14, 10), 0.012, 0, 0);
    L(bcyl(0.036, 0.074, 0.005, 14), 0, -K.thigh, 0, 0, 0, 90 * D);                  // knee hinge
    b.mat('frame');
    L(wedge(0.05, 0.055, 0.07, 0.08, 0.3), 0.004, -0.2, 0.002);
    L(box(0.016, 0.1, 0.075, 0.005), 0.04, -K.thigh + 0.03, 0);
    L(box(0.016, 0.1, 0.075, 0.005), -0.04, -K.thigh + 0.03, 0);
    L(box(0.03, 0.04, 0.04, 0.006), 0, -0.225, -0.05);                              // piston mount
    bolts([[0.049, -K.thigh, 0], [0.049, -K.thigh + 0.045, 0.022], [0.049, -K.thigh + 0.045, -0.022]], 'x', 0.006);
    b.mat('rubber');
    L(tube([[0.03, -0.04, -0.04], [0.045, -0.15, -0.05], [0.04, -0.3, -0.045], [0.03, -0.39, -0.03]], 0.007, 5, 10));
    b.bind('p_thigh_' + sfx).mat('shell');
    L(shell({ y0: -0.375, y1: -0.05, rx: [[0, 0.058], [0.5, 0.074], [1, 0.07]], rz: [[0, 0.062], [0.5, 0.082], [1, 0.076]], cx: [[0, 0.0], [1, 0.008]], cz: [[0, 0.004], [1, 0.0]],
      a0: -105 * D, a1: 128 * D, nu: 20, nv: 11, n: 2.7, thickness: 0.009, trim0: [[0, 25 * D], [0.4, 0], [1, 15 * D]], trim1: [[0, -25 * D], [0.4, 0], [1, 0]],
      mask: s > 0
        ? (u, v) => !chip(u, v, 0.5, 0.0, 0.16, 61) && !crack(u, v, 0.45, 0.1, 0.7, 0.6, 0.025, 62)
        : (u, v) => !chip(u, v, 0.25, 0.75, 0.3, 63) && !crack(u, v, 0.35, 0.6, 0.75, 0.2, 0.025, 64) }));
    b.mat('sign');
    if (s < 0) b.addL(quad(0.06, 0.02), xf(0.079, -0.14, 0.012, 0, 90 * D, 90 * D), true);
    b.bind('thigh_' + sfx);
    piston('kcyl_' + sfx, 'krod_' + sfx, [0, -0.23, -0.058], [0, -K.thigh - 0.09, -0.052], 0.013);
    // knee cap
    b.use('shin_' + sfx, s).mat('shell');
    L(patch((u, v, out) => { const a = (-70 + 140 * u) * D, e = (-55 + 110 * v) * D; out.set(Math.sin(a) * 0.046 * Math.cos(e * 0.5), 0.005 + Math.sin(e) * 0.05, 0.02 + Math.cos(a) * 0.05 * Math.cos(e) ); }, { nu: 8, nv: 6, thickness: 0.008 }));
    b.mat('frame');
    L(rod([0.02, -0.02, 0.01], [0.018, -K.shin + 0.04, 0.0], 0.015, 8, 0.012));
    L(rod([-0.02, -0.02, -0.006], [-0.018, -K.shin + 0.04, -0.004], 0.012, 8, 0.01));
    L(box(0.062, 0.05, 0.06, 0.008), 0, -0.035, 0);
    L(box(0.03, 0.035, 0.035, 0.006), 0, -0.09, -0.045);
    L(box(0.06, 0.03, 0.05, 0.007), 0, -K.shin + 0.045, -0.002);
    b.mat('joint');
    L(bcyl(0.028, 0.07, 0.004, 12), 0, -K.shin, 0, 0, 0, 90 * D);                    // ankle
    L(torus(0.02, 0.004, 5, 10), 0.019, -0.2, 0.006, 90 * D);
    b.mat('rubber');
    L(tube([[-0.005, -0.05, -0.03], [-0.012, -0.16, -0.04], [0, -0.28, -0.035], [0.0, -K.shin + 0.04, -0.03]], 0.006, 5, 10));
    b.bind('p_shin_' + sfx).mat('shell');
    L(shell({ y0: -K.shin + 0.05, y1: -0.07, rx: [[0, 0.04], [0.65, 0.056], [1, 0.05]], rz: [[0, 0.044], [0.65, 0.066], [1, 0.056]], cz: [[0, 0.0], [0.65, -0.006], [1, 0.004]],
      a0: -100 * D, a1: 100 * D, nu: 17, nv: 10, n: 2.5, thickness: 0.008, trim0: [[0, 0], [1, 20 * D]], trim1: [[0, 0], [1, -20 * D]],
      mask: s > 0 ? (u, v) => !chip(u, v, 0.8, 0.9, 0.2, 71) && !(v > 0.25 && v < 0.29 && u > 0.3 && u < 0.7)
        : (u, v) => !chip(u, v, 0.4, 0.05, 0.22, 73) && !crack(u, v, 0.4, 0.2, 0.6, 0.85, 0.025, 74) && !(v > 0.25 && v < 0.29 && u > 0.3 && u < 0.7) }));
    // calf shell half (rear) fixed
    b.bind('shin_' + sfx);
    L(shell({ y0: -0.3, y1: -0.13, rx: [[0, 0.036], [0.6, 0.05], [1, 0.044]], rz: [[0, 0.042], [0.6, 0.06], [1, 0.05]], cz: [[0, -0.004], [1, -0.004]], a0: 135 * D, a1: 225 * D, nu: 8, nv: 6, n: 2.5 }));
    // knee cable (flexes)
    b.mat('rubber');
    {
      const P = (x: number, y: number, z: number): V3 => [(K.hipX + x) * s, y, z];
      b.cable(tube([P(-0.03, 0.6, 0.03), P(-0.04, 0.54, 0.045), P(-0.04, 0.47, 0.045), P(-0.03, 0.41, 0.03)], 0.006, 5, 10),
        'thigh_' + sfx, 'shin_' + sfx, new THREE.Vector3(0, 0.55, 0), new THREE.Vector3(0, 0.46, 0));
    }
    // foot
    b.use('foot_' + sfx, s).mat('frame');
    L(wedge(0.085, 0.2, 0.07, 0.12, 0.035, -0.02), 0, -0.052, 0.04);
    L(box(0.055, 0.05, 0.06, 0.008), 0, -0.02, -0.005);
    L(box(0.07, 0.03, 0.05, 0.008), 0, -0.055, -0.075);                              // heel
    b.mat('rubber');
    L(box(0.09, 0.016, 0.21, 0.005), 0, -0.077, 0.04);
    L(box(0.075, 0.016, 0.06, 0.005), 0, -0.077, -0.075);
    b.mat('shell');
    L(patch((u, v, out) => {
      const a = (-90 + 180 * u) * D;
      const z = 0.035 + v * 0.115, w = 0.048 - v * v * 0.012, h = 0.05 - v * 0.034;
      out.set(Math.sin(a) * w, -0.068 + Math.cos(a) * h + 0.0, z + Math.cos(a) * v * 0.012);
    }, { nu: 10, nv: 6, thickness: 0.007, flip: true, mask: s > 0 ? undefined : (u, v) => !chip(u, v, 0.8, 1, 0.3, 81) }));
    b.mat('joint');
    L(rod([0.03, -0.03, -0.03], [0.034, -0.06, -0.085], 0.006, 6));
    L(rod([-0.03, -0.03, -0.03], [-0.034, -0.06, -0.085], 0.006, 6));
  }

  return { pistons, plates };
}

/**
 * Worn shell: the library's robot_shell reads as clean white plastic under direct light. Darker, warmer albedo,
 * rougher, weaker reflections; vertex colours (shellGrime) add grime toward the feet, in crevices and undersides.
 */
let _shell: THREE.MeshStandardMaterial | null = null;
export function huskShell(ctx: GameContext): THREE.MeshStandardMaterial {
  if (_shell && (_shell as any).__lib === ctx.materials) return _shell;
  const base = ctx.materials.get('robot_shell');
  const m = ctx.materials.clone('robot_shell', {
    color: new THREE.Color(0.45, 0.43, 0.38).multiply(base.color ?? new THREE.Color(1, 1, 1)),
    roughness: Math.min(1, (base.roughness ?? 0.5) * 1.4 + 0.15),
    vertexColors: true,
  });
  (m as any).__lib = ctx.materials;
  (m as any).__envMul = 0.6;
  m.name = 'husk_shell_worn';
  _shell = m;
  return m;
}

/** Keep the worn shell's reflections at a fraction of the library value (setEnvMap resets clones). */
export function syncShellEnv(ctx: GameContext): void {
  if (!_shell) return;
  const want = ctx.materials.get('robot_shell').envMapIntensity * (_shell as any).__envMul;
  if (_shell.envMapIntensity !== want) _shell.envMapIntensity = want;
}

function shellGrime(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color): void {
  // big blotches + fine mottling
  const big = vnoise(p.x * 7 + p.z * 3.1, p.y * 6.5 + p.z * 2.3);
  const fine = vnoise(p.x * 31 + 5.1, p.y * 29 + p.z * 17);
  // grime rises from the feet, collects on undersides and toward the back
  const low = THREE.MathUtils.clamp(1 - p.y / 1.1, 0, 1);
  const under = Math.max(0, -n.y);
  const back = Math.max(0, -n.z) * 0.3;
  let k = 0.98 - big * 0.42 - fine * 0.16 - low * low * 0.35 - under * 0.3 - back * 0.25;
  // streaks running down from seams
  const streak = vnoise(p.x * 60, 0.5) * vnoise(p.z * 60, p.y * 3);
  k -= streak * 0.22;
  k = THREE.MathUtils.clamp(k, 0.24, 1);
  // oil-brown tint in the dirt
  const d = 1 - k;
  out.setRGB(k + d * 0.06, k + d * 0.02, k - d * 0.05);
}

/** Flat quad in XY facing +Z with 0..1 UVs. */
function quad(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h).toNonIndexed();
  return g;
}
