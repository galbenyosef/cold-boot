/**
 * Stage 3d §5.6.10 (W3b): the loader's RIG INTERFACE (what the behaviour in loader.ts drives — W3a's `rig.ts` implements
 * it), `StubLoaderRig` (boxes, so the behaviour and `check-loader` run before W3a's body lands), and the check's greybox
 * ARENA (`?loaderArena=1`: the moon-pool chamber's decks, well, coaming + guard, cage, galleries, rails and six cargo
 * slots as a `DockArena`, built only when the level has no dock of its own).
 *
 * Conventions (as W3a's model.ts): MODEL SPACE = WORLD SPACE (the rig's root stays at the identity); north = +z.
 */
import * as THREE from 'three';
import type { CargoHandle, CargoSlot, DockArena, GameContext, LightHandle, WaterVolume } from '../../core/types';
import { hv, type HitVolume } from '../shared/hit';
import type { FloodId, LoaderCue, LoaderRig as W3aRig } from './rig';

// ───────────────────────────────────────────────────────────── the rig interface

/** One frame of the crane's pose (all world space). loader.ts computes it; the rig only shows it. */
export interface LoaderPose {
  /** Bridge z and trolley x (= the grab's hanging centre at rest). */
  bridgeZ: number;
  trolleyX: number;
  /** Grab TOP centre (world), the pendulum already applied (the ropes run from the trolley's sheaves to it). */
  grab: THREE.Vector3;
  /** Pendulum angles (rad): about x (swing in z) and about z (swing in x). The grab tilts with them. */
  swayX: number;
  swayZ: number;
  /** 0 closed … 1 open (all four jaws; a side whose ram is gone hangs open — `destroyPart`). */
  jaws: number;
  /** 0 retracted … 1 extended (sight glasses lit while > 0.5). */
  rams: number;
  /** Pod cowl louvres 0 shut … 1 open (the red core glows). */
  cowl: number;
  /** World aim point per flood (index 0 = flood_1) and its FULL cone angle (rad; 14° … 22°). */
  floodAim: THREE.Vector3[];
  floodCone: number[];
  /** 0 free pendulum … 1 held straight (resting / clamped / braked hover). */
  swayHold?: number;
  /** SWING: drive the sway directly (rad about z), null = free. */
  forceSwayZ?: number | null;
  /** The ring light under the grab. */
  ringMode?: 'off' | 'white' | 'red';
  /** Ring light under the grab 0 … 1 (emissive only). */
  ring: number;
  /** Dark-room marks (RigBuilder.mark): cyan working, red hostile, off dead. */
  mark: 'cyan' | 'red' | 'off';
}

export type LoaderPart = 'flood_1' | 'flood_2' | 'flood_3' | 'flood_4' | 'ram_e' | 'ram_w' | 'pod';

export interface LoaderRig {
  /** Added to the enemy's object (identity transform). */
  readonly root: THREE.Object3D;
  /** Hit volumes on the rig's bones; `part` ∈ flood_1 … flood_4, ram_e, ram_w, pod, body (multipliers are loader.ts's). */
  readonly volumes: HitVolume[];
  /** The four flood spots (`ctx.render.lights`, prio 0.9, non-shadow on LOW / MEDIUM — D24), index 0 = flood_1. */
  readonly floods: (LightHandle | null)[];
  /** Grab box half sizes (m): 2.4 × 1.6 × 2.4 → [1.2, 1.6 (height), 1.2]. */
  readonly grabHalf: number;
  readonly grabHeight: number;
  /** Pivot height of the ropes (world y, the trolley's sheaves). */
  readonly sheaveY: number;
  apply(p: LoaderPose, dt: number): void;
  /** World lamp-head centre of flood i (0-based), after `apply`. */
  floodHead(i: number, out: THREE.Vector3): THREE.Vector3;
  /** World sensor (eyes) position on the pod, after `apply`. */
  sensor(out: THREE.Vector3): THREE.Vector3;
  /** World PA horn mouth. */
  pa(out: THREE.Vector3): THREE.Vector3;
  /** Hang a container under the grab (null = release it; the caller re-parents it). */
  carry(obj: THREE.Object3D | null): void;
  /** Show a destroyed part (flood shattered + its light off, ram burst + that side's jaws hanging). Idempotent. */
  destroyPart(part: LoaderPart): void;
  /** Rebuild every part whole (a checkpoint restore before re-applying destroyed parts). */
  reset(): void;
  setLod?(n: number): void;
  dispose(): void;
  // ── optional (W3a's rig through `adaptLoaderRig`): the rig's own answers where it has them
  /** D20 geometry of flood i (0-based): `p` inside its cone within its distance, alive and on. */
  floodCovers?(i: number, p: THREE.Vector3): boolean;
  /** Flood i's light holds a pool slot this frame (S13). */
  floodInPool?(i: number): boolean;
  /** The rig's own beam direction (world) of flood i. */
  floodBeam?(i: number, out: THREE.Vector3): THREE.Vector3;
  /** The keyed death (§5.6.8); cues are turned into sound / fx by the caller. */
  die?(well: THREE.Vector3, onCue: (cue: LoaderCue, at: THREE.Vector3) => void): Promise<void>;
  /** The swinging grab's actual top centre (world). */
  grabTopNow?(out: THREE.Vector3): THREE.Vector3;
}

/**
 * W3a's rig (`createLoaderRig`, rig.ts) behind this file's pose interface: travel → setBridge / setTrolley / setHoist
 * (the rig's pendulum owns the sway; the behaviour holds it straight while resting / clamped / braked), jaws, cowl,
 * floods (aim + full cone + on), marks, ring, the load, broken parts, the keyed death.
 */
export function adaptLoaderRig(ctx: GameContext, r: W3aRig): LoaderRig {
  const fid = (i: number) => (i + 1) as FloodId;
  const floods: (LightHandle | null)[] = [1, 2, 3, 4].map((i) => r.floodLight(i as FloodId));
  const cam = new THREE.Vector3();
  let first = true;
  return {
    root: r.root, volumes: r.volumes, floods,
    grabHalf: GRAB_HALF, grabHeight: GRAB_H, sheaveY: SHEAVE_Y,
    apply(p, dt) {
      if (!r.dying && !r.dead) {
        r.setBridge(p.bridgeZ); r.setTrolley(p.trolleyX); r.setHoist(p.grab.y);
        r.setSwayHold(p.swayHold ?? 0);
        r.forceSway(p.forceSwayZ === undefined || p.forceSwayZ === null ? null : 0, p.forceSwayZ ?? undefined);
        r.setJaws(p.jaws); r.setRams(p.rams); r.setCowl(p.cowl);
        for (let i = 0; i < 4; i++) {
          if (!r.floodAlive(fid(i))) continue;
          r.aimFlood(fid(i), p.floodAim[i]);
          r.setFloodCone(fid(i), (p.floodCone[i] * 180) / Math.PI);
          r.setFloodOn(fid(i), p.mark !== 'off');
        }
        r.setMarks(p.mark);
        r.setRing(p.ringMode ?? 'off');
      }
      if (first) { first = false; r.snap(); }
      cam.setFromMatrixPosition(ctx.camera.matrixWorld);
      r.update(dt, cam);
    },
    floodHead: (i, out) => r.floodOrigin(fid(i), out),
    sensor: (out) => out.copy(r.sensor),
    pa: (out) => out.copy(r.pa),
    carry(obj) {
      if (!obj) { if (r.carried) r.detach(); return; }
      if (!obj.parent) {
        // a new load (B-14): hung under the grab where it is
        r.update(0); ctx.scene.add(obj);
        obj.position.copy(r.grabBottom); obj.rotation.set(0, 0, 0); obj.updateMatrixWorld(true);
      }
      if (r.carried && r.carried !== obj) r.detach();
      r.attach(obj);
    },
    destroyPart(part) {
      if (part.startsWith('flood_')) { const i = +part.slice(6) as FloodId; if (r.floodAlive(i)) r.breakFlood(i); }
      else if (part === 'ram_e' || part === 'ram_w') { const sd = part === 'ram_e' ? 'e' : 'w'; if (!r.ramBroken[sd]) r.breakRam(sd); }
    },
    reset() { r.repair(); },
    dispose: () => r.dispose(),
    floodCovers: (i, p) => r.floodCovers(fid(i), p),
    floodInPool: (i) => r.floodInPool(fid(i)),
    floodBeam: (i, out) => r.floodDir(fid(i), out),
    die: (well, onCue) => r.die({ well, onCue: (c, at) => onCue(c, at) }),
    grabTopNow: (out) => out.copy(r.grabTop),
  };
}

// ───────────────────────────────────────────────────────────── the stub rig (boxes)

const GRAB_HALF = 1.2, GRAB_H = 1.6, SHEAVE_Y = -2.7;
/** FL1 / FL2 on the trolley's south corners (trolley-relative x, world y, z); FL3 / FL4 under the girders (world x, y, bridge-rel z). */
const FLOODS: { on: 'trolley' | 'bridge'; p: [number, number, number] }[] = [
  { on: 'trolley', p: [-1.62, -2.92, -2.08] }, { on: 'trolley', p: [1.62, -2.92, -2.08] },
  { on: 'bridge', p: [-66, -4.58, -1.35] }, { on: 'bridge', p: [-40, -4.58, 1.35] },
];

export class StubLoaderRig implements LoaderRig {
  readonly root = new THREE.Group();
  readonly volumes: HitVolume[] = [];
  readonly floods: (LightHandle | null)[] = [];
  readonly grabHalf = GRAB_HALF;
  readonly grabHeight = GRAB_H;
  readonly sheaveY = SHEAVE_Y;
  private bridge = new THREE.Group();
  private trolley = new THREE.Group();
  private pod = new THREE.Group();
  private grab = new THREE.Group();
  private ramE = new THREE.Group();
  private ramW = new THREE.Group();
  private floodBones: THREE.Group[] = [];
  private jaws: THREE.Mesh[] = [];
  private ropes: THREE.Mesh[] = [];
  private cowlM: THREE.Mesh;
  private ringM: THREE.Mesh;
  private markMat: THREE.MeshBasicMaterial;
  private glassMat: THREE.MeshBasicMaterial;
  private gone = new Set<LoaderPart>();
  private carried: THREE.Object3D | null = null;
  private geos: THREE.BufferGeometry[] = [];

  constructor(private ctx: GameContext, o: { railXW?: number; railXE?: number; railY?: number } = {}) {
    const M = ctx.materials;
    const yellow = M.get('crane_yellow'), dark = M.get('painted_dark'), steel = M.get('steel_raw'), chrome = M.get('chrome');
    this.markMat = new THREE.MeshBasicMaterial({ color: 0x20e0ff });
    this.glassMat = new THREE.MeshBasicMaterial({ color: 0x3a2000 });
    const unit = new THREE.BoxGeometry(1, 1, 1); this.geos.push(unit);
    const cylG = new THREE.CylinderGeometry(0.5, 0.5, 1, 10); this.geos.push(cylG);
    const sphG = new THREE.SphereGeometry(1, 12, 8); this.geos.push(sphG);
    const boxIn = (parent: THREE.Object3D, mat: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) => {
      const m = new THREE.Mesh(unit, mat); m.position.set(cx, cy, cz); m.scale.set(sx, sy, sz); m.castShadow = false; m.receiveShadow = false; parent.add(m); return m;
    };
    const xw = o.railXW ?? -75.4, xe = o.railXE ?? -28.6, ry = o.railY ?? -4.0;
    const span0 = xw + 0.4, span1 = xe - 0.4, cx = (span0 + span1) / 2, len = span1 - span0;
    this.root.add(this.bridge); this.bridge.add(this.trolley); this.root.add(this.grab);
    // bridge: two box girders + end trucks (bridge-local: x world, y world, z relative)
    boxIn(this.bridge, yellow, cx, ry + 0.7, -1.35, len, 1.4, 0.7);
    boxIn(this.bridge, yellow, cx, ry + 0.7, 1.35, len, 1.4, 0.7);
    boxIn(this.bridge, yellow, xw + 0.2, ry + 0.4, 0, 0.9, 0.8, 4.0);
    boxIn(this.bridge, yellow, xe - 0.2, ry + 0.4, 0, 0.9, 0.8, 4.0);
    // trolley (trolley-local: x relative, y world, z relative)
    boxIn(this.trolley, yellow, 0, ry + 1.4 + 0.8, 0, 3.4, 1.6, 3.4);
    // pod under the trolley: 1.6 × 1.0 × 1.2, y −5.0 … −4.0
    this.trolley.add(this.pod); this.pod.position.set(0, -4.5, 0);
    boxIn(this.pod, dark, 0, 0, 0, 1.6, 1.0, 1.2);
    this.cowlM = boxIn(this.pod, yellow, 0, 0, -0.62, 1.5, 0.9, 0.06);
    const sensorM = new THREE.Mesh(sphG, this.markMat); sensorM.scale.setScalar(0.09); sensorM.position.set(0, -0.42, -0.5); this.pod.add(sensorM);
    // floods
    for (let i = 0; i < 4; i++) {
      const f = FLOODS[i], b = new THREE.Group();
      (f.on === 'trolley' ? this.trolley : this.bridge).add(b);
      b.position.set(...f.p);
      const head = new THREE.Mesh(sphG, dark); head.scale.setScalar(0.3); b.add(head);
      const lens = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: 0xfff6e0 })); lens.scale.set(0.42, 0.42, 0.05); lens.position.z = -0.27; b.add(lens);
      this.floodBones.push(b);
      let light: LightHandle | null = null;
      try {
        light = ctx.render.lights.add({ type: 'spot', position: new THREE.Vector3(), target: new THREE.Vector3(0, -20, 0), color: 0xfff0d8, intensity: 900, distance: 45, angle: 0.3, penumbra: 0.35, castShadow: false, priority: 0.9, group: 'loader_floods' });
      } catch { light = null; }
      this.floods.push(light);
      this.volumes.push(hv(b, [0, 0, 0], [0, 0, 0], 0.32, `flood_${i + 1}`));
    }
    // ropes (4 thin boxes, scaled each frame between the sheaves and the grab)
    for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(cylG, steel); r.scale.set(0.05, 1, 0.05); this.root.add(r); this.ropes.push(r); }
    // grab (grab-local: origin = top centre, y down)
    boxIn(this.grab, yellow, 0, -0.5, 0, 2.4, 1.0, 2.4);
    boxIn(this.grab, dark, 0, 0.25, 0, 1.2, 0.5, 1.0); // power pack
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2, j = new THREE.Group();
      j.position.set(Math.sin(a) * 1.0, -1.0, Math.cos(a) * 1.0); j.rotation.y = a; this.grab.add(j);
      const m = boxIn(j, yellow, 0, -0.3, 0, 1.6, 0.6, 0.12);
      this.jaws.push(m);
    }
    this.ramE.position.set(1.32, -0.05, 0); this.ramW.position.set(-1.32, -0.05, 0);
    for (const r of [this.ramE, this.ramW]) {
      this.grab.add(r);
      const cyl = new THREE.Mesh(cylG, dark); cyl.scale.set(0.2, 0.6, 0.2); cyl.position.y = -0.3; r.add(cyl);
      const rod = new THREE.Mesh(cylG, chrome); rod.scale.set(0.1, 0.5, 0.1); rod.position.y = -0.75; rod.name = 'rod'; r.add(rod);
      const glass = new THREE.Mesh(unit, this.glassMat); glass.scale.set(0.12, 0.1, 0.24); glass.position.set(0, -0.3, 0); r.add(glass);
    }
    this.volumes.push(hv(this.ramE, [0, -0.1, 0], [0, -1.0, 0], 0.12, 'ram_e'));
    this.volumes.push(hv(this.ramW, [0, -0.1, 0], [0, -1.0, 0], 0.12, 'ram_w'));
    this.ringM = boxIn(this.grab, new THREE.MeshBasicMaterial({ color: 0x000000 }), 0, -1.62, 0, 1.6, 0.04, 1.6);
    const gMark = new THREE.Mesh(sphG, this.markMat); gMark.scale.setScalar(0.08); gMark.position.set(0, -0.2, -1.22); this.grab.add(gMark);
    // pod (box 1.6 × 1.0 × 1.2 as two capsules), grab, trolley, bridge = body
    this.volumes.push(hv(this.pod, [-0.4, 0, 0], [0.4, 0, 0], 0.55, 'pod'));
    this.volumes.push(hv(this.grab, [0, -0.5, -0.6], [0, -0.5, 0.6], 1.0, 'body'));
    this.volumes.push(hv(this.trolley, [-1.2, ry + 2.2, 0], [1.2, ry + 2.2, 0], 1.1, 'body'));
    this.volumes.push(hv(this.bridge, [span0, ry + 0.7, -1.35], [span1, ry + 0.7, -1.35], 0.55, 'body'));
    this.volumes.push(hv(this.bridge, [span0, ry + 0.7, 1.35], [span1, ry + 0.7, 1.35], 0.55, 'body'));
    this.root.traverse((m) => { m.frustumCulled = false; });
  }

  apply(p: LoaderPose, _dt: number): void {
    this.bridge.position.set(0, 0, p.bridgeZ);
    this.trolley.position.set(p.trolleyX, 0, 0);
    this.grab.position.copy(p.grab);
    this.grab.rotation.set(p.swayX, 0, p.swayZ);
    this.root.updateMatrixWorld(true);
    // ropes: from the sheaves (trolley ± 1.1 x, ± 0.5 z, sheave y) to the grab's top corners
    const top = this.grab;
    for (let i = 0; i < 4; i++) {
      const sx = i & 1 ? 1.1 : -1.1, sz = i & 2 ? 0.5 : -0.5;
      const a = _a.set(p.trolleyX + sx, SHEAVE_Y, p.bridgeZ + sz);
      const b = _b.set(sx * 0.9, 0, sz * 0.9).applyMatrix4(top.matrixWorld);
      const r = this.ropes[i];
      r.position.copy(a).add(b).multiplyScalar(0.5);
      const l = a.distanceTo(b);
      r.scale.set(0.05, Math.max(0.01, l), 0.05);
      r.quaternion.setFromUnitVectors(_up, _d.copy(b).sub(a).normalize());
    }
    // jaws: each hinged on its edge, opening outward; a side whose ram is gone hangs open
    for (let k = 0; k < 4; k++) {
      const side = k === 1 ? 'ram_e' : k === 3 ? 'ram_w' : null;
      const open = side && this.gone.has(side as LoaderPart) ? 1 : p.jaws;
      (this.jaws[k].parent as THREE.Object3D).rotation.x = -open * 0.9;
    }
    for (const [r, part] of [[this.ramE, 'ram_e'], [this.ramW, 'ram_w']] as const) {
      const rod = r.getObjectByName('rod');
      if (rod) rod.position.y = -0.75 - (this.gone.has(part) ? 0 : p.rams) * 0.34;
    }
    this.glassMat.color.setHex(p.rams > 0.5 ? 0xffa020 : 0x3a2000);
    this.cowlM.position.y = p.cowl * 0.7;
    (this.ringM.material as THREE.MeshBasicMaterial).color.setScalar(p.ring);
    this.markMat.color.setHex(p.mark === 'cyan' ? 0x20e0ff : p.mark === 'red' ? 0xff2010 : 0x050505);
    // floods: aim the heads and their spots
    for (let i = 0; i < 4; i++) {
      const b = this.floodBones[i];
      b.updateWorldMatrix(true, false);
      const pos = _a.setFromMatrixPosition(b.matrixWorld);
      const l = this.floods[i];
      if (this.gone.has(`flood_${i + 1}` as LoaderPart)) { if (l) l.enabled = false; continue; }
      _m.lookAt(pos, p.floodAim[i], _up);
      b.quaternion.setFromRotationMatrix(_m);
      if (b.parent) { b.parent.getWorldQuaternion(_q); b.quaternion.premultiply(_q.invert()); }
      if (l) { l.position.copy(pos); l.target.copy(p.floodAim[i]); (l.desc as { angle?: number }).angle = p.floodCone[i] / 2; l.enabled = p.mark !== 'off'; }
    }
    this.root.updateMatrixWorld(true);
  }

  floodHead(i: number, out: THREE.Vector3): THREE.Vector3 { return out.setFromMatrixPosition(this.floodBones[i].matrixWorld); }
  sensor(out: THREE.Vector3): THREE.Vector3 { return out.set(0, -0.42, -0.5).applyMatrix4(this.pod.matrixWorld); }
  pa(out: THREE.Vector3): THREE.Vector3 { return out.set(-1.2, -1.05, -1.75).applyMatrix4(this.trolley.matrixWorld); }

  carry(obj: THREE.Object3D | null): void {
    if (this.carried && this.carried !== obj) this.carried.removeFromParent();
    this.carried = obj;
    if (obj) { this.grab.add(obj); obj.position.set(0, -GRAB_H - 2.6, 0); obj.rotation.set(0, 0, 0); }
  }

  destroyPart(part: LoaderPart): void {
    if (this.gone.has(part)) return;
    this.gone.add(part);
    if (part.startsWith('flood_')) {
      const i = +part.slice(6) - 1, b = this.floodBones[i];
      if (b.children[1]) b.children[1].visible = false;
      b.scale.setScalar(0.7);
      const l = this.floods[i]; if (l) l.enabled = false;
    } else if (part === 'ram_e' || part === 'ram_w') {
      const r = part === 'ram_e' ? this.ramE : this.ramW;
      const rod = r.getObjectByName('rod'); if (rod) rod.visible = false;
    }
  }

  reset(): void {
    this.gone.clear();
    for (const b of this.floodBones) { b.scale.setScalar(1); if (b.children[1]) b.children[1].visible = true; }
    for (const r of [this.ramE, this.ramW]) { const rod = r.getObjectByName('rod'); if (rod) rod.visible = true; }
  }

  dispose(): void {
    for (const l of this.floods) l?.remove();
    this.floods.length = 0;
    this.root.removeFromParent();
    for (const g of this.geos) g.dispose();
  }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

// ───────────────────────────────────────────────────────────── the check's greybox arena

/**
 * The extras of the arena beyond `DockArena` (check-loader reads them through `enemies.debug.loaderArena`).
 * `well` (also set on the dock object as a duck-typed extra) = the well's centre at the water (the death's goal).
 */
export interface LoaderArena {
  dock: DockArena;
  /** Advance falling containers (the real dock does this itself); index.ts calls it after the enemies' update. */
  tick(dt: number): void;
  well: THREE.Vector3;
  decks: { dock: number; wet: number; mid: number; gallery: number };
  /** Spots for the check: on the dock, the wet dock, the mid deck, the cage, the east gallery. */
  spots: Record<'dock' | 'dock2' | 'wet' | 'mid' | 'cage' | 'gallery' | 'undercroft', [number, number, number]>;
  containers: string[];
  /** Bars / rails / guards (move-only) as boxes, for the knock-back case. */
  guards: THREE.Box3[];
}

/** Box helper: [x0, y0, z0, x1, y1, z1]. */
type B6 = [number, number, number, number, number, number];
const bx = (b: B6) => new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));

/**
 * `?loaderArena=1` on a level without a dock (level 6's K stub / greybox before W4b): the moon-pool chamber's numbers
 * (§2.6.9, §2.6.10) as a bare greybox — no stairs (the check teleports), no dressing.
 */
const SPOTS: LoaderArena['spots'] = {
  dock: [-68, -20, -187], dock2: [-36, -20, -187], wet: [-52, -20.8, -188], mid: [-64, -16, -162], cage: [-52, -16, -169.5],
  gallery: [-29.7, -12, -175], undercroft: [-52, -20, -160],
};

export function buildLoaderArena(ctx: GameContext): LoaderArena | null {
  const level = ctx.level as unknown as { colliders: THREE.Mesh[]; water: WaterVolume[]; dock: DockArena | null; regions: Record<string, THREE.Box3[]>; roomAt?(p: THREE.Vector3): { id: string } | null };
  if (!level) return null;
  // the level's own chamber (W4a's greybox + W4b's dock): the check runs on it — nothing is built
  if (level.dock && level.roomAt?.(new THREE.Vector3(-52, -19.5, -186))?.id === 'pool6') {
    const d = level.dock;
    return { dock: d, tick() { /* the level's */ }, well: new THREE.Vector3(-52, -20.3, -176), decks: { dock: -20, wet: -20.8, mid: -16, gallery: -12 }, spots: SPOTS, containers: d.slots.map((q) => q.container).filter((c): c is string => !!c), guards: [] };
  }
  // a dock without its chamber (the K stub + W4b's dock): its containers are hidden, the arena's own dock replaces it
  if (level.dock) for (const sl of level.dock.slots) { const h = sl.container ? level.dock.lift(sl.id) : null; if (h) { h.object.visible = false; h.box.enabled = false; } }
  const group = new THREE.Group(); group.name = 'loader_arena'; ctx.scene.add(group);
  const M = ctx.materials, geo = new THREE.BoxGeometry(1, 1, 1);
  const colliders: THREE.Mesh[] = [];
  const statics: THREE.Box3[] = [];
  const guards: THREE.Box3[] = [];
  const solid = (mat: THREE.Material | null, b: B6, flag?: 'moveOnly' | 'rayOnly', surface = 'metal') => {
    const box = bx(b);
    const sx = b[3] - b[0], sy = b[4] - b[1], sz = b[5] - b[2];
    if (mat) {
      const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
      m.receiveShadow = true; group.add(m);
    }
    const c = new THREE.Mesh(geo); c.scale.set(sx, sy, sz); c.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2); c.updateMatrixWorld(true);
    c.userData.surface = surface;
    if (flag) c.userData[flag] = true;
    colliders.push(c);
    if (flag === 'moveOnly') guards.push(box); else if (!flag) statics.push(box);
    return box;
  };
  const floor = M.get('floor_plate'), wall = M.get('wall_panel_dark'), haz = M.get('hazard_stripes'), bars = M.get('trim_steel');
  const water = M.clone('glass', { color: 0x0a2a30, transparent: true, opacity: 0.7 });
  const X0 = -75.8, X1 = -28.2, Z0 = -195.8, Z1 = -148.2, YD = -20, YW = -20.8, YM = -16, YG = -12;
  // dock floor (y −20) round the well opening (x −58 … −46, z −182 … −170) and the wet dock (x −66 … −38, z −194 … −182.4)
  solid(floor, [X0, YD - 0.3, -182.4, -58, YD, Z1]);
  solid(floor, [-46, YD - 0.3, -182.4, X1, YD, Z1]);
  solid(floor, [-58, YD - 0.3, -170, -46, YD, Z1]);
  solid(floor, [X0, YD - 0.3, Z0, -66, YD, -182.4]);
  solid(floor, [-38, YD - 0.3, Z0, X1, YD, -182.4]);
  solid(floor, [-66, YD - 0.3, Z0, -38, YD, -194]); // the window walk
  // wet dock floor (−20.8) and its kerbs (the dock's edge faces are the slabs above)
  solid(floor, [-66, YW - 0.3, -194, -38, YW, -182.4]);
  solid(wall, [-66, YW, -194.0, -38, YD - 0.3, -193.9]);
  // the well: floor (the inner door) at −34, walls down from the dock
  solid(M.get('steel_raw'), [-58, -34.3, -182, -46, -34, -170]);
  solid(wall, [-58.4, -34, -182.4, -58, YD, -169.6]); solid(wall, [-46, -34, -182.4, -45.6, YD, -169.6]);
  solid(wall, [-58, -34, -182.4, -46, YD, -182]); solid(wall, [-58, -34, -170, -46, YD, -169.6]);
  // the coaming (0.4 thick, top −19.2) and its 1.6 m bar guard (move-only, top −17.6)
  for (const b of [[-58.4, YW, -182.4, -58, -19.2, -169.6], [-46, YW, -182.4, -45.6, -19.2, -169.6], [-58, YW, -182.4, -46, -19.2, -182], [-58, YD, -170, -46, -19.2, -169.6]] as B6[]) solid(haz, b);
  for (const b of [[-58.45, -19.2, -182.45, -58.35, -17.6, -169.55], [-45.65, -19.2, -182.45, -45.55, -17.6, -169.55], [-58.4, -19.2, -182.45, -45.6, -17.6, -182.35], [-58.4, -19.2, -169.65, -45.6, -17.6, -169.55]] as B6[]) solid(bars, b, 'moveOnly');
  // water surfaces (ray-only): the well at −20.3 and the wet dock at −20.3
  solid(water, [-58, -20.32, -182, -46, -20.3, -170], 'rayOnly', 'water');
  solid(water, [-66, -20.32, -194, -38, -20.3, -182.4], 'rayOnly', 'water');
  // the mid deck (−16) + the cage cantilever, its south bar guard (2.4 m), the cage (2.6 m, bar roof at −13.4)
  solid(floor, [-72.8, YM - 0.3, -166, -31.2, YM, Z1]);
  solid(floor, [-55, YM - 0.3, -172, -49, YM, -166]);
  solid(bars, [-68, YM, -166.05, -55, YM + 2.4, -165.95], 'moveOnly');
  solid(bars, [-49, YM, -166.05, -36, YM + 2.4, -165.95], 'moveOnly');
  for (const b of [[-55.05, YM, -172, -54.95, -13.4, -166], [-49.05, YM, -172, -48.95, -13.4, -166], [-55, YM, -172.05, -49, -13.4, -171.95], [-55, -13.45, -172, -49, -13.4, -166]] as B6[]) solid(bars, b, 'moveOnly');
  // the winch and the console on the mid deck (so the target test meets colliders)
  solid(M.get('painted_dark'), [-54, YM, -154, -50, YM + 3.0, -150]);
  solid(M.get('painted_dark'), [-46, YM, -158.6, -42, YM + 1.0, -157.8]);
  // galleries (−12)
  solid(floor, [-31.2, YG - 0.3, Z0, X1, YG, Z1]);
  solid(floor, [X0, YG - 0.3, Z0, -72.8, YG, Z1]);
  solid(floor, [-72.8, YG - 0.3, -151.2, -31.2, YG, Z1]);
  // walls and a ceiling
  solid(wall, [X0 - 0.4, -34, Z0 - 0.4, X0, 2, Z1 + 0.4]); solid(wall, [X1, -34, Z0 - 0.4, X1 + 0.4, 2, Z1 + 0.4]);
  solid(wall, [X0, -34, Z0 - 0.4, X1, 2, Z0]); solid(wall, [X0, -34, Z1, X1, 2, Z1 + 0.4]);
  solid(M.get('ceiling_panel'), [X0, 2, Z0, X1, 2.3, Z1]);
  // the six cargo slots and their containers (6.0 × 2.4 × 2.6, long axis x; non-walkable dynamic boxes, B2)
  const slotDefs: [string, number, number, number, number, number, string | null][] = [
    ['sl6_1', -74, -182.0, -68, -179.6, YD, 'B-09'], ['sl6_2', -74, -176.4, -68, -174.0, YD, null],
    ['sl6_3', -36, -182.0, -30, -179.6, YD, 'B-11'], ['sl6_4', -36, -176.4, -30, -174.0, YD, 'B-12'],
    ['sl6_5', -60, -192.0, -54, -189.6, YW, 'B-10'], ['sl6_6', -50, -192.0, -44, -189.6, YW, null],
  ];
  const slots: CargoSlot[] = slotDefs.map(([id, x0, z0, x1, z1, y, c]) => ({ id, box: bx([x0, y, z0, x1, y + 2.6, z1]), floorY: y, container: c, cover: [] }));
  const handles = new Map<string, CargoHandle>();
  const cmat = [M.get('container_navy'), M.get('container_orange')];
  let ci = 0;
  for (const s of slots) {
    if (!s.container) continue;
    // origin = the footprint's bottom centre (as the level's dock, W4b)
    const obj = new THREE.Group(); obj.name = 'container_' + s.container;
    const mesh = new THREE.Mesh(geo, cmat[ci++ % 2]); mesh.scale.set(6.0, 2.6, 2.4); mesh.position.y = 1.3; obj.add(mesh);
    const c = s.box.getCenter(new THREE.Vector3()); obj.position.set(c.x, s.floorY, c.z); group.add(obj);
    const box = ctx.physics.addBox(s.box.clone(), 'metal'); box.walkable = false;
    handles.set(s.container, { id: s.container, object: obj, box });
  }
  const setBoxAt = (h: CargoHandle) => {
    const p = h.object.getWorldPosition(_a);
    h.box.box.min.set(p.x - 3.0, p.y, p.z - 1.2); h.box.box.max.set(p.x + 3.0, p.y + 2.6, p.z + 1.2);
  };
  const lifted = new Set<CargoHandle>();
  const falling: { h: CargoHandle; slot: CargoSlot; v: number }[] = [];
  const deckAt = (x: number, z: number, y: number): { kind: 'dock' | 'wet' | 'mid' | 'gallery' | 'none'; y: number } => {
    if (x < X0 || x > X1 || z < Z0 || z > Z1) return { kind: 'none', y };
    if (Math.abs(y - YG) < 1.2) return { kind: 'gallery', y: YG };
    if (Math.abs(y - YM) < 1.2) {
      const onMid = (x >= -72.8 && x <= -31.2 && z >= -166 && z <= Z1) || (x >= -55 && x <= -49 && z >= -172 && z <= -166);
      return onMid ? { kind: 'mid', y: YM } : { kind: 'none', y };
    }
    if (x >= -58.4 && x <= -45.6 && z >= -182.4 && z <= -169.6) return { kind: 'none', y };
    if (x >= -66 && x <= -38 && z >= -194 && z <= -182.4) return { kind: 'wet', y: YW };
    if (Math.abs(y - YD) < 1.2) return { kind: 'dock', y: YD };
    return { kind: 'none', y };
  };
  const noSlam = bx([-58, -21, -174, -46, -12, -149]);
  const rails = { xMin: -71, xMax: -33, zMin: -192, zMax: -153, railY: -4.0 };
  const boxClear = (b: THREE.Box3) => {
    for (const s of statics) if (s.intersectsBox(b)) return false;
    for (const g of guards) if (g.intersectsBox(b)) return false;
    for (const h of handles.values()) if (h.box.enabled && h.box.box.intersectsBox(b)) return false;
    return true;
  };
  const _gb = new THREE.Box3();
  const pointOk = (p: THREE.Vector3, bottom: number, height: number): boolean => {
    if (p.x < rails.xMin || p.x > rails.xMax || p.z < rails.zMin || p.z > rails.zMax) return false;
    const d = deckAt(p.x, p.z, p.y);
    if (d.kind === 'none' || d.kind === 'gallery') return false;
    // under the mid deck (the undercroft) / the cage: the dock under z > −166 (and under the cantilever)
    if (d.kind !== 'mid' && (p.z > -166 || (p.x >= -55 && p.x <= -49 && p.z > -172))) return false;
    if (d.kind === 'mid') {
      const m = 3.5;
      if (p.x > noSlam.min.x - m && p.x < noSlam.max.x + m && p.z > noSlam.min.z - m && p.z < noSlam.max.z + m) return false;
    }
    // stairs ± 1.5 m (ST6_M x −72 … −70, ST6_M2 x −34 … −32; z −171.6 … −166, from the dock to the mid deck)
    for (const [sx0, sx1] of [[-72, -70], [-34, -32]]) if (p.x > sx0 - 1.5 && p.x < sx1 + 1.5 && p.z > -171.6 - 1.5 && p.z < -166 + 1.5) return false;
    // wet dock: depth ≤ 0.7 (the flat floor 0.5 m; the channel is not modelled here)
    _gb.min.set(p.x - GRAB_HALF, d.y + bottom, p.z - GRAB_HALF); _gb.max.set(p.x + GRAB_HALF, d.y + bottom + height, p.z + GRAB_HALF);
    return boxClear(_gb);
  };
  const dock: DockArena & { well: THREE.Vector3; deckAt: typeof deckAt } = {
    slots,
    lift(id) {
      const s = slots.find((q) => q.id === id);
      if (!s || !s.container) return null;
      const h = handles.get(s.container) ?? null;
      s.container = null;
      if (h) lifted.add(h);
      return h;
    },
    place(h, id) {
      const s = slots.find((q) => q.id === id);
      if (!s) return;
      s.container = h.id; lifted.delete(h);
      group.attach(h.object);
      const c = s.box.getCenter(_a); h.object.position.set(c.x, s.floorY, c.z); h.object.rotation.set(0, 0, 0);
      setBoxAt(h); h.box.enabled = true;
    },
    drop(h, id, from) {
      const s = slots.find((q) => q.id === id);
      if (!s) return;
      s.container = h.id; lifted.delete(h);
      group.attach(h.object);
      const c = s.box.getCenter(_a); h.object.position.set(c.x, from, c.z); h.object.rotation.set(0, 0, 0);
      setBoxAt(h); h.box.enabled = true;
      falling.push({ h, slot: s, v: 0 });
    },
    target(p, lane) {
      if (!lane) return pointOk(p, 0.05, GRAB_H);
      const n = 10;
      for (let i = 0; i <= n; i++) {
        _b.lerpVectors(p, lane, i / n);
        if (!pointOk(_b, 1.15, GRAB_H)) return false;
      }
      return true;
    },
    noSlam,
    park: new THREE.Vector3(-52, -8, -186),
    rails,
    well: new THREE.Vector3(-52, -20.3, -176),
    deckAt,
  };
  // falling containers (the level's job in the real dock): g 19 onto the slot floor
  const tick = (dt: number) => {
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      f.v += 19 * dt;
      f.h.object.position.y -= f.v * dt;
      const floorC = f.slot.floorY;
      if (f.h.object.position.y <= floorC) { f.h.object.position.y = floorC; falling.splice(i, 1); }
      setBoxAt(f.h);
    }
    for (const h of lifted) setBoxAt(h);
  };
  ctx.physics.build([...level.colliders, ...colliders]);
  level.colliders.push(...colliders);
  try { ctx.physics.setKillY(-36); } catch { /* older physics */ }
  level.dock = dock;
  const wv: WaterVolume[] = [
    { id: 'wat6_well', room: 'pool6', box: bx([-58, -34, -182, -46, -20.3, -170]), surface: -20.3, stand: 1.25 },
    { id: 'wat6_wet', room: 'pool6', box: bx([-66, -21.3, -194, -38, -20.3, -182.4]), surface: -20.3, stand: 1.25 },
  ];
  try { level.water = [...(level.water ?? []), ...wv]; } catch { /* readonly */ }
  // light: dim work lamps (the floods are the fight's light)
  for (const [x, y, z] of [[-60, -14, -186], [-44, -14, -186], [-52, -6, -160], [-40, -18, -156], [-64, -18, -156]]) {
    try { ctx.render.lights.add({ type: 'point', position: new THREE.Vector3(x, y, z), color: 0xc8d8ff, intensity: 120, distance: 26, castShadow: false, priority: 1 }); } catch { /* render optional */ }
  }
  return {
    dock, tick, well: dock.well,
    decks: { dock: YD, wet: YW, mid: YM, gallery: YG },
    spots: SPOTS,
    containers: [...handles.keys()],
    guards,
  };
}
