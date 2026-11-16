/**
 * COLD BOOT — live camera feeds (stage 3a §8.4, task K1).
 *
 * A feed is a second camera that renders `ctx.scene` into a small HDR target a few times a second, outside the post
 * chain, then resolves it (exposure → ACES → the game's grade → CCTV look → overlay) into an sRGB 8-bit texture that
 * any screen material can use as its `emissiveMap` (stable texture identity: bind it once).
 *
 *   per due feed (at most ONE feed pass per frame, staggered):
 *     level.setVisibilityOverride(feed rooms)   — the feed rooms' level geometry is shown for this pass only
 *     occludeForeign()                         — enemies / pickups / decals judged by the override-aware roomVisible
 *     render(scene, feed camera) → HDR target  — no shadow-map refresh, no post, no volumetrics, no MSAA
 *     restore; level.setVisibilityOverride(null)
 *     resolve pass → sRGB texture
 *
 * While a feed is active (cost only exists then):
 *   - its rooms are registered with the level (`setFeedRooms`), so the enemies' culling keeps actors standing in them
 *     drawable and animated (the main pass still hides them);
 *   - the lights standing in its rooms are `pin`ned in the light pool (no second scoring path, no extra shadow slot).
 *
 * Types are declared here; K2 moves `FeedOptions` / `FeedHandle` into core/types.ts (`RenderSystem.feed`).
 */
import * as THREE from 'three';
import type { GameContext, LightHandle, Quality } from '../core/types';
import { compilePass, drawFullscreen, passMaterial } from './fullscreen';
import type { LightPool } from './lights';
import type { LookSettings } from './post';

export interface FeedOptions {
  /** Unique id (for logs / the dev page), e.g. 'cam01'. */
  name: string;
  /** Target size in pixels on medium/high (low uses 0.75×). Default 512 × 288. */
  width?: number;
  height?: number;
  /** Updates per second (≤ 15; staggered with other feeds). Default 12. */
  hz?: number;
  /** Room ids the feed camera may show (its own room included). Everything else stays culled as for the main view. */
  rooms: string[];
  /** Camera pose (may also be set later through `handle.camera`). */
  position?: THREE.Vector3;
  target?: THREE.Vector3;
  /** Vertical fov in degrees. Default 60. */
  fov?: number;
  /** Overlay label, e.g. 'CAM 01  GALLERY N'. Empty = none. */
  label?: string;
  /** Timestamp text for the overlay (called once per second). Default: none. */
  clock?: () => string;
  /**
   * Lights pinned in the pool while active. Default (true / a budget): the lights standing in `rooms` whose reach
   * intersects the feed camera's frustum, strongest first (as seen from the feed camera), at most `PIN_BUDGET`
   * (4 points + 4 spots) — chosen once at start, so the main view's pool is disturbed as little as possible.
   * An array pins exactly those handles; false pins nothing.
   */
  pinLights?: boolean | LightHandle[] | { points: number; spots: number };
  /** Extra exposure multiplier on top of the game's look exposure (EV-style tweak per camera). Default 1. */
  exposure?: number;
  /** CCTV look strength 0…1 (scanlines, grain, desaturation, vignette). Default 1. */
  cctv?: number;
  /**
   * Static-background slices (default 4). The feed camera does not move, so the level geometry of its rooms is
   * re-rendered into a cached colour + depth background one slice (1/N of the level's objects) per update, and each
   * update draws only what moves (enemies, actors, pickups, decals) over a copy of that cache. Level changes (doors,
   * light switches, flicker, machines) therefore reach the image within N updates (4 at 12 Hz = 1/3 s).
   * 1 = draw everything every update. Moving `camera` with slices > 1 restarts the background (black until rebuilt).
   */
  slices?: number;
  /** Start active (default true). */
  active?: boolean;
}

export interface FeedHandle {
  readonly name: string;
  /** sRGB colour texture (stable identity) — use as a screen's `emissiveMap` / `map`. */
  readonly texture: THREE.Texture;
  /** The feed camera (move it freely; aspect is fixed to the target). */
  readonly camera: THREE.PerspectiveCamera;
  /** Start / stop. Stopped feeds cost nothing (no pass, no pins, no held rooms); the texture keeps the last image. */
  active: boolean;
  /** Free the targets and unpin. The handle is dead afterwards. */
  remove(): void;
}

export interface FeedStats {
  /** Active feeds. */
  active: number;
  /** Feed passes rendered in total. */
  passes: number;
  /** CPU ms of the last feed pass (submit only; the GPU cost shows in frame time). */
  lastCpuMs: number;
  /** Draw calls / triangles of the last feed pass. */
  lastCalls: number;
  lastTris: number;
  /** Pinned lights holding a pool slot / pinned lights waiting for one (pool full of main-view lights), last frame. */
  pinned: number;
  pinStarved: number;
}

/** Room visibility API published by the level on `root.userData.visibility` (level/assemble.ts). */
interface LevelVisibility {
  setOverride(rooms: ReadonlySet<string> | null): void;
  setFeedRooms(rooms: ReadonlySet<string> | null): void;
}

/** Max feeds that may be active at once (the plan uses one; two are allowed for overlap during a cut). */
export const MAX_ACTIVE_FEEDS = 2;
const LOW_SCALE = 0.75;
/** Default pin budget per feed (§8.4: CAM 01 needs 4 points + 1 spot). */
export const PIN_BUDGET = { points: 4, spots: 4 };
const VIEWMODEL_LAYER = 1;

// ───────────────────────────────────────────────────────────── resolve shader (HDR → display, CCTV)
const COPY_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
void main() {
  gl_FragColor = texture2D(tColor, vUv);
  gl_FragDepth = texture2D(tDepth, vUv).x;
}`;

const FEED_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tHdr;
uniform sampler2D tOverlay;
uniform float uExposure;
uniform float uSaturation;
uniform float uCctv;
uniform float uTime;
uniform vec2 uRes;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 ACESInputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(
    vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= 1.0 / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
void main() {
  vec2 uv = vUv;
  vec3 hdr = texture2D(tHdr, uv).rgb;
  // same tone curve and grade as the main composite (render/shaders.ts COMPOSITE_FRAG), minus the per-frame effects
  vec3 c = aces(hdr * uExposure);
  float l = dot(c, LUMA);
  c *= mix(vec3(0.80, 1.00, 1.13), vec3(1.05, 1.00, 0.94), smoothstep(0.02, 0.55, l));
  l = dot(c, LUMA);
  c = mix(vec3(l), c, uSaturation * (1.0 - 0.25 * uCctv));
  c = c * c / (c + 0.0035);
  // CCTV: scanlines, a slow roll band, grain, soft vignette
  float scan = 0.5 + 0.5 * sin(uv.y * uRes.y * 3.14159265);
  c *= 1.0 - uCctv * 0.10 * scan;
  float roll = smoothstep(0.0, 0.04, abs(fract(uv.y * 0.6 - uTime * 0.07) - 0.5));
  c *= 1.0 - uCctv * 0.05 * (1.0 - roll);
  c += uCctv * (hash12(uv * uRes + fract(uTime * 7.31) * 113.0) - 0.5) * 0.035;
  vec2 q = uv - 0.5;
  c *= 1.0 - uCctv * 0.35 * smoothstep(0.15, 0.55, dot(q, q) * 1.6);
  vec4 o = texture2D(tOverlay, uv);
  c = mix(c, o.rgb, o.a);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0); // linear; the sRGB8 target encodes on write
}`;

interface FeedImpl extends FeedHandle {
  readonly opts: FeedOptions;
  readonly rooms: ReadonlySet<string>;
  hdr: THREE.WebGLRenderTarget;
  ldr: THREE.WebGLRenderTarget;
  /** Sliced static background: the finished one (bg) and the one being built (build); null when slices = 1. */
  bg: THREE.WebGLRenderTarget | null;
  build: THREE.WebGLRenderTarget | null;
  slice: number;
  bgReady: boolean;
  /** Camera pose the background was built for (a move restarts the build). */
  bgPose: THREE.Matrix4;
  /** Seconds until due. */
  due: number;
  pinned: LightHandle[];
  overlay: HTMLCanvasElement;
  overlayTex: THREE.CanvasTexture;
  overlayText: string;
  /** Feed-system time the overlay was last redrawn. */
  overlayTimer: number;
  dead: boolean;
  _active: boolean;
}

export interface FeedHooks {
  /** Hide foreign objects (enemies, pickups, decals) in rooms that are not visible — override-aware. */
  occlude(): void;
  restore(): void;
  look(): LookSettings;
  /** Rendering stats source. */
  info: THREE.WebGLInfo;
}

export class FeedSystem {
  readonly feeds: FeedImpl[] = [];
  readonly stats: FeedStats = { active: 0, passes: 0, lastCpuMs: 0, lastCalls: 0, lastTris: 0, pinned: 0, pinStarved: 0 };
  /** Dev / test hook: called during each feed pass, after visibility is set up and before the draw. */
  onPass: ((name: string, camera: THREE.PerspectiveCamera) => void) | null = null;

  private readonly resolveMat: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly hidden: THREE.Object3D[] = [];
  private readonly blankOverlay: THREE.DataTexture;
  private readonly clear = new THREE.Color();
  private quality: Quality;
  private time = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly lights: LightPool,
    private readonly hooks: FeedHooks,
    quality: Quality,
  ) {
    this.quality = quality;
    this.blankOverlay = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    this.blankOverlay.needsUpdate = true;
    this.resolveMat = passMaterial('FeedResolve', FEED_FRAG, {
      tHdr: { value: null }, tOverlay: { value: this.blankOverlay }, uExposure: { value: 1 }, uSaturation: { value: 1 },
      uCctv: { value: 1 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(512, 288) },
    });
    this.copyMat = passMaterial('FeedCopy', COPY_FRAG, { tColor: { value: null }, tDepth: { value: null } });
    this.copyMat.depthTest = true;
    this.copyMat.depthWrite = true;
    this.copyMat.depthFunc = THREE.AlwaysDepth;
  }

  private bgTarget(w: number, h: number): THREE.WebGLRenderTarget {
    const t = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, stencilBuffer: false, generateMipmaps: false, samples: 0,
    });
    t.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    t.texture.name = 'feed:bg';
    return t;
  }

  private size(o: FeedOptions): [number, number] {
    const s = this.quality === 'low' ? LOW_SCALE : 1;
    return [Math.max(16, Math.round((o.width ?? 512) * s)), Math.max(16, Math.round((o.height ?? 288) * s))];
  }

  private makeTargets(w: number, h: number): [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] {
    const hdr = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false, generateMipmaps: false, samples: 0,
    });
    const ldr = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.SRGBColorSpace,
      // no mipmaps: one less GPU step per update; the monitor is never far enough for it to matter
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
      depthBuffer: false, stencilBuffer: false,
    });
    hdr.texture.name = 'feed:hdr';
    ldr.texture.name = 'feed:ldr';
    // valid (black) from the first frame, before the first pass
    const prev = this.renderer.getRenderTarget();
    this.renderer.getClearColor(this.clear);
    const a = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setRenderTarget(ldr);
    this.renderer.clear(true, false, false);
    this.renderer.setRenderTarget(prev);
    this.renderer.setClearColor(this.clear, a);
    return [hdr, ldr];
  }

  create(o: FeedOptions): FeedHandle {
    if (this.feeds.some((f) => f.name === o.name && !f.dead)) console.warn(`[render] feed "${o.name}" created twice`);
    const [w, h] = this.size(o);
    const [hdr, ldr] = this.makeTargets(w, h);
    const camera = new THREE.PerspectiveCamera(o.fov ?? 60, w / h, 0.05, 120);
    camera.layers.enableAll();
    camera.layers.disable(VIEWMODEL_LAYER);
    if (o.position) camera.position.copy(o.position);
    if (o.target) camera.lookAt(o.target);
    camera.updateMatrixWorld();
    const overlay = document.createElement('canvas');
    overlay.width = 512; overlay.height = 288;
    const overlayTex = new THREE.CanvasTexture(overlay);
    overlayTex.colorSpace = THREE.SRGBColorSpace;
    overlayTex.generateMipmaps = false;
    overlayTex.minFilter = THREE.LinearFilter;
    const sys = this;
    const sliced = (o.slices ?? 4) > 1;
    const f: FeedImpl = {
      name: o.name, opts: o, rooms: new Set(o.rooms), hdr, ldr, camera,
      bg: sliced ? this.bgTarget(w, h) : null, build: sliced ? this.bgTarget(w, h) : null, slice: 0, bgReady: false,
      bgPose: new THREE.Matrix4(),
      get texture() { return f.ldr.texture; },
      due: 0, pinned: [], overlay, overlayTex, overlayText: '\u0000', overlayTimer: -Infinity, dead: false, _active: false,
      get active() { return f._active; },
      set active(on: boolean) { sys.setActive(f, on); },
      remove() { sys.remove(f); },
    };
    this.feeds.push(f);
    if (o.active !== false) this.setActive(f, true);
    return f;
  }

  private level(): LevelVisibility | null {
    const lv = (this.ctx as Partial<GameContext>).level;
    return (lv?.root?.userData?.visibility as LevelVisibility | undefined) ?? null;
  }

  private setActive(f: FeedImpl, on: boolean): void {
    if (f.dead || f._active === on) return;
    if (on && this.feeds.filter((x) => x._active).length >= MAX_ACTIVE_FEEDS) {
      console.warn(`[render] feed "${f.name}": at most ${MAX_ACTIVE_FEEDS} feeds may be active — not started`);
      return;
    }
    f._active = on;
    if (on) {
      f.due = 0;
      f.slice = 0;
      f.bgReady = false; // the level may have changed while it was off
      const pin = f.opts.pinLights ?? true;
      f.camera.updateMatrixWorld();
      f.pinned = Array.isArray(pin) ? pin.slice() : pin ? this.lightsFor(f, pin === true ? PIN_BUDGET : pin) : [];
      f.pinned.forEach((h, i) => this.lights.pin(h, true, i));
    } else {
      for (const h of f.pinned) this.lights.pin(h, false);
      f.pinned = [];
    }
    this.syncRooms();
  }

  /**
   * The lights worth pinning for a feed: standing inside its rooms (0.3 m margin), switched on (enabled at start),
   * reach intersecting the feed frustum; ranked by intensity × priority / (1 + (d / reach)²) from the feed camera.
   */
  private lightsFor(f: FeedImpl, budget: { points: number; spots: number }): LightHandle[] {
    const lv = (this.ctx as Partial<GameContext>).level;
    if (!lv) return [];
    const boxes = lv.rooms.filter((r) => f.rooms.has(r.id)).map((r) => r.bounds.clone().expandByScalar(0.3));
    const cam = f.camera;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const sphere = new THREE.Sphere();
    const camPos = cam.getWorldPosition(new THREE.Vector3());
    const ranked: { h: LightHandle; s: number }[] = [];
    for (const h of this.lights.handles) {
      if (!h.enabled || h.intensityScale <= 0 || !boxes.some((b) => b.containsPoint(h.position))) continue;
      const reach = h.desc.distance;
      sphere.center.copy(h.position); sphere.radius = reach;
      if (!frustum.intersectsSphere(sphere)) continue;
      const x = camPos.distanceTo(h.position) / Math.max(reach, 0.1);
      ranked.push({ h, s: h.desc.intensity * (h.desc.priority ?? 1) / (1 + x * x) });
    }
    ranked.sort((a, b) => b.s - a.s);
    const out: LightHandle[] = [];
    let points = 0, spots = 0;
    for (const { h } of ranked) {
      if (h.desc.type === 'spot') { if (spots < budget.spots) { out.push(h); spots++; } }
      else if (points < budget.points) { out.push(h); points++; }
    }
    return out;
  }

  private syncRooms(): void {
    const v = this.level();
    if (!v) return;
    const all = new Set<string>();
    for (const f of this.feeds) if (f._active) for (const r of f.rooms) all.add(r);
    v.setFeedRooms(all.size ? all : null);
  }

  private remove(f: FeedImpl): void {
    if (f.dead) return;
    this.setActive(f, false);
    f.dead = true;
    f.hdr.dispose(); f.ldr.dispose(); f.overlayTex.dispose();
    for (const t of [f.bg, f.build]) if (t) { t.depthTexture?.dispose(); t.dispose(); }
    const i = this.feeds.indexOf(f);
    if (i >= 0) this.feeds.splice(i, 1);
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    for (const f of this.feeds) {
      const [w, h] = this.size(f.opts);
      if (f.hdr.width === w && f.hdr.height === h) continue;
      f.hdr.setSize(w, h);
      f.ldr.setSize(w, h);
      f.bg?.setSize(w, h);
      f.build?.setSize(w, h);
      f.slice = 0;
      f.bgReady = false;
      f.camera.aspect = w / h;
      f.camera.updateProjectionMatrix();
      f.due = 0;
    }
  }

  /** Compile the resolve pass now (render.prepare), so the first feed frame does not hitch. */
  warm(): void {
    const tmp = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, depthBuffer: false });
    const tmpD = this.bgTarget(4, 4);
    try { compilePass(this.renderer, this.resolveMat, tmp); compilePass(this.renderer, this.copyMat, tmpD); } finally { tmp.dispose(); tmpD.depthTexture?.dispose(); tmpD.dispose(); }
  }

  /**
   * Per frame, after the main world pass. Renders at most one due feed (the most overdue) — feeds never stack in a frame.
   * @param realDt wall-clock seconds (feeds keep their rate while the game is paused).
   */
  update(realDt: number): void {
    this.time += realDt;
    let best: FeedImpl | null = null;
    let active = 0;
    for (const f of this.feeds) {
      if (!f._active) continue;
      active++;
      f.due -= realDt;
      if (f.due <= 0 && (!best || f.due < best.due)) best = f;
    }
    this.stats.active = active;
    this.stats.pinned = this.lights.pinned;
    this.stats.pinStarved = this.lights.pinStarved;
    if (!best) return;
    const hz = Math.min(Math.max(best.opts.hz ?? 12, 0.5), 15);
    best.due = Math.max(best.due + 1 / hz, 0.25 / hz); // keep the cadence, never burst after a stall
    this.pass(best);
  }

  private pass(f: FeedImpl): void {
    const v = this.level();
    if (!v) return;
    const r = this.renderer;
    const t0 = performance.now();
    const info = this.hooks.info;
    const calls0 = info.render.calls, tris0 = info.render.triangles;

    const prevTarget = r.getRenderTarget();
    r.getClearColor(this.clear);
    const prevAlpha = r.getClearAlpha();
    const shadowNeeds = r.shadowMap.needsUpdate;
    const autoUpdate = this.scene.matrixWorldAutoUpdate;
    const sceneBg = this.scene.background;
    f.camera.updateMatrixWorld();

    v.setOverride(f.rooms);
    this.hooks.occlude();
    let draw = true;
    try {
      this.onPass?.(f.name, f.camera);
      r.shadowMap.needsUpdate = false;           // shadow maps are the main view's; never refreshed here
      this.scene.matrixWorldAutoUpdate = false;  // already updated by the main pass this frame
      const bg = this.scene.background;
      if (bg instanceof THREE.Color) r.setClearColor(bg, 1); else r.setClearColor(0x000000, 1);
      this.scene.background = null; // a Color background forces a clear inside render(): the passes below clear themselves
      const root = (this.ctx as Partial<GameContext>).level?.root;
      if (f.bg && f.build && root) {
        if (!f.bgPose.equals(f.camera.matrixWorld)) { f.bgPose.copy(f.camera.matrixWorld); f.slice = 0; f.bgReady = false; }
        const n = Math.max(2, Math.min(f.opts.slices ?? 4, 16));
        // (1) one slice of the static level into the background being built (nothing that moves)
        const hidden = this.hidden;
        const kids = this.scene.children;
        for (let i = 0; i < kids.length; i++) {
          const o = kids[i];
          if (o === root || o === this.lights.root || !o.visible || (o as THREE.Light).isLight) continue;
          o.visible = false; hidden.push(o);
        }
        const lk = root.children;
        for (let i = 0, k = 0; i < lk.length; i++) {
          const o = lk[i];
          if (!o.visible) continue;
          if (k++ % n !== f.slice) { o.visible = false; hidden.push(o); }
        }
        try {
          r.setRenderTarget(f.build);
          if (f.slice === 0) r.clear(true, true, false);
          r.render(this.scene, f.camera);
        } finally {
          for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
          hidden.length = 0;
        }
        if (++f.slice >= n) {
          const t = f.bg; f.bg = f.build; f.build = t;
          f.slice = 0;
          f.bgReady = true;
        }
        // (2) the live image: the cached background (colour + depth), then everything that is not level geometry
        if (f.bgReady) {
          this.copyMat.uniforms.tColor.value = f.bg.texture;
          this.copyMat.uniforms.tDepth.value = f.bg.depthTexture;
          drawFullscreen(r, this.copyMat, f.hdr);
          root.visible = false;
          try { r.render(this.scene, f.camera); } finally { root.visible = true; }
        } else draw = false; // still building the first background: keep the last image
      } else {
        r.setRenderTarget(f.hdr);
        r.clear(true, true, false);
        r.render(this.scene, f.camera);
      }
    } finally {
      this.scene.matrixWorldAutoUpdate = autoUpdate;
      this.scene.background = sceneBg;
      r.shadowMap.needsUpdate = shadowNeeds;
      this.hooks.restore();
      v.setOverride(null);
    }

    if (!draw) {
      r.setRenderTarget(prevTarget);
      r.setClearColor(this.clear, prevAlpha);
      this.stats.lastCpuMs = performance.now() - t0;
      return;
    }
    // overlay text (label + clock), redrawn at most once a second
    if (this.time - f.overlayTimer >= 1) {
      f.overlayTimer = this.time;
      const text = `${f.opts.label ?? ''}\n${f.opts.clock?.() ?? ''}`;
      if (text !== f.overlayText) { f.overlayText = text; this.drawOverlay(f); }
    }

    const u = this.resolveMat.uniforms;
    const look = this.hooks.look();
    u.tHdr.value = f.hdr.texture;
    u.tOverlay.value = f.overlayText.trim() ? f.overlayTex : this.blankOverlay;
    u.uExposure.value = look.exposure * (f.opts.exposure ?? 1);
    u.uSaturation.value = look.saturation;
    u.uCctv.value = f.opts.cctv ?? 1;
    u.uTime.value = this.time;
    (u.uRes.value as THREE.Vector2).set(f.ldr.width, f.ldr.height);
    drawFullscreen(r, this.resolveMat, f.ldr);

    r.setRenderTarget(prevTarget);
    r.setClearColor(this.clear, prevAlpha);
    this.stats.passes++;
    this.stats.lastCpuMs = performance.now() - t0;
    this.stats.lastCalls = info.render.calls - calls0;
    this.stats.lastTris = info.render.triangles - tris0;
  }

  private drawOverlay(f: FeedImpl): void {
    const c = f.overlay, g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    const [label, clock] = f.overlayText.split('\n');
    g.font = '600 15px ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = 'top';
    g.shadowColor = 'rgba(0,0,0,0.85)';
    g.shadowBlur = 3;
    g.fillStyle = 'rgba(235,240,232,0.92)';
    if (label) g.fillText(label, 14, 12);
    if (clock) { g.textAlign = 'right'; g.fillText(clock, c.width - 14, 12); g.textAlign = 'left'; }
    // REC dot
    g.fillStyle = 'rgba(230,40,30,0.9)';
    g.beginPath(); g.arc(c.width - 20, c.height - 20, 5, 0, Math.PI * 2); g.fill();
    f.overlayTex.needsUpdate = true;
  }
}
