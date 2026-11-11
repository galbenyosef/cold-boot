/** Per-part hit volumes (capsules attached to bones) and ray tests. */
import * as THREE from 'three';

export interface HitVolume {
  bone: THREE.Object3D;
  /** Capsule endpoints in bone-local space (a === b → sphere). */
  a: THREE.Vector3;
  b: THREE.Vector3;
  radius: number;
  /** 'head' | 'torso' | 'limb' | 'core' */
  part: string;
  /** Free-form region key for part destruction, e.g. 'arm_l'. */
  region: string;
  enabled: boolean;
}

export function hv(bone: THREE.Object3D, a: [number, number, number], b: [number, number, number], radius: number, part: string, region = part): HitVolume {
  return { bone, a: new THREE.Vector3(...a), b: new THREE.Vector3(...b), radius, part, region, enabled: true };
}

const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
const _ba = new THREE.Vector3(), _oa = new THREE.Vector3();

/**
 * Ray vs capsule (after Inigo Quilez). Returns distance along the ray or -1.
 */
function rayCapsule(ro: THREE.Vector3, rd: THREE.Vector3, pa: THREE.Vector3, pb: THREE.Vector3, r: number): number {
  _ba.copy(pb).sub(pa);
  _oa.copy(ro).sub(pa);
  const baba = _ba.dot(_ba);
  const bard = _ba.dot(rd);
  const baoa = _ba.dot(_oa);
  const rdoa = rd.dot(_oa);
  const oaoa = _oa.dot(_oa);
  if (baba < 1e-10) {
    // sphere
    const c = oaoa - r * r;
    const h = rdoa * rdoa - c;
    if (h < 0) return -1;
    const t = -rdoa - Math.sqrt(h);
    return t >= 0 ? t : (c < 0 ? 0 : -1);
  }
  let a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h >= 0 && a > 1e-10) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
    // caps
    const ocx = y <= 0 ? _oa : _pa.copy(ro).sub(pb);
    b = rd.dot(ocx);
    c = ocx.dot(ocx) - r * r;
    h = b * b - c;
    if (h > 0) { const tt = -b - Math.sqrt(h); return tt >= 0 ? tt : -1; }
  }
  return -1;
}

const _wa = new THREE.Vector3(), _wb = new THREE.Vector3();

export interface VolumeHit { t: number; volume: HitVolume | null; }

/** Closest hit among volumes (uses the bones' current matrixWorld). `best.t` must be pre-set to the max distance. */
export function raycastVolumes(volumes: HitVolume[], ro: THREE.Vector3, rd: THREE.Vector3, best: VolumeHit): boolean {
  let found = false;
  for (let i = 0; i < volumes.length; i++) {
    const v = volumes[i];
    if (!v.enabled) continue;
    _wa.copy(v.a).applyMatrix4(v.bone.matrixWorld);
    _wb.copy(v.b).applyMatrix4(v.bone.matrixWorld);
    const t = rayCapsule(ro, rd, _wa, _wb, v.radius);
    if (t >= 0 && t < best.t) { best.t = t; best.volume = v; found = true; }
  }
  return found;
}

/** Surface normal on a volume at a world point. */
export function volumeNormal(v: HitVolume, point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  _wa.copy(v.a).applyMatrix4(v.bone.matrixWorld);
  _wb.copy(v.b).applyMatrix4(v.bone.matrixWorld);
  _ba.copy(_wb).sub(_wa);
  const l2 = _ba.lengthSq();
  let t = l2 > 1e-10 ? _pb.copy(point).sub(_wa).dot(_ba) / l2 : 0;
  t = Math.min(1, Math.max(0, t));
  out.copy(point).sub(_wa).addScaledVector(_ba, -t);
  if (out.lengthSq() < 1e-10) out.set(0, 1, 0);
  return out.normalize();
}
