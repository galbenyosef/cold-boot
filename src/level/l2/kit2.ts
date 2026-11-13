/**
 * Level-2 props and helpers on top of the shared kits: instanced staff belongings (shoes, folded
 * coveralls, badges), finished robot shells, scrolling belt materials, engraved brass, reveal-able
 * marker writing, simple rotating-ring hologram helpers.
 */
import * as THREE from 'three';
import type { Builder, Mat } from '../builder';
import type { LevelBuild } from '../context';
import { cable, hose, lathe, panelOn } from '../kit';

const PI = Math.PI;

export function defineInstances2(L: LevelBuild) {
  const M = L.ctx.materials;
  // a work shoe, toe towards +Z, 0.29 long — black safety boots, brown leather, white trainers
  const shoe = (b: Builder, m: Mat) => {
    b.box(m, 0, 0.015, 0.0, 0.1, 0.03, 0.29);
    b.sphere(m, 0.004, 0.06, 0.075, 0.055, 8, 0.85, 0.92, 1.25);
    b.box(m, 0, 0.07, -0.06, 0.09, 0.09, 0.17);
    b.cyl(m, 0, 0.12, -0.075, 0.048, 0.06, 'y', 8);
    b.box(m, 0.0, 0.135, -0.13, 0.08, 0.06, 0.04);
  };
  L.defineInstance('shoe', M.get('rubber'), true, (b) => shoe(b, 'rubber'));
  const brown = M.clone('rubber', { color: 0xb07850, roughness: 0.6 }); brown.name = 'leather';
  L.defineInstance('shoe_b', brown, true, (b) => shoe(b, brown));
  L.defineInstance('shoe_w', M.get('plastic_white'), true, (b) => shoe(b, 'plastic_white'));
  L.defineInstance('shoe_lace', M.get('plastic_white'), false, (b) => {
    for (let i = 0; i < 3; i++) b.box('plastic_white', 0, 0.112 - i * 0.012, 0.02 + i * 0.03, 0.06, 0.006, 0.008);
  });
  // a folded coverall: a flat stack 0.36 × 0.1 × 0.3 with a collar fold and a sleeve tucked on top
  L.defineInstance('coverall', M.get('cloth_coverall'), true, (b) => {
    b.box('cloth_coverall', 0, 0.045, 0, 0.36, 0.09, 0.3);
    b.box('cloth_coverall', 0, 0.093, -0.1, 0.34, 0.012, 0.1);
    b.box('cloth_coverall', 0, 0.096, 0.03, 0.06, 0.01, 0.2);
    b.cyl('cloth_coverall', 0.17, 0.045, 0, 0.04, 0.3, 'z', 6);
    b.cyl('cloth_coverall', -0.17, 0.045, 0, 0.04, 0.3, 'z', 6);
  });
  // an id badge: white card, photo square, a strip; the lanyard clip
  L.defineInstance('badge', M.get('plastic_white'), false, (b) => {
    b.box('plastic_white', 0, 0.002, 0, 0.055, 0.004, 0.086);
    b.box('plastic_white', 0, 0.005, -0.048, 0.012, 0.003, 0.012);
  });
  L.defineInstance('badge_photo', M.get('plastic_dark'), false, (b) => {
    b.box('plastic_dark', -0.008, 0.0045, 0.012, 0.03, 0.001, 0.036);
    b.box('plastic_dark', 0.0, 0.0045, -0.024, 0.044, 0.001, 0.006);
  });
  // finished torso shell (front half) and a head shell, as stacked on pallets
  L.defineInstance('shell_torso', M.get('robot_shell'), true, (b) => {
    b.push(0, 0, 0, 0, -PI / 2);
    lathe(b, 'robot_shell', [[0.001, 0.0], [0.16, 0.01], [0.2, 0.05], [0.21, 0.1], [0.2, 0.13], [0.002, 0.135]], 0, 0, 0, 14);
    b.pop();
  });
  L.defineInstance('shell_head', M.get('robot_shell'), true, (b) => {
    b.sphere('robot_shell', 0, 0.11, 0, 0.11, 12, 1.15, 1, 1.05);
  });
  L.defineInstance('visor', M.get('painted_dark'), false, (b) => b.sphere('painted_dark', 0, 0.105, 0.05, 0.08, 10, 1.1, 1.05, 0.9));
}

// ───────────────────────────────────────────────────────────── staff belongings

/** A pair of shoes side by side at the local origin, toes towards +Z. `skew` turns the pair a little. */
export function shoePair(b: Builder, skew = 0, lace = true) {
  // (instances cannot be mirrored — a negative scale would turn them inside out — so both feet share a last)
  b.inst('shoe', -0.065, 0, 0, 0, skew + 0.04, 0);
  b.inst('shoe', 0.065, 0, 0, 0, skew - 0.04, 0);
  if (lace) { b.inst('shoe_lace', -0.065, 0, 0, 0, skew + 0.04); b.inst('shoe_lace', 0.065, 0, 0, 0, skew - 0.04); }
}

/** Shrink-wrap film over a box (thin, double-sided glass-ish quads). */
export function wrap(b: Builder, L: LevelBuild, w: number, h: number, d: number) {
  const m = filmMat(L);
  b.detail(() => {
    b.quad(m, 0, h / 2, d / 2, w, h, '+z', 0, 'box', 0.003).quad(m, 0, h / 2, -d / 2, w, h, '-z', 0, 'box', 0.003);
    b.quad(m, w / 2, h / 2, 0, d, h, '+x', 0, 'box', 0.003).quad(m, -w / 2, h / 2, 0, d, h, '-x', 0, 'box', 0.003);
    b.quad(m, 0, h, 0, w, d, '+y', 0, 'box', 0.003);
  });
}
let _film: THREE.MeshStandardMaterial | null = null;
export function filmMat(L: LevelBuild): THREE.MeshStandardMaterial {
  if (!_film) { _film = L.ctx.materials.clone('glass', { color: 0xd8e2e6, roughness: 0.25 }); _film.name = 'film'; }
  return _film;
}

/** Finished torso shells on a pallet, n × m columns of `levels`, wrapped. Origin = pallet centre on the floor. */
export function shellPallet(b: Builder, L: LevelBuild, cols: number, rows: number, levels: number, heads = false) {
  // pallet
  for (let i = 0; i < 5; i++) b.box('painted_dark', -0.55 + i * 0.275, 0.13, 0, 0.12, 0.022, 1.0);
  for (const z of [-0.45, 0, 0.45]) b.box('plastic_dark', 0, 0.065, z, 1.2, 0.09, 0.09);
  const y0 = 0.142;
  b.box('painted_dark', 0, y0 + 0.005, 0, 1.16, 0.01, 0.96);
  const dx = 1.1 / cols, dz = 0.92 / rows;
  for (let l = 0; l < levels; l++) {
    const y = y0 + 0.012 + l * 0.15;
    if (l) b.detail(() => b.box('plastic_dark', 0, y - 0.006, 0, 1.14, 0.008, 0.94)); // slip sheet
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = -0.55 + (i + 0.5) * dx, z = -0.46 + (j + 0.5) * dz;
      if (heads) { b.inst('shell_head', x, y, z, 0, PI, 0, 0.9); b.inst('visor', x, y, z, 0, PI, 0, 0.9); }
      else b.inst('shell_torso', x, y, z, 0, 0, 0, 0.9);
    }
  }
  const h = y0 + levels * (heads ? 0.22 : 0.15) + 0.02;
  // corner boards + strapping
  b.detail(() => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('plastic_white', sx * 0.575, y0 + h / 2, sz * 0.475, 0.04, h - y0, 0.04);
    for (const z of [-0.25, 0.25]) { b.box('plastic_dark', 0, y0 + h - 0.12, z, 1.2, 0.006, 0.02); b.box('plastic_dark', 0.6, y0 + (h - y0) / 2, z, 0.006, h - y0, 0.02); b.box('plastic_dark', -0.6, y0 + (h - y0) / 2, z, 0.006, h - y0, 0.02); }
  });
  b.push(0, y0, 0); wrap(b, L, 1.2, h - y0, 1.0); b.pop();
  b.collide(-0.6, 0, -0.5, 0.6, h, 0.5);
  return h;
}

// ───────────────────────────────────────────────────────────── scrolling belts

/**
 * A private clone of `name` whose texture coordinates scroll (belts, treadmills). One shader program for
 * every scrolling material; each clone has its own offset uniform. `axis` = which UV axis runs along the belt.
 */
export function scrollMat(L: LevelBuild, name: 'conveyor_belt' | 'rubber' | 'floor_plate', axis: 'u' | 'v'): { mat: THREE.MeshStandardMaterial; offset: { value: number } } {
  const mat = L.ctx.materials.clone(name);
  const offset = { value: 0 };
  const prev = mat.onBeforeCompile;
  const comp = axis === 'u' ? 'x' : 'y';
  mat.onBeforeCompile = function (shader, r) {
    prev?.call(this, shader, r);
    shader.uniforms.uScroll = offset;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uScroll;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
  #ifdef USE_MAP
    vMapUv.${comp} += uScroll * mapTransform[0][0];
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv.${comp} += uScroll * normalMapTransform[0][0];
  #endif
  #ifdef USE_AOMAP
    vAoMapUv.${comp} += uScroll * aoMapTransform[0][0];
  #endif
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv.${comp} += uScroll * roughnessMapTransform[0][0];
  #endif
  #ifdef USE_METALNESSMAP
    vMetalnessMapUv.${comp} += uScroll * metalnessMapTransform[0][0];
  #endif`);
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|scroll-${comp}`;
  mat.name = `${name}_scroll`;
  return { mat, offset };
}

// ───────────────────────────────────────────────────────────── engraved brass / printed labels

/** Canvas texture with engraved (dark, slightly bevelled) text on a transparent background. */
export function engravedMat(lines: string[], aspect: number, opts: { color?: string; light?: string; font?: string; px?: number } = {}): THREE.MeshStandardMaterial {
  const W = opts.px ?? 1024, H = Math.max(32, Math.round(W / aspect));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const fam = opts.font ?? '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  const n = lines.length;
  let size = Math.floor(H / (n * 1.45));
  g.font = `700 ${size}px ${fam}`;
  for (const ln of lines) while (g.measureText(ln).width > W * 0.88 && size > 8) { size--; g.font = `700 ${size}px ${fam}`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((ln, i) => {
    const y = H / 2 + (i - (n - 1) / 2) * size * 1.3;
    g.fillStyle = opts.light ?? 'rgba(255,240,200,0.55)'; g.fillText(ln, W / 2 + 1.5, y + 1.5);
    g.fillStyle = opts.color ?? 'rgba(28,20,8,0.92)'; g.fillText(ln, W / 2, y);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.4, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

// ───────────────────────────────────────────────────────────── reveal-able writing

/**
 * Adds a `reveal` uniform (0..1, left → right) to a transparent writing material: fragments right of the
 * reveal edge are discarded (with a soft felt-tip edge). Used for marker text being written on glass.
 */
export function revealable(mat: THREE.MeshStandardMaterial): { value: number } {
  const u = { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = u;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReveal;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  #ifdef USE_MAP
    diffuseColor.a *= smoothstep(uReveal + 0.004, uReveal - 0.004, vMapUv.x);
  #endif`);
  };
  mat.customProgramCacheKey = () => 'cb-reveal';
  return u;
}

// ───────────────────────────────────────────────────────────── misc props

/** Rotary floor buffer: origin under the pad centre, handle rising towards -Z (operator side). */
export function polisherBody(b: Builder) {
  b.cyl('painted_dark', 0, 0.12, 0, 0.24, 0.14, 'y', 18);
  b.cyl('painted_orange', 0, 0.22, 0, 0.17, 0.12, 'y', 16);
  b.cyl('trim_steel', 0, 0.3, 0, 0.1, 0.06, 'y', 12);
  b.box('painted_dark', 0, 0.2, -0.24, 0.24, 0.12, 0.12);
  for (const s of [-1, 1]) b.cyl('rubber', s * 0.12, 0.06, -0.3, 0.05, 0.04, 'x', 10);
  b.rod('chrome', 0, 0.28, -0.12, 0, 0.92, -0.62, 0.018, 8);
  b.rod('chrome', -0.22, 0.95, -0.66, 0.22, 0.95, -0.66, 0.016, 8);
  for (const s of [-1, 1]) b.cyl('rubber', s * 0.18, 0.95, -0.66, 0.022, 0.1, 'x', 8);
  b.box('painted_dark', 0, 0.9, -0.6, 0.12, 0.1, 0.08);
  b.detail(() => {
    hose(b, 'rubber', [[0.05, 0.92, -0.6], [0.2, 0.6, -0.5], [0.4, 0.05, -0.9], [1.4, 0.03, -1.4]], 0.01, 5, 5);
    b.inst('led_green', 0, 0.94, -0.56, -0.6);
  });
}
/** The spinning pad (separate so it can turn). */
export function polisherPad(b: Builder) {
  b.cyl('rubber', 0, 0.025, 0, 0.23, 0.05, 'y', 18);
  b.cyl('plastic_white', 0, 0.002, 0, 0.21, 0.004, 'y', 18);
  for (let i = 0; i < 3; i++) { const a = (i * 2 * PI) / 3; b.box('painted_dark', Math.cos(a) * 0.12, 0.052, Math.sin(a) * 0.12, 0.06, 0.006, 0.03); }
}

/** Work glove lying on the floor (palm down, fingers towards +Z). */
export function glove(b: Builder, mat: Mat = 'painted_orange') {
  b.detail(() => {
    b.sphere(mat, 0, 0.018, 0, 0.055, 8, 0.35, 0.9, 1.1);
    for (let i = 0; i < 4; i++) b.rbox(mat, -0.035 + i * 0.023, 0.012, 0.085 + (i === 0 || i === 3 ? -0.01 : 0), 0.018, 0.016, 0.07, 0, (i - 1.5) * 0.08, 0);
    b.rbox(mat, 0.058, 0.012, 0.02, 0.018, 0.016, 0.06, 0, -0.7, 0);
    b.box('cloth_coverall', 0, 0.02, -0.08, 0.1, 0.03, 0.06);
  });
}

/** A coverall left lying in a heap (jacket on the floor): a few slumped folds of cloth. */
export function clothHeap(b: Builder, mat: Mat = 'cloth_coverall') {
  b.detail(() => {
    b.sphere(mat, 0, 0.04, 0, 0.3, 10, 0.18, 1.0, 0.8);
    b.sphere(mat, 0.12, 0.07, 0.08, 0.18, 8, 0.3, 1.2, 0.8);
    b.rbox(mat, -0.32, 0.03, 0.12, 0.42, 0.05, 0.1, 0, 0.6, 0);
    b.rbox(mat, 0.25, 0.03, -0.24, 0.38, 0.05, 0.1, 0, -0.4, 0);
    b.box('chrome', 0.05, 0.1, 0.05, 0.012, 0.004, 0.18); // zip
  });
}

/** Wall-mounted intercom panel on a +Z surface: speaker grille, call button, LED. */
export function intercomPanel(b: Builder, y: number) {
  b.box('painted_dark', 0, y, 0.025, 0.2, 0.3, 0.05);
  b.detail(() => {
    panelOn(b, 'trim_steel', 0, y, 0.05, 0.17, 0.27, '+z', 0.008, 0.008);
    for (let i = 0; i < 6; i++) b.box('painted_dark', 0, y + 0.08 - i * 0.022, 0.06, 0.11, 0.008, 0.004);
    b.cyl('emissive_red', 0, y - 0.08, 0.062, 0.022, 0.012, 'z', 12);
    b.cyl('trim_steel', 0, y - 0.08, 0.057, 0.03, 0.01, 'z', 12);
    b.inst('led_green', 0.06, y + 0.12, 0.058);
  });
}

/** Coiled phone-style cable between two points. */
export function coilCord(b: Builder, p: [number, number, number], q: [number, number, number]) {
  b.detail(() => cable(b, 'plastic_dark', p, q, 0.12, 0.006, 10, 4));
}
