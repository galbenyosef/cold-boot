/**
 * Navigation: A* over the level's nav graph (`Level.nav`) with precomputed neighbour tables, door-aware links,
 * and a tiny shared cache for "which node is the player at". No allocations per query.
 *
 * Nav v2 (stage 3a §8.10): costs and the heuristic are 3-D; one-way drop links (`NavNode.drops`) are followed
 * downward only and cost a penalty (stairs are preferred unless the drop saves a lot); on a multi-deck level
 * (`decks`) a walk test can also require floor under the whole line, and a search can return a partial path
 * (to the reachable node nearest the goal) for standing off when the player cannot be reached.
 */
import * as THREE from 'three';
import type { Door, GameContext, NavNode } from '../core/types';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
/** Extra cost (m) of a drop link over its length: walking down a stair wins unless the drop saves more. */
const DROP_PENALTY = 8;

export class NavGraph {
  readonly count: number;
  /**
   * §8.10: the level has more than one walkable floor (extra floors, floors off y 0, stairs or drops). Only then do
   * the multi-deck rules apply (ground under walk lines, partial paths, stand-off); levels 1–2 run the classic code.
   */
  readonly decks: boolean;
  /** The last `findPath(…, partial = true)` returned a path that ends short of the goal. */
  lastPartial = false;
  private pos: THREE.Vector3[] = [];
  private adj: Int32Array[] = [];
  private cost: Float32Array[] = [];
  /** Per link: index into ctx.level.doors, or -1. */
  private linkDoor: Int16Array[] = [];
  private g: Float32Array;
  private f: Float32Array;
  private parent: Int32Array;
  private stamp: Int32Array;   // open/closed marks per search
  private closed: Int32Array;
  private open: Int32Array;
  private search = 0;
  private doors: readonly Door[];
  private goalNode = -1;
  private goalTime = -1;
  private nearest = new Int32Array(4);
  private nearestD = new Float32Array(4);

  constructor(private ctx: GameContext) {
    const nodes: readonly NavNode[] = ctx.level.nav ?? [];
    this.doors = ctx.level.doors ?? [];
    this.count = nodes.length;
    this.decks = nodes.some((n) => n.floor !== undefined || n.stair || (n.drops?.length ?? 0) > 0 || Math.abs(n.position.y) > 0.3);
    const idToIndex = new Map<number, number>();
    nodes.forEach((n, i) => idToIndex.set(n.id, i));
    for (let i = 0; i < nodes.length; i++) this.pos.push(nodes[i].position);
    for (let i = 0; i < nodes.length; i++) {
      const links: number[] = [];
      for (const l of nodes[i].links) {
        const j = idToIndex.get(l);
        if (j !== undefined && j !== i && !links.includes(j)) links.push(j);
      }
      // make links symmetric-safe: also include nodes that link to us
      this.adj.push(Int32Array.from(links));
    }
    // symmetrise
    const extra: number[][] = nodes.map(() => []);
    for (let i = 0; i < nodes.length; i++) for (const j of this.adj[i]) if (!this.adj[j].includes(i)) extra[j].push(i);
    for (let i = 0; i < nodes.length; i++) if (extra[i].length) this.adj[i] = Int32Array.from([...this.adj[i], ...extra[i]]);
    // one-way drops (after symmetrising: never mirrored)
    const dropFrom: number[] = this.adj.map((a) => a.length);
    for (let i = 0; i < nodes.length; i++) {
      const ds = nodes[i].drops;
      if (!ds?.length) continue;
      const add: number[] = [];
      for (const l of ds) { const j = idToIndex.get(l); if (j !== undefined && j !== i && !this.adj[i].includes(j)) add.push(j); }
      if (add.length) this.adj[i] = Int32Array.from([...this.adj[i], ...add]);
    }
    for (let i = 0; i < nodes.length; i++) {
      const c = new Float32Array(this.adj[i].length), d = new Int16Array(this.adj[i].length).fill(-1);
      for (let k = 0; k < c.length; k++) {
        const j = this.adj[i][k];
        c[k] = this.pos[i].distanceTo(this.pos[j]) + (k >= dropFrom[i] ? DROP_PENALTY : 0);
        // a door governs a link that passes within 0.9 m of it on the door's own floor
        const ly = this.decks ? (this.pos[i].y + this.pos[j].y) / 2 : this.pos[i].y;
        for (let di = 0; di < this.doors.length; di++) {
          if (distPointSegXZ(this.doors[di].position, this.pos[i], this.pos[j]) < 0.9 && Math.abs(this.doors[di].position.y - ly) < (this.decks ? 2 : 2.5)) { d[k] = di; break; }
        }
      }
      this.cost.push(c); this.linkDoor.push(d);
    }
    const n = Math.max(1, nodes.length);
    this.g = new Float32Array(n); this.f = new Float32Array(n);
    this.parent = new Int32Array(n); this.stamp = new Int32Array(n); this.closed = new Int32Array(n); this.open = new Int32Array(n);
  }

  nodePos(i: number): THREE.Vector3 { return this.pos[i]; }

  /**
   * Nearest node to p, preferring one reachable in a straight walk. -1 if the graph is empty.
   * `ground` (multi-deck levels): the walk must also have floor under it (see `walkable`).
   */
  nearestNode(p: THREE.Vector3, checkWalk = true, ground = false): number {
    if (this.count === 0) return -1;
    const K = this.nearest.length;
    for (let k = 0; k < K; k++) { this.nearest[k] = -1; this.nearestD[k] = Infinity; }
    for (let i = 0; i < this.count; i++) {
      const q = this.pos[i];
      const dy = Math.abs(q.y - p.y);
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2 + dy * dy * 4;
      if (d >= this.nearestD[K - 1]) continue;
      let k = K - 1;
      while (k > 0 && this.nearestD[k - 1] > d) { this.nearest[k] = this.nearest[k - 1]; this.nearestD[k] = this.nearestD[k - 1]; k--; }
      this.nearest[k] = i; this.nearestD[k] = d;
    }
    if (checkWalk) {
      for (let k = 0; k < K; k++) {
        const i = this.nearest[k];
        if (i < 0) break;
        if (this.walkable(p, this.pos[i], 0.35, ground)) return i;
      }
    }
    return this.nearest[0];
  }

  /**
   * Straight-line walk test (thin ray at shin height). With `ground` on a multi-deck level, every ~0.5 m of the
   * line must also have floor under it within 1.1 m of the line (no walking off a balcony / over a stairwell).
   */
  walkable(a: THREE.Vector3, b: THREE.Vector3, h = 0.35, ground = false): boolean {
    _a.set(a.x, a.y + h, a.z); _b.set(b.x, b.y + h, b.z);
    if (!this.ctx.physics.lineOfSight(_a, _b)) return false;
    if (!ground || !this.decks) return true;
    const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(len / 0.5);
    for (let i = 1; i < n; i++) {
      const t = i / n, y = a.y + (b.y - a.y) * t;
      _c.set(a.x + (b.x - a.x) * t, y + 0.5, a.z + (b.z - a.z) * t);
      const hit = this.ctx.physics.raycast(_c, DOWN, 1.6);
      if (!hit || hit.normal.y < 0.5) return false;
    }
    return true;
  }

  /** Node nearest the player, cached for a short time (shared by all enemies). */
  playerNode(time: number, playerPos: THREE.Vector3): number {
    if (time - this.goalTime > 0.3 || this.goalNode < 0) {
      this.goalNode = this.nearestNode(playerPos, true, this.decks);
      this.goalTime = time;
    }
    return this.goalNode;
  }

  /**
   * A*. Writes node indices start→goal into `out` and returns the length (0 if no path). With `partial`, an
   * unreachable goal yields the path to the explored node nearest it (3-D) instead (`lastPartial` = true).
   */
  findPath(start: number, goal: number, out: number[], partial = false): number {
    out.length = 0;
    this.lastPartial = false;
    if (start < 0 || goal < 0) return 0;
    if (start === goal) { out.push(start); return 1; }
    const s = ++this.search;
    let openN = 0;
    const goalP = this.pos[goal];
    this.g[start] = 0; this.f[start] = this.pos[start].distanceTo(goalP);
    this.parent[start] = -1; this.stamp[start] = s;
    this.open[openN++] = start;
    let best = start, bestH = this.f[start];
    while (openN > 0) {
      let bi = 0, bf = this.f[this.open[0]];
      for (let k = 1; k < openN; k++) { const ff = this.f[this.open[k]]; if (ff < bf) { bf = ff; bi = k; } }
      const cur = this.open[bi];
      this.open[bi] = this.open[--openN];
      if (cur === goal) break;
      this.closed[cur] = s;
      if (partial) { const h = this.pos[cur].distanceTo(goalP); if (h < bestH) { bestH = h; best = cur; } }
      const adj = this.adj[cur], cost = this.cost[cur], doors = this.linkDoor[cur];
      for (let k = 0; k < adj.length; k++) {
        const nb = adj[k];
        if (this.closed[nb] === s) continue;
        const di = doors[k];
        if (di >= 0) { const d = this.doors[di]; if (d.locked && !d.isOpen) continue; }
        const ng = this.g[cur] + cost[k];
        if (this.stamp[nb] !== s) {
          this.stamp[nb] = s; this.g[nb] = ng; this.f[nb] = ng + this.pos[nb].distanceTo(goalP); this.parent[nb] = cur;
          this.open[openN++] = nb;
        } else if (ng < this.g[nb]) {
          this.g[nb] = ng; this.f[nb] = ng + this.pos[nb].distanceTo(goalP); this.parent[nb] = cur;
        }
      }
    }
    let n = goal;
    if (this.stamp[goal] !== s) {
      if (!partial) return 0;
      n = best;
      this.lastPartial = true;
    }
    let len = 0;
    while (n >= 0) { out.push(n); n = this.parent[n]; if (++len > this.count) break; }
    out.reverse();
    return out.length;
  }
}

function distPointSegXZ(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-8 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2 : 0;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
