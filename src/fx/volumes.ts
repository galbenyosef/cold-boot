/**
 * Stage 3b §8.6.5 (D21) — the fx-volume registry.
 *
 * Every glow / particle / fog volume that could be seen from a place it was not meant for registers here as
 * `{ id, object, rooms }`:
 *   - **gating**: the object is drawn only while one of `rooms` is drawn (the level's portal set, `roomVisible`);
 *     evaluated by fx.update every frame, after level.update. The gate only ever hides what is visible and shows
 *     again only what it hid itself, so an owner may still hide its volume (handles: `visible` / `enabled`).
 *   - **probe hide**: `render.prepare` (the load-time probe bake) and the progressive probe re-captures hide every
 *     registered object, so no reflection ever contains an fx volume.
 *   - **debug view**: `debugVolumes(true)` draws every registered volume in opaque unlit magenta, keeping the
 *     volume's own clipping (shader discards: the sea's pane clip, a particle's footprint) — what `check:fxleak`
 *     looks for.
 * Optional, for the leak check: `seenFrom` = further rooms whose view points may legitimately see the volume (through
 * an opening of a listed room: the tube's sea from chk through the open tube door); `apertures` = the only openings it
 * may be seen through at all (a viewport's pane: every visible pixel's ray must cross one).
 */
import * as THREE from 'three';
import type { GameContext } from '../core/types';

/** A rectangular opening (pane, door): centre, normal (either side), size; `up` defaults to world y. */
export interface FxAperture { center: THREE.Vector3; normal: THREE.Vector3; width: number; height: number; up?: THREE.Vector3 }

export interface FxVolumeSpec {
  id: string;
  object: THREE.Object3D;
  /** Drawn only while one of these rooms is drawn. Empty = the rooms whose box holds the object's bounds centre (resolved lazily). */
  rooms?: readonly string[];
  /** check:fxleak — rooms (besides `rooms`) whose view points may see it. */
  seenFrom?: readonly string[];
  /** check:fxleak — the only openings it may be seen through (every visible pixel's ray crosses one). */
  apertures?: readonly FxAperture[];
}

export interface FxVolume extends Readonly<Required<Pick<FxVolumeSpec, 'id' | 'object'>>> {
  readonly rooms: readonly string[];
  readonly seenFrom: readonly string[];
  readonly apertures: readonly FxAperture[];
  /** Is the gate holding it hidden right now? */
  readonly gated: boolean;
  /** Unregister (does not touch the object). */
  remove(): void;
}

/** Debug colour: linear HDR magenta (reads as saturated magenta after the post chain). */
export const DEBUG_RGB = new THREE.Color(2, 0, 2);

interface Entry extends FxVolume { rooms: string[]; seenFrom: string[]; apertures: FxAperture[]; gated: boolean; removed: boolean }

const _box = new THREE.Box3();
const _c = new THREE.Vector3();

export class VolumeRegistry {
  readonly list: Entry[] = [];
  private debugOn = false;
  /** check:fxleak's magenta mode is on (level view culling stands down so walls occlude as the portal graph says). */
  get debugging(): boolean { return this.debugOn; }
  private forced = false;
  private swapped = new Map<THREE.Mesh | THREE.Points, THREE.Material | THREE.Material[]>();
  private debugMats = new WeakMap<THREE.Material, THREE.Material>();
  private basic: THREE.MeshBasicMaterial | null = null;
  private points: THREE.PointsMaterial | null = null;
  /** Per room: a sample point that `roomVisible` attributes to that room (first-match), or null. */
  private samples: Map<string, [number, number] | null> | null = null;
  private samplesFor: unknown = null;

  constructor(private ctx: GameContext) {}

  register(s: FxVolumeSpec): FxVolume {
    if (this.list.some((e) => e.id === s.id && !e.removed)) console.warn(`[fx] volume "${s.id}" registered twice`);
    // one object, several registrations (the breath set serves every zone): one entry gated by the union of rooms
    const same = this.list.find((e) => e.object === s.object);
    if (same && same.rooms.length && s.rooms?.length) {
      for (const r of s.rooms) if (!same.rooms.includes(r)) same.rooms.push(r);
      for (const r of s.seenFrom ?? []) if (!same.seenFrom.includes(r)) same.seenFrom.push(r);
      return { ...same, remove() { /* the shared entry stays with its first owner */ } } as FxVolume;
    }
    const e: Entry = {
      id: s.id, object: s.object, rooms: [...(s.rooms ?? [])], seenFrom: [...(s.seenFrom ?? [])], apertures: [...(s.apertures ?? [])],
      gated: false, removed: false,
      remove: () => {
        if (e.removed) return;
        e.removed = true;
        if (e.gated) { e.object.visible = true; e.gated = false; }
        if (this.debugOn) this.restoreObject(e.object);
        const i = this.list.indexOf(e);
        if (i >= 0) this.list.splice(i, 1);
      },
    };
    this.list.push(e);
    if (this.debugOn) this.debugObject(e.object);
    return e;
  }

  // ── rooms

  private level() {
    return (this.ctx as Partial<GameContext>).level ?? null;
  }

  /** Sample points per room, matching the level's first-match room lookup (rooms may overlap in plan on two decks). */
  private ensureSamples(): Map<string, [number, number] | null> | null {
    const level = this.level();
    if (!level || !level.rooms?.length) return null;
    if (this.samples && this.samplesFor === level) return this.samples;
    const rooms = level.rooms;
    const indexAt = (x: number, z: number) => {
      for (let i = 0; i < rooms.length; i++) {
        const b = rooms[i].bounds;
        if (x > b.min.x + 0.05 && x < b.max.x - 0.05 && z > b.min.z + 0.05 && z < b.max.z - 0.05) return i;
      }
      return -1;
    };
    const m = new Map<string, [number, number] | null>();
    rooms.forEach((r, i) => {
      const b = r.bounds;
      let found: [number, number] | null = null;
      for (let n = 1; n <= 9 && !found; n += 2) {
        for (let a = 0; a < n && !found; a++) for (let c = 0; c < n && !found; c++) {
          const x = b.min.x + ((a + 0.5) / n) * (b.max.x - b.min.x), z = b.min.z + ((c + 0.5) / n) * (b.max.z - b.min.z);
          if (indexAt(x, z) === i) found = [x, z];
        }
      }
      if (!found) console.warn(`[fx] room "${r.id}" is covered by earlier rooms in plan: volumes listing it gate on nothing`);
      m.set(r.id, found);
    });
    this.samples = m;
    this.samplesFor = level;
    return m;
  }

  /** Is the room drawn this frame (the level's portal set; true when the level publishes no visibility)? */
  roomDrawn(id: string): boolean {
    const level = this.level();
    const rv = level?.root?.userData?.roomVisible as ((x: number, z: number) => boolean) | undefined;
    if (!rv) return true;
    const s = this.ensureSamples()?.get(id);
    if (s === undefined) return false;
    if (s === null) return false;
    return rv(s[0], s[1]);
  }

  /** The rooms drawn this frame (debug / check:fxleak). */
  drawnRooms(): string[] {
    const level = this.level();
    if (!level) return [];
    return level.rooms.filter((r) => this.roomDrawn(r.id)).map((r) => r.id);
  }

  private resolveRooms(e: Entry): void {
    if (e.rooms.length) return;
    const level = this.level();
    if (!level) return;
    const fc = e.object.userData.fxCenter as THREE.Vector3 | undefined;
    if (fc) _c.copy(fc);
    else {
      _box.setFromObject(e.object, true);
      if (_box.isEmpty()) e.object.getWorldPosition(_c); else _box.getCenter(_c);
    }
    const r = level.roomAt(_c);
    if (r) e.rooms.push(r.id);
    else console.warn(`[fx] volume "${e.id}" lists no rooms and stands in none: it is never gated`);
  }

  // ── gate

  /** Per frame (fx.update, after level.update). `force` (debug): draw every volume regardless of its rooms. */
  update(): void {
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (!e.rooms.length) this.resolveRooms(e);
      let drawn = this.forced || !e.rooms.length;
      for (let k = 0; !drawn && k < e.rooms.length; k++) drawn = this.roomDrawn(e.rooms[k]);
      if (!drawn) { if (e.object.visible) { e.object.visible = false; e.gated = true; } }
      else if (e.gated) { e.object.visible = true; e.gated = false; }
    }
  }

  /** check:fxleak — ignore the gate (every volume drawn wherever its owner shows it). */
  setForced(on: boolean): void { this.forced = on; this.update(); }

  /** Hide every registered object (probe captures); returns the restore function. */
  hideAll(): () => void {
    const hidden: THREE.Object3D[] = [];
    for (const e of this.list) if (e.object.visible) { e.object.visible = false; hidden.push(e.object); }
    return () => { for (const o of hidden) o.visible = true; };
  }

  // ── debug magenta

  setDebug(on: boolean): void {
    if (on === this.debugOn) return;
    this.debugOn = on;
    for (const e of this.list) { if (on) this.debugObject(e.object); else this.restoreObject(e.object); }
  }
  get debug(): boolean { return this.debugOn; }

  private debugObject(root: THREE.Object3D): void {
    root.traverse((o) => {
      const m = o as THREE.Mesh | THREE.Points;
      if (!(m as THREE.Mesh).isMesh && !(m as THREE.Points).isPoints) return;
      if (this.swapped.has(m)) return;
      this.swapped.set(m, m.material);
      m.material = Array.isArray(m.material) ? m.material.map((x) => this.debugMat(x, m)) : this.debugMat(m.material, m);
    });
  }

  private restoreObject(root: THREE.Object3D): void {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      const orig = this.swapped.get(m);
      if (orig) { m.material = orig; this.swapped.delete(m); }
    });
  }

  /**
   * Opaque magenta version of a material. Shader materials keep their own vertex stage and every discard (the
   * footprint of a particle, the sea's pane clip): their fragment shader is patched to write magenta wherever it
   * would have shown anything. Plain materials become a flat MeshBasic / Points material.
   */
  private debugMat(m: THREE.Material, obj: THREE.Mesh | THREE.Points): THREE.Material {
    const done = this.debugMats.get(m);
    if (done) return done;
    let out: THREE.Material;
    const sm = m as THREE.ShaderMaterial;
    if (sm.isShaderMaterial && !(sm as unknown as THREE.RawShaderMaterial).isRawShaderMaterial) {
      const c = sm.clone();
      c.uniforms = sm.uniforms; // shared: positions / time stay live
      const additive = sm.blending === THREE.AdditiveBlending;
      const premult = sm.blending === THREE.CustomBlending || sm.premultipliedAlpha;
      const cover = additive ? 'max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)) * max(gl_FragColor.a, 0.0)'
        : premult ? 'max(gl_FragColor.a, max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)))'
        : sm.transparent ? 'gl_FragColor.a' : '1.0';
      const rgb = `vec3(${DEBUG_RGB.r.toFixed(2)}, ${DEBUG_RGB.g.toFixed(2)}, ${DEBUG_RGB.b.toFixed(2)})`;
      const fs = sm.fragmentShader;
      const at = fs.lastIndexOf('}');
      c.fragmentShader = `${fs.slice(0, at)}  { float fxDbgCover = ${cover}; if (fxDbgCover < 0.003) discard; gl_FragColor = vec4(${rgb}, 1.0); }\n}\n`;
      c.transparent = false;
      c.blending = THREE.NormalBlending;
      c.depthWrite = true; // (fog stays as it was: the shader may read fogColor; magenta is written after it)
      c.name = `${sm.name || 'shader'}:debug`;
      out = c;
    } else if ((obj as THREE.Points).isPoints) {
      out = this.points ??= new THREE.PointsMaterial({ color: DEBUG_RGB, size: 3, sizeAttenuation: false, fog: false });
    } else {
      out = this.basic ??= new THREE.MeshBasicMaterial({ color: DEBUG_RGB, fog: false, side: THREE.DoubleSide, toneMapped: false });
    }
    this.debugMats.set(m, out);
    return out;
  }
}
