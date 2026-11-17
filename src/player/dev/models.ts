import type * as THREE from 'three';
import type { VmMats } from '../viewmodels/mats';
import { buildShotgun } from '../viewmodels/shotgun';
import { buildShell, buildSpentShellParts } from '../viewmodels/props';
import { buildCarbine, buildCarbineMag } from '../viewmodels/carbine';

export function register(reg: (name: string, b: (m: VmMats) => THREE.Object3D) => void) {
  reg('shotgun', (m) => buildShotgun(m).root);
  reg('shell', (m) => buildShell(m));
  reg('carbine', (m) => buildCarbine(m).root);
  reg('cmag', (m) => { const g = buildCarbineMag(m); g.setRounds(Number(new URLSearchParams(location.search).get('rounds') ?? 30)); return g.root; });
  reg('spent', (m) => buildSpentShellParts(m));
}
