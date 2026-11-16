/**
 * DEV ONLY — two-deck test greybox (stage 3a §8.9, task K3). Loaded by `?greybox=deck2` (see `level/index.ts`),
 * never part of the level list. Use with `&nostory=1&noenemies=1` (the level-1 story would look for its doors).
 *
 *   Deck 1 (y 0):   gb_atr  TEST ATRIUM  x −6…6, z −30…−10, h 9 (garden floor) ── dg_low (0, 0, −30) ── gb_south
 *   Deck 2 (y 4.8): gallery strip x −6…6, z −12…−10 and east balcony x 3…6, z −30…−12 (floors inside gb_atr),
 *                   glass balustrade 1.1 m at x = 3 and z = −12 (not containment: crossing it drops to the garden);
 *                   ramp x −6…−3 from (z −21.03, y 0) up to (z −12, y 4.8), 28°;
 *                   dg_up (0, 4.8, −10) ── gb_up TEST UPPER x −6…6, z −10…0 ── dg_cab (cage, 0, 4.8, 0) ── gb_cab
 *                   (level 2's cage cab, `buildCab({ y0: 4.8 })`); solid structure under gb_up and the cage pit.
 *   Off to the side: level 2's service lift `buildLift(L, { y0: 4.8 })` (room `lift`, unreachable; built for its
 *   self-test only).
 *
 * `scripts/check-reach.mjs --greybox` runs the phases below (one is EXPECTED to fail: a forbidden Deck-2 region
 * that is reachable) and `level.selfTest()` (doors, triggers, rooms, regions, pit assertion, cab / lift floors).
 *
 * Nav v2 (§8.10, K4; `scripts/check-nav.mjs`, cases in NAV_CASES_GB): the ramp is a declared `navStair`; a 1.2 m gap
 * in the balcony balustrade at its south end (z −29.6 … −28.4) is a declared one-way `navDrop` into the garden; an
 * "island" deck (x −6…−4, z −30…−26, y 2.4, walled, on a solid block) is a floor nothing links — the deliberate
 * failing case (check-nav must report it unlinked and a husk on it must not reach the player).
 */
import * as THREE from 'three';
import type { GameContext, Level } from '../../core/types';
import { LevelBuild, roomFloor } from '../context';
import { pitProblems, type DoorImpl, type DoorSpec } from '../doors';
import { defineInstances } from '../props';
import { assembleLevel, buildRooms, type PortalSpec } from '../assemble';
import { TriggerSystem, type TriggerSpec } from '../triggers';
import { buildCab } from '../rooms/elevator';
import { buildLift } from '../l2/core';
import { installPhaseTable, type Phase, type PhaseCheck } from '../phases';

const D2 = 4.8; // Deck-2 floor
const PI = Math.PI;
/** Balustrade gap of the declared drop (balcony south end, x = 3). */
const DROP_Z0 = -29.6, DROP_Z1 = -28.4;
/** The deliberately unlinked island deck (check-nav's failing case): plan box + floor. */
const ISLAND = [-6, -4, -30, -26] as const;
const ISLAND_Y = 2.4;

/**
 * §8.10 test cases for `scripts/check-nav.mjs` (real husks, real physics, simulated in page). `spawn` = husk feet,
 * `player` = where the player stands, `within` = time bound (s), `via` = what the route must include, `expect:
 * 'fail'` = a deliberate failure the check must report.
 */
export const NAV_CASES_GB = {
  reach: [
    { id: 'balcony_to_pool', label: 'husk on the balcony (north) → player at the pool, down the ramp', spawn: [4.5, D2, -14], player: [0, 0, -24], within: 25, via: ['stair'] },
    { id: 'balcony_drop', label: 'husk on the balcony (south) → player in the garden, takes the declared drop', spawn: [4.5, D2, -27.5], player: [-1, 0, -27], within: 20, via: ['drop'] },
    { id: 'garden_to_balcony', label: 'husk in the garden → player on the balcony (up the ramp; drops are one-way)', spawn: [-1.5, 0, -26], player: [4.5, D2, -22], within: 35, via: ['stair'] },
    { id: 'under_player', label: 'husk under the gallery strip → player right above it on Deck 2', spawn: [1.5, 0, -13.5], player: [1.5, D2, -11], within: 25, via: ['stair'] },
    { id: 'south_to_upper', label: 'husk in TEST SOUTH (Deck 1) → player in TEST UPPER (Deck 2), two doors', spawn: [0, 0, -34], player: [0, D2, -5], within: 40, via: ['stair'] },
    { id: 'upper_to_garden', label: 'husk in TEST UPPER (Deck 2) → player in the garden', spawn: [-3, D2, -4], player: [1, 0, -22], within: 35, via: ['stair'] },
    { id: 'ramp_to_south', label: 'husk half-way up the ramp → player in TEST SOUTH', spawn: [-4.5, 2.4, -16.5], player: [0, 0, -34], within: 25 },
    { id: 'island', label: 'EXPECTED FAIL: husk on the unlinked island deck → player in the garden', spawn: [-5, ISLAND_Y, -28], player: [1, 0, -20], within: 15, expect: 'fail' },
  ],
  /** Player out of reach (dg_up locked): the husk stands off without drifting, then comes once the door opens. */
  standOff: { id: 'standoff', label: 'dg_up locked, player in TEST UPPER: husk stands off, comes when it opens', door: 'dg_up', spawn: [0, 0, -24], player: [0, D2, -5], hold: 30, within: 25 },
  /**
   * A sentry low in the garden finds the player on the balcony (it hovers at the player's height + 1.9 under the
   * ceiling and flies; it seeks line of sight along nav when it has none, then fires). Sentries do not pass doors
   * (their hover height is above a 2.4 m opening, as on levels 1–2); level 3's sentry stays in the atrium.
   */
  sentry: { id: 'sentry', label: 'sentry low in the garden → player on the balcony behind the glass: rises, sees, fires', spawn: [-2, 2.2, -27], player: [4.5, D2, -14], within: 25 },
  /** Ramp tests: idle drift (husk, player) and 5 walks up and down. Island floor: must be reported unlinked. */
  ramp: { stair: 0, standAt: [-4.5, 2.4, -16.5], top: [-4.5, D2, -10.6], bottom: [-4.5, 0, -23], trips: 5 },
  unlinkedFloors: ['gb_atr:2'],
  /** Built for the K3 self-test only (level 2's service lift, off to the side): not part of the walkable layout. */
  ignoreFloors: ['lift:main'],
};

const DOORS: DoorSpec[] = [
  { id: 'dg_low', x: 0, z: -30, wall: 'z', kind: 'std', locked: false, labelFront: 'TEST SOUTH', labelBack: 'TEST ATRIUM', rooms: ['gb_south', 'gb_atr'] },
  { id: 'dg_up', x: 0, y: D2, z: -10, wall: 'z', kind: 'std', locked: false, labelFront: 'TEST UPPER', labelBack: 'TEST ATRIUM', rooms: ['gb_atr', 'gb_up'] },
  { id: 'dg_cab', x: 0, y: D2, z: 0, wall: 'z', kind: 'cage', locked: false, labelFront: 'TEST UPPER', labelBack: 'TEST CAB', rooms: ['gb_up', 'gb_cab'] },
];
const ZONES: Record<string, { name: string; rooms: string[] }> = {
  dg_low: { name: 'frames_gb_low', rooms: ['gb_atr', 'gb_south'] },
  dg_up: { name: 'frames_gb_up', rooms: ['gb_atr', 'gb_up'] },
  dg_cab: { name: 'frames_gb_cab', rooms: ['gb_up', 'gb_cab'] },
};
const PORTALS: PortalSpec[] = [['gb_atr', 'gb_south', 'dg_low', false], ['gb_atr', 'gb_up', 'dg_up', false], ['gb_up', 'gb_cab', 'dg_cab', true]];

/** One trigger per deck (+ the balcony): Deck-2 ones carry their y range, Deck-1 ones use the default (−1 … 4). */
export const TRIGGERS_GB: TriggerSpec[] = [
  { id: 'tg_low', x0: -6, x1: 3, z0: -30, z1: -10 },
  { id: 'tg_south', x0: -3, x1: 3, z0: -36, z1: -30.25 },
  { id: 'tg_up', x0: -6, x1: 6, z0: -9.75, z1: 0, y0: 4, y1: 7 },
  { id: 'tg_bal', x0: 3, x1: 6, z0: -30, z1: -12, y0: 4, y1: 7 },
];

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
const REGIONS = (): Record<string, THREE.Box3[]> => ({
  balcony: [box(3, D2 - 0.5, -30, 6, D2 + 3.2, -12), box(-6, D2 - 0.5, -12, 6, D2 + 3.2, -10)],
  garden: [box(-6, -0.5, -30, 6, 2.5, -10)],
  outside: [box(-40, -10, -60, -6.25, 40, 30), box(6.25, -10, -60, 40, 40, 30), box(-40, -10, -60, 40, 40, -36.25), box(-40, -10, 6.2, 40, 40, 30)],
});

type CheckGB = PhaseCheck & { expect?: 'fail'; stressFloors?: number[] };
const P = (id: string, label: string, doors: Phase['doors'], check: CheckGB) => ({ id, label, doors, check }) as unknown as Phase;
export const PHASES_GB: Phase[] = [
  P('GB_open', 'every door auto: both decks reachable, ramp, balcony, cab', { dg_low: 'auto', dg_up: 'auto', dg_cab: 'auto' },
    { start: [0, 0, -20], forbid: ['outside'], goal: ['gb_atr', 'garden', 'balcony', 'gb_up', 'gb_cab', 'gb_south'], use: ['gb_switch_up', 'gb_switch_low'], stressFloors: [0, D2] }),
  P('GB_sealed', 'Deck-2 room sealed by its locked door: the balcony is reachable, the room behind it is not', { dg_low: 'locked', dg_up: 'locked', dg_cab: 'locked' },
    { start: [0, 0, -20], forbid: ['outside', 'gb_up', 'gb_cab', 'gb_south'], goal: ['garden', 'balcony'] }),
  P('GB_up', 'start on Deck 2: the atrium below is sealed off', { dg_low: 'locked', dg_up: 'locked', dg_cab: 'auto' },
    { start: [0, D2, -5], forbid: ['outside', 'gb_atr', 'garden', 'balcony', 'gb_south'], goal: ['gb_up', 'gb_cab'], use: ['gb_switch_up'], stressFloors: [D2] }),
  // the deliberate failing case: dg_up is open, so the forbidden Deck-2 room IS reachable — the check must say FAIL
  P('GB_fail', 'EXPECTED FAIL: forbidden Deck-2 room behind an open door', { dg_low: 'auto', dg_up: 'auto', dg_cab: 'auto' },
    { start: [0, 0, -20], forbid: ['gb_up'], goal: ['garden'], expect: 'fail' }),
];

// ───────────────────────────────────────────────────────────── geometry

function solid(L: LevelBuild, name: string, mat: Parameters<ReturnType<LevelBuild['builder']>['bx']>[0], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const b = L.namedBuilder(name);
  b.bx(mat, x0, y0, z0, x1, y1, z1);
  b.collide(x0, y0, z0, x1, y1, z1, 'metal', true);
}

function buildAtrium(L: LevelBuild) {
  const H = 9;
  L.room('gb_atr', 'TEST ATRIUM', -6, 6, -30, -10, H, {
    floors: [{ y: D2, box: [3, 6, -30, -12] }, { y: D2, box: [-6, 6, -12, -10] }, { y: ISLAND_Y, box: [...ISLAND] }],
  });
  const n = 'gb_atr_static';
  solid(L, n, 'floor_concrete', -6, -0.3, -30, 6, 0, -10);
  solid(L, n, 'wall_panel', -6.3, -0.3, -30.3, -6, H, -9.8); // west
  solid(L, n, 'wall_panel', 6, -0.3, -30.3, 6.3, H, -9.8); // east
  // south wall with dg_low (1.6 × 2.4)
  solid(L, n, 'wall_panel', -6, -0.3, -30.2, -0.8, H, -29.8);
  solid(L, n, 'wall_panel', 0.8, -0.3, -30.2, 6, H, -29.8);
  solid(L, n, 'wall_panel', -0.8, 2.4, -30.2, 0.8, H, -29.8);
  solid(L, n, 'ceiling_panel', -6.3, H, -30.3, 6.3, H + 0.3, -9.8);
  // north: Deck-2 structure below the gallery (z −10 face), the wall above it with dg_up
  solid(L, n, 'painted_dark', -6, -0.3, -10, 6, D2 - 0.3, 0); // solid structure under gb_up
  solid(L, n, 'wall_panel', -6, D2, -10.2, -0.8, H, -9.8);
  solid(L, n, 'wall_panel', 0.8, D2, -10.2, 6, H, -9.8);
  solid(L, n, 'wall_panel', -0.8, D2 + 2.4, -10.2, 0.8, H, -9.8);
  // Deck-2 slabs: gallery strip + east balcony (soffit 4.5, top 4.8)
  solid(L, n, 'floor_plate', -6, D2 - 0.3, -12, 6, D2, -10.2);
  solid(L, n, 'floor_plate', 3, D2 - 0.3, -30, 6, D2, -12);
  // glass balustrade 1.1 m (collider the same height: NOT containment) along the balcony and the strip; a 1.2 m
  // gap at the balcony's south end (z −29.6 … −28.4) is a declared one-way drop for enemies (§8.10, K4)
  const g = L.namedBuilder(n);
  for (const [z0, z1] of [[-30, DROP_Z0], [DROP_Z1, -12]] as const) {
    g.bx('glass', 2.97, D2, z0, 3.03, D2 + 1.1, z1).collide(2.97, D2, z0, 3.03, D2 + 1.1, z1, 'glass', true);
    g.bx('trim_steel', 2.94, D2 + 1.1, z0, 3.06, D2 + 1.14, z1);
  }
  g.bx('glass', -3, D2, -12.03, 2.97, D2 + 1.1, -11.97).collide(-3, D2, -12.03, 2.97, D2 + 1.1, -11.97, 'glass', true);
  for (const z of [-29.9, DROP_Z0 + 0.06, DROP_Z1 - 0.06, -21, -12.1]) g.bx('trim_steel', 2.94, D2 + 1.1, z - 0.05, 3.06, D2 + 1.16, z + 0.05);
  L.navDrop([3.45, D2, (DROP_Z0 + DROP_Z1) / 2], [2.0, 0, (DROP_Z0 + DROP_Z1) / 2]);
  // ramp x −6…−3: (z −21.03, y 0) → (z −12, y 4.8); 28°, visual slab = collider (open on its east side)
  const run = D2 / Math.tan((28 * PI) / 180), len = Math.hypot(D2, run), a = Math.atan2(D2, run);
  g.push(-4.5, D2 / 2, -12 - run / 2, 0, -a);
  g.bx('painted_yellow', -1.5, -0.2, -len / 2, 1.5, 0, len / 2).collide(-1.5, -0.2, -len / 2, 1.5, 0, len / 2, 'metal', false);
  g.pop();
  L.navStair('gb_atr', [-4.5, 0, -12 - run], [-4.5, D2, -12], 3);
  // the island deck (DELIBERATE nav failure): a solid 2.4 m block in the south-west corner with a 1.2 m wall round its
  // open sides — a declared floor that no stair, ramp, door or drop links (check-nav must report it and fail on it)
  const [ix0, ix1, iz0, iz1] = ISLAND;
  solid(L, n, 'painted_dark', ix0, -0.3, iz0, ix1, ISLAND_Y, iz1);
  solid(L, n, 'wall_panel', ix1 - 0.1, ISLAND_Y, iz0, ix1, ISLAND_Y + 1.2, iz1);
  solid(L, n, 'wall_panel', ix0, ISLAND_Y, iz1 - 0.1, ix1 - 0.1, ISLAND_Y + 1.2, iz1);
  L.point('gb', 0, 7.5, -20, 0xfff0d8, 30, 18);
  L.point('gb', 4.5, D2 + 2.6, -20, 0xd8e8ff, 8, 8);
}

function buildUpper(L: LevelBuild) {
  const H = 3.2, top = D2 + H;
  L.room('gb_up', 'TEST UPPER', -6, 6, -10, 0, H, { y0: D2 });
  const n = 'gb_up_static';
  solid(L, n, 'floor_plate', -6, D2 - 0.3, -9.8, 6, D2, 0);
  solid(L, n, 'wall_panel', -6.3, D2, -10.2, -6, top, 0.4);
  solid(L, n, 'wall_panel', 6, D2, -10.2, 6.3, top, 0.4);
  solid(L, n, 'ceiling_panel', -6.3, top, -10.2, 6.3, top + 0.3, 0.4);
  // north wall with the cage gate (3.0 × 2.8)
  solid(L, n, 'wall_panel', -6, D2, -0.4, -1.5, top, 0);
  solid(L, n, 'wall_panel', 1.5, D2, -0.4, 6, top, 0);
  solid(L, n, 'wall_panel', -1.5, D2 + 2.8, -0.4, 1.5, top, 0);
  // the cage's pit on the cab side (under the cab floor plate, 0.18 thick)
  solid(L, n, 'painted_dark', -2.5, 0, 0, 2.5, D2 - 0.18, 0.6);
  L.interact('gb_switch_up', 'button', 'Test switch (Deck 2)', 4, D2 + 1.2, -5);
  L.namedBuilder(n).box('emissive_red', 4, D2 + 1.2, -5, 0.2, 0.2, 0.05);
  L.point('gb', 0, top - 0.3, -5, 0xfff0d8, 10, 9);
}

function buildSouth(L: LevelBuild) {
  const H = 3;
  L.room('gb_south', 'TEST SOUTH', -3, 3, -36, -30, H);
  const n = 'gb_south_static';
  solid(L, n, 'floor_rubber', -3, -0.3, -36, 3, 0, -30.2);
  solid(L, n, 'wall_panel', -3.3, -0.3, -36.3, -3, H, -30.2);
  solid(L, n, 'wall_panel', 3, -0.3, -36.3, 3.3, H, -30.2);
  solid(L, n, 'wall_panel', -3.3, -0.3, -36.3, 3.3, H, -36);
  solid(L, n, 'ceiling_panel', -3.3, H, -36.3, 3.3, H + 0.3, -30.2);
  L.interact('gb_switch_low', 'button', 'Test switch (Deck 1)', 0, 1.2, -34);
  L.namedBuilder(n).box('emissive_red', 0, 1.2, -35.95, 0.2, 0.2, 0.05);
  L.point('gb', 0, H - 0.3, -33, 0xfff0d8, 8, 8);
}

// ───────────────────────────────────────────────────────────── level

export async function createGreyboxDeck2(ctx: GameContext): Promise<Level> {
  const L = new LevelBuild(ctx);
  ctx.scene.add(L.root);
  defineInstances(L);
  buildRooms(L, [
    ['gb_atr', buildAtrium], ['gb_up', buildUpper], ['gb_south', buildSouth],
    ['gb_cab', (l) => buildCab(l, {
      room: { id: 'gb_cab', name: 'TEST CAB', x0: -2.5, x1: 2.5, z0: 0, z1: 5 }, group: 'gb_cab', doorId: 'dg_cab', screen: 'gb_cab_panel',
      machine: 'gb_cab', mode: 'arrive', lit: true, extras: false, place: { gateZ: 0, ry: PI }, panelText: 'DECK 2', y0: D2,
    })],
    ['lift', (l) => buildLift(l, { y0: D2 })],
  ]);
  const level = assembleLevel(ctx, L, {
    doors: DOORS,
    frameZone: (s) => ZONES[s.id],
    portals: PORTALS,
    triggers: TRIGGERS_GB,
    navStep: () => 1.2,
    navStart: { x: 0, y: 0, z: -20 },
    spawn: { position: new THREE.Vector3(0, 0, -20), yaw: 0 },
    startRoom: 'gb_atr',
    regions: REGIONS(),
  });
  installPhaseTable(ctx, level, PHASES_GB);
  (level as unknown as { selfTest: () => { ok: boolean; lines: string[] } }).selfTest = () => selfTest(ctx, L, level);
  (level as unknown as { navCases: typeof NAV_CASES_GB }).navCases = NAV_CASES_GB;
  return level;
}

// ───────────────────────────────────────────────────────────── self-test (in page; check-reach --greybox)

function selfTest(ctx: GameContext, L: LevelBuild, level: Level): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const t = (name: string, pass: boolean, detail = '') => { if (!pass) ok = false; lines.push(`${pass ? ' ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
  const near = (a: number, b: number, e = 0.02) => Math.abs(a - b) <= e;
  const f = (v: number) => v.toFixed(3);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const wbox = (o: THREE.Object3D) => { o.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(o); };

  // rooms: bounds floor − 0.5 … floor + h, probe at floor + 1.6
  const room = (id: string) => level.rooms.find((r) => r.id === id)!;
  for (const [id, y0, h] of [['gb_atr', 0, 9], ['gb_up', D2, 3.2], ['gb_cab', D2, 3.2], ['lift', D2, 3.0], ['gb_south', 0, 3]] as const) {
    const r = room(id);
    t(`room ${id} bounds y ${y0 - 0.5} … ${y0 + h}, floor ${y0}`, !!r && near(r.bounds.min.y, y0 - 0.5, 1e-6) && near(r.bounds.max.y, y0 + h, 1e-6) && roomFloor(r) === y0,
      r ? `${f(r.bounds.min.y)} … ${f(r.bounds.max.y)}, floor ${roomFloor(r)}` : 'missing');
    const c = r.bounds.getCenter(V(0, 0, 0));
    t(`probe of ${id} at y ${y0 + 1.6}`, level.probes.some((p) => near(p.x, c.x, 1e-6) && near(p.z, c.z, 1e-6) && near(p.y, y0 + 1.6, 1e-6)));
  }
  t('roomAt Deck-2 point → gb_up', level.roomAt(V(0, D2, -5))?.id === 'gb_up');
  t('regions: gb_up contains its floor + 0.9, not the Deck-1 height below', level.regions.gb_up.some((b) => b.containsPoint(V(0, D2 + 0.9, -5))) && !level.regions.gb_up.some((b) => b.containsPoint(V(0, 0.9, -5))));

  // doors at a floor y
  const door = (id: string) => L.doors.get(id)! as DoorImpl;
  const boxesOf = (d: DoorImpl) => (d as unknown as { boxes: { box: THREE.Box3; enabled: boolean }[] }).boxes;
  for (const [id, y] of [['dg_low', 0], ['dg_up', D2], ['dg_cab', D2]] as const) {
    const d = door(id);
    d.unlock(); d.auto = true; d.close(); d.snap();
    t(`${id}: floor ${y}, position.y ${y}`, d.floor === y && d.position.y === y, `floor ${d.floor}, y ${d.position.y}`);
    const kind = DOORS.find((s) => s.id === id)!.kind;
    const bx = boxesOf(d), b0 = bx[0].box, hgt = kind === 'std' ? 2.4 : 2.8;
    if (kind === 'std') t(`${id}: closed leaf blocker y ${y} … ${y + hgt}`, bx[0].enabled && near(b0.min.y, y, 1e-6) && near(b0.max.y, y + hgt, 1e-6), `${f(b0.min.y)} … ${f(b0.max.y)}`);
    else { const b1 = bx[1].box; t(`${id}: closed lower blocker y ${y - 0.5} … ${y + 1.55}`, bx[1].enabled && near(b1.min.y, y - 0.5, 1e-6) && near(b1.max.y, y + 1.55, 1e-6), `${f(b1.min.y)} … ${f(b1.max.y)}`); }
    const pr = ctx.interactables.all.find((i) => i.id === `door_${id}`);
    t(`${id}: prompt at y ${y + 1.3}`, !!pr && near(pr.position.y, y + 1.3, 1e-6), pr ? f(pr.position.y) : 'missing');
    const st = L.objects.get(id)?.getObjectByName(`${id}:status`);
    const sb = st ? wbox(st) : null;
    t(`${id}: status screens at y ${y + 1.43}`, !!sb && near((sb.min.y + sb.max.y) / 2, y + 1.43), sb ? f((sb.min.y + sb.max.y) / 2) : 'missing');
    const fr = L.root.children.find((o) => o.name === ZONES[id].name);
    const fb = fr ? wbox(fr) : null;
    t(`${id}: frame from the floor (threshold y ${y - 0.05}) to the lintel (y ${y + hgt + 0.32})`, !!fb && near(fb.min.y, y - 0.05) && near(fb.max.y, y + hgt + 0.32), fb ? `${f(fb.min.y)} … ${f(fb.max.y)}` : 'missing');
    const lb = wbox(d.leaf(0));
    t(`${id}: leaf 0 stands on the floor`, near(lb.min.y, kind === 'std' ? y + 0.01 : y + 1.25, 0.03), `min y ${f(lb.min.y)}`);
  }

  // enemy auto-open near test, bounded in height both ways (|dy| < 2 from the door's floor)
  const autoOpen = (id: string, p: THREE.Vector3) => {
    const d = door(id);
    d.unlock(); d.auto = true; d.close(); d.snap();
    const fake = { player: null, enemies: { all: [{ alive: true, state: 'chase', position: p }] } } as unknown as GameContext;
    d.update(1 / 60, fake);
    const opened = d.isOpen;
    d.close(); d.snap();
    return opened;
  };
  t('a husk on Deck 1 under dg_up (0.5, 0, −11) does NOT open it', !autoOpen('dg_up', V(0.5, 0, -11)));
  t('a husk on the Deck-2 gallery (0.5, 4.8, −11) opens dg_up', autoOpen('dg_up', V(0.5, D2, -11)));
  t('a husk on Deck 2 above dg_low (0.5, 4.8, −29) does NOT open it', !autoOpen('dg_low', V(0.5, D2, -29)));
  t('a husk on Deck 1 at dg_low (0.5, 0, −29) opens it', autoOpen('dg_low', V(0.5, 0, -29)));
  t('a husk 1.9 m below dg_up\'s floor still counts (|dy| < 2)', autoOpen('dg_up', V(0.5, D2 - 1.9, -11)));

  // triggers with a y range (feet)
  const events: string[] = [];
  const pos = V(0, 0, 0);
  const fctx = { player: { position: pos }, events: { emit: (n: string, e: { id: string }) => events.push(`${n === 'trigger:enter' ? '+' : '-'}${e.id}`) } } as unknown as GameContext;
  const ts = new TriggerSystem(fctx, TRIGGERS_GB);
  const step = (x: number, y: number, z: number) => { events.length = 0; pos.set(x, y, z); ts.update(); return events.slice().sort().join(' '); };
  const cases: [number, number, number, string][] = [
    [0, D2, -5, '+tg_up'], [0, 0, -5, '-tg_up'], [0, 0, -20, '+tg_low'], [0, D2, -20, '-tg_low'],
    [4.5, D2, -20, '+tg_bal'], [2.5, 0, -20, '+tg_low -tg_bal'], [4.5, 0, -20, '-tg_low'], [2.5, 0, -20, '+tg_low'], [0, 0.5, -33, '-tg_low +tg_south'],
  ];
  for (const [x, y, z, want] of cases) { const got = step(x, y, z); t(`trigger events at (${x}, ${y}, ${z}): ${want}`, got === want.split(' ').sort().join(' '), `got "${got}"`); }

  // sinking-leaf pit assertion: passes for the cage gate on its pit, fails over the open garden
  const cabPit = pitProblems(L, DOORS[2], D2);
  t('pit assertion: dg_cab has a solid pit', cabPit.length === 0, cabPit.slice(0, 3).join('; '));
  const voidPit = pitProblems(L, { id: 'void', x: 0, z: -20, wall: 'z' }, D2);
  t('pit assertion CAN FAIL: a wide door over the open garden is reported', voidPit.length > 0, `${voidPit.length} problems`);

  // cab / lift built on Deck 2
  const down = V(0, -1, 0);
  const hc = ctx.physics.raycast(V(0, D2 + 1.7, 2.5), down, 3);
  t('cab floor collider at y 4.8', !!hc && near(hc.point.y, D2), hc ? f(hc.point.y) : 'no hit');
  const cab = L.objects.get('elevator_cab');
  const cb = cab ? wbox(cab) : null;
  t('cab body starts at its floor', !!cb && near(cb.min.y, D2, 0.05), cb ? f(cb.min.y) : 'missing');
  const hl = ctx.physics.raycast(V(0, D2 + 1.7, -90.5), down, 3);
  t('lift (buildLift y0 4.8) floor collider at y 4.8', !!hl && near(hl.point.y, D2), hl ? f(hl.point.y) : 'no hit');
  const lb = ctx.interactables.all.find((i) => i.id === 'lift_button');
  t('lift button at y 4.8 + 1.15', !!lb && near(lb.position.y, D2 + 1.15, 1e-6), lb ? f(lb.position.y) : 'missing');

  // put the doors back as the phase table had them
  for (const d of L.doors.values()) { d.unlock(); d.auto = true; d.close(); d.snap(); }
  return { ok, lines };
}
