/**
 * Stage 3c §8.12.2 / §2.9 (W6) — wet floor patches: flat puddle-shaped overlays in W5's `wet_steel` material
 * (roughness 0.06, ripple normal, lit by the room's reflection probe; no screen-space reflection, no light).
 *
 * Every patch is a star-convex blob (irregular edge, no alpha needed) inscribed in its box's plan rectangle, lifted
 * 12 mm off the floor (clear of z-fighting at the sub bay's longest view; zfight's tolerance there is ≈ 8 mm).
 * Patches with the same room list share ONE mesh (merged at creation — load time only), so a room's puddles cost one
 * draw call; each mesh is a registered fx volume (D23): drawn only while one of its rooms is drawn, hidden from probe
 * bakes, magenta in `debugVolumes`. Footsteps on a patch use audio's `wet` variant (audio's side; `patchAt(p)` here).
 */
import * as THREE from 'three';
import type { MaterialLibrary, MaterialName } from '../core/types';
import type { FxVolume, FxVolumeSpec } from './volumes';

export interface WetPatchOpts {
  /** Registry id (default `wet:<rooms>`; the first patch of a room set names the shared mesh). */
  id?: string;
  /** Edge raggedness 0 … 1 (default 0.45). */
  ragged?: number;
  /** Seed for the outline (default: from the box). */
  seed?: number;
  /** check:fxleak — further rooms it may be seen from (through a door). */
  seenFrom?: readonly string[];
}

export interface WetPatchHandle {
  readonly box: THREE.Box3;
  readonly object: THREE.Mesh;
  /** Plan test with a 0.05 m margin (footsteps). */
  contains(p: THREE.Vector3): boolean;
  remove(): void;
}

const LIFT = 0.012;
const SEG = 30;

function rand(seed: number) {
  let s = (Math.floor(seed * 9301 + 49297) % 233280 + 233280) % 233280;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

interface Group { rooms: string[]; patches: Patch[]; mesh: THREE.Mesh; reg: FxVolume | null; id: string; seenFrom: string[] }
interface Patch { box: THREE.Box3; ragged: number; seed: number; handle: WetPatchHandle }

export class WetPatches {
  private groups = new Map<string, Group>();

  constructor(
    private root: THREE.Object3D,
    private materials: MaterialLibrary,
    private register: (s: FxVolumeSpec) => FxVolume,
  ) {}

  add(box: THREE.Box3, rooms: readonly string[], o: WetPatchOpts = {}): WetPatchHandle {
    const key = [...rooms].sort().join(',');
    let g = this.groups.get(key);
    if (!g) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material());
      mesh.name = `fx_wet:${key}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.renderOrder = 1;
      this.root.add(mesh);
      g = { rooms: [...rooms], patches: [], mesh, reg: null, id: o.id ?? `wet:${key}`, seenFrom: [...(o.seenFrom ?? [])] };
      this.groups.set(key, g);
    } else for (const r of o.seenFrom ?? []) {
      if (!g.seenFrom.includes(r)) g.seenFrom.push(r);
      const sf = g.reg?.seenFrom as string[] | undefined;
      if (sf && !sf.includes(r)) sf.push(r);
    }
    const grp = g;
    const b = box.clone();
    const handle: WetPatchHandle = {
      box: b, object: grp.mesh,
      contains: (p) => p.x > b.min.x - 0.05 && p.x < b.max.x + 0.05 && p.z > b.min.z - 0.05 && p.z < b.max.z + 0.05 && Math.abs(p.y - b.min.y) < 0.4,
      remove: () => {
        const i = grp.patches.findIndex((x) => x.handle === handle);
        if (i < 0) return;
        grp.patches.splice(i, 1);
        this.rebuild(grp);
      },
    };
    grp.patches.push({ box: b, ragged: o.ragged ?? 0.45, seed: o.seed ?? (b.min.x * 13.1 + b.min.z * 7.7 + b.max.x), handle });
    this.rebuild(grp);
    return handle;
  }

  private mat: THREE.Material | null = null;
  /**
   * W5's `wet_steel`; until it exists (the library falls back to `painted_dark`, an opaque black blob) an interim
   * film: dark, near-mirror smooth, 55 % over the floor (it reads as water under the room's probe and lights).
   */
  private material(): THREE.Material {
    if (this.mat) return this.mat;
    const m = this.materials.get('wet_steel' as MaterialName);
    if (m !== this.materials.get('painted_dark')) return (this.mat = m);
    const f = new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.55, depthWrite: false });
    f.name = 'fx:wet_film';
    return (this.mat = f);
  }

  /** The patch under p (footsteps), or null. */
  patchAt(p: THREE.Vector3): WetPatchHandle | null {
    for (const g of this.groups.values()) for (const x of g.patches) if (x.handle.contains(p)) return x.handle;
    return null;
  }

  get count(): number { let n = 0; for (const g of this.groups.values()) n += g.patches.length; return n; }

  private rebuild(g: Group) {
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const p of g.patches) {
      const R = rand(p.seed);
      const cx = (p.box.min.x + p.box.max.x) / 2, cz = (p.box.min.z + p.box.max.z) / 2, y = p.box.min.y + LIFT;
      const rx = (p.box.max.x - p.box.min.x) / 2, rz = (p.box.max.z - p.box.min.z) / 2;
      // outline: a sum of three low harmonics with random phases, kept inside the box
      const ph = [R() * 6.28, R() * 6.28, R() * 6.28, R() * 6.28], am = [R(), R(), R(), R()];
      const base = pos.length / 3;
      pos.push(cx, y, cz); nor.push(0, 1, 0); uv.push(cx, -cz);
      for (let i = 0; i < SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const wob = (am[0] * Math.sin(2 * a + ph[0]) + am[1] * Math.sin(3 * a + ph[1]) * 0.8 + am[2] * Math.sin(5 * a + ph[2]) * 0.5
          + am[3] * Math.sin(9 * a + ph[3]) * 0.25) / 2.55;
        const k = 1 - p.ragged * (0.5 + 0.5 * wob);
        const x = cx + Math.cos(a) * rx * k, z = cz + Math.sin(a) * rz * k;
        pos.push(x, y, z); nor.push(0, 1, 0); uv.push(x, -z);
        // CCW seen from above (+y): centre, next, this
        idx.push(base, base + 1 + ((i + 1) % SEG), base + 1 + i);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    // tangents for the ripple normal map (flat: +x)
    const n = pos.length / 3, tan = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) tan.set([1, 0, 0, 1], i * 4);
    geo.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
    g.mesh.geometry.dispose();
    g.mesh.geometry = geo;
    g.mesh.visible = g.patches.length > 0;
    if (g.patches.length && !g.reg) {
      g.mesh.userData.fxCenter = g.patches[0].box.getCenter(new THREE.Vector3());
      g.reg = this.register({ id: g.id, object: g.mesh, rooms: g.rooms, seenFrom: g.seenFrom });
    } else if (!g.patches.length && g.reg) { g.reg.remove(); g.reg = null; }
  }
}
