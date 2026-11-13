/**
 * Nav graph generation: per-room grid sampling against the collider AABBs, automatic linking where a
 * straight walk is unobstructed, explicit door / portal nodes.
 */
import * as THREE from 'three';
import type { NavNode, Room } from '../core/types';
import type { LevelBuild } from './context';

function segHitsBox(ax: number, az: number, bx: number, bz: number, b: THREE.Box3, r: number): boolean {
  const minx = b.min.x - r, maxx = b.max.x + r, minz = b.min.z - r, maxz = b.max.z + r;
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  if (Math.abs(dx) < 1e-9) { if (ax <= minx || ax >= maxx) return false; }
  else {
    let u = (minx - ax) / dx, v = (maxx - ax) / dx;
    if (u > v) { const k = u; u = v; v = k; }
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 >= t1) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (az <= minz || az >= maxz) return false; }
  else {
    let u = (minz - az) / dz, v = (maxz - az) / dz;
    if (u > v) { const k = u; u = v; v = k; }
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 >= t1) return false;
  }
  return true;
}

export function buildNav(L: LevelBuild, rooms: readonly Room[], portals: { x: number; z: number }[], step: (room: string) => number,
  startAt: { x: number; z: number } = { x: 0, z: 7 }): NavNode[] {
  const obs = L.obstacles;
  const nodes: NavNode[] = [];
  const steps: number[] = [];
  const free = (x: number, z: number, r: number) => {
    for (const o of obs) if (x > o.min.x - r && x < o.max.x + r && z > o.min.z - r && z < o.max.z + r) return false;
    return true;
  };
  const clear = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const minx = Math.min(a.x, b.x) - r, maxx = Math.max(a.x, b.x) + r, minz = Math.min(a.z, b.z) - r, maxz = Math.max(a.z, b.z) + r;
    for (const o of obs) {
      if (o.max.x < minx || o.min.x > maxx || o.max.z < minz || o.min.z > maxz) continue;
      if (segHitsBox(a.x, a.z, b.x, b.z, o, r)) return false;
    }
    return true;
  };
  const add = (x: number, z: number, room: string, s: number) => {
    nodes.push({ id: nodes.length, position: new THREE.Vector3(x, 0, z), links: [], room });
    steps.push(s);
  };
  for (const room of rooms) {
    const s = step(room.id);
    const b = room.bounds;
    const w = b.max.x - b.min.x - 1.0, d = b.max.z - b.min.z - 1.0;
    const nx = Math.max(1, Math.round(w / s)), nz = Math.max(1, Math.round(d / s));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const x = b.min.x + 0.5 + (i * w) / nx, z = b.min.z + 0.5 + (j * d) / nz;
      if (free(x, z, 0.42)) add(x, z, room.id, Math.max(w / nx, d / nz));
    }
  }
  for (const e of L.navExtra) {
    add(e.p.x, e.p.z, e.room, 1.6);
    nodes[nodes.length - 1].position.y = e.p.y;
  }
  const firstPortal = nodes.length;
  for (const p of portals) {
    let room = rooms[0].id, best = Infinity;
    for (const r of rooms) {
      const c = r.bounds.distanceToPoint(new THREE.Vector3(p.x, 1, p.z));
      if (c < best) { best = c; room = r.id; }
    }
    add(p.x, p.z, room, 1.6);
  }
  const link = (a: NavNode, b: NavNode) => { if (!a.links.includes(b.id)) { a.links.push(b.id); b.links.push(a.id); } };
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const portal = i >= firstPortal || j >= firstPortal;
    const max = portal ? 2.3 : Math.max(steps[i], steps[j]) * 1.5;
    const dx = a.position.x - b.position.x, dz = a.position.z - b.position.z;
    if (dx * dx + dz * dz > max * max) continue;
    if (Math.abs(a.position.y - b.position.y) > 0.6) continue;
    if (clear(a.position, b.position, 0.36)) link(a, b);
  }
  // prune nodes not reachable from the first node (keeps ids dense)
  const seen = new Uint8Array(nodes.length);
  let start = 0, sd = Infinity;
  for (const n of nodes) { const d = (n.position.x - startAt.x) * (n.position.x - startAt.x) + (n.position.z - startAt.z) * (n.position.z - startAt.z); if (d < sd) { sd = d; start = n.id; } }
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const n = nodes[queue.pop()!];
    for (const l of n.links) if (!seen[l]) { seen[l] = 1; queue.push(l); }
  }
  const remap = new Int32Array(nodes.length).fill(-1);
  const out: NavNode[] = [];
  for (let i = 0; i < nodes.length; i++) if (seen[i]) { remap[i] = out.length; out.push(nodes[i]); }
  for (const n of out) { n.id = remap[n.id]; n.links = n.links.map((l) => remap[l]).filter((l) => l >= 0); }
  if (out.length < nodes.length && L.ctx.debug.verbose) console.info(`[level] nav: pruned ${nodes.length - out.length} unreachable nodes`);
  return out;
}
