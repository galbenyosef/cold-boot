/**
 * GPU texture baker: renders procedural material shaders into render targets.
 *
 * Pipeline per material:
 *   height pass (material shader, uPass 0) → float RT  [r = height 0..1, gba = masks]
 *   derive pass (generic)                  → float RT  [AO, curvature small/large, low-pass height]
 *   normal pass (generic)                  → RGBA8 mipmapped (linear)
 *   surface pass (material shader, uPass 1, MRT):
 *       target 0 → albedo SRGB8_ALPHA8 mipmapped, target 1 → ORM RGBA8 mipmapped (R = AO, G = rough, B = metal)
 * (One MRT pass instead of separate passes halves the shader work and — on ANGLE/Metal — the number of
 *  pipeline-state compiles, which dominate the cold-start cost.)
 * The temporary float targets are disposed afterwards; the final targets live for the whole session.
 */
import * as THREE from 'three';
import { GLSL_COMMON, GLSL_MAIN, GLSL_VERT } from './glsl/common';
import { GLSL_DERIVE } from './glsl/derive';

export interface TexDef {
  /** Cache key / debug name. */
  key: string;
  size: number;
  /** Tile size in metres. */
  tile: number;
  /** Metres represented by height 0..1. */
  depth: number;
  normalMul?: number;
  aoRadius?: number;
  aoStrength?: number;
  /** Material GLSL: must define `vec4 heightFn(vec2 uv)` and
   *  `void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis)`. */
  glsl: string;
  /** Extra uniforms (lets several materials share one compiled program). */
  uniforms?: Record<string, { value: unknown }>;
  seed?: number;
  /** Build albedo mips on the CPU with alpha-coverage preservation (alpha-tested cutouts). */
  coverageMips?: boolean;
  /** Clamp instead of repeat (decals). */
  clamp?: boolean;
}

export interface BakedTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  orm: THREE.Texture;
  emissiveMap: THREE.Texture | null;
}

export class Baker {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private programs = new Map<string, THREE.RawShaderMaterial>();
  private derive: THREE.RawShaderMaterial;
  private floatType: THREE.TextureDataType;
  private anisotropy: number;
  private coverageMat: THREE.RawShaderMaterial | null = null;

  private pack: THREE.RawShaderMaterial;
  private pools = new Map<number, { h: THREE.WebGLRenderTarget; d: THREE.WebGLRenderTarget; s: THREE.WebGLRenderTarget }>();

  private floatMRT(N: number) {
    return new THREE.WebGLRenderTarget(N, N, {
      count: 2, type: this.floatType, format: THREE.RGBAFormat, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false, stencilBuffer: false,
    });
  }
  /** Transient float targets, reused across bakes of the same size (freed by releaseTransient()). */
  private transient(N: number) {
    let p = this.pools.get(N);
    if (!p) { p = { h: this.floatMRT(N), d: this.target(N, { float: true }), s: this.floatMRT(N) }; this.pools.set(N, p); }
    return p;
  }
  releaseTransient() {
    for (const p of this.pools.values()) { p.h.dispose(); p.d.dispose(); p.s.dispose(); }
    this.pools.clear();
  }

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.floatType = renderer.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.HalfFloatType;
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.derive = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: GLSL_VERT,
      fragmentShader: GLSL_DERIVE,
      uniforms: {
        tH: { value: null }, uRes: { value: new THREE.Vector2() }, uTile: { value: 1 }, uDepth: { value: 0.01 },
        uMode: { value: 0 }, uNormalMul: { value: 1 }, uAoRadius: { value: 0.02 }, uAoStrength: { value: 1 },
      },
      depthTest: false, depthWrite: false,
    });
    this.pack = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: GLSL_VERT,
      fragmentShader: /* glsl */ `
        precision highp float; precision highp sampler2D;
        layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
        uniform sampler2D tA; uniform sampler2D tO;
        void main() { ivec2 p = ivec2(gl_FragCoord.xy); o0 = texelFetch(tA, p, 0); o1 = texelFetch(tO, p, 0); }`,
      uniforms: { tA: { value: null }, tO: { value: null } },
      depthTest: false, depthWrite: false,
    });
  }

  program(glsl: string, extra?: Record<string, { value: unknown }>): THREE.RawShaderMaterial {
    let p = this.programs.get(glsl);
    if (!p) {
      p = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: GLSL_VERT,
        fragmentShader: coldPrefix() + GLSL_COMMON + glsl + GLSL_MAIN,
        uniforms: {
          uRes: { value: new THREE.Vector2() }, uPass: { value: 0 }, uSeed: { value: 0 }, uTile: { value: 1 },
          uDepth: { value: 0.01 }, tH: { value: null }, tD: { value: null }, ...(extra ? cloneUniforms(extra) : {}),
        },
        depthTest: false, depthWrite: false,
      });
      this.programs.set(glsl, p);
    }
    return p;
  }

  /** Compile every program that will be needed, in parallel where the driver supports it. */
  async precompile(defs: TexDef[]): Promise<void> {
    const scene = new THREE.Scene();
    const geo = this.quad.geometry;
    const seen = new Set<THREE.Material>();
    for (const d of defs) {
      const m = this.program(d.glsl, d.uniforms);
      if (seen.has(m)) continue;
      seen.add(m);
      const mesh = new THREE.Mesh(geo, m);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    for (const extra of [this.derive, this.pack]) { const em = new THREE.Mesh(geo, extra); em.frustumCulled = false; scene.add(em); }
    try { await this.renderer.compileAsync(scene, this.camera); } catch (e) { console.warn('[materials] compileAsync failed', e); }
  }

  private target(size: number, opts: { float?: boolean; srgb?: boolean; mips?: boolean; clamp?: boolean }): THREE.WebGLRenderTarget {
    const wrap = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    return new THREE.WebGLRenderTarget(size, size, {
      type: opts.float ? this.floatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      wrapS: wrap, wrapT: wrap,
      minFilter: opts.float ? THREE.NearestFilter : (opts.mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter),
      magFilter: opts.float ? THREE.NearestFilter : THREE.LinearFilter,
      generateMipmaps: !!opts.mips && !opts.float,
      anisotropy: opts.float ? 1 : this.anisotropy,
      colorSpace: opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  /** Set to an object to collect per-pass GPU timings (syncs after every pass — debug only). */
  profile: Record<string, number> | null = null;
  private syncBuf = new Float32Array(4);
  private syncBuf8 = new Uint8Array(4);

  private draw(mat: THREE.Material, rt: THREE.WebGLRenderTarget, label = 'pass') {
    this.quad.material = mat;
    this.renderer.setRenderTarget(rt);
    const t = this.profile ? performance.now() : 0;
    this.renderer.render(this.scene, this.camera);
    if (this.profile) {
      const isFloat = rt.texture.type !== THREE.UnsignedByteType;
      this.renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, (isFloat ? this.syncBuf : this.syncBuf8) as never);
      this.profile[label] = (this.profile[label] ?? 0) + performance.now() - t;
    }
  }

  bake(def: TexDef): BakedTextures {
    const r = this.renderer;
    const tb = this.profile ? performance.now() : 0;
    const prevRT = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    const prevXr = r.xr.enabled;
    r.xr.enabled = false;
    r.autoClear = false;
    const N = def.size;
    const prog = this.program(def.glsl, def.uniforms);
    const u = prog.uniforms;
    u.uRes.value.set(N, N);
    u.uSeed.value = def.seed ?? 0;
    u.uTile.value = def.tile;
    u.uDepth.value = def.depth;
    if (def.uniforms) for (const k in def.uniforms) u[k].value = def.uniforms[k].value;

    // Every material-program draw goes to the same attachment layout (2 × float) so each program needs
    // exactly one GPU pipeline — on ANGLE/Metal pipeline creation is what dominates a cold start.
    const pool = this.transient(N);
    u.uPass.value = 0;
    this.draw(prog, pool.h, 'height');

    const du = this.derive.uniforms;
    du.tH.value = pool.h.textures[0];
    du.uRes.value.set(N, N);
    du.uTile.value = def.tile;
    du.uDepth.value = def.depth;
    du.uNormalMul.value = def.normalMul ?? 1;
    du.uAoRadius.value = def.aoRadius ?? 0.02;
    du.uAoStrength.value = def.aoStrength ?? 1;
    du.uMode.value = 0;
    this.draw(this.derive, pool.d, 'derive');

    const nRT = this.target(N, { mips: true, clamp: def.clamp });
    du.uMode.value = 1;
    this.draw(this.derive, nRT, 'normal');

    u.tH.value = pool.h.textures[0];
    u.tD.value = pool.d.texture;
    u.uPass.value = 1;
    this.draw(prog, pool.s, 'surface');

    // pack: float albedo + ORM → final mipmapped 8-bit targets (albedo sRGB, or linear for the coverage path)
    const outRT = new THREE.WebGLRenderTarget(N, N, {
      count: 2, type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      wrapS: def.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping, wrapT: def.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
      anisotropy: this.anisotropy, colorSpace: def.coverageMips ? THREE.NoColorSpace : THREE.SRGBColorSpace,
      depthBuffer: false, stencilBuffer: false,
    });
    outRT.textures[1].colorSpace = THREE.NoColorSpace;
    this.pack.uniforms.tA.value = pool.s.textures[0];
    this.pack.uniforms.tO.value = pool.s.textures[1];
    this.draw(this.pack, outRT, 'pack');
    this.pack.uniforms.tA.value = null; this.pack.uniforms.tO.value = null;
    let map: THREE.Texture = outRT.textures[0];
    if (def.coverageMips) {
      const tc = performance.now();
      map = this.coverageAlbedo(outRT.textures[0], N, def.clamp);
      if (this.profile) this.profile.coverage = (this.profile.coverage ?? 0) + performance.now() - tc;
    }
    const orm = outRT.textures[1];
    const emissiveMap: THREE.Texture | null = null;
    u.tH.value = null; u.tD.value = null; du.tH.value = null;

    r.setRenderTarget(prevRT);
    r.autoClear = prevAutoClear;
    r.xr.enabled = prevXr;
    for (const t of [map, nRT.texture, orm]) t.name = def.key;
    if (this.profile) this.profile['mat:' + def.key] = performance.now() - tb;
    return { map, normalMap: nRT.texture, orm, emissiveMap };
  }

  /**
   * Alpha-tested textures lose their coverage in hardware mips (thin bars average below the alpha test and
   * vanish at distance). Build the chain manually: rgb = alpha-weighted average, alpha rescaled so the
   * coverage stays roughly constant.
   */
  private coverageAlbedo(srcTex: THREE.Texture, N: number, clamp?: boolean): THREE.Texture {
    const r = this.renderer;
    // srcTex: linear RGBA8 storage with hardware mips; the coverage shader re-encodes to sRGB.
    if (!this.coverageMat) {
      this.coverageMat = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: GLSL_VERT,
        fragmentShader: /* glsl */ `
          precision highp float; precision highp sampler2D;
          out vec4 fragColor; uniform sampler2D tSrc; uniform float uLevel; uniform vec2 uRes; uniform float uBoost;
          vec3 l2s(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
          void main(){
            vec2 uv = gl_FragCoord.xy / uRes;
            vec4 c = textureLod(tSrc, uv, uLevel);
            vec3 rgb = c.rgb;   // material shaders dilate the colour into holes, so no premultiply needed
            float a = clamp(c.a * uBoost, 0.0, 1.0);
            fragColor = vec4(l2s(clamp(rgb, 0.0, 1.0)), a);
          }`,
        uniforms: { tSrc: { value: null }, uLevel: { value: 0 }, uRes: { value: new THREE.Vector2() }, uBoost: { value: 1 } },
        depthTest: false, depthWrite: false,
      });
    }
    const cm = this.coverageMat;
    cm.uniforms.tSrc.value = srcTex;
    // measure base coverage from the top mip
    const levels = Math.log2(N) + 1;
    const mipmaps: { data: Uint8Array; width: number; height: number }[] = [];
    let baseCoverage = 0;
    for (let L = 0; L < levels; L++) {
      const s = Math.max(1, N >> L);
      const rt = new THREE.WebGLRenderTarget(s, s, { depthBuffer: false, type: THREE.UnsignedByteType });
      cm.uniforms.uLevel.value = L;
      cm.uniforms.uRes.value.set(s, s);
      cm.uniforms.uBoost.value = 1;
      const data = new Uint8Array(s * s * 4);
      if (L > 0 && baseCoverage > 0) {
        // estimate coverage at this level with boost 1, then compute boost to match base coverage.
        this.draw(cm, rt);
        r.readRenderTargetPixels(rt, 0, 0, s, s, data);
        // Choose a boost that makes the fraction of texels above the alpha test ≈ base coverage.
        let lo = 1, hi = 8;
        for (let it = 0; it < 7; it++) {
          const mid = (lo + hi) / 2;
          if (coverageScaled(data, mid, 0.5) < baseCoverage) lo = mid; else hi = mid;
        }
        cm.uniforms.uBoost.value = (lo + hi) / 2;
      }
      this.draw(cm, rt);
      r.readRenderTargetPixels(rt, 0, 0, s, s, data);
      if (L === 0) baseCoverage = coverageOf(data, 0.5);
      mipmaps.push({ data, width: s, height: s });
      rt.dispose();
    }
    cm.uniforms.tSrc.value = null;
    const tex = new THREE.DataTexture(mipmaps[0].data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.mipmaps = mipmaps as unknown as THREE.DataTexture['mipmaps'];
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.anisotropy = this.anisotropy;
    tex.flipY = false;
    tex.needsUpdate = true;
    return tex;
  }

  dispose() {
    for (const p of this.programs.values()) p.dispose();
    this.derive.dispose();
    this.pack.dispose();
    this.coverageMat?.dispose();
    this.releaseTransient();
    this.quad.geometry.dispose();
  }
}

/** Debug: ?matcold=1 makes every shader source unique so driver shader caches can't hide compile cost. */
function coldPrefix() {
  if (typeof location === 'undefined' || !/[?&]matcold=1/.test(location.search)) return '';
  return `#define COLD_${Math.floor(Math.random() * 1e9)} 1\n`;
}
function coverageOf(d: Uint8Array, t: number) {
  let n = 0; const th = t * 255;
  for (let i = 3; i < d.length; i += 4) if (d[i] >= th) n++;
  return n / (d.length / 4);
}
function coverageScaled(d: Uint8Array, k: number, t: number) {
  let n = 0; const th = t * 255;
  for (let i = 3; i < d.length; i += 4) if (d[i] * k >= th) n++;
  return n / (d.length / 4);
}
function cloneUniforms(u: Record<string, { value: unknown }>) {
  const o: Record<string, { value: unknown }> = {};
  for (const k in u) {
    const v = u[k].value as { clone?: () => unknown };
    o[k] = { value: v && typeof v.clone === 'function' ? v.clone() : u[k].value };
  }
  return o;
}
