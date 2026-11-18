/**
 * Stage 3c §8.2.10 (W3b; moved out of the retired stubrig.ts when W3a's body and W3b's behaviour were joined):
 * check-soldier's TEST ARENA.
 */
import * as THREE from 'three';
import type { CoverPoint, EnemySpawn, GameContext, NavNode } from '../../core/types';

/**
 * `?soldierArena=1` (any level; the check uses `?level=5`): a 48 × 48 m greybox far from the level (x 196 … 244,
 * z −24 … 24, floor y 0) with real colliders, a nav grid, cover points in the contract's format (`Level.cover`) and:
 *  - LANE (x 198 … 206): an open firing lane 46 m long (ranges 8 … 35 m) with a 1.0 m crate that can be toggled;
 *  - COVER YARD (x 214 … 242, z −22 … 4): six objects (low crates 1.2 m, high lockers 2.2 m) with ten cover points;
 *  - CRAWL (x 228 … 238, z 15.5 … 18.5): a trench (floor −1.4) under a solid grating slab, exit at its east end
 *    (239.6, 0, 17), with an exit keep-out box (regions `exit_keepout`) — the level's `floorAt` is wrapped so the trench
 *    is a `nav: false` floor with that exit (as W4's crawlway);
 *  - DARK: `regions.dark` boxes the check switches on and off (`arena.dark(on)`).
 * Everything is registered before the enemies' nav graph is built (createEnemies), so the soldier AI sees a level.
 */
export interface SoldierArena {
  origin: [number, number, number];
  lane: { x: number; z0: number; z1: number };
  /** The lane crate: 1.0 m (check case 3), or `h` 1.2 m (a level's low cover: the player crouched behind it is hidden). */
  crate: { on(v: boolean, h?: number): void; box: THREE.Box3 };
  dark(on: boolean, box?: THREE.Box3): void;
  /** Lights out (true): the six test lamps off, two dim red emergency lamps on — a frame-sequence look, not a rule. */
  lightsOut(on: boolean): void;
  trench: { box: THREE.Box3; floorY: number; exit: [number, number, number]; keepOut: THREE.Box3 };
  yard: { box: THREE.Box3; cover: string[]; playerSpots: [number, number, number][] };
  backCrate: [number, number, number];
}

export function buildSoldierArena(ctx: GameContext): SoldierArena {
  const level = ctx.level as unknown as {
    colliders: THREE.Mesh[]; nav: NavNode[]; cover: CoverPoint[]; regions: Record<string, THREE.Box3[]>;
    floorAt(p: THREE.Vector3): unknown; navExits?: boolean;
  };
  const group = new THREE.Group();
  group.name = 'soldier_arena';
  ctx.scene.add(group);
  const M = ctx.materials;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const colliders: THREE.Mesh[] = [];
  const solid = (mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, collide = true, surface = 'metal') => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(x1 - x0, y1 - y0, z1 - z0); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.receiveShadow = true; m.castShadow = true;
    group.add(m);
    if (collide) {
      const c = new THREE.Mesh(geo);
      c.scale.copy(m.scale); c.position.copy(m.position); c.updateMatrixWorld(true);
      c.userData.surface = surface;
      colliders.push(c);
    }
    return m;
  };
  const floor = M.get('floor_plate'), wall = M.get('wall_panel'), crateM = M.get('painted_yellow'), lockerM = M.get('painted_dark');
  const X0 = 196, X1 = 244, Z0 = -24, Z1 = 24, H = 4;
  // trench footprint (cut out of the floor slab)
  const TX0 = 228, TX1 = 238, TZ0 = 15.5, TZ1 = 18.5, TY = -1.4;
  solid(floor, X0, -0.3, Z0, X1, 0, TZ0);
  solid(floor, X0, -0.3, TZ1, X1, 0, Z1);
  solid(floor, X0, -0.3, TZ0, TX0, 0, TZ1);
  solid(floor, TX1 + 1.2, -0.3, TZ0, X1, 0, TZ1);
  // walls
  solid(wall, X0 - 0.4, 0, Z0 - 0.4, X0, H, Z1 + 0.4); solid(wall, X1, 0, Z0 - 0.4, X1 + 0.4, H, Z1 + 0.4);
  solid(wall, X0, 0, Z0 - 0.4, X1, H, Z0); solid(wall, X0, 0, Z1, X1, H, Z1 + 0.4);
  // lane divider (separates the lane from the yard: no stray sight between tests)
  solid(wall, 208, 0, Z0, 208.4, H, Z1);
  // trench: floor, side walls (below the deck), the grating slab over it (solid: bullets, sight, nav), the open hatch
  // at its east end (x 238 … 239.2) with a ramp up to the deck
  solid(M.get('floor_plate'), TX0, TY - 0.3, TZ0, TX1 + 1.2, TY, TZ1);
  solid(wall, TX0 - 0.3, TY, TZ0, TX0, 0, TZ1);
  solid(wall, TX0, TY, TZ0 - 0.3, TX1 + 1.2, 0, TZ0); solid(wall, TX0, TY, TZ1, TX1 + 1.2, 0, TZ1 + 0.3);
  const grate = solid(M.get('floor_grate'), TX0, -0.06, TZ0, TX1, 0, TZ1);
  grate.name = 'arena_grating';
  // ramp (a wedge as a few steps) out of the hatch: 1.2 m long, 1.4 up, east wall of the trench
  for (let i = 0; i < 5; i++) solid(M.get('trim_steel'), TX1 + i * 0.24, TY, TZ0, TX1 + 1.2, TY + 0.28 * (i + 1), TZ1);
  // yard objects: crates (low 1.2 m) and lockers (high 2.2 m) — box, height, kind
  const objs: { x0: number; z0: number; x1: number; z1: number; h: number }[] = [
    { x0: 218, z0: -8.6, x1: 220, z1: -7.6, h: 1.2 },   // C1
    { x0: 226, z0: -12.6, x1: 228, z1: -11.6, h: 1.2 }, // C2
    { x0: 234, z0: -8.6, x1: 236, z1: -7.6, h: 1.2 },   // C3
    { x0: 221.5, z0: -17, x1: 222.3, z1: -15.6, h: 2.2 }, // L1
    { x0: 231.7, z0: -17, x1: 232.5, z1: -15.6, h: 2.2 }, // L2
    { x0: 238, z0: -15.6, x1: 240, z1: -14.6, h: 1.2 },  // C4
  ];
  for (const o of objs) solid(o.h > 1.5 ? lockerM : crateM, o.x0, 0, o.z0, o.x1, o.h, o.z1);
  // the back crate for the 'back' death against cover (radio case)
  solid(crateM, 222, 0, 8, 224, 1.2, 9);
  // the lane crate (toggled: a dynamic box + its mesh)
  const crateBox = new THREE.Box3(new THREE.Vector3(200.5, 0, 0), new THREE.Vector3(203.5, 1.0, 0.6));
  const crateMesh = solid(crateM, crateBox.min.x, 0, crateBox.min.z, crateBox.max.x, 1.0, crateBox.max.z, false);
  crateMesh.visible = false;
  const crateBody = ctx.physics.addBox(crateBox.clone(), 'metal');
  crateBody.enabled = false;
  const crate12 = crateBox.clone(); crate12.max.y = 1.2;
  const crateBody12 = ctx.physics.addBox(crate12, 'metal');
  crateBody12.enabled = false;
  // cover points in the contract's format: 0.55 m from the face along −n (n points at the threat side, +z here)
  const cv = (id: string, x: number, z: number, nx: number, nz: number, h: 'low' | 'high'): CoverPoint =>
    ({ id, position: new THREE.Vector3(x, 0, z), normal: new THREE.Vector3(nx, 0, nz), height: h, room: 'arena', set: 'yard', enabled: true });
  const cover: CoverPoint[] = [
    cv('cva_1', 219, -9.15, 0, 1, 'low'), cv('cva_2', 227, -13.15, 0, 1, 'low'), cv('cva_3', 235, -9.15, 0, 1, 'low'),
    cv('cva_4', 221.9, -17.55, 0, 1, 'high'), cv('cva_5', 232.1, -17.55, 0, 1, 'high'), cv('cva_6', 239, -16.15, 0, 1, 'low'),
    cv('cva_7', 219, -7.05, 0, -1, 'low'), cv('cva_8', 235, -7.05, 0, -1, 'low'),
    cv('cva_9', 220.95, -16.3, 1, 0, 'high'), cv('cva_10', 233.05, -16.3, -1, 0, 'high'),
  ];
  // nav grid (1 m) on the deck, off obstacles and the trench; 8-neighbour links walked at shin height
  const nodes: NavNode[] = [];
  const baseId = (level.nav ?? []).reduce((m, n) => Math.max(m, n.id), 0) + 1000;
  ctx.physics.build([...level.colliders, ...colliders]);
  level.colliders.push(...colliders);
  const idx = new Map<string, number>();
  const probe = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
  for (let x = X0 + 0.5; x < X1; x += 1) {
    for (let z = Z0 + 0.5; z < Z1; z += 1) {
      probe.set(x, 1.0, z);
      if (ctx.physics.resolveSphere(probe, 0.42)) continue;
      probe.set(x, 0.5, z);
      if (ctx.physics.resolveSphere(probe, 0.42)) continue;
      probe.set(x, 0.5, z);
      const hit = ctx.physics.raycast(probe, DOWN, 0.8);
      if (!hit || Math.abs(hit.point.y) > 0.05) continue;
      idx.set(`${x},${z}`, nodes.length);
      nodes.push({ id: baseId + nodes.length, position: new THREE.Vector3(x, 0, z), links: [], room: 'arena' });
    }
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const n of nodes) {
    for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const j = idx.get(`${n.position.x + dx},${n.position.z + dz}`);
      if (j === undefined) continue;
      const m = nodes[j];
      a.set(n.position.x, 0.35, n.position.z); b.set(m.position.x, 0.35, m.position.z);
      if (!ctx.physics.lineOfSight(a, b)) continue;
      a.y = 1.0; b.y = 1.0;
      if (!ctx.physics.lineOfSight(a, b)) continue;
      n.links.push(m.id); m.links.push(n.id);
    }
  }
  (level.nav as NavNode[]).push(...nodes);
  // a hold group for the check's re-spawn case (as level 5's g5_s1: spawn-mode, pose 'hold', pistol)
  const spawns = (ctx.level as unknown as { enemySpawns: EnemySpawn[] }).enemySpawns;
  if (Array.isArray(spawns)) spawns.push({ id: 'ga_hold_1', type: 'soldier', group: 'ga_hold', mode: 'spawn', pose: 'hold', arms: 'pistol', cover: 'yard', position: new THREE.Vector3(204, 0, -18), yaw: Math.PI });
  level.cover = [...(level.cover ?? []), ...cover];
  // regions: dark (switchable) and the exit keep-out
  const regions = level.regions as Record<string, THREE.Box3[]>;
  const keepOut = new THREE.Box3(new THREE.Vector3(238.6, -0.5, 16.4), new THREE.Vector3(241.0, 2, 17.6));
  regions.exit_keepout = [...(regions.exit_keepout ?? []), keepOut];
  const darkBoxes = (regions.dark ??= []);
  // the trench is a nav:false floor with one exit (the ramp top)
  const trenchBox = new THREE.Box3(new THREE.Vector3(TX0, TY - 0.5, TZ0), new THREE.Vector3(TX1 + 1.2, -0.1, TZ1));
  const exit: [number, number, number] = [239.6, 0, 17];
  const baseFloorAt = level.floorAt.bind(level);
  const exitV = [new THREE.Vector3(...exit)];
  level.floorAt = (p: THREE.Vector3) => {
    if (trenchBox.containsPoint(p)) return { room: 'arena_crawl', floor: 0, y: TY, nav: false, exits: exitV };
    return baseFloorAt(p);
  };
  level.navExits = true;
  // light: four bright points, no shadows (the arena is a test room, not a look)
  const lamps: { enabled: boolean }[] = [];
  for (const [x, z] of [[202, -12], [202, 8], [220, -14], [236, -14], [220, 2], [236, 2]]) {
    try { lamps.push(ctx.render.lights.add({ type: 'point', position: new THREE.Vector3(x, 3.7, z), color: 0xfff0e0, intensity: 260, distance: 24, castShadow: false, priority: 2 })); } catch { /* render optional */ }
  }
  // lights-out: one dim red emergency lamp per half (as the level's darkness), off while the lamps are on
  const emergency: { enabled: boolean }[] = [];
  for (const [x, z] of [[202, -4], [220, -12], [236, -12]]) {
    try { emergency.push(ctx.render.lights.add({ type: 'point', position: new THREE.Vector3(x, 3.2, z), color: 0xff2a14, intensity: 9, distance: 14, castShadow: false, priority: 1, enabled: false })); } catch { /* render optional */ }
  }
  let darkBox: THREE.Box3 | null = null;
  return {
    origin: [X0, 0, Z0],
    lane: { x: 202, z0: -22, z1: 22 },
    crate: {
      box: crateBox,
      on(v: boolean, h = 1.0) {
        const tall = h > 1.1;
        crateBody.enabled = v && !tall; crateBody12.enabled = v && tall;
        crateMesh.visible = v; crateMesh.scale.y = tall ? 1.2 : 1.0; crateMesh.position.y = (tall ? 1.2 : 1.0) / 2;
      },
    },
    dark(on: boolean, box?: THREE.Box3) {
      if (darkBox) { const i = darkBoxes.indexOf(darkBox); if (i >= 0) darkBoxes.splice(i, 1); darkBox = null; }
      if (on) { darkBox = box ?? new THREE.Box3(new THREE.Vector3(196, -1, -24), new THREE.Vector3(208, 4, 24)); darkBoxes.push(darkBox); }
    },
    lightsOut(on: boolean) { for (const l of lamps) l.enabled = !on; for (const l of emergency) l.enabled = on; },
    trench: { box: trenchBox, floorY: TY, exit, keepOut },
    yard: { box: new THREE.Box3(new THREE.Vector3(214, 0, -22), new THREE.Vector3(242, 3, 4)), cover: cover.map((c) => c.id), playerSpots: [[227, 0, 6], [218, 0, 8], [236, 0, 8], [227, 0, 12]] },
    backCrate: [223, 0, 7.45],
  };
}
