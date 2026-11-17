/**
 * Level-agnostic assembly: once a level's rooms are built into a LevelBuild, this wires up doors, nav,
 * triggers, portal-based room visibility, positional machine loops and returns the `Level` object.
 * Level 1 (`index.ts`) and level 2 (`l2/index.ts`) only differ in the data they pass in.
 */
import * as THREE from 'three';
import type { CoverPoint, Door, FloorInfo, GameContext, Level, NavNode, Room } from '../core/types';
import type { LevelBuild, MachineState } from './context';
import { makeDoors, type DoorImpl, type DoorSpec } from './doors';
import { buildNav, type NavPortal } from './nav';
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
  /** Extra nav portal points (open archways) besides the door centres; `y` = the opening's floor (default 0). */
  navPortals?: NavPortal[];
  navStep: (room: string) => number;
  /** Where nav reachability pruning starts (normally the spawn); give `y` on a multi-deck level. */
  navStart: { x: number; y?: number; z: number };
  extraProbes?: THREE.Vector3[];
  spawn: { position: THREE.Vector3; yaw: number };
  /** Room the camera is assumed to be in before it first enters one. */
  startRoom: string;
  machineLoops?: Record<string, MachineLoop>;
  timings?: string[];
  t0?: number;
  /** REVISION 5: named regions besides the per-room ones (each room id is a region by default). */
  regions?: Record<string, THREE.Box3[]>;
  /** Stage 3c §8.3: soldier cover points (`Level.cover`; K placeholder default `[]` — levels 1–4 have none). */
  cover?: readonly CoverPoint[];
}

/**
 * Stage 3c §8.4 `Level.floorAt` (default for every level): the floor of `room` that `p` stands on — the main floor or a
 * `floors[i]` whose plan box contains p, the highest with y ≤ p.y + 0.5 (else the lowest of them).
 */
export function floorOf(room: Room, p: THREE.Vector3): FloorInfo {
  const main = room.floor ?? room.y0 ?? 0;
  let best: FloorInfo | null = null, low: FloorInfo | null = null;
  const consider = (f: FloorInfo) => {
    if (!low || f.y < low.y) low = f;
    if (f.y <= p.y + 0.5 && (!best || f.y > best.y)) best = f;
  };
  consider({ room: room.id, floor: -1, y: main, nav: true, exits: [] });
  (room.floors ?? []).forEach((f, i) => {
    const [x0, x1, z0, z1] = f.box;
    if (p.x < x0 || p.x > x1 || p.z < z0 || p.z > z1) return;
    consider({ room: room.id, floor: i, y: f.y, nav: f.nav !== false, exits: (f.exits ?? []).map(([x, y, z]) => new THREE.Vector3(x, y, z)) });
  });
  return (best ?? low)!;
}

export type LevelImpl = Level & {
  settle(seconds?: number): void;
  setSilent(on: boolean): void;
  /**
   * Stage 3a §8.4 (feeds): the rooms drawn — instead of the main view's portal set — for the duration of ONE feed pass
   * (null = end of the pass). Honoured by `roomVisible` (render's `occludeForeign`), `isVisible` and the tagged-room
   * pass; the main view's mask, its shadow requests and anything outside the pass are untouched. render/feed.ts only.
   */
  setVisibilityOverride(rooms: ReadonlySet<string> | null): void;
  /**
   * Stage 3a §8.4: rooms some live feed is showing (union of the active feeds; null = none). Enemies' `cullOne` keeps
   * actors / machines standing in them drawable and fully animated; the main pass still hides them by `roomVisible`.
   */
  setFeedRooms(rooms: ReadonlySet<string> | null): void;
};

/** What a level publishes on `root.userData.visibility` for the render and enemies modules (stage 3a §8.4). */
export interface LevelVisibility {
  setOverride(rooms: ReadonlySet<string> | null): void;
  setFeedRooms(rooms: ReadonlySet<string> | null): void;
  /** Is the room at (x, z) shown by an active feed? (false outside any room) */
  fed(x: number, z: number): boolean;
}

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

  // door portal nodes stand on the door's floor (§8.9 `DoorSpec.y`, §8.10)
  const nav: NavNode[] = buildNav(L, rooms, [...def.doors.map((d) => ({ x: d.x, y: d.y, z: d.z })), ...(def.navPortals ?? [])], def.navStep, def.navStart);
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
  /** Stage 3a §8.4: rooms of the feed pass in progress (0 outside a feed pass) / rooms any active feed shows. */
  let passMask = 0, fedMask = 0;
  const maskOf = (ids: ReadonlySet<string> | null): number => {
    let m = 0;
    if (ids) for (const id of ids) { const b = roomBit.get(id); if (b) m |= b; else console.warn(`[level] visibility override: unknown room "${id}"`); }
    return m;
  };
  const roomIndexAt = (x: number, z: number): number => {
    for (let i = 0; i < rooms.length; i++) {
      const b = rooms[i].bounds;
      if (x > b.min.x + 0.05 && x < b.max.x - 0.05 && z > b.min.z + 0.05 && z < b.max.z - 0.05) return i;
    }
    return -1;
  };
  /** The rooms being drawn: during a feed pass exactly the feed's rooms, otherwise the main view's portal set. */
  const drawMask = () => (passMask ? passMask : lastMask);
  L.isVisible = (id) => (passMask ? (passMask & (roomBit.get(id) ?? 0)) !== 0 : lastMask === -1 || (lastMask & (roomBit.get(id) ?? 0)) !== 0);
  // Published for the render module: is the room at (x, z) potentially visible? (true outside any room)
  L.root.userData.roomVisible = (x: number, z: number): boolean => {
    if (!passMask && lastMask === -1) return true;
    const i = roomIndexAt(x, z);
    return i < 0 || (drawMask() & (1 << i)) !== 0;
  };
  // Feed pass (stage 3a §8.4): exactly the feed's rooms are drawn — objects of those rooms that the main view's culling
  // hid are shown, objects of the main view's other rooms are hidden — and both are put back right after the pass.
  // Nothing else's `visible` is touched (objects a script hid stay hidden), so the main view cannot change, and the
  // feed's image does not depend on where the player stands.
  const passShown: THREE.Object3D[] = [];
  const passHidden: THREE.Object3D[] = [];
  const setOverride = (ids: ReadonlySet<string> | null): void => {
    for (let i = 0; i < passShown.length; i++) passShown[i].visible = false;
    for (let i = 0; i < passHidden.length; i++) passHidden[i].visible = true;
    passShown.length = 0;
    passHidden.length = 0;
    passMask = maskOf(ids);
    if (!passMask) return;
    for (let i = 0; i < tagged.length; i++) {
      const t = tagged[i];
      const want = (t.mask & passMask) !== 0;
      if (want) { if (!t.obj.visible && lastMask !== -1 && (t.mask & lastMask) === 0) { t.obj.visible = true; passShown.push(t.obj); } }
      else if (t.obj.visible) { t.obj.visible = false; passHidden.push(t.obj); }
    }
  };
  const setFeedRooms = (ids: ReadonlySet<string> | null): void => { fedMask = maskOf(ids); };
  const visibility: LevelVisibility = {
    setOverride, setFeedRooms,
    fed(x, z) {
      if (!fedMask) return false;
      const i = roomIndexAt(x, z);
      return i >= 0 && (fedMask & (1 << i)) !== 0;
    },
  };
  L.root.userData.visibility = visibility;
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
    if (passMask) setOverride(null); // (never: passes end inside render) — keep the bookkeeping exact
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

  const fallbackDoor: Door = { id: '?', position: new THREE.Vector3(), locked: false, isOpen: false, closed: true, auto: false, open() {}, close() {}, lock() {}, unlock() {}, setStatus() {} };
  // ── regions (REVISION 5.1): one per room + the level's named ones ──
  const regions: Record<string, THREE.Box3[]> = {};
  for (const r of rooms) (regions[r.id] ??= []).push(r.bounds.clone());
  for (const [k, v] of Object.entries(def.regions ?? {})) regions[k] = v;
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
    setVisibilityOverride: setOverride,
    setFeedRooms,
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
    regions,
    cover: def.cover ?? [],
    floorAt(p) { const r = level.roomAt(p); return r ? floorOf(r, p) : null; },
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
