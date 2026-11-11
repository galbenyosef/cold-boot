/**
 * Tumbling rigid debris. Generic metal shards are InstancedMeshes (one per shape); caller-supplied meshes
 * are simulated in place. Hard cap of active bodies, oldest recycled.
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialLibrary, Physics } from '../core/types';

export const MAX_DEBRIS = 40;

interface Body {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Quaternion;
  ang: THREE.Vector3;
  scale: number;
  radius: number;
  age: number;
  life: number;
  sleeping: boolean;
  restFrames: number;
  /** generic shard: shape index; custom: -1 */
  shape: number;
  obj: THREE.Object3D | null;
  baseScale: THREE.Vector3;
  born: number;
}

const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const prev = new THREE.Vector3();
const push = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const scl = new THREE.Vector3();
const zero = new THREE.Matrix4().makeScale(0, 0, 0);
const box = new THREE.Box3();
const sph = new THREE.Sphere();
const eul = new THREE.Euler();

function shardGeometries(): THREE.BufferGeometry[] {
  // bent plate
  const plate = new THREE.BoxGeometry(0.16, 0.012, 0.09, 4, 1, 1);
  const p = plate.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setY(i, p.getY(i) + Math.abs(x) * 0.35 - x * x * 2); }
  plate.computeVertexNormals();
  // triangular shard
  const tri = new THREE.CylinderGeometry(0.07, 0.07, 0.01, 3, 1);
  tri.scale(1.3, 1, 0.8);
  // bolt / rod
  const rod = BufferGeometryUtils.mergeGeometries([
    new THREE.CylinderGeometry(0.012, 0.012, 0.11, 6).toNonIndexed(),
    new THREE.CylinderGeometry(0.022, 0.022, 0.016, 6).translate(0, 0.055, 0).toNonIndexed(),
  ]);
  // chunky bracket
  const bracket = BufferGeometryUtils.mergeGeometries([
    new THREE.BoxGeometry(0.08, 0.012, 0.05).toNonIndexed(),
    new THREE.BoxGeometry(0.012, 0.06, 0.05).translate(0.034, 0.03, 0).toNonIndexed(),
  ]);
  const list = [plate, tri, rod, bracket];
  for (const g of list) { g.computeBoundingSphere(); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
  return list;
}

export class Debris {
  readonly root = new THREE.Group();
  private bodies: Body[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private shapeRadius: number[] = [];
  private bornCounter = 0;
  onImpact: ((p: THREE.Vector3, n: THREE.Vector3, speed: number) => void) | null = null;

  constructor(materials: MaterialLibrary, private scene: THREE.Object3D) {
    this.root.name = 'fx_debris';
    const geos = shardGeometries();
    const mats = [materials.get('steel_raw'), materials.get('robot_frame'), materials.get('steel_raw'), materials.get('robot_frame')];
    geos.forEach((g, i) => {
      const m = new THREE.InstancedMesh(g, mats[i], MAX_DEBRIS);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let k = 0; k < MAX_DEBRIS; k++) m.setMatrixAt(k, zero);
      m.frustumCulled = false;
      m.castShadow = true; m.receiveShadow = true;
      m.visible = false;
      m.name = `fx_debris_${i}`;
      this.meshes.push(m);
      this.shapeRadius.push(Math.max(0.025, g.boundingSphere!.radius * 0.55));
      this.root.add(m);
    });
    for (let i = 0; i < MAX_DEBRIS; i++) {
      this.bodies.push({
        active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Quaternion(), ang: new THREE.Vector3(),
        scale: 1, radius: 0.05, age: 0, life: 6, sleeping: false, restFrames: 0, shape: 0, obj: null, baseScale: new THREE.Vector3(1, 1, 1), born: 0,
      });
    }
  }

  get activeCount() { let n = 0; for (const b of this.bodies) if (b.active) n++; return n; }

  warm(on: boolean) { for (const m of this.meshes) m.visible = on; }

  private take(): Body {
    let free: Body | null = null, oldest = this.bodies[0];
    for (const b of this.bodies) {
      if (!b.active) { free = b; break; }
      if (b.born < oldest.born) oldest = b;
    }
    const b = free ?? oldest;
    if (b.active) this.release(b);
    b.born = this.bornCounter++;
    return b;
  }

  private release(b: Body) {
    if (b.obj) { b.obj.removeFromParent(); b.obj = null; }
    b.active = false;
  }

  spawnShard(p: THREE.Vector3, v: THREE.Vector3, life: number) {
    const b = this.take();
    b.active = true; b.shape = (Math.random() * this.meshes.length) | 0; b.obj = null;
    b.pos.copy(p); b.vel.copy(v);
    b.rot.setFromEuler(eul.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    b.ang.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(25);
    b.scale = 0.7 + Math.random() * 0.8;
    b.radius = this.shapeRadius[b.shape] * b.scale;
    b.age = 0; b.life = life; b.sleeping = false; b.restFrames = 0;
  }

  spawnObject(obj: THREE.Object3D, v: THREE.Vector3, life: number) {
    const b = this.take();
    obj.updateWorldMatrix(true, true);
    box.setFromObject(obj);
    box.getBoundingSphere(sph);
    // re-parent into the scene keeping world transform
    this.scene.attach(obj);
    b.active = true; b.shape = -1; b.obj = obj;
    b.pos.copy(obj.position);
    b.vel.copy(v);
    b.rot.copy(obj.quaternion);
    b.baseScale.copy(obj.scale);
    b.ang.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(12);
    b.scale = 1;
    b.radius = Math.max(0.04, Math.min(0.5, isFinite(sph.radius) ? sph.radius * 0.6 : 0.1));
    b.age = 0; b.life = life; b.sleeping = false; b.restFrames = 0;
  }

  update(dt: number, physics: Physics) {
    const g = physics.gravity;
    let anyShard = false;
    for (const b of this.bodies) {
      if (!b.active) continue;
      b.age += dt;
      if (b.age >= b.life) { this.release(b); continue; }
      if (b.shape >= 0) anyShard = true;
      if (!b.sleeping) {
        const speed = b.vel.length();
        const steps = Math.min(4, Math.max(1, Math.ceil((speed * dt) / (b.radius * 0.8))));
        const h = dt / steps;
        for (let s = 0; s < steps; s++) {
          b.vel.y += g * h;
          prev.copy(b.pos);
          b.pos.addScaledVector(b.vel, h);
          tmpV.copy(b.pos);
          if (physics.resolveSphere(b.pos, b.radius)) {
            push.subVectors(b.pos, tmpV);
            const pl = push.length();
            if (pl > 1e-6) {
              push.multiplyScalar(1 / pl);
              const vn = b.vel.dot(push);
              if (vn < 0) {
                const impact = -vn;
                b.vel.addScaledVector(push, -vn * 1.35); // restitution 0.35
                b.vel.multiplyScalar(0.72);             // friction
                b.ang.multiplyScalar(0.6);
                // spin from the hit
                b.ang.x += (Math.random() - 0.5) * impact * 4; b.ang.z += (Math.random() - 0.5) * impact * 4;
                if (impact > 2.5 && this.onImpact) this.onImpact(b.pos, push, impact);
              }
              if (push.y > 0.6 && b.vel.lengthSq() < 0.25) b.restFrames++;
              else b.restFrames = 0;
              if (b.restFrames > 6) { b.sleeping = true; b.vel.set(0, 0, 0); }
            }
          }
        }
        const w = b.ang.length();
        if (w > 1e-4) {
          tmpQ.setFromAxisAngle(tmpV.copy(b.ang).multiplyScalar(1 / w), w * dt);
          b.rot.premultiply(tmpQ);
        }
        b.ang.multiplyScalar(1 - 0.4 * dt);
      }
      // shrink away over the last 0.6 s
      const fade = Math.min(1, (b.life - b.age) / 0.6);
      if (b.obj) {
        b.obj.position.copy(b.pos);
        b.obj.quaternion.copy(b.rot);
        b.obj.scale.copy(b.baseScale).multiplyScalar(Math.max(0.001, fade));
      }
    }
    // write instance matrices (fixed slot per body index)
    for (let si = 0; si < this.meshes.length; si++) {
      const mesh = this.meshes[si];
      if (!anyShard) { if (mesh.visible) mesh.visible = false; continue; }
      let used = false;
      for (let k = 0; k < MAX_DEBRIS; k++) {
        const b = this.bodies[k];
        if (b.active && b.shape === si) {
          const fade = Math.min(1, (b.life - b.age) / 0.6);
          scl.setScalar(b.scale * Math.max(0.001, fade));
          m4.compose(b.pos, b.rot, scl);
          mesh.setMatrixAt(k, m4);
          used = true;
        } else mesh.setMatrixAt(k, zero);
      }
      mesh.visible = used;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
