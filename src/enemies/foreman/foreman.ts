/**
 * FOREMAN runtime (REVISION 4 boss).
 *   dormant 'folded' (a parked machine) → unfold (heads lift one by one, three staff voices out of sync) → fight.
 *   Attacks, all telegraphed: sweeping SLAM (manipulator rises high, claw opens, eyes + hub light flare; 30 dmg + knock-back
 *   in a 3.4 m / ±75° arc), THROW (pulls a crate off its back, lobs it in a visible arc at a marked spot; 22 dmg splash),
 *   CHARGE (tracks rev, hub ducks; straight rush along a lane; 25 dmg + knock-back; stunned if it hits a wall).
 *   Weak points: three heads (head_a|head_b|head_c, 200 hp each, full damage). Everything else does 25 % (split over the
 *   living heads). Manipulators can be shot off (arm_l / arm_r). Each lost head = next phase (faster, more erratic).
 */
import * as THREE from 'three';
import type { EnemyType, LightHandle } from '../../core/types';
import { EnemyBase, type EnemyWorld, type HitBurst } from '../ai';
import type { FactoryOpts } from '../manager';
import { hv, type HitVolume } from '../shared/hit';
import { angleDiff, damp, noise1, smooth, spring, type Spring } from '../shared/ik';
import type { Rig } from '../shared/rig';
import { sayChorus } from '../voice';
import { FOREMAN_DIM as F, TORSOS, type ForemanTemplate } from './model';

type Mode = 'puppet' | 'dormant' | 'hoist' | 'wake' | 'chase' | 'slam_wind' | 'slam_strike' | 'slam_recover' | 'throw_reach' | 'throw_wind' | 'throw_release'
  | 'charge_wind' | 'charge' | 'charge_recover' | 'stun' | 'swipe' | 'stagger' | 'dying' | 'dead';

export const FOREMAN = {
  headHp: 200, bodyMult: 0.25, armHp: 150, smallArmHp: 45,
  slamDmg: 30, slamRange: 3.4, slamArc: 75 * Math.PI / 180, throwDmg: 22, throwRadius: 1.5, chargeDmg: 25, chargeSpeed: 7.5, swipeDmg: 15,
};
const PHASES = [
  { speed: 0.95, turret: 1.1, slamWind: 1.15, throwWind: 1.0, chargeWind: 1.05, slamCd: 2.4, throwCd: 5.0, chargeCd: 10, lead: 0.0, flight: 1.2, erratic: 0 },
  { speed: 1.25, turret: 1.6, slamWind: 0.95, throwWind: 0.85, chargeWind: 0.9, slamCd: 1.9, throwCd: 3.8, chargeCd: 7, lead: 0.3, flight: 1.05, erratic: 0.5 },
  { speed: 1.55, turret: 2.2, slamWind: 0.8, throwWind: 0.72, chargeWind: 0.75, slamCd: 1.4, throwCd: 3.0, chargeCd: 5.5, lead: 0.5, flight: 0.95, erratic: 1 },
];
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const SIDES = ['l', 'r'] as const;

interface Arm { pitch: number; sweep: number; out: number; elbow: number; wrist: number; open: number }
const ARM_REST: Arm = { pitch: -0.4, sweep: 0, out: 0.08, elbow: 0.75, wrist: 0.25, open: 0.15 };

/** A thrown crate: ballistic, tumbling, with a ground marker where it will land. */
class Crate {
  mesh: THREE.Mesh; ring: THREE.Mesh;
  t = 0; done = false;
  readonly p0 = new THREE.Vector3(); readonly p1 = new THREE.Vector3(); readonly pos = new THREE.Vector3();
  constructor(private f: Foreman, from: THREE.Vector3, to: THREE.Vector3, public T: number, geo: { box: THREE.BufferGeometry; ring: THREE.BufferGeometry }, mat: THREE.Material, ringMat: THREE.Material) {
    this.mesh = new THREE.Mesh(geo.box, mat); this.mesh.castShadow = true;
    this.ring = new THREE.Mesh(geo.ring, ringMat); this.ring.rotation.x = -Math.PI / 2;
    this.p0.copy(from); this.p1.copy(to); this.pos.copy(from);
    this.ring.position.set(to.x, to.y + 0.03, to.z);
    f.scene.add(this.mesh, this.ring);
  }
  step(dt: number): void {
    this.t += dt;
    const u = Math.min(1, this.t / this.T);
    const prev = _v3.copy(this.pos);
    const apex = 2.2 + this.p0.distanceTo(this.p1) * 0.12;
    this.pos.lerpVectors(this.p0, this.p1, u);
    this.pos.y += Math.sin(Math.PI * u) * apex;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this.t * 5.1, this.t * 3.3, this.t * 1.7);
    const pulse = 0.6 + 0.4 * Math.sin(this.t * 22);
    this.ring.scale.setScalar(1.15 - 0.35 * u);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.35 * pulse * u;
    // hit a wall / ceiling on the way?
    _v2.copy(this.pos).sub(prev);
    const len = _v2.length();
    if (u > 0.08 && len > 1e-4) {
      const hit = this.f.world_().ctx.physics.raycast(prev, _v2.multiplyScalar(1 / len), len + 0.3);
      if (hit) { this.pos.copy(hit.point); this.impact(); return; }
    }
    if (u >= 1) this.impact();
  }
  impact(): void {
    if (this.done) return;
    this.done = true;
    this.f.crateImpact(this.pos);
    this.mesh.removeFromParent(); this.ring.removeFromParent();
  }
  dispose(): void { this.mesh.removeFromParent(); this.ring.removeFromParent(); this.done = true; }
}

let crateGeo: { box: THREE.BufferGeometry; ring: THREE.BufferGeometry } | null = null;

export class Foreman extends EnemyBase {
  readonly type = 'foreman' as const;
  private rig: Rig;
  private B: Record<string, THREE.Bone>;
  mode: Mode = 'chase';
  private modeTime = 0;
  private seed: number;
  /** Per head: hp (0 = destroyed). */
  readonly headHp = [FOREMAN.headHp, FOREMAN.headHp, FOREMAN.headHp];
  private armHp = [FOREMAN.armHp, FOREMAN.armHp];
  private armGone = [false, false];
  private smallHp: Record<string, number> = {};
  private turretYaw = 0;
  private fold = 1;
  private headLift = [0, 0, 0];
  private hubBow = 0; private hubRoll: Spring = { x: 0, v: 0 }; private hubPitch: Spring = { x: 0, v: 0 };
  private arms: Arm[] = [{ ...ARM_REST }, { ...ARM_REST }];
  private atkSide = 1; // 0 = left, 1 = right manipulator
  private cd = { slam: 2, throw: 3, charge: 6, swipe: 0 };
  private struck = false;
  private readonly chargeDir = new THREE.Vector3(); private chargeStart = new THREE.Vector3(); private chargeLast = new THREE.Vector3(); private chargeStall = 0;
  private wheelRot = 0; private stepDist = 0; private lastPos = new THREE.Vector3();
  private headY: Spring[] = [{ x: 0, v: 0 }, { x: 0, v: 0 }, { x: 0, v: 0 }];
  private headP: Spring[] = [{ x: 0, v: 0 }, { x: 0, v: 0 }, { x: 0, v: 0 }];
  private eyeGlow = 0; private flare = 0;
  private light: LightHandle | null = null;
  private crates: Crate[] = [];
  private held: THREE.Mesh | null = null;
  private knockT = 0; private readonly knockV = new THREE.Vector3();
  private wakeRate = 1;
  private readonly isPuppet: boolean;
  private pTarget = new THREE.Vector3(); private pDone: (() => void) | null = null; private pMoving = false; private pSpeed = 1;
  private crateMat: THREE.Material | null = null; private ringMat: THREE.MeshBasicMaterial | null = null;
  /** REVISION 5 'hoist' arrival: floor height, the cable frame it hangs in, frame release time. */
  private hoistFloor = 0; private hoistFrame: THREE.Group | null = null; private hoistCables: THREE.Mesh[] = []; private released = -1;

  constructor(world: EnemyWorld, private tpl: ForemanTemplate, group: string, position: THREE.Vector3, yaw: number, o: FactoryOpts) {
    super(world, group, position, yaw, 0.85, 2.6);
    this.isActor = !!o.actor;
    this.isPuppet = this.isActor;
    this.seed = this.id * 5.13;
    this.health = FOREMAN.headHp * 3;
    this.eyeHeight = 2.4;
    this.boundCenterY = 1.3; this.boundRadius = 2.4;
    this.rig = tpl.rig.instantiate();
    this.B = this.rig.byName;
    this.lodRig = this.rig;
    this.object.add(this.rig.root);
    const B = this.B;
    this.volumes = [
      hv(B.head_a, [0, 0.1, 0.02], [0, 0.1, 0.02], 0.155, 'head_a', 'head_a'),
      hv(B.head_b, [0, 0.1, 0.02], [0, 0.1, 0.02], 0.155, 'head_b', 'head_b'),
      hv(B.head_c, [0, 0.1, 0.02], [0, 0.1, 0.02], 0.155, 'head_c', 'head_c'),
      ...TORSOS.map((k) => hv(B['spine_' + k], [0, 0.05, 0], [0, 0.38, 0], 0.17, 'torso', 'torso')),
      hv(B.hub, [-0.45, 0.24, 0], [0.45, 0.24, 0], 0.13, 'torso', 'torso'),
      hv(B.column, [0, -0.3, 0], [0, 0.84, 0], 0.17, 'torso', 'torso'),
      hv(B.mup_l, [0, 0, 0], [0, -F.mUpper, 0], 0.11, 'arm', 'arm_l'), hv(B.mfo_l, [0, 0, 0], [0, -F.mFore, 0], 0.1, 'arm', 'arm_l'), hv(B.mcl_l, [0, -0.1, 0.02], [0, -0.1, 0.02], 0.13, 'arm', 'arm_l'),
      hv(B.mup_r, [0, 0, 0], [0, -F.mUpper, 0], 0.11, 'arm', 'arm_r'), hv(B.mfo_r, [0, 0, 0], [0, -F.mFore, 0], 0.1, 'arm', 'arm_r'), hv(B.mcl_r, [0, -0.1, 0.02], [0, -0.1, 0.02], 0.13, 'arm', 'arm_r'),
      hv(B.base, [0, 0.42, -0.62], [0, 0.42, 0.62], 0.36, 'base', 'base'),
      hv(B.base, [F.trackX, 0.2, -0.7], [F.trackX, 0.2, 0.7], 0.2, 'base', 'base'), hv(B.base, [-F.trackX, 0.2, -0.7], [-F.trackX, 0.2, 0.7], 0.2, 'base', 'base'),
      hv(B.turret, [0, 0.05, 0], [0, 0.45, 0], 0.3, 'base', 'base'),
    ];
    for (const k of ['b', 'c']) for (const s of SIDES) {
      this.volumes.push(hv(B[`uarm_${k}_${s}`], [0, 0, 0], [0, -F.uarm, 0], 0.06, 'arm', `sa_${k}_${s}`));
      this.volumes.push(hv(B[`larm_${k}_${s}`], [0, 0, 0], [0, -F.larm, 0], 0.055, 'arm', `sa_${k}_${s}`));
      this.smallHp[`sa_${k}_${s}`] = FOREMAN.smallArmHp;
    }
    const dormant = o.dormant && !this.isActor;
    this.lastPos.copy(position);
    if (this.isPuppet) { this.mode = 'puppet'; this.state = 'idle'; this.fold = o.pose === 'folded' ? 1 : 0; this.headLift = this.fold ? [0, 0, 0] : [1, 1, 1]; }
    else if (dormant) { this.mode = 'dormant'; this.state = 'dormant'; this.fold = 1; }
    else if (o.pose === 'hoist') this.startHoist();
    else { this.mode = 'chase'; this.state = 'chase'; this.awake = true; this.fold = 0; this.headLift = [1, 1, 1]; this.eyeGlow = 1; this.startLoop('foreman_loop', 0.9); this.makeLight(); }
    this.pose(0.016);
    this.emit('enemy:spawned');
  }

  /** Living heads (UI pips read this defensively). */
  get heads(): number { let n = 0; for (const h of this.headHp) if (h > 0) n++; return n; }
  get headsAlive(): boolean[] { return this.headHp.map((h) => h > 0); }
  get phase(): number { return Math.min(2, 3 - this.heads); }
  get scene(): THREE.Scene { return this.world.ctx.scene; }
  world_(): EnemyWorld { return this.world; }

  private makeLight(): void {
    if (this.light) return;
    try { this.light = this.world.ctx.render.lights.add({ type: 'point', position: this.body.position.clone().setY(this.body.position.y + 2), color: 0xff2a12, intensity: 1.2, distance: 5, priority: 0.6 }); } catch { this.light = null; }
  }

  private setMode(m: Mode): void {
    this.mode = m; this.modeTime = 0; this.struck = false;
    this.setState(m === 'dormant' ? 'dormant' : m === 'puppet' ? 'idle' : m === 'wake' ? 'alert' : m === 'chase' ? 'chase'
      : m === 'stagger' || m === 'stun' ? 'stagger' : m === 'dying' || m === 'dead' ? 'dead' : 'attack');
  }

  protected enterAlert(): void { /* always hunting once awake */ }

  // ───────────────────────────────────────────── update

  update(dt: number): void {
    this.stateTime += dt; this.modeTime += dt;
    this.tickCrates(dt);
    this.tickKnock(dt);
    if (this.mode === 'puppet') { this.tickPuppet(dt); this.pose(dt); return; }
    if (this.mode === 'dormant') {
      if (this.wakeDelay >= 0) { this.wakeDelay -= dt; if (this.wakeDelay <= 0) this.beginWake(1); }
      return;
    }
    if (this.released < 0 && this.hoistFrame && this.mode !== 'hoist') { this.released = 0; this.body.gravityScale = 1; } // died on the cables
    this.tickFrame(dt);
    if (this.mode === 'hoist') { this.tickHoist(dt); this.pose(dt); this.tickLoop(dt); return; }
    if (this.mode === 'dead') { if (this.crates.length === 0 && this.knockT <= 0 && !this.hoistFrame) this.settled = true; return; }
    this.perceive(dt);
    for (const k of Object.keys(this.cd) as (keyof typeof this.cd)[]) this.cd[k] -= dt;
    switch (this.mode) {
      case 'wake': this.tickWake(dt); break;
      case 'chase': this.tickChase(dt); break;
      case 'slam_wind': case 'slam_strike': case 'slam_recover': this.tickSlam(dt); break;
      case 'throw_reach': case 'throw_wind': case 'throw_release': this.tickThrow(dt); break;
      case 'charge_wind': case 'charge': case 'charge_recover': this.tickCharge(dt); break;
      case 'swipe': this.tickSwipe(dt); break;
      case 'stun': case 'stagger': this.tickStagger(dt); break;
      case 'dying': this.tickDying(dt); break;
    }
    this.tracks(dt);
    this.pose(dt);
    this.tickLoop(dt);
  }

  override wake(delay = 0): void {
    if (!this.alive || this.awake || this.wakeDelay >= 0) return;
    this.wakeDelay = Math.max(0, delay);
  }

  private beginWake(rate: number): void {
    this.awake = true; this.wakeDelay = -1; this.wakeRate = rate;
    this.setMode('wake');
    this.startLoop('foreman_loop', 0.9);
    this.makeLight();
    if (this.light) this.light.intensityScale = 0;
    this.world.ctx.events.emit('enemy:woke', { id: this.id, type: this.type, position: this.body.position });
    try { this.world.ctx.audio.play('metal_groan', { position: this.body.position }); } catch { /* */ }
  }

  // ───────────────────────────────────────────── REVISION 5: hoist arrival

  /**
   * Lowered folded on its own cable frame from ≈ 7 m above its spawn point to the floor in ≈ 3 s (monorail trolley
   * above is the level's `foreman_arrive` vignette); the frame releases and is winched back up; it unfolds. It is a
   * live, damageable enemy the whole time. The landing knocks the player back (never crushes).
   */
  private startHoist(): void {
    const p = this.body.position;
    this.hoistFloor = p.y;
    p.y += 7;
    this.object.position.copy(p);
    this.mode = 'hoist'; this.state = 'alert'; this.modeTime = 0;
    this.awake = true; this.fold = 1; this.headLift = [0, 0, 0]; this.eyeGlow = 0;
    this.body.gravityScale = 0;
    this.startLoop('foreman_loop', 0.5);
    // the frame: a steel rectangle over the folded body on four short slings, four cables up to the trolley
    const M = this.world.ctx.materials;
    const steel = M.get('steel_raw'), cableM = M.get('rubber'), paint = M.get('painted_orange');
    const g = new THREE.Group();
    const bar = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh;
    };
    const FX = 0.95, FZ = 1.05, FY = 2.75;
    bar(FX * 2 + 0.12, 0.12, 0.12, 0, FY, -FZ, paint); bar(FX * 2 + 0.12, 0.12, 0.12, 0, FY, FZ, paint);
    bar(0.12, 0.12, FZ * 2, -FX, FY, 0, paint); bar(0.12, 0.12, FZ * 2, FX, FY, 0, paint);
    bar(0.1, 0.1, FZ * 2, 0, FY + 0.02, 0, steel);
    // slings down to the base corners
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const a = new THREE.Vector3(sx * FX, FY, sz * FZ), b = new THREE.Vector3(sx * 0.55, 0.62, sz * 0.62);
      const len = a.distanceTo(b);
      const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, len, 6), cableM);
      sl.position.copy(a).add(b).multiplyScalar(0.5);
      sl.quaternion.setFromUnitVectors(Y, _v.copy(a).sub(b).normalize());
      sl.userData.sling = true;
      g.add(sl);
    }
    // cables up (scaled to reach the trolley height every frame)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 6), cableM);
      c.position.set(sx * FX * 0.9, FY, sz * FZ * 0.9);
      g.add(c);
      this.hoistCables.push(c);
    }
    g.position.copy(p);
    g.rotation.y = this.yaw + Math.PI;
    this.world.ctx.scene.add(g);
    this.hoistFrame = g;
    this.updateCables();
  }

  /** Cables from the frame up to y = floor + 10.4 (the monorail). */
  private updateCables(): void {
    const g = this.hoistFrame;
    if (!g) return;
    const top = this.hoistFloor + 10.4;
    for (const c of this.hoistCables) {
      const y0 = g.position.y + 2.75;
      const len = Math.max(0.05, top - y0);
      c.scale.set(1, len, 1);
      c.position.y = 2.75 + len / 2;
    }
  }

  private tickHoist(dt: number): void {
    const w = this.world, p = this.body.position;
    const T = 3.0, t = this.modeTime;
    // lowered with a winch's rhythm: fast, then braking; sways a little on the cables
    const k = Math.min(1, t / T);
    const e = 1 - Math.pow(1 - k, 2.2);
    p.y = this.hoistFloor + 7 * (1 - e);
    this.hubRoll.v += noise1(t * 1.3, this.seed + 3) * 0.6 * dt * (1 - k);
    if (this.hoistFrame) { this.hoistFrame.position.copy(p); this.updateCables(); }
    if (this.eyeGlow < 0.15) this.eyeGlow = 0.15 * smooth(t / 1.5);
    if (k >= 1) {
      p.y = this.hoistFloor;
      // landing: dust, thump, shake, knock the player clear
      try {
        w.ctx.fx.smoke(p, { count: 10, size: 1.0, color: 0x3a3a3b, rise: 0.25, life: 1.6 });
        w.ctx.audio.play('foreman_slam', { position: p });
      } catch { /* */ }
      const dx = w.playerPos.x - p.x, dz = w.playerPos.z - p.z, d = Math.hypot(dx, dz);
      if (w.playerAlive && Math.abs(w.playerPos.y - p.y) < 2.5) {
        try { w.ctx.player.shake(THREE.MathUtils.clamp(1.1 - d / 8, 0.15, 0.9)); } catch { /* */ }
        if (d < 3.2) {
          const nx = d > 0.05 ? dx / d : 1, nz = d > 0.05 ? dz / d : 0;
          // inside the footprint: shove out first so it never ends up standing in the machine
          if (d < 1.6) try { w.ctx.player.teleport(_v.set(p.x + nx * 1.7, w.playerPos.y, p.z + nz * 1.7)); } catch { /* */ }
          this.knock(nx, nz, 7);
          try { w.ctx.player.damage(5, p); } catch { /* */ }
        }
      }
      this.released = 0;
      this.body.gravityScale = 1;
      this.body.velocity.set(0, 0, 0);
      this.emit('enemy:step'); this.emit('enemy:step');
      this.beginWake(1);
    }
  }

  /** After the landing the slings drop free and the frame is winched back up and out of sight. */
  private tickFrame(dt: number): void {
    const g = this.hoistFrame;
    if (!g || this.released < 0) return;
    this.released += dt;
    const t = this.released;
    if (t > 0.35) {
      for (const c of g.children) if (c.userData.sling) c.visible = false;
      g.position.y += dt * Math.min(3.2, (t - 0.35) * 3);
      this.updateCables();
    }
    if (t > 4.5 || g.position.y > this.hoistFloor + 9) this.disposeFrame();
  }

  private disposeFrame(): void {
    const g = this.hoistFrame;
    if (!g) return;
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    g.removeFromParent();
    this.hoistFrame = null; this.hoistCables = [];
  }

  /** ≈3.6 s: servo shudder → column rises → heads lift one by one (eyes ignite, three voices) → arms unfold. */
  private tickWake(dt: number): void {
    const t = this.modeTime * this.wakeRate, w = this.world;
    this.fold = 1 - smooth((t - 0.5) / 1.8);
    this.hubRoll.v += t < 0.6 ? noise1(t * 30, this.seed) * 2 * dt * 60 * 0.02 : 0;
    for (let i = 0; i < 3; i++) {
      const t0 = 1.3 + i * 0.45;
      this.headLift[i] = smooth((t - t0) / 0.5);
      if (t >= t0 + 0.15 && t - dt * this.wakeRate < t0 + 0.15) { this.eyePulse(); this.headY[i].v += (w.rand() - 0.5) * 20; }
    }
    if (t >= 1.5 && t - dt * this.wakeRate < 1.5) this.chorus(-1);
    this.eyeGlow = smooth((t - 1.4) / 1.2);
    if (this.light) this.light.intensityScale = this.eyeGlow;
    this.moveGround(dt, 0, 0, 0, 6);
    if (t > 3.6) { this.emit('enemy:alerted'); this.setMode('chase'); this.cd.slam = 0.8; this.cd.throw = 2.5; this.cd.charge = 7; }
  }

  private eyePulse(): void { this.flare = Math.max(this.flare, 0.6); }

  private P() { return PHASES[this.phase]; }

  /** World yaw the turret (front torso + manipulators) faces. */
  private turretWorldYaw(): number { return this.yaw + this.turretYaw; }
  private yawTo(x: number, z: number): number { const p = this.body.position; return Math.atan2(-(x - p.x), -(z - p.z)); }

  private turnTurret(dt: number, rate: number): number {
    const w = this.world, P = this.P();
    let want = angleDiff(this.yawTo(w.playerPos.x, w.playerPos.z), this.yaw);
    if (P.erratic > 0) want += noise1(w.time * 2.2, this.seed + 7) * 0.12 * P.erratic;
    want = THREE.MathUtils.clamp(want, -2.4, 2.4);
    const d = want - this.turretYaw;
    this.turretYaw += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    return Math.abs(angleDiff(this.yawTo(w.playerPos.x, w.playerPos.z), this.turretWorldYaw()));
  }

  private armsAlive(): number { return (this.armGone[0] ? 0 : 1) + (this.armGone[1] ? 0 : 1); }

  private tickChase(dt: number): void {
    const w = this.world, p = this.body.position, P = this.P();
    if (!w.playerAlive) { this.moveGround(dt, 0, 0, 0, 3); return; }
    const err = this.turnTurret(dt, P.turret);
    const hd = Math.hypot(w.playerPos.x - p.x, w.playerPos.z - p.z);
    // attack choice (all of them readable from far away)
    if (hd < FOREMAN.slamRange - 0.1 && err < 0.5 && this.cd.slam <= 0 && this.armsAlive() > 0) { this.startSlam(); return; }
    if (hd < 2.6 && this.armsAlive() === 0 && this.cd.swipe <= 0 && err < 0.6) { this.setMode('swipe'); this.emitAttack('melee'); return; }
    if (hd > 6 && hd < 18 && this.seesPlayer && this.cd.throw <= 0 && this.armsAlive() > 0 && err < 0.35) { this.startThrow(); return; }
    // drive (tank-style: turn the chassis, then go)
    this.navigate(dt, 0.4);
    const wantYaw = this.yawTo(this.waypoint.x, this.waypoint.z);
    const rem = angleDiff(wantYaw, this.yaw);
    const canCharge = hd > 7.5 && hd < 16 && this.seesPlayer && this.cd.charge <= 0 && this.direct && Math.abs(rem) < 0.2 && err < 0.25 && w.nav.walkable(p, w.playerPos, 0.4);
    if (canCharge) { this.startCharge(); return; }
    const turn = Math.sign(rem) * Math.min(Math.abs(rem), 0.9 * dt * (1 + this.phase * 0.3));
    this.yaw += turn; this.turretYaw -= turn;
    let speed = hd > 2.7 ? P.speed * Math.max(0, Math.cos(rem)) ** 2 : 0;
    const bias = this.watchdog(dt, speed > 0.1, 0);
    if (bias) this.yaw += bias * 1.2 * dt;
    if (P.erratic > 0 && noise1(w.time * 0.7, this.seed + 3) > 0.55) speed *= 1.35;
    const ry = this.yaw + Math.PI;
    this.moveGround(dt, Math.sin(ry), Math.cos(ry), speed, 2.2);
    this.hubBow = damp(this.hubBow, 0, 3, dt);
    this.armsTo(dt, ARM_REST, ARM_REST, 3);
  }

  // ── slam
  private startSlam(): void {
    this.atkSide = this.armGone[1] ? 0 : this.armGone[0] ? 1 : (this.world.rand() < 0.5 ? 0 : 1);
    this.setMode('slam_wind');
    this.emitAttack('melee');
    this.eyePulse();
    try { this.world.ctx.audio.play('arm_reach', { position: this.body.position }); } catch { /* */ }
  }
  private tickSlam(dt: number): void {
    const w = this.world, P = this.P(), s = this.atkSide, sg = s === 0 ? 1 : -1;
    const A: Arm = { ...ARM_REST };
    this.moveGround(dt, 0, 0, 0, 5);
    if (this.mode === 'slam_wind') {
      this.turnTurret(dt, P.turret * 0.45);
      const k = smooth(this.modeTime / (P.slamWind * 0.85));
      Object.assign(A, { pitch: -0.4 - 2.3 * k, sweep: 0.75 * sg * k, out: 0.2 + 0.3 * k, elbow: 0.75 - 0.35 * k, wrist: -0.4 * k, open: 0.15 + 0.85 * k });
      this.hubBow = damp(this.hubBow, -0.15, 4, dt);
      this.flare = Math.max(this.flare, 0.5 + 0.5 * k);
      this.armsTo(dt, s === 0 ? A : ARM_REST, s === 1 ? A : ARM_REST, 7);
      if (this.modeTime >= P.slamWind) this.setMode('slam_strike');
    } else if (this.mode === 'slam_strike') {
      const k = smooth(this.modeTime / 0.2);
      Object.assign(A, { pitch: -2.7 + 2.0 * k, sweep: (0.75 - 1.15 * k) * sg, out: 0.5 - 0.3 * k, elbow: 0.4 - 0.25 * k, wrist: -0.4 + 0.6 * k, open: 1 - 0.3 * k });
      this.hubBow = damp(this.hubBow, 0.5, 14, dt);
      this.armsTo(dt, s === 0 ? A : ARM_REST, s === 1 ? A : ARM_REST, 30);
      if (!this.struck && this.modeTime >= 0.17) {
        this.struck = true;
        this.slamImpact();
      }
      if (this.modeTime >= 0.28) this.setMode('slam_recover');
    } else {
      // claw stuck on the floor, hub bowed: the opening
      const k = smooth((this.modeTime - 0.75) / 0.5);
      Object.assign(A, { pitch: -0.7 + 0.3 * k, sweep: -0.4 * sg * (1 - k), out: 0.2 - 0.12 * k, elbow: 0.15 + 0.6 * k, wrist: 0.2, open: 0.7 - 0.55 * k });
      this.hubBow = damp(this.hubBow, 0.5 * (1 - k), 4, dt);
      this.armsTo(dt, s === 0 ? A : ARM_REST, s === 1 ? A : ARM_REST, 10);
      if (this.modeTime >= 1.25) { this.cd.slam = P.slamCd; this.setMode('chase'); }
    }
    void w;
  }
  private slamImpact(): void {
    const w = this.world, p = this.body.position, s = this.atkSide;
    const claw = this.B[s === 0 ? 'mcl_l' : 'mcl_r'];
    _v.setFromMatrixPosition(claw.matrixWorld); _v.y = Math.max(p.y + 0.05, _v.y - 0.3);
    try {
      w.ctx.fx.sparks(_v, Y, 22, 5); w.ctx.fx.smoke(_v, { count: 8, size: 0.8, color: 0x3a3836, rise: 0.4, life: 1.6 });
      w.ctx.fx.flash(_v, 0xffb070, 4, 0.08, 5); w.ctx.fx.decal('scratches', _v.clone().setY(p.y + 0.01), Y, 1.2);
      w.ctx.audio.play('foreman_slam', { position: _v });
    } catch { /* fx optional */ }
    const dx = w.playerPos.x - p.x, dz = w.playerPos.z - p.z, d = Math.hypot(dx, dz);
    const ang = Math.abs(angleDiff(Math.atan2(-dx, -dz), this.turretWorldYaw()));
    try { w.ctx.player.shake(Math.max(0, 0.7 - d * 0.06)); } catch { /* */ }
    if (w.playerAlive && d < FOREMAN.slamRange && ang < FOREMAN.slamArc && Math.abs(w.playerPos.y - p.y) < 1.6) {
      w.ctx.player.damage(FOREMAN.slamDmg, p);
      this.knock(dx / (d || 1), dz / (d || 1), 7.5);
    }
  }

  // ── throw
  private startThrow(): void {
    this.atkSide = this.armGone[1] ? 0 : this.armGone[0] ? 1 : (this.world.rand() < 0.6 ? 1 : 0);
    this.setMode('throw_reach');
    this.emitAttack('ranged');
  }
  private tickThrow(dt: number): void {
    const P = this.P(), s = this.atkSide, sg = s === 0 ? 1 : -1, w = this.world;
    const A: Arm = { ...ARM_REST };
    this.moveGround(dt, 0, 0, 0, 5);
    this.turnTurret(dt, P.turret * 0.6);
    if (this.mode === 'throw_reach') {
      // reaches back over its shoulder and pulls a crate off the rack on its back
      const k = smooth(this.modeTime / 0.55);
      Object.assign(A, { pitch: -0.4 + 1.3 * k, sweep: 0.5 * sg * k, out: 0.45 * k, elbow: 0.75 + 0.4 * k, wrist: 0.3, open: 0.8 });
      this.armsTo(dt, s === 0 ? A : ARM_REST, s === 1 ? A : ARM_REST, 8);
      if (this.modeTime >= 0.6) {
        this.grabCrate();
        this.setMode('throw_wind');
        try { w.ctx.audio.play('arm_reach', { position: this.body.position }); } catch { /* */ }
      }
    } else if (this.mode === 'throw_wind') {
      const k = smooth(this.modeTime / P.throwWind);
      Object.assign(A, { pitch: 0.9 - 3.9 * k, sweep: 0.5 * sg * (1 - k), out: 0.45 - 0.2 * k, elbow: 1.15 - 0.4 * k, wrist: 0.3 - 0.6 * k, open: 0.15 });
      this.flare = Math.max(this.flare, 0.4 + 0.5 * k);
      this.armsTo(dt, s === 0 ? A : ARM_REST, s === 1 ? A : ARM_REST, 9);
      this.holdCrate();
      if (this.modeTime >= P.throwWind) this.setMode('throw_release');
    } else {
      const k = smooth(this.modeTime / 0.16);
      Object.assign(A, { pitch: -3.0 + 1.8 * k, sweep: 0, out: 0.25, elbow: 0.75 - 0.5 * k, wrist: -0.3 + 0.5 * k, open: 0.15 + 0.8 * k });
      this.armsTo(dt, s === 0 ? A : ARM_REST, s === 1 ? A : ARM_REST, 30);
      this.holdCrate();
      if (!this.struck && this.modeTime >= 0.1) { this.struck = true; this.release(); }
      if (this.modeTime >= 0.7) { this.cd.throw = P.throwCd; this.cd.slam = Math.max(this.cd.slam, 0.6); this.setMode('chase'); }
    }
  }
  private ensureCrateAssets(): void {
    if (!crateGeo) {
      const g = new THREE.BoxGeometry(0.55, 0.45, 0.55);
      const r = new THREE.RingGeometry(1.15, 1.35, 40);
      crateGeo = { box: g, ring: r };
    }
    if (!this.crateMat) this.crateMat = this.world.ctx.materials.get('painted_orange');
    if (!this.ringMat) this.ringMat = new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  }
  private grabCrate(): void {
    this.ensureCrateAssets();
    if (!this.held) { this.held = new THREE.Mesh(crateGeo!.box, this.crateMat!); this.held.castShadow = true; this.scene.add(this.held); }
    this.holdCrate();
  }
  private holdCrate(): void {
    if (!this.held) return;
    const claw = this.B[this.atkSide === 0 ? 'mcl_l' : 'mcl_r'];
    _v.set(0, -0.32, 0.03).applyMatrix4(claw.matrixWorld);
    this.held.position.copy(_v);
    this.held.quaternion.setFromRotationMatrix(claw.matrixWorld);
  }
  private release(): void {
    const w = this.world, P = this.P();
    if (!this.held) return;
    const from = this.held.position.clone();
    this.held.removeFromParent(); this.held = null;
    const to = new THREE.Vector3().copy(w.playerPos).addScaledVector(w.playerVel, P.lead * P.flight);
    to.y = w.playerPos.y;
    const p = this.body.position;
    const d = Math.hypot(to.x - p.x, to.z - p.z);
    if (d > 17) { to.x = p.x + (to.x - p.x) * 17 / d; to.z = p.z + (to.z - p.z) * 17 / d; }
    const g = this.groundAt(to.x, to.y + 1.2, to.z, 3);
    if (g !== null) to.y = g;
    this.crates.push(new Crate(this, from, to, P.flight + d * 0.015, crateGeo!, this.crateMat!, this.ringMat!.clone()));
  }
  crateImpact(pt: THREE.Vector3): void {
    const w = this.world;
    try {
      w.ctx.fx.sparks(pt, Y, 20, 5); w.ctx.fx.smoke(pt, { count: 10, size: 0.9, color: 0x4a4440, rise: 0.5, life: 1.8 });
      w.ctx.fx.flash(pt, 0xffa060, 5, 0.1, 6);
      w.ctx.fx.debris(pt, _v.set(0, 3, 0), undefined, 8);
      w.ctx.audio.play('metal_clang', { position: pt }); w.ctx.audio.play('foreman_slam', { position: pt, volume: 0.6 });
    } catch { /* */ }
    const d = Math.hypot(w.playerPos.x - pt.x, w.playerPos.z - pt.z);
    try { w.ctx.player.shake(Math.max(0, 0.5 - d * 0.05)); } catch { /* */ }
    if (w.playerAlive && d < FOREMAN.throwRadius + 0.6 && Math.abs(w.playerPos.y - pt.y) < 1.8) {
      const k = d < FOREMAN.throwRadius ? 1 : 0.4;
      w.ctx.player.damage(Math.round(FOREMAN.throwDmg * k), pt);
      this.knock((w.playerPos.x - pt.x) / (d || 1), (w.playerPos.z - pt.z) / (d || 1), 4 * k);
    }
  }
  private tickCrates(dt: number): void {
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      c.step(dt);
      if (c.done) this.crates.splice(i, 1);
    }
  }

  // ── charge
  private startCharge(): void {
    this.setMode('charge_wind');
    this.emitAttack('melee');
    this.eyePulse();
    try { this.world.ctx.audio.play('metal_groan', { position: this.body.position }); } catch { /* */ }
  }
  private tickCharge(dt: number): void {
    const w = this.world, P = this.P(), p = this.body.position;
    const ram: Arm = { pitch: -1.25, sweep: 0, out: 0.1, elbow: 0.2, wrist: 0.1, open: 0.4 };
    if (this.mode === 'charge_wind') {
      // aligns chassis + turret, ducks the hub, tracks spin up (gravel spit)
      const want = this.yawTo(w.playerPos.x, w.playerPos.z);
      const rem = angleDiff(want, this.yaw);
      const turn = Math.sign(rem) * Math.min(Math.abs(rem), 1.2 * dt);
      this.yaw += turn; this.turretYaw = damp(this.turretYaw, 0, 6, dt);
      this.hubBow = damp(this.hubBow, 0.35, 4, dt);
      this.flare = Math.max(this.flare, 0.7);
      this.wheelRot += dt * 18 * smooth(this.modeTime / P.chargeWind);
      this.armsTo(dt, ram, ram, 5);
      this.moveGround(dt, 0, 0, 0, 6);
      if (w.rand() < dt * 10) { _v.set(p.x, p.y + 0.1, p.z); try { w.ctx.fx.smoke(_v, { count: 2, size: 0.5, color: 0x3a3836, rise: 0.2, life: 0.8 }); } catch { /* */ } }
      if (this.modeTime >= P.chargeWind) {
        const ry = this.yaw + Math.PI;
        this.chargeDir.set(Math.sin(ry), 0, Math.cos(ry));
        this.chargeStart.copy(p); this.chargeLast.copy(p); this.chargeStall = 0;
        this.setMode('charge');
        try { w.ctx.audio.play('foreman_step', { position: p }); } catch { /* */ }
      }
    } else if (this.mode === 'charge') {
      this.armsTo(dt, ram, ram, 8);
      this.moveGround(dt, this.chargeDir.x, this.chargeDir.z, FOREMAN.chargeSpeed, 6);
      const moved = Math.hypot(p.x - this.chargeLast.x, p.z - this.chargeLast.z);
      this.chargeLast.copy(p);
      this.chargeStall = moved < FOREMAN.chargeSpeed * dt * 0.3 && this.modeTime > 0.25 ? this.chargeStall + dt : 0;
      const dx = w.playerPos.x - p.x, dz = w.playerPos.z - p.z, d = Math.hypot(dx, dz);
      if (!this.struck && w.playerAlive && d < this.body.radius + 0.75 && Math.abs(w.playerPos.y - p.y) < 1.6) {
        this.struck = true;
        w.ctx.player.damage(FOREMAN.chargeDmg, p);
        // thrown aside, away from the lane
        const side = this.chargeDir.x * dz - this.chargeDir.z * dx > 0 ? 1 : -1;
        this.knock(this.chargeDir.x * 0.6 - this.chargeDir.z * side, this.chargeDir.z * 0.6 + this.chargeDir.x * side, 8);
        try { w.ctx.player.shake(0.8); } catch { /* */ }
        this.body.velocity.multiplyScalar(0.3);
        this.setMode('charge_recover');
        return;
      }
      const run = Math.hypot(p.x - this.chargeStart.x, p.z - this.chargeStart.z);
      if (this.chargeStall > 0.12) {
        // into the wall: sparks, shudder, stunned (an opening)
        try { w.ctx.fx.sparks(_v.copy(p).addScaledVector(this.chargeDir, 0.9).setY(p.y + 0.6), _v2.copy(this.chargeDir).negate(), 26, 5); w.ctx.audio.play('foreman_slam', { position: p }); w.ctx.player.shake(Math.max(0, 0.6 - d * 0.04)); } catch { /* */ }
        this.hubRoll.v += 6;
        this.setMode('stun');
        return;
      }
      if (run > 11 || this.modeTime > 1.7 || (d > 2 && (w.playerPos.x - p.x) * this.chargeDir.x + (w.playerPos.z - p.z) * this.chargeDir.z < -1.5)) this.setMode('charge_recover');
    } else {
      this.armsTo(dt, ARM_REST, ARM_REST, 3);
      this.hubBow = damp(this.hubBow, 0.25, 3, dt);
      this.moveGround(dt, 0, 0, 0, 2.5);
      if (this.modeTime > 1.4) { this.cd.charge = P.chargeCd; this.cd.slam = Math.min(this.cd.slam, 0.4); this.setMode('chase'); }
    }
  }

  private tickSwipe(dt: number): void {
    const w = this.world, p = this.body.position;
    this.turnTurret(dt, 1.5);
    this.moveGround(dt, 0, 0, 0, 5);
    if (!this.struck && this.modeTime > 0.65) {
      this.struck = true;
      const dx = w.playerPos.x - p.x, dz = w.playerPos.z - p.z, d = Math.hypot(dx, dz);
      if (w.playerAlive && d < 2.5) w.ctx.player.damage(FOREMAN.swipeDmg, p);
    }
    if (this.modeTime > 1.2) { this.cd.swipe = 1.6; this.setMode('chase'); }
  }

  private tickStagger(dt: number): void {
    this.moveGround(dt, 0, 0, 0, 3);
    this.hubBow = damp(this.hubBow, this.mode === 'stun' ? 0.45 : 0.3, 4, dt);
    this.armsTo(dt, { ...ARM_REST, pitch: 0.1, elbow: 0.4, open: 0.6 }, { ...ARM_REST, pitch: 0.15, elbow: 0.5, open: 0.6 }, 4);
    if (this.modeTime > (this.mode === 'stun' ? 1.9 : 1.4)) { this.cd.slam = Math.min(this.cd.slam, 0.5); this.setMode('chase'); }
  }

  private knock(nx: number, nz: number, speed: number): void {
    this.knockT = 0.32; this.knockV.set(nx * speed, 0, nz * speed);
  }
  private tickKnock(dt: number): void {
    if (this.knockT <= 0) return;
    this.knockT -= dt;
    const pl = this.world.ctx.player;
    try {
      if (this.knockT > 0) pl.setCarry(_v3.copy(this.knockV).multiplyScalar(this.knockT / 0.32));
      else pl.setCarry(null);
    } catch { /* */ }
  }

  // ───────────────────────────────────────────── voices

  /** Three staff voices out of sync (lost = index of the head just destroyed, -1 = all speak). */
  private chorus(lost: number): void {
    const w = this.world, pos: THREE.Vector3[] = [];
    TORSOS.forEach((k, i) => { if (this.headHp[i] > 0 && i !== lost) pos.push(new THREE.Vector3().setFromMatrixPosition(this.B['head_' + k].matrixWorld)); });
    if (pos.length === 0) return;
    const got = sayChorus(w.ctx, pos, w.rand);
    if (got.length > 0) return;
    pos.forEach((pp, i) => setTimeout(() => { try { w.ctx.audio.play('husk_whisper', { position: pp, pitch: [0.85, 1.0, 1.15][i] }); } catch { /* */ } }, [0, 320, 770][i]));
  }

  // ───────────────────────────────────────────── damage

  protected hitFx(b: HitBurst): void {
    const fx = this.world.ctx.fx, A = b.amount, head = b.part.startsWith('head');
    fx.sparks(b.point, b.normal, THREE.MathUtils.clamp(Math.round(3 + A / 6 + (head ? 4 : 0)), 3, 20), head ? 3.6 : 2.6);
    const fl = Math.min(8, Math.round(A / 14));
    if (fl > 0) fx.fluid(b.point, b.dir, fl);
    if (head) { _v.copy(b.point).addScaledVector(b.normal, 0.08); fx.flash(_v, 0xffc27a, 1.6 + Math.min(3, A * 0.04), 0.05, 2.5); }
  }

  applyDamage(vol: HitVolume, amount: number, point: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.alive || this.isPuppet) return;
    const w = this.world;
    const hi = vol.part === 'head_a' ? 0 : vol.part === 'head_b' ? 1 : vol.part === 'head_c' ? 2 : -1;
    let dmg: number;
    if (hi >= 0) {
      dmg = Math.min(amount, this.headHp[hi]);
      this.headHp[hi] -= amount;
      this.headY[hi].v += (w.rand() - 0.5) * 30; this.headP[hi].v -= 12;
    } else {
      dmg = amount * FOREMAN.bodyMult;
      const live = this.headHp.filter((h) => h > 0).length || 1;
      for (let i = 0; i < 3; i++) if (this.headHp[i] > 0) this.headHp[i] = Math.max(1, this.headHp[i] - dmg / live);
      if (vol.region === 'arm_l' || vol.region === 'arm_r') {
        const s = vol.region === 'arm_l' ? 0 : 1;
        this.armHp[s] -= amount;
        if (this.armHp[s] <= 0 && !this.armGone[s]) this.destroyArm(s, dir);
      } else if (vol.region.startsWith('sa_')) {
        this.smallHp[vol.region] -= amount;
        if (this.smallHp[vol.region] <= 0 && this.smallHp[vol.region] > -1000) { this.smallHp[vol.region] = -1e4; this.shedSmallArm(vol.region, dir); }
      }
    }
    w.ctx.events.emit('enemy:damaged', { id: this.id, type: this.type, point, direction: dir, amount: dmg, part: vol.part });
    this.queueHit(vol, amount, point, dir);
    this.hubRoll.v += (w.rand() - 0.5) * Math.min(3, amount / 10);
    this.hubPitch.v += Math.min(2, amount / 15);
    if (this.mode === 'dormant') { this.wakeDelay = -1; this.beginWake(1.6); }
    for (let i = 0; i < 3; i++) if (this.headHp[i] <= 0 && this.B['head_' + TORSOS[i]].scale.x > 0.5) this.destroyHead(i, dir);
    this.health = this.headHp.reduce((a, h) => a + Math.max(0, h), 0);
    if (this.heads === 0) this.die(dir);
  }

  private destroyHead(i: number, dir: THREE.Vector3): void {
    const w = this.world, k = TORSOS[i], bone = this.B['head_' + k];
    this.headHp[i] = 0;
    _v.setFromMatrixPosition(bone.matrixWorld);
    const mesh = this.tpl.rig.debrisMesh('head_' + k);
    if (mesh) {
      bone.updateWorldMatrix(true, false);
      bone.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
      try { w.ctx.fx.debris(mesh.position, _v2.set(dir.x * 3 + (w.rand() - 0.5) * 2, 3 + w.rand() * 2, dir.z * 3 + (w.rand() - 0.5) * 2), [mesh], 14); } catch { /* */ }
    }
    bone.scale.setScalar(1e-4);
    for (const v of this.volumes) if (v.part === 'head_' + k) v.enabled = false;
    try { w.ctx.fx.sparks(_v, Y, 24, 5.5); w.ctx.fx.fluid(_v, Y, 12); w.ctx.fx.flash(_v, 0xffb060, 7, 0.14, 5); w.ctx.fx.smoke(_v, { count: 5, size: 0.6, color: 0x222224, rise: 0.6, life: 2 }); } catch { /* */ }
    w.ctx.events.emit('enemy:part-destroyed', { id: this.id, type: this.type, part: 'head_' + k, position: _v.clone() });
    if (this.heads > 0) {
      this.chorus(i);
      this.dropHeld();
      this.setMode('stagger');
      this.hubRoll.v += 8 * (w.rand() < 0.5 ? -1 : 1);
    }
  }

  private destroyArm(s: number, dir: THREE.Vector3): void {
    const w = this.world, sfx = SIDES[s];
    this.armGone[s] = true;
    for (const n of ['mcl_' + sfx, 'mfo_' + sfx]) {
      const bone = this.B[n], mesh = this.tpl.rig.debrisMesh(n);
      if (mesh && bone.scale.x > 0.5) {
        bone.updateWorldMatrix(true, false);
        bone.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
        try { w.ctx.fx.debris(mesh.position, _v2.set(dir.x * 2.5, 2.5, dir.z * 2.5), [mesh], 14); } catch { /* */ }
      }
    }
    _v.setFromMatrixPosition(this.B['mfo_' + sfx].matrixWorld);
    this.B['mfo_' + sfx].scale.setScalar(1e-4);
    for (const v of this.volumes) if (v.region === 'arm_' + sfx && v.bone !== this.B['mup_' + sfx]) v.enabled = false;
    try { w.ctx.fx.sparks(_v, _v2.copy(dir).negate(), 20, 4.5); w.ctx.fx.fluid(_v, dir, 12); w.ctx.fx.flash(_v, 0xffb060, 4, 0.1, 4); } catch { /* */ }
    w.ctx.events.emit('enemy:part-destroyed', { id: this.id, type: this.type, part: 'arm_' + sfx, position: _v.clone() });
    if ((this.mode.startsWith('slam') || this.mode.startsWith('throw')) && this.atkSide === s) { this.dropHeld(); this.setMode('stagger'); }
  }

  private shedSmallArm(region: string, dir: THREE.Vector3): void {
    const w = this.world, n = region.replace('sa_', 'larm_');
    const bone = this.B[n];
    if (!bone) return;
    const mesh = this.tpl.rig.debrisMesh(n);
    if (mesh) { bone.updateWorldMatrix(true, false); bone.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale); try { w.ctx.fx.debris(mesh.position, _v2.set(dir.x * 2, 2, dir.z * 2), [mesh], 12); } catch { /* */ } }
    bone.scale.setScalar(1e-4);
    for (const v of this.volumes) if (v.bone === bone) v.enabled = false;
  }

  private dropHeld(): void {
    if (this.held) { this.held.removeFromParent(); this.held = null; }
  }

  private die(dir: THREE.Vector3): void {
    if (!this.alive) return;
    const w = this.world;
    this.alive = false; this.health = 0;
    this.dropHeld();
    this.setMode('dying');
    this.stopLoop(0.8);
    void dir;
    this.diedAt = w.time;
    w.onDeath(this);
  }

  private tickDying(dt: number): void {
    const w = this.world, p = this.body.position, t = this.modeTime;
    this.moveGround(dt, 0, 0, 0, 3);
    this.fold = smooth((t - 0.3) / 1.6) * 0.85;
    this.eyeGlow = Math.max(0, 1 - t * 1.5);
    if (this.light) this.light.intensityScale = this.eyeGlow;
    this.armsTo(dt, { ...ARM_REST, pitch: 0.2, elbow: 0.2, open: 0.8 }, { ...ARM_REST, pitch: 0.25, elbow: 0.3, open: 0.8 }, 2);
    if (w.rand() < dt * 8) { _v.set(p.x + (w.rand() - 0.5), p.y + 1 + w.rand() * 1.2, p.z + (w.rand() - 0.5)); try { w.ctx.fx.sparks(_v, Y, 8, 3); } catch { /* */ } }
    if (t >= 0.7 && t - dt < 0.7) { _v.set(p.x, p.y + 1.6, p.z); try { w.ctx.fx.explosion(_v, 0.8); w.ctx.player.shake(0.4); } catch { /* */ } }
    if (t > 3) {
      this.mode = 'dead';
      if (this.light) { this.light.remove(); this.light = null; }
      this.wreckBox = new THREE.Box3(new THREE.Vector3(p.x - 0.75, p.y, p.z - 0.75), new THREE.Vector3(p.x + 0.75, p.y + 0.8, p.z + 0.75));
    }
  }

  // ───────────────────────────────────────────── puppet (EnemyManager.actor)

  override puppetMove(point: THREE.Vector3, speed: number | undefined, done: () => void): void {
    if (this.pDone) { const d = this.pDone; this.pDone = null; d(); }
    this.pTarget.copy(point); this.pSpeed = speed ?? 1; this.pMoving = true; this.pDone = done;
  }
  override puppetPose(pose: string): void { this.fold = pose === 'folded' ? 1 : 0; this.headLift = this.fold ? [0, 0, 0] : [1, 1, 1]; }
  override puppetLook(_p: THREE.Vector3 | null): void { /* heads track by themselves */ }
  override puppetEyes(on: boolean): void { this.eyeGlow = on ? 1 : 0; }
  override puppetStop(): void { this.pMoving = false; if (this.pDone) { const d = this.pDone; this.pDone = null; d(); } }
  private tickPuppet(dt: number): void {
    const p = this.body.position;
    if (!this.pMoving) return;
    const dx = this.pTarget.x - p.x, dz = this.pTarget.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.1) { this.puppetStop(); return; }
    this.faceToward(this.pTarget.x, this.pTarget.z, 1.2 * dt);
    const k = Math.min(d, this.pSpeed * dt) / d;
    p.x += dx * k; p.z += dz * k;
    this.wheelRot += this.pSpeed * dt / F.wheelR;
  }

  // ───────────────────────────────────────────── pose

  private armsTo(dt: number, L: Arm, R: Arm, rate: number): void {
    for (let i = 0; i < 2; i++) {
      const a = this.arms[i], t = i === 0 ? L : R;
      a.pitch = damp(a.pitch, t.pitch, rate, dt); a.sweep = damp(a.sweep, t.sweep, rate, dt); a.out = damp(a.out, t.out, rate, dt);
      a.elbow = damp(a.elbow, t.elbow, rate, dt); a.wrist = damp(a.wrist, t.wrist, rate, dt); a.open = damp(a.open, t.open, rate * 1.5, dt);
    }
  }

  private tracks(dt: number): void {
    const p = this.body.position;
    const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
    const ry = this.yaw + Math.PI;
    const fwd = (p.x - this.lastPos.x) * Math.sin(ry) + (p.z - this.lastPos.z) * Math.cos(ry);
    this.lastPos.copy(p);
    this.wheelRot += fwd / F.wheelR;
    this.stepDist += moved;
    if (this.stepDist > 0.55) { this.stepDist = 0; this.emit('enemy:step'); }
    void dt;
  }

  private pose(dt: number): void {
    const B = this.B, w = this.world, t = w.time, P = this.awake ? this.P() : PHASES[0];
    this.rig.reset();
    // keep shot-off parts gone (reset restores scale)
    for (let i = 0; i < 3; i++) if (this.headHp[i] <= 0) B['head_' + TORSOS[i]].scale.setScalar(1e-4);
    for (let s = 0; s < 2; s++) if (this.armGone[s]) B['mfo_' + SIDES[s]].scale.setScalar(1e-4);
    for (const r of Object.keys(this.smallHp)) if (this.smallHp[r] < -1000) B[r.replace('sa_', 'larm_')].scale.setScalar(1e-4);
    const fold = this.fold, live = this.awake && this.alive;
    for (const wb of ['l', 'r']) for (let i = 0; i < F.wheels.length; i++) B[`wheel_${wb}${i}`].quaternion.setFromAxisAngle(X, this.wheelRot);
    // chassis bob on the tracks
    const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    B.base.position.y = Math.sin(this.wheelRot * 1.7) * 0.006 * Math.min(1, speed);
    B.turret.quaternion.setFromAxisAngle(Y, this.turretYaw);
    B.column.position.y += -0.42 * fold;
    spring(this.hubRoll, 0, 1.4, 0.3, dt); spring(this.hubPitch, 0, 1.6, 0.35, dt);
    const err = live ? P.erratic : 0;
    const sway = noise1(t * 0.5, this.seed) * 0.03 + noise1(t * 3.1, this.seed + 1) * 0.05 * err;
    this.rotE(B.hub, fold * 0.95 + this.hubBow + this.hubPitch.x * 0.1, 0, this.hubRoll.x * 0.12 + sway);
    for (let i = 0; i < 3; i++) {
      const k = TORSOS[i];
      const hl = this.headLift[i];
      const breath = Math.sin(t * 1.1 + i * 2) * 0.012;
      this.rotE(B['spine_' + k], (1 - hl) * 0.55 + fold * 0.2 + breath + (i > 0 ? noise1(t * 0.7, this.seed + i) * 0.06 : 0), noise1(t * 0.4, this.seed + 10 + i) * 0.08, 0);
      this.rotE(B['neck_' + k], (1 - hl) * 0.5, 0, 0);
      // heads: husk-style tracking with overshoot, each its own rhythm
      let yaw = 0, pitch = 0;
      if (live && hl > 0.5) {
        const head = B['head_' + k];
        B['neck_' + k].updateMatrixWorld(true);
        _v.setFromMatrixPosition(head.matrixWorld);
        _q.setFromRotationMatrix(B['neck_' + k].matrixWorld).invert();
        _v2.copy(w.playerEye).sub(_v).applyQuaternion(_q);
        yaw = THREE.MathUtils.clamp(Math.atan2(_v2.x, _v2.z), -1.5, 1.5);
        pitch = THREE.MathUtils.clamp(-Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z)), -0.7, 0.7);
        if (w.rand() < dt * (0.6 + err)) this.headY[i].v += (w.rand() - 0.5) * 18;
      }
      spring(this.headY[i], yaw, 2.6, 0.38, dt); spring(this.headP[i], pitch, 2.6, 0.4, dt);
      this.rotE(B['head_' + k], (1 - hl) * 0.7 + this.headP[i].x, this.headY[i].x, noise1(t * 1.3, this.seed + 20 + i) * 0.1, 'YXZ');
      // eye glow (+ flare during telegraphs)
      const g = this.headHp[i] > 0 ? this.eyeGlow * hl * (1 + this.flare * 0.8) : 0;
      B['eye_' + k].scale.setScalar(Math.max(1e-4, g));
      if (k !== 'a') {
        // the thin husk arms writhe, reaching at the player when close
        for (const [s, sfx] of [[1, 'l'], [-1, 'r']] as const) {
          const n = (o: number) => noise1(t * (0.8 + err) + o, this.seed + i * 7 + (s > 0 ? 0 : 3) + o);
          const f = fold;
          this.rotE(B[`uarm_${k}_${sfx}`], -0.3 + n(1) * 0.5 - f * 0.6, 0, (0.3 + n(2) * 0.35) * s * (1 - f) + f * -0.2 * s);
          this.rotE(B[`larm_${k}_${sfx}`], -(0.6 + n(3) * 0.4 + f * 1.4), 0, 0);
          this.rotE(B[`hand_${k}_${sfx}`], n(4) * 0.4, 0, 0);
        }
      }
    }
    this.flare = damp(this.flare, 0, 2.5, dt);
    // manipulators (folded tight when parked)
    for (let s = 0; s < 2; s++) {
      const sfx = SIDES[s], sg = s === 0 ? 1 : -1, a = this.arms[s];
      const pitch = a.pitch * (1 - fold) + 0.35 * fold, elbow = a.elbow * (1 - fold) + 2.2 * fold;
      this.rotE(B['msh_' + sfx], 0, a.sweep * (1 - fold), a.out * sg * (1 - fold) + 0.05 * sg);
      this.rotE(B['mup_' + sfx], pitch + noise1(t * 1.7, this.seed + 40 + s) * 0.03 * (live ? 1 : 0), 0, 0);
      this.rotE(B['mfo_' + sfx], -elbow, 0, 0);
      this.rotE(B['mcl_' + sfx], -a.wrist, 0, 0);
      B['mja_' + sfx].quaternion.setFromAxisAngle(X, a.open * 0.6);
      B['mjb_' + sfx].quaternion.setFromAxisAngle(X, -a.open * 0.6);
    }
    this.object.position.copy(this.body.position);
    this.object.rotation.y = this.yaw + Math.PI;
    this.object.updateMatrixWorld(true);
    if (this.light) {
      _v.setFromMatrixPosition(B.hub.matrixWorld);
      this.light.position.set(_v.x, _v.y + 0.7, _v.z);
      this.light.intensityScale = (this.mode === 'dying' ? this.eyeGlow : this.eyeGlow) * (0.6 + this.flare * 2.5);
    }
  }
  private rotE(b: THREE.Bone, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ'): void { b.quaternion.setFromEuler(_e.set(x, y, z, order)); }

  override dispose(): void {
    this.disposeFrame();
    for (const c of this.crates) c.dispose();
    this.crates.length = 0;
    this.dropHeld();
    if (this.knockT > 0) { try { this.world.ctx.player.setCarry(null); } catch { /* */ } this.knockT = 0; }
    if (this.light) { this.light.remove(); this.light = null; }
    this.rig.skeleton.dispose();
    super.dispose();
  }
}
