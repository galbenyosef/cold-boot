/**
 * Nav graph generation: per-room grid sampling against the collider AABBs, automatic linking where a
 * straight walk is unobstructed, explicit door / portal nodes.
 *
 * Nav v2 (stage 3a §8.10, two decks): nodes per walkable floor of a room (its own floor + `floors` — balconies,
 * landings), `position.y` = that floor. A node / link is blocked only by obstacles overlapping its floor's
 * 0.2 … 1.5 band, and (multi-deck levels) only where a declared floor carries it. Floors are joined only by the
 * stairs / ramps a level declares (`LevelBuild.navStair`: a chain of nodes every 1.0 m on the slope) and by one-way
 * drops (`LevelBuild.navDrop`, `NavNode.drops`). Door portal nodes take the door's floor. A level with one floor at
 * y 0 and no stairs (levels 1, 2) builds exactly the graph it built before.
 *
 * Stage 3c D20 / §8.4: a floor declared `nav: false` (the crawlway, the magazine) gets no grid node, does not carry a
 * link (`supported`), and is left out of the "floor with no reachable node" warning (`NavInfo.floors[k].nav` false —
 * scripts/check-nav.mjs skips it too). Its `exits` are data for the enemies (level.floorAt), not nav nodes.
 */
import * as THREE from 'three';
import type { NavNode, Room } from '../core/types';
import { roomFloor, type LevelBuild, type NavStair } from './context';

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

/** A door / archway point nav links through (y = the floor of the opening; default 0). */
export interface NavPortal { x: number; y?: number; z: number }

/** Diagnostics published on `level.root.userData.nav` (read by scripts/check-nav.mjs). */
export interface NavInfo {
  /** Multi-deck rules active (a room with extra floors / a floor off y 0 / a stair). */
  decks: boolean;
  /** Per room floor (`room:floor index` or `room:main`): nodes generated / kept after pruning; `nav: false` floors flagged. */
  floors: Record<string, { y: number; made: number; kept: number; nav?: false }>;
  stairs: { room: string; a: number[]; b: number[]; width: number; nodes: number }[];
  drops: { from: number[]; to: number[]; ok: boolean }[];
  /** Stair end nodes that came out blocked (a stair that cannot be entered). */
  blockedEnds: string[];
  /** Graph build time (ms). */
  ms: number;
}

/** Stair footprint test: the slope's height over (x, z), or null outside its footprint (grown by r). */
function stairHeight(s: NavStair, x: number, z: number, r: number, t0 = 0, t1 = 1): number | null {
  const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, l2 = dx * dx + dz * dz;
  if (l2 < 1e-9) return null;
  const t = ((x - s.a.x) * dx + (z - s.a.z) * dz) / l2;
  if (t < t0 || t > t1) return null;
  const lat = Math.abs((x - s.a.x) * dz - (z - s.a.z) * dx) / Math.sqrt(l2);
  if (lat > s.width / 2 + r) return null;
  return s.a.y + t * (s.b.y - s.a.y);
}

export function buildNav(L: LevelBuild, rooms: readonly Room[], portals: NavPortal[], step: (room: string) => number,
  startAt: { x: number; y?: number; z: number } = { x: 0, z: 7 }): NavNode[] {
  const t0 = performance.now();
  const stairs = L.navStairs, drops = L.navDrops;
  const floorY = rooms.map((r) => roomFloor(r));
  const decks = stairs.length > 0 || drops.length > 0 || rooms.some((r, i) => (r.floors?.length ?? 0) > 0 || Math.abs(floorY[i]) > 1e-6);
  const nodes: NavNode[] = [];
  const steps: number[] = [];

  // ── obstacles per floor height: those overlapping floor + 0.2 … floor + 1.5 (floor 0 = the classic list) ──
  const bands = new Map<number, THREE.Box3[]>();
  const obstaclesAt = (y: number): THREE.Box3[] => {
    const k = Math.round(y * 100);
    let list = bands.get(k);
    if (!list) {
      if (k === 0) list = L.obstacles;
      else {
        list = [];
        const lo = y + 0.2, hi = y + 1.5;
        for (const o of L.navSolids) if (o.max.y > lo && o.min.y < hi) list.push(o);
        // hand-placed obstacles (`L.obstacles.push`) that reach this band too
        for (const o of L.obstacles) if (o.max.y > lo && o.min.y < hi && !list.includes(o)) list.push(o);
      }
      bands.set(k, list);
    }
    return list;
  };
  const free = (x: number, z: number, r: number, y: number) => {
    for (const o of obstaclesAt(y)) if (x > o.min.x - r && x < o.max.x + r && z > o.min.z - r && z < o.max.z + r) return false;
    return !stairs.length || !underStair(x, y, z, r);
  };
  /** A body standing at floor y under a slope with less than 2.0 m headroom (and not on it). */
  const underStair = (x: number, y: number, z: number, r: number) => {
    for (const s of stairs) {
      const h = stairHeight(s, x, z, r);
      if (h !== null && h > y + 0.25 && h < y + 2.5) return true;
    }
    return false;
  };
  /** Is (x, y, z) carried by a declared floor (a room's own, an extra floor, a stair)? Multi-deck levels only. */
  const supported = (x: number, y: number, z: number) => {
    for (let i = 0; i < rooms.length; i++) {
      const b = rooms[i].bounds, g = 0.35;
      if (x < b.min.x - g || x > b.max.x + g || z < b.min.z - g || z > b.max.z + g) continue;
      if (Math.abs(floorY[i] - y) < 0.35) return true;
      for (const f of rooms[i].floors ?? []) {
        if (f.nav === false) continue;
        if (Math.abs(f.y - y) < 0.35 && x >= f.box[0] - 0.1 && x <= f.box[1] + 0.1 && z >= f.box[2] - 0.1 && z <= f.box[3] + 0.1) return true;
      }
    }
    for (const s of stairs) { const h = stairHeight(s, x, z, 0, -0.05, 1.05); if (h !== null && Math.abs(h - y) < 0.35) return true; }
    return false;
  };
  const clear = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const minx = Math.min(a.x, b.x) - r, maxx = Math.max(a.x, b.x) + r, minz = Math.min(a.z, b.z) - r, maxz = Math.max(a.z, b.z) + r;
    for (const o of obstaclesAt(Math.min(a.y, b.y))) {
      if (o.max.x < minx || o.min.x > maxx || o.max.z < minz || o.min.z > maxz) continue;
      if (segHitsBox(a.x, a.z, b.x, b.z, o, r)) return false;
    }
    if (decks) {
      const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len / 0.4));
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
        if (!supported(x, y, z)) return false;
        if (stairs.length && underStair(x, y, z, 0.3)) return false;
      }
    }
    return true;
  };
  /** Index into the room's `floors` for a point at height y (undefined = the room's own floor). */
  const floorIndex = (ri: number, x: number, y: number, z: number): number | undefined => {
    if (ri < 0 || Math.abs(floorY[ri] - y) < 0.3) return undefined;
    const fl = rooms[ri].floors ?? [];
    for (let k = 0; k < fl.length; k++) {
      const f = fl[k];
      if (f.nav === false) continue;
      if (Math.abs(f.y - y) < 0.3 && x >= f.box[0] - 0.1 && x <= f.box[1] + 0.1 && z >= f.box[2] - 0.1 && z <= f.box[3] + 0.1) return k;
    }
    return undefined;
  };
  const roomIndex = (id: string) => rooms.findIndex((r) => r.id === id);
  const roomAtPlan = (x: number, z: number) => {
    for (let i = 0; i < rooms.length; i++) { const b = rooms[i].bounds; if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) return i; }
    return -1;
  };
  const floorKey = (room: string, floor: number | undefined) => `${room}:${floor === undefined ? 'main' : floor}`;
  const add = (x: number, y: number, z: number, room: string, s: number, floor?: number) => {
    const n: NavNode = { id: nodes.length, position: new THREE.Vector3(x, y, z), links: [], room };
    if (floor !== undefined) n.floor = floor;
    nodes.push(n);
    steps.push(s);
    return n;
  };

  // ── grid nodes: each room's own floor, then its extra floors ──
  for (let ri = 0; ri < rooms.length; ri++) {
    const room = rooms[ri];
    const s = step(room.id);
    const b = room.bounds;
    const grid = (x0: number, x1: number, z0: number, z1: number, y: number, floor?: number) => {
      const w = x1 - x0 - 1.0, d = z1 - z0 - 1.0;
      if (decks && (w < 0 || d < 0)) {
        // a strip narrower than a metre: one row down its middle
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, len = Math.max(x1 - x0, z1 - z0), n = Math.max(1, Math.round((len - 1) / s));
        for (let i = 0; i <= n; i++) {
          const k = n ? i / n : 0.5;
          const x = w < 0 ? cx : x0 + 0.5 + k * w, z = d < 0 ? cz : z0 + 0.5 + k * d;
          if (free(x, z, 0.42, y)) add(x, y, z, room.id, s, floor);
        }
        return;
      }
      const nx = Math.max(1, Math.round(w / s)), nz = Math.max(1, Math.round(d / s));
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
        const x = x0 + 0.5 + (i * w) / nx, z = z0 + 0.5 + (j * d) / nz;
        if (free(x, z, 0.42, y)) add(x, y, z, room.id, Math.max(w / nx, d / nz), floor);
      }
    };
    if (!decks) {
      // (levels 1, 2: exactly the classic grid)
      grid(b.min.x, b.max.x, b.min.z, b.max.z, 0);
      continue;
    }
    grid(b.min.x, b.max.x, b.min.z, b.max.z, floorY[ri]);
    (room.floors ?? []).forEach((f, k) => { if (f.nav !== false) grid(f.box[0], f.box[1], f.box[2], f.box[3], f.y, k); });
  }
  for (const e of L.navExtra) {
    add(e.p.x, e.p.y, e.p.z, e.room, 1.6, decks ? floorIndex(roomIndex(e.room), e.p.x, e.p.y, e.p.z) : undefined);
  }

  // ── stairs: floor node past each end + a chain on the slope every 1.0 m (links only along the chain) ──
  const chains: NavNode[][] = [];
  const info: NavInfo = { decks, floors: {}, stairs: [], drops: [], blockedEnds: [], ms: 0 };
  for (const s of stairs) {
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, hl = Math.hypot(dx, dz), ux = dx / hl, uz = dz / hl;
    const len = s.a.distanceTo(s.b), n = Math.max(1, Math.ceil(len / 1.0));
    const end = (p: THREE.Vector3, sign: number, tag: string) => {
      const x = p.x + ux * 0.6 * sign, z = p.z + uz * 0.6 * sign;
      const ri = roomAtPlan(x, z), room = ri >= 0 ? rooms[ri].id : s.room;
      if (!free(x, z, 0.3, p.y)) info.blockedEnds.push(`${s.room} ${tag} (${x.toFixed(2)}, ${p.y}, ${z.toFixed(2)})`);
      return add(x, p.y, z, room, 1.6, floorIndex(ri, x, p.y, z));
    };
    const chain: NavNode[] = [end(s.a, -1, 'bottom')];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const node = add(s.a.x + dx * t, s.a.y + (s.b.y - s.a.y) * t, s.a.z + dz * t, s.room, 1.0);
      node.stair = true;
      chain.push(node);
    }
    chain.push(end(s.b, 1, 'top'));
    chains.push(chain);
    info.stairs.push({ room: s.room, a: s.a.toArray(), b: s.b.toArray(), width: s.width, nodes: n + 1 });
  }
  // ── drops: a node at the ledge and one where the body lands; the one-way link joins them ──
  const dropPairs: [NavNode, NavNode][] = [];
  for (const d of drops) {
    const fi = roomAtPlan(d.from.x, d.from.z), ti = roomAtPlan(d.to.x, d.to.z);
    const a = add(d.from.x, d.from.y, d.from.z, fi >= 0 ? rooms[fi].id : rooms[0].id, 1.6, floorIndex(fi, d.from.x, d.from.y, d.from.z));
    const b = add(d.to.x, d.to.y, d.to.z, ti >= 0 ? rooms[ti].id : rooms[0].id, 1.6, floorIndex(ti, d.to.x, d.to.y, d.to.z));
    dropPairs.push([a, b]);
  }
  const firstPortal = nodes.length;
  for (const p of portals) {
    const py = p.y ?? 0;
    let room = rooms[0].id, best = Infinity, bi = 0;
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      const c = r.bounds.distanceToPoint(new THREE.Vector3(p.x, py + 1, p.z));
      if (c < best) { best = c; room = r.id; bi = i; }
    }
    add(p.x, py, p.z, room, 1.6, decks ? floorIndex(bi, p.x, py, p.z) : undefined);
  }
  const link = (a: NavNode, b: NavNode) => { if (!a.links.includes(b.id)) { a.links.push(b.id); b.links.push(a.id); } };
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (a.stair) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      if (b.stair) continue;
      const portal = i >= firstPortal || j >= firstPortal;
      const max = portal ? 2.3 : Math.max(steps[i], steps[j]) * 1.5;
      const dx = a.position.x - b.position.x, dz = a.position.z - b.position.z;
      if (dx * dx + dz * dz > max * max) continue;
      if (Math.abs(a.position.y - b.position.y) > 0.6) continue;
      if (clear(a.position, b.position, 0.36)) link(a, b);
    }
  }
  for (const c of chains) for (let k = 1; k < c.length; k++) link(c[k - 1], c[k]);
  for (const [a, b] of dropPairs) (a.drops ??= []).push(b.id);

  // prune nodes not reachable from the first node (keeps ids dense); drops count one way
  const seen = new Uint8Array(nodes.length);
  let start = 0, sd = Infinity;
  for (const n of nodes) {
    const dy = startAt.y === undefined ? 0 : (n.position.y - startAt.y) * 2;
    const d = (n.position.x - startAt.x) * (n.position.x - startAt.x) + (n.position.z - startAt.z) * (n.position.z - startAt.z) + dy * dy;
    if (d < sd) { sd = d; start = n.id; }
  }
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const n = nodes[queue.pop()!];
    for (const l of n.links) if (!seen[l]) { seen[l] = 1; queue.push(l); }
    if (n.drops) for (const l of n.drops) if (!seen[l]) { seen[l] = 1; queue.push(l); }
  }
  for (const n of nodes) {
    const k = n.stair ? `${n.room}:stair` : floorKey(n.room, n.floor);
    const e = (info.floors[k] ??= { y: n.position.y, made: 0, kept: 0 });
    e.made++;
    if (seen[n.id]) e.kept++;
  }
  for (const r of rooms) {
    // a declared floor that produced no node at all is reported too (made 0)
    if (!decks) break;
    (info.floors[floorKey(r.id, undefined)] ??= { y: roomFloor(r), made: 0, kept: 0 });
    (r.floors ?? []).forEach((f, k) => {
      const e = (info.floors[floorKey(r.id, k)] ??= { y: f.y, made: 0, kept: 0 });
      if (f.nav === false) e.nav = false;
    });
  }
  for (const [a, b] of dropPairs) info.drops.push({ from: a.position.toArray(), to: b.position.toArray(), ok: !!(seen[a.id] && seen[b.id]) });
  const remap = new Int32Array(nodes.length).fill(-1);
  const out: NavNode[] = [];
  for (let i = 0; i < nodes.length; i++) if (seen[i]) { remap[i] = out.length; out.push(nodes[i]); }
  for (const n of out) {
    n.id = remap[n.id];
    n.links = n.links.map((l) => remap[l]).filter((l) => l >= 0);
    if (n.drops) { n.drops = n.drops.map((l) => remap[l]).filter((l) => l >= 0); if (!n.drops.length) delete n.drops; }
  }
  if (out.length < nodes.length && L.ctx.debug.verbose) console.info(`[level] nav: pruned ${nodes.length - out.length} unreachable nodes`);
  if (decks) {
    const lost = Object.entries(info.floors).filter(([, f]) => f.kept === 0 && f.nav !== false).map(([k]) => k);
    if (lost.length && L.ctx.debug.verbose) console.warn(`[level] nav: floors with no reachable node (no stair / door links them): ${lost.join(' ')}`);
    for (const e of info.blockedEnds) console.warn(`[level] nav: stair end blocked — ${e}`);
  }
  info.ms = performance.now() - t0;
  L.root.userData.nav = info;
  return out;
}
