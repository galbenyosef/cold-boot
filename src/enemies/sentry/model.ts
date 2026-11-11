/**
 * SENTRY — "SD-2" hovering security drone (~0.8 m). Armoured sensor pod, twin tilting ducted fans,
 * chin gimbal carrying the searchlight and a pulsed laser, ceiling-dock clamps.
 * Model space: origin at the pod centre, facing +Z.
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { RigBuilder, type RigTemplate } from '../shared/rig';
import { bcyl, bolt, box, cyl, hlathe, patch, rod, sphere, torus, tube, wedge, xf } from '../shared/prims';

export interface SentryTemplate { rig: RigTemplate; }

export const SN = { nacX: 0.275, ductR: 0.14, gimbalY: -0.105, gimbalZ: 0.085, muzzle: new THREE.Vector3(0.045, -0.035, 0.13), lamp: new THREE.Vector3(-0.04, -0.03, 0.1) };

const D = Math.PI / 180;

export function buildSentryTemplate(ctx: GameContext): SentryTemplate {
  const b = new RigBuilder();
  b.bone('body', null, 0, 0, 0);
  b.bone('nac_l', 'body', SN.nacX, 0.01, -0.01);
  b.bone('nac_r', 'body', -SN.nacX, 0.01, -0.01);
  b.bone('fan_l', 'nac_l', SN.nacX, 0.01, -0.01);
  b.bone('fan_r', 'nac_r', -SN.nacX, 0.01, -0.01);
  b.bone('tail', 'body', 0, 0.03, -0.27);
  b.bone('gimbal', 'body', 0, SN.gimbalY, SN.gimbalZ);
  b.bone('turret', 'gimbal', 0, SN.gimbalY - 0.045, SN.gimbalZ);
  b.bone('lampglow', 'turret', -0.04, SN.gimbalY - 0.075, SN.gimbalZ + 0.09);
  b.bone('gunglow', 'turret', 0.045, SN.gimbalY - 0.08, SN.gimbalZ + 0.12);
  b.bone('led', 'body', 0, 0.02, 0.2);
  b.bone('clamp_l', 'body', 0.07, 0.105, -0.02);
  b.bone('clamp_r', 'body', -0.07, 0.105, -0.02);
  b.debrisBones.add('nac_l'); b.debrisBones.add('nac_r'); b.debrisBones.add('turret');

  const L = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => b.addL(geo, xf(x, y, z, rx, ry, rz, sx, sy, sz));

  // ── POD ────────────────────────────────────────────────────────────────
  b.use('body').mat('frame');
  L(box(0.2, 0.12, 0.4, 0.02), 0, 0, -0.01);
  L(box(0.5, 0.04, 0.09, 0.012), 0, 0.01, -0.01);                               // nacelle spar
  L(box(0.12, 0.05, 0.12, 0.012), 0, -0.07, 0.07);                              // gimbal mount
  L(wedge(0.1, 0.06, 0.05, 0.03, 0.2), 0, 0.02, -0.26, -90 * D);                // tail boom
  for (let i = 0; i < 6; i++) L(box(0.15, 0.006, 0.01), 0, -0.064, -0.16 + i * 0.022); // belly heat-sink
  // armour: faceted upper shell (front glacis, roof, rear deck) + cheek plates
  b.mat('armor');
  const roof = (z0: number, z1: number, w0: number, w1: number, h0: number, h1: number, y0: number, y1: number, mask?: (u: number, v: number) => boolean) =>
    patch((u, v, out) => {
      const a = (-108 + 216 * u) * D, e = 0.55;
      const w = w0 + (w1 - w0) * v, h = h0 + (h1 - h0) * v;
      out.set(Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), e) * w, y0 + (y1 - y0) * v + Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), e) * h, z0 + (z1 - z0) * v);
    }, { nu: 14, nv: 4, thickness: 0.012, mask, flip: true });
  L(roof(-0.215, -0.05, 0.085, 0.128, 0.05, 0.075, 0.0, 0.01));
  L(roof(-0.04, 0.12, 0.13, 0.125, 0.078, 0.07, 0.01, 0.01, (u, v) => !(v > 0.25 && v < 0.75 && Math.abs(u - 0.5) < 0.1)));
  L(roof(0.128, 0.245, 0.122, 0.07, 0.068, 0.035, 0.008, -0.012));
  // top hatch + roof vents + antenna mast
  b.mat('frame');
  L(box(0.07, 0.012, 0.085, 0.004), 0, 0.083, 0.04);
  for (let i = 0; i < 4; i++) L(box(0.05, 0.004, 0.008), 0, 0.091, 0.012 + i * 0.018);
  L(rod([0.06, 0.07, -0.16], [0.07, 0.24, -0.2], 0.004, 5, 0.002));
  L(rod([-0.05, 0.07, -0.17], [-0.05, 0.15, -0.18], 0.003, 5, 0.002));
  b.mat('joint');
  for (const s of [-1, 1]) for (const z of [-0.2, -0.06, -0.03, 0.11, 0.14, 0.23]) L(bolt(0.006, 0.005), 0.062 * s * (z > 0.2 ? 0.55 : 1), z > 0.2 ? 0.035 : z < -0.15 ? 0.055 : 0.078, z, 0, 0, -18 * D * s);
  // nose sensor bar: dark glass strip with LEDs
  b.mat('glass');
  L(box(0.13, 0.03, 0.02, 0.006), 0, 0.012, 0.236, -14 * D);
  b.bind('led').mat('red');
  for (const x of [-0.045, -0.03, 0.03, 0.045]) L(box(0.008, 0.008, 0.004), x, 0.013, 0.2475, -14 * D);
  L(box(0.03, 0.006, 0.004), 0, 0.013, 0.2475, -14 * D);
  b.bind('body').mat('accent');
  for (const s of [-1, 1]) L(box(0.006, 0.05, 0.14, 0.002), 0.103 * s, -0.01, -0.09);                    // hazard side panels
  b.mat('sign');
  for (const s of [-1, 1]) b.addL(new THREE.PlaneGeometry(0.11, 0.0367).toNonIndexed(), xf(0.1065 * s, -0.01, -0.09, 0, 90 * D * s, 0), true);
  b.mat('rubber');
  for (const s of [-1, 1]) {
    L(tube([[0.06 * s, -0.05, -0.12], [0.11 * s, -0.045, -0.08], [0.17 * s, -0.01, -0.05], [0.2 * s, 0.0, -0.03]], 0.007, 5, 10));
    L(tube([[0.05 * s, -0.06, 0.0], [0.07 * s, -0.09, 0.03], [0.05 * s, -0.1, 0.06]], 0.006, 5, 8));
  }
  // dock clamps (grip a ceiling rail when dormant)
  for (const s of [1, -1]) {
    b.use('clamp_' + (s > 0 ? 'l' : 'r'), s).mat('joint');
    L(bcyl(0.012, 0.03, 0.003, 8), 0, 0, 0, 90 * D);
    b.mat('frame');
    L(rod([0, 0, 0], [0.012, 0.07, 0], 0.008, 6));
    L(rod([0.012, 0.07, 0], [-0.03, 0.095, 0], 0.007, 6));
    L(box(0.02, 0.012, 0.05, 0.003), -0.03, 0.095, 0);
  }

  // ── NACELLES: duct ring, stators, hub; rotor on its own bone ───────────
  for (const s of [1, -1]) {
    const sfx = s > 0 ? 'l' : 'r';
    const R = SN.ductR;
    b.use('nac_' + sfx, s).mat('armor');
    // duct: aerofoil-section ring
    L(hlathe([[R - 0.004, -0.05], [R + 0.012, -0.045], [R + 0.022, -0.01], [R + 0.02, 0.03], [R + 0.008, 0.052], [R - 0.002, 0.05], [R - 0.008, 0.02], [R - 0.004, -0.05]], 28));
    b.mat('accent');
    L(torus(R + 0.02, 0.006, 5, 28), 0, 0.036, 0, 90 * D);
    b.mat('frame');
    for (let i = 0; i < 3; i++) L(box(R * 2 - 0.01, 0.03, 0.008, 0.002), 0, -0.02, 0, 0, i * 60 * D, 0);   // stator vanes
    L(bcyl(0.034, 0.07, 0.008, 12), 0, -0.01, 0);                                    // motor hub
    L(box(0.07, 0.035, 0.05, 0.008), -(R + 0.035), 0, 0);                            // pivot block (toward the body)
    b.mat('joint');
    L(bcyl(0.022, 0.05, 0.004, 10), -(R + 0.06), 0, 0, 0, 0, 90 * D);
    L(sphere(0.026, 10, 6), 0, 0.03, 0, 0, 0, 0, 1, 0.6, 1);                          // spinner cap (static part)
    // rotor
    b.use('fan_' + sfx, s).mat('steel');
    for (let i = 0; i < 5; i++) {
      const m = xf(0, 0.012, 0, 0, i * 72 * D, 0).multiply(xf(0.082, 0, 0, 24 * D, 0, 0));
      b.addL(wedge(0.105, 0.03, 0.105, 0.045, 0.004), m);
    }
    b.mat('joint'); L(bcyl(0.03, 0.02, 0.004, 10), 0, 0.012, 0);
  }
  // tail stabiliser
  b.use('tail').mat('armor');
  L(box(0.16, 0.008, 0.07, 0.003), 0, 0.0, -0.03);
  L(box(0.008, 0.09, 0.07, 0.003), 0.08, 0.02, -0.03); L(box(0.008, 0.09, 0.07, 0.003), -0.08, 0.02, -0.03);
  b.mat('red'); b.bind('led'); L(box(0.012, 0.006, 0.004), 0, 0.0, -0.067);

  // ── CHIN GIMBAL: yaw ring → turret (pitch) with searchlight + laser ────
  b.use('gimbal').mat('joint');
  L(bcyl(0.06, 0.025, 0.006, 16), 0, -0.005, 0);
  b.mat('frame');
  for (const s of [-1, 1]) L(box(0.014, 0.075, 0.05, 0.004), 0.078 * s, -0.04, 0);       // yoke arms
  L(box(0.17, 0.014, 0.05, 0.004), 0, -0.01, 0);
  b.use('turret').mat('joint');
  L(bcyl(0.018, 0.15, 0.004, 10), 0, 0, 0, 0, 0, 90 * D);                               // trunnion
  b.mat('armor');
  L(box(0.13, 0.07, 0.11, 0.014), 0, -0.02, 0.02);
  // searchlight (left of the laser): reflector barrel, lens, glow
  b.mat('frame');
  L(hlathe([[0.022, -0.03], [0.04, -0.02], [0.046, 0.03], [0.042, 0.034], [0.038, 0.03], [0.02, -0.02]], 16), -0.04, -0.03, 0.065, 90 * D);
  b.mat('chrome');
  L(hlathe([[0.004, -0.018], [0.02, -0.012], [0.036, 0.026]], 14), -0.04, -0.03, 0.065, 90 * D);
  b.bind('lampglow').mat('lamp');
  L(bcyl(0.034, 0.004, 0.001, 14), -0.04, -0.03, 0.09, 90 * D);
  // laser: finned barrel, emitter crystal
  b.bind('turret').mat('frame');
  L(rod([0.045, -0.035, 0.0], [0.045, -0.035, 0.115], 0.016, 10));
  for (let i = 0; i < 5; i++) L(bcyl(0.024, 0.006, 0.0015, 10), 0.045, -0.035, 0.03 + i * 0.016, 90 * D);
  L(box(0.04, 0.03, 0.05, 0.006), 0.045, -0.035, -0.02);
  b.mat('joint'); L(bcyl(0.019, 0.02, 0.004, 10), 0.045, -0.035, 0.122, 90 * D);
  b.mat('glass'); L(sphere(0.012, 8, 6), 0.045, -0.035, 0.128, 0, 0, 0, 1, 1, 0.5);
  b.bind('gunglow').mat('red'); L(sphere(0.0095, 8, 6), 0.045, -0.035, 0.133, 0, 0, 0, 1, 1, 0.4);
  b.bind('turret').mat('rubber');
  L(tube([[0.0, 0.01, -0.03], [0.02, 0.03, -0.05], [0.045, 0.0, -0.045], [0.045, -0.025, -0.035]], 0.005, 5, 8));

  const M = ctx.materials;
  const mats: Record<string, THREE.Material> = {
    armor: M.get('gunmetal'), frame: M.get('robot_frame'), joint: M.get('robot_joint'), accent: M.get('painted_orange'), rubber: M.get('rubber'),
    steel: M.get('steel_raw'), chrome: M.get('chrome'), glass: M.get('screen_off'), lamp: M.get('emissive_white'), red: M.get('emissive_red'),
    sign: M.sign('SEC SD-2', 'warning', 3),
  };
  const rig = b.build(mats, { shadow: ['armor', 'frame', 'joint', 'steel'], radius: 0.8, center: new THREE.Vector3(0, 0, 0) });
  return { rig };
}
