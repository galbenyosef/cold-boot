/**
 * Stage 3a §8.2 / §8.3 helpers for the player's cinematic mode and safe state: settling the capsule when a scene
 * takes the camera (whatever the player was doing), and the viewmodel levels both modes hold the weapon at.
 * The controller's crouch toggle / jump buffer are private to it; the few fields a scene must reset are reached
 * through one narrow view here (no behaviour of the controller changes).
 */
import * as THREE from 'three';
import type { Physics } from '../core/types';
import { MOVE, type Controller } from './controller';

/** `cinematic(true, { viewmodel: 'lowered' })`: held low in view, muzzle down (C1: his eyes drop to it). */
export const LOWER_CINEMATIC = 0.3;
/**
 * `setSafe(true)`: the same lowered pose — muzzle down at the bottom of the frame, as far as both weapons stay in view
 * (from ≈ 0.4 they leave it), so the player sees why it will not fire. Raising takes 0.34 × 0.3 ≈ 0.1 s.
 */
export const LOWER_SAFE = 0.3;

interface CtrlPrivate { crouchToggled: boolean; jumpBuffer: number; coyote: number; airTime: number; stepDist: number; canStand(): boolean }
const priv = (c: Controller) => c as unknown as CtrlPrivate;

const DOWN = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3();

/** Forget a buffered jump (the skip key must not also jump when control returns). */
export function clearJump(c: Controller): void {
  const p = priv(c);
  p.jumpBuffer = 0;
}

/**
 * Stop the body where it is: no velocity, no sprint, no buffered jump, no carry; mid-air → feet snapped onto the
 * floor below (≤ 4 m; else left where it is and gravity finishes the fall under the scene's opening blend).
 */
export function settle(c: Controller, physics: Physics): void {
  const b = c.body, p = priv(c);
  b.velocity.set(0, 0, 0);
  c.setCarry(null);
  c.carryVel.set(0, 0, 0);
  c.sprinting = false;
  c.sprintBlend = 0;
  c.speed = 0;
  c.strafeSpeed = 0;
  p.jumpBuffer = 0;
  p.coyote = 0;
  p.stepDist = 0;
  if (!b.onGround) {
    _o.set(b.position.x, b.position.y + 0.3, b.position.z);
    let hit: ReturnType<Physics['raycast']> = null;
    try { hit = physics.raycast(_o, DOWN, 4.3); } catch { /* ignore */ }
    if (hit && hit.normal.y > 0.5) c.teleport(new THREE.Vector3(b.position.x, hit.point.y + 0.002, b.position.z));
  }
  p.airTime = 0;
}

/** Stand up at once (end of a scene: "standing"), if there is head room; the eye height snaps to standing. */
export function standNow(c: Controller): void {
  const p = priv(c);
  p.crouchToggled = false;
  if (c.crouched) {
    let ok = true;
    try { ok = p.canStand(); } catch { /* ignore */ }
    if (!ok) return;
    c.crouched = false;
    c.body.height = MOVE.height;
  }
  c.eyeHeight = MOVE.eyeStand;
  c.crouchBlend = 0;
}
