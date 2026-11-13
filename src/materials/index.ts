/**
 * COLD BOOT — procedural material library.
 *
 * Every surface texture is generated on the GPU at load time (see baker.ts + defs/*), producing per
 * material: albedo (sRGB, mipmapped), tangent-space normal map, and a packed ORM texture
 * (R = AO, G = roughness, B = metalness) shared by aoMap / roughnessMap / metalnessMap.
 * Geometry UVs are in metres; each material sets texture.repeat = 1 / tileSize (see TILE_SIZES).
 */
import * as THREE from 'three';
import type { DecalName, GameContext, MaterialLibrary, MaterialName, ScreenKind, SignStyle } from '../core/types';
import { Baker, type BakedTextures } from './baker';
import { SPECS, EMISSIVE, type MatSpec } from './defs';
import { applyMacro, macroConfigOf } from './macro';
import { DecalFactory, DECAL_COUNT } from './decals';
import { createSign } from './signs';
import { ScreenManager } from './screens';

/** Tile size in metres for each textured material (1 UV unit = 1 m). */
export const TILE_SIZES: Partial<Record<MaterialName, number>> = Object.fromEntries(
  Object.entries(SPECS).map(([k, s]) => [k, s.tex?.tile ?? 1]),
);

export async function createMaterials(ctx: GameContext): Promise<MaterialLibrary> {
  const t0 = performance.now();
  const renderer = ctx.renderer;
  const baker = new Baker(renderer);
  const profiling = typeof location !== 'undefined' && /[?&]matprofile=1/.test(location.search);
  if (profiling) baker.profile = {};

  // ── env tracking (all library-created materials, weakly)
  const tracked: WeakRef<THREE.MeshStandardMaterial>[] = [];
  const envMul = new WeakMap<THREE.Material, number>();
  let env: THREE.Texture | null = null;
  let envIntensity = 1;
  const track = <T extends THREE.MeshStandardMaterial>(m: T, mul: number): T => {
    envMul.set(m, mul);
    tracked.push(new WeakRef(m));
    if (env) { m.envMap = env; m.envMapIntensity = mul * envIntensity; }
    return m;
  };

  // ── bake every textured material
  const baked = new Map<string, BakedTextures>();
  const names = Object.keys(SPECS) as (keyof typeof SPECS)[];
  await baker.precompile(names.map((n) => ({ key: n, ...SPECS[n].tex! })).filter((d) => d.glsl));
  const tCompile = performance.now();
  let i = 0;
  for (const n of names) {
    const spec = SPECS[n];
    if (!spec.tex) continue;
    const tex = baker.bake({ key: n, ...spec.tex });
    const rep = 1 / spec.tex.tile;
    for (const t of [tex.map, tex.normalMap, tex.orm, tex.emissiveMap]) if (t) t.repeat.set(rep, rep);
    baked.set(n, tex);
    if (++i % 6 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  // Decals: bake every variant now — the first bake compiles GPU pipelines, which would hitch in gameplay.
  const tDecal0 = performance.now();
  const decals = new DecalFactory(baker, (m) => track(m, 1));
  decals.bakeAll();
  const tDecal = performance.now() - tDecal0;
  baker.releaseTransient();
  // force GPU completion so the measurement is honest
  {
    const px = new Uint8Array(4);
    const probe = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    renderer.setRenderTarget(probe);
    renderer.readRenderTargetPixels(probe, 0, 0, 1, 1, px);
    renderer.setRenderTarget(null);
    probe.dispose();
  }
  const tBake = performance.now();

  // ── build materials
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const build = (name: MaterialName): THREE.MeshStandardMaterial => {
    if (name in EMISSIVE) {
      const e = EMISSIVE[name as keyof typeof EMISSIVE];
      const m = new THREE.MeshStandardMaterial({
        name, color: 0x000000, roughness: 0.35, metalness: 0, emissive: e.color, emissiveIntensity: e.intensity,
      });
      return track(m, 0.4);
    }
    const spec = (SPECS as Record<string, MatSpec>)[name];
    const tex = baked.get(name)!;
    const m = new THREE.MeshStandardMaterial({
      name,
      map: tex.map,
      normalMap: tex.normalMap,
      normalScale: new THREE.Vector2(spec.normalScale ?? 1, spec.normalScale ?? 1),
      aoMap: tex.orm,
      aoMapIntensity: 1,
      roughnessMap: tex.orm,
      metalnessMap: tex.orm,
      roughness: 1,
      metalness: 1,
      ...spec.params,
    });
    if (spec.macro || spec.glass) applyMacro(m, { albedo: spec.macro?.[0] ?? 0, rough: spec.macro?.[1] ?? 0, glass: !!spec.glass });
    return track(m, spec.env);
  };
  for (const n of [...names, ...(Object.keys(EMISSIVE) as MaterialName[])]) cache.set(n, build(n as MaterialName));
  const tEnd = performance.now();
  console.info(`[materials] generated ${baked.size} texture sets + ${cache.size} materials in ${(tEnd - t0).toFixed(0)} ms ` +
    `(compile ${(tCompile - t0).toFixed(0)} ms, bake ${(tBake - tCompile).toFixed(0)} ms incl. ${DECAL_COUNT} decals ${tDecal.toFixed(0)} ms)`);

  if (profiling) { console.info('[materials] profile', JSON.stringify(baker.profile, (_k, v) => typeof v === 'number' ? Math.round(v) : v)); baker.profile = null; }
  const warned = new Set<string>();
  const get = (name: MaterialName): THREE.MeshStandardMaterial => {
    const m = cache.get(name);
    if (m) return m;
    if (!warned.has(name)) { warned.add(name); console.warn(`[materials] unknown material "${name}"`); }
    return cache.get('painted_dark')!;
  };

  const signCache = new Map<string, THREE.MeshStandardMaterial>();
  const screens = new ScreenManager((m) => track(m, 0.8), ctx.levelId ?? 1);

  const lib: MaterialLibrary = {
    get,
    clone(name, overrides) {
      const src = get(name);
      const m = src.clone();
      const cfg = macroConfigOf(src);
      if (cfg) applyMacro(m, cfg);
      if (overrides) m.setValues(overrides);
      return track(m, envMul.get(src) ?? 1);
    },
    decal(name: DecalName, variant = 0) {
      return decals.get(name, variant);
    },
    sign(text: string, style: SignStyle, aspect = 2) {
      const key = `${style}|${aspect.toFixed(3)}|${text}`;
      let m = signCache.get(key);
      if (!m) { m = track(createSign(text, style, aspect, renderer.capabilities.getMaxAnisotropy()), 0.8); signCache.set(key, m); }
      return m;
    },
    screen(kind: ScreenKind, opts) {
      return screens.create(kind, opts);
    },
    setScreen(material, kind, opts) {
      screens.set(material, kind, opts);
    },
    setEnvMap(e, intensity = 1) {
      env = e; envIntensity = intensity;
      for (let k = tracked.length - 1; k >= 0; k--) {
        const m = tracked[k].deref();
        if (!m) { tracked.splice(k, 1); continue; }
        const had = !!m.envMap;
        m.envMap = e;
        m.envMapIntensity = (envMul.get(m) ?? 1) * intensity;
        if (had !== !!e) m.needsUpdate = true;
      }
    },
    update(dt: number) {
      screens.update(dt);
    },
  };
  return lib;
}
