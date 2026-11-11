/**
 * Head-rig flashlight on a short boom: one shadow-casting spot from the light manager, mounted above and ahead
 * of the eye line (so the cone starts beyond the hands and clears the weapon instead of blowing them out) and aimed with a spring lag behind the view (plus a little walk sway).
 */
import * as THREE from 'three';
import type { LightHandle, LightManager, Physics } from '../core/types';
import { Spring3, clamp } from './math';

export const FLASHLIGHT = {
  color: 0xcfe0ff,
  intensity: 160,
  distance: 28,
  angle: 0.42,
  penumbra: 0.5,
  /** Camera-space mount offset (right, up, back). */
  offset: new THREE.Vector3(-0.04, 0.13, -0.3),
};

const _off = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class Flashlight {
  readonly handle: LightHandle;
  private aim = new Spring3(7, 0.85);
  private inited = false;
  on = false;
  /** Smoothed 0..1 lamp state (drives the viewmodel light level). */
  level = 0;

  constructor(lights: LightManager, private physics: Physics) {
    this.handle = lights.add({
      type: 'spot', position: new THREE.Vector3(0, 1.6, 0), target: new THREE.Vector3(0, 1.6, -1),
      color: FLASHLIGHT.color, intensity: FLASHLIGHT.intensity, distance: FLASHLIGHT.distance,
      angle: FLASHLIGHT.angle, penumbra: FLASHLIGHT.penumbra, castShadow: true, priority: 100, enabled: false,
    });
  }

  set(on: boolean) { this.on = on; this.handle.enabled = on; }

  /** `eye` = camera position, `q` = camera orientation, `bob` = small sway offset. */
  update(dt: number, eye: THREE.Vector3, q: THREE.Quaternion, forward: THREE.Vector3, swayX: number, swayY: number) {
    // aim point ~12 m along the view so the beam centre sits on the crosshair; spring-lagged
    const tgt = this.aim.target.copy(forward);
    tgt.x += swayX; tgt.y += swayY;
    if (!this.inited || dt <= 0) { this.aim.x.copy(tgt); this.aim.v.set(0, 0, 0); this.inited = true; }
    else this.aim.update(Math.min(dt, 0.05));
    _dir.copy(this.aim.x).normalize();

    _off.copy(FLASHLIGHT.offset).applyQuaternion(q);
    const pos = this.handle.position;
    pos.copy(eye).add(_off);
    // keep the lamp out of walls: clamp along eye → lamp
    const len = _off.length();
    _tmp.copy(_off).multiplyScalar(1 / len);
    const hit = this.physics.raycast(eye, _tmp, len + 0.05);
    if (hit) pos.copy(eye).addScaledVector(_tmp, clamp(hit.distance - 0.08, 0, len));
    this.handle.target.copy(eye).addScaledVector(_dir, 12);
    this.level += ((this.on ? 1 : 0) - this.level) * Math.min(1, dt * 8);
  }
}
