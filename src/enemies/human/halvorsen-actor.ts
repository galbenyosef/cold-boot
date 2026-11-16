/**
 * §8.8 (stage 3a) — HALVORSEN runtime: the Human actor (human.ts: walk, attention auto | pinned | rest, eyes → head →
 * body, glass sight, flinch, blinks, speech) with his own body (halvorsen.ts), head (head2.ts), poses, props and a
 * body collider. Created by `enemies.actor('human', pos, yaw, pose, { who: 'halvorsen' })`.
 *
 * Poses (setPose; aliases in brackets):
 *   standing — idle [stand_idle, walk], talk, startle, beckon, hand_badge, back_away [back_away_corner], cower,
 *              lock_door, phone_ear [phone] / phone_down (with a phone base set)
 *   seated   — sit_desk, sit_lean_back, turn_monitor, give, phone_ear [phone], phone_down, hand_badge, cower
 *   one-shot — flinch, rub_face (overlays; the pose is kept)
 * Seated: his `position` is the centre of the chair seat (seat top 0.47 m), facing the desk; the desk's front edge is
 * `desk.front` m ahead (default 0.32), its top `desk.top` m up (default 0.76). Leaving a seated pose for a standing one
 * (or moveTo) rises: he ends up standing 0.25 m further forward (in front of the chair); sitting down from a stand
 * moves him back by the same amount. `phone_ear`, `hand_badge` and `cower` take the seated or standing variant from
 * the pose he is in.
 *
 * Props (`prop(name, value)` — on the actor handle as `prop?`, see enemies/index.ts):
 *   glasses      'auto' (default: on the nose when seated, pushed up otherwise) | 'nose' | 'up' | 'hang' | 'off'
 *   mug          true | false (right hand; standing only — seated he has put it down)
 *   badge        'lanyard' (default) | 'hand' | 'desk' | 'none'   (hand_badge / give move it themselves)
 *   badgeTarget  Vector3 | null — where `give` slides the badge to on the desk (world; default 0.75 m past the edge)
 *   monitor      Object3D | null — the swivel monitor `turn_monitor` grabs and turns half a turn about its own Y
 *   phone        Vector3 | null — the cradle (world) of the desk phone; the receiver + cord are his (drawn while set)
 *   panel        Vector3 | null — the wall panel `lock_door` presses (world; default 0.45 m ahead, right, 1.32 m)
 *   desk         { front?, top? } — metres from his position along his facing / above the floor
 *   expr         'auto' | 'neutral' | 'worry' | 'fear' | 'disbelief' — brows + lids (auto: from the pose)
 */
import * as THREE from 'three';
import type { DynamicBox } from '../../core/types';
import type { EnemyWorld } from '../ai';
import type { FactoryOpts } from '../manager';
import { noise1, smooth, spring, type Spring } from '../shared/ik';
import { Human, type HPose } from './human';
import { HUMAN_DIM as K, type HumanTemplate } from './model';
import { HALV } from './halvorsen';

export const HALV_POSES = ['idle', 'talk', 'startle', 'beckon', 'sit_desk', 'sit_lean_back', 'turn_monitor', 'phone_ear', 'phone_down', 'hand_badge', 'give', 'back_away', 'cower', 'lock_door'] as const;
const ALIAS: Record<string, string> = { stand_idle: 'idle', standing: 'idle', walk: 'idle', back_away_corner: 'back_away', phone: 'phone_ear', sit: 'sit_desk' };
const SEATED = new Set(['sit_desk', 'sit_lean_back', 'turn_monitor', 'give']);
const EITHER = new Set(['phone_ear', 'phone_down', 'hand_badge', 'cower']);
/** World metres he moves when he rises from the chair (forward, and to the `riseSide`) — and back when he sits down. */
const RISE_FWD = 0.12, RISE_SIDE = 0.5;

export type GlassesState = 'auto' | 'nose' | 'up' | 'hang' | 'off';
export type BadgeState = 'lanyard' | 'hand' | 'desk' | 'none';
export type Expr = 'auto' | 'neutral' | 'worry' | 'fear' | 'disbelief';

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _fw = new THREE.Vector3(), _pl = new THREE.Vector3();
const _e = new THREE.Euler();
const _s3 = new THREE.Vector3(), _task = new THREE.Vector3();

interface HState {
  seated: boolean;
  desk: { front: number; top: number };
  glasses: GlassesState; glassK: Spring;
  mug: boolean; mugJolt: Spring;
  badge: BadgeState;
  cardW: THREE.Matrix4; cardFrom: THREE.Vector3; cardTo: THREE.Vector3; cardQ0: THREE.Quaternion; cardQ1: THREE.Quaternion; slideT: number;
  badgeTarget: THREE.Vector3 | null;
  monitor: THREE.Object3D | null; monYaw0: number; monSign: number; monEdge: number; monArmed: boolean;
  phoneBase: THREE.Vector3 | null; phoneK: number;
  panel: THREE.Vector3 | null;
  expr: Expr;
  rubT: number;
  box: DynamicBox | null;
  cord: THREE.Mesh | null;
  lidU: Spring; lidL: Spring; browUp: Spring; browIn: Spring;
  gaveT: number;
  restPose: string;
  /** A pose change decided inside the pose code, applied before the next frame's pose. */
  pending: string | null;
  /** Which side he gets out of the chair: −1 his right (default), +1 his left. */
  riseSide: number;
}

export class Halvorsen extends Human {
  readonly who = 'halvorsen';

  constructor(world: EnemyWorld, tpl: HumanTemplate, group: string, position: THREE.Vector3, yaw: number, o: FactoryOpts) {
    super(world, tpl, group, position, yaw, o);
    this.attachHead2();
    this.stride = 0.86;
    this.boundRadius = 1.4;
  }

  /** Lazily created (the base constructor already runs poses and a tick before our fields would exist). */
  private get H(): HState {
    const self = this as unknown as { _h?: HState };
    return (self._h ??= {
      seated: false, desk: { front: 0.32, top: 0.76 },
      glasses: 'auto', glassK: { x: 1, v: 0 },
      mug: false, mugJolt: { x: 0, v: 0 },
      badge: 'lanyard',
      cardW: new THREE.Matrix4(), cardFrom: new THREE.Vector3(), cardTo: new THREE.Vector3(), cardQ0: new THREE.Quaternion(), cardQ1: new THREE.Quaternion(), slideT: -1,
      badgeTarget: null,
      monitor: null, monYaw0: 0, monSign: 1, monEdge: 1, monArmed: false,
      phoneBase: null, phoneK: 0,
      panel: null,
      expr: 'auto',
      rubT: -1,
      box: null, cord: null,
      lidU: { x: 0, v: 0 }, lidL: { x: 0, v: 0 }, browUp: { x: 0, v: 0 }, browIn: { x: 0, v: 0 },
      gaveT: -1,
      restPose: 'idle',
      pending: null,
      riseSide: -1,
    });
  }

  // ───────────────────────────────────────────── story-facing API

  /** Props and settings (see the file header). Unknown names warn once. */
  prop(name: string, value: unknown): void {
    const H = this.H;
    switch (name) {
      case 'glasses': H.glasses = (['auto', 'nose', 'up', 'hang', 'off'].includes(value as string) ? value : 'auto') as GlassesState; break;
      case 'mug': H.mug = !!value; break;
      case 'badge': {
        const v = (['lanyard', 'hand', 'desk', 'none'].includes(value as string) ? value : 'lanyard') as BadgeState;
        if (v === 'desk' && H.badge !== 'desk') { this.syncWorld(); this.cardWorld(H.cardW); H.slideT = -1; }
        H.badge = v; break;
      }
      case 'badgeTarget': H.badgeTarget = value instanceof THREE.Vector3 ? value.clone() : null; break;
      case 'monitor': H.monitor = (value as THREE.Object3D)?.isObject3D ? value as THREE.Object3D : null; H.monArmed = false; break;
      case 'phone': H.phoneBase = value instanceof THREE.Vector3 ? value.clone() : null; break;
      case 'panel': H.panel = value instanceof THREE.Vector3 ? value.clone() : null; break;
      case 'desk': { const d = value as { front?: number; top?: number }; if (d && Number.isFinite(d.front)) H.desk.front = d.front!; if (d && Number.isFinite(d.top)) H.desk.top = d.top!; break; }
      case 'riseSide': H.riseSide = Number(value) > 0 ? 1 : -1; break;
      case 'expr': H.expr = (['auto', 'neutral', 'worry', 'fear', 'disbelief'].includes(value as string) ? value : 'auto') as Expr; break;
      default: console.warn(`[enemies] halvorsen: unknown prop "${name}"`);
    }
  }
  /** Current state (dev / tests). */
  get props(): { pose: string; seated: boolean; glasses: GlassesState; badge: BadgeState; mug: boolean } {
    const H = this.H;
    return { pose: this.pose, seated: H.seated, glasses: H.glasses, badge: H.badge, mug: H.mug };
  }

  // ───────────────────────────────────────────── head

  private attachHead2(): void {
    const h = this.tpl.head2;
    if (!h) {
      // procedural fallback head stays; it is left out of the shadow proxy, so it casts its own shadow
      for (const m of this.rig.meshes) if (m.userData.key === 'face' || m.userData.key === 'hair') m.castShadow = true;
      return;
    }
    const add = (g: THREE.BufferGeometry, m: THREE.Material, cast = false) => {
      const mesh = new THREE.SkinnedMesh(g, m);
      mesh.bind(this.rig.skeleton, new THREE.Matrix4());
      mesh.castShadow = cast; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.key = 'scan';
      this.rig.root.add(mesh);
      return mesh;
    };
    add(h.mouth, h.mouthMat);
    add(h.teeth, h.teethMat);
    add(h.face, h.faceMat, true);
    this.rig.setKeysVisible(['face', 'hair'], false);
  }

  // ───────────────────────────────────────────── poses

  protected override poseName(p: string | undefined): HPose {
    if (!p) return 'idle';
    const base = p.indexOf(':') > 0 ? p.slice(0, p.indexOf(':')) : p;
    const n = ALIAS[base] ?? base;
    if ((HALV_POSES as readonly string[]).includes(n)) return n;
    console.warn(`[enemies] halvorsen: unknown pose "${p}" → idle`);
    return 'idle';
  }

  private seatedPose(n: string): boolean { return SEATED.has(n) || (EITHER.has(n) && this.H.seated); }

  protected override setPoseNow(p: HPose): void {
    const H = this.H;
    const wasSeated = H.seated;
    const nowSeated = this.seatedPose(p);
    // rising / sitting down after the first frame: the chair stays where it is
    if (this.stateTime > 0 && wasSeated !== nowSeated) {
      // he gets up out of the chair to one side (the chair does not move), a little forward; sits back the same way
      const k = nowSeated ? -1 : 1, side = H.riseSide;
      const fx = RISE_FWD * k, sx = RISE_SIDE * side * k;
      this.rigPoint(sx / this.S, 0, fx / this.S, _a);
      const dx = _a.x - this.body.position.x, dz = _a.z - this.body.position.z;
      this.body.position.x += dx; this.body.position.z += dz;
      const o = this.rig.bones.length * 4;
      this.snap[o] -= sx / this.S; this.snap[o + 2] -= fx / this.S;
    }
    H.seated = nowSeated;
    if (p !== 'phone_down' && p !== 'phone_ear') H.restPose = nowSeated ? (p === 'sit_lean_back' ? 'sit_lean_back' : 'sit_desk') : 'idle';
    if (p === 'turn_monitor') H.monArmed = false;
    if (p === 'give' || p === 'hand_badge') H.gaveT = -1;
    super.setPoseNow(p);
  }

  protected override blendFor(n: HPose): number {
    const a = this.seatedPose(n), b = this.H.seated;
    if (a !== b) return 1.1;
    if (n === 'startle') return 0.12;
    if (n === 'phone_down' || n === 'phone_ear' || n === 'turn_monitor' || n === 'give' || n === 'hand_badge') return 0.35;
    return 0.5;
  }

  protected override oneShot(p: string): boolean {
    if (p === 'rub_face') { this.H.rubT = 0; return true; }
    if (p === 'blink') { this.blinkSoon(); return true; }
    return false;
  }

  protected override standForWalking(): void { if (this.H.seated || this.pose !== 'idle' && this.pose !== 'talk' && this.pose !== 'back_away') this.puppetPose(this.pose === 'back_away' ? 'back_away' : 'idle'); }
  protected override defaultSpeed(): number { return this.pose === 'back_away' ? 0.5 : 1.05; }
  protected override fixedFacing(): boolean { return this.H.seated; }
  protected override walksIn(): boolean { return !this.H.seated && (this.pose === 'idle' || this.pose === 'talk' || this.pose === 'back_away'); }
  protected override gaitLift(): number { return 0.042 + 0.014 * Math.min(1, this.curSpeed); }
  protected override standingLegs(): boolean { return !this.H.seated; }
  protected override seatedLook(): boolean { return this.H.seated; }
  protected override flinchable(): boolean { return true; }
  protected override breathRate(): number {
    const p = this.pose;
    return p === 'cower' || p === 'back_away' ? 0.62 : p === 'startle' ? 0.5 : this.H.seated ? 0.21 : 0.25;
  }
  protected override trembles(): number { return this.pose === 'cower' || this.pose === 'back_away' ? 1 : this.pose === 'hand_badge' || this.pose === 'give' ? 0.35 : 0; }

  protected override adjustStance(fl: THREE.Vector3, fr: THREE.Vector3, hipsY: number): number {
    const p = this.pose, u = this.poseT;
    // a heavier man stands a little wider, toes out
    fl.x += 0.014; fr.x -= 0.012;
    hipsY += 0.004;
    if (p === 'startle') {
      const back = smooth((u - 0.04) / 0.28);
      fl.z -= 0.12 * back; hipsY -= 0.018 * smooth(u / 0.1) * (1 - 0.7 * smooth((u - 0.5) / 0.8));
      this.B.hips.position.z -= 0.05 * back;
    } else if (p === 'cower') {
      fl.set(0.15, 0, 0.09); fr.set(-0.15, 0, -0.02);
      hipsY -= 0.13;
      this.B.hips.position.z -= 0.06;
    } else if (p === 'lock_door' || p === 'hand_badge') {
      fl.z -= 0.03; fr.z += 0.07;
    }
    return hipsY;
  }

  protected override walkArms(ph: number): void {
    const sw = 0.2 * Math.min(1.2, this.curSpeed / 1.1) * this.walkW * this.travel;
    this.arm(1, 0.04 + sw * Math.cos(ph), 0.1, 0.15, 0.3 + 0.2 * Math.max(0, -Math.cos(ph)) * this.walkW);
    this.arm(-1, 0.04 - sw * Math.cos(ph) * (this.H.mug ? 0.4 : 1), 0.1, 0.15, 0.3 + 0.2 * Math.max(0, Math.cos(ph)) * this.walkW);
    // heavier, slower walker: more sway, a forward lean
    this.mulE(this.B.hips, 0, 0, 0.02 * Math.sin(ph) * this.walkW);
    this.B.hips.position.x += 0.008 * Math.sin(ph) * this.walkW;
    this.mulE(this.B.spine1, 0.04 * this.walkW, 0, 0, 'YXZ');
  }

  /** Rounded upper back, shoulders forward, head carried forward (face kept level). */
  private stoop(k = 1): void {
    const B = this.B;
    this.mulE(B.spine2, 0.07 * k, 0, 0, 'YXZ');
    this.mulE(B.neck, 0.12 * k, 0, 0, 'YXZ');
    this.mulE(B.head, -0.12 * k, 0, 0, 'YXZ');
    this.mulE(B.clav_l, 0, -0.07 * k, 0); this.mulE(B.clav_r, 0, 0.07 * k, 0);
  }

  protected override poseIdle(dt: number, br: number): void {
    const B = this.B, t = this.world.time, w = this.world;
    this.stoop();
    // arms clear the belly; small life
    this.mulE(B.uarm_l, 0.05 + noise1(t * 0.31, this.seed + 1) * 0.03, 0, 0.025 + noise1(t * 0.27, this.seed + 2) * 0.02);
    this.mulE(B.uarm_r, 0.05 + noise1(t * 0.29, this.seed + 3) * 0.03, 0, -0.025 - noise1(t * 0.33, this.seed + 4) * 0.02);
    void br;
    if (this.H.mug && this.walkW < 0.3) this.holdMug(1 - this.walkW / 0.3);
    if (this.walkW > 0.3) { this.fidget = null; return; }
    if (!this.fidget) {
      this.fidgetTimer -= dt;
      if (this.fidgetTimer <= 0) {
        const r = w.rand();
        const kind = this.H.mug ? (r < 0.6 ? 'sip' : 'neck') : r < 0.3 ? 'neck' : r < 0.55 ? 'glasses' : r < 0.8 ? 'belly' : 'face';
        this.fidget = { kind, t: 0, dur: kind === 'belly' ? 6 + w.rand() * 4 : kind === 'sip' ? 2.6 : kind === 'neck' ? 3 : 2.2 };
      }
      return;
    }
    const f = this.fidget;
    f.t += dt;
    if (f.t >= f.dur) { this.fidget = null; this.fidgetTimer = 7 + w.rand() * 9; return; }
    const k = smooth(f.t / 0.5) * (1 - smooth((f.t - (f.dur - 0.6)) / 0.6));
    this.syncWorld();
    if (f.kind === 'neck') {
      const rub = Math.sin(f.t * 6) * 0.018;
      this.headPoint(0.035 + rub, 1.52, -0.075, _a);
      this.ikArm(1, _a, 0.2, -0.3, 0.9, k);
      this.mulE(B.neck, 0.12 * k, 0, -0.06 * k); this.mulE(B.head, 0.08 * k, 0.08 * k, 0);
      this.fingers(1, 0.55 * k + 0.45 * (1 - k));
    } else if (f.kind === 'glasses') {
      this.headPoint(-0.07, 1.65, 0.075, _a);
      this.ikArm(-1, _a, -0.5, -0.3, 0.3, k, true);
      this.fingers(-1, 0.5 * k + 0.4);
    } else if (f.kind === 'belly') {
      this.rigPoint(0.03, 1.0, 0.205, _a); this.ikArm(1, _a, -0.4, -0.5, 0.2, k);
      this.rigPoint(-0.035, 0.99, 0.2, _a); this.ikArm(-1, _a, -0.4, -0.5, 0.2, k);
      this.palmTo(1, _fw.set(-0.8, -0.2, 0.3), _pl.set(0, 0, -1)); this.palmTo(-1, _fw.set(0.8, -0.2, 0.3), _pl.set(0, 0, -1));
      this.fingers(1, 0.6); this.fingers(-1, 0.6);
    } else if (f.kind === 'sip') {
      const lift = smooth((f.t - 0.3) / 0.7) * (1 - smooth((f.t - 1.7) / 0.6));
      this.headPoint(-0.035, 1.52, 0.2, _a);
      this.rigPoint(-0.12, 1.02, 0.28, _b);
      _a.lerp(_b, 1 - lift);
      this.ikArm(-1, _a, -0.5, -0.2, 0.5, 1);
      this.palmTo(-1, _fw.set(0.55, 0.15, 0.8), _pl.set(1, 0, -0.2));
      this.fingers(-1, 1.1, 0.7);
      this.mulE(B.head, -0.12 * lift, 0, 0);
      this.H.mugJolt.x = -0.35 * smooth((f.t - 0.9) / 0.3) * (1 - smooth((f.t - 1.5) / 0.3));
    } else {
      const rub = Math.sin(f.t * 5.5) * 0.012 * k;
      this.headPoint(0.03, 1.6 + rub, 0.15, _a); this.ikArm(1, _a, -0.6, -0.4, 0.0, k, true);
      this.headPoint(-0.03, 1.6 - rub, 0.15, _a); this.ikArm(-1, _a, -0.6, -0.4, 0.0, k, true);
      this.mulE(B.neck, 0.16 * k, 0, 0); this.mulE(B.head, 0.1 * k, 0, 0);
    }
  }

  /** Right hand holds the mug in front of the belly (k = 1) — the mug bone keeps it upright (props). */
  private holdMug(k: number): void {
    this.syncWorld();
    this.rigPoint(-0.13, 1.0, 0.27, _a);
    this.ikArm(-1, _a, -0.5, -0.25, 0.3, k);
    if (k > 0.5) this.palmTo(-1, _fw.set(0.45, 0.0, 0.9), _pl.set(1, 0, -0.3));
    this.fingers(-1, 1.1 * k + 0.45 * (1 - k), 0.7);
  }

  protected override poseTalk(dt: number, br: number): void {
    const B = this.B;
    void dt; void br;
    this.stoop(0.8);
    const g = this.gest.x, g2 = this.gest2.x;
    const free = this.H.mug ? 1 : -1;
    // the free hand explains, palm up, at belly height; the other rests (or holds the mug)
    this.arm(free, -0.32 - 0.28 * g, 0.25 * g2, 0.24 + 0.08 * g, 1.25 + 0.35 * g);
    this.rotE(free > 0 ? B.hand_l : B.hand_r, -0.15, free * (0.9 - 0.6 * g), 0.1 * g2);
    this.fingers(free, 0.3 - 0.18 * g);
    if (this.H.mug) this.holdMug(1);
    else {
      this.arm(1, -0.1 - 0.12 * Math.max(0, g2), 0.15, 0.2, 0.55 + 0.25 * Math.max(0, g2));
      this.fingers(1, 0.5);
    }
    this.mulE(B.spine2, 0, -0.05 * g2, 0, 'YXZ');
  }

  protected override poseBackAway(t: number, tr: (k: number) => number): void {
    const B = this.B;
    this.mulE(B.spine1, -0.04, 0, 0, 'YXZ'); this.mulE(B.spine2, 0.02 + tr(1), tr(2), 0, 'YXZ');
    this.mulE(B.neck, 0.04, 0, 0); this.mulE(B.head, -0.06 + tr(3), tr(4) * 2, 0);
    this.syncWorld();
    for (const side of [1, -1]) {
      // hands up, palms out: "stay back"
      this.rigPoint(side * 0.2, 1.22 + tr(5 + side) * 2, 0.3, _a);
      this.ikArm(side, _a, -0.6, -0.2, 0.4, 1);
      this.palmTo(side, _fw.set(side * 0.15, 0.95, 0.2), _pl.set(0, 0.1, 1));
      this.fingers(side, 0.18, 0.15);
    }
    void t;
  }

  protected override extraPose(dt: number, t: number, br: number, tr: (k: number) => number): void {
    switch (this.pose) {
      case 'startle': this.poseStartle(t); break;
      case 'beckon': this.poseBeckon(t); break;
      case 'sit_desk': this.seatBase(br, 0); this.deskArms(1); break;
      case 'sit_lean_back': this.poseLeanBack(br); break;
      case 'turn_monitor': this.poseTurnMonitor(br); break;
      case 'phone_ear': case 'phone_down': this.posePhone(br, tr); break;
      case 'hand_badge': this.poseHandBadge(br, tr); break;
      case 'give': this.poseGive(br, tr); break;
      case 'cower': this.poseCower(t, br, tr); break;
      case 'lock_door': this.poseLockDoor(t); break;
    }
    if (!this.H.seated && this.pose !== 'cower' && this.pose !== 'back_away' && this.pose !== 'startle') this.stoop(this.pose === 'idle' || this.pose === 'talk' ? 0 : 0.8);
    this.rubFaceOverlay(dt);
  }

  // ── standing

  private poseStartle(t: number): void {
    const B = this.B, u = this.poseT;
    const k = smooth(u / 0.1) * (1 - 0.55 * smooth((u - 0.45) / 0.9));
    this.mulE(B.spine1, -0.1 * k, 0, 0, 'YXZ'); this.mulE(B.spine2, -0.06 * k, 0, 0, 'YXZ');
    this.mulE(B.neck, -0.08 * k, 0, 0); this.mulE(B.head, -0.1 * k, 0, 0);
    this.rotE(B.clav_l, 0, 0, 0.13 * k + 0.02); this.rotE(B.clav_r, 0, 0, -0.13 * k - 0.02);
    this.syncWorld();
    // free (left) hand flies to the chest; the mug hand jerks up
    this.rigPoint(0.05, 1.27, 0.2 + 0.02 * Math.sin(t * 9) * (1 - k), _a);
    this.ikArm(1, _a, -0.4, -0.3, 0.2, k);
    this.palmTo(1, _fw.set(-0.4, 0.8, 0.2), _pl.set(0, 0, -1));
    this.fingers(1, 0.35 * k + 0.4 * (1 - k));
    const jolt = Math.sin(Math.PI * smooth(u / 0.35)) * (u < 0.35 ? 1 : 0);
    if (this.H.mug) {
      this.rigPoint(-0.14, 1.03 + 0.09 * jolt + 0.03 * k, 0.29 - 0.03 * jolt, _a);
      this.ikArm(-1, _a, -0.5, -0.25, 0.3, 1);
      this.palmTo(-1, _fw.set(0.45, 0.0, 0.9), _pl.set(1, 0, -0.3));
      this.fingers(-1, 1.1, 0.7);
      if (u < 0.35) this.H.mugJolt.x = -0.55 * jolt;
    } else {
      this.rigPoint(-0.16, 1.15 + 0.05 * jolt, 0.26, _a);
      this.ikArm(-1, _a, -0.5, -0.2, 0.4, k);
      this.palmTo(-1, _fw.set(0.1, 0.9, 0.3), _pl.set(0, 0, 1));
      this.fingers(-1, 0.2);
    }
  }

  private poseBeckon(t: number): void {
    const B = this.B, u = this.poseT;
    const side = this.H.mug ? 1 : -1;
    const CYC = 3.2, c = u % CYC;
    const up = smooth(c / 0.35) * (1 - smooth((c - 1.6) / 0.45));
    const curl = c > 0.35 && c < 1.55 ? 0.5 - 0.5 * Math.cos((c - 0.35) / 0.6 * Math.PI * 2) : 0;
    if (this.H.mug) this.holdMug(1);
    this.syncWorld();
    this.rigPoint(side * 0.2, 1.17 + 0.02 * curl, 0.33 - 0.03 * curl, _a);
    this.ikArm(side, _a, -0.5, -0.2, 0.35, up);
    if (up > 0.3) this.palmTo(side, _fw.set(side * 0.25, 0.25, 1), _pl.set(0, 1, -0.15));
    this.fingers(side, 0.15 + 1.1 * curl * up, 0.2);
    // a nod and a half-turn toward where he is going (his free-hand side)
    this.mulE(B.spine2, 0, side * 0.12 * up, 0, 'YXZ');
    this.mulE(B.head, 0.1 * curl * up, side * 0.15 * up, 0, 'YXZ');
    void t;
  }

  private poseLockDoor(t: number): void {
    const B = this.B, u = this.poseT;
    const P = this.panelPoint(_c);
    const reach = smooth(u / 0.55);
    const tap = u > 0.55 && u < 2.0 ? Math.max(0, Math.sin((u - 0.55) * Math.PI * 2 * 2.6)) : 0;
    this.mulE(B.spine1, 0.06 * reach, 0, 0, 'YXZ'); this.mulE(B.spine2, 0.04 * reach, -0.08 * reach, 0, 'YXZ');
    this.syncWorld();
    _a.copy(P);
    // hand stops a palm's thickness short of the panel; taps press in 1 cm
    this.toRigDir(_b.set(0, 0, 1), _d);
    _a.addScaledVector(_d, -(0.03 - 0.012 * tap) * this.S);
    this.ikArm(-1, _a, -0.3, -0.1, 0.35, reach);
    if (reach > 0.4) this.palmTo(-1, _fw.set(0.15, 0.95, 0.1), _pl.set(0, 0, 1));
    this.fingers(-1, 0.1 + 0.25 * tap, 0.1);
    void t;
  }

  // ── seated

  private seatY(): number { return 0.47 / this.S; }
  private dF(): number { return this.H.desk.front / this.S; }
  private dT(): number { return this.H.desk.top / this.S; }

  /** Seated hips / spine / legs. lean: extra forward lean (rad). */
  private seatBase(br: number, lean: number, back = 0): void {
    const B = this.B, t = this.world.time, sd = this.seed;
    const sigh = Math.max(0, noise1(t * 0.11, sd + 7));
    B.hips.position.set(0, this.seatY() + 0.135, -0.02 + 0.06 * lean - 0.05 * back);
    this.rotE(B.hips, 0.03 + 0.15 * lean - 0.2 * back, 0, 0);
    this.rotE(B.spine1, 0.16 + br * 0.01 + sigh * 0.04 + 0.35 * lean - 0.12 * back, 0, 0, 'YXZ');
    this.rotE(B.spine2, 0.16 + br * 0.02 + 0.15 * lean, 0, 0, 'YXZ');
    this.rotE(B.neck, 0.14 - 0.2 * lean + 0.1 * back, 0, 0, 'YXZ'); this.rotE(B.head, -0.06 - 0.15 * lean + 0.02 * back, 0, 0, 'YXZ');
    this.rotE(B.clav_l, 0, -0.06, 0.02); this.rotE(B.clav_r, 0, 0.06, -0.02);
    this.legsSeat(_a.set(0.14, 0, 0.47 + 0.1 * back), _b.set(-0.13, 0, 0.44 + 0.12 * back));
  }

  /** Forearms on the desk, palms down (k = 1), or hands in the lap (k = 0) when the desk is out of reach. */
  private deskArms(k: number, skip = 0): void {
    const B = this.B;
    this.syncWorld();
    const dF = this.dF(), dT = this.dT();
    for (const side of [1, -1]) {
      if (side === skip) continue;
      this.rigPoint(side * 0.135, dT + 0.034, dF + 0.15, _a);
      this.ikArm(side, _a, -0.9, -0.4, 0.15, k);
      this.palmTo(side, _fw.set(-side * 0.35, -0.08, 1), _pl.set(-side * 0.15, -1, 0));
      this.fingers(side, 0.35 + 0.05 * noise1(this.world.time * 0.3, this.seed + side), 0.3);
    }
    void B;
  }

  private poseLeanBack(br: number): void {
    const B = this.B;
    this.seatBase(br, 0, 1);
    this.syncWorld();
    // left forearm on the desk edge, right hand on his belly
    this.rigPoint(0.2, this.dT() + 0.034, this.dF() + 0.05, _a);
    this.ikArm(1, _a, -0.9, -0.4, 0.3, 1);
    this.palmTo(1, _fw.set(-0.3, -0.05, 1), _pl.set(0, -1, 0));
    this.fingers(1, 0.45);
    this.rigPoint(-0.04, this.seatY() + 0.3, 0.17, _a);
    this.ikArm(-1, _a, -0.6, -0.5, 0.3, 1);
    this.palmTo(-1, _fw.set(0.9, -0.2, 0.1), _pl.set(0, -0.2, -1));
    this.fingers(-1, 0.55);
    void B;
  }

  /** The monitor's grab point (world) — its edge nearer to him; the default point if no monitor is set. */
  private monitorGrab(out: THREE.Vector3): THREE.Vector3 {
    const H = this.H, m = H.monitor;
    if (!m) return this.rigPoint(-0.2, this.dT() + 0.32, this.dF() + 0.42, out);
    m.updateWorldMatrix(true, false);
    return out.set(0.275 * H.monEdge, 0, -0.01).applyMatrix4(m.matrixWorld);
  }

  private poseTurnMonitor(br: number): void {
    const H = this.H, B = this.B, u = this.poseT, m = H.monitor;
    if (!H.monArmed) {
      H.monArmed = true;
      if (m) {
        H.monYaw0 = m.rotation.y;
        // the edge nearer to his right shoulder, turned so that it is pushed away from him
        this.syncWorld();
        _c.setFromMatrixPosition(B.uarm_r.matrixWorld);
        m.updateWorldMatrix(true, false);
        const dl = _a.set(0.25, 0, 0).applyMatrix4(m.matrixWorld).distanceTo(_c), dr = _b.set(-0.25, 0, 0).applyMatrix4(m.matrixWorld).distanceTo(_c);
        H.monEdge = dl < dr ? 1 : -1;
        m.rotation.y = H.monYaw0 + 0.05; m.updateWorldMatrix(true, false);
        const d1 = _a.set(0.25 * H.monEdge, 0, 0).applyMatrix4(m.matrixWorld).distanceTo(_c);
        m.rotation.y = H.monYaw0; m.updateWorldMatrix(true, false);
        H.monSign = d1 > Math.min(dl, dr) ? 1 : -1;
      }
    }
    const reach = smooth(u / 0.65) * (1 - smooth((u - 1.5) / 0.65));
    const push = smooth((u - 0.7) / 0.8);
    const coast = smooth((u - 1.35) / 0.9);
    if (m) {
      m.rotation.y = H.monYaw0 + H.monSign * (1.7 * push + (Math.PI - 1.7) * coast);
      m.updateWorldMatrix(true, true);
    }
    const watch = smooth((u - 1.6) / 0.8);
    this.seatBase(br, 0.55 * reach + 0.15 * watch);
    this.deskArms(1, -1);
    this.syncWorld();
    // right hand: from the desk to the monitor's edge, follows it while pushing, lets go
    this.rigPoint(-0.135, this.dT() + 0.034, this.dF() + 0.15, _a);
    this.monitorGrab(_b);
    _a.lerp(_b, reach);
    this.ikArm(-1, _a, -0.4, -0.3, 0.45, 1);
    if (reach > 0.3) this.palmTo(-1, _fw.set(0.1, 0.9, 0.4), _pl.set(H.monEdge * H.monSign * 0.8, 0, 0.6));
    else this.palmTo(-1, _fw.set(0.35, -0.08, 1), _pl.set(0.15, -1, 0));
    this.fingers(-1, 0.35 + 0.35 * reach, 0.3);
  }

  // ── phone

  /** Receiver world transform: in the cradle (phoneK 0) → at his left ear (1). */
  private receiver(out: THREE.Matrix4): THREE.Matrix4 {
    const H = this.H;
    // cradle
    const base = H.phoneBase ?? this.rigPoint(0.3, this.dT() + 0.06, this.dF() + 0.16, _c);
    _q.setFromAxisAngle(Y, this.yaw + Math.PI).multiply(_q2.setFromEuler(_e.set(-Math.PI / 2, 0, Math.PI / 2, 'YXZ')));
    _m.compose(_a.copy(base).add(_d.set(0, 0.018, 0)), _q, _s3.set(1, 1, 1));
    // ear: ear cup at the left ear, mouthpiece toward the mouth corner, cups facing the head
    this.headPoint(0.088, 1.612, -0.01, _a);
    this.headPoint(0.05, 1.53, 0.085, _b);
    const yAx = _d.copy(_a).sub(_b).normalize();
    this.headPoint(0, 1.58, 0.0, _c);
    const zAx = _fw.copy(_c).sub(_a).normalize();
    zAx.addScaledVector(yAx, -zAx.dot(yAx)).normalize();
    const xAx = _pl.copy(yAx).cross(zAx);
    _m2.makeBasis(xAx, yAx, zAx);
    _q2.setFromRotationMatrix(_m2);
    _a.add(_b).multiplyScalar(0.5).addScaledVector(zAx, -0.022 * this.S);
    _m2.compose(_a, _q2, _s3.set(1, 1, 1));
    // blend with a lift in the middle
    const k = smooth(H.phoneK);
    const p0 = _b.setFromMatrixPosition(_m), p1 = _c.setFromMatrixPosition(_m2);
    const p = p0.lerp(p1, k); p.y += 0.08 * Math.sin(Math.PI * k);
    _q.setFromRotationMatrix(_m.extractRotation(_m)); _q2.setFromRotationMatrix(_m2.extractRotation(_m2));
    _q.slerp(_q2, k);
    return out.compose(p, _q, _s3.set(this.S, this.S, this.S));
  }

  private posePhone(br: number, tr: (k: number) => number): void {
    const H = this.H, B = this.B, u = this.poseT;
    let reach: number;
    if (this.pose === 'phone_ear') {
      reach = smooth(u / 0.45);
      H.phoneK = smooth((u - 0.4) / 0.65);
    } else {
      H.phoneK = Math.min(H.phoneK, 1 - smooth(u / 0.75));
      reach = 1 - smooth((u - 0.75) / 0.45);
      if (u > 1.3 && !H.pending) H.pending = H.restPose;
    }
    if (H.seated) { this.seatBase(br, 0.1 * (1 - H.phoneK)); this.deskArms(1, 1); }
    else { this.stoop(0.8); }
    this.syncWorld();
    // listening: head leans into the receiver, eyes drop
    this.mulE(B.neck, 0.05 * H.phoneK, 0, -0.05 * H.phoneK); this.mulE(B.head, 0.04 * H.phoneK, 0.05 * H.phoneK, -0.06 * H.phoneK);
    this.syncWorld();
    const R = this.receiver(_m);
    // grip on the back of the handle (away from the cups)
    _a.set(0, 0, -0.02).applyMatrix4(R);
    // rest position of the hand (desk or side)
    if (H.seated) this.rigPoint(0.135, this.dT() + 0.034, this.dF() + 0.15, _b); else this.rigPoint(0.2, 0.95, 0.04, _b);
    _b.lerp(_a, reach);
    _b.y += tr(9) * 0.5;
    this.ikArm(1, _b, -0.3, -0.2, 0.55, 1);
    if (reach > 0.5) {
      // palm on the receiver's back, fingers wrapping across it
      _q.setFromRotationMatrix(_m2.extractRotation(R));
      _c.set(-1, 0, 0).applyQuaternion(_q); _d.set(0, 0, 1).applyQuaternion(_q);
      this.toRigDir(_c, _fw); this.toRigDir(_d, _pl);
      this.palmTo(1, _fw, _pl);
    }
    this.fingers(1, 0.4 + 0.5 * reach, 0.5);
  }

  // ── badge

  /** World transform of the loose card in his right hand (`under`: flat under the palm instead of pinched). */
  private cardInHand(out: THREE.Matrix4, under: boolean): THREE.Matrix4 {
    const h = this.B.hand_r;
    _m.copy(h.matrixWorld);
    // hand-local: x = palm normal (his left for the right hand), y = up the hand (fingers −y), z = thumb side
    if (under) _m2.makeTranslation(0.021, -0.075, 0.006);
    else _m2.makeTranslation(0.014, -0.085, 0.004);
    return out.multiplyMatrices(_m, _m2);
  }
  /** World transform of the card as it is right now (for 'desk' hand-over). */
  private cardWorld(out: THREE.Matrix4): THREE.Matrix4 {
    if (this.H.badge === 'hand') return this.cardInHand(out, this.pose === 'give');
    return out.copy(this.B.card.matrixWorld);
  }

  private poseHandBadge(br: number, tr: (k: number) => number): void {
    const H = this.H, B = this.B, u = this.poseT;
    if (H.seated) { this.seatBase(br, 0.12); this.deskArms(1, -1); }
    const toChest = smooth(u / 0.5) * (1 - smooth((u - 0.6) / 0.25));
    const out = smooth((u - 0.6) / 0.7);
    if (u > 0.5 && H.badge === 'lanyard') H.badge = 'hand';
    this.syncWorld();
    this.chestPoint(_a);
    if (H.seated) this.rigPoint(-0.07, this.dT() + 0.24, this.dF() + 0.16, _b); else this.rigPoint(-0.1, 1.27, 0.42, _b);
    _b.x += tr(11) * 0.6; _b.y += tr(12) * 0.6;
    const rest = H.seated ? this.rigPoint(-0.135, this.dT() + 0.034, this.dF() + 0.15, _c) : this.rigPoint(-0.2, 0.95, 0.04, _c);
    if (u < 0.6) rest.lerp(_a, toChest); else rest.copy(_a).lerp(_b, out);
    this.ikArm(-1, rest, -0.5, -0.3, 0.35, 1);
    if (u < 0.6 && toChest > 0.4) this.palmTo(-1, _fw.set(0.3, 0.9, 0.2), _pl.set(0.2, 0, -1));
    else if (u >= 0.6) this.palmTo(-1, _fw.set(0.12, 1, -0.05), _pl.set(-0.1, 0.05, 1));
    else if (H.seated) this.palmTo(-1, _fw.set(0.35, -0.08, 1), _pl.set(0.15, -1, 0));
    this.fingers(-1, u >= 0.6 ? 0.12 : 0.65, u >= 0.6 ? 0.9 : 0.75);
    this.mulE(B.spine2, 0.04 * out, 0.06 * out, 0, 'YXZ');
  }

  /** Just in front of the badge clip on his chest (world), wherever the pose has put it. */
  private chestPoint(out: THREE.Vector3): THREE.Vector3 {
    out.setFromMatrixPosition(this.B.badge.matrixWorld);
    this.toWorldDir(_d.set(0.01, -0.035, 0.06), _fw);
    return out.addScaledVector(_fw, this.S);
  }

  private poseGive(br: number, tr: (k: number) => number): void {
    const H = this.H, B = this.B, u = this.poseT;
    if (!H.seated) { this.poseHandBadge(br, tr); return; }
    const toChest = smooth(u / 0.5);
    const down = smooth((u - 0.55) / 0.45);
    const slide = smooth((u - 1.05) / 0.45);
    const back = smooth((u - 1.55) / 0.7);
    if (u > 0.5 && H.badge === 'lanyard') H.badge = 'hand';
    if (u > 1.5 && H.badge === 'hand') {
      // let go: the card slides on to its spot on the desk
      this.syncWorld();
      this.cardInHand(H.cardW, true);
      H.cardFrom.setFromMatrixPosition(H.cardW);
      H.cardQ0.setFromRotationMatrix(_m.extractRotation(H.cardW));
      if (H.badgeTarget) H.cardTo.copy(H.badgeTarget).setY(H.badgeTarget.y + 0.002);
      else { this.rigPoint(-0.05, this.dT(), this.dF() + 0.75, H.cardTo); H.cardTo.y += 0.002; }
      // flat, face up, long side along his facing
      _m.makeBasis(_a.set(0, 1, 0), this.toWorldDir(_b.set(0, 0, 1), _c), this.toWorldDir(_d.set(-1, 0, 0), _fw));
      H.cardQ1.setFromRotationMatrix(_m);
      H.slideT = 0;
      H.badge = 'desk';
      H.gaveT = 0;
    }
    this.seatBase(br, 0.3 * (down - back) + 0.25 * slide * (1 - back));
    this.deskArms(1, -1);
    this.syncWorld();
    this.chestPoint(_a);
    this.rigPoint(-0.07, this.dT() + 0.03, this.dF() + 0.1, _b);
    this.rigPoint(-0.06, this.dT() + 0.03, this.dF() + 0.42, _c);
    this.rigPoint(-0.135, this.dT() + 0.034, this.dF() + 0.15, _d);
    const p = _d.clone().lerp(_a, toChest);
    p.lerp(_b, down);
    p.lerp(_c, slide);
    p.lerp(_d, back);
    this.ikArm(-1, p, -0.6, -0.3, 0.3, 1);
    const atChest = toChest * (1 - down);
    if (atChest > 0.45) this.palmTo(-1, _fw.set(0.3, 0.9, 0.2), _pl.set(0.2, 0, -1));
    else this.palmTo(-1, _fw.set(0.25, -0.05, 1), _pl.set(0.1, -1, 0));
    this.fingers(-1, atChest > 0.45 ? 0.65 : 0.15, 0.3);
    // after it: he sags
    this.mulE(B.spine2, 0.06 * back, 0, 0, 'YXZ'); this.mulE(B.head, 0.12 * back, 0, 0, 'YXZ');
  }

  // ── fear

  private poseCower(t: number, br: number, tr: (k: number) => number): void {
    const B = this.B, H = this.H;
    const rock = Math.sin(t * 1.4 + this.seed) * 0.035;
    if (H.seated) {
      this.seatBase(br, 0.0);
      this.mulE(B.hips, 0.04 + rock, 0, 0);
      this.mulE(B.spine1, 0.1 + tr(1), 0, 0, 'YXZ'); this.mulE(B.spine2, 0.1 + tr(2), 0, 0, 'YXZ');
      this.mulE(B.neck, 0.06, 0, 0, 'YXZ'); this.mulE(B.head, 0.05 + tr(3), tr(4), 0, 'YXZ');
      this.legsSeat(_a.set(0.1, 0, 0.36), _b.set(-0.09, 0, 0.34));
    } else {
      this.mulE(B.hips, 0.22 + rock, 0, 0);
      this.mulE(B.spine1, 0.25 + tr(1), 0, 0, 'YXZ'); this.mulE(B.spine2, 0.22 + tr(2), 0, 0, 'YXZ');
      this.mulE(B.neck, 0.12, 0, 0, 'YXZ'); this.mulE(B.head, 0.06 + tr(3), 0.15 + tr(4), 0, 'YXZ');
      this.rotE(B.clav_l, 0, -0.1, 0.1); this.rotE(B.clav_r, 0, 0.1, -0.1);
    }
    this.syncWorld();
    // hands pressed together in front of the mouth
    for (const side of [1, -1]) {
      this.headPoint(side * 0.014, 1.5 + tr(5 + side), 0.19, _a);
      this.ikArm(side, _a, -0.7, -0.3, 0.15, 1);
      this.palmTo(side, _fw.set(side * 0.1, 0.9, 0.35), _pl.set(-side, 0, 0.1));
      this.fingers(side, 0.8 + tr(8) * 3, 0.6);
    }
  }

  private rubFaceOverlay(dt: number): void {
    const H = this.H;
    if (H.rubT < 0) return;
    H.rubT += dt;
    const D = 2.4, f = H.rubT;
    if (f > D) { H.rubT = -1; return; }
    const k = smooth(f / 0.45) * (1 - smooth((f - (D - 0.55)) / 0.55));
    const B = this.B;
    this.mulE(B.neck, 0.18 * k, 0, 0); this.mulE(B.head, 0.1 * k, 0, 0);
    this.syncWorld();
    const rub = Math.sin(f * 5) * 0.014 * k, drag = smooth((f - 0.6) / 1.2) * 0.04;
    this.headPoint(0.032, 1.6 + rub - drag, 0.14, _a); this.ikArm(1, _a, -0.7, -0.3, 0.0, k, true);
    this.headPoint(-0.032, 1.6 - rub - drag, 0.14, _a); this.ikArm(-1, _a, -0.7, -0.3, 0.0, k, true);
  }

  // ───────────────────────────────────────────── look

  private panelPoint(out: THREE.Vector3): THREE.Vector3 { return this.H.panel ? out.copy(this.H.panel) : this.rigPoint(-0.2, 1.32, 0.46, out); }

  protected override taskLook(): THREE.Vector3 | null {
    const H = this.H, u = this.poseT;
    switch (this.pose) {
      case 'turn_monitor': return H.monitor ? H.monitor.getWorldPosition(_task) : this.monitorGrab(_task);
      case 'lock_door': return this.panelPoint(_task);
      case 'give': return u < 1.6 ? this.rigPoint(-0.06, this.dT(), this.dF() + 0.35, _task) : null;
      case 'phone_ear': return this.rigPoint(0.1, this.dT() + 0.05, this.dF() + 0.3, _task);
      case 'sit_desk': return this.rigPoint(0.02 + 0.1 * noise1(this.world.time * 0.2, this.seed), this.dT(), this.dF() + 0.3, _task);
      default: return null;
    }
  }

  // ───────────────────────────────────────────── face

  private exprNow(): { fear: number; dis: number; tired: number } {
    const H = this.H, p = this.pose;
    if (H.expr === 'neutral') return { fear: 0, dis: 0, tired: 0.5 };
    if (H.expr === 'worry') return { fear: 0.45, dis: 0, tired: 0.4 };
    if (H.expr === 'fear') return { fear: 1, dis: 0.2, tired: 0 };
    if (H.expr === 'disbelief') return { fear: 0.3, dis: 1, tired: 0 };
    let fear = 0.3, dis = 0, tired = 0.6;
    if (p === 'startle') { const k = smooth(this.poseT / 0.1) * (1 - 0.6 * smooth((this.poseT - 0.5) / 1.2)); fear = Math.max(fear, k); dis = k * 0.8; tired = 0; }
    else if (p === 'cower' || p === 'back_away') { fear = 1; tired = 0; }
    else if (p === 'turn_monitor') { dis = smooth((this.poseT - 1.5) / 1); fear = 0.4; tired = 0.2; }
    else if (p === 'phone_ear') { dis = 0.5; fear = 0.5; tired = 0.1; }
    else if (p === 'give' || p === 'hand_badge' || p === 'lock_door') { fear = 0.8; tired = 0.1; }
    if (this.flinchK > 0.3) { fear = 1; tired = 0; }
    return { fear, dis, tired };
  }

  protected override face(): void {
    const B = this.B, H = this.H, t = this.world.time, sd = this.seed, dt = 1 / 60;
    const { fear, dis, tired } = this.exprNow();
    spring(H.browUp, 0.0016 * fear + 0.0034 * dis + noise1(t * 0.5, sd + 11) * 0.0005, 3, 0.9, dt);
    spring(H.browIn, 0.16 * fear - 0.05 * dis, 3, 0.9, dt);
    B.brow_l.position.y += H.browUp.x + (this.speakT > 0 ? 0 : 0);
    B.brow_r.position.y += H.browUp.x;
    B.brow_l.quaternion.setFromAxisAngle(_d.set(0, 0, 1), -H.browIn.x); B.brow_r.quaternion.setFromAxisAngle(_d.set(0, 0, 1), H.browIn.x);
    // lids: the asset's own lids sit low (a tired man) — at rest a little more open, wide with fear / disbelief
    spring(H.lidU, -0.1 - 0.12 * fear - 0.16 * dis + 0.07 * tired, 4, 0.9, dt);
    spring(H.lidL, 0.03 * fear + 0.02 * dis - 0.03 * tired, 4, 0.9, dt);
    const closed = this.eyesOpenNow() ? this.blink : 1;
    const look = Math.max(0, this.eP.x) * 0.55 + Math.min(0, this.eP.x) * 0.35; // lids follow the gaze up / down
    for (const s of ['l', 'r']) {
      B['eye_' + s].quaternion.setFromEuler(_e.set(this.eP.x, this.eY.x, 0, 'YXZ'));
      const up = H.lidU.x + look;
      B['lid_' + s].quaternion.setFromAxisAngle(X, up + closed * (0.46 - up));
      const lo = H.lidL.x + Math.max(0, this.eP.x) * 0.15;
      B['lidlo_' + s].quaternion.setFromAxisAngle(X, lo + closed * (-0.1 - lo));
    }
  }
  private eyesOpenNow(): boolean { return this.eyesOpen; }

  protected override speech(dt: number): void {
    const B = this.B, t = this.world.time, sd = this.seed;
    let jaw = 0; // lips sealed at rest
    if (this.pose === 'cower') jaw = 0.02 + 0.015 * Math.max(0, noise1(t * 2.3, sd + 50)); // breathing through the mouth
    if (this.speakT > 0) {
      this.speakT -= dt;
      const fade = smooth(this.speakT / 0.15) * smooth((this.speakDur - this.speakT) / 0.1);
      const syl = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 4.0 + 2.2 * noise1(t * 1.4, sd));
      const word = smooth(0.5 + noise1(t * 2.3, sd + 1) * 1.2);
      const env = Math.pow(syl, 1.4) * word * fade;
      const emph = Math.max(0, noise1(t * 1.1, sd + 2)) * fade;
      jaw += 0.012 + env * 0.11 + emph * 0.025;
      B.head.quaternion.multiply(_q.setFromEuler(_e.set(-emph * 0.05 + env * 0.02, noise1(t * 0.8, sd + 3) * 0.05 * fade, noise1(t * 0.6, sd + 4) * 0.04 * fade, 'YXZ')));
      B.brow_l.position.y += emph * 0.003; B.brow_r.position.y += emph * 0.003;
      if (this.pose === 'idle' && !this.fidget && this.walkW < 0.3 && !this.H.mug) {
        const g = Math.max(0, this.gest.x - 0.3) * fade;
        this.mulE(B.uarm_r, -0.3 * g, 0, 0.05 * g); this.mulE(B.larm_r, -0.6 * g, 0, 0); this.mulE(B.hand_r, 0, -0.7 * g, 0);
      }
    }
    B.jaw.quaternion.setFromAxisAngle(X, jaw);
  }

  // ───────────────────────────────────────────── props + collider (after the face, before the final world sync)

  protected override beforeTick(): void {
    // our own blocker must not stop our own rays (sight, ground) during the update
    const b = this.H.box;
    if (b) b.enabled = false;
    const pend = this.H.pending;
    if (pend) { this.H.pending = null; this.puppetPose(pend); }
  }

  protected override afterFace(dt: number): void {
    const H = this.H, B = this.B;
    this.syncWorld();
    // glasses: on the nose when seated (auto), pushed up onto the forehead otherwise; a pair hooked in the vest
    const gs = H.glasses === 'auto' ? (H.seated || this.pose === 'phone_ear' ? 'nose' : 'up') : H.glasses;
    const rub = H.rubT >= 0 && H.rubT < 2.4;
    spring(H.glassK, gs === 'up' || rub ? 1 : 0, 3.2, 1, dt);
    const gk = Math.min(1, Math.max(0, H.glassK.x));
    B.glasses.position.y += 0.086 * gk; B.glasses.position.z -= 0.012 * gk;
    B.glasses.quaternion.setFromAxisAngle(X, -0.5 * gk);
    B.glasses.scale.setScalar(gs === 'hang' || gs === 'off' ? 1e-4 : 1);
    B.glasses_h.scale.setScalar(gs === 'hang' ? 1 : 1e-4);
    // mug: upright in the hand (it pivots about the handle), jolts and settles
    const mugOn = H.mug && !H.seated;
    B.mug.scale.setScalar(mugOn ? 1 : 1e-4);
    spring(H.mugJolt, 0, 2.2, 0.35, dt);
    if (mugOn) {
      B.hand_r.matrixWorld.decompose(_a, _q, _b);
      _q2.setFromAxisAngle(Y, this.yaw + Math.PI).multiply(new THREE.Quaternion().setFromAxisAngle(X, H.mugJolt.x));
      B.mug.quaternion.copy(_q.invert()).multiply(_q2);
    }
    // badge: on the lanyard, in his hand, or lying where he put it
    B.badge.scale.setScalar(H.badge === 'lanyard' ? 1 : 1e-4);
    if (H.badge === 'hand' || H.badge === 'desk') {
      if (H.badge === 'hand') this.cardInHand(_m, this.pose === 'give');
      else if (H.slideT >= 0) {
        H.slideT += dt;
        const k = 1 - Math.pow(1 - Math.min(1, H.slideT / 0.45), 3);
        _a.copy(H.cardFrom).lerp(H.cardTo, k);
        _q.copy(H.cardQ0).slerp(H.cardQ1, Math.min(1, H.slideT / 0.18));
        H.cardW.compose(_a, _q, _b.set(this.S, this.S, this.S));
        if (H.slideT > 0.45) H.slideT = -1;
        _m.copy(H.cardW);
      } else _m.copy(H.cardW);
      this.setRootLocal(B.card, _m);
    } else B.card.scale.setScalar(1e-4);
    // phone receiver + cord (drawn while a cradle is set or he is on the phone)
    const phoneOn = !!H.phoneBase || this.pose === 'phone_ear' || this.pose === 'phone_down';
    if (phoneOn) {
      if (this.pose !== 'phone_ear' && this.pose !== 'phone_down') H.phoneK = 0;
      this.syncWorld();
      const R = this.receiver(_m);
      this.setRootLocal(B.phone, R);
      this.updateCord(R);
    } else {
      B.phone.scale.setScalar(1e-4);
      if (H.cord) H.cord.visible = false;
    }
    this.updateBox();
  }

  /** Put a root-level bone at a world transform. */
  private setRootLocal(bone: THREE.Bone, world: THREE.Matrix4): void {
    this.rig.root.updateWorldMatrix(true, false);
    _m2.copy(this.rig.root.matrixWorld).invert().multiply(world);
    _m2.decompose(bone.position, bone.quaternion, bone.scale);
  }

  /** Coiled cord from the receiver's mouth end to the cradle (one small dynamic tube, object-local). */
  private updateCord(R: THREE.Matrix4): void {
    const H = this.H;
    const SEG = 40, RAD = 5;
    if (!H.cord) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * RAD * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array((SEG + 1) * RAD * 3), 3));
      const idx: number[] = [];
      for (let i = 0; i < SEG; i++) for (let k = 0; k < RAD; k++) {
        const a = i * RAD + k, b = i * RAD + ((k + 1) % RAD), c = (i + 1) * RAD + ((k + 1) % RAD), d = (i + 1) * RAD + k;
        idx.push(a, b, c, a, c, d);
      }
      g.setIndex(idx);
      const mat = this.world.ctx.materials.clone('rubber', { color: 0xcfc4a6, roughness: 0.6 });
      H.cord = new THREE.Mesh(g, mat);
      H.cord.frustumCulled = false;
      H.cord.castShadow = false;
      this.object.add(H.cord);
    }
    const cord = H.cord;
    cord.visible = true;
    const p0 = _a.set(0, -0.092, -0.004).applyMatrix4(R);
    const base = H.phoneBase ?? this.rigPoint(0.3, this.dT() + 0.06, this.dF() + 0.16, _c);
    const p1 = _b.copy(base).add(_d.set(0, 0.02, 0));
    this.toRigDir(_d.set(0, 0, -1), _fw); void _fw;
    const inv = _m2.copy(this.object.matrixWorld).invert();
    const pa = cord.geometry.getAttribute('position') as THREE.BufferAttribute, na = cord.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const len = p0.distanceTo(p1);
    const sag = Math.max(0.02, 0.45 - len) * 0.5 + 0.05;
    const P = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3(), Bn = new THREE.Vector3(), prev = new THREE.Vector3();
    const pt = (u: number, out: THREE.Vector3) => out.copy(p0).lerp(p1, u).setY(p0.y + (p1.y - p0.y) * u - sag * 4 * u * (1 - u));
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      pt(u, P); pt(Math.min(1, u + 0.01), T); pt(Math.max(0, u - 0.01), prev); T.sub(prev).normalize();
      N.set(0, 1, 0).addScaledVector(T, -T.y).normalize(); if (N.lengthSq() < 1e-6) N.set(1, 0, 0);
      Bn.copy(T).cross(N);
      // coils: a helix round the centre line
      const ca = u * Math.PI * 2 * 26, cr = 0.007 * Math.min(1, Math.min(u, 1 - u) * 12);
      P.addScaledVector(N, Math.cos(ca) * cr).addScaledVector(Bn, Math.sin(ca) * cr);
      for (let k = 0; k < RAD; k++) {
        const a = (k / RAD) * Math.PI * 2;
        _c.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(Bn, Math.sin(a));
        _d.copy(P).addScaledVector(_c, 0.0028).applyMatrix4(inv);
        pa.setXYZ(i * RAD + k, _d.x, _d.y, _d.z);
        _c.transformDirection(inv);
        na.setXYZ(i * RAD + k, _c.x, _c.y, _c.z);
      }
    }
    pa.needsUpdate = true; na.needsUpdate = true;
  }

  /** Body collider (§2.9 / D23): standing column, or seated body + chair; follows him; off while hidden. */
  private updateBox(): void {
    const H = this.H, p = this.body.position;
    const visible = this.object.visible && !!this.object.parent && p.y > -100;
    if (!H.box) {
      if (!visible) return;
      try { H.box = this.world.ctx.physics.addBox(new THREE.Box3(), 'rubber'); } catch { return; }
    }
    const b = H.box!;
    const f = this.yaw + Math.PI, fx = Math.sin(f), fz = Math.cos(f);
    if (H.seated) {
      const cx = p.x + fx * 0.12, cz = p.z + fz * 0.12, h = 0.44;
      b.box.min.set(cx - h, p.y, cz - h); b.box.max.set(cx + h, p.y + 1.4, cz + h);
    } else {
      const h = 0.24;
      b.box.min.set(p.x - h, p.y, p.z - h); b.box.max.set(p.x + h, p.y + 1.85, p.z + h);
    }
    b.enabled = visible;
  }

  // ───────────────────────────────────────────── helpers

  /** World direction → rig axes (x his left, y up, z his front). */
  private toRigDir(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(world).applyAxisAngle(Y, -(this.yaw + Math.PI));
  }
  private toWorldDir(rig: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(rig).applyAxisAngle(Y, this.yaw + Math.PI);
  }

  override dispose(): void {
    const H = this.H;
    if (H.box) { H.box.remove(); H.box = null; }
    if (H.cord) { H.cord.geometry.dispose(); (H.cord.material as THREE.Material).dispose(); H.cord.removeFromParent(); H.cord = null; }
    super.dispose();
  }
}

void K;
