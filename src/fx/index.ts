/**
 * FX system: sparks, smoke/steam/dust, fluid, decals, flashes, arcs, explosions, debris, emitters.
 *
 * Draw calls (only when something of that kind is alive): puffs 1, streaks 1, arcs 1,
 * decals 1 per used (name, variant) batch, generic debris 1 per shard shape (4).
 * Everything is pooled and built at load; steady-state frames allocate nothing.
 *
 * Auto-handled events: 'bullet:impact' (decal + sparks/dust/chips by surface). Stage 3c (W6): an impact that ends an
 * ENEMY round (its point is an `enemy:fired` point or a `tracer()` end of the same frame) lights nothing — a firefight
 * must not light the room — and gets a hotter emissive glow instead; the player's impacts are as before.
 * Hits on machines are NOT handled here: the enemies module owns its hit effects (scaled by damage / part,
 * coalesced per enemy per frame) and calls sparks()/fluid()/flash() itself.
 */
import * as THREE from 'three';
import type { DecalName, FxSystem, GameContext, HitOwner, Quality, Surface } from '../core/types';
import { Streaks, ST } from './streaks';
import { Puffs, SHAPE } from './puffs';
import { Flashes } from './flashes';
import { Decals, GLASS_STAR } from './decals';
import { Arcs, type ArcSlot } from './arcs';
import { Debris } from './debris';
import { createPuffAtlas } from './textures';
import { Emitters, type EmitterKind, type EmitterSink } from './emitters';
import { VolumeRegistry, type FxAperture, type FxVolume, type FxVolumeSpec } from './volumes';
import { createFog, type FogHandle, type FogOpts } from './fog';
import { createViewport, type ViewportHandle, type ViewportOpts } from './viewport';
import { createFalls, createPool, type FallsHandle, type FallsOpts, type PoolHandle, type PoolOpts } from './water';
import { createLampGrid, type LampGridHandle, type LampGridOpts } from './lamps';
import { EnemyTracers, MuzzleFlashes, type MuzzleKind } from './gunfire';
import { WetPatches, type WetPatchHandle, type WetPatchOpts } from './wet';
import { createWell, type WellHandle, type WellOpts } from './well';
import { createTrunkFx, type FxTrunk } from './trunk';

export type { ViewportHandle, ViewportOpts, ViewportState } from './viewport';
export type { FallsHandle, FallsOpts, PoolHandle, PoolOpts, PoolSurfaceQuad } from './water';
export type { LampGridHandle, LampGridOpts, LampSetOpts, LampState } from './lamps';
export type { FxAperture, FxVolume, FxVolumeSpec } from './volumes';
export type { FogHandle, FogOpts } from './fog';
export type { WetPatchHandle, WetPatchOpts } from './wet';
export type { MuzzleKind } from './gunfire';
export type { WellHandle, WellOpts, WellState, WellEye } from './well';
export type { FxTrunk, SprayHandle, SprayOpts, WaterFxOpts } from './trunk';

const QMUL: Record<Quality, number> = { low: 0.45, medium: 0.7, high: 1, ultra: 1.25 };

// scratch
const _n = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _up = new THREE.Vector3(0, 1, 0);
const _dirs = [
  new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0),
];
const _col = new THREE.Color();

function basis(n: THREE.Vector3) {
  _t1.set(0, 1, 0);
  if (Math.abs(n.y) > 0.9) _t1.set(1, 0, 0);
  _t1.cross(n).normalize();
  _t2.crossVectors(n, _t1);
}

/** Random direction within `spread` radians of the (unit) axis set by basis(); written to _d. */
function cone(n: THREE.Vector3, spread: number) {
  const th = spread * Math.sqrt(Math.random());
  const ph = Math.random() * Math.PI * 2;
  const s = Math.sin(th);
  _d.copy(n).multiplyScalar(Math.cos(th))
    .addScaledVector(_t1, Math.cos(ph) * s)
    .addScaledVector(_t2, Math.sin(ph) * s);
  return _d;
}

const r = (a: number, b: number) => a + (b - a) * Math.random();

export interface FxStats { streaks: number; puffs: number; debris: number; emitters: number; habitat: number; volumes: number; bounded: number; tracers: number; muzzles: number; wet: number }

/** Stage 3b §8.6.3: a bounded emitter — its particles live in a per-box set, fade at the box's faces, die on leaving it. */
export interface EmitterOpts {
  bounds: THREE.Box3;
  /** Registry (D21) for the box's set (shared by every emitter with the same box): drawn only while one is drawn. */
  rooms?: readonly string[];
  id?: string;
  seenFrom?: readonly string[];
  /** Steam jet speed multiplier (default 1 = 4–6.5 m/s; a decon mist wants ≈ 0.3 so the jets fill the box). */
  speed?: number;
  /**
   * Stage 3b B9: steam as a tight jet — short-lived, small, denser puffs that stay a line from the nozzle (air-shower
   * jets) instead of billowing into a room-filling haze. Default false.
   */
  jet?: boolean;
}

export interface BreathHandle { enabled: boolean; readonly box: THREE.Box3; remove(): void }

/**
 * Stage 3b §8.6 (W7) — not in the contract; reach them as `ctx.fx as FxSystemEx`.
 *   fog          — bounded ground fog (+ glints), 1–2 draw calls, registered
 *   breathZone   — the player's breath shows while the eye is inside `box`
 *   emitter(…, { bounds }) — a bounded emitter (see EmitterOpts)
 *   volume / volumes / debugVolumes / forceVolumes / drawnRooms — the D21 registry (see volumes.ts)
 */
export interface FxVolumesApi {
  fog(o: FogOpts): FogHandle;
  breathZone(box: THREE.Box3, o?: { rooms?: readonly string[]; id?: string }): BreathHandle;
  emitter(kind: EmitterKind, point: THREE.Vector3, direction?: THREE.Vector3, rate?: number, o?: EmitterOpts): { stop(): void; enabled: boolean };
  /** Register a volume (owners of their own glow / particle objects; fx's own register themselves). */
  volume(spec: FxVolumeSpec): FxVolume;
  volumes(): readonly FxVolume[];
  /** Every registered volume in opaque unlit magenta (check:fxleak). */
  debugVolumes(on: boolean): void;
  /** check:fxleak: ignore the room gate (every volume drawn wherever its owner shows it). */
  forceVolumes(on: boolean): void;
  /** Stage 3b B6: true while `debugVolumes(true)` is on (level 4's view culling stands down for check:fxleak). */
  readonly volumesDebug: boolean;
  /** Rooms drawn this frame (the level's portal set). */
  drawnRooms(): string[];
}

/**
 * Stage 3a §8.7 (P2) — habitat effects. Not in the contract yet (proposed for `FxSystem`); reach them as
 * `ctx.fx as FxSystemEx`. Each returns a handle; all are emissive-only (no light-pool slot) and updated by fx.update.
 *   viewport  — the sea behind a big pane (2 draw calls)                     → `setState('calm' | 'cold' | 'dark')`
 *   falls     — a falling-water sheet with mist at its foot (1 draw call)     → `setFlow(0…1, s)`
 *   pool      — underwater glow, foam, reflected caustics (1 draw call)       → `setFlow`, `setGlow`
 *   lampGrid  — daylight ceiling panels (1 draw call) + linked lights/fixtures → `setState(state, { wave, flicker })`
 */
export interface FxHabitat {
  viewport(o: ViewportOpts): ViewportHandle;
  falls(o: FallsOpts): FallsHandle;
  pool(o: PoolOpts): PoolHandle;
  lampGrid(o: LampGridOpts): LampGridHandle;
}
/** Stage 3c §8.12 (W6) — enemy fire and level-5 helpers; reach them as `ctx.fx as FxSystemEx`. */
export interface TracerOpts {
  /** Hue (default the player's carbine tracer, HDR (6, 3.6, 1.6)). Components <= 1 are scaled to the tracer's HDR
   *  brightness (x 6 / max component); a THREE.Color with components > 1 is used as HDR as it is. */
  color?: THREE.ColorRepresentation;
  /** m/s (default 170; it slows to 0.4 x within ~4 m of the eye so a close miss is seen passing). */
  speed?: number;
}
export interface MuzzleOpts {
  /** Flash size / tongue length (default 'carbine'). */
  kind?: MuzzleKind;
  /** The muzzle light (default true): ONE keyed light level-wide, 4.5 m, re-triggered through a burst without a dip. */
  light?: boolean;
  /** Size multiplier (default 1). */
  scale?: number;
  /** Gun-smoke wisp (default true). */
  smoke?: boolean;
}
export interface FxCombat {
  /** An enemy round: a pooled streak from `from` (the muzzle) to `to` (where the round ends). No light, no draw call per shot. */
  tracer(from: THREE.Vector3, to: THREE.Vector3, o?: TracerOpts): void;
  /** An enemy muzzle flash at `point` along `dir` (the barrel): additive star + tongue, one frame full, + the keyed light. */
  muzzle(point: THREE.Vector3, dir: THREE.Vector3, o?: MuzzleOpts): void;
  /** A wet floor patch (W5's `wet_steel` overlay) inscribed in `box`'s plan, on `box.min.y`; registered (D23). */
  wetPatch(box: THREE.Box3, rooms: readonly string[], o?: WetPatchOpts): WetPatchHandle;
  /** The wet patch under a foot point, or null (audio's `wet` footsteps). */
  wetAt(p: THREE.Vector3): WetPatchHandle | null;
  /** A bulb / caged lamp popping: a white flash (one light, 0.07 s), sparks and glass falling from `point`. */
  bulbPop(point: THREE.Vector3, o?: { light?: boolean }): void;
  /** Dust kicked up along the floor where a falling object lands (`size` = the object's footprint, m). No light. */
  dustFall(point: THREE.Vector3, o?: { size?: number; color?: THREE.ColorRepresentation }): void;
  /** Grit and dust sifting down from the ceiling over `box`'s plan (hull groan, an impact overhead). No light. */
  dustSift(box: THREE.Box3, o?: { amount?: number }): void;
}
/** Stage 3d §8.6 (W6): the moon pool's well (well.ts) + wakes, splashes, the ram spray (trunk.ts). */
export interface FxWater extends FxTrunk {
  /** The well (registered with its surface rectangle as the only aperture). */
  well(o: WellOpts): WellHandle;
}
export type FxSystemEx = FxSystem & FxHabitat & FxVolumesApi & FxCombat & FxWater & { stats(): FxStats; clearDecals(): void; decalList(): ReturnType<Decals['debugList']> };

export async function createFx(ctx: GameContext): Promise<FxSystemEx> {
  const root = new THREE.Group();
  root.name = 'fx';
  ctx.scene.add(root);

  const pixelScale = { value: 600 };
  const streaks = new Streaks(4096, pixelScale);
  const atlas = createPuffAtlas(256);
  const puffs = new Puffs(1536, atlas, streaks.planes);
  const flashes = new Flashes(ctx.render.lights, 5);
  const decals = new Decals(ctx.materials);
  const arcs = new Arcs(pixelScale);
  const debris = new Debris(ctx.materials, ctx.scene);
  const tracers = new EnemyTracers();
  const muzzles = new MuzzleFlashes();
  root.add(puffs.mesh, streaks.mesh, arcs.mesh, decals.root, debris.root, tracers.mesh, muzzles.mesh);
  // warm-up: everything visible for render.prepare()/first frame so shaders compile at load
  decals.warm(true); debris.warm(true); arcs.mesh.visible = true;
  let warmed = false;

  streaks.gravity = ctx.physics.gravity * 0.55; // sparks / droplets read better slightly floaty vs. player gravity

  const qmul = () => QMUL[ctx.render?.quality ?? 'high'] ?? 1;

  // ── collision helpers
  /** Floor plane below p (one raycast). Returns plane index or -1. */
  function floorPlane(p: THREE.Vector3, maxDist = 8): number {
    _q.copy(p); _q.y += 0.05;
    const hit = ctx.physics.raycastSolid(_q, _down, maxDist); // stage 3d S5: water is never a floor
    if (hit) return streaks.planes.add(hit.normal.x, hit.normal.y, hit.normal.z, hit.point.x, hit.point.y, hit.point.z);
    if (p.y > -0.01) return streaks.planes.add(0, 1, 0, 0, 0, 0); // main floor fallback (y = 0)
    return -1;
  }

  // ── REVISION 5.2: persistent decals on moving things
  // A decal on a dynamic blocker (door leaf) is snapped onto the owner's real meshes and rides along with it;
  // 'transient' owners (wreck boxes, hanging loads, tunnel arms) get none; registered movers (parts whose
  // surface coincides with a static collider) catch decals within 4 cm of their meshes. Everything else is
  // static world exactly as before.
  const _rc = new THREE.Raycaster();
  _rc.layers.enableAll(); // (stage 3b B6: a mesh the level's view cull set aside — layer 30 — is still a surface to snap to)
  const _hits: THREE.Intersection[] = [];
  const _sp = new THREE.Vector3(), _sn = new THREE.Vector3(), _mb = new THREE.Box3();
  /** Ray along -normal from `front` m off the point to `back` m behind it onto obj's visible meshes → _sp / _sn. */
  function snap(obj: THREE.Object3D, point: THREE.Vector3, normal: THREE.Vector3, front: number, back: number): boolean {
    _rc.ray.origin.copy(point).addScaledVector(normal, front);
    _rc.ray.direction.copy(normal).negate();
    _rc.near = 0; _rc.far = front + back;
    _hits.length = 0;
    obj.updateWorldMatrix(true, true);
    _rc.intersectObject(obj, true, _hits);
    for (const h of _hits) {
      const m = h.object as THREE.Mesh;
      if (!m.isMesh || !m.visible) continue;
      _sp.copy(h.point);
      if (h.face) _sn.copy(h.face.normal).transformDirection(m.matrixWorld); else _sn.copy(normal);
      if (_sn.dot(normal) < 0) _sn.negate();
      if (_sn.dot(normal) < 0.5) _sn.copy(normal); // grazing facet (bevel, tooth edge): keep the hit normal
      return true;
    }
    return false;
  }
  /**
   * Place a persistent decal. `owner`: what the surface belongs to when the caller knows (ray hit on a dynamic
   * box); `lookup`: ask physics when it does not (false for bullet hits on the static BVH: those are static).
   */
  function put(name: DecalName, point: THREE.Vector3, normal: THREE.Vector3, size: number, roll?: number, owner?: HitOwner, lookup = true) {
    const fromLookup = owner === undefined && lookup;
    const o = owner ?? (lookup ? ctx.physics.ownerAt?.(point) : undefined);
    if (o === 'transient') return;
    if (o) {
      if (snap(o, point, normal, 0.03, 0.3)) { decals.place(name, _sp, _sn, size, roll, undefined, o); return; }
      // nothing of the owner behind the blocker face (gap of a closing door, edge of a box): no decal —
      // unless a floor / ceiling decal merely touched a blocker's foot, then it is the static floor's
      if (!fromLookup || Math.abs(normal.y) < 0.7) return;
    } else {
      const mv = ctx.physics.movers;
      if (mv) for (let i = 0; i < mv.length; i++) {
        const m = mv[i];
        _mb.setFromObject(m).expandByScalar(0.05);
        if (!_mb.containsPoint(point)) continue;
        if (snap(m, point, normal, 0.04, 0.04)) { decals.place(name, _sp, _sn, size, roll, undefined, m); return; }
      }
    }
    decals.place(name, point, normal, size, roll);
  }

  // ── decal rate limiting (token buckets)
  let fluidTokens = 4;

  streaks.onLand = (type, x, y, z, nx, ny, nz, speed) => {
    const S = streaks.s;
    if (type === ST.SPARK) {
      // secondary mini sparks on first hot bounce
      if (Math.random() > 0.55) return;
      const pl = streaks.hitPlane;
      _n.set(nx, ny, nz); basis(_n);
      const k = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < k; i++) {
        resetStreak(ST.MINI);
        cone(_n, 1.2);
        const sp = speed * r(0.2, 0.45);
        S.px = x; S.py = y; S.pz = z; S.vx = _d.x * sp; S.vy = _d.y * sp; S.vz = _d.z * sp;
        S.life = r(0.12, 0.3); S.size = r(0.0028, 0.0045); S.heat = r(0.6, 0.85); S.drag = 1.5; S.rest = 0.3;
        S.planeA = pl;
        streaks.spawn();
      }
      return;
    }
    if (type === ST.DROP) {
      const pl = streaks.hitPlane;
      const k = 3 + ((Math.random() * 4) | 0);
      for (let i = 0; i < k; i++) {
        resetStreak(ST.SPLASH);
        const a = Math.random() * Math.PI * 2, lat = r(0.2, 0.7);
        S.px = x; S.py = y + 0.004; S.pz = z;
        S.vx = Math.cos(a) * lat; S.vy = r(0.6, 1.4); S.vz = Math.sin(a) * lat;
        S.life = 0.6; S.size = r(0.0016, 0.003); S.r = 0.3; S.g = 0.34; S.b = 0.36; S.alpha = 0.9;
        S.planeA = pl;
        streaks.spawn();
      }
      return;
    }
    if (type === ST.OIL || type === ST.BLOOD) {
      if (fluidTokens < 1 || speed < 0.5) return;
      fluidTokens -= 1;
      _p.set(x, y, z); _n.set(nx, ny, nz);
      const vertical = Math.abs(ny) < 0.5;
      const name: DecalName = type === ST.BLOOD ? (vertical ? 'blood_smear' : 'blood_splat') : (vertical ? 'oil_drip' : 'oil_stain');
      put(name, _p, _n, vertical ? r(0.22, 0.4) : r(0.1, 0.28), vertical ? NaN : Math.random() * 6.283);
    }
  };

  function resetStreak(type: number) {
    const S = streaks.s;
    S.type = type; S.vx = S.vy = S.vz = 0; S.life = 1; S.size = 0.006; S.r = S.g = S.b = 1; S.alpha = 1;
    S.drag = 0.5; S.grav = 1; S.rest = 0.3; S.heat = 1; S.planeA = -1; S.planeB = -1; S.age0 = 0;
  }
  function resetPuff(shape: number) {
    const P = puffs.s;
    P.shape = shape; P.vx = P.vy = P.vz = 0; P.delay = 0; P.life = 1; P.s0 = 0.1; P.s1 = 0.5;
    P.rot = Math.random() * 6.283; P.rotV = r(-0.6, 0.6); P.alpha = 0.4; P.emit = 0; P.emitDecay = 3;
    P.r = P.g = P.b = 0.5; P.drag = 1; P.buoy = 0; P.er0 = 0; P.er1 = 0.5; P.phase = 0.3; P.fadeIn = 0.12; P.grow = 2.2; P.fadePow = 1.3; P.planeA = -1; P.planeB = -1;
  }

  /** Hot point glow (additive flare). */
  function glow(p: THREE.Vector3, size: number, emit: number, life: number, cr: number, cg: number, cb: number) {
    resetPuff(SHAPE.GLOW);
    const P = puffs.s;
    P.px = p.x; P.py = p.y; P.pz = p.z; P.s0 = size; P.s1 = size * 1.3; P.life = life; P.emit = emit;
    P.r = cr; P.g = cg; P.b = cb; P.fadeIn = 0.01; P.rotV = 0;
    puffs.spawn();
  }

  // ── sparks
  function sparksImpl(point: THREE.Vector3, normal: THREE.Vector3, count: number, speed: number, surfacePlane: boolean, spread = 1.15, floor = -2) {
    _n.copy(normal);
    if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0); else _n.normalize();
    basis(_n);
    const pa = surfacePlane ? streaks.planes.add(_n.x, _n.y, _n.z, point.x, point.y, point.z) : -1;
    const pb = floor !== -2 ? floor : (surfacePlane && _n.y > 0.7 ? -1 : floorPlane(point));
    const n = Math.max(1, Math.round(count * qmul()));
    const S = streaks.s;
    for (let i = 0; i < n; i++) {
      resetStreak(ST.SPARK);
      cone(_n, spread);
      const sp = speed * (0.2 + 0.8 * Math.pow(Math.random(), 0.7));
      const off = Math.random() * 0.01;
      S.px = point.x + _n.x * 0.01 + _d.x * off; S.py = point.y + _n.y * 0.01 + _d.y * off; S.pz = point.z + _n.z * 0.01 + _d.z * off;
      S.vx = _d.x * sp; S.vy = _d.y * sp; S.vz = _d.z * sp;
      S.life = r(0.3, 1.0) * (0.6 + 0.4 * sp / Math.max(speed, 0.01));
      S.size = r(0.0045, 0.0085);
      S.heat = r(0.8, 1.0);
      S.drag = r(0.9, 2.0);
      S.rest = r(0.3, 0.5);
      S.planeA = pa; S.planeB = pb;
      streaks.spawn();
    }
    // a couple of slow fat embers that linger
    for (let i = 0; i < Math.min(3, n >> 3); i++) {
      resetStreak(ST.SPARK);
      cone(_n, 0.9);
      const sp = speed * r(0.1, 0.3);
      S.px = point.x; S.py = point.y; S.pz = point.z;
      S.vx = _d.x * sp; S.vy = _d.y * sp + 0.5; S.vz = _d.z * sp;
      S.life = r(0.8, 1.6); S.size = r(0.008, 0.012); S.heat = 0.75; S.drag = 2.5; S.grav = 0.6; S.rest = 0.25;
      S.planeA = pa; S.planeB = pb;
      streaks.spawn();
    }
    _p.copy(point).addScaledVector(_n, 0.02);
    glow(_p, 0.05 + 0.004 * Math.min(count, 40), 6, 0.08, 1.0, 0.55, 0.2);
  }

  // ── smoke
  function smokeImpl(point: THREE.Vector3, count: number, size: number, color: THREE.Color, rise: number, life: number, alpha = 0.32, spread = 1, vel: THREE.Vector3 | null = null, velAmt = 0, pa = -1, pb = -1) {
    const n = Math.max(1, Math.round(count * Math.min(1, qmul() + 0.2)));
    const P = puffs.s;
    for (let i = 0; i < n; i++) {
      resetPuff(SHAPE.SMOKE);
      P.px = point.x + (Math.random() - 0.5) * size * 0.5 * spread;
      P.py = point.y + (Math.random() - 0.5) * size * 0.4 * spread;
      P.pz = point.z + (Math.random() - 0.5) * size * 0.5 * spread;
      P.vx = (Math.random() - 0.5) * size * 0.5; P.vy = rise * r(0.3, 0.7); P.vz = (Math.random() - 0.5) * size * 0.5;
      if (vel) { const k = velAmt * r(0.4, 1.2); P.vx += vel.x * k; P.vy += vel.y * k; P.vz += vel.z * k; }
      P.life = life * r(0.7, 1.2); P.s0 = size * r(0.3, 0.5); P.s1 = size * r(1.1, 1.6);
      P.alpha = alpha * r(0.7, 1.1); P.drag = vel ? 3.5 : 1.2; P.buoy = rise * 0.25;
      const v = r(0.85, 1.1);
      P.r = color.r * v; P.g = color.g * v; P.b = color.b * v;
      P.er0 = 0.05; P.er1 = 0.6; P.phase = 0.3; P.fadeIn = 0.08;
      P.planeA = pa; P.planeB = pb;
      puffs.spawn();
    }
  }

  /** Directional impact dust: a fast cone of small eroding puffs that spreads and slows. */
  function dustBurst(point: THREE.Vector3, n: THREE.Vector3, count: number, size: number, color: THREE.Color, alpha: number, speed: number, pa: number) {
    basis(n);
    const P = puffs.s;
    const k = Math.max(1, Math.round(count * Math.min(1, qmul() + 0.3)));
    for (let i = 0; i < k; i++) {
      resetPuff(SHAPE.SMOKE);
      cone(n, 0.5);
      const sp = speed * r(0.3, 1.0);
      P.px = point.x + n.x * 0.03; P.py = point.y + n.y * 0.03; P.pz = point.z + n.z * 0.03;
      P.vx = _d.x * sp; P.vy = _d.y * sp + 0.1; P.vz = _d.z * sp;
      P.life = r(0.8, 1.6); P.s0 = size * 0.12; P.s1 = size * r(0.7, 1.2); P.grow = 1.6;
      P.alpha = alpha * r(0.6, 1); P.fadePow = 1.8; P.drag = r(4, 6); P.buoy = 0.08;
      const v = r(0.85, 1.1);
      P.r = color.r * v; P.g = color.g * v; P.b = color.b * v;
      P.er0 = 0.15; P.er1 = 0.8; P.phase = 0.35; P.fadeIn = 0.04; P.planeA = pa;
      puffs.spawn();
    }
  }

  // ── fluid
  function fluidImpl(point: THREE.Vector3, direction: THREE.Vector3, count: number, blood: boolean) {
    _n.copy(direction);
    if (_n.lengthSq() < 1e-8) _n.set(0, -1, 0); else _n.normalize();
    _q.copy(point).addScaledVector(_n, 0.03); // don't hit the surface we start on
    const hit = ctx.physics.raycast(_q, _n, 5);
    const pa = hit ? streaks.planes.add(hit.normal.x, hit.normal.y, hit.normal.z, hit.point.x, hit.point.y, hit.point.z) : -1;
    const pb = hit && hit.normal.y > 0.7 ? -1 : floorPlane(point);
    basis(_n);
    const n = Math.max(1, Math.round(count * Math.min(1, qmul() + 0.2)));
    const S = streaks.s;
    fluidTokens = Math.min(fluidTokens + 1, 5);
    for (let i = 0; i < n; i++) {
      resetStreak(blood ? ST.BLOOD : ST.OIL);
      cone(_n, 0.55);
      const sp = r(1.2, 4.5);
      S.px = point.x; S.py = point.y; S.pz = point.z;
      S.vx = _d.x * sp; S.vy = _d.y * sp + r(0, 1); S.vz = _d.z * sp;
      S.life = 2.5; S.size = r(0.005, 0.014);
      if (blood) { S.r = 0.22; S.g = 0.012; S.b = 0.01; } else { S.r = 0.022; S.g = 0.018; S.b = 0.014; }
      S.drag = 0.4; S.planeA = pa; S.planeB = pb;
      streaks.spawn();
    }
    // fine mist
    _col.setRGB(blood ? 0.2 : 0.05, blood ? 0.02 : 0.045, blood ? 0.02 : 0.04);
    smokeImpl(point, 2, 0.12, _col, 0.05, 0.5, 0.28, 0.5, _n, 1.2, pa);
  }

  // ── impacts by surface
  let flashBudget = 1;
  const _dust = new THREE.Color();
  function impact(point: THREE.Vector3, normal: THREE.Vector3, surface: Surface, owner?: HitOwner) {
    _n.copy(normal).normalize();
    const S = streaks.s;
    const sp = streaks.planes.add(_n.x, _n.y, _n.z, point.x, point.y, point.z);
    const spawnChips = (k: number, cr: number, cg: number, cb: number, glass: boolean) => {
      basis(_n);
      const pa = sp;
      const pb = _n.y > 0.7 ? -1 : floorPlane(point);
      for (let i = 0; i < k; i++) {
        resetStreak(glass ? ST.GLASS : ST.CHIP);
        cone(_n, 0.9);
        const sp = r(1.5, 5);
        S.px = point.x + _n.x * 0.01; S.py = point.y + _n.y * 0.01; S.pz = point.z + _n.z * 0.01;
        S.vx = _d.x * sp; S.vy = _d.y * sp; S.vz = _d.z * sp;
        S.life = r(0.6, 1.4); S.size = r(0.003, 0.007); S.r = cr; S.g = cg; S.b = cb; S.drag = 0.8; S.rest = 0.3;
        S.planeA = pa; S.planeB = pb;
        streaks.spawn();
      }
    };
    switch (surface) {
      case 'metal':
      case 'robot': {
        sparksImpl(point, _n, r(8, 16), r(4.5, 7.5), true, 1.05);
        put('bullet_metal', point, normal, r(0.06, 0.09), undefined, owner, false);
        _dust.setRGB(0.42, 0.42, 0.43);
        _n.copy(normal).normalize();
        dustBurst(point, _n, 3, 0.22, _dust, 0.22, 2.2, sp);
        if (surface === 'robot') fluidImpl(point, normal, 3, false);
        if (flashBudget >= 1) { flashBudget = 0; _p.copy(point).addScaledVector(normal, 0.1); impactLight(_p, point); }
        else pendingImpact(point);
        break;
      }
      case 'concrete': {
        put('bullet_concrete', point, normal, r(0.08, 0.12), undefined, owner, false);
        _dust.setRGB(0.5, 0.47, 0.43);
        dustBurst(point, _n, 6, 0.35, _dust, 0.42, 3.2, sp);
        smokeImpl(point, 1, 0.3, _dust, 0.1, 2.2, 0.15, 0.5, _n, 0.5, sp);
        _n.copy(normal).normalize();
        spawnChips(6, 0.35, 0.33, 0.3, false);
        if (Math.random() < 0.35) sparksImpl(point, _n, 2, 4, true, 0.8);
        break;
      }
      case 'glass': {
        // (B9: a pale crazed star — the dark pit was invisible on every dark pane)
        put(GLASS_STAR, point, normal, r(0.12, 0.18), Math.random() * Math.PI * 2, owner, false);
        spawnChips(10, 0.55, 0.62, 0.65, true);
        _dust.setRGB(0.55, 0.58, 0.6);
        dustBurst(point, _n, 2, 0.15, _dust, 0.12, 1.5, sp);
        break;
      }
      case 'rubber': {
        put('bullet_concrete', point, normal, r(0.05, 0.07), undefined, owner, false);
        _dust.setRGB(0.12, 0.12, 0.12);
        dustBurst(point, _n, 3, 0.18, _dust, 0.3, 1.8, sp);
        spawnChips(3, 0.05, 0.05, 0.05, false);
        break;
      }
      case 'flesh': {
        put('blood_splat', point, normal, r(0.12, 0.25), undefined, owner, false);
        fluidImpl(point, normal, 6, true);
        break;
      }
      // stage 3d (W6): 'water' — no decal and no splash here: the shooter calls fx.splash (player weapons / enemy hitscan)
    }
  }

  ctx.events.on('bullet:impact', (e) => impact(e.point, e.normal, e.surface, e.owner));

  // ── stage 3c (W6): enemy rounds — their end points (this frame), impacts waiting for the frame's verdict
  let fxClock = 0;
  const ENDS = 24;
  const ends = new Float32Array(ENDS * 4); // x y z t
  let endNext = 0;
  for (let i = 0; i < ENDS; i++) ends[i * 4 + 3] = -1e9;
  const markEnd = (p: THREE.Vector3) => { const o = endNext * 4; ends[o] = p.x; ends[o + 1] = p.y; ends[o + 2] = p.z; ends[o + 3] = fxClock; endNext = (endNext + 1) % ENDS; };
  const isEnemyEnd = (x: number, y: number, z: number) => {
    for (let i = 0; i < ENDS; i++) {
      const o = i * 4;
      if (fxClock - ends[o + 3] > 0.05) continue;
      const dx = ends[o] - x, dy = ends[o + 1] - y, dz = ends[o + 2] - z;
      if (dx * dx + dy * dy + dz * dz < 0.3 * 0.3) return true;
    }
    return false;
  };
  ctx.events.on('enemy:fired', (e) => { if (!e.hit) markEnd(e.point); });
  // impacts of this frame: [x y z, light?, lx ly lz] — resolved in update (the enemy's `enemy:fired` may come after)
  const PEND = 8;
  const pend = new Float32Array(PEND * 7);
  let nPend = 0;
  function impactLight(lp: THREE.Vector3, hit: THREE.Vector3) {
    if (nPend >= PEND) return;
    const o = nPend++ * 7;
    pend[o] = hit.x; pend[o + 1] = hit.y; pend[o + 2] = hit.z; pend[o + 3] = 1; pend[o + 4] = lp.x; pend[o + 5] = lp.y; pend[o + 6] = lp.z;
  }
  function pendingImpact(hit: THREE.Vector3) {
    if (nPend >= PEND) return;
    const o = nPend++ * 7;
    pend[o] = hit.x; pend[o + 1] = hit.y; pend[o + 2] = hit.z; pend[o + 3] = 0;
  }
  function resolveImpacts() {
    for (let i = 0; i < nPend; i++) {
      const o = i * 7;
      _p.set(pend[o], pend[o + 1], pend[o + 2]);
      if (isEnemyEnd(_p.x, _p.y, _p.z)) {
        // an enemy round on steel: no light — a hotter, longer emissive glow marks the spot in the dark
        glow(_p, 0.11, 9, 0.09, 1.0, 0.58, 0.24);
        if (pend[o + 3]) flashBudget = 1; // (the budget it took was for a light that did not fire)
        continue;
      }
      if (pend[o + 3]) { _q.set(pend[o + 4], pend[o + 5], pend[o + 6]); flashes.fire(_q, 0xffb070, 2.5, 0.06, 3); }
    }
    nPend = 0;
  }
  const _tc = new THREE.Color();
  const _mz = new THREE.Vector3(), _md = new THREE.Vector3();
  let muzzleLast = -10;

  // ── arcs
  const arcTick = (s: ArcSlot, dt: number) => {
    // light roams along the bolt
    _p.lerpVectors(s.a, s.b, Math.random());
    flashes.move(s.light, _p);
    s.sparkTimer -= dt;
    if (s.sparkTimer <= 0) {
      s.sparkTimer = r(0.06, 0.22);
      const end = Math.random() < 0.5 ? s.a : s.b, other = end === s.a ? s.b : s.a;
      _q.subVectors(end, other).normalize();
      sparksImpl(end, _q, r(3, 9), r(2.5, 5), false, 1.4);
      glow(end, 0.12, 5, 0.06, 0.5, 0.8, 1.4);
    }
  };

  // ── emitters
  const emitters = new Emitters({
    ctx, streaks, puffs, resetStreak, resetPuff, sparks: sparksImpl, glow, floorPlane,
    flash: (p, c, i, d, dist) => { flashes.fire(p, c, i, d, dist); },
    arc: (a, b, d) => fx.arc(a, b, d),
    decal: (name, p, n, size) => put(name, p, n, size),
    qmul,
  });

  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();

  // ── stage 3a habitat effects (P2)
  const habitat = new THREE.Group();
  habitat.name = 'fx:habitat';
  root.add(habitat);
  const viewports: ViewportHandle[] = [];
  const fallsList: FallsHandle[] = [];
  const pools: PoolHandle[] = [];
  const grids: LampGridHandle[] = [];
  const quality = (): Quality => ctx.render?.quality ?? 'high';
  const drop = <T>(list: T[], h: T) => { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); };
  const camWorld = new THREE.Vector3();
  /** Waterfall foot mist: soft, slow, low, short-lived (shared puffs, lit like smoke). */
  const mist = (p: THREE.Vector3, v: THREE.Vector3, size: number, alpha: number) => {
    resetPuff(SHAPE.SMOKE);
    const P = puffs.s;
    P.px = p.x; P.py = p.y; P.pz = p.z; P.vx = v.x; P.vy = v.y; P.vz = v.z;
    P.life = r(1.6, 2.8); P.s0 = size * 0.4; P.s1 = size * r(1.6, 2.4); P.alpha = alpha;
    P.r = P.g = P.b = r(0.78, 0.9); P.drag = 1.6; P.buoy = 0.05; P.phase = 0.55; P.fadeIn = 0.25; P.fadePow = 1.6;
    puffs.spawn();
  };

  // ── stage 3b (W7): the volume registry, fog, breath, bounded emitter sets
  const registry = new VolumeRegistry(ctx);
  let nVol = 0;
  const fogs: FogHandle[] = [];
  const bounded = new Map<string, { box: THREE.Box3; sink: EmitterSink; group: THREE.Group }>();
  /** One particle set (own puffs + streaks, 1 draw call each while alive) per bounds box. */
  function boundedSet(o: EmitterOpts) {
    const b = o.bounds;
    const key = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => v.toFixed(2)).join(',');
    let set = bounded.get(key);
    if (set) return set;
    const group = new THREE.Group();
    group.name = `fx:bounded:${o.id ?? key}`;
    const p = new Puffs(512, atlas, streaks.planes);
    p.bounds = b.clone();
    const s = new Streaks(512, pixelScale);
    s.bounds = b.clone();
    s.gravity = streaks.gravity;
    // (3c W6) drips / tap streams in a bounded set splash on landing, inside the same set
    s.onLand = (type, x, y, z) => {
      if (type !== ST.DROP) return;
      const pl = s.hitPlane, S = s.s;
      const k = 1 + ((Math.random() * 3) | 0);
      for (let i = 0; i < k; i++) {
        const a = Math.random() * Math.PI * 2, lat = r(0.2, 0.6);
        S.type = ST.SPLASH; S.drag = 0.5; S.grav = 1; S.rest = 0.3; S.heat = 1; S.planeB = -1; S.age0 = 0;
        S.px = x; S.py = y + 0.004; S.pz = z;
        S.vx = Math.cos(a) * lat; S.vy = r(0.5, 1.2); S.vz = Math.sin(a) * lat;
        S.life = 0.5; S.size = r(0.0016, 0.0028); S.r = 0.3; S.g = 0.34; S.b = 0.36; S.alpha = 0.85;
        S.planeA = pl;
        s.spawn(S);
      }
    };
    p.mesh.name = 'fx:bounded:puffs'; s.mesh.name = 'fx:bounded:streaks';
    group.add(p.mesh, s.mesh);
    group.userData.fxCenter = b.getCenter(new THREE.Vector3());
    root.add(group);
    set = { box: b.clone(), sink: { puffs: p, streaks: s }, group };
    bounded.set(key, set);
    registry.register({ id: o.id ?? `emitters@${key}`, object: group, rooms: o.rooms ?? [], seenFrom: o.seenFrom });
    return set;
  }

  // breath (§8.6.2): a puff every 3.4 ± 0.6 s while the eye is in a zone (life 1.2 s, rise 0.1 m/s, alpha 0.18);
  // none while sprinting or within 1 s of a shot
  let breath: { puffs: Puffs; zones: (BreathHandle & { removed: boolean })[]; timer: number; burst: number } | null = null;
  let lastShot = -10, clock = 0;
  ctx.events.on('weapon:fired', () => { lastShot = clock; });
  const _fw = new THREE.Vector3(), _pv = new THREE.Vector3();
  function updateBreath(dt: number) {
    const b = breath!;
    clock += dt;
    b.puffs.update(dt, ctx.camera);
    const pl = ctx.player;
    if (!pl) return;
    let inside = false;
    for (const z of b.zones) if (z.enabled && z.box.containsPoint(pl.eye)) { inside = true; break; }
    if (!inside) { b.timer = Math.max(b.timer, 0.8); b.burst = 0; return; }
    b.timer -= dt;
    if (b.burst > 0) {
      b.burst -= dt;
      if (b.burst <= 0) exhale(0.7);
    }
    if (b.timer > 0) return;
    b.timer = r(2.8, 4.0);
    const v = pl.velocity;
    if (Math.hypot(v.x, v.z) > 4.4 || clock - lastShot < 1.0 || !pl.alive) return;
    exhale(1);
    b.burst = 0.16;
  }
  function exhale(k: number) {
    const pl = ctx.player!;
    _fw.copy(pl.forward);
    _pv.copy(pl.velocity).multiplyScalar(0.85);
    resetPuff(SHAPE.SMOKE);
    const P = puffs.s;
    // just in front of the mouth, low in the view, drifting out ahead (and along with a walking player)
    P.px = pl.eye.x + _fw.x * 0.4 + r(-0.02, 0.02); P.py = pl.eye.y - 0.09 + _fw.y * 0.4; P.pz = pl.eye.z + _fw.z * 0.4 + r(-0.02, 0.02);
    P.vx = _pv.x + _fw.x * 0.5; P.vy = 0.1 + _fw.y * 0.3; P.vz = _pv.z + _fw.z * 0.5;
    P.life = 1.2; P.s0 = 0.035; P.s1 = r(0.2, 0.26) * k; P.grow = 1.8;
    P.alpha = 0.18 * k; P.fadeIn = 0.12; P.fadePow = 1.4; P.drag = 1.1; P.buoy = 0.04;
    // (albedo > 1: condensate scatters forward and the particle light is compressed; alpha stays the plan's 0.18)
    P.r = P.g = 1.35; P.b = 1.42; P.er0 = 0.1; P.er1 = 0.7; P.phase = 0.5; P.rotV = r(-0.5, 0.5);
    breath!.puffs.spawn(P);
  }

  const wet = new WetPatches(root, ctx.materials, (spec) => registry.register(spec));
  // ── stage 3d (W6): the well, wakes, splashes, the ram spray
  const trunk = createTrunkFx({ ctx, root, streaks, puffs, atlas, pixelScale, resetStreak, resetPuff, register: (spec) => registry.register(spec), qmul });
  const wells: WellHandle[] = [];

  const fx = {
    // ── stage 3d (W6): water
    wake: trunk.wake,
    splash: trunk.splash,
    waterFx: trunk.waterFx,
    spray: trunk.spray,
    well(o: WellOpts): WellHandle {
      const h = createWell(o, habitat, quality);
      const b = o.box;
      const pane: FxAperture = { center: new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2), normal: new THREE.Vector3(0, 1, 0), width: b.max.x - b.min.x, height: b.max.z - b.min.z, up: new THREE.Vector3(0, 0, 1) };
      const reg = registry.register({ id: o.id ?? `well#${++nVol}`, object: h.object, rooms: o.rooms ?? [], seenFrom: o.seenFrom, apertures: [pane] });
      const remove = h.remove.bind(h);
      h.remove = () => { remove(); reg.remove(); drop(wells, h); };
      wells.push(h);
      return h;
    },

    // ── stage 3c (W6): enemy fire
    tracer(from: THREE.Vector3, to: THREE.Vector3, o: TracerOpts = {}) {
      let cr = 6, cg = 3.6, cb = 1.6;
      if (o.color !== undefined) {
        _tc.set(o.color);
        const m = Math.max(_tc.r, _tc.g, _tc.b, 1e-4);
        const k = m > 1 ? 1 : 6 / m;
        cr = _tc.r * k; cg = _tc.g * k; cb = _tc.b * k;
      }
      tracers.spawn(from, to, cr, cg, cb, o.speed ?? tracers.speed);
      markEnd(to);
    },

    muzzle(point: THREE.Vector3, dir: THREE.Vector3, o: MuzzleOpts = {}) {
      const kind = o.kind ?? 'carbine';
      _md.copy(dir); if (_md.lengthSq() < 1e-8) _md.set(0, 0, -1); else _md.normalize();
      muzzles.spawn(point, _md, kind, o.scale ?? 1);
      if (o.light !== false) {
        // one keyed light level-wide; a follow-up round within the burst re-triggers it from where it is (no strobe)
        _mz.copy(point).addScaledVector(_md, 0.12);
        const follow = fxClock - muzzleLast < 0.3;
        // first round: full (it is what shows him in the dark); follow-ups of the burst 65 %, all over a 55 % tail
        const peak = (kind === 'pistol' ? 24 : 30) * (follow ? 0.65 : 1);
        flashes.fireKeyed('muzzle', _mz, kind === 'pistol' ? 0xffb366 : 0xffa856, peak, 0.24, 5, 0.05, 0.55);
        muzzleLast = fxClock;
      }
      if (o.smoke !== false) {
        _col.setRGB(0.42, 0.42, 0.43);
        _p.copy(point).addScaledVector(_md, 0.1);
        smokeImpl(_p, 1, 0.16, _col, 0.15, 0.9, 0.1, 0.4, _md, 0.5);
      }
    },

    wetPatch(box: THREE.Box3, rooms: readonly string[], o?: WetPatchOpts): WetPatchHandle { return wet.add(box, rooms, o); },
    wetAt(p: THREE.Vector3): WetPatchHandle | null { return wet.patchAt(p); },

    bulbPop(point: THREE.Vector3, o: { light?: boolean } = {}) {
      if (o.light !== false) flashes.fire(point, 0xfff2dc, 14, 0.07, 5);
      glow(point, 0.28, 9, 0.06, 1.0, 0.92, 0.75);
      _n.set(0, -1, 0);
      sparksImpl(point, _n, 12, 2.2, false, 1.5);
      const pb = floorPlane(point);
      const S = streaks.s;
      const n = Math.max(6, Math.round(18 * Math.min(1, qmul() + 0.3)));
      for (let i = 0; i < n; i++) {
        resetStreak(ST.GLASS);
        const a = Math.random() * Math.PI * 2, lat = r(0.3, 1.6);
        S.px = point.x + Math.cos(a) * 0.03; S.py = point.y - 0.02; S.pz = point.z + Math.sin(a) * 0.03;
        S.vx = Math.cos(a) * lat; S.vy = r(-0.5, 0.9); S.vz = Math.sin(a) * lat;
        S.life = r(0.9, 1.6); S.size = r(0.003, 0.007); S.r = 0.7; S.g = 0.74; S.b = 0.76; S.drag = 0.6; S.rest = 0.25;
        S.planeA = pb;
        streaks.spawn();
      }
      _dust.setRGB(0.5, 0.5, 0.5);
      smokeImpl(point, 1, 0.2, _dust, 0.1, 1.2, 0.12, 0.5);
    },

    dustFall(point: THREE.Vector3, o: { size?: number; color?: THREE.ColorRepresentation } = {}) {
      const size = o.size ?? 0.6;
      _dust.set(o.color ?? 0xb3ada2);
      const pa = floorPlane(point, 3);
      const P = puffs.s;
      const big = Math.min(2, Math.sqrt(size / 0.6));
      const n = Math.max(4, Math.round(10 * Math.min(1, qmul() + 0.3) * big));
      for (let i = 0; i < n; i++) {
        resetPuff(SHAPE.SMOKE);
        const a = (i / n) * Math.PI * 2 + r(-0.3, 0.3), sp = r(0.6, 1.5) * big;
        P.px = point.x + Math.cos(a) * size * 0.3; P.py = point.y + 0.06; P.pz = point.z + Math.sin(a) * size * 0.3;
        P.vx = Math.cos(a) * sp; P.vy = r(0.05, 0.25); P.vz = Math.sin(a) * sp;
        P.life = r(1.6, 2.8); P.s0 = size * 0.2; P.s1 = size * r(0.9, 1.4); P.grow = 1.6;
        P.alpha = r(0.3, 0.45); P.fadePow = 1.6; P.drag = r(2.6, 3.6); P.buoy = 0.04;
        const v = r(0.85, 1.1);
        P.r = _dust.r * v; P.g = _dust.g * v; P.b = _dust.b * v;
        P.er0 = 0.15; P.er1 = 0.8; P.phase = 0.3; P.fadeIn = 0.05; P.planeA = pa;
        puffs.spawn();
      }
      const S = streaks.s;
      for (let i = 0; i < 6; i++) {
        resetStreak(ST.CHIP);
        const a = Math.random() * Math.PI * 2, sp = r(0.5, 1.8);
        S.px = point.x; S.py = point.y + 0.03; S.pz = point.z;
        S.vx = Math.cos(a) * sp; S.vy = r(0.6, 1.6); S.vz = Math.sin(a) * sp;
        S.life = r(0.5, 1.0); S.size = r(0.002, 0.004); S.r = _dust.r * 0.7; S.g = _dust.g * 0.7; S.b = _dust.b * 0.7; S.drag = 0.8;
        S.planeA = pa;
        streaks.spawn();
      }
    },

    dustSift(box: THREE.Box3, o: { amount?: number } = {}) {
      const amt = o.amount ?? 1;
      const area = Math.max(0.25, (box.max.x - box.min.x) * (box.max.z - box.min.z));
      _q.set((box.min.x + box.max.x) / 2, box.min.y + 0.2, (box.min.z + box.max.z) / 2);
      const pa = floorPlane(_q, 4);
      const S = streaks.s, P = puffs.s;
      const n = Math.min(80, Math.round(area * 6 * amt * Math.min(1, qmul() + 0.3)));
      for (let i = 0; i < n; i++) {
        resetStreak(ST.CHIP);
        S.px = r(box.min.x, box.max.x); S.py = box.max.y - 0.03; S.pz = r(box.min.z, box.max.z);
        S.vx = r(-0.05, 0.05); S.vy = r(-0.4, 0); S.vz = r(-0.05, 0.05);
        S.life = r(1.2, 2.6); S.size = r(0.002, 0.0038); S.r = 0.75; S.g = 0.72; S.b = 0.66; S.alpha = 1;
        S.drag = r(1.5, 3); S.grav = r(0.25, 0.5); S.planeA = pa;
        streaks.spawn();
      }
      const k = Math.min(12, Math.max(3, Math.round(area * 0.8 * amt)));
      for (let i = 0; i < k; i++) {
        resetPuff(SHAPE.SMOKE);
        P.px = r(box.min.x, box.max.x); P.py = box.max.y - 0.15; P.pz = r(box.min.z, box.max.z);
        P.vx = r(-0.04, 0.04); P.vy = r(-0.35, -0.15); P.vz = r(-0.04, 0.04);
        P.delay = r(0, 0.6); P.life = r(2.2, 3.4); P.s0 = 0.12; P.s1 = r(0.6, 1.0); P.grow = 1.3;
        P.alpha = r(0.16, 0.24); P.fadePow = 1.5; P.drag = 0.6; P.buoy = 0;
        P.r = 0.72; P.g = 0.7; P.b = 0.66; P.er0 = 0.2; P.er1 = 0.8; P.phase = 0.3; P.fadeIn = 0.25; P.planeA = pa;
        puffs.spawn();
      }
    },

    viewport(o: ViewportOpts): ViewportHandle {
      const h = createViewport(o, habitat, quality);
      const pane: FxAperture = { center: o.position.clone(), normal: o.normal.clone().setY(0).normalize(), width: o.width, height: o.height };
      const reg = registry.register({ id: o.id ?? `viewport#${++nVol}`, object: h.object, rooms: o.rooms ?? [], seenFrom: o.seenFrom, apertures: [pane] });
      const remove = h.remove.bind(h);
      h.remove = () => { remove(); reg.remove(); drop(viewports, h); };
      viewports.push(h);
      return h;
    },
    falls(o: FallsOpts): FallsHandle {
      const h = createFalls(o, habitat);
      const remove = h.remove.bind(h);
      h.remove = () => { remove(); drop(fallsList, h); };
      fallsList.push(h);
      return h;
    },
    pool(o: PoolOpts): PoolHandle {
      const h = createPool(o, habitat);
      const remove = h.remove.bind(h);
      h.remove = () => { remove(); drop(pools, h); };
      pools.push(h);
      return h;
    },
    lampGrid(o: LampGridOpts): LampGridHandle {
      const h = createLampGrid(o, habitat);
      const remove = h.remove.bind(h);
      h.remove = () => { remove(); drop(grids, h); };
      grids.push(h);
      return h;
    },

    sparks(point: THREE.Vector3, normal: THREE.Vector3, count = 20, speed = 6) {
      sparksImpl(point, normal, count, speed, true);
      if (count >= 12 && flashBudget >= 1) {
        flashBudget = 0;
        _p.copy(point).addScaledVector(normal, 0.1);
        flashes.fire(_p, 0xffb36a, Math.min(10, count * 0.18), 0.08, 4);
      }
    },

    smoke(point: THREE.Vector3, opts: { count?: number; size?: number; color?: THREE.ColorRepresentation; rise?: number; life?: number } = {}) {
      _col.set(opts.color ?? 0x8e8f90);
      smokeImpl(point, opts.count ?? 6, opts.size ?? 0.5, _col, opts.rise ?? 0.4, opts.life ?? 2.5, 0.32, 1, null, 0, floorPlane(point));
    },

    fluid(point: THREE.Vector3, direction: THREE.Vector3, count = 10) {
      fluidImpl(point, direction, count, false);
    },

    decal(name: DecalName, point: THREE.Vector3, normal: THREE.Vector3, size = 0.3, owner?: HitOwner) {
      const vertical = Math.abs(normal.y) < 0.5;
      const upright = vertical && (name === 'oil_drip' || name === 'blood_smear' || name === 'water_stain' || name === 'handprint');
      put(name, point, normal, size, upright ? NaN : Math.random() * Math.PI * 2, owner);
    },

    flash(point: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, duration: number, distance = 6) {
      flashes.fire(point, color, intensity, duration, distance);
    },

    arc(a: THREE.Vector3, b: THREE.Vector3, duration = 0.6) {
      const s = arcs.start(a, b, duration);
      _p.lerpVectors(a, b, 0.5);
      s.light = flashes.fire(_p, 0x8fd0ff, 7, duration, 6, 1);
      _q.subVectors(a, b).normalize();
      sparksImpl(a, _q, 12, 5, false, 1.3);
      _q.negate();
      sparksImpl(b, _q, 12, 5, false, 1.3);
    },

    explosion(point: THREE.Vector3, scale = 1) {
      const s = scale;
      _p.copy(point);
      // surroundings first: floor + nearest wall become collision planes, nearest surface gets the scorch
      let best: { point: THREE.Vector3; normal: THREE.Vector3; distance: number } | null = null;
      let floorPl = -1, wallPl = -1, ceilPl = -1, wallDist = Infinity;
      for (const dir of _dirs) {
        const h = ctx.physics.raycast(_p, dir, 3 * s);
        if (!h) continue;
        if (!best || h.distance < best.distance * (dir.y < 0 ? 1.4 : 1)) best = h;
        if (dir.y < 0) floorPl = streaks.planes.add(h.normal.x, h.normal.y, h.normal.z, h.point.x, h.point.y, h.point.z);
        else if (dir.y > 0) ceilPl = streaks.planes.add(h.normal.x, h.normal.y, h.normal.z, h.point.x, h.point.y, h.point.z);
        else if (dir.y === 0 && h.distance < wallDist) {
          wallDist = h.distance;
          wallPl = streaks.planes.add(h.normal.x, h.normal.y, h.normal.z, h.point.x, h.point.y, h.point.z);
        }
      }
      if (floorPl < 0 && _p.y > -0.01 && _p.y < 3 * s) floorPl = streaks.planes.add(0, 1, 0, 0, 0, 0);
      if (best && best.distance < 2.5 * s) put('scorch', best.point, best.normal, r(2.0, 2.6) * s);
      else if (_p.y < 2.5 * s && _p.y > -0.01) { _q.set(_p.x, 0, _p.z); put('scorch', _q, _up, 2.2 * s); }

      flashes.fire(_p, 0xff9248, 70 * s * s, 0.6 + 0.25 * s, 12 * s);
      glow(_p, 1.3 * s, 3.2, 0.14, 1.0, 0.6, 0.3);
      // shockwave
      resetPuff(SHAPE.RING);
      const P = puffs.s;
      P.px = _p.x; P.py = _p.y; P.pz = _p.z; P.s0 = 0.3 * s; P.s1 = 4.0 * s; P.life = 0.3; P.emit = 1.1;
      P.r = 1.0; P.g = 0.78; P.b = 0.55; P.fadeIn = 0.01; P.rotV = 0;
      puffs.spawn();
      // fireball: hot puffs that cool into thick smoke
      const nf = Math.round(28 * Math.min(1.5, s) * Math.min(1, qmul() + 0.3));
      for (let i = 0; i < nf; i++) {
        resetPuff(SHAPE.SMOKE);
        _d.set(Math.random() - 0.5, Math.random() * 0.8 - 0.2, Math.random() - 0.5).normalize();
        const sp = r(2, 6) * s;
        P.px = _p.x + _d.x * 0.15 * s; P.py = _p.y + _d.y * 0.15 * s; P.pz = _p.z + _d.z * 0.15 * s;
        P.vx = _d.x * sp; P.vy = _d.y * sp + 0.6; P.vz = _d.z * sp;
        P.life = r(1.8, 3.2) * Math.sqrt(s); P.s0 = r(0.15, 0.35) * s; P.s1 = r(0.7, 1.3) * s;
        P.alpha = r(0.55, 0.8); P.emit = r(2.0, 2.8); P.emitDecay = r(2.4, 3.6); P.delay = Math.random() * 0.06;
        P.r = P.g = P.b = r(0.06, 0.1); P.drag = 3.2; P.buoy = 0.9; P.er0 = 0; P.er1 = 0.55; P.phase = 0.2; P.fadeIn = 0.03;
        P.rotV = r(-1.5, 1.5); P.planeA = floorPl; P.planeB = wallPl;
        puffs.spawn();
      }
      // lingering smoke column
      for (let i = 0; i < Math.round(10 * Math.min(1.5, s)); i++) {
        resetPuff(SHAPE.SMOKE);
        P.px = _p.x + (Math.random() - 0.5) * s; P.py = _p.y + Math.random() * 0.4 * s; P.pz = _p.z + (Math.random() - 0.5) * s;
        P.vx = (Math.random() - 0.5) * 0.6 * s; P.vy = r(0.3, 0.9); P.vz = (Math.random() - 0.5) * 0.6 * s;
        P.delay = r(0.15, 0.6); P.life = r(4, 7); P.s0 = 0.5 * s; P.s1 = r(1.8, 2.6) * s; P.alpha = r(0.25, 0.4);
        P.r = P.g = P.b = r(0.12, 0.18); P.drag = 1; P.buoy = 0.25; P.er0 = 0.05; P.er1 = 0.6; P.fadeIn = 0.2;
        P.planeA = ceilPl >= 0 ? ceilPl : floorPl; P.planeB = wallPl;
        puffs.spawn();
      }
      // sparks everywhere
      _q.set(0, 1, 0);
      sparksImpl(_p, _q, 70 * s, 11 * Math.sqrt(s), false, Math.PI * 0.95, floorPl);
      // shards
      for (let i = 0; i < Math.round(4 * Math.min(2, s)); i++) {
        _d.set(Math.random() - 0.5, r(0.3, 1), Math.random() - 0.5).normalize().multiplyScalar(r(4, 9) * Math.sqrt(s));
        _q.copy(_p).addScaledVector(_d, 0.03);
        debris.spawnShard(_q, _d, r(5, 9));
      }
      // camera shake by distance
      const pl = ctx.player;
      if (pl && pl.shake) {
        const dist = pl.eye ? pl.eye.distanceTo(_p) : 10;
        pl.shake(Math.min(1, (1.3 * s) / (1 + dist * 0.3)));
      }
    },

    debris(point: THREE.Vector3, impulse: THREE.Vector3, meshes?: THREE.Object3D[], life = 6) {
      const mag = impulse.length();
      if (meshes && meshes.length) {
        for (const m of meshes) {
          _d.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(Math.max(1, mag * 0.5)).add(impulse);
          debris.spawnObject(m, _d, life);
        }
        return;
      }
      const n = 3 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) {
        _d.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(Math.max(1.5, mag * 0.5));
        _d.addScaledVector(impulse, r(0.6, 1.2));
        _q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.12).add(point);
        debris.spawnShard(_q, _d, life * r(0.8, 1.2));
      }
    },

    emitter(kind: EmitterKind, point: THREE.Vector3, direction?: THREE.Vector3, rate?: number, o?: EmitterOpts) {
      if (!o?.bounds) return emitters.add(kind, point, direction, rate);
      if (kind === 'sparks') console.warn('[fx] emitter: sparks cannot be bounded (lit streaks + flashes); the bounds are ignored');
      return emitters.add(kind, point, direction, rate, kind === 'sparks' ? undefined : boundedSet(o).sink, o.speed ?? 1, !!o.jet);
    },

    fog(o: FogOpts): FogHandle {
      const h = createFog(o, habitat, quality);
      const id = o.id ?? `fog#${++nVol}`;
      const regs = [registry.register({ id, object: h.mesh, rooms: o.rooms, seenFrom: o.seenFrom })];
      if (h.glints) regs.push(registry.register({ id: `${id}_glints`, object: h.glints, rooms: o.glintRooms ?? o.rooms, seenFrom: o.seenFrom }));
      const remove = h.remove.bind(h);
      h.remove = () => { remove(); for (const x of regs) x.remove(); drop(fogs, h); };
      fogs.push(h);
      return h;
    },

    breathZone(box: THREE.Box3, o: { rooms?: readonly string[]; id?: string } = {}): BreathHandle {
      if (!breath) {
        const p = new Puffs(24, atlas, streaks.planes);
        p.mesh.name = 'fx:breath';
        root.add(p.mesh);
        breath = { puffs: p, zones: [], timer: 1.5, burst: 0 };
      }
      const b = breath;
      // the breath set's one mesh serves every zone: each zone registers it (gated by the union of their rooms)
      b.puffs.mesh.userData.fxCenter = box.getCenter(new THREE.Vector3());
      const reg = registry.register({ id: o.id ?? `breath#${++nVol}`, object: b.puffs.mesh, rooms: o.rooms ?? [] });
      const z: BreathHandle & { removed: boolean } = {
        enabled: true, box: box.clone(), removed: false,
        remove() { z.removed = true; const i = b.zones.indexOf(z); if (i >= 0) b.zones.splice(i, 1); reg.remove(); },
      };
      b.zones.push(z);
      return z;
    },

    volume(spec: FxVolumeSpec): FxVolume { return registry.register(spec); },
    volumes(): readonly FxVolume[] { return registry.list; },
    debugVolumes(on: boolean) { registry.setDebug(on); },
    get volumesDebug() { return registry.debugging; },
    forceVolumes(on: boolean) { registry.setForced(on); },
    drawnRooms() { return registry.drawnRooms(); },

    update(dt: number) {
      if (!warmed) { warmed = true; decals.warm(false); debris.warm(false); arcs.mesh.visible = false; }
      decals.update();
      const cam = ctx.camera;
      const h = ctx.renderer?.domElement?.height || innerHeight;
      pixelScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5));
      fluidTokens = Math.min(5, fluidTokens + dt * 10);
      resolveImpacts();
      flashBudget = Math.min(1, flashBudget + dt * 12);

      cam.updateMatrixWorld();
      cam.getWorldPosition(flashes.cam);
      projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      emitters.update(dt, cam, frustum);

      arcs.update(dt, arcTick);
      flashes.update(dt);
      debris.update(dt, ctx.physics);
      for (let i = 0; i < fogs.length; i++) fogs[i].update(dt);
      for (const set of bounded.values()) { set.sink.streaks.update(dt); set.sink.puffs.update(dt, cam); }
      if (breath) updateBreath(dt);
      if (viewports.length || fallsList.length || pools.length || grids.length) {
        const q = quality();
        cam.getWorldPosition(camWorld);
        for (let i = 0; i < viewports.length; i++) viewports[i].update(dt, cam, pixelScale.value, q);
        for (let i = 0; i < fallsList.length; i++) fallsList[i].update(dt, camWorld, mist, qmul());
        for (let i = 0; i < pools.length; i++) pools[i].update(dt);
        for (let i = 0; i < grids.length; i++) grids[i].update(dt);
      }

      streaks.update(dt);
      puffs.update(dt, cam);
      tracers.update(dt, flashes.cam);
      muzzles.update(dt, cam, flashes.cam);
      for (let i = 0; i < wells.length; i++) wells[i].update(dt, pixelScale.value, quality());
      trunk.update(dt, cam);
      fxClock += dt;
      // D21: last, after every handle's own visibility — a volume is drawn only while one of its rooms is drawn
      registry.update();
    },

    stats(): FxStats {
      let nb = breath ? breath.puffs.count : 0;
      for (const set of bounded.values()) nb += set.sink.puffs.count + set.sink.streaks.count;
      return { streaks: streaks.count, puffs: puffs.count, debris: debris.activeCount, emitters: emitters.count, habitat: viewports.length + fallsList.length + pools.length + grids.length + fogs.length, volumes: registry.list.length, bounded: nb, tracers: tracers.count, muzzles: muzzles.count, wet: wet.count };
    },
    clearDecals() { decals.clear(); },
    /** Checks / debug: live decals with their anchors. */
    decalList() { return decals.debugList(); },
  };

  debris.onImpact = (p, n, speed) => {
    if (Math.random() < 0.3) sparksImpl(p, n, Math.min(6, speed), 2.5, true, 1.2);
    try { if (speed > 4 && Math.random() < 0.5) ctx.audio?.play('metal_clang', { position: p, volume: Math.min(0.5, speed * 0.06) }); } catch { /* audio optional */ }
  };

  return fx;
}
