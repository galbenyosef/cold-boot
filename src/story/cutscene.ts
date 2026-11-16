/**
 * Cutscene camera (stage 3a §8.2): fully non-interactive first-person scenes played as a list of camera shots.
 *
 *   const r = await rig.cutscene.play('l3_c2', shots, { place, viewmodel: 'hidden', safe: true, topUp: true, end });
 *
 * What one `play` does, so a scene does not have to:
 *  - waits for a state it can start in: never while dying / dead ('refused'), not while paused or another scene /
 *    the wake-up owns the camera (deferred, starts on the first frame it can), not until `o.when()` holds (logged
 *    once after 1 s); an open note is closed;
 *  - takes the player (`player.cinematic(true)`: velocity zeroed, sprint / jump buffer / reload / palm scan
 *    cancelled, feet snapped to the floor if airborne, input and damage ignored, weapon hidden or held lowered),
 *    `ctx.state = 'cutscene'`, `controlsEnabled = false`, HUD off; pins `o.pin` actors to `eye`;
 *  - plays the shots from `CameraRig.lateUpdate` (after player / level / enemies): eye fixed or moving, look at a
 *    point / a moving point / a live Object3D / a function, or yaw + pitch; fov; per-shot cut / blend / fade in,
 *    fade out, black; shot and scene cues at times; the body moved per shot (room visibility follows the body);
 *    a small natural head sway on first-person shots;
 *  - skip (only when `seen(id)` on this browser): SPACE held 0.6 s, ring via `ui.showSkip`; every cue not yet run
 *    gets its `skip()` (its end-state effect); the key is consumed (no jump when control returns);
 *  - on both endings ('done' | 'skipped'): `o.end(how)` (the scene's final world state), `markSeen(id)`, actors
 *    released (`lookAt(null)`), the player placed at `o.place` standing, `setSafe(true)` before control returns
 *    when `o.safe` (no frame with a live weapon), clip topped up when `o.topUp`; control and HUD back on the same
 *    frame — or, with `then: 'hold'`, the player stays in the scene's hands (black) for the next `play` (C1 → C2).
 *  - `handback: true` on the last shot: the shot ends exactly on the player's own view at `o.place` (the player
 *    keeps computing it during the scene, `player.view`), so the first interactive frame continues the last
 *    cutscene frame with no pop.
 */
import * as THREE from 'three';
import type { EnemyActor, GameContext, Player } from '../core/types';
import type { UIInternal } from '../ui/types';
import { markSeen, seen } from './save';

type V3 = THREE.Vector3;
/** A look target: a point, a moving point (from → to over the shot), a live object (its world position), a function. */
export type LookSpec = V3 | [V3, V3] | THREE.Object3D | (() => V3);

export interface CamCue {
  /** Seconds from the start of the shot (shot cues) or of the scene (`o.cues`). */
  t: number;
  run: () => void;
  /** On a skip, run instead of `run` for every cue not reached yet: its end-state effect (snap a door, place an actor). */
  skip?: () => void;
}

export interface CamShot {
  dur: number;
  /** Camera position: fixed or moving (from → to over the shot, eased). */
  eye: V3 | [V3, V3];
  /** Look target. Omitted → `yaw` / `pitch`. */
  look?: LookSpec;
  /** View yaw / pitch (radians, the player's convention: yaw 0 = facing −z) when there is no `look`; [from, to] moves. */
  yaw?: number | [number, number];
  pitch?: number | [number, number];
  /** Degrees; [from, to] zooms over the shot. Default: the previous shot's end fov (72 for the first). */
  fov?: number | [number, number];
  /** Easing of the moves inside the shot. Default 'inOut'. */
  ease?: 'linear' | 'inOut';
  /**
   * How the shot begins: 'cut' (default after the first), 'blend' (from the previous frame's camera over `blend` s,
   * shortest rotation; the first shot defaults to a 0.35 s blend from wherever the player was looking), 'fade'
   * (from black over `fade` s, default 0.6).
   */
  enter?: 'cut' | 'blend' | 'fade';
  blend?: number;
  fade?: number;
  /** Fade to black over the last `fadeOut` s of the shot. */
  fadeOut?: number;
  /** The whole shot is black (time passes, cues run: teleports and snaps under black). */
  black?: boolean;
  cues?: CamCue[];
  /** Where the player's body stands for this shot (feet), moved at its start; 'follow' = under the eye (x, z) every frame. */
  body?: V3 | 'follow';
  /** Body yaw when `body` is a point (default: unchanged). */
  bodyYaw?: number;
  /** Head sway amplitude (1 = a person sitting / standing still; 0 = a locked-off camera). Default 1. */
  sway?: number;
  /** Last shot only: end exactly on the player's own view at `o.place` (see the header). */
  handback?: boolean;
}

export interface PlayOpts {
  /** The scene's final world state, applied on BOTH endings (natural end: after the last cue; skip: after the cues' skips). */
  end?: (how: 'done' | 'skipped') => void;
  /** Where the player stands when control returns (feet), view yaw / pitch. */
  place: { pos: V3; yaw: number; pitch: number };
  /** Weapon during the scene: 'hidden' (stowed, viewmodel off) or 'lowered' (visible, held low). */
  viewmodel: 'hidden' | 'lowered';
  /** Refill the clips quietly at the end. */
  topUp?: boolean;
  /** `player.setSafe(true)` at the end, before control returns (§8.3). */
  safe?: boolean;
  /** 'control' (default): control returns at the end. 'hold': the player stays in cinematic mode for the next `play`. */
  then?: 'control' | 'hold';
  /** Fade-in (s) when control returns from black (a skip, or a scene that ended black). Default 0.6. */
  fadeIn?: number;
  /** Cues on the scene clock. */
  cues?: CamCue[];
  /** Actors pinned to `eye` while the scene plays; `lookAt(null)` (auto) at the end. */
  pin?: EnemyActor[];
  /** Extra start condition (e.g. no hostile alive); the scene waits while false. */
  when?: () => boolean;
  /** Default true: skippable once seen. false: never. */
  skippable?: boolean;
}

export type CutResult = 'done' | 'skipped' | 'refused';

/** Player extras this system uses (src/player: `view`, `inCinematic`); absent → the camera pose itself. */
type PlayerX = Player & { view?: { position: V3; quaternion: THREE.Quaternion; fov: number }; inCinematic?: boolean };

const DEFAULT_FOV = 72;
const START_BLEND = 0.35;
const SKIP_HOLD = 0.6;
const PITCH_MAX = THREE.MathUtils.degToRad(88);

interface Pose { p: V3; q: THREE.Quaternion; fov: number }
const newPose = (): Pose => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: DEFAULT_FOV });
const copyPose = (o: Pose, a: Pose) => { o.p.copy(a.p); o.q.copy(a.q); o.fov = a.fov; return o; };
const smooth = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const lerpN = (v: number | [number, number] | undefined, k: number, dflt: number) =>
  v === undefined ? dflt : typeof v === 'number' ? v : v[0] + (v[1] - v[0]) * k;
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _t = new THREE.Vector3();
const _q2 = new THREE.Quaternion();

/** Yaw / pitch (player convention) of the direction from `a` to `b`. */
export function yawPitchTo(a: V3, b: V3): { yaw: number; pitch: number } {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

function lookPoint(l: LookSpec, k: number, out: V3): V3 {
  if (typeof l === 'function') return out.copy(l());
  if (Array.isArray(l)) return out.lerpVectors(l[0], l[1], k);
  if ((l as THREE.Object3D).isObject3D) return (l as THREE.Object3D).getWorldPosition(out);
  return out.copy(l as V3);
}

/** Total length of a shot list (s). */
export function shotsDuration(shots: readonly CamShot[]): number { return shots.reduce((s, x) => s + x.dur, 0); }

/** Declared end yaw of the last shot (from its yaw, or the direction to its look target) — for the Δyaw assertion. */
export function lastShotYaw(shots: readonly CamShot[]): number {
  const s = shots[shots.length - 1];
  if (!s) return NaN;
  const eye = Array.isArray(s.eye) ? s.eye[1] : s.eye;
  if (s.look) return yawPitchTo(eye, lookPoint(s.look, 1, new THREE.Vector3())).yaw;
  return lerpN(s.yaw, 1, NaN);
}

export function angleDelta(a: number, b: number): number { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }

/** The fov shot `i` starts from when it does not say: the previous shot's end fov (72 for the first). */
function fovBefore(shots: readonly CamShot[], i: number): number {
  let f = DEFAULT_FOV;
  for (let j = 0; j < i; j++) { const v = shots[j].fov; if (v !== undefined) f = typeof v === 'number' ? v : v[1]; }
  return f;
}

/** A shot's own pose at local time τ (no blends); `sway` adds the head sway. */
function evalShotPose(s: CamShot, tau: number, sceneT: number, prevFov: number, out: Pose, sway: boolean): Pose {
  const u = s.dur > 0 ? Math.min(1, Math.max(0, tau / s.dur)) : 1;
  const k = (s.ease ?? 'inOut') === 'linear' ? u : smooth(u);
  if (Array.isArray(s.eye)) out.p.lerpVectors(s.eye[0], s.eye[1], k); else out.p.copy(s.eye);
  let yaw: number, pitch: number;
  if (s.look) {
    const a = yawPitchTo(out.p, lookPoint(s.look, k, _t));
    yaw = a.yaw; pitch = a.pitch;
  } else {
    yaw = lerpN(s.yaw, k, 0);
    pitch = lerpN(s.pitch, k, 0);
  }
  // head sway: breathing rise, slow drift of the gaze (small: a person holding still, not a handheld camera)
  const A = sway ? s.sway ?? 1 : 0;
  let roll = 0;
  if (A > 0) {
    const t = sceneT;
    out.p.y += A * (Math.sin(t * 1.3) * 0.0035 + Math.sin(t * 0.37 + 1.1) * 0.003);
    out.p.x += A * Math.sin(t * 0.29 + 0.4) * 0.004;
    yaw += A * (Math.sin(t * 0.31) * 0.0045 + Math.sin(t * 0.73 + 2.0) * 0.0015);
    pitch += A * (Math.sin(t * 0.41 + 0.7) * 0.0035 + Math.sin(t * 1.3 + 0.3) * 0.0012);
    roll = A * Math.sin(t * 0.23 + 1.7) * 0.0025;
  }
  _e.set(Math.max(-PITCH_MAX, Math.min(PITCH_MAX, pitch)), yaw, roll, 'YXZ');
  out.q.setFromEuler(_e);
  out.fov = lerpN(s.fov, k, prevFov);
  return out;
}

/**
 * Tests / tables: the declared camera at scene time `t` (the shot's own path, no sway, no blends), as eye, yaw, pitch
 * (player convention) and fov. Live look targets are read now.
 */
export function shotPoseAt(shots: readonly CamShot[], t: number): { shot: number; eye: [number, number, number]; yaw: number; pitch: number; fov: number } {
  let t0 = 0, i = 0;
  while (i < shots.length - 1 && t >= t0 + shots[i].dur) { t0 += shots[i].dur; i++; }
  const pose = evalShotPose(shots[i], t - t0, t, fovBefore(shots, i), newPose(), false);
  _e.setFromQuaternion(pose.q, 'YXZ');
  return { shot: i, eye: [pose.p.x, pose.p.y, pose.p.z], yaw: _e.y, pitch: _e.x, fov: pose.fov };
}

interface Running {
  id: string;
  shots: CamShot[];
  o: PlayOpts;
  resolve: (r: CutResult) => void;
  t: number;
  shot: number;
  shotT0: number;
  canSkip: boolean;
  skipArmed: boolean;
  hold: number;
  /** cue bookkeeping: scene cues + per-shot cues, flattened to absolute times. */
  cues: { at: number; c: CamCue; done: boolean }[];
  from: Pose;
  fadedOut: boolean;
  black: boolean;
  total: number;
}

export class Cutscene {
  /** Follows the cutscene camera (and the player's camera outside a scene): what humans are pinned to. */
  readonly eye = new THREE.Object3D();
  private run: Running | null = null;
  private pending: { id: string; shots: CamShot[]; o: PlayOpts; resolve: (r: CutResult) => void; since: number; warned: boolean } | null = null;
  /** After a 'hold' scene: the player is still in cinematic mode, waiting for the next play (or `release()`). */
  private holding: { place: PlayOpts['place']; o: PlayOpts } | null = null;
  private readonly pose = newPose();
  private readonly tmp = newPose();
  private readonly prev = newPose();
  /** Hand-back measurement: camera matrix of the last cutscene frame and of the first interactive frame after it. */
  private handbackLast: THREE.Matrix4 | null = null;
  private handbackFirst: THREE.Matrix4 | null = null;
  private handbackWait = false;
  /** Last results, for tests. */
  readonly log: { id: string; result: CutResult; t: number; skipped: boolean }[] = [];

  constructor(private ctx: GameContext) {
    this.eye.name = 'cutscene_eye';
    ctx.scene.add(this.eye);
  }

  get active(): boolean { return this.run !== null; }
  /** A scene is playing, waiting to start, or holding the player for the next one. */
  get busy(): boolean { return this.run !== null || this.pending !== null || this.holding !== null; }
  get id(): string | null { return this.run?.id ?? this.pending?.id ?? null; }
  get time(): number { return this.run?.t ?? 0; }

  /** Play a scene. Resolves 'done' / 'skipped' after its end state is applied, 'refused' if the player is dead. */
  play(id: string, shots: CamShot[], o: PlayOpts): Promise<CutResult> {
    return new Promise<CutResult>((resolve) => {
      if (!shots.length) { console.error(`[cutscene] ${id}: no shots`); resolve('refused'); return; }
      if (this.pending) { console.error(`[cutscene] ${id}: ${this.pending.id} is already waiting; refused`); resolve('refused'); return; }
      this.pending = { id, shots, o, resolve, since: performance.now(), warned: false };
      this.tryStart();
    });
  }

  /** End a 'hold' without another scene: control returns at the hold's place (fade in). */
  release(): void {
    const h = this.holding;
    if (!h || this.run) return;
    this.holding = null;
    this.returnControl(h.o, false, true);
  }

  private tryStart(): void {
    const p = this.pending;
    if (!p || this.run) return;
    const ctx = this.ctx, pl = ctx.player;
    if (!pl.alive || ctx.state === 'dead' || ctx.state === 'ended') {
      this.pending = null;
      console.warn(`[cutscene] ${p.id}: refused (player ${pl.alive ? 'not playing' : 'dead'})`);
      this.log.push({ id: p.id, result: 'refused', t: 0, skipped: false });
      p.resolve('refused');
      return;
    }
    // paused, a menu, the wake-up / a resume owning 'cutscene': wait (unless it is our own hold)
    if (!this.holding && ctx.state !== 'playing') return;
    if (p.o.when && !p.o.when()) {
      if (!p.warned && performance.now() - p.since > 1000) { p.warned = true; console.error(`[cutscene] ${p.id}: start condition false — waiting`); }
      return;
    }
    this.pending = null;
    this.begin(p.id, p.shots, p.o, p.resolve);
  }

  private begin(id: string, shots: CamShot[], o: PlayOpts, resolve: (r: CutResult) => void): void {
    const ctx = this.ctx, pl = ctx.player as PlayerX, ui = ctx.ui as UIInternal;
    const chained = !!this.holding;
    this.holding = null;
    try { if (ui.noteOpen) ui.closeNote(); } catch { /* ignore */ }
    pl.cinematic?.(true, { viewmodel: o.viewmodel });
    pl.controlsEnabled = false;
    ctx.setState('cutscene');
    ctx.ui.setHudVisible(false);
    for (const a of o.pin ?? []) { try { a.lookAt(this.eye); } catch { /* ignore */ } }
    const cues: Running['cues'] = [];
    for (const c of o.cues ?? []) cues.push({ at: c.t, c, done: false });
    let t0 = 0;
    for (const s of shots) { for (const c of s.cues ?? []) cues.push({ at: t0 + c.t, c, done: false }); t0 += s.dur; }
    cues.sort((a, b) => a.at - b.at);
    const cam = ctx.camera;
    const from = newPose();
    from.p.copy(cam.position); from.q.copy(cam.quaternion); from.fov = cam.fov;
    this.run = {
      id, shots, o, resolve, t: 0, shot: -1, shotT0: 0,
      canSkip: o.skippable !== false && seen(id), skipArmed: !ctx.input.down('Space'), hold: 0,
      cues, from, fadedOut: false, black: chained, total: t0,
    };
    this.handbackLast = this.handbackFirst = null; this.handbackWait = false;
    this.enterShot(0);
    this.frame(0);
  }

  /** Every frame, after player.update (story.lateUpdate via CameraRig). */
  lateUpdate(dt: number): void {
    if (this.handbackWait && !this.run) {
      // the first interactive frame: player.update has written its own camera; nothing overrides it
      this.handbackWait = false;
      this.ctx.camera.updateMatrixWorld();
      this.handbackFirst = this.ctx.camera.matrixWorld.clone();
    }
    if (this.pending && !this.run) this.tryStart();
    if (this.run) {
      if (this.ctx.state === 'cutscene') this.frame(dt);
    } else if (!this.holding) {
      this.syncEye();
    }
  }

  private syncEye(): void {
    const cam = this.ctx.camera;
    this.eye.position.copy(cam.position);
    this.eye.quaternion.copy(cam.quaternion);
    this.eye.updateMatrixWorld(true);
  }

  private enterShot(i: number): void {
    const r = this.run!;
    const s = r.shots[i];
    const ctx = this.ctx, post = ctx.render.post;
    // the pose the new shot blends from: the camera as it was on the last frame (start: the player's view)
    if (i > 0) { copyPose(r.from, this.pose); }
    r.shot = i;
    r.shotT0 = r.shots.slice(0, i).reduce((a, x) => a + x.dur, 0);
    r.fadedOut = false;
    if (s.black) { post.fade(1, 0); r.black = true; }
    else if (s.enter === 'fade') { post.fade(1, 0); post.fade(0, s.fade ?? 0.6); r.black = false; }
    else if (r.black) { post.fade(0, 0); r.black = false; }
    if (s.handback) {
      const pl = ctx.player;
      pl.teleport(r.o.place.pos, r.o.place.yaw, r.o.place.pitch);
    } else if (s.body && s.body !== 'follow') {
      ctx.player.teleport(s.body, s.bodyYaw);
    }
  }

  private blendIn(s: CamShot, i: number): number {
    if (s.black) return 0;
    const mode = s.enter ?? (i === 0 ? 'blend' : 'cut');
    if (mode !== 'blend') return 0;
    return Math.max(0, s.blend ?? (i === 0 ? START_BLEND : 0.5));
  }

  private evalShot(s: CamShot, tau: number, sceneT: number, prevFov: number, out: Pose): Pose { return evalShotPose(s, tau, sceneT, prevFov, out, true); }

  private shotFovStart(i: number): number { return fovBefore(this.run!.shots, i); }

  private frame(dt: number): void {
    const r = this.run!;
    const ctx = this.ctx;
    // ── skip
    if (r.canSkip) {
      const held = ctx.input.down('Space');
      if (!held) { r.skipArmed = true; if (r.hold > 0) { r.hold = 0; this.showSkip(null); } }
      else if (r.skipArmed) {
        r.hold += dt;
        this.showSkip(Math.min(1, r.hold / SKIP_HOLD));
        if (r.hold >= SKIP_HOLD) { this.skip(); return; }
      }
    }
    // ── clock, shots
    r.t += dt;
    let done = false;
    while (r.t >= r.shotT0 + r.shots[r.shot].dur) {
      if (r.shot + 1 >= r.shots.length) { done = true; break; }
      this.runCues(r.shotT0 + r.shots[r.shot].dur);
      this.enterShot(r.shot + 1);
    }
    if (done) r.t = r.total;
    this.runCues(r.t);
    if (this.run !== r) return; // a cue ended / replaced the scene
    const i = r.shot, s = r.shots[i];
    const tau = Math.min(s.dur, r.t - r.shotT0);
    // fade out at the end of the shot
    if (s.fadeOut && !r.fadedOut && tau >= s.dur - s.fadeOut) { r.fadedOut = true; ctx.render.post.fade(1, Math.max(0, s.dur - tau)); }
    // ── pose
    const pose = this.pose;
    if (s.black) copyPose(pose, r.from);
    else {
      this.evalShot(s, tau, r.t, this.shotFovStart(i), pose);
      const bl = this.blendIn(s, i);
      if (bl > 0 && tau < bl) {
        const w = smooth(tau / bl);
        pose.p.lerpVectors(r.from.p, pose.p, w);
        _q2.copy(r.from.q).slerp(pose.q, w); pose.q.copy(_q2);
        pose.fov = r.from.fov + (pose.fov - r.from.fov) * w;
      }
      if (s.handback) {
        // onto the player's own view: from 40 % of the shot, all of it at the end
        const v = (ctx.player as PlayerX).view;
        if (v) {
          const w = smooth((tau / s.dur - 0.4) / 0.6);
          pose.p.lerp(v.position, w);
          pose.q.slerp(v.quaternion, w);
          pose.fov += (v.fov - pose.fov) * w;
        }
      }
      if (s.body === 'follow') {
        const b = ctx.player.position;
        if (Math.hypot(b.x - pose.p.x, b.z - pose.p.z) > 0.01) ctx.player.teleport(_t.set(pose.p.x, b.y, pose.p.z));
      }
    }
    this.apply(pose);
    if (done) this.finish('done');
  }

  private apply(pose: Pose): void {
    const cam = this.ctx.camera;
    cam.position.copy(pose.p);
    cam.quaternion.copy(pose.q);
    if (Math.abs(cam.fov - pose.fov) > 1e-4) { cam.fov = pose.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    this.syncEye();
  }

  private runCues(upTo: number): void {
    const r = this.run!;
    for (const q of r.cues) {
      if (q.done || q.at > upTo + 1e-6) continue;
      q.done = true;
      try { q.c.run(); } catch (e) { console.error(`[cutscene] ${r.id}: cue at ${q.at.toFixed(2)} s threw`, e); }
      if (this.run !== r) return;
    }
  }

  private showSkip(p: number | null): void { try { this.ctx.ui.showSkip?.(p); } catch { /* ignore */ } }

  /** SPACE held 0.6 s: black at once, the end-state effect of every cue not reached, then the common ending. */
  private skip(): void {
    const r = this.run!;
    this.ctx.render.post.fade(1, 0);
    r.black = true;
    for (const q of r.cues) {
      if (q.done) continue;
      q.done = true;
      try { q.c.skip?.(); } catch (e) { console.error(`[cutscene] ${r.id}: cue skip at ${q.at.toFixed(2)} s threw`, e); }
    }
    this.finish('skipped');
  }

  private finish(how: 'done' | 'skipped'): void {
    const r = this.run!;
    const ctx = this.ctx, pl = ctx.player as PlayerX;
    this.run = null;
    this.showSkip(null);
    for (const a of r.o.pin ?? []) { try { a.lookAt(null); } catch { /* ignore */ } }
    try { r.o.end?.(how); } catch (e) { console.error(`[cutscene] ${r.id}: end() threw`, e); }
    markSeen(r.id);
    if (how === 'skipped' && ctx.input.down('Space')) pl.consumeKey?.('Space');
    const last = r.shots[r.shots.length - 1];
    const endsBlack = r.black || !!last.black || !!last.fadeOut;
    // the body where the scene leaves it (for a natural hand-back it is already there: no change to the view)
    const pos = pl.position, pp = r.o.place.pos;
    if (how === 'skipped' || !last.handback || pos.distanceTo(pp) > 0.05 || angleDelta(pl.yaw, r.o.place.yaw) > 1e-3) {
      pl.teleport(pp, r.o.place.yaw, r.o.place.pitch);
    }
    if (r.o.safe) pl.setSafe?.(true);
    this.log.push({ id: r.id, result: how, t: r.t, skipped: how === 'skipped' });
    if ((r.o.then ?? 'control') === 'hold') {
      if (r.o.topUp) pl.cinematic?.(true, { topUp: true });
      this.holding = { place: r.o.place, o: r.o };
      if (!endsBlack) { ctx.render.post.fade(1, 0.2); }
    } else {
      this.returnControl(r.o, how === 'done' && !!last.handback && !endsBlack, endsBlack || how === 'skipped');
    }
    r.resolve(how);
  }

  private returnControl(o: PlayOpts, continuous: boolean, fromBlack: boolean): void {
    const ctx = this.ctx, pl = ctx.player as PlayerX;
    if (continuous) { ctx.camera.updateMatrixWorld(); this.handbackLast = ctx.camera.matrixWorld.clone(); this.handbackWait = true; }
    pl.cinematic?.(false, { topUp: o.topUp });
    pl.controlsEnabled = true;
    ctx.setState('playing');
    ctx.ui.setHudVisible(true);
    if (!continuous) {
      // a cut to the player's view: put the camera there now (the next player.update agrees with it)
      const v = pl.view;
      if (v) { this.tmp.p.copy(v.position); this.tmp.q.copy(v.quaternion); this.tmp.fov = v.fov; this.apply(this.tmp); }
    }
    if (fromBlack) { ctx.render.post.fade(1, 0); ctx.render.post.fade(0, o.fadeIn ?? 0.6); }
  }

  /** Tests: the hand-back's camera delta (position m, rotation deg) between the last scene frame and the first interactive one. */
  handbackDelta(): { dPos: number; dDeg: number } | null {
    if (!this.handbackLast || !this.handbackFirst) return null;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), s = new THREE.Vector3();
    this.handbackLast.decompose(a, qa, s);
    this.handbackFirst.decompose(b, qb, s);
    return { dPos: a.distanceTo(b), dDeg: THREE.MathUtils.radToDeg(qa.angleTo(qb)) };
  }

  debugState() {
    const r = this.run;
    return {
      active: !!r, pending: this.pending?.id ?? null, holding: !!this.holding, id: r?.id ?? null,
      t: r ? +r.t.toFixed(3) : 0, shot: r?.shot ?? -1, canSkip: r?.canSkip ?? false, hold: r ? +r.hold.toFixed(3) : 0,
      total: r ? +r.total.toFixed(3) : 0, log: this.log.slice(), handback: this.handbackDelta(),
    };
  }
}
