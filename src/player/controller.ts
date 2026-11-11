/**
 * Capsule movement: grounded acceleration/friction, limited air control, sprint (forward only),
 * jump with coyote time + buffering, crouch (toggle C) with head-clearance raycasts,
 * smooth eye height, footstep cadence + landing detection.
 */
import * as THREE from 'three';
import type { CapsuleBody, Physics } from '../core/types';
import { damp } from './math';

export const MOVE = {
  walk: 3.6,
  sprint: 6.0,
  crouch: 1.8,
  backMul: 0.82,
  groundAccel: 11,
  groundDecel: 10,
  airAccel: 1.6,
  jumpHeight: 1.0,
  radius: 0.35,
  height: 1.8,
  crouchHeight: 1.1,
  eyeStand: 1.65,
  eyeCrouch: 0.98,
  strideWalk: 0.74,
  strideRun: 0.98,
  strideCrouch: 0.58,
};

export interface MoveInput {
  /** -1..1 */
  fwd: number;
  strafe: number;
  sprint: boolean;
  jump: boolean;
  crouchToggle: boolean;
  crouchHold: boolean;
  /** Sprinting not allowed (reloading / firing). */
  noSprint: boolean;
}

export interface MoveEvents {
  footstep(running: boolean): void;
  land(speed: number): void;
  jump(): void;
}

const _wish = new THREE.Vector3();
const _o = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Controller {
  readonly body: CapsuleBody;
  crouched = false;
  private crouchToggled = false;
  eyeHeight = MOVE.eyeStand;
  sprinting = false;
  /** 0..1 smoothed sprint blend. */
  sprintBlend = 0;
  /** 0..1 smoothed crouch blend. */
  crouchBlend = 0;
  /** Footstep phase (radians; π per step). */
  bobPhase = 0;
  private stepDist = 0;
  private airTime = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private wasGrounded = true;
  private standCheckT = 0;
  private canStandCache = true;
  /** Smoothed horizontal speed (m/s). */
  speed = 0;
  /** Lateral (strafe) speed in view space, signed m/s. */
  strafeSpeed = 0;
  /** Vertical speed before collision this frame. */
  lastVy = 0;

  constructor(private physics: Physics, position: THREE.Vector3) {
    this.body = { position: position.clone(), velocity: new THREE.Vector3(), radius: MOVE.radius, height: MOVE.height, onGround: false };
  }

  get grounded() { return this.body.onGround; }

  /** True when nothing blocks the capsule growing back to standing height. */
  private canStand(): boolean {
    const p = this.body.position;
    const r = MOVE.radius * 0.7;
    const offs = [0, 0, r, 0, -r, 0, 0, r, 0, -r];
    for (let i = 0; i < offs.length; i += 2) {
      _o.set(p.x + offs[i], p.y + MOVE.crouchHeight - 0.15, p.z + offs[i + 1]);
      if (this.physics.raycast(_o, UP, MOVE.height - MOVE.crouchHeight + 0.2)) return false;
    }
    return true;
  }

  update(dt: number, inp: MoveInput | null, yaw: number, ev: MoveEvents) {
    const b = this.body;
    if (dt <= 0) return;
    // ── crouch state
    if (inp) {
      if (inp.crouchToggle) this.crouchToggled = !this.crouchToggled;
      if (inp.jump && this.crouchToggled) this.crouchToggled = false; // jump stands you up
    }
    const wantCrouch = !!inp && (this.crouchToggled || inp.crouchHold);
    if (wantCrouch && !this.crouched) {
      this.crouched = true;
      b.height = MOVE.crouchHeight;
      // crouching in the air pulls the legs up (keeps head height)
      if (!b.onGround) b.position.y += MOVE.height - MOVE.crouchHeight;
    } else if (!wantCrouch && this.crouched) {
      this.standCheckT -= dt;
      if (this.standCheckT <= 0) { this.canStandCache = this.canStand(); this.standCheckT = 0.08; }
      if (this.canStandCache) { this.crouched = false; b.height = MOVE.height; }
    }
    if (!this.crouched) this.standCheckT = 0;

    // ── wish velocity
    let fwd = inp ? inp.fwd : 0, strafe = inp ? inp.strafe : 0;
    const len = Math.hypot(fwd, strafe);
    if (len > 1) { fwd /= len; strafe /= len; }
    const sprintOk = !!inp && inp.sprint && fwd > 0.3 && !this.crouched && !inp.noSprint && (b.onGround || this.sprinting);
    this.sprinting = sprintOk;
    let speed = this.crouched ? MOVE.crouch : sprintOk ? MOVE.sprint : MOVE.walk;
    if (fwd < 0) speed *= MOVE.backMul + (1 - MOVE.backMul) * (1 - Math.abs(fwd));
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    _wish.set(-sin * fwd + cos * strafe, 0, -cos * fwd - sin * strafe).multiplyScalar(speed);
    const v = b.velocity;
    const hasWish = len > 0.01;
    let k: number;
    if (b.onGround) k = hasWish ? MOVE.groundAccel : MOVE.groundDecel;
    else k = hasWish ? MOVE.airAccel : 0.15;
    const a = 1 - Math.exp(-k * dt);
    if (b.onGround || hasWish) {
      v.x += (_wish.x - v.x) * a;
      v.z += (_wish.z - v.z) * a;
    }

    // ── jump (coyote + buffer)
    this.coyote = b.onGround ? 0.1 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = inp && inp.jump ? 0.12 : Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.crouched) {
      v.y = Math.sqrt(2 * -this.physics.gravity * MOVE.jumpHeight);
      b.onGround = false;
      this.coyote = 0; this.jumpBuffer = 0;
      ev.jump();
    }

    // ── integrate
    // physics only re-detects ground when the capsule presses into it: keep a small downward push
    if (b.onGround && v.y <= 0) v.y = -2.0;
    this.lastVy = this.airTime > 0 ? v.y : 0;
    this.physics.moveBody(b, dt);
    if (b.onGround) {
      if (!this.wasGrounded && this.airTime > 0.12) ev.land(Math.max(0, -this.lastVy));
      this.airTime = 0;
    } else this.airTime += dt;
    this.wasGrounded = b.onGround;

    // ── derived
    const hs = Math.hypot(v.x, v.z);
    this.speed = hs;
    this.strafeSpeed = v.x * cos - v.z * sin;
    this.sprintBlend = damp(this.sprintBlend, this.sprinting && hs > 2 ? 1 : 0, 6, dt);
    this.crouchBlend = damp(this.crouchBlend, this.crouched ? 1 : 0, 10, dt);
    this.eyeHeight = damp(this.eyeHeight, this.crouched ? MOVE.eyeCrouch : MOVE.eyeStand, 11, dt);

    // footstep cadence
    if (b.onGround && hs > 0.4) {
      const stride = this.crouched ? MOVE.strideCrouch : this.sprinting ? MOVE.strideRun : MOVE.strideWalk;
      this.stepDist += hs * dt;
      if (this.stepDist >= stride) { this.stepDist -= stride; ev.footstep(this.sprinting); }
      this.bobPhase = (this.bobPhase + (hs * dt / stride) * Math.PI) % (Math.PI * 2000);
    } else {
      // settle the phase toward the nearest plant so bob eases out
      this.stepDist = Math.max(0, this.stepDist - dt * 0.5);
    }
  }

  teleport(p: THREE.Vector3) {
    this.body.position.copy(p);
    this.body.velocity.set(0, 0, 0);
    this.airTime = 0;
    this.wasGrounded = true;
  }
}
