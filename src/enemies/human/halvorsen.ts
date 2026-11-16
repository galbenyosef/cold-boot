/**
 * HALVORSEN (stage 3a §8.8) — the habitat's night-duty facilities supervisor. 58, ~1.80 m, heavy-set, a little
 * stooped. Pale blue shirt with the sleeves rolled once, navy fleece vest zipped up to a stand-up collar, dark trousers
 * with a belt under the belly, brown leather shoes, a green FACILITIES lanyard + badge, reading glasses, a wedding ring.
 * Props (each skinned rigidly to its own bone and shown / hidden by the runtime): reading glasses on the head bone
 * (on the nose / pushed up — moved by the runtime) and a second pair hooked in the vest (hanging), a mug in the right
 * hand, a phone receiver and a loose badge card (root-level bones the runtime places in the world each frame).
 *
 * He shares Tomas's skeleton (the same bones and bind layout, see model.ts) plus the prop bones and lower lids; the
 * runtime scales the whole rig by HALV.scale. The head is the MakeHuman-based GLB (head2.ts); this file also builds the
 * procedural fallback head (grey receding hair, a short grey beard) under the material key 'face' / 'hair', hidden
 * when the GLB head is attached. Model space as Tomas: feet on y = 0, facing +Z, his LEFT is +X.
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { buildRigLods, glowMaterial, type RigBuilder } from '../shared/rig';
import { DETAIL, keyLerp, patch, spow, type V3 } from '../shared/prims';
import {
  HUMAN_DIM as K, type HumanTemplate, type Ring, loft, R, ellip, chain, rigid, vnoise, sm, libOr,
  headPoint, hdir, remapA, remapE, EYE_A, EYE_E, MOUTH_E,
} from './model';

/** Halvorsen's numbers (model units = Tomas's skeleton units; the runtime scales the rig by `scale`). */
export const HALV = {
  /** 1.80 m vs Tomas's 1.75 m skeleton. */
  scale: 1.03,
  /** GLB (MakeHuman metres, feet at 0) → model space. */
  glbOff: new THREE.Vector3(0, 0, -0.035),
  /** Eyeball centres (GLB landmarks + glbOff) and the eyeball radius we draw (the socket was made for 16 mm). */
  eyeL: new THREE.Vector3(0.0293, 1.62244, 0.12591 - 0.035),
  eyeR: new THREE.Vector3(-0.0293, 1.62244, 0.12591 - 0.035),
  eyeRad: 0.0126,
  /** Glasses bone (bridge of the frame) when the glasses sit low on the nose. */
  glassesNose: new THREE.Vector3(0, 1.604, 0.1335),
  /** Chest point of the lanyard clip and the card centre. */
  clip: new THREE.Vector3(0, 1.335, 0.158),
  cardY: 1.285,
};

const D = Math.PI / 180;

export function buildHalvorsenTemplate(ctx: GameContext): HumanTemplate {
  const M = ctx.materials;
  const skin = libOr(ctx, 'skin', 'plastic_white', { vertexColors: true, color: 0xcdb3a6 }, { color: 0xc49a84, roughness: 0.62, metalness: 0, map: null, normalMap: null, roughnessMap: null, metalnessMap: null, aoMap: null });
  skin.name = 'halv_skin';
  const shirt = libOr(ctx, 'fabric_warm', 'fabric', { color: 0x5f8cc8, vertexColors: true, roughness: 0.85, metalness: 0 }, {}); shirt.name = 'halv_shirt';
  const vest = libOr(ctx, 'fabric_warm', 'fabric', { color: 0x252f4a, vertexColors: true, roughness: 0.97, metalness: 0 }, {}); vest.name = 'halv_vest';
  const trousers = libOr(ctx, 'fabric_warm', 'fabric', { color: 0x37332f, vertexColors: true, roughness: 0.9, metalness: 0 }, {}); trousers.name = 'halv_trousers';
  const shoe = M.clone('rubber', { color: 0x5a3a24, roughness: 0.48, metalness: 0, vertexColors: true }); shoe.name = 'halv_leather';
  const hair = M.clone('plastic_white', { color: 0x8f8b86, roughness: 0.85, metalness: 0, vertexColors: true, map: null, normalMap: null }); hair.name = 'halv_hair';
  const eye = M.clone('plastic_white', { color: 0xffffff, roughness: 0.25, metalness: 0, vertexColors: true, map: null, normalMap: null, roughnessMap: null, metalnessMap: null, aoMap: null }); eye.name = 'halv_eye';
  const dark = M.get('plastic_dark');
  const badge = M.clone('plastic_white', { vertexColors: true, map: null }); badge.name = 'halv_badge';
  const frame = M.clone('plastic_dark', { color: 0x2e1d14, roughness: 0.32, metalness: 0, vertexColors: true }); frame.name = 'halv_frame';
  const lens = M.clone('glass', { color: 0xe8eef0, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.2 }); lens.name = 'halv_lens';
  const gold = M.clone('brass', { color: 0xd8a84a, roughness: 0.22, metalness: 1 }); gold.name = 'halv_gold';
  const mug = M.clone('plastic_white', { color: 0xf2eee4, roughness: 0.18, metalness: 0, vertexColors: true, map: null }); mug.name = 'halv_mug';
  const phone = M.clone('plastic_white', { color: 0xd9cdb0, roughness: 0.4, metalness: 0, map: null }); phone.name = 'halv_phone';
  const mats: Record<string, THREE.Material> = { glow: glowMaterial(), skin, face: skin, shirt, vest, trousers, shoe, hair, eye, dark, badge, frame, lens, gold, mug, phone };
  const { template, data } = buildRigLods(authorHalvorsen, mats, {
    radius: 1.6, center: new THREE.Vector3(0, 0.9, 0),
    lod: { k: 0.5, minFeature: 0.006, remap: { badge: 'shirt', gold: 'skin', lens: null, frame: 'dark' } },
    proxy: { k: 0.3, minFeature: 0.02, exclude: ['eye', 'badge', 'lens', 'frame', 'gold', 'face', 'hair'] }, // the head casts its own shadow (GLB or fallback)
    colorize: { skin: skinTone, face: skinTone, shirt: clothShade, vest: fleeceShade, trousers: clothShade, shoe: leatherShade, hair: hairTone, eye: eyeTone, badge: badgeTone, frame: frameTone, mug: mugTone },
  });
  return { rig: template, eyeL: data.eyeL, eyeR: data.eyeR, who: 'halvorsen', scale: HALV.scale };
}

// ───────────────────────────────────────────────────────────── helpers

/**
 * A closed ring-grid shell (torso / vest): rows of [y, rx, rz, cz, drop, n] keys, `off` pushed outward. `keep(x, y,
 * z, a)` decides per cell (centre) whether it is drawn (armholes, the vest's front gap). Smooth normals across the
 * wrap; optional bottom cap. Non-indexed out.
 */
function ringShell(rows: number[][], y0: number, y1: number, off: number, nu: number, nv: number, keep?: (x: number, y: number, z: number, a: number) => boolean, cap = false): THREE.BufferGeometry {
  const NU = Math.max(12, Math.round(nu * DETAIL.k)), NV = Math.max(8, Math.round(nv * Math.min(1, DETAIL.k + 0.2)));
  const key = (c: number) => rows.map((r) => [(r[0] - y0) / (y1 - y0), r[c]] as [number, number]);
  const kRx = key(1), kRz = key(2), kCz = key(3), kDrop = key(4), kN = key(5);
  const pos: number[] = [];
  const pt = (k: number, j: number, out: number[]) => {
    const v = j / NV, yv = y0 + v * (y1 - y0);
    const rx = keyLerp(kRx, v) + off, rz = keyLerp(kRz, v) + off, cz = keyLerp(kCz, v), drop = keyLerp(kDrop, v), e = 2 / keyLerp(kN, v);
    const a = (k / NU) * Math.PI * 2, sa = Math.sin(a), ca = Math.cos(a);
    out.push(spow(sa, e) * rx, yv - drop * Math.pow(Math.abs(sa), 1.6), cz + spow(ca, e) * rz);
  };
  for (let j = 0; j <= NV; j++) for (let k = 0; k < NU; k++) pt(k, j, pos);
  const idx: number[] = [];
  const P = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  for (let j = 0; j < NV; j++) for (let k = 0; k < NU; k++) {
    const a = j * NU + k, b = j * NU + ((k + 1) % NU), c = (j + 1) * NU + ((k + 1) % NU), d = (j + 1) * NU + k;
    if (keep) {
      const ce = P(a).add(P(b)).add(P(c)).add(P(d)).multiplyScalar(0.25);
      if (!keep(ce.x, ce.y, ce.z, ((k + 0.5) / NU) * Math.PI * 2)) continue;
    }
    idx.push(a, c, b, a, d, c);
  }
  if (cap) { const ci = pos.length / 3; pos.push(0, y0, keyLerp(kCz, 0)); for (let k = 0; k < NU; k++) idx.push(ci, k, (k + 1) % NU); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const tg = g.toNonIndexed(); g.dispose();
  // outward winding (the first side triangle against its radial direction)
  const pa = tg.getAttribute('position'), na = tg.getAttribute('normal');
  let dot = 0;
  for (let i = 0; i < Math.min(pa.count, 600); i++) dot += na.getX(i) * pa.getX(i) + na.getZ(i) * (pa.getZ(i) - keyLerp(kCz, 0.5));
  if (dot < 0) {
    const arr = pa.array as Float32Array;
    for (let i = 0; i < pa.count; i += 3) for (let c = 0; c < 3; c++) { const t = arr[(i + 1) * 3 + c]; arr[(i + 1) * 3 + c] = arr[(i + 2) * 3 + c]; arr[(i + 2) * 3 + c] = t; }
    tg.computeVertexNormals();
  }
  tg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tg.getAttribute('position').count * 2), 2));
  return tg;
}

/** Closed tube through points (constant radius), non-indexed. */
function tubeG(pts: V3[], r: number, radial = 6, closed = false, segs = 0): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  const g = new THREE.TubeGeometry(curve, segs || pts.length * 4, r, Math.max(4, Math.round(radial * Math.max(0.6, DETAIL.k))), closed);
  const o = g.toNonIndexed(); g.dispose();
  return o;
}

// heavier torso rings: [y, rx, rz, cz, drop, n]
const TORSO: number[][] = [
  [0.95, 0.163, 0.118, 0.022, 0, 2.4], [1.0, 0.166, 0.13, 0.034, 0, 2.4], [1.06, 0.167, 0.137, 0.04, 0, 2.3], [1.13, 0.168, 0.131, 0.036, 0, 2.3],
  [1.21, 0.171, 0.12, 0.026, 0, 2.4], [1.29, 0.176, 0.112, 0.018, 0, 2.5], [1.35, 0.183, 0.106, 0.01, 0, 2.5], [1.395, 0.188, 0.1, 0.0, 0.006, 2.4],
  [1.43, 0.176, 0.093, -0.008, 0.022, 2.3], [1.458, 0.15, 0.084, -0.013, 0.034, 2.2], [1.482, 0.108, 0.074, -0.014, 0.024, 2.2], [1.5, 0.078, 0.066, -0.012, 0.006, 2.1],
];
const torsoW = chain(['hips', 'spine1', 'spine2', 'neck'], [[0, 0.85, 0], [0, 1.06, -0.005], [0, 1.22, -0.01], [0, 1.47, -0.02], [0, 1.6, -0.02]], [0, 0.07, 0.08, 0.025]);
const torsoSkin = (p: THREE.Vector3): [string, number][] => {
  const base = torsoW(p);
  const side = p.x >= 0 ? 'l' : 'r';
  const w = sm(0.12, 0.185, Math.abs(p.x)) * sm(1.3, 1.4, p.y) * 0.55;
  if (w <= 0) return base;
  return [...base.map(([n, ww]) => [n, ww * (1 - w)] as [string, number]), ['uarm_' + side, w]];
};

function authorHalvorsen(b: RigBuilder): { eyeL: THREE.Vector3; eyeR: THREE.Vector3 } {
  const eL = HALV.eyeL, eR = HALV.eyeR;
  // ── skeleton: Tomas's layout (human.ts drives it), his eyes / brows, plus lower lids and the prop bones
  b.bone('hips', null, 0, K.hipsY, 0);
  b.bone('spine1', 'hips', 0, 1.06, -0.005);
  b.bone('spine2', 'spine1', 0, 1.22, -0.01);
  b.bone('neck', 'spine2', 0, 1.47, -0.02);
  b.bone('head', 'neck', 0, 1.556, -0.006);
  b.bone('jaw', 'head', 0, 1.6, 0.0);
  for (const [sfx, s, e] of [['l', 1, eL], ['r', -1, eR]] as const) {
    b.bone('eye_' + sfx, 'head', e.x, e.y, e.z);
    b.bone('lid_' + sfx, 'head', e.x, e.y, e.z);
    b.bone('brow_' + sfx, 'head', 0.031 * s, 1.652, 0.112);
    b.bone('clav_' + sfx, 'spine2', 0.03 * s, 1.43, -0.02);
    b.bone('uarm_' + sfx, 'clav_' + sfx, K.shoulderX * s, K.shoulderY, K.shoulderZ);
    b.bone('larm_' + sfx, 'uarm_' + sfx, K.shoulderX * s, K.shoulderY - K.uarm, K.shoulderZ);
    const wy = K.shoulderY - K.uarm - K.larm;
    b.bone('hand_' + sfx, 'larm_' + sfx, K.shoulderX * s, wy, K.shoulderZ);
    b.bone('fing_' + sfx, 'hand_' + sfx, K.shoulderX * s, wy - 0.088, K.shoulderZ + 0.004);
    b.bone('fing2_' + sfx, 'fing_' + sfx, K.shoulderX * s, wy - 0.128, K.shoulderZ + 0.004);
    b.bone('thumb_' + sfx, 'hand_' + sfx, (K.shoulderX - 0.008) * s, wy - 0.022, K.shoulderZ + 0.026);
    b.bone('thigh_' + sfx, 'hips', K.hipX * s, K.hipY, 0);
    b.bone('shin_' + sfx, 'thigh_' + sfx, K.hipX * s, K.hipY - K.thigh, 0.004);
    b.bone('foot_' + sfx, 'shin_' + sfx, K.hipX * s, K.ankle, -0.004);
    b.bone('sleeve_' + sfx, 'hips', 0.035 + 0.03 * s, 0.985, 0.122);
  }
  b.bone('badge', 'spine2', HALV.clip.x, HALV.clip.y, HALV.clip.z);
  b.bone('marker', 'hand_r', -K.shoulderX, K.shoulderY - K.uarm - K.larm - 0.06, K.shoulderZ);
  // Halvorsen-only bones (appended: Tomas's indices are unchanged)
  b.bone('lidlo_l', 'head', eL.x, eL.y, eL.z);
  b.bone('lidlo_r', 'head', eR.x, eR.y, eR.z);
  b.bone('glasses', 'head', HALV.glassesNose.x, HALV.glassesNose.y, HALV.glassesNose.z);
  b.bone('glasses_h', 'spine2', -0.045, 1.405, 0.135);
  const wyR = K.shoulderY - K.uarm - K.larm;
  b.bone('mug', 'hand_r', -K.shoulderX, wyR - 0.075, K.shoulderZ + 0.06);
  b.bone('card', null, 0, 0, 0);
  b.bone('phone', null, 0, 0, 0);

  authorFallbackHead(b);
  // eyeballs (both heads): grey-blue iris, by vertex colour round the +Z gaze axis
  b.mat('eye');
  for (const [e, bone] of [[eL, 'eye_l'], [eR, 'eye_r']] as const) {
    const sg = new THREE.SphereGeometry(HALV.eyeRad, Math.max(12, Math.round(28 * DETAIL.k)), Math.max(8, Math.round(20 * DETAIL.k)));
    sg.rotateX(Math.PI / 2); sg.translate(e.x, e.y, e.z);
    b.addSkinned(sg.toNonIndexed(), rigid(bone));
  }

  // ── shirt torso (mostly under the vest; it shows in the armholes, at the collar and over the belly's lower edge)
  b.mat('shirt');
  b.addSkinned(ringShell(TORSO, 0.95, 1.5, 0, 44, 46, undefined, true), torsoSkin);
  // collar points in the vest's gap
  for (const s of [-1, 1]) {
    const geo = patch((u, v, out) => {
      const a = (0.06 + 0.3 * u) * s, y = 1.475 - v * 0.05;
      out.set(Math.sin(a) * (0.072 + v * 0.01), y - Math.abs(u - 0.5) * 0.004, -0.004 + Math.cos(a) * (0.076 + v * 0.012));
    }, { nu: 5, nv: 3, thickness: 0.0015 });
    b.addSkinned(geo, () => [['spine2', 0.6], ['neck', 0.4]]);
  }
  // ── sleeves: shirt to a once-rolled cuff 7 cm above the wrist
  for (const s of [-1, 1]) {
    const sfx = s > 0 ? 'l' : 'r', x = K.shoulderX * s, z = K.shoulderZ;
    const sleeveW = (p: THREE.Vector3): [string, number][] => {
      const sh = Math.max(sm(1.445, 1.395, p.y), sm(0.15, 0.19, Math.abs(p.x)));
      const el = sm(1.17, 1.11, p.y);
      if (el > 0) return [['uarm_' + sfx, 1 - el], ['larm_' + sfx, el]];
      return sh >= 1 ? [['uarm_' + sfx, 1]] : [['spine2', 1 - sh], ['uarm_' + sfx, sh]];
    };
    b.addSkinned(loft([R(x - 0.075 * s, 1.43, z, 0.02, 0.03), R(x - 0.045 * s, 1.435, z, 0.03, 0.04), R(x - 0.018 * s, 1.42, z, 0.042, 0.052), R(x + 0.006 * s, 1.392, z, 0.054, 0.062),
      R(x + 0.012 * s, 1.35, z, 0.058, 0.062), R(x + 0.012 * s, 1.27, z, 0.054, 0.057), R(x + 0.008 * s, 1.19, z, 0.05, 0.053), R(x + 0.004 * s, 1.14, z - 0.004, 0.048, 0.052),
      R(x, 1.08, z, 0.047, 0.05), R(x, 1.02, z, 0.045, 0.047), R(x, 0.99, z, 0.044, 0.046)], 20, { sub: 3, capA: true, capB: false }), sleeveW);
    // the roll: a soft band at the cuff
    const hem: V3[] = [];
    for (let k = 0; k < 20; k++) { const a = (k / 20) * Math.PI * 2; hem.push([x + Math.sin(a) * 0.046, 0.996 + 0.004 * Math.sin(a * 2 + s), z + Math.cos(a) * 0.048]); }
    b.addSkinned(tubeG(hem, 0.009, 6, true, 40), () => [['larm_' + sfx, 1]]);
  }

  // ── fleece vest: armholes, a zip up the front to a stand-up collar (open a little at the throat)
  b.mat('vest');
  // armholes: inside an ellipse on each side the vest dips under the shirt (a smooth edge, no cut cells); a rolled
  // binding runs along that edge
  const AH = { y: 1.335, z: -0.006, ry: 0.098, rz: 0.066 };
  const ahQ = (y: number, z: number) => Math.hypot((y - AH.y) / AH.ry, (z - AH.z) / AH.rz);
  const vestRows = TORSO.map((r) => [r[0], r[1] + (r[0] > 1.36 ? -0.004 : 0.002), r[2] + 0.004, r[3], r[4], r[5]]);
  {
    const g = ringShell(vestRows, 0.93, 1.5, 0.009, 64, 60);
    const pa = g.getAttribute('position') as THREE.BufferAttribute, na = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const side = sm(0.1, 0.15, Math.abs(x));
      const k = (1 - sm(0.94, 1.04, ahQ(y, z))) * side;
      if (k <= 0) continue;
      // pull inward along the horizontal normal: 1.6 cm under the vest's own surface = under the shirt
      const nx = na.getX(i), nz = na.getZ(i), nl = Math.hypot(nx, nz) || 1;
      pa.setXYZ(i, x - (nx / nl) * 0.02 * k, y, z - (nz / nl) * 0.02 * k);
    }
    g.computeVertexNormals();
    b.addSkinned(g, torsoSkin);
  }
  for (const s of [-1, 1]) {
    const pts: V3[] = [];
    for (let k = 0; k < 40; k++) {
      const t = (k / 40) * Math.PI * 2;
      const y = AH.y + Math.sin(t) * AH.ry * 0.99, zz = AH.z + Math.cos(t) * AH.rz * 0.99;
      // on the vest's surface at (y, z): superellipse x for that row
      const v = (y - 0.93) / (1.5 - 0.93);
      const row = (c: number) => keyLerp(vestRows.map((r) => [(r[0] - 0.93) / (1.5 - 0.93), r[c]] as [number, number]), v);
      const rx = row(1) + 0.009, rz = row(2) + 0.009, cz = row(3), n = row(5);
      const q = Math.min(0.999, Math.abs((zz - cz) / rz));
      const x = rx * Math.pow(1 - Math.pow(q, n), 1 / n);
      pts.push([s * (x + 0.002), y - row(4) * 0, zz]);
    }
    b.addSkinned(tubeG(pts, 0.0065, 6, true, 80), (p) => torsoSkin(p));
  }
  // stand-up collar (thick fleece band), open at the front by a narrow V
  {
    const geo = patch((u, v, out) => {
      const gap = 0.16 + 0.22 * v; // radians each side of the front left open
      const a = gap + u * (Math.PI * 2 - 2 * gap);
      const y = 1.425 + v * 0.068;
      const rx = 0.084 - v * 0.007, rz = 0.077 - v * 0.006;
      out.set(Math.sin(a) * rx, y - 0.012 * Math.max(0, Math.cos(a)) * (1 - v), -0.01 + Math.cos(a) * rz);
    }, { nu: 30, nv: 4, thickness: 0.007 });
    b.addSkinned(geo, (p) => { const w = sm(1.44, 1.5, p.y) * 0.45; return [['spine2', 1 - w], ['neck', w]]; });
    // zip: a dark tape up the centre front + the pull at the top of the zip
    b.mat('dark');
    const zip: V3[] = [];
    for (let y = 0.94; y <= 1.43; y += 0.035) {
      const v = (y - 0.95) / 0.55;
      const rz = keyLerp(TORSO.map((r) => [(r[0] - 0.95) / 0.55, r[2] + 0.004 + 0.009] as [number, number]), v), cz = keyLerp(TORSO.map((r) => [(r[0] - 0.95) / 0.55, r[3]] as [number, number]), v);
      zip.push([0, y, cz + rz + 0.0018]);
    }
    b.addSkinned(tubeG(zip, 0.0024, 4, false, 40), torsoSkin);
    b.addSkinned(new THREE.BoxGeometry(0.008, 0.022, 0.003).toNonIndexed().translate(0.004, 1.4, 0.085), torsoSkin);
  }
  // vest hem band
  b.mat('vest');
  {
    const pts: V3[] = [];
    for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; pts.push([Math.sin(a) * 0.175, 0.935, 0.024 + Math.cos(a) * 0.131]); }
    b.addSkinned(tubeG(pts, 0.009, 6, true, 80), torsoSkin);
  }

  // ── forearms + hands (skin), a wedding ring on the left ring finger
  b.mat('skin');
  for (const s of [-1, 1]) {
    const sfx = s > 0 ? 'l' : 'r', x = K.shoulderX * s, z = K.shoulderZ;
    const wy = K.shoulderY - K.uarm - K.larm;
    const armW = chain(['uarm_' + sfx, 'larm_' + sfx, 'hand_' + sfx], [[x, K.shoulderY, z], [x, K.shoulderY - K.uarm, z], [x, wy, z], [x, wy - 0.1, z]], [0, 0.045, 0.025]);
    b.addSkinned(loft([R(x, 1.1, z, 0.04, 0.042), R(x, 1.03, z, 0.041, 0.04), R(x, 0.97, z, 0.035, 0.031), R(x, 0.92, z, 0.028, 0.023), R(x, wy, z, 0.026, 0.02)], 16, { sub: 3 }), armW);
    const handW = chain(['hand_' + sfx, 'fing_' + sfx], [[x, wy, z], [x, wy - 0.088, z], [x, wy - 0.2, z]], [0, 0.012]);
    b.addSkinned(loft([R(x, wy + 0.004, z + 0.003, 0.02, 0.024, 2.4), R(x, wy - 0.035, z + 0.004, 0.0165, 0.046, 2.8), R(x + 0.002 * s, wy - 0.08, z + 0.004, 0.0135, 0.047, 3), R(x + 0.002 * s, wy - 0.095, z + 0.004, 0.012, 0.044, 2.6)], 14, { sub: 2 }), handW);
    const fz = [0.03, 0.0105, -0.009, -0.0275], fl = [0.07, 0.078, 0.074, 0.058], fr = [0.0092, 0.0095, 0.009, 0.008];
    for (let i = 0; i < 4; i++) {
      const y0 = wy - 0.084, zz = z + 0.004 + fz[i], L = fl[i], r = fr[i];
      const fW = chain(['hand_' + sfx, 'fing_' + sfx, 'fing2_' + sfx], [[x, wy, zz], [x, wy - 0.088, zz], [x, wy - 0.128, zz], [x, y0 - L - 0.02, zz]], [0, 0.008, 0.008]);
      b.addSkinned(loft([R(x + 0.0012 * s, y0, zz, r * 1.05, r * 1.1), R(x + 0.001 * s, y0 - L * 0.5, zz, r * 0.97, r), R(x, y0 - L * 0.92, zz, r * 0.82, r * 0.86), R(x - 0.001 * s, y0 - L, zz, r * 0.42, r * 0.46)], 8, { sub: 2 }), fW);
      if (s > 0 && i === 2) {
        b.mat('gold');
        const ring = new THREE.TorusGeometry(r * 1.12, 0.0016, 5, 14).rotateX(Math.PI / 2).toNonIndexed();
        ring.translate(x + 0.0012 * s, y0 - 0.016, zz);
        b.addSkinned(ring, fW);
        b.mat('skin');
      }
    }
    const tw = chain(['hand_' + sfx, 'thumb_' + sfx], [[x, wy, z + 0.02], [x - 0.008 * s, wy - 0.022, z + 0.026], [x - 0.012 * s, wy - 0.08, z + 0.05]], [0, 0.01]);
    b.addSkinned(loft([R(x - 0.004 * s, wy - 0.012, z + 0.022, 0.012, 0.013), R(x - 0.01 * s, wy - 0.04, z + 0.036, 0.01, 0.0105), R(x - 0.013 * s, wy - 0.064, z + 0.046, 0.009, 0.0095), R(x - 0.014 * s, wy - 0.075, z + 0.05, 0.0045, 0.0045)], 8, { sub: 2, front: new THREE.Vector3(1, 0, 0) }), tw);
  }

  // ── trousers: seat + legs, a belt under the belly
  b.mat('trousers');
  {
    const pelvW = (p: THREE.Vector3): [string, number][] => {
      const s = p.x >= 0 ? 'l' : 'r';
      const wt = sm(0.94, 0.8, p.y) * sm(0.01, 0.06, Math.abs(p.x)) * 0.85;
      return [['hips', 1 - wt], ['thigh_' + s, wt]];
    };
    b.addSkinned(loft([R(0, 1.0, 0.024, 0.158, 0.12, 2.4), R(0, 0.96, 0.016, 0.166, 0.122, 2.4), R(0, 0.9, 0.0, 0.17, 0.12, 2.5), R(0, 0.85, -0.006, 0.164, 0.112, 2.5), R(0, 0.815, -0.004, 0.14, 0.1, 2.4), R(0, 0.79, -0.004, 0.09, 0.07, 2.2)], 28, { sub: 3, capB: false }), pelvW);
  }
  for (const s of [-1, 1]) {
    const sfx = s > 0 ? 'l' : 'r', x = K.hipX * s;
    const legW = chain(['hips', 'thigh_' + sfx, 'shin_' + sfx, 'foot_' + sfx], [[x, 1.0, 0], [x, K.hipY, 0], [x, K.hipY - K.thigh, 0.004], [x, K.ankle, -0.004], [x, -0.05, 0]], [0, 0.07, 0.06, 0.05]);
    b.addSkinned(loft([R(x + 0.008 * s, 0.92, -0.004, 0.092, 0.096), R(x + 0.004 * s, 0.8, 0.004, 0.088, 0.09), R(x, 0.66, 0.006, 0.077, 0.08), R(x, 0.52, 0.01, 0.068, 0.07), R(x, 0.46, 0.008, 0.066, 0.068),
      R(x, 0.34, -0.002, 0.064, 0.066), R(x, 0.2, -0.002, 0.062, 0.064), R(x, 0.1, 0.004, 0.064, 0.07), R(x, 0.066, 0.01, 0.066, 0.078)], 20, { sub: 3 }), legW);
  }
  b.mat('shoe');
  {
    // belt (leather), with a buckle
    const pts: V3[] = [];
    for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; pts.push([Math.sin(a) * 0.162, 0.985 - 0.012 * Math.max(0, Math.cos(a)), 0.022 + Math.cos(a) * 0.124]); }
    b.addSkinned(tubeG(pts, 0.012, 6, true, 80), () => [['hips', 1]]);
    b.mat('gold');
    b.addSkinned(new THREE.BoxGeometry(0.04, 0.03, 0.006).toNonIndexed().translate(0, 0.973, 0.15), () => [['hips', 1]]);
    b.mat('shoe');
  }
  // shoes: low leather lace-ups
  for (const s of [-1, 1]) {
    const sfx = s > 0 ? 'l' : 'r', x = K.hipX * s;
    const bw = chain(['shin_' + sfx, 'foot_' + sfx], [[x, 0.3, 0], [x, K.ankle, -0.004], [x, 0, 0.2]], [0, 0.03]);
    b.addSkinned(loft([R(x, 0.1, -0.012, 0.045, 0.052), R(x, 0.075, 0.0, 0.05, 0.064), R(x, 0.05, 0.035, 0.05, 0.095, 2.6), R(x + 0.004 * s, 0.042, 0.095, 0.047, 0.07, 2.6), R(x + 0.006 * s, 0.035, 0.155, 0.043, 0.034, 2.4), R(x + 0.006 * s, 0.028, 0.182, 0.034, 0.012, 2.2)], 16,
      { sub: 3, front: new THREE.Vector3(0, 1, 0) }), bw);
    b.mat('dark');
    b.addSkinned(loft([R(x, 0.012, -0.03, 0.042, 0.011, 3), R(x + 0.004 * s, 0.011, 0.05, 0.049, 0.011, 3), R(x + 0.006 * s, 0.01, 0.168, 0.036, 0.01, 3)], 12, { sub: 2, front: new THREE.Vector3(0, 1, 0) }), rigid('foot_' + sfx));
    b.mat('shoe');
  }

  // ── lanyard over the collar + the facilities badge on its clip
  b.mat('badge');
  {
    const path: V3[] = [[0.0, HALV.clip.y + 0.012, HALV.clip.z - 0.004], [0.03, 1.39, 0.14], [0.06, 1.44, 0.095], [0.082, 1.47, 0.03], [0.07, 1.49, -0.04], [0.0, 1.497, -0.082], [-0.07, 1.49, -0.04], [-0.082, 1.47, 0.03], [-0.06, 1.44, 0.095], [-0.03, 1.39, 0.14], [0.0, HALV.clip.y + 0.012, HALV.clip.z - 0.004]];
    const pts: Ring[] = path.map((p) => ({ c: new THREE.Vector3(...p), rx: 0.0075, rz: 0.0016, n: 2 }));
    b.addSkinned(loft(pts, 5, { sub: 3, front: new THREE.Vector3(0, 0, 1) }), (p) => { const w = sm(1.45, 1.495, p.y) * 0.5; return [['spine2', 1 - w], ['neck', w]]; });
    const card = new THREE.BoxGeometry(0.054, 0.086, 0.0032).toNonIndexed();
    card.translate(0, HALV.cardY, HALV.clip.z + 0.004);
    b.addSkinned(card, rigid('badge'));
    const clip = new THREE.BoxGeometry(0.012, 0.024, 0.007).toNonIndexed();
    clip.translate(0, HALV.clip.y - 0.002, HALV.clip.z + 0.004);
    b.addSkinned(clip, rigid('badge'));
    // the loose card (in his hand / on the desk): authored at the origin of the 'card' bone, face toward +X
    const lc = new THREE.BoxGeometry(0.0032, 0.086, 0.054).toNonIndexed();
    b.addSkinned(lc, rigid('card'));
  }

  // ── reading glasses (two copies: on the head bone, and hooked into the vest by a temple)
  authorGlasses(b, 'glasses', HALV.glassesNose, false);
  authorGlasses(b, 'glasses_h', new THREE.Vector3(-0.045, 1.405, 0.135), true);

  // ── mug (right hand, by the handle)
  b.mat('mug');
  {
    const wy = K.shoulderY - K.uarm - K.larm, hx = -K.shoulderX;
    const c = new THREE.Vector3(hx + 0.012, wy - 0.085, K.shoulderZ + 0.11);
    const body = new THREE.CylinderGeometry(0.041, 0.038, 0.096, Math.max(10, Math.round(22 * DETAIL.k)), 1, true).toNonIndexed();
    body.translate(c.x, c.y, c.z);
    b.addSkinned(body, rigid('mug'));
    const bot = new THREE.CircleGeometry(0.038, 18).rotateX(Math.PI / 2).toNonIndexed(); bot.translate(c.x, c.y - 0.048, c.z);
    b.addSkinned(bot, rigid('mug'));
    const inner = new THREE.CylinderGeometry(0.037, 0.035, 0.08, 18, 1, true).toNonIndexed();
    { const a = inner.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < a.count; i += 3) { const t = a.getX(i + 1), t2 = a.getY(i + 1), t3 = a.getZ(i + 1); a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2)); a.setXYZ(i + 2, t, t2, t3); } inner.computeVertexNormals(); }
    inner.translate(c.x, c.y + 0.008, c.z);
    b.addSkinned(inner, rigid('mug'));
    b.mat('dark');
    const tea = new THREE.CircleGeometry(0.035, 16).rotateX(-Math.PI / 2).toNonIndexed(); tea.translate(c.x, c.y + 0.03, c.z);
    b.addSkinned(tea, rigid('mug'));
    b.mat('mug');
    const handle = new THREE.TorusGeometry(0.024, 0.006, 6, 14, Math.PI * 1.1).toNonIndexed();
    handle.rotateZ(-Math.PI * 0.55); handle.rotateY(Math.PI / 2);
    handle.translate(c.x, c.y + 0.002, c.z - 0.041);
    b.addSkinned(handle, rigid('mug'));
  }

  // ── phone receiver (root bone 'phone': the runtime places it). Long axis along Y (ear cup up at +Y), face +Z.
  b.mat('phone');
  {
    const bar = loft([R(0, -0.07, 0.0, 0.016, 0.012), R(0, -0.04, -0.004, 0.013, 0.01), R(0, 0.0, -0.008, 0.012, 0.0095), R(0, 0.04, -0.004, 0.013, 0.01), R(0, 0.07, 0.0, 0.016, 0.012)], 10, { sub: 3, front: new THREE.Vector3(0, 0, 1) });
    b.addSkinned(bar, rigid('phone'));
    for (const y of [-0.085, 0.085]) {
      const cup = new THREE.CylinderGeometry(0.026, 0.02, 0.03, 14).toNonIndexed();
      cup.rotateX(Math.PI / 2); cup.translate(0, y, 0.01);
      b.addSkinned(cup, rigid('phone'));
    }
  }
  return { eyeL: eL.clone(), eyeR: eR.clone() };
}

/** Half-rim reading glasses around a bridge point `B`; `folded`: temples folded behind the lenses (hanging pair). */
function authorGlasses(b: RigBuilder, bone: string, B: THREE.Vector3, folded: boolean): void {
  b.mat('frame');
  const lensC = (s: number) => new THREE.Vector3(B.x + s * 0.0305, B.y + 0.0045, B.z - 0.006);
  const W = 0.0235, Hh = 0.0135;
  const rim = (s: number) => {
    const c = lensC(s), pts: Ring[] = [];
    for (let k = 0; k <= 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      const x = spow(Math.cos(a), 0.6) * W, y = spow(Math.sin(a), 0.75) * Hh * (Math.sin(a) > 0 ? 1 : 1.12);
      const wrap = -0.006 * (x * s / W + 1) * 0.5; // the outer side tucks back a little
      pts.push({ c: new THREE.Vector3(c.x + x, c.y + y, c.z + wrap), rx: Math.sin(a) > 0.2 ? 0.0019 : 0.0011, rz: Math.sin(a) > 0.2 ? 0.0024 : 0.0012, n: 2 });
    }
    return loft(pts, 5, { sub: 1, capA: false, capB: false, front: new THREE.Vector3(0, 0, 1) });
  };
  for (const s of [-1, 1]) b.addSkinned(rim(s), rigid(bone));
  // bridge
  b.addSkinned(tubeG([[B.x - 0.008, B.y + 0.009, B.z - 0.003], [B.x, B.y + 0.0105, B.z], [B.x + 0.008, B.y + 0.009, B.z - 0.003]], 0.0015, 5, false, 8), rigid(bone));
  // nose pads
  for (const s of [-1, 1]) b.addSkinned(ellip([B.x + s * 0.0085, B.y - 0.002, B.z - 0.009], [0.002, 0.004, 0.0015], 6, 4), rigid(bone));
  // temples
  for (const s of [-1, 1]) {
    const c = lensC(s);
    const hx = c.x + s * W, hy = c.y + Hh * 0.6, hz = c.z - 0.008;
    const pts: V3[] = folded
      ? [[hx, hy, hz], [hx + s * 0.002, hy, hz - 0.008], [hx - s * 0.03, hy - 0.002, hz - 0.012], [hx - s * 0.075, hy - 0.004, hz - 0.012]]
      : [[hx, hy, hz], [s * 0.069, hy + 0.003, B.z - 0.03], [s * 0.078, hy + 0.007, B.z - 0.07], [s * 0.084, hy + 0.009, B.z - 0.11], [s * 0.084, hy + 0.0, B.z - 0.135], [s * 0.078, hy - 0.022, B.z - 0.15]];
    b.addSkinned(tubeG(pts, 0.0017, 5, false, 24), rigid(bone));
  }
  b.mat('lens');
  for (const s of [-1, 1]) {
    const c = lensC(s);
    const shape = new THREE.Shape();
    for (let k = 0; k <= 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      const x = spow(Math.cos(a), 0.6) * W * 0.98, y = spow(Math.sin(a), 0.75) * Hh * 0.98 * (Math.sin(a) > 0 ? 1 : 1.12);
      if (k === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    const g = new THREE.ShapeGeometry(shape).toNonIndexed();
    const pa = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i); pa.setXYZ(i, c.x + x, c.y + pa.getY(i), c.z - 0.006 * (x * s / W + 1) * 0.5 + 0.0004); }
    g.computeVertexNormals();
    b.addSkinned(g, rigid(bone));
  }
}

// ───────────────────────────────────────────────────────────── fallback head (procedural; hidden under the GLB head)

/** Tomas's procedural face moved so its eyes sit on Halvorsen's eye bones (keys 'face' / 'hair'). */
function authorFallbackHead(b: RigBuilder): void {
  const tE = headPoint(EYE_A, EYE_E, new THREE.Vector3()).addScaledVector(hdir(EYE_A, EYE_E, new THREE.Vector3()), -0.0062);
  const off = new THREE.Vector3(0, HALV.eyeL.y - tE.y, HALV.eyeL.z - tE.z);
  const Moff = new THREE.Matrix4().makeTranslation(off.x, off.y, off.z);
  const mouthY = K.mouthY + off.y;
  const headW = (p: THREE.Vector3): [string, number][] => {
    const dx = Math.abs(p.x), below = mouthY - p.y;
    let wj = 0;
    if (p.z > -0.01 + off.z && below > -0.0006) {
      const lat = 1 - sm(0.028, 0.068, dx);
      wj = (below > 0.0006 ? 1 : 0.5) * lat * (1 - sm(0.05, 0.075, below) * 0.4);
    }
    const wn = sm(1.575 + off.y, 1.54 + off.y, p.y) * 0.6;
    return [['jaw', wj * (1 - wn)], ['neck', wn], ['head', Math.max(0, 1 - wj - wn)]];
  };
  b.mat('face');
  {
    const NU = 72, NV = 60;
    let mv = 0, md = 1e9;
    for (let j = 0; j <= NV; j++) { const d = Math.abs(remapE(j / NV) - MOUTH_E); if (d < md) { md = d; mv = j; } }
    const MW = 0.235;
    const eyeHole = (a: number, e: number, s: number) => {
      const da = (a - s * EYE_A) / 0.165, de = (e - EYE_E - 0.012 * Math.cos(da * 1.4)) / (0.07 + 0.02 * (1 - Math.abs(da)));
      return da * da + de * de * (1 + 0.6 * da * da) < 1;
    };
    const geo = patch((u, v, out) => {
      const a = remapA(u);
      let e = remapE(v);
      const j = Math.round(v * NV);
      if (Math.abs(a) < MW + 0.06 && Math.abs(j - mv) === 1) { const k = (1 - sm(MW - 0.06, MW + 0.06, Math.abs(a))) * 0.72; e += (remapE(mv / NV) - e) * k; }
      headPoint(a, Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, e)), out);
      // heavier: fuller cheeks and jowls, a broader jaw
      const low = Math.max(0, -Math.sin(e)), side = Math.abs(Math.sin(a));
      out.x *= 1 + 0.1 * low * side; out.z += 0.004 * low;
      return out;
    }, { nu: NU, nv: NV, thickness: 0.004, mask: (u, v) => { const a = remapA(u), e = remapE(v); if (eyeHole(a, e, 1) || eyeHole(a, e, -1)) return false; return !(Math.round(v * NV) === mv && Math.abs(a) < MW); } });
    b.addSkinned(geo, headW, Moff);
    const top = headPoint(0, EYE_E + 0.02, new THREE.Vector3());
    const zf = top.z;
    const n = (y: number, z: number, rx: number, rz: number): Ring => R(0, y, z, rx, rz, 2.2);
    b.addSkinned(loft([n(1.648, zf - 0.007, 0.006, 0.0045), n(1.636, zf - 0.001, 0.007, 0.0055), n(1.62, zf + 0.007, 0.0085, 0.0075), n(1.606, zf + 0.014, 0.011, 0.0105), n(1.6, zf + 0.014, 0.0105, 0.009), n(1.596, zf + 0.004, 0.008, 0.005)], 12, { sub: 3 }), rigid('head'), Moff.clone());
    for (const s of [-1, 1]) {
      const g = patch((u, v, out) => { const a = (-0.5 + u) * Math.PI * 1.9, r = 1 - v * 0.55; out.set(Math.cos(a) * 0.013 * r * 0.6 - v * 0.004, Math.sin(a) * 0.033 * r, -Math.cos(a) * 0.018 * r - 0.004); }, { nu: 12, nv: 3, thickness: 0.004, flip: s < 0 });
      b.addSkinned(g, rigid('head'), new THREE.Matrix4().compose(new THREE.Vector3(s * 0.074, 1.633, -0.006).add(off), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s * -12 * D, s * 6 * D)), new THREE.Vector3(s, 1, 1)));
    }
    // neck (the GLB brings its own)
    b.addSkinned(loft([R(0, 1.42, -0.02, 0.068, 0.066), R(0, 1.48, -0.012, 0.064, 0.062), R(0, 1.54, -0.004, 0.06, 0.058), R(0, 1.59, 0.0, 0.055, 0.054)], 16, { sub: 2 }),
      chain(['spine2', 'neck', 'head'], [[0, 1.3, -0.02], [0, 1.47, -0.02], [0, 1.556, -0.006], [0, 1.65, 0]], [0, 0.03, 0.03]));
    // mouth interior
    b.mat('dark');
    b.addSkinned(ellip([0, mouthY - 0.002, 0.058 + off.z], [0.022, 0.012, 0.018], 12, 8), (p) => [['jaw', p.y < mouthY - 0.002 ? 1 : 0], ['head', p.y < mouthY - 0.002 ? 0 : 1]]);
    // lids (fallback: rigid caps on the lid bones)
    b.mat('face');
    for (const [sfx, e] of [['l', HALV.eyeL], ['r', HALV.eyeR]] as const) {
      const geo2 = patch((u, v, out) => {
        const a = (-0.62 + 1.24 * u) * Math.PI / 2, el = (0.17 + 0.83 * v) * Math.PI / 2, r = HALV.eyeRad + 0.0016;
        out.set(e.x + Math.cos(el) * Math.sin(a) * r * 1.02, e.y + Math.sin(el) * r, e.z + Math.cos(el) * Math.cos(a) * r);
      }, { nu: 10, nv: 4, thickness: 0.0016 });
      b.addSkinned(geo2, rigid('lid_' + sfx));
    }
    // grey brows
    b.mat('hair');
    for (const s of [-1, 1]) {
      const pts: Ring[] = [];
      for (let i = 0; i <= 4; i++) {
        const t = i / 4, a = s * (0.13 + 0.42 * t), e = EYE_E + 0.16 + 0.03 * Math.sin(Math.PI * t * 0.9) - 0.012 * t;
        const p = headPoint(a, e, new THREE.Vector3()).addScaledVector(hdir(a, e, new THREE.Vector3()), 0.0015).add(off);
        pts.push({ c: p, rx: 0.003 + 0.0012 * (1 - t), rz: 0.005 + 0.002 * (1 - t), n: 2 });
      }
      b.addSkinned(loft(pts, 6, { sub: 2, front: new THREE.Vector3(0, 1, 0.3).normalize() }), rigid(s > 0 ? 'brow_l' : 'brow_r'));
    }
    // receding grey hair: sides and back only, thin on top
    const hl: [number, number][] = [[0, 1.2], [0.5, 1.0], [0.85, 0.42], [1.18, -0.1], [1.34, -0.08], [1.46, 0.24], [1.85, 0.2], [2.15, -0.2], [2.7, -0.45], [Math.PI, -0.52]];
    const hair = patch((u, v, out) => {
      const a = remapA(u), e = -0.62 + v * (Math.PI / 2 + 0.62 - 0.001);
      const p = headPoint(a, e, out);
      const nn = hdir(a, e, new THREE.Vector3());
      p.addScaledVector(nn, 0.004 + vnoise(a * 9, e * 9) * 0.003 + 0.004 * sm(0.4, 1.2, e) * (1 - sm(1.25, 1.5, e)));
      return p.add(off);
    }, { nu: 60, nv: 22, thickness: 0.004, mask: (u, v) => { const a = remapA(u), e = -0.62 + v * (Math.PI / 2 + 0.62); return e > keyLerp(hl, Math.abs(a)) + (vnoise(a * 11.3, 2.2) - 0.5) * 0.15 && !(e > 1.15 && Math.abs(a) < 1.6); } });
    b.addSkinned(hair, rigid('head'));
    // short grey beard on the jaw + chin (the fallback's "older man" read)
    const beard = patch((u, v, out) => {
      const a = (u - 0.5) * 2.6, e = MOUTH_E - 0.62 + v * 0.62;
      const p = headPoint(a, e, out);
      const low = Math.max(0, -Math.sin(e)), side = Math.abs(Math.sin(a));
      p.x *= 1 + 0.1 * low * side; p.z += 0.004 * low;
      p.addScaledVector(hdir(a, e, new THREE.Vector3()), 0.0035 + vnoise(a * 20, e * 20) * 0.002);
      return p.add(off);
    }, { nu: 30, nv: 8, thickness: 0.003, mask: (u, v) => { const a = (u - 0.5) * 2.6, e = MOUTH_E - 0.62 + v * 0.62; return !(Math.abs(a) < 0.3 && e > MOUTH_E - 0.06); } });
    b.addSkinned(beard, headW);
  }
}

// ───────────────────────────────────────────────────────────── vertex colours

function skinTone(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color): void {
  let r = 1, g = 0.96, bl = 0.94;
  if (p.y > 1.45) {
    // fallback face: dark under the eyes, ruddy nose / cheeks
    for (const e of [HALV.eyeL, HALV.eyeR]) {
      const d = Math.hypot((p.x - e.x) * 0.9, (p.y - e.y) * 1.1, p.z - e.z);
      const k = 1 - sm(0.014, 0.032, d); r -= k * 0.25; g -= k * 0.32; bl -= k * 0.26;
    }
    for (const s of [-1, 1]) { const d = Math.hypot(p.x - s * 0.045, p.y - 1.595, (p.z - 0.09) * 0.6); const k = 1 - sm(0.0, 0.03, d); g -= k * 0.1; bl -= k * 0.1; }
    if (Math.abs(p.x) > 0.07 && n.x * Math.sign(p.x) < 0.2 && p.y > 1.6 && p.y < 1.66) { r *= 0.75; g *= 0.7; bl *= 0.7; }
  } else {
    // forearms / hands: age spots, knuckles and creases, a little sun on the backs of the hands
    const m = vnoise(p.x * 60, p.y * 60 + p.z * 40) * 0.08 + Math.max(0, vnoise(p.x * 180 + 7, p.y * 160 + p.z * 140) - 0.75) * 0.25;
    r -= m * 0.8; g -= m * 1.1; bl -= m * 1.1;
  }
  out.setRGB(Math.max(0.08, r), Math.max(0.05, g), Math.max(0.05, bl));
}

function clothShade(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color): void {
  const big = vnoise(p.x * 8 + p.z * 3, p.y * 7), fine = vnoise(p.x * 41 + 3, p.y * 37 + p.z * 23);
  let k = 1.02 - big * 0.06 - fine * 0.04;
  k -= Math.max(0, -n.y) * (p.y > 0.75 && p.y < 0.95 ? 0.05 : 0.16);
  if (p.y < 0.55 && p.y > 0.42 && p.z < 0) k -= 0.1;
  k -= (1 - sm(0.06, 0.3, p.y)) * 0.1;
  k = Math.min(1.1, Math.max(0.5, k));
  out.setRGB(k, k, k);
}

function fleeceShade(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color): void {
  // pilled fleece: soft mottling, darker in the folds under the arms and at the hem, lighter worn shoulders
  const m = vnoise(p.x * 90 + 1, p.y * 85 + p.z * 70) * 0.08 + vnoise(p.x * 12, p.y * 10 + p.z * 9) * 0.06;
  let k = 1.0 - m - Math.max(0, -n.y) * 0.14 + sm(1.38, 1.46, p.y) * Math.max(0, n.y) * 0.12;
  if (p.y < 0.96) k -= 0.05;
  out.setRGB(k, k, k * 1.02);
}

function leatherShade(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color): void {
  const m = vnoise(p.x * 70, p.z * 70 + p.y * 50) * 0.12;
  const k = 1 - m + Math.max(0, n.y) * 0.1 - (p.y > 0.9 ? 0.25 : 0); // belt darker
  out.setRGB(k, k * 0.97, k * 0.94);
}

function hairTone(p: THREE.Vector3, _n: THREE.Vector3, out: THREE.Color): void {
  const v = vnoise(p.x * 160, p.y * 140 + p.z * 120) * 0.4 + vnoise(p.x * 23, p.z * 19) * 0.15;
  const k = 0.7 + v;
  out.setRGB(k, k * 0.98, k * 0.96);
}

export function halvEyeTone(p: THREE.Vector3, _n: THREE.Vector3, out: THREE.Color): void {
  const e = p.x >= 0 ? HALV.eyeL : HALV.eyeR;
  const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z, d = Math.hypot(dx, dy, dz);
  const c = dz / (d || 1), ang = Math.acos(Math.min(1, Math.max(-1, c)));
  if (ang < 0.18) { out.setRGB(0.015, 0.015, 0.018); return; }
  if (ang < 0.47) {
    // grey-blue with a warm ring round the pupil, radial fibres, a dark limbal ring
    const t = (ang - 0.18) / 0.29, f = vnoise(Math.atan2(dy, dx) * 11, t * 3) * 0.45 + 0.78;
    const warm = 1 - sm(0.0, 0.3, t), lim = sm(0.78, 1, t);
    out.setRGB((0.05 + 0.04 * t + 0.05 * warm) * f * (1 - 0.6 * lim), (0.07 + 0.05 * t + 0.03 * warm) * f * (1 - 0.6 * lim), (0.1 + 0.06 * t) * f * (1 - 0.6 * lim));
    return;
  }
  const lim = sm(0.47, 0.55, ang), side = Math.abs(dx) / HALV.eyeRad;
  out.setRGB(0.05 + (0.5 + 0.06 * side) * lim, 0.045 + (0.44 - 0.02 * side) * lim, 0.04 + (0.38 - 0.04 * side) * lim);
}
const eyeTone = halvEyeTone;

function badgeTone(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color): void {
  // lanyard: facilities green; card: white with a green band, photo square, a barcode strip. Loose card: same by its axes.
  const loose = Math.abs(p.y) < 0.06 && Math.abs(p.z) < 0.04 && Math.abs(p.x) < 0.01; // the 'card' bone's copy (at the origin)
  if (loose) {
    if (Math.abs(n.x) < 0.5) { out.setRGB(0.85, 0.85, 0.83); return; }
    const ly = p.y, lx = p.z * Math.sign(n.x);
    if (ly > 0.026) { out.setRGB(0.14, 0.45, 0.28); return; }
    if (ly > -0.012 && ly < 0.02 && lx > -0.022 && lx < 0.0) { out.setRGB(0.42, 0.36, 0.32); return; }
    if (ly < -0.03 && Math.abs(lx) < 0.02 && Math.sin(lx * 900) > 0.2) { out.setRGB(0.08, 0.08, 0.08); return; }
    out.setRGB(0.93, 0.93, 0.9); return;
  }
  if (p.y > HALV.clip.y + 0.004 || (p.y > HALV.clip.y - 0.012 && Math.abs(p.x) > 0.008)) { out.setRGB(0.07, 0.24, 0.15); return; }
  if (n.z < 0.5) { out.setRGB(0.85, 0.85, 0.83); return; }
  const lx = p.x, ly = p.y - HALV.cardY;
  if (ly > 0.026) { out.setRGB(0.14, 0.45, 0.28); return; }
  if (ly > -0.012 && ly < 0.02 && lx > -0.022 && lx < 0.0) { out.setRGB(0.42, 0.36, 0.32); return; }
  if (ly < -0.03 && Math.abs(lx) < 0.02 && Math.sin(lx * 900) > 0.2) { out.setRGB(0.08, 0.08, 0.08); return; }
  out.setRGB(0.93, 0.93, 0.9);
}

function frameTone(p: THREE.Vector3, _n: THREE.Vector3, out: THREE.Color): void {
  // tortoiseshell: amber flecks in dark brown
  const v = vnoise(p.x * 400, p.y * 400 + p.z * 300);
  const k = v > 0.62 ? 1.7 : 0.8 + v * 0.3;
  out.setRGB(k, k * 0.85, k * 0.7);
}

function mugTone(p: THREE.Vector3, _n: THREE.Vector3, out: THREE.Color): void {
  // a red band round the mug (local height unknown here: banded by world-ish y within the mug's bone space)
  const y = p.y - (K.shoulderY - K.uarm - K.larm - 0.085);
  if (Math.abs(y - 0.012) < 0.012) out.setRGB(0.62, 0.12, 0.1); else out.setRGB(1, 1, 1);
}
