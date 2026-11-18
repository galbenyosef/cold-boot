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
import type { Door, GameContext, NavNode, WaterVolume } from '../core/types';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
/** Extra cost (m) of a drop link over its length: walking down a stair wins unless the drop saves more. */
const DROP_PENALTY = 8;
/**
 * Stage 3d §8.4 / D13 (W3c): wading. A node's `wade` is the water depth at it (`NavNode.wade` when the level gives it,
 * else `Level.water`: surface − node floor inside a volume's box). Husks / soldiers pay × 1.4 on links INTO a node with
 * wade ≥ 0.35 and never enter one deeper than 0.6 m; skitters never one deeper than 0.1 m (`maxWade` of the caller).
 * Levels without water: every wade 0, every multiplier exactly 1 (paths and costs bit-identical to before).
 */
export const WADE = { slow: 0.35, cost: 1.4, walker: 0.6, skitter: 0.1, speed: 0.7 } as const;

/** Water depth at a FLOOR point (x, floorY, z): surface − floorY inside a volume's plan box, else 0. */
export function waterDepth(water: readonly WaterVolume[] | undefined, x: number, floorY: number, z: number): number {
  if (!water || water.length === 0) return 0;
  let best = 0;
  for (let i = 0; i < water.length; i++) {
    const w = water[i], b = w.box;
    if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
    if (floorY > w.surface + 0.02 || floorY < b.min.y - 0.3) continue;
    const d = w.surface - floorY;
    if (d > best) best = d;
  }
  return best;
}

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
  /** §8.4 (W3c): water depth per node and the cost factor of a link INTO it (1 dry, 1.4 at wade ≥ 0.35). */
  private wade: Float32Array = new Float32Array(0);
  private wadeMul: Float32Array = new Float32Array(0);
  /** The level has water at any node (else every wade test is skipped). */
  wet = false;

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
    this.dg = new Float32Array(n); this.dstamp = new Int32Array(n);
    this.refreshWade();
    // Stage 3c D20: only a level with a `nav: false` floor (or a test arena that says so) ever targets exits
    const lv = ctx.level as unknown as { rooms?: readonly { floors?: readonly { nav?: boolean }[] }[]; navExits?: boolean } | undefined;
    this.exitsAware = !!lv?.navExits || !!lv?.rooms?.some((r) => r.floors?.some((f) => f.nav === false));
  }

  // ── stage 3c §8.2.4: bounded path costs from one node (cover reachability: one search per cover choice)
  private dg: Float32Array;
  private dstamp: Int32Array;
  private dkey: Float32Array = new Float32Array(0);
  private dheap: Int32Array = new Int32Array(0);
  private dsearch = 0;
  /** Dijkstra (binary heap, lazy deletion) from `start` up to `maxCost` m (doors as findPath); read with `costTo`. */
  pathCosts(start: number, maxCost: number, maxWade: number = WADE.walker): void {
    const s = ++this.dsearch;
    if (start < 0) return;
    const cap = this.count * 8 + 16;
    if (this.dkey.length !== cap) { this.dkey = new Float32Array(cap); this.dheap = new Int32Array(cap); }
    const H = this.dheap, K = this.dkey;
    let n = 0;
    const push = (node: number, key: number) => {
      if (n >= H.length) return;
      let i = n++;
      while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= key) break; H[i] = H[p]; K[i] = K[p]; i = p; }
      H[i] = node; K[i] = key;
    };
    const pop = (): number => {
      const top = H[0];
      const ln = H[--n], lk = K[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= lk) break;
        H[i] = H[c]; K[i] = K[c]; i = c;
      }
      H[i] = ln; K[i] = lk;
      return top;
    };
    this.dg[start] = 0; this.dstamp[start] = s; push(start, 0);
    while (n > 0) {
      const gk = K[0];
      const cur = pop();
      if (gk > this.dg[cur] + 1e-6) continue;
      const adj = this.adj[cur], cost = this.cost[cur], doors = this.linkDoor[cur];
      for (let k = 0; k < adj.length; k++) {
        const nb = adj[k];
        const di = doors[k];
        if (di >= 0) { const d = this.doors[di]; if (d.locked && !d.isOpen) continue; }
        if (this.wade[nb] > maxWade) continue;
        const ng = gk + cost[k] * this.wadeMul[nb];
        if (ng > maxCost) continue;
        if (this.dstamp[nb] !== s || ng < this.dg[nb]) { this.dstamp[nb] = s; this.dg[nb] = ng; push(nb, ng); }
      }
    }
  }
  /**
   * §8.4 (W3c): (re)compute every node's `wade` from `NavNode.wade` (W4b's data, when present) or `Level.water`. Called
   * once at build; tests that inject water call it again.
   */
  refreshWade(): void {
    const nodes: readonly (NavNode & { wade?: number })[] = this.ctx.level?.nav ?? [];
    const water = this.ctx.level?.water;
    this.wade = new Float32Array(Math.max(1, this.count));
    this.wadeMul = new Float32Array(Math.max(1, this.count)).fill(1);
    this.wet = false;
    for (let i = 0; i < this.count; i++) {
      const q = this.pos[i];
      const w = typeof nodes[i]?.wade === 'number' ? nodes[i].wade! : waterDepth(water, q.x, q.y, q.z);
      this.wade[i] = w;
      if (w > 0) this.wet = true;
      if (w >= WADE.slow) this.wadeMul[i] = WADE.cost;
    }
  }
  /** Water depth at node `i` (0 = dry). */
  wadeAt(i: number): number { return i >= 0 && i < this.count ? this.wade[i] : 0; }

  /** Path cost to `node` from the last `pathCosts` start (Infinity = beyond its bound / unreachable). */
  costTo(node: number): number { return node >= 0 && this.dstamp[node] === this.dsearch ? this.dg[node] : Infinity; }

  // ── stage 3c D20 / §8.4 / S1n: the player on a `nav: false` floor → enemies target its exits and stand off
  /** The level has a `nav: false` floor (levels 1–4: false — the stand-off code never runs there). */
  readonly exitsAware: boolean;
  private soTime = -1;
  private soExit: THREE.Vector3 | null = null;
  private soCands: number[] = [];
  private soTaken = new Map<number, number>();
  /** The exit enemies are sent to now (null = the player stands on a nav floor). */
  get standOffExit(): THREE.Vector3 | null { return this.soExit; }
  /**
   * The nav node enemy `who` should stand on while the player is on a `nav: false` floor: 2–5 m from the exit nearest
   * the player, with sight of the exit, never inside an `exit_keepout` region box (level 5's walkway box x 36.2 … 38.6,
   * z −15.4 … −14.2 by default), never within 1.0 m of a door; spread over the candidates (one enemy per node).
   * −1 = the player is on a nav floor (or no candidate exists): normal behaviour.
   */
  standOffNode(who: number, time: number, playerPos: THREE.Vector3): number {
    if (!this.exitsAware) return -1;
    if (time - this.soTime > 0.3) { this.soTime = time; this.refreshStandOff(playerPos); }
    if (!this.soExit || this.soCands.length === 0) return -1;
    const have = this.soTaken.get(who);
    if (have !== undefined) return have;
    const used = new Set(this.soTaken.values());
    for (const n of this.soCands) {
      if (used.has(n)) continue;
      let close = false;
      for (const u of used) if (this.pos[u].distanceTo(this.pos[n]) < 1.3) { close = true; break; }
      if (close) continue;
      this.soTaken.set(who, n);
      return n;
    }
    const n = this.soCands[who % this.soCands.length];
    this.soTaken.set(who, n);
    return n;
  }
  private refreshStandOff(playerPos: THREE.Vector3): void {
    const lv = this.ctx.level as unknown as { floorAt?(p: THREE.Vector3): { nav: boolean; exits: readonly THREE.Vector3[] } | null; regions?: Record<string, readonly THREE.Box3[]> };
    let fi: { nav: boolean; exits: readonly THREE.Vector3[] } | null = null;
    try { fi = lv.floorAt?.(playerPos) ?? null; } catch { fi = null; }
    if (!fi || fi.nav || fi.exits.length === 0) { this.soExit = null; this.soTaken.clear(); return; }
    let ex = fi.exits[0], bd = Infinity;
    for (const e of fi.exits) { const d = e.distanceToSquared(playerPos); if (d < bd) { bd = d; ex = e; } }
    if (this.soExit && this.soExit.distanceToSquared(ex) < 1e-4) return;
    this.soExit = ex.clone();
    this.soTaken.clear();
    // stage 3d (W3c): the keep-out boxes are level data only (level 5 publishes its walkway as `regions.exit_keepout`)
    const keep = lv.regions?.exit_keepout ?? [];
    const cands: { n: number; d: number }[] = [];
    for (let i = 0; i < this.count; i++) {
      const q = this.pos[i];
      const d = Math.hypot(q.x - ex.x, q.z - ex.z);
      if (d < 2 || d > 5 || Math.abs(q.y - ex.y) > 1.0) continue;
      let bad = false;
      for (const b of keep) if (q.x > b.min.x - 0.35 && q.x < b.max.x + 0.35 && q.z > b.min.z - 0.35 && q.z < b.max.z + 0.35 && q.y > b.min.y - 1 && q.y < b.max.y + 1) { bad = true; break; }
      for (const dr of this.doors) if (!bad && Math.hypot(dr.position.x - q.x, dr.position.z - q.z) < 1.4 && Math.abs((dr.position.y ?? 0) - q.y) < 2) bad = true;
      if (bad) continue;
      _a.set(q.x, q.y + 1.5, q.z); _b.set(ex.x, ex.y + 0.6, ex.z);
      if (!this.ctx.physics.lineOfSight(_a, _b)) continue;
      cands.push({ n: i, d: Math.abs(d - 3.2) });
    }
    cands.sort((a, b) => a.d - b.d);
    this.soCands = cands.map((c) => c.n);
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
   * Stage 3d S5 (W3c): both tests use `raycastSolid` (the MOVES set: rails and bar guards stop the line, a water surface
   * is neither an obstacle nor a floor — levels without the flags: the same set as before). On a level with water, no
   * point of the line (end included) may stand in water deeper than `maxWade` (0.6 m walkers, 0.1 m skitters).
   */
  walkable(a: THREE.Vector3, b: THREE.Vector3, h = 0.35, ground = false, maxWade: number = WADE.walker): boolean {
    const phys = this.ctx.physics;
    _a.set(a.x, a.y + h, a.z); _b.set(b.x, b.y + h, b.z);
    _c.subVectors(_b, _a);
    const seg = _c.length();
    if (seg >= 1e-4 && phys.raycastSolid(_a, _c.multiplyScalar(1 / seg), seg - 0.05) !== null) return false;
    const water = this.wet ? this.ctx.level?.water : undefined;
    if ((!ground || !this.decks) && !water) return true;
    const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len / 0.5));
    for (let i = 1; i <= n; i++) {
      const t = i / n, y = a.y + (b.y - a.y) * t;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      let floor = y;
      if (ground && this.decks && i < n) {
        _c.set(x, y + 0.5, z);
        const hit = phys.raycastSolid(_c, DOWN, 1.6);
        if (!hit || hit.normal.y < 0.5) return false;
        floor = hit.point.y;
      }
      if (water && waterDepth(water, x, floor, z) > maxWade) return false;
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
  findPath(start: number, goal: number, out: number[], partial = false, maxWade: number = WADE.walker): number {
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
        if (this.wade[nb] > maxWade) continue;
        const ng = this.g[cur] + cost[k] * this.wadeMul[nb];
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
