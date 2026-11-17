/**
 * Scripted camera work that must run AFTER player.update (which owns the camera while simulating):
 *  - the slow cinematic drift behind the main menu (state 'menu' — player.update doesn't run then)
 *  - the wake-up "lying on the bed" offset + roll during the opening cutscene.
 *  - the first-person cutscenes (stage 3a §8.2, ./cutscene.ts: `rig.cutscene.play(id, shots, opts)`).
 * Driven from `story.lateUpdate`, which the UI calls at the end of `ui.update` every frame.
 */
import * as THREE from 'three';
import type { GameContext, LevelId } from '../core/types';
import { Cutscene } from './cutscene';

interface Shot { from: THREE.Vector3; to: THREE.Vector3; lookFrom: THREE.Vector3; lookTo: THREE.Vector3; dur: number; fov?: number }

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Slow, low-energy dolly shots through the level (DESIGN.md coordinates). */
const SHOTS_L1: Shot[] = [
  // Medical 3-A — high corner, drifting over the beds and the monitor glow.
  { from: v(-4.2, 2.6, 1.2), to: v(-3.3, 2.45, 1.7), lookFrom: v(1.5, 0.6, 6.5), lookTo: v(2.4, 0.7, 7.2), dur: 14, fov: 58 },
  // Service corridor A — failing lights; slow push, framed so the corridor sits right of the title.
  { from: v(0.45, 1.6, -0.9), to: v(0.3, 1.55, -4.2), lookFrom: v(-1.7, 1.3, -14), lookTo: v(-1.4, 1.25, -14), dur: 13, fov: 62 },
];

/** Level 2 (REVISION 4): the tidy dock, then the held hall with the booth's warm window. */
const SHOTS_L2: Shot[] = [
  { from: v(-3.2, 2.9, -0.9), to: v(-2.4, 2.75, -1.6), lookFrom: v(1.6, 0.5, -6.5), lookTo: v(2.3, 0.6, -7.2), dur: 14, fov: 58 },
  { from: v(-2.5, 3.4, -24.5), to: v(-1.2, 3.2, -27.5), lookFrom: v(-9, 1.6, -45), lookTo: v(-8.5, 1.5, -46), dur: 15, fov: 60 },
];

/** Level 3 stub (K2): one slow push across the stub room; the shots table of §4 replaces it (P4/P10). */
const SHOTS_L3: Shot[] = [
  { from: v(-3.8, 2.4, -1.0), to: v(-3.0, 2.3, -1.8), lookFrom: v(1.5, 1.0, -8.5), lookTo: v(2.2, 1.0, -8.8), dur: 14, fov: 60 },
];

/**
 * Level 4 (stage 3b §8.1): corr_n from the shower exit, looking down the west corridor. Set for the built level (W4's
 * greybox / the dressing); on K's stub room it frames the void outside the room.
 */
const SHOTS_L4: Shot[] = [
  { from: v(-4, 6.45, -10.5), to: v(-3.4, 6.4, -11.0), lookFrom: v(-6, 6.0, -20), lookTo: v(-5.7, 6.0, -20.3), dur: 14, fov: 60 },
];

/** Menu shots per level (§8.1: a lookup, one entry per built level). */
const SHOTS: Partial<Record<LevelId, Shot[]>> = { 1: SHOTS_L1, 2: SHOTS_L2, 3: SHOTS_L3, 4: SHOTS_L4 };

const BASE_FADE = 0.12;

export class CameraRig {
  private shotIndex = 0;
  private shotT = 0;
  private menuActive = false;
  private baseFov = 72;
  private tmp = new THREE.Vector3();
  private look = new THREE.Vector3();
  private fadeState: 'in' | 'hold' | 'out' = 'in';

  /** Wake cutscene: 0 = lying on the bed, 1 = player's normal eye. null = rig inactive. */
  wake: { rise: number; roll: number; lying: THREE.Vector3 } | null = null;

  private shots: Shot[];

  /** §8.2 (stage 3a): first-person cutscenes (shot lists), driven from `lateUpdate` below. */
  readonly cutscene: Cutscene;

  constructor(private ctx: GameContext) {
    const shots = SHOTS[ctx.levelId];
    if (!shots) throw new Error(`[story] no menu shots for level ${ctx.levelId}`);
    this.shots = shots;
    this.baseFov = ctx.camera.fov;
    this.cutscene = new Cutscene(ctx);
    // dev only (stage 3a P4): `?cutdev=1` installs the cutscene test scene (lazy chunk; not a level)
    let dev = false;
    try { dev = new URLSearchParams(location.search).has('cutdev'); } catch { /* ignore */ }
    if (dev) void import('./dev/cutscene').then((m) => m.installCutsceneDev(ctx, this.cutscene)).catch((e) => console.error('[story] cutdev failed', e));
  }

  startMenu(): void {
    this.menuActive = true;
    this.shotIndex = 0;
    this.shotT = 0;
    this.fadeState = 'in';
    try { this.ctx.render.post.fade(1, 0); this.ctx.render.post.fade(BASE_FADE, 2.5); } catch { /* ignore */ }
  }

  stopMenu(): void {
    if (!this.menuActive) return;
    this.menuActive = false;
    this.ctx.camera.fov = this.baseFov;
    this.ctx.camera.updateProjectionMatrix();
  }

  /** Where the eye sits while lying on the med bed (bed top if the level exposes it). */
  lyingPoint(): THREE.Vector3 {
    const ctx = this.ctx;
    const bed = ctx.level.object('med_bed');
    if (bed) {
      const box = new THREE.Box3().setFromObject(bed);
      if (box.isEmpty()) {
        // A bare marker at the mattress surface: lie just above it.
        const p = bed.getWorldPosition(new THREE.Vector3());
        if (p.y < 1.5) { p.y += 0.32; return p; }
      }
      if (!box.isEmpty() && box.max.y < 2) {
        const c = box.getCenter(new THREE.Vector3());
        // Head end: the end of the bed's long axis furthest from the door (z = 0).
        const size = box.getSize(new THREE.Vector3());
        if (size.z >= size.x) c.z = c.z > 0 ? box.max.z - 0.35 : box.min.z + 0.35;
        else c.x = c.x > 0 ? box.max.x - 0.35 : box.min.x + 0.35;
        c.y = box.max.y + 0.32;
        return c;
      }
    }
    const p = ctx.player.eye.clone();
    p.y -= 0.8;
    return p;
  }

  lateUpdate(dt: number): void {
    const ctx = this.ctx;
    const cam = ctx.camera;
    this.cutscene.lateUpdate(dt);
    if (ctx.state === 'menu' && this.menuActive) {
      this.menuShot(dt);
      return;
    }
    if (this.wake && (ctx.state === 'cutscene' || ctx.state === 'playing')) {
      const k = THREE.MathUtils.smootherstep(this.wake.rise, 0, 1);
      this.tmp.copy(this.wake.lying).lerp(ctx.player.eye, k);
      cam.position.copy(this.tmp);
      cam.rotation.z += this.wake.roll * (1 - k);
      cam.updateMatrixWorld();
    }
  }

  private menuShot(dt: number): void {
    const cam = this.ctx.camera;
    const shot = this.shots[this.shotIndex % this.shots.length];
    this.shotT += dt;
    const u = Math.min(1, this.shotT / shot.dur);
    const e = u * u * (3 - 2 * u) * 0.6 + u * 0.4; // gentle ease, never fully stops
    cam.position.lerpVectors(shot.from, shot.to, e);
    // Handheld-free but alive: very slow breathing drift.
    const t = performance.now() / 1000;
    cam.position.y += Math.sin(t * 0.37) * 0.025;
    cam.position.x += Math.sin(t * 0.23) * 0.02;
    this.look.lerpVectors(shot.lookFrom, shot.lookTo, e);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    cam.rotation.z += Math.sin(t * 0.19) * 0.006;
    const fov = shot.fov ?? this.baseFov;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();

    const post = this.ctx.render.post;
    const left = shot.dur - this.shotT;
    try {
      if (this.fadeState === 'in' && this.shotT > 0.1) { this.fadeState = 'hold'; }
      if (this.fadeState === 'hold' && left < 1.6) { post.fade(1, 1.4); this.fadeState = 'out'; }
    } catch { /* ignore */ }
    if (this.shotT >= shot.dur) {
      this.shotIndex++;
      this.shotT = 0;
      this.fadeState = 'in';
      try { post.fade(BASE_FADE, 1.8); } catch { /* ignore */ }
    }
  }
}
