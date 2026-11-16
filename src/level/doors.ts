/**
 * Sliding doors: chunky static frames + animated leaves + dynamic physics blockers + status panels.
 *  - std  (1.6 × 2.4): two leaves sliding sideways into the wall.
 *  - wide (3.0 × 2.8): blast door split horizontally with interlocking teeth; top leaf rises, bottom sinks.
 *  - cage (3.0 × 2.8): elevator gate, grated leaves, same motion as wide.
 */
import * as THREE from 'three';
import type { Door, DynamicBox, GameContext, Interactable } from '../core/types';
import type { Builder, Mat } from './builder';
import type { LevelBuild } from './context';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { extrude, hazardStrip, panelOn } from './kit';

export interface DoorSpec {
  id: string; x: number; z: number;
  /** 'z' = the door sits in a wall on a z = const plane (opening runs along X); 'x' likewise. */
  wall: 'x' | 'z';
  kind: 'std' | 'wide' | 'cage';
  locked: boolean;
  /** Lintel labels seen from the local +Z side / -Z side. */
  labelFront: string; labelBack: string;
  leafMat?: Mat;
  windows?: boolean;
  /** The two rooms this door connects. */
  rooms: [string, string];
  /** Never shuts completely while unlocked: rests at this openness (0..1 of travel time). Std doors only. */
  ajar?: number;
  /** REVISION 5: custom opening size (std only; default 1.6 × 2.4) and the sill height the leaves stand on. */
  w?: number; h?: number; y0?: number;
  /** Seconds for a full stroke (default std 0.85, wide/cage 1.7). */
  duration?: number;
  /** false = no frame / lintel / threshold: the caller builds the housing (partition gate, tunnel shutters). */
  frame?: boolean;
  /** Frameless doors: local (x, y, |z|) of the two status panels (default beside the opening at 1.43 m). */
  panel?: [number, number, number];
  /** Leaf look: 'door' (default panels) or 'sheet' (plain heavy sheet with chevrons — gates, shutters). */
  leafStyle?: 'door' | 'sheet';
  /** REVISION 5: non-auto doors open only by script (gate, shutters). Default true. */
  auto?: boolean;
  /** Initial status override (see Door.setStatus). */
  status?: 'cycling' | 'dark' | null;
}

export type DoorStatusShown = 'open' | 'locked' | 'cycling' | 'dark';

const ZIG: [number, number][] = [[1.5, 1.25], [1.05, 1.25], [0.85, 1.55], [0.35, 1.55], [0.15, 1.25], [-0.15, 1.25], [-0.35, 1.55], [-0.85, 1.55], [-1.05, 1.25], [-1.5, 1.25]];

const _v = new THREE.Vector3();

export class DoorImpl implements Door {
  readonly id: string;
  readonly position: THREE.Vector3;
  locked: boolean;
  auto = true;
  /** 0 closed … 1 open (linear time; eased for display). */
  t = 0;
  private target = 0;
  private readonly w: number;
  private readonly h: number;
  private readonly duration: number;
  private leaves: THREE.Object3D[] = [];
  private boxes: DynamicBox[] = [];
  private statusMat: THREE.MeshStandardMaterial;
  private shownKey: string | null = null;
  private status: 'cycling' | 'dark' | null = null;
  /** Called whenever what the status panel shows changes (door-bound lamps). */
  readonly statusListeners: ((s: DoorStatusShown) => void)[] = [];
  /** Base height of the leaves (sill), world y. */
  readonly y0: number;
  private idle = 0;
  private deniedArmed = true;
  private deniedFlash = 0;
  private prompt: Interactable;
  private lastEase = -1;
  private rattle = 0;
  private rattleDur = 1;
  private rattleAmp = 0;
  private rattleT = 0;
  /** Resting openness while unlocked (see DoorSpec.ajar). */
  readonly ajar: number;

  constructor(private L: LevelBuild, private spec: DoorSpec, frames: Builder) {
    const ctx = L.ctx;
    this.id = spec.id;
    this.position = new THREE.Vector3(spec.x, 0, spec.z);
    this.locked = spec.locked;
    const std = spec.kind === 'std';
    this.w = std ? spec.w ?? 1.6 : 3.0;
    this.h = std ? spec.h ?? 2.4 : 2.8;
    this.y0 = spec.y0 ?? 0;
    this.position.y = this.y0;
    this.duration = spec.duration ?? (std ? 0.85 : 1.7);
    this.auto = spec.auto ?? true;
    this.status = spec.status ?? null;
    this.statusMat = ctx.materials.screen(spec.locked ? 'door_locked' : 'door_open', { aspect: 1.5 });

    const ry = spec.wall === 'z' ? 0 : Math.PI / 2;
    const root = new THREE.Group();
    root.name = `door:${spec.id}`;
    root.userData.rooms = spec.rooms;
    root.position.copy(this.position);
    root.rotation.y = ry;
    L.root.add(root);
    L.objects.set(spec.id, root);

    if (spec.frame !== false) this.buildFrame(frames, ry, root);
    else this.buildPanels(root);
    this.buildLeaves(root);

    // leaf blockers (0, 1) + the full-opening blocker that is solid while the door is closing (2)
    this.boxes.push(ctx.physics.addBox(new THREE.Box3(), 'metal'), ctx.physics.addBox(new THREE.Box3(), 'metal'), ctx.physics.addBox(new THREE.Box3(), 'metal'));
    this.boxes[2].enabled = false;
    // REVISION 5.2: decals shot onto a blocker belong to the leaf it stands for (they ride along when it opens).
    // The closing blocker spans the whole opening: the leaf on the hit point's side (fx drops the decal if no
    // leaf surface is actually there).
    this.boxes[0].owner = this.leaves[0];
    this.boxes[1].owner = this.leaves[1];
    this.boxes[2].owner = (p: THREE.Vector3) => {
      if (this.spec.kind === 'std') return (this.spec.wall === 'z' ? p.x - this.position.x : this.position.z - p.z) < 0 ? this.leaves[0] : this.leaves[1];
      return p.y - this.y0 > this.leaves[0].position.y + 1.25 ? this.leaves[0] : this.leaves[1];
    };
    this.prompt = ctx.interactables.add({
      id: `door_${spec.id}`, kind: 'door', prompt: 'Locked', position: new THREE.Vector3(spec.x, this.y0 + 1.3, spec.z), radius: 2.0,
      enabled: this.locked, onUse: () => this.deny(),
    });
    this.ajar = std ? spec.ajar ?? 0 : 0;
    this.apply(0);
    if (this.ajar && !this.locked) { this.t = this.ajar; this.apply(this.t * this.t * (3 - 2 * this.t)); }
    this.refreshStatus();
  }

  /** Animated leaf (std: left / right; wide + cage: upper / lower) — to hang things on. */
  leaf(i: number): THREE.Object3D { return this.leaves[i]; }
  /** Shudder the leaves as if something hit them (`amp` metres, decaying over `seconds`). */
  shake(amp: number, seconds: number) { this.rattle = seconds; this.rattleDur = seconds; this.rattleAmp = amp; this.rattleT = 0; }

  get isOpen() { return this.target === 1; }
  /** REVISION 5: the leaves are fully shut (not merely closing). */
  get closed() { return this.target === 0 && this.t === 0; }
  /** Opening width / height (checks, scripts). */
  get width() { return this.w; }
  get height() { return this.h; }

  setStatus(status: 'cycling' | 'dark' | null) { this.status = status; this.refreshStatus(); }
  /** What the panel shows now. */
  get shown(): DoorStatusShown { return this.status === 'dark' ? 'dark' : this.status === 'cycling' ? 'cycling' : this.locked ? 'locked' : 'open'; }
  /** Jump to the end of the current stroke (checkpoint restore, reachability checks). */
  snap() {
    const goal = this.target === 0 && this.ajar && !this.locked ? this.ajar : this.target;
    this.t = goal;
    this.lastEase = -1;
    this.apply(goal * goal * (3 - 2 * goal));
  }

  open() {
    if (this.locked || this.target === 1) return;
    this.target = 1;
    this.L.ctx.events.emit('door:opening', { id: this.id, position: this.position });
  }
  close() {
    if (this.target === 0) return;
    this.target = 0;
    this.L.ctx.events.emit('door:closing', { id: this.id, position: this.position });
  }
  lock() { this.locked = true; this.close(); this.refreshStatus(); }
  /** Only `unlock()` changes `locked`; a status override stays until `setStatus(null)`. */
  unlock() { this.locked = false; this.deniedArmed = true; this.refreshStatus(); }

  private deny() {
    this.deniedFlash = 0.6;
    this.L.ctx.events.emit('door:denied', { id: this.id, position: this.position });
  }

  private refreshStatus() {
    this.prompt.enabled = this.locked;
    const shown = this.shown;
    if (this.shownKey === shown) return;
    this.shownKey = shown;
    this.prompt.prompt = shown === 'cycling' ? 'Cycling' : shown === 'dark' ? 'No power' : 'Locked';
    const m = this.L.ctx.materials;
    if (shown === 'dark') { m.setScreen(this.statusMat, 'door_locked', { text: ' ' }); this.statusMat.emissiveIntensity = 0; }
    else m.setScreen(this.statusMat, shown === 'cycling' ? 'door_cycling' : shown === 'locked' ? 'door_locked' : 'door_open');
    for (const f of this.statusListeners) f(shown);
  }

  /** Local (x along opening, y) rectangle → world AABB of a blocker. */
  private setBox(i: number, x0: number, x1: number, y0: number, y1: number, on: boolean) {
    const b = this.boxes[i];
    b.enabled = on;
    const p = this.position, th = 0.11, yb = this.y0;
    if (this.spec.wall === 'z') b.box.min.set(p.x + x0, yb + y0, p.z - th), b.box.max.set(p.x + x1, yb + y1, p.z + th);
    else b.box.min.set(p.x - th, yb + y0, p.z - x1), b.box.max.set(p.x + th, yb + y1, p.z - x0);
  }

  private apply(e: number) {
    if (e === this.lastEase) return;
    this.lastEase = e;
    const w = this.w, h = this.h;
    if (this.spec.kind === 'std') {
      const off = e * (w / 2 + 0.02);
      this.leaves[0].position.x = -off;
      this.leaves[1].position.x = off;
      const open = off > w / 2 - 0.05;
      this.setBox(0, -w / 2 - 0.1, -off, 0, h, !open);
      this.setBox(1, off, w / 2 + 0.1, 0, h, !open);
      this.setBox(2, -w / 2 - 0.1, w / 2 + 0.1, 0, h, this.closing);
    } else {
      const up = e * 1.62, down = e * 1.6;
      this.leaves[0].position.y = up;
      this.leaves[1].position.y = -down;
      const lowTop = 1.55 - down;
      this.setBox(0, -w / 2, w / 2, Math.min(1.25 + up, h + 0.2), h + 0.25, e < 0.97);
      this.setBox(1, -w / 2, w / 2, -0.5, Math.max(lowTop, -0.4), lowTop > 0.03);
      this.setBox(2, -w / 2, w / 2, -0.5, h + 0.25, this.closing);
    }
  }

  /**
   * REVISION 5: from the moment a door starts closing its whole opening is solid (a body cannot slip
   * through a closing door; one standing in the doorway is pushed out to the side its centre is on — the
   * blocker is a thin slab, so the push is always along the door normal, never into a leaf).
   */
  private get closing() { return this.target === 0 && this.t > (this.ajar && !this.locked ? this.ajar : 0) + 1e-6; }

  update(dt: number, ctx: GameContext) {
    const player = ctx.player;
    if (this.shown !== this.shownKey) this.refreshStatus();
    let near = false;
    if (player) {
      const pp = player.position;
      const dx = pp.x - this.position.x, dz = pp.z - this.position.z;
      const d2 = dx * dx + dz * dz;
      if (Math.abs(pp.y - this.y0) < 3) {
        if (d2 < 2.6 * 2.6) near = true;
        if (this.locked) {
          if (d2 < 1.35 * 1.35) { if (this.deniedArmed) { this.deniedArmed = false; this.deny(); } }
          else if (d2 > 2.4 * 2.4) this.deniedArmed = true;
        }
      }
    }
    if (!near && !this.locked && this.auto) {
      const en = ctx.enemies?.all;
      if (en) for (let i = 0; i < en.length; i++) {
        const e = en[i];
        if (!e.alive || e.state === 'dormant' || e.state === 'dead') continue;
        const dx = e.position.x - this.position.x, dz = e.position.z - this.position.z;
        if (dx * dx + dz * dz < 2.4 * 2.4 && e.position.y < this.y0 + 3.2) { near = true; break; }
      }
    }
    if (this.auto && !this.locked) {
      if (near) { this.idle = 0; this.open(); }
      else if (this.target === 1) { this.idle += dt; if (this.idle > 1.4) this.close(); }
    }
    if (this.locked && this.target === 1) this.close();

    const goal = this.target === 0 && this.ajar && !this.locked ? this.ajar : this.target;
    if (this.t !== goal) {
      const step = dt / this.duration;
      this.t = goal > this.t ? Math.min(goal, this.t + step) : Math.max(goal, this.t - step);
      // heavy ease: slow start, firm stop
      const x = this.t;
      this.apply(x * x * (3 - 2 * x));
    } else if (this.boxes[2].enabled) this.boxes[2].enabled = false;
    if (this.deniedFlash > 0 || this.rattle > 0) {
      // tiny shudder of the leaves when denied; a hard, decaying rattle when something hits them
      let s = 0, r = 0;
      if (this.deniedFlash > 0) { this.deniedFlash -= dt; if (this.deniedFlash > 0) s = Math.sin(this.deniedFlash * 90) * 0.004 * (this.deniedFlash / 0.6); }
      if (this.rattle > 0) {
        this.rattle -= dt; this.rattleT += dt;
        if (this.rattle > 0) { const k = this.rattle / this.rattleDur; r = Math.cos(this.rattleT * 62) * this.rattleAmp * k * k; }
      }
      const l0 = this.leaves[0], l1 = this.leaves[1];
      if (this.spec.kind === 'std') { l0.position.z = s + r; l1.position.z = -s + r * 0.7; }
      else { l0.position.z = s + r; l1.position.z = s + r * 0.8; l0.rotation.x = -r * 0.5; l1.rotation.x = r * 0.35; }
    }
  }

  // ───────────────────────────────────────── geometry

  private buildFrame(b: Builder, ry: number, root: THREE.Group) {
    const { w, h } = this;
    const sp = this.spec;
    const jw = 0.3, T = 0.2, pr = 0.12;
    b.push(sp.x, 0, sp.z, ry);
    for (const s of [1, -1]) {
      const z0 = s * T, z1 = s * (T + pr);
      const face = s > 0 ? '+z' : '-z';
      for (const side of [-1, 1]) {
        const xc = side * (w / 2 + jw / 2);
        // (the jamb's inner face stands 1 cm into the opening: never coplanar with a thick wall's cut face)
        b.bx('trim_steel', side * (w / 2 - 0.01), 0, z0, side * (w / 2 + jw), h + 0.3, z1);
        b.detail(() => {
          // chevron strip on the inner edge, foot block, bolts
          b.bx('hazard_stripes', xc - side * (jw / 2 - 0.01) - 0.045, 0.3, z1, xc - side * (jw / 2 - 0.01) + 0.045, h - 0.05, z1 + s * 0.006);
          b.bx('painted_dark', xc - jw / 2 - 0.03, 0, z0 + s * 0.012, xc + jw / 2 + 0.03, 0.3, z1 + s * 0.03);
          b.bx('painted_dark', xc + side * 0.02, 0.5, z1, xc + side * 0.12, h - 0.3, z1 + s * 0.025);
          for (let y = 0.45; y < h; y += 0.5) b.inst('bolt', xc + side * 0.07, y + 0.2, z1 + s * 0.025, 0, s > 0 ? 0 : Math.PI, 0, 1.5);
        });
      }
      // lintel
      b.bx('trim_steel', -w / 2 - jw, h - 0.01, z0, w / 2 + jw, h + 0.3, z1);
      b.detail(() => {
        b.bx('painted_dark', -w / 2 - jw - 0.03, h + 0.24, z0 + s * 0.012, w / 2 + jw + 0.03, h + 0.32, z1 + s * 0.03);
        b.bx('hazard_stripes', -w / 2, h, z1, w / 2, h + 0.06, z1 + s * 0.006);
        const label = s > 0 ? sp.labelFront : sp.labelBack;
        const lw = Math.min(w - 0.2, 0.09 * label.length + 0.3);
        b.sign(label, 'label', 0, h + 0.155, z1, lw, 0.13, face);
        // status panel housing on the right-hand jamb (as seen from this side)
        const px = s * (w / 2 + jw / 2 + 0.02);
        b.box('painted_dark', px, 1.4, z1 + s * 0.02, 0.2, 0.3, 0.04);
        b.box('steel_raw', px, 1.3, z1 + s * 0.045, 0.1, 0.05, 0.012);
      });
      // threshold + hazard bands on the floor
      hazardStrip(b, -w / 2 - 0.2, s > 0 ? T + pr + 0.03 : -(T + pr + 0.33), w / 2 + 0.2, s > 0 ? T + pr + 0.33 : -(T + pr + 0.03));
    }
    b.detail(() => {
      b.bx('trim_steel', -w / 2 - jw, -0.05, -(T + pr), w / 2 + jw, 0.012, T + pr); // threshold plate 12 mm proud of the floor
      b.bx('steel_raw', -w / 2, -0.04, -0.09, w / 2, 0.022, -0.07).bx('steel_raw', -w / 2, -0.04, 0.07, w / 2, 0.022, 0.09);
      // reveal liners (leave the leaf slot free)
      // (inside the opening, 2 cm proud of the wall's cut faces — never coplanar with them)
      for (const side of [-1, 1]) for (const s of [-1, 1]) b.bx('trim_steel', side * (w / 2 - 0.02), 0.004, s * 0.085, side * (w / 2), h - 0.02, s * (T - 0.004));
      for (const s of [-1, 1]) b.bx('trim_steel', -w / 2 + 0.02, h - 0.02, s * 0.085, w / 2 - 0.02, h, s * (T - 0.004));
    });
    b.pop();

    // status screens (two quads, one material)
    const quads = [1, -1].map((s) => new THREE.PlaneGeometry(0.15, 0.1)
      .applyMatrix4(new THREE.Matrix4().makeRotationY(s > 0 ? 0 : Math.PI).setPosition(s * (w / 2 + jw / 2 + 0.02), 1.43, s * (T + pr + 0.042))));
    const m = new THREE.Mesh(mergeGeometries(quads, false)!, this.statusMat);
    m.name = `${sp.id}:status`;
    root.add(m);
  }

  /** Frameless doors: only the two status panels (on the caller's housing). */
  private buildPanels(root: THREE.Group) {
    const sp = this.spec, { w } = this;
    const [px, py, pz] = sp.panel ?? [w / 2 + 0.25, 1.43, 0.14];
    const quads = [1, -1].map((s) => new THREE.PlaneGeometry(0.15, 0.1)
      .applyMatrix4(new THREE.Matrix4().makeRotationY(s > 0 ? 0 : Math.PI).setPosition(s * px, py, s * pz)));
    const m = new THREE.Mesh(mergeGeometries(quads, false)!, this.statusMat);
    m.name = `${sp.id}:status`;
    root.add(m);
  }

  private buildLeaves(root: THREE.Group) {
    const L = this.L, sp = this.spec, { w, h } = this;
    const mat: Mat = sp.leafMat ?? 'wall_panel_dark';
    const finish = (b: Builder) => { const g = b.build(); root.add(g); this.leaves.push(g); };
    if (sp.kind === 'std') {
      const sheet = sp.leafStyle === 'sheet';
      for (const side of [-1, 1]) {
        const b = L.part(`${sp.id}:leaf${side}`);
        const x0 = side < 0 ? -w / 2 - 0.02 : 0, x1 = side < 0 ? 0 : w / 2 + 0.02, xc = (x0 + x1) / 2, lw = x1 - x0;
        b.bx(mat, side < 0 ? x0 : 0.012, 0.01, -0.05, side < 0 ? -0.012 : x1, h + 0.02, 0.05); // stops under the edge strip
        b.cast = false; // only the slab throws a shadow: one shadow draw per leaf
        b.bx('trim_steel', side < 0 ? -0.012 : 0, 0.01, -0.056, side < 0 ? 0 : 0.012, h, 0.056);
        for (const f of ['+z', '-z'] as const) {
          const z = f === '+z' ? 0.05 : -0.05, sg = f === '+z' ? 1 : -1;
          if (sheet) {
            // heavy sheet: ribs across, a chevron band at waist height, a kick plate
            for (const ry of [0.35, h * 0.5, h - 0.3]) b.box('trim_steel', xc, ry, z + sg * 0.01, lw - 0.08, 0.08, 0.02);
            b.box('hazard_stripes', xc, h * 0.5 - 0.22, z + sg * 0.004, lw - 0.06, 0.24, 0.008);
            b.box('painted_dark', xc, 0.1, z + sg * 0.012, lw - 0.04, 0.16, 0.024);
            continue;
          }
          panelOn(b, 'trim_steel', xc, 0.55, z, lw - 0.16, 0.8, f, 0.02, 0.03);
          panelOn(b, 'trim_steel', xc, h * 0.75, z, lw - 0.16, h - 1.45, f, 0.02, 0.03);
          b.box('hazard_stripes', xc, h * 0.475, z + sg * 0.004, lw - 0.04, 0.16, 0.008);
          b.box('trim_steel', xc - side * (lw / 2 - 0.16), h * 0.475, z + sg * 0.03, 0.04, 0.3, 0.05);
          b.box(mat, xc, h - 0.07, z + sg * 0.012, lw - 0.1, 0.06, 0.024);
          b.box(mat, xc, 0.08, z + sg * 0.012, lw - 0.06, 0.12, 0.024);
        }
        finish(b);
      }
      return;
    }
    if (sp.kind === 'wide') {
      const up = L.part(`${sp.id}:upper`), lo = L.part(`${sp.id}:lower`);
      const upper: [number, number][] = [[1.52, h + 0.25], [-1.52, h + 0.25], ...ZIG.slice().reverse().map((p) => [p[0] * 1.0133, p[1]] as [number, number])];
      const lower: [number, number][] = [[-1.52, -0.3], [1.52, -0.3], ...ZIG.map((p) => [p[0] * 1.0133, p[1] - 0.006] as [number, number])];
      extrude(up, mat, upper, 0.16, 0, 0, -0.08);
      extrude(lo, mat, lower, 0.16, 0, 0, -0.08);
      up.cast = lo.cast = false; // only the slabs throw shadows
      for (const f of ['+z', '-z'] as const) {
        const z = f === '+z' ? 0.08 : -0.08, sg = f === '+z' ? 1 : -1;
        panelOn(up, 'trim_steel', -0.6, 2.25, z, 0.95, 0.75, f, 0.03, 0.04);
        panelOn(up, 'trim_steel', 0.6, 2.25, z, 0.95, 0.75, f, 0.03, 0.04);
        up.box('hazard_stripes', 0, 1.72, z + sg * 0.005, 3.0, 0.14, 0.01);
        up.box('trim_steel', 0, 2.72, z + sg * 0.02, 3.0, 0.1, 0.04);
        for (const sx of [-1.3, 0, 1.3]) up.box('trim_steel', sx, 2.25, z + sg * 0.03, 0.07, 0.9, 0.06);
        for (const tx of [-0.6, 0.6]) up.box('hazard_stripes', tx, 1.4, z + sg * 0.005, 0.36, 0.22, 0.01);
        if (sp.windows) for (const wx of [-1.22, 1.22]) {
          up.box('trim_steel', wx, 2.25, z + sg * 0.012, 0.26, 0.86, 0.024);
          up.quad('glass', wx, 2.25, z + sg * 0.026, 0.16, 0.72, f, 0, 'box');
        }
        panelOn(lo, 'trim_steel', -0.72, 0.6, z, 1.25, 0.8, f, 0.03, 0.04);
        panelOn(lo, 'trim_steel', 0.72, 0.6, z, 1.25, 0.8, f, 0.03, 0.04);
        lo.box('hazard_stripes', 0, 1.13, z + sg * 0.005, 3.0, 0.14, 0.01);
        lo.box('trim_steel', 0, 0.09, z + sg * 0.02, 3.0, 0.14, 0.04);
        for (const sx of [-1.42, 0, 1.42]) lo.box('trim_steel', sx, 0.6, z + sg * 0.03, 0.07, 0.9, 0.06);
        lo.box('hazard_stripes', 0, 1.4, z + sg * 0.005, 0.36, 0.22, 0.01);
      }
      finish(up); finish(lo);
      return;
    }
    // cage gate
    const grateMat = L.ctx.materials.clone('floor_grate', { side: THREE.DoubleSide });
    const mk = (name: string, y0: number, y1: number, hazardY: number) => {
      const b = L.part(`${sp.id}:${name}`);
      b.quad(grateMat, 0, (y0 + y1) / 2, 0.012, w + 0.04, y1 - y0, '+z', 0, 'box'); // mesh 12 mm off the door plane
      const f = 0.07;
      b.bx('trim_steel', -w / 2 - 0.02, y0, -0.035, w / 2 + 0.02, y0 + f, 0.035).bx('trim_steel', -w / 2 - 0.02, y1 - f, -0.035, w / 2 + 0.02, y1, 0.035);
      for (const x of [-w / 2, -w / 4, 0, w / 4, w / 2]) b.bx('trim_steel', x - f / 2, y0, -0.035, x + f / 2, y1, 0.035);
      b.rod('trim_steel', -w / 2, y0 + 0.05, 0.04, -w / 4, y1 - 0.05, 0.04, 0.012, 5).rod('trim_steel', w / 2, y0 + 0.05, 0.04, w / 4, y1 - 0.05, 0.04, 0.012, 5);
      b.box('hazard_stripes', 0, hazardY, 0, w, 0.1, 0.08);
      finish(b);
    };
    mk('upper', 1.25, h + 0.25, 1.3);
    mk('lower', -0.3, 1.25, 1.2);
  }
}

/** Level 1: all door frames live in two shared zones (north / south half of the level). */
function level1Zone(s: DoorSpec): { name: string; rooms: string[] } {
  const south = s.z < -30;
  return south ? { name: 'frames_s', rooms: ['fab', 'gen', 'pump', 'lobby', 'elevator'] } : { name: 'frames_n', rooms: ['med', 'corr_a', 'quarters', 'junction', 'sec', 'storage', 'airlock', 'fab'] };
}

export function makeDoors(L: LevelBuild, specs: DoorSpec[], zoneOf: (s: DoorSpec) => { name: string; rooms: string[] } = level1Zone): DoorImpl[] {
  return specs.map((s) => {
    // Door frames live in a few shared zones instead of one zone per door: a view with five doorways in
    // it pays ~7 draws for their frames, not ~40.
    const z = zoneOf(s);
    const frames = L.namedBuilder(z.name);
    frames.rooms = z.rooms;
    return new DoorImpl(L, s, frames);
  });
}
