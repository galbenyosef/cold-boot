/**
 * SENTRY runtime: gravity-free hover with bob/bank, orbit-strafing at 6–10 m, LOS seeking through the nav graph,
 * sweeping/locking searchlight (real volumetric spot), telegraphed 3-pulse laser that aims at where the player WAS.
 */
import * as THREE from 'three';
import type { LightHandle } from '../../core/types';
import { EnemyBase, type EnemyWorld, type HitBurst } from '../ai';
import type { FactoryOpts } from '../manager';
import { hv, type HitVolume } from '../shared/hit';
import { angleDiff, damp, noise1, smooth, spring, type Spring } from '../shared/ik';
import type { Rig } from '../shared/rig';
import { SN, type SentryTemplate } from './model';

type Mode = 'puppet' | 'dormant' | 'boot' | 'idle' | 'hunt' | 'charge' | 'burst' | 'stagger' | 'dying' | 'dead';

const HP = 60, DMG = 10, HOVER = 2.2, RADIUS = 0.42;
const CHARGE = 0.9, PULSE_GAP = 0.15, AIM_LAG = 0.24;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _aim = new THREE.Vector3(), _muz = new THREE.Vector3(), _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const GLOW_KEYS = ['glow'];
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
let beamGeo: THREE.CylinderGeometry | null = null, beamMat: THREE.MeshBasicMaterial | null = null, boltMat: THREE.MeshBasicMaterial | null = null;

export class Sentry extends EnemyBase {
  readonly type = 'sentry' as const;
  private rig: Rig;
  private B: Record<string, THREE.Bone>;
  mode: Mode = 'idle';
  private modeTime = 0;
  private seed: number;
  private spot: LightHandle | null = null;
  private lightTarget = new THREE.Vector3();
  private beam: THREE.Mesh; private bolt: THREE.Mesh;
  private boltLife = 0;
  private fan = 0; private fanSpeed = 0;
  private bank: Spring = { x: 0, v: 0 }; private tilt: Spring = { x: 0, v: 0 }; private wob: Spring = { x: 0, v: 0 };
  private turYaw = 0; private turPitch = 0.4;
  private orbitDir = 1; private orbitTimer = 0; private orbitR = 8;
  private hoverY = 0; private ceilY = 1e9; private probeTimer = 0;
  private cool: number;
  private pulses = 0; private pulseTimer = 0;
  private lit = false;
  private delay = 0;
  private spin = 0; private smokeT = 0;
  private dockY = 0;
  private lastVel = new THREE.Vector3();
  private clamp = 0;
  // puppet (EnemyManager.actor)
  private pTarget = new THREE.Vector3();
  private pMoving = false; private pSpeed = 2.5; private pDone: (() => void) | null = null;
  private pDock = false; private pStuck = 0; private pLastD = 1e9;
  private lookPt: THREE.Vector3 | null = null;
  private readonly lookBuf = new THREE.Vector3();

  constructor(world: EnemyWorld, private tpl: SentryTemplate, group: string, position: THREE.Vector3, yaw: number, o: FactoryOpts) {
    super(world, group, position, yaw, RADIUS, 0.5);
    this.isActor = !!o.actor;
    this.health = HP;
    this.eyeHeight = 0;
    this.boundCenterY = 0; this.boundRadius = 0.6;
    this.body.gravityScale = 0;
    this.seed = this.id * 5.7;
    this.cool = 1 + world.rand();
    this.rig = tpl.rig.instantiate();
    this.B = this.rig.byName;
    this.lodRig = this.rig;
    this.object.add(this.rig.root);
    const B = this.B;
    this.volumes = [
      hv(B.body, [0, 0, -0.14], [0, 0, 0.12], 0.15, 'core', 'body'),
      hv(B.nac_l, [0, 0, 0], [0, 0, 0], 0.17, 'limb', 'fan'),
      hv(B.nac_r, [0, 0, 0], [0, 0, 0], 0.17, 'limb', 'fan'),
      hv(B.turret, [0, -0.03, 0.03], [0, -0.03, 0.03], 0.1, 'head', 'turret'),
    ];
    if (!beamGeo) {
      beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
      beamGeo.translate(0, 0.5, 0);
      beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.12, 0.06), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 1.2, 0.6), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    }
    this.beam = new THREE.Mesh(beamGeo, beamMat!); this.bolt = new THREE.Mesh(beamGeo, boltMat!);
    for (const m of [this.beam, this.bolt]) { m.visible = false; m.frustumCulled = false; m.renderOrder = 5; world.ctx.scene.add(m); }

    const p = this.body.position;
    if (this.isActor) {
      this.mode = 'puppet'; this.state = 'idle';
      if (o.pose === 'ceiling') {
        this.pDock = true;
        this.findDock();
        p.y = this.dockY; this.clamp = 1;
        this.setLit(false);
      } else {
        if (p.y - (this.groundBelow() ?? p.y) < 0.8) p.y += HOVER;
        this.fanSpeed = 60;
        this.setLit(true);
      }
    } else if (o.dormant) {
      // dock to the first ceiling above the spawn point
      _v.set(p.x, p.y + 0.3, p.z);
      const hit = world.ctx.physics.raycast(_v, UP, 14);
      this.dockY = hit ? hit.point.y - 0.215 : p.y + (p.y < 1 ? 2.6 : 0);
      p.y = this.dockY;
      this.mode = 'dormant'; this.state = 'dormant';
      this.clamp = 1;
      this.setLit(false);
    } else if (o.emerge) {
      this.mode = 'boot'; this.state = 'alert'; this.awake = true;
      this.delay = o.delay ?? 0;
      if (p.y - (this.groundBelow() ?? p.y) < 0.8) p.y += HOVER;
      this.setLit(false);
      if (this.delay <= 0) this.beginBoot(false);
    } else {
      this.awake = true;
      if (p.y - (this.groundBelow() ?? p.y) < 0.8) p.y += HOVER;
      this.mode = 'idle'; this.state = 'idle';
      this.fanSpeed = 60;
      this.powerOn();
    }
    this.hoverY = p.y;
    this.lightTarget.set(p.x, p.y - 2, p.z);
    this.pose(0);
    this.emit('enemy:spawned');
  }

  private findDock(): void {
    const p = this.body.position;
    _v.set(p.x, p.y + 0.3, p.z);
    const hit = this.world.ctx.physics.raycast(_v, UP, 14);
    this.dockY = hit ? hit.point.y - 0.215 : p.y + 0.5;
  }

  private groundBelow(): number | null {
    const p = this.body.position;
    _v.set(p.x, p.y + 0.2, p.z);
    const h = this.world.ctx.physics.raycast(_v, DOWN, 12);
    return h ? h.point.y : null;
  }

  private setLit(on: boolean): void {
    this.lit = on;
    this.B.led.scale.setScalar(on ? 1 : 1e-4);
    this.B.lampglow.scale.setScalar(on ? 1 : 1e-4);
    this.B.gunglow.scale.setScalar(1e-4);
    if (this.spot) this.spot.enabled = on;
    this.rig.setKeysVisible(GLOW_KEYS, on);
  }

  private powerOn(): void {
    if (!this.spot) {
      try {
        this.spot = this.world.ctx.render.lights.add({
          type: 'spot', position: this.body.position.clone(), target: this.lightTarget.clone(), color: 0xcfe2ff, intensity: 190, distance: 24,
          angle: 0.2, penumbra: 0.45, castShadow: true, volumetric: true, priority: 3,
        });
      } catch { this.spot = null; }
    }
    this.setLit(true);
    this.startLoop('sentry_loop', 0.8);
  }

  private beginBoot(woke: boolean): void {
    this.awake = true; this.wakeDelay = -1;
    this.setMode('boot');
    this.powerOn();
    this.rig.setKeysVisible(GLOW_KEYS, true);
    if (woke) this.world.ctx.events.emit('enemy:woke', { id: this.id, type: this.type, position: this.body.position });
  }

  private setMode(m: Mode): void {
    this.mode = m; this.modeTime = 0;
    this.setState(m === 'dormant' ? 'dormant' : m === 'idle' || m === 'puppet' ? 'idle' : m === 'boot' ? 'alert' : m === 'hunt' ? 'chase'
      : m === 'charge' || m === 'burst' ? 'attack' : m === 'stagger' ? 'stagger' : 'dead');
  }

  protected enterAlert(): void {
    if (this.mode !== 'idle') return;
    this.emit('enemy:alerted');
    this.setMode('hunt');
  }

  override wake(delay = 0): void {
    if (!this.alive || this.awake || this.wakeDelay >= 0) return;
    this.wakeDelay = Math.max(0, delay);
  }

  // ───────────────────────────────────────────────────────── update

  update(dt: number): void {
    this.stateTime += dt; this.modeTime += dt;
    const w = this.world, p = this.body.position, v = this.body.velocity, phys = w.ctx.physics;
    if (this.mode === 'dead') return;
    if (this.mode === 'puppet') { this.tickPuppet(dt); return; }
    if (this.mode === 'dormant') {
      if (this.wakeDelay >= 0) { this.wakeDelay -= dt; if (this.wakeDelay <= 0) this.beginBoot(true); }
      return;
    }
    if (this.mode === 'boot' && this.delay > 0) { this.delay -= dt; if (this.delay <= 0) this.beginBoot(false); return; }
    this.perceive(dt);
    if (this.cool > 0) this.cool -= dt;
    if (this.boltLife > 0) { this.boltLife -= dt; if (this.boltLife <= 0) this.bolt.visible = false; else this.bolt.scale.x = this.bolt.scale.z = 0.012 * (this.boltLife / 0.07); }
    const t = w.time;
    let ax = 0, ay = 0, az = 0;
    let lock = false;

    // altitude probes (2 Hz)
    this.probeTimer -= dt;
    if (this.probeTimer <= 0 && this.alive) {
      this.probeTimer = 0.5;
      const g = this.groundBelow();
      _v.set(p.x, p.y, p.z);
      const c = phys.raycast(_v, UP, 8);
      this.ceilY = c ? c.point.y : 1e9;
      const base = g !== null ? g : p.y - HOVER;
      this.hoverY = Math.min(Math.max(base + HOVER, w.playerPos.y + 1.9), this.ceilY - 0.55);
    }

    if (this.mode === 'boot') {
      // lights stutter on, fans spool, clamps let go, sinks off the dock
      this.fanSpeed = damp(this.fanSpeed, 70, 3, dt);
      this.clamp = damp(this.clamp, 0, 6, dt);
      const flick = this.modeTime < 0.5 ? Math.sin(this.modeTime * 80) > 0.1 : true;
      this.B.led.scale.setScalar(flick ? 1 : 1e-4);
      if (this.spot) this.spot.enabled = flick && this.modeTime > 0.25;
      this.B.lampglow.scale.setScalar(flick && this.modeTime > 0.25 ? 1 : 1e-4);
      if (this.modeTime > 0.45) ay += (this.hoverY - p.y) * 6 - v.y * 4;
      this.lightTarget.lerp(_v.set(w.playerPos.x, w.playerPos.y + 1, w.playerPos.z), Math.min(1, dt * 3));
      if (this.modeTime > 1.1) { this.setLit(true); this.emit('enemy:alerted'); this.setMode('hunt'); }
    } else if (this.mode === 'idle') {
      this.fanSpeed = damp(this.fanSpeed, 60, 3, dt);
      ay += (this.hoverY - p.y) * 5 - v.y * 3.5;
      ax -= v.x * 2; az -= v.z * 2;
      this.sweep(dt, t);
      if (this.noticesPlayer(18)) this.enterAlert();
    } else if (this.mode === 'hunt' || this.mode === 'charge' || this.mode === 'burst') {
      this.fanSpeed = damp(this.fanSpeed, 85, 3, dt);
      const dx = p.x - w.playerPos.x, dz = p.z - w.playerPos.z;
      const hd = Math.hypot(dx, dz) || 1;
      let tx: number, tz: number;
      if (this.seesPlayer || w.nav.count === 0) {
        // orbit-strafe at 6–10 m
        this.orbitTimer -= dt;
        if (this.orbitTimer <= 0) { this.orbitTimer = 2 + w.rand() * 3; this.orbitDir = w.rand() < 0.5 ? -1 : 1; this.orbitR = 6.5 + w.rand() * 3; }
        const ang = Math.atan2(dx, dz) + this.orbitDir * 0.5 * (this.mode === 'hunt' ? 1 : 0.35);
        tx = w.playerPos.x + Math.sin(ang) * this.orbitR; tz = w.playerPos.z + Math.cos(ang) * this.orbitR;
        // never drift so far that LOS breaks: if the orbit point is blocked, flip direction
        if (w.rand() < dt * 2) {
          _v.set(tx, this.hoverY, tz);
          if (!phys.lineOfSight(p, _v)) { this.orbitDir = -this.orbitDir; this.orbitR = Math.max(4, this.orbitR - 1.5); }
        }
      } else {
        // seek line of sight along the nav graph
        this.navigate(dt, HOVER * 0.5);
        tx = this.waypoint.x; tz = this.waypoint.z;
      }
      const ex = tx - p.x, ez = tz - p.z;
      const el = Math.hypot(ex, ez) || 1;
      const want = Math.min(4.6, el * 1.6) * (this.mode === 'hunt' ? 1 : 0.45);
      ax += ((ex / el) * want - v.x) * 2.6; az += ((ez / el) * want - v.z) * 2.6;
      ay += (this.hoverY - p.y) * 5 - v.y * 3.5;
      if (hd < 3.5) { ax += (dx / hd) * 6; az += (dz / hd) * 6; }
      // searchlight
      if (this.seesPlayer) {
        lock = true;
        _v.set(w.playerPos.x, w.playerPos.y + 1.1, w.playerPos.z);
        this.lightTarget.lerp(_v, 1 - Math.exp(-(this.mode === 'hunt' ? 5 : 14) * dt));
      } else this.sweep(dt, t);

      if (this.mode === 'hunt') {
        if (this.seesPlayer && this.cool <= 0 && this.dist < 18 && w.playerAlive) {
          this.setMode('charge');
          try { w.ctx.audio.play('sentry_charge', { position: p }); } catch { /* audio optional */ }
        }
      } else if (this.mode === 'charge') {
        if (this.modeTime >= CHARGE) { this.setMode('burst'); this.pulses = 3; this.pulseTimer = 0; }
        else if (!this.seesPlayer && this.modeTime > 0.3) { this.cool = 0.6; this.setMode('hunt'); }
      } else {
        this.pulseTimer -= dt;
        if (this.pulseTimer <= 0 && this.pulses > 0) { this.pulses--; this.pulseTimer = PULSE_GAP; this.fire(); }
        if (this.pulses === 0 && this.pulseTimer <= 0) { this.cool = 1.7 + w.rand() * 0.9; this.setMode('hunt'); }
      }
    } else if (this.mode === 'stagger') {
      this.fanSpeed = damp(this.fanSpeed, 95, 4, dt);
      ay += (this.hoverY - p.y) * 3 - v.y * 2;
      ax -= v.x * 1.5; az -= v.z * 1.5;
      if (this.modeTime > 0.45) this.setMode('hunt');
    } else if (this.mode === 'dying') {
      // lift gone: spins down, trailing smoke, explodes on impact
      this.fanSpeed = damp(this.fanSpeed, 12, 1.2, dt);
      ay += phys.gravity * 0.75;
      this.spin += dt * (3 + this.modeTime * 9);
      this.smokeT -= dt;
      if (this.smokeT <= 0) { this.smokeT = 0.07; try { w.ctx.fx.smoke(p, { count: 1, size: 0.35, color: 0x161616, rise: 0.6, life: 1.4 }); if (w.rand() < 0.4) w.ctx.fx.sparks(p, UP, 3, 2); } catch { /* */ } }
    }

    // bob + integrate + collide
    if (this.alive) { ay += Math.sin(t * 1.9 + this.seed) * 0.9; ax += noise1(t * 0.6, this.seed) * 0.6; az += noise1(t * 0.6, this.seed + 4) * 0.6; }
    v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
    if (this.alive) { const sp = v.length(); if (sp > 6) v.multiplyScalar(6 / sp); }
    this.lastVel.copy(v);
    p.addScaledVector(v, dt);
    _v.copy(p);
    if (phys.resolveSphere(_v, RADIUS)) {
      _v2.copy(_v).sub(p);
      const l = _v2.length();
      p.copy(_v);
      if (l > 1e-5) {
        _v2.multiplyScalar(1 / l);
        const into = v.dot(_v2);
        if (this.mode === 'dying' && (this.modeTime > 0.15) && (_v2.y > 0.4 || this.modeTime > 0.5)) { this.crash(); return; }
        if (into < 0) v.addScaledVector(_v2, -into * 1.3);
      }
    }
    if (this.mode === 'dying' && (this.modeTime > 5 || p.y < -20)) { this.crash(); return; }

    // attitude: bank into lateral acceleration, pitch into forward acceleration
    const ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    const lax = ax * c - az * s, laz = ax * s + az * c;
    spring(this.bank, THREE.MathUtils.clamp(-lax * 0.035, -0.32, 0.32), 1.8, 0.6, dt);
    spring(this.tilt, THREE.MathUtils.clamp(laz * 0.035, -0.28, 0.28), 1.8, 0.6, dt);
    spring(this.wob, 0, 3, 0.3, dt);
    // face: the player when locked, else the direction of travel
    if (this.alive && this.mode !== 'boot') {
      if (lock) this.faceToward(w.playerPos.x, w.playerPos.z, 3.5 * dt);
      else if (Math.hypot(v.x, v.z) > 0.6) this.faceToward(p.x + v.x, p.z + v.z, 2.5 * dt);
    } else if (!this.alive) this.yaw += dt * (3 + this.modeTime * 9);
    this.pose(dt);
    this.aimVisuals(dt);
    this.tickLoop(dt);
  }

  /** Searching: the beam sweeps the floor ahead in a slow figure-eight. */
  private sweep(dt: number, t: number): void {
    const p = this.body.position, ry = this.yaw + Math.PI;
    const a = ry + Math.sin(t * 0.9 + this.seed) * 0.9;
    const r = 4.5 + Math.sin(t * 0.53 + this.seed * 2) * 2.5;
    _v.set(p.x + Math.sin(a) * r, p.y - HOVER + 0.2, p.z + Math.cos(a) * r);
    this.lightTarget.lerp(_v, 1 - Math.exp(-3 * dt));
  }

  private pose(dt: number): void {
    const B = this.B, p = this.body.position;
    const ry = this.yaw + Math.PI;
    this.fan += this.fanSpeed * dt;
    B.fan_l.rotation.y = this.fan; B.fan_r.rotation.y = -this.fan * 1.03;
    const dead = this.alive ? 0 : 1;
    B.body.quaternion.setFromEuler(_e.set(this.tilt.x + this.wob.x * 0.6 + dead * Math.sin(this.spin) * 0.5, 0, this.bank.x + this.wob.x + dead * this.spin * 0.6, 'YXZ'));
    B.nac_l.rotation.x = this.tilt.x * 1.4 + this.bank.x * 0.5; B.nac_r.rotation.x = this.tilt.x * 1.4 - this.bank.x * 0.5;
    B.tail.rotation.x = -this.tilt.x * 0.8;
    B.clamp_l.rotation.z = -(1 - this.clamp) * 1.75; B.clamp_r.rotation.z = (1 - this.clamp) * 1.75;
    // turret aims along the searchlight
    const dx = this.lightTarget.x - p.x, dy = this.lightTarget.y - (p.y + SN.gimbalY - 0.045), dz = this.lightTarget.z - p.z;
    const c = Math.cos(ry), s = Math.sin(ry);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const wy = Math.atan2(lx, lz), wp = Math.atan2(-dy, Math.hypot(lx, lz));
    const k = dt > 0 ? 1 - Math.exp(-14 * dt) : 1;
    this.turYaw += angleDiff(wy, this.turYaw) * k;
    this.turPitch += (THREE.MathUtils.clamp(wp, -0.5, 1.45) - this.turPitch) * k;
    B.gimbal.rotation.y = this.turYaw;
    B.turret.rotation.x = this.turPitch - this.tilt.x;
    this.object.position.copy(p);
    this.object.rotation.y = ry;
    this.object.updateMatrixWorld(true);
    if (this.spot) {
      _v.copy(SN.lamp).applyMatrix4(B.turret.matrixWorld);
      this.spot.position.copy(_v);
      this.spot.target.copy(this.lightTarget);
    }
  }

  /** Aiming beam during the charge; glow on the emitter. */
  private aimVisuals(dt: number): void {
    const w = this.world;
    if (this.mode === 'charge') {
      const k = this.modeTime / CHARGE;
      this.B.gunglow.scale.setScalar(0.4 + k * 1.6 + Math.sin(this.modeTime * 60) * 0.15);
      _muz.copy(SN.muzzle).applyMatrix4(this.B.turret.matrixWorld);
      w.playerEyeAgo(AIM_LAG * 0.5, _aim); _aim.y -= 0.4;
      _dir.copy(_aim).sub(_muz);
      const len = _dir.length();
      _dir.multiplyScalar(1 / (len || 1));
      const hit = k > 0.05 ? w.ctx.physics.raycast(_muz, _dir, 40) : null;
      const L = hit ? Math.min(hit.distance, len + 6) : len + 6;
      this.placeBeam(this.beam, _muz, _dir, L, 0.0035 + 0.004 * k * (0.7 + 0.3 * Math.sin(this.modeTime * 50)));
      this.beam.visible = true;
    } else {
      this.beam.visible = false;
      if (this.mode !== 'burst') this.B.gunglow.scale.setScalar(1e-4);
    }
    void dt;
  }

  private placeBeam(m: THREE.Mesh, from: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number): void {
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(UP, dir);
    m.scale.set(radius, len, radius);
  }

  /** One laser pulse: aims at where the player was a moment ago, so strafing dodges it. */
  private fire(): void {
    const w = this.world, phys = w.ctx.physics, fx = w.ctx.fx;
    _muz.copy(SN.muzzle).applyMatrix4(this.B.turret.matrixWorld);
    w.playerEyeAgo(AIM_LAG, _aim); _aim.y -= 0.4;
    _dir.copy(_aim).sub(_muz).normalize();
    const hit = phys.raycast(_muz, _dir, 60);
    let len = hit ? hit.distance : 60;
    // closest approach of the ray to the player's body axis (feet+0.25 … feet+1.6)
    let hitPlayer = false;
    if (w.playerAlive) {
      const pp = w.playerPos;
      for (let i = 0; i < 4 && !hitPlayer; i++) {
        _v.set(pp.x, pp.y + 0.3 + i * 0.42, pp.z).sub(_muz);
        const tca = _v.dot(_dir);
        if (tca <= 0 || tca > len) continue;
        const d2 = _v.lengthSq() - tca * tca;
        if (d2 < 0.36 * 0.36) { hitPlayer = true; len = tca; }
      }
    }
    this.emitAttack('ranged');
    this.placeBeam(this.bolt, _muz, _dir, len, 0.012);
    this.bolt.visible = true; this.boltLife = 0.07;
    this.B.gunglow.scale.setScalar(2.4);
    this.wob.v += 0.7;
    this.body.velocity.addScaledVector(_dir, -0.5);
    try {
      fx.flash(_muz, 0xff3018, 5, 0.07, 5);
      if (hitPlayer) w.ctx.player.damage(DMG, this.body.position);
      else if (hit) {
        fx.sparks(hit.point, hit.normal, 9, 4);
        fx.decal('scorch', hit.point, hit.normal, 0.22);
        fx.flash(hit.point, 0xff5020, 3, 0.08, 3);
      }
    } catch { if (hitPlayer) { try { w.ctx.player.damage(DMG, this.body.position); } catch { /* */ } } }
  }

  // ───────────────────────────────────────────────────────── puppet (EnemyManager.actor)

  private tickPuppet(dt: number): void {
    const w = this.world, p = this.body.position, v = this.body.velocity, t = w.time;
    let ax = 0, ay = 0, az = 0;
    if (this.pDock) {
      // docked under the ceiling: clamps closed, fans spun down
      if (!this.pMoving) {
        this.clamp = damp(this.clamp, Math.abs(p.y - this.dockY) < 0.06 ? 1 : 0, 5, dt);
        ay += (this.dockY - p.y) * 6 - v.y * 4; ax -= v.x * 3; az -= v.z * 3;
      }
      this.fanSpeed = damp(this.fanSpeed, this.clamp > 0.9 ? 0 : 60, 2, dt);
    } else {
      this.clamp = damp(this.clamp, 0, 6, dt);
      this.fanSpeed = damp(this.fanSpeed, this.pMoving ? 80 : 60, 3, dt);
    }
    if (this.pMoving) {
      _v.copy(this.pTarget).sub(p);
      const d = _v.length();
      this.pStuck += dt;
      if (this.pStuck > 1.5) { const prog = this.pLastD - d; this.pStuck = 0; this.pLastD = d; if (prog < 0.1) this.arrive(); }
      if (d < 0.2) this.arrive();
      else if (this.pMoving) {
        const want = Math.min(this.pSpeed, d * 1.4 + 0.1);
        ax += ((_v.x / d) * want - v.x) * 2.6; ay += ((_v.y / d) * want - v.y) * 2.6; az += ((_v.z / d) * want - v.z) * 2.6;
      }
      this.hoverY = p.y;
    } else if (!this.pDock) {
      ay += (this.hoverY - p.y) * 5 - v.y * 3.5; ax -= v.x * 2; az -= v.z * 2;
    }
    if (this.clamp < 0.5) { ay += Math.sin(t * 1.9 + this.seed) * 0.9; ax += noise1(t * 0.6, this.seed) * 0.6; az += noise1(t * 0.6, this.seed + 4) * 0.6; }
    v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
    p.addScaledVector(v, dt);
    _v.copy(p);
    if (w.ctx.physics.resolveSphere(_v, RADIUS)) p.copy(_v);
    const ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    const lax = ax * c - az * s, laz = ax * s + az * c;
    spring(this.bank, THREE.MathUtils.clamp(-lax * 0.035, -0.32, 0.32), 1.8, 0.6, dt);
    spring(this.tilt, THREE.MathUtils.clamp(laz * 0.035, -0.28, 0.28), 1.8, 0.6, dt);
    spring(this.wob, 0, 3, 0.3, dt);
    if (this.lookPt) {
      this.faceToward(this.lookPt.x, this.lookPt.z, 2.5 * dt);
      this.lightTarget.lerp(this.lookPt, 1 - Math.exp(-6 * dt));
    } else {
      if (Math.hypot(v.x, v.z) > 0.6) this.faceToward(p.x + v.x, p.z + v.z, 2.5 * dt);
      _v.set(p.x + Math.sin(ry) * 3, p.y - 1.6, p.z + Math.cos(ry) * 3);
      this.lightTarget.lerp(_v, 1 - Math.exp(-2 * dt));
    }
    this.pose(dt);
  }

  private arrive(): void {
    this.pMoving = false;
    const d = this.pDone; this.pDone = null;
    if (d) d();
  }

  override puppetMove(point: THREE.Vector3, speed: number | undefined, done: () => void): void {
    if (this.pDone) this.arrive();
    this.pTarget.copy(point);
    this.pSpeed = THREE.MathUtils.clamp(speed ?? 2.5, 0.3, 6);
    this.pMoving = true; this.pDone = done; this.pStuck = 0; this.pLastD = 1e9;
    this.pDock = false;
  }

  override puppetPose(pose: string): void {
    if (this.pMoving) this.arrive();
    if (pose === 'ceiling') { this.pDock = true; this.findDock(); }
    else if (this.pDock) {
      this.pDock = false;
      const g = this.groundBelow();
      this.hoverY = Math.max(this.body.position.y - 0.9, (g ?? this.body.position.y - HOVER) + 1.2);
    }
  }

  override puppetLook(point: THREE.Vector3 | null): void {
    if (point) { this.lookBuf.copy(point); this.lookPt = this.lookBuf; } else this.lookPt = null;
  }

  override puppetEyes(on: boolean): void { this.setLit(on); }

  override puppetStop(): void { if (this.pDone) this.arrive(); this.pMoving = false; }

  // ───────────────────────────────────────────────────────── damage

  protected hitFx(b: HitBurst): void {
    const fx = this.world.ctx.fx, A = b.amount;
    fx.sparks(b.point, b.normal, THREE.MathUtils.clamp(Math.round(3 + A / 6 + (b.part === 'head' ? 2 : 0)), 4, 16), 3.5 + Math.min(2.5, A / 30));
    if (A >= 40) fx.smoke(b.point, { count: 2, size: 0.3, color: 0x1c1c1e, rise: 0.4, life: 1.0 });
  }

  applyDamage(vol: HitVolume, amount: number, point: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.alive) return;
    const w = this.world;
    const mult = vol.part === 'head' ? 1.5 : vol.part === 'limb' ? 0.8 : 1;
    const dmg = amount * mult;
    this.health -= dmg;
    w.ctx.events.emit('enemy:damaged', { id: this.id, type: this.type, point, direction: dir, amount: dmg });
    this.queueHit(vol, amount, point, dir);
    this.body.velocity.addScaledVector(dir, Math.min(3, amount * 0.09));
    this.wob.v += (w.rand() - 0.5) * Math.min(30, amount) * 0.25;
    if (this.health <= 0) { this.die(dir); return; }
    if (this.mode === 'dormant') { this.beginBoot(true); return; }
    if (this.mode === 'idle') this.enterAlert();
    // a solid hit breaks the charge
    if (amount >= 18 && (this.mode === 'charge' || this.mode === 'hunt')) { this.cool = Math.max(this.cool, 0.8); this.beam.visible = false; this.setMode('stagger'); }
  }

  private die(dir: THREE.Vector3): void {
    if (!this.alive) return;
    const w = this.world;
    this.alive = false; this.health = 0; this.awake = true;
    this.beam.visible = false; this.bolt.visible = false;
    this.body.velocity.addScaledVector(dir, 2.5);
    this.setMode('dying');
    this.setLit(false);
    this.B.led.scale.setScalar(1);
    this.rig.setKeysVisible(GLOW_KEYS, true);
    try { w.ctx.fx.sparks(this.body.position, UP, 14, 4); w.ctx.fx.flash(this.body.position, 0xffa040, 5, 0.1, 5); } catch { /* */ }
    this.diedAt = w.time;
    w.onDeath(this);
  }

  private crash(): void {
    const w = this.world, p = this.body.position;
    try {
      w.ctx.fx.explosion(p, 0.9);
      w.ctx.fx.decal('scorch', _v.set(p.x, p.y - RADIUS + 0.02, p.z), UP, 1.1);
    } catch { /* */ }
    // a nacelle and the turret are thrown clear
    for (const name of w.rand() < 0.5 ? ['nac_l', 'turret'] : ['nac_r', 'turret']) {
      const bone = this.B[name], mesh = this.tpl.rig.debrisMesh(name);
      if (!mesh) continue;
      bone.updateWorldMatrix(true, false);
      bone.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
      try { w.ctx.fx.debris(mesh.position, _v3.set((w.rand() - 0.5) * 6, 3 + w.rand() * 3, (w.rand() - 0.5) * 6), [mesh], 14); } catch { /* */ }
      bone.scale.setScalar(1e-4);
    }
    this.stopLoop(0.1);
    if (this.spot) { this.spot.remove(); this.spot = null; }
    this.B.led.scale.setScalar(1e-4);
    this.rig.setKeysVisible(GLOW_KEYS, false);
    // wreck settles on its belly, canted
    const g = this.groundBelow();
    if (g !== null && p.y - g < 1.2) {
      p.y = g + 0.17;
      // the wreck is a low obstacle (registered by the manager unless it lies in a doorway)
      this.wreckBox = new THREE.Box3(new THREE.Vector3(p.x - 0.3, g, p.z - 0.3), new THREE.Vector3(p.x + 0.3, g + 0.36, p.z + 0.3));
    }
    this.body.velocity.set(0, 0, 0);
    this.B.body.quaternion.setFromEuler(_e.set(0.25, 0, 0.5, 'YXZ'));
    this.object.position.copy(p);
    this.object.updateMatrixWorld(true);
    this.mode = 'dead';
    this.settled = true;
  }

  override dispose(): void {
    if (this.spot) { this.spot.remove(); this.spot = null; }
    this.beam.removeFromParent(); this.bolt.removeFromParent();
    this.rig.skeleton.dispose();
    super.dispose();
  }
}
