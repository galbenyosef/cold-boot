/**
 * Navigation: A* over the level's nav graph (`Level.nav`) with precomputed neighbour tables, door-aware links,
 * and a tiny shared cache for "which node is the player at". No allocations per query.
 */
import * as THREE from 'three';
import type { Door, GameContext, NavNode } from '../core/types';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class NavGraph {
  readonly count: number;
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
    for (let i = 0; i < nodes.length; i++) {
      const c = new Float32Array(this.adj[i].length), d = new Int16Array(this.adj[i].length).fill(-1);
      for (let k = 0; k < c.length; k++) {
        const j = this.adj[i][k];
        c[k] = this.pos[i].distanceTo(this.pos[j]);
        for (let di = 0; di < this.doors.length; di++) {
          if (distPointSegXZ(this.doors[di].position, this.pos[i], this.pos[j]) < 0.9 && Math.abs(this.doors[di].position.y - this.pos[i].y) < 2.5) { d[k] = di; break; }
        }
      }
      this.cost.push(c); this.linkDoor.push(d);
    }
    const n = Math.max(1, nodes.length);
    this.g = new Float32Array(n); this.f = new Float32Array(n);
    this.parent = new Int32Array(n); this.stamp = new Int32Array(n); this.closed = new Int32Array(n); this.open = new Int32Array(n);
  }

  nodePos(i: number): THREE.Vector3 { return this.pos[i]; }

  /** Nearest node to p, preferring one reachable in a straight walk. -1 if the graph is empty. */
  nearestNode(p: THREE.Vector3, checkWalk = true): number {
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
        if (this.walkable(p, this.pos[i])) return i;
      }
    }
    return this.nearest[0];
  }

  /** Straight-line walk test (thin ray at shin height). */
  walkable(a: THREE.Vector3, b: THREE.Vector3, h = 0.35): boolean {
    _a.set(a.x, a.y + h, a.z); _b.set(b.x, b.y + h, b.z);
    return this.ctx.physics.lineOfSight(_a, _b);
  }

  /** Node nearest the player, cached for a short time (shared by all enemies). */
  playerNode(time: number, playerPos: THREE.Vector3): number {
    if (time - this.goalTime > 0.3 || this.goalNode < 0) {
      this.goalNode = this.nearestNode(playerPos, true);
      this.goalTime = time;
    }
    return this.goalNode;
  }

  /**
   * A*. Writes node indices start→goal into `out` and returns the length (0 if no path).
   */
  findPath(start: number, goal: number, out: number[]): number {
    out.length = 0;
    if (start < 0 || goal < 0) return 0;
    if (start === goal) { out.push(start); return 1; }
    const s = ++this.search;
    let openN = 0;
    const goalP = this.pos[goal];
    this.g[start] = 0; this.f[start] = this.pos[start].distanceTo(goalP);
    this.parent[start] = -1; this.stamp[start] = s;
    this.open[openN++] = start;
    while (openN > 0) {
      let bi = 0, bf = this.f[this.open[0]];
      for (let k = 1; k < openN; k++) { const ff = this.f[this.open[k]]; if (ff < bf) { bf = ff; bi = k; } }
      const cur = this.open[bi];
      this.open[bi] = this.open[--openN];
      if (cur === goal) break;
      this.closed[cur] = s;
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
    if (this.stamp[goal] !== s) return 0;
    let n = goal, len = 0;
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
