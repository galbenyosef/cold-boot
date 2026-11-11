/**
 * "VK-12" service pistol — hammer-fired, steel frame, 12-round single-stack-ish magazine.
 * Gun origin: top of the grip under the rear of the slide. +X right, +Y up, -Z muzzle.
 * Profiles are authored as (s, t) = (distance toward muzzle, height).
 */
import * as THREE from 'three';
import { M, Parts, rbox, cylZ, cylX, latheZ, tubeZ, shape, hole, profileX, sectionZ, inPoly, sphere, type G } from '../geom';
import type { VmMats } from './mats';
import { prismX, boxSdf, union, type Sdf } from './grip';

export interface PistolModel {
  root: THREE.Group;
  slide: THREE.Group;
  hammer: THREE.Group;
  trigger: THREE.Group;
  slideStop: THREE.Group;
  /** Mag-well socket (mag origin = top centre, axis -Y). */
  magWell: THREE.Object3D;
  mag: THREE.Group;
  muzzle: THREE.Object3D;
  ejectPort: THREE.Object3D;
}

export const P_BORE = 0.0185;
export const P_MUZZLE_S = 0.169;
export const P_GRIP_ANGLE = 0.28;

const W = 0.0245;   // slide width
const H = 0.031;    // slide height
const CH = 0.0048;  // slide top chamfer

function slideOutline(w: number, h = H, ch = CH): number[][] {
  return [[-w / 2, 0.0005, 0.0006], [w / 2, 0.0005, 0.0006], [w / 2, h - ch, 0.0012], [w / 2 - ch, h, 0.0015], [-w / 2 + ch, h, 0.0015], [-w / 2, h - ch, 0.0012]];
}

const GRIP_PTS = [[0.017, -0.009], [0.0145, -0.028, 0.008], [0.004, -0.062, 0.03], [-0.004, -0.097, 0.02], [-0.0115, -0.1135, 0.004], [-0.0595, -0.1075, 0.004], [-0.0535, -0.068, 0.04], [-0.0375, -0.021, 0.008], [-0.0405, -0.0075, 0.004], [-0.0545, -0.0018, 0.0035], [-0.047, 0.0042, 0.003], [-0.03, -0.0008, 0.002], [0.0, -0.004]];
const FRAME_PTS = [[-0.030, 0.0005], [0.161, 0.0005, 0.001], [0.1635, -0.005, 0.002], [0.159, -0.0168, 0.0025], [0.058, -0.0168], [0.05, -0.0142, 0.004], [0.012, -0.0142], [-0.031, -0.009, 0.003]];
const GUARD_PTS = [[0.012, -0.0125], [0.0715, -0.0135, 0.002], [0.0755, -0.020, 0.004], [0.0745, -0.0405, 0.009], [0.0605, -0.0468, 0.005], [0.0185, -0.0452, 0.008], [0.0075, -0.0405, 0.004]];
const GUARD_HOLE = [[0.0175, -0.016], [0.0675, -0.0168, 0.003], [0.0695, -0.0215, 0.003], [0.0688, -0.0385, 0.008], [0.0585, -0.0418, 0.004], [0.0215, -0.0408, 0.008]];

/** Collision proxy of the pistol in gun space (for the grip solver). */
export function pistolProxy(): Sdf {
  return union([
    prismX(GRIP_PTS, 0.0164, [], 0.004),
    prismX(FRAME_PTS, 0.0118, [], 0.001),
    prismX(GUARD_PTS, 0.006, [GUARD_HOLE], 0.001),
    boxSdf(0, 0.0158, -0.07, 0.01235, 0.0155, 0.099, 0.002), // slide
    boxSdf(0, -0.0195, -0.119, 0.0103, 0.0035, 0.034, 0.001), // rail
    boxSdf(0, -0.026, -0.0465, 0.003, 0.012, 0.0035, 0.001), // trigger
    boxSdf(0, 0.016, 0.037, 0.0036, 0.013, 0.009, 0.002), // hammer
    boxSdf(-0.0145, -0.003, 0.0275, 0.0012, 0.004, 0.008, 0.001), // safety lever
  ]);
}

/** Collision proxy of a magazine in its own space (origin = top centre, body along -Y). */
export function magProxy(): Sdf {
  return union([boxSdf(0, -0.052, 0, 0.0103, 0.052, 0.0155, 0.002), boxSdf(0, -0.1075, 0.0015, 0.0131, 0.0055, 0.0205, 0.002)]);
}

export function buildMagazine(m: VmMats, withRound = true): THREE.Group {
  const g = new THREE.Group();
  const p = new Parts();
  // body: slightly tapered steel box, rounded front spine
  const body = profileX(shape([[0.0155, -0.003, 0.002], [0.0155, -0.104, 0.0], [-0.0155, -0.104, 0.0], [-0.0155, -0.006, 0.003], [-0.01, -0.0005, 0.002], [0.008, -0.0005, 0.002]]), 0.0205, 0.0012);
  p.add(body, m.gunmetal);
  // feed lips
  p.add(rbox(0.0035, 0.004, 0.022, 0.001), m.gunmetal, M(-0.0075, 0.001, 0.002));
  p.add(rbox(0.0035, 0.004, 0.022, 0.001), m.gunmetal, M(0.0075, 0.001, 0.002));
  // witness holes (left + right) — dark inserts with brass glint behind
  for (let i = 0; i < 5; i++) {
    for (const sx of [-1, 1]) p.add(cylX(0.0016, 0.0012, 10), m.interior, M(sx * 0.0101, -0.03 - i * 0.013, 0.006));
  }
  // polymer baseplate with finger shelf
  p.add(profileX(shape([[0.020, 0.0, 0.002], [0.022, -0.006, 0.003], [0.016, -0.0105, 0.003], [-0.019, -0.0105, 0.003], [-0.019, 0.0, 0.002]]), 0.0262, 0.0015), m.polymer, M(0, -0.102, 0));
  p.add(rbox(0.012, 0.0012, 0.02, 0.0005), m.gloveArmor, M(0, -0.1125, 0.001));
  if (withRound) {
    // follower + top cartridge (brass + copper jacket)
    p.add(rbox(0.012, 0.003, 0.026, 0.001), m.polymer, M(0, -0.0045, 0.0));
    p.add(latheZ([[[0.0, -0.011], [0.0049, -0.011]], [[0.0049, -0.011], [0.0049, 0.0075]], [[0.0049, 0.0075], [0.0045, 0.008]]], 16), m.brass, M(0, 0.0005, 0.0));
    p.add(latheZ([[[0.0045, 0.008], [0.0045, 0.0115], [0.0036, 0.0152], [0.0018, 0.0172], [0.0, 0.0176]]], 16), m.copper, M(0, 0.0005, 0.0));
  }
  p.build(g);
  return g;
}

export function buildPistol(m: VmMats, opts: { detail?: boolean } = {}): PistolModel {
  const detail = opts.detail !== false;
  const root = new THREE.Group();
  root.name = 'pistol';

  // ─────────────── slide (moves along +Z when cycling)
  const slide = new THREE.Group();
  root.add(slide);
  const sp = new Parts();
  const outline = shape(slideOutline(W));
  const narrow = shape(slideOutline(W - 0.0014, H - 0.0006, CH - 0.0003));
  // rear section with serration zone
  sp.add(sectionZ(outline, -0.029, -0.026, 0.0012), m.gunmetal);
  sp.add(sectionZ(narrow, -0.0265, 0.005, 0.0002), m.gunmetal);
  sp.add(sectionZ(outline, 0.0045, 0.0155, 0.0003), m.gunmetal);
  // ejection-port section: left wall + top-left, and right lower strip (hollow ∩)
  const t = 0.0032;
  const portL = shape([[-W / 2, 0.0005], [-W / 2 + t, 0.0005], [-W / 2 + t, H - t], [-0.0042, H - t], [-0.0042, H, 0.0004], [-W / 2 + CH, H, 0.0015], [-W / 2, H - CH, 0.0012]]);
  const portR = shape([[W / 2 - t, 0.0005], [W / 2, 0.0005], [W / 2, 0.0115, 0.0005], [W / 2 - t, 0.0115]]);
  sp.add(sectionZ(portL, 0.015, 0.0475, 0.0003), m.gunmetal);
  sp.add(sectionZ(portR, 0.015, 0.0475, 0.0003), m.gunmetal);
  // dark interior behind/below the port
  sp.add(rbox(W - 2 * t, 0.012, 0.034, 0.0005), m.interior, M(0, 0.006, -0.031));
  sp.add(rbox(W - 0.004, 0.02, 0.0015, 0.0004), m.interior, M(0, 0.017, -0.0155));
  // forward body + front serrations + nose
  sp.add(sectionZ(outline, 0.047, 0.121, 0.0003), m.gunmetal);
  sp.add(sectionZ(narrow, 0.1205, 0.147, 0.0002), m.gunmetal);
  const nose = shape(slideOutline(W - 0.0004, H - 0.0004, CH + 0.0008));
  nose.holes.push(holeCircle(0, P_BORE, 0.0074));
  sp.add(sectionZ(outline, 0.1465, 0.163, 0.0003), m.gunmetal);
  sp.add(sectionZ(nose, 0.1625, 0.1685, 0.0016), m.gunmetal);
  // slanted serrations: raised ridges that read as cuts in the narrowed zone
  const ridge = rbox(0.0009, 0.0215, 0.0021, 0.0004);
  const serr = (s0: number, n: number, step: number) => {
    for (let i = 0; i < n; i++) {
      const s = s0 + i * step;
      for (const sx of [-1, 1]) sp.add(ridge, m.gunmetal, M(sx * (W / 2 - 0.00045), 0.0128, -s, -0.26, 0, 0));
    }
  };
  serr(-0.0235, 9, 0.0032);
  serr(0.1235, 7, 0.0033);
  // flat anti-glare rib with fine grooves
  sp.add(rbox(0.0085, 0.0008, 0.098, 0.0003), m.gunmetal, M(0, H + 0.0002, -0.098));
  for (let i = 0; i < 3; i++) sp.add(box3(0.0007, 0.0003, 0.096), m.interior, M(-0.0024 + i * 0.0024, H + 0.0006, -0.098));
  // extractor (right side, behind the port)
  sp.add(rbox(0.0013, 0.0042, 0.0135, 0.0005), m.steel, M(W / 2 + 0.0002, 0.0205, -0.0075));
  sp.add(cylX(0.0011, 0.0012, 8), m.steel, M(W / 2 + 0.0006, 0.0205, -0.002));
  // firing pin plate on rear face
  sp.add(rbox(0.011, 0.013, 0.0012, 0.0006), m.gunmetal, M(0, 0.017, 0.0293));
  sp.add(cylZ(0.0012, 0.0008, 10), m.interior, M(0, P_BORE, 0.0302));
  // rear sight: dovetail base + two posts, tritium dots
  sp.add(rbox(0.0232, 0.003, 0.010, 0.0008), m.gunmetal, M(0, H + 0.0012, 0.0175));
  for (const sx of [-1, 1]) {
    sp.add(profileX(shape([[-0.023, 0.0, 0.0006], [-0.012, 0.0, 0.0006], [-0.0128, 0.0068, 0.0008], [-0.0215, 0.0068, 0.0008]]), 0.0082, 0.0007, sx * 0.0069), m.gunmetal, M(0, H + 0.001, 0));
    sp.add(cylZ(0.00175, 0.0004, 14), m.white, M(sx * 0.0069, H + 0.0052, 0.0231));
    sp.add(cylZ(0.00105, 0.0006, 12), m.emGreen, M(sx * 0.0069, H + 0.0052, 0.0233));
  }
  // front sight post + dot
  sp.add(profileX(shape([[0.151, 0.0, 0.0005], [0.161, 0.0, 0.0005], [0.1598, 0.0066, 0.0006], [0.1535, 0.0066, 0.0006]]), 0.0036, 0.0005), m.gunmetal, M(0, H + 0.0005, 0));
  sp.add(cylZ(0.00165, 0.0004, 14), m.white, M(0, H + 0.0046, -0.1533));
  sp.add(cylZ(0.001, 0.0006, 12), m.emGreen, M(0, H + 0.0046, -0.1531));
  if (detail) {
    // engraved-looking slide flats: thin inset lines (left side visible to the player)
    sp.add(box3(0.0003, 0.0006, 0.06), m.interior, M(-W / 2 - 0.0001, 0.0075, -0.085));
    sp.add(box3(0.0003, 0.0006, 0.026), m.interior, M(-W / 2 - 0.0001, 0.0092, -0.085));
    // cocking "ears" at the rear
    for (const sx of [-1, 1]) sp.add(rbox(0.0018, 0.012, 0.006, 0.0007), m.gunmetal, M(sx * (W / 2 + 0.0004), 0.009, 0.026));
  }
  sp.build(slide);

  // ─────────────── barrel (frame-mounted; the hood shows through the port as the slide cycles)
  const bp = new Parts();
  bp.add(rbox(0.0146, 0.0108, 0.0335, 0.0012), m.steel, M(0, 0.0236, -0.031));
  bp.add(rbox(0.0146, 0.001, 0.028, 0.0004), m.interior, M(0, 0.0291, -0.031)); // engraving line
  bp.add(tubeZ(0.0068, 0.0046, 0.046, 0.1668, 28), m.steel, M(0, P_BORE, 0));
  bp.add(latheZ([[[0.0046, 0.1669], [0.0, 0.1669]]], 16), m.interior, M(0, P_BORE, 0.012));
  // guide rod + recoil spring plug under the barrel
  bp.add(cylZ(0.0042, 0.012, 16), m.gunmetal, M(0, 0.0058, -0.1605));
  bp.add(cylZ(0.0024, 0.002, 12), m.steel, M(0, 0.0058, -0.1675));
  const barrel = new THREE.Group();
  bp.build(barrel);
  root.add(barrel);

  // ─────────────── frame
  const fp = new Parts();
  // upper frame + dust cover
  fp.add(profileX(shape(FRAME_PTS), 0.0232, 0.0012), m.gunmetal);
  // frame-to-slide rail line (dark gap)
  fp.add(box3(0.0236, 0.0009, 0.188), m.interior, M(0, 0.0004, -0.065));
  // grip
  const gripPts = GRIP_PTS;
  fp.add(profileX(shape(gripPts), 0.0292, 0.0028, 0, 14, 3), m.gunmetal);
  // mag well flare
  fp.add(profileX(shape([[-0.0105, -0.104, 0.002], [-0.0118, -0.1135, 0.001], [-0.0598, -0.1078, 0.001], [-0.058, -0.0985, 0.002]]), 0.0318, 0.0014), m.gunmetal);
  // trigger guard (with hole), squared front with a hook
  const tg = shape(GUARD_PTS);
  tg.holes.push(hole(GUARD_HOLE));
  fp.add(profileX(tg, 0.0118, 0.0016, 0, 12, 2), m.gunmetal);
  // trigger guard front serrations
  for (let i = 0; i < 6; i++) fp.add(rbox(0.0098, 0.0011, 0.0018, 0.0004), m.gunmetal, M(0, -0.0225 - i * 0.0028, -0.0756, 0, 0, 0));
  // accessory rail under the dust cover
  fp.add(rbox(0.0162, 0.0032, 0.068, 0.0006), m.gunmetal, M(0, -0.0182, -0.119));
  for (let i = 0; i < 5; i++) fp.add(rbox(0.0205, 0.0032, 0.0062, 0.0008), m.gunmetal, M(0, -0.0208, -0.093 - i * 0.0128));
  // front strap checkering (horizontal ridges following the strap)
  for (let i = 0; i < 15; i++) {
    const tt = -0.033 - i * 0.0042;
    const s = lerpStrap(tt);
    fp.add(rbox(0.021, 0.0016, 0.0024, 0.0006), m.gunmetal, M(0, tt, -s + 0.0008, P_GRIP_ANGLE * 0.9, 0, 0));
  }
  // back strap texture
  for (let i = 0; i < 12; i++) {
    const tt = -0.03 - i * 0.0055;
    const s = -0.0375 + (tt + 0.021) * 0.33 - Math.sin(((tt + 0.021) / -0.087) * Math.PI) * 0.0045;
    fp.add(rbox(0.018, 0.0018, 0.0022, 0.0006), m.gunmetal, M(0, tt, -s - 0.0006, P_GRIP_ANGLE, 0, 0));
  }
  // grip panels (rubber) with stippling + screws
  const panel = [[0.0055, -0.029, 0.006], [-0.0035, -0.068, 0.02], [-0.0095, -0.097, 0.006], [-0.0505, -0.0925, 0.006], [-0.0465, -0.062, 0.02], [-0.0335, -0.03, 0.006]];
  const panelShape = shape(panel);
  for (const sx of [-1, 1]) {
    fp.add(profileX(panelShape, 0.0026, 0.0009, sx * 0.0153, 12, 2), m.rubber);
  }
  if (detail) {
    const cone = new THREE.ConeGeometry(0.00095, 0.0009, 4, 1, true);
    const inner = [[0.0025, -0.033], [-0.0058, -0.068], [-0.011, -0.093], [-0.0475, -0.089], [-0.0435, -0.062], [-0.0315, -0.033]];
    let k = 0;
    for (let tt = -0.031; tt > -0.096; tt -= 0.0026) {
      k++;
      for (let s = 0.006 + (k % 2) * 0.0013; s > -0.052; s -= 0.0026) {
        if (!inPoly(s, tt, inner)) continue;
        for (const sx of [-1, 1]) fp.add(cone, m.rubber, M(sx * 0.01655, tt, -s, 0, 0, -sx * Math.PI / 2));
      }
    }
    for (const sx of [-1, 1]) {
      for (const [s, tt] of [[-0.012, -0.036], [-0.026, -0.086]]) {
        fp.add(cylX(0.0022, 0.0012, 14), m.steel, M(sx * 0.0168, tt, -s));
        fp.add(box3(0.0004, 0.0032, 0.0006), m.interior, M(sx * 0.0175, tt, -s));
      }
    }
  }
  // pins (both sides)
  for (const [s, tt] of [[0.046, -0.0105], [-0.0238, -0.0045], [-0.0105, -0.0098], [0.096, -0.010]]) {
    fp.add(cylX(0.0016, 0.0246, 10), m.steel, M(0, tt, -s));
  }
  // mag release button (left), takedown lever (left), safety/decocker (left rear)
  fp.add(rbox(0.0032, 0.0085, 0.0095, 0.0012), m.polymer, M(-0.0152, -0.023, -0.0085, -0.2, 0, 0));
  for (let i = 0; i < 3; i++) fp.add(rbox(0.0008, 0.007, 0.0012, 0.0003), m.polymer, M(-0.0168, -0.023, -0.005 - i * 0.0028, -0.2, 0, 0));
  fp.add(profileX(shape([[0.052, -0.0035, 0.002], [0.064, -0.006, 0.002], [0.061, -0.0125, 0.002], [0.05, -0.011, 0.002]]), 0.0016, 0.0005, -0.0126), m.gunmetal);
  fp.add(profileX(shape([[-0.034, 0.0, 0.002], [-0.02, 0.0, 0.002], [-0.021, -0.0065, 0.0025], [-0.035, -0.0055, 0.002]]), 0.0017, 0.0005, -0.0127), m.gunmetal);
  for (let i = 0; i < 4; i++) fp.add(box3(0.0007, 0.0042, 0.0006), m.interior, M(-0.0137, -0.0028, 0.0225 + i * 0.0022));
  // lanyard loop at the bottom rear
  fp.add(new THREE.TorusGeometry(0.0036, 0.0011, 8, 16), m.steel, M(0, -0.108, 0.059, 0, Math.PI / 2, 0));
  const frame = new THREE.Group();
  fp.build(frame);
  root.add(frame);

  // ─────────────── slide stop (left side, rotates to lock the slide open)
  const slideStop = new THREE.Group();
  slideStop.position.set(-0.0128, -0.0065, -0.040);
  const ssp = new Parts();
  ssp.add(profileX(shape([[0.0, 0.0022, 0.002], [0.0028, -0.0028, 0.002], [-0.031, -0.0035, 0.002], [-0.036, 0.0, 0.002], [-0.034, 0.0098, 0.002], [-0.029, 0.0104, 0.002], [-0.024, 0.0035, 0.003]]), 0.0019, 0.0006), m.gunmetal);
  for (let i = 0; i < 4; i++) ssp.add(rbox(0.0009, 0.006, 0.0009, 0.0003), m.gunmetal, M(-0.0012, 0.003, 0.0275 + i * 0.002));
  ssp.add(cylX(0.0024, 0.0024, 14), m.steel, M(0.0006, 0, 0));
  ssp.build(slideStop);
  root.add(slideStop);

  // ─────────────── hammer (pivot), ring style
  const hammer = new THREE.Group();
  hammer.position.set(0, 0.0055, 0.0325);
  const hs = shape([[0.0032, -0.004, 0.002], [0.0036, 0.0105, 0.003], [-0.001, 0.0215, 0.003], [-0.0075, 0.0232, 0.003], [-0.0118, 0.0185, 0.003], [-0.0098, 0.0105, 0.003], [-0.004, -0.0005, 0.003], [-0.0022, -0.0055, 0.002]]);
  hs.holes.push(holeCircle(-0.0055, 0.0163, 0.0033));
  const hp = new Parts();
  hp.add(profileX(hs, 0.0068, 0.0009), m.gunmetal);
  for (let i = 0; i < 4; i++) hp.add(rbox(0.0072, 0.0008, 0.0014, 0.0003), m.gunmetal, M(0, 0.0182 + i * 0.0014, 0.0112 - i * 0.0006, -0.6 + i * 0.12, 0, 0));
  hp.build(hammer);
  root.add(hammer);

  // ─────────────── trigger (pivot at top)
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.0142, -0.046);
  const tp = new Parts();
  tp.add(profileX(shape([[0.0026, 0.002], [0.0038, -0.007, 0.004], [0.0018, -0.0182, 0.006], [-0.0024, -0.0238, 0.0015], [-0.0042, -0.0222, 0.0015], [-0.0006, -0.0138, 0.006], [-0.0024, -0.004, 0.003], [-0.0022, 0.002]]), 0.0056, 0.0012), m.gunmetal);
  for (let i = 0; i < 4; i++) tp.add(rbox(0.0052, 0.0006, 0.0008, 0.0002), m.gunmetal, M(0, -0.009 - i * 0.003, -0.0025 + (i > 1 ? 0.0012 * (i - 1) : 0)));
  tp.build(trigger);
  root.add(trigger);

  // ─────────────── magazine (separate: animated on reload)
  const magWell = new THREE.Object3D();
  magWell.position.set(0, -0.0105, 0.008);
  magWell.rotation.x = -P_GRIP_ANGLE;
  root.add(magWell);
  const mag = buildMagazine(m, true);
  magWell.add(mag);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, P_BORE, -P_MUZZLE_S - 0.003);
  root.add(muzzle);
  const ejectPort = new THREE.Object3D();
  ejectPort.position.set(0.006, 0.026, -0.031);
  root.add(ejectPort);

  return { root, slide, hammer, trigger, slideStop, magWell, mag, muzzle, ejectPort };
}

/** Front strap s position as a function of height t (matches the grip profile). */
function lerpStrap(t: number): number {
  // piecewise through (0.0145,-0.028) (0.004,-0.062) (-0.004,-0.097)
  if (t > -0.062) return 0.0145 + ((t + 0.028) / (-0.034)) * (0.004 - 0.0145) - 0.0012;
  return 0.004 + ((t + 0.062) / (-0.035)) * (-0.004 - 0.004) - 0.0012;
}

function holeCircle(x: number, y: number, r: number): THREE.Path {
  const p = new THREE.Path();
  p.absarc(x, y, r, 0, Math.PI * 2, true);
  return p;
}
const box3 = (w: number, h: number, d: number): G => new THREE.BoxGeometry(w, h, d);
void sphere;
