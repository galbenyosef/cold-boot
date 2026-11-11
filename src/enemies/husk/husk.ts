/**
 * HUSK runtime: procedural locomotion (foot planting + leg IK), head tracking with twitch/overshoot,
 * dormant poses and wake-up sequences, melee, stagger, part destruction, collapse.
 */
import * as THREE from 'three';
import type { LightHandle } from '../../core/types';
import { EnemyBase, type EnemyWorld, type HitBurst } from '../ai';
import { hv, type HitVolume } from '../shared/hit';
import { angleDiff, damp, noise1, smooth, solveLimb, spring, type Spring } from '../shared/ik';
import { Piston } from '../shared/piston';
import type { Rig } from '../shared/rig';
import { HUSK_DIM as K, type HuskTemplate } from './model';
import { applySpec, HUSK_POSES } from './poses';

type Mode = 'dormant' | 'wake' | 'idle' | 'react' | 'chase' | 'windup' | 'strike' | 'recover' | 'stagger' | 'flail'
  | 'topple' | 'crawl' | 'cwindup' | 'cstrike' | 'crecover' | 'writhe' | 'dying' | 'dead';

/** One hand of the legless crawl: planted in world space, swung forward when it falls behind. */
interface Hand {
  pos: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3;
  t: number; dur: number;
}

interface Foot {
  side: number;
  pos: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3;
  /** Swing progress; >= 1 means planted. */
  t: number; dur: number; lift: number;
  /** World yaw (rig ry) the foot was planted with. */
  yaw: number;
  rig: THREE.Vector3;
}

const WALK = 1.3, RUN = 4.0, MELEE = 18, HP = 90;
/** Raw damage a leg takes before it snaps at the knee; crawler grab damage. */
const LEG_BREAK = 42, CRAWL_MELEE = 9, CRAWL_SPEED = 0.8;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _pole = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _upQ = new THREE.Quaternion();
const _e = new THREE.Euler();
const _imp = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _dn = new THREE.Vector3(), _pp = new THREE.Vector3(), _ud = new THREE.Vector3();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _fw = new THREE.Vector3(), _lf = new THREE.Vector3();
const _mb = new THREE.Matrix4();
const EYE_KEYS = ['glow'];
const keyCache = new WeakMap<HuskTemplate, Map<string, Float32Array>>();

export class Husk extends EnemyBase {
  readonly type = 'husk' as const;
  private rig: Rig;
  private B: Record<string, THREE.Bone>;
  private pistons: Piston[] = [];
  private keys: Map<string, Float32Array>;
  private snap: Float32Array;
  private blendT = 1; private blendDur = 0;
  mode: Mode = 'idle';
  private modeTime = 0;
  private phase = 0;
  private pose: string;
  private wakeRate = 1;

  private feet: Foot[];
  private runBlend = 0;
  private hipsY = 0.965;
  private running = false;
  private lurch = 0;       // freeze before the sprint
  private hitchTimer: number; private hitch = 0;
  private rage = 0;
  private limp: number;    // side with the bad leg
  private seed: number;

  private headYaw: Spring = { x: 0, v: 0 }; private headPitch: Spring = { x: 0, v: 0 }; private headRoll: Spring = { x: 0, v: 0 };
  private lookW = 0;
  private twitchTimer: number;
  private flP: Spring = { x: 0, v: 0 }; private flR: Spring = { x: 0, v: 0 }; private flY: Spring = { x: 0, v: 0 };
  private reach = 0;
  private atkWind = 0; private atkStrike = 0;
  private atkArm = -1;     // -1 right (tool), 1 left, 0 none
  private struck = false;
  private tool: number;
  private bladeSpeed = 0; private jaw = 0.25; private needle = 0;

  private eyeOn = false; private eyeFlicker = 0;
  private light: LightHandle | null = null;
  private armGone = [false, false]; // [left, right]
  private headGone = false;
  private regionDmg: Record<string, number> = {};
  private recentDmg = 0; private recentT = 0;
  private plates: { bone: string; region: string; gone: boolean }[];
  private dormantTwitch: number; private twitching = 0;
  private stumpSpark = 0; private stumpBone: THREE.Bone | null = null;
  private deadKey = 'deadFront';
  private stepPhaseEmit = 0;
  private thrash = 0;
  private wander = 0;
  // legless crawl
  private legGone = [false, false];
  private crawler = false;
  private hands: Hand[];
  private crawlArm = -1;    // attacking arm while prone (1 left, -1 right)
  private crawlAtk = 0;     // 0 rest → 1 raised → 2 slammed
  private crawlBob = 0;
  private flat = 0;

  constructor(world: EnemyWorld, private tpl: HuskTemplate, group: string, position: THREE.Vector3, yaw: number, dormant: boolean, pose?: string) {
    super(world, group, position, yaw, 0.35, 1.8);
    this.health = HP;
    this.eyeHeight = 1.6;
    this.boundCenterY = 0.9; this.boundRadius = 1.35;
    this.seed = this.id * 7.31;
    this.limp = this.id % 2 === 0 ? -1 : 1;
    this.tool = this.id % 3;
    this.hitchTimer = 1.5 + world.rand() * 3;
    this.twitchTimer = 1 + world.rand() * 2;
    this.dormantTwitch = 4 + world.rand() * 14;
    const sign = tpl.signs[this.id % tpl.signs.length];
    this.rig = tpl.rig.instantiate({ sign });
    this.B = this.rig.byName;
    this.lodRig = this.rig;
    this.object.add(this.rig.root);
    for (const p of tpl.pistons) this.pistons.push(new Piston(this.rig, p.cyl, p.rod, p.a, p.b));
    this.plates = tpl.plates.map((p) => ({ ...p, gone: false }));
    this.snap = this.rig.newPose();

    // key poses are computed once per template using the first instance's rig
    let keys = keyCache.get(tpl);
    if (!keys) {
      keys = new Map();
      for (const name of Object.keys(HUSK_POSES)) {
        this.rig.reset();
        applySpec(this.rig, HUSK_POSES[name]);
        keys.set(name, this.rig.capture(this.rig.newPose()));
      }
      this.rig.reset();
      keyCache.set(tpl, keys);
    }
    this.keys = keys;

    // tools: keep one, collapse the other two
    const tools = ['tool_clamp', 'tool_saw', 'tool_inj'];
    tools.forEach((t, i) => { if (i !== this.tool) this.B[t].scale.setScalar(1e-4); });

    const B = this.B;
    this.volumes = [
      hv(B.head, [0, 0.05, 0.005], [0, 0.14, 0], 0.105, 'head', 'head'),
      hv(B.spine2, [0, 0.07, 0], [0, 0.21, 0], 0.17, 'torso', 'torso'),
      hv(B.spine1, [0, 0, 0], [0, 0.1, 0], 0.125, 'torso', 'torso'),
      hv(B.hips, [0, -0.06, 0], [0, 0.02, 0], 0.15, 'torso', 'torso'),
      hv(B.uarm_l, [0, 0, 0], [0, -0.29, 0], 0.068, 'limb', 'arm_l'),
      hv(B.larm_l, [0, 0, 0], [0, -0.42, 0], 0.06, 'limb', 'arm_l'),
      hv(B.uarm_r, [0, 0, 0], [0, -0.29, 0], 0.068, 'limb', 'arm_r'),
      hv(B.larm_r, [0, 0, 0], [0, -0.42, 0], 0.065, 'limb', 'arm_r'),
      hv(B.thigh_l, [0, 0, 0], [0, -0.43, 0], 0.088, 'limb', 'leg_l'),
      hv(B.shin_l, [0, 0, 0], [0, -0.47, 0], 0.072, 'limb', 'leg_l'),
      hv(B.thigh_r, [0, 0, 0], [0, -0.43, 0], 0.088, 'limb', 'leg_r'),
      hv(B.shin_r, [0, 0, 0], [0, -0.47, 0], 0.072, 'limb', 'leg_r'),
    ];

    const mk = (side: number): Foot => ({
      side, pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 0.4, lift: 0.06, yaw: 0, rig: new THREE.Vector3(),
    });
    this.feet = [mk(1), mk(-1)];
    this.resetFeet();
    const mh = (): Hand => ({ pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 0.32 });
    this.hands = [mh(), mh()];

    this.pose = dormant ? (pose === 'rack' || pose === 'slumped' || pose === 'standing' ? pose : 'standing') : '';
    if (dormant) {
      if (this.pose === 'slumped') this.snapToWall();
      this.mode = 'dormant'; this.state = 'dormant';
      this.rig.apply(this.keys.get(this.poseKey())!);
      this.setEye(false);
    } else {
      this.mode = 'idle'; this.state = 'idle';
      this.awake = true;
      this.setEye(true);
      this.rig.apply(this.keys.get('stand')!);
      this.startLoop('husk_loop', 0.6);
    }
    this.finishPose();
    this.emit('enemy:spawned');
  }

  /** Slumped machines lean on whatever is behind them: slide back until the pelvis is ~0.36 m off the wall. */
  private snapToWall(): void {
    const p = this.body.position, ry = this.yaw + Math.PI;
    _v.set(p.x, p.y + 0.45, p.z);
    _v2.set(-Math.sin(ry), 0, -Math.cos(ry));
    const hit = this.world.ctx.physics.raycast(_v, _v2, 1.6);
    if (hit) {
      const shift = hit.distance - 0.36;
      p.x += _v2.x * shift; p.z += _v2.z * shift;
      this.object.position.copy(p);
    }
  }

  private poseKey(): string { return this.pose === 'rack' ? 'hang' : this.pose === 'slumped' ? 'slumped' : 'bent'; }

  private setEye(on: boolean): void {
    this.eyeOn = on;
    this.B.eye.scale.setScalar(on ? 1 : 1e-4);
    this.B.led.scale.setScalar(on ? 1 : 1e-4);
    this.rig.setKeysVisible(EYE_KEYS, on);
  }

  private setMode(m: Mode): void {
    this.mode = m; this.modeTime = 0; this.phase = 0;
    this.setState(m === 'dormant' ? 'dormant' : m === 'idle' ? 'idle' : m === 'wake' || m === 'react' ? 'alert' : m === 'chase' ? 'chase'
      : m === 'windup' || m === 'strike' || m === 'recover' || m === 'cwindup' || m === 'cstrike' || m === 'crecover' ? 'attack'
      : m === 'crawl' || m === 'writhe' ? 'chase'
      : m === 'stagger' || m === 'flail' || m === 'topple' ? 'stagger' : 'dead');
  }

  /** Start blending from the current bone state to whatever the following frames produce. */
  private startBlend(seconds: number): void {
    this.rig.capture(this.snap);
    this.blendT = 0; this.blendDur = seconds;
  }

  private resetFeet(): void {
    const p = this.body.position, ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    for (const f of this.feet) {
      f.pos.set(p.x + f.side * 0.105 * c, p.y, p.z - f.side * 0.105 * s);
      f.t = 1; f.yaw = ry;
    }
  }

  // ───────────────────────────────────────────────────────── lifecycle

  override wake(delay = 0): void {
    if (!this.alive || this.awake || this.wakeDelay >= 0) return;
    this.wakeDelay = Math.max(0, delay);
  }

  private beginWake(rate: number): void {
    this.awake = true;
    this.wakeDelay = -1;
    this.wakeRate = rate;
    this.setMode('wake');
    this.eyeFlicker = 0.45;
    this.setEye(true);
    this.rage = 4;
    this.startLoop('husk_loop', 0.8);
    this.world.ctx.events.emit('enemy:woke', { id: this.id, type: this.type, position: this.body.position });
    if (!this.light) {
      try {
        this.light = this.world.ctx.render.lights.add({ type: 'point', position: new THREE.Vector3().copy(this.body.position).setY(this.body.position.y + 1.6), color: 0xff2412, intensity: 0.5, distance: 2.6, priority: 0.2 });
      } catch { this.light = null; }
    }
  }

  protected enterAlert(): void {
    if (this.mode !== 'idle') return;
    this.setMode('react');
    this.emit('enemy:alerted');
    this.headYaw.v += (this.world.rand() - 0.5) * 20;
  }

  private goChase(): void {
    if (this.crawler) { this.setMode(this.armGone[0] && this.armGone[1] ? 'writhe' : 'crawl'); return; }
    if (this.headGone) { this.setMode('flail'); return; }
    this.setMode('chase');
  }

  // ───────────────────────────────────────────────────────── update

  update(dt: number): void {
    this.stateTime += dt; this.modeTime += dt;
    if (this.mode === 'dormant') {
      if (this.wakeDelay >= 0) {
        this.wakeDelay -= dt;
        if (this.wakeDelay <= 0) this.beginWake(1);
        return;
      }
      this.dormantTick(dt);
      return;
    }
    if (this.mode === 'dead') return;
    const w = this.world;
    if (this.rage > 0) this.rage -= dt;
    if (this.recentT > 0) { this.recentT -= dt; if (this.recentT <= 0) this.recentDmg = 0; }
    this.perceive(dt);

    switch (this.mode) {
      case 'wake': this.tickWake(dt); break;
      case 'idle': this.tickIdle(dt); break;
      case 'react':
        this.lookW = 1;
        this.moveGround(dt, 0, 0, 0, 10);
        this.locomote(dt);
        if (this.modeTime > 0.25) this.faceToward(w.playerPos.x, w.playerPos.z, 3 * dt);
        if (this.modeTime > 0.55) this.goChase();
        break;
      case 'chase': this.tickChase(dt); break;
      case 'windup': case 'strike': case 'recover': this.tickAttack(dt); break;
      case 'stagger':
        this.moveGround(dt, 0, 0, 0, 3);
        this.locomote(dt);
        if (this.modeTime > 0.7) this.goChase();
        break;
      case 'flail': this.tickFlail(dt); break;
      case 'topple': case 'crawl': case 'cwindup': case 'cstrike': case 'crecover': case 'writhe': this.tickCrawl(dt); break;
      case 'dying': this.tickDying(dt); break;
    }
    this.finishPose(dt);
    this.tickLoop(dt);
  }

  private dormantTick(dt: number): void {
    // inert prop; very rarely a servo twitches
    this.dormantTwitch -= dt;
    if (this.twitching > 0) {
      this.twitching -= dt;
      const k = this.twitching > 0 ? Math.sin(this.twitching * 60) * 0.035 : 0;
      this.rig.apply(this.keys.get(this.poseKey())!);
      this.B.head.quaternion.multiply(_q.setFromEuler(_e.set(k * 0.6, k, 0)));
      this.B.fing_l.quaternion.multiply(_q.setFromEuler(_e.set(-Math.abs(k) * 4, 0, 0)));
      this.B.hand_r.quaternion.multiply(_q.setFromEuler(_e.set(0, k * 2, 0)));
      this.finishPose();
    } else if (this.dormantTwitch <= 0) {
      this.dormantTwitch = 7 + this.world.rand() * 16;
      this.twitching = 0.18;
    }
  }

  private tickIdle(dt: number): void {
    this.lookW = damp(this.lookW, 0, 3, dt);
    this.moveGround(dt, 0, 0, 0, 10);
    this.locomote(dt);
    if (this.noticesPlayer(14)) this.enterAlert();
  }

  private tickWake(dt: number): void {
    const t = this.modeTime * this.wakeRate, w = this.world, keys = this.keys;
    const face = () => this.faceToward(w.playerPos.x, w.playerPos.z, 2.2 * dt);
    if (this.pose === 'slumped') {
      // eyes ignite → head lifts → pushes up onto a knee → stands
      if (t < 0.75) {
        this.rig.apply(keys.get('slumped')!);
        this.lookW = smooth((t - 0.22) / 0.3);
      } else if (t < 1.55) {
        if (this.phase === 0) { this.phase = 1; this.startBlend(0.75 / this.wakeRate); }
        this.rig.apply(keys.get('kneel')!);
        this.lookW = 1;
      } else {
        if (this.phase === 1) { this.phase = 2; this.startBlend(0.85 / this.wakeRate); this.resetFeet(); this.emit('enemy:step'); }
        face();
        this.moveGround(dt, 0, 0, 0, 10);
        this.locomote(dt);
        if (t > 2.45) this.finishWake();
      }
    } else if (this.pose === 'rack') {
      // thrash on the hook → drop → land crouched → rise
      if (this.phase === 0) {
        this.rig.apply(keys.get('hang')!);
        this.lookW = smooth((t - 0.15) / 0.25);
        this.thrash = smooth((t - 0.3) / 0.5);
        if (t > 1.35) { this.phase = 1; this.startBlend(0.2); this.body.velocity.set(0, 0, 0); this.body.onGround = false; this.modeTime = 0; }
      } else if (this.phase === 1) {
        this.thrash = damp(this.thrash, 0.35, 6, dt);
        this.rig.apply(keys.get('fall')!);
        w.ctx.physics.moveBody(this.body, dt);
        if (this.body.onGround || this.modeTime > 3) {
          this.phase = 2; this.modeTime = 0; this.startBlend(0.09); this.thrash = 0;
          this.emit('enemy:step'); this.emit('enemy:step');
          try { w.ctx.fx.smoke(this.body.position, { count: 5, size: 0.5, color: 0x39393a, rise: 0.2, life: 1.2 }); } catch { /* fx optional */ }
        }
      } else if (this.phase === 2) {
        this.rig.apply(keys.get('crouch')!);
        w.ctx.physics.moveBody(this.body, dt);
        if (this.modeTime > 0.4) { this.phase = 3; this.modeTime = 0; this.startBlend(0.75); this.resetFeet(); }
      } else {
        face();
        this.moveGround(dt, 0, 0, 0, 10);
        this.locomote(dt);
        if (this.modeTime > 0.8) this.finishWake();
      }
    } else {
      // 'standing' (bent over a task): head turns first, then the body unfolds
      if (t < 0.6) {
        this.rig.apply(keys.get('bent')!);
        this.lookW = smooth((t - 0.2) / 0.2);
      } else {
        if (this.phase === 0) { this.phase = 1; this.startBlend(0.7 / this.wakeRate); this.resetFeet(); }
        face();
        this.moveGround(dt, 0, 0, 0, 10);
        this.locomote(dt);
        if (t > 1.35) this.finishWake();
      }
    }
  }

  private finishWake(): void {
    this.pose = '';
    this.thrash = 0;
    this.emit('enemy:alerted');
    this.goChase();
  }

  private tickChase(dt: number): void {
    const w = this.world, p = this.body.position;
    if (!w.playerAlive) { this.lookW = damp(this.lookW, 0.3, 2, dt); this.moveGround(dt, 0, 0, 0, 6); this.locomote(dt); return; }
    this.lookW = 1;
    this.navigate(dt);
    const hd = Math.hypot(w.playerPos.x - p.x, w.playerPos.z - p.z);
    // walk → lurching run
    const wantRun = this.rage > 0 || this.health < HP * 0.6 || (this.dist < 7.5 && this.seesPlayer);
    if (wantRun && !this.running) { this.running = true; this.lurch = 0.24; this.headYaw.v += 14 * (w.rand() - 0.5); this.headRoll.v += 8; }
    else if (!wantRun && this.running && this.dist > 11) this.running = false;
    // stiff micro-freezes while walking
    if (!this.running) {
      this.hitchTimer -= dt;
      if (this.hitchTimer <= 0) { this.hitchTimer = 1.8 + w.rand() * 3.5; this.hitch = 0.1 + w.rand() * 0.16; this.headRoll.v += (w.rand() - 0.5) * 16; }
    }
    let speed = this.running ? RUN : WALK;
    if (this.lurch > 0) { this.lurch -= dt; speed = 0; }
    if (this.hitch > 0) { this.hitch -= dt; speed = 0; }
    const bias = this.watchdog(dt, speed > 0 && hd > 1.2, 5.5);
    let tx = this.waypoint.x, tz = this.waypoint.z;
    if (bias !== 0) { const dx = tx - p.x, dz = tz - p.z; tx += -dz * bias * 0.9; tz += dx * bias * 0.9; }
    const rem = this.faceToward(tx, tz, (this.running ? 5.5 : 3.2) * dt);
    const align = Math.max(0, Math.cos(rem));
    speed *= align * align;
    if (hd < 1.05) speed = 0;
    const ry = this.yaw + Math.PI;
    this.moveGround(dt, Math.sin(ry), Math.cos(ry), speed, this.running ? 9 : 6);
    this.reach = damp(this.reach, this.dist < 3.6 ? 1 : 0, 5, dt);
    this.locomote(dt);
    // attack
    if (hd < 1.55 && Math.abs(w.playerPos.y - p.y) < 1.4 && Math.abs(rem) < 0.6 && this.seesPlayer) {
      this.atkArm = !this.armGone[1] ? -1 : !this.armGone[0] ? 1 : 0;
      this.struck = false;
      this.setMode('windup');
      this.emitAttack('melee');
    }
  }

  private tickAttack(dt: number): void {
    const w = this.world, p = this.body.position;
    const ry = this.yaw + Math.PI;
    this.lookW = 1;
    if (this.mode === 'windup') {
      this.atkWind = smooth(this.modeTime / 0.38);
      this.atkStrike = 0;
      this.faceToward(w.playerPos.x, w.playerPos.z, 2.6 * dt);
      this.moveGround(dt, 0, 0, 0, 12);
      if (this.modeTime >= 0.5) { this.setMode('strike'); this.body.velocity.x += Math.sin(ry) * 3.2; this.body.velocity.z += Math.cos(ry) * 3.2; }
    } else if (this.mode === 'strike') {
      this.atkStrike = Math.min(1, this.modeTime / 0.11);
      this.moveGround(dt, 0, 0, 0, 5);
      if (!this.struck && this.modeTime >= 0.07) {
        this.struck = true;
        const dx = w.playerPos.x - p.x, dz = w.playerPos.z - p.z;
        const hd = Math.hypot(dx, dz);
        const ang = Math.abs(angleDiff(Math.atan2(-dx, -dz), this.yaw));
        if (w.playerAlive && hd < 1.95 && ang < 1.0 && Math.abs(w.playerPos.y - p.y) < 1.5) {
          w.ctx.player.damage(this.atkArm === 0 ? 10 : MELEE, p);
        }
      }
      if (this.modeTime >= 0.2) this.setMode('recover');
    } else {
      this.atkWind = 1 - smooth(this.modeTime / 0.5);
      this.atkStrike = 1 - smooth(this.modeTime / 0.45);
      this.moveGround(dt, 0, 0, 0, 8);
      if (this.modeTime >= 0.55) { this.atkWind = 0; this.atkStrike = 0; this.goChase(); }
    }
    this.locomote(dt);
  }

  private tickFlail(dt: number): void {
    // headless: blind stagger, then drop
    const w = this.world;
    this.lookW = 0;
    this.wander += (noise1(w.time * 1.7, this.seed) * 4) * dt;
    this.yaw += noise1(w.time * 2.3, this.seed + 5) * 3 * dt;
    const ry = this.yaw + Math.PI;
    this.moveGround(dt, Math.sin(ry), Math.cos(ry), 1.1 + noise1(w.time * 3, this.seed) * 0.9, 5);
    this.thrash = 0.8;
    this.locomote(dt);
    if (this.modeTime > 1.7) this.die(_v.set(Math.sin(ry), 0, Math.cos(ry)));
  }

  private tickDying(dt: number): void {
    const w = this.world;
    this.lookW = 0;
    if (this.modeTime < 1.6) {
      this.body.velocity.x *= Math.exp(-4 * dt); this.body.velocity.z *= Math.exp(-4 * dt);
      w.ctx.physics.moveBody(this.body, dt);
    }
    const t = this.modeTime;
    if (t < 0.32) {
      this.rig.apply(this.keys.get('buckle')!);
    } else {
      if (this.phase === 0) { this.phase = 1; this.startBlend(0.5); }
      this.rig.apply(this.keys.get(this.deadKey)!);
    }
    if (this.eyeOn && t > 0.25) {
      // sensor dies with a stutter
      const on = t < 0.9 && Math.sin(t * 70) > 0.2;
      this.B.eye.scale.setScalar(on ? 1 : 1e-4);
      this.B.led.scale.setScalar(on ? 1 : 1e-4);
      if (t >= 0.9) { this.eyeOn = false; if (this.light) { this.light.remove(); this.light = null; } }
    }
    if (t > 2.2 && this.body.onGround) {
      this.mode = 'dead';
      this.settled = true;
      this.setEye(false);
      this.finishPose();
      this.makeWreckBox();
    }
  }

  /** Low collision box hugging the torso of the wreck (hips → neck), registered later by the manager. */
  private makeWreckBox(): void {
    const B = this.B, p = this.body.position;
    _v.setFromMatrixPosition(B.hips.matrixWorld);
    _v2.setFromMatrixPosition(B.neck.matrixWorld);
    const box = new THREE.Box3();
    box.min.set(Math.min(_v.x, _v2.x) - 0.17, p.y, Math.min(_v.z, _v2.z) - 0.17);
    box.max.set(Math.max(_v.x, _v2.x) + 0.17, p.y + THREE.MathUtils.clamp(Math.max(_v.y, _v2.y) - p.y + 0.12, 0.36, 0.44), Math.max(_v.z, _v2.z) + 0.17);
    this.wreckBox = box;
  }

  // ───────────────────────────────────────────────────────── legless crawl

  private startCrawl(dir: THREE.Vector3): void {
    this.crawler = true;
    this.atkWind = 0; this.atkStrike = 0; this.reach = 0; this.thrash = 0; this.lurch = 0; this.hitch = 0;
    this.running = false;
    this.body.height = 0.8;
    this.body.velocity.x += dir.x * 1.2; this.body.velocity.z += dir.z * 1.2;
    this.startBlend(0.55);
    this.setMode('topple');
    this.crawlAtk = 0; this.crawlArm = -1;
    // hands start roughly under the shoulders once down
    const p = this.body.position, ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1, h = this.hands[i];
      h.pos.set(p.x + s * 0.15 + side * 0.22 * c, p.y, p.z + c * 0.15 - side * 0.22 * s);
      h.t = 1;
    }
  }

  private tickCrawl(dt: number): void {
    const w = this.world, p = this.body.position;
    const ry = this.yaw + Math.PI;
    const armsLeft = (this.armGone[0] ? 0 : 1) + (this.armGone[1] ? 0 : 1);
    this.lookW = this.headGone ? 0 : damp(this.lookW, 1, 3, dt);
    let speed = 0;
    let rem = 0;
    const hd = Math.hypot(w.playerPos.x - p.x, w.playerPos.z - p.z);
    switch (this.mode) {
      case 'topple':
        this.thrash = 0;
        if (this.modeTime > 0.75) {
          this.emit('enemy:step'); this.emit('enemy:step');
          try { w.ctx.fx.smoke(p, { count: 4, size: 0.45, color: 0x3a3a3b, rise: 0.15, life: 1.1 }); } catch { /* fx optional */ }
          this.goChase();
        }
        break;
      case 'crawl': {
        if (!w.playerAlive) break;
        this.navigate(dt, 0.2);
        const bias = this.watchdog(dt, hd > 1.0, 2.2);
        let tx = this.waypoint.x, tz = this.waypoint.z;
        if (bias !== 0) { const dx = tx - p.x, dz = tz - p.z; tx += -dz * bias * 0.9; tz += dx * bias * 0.9; }
        rem = this.faceToward(tx, tz, 1.5 * dt);
        const align = Math.max(0, Math.cos(rem));
        // the body surges while a planted hand pulls, stalls while both are travelling
        let pulling = 0;
        for (let i = 0; i < 2; i++) if (!this.armGone[i] && this.hands[i].t >= 1) pulling++;
        const surge = armsLeft === 2 ? (pulling === 1 ? 1.25 : 0.55) : (pulling === 1 ? 1.0 : 0.15);
        speed = CRAWL_SPEED * (armsLeft === 2 ? 1 : 0.6) * surge * align * align;
        if (hd < 0.95) speed = 0;
        if (hd < 1.4 && Math.abs(w.playerPos.y - p.y) < 1.2 && Math.abs(rem) < 0.7 && this.seesPlayer) {
          this.crawlArm = !this.armGone[1] ? -1 : 1;
          this.setMode('cwindup');
          this.emitAttack('melee');
        }
        break;
      }
      case 'cwindup':
        this.faceToward(w.playerPos.x, w.playerPos.z, 2 * dt);
        this.crawlAtk = smooth(this.modeTime / 0.4);
        if (this.modeTime >= 0.5) this.setMode('cstrike');
        break;
      case 'cstrike':
        this.crawlAtk = 1 + smooth(this.modeTime / 0.1);
        if (!this.struck && this.modeTime >= 0.07) {
          this.struck = true;
          const dx = w.playerPos.x - p.x, dz = w.playerPos.z - p.z;
          const ang = Math.abs(angleDiff(Math.atan2(-dx, -dz), this.yaw));
          if (w.playerAlive && Math.hypot(dx, dz) < 1.75 && ang < 1.1 && Math.abs(w.playerPos.y - p.y) < 1.0) w.ctx.player.damage(CRAWL_MELEE, p);
          // the hand stays where it slammed down
          const h = this.hands[this.crawlArm > 0 ? 0 : 1];
          h.t = 1; this.handHome(this.crawlArm, 0.5, h.pos);
        }
        if (this.modeTime >= 0.18) this.setMode('crecover');
        break;
      case 'crecover':
        this.crawlAtk = damp(this.crawlAtk, 0, 8, dt);
        if (this.modeTime >= 0.55) { this.crawlAtk = 0; this.struck = false; this.goChase(); }
        break;
      case 'writhe':
        // armless: thrashes in place (and a headless crawler dies off)
        this.thrash = 0.9;
        if (this.headGone && this.modeTime > 1.6) { this.die(_v.set(Math.sin(ry), 0, Math.cos(ry))); return; }
        break;
    }
    if (this.mode === 'cwindup') this.struck = false;
    this.moveGround(dt, Math.sin(ry), Math.cos(ry), speed, this.mode === 'topple' ? 2.5 : 5);
    this.crawlPose(dt);
  }

  /** World position a hand reaches for: in front of its shoulder on the floor (`ahead` metres). */
  private handHome(side: number, ahead: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.body.position, ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    // shoulders sit ~0.36 m in front of the capsule centre when prone
    const fz = 0.2 + ahead, lx = side * 0.24;
    out.set(p.x + s * fz + lx * c, p.y + 0.035, p.z + c * fz - lx * s);
    return out;
  }

  private crawlPose(dt: number): void {
    const B = this.B, w = this.world, p = this.body.position, t = w.time;
    const ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    _fw.set(s, 0, c); _lf.set(c, 0, -s);
    this.rig.apply(this.keys.get('crawl')!);
    // without arms to prop it up the chest sinks to the floor
    const armsLeft = (this.armGone[0] ? 0 : 1) + (this.armGone[1] ? 0 : 1);
    this.flat = damp(this.flat, armsLeft === 0 ? 1 : armsLeft === 1 ? 0.3 : 0, 4, dt);
    if (this.flat > 0.001) {
      B.hips.position.y -= 0.1 * this.flat;
      B.hips.quaternion.multiply(_q.setFromEuler(_e.set(0.32 * this.flat, 0, 0)));
      B.spine2.quaternion.multiply(_q.setFromEuler(_e.set(0.15 * this.flat, 0, 0)));
    }
    const v = this.body.velocity, speed = Math.hypot(v.x, v.z);
    // ── hands: step when the planted hand trails too far behind its shoulder
    const swingDur = this.armGone[0] || this.armGone[1] ? 0.42 : 0.34;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1, h = this.hands[i], o = this.hands[1 - i];
      if (this.armGone[i]) continue;
      this.handHome(side, 0.38, _v3);
      if (h.t >= 1) {
        const behind = (_v3.x - h.pos.x) * _fw.x + (_v3.z - h.pos.z) * _fw.z;
        const lat = Math.abs((h.pos.x - _v3.x) * _lf.x + (h.pos.z - _v3.z) * _lf.z);
        const otherOk = this.armGone[1 - i] || o.t >= 1;
        if (otherOk && (behind > 0.3 || lat > 0.3 || (speed < 0.05 && Math.hypot(_v3.x - h.pos.x, _v3.z - h.pos.z) > 0.3)) && this.mode !== 'topple') {
          h.t = 0; h.dur = swingDur; h.from.copy(h.pos);
        }
      }
      if (h.t < 1) {
        h.t += dt / h.dur;
        h.to.copy(_v3).addScaledVector(_fw, 0.1);
        const g = this.groundAt(h.to.x, p.y + 0.5, h.to.z, 1.2);
        h.to.y = (g !== null ? g : p.y) + 0.035;
        if (h.t >= 1) {
          h.t = 1; h.pos.copy(h.to);
          this.crawlBob -= 0.04;
          this.emit('enemy:step');
        } else {
          const k = smooth(h.t);
          h.pos.lerpVectors(h.from, h.to, k);
          h.pos.y += Math.sin(Math.PI * h.t) * 0.16;
        }
      }
    }
    // ── torso: lunges forward on each pull, rolls toward the planted hand, heaves
    this.crawlBob = damp(this.crawlBob, 0, 6, dt);
    const swL = this.hands[0].t < 1 ? Math.sin(Math.PI * this.hands[0].t) : 0;
    const swR = this.hands[1].t < 1 ? Math.sin(Math.PI * this.hands[1].t) : 0;
    const heave = Math.sin(t * 2.1 + this.seed) * 0.012;
    const atk = Math.min(1, this.crawlAtk), slam = Math.max(0, this.crawlAtk - 1);
    B.hips.position.y += this.crawlBob + heave + atk * 0.06 - slam * 0.08;
    B.hips.quaternion.multiply(_q.setFromEuler(_e.set(-atk * 0.22 + slam * 0.3, (swR - swL) * 0.12, (swL - swR) * 0.12)));
    B.spine2.quaternion.multiply(_q.setFromEuler(_e.set(0, (swR - swL) * 0.15 + (this.crawlArm > 0 ? 1 : -1) * (atk * 0.35 - slam * 0.5), 0)));
    // the legs drag; the broken one twitches
    for (let i = 0; i < 2; i++) {
      const sfx = i === 0 ? 'l' : 'r';
      const j = this.legGone[i] ? noise1(t * 7 + i * 3, this.seed + 90) * 0.25 : noise1(t * 1.3 + i * 3, this.seed + 91) * 0.08;
      B['thigh_' + sfx].quaternion.multiply(_q.setFromEuler(_e.set(j + (i === 0 ? swR : swL) * 0.12, 0, 0)));
    }
    if (this.thrash > 0) {
      const a = this.thrash;
      for (let i = 0; i < 2; i++) {
        const sfx = i === 0 ? 'l' : 'r';
        B['thigh_' + sfx].quaternion.multiply(_q.setFromEuler(_e.set(noise1(t * 6.6 + i, this.seed + 75) * 0.6 * a, 0, noise1(t * 4.1 + i, this.seed + 85) * 0.3 * a)));
        B['uarm_' + sfx].quaternion.multiply(_q.setFromEuler(_e.set(noise1(t * 7.1 + i, this.seed + 30) * 0.9 * a, 0, noise1(t * 5.3 + i, this.seed + 40) * 0.6 * a)));
      }
      B.hips.quaternion.multiply(_q.setFromEuler(_e.set(0, 0, noise1(t * 3.3, this.seed + 95) * 0.3 * a)));
    }
    // ── arm IK in world space (needs the chest's world transform first)
    this.object.position.copy(p);
    this.object.rotation.y = ry;
    this.object.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      if (this.armGone[i]) continue;
      const side = i === 0 ? 1 : -1, sfx = i === 0 ? 'l' : 'r', h = this.hands[i];
      const uarm = B['uarm_' + sfx];
      _S.setFromMatrixPosition(uarm.matrixWorld);
      // wrist target: the planted / travelling hand, or the strike arc
      _T.copy(h.pos).addScaledVector(_fw, -0.06).setY(h.pos.y + 0.075);
      let pole = 1;
      if (this.crawlArm === side && this.crawlAtk > 0.001) {
        // raise high and back, then hammer down in front
        _v.copy(_S).addScaledVector(Y, 0.42).addScaledVector(_fw, 0.05).addScaledVector(_lf, side * 0.12);
        this.handHome(side, 0.55, _v2); _v2.y += 0.05;
        if (this.crawlAtk <= 1) _T.lerp(_v, atk); else _T.copy(_v).lerp(_v2, slam);
        pole = 0.6;
      }
      _q2.setFromRotationMatrix(uarm.parent!.matrixWorld);
      _v2.copy(_lf).multiplyScalar(side * 0.85).addScaledVector(_fw, -0.45 * pole).addScaledVector(Y, 0.35);
      const bend = armIK(_S, _T, _v2, K.uarm, K.larm + 0.04, _q2, uarm);
      B['larm_' + sfx].quaternion.setFromAxisAngle(X, -bend);
      // palm down, fingers claw into the floor while planted
      const grip = h.t >= 1 ? 0.75 : 0.15;
      B['hand_' + sfx].quaternion.setFromEuler(_e.set(0.75 - (h.t < 1 ? 0.45 : 0), 0, 0));
      if (i === 0) {
        B.fing_l.quaternion.setFromEuler(_e.set(-grip, 0, 0));
        B.fing2_l.quaternion.setFromEuler(_e.set(-grip * 1.2, 0, 0));
      }
    }
  }

  // ───────────────────────────────────────────────────────── locomotion pose

  private locomote(dt: number): void {
    const B = this.B, p = this.body.position, v = this.body.velocity, w = this.world;
    const ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    const speed = Math.hypot(v.x, v.z);
    this.runBlend = damp(this.runBlend, smooth((speed - 1.8) / 1.6), 9, dt);
    const rb = this.runBlend;
    const moving = speed > 0.12;
    const vx = moving ? v.x / speed : 0, vz = moving ? v.z / speed : 0;
    const feet = this.feet;

    for (let i = 0; i < 2; i++) {
      const f = feet[i], o = feet[1 - i];
      const bad = f.side === this.limp;
      const dur = (0.4 - 0.17 * rb) * (bad ? 1.22 : 1) / (1 + (this.mode === 'stagger' ? 0.6 : 0));
      const hx = p.x + f.side * (0.105 - 0.03 * rb) * c, hz = p.z - f.side * (0.105 - 0.03 * rb) * s;
      if (f.t >= 1) {
        const ex = hx - f.pos.x, ez = hz - f.pos.z;
        const err = Math.hypot(ex, ez);
        const behind = ex * vx + ez * vz;
        const thresh = Math.max(0.09, speed * dur * (bad ? 0.42 : 0.56));
        const yawErr = Math.abs(angleDiff(ry, f.yaw));
        const otherOk = o.t >= 1 || (rb > 0.5 && o.t > 0.5);
        const errO = Math.hypot(p.x + o.side * 0.105 * c - o.pos.x, p.z - o.side * 0.105 * s - o.pos.z);
        const need = moving ? (err > thresh && behind > -0.02) : (err > 0.11 || yawErr > 0.6);
        // when both want to step, the one further off goes first
        if (need && otherOk && (o.t < 1 || err >= errO - 0.01 || !moving)) {
          f.t = 0; f.dur = dur; f.from.copy(f.pos);
          f.lift = 0.05 + 0.1 * rb + (bad ? -0.02 : 0.015) + Math.min(0.05, err * 0.1);
          f.to.set(hx, p.y, hz);
          const g = this.groundAt(hx + v.x * dur * 1.4, p.y + 0.7, hz + v.z * dur * 1.4, 1.5);
          f.to.y = g !== null ? g : p.y;
        }
      }
      if (f.t < 1) {
        f.t += dt / f.dur;
        const remain = Math.max(0, 1 - f.t) * f.dur;
        const lead = remain + f.dur * (bad ? 0.42 : 0.56);
        const tx = hx + v.x * lead, tz = hz + v.z * lead;
        f.to.x = tx; f.to.z = tz;
        if (f.t >= 1) {
          f.t = 1; f.pos.copy(f.to); f.yaw = ry;
          if (moving || this.mode === 'stagger') this.emit('enemy:step');
        } else {
          const k = f.t * f.t * (3 - 2 * f.t);
          f.pos.x = f.from.x + (f.to.x - f.from.x) * k;
          f.pos.z = f.from.z + (f.to.z - f.from.z) * k;
          f.pos.y = f.from.y + (f.to.y - f.from.y) * k + Math.sin(Math.PI * f.t) * f.lift;
          f.yaw += angleDiff(ry, f.yaw) * Math.min(1, dt / Math.max(0.02, remain));
        }
      }
      // world → rig space
      const dx = f.pos.x - p.x, dz = f.pos.z - p.z;
      f.rig.set(dx * c - dz * s, f.pos.y - p.y, dx * s + dz * c);
    }

    const L = feet[0], R = feet[1];
    const swL = L.t < 1 ? Math.sin(Math.PI * L.t) : 0, swR = R.t < 1 ? Math.sin(Math.PI * R.t) : 0;
    const stride = THREE.MathUtils.clamp(L.rig.z - R.rig.z, -1.2, 1.2);
    const t = w.time;
    const idle = 1 - Math.min(1, speed / 0.5);
    const breathe = Math.sin(t * 1.3 + this.seed) * 0.004 * idle;
    const limpDip = (this.limp > 0 ? swR : swL) * 0.03 * (1 - rb); // body drops onto the bad leg
    // hips
    let hy = 0.965 - 0.018 * (1 - idle) - 0.085 * rb + (swL + swR) * (0.018 + 0.02 * rb) - limpDip + breathe - this.atkWind * 0.03 - this.atkStrike * 0.05;
    const hxs = (swR - swL) * (0.03 - 0.012 * rb) + noise1(t * 0.4, this.seed) * 0.008 * idle;
    const hz = 0.01 + (L.rig.z + R.rig.z) * 0.32 - 0.02 * rb;
    const pelvisYaw = -stride * (0.32 + 0.1 * rb);
    const pelvisRoll = (swR - swL) * 0.07;
    const lean = 0.05 + 0.2 * rb + this.atkStrike * 0.25 - this.atkWind * 0.1;
    // keep legs reachable
    for (let i = 0; i < 2; i++) {
      const f = feet[i];
      const dxh = f.rig.x - (hxs + f.side * K.hipX), dzh = f.rig.z - hz;
      const horiz2 = dxh * dxh + dzh * dzh;
      const maxLen = (K.thigh + K.shin) * 0.992;
      const maxY = Math.sqrt(Math.max(0.04, maxLen * maxLen - horiz2)) + f.rig.y + K.ankle + 0.05;
      if (hy > maxY) hy = maxY;
    }
    this.hipsY = damp(this.hipsY, hy, 22, dt || 0.016);
    B.hips.position.set(hxs, this.hipsY, hz);
    B.hips.quaternion.setFromEuler(_e.set(lean * 0.45, pelvisYaw, pelvisRoll, 'YXZ'));
    const sway = noise1(t * 0.5, this.seed + 3) * 0.02 * idle;
    const twistAtk = (this.atkWind * 0.5 - this.atkStrike * 1.0) * (this.atkArm >= 0 ? -1 : 1) * (this.atkArm === 0 ? 0 : 1);
    B.spine1.quaternion.setFromEuler(_e.set(lean * 0.3 + sway, -pelvisYaw * 0.55 + twistAtk * 0.4, -pelvisRoll * 0.6, 'YXZ'));
    B.spine2.quaternion.setFromEuler(_e.set(lean * 0.35 + breathe * 3, -pelvisYaw * 0.75 + twistAtk * 0.6, -pelvisRoll * 0.5 + (this.limp > 0 ? swR : -swL) * 0.06 * (1 - rb), 'YXZ'));
    B.clav_l.quaternion.identity(); B.clav_r.quaternion.identity();

    // arms (FK): counter-swing, reaching when close, melee on top
    const sw = stride * (0.75 + 0.5 * rb);
    const jit = noise1(t * 9, this.seed + 1) * 0.05 * this.reach;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1, sfx = i === 0 ? 'l' : 'r';
      const swing = side > 0 ? sw : -sw;
      let pitch = 0.08 + swing + rb * 0.15;
      let roll = 0.12 + 0.04 * rb;
      let twist = 0;
      let elbow = 0.28 + 0.75 * rb + Math.max(0, -swing) * 0.5;
      const reach = this.reach * (side > 0 ? 1 : 0.55);
      pitch += (-1.25 + jit + noise1(t * 0.9, this.seed + i * 9) * 0.15 - pitch) * reach;
      elbow += ((side > 0 ? 0.45 : 0.9) + noise1(t * 1.3, this.seed + 20 + i) * 0.25 - elbow) * reach;
      roll += (0.2 - roll) * reach;
      if (this.atkArm === side || (this.atkArm === 0 && false)) {
        // overhead hammer blow: raise up/back, then whip down
        const aw = this.atkWind, as = this.atkStrike;
        pitch += (-3.35 - pitch) * aw; elbow += (1.15 - elbow) * aw; roll += (0.5 - roll) * aw; twist = 0.3 * aw;
        pitch += (-0.95 - pitch) * as; elbow += (0.25 - elbow) * as; roll += (0.05 - roll) * as;
      }
      if (this.thrash > 0) {
        pitch += noise1(t * 7.1, this.seed + 30 + i) * 1.1 * this.thrash;
        roll += Math.abs(noise1(t * 6.3, this.seed + 40 + i)) * 0.9 * this.thrash;
        elbow += (noise1(t * 8.7, this.seed + 50 + i) + 1) * 0.6 * this.thrash;
      }
      B['uarm_' + sfx].quaternion.setFromEuler(_e.set(pitch, twist * side, roll * side, 'XYZ'));
      B['larm_' + sfx].quaternion.setFromEuler(_e.set(-Math.max(0.03, elbow), 0, 0));
      B['hand_' + sfx].quaternion.setFromEuler(_e.set(-0.15 * reach, 0, 0));
    }
    const curl = 0.45 - this.reach * 0.35 + noise1(t * 5, this.seed + 60) * 0.25 * this.reach;
    B.fing_l.quaternion.setFromEuler(_e.set(-curl, 0, 0));
    B.fing2_l.quaternion.setFromEuler(_e.set(-curl * 1.3, 0, 0));

    // legs (IK)
    const hipsQ = B.hips.quaternion;
    for (let i = 0; i < 2; i++) {
      const f = feet[i], sfx = i === 0 ? 'l' : 'r';
      _v.set(f.side * K.hipX, K.hipY - K.hipsY, 0).applyQuaternion(hipsQ).add(B.hips.position);
      // foot pitch through the swing: heel peels off, toe comes up before the strike
      let pitch = 0;
      if (f.t < 1) pitch = Math.sin(Math.PI * Math.min(1, f.t * 1.6)) * (0.5 + 0.35 * rb) - smooth((f.t - 0.6) / 0.4) * 0.3;
      const yawRel = angleDiff(f.yaw, ry) + pelvisYaw * 0.3;
      _v2.set(f.rig.x, f.rig.y + K.ankle + Math.abs(Math.sin(pitch)) * 0.04, f.rig.z);
      _pole.set(f.side * 0.16 + Math.sin(yawRel), 0.0, 1).normalize();
      const bend = solveLimb(_v, _v2, _pole, hipsQ, K.thigh, K.shin, B['thigh_' + sfx], 1, _upQ);
      B['shin_' + sfx].quaternion.setFromAxisAngle(X, bend);
      _q.copy(_upQ).multiply(B['shin_' + sfx].quaternion).invert();
      _q2.setFromEuler(_e.set(pitch, yawRel, 0, 'YXZ'));
      B['foot_' + sfx].quaternion.copy(_q).multiply(_q2);
    }
  }

  /** Blending, head tracking, flinch, tools, world transform, pistons, light. */
  private finishPose(dt = 0): void {
    const B = this.B, w = this.world, p = this.body.position;
    const t = w.time;
    if (this.blendT < 1) {
      this.blendT = this.blendDur > 0 ? Math.min(1, this.blendT + dt / this.blendDur) : 1;
      const k = smooth(this.blendT);
      this.rig.blendTo(this.snap, 1 - k);
    }
    const ry = this.yaw + Math.PI;
    if (dt > 0) {
      // rack thrash / flail noise on the torso
      if (this.thrash > 0) {
        const a = this.thrash;
        B.spine1.quaternion.multiply(_q.setFromEuler(_e.set(noise1(t * 6, this.seed + 70) * 0.35 * a, noise1(t * 5, this.seed + 71) * 0.5 * a, noise1(t * 4.4, this.seed + 72) * 0.3 * a)));
        B.spine2.quaternion.multiply(_q.setFromEuler(_e.set(noise1(t * 7, this.seed + 73) * 0.3 * a, noise1(t * 6.1, this.seed + 74) * 0.4 * a, 0)));
        if (this.mode === 'wake') {
          B.thigh_l.quaternion.multiply(_q.setFromEuler(_e.set(noise1(t * 6.6, this.seed + 75) * 0.7 * a, 0, 0)));
          B.thigh_r.quaternion.multiply(_q.setFromEuler(_e.set(noise1(t * 5.9, this.seed + 76) * 0.7 * a, 0, 0)));
          B.shin_l.quaternion.multiply(_q.setFromEuler(_e.set((noise1(t * 7.7, this.seed + 77) + 1) * 0.5 * a, 0, 0)));
          B.shin_r.quaternion.multiply(_q.setFromEuler(_e.set((noise1(t * 8.3, this.seed + 78) + 1) * 0.5 * a, 0, 0)));
          B.uarm_l.quaternion.multiply(_q.setFromEuler(_e.set(noise1(t * 7.1, this.seed + 30) * 0.9 * a, 0, Math.abs(noise1(t * 6.3, this.seed + 40)) * 0.8 * a)));
          B.uarm_r.quaternion.multiply(_q.setFromEuler(_e.set(noise1(t * 6.7, this.seed + 31) * 0.9 * a, 0, -Math.abs(noise1(t * 5.3, this.seed + 41)) * 0.8 * a)));
          B.larm_l.quaternion.multiply(_q.setFromEuler(_e.set(-(noise1(t * 8.7, this.seed + 50) + 1) * 0.6 * a, 0, 0)));
          B.larm_r.quaternion.multiply(_q.setFromEuler(_e.set(-(noise1(t * 9.1, this.seed + 51) + 1) * 0.6 * a, 0, 0)));
        }
      }
      // flinch springs
      spring(this.flP, 0, 2.6, 0.38, dt); spring(this.flR, 0, 2.6, 0.38, dt); spring(this.flY, 0, 2.6, 0.4, dt);
      if (Math.abs(this.flP.x) + Math.abs(this.flR.x) + Math.abs(this.flY.x) > 0.002) {
        _q.setFromEuler(_e.set(this.flP.x * 0.5, this.flY.x * 0.5, this.flR.x * 0.5));
        B.spine1.quaternion.multiply(_q);
        B.spine2.quaternion.multiply(_q);
      }
      // head tracking (spring with overshoot) + twitches
      if (this.lookW > 0.001 && !this.headGone) {
        // chest orientation in rig space
        _q.copy(B.hips.quaternion).multiply(B.spine1.quaternion).multiply(B.spine2.quaternion);
        const dx = w.playerEye.x - p.x, dz = w.playerEye.z - p.z;
        const c = Math.cos(ry), s = Math.sin(ry);
        _v.set(dx * c - dz * s, w.playerEye.y - (p.y + B.hips.position.y + 0.68), dx * s + dz * c);
        _v.applyQuaternion(_q2.copy(_q).invert());
        const wantYaw = THREE.MathUtils.clamp(Math.atan2(_v.x, _v.z), -1.35, 1.35);
        const wantPitch = THREE.MathUtils.clamp(-Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.9, 0.8);
        this.twitchTimer -= dt;
        if (this.twitchTimer <= 0) {
          this.twitchTimer = 0.7 + w.rand() * 2.6;
          const r = w.rand();
          if (r < 0.5) this.headRoll.v += (w.rand() - 0.5) * 22;
          else if (r < 0.8) this.headYaw.v += (w.rand() - 0.5) * 18;
          else { this.headRoll.x += (w.rand() - 0.5) * 0.5; this.headYaw.x += (w.rand() - 0.5) * 0.4; }
        }
        spring(this.headYaw, wantYaw, 3.4, 0.36, dt);
        spring(this.headPitch, wantPitch, 3.4, 0.4, dt);
        spring(this.headRoll, 0, 4.2, 0.3, dt);
        _q3.setFromEuler(_e.set(this.headPitch.x * 0.4, this.headYaw.x * 0.4, this.headRoll.x * 0.3, 'YXZ'));
        B.neck.quaternion.slerp(_q3, this.lookW);
        _q3.setFromEuler(_e.set(this.headPitch.x * 0.6, this.headYaw.x * 0.6, this.headRoll.x * 0.7, 'YXZ'));
        B.head.quaternion.slerp(_q3, this.lookW);
      }
      // tools
      const winding = this.mode === 'windup' || this.mode === 'strike' || this.mode === 'cwindup' || this.mode === 'cstrike';
      if (this.tool === 1) {
        this.bladeSpeed = damp(this.bladeSpeed, winding ? 70 : this.mode === 'chase' && this.dist < 5 ? 22 : 0, 4, dt);
        B.blade.rotateX(this.bladeSpeed * dt);
      } else if (this.tool === 0) {
        const open = this.mode === 'windup' ? 0.75 : this.mode === 'strike' || this.mode === 'recover' ? 0.02
          : 0.3 + (this.mode === 'chase' && this.dist < 4 ? Math.max(0, Math.sin(t * 9 + this.seed)) * 0.5 : 0);
        this.jaw = damp(this.jaw, open, this.mode === 'strike' ? 60 : 12, dt);
        B.jaw_a.quaternion.setFromAxisAngle(Z, -this.jaw * 0.6);
        B.jaw_b.quaternion.setFromAxisAngle(Z, this.jaw * 0.6);
      } else {
        this.needle = damp(this.needle, this.mode === 'strike' ? 1 : this.mode === 'windup' ? -0.3 : 0, this.mode === 'strike' ? 50 : 8, dt);
        B.needle.position.y = -0.1 - this.needle * 0.07;
      }
      // eye flicker on ignition
      if (this.eyeFlicker > 0) {
        this.eyeFlicker -= dt;
        const on = this.eyeFlicker <= 0 || Math.sin(this.eyeFlicker * 90) > -0.2;
        B.eye.scale.setScalar(on ? 1 : 1e-4);
      }
      // sparking stump
      if (this.stumpSpark > 0 && this.stumpBone) {
        this.stumpSpark -= dt;
        if (w.rand() < dt * 7) {
          _v.setFromMatrixPosition(this.stumpBone.matrixWorld);
          try { w.ctx.fx.sparks(_v, _v2.set(w.rand() - 0.5, 0.4, w.rand() - 0.5).normalize(), 4, 2.5); } catch { /* */ }
        }
      }
    }
    this.object.position.copy(p);
    this.object.rotation.y = ry;
    this.object.updateMatrixWorld(true);
    for (let i = 0; i < this.pistons.length; i++) this.pistons[i].update();
    if (this.light) {
      const e = B.head.matrixWorld.elements;
      this.light.position.set(e[12] + e[8] * 0.3 + e[4] * 0.1, e[13] + e[9] * 0.3 + e[5] * 0.1, e[14] + e[10] * 0.3 + e[6] * 0.1);
    }
  }

  // ───────────────────────────────────────────────────────── damage

  /** One coalesced burst per frame: pistol torso = small tight spray, head = brighter + flash, shotgun = big. */
  protected hitFx(b: HitBurst): void {
    const fx = this.world.ctx.fx, A = b.amount;
    const head = b.part === 'head', limb = b.part === 'limb';
    const sp = THREE.MathUtils.clamp(Math.round(2 + A / 7 + (head ? 3 : 0)), 3, 18);
    fx.sparks(b.point, b.normal, sp, (head ? 3.4 : 2.5) + Math.min(2.5, A / 30));
    const fl = Math.min(8, limb ? Math.round(A / 26) : Math.round(A / 11) - (head ? 1 : 0));
    if (fl > 0) fx.fluid(b.point, b.dir, fl);
    if (head) { _v.copy(b.point).addScaledVector(b.normal, 0.08); fx.flash(_v, 0xffc27a, 1.4 + Math.min(3, A * 0.04), 0.05, 2.5); }
    if (A >= 40) fx.smoke(b.point, { count: 2, size: 0.28, color: 0x2a2a2c, rise: 0.3, life: 0.9 });
  }

  applyDamage(vol: HitVolume, amount: number, point: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.alive) return;
    const w = this.world;
    const mult = vol.part === 'head' ? 2 : vol.part === 'limb' ? 0.7 : 1;
    const dmg = amount * mult;
    this.health -= dmg;
    w.ctx.events.emit('enemy:damaged', { id: this.id, type: this.type, point, direction: dir, amount: dmg });
    this.queueHit(vol, amount, point, dir);

    // flinch: push in rig space
    const ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    const lx = dir.x * c - dir.z * s, lz = dir.x * s + dir.z * c;
    const k = Math.min(2.2, amount / 14) * (vol.part === 'limb' ? 0.6 : 1);
    this.flP.v += lz * 9 * k; this.flR.v += -lx * 7 * k;
    if (vol.region === 'arm_l') this.flY.v += 8 * k; else if (vol.region === 'arm_r') this.flY.v -= 8 * k;
    if (vol.part === 'head') { this.headPitch.v -= lz * -14 * k; this.headRoll.v += (w.rand() - 0.5) * 30; this.headYaw.v += -lx * 18 * k; }
    this.rage = 7;

    // region bookkeeping: plates break off, arms sever, head bursts
    const reg = vol.region;
    this.regionDmg[reg] = (this.regionDmg[reg] ?? 0) + amount;
    if (w.rand() < amount / 22) this.shedPlate(reg, dir);
    if ((reg === 'arm_l' || reg === 'arm_r') && this.regionDmg[reg] >= 34 && !this.armGone[reg === 'arm_l' ? 0 : 1]) this.severArm(reg === 'arm_l' ? 0 : 1, dir);
    if (reg === 'head' && !this.headGone && this.regionDmg[reg] * 2 >= 60 && this.health > 0) this.destroyHead(dir);
    if ((reg === 'leg_l' || reg === 'leg_r') && this.regionDmg[reg] >= LEG_BREAK && !this.legGone[reg === 'leg_l' ? 0 : 1] && this.health > 0) this.breakLeg(reg === 'leg_l' ? 0 : 1, dir);

    if (this.health <= 0) {
      if (reg === 'head' && !this.headGone) this.burstHead(dir);
      this.die(dir);
      return;
    }
    if (this.mode === 'dormant') { this.wakeDelay = -1; this.beginWake(1.7); return; }
    if (this.mode === 'idle') { this.enterAlert(); }
    if (this.crawler) return; // prone: flinches only
    // heavy hits stagger (and interrupt a wind-up)
    this.recentDmg += dmg; this.recentT = 0.25;
    if (this.recentDmg >= 30 && (this.mode === 'chase' || this.mode === 'windup' || this.mode === 'recover' || this.mode === 'react')) {
      this.recentDmg = 0;
      this.atkWind = 0; this.atkStrike = 0;
      this.setMode('stagger');
      this.body.velocity.x += dir.x * 3.4; this.body.velocity.z += dir.z * 3.4;
      this.flP.v += lz * 10;
    }
  }

  private shedPlate(region: string, dir: THREE.Vector3): void {
    const fx = this.world.ctx.fx;
    for (const pl of this.plates) {
      if (pl.gone || pl.region !== region) continue;
      pl.gone = true;
      this.shedBone(pl.bone, dir, 2.5);
      return;
    }
    void fx;
  }

  private shedBone(name: string, dir: THREE.Vector3, speed: number): void {
    const bone = this.B[name], w = this.world;
    const mesh = this.tpl.rig.debrisMesh(name);
    if (mesh && bone.scale.x > 0.5) {
      bone.updateWorldMatrix(true, false);
      bone.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
      _imp.set(dir.x * speed + (w.rand() - 0.5) * 2, 1.5 + w.rand() * 2, dir.z * speed + (w.rand() - 0.5) * 2);
      try { w.ctx.fx.debris(mesh.position, _imp, [mesh], 14); } catch { /* fx optional */ }
    }
    bone.scale.setScalar(1e-4);
  }

  private severArm(i: number, dir: THREE.Vector3): void {
    const sfx = i === 0 ? 'l' : 'r', w = this.world;
    this.armGone[i] = true;
    for (const pl of this.plates) if (pl.region === 'arm_' + sfx && !pl.gone) { pl.gone = true; this.shedBone(pl.bone, dir, 3); }
    // lower arm (and hand) fly off; the upper arm stays as a sparking stump
    if (i === 0) this.shedBone('hand_l', dir, 3);
    this.shedBone('larm_' + sfx, dir, 3.5);
    for (const v of this.volumes) if (v.region === 'arm_' + sfx && v.bone === this.B['larm_' + sfx]) v.enabled = false;
    this.stumpBone = this.B['larm_' + sfx]; this.stumpSpark = 3.5;
    _v.setFromMatrixPosition(this.B['larm_' + sfx].matrixWorld);
    try { w.ctx.fx.sparks(_v, _v2.copy(dir).negate(), 14, 4); w.ctx.fx.fluid(_v, dir, 10); } catch { /* */ }
    if (this.mode === 'windup' || this.mode === 'strike') { this.atkWind = 0; this.atkStrike = 0; this.setMode('stagger'); }
    if (this.crawler && this.mode !== 'topple') { this.crawlAtk = 0; this.goChase(); }
  }

  /** A leg snaps at the knee: shin + foot fly off, the machine topples and crawls on its arms. */
  private breakLeg(i: number, dir: THREE.Vector3): void {
    const sfx = i === 0 ? 'l' : 'r', w = this.world;
    this.legGone[i] = true;
    for (const pl of this.plates) if (pl.bone === 'p_shin_' + sfx && !pl.gone) { pl.gone = true; this.shedBone(pl.bone, dir, 2.5); }
    _v.setFromMatrixPosition(this.B['shin_' + sfx].matrixWorld);
    this.shedBone('foot_' + sfx, dir, 2);
    this.shedBone('shin_' + sfx, dir, 3);
    for (const v of this.volumes) if (v.bone === this.B['shin_' + sfx]) v.enabled = false;
    this.stumpBone = this.B['shin_' + sfx]; this.stumpSpark = 4;
    try { w.ctx.fx.sparks(_v, _v2.copy(dir).negate(), 14, 4); w.ctx.fx.fluid(_v, dir, 8); } catch { /* */ }
    if (!this.awake) {
      this.awake = true; this.wakeDelay = -1; this.pose = '';
      this.setEye(true); this.startLoop('husk_loop', 0.8);
      w.ctx.events.emit('enemy:woke', { id: this.id, type: this.type, position: this.body.position });
    }
    this.body.onGround = false;
    if (!this.crawler && this.mode !== 'dying' && this.mode !== 'dead') this.startCrawl(dir);
  }

  private burstHead(dir: THREE.Vector3): void {
    const w = this.world;
    this.headGone = true;
    for (const pl of this.plates) if (pl.region === 'head' && !pl.gone) { pl.gone = true; this.shedBone(pl.bone, dir, 4); }
    this.shedBone('head', dir, 3);
    for (const v of this.volumes) if (v.region === 'head') v.enabled = false;
    this.stumpBone = this.B.neck; this.stumpSpark = 4;
    _v.setFromMatrixPosition(this.B.head.matrixWorld);
    try { w.ctx.fx.sparks(_v, Y, 18, 5); w.ctx.fx.fluid(_v, Y, 12); w.ctx.fx.flash(_v, 0xffb060, 6, 0.12, 4); } catch { /* */ }
    this.setEye(false);
    if (this.light) { this.light.remove(); this.light = null; }
  }

  private destroyHead(dir: THREE.Vector3): void {
    this.burstHead(dir);
    if (!this.awake) { this.awake = true; this.wakeDelay = -1; this.startLoop('husk_loop', 0.8); this.pose = ''; this.resetFeet(); }
    this.body.onGround = false;
    if (this.crawler) { this.setMode('writhe'); return; }
    this.setMode('flail');
    this.startBlend(0.2);
  }

  private die(dir: THREE.Vector3): void {
    if (!this.alive) return;
    const w = this.world;
    this.alive = false;
    this.health = 0;
    this.awake = true;
    // fall away from the shot
    const ry = this.yaw + Math.PI;
    const along = dir.x * Math.sin(ry) + dir.z * Math.cos(ry);
    const r = w.rand();
    this.deadKey = this.crawler ? 'deadFront' : this.pose === 'slumped' ? 'deadSide' : r < 0.2 ? 'deadSide' : along > 0.2 ? 'deadFront' : along < -0.2 ? 'deadBack' : (r < 0.6 ? 'deadFront' : 'deadBack');
    this.body.velocity.x += dir.x * 1.6; this.body.velocity.z += dir.z * 1.6;
    this.body.onGround = false;
    this.thrash = 0; this.atkWind = 0; this.atkStrike = 0; this.reach = 0; this.crawlAtk = 0;
    this.startBlend(this.pose === 'slumped' || this.crawler ? 0.5 : 0.3);
    this.setMode('dying');
    if (this.pose === 'slumped' || this.crawler) this.modeTime = 0.33;
    this.stopLoop(0.4);
    _v.set(this.body.position.x, this.body.position.y + 1.2, this.body.position.z);
    try { w.ctx.fx.sparks(_v, Y, 16, 4); w.ctx.fx.smoke(_v, { count: 4, size: 0.5, color: 0x202022, rise: 0.5, life: 2 }); } catch { /* */ }
    this.diedAt = w.time;
    w.onDeath(this);
  }

  override dispose(): void {
    if (this.light) { this.light.remove(); this.light = null; }
    this.rig.skeleton.dispose();
    super.dispose();
  }
}

const _iq = new THREE.Quaternion();
/**
 * Two-bone arm IK in world space for a limb hanging along local -Y whose elbow flexes about local X with a
 * NEGATIVE angle (forearm swings toward local +Z). Writes `upper.quaternion` (relative to its parent whose
 * world rotation is `parentQ`) and returns the elbow flex angle (>= 0; apply as rotation.x = -bend).
 */
function armIK(S: THREE.Vector3, T: THREE.Vector3, elbowDir: THREE.Vector3, l1: number, l2: number, parentQ: THREE.Quaternion, upper: THREE.Object3D): number {
  _dn.copy(T).sub(S);
  let dist = _dn.length();
  if (dist < 1e-5) { _dn.set(0, -1, 0); dist = 0.1; }
  _dn.multiplyScalar(1 / (_dn.length() || 1));
  dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 0.03), (l1 + l2) * 0.995);
  const a = Math.acos(THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
  const bend = Math.PI - Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2), -1, 1));
  _pp.copy(elbowDir).addScaledVector(_dn, -elbowDir.dot(_dn));
  if (_pp.lengthSq() < 1e-8) _pp.set(0, 1, 0).addScaledVector(_dn, -_dn.y);
  _pp.normalize();
  _ud.copy(_dn).multiplyScalar(Math.cos(a)).addScaledVector(_pp, Math.sin(a)).normalize();
  // basis: y = -upper direction, z = toward the target side of the bend plane, x = y × z
  _by.copy(_ud).negate();
  _bz.copy(_dn).addScaledVector(_ud, -_dn.dot(_ud));
  if (_bz.lengthSq() < 1e-8) _bz.copy(_pp).negate();
  _bz.normalize();
  _bx.copy(_by).cross(_bz).normalize();
  _mb.makeBasis(_bx, _by, _bz);
  _iq.setFromRotationMatrix(_mb);
  upper.quaternion.copy(parentQ).invert().multiply(_iq);
  return bend;
}
