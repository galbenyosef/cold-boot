/**
 * LevelBuild — shared state while constructing the level (and the registries the Level object exposes).
 */
import * as THREE from 'three';
import type {
  EnemySpawn, EnemyType, FlickerMode, GameContext, LightDesc, LightHandle, MaterialName, PickupKind, PickupSpawn, Room,
  ScreenKind, SignStyle, Surface,
} from '../core/types';
import { Builder, aabbOf, mergeItems, unitBox, type Face } from './builder';
import { SignAtlas, type UvRect } from './signatlas';
import type { DoorImpl } from './doors';

/** Global gain on every authored light intensity (tuned against the real renderer's exposure). */
export const LIGHT_GAIN = 2.0;

const _lp = new THREE.Vector3();

export type MachineState = 'off' | 'idle' | 'active' | 'frenzy';

export interface LightOpts {
  flicker?: FlickerMode; cast?: boolean; vol?: boolean; enabled?: boolean; priority?: number; penumbra?: number;
  /** Explicit light bounds (default: the room the light sits in, see `finishLightBounds`). null = unbounded. */
  bounds?: THREE.Box3 | null;
}

/**
 * How far (metres) a room's lights may reach beyond the room itself: [-x, +x, -z, +z]. Only where the
 * neighbour is seen through a permanent opening (archway, window slits, cage gate) AND the grown box does
 * not swallow a third room.
 */
const LIGHT_SPILL: Record<string, [number, number, number, number]> = {
  corr_a: [0, 0, 6.0, 0],      // down the archway into the junction (junction is wider than the corridor)
  junction: [0, 0, 0, 6.0],    // junction light reaches back up the corridor
  lobby: [0, 0, 5.6, 0],       // through the cage gate into the cab + shaft
  elevator: [1.6, 1.6, 2.6, 3.4], // the open shaft around the cab, and out through the cage gate
};
/** Light box margin past a room side: walls shared with a neighbour are centred on the bound (face 0.2 inside). */
const SHARED_MARGIN = 0.1, OUTER_MARGIN = 0.42;

export interface Obstacle { box: THREE.Box3 }

export class LevelBuild {
  readonly root = new THREE.Group();
  readonly rooms: Room[] = [];
  readonly probes: THREE.Vector3[] = [];
  readonly enemySpawns: EnemySpawn[] = [];
  readonly pickups: PickupSpawn[] = [];
  readonly screens = new Map<string, THREE.MeshStandardMaterial>();
  readonly objects = new Map<string, THREE.Object3D>();
  readonly machines = new Map<string, (s: MachineState) => void>();
  readonly updaters: ((dt: number, t: number) => void)[] = [];
  readonly instDefs = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; cast: boolean }>();
  /** Nav obstacles (AABBs of colliders intersecting the walking height band). */
  readonly obstacles: THREE.Box3[] = [];
  /** Extra hand-placed nav nodes. */
  readonly navExtra: { p: THREE.Vector3; room: string }[] = [];
  lightCount = 0;
  /** Scripted set-pieces fired through `level.vignette(id)`. */
  readonly vignettes = new Map<string, { run: () => void; toggle: boolean; fired: boolean }>();
  /** Doors by id (filled by createLevel after every room is built — use from updaters / vignettes / `afterDoors`). */
  readonly doors = new Map<string, DoorImpl>();
  /** Hooks run once the doors exist (things that hang on door leaves). */
  readonly afterDoors: (() => void)[] = [];
  /** Is the room currently drawn? (wired up by createLevel; ambient motion only runs in visible rooms) */
  isVisible: (room: string) => boolean = () => true;
  private tweens: { t: number; dur: number; step: ((k: number, dt: number) => void) | null; done: (() => void) | null }[] = [];
  private sims: ((dt: number) => boolean | void)[] = [];
  private warned = new Set<string>();
  private pendingBounds: { box: THREE.Box3; pos: THREE.Vector3; room: string }[] = [];
  /** Shadow-requesting lights with the room they sit in (the request is withdrawn while that room is culled). */
  readonly castLights: { desc: LightDesc; room: string }[] = [];
  /** Room currently being built (tags zones / objects for visibility culling). */
  currentRoom = '';
  private colliderItems: Record<string, { geo: THREE.BufferGeometry; m: THREE.Matrix4; uv: 'box'; su: number; sv: number }[]> = {};
  private signs = new Map<string, THREE.MeshStandardMaterial>();
  private builders: Builder[] = [];

  constructor(readonly ctx: GameContext) {
    this.root.name = 'level';
  }

  /** New zone builder; its meshes are added to the level root by `finishBuilders()`. */
  builder(name: string): Builder {
    const b = new Builder(this, name);
    b.atlasSigns = true;
    b.rooms = this.currentRoom ? [this.currentRoom] : [];
    this.builders.push(b);
    return b;
  }
  /** Existing zone builder by name (zones may be filled from several functions). */
  namedBuilder(name: string): Builder { return this.builders.find((b) => b.name === name) ?? this.builder(name); }
  /** Stand-alone builder for dynamic parts (caller owns the resulting group). */
  part(name: string): Builder { return new Builder(this, name); }

  finishBuilders(): number {
    let tris = 0;
    this.signAtlas.finish();
    for (const b of this.builders) {
      const g = b.build(true);
      tris += b.tris;
      if (g.children.length) this.root.add(g);
    }
    this.builders.length = 0;
    return tris;
  }

  defineInstance(name: string, mat: THREE.Material, cast: boolean, make: (b: Builder) => void) {
    const b = new Builder(this, name);
    make(b);
    this.instDefs.set(name, { geo: b.bake(), mat, cast });
  }

  signMat(text: string, style: SignStyle, aspect: number): THREE.MeshStandardMaterial {
    const a = Math.round(aspect * 4) / 4;
    const key = `${style}|${a}|${text}`;
    let m = this.signs.get(key);
    if (!m) {
      this.signs.set(key, (m = this.ctx.materials.sign(text, style, a)));
      // painted stencils: worn, never brighter than the surface they sit on
      if (style === 'stencil') m.color.multiplyScalar(0.55);
    }
    return m;
  }

  private signAtlas = new SignAtlas();
  /** Atlas slot for a sign (static zones only — must be requested before `finishBuilders`). */
  signSlot(text: string, style: SignStyle, aspect: number): { mat: THREE.MeshStandardMaterial; rect: UvRect } | null {
    const a = Math.round(aspect * 4) / 4;
    return this.signAtlas.entry(`${a}|${text}`, style, this.signMat(text, style, aspect));
  }

  private dsMats = new Map<string, THREE.MeshStandardMaterial>();
  /** Double-sided private clone of a library material (cloth, cage mesh). */
  doubleSided(name: MaterialName): THREE.MeshStandardMaterial {
    let m = this.dsMats.get(name);
    if (!m) this.dsMats.set(name, (m = this.ctx.materials.clone(name, { side: THREE.DoubleSide })));
    return m;
  }

  private _puddle: THREE.MeshStandardMaterial | null = null;
  /** Glossy dark standing-water material (reflects the room probe). */
  puddleMat(): THREE.MeshStandardMaterial {
    if (!this._puddle) {
      this._puddle = this.ctx.materials.clone('painted_dark', { color: 0x0a0c0d, roughness: 0.03, metalness: 0.55, map: null, normalMap: null, roughnessMap: null, metalnessMap: null, aoMap: null, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this._puddle.name = 'puddle';
    }
    return this._puddle;
  }

  addCollider(m: THREE.Matrix4, surface: Surface, nav: boolean) {
    (this.colliderItems[surface] ??= []).push({ geo: unitBox(), m, uv: 'box', su: 1, sv: 1 });
    if (nav) {
      const box = aabbOf(m, new THREE.Box3());
      if (box.max.y > 0.2 && box.min.y < 1.5) this.obstacles.push(box);
    }
  }

  /** One merged invisible proxy mesh per surface type. */
  colliderMeshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const surface of Object.keys(this.colliderItems)) {
      const geo = mergeItems(this.colliderItems[surface]);
      geo.deleteAttribute('uv');
      const mesh = new THREE.Mesh(geo);
      mesh.name = `collider:${surface}`;
      mesh.userData.surface = surface;
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      out.push(mesh);
    }
    return out;
  }

  room(id: string, name: string, x0: number, x1: number, z0: number, z1: number, h: number, probeY = 1.6): Room {
    const r: Room = { id, name, bounds: new THREE.Box3(new THREE.Vector3(x0, -0.5, z0), new THREE.Vector3(x1, h, z1)) };
    this.rooms.push(r);
    this.probes.push(new THREE.Vector3((x0 + x1) / 2, probeY, (z0 + z1) / 2));
    return r;
  }

  // ── lights ──
  light(desc: LightDesc, bounds?: THREE.Box3 | null): LightHandle {
    this.lightCount++;
    desc.intensity *= LIGHT_GAIN;
    if (bounds) desc.bounds = bounds;
    else if (bounds === undefined && !desc.bounds) {
      // Filled in by finishLightBounds() once every room is known (the box object is shared by reference).
      desc.bounds = new THREE.Box3(new THREE.Vector3(-1e5, -1e5, -1e5), new THREE.Vector3(1e5, 1e5, 1e5));
      this.pendingBounds.push({ box: desc.bounds, pos: desc.position.clone(), room: this.currentRoom });
    }
    if (desc.castShadow) this.castLights.push({ desc, room: this.roomIdAt(desc.position) || this.currentRoom });
    return this.ctx.render.lights.add(desc);
  }

  private roomIdAt(p: THREE.Vector3): string {
    for (const r of this.rooms) {
      const b = r.bounds;
      if (p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z) return r.id;
    }
    return '';
  }

  /** World box a room's lights are confined to (its bounds + wall margin + authored spill). Unbounded in Y. */
  roomLightBox(id: string, out = new THREE.Box3()): THREE.Box3 | null {
    const room = this.rooms.find((r) => r.id === id);
    if (!room) return null;
    const b = room.bounds, e = 1e-3;
    // A side is shared when another room's footprint touches it.
    const shared = (axis: 'x' | 'z', v: number) => this.rooms.some((o) => {
      if (o === room) return false;
      const ob = o.bounds;
      if (axis === 'x') return (Math.abs(ob.min.x - v) < e || Math.abs(ob.max.x - v) < e) && ob.min.z < b.max.z - e && ob.max.z > b.min.z + e;
      return (Math.abs(ob.min.z - v) < e || Math.abs(ob.max.z - v) < e) && ob.min.x < b.max.x - e && ob.max.x > b.min.x + e;
    });
    const m = (axis: 'x' | 'z', v: number) => (shared(axis, v) ? SHARED_MARGIN : OUTER_MARGIN);
    const sp = LIGHT_SPILL[id] ?? [0, 0, 0, 0];
    out.min.set(b.min.x - Math.max(m('x', b.min.x), sp[0]), -1e4, b.min.z - Math.max(m('z', b.min.z), sp[2]));
    out.max.set(b.max.x + Math.max(m('x', b.max.x), sp[1]), 1e4, b.max.z + Math.max(m('z', b.max.z), sp[3]));
    return out;
  }

  /** Resolve the default bounds of every light created so far: the room that contains it (else the room that built it). */
  finishLightBounds(): void {
    for (const p of this.pendingBounds) {
      const id = this.roomIdAt(p.pos) || p.room;
      if (!this.roomLightBox(id, p.box)) continue;
      // never clip a lamp that sits outside the box it was given (shaft lights, lamps recessed into a wall)
      p.box.expandByPoint(_lp.copy(p.pos).addScalar(-0.5)).expandByPoint(_lp.copy(p.pos).addScalar(0.5));
    }
    this.pendingBounds.length = 0;
  }
  spot(group: string, x: number, y: number, z: number, tx: number, ty: number, tz: number, color: THREE.ColorRepresentation,
    intensity: number, distance: number, angle: number, o: LightOpts = {}): LightHandle {
    return this.light({
      type: 'spot', position: new THREE.Vector3(x, y, z), target: new THREE.Vector3(tx, ty, tz), color, intensity, distance,
      angle, penumbra: o.penumbra ?? 0.6, castShadow: !!o.cast, flicker: o.flicker ?? 'none', group, priority: o.priority ?? 1,
      volumetric: !!o.vol, enabled: o.enabled !== false,
    }, o.bounds);
  }
  point(group: string, x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, distance: number,
    o: LightOpts = {}): LightHandle {
    return this.light({
      type: 'point', position: new THREE.Vector3(x, y, z), color, intensity, distance, castShadow: !!o.cast,
      flicker: o.flicker ?? 'none', group, priority: o.priority ?? 1, enabled: o.enabled !== false,
    }, o.bounds);
  }
  /** Private emissive material kept in sync with a light. */
  glow(h: LightHandle, name: 'emissive_white' | 'emissive_warm' | 'emissive_red' | 'emissive_amber' | 'emissive_cyan' | 'emissive_green', boost = 1): THREE.MeshStandardMaterial {
    const m = this.ctx.materials.clone(name);
    const base = (m.emissiveIntensity || 1) * boost;
    m.emissiveIntensity = base;
    h.bindEmissive(m, base);
    return m;
  }

  // ── screens ──
  /** A monitor quad with an animated screen material; registered under `name` if given. */
  screen(name: string | null, kind: ScreenKind, w: number, h: number, x: number, y: number, z: number, face: Face,
    opts: { text?: string; tilt?: number; parent?: THREE.Object3D } = {}): THREE.Mesh {
    const mat = this.ctx.materials.screen(kind, { text: opts.text, aspect: w / h });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    const ry = face === '+z' ? 0 : face === '-z' ? Math.PI : face === '+x' ? Math.PI / 2 : face === '-x' ? -Math.PI / 2 : 0;
    mesh.rotation.set(face === '+y' ? -Math.PI / 2 : (opts.tilt ?? 0), ry, 0, 'YXZ');
    mesh.name = `screen:${name ?? kind}`;
    (opts.parent ?? this.root).add(mesh);
    if (name) this.screens.set(name, mat);
    return mesh;
  }

  vec(x: number, y: number, z: number) { return new THREE.Vector3(x, y, z); }
  /** Empty named Object3D marking a prop's position (for `level.object(name)`). */
  marker(name: string, x: number, y: number, z: number, ry = 0): THREE.Object3D {
    const o = new THREE.Object3D();
    o.name = name; o.position.set(x, y, z); o.rotation.y = ry;
    this.root.add(o); this.objects.set(name, o);
    return o;
  }

  // ── vignettes / scripted animation ──
  /** Register a scripted set-piece. One-shots run once; toggles run on every call. */
  vignette(id: string, run: () => void, toggle = false) { this.vignettes.set(id, { run, toggle, fired: false }); }
  fireVignette(id: string): void {
    const v = this.vignettes.get(id);
    if (!v) { if (!this.warned.has(id)) { this.warned.add(id); console.warn(`[level] unknown vignette "${id}"`); } return; }
    if (v.fired && !v.toggle) return;
    v.fired = true;
    try { v.run(); } catch (e) { console.warn(`[level] vignette "${id}" failed`, e); }
  }
  /** After `delay` s, call `step(k, dt)` with k running 0 → 1 over `dur` s, then `done()`. */
  tween(delay: number, dur: number, step: ((k: number, dt: number) => void) | null, done: (() => void) | null = null) {
    this.tweens.push({ t: -delay, dur, step, done });
  }
  after(delay: number, fn: () => void) { this.tween(delay, 0, null, fn); }
  /** Free-running simulation: called every frame until it returns false. */
  sim(step: (dt: number) => boolean | void) { this.sims.push(step); }
  updateTasks(dt: number) {
    const tw = this.tweens;
    for (let i = tw.length - 1; i >= 0; i--) {
      const a = tw[i];
      a.t += dt;
      if (a.t < 0) continue;
      if (a.step) a.step(a.dur > 0 ? Math.min(1, a.t / a.dur) : 1, dt);
      if (a.t >= a.dur) { tw.splice(i, 1); if (a.done) a.done(); }
    }
    const sm = this.sims;
    for (let i = sm.length - 1; i >= 0; i--) if (sm[i](dt) === false) sm.splice(i, 1);
  }
  /** Always-on motion that only runs while `room` is being drawn. */
  ambient(room: string, fn: (dt: number, t: number) => void) {
    this.updaters.push((dt, t) => { if (this.isVisible(room)) fn(dt, t); });
  }
  /** Positional one-shot (never throws; unknown ids are the audio module's problem). */
  sfx(id: string, x: number, y: number, z: number, volume = 1, pitch = 1) {
    try { this.ctx.audio?.play(id, { position: new THREE.Vector3(x, y, z), volume, pitch }); } catch { /* audio not ready */ }
  }

  // ── gameplay data ──
  enemy(group: string, type: EnemyType, mode: 'dormant' | 'spawn', x: number, y: number, z: number, yaw: number, pose?: string, idle?: EnemySpawn['idle']) {
    const n = this.enemySpawns.filter((e) => e.group === group).length;
    const e: EnemySpawn = { id: `${group}_${n + 1}`, type, position: new THREE.Vector3(x, y, z), yaw, group, mode, pose };
    if (idle) e.idle = idle;
    this.enemySpawns.push(e);
  }
  pickup(id: string, kind: PickupKind, x: number, y: number, z: number, amount: number, yaw = 0) {
    this.pickups.push({ id, kind, position: new THREE.Vector3(x, y, z), amount, yaw });
  }
  interact(id: string, kind: string, prompt: string, x: number, y: number, z: number, enabled = true, radius = 2.2) {
    return this.ctx.interactables.add({ id, kind, prompt, position: new THREE.Vector3(x, y, z), enabled, radius });
  }
  navNode(x: number, z: number, room: string, y = 0) { this.navExtra.push({ p: new THREE.Vector3(x, y, z), room }); }
}
