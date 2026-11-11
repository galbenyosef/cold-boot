/** Fixed-capacity slot pool with a compact, order-preserving active list. Zero allocation after construction. */
export class SlotPool {
  readonly cap: number;
  readonly active: Int32Array;
  count = 0;
  private free: Int32Array;
  private freeTop: number;

  constructor(cap: number) {
    this.cap = cap;
    this.active = new Int32Array(cap);
    this.free = new Int32Array(cap);
    for (let i = 0; i < cap; i++) this.free[i] = cap - 1 - i;
    this.freeTop = cap;
  }

  /** Returns a slot id or -1 when full. */
  alloc(): number {
    if (this.freeTop === 0) return -1;
    const s = this.free[--this.freeTop];
    this.active[this.count++] = s;
    return s;
  }

  /**
   * Iterate the active list; `keep(slot)` returns false to release the slot. Slots allocated while
   * iterating are preserved (and not visited this pass).
   */
  sweep(keep: (slot: number) => boolean): void {
    const n = this.count;
    let w = 0;
    for (let r = 0; r < n; r++) {
      const s = this.active[r];
      if (keep(s)) this.active[w++] = s;
      else this.free[this.freeTop++] = s;
    }
    for (let r = n; r < this.count; r++) this.active[w++] = this.active[r];
    this.count = w;
  }

  get full() { return this.freeTop === 0; }
}

/** Plane ring for cheap particle collision: n·p + d >= 0 is free space. */
export class PlaneRing {
  readonly data: Float32Array;
  private next = 0;
  constructor(readonly cap = 256) { this.data = new Float32Array(cap * 4); }
  add(nx: number, ny: number, nz: number, px: number, py: number, pz: number): number {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    const o = i * 4;
    this.data[o] = nx; this.data[o + 1] = ny; this.data[o + 2] = nz;
    this.data[o + 3] = -(nx * px + ny * py + nz * pz);
    return i;
  }
}

/** Small fast deterministic-ish RNG helpers (Math.random is fine and allocation free). */
export const rand = Math.random;
export const range = (a: number, b: number) => a + (b - a) * Math.random();
