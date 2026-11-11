/**
 * Persistent surface decals. One InstancedMesh per (decal name, variant) material, each a ring buffer.
 * All batches + materials are created at load so placing a decal never compiles or allocates.
 */
import * as THREE from 'three';
import type { DecalName, MaterialLibrary } from '../core/types';

const VARIANTS: Partial<Record<DecalName, number>> = {
  bullet_metal: 3, bullet_concrete: 3, blood_splat: 3, oil_stain: 2, oil_drip: 2, scorch: 2,
};
const CAPACITY: Partial<Record<DecalName, number>> = {
  bullet_metal: 96, bullet_concrete: 96, blood_splat: 48, oil_stain: 48, oil_drip: 32, scorch: 16,
};
export const DECAL_NAMES: DecalName[] = [
  'blood_splat', 'blood_smear', 'blood_pool', 'oil_stain', 'oil_drip', 'scorch',
  'bullet_metal', 'bullet_concrete', 'scratches', 'grime', 'handprint', 'water_stain',
];

interface Batch {
  mesh: THREE.InstancedMesh | null;
  /** Fallback when a material cannot be instanced (custom ShaderMaterial without instancing chunk). */
  singles: THREE.Mesh[] | null;
  next: number;
  used: number;
  cap: number;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const sc = new THREE.Vector3();
const pos = new THREE.Vector3();
const zAxis = new THREE.Vector3(0, 0, 1);
const nrm = new THREE.Vector3();
const qRoll = new THREE.Quaternion();
const xAx = new THREE.Vector3();
const yAx = new THREE.Vector3();
const zero = new THREE.Matrix4().makeScale(0, 0, 0);

export class Decals {
  readonly root = new THREE.Group();
  private batches = new Map<DecalName, Batch[]>();
  private geo = new THREE.PlaneGeometry(1, 1);

  constructor(materials: MaterialLibrary) {
    this.root.name = 'fx_decals';
    const seen = new Map<THREE.Material, Batch>();
    for (const name of DECAL_NAMES) {
      const list: Batch[] = [];
      const nv = VARIANTS[name] ?? 1;
      const cap = CAPACITY[name] ?? 24;
      for (let v = 0; v < nv; v++) {
        let mat: THREE.Material;
        try { mat = materials.decal(name, v); } catch { continue; }
        if (!mat) continue;
        const prev = seen.get(mat);
        if (prev) { list.push(prev); continue; }
        const b = this.makeBatch(mat, cap, `fx_decal_${name}_${v}`);
        seen.set(mat, b);
        list.push(b);
      }
      this.batches.set(name, list);
    }
  }

  private makeBatch(mat: THREE.Material, cap: number, name: string): Batch {
    const shader = mat as THREE.ShaderMaterial;
    const instancable = !shader.isShaderMaterial || /instanc/i.test(shader.vertexShader ?? '');
    if (instancable) {
      const mesh = new THREE.InstancedMesh(this.geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, zero);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      mesh.receiveShadow = true;
      mesh.name = name;
      mesh.visible = false;
      this.root.add(mesh);
      return { mesh, singles: null, next: 0, used: 0, cap };
    }
    const singles: THREE.Mesh[] = [];
    const n = Math.min(cap, 24);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geo, mat);
      m.visible = false; m.matrixAutoUpdate = false; m.renderOrder = 1; m.receiveShadow = true;
      this.root.add(m);
      singles.push(m);
    }
    return { mesh: null, singles, next: 0, used: 0, cap: n };
  }

  /** Make all batches visible once (shader warm-up), call `settle()` afterwards. */
  warm(on: boolean) {
    for (const list of this.batches.values()) for (const b of list) {
      if (b.mesh) { b.mesh.visible = on || b.used > 0; if (on) b.mesh.count = Math.max(b.used, 1); else b.mesh.count = b.used; }
    }
  }

  place(name: DecalName, point: THREE.Vector3, normal: THREE.Vector3, size: number, roll = Math.random() * Math.PI * 2, offset = 0.006) {
    const list = this.batches.get(name);
    if (!list || list.length === 0) return;
    const b = list[(Math.random() * list.length) | 0];
    nrm.copy(normal);
    if (nrm.lengthSq() < 1e-8) nrm.set(0, 1, 0); else nrm.normalize();
    if (Number.isNaN(roll)) {
      // upright: local +Y points to world up projected on the surface (drips run downward)
      yAx.set(0, 1, 0).addScaledVector(nrm, -nrm.y);
      if (yAx.lengthSq() < 1e-4) yAx.set(0, 0, -1).addScaledVector(nrm, -nrm.z);
      yAx.normalize();
      xAx.crossVectors(yAx, nrm);
      m4.makeBasis(xAx, yAx, nrm);
      q.setFromRotationMatrix(m4);
    } else {
      q.setFromUnitVectors(zAxis, nrm);
      qRoll.setFromAxisAngle(zAxis, roll);
      q.multiply(qRoll);
    }
    // tiny per-decal offset jitter avoids z-fighting between overlapping decals
    pos.copy(point).addScaledVector(nrm, offset + Math.random() * 0.002);
    sc.set(size, size, size);
    m4.compose(pos, q, sc);
    const i = b.next;
    b.next = (b.next + 1) % b.cap;
    b.used = Math.min(b.cap, b.used + 1);
    if (b.mesh) {
      b.mesh.setMatrixAt(i, m4);
      b.mesh.count = b.used;
      b.mesh.instanceMatrix.clearUpdateRanges();
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.visible = true;
    } else if (b.singles) {
      const m = b.singles[i];
      m.matrix.copy(m4);
      m.matrixWorldNeedsUpdate = true;
      m.visible = true;
    }
  }

  clear() {
    for (const list of this.batches.values()) for (const b of list) {
      b.used = 0; b.next = 0;
      if (b.mesh) { b.mesh.count = 0; b.mesh.visible = false; }
      if (b.singles) for (const m of b.singles) m.visible = false;
    }
  }
}
