// STUB — replaced by the materials task. Flat colours only.
import * as THREE from 'three';
import type { GameContext, MaterialLibrary, MaterialName } from '../core/types';

const COLORS: Record<string, number> = {
  wall_panel: 0x56605a, wall_panel_dark: 0x30343a, wall_medical: 0xb9c0bd, floor_plate: 0x3a3d40, floor_grate: 0x2a2c2e,
  floor_rubber: 0x1c1e20, floor_concrete: 0x55524e, ceiling_panel: 0x222426, trim_steel: 0x6a6e72, hazard_stripes: 0xc9a21a,
  painted_yellow: 0xc29a12, painted_orange: 0xc2551a, painted_white: 0xcfd2d0, painted_dark: 0x16181a, gunmetal: 0x23262a,
  chrome: 0xd0d4d8, steel_raw: 0x7c8085, rust: 0x6b3a1e, copper: 0xa5633a, brass: 0xb59a48, rubber: 0x111111,
  plastic_dark: 0x1a1b1d, plastic_white: 0xd8d8d2, fabric: 0x4a5560, glass: 0x9fb4bb, screen_off: 0x050607,
  robot_shell: 0xc8cac6, robot_frame: 0x1d1f22, robot_joint: 0x4a4d50,
};
const EMISSIVE: Record<string, number> = {
  emissive_white: 0xe8f2ff, emissive_warm: 0xffd9a0, emissive_red: 0xff2010, emissive_amber: 0xff9a20,
  emissive_cyan: 0x30e0ff, emissive_green: 0x40ff70,
};

export async function createMaterials(_ctx: GameContext): Promise<MaterialLibrary> {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const make = (name: string) => {
    if (name in EMISSIVE) return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: EMISSIVE[name], emissiveIntensity: 2 });
    if (!(name in COLORS)) console.warn(`[materials] unknown material "${name}"`);
    const metal = /steel|chrome|gunmetal|plate|grate|copper|brass|frame|joint|panel/.test(name);
    return new THREE.MeshStandardMaterial({
      color: COLORS[name] ?? 0xff00ff, roughness: metal ? 0.45 : 0.8, metalness: metal ? 0.8 : 0.0,
      transparent: name === 'glass', opacity: name === 'glass' ? 0.25 : 1,
    });
  };
  const get = (name: MaterialName) => {
    let m = cache.get(name);
    if (!m) cache.set(name, (m = make(name)));
    return m;
  };
  return {
    get,
    clone(name, overrides) { const m = get(name).clone(); if (overrides) m.setValues(overrides); return m; },
    decal() { return new THREE.MeshBasicMaterial({ color: 0x220000, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }); },
    sign() { return new THREE.MeshStandardMaterial({ color: 0xd0c040, roughness: 0.7 }); },
    screen() { return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x20ff80, emissiveIntensity: 1 }); },
    setScreen() {},
    setEnvMap() {},
    update() {},
  };
}
