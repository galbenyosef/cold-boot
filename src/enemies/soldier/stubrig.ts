/**
 * Stage 3c §8.2.2 / §8.2.10 (W3b): the soldier RIG INTERFACE (W3a builds the real body to it, W3b's behaviour drives
 * it), a `StubSoldierRig` (boxes for head / torso / limbs; eye / muzzle / chest / nape points) so the behaviour and
 * `scripts/check-soldier.mjs` run before W3a's rig lands, and the check's TEST ARENA (`?soldierArena=1`).
 *
 * Interface notes (decided by W3b where §8.2.2 is silent — the real rig must follow them):
 *  - `root` is parented under the enemy's object, whose transform the behaviour sets: position = feet, rotation.y =
 *    the game yaw (0 looks down −z). The rig's forward is therefore root-local −z.
 *  - `update?(dt)` (optional): called once per frame AFTER setPose / setMove / aim, before reading eye / muzzle / nape
 *    / chest (which are world points valid after it). A rig without `update` must advance itself in those calls.
 *  - `setMove(speed, heading)`: `heading` is a world game-yaw (direction of travel), `speed` m/s.
 *  - In pose `hold`, `aim(p)` turns the head only (the weapon stays low); in every other pose it raises the weapon.
 *  - The rig plays NO sound: every soldier sound is the behaviour's (soldier.ts; §8.11 owner = enemies).
 *  - `die()` resolves when the body lies still; `chest` is still valid afterwards (the corpse point, B2).
 */
import * as THREE from 'three';
import type { CoverPoint, EnemySpawn, GameContext, LightHandle, NavNode } from '../../core/types';
import { hv, type HitVolume } from '../shared/hit';
import { damp } from '../shared/ik';

export type SoldierPose = 'hold' | 'walk' | 'walk_aim' | 'aim' | 'crouch' | 'rise_aim' | 'lean_l' | 'lean_r' | 'reload' | 'flinch' | 'stagger';
export type SoldierDeath = 'fwd' | 'back' | 'side';

export interface SoldierRig {
  readonly root: THREE.Object3D; readonly drawCalls: number; readonly volumes: HitVolume[];   // head, torso, 4 limbs
  setPose(p: SoldierPose, blend?: number): void;       // procedural, blended (human.ts style); no clips
  setMove(speed: number, heading: number): void;       // leg IK; walk ≤ 1.6, retreat ≤ 3.0 m/s
  aim(p: THREE.Vector3 | null): void;                  // torso/arms/head toward p (±70° yaw, +35/−45° pitch); null = low ready
  readonly eye: THREE.Vector3; readonly muzzle: THREE.Vector3; readonly nape: THREE.Vector3; readonly chest: THREE.Vector3;  // world, per frame
  setLight(on: boolean): void;                         // weapon light (spot via ctx.render.lights, no shadow, prio 0.5, 14 m, 0.35 rad)
  setLed(s: 'red' | 'fail' | 'off'): void;            // the Clasp mark: 'red' blinks 1 Hz, 'fail' = 3 fast blinks then off
  fire(): void;                                        // muzzle flash (fx.flash 0.05 s), recoil kick, casing
  die(kind: SoldierDeath, dir: THREE.Vector3): Promise<void>;   // keyed fall 1.2–1.6 s, then still
  speak(seconds: number): void;                        // head/shoulder micro-motion (no jaw)
  lod(level: 0 | 1): void; dispose(): void;
  /** W3b addition (optional, see the header): advance blends / IK and refresh the world points. */
  update?(dt: number): void;
}

/** What the behaviour passes when it asks for a rig (index.ts `makeSoldierRig`). */
export interface SoldierRigOpts { arms: 'pistol' | 'carbine'; name?: string; actor?: boolean; seed: number }

// ───────────────────────────────────────────────────────────── the stub rig

const POSE: Record<SoldierPose, { c: number; l: number; r: number }> = {
  hold: { c: 0, l: 0, r: 0 }, walk: { c: 0, l: 0, r: 0.15 }, walk_aim: { c: 0, l: 0, r: 0.85 }, aim: { c: 0, l: 0, r: 1 },
  crouch: { c: 1, l: 0, r: 0.35 }, rise_aim: { c: 0, l: 0, r: 1 }, lean_l: { c: 0, l: -1, r: 1 }, lean_r: { c: 0, l: 1, r: 1 },
  reload: { c: -1, l: 0, r: 0.2 }, flinch: { c: -1, l: 0, r: 0.5 }, stagger: { c: 0, l: 0, r: 0.1 },
};
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
let stubGeo: { box: THREE.BoxGeometry; ball: THREE.SphereGeometry } | null = null;

/**
 * Boxes on a few pivots, posed procedurally: crouch c (eye 0.85 at c = 1), lean l (±0.35 m), weapon raise r. Hit volumes
 * as the real rig's (head r 0.13 incl. helmet, torso hips → chest, 2 arms, 2 legs). One light (the weapon light) via
 * `ctx.render.lights`, no shadow. The Clasp LED is a small red ball at the nape (blinks 1 Hz, per-soldier phase).
 */
export class StubSoldierRig implements SoldierRig {
  readonly root = new THREE.Group();
  readonly volumes: HitVolume[];
  readonly eye = new THREE.Vector3(); readonly muzzle = new THREE.Vector3(); readonly nape = new THREE.Vector3(); readonly chest = new THREE.Vector3();
  drawCalls = 0;
  private body = new THREE.Group();   // fall pivot (feet)
  private hips = new THREE.Object3D(); private torso = new THREE.Object3D(); private head = new THREE.Object3D();
  private gun = new THREE.Object3D(); private legL = new THREE.Object3D(); private legR = new THREE.Object3D();
  private armL = new THREE.Object3D(); private armR = new THREE.Object3D();
  private led: THREE.Mesh; private lens: THREE.Mesh;
  private ledMat: THREE.MeshBasicMaterial; private lensMat: THREE.MeshBasicMaterial;
  private light: LightHandle | null = null; private lightOn = false;
  private c = 0; private l = 0; private r = 0; private want: SoldierPose = 'hold'; private blendK = 9;
  private flinchT = 0; private staggerT = 0; private recoil = 0; private speakT = 0;
  private aimAt: THREE.Vector3 | null = null; private aimYaw = 0; private aimPitch = 0;
  private moveSpeed = 0; private moveHeading = 0; private gait = 0;
  private ledState: 'red' | 'fail' | 'off' = 'red'; private ledT = 0;
  private dying: { kind: SoldierDeath; t: number; dur: number; side: number; sit: number; resolve: () => void } | null = null;
  private dead = false;
  private time = 0;
  private phase: number;

  constructor(private ctx: GameContext, private o: SoldierRigOpts) {
    if (!stubGeo) stubGeo = { box: new THREE.BoxGeometry(1, 1, 1), ball: new THREE.SphereGeometry(1, 10, 8) };
    this.phase = (o.seed * 0.37) % 1;
    const M = ctx.materials;
    const cloth = M.get('cloth_coverall'), dark = M.get('painted_dark'), gunMat = M.get('gunmetal'), rub = M.get('rubber');
    const box = (parent: THREE.Object3D, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(stubGeo!.box, mat);
      m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true;
      parent.add(m); this.drawCalls++;
      return m;
    };
    this.root.add(this.body);
    this.body.add(this.hips, this.legL, this.legR);
    this.hips.add(this.torso);
    this.torso.add(this.head, this.armL, this.armR, this.gun);
    // legs: pivots at the hips, boxes hanging down 0.95
    box(this.legL, cloth, 0.16, 0.92, 0.18, 0, -0.46, 0); box(this.legR, cloth, 0.16, 0.92, 0.18, 0, -0.46, 0);
    box(this.legL, rub, 0.15, 0.1, 0.28, 0, -0.9, -0.05); box(this.legR, rub, 0.15, 0.1, 0.28, 0, -0.9, -0.05);
    // torso (hips → chest 0.4), vest
    box(this.torso, cloth, 0.38, 0.62, 0.22, 0, 0.3, 0);
    box(this.torso, dark, 0.42, 0.4, 0.28, 0, 0.38, 0);
    // head: balaclava + helmet + goggles
    box(this.head, dark, 0.2, 0.24, 0.22, 0, 0, 0);
    box(this.head, gunMat, 0.26, 0.12, 0.28, 0, 0.1, 0.01);
    box(this.head, rub, 0.18, 0.05, 0.04, 0, 0.02, -0.11);
    // arms (from the shoulders forward to the weapon)
    box(this.armL, cloth, 0.1, 0.1, 0.5, 0, 0, -0.22); box(this.armR, cloth, 0.1, 0.1, 0.5, 0, 0, -0.22);
    // weapon along −z
    const len = o.arms === 'carbine' ? 0.78 : 0.24;
    box(this.gun, gunMat, 0.06, 0.12, len, 0, 0, -len / 2);
    this.lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 3.4), fog: false });
    this.lens = new THREE.Mesh(stubGeo.ball, this.lensMat);
    this.lens.scale.setScalar(0.022); this.lens.position.set(0, -0.06, -len + 0.03); this.lens.visible = false;
    this.gun.add(this.lens); this.drawCalls++;
    this.ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.25, 0.15), fog: false });
    this.led = new THREE.Mesh(stubGeo.ball, this.ledMat);
    this.led.scale.setScalar(0.028); this.led.position.set(0, -0.1, 0.12);
    this.head.add(this.led); this.drawCalls++;
    this.volumes = [
      hv(this.head, [0, 0.02, 0], [0, 0.02, 0], 0.13, 'head', 'head'),
      hv(this.torso, [0, 0.02, 0], [0, 0.36, 0], 0.2, 'torso', 'torso'),
      hv(this.armL, [0, 0, 0], [0, 0, -0.44], 0.07, 'limb', 'arm_l'),
      hv(this.armR, [0, 0, 0], [0, 0, -0.44], 0.07, 'limb', 'arm_r'),
      hv(this.legL, [0, -0.05, 0], [0, -0.88, 0], 0.09, 'limb', 'leg_l'),
      hv(this.legR, [0, -0.05, 0], [0, -0.88, 0], 0.09, 'limb', 'leg_r'),
    ];
    this.pose(0);
  }

  setPose(p: SoldierPose, blend?: number): void {
    if (this.dead || this.dying) return;
    if (p === 'flinch') { this.flinchT = 0.25; return; }
    if (p === 'stagger') { this.staggerT = 0.6; }
    this.want = p;
    this.blendK = blend && blend > 0 ? 3 / blend : 9;
  }
  setMove(speed: number, heading: number): void { this.moveSpeed = speed; this.moveHeading = heading; }
  aim(p: THREE.Vector3 | null): void {
    if (!p) { this.aimAt = null; return; }
    (this.aimAt ??= new THREE.Vector3()).copy(p);
  }
  setLight(on: boolean): void {
    this.lightOn = on;
    if (on && !this.light) {
      try {
        this.light = this.ctx.render.lights.add({ type: 'spot', position: this.muzzle.clone(), target: this.muzzle.clone().add(new THREE.Vector3(0, 0, -5)),
          color: 0xdfe8ff, intensity: 60, distance: 14, angle: 0.35, penumbra: 0.4, castShadow: false, priority: 0.5 });
      } catch { this.light = null; }
    }
    if (this.light) this.light.enabled = on;
    this.lens.visible = on;
  }
  setLed(s: 'red' | 'fail' | 'off'): void { if (s !== this.ledState) { this.ledState = s; this.ledT = 0; } }
  fire(): void {
    this.recoil = 1;
    // the muzzle flash is the rig's (W6 `fx.muzzle`, pooled); a build without it gets a plain flash
    try {
      const fx = this.ctx.fx as unknown as { muzzle?(p: THREE.Vector3, d?: THREE.Vector3): void };
      if (fx.muzzle) { this.gun.getWorldQuaternion(_q); fx.muzzle(this.muzzle, _v.set(0, 0, -1).applyQuaternion(_q)); }
      else this.ctx.fx.flash(this.muzzle, 0xffc27a, 6, 0.05, 6);
    } catch { /* fx optional */ }
  }
  die(kind: SoldierDeath, _dir: THREE.Vector3): Promise<void> {
    this.setLight(false);
    // 'back' with cover within 0.8 m behind him: he sits back against it (as W3a's rig), else falls flat
    let sit = -1;
    if (kind === 'back') {
      this.root.updateWorldMatrix(true, false);
      const o = new THREE.Vector3(0, 0.6, 0).applyMatrix4(this.root.matrixWorld);
      const back = new THREE.Vector3(0, 0, 1).transformDirection(this.root.matrixWorld);
      const h = this.ctx.physics.raycast(o, back, 1.2);
      if (h && h.distance < 0.8 + 0.2) sit = h.distance;
    }
    return new Promise((resolve) => { this.dying = { kind, t: 0, dur: 1.4, side: Math.random() < 0.5 ? -1 : 1, sit, resolve }; });
  }
  speak(seconds: number): void { this.speakT = Math.max(this.speakT, seconds); }
  lod(_level: 0 | 1): void { /* one level */ }
  dispose(): void {
    if (this.light) { this.light.remove(); this.light = null; }
    this.ledMat.dispose(); this.lensMat.dispose();
    this.root.removeFromParent();
  }

  update(dt: number): void {
    this.time += dt;
    this.pose(dt);
  }

  private pose(dt: number): void {
    const P = POSE[this.want];
    const k = dt > 0 ? 1 - Math.exp(-this.blendK * dt) : 1;
    if (P.c >= 0) this.c += (P.c - this.c) * k;
    this.l += (P.l - this.l) * k;
    this.r += (P.r - this.r) * k;
    this.flinchT = Math.max(0, this.flinchT - dt); this.staggerT = Math.max(0, this.staggerT - dt);
    this.recoil = damp(this.recoil, 0, 14, dt);
    this.speakT = Math.max(0, this.speakT - dt);
    this.gait += dt * this.moveSpeed * 5.2;
    const c = this.c, lean = this.l * 0.35;
    // aim: torso yaw / pitch toward the target (root-local), ±70° / +35 −45°
    let ty = 0, tp = 0;
    if (this.aimAt && !this.dying && !this.dead) {
      this.root.updateWorldMatrix(true, false);
      _v.copy(this.aimAt);
      this.root.worldToLocal(_v);
      const hipsY = 0.95 - 0.5 * c;
      const dx = _v.x - lean, dz = _v.z, dy = _v.y - (hipsY + 0.45);
      ty = THREE.MathUtils.clamp(Math.atan2(-dx, -dz), -1.22, 1.22);
      tp = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.79, 0.61);
    }
    const ka = dt > 0 ? 1 - Math.exp(-10 * dt) : 1;
    this.aimYaw += (ty - this.aimYaw) * ka; this.aimPitch += (tp - this.aimPitch) * ka;
    const hold = this.want === 'hold' || this.want === 'walk';
    // body pivots
    const hipsY = 0.95 - 0.5 * c;
    this.hips.position.set(lean * 0.4, hipsY, 0);
    const fl = this.flinchT > 0 ? Math.sin((this.flinchT / 0.25) * Math.PI) * 0.25 : 0;
    const st = this.staggerT > 0 ? Math.sin((this.staggerT / 0.6) * Math.PI) * 0.35 : 0;
    const bend = c * 0.5 + fl * 0.6 - st * 0.4;
    this.torso.position.set(lean * 0.6, 0, 0);
    this.torso.quaternion.setFromEuler(_e.set(-bend, hold ? this.aimYaw * 0.15 : this.aimYaw, -this.l * 0.18 + st * 0.3, 'YXZ'));
    const sp = this.speakT > 0 ? Math.sin(this.time * 9) * 0.03 : 0;
    // head: crouched eye 0.85 (head centre 0.9), standing 1.67
    this.head.position.set(0, 0.72 - 0.24 * c + sp, -0.02);
    this.head.quaternion.setFromEuler(_e.set(hold ? this.aimPitch : this.aimPitch * 0.3, hold ? this.aimYaw * 0.85 : 0, 0, 'YXZ'));
    // weapon: low ready (r 0) → shouldered (r 1), pitched with the aim
    const r = this.r;
    this.gun.position.set(0.12, 0.5 - 0.2 * (1 - r), -0.32 + 0.08 * (1 - r));
    this.gun.quaternion.setFromEuler(_e.set(r * this.aimPitch - (1 - r) * 0.8 + this.recoil * 0.12 + bend, 0, 0, 'YXZ'));
    this.armL.position.set(-0.2, 0.54, -0.02); this.armR.position.set(0.2, 0.54, -0.02);
    const armP = r * this.aimPitch - (1 - r) * 0.7 + bend;
    this.armL.quaternion.setFromEuler(_e.set(armP, 0.35, 0)); this.armR.quaternion.setFromEuler(_e.set(armP, -0.1, 0));
    // legs: crouch folds them (kneel), walking swings them
    const sw = this.moveSpeed > 0.05 ? Math.sin(this.gait) * Math.min(0.6, this.moveSpeed * 0.35) : 0;
    const lh = this.moveSpeed > 0.05 ? this.moveHeading - this.root.parent!.rotation.y : 0;
    this.legL.position.set(-0.11 + lean * 0.4, hipsY, 0); this.legR.position.set(0.11 + lean * 0.4, hipsY, 0);
    this.legL.quaternion.setFromEuler(_e.set(sw - c * 1.2, lh * 0, 0)); this.legR.quaternion.setFromEuler(_e.set(-sw + c * 0.3, 0, 0));
    this.legL.scale.y = 1 - c * 0.25; this.legR.scale.y = 1 - c * 0.45;
    // the fall
    if (this.dying) {
      const d = this.dying;
      d.t += dt;
      const u = Math.min(1, d.t / d.dur), e = u * u;
      const ang = e * Math.PI / 2;
      if (d.kind === 'fwd') this.body.quaternion.setFromEuler(_e.set(-ang, 0, 0));
      else if (d.kind === 'back' && d.sit >= 0) {
        // slide down and lean back against the cover behind
        this.body.quaternion.setFromEuler(_e.set(e * Math.asin(Math.min(0.9, (d.sit + 0.1) / 1.3)), 0, e * 0.25 * d.side));
        this.body.position.set(0, -e * 0.5, e * Math.max(0, d.sit - 0.35));
      }
      else if (d.kind === 'back') this.body.quaternion.setFromEuler(_e.set(ang, 0, 0));
      else this.body.quaternion.setFromEuler(_e.set(0, 0, ang * d.side));
      if (!(d.kind === 'back' && d.sit >= 0)) this.body.position.y = e * 0.13;
      if (u >= 1) { this.dying = null; this.dead = true; d.resolve(); }
    }
    // LED: red 1 Hz blink (per-soldier phase), fail = 3 fast blinks then off
    this.ledT += dt;
    let ledOn = false;
    if (this.ledState === 'red') ledOn = ((this.time + this.phase) % 1) < 0.5;
    else if (this.ledState === 'fail') ledOn = this.ledT < 0.72 && (this.ledT % 0.24) < 0.12;
    this.led.visible = ledOn;
    // world points
    this.root.updateMatrixWorld(true);
    this.eye.set(0, -0.05, -0.1).applyMatrix4(this.head.matrixWorld);
    this.nape.set(0, -0.1, 0.12).applyMatrix4(this.head.matrixWorld);
    this.chest.set(0, 0.38, 0).applyMatrix4(this.torso.matrixWorld);
    const len = this.o.arms === 'carbine' ? 0.78 : 0.24;
    this.muzzle.set(0, 0, -len).applyMatrix4(this.gun.matrixWorld);
    if (this.light) {
      this.light.position.copy(this.muzzle);
      this.gun.getWorldQuaternion(_q);
      this.light.target.set(0, 0, -6).applyQuaternion(_q).add(this.muzzle);
      this.light.enabled = this.lightOn;
    }
  }
}

// ───────────────────────────────────────────────────────────── the check's test arena

/**
 * `?soldierArena=1` (any level; the check uses `?level=5`): a 48 × 48 m greybox far from the level (x 196 … 244,
 * z −24 … 24, floor y 0) with real colliders, a nav grid, cover points in the contract's format (`Level.cover`) and:
 *  - LANE (x 198 … 206): an open firing lane 46 m long (ranges 8 … 35 m) with a 1.0 m crate that can be toggled;
 *  - COVER YARD (x 214 … 242, z −22 … 4): six objects (low crates 1.2 m, high lockers 2.2 m) with ten cover points;
 *  - CRAWL (x 228 … 238, z 15.5 … 18.5): a trench (floor −1.4) under a solid grating slab, exit at its east end
 *    (239.6, 0, 17), with an exit keep-out box (regions `exit_keepout`) — the level's `floorAt` is wrapped so the trench
 *    is a `nav: false` floor with that exit (as W4's crawlway);
 *  - DARK: `regions.dark` boxes the check switches on and off (`arena.dark(on)`).
 * Everything is registered before the enemies' nav graph is built (createEnemies), so the soldier AI sees a level.
 */
export interface SoldierArena {
  origin: [number, number, number];
  lane: { x: number; z0: number; z1: number };
  crate: { on(v: boolean): void; box: THREE.Box3 };
  dark(on: boolean, box?: THREE.Box3): void;
  trench: { box: THREE.Box3; floorY: number; exit: [number, number, number]; keepOut: THREE.Box3 };
  yard: { box: THREE.Box3; cover: string[]; playerSpots: [number, number, number][] };
  backCrate: [number, number, number];
}

export function buildSoldierArena(ctx: GameContext): SoldierArena {
  const level = ctx.level as unknown as {
    colliders: THREE.Mesh[]; nav: NavNode[]; cover: CoverPoint[]; regions: Record<string, THREE.Box3[]>;
    floorAt(p: THREE.Vector3): unknown; navExits?: boolean;
  };
  const group = new THREE.Group();
  group.name = 'soldier_arena';
  ctx.scene.add(group);
  const M = ctx.materials;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const colliders: THREE.Mesh[] = [];
  const solid = (mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, collide = true, surface = 'metal') => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(x1 - x0, y1 - y0, z1 - z0); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.receiveShadow = true; m.castShadow = true;
    group.add(m);
    if (collide) {
      const c = new THREE.Mesh(geo);
      c.scale.copy(m.scale); c.position.copy(m.position); c.updateMatrixWorld(true);
      c.userData.surface = surface;
      colliders.push(c);
    }
    return m;
  };
  const floor = M.get('floor_plate'), wall = M.get('wall_panel'), crateM = M.get('painted_yellow'), lockerM = M.get('painted_dark');
  const X0 = 196, X1 = 244, Z0 = -24, Z1 = 24, H = 4;
  // trench footprint (cut out of the floor slab)
  const TX0 = 228, TX1 = 238, TZ0 = 15.5, TZ1 = 18.5, TY = -1.4;
  solid(floor, X0, -0.3, Z0, X1, 0, TZ0);
  solid(floor, X0, -0.3, TZ1, X1, 0, Z1);
  solid(floor, X0, -0.3, TZ0, TX0, 0, TZ1);
  solid(floor, TX1 + 1.2, -0.3, TZ0, X1, 0, TZ1);
  // walls
  solid(wall, X0 - 0.4, 0, Z0 - 0.4, X0, H, Z1 + 0.4); solid(wall, X1, 0, Z0 - 0.4, X1 + 0.4, H, Z1 + 0.4);
  solid(wall, X0, 0, Z0 - 0.4, X1, H, Z0); solid(wall, X0, 0, Z1, X1, H, Z1 + 0.4);
  // lane divider (separates the lane from the yard: no stray sight between tests)
  solid(wall, 208, 0, Z0, 208.4, H, Z1);
  // trench: floor, side walls (below the deck), the grating slab over it (solid: bullets, sight, nav), the open hatch
  // at its east end (x 238 … 239.2) with a ramp up to the deck
  solid(M.get('floor_plate'), TX0, TY - 0.3, TZ0, TX1 + 1.2, TY, TZ1);
  solid(wall, TX0 - 0.3, TY, TZ0, TX0, 0, TZ1);
  solid(wall, TX0, TY, TZ0 - 0.3, TX1 + 1.2, 0, TZ0); solid(wall, TX0, TY, TZ1, TX1 + 1.2, 0, TZ1 + 0.3);
  const grate = solid(M.get('floor_grate'), TX0, -0.06, TZ0, TX1, 0, TZ1);
  grate.name = 'arena_grating';
  // ramp (a wedge as a few steps) out of the hatch: 1.2 m long, 1.4 up, east wall of the trench
  for (let i = 0; i < 5; i++) solid(M.get('trim_steel'), TX1 + i * 0.24, TY, TZ0, TX1 + 1.2, TY + 0.28 * (i + 1), TZ1);
  // yard objects: crates (low 1.2 m) and lockers (high 2.2 m) — box, height, kind
  const objs: { x0: number; z0: number; x1: number; z1: number; h: number }[] = [
    { x0: 218, z0: -8.6, x1: 220, z1: -7.6, h: 1.2 },   // C1
    { x0: 226, z0: -12.6, x1: 228, z1: -11.6, h: 1.2 }, // C2
    { x0: 234, z0: -8.6, x1: 236, z1: -7.6, h: 1.2 },   // C3
    { x0: 221.5, z0: -17, x1: 222.3, z1: -15.6, h: 2.2 }, // L1
    { x0: 231.7, z0: -17, x1: 232.5, z1: -15.6, h: 2.2 }, // L2
    { x0: 238, z0: -15.6, x1: 240, z1: -14.6, h: 1.2 },  // C4
  ];
  for (const o of objs) solid(o.h > 1.5 ? lockerM : crateM, o.x0, 0, o.z0, o.x1, o.h, o.z1);
  // the back crate for the 'back' death against cover (radio case)
  solid(crateM, 222, 0, 8, 224, 1.2, 9);
  // the lane crate (toggled: a dynamic box + its mesh)
  const crateBox = new THREE.Box3(new THREE.Vector3(200.5, 0, 0), new THREE.Vector3(203.5, 1.0, 0.6));
  const crateMesh = solid(crateM, crateBox.min.x, 0, crateBox.min.z, crateBox.max.x, 1.0, crateBox.max.z, false);
  crateMesh.visible = false;
  const crateBody = ctx.physics.addBox(crateBox.clone(), 'metal');
  crateBody.enabled = false;
  // cover points in the contract's format: 0.55 m from the face along −n (n points at the threat side, +z here)
  const cv = (id: string, x: number, z: number, nx: number, nz: number, h: 'low' | 'high'): CoverPoint =>
    ({ id, position: new THREE.Vector3(x, 0, z), normal: new THREE.Vector3(nx, 0, nz), height: h, room: 'arena', set: 'yard' });
  const cover: CoverPoint[] = [
    cv('cva_1', 219, -9.15, 0, 1, 'low'), cv('cva_2', 227, -13.15, 0, 1, 'low'), cv('cva_3', 235, -9.15, 0, 1, 'low'),
    cv('cva_4', 221.9, -17.55, 0, 1, 'high'), cv('cva_5', 232.1, -17.55, 0, 1, 'high'), cv('cva_6', 239, -16.15, 0, 1, 'low'),
    cv('cva_7', 219, -7.05, 0, -1, 'low'), cv('cva_8', 235, -7.05, 0, -1, 'low'),
    cv('cva_9', 220.95, -16.3, 1, 0, 'high'), cv('cva_10', 233.05, -16.3, -1, 0, 'high'),
  ];
  // nav grid (1 m) on the deck, off obstacles and the trench; 8-neighbour links walked at shin height
  const nodes: NavNode[] = [];
  const baseId = (level.nav ?? []).reduce((m, n) => Math.max(m, n.id), 0) + 1000;
  ctx.physics.build([...level.colliders, ...colliders]);
  level.colliders.push(...colliders);
  const idx = new Map<string, number>();
  const probe = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
  for (let x = X0 + 0.5; x < X1; x += 1) {
    for (let z = Z0 + 0.5; z < Z1; z += 1) {
      probe.set(x, 1.0, z);
      if (ctx.physics.resolveSphere(probe, 0.42)) continue;
      probe.set(x, 0.5, z);
      if (ctx.physics.resolveSphere(probe, 0.42)) continue;
      probe.set(x, 0.5, z);
      const hit = ctx.physics.raycast(probe, DOWN, 0.8);
      if (!hit || Math.abs(hit.point.y) > 0.05) continue;
      idx.set(`${x},${z}`, nodes.length);
      nodes.push({ id: baseId + nodes.length, position: new THREE.Vector3(x, 0, z), links: [], room: 'arena' });
    }
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const n of nodes) {
    for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const j = idx.get(`${n.position.x + dx},${n.position.z + dz}`);
      if (j === undefined) continue;
      const m = nodes[j];
      a.set(n.position.x, 0.35, n.position.z); b.set(m.position.x, 0.35, m.position.z);
      if (!ctx.physics.lineOfSight(a, b)) continue;
      a.y = 1.0; b.y = 1.0;
      if (!ctx.physics.lineOfSight(a, b)) continue;
      n.links.push(m.id); m.links.push(n.id);
    }
  }
  (level.nav as NavNode[]).push(...nodes);
  // a hold group for the check's re-spawn case (as level 5's g5_s1: spawn-mode, pose 'hold', pistol)
  const spawns = (ctx.level as unknown as { enemySpawns: EnemySpawn[] }).enemySpawns;
  if (Array.isArray(spawns)) spawns.push({ id: 'ga_hold_1', type: 'soldier', group: 'ga_hold', mode: 'spawn', pose: 'hold', arms: 'pistol', cover: 'yard', position: new THREE.Vector3(204, 0, -18), yaw: Math.PI });
  level.cover = [...(level.cover ?? []), ...cover];
  // regions: dark (switchable) and the exit keep-out
  const regions = level.regions as Record<string, THREE.Box3[]>;
  const keepOut = new THREE.Box3(new THREE.Vector3(238.6, -0.5, 16.4), new THREE.Vector3(241.0, 2, 17.6));
  regions.exit_keepout = [...(regions.exit_keepout ?? []), keepOut];
  const darkBoxes = (regions.dark ??= []);
  // the trench is a nav:false floor with one exit (the ramp top)
  const trenchBox = new THREE.Box3(new THREE.Vector3(TX0, TY - 0.5, TZ0), new THREE.Vector3(TX1 + 1.2, -0.1, TZ1));
  const exit: [number, number, number] = [239.6, 0, 17];
  const baseFloorAt = level.floorAt.bind(level);
  const exitV = [new THREE.Vector3(...exit)];
  level.floorAt = (p: THREE.Vector3) => {
    if (trenchBox.containsPoint(p)) return { room: 'arena_crawl', floor: 0, y: TY, nav: false, exits: exitV };
    return baseFloorAt(p);
  };
  level.navExits = true;
  // light: four bright points, no shadows (the arena is a test room, not a look)
  for (const [x, z] of [[202, -12], [202, 8], [220, -14], [236, -14], [220, 2], [236, 2]]) {
    try { ctx.render.lights.add({ type: 'point', position: new THREE.Vector3(x, 3.7, z), color: 0xfff0e0, intensity: 260, distance: 24, castShadow: false, priority: 2 }); } catch { /* render optional */ }
  }
  let darkBox: THREE.Box3 | null = null;
  return {
    origin: [X0, 0, Z0],
    lane: { x: 202, z0: -22, z1: 22 },
    crate: {
      box: crateBox,
      on(v: boolean) { crateBody.enabled = v; crateMesh.visible = v; },
    },
    dark(on: boolean, box?: THREE.Box3) {
      if (darkBox) { const i = darkBoxes.indexOf(darkBox); if (i >= 0) darkBoxes.splice(i, 1); darkBox = null; }
      if (on) { darkBox = box ?? new THREE.Box3(new THREE.Vector3(196, -1, -24), new THREE.Vector3(208, 4, 24)); darkBoxes.push(darkBox); }
    },
    trench: { box: trenchBox, floorY: TY, exit, keepOut },
    yard: { box: new THREE.Box3(new THREE.Vector3(214, 0, -22), new THREE.Vector3(242, 3, 4)), cover: cover.map((c) => c.id), playerSpots: [[227, 0, 6], [218, 0, 8], [236, 0, 8], [227, 0, 12]] },
    backCrate: [223, 0, 7.45],
  };
}
