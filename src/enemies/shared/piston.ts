/** Two-part hydraulic piston whose cylinder + rod bones aim at each other across a joint. */
import * as THREE from 'three';
import type { Rig } from './rig';

const _wa = new THREE.Vector3(), _wb = new THREE.Vector3(), _d = new THREE.Vector3(), _l = new THREE.Vector3();

function toLocalDir(parent: THREE.Object3D, world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const e = parent.matrixWorld.elements;
  // inverse rotation = transpose (no scale on parents)
  out.set(e[0] * world.x + e[1] * world.y + e[2] * world.z, e[4] * world.x + e[5] * world.y + e[6] * world.z, e[8] * world.x + e[9] * world.y + e[10] * world.z);
  return out.normalize();
}

export class Piston {
  private cyl: THREE.Bone; private rod: THREE.Bone;
  private pa: THREE.Object3D; private pb: THREE.Object3D;
  private bindDir = new THREE.Vector3(); private bindDirNeg = new THREE.Vector3();

  /** a / b: anchor points in MODEL space at bind pose; cyl bone sits at a, rod bone at b. */
  constructor(rig: Rig, cyl: string, rod: string, a: THREE.Vector3, b: THREE.Vector3) {
    this.cyl = rig.b(cyl); this.rod = rig.b(rod);
    this.pa = this.cyl.parent!; this.pb = this.rod.parent!;
    this.bindDir.copy(b).sub(a).normalize();
    this.bindDirNeg.copy(this.bindDir).negate();
  }

  /** Requires parents' matrixWorld to be current. Updates the two leaf bones (and their matrixWorld). */
  update(): void {
    _wa.setFromMatrixPosition(this.cyl.matrixWorld);
    _wb.setFromMatrixPosition(this.rod.matrixWorld);
    _d.copy(_wb).sub(_wa);
    if (_d.lengthSq() < 1e-8) return;
    this.cyl.quaternion.setFromUnitVectors(this.bindDir, toLocalDir(this.pa, _d, _l));
    _d.negate();
    this.rod.quaternion.setFromUnitVectors(this.bindDirNeg, toLocalDir(this.pb, _d, _l));
    this.cyl.updateMatrixWorld(true);
    this.rod.updateMatrixWorld(true);
  }
}
