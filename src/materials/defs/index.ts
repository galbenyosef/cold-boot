/**
 * Material registry: every MaterialName → texture bake definition + MeshStandardMaterial parameters.
 * Tile sizes are in metres (geometry UVs are metres), see TILE in the final report / README of the module.
 */
import * as THREE from 'three';
import type { MaterialName } from '../../core/types';
import type { TexDef } from '../baker';
import { WALL_PANEL, WALL_DARK, WALL_MEDICAL, CEILING } from './walls';
import { FLOOR_PLATE, FLOOR_GRATE, FLOOR_RUBBER, FLOOR_CONCRETE } from './floors';
import { PAINTED, METAL, POLY, RUST, FABRIC, GLASS, BELT, GLASS_THICK, SKIN } from './props';
import { ROBOT_SHELL } from './robot';

export interface MatSpec {
  tex?: Omit<TexDef, 'key'>;
  params: THREE.MeshStandardMaterialParameters;
  /** envMapIntensity multiplier relative to the global intensity. */
  env: number;
  normalScale?: number;
  /** World-space macro variation (albedo, roughness) amounts, anti-tiling. */
  macro?: [number, number];
  /** Premultiplied-style glass blending (reflections are not faded by opacity). */
  glass?: boolean;
}

/** Uniform colours are authored as raw sRGB triplets (the bake shader linearises at the end). */
const srgb = (hex: number) => { const c = new THREE.Color(); c.setHex(hex, THREE.LinearSRGBColorSpace); return new THREE.Vector3(c.r, c.g, c.b); };

const U_WALL = 'uniform vec3 uBase; uniform float uGrime;\n';
const U_PAINT = 'uniform vec3 uColA; uniform vec3 uColB; uniform float uStripe; uniform float uWear; uniform float uPaintRough; uniform float uGrime; uniform float uPeel;\n';
const U_METAL = 'uniform vec3 uCol; uniform vec3 uCol2; uniform vec3 uScratchCol; uniform vec2 uRough; uniform vec2 uBrush; uniform float uScratch; uniform float uOxide; uniform float uPatina; uniform float uOil; uniform float uGrime; uniform float uMachine; uniform float uMetal; uniform float uSmudge;\n';
const U_POLY = 'uniform vec3 uCol; uniform vec2 uRough; uniform float uGrain; uniform float uScuff; uniform float uDust; uniform float uSmudge; uniform float uYellow; uniform float uGrime;\n';

const G_WALL = U_WALL + WALL_PANEL;
const G_WALL_DARK = U_WALL + WALL_DARK;
const G_MED = U_WALL + WALL_MEDICAL;
const G_CEIL = U_WALL + CEILING;
const G_PLATE = U_WALL + FLOOR_PLATE;
const G_GRATE = U_WALL + FLOOR_GRATE;
const G_RUBBERF = U_WALL + FLOOR_RUBBER;
const G_CONC = U_WALL + FLOOR_CONCRETE;
const G_PAINT = U_PAINT + PAINTED;
const G_METAL = U_METAL + METAL;
const G_POLY = U_POLY + POLY;
const G_RUST = RUST;
const G_FABRIC = 'uniform vec3 uCol;\n' + FABRIC;
const G_GLASS = GLASS;
const G_SHELL = U_WALL + ROBOT_SHELL;
const G_BELT = BELT;
const G_GLASS_THICK = GLASS_THICK;
const G_SKIN = 'uniform vec3 uCol;\n' + SKIN;

const wall = (base: number, grime: number) => ({ uBase: { value: srgb(base) }, uGrime: { value: grime } });
const paint = (a: number, b: number, o: { stripe?: number; wear?: number; rough?: number; grime?: number; peel?: number } = {}) => ({
  uColA: { value: srgb(a) }, uColB: { value: srgb(b) }, uStripe: { value: o.stripe ?? 0 }, uWear: { value: o.wear ?? 0.5 },
  uPaintRough: { value: o.rough ?? 0.45 }, uGrime: { value: o.grime ?? 0.7 }, uPeel: { value: o.peel ?? 0.0025 },
});
interface MetalOpts { col: number; col2?: number; scratchCol?: number; rough: [number, number]; brush?: [number, number]; scratch?: number;
  oxide?: number; patina?: number; oil?: number; grime?: number; machine?: number; metal?: number; smudge?: number }
const metal = (o: MetalOpts) => ({
  uCol: { value: srgb(o.col) }, uCol2: { value: srgb(o.col2 ?? o.col) }, uScratchCol: { value: srgb(o.scratchCol ?? 0xb8bcc0) },
  uRough: { value: new THREE.Vector2(...o.rough) }, uBrush: { value: new THREE.Vector2(...(o.brush ?? [0, 0])) },
  uScratch: { value: o.scratch ?? 0.5 }, uOxide: { value: o.oxide ?? 0 }, uPatina: { value: o.patina ?? 0 }, uOil: { value: o.oil ?? 0 },
  uGrime: { value: o.grime ?? 0.5 }, uMachine: { value: o.machine ?? 0 }, uMetal: { value: o.metal ?? 1 }, uSmudge: { value: o.smudge ?? 0 },
});
interface PolyOpts { col: number; rough: [number, number]; grain?: number; scuff?: number; dust?: number; smudge?: number; yellow?: number; grime?: number }
const poly = (o: PolyOpts) => ({
  uCol: { value: srgb(o.col) }, uRough: { value: new THREE.Vector2(...o.rough) }, uGrain: { value: o.grain ?? 0.02 },
  uScuff: { value: o.scuff ?? 0.5 }, uDust: { value: o.dust ?? 0.3 }, uSmudge: { value: o.smudge ?? 0 }, uYellow: { value: o.yellow ?? 0 },
  uGrime: { value: o.grime ?? 0.4 },
});

const HERO = 1024;
const MINOR = 512;

export const SPECS: Record<Exclude<MaterialName, `emissive_${string}`>, MatSpec> = {
  wall_panel: {
    tex: { size: HERO, tile: 2, depth: 0.02, glsl: G_WALL, uniforms: wall(0x4f5b55, 0.9), aoRadius: 0.03, seed: 1 },
    params: {}, env: 1, macro: [0.25, 0.25],
  },
  wall_panel_dark: {
    tex: { size: HERO, tile: 2, depth: 0.03, glsl: G_WALL_DARK, uniforms: wall(0x2e3439, 1.0), aoRadius: 0.04, seed: 2 },
    params: {}, env: 1, macro: [0.3, 0.25],
  },
  wall_medical: {
    tex: { size: HERO, tile: 2, depth: 0.012, glsl: G_MED, uniforms: wall(0xc4c9c5, 0.6), aoRadius: 0.02, seed: 3 },
    params: {}, env: 1, macro: [0.12, 0.2],
  },
  floor_plate: {
    tex: { size: HERO, tile: 1, depth: 0.004, glsl: G_PLATE, uniforms: wall(0, 0.9), aoRadius: 0.012, seed: 4 },
    params: {}, env: 1, macro: [0.25, 0.3],
  },
  floor_grate: {
    tex: { size: HERO, tile: 1, depth: 0.012, glsl: G_GRATE, uniforms: wall(0, 0.8), aoRadius: 0.01, seed: 5, coverageMips: true },
    params: { alphaTest: 0.5, side: THREE.DoubleSide }, env: 1, macro: [0.2, 0.2],
  },
  floor_rubber: {
    tex: { size: HERO, tile: 1, depth: 0.0035, glsl: G_RUBBERF, uniforms: wall(0x1f2123, 0.6), aoRadius: 0.01, seed: 6 },
    params: {}, env: 0.6, macro: [0.15, 0.25],
  },
  floor_concrete: {
    tex: { size: HERO, tile: 3, depth: 0.01, glsl: G_CONC, uniforms: wall(0, 0.7), aoRadius: 0.03, seed: 7 },
    params: {}, env: 0.8, macro: [0.25, 0.3],
  },
  ceiling_panel: {
    tex: { size: HERO, tile: 2, depth: 0.02, glsl: G_CEIL, uniforms: wall(0x2b2e31, 0.8), aoRadius: 0.03, seed: 8 },
    params: {}, env: 0.8, macro: [0.25, 0.2],
  },
  trim_steel: {
    tex: { size: MINOR, tile: 1, depth: 0.002, glsl: G_METAL, seed: 9, aoRadius: 0.01,
      uniforms: metal({ col: 0x8a8e93, col2: 0x5d5a52, rough: [0.22, 0.45], brush: [1, 0], scratch: 0.7, oxide: 0.2, grime: 0.35, oil: 0.15 }) },
    params: {}, env: 1.2, macro: [0.2, 0.3],
  },
  hazard_stripes: {
    tex: { size: MINOR, tile: 1, depth: 0.003, glsl: G_PAINT, seed: 10, aoRadius: 0.01,
      uniforms: paint(0xd1a011, 0x151515, { stripe: 1, wear: 0.75, rough: 0.5, grime: 0.9 }) },
    params: {}, env: 1, macro: [0.2, 0.25],
  },
  painted_yellow: {
    tex: { size: MINOR, tile: 1, depth: 0.003, glsl: G_PAINT, seed: 11, aoRadius: 0.01, uniforms: paint(0xc89a10, 0, { wear: 0.55 }) },
    params: {}, env: 1, macro: [0.15, 0.2],
  },
  painted_orange: {
    tex: { size: MINOR, tile: 1, depth: 0.003, glsl: G_PAINT, seed: 12, aoRadius: 0.01, uniforms: paint(0xc24e18, 0, { wear: 0.5 }) },
    params: {}, env: 1, macro: [0.15, 0.2],
  },
  painted_white: {
    tex: { size: MINOR, tile: 1, depth: 0.003, glsl: G_PAINT, seed: 13, aoRadius: 0.01, uniforms: paint(0xcdd0cc, 0, { wear: 0.45, rough: 0.35, grime: 0.8 }) },
    params: {}, env: 1, macro: [0.12, 0.2],
  },
  painted_dark: {
    tex: { size: MINOR, tile: 1, depth: 0.003, glsl: G_PAINT, seed: 14, aoRadius: 0.01,
      uniforms: paint(0x1c1e20, 0, { wear: 0.4, rough: 0.58, grime: 0.5, peel: 0.006 }) },
    params: {}, env: 1, macro: [0.15, 0.15],
  },
  gunmetal: {
    tex: { size: MINOR, tile: 0.5, depth: 0.001, glsl: G_METAL, seed: 15, aoRadius: 0.005,
      uniforms: metal({ col: 0x2b3036, col2: 0x1b1d22, scratchCol: 0x8a9096, rough: [0.26, 0.42], brush: [0.5, 0], scratch: 0.45, oxide: 0.2, oil: 0.35, grime: 0.3, machine: 0.6 }) },
    params: {}, env: 1.2,
  },
  chrome: {
    tex: { size: MINOR, tile: 1, depth: 0.0006, glsl: G_METAL, seed: 16, aoRadius: 0.005,
      uniforms: metal({ col: 0xe2e5e8, col2: 0xa8a49a, scratchCol: 0xf0f2f4, rough: [0.04, 0.12], scratch: 0.35, oxide: 0.1, grime: 0.2, smudge: 0.8 }) },
    params: {}, env: 1.4,
  },
  steel_raw: {
    tex: { size: MINOR, tile: 1, depth: 0.002, glsl: G_METAL, seed: 17, aoRadius: 0.01,
      uniforms: metal({ col: 0x7c8084, col2: 0x5a4a3c, rough: [0.28, 0.55], brush: [0.8, 0], scratch: 1.0, oxide: 0.3, grime: 0.5, oil: 0.15 }) },
    params: {}, env: 1.1, macro: [0.2, 0.3],
  },
  rust: {
    tex: { size: MINOR, tile: 1, depth: 0.006, glsl: G_RUST, seed: 18, aoRadius: 0.015 },
    params: {}, env: 0.5, macro: [0.2, 0.15],
  },
  copper: {
    tex: { size: MINOR, tile: 1, depth: 0.0015, glsl: G_METAL, seed: 19, aoRadius: 0.008,
      uniforms: metal({ col: 0xb06a42, col2: 0x4a2618, scratchCol: 0xe09068, rough: [0.28, 0.5], brush: [0.6, 0], scratch: 0.4, oxide: 0.9, patina: 0.35, grime: 0.5 }) },
    params: {}, env: 1.1, macro: [0.2, 0.2],
  },
  brass: {
    tex: { size: MINOR, tile: 0.25, depth: 0.0006, glsl: G_METAL, seed: 20, aoRadius: 0.003,
      uniforms: metal({ col: 0xd1b061, col2: 0x7a5f2c, scratchCol: 0xf0d890, rough: [0.2, 0.38], scratch: 0.4, oxide: 0.45, grime: 0.2, smudge: 0.4 }) },
    params: {}, env: 1.2,
  },
  rubber: {
    tex: { size: MINOR, tile: 0.5, depth: 0.0015, glsl: G_POLY, seed: 21, aoRadius: 0.005,
      uniforms: poly({ col: 0x161718, rough: [0.72, 0.9], grain: 0.06, scuff: 0.4, dust: 0.35 }) },
    params: {}, env: 0.5,
  },
  plastic_dark: {
    tex: { size: MINOR, tile: 0.5, depth: 0.0008, glsl: G_POLY, seed: 22, aoRadius: 0.005,
      uniforms: poly({ col: 0x1c1d1f, rough: [0.42, 0.6], grain: 0.04, scuff: 0.6, dust: 0.25, smudge: 0.5 }) },
    params: {}, env: 0.9,
  },
  plastic_white: {
    tex: { size: MINOR, tile: 0.5, depth: 0.0008, glsl: G_POLY, seed: 23, aoRadius: 0.005,
      uniforms: poly({ col: 0xd5d6d0, rough: [0.32, 0.48], grain: 0.03, scuff: 0.6, dust: 0.3, smudge: 0.4, yellow: 0.35, grime: 0.5 }) },
    params: {}, env: 0.9,
  },
  fabric: {
    tex: { size: MINOR, tile: 0.25, depth: 0.0012, glsl: G_FABRIC, seed: 24, aoRadius: 0.003, uniforms: { uCol: { value: srgb(0x4a5662) } } },
    params: {}, env: 0.3, macro: [0.2, 0.0],
  },
  cloth_coverall: {
    // same weave program as `fabric` (shares the compiled shader), work-wear grey-blue, coarser tile
    tex: { size: MINOR, tile: 0.3, depth: 0.0014, glsl: G_FABRIC, seed: 31, aoRadius: 0.003, uniforms: { uCol: { value: srgb(0x56677a) } } },
    params: {}, env: 0.3, macro: [0.18, 0.0],
  },
  skin: {
    tex: { size: MINOR, tile: 0.2, depth: 0.0008, glsl: G_SKIN, seed: 32, aoRadius: 0.003, uniforms: { uCol: { value: srgb(0xc69c86) } } },
    params: {}, env: 0.35,
  },
  conveyor_belt: {
    tex: { size: MINOR, tile: 1, depth: 0.004, glsl: G_BELT, seed: 33, aoRadius: 0.008 },
    params: {}, env: 0.6,
  },
  glass_thick: {
    tex: { size: MINOR, tile: 1.5, depth: 0.0005, glsl: G_GLASS_THICK, seed: 34, aoRadius: 0.002 },
    params: { transparent: true, depthWrite: false, side: THREE.DoubleSide }, env: 0.55, glass: true,
  },
  glass: {
    tex: { size: MINOR, tile: 1, depth: 0.0005, glsl: G_GLASS, seed: 25, aoRadius: 0.002 },
    params: { transparent: true, depthWrite: false, side: THREE.DoubleSide }, env: 1.6, glass: true,
  },
  screen_off: {
    tex: { size: MINOR, tile: 0.5, depth: 0.0003, glsl: G_POLY, seed: 26, aoRadius: 0.002,
      uniforms: poly({ col: 0x060708, rough: [0.06, 0.1], grain: 0.0, scuff: 0.35, dust: 0.25, smudge: 1.0, grime: 0.0 }) },
    params: {}, env: 1.3,
  },
  robot_shell: {
    tex: { size: HERO, tile: 1, depth: 0.004, glsl: G_SHELL, seed: 27, aoRadius: 0.01, uniforms: wall(0xc9cbc5, 0.7) },
    params: {}, env: 1,
  },
  robot_frame: {
    tex: { size: MINOR, tile: 0.5, depth: 0.001, glsl: G_METAL, seed: 28, aoRadius: 0.005,
      uniforms: metal({ col: 0x1f2226, col2: 0x15171a, scratchCol: 0x9a9ea2, rough: [0.32, 0.5], scratch: 0.6, oxide: 0.15, grime: 0.6, oil: 0.4, machine: 0.8 }) },
    params: {}, env: 1,
  },
  robot_joint: {
    tex: { size: MINOR, tile: 0.5, depth: 0.001, glsl: G_METAL, seed: 29, aoRadius: 0.005,
      uniforms: metal({ col: 0x8e9297, col2: 0x3a342c, rough: [0.15, 0.35], brush: [0.4, 1], scratch: 0.5, oxide: 0.2, oil: 0.9, grime: 0.7, machine: 1.0 }) },
    params: {}, env: 1.2,
  },
};

export const EMISSIVE: Record<`emissive_${string}`, { color: number; intensity: number }> = {
  emissive_white: { color: 0xe8f0ff, intensity: 4 },
  emissive_warm: { color: 0xffc47a, intensity: 4 },
  emissive_red: { color: 0xff0702, intensity: 2.2 },
  emissive_amber: { color: 0xff6a08, intensity: 2.5 },
  emissive_cyan: { color: 0x10c8ff, intensity: 2.5 },
  emissive_green: { color: 0x20ff50, intensity: 2.5 },
};
