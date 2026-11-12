/**
 * COLD BOOT — level module: SUBLEVEL 3 of the ERIDU deep fabrication complex.
 * Everything is procedural; see docs/DESIGN.md for the authoritative layout, ids and light groups.
 */
import * as THREE from 'three';
import type { Door, GameContext, Level, NavNode, Room } from '../core/types';
import { LevelBuild, type MachineState } from './context';
import { makeDoors, type DoorImpl, type DoorSpec } from './doors';
import { buildNav } from './nav';
import { defineInstances } from './props';
import { buildMed } from './rooms/med';
import { buildCorridor } from './rooms/corridor';
import { buildQuarters } from './rooms/quarters';
import { buildPump } from './rooms/pump';
import { buildJunction } from './rooms/junction';
import { buildSecurity } from './rooms/security';
import { buildStorage } from './rooms/storage';
import { buildAirlock } from './rooms/airlock';
import { buildFab } from './rooms/fab';
import { buildGen } from './rooms/gen';
import { buildLobby } from './rooms/lobby';
import { buildElevator } from './rooms/elevator';
import { TRIGGERS, TriggerSystem } from './triggers';

const DOORS: DoorSpec[] = [
  { id: 'd_med', x: 0, z: 0, wall: 'z', kind: 'std', locked: false, labelFront: 'SERVICE CORRIDOR A', labelBack: 'MEDICAL 3-A', rooms: ['med', 'corr_a'] },
  { id: 'd_sec', x: -3, z: -17, wall: 'x', kind: 'std', locked: false, labelFront: 'SECURITY 3', labelBack: 'JUNCTION 3', rooms: ['junction', 'sec'] },
  { id: 'd_quarters', x: -1.7, z: -6.5, wall: 'x', kind: 'std', locked: false, labelFront: 'CREW QUARTERS 3', labelBack: 'SERVICE CORRIDOR A', rooms: ['corr_a', 'quarters'], ajar: 0.3 },
  { id: 'd_storage', x: 3, z: -17, wall: 'x', kind: 'std', locked: false, labelFront: 'JUNCTION 3', labelBack: 'EQUIPMENT STORAGE', rooms: ['junction', 'storage'] },
  { id: 'd_fab_outer', x: 0, z: -20, wall: 'z', kind: 'wide', locked: true, labelFront: 'FAB ACCESS LOCK', labelBack: 'JUNCTION 3', leafMat: 'painted_yellow', rooms: ['junction', 'airlock'] },
  { id: 'd_fab_inner', x: 0, z: -26, wall: 'z', kind: 'wide', locked: false, labelFront: 'FABRICATION HALL 3', labelBack: 'FAB ACCESS LOCK', leafMat: 'painted_yellow', windows: true, rooms: ['airlock', 'fab'] },
  { id: 'd_gen', x: 12, z: -38, wall: 'x', kind: 'std', locked: false, labelFront: 'FABRICATION HALL 3', labelBack: 'POWER DISTRIBUTION 3', rooms: ['fab', 'gen'] },
  { id: 'd_pump', x: -12.2, z: -38, wall: 'x', kind: 'std', locked: true, labelFront: 'COOLANT PUMP ROOM 3', labelBack: 'FABRICATION HALL 3', rooms: ['fab', 'pump'] },
  { id: 'd_lobby', x: 0, z: -50, wall: 'z', kind: 'wide', locked: true, labelFront: 'FREIGHT LOBBY', labelBack: 'FABRICATION HALL 3', leafMat: 'wall_panel_dark', rooms: ['fab', 'lobby'] },
  { id: 'd_elev', x: 0, z: -58, wall: 'z', kind: 'cage', locked: true, labelFront: 'FREIGHT ELEVATOR', labelBack: 'FREIGHT LOBBY', rooms: ['lobby', 'elevator'] },
];

const ROOM_OF: Record<string, string> = { med: 'med', corr: 'corr_a', quarters: 'quarters', pump: 'pump', junction: 'junction', sec: 'sec', storage: 'storage', airlock: 'airlock', fab: 'fab', gen: 'gen', lobby: 'lobby', elevator: 'elevator' };
/**
 * Portal graph for room visibility: [room A, room B, door id | null (always open), see-through when shut].
 * See-through: true = SEE_RANGE, or the distance (m) from the door within which the far side is drawn.
 */
const PORTALS: [string, string, string | null, boolean | number][] = [
  ['med', 'corr_a', 'd_med', false], ['corr_a', 'quarters', 'd_quarters', 11], ['fab', 'pump', 'd_pump', false], ['corr_a', 'junction', null, true], ['junction', 'sec', 'd_sec', false], ['junction', 'storage', 'd_storage', false],
  ['junction', 'airlock', 'd_fab_outer', false], ['airlock', 'fab', 'd_fab_inner', false], ['fab', 'gen', 'd_gen', false], ['fab', 'lobby', 'd_lobby', false],
  ['lobby', 'elevator', 'd_elev', true],
];
/** Rooms behind a shut see-through door are drawn only within this distance of that door. */
const SEE_RANGE = 22;
const MACHINE_LOOPS: Record<string, { id: string; pos: [number, number, number]; vol: Record<string, number> }> = {
  fab_arms: { id: 'arm_servo_loop', pos: [0, 1.5, -38], vol: { idle: 0.25, active: 0.7, frenzy: 1 } },
  fab_conveyor: { id: 'conveyor_loop', pos: [0, 5.5, -38], vol: { idle: 0.2, active: 0.7, frenzy: 1 } },
  gen_turbine: { id: 'machine_loop', pos: [19, 1.5, -38], vol: { idle: 0.25, active: 0.8, frenzy: 1 } },
};

export async function createLevel(ctx: GameContext): Promise<Level> {
  const t0 = performance.now();
  const L = new LevelBuild(ctx);
  ctx.scene.add(L.root);
  defineInstances(L);

  const timings: string[] = [];
  let tl = performance.now();
  const lap = (name: string) => { const n = performance.now(); timings.push(`${name} ${(n - tl).toFixed(0)}`); tl = n; };
  for (const [name, fn] of [['med', buildMed], ['corr', buildCorridor], ['quarters', buildQuarters], ['junction', buildJunction], ['sec', buildSecurity], ['storage', buildStorage],
    ['airlock', buildAirlock], ['fab', buildFab], ['pump', buildPump], ['gen', buildGen], ['lobby', buildLobby], ['elevator', buildElevator]] as const) {
    L.currentRoom = ROOM_OF[name];
    fn(L);
    for (const o of L.root.children) if (!o.userData.rooms || !o.userData.rooms.length) o.userData.rooms = [L.currentRoom];
    lap(name);
  }
  L.currentRoom = '';
  L.finishLightBounds();

  const doors: DoorImpl[] = makeDoors(L, DOORS);
  if (ctx.debug.noStory) for (const d of doors) d.unlock();
  for (const d of doors) L.doors.set(d.id, d);
  for (const fn of L.afterDoors) fn();
  lap('doors');
  const doorMap = new Map<string, DoorImpl>(doors.map((d) => [d.id, d]));

  const tris = L.finishBuilders();
  lap('merge');
  const colliders = L.colliderMeshes();
  const rooms: readonly Room[] = L.rooms;

  const nav: NavNode[] = buildNav(L, rooms, [...DOORS.map((d) => ({ x: d.x, z: d.z })), { x: 0, z: -13.8 }], (id) => (id === 'fab' ? 1.7 : id === 'storage' ? 0.7 : id === 'gen' ? 1.25 : id === 'quarters' ? 0.8 : 1.0));
  lap('nav');
  const triggers = new TriggerSystem(ctx, TRIGGERS);

  // fab hall is big: extra reflection probes
  const probes = L.probes.slice();
  probes.push(new THREE.Vector3(-6, 1.8, -32), new THREE.Vector3(6, 1.8, -44));

  // ── room visibility (the level is one long axis: without this every room is inside the frustum) ──
  const roomIds = rooms.map((r) => r.id);
  const roomBit = new Map(roomIds.map((id, i) => [id, 1 << i]));
  const portals = PORTALS.map(([a, b, d, see]) => ({ a: roomBit.get(a)!, b: roomBit.get(b)!, door: d ? doorMap.get(d)! : null, see: see === true ? SEE_RANGE : see || 0 }));
  const tagged: { obj: THREE.Object3D; mask: number }[] = [];
  for (const o of L.root.children) {
    let mask = 0;
    for (const r of (o.userData.rooms as string[] | undefined) ?? []) mask |= roomBit.get(r) ?? 0;
    if (mask) tagged.push({ obj: o, mask });
  }
  const castLights = L.castLights.map((c) => ({ desc: c.desc, bit: roomBit.get(c.room) ?? 0 }));
  let lastRoomBit = roomBit.get('med')!, lastMask = -1;
  L.isVisible = (id) => lastMask === -1 || (lastMask & (roomBit.get(id) ?? 0)) !== 0;
  // Published for the render module: is the room at (x, z) potentially visible? (true outside any room)
  L.root.userData.roomVisible = (x: number, z: number): boolean => {
    if (lastMask === -1) return true;
    for (let i = 0; i < rooms.length; i++) {
      const b = rooms[i].bounds;
      if (x > b.min.x + 0.05 && x < b.max.x - 0.05 && z > b.min.z + 0.05 && z < b.max.z - 0.05) return (lastMask & (1 << i)) !== 0;
    }
    return true;
  };
  const updateVisibility = () => {
    const p = ctx.camera.position;
    for (let i = 0; i < rooms.length; i++) {
      const b = rooms[i].bounds;
      if (p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z) { lastRoomBit = 1 << i; break; }
    }
    let mask = lastRoomBit;
    for (let pass = 0; pass < 4; pass++) {
      let grew = false;
      for (let i = 0; i < portals.length; i++) {
        const q = portals[i];
        const hasA = (mask & q.a) !== 0, hasB = (mask & q.b) !== 0;
        if (hasA === hasB) continue;
        let open = q.door === null || q.door.t > q.door.ajar + 1e-3;
        if (!open && q.see) {
          // shut but see-through (window slits, cage, a door left ajar): only worth drawing the far side from reasonably close
          const dx = p.x - q.door!.position.x, dz = p.z - q.door!.position.z;
          open = dx * dx + dz * dz < q.see * q.see;
        }
        if (open) { mask |= q.a | q.b; grew = true; }
      }
      if (!grew) break;
    }
    if (mask === lastMask) return;
    lastMask = mask;
    for (let i = 0; i < tagged.length; i++) tagged[i].obj.visible = (tagged[i].mask & mask) !== 0;
    // A culled room's shadow casters are not drawn, so its lights must not hold shadow maps (they stay
    // confined by their bounds instead; this also frees the shadow slots for rooms that are in view).
    for (let i = 0; i < castLights.length; i++) castLights[i].desc.castShadow = (castLights[i].bit & mask) !== 0 || castLights[i].bit === 0;
  };

  // ── positional machine loops (nothing else knows where the machines are) ──
  const loops = new Map<string, { handle: ReturnType<GameContext['audio']['loop']> | null }>();
  const machineAudio = (name: string, state: MachineState) => {
    const def = MACHINE_LOOPS[name];
    if (!def || !ctx.audio) return;
    let e = loops.get(name);
    if (!e) loops.set(name, (e = { handle: null }));
    if (state === 'off') { e.handle?.stop(0.8); e.handle = null; return; }
    const v = def.vol[state] ?? 0.5;
    if (!e.handle) e.handle = ctx.audio.loop(def.id, { position: new THREE.Vector3(...def.pos), volume: v });
    else e.handle.setVolume(v, 0.6);
  };
  const machineState = new Map<string, MachineState>();

  const fallbackDoor: Door = { id: '?', position: new THREE.Vector3(), locked: false, isOpen: false, auto: false, open() {}, close() {}, lock() {}, unlock() {} };
  const updaters = L.updaters;
  let time = 0;

  if (ctx.debug.verbose) {
    (L.root.userData as any).build = L;
    console.info(`[level] timings(ms): ${timings.join(', ')}`);
    console.info(`[level] built in ${(performance.now() - t0).toFixed(0)} ms — ${Math.round(tris)} tris, ${L.lightCount} lights, ${nav.length} nav nodes, ${L.root.children.reduce((n, g) => n + Math.max(1, g.children.length), 0)} meshes`);
  }
  (L.root.userData as any).stats = { ms: performance.now() - t0, tris: Math.round(tris), lights: L.lightCount, nav: nav.length };

  const level: Level & { settle(seconds?: number): void; setSilent(on: boolean): void } = {
    /** Checkpoint restore (story): finish every running vignette animation instantly and silently. */
    settle(seconds = 6) { L.settle(seconds); },
    /** Checkpoint restore (story): suppress the level's own positional one-shots while state is re-applied. */
    setSilent(on: boolean) { L.silent = on; },
    root: L.root,
    colliders,
    spawn: { position: new THREE.Vector3(0, 0, 7), yaw: 0 },
    rooms,
    roomAt(p) {
      for (let i = 0; i < rooms.length; i++) {
        const b = rooms[i].bounds;
        if (p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z) return rooms[i];
      }
      return null;
    },
    door(id) {
      const d = doorMap.get(id);
      if (!d) { console.warn(`[level] unknown door "${id}"`); return fallbackDoor; }
      return d;
    },
    doors,
    enemySpawns: L.enemySpawns,
    pickupSpawns: L.pickups,
    nav,
    probes,
    object: (name) => L.objects.get(name),
    setMachine(name, state: MachineState) {
      const m = L.machines.get(name);
      if (!m) { console.warn(`[level] unknown machine "${name}"`); return; }
      if (machineState.get(name) === state) return;
      machineState.set(name, state);
      m(state);
      try { machineAudio(name, state); } catch (e) { console.warn('[level] machine audio failed', e); }
    },
    screen: (name) => L.screens.get(name),
    vignette(id) { L.fireVignette(id); },
    update(dt) {
      time += dt;
      for (let i = 0; i < doors.length; i++) doors[i].update(dt, ctx);
      triggers.update();
      updateVisibility();
      L.updateTasks(dt);
      for (let i = 0; i < updaters.length; i++) updaters[i](dt, time);
    },
  };
  return level;
}
