import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { CapsuleBody, DynamicBox, Physics, RayHit, Surface } from '../core/types';

const SURFACES: Surface[] = ['metal', 'concrete', 'glass', 'rubber', 'robot', 'flesh'];
const GRAVITY = -19;

export function createPhysics(): Physics {
  let bvh: MeshBVH | null = null;
  let surfAttr: Uint8Array | null = null;
  let posAttr: THREE.BufferAttribute | null = null;
  const boxes: DynamicBox[] = [];

  const ray = new THREE.Ray();
  const seg = new THREE.Line3();
  const aabb = new THREE.Box3();
  const triPoint = new THREE.Vector3();
  const capPoint = new THREE.Vector3();
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const sphere = new THREE.Sphere();

  function build(colliders: THREE.Mesh[]) {
    // Merge every collider into one non-indexed, world-space position buffer + per-vertex surface id.
    let total = 0;
    const parts: { pos: Float32Array; surf: number }[] = [];
    const v = new THREE.Vector3();
    for (const mesh of colliders) {
      mesh.updateWorldMatrix(true, false);
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const src = g.getAttribute('position');
      if (!src) continue;
      const pos = new Float32Array(src.count * 3);
      for (let i = 0; i < src.count; i++) {
        v.fromBufferAttribute(src, i).applyMatrix4(mesh.matrixWorld);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      }
      // Negative-determinant transforms flip winding; collisions are double-sided so it does not matter.
      const s = SURFACES.indexOf((mesh.userData.surface as Surface) ?? 'metal');
      parts.push({ pos, surf: s < 0 ? 0 : s });
      total += src.count;
      if (g !== mesh.geometry) g.dispose();
    }
    const positions = new Float32Array(total * 3);
    const surf = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      positions.set(p.pos, o * 3);
      surf.fill(p.surf, o, o + p.pos.length / 3);
      o += p.pos.length / 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    bvh = total > 0 ? new MeshBVH(geo) : null;
    // MeshBVH adds an index (reordered); vertex data stays put, so per-vertex surface ids remain valid.
    surfAttr = surf;
    posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    (physics as any)._geometry = geo;
  }

  function raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance = 1000): RayHit | null {
    let best: RayHit | null = null;
    if (bvh) {
      ray.origin.copy(origin); ray.direction.copy(direction);
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, maxDistance);
      if (hit && hit.distance <= maxDistance) {
        const normal = hit.face ? hit.face.normal.clone() : direction.clone().negate();
        if (normal.dot(direction) > 0) normal.negate();
        const a = hit.face ? hit.face.a : 0;
        best = { point: hit.point.clone(), normal, distance: hit.distance, surface: SURFACES[surfAttr ? surfAttr[a] : 0] };
      }
    }
    ray.origin.copy(origin); ray.direction.copy(direction);
    for (const b of boxes) {
      if (!b.enabled) continue;
      const p = ray.intersectBox(b.box, tmp);
      if (!p) continue;
      const d = p.distanceTo(origin);
      if (d > maxDistance || (best && d >= best.distance)) continue;
      // Normal = dominant axis of (p - centre) scaled by half-size.
      const c = b.box.getCenter(v0), h = b.box.getSize(v1).multiplyScalar(0.5);
      const n = new THREE.Vector3((p.x - c.x) / h.x, (p.y - c.y) / h.y, (p.z - c.z) / h.z);
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      if (ax >= ay && ax >= az) n.set(Math.sign(n.x), 0, 0);
      else if (ay >= az) n.set(0, Math.sign(n.y), 0);
      else n.set(0, 0, Math.sign(n.z));
      best = { point: p.clone(), normal: n, distance: d, surface: b.surface };
    }
    return best;
  }

  function lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dir = tmp.copy(b).sub(a);
    const len = dir.length();
    if (len < 1e-4) return true;
    dir.multiplyScalar(1 / len);
    const d = dir.clone();
    return raycast(a, d, len - 0.05) === null;
  }

  function resolveSegment(radius: number): void {
    // Push `seg` (capsule axis) out of static triangles.
    if (bvh) {
      aabb.makeEmpty();
      aabb.expandByPoint(seg.start); aabb.expandByPoint(seg.end);
      aabb.min.addScalar(-radius); aabb.max.addScalar(radius);
      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(aabb),
        intersectsTriangle: (tri) => {
          const dist = tri.closestPointToSegment(seg, triPoint, capPoint);
          if (dist < radius) {
            const depth = radius - dist;
            const dir = capPoint.sub(triPoint);
            if (dir.lengthSq() < 1e-12) tri.getNormal(dir); else dir.normalize();
            seg.start.addScaledVector(dir, depth);
            seg.end.addScaledVector(dir, depth);
          }
          return false;
        },
      });
    }
    // Dynamic boxes: horizontal push-out (doors are vertical slabs).
    for (const b of boxes) {
      if (!b.enabled) continue;
      const bb = b.box;
      if (seg.end.y + radius < bb.min.y || seg.start.y - radius > bb.max.y) continue;
      const px = seg.start.x, pz = seg.start.z;
      const cx = Math.max(bb.min.x, Math.min(px, bb.max.x));
      const cz = Math.max(bb.min.z, Math.min(pz, bb.max.z));
      let dx = px - cx, dz = pz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      let push: number;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        push = radius - d; dx /= d; dz /= d;
      } else {
        // Centre is inside the box: exit through the nearest face.
        const toMinX = px - bb.min.x, toMaxX = bb.max.x - px, toMinZ = pz - bb.min.z, toMaxZ = bb.max.z - pz;
        const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
        dx = 0; dz = 0;
        if (m === toMinX) dx = -1; else if (m === toMaxX) dx = 1; else if (m === toMinZ) dz = -1; else dz = 1;
        push = m + radius;
      }
      seg.start.x += dx * push; seg.start.z += dz * push;
      seg.end.x += dx * push; seg.end.z += dz * push;
    }
  }

  function moveBody(body: CapsuleBody, dt: number): void {
    const g = GRAVITY * (body.gravityScale ?? 1);
    // Sub-step so fast bodies cannot tunnel through thin walls.
    const speed = body.velocity.length();
    const steps = Math.min(8, Math.max(1, Math.ceil((speed * dt) / (body.radius * 0.5))));
    const h = dt / steps;
    let grounded = false;
    for (let s = 0; s < steps; s++) {
      if (!(body.onGround && body.velocity.y <= 0)) body.velocity.y += g * h;
      else body.velocity.y = g * h * 4; // small downward bias so resting bodies keep touching the ground
      body.position.addScaledVector(body.velocity, h);

      const r = body.radius;
      seg.start.set(body.position.x, body.position.y + r, body.position.z);
      seg.end.set(body.position.x, body.position.y + Math.max(r, body.height - r), body.position.z);
      v0.copy(seg.start);
      resolveSegment(r);
      const delta = v1.copy(seg.start).sub(v0);
      const len = delta.length();
      if (len > 1e-6) {
        body.position.add(delta);
        delta.multiplyScalar(1 / len);
        // Ground if the push-out is mostly upward.
        if (delta.y > 0.5) {
          grounded = true;
          if (body.velocity.y < 0) body.velocity.y = 0;
        } else {
          // Remove velocity into the surface (slide).
          const into = delta.dot(body.velocity);
          if (into < 0) body.velocity.addScaledVector(delta, -into);
        }
      }
    }
    body.onGround = grounded;
    // Safety net: never fall out of the world.
    if (body.position.y < -30) { body.position.y = 2; body.velocity.set(0, 0, 0); }
  }

  function resolveSphere(center: THREE.Vector3, radius: number): boolean {
    if (!bvh) return false;
    let touched = false;
    sphere.center.copy(center); sphere.radius = radius;
    bvh.shapecast({
      intersectsBounds: (box) => box.intersectsSphere(sphere),
      intersectsTriangle: (tri) => {
        tri.closestPointToPoint(sphere.center, triPoint);
        const d = triPoint.distanceTo(sphere.center);
        if (d < radius) {
          const dir = capPoint.copy(sphere.center).sub(triPoint);
          if (dir.lengthSq() < 1e-12) tri.getNormal(dir); else dir.normalize();
          sphere.center.addScaledVector(dir, radius - d);
          touched = true;
        }
        return false;
      },
    });
    center.copy(sphere.center);
    return touched;
  }

  function addBox(box: THREE.Box3, surface: Surface = 'metal'): DynamicBox {
    const b: DynamicBox = {
      box, enabled: true, surface,
      remove() { const i = boxes.indexOf(b); if (i >= 0) boxes.splice(i, 1); },
    };
    boxes.push(b);
    return b;
  }

  const physics: Physics = { build, raycast, lineOfSight, moveBody, resolveSphere, addBox, gravity: GRAVITY };
  return physics;
}
