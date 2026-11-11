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
}

const configs = new WeakMap<THREE.Material, { cfg: MacroConfig; uniform: { value: THREE.Vector2 } }>();

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
  if (entry.cfg.glass) {
    // diffuse scaled by coverage before lighting; specular stays full (blend: ONE, ONE_MINUS_SRC_ALPHA)
    fs = fs.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n  diffuseColor.rgb *= diffuseColor.a;');
  }
  shader.fragmentShader = fs;
}

export function applyMacro(mat: THREE.MeshStandardMaterial, cfg: MacroConfig) {
  configs.set(mat, { cfg, uniform: { value: new THREE.Vector2(cfg.albedo, cfg.rough) } });
  mat.onBeforeCompile = patch;
  mat.customProgramCacheKey = cfg.glass ? glassKey : macroKey;
  if (cfg.glass) {
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    mat.premultipliedAlpha = false;
  }
}
function macroKey() { return 'cb-macro'; }
function glassKey() { return 'cb-macro-glass'; }

export function macroConfigOf(mat: THREE.Material): MacroConfig | undefined {
  return configs.get(mat)?.cfg;
}
