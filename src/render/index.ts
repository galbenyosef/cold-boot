/**
 * COLD BOOT — render system.
 *
 *   world pass (MSAA, HDR, depth texture)  ─┐
 *   viewmodel pass (own depth, MSAA)        ├─ merge (AO, floor mist, light shafts, viewmodel)
 *   AO (half res) · volumetric shafts      ─┘     → bloom → composite (CA, ACES, grade, vignette, damage)
 *                                                  → final (glitch, FXAA, grain, fade) → canvas
 *
 * Lights: see lights.ts (fixed pool, no runtime recompiles). Reflections: see probes.ts.
 */
import * as THREE from 'three';
import type { GameContext, Quality, RenderSystem } from '../core/types';
import { FeedSystem, type FeedHandle, type FeedOptions, type FeedStats } from './feed';
import { LightPool } from './lights';
import { patchShaderChunks } from './patch';
import { PostChain, type LookSettings } from './post';
import { Probes, type RoomBox } from './probes';
import { QUALITY, type QualityPreset } from './quality';
import { Volumetrics } from './volumetrics';

const VIEWMODEL_LAYER = 1;
/**
 * Stage 3b (integration B6): meshes a level's own view culling has set aside for this view (level 4's portal cull)
 * live on this layer only. The main world pass does not draw it; reflection-probe captures do (they see all round);
 * `visible` is never touched, so the level's room visibility and the checks that walk the scene are unaffected.
 */
export const VIEW_CULL_LAYER = 30;
const FOG_COLOR = 0x0a0d10;
const FOG_DENSITY = 0.02;

export interface RenderStats {
  quality: Quality;
  width: number;
  height: number;
  lights: number;
  activeSlots: number;
  spotSlots: number;
  pointSlots: number;
  shadowUpdates: number;
  cones: number;
  probes: number;
  calls: number;
  triangles: number;
  prepareMs: number;
  /** Stage 3a §8.4: live camera feeds. */
  feeds: FeedStats;
}

/** Extras beyond the contract (look-dev + diagnostics); reachable as `ctx.render as RenderSystemEx`. */
export interface RenderSystemEx extends RenderSystem {
  readonly settings: LookSettings & { envIntensity: number; ambient: number; volumetric: number };
  stats(): RenderStats;
  /**
   * Stage 3a §8.4 (K1; moves to the contract in K2): a live camera feed into a texture. See render/feed.ts.
   * Cost exists only while `handle.active`; at most one feed pass per frame.
   */
  feed(o: FeedOptions): FeedHandle;
  /** Internals for the dev harness / console poking. Not part of the contract. */
  readonly _debug: { lights: LightPool; probes: Probes; vol: Volumetrics; post: PostChain; feeds: FeedSystem };
}

export async function createRender(ctx: GameContext): Promise<RenderSystemEx> {
  patchShaderChunks();

  let quality: Quality = ctx.debug.quality ?? (ctx.debug.mobile ? 'low' : 'high');
  let preset: QualityPreset = QUALITY[quality];

  const renderer = new THREE.WebGLRenderer({
    canvas: ctx.canvas,
    antialias: false, // the scene is rendered into MSAA targets; the canvas only receives the final quad
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.toneMapping = THREE.NoToneMapping; // filmic tonemap happens at the end of the post chain
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r187: soft (Vogel disk + hardware compare)
  renderer.shadowMap.autoUpdate = false; // the light pool decides which shadow maps refresh each frame
  ctx.renderer = renderer;

  const scene = ctx.scene;
  const camera = ctx.camera;
  const fogColor = new THREE.Color(FOG_COLOR);
  scene.background = fogColor.clone();
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

  const lights = new LightPool(renderer, preset);
  scene.add(lights.root);
  const vol = new Volumetrics(preset);
  lights.hooks = { onAdd: (h) => vol.add(h), onRemove: (h) => vol.remove(h) };
  const post = new PostChain(renderer, preset);
  const probes = new Probes(renderer, scene, lights, VIEWMODEL_LAYER, preset.probeSize);
  scene.environment = probes.texture;

  const settings = Object.assign(post.look, { envIntensity: 0.8, ambient: lights.ambient.intensity, volumetric: 1.0 });

  const camPos = new THREE.Vector3();
  const lastCamPos = new THREE.Vector3(Infinity, 0, 0);
  const black = new THREE.Color(0, 0, 0);
  const clearCol = new THREE.Color();
  let cssW = Math.max(1, innerWidth), cssH = Math.max(1, innerHeight);
  let lastTime = performance.now();
  let prepareMs = 0;

  // ── room occlusion for objects owned by other modules (enemies, pickups, decals…) ──
  // The level hides its own rooms behind closed doors; everything else in those rooms would still be drawn
  // (the level is one long axis, so most of it is inside the frustum). Such objects are hidden for the
  // duration of the world pass only and restored right after, so their owners never see `visible` change.
  const occluded: THREE.Object3D[] = [];
  function occludeForeign(): void {
    const level = (ctx as Partial<GameContext>).level;
    const roomVisible = level?.root?.userData?.roomVisible as ((x: number, z: number) => boolean) | undefined;
    if (!roomVisible) return;
    const kids = scene.children;
    for (let i = 0; i < kids.length; i++) {
      const o = kids[i];
      if (!o.visible || o === level!.root || o === lights.root || (o as THREE.Camera).isCamera) continue;
      const p = o.position;
      if (p.x !== 0 || p.z !== 0) {
        // a positioned thing (an enemy): judged by where it stands
        if (!roomVisible(p.x, p.z)) { o.visible = false; occluded.push(o); }
      } else if ((o as THREE.Group).isGroup) {
        // a container at the origin (pickups, debris, decals): judge each positioned child
        const cs = o.children;
        for (let j = 0; j < cs.length; j++) {
          const c = cs[j], q = c.position;
          if (c.visible && (q.x !== 0 || q.z !== 0) && !roomVisible(q.x, q.z)) { c.visible = false; occluded.push(c); }
        }
      }
    }
  }
  /** Stage 3b D21: hide every registered fx volume (`fx.volumes()`, wherever it is parented); returns what was hidden. */
  function hideFxVolumes(): THREE.Object3D[] {
    const fx = (ctx as Partial<GameContext>).fx as { volumes?(): readonly { object: THREE.Object3D }[] } | undefined;
    const out: THREE.Object3D[] = [];
    for (const v of fx?.volumes?.() ?? []) if (v.object.visible) { v.object.visible = false; out.push(v.object); }
    return out;
  }
  /** Hide everything that is not level geometry or a light (reflection re-capture: static world only). */
  function hideDynamic(): void {
    occluded.push(...hideFxVolumes());
    const level = (ctx as Partial<GameContext>).level;
    const kids = scene.children;
    for (let i = 0; i < kids.length; i++) {
      const o = kids[i];
      if (!o.visible || o === level?.root || o === lights.root) continue;
      o.visible = false;
      occluded.push(o);
    }
  }
  probes.onCapture = (begin) => {
    if (begin) { hideDynamic(); lights.deferShadows(); } else restoreForeign();
  };
  probes.onHeavyFrame = () => lights.deferShadows();
  function restoreForeign(): void {
    for (let i = 0; i < occluded.length; i++) occluded[i].visible = true;
    occluded.length = 0;
  }
  const feeds = new FeedSystem(ctx, renderer, scene, lights, {
    occlude: occludeForeign, restore: restoreForeign, look: () => post.look, info: renderer.info,
  }, quality);

  function applySize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio);
    const ratio = Math.min(dpr, Math.sqrt(preset.maxPixels / (cssW * cssH)));
    renderer.setPixelRatio(ratio);
    renderer.setSize(cssW, cssH, false);
    post.setSize(ctx.canvas.width, ctx.canvas.height);
  }
  applySize();

  function render(dt: number): void {
    const now = performance.now();
    const realDt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.1);
    lastTime = now;
    renderer.info.reset();

    camera.updateMatrixWorld();
    camPos.setFromMatrixPosition(camera.matrixWorld);
    const teleported = camPos.distanceToSquared(lastCamPos) > 9;
    lastCamPos.copy(camPos);

    lights.ambient.intensity = settings.ambient;
    vol.strength = settings.volumetric;
    scene.environmentIntensity = settings.envIntensity;

    // (only a level that installs `roomVisible` on its root — level 4 — gets room-scored lights)
    lights.roomVisible = ((ctx as Partial<GameContext>).level?.root?.userData?.roomVisible as ((x: number, z: number) => boolean) | undefined) ?? null;
    lights.update(dt, realDt, camPos, camera);
    if (teleported) { lights.snap(); probes.snapTo(camPos); }
    probes.update(realDt, camPos);

    // ── world
    const mask = camera.layers.mask;
    camera.layers.enableAll();
    camera.layers.disable(VIEWMODEL_LAYER);
    camera.layers.disable(VIEW_CULL_LAYER);
    const bg = scene.background;
    clearCol.copy(bg instanceof THREE.Color ? bg : fogColor);
    renderer.setRenderTarget(post.scene);
    renderer.setClearColor(clearCol, 1);
    renderer.clear();
    occludeForeign();
    renderer.render(scene, camera);
    restoreForeign();

    // ── first-person viewmodel: own target + depth, same lights, composited over the world in the merge pass
    camera.layers.set(VIEWMODEL_LAYER);
    scene.background = null;
    const autoUpdate = scene.matrixWorldAutoUpdate;
    scene.matrixWorldAutoUpdate = false;
    renderer.setRenderTarget(post.viewmodel);
    renderer.setClearColor(black, 0);
    renderer.clear();
    renderer.render(scene, camera);
    scene.matrixWorldAutoUpdate = autoUpdate;
    scene.background = bg;
    camera.layers.mask = mask;

    // ── live camera feeds (stage 3a §8.4): at most one feed pass, outside the post chain
    if (feeds.feeds.length) feeds.update(realDt);

    // ── post
    const hasVol = vol.update(dt, camera, post.depthTexture, post.vol.width, post.vol.height);
    post.update(realDt, dt);
    camera.layers.enableAll();
    post.render(camera, hasVol ? vol.scene : null);
    camera.layers.mask = mask;
  }

  async function prepare(positions: THREE.Vector3[]): Promise<void> {
    const t0 = performance.now();
    // Upload every texture now rather than on first sight.
    const seen = new Set<THREE.Texture>();
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      const list = Array.isArray(m) ? m : [m];
      for (const mat of list) {
        for (const key in mat) {
          const v = (mat as unknown as Record<string, unknown>)[key];
          if (v && (v as THREE.Texture).isTexture) seen.add(v as THREE.Texture);
        }
      }
    });
    for (const tex of seen) {
      if (tex.isRenderTargetTexture || !tex.image) continue;
      try { renderer.initTexture(tex); } catch { /* not uploadable yet — will upload lazily */ }
    }

    // The environment texture object is stable for the whole session (probes are blended *into* it), so
    // materials get it once, before compiling.
    scene.environmentIntensity = settings.envIntensity;
    try { (ctx as Partial<GameContext>).materials?.setEnvMap(probes.texture, settings.envIntensity); }
    catch (e) { console.warn('[render] materials.setEnvMap failed', e); }

    const tA = performance.now();
    // Compile every program against the HDR scene target (same output state as the real passes), then draw
    // the WHOLE scene once — hidden objects included, frustum culling off — so the driver builds every
    // pipeline state now instead of the first time something comes into view.
    const mask = camera.layers.mask;
    const hidden: THREE.Object3D[] = [];
    const culled: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) { hidden.push(o); o.visible = true; }
      if (o.frustumCulled && ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite)) {
        culled.push(o); o.frustumCulled = false;
      }
    });
    try {
      camera.layers.enableAll();
      try {
        post.precompile();
        feeds.warm();
        renderer.setRenderTarget(post.vol);
        vol.warm(renderer, camera);
      } catch (e) { console.warn('[render] pass precompile failed', e); }
      renderer.setRenderTarget(post.scene);
      try { await renderer.compileAsync(scene, camera); } catch (e) { console.warn('[render] compileAsync failed', e); }
      const bg = scene.background;
      renderer.shadowMap.needsUpdate = false;
      camera.layers.disable(VIEWMODEL_LAYER);
      renderer.setRenderTarget(post.scene);
      renderer.clear();
      renderer.render(scene, camera);
      camera.layers.set(VIEWMODEL_LAYER);
      scene.background = null;
      renderer.setRenderTarget(post.viewmodel);
      renderer.clear();
      renderer.render(scene, camera);
      scene.background = bg;
    } catch (e) {
      console.warn('[render] warm-up draw failed', e);
    } finally {
      for (const o of hidden) o.visible = false;
      for (const o of culled) o.frustumCulled = true;
      renderer.setRenderTarget(null);
      camera.layers.mask = mask;
    }

    const tB = performance.now();
    // Reflection probes.
    const level = (ctx as Partial<GameContext>).level;
    const rooms: readonly RoomBox[] = level?.rooms ?? [];
    // Stage 3b D21: no fx volume (the sea, fog, lamp grids, bounded particle sets…) in any reflection
    const shown = hideFxVolumes();
    try {
      probes.bake(positions, rooms);
    } catch (e) {
      console.error('[render] probe bake failed', e);
    } finally {
      for (const o of shown) o.visible = true;
    }

    camera.updateMatrixWorld();
    camPos.setFromMatrixPosition(camera.matrixWorld);
    lights.update(0, 0, camPos, camera);
    lights.snap();
    probes.snapTo(camPos);
    lastCamPos.copy(camPos);

    const tC = performance.now();
    // Warm everything (shadow depth programs, post passes, volumetrics) with two real frames.
    lights.invalidateShadows();
    render(0);
    render(0);
    prepareMs = performance.now() - t0;
    if (ctx.debug.verbose) {
      console.info(`[render] prepare ${prepareMs.toFixed(0)} ms (textures ${(tA - t0).toFixed(0)}, compile ${(tB - tA).toFixed(0)}, probes ${(tC - tB).toFixed(0)}, warm-up ${(performance.now() - tC).toFixed(0)})`);
    }
  }

  const system: RenderSystemEx = {
    lights,
    post,
    viewmodelLayer: VIEWMODEL_LAYER,
    settings,
    _debug: { lights, probes, vol, post, feeds },
    feed: (o) => feeds.create(o),
    get quality() { return quality; },
    setQuality(q: Quality) {
      if (q === quality) return;
      const prev = preset;
      quality = q;
      preset = QUALITY[q];
      if (prev.shadowSlots !== preset.shadowSlots || prev.spotSlots !== preset.spotSlots || prev.pointSlots !== preset.pointSlots) {
        lights.build(preset); // light counts changed → lit materials recompile once
      } else {
        lights.setShadowQuality(preset);
      }
      vol.setQuality(preset);
      post.setQuality(preset);
      probes.setFaceSize(preset.probeSize);
      feeds.setQuality(q);
      applySize();
      lastCamPos.set(Infinity, 0, 0); // snap the pool on the next frame
    },
    prepare,
    render,
    resize(width: number, height: number) {
      cssW = Math.max(1, Math.floor(width));
      cssH = Math.max(1, Math.floor(height));
      applySize();
    },
    stats() {
      return {
        quality,
        width: post.width,
        height: post.height,
        lights: lights.handles.length,
        activeSlots: lights.activeSlots,
        spotSlots: lights.spotSlots.length,
        pointSlots: lights.pointSlots.length,
        shadowUpdates: lights.shadowUpdates,
        cones: vol.count,
        probes: probes.probes.length,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        prepareMs,
        feeds: { ...feeds.stats },
      };
    },
  };
  // Dev: `?feedtest=1` (K1 spike page, render/dev/feedtest.ts) — a separate chunk, never loaded otherwise.
  if (new URLSearchParams(location.search).has('feedtest')) {
    import('./dev/feedtest').then((m) => m.installFeedTest(ctx, system)).catch((e) => console.error('[render] feedtest failed', e));
  }
  return system;
}
