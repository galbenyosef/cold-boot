/**
 * HUSK runtime: procedural locomotion (foot planting + leg IK), head tracking with twitch/overshoot,
 * dormant poses and wake-up sequences, melee, stagger, part destruction, collapse.
 */
import * as THREE from 'three';
import type { LightHandle } from '../../core/types';
import { EnemyBase, type EnemyWorld, type HitBurst } from '../ai';
import type { FactoryOpts } from '../manager';
import { hv, type HitVolume } from '../shared/hit';
import { angleDiff, damp, noise1, smooth, solveLimb, spring, type Spring } from '../shared/ik';
import { Piston } from '../shared/piston';
import type { Rig } from '../shared/rig';
import { HUSK_DIM as K, type HuskTemplate } from './model';
import { applySpec, HUSK_POSES } from './poses';
import { sayMutter } from '../voice';
import { armIK } from '../shared/ik';
import { WorkerProps } from './worker';
import { Holo, holoMaterial, holoOverride } from '../shared/holo';

type Mode = 'puppet' | 'dormant' | 'wake' | 'idle' | 'react' | 'chase' | 'windup' | 'strike' | 'recover' | 'stagger' | 'flail'
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
/** Tutorial machine (group g_junction): walk only, longer telegraph, lighter blow. */
const GENTLE_GROUP = 'g_junction', GENTLE_MELEE = 12, WINDUP = 0.5, GENTLE_WINDUP = 0.7, GENTLE_RECOVER = 0.85;
/** Dormant 'watch': head tracking rates (rad/s) — creeping, frozen when stared at from close, catching up unseen. */
const WATCH_CREEP = 4 * Math.PI / 180, WATCH_CATCHUP = 38 * Math.PI / 180, WATCH_STARE = 5, WATCH_MAX = 1.45;
/** Dormant 'work': freeze within / resume beyond (m). */
const WORK_FREEZE = 6, WORK_RESUME = 9;
/** Mutter: range, per-husk interval, assumed clip length. */
const WHISPER_RANGE = 8, WHISPER_MIN = 12, WHISPER_RAND = 13, WHISPER_LEN = 3.2;
const D2R = Math.PI / 180;
/** REVISION 4 worker: flashlight cone (cos) + seconds on the head that provoke; treadmill belt. */
const WORKER_LIT_COS = Math.cos(11 * Math.PI / 180), WORKER_LIT_TIME = 1.5;
const TREAD_SPEED = 1.05, TREAD_CYCLE = 1.16, TREAD_STANCE = 0.6;
/** Fold loop keys: [u, Lx, Ly, Lz, Rx, Ry, Rz, sheet length (-1 = folded block)] in rig space (+x = its left). */
const FOLD_KEYS: number[][] = [
  [0.0, 0.2, 1.0, 0.26, -0.22, 1.0, 0.26, 0],
  [0.06, 0.44, 1.05, 0.42, 0.24, 1.05, 0.44, 0],
  [0.12, 0.44, 1.03, 0.44, 0.24, 1.03, 0.45, 0.05],
  [0.24, 0.27, 1.34, 0.3, -0.27, 1.34, 0.3, 0.62],
  [0.3, 0.27, 1.4, 0.3, -0.27, 1.4, 0.3, 0.62],
  [0.35, 0.27, 1.31, 0.31, -0.27, 1.31, 0.31, 0.62],
  [0.48, 0.15, 1.18, 0.36, -0.15, 1.18, 0.36, 0.32],
  [0.56, 0.12, 1.07, 0.42, -0.12, 1.07, 0.42, -1],
  [0.68, 0.1, 1.07, 0.42, -0.1, 1.07, 0.42, -1],
  [0.78, -0.24, 1.09, 0.42, -0.46, 1.09, 0.43, -1],
  [0.86, 0.18, 1.0, 0.24, -0.22, 1.0, 0.26, -1],
  [1.0, 0.2, 1.0, 0.26, -0.22, 1.0, 0.26, -1],
];
const _qi = new THREE.Quaternion();
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
/** Dormant pose / puppet pose name → key pose. */
const POSE_KEY: Record<string, string> = { slumped: 'slumped', rack: 'hang', standing: 'bent', ceiling: 'bent', tucked: 'slumped', under: 'slumped' };
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
  // revision 2: tutorial flag, dormant behaviours, mutter, puppet
  private readonly gentle: boolean;
  private readonly idleKind: 'still' | 'watch' | 'work' | 'twitch' | 'worker';
  // REVISION 4: worker stealth task + puppet gaits + speech
  private workKind: 'polish' | 'fold' | 'treadmill' = 'polish';
  private props: WorkerProps | null = null;
  private workerT = 0; private litT = 0; private provokeT = 0; private stillDur = 0.9;
  private readonly home = new THREE.Vector3();
  private frozen: Float32Array | null = null;
  private tread = false; private treadSpeed = 0; private treadPhase = 0; private treadOff = 0; private treadOffNow = 0;
  /** '' = the machine's own walk (level 1), 'limp' | 'carry' | 'carry_l' | 'carry_r' | 'human'. */
  private gait = '';
  private carrySide = 0;
  private speakT = 0; private speakDur = 0;
  private watchYaw = 0; private watchRate = 0; private watchT = 0; private watchDirty = true;
  private readonly watchTgt = new THREE.Vector3();
  private myRoom: string | null | undefined = undefined;
  private roomDoors: THREE.Vector3[] | null = null;
  private roomBox: THREE.Box3 | null = null;
  private fingerT = 0; private fingerTimer: number;
  private twKind = 0; private twT = -1; private twDur = 0;
  private workT = 0; private workFrozen = false; private workDur: number;
  private headTurn = 0;
  private whisperTimer: number;
  private readonly mouth = new THREE.Vector3();
  private lookPt: THREE.Vector3 | null = null;
  private readonly lookBuf = new THREE.Vector3();
  private pPose = 'idle';
  private pMoving = false; private pSpeed = WALK; private pDone: (() => void) | null = null;
  private readonly pTarget = new THREE.Vector3();
  private pStuck = 0; private pLastD = 0;
  /** REVISION 5: spawn pose 'drop' — falls from ~4 m, lands, rises. */
  private dropIn = false;

  constructor(world: EnemyWorld, private tpl: HuskTemplate, group: string, position: THREE.Vector3, yaw: number, o: FactoryOpts) {
    super(world, group, position, yaw, 0.35, 1.8);
    this.isActor = !!o.actor;
    const dormant = o.dormant && !this.isActor, pose = o.pose;
    this.gentle = group === GENTLE_GROUP;
    this.idleKind = o.idle === 'watch' || o.idle === 'work' || o.idle === 'twitch' || o.idle === 'worker' ? o.idle : 'still';
    this.isWorker = this.idleKind === 'worker' && dormant;
    this.fingerTimer = 14 + world.rand() * 22;
    this.workDur = 6 + world.rand() * 2;
    this.whisperTimer = 3 + world.rand() * 6;
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
    const look = this.isActor ? o.look : undefined;
    const holoKind = look === 'holo_ghost' ? 'ghost' : look === 'holo_tech' ? 'tech' : null;
    const holoMat = holoKind ? holoMaterial(holoKind, world.rand() * 10) : null;
    this.rig = holoMat ? tpl.rig.instantiate(holoOverride(tpl.rig, holoMat)) : tpl.rig.instantiate({ sign });
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
    if (this.isWorker) {
      this.pose = 'worker';
      this.workKind = pose === 'fold' || pose === 'treadmill' ? pose : 'polish';
      this.home.copy(this.body.position);
      this.limp = 0; // workers walk / fold like the people they were
      this.gait = 'human';
    }
    if (this.isActor) {
      this.mode = 'puppet'; this.state = 'idle';
      this.pPose = pose && (POSE_KEY[pose] || HUSK_POSES[pose] || pose === 'tread') ? pose : holoKind === 'tech' ? 'tread' : 'idle';
      if (holoKind && holoMat) {
        this.holo = new Holo(world, holoKind, holoMat, this.rig, this.object, holoKind === 'ghost' ? tpl.rig.instantiate(holoOverride(tpl.rig, holoMat)) : null,
          () => { this.holdHidden = true; });
        this.gait = holoKind === 'ghost' ? 'limp' : 'human';
        this.limp = 0;
        this.body.gravityScale = 0;
      }
      if (this.pPose === 'slumped') this.snapToWall();
      this.rig.apply(this.keys.get(this.puppetKey())!);
      this.setEye(false);
    } else if (dormant) {
      if (this.pose === 'slumped') this.snapToWall();
      this.mode = 'dormant'; this.state = 'dormant';
      this.rig.apply(this.keys.get(this.poseKey())!);
      this.setEye(false);
      if (this.isWorker) {
        this.setEye(true);
        this.B.eye.scale.setScalar(0.45); this.B.eye2.scale.setScalar(1e-4); this.B.led.scale.setScalar(1e-4);
        this.rig.apply(this.keys.get('stand')!);
        this.workerT = world.rand() * 20;
        this.treadOff = world.rand() * 2;
        this.treadOffNow = this.treadOff;
        if (this.workKind !== 'treadmill') this.props = new WorkerProps(world.ctx, this.workKind);
      } else if (this.idleKind === 'work' && this.pose === 'standing') {
        // working: the sensor is lit, but dim (only the main lens, half size); status LEDs dark
        this.setEye(true);
        this.B.eye.scale.setScalar(0.5); this.B.eye2.scale.setScalar(1e-4); this.B.led.scale.setScalar(1e-4);
        this.workT = world.rand() * this.workDur;
        this.workPose();
      }
    } else if (pose === 'drop') {
      // REVISION 5 emerge 'drop': out of sight above, falls ~4 m after its stagger delay, lands crouched, rises
      this.dropIn = true;
      this.pose = 'rack';
      this.body.position.y += 4;
      this.object.position.copy(this.body.position);
      this.mode = 'dormant'; this.state = 'dormant';
      this.rig.apply(this.keys.get('fall')!);
      this.setEye(false);
      this.holdHidden = true;
      this.wakeDelay = Math.max(0, o.delay ?? 0);
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
  private puppetKey(): string { return POSE_KEY[this.pPose] ?? (HUSK_POSES[this.pPose] ? this.pPose : 'stand'); }

  private setEye(on: boolean): void {
    this.eyeOn = on;
    this.B.eye.scale.setScalar(on ? 1 : 1e-4);
    this.B.eye2.scale.setScalar(on ? 1 : 1e-4);
    this.B.led.scale.setScalar(on ? 1 : 1e-4);
    this.rig.setKeysVisible(EYE_KEYS, on);
  }

  private setMode(m: Mode): void {
    this.mode = m; this.modeTime = 0; this.phase = 0;
    this.setState(m === 'dormant' ? 'dormant' : m === 'idle' || m === 'puppet' ? 'idle' : m === 'wake' || m === 'react' ? 'alert' : m === 'chase' ? 'chase'
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
    if (this.gentle && this.pose === 'slumped') {
      // the tutorial machine lights its sensors one at a time (see tickWake)
      this.eyeFlicker = 0;
      this.B.eye.scale.setScalar(1e-4); this.B.eye2.scale.setScalar(1e-4); this.B.led.scale.setScalar(1e-4);
    }
    this.rage = this.gentle ? 0 : 4;
    if (this.isWorker) {
      // the beat of stillness: it stops dead mid-task (pose captured), the sensor stays dim until the head is round
      this.frozen = this.rig.capture(this.frozen ?? this.rig.newPose());
      this.eyeFlicker = 0;
      this.B.eye.scale.setScalar(0.45); this.B.eye2.scale.setScalar(1e-4); this.B.led.scale.setScalar(1e-4);
      this.props?.drop();
      this.tread = false;
    }
    this.startLoop('husk_loop', 0.8);
    this.world.ctx.events.emit('enemy:woke', { id: this.id, type: this.type, position: this.body.position });
    if (this.dropIn) {
      // straight into the fall (skip the hook thrash)
      this.holdHidden = false;
      this.phase = 1; this.modeTime = 0; this.startBlend(0.2);
      this.body.velocity.set(0, -1, 0); this.body.onGround = false;
      this.eyeFlicker = 0;
    }
    this.addEyeLight();
  }

  private addEyeLight(): void {
    if (!this.light) {
      try {
        this.light = this.world.ctx.render.lights.add({ type: 'point', position: new THREE.Vector3().copy(this.body.position).setY(this.body.position.y + 1.6), color: 0xff2412, intensity: 0.5, distance: 2.6, priority: 0.2 });
        if ((this.gentle && this.pose === 'slumped') || this.isWorker) this.light.intensityScale = 0;
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
    if (this.mode === 'puppet') { this.tickPuppet(dt); return; }
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
    this.tickWhisper(dt);
  }

  /** Broken polite-phrase mutter: awake, near, not attacking; one husk at a time across the level. */
  private tickWhisper(dt: number): void {
    if (!this.alive || this.headGone) return;
    this.whisperTimer -= dt;
    if (this.whisperTimer > 0) return;
    const w = this.world, m = this.mode;
    const busy = m === 'windup' || m === 'strike' || m === 'recover' || m === 'cwindup' || m === 'cstrike' || m === 'crecover' || m === 'wake' || m === 'dying' || m === 'dead';
    if (busy || this.dist > WHISPER_RANGE || !w.playerAlive || w.time < w.whisperUntil) { this.whisperTimer = 0.8 + w.rand() * 1.2; return; }
    this.whisperTimer = WHISPER_MIN + w.rand() * WHISPER_RAND;
    w.whisperUntil = w.time + WHISPER_LEN;
    this.mouth.setFromMatrixPosition(this.B.head.matrixWorld);
    const h = sayMutter(w.ctx, this.mouth, w.rand);
    if (h) { w.whisperUntil = w.time + Math.max(WHISPER_LEN, h.duration + 0.6); this.puppetSpeak(h.duration); return; }
    try { w.ctx.audio.play('husk_whisper', { position: this.mouth }); } catch { /* audio optional */ }
  }

  private dormantTick(dt: number): void {
    if (this.isWorker) { this.workerTick(dt); return; }
    if (this.idleKind === 'watch') { this.watchTick(dt); return; }
    if (this.idleKind === 'work' && this.pose === 'standing') { this.workTick(dt); return; }
    if (this.idleKind === 'twitch') { this.spasmTick(dt); return; }
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
    if (this.isWorker) {
      this.tickWorkerWake(dt, t);
    } else if (this.pose === 'slumped' && this.gentle) {
      this.tickGentleWake(dt, t);
    } else if (this.pose === 'slumped') {
      // eyes ignite → head lifts → pushes up onto a knee → stands
      if (t < 0.75) {
        this.rig.apply(keys.get('slumped')!);
        this.applyWatchHead();
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
    } else if (this.idleKind === 'work') {
      // interrupted at the bench: straightens while the head swivels round (up to 180°) to the player, then the
      // body turns after it
      const want = this.rigYawTo(w.playerPos);
      if (t < 1.0) {
        if (this.phase === 0) { this.phase = 1; this.startBlend(0.8 / this.wakeRate); }
        this.rig.apply(keys.get('stand')!);
        this.headTurn = want * smooth((t - 0.1) / 0.65);
        this.lookW = 0;
      } else {
        if (this.phase === 1) { this.phase = 2; this.startBlend(0.3 / this.wakeRate); this.resetFeet(); }
        const k = smooth((t - 1.0) / 0.75);
        this.B.neck.quaternion.identity(); this.B.head.quaternion.identity();
        face();
        this.moveGround(dt, 0, 0, 0, 10);
        this.locomote(dt);
        this.headTurn = this.rigYawTo(w.playerPos) * (1 - k);
        this.lookW = k;
        if (t > 1.95) { this.headTurn = 0; this.finishWake(); }
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

  /**
   * Tutorial wake (g_junction), ≈3.5 s: fingers flex → head lifts → sensors ignite one at a time → pushes itself
   * up the wall onto a knee → stands.
   */
  private tickGentleWake(dt: number, t: number): void {
    const w = this.world, keys = this.keys, B = this.B;
    if (t < 2.0) {
      this.rig.apply(keys.get('slumped')!);
      this.applyWatchHead();
      // fingers scrape the floor twice, the tool hand turns over
      const f = t < 1.15 ? Math.max(0, Math.sin(t * Math.PI * 1.9)) * smooth(t / 0.15) : 0;
      B.fing_l.quaternion.multiply(_q.setFromAxisAngle(X, -0.9 * f));
      B.fing2_l.quaternion.multiply(_q.setFromAxisAngle(X, -0.8 * f));
      B.hand_r.quaternion.multiply(_q.setFromAxisAngle(Y, 0.5 * smooth((t - 0.4) / 0.5) * (1 - smooth((t - 1.3) / 0.5))));
      this.lookW = smooth((t - 0.85) / 0.95) * 0.9;
      if (t > 1.2 && this.B.eye.scale.x < 0.5 && this.eyeFlicker <= 0) { this.eyeFlicker = 0.4; this.B.eye.scale.setScalar(1); }
      if (t > 1.65) this.B.eye2.scale.setScalar(1);
      if (t > 1.9) this.B.led.scale.setScalar(1);
      if (this.light) this.light.intensityScale = smooth((t - 1.2) / 0.6);
    } else if (t < 2.85) {
      if (this.phase === 0) { this.phase = 1; this.startBlend(0.85 / this.wakeRate); this.emit('enemy:step'); }
      this.rig.apply(keys.get('kneel')!);
      this.lookW = 1;
      if (this.light) this.light.intensityScale = 1;
    } else {
      if (this.phase === 1) { this.phase = 2; this.startBlend(0.75 / this.wakeRate); this.resetFeet(); this.emit('enemy:step'); }
      this.faceToward(w.playerPos.x, w.playerPos.z, 1.8 * dt);
      this.moveGround(dt, 0, 0, 0, 10);
      this.locomote(dt);
      if (t > 3.55) this.finishWake();
    }
  }

  /** Rig-space yaw (full ±π) from the body's facing to a world point. */
  private rigYawTo(pt: THREE.Vector3): number {
    const p = this.body.position, ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    const dx = pt.x - p.x, dz = pt.z - p.z;
    return Math.atan2(dx * c - dz * s, dx * s + dz * c);
  }

  /** The slumped watcher's head offset (on top of a freshly applied key pose). */
  private applyWatchHead(): void {
    const y = this.watchYaw;
    if (Math.abs(y) < 1e-5) return;
    const B = this.B;
    B.neck.quaternion.premultiply(_q.setFromAxisAngle(Y, y * 0.45));
    B.head.quaternion.premultiply(_q.setFromAxisAngle(Y, y * 0.55));
    // turning far round lifts the chin a little
    B.head.quaternion.multiply(_q.setFromAxisAngle(X, -Math.abs(y) * 0.12));
  }

  /** Room id + doorway positions of the room this machine sits in (once). */
  private initRoom(): void {
    const lvl = this.world.ctx.level;
    const r = lvl?.roomAt?.(this.body.position) ?? null;
    this.myRoom = r ? r.id : null;
    this.roomDoors = [];
    if (!r) return;
    this.roomBox = r.bounds.clone();
    const box = r.bounds.clone().expandByScalar(0.8);
    for (const d of lvl.doors ?? []) {
      _v.copy(d.position); _v.y = THREE.MathUtils.clamp(_v.y, r.bounds.min.y + 0.1, r.bounds.max.y - 0.1);
      if (box.containsPoint(_v)) this.roomDoors.push(d.position.clone());
    }
  }

  /**
   * Dormant 'watch': slumped, head down, the head creeps after the player a few degrees a second in small servo
   * ticks; holds dead still while the player stares at it from close; catches up (fast) whenever unobserved;
   * while the player is out of the room it turns toward the doorway nearest to them. Eyes stay off.
   */
  private watchTick(dt: number): void {
    const w = this.world, p = this.body.position, ctx = w.ctx, B = this.B;
    this.watchT -= dt;
    if (this.watchT <= 0) {
      this.watchT = 0.2 + w.rand() * 0.05;
      if (this.myRoom === undefined) this.initRoom();
      const pr = this.myRoom ? ctx.level?.roomAt?.(w.playerPos) : null;
      const inRoom = !this.myRoom || (pr !== null && pr !== undefined && pr.id === this.myRoom);
      const doors = this.roomDoors, box = this.roomBox;
      if (inRoom || !box) this.watchTgt.copy(w.playerEye);
      else {
        // the way they will come back in: the point of this room's outline nearest to them, snapped to a doorway
        // when one is close (open archways have no door object — the outline point covers those)
        box.clampPoint(w.playerPos, this.watchTgt);
        let bd = 2.5 * 2.5;
        if (doors) for (let i = 0; i < doors.length; i++) {
          const dx = doors[i].x - this.watchTgt.x, dz = doors[i].z - this.watchTgt.z, d = dx * dx + dz * dz;
          if (d < bd) { bd = d; this.watchTgt.copy(doors[i]); }
        }
        this.watchTgt.y = p.y + 1.6;
      }
      // is the player looking at it?
      _v.setFromMatrixPosition(B.head.matrixWorld);
      _v2.copy(_v).sub(w.playerEye);
      const d = _v2.length();
      const f = ctx.player?.forward;
      const dot = f && d > 1e-3 ? f.dot(_v2) / d : -1;
      const seen = inRoom && w.playerAlive && dot > 0.8 && ctx.physics.lineOfSight(w.playerEye, _v);
      const stared = seen && d < WATCH_STARE && dot > 0.96;
      this.watchRate = stared ? 0 : seen ? WATCH_CREEP : WATCH_CATCHUP;
    }
    const want = THREE.MathUtils.clamp(this.rigYawTo(this.watchTgt), -WATCH_MAX, WATCH_MAX);
    const err = want - this.watchYaw;
    let step = 0;
    if (this.watchRate >= WATCH_CATCHUP) step = Math.sign(err) * Math.min(Math.abs(err), this.watchRate * dt * Math.min(1, Math.abs(err) * 3 + 0.2));
    else if (this.watchRate > 0) {
      // creeping: discrete servo ticks (~0.7° each) rather than a glide
      this.workT += this.watchRate * dt;
      if (this.workT >= 0.7 * D2R && Math.abs(err) > 0.5 * D2R) { step = Math.sign(err) * Math.min(Math.abs(err), this.workT); this.workT = 0; }
    }
    this.watchYaw += step;
    // rare finger twitch
    this.fingerTimer -= dt;
    if (this.fingerTimer <= 0) { this.fingerTimer = 25 + w.rand() * 30; this.fingerT = 0.5; }
    let fk = 0;
    if (this.fingerT > 0) { this.fingerT -= dt; fk = this.fingerT > 0 ? Math.sin(Math.PI * (1 - this.fingerT / 0.5)) : 0; }
    if (step === 0 && fk === 0 && this.fingerT <= 0 && !this.watchDirty) return;
    this.watchDirty = this.fingerT > 0;
    this.rig.apply(this.keys.get('slumped')!);
    this.applyWatchHead();
    if (fk > 0) {
      B.fing_l.quaternion.multiply(_q.setFromAxisAngle(X, -1.0 * fk));
      B.fing2_l.quaternion.multiply(_q.setFromAxisAngle(X, -0.7 * fk));
    }
    this.finishPose();
  }

  /** Dormant 'work': slow, precise, slightly wrong assembly loop at a bench; freezes while the player is near. */
  private workTick(dt: number): void {
    const w = this.world, p = this.body.position;
    const d = Math.hypot(w.playerPos.x - p.x, w.playerPos.z - p.z, (w.playerPos.y - p.y) * 0.5);
    if (!this.workFrozen && d < WORK_FREEZE && w.playerAlive) this.workFrozen = true;
    else if (this.workFrozen && (d > WORK_RESUME || !w.playerAlive)) this.workFrozen = false;
    if (this.workFrozen) return; // stopped dead, mid-motion
    this.workT += dt;
    if (this.workT >= this.workDur) { this.workT -= this.workDur; this.twKind++; }
    this.workPose();
    this.finishPose();
  }

  private workPose(): void {
    const B = this.B, u = this.workT / this.workDur, cyc = this.twKind;
    const seg = (a: number, b: number) => smooth((u - a) / (b - a));
    this.rig.apply(this.keys.get('bent')!);
    const reach = seg(0, 0.17) * (1 - seg(0.22, 0.34));
    const place = seg(0.22, 0.34) * (1 - seg(0.62, 0.8));
    const press = seg(0.4, 0.49) * (1 - seg(0.57, 0.68));
    // the wrong bit: after every press the tool hand taps again, twice, a little short (a loop that does not end)
    const tap = u > 0.69 && u < 0.79 ? Math.max(0, Math.sin((u - 0.69) / 0.1 * Math.PI * 4)) * 0.35 : 0;
    // each cycle the part goes down a few millimetres somewhere else
    const jit = noise1(cyc * 1.37, this.seed) * 0.5;
    const dpL = (-40 * reach - 12 * place - jit * 4 * place) * D2R, rollL = (9 * reach - 8 * place) * D2R;
    B.uarm_l.quaternion.multiply(_q.setFromEuler(_e.set(dpL, 0, rollL)));
    B.larm_l.quaternion.setFromAxisAngle(X, -(38 - 22 * reach + 14 * place) * D2R);
    B.hand_l.quaternion.multiply(_q.setFromAxisAngle(X, (-22 * place + 10 * reach) * D2R));
    const g = place * (1 - seg(0.5, 0.62));
    B.fing_l.quaternion.multiply(_q.setFromAxisAngle(X, -0.6 * reach + 0.5 * g));
    const pr = press + tap;
    B.uarm_r.quaternion.multiply(_q.setFromEuler(_e.set(7 * pr * D2R, 0, 0)));
    B.larm_r.quaternion.setFromAxisAngle(X, -(62 - 24 * pr) * D2R);
    // the tool hand screws round while pressing
    const spin = seg(0.42, 0.6) * Math.PI * 3 + tap * 0.8;
    B.hand_r.quaternion.multiply(_q.setFromAxisAngle(Y, spin));
    B.spine1.quaternion.multiply(_q.setFromEuler(_e.set(4 * press * D2R, 7 * reach * D2R, 0)));
    // head follows the left hand, then the press; in the pause it cocks sideways with a snap
    const cock = seg(0.81, 0.83) * (1 - seg(0.96, 1.0));
    B.head.quaternion.multiply(_q.setFromEuler(_e.set((5 * press - 4 * reach) * D2R, (14 * reach - 5 * press) * D2R, 9 * cock * D2R)));
  }

  /** Dormant 'twitch': rare small spasms (rack: a foot kicks / the head rolls; floor: a hand closes / head jerk). */
  private spasmTick(dt: number): void {
    const w = this.world, B = this.B;
    if (this.twT < 0) {
      this.dormantTwitch -= dt;
      if (this.dormantTwitch > 0) return;
      this.twT = 0;
      this.twKind = w.rand() < 0.55 ? 0 : 1;
      this.twDur = this.pose === 'rack' ? (this.twKind === 0 ? 0.8 : 1.7) : (this.twKind === 0 ? 2.2 : 0.6);
    }
    this.twT += dt;
    const u = Math.min(1, this.twT / this.twDur);
    this.rig.apply(this.keys.get(this.poseKey())!);
    if (this.pose === 'rack') {
      if (this.twKind === 0) {
        const k = u < 0.14 ? smooth(u / 0.14) : 1 - smooth((u - 0.14) / 0.86);
        const sfx = this.id % 2 === 0 ? 'l' : 'r';
        B['thigh_' + sfx].quaternion.multiply(_q.setFromAxisAngle(X, -0.75 * k));
        B['shin_' + sfx].quaternion.multiply(_q.setFromAxisAngle(X, 0.9 * k));
        B['foot_' + sfx].quaternion.multiply(_q.setFromAxisAngle(X, -0.4 * k));
      } else {
        const k = Math.sin(Math.PI * u);
        B.head.quaternion.multiply(_q.setFromEuler(_e.set(-0.2 * k, 0.15 * k, 0.55 * k)));
        B.neck.quaternion.multiply(_q.setFromEuler(_e.set(0, 0, 0.2 * k)));
      }
    } else if (this.twKind === 0) {
      const k = u < 0.2 ? smooth(u / 0.2) : u < 0.6 ? 1 : 1 - smooth((u - 0.6) / 0.4);
      B.fing_l.quaternion.multiply(_q.setFromAxisAngle(X, -1.15 * k));
      B.fing2_l.quaternion.multiply(_q.setFromAxisAngle(X, -0.9 * k));
      B.hand_l.quaternion.multiply(_q.setFromAxisAngle(X, 0.25 * k));
    } else {
      const k = Math.sin(u * Math.PI * 5) * (1 - u);
      B.head.quaternion.multiply(_q.setFromEuler(_e.set(0.08 * k, 0.22 * k, 0)));
    }
    if (u >= 1) { this.twT = -1; this.dormantTwitch = 8 + w.rand() * 12; this.rig.apply(this.keys.get(this.poseKey())!); }
    this.finishPose();
  }

  // ───────────────────────────────────────────────────────── REVISION 4: worker (stealth)

  /** Dormant 'worker': keeps doing its task, ignores the player; provoked by proximity / flashlight (here), gunfire (manager), damage. */
  private workerTick(dt: number): void {
    const w = this.world, p = this.body.position;
    this.workerT += dt;
    this.dist = Math.hypot(w.playerPos.x - p.x, w.playerPos.z - p.z, (w.playerPos.y - p.y) * 0.6);
    const hd = Math.hypot(w.playerPos.x - p.x, w.playerPos.z - p.z);
    if (w.playerAlive && hd < 2.2 && Math.abs(w.playerPos.y - p.y) < 1.8) { w.provoke(this.group, this); return; }
    this.provokeT -= dt;
    if (this.provokeT <= 0) {
      this.provokeT = 0.15;
      const pl = w.ctx.player;
      let lit = false;
      if (w.playerAlive && pl && pl.flashlightOn && this.dist < 16) {
        _v.setFromMatrixPosition(this.B.head.matrixWorld);
        _v2.copy(_v).sub(w.playerEye);
        const d = _v2.length();
        if (d > 0.01 && pl.forward.dot(_v2) / d > WORKER_LIT_COS && w.ctx.physics.lineOfSight(w.playerEye, _v)) lit = true;
      }
      this.litT = lit ? this.litT + 0.15 : Math.max(0, this.litT - 0.075);
      if (this.litT >= WORKER_LIT_TIME) { w.provoke(this.group, this); return; }
    }
    const show = this.object.visible;
    this.props?.setVisible(show);
    // locomote() drives hips/spine/arms/legs; the neck + head are layered on fresh each frame
    this.B.neck.quaternion.identity(); this.B.head.quaternion.setFromAxisAngle(X, 4 * D2R);
    if (this.workKind === 'polish') this.polishTick(dt, show);
    else if (this.workKind === 'fold') this.foldTick(dt, show);
    else this.treadTick(dt, show);
    this.tickWhisper(dt);
  }

  /** Rig space → world. */
  private toWorld(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.body.position, ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    return out.set(p.x + x * c + z * s, p.y + y, p.z - x * s + z * c);
  }

  /** Both hands to world targets (left / right) with world-space arm IK; `out` elbows pointing out + down. */
  private handsTo(L: THREE.Vector3 | null, R: THREE.Vector3 | null, elbowDown = 0.6, elbowBack = 0.4): void {
    const B = this.B, ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
    this.object.position.copy(this.body.position);
    this.object.rotation.y = ry;
    this.object.updateMatrixWorld(true);
    _fw.set(s, 0, c); _lf.set(c, 0, -s);
    for (let i = 0; i < 2; i++) {
      const T = i === 0 ? L : R;
      if (!T) continue;
      const side = i === 0 ? 1 : -1, sfx = i === 0 ? 'l' : 'r';
      const uarm = B['uarm_' + sfx];
      _S.setFromMatrixPosition(uarm.matrixWorld);
      _q2.setFromRotationMatrix(uarm.parent!.matrixWorld);
      _v3.copy(_lf).multiplyScalar(side * 0.7).addScaledVector(_fw, -elbowBack).addScaledVector(Y, -elbowDown);
      const bend = armIK(_S, T, _v3, K.uarm, K.larm + 0.06, _q2, uarm);
      B['larm_' + sfx].quaternion.setFromAxisAngle(X, -bend);
    }
  }

  /** Pushes the rotary polisher up and down a short strip, swinging the disc side to side. */
  private polishTick(dt: number, show: boolean): void {
    const w = this.world, p = this.body.position, B = this.B, pr = this.props!;
    const T = 12, u = (this.workerT % T) / T;
    const s = u < 0.44 ? -0.75 + 1.5 * smooth(u / 0.44) : u < 0.5 ? 0.75 : u < 0.94 ? 0.75 - 1.5 * smooth((u - 0.5) / 0.44) : -0.75;
    const ry = this.yaw + Math.PI, fx = Math.sin(ry), fz = Math.cos(ry);
    const nx = this.home.x + fx * s, nz = this.home.z + fz * s;
    const v = this.body.velocity;
    if (dt > 0) { v.set((nx - p.x) / dt, 0, (nz - p.z) / dt); }
    p.x = nx; p.z = nz;
    const floorY = this.home.y;
    const sweep = Math.sin(this.workerT * Math.PI * 2 / 2.7) * 0.34 + noise1(this.workerT * 0.3, this.seed) * 0.06;
    const near = this.dist < 22;
    pr.sound(near, near ? this.toWorld(0, 0.2, 0.9, _v) : null);
    if (!show) { pr.placePolisher(this.toWorld(0, 0, 0.3, _v), ry, sweep, floorY, dt, true); return; }
    this.locomote(dt);
    // leans into the handle; head down watching the floor ahead
    B.spine1.quaternion.multiply(_q.setFromEuler(_e.set(0.1, sweep * 0.25, 0)));
    B.spine2.quaternion.multiply(_q.setFromEuler(_e.set(0.1, sweep * 0.35, 0)));
    this.toWorld(0, floorY - p.y + 0.96, 0.31, _v);
    _v.y = floorY + 0.96;
    pr.placePolisher(_v, ry, sweep, floorY, dt, true);
    pr.grip(1, _T); pr.grip(-1, _v2);
    this.handsTo(_T, _v2, 0.7, 0.5);
    B.neck.quaternion.multiply(_q.setFromEuler(_e.set(0.25, -sweep * 0.4, 0)));
    B.head.quaternion.multiply(_q.setFromEuler(_e.set(0.32, -sweep * 0.3, noise1(this.workerT * 0.7, this.seed + 3) * 0.06)));
    this.finishPose(dt);
  }

  /** Folding coveralls at a shelf in front (top ≈ 1.0 m): pick from the left pile, shake out, fold, fold, pat, place right. */
  private foldTick(dt: number, show: boolean): void {
    const B = this.B, pr = this.props!, w = this.world;
    const T = 8.5, cyc = Math.floor(this.workerT / T), u = (this.workerT % T) / T;
    if (!show) return;
    this.body.velocity.set(0, 0, 0);
    this.locomote(dt);
    // keys: u, L (x,y,z), R (x,y,z), sheet length (-1 = block)
    const KEYS = FOLD_KEYS;
    let k = 0;
    while (k < KEYS.length - 2 && u >= KEYS[k + 1][0]) k++;
    const a = KEYS[k], b = KEYS[k + 1];
    const f = smooth((u - a[0]) / (b[0] - a[0]));
    const lerp = (i: number) => a[i] + (b[i] - a[i]) * f;
    const jit = noise1(cyc * 1.7, this.seed) * 0.03;
    let Ly = lerp(2), Ry = lerp(5);
    // pats on the folded block
    if (u > 0.58 && u < 0.68) { const pat = Math.max(0, Math.sin((u - 0.58) / 0.1 * Math.PI * 3)) * 0.05; Ly += pat; Ry += pat; }
    // the wrong bit: the right hand straightens the pile edge twice, then once more
    if (u > 0.88 && u < 0.98) Ry += Math.max(0, Math.sin((u - 0.88) / 0.1 * Math.PI * 3)) * 0.04;
    this.toWorld(lerp(1) + jit, Ly, lerp(3), _T);
    this.toWorld(lerp(4) + jit, Ry, lerp(6), _v2);
    // torso turns toward the work, bends to reach low
    const mx = (lerp(1) + lerp(4)) * 0.5, my = (Ly + Ry) * 0.5;
    B.spine1.quaternion.multiply(_q.setFromEuler(_e.set(0.1 + (1.25 - my) * 0.35, mx * 0.55, 0)));
    B.spine2.quaternion.multiply(_q.setFromEuler(_e.set(0.06 + (1.25 - my) * 0.25, mx * 0.45, 0)));
    this.handsTo(_T, _v2, 0.8, 0.3);
    // hands: palms in, fingers gripping while holding cloth
    const holding = u > 0.08 && u < 0.8;
    B.fing_l.quaternion.setFromEuler(_e.set(holding ? -1.0 : -0.3, 0, 0));
    B.fing2_l.quaternion.setFromEuler(_e.set(holding ? -1.2 : -0.35, 0, 0));
    B.neck.quaternion.multiply(_q.setFromEuler(_e.set(0.3, mx * 0.5, 0)));
    B.head.quaternion.multiply(_q.setFromEuler(_e.set(0.28 + (1.2 - my) * 0.2, mx * 0.4, u > 0.9 ? 0.15 * smooth((u - 0.9) / 0.03) : 0)));
    this.finishPose(dt);
    // cloth
    const len = lerp(7);
    const ry = this.yaw + Math.PI;
    if (len < -0.5) {
      // folded block: between the hands while carried, left on the pile after release
      if (u < 0.84) { _v.copy(_T).add(_v2).multiplyScalar(0.5); _v.y = Math.max(_v.y - 0.06, this.body.position.y + 1.0); pr.block(_v, ry); }
    } else if (len > 0.01 || u < 0.1) {
      if (u < 0.1) pr.hideCloth();
      else {
        _v.setFromMatrixPosition(B.hand_l.matrixWorld); _v.y -= 0.08;
        _v3.setFromMatrixPosition(B.hand_r.matrixWorld); _v3.y -= 0.1;
        pr.sheet(_v, _v3, len, u > 0.24 && u < 0.36 ? 1 : 0.25, w.time, _fw.set(Math.sin(ry), 0, Math.cos(ry)));
      }
    }
  }

  /** Walking a treadmill: the body stays put, the feet run the belt (see treadFoot), a clearly human gait. */
  private treadTick(dt: number, show: boolean): void {
    const w = this.world;
    this.tread = true;
    this.treadSpeed = TREAD_SPEED;
    const sync = w.time < w.treadSyncUntil;
    const target = sync ? Math.round(this.treadOffNow) : this.treadOff + Math.round(this.treadOffNow - this.treadOff);
    this.treadOffNow = damp(this.treadOffNow, target, sync ? 4 : 0.6, dt);
    const ph = w.time / TREAD_CYCLE + this.treadOffNow;
    const prev = this.treadPhase;
    this.treadPhase = ph;
    // heel strikes
    if (this.dist < 25 && (Math.floor(prev * 2) !== Math.floor(ph * 2))) this.emit('enemy:step');
    if (!show) return;
    this.body.velocity.set(0, 0, 0);
    this.locomote(dt);
    this.B.head.quaternion.multiply(_q.setFromEuler(_e.set(0.06 + noise1(w.time * 0.2, this.seed) * 0.05, noise1(w.time * 0.13, this.seed + 8) * 0.1, 0)));
    this.finishPose(dt);
  }

  /** One foot on the treadmill belt: planted feet travel back at belt speed, the swing comes through forward. */
  private treadFoot(f: Foot, i: number): void {
    const ps = this.treadPhase + (i === 0 ? 0 : 0.5);
    const psi = ps - Math.floor(ps);
    const half = TREAD_SPEED * TREAD_CYCLE * TREAD_STANCE * 0.5;
    let z: number, y = 0;
    if (psi < TREAD_STANCE) { f.t = 1; z = half - (psi / TREAD_STANCE) * 2 * half; }
    else {
      const s = (psi - TREAD_STANCE) / (1 - TREAD_STANCE);
      f.t = Math.min(0.999, s);
      z = -half + 2 * half * smooth(s);
      y = Math.sin(Math.PI * s) * 0.075;
    }
    f.yaw = this.yaw + Math.PI;
    f.rig.set(f.side * 0.1, y, z + 0.03);
  }

  override provoked(delay: number): void {
    if (!this.alive || this.awake) return;
    this.wakeDelay = this.wakeDelay >= 0 ? Math.min(this.wakeDelay, delay) : Math.max(0, delay);
  }

  /** Provoked worker: frozen mid-motion → the head comes round in servo ticks → eyes flare → it turns and comes. */
  private tickWorkerWake(dt: number, t: number): void {
    const w = this.world, still = this.stillDur, turn = 0.95, hold = 0.35, t1 = still + turn + hold;
    if (t < t1) {
      if (this.frozen) this.rig.apply(this.frozen);
      const want = this.rigYawTo(w.playerPos);
      const k = smooth((t - still) / turn);
      const step = 6 * D2R;
      this.headTurn = Math.round((want * k) / step) * step;
      this.lookW = 0;
      if (t > still + turn && this.B.eye.scale.x < 0.9) {
        this.eyeFlicker = 0.3; this.B.eye.scale.setScalar(1); this.B.eye2.scale.setScalar(1); this.B.led.scale.setScalar(1);
        if (this.light) this.light.intensityScale = 1;
      }
      this.props?.tickDrop(dt, this.home.y);
    } else {
      if (this.phase === 0) { this.phase = 1; this.startBlend(0.55); this.resetFeet(); }
      this.rig.apply(this.keys.get('stand')!);
      this.faceToward(w.playerPos.x, w.playerPos.z, 2.6 * dt);
      this.moveGround(dt, 0, 0, 0, 10);
      this.locomote(dt);
      const k = smooth((t - t1) / 0.6);
      this.headTurn = this.rigYawTo(w.playerPos) * (1 - k);
      this.lookW = k;
      this.props?.tickDrop(dt, this.home.y);
      if (t > t1 + 0.75) { this.headTurn = 0; this.gait = ''; this.finishWake(); }
    }
  }

  // ───────────────────────────────────────────────────────── REVISION 4: puppet gait + speech

  override puppetGait(gait: string): void {
    const g = gait === 'limp' || gait === 'carry' || gait === 'carry_l' || gait === 'carry_r' || gait === 'human' || gait === 'lead' || gait === 'push' ? gait : '';
    this.gait = g;
    this.carrySide = g === 'carry_l' ? 1 : g === 'carry_r' ? -1 : 0;
  }

  override puppetSpeak(seconds: number): void {
    this.speakT = Math.max(this.speakT, seconds);
    this.speakDur = this.speakT;
  }

  /** 'carry': one arm held out to the side at shoulder height, gently — leading someone by the arm. */
  private carryArm(): void {
    if (this.gait === 'lead' || this.gait === 'push') { this.fileArms(); return; }
    if (this.gait !== 'carry' && this.gait !== 'carry_l' && this.gait !== 'carry_r') return;
    let side = this.carrySide;
    if (side === 0) {
      // toward the nearest human puppet, if one is close
      side = 1;
      const p = this.body.position, ry = this.yaw + Math.PI, c = Math.cos(ry), s = Math.sin(ry);
      let bd = 3 * 3;
      for (const a of this.world.actors) {
        if ((a.type as string) !== 'human') continue;
        const dx = a.position.x - p.x, dz = a.position.z - p.z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; side = dx * c - dz * s >= 0 ? 1 : -1; }
      }
    }
    const B = this.B, sfx = side > 0 ? 'l' : 'r', t = this.world.time;
    const sway = noise1(t * 0.8, this.seed + 33) * 0.05;
    B['uarm_' + sfx].quaternion.setFromEuler(_e.set(-0.42 + sway, 0.2 * side, (1.28 + sway) * side, 'XYZ'));
    B['larm_' + sfx].quaternion.setFromEuler(_e.set(-0.32, 0, 0));
    B['hand_' + sfx].quaternion.setFromEuler(_e.set(-0.1, 0.5 * side, 0));
    if (side > 0) { B.fing_l.quaternion.setFromEuler(_e.set(-0.85, 0, 0)); B.fing2_l.quaternion.setFromEuler(_e.set(-1.0, 0, 0)); }
    // the other arm hangs quiet
    const o = side > 0 ? 'r' : 'l';
    B['uarm_' + o].quaternion.slerp(_q.setFromEuler(_e.set(0.05, 0, 0.12 * -side, 'XYZ')), 0.6);
  }

  /**
   * REVISION 5 single file through a door: 'lead' walks in front of the human and holds his left wrist behind it with
   * its right hand; 'push' walks behind him, left hand clamped on his right upper arm, right hand on his shoulder blade.
   * Hands go to his actual grip points (world-space arm IK) when he is within reach, otherwise a plausible FK hold.
   */
  private fileArms(): void {
    const B = this.B, p = this.body.position, t = this.world.time;
    type Grip = { gripPoint?(part: string, out: THREE.Vector3): THREE.Vector3 };
    let man = null as Grip | null;
    let bd = 2.2 * 2.2;
    for (const a of this.world.actors) {
      if ((a.type as string) !== 'human') continue;
      const dx = a.position.x - p.x, dz = a.position.z - p.z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; man = a as unknown as Grip; }
    }
    const sway = noise1(t * 0.8, this.seed + 33) * 0.04;
    if (this.gait === 'lead') {
      if (man?.gripPoint) {
        man.gripPoint('wrist_l', _T);
        this.handsTo(null, _T, 0.3, -0.6);
      } else {
        B.uarm_r.quaternion.setFromEuler(_e.set(0.55 + sway, 0, -0.22, 'XYZ'));
        B.larm_r.quaternion.setFromEuler(_e.set(-0.15, 0, 0));
      }
      B.hand_r.quaternion.multiply(_q.setFromEuler(_e.set(0.2, 0, 0)));
      B.uarm_l.quaternion.slerp(_q.setFromEuler(_e.set(0.05, 0, 0.1, 'XYZ')), 0.5);
    } else {
      if (man?.gripPoint) {
        man.gripPoint('uarm_r', _T);
        man.gripPoint('back', _v2);
        this.handsTo(_T, _v2, 0.65, 0.35);
      } else {
        B.uarm_l.quaternion.setFromEuler(_e.set(-0.95 + sway, 0, 0.1, 'XYZ'));
        B.larm_l.quaternion.setFromEuler(_e.set(-0.55, 0, 0));
        B.uarm_r.quaternion.setFromEuler(_e.set(-0.9 - sway, 0, -0.12, 'XYZ'));
        B.larm_r.quaternion.setFromEuler(_e.set(-0.6, 0, 0));
      }
      B.fing_l.quaternion.setFromEuler(_e.set(-0.9, 0, 0)); B.fing2_l.quaternion.setFromEuler(_e.set(-1.05, 0, 0));
    }
  }

  // ───────────────────────────────────────────────────────── puppet (EnemyManager.actor)

  private tickPuppet(dt: number): void {
    const w = this.world, p = this.body.position, v = this.body.velocity, B = this.B;
    const treadIn = !this.pMoving && this.pPose === 'tread';
    this.tread = treadIn;
    if (treadIn) {
      // walking in place, perfectly looping (reference pattern / ghost on the rig)
      this.treadSpeed = TREAD_SPEED;
      const ph = w.time / TREAD_CYCLE + (this.seed % 1);
      if (Math.floor(this.treadPhase * 2) !== Math.floor(ph * 2) && this.dist < 25) this.emit('enemy:step');
      this.treadPhase = ph;
      v.set(0, 0, 0);
    }
    const loco = this.pMoving || this.pPose === 'idle' || treadIn;
    if (this.pMoving) {
      const dx = this.pTarget.x - p.x, dz = this.pTarget.z - p.z, d = Math.hypot(dx, dz);
      this.pStuck += dt;
      if (this.pStuck > 1.5) { const prog = this.pLastD - d; this.pStuck = 0; this.pLastD = d; if (prog < 0.08) { this.arrive(); } }
      if (this.pMoving && (d < 0.18 || (d < 0.6 && v.x * dx + v.z * dz < 0))) this.arrive();
      if (this.pMoving) {
        let speed = this.pSpeed;
        if (this.gait === 'limp') {
          // step (good leg hurries) – drag (the bad one scrapes through slowly) – step
          const goodSw = this.feet[0].t < 1, badSw = this.feet[1].t < 1;
          speed *= badSw ? 0.42 : goodSw ? 1.3 : 0.8;
        }
        if (speed < 2.5 && this.gait !== 'carry' && this.gait !== 'carry_l' && this.gait !== 'carry_r' && this.gait !== 'human') {
          // the walk has the same stiff micro-freezes as the real thing
          this.hitchTimer -= dt;
          if (this.hitchTimer <= 0) { this.hitchTimer = 1.8 + w.rand() * 3.5; this.hitch = 0.1 + w.rand() * 0.16; this.headRoll.v += (w.rand() - 0.5) * 16; }
          if (this.hitch > 0) { this.hitch -= dt; speed = 0; }
        }
        const rem = this.faceToward(this.pTarget.x, this.pTarget.z, (speed > 2.5 ? 5.5 : 3.2) * dt);
        const al = Math.max(0, Math.cos(rem));
        speed = Math.min(speed * al * al, d * 2.2 + 0.2);
        const ry = this.yaw + Math.PI, k = Math.min(1, (this.pSpeed > 2.5 ? 9 : 6) * dt);
        v.x += (Math.sin(ry) * speed - v.x) * k; v.z += (Math.cos(ry) * speed - v.z) * k;
      }
    }
    if (!this.pMoving) { const k = Math.exp(-8 * dt); v.x *= k; v.z *= k; }
    v.y = 0;
    if (loco) {
      p.x += v.x * dt; p.z += v.z * dt;
      if (v.x * v.x + v.z * v.z > 1e-4) { const g = this.groundAt(p.x, p.y + 0.6, p.z, 1.6); if (g !== null) p.y = g; }
      if (!this.lookPt) {
        const k = 1 - Math.exp(-2.5 * dt);
        B.neck.quaternion.slerp(_qi, k); B.head.quaternion.slerp(_qi, k);
      }
      this.locomote(dt);
      this.carryArm();
    } else {
      this.rig.apply(this.keys.get(this.puppetKey())!);
    }
    this.lookW = damp(this.lookW, this.lookPt ? 1 : 0, 5, dt);
    this.finishPose(dt);
    if (this.holo) this.holo.update(dt);
  }

  private arrive(): void {
    this.pMoving = false;
    const d = this.pDone; this.pDone = null;
    if (d) d();
  }

  override puppetMove(point: THREE.Vector3, speed: number | undefined, done: () => void): void {
    if (this.pDone) this.arrive();
    this.pTarget.copy(point);
    this.pSpeed = THREE.MathUtils.clamp(speed ?? WALK, 0.3, RUN);
    this.pMoving = true; this.pDone = done;
    this.pStuck = 0; this.pLastD = 1e9;
    if (this.pPose !== 'idle') { this.startBlend(this.pPose === 'tread' ? 0.3 : 0.5); this.pPose = 'idle'; this.tread = false; this.resetFeet(); this.hipsY = this.B.hips.position.y; }
  }

  override puppetPose(pose: string): void {
    const n = pose === 'idle' || pose === 'tread' || POSE_KEY[pose] || HUSK_POSES[pose] ? pose : 'idle';
    if (this.pMoving && n !== 'idle') this.arrive();
    if (n === this.pPose) return;
    this.startBlend(0.5);
    const wasTread = this.pPose === 'tread';
    this.pPose = n;
    if (wasTread) this.tread = false;
    if (n === 'idle') { this.resetFeet(); this.hipsY = this.B.hips.position.y; }
  }

  override puppetLook(point: THREE.Vector3 | null): void {
    if (point) { this.lookBuf.copy(point); this.lookPt = this.lookBuf; } else this.lookPt = null;
  }

  override puppetEyes(on: boolean): void {
    this.setEye(on);
    if (on) this.eyeFlicker = 0.3;
  }

  override puppetStop(): void { if (this.pDone) this.arrive(); this.pMoving = false; }

  /**
   * REVISION 5: this puppet becomes a live hostile machine of `group` in place — same instance, rig, feet, velocity
   * and gait phase, so nothing jumps. The caller (manager) moves it from `actors` to `all`.
   */
  promoteTo(group: string): void {
    (this as unknown as { group: string }).group = group;
    const wasMoving = this.pMoving;
    this.puppetStop();
    this.isActor = false;
    this.mode = 'puppet'; // so setMode below always runs its bookkeeping
    this.awake = true; this.wakeDelay = -1;
    this.pose = ''; this.tread = false;
    this.lookPt = null;
    this.body.gravityScale = 1;
    if (!this.eyeOn) { this.setEye(true); this.eyeFlicker = 0.3; }
    this.addEyeLight();
    this.startLoop('husk_loop', 0.8);
    // a static pose (or a carry arm) eases into its own walk; a walking puppet just keeps walking
    if (this.pPose !== 'idle' && this.pPose !== 'tread') { this.startBlend(0.5); this.resetFeet(); }
    else if (this.gait === 'carry' || this.gait === 'carry_l' || this.gait === 'carry_r' || this.gait === 'lead' || this.gait === 'push') this.startBlend(0.45);
    this.hipsY = this.B.hips.position.y;
    this.gait = '';
    this.running = false; this.rage = 0; this.hitch = 0; this.lurch = 0;
    this.directTimer = 0; this.replanTimer = 0;
    this.setMode('chase');
    if (!wasMoving) this.lurch = 0.15;
    this.roomTagAt = -1;
    this.emit('enemy:spawned');
    this.emit('enemy:woke');
    this.emit('enemy:alerted');
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
    const wantRun = !this.gentle && (this.rage > 0 || this.health < HP * 0.6 || (this.dist < 7.5 && this.seesPlayer));
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
      const wind = this.gentle ? GENTLE_WINDUP : WINDUP;
      this.atkWind = smooth(this.modeTime / (wind - 0.12));
      this.atkStrike = 0;
      this.faceToward(w.playerPos.x, w.playerPos.z, 2.6 * dt);
      this.moveGround(dt, 0, 0, 0, 12);
      if (this.modeTime >= wind) { this.setMode('strike'); this.body.velocity.x += Math.sin(ry) * 3.2; this.body.velocity.z += Math.cos(ry) * 3.2; }
    } else if (this.mode === 'strike') {
      this.atkStrike = Math.min(1, this.modeTime / 0.11);
      this.moveGround(dt, 0, 0, 0, 5);
      if (!this.struck && this.modeTime >= 0.07) {
        this.struck = true;
        const dx = w.playerPos.x - p.x, dz = w.playerPos.z - p.z;
        const hd = Math.hypot(dx, dz);
        const ang = Math.abs(angleDiff(Math.atan2(-dx, -dz), this.yaw));
        if (w.playerAlive && hd < 1.95 && ang < 1.0 && Math.abs(w.playerPos.y - p.y) < 1.5) {
          w.ctx.player.damage(this.atkArm === 0 ? 10 : this.gentle ? GENTLE_MELEE : MELEE, p);
        }
      }
      if (this.modeTime >= 0.2) this.setMode('recover');
    } else {
      this.atkWind = 1 - smooth(this.modeTime / 0.5);
      this.atkStrike = 1 - smooth(this.modeTime / 0.45);
      this.moveGround(dt, 0, 0, 0, 8);
      if (this.modeTime >= (this.gentle ? GENTLE_RECOVER : 0.55)) { this.atkWind = 0; this.atkStrike = 0; this.goChase(); }
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
    const speed = this.tread ? this.treadSpeed : Math.hypot(v.x, v.z);
    const limpG = this.gait === 'limp';
    this.runBlend = damp(this.runBlend, smooth((speed - 1.8) / 1.6), 9, dt);
    const rb = this.runBlend;
    const moving = speed > 0.12;
    const vx = moving ? v.x / speed : 0, vz = moving ? v.z / speed : 0;
    const feet = this.feet;

    for (let i = 0; i < 2; i++) {
      const f = feet[i], o = feet[1 - i];
      if (this.tread) { this.treadFoot(f, i); continue; }
      const bad = limpG ? f.side === -1 : f.side === this.limp;
      const dur = (0.4 - 0.17 * rb) * (bad ? (limpG ? 1.85 : 1.22) : (limpG ? 0.78 : 1)) / (1 + (this.mode === 'stagger' ? 0.6 : 0));
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
          f.lift = limpG && bad ? 0.004 : 0.05 + 0.1 * rb + (bad ? -0.02 : 0.015) + Math.min(0.05, err * 0.1);
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
      // Okafor's drag: the stiff leg swings out round the side, toe scraping the floor
      if (limpG && bad && f.t < 1) f.rig.x += f.side * 0.07 * Math.sin(Math.PI * f.t);
    }

    const L = feet[0], R = feet[1];
    const swL = L.t < 1 ? Math.sin(Math.PI * L.t) : 0, swR = R.t < 1 ? Math.sin(Math.PI * R.t) : 0;
    const stride = THREE.MathUtils.clamp(L.rig.z - R.rig.z, -1.2, 1.2);
    const t = w.time;
    const idle = 1 - Math.min(1, speed / 0.5);
    const breathe = Math.sin(t * 1.3 + this.seed) * 0.004 * idle;
    let limpDip = this.limp === 0 ? 0 : (this.limp > 0 ? swR : swL) * 0.03 * (1 - rb); // body drops onto the bad leg
    // limp gait: drops hard onto the bad (right) leg while the good one hurries through, hip hikes to clear the drag
    if (limpG) limpDip = swL * 0.075 - swR * 0.025;
    // hips
    let hy = 0.965 - 0.018 * (1 - idle) - 0.085 * rb + (swL + swR) * (0.018 + 0.02 * rb) - limpDip + breathe - this.atkWind * 0.03 - this.atkStrike * 0.05;
    const hxs = (swR - swL) * (0.03 - 0.012 * rb) + noise1(t * 0.4, this.seed) * 0.008 * idle;
    const hz = 0.01 + (L.rig.z + R.rig.z) * 0.32 - 0.02 * rb;
    const pelvisYaw = -stride * (0.32 + 0.1 * rb);
    const pelvisRoll = (swR - swL) * 0.07 + (limpG ? swR * 0.1 - swL * 0.05 : 0);
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
    B.spine2.quaternion.setFromEuler(_e.set(lean * 0.35 + breathe * 3 + (limpG ? swL * 0.08 : 0), -pelvisYaw * 0.75 + twistAtk * 0.6,
      -pelvisRoll * 0.5 + (this.limp === 0 ? 0 : (this.limp > 0 ? swR : -swL) * 0.06 * (1 - rb)) + (limpG ? -swL * 0.16 : 0), 'YXZ'));
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
      if (f.t < 1) pitch = limpG && f.side === -1 ? 0.32 * Math.sin(Math.PI * f.t) + 0.08
        : Math.sin(Math.PI * Math.min(1, f.t * 1.6)) * (0.5 + 0.35 * rb) - smooth((f.t - 0.6) / 0.4) * 0.3;
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
        const tgt = this.lookPt ?? w.playerEye;
        const dx = tgt.x - p.x, dz = tgt.z - p.z;
        const c = Math.cos(ry), s = Math.sin(ry);
        _v.set(dx * c - dz * s, tgt.y - (p.y + B.hips.position.y + 0.68), dx * s + dz * c);
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
      // speech (REVISION 4): the vocaliser jerks the head with each syllable, the sensor pulses
      if (this.speakT > 0) {
        this.speakT -= dt;
        if (!this.headGone) {
          const env = Math.max(0, noise1(t * 6.7, this.seed + 200)) * smooth(this.speakT / 0.2) * smooth((this.speakDur - this.speakT) / 0.12);
          B.head.quaternion.multiply(_q.setFromEuler(_e.set(-env * 0.14, noise1(t * 3.1, this.seed + 201) * 0.09 * env, noise1(t * 13, this.seed + 202) * 0.12 * env)));
          B.neck.quaternion.multiply(_q.setFromEuler(_e.set(env * 0.05, 0, 0)));
          if (this.eyeOn && this.eyeFlicker <= 0) { const base = this.mode === 'dormant' && this.isWorker ? 0.45 : 1; B.eye.scale.setScalar(this.speakT > 0 ? base * (0.75 + env * 0.6) : base); }
        }
      }
      // scripted swivel past the tracking limits (work wake: the head comes round first)
      if (Math.abs(this.headTurn) > 1e-4 && !this.headGone) {
        B.neck.quaternion.premultiply(_q.setFromAxisAngle(Y, this.headTurn * 0.35));
        B.head.quaternion.premultiply(_q.setFromAxisAngle(Y, this.headTurn * 0.65));
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
    w.ctx.events.emit('enemy:damaged', { id: this.id, type: this.type, point, direction: dir, amount: dmg, part: vol.part });
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
    if (this.mode === 'dormant' && this.isWorker) { this.stillDur = 0.3; w.provoke(this.group, this); this.wakeDelay = -1; this.beginWake(1); return; }
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
    if (this.holo) { this.holo.dispose(); this.holo = null; }
    if (this.light) { this.light.remove(); this.light = null; }
    if (this.props) { this.props.dispose(); this.props = null; }
    this.rig.skeleton.dispose();
    super.dispose();
  }
}

