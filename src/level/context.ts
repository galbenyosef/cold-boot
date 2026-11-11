/**
 * LevelBuild — shared state while constructing the level (and the registries the Level object exposes).
 */
import * as THREE from 'three';
import type {
  EnemySpawn, EnemyType, FlickerMode, GameContext, LightDesc, LightHandle, MaterialName, PickupKind, PickupSpawn, Room,
  ScreenKind, SignStyle, Surface,
} from '../core/types';
import { Builder, aabbOf, mergeItems, unitBox, type Face } from './builder';

/** Global gain on every authored light intensity (tuned against the real renderer's exposure). */
export const LIGHT_GAIN = 2.0;

export type MachineState = 'off' | 'idle' | 'active' | 'frenzy';

export interface LightOpts {
  flicker?: FlickerMode; cast?: boolean; vol?: boolean; enabled?: boolean; priority?: number; penumbra?: number;
}

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
  light(desc: LightDesc): LightHandle {
    this.lightCount++;
    desc.intensity *= LIGHT_GAIN;
    return this.ctx.render.lights.add(desc);
  }
  spot(group: string, x: number, y: number, z: number, tx: number, ty: number, tz: number, color: THREE.ColorRepresentation,
    intensity: number, distance: number, angle: number, o: LightOpts = {}): LightHandle {
    return this.light({
      type: 'spot', position: new THREE.Vector3(x, y, z), target: new THREE.Vector3(tx, ty, tz), color, intensity, distance,
      angle, penumbra: o.penumbra ?? 0.6, castShadow: !!o.cast, flicker: o.flicker ?? 'none', group, priority: o.priority ?? 1,
      volumetric: !!o.vol, enabled: o.enabled !== false,
    });
  }
  point(group: string, x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, distance: number,
    o: LightOpts = {}): LightHandle {
    return this.light({
      type: 'point', position: new THREE.Vector3(x, y, z), color, intensity, distance, castShadow: !!o.cast,
      flicker: o.flicker ?? 'none', group, priority: o.priority ?? 1, enabled: o.enabled !== false,
    });
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

  // ── gameplay data ──
  enemy(group: string, type: EnemyType, mode: 'dormant' | 'spawn', x: number, y: number, z: number, yaw: number, pose?: string) {
    const n = this.enemySpawns.filter((e) => e.group === group).length;
    this.enemySpawns.push({ id: `${group}_${n + 1}`, type, position: new THREE.Vector3(x, y, z), yaw, group, mode, pose });
  }
  pickup(id: string, kind: PickupKind, x: number, y: number, z: number, amount: number, yaw = 0) {
    this.pickups.push({ id, kind, position: new THREE.Vector3(x, y, z), amount, yaw });
  }
  interact(id: string, kind: string, prompt: string, x: number, y: number, z: number, enabled = true, radius = 2.2) {
    return this.ctx.interactables.add({ id, kind, prompt, position: new THREE.Vector3(x, y, z), enabled, radius });
  }
  navNode(x: number, z: number, room: string, y = 0) { this.navExtra.push({ p: new THREE.Vector3(x, y, z), room }); }
}
