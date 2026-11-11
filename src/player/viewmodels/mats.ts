/** Resolved material set for weapons, hands and props (shared instances; private clones where tinted). */
import * as THREE from 'three';
import type { MaterialLibrary } from '../../core/types';

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
  glove: THREE.Material;
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

export function resolveMats(lib: MaterialLibrary): VmMats {
  return {
    gunmetal: lib.get('gunmetal'),
    steel: lib.get('steel_raw'),
    chrome: lib.get('chrome'),
    brass: lib.get('brass'),
    copper: lib.get('copper'),
    rubber: lib.get('rubber'),
    polymer: lib.clone('plastic_dark', { color: 0x1d1f21, roughness: 0.62 }),
    plasticDark: lib.get('plastic_dark'),
    interior: lib.clone('plastic_dark', { color: 0x050505, roughness: 0.9, metalness: 0.2 }),
    glove: lib.clone('fabric', { color: 0x1b1c1c, roughness: 0.92, metalness: 0 }),
    gloveArmor: lib.clone('rubber', { color: 0x161718, roughness: 0.55 }),
    sleeve: lib.clone('fabric', { color: 0x262d35, roughness: 0.95, metalness: 0 }),
    shellHull: lib.clone('plastic_dark', { color: 0x7a1712, roughness: 0.45, metalness: 0 }),
    white: lib.get('painted_white'),
    plasticWhite: lib.get('plastic_white'),
    emGreen: lib.clone('emissive_green', { emissiveIntensity: 3.5 }),
    emRed: lib.clone('emissive_red', { emissiveIntensity: 3 }),
    emCyan: lib.clone('emissive_cyan', { emissiveIntensity: 1.6 }),
    emWhite: lib.get('emissive_white'),
    emAmber: lib.get('emissive_amber'),
    wristLed: lib.clone('emissive_cyan', { emissiveIntensity: 1.8 }),
  };
}
