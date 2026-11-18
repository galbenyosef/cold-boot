/**
 * LEVEL 6 — the moon pool's dock arena as the loader reads it (`Level.dock`; stage 3d §2.6.9, §2.6.10, §5.6.4, §5.6.7,
 * §8.1, B2, S6a, S6b). Task W4b. W4a's `l6/index.ts` passes the result to `assembleLevel({ dock })`; call it after the
 * rooms are built and BEFORE `assembleLevel` (the slot boxes are nav obstacles).
 *
 * - The six cargo slots `sl6_1 … sl6_6` (§2.6.9 table) with their dock cover points (§5.4, set `dock`): a slot's cover is
 *   enabled only while the slot holds a container (synced on the first frame and on every lift / place / drop).
 * - The four containers at load (B-09, B-11, B-12, B-10): a greybox mesh group (`level.object('cargo6_B-09')` … — D3b's
 *   dockdress.ts dresses them; origin = the footprint's bottom centre, long axis x) and a NON-walkable dynamic box
 *   (`CargoHandle.box`, B2: a capsule cannot rest on it). While a container is lifted the loader moves `handle.object`
 *   (position = bottom centre); the dock keeps `handle.box` on it every frame until it is placed / dropped.
 * - All six slot boxes are PERMANENT nav obstacles in their floor's band (S6a), occupied or not.
 * - `target(p, lane?)`: the one slam / set-down / swing target test (S6b) — ray-free, from the arena's static collider
 *   AABBs (`LevelBuild.solids`, gathered on first use) and the containers' boxes. See `target` below.
 * - `noSlam` (the frame / cage / trough / winch plan box), `park` (−52, −8, −186), `rails` (the grab centre's travel).
 */
import * as THREE from 'three';
import type { CargoHandle, CargoSlot, DockArena, DynamicBox, MaterialName } from '../../core/types';
import type { LevelBuild } from '../context';

/** §2.6.9 slot table: [id, x0, x1, z0, z1, floor y, container at load | null, cover ids (§5.4)]. */
const SLOTS6: readonly (readonly [string, number, number, number, number, number, string | null, readonly string[]])[] = [
  ['sl6_1', -74, -68, -182.0, -179.6, -20, 'B-09', ['cv6_s1n', 'cv6_s1s', 'cv6_s1e']],
  ['sl6_2', -74, -68, -176.4, -174.0, -20, null, ['cv6_s2n', 'cv6_s2s', 'cv6_s2e']],
  ['sl6_3', -36, -30, -182.0, -179.6, -20, 'B-11', ['cv6_s3n', 'cv6_s3s', 'cv6_s3w']],
  ['sl6_4', -36, -30, -176.4, -174.0, -20, 'B-12', ['cv6_s4n', 'cv6_s4s', 'cv6_s4w']],
  ['sl6_5', -60, -54, -192.0, -189.6, -20.8, 'B-10', ['cv6_s5n', 'cv6_s5s', 'cv6_s5w']],
  ['sl6_6', -50, -44, -192.0, -189.6, -20.8, null, ['cv6_s6n', 'cv6_s6s', 'cv6_s6e']],
];
/** Containers: 6.0 (x) × 2.6 (y) × 2.4 (z). Paint per container (W5 materials; the fallback until then). */
const CONTAINER = { lx: 6.0, h: 2.6, lz: 2.4 } as const;
const PAINT6: Record<string, MaterialName> = { 'B-09': 'container_navy', 'B-10': 'container_orange', 'B-11': 'container_navy', 'B-12': 'container_orange' };

/** §5.6.6 `noSlam`: the cage, the frame, the trough and the winch (plan x −58 … −46, z −174 … −149); margin on the mid deck. */
const NO_SLAM = new THREE.Box3(new THREE.Vector3(-58, -21.5, -174), new THREE.Vector3(-46, -12.5, -149));
const NO_SLAM_MARGIN = 3.5;
/** §2.6.10: the grab centre's travel (trolley x, bridge z) and the runway rails' height. */
const RAILS = { xMin: -71, xMax: -33, zMin: -192, zMax: -153, railY: -4.0 } as const;
const PARK = new THREE.Vector3(-52, -8, -186);
/** §5.6.4 SWING: the trolley's lane range (4.2 m from the galleries' edges). */
const SWING_X = [-67, -37] as const;
/** The grab: 2.4 × 2.4 plan, 1.6 high; its bottom when raised (top y −6.4); the swing's bottom above the deck. */
const GRAB = { half: 1.2, h: 1.6, raisedBottom: -8.0, swingBottom: 1.15 } as const;
/** Decks a slam / set-down may target (§5.6.4): the dock (−20), the mid deck (−16); the wet dock by its water depth. */
const DECKS = [-20, -16] as const;
const MAX_DEPTH = 0.7;
/** The stairs' plan boxes (§2.6.9 ST6_M, ST6_M2, ST6_NE, ST6_W): no target within 1.5 m. */
const STAIRS6: readonly (readonly [number, number, number, number])[] = [
  [-72.0, -70.0, -171.6, -166.0], [-34.0, -32.0, -171.6, -166.0], [-35.0, -33.2, -157.6, -152.0], [-72.6, -70.8, -157.6, -152.0],
];
const STAIR_MARGIN = 1.5;
/** The coaming's plan box (§2.6.9) — every slot ≥ 6.5 m from it (§2.10; asserted at build). */
const COAMING = [-58.4, -45.6, -182.4, -169.6] as const;
/** The arena region whose static collider AABBs `target` reads (grown past the rails by the grab and a margin). */
const ARENA = new THREE.Box3(new THREE.Vector3(-76, -22, -196), new THREE.Vector3(-28, -6, -148));

interface Handle extends CargoHandle { readonly label: string }

export function buildDock6(L: LevelBuild): DockArena | null {
  const ctx = L.ctx;
  const slots: CargoSlot[] = SLOTS6.map(([id, x0, x1, z0, z1, y, container, cover]) => ({
    id, box: new THREE.Box3(new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y + CONTAINER.h, z1)), floorY: y, container, cover: [...cover],
  }));
  const slotOf = (id: string): CargoSlot | null => {
    const s = slots.find((q) => q.id === id) ?? null;
    if (!s) console.warn(`[level6] dock: unknown slot "${id}"`);
    return s;
  };

  // ── build-time assertions: every slot ≥ 6.5 m from the coaming (§2.10), inside the rails' reach (§2.6.10) ──
  for (const s of slots) {
    const dx = Math.max(COAMING[0] - s.box.max.x, s.box.min.x - COAMING[1], 0), dz = Math.max(COAMING[2] - s.box.max.z, s.box.min.z - COAMING[3], 0);
    if (Math.hypot(dx, dz) < 6.5) console.error(`[level6] dock: ${s.id} is ${Math.hypot(dx, dz).toFixed(2)} m from the coaming (< 6.5, §2.10)`);
    const c = s.box.getCenter(new THREE.Vector3());
    if (c.x < RAILS.xMin - 1e-6 || c.x > RAILS.xMax + 1e-6 || c.z < RAILS.zMin - 1e-6 || c.z > RAILS.zMax + 1e-6) console.error(`[level6] dock: ${s.id} centre outside the grab's travel`);
  }

  // ── S6a: the six slot boxes are permanent nav obstacles in their floor's band (floor + 0.75 … floor + 1.5) ──
  for (const s of slots) L.obstacles.push(new THREE.Box3(new THREE.Vector3(s.box.min.x, s.floorY + 0.75, s.box.min.z), new THREE.Vector3(s.box.max.x, s.floorY + 1.5, s.box.max.z)));

  // ── containers ──
  const handles = new Map<string, Handle>();
  const carried = new Set<Handle>();
  const footprint = (h: Handle, out: THREE.Box3) => {
    const p = h.object.position;
    return out.set(new THREE.Vector3(p.x - CONTAINER.lx / 2, p.y, p.z - CONTAINER.lz / 2), new THREE.Vector3(p.x + CONTAINER.lx / 2, p.y + CONTAINER.h, p.z + CONTAINER.lz / 2));
  };
  const makeContainer = (label: string, s: CargoSlot): Handle => {
    const group = new THREE.Group();
    group.name = `cargo6_${label}`;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(CONTAINER.lx, CONTAINER.h, CONTAINER.lz), ctx.materials.get(PAINT6[label] ?? 'container_navy'));
    mesh.position.y = CONTAINER.h / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    group.userData.rooms = ['pool6'];
    group.userData.cargo = label;
    L.root.add(group);
    L.objects.set(group.name, group);
    const box: DynamicBox = ctx.physics.addBox(new THREE.Box3(), 'metal');
    box.owner = group; // decals ride the container (§5.6.7, HitOwner)
    const h: Handle = { id: label, label, object: group, box };
    const c = s.box.getCenter(new THREE.Vector3());
    group.position.set(c.x, s.floorY, c.z);
    footprint(h, box.box);
    return h;
  };
  for (const s of slots) if (s.container) handles.set(s.container, makeContainer(s.container, s));

  // ── cover points follow the slots (Level.cover is W4a's data; resolved at run time) ──
  const setCover = (s: CargoSlot, on: boolean) => {
    const cover = ctx.level?.cover;
    if (!cover) return;
    for (const id of s.cover) { const c = cover.find((q) => q.id === id); if (c) c.enabled = on; }
  };
  const syncCover = () => { for (const s of slots) setCover(s, s.container !== null && !falling.has(s.container)); };
  const falling = new Set<string>();
  let synced = false;
  L.updaters.push(() => {
    if (!synced && ctx.level) { synced = true; syncCover(); }
    for (const h of carried) footprint(h, h.box.box);
  });

  const release = (h: Handle) => {
    for (const s of slots) if (s.container === h.id) s.container = null;
  };
  const settle = (h: Handle, s: CargoSlot) => {
    const c = s.box.getCenter(new THREE.Vector3());
    h.object.position.set(c.x, s.floorY, c.z);
    h.object.rotation.set(0, 0, 0);
    footprint(h, h.box.box);
    h.box.enabled = true;
    carried.delete(h);
  };

  // ── target: the static collider AABBs of the arena (gathered once, on first use: L.solids is complete by then) ──
  let arena: THREE.Box3[] | null = null;
  const arenaSolids = () => (arena ??= L.solids.filter((b) => b.intersectsBox(ARENA)));
  const col = new THREE.Box3();
  /** Highest static top under (x, z) at or below y + 0.5 (the deck the point stands on), or null. */
  const groundAt = (x: number, y: number, z: number): number | null => {
    let best: number | null = null;
    for (const b of arenaSolids()) {
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
      if (b.max.y > y + 0.5) continue;
      if (best === null || b.max.y > best) best = b.max.y;
    }
    return best;
  };
  /** Is the column over a 2.4 m footprint at (x, z), from y0 up to y1, clear of every static collider and container? */
  const columnClear = (x: number, z: number, y0: number, y1: number, skip?: Handle | null): boolean => {
    const e = GRAB.half + 0.05;
    col.min.set(x - e, y0, z - e); col.max.set(x + e, y1, z + e);
    for (const b of arenaSolids()) if (b.intersectsBox(col)) return false;
    for (const h of handles.values()) if (h !== skip && h.box.enabled && h.box.box.intersectsBox(col)) return false;
    return true;
  };
  const depthAt = (x: number, y: number, z: number): number => {
    let d = 0;
    for (const w of ctx.level?.water ?? []) {
      const b = w.box;
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z || y >= w.surface || y < b.min.y - 0.3) continue;
      d = Math.max(d, w.surface - y);
    }
    return d;
  };
  /** The deck kind at a point, or null when it is not a legal target deck. */
  const deckAt = (p: THREE.Vector3): { y: number; deck: 'dock' | 'mid' | 'wet' } | null => {
    if (p.x < RAILS.xMin || p.x > RAILS.xMax || p.z < RAILS.zMin || p.z > RAILS.zMax) return null;
    for (const s of STAIRS6) if (p.x > s[0] - STAIR_MARGIN && p.x < s[1] + STAIR_MARGIN && p.z > s[2] - STAIR_MARGIN && p.z < s[3] + STAIR_MARGIN) return null;
    const g = groundAt(p.x, p.y, p.z);
    if (g === null) return null;
    const inPlan = (m: number) => p.x > NO_SLAM.min.x - m && p.x < NO_SLAM.max.x + m && p.z > NO_SLAM.min.z - m && p.z < NO_SLAM.max.z + m;
    const d = depthAt(p.x, g, p.z);
    if (d > 0) return d <= MAX_DEPTH && !inPlan(0) ? { y: g, deck: 'wet' } : null;
    if (Math.abs(g - DECKS[0]) < 0.1) return inPlan(0) ? null : { y: g, deck: 'dock' };
    if (Math.abs(g - DECKS[1]) < 0.1) return inPlan(NO_SLAM_MARGIN) ? null : { y: g, deck: 'mid' };
    return null;
  };

  const dock: DockArena & { debug: () => unknown } = {
    slots,
    noSlam: NO_SLAM,
    park: PARK,
    rails: RAILS,
    lift(slot) {
      const s = slotOf(slot);
      if (!s || !s.container || falling.has(s.container)) return null;
      const h = handles.get(s.container);
      if (!h) return null;
      s.container = null;
      setCover(s, false);
      carried.add(h);
      return h;
    },
    place(h0, slot) {
      const s = slotOf(slot), h = handles.get(h0.id);
      if (!s || !h) return;
      if (s.container && s.container !== h.id) { console.warn(`[level6] dock: place ${h.id} into ${slot}, which holds ${s.container}`); return; }
      release(h);
      falling.delete(h.id);
      s.container = h.id;
      settle(h, s);
      setCover(s, true);
    },
    drop(h0, slot, from) {
      const s = slotOf(slot), h = handles.get(h0.id);
      if (!s || !h) return;
      if (s.container && s.container !== h.id) { console.warn(`[level6] dock: drop ${h.id} into ${slot}, which holds ${s.container}`); return; }
      release(h);
      s.container = h.id; // reserved from the release on (nothing else targets it); cover only once it lands
      falling.add(h.id);
      setCover(s, false);
      carried.delete(h);
      const c = s.box.getCenter(new THREE.Vector3());
      const g = Math.abs(ctx.physics.gravity || 19);
      let y = Math.max(from, s.floorY), v = 0;
      h.object.position.set(c.x, y, c.z);
      h.object.rotation.set(0, 0, 0);
      footprint(h, h.box.box);
      L.sim((dt) => {
        if (!falling.has(h.id) || s.container !== h.id) return false; // placed / lifted elsewhere meanwhile
        v += g * dt; y -= v * dt;
        if (y <= s.floorY) { falling.delete(h.id); settle(h, s); setCover(s, true); return false; }
        h.object.position.y = y;
        footprint(h, h.box.box);
        return true;
      });
    },
    target(p, lane) {
      const a = deckAt(p);
      if (!a) return false;
      if (!lane) return columnClear(p.x, p.z, a.y + 0.05, GRAB.raisedBottom);
      // SWING: both ends on the same deck, inside the trolley's lane range, the arc (grab at swing height and the ropes
      // above it) clear of every collider and container all along
      const b = deckAt(lane);
      if (!b || Math.abs(a.y - b.y) > 0.1) return false;
      if (p.x < SWING_X[0] || p.x > SWING_X[1] || lane.x < SWING_X[0] || lane.x > SWING_X[1]) return false;
      const len = Math.hypot(lane.x - p.x, lane.z - p.z), n = Math.max(1, Math.ceil(len / 0.6));
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = p.x + (lane.x - p.x) * t, z = p.z + (lane.z - p.z) * t;
        if (!columnClear(x, z, a.y + GRAB.swingBottom, GRAB.raisedBottom)) return false;
      }
      return true;
    },
    /** Tests / the dev page: the slot layout, containers and carried state. */
    debug() {
      return {
        slots: slots.map((s) => ({ id: s.id, container: s.container, falling: !!s.container && falling.has(s.container) })),
        containers: [...handles.values()].map((h) => ({ id: h.id, pos: h.object.position.toArray(), box: [...h.box.box.min.toArray(), ...h.box.box.max.toArray()], carried: carried.has(h), walkable: !!h.box.walkable })),
        arenaSolids: arenaSolids().length,
      };
    },
  };
  return dock;
}
