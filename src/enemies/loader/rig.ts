/**
 * The dock loader's rig runtime (stage 3d §5.6.2, W3a): the interface the loader's behaviour (W3b, loader.ts) drives,
 * and its implementation on the template of model.ts.
 *
 * Division of labour: the BEHAVIOUR owns the machine's intent and its travel numbers (`LOADER_TUNING`) — where the
 * bridge, the trolley and the hoist are commanded to be each frame (the exported `CraneAxis` integrates a trapezoid
 * accelerate / coast / brake profile for it), when the jaws open, where the floods look, which part is broken. The
 * RIG owns how that reads: the grab hangs on a real damped pendulum driven by the trolley's and the bridge's actual
 * accelerations (so starts, stops and impacts make it sway — the sway is real, it reads as weight), the four ropes are
 * aimed and stretched from the trolley's sheaves to the swinging grab's, the jaws / rams / cowl ease hydraulically, the
 * floods slew on their yokes and carry their `ctx.render.lights` spots, the marks and the ring light switch, and the
 * death is a complete keyed sequence (§5.6.8) the behaviour only starts.
 *
 * Conventions: MODEL SPACE = WORLD SPACE. Add `root` to the scene (or to an unrotated, untranslated parent) and never
 * move it. Every world point below is valid after `update(dt)`; `update` must run once per frame AFTER the commands.
 */
import * as THREE from 'three';
import type { GameContext, LightHandle } from '../../core/types';
import { hv, type HitVolume } from '../shared/hit';
import type { Rig } from '../shared/rig';
import { LOADER_DIM as K, type LoaderGeom, type LoaderTemplate } from './model';

// ───────────────────────────────────────────────────────────── the interface (W3a → W3b)

export type FloodId = 1 | 2 | 3 | 4;
export type JawId = 'n' | 's' | 'e' | 'w';
export type RamSide = 'e' | 'w';
export type LoaderMarks = 'cyan' | 'red' | 'off';
export type LoaderRing = 'off' | 'white' | 'red';
/** Moments of the death sequence the behaviour turns into sound / fx (the rig plays nothing itself). */
export type LoaderCue = 'pod_blow' | 'drive_fail' | 'brake_release' | 'rope_run' | 'splash' | 'flood_out' | 'coast' | 'buffer' | 'done';

export interface LoaderDeathOpts {
  /** The well: x / z of its centre, y = its water surface (the plunge's splash height). */
  well: THREE.Vector3;
  /** Where the grab's bottom comes to rest under water (default −33: just above the cargo lock's inner door). */
  floorY?: number;
  /** The grab's bottom must be at least this high before the dying drive moves it sideways (default −11). */
  clearY?: number;
  /** Shortest failing-drive phase before the brakes let go (default 2.0 s, §5.6.8). */
  lurch?: number;
  /** Called for every cue (sound / fx are the behaviour's — enemies-owned sounds, D25). */
  onCue?: (cue: LoaderCue, at: THREE.Vector3, data?: { flood?: FloodId; debris?: THREE.Object3D[] }) => void;
}

export interface LoaderRig {
  readonly root: THREE.Object3D;
  /** The underlying Rig (LOD meshes, shadow proxy). The rig switches its own LOD unless `managedLod`. */
  readonly lodRig: Rig;
  /** Hit volumes, `part` = `flood_1..4` | `ram_e` | `ram_w` | `pod` | `body`; `region` = bridge / trolley / grab / jaw. */
  readonly volumes: HitVolume[];
  readonly drawCalls: number;

  // ── travel (commanded world positions; the caller integrates them — `CraneAxis`) ─────────────
  /** Bridge position = the grab's pivot z (clamped to the rails' zMin … zMax). */
  setBridge(z: number): void;
  /** Trolley position = the grab's pivot x (clamped to xMin … xMax). */
  setTrolley(x: number): void;
  /** Hoist: the grab's TOP (world y) when hanging still (rope length = sheave − top). */
  setHoist(grabTopY: number): void;
  readonly bridgeZ: number; readonly trolleyX: number; readonly hoistY: number;
  /** Teleport (restore): the next frame adds no sway from this jump. */
  snap(): void;

  // ── the pendulum ─────────────────────────────────────────────────────────────────────────────
  /** Current sway (rad; x = toward +x, z = toward +z). */
  readonly sway: THREE.Vector2;
  /** Damping ratio of the free sway (default 0.2: an automated crane's anti-sway; 0 = a free pendulum). */
  swayDamping: number;
  /** Add a velocity at the grab (m/s): an impact, a shove, the brakes. */
  kick(vx: number, vz: number): void;
  /** 0 = free (default), 1 = held straight (the grab resting on a deck / clamped / braked hover). Eased. */
  setSwayHold(k: number): void;
  /** Drive the sway angles directly (SWING: the wrecking-ball arc); null = back to the free pendulum. */
  forceSway(ax: number | null, az?: number): void;

  // ── grab ─────────────────────────────────────────────────────────────────────────────────────
  /** Jaw opening targets 0 (closed) … 1 (open 100°); omit `which` for all four. Eased: opens in 0.35 s, closes in 0.5 s. */
  setJaws(open: number, which?: readonly JawId[]): void;
  /** Current jaw openings. */
  readonly jaws: Readonly<Record<JawId, number>>;
  /** Ram extension 0 … 1 (follows its jaws: e = e + n, w = w + s). */
  ramExtension(side: RamSide): number;
  /**
   * The rams' own target 0 … 1, independent of the jaws (eased like them); `side` omitted = both; null = follow the jaws
   * again (the default: e = e + n, w = w + s). A burst ram always hangs extended.
   */
  setRams(k: number | null, side?: RamSide): void;
  /** Extended (≥ 0.5) and not burst: the window in which the ram takes damage (W3b applies the multiplier). */
  ramExtended(side: RamSide): boolean;
  /** The ram bursts: its glass goes dark, its two jaws hang open on their pins (ignore setJaws from now on). */
  breakRam(side: RamSide): void;
  readonly ramBroken: Readonly<Record<RamSide, boolean>>;
  /** Cowl louvres 0 (shut) … 1 (open); eased 0.4 s; the amber core and its glow show with them. */
  setCowl(open: number): void;
  readonly cowl: number;

  // ── floods ───────────────────────────────────────────────────────────────────────────────────
  /** Aim a flood at a world point (slews at `floodSlew` rad/s on its yoke); null = its parked work angle. */
  aimFlood(i: FloodId, p: THREE.Vector3 | null): void;
  /** Slew rate of every flood (rad/s; default 1.2, §5.6.3). */
  floodSlew: number;
  /** Full cone angle in degrees (clamped 14 … 22, default 18). */
  setFloodCone(i: FloodId, deg: number): void;
  /** Half cone angle in radians (the light's `angle`; the D20 test uses it). */
  floodHalfAngle(i: FloodId): number;
  setFloodOn(i: FloodId, on: boolean): void;
  /** Shatter: the lens goes, the spot goes out, the head droops on its yoke (sparks are W3b's: `floodOrigin`). */
  breakFlood(i: FloodId): void;
  floodAlive(i: FloodId): boolean;
  floodOn(i: FloodId): boolean;
  floodLight(i: FloodId): LightHandle | null;
  /** The flood's light holds a slot of the light pool this frame (S13; true when the render cannot tell). */
  floodInPool(i: FloodId): boolean;
  /** D20 geometry only: `p` inside flood i's cone within its distance, the flood alive and on (W3b adds the pool test). */
  floodCovers(i: FloodId, p: THREE.Vector3): boolean;
  /** Lens centre / beam direction (world, after update). */
  floodOrigin(i: FloodId, out: THREE.Vector3): THREE.Vector3;
  floodDir(i: FloodId, out: THREE.Vector3): THREE.Vector3;

  // ── marks and lamps ──────────────────────────────────────────────────────────────────────────
  /** The pod's sensor cluster + the grab's status lamps: cyan (working, dim), red (hostile), off (dead). */
  setMarks(m: LoaderMarks): void;
  readonly marks: LoaderMarks;
  /** The ring light under the grab's frame (emissive only): white work ring, red (the slam lock), off. */
  setRing(r: LoaderRing): void;

  // ── the load ─────────────────────────────────────────────────────────────────────────────────
  /** Hang an object (a container's mesh) in the grab, keeping its world transform (put the grab over it first). */
  attach(obj: THREE.Object3D): void;
  /** Release the load into the scene at its current world transform. */
  detach(): THREE.Object3D | null;
  readonly carried: THREE.Object3D | null;

  // ── world points (after update) ──────────────────────────────────────────────────────────────
  readonly grabTop: THREE.Vector3;
  /** Centre of the grab's lowest point (closed jaw tips / the carried load's bottom). */
  readonly grabBottom: THREE.Vector3;
  /** The pod's sensor (eyes, §5.6.3). */
  readonly sensor: THREE.Vector3;
  /** The PA horn's mouth (`say` position). */
  readonly pa: THREE.Vector3;
  readonly podCenter: THREE.Vector3;
  /** World AABB round the grab body + open jaws (+ the carried load). */
  grabBox(out: THREE.Box3, withLoad?: boolean): THREE.Box3;
  /** A part's world centre: `flood_n`, `ram_e`, `ram_w`, `pod`, `grab`, `trolley`, `bridge`. */
  partPos(part: string, out: THREE.Vector3): THREE.Vector3;

  // ── death ────────────────────────────────────────────────────────────────────────────────────
  /** §5.6.8: pod blows, failing drive over the well, brakes go, the grab plunges, floods die, the bridge coasts into its buffers. */
  die(o: LoaderDeathOpts): Promise<void>;
  readonly dying: boolean;
  readonly dead: boolean;
  /** Dead and the bridge has stopped in its buffer (keep calling `update` until then for the coast + `buffer` cue). */
  readonly settled: boolean;
  /**
   * Checkpoint restore: every part whole again — floods (lens, light on, yoke up), rams (jaws free), cowl shut and
   * all louvres back, the core dark, a running / finished death undone (grab back on its ropes, raised at the current
   * bridge / trolley, ropes on their sheaves). Marks and ring are left as they are (the caller sets them).
   */
  repair(): void;

  /** Once per frame after the commands. `camera` (world) drives the rig's own LOD (34 / 30 m) unless managed. */
  update(dt: number, camera?: THREE.Vector3): void;
  lod(level: 0 | 1 | 'auto'): void;
  dispose(): void;
}

export interface LoaderRigOpts {
  /** Floods cast shadows (FL1 / FL2 only; §2.7.1 / S13: HIGH and up). Default: from `ctx.debug.quality`. */
  floodShadows?: boolean;
  /** Draw the floods' volumetric shafts (default FALSE: the shaft brightness follows the spot's intensity, and a 45 m flood's intensity whites the view out — needs a render-side scatter scale first). */
  volumetric?: boolean;
  /** Floods start on (default true). */
  floodsOn?: boolean;
  /** Start marks (default 'cyan'). */
  marks?: LoaderMarks;
  /** The behaviour / manager drives `lodRig.setLod` itself (default false). */
  managedLod?: boolean;
}

/** The four floods' light (IA retunes here; `LOADER_TUNING.sight` carries slew / cone for the behaviour). */
export const FLOOD_LIGHT = {
  color: 0xf2f0e6, intensity: 2600, distance: 45, penumbra: 0.32, coneDeg: 18, priority: 0.9,
  /** Parked work angles (pan from south, tilt below the horizon), per flood. */
  park: { 1: [-0.35, -0.95], 2: [0.35, -0.95], 3: [0.25, -1.05], 4: [-0.25, -1.05] } as Record<FloodId, [number, number]>,
};

/** Hydraulic timings of the grab (seconds). */
export const GRAB_TIMING = { jawOpen: 0.35, jawClose: 0.5, cowl: 0.4 };

/** The opening a jaw holds while it grips a container's long side (n / s jaws; e / w stay open — the box is 6 m long). */
export const JAW_CLAMP = 0.18;

export function createLoaderRig(ctx: GameContext, tpl: LoaderTemplate, opts: LoaderRigOpts = {}): LoaderRig {
  return new LoaderRigImpl(ctx, tpl, opts);
}

/**
 * One crane axis (bridge, trolley, hoist): a trapezoidal move to a target — accelerate at `accel`, cruise at
 * `maxSpeed`, brake at `decel` to stop ON the target (no overshoot), coast-and-brake when the target changes under
 * way. The behaviour owns one per axis and feeds `pos` to the rig each frame.
 */
export class CraneAxis {
  vel = 0;
  target: number;
  constructor(public pos: number, public maxSpeed: number, public accel: number, public decel = accel) { this.target = pos; }
  set(target: number): this { this.target = target; return this; }
  teleport(p: number): this { this.pos = this.target = p; this.vel = 0; return this; }
  get moving(): boolean { return Math.abs(this.vel) > 1e-3 || Math.abs(this.target - this.pos) > 1e-3; }
  /** Distance needed to stop from the current speed. */
  get stopDistance(): number { return (this.vel * this.vel) / (2 * this.decel); }
  step(dt: number): number {
    const d = this.target - this.pos;
    if (Math.abs(d) < 1e-4 && Math.abs(this.vel) < 0.02) { this.pos = this.target; this.vel = 0; return this.pos; }
    const dir = Math.sign(d) || Math.sign(this.vel);
    const stop = this.stopDistance;
    let want: number;
    if (Math.sign(this.vel) !== 0 && Math.sign(this.vel) !== Math.sign(d)) want = 0;   // moving away: brake first
    else if (Math.abs(d) <= stop + Math.abs(this.vel) * dt) want = Math.sign(d) * Math.sqrt(Math.max(0, 2 * this.decel * Math.abs(d)));
    else want = dir * this.maxSpeed;
    const a = Math.abs(want) < Math.abs(this.vel) || Math.sign(want) !== Math.sign(this.vel) ? this.decel : this.accel;
    const dv = THREE.MathUtils.clamp(want - this.vel, -a * dt, a * dt);
    this.vel += dv;
    const next = this.pos + this.vel * dt;
    // never cross the target while braking onto it
    if ((this.target - this.pos) * (this.target - next) < 0 && Math.abs(this.vel) <= Math.sqrt(2 * this.decel * Math.abs(d)) + a * dt) { this.pos = this.target; this.vel = 0; }
    else this.pos = next;
    return this.pos;
  }
}

// ───────────────────────────────────────────────────────────── implementation

const GRAV = 9.81;          // the pendulum's g (a real crane's period reads as weight; the game's 19 is for bodies)
const SWAY_MAX = 0.4;       // §5.6.2
const OFF = 1e-4;
const D = Math.PI / 180;
const JAW_MAX = 100 * D;
const LOUVRE_MAX = 75 * D;
const LOD_FAR = 34, LOD_NEAR = 30;
const FLOODS: FloodId[] = [1, 2, 3, 4];
const JAWS: JawId[] = ['n', 's', 'e', 'w'];
const RAM_JAWS: Record<RamSide, [JawId, JawId]> = { e: ['e', 'n'], w: ['w', 's'] };
/** Jaw blade samples (jaw-local x outward, y up) for the reach / bottom of an opened jaw. */
const BLADE: [number, number][] = [[0.04, -0.2], [-0.02, -0.32], [-0.185, -0.52], [-0.46, -0.64], [-0.88, -0.65]];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _box = new THREE.Box3();
const DOWN = new THREE.Vector3(0, -1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1), AX_X = new THREE.Vector3(1, 0, 0);

interface Flood {
  id: FloodId;
  pan: THREE.Bone; tilt: THREE.Bone; lens: THREE.Bone; beam: THREE.Bone;
  onTrolley: boolean;
  /** Pan bone offset from its parent bone (parent-local = world offset; parents never rotate). */
  panOff: THREE.Vector3; headDy: number;
  yaw: number; pitch: number; droopV: number;
  aim: THREE.Vector3 | null; aimBuf: THREE.Vector3;
  alive: boolean; on: boolean; half: number;
  light: LightHandle | null;
  origin: THREE.Vector3; dir: THREE.Vector3;
  /** Death flicker: time left (s), −1 none. */
  flicker: number;
}

interface Death {
  o: Required<Omit<LoaderDeathOpts, 'onCue'>> & Pick<LoaderDeathOpts, 'onCue'>;
  phase: 'lurch' | 'fall' | 'sunk';
  t: number; phaseT: number;
  jerkT: number;
  fallV: number; splashed: boolean; ropeT: number;
  floodAt: number[]; floodDone: boolean[];
  bridge: { v: number; a: number; to: number; hit: boolean; bounce: number; stopT: number };
  resolve: () => void;
  /** `done` fired (dead); the bridge may still be coasting. */
  done: boolean;
  lurchX: CraneAxis; lurchZ: CraneAxis; lift: CraneAxis;
}

class LoaderRigImpl implements LoaderRig {
  readonly root = new THREE.Group();
  readonly lodRig: Rig;
  readonly volumes: HitVolume[];
  private readonly B: Record<string, THREE.Bone>;
  private readonly G: LoaderGeom;
  private readonly cx: number;

  // travel
  bridgeZ: number; trolleyX: number; hoistY: number;
  private pz = 0; private px = 0; private pvz = 0; private pvx = 0; private snapNext = true;
  private lastLen = 0;

  // pendulum (angles, rates)
  readonly sway = new THREE.Vector2();
  swayDamping = 0.2;
  private swayV = new THREE.Vector2();
  private hold = 0; private holdTarget = 0;
  private forced: THREE.Vector2 | null = null;
  private readonly grabPos = new THREE.Vector3();
  private readonly grabQ = new THREE.Quaternion();

  // grab
  private readonly jawCur: Record<JawId, number> = { n: 0, s: 0, e: 0, w: 0 };
  private readonly jawTgt: Record<JawId, number> = { n: 0, s: 0, e: 0, w: 0 };
  private readonly jawV: Record<JawId, number> = { n: 0, s: 0, e: 0, w: 0 };
  readonly ramBroken: Record<RamSide, boolean> = { e: false, w: false };
  private cowlCur = 0; private cowlTgt = 0;
  /** Ram extension (own state) and its target (null = follow its jaws). */
  private readonly ramCur: Record<RamSide, number> = { e: 0, w: 0 };
  private readonly ramTgt: Record<RamSide, number | null> = { e: null, w: null };
  private blown = false; private coreFlare = 0;
  private readonly bindQ = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly bindP = new Map<THREE.Bone, THREE.Vector3>();

  // floods
  floodSlew = 1.2;
  private readonly floods: Flood[];
  private readonly lightsOk: boolean;

  // marks
  marks: LoaderMarks = 'cyan';
  private ring: LoaderRing = 'off';

  // load
  carried: THREE.Object3D | null = null;
  private readonly loadBox = new THREE.Box3();   // relative to the grab top (no rotation)

  // world points
  readonly grabTop = new THREE.Vector3();
  readonly grabBottom = new THREE.Vector3();
  readonly sensor = new THREE.Vector3();
  readonly pa = new THREE.Vector3();
  readonly podCenter = new THREE.Vector3();
  private bottomY = 0; private reach = K.grabHalf;

  // death
  dying = false; dead = false;
  /** Dead AND the bridge has come to rest in its buffer (the death's epilogue is over; updates may stop). */
  settled = false;
  private death: Death | null = null;
  private whip = 0;
  /** Death: where the grab was let go (it falls straight down there; the bridge coasts on without it). */
  private fallAt: THREE.Vector3 | null = null;
  /** Death: the ropes' run-out tails (world), falling into the well once the grab has sunk; hidden under water. */
  private tails: { p: THREE.Vector3[]; v: number; water: number; gone: boolean } | null = null;

  private lodMode: 0 | 1 | 'auto' = 'auto';
  private readonly managed: boolean;
  private t = 0;

  constructor(private ctx: GameContext, private tpl: LoaderTemplate, opts: LoaderRigOpts) {
    this.G = tpl.geom;
    this.cx = (this.G.spanX0 + this.G.spanX1) / 2;
    this.lodRig = tpl.rig.instantiate();
    this.B = this.lodRig.byName;
    this.root.name = 'loader';
    this.root.userData.loaderRig = this;   // tests / dev: the rig behind an adapter
    this.root.add(this.lodRig.root);
    this.managed = !!opts.managedLod;
    for (const b of this.lodRig.bones) { this.bindQ.set(b, b.quaternion.clone()); this.bindP.set(b, b.position.clone()); }
    this.bridgeZ = this.G.bindZ; this.trolleyX = this.G.bindX; this.hoistY = this.G.grabTop;

    const B = this.B, span = this.G.spanX1 - this.G.spanX0;
    const vol: HitVolume[] = [];
    for (const i of FLOODS) vol.push(hv(B[`fl${i}_tilt`], [0, 0, -0.04], [0, 0, -0.04], 0.32, `flood_${i}`, `flood_${i}`));
    vol.push(hv(B.ram_e_cyl, [0, 0.05, 0], [0, -0.95, 0], 0.12, 'ram_e'), hv(B.ram_w_cyl, [0, 0.05, 0], [0, -0.95, 0], 0.12, 'ram_w'));
    vol.push(hv(B.pod, [-0.28, 0, 0], [0.28, 0, 0], 0.54, 'pod'));
    vol.push(hv(B.grab, [0, -0.35, 0], [0, -0.35, 0], 0.62, 'body', 'grab'));
    for (const s of [-1, 1]) {
      vol.push(hv(B.grab, [-1.0, -0.75, s * 1.0], [1.0, -0.75, s * 1.0], 0.2, 'body', 'grab'));
      vol.push(hv(B.grab, [s * 1.0, -0.75, -1.0], [s * 1.0, -0.75, 1.0], 0.2, 'body', 'grab'));
    }
    for (const j of JAWS) vol.push(hv(B[`jaw_${j}`], [0, -0.05, 0], [-0.42, -0.58, 0], 0.28, 'body', 'jaw'));
    vol.push(hv(B.trolley, [-1.1, 0.75, 0], [1.1, 0.75, 0], 0.9, 'body', 'trolley'));
    vol.push(hv(B.trolley, [0, -0.15, 0.05], [0, -1.3, 0.05], 0.27, 'body', 'trolley'));
    for (const s of [-1, 1]) for (const y of [0.35, 1.05]) vol.push(hv(B.bridge, [-span / 2 + 0.4, y, s * K.girderDZ], [span / 2 - 0.4, y, s * K.girderDZ], 0.35, 'body', 'bridge'));
    for (const xr of [this.G.railXW, this.G.railXE]) vol.push(hv(B.bridge, [xr - this.cx, 0.8, -1.7], [xr - this.cx, 0.8, 1.7], 0.5, 'body', 'bridge'));
    this.volumes = vol;

    // floods: spots through the light manager (§5.6.2: prio 0.9; FL1/FL2 cast on HIGH+ only — S13)
    const q = ctx.debug?.quality ?? 'medium';
    const shadows = opts.floodShadows ?? (q === 'high' || q === 'ultra');
    const on = opts.floodsOn !== false;
    this.lightsOk = !!ctx.render?.lights;
    this.floods = K.floods.map((f) => {
      const pan = B[`fl${f.id}_pan`];
      const half = (FLOOD_LIGHT.coneDeg / 2) * D;
      let light: LightHandle | null = null;
      try {
        light = ctx.render?.lights?.add({
          type: 'spot', position: new THREE.Vector3(0, -500, 0), target: new THREE.Vector3(0, -501, 0), color: FLOOD_LIGHT.color,
          intensity: FLOOD_LIGHT.intensity, distance: FLOOD_LIGHT.distance, angle: half, penumbra: FLOOD_LIGHT.penumbra,
          castShadow: shadows && f.on === 'trolley', priority: FLOOD_LIGHT.priority, volumetric: opts.volumetric === true, enabled: on, group: 'loader_floods',
        }) ?? null;
      } catch { light = null; }
      const [py, pt] = FLOOD_LIGHT.park[f.id];
      return {
        id: f.id, pan, tilt: B[`fl${f.id}_tilt`], lens: B[`fl${f.id}_lens`], beam: B[`fl${f.id}_beam`],
        onTrolley: f.on === 'trolley', panOff: pan.position.clone(), headDy: f.head[1] - f.pan[1],
        yaw: py, pitch: pt, droopV: 0, aim: null, aimBuf: new THREE.Vector3(),
        alive: true, on, half, light, origin: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), flicker: -1,
      };
    });
    for (const f of this.floods) f.beam.scale.setScalar(on ? 1 : OFF);
    this.setMarks(opts.marks ?? 'cyan');
    this.setRing('off');
    this.B.pod_core.scale.setScalar(OFF);
    this.B.glass_e.scale.setScalar(OFF); this.B.glass_w.scale.setScalar(OFF);
    this.update(0);
  }

  // ───────────────────────────────────────────── interface

  get drawCalls(): number {
    let n = 0;
    // the rig's own skinned meshes only (a carried container hangs under the grab bone but is the level's draw call)
    for (const m of [...this.lodRig.meshes, ...this.lodRig.lod1]) if (m.visible && this.root.visible) n++;
    if (this.lodRig.shadow && this.lodRig.shadow.castShadow) n++;
    return n;
  }

  setBridge(z: number): void { if (!this.locked) this.bridgeZ = THREE.MathUtils.clamp(z, this.G.zMin, this.G.zMax); }
  setTrolley(x: number): void { if (!this.locked) this.trolleyX = THREE.MathUtils.clamp(x, this.G.xMin, this.G.xMax); }
  setHoist(y: number): void { if (!this.locked) this.hoistY = Math.min(y, this.G.grabTop + 0.4); }
  snap(): void { this.snapNext = true; }
  /** Dying or dead: the behaviour's commands are ignored (the death owns the machine). */
  private get locked(): boolean { return this.dying || this.dead; }

  kick(vx: number, vz: number): void {
    const L = Math.max(0.5, this.ropeLen());
    this.swayV.x += vx / L; this.swayV.y += vz / L;
  }
  setSwayHold(k: number): void { this.holdTarget = THREE.MathUtils.clamp(k, 0, 1); }
  forceSway(ax: number | null, az = 0): void {
    if (ax === null) { this.forced = null; return; }
    (this.forced ??= new THREE.Vector2()).set(THREE.MathUtils.clamp(ax, -SWAY_MAX * 1.6, SWAY_MAX * 1.6), THREE.MathUtils.clamp(az, -SWAY_MAX * 1.6, SWAY_MAX * 1.6));
  }

  setJaws(open: number, which: readonly JawId[] = JAWS): void {
    if (this.locked) return;
    const v = THREE.MathUtils.clamp(open, 0, 1);
    for (const j of which) if (!this.jawDead(j)) this.jawTgt[j] = v;
  }
  get jaws(): Readonly<Record<JawId, number>> { return this.jawCur; }
  ramExtension(side: RamSide): number { return this.ramCur[side]; }
  private jawRam(side: RamSide): number { const [a, b] = RAM_JAWS[side]; return Math.min(1, (this.jawCur[a] + this.jawCur[b]) / 2); }
  setRams(k: number | null, side?: RamSide): void {
    for (const sd of side ? [side] : (['e', 'w'] as const)) this.ramTgt[sd] = k === null ? null : THREE.MathUtils.clamp(k, 0, 1);
  }
  ramExtended(side: RamSide): boolean { return !this.ramBroken[side] && this.ramExtension(side) >= 0.5; }
  breakRam(side: RamSide): void {
    if (this.ramBroken[side]) return;
    this.ramBroken[side] = true;
    for (const j of RAM_JAWS[side]) { this.jawTgt[j] = 1; this.jawV[j] = 2.5; }
  }
  private jawDead(j: JawId): boolean { return (this.ramBroken.e && (j === 'e' || j === 'n')) || (this.ramBroken.w && (j === 'w' || j === 's')); }
  setCowl(open: number): void { if (!this.blown) this.cowlTgt = THREE.MathUtils.clamp(open, 0, 1); }
  get cowl(): number { return this.cowlCur; }

  private fl(i: FloodId): Flood { return this.floods[i - 1]; }
  aimFlood(i: FloodId, p: THREE.Vector3 | null): void { const f = this.fl(i); f.aim = p ? f.aimBuf.copy(p) : null; }
  setFloodCone(i: FloodId, deg: number): void {
    const f = this.fl(i);
    f.half = (THREE.MathUtils.clamp(deg, 14, 22) / 2) * D;
    if (f.light) (f.light.desc as { angle?: number }).angle = f.half;
  }
  floodHalfAngle(i: FloodId): number { return this.fl(i).half; }
  setFloodOn(i: FloodId, on: boolean): void {
    const f = this.fl(i);
    if (!f.alive) on = false;
    f.on = on;
    if (f.light) f.light.enabled = on;
    f.beam.scale.setScalar(on ? 1 : OFF);
  }
  breakFlood(i: FloodId): void {
    const f = this.fl(i);
    if (!f.alive) return;
    this.setFloodOn(i, false);
    f.alive = false; f.flicker = -1;
    f.lens.scale.setScalar(OFF);
    f.droopV = -1.5;
  }
  floodAlive(i: FloodId): boolean { return this.fl(i).alive; }
  floodOn(i: FloodId): boolean { return this.fl(i).on; }
  floodLight(i: FloodId): LightHandle | null { return this.fl(i).light; }
  floodInPool(i: FloodId): boolean {
    const l = this.fl(i).light as (LightHandle & { slot?: unknown }) | null;
    if (!l || !l.enabled) return false;
    return !('slot' in l) || l.slot !== null;   // render/lights.ts Handle.slot (not a contract member)
  }
  floodCovers(i: FloodId, p: THREE.Vector3): boolean {
    const f = this.fl(i);
    if (!f.alive || !f.on) return false;
    _v.copy(p).sub(f.origin);
    const d = _v.length();
    if (d > FLOOD_LIGHT.distance || d < 1e-3) return false;
    return _v.dot(f.dir) / d >= Math.cos(f.half);
  }
  floodOrigin(i: FloodId, out: THREE.Vector3): THREE.Vector3 { return out.copy(this.fl(i).origin); }
  floodDir(i: FloodId, out: THREE.Vector3): THREE.Vector3 { return out.copy(this.fl(i).dir); }

  setMarks(m: LoaderMarks): void {
    this.marks = m;
    const c = m === 'cyan' ? 1 : OFF, r = m === 'red' ? 1 : OFF;
    this.B.mk_pod_c.scale.setScalar(c); this.B.mk_pod_r.scale.setScalar(r);
    for (let k = 0; k < K.lamps.length; k++) { this.B[`mk_grab_c${k}`].scale.setScalar(c); this.B[`mk_grab_r${k}`].scale.setScalar(r); }
  }
  setRing(r: LoaderRing): void {
    this.ring = r;
    this.B.ring_w.scale.setScalar(r === 'white' ? 1 : OFF);
    this.B.ring_r.scale.setScalar(r === 'red' ? 1 : OFF);
  }

  attach(obj: THREE.Object3D): void {
    if (this.carried) this.detach();
    this.root.updateMatrixWorld(true);
    _box.setFromObject(obj);
    this.loadBox.copy(_box).translate(_v.copy(this.grabPos).negate());
    this.B.grab.attach(obj);
    this.carried = obj;
  }
  detach(): THREE.Object3D | null {
    const o = this.carried;
    if (!o) return null;
    this.root.updateMatrixWorld(true);
    (this.root.parent ?? this.ctx.scene).attach(o);
    this.carried = null;
    return o;
  }

  grabBox(out: THREE.Box3, withLoad = true): THREE.Box3 {
    const r = this.reach;
    out.min.set(this.grabPos.x - r, this.bottomY, this.grabPos.z - r);
    out.max.set(this.grabPos.x + r, this.grabPos.y, this.grabPos.z + r);
    if (withLoad && this.carried) out.union(_box.copy(this.loadBox).translate(this.grabPos));
    return out;
  }
  partPos(part: string, out: THREE.Vector3): THREE.Vector3 {
    const B = this.B;
    if (part.startsWith('flood_')) return out.setFromMatrixPosition(this.fl(Number(part.slice(6)) as FloodId).tilt.matrixWorld);
    if (part === 'ram_e' || part === 'ram_w') { out.setFromMatrixPosition(B[part + '_cyl'].matrixWorld); out.y -= 0.45; return out; }
    if (part === 'pod') return out.copy(this.podCenter);
    if (part === 'grab') return out.copy(this.grabPos).setY(this.grabPos.y - 0.6);
    if (part === 'trolley') return out.setFromMatrixPosition(B.trolley.matrixWorld).setY(-1.8);
    return out.set(this.cx, this.G.railY + 0.7, this.bridgeZ);
  }

  die(o: LoaderDeathOpts): Promise<void> {
    if (this.dying || this.dead) return Promise.resolve();
    this.dying = true;
    const opts = { well: o.well.clone(), floorY: o.floorY ?? -33, clearY: o.clearY ?? -11, lurch: o.lurch ?? 2.0, onCue: o.onCue };
    return new Promise((resolve) => {
      this.death = {
        o: opts, phase: 'lurch', t: 0, phaseT: 0, jerkT: 0.25,
        fallV: 0, splashed: false, ropeT: -1,
        floodAt: [], floodDone: [false, false, false, false],
        bridge: { v: 0, a: 0, to: 0, hit: false, bounce: 0, stopT: -1 },
        resolve, done: false,
        lurchX: new CraneAxis(this.trolleyX, 4.5, 3.2, 3.6),
        lurchZ: new CraneAxis(this.bridgeZ, 4.5, 3.0, 3.4),
        lift: new CraneAxis(this.hoistY, 4.2, 6.0),
      };
      // the pod blows: marks out, the core flares and dies, three louvres fly, the rest jam open
      this.setMarks('off');
      this.setRing('off');
      this.blown = true; this.cowlTgt = 1; this.coreFlare = 0.22;
      const debris: THREE.Object3D[] = [];
      for (const i of [1, 3, 4]) {
        const bn = this.B[`louvre_${i}`];
        const m = this.tpl.rig.debrisMesh(`louvre_${i}`);
        if (m) { bn.updateMatrixWorld(true); bn.matrixWorld.decompose(m.position, m.quaternion, m.scale); m.scale.set(1, 1, 1); debris.push(m); }
        bn.scale.setScalar(OFF);
      }
      for (const j of JAWS) this.jawTgt[j] = this.jawCur[j];
      this.cue('pod_blow', this.podCenter, { debris });
    });
  }

  repair(): void {
    const B = this.B;
    // death undone
    this.death = null; this.dying = false; this.dead = false; this.settled = false;
    this.fallAt = null; this.tails = null; this.whip = 0;
    for (let i = 0; i < 4; i++) { const r = B[`rope_${i}`]; r.position.copy(this.bindP.get(r)!); }
    if (this.hoistY < this.G.grabTop - 12) this.hoistY = this.G.grabTop;
    this.holdTarget = 0; this.forced = null; this.sway.set(0, 0); this.swayV.set(0, 0);
    // rams + jaws
    this.ramBroken.e = this.ramBroken.w = false;
    for (const j of JAWS) { this.jawV[j] = 0; this.jawTgt[j] = Math.min(1, this.jawCur[j]); this.jawCur[j] = Math.min(1, this.jawCur[j]); }
    // cowl + pod
    this.blown = false; this.coreFlare = 0; this.cowlTgt = 0; this.cowlCur = 0;
    for (let i = 0; i < K.louvres; i++) B[`louvre_${i}`].scale.setScalar(1);
    B.pod_core.scale.setScalar(OFF);
    // floods
    for (const f of this.floods) {
      f.alive = true; f.flicker = -1; f.droopV = 0;
      [f.yaw, f.pitch] = FLOOD_LIGHT.park[f.id];
      f.lens.scale.setScalar(1);
      if (f.light) f.light.intensityScale = 1;
      this.setFloodOn(f.id, true);
    }
    this.snapNext = true;
  }

  lod(level: 0 | 1 | 'auto'): void { this.lodMode = level; if (level !== 'auto') this.lodRig.setLod(level); }

  dispose(): void {
    for (const f of this.floods) { f.light?.remove(); f.light = null; }
    this.root.parent?.remove(this.root);
  }

  // ───────────────────────────────────────────── per frame

  private ropeLen(): number { return K.sheaveY - (this.hoistY + K.grabSheaveY); }

  private cue(c: LoaderCue, at: THREE.Vector3, data?: { flood?: FloodId; debris?: THREE.Object3D[] }): void {
    try { this.death?.o.onCue?.(c, at.clone(), data); } catch (e) { console.error('[loader] cue', c, e); }
  }

  update(dt: number, camera?: THREE.Vector3): void {
    this.t += dt;
    if (this.death) this.deathStep(dt);
    this.travel(dt);
    this.pendulum(dt);
    this.hydraulics(dt);
    this.placeGrab();
    this.root.updateMatrixWorld(true);
    this.aimFloods(dt);
    this.aimRopes();
    this.root.updateMatrixWorld(true);
    this.points();
    if (!this.managed) {
      if (this.lodMode === 'auto' && camera) {
        const d = Math.min(camera.distanceTo(this.grabPos), camera.distanceTo(this.podCenter));
        if (this.lodRig.lod === 0 && d > LOD_FAR) this.lodRig.setLod(1);
        else if (this.lodRig.lod === 1 && d < LOD_NEAR) this.lodRig.setLod(0);
      }
    }
  }

  /** Bridge / trolley bones, wheels and drum spin, and the pivot's acceleration (for the pendulum). */
  private ax = 0; private az = 0;
  private travel(dt: number): void {
    const B = this.B;
    const dz = this.bridgeZ - B.bridge.position.z, dx = (this.trolleyX - this.cx) - B.trolley.position.x;
    B.bridge.position.z = this.bridgeZ;
    B.trolley.position.x = this.trolleyX - this.cx;
    for (const n of ['bwheel_00', 'bwheel_01', 'bwheel_10', 'bwheel_11']) B[n].rotation.x -= dz / K.wheelR;
    for (const n of ['twheel_00', 'twheel_01', 'twheel_10', 'twheel_11']) B[n].rotation.z += dx / 0.22;
    const L = this.ropeLen();
    B.drum.rotation.x += (L - this.lastLen) / 0.46;
    if (dt <= 0 && !this.snapNext) return;   // a paused frame changes nothing
    if (dt <= 0 || this.snapNext) {
      this.px = this.trolleyX; this.pz = this.bridgeZ; this.pvx = 0; this.pvz = 0; this.ax = 0; this.az = 0;
      this.lastLen = L; this.snapNext = false;
      return;
    }
    const vx = (this.trolleyX - this.px) / dt, vz = (this.bridgeZ - this.pz) / dt;
    this.ax = THREE.MathUtils.clamp((vx - this.pvx) / dt, -14, 14);
    this.az = THREE.MathUtils.clamp((vz - this.pvz) / dt, -14, 14);
    this.px = this.trolleyX; this.pz = this.bridgeZ; this.pvx = vx; this.pvz = vz;
  }

  private pendulum(dt: number): void {
    if (dt <= 0) return;
    const L = Math.max(0.5, this.ropeLen());
    const dL = (L - this.lastLen) / dt;
    this.lastLen = L;
    this.hold += (this.holdTarget - this.hold) * Math.min(1, dt * 5);
    if (this.forced) {
      const k = Math.min(1, dt * 9);
      const nx = this.sway.x + (this.forced.x - this.sway.x) * k, nz = this.sway.y + (this.forced.y - this.sway.y) * k;
      this.swayV.set((nx - this.sway.x) / dt, (nz - this.sway.y) / dt);
      this.sway.set(nx, nz);
      return;
    }
    const w2 = GRAV / L, c = 2 * this.swayDamping * Math.sqrt(w2);
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      const accX = -w2 * Math.sin(this.sway.x) - c * this.swayV.x - (this.ax / L) * Math.cos(this.sway.x) - 2 * (dL / L) * this.swayV.x;
      const accZ = -w2 * Math.sin(this.sway.y) - c * this.swayV.y - (this.az / L) * Math.cos(this.sway.y) - 2 * (dL / L) * this.swayV.y;
      this.swayV.x += accX * h; this.swayV.y += accZ * h;
      this.sway.x += this.swayV.x * h; this.sway.y += this.swayV.y * h;
    }
    if (this.hold > 1e-3) {
      const k = 1 - Math.min(1, dt * 7 * this.hold);
      this.sway.multiplyScalar(k); this.swayV.multiplyScalar(k);
    }
    // soft stop at ±0.4 rad (the ropes' fleet angle at the sheaves)
    for (const a of ['x', 'y'] as const) {
      if (Math.abs(this.sway[a]) > SWAY_MAX) { this.sway[a] = Math.sign(this.sway[a]) * SWAY_MAX; if (this.swayV[a] * this.sway[a] > 0) this.swayV[a] *= -0.3; }
    }
  }

  private hydraulics(dt: number): void {
    const B = this.B;
    for (const j of JAWS) {
      if (this.jawDead(j)) {
        // hanging dead on its pin: a damped spring to fully open, with the bounce of the burst
        this.jawV[j] += ((1 - this.jawCur[j]) * 40 - this.jawV[j] * 4.5) * dt;
        this.jawCur[j] = Math.min(1.12, this.jawCur[j] + this.jawV[j] * dt);
      } else {
        const d = this.jawTgt[j] - this.jawCur[j];
        const rate = (d > 0 ? 1 / GRAB_TIMING.jawOpen : 1 / GRAB_TIMING.jawClose) * dt;
        this.jawCur[j] += THREE.MathUtils.clamp(d, -rate, rate);
      }
      const bone = B[`jaw_${j}`];
      bone.quaternion.copy(this.bindQ.get(bone)!).multiply(_q.setFromAxisAngle(AX_Z, this.jawCur[j] * JAW_MAX));
    }
    for (const side of ['e', 'w'] as const) {
      // a burst ram hangs extended with its jaws; otherwise its own target (eased like the jaws) or its jaws
      const tgt = this.ramBroken[side] ? 1 : this.ramTgt[side];
      if (tgt === null) this.ramCur[side] = this.jawRam(side);
      else {
        const d = tgt - this.ramCur[side], rate = (d > 0 ? 1 / GRAB_TIMING.jawOpen : 1 / GRAB_TIMING.jawClose) * dt;
        this.ramCur[side] += THREE.MathUtils.clamp(d, -rate, rate);
      }
      const ext = THREE.MathUtils.clamp(this.ramCur[side], 0, 1);
      const rod = B[`ram_${side}_rod`];
      rod.position.copy(this.bindP.get(rod)!); rod.position.y -= K.ramStroke * ext;
      const glow = this.ramBroken[side] || this.dying ? 0 : THREE.MathUtils.smoothstep(ext, 0.25, 0.6);
      B[`glass_${side}`].scale.setScalar(glow > 0.01 ? glow : OFF);
    }
    const dc = this.cowlTgt - this.cowlCur, rc = dt / GRAB_TIMING.cowl;
    this.cowlCur += THREE.MathUtils.clamp(dc, -rc, rc);
    for (let i = 0; i < K.louvres; i++) {
      const bn = B[`louvre_${i}`];
      const k = this.blown ? 1.35 + 0.1 * Math.sin(i * 2.1) : this.cowlCur;
      bn.quaternion.copy(this.bindQ.get(bn)!).multiply(_q.setFromAxisAngle(AX_X, k * LOUVRE_MAX));
    }
    if (this.coreFlare > 0) { this.coreFlare -= dt; B.pod_core.scale.setScalar(this.coreFlare > 0 ? 1.4 : OFF); }
    else if (!this.blown) B.pod_core.scale.setScalar(this.cowlCur > 0.02 ? Math.max(0.2, this.cowlCur) : OFF);
  }

  /** The grab on the pendulum: pivot at the trolley's sheaves, kept level by its four falls (a slight tilt only). */
  private placeGrab(): void {
    const L = Math.max(0.5, this.ropeLen());
    const sx = Math.sin(this.sway.x), sz = Math.sin(this.sway.y);
    const dy = L * Math.sqrt(Math.max(0, 1 - sx * sx - sz * sz));
    this.grabPos.set(this.trolleyX + L * sx, K.sheaveY - dy - K.grabSheaveY, this.bridgeZ + L * sz);
    if (this.fallAt) { this.grabPos.set(this.fallAt.x, this.hoistY, this.fallAt.z); this.sway.set(0, 0); }
    _e.set(this.sway.y * 0.14, 0, -this.sway.x * 0.14, 'XYZ');
    this.grabQ.setFromEuler(_e);
    const g = this.B.grab;
    g.position.copy(this.grabPos);
    g.quaternion.copy(this.grabQ);
    // reach and lowest point of the opened jaws (jaw-local blade samples rotated by the opening)
    let reach = K.grabHalf, low = K.tipY;
    for (const j of JAWS) {
      const a = this.jawCur[j] * JAW_MAX, c = Math.cos(a), s = Math.sin(a);
      for (const [x, y] of BLADE) {
        const rx = x * c - y * s, ry = x * s + y * c;
        reach = Math.max(reach, K.hingeR + rx + 0.05);
        low = Math.min(low, K.hingeY + ry - 0.03);
      }
    }
    this.reach = reach;
    let bottom = this.grabPos.y + low;
    if (this.carried) bottom = Math.min(bottom, this.grabPos.y + this.loadBox.min.y);
    this.bottomY = bottom;
  }

  private aimFloods(dt: number): void {
    const B = this.B;
    const tw = B.trolley.matrixWorld, bw = B.bridge.matrixWorld;
    for (const f of this.floods) {
      // pan bearing (world): parent world + the bind offset (parents never rotate); head below it on the yoke
      _v.setFromMatrixPosition(f.onTrolley ? tw : bw).add(f.panOff);
      const head = _v2.copy(_v); head.y += f.headDy;
      let ty = f.yaw, tp = f.pitch;
      const target = this.dying && f.alive && !this.dead ? this.grabBottom : f.aim;
      if (!f.alive) {
        // shattered: droops on its yoke, bounces, hangs
        f.droopV += ((-1.45 - f.pitch) * 18 - f.droopV * 3.2) * dt;
        f.pitch += f.droopV * dt;
      } else {
        if (target) {
          _v3.copy(target).sub(head);
          const d = _v3.length();
          if (d > 0.05) { _v3.divideScalar(d); tp = Math.asin(THREE.MathUtils.clamp(_v3.y, -1, 1)); ty = Math.atan2(-_v3.x, -_v3.z); }
        } else { [ty, tp] = FLOOD_LIGHT.park[f.id]; }
        tp = THREE.MathUtils.clamp(tp, -88 * D, 15 * D);
        let dyaw = ty - f.yaw;
        dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        const dp = tp - f.pitch;
        const ang = Math.hypot(dyaw * Math.cos(f.pitch), dp);
        const max = this.floodSlew * dt * (this.dying ? 1.6 : 1);
        const k = ang > max && ang > 1e-6 ? max / ang : 1;
        f.yaw += dyaw * k; f.pitch += dp * k;
      }
      f.pan.quaternion.copy(this.bindQ.get(f.pan)!).multiply(_q.setFromAxisAngle(_v3.set(0, 1, 0), f.yaw));
      f.tilt.quaternion.copy(this.bindQ.get(f.tilt)!).multiply(_q.setFromAxisAngle(AX_X, f.pitch));
      const cp = Math.cos(f.pitch);
      f.dir.set(-cp * Math.sin(f.yaw), Math.sin(f.pitch), -cp * Math.cos(f.yaw));
      f.origin.copy(head).addScaledVector(f.dir, -K.lensZ + 0.02);
      // death flicker
      if (f.flicker >= 0) {
        f.flicker -= dt;
        const on = f.flicker > 0 && Math.sin(this.t * 61 + f.id * 7) > -0.2;
        if (f.light) { f.light.enabled = on; f.light.intensityScale = 0.4 + 0.6 * Math.abs(Math.sin(this.t * 37)); }
        f.beam.scale.setScalar(on ? 1 : OFF);
        if (f.flicker <= 0) { f.flicker = -1; f.alive = false; f.on = false; if (f.light) f.light.enabled = false; f.beam.scale.setScalar(OFF); f.droopV = -0.6; }
      }
      if (f.light) {
        f.light.position.copy(f.origin).addScaledVector(f.dir, 0.06);
        f.light.target.copy(f.origin).addScaledVector(f.dir, 12);
      }
    }
  }

  /** Each fall aimed from its trolley sheave to its grab sheave and stretched to the length (+ the run-out whip). */
  private aimRopes(): void {
    const B = this.B;
    const tw = B.trolley.matrixWorld;
    for (let i = 0; i < 4; i++) {
      const sx = i & 1 ? 1 : -1, sz = i & 2 ? 1 : -1;
      const bone = B[`rope_${i}`];
      let top = _v.copy(this.bindP.get(bone)!).applyMatrix4(tw);
      if (this.tails) {
        // the run-out tail: the bone moves to the falling end (parent-local = world − the trolley; it never rotates)
        top = _v.copy(this.tails.p[i]);
        bone.position.copy(top).sub(_v2.setFromMatrixPosition(tw));
        if (this.tails.gone) { bone.scale.setScalar(OFF); continue; }
      }
      const bot = _v2.set(sx * K.ropeX, K.grabSheaveY, sz * K.ropeZ).applyQuaternion(this.grabQ).add(this.grabPos);
      const d = _v3.copy(bot).sub(top);
      const len = Math.max(0.05, d.length());
      d.divideScalar(len);
      bone.quaternion.setFromUnitVectors(DOWN, d);
      if (this.whip > 0) {
        const a = 0.16 * this.whip * Math.sin(this.t * 13 + i * 1.7);
        bone.quaternion.premultiply(_q2.setFromAxisAngle(i & 1 ? AX_X : AX_Z, a));
      }
      bone.scale.set(1, len / K.rope, 1);
    }
  }

  private points(): void {
    const B = this.B;
    this.grabTop.copy(this.grabPos);
    this.grabBottom.set(this.grabPos.x, this.bottomY, this.grabPos.z);
    this.podCenter.setFromMatrixPosition(B.pod.matrixWorld);
    this.sensor.set(K.sensor[0], K.sensor[1], K.sensor[2]).add(this.podCenter);
    this.pa.setFromMatrixPosition(B.pa.matrixWorld);
    _m.extractRotation(B.pa.matrixWorld);
    this.pa.addScaledVector(_v.set(0, 0.25, 0).applyMatrix4(_m), 1);
  }

  // ───────────────────────────────────────────── death (§5.6.8)

  private deathStep(dt: number): void {
    const S = this.death!;
    S.t += dt; S.phaseT += dt;
    const o = S.o;
    if (S.phase === 'lurch') {
      // the failing drive: the hoist claws up to clear height, then bridge and trolley stutter toward the well's centre
      S.lift.set(Math.max(this.hoistY, o.clearY + K.grabH + 0.2));
      this.hoistY = S.lift.step(dt);
      const clear = this.hoistY - K.grabH >= o.clearY - 0.05;
      if (clear) {
        S.lurchX.set(o.well.x); S.lurchZ.set(o.well.z);
        // stutter: the drive cuts in and out
        const surge = 0.62 + 0.38 * Math.sin(S.t * 7.3) * Math.sin(S.t * 2.3 + 1);
        S.lurchX.maxSpeed = 4.5 * surge; S.lurchZ.maxSpeed = 4.5 * surge;
        this.trolleyX = S.lurchX.step(dt);
        this.bridgeZ = S.lurchZ.step(dt);
        S.jerkT -= dt;
        if (S.jerkT <= 0) {
          S.jerkT = 0.35 + Math.random() * 0.4;
          const kx = (Math.random() - 0.5) * 0.9, kz = (Math.random() - 0.5) * 0.9;
          this.kickRaw(kx, kz);
          this.cue('drive_fail', _v.setFromMatrixPosition(this.B.trolley.matrixWorld));
        }
      }
      const there = Math.abs(this.trolleyX - o.well.x) < 0.35 && Math.abs(this.bridgeZ - o.well.z) < 0.35;
      if (clear && there && S.phaseT >= o.lurch && (Math.abs(this.sway.x) + Math.abs(this.sway.y) < 0.12 || S.phaseT > o.lurch + 4)) {
        S.phase = 'fall'; S.phaseT = 0;
        this.holdTarget = 1;
        this.fallAt = this.grabPos.clone();
        const tp = _v.setFromMatrixPosition(this.B.trolley.matrixWorld);
        this.cue('brake_release', tp);
        this.cue('rope_run', tp);
        S.ropeT = 0;
        // the bridge loses its drive too and coasts on into its nearer buffer
        const toMin = this.bridgeZ - this.G.zMin, toMax = this.G.zMax - this.bridgeZ;
        const to = toMin <= toMax ? this.G.zMin : this.G.zMax;
        const dist = Math.abs(to - this.bridgeZ);
        const v0 = Math.sign(to - this.bridgeZ) * Math.min(2.6, Math.sqrt(0.64 + 2 * 0.35 * dist));
        S.bridge = { v: v0, a: dist > 0.05 ? (v0 * v0 - 0.64) / (2 * dist) : 0, to, hit: dist <= 0.05, bounce: 0, stopT: -1 };
        this.cue('coast', _v.set(this.G.railXW, this.G.railY + 0.8, this.bridgeZ));
      }
    } else {
      // free fall on slipping brakes, dragged once under water
      if (S.phase === 'fall') {
        S.fallV += 19 * dt;
        if (S.splashed) S.fallV *= Math.exp(-2.8 * dt);
        this.hoistY -= S.fallV * dt;
        const bottom = this.hoistY - K.grabH;
        if (!S.splashed && bottom <= o.well.y) {
          S.splashed = true;
          this.cue('splash', _v.set(this.grabPos.x, o.well.y, this.grabPos.z));
          S.floodAt = [0.15, 0.6, 1.05, 1.5].map((x) => S.t + x);
        }
        if (bottom <= o.floorY) {
          this.hoistY = o.floorY + K.grabH; S.phase = 'sunk'; S.phaseT = 0;
          // the drums run empty: the four rope ends leave the sheaves and fall whipping into the well
          const tw = this.B.trolley.matrixWorld;
          this.tails = { p: [0, 1, 2, 3].map((i) => this.bindP.get(this.B[`rope_${i}`])!.clone().applyMatrix4(tw)), v: 0, water: o.well.y, gone: false };
        }
      }
      // floods die one by one over 1.5 s after the splash (order 1, 3, 2, 4)
      if (S.splashed) {
        const order: FloodId[] = [1, 3, 2, 4];
        order.forEach((id, k) => {
          if (S.floodDone[k] || S.t < S.floodAt[k]) return;
          S.floodDone[k] = true;
          const f = this.fl(id);
          if (f.alive && f.on) { f.flicker = 0.28; this.cue('flood_out', f.origin, { flood: id }); }
          else if (f.alive) { f.alive = false; }
        });
      }
      // the bridge coasting into its buffer, a short rebound, then still
      const br = S.bridge;
      if (!br.hit) {
        const sgn = Math.sign(br.v);
        br.v -= sgn * br.a * dt;
        if (Math.sign(br.v) !== sgn) br.v = sgn * 0.3;
        this.bridgeZ += br.v * dt;
        if ((br.to - this.bridgeZ) * sgn <= 0) {
          this.bridgeZ = br.to; br.hit = true; br.bounce = -sgn * 0.5;
          this.cue('buffer', _v.set(this.G.railXW, this.G.railY + 0.75, br.to + sgn * (K.truckLen / 2 + 0.4)));
        }
      } else if (br.stopT < 0) {
        br.bounce -= br.bounce * Math.min(1, dt * 3.0);
        this.bridgeZ += br.bounce * dt;
        if (Math.abs(br.bounce) < 0.02) br.stopT = 0;
      } else br.stopT += dt;
      // the ropes run out whipping; their tails fall after the grab and are gone under the water
      if (S.ropeT >= 0) { S.ropeT += dt; this.whip = S.phase === 'fall' ? 1 : Math.max(0, 1 - S.phaseT / 1.6); }
      const tl = this.tails;
      if (tl && !tl.gone) {
        tl.v += 19 * dt;
        for (let i = 0; i < 4; i++) {
          const p = tl.p[i];
          p.y -= tl.v * dt;
          // drawn in toward the grab's falls as they go (the rope follows its own length into the well)
          const k = Math.min(1, dt * 1.5);
          p.x += (this.grabPos.x + (i & 1 ? 1 : -1) * K.ropeX - p.x) * k;
          p.z += (this.grabPos.z + (i & 2 ? 1 : -1) * K.ropeZ - p.z) * k;
        }
        if (tl.p[0].y < tl.water - 0.6) tl.gone = true;
      }
      // DEAD once the grab is down, the floods are out and the ropes are gone (≈ 2.5 s after the brakes); the bridge's
      // coast into its buffer is an epilogue that runs on while `update` is called (`settled` when it has stopped)
      if (!S.done && S.phase === 'sunk' && !!this.tails?.gone && S.floodDone.every(Boolean) && this.floods.every((f) => f.flicker < 0) && this.whip <= 0) {
        S.done = true;
        this.dead = true; this.dying = false;
        this.cue('done', this.grabBottom);
        S.resolve();
      }
      if (S.done && br.stopT >= 0.8) { this.settled = true; this.death = null; }
    }
  }
  private kickRaw(vx: number, vz: number): void { const L = Math.max(0.5, this.ropeLen()); this.swayV.x += vx / L; this.swayV.y += vz / L; }
}
