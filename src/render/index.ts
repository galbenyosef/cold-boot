// STUB — replaced by the render task. Plain forward rendering, naive lights (no pool).
import * as THREE from 'three';
import type { GameContext, LightDesc, LightHandle, LightManager, PostFx, Quality, RenderSystem } from '../core/types';

export async function createRender(ctx: GameContext): Promise<RenderSystem> {
  const renderer = new THREE.WebGLRenderer({ canvas: ctx.canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  ctx.renderer = renderer;
  ctx.scene.background = new THREE.Color(0x020304);
  ctx.scene.add(new THREE.AmbientLight(0x8899aa, 0.6));

  const handles: (LightHandle & { light: THREE.Light })[] = [];
  const lights: LightManager = {
    add(desc: LightDesc) {
      const light = desc.type === 'spot'
        ? new THREE.SpotLight(desc.color, desc.intensity, desc.distance, desc.angle ?? 0.6, desc.penumbra ?? 0.5)
        : new THREE.PointLight(desc.color, desc.intensity, desc.distance);
      light.position.copy(desc.position);
      const target = desc.target ? desc.target.clone() : new THREE.Vector3();
      if (light instanceof THREE.SpotLight) { light.target.position.copy(target); ctx.scene.add(light.target); }
      ctx.scene.add(light);
      const h = {
        desc, light, enabled: desc.enabled !== false, intensityScale: 1,
        get factor() { return h.enabled ? h.intensityScale : 0; },
        position: light.position, target,
        setFlicker() {}, setColor(c: THREE.ColorRepresentation) { light.color.set(c); },
        bindEmissive() {}, remove() { ctx.scene.remove(light); },
      };
      handles.push(h);
      return h;
    },
    setGroup(group, patch) {
      for (const h of handles) if (h.desc.group === group) {
        if (patch.enabled !== undefined) h.enabled = patch.enabled;
        if (patch.intensityScale !== undefined) h.intensityScale = patch.intensityScale;
        if (patch.color !== undefined) h.setColor(patch.color);
      }
    },
    group: (g) => handles.filter((h) => h.desc.group === g),
  };
  const post: PostFx = { damage() {}, glitch() {}, fade() {}, setLowHealth() {}, setExposure() {} };
  let quality: Quality = ctx.debug.quality ?? 'high';
  return {
    lights, post, viewmodelLayer: 1,
    get quality() { return quality; },
    setQuality(q) { quality = q; },
    async prepare() {},
    render() {
      for (const h of handles) { h.light.intensity = h.desc.intensity * h.factor; }
      ctx.camera.layers.enableAll();
      renderer.render(ctx.scene, ctx.camera);
    },
    resize(w, h) { renderer.setSize(w, h, false); },
  };
}
