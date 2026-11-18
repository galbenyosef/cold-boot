/**
 * LEVEL 6 — water volumes and their `rayOnly` surfaces (stage 3d §2.9, D12, D14), and the level's nav obstacles that are
 * not cargo slots (§2.6.8 the shaft's guarded well, §2.6.6 / §2.6.7 the two hatch pits, §2.6.9 S1e the dock band over the
 * wet dock and the coaming). Task W4b. W4a's `l6/index.ts` passes the result to `assembleLevel({ water })`; call it after
 * the rooms are built and BEFORE `assembleLevel` (the obstacles and the nav water must exist when the nav graph is built).
 *
 * - `Level.water`: `wat6_wet` (the wet dock: knee 0.5 m on its floor, waist 1.0 m in the sluice channel) and `wat6_well`
 *   (13.7 m, never reachable; `stand` 1.25 = the rescue fail-safe threshold, D12).
 * - Each surface is an invisible collider QUAD (two triangles) at the surface height over the volume's plan box, with
 *   `userData.rayOnly = true` and `userData.surface = 'water'` (physics puts it in the RAYS set only: rounds and sight stop
 *   at it and splash, bodies and `raycastSolid` pass it). The VISIBLE water is W6 / D3a's. The quads are appended to
 *   `LevelBuild.colliderMeshes()` (see `extraCollider`), so they reach `Level.colliders` → `physics.build` without a
 *   change to `context.ts` / `assemble.ts`.
 * - Nav: the volumes are handed to the nav builder (`setNavWater`): every node gets `wade` (water depth at it) and no node
 *   exists where `wade` > 0.6 (D13, §10.3).
 */
import * as THREE from 'three';
import type { WaterVolume } from '../../core/types';
import type { LevelBuild } from '../context';
import { setNavWater } from '../nav';

/** §2.9 water table: [id, room, x0, x1, yBottom, surface, z0, z1, stand]. */
const WATER6: readonly (readonly [string, string, number, number, number, number, number, number, number])[] = [
  ['wat6_wet', 'pool6', -66, -38, -21.4, -20.3, -194, -182.4, 1.25],
  ['wat6_well', 'pool6', -58, -46, -34, -20.3, -182, -170, 1.25],
];

/**
 * Nav obstacle boxes (world AABBs; nav.ts blocks a floor's nodes / links with those overlapping floor + 0.2 … 1.5):
 * - S1e: the dock band only (y −19.25 … −18.5: inside the dock's −19.8 … −18.5 band, clear of the wet floor's
 *   −20.6 … −19.3) over the wet dock and over the coaming footprint (the well);
 * - D32 / §2.6.8: the shaft's guarded well (x −25.8 … −24.2 between the landings, z −168.4 … −164.4), every height;
 * - 3c S1m: the two trench hatch pits (`hatch6_vault`, `hatch6_he`) at deck y 0.
 * (The six cargo slots are in dock.ts.)
 */
const OBSTACLES6: readonly (readonly [string, number, number, number, number, number, number])[] = [
  ['wet_dock_band', -66, -19.25, -194, -38, -18.5, -182.4],
  ['coaming_band', -58.4, -19.25, -182.4, -45.6, -18.5, -169.6],
  ['shaft_well', -25.8, -12, -168.4, -24.2, 3.2, -164.4],
  ['hatch6_vault_pit', -13.0, -1.4, -160.4, -11.8, 1.0, -158.0],
  ['hatch6_he_pit', 2.4, -1.4, -177.6, 3.6, 1.0, -175.4],
];

/** For check-nav / check-reach (read through `level.root.userData.navObstacles6`): the named obstacle boxes. */
export const NAV_OBSTACLES6 = OBSTACLES6.map(([id, x0, y0, z0, x1, y1, z1]) => ({ id, box: [x0, y0, z0, x1, y1, z1] as const }));

// ───────────────────────────────────────────────────────────── nav cases (scripts/check-nav.mjs, §10.3)

/**
 * §10.3 cases at real speeds: husks RUSHED (4.0 m/s, `rush: true` = `enemies.rush`), soldiers 1.6 m/s (`arrive` = success
 * within that many metres of the player: a soldier stops at range). check-nav reads them from `level.navCases` (W4a may
 * set `navCases: NAV_CASES6`) or, failing that, from `level.root.userData.navCases6` (published by `buildWater6`).
 * Corrections (W4b, the plan's bounds against the shortest path at 4.0 / 1.6 m/s): hold6 → he6 is ≈ 41 m through
 * `d6_hold` and `d6_vault` (10.3 s for a husk at best; 25.6 s for a soldier): husk 12 s, soldier 25 s with `arrive` 8;
 * hold6 → the enclosure ≈ 35 m (8.8 s): 10 s.
 * Kinds: `reach` (attack / arrive), `avoid` (an enemy chasing a player in the wet dock never stands in water deeper than
 * `maxWade` — skitters 0.1, husks 0.6 — W3c's nav costs), `ramps` (`stairAt` picks the nav stair; drift < 5 cm), `noNodes`,
 * `wetGrid` (no dock-grid node over the wet dock, S1e), `cover` spawns per set, `dockMove` (a container moved: the
 * slots stay obstacles, the cover follows, a husk routes round), `ignoreFloors` (the sealed feed set).
 */
const COVER_SPAWNS6: Record<string, readonly [number, number, number]> = {
  tunnel: [10.0, 0, -86.0], rep: [10.2, 0, -111.6], tunb: [12.0, 0, -162.0], he: [-16.0, 0, -143.0], vault: [-16.0, 0, -143.0],
  gal_n: [-72.0, -12, -144.0], gal_w: [-72.0, -12, -144.0], gal_e: [-24.0, -12, -163.4], mid: [-72.0, -12, -144.0], dock: [-72.0, -12, -144.0], uc: [-72.0, -12, -144.0],
};
const AWAY6 = [0, 0, 3] as const;
export const NAV_CASES6 = {
  reach: [
    { id: 'tun_u_cross', label: 'g6_tun_u husk (rushed) from rep6 → player at the crossing in tunnel A', type: 'husk', rush: true, spawn: [-4, 0, -90], player: [0, 0, -30], within: 17 },
    { id: 'bay_rep', label: 'g6_rep_u husk (rushed) from bay6 → player in rep6', type: 'husk', rush: true, spawn: [17, 0, -100], player: [4, 0, -86], within: 6 },
    { id: 'hold_he_husk', label: 'g6_he husk (rushed) from hold6 → player at the head-end (plan 9 s; ≈ 41 m: 12 s)', type: 'husk', rush: true, spawn: [-16, 0, -143], player: [12, 0, -170], within: 12 },
    { id: 'hold_he_soldier', label: 'g6_he soldier (1.6 m/s) from hold6 → the head-end', type: 'soldier', spawn: [-16, 0, -143], player: [12, 0, -170], within: 25, arrive: 8 },
    { id: 'hold_bj', label: 'g6_vault husk (rushed) from hold6 → the enclosure (plan 8 s; ≈ 35 m: 10 s)', type: 'husk', rush: true, spawn: [-16, 0, -143], player: [-12, 0, -177.6], within: 10 },
    { id: 'shaft_l1', label: 'husk (rushed) from the shaft bottom → L1 (three flights)', type: 'husk', rush: true, spawn: [-25.0, -12, -170.6], player: [-25.0, -3, -163.3], within: 10, via: ['stair'] },
    { id: 'w2_west_cage', label: 'W2 husk (rushed) from the west ladder exit → the cage via ST6_M', type: 'husk', rush: true, spawn: [-59.3, -20, -176.0], player: [-52, -16, -167], within: 14, via: ['stair'] },
    { id: 'w2_east_cage', label: 'W2 husk (rushed) from the east ladder exit → the cage via ST6_M2', type: 'husk', rush: true, spawn: [-44.7, -20, -176.0], player: [-52, -16, -167], within: 14, via: ['stair'] },
    { id: 'w3_ge2', label: 'W3 soldier from the shaft bottom → cv6_ge2 on the east gallery', type: 'soldier', spawn: [-24.0, -12, -163.4], player: [-30.65, -12, -186.0], within: 15, arrive: 6 },
    { id: 'w1_gn1', label: 'W1 soldier from stores6 → cv6_gn1 on the north gallery', type: 'soldier', spawn: [-72.0, -12, -144.0], player: [-62.0, -12, -150.65], within: 8, arrive: 6 },
    { id: 'wet_ramp_husk', label: 'husk (rushed) from the dry dock → player on the wet dock floor (ramps, not the channel)', type: 'husk', rush: true, spawn: [-64.0, -20, -178.0], player: [-52.0, -20.8, -188.0], within: 12, maxWade: 0.6 },
  ],
  avoid: [
    { id: 'wet_skitter', label: 'skitter chasing a player on the wet dock floor never enters water deeper than 0.1 m', type: 'skitter', spawn: [-64.0, -20, -178.0], player: [-52.0, -20.8, -188.0], within: 8, maxWade: 0.1 },
    { id: 'wet_husk_channel', label: 'husk (rushed) chasing a wader at the channel edge never ends in the channel (> 0.6 m)', type: 'husk', rush: true, spawn: [-40.0, -20, -178.0], player: [-50.0, -20.8, -186.0], within: 8, maxWade: 0.6 },
  ],
  ramps: [
    { id: 'wet_ramp_w', stairAt: [-64.2, -20.4, -188.0], standAt: [-64.2, -20.4, -188.0], top: [-66.9, -20, -188.0], bottom: [-61.5, -20.8, -188.0], trips: 2, away: AWAY6, noHoldCase: false },
    { id: 'st6_m', stairAt: [-71.0, -18.0, -168.8], standAt: [-71.0, -18.0, -168.8], top: [-71.0, -16, -165.1], bottom: [-71.0, -20, -172.5], trips: 2, away: AWAY6 },
    { id: 'shaft_f2', stairAt: [-23.2, -4.5, -166.4], standAt: [-23.2, -4.5, -166.4], top: [-23.2, -3, -163.5], bottom: [-23.2, -6, -169.3], trips: 2, away: AWAY6 },
  ],
  noNodes: [
    { id: 'coaming + well', box: [-58.4, -21.0, -182.4, -45.6, -18.0, -169.6] },
    { id: 'shaft well guard', box: [-25.8, -12.5, -168.4, -24.2, 3.2, -164.4] },
    { id: 'hatch6_vault pit', box: [-13.0, -2.0, -160.4, -11.8, 1.5, -158.0] },
    { id: 'hatch6_he pit', box: [2.4, -2.0, -177.6, 3.6, 1.5, -175.4] },
    { id: 'trench', box: [-13.0, -1.6, -179.4, 3.6, -0.3, -158.0] },
    ...[['sl6_1', -74, -68, -182.0, -179.6, -20], ['sl6_2', -74, -68, -176.4, -174.0, -20], ['sl6_3', -36, -30, -182.0, -179.6, -20],
      ['sl6_4', -36, -30, -176.4, -174.0, -20], ['sl6_5', -60, -54, -192.0, -189.6, -20.8], ['sl6_6', -50, -44, -192.0, -189.6, -20.8]]
      .map(([id, x0, x1, z0, z1, y]) => ({ id: `slot ${id}`, box: [x0 as number, (y as number) - 0.3, z0 as number, x1 as number, (y as number) + 1.5, z1 as number] })),
  ],
  /** S1e: no node of the DOCK grid (y −20, not a stair) over the wet dock's plan box. */
  wetGrid: { y: -20, box: [-66, -194, -38, -182.4] },
  /** S6a: move a container, re-check the slots, the cover and a husk route; then move it back. */
  dockMove: { from: 'sl6_1', to: 'sl6_2', reach: { id: 'slots_moved', label: 'after B-09 moved sl6_1 → sl6_2: husk (rushed) routes round the slots', type: 'husk', rush: true, spawn: [-71.0, -20, -184.6], player: [-71.0, -20, -178.0], within: 6 } },
  coverSpawns: COVER_SPAWNS6,
  ignoreFloors: ['feed6:main'],
};

/** An invisible horizontal collider quad (world coordinates baked into the vertices; identity transform). */
function waterQuad(id: string, x0: number, x1: number, y: number, z0: number, z1: number): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    x0, y, z0, x0, y, z1, x1, y, z1,
    x0, y, z0, x1, y, z1, x1, y, z0,
  ], 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo);
  mesh.name = `collider:water:${id}`;
  mesh.userData.surface = 'water';
  mesh.userData.rayOnly = true;
  mesh.visible = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrixWorld(true);
  return mesh;
}

/**
 * Append a collider mesh to what `L.colliderMeshes()` returns (once per LevelBuild the method is wrapped; further meshes
 * join the same list). W4b workaround until `LevelBuild` has its own flagged-collider list (see the W4b report): it keeps
 * `context.ts` / `assemble.ts` untouched.
 */
export function extraCollider(L: LevelBuild, mesh: THREE.Mesh): void {
  const host = L as LevelBuild & { __extraColliders6?: THREE.Mesh[] };
  if (!host.__extraColliders6) {
    const list: THREE.Mesh[] = (host.__extraColliders6 = []);
    const base = L.colliderMeshes.bind(L);
    L.colliderMeshes = () => [...base(), ...list];
  }
  host.__extraColliders6.push(mesh);
}

export function buildWater6(L: LevelBuild): WaterVolume[] {
  const out: WaterVolume[] = [];
  for (const [id, room, x0, x1, y0, surface, z0, z1, stand] of WATER6) {
    out.push({ id, room, box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, surface, z1)), surface, stand });
    extraCollider(L, waterQuad(id, x0, x1, surface, z0, z1));
  }
  for (const [, x0, y0, z0, x1, y1, z1] of OBSTACLES6) L.obstacles.push(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));
  setNavWater(L, out);
  L.root.userData.navObstacles6 = NAV_OBSTACLES6;
  L.root.userData.navCases6 = NAV_CASES6;
  return out;
}
