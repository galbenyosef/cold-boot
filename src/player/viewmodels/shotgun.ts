/**
 * "Halvard M7" pump shotgun — tube-fed 12ga, pistol-grip polymer stock, ribbed pump,
 * perforated heat shield, side-saddle shell carrier. Origin: top of the pistol grip.
 * Profiles in (s, t) = (toward muzzle, up); +X right; -Z muzzle.
 */
import * as THREE from 'three';
import { M, Parts, rbox, cylZ, cylX, latheZ, tubeZ, shape, hole, profileX, sweep, inPoly, sphere, prep, flipWinding, type Station } from '../geom';
import type { VmMats } from './mats';
import { buildShell } from './props';

export interface ShotgunModel {
  root: THREE.Group;
  pump: THREE.Group;
  trigger: THREE.Group;
  bolt: THREE.Group;
  /** Side-saddle shells (visible count follows reserve). */
  saddle: THREE.Object3D[];
  /** Socket on the pump where the support hand grips (moves with pump). */
  pumpSocket: THREE.Object3D;
  /** Bottom loading port: shells slide in along +Z here. */
  loadPort: THREE.Object3D;
  muzzle: THREE.Object3D;
  ejectPort: THREE.Object3D;
}

export const S_BORE = 0.040;
export const S_TUBE = 0.0128;
export const S_MUZZLE = 0.662;
export const PUMP_TRAVEL = 0.088;
const RW = 0.0355; // receiver width

export function buildShotgun(m: VmMats, opts: { detail?: boolean } = {}): ShotgunModel {
  const detail = opts.detail !== false;
  const root = new THREE.Group();
  root.name = 'shotgun';
  const p = new Parts();

  // ─────────────── receiver
  const recv = [[-0.016, 0.0, 0.002], [0.198, 0.0, 0.002], [0.2015, 0.004, 0.002], [0.2015, 0.056, 0.003], [0.196, 0.0595, 0.003], [0.02, 0.0595, 0.004], [-0.006, 0.055, 0.006], [-0.018, 0.044, 0.004]];
  p.add(profileX(shape(recv), RW, 0.0022, 0, 10, 3), m.gunmetal);
  // machined side flats (subtle raised panels) and engraving lines on the left
  p.add(profileX(shape([[0.03, 0.012, 0.003], [0.19, 0.012, 0.003], [0.19, 0.047, 0.003], [0.03, 0.047, 0.003]]), RW + 0.0012, 0.0006), m.gunmetal);
  p.add(new THREE.BoxGeometry(0.0004, 0.0008, 0.12), m.interior, M(-RW / 2 - 0.0007, 0.0085, -0.11));
  // ejection port (right): dark recess + chrome bolt face
  p.add(rbox(0.002, 0.026, 0.074, 0.001), m.interior, M(RW / 2 + 0.0002, 0.034, -0.112));
  const bolt = new THREE.Group();
  const bp = new Parts();
  bp.add(rbox(0.004, 0.018, 0.03, 0.0015), m.chrome, M(RW / 2 - 0.0005, 0.034, -0.088));
  bp.add(rbox(0.0035, 0.004, 0.012, 0.0012), m.steel, M(RW / 2 + 0.001, 0.034, -0.098));
  bp.build(bolt);
  root.add(bolt);
  // loading port (bottom): dark opening + shell lifter
  p.add(rbox(0.026, 0.004, 0.092, 0.0015), m.interior, M(0, -0.0006, -0.128));
  p.add(rbox(0.021, 0.0015, 0.07, 0.0006), m.steel, M(0, 0.0012, -0.122));
  // receiver pins + cross-bolt safety
  for (const s of [0.008, 0.075]) p.add(cylX(0.0024, RW + 0.0016, 14), m.steel, M(0, 0.0055, -s));
  for (const s of [0.008, 0.075]) for (const sx of [-1, 1]) p.add(cylX(0.0011, 0.0006, 10), m.interior, M(sx * (RW / 2 + 0.0009), 0.0055, -s));
  // top rail with ghost-ring rear sight
  p.add(rbox(0.016, 0.004, 0.17, 0.001), m.gunmetal, M(0, 0.0612, -0.105));
  for (let i = 0; i < 13; i++) p.add(rbox(0.0205, 0.0034, 0.0058, 0.0008), m.gunmetal, M(0, 0.0645, -0.034 - i * 0.0108));
  const ghost = new THREE.TorusGeometry(0.0058, 0.0016, 10, 24);
  p.add(ghost, m.gunmetal, M(0, 0.0755, -0.016, 0, 0, 0));
  p.add(profileX(shape([[-0.004, 0.0, 0.001], [0.018, 0.0, 0.001], [0.012, 0.009, 0.003], [0.004, 0.0105, 0.002], [-0.002, 0.0075, 0.001]]), 0.022, 0.0012), m.gunmetal, M(0, 0.064, 0));
  for (const sx of [-1, 1]) p.add(profileX(shape([[0.0, 0.0, 0.001], [0.01, 0.0, 0.002], [0.006, 0.0165, 0.003], [-0.001, 0.0165, 0.002]]), 0.004, 0.0008, sx * 0.0085), m.gunmetal, M(0, 0.066, 0));

  // ─────────────── trigger group + guard
  p.add(profileX(shape([[-0.014, 0.001], [0.082, 0.001], [0.08, -0.009, 0.004], [0.06, -0.012, 0.004], [-0.012, -0.012, 0.004]]), 0.026, 0.0016), m.polymer);
  const tg = shape([[0.012, -0.008], [0.076, -0.008], [0.078, -0.022, 0.006], [0.072, -0.044, 0.01], [0.055, -0.049, 0.006], [0.018, -0.046, 0.01], [0.006, -0.03, 0.006]]);
  tg.holes.push(hole([[0.017, -0.0125], [0.0715, -0.0125, 0.003], [0.072, -0.023, 0.006], [0.067, -0.040, 0.008], [0.055, -0.0435, 0.004], [0.022, -0.041, 0.008], [0.0135, -0.03, 0.004]]));
  p.add(profileX(tg, 0.0125, 0.0018, 0, 12, 2), m.polymer);
  // slide release (left, front of guard)
  p.add(profileX(shape([[0.08, -0.002, 0.002], [0.097, -0.003, 0.002], [0.099, -0.012, 0.003], [0.091, -0.013, 0.002]]), 0.003, 0.0008, -0.0145), m.steel);
  // safety button (cross-bolt, behind trigger)
  p.add(cylX(0.0032, 0.03, 16), m.steel, M(0, -0.004, -0.012));
  p.add(cylX(0.0018, 0.0306, 8), m.emRed, M(0, -0.004, -0.012, 0, 0, 0, 0.3, 1, 1));

  // ─────────────── pistol grip + stock (polymer)
  const grip = [[0.008, -0.006], [0.002, -0.03, 0.01], [-0.012, -0.07, 0.02], [-0.022, -0.103, 0.006], [-0.064, -0.098, 0.008], [-0.058, -0.07, 0.03], [-0.046, -0.03, 0.02], [-0.04, -0.004]];
  p.add(profileX(shape(grip), 0.031, 0.0035, 0, 14, 3), m.polymer);
  // grip stippling panels
  if (detail) {
    const inner = [[-0.003, -0.034], [-0.014, -0.07], [-0.021, -0.093], [-0.055, -0.089], [-0.05, -0.065], [-0.04, -0.034]];
    const cone = new THREE.ConeGeometry(0.0011, 0.001, 4, 1, true);
    let k = 0;
    for (let t = -0.032; t > -0.094; t -= 0.003) {
      k++;
      for (let s = -0.002 + (k % 2) * 0.0015; s > -0.058; s -= 0.003) {
        if (!inPoly(s, t, inner)) continue;
        for (const sx of [-1, 1]) p.add(cone, m.polymer, M(sx * 0.0156, t, -s, 0, 0, -sx * Math.PI / 2));
      }
    }
  }
  // stock: hollow-look skeleton with cheek comb, from receiver rear to the butt
  const stock = [[-0.012, 0.047], [-0.12, 0.05, 0.03], [-0.36, 0.044, 0.01], [-0.372, 0.04, 0.004], [-0.372, -0.105, 0.004], [-0.36, -0.108, 0.01], [-0.25, -0.07, 0.03], [-0.07, -0.034, 0.02], [-0.045, -0.012, 0.01], [-0.012, -0.002]];
  const stockShape = shape(stock);
  stockShape.holes.push(hole([[-0.085, 0.02], [-0.32, 0.024, 0.02], [-0.335, -0.0, 0.01], [-0.335, -0.075, 0.012], [-0.29, -0.068, 0.02], [-0.11, -0.022, 0.02], [-0.085, -0.008, 0.01]], 0.008));
  p.add(profileX(stockShape, 0.034, 0.005, 0, 16, 3), m.polymer);
  // recoil pad
  p.add(profileX(shape([[-0.371, 0.044, 0.006], [-0.392, 0.046, 0.006], [-0.394, -0.111, 0.006], [-0.371, -0.11, 0.004]]), 0.04, 0.006, 0, 8, 3), m.rubber);
  for (let i = 0; i < 9; i++) p.add(rbox(0.041, 0.0025, 0.012, 0.001), m.rubber, M(0, 0.03 - i * 0.016, 0.3885));
  // sling mount at the stock
  p.add(new THREE.TorusGeometry(0.006, 0.0014, 8, 16), m.steel, M(0, -0.09, 0.335, 0, Math.PI / 2, 0));

  // ─────────────── barrel, mag tube, heat shield, bead
  p.add(tubeZ(0.0118, 0.0093, 0.19, S_MUZZLE, 40), m.gunmetal, M(0, S_BORE, 0));
  p.add(latheZ([[[0.0093, 0.62], [0.0, 0.62]]], 20), m.interior, M(0, S_BORE, 0));
  // barrel collar at the receiver
  p.add(latheZ([[[0.0118, 0.195], [0.0148, 0.198]], [[0.0148, 0.198], [0.0148, 0.222]], [[0.0148, 0.222], [0.0118, 0.226]]], 32), m.gunmetal, M(0, S_BORE, 0));
  // mag tube
  p.add(latheZ([[[0.0115, 0.198], [0.0115, 0.585]]], 32), m.gunmetal, M(0, S_TUBE, 0));
  // knurled mag cap with sling swivel
  const capRuns: [number, number][][] = [[[0.0, 0.584], [0.0128, 0.584]], [[0.0128, 0.584], [0.0128, 0.6]]];
  const knurl: [number, number][] = [];
  for (let i = 0; i <= 8; i++) knurl.push([i % 2 ? 0.0136 : 0.0129, 0.6 + i * 0.0025]);
  capRuns.push(knurl, [[0.0129, 0.62], [0.0105, 0.624], [0.0, 0.625]]);
  p.add(latheZ(capRuns, 32), m.gunmetal, M(0, S_TUBE, 0));
  p.add(new THREE.TorusGeometry(0.0062, 0.0014, 8, 16), m.steel, M(0, S_TUBE - 0.017, -0.612, 0, Math.PI / 2, 0));
  // barrel clamp (band joining barrel + tube)
  const clamp = shape([[-0.0155, S_TUBE - 0.004], [0.0155, S_TUBE - 0.004], [0.0155, S_BORE + 0.004, 0.012], [-0.0155, S_BORE + 0.004, 0.012]], 0.004);
  clamp.holes.push(circle(0, S_BORE, 0.0119), circle(0, S_TUBE, 0.0116));
  p.add(sectionShape(clamp, 0.552, 0.574), m.gunmetal);
  p.add(cylX(0.0022, 0.034, 12), m.steel, M(0, (S_BORE + S_TUBE) / 2, -0.563));
  // front bead (fibre optic insert)
  p.add(profileX(shape([[0.636, 0.0, 0.001], [0.652, 0.0, 0.001], [0.648, 0.006, 0.002], [0.64, 0.006, 0.002]]), 0.006, 0.001), m.gunmetal, M(0, S_BORE + 0.0108, 0));
  p.add(sphere(0.0022, 14, 10), m.brass, M(0, S_BORE + 0.0185, -0.645));
  p.add(cylZ(0.0011, 0.004, 10), m.emRed, M(0, S_BORE + 0.0185, -0.6458));
  // perforated heat shield: smooth partial tube (outer + inner skin) with dark slot perforations
  {
    const R = 0.0168, len = 0.25, half = 1.3;
    const outer = new THREE.CylinderGeometry(R, R, len, 40, 1, true, -half, half * 2);
    outer.rotateX(-Math.PI / 2);
    p.add(outer, m.gunmetal, M(0, S_BORE, -0.225 - len / 2));
    const innerG = new THREE.CylinderGeometry(R - 0.001, R - 0.001, len, 40, 1, true, -half, half * 2);
    innerG.rotateX(-Math.PI / 2);
    p.add(flipWinding(prep(innerG)), m.gunmetal, M(0, S_BORE, -0.225 - len / 2));
    for (const sgn of [-1, 1]) {
      p.add(rbox(0.0016, 0.0016, len, 0.0006), m.gunmetal, M(Math.sin(half * sgn) * (R - 0.0005), S_BORE + Math.cos(half * sgn) * (R - 0.0005), -0.225 - len / 2));
    }
    const slot = rbox(0.0085, 0.0006, 0.0155, 0.0029, 2);
    for (let i = 0; i < 9; i++) {
      for (const col of [-1, 0, 1]) {
        const cz = 0.02 + i * 0.026 + (col === 0 ? 0.013 : 0);
        if (cz > len - 0.02) continue;
        const ang = col * 0.78;
        p.add(slot, m.interior, M(Math.sin(ang) * (R + 0.0001), S_BORE + Math.cos(ang) * (R + 0.0001), -0.225 - cz, 0, 0, -ang));
      }
    }
  }
  // shield mounting clips
  for (const s of [0.232, 0.468]) p.add(latheZ([[[0.0122, s], [0.0122, s + 0.006]]], 28), m.steel, M(0, S_BORE, 0));

  // ─────────────── side saddle (left side)
  p.add(rbox(0.004, 0.05, 0.104, 0.0018), m.polymer, M(-RW / 2 - 0.002, 0.028, -0.125));
  for (const sx of [0.11, 0.142]) p.add(cylX(0.0028, 0.002, 12), m.steel, M(-RW / 2 - 0.0042, 0.04, -sx));
  const saddle: THREE.Object3D[] = [];
  const shellProto = buildShell(m);
  for (let i = 0; i < 4; i++) {
    const s = 0.086 + i * 0.0245;
    p.add(rbox(0.004, 0.012, 0.0225, 0.0018), m.rubber, M(-RW / 2 - 0.0135, 0.04, -s));
    const sh = shellProto.clone();
    sh.position.set(-RW / 2 - 0.0145, -0.012, -s);
    sh.rotation.set(0, 0, 0);
    root.add(sh);
    saddle.push(sh);
  }

  const frame = new THREE.Group();
  p.build(frame);
  root.add(frame);

  // ─────────────── pump (moves along +Z) with action bars
  const pump = new THREE.Group();
  root.add(pump);
  const pp = new Parts();
  const st: Station[] = [];
  const s0 = 0.218, s1 = 0.382;
  const ridgeN = 11;
  // front lip
  st.push({ z: -s1, w: 0.0168, h: 0.0158, n: 2.4, y: 0.002 });
  st.push({ z: -s1 + 0.004, w: 0.0212, h: 0.0198, n: 2.6, y: 0.002 });
  st.push({ z: -s1 + 0.012, w: 0.0225, h: 0.0208, n: 2.8, y: 0.002 });
  // ribbed grip zone
  const r0 = -s1 + 0.024, r1 = -s0 - 0.024;
  for (let i = 0; i <= ridgeN * 4; i++) {
    const z = r0 + ((r1 - r0) * i) / (ridgeN * 4);
    const ph = (i % 4);
    const d = ph === 0 || ph === 1 ? 0 : -0.0018;
    st.push({ z, w: 0.0218 + d, h: 0.0202 + d, n: 2.8, y: 0.002 });
  }
  st.push({ z: -s0 - 0.012, w: 0.0225, h: 0.0208, n: 2.8, y: 0.002 });
  st.push({ z: -s0 - 0.004, w: 0.0212, h: 0.0198, n: 2.6, y: 0.002 });
  st.push({ z: -s0, w: 0.0172, h: 0.016, n: 2.4, y: 0.002 });
  pp.add(sweep(st, 36), m.polymer, M(0, S_TUBE, 0));
  // action bars
  for (const sx of [-1, 1]) pp.add(rbox(0.0018, 0.005, 0.12, 0.0006), m.steel, M(sx * 0.0118, S_TUBE + 0.002, -0.17));
  pp.build(pump);
  const pumpSocket = new THREE.Object3D();
  pumpSocket.position.set(0, S_TUBE, -0.30);
  pump.add(pumpSocket);

  // ─────────────── trigger
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.009, -0.05);
  const tp = new Parts();
  tp.add(profileX(shape([[0.003, 0.002], [0.0042, -0.008, 0.004], [0.002, -0.019, 0.006], [-0.0025, -0.0245, 0.0015], [-0.0045, -0.0225, 0.0015], [-0.0007, -0.014, 0.006], [-0.0026, -0.004, 0.003], [-0.0024, 0.002]]), 0.006, 0.0013), m.steel);
  tp.build(trigger);
  root.add(trigger);

  const loadPort = new THREE.Object3D();
  loadPort.position.set(0, -0.004, -0.15);
  root.add(loadPort);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, S_BORE, -S_MUZZLE - 0.004);
  root.add(muzzle);
  const ejectPort = new THREE.Object3D();
  ejectPort.position.set(RW / 2 + 0.004, 0.034, -0.11);
  root.add(ejectPort);

  return { root, pump, trigger, bolt, saddle, pumpSocket, loadPort, muzzle, ejectPort };
}

function circle(x: number, y: number, r: number): THREE.Path {
  const p = new THREE.Path();
  p.absarc(x, y, r, 0, Math.PI * 2, true);
  return p;
}
function sectionShape(sh: THREE.Shape, s0: number, s1: number) {
  const len = s1 - s0, b = 0.0012;
  const g = new THREE.ExtrudeGeometry(sh, { depth: len - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 16 });
  g.translate(0, 0, -s1 + b);
  return g;
}
