/**
 * Camera feel: head bob synced to the footstep phase, landing dip, strafe roll, trauma shake
 * (noise-driven rotation), recoil kick that recovers, damage kick toward the hit, idle breathing,
 * sprint FOV kick and the death collapse.
 */
import * as THREE from 'three';
import { Spring, damp, noise1, clamp } from './math';

export interface CamState {
  eye: THREE.Vector3;
  yaw: number;
  pitch: number;
  bobPhase: number;
  /** 0..1 bob amplitude (speed-scaled, 0 in the air). */
  bobAmp: number;
  sprint: number;
  crouch: number;
  /** Current eye height above the feet. */
  eyeHeight: number;
  /** Signed strafe speed (m/s), + = right. */
  strafe: number;
  time: number;
  /** 0..1 running-belt shudder (conveyor carry). Optional. */
  shudder?: number;
  /** Carry speed in m/s (drives the slat-seam bumps). Optional. */
  carrySpeed?: number;
  /** Aim-down-sights zoom: blend 0..1 toward `zoomFov` (degrees). Optional. */
  zoom?: number;
  zoomFov?: number;
}

export class CameraRig {
  trauma = 0;
  private landDip = new Spring(5, 0.55);
  readonly kickPitch = new Spring(5.5, 0.8);
  readonly kickYaw = new Spring(5.5, 0.8);
  private dmgPitch = new Spring(4, 0.5);
  private dmgRoll = new Spring(3.5, 0.45);
  private roll = 0;
  private bobA = 0;
  private shud = 0;
  private slatPhase = 0;
  private slatDip = 0;
  private fov: number;
  private baseFov: number;
  deathT = -1;
  private deathRollSign = 1;
  /** Final world position of the camera this frame (after bob / death). */
  readonly pos = new THREE.Vector3();

  constructor(private cam: THREE.PerspectiveCamera) {
    this.baseFov = cam.fov;
    this.fov = cam.fov;
  }

  shake(a: number) { this.trauma = clamp(Math.max(this.trauma, Math.min(1, this.trauma + a)), 0, 1); }
  land(speed: number) {
    const s = clamp((speed - 2) / 10, 0, 1);
    this.landDip.impulse(-(0.35 + s * 1.6));
    if (speed > 7) this.shake(s * 0.35);
  }
  jump() { this.landDip.impulse(0.25); }
  kick(pitch: number, yaw: number) { this.kickPitch.impulse(pitch); this.kickYaw.impulse(yaw); }
  /** `side` −1..1 (hit from the left/right), `front` −1..1 (from in front / behind). */
  damage(side: number, front: number, amount: number) {
    const k = clamp(amount / 25, 0.25, 1.4);
    this.dmgRoll.impulse(-side * 0.9 * k);
    this.dmgPitch.impulse(front * 0.8 * k);
    this.shake(0.18 * k);
  }
  die() { this.deathT = 0; this.deathRollSign = Math.random() < 0.5 ? -1 : 1; }
  revive() { this.deathT = -1; }

  update(dt: number, s: CamState) {
    const cam = this.cam;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.landDip.update(dt);
    this.kickPitch.update(dt);
    this.kickYaw.update(dt);
    this.dmgPitch.update(dt);
    this.dmgRoll.update(dt);
    this.bobA = damp(this.bobA, s.bobAmp, 9, dt);
    this.roll = damp(this.roll, -clamp(s.strafe / 6, -1, 1) * 0.022, 6, dt);

    // bob: foot plants at phase kπ → lowest point
    const ph = s.bobPhase;
    const A = this.bobA * (1 + s.sprint * 0.6) * (1 - s.crouch * 0.45);
    const by = -(1 - Math.abs(Math.sin(ph))) * 0.034 * A + 0.017 * A;
    const bx = Math.sin(ph) * 0.016 * A;
    const broll = Math.sin(ph) * 0.006 * A;
    const bpitch = Math.cos(ph * 2) * 0.004 * A;

    // breathing (stronger when still)
    const still = 1 - Math.min(1, this.bobA * 2);
    const t = s.time;
    const brP = (Math.sin(t * 1.35) * 0.0028 + noise1(t * 0.3, 7) * 0.002) * (0.4 + still * 0.6);
    const brY = noise1(t * 0.22, 8) * 0.0025 * (0.4 + still * 0.6);

    // trauma shake
    const sh = this.trauma * this.trauma;
    const f = 22;
    const shP = sh * 0.07 * noise1(t * f, 11);
    const shY = sh * 0.07 * noise1(t * f, 12);
    const shR = sh * 0.09 * noise1(t * f, 13);

    // running belt: a fine motor buzz through the soles plus a soft knock at every slat seam
    this.shud = damp(this.shud, clamp(s.shudder ?? 0, 0, 1), 8, dt);
    let beltY = 0, beltR = 0, beltP = 0;
    if (this.shud > 1e-3) {
      const sp = s.carrySpeed ?? 0;
      this.slatPhase += sp * dt / 0.42;
      if (this.slatPhase >= 1) { this.slatPhase -= Math.floor(this.slatPhase); this.slatDip = 1; }
      this.slatDip = Math.max(0, this.slatDip - dt * 9);
      const knock = this.slatDip * this.slatDip;
      const k = this.shud;
      beltY = (noise1(t * 31, 21) * 0.0016 - knock * 0.0045) * k;
      beltR = noise1(t * 17, 22) * 0.0022 * k;
      beltP = (noise1(t * 26, 23) * 0.0011 + knock * 0.0012) * k;
    }

    let pitch = s.pitch + this.kickPitch.x + this.dmgPitch.x * 0.1 + bpitch + brP + shP + beltP;
    const yaw = s.yaw + this.kickYaw.x + brY + shY;
    let roll = this.roll + broll + this.dmgRoll.x * 0.08 + shR + beltR;

    // position: eye + bob in view-yaw space + landing dip
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    this.pos.set(s.eye.x + cos * bx, s.eye.y + by + this.landDip.x * 0.06 + beltY, s.eye.z - sin * bx);

    // death collapse
    if (this.deathT >= 0) {
      this.deathT = Math.min(1.6, this.deathT + dt);
      const k = this.deathT / 1.1;
      const fall = k >= 1 ? 1 : 1 - Math.pow(1 - k, 3);
      const bounce = k > 1 ? Math.sin((this.deathT - 1.1) * 14) * Math.exp(-(this.deathT - 1.1) * 8) * 0.03 : 0;
      const floorEye = 0.28;
      this.pos.y = THREE.MathUtils.lerp(s.eye.y, s.eye.y - s.eyeHeight + floorEye, fall) + bounce;
      roll += this.deathRollSign * 1.35 * fall;
      pitch = THREE.MathUtils.lerp(pitch, -0.1, fall * 0.8);
    }

    cam.position.copy(this.pos);
    cam.rotation.set(pitch, yaw, roll, 'YXZ');
    const target = this.baseFov + s.sprint * 6;
    this.fov = damp(this.fov, target, 5, dt);
    const z = clamp(s.zoom ?? 0, 0, 1);
    const nf = z > 0 ? this.fov + ((s.zoomFov ?? this.fov) - this.fov) * z : this.fov;
    this.lastFov = nf;
    if (Math.abs(nf - cam.fov) > 1e-3) { cam.fov = nf; cam.updateProjectionMatrix(); }
  }
  private lastFov = 0;
  /** The fov without the aim zoom (sprint kick included) and the one set this frame. */
  get hipFov() { return this.fov; }
  get fovNow() { return this.lastFov || this.fov; }
  /** tan(fov/2) of this frame against the unzoomed one: what the aim zoom does to angles on screen (1 at the hip). */
  get zoomScale() {
    const h = Math.tan(THREE.MathUtils.degToRad(this.fov) / 2), n = Math.tan(THREE.MathUtils.degToRad(this.fovNow) / 2);
    return h > 0 ? n / h : 1;
  }
}

