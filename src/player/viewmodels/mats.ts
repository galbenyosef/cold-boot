/** Resolved material set for weapons, hands and props (shared instances; private clones where tinted). */
import * as THREE from 'three';
import type { MaterialLibrary, MaterialName } from '../../core/types';
import { litForViewmodel } from './vmlight';

export interface VmMats {
  gunmetal: THREE.Material;
  steel: THREE.Material;
  chrome: THREE.Material;
  brass: THREE.Material;
  copper: THREE.Material;
  rubber: THREE.Material;
  polymer: THREE.Material;
  plasticDark: THREE.Material;
  interior: THREE.Material;
  /** Plain glove textile (sleeve gauntlet). */
  glove: THREE.Material;
  /** Glove textile tinted per vertex (hands). */
  gloveVC: THREE.Material;
  /** Velcro strap / bindings. */
  gloveStrap: THREE.Material;
  gloveArmor: THREE.Material;
  sleeve: THREE.Material;
  shellHull: THREE.Material;
  white: THREE.Material;
  plasticWhite: THREE.Material;
  emGreen: THREE.MeshStandardMaterial;
  emRed: THREE.MeshStandardMaterial;
  emCyan: THREE.MeshStandardMaterial;
  emWhite: THREE.MeshStandardMaterial;
  emAmber: THREE.MeshStandardMaterial;
  /** Lit LED segments on the wrist unit (private clone, tinted by health). */
  wristLed: THREE.MeshStandardMaterial;
}

/**
 * `viewmodel` = the first-person set: every material is a private clone carrying the viewmodel light terms
 * (see vmlight.ts). The plain set is for the same models out in the world (pickups, brass, dropped magazines).
 */
export function resolveMats(lib: MaterialLibrary, viewmodel = false): VmMats {
  const get = (n: MaterialName) => (viewmodel ? lib.clone(n) : lib.get(n));
  const m: VmMats = {
    gunmetal: get('gunmetal'),
    steel: get('steel_raw'),
    chrome: get('chrome'),
    brass: get('brass'),
    copper: get('copper'),
    rubber: get('rubber'),
    polymer: lib.clone('plastic_dark', { color: 0x1d1f21, roughness: 0.8 }),
    plasticDark: get('plastic_dark'),
    interior: lib.clone('plastic_dark', { color: 0x050505, roughness: 0.9, metalness: 0.2 }),
    glove: lib.clone('fabric', { color: new THREE.Color(0.125, 0.092, 0.07), roughness: 0.92, metalness: 0 }),
    gloveVC: lib.clone('fabric', { color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true }),
    gloveStrap: lib.clone('fabric', { color: new THREE.Color(0.04, 0.04, 0.04), roughness: 1, metalness: 0 }),
    gloveArmor: lib.clone('rubber', { color: 0x34373a, roughness: 0.62 }),
    sleeve: lib.clone('fabric', { color: new THREE.Color(0.06, 0.05, 0.042), roughness: 0.95, metalness: 0 }),
    shellHull: lib.clone('plastic_dark', { color: 0x7a1712, roughness: 0.45, metalness: 0 }),
    white: get('painted_white'),
    plasticWhite: get('plastic_white'),
    emGreen: lib.clone('emissive_green', { emissiveIntensity: 3.5 }),
    emRed: lib.clone('emissive_red', { emissiveIntensity: 3 }),
    emCyan: lib.clone('emissive_cyan', { emissiveIntensity: 1.6 }),
    emWhite: get('emissive_white'),
    emAmber: get('emissive_amber'),
    wristLed: lib.clone('emissive_cyan', { emissiveIntensity: 1.8 }),
  };
  // close-up textiles: stronger weave relief than the world-scale default
  for (const f of [m.glove, m.gloveVC, m.gloveStrap, m.sleeve] as THREE.MeshStandardMaterial[]) f.normalScale?.multiplyScalar(2.2);
  if (viewmodel) for (const k of Object.keys(m) as (keyof VmMats)[]) litForViewmodel(m[k]);
  return m;
}
