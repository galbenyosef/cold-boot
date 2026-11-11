/**
 * SKITTER runtime: six-leg procedural gait (alternating tripod, planted feet, analytic IK),
 * erratic zig-zag approach, pause-and-look, telegraphed leap, retreat/circle, curl-up death.
 */
import * as THREE from 'three';
import type { LightHandle } from '../../core/types';
import { EnemyBase, type EnemyWorld } from '../ai';
import { hv, type HitVolume } from '../shared/hit';
import { angleDiff, damp, noise1, smooth, solvePlanar, spring, type Spring } from '../shared/ik';
import type { Rig } from '../shared/rig';
import { SK, type SkitterTemplate } from './model';

type Mode = 'dormant' | 'emerge' | 'unfold' | 'idle' | 'chase' | 'look' | 'crouch' | 'leap' | 'retreat' | 'stagger' | 'dying' | 'dead';

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
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _t = new THREE.Vector3(), _imp = new THREE.Vector3();
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
const _p2 = new THREE.Vector2();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

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
  private lastVy = 0;
  private stepEmit = 0;
  private delay = 0;
  private eyeOn = true;
  private light: LightHandle | null = null;
  private flip = 0; private flipDir = 1;
  private exploded = false;
  private lastYaw = 0; private yawRate = 0;
  private leapCool = 0;

  constructor(world: EnemyWorld, private tpl: SkitterTemplate, group: string, position: THREE.Vector3, yaw: number, o: { dormant: boolean; emerge?: boolean; delay?: number }) {
    super(world, group, position, yaw, 0.3, 0.5);
    this.health = HP;
    this.eyeHeight = 0.3;
    this.boundCenterY = 0.2; this.boundRadius = 0.75;
    this.seed = this.id * 3.17;
    this.zig = world.rand() * 10;
    this.pauseTimer = 1.5 + world.rand() * 2.5;
    this.rig = tpl.rig.instantiate();
    this.B = this.rig.byName;
    this.object.add(this.rig.root);
    const B = this.B;
    const bodyInv = new THREE.Matrix4().copy(tpl.rig.bones[0].bind).invert();
    tpl.legs.forEach((n, k) => {
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
      void k;
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
      if (this.delay > 0) this.object.visible = false;
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
    this.object.visible = true;
    this.onAwake();
    this.body.velocity.set((this.world.rand() - 0.5) * 1.5, -1, (this.world.rand() - 0.5) * 1.5);
    this.body.onGround = false;
    this.modeTime = 0;
  }

  private setMode(m: Mode): void {
    this.mode = m; this.modeTime = 0;
    this.setState(m === 'dormant' ? 'dormant' : m === 'idle' ? 'idle' : m === 'emerge' || m === 'unfold' ? 'alert'
      : m === 'chase' || m === 'look' || m === 'retreat' ? 'chase' : m === 'crouch' || m === 'leap' ? 'attack' : m === 'stagger' ? 'stagger' : 'dead');
  }

  private plantAll(): void {
    const p = this.body.position, ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    for (const l of this.legs) {
      l.pos.set(p.x + l.rest.x * c + l.rest.z * s, p.y, p.z - l.rest.x * s + l.rest.z * c);
      l.t = 1;
    }
  }

  protected enterAlert(): void {
    if (this.mode !== 'idle') return;
    this.emit('enemy:alerted');
    this.ant[0].v += 20; this.ant[2].v -= 20;
    this.setMode('look'); this.lookDur = 0.35;
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
    const ry0 = this.yaw + Math.PI;
    const hd = Math.hypot(w.playerPos.x - p.x, w.playerPos.z - p.z);
    let wantCurl = 0, wantAir = 0;

    switch (this.mode) {
      case 'emerge': {
        // dropping out of a vent, legs tucked; unfolds on landing
        wantCurl = 0.85;
        this.lastVy = this.body.velocity.y;
        phys.moveBody(this.body, dt);
        if (this.body.onGround || this.modeTime > 4) {
          this.bob.v -= 2.2;
          this.emit('enemy:step');
          this.plantAll();
          this.setMode('unfold');
        }
        break;
      }
      case 'unfold':
        wantCurl = 0;
        this.moveGround(dt, 0, 0, 0, 10);
        this.faceToward(w.playerPos.x, w.playerPos.z, 6 * dt);
        if (this.modeTime > 0.38) { this.emit('enemy:alerted'); this.setMode('chase'); }
        break;
      case 'idle':
        this.moveGround(dt, 0, 0, 0, 10);
        if (this.noticesPlayer(13)) this.enterAlert();
        break;
      case 'look':
        // freeze, stare, antennae forward
        this.moveGround(dt, 0, 0, 0, 14);
        this.faceToward(w.playerPos.x, w.playerPos.z, 7 * dt);
        if (this.modeTime > this.lookDur) this.setMode('chase');
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
        const ry = this.yaw + Math.PI;
        const align = Math.max(0.25, Math.cos(angleDiff(Math.atan2(-dx, -dz), this.yaw)));
        this.moveGround(dt, dx / dl, dz / dl, SPEED * align, 14);
        void ry;
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
      case 'crouch':
        // telegraph: body dips, rear lifts, mandibles gape
        this.moveGround(dt, 0, 0, 0, 16);
        this.faceToward(w.playerPos.x, w.playerPos.z, 10 * dt);
        if (this.modeTime > 0.26) {
          // ballistic jump at where the player's chest is
          const ty = w.playerPos.y + 1.15 - p.y;
          const T = THREE.MathUtils.clamp(hd / 8.5, 0.22, 0.45);
          const g = -phys.gravity;
          const dirx = (w.playerPos.x - p.x) / (hd || 1), dirz = (w.playerPos.z - p.z) / (hd || 1);
          this.body.velocity.set(dirx * hd / T, ty / T + 0.5 * g * T, dirz * hd / T);
          this.body.onGround = false;
          this.bit = false;
          this.setMode('leap');
        }
        break;
      case 'leap': {
        wantAir = 1;
        phys.moveBody(this.body, dt);
        if (!this.bit && w.playerAlive) {
          const dy = p.y + 0.2 - (w.playerPos.y + 1.0);
          if (hd < 0.75 && Math.abs(dy) < 0.95) {
            this.bit = true;
            w.ctx.player.damage(MELEE, p);
            // bounce off
            const nx = (p.x - w.playerPos.x) / (hd || 1), nz = (p.z - w.playerPos.z) / (hd || 1);
            this.body.velocity.set(nx * 3.5 + (w.rand() - 0.5) * 2, 2.5, nz * 3.5 + (w.rand() - 0.5) * 2);
          }
        }
        this.keepOffPlayer();
        if ((this.body.onGround && this.modeTime > 0.12) || this.modeTime > 1.6) {
          this.bob.v -= 1.6;
          this.emit('enemy:step');
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
    void ry0;
    this.curl = damp(this.curl, wantCurl, this.mode === 'dying' ? 9 : 12, dt);
    this.air = damp(this.air, wantAir, 16, dt);
    this.pose(dt);
    this.tickLoop(dt);
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
    const B = this.B, w = this.world, p = this.body.position, v = this.body.velocity;
    const t = w.time;
    const ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    const speed = Math.hypot(v.x, v.z);
    const grounded = this.mode !== 'leap' && this.mode !== 'emerge' && this.mode !== 'dying';
    if (dt > 0) { this.yawRate = damp(this.yawRate, angleDiff(this.yaw, this.lastYaw) / dt, 10, dt); this.lastYaw = this.yaw; }

    // ── feet
    const moving = speed > 0.25;
    const vx = moving ? v.x / speed : 0, vz = moving ? v.z / speed : 0;
    const dur = THREE.MathUtils.clamp(0.3 / (1 + speed * 0.8), 0.055, 0.18);
    let swinging0 = 0, swinging1 = 0;
    for (const l of this.legs) if (l.t < 1) { if (l.group === 0) swinging0++; else swinging1++; }
    let avgY = 0, n = 0, pitchAcc = 0, rollAcc = 0;
    for (let i = 0; i < this.legs.length; i++) {
      const l = this.legs[i];
      // home in world space
      const hx = p.x + l.rest.x * c + l.rest.z * s, hz = p.z - l.rest.x * s + l.rest.z * c;
      if (!grounded || this.curl > 0.5) {
        // feet ride with the body (tucked or splayed for the flight)
        const k = this.air;
        const rx = l.rest.x * (1 - 0.25 * k), rz = l.rest.z + 0.16 * k;
        l.pos.set(p.x + rx * c + rz * s, p.y + 0.02 + 0.1 * k, p.z - rx * s + rz * c);
        l.t = 1;
      } else {
        if (l.t >= 1) {
          const ex = hx - l.pos.x, ez = hz - l.pos.z;
          const err = Math.hypot(ex, ez);
          const other = l.group === 0 ? swinging1 : swinging0;
          const thresh = moving ? Math.max(0.06, speed * dur * 0.38) : 0.06;
          if (err > thresh && (other === 0 || err > thresh * 1.8) && (!moving || ex * vx + ez * vz > -0.03)) {
            l.t = 0; l.dur = dur * (0.9 + 0.2 * ((i * 7) % 3) / 2);
            l.from.copy(l.pos);
            l.to.set(hx, p.y, hz);
            const g = this.groundAt(hx + v.x * dur * 1.3, p.y + 0.45, hz + v.z * dur * 1.3, 1.1);
            l.to.y = g !== null ? g : p.y;
            if (l.group === 0) swinging0++; else swinging1++;
          }
        }
        if (l.t < 1) {
          l.t += dt / l.dur;
          const remain = Math.max(0, 1 - l.t) * l.dur;
          // overshoot past home in the direction of travel
          const lead = remain + l.dur * 0.5;
          l.to.x = hx + v.x * lead; l.to.z = hz + v.z * lead;
          if (l.t >= 1) {
            l.t = 1; l.pos.copy(l.to);
            this.stepEmit -= 1;
            if (this.stepEmit <= 0 && moving) { this.stepEmit = 2; this.emit('enemy:step'); }
          } else {
            const k = l.t * l.t * (3 - 2 * l.t);
            l.pos.x = l.from.x + (l.to.x - l.from.x) * k;
            l.pos.z = l.from.z + (l.to.z - l.from.z) * k;
            l.pos.y = l.from.y + (l.to.y - l.from.y) * k + Math.sin(Math.PI * l.t) * (0.05 + speed * 0.008);
          }
        }
        if (l.t >= 1) {
          const fy = l.pos.y - p.y;
          avgY += fy; n++;
          pitchAcc += fy * (l.rest.z > 0.1 ? -1 : l.rest.z < -0.1 ? 1 : 0);
          rollAcc += fy * l.side;
        }
      }
    }
    // ── body
    spring(this.bob, 0, 4.5, 0.35, dt || 0.016);
    const crouch = this.mode === 'crouch' ? smooth(this.modeTime / 0.2) : 0;
    const look = this.mode === 'look' ? 1 : 0;
    let by = SK.bodyY + (n ? avgY / n : 0) * 0.6 + this.bob.x * 0.5 - crouch * 0.07 - look * 0.03 + Math.sin(t * 31 + this.seed) * 0.003 * Math.min(1, speed / 3);
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
    B.tail1.quaternion.setFromEuler(_e.set(-this.pitch - this.abPitch.x + this.air * 0.5, this.tail[0].x, 0, 'YXZ'));
    B.tail2.quaternion.setFromEuler(_e.set(0, this.tail[1].x, 0, 'YXZ'));
    B.tail3.quaternion.setFromEuler(_e.set(0, this.tail[1].x * 0.8, 0, 'YXZ'));

    // ── head tracks the player; antennae whip; mandibles chatter
    if (dt > 0 && this.awake && this.alive) {
      const dx = w.playerEye.x - p.x, dz = w.playerEye.z - p.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c, ly = w.playerEye.y - (p.y + this.bodyY);
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
      const gape = this.mode === 'crouch' ? 0.9 : this.mode === 'leap' ? (this.bit ? 0.05 : 1.0) : 0.2 + Math.max(0, noise1(t * 6, this.seed + 9)) * 0.5 * (hdNear(this.dist));
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

    // ── root transform, then leg IK in each mount's frame
    this.object.position.copy(p);
    this.object.rotation.y = ry;
    this.object.updateMatrixWorld(true);
    _inv.copy(B.body.matrixWorld).invert();
    const reach = SK.femur + SK.tibia;
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
      void reach;
      l.coxa.rotation.set(0, THREE.MathUtils.clamp(yaw, -1.3, 1.3), 0);
      l.femur.rotation.set(-_p2.x, 0, 0);
      l.tibia.rotation.set(Math.PI - _p2.y, 0, 0);
    }
    if (this.light) {
      const e = B.head.matrixWorld.elements;
      this.light.position.set(e[12] + e[8] * 0.22, e[13] + e[9] * 0.22 + 0.03, e[14] + e[10] * 0.22);
    }
  }

  // ───────────────────────────────────────────────────────── damage

  applyDamage(vol: HitVolume, amount: number, point: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.alive) return;
    const w = this.world;
    const mult = vol.part === 'head' ? 1.5 : vol.part === 'limb' ? 0.6 : 1;
    const dmg = amount * mult;
    this.health -= dmg;
    w.ctx.events.emit('enemy:damaged', { id: this.id, type: this.type, point, direction: dir, amount: dmg });
    try {
      w.ctx.fx.sparks(point, _v.copy(dir).negate(), 4 + Math.round(amount / 5), 3.5);
      if (vol.part !== 'limb') w.ctx.fx.fluid(point, dir, 2 + Math.round(amount / 8));
    } catch { /* fx optional */ }
    this.bob.v -= 1.5;
    if (this.health <= 0) { this.die(dir); return; }
    if (this.mode === 'dormant') { this.wakeDelay = -1; this.beginWake(); return; }
    if (this.mode === 'idle') this.enterAlert();
    if (this.mode === 'chase' || this.mode === 'look' || this.mode === 'crouch' || this.mode === 'retreat' || this.mode === 'unfold') {
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
    this.alive = false; this.health = 0; this.awake = true;
    this.body.velocity.x += dir.x * 3; this.body.velocity.z += dir.z * 3; this.body.velocity.y = 2.6;
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
