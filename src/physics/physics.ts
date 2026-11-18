import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { CapsuleBody, DynamicBox, HitOwner, Physics, RayHit, Surface } from '../core/types';

const SURFACES: Surface[] = ['metal', 'concrete', 'glass', 'rubber', 'robot', 'flesh', 'water'];
const GRAVITY = -19;
/** Stage 3d §8.1 / B6: the default kill height (levels 1–5); a level sets its own through `Level.killY` (main.ts). */
export const KILL_Y_DEFAULT = -30;

/** One baked collider set: BVH + per-vertex surface ids + the coplanar seams of its walkable slopes. */
interface Baked { bvh: MeshBVH | null; surf: Uint8Array | null; geo: THREE.BufferGeometry | null; seams: Set<string> }
const EMPTY: Baked = { bvh: null, surf: null, geo: null, seams: new Set() };
/** Quantised (1 mm) vertex key, and an undirected edge key from two of them. */
const vkey = (v: THREE.Vector3) => `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
const ekey = (a: THREE.Vector3, b: THREE.Vector3) => { const ka = vkey(a), kb = vkey(b); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; };

export function createPhysics(): Physics {
  /**
   * Stage 3d §8.1 / S5 (D14): TWO collider sets. `rays` = solid ∪ `userData.rayOnly` (water surfaces: they stop rounds
   * and sight) → raycast, lineOfSight. `moves` = solid ∪ `userData.moveOnly` (rails, bar / mesh guards, a tarp: they
   * stop bodies, rounds and sight pass) → moveBody, resolveSphere, raycastSolid. A level with neither flag bakes ONE
   * set used for both (levels 1–5: unchanged).
   */
  let rays: Baked = EMPTY;
  let moves: Baked = EMPTY;
  let killY = KILL_Y_DEFAULT;
  const boxes: DynamicBox[] = [];
  const movers: THREE.Object3D[] = [];
  /** REVISION 5.2: a dynamic box stands for something that moves or goes away: 'transient' unless it says otherwise. */
  const ownerOf = (b: DynamicBox, p: THREE.Vector3): HitOwner => (typeof b.owner === 'function' ? b.owner(p) : b.owner) ?? 'transient';

  const ray = new THREE.Ray();
  const seg = new THREE.Line3();
  const aabb = new THREE.Box3();
  const triPoint = new THREE.Vector3();
  const capPoint = new THREE.Vector3();
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  const triN = new THREE.Vector3();
  /**
   * Stage 3a §8.10 (stairs / ramps): a capsule resting on a sloped FACE is pushed straight up out of it instead of
   * along the face normal, so a standing body does not creep downhill (the resting bias pushes it into the slope
   * every sub-step; the normal push-out had a downhill component: ≈ 0.5 m/s on 28°). Edges, walls, steep faces
   * (normal y < 0.5) and flat floors resolve as before. Only for levels that declare walkable stairs (collider
   * meshes carry `userData.holdSlopes`, see LevelBuild.colliderMeshes); levels 1–2 do not, so they are unchanged.
   */
  let holdSlopes = false;
  /** Stage 3d K: the seam rule (`slopeSeams`); a test hook turns it off to prove its case fails without it. */
  let seamFix = true;

  function bake(colliders: THREE.Mesh[], withSeams: boolean): Baked {
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
    const seams = withSeams ? slopeSeams(positions) : new Set<string>();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // MeshBVH adds an index (reordered); vertex data stays put, so per-vertex surface ids remain valid.
    return { bvh: total > 0 ? new MeshBVH(geo) : null, surf, geo, seams };
  }

  /**
   * Stage 3d K (the STAIR5_W drift): edges shared by two COPLANAR walkable-slope triangles — a slope slab's top face is
   * two triangles split along its diagonal. A capsule that has crossed that diagonal still touches the far triangle AT
   * the diagonal; that contact was resolved along the edge→capsule direction, which has a sideways component, every
   * sub-step while walking uphill (the capsule sinks into a rising slope): ≈ 0.6–1.1 m west over STAIR5_W. `resolveSegment`
   * now resolves a contact on such a seam against the plane, vertically, like the face contact it stands for.
   */
  function slopeSeams(pos: Float32Array): Set<string> {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
    const byEdge = new Map<string, THREE.Vector3[]>();
    for (let t = 0; t + 8 < pos.length; t += 9) {
      a.fromArray(pos, t); b.fromArray(pos, t + 3); c.fromArray(pos, t + 6);
      n.subVectors(c, b).cross(e.subVectors(a, b));
      const len = n.length();
      if (len < 1e-9) continue;
      n.multiplyScalar(1 / len);
      const ny = Math.abs(n.y);
      if (ny < 0.5 || ny >= 0.995) continue;
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
        const k = ekey(p, q);
        const l = byEdge.get(k);
        if (l) l.push(n.clone()); else byEdge.set(k, [n.clone()]);
      }
    }
    const out = new Set<string>();
    for (const [k, ns] of byEdge) {
      if (ns.length < 2) continue;
      let coplanar = false;
      for (let i = 0; i < ns.length && !coplanar; i++) for (let j = i + 1; j < ns.length; j++) if (Math.abs(ns[i].dot(ns[j])) > 0.9995) { coplanar = true; break; }
      if (coplanar) out.add(k);
    }
    return out;
  }

  function build(colliders: THREE.Mesh[]) {
    holdSlopes = colliders.some((m) => m.userData.holdSlopes === true);
    const split = colliders.some((m) => m.userData.rayOnly === true || m.userData.moveOnly === true);
    if (!split) {
      rays = moves = bake(colliders, holdSlopes);
    } else {
      rays = bake(colliders.filter((m) => m.userData.moveOnly !== true), false);
      moves = bake(colliders.filter((m) => m.userData.rayOnly !== true), holdSlopes);
    }
    (physics as any)._geometry = rays.geo;
  }

  function hitStatic(set: Baked, origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): RayHit | null {
    if (!set.bvh) return null;
    ray.origin.copy(origin); ray.direction.copy(direction);
    const hit = set.bvh.raycastFirst(ray, THREE.DoubleSide, 0, maxDistance);
    if (!hit || hit.distance > maxDistance) return null;
    const normal = hit.face ? hit.face.normal.clone() : direction.clone().negate();
    if (normal.dot(direction) > 0) normal.negate();
    const a = hit.face ? hit.face.a : 0;
    return { point: hit.point.clone(), normal, distance: hit.distance, surface: SURFACES[set.surf ? set.surf[a] : 0] };
  }

  /** Closest hit against one static set + the enabled dynamic boxes. */
  function castIn(set: Baked, origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): RayHit | null {
    let best: RayHit | null = hitStatic(set, origin, direction, maxDistance);
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
      best = { point: p.clone(), normal: n, distance: d, surface: b.surface, owner: ownerOf(b, p) };
    }
    return best;
  }

  function raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance = 1000): RayHit | null {
    return castIn(rays, origin, direction, maxDistance);
  }

  /** Stage 3d S5: the MOVES set (solid ∪ moveOnly — never a water surface) + enabled dynamic boxes. */
  function raycastSolid(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance = 1000): RayHit | null {
    return castIn(moves, origin, direction, maxDistance);
  }

  function setKillY(y: number): void {
    killY = Number.isFinite(y) ? y : KILL_Y_DEFAULT;
  }

  function lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dir = tmp.copy(b).sub(a);
    const len = dir.length();
    if (len < 1e-4) return true;
    dir.multiplyScalar(1 / len);
    const d = dir.clone();
    return raycast(a, d, len - 0.05) === null;
  }

  const edgeL = new THREE.Line3();
  const onP = new THREE.Vector3();
  /** `p` lies on an edge (or a vertex) of `tri`, and every edge it lies on is a coplanar slope seam. */
  function onSeam(tri: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 }, p: THREE.Vector3, seams: Set<string>): boolean {
    let on = 0;
    for (const [u, w] of [[tri.a, tri.b], [tri.b, tri.c], [tri.c, tri.a]] as const) {
      edgeL.set(u, w).closestPointToPoint(p, true, onP);
      if (onP.distanceToSquared(p) > 1e-8) continue;
      if (!seams.has(ekey(u, w))) return false;
      on++;
    }
    return on > 0;
  }

  /** Highest low obstacle (`DynamicBox.walkable`) a body steps onto. */
  const STEP_OVER = 0.55;
  function resolveSegment(radius: number): void {
    // Push `seg` (capsule axis) out of static triangles (the moves set).
    const bvh = moves.bvh;
    if (bvh) {
      const seams = holdSlopes && seamFix && moves.seams.size ? moves.seams : null;
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
            if (holdSlopes) {
              tri.getNormal(triN);
              if (triN.dot(dir) < 0) triN.negate();
              if (dir.y >= 0.5 && dir.y < 0.995 && triN.dot(dir) > 0.995) {
                // face contact on a walkable slope (not an edge): resolve vertically, no downhill creep
                const up = depth / dir.y;
                seg.start.y += up; seg.end.y += up;
                return false;
              }
              if (seams && triN.y >= 0.5 && triN.y < 0.995 && onSeam(tri, triPoint, seams)) {
                // stage 3d K: on a coplanar seam of a slope (the slab's diagonal): against the plane, vertically
                const above = dist * triN.dot(dir);
                const dep = radius - above;
                if (dep > 0) { const up = dep / triN.y; seg.start.y += up; seg.end.y += up; }
                return false;
              }
            }
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
      if (b.walkable) {
        // A wreck on the floor is stepped onto, not walked into: lift the body to its top (the eye smooths it).
        const feet = seg.start.y - radius, rise = bb.max.y - feet;
        if (rise <= 0) continue;
        if (rise <= STEP_OVER) { seg.start.y += rise; seg.end.y += rise; continue; }
      }
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
    // Safety net: never fall out of the world (stage 3d B6: the height is the level's, `setKillY`; levels 1–5: −30).
    if (body.position.y < killY) { body.position.y = 2; body.velocity.set(0, 0, 0); }
  }

  function resolveSphere(center: THREE.Vector3, radius: number): boolean {
    const bvh = moves.bvh;
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

  function ownerAt(p: THREE.Vector3): HitOwner | undefined {
    const e = 0.015;
    for (const b of boxes) {
      if (!b.enabled) continue;
      const mn = b.box.min, mx = b.box.max;
      if (p.x < mn.x - e || p.x > mx.x + e || p.y < mn.y - e || p.y > mx.y + e || p.z < mn.z - e || p.z > mx.z + e) continue;
      return ownerOf(b, p);
    }
    return undefined;
  }

  function addMover(obj: THREE.Object3D) {
    if (!movers.includes(obj)) movers.push(obj);
    return () => { const i = movers.indexOf(obj); if (i >= 0) movers.splice(i, 1); };
  }

  const physics: Physics = {
    build, raycast, raycastSolid, lineOfSight, moveBody, resolveSphere, addBox, ownerAt, addMover, movers, setKillY,
    get killY() { return killY; },
    gravity: GRAVITY,
  };
  // test hooks (scripts/check-nav.mjs: the drift case is run once with the hold off and must fail; check-physics: the
  // seam count and the split)
  Object.defineProperty(physics, '_holdSlopes', { get: () => holdSlopes, set: (v: boolean) => { holdSlopes = !!v; }, enumerable: false });
  Object.defineProperty(physics, '_seamFix', { get: () => seamFix, set: (v: boolean) => { seamFix = !!v; }, enumerable: false });
  Object.defineProperty(physics, '_sets', { get: () => ({ split: rays !== moves, seams: moves.seams.size }), enumerable: false });
  // scripts/check-physics.mjs: a fresh, empty physics (and the three module) to build test scenes in the page
  Object.defineProperty(physics, '_fresh', { value: () => ({ physics: createPhysics(), THREE }), enumerable: false });
  return physics;
}
