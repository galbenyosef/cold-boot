/**
 * SKITTER runtime: six-leg procedural gait (alternating tripod, planted feet, analytic IK),
 * erratic zig-zag approach, pause-and-look, telegraphed leap, retreat/circle, curl-up death.
 *
 * Surface crawling: the machine can cling to walls and ceilings. While attached it ignores gravity and moves in
 * the plane of the surface it stands on (normal `n`, heading `fwd`), re-snapping to the geometry with short
 * raycasts every frame; it wraps onto a new surface at concave corners (floor → wall → ceiling) and around convex
 * edges, and drops off when the surface is lost (doorway, moving door, edge it cannot wrap). Feet IK onto whatever
 * surface their home point projects to. From a wall/ceiling it leaps (or drops) at the player; the floor
 * behaviour is the fallback for everything.
 */
import * as THREE from 'three';
import type { LightHandle } from '../../core/types';
import { EnemyBase, type EnemyWorld, type HitBurst } from '../ai';
import { hv, type HitVolume } from '../shared/hit';
import { angleDiff, damp, noise1, smooth, solvePlanar, spring, type Spring } from '../shared/ik';
import type { Rig } from '../shared/rig';
import { SK, type SkitterTemplate } from './model';

type Mode = 'dormant' | 'emerge' | 'unfold' | 'idle' | 'chase' | 'look' | 'crouch' | 'leap' | 'retreat' | 'stagger'
  | 'towall' | 'climb' | 'wcrouch' | 'fall' | 'dying' | 'dead';

interface Leg {
  side: number; index: number; group: number;
  coxa: THREE.Bone; femur: THREE.Bone; tibia: THREE.Bone;
  /** Inverse bind of the mount relative to the body bone. */
  inv: THREE.Matrix4;
  /** Rest foot position in body-root space (x,z on the ground). */
  rest: THREE.Vector3;
  pos: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3;
  t: number; dur: number;
  gone: boolean;
}

const SPEED = 5.6, HP = 25, MELEE = 8;
/** Surface crawling: speed on walls / ceilings, max time attached, leap ranges. */
const CLIMB_SPEED = 3.6, SURF_MAX = 11, WALL_LEAP = 4.2, CEIL_LEAP = 2.8;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _t = new THREE.Vector3(), _imp = new THREE.Vector3();
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3();
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _mb = new THREE.Matrix4();
const _qt = new THREE.Quaternion();
const _p2 = new THREE.Vector2();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const EYE_KEYS = ['glow'];

export class Skitter extends EnemyBase {
  readonly type = 'skitter' as const;
  private rig: Rig;
  private B: Record<string, THREE.Bone>;
  private legs: Leg[] = [];
  mode: Mode = 'idle';
  private modeTime = 0;
  private seed: number;
  private bodyY = SK.bodyY; private pitch = 0; private roll = 0;
  private bob: Spring = { x: 0, v: 0 };
  private headYaw: Spring = { x: 0, v: 0 }; private headPitch: Spring = { x: 0, v: 0 };
  private abYaw: Spring = { x: 0, v: 0 }; private abPitch: Spring = { x: 0, v: 0 };
  private ant: Spring[] = [{ x: 0, v: 0 }, { x: 0, v: 0 }, { x: 0, v: 0 }, { x: 0, v: 0 }];
  private tail: Spring[] = [{ x: 0, v: 0 }, { x: 0, v: 0 }];
  private mand = 0.2;
  private curl = 0;         // 0 = legs live, 1 = legs curled under
  private air = 0;          // legs in flight pose
  private zig: number; private zigDir = 1;
  private pauseTimer: number;
  private lookDur = 0;
  private retreatDir = 1; private retreatDur = 1;
  private bit = false;
  private stepEmit = 0;
  private delay = 0;
  private eyeOn = true;
  private light: LightHandle | null = null;
  private flip = 0; private flipDir = 1;
  private exploded = false;
  private lastYaw = 0; private yawRate = 0;
  private leapCool = 0;

  // ── surface frame (floor: n = up, fwd from yaw)
  /** True while clinging to a wall / ceiling (gravity off, physics capsule unused). */
  attached = false;
  /** Surface normal and heading (world, orthonormal). */
  readonly n = new THREE.Vector3(0, 1, 0);
  readonly fwd = new THREE.Vector3(0, 0, 1);
  private readonly left = new THREE.Vector3(1, 0, 0);
  /** Smoothed visual orientation. */
  private qVis = new THREE.Quaternion();
  private surfTime = 0;
  private surfGoal: 'wall' | 'ceiling' = 'wall';
  private surfCheck = new THREE.Vector3(); private surfCheckT = 0;
  private climbCool: number;
  private climbTimer = 0;
  private readonly climber: boolean;
  private readonly wallPoint = new THREE.Vector3();
  private readonly wallNormal = new THREE.Vector3();
  private speedNow = 0;
  private fromCeiling = false;
  private stillT = 0;
  /** Per check (2 Hz) chance to take a wall route; share of those that go on to the ceiling (debug-tunable). */
  climbChance = 0.5;
  ceilingChance = 0.35;

  constructor(world: EnemyWorld, private tpl: SkitterTemplate, group: string, position: THREE.Vector3, yaw: number, o: { dormant: boolean; emerge?: boolean; delay?: number }) {
    super(world, group, position, yaw, 0.3, 0.5);
    this.health = HP;
    this.eyeHeight = 0.3;
    this.boundCenterY = 0.2; this.boundRadius = 0.75;
    this.seed = this.id * 3.17;
    this.zig = world.rand() * 10;
    this.pauseTimer = 1.5 + world.rand() * 2.5;
    this.climber = world.rand() < 0.75;
    this.climbCool = 0.3 + world.rand() * 0.8;
    this.rig = tpl.rig.instantiate();
    this.B = this.rig.byName;
    this.lodRig = this.rig;
    this.object.add(this.rig.root);
    const B = this.B;
    const bodyInv = new THREE.Matrix4().copy(tpl.rig.bones[0].bind).invert();
    tpl.legs.forEach((n) => {
      const side = n[0] === 'l' ? 1 : -1, index = Number(n[1]);
      const mountDef = tpl.rig.bones.find((d) => d.name === 'mount_' + n)!;
      const local = new THREE.Matrix4().multiplyMatrices(bodyInv, mountDef.bind);
      this.legs.push({
        side, index, group: (index + (side > 0 ? 0 : 1)) % 2,
        coxa: B['coxa_' + n], femur: B['femur_' + n], tibia: B['tibia_' + n],
        inv: local.invert(),
        rest: new THREE.Vector3(SK.rest[index][0] * side, 0, SK.rest[index][1]),
        pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 0.1, gone: false,
      });
    });
    this.volumes = [
      hv(B.body, [0, 0.0, -0.12], [0, 0.0, 0.12], 0.125, 'core', 'body'),
      hv(B.abdomen, [0, 0.03, -0.12], [0, 0.03, -0.02], 0.11, 'core', 'body'),
      hv(B.head, [0, 0.01, 0.03], [0, 0.01, 0.07], 0.085, 'head', 'head'),
    ];
    for (const l of this.legs) {
      this.volumes.push(hv(l.femur, [0, 0, 0], [0, 0, SK.femur], 0.045, 'limb', 'leg'));
      this.volumes.push(hv(l.tibia, [0, 0, 0], [0, 0, SK.tibia], 0.04, 'limb', 'leg'));
    }
    this.lastYaw = yaw;
    this.floorFrame();
    this.qVis.setFromRotationMatrix(_mb.makeBasis(this.left, this.n, this.fwd));
    this.plantAll();
    this.delay = o.delay ?? 0;
    if (o.dormant) {
      this.mode = 'dormant'; this.state = 'dormant';
      this.curl = 1; this.bodyY = 0.085;
      this.setEye(false);
    } else if (o.emerge) {
      this.awake = true;
      this.mode = 'emerge'; this.state = 'alert';
      this.curl = 1; this.air = 0;
      if (this.delay > 0) { this.object.visible = false; this.holdHidden = true; }
      else this.beginEmerge();
    } else {
      this.awake = true;
      this.mode = 'idle'; this.state = 'idle';
      this.onAwake();
    }
    this.pose(0);
    this.emit('enemy:spawned');
  }

  private setEye(on: boolean): void {
    this.eyeOn = on;
    this.B.eye.scale.setScalar(on ? 1 : 1e-4);
    this.rig.setKeysVisible(EYE_KEYS, on);
  }

  private onAwake(): void {
    this.setEye(true);
    this.startLoop('skitter_loop', 0.7);
    if (!this.light) {
      try {
        this.light = this.world.ctx.render.lights.add({ type: 'point', position: this.body.position.clone(), color: 0xff2010, intensity: 0.6, distance: 2.2, priority: 0.15 });
      } catch { this.light = null; }
    }
  }

  private beginEmerge(): void {
    this.object.visible = true; this.holdHidden = false;
    this.onAwake();
    this.modeTime = 0;
    // Out of a ceiling vent: cling to the ceiling (or the vent's underside) instead of dropping straight down.
    const p = this.body.position, phys = this.world.ctx.physics;
    _o.set(p.x, p.y + 0.05, p.z);
    const hit = phys.raycast(_o, UP, 0.9);
    if (hit && hit.normal.y < -0.7) {
      this.attachTo(hit.point, hit.normal);
      this.headToward(this.world.playerPos, 1e3);
      this.surfGoal = 'ceiling';
      this.fromCeiling = true;
      this.qVis.setFromRotationMatrix(_mb.makeBasis(this.left, this.n, this.fwd));
      this.plantAll();
      this.curl = 1;
      this.setMode('unfold');
      return;
    }
    this.body.velocity.set((this.world.rand() - 0.5) * 1.5, -1, (this.world.rand() - 0.5) * 1.5);
    this.body.onGround = false;
  }

  private setMode(m: Mode): void {
    this.mode = m; this.modeTime = 0;
    this.setState(m === 'dormant' ? 'dormant' : m === 'idle' ? 'idle' : m === 'emerge' || m === 'unfold' ? 'alert'
      : m === 'chase' || m === 'look' || m === 'retreat' || m === 'towall' || m === 'climb' || m === 'fall' ? 'chase'
      : m === 'crouch' || m === 'leap' || m === 'wcrouch' ? 'attack' : m === 'stagger' ? 'stagger' : 'dead');
  }

  /** Frame vectors for standing on the floor with the current yaw. */
  private floorFrame(): void {
    const ry = this.yaw + Math.PI;
    this.n.copy(UP);
    this.fwd.set(Math.sin(ry), 0, Math.cos(ry));
    this.left.set(Math.cos(ry), 0, -Math.sin(ry));
  }

  private plantAll(): void {
    const p = this.body.position, L = this.left, F = this.fwd;
    for (const l of this.legs) {
      l.pos.copy(p).addScaledVector(L, l.rest.x).addScaledVector(F, l.rest.z);
      l.t = 1;
    }
  }

  protected enterAlert(): void {
    if (this.mode !== 'idle') return;
    this.emit('enemy:alerted');
    this.ant[0].v += 20; this.ant[2].v -= 20;
    this.setMode('look'); this.lookDur = 0.35;
  }

  protected override eyePos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.body.position).addScaledVector(this.n, this.eyeHeight);
  }
  override boundCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.body.position).addScaledVector(this.n, this.boundCenterY);
  }

  // ───────────────────────────────────────────────────────── surfaces

  private attachTo(point: THREE.Vector3, normal: THREE.Vector3): void {
    this.attached = true;
    this.ignoreSeparation = true;
    this.body.position.copy(point);
    this.body.velocity.set(0, 0, 0);
    this.body.onGround = false;
    this.n.copy(normal).normalize();
    // keep heading as close as possible to the old one (or the old up, for a corner)
    _v.copy(this.fwd).addScaledVector(this.n, -this.fwd.dot(this.n));
    if (_v.lengthSq() < 0.02) _v.copy(UP).addScaledVector(this.n, -UP.dot(this.n));
    if (_v.lengthSq() < 0.02) _v.set(1, 0, 0).addScaledVector(this.n, -this.n.x);
    this.fwd.copy(_v.normalize());
    this.left.crossVectors(this.n, this.fwd).normalize();
    this.surfTime = 0; this.surfCheckT = 0; this.surfCheck.copy(point); this.stillT = 0;
  }

  /** Let go of the surface: becomes a ballistic body (floor rules) again. */
  private detach(vx = 0, vy = 0, vz = 0): void {
    if (!this.attached) return;
    const p = this.body.position, n = this.n;
    this.attached = false;
    this.ignoreSeparation = false;
    // clear the capsule (radius 0.3, height 0.5 above its base) of the surface
    p.addScaledVector(n, 0.34);
    if (n.y < -0.5) p.y -= 0.5;
    this.world.ctx.physics.resolveSphere(_v.set(p.x, p.y + 0.25, p.z), 0.3) && p.set(_v.x, _v.y - 0.25, _v.z);
    this.body.velocity.set(vx, vy, vz);
    this.body.onGround = false;
    // heading from the surface frame → yaw
    _v.copy(this.fwd); _v.y = 0;
    if (_v.lengthSq() < 0.01) { _v.copy(this.n); _v.y = 0; }
    if (_v.lengthSq() > 1e-4) this.yaw = Math.atan2(_v.x, _v.z) - Math.PI;
    this.climbCool = 2.5 + this.world.rand() * 2;
  }

  /** Turn the heading (in the surface plane) toward a world point, at most `maxStep` radians. */
  private headToward(target: THREE.Vector3, maxStep: number): number {
    const n = this.n;
    _d.copy(target).sub(this.body.position);
    _d.addScaledVector(n, -_d.dot(n));
    if (_d.lengthSq() < 1e-6) return 0;
    _d.normalize();
    const ang = Math.atan2(_a.crossVectors(this.fwd, _d).dot(n), this.fwd.dot(_d));
    const step = THREE.MathUtils.clamp(ang, -maxStep, maxStep);
    this.fwd.applyAxisAngle(n, step).addScaledVector(n, -this.fwd.dot(n)).normalize();
    this.left.crossVectors(n, this.fwd).normalize();
    return ang - step;
  }

  /**
   * Advance along the surface by `dist`. Returns false when the surface is lost (caller drops).
   * Concave corners: probe ahead and step onto the obstacle. Convex edges: wrap around to the face below.
   */
  private crawl(dist: number): boolean {
    const phys = this.world.ctx.physics, p = this.body.position, n = this.n, f = this.fwd;
    // concave: something ahead within reach → climb onto it
    _o.copy(p).addScaledVector(n, 0.12);
    const ahead = phys.raycast(_o, f, 0.3 + dist);
    if (ahead && ahead.normal.dot(n) < 0.7) {
      const nn = _v2.copy(ahead.normal);
      _v.copy(n).addScaledVector(nn, -n.dot(nn));
      if (_v.lengthSq() < 1e-4) return false;
      p.copy(ahead.point);
      n.copy(nn);
      f.copy(_v.normalize());
      this.left.crossVectors(n, f).normalize();
      return true;
    }
    p.addScaledVector(f, dist);
    // stick: re-find the surface under us
    _o.copy(p).addScaledVector(n, 0.3);
    _d.copy(n).negate();
    const under = phys.raycast(_o, _d, 0.62);
    if (under && under.normal.dot(n) > 0.55) {
      p.copy(under.point);
      n.lerp(under.normal, 0.5).normalize();
      f.addScaledVector(n, -f.dot(n)).normalize();
      this.left.crossVectors(n, f).normalize();
      return true;
    }
    // convex edge: the face that continues below the edge
    _o.copy(p).addScaledVector(n, -0.14);
    _d.copy(f).negate();
    const wrap = phys.raycast(_o, _d, 0.45);
    if (wrap && wrap.normal.dot(f) > 0.6) {
      const oldN = _v.copy(n);
      p.copy(wrap.point);
      n.copy(wrap.normal);
      f.copy(oldN).negate();
      f.addScaledVector(n, -f.dot(n)).normalize();
      this.left.crossVectors(n, f).normalize();
      return true;
    }
    return false;
  }

  /** Floor skitters look for a wall beside the route to the player to climb. Fills wallPoint/wallNormal. */
  private findWall(): boolean {
    const w = this.world, p = this.body.position, phys = w.ctx.physics;
    const base = Math.atan2(w.playerPos.x - p.x, w.playerPos.z - p.z);
    let best = 1e9;
    _o.set(p.x, p.y + 0.3, p.z);
    for (const off of [0.8, -0.8, 1.45, -1.45, 0.35, -0.35]) {
      const a = base + off;
      _d.set(Math.sin(a), 0, Math.cos(a));
      const hit = phys.raycast(_o, _d, 2.4);
      if (!hit || Math.abs(hit.normal.y) > 0.3 || hit.distance < 0.35) continue;
      // tall enough to be worth it: still wall 1.6 m higher
      _v.copy(hit.point).addScaledVector(hit.normal, 0.2); _v.y += 1.6;
      _v2.copy(hit.normal).negate();
      const up = phys.raycast(_v, _v2, 0.5);
      if (!up || up.normal.dot(hit.normal) < 0.8) continue;
      const score = hit.distance + Math.abs(off) * 0.4;
      if (score < best) { best = score; this.wallPoint.copy(hit.point); this.wallNormal.copy(hit.normal); }
    }
    return best < 1e8;
  }

  // ───────────────────────────────────────────────────────── update

  update(dt: number): void {
    this.stateTime += dt; this.modeTime += dt;
    const w = this.world, p = this.body.position, phys = w.ctx.physics;
    if (this.mode === 'dead') return;
    if (this.mode === 'dormant') {
      if (this.wakeDelay >= 0) {
        this.wakeDelay -= dt;
        if (this.wakeDelay <= 0) this.beginWake();
      }
      return;
    }
    if (this.mode === 'emerge' && this.delay > 0) {
      this.delay -= dt;
      if (this.delay <= 0) this.beginEmerge();
      return;
    }
    this.perceive(dt);
    if (this.leapCool > 0) this.leapCool -= dt;
    if (this.climbCool > 0) this.climbCool -= dt;
    const hd = Math.hypot(w.playerPos.x - p.x, w.playerPos.z - p.z);
    let wantCurl = 0, wantAir = 0;
    this.speedNow = 0;
    if (this.attached) this.surfTime += dt;

    switch (this.mode) {
      case 'emerge': {
        // dropping out of a vent, legs tucked; unfolds on landing
        wantCurl = 0.85;
        phys.moveBody(this.body, dt);
        if (this.body.onGround || this.modeTime > 4) {
          this.bob.v -= 2.2;
          this.emit('enemy:step');
          this.floorFrame();
          this.plantAll();
          this.setMode('unfold');
        }
        break;
      }
      case 'unfold':
        wantCurl = 0;
        if (this.attached) this.headToward(w.playerPos, 4 * dt);
        else { this.moveGround(dt, 0, 0, 0, 10); this.faceToward(w.playerPos.x, w.playerPos.z, 6 * dt); }
        if (this.modeTime > (this.attached ? 0.55 : 0.38)) { this.emit('enemy:alerted'); this.setMode(this.attached ? 'climb' : 'chase'); }
        break;
      case 'idle':
        this.moveGround(dt, 0, 0, 0, 10);
        if (this.noticesPlayer(13)) this.enterAlert();
        break;
      case 'look':
        // freeze, stare, antennae forward
        if (this.attached) this.headToward(w.playerPos, 6 * dt);
        else { this.moveGround(dt, 0, 0, 0, 14); this.faceToward(w.playerPos.x, w.playerPos.z, 7 * dt); }
        if (this.modeTime > this.lookDur) this.setMode(this.attached ? 'climb' : 'chase');
        break;
      case 'chase': {
        if (!w.playerAlive) { this.moveGround(dt, 0, 0, 0, 8); break; }
        this.navigate(dt, 0.22);
        const bias = this.watchdog(dt, true, 5);
        let tx = this.waypoint.x - p.x, tz = this.waypoint.z - p.z;
        const l = Math.hypot(tx, tz) || 1;
        tx /= l; tz /= l;
        // erratic zig-zag: lateral weave that flips at random
        this.zig += dt;
        if (w.rand() < dt * 1.3) this.zigDir = -this.zigDir;
        const weave = (Math.sin(this.zig * 5.3 + this.seed) * 0.6 + noise1(this.zig * 1.7, this.seed) * 0.7) * this.zigDir * smooth((hd - 1.5) / 2.5) + bias * 1.2;
        const dx = tx - tz * weave, dz = tz + tx * weave;
        const dl = Math.hypot(dx, dz) || 1;
        this.faceToward(p.x + dx, p.z + dz, 9 * dt);
        const align = Math.max(0.25, Math.cos(angleDiff(Math.atan2(-dx, -dz), this.yaw)));
        this.moveGround(dt, dx / dl, dz / dl, SPEED * align, 14);
        // wall-hugging: sometimes take the route along a wall
        this.climbTimer -= dt;
        if (this.climbTimer <= 0) {
          this.climbTimer = 0.5 + w.rand() * 0.3;
          if ((this.climber || this.climbChance >= 1) && this.climbCool <= 0 && this.body.onGround && hd > 4.5 && hd < 15 && w.rand() < this.climbChance && this.findWall()) {
            this.surfGoal = w.rand() < this.ceilingChance ? 'ceiling' : 'wall';
            this.setMode('towall');
            break;
          }
        }
        // stop and stare
        this.pauseTimer -= dt;
        if (this.pauseTimer <= 0 && hd > 4 && this.seesPlayer) {
          this.pauseTimer = 1.6 + w.rand() * 3;
          this.lookDur = 0.25 + w.rand() * 0.45;
          this.setMode('look');
          break;
        }
        // leap
        if (hd < 3.3 && hd > 1.0 && this.seesPlayer && this.leapCool <= 0 && this.body.onGround && Math.abs(w.playerPos.y - p.y) < 1.6) {
          this.setMode('crouch');
          this.emitAttack('melee');
        } else if (hd <= 1.0 && this.leapCool <= 0) {
          // too close to leap: back off first
          this.startRetreat(0.5);
        }
        break;
      }
      case 'towall': {
        // run at the chosen wall; when it is right ahead, step onto it
        const dx = this.wallPoint.x - p.x, dz = this.wallPoint.z - p.z;
        const dl = Math.hypot(dx, dz) || 1;
        this.faceToward(this.wallPoint.x, this.wallPoint.z, 10 * dt);
        this.moveGround(dt, dx / dl, dz / dl, SPEED, 14);
        this.floorFrame();
        _o.set(p.x, p.y + 0.12, p.z);
        const hit = dl < 1.2 ? phys.raycast(_o, this.fwd, 0.5) : null;
        if (hit && hit.normal.dot(this.wallNormal) > 0.8) {
          this.attachTo(hit.point, hit.normal);
          this.emit('enemy:step');
          this.setMode('climb');
        } else if (this.modeTime > 2.2 || hd < 2.2) {
          this.climbCool = 2;
          this.setMode('chase');
        }
        break;
      }
      case 'climb':
        this.tickClimb(dt, hd);
        break;
      case 'wcrouch': {
        // clinging telegraph: pulls in tight to the surface, then springs
        this.headToward(w.playerPos, 8 * dt);
        if (this.modeTime > 0.3) {
          const fromCeil = this.n.y < -0.5;
          this.detach();
          this.launchAt(fromCeil ? 0.85 : 1.15);
          this.bit = false;
          this.setMode('leap');
        }
        break;
      }
      case 'fall':
        // lost the surface (or knocked off): tumble down, land, carry on
        wantCurl = 0.35;
        phys.moveBody(this.body, dt);
        if (this.body.onGround || this.modeTime > 3) {
          this.bob.v -= 1.8;
          this.emit('enemy:step');
          this.floorFrame();
          this.plantAll();
          this.setMode('chase');
        }
        break;
      case 'crouch':
        // telegraph: body dips, rear lifts, mandibles gape
        this.moveGround(dt, 0, 0, 0, 16);
        this.faceToward(w.playerPos.x, w.playerPos.z, 10 * dt);
        if (this.modeTime > 0.26) {
          this.launchAt(1.15);
          this.bit = false;
          this.setMode('leap');
        }
        break;
      case 'leap': {
        wantAir = 1;
        phys.moveBody(this.body, dt);
        const hd2 = Math.hypot(w.playerPos.x - p.x, w.playerPos.z - p.z);
        if (!this.bit && w.playerAlive) {
          const dy = p.y + 0.2 - (w.playerPos.y + 1.0);
          if (hd2 < 0.75 && Math.abs(dy) < 0.95) {
            this.bit = true;
            w.ctx.player.damage(MELEE, p);
            // bounce off
            const nx = (p.x - w.playerPos.x) / (hd2 || 1), nz = (p.z - w.playerPos.z) / (hd2 || 1);
            this.body.velocity.set(nx * 3.5 + (w.rand() - 0.5) * 2, 2.5, nz * 3.5 + (w.rand() - 0.5) * 2);
          }
        }
        this.keepOffPlayer();
        if ((this.body.onGround && this.modeTime > 0.12) || this.modeTime > 1.6) {
          this.bob.v -= 1.6;
          this.emit('enemy:step');
          this.floorFrame();
          this.plantAll();
          this.leapCool = 1.2 + w.rand() * 0.8;
          this.startRetreat(0.9 + w.rand() * 0.9);
        }
        break;
      }
      case 'retreat': {
        // back away then circle
        const ax = p.x - w.playerPos.x, az = p.z - w.playerPos.z;
        const al = Math.hypot(ax, az) || 1;
        const away = hd < 4.2 ? 1 : hd > 6 ? -0.4 : 0.1;
        let dx = (ax / al) * away + (-az / al) * this.retreatDir, dz = (az / al) * away + (ax / al) * this.retreatDir;
        const bias = this.watchdog(dt, true, 5);
        if (bias !== 0) this.retreatDir = -this.retreatDir;
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl; dz /= dl;
        this.faceToward(p.x + dx, p.z + dz, 9 * dt);
        this.moveGround(dt, dx, dz, SPEED * 0.9, 14);
        if (this.modeTime > this.retreatDur) this.setMode('chase');
        break;
      }
      case 'stagger':
        if (this.attached) { if (this.modeTime > 0.25) this.setMode('climb'); break; }
        this.moveGround(dt, 0, 0, 0, 4);
        if (this.modeTime > 0.28) this.setMode('chase');
        break;
      case 'dying': {
        wantCurl = 1;
        this.body.velocity.x *= Math.exp(-3 * dt); this.body.velocity.z *= Math.exp(-3 * dt);
        phys.moveBody(this.body, dt);
        this.flip = Math.min(1, this.flip + dt * 2.6);
        if (!this.exploded && this.modeTime > 0.42) {
          this.exploded = true;
          _v.set(p.x, p.y + 0.15, p.z);
          try {
            w.ctx.fx.explosion(_v, 0.35);
            w.ctx.fx.sparks(_v, UP, 16, 4);
          } catch { /* fx optional */ }
          this.shedLegs(2, 3.5);
          this.setEye(false);
          if (this.light) { this.light.remove(); this.light = null; }
        }
        if (this.modeTime > 1.5 && this.body.onGround) { this.mode = 'dead'; this.settled = true; }
        break;
      }
    }
    if (!this.attached && this.mode !== 'towall') this.floorFrame();
    this.curl = damp(this.curl, wantCurl, this.mode === 'dying' ? 9 : 12, dt);
    this.air = damp(this.air, wantAir, 16, dt);
    this.pose(dt);
    this.tickLoop(dt);
  }

  /** Ballistic jump at the player's chest (T scales the flight time). */
  private launchAt(tScale: number): void {
    const w = this.world, p = this.body.position, phys = w.ctx.physics;
    const hd = Math.hypot(w.playerPos.x - p.x, w.playerPos.z - p.z);
    const ty = w.playerPos.y + 1.15 - p.y;
    const T = THREE.MathUtils.clamp(hd / 8.5, 0.22, 0.45) * tScale;
    const g = -phys.gravity;
    const dirx = (w.playerPos.x - p.x) / (hd || 1), dirz = (w.playerPos.z - p.z) / (hd || 1);
    this.body.velocity.set(dirx * hd / T, ty / T + 0.5 * g * T, dirz * hd / T);
    this.body.onGround = false;
    this.yaw = Math.atan2(dirx, dirz) - Math.PI;
  }

  /** Crawling on a wall / ceiling toward a point above the player, then leap or drop. */
  private tickClimb(dt: number, hd: number): void {
    const w = this.world, p = this.body.position, n = this.n;
    if (!this.attached) { this.setMode('fall'); return; }
    const onCeil = n.y < -0.6, onWall = Math.abs(n.y) < 0.5;
    // target: the player's position projected onto our surface (on a wall: at climbing height)
    _t.copy(w.playerPos);
    if (onWall) {
      const floorY = w.playerPos.y;
      _t.y = this.surfGoal === 'ceiling' ? floorY + 20 : floorY + 1.9 + Math.sin(this.surfTime * 1.3 + this.seed) * 0.25;
    }
    // weave a little so it does not crawl a ruler-straight line
    const weave = noise1(this.surfTime * 1.4, this.seed + 7) * 0.5;
    const rem = this.headToward(_t, 5 * dt);
    this.fwd.applyAxisAngle(n, weave * dt * 2).normalize();
    this.left.crossVectors(n, this.fwd).normalize();
    // on a wall at the right height: hold position while the player is far along it (no up/down jitter)
    let speed = CLIMB_SPEED * Math.max(0.3, Math.cos(Math.min(1.4, Math.abs(rem))));
    _v.copy(_t).sub(p); _v.addScaledVector(n, -_v.dot(n));
    if (_v.length() < 0.25) speed = 0;
    this.speedNow = speed;
    if (speed > 0 && !this.crawl(speed * dt)) { this.loseGrip(); return; }
    this.body.velocity.copy(this.fwd).multiplyScalar(speed);
    // progress watchdog: no real movement for a while → let go
    this.surfCheckT += dt;
    if (this.surfCheckT > 1.2) {
      const moved = this.surfCheck.distanceTo(p);
      this.surfCheckT = 0; this.surfCheck.copy(p);
      if (moved < 0.2 && speed > 0) { this.loseGrip(); return; }
    }
    if (this.surfTime > SURF_MAX || !w.playerAlive) { this.loseGrip(); return; }
    // strike from the surface
    const range = onCeil ? CEIL_LEAP : WALL_LEAP;
    const height = p.y - w.playerPos.y;
    if (this.leapCool <= 0 && hd < range && hd > 0.6 && this.seesPlayer && height > -0.5) {
      this.setMode('wcrouch');
      this.emitAttack('melee');
      return;
    }
    // parked on the surface with no shot (player far along / away from it): drop and use the floor
    this.stillT = speed === 0 ? this.stillT + dt : 0;
    if (this.stillT > (this.seesPlayer ? 1.6 : 0.8)) { this.stillT = 0; this.loseGrip(); }
  }

  /** Lost the surface (edge, doorway, moving door, timeout): drop and carry on as a floor machine. */
  private loseGrip(): void {
    if (!this.attached) { this.setMode('fall'); return; }
    this.detach(this.fwd.x * 0.8, 0, this.fwd.z * 0.8);
    this.setMode('fall');
  }

  private startRetreat(dur: number): void {
    this.retreatDir = this.world.rand() < 0.5 ? -1 : 1;
    this.retreatDur = dur;
    this.setMode('retreat');
  }

  override wake(delay = 0): void {
    if (!this.alive || this.awake || this.wakeDelay >= 0) return;
    this.wakeDelay = Math.max(0, delay);
  }

  private beginWake(): void {
    this.awake = true; this.wakeDelay = -1;
    this.onAwake();
    this.world.ctx.events.emit('enemy:woke', { id: this.id, type: this.type, position: this.body.position });
    this.plantAll();
    this.setMode('unfold');
  }

  // ───────────────────────────────────────────────────────── pose

  private pose(dt: number): void {
    const B = this.B, w = this.world, p = this.body.position, v = this.body.velocity, phys = w.ctx.physics;
    const t = w.time;
    const N = this.n, F = this.fwd, Lv = this.left;
    const speed = this.attached ? this.speedNow : Math.hypot(v.x, v.z);
    const grounded = this.mode !== 'leap' && this.mode !== 'emerge' && this.mode !== 'dying' && this.mode !== 'fall';
    if (dt > 0) { this.yawRate = damp(this.yawRate, angleDiff(this.yaw, this.lastYaw) / dt, 10, dt); this.lastYaw = this.yaw; }

    // ── feet (home points in the surface frame, projected onto the surface along -n)
    const moving = speed > 0.25;
    const vx = moving ? v.x / speed : 0, vy = moving ? v.y / speed : 0, vz = moving ? v.z / speed : 0;
    const dur = THREE.MathUtils.clamp(0.3 / (1 + speed * 0.8), 0.055, 0.18);
    let swinging0 = 0, swinging1 = 0;
    for (const l of this.legs) if (l.t < 1) { if (l.group === 0) swinging0++; else swinging1++; }
    let avgY = 0, n = 0, pitchAcc = 0, rollAcc = 0;
    for (let i = 0; i < this.legs.length; i++) {
      const l = this.legs[i];
      // home in world space
      _v.copy(p).addScaledVector(Lv, l.rest.x).addScaledVector(F, l.rest.z);
      if (!grounded || this.curl > 0.5) {
        // feet ride with the body (tucked or splayed for the flight)
        const k = this.air;
        _v2.copy(p).addScaledVector(Lv, l.rest.x * (1 - 0.25 * k)).addScaledVector(F, l.rest.z + 0.16 * k).addScaledVector(N, 0.02 + 0.1 * k);
        l.pos.copy(_v2);
        l.t = 1;
      } else {
        if (l.t >= 1) {
          _a.copy(_v).sub(l.pos);
          const err = _a.length();
          const other = l.group === 0 ? swinging1 : swinging0;
          const thresh = moving ? Math.max(0.06, speed * dur * 0.38) : 0.06;
          if (err > thresh && (other === 0 || err > thresh * 1.8) && (!moving || _a.x * vx + _a.y * vy + _a.z * vz > -0.03)) {
            l.t = 0; l.dur = dur * (0.9 + 0.2 * ((i * 7) % 3) / 2);
            l.from.copy(l.pos);
            this.footTarget(_v, v, dur * 1.3, l.to);
            if (l.group === 0) swinging0++; else swinging1++;
          }
        }
        if (l.t < 1) {
          l.t += dt / l.dur;
          const remain = Math.max(0, 1 - l.t) * l.dur;
          // overshoot past home in the direction of travel (stays on the surface plane)
          const lead = remain + l.dur * 0.5;
          const off = (l.to.x - p.x) * N.x + (l.to.y - p.y) * N.y + (l.to.z - p.z) * N.z;
          l.to.copy(_v).addScaledVector(v, lead).addScaledVector(N, off - ((_v.x - p.x) * N.x + (_v.y - p.y) * N.y + (_v.z - p.z) * N.z));
          if (l.t >= 1) {
            l.t = 1; l.pos.copy(l.to);
            this.stepEmit -= 1;
            if (this.stepEmit <= 0 && moving) { this.stepEmit = 2; this.emit('enemy:step'); }
          } else {
            const k = l.t * l.t * (3 - 2 * l.t);
            l.pos.lerpVectors(l.from, l.to, k).addScaledVector(N, Math.sin(Math.PI * l.t) * (0.05 + speed * 0.008));
          }
        }
        if (l.t >= 1) {
          const fy = (l.pos.x - p.x) * N.x + (l.pos.y - p.y) * N.y + (l.pos.z - p.z) * N.z;
          avgY += fy; n++;
          pitchAcc += fy * (l.rest.z > 0.1 ? -1 : l.rest.z < -0.1 ? 1 : 0);
          rollAcc += fy * l.side;
        }
      }
    }
    void phys;
    // ── body
    spring(this.bob, 0, 4.5, 0.35, dt || 0.016);
    const crouch = this.mode === 'crouch' ? smooth(this.modeTime / 0.2) : this.mode === 'wcrouch' ? smooth(this.modeTime / 0.2) : 0;
    const look = this.mode === 'look' ? 1 : 0;
    let by = SK.bodyY + (n ? avgY / n : 0) * 0.6 + this.bob.x * 0.5 - crouch * 0.07 - look * 0.03 + Math.sin(t * 31 + this.seed) * 0.003 * Math.min(1, speed / 3);
    if (this.attached) by -= 0.035; // hugs walls / ceilings tighter
    by = by * (1 - this.curl) + 0.09 * this.curl;
    if (this.mode === 'dormant') by = 0.085;
    this.bodyY = damp(this.bodyY, by, 18, dt || 1);
    const accelLean = THREE.MathUtils.clamp(speed * 0.012, 0, 0.08);
    const wantPitch = (n >= 3 ? pitchAcc * 1.2 : 0) + accelLean + crouch * 0.28 - this.air * 0.35 + (this.mode === 'emerge' ? 0.3 : 0);
    const wantRoll = (n >= 3 ? rollAcc * 0.9 : 0) + THREE.MathUtils.clamp(-this.yawRate * 0.03, -0.3, 0.3);
    this.pitch = damp(this.pitch, wantPitch, 12, dt || 1);
    this.roll = damp(this.roll, wantRoll, 10, dt || 1);
    const fl = this.flip * this.flip * (3 - 2 * this.flip);
    B.body.position.set(0, this.bodyY + Math.sin(fl * Math.PI) * 0.12 + fl * 0.02, 0);
    B.body.quaternion.setFromEuler(_e.set(this.pitch, 0, this.roll + fl * Math.PI * 0.94 * this.flipDir, 'YXZ'));

    // ── abdomen, spool, tail (follow-through)
    if (dt > 0) {
      spring(this.abYaw, THREE.MathUtils.clamp(-this.yawRate * 0.07, -0.5, 0.5), 3.2, 0.4, dt);
      spring(this.abPitch, crouch * -0.35 + this.air * 0.3 + this.bob.x * 1.5, 4, 0.4, dt);
      spring(this.tail[0], THREE.MathUtils.clamp(-this.yawRate * 0.12, -0.9, 0.9), 2.2, 0.3, dt);
      spring(this.tail[1], this.tail[0].x * 1.2, 1.8, 0.3, dt);
      B.spool.rotateX(-speed * dt * 6);
    }
    B.abdomen.quaternion.setFromEuler(_e.set(this.abPitch.x, this.abYaw.x, 0, 'YXZ'));
    // on a ceiling the cable hangs: let the tail droop away from the surface
    const droop = this.attached && N.y < -0.5 ? -0.6 : 0;
    B.tail1.quaternion.setFromEuler(_e.set(-this.pitch - this.abPitch.x + this.air * 0.5 + droop, this.tail[0].x, 0, 'YXZ'));
    B.tail2.quaternion.setFromEuler(_e.set(droop * 0.5, this.tail[1].x, 0, 'YXZ'));
    B.tail3.quaternion.setFromEuler(_e.set(droop * 0.3, this.tail[1].x * 0.8, 0, 'YXZ'));

    // ── head tracks the player; antennae whip; mandibles chatter
    if (dt > 0 && this.awake && this.alive) {
      _d.copy(w.playerEye).sub(p);
      const lx = _d.dot(Lv), lz = _d.dot(F), ly = _d.dot(N) - this.bodyY;
      const tracking = this.state !== 'idle';
      const wy = tracking ? THREE.MathUtils.clamp(Math.atan2(lx, lz), -1.1, 1.1) : Math.sin(t * 0.7 + this.seed) * 0.5;
      const wp = tracking ? THREE.MathUtils.clamp(-Math.atan2(ly, Math.hypot(lx, lz)), -0.8, 0.4) - this.pitch : 0.1;
      spring(this.headYaw, wy, 5, 0.42, dt);
      spring(this.headPitch, wp, 5, 0.5, dt);
      for (let i = 0; i < 4; i++) {
        const tgt = noise1(t * (2.2 + i * 0.7), this.seed + i * 5) * 0.35 + (look ? -0.5 : 0) - Math.min(0.6, speed * 0.07) * (i % 2 === 0 ? 1 : 1.4);
        if (w.rand() < dt * 1.2) this.ant[i].v += (w.rand() - 0.5) * 30;
        spring(this.ant[i], tgt, 6, 0.25, dt);
      }
      const gape = this.mode === 'crouch' || this.mode === 'wcrouch' ? 0.9 : this.mode === 'leap' ? (this.bit ? 0.05 : 1.0) : 0.2 + Math.max(0, noise1(t * 6, this.seed + 9)) * 0.5 * (hdNear(this.dist));
      this.mand = damp(this.mand, gape, this.mode === 'leap' ? 30 : 14, dt);
    } else if (!this.alive && dt > 0) {
      for (let i = 0; i < 4; i++) spring(this.ant[i], 0.9, 3, 0.3, dt);
      spring(this.headPitch, 0.5, 3, 0.5, dt); spring(this.headYaw, 0.3 * this.flipDir, 3, 0.5, dt);
    }
    B.neck.quaternion.setFromEuler(_e.set(this.headPitch.x * 0.4, this.headYaw.x * 0.45, 0, 'YXZ'));
    B.head.quaternion.setFromEuler(_e.set(this.headPitch.x * 0.6, this.headYaw.x * 0.55, noise1(t * 3, this.seed + 2) * 0.12 * (this.alive ? 1 : 0), 'YXZ'));
    B.ant1_l.quaternion.setFromEuler(_e.set(this.ant[0].x, 0, this.ant[0].x * 0.3));
    B.ant2_l.quaternion.setFromEuler(_e.set(this.ant[1].x * 1.3, 0, 0));
    B.ant1_r.quaternion.setFromEuler(_e.set(this.ant[2].x, 0, -this.ant[2].x * 0.3));
    B.ant2_r.quaternion.setFromEuler(_e.set(this.ant[3].x * 1.3, 0, 0));
    B.mand_l.quaternion.setFromEuler(_e.set(0, this.mand * 0.75, 0));
    B.mand_r.quaternion.setFromEuler(_e.set(0, -this.mand * 0.75, 0));

    // ── root transform (smoothed through surface transitions), then leg IK in each mount's frame
    _mb.makeBasis(Lv, N, F);
    _qt.setFromRotationMatrix(_mb);
    if (dt > 0) this.qVis.slerp(_qt, 1 - Math.exp(-(this.attached || this.mode === 'fall' || this.mode === 'leap' ? 13 : 30) * dt));
    else this.qVis.copy(_qt);
    this.object.position.copy(p);
    this.object.quaternion.copy(this.qVis);
    this.object.updateMatrixWorld(true);
    _inv.copy(B.body.matrixWorld).invert();
    for (let i = 0; i < this.legs.length; i++) {
      const l = this.legs[i];
      if (l.gone) continue;
      _m.multiplyMatrices(l.inv, _inv);
      _t.copy(l.pos).applyMatrix4(_m);
      if (this.curl > 0.001) {
        // curled: tips pulled in under the belly, knees up
        _v2.set(0, -0.05 - 0.035 * Math.sin(i * 2.1), 0.1 + 0.03 * Math.cos(i * 1.7));
        _t.lerp(_v2, this.curl);
      }
      const yaw = Math.atan2(_t.x, _t.z);
      const r = Math.max(0.02, Math.hypot(_t.x, _t.z) - SK.coxa);
      solvePlanar(r, _t.y, SK.femur, SK.tibia, _p2);
      l.coxa.rotation.set(0, THREE.MathUtils.clamp(yaw, -1.3, 1.3), 0);
      l.femur.rotation.set(-_p2.x, 0, 0);
      l.tibia.rotation.set(Math.PI - _p2.y, 0, 0);
    }
    if (this.light) {
      const e = B.head.matrixWorld.elements;
      this.light.position.set(e[12] + e[8] * 0.22, e[13] + e[9] * 0.22 + 0.03, e[14] + e[10] * 0.22);
    }
  }

  /** Where a foot whose home is `home` should land: projected onto the surface along -n (velocity lead). */
  private footTarget(home: THREE.Vector3, v: THREE.Vector3, lead: number, out: THREE.Vector3): void {
    const N = this.n;
    _o.copy(home).addScaledVector(v, lead).addScaledVector(N, 0.45);
    _d.copy(N).negate();
    const hit = this.world.ctx.physics.raycast(_o, _d, 1.1);
    if (hit) { out.copy(hit.point); return; }
    // nothing under that point (edge): reach around it, else keep the foot on the surface plane
    out.copy(home);
  }

  // ───────────────────────────────────────────────────────── damage

  protected hitFx(b: HitBurst): void {
    const fx = this.world.ctx.fx, A = b.amount;
    fx.sparks(b.point, b.normal, THREE.MathUtils.clamp(Math.round(3 + A / 7 + (b.part === 'head' ? 2 : 0)), 3, 14), 3 + Math.min(2, A / 30));
    if (b.part !== 'limb') { const fl = Math.min(5, Math.round(A / 14)); if (fl > 0) fx.fluid(b.point, b.dir, fl); }
  }

  applyDamage(vol: HitVolume, amount: number, point: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.alive) return;
    const w = this.world;
    const mult = vol.part === 'head' ? 1.5 : vol.part === 'limb' ? 0.6 : 1;
    const dmg = amount * mult;
    this.health -= dmg;
    w.ctx.events.emit('enemy:damaged', { id: this.id, type: this.type, point, direction: dir, amount: dmg });
    this.queueHit(vol, amount, point, dir);
    this.bob.v -= 1.5;
    if (this.health <= 0) { this.die(dir); return; }
    if (this.mode === 'dormant') { this.wakeDelay = -1; this.beginWake(); return; }
    if (this.mode === 'idle') this.enterAlert();
    if (this.attached) {
      // a solid hit knocks it off the wall / ceiling
      if (amount >= 14 && this.mode !== 'unfold') { this.detach(dir.x * 3, 0.5, dir.z * 3); this.setMode('fall'); }
      else if (this.mode === 'climb' || this.mode === 'wcrouch') this.setMode('stagger');
      return;
    }
    if (this.mode === 'chase' || this.mode === 'look' || this.mode === 'crouch' || this.mode === 'retreat' || this.mode === 'unfold' || this.mode === 'towall') {
      this.body.velocity.x += dir.x * 4; this.body.velocity.z += dir.z * 4;
      this.setMode('stagger');
    }
  }

  private shedLegs(count: number, speed: number): void {
    const w = this.world;
    let k = 0;
    for (const l of this.legs) {
      if (l.gone || w.rand() < 0.4) continue;
      l.gone = true;
      for (const bone of [l.tibia, l.femur]) {
        const mesh = this.tpl.rig.debrisMesh(bone.name);
        if (!mesh) continue;
        bone.updateWorldMatrix(true, false);
        bone.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
        _imp.set((w.rand() - 0.5) * speed * 2, 2 + w.rand() * speed, (w.rand() - 0.5) * speed * 2);
        try { w.ctx.fx.debris(mesh.position, _imp, [mesh], 12); } catch { /* */ }
      }
      l.femur.scale.setScalar(1e-4);
      if (++k >= count) break;
    }
  }

  private die(dir: THREE.Vector3): void {
    if (!this.alive) return;
    const w = this.world;
    if (this.attached) this.detach();
    this.alive = false; this.health = 0; this.awake = true;
    this.body.velocity.x += dir.x * 3; this.body.velocity.z += dir.z * 3; this.body.velocity.y = Math.max(this.body.velocity.y, 2.6);
    this.body.onGround = false;
    this.flipDir = w.rand() < 0.5 ? -1 : 1;
    this.setMode('dying');
    this.stopLoop(0.2);
    _v.set(this.body.position.x, this.body.position.y + 0.2, this.body.position.z);
    try { w.ctx.fx.sparks(_v, UP, 12, 4); } catch { /* */ }
    this.diedAt = w.time;
    w.onDeath(this);
  }

  override dispose(): void {
    if (this.light) { this.light.remove(); this.light = null; }
    this.rig.skeleton.dispose();
    super.dispose();
  }
}

function hdNear(d: number): number { return d < 5 ? 1 : 0.4; }
void DOWN;
