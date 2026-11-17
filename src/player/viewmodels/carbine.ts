/**
 * "Halvard K5" compact carbine (stage 3b §8.3) — original design: polymer lower with the breacher's pistol grip,
 * stamped steel upper with a full-length carry rail and folding iron sights, slotted flash hider, curved smoke-grey
 * 30-round magazine with a witness strip (the visible rounds follow the count), left-side charging handle that locks
 * back on the last round, side-folding skeleton stock (extended).
 *
 * Origin: top of the pistol grip (same grip, guard and trigger housing as the shotgun, so one firing-hand solve
 * fits both). Profiles in (s, t) = (toward muzzle, up); +X right; -Z muzzle.
 *
 * Draw calls (≤ 6): frame = gunmetal + polymer, charging handle (steel), trigger (steel), magazine = smoke + brass.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { M, Parts, rbox, cylZ, cylX, latheZ, tubeZ, shape, hole, profileX, sweep, prep, boxUV, type Station, type G } from '../geom';
import type { VmMats } from './mats';
import { SG_GRIP, SG_GUARD, SG_GUARD_HOLE, SG_HOUSING } from './shotgun';
import { prismX, boxSdf, cylSdf, union, type Sdf } from './grip';

/** Bore height above the grip origin. */
export const C_BORE = 0.047;
/** Muzzle distance (s) from the origin. */
export const C_MUZZLE = 0.497;
/** Charging handle travel (m, rearward along +Z). */
export const CH_TRAVEL = 0.07;
/** Charging handle rest position (gun space): left face of the upper, forward end of its slot. */
export const CH_POS = new THREE.Vector3(-0.0165, 0.057, -0.178);
/** Magazine origin (top centre) in the well, gun space. */
export const MAG_SEAT = new THREE.Vector3(0, -0.002, -0.114);
/** Magazine length (top → baseplate) along its curve. */
export const MAG_LEN = 0.168;
const UW = 0.032; // upper width
const LW = 0.030; // lower width
const RAIL_T = 0.071;

const LOWER_PTS = [[-0.036, 0.029], [0.172, 0.029], [0.175, 0.006, 0.004], [0.152, 0.004, 0.003], [0.148, -0.034, 0.003], [0.08, -0.034, 0.003], [0.078, -0.012], [-0.012, -0.012], [-0.03, -0.002, 0.008]];
const UPPER_PTS = [[-0.045, 0.028], [0.205, 0.028], [0.205, 0.064, 0.003], [0.2, RAIL_T], [-0.035, RAIL_T], [-0.045, 0.062, 0.004]];

/** Curved magazine centre-line shift toward the muzzle at depth t (≤ 0) below the top. */
export function magShift(t: number) { const u = Math.min(1, Math.max(0, -t / MAG_LEN)); return 0.036 * u * u + 0.006 * u; }
const MAG_HALF = 0.0285; // half depth (front-to-back)
const MAG_W = 0.0225;

/** Side outline of the magazine body in its own (s, t): top at t = 0, curving forward as it goes down. */
function magOutline(): number[][] {
  const front: number[][] = [], back: number[][] = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = -0.004 - (MAG_LEN - 0.016) * (i / N);
    const sh = magShift(t);
    front.push([sh + MAG_HALF, t]);
    back.push([sh - MAG_HALF, t]);
  }
  return [[MAG_HALF - 0.004, 0], ...front, ...back.reverse(), [-MAG_HALF + 0.002, 0]];
}

/** Collision proxy of the magazine in its own space (origin = top centre, body along -Y). */
export function carbineMagProxy(): Sdf {
  return union([prismX(magOutline(), MAG_W / 2, [], 0.002), prismX(baseOutline(), MAG_W / 2 + 0.0015, [], 0.002)]);
}
function baseOutline(): number[][] {
  const t0 = -(MAG_LEN - 0.014), t1 = -MAG_LEN;
  const s0 = magShift(t0), s1 = magShift(t1);
  return [[s0 + MAG_HALF + 0.002, t0], [s1 + MAG_HALF + 0.004, t1 + 0.002], [s1 - MAG_HALF - 0.001, t1], [s0 - MAG_HALF - 0.0015, t0]];
}

export interface CarbineMag {
  root: THREE.Group;
  /** Show `n` rounds: the top cartridge in the lips and the witness strip filling from the top. */
  setRounds(n: number): void;
}

/** Ticks in the witness strip (2 rounds each). */
const TICKS = 15;

export function buildCarbineMag(m: VmMats): CarbineMag {
  const root = new THREE.Group();
  root.name = 'carbine_mag';
  const p = new Parts();
  p.add(profileX(shape(magOutline()), MAG_W, 0.0014, 0, 6, 2), m.smoke);
  // feed lips + the rib band below them
  for (const sx of [-1, 1]) p.add(rbox(0.004, 0.005, 0.034, 0.0012), m.smoke, M(sx * 0.0072, 0.0012, -0.004));
  p.add(rbox(MAG_W + 0.0016, 0.006, 2 * MAG_HALF + 0.0012, 0.0015), m.smoke, M(0, -0.03, -magShift(-0.03)));
  p.add(rbox(MAG_W + 0.0016, 0.004, 2 * MAG_HALF + 0.0012, 0.0013), m.smoke, M(0, -0.039, -magShift(-0.039)));
  // baseplate with its pull tab
  p.add(profileX(shape(baseOutline()), MAG_W + 0.003, 0.0012), m.smoke);
  // witness strip frame (left side): a narrow raised window along the back third
  {
    const t0 = -0.016, t1 = -0.152;
    const pts: number[][] = [];
    for (let i = 0; i <= 6; i++) { const t = t0 + (t1 - t0) * (i / 6); pts.push([magShift(t) - 0.0155, t]); }
    for (let i = 6; i >= 0; i--) { const t = t0 + (t1 - t0) * (i / 6); pts.push([magShift(t) - 0.0035, t]); }
    const outer = shape(pts, 0.0015);
    const inner: number[][] = [];
    for (let i = 0; i <= 6; i++) { const t = t0 - 0.002 + (t1 - t0 + 0.004) * (i / 6); inner.push([magShift(t) - 0.0138, t]); }
    for (let i = 6; i >= 0; i--) { const t = t0 - 0.002 + (t1 - t0 + 0.004) * (i / 6); inner.push([magShift(t) - 0.0052, t]); }
    outer.holes.push(hole(inner));
    p.add(profileX(outer, 0.0012, 0.0003, -MAG_W / 2 - 0.0002, 4, 1), m.smoke);
  }
  p.build(root);

  // brass: the top round first, then the witness-strip ticks top → bottom (draw range = rounds shown)
  const parts: G[] = [];
  const round = latheZ([
    [[0.0, -0.0225], [0.0047, -0.0225]], [[0.0047, -0.0225], [0.0047, 0.012]], [[0.0047, 0.012], [0.0029, 0.016], [0.0029, 0.0205]],
    [[0.0029, 0.0205], [0.0028, 0.0245], [0.0019, 0.0295], [0.0005, 0.0325], [0.0, 0.033]],
  ], 12);
  parts.push(prep(round, M(0.0, 0.004, -0.004)));
  const topCount = parts[0].getAttribute('position').count;
  const tick = rbox(0.0011, 0.0052, 0.0075, 0.0008, 1);
  let tickCount = 0;
  for (let i = 0; i < TICKS; i++) {
    const t = -0.022 - i * 0.0087;
    const g = prep(tick, M(-MAG_W / 2 - 0.0001, t, -(magShift(t) - 0.0095)));
    tickCount = g.getAttribute('position').count;
    parts.push(g);
  }
  const brassGeo = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  boxUV(brassGeo);
  brassGeo.computeBoundingSphere();
  const brass = new THREE.Mesh(brassGeo, m.brass);
  brass.name = 'brass';
  root.add(brass);
  const setRounds = (n: number) => {
    n = Math.max(0, Math.round(n));
    const ticks = Math.min(TICKS, Math.ceil(Math.max(0, n - 1) / 2));
    brassGeo.setDrawRange(0, n > 0 ? topCount + ticks * tickCount : 0);
  };
  setRounds(30);
  return { root, setRounds };
}

/** Collision proxy of the carbine in gun space (for the grip solver). */
export function carbineProxy(): Sdf {
  return union([
    prismX(SG_GRIP, 0.0158, [], 0.005),
    prismX(SG_HOUSING, 0.013, [], 0.001),
    prismX(SG_GUARD, 0.0063, [SG_GUARD_HOLE], 0.001),
    boxSdf(0, -0.021, -0.0505, 0.003, 0.0125, 0.0035, 0.001), // trigger
    prismX(LOWER_PTS, LW / 2, [], 0.002),
    prismX(UPPER_PTS, UW / 2, [], 0.002),
    boxSdf(0, RAIL_T + 0.004, -0.15, 0.011, 0.004, 0.18, 0.001), // rail
    boxSdf(0, C_BORE - 0.003, -0.27, 0.0228, 0.026, 0.072, 0.012), // handguard
    cylSdf(0, C_BORE, -C_MUZZLE, -0.335, 0.0105),
    boxSdf(CH_POS.x - 0.012, CH_POS.y, CH_POS.z, 0.012, 0.005, 0.006, 0.002), // charging handle
  ]);
}

export interface CarbineModel {
  root: THREE.Group;
  /** Charging handle (moves along +Z, 0 … CH_TRAVEL). */
  charger: THREE.Group;
  /** Grip point on the charging handle's knob (child of `charger`). */
  chargerKnob: THREE.Object3D;
  trigger: THREE.Group;
  /** Magazine socket (mag origin = top centre, axis -Y). */
  magWell: THREE.Object3D;
  mag: CarbineMag;
  muzzle: THREE.Object3D;
  ejectPort: THREE.Object3D;
}

export function buildCarbine(m: VmMats): CarbineModel {
  const root = new THREE.Group();
  root.name = 'carbine';
  const p = new Parts();

  // ─────────────── lower (polymer): receiver, mag well, grip, guard, trigger housing
  p.add(profileX(shape(LOWER_PTS), LW, 0.0022, 0, 10, 3), m.polymer);
  p.add(profileX(shape(SG_HOUSING.map((v) => [v[0], v[1], 0.003])), 0.026, 0.0016), m.polymer);
  const guard = shape(SG_GUARD);
  guard.holes.push(hole(SG_GUARD_HOLE));
  p.add(profileX(guard, 0.0125, 0.0018, 0, 12, 2), m.polymer);
  p.add(profileX(shape(SG_GRIP), 0.031, 0.0035, 0, 14, 3), m.polymer);
  // grip: finger grooves on the front strap, a palm swell panel each side
  for (let i = 0; i < 3; i++) p.add(rbox(0.026, 0.0028, 0.006, 0.0012), m.polymer, M(0, -0.04 - i * 0.02, 0.0005 + i * 0.0072 - 0.004, 0.42, 0, 0));
  for (const sx of [-1, 1]) p.add(profileX(shape([[-0.004, -0.03, 0.006], [-0.014, -0.066, 0.012], [-0.052, -0.066, 0.006], [-0.042, -0.03, 0.006]]), 0.002, 0.0006, sx * 0.0158), m.polymer);
  // mag well: flared mouth + the release paddle behind it
  p.add(profileX(shape([[0.078, -0.03, 0.002], [0.075, -0.039, 0.002], [0.153, -0.039, 0.002], [0.15, -0.03, 0.002]]), LW + 0.004, 0.0012), m.polymer);
  p.add(rbox(0.026, 0.006, 0.0035, 0.0012), m.polymer, M(0, -0.017, -0.0765));
  // takedown pins (steel-look via gunmetal) + the lower's moulded seam
  for (const [s, t] of [[-0.022, 0.016], [0.16, 0.017]] as const) p.add(cylX(0.0022, LW + 0.0016, 12), m.gunmetal, M(0, t, -s));
  // selector (left, above the grip): lever + its dial
  p.add(cylX(0.0058, 0.0018, 16), m.gunmetal, M(-LW / 2 - 0.0007, 0.0125, -0.006));
  p.add(rbox(0.0024, 0.0034, 0.015, 0.0009), m.gunmetal, M(-LW / 2 - 0.0016, 0.0125, -0.0115, 0.35, 0, 0));

  // ─────────────── upper (stamped steel): box with pressed ribs, ejection port, charging slot
  p.add(profileX(shape(UPPER_PTS), UW, 0.0016, 0, 8, 2), m.gunmetal);
  for (const sx of [-1, 1]) {
    // pressed reinforcement ribs + spot welds
    p.add(rbox(0.0012, 0.004, 0.2, 0.0006), m.gunmetal, M(sx * (UW / 2 + 0.0004), 0.034, -0.08));
    for (let i = 0; i < 6; i++) p.add(cylX(0.0014, 0.0008, 8), m.gunmetal, M(sx * (UW / 2 + 0.0005), 0.0645, 0.03 - i * 0.04));
  }
  // ejection port (right): dark recess with the bolt face just visible
  p.add(rbox(0.0024, 0.016, 0.052, 0.001), m.polymer, M(UW / 2 + 0.0002, 0.049, -0.065));
  p.add(rbox(0.002, 0.008, 0.016, 0.0008), m.gunmetal, M(UW / 2 + 0.0004, 0.049, -0.048));
  // charging slot (left): a dark channel the handle runs in
  p.add(rbox(0.002, 0.0062, 0.09, 0.0012), m.polymer, M(-UW / 2 - 0.0002, CH_POS.y, CH_POS.z + 0.04));
  // carry rail along the top, with cross slots
  p.add(rbox(0.016, 0.006, 0.36, 0.0012), m.gunmetal, M(0, RAIL_T + 0.003, -0.145));
  for (let i = 0; i < 26; i++) p.add(rbox(0.021, 0.0034, 0.0064, 0.0008), m.gunmetal, M(0, RAIL_T + 0.0072, 0.022 - i * 0.0128));
  // rear sight: block with protective ears and an aperture ring
  p.add(rbox(0.021, 0.008, 0.02, 0.0016), m.gunmetal, M(0, RAIL_T + 0.013, 0.004));
  for (const sx of [-1, 1]) p.add(profileX(shape([[-0.013, 0.0, 0.001], [0.004, 0.0, 0.001], [0.0, 0.016, 0.003], [-0.008, 0.016, 0.002]]), 0.0028, 0.0007, sx * 0.0088), m.gunmetal, M(0, RAIL_T + 0.015, 0));
  p.add(new THREE.TorusGeometry(0.0042, 0.0015, 8, 20), m.gunmetal, M(0, RAIL_T + 0.0245, -0.002));
  p.add(rbox(0.004, 0.006, 0.0024, 0.0008), m.gunmetal, M(0, RAIL_T + 0.018, -0.002));
  // front sight: post between ears on the rail's end
  p.add(rbox(0.02, 0.008, 0.026, 0.0016), m.gunmetal, M(0, RAIL_T + 0.013, -0.315));
  for (const sx of [-1, 1]) p.add(profileX(shape([[0.305, 0.0, 0.001], [0.325, 0.0, 0.001], [0.32, 0.019, 0.004], [0.31, 0.019, 0.003]]), 0.0026, 0.0007, sx * 0.0085), m.gunmetal, M(0, RAIL_T + 0.015, 0));
  p.add(profileX(shape([[0.312, 0.0, 0.0005], [0.319, 0.0, 0.0005], [0.3175, 0.0165, 0.0006], [0.3135, 0.0165, 0.0006]]), 0.0026, 0.0005), m.gunmetal, M(0, RAIL_T + 0.015, 0));

  // ─────────────── handguard (polymer) with vents and finger ribs
  {
    const st: Station[] = [];
    const z0 = -0.34, z1 = -0.205;
    st.push({ z: z0, w: 0.019, h: 0.022, n: 3, y: C_BORE - 0.003 });
    st.push({ z: z0 + 0.004, w: 0.0228, h: 0.026, n: 3.2, y: C_BORE - 0.003 });
    st.push({ z: z1 - 0.006, w: 0.0228, h: 0.026, n: 3.2, y: C_BORE - 0.003 });
    st.push({ z: z1, w: 0.0205, h: 0.024, n: 3, y: C_BORE - 0.002 });
    p.add(sweep(st, 28), m.polymer);
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) p.add(rbox(0.0016, 0.007, 0.018, 0.0028, 2), m.gunmetal, M(sx * 0.0222, C_BORE + 0.004, -0.235 - i * 0.026));
    for (let i = 0; i < 7; i++) p.add(rbox(0.03, 0.0018, 0.004, 0.0008), m.polymer, M(0, C_BORE - 0.0285, -0.228 - i * 0.015));
    // sling loop under the front
    p.add(new THREE.TorusGeometry(0.0055, 0.0014, 8, 16), m.gunmetal, M(0, C_BORE - 0.034, -0.33, 0, Math.PI / 2, 0));
  }

  // ─────────────── barrel, gas block, slotted flash hider
  p.add(latheZ([[[0.0082, 0.335], [0.0082, 0.447]]], 24), m.gunmetal, M(0, C_BORE, 0));
  p.add(rbox(0.022, 0.03, 0.02, 0.003), m.gunmetal, M(0, C_BORE + 0.009, -0.352));
  p.add(cylX(0.0018, 0.024, 10), m.gunmetal, M(0, C_BORE + 0.012, -0.352));
  {
    const R = 0.0108, s0 = 0.445, s1 = C_MUZZLE;
    p.add(tubeZ(R, 0.0052, s0 + 0.004, s1, 24), m.gunmetal, M(0, C_BORE, 0));
    p.add(latheZ([[[0.0082, s0], [R + 0.0006, s0 + 0.002], [R + 0.0006, s0 + 0.005]]], 24), m.gunmetal, M(0, C_BORE, 0));
    // five slots, the bottom left closed (no dust kicked up when prone)
    for (const a of [0, 1.25, -1.25, 2.5, -2.5]) {
      p.add(rbox(0.0026, 0.0012, 0.032, 0.0011, 1), m.polymer, M(Math.sin(a) * (R - 0.0001), C_BORE + Math.cos(a) * (R - 0.0001), -(s1 - 0.018), 0, 0, -a));
    }
  }

  // ─────────────── side-folding skeleton stock (extended): hinge block, two struts, butt plate
  p.add(rbox(0.03, 0.064, 0.016, 0.004), m.gunmetal, M(0, 0.03, 0.052));
  p.add(cylY(0.0055, 0.06), m.gunmetal, M(0.0165, 0.03, 0.056));
  {
    const strut = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const d = b.clone().sub(a), len = d.length();
      const g = cylZ(r, len, 14);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), d.normalize());
      p.add(g, m.gunmetal, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    };
    strut(new THREE.Vector3(0, 0.054, 0.058), new THREE.Vector3(0, 0.022, 0.288), 0.0074);
    strut(new THREE.Vector3(0, 0.006, 0.058), new THREE.Vector3(0, -0.088, 0.27), 0.0064);
    // cheek pad clamped on the top strut
    const d = Math.atan2(0.032, 0.23);
    p.add(rbox(0.026, 0.016, 0.085, 0.006), m.polymer, M(0, 0.036, 0.19, -d, 0, 0));
  }
  p.add(profileX(shape([[-0.28, 0.038, 0.008], [-0.296, 0.038, 0.006], [-0.298, -0.118, 0.006], [-0.278, -0.118, 0.008], [-0.268, -0.09, 0.01], [-0.274, 0.008, 0.01]]), 0.034, 0.004, 0, 8, 2), m.polymer);
  for (let i = 0; i < 8; i++) p.add(rbox(0.035, 0.0022, 0.008, 0.0009), m.polymer, M(0, 0.024 - i * 0.019, 0.297));

  const frame = new THREE.Group();
  p.build(frame);
  root.add(frame);

  // ─────────────── charging handle (left): stem out of the slot, folding knob
  const charger = new THREE.Group();
  charger.position.copy(CH_POS);
  const cp = new Parts();
  cp.add(rbox(0.012, 0.0048, 0.009, 0.0014), m.steel, M(-0.005, 0, 0));
  cp.add(cylX(0.0046, 0.016, 14), m.steel, M(-0.016, 0, 0));
  cp.add(latheZ([[[0.0046, 0.0], [0.0062, 0.002], [0.0062, 0.006], [0.0048, 0.0085], [0.0, 0.009]]], 16), m.steel, M(-0.024, 0, 0, 0, Math.PI / 2, 0));
  for (let i = 0; i < 4; i++) cp.add(rbox(0.0012, 0.0098, 0.0012, 0.0004), m.steel, M(-0.0175 - i * 0.002, 0, -0.0046));
  cp.build(charger);
  const chargerKnob = new THREE.Object3D();
  chargerKnob.position.set(-0.024, 0, 0);
  charger.add(chargerKnob);
  root.add(charger);

  // ─────────────── trigger (pivot at top), same as the breacher's
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.009, -0.05);
  const tp = new Parts();
  tp.add(profileX(shape([[0.003, 0.002], [0.0042, -0.008, 0.004], [0.002, -0.019, 0.006], [-0.0025, -0.0245, 0.0015], [-0.0045, -0.0225, 0.0015], [-0.0007, -0.014, 0.006], [-0.0026, -0.004, 0.003], [-0.0024, 0.002]]), 0.006, 0.0013), m.steel);
  tp.build(trigger);
  root.add(trigger);

  // ─────────────── magazine
  const magWell = new THREE.Object3D();
  magWell.position.copy(MAG_SEAT);
  root.add(magWell);
  const mag = buildCarbineMag(m);
  magWell.add(mag.root);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, C_BORE, -C_MUZZLE - 0.004);
  root.add(muzzle);
  const ejectPort = new THREE.Object3D();
  ejectPort.position.set(UW / 2 + 0.004, 0.05, -0.062);
  root.add(ejectPort);

  return { root, charger, chargerKnob, trigger, magWell, mag, muzzle, ejectPort };
}

/** Fired rifle casing (bottlenecked, open mouth), +Y toward the mouth. */
export function buildRifleCasingGeo(): G {
  const g = latheZ([
    [[0.0, 0.0], [0.0048, 0.0]],
    [[0.0048, 0.0], [0.0048, 0.0013]],
    [[0.0048, 0.0013], [0.0039, 0.0018], [0.0039, 0.003], [0.0048, 0.0036]],
    [[0.0048, 0.0036], [0.0046, 0.031], [0.0032, 0.035], [0.0032, 0.0405]],
    [[0.0032, 0.0405], [0.0028, 0.0405]],
    [[0.0028, 0.0405], [0.0028, 0.034], [0.0042, 0.03], [0.0042, 0.005]],
    [[0.0042, 0.005], [0.0, 0.005]],
  ], 12);
  g.rotateX(Math.PI / 2);
  return g;
}

const cylY = (r: number, len: number, seg = 12) => new THREE.CylinderGeometry(r, r, len, seg);
