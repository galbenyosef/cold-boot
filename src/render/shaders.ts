import { LIGHT_BOX_EDGE } from './patch';
/** GLSL for the post chain. All passes use the fullscreen triangle from fullscreen.ts (varying vUv). */

const COMMON = /* glsl */ `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const DEPTH = /* glsl */ `
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
float viewZAt(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return uNear * uFar / (uFar - d * (uFar - uNear));
}
`;

// ───────────────────────────────────────────────────────────── ambient occlusion (half res)
// Scalable-ambient-obscurance style estimator with normals reconstructed from depth.
// Output: r = occlusion (1 = open), g = linear view depth in metres (for the bilateral blur / upsample).
export const AO_FRAG = /* glsl */ `
${COMMON}
${DEPTH}
varying vec2 vUv;
uniform vec2 uDepthTexel;
uniform vec2 uInvProj;     // 1/P00, 1/P11
uniform float uProjScale;  // P11 * 0.5 (world radius -> uv-height at z = 1)
uniform float uAspect;
uniform float uRadius;
uniform float uIntensity;

vec3 viewPos(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * uInvProj * z, -z); }

void main() {
  float z = viewZAt(vUv);
  if (z > uFar * 0.95) { gl_FragColor = vec4(1.0, z, 0.0, 1.0); return; }
  vec3 p = viewPos(vUv, z);

  vec2 dx = vec2(uDepthTexel.x, 0.0), dy = vec2(0.0, uDepthTexel.y);
  float zl = viewZAt(vUv - dx), zr = viewZAt(vUv + dx);
  float zb = viewZAt(vUv - dy), zt = viewZAt(vUv + dy);
  vec3 ddx = abs(zr - z) < abs(z - zl) ? viewPos(vUv + dx, zr) - p : p - viewPos(vUv - dx, zl);
  vec3 ddy = abs(zt - z) < abs(z - zb) ? viewPos(vUv + dy, zt) - p : p - viewPos(vUv - dy, zb);
  vec3 n = normalize(cross(ddx, ddy));

  // Shrink the world radius up close so the kernel never covers half the screen.
  float radius = uRadius * clamp(z * 0.9, 0.25, 1.0);
  float rUv = min(radius * uProjScale / z, 0.16);
  float phi = ign(gl_FragCoord.xy) * 6.2831853;
  float r2 = radius * radius;
  float sum = 0.0;
  for (int i = 0; i < AO_SAMPLES; i++) {
    float fi = (float(i) + 0.5) / float(AO_SAMPLES);
    float a = phi + float(i) * 2.3999632;
    vec2 suv = vUv + vec2(cos(a) / uAspect, sin(a)) * (sqrt(fi) * rUv);
    float sz = viewZAt(suv);
    vec3 v = viewPos(suv, sz) - p;
    float vv = dot(v, v);
    float vn = dot(v, n);
    float f = max(r2 - vv, 0.0) / r2;
    sum += f * f * f * max((vn - 0.012 * z - 0.006) / (vv + 0.0008), 0.0);
  }
  float ao = clamp(1.0 - uIntensity * sum * radius / float(AO_SAMPLES), 0.0, 1.0);
  // Fade out with distance (far geometry is fogged / dark anyway, and the kernel gets sub-pixel).
  ao = mix(ao, 1.0, smoothstep(30.0, 55.0, z));
  gl_FragColor = vec4(ao, z, 0.0, 1.0);
}`;

export const AO_BLUR_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tAO;
uniform vec2 uDir; // texel * direction
void main() {
  vec2 c = texture2D(tAO, vUv).rg;
  float z = c.g;
  float sum = c.r * 0.2270270;
  float wsum = 0.2270270;
  float tol = 1.0 / (0.02 * z + 0.015);
  for (int i = 1; i <= 4; i++) {
    float fi = float(i);
    float g = i == 1 ? 0.1945946 : (i == 2 ? 0.1216216 : (i == 3 ? 0.0540541 : 0.0162162));
    vec2 a = texture2D(tAO, vUv + uDir * fi).rg;
    vec2 b = texture2D(tAO, vUv - uDir * fi).rg;
    float wa = g * max(0.0, 1.0 - abs(a.g - z) * tol);
    float wb = g * max(0.0, 1.0 - abs(b.g - z) * tol);
    sum += a.r * wa + b.r * wb;
    wsum += wa + wb;
  }
  gl_FragColor = vec4(sum / wsum, z, 0.0, 1.0);
}`;

// ───────────────────────────────────────────────────────────── merge
// scene * AO + ground mist + volumetric shafts, then the first-person viewmodel composited on top.
export const MERGE_FRAG = /* glsl */ `
${COMMON}
${DEPTH}
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tViewmodel;
#ifdef USE_AO
uniform sampler2D tAO;
uniform vec2 uAoTexel;
uniform float uAoStrength;
#endif
#ifdef USE_VOL
uniform sampler2D tVol;
uniform vec2 uVolTexel;
#endif
uniform vec3 uCamPos;
uniform vec3 uCamRight;   // scaled by tan(fovx/2)
uniform vec3 uCamUp;      // scaled by tan(fovy/2)
uniform vec3 uCamForward;
uniform vec3 uMistColor;
uniform float uMistDensity;
uniform float uMistFalloff;
uniform float uMistBase;

void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  float z = viewZAt(vUv);

  #ifdef USE_AO
  {
    float ao = 0.0, w = 0.0;
    float tol = 1.0 / (0.03 * z + 0.02);
    for (int i = 0; i < 4; i++) {
      vec2 o = vec2(i == 0 || i == 2 ? -0.5 : 0.5, i < 2 ? -0.5 : 0.5);
      vec2 s = texture2D(tAO, vUv + o * uAoTexel).rg;
      float wi = max(0.0, 1.0 - abs(s.g - z) * tol) + 0.002;
      ao += s.r * wi; w += wi;
    }
    ao /= w;
    // Keep emissive / strongly lit pixels from being dirtied.
    float lum = dot(col, LUMA);
    ao = mix(ao, 1.0, smoothstep(0.8, 5.0, lum));
    ao = mix(1.0, ao, uAoStrength);
    // Slight colour bleed so creases go cold-dark rather than grey.
    col *= mix(vec3(ao), vec3(1.0), vec3(0.0, 0.03, 0.06) * (1.0 - ao));
  }
  #endif

  // Low exponential height mist hugging the floor (analytic integral along the view ray).
  if (uMistDensity > 0.0) {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec3 rd = uCamForward + ndc.x * uCamRight + ndc.y * uCamUp; // forward component = 1
    float t = min(z, 80.0);
    float ry = rd.y * uMistFalloff;
    float h0 = exp(-uMistFalloff * max(uCamPos.y - uMistBase, -4.0));
    float integral = abs(ry) > 1e-4 ? (1.0 - exp(-ry * t)) / ry : t;
    float fog = 1.0 - exp(-uMistDensity * h0 * integral * length(rd));
    col = mix(col, uMistColor, clamp(fog, 0.0, 1.0));
  }

  #ifdef USE_VOL
  {
    // 5-tap tent to hide the half-res jitter noise of the shafts.
    vec3 v = texture2D(tVol, vUv).rgb * 0.4;
    v += texture2D(tVol, vUv + vec2(uVolTexel.x, uVolTexel.y) * 0.9).rgb * 0.15;
    v += texture2D(tVol, vUv + vec2(-uVolTexel.x, uVolTexel.y) * 0.9).rgb * 0.15;
    v += texture2D(tVol, vUv + vec2(uVolTexel.x, -uVolTexel.y) * 0.9).rgb * 0.15;
    v += texture2D(tVol, vUv - vec2(uVolTexel.x, uVolTexel.y) * 0.9).rgb * 0.15;
    col += v;
  }
  #endif

  vec4 vm = texture2D(tViewmodel, vUv);
  col = col * (1.0 - clamp(vm.a, 0.0, 1.0)) + vm.rgb;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

// ───────────────────────────────────────────────────────────── bloom
export const BLOOM_DOWN_FRAG = /* glsl */ `
${COMMON}
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;     // source texel
uniform float uThreshold;
uniform float uKnee;
uniform float uClamp;

vec3 prefilter(vec3 c) {
  c = min(c, vec3(uClamp));
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}
float karis(vec3 c) { return 1.0 / (1.0 + dot(c, LUMA)); }

void main() {
  vec2 t = uTexel;
  vec3 a = texture2D(tSrc, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(tSrc, vUv).rgb;
  vec3 f = texture2D(tSrc, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(tSrc, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(tSrc, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture2D(tSrc, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture2D(tSrc, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(tSrc, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(tSrc, vUv + t * vec2(1.0, -1.0)).rgb;
  #ifdef FIRST
    // Partial Karis average over the 5 boxes kills fireflies from tiny hot specular pixels.
    vec3 g0 = prefilter((j + k + l + m) * 0.25);
    vec3 g1 = prefilter((a + b + d + e) * 0.25);
    vec3 g2 = prefilter((b + c + e + f) * 0.25);
    vec3 g3 = prefilter((d + e + g + h) * 0.25);
    vec3 g4 = prefilter((e + f + h + i) * 0.25);
    float w0 = 0.5 * karis(g0), w1 = 0.125 * karis(g1), w2 = 0.125 * karis(g2), w3 = 0.125 * karis(g3), w4 = 0.125 * karis(g4);
    vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  #else
    vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  #endif
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

export const BLOOM_UP_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;   // source (smaller) texel
uniform float uRadius;
uniform float uWeight;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += (texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb + texture2D(tSrc, vUv - vec2(t.x, 0.0)).rgb
      + texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb + texture2D(tSrc, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  c += texture2D(tSrc, vUv + t).rgb + texture2D(tSrc, vUv - t).rgb
     + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb;
  gl_FragColor = vec4(c * (uWeight / 16.0), 1.0);
}`;

// ───────────────────────────────────────────────────────────── composite (HDR -> display)
export const COMPOSITE_FRAG = /* glsl */ `
${COMMON}
varying vec2 vUv;
uniform sampler2D tHdr;
uniform sampler2D tBloom;
uniform sampler2D tDirt;
uniform float uExposure;
uniform sampler2D tAdapt;
uniform float uBloom;
uniform float uDirt;
uniform float uAberration;
uniform float uVignette;
uniform float uAspect;
uniform float uDamage;
uniform float uLowHealth;
uniform float uPulse;
uniform float uSaturation;

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
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 1e-6), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 q = vUv - 0.5;
  float r2 = dot(q, q);
  // Radial chromatic aberration: zero at the centre, growing with the cube of the radius.
  vec2 ca = q * r2 * uAberration;
  vec3 hdr;
  hdr.r = texture2D(tHdr, vUv - ca).r;
  hdr.g = texture2D(tHdr, vUv).g;
  hdr.b = texture2D(tHdr, vUv + ca).b;

  vec3 bloom = texture2D(tBloom, vUv).rgb;
  vec3 dirt = texture2D(tDirt, vUv).rgb;
  hdr += bloom * (uBloom + dirt * uDirt);

  vec3 c = aces(hdr * (uExposure * texture2D(tAdapt, vec2(0.5)).r));

  // ── grade: cold teal shadows, slightly warm highlights, gentle toe.
  float l = dot(c, LUMA);
  vec3 shadowTint = vec3(0.80, 1.00, 1.13);
  vec3 highTint = vec3(1.05, 1.00, 0.94);
  c *= mix(shadowTint, highTint, smoothstep(0.02, 0.55, l));
  l = dot(c, LUMA);
  c = mix(vec3(l), c, uSaturation);
  // Toe: crush the bottom end smoothly (x^2/(x+k)) — deep but never clipped.
  c = c * c / (c + 0.0035);

  // ── low health: drain colour, pulsing dark tunnel.
  if (uLowHealth > 0.0) {
    float lh = dot(c, LUMA);
    c = mix(c, vec3(lh) * vec3(1.06, 0.93, 0.90), uLowHealth * 0.8);
    float tunnel = smoothstep(0.12, 0.62, r2 * 1.9) * uLowHealth * (0.62 + 0.38 * uPulse);
    c *= 1.0 - 0.9 * tunnel;
    c += vec3(0.10, 0.0, 0.0) * tunnel * uPulse;
  }

  // ── vignette
  vec2 vq = q * vec2(1.0, mix(1.0, 1.0 / uAspect, 0.35) * 1.25);
  float vig = 1.0 - uVignette * smoothstep(0.08, 0.75, dot(vq, vq) * 1.7);
  c *= vig;

  // ── damage: red rim pressing in from every edge + brief overall flush.
  if (uDamage > 0.0) {
    float d = clamp(uDamage, 0.0, 1.0);
    vec2 e = abs(q) * 2.0;                                   // 0 centre .. 1 edge, per axis
    float edge = pow(pow(e.x, 5.0) + pow(e.y, 5.0), 0.2);    // rounded-rectangle distance, hugs the frame
    float rim = smoothstep(0.86 - 0.42 * d, 1.12, edge + r2 * 0.25);
    rim *= rim;
    vec3 red = vec3(0.36, 0.004, 0.0) + c * vec3(0.9, 0.12, 0.10);
    c = mix(c, red, rim * (0.3 + 0.55 * d));
    c = mix(c, c * vec3(1.22, 0.74, 0.72) + vec3(0.025, 0.0, 0.0), d * 0.4);
  }

  c = toSrgb(clamp(c, 0.0, 1.0));
  gl_FragColor = vec4(c, dot(c, LUMA));
}`;

// ───────────────────────────────────────────────────────────── final (display space): glitch, FXAA, grain, fade
export const FINAL_FRAG = /* glsl */ `
${COMMON}
varying vec2 vUv;
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uTime;
uniform float uGlitch;
uniform float uGlitchSeed;
uniform float uFade;
uniform float uGrain;

#ifdef USE_FXAA
vec3 fxaa(vec2 uv) {
  vec4 m4 = texture2D(tColor, uv);
  float lM = m4.a;
  float lNW = texture2D(tColor, uv + vec2(-1.0, -1.0) * uTexel).a;
  float lNE = texture2D(tColor, uv + vec2(1.0, -1.0) * uTexel).a;
  float lSW = texture2D(tColor, uv + vec2(-1.0, 1.0) * uTexel).a;
  float lSE = texture2D(tColor, uv + vec2(1.0, 1.0) * uTexel).a;
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.02, lMax * 0.09)) return m4.rgb;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float dirReduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcp, vec2(-6.0), vec2(6.0)) * uTexel;
  vec4 a = 0.5 * (texture2D(tColor, uv + dir * (1.0 / 3.0 - 0.5)) + texture2D(tColor, uv + dir * (2.0 / 3.0 - 0.5)));
  vec4 b = a * 0.5 + 0.25 * (texture2D(tColor, uv + dir * -0.5) + texture2D(tColor, uv + dir * 0.5));
  return (b.a < lMin || b.a > lMax) ? a.rgb : b.rgb;
}
#else
vec3 fxaa(vec2 uv) { return texture2D(tColor, uv).rgb; }
#endif

void main() {
  vec2 uv = vUv;
  vec3 c;
  if (uGlitch > 0.002) {
    float g = clamp(uGlitch, 0.0, 1.5);
    float t = floor(uTime * 22.0) + uGlitchSeed;
    // Horizontal tearing bands of varying height.
    float bands = mix(6.0, 46.0, hash11(t * 1.31));
    float band = floor(uv.y * bands);
    float hb = hash12(vec2(band, t));
    float tear = step(1.0 - g * 0.5, hb);
    uv.x += tear * (hash12(vec2(band, t + 3.7)) - 0.5) * 0.22 * g;
    // Block displacement (macroblock corruption).
    vec2 blk = floor(vUv * vec2(14.0, 8.0));
    float hk = hash12(blk + t * 1.7);
    float blkOn = step(1.0 - g * 0.22, hk);
    uv += blkOn * (vec2(hash12(blk + 5.1 + t), hash12(blk + 9.3 + t)) - 0.5) * vec2(0.16, 0.07) * g;
    // Per-scanline jitter.
    uv.x += (hash12(vec2(floor(vUv.y / uTexel.y), t)) - 0.5) * 0.006 * g;
    vec2 split = vec2(0.004 + 0.022 * hash11(t + 7.0), 0.0) * g * (1.0 + tear * 2.0);
    c = fxaa(uv);
    c.r = texture2D(tColor, uv + split).r;
    c.b = texture2D(tColor, uv - split).b;
    // Corrupted blocks: channel swap + posterise.
    float bad = step(1.0 - g * 0.07, hash12(blk * 1.3 + t * 0.61));
    c = mix(c, floor(c.gbr * 5.0 + 0.5) / 5.0 * vec3(0.6, 1.25, 1.3), bad);
    // Bright data-noise lines and scanline darkening.
    float line = step(1.0 - g * 0.035, hash12(vec2(floor(vUv.y * 180.0), t * 0.37)));
    c += line * vec3(0.20, 0.42, 0.45) * hash12(vec2(floor(vUv.x * 90.0), t));
    c *= 1.0 - 0.22 * min(g, 1.0) * step(0.5, fract(gl_FragCoord.y * 0.5));
  } else {
    c = fxaa(uv);
  }

  // Film grain, weighted towards shadows/mids; doubles as dither against banding in the dark.
  float l = dot(c, LUMA);
  vec3 n = vec3(hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 311.0),
                hash12(gl_FragCoord.xy * 1.07 + fract(uTime * 5.71) * 173.0 + 19.0),
                hash12(gl_FragCoord.xy * 0.93 + fract(uTime * 9.29) * 251.0 + 47.0)) - 0.5;
  float mono = n.x;
  float amp = uGrain * mix(0.5, 1.0, smoothstep(0.0, 0.2, l)) * (1.0 - 0.6 * smoothstep(0.45, 1.0, l));
  c += (mix(vec3(mono), n, 0.3)) * amp;

  c *= 1.0 - uFade;
  c += (n.y) * (1.0 / 255.0) * step(0.001, 1.0 - uFade);
  gl_FragColor = vec4(c, 1.0);
}`;

// ───────────────────────────────────────────────────────────── volumetric spot shaft (ray-marched cone)
export const VOL_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const VOL_FRAG = /* glsl */ `
precision highp sampler2DShadow;
${COMMON}
${DEPTH}
varying vec3 vWorld;
uniform vec2 uResolution;
uniform vec3 uCamForward;
uniform vec3 uApex;
uniform vec3 uAxis;
uniform float uCosOuter;
uniform float uCosInner;
uniform float uRange;
uniform vec3 uColor;
uniform float uTime;
uniform float uFrame;
uniform sampler2D tNoise;
uniform vec3 uBoxC;
uniform vec3 uBoxH;
#ifdef VOL_SHADOWS
uniform sampler2DShadow tShadow;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
#endif

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  vec2 suv = gl_FragCoord.xy / uResolution;
  float tScene = viewZAt(suv) / max(dot(rd, uCamForward), 1e-3);

  // Ray vs. infinite cone (apex uApex, axis uAxis, half-angle acos(uCosOuter)).
  vec3 co = ro - uApex;
  float dv = dot(rd, uAxis);
  float cv = dot(co, uAxis);
  float c2 = uCosOuter * uCosOuter;
  float A = dv * dv - c2;
  float B = 2.0 * (dv * cv - dot(rd, co) * c2);
  float C = cv * cv - dot(co, co) * c2;
  if (abs(A) < 1e-5) A = A < 0.0 ? -1e-5 : 1e-5;
  float disc = B * B - 4.0 * A * C;
  if (disc < 0.0) discard;
  float sq = sqrt(disc);
  float ta = (-B - sq) / (2.0 * A);
  float tb = (-B + sq) / (2.0 * A);
  if (ta > tb) { float tmp = ta; ta = tb; tb = tmp; }
  float t0, t1;
  if (A < 0.0) {
    // Ray crosses one nappe: inside between the roots — reject the mirror nappe.
    if (cv + dv * 0.5 * (ta + tb) < 0.0) discard;
    t0 = ta; t1 = tb;
  } else if (dv > 0.0) {
    t0 = tb; t1 = 1e6;
  } else {
    t0 = -1e6; t1 = ta;
  }
  // Clip to the light's range sphere, the camera, and the opaque scene.
  float bq = dot(co, rd);
  float hq = bq * bq - (dot(co, co) - uRange * uRange);
  if (hq < 0.0) discard;
  hq = sqrt(hq);
  t0 = max(max(t0, -bq - hq), 0.0);
  t1 = min(min(t1, -bq + hq), tScene);
  if (t1 <= t0) discard;

  float stepLen = (t1 - t0) / float(VOL_STEPS);
  float jitter = fract(ign(gl_FragCoord.xy) + uFrame * 0.61803399);
  float t = t0 + stepLen * jitter;
  float acc = 0.0;
  float invR2 = 1.0 / (uRange * uRange);
  for (int i = 0; i < VOL_STEPS; i++) {
    vec3 p = ro + rd * t;
    vec3 L = p - uApex;
    float d2 = dot(L, L);
    float d = sqrt(d2);
    float cosA = dot(L, uAxis) / max(d, 1e-4);
    float spot = smoothstep(uCosOuter, uCosInner, cosA);
    float w = clamp(1.0 - d2 * d2 * invR2 * invR2, 0.0, 1.0);
    float atten = w * w / (d2 + 0.25);
    // Slowly drifting dust: two octaves of tiling noise projected on different planes.
    float n1 = texture2D(tNoise, p.xz * 0.21 + vec2(p.y * 0.17 + uTime * 0.013, -uTime * 0.009)).r;
    float n2 = texture2D(tNoise, p.xy * 0.63 + vec2(uTime * 0.021, p.z * 0.41 - uTime * 0.03)).g;
    float density = 0.45 + 0.85 * n1 + 0.5 * n1 * n2;
    // Scattering right in front of the lens is suppressed: standing inside a beam should not fog the whole view.
    float s = spot * atten * density * smoothstep(0.15, 2.5, t);
    // LightDesc.bounds: the shaft ends where the light does.
    s *= 1.0 - smoothstep(0.0, ${LIGHT_BOX_EDGE.toFixed(3)}, length(max(abs(p - uBoxC) - uBoxH, 0.0)));
    #ifdef VOL_SHADOWS
    if (uShadowOn > 0.5 && s > 1e-5) {
      vec4 sc = uShadowMatrix * vec4(p, 1.0);
      sc.xyz /= sc.w;
      s *= texture(tShadow, vec3(sc.xy, sc.z - 0.0015));
    }
    #endif
    acc += s;
    t += stepLen;
  }
  // Mild forward scattering: brighter when looking towards the lamp.
  vec3 toApex = normalize(uApex - (ro + rd * (0.5 * (t0 + t1))));
  float mu = dot(rd, toApex);
  float phase = 0.55 + 0.75 * pow(max(mu, 0.0), 4.0) + 0.2 * mu * mu;
  // Fade the shaft out as the camera gets very close to its surface entry (avoids a hard plane when walking in).
  gl_FragColor = vec4(uColor * (acc * stepLen * phase), 1.0);
}`;

// ───────────────────────────────────────────────────────────── PMREM cross-blend (cube -> cube, one mip at a time)
export const ENV_BLEND_FRAG = /* glsl */ `
varying vec3 vWorldDirection;
uniform samplerCube tA;
uniform samplerCube tB;
uniform float uMix;
uniform float uLod;
void main() {
  vec3 a = textureLod(tA, vWorldDirection, uLod).rgb;
  vec3 b = textureLod(tB, vWorldDirection, uLod).rgb;
  gl_FragColor = vec4(mix(a, b, uMix), 1.0);
}`;

// ───────────────────────────────────────────────────────────── exposure adaptation (only ever stops DOWN)
export const METER_FRAG = /* glsl */ `
${COMMON}
varying vec2 vUv;
uniform sampler2D tHdr;
uniform vec2 uTexel; // meter texel
void main() {
  vec3 s = vec3(0.0);
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    vec2 o = (vec2(float(x), float(y)) + 0.5) / 4.0 - 0.5;
    s += min(texture2D(tHdr, vUv + o * uTexel).rgb, vec3(12.0));
  }
  gl_FragColor = vec4(dot(s / 16.0, LUMA), 0.0, 0.0, 1.0);
}`;

export const ADAPT_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tMeter;
uniform sampler2D tPrev;
uniform float uKey;
uniform float uMin;
uniform float uDt;
void main() {
  float sum = 0.0, wsum = 0.0;
  for (int y = 0; y < METER_H; y++) for (int x = 0; x < METER_W; x++) {
    vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(float(METER_W), float(METER_H));
    float w = 1.0 - 0.65 * smoothstep(0.15, 0.7, length(uv - 0.5));
    sum += texture2D(tMeter, uv).r * w;
    wsum += w;
  }
  float avg = sum / wsum;
  float target = clamp(pow(uKey / max(avg, 1e-4), 0.7), uMin, 1.0);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  float rate = target < prev ? 2.2 : 0.8;
  gl_FragColor = vec4(mix(prev, target, 1.0 - exp(-uDt * rate)), avg, 0.0, 1.0);
}`;
