/**
 * GLSL for the FX passes. All particle materials use premultiplied-alpha blending
 * (ONE, ONE_MINUS_SRC_ALPHA) so additive (alpha = 0) and alpha-blended particles share one draw call.
 * Lighting uses three's real light uniforms (`lights: true`), evaluated per vertex, so smoke / motes /
 * droplets are lit by whatever the LightManager has mapped onto its pool (flashlight included).
 */
import * as THREE from 'three';

/** Vertex-stage lighting helper. Requires `#include <common>` and `#include <lights_pars_begin>` first. */
export const FX_LIGHT = /* glsl */ `
float fxPhase(float cosT, float g) {
  float g2 = g * g;
  float hg = (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * cosT, 1e-3), 1.5);
  return mix(1.0, hg, 0.45);
}
// p: view-space position. Returns irradiance (before 1/PI). domDir: luminance-weighted light direction.
vec3 fxLight(vec3 p, float g, out vec3 domDir) {
  vec3 viewDir = normalize(-p);
  vec3 total = ambientLightColor;
  domDir = vec3(0.0);
  float w;
  vec3 c;
  IncidentLight L;
#if NUM_HEMI_LIGHTS > 0
  // only hemisphere light 0 is a light: #1 … are the render module's data lights (probe boxes, per-slot light boxes —
  // world centres and half extents in their colours, render/patch.ts). Summing them lit fx volumes by coordinates
  // (IB5b: the cold store's floor fog glowed with every light out).
  total += 0.5 * (hemisphereLights[0].skyColor + hemisphereLights[0].groundColor);
#endif
#if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    getDirectionalLightInfo(directionalLights[i], L);
    c = L.color * fxPhase(dot(-L.direction, viewDir), g);
    total += c; w = dot(c, vec3(0.3333)); domDir += L.direction * w;
  }
#endif
#if NUM_POINT_LIGHTS > 0
  for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
    // own falloff with a clamped minimum distance: a light inside a puff must not explode to 100x
    vec3 lv = pointLights[i].position - p;
    float ld = length(lv);
    L.direction = lv / max(ld, 1e-4);
    L.color = pointLights[i].color * getDistanceAttenuation(max(ld, 0.6), pointLights[i].distance, pointLights[i].decay);
    if (pointLights[i].distance > 0.0 && ld > pointLights[i].distance) L.color = vec3(0.0);
    c = L.color * fxPhase(dot(-L.direction, viewDir), g);
    total += c; w = dot(c, vec3(0.3333)); domDir += L.direction * w;
  }
#endif
#if NUM_SPOT_LIGHTS > 0
  for (int i = 0; i < NUM_SPOT_LIGHTS; i++) {
    vec3 lv = spotLights[i].position - p;
    float ld = length(lv);
    L.direction = lv / max(ld, 1e-4);
    float sa = getSpotAttenuation(spotLights[i].coneCos, spotLights[i].penumbraCos, dot(L.direction, spotLights[i].direction));
    L.color = spotLights[i].color * sa * getDistanceAttenuation(max(ld, 0.6), spotLights[i].distance, spotLights[i].decay);
    c = L.color * fxPhase(dot(-L.direction, viewDir), g);
    total += c; w = dot(c, vec3(0.3333)); domDir += L.direction * w;
  }
#endif
  // Particles are not shadowed, so unoccluded lights over-light them: compress and partly desaturate.
  float fxLum = dot(total, vec3(0.299, 0.587, 0.114));
  total = mix(vec3(fxLum), total, 0.55) / (1.0 + fxLum * 0.9);
  return total;
}
`;

export const FOG_FRAG = /* glsl */ `
float fxFog(float depth) {
#ifdef USE_FOG
  #ifdef FOG_EXP2
    return 1.0 - exp(-fogDensity * fogDensity * depth * depth);
  #else
    return smoothstep(fogNear, fogFar, depth);
  #endif
#else
  return 0.0;
#endif
}
`;

// ───────────────────────────────────────────── streaks (sparks, droplets, chips, motes)

const STREAK_VERT = /* glsl */ `
#include <common>
#include <lights_pars_begin>
${FX_LIGHT}
attribute vec4 a0; // world pos, half width
attribute vec4 a1; // world tail offset (pos - tail), alpha
attribute vec4 a2; // rgb, kind (0 emissive, 1.x lit opaque w/ spec x, 2 lit additive)
uniform float uPixelScale;
uniform float uMinPx;
varying vec3 vColor;
varying vec3 vSpec;
varying vec2 vCoord;
varying float vLen;
varying float vW;
varying float vAlpha;
varying float vKind;
varying float vDepth;
void main() {
  vec3 head = (modelViewMatrix * vec4(a0.xyz, 1.0)).xyz;
  vec3 tail = (modelViewMatrix * vec4(a0.xyz - a1.xyz, 1.0)).xyz;
  vec3 vd = normalize(head);
  vec3 axis = head - tail;
  vec3 axisP = axis - vd * dot(axis, vd);
  float len = length(axisP);
  vec3 dir = len > 1e-5 ? axisP / len : vec3(0.0, 1.0, 0.0);
  vec3 side = normalize(cross(vd, dir));
  float depth = max(-head.z, 0.01);
  float w = a0.w;
  float minW = uMinPx * depth / uPixelScale;
  float energy = 1.0;
  if (w < minW) { energy = w / minW; w = minW; }
  float along = position.y * 0.5 + 0.5;
  vec3 p = head + dir * ((along - 1.0) * len + position.y * w) + side * (position.x * w);
  vCoord = vec2(position.x * w, along * len + position.y * w);
  vLen = len; vW = w;
  vKind = a2.w;
  vAlpha = a1.w * energy;
  vDepth = depth;
  vSpec = vec3(0.0);
  if (a2.w < 0.5) {
    vColor = a2.rgb;
  } else {
    vec3 ld;
    bool mote = a2.w > 1.99;
    vec3 irr = fxLight(head, mote ? 0.15 : 0.0, ld) * RECIPROCAL_PI;
    if (mote) irr = max(irr - ambientLightColor * RECIPROCAL_PI * 0.85, vec3(0.0));
    // motes: tiny glinting specks — boost, and keep sub-pixel ones from vanishing entirely
    vColor = a2.rgb * irr * (mote ? 3.5 : 1.0);
    if (mote) vAlpha = a1.w * sqrt(energy);
    vSpec = irr * fract(a2.w) * 0.7;
  }
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;

const STREAK_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${FOG_FRAG}
varying vec3 vColor;
varying vec3 vSpec;
varying vec2 vCoord;
varying float vLen;
varying float vW;
varying float vAlpha;
varying float vKind;
varying float vDepth;
void main() {
  float dx = max(0.0, max(-vCoord.y, vCoord.y - vLen));
  float d = length(vec2(vCoord.x, dx)) / vW;
  if (d > 1.0) discard;
  float m = exp(-d * d * 3.5) * (1.0 - smoothstep(0.75, 1.0, d));
  float f = fxFog(vDepth);
  vec3 rgb; float a;
  if (vKind < 0.5) {
    // emissive: hot core towards white
    float core = exp(-d * d * 14.0);
    rgb = (vColor * m + vec3(dot(vColor, vec3(0.3, 0.5, 0.2))) * core * 0.35) * vAlpha * (1.0 - f);
    a = 0.0;
  } else if (vKind < 1.99) {
    float cov = smoothstep(1.0, 0.55, d) * vAlpha;
    float glint = pow(max(0.0, 1.0 - d * 1.6), 6.0);
    rgb = (vColor + vSpec * glint) * cov;
    rgb = mix(rgb, fogColor * cov, f);
    a = cov;
  } else {
    rgb = vColor * m * vAlpha * (1.0 - f);
    a = 0.0;
  }
  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ───────────────────────────────────────────── puffs (smoke, steam, dust, fire, rings, glows)

const PUFF_VERT = /* glsl */ `
#include <common>
#include <lights_pars_begin>
${FX_LIGHT}
attribute vec4 a0; // pos, half size
attribute vec4 a1; // rotation, alpha, emission, shape
attribute vec4 a2; // rgb, atlas tile
attribute vec4 a3; // erosion, phase g, stretch, 0
varying vec2 vUv;
varying vec2 vTile;
varying vec4 vP;   // alpha, emission, shape, erosion
varying vec3 vColor;
varying vec3 vLight;
varying vec3 vLDir;
varying float vDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(a0.xyz, 1.0);
  float s = sin(a1.x), c = cos(a1.x);
  vec2 cr = position.xy;
  vec2 rc = vec2(c * cr.x - s * cr.y, s * cr.x + c * cr.y);
  vec3 p = mv.xyz + vec3(rc * a0.w, 0.0);
  float depth = max(-mv.z, 0.01);
  vDepth = depth;
  vUv = position.xy * 0.5 + 0.5;
  vTile = vec2(mod(a2.w, 2.0), floor(a2.w * 0.5 + 0.01)) * 0.5;
  vColor = a2.rgb;
  float nearFade = smoothstep(0.08, 0.08 + a0.w * 1.2, depth - a0.w * 0.25);
  vP = vec4(a1.y * nearFade, a1.z, a1.w, a3.x);
  vLight = vec3(0.0); vLDir = vec3(0.0);
  if (a1.w < 0.5) {
    vec3 ld;
    // sample lighting slightly in front of the quad so a light inside the puff still reads
    vLight = fxLight(p + vec3(0.0, 0.0, a0.w * 0.3), a3.y, ld) * RECIPROCAL_PI;
    float l = length(ld);
    if (l > 1e-5) {
      ld /= l;
      vLDir = vec3(c * ld.x + s * ld.y, -s * ld.x + c * ld.y, ld.z);
    }
  }
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;

const PUFF_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${FOG_FRAG}
uniform sampler2D uTex;
varying vec2 vUv;
varying vec2 vTile;
varying vec4 vP;
varying vec3 vColor;
varying vec3 vLight;
varying vec3 vLDir;
varying float vDepth;
vec3 fireRamp(float h) {
  return vec3(2.6 * h, 1.5 * h * h, 0.55 * h * h * h);
}
void main() {
  vec2 cc = vUv * 2.0 - 1.0;
  float r2 = dot(cc, cc);
  float f = fxFog(vDepth);
  vec3 rgb; float a = 0.0;
  if (vP.z < 0.5) {
    vec4 t = texture2D(uTex, vTile + clamp(vUv, 0.004, 0.996) * 0.5);
    float er = vP.w;
    float dens = clamp((t.r - er) / max(1.0 - er, 0.05), 0.0, 1.0);
    if (dens <= 0.002) discard;
    vec2 g = (t.gb - 0.5) * 2.0;
    vec3 n = normalize(vec3(-g * 2.2 + cc * 0.7, 0.75));
    float hasDir = step(1e-4, dot(vLDir, vLDir));
    float ndl = dot(n, vLDir) * 0.5 + 0.5;
    float shade = mix(1.0, 0.35 + ndl * 1.3, hasDir * 0.8);
    float thin = 1.15 - 0.35 * dens;
    vec3 lit = vColor * vLight * shade * thin;
    a = dens * vP.x;
    rgb = lit * a;
    if (vP.y > 0.001) {
      float heat = vP.y * (0.25 + dens) * (0.6 + 0.8 * t.a);
      rgb += fireRamp(heat) * dens * min(vP.x * 1.6, 1.0);
    }
    rgb = mix(rgb, fogColor * a, f);
  } else if (vP.z < 1.5) {
    // shockwave ring
    float r = sqrt(r2);
    float ring = exp(-pow((r - 0.82) / 0.07, 2.0)) + 0.25 * exp(-pow((r - 0.72) / 0.2, 2.0));
    rgb = vColor * vP.y * ring * vP.x * (1.0 - f);
  } else {
    // soft glow / flare
    float gl = exp(-r2 * 5.0) + 0.35 * exp(-r2 * 22.0) * 3.0;
    gl *= 1.0 - smoothstep(0.7, 1.0, r2);
    rgb = vColor * vP.y * gl * vP.x * (1.0 - f);
  }
  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ───────────────────────────────────────────── electric arcs

const ARC_VERT = /* glsl */ `
attribute vec3 tangent3;
attribute vec2 sideI; // side (-1/1), intensity
uniform float uWidth;
uniform float uPixelScale;
varying float vSide;
varying float vI;
varying float vCore;
varying float vDepth;
void main() {
  vec3 p = (modelViewMatrix * vec4(position, 1.0)).xyz;
  vec3 t = normalize((modelViewMatrix * vec4(tangent3, 0.0)).xyz);
  vec3 vd = normalize(p);
  vec3 side = cross(vd, t);
  float l = length(side);
  side = l > 1e-4 ? side / l : vec3(1.0, 0.0, 0.0);
  float depth = max(-p.z, 0.01);
  float px = depth / uPixelScale;
  float w = max(uWidth * (0.4 + 0.6 * sideI.y), px * 10.0);
  float core = max(0.005, px * 1.1) * (0.6 + 0.4 * sideI.y);
  vCore = core / w;
  p += side * sideI.x * w;
  vSide = sideI.x; vI = sideI.y; vDepth = depth;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;

const ARC_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${FOG_FRAG}
uniform vec3 uCore;
uniform vec3 uGlow;
varying float vSide;
varying float vI;
varying float vCore;
varying float vDepth;
void main() {
  float x = vSide;
  float c = x / vCore;
  float core = exp(-c * c * 1.2);
  float glow = exp(-x * x * 7.0) * 0.8 + exp(-x * x * 40.0) * 0.6;
  glow *= 1.0 - smoothstep(0.85, 1.0, abs(x));
  vec3 rgb = (uCore * core + uGlow * glow) * vI * (1.0 - fxFog(vDepth));
  gl_FragColor = vec4(rgb, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function premultBlend(m: THREE.ShaderMaterial) {
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.premultipliedAlpha = true;
  m.side = THREE.DoubleSide;
  return m;
}

export function litUniforms(extra: Record<string, THREE.IUniform>) {
  const u = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
  // added after merge so textures are not cloned
  for (const k in extra) u[k] = extra[k];
  return u;
}

export function createStreakMaterial(pixelScale: THREE.IUniform<number>) {
  return premultBlend(new THREE.ShaderMaterial({
    name: 'fx_streaks',
    vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG,
    uniforms: litUniforms({ uPixelScale: pixelScale, uMinPx: { value: 1.3 } }),
    lights: true, fog: true,
  }));
}

export function createPuffMaterial(tex: THREE.Texture) {
  return premultBlend(new THREE.ShaderMaterial({
    name: 'fx_puffs',
    vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG,
    uniforms: litUniforms({ uTex: { value: tex } }),
    lights: true, fog: true,
  }));
}

export function createArcMaterial(pixelScale: THREE.IUniform<number>) {
  return premultBlend(new THREE.ShaderMaterial({
    name: 'fx_arcs',
    vertexShader: ARC_VERT, fragmentShader: ARC_FRAG,
    uniforms: litUniforms({
      uWidth: { value: 0.09 },
      uPixelScale: pixelScale,
      uCore: { value: new THREE.Vector3(6, 8, 11) },
      uGlow: { value: new THREE.Vector3(0.2, 0.6, 1.6) },
    }),
    fog: true,
  }));
}
