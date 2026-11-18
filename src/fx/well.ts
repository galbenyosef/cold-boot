/**
 * Stage 3d §8.6.1 (W6) — the moon pool's well: a horizontal "viewport" looking DOWN into 13.7 m of black water.
 *
 * Two draw calls, no extra pass, nothing here is a light:
 *   1. `surface` — a grid quad lying 12 mm over the well's water surface (the level's own opaque `water` quad: the
 *      dark gloss and the probe reflection). Additive (one / one): it adds the light that comes UP through the water.
 *      Per vertex it reads the real light pool at the surface (floods, high-bays, the flashlight — `fxLight`), so the
 *      water answers the lamps sweeping over it. Per fragment it follows the eye ray from the surface **down**:
 *      per-channel extinction (red dies first; green-black, `visibility` 3 m), the down-welling light decaying with
 *      depth with a slow caustic flicker, analytic in-scatter, the well walls (panel seams, a tide band, two faint
 *      ladders), the floor (the lock's inner iris door) and the tether (an analytic capsule from the surface to its
 *      gland). The sea gate's ring of amber lamps and up to six eye points carry their own (much weaker) fog term so
 *      they read through 13 m. A ray that does not cross the surface rectangle draws nothing (the 3b pane clip, here
 *      horizontal); a ray from below the surface draws nothing (the water is never reachable).
 *   2. `snow` — marine snow (≤ 300 points), sinking slowly in the well, lit by the down-welling light and the gate
 *      lamps, attenuated along its path to the surface. Each fleck is drawn at the depth of the point where the eye ray
 *      crosses the surface, so it is depth-tested against the coaming / guards / decks like the surface itself (the
 *      level's opaque water quad would hide it otherwise) — and clipped to the rectangle too.
 *
 * States: 'calm' / 'dark' (the gate lamps dim to 30 %, the ambient down-welling falls — after `lights_out6`).
 * `eyes(on, list)`: the `v6_well_eyes` points (cyan by default), each fading in / out over 0.6 s.
 * Quality: snow low 120 / medium 200 / high 300 (draw range — never recompiles).
 */
import * as THREE from 'three';
import type { Quality } from '../core/types';
import { FOG_FRAG, FX_LIGHT, litUniforms } from './shaders';
import { noiseTexture } from './viewport';

export type WellState = 'calm' | 'dark';

export interface WellEye {
  position: THREE.Vector3;
  /** Default cyan (0x5fe8ff). */
  color?: THREE.ColorRepresentation;
}

export interface WellOpts {
  /** The water volume: x/z = the opening, max.y = the surface, min.y = the floor (the lock's inner door). */
  box: THREE.Box3;
  /** The tether in the water: from its point at the surface to its gland on the floor. null = none. Default: none. */
  tether?: { top: THREE.Vector3; bottom: THREE.Vector3; radius?: number } | null;
  /** The sea gate's lamp ring on the floor (default: centred in the opening, radius 0.38 × the narrow side, 8 lamps). */
  gate?: { center?: THREE.Vector3; radius?: number; lamps?: number };
  /** Ladders on the walls: points (x, z) at the foot of each; the nearest wall carries it. */
  ladders?: readonly THREE.Vector3[];
  /** Visibility (m; 1/extinction of green). Default 3. */
  visibility?: number;
  /** Marine snow flecks (≤ 300; quality caps it). Default 300. */
  snow?: number;
  state?: WellState;
  /** Registry (D23). */
  id?: string;
  rooms?: readonly string[];
  seenFrom?: readonly string[];
}

export interface WellHandle {
  readonly state: WellState;
  setState(state: WellState, seconds?: number): void;
  /** `v6_well_eyes`: show (on) up to six eye points / hide them all (off; the list is kept). */
  eyes(on: boolean, list?: readonly WellEye[]): void;
  /** Root (surface + snow). */
  readonly object: THREE.Object3D;
  /** The surface rectangle (for the registry's aperture). */
  readonly surface: number;
  visible: boolean;
  remove(): void;
  update(dt: number, pixelScale: number, quality: Quality): void;
}

const EYE_MAX = 6;
const LAMP_MAX = 8;
const SNOW_MAX = 300;
const QSNOW: Record<Quality, number> = { low: 120, medium: 200, high: 300, ultra: 300 };
const LIFT = 0.012;

const COMMON = /* glsl */ `
uniform vec3 uMin;
uniform vec3 uMax;
uniform vec3 uSigma;
uniform float uTime;
uniform vec4 uLamp[${LAMP_MAX}];   // xyz, on
uniform float uGate;
uniform float uAmb;
uniform highp sampler3D tNoise;
float vnoise(vec3 p) { return texture(tNoise, p * 0.125).r; }
/** Caustic network on a horizontal plane: bright thin cells drifting (two octaves of folded noise). */
float caustic(vec2 xz, float h) {
  float t = uTime * 0.35;
  float a = vnoise(vec3(xz * 0.6, t));
  float b = vnoise(vec3(xz * 1.05 + 3.7, t * 1.3 + 5.0));
  float c = 1.0 - abs(a + b - 1.0);
  return mix(1.0, 0.8 + 0.6 * pow(c, 5.0), exp(-h * 0.3));
}
/** Amber light of the gate's lamps arriving at p (through the water), with normal n (n = 0: omni). */
vec3 lampsAt(vec3 p, vec3 n, bool omni) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${LAMP_MAX}; i++) {
    if (uLamp[i].w <= 0.0) continue;
    vec3 lv = uLamp[i].xyz - p;
    float d = length(lv);
    float ndl = omni ? 1.0 : max(dot(n, lv / max(d, 1e-3)), 0.0) * 0.85 + 0.15;
    sum += exp(-uSigma * d * 0.8) * ndl / (1.0 + d * d * 0.5);
  }
  return sum * vec3(1.0, 0.55, 0.16) * 0.12 * uGate;
}
`;

const SURF_VERT = /* glsl */ `
#include <common>
#include <lights_pars_begin>
${FX_LIGHT}
varying vec3 vW;
varying vec3 vLight;
varying float vDepth;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vec3 ld;
  // irradiance at the surface (the lamps over the water); a little forward-scattering bias
  vLight = fxLight(mv.xyz, 0.2, ld) * RECIPROCAL_PI;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const SURF_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${FOG_FRAG}
${COMMON}
varying vec3 vW;
varying vec3 vLight;
varying float vDepth;
uniform vec3 uTetA;
uniform vec3 uTetB;
uniform float uTetR;
uniform float uTetOn;
uniform vec4 uLadder[2];      // x, z, wall axis (0: x wall, 1: z wall), on
uniform vec3 uGateC;
uniform float uGateR;
uniform vec4 uEye[${EYE_MAX}];     // xyz, strength
uniform vec3 uEyeCol[${EYE_MAX}];

float capsule(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float ra) {
  vec3 ba = pb - pa, oa = ro - pa;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  float a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - ra * ra * baba;
  float h = b * b - a * c;
  if (h >= 0.0) {
    float t = (-b - sqrt(h)) / a;
    float y = baoa + t * bard;
    if (y > 0.0 && y < baba) return t;
    vec3 oc = (y <= 0.0) ? oa : ro - pb;
    b = dot(rd, oc); c = dot(oc, oc) - ra * ra; h = b * b - c;
    if (h > 0.0) return -b - sqrt(h);
  }
  return -1.0;
}
vec2 rayPoint(vec3 ro, vec3 rd, vec3 p, float tMax) {
  float t = clamp(dot(p - ro, rd), 0.0, tMax);
  return vec2(length(ro + rd * t - p), t);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vW - ro);
  if (rd.y > -1e-3 || ro.y < uMax.y) discard;              // only from above, only looking down
  float t0 = (uMax.y - ro.y) / rd.y;
  vec3 o = ro + rd * t0;                                    // on the water surface
  // the pane clip (horizontal): a ray that does not cross the opening draws nothing (3 cm slack)
  if (o.x < uMin.x - 0.03 || o.x > uMax.x + 0.03 || o.z < uMin.z - 0.03 || o.z > uMax.z + 0.03) discard;
  o.xz = clamp(o.xz, uMin.xz + 1e-3, uMax.xz - 1e-3);

  // ── where the ray leaves the water: a wall or the floor
  float tx = abs(rd.x) > 1e-5 ? ((rd.x > 0.0 ? uMax.x : uMin.x) - o.x) / rd.x : 1e4;
  float tz = abs(rd.z) > 1e-5 ? ((rd.z > 0.0 ? uMax.z : uMin.z) - o.z) / rd.z : 1e4;
  float ty = (uMin.y - o.y) / rd.y;
  float tEnd = min(min(tx, tz), ty);
  vec3 n = tEnd == ty ? vec3(0.0, 1.0, 0.0) : tEnd == tx ? vec3(-sign(rd.x), 0.0, 0.0) : vec3(0.0, 0.0, -sign(rd.z));
  float tT = -1.0;
  if (uTetOn > 0.5) {
    tT = capsule(o, rd, uTetA, uTetB, uTetR);
    if (tT > 0.0 && tT < tEnd) { tEnd = tT; vec3 ba = uTetB - uTetA; vec3 pe = o + rd * tT; float y = clamp(dot(pe - uTetA, ba) / dot(ba, ba), 0.0, 1.0); n = normalize(pe - (uTetA + ba * y)); }
    else tT = -1.0;
  }
  vec3 pe = o + rd * tEnd;
  float hEnd = uMax.y - pe.y;

  // ── the light coming down through the surface (the lamps over the water + a cold ambient floor), decaying with depth
  vec3 E0 = vLight * 0.75 + vec3(0.006, 0.014, 0.016) * uAmb;
  vec3 kd = uSigma * 0.85;
  float cs = caustic(o.xz, 0.5);
  // in-scatter along the ray (analytic: E(h) = E0 exp(-kd h), h = -rd.y t); a grey scattering coefficient against the
  // per-channel extinction tints it the water's green-black (red gone first)
  vec3 k = uSigma + kd * (-rd.y);
  vec3 scat = E0 * cs * 0.016 * (1.0 - exp(-k * tEnd)) / k;
  // the gate lamps' glow in the water near them (soft, wide)
  vec3 T = exp(-uSigma * tEnd);
  vec3 col = scat;

  // ── the surface the ray ends on
  vec3 Ed = E0 * exp(-kd * hEnd) * caustic(pe.xz + pe.y * 0.15, hEnd);
  float alb;
  vec3 tint = vec3(1.0);
  if (tT > 0.0) {
    // the tether: dark armoured rope, a slow helix of strands, sheen on the lit side
    float along = dot(pe - uTetA, normalize(uTetB - uTetA));
    float strand = 0.5 + 0.5 * sin(along * 22.0 + atan(n.x, n.z) * 6.0);
    alb = 0.05 + 0.04 * strand;
    col += T * alb * (Ed * (0.45 + 0.55 * max(n.y, 0.0) + 0.3) + lampsAt(pe, n, false));
  } else if (n.y > 0.5) {
    // the floor: the lock's inner door — an iris of radial blades in a heavy ring, the gland near its north edge
    vec2 q = pe.xz - uGateC.xz;
    float r = length(q);
    float ang = atan(q.y, q.x);
    float blade = smoothstep(0.03, 0.0, abs(fract(ang * 1.2732 + r * 0.18) - 0.5) - 0.47);  // 8 blades, curved seams
    float ring = smoothstep(0.12, 0.0, abs(r - uGateR * 1.18)) + 0.5 * smoothstep(0.05, 0.0, abs(r - uGateR * 0.78));
    alb = (r < uGateR * 1.18 ? 0.07 - 0.04 * blade : 0.045) + 0.05 * ring;
    col += T * alb * (Ed + lampsAt(pe + n * 0.05, n, false));
  } else {
    // a wall: welded plate, horizontal seams every 1.5 m, a rust tide band just under the surface, faint ladders
    float seam = smoothstep(0.03, 0.0, abs(fract(pe.y / 1.5) - 0.5) - 0.47);
    float vert = n.x != 0.0 ? pe.z : pe.x;
    float stiff = smoothstep(0.04, 0.0, abs(fract(vert / 2.0) - 0.5) - 0.46);
    alb = 0.05 - 0.02 * seam + 0.015 * stiff + 0.02 * (vnoise(pe * 1.7) - 0.5);
    float tide = smoothstep(0.9, 0.0, hEnd) * smoothstep(0.0, 0.08, hEnd);
    tint = mix(vec3(1.0), vec3(1.4, 0.95, 0.6), tide);
    for (int i = 0; i < 2; i++) {
      vec4 L = uLadder[i];
      if (L.w < 0.5) continue;
      bool onWall = (L.z < 0.5) ? (n.x != 0.0 && abs(pe.x - L.x) < 0.6) : (n.z != 0.0 && abs(pe.z - L.y) < 0.6);
      if (!onWall) continue;
      float u = (L.z < 0.5) ? pe.z - L.y : pe.x - L.x;
      float rails = smoothstep(0.03, 0.0, abs(abs(u) - 0.22));
      float rung = step(abs(u), 0.22) * smoothstep(0.025, 0.0, abs(fract(pe.y / 0.3) - 0.5) - 0.46);
      alb += 0.12 * max(rails, rung);
    }
    col += T * alb * tint * (Ed * 0.6 + lampsAt(pe + n * 0.05, n, false));
  }

  // ── the gate's lamps: cores and halos with their own (weak) fog — the amber ring reads through 13 m
  for (int i = 0; i < ${LAMP_MAX}; i++) {
    if (uLamp[i].w <= 0.0) continue;
    vec3 mp = uLamp[i].xyz;
    vec2 rp = rayPoint(o, rd, mp, tEnd + 1.0);
    float dist = length(mp - o);
    float occ = (tEnd < dist - 0.4) ? 0.1 : 1.0;
    // (the lamps' own fog keeps their amber: a grey term with a little of the water's tint)
    vec3 att = exp(-(uSigma.g * 0.2 + uSigma * 0.04) * dist);
    float core = 1.0 / (1.0 + pow(rp.x / 0.05, 2.0));
    float halo = exp(-rp.x / (0.25 + dist * 0.05));
    float glow = exp(-rp.x / 1.6) * exp(-uSigma.g * dist * 0.35);
    col += vec3(1.0, 0.5, 0.12) * uGate * uLamp[i].w * (att * occ * (core * 9.0 + halo * 1.1) + glow * 0.12);
  }
  // ── eye points (v6_well_eyes): small, cold, a slow breathing
  for (int i = 0; i < ${EYE_MAX}; i++) {
    float s = uEye[i].w;
    if (s <= 0.0) continue;
    vec3 mp = uEye[i].xyz;
    vec2 rp = rayPoint(o, rd, mp, tEnd + 1.0);
    float dist = length(mp - o);
    float occ = (tEnd < dist - 0.2) ? 0.05 : 1.0;
    vec3 att = exp(-uSigma * 0.4 * dist);
    float core = 1.0 / (1.0 + pow(rp.x / 0.025, 2.0));
    float halo = exp(-rp.x / (0.1 + dist * 0.025));
    float br = 0.8 + 0.2 * sin(uTime * 1.3 + float(i) * 2.1);
    col += uEyeCol[i] * s * br * att * occ * (core * 5.0 + halo * 0.6);
  }

  // what the surface lets through (Schlick, n = 1.33): little at grazing angles, the opaque quad reflects the rest
  float cosI = clamp(-rd.y, 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
  col *= 1.0 - F;
  col *= 1.0 - fxFog(vDepth);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const SNOW_VERT = /* glsl */ `
#include <common>
#include <lights_pars_begin>
${FX_LIGHT}
${COMMON}
attribute vec4 aSeed;
uniform float uPx;
varying vec3 vCol;
void main() {
  vec3 size = uMax - uMin;
  float sink = 0.015 + 0.03 * fract(aSeed.w * 7.13);
  vec3 wob = 0.1 * vec3(sin(uTime * 0.29 + aSeed.w * 40.0), 0.0, sin(uTime * 0.21 + aSeed.x * 31.0));
  vec3 l = aSeed.xyz * size;
  l.y = mod(l.y - uTime * sink, size.y);
  l.xz = clamp(l.xz + wob.xz, vec2(0.05), size.xz - 0.05);
  vec3 P = uMin + l;
  vec3 C = cameraPosition;
  float h = uMax.y - P.y;
  // the eye ray to the fleck crosses the surface at X: drawn at X's depth (depth-tested like the surface), clipped there
  float tc = (C.y - (uMax.y + ${(LIFT + 0.006).toFixed(3)})) / max(C.y - P.y, 1e-4);
  vec3 X = C + (P - C) * tc;
  bool inside = C.y > uMax.y + 0.02 && X.x > uMin.x && X.x < uMax.x && X.z > uMin.z && X.z < uMax.z;
  vec4 mvX = viewMatrix * vec4(X, 1.0);
  gl_Position = projectionMatrix * mvX;
  if (!inside) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); return; }
  // light: the lamps over the water (read at the fleck's point on the surface) decaying down, plus the gate lamps
  vec4 mvS = viewMatrix * vec4(P.x, uMax.y, P.z, 1.0);
  vec3 ld;
  vec3 E = fxLight(mvS.xyz, 0.4, ld) * RECIPROCAL_PI * 1.4 + vec3(0.010, 0.022, 0.024) * uAmb;
  E = E * exp(-uSigma * 0.85 * h) * caustic(P.xz, h) + lampsAt(P, vec3(0.0), true) * 0.6;
  float path = length(P - X);                                // under water, to the eye
  float dist = length(P - C);
  float sz = mix(0.01, 0.035, pow(fract(aSeed.w * 13.7), 3.0));
  float px = sz * uPx / max(dist, 0.1);
  float pxc = max(px, 1.1);
  vec3 c = E * (0.5 + 0.5 * fract(aSeed.w * 5.3)) * exp(-uSigma * path) * 6.0;
  c *= min(px * px / (pxc * pxc), 1.0);
  // fade at the wrap (top and bottom)
  c *= smoothstep(0.0, 0.6, h) * smoothstep(0.0, 0.6, size.y - h);
  vCol = c;
  gl_PointSize = min(pxc, 6.0);
}
`;

const SNOW_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  gl_FragColor = vec4(vCol * exp(-r * 3.0), 0.0);
}
`;

const additive = (m: THREE.ShaderMaterial) => {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  return m;
};

interface Look { gate: number; amb: number }
const LOOKS: Record<WellState, Look> = { calm: { gate: 1, amb: 1 }, dark: { gate: 0.3, amb: 0.35 } };

export function createWell(o: WellOpts, parent: THREE.Object3D, quality: () => Quality): WellHandle {
  const box = o.box.clone();
  const surfY = box.max.y;
  const vis = o.visibility ?? 3;
  const sigma = new THREE.Vector3(2.3, 1.0, 1.35).multiplyScalar(1 / vis);
  const sx = box.max.x - box.min.x, sz = box.max.z - box.min.z;

  const lamps = Array.from({ length: LAMP_MAX }, () => new THREE.Vector4());
  const gc = o.gate?.center?.clone() ?? new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  const gr = o.gate?.radius ?? Math.min(sx, sz) * 0.38;
  const nl = Math.min(LAMP_MAX, o.gate?.lamps ?? 8);
  for (let i = 0; i < nl; i++) {
    const a = (i / nl) * Math.PI * 2 + Math.PI / nl;
    lamps[i].set(gc.x + Math.cos(a) * gr, box.min.y + 0.12, gc.z + Math.sin(a) * gr, 1);
  }
  const ladders = [new THREE.Vector4(), new THREE.Vector4()];
  (o.ladders ?? []).slice(0, 2).forEach((p, i) => {
    const dx = Math.min(Math.abs(p.x - box.min.x), Math.abs(p.x - box.max.x));
    const dz = Math.min(Math.abs(p.z - box.min.z), Math.abs(p.z - box.max.z));
    const xWall = dx <= dz;
    const wx = Math.abs(p.x - box.min.x) < Math.abs(p.x - box.max.x) ? box.min.x : box.max.x;
    const wz = Math.abs(p.z - box.min.z) < Math.abs(p.z - box.max.z) ? box.min.z : box.max.z;
    ladders[i].set(xWall ? wx : p.x, xWall ? p.z : wz, xWall ? 0 : 1, 1);
  });
  const tet = o.tether ?? null;
  const eyeU = Array.from({ length: EYE_MAX }, () => new THREE.Vector4());
  const eyeCol = Array.from({ length: EYE_MAX }, () => new THREE.Color(0x5fe8ff));
  const eyeOn = new Float32Array(EYE_MAX);   // target strength per eye
  const eyeCur = new Float32Array(EYE_MAX);

  const shared = {
    uMin: { value: box.min.clone() },
    uMax: { value: box.max.clone() },
    uSigma: { value: sigma },
    uTime: { value: 0 },
    uLamp: { value: lamps },
    uGate: { value: 1 },
    uAmb: { value: 1 },
    tNoise: { value: noiseTexture() },
  };
  const group = new THREE.Group();
  group.name = 'fx:well';
  group.userData.fxCenter = new THREE.Vector3((box.min.x + box.max.x) / 2, surfY, (box.min.z + box.max.z) / 2);

  // ── 1. the surface layer (a 1 m grid: the light pool is read per vertex)
  const geo = new THREE.PlaneGeometry(sx, sz, Math.max(1, Math.round(sx)), Math.max(1, Math.round(sz)));
  geo.rotateX(-Math.PI / 2);
  const surfMat = additive(new THREE.ShaderMaterial({
    name: 'fx:well',
    vertexShader: SURF_VERT,
    fragmentShader: SURF_FRAG,
    lights: true,
    fog: true,
    uniforms: litUniforms({
      ...shared,
      uTetA: { value: tet ? tet.top.clone().setY(Math.min(tet.top.y, surfY)) : new THREE.Vector3() },
      uTetB: { value: tet ? tet.bottom.clone() : new THREE.Vector3() },
      uTetR: { value: tet?.radius ?? 0.12 },
      uTetOn: { value: tet ? 1 : 0 },
      uLadder: { value: ladders },
      uGateC: { value: gc },
      uGateR: { value: gr },
      uEye: { value: eyeU },
      uEyeCol: { value: eyeCol },
    }),
  }));
  surfMat.polygonOffset = true;
  surfMat.polygonOffsetFactor = -1;
  surfMat.polygonOffsetUnits = -4;
  const surface = new THREE.Mesh(geo, surfMat);
  surface.name = 'fx:well:surface';
  surface.position.set((box.min.x + box.max.x) / 2, surfY + LIFT, (box.min.z + box.max.z) / 2);
  surface.renderOrder = 2;
  surface.castShadow = surface.receiveShadow = false;
  group.add(surface);

  // ── 2. marine snow
  const nSnow = Math.min(SNOW_MAX, o.snow ?? SNOW_MAX);
  const seeds = new Float32Array(SNOW_MAX * 4);
  let seed = 4111;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW_MAX * 3), 3));
  sgeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  sgeo.boundingSphere = new THREE.Sphere(box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3()).length() / 2 + 1);
  const snowMat = additive(new THREE.ShaderMaterial({
    name: 'fx:well:snow',
    vertexShader: SNOW_VERT,
    fragmentShader: SNOW_FRAG,
    lights: true,
    uniforms: litUniforms({ ...shared, uPx: { value: 600 } }),
  }));
  const snow = new THREE.Points(sgeo, snowMat);
  snow.name = 'fx:well:snow';
  snow.renderOrder = 3;
  group.add(snow);
  parent.add(group);

  // ── state
  let state: WellState = o.state ?? 'calm';
  const cur: Look = { ...LOOKS[state] };
  const from: Look = { ...cur };
  let tw = 1, twDur = 0, time = 0;

  const handle: WellHandle = {
    get state() { return state; },
    setState(s, seconds = 1.5) {
      state = s;
      Object.assign(from, cur);
      if (seconds <= 0) { tw = 1; Object.assign(cur, LOOKS[s]); } else { tw = 0; twDur = seconds; }
    },
    eyes(on, list) {
      if (list) {
        for (let i = 0; i < EYE_MAX; i++) {
          const e = list[i];
          if (!e) { eyeU[i].set(0, 0, 0, 0); eyeOn[i] = 0; eyeCur[i] = 0; continue; }
          eyeU[i].set(e.position.x, e.position.y, e.position.z, eyeCur[i]);
          eyeCol[i].set(e.color ?? 0x5fe8ff);
        }
        if (list.length > EYE_MAX) console.warn(`[fx.well] eyes: ${list.length} given, ${EYE_MAX} drawn`);
      }
      const n = list ? Math.min(list.length, EYE_MAX) : EYE_MAX;
      for (let i = 0; i < EYE_MAX; i++) eyeOn[i] = on && i < n && (list ? !!list[i] : eyeU[i].lengthSq() > 0) ? 1 : 0;
    },
    object: group,
    surface: surfY,
    get visible() { return group.visible; },
    set visible(v: boolean) { group.visible = v; },
    remove() {
      parent.remove(group);
      geo.dispose(); sgeo.dispose(); surfMat.dispose(); snowMat.dispose();
    },
    update(dt, pixelScale, q) {
      time += dt;
      shared.uTime.value = time % 3600;
      if (tw < 1) {
        tw = Math.min(1, tw + dt / Math.max(twDur, 1e-3));
        const k = tw * tw * (3 - 2 * tw);
        const T = LOOKS[state];
        cur.gate = from.gate + (T.gate - from.gate) * k;
        cur.amb = from.amb + (T.amb - from.amb) * k;
      }
      // the gate lamps losing power stutter on the way down
      let flick = 1;
      if (tw < 0.8 && state === 'dark') flick = Math.sin(time * 47.0) * Math.sin(time * 19.3 + 0.7) > 0.5 - tw * 0.5 ? 0.25 : 1;
      shared.uGate.value = cur.gate * flick;
      shared.uAmb.value = cur.amb;
      for (let i = 0; i < EYE_MAX; i++) {
        const d = eyeOn[i] - eyeCur[i];
        if (d !== 0) eyeCur[i] = Math.abs(d) < dt / 0.6 ? eyeOn[i] : eyeCur[i] + Math.sign(d) * dt / 0.6;
        eyeU[i].w = eyeCur[i];
      }
      snowMat.uniforms.uPx.value = pixelScale;
      sgeo.setDrawRange(0, Math.min(nSnow, QSNOW[q] ?? 200));
    },
  };
  handle.setState(state, 0);
  void quality;
  return handle;
}
