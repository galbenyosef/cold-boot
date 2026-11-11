/** Small shared props: shotgun shell, pistol casing (ejected brass). Built along +Y. */
import * as THREE from 'three';
import { M, Parts, latheZ, cylY, type G } from '../geom';
import type { VmMats } from './mats';

/** 12ga shell standing on its brass head, +Y toward the crimp. Length ≈ 0.064. */
export function buildShell(m: VmMats): THREE.Group {
  const p = new Parts();
  // brass head with rim + primer
  const brass = latheZ([
    [[0.0, 0.0], [0.0113, 0.0]],
    [[0.0113, 0.0], [0.0113, 0.0016]],
    [[0.0113, 0.0016], [0.0104, 0.0019], [0.0104, 0.016]],
    [[0.0104, 0.016], [0.0101, 0.0166]],
  ], 22);
  p.add(brass, m.brass, M(0, 0, 0, Math.PI / 2, 0, 0)); // s → +Y
  p.add(latheZ([[[0.0, -0.0003], [0.0028, -0.0003]]], 14), m.copper, M(0, 0, 0, Math.PI / 2, 0, 0));
  // plastic hull with rounded star-crimp end
  const hull = latheZ([
    [[0.0101, 0.016], [0.0101, 0.0605]],
    [[0.0101, 0.0605], [0.0096, 0.0625], [0.0082, 0.0637], [0.0, 0.0641]],
  ], 22);
  p.add(hull, m.shellHull, M(0, 0, 0, Math.PI / 2, 0, 0));
  // crimp folds
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    p.add(new THREE.BoxGeometry(0.0004, 0.0003, 0.0085), m.interior, M(Math.cos(a) * 0.0042, 0.0641, Math.sin(a) * 0.0042, 0, -a, 0));
  }
  const g = new THREE.Group();
  p.build(g);
  return g;
}

/** Fired 9mm casing (open mouth), +Y toward the mouth. */
export function buildCasingGeo(): G {
  const g = latheZ([
    [[0.0, 0.0], [0.0050, 0.0]],
    [[0.0050, 0.0], [0.0050, 0.0012]],
    [[0.0050, 0.0012], [0.0042, 0.0016], [0.0042, 0.0026], [0.0049, 0.0031]],
    [[0.0049, 0.0031], [0.00478, 0.019]],
    [[0.00478, 0.019], [0.0044, 0.019]],
    [[0.0044, 0.019], [0.0044, 0.006]],
    [[0.0044, 0.006], [0.0, 0.006]],
  ], 14);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Fired shotgun hull (opened crimp), +Y toward the mouth. */
export function buildSpentShellParts(m: VmMats): THREE.Group {
  const p = new Parts();
  p.add(latheZ([
    [[0.0, 0.0], [0.0113, 0.0]], [[0.0113, 0.0], [0.0113, 0.0016]],
    [[0.0113, 0.0016], [0.0104, 0.0019], [0.0104, 0.016]],
  ], 16), m.brass, M(0, 0, 0, Math.PI / 2, 0, 0));
  p.add(latheZ([[[0.0101, 0.016], [0.0101, 0.062], [0.0106, 0.066]], [[0.0106, 0.066], [0.0094, 0.066]], [[0.0094, 0.066], [0.009, 0.02]]], 16), m.shellHull, M(0, 0, 0, Math.PI / 2, 0, 0));
  const g = new THREE.Group();
  p.build(g);
  return g;
}

void cylY;
