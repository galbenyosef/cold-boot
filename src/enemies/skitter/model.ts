/**
 * SKITTER — "CL-3" cable-laying maintenance drone. Low segmented chassis, six 3-joint legs, sensor head with
 * one red eye, mandible cutters, antennae, trailing cable spool. Model space: belly-down on y = 0, facing +Z.
 * One rigidly-skinned mesh per material (≈7 draw calls), geometry shared by all instances.
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { buildRigLods, glowMaterial, tintOf, type RigBuilder, type RigTemplate } from '../shared/rig';
import { MARK_CYAN_S as MARK_CYAN, MARK_RED_S as MARK_RED } from '../husk/model';
import { bcyl, bolt, box, cyl, patch, plate, rod, sphere, torus, tube, wedge, xf, type V3 } from '../shared/prims';

export const SK = {
  bodyY: 0.215,
  coxa: 0.055, femur: 0.22, tibia: 0.33,
  /** Leg mounts: [x, z, outward yaw (deg from +Z)] for the LEFT (+X) side; mirrored for the right. */
  mounts: [[0.085, 0.135, 42], [0.095, 0.0, 90], [0.085, -0.135, 138]] as [number, number, number][],
  /** Rest foot positions (model space, left side). */
  rest: [[0.25, 0.33], [0.35, 0.01], [0.26, -0.3]] as [number, number][],
};

export interface SkitterTemplate {
  rig: RigTemplate;
  /** Leg bone name suffixes in order: l0 l1 l2 r0 r1 r2. */
  legs: string[];
}

const D = Math.PI / 180;

export function buildSkitterTemplate(ctx: GameContext): SkitterTemplate {
  const M = ctx.materials;
  const mats: Record<string, THREE.Material> = {
    glow: glowMaterial(),
    painted: M.get('painted_yellow'), frame: M.get('robot_frame'), joint: M.get('robot_joint'), rubber: M.get('rubber'),
    chrome: M.get('chrome'), steel: M.get('steel_raw'), glass: M.get('screen_off'), red: M.get('emissive_red'), amber: M.get('emissive_amber'),
  };
  const { template, data } = buildRigLods(authorSkitter, mats, {
    radius: 1.0, center: new THREE.Vector3(0, 0.2, 0),
    fold: { red: 'glow', amber: 'glow', chrome: 'steel' }, tint: { red: tintOf(0xff0702, 2.2), amber: tintOf(0xff6a08, 2.5) },
    lod: { k: 0.45, minFeature: 0.012, remap: { chrome: 'joint', steel: 'joint', glass: 'frame', rubber: 'frame', amber: null } },
    proxy: { k: 0.3, minFeature: 0.025, exclude: ['glass', 'red', 'amber', 'chrome', 'rubber'] },
  });
  return { rig: template, legs: data };
}

function authorSkitter(b: RigBuilder): string[] {
  const Y0 = SK.bodyY;
  b.bone('body', null, 0, Y0, 0);
  b.bone('abdomen', 'body', 0, Y0 + 0.01, -0.17);
  b.bone('spool', 'abdomen', 0, Y0 + 0.075, -0.3);
  b.bone('tail1', 'abdomen', 0, Y0 + 0.02, -0.4);
  b.bone('tail2', 'tail1', 0, 0.09, -0.56);
  b.bone('tail3', 'tail2', 0, 0.025, -0.74);
  b.bone('neck', 'body', 0, Y0 + 0.02, 0.175);
  b.bone('head', 'neck', 0, Y0 + 0.03, 0.25);
  b.bone('eye', 'head', 0, Y0 + 0.04, 0.345);
  b.bone('mand_l', 'head', 0.04, Y0 - 0.005, 0.33);
  b.bone('mand_r', 'head', -0.04, Y0 - 0.005, 0.33);
  for (const [sfx, s] of [['l', 1], ['r', -1]] as const) {
    b.bone('ant1_' + sfx, 'head', 0.04 * s, Y0 + 0.085, 0.27);
    b.bone('ant2_' + sfx, 'ant1_' + sfx, 0.075 * s, Y0 + 0.2, 0.31);
  }
  const legs: string[] = [];
  for (const [sfx, s] of [['l', 1], ['r', -1]] as const) {
    SK.mounts.forEach(([mx, mz, yawDeg], i) => {
      const n = sfx + i;
      const yaw = yawDeg * D * s;
      const dx = Math.sin(yaw), dz = Math.cos(yaw);
      const x = mx * s;
      b.bone('mount_' + n, 'body', x, Y0, mz, yaw);
      b.bone('coxa_' + n, 'mount_' + n, x, Y0, mz, yaw);
      b.bone('femur_' + n, 'coxa_' + n, x + dx * SK.coxa, Y0, mz + dz * SK.coxa, yaw);
      b.bone('tibia_' + n, 'femur_' + n, x + dx * (SK.coxa + SK.femur), Y0, mz + dz * (SK.coxa + SK.femur), yaw);
      legs.push(n);
      b.debrisBones.add('tibia_' + n); b.debrisBones.add('femur_' + n);
    });
  }
  // dark-room marks (RigBuilder.mark; scale = brightness): the eye's own, and a pair on the antenna tips — red while
  // hunting, cyan (standby) while dormant. The pair is what reads at range: two points that bob and turn with the head.
  b.bone('mk_eye', 'eye', 0, Y0 + 0.04, 0.345);
  for (const [sfx, s] of [['l', 1], ['r', -1]] as const) {
    b.bone('mk_ant_' + sfx, 'ant2_' + sfx, 0.105 * s, Y0 + 0.3, 0.38);
    b.bone('mk_ants_' + sfx, 'ant2_' + sfx, 0.105 * s, Y0 + 0.3, 0.38);
  }
  b.debrisBones.add('head'); b.debrisBones.add('spool');

  const L = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => b.addL(geo, xf(x, y, z, rx, ry, rz, sx, sy, sz));
  /** Carapace plate: arc over the top around the Z axis, from z0 to z1, with half-width/height profiles. */
  const carapace = (z0: number, z1: number, w0: number, w1: number, h0: number, h1: number, y: number, arc = 105, mask?: (u: number, v: number) => boolean, nu = 14, nv = 6) =>
    patch((u, v, out) => {
      const a = (-arc + 2 * arc * u) * D;
      const bulge = Math.sin(Math.PI * v) * 0.012;
      const w = w0 + (w1 - w0) * v + bulge, h = h0 + (h1 - h0) * v + bulge;
      const e = 0.7;
      out.set(Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), e) * w, y + Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), e) * h, z0 + (z1 - z0) * v);
    }, { nu, nv, thickness: 0.007, mask, flip: true });

  // ── THORAX ─────────────────────────────────────────────────────────────
  b.use('body').mat('frame');
  L(box(0.15, 0.07, 0.34, 0.012), 0, 0, 0);
  L(box(0.19, 0.03, 0.3, 0.008), 0, -0.005, 0);                                // leg rail
  L(box(0.11, 0.035, 0.2, 0.008), 0, -0.05, -0.01);                             // belly battery
  for (let i = 0; i < 5; i++) L(box(0.1, 0.006, 0.012), 0, -0.069, -0.09 + i * 0.04); // cooling fins
  for (const s of [-1, 1]) {
    L(rod([0.05 * s, 0.07, 0.12], [0.05 * s, 0.1, 0.07], 0.006, 6));          // carry handle
    L(rod([0.05 * s, 0.1, 0.07], [0.05 * s, 0.1, -0.07], 0.006, 6));
    L(rod([0.05 * s, 0.1, -0.07], [0.05 * s, 0.07, -0.12], 0.006, 6));
  }
  b.mat('joint');
  for (const s of [-1, 1]) for (const [mx, mz] of SK.mounts) {
    L(bcyl(0.036, 0.062, 0.006, 12), mx * s, 0, mz);                            // leg turrets
    L(bolt(0.006, 0.005), mx * s, 0.031, mz);
  }
  L(torus(0.062, 0.012, 6, 16), 0, 0.01, 0.17, 0, 0, 0, 1, 0.75, 1);            // neck gimbal ring
  L(torus(0.07, 0.012, 6, 16), 0, 0.01, -0.17, 0, 0, 0, 1, 0.7, 1);             // waist ring
  b.mat('painted');
  L(carapace(-0.16, 0.0, 0.1, 0.108, 0.058, 0.064, 0.012, 100, (u, v) => !(v > 0.3 && v < 0.42 && Math.abs(u - 0.5) > 0.12 && Math.abs(u - 0.5) < 0.38)));
  L(carapace(0.012, 0.165, 0.108, 0.082, 0.064, 0.05, 0.012, 100, (u, v) => !(u > 0.7 && v > 0.7 && (u - 0.7) + (v - 0.7) > 0.3)));
  b.mat('frame');
  for (const s of [-1, 1]) for (const z of [-0.15, -0.01, 0.022, 0.15]) L(bolt(0.005, 0.004), 0.06 * s, 0.062, z, 0, 0, -32 * D * s);
  b.mat('amber');
  L(box(0.02, 0.004, 0.008), 0, 0.078, -0.08); L(box(0.006, 0.004, 0.006), 0.03, 0.074, 0.1);
  b.mat('rubber');
  for (const s of [-1, 1]) L(tube([[0.07 * s, 0.03, 0.14], [0.085 * s, 0.045, 0.06], [0.08 * s, 0.04, -0.06], [0.07 * s, 0.03, -0.15]], 0.006, 5, 10));

  // ── ABDOMEN + SPOOL ────────────────────────────────────────────────────
  b.use('abdomen').mat('frame');
  L(wedge(0.07, 0.05, 0.13, 0.065, 0.2), 0, -0.012, -0.11, -90 * D);
  for (const s of [-1, 1]) {
    L(plate([[0, 0], [0.06, 0.0], [0.1, 0.075], [0.085, 0.105], [0.055, 0.105], [0.0, 0.03]], 0.01, 0.002), 0.068 * s, -0.01, -0.03, 0, 90 * D, 0);   // spool yoke arms
    L(bcyl(0.016, 0.018, 0.003, 10), 0.075 * s, 0.065, -0.13, 0, 0, 90 * D);
  }
  L(rod([0, 0.0, -0.2], [0, 0.03, -0.235], 0.012, 8));                           // cable guide arm
  b.mat('joint'); L(torus(0.016, 0.005, 5, 10), 0, 0.03, -0.238, 0, 0, 0);
  b.mat('painted');
  L(carapace(-0.1, -0.005, 0.07, 0.1, 0.035, 0.056, 0.0, 95, undefined, 12, 4));
  // spool drum with wound cable
  b.use('spool').mat('joint');
  L(bcyl(0.078, 0.008, 0.002, 18), 0.056, 0, 0, 0, 0, 90 * D);
  L(bcyl(0.078, 0.008, 0.002, 18), -0.056, 0, 0, 0, 0, 90 * D);
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) L(bcyl(0.012, 0.01, 0.002, 6), 0.061 * s, Math.cos(i * 72 * D) * 0.05, Math.sin(i * 72 * D) * 0.05, 0, 0, 90 * D);
  b.mat('rubber');
  for (let i = 0; i < 9; i++) L(torus(0.056 + (i % 2) * 0.004, 0.0065, 5, 16), -0.046 + i * 0.0115, 0, 0, 0, 90 * D, 0);
  L(cyl(0.05, 0.05, 0.105, 12), 0, 0, 0, 0, 0, 90 * D);
  // trailing cable (three flexible spans)
  b.mat('rubber');
  const spans: [string, string, V3[]][] = [
    ['abdomen', 'tail1', [[0, Y0 + 0.03, -0.3], [0, Y0 + 0.045, -0.36], [0, Y0 + 0.02, -0.41]]],
    ['tail1', 'tail2', [[0, Y0 + 0.02, -0.41], [0, 0.16, -0.48], [0, 0.09, -0.56]]],
    ['tail2', 'tail3', [[0, 0.09, -0.56], [0, 0.045, -0.65], [0, 0.022, -0.76], [0.01, 0.012, -0.9]]],
  ];
  for (const [a, c, pts] of spans) {
    b.cable(tube(pts, 0.0075, 6, 8), a, c, new THREE.Vector3(...pts[0]), new THREE.Vector3(...pts[pts.length - 2]));
  }

  // ── NECK + HEAD ────────────────────────────────────────────────────────
  b.use('neck').mat('joint');
  L(bcyl(0.03, 0.08, 0.005, 10), 0, 0, 0.03, 90 * D);
  b.mat('rubber');
  for (const s of [-1, 1]) b.cable(tube([[0.04 * s, Y0 + 0.04, 0.15], [0.05 * s, Y0 + 0.06, 0.2], [0.035 * s, Y0 + 0.06, 0.26]], 0.005, 5, 6), 'body', 'head', new THREE.Vector3(0, 0, 0.16), new THREE.Vector3(0, 0, 0.25));
  b.use('head').mat('frame');
  L(wedge(0.1, 0.055, 0.075, 0.035, 0.11), 0, 0.005, 0.04, 90 * D);            // sensor pod (tapers forward)
  L(box(0.085, 0.02, 0.06, 0.006), 0, -0.03, 0.03);
  for (const s of [-1, 1]) {
    b.mat('joint'); L(bcyl(0.016, 0.018, 0.003, 10), 0.052 * s, 0.01, 0.03, 0, 0, 90 * D);
    b.mat('glass'); L(sphere(0.011, 8, 6), 0.062 * s, 0.01, 0.03, 0, 0, 0, 0.5, 1, 1);
  }
  b.mat('painted');
  L(patch((u, v, out) => {
    const a = (-95 + 190 * u) * D;
    const w = 0.058 - v * 0.016, h = 0.04 - v * 0.012;
    out.set(Math.sin(a) * w, 0.012 + Math.cos(a) * h, -0.015 + v * 0.105);
  }, { nu: 12, nv: 5, thickness: 0.006, flip: true, mask: (u, v) => !(v > 0.55 && Math.abs(u - 0.5) < 0.2) }));
  // the eye: deep barrel, glass, emissive iris (bone 'eye')
  b.mat('joint');
  L(bcyl(0.028, 0.035, 0.005, 14), 0, 0.012, 0.085, 90 * D);
  L(torus(0.026, 0.005, 6, 14), 0, 0.012, 0.103);
  b.mat('glass'); L(sphere(0.021, 12, 8), 0, 0.012, 0.094, 0, 0, 0, 1, 1, 0.5);
  b.bind('eye').mat('red'); L(sphere(0.0135, 10, 6), 0, 0.012, 0.1035, 0, 0, 0, 1, 1, 0.4);
  b.mark('mk_eye', new THREE.Vector3(0, Y0 + 0.042, 0.361), new THREE.Vector3(0, 0.1, 1), 0.0055, MARK_RED, -0.15);
  b.bind('head');
  // mandible cutters
  const mand: [number, number][] = [[0, -0.012], [0.02, -0.016], [0.07, -0.006], [0.105, 0.016], [0.118, 0.04], [0.1, 0.03], [0.078, 0.018], [0.055, 0.012], [0.03, 0.012], [0, 0.012]];
  for (const s of [1, -1]) {
    const sfx = s > 0 ? 'l' : 'r';
    b.use('mand_' + sfx, s).mat('joint');
    L(bcyl(0.012, 0.024, 0.003, 8), 0, 0, 0);
    b.mat('steel');
    // shape in XY → lay flat (XZ), blade curving inward toward the centre line
    b.addL(plate(mand, 0.008, 0.002), xf(0, 0, 0, 90 * D, 0, 0).multiply(xf(0, 0, 0, 0, 0, -90 * D)).multiply(xf(0, 0, 0, 0, 180 * D, 0)));
    L(box(0.004, 0.004, 0.012), -0.012, 0, 0.06);
  }
  b.use('head').mat('steel');
  L(rod([0, -0.03, 0.06], [0, -0.03, 0.115], 0.005, 6, 0.0015));                 // probe
  // antennae
  for (const s of [1, -1]) {
    const sfx = s > 0 ? 'l' : 'r';
    b.use('ant1_' + sfx).mat('frame');
    L(sphere(0.008, 6, 5));
    L(rod([0, 0, 0], [0.035 * s, 0.115, 0.04], 0.0032, 5, 0.0024));
    b.use('ant2_' + sfx);
    L(rod([0, 0, 0], [0.03 * s, 0.1, 0.07], 0.0022, 5, 0.001));
    b.mat('amber'); L(sphere(0.0035, 6, 4), 0.03 * s, 0.1, 0.07);
    b.mark('mk_ant_' + sfx, new THREE.Vector3(0.105 * s, Y0 + 0.3, 0.38), new THREE.Vector3(0, 1, 0), 0.0035, MARK_RED, -2);
    b.mark('mk_ants_' + sfx, new THREE.Vector3(0.105 * s, Y0 + 0.3, 0.38), new THREE.Vector3(0, 1, 0), 0.0035, MARK_CYAN, -2);
  }

  // ── LEGS (authored along local +Z: coxa → femur → tibia) ───────────────
  for (const n of legs) {
    b.use('coxa_' + n).mat('joint');
    L(sphere(0.026, 10, 8));
    L(rod([0, 0, 0.01], [0, 0, SK.coxa], 0.017, 8));
    b.use('femur_' + n).mat('joint');
    L(bcyl(0.022, 0.05, 0.004, 10), 0, 0, 0, 0, 0, 90 * D);
    L(bcyl(0.019, 0.046, 0.004, 10), 0, 0, SK.femur, 0, 0, 90 * D);
    b.mat('frame');
    L(wedge(0.026, 0.036, 0.022, 0.028, SK.femur - 0.03), 0, 0, SK.femur / 2, 90 * D);
    L(box(0.036, 0.014, 0.03, 0.004), 0, 0.016, 0.03);
    b.mat('painted');
    L(patch((u, v, out) => { const a = (-80 + 160 * u) * D; out.set(Math.sin(a) * (0.026 - v * 0.005), 0.006 + Math.cos(a) * (0.03 - v * 0.007), 0.025 + v * 0.15); }, { nu: 6, nv: 3, thickness: 0.005, flip: true }));
    b.mat('rubber');
    L(tube([[0.014, -0.012, 0.01], [0.02, -0.022, 0.07], [0.016, -0.02, 0.15], [0.01, -0.008, SK.femur - 0.005]], 0.0045, 5, 8));
    b.mat('chrome');
    L(rod([0, -0.02, 0.03], [0, -0.012, 0.17], 0.004, 5));
    b.use('tibia_' + n).mat('frame');
    L(wedge(0.024, 0.03, 0.012, 0.014, SK.tibia - 0.05), 0, 0, 0.02 + (SK.tibia - 0.05) / 2, 90 * D);
    L(box(0.03, 0.03, 0.04, 0.006), 0, 0.004, 0.022);
    b.mat('painted');
    L(patch((u, v, out) => { const a = (-70 + 140 * u) * D; out.set(Math.sin(a) * (0.02 - v * 0.008), 0.005 + Math.cos(a) * (0.024 - v * 0.01), 0.03 + v * 0.13); }, { nu: 5, nv: 3, thickness: 0.004, flip: true }));
    b.mat('steel');
    L(rod([0, 0, SK.tibia - 0.06], [0, 0, SK.tibia], 0.008, 6, 0.0015));           // claw tip
    L(rod([0, -0.004, SK.tibia - 0.09], [0, -0.03, SK.tibia - 0.05], 0.004, 5, 0.001)); // spur
    b.mat('rubber');
    L(torus(0.009, 0.004, 5, 8), 0, 0, SK.tibia - 0.055, 0, 0, 0);
  }

  return legs;
}
