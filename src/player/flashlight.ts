/**
 * Head-rig flashlight on a short boom: one shadow-casting spot from the light manager, mounted above and ahead
 * of the eye line (so the cone starts beyond the hands and clears the weapon instead of blowing them out) and aimed with a spring lag behind the view (plus a little walk sway).
 *
 * The cell (TORCH): burns `burn` s from full to empty while on, recharges `recharge` s from empty to full while off
 * (after a short `settle`). The last `warn` of the charge the beam sags and stutters; at empty it dies with a short
 * flicker and cannot be switched back on until the cell holds `minOn`. The owner decides when it drains (not in a
 * cutscene / safe state / while dead) — see `update(…, drain)`.
 */
import * as THREE from 'three';
import type { LightHandle, LightManager, Physics } from '../core/types';
import { Spring3, clamp, noise1 } from './math';

export const FLASHLIGHT = {
  color: 0xcfe0ff,
  intensity: 160,
  distance: 28,
  angle: 0.42,
  penumbra: 0.5,
  /** Camera-space mount offset (right, up, back). */
  offset: new THREE.Vector3(-0.04, 0.13, -0.3),
};

/** The flashlight cell — every number of the battery mechanic. */
export const TORCH = {
  /** Seconds of light from full to empty. */
  burn: 10,
  /** Seconds from empty to full while off. */
  recharge: 4,
  /** Recharge starts this long after the lamp goes off (a beat, so a quick off/on is not free). */
  settle: 0.25,
  /** Charge needed to switch on (15 % = 1.5 s of light; 0.6 s of recharge from empty): no strobing at empty. */
  minOn: 0.15,
  /** Below this charge (2 s of burn) the beam sags and stutters as a warning. */
  warn: 0.2,
  /** Brightness at the very end of the warning (the sag is linear from 1 at `warn`). */
  sag: 0.5,
  /** The death flicker at empty (s). */
  die: 0.5,
};

const _off = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/** Brightness of the dying flicker at t ∈ [0, die): a few hard drop-outs and a last gasp. */
const DIE_KEYS: [number, number][] = [[0, 0.55], [0.06, 0.08], [0.11, 0.6], [0.17, 0.0], [0.24, 0.35], [0.29, 0.05], [0.36, 0.22], [0.42, 0.0]];

export type TorchResult = 'on' | 'off' | 'refused';

export class Flashlight {
  readonly handle: LightHandle;
  private aim = new Spring3(7, 0.85);
  private inited = false;
  on = false;
  /** Smoothed 0..1 lamp state (drives the viewmodel light level). */
  level = 0;
  /** 0 … 1 cell charge. */
  charge = 1;
  /** No drain (`?torch=inf`, tests). */
  infinite = false;
  /** Seconds into the death flicker, or −1. */
  dying = -1;
  private offFor = 0;
  private t = Math.random() * 50;
  /** Brightness factor of this frame (sag, stutter, death flicker), 0 … 1. */
  bright = 1;

  constructor(lights: LightManager, private physics: Physics) {
    this.handle = lights.add({
      type: 'spot', position: new THREE.Vector3(0, 1.6, 0), target: new THREE.Vector3(0, 1.6, -1),
      color: FLASHLIGHT.color, intensity: FLASHLIGHT.intensity, distance: FLASHLIGHT.distance,
      angle: FLASHLIGHT.angle, penumbra: FLASHLIGHT.penumbra, castShadow: true, priority: 100, enabled: false,
    });
  }

  /** The cell holds enough to switch on. */
  get ready() { return this.infinite || this.charge >= TORCH.minOn; }

  /** Switch; turning on is refused while the cell is below `minOn` (and during the death flicker). */
  set(on: boolean): TorchResult {
    if (on && !this.on) {
      if (!this.ready || this.dying >= 0) return 'refused';
      this.on = true;
    } else if (!on) {
      this.on = false;
      this.dying = -1;
      this.offFor = 0;
    }
    this.handle.enabled = this.on;
    return this.on ? 'on' : 'off';
  }

  /** Snap the cell (saves, debug). */
  setCharge(v: number) {
    this.charge = clamp(Number.isFinite(v) ? v : 1, 0, 1);
    if (this.charge > 0 && this.dying >= 0) { this.dying = -1; }
  }

  /**
   * `eye` = camera position, `q` = camera orientation, `bob` = small sway offset. `drain`: the cell burns while on.
   * Returns true on the frame the light died (empty).
   */
  update(dt: number, eye: THREE.Vector3, q: THREE.Quaternion, forward: THREE.Vector3, swayX: number, swayY: number, drain = false): boolean {
    let died = false;
    this.t += dt;
    // ── the cell
    if (this.on) {
      if (this.dying >= 0) {
        this.dying += dt;
        if (this.dying >= TORCH.die) { this.on = false; this.dying = -1; this.offFor = 0; died = true; }
      } else if (drain && !this.infinite && dt > 0) {
        this.charge = Math.max(0, this.charge - dt / TORCH.burn);
        if (this.charge <= 0) this.dying = 0;
      }
    } else {
      this.offFor += dt;
      if (this.offFor >= TORCH.settle) this.charge = Math.min(1, this.charge + dt / TORCH.recharge);
    }
    // ── brightness: full, the warning sag + stutter, or the death flicker
    let b = 1;
    if (this.on && this.dying >= 0) {
      b = 0;
      for (const [t, v] of DIE_KEYS) if (this.dying >= t) b = v;
    } else if (this.on && !this.infinite && this.charge < TORCH.warn) {
      const w = 1 - this.charge / TORCH.warn; // 0 at the warning's start → 1 at empty
      b = 1 - (1 - TORCH.sag) * w;
      // stutter: brief dips, more often and deeper toward empty (two noise octaves, gated)
      const n = noise1(this.t * 7.3, 91) * 0.6 + noise1(this.t * 23, 92) * 0.4;
      const gate = 0.55 - 0.45 * w;
      if (n > gate) b *= 1 - Math.min(1, (n - gate) * 4) * (0.35 + 0.5 * w);
      b *= 1 + noise1(this.t * 41, 93) * 0.04 * w;
    }
    this.bright = clamp(b, 0, 1);
    this.handle.enabled = this.on;
    this.handle.intensityScale = this.bright;

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
    this.level += ((this.on ? this.bright : 0) - this.level) * Math.min(1, dt * 8);
    return died;
  }
}
