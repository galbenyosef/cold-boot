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

    let pitch = s.pitch + this.kickPitch.x + this.dmgPitch.x * 0.1 + bpitch + brP + shP;
    const yaw = s.yaw + this.kickYaw.x + brY + shY;
    let roll = this.roll + broll + this.dmgRoll.x * 0.08 + shR;

    // position: eye + bob in view-yaw space + landing dip
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    this.pos.set(s.eye.x + cos * bx, s.eye.y + by + this.landDip.x * 0.06, s.eye.z - sin * bx);

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
    const nf = damp(this.fov, target, 5, dt);
    if (Math.abs(nf - cam.fov) > 1e-3) { this.fov = nf; cam.fov = nf; cam.updateProjectionMatrix(); }
  }
}

