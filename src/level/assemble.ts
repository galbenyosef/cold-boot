/**
 * Level-agnostic assembly: once a level's rooms are built into a LevelBuild, this wires up doors, nav,
 * triggers, portal-based room visibility, positional machine loops and returns the `Level` object.
 * Level 1 (`index.ts`) and level 2 (`l2/index.ts`) only differ in the data they pass in.
 */
import * as THREE from 'three';
import type { Door, GameContext, Level, NavNode, Room } from '../core/types';
import type { LevelBuild, MachineState } from './context';
import { makeDoors, type DoorImpl, type DoorSpec } from './doors';
import { buildNav } from './nav';
import { TriggerSystem, type TriggerSpec } from './triggers';

/** [room A, room B, door id | null (always open), see-through when shut: true = SEE_RANGE | metres from the door]. */
export type PortalSpec = [string, string, string | null, boolean | number];

export interface MachineLoop { id: string; pos: [number, number, number]; vol: Record<string, number> }

export interface LevelDef {
  doors: DoorSpec[];
  /** Door frame zone per door (default: level 1's north / south split). */
  frameZone?: (s: DoorSpec) => { name: string; rooms: string[] };
  portals: PortalSpec[];
  /** Rooms behind a shut see-through door are drawn only within this distance of that door. */
  seeRange?: number;
  triggers: TriggerSpec[];
  /** Extra nav portal points (open archways) besides the door centres. */
  navPortals?: { x: number; z: number }[];
  navStep: (room: string) => number;
  /** Where nav reachability pruning starts (normally the spawn). */
  navStart: { x: number; z: number };
  extraProbes?: THREE.Vector3[];
  spawn: { position: THREE.Vector3; yaw: number };
  /** Room the camera is assumed to be in before it first enters one. */
  startRoom: string;
  machineLoops?: Record<string, MachineLoop>;
  timings?: string[];
  t0?: number;
}

export type LevelImpl = Level & { settle(seconds?: number): void; setSilent(on: boolean): void };

export function assembleLevel(ctx: GameContext, L: LevelBuild, def: LevelDef): LevelImpl {
  const t0 = def.t0 ?? performance.now();
  const timings = def.timings ?? [];
  let tl = performance.now();
  const lap = (name: string) => { const n = performance.now(); timings.push(`${name} ${(n - tl).toFixed(0)}`); tl = n; };

  const doors: DoorImpl[] = makeDoors(L, def.doors, def.frameZone);
  if (ctx.debug.noStory) for (const d of doors) d.unlock();
  for (const d of doors) L.doors.set(d.id, d);
  for (const fn of L.afterDoors) fn();
  lap('doors');
  const doorMap = new Map<string, DoorImpl>(doors.map((d) => [d.id, d]));

  const tris = L.finishBuilders();
  lap('merge');
  const colliders = L.colliderMeshes();
  const rooms: readonly Room[] = L.rooms;

  const nav: NavNode[] = buildNav(L, rooms, [...def.doors.map((d) => ({ x: d.x, z: d.z })), ...(def.navPortals ?? [])], def.navStep, def.navStart);
  lap('nav');
  const triggers = new TriggerSystem(ctx, def.triggers);

  const probes = L.probes.slice();
  if (def.extraProbes) probes.push(...def.extraProbes);

  // ── room visibility (levels are long chains of rooms: without this every room is inside the frustum) ──
  const SEE_RANGE = def.seeRange ?? 22;
  const roomIds = rooms.map((r) => r.id);
  const roomBit = new Map(roomIds.map((id, i) => [id, 1 << i]));
  const portals = def.portals.map(([a, b, d, see]) => ({ a: roomBit.get(a)!, b: roomBit.get(b)!, door: d ? doorMap.get(d)! : null, see: see === true ? SEE_RANGE : see || 0 }));
  const tagged: { obj: THREE.Object3D; mask: number }[] = [];
  for (const o of L.root.children) {
    let mask = 0;
    for (const r of (o.userData.rooms as string[] | undefined) ?? []) mask |= roomBit.get(r) ?? 0;
    if (mask) tagged.push({ obj: o, mask });
  }
  const castLights = L.castLights.map((c) => ({ desc: c.desc, bit: roomBit.get(c.room) ?? 0 }));
  let lastRoomBit = roomBit.get(def.startRoom) ?? 1, lastMask = -1;
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
  const loopDefs = def.machineLoops ?? {};
  const loops = new Map<string, { handle: ReturnType<GameContext['audio']['loop']> | null }>();
  const machineAudio = (name: string, state: MachineState) => {
    const d = loopDefs[name];
    if (!d || !ctx.audio) return;
    let e = loops.get(name);
    if (!e) loops.set(name, (e = { handle: null }));
    if (state === 'off') { e.handle?.stop(0.8); e.handle = null; return; }
    const v = d.vol[state] ?? 0.5;
    if (!e.handle) e.handle = ctx.audio.loop(d.id, { position: new THREE.Vector3(...d.pos), volume: v });
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

  const level: LevelImpl = {
    /** Checkpoint restore (story): finish every running vignette animation instantly and silently. */
    settle(seconds = 6) { L.settle(seconds); },
    /** Checkpoint restore (story): suppress the level's own positional one-shots while state is re-applied. */
    setSilent(on: boolean) { L.silent = on; },
    root: L.root,
    colliders,
    spawn: def.spawn,
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

/** Build a list of rooms in order, tagging every new root child with the room it belongs to. */
export function buildRooms(L: LevelBuild, list: readonly (readonly [string, (L: LevelBuild) => void])[], lap?: (name: string) => void) {
  for (const [room, fn] of list) {
    L.currentRoom = room;
    fn(L);
    for (const o of L.root.children) if (!o.userData.rooms || !o.userData.rooms.length) o.userData.rooms = [L.currentRoom];
    lap?.(room);
  }
  L.currentRoom = '';
  L.finishLightBounds();
}
