import * as THREE from 'three';
import type { FlickerMode, LightDesc, LightGroupPatch, LightHandle, LightManager, Quality } from '../core/types';
import { Flicker, FLICKER_MEAN } from './flicker';
import { QUALITY, type QualityPreset } from './quality';
import { LIGHT_BOX_EDGE, lightBoxesAvailable, probeBoxesAvailable } from './patch';

const FADE_TIME = 0.15;
/** Lights further than this beyond their own reach are never considered. */
const MAX_VIEW = 48;
const EMPTY: readonly LightHandle[] = Object.freeze([]);
/** §8.14 `LightDesc.minQuality`: quality rank (a light whose minQuality ranks above the current quality never scores). */
const QRANK: Record<Quality, number> = { low: 0, medium: 1, high: 2, ultra: 3 };
/** The preset objects are the QUALITY table's own (render passes them through), so the name is found by identity. */
function qualityOf(preset: QualityPreset): Quality {
  for (const k of Object.keys(QUALITY) as Quality[]) if (QUALITY[k] === preset) return k;
  // a modified copy (dev harness overrides): closest by point-slot count
  let best: Quality = 'high', d = Infinity;
  for (const k of Object.keys(QUALITY) as Quality[]) {
    const e = Math.abs(QUALITY[k].pointSlots - preset.pointSlots) + Math.abs(QUALITY[k].shadowSlots - preset.shadowSlots);
    if (e < d) { d = e; best = k; }
  }
  return best;
}

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _sphere = new THREE.Sphere();

interface EmissiveBinding { material: THREE.MeshStandardMaterial; base: number }

export class PoolSlot {
  handle: Handle | null = null;
  fade = 0;
  releasing = false;
  /** Shadow map must be re-rendered. */
  dirty = true;
  /** This frame's scheduled refresh is mandatory (light moved / slot changed), not just the periodic one. */
  must = false;
  readonly lastPos = new THREE.Vector3(Infinity, 0, 0);
  readonly lastTarget = new THREE.Vector3();
  lastAngle = 0;
  /** Data light carrying this slot's `LightDesc.bounds` (see patch.ts), or null when unsupported. */
  box: THREE.HemisphereLight | null = null;
  /** Bounds currently written to `box` (undefined = never written). */
  boxOf: THREE.Box3 | null | undefined = undefined;
  constructor(
    readonly light: THREE.SpotLight | THREE.PointLight,
    readonly isSpot: boolean,
    readonly shadow: boolean,
    readonly index: number,
  ) {}
}

export class Handle implements LightHandle {
  enabled: boolean;
  intensityScale = 1;
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly color: THREE.Color;
  readonly isSpot: boolean;
  /** Aim point actually used (differs from `target` for rotating alarm beacons). */
  readonly aim = new THREE.Vector3();
  readonly dir = new THREE.Vector3(0, -1, 0);
  readonly flicker: Flicker;
  readonly bindings: EmissiveBinding[] = [];
  /** Brightness multiplier applied to the real light. */
  _factor = 0;
  /** Public `factor` / bound-emissive multiplier. Equals `_factor` except for rotating 'alarm' spots, whose
   *  lamp stays on while the lens pulses as the beam sweeps past the viewer. */
  _pulse = 0;
  slot: PoolSlot | null = null;
  score = 0;
  eligible = false;
  selected = false;
  wantShadow = false;
  inView = false;
  /** Seconds since this light last became eligible (used to skip the fade-in for flashes). */
  onAge = 0;
  removed = false;
  /** Set once the light has been moved after creation (dynamic lights are excluded from probe signatures). */
  moved = false;
  /**
   * Stage 3a §8.4 / §8.14: pin count (live camera feeds, `LightPool.pin`). While > 0 (or `desc.pin`) the light keeps a
   * pool slot whatever the main view's score, so a room drawn only by a feed camera is lit — no second scoring path.
   */
  pins = 0;
  /** Rank among the pins (0 = most important to its feed): starved pins are the lowest-ranked ones. */
  pinRank = 0;
  private readonly p0 = new THREE.Vector3();

  constructor(readonly desc: LightDesc, private readonly mgr: LightPool, seed: number) {
    this.enabled = desc.enabled !== false;
    this.isSpot = desc.type === 'spot';
    this.position = desc.position.clone();
    this.p0.copy(this.position);
    this.target = desc.target ? desc.target.clone() : this.position.clone().add(_v.set(0, -1, 0));
    this.color = new THREE.Color(desc.color);
    this.flicker = new Flicker(seed);
    this.flicker.set(desc.flicker ?? 'none');
  }

  get factor(): number { return this._pulse; }

  setFlicker(mode: FlickerMode): void { this.flicker.set(mode); }
  setColor(color: THREE.ColorRepresentation): void { this.color.set(color); }

  bindEmissive(material: THREE.MeshStandardMaterial, baseEmissiveIntensity?: number): void {
    for (const b of this.bindings) if (b.material === material) { if (baseEmissiveIntensity !== undefined) b.base = baseEmissiveIntensity; return; }
    this.bindings.push({ material, base: baseEmissiveIntensity ?? material.emissiveIntensity });
  }

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.mgr._remove(this);
  }

  checkMoved(): void {
    if (!this.moved && this.p0.distanceToSquared(this.position) > 1e-6) this.moved = true;
  }
}

function bakeFactor(h: Handle): number {
  if (!h.enabled) return 0;
  return h.intensityScale * (h.isSpot && h.flicker.mode === 'alarm' ? 1 : FLICKER_MEAN[h.flicker.mode]);
}

function byScore(a: Handle, b: Handle): number { return b.score - a.score; }

export interface LightPoolHooks {
  onAdd(h: Handle): void;
  onRemove(h: Handle): void;
}

/**
 * Fixed pool of real three.js lights. The number of lights (and of shadow-casting lights) never changes
 * at runtime, so shader programs are compiled exactly once. Every frame the most relevant descriptors
 * are mapped onto the pool; everything else gets intensity 0.
 */
export class LightPool implements LightManager {
  readonly root = new THREE.Group();
  readonly handles: Handle[] = [];
  readonly spotSlots: PoolSlot[] = [];
  readonly pointSlots: PoolSlot[] = [];
  readonly ambient: THREE.HemisphereLight;
  /** Data lights carrying reflection-probe boxes (see patch.ts). */
  readonly boxA: THREE.HemisphereLight | null = null;
  readonly boxB: THREE.HemisphereLight | null = null;
  readonly boxParams: THREE.HemisphereLight | null = null;
  hooks: LightPoolHooks | null = null;
  /** Stats for the last update. */
  shadowUpdates = 0;
  /** §8.14: lights skipped this update because of `minQuality` (switched on, but below their quality). */
  capped = 0;
  activeSlots = 0;
  /** Pinned lights holding a slot / pinned lights left without one (no out-of-view light to displace), last update. */
  pinned = 0;
  pinStarved = 0;

  private readonly groups = new Map<string, Handle[]>();
  private readonly spotCands: Handle[] = [];
  private readonly latePins: number[] = [];
  private readonly pointCands: Handle[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private shadowCount = 0;
  private shadowEvery = 2;
  /** §8.14: current render quality rank (from the preset); lights with a higher `minQuality` are never scored. */
  private qRank = 2;
  private frame = 0;
  private seed = 1;
  private lights: THREE.Object3D[] = [];

  constructor(private readonly renderer: THREE.WebGLRenderer, preset: QualityPreset) {
    this.root.name = 'render:lights';
    this.ambient = new THREE.HemisphereLight(0x8fa6bd, 0x23211e, 0.09);
    this.ambient.layers.enableAll();
    this.root.add(this.ambient);
    if (probeBoxesAvailable) {
      this.boxA = this.dataLight();
      this.boxB = this.dataLight();
      this.boxParams = this.dataLight();
      this.setProbeBoxes(null, null, 0);
    }
    this.build(preset);
  }

  private dataLight(): THREE.HemisphereLight {
    const l = new THREE.HemisphereLight(0, 0, 1);
    l.layers.enableAll();
    this.root.add(l);
    return l;
  }

  /** Reflection-probe room boxes: fragments outside (beyond a soft margin) receive no image-based light. */
  setProbeBoxes(a: THREE.Box3 | null, b: THREE.Box3 | null, mix: number, margin = 0.5, fade = 2.0): void {
    if (!this.boxA || !this.boxB || !this.boxParams) return;
    this.writeBox(this.boxA, a, margin);
    this.writeBox(this.boxB, b, margin);
    this.boxParams.color.setRGB(mix, fade, 0);
  }

  private writeBox(l: THREE.HemisphereLight, box: THREE.Box3 | null, margin: number): void {
    if (!box) { l.color.setRGB(0, 0, 0); l.groundColor.setRGB(1e6, 1e6, 1e6); return; }
    l.color.setRGB((box.min.x + box.max.x) * 0.5, (box.min.y + box.max.y) * 0.5, (box.min.z + box.max.z) * 0.5);
    l.groundColor.setRGB((box.max.x - box.min.x) * 0.5 + margin, (box.max.y - box.min.y) * 0.5 + margin, (box.max.z - box.min.z) * 0.5 + margin);
  }

  /** (Re)create the real lights. Changing counts recompiles every lit material — only on quality change. */
  build(preset: QualityPreset): void {
    for (const h of this.handles) h.slot = null;
    for (const l of this.lights) {
      this.root.remove(l);
      const any = l as THREE.SpotLight;
      if (any.isSpotLight) this.root.remove(any.target);
      if (any.shadow?.map) { any.shadow.map.depthTexture?.dispose(); any.shadow.map.dispose(); }
      (l as THREE.Light).dispose();
    }
    for (const s of this.spotSlots) if (s.box) { this.root.remove(s.box); s.box.dispose(); }
    for (const s of this.pointSlots) if (s.box) { this.root.remove(s.box); s.box.dispose(); }
    this.lights.length = 0;
    this.spotSlots.length = 0;
    this.pointSlots.length = 0;
    this.shadowCount = preset.shadowSlots;
    this.shadowEvery = preset.shadowEvery;
    this.qRank = QRANK[qualityOf(preset)];

    const totalSpots = preset.shadowSlots + preset.spotSlots;
    for (let i = 0; i < totalSpots; i++) {
      const shadow = i < preset.shadowSlots;
      const l = new THREE.SpotLight(0xffffff, 0, 10, 0.6, 0.5, 2);
      l.name = (shadow ? 'pool:shadowSpot' : 'pool:spot') + i;
      l.layers.enableAll();
      l.target.layers.enableAll();
      l.position.set(0, -1000, 0);
      l.target.position.set(0, -1001, 0);
      if (shadow) {
        l.castShadow = true;
        l.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
        l.shadow.camera.near = 0.12;
        l.shadow.bias = -0.0006;
        l.shadow.normalBias = 0.018;
        l.shadow.radius = preset.shadowSize >= 2048 ? 2.6 : 1.8;
        l.shadow.autoUpdate = false;
        l.shadow.needsUpdate = true;
      }
      this.root.add(l, l.target);
      this.lights.push(l);
      this.spotSlots.push(new PoolSlot(l, true, shadow, i));
    }
    for (let i = 0; i < preset.pointSlots; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.name = 'pool:point' + i;
      l.layers.enableAll();
      l.position.set(0, -1000, 0);
      this.root.add(l);
      this.lights.push(l);
      this.pointSlots.push(new PoolSlot(l, false, false, i));
    }
    // One data light per slot, in shader order (all spots, then all points) — see patch.ts #4.
    if (lightBoxesAvailable) {
      for (const s of this.spotSlots) { s.box = this.dataLight(); this.writeLightBox(s, null); }
      for (const s of this.pointSlots) { s.box = this.dataLight(); this.writeLightBox(s, null); }
    }
  }

  /** Upload a slot's light bounds (null = unbounded). Only touches the uniforms when the box changes. */
  private writeLightBox(s: PoolSlot, b: THREE.Box3 | null): void {
    const l = s.box;
    if (!l) return;
    if (b === null) {
      if (s.boxOf === null) return;
      s.boxOf = null;
      l.color.setRGB(0, 0, 0);
      l.groundColor.setRGB(1e6, 1e6, 1e6);
      return;
    }
    s.boxOf = b;
    const e = LIGHT_BOX_EDGE;
    l.color.setRGB((b.min.x + b.max.x) * 0.5, (b.min.y + b.max.y) * 0.5, (b.min.z + b.max.z) * 0.5);
    l.groundColor.setRGB(Math.max((b.max.x - b.min.x) * 0.5 - e, 0), Math.max((b.max.y - b.min.y) * 0.5 - e, 0), Math.max((b.max.z - b.min.z) * 0.5 - e, 0));
  }

  setShadowQuality(preset: QualityPreset): void {
    this.shadowEvery = preset.shadowEvery;
    this.qRank = QRANK[qualityOf(preset)];
    for (const s of this.spotSlots) {
      if (!s.shadow) continue;
      const sh = (s.light as THREE.SpotLight).shadow;
      if (sh.mapSize.x !== preset.shadowSize) {
        sh.mapSize.set(preset.shadowSize, preset.shadowSize);
        sh.radius = preset.shadowSize >= 2048 ? 2.6 : 1.8;
        if (sh.map) { sh.map.depthTexture?.dispose(); sh.map.dispose(); (sh as { map: unknown }).map = null; }
      }
      s.dirty = true;
    }
  }

  // ───────────────────────────────────────────── LightManager

  add(desc: LightDesc): LightHandle {
    const h = new Handle(desc, this, this.seed++);
    this.handles.push(h);
    if (desc.group) {
      let g = this.groups.get(desc.group);
      if (!g) this.groups.set(desc.group, (g = []));
      g.push(h);
    }
    this.hooks?.onAdd(h);
    return h;
  }

  setGroup(group: string, patch: LightGroupPatch): void {
    const g = this.groups.get(group);
    if (!g) return;
    for (let i = 0; i < g.length; i++) {
      const h = g[i];
      if (patch.enabled !== undefined) h.enabled = patch.enabled;
      if (patch.intensityScale !== undefined) h.intensityScale = patch.intensityScale;
      if (patch.flicker !== undefined) h.setFlicker(patch.flicker);
      if (patch.color !== undefined) h.setColor(patch.color);
    }
  }

  group(group: string): readonly LightHandle[] {
    return this.groups.get(group) ?? EMPTY;
  }

  _remove(h: Handle): void {
    const i = this.handles.indexOf(h);
    if (i >= 0) this.handles.splice(i, 1);
    if (h.desc.group) {
      const g = this.groups.get(h.desc.group);
      if (g) { const j = g.indexOf(h); if (j >= 0) g.splice(j, 1); }
    }
    for (const s of this.spotSlots) if (s.handle === h) { s.handle = null; s.fade = 0; s.releasing = false; }
    for (const s of this.pointSlots) if (s.handle === h) { s.handle = null; s.fade = 0; s.releasing = false; }
    h.slot = null;
    h._factor = 0;
    h._pulse = 0;
    for (const b of h.bindings) b.material.emissiveIntensity = 0;
    this.hooks?.onRemove(h);
  }

  /** §8.14: is this light's `minQuality` above the current render quality? */
  belowQuality(h: Handle): boolean {
    const mq = h.desc.minQuality;
    return mq !== undefined && QRANK[mq] > this.qRank;
  }

  /**
   * Stage 3a §8.4: keep `h` in the pool while pinned (counted: two feeds may pin the same light). A pinned light is
   * selected even when it scores below the cut, by displacing the weakest selected light whose reach is OUTSIDE the
   * main frustum (it lights nothing the main view shows, so the main image cannot change). It never displaces an
   * in-view light: with no such slot left the pin waits (`pinStarved`). Shadows stay the main view's choice.
   */
  pin(h: LightHandle, on: boolean, rank = 0): void {
    const k = h as Handle;
    k.pins = Math.max(0, k.pins + (on ? 1 : -1));
    if (on) k.pinRank = k.pins === 1 ? rank : Math.min(k.pinRank, rank);
  }

  // ───────────────────────────────────────────── per-frame

  /**
   * A cheap signature of the *static* lighting state (enabled / scale / colour of lights that never moved).
   * When it changes, reflection probes are stale.
   */
  staticSignature(): number {
    let sig = 0;
    const hs = this.handles;
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      if (h.moved || (h.desc.priority ?? 1) >= 50) continue;
      if (!h.enabled || h.intensityScale <= 0) continue;
      if (this.belowQuality(h)) continue;
      const m = FLICKER_MEAN[h.flicker.mode];
      sig += (i + 1) * (h.intensityScale * m * (1 + h.color.r * 3.1 + h.color.g * 5.3 + h.color.b * 7.7));
    }
    return sig;
  }

  /**
   * Advance flicker, score every descriptor against the viewer and map the best onto the pool.
   * @param dt        simulated seconds (0 = paused: flicker does not advance)
   * @param fadeDt    wall-clock seconds driving pool fade-in/out (keeps working while paused)
   * @param viewPos   viewer position
   * @param camera    camera for frustum relevance, or null (probe capture: omnidirectional)
   * @param bake      probe-capture mode: snap fades, use mean flicker brightness, refresh all shadows
   */
  update(dt: number, fadeDt: number, viewPos: THREE.Vector3, camera: THREE.Camera | null, bake = false): void {
    this.frame++;
    const hs = this.handles;
    let frustum: THREE.Frustum | null = null;
    if (camera) {
      this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum = this.frustum.setFromProjectionMatrix(this.projScreen);
    }

    const spotCands = this.spotCands, pointCands = this.pointCands;
    spotCands.length = 0;
    pointCands.length = 0;
    this.capped = 0;

    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      const desc = h.desc;
      h.checkMoved();
      const fl = bake ? (h.isSpot && h.flicker.mode === 'alarm' ? 1 : FLICKER_MEAN[h.flicker.mode]) : h.flicker.step(dt);
      // §8.14: below its minQuality a light is never scored (no slot, no pin, no shadow); its bound emissive stays live
      const capped = this.belowQuality(h);
      if (capped && h.enabled) this.capped++;
      const base = h.enabled && !capped ? desc.intensity * h.intensityScale : 0;
      const isAlarmSpot = h.isSpot && h.flicker.mode === 'alarm';
      const factor = h.enabled ? h.intensityScale * (isAlarmSpot ? 1 : fl) : 0;
      h._factor = factor;

      // Aim direction (alarm spots sweep around the vertical axis).
      if (h.isSpot) {
        _d.subVectors(h.target, h.position);
        let len = _d.length();
        if (len < 1e-5) { _d.set(0, -1, 0); len = 1; }
        _d.multiplyScalar(1 / len);
        if (isAlarmSpot) {
          const a = h.flicker.angle;
          const horiz = Math.hypot(_d.x, _d.z);
          // Keep the authored tilt when it has a horizontal component, otherwise sweep slightly below level.
          const y = horiz > 0.35 ? _d.y : -0.32;
          const hl = Math.sqrt(Math.max(1 - y * y, 0.01));
          _d.set(Math.cos(a) * hl, y, Math.sin(a) * hl).normalize();
        }
        h.dir.copy(_d);
        h.aim.copy(h.position).addScaledVector(_d, Math.max(len, 1));
      }

      // Bound emissive fixtures follow the light; a rotating beacon's lens flares as its beam sweeps past
      // the viewer (0.12 floor: the lamp inside never goes fully dark), in phase with the rotating beam.
      let pulse = factor;
      if (isAlarmSpot && factor > 0) {
        if (bake) pulse = factor * FLICKER_MEAN.alarm;
        else {
          const vx = viewPos.x - h.position.x, vz = viewPos.z - h.position.z;
          const vl = Math.hypot(vx, vz), dl = Math.hypot(h.dir.x, h.dir.z);
          const c = vl > 1e-3 && dl > 1e-3 ? Math.max(0, (vx * h.dir.x + vz * h.dir.z) / (vl * dl)) : 1;
          const c2 = c * c;
          pulse = factor * (0.12 + 0.88 * c2 * c2);
        }
      }
      h._pulse = pulse;
      const bs = h.bindings;
      for (let j = 0; j < bs.length; j++) bs[j].material.emissiveIntensity = bs[j].base * pulse;

      // ── relevance score
      h.selected = false;
      h.wantShadow = false;
      let score = 0;
      h.inView = false;
      if (base > 1e-4) {
        const reach = desc.distance;
        let d: number;
        if (h.isSpot) {
          // distance from the viewer to the lit segment in front of the lamp
          _v.subVectors(viewPos, h.position);
          const t = THREE.MathUtils.clamp(_v.dot(h.dir), 0, reach * 0.7);
          d = _v.addScaledVector(h.dir, -t).length();
        } else {
          d = viewPos.distanceTo(h.position);
        }
        if (d < reach + MAX_VIEW) {
          let vis = 1;
          if (h.isSpot) {
            const ang = Math.min(desc.angle ?? 0.6, 1.5);
            if (ang > 0.7854) { _sphere.center.copy(h.position).addScaledVector(h.dir, reach * Math.cos(ang)); _sphere.radius = reach * Math.sin(ang); }
            else { const r = reach / (2 * Math.cos(ang)); _sphere.center.copy(h.position).addScaledVector(h.dir, r); _sphere.radius = r; }
          } else {
            _sphere.center.copy(h.position); _sphere.radius = reach;
          }
          if (frustum) { h.inView = frustum.intersectsSphere(_sphere); if (!h.inView) vis = 0.4; }
          else h.inView = true;
          const x = d / (reach * 0.75 + 3);
          const prox = 1 / (1 + x * x);
          const iTerm = Math.min(Math.max(Math.sqrt(base / 30), 0.35), 2.5);
          score = (desc.priority ?? 1) * iTerm * prox * vis;
          if (desc.volumetric) score *= 1.15;
          if (h.slot && !h.slot.releasing) score *= 1.3; // hysteresis
        }
      }
      // pinned (feeds): eligible whatever the distance / frustum, as long as it is switched on
      if (base > 1e-4 && (h.pins > 0 || (desc as LightDesc & { pin?: boolean }).pin) && score < 1e-6) score = 1e-6;
      h.score = score;
      const was = h.eligible;
      h.eligible = score > 0;
      h.onAge = h.eligible ? (was ? h.onAge + fadeDt : 0) : 0;
      if (h.eligible) (h.isSpot ? spotCands : pointCands).push(h);
    }

    const fadeStep = bake ? 1 : fadeDt / FADE_TIME;
    this.pinned = 0;
    this.pinStarved = 0;
    this.assign(spotCands, this.spotSlots, this.shadowCount, fadeStep, bake);
    this.assign(pointCands, this.pointSlots, 0, fadeStep, bake);
    this.write(bake);
  }

  private assign(cands: Handle[], slots: PoolSlot[], shadowSlots: number, fadeStep: number, bake: boolean): void {
    cands.sort(byScore);
    const n = Math.min(cands.length, slots.length);
    // Pins (feeds): a pinned light ranked below the cut swaps with the weakest unpinned selected light that is outside
    // the main frustum (no visible change); never with an in-view one. Probe bakes ignore pins.
    if (!bake && cands.length > n) {
      const late = this.latePins;
      late.length = 0;
      for (let i = n; i < cands.length; i++) {
        const p = cands[i];
        if (p.pins > 0 || (p.desc as LightDesc & { pin?: boolean }).pin) late.push(i);
      }
      if (late.length > 1) late.sort((a, b) => cands[a].pinRank - cands[b].pinRank);
      let j = n - 1;
      for (let k = 0; k < late.length; k++) {
        const i = late[k], p = cands[i];
        while (j >= 0 && (cands[j].inView || cands[j].pins > 0 || (cands[j].desc as LightDesc & { pin?: boolean }).pin)) j--;
        if (j < 0) { this.pinStarved += late.length - k; break; }
        cands[i] = cands[j];
        cands[j] = p;
        j--;
      }
    }
    for (let i = 0; i < n; i++) if (cands[i].pins > 0 || (cands[i].desc as LightDesc & { pin?: boolean }).pin) this.pinned++;
    for (let i = 0; i < n; i++) cands[i].selected = true;

    // Shadow slots go to the best castShadow requesters among the selected (with strong hysteresis).
    for (let k = 0; k < shadowSlots; k++) {
      let best: Handle | null = null, bestScore = 0;
      for (let i = 0; i < n; i++) {
        const h = cands[i];
        if (!h.desc.castShadow || h.wantShadow) continue;
        const s = h.score * (h.slot && h.slot.shadow && !h.slot.releasing ? 1.6 : 1);
        if (s > bestScore) { bestScore = s; best = h; }
      }
      if (!best) break;
      best.wantShadow = true;
    }

    // Release slots whose light is no longer selected / needs the other slot kind.
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const h = s.handle;
      if (!h) continue;
      if (s.releasing) {
        // Reclaim if the same light is wanted again in a compatible slot and has not moved elsewhere.
        if (h.selected && h.slot === null && (s.shadow || !h.wantShadow)) { s.releasing = false; h.slot = s; }
        continue;
      }
      if (!h.eligible) {
        // Switched off: its intensity is already zero, free immediately.
        s.handle = null; s.fade = 0; h.slot = null;
      } else if (!h.selected) {
        s.releasing = true; h.slot = null;
      }
    }
    // Evict squatters (non-shadow lights parked in shadow slots) when shadow lights are waiting.
    for (let i = 0; i < n; i++) {
      const h = cands[i];
      if (!h.wantShadow || (h.slot && h.slot.shadow)) continue;
      let free = false;
      for (let j = 0; j < shadowSlots; j++) if (!slots[j].handle) { free = true; break; }
      if (free) continue;
      let victim: PoolSlot | null = null;
      for (let j = 0; j < shadowSlots; j++) {
        const s = slots[j];
        if (s.releasing || !s.handle || s.handle.wantShadow) continue;
        if (!victim || s.handle.score < victim.handle!.score) victim = s;
      }
      if (victim) { victim.releasing = true; victim.handle!.slot = null; }
    }

    // Fade out releasing slots.
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.releasing) continue;
      s.fade -= fadeStep;
      if (s.fade <= 0 || !s.handle || !s.handle.eligible) { s.fade = 0; s.releasing = false; s.handle = null; }
    }

    // Give selected lights a slot.
    for (let i = 0; i < n; i++) {
      const h = cands[i];
      // (a light promoted to a shadow slot keeps its old slot until a shadow slot is actually free)
      const promote = h.wantShadow && h.slot !== null && !h.slot.shadow;
      if (h.slot && !promote) continue;
      const fresh = bake || h.onAge < 0.1;
      let slot: PoolSlot | null = null;
      if (h.wantShadow) {
        for (let j = 0; j < shadowSlots; j++) if (!slots[j].handle) { slot = slots[j]; break; }
      } else {
        for (let j = shadowSlots; j < slots.length; j++) if (!slots[j].handle) { slot = slots[j]; break; }
        if (!slot) for (let j = 0; j < shadowSlots; j++) if (!slots[j].handle) { slot = slots[j]; break; }
      }
      if (!slot && fresh) {
        // A light that just switched on (muzzle flash, breaker) must not wait: steal the most faded slot.
        const from = h.wantShadow ? 0 : 0, to = h.wantShadow ? shadowSlots : slots.length;
        for (let j = from; j < to; j++) {
          const s = slots[j];
          if (s.releasing && (!slot || s.fade < slot.fade)) slot = s;
        }
        if (slot) { slot.releasing = false; slot.handle = null; }
      }
      if (!slot) continue; // wait for a fade-out to finish
      if (h.slot) h.slot.releasing = true; // cross-fade out of the old (unshadowed) slot
      slot.handle = h;
      slot.releasing = false;
      slot.fade = fresh ? 1 : 0;
      slot.dirty = true;
      h.slot = slot;
    }

    // Fade in.
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.handle && !s.releasing && s.fade < 1) s.fade = Math.min(1, s.fade + fadeStep);
    }
  }

  private write(bake: boolean): void {
    let active = 0;
    let shadowUpdates = 0;
    const frame = this.frame;
    const spots = this.spotSlots;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const l = s.light as THREE.SpotLight;
      const h = s.handle;
      if (!h) {
        l.intensity = 0;
        if (s.shadow) l.shadow.needsUpdate = false;
        continue;
      }
      const desc = h.desc;
      const f = s.fade * s.fade * (3 - 2 * s.fade);
      // A light that currently owns a shadow map is occluded properly (and should spill through open doors),
      // so its bounds only apply while it is unshadowed.
      this.writeLightBox(s, s.shadow && desc.castShadow ? null : desc.bounds ?? null);
      l.position.copy(h.position);
      l.target.position.copy(h.aim);
      l.color.copy(h.color);
      l.intensity = desc.intensity * h._factor * f;
      l.distance = desc.distance;
      l.angle = Math.min(desc.angle ?? 0.6, 1.5);
      l.penumbra = desc.penumbra ?? 0.5;
      if (l.intensity > 0) active++;
      if (s.shadow) {
        const casts = !!desc.castShadow;
        l.shadow.intensity = casts ? 1 : 0;
        let need = false;
        if (casts && l.intensity > 0) {
          const moved = s.lastPos.distanceToSquared(h.position) > 1e-8 || s.lastTarget.distanceToSquared(h.aim) > 1e-8 || s.lastAngle !== l.angle;
          if (bake) need = true;
          else if (!h.inView) { if (moved) s.dirty = true; }
          else need = s.dirty || moved || (frame + s.index) % this.shadowEvery === 0;
          s.must = need && (bake || s.dirty || moved);
          if (need) {
            s.dirty = false;
            s.lastPos.copy(h.position);
            s.lastTarget.copy(h.aim);
            s.lastAngle = l.angle;
            shadowUpdates++;
          }
        } else if (casts) {
          s.dirty = true; // refresh as soon as it lights up again
        }
        l.shadow.needsUpdate = need;
      }
    }
    const points = this.pointSlots;
    for (let i = 0; i < points.length; i++) {
      const s = points[i];
      const l = s.light as THREE.PointLight;
      const h = s.handle;
      if (!h) { l.intensity = 0; continue; }
      const f = s.fade * s.fade * (3 - 2 * s.fade);
      this.writeLightBox(s, h.desc.bounds ?? null);
      l.position.copy(h.position);
      l.color.copy(h.color);
      l.intensity = h.desc.intensity * h._factor * f;
      l.distance = h.desc.distance;
      if (l.intensity > 0) active++;
    }
    this.activeSlots = active;
    this.shadowUpdates = shadowUpdates;
    this.renderer.shadowMap.needsUpdate = shadowUpdates > 0;
  }

  /**
   * Temporarily show every light at its time-averaged flicker brightness (probe re-capture at runtime, so a
   * 'broken' tube is not baked into the reflections as fully on or fully off). Call with false to restore.
   */
  applyBake(on: boolean): void {
    for (let k = 0; k < 2; k++) {
      const slots = k === 0 ? this.spotSlots : this.pointSlots;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const h = s.handle;
        if (!h) continue;
        const f = s.fade * s.fade * (3 - 2 * s.fade);
        s.light.intensity = h.desc.intensity * (on ? bakeFactor(h) : h._factor) * f;
      }
    }
    const hs = this.handles;
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      const bs = h.bindings;
      if (bs.length === 0) continue;
      const f = on ? (h.enabled ? h.intensityScale * FLICKER_MEAN[h.flicker.mode] : 0) : h._pulse;
      for (let j = 0; j < bs.length; j++) bs[j].material.emissiveIntensity = bs[j].base * f;
    }
  }

  /** Finish all pool fades instantly (after teleports / bakes). */
  snap(): void {
    for (const list of [this.spotSlots, this.pointSlots]) {
      for (const s of list) {
        if (s.releasing || !s.handle) { s.releasing = false; s.handle = null; s.fade = 0; }
        else s.fade = 1;
        s.dirty = true;
      }
    }
    this.write(false);
  }

  /**
   * Skip this frame's shadow-map refreshes (used on frames that are already heavy: probe re-capture).
   * Mandatory ones are redone next frame; periodic ones simply wait for their next turn.
   */
  deferShadows(): void {
    for (let i = 0; i < this.spotSlots.length; i++) {
      const s = this.spotSlots[i];
      if (!s.shadow) continue;
      const sh = (s.light as THREE.SpotLight).shadow;
      if (sh.needsUpdate) { sh.needsUpdate = false; if (s.must) s.dirty = true; }
    }
    this.shadowUpdates = 0;
    this.renderer.shadowMap.needsUpdate = false;
  }

  /** Force every shadow slot to re-render next update (after teleports, quality changes, bakes). */
  invalidateShadows(): void {
    for (const s of this.spotSlots) s.dirty = true;
  }
}
