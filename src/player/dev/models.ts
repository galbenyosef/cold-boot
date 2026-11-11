import type * as THREE from 'three';
import type { VmMats } from '../viewmodels/mats';
import { buildShotgun } from '../viewmodels/shotgun';
import { buildShell, buildSpentShellParts } from '../viewmodels/props';

export function register(reg: (name: string, b: (m: VmMats) => THREE.Object3D) => void) {
  reg('shotgun', (m) => buildShotgun(m).root);
  reg('shell', (m) => buildShell(m));
  reg('spent', (m) => buildSpentShellParts(m));
}
