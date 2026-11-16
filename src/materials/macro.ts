/**
 * World-space macro variation injected into MeshStandardMaterial via onBeforeCompile:
 * low-frequency 3D noise modulates albedo + roughness so tiled textures never repeat visibly.
 * Also implements "glass" blending (reflections not faded by opacity).
 */
import * as THREE from 'three';

export interface MacroConfig {
  albedo: number;
  rough: number;
  glass: boolean;
  /**
   * Stage 3a shading variants. 'water': the normal map is sampled twice at two scales, scrolling in two directions
   * (phase advanced by `advanceWater`, scaled by `material.userData.flow` 0…1 — 0 stills and flattens the surface).
   * 'leaf': wrap diffuse + light through the blade from behind (thin double-sided cards).
   */
  kind?: 'water' | 'leaf';
}

interface Entry { cfg: MacroConfig; uniform: { value: THREE.Vector2 }; phase: { value: number }; flow: { value: number } }
const configs = new WeakMap<THREE.Material, Entry>();

const NOISE = /* glsl */ `
varying vec3 vMacroPos;
uniform vec2 uMacroAmt;
float mHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mHash(i), mHash(i + vec3(1,0,0)), f.x), mix(mHash(i + vec3(0,1,0)), mHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mHash(i + vec3(0,0,1)), mHash(i + vec3(1,0,1)), f.x), mix(mHash(i + vec3(0,1,1)), mHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float macroField(vec3 p) { return mNoise(p * 0.37) * 0.6 + mNoise(p * 1.3 + 7.1) * 0.3 + mNoise(p * 3.1 + 2.3) * 0.1; }
`;

function patch(this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms) {
  const entry = configs.get(this);
  if (!entry) return;
  shader.uniforms.uMacroAmt = entry.uniform;
  const kind = entry.cfg.kind;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;')
    .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 mp = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
      mp = batchingMatrix * mp;
    #endif
    #ifdef USE_INSTANCING
      mp = instanceMatrix * mp;
    #endif
    vMacroPos = (modelMatrix * mp).xyz;
  }`);
  let fs = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + NOISE);
  fs = fs.replace('#include <map_fragment>', `#include <map_fragment>
  float macroV = macroField(vMacroPos);
  diffuseColor.rgb *= 1.0 + (macroV - 0.5) * 2.0 * uMacroAmt.x;`);
  fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor * (1.0 + (macroField(vMacroPos.zxy * 1.7 + 3.0) - 0.5) * 2.0 * uMacroAmt.y), 0.03, 1.0);`);
  if (kind === 'water') {
    shader.uniforms.uWaterPhase = entry.phase;
    shader.uniforms.uWaterFlow = entry.flow;
    fs = fs.replace('#include <common>', '#include <common>\nuniform float uWaterPhase;\nuniform float uWaterFlow;');
    fs = fs.replace('#include <normal_fragment_maps>', `
  #ifdef USE_NORMALMAP_TANGENTSPACE
  {
    // two ripple trains: different scale, direction and speed; whiteout blend; flow 0 → a still mirror
    vec3 n1 = texture2D(normalMap, vNormalMapUv + vec2(0.021, 0.013) * uWaterPhase).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(normalMap, vNormalMapUv * 1.73 + vec2(0.37, 0.11) + vec2(-0.016, 0.027) * uWaterPhase).xyz * 2.0 - 1.0;
    vec3 mapN = normalize(vec3(n1.xy + n2.xy, n1.z * n2.z));
    mapN.xy *= normalScale * mix(0.04, 1.0, uWaterFlow);
    normal = normalize(tbn * mapN);
  }
  #else
  #include <normal_fragment_maps>
  #endif`);
  }
  if (kind === 'leaf') {
    // wrap diffuse (soft terminator) + transmission: a lamp behind the leaf lights it from the front, dimmer and greener
    fs = fs.replace('#include <lights_physical_pars_fragment>', leafLights());
  }
  if (entry.cfg.glass) {
    // diffuse scaled by coverage before lighting; specular stays full (blend: ONE, ONE_MINUS_SRC_ALPHA)
    fs = fs.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n  diffuseColor.rgb *= diffuseColor.a;');
  }
  shader.fragmentShader = fs;
}

export function applyMacro(mat: THREE.MeshStandardMaterial, cfg: MacroConfig) {
  configs.set(mat, { cfg, uniform: { value: new THREE.Vector2(cfg.albedo, cfg.rough) }, phase: { value: 0 }, flow: { value: 1 } });
  mat.onBeforeCompile = patch;
  mat.customProgramCacheKey = cfg.kind === 'water' ? waterKey : cfg.kind === 'leaf' ? leafKey : cfg.glass ? glassKey : macroKey;
  if (cfg.kind === 'water' && mat.userData.flow === undefined) mat.userData.flow = 1;
  if (cfg.glass) {
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    mat.premultipliedAlpha = false;
  }
}
let leafChunk: string | null = null;
/** three's physical lighting with the leaf's diffuse term (specular keeps the plain N·L). */
function leafLights(): string {
  if (leafChunk) return leafChunk;
  const src = THREE.ShaderChunk.lights_physical_pars_fragment;
  // (whitespace differs between three's source chunks and its bundled build: match loosely)
  const a = /float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);\s*vec3 irradiance = dotNL \* directLight\.color;/;
  const b = 'reflectedLight.directSpecular += irradiance * specularBRDF';
  if (!a.test(src) || !src.includes(b)) {
    console.warn('[materials] leaf lighting: three chunk changed, plain lighting used');
    return (leafChunk = src);
  }
  leafChunk = src
    .replace(a, 'float dotNLr = dot( geometryNormal, directLight.direction );\n\tfloat dotNL = saturate( dotNLr );\n' +
      '\tvec3 irradianceSpec = dotNL * directLight.color;\n' +
      '\tvec3 irradiance = ( saturate( ( dotNLr + 0.45 ) / 1.45 ) + saturate( - dotNLr ) * 0.4 ) * directLight.color;')
    .replace(b, 'reflectedLight.directSpecular += irradianceSpec * specularBRDF');
  return leafChunk;
}
function macroKey() { return 'cb-macro'; }
function waterKey() { return 'cb-macro-water'; }
function leafKey() { return 'cb-macro-leaf'; }

/**
 * Advance a water material's ripples. `material.userData.flow` (0…1, default 1) is the target the level sets; the
 * live value eases toward it over ~1.5 s (the fountain stops: the ripples die down rather than freeze).
 */
export function advanceWater(mat: THREE.Material, dt: number) {
  const e = configs.get(mat);
  if (!e || e.cfg.kind !== 'water') return;
  const target = Math.max(0, Math.min(1, Number(mat.userData.flow ?? 1)));
  e.flow.value += (target - e.flow.value) * Math.min(1, dt / 1.5);
  e.phase.value += dt * e.flow.value;
}
function glassKey() { return 'cb-macro-glass'; }

export function macroConfigOf(mat: THREE.Material): MacroConfig | undefined {
  return configs.get(mat)?.cfg;
}
