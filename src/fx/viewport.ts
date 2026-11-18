/**
 * Stage 3a §8.7 — the sea viewport: black water behind a big glass pane, 2.1 km down.
 *
 * Two draw calls, no extra pass:
 *   1. `volume` — a back-faced truncated pyramid behind the glass (a screen-coverage proxy; the walls around the pane
 *      hide it). Its fragment shader works analytically per view ray from the glass plane outward: per-channel
 *      extinction (red dies first); in-scatter of the habitat's own hull floods through drifting particulate (4–10
 *      jittered samples per flood, only along the ray's segment inside each cone; density from a 32³ noise texture);
 *      the room's light spilling out through the glass; the seabed under the floods; the **trunk cable** (ray–capsule, armour strakes, marker lamps and the red beacon with their own fog
 *      term so the beacon reads at 18 m), up to three large slow shapes far out (soft ellipsoid bells with trailing
 *      threads and a faint bioluminescent rim — occasional, mostly seen as something blocking the haze) and a faint
 *      thick-glass sheen (edge tint, room reflection, slow caustic shimmer) at the pane.
 *   2. `snow` — marine snow `Points` (≤ 1 500, GPU-animated: sink + current + wobble, wrapped in a box), lit by the
 *      same flood function, the room spill and the murk; ≤ 40 of them are bioluminescent blinkers.
 *
 * States: 'calm' (floods on, warm room spill), 'cold' (floods dimmed and blue, cold spill, more blinks — the plant AI
 * has the habitat), 'dark' (floods off, only the beacon, blinks and what the room throws out). `setState(s, seconds)`.
 * Quality: march steps and particle count scale per `ctx.render.quality` (uniforms + draw range — never recompiles).
 * Nothing here is a light (no pool slot); the level's glass pane (`glass_clear`) supplies the probe reflection.
 *
 * Stage 3b (W7): every fragment of the volume and every snow fleck is drawn only along a view ray that crosses the pane
 * rectangle (3 cm slack) — the proxy seen through any other gap draws nothing (the 3a "glare / sparkles" class). A
 * viewport registers in the fx-volume registry (`id`, `rooms`, `seenFrom`; its pane is its only aperture). Wide panes
 * (width ≥ 20 m, a tube side) are capped: march steps low 4 / medium 6 / high 8, snow 300 / 450 / 600 per side.
 * `cheap: true` = the fallback without the march (a tinted gradient, seabed, cable lamps, snow).
 */
import * as THREE from 'three';
import type { Quality } from '../core/types';

export type ViewportState = 'calm' | 'cold' | 'dark';

export interface ViewportOpts {
  /** Centre of the glass pane (world). */
  position: THREE.Vector3;
  /** Pane normal pointing INTO the room (toward the viewer). Horizontal panes are not supported. */
  normal: THREE.Vector3;
  /** Pane size (m). */
  width: number;
  height: number;
  /** Depth of the coverage proxy behind the glass (default 18 m). Particles live within it. */
  depth?: number;
  /** Lateral growth of the proxy per metre of depth (default 1.6) — coverage for oblique views. Keep it clear of rooms. */
  spread?: number;
  /** Visibility in the floods (m): 1/extinction for green; red dies 1.7× faster, blue 0.8×. Default 4.5. */
  visibility?: number;
  /** Seabed world y (a plane sloping down away from the glass), or null for none. Default: pane bottom − 2.5. */
  seabed?: number | null;
  /**
   * The trunk cable (world space): a capsule `from` → `to` of `radius`, drawn by the volume shader (not lit geometry).
   * `beacon` = the red beacon on it (0.25 Hz); `markers` = extra small amber marker lamps along it. null = no cable.
   * Default: rises steeply from the seabed through a beacon 18 m out at pane-centre height, a little right.
   */
  cable?: { from: THREE.Vector3; to: THREE.Vector3; radius?: number; beacon?: THREE.Vector3; markers?: number } | null;
  /**
   * Hull floods (in the pane's frame: u right, v up, w outward from the glass, metres from the pane centre).
   * Max 3. Default: two above the pane corners, aimed out and down.
   */
  floods?: { at: [number, number, number]; dir: [number, number, number]; intensity?: number }[];
  /** Large slow shapes: max at once (default by quality: low 1, medium 2, high 3); 0 = never. */
  shapes?: number;
  /** Mean seconds between shape passes (default 70). */
  shapeGap?: number;
  /** Initial state (default 'calm'). */
  state?: ViewportState;
  /**
   * Stage 3b §8.6.4 / D21: registry id and the rooms it is drawn for (drawn only while one of them is drawn; probe
   * captures never see it). `seenFrom`: further rooms whose view points may see it through an opening (check:fxleak).
   */
  id?: string;
  rooms?: readonly string[];
  seenFrom?: readonly string[];
  /**
   * Stage 3b §8.6.4 fallback: no ray march — a depth/height gradient lit by the floods' colour, the seabed, the cable
   * and its lamps, the snow. A fraction of the cost; use it for the second of two facing tube panes.
   */
  cheap?: boolean;
  /**
   * Stage 3b integration (B8): draw the flood heads themselves — a small hot lens with its own fog halo at each flood's
   * position, so a beam in the water starts at a lamp you can see (not an unexplained glow). Brightness factor; 0 = off
   * (default, 3a's look unchanged).
   */
  heads?: number;
  /** B8: pull the floods' in-scatter this far (0 … 1) toward grey (the extinction makes it an electric blue). Default 0. */
  desat?: number;
  /** Stage 3d §8.6 (W6): the cable's beacon starts lit (default true); see `setBeacon`. */
  beacon?: boolean;
  /** Stage 3d §8.6 (W6): start with the cable already cut (a restore after the shear): the upper run gone, beacon off. */
  cableCut?: boolean;
}

export interface ViewportHandle {
  readonly state: ViewportState;
  /** Tween to a state over `seconds` (default 3). Floods going down flicker on the way. */
  setState(state: ViewportState, seconds?: number): void;
  /** Start a large-shape pass now (debug / story beat); `progress` 0…1 starts it part-way across. */
  summon(progress?: number): void;
  /**
   * Stage 3d §8.6 (W6, `v6_window`): ONE very large shape crosses the pane in `seconds` (default 4) — closer, bigger
   * and with a brighter bioluminescent rim than the ambient shapes (it reads in the 'dark' state), the snow swirling
   * in its wake. Runs on every quality (it ignores the `shapes` cap).
   */
  pass(seconds?: number): void;
  /** Stage 3d §8.6 (W6): the cable's red beacon on / off over `seconds` (default 0.4). */
  setBeacon(on: boolean, seconds?: number): void;
  /**
   * Stage 3d §8.6 (W6, the shear): the cable is cut — its upper run (above world y `at`, default the cable's foot +
   * 1.5 m) drifts up and out of the floods over `seconds` (default 6), the beacon and the marker lamps go out.
   * `seconds` 0 = the end state at once (a restore). Idempotent.
   */
  cutCable(seconds?: number, at?: number): void;
  readonly cableCut: boolean;
  /** Root object (two meshes). Hide it to stop drawing. */
  readonly object: THREE.Object3D;
  visible: boolean;
  remove(): void;
  /** Internal: per-frame update (called by fx.update). */
  update(dt: number, camera: THREE.PerspectiveCamera, pixelScale: number, quality: Quality): void;
}

// ───────────────────────────────────────────── state targets

interface Look {
  flood: number;
  floodCol: THREE.Color;
  spill: THREE.Color;
  beacon: number;
  markers: number;
  bio: number;
  murk: number;
}
const LOOKS: Record<ViewportState, Look> = {
  calm: { flood: 1, floodCol: new THREE.Color(0xe4ecee), spill: new THREE.Color(0xffc58a).multiplyScalar(0.035), beacon: 1, markers: 1, bio: 0.25, murk: 1 },
  cold: { flood: 0.3, floodCol: new THREE.Color(0xa8c8ff), spill: new THREE.Color(0x9cbcff).multiplyScalar(0.012), beacon: 1, markers: 0.4, bio: 0.7, murk: 1.1 },
  dark: { flood: 0, floodCol: new THREE.Color(0x9cbcff), spill: new THREE.Color(0x9cbcff).multiplyScalar(0.004), beacon: 0.85, markers: 0, bio: 1, murk: 1.15 },
};

/** In-scatter samples per flood cone. */
const QSTEPS: Record<Quality, number> = { low: 4, medium: 6, high: 8, ultra: 10 };
const QSNOW: Record<Quality, number> = { low: 700, medium: 1100, high: 1500, ultra: 1500 };
/** Stage 3b §8.6.4 caps for wide panes (width ≥ 20 m, e.g. a tube side): march steps and snow per side. */
const WIDE = 20;
const QSTEPS_WIDE: Record<Quality, number> = { low: 4, medium: 6, high: 8, ultra: 8 };
const QSNOW_WIDE: Record<Quality, number> = { low: 300, medium: 450, high: 600, ultra: 600 };
/** Stage 3c (W6): a small port (width ≤ 2 m, the 0.6 m lock port) — the flecks scale with the pane, not a room's worth. */
const SMALL = 2;
const QSNOW_SMALL: Record<Quality, number> = { low: 90, medium: 140, high: 200, ultra: 200 };
const QSHAPES: Record<Quality, number> = { low: 1, medium: 2, high: 3, ultra: 3 };
const SNOW_MAX = 1500;
const BIO_MAX = 40;

// ───────────────────────────────────────────── GLSL

const COMMON = /* glsl */ `
uniform vec3 uOrigin;
uniform vec3 uU;
uniform vec3 uV;
uniform vec3 uN;
uniform float uTime;
uniform vec3 uSigma;
uniform vec3 uFloodPos[3];
uniform vec3 uFloodDir[3];
uniform vec3 uFloodI;
uniform vec3 uFloodCol;
uniform vec2 uFloodCos;
uniform vec3 uSpill;
uniform float uHeads;
uniform float uDesat;

uniform highp sampler3D tNoise;
/** Smooth value noise, period 8 lattice units, from a 32³ texture (one fetch instead of eight hashes). */
float vnoise(vec3 p) { return texture(tNoise, p * 0.125).r; }
/** Light of flood i arriving at p (attenuated by the water on the way). */
vec3 floodOne(int i, vec3 p) {
  vec3 lv = p - uFloodPos[i];
  float d = length(lv);
  float c = dot(lv, uFloodDir[i]) / max(d, 1e-3);
  float cone = smoothstep(uFloodCos.y, uFloodCos.x, c);
  cone *= 0.55 + 0.45 * smoothstep(uFloodCos.x, 1.0, c);   // soft hot core
  return uFloodI[i] * cone * exp(-uSigma * d) / (1.0 + 0.035 * d * d);
}
/** Light from all hull floods arriving at p. */
vec3 floodAt(vec3 p) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 3; i++) if (uFloodI[i] > 0.0) sum += floodOne(i, p);
  return sum * uFloodCol;
}
/** Room light thrown out through the pane, at depth w behind it. */
vec3 spillAt(float w) { return uSpill * exp(-uSigma * w * 1.6) / (1.0 + w * 0.8); }
`;

const VOLUME_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const VOLUME_FRAG = /* glsl */ `
${COMMON}
varying vec3 vWorld;
uniform vec2 uHalf;
uniform float uSteps;
uniform float uMaxDist;
uniform float uSeabedY;
uniform float uSeabedOn;
uniform vec3 uCabA;
uniform vec3 uCabB;
uniform float uCabR;
uniform float uCabOn;
uniform vec3 uCab2A;        // stage 3d (W6): the cut cable's free upper run (uCab2On 1); uCabA → uCabB is then the stub
uniform vec3 uCab2B;
uniform float uCab2On;
uniform float uShapeK[3];   // stage 3d (W6): rim glow multiplier per shape (a pass() shape glows brighter)
uniform vec4 uMark[4];      // xyz, kind (0 off, 1 beacon, 2 marker)
uniform float uBeacon;
uniform float uMarkers;
uniform vec4 uShape[3];     // xyz centre, radius (0 = off)
uniform float uBio;
uniform float uGlass;
uniform vec2 uClip;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

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
/** Ray segment [t0, t1] ∩ [0, tMax] inside the cone (apex A, unit axis D, cos half-angle c); empty: t1 <= t0. */
vec2 coneSeg(vec3 o, vec3 d, vec3 A, vec3 D, float c, float tMax) {
  vec3 co = o - A;
  float dD = dot(d, D), cD = dot(co, D), c2 = c * c;
  float a = dD * dD - c2;
  float b = 2.0 * (dD * cD - c2 * dot(d, co));
  float k = cD * cD - c2 * dot(co, co);
  float h = b * b - 4.0 * a * k;
  if (h < 0.0 || abs(a) < 1e-6) return vec2(1.0, 0.0);
  h = sqrt(h);
  float t1 = (-b - h) / (2.0 * a), t2 = (-b + h) / (2.0 * a);
  if (t1 > t2) { float x = t1; t1 = t2; t2 = x; }
  vec2 seg = a < 0.0 ? vec2(t1, t2) : (dD > 0.0 ? vec2(t2, 1e4) : vec2(-1e4, t1));
  seg = clamp(seg, 0.0, tMax);
  // keep only the forward nappe
  float tm = 0.5 * (seg.x + seg.y);
  if (cD + tm * dD < 0.0) return vec2(1.0, 0.0);
  return seg;
}
/** Distance from the ray (ro, rd; t ∈ [0, tMax]) to point p, and the ray t of closest approach. */
vec2 rayPoint(vec3 ro, vec3 rd, vec3 p, float tMax) {
  float t = clamp(dot(p - ro, rd), 0.0, tMax);
  return vec2(length(ro + rd * t - p), t);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  float dn = dot(rd, uN);
  if (dn > -1e-4) discard;
  float t0 = max(dot(uOrigin - ro, uN) / dn, 0.0);
  vec3 g = ro + rd * t0;                    // on the glass
  vec3 gl = g - uOrigin;
  vec2 gp = vec2(dot(gl, uU), dot(gl, uV)) / uHalf;   // -1..1 on the pane
  // stage 3b D21: the sea is seen through its pane and nowhere else — a proxy fragment reached through any other
  // gap (a seam in the walls around it, an oblique view past the frame) draws nothing
  if (abs(gp.x) > 1.0 + uClip.x || abs(gp.y) > 1.0 + uClip.y) discard;
  // from here the ray starts at the glass
  vec3 o = g;
  float tEnd = uMaxDist;

  // ── seabed: plane sloping down away from the glass (drop 0.25 m per metre)
  vec3 sbN = normalize(uV + uN * 0.25);
  float sbT = -1.0;
  if (uSeabedOn > 0.5) {
    vec3 sp = uOrigin + uV * (uSeabedY - uOrigin.y);
    float den = dot(rd, sbN);
    if (den < -1e-4) { sbT = dot(sp - o, sbN) / den; if (sbT > 0.0 && sbT < tEnd) tEnd = sbT; else sbT = -1.0; }
  }
  // ── the trunk cable
  float cT = -1.0;
  vec3 cA = uCabA, cB = uCabB;
  if (uCabOn > 0.5) {
    cT = capsule(o, rd, uCabA, uCabB, uCabR);
    if (uCab2On > 0.5) {
      float c2 = capsule(o, rd, uCab2A, uCab2B, uCabR);
      if (c2 > 0.0 && (cT <= 0.0 || c2 < cT)) { cT = c2; cA = uCab2A; cB = uCab2B; }
    }
    if (cT > 0.0 && cT < tEnd) tEnd = cT; else cT = -1.0;
  }
  // ── in-scatter: per flood, only along the segment of the ray inside its cone (few samples, smooth shafts)
  vec3 scat = vec3(0.0);
  float sMax = min(tEnd, uMaxDist);
#ifdef VP_CHEAP
  // fallback: no march — the floods' glow as a gradient (brighter high and near, toward the beams' side)
  {
    float up = clamp(0.5 + 0.5 * dot(rd, uV) + 0.25 * gp.y, 0.0, 1.0);
    float fl = (uFloodI.x + uFloodI.y + uFloodI.z) * 0.0045;
    vec3 near = floodAt(o + rd * min(sMax, 2.5) + uV * 0.6);
    // (tinted as the marched water is: red dies first)
    scat = (near * 0.06 + uFloodCol * fl * (0.25 + 0.75 * up)) * vec3(0.35, 0.8, 1.15) * 1.5 * (1.0 - exp(-uSigma * sMax * 0.8));
  }
#else
  float j = ign(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0);
  float n = uSteps;
  for (int f = 0; f < 3; f++) {
    if (uFloodI[f] <= 0.0) continue;
    vec2 seg = coneSeg(o, rd, uFloodPos[f], uFloodDir[f], uFloodCos.y, sMax);
    if (seg.y <= seg.x) continue;
    float len = seg.y - seg.x;
    float ds = len / n;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      if (float(i) >= n) break;
      float s = seg.x + (float(i) + j) * ds;
      vec3 p = o + rd * s;
      // drifting particulate: slow, large cells (the shafts move) + a finer layer
      vec3 q = p * 0.42 + vec3(uTime * 0.035, uTime * 0.018, -uTime * 0.021);
      float dens = 0.25 + 1.6 * vnoise(q) * (0.5 + 1.0 * vnoise(q * 2.7 + 5.1));
      acc += floodOne(f, p) * dens * exp(-uSigma * s);
    }
    scat += acc * ds;
  }
  scat *= uFloodCol;
  // forward-ish scattering for rays looking along the beams, weak back-scatter otherwise
  scat *= 0.11;
#endif
  // (B8) the floods' shafts toward grey: the extinction alone paints them an electric blue
  scat = mix(scat, vec3(dot(scat, vec3(0.3, 0.5, 0.2))), uDesat);
  // room spill (analytic): out through the pane, back to the eye
  vec3 sig2 = uSigma * 2.6 + 0.8;
  scat += uSpill * (1.0 - exp(-sig2 * sMax)) / sig2 * 0.55;

  vec3 T = exp(-uSigma * tEnd);
  // the deep: what little of the floods' light scatters everywhere — black-blue, deepening with distance
  float fsum = (uFloodI.x + uFloodI.y + uFloodI.z) * 0.0006;
  vec3 col = scat + uFloodCol * vec3(0.05, 0.35, 0.6) * fsum * (1.0 - T) + vec3(0.0004, 0.0012, 0.0022) * (1.0 - T);

  // ── surfaces at the end of the ray
  vec3 pe = o + rd * tEnd;
  if (sbT > 0.0 && tEnd == sbT) {
    // silt: ripple marks + scattered stones, lit only by the floods (and the faint spill near the wall)
    vec2 sq = vec2(dot(pe, uU), dot(pe, uN));
    float rip = 0.5 + 0.5 * sin(sq.x * 2.1 + vnoise(vec3(sq * 0.4, 1.0)) * 5.0);
    float stones = smoothstep(0.78, 0.86, vnoise(vec3(sq * 1.7, 3.0)));
    float alb = 0.05 + 0.03 * rip + 0.05 * stones;
    vec3 Ls = floodAt(pe + sbN * 0.05);
    col += T * alb * Ls * 0.9;
  }
  if (cT > 0.0 && tEnd == cT) {
    vec3 ba = cB - cA;
    float y = clamp(dot(pe - cA, ba) / dot(ba, ba), 0.0, 1.0);
    vec3 nrm = normalize(pe - (cA + ba * y));
    float along = y * length(ba);
    // armour strakes (a slow helix) and collar bands every 6 m
    float ang = atan(dot(nrm, uU), dot(nrm, uN));
    float strake = 0.5 + 0.5 * sin(along * 7.0 + ang * 6.0);
    float collar = smoothstep(0.08, 0.0, abs(fract(along / 6.0) - 0.5) - 0.42);
    float alb = 0.025 + 0.02 * strake + 0.05 * collar;
    vec3 L = floodAt(pe + nrm * 0.1);
    float lam = 0.35 + 0.65 * max(dot(nrm, -rd), 0.0);
    // growth / silt on the upper side
    alb += 0.03 * max(dot(nrm, uV), 0.0) * vnoise(pe * 3.0);
    col += T * alb * L * lam * 1.2;
    col += T * uSpill * alb * 0.6 * exp(-cT * 0.6);
  }
  // ── large slow shapes: soft bells (no hard edge), a wavering margin, trailing threads, a faint pulsing rim of
  //    light. Seen mostly as something blocking the haze of the beams; subtle by design.
#ifndef VP_CHEAP
  for (int i = 0; i < 3; i++) {
    float r = uShape[i].w;
    if (r <= 0.0) continue;
    vec3 sc = vec3(1.0, 1.0 / 0.55, 1.0) / r;
    vec3 lo = (o - uShape[i].xyz) * sc, ld = rd * sc;
    float tc = -dot(lo, ld) / dot(ld, ld);
    if (tc <= 0.0 || tc > tEnd + r) continue;
    vec3 lp = lo + ld * tc;                                   // nearest point to the centre, shape space
    vec3 right = normalize(cross(ld, vec3(0.0, 1.0, 0.0)));
    float uu = dot(lp, right);
    float ang = atan(uu, 0.7);
    float wob = 0.07 * sin(ang * 6.0 + uTime * 0.7 + float(i) * 2.0) + 0.12 * (vnoise(lp * 2.5 + vec3(0.0, uTime * 0.15, float(i) * 9.0)) - 0.5);
    // a bell: the lower half is hollow (a skirt fading out), the dome is solid-ish
    float skirt = lp.y < 0.0 ? smoothstep(-0.55, 0.05, lp.y) : 1.0;
    float d = length(lp) + wob;
    float a = smoothstep(1.0, 0.45, d) * skirt;
    // threads trailing below the margin
    float thr = 0.0;
    if (lp.y < -0.1 && lp.y > -4.5) {
      for (int k = 0; k < 4; k++) {
        float xk = -0.6 + 0.4 * float(k);
        float sway = 0.18 * sin(lp.y * 1.3 + uTime * (0.4 + 0.1 * float(k)) + float(k));
        float w = 0.025 + 0.01 * float(k & 1);
        thr += exp(-pow((uu - xk - sway) / w, 2.0)) * smoothstep(-4.5, -0.6, lp.y);
      }
    }
    float far = 0.35 + 0.65 * exp(-uSigma.g * tc * 0.5);
    vec3 pw = o + rd * tc;
    vec3 L = floodAt(pw);
    col *= 1.0 - (a * 0.88 + thr * 0.3) * far;
    float rim = exp(-pow((d - 0.82) / 0.07, 2.0)) * step(-0.2, lp.y);
    float pulse = 0.5 + 0.5 * sin(uTime * 0.9 - ang * 4.0);
    col += (L * (0.02 * a + 0.05 * rim + 0.04 * thr) + vec3(0.05, 0.42, 0.55) * (rim * pulse + thr * 0.3) * (0.03 + 0.1 * uBio) * uShapeK[i]) * far;
  }
#endif

  // ── (B8) the flood heads: a lens you can see where each beam starts, brightest seen from in front of it
  if (uHeads > 0.0) for (int f = 0; f < 3; f++) {
    if (uFloodI[f] <= 0.0) continue;
    vec3 fp = uFloodPos[f];
    vec2 rp = rayPoint(o, rd, fp, uMaxDist * 2.0);
    float dist = length(fp - o);
    float occ = (tEnd < dist - 0.3) ? 0.1 : 1.0;
    float facing = 0.3 + 0.7 * smoothstep(-0.3, 0.7, dot(normalize(o - fp), uFloodDir[f]));
    vec3 att = exp(-uSigma * 0.3 * dist);
    float core = 1.0 / (1.0 + pow(rp.x / 0.045, 2.0));
    float halo = exp(-rp.x / (0.22 + dist * 0.05));
    vec3 lc = mix(uFloodCol, vec3(1.0), 0.6);
    col += lc * uFloodI[f] * uHeads * facing * att * occ * (core * 1.6 + halo * 0.22);
  }
  // ── lamps on the cable, each with its own (longer) fog: the beacon reads at 18 m
  vec3 sigB = uSigma * 0.22;
  for (int i = 0; i < 4; i++) {
    float k = uMark[i].w;
    if (k < 0.5) continue;
    vec3 mp = uMark[i].xyz;
    vec2 rp = rayPoint(o, rd, mp, uMaxDist * 2.0);
    float dist = length(mp - o);
    // occluded by the cable itself / the seabed when the hit is clearly in front
    float occ = (tEnd < dist - uCabR * 2.5) ? 0.15 : 1.0;
    vec3 att = exp(-sigB * dist);
    float core = 1.0 / (1.0 + pow(rp.x / 0.06, 2.0));
    float halo = exp(-rp.x / (0.2 + dist * 0.05));
    float on;
    vec3 c;
    if (k < 1.5) {
      // red beacon, 0.25 Hz: a 0.6 s flash, a soft tail
      float ph = fract(uTime * 0.25 + float(i) * 0.37);
      on = (smoothstep(0.0, 0.03, ph) * (1.0 - smoothstep(0.12, 0.3, ph)) * 0.95 + 0.05) * uBeacon;
      c = vec3(1.0, 0.05, 0.02) * 70.0;
    } else {
      float ph = fract(uTime * 0.11 + float(i) * 0.61);
      on = (0.6 + 0.4 * step(0.5, ph)) * uMarkers;
      c = vec3(1.0, 0.85, 0.6) * 2.0;
    }
    col += c * on * att * occ * (core + halo * 0.35);
  }

  // ── bioluminescent haze: very faint drifting glints far out (the 'dark' state is not flat black)
  float bioN = vnoise(vec3(gp * 3.0, uTime * 0.05) + rd * 4.0);
  col += vec3(0.02, 0.12, 0.15) * smoothstep(0.86, 0.97, bioN) * uBio * 0.08;

  // ── the glass: thick pane — edge tint and an inner edge highlight, faint room reflection and slow shimmer
  if (uGlass > 0.0) {
    vec2 e = 1.0 - abs(gp);
    float edge = exp(-min(e.x * uHalf.x, e.y * uHalf.y) / 0.12);
    float fres = pow(1.0 - clamp(-dn, 0.0, 1.0), 4.0);
    float smudge = vnoise(vec3(gp * vec2(5.0, 3.0), 7.0)) * vnoise(vec3(gp * 23.0, 2.0));
    float shimmer = pow(abs(sin(dot(gp, vec2(4.1, 1.7)) * 3.0 + uTime * 0.31 + 2.0 * vnoise(vec3(gp * 4.0, uTime * 0.07)))), 12.0);
    float low = smoothstep(0.2, -1.0, gp.y);
    vec3 room = uSpill * (0.02 + 0.5 * fres + 0.12 * smudge + 0.05 * shimmer * low);
    col = col * mix(vec3(1.0), vec3(0.82, 0.92, 0.9), edge) + room * uGlass + uSpill * edge * 0.12 * uGlass;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const SNOW_VERT = /* glsl */ `
${COMMON}
attribute vec4 aSeed;
uniform vec3 uDomain;      // size along u, v, w
uniform float uWMin;
uniform vec2 uCurrent;     // drift along u, w (m/s)
uniform float uPxScale;
uniform float uBio;
uniform float uBioCount;
uniform vec2 uHalf;
uniform vec4 uShape[3];
varying vec3 vCol;
varying float vSoft;
void main() {
  float idx = float(gl_VertexID);
  float isBio = step(idx, uBioCount - 0.5);
  float sink = 0.012 + 0.03 * fract(aSeed.w * 7.13);
  vec3 vel = vec3(uCurrent.x * (0.7 + 0.6 * aSeed.w), -sink, uCurrent.y * (0.6 + 0.8 * fract(aSeed.w * 3.7)));
  vec3 wob = 0.12 * vec3(sin(uTime * 0.31 + aSeed.w * 40.0), sin(uTime * 0.23 + aSeed.x * 31.0), sin(uTime * 0.19 + aSeed.y * 17.0));
  vec3 l = mod(aSeed.xyz * uDomain + vel * uTime + wob + uDomain * 4.0, uDomain);
  // fade near the wrap borders (no popping)
  vec3 b = min(l, uDomain - l) / min(uDomain, vec3(1.5));
  float edge = clamp(min(min(b.x, b.y), b.z), 0.0, 1.0);
  vec3 lp = vec3(l.x - uDomain.x * 0.5, l.y - uDomain.y * 0.5, l.z + uWMin);
  vec3 world = uOrigin + uU * lp.x + uV * lp.y - uN * lp.z;
  // stage 3d (W6): the snow swirls round a passing shape (pushed off it, turned about the vertical)
  for (int i = 0; i < 3; i++) {
    float sr = uShape[i].w;
    if (sr <= 0.0) continue;
    vec3 sd = world - uShape[i].xyz;
    float sk = exp(-dot(sd, sd) / (sr * sr * 2.6));
    world += (normalize(sd + vec3(1e-3)) * sr * 0.3 + cross(vec3(0.0, 1.0, 0.0), sd) * 0.45 * sin(uTime * 0.6 + float(i))) * sk;
  }
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  // stage 3b D21: a fleck is drawn only when the eye sees it through the pane
  {
    vec3 rd = world - cameraPosition;
    float den = dot(rd, uN);
    float t = den < -1e-5 ? dot(uOrigin - cameraPosition, uN) / den : -1.0;
    vec3 h = cameraPosition + rd * t - uOrigin;
    if (t <= 0.0 || t >= 1.0 || abs(dot(h, uU)) > uHalf.x || abs(dot(h, uV)) > uHalf.y) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vCol = vec3(0.0); vSoft = 0.0;
      return;
    }
  }
  float dist = -mv.z;
  float distG = length(world - cameraPosition);
  // light: floods + the room spill near the glass, through the murk to the eye (from the glass onward)
  vec3 L = floodAt(world) * 4.0 + spillAt(lp.z) * 6.0;
  vec3 T = exp(-uSigma * lp.z);
  float size = mix(0.012, 0.045, pow(fract(aSeed.w * 13.7), 3.0));
  float alb = 0.5 + 0.5 * fract(aSeed.w * 5.3);
  vec3 c = L * alb * T;
  float px = size * uPxScale / max(dist, 0.1);
  // defocus: very near flecks grow soft and dim
  float soft = smoothstep(2.0, 0.4, lp.z);
  px = mix(px, px * 2.2 + 3.0, soft);
  c *= mix(1.0, 0.35, soft);
  // energy-conserving size floor: sub-pixel flecks get dimmer instead of bigger
  float pxc = max(px, 1.2);
  c *= min(px * px / (pxc * pxc), 1.0) * 5.0;
  if (isBio > 0.5) {
    float ph = fract(uTime / (9.0 + 14.0 * aSeed.w) + aSeed.x);
    float blink = smoothstep(0.0, 0.02, ph) * (1.0 - smoothstep(0.02, 0.09, ph));
    c = vec3(0.12, 0.9, 1.0) * blink * uBio * 6.0 * exp(-uSigma.g * 0.5 * lp.z);
    pxc = max(pxc, 3.0 + 6.0 * blink);
  }
  vCol = c * edge;
  vSoft = soft;
  gl_PointSize = min(pxc, 14.0);
}
`;

const SNOW_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vSoft;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  float a = mix(exp(-r * 4.0), exp(-r * 1.6), vSoft);
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

// ───────────────────────────────────────────── build

let NOISE: THREE.Data3DTexture | null = null;
/** 32³ tileable smooth value noise (lattice period 8, smoothstep-interpolated per texel), shared by all viewports. */
export function noiseTexture(): THREE.Data3DTexture {
  if (NOISE) return NOISE;
  const S = 32, L = 8, k = S / L;
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const lat = new Float32Array(L * L * L);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const at = (x: number, y: number, z: number) => lat[((z % L) * L + (y % L)) * L + (x % L)];
  const sm = (t: number) => t * t * (3 - 2 * t);
  const data = new Uint8Array(S * S * S);
  for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = x / k, fy = y / k, fz = z / k;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const tx = sm(fx - ix), ty = sm(fy - iy), tz = sm(fz - iz);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    const v = l(
      l(l(at(ix, iy, iz), at(ix + 1, iy, iz), tx), l(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), tx), ty),
      l(l(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), tx), l(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), tx), ty), tz);
    data[(z * S + y) * S + x] = Math.round(v * 255);
  }
  const t = new THREE.Data3DTexture(data, S, S, S);
  t.format = THREE.RedFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  NOISE = t;
  return t;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

interface Shape { active: boolean; t: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; r: number; bob: number; next: number; k: number; forced: boolean }

export function createViewport(o: ViewportOpts, parent: THREE.Object3D, quality: () => Quality): ViewportHandle {
  const N = o.normal.clone().setY(0).normalize();
  if (N.lengthSq() < 0.5) throw new Error('[fx.viewport] normal must be horizontal');
  const V = new THREE.Vector3(0, 1, 0);
  const U = new THREE.Vector3().crossVectors(V, N).normalize(); // right, as seen from the room
  const W = N.clone().negate(); // outward
  const halfW = o.width / 2, halfH = o.height / 2;
  const wide = o.width >= WIDE;
  const small = o.width <= SMALL;
  const depth = o.depth ?? 18;
  const spread = o.spread ?? 1.6;
  const vis = o.visibility ?? 4.5;
  const origin = o.position.clone();
  const local = (u: number, v: number, w: number, out = new THREE.Vector3()) =>
    out.copy(origin).addScaledVector(U, u).addScaledVector(V, v).addScaledVector(W, w);

  const group = new THREE.Group();
  group.name = 'fx:viewport';
  // just inside the room, so render's room occlusion judges it by the room it is seen from
  group.position.copy(origin).addScaledVector(N, 0.05);
  group.updateMatrixWorld(true);

  // ── uniforms (shared by both materials)
  const sigma = new THREE.Vector3(1.7, 1.0, 0.8).multiplyScalar(1 / vis);
  const floodsIn = o.floods ?? [
    { at: [-halfW * 0.45, halfH + 2.4, 1.2] as [number, number, number], dir: [0.1, -1, 0.5] as [number, number, number], intensity: 1 },
    { at: [halfW * 0.5, halfH + 2.6, 1.6] as [number, number, number], dir: [-0.15, -1, 0.62] as [number, number, number], intensity: 0.9 },
  ];
  const floodPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const floodDir = [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0)];
  const floodBase = new THREE.Vector3();
  for (let i = 0; i < 3; i++) {
    const f = floodsIn[i];
    if (!f) continue;
    local(f.at[0], f.at[1], f.at[2], floodPos[i]);
    floodDir[i].set(0, 0, 0).addScaledVector(U, f.dir[0]).addScaledVector(V, f.dir[1]).addScaledVector(W, f.dir[2]).normalize();
    floodBase.setComponent(i, (f.intensity ?? 1) * 14);
  }
  const shared = {
    uOrigin: { value: origin },
    uU: { value: U }, uV: { value: V }, uN: { value: N },
    uTime: { value: 0 },
    uSigma: { value: sigma.clone() },
    uFloodPos: { value: floodPos },
    uFloodDir: { value: floodDir },
    uFloodI: { value: floodBase.clone() },
    uFloodCol: { value: new THREE.Color() },
    uFloodCos: { value: new THREE.Vector2(Math.cos(0.3), Math.cos(0.5)) },
    uSpill: { value: new THREE.Color() },
    uBio: { value: 0 },
    uHeads: { value: o.heads ?? 0 },
    uDesat: { value: o.desat ?? 0 },
    tNoise: { value: noiseTexture() },
  };

  // cable default: from the seabed below-left, rising steeply away through a beacon 18 m out
  const seabedY = o.seabed === undefined ? origin.y - halfH - 2.5 : o.seabed;
  let cable = o.cable;
  if (cable === undefined) {
    const beacon = local(1.5, 0.1, 18);
    const from = local(-0.6, (seabedY ?? origin.y - halfH - 4) - origin.y - 4.5, 13.5);
    const dir = _v.subVectors(beacon, from).normalize();
    cable = { from, to: beacon.clone().addScaledVector(dir, 60), radius: 0.55, beacon, markers: 2 };
  }
  const marks = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  if (cable) {
    let k = 0;
    const r = cable.radius ?? 0.55;
    const axis = _w.subVectors(cable.to, cable.from).normalize();
    // lamps sit on the side of the cable facing the room
    const facing = (p: THREE.Vector3) => {
      const out = p.clone();
      const toRoom = _v.subVectors(origin, p);
      toRoom.addScaledVector(axis, -toRoom.dot(axis)).normalize();
      return out.addScaledVector(toRoom, r * 1.05);
    };
    if (cable.beacon) { const p = facing(cable.beacon); marks[k++].set(p.x, p.y, p.z, 1); }
    const base = cable.beacon ?? cable.from;
    for (let i = 0; i < (cable.markers ?? 2) && k < 4; i++) {
      const p = facing(base.clone().addScaledVector(axis, (i % 2 ? -1 : 1) * 7 * (1 + (i >> 1))));
      marks[k++].set(p.x, p.y, p.z, 2);
    }
  }

  const shapeU = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  const volMat = new THREE.ShaderMaterial({
    name: 'fx:viewport',
    vertexShader: VOLUME_VERT,
    fragmentShader: VOLUME_FRAG,
    side: THREE.BackSide,
    depthWrite: true,
    uniforms: {
      ...shared,
      uHalf: { value: new THREE.Vector2(halfW, halfH) },
      uSteps: { value: 6 },
      uMaxDist: { value: Math.min(28, vis * 6) },
      uSeabedY: { value: seabedY ?? 0 },
      uSeabedOn: { value: seabedY === null ? 0 : 1 },
      uCabA: { value: cable ? cable.from.clone() : new THREE.Vector3() },
      uCabB: { value: cable ? cable.to.clone() : new THREE.Vector3() },
      uCabR: { value: cable?.radius ?? 0.55 },
      uCabOn: { value: cable ? 1 : 0 },
      uMark: { value: marks },
      uBeacon: { value: 1 },
      uMarkers: { value: 1 },
      uShape: { value: shapeU },
      uShapeK: { value: [1, 1, 1] },
      uCab2A: { value: new THREE.Vector3() },
      uCab2B: { value: new THREE.Vector3() },
      uCab2On: { value: 0 },
      uGlass: { value: 1 },
      uClip: { value: new THREE.Vector2(0.03 / halfW, 0.03 / halfH) },
    },
  });
  if (o.cheap) { volMat.defines = { VP_CHEAP: 1 }; volMat.name = 'fx:viewport:cheap'; }

  // proxy: truncated pyramid from the pane outline (at the glass) to a wider far rectangle
  const fw = halfW + depth * spread, fh = halfH + depth * spread * 0.6;
  const toGroup = (u: number, v: number, w: number) => local(u, v, w, new THREE.Vector3()).sub(group.position);
  const nv = [toGroup(-halfW, -halfH, 0), toGroup(halfW, -halfH, 0), toGroup(halfW, halfH, 0), toGroup(-halfW, halfH, 0)];
  const fv = [toGroup(-fw, -fh, depth), toGroup(fw, -fh, depth), toGroup(fw, fh, depth), toGroup(-fw, fh, depth)];
  const pos: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    for (const p of [a, b, c, a, c, d]) pos.push(p.x, p.y, p.z);
  };
  // windings so that faces point INTO the volume's outside (BackSide shows the inside)
  quad(fv[0], fv[3], fv[2], fv[1]);               // far
  quad(nv[0], fv[0], fv[1], nv[1]);               // bottom
  quad(nv[3], nv[2], fv[2], fv[3]);               // top
  quad(nv[0], nv[3], fv[3], fv[0]);               // left
  quad(nv[1], fv[1], fv[2], nv[2]);               // right
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const volume = new THREE.Mesh(geo, volMat);
  volume.name = 'fx:viewport:volume';
  volume.renderOrder = -5;
  // DoubleSide: a view ray through the open pane meets exactly one face of the proxy (from inside), whatever the winding
  volMat.side = THREE.DoubleSide;
  volume.castShadow = false;
  volume.receiveShadow = false;
  group.add(volume);

  // ── marine snow
  const seeds = new Float32Array(SNOW_MAX * 4);
  let seed = 977;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < SNOW_MAX * 4; i++) seeds[i] = rnd();
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW_MAX * 3), 3));
  sgeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  sgeo.boundingSphere = new THREE.Sphere(local(0, 0, depth * 0.5).sub(group.position), depth + halfW + 8);
  const domain = new THREE.Vector3(o.width + 8, o.height + 6, Math.min(depth - 0.5, vis * 2.2));
  const snowMat = new THREE.ShaderMaterial({
    name: 'fx:viewport:snow',
    vertexShader: SNOW_VERT,
    fragmentShader: SNOW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      ...shared,
      uDomain: { value: domain },
      uWMin: { value: 0.15 },
      uCurrent: { value: new THREE.Vector2(0.045, -0.012) },
      uPxScale: { value: 600 },
      uBioCount: { value: BIO_MAX },
      uHalf: { value: new THREE.Vector2(halfW, halfH) },
      uShape: { value: shapeU },
    },
  });
  const snow = new THREE.Points(sgeo, snowMat);
  snow.name = 'fx:viewport:snow';
  snow.renderOrder = -4;
  snow.frustumCulled = true;
  group.add(snow);
  parent.add(group);

  // ── state tween
  let state: ViewportState = o.state ?? 'calm';
  const cur = { ...LOOKS[state], floodCol: LOOKS[state].floodCol.clone(), spill: LOOKS[state].spill.clone() };
  const from = { ...cur, floodCol: cur.floodCol.clone(), spill: cur.spill.clone() };
  let tw = 1, twDur = 0;
  let flickerDown = false;
  let time = 0;

  // ── shapes
  const shapeMax = o.shapes;
  const gap = o.shapeGap ?? 70;
  const shapes: Shape[] = [0, 1, 2].map((i) => ({ active: false, t: 0, dur: 1, from: new THREE.Vector3(), to: new THREE.Vector3(), r: 1, bob: 0, next: 12 + i * gap * 0.7 + rnd() * gap, k: 1, forced: false }));
  const startShape = (s: Shape) => {
    const side = rnd() < 0.5 ? -1 : 1;
    const w = 9 + rnd() * 8;
    const v0 = (rnd() - 0.4) * (halfH + 3);
    const span = halfW + w * 1.1 + 6;
    local(-side * span, v0, w, s.from);
    local(side * span, v0 + (rnd() - 0.5) * 3, w + (rnd() - 0.5) * 4, s.to);
    s.r = 1.6 + rnd() * 1.6;
    s.dur = (2 * span) / (0.22 + rnd() * 0.12);
    s.t = 0; s.bob = rnd() * 6.28; s.active = true; s.k = 1; s.forced = false;
  };

  // ── stage 3d (W6): beacon switch, the cut, the pass
  const bea = { v: o.beacon === false ? 0 : 1, from: 0, to: 0, t: 1, dur: 0 };
  const cut = { on: false, k: 0, t: 1, dur: 0, at: new THREE.Vector3(), offA: new THREE.Vector3(), offB: new THREE.Vector3() };
  const setBeacon = (on: boolean, seconds = 0.4) => {
    bea.from = bea.v; bea.to = on ? 1 : 0; bea.dur = Math.max(0, seconds); bea.t = bea.dur > 0 ? 0 : 1;
    if (bea.dur <= 0) bea.v = bea.to;
  };
  const cutUniforms = () => {
    const vu = volMat.uniforms;
    if (!cut.on || !cable) return;
    // the free end springs up and away, then the run drifts out of the light (ease-out)
    const e = 1 - (1 - cut.k) * (1 - cut.k);
    (vu.uCab2A.value as THREE.Vector3).copy(cut.at).addScaledVector(cut.offA, e).addScaledVector(V, -0.25 * (1 - e));
    (vu.uCab2B.value as THREE.Vector3).copy(cable.to).addScaledVector(cut.offB, e);
  };
  const cutCable = (seconds = 6, at?: number) => {
    if (cut.on) return;
    if (!cable) { console.warn('[fx.viewport] cutCable: this viewport has no cable'); return; }
    const a = cable.from, b = cable.to;
    const y0 = at ?? a.y + 1.5;
    const f = THREE.MathUtils.clamp(Math.abs(b.y - a.y) > 1e-3 ? (y0 - a.y) / (b.y - a.y) : 0.05, 0.02, 0.95);
    cut.at.copy(a).lerp(b, f);
    cut.offA.set(0, 0, 0).addScaledVector(V, 12).addScaledVector(W, 8).addScaledVector(U, 3);
    cut.offB.set(0, 0, 0).addScaledVector(V, 3).addScaledVector(W, 4);
    cut.on = true;
    cut.dur = Math.max(0, seconds);
    cut.t = cut.dur > 0 ? 0 : 1;
    cut.k = cut.dur > 0 ? 0 : 1;
    const vu = volMat.uniforms;
    (vu.uCabB.value as THREE.Vector3).copy(cut.at);
    vu.uCab2On.value = 1;
    cutUniforms();
    setBeacon(false, cut.dur > 0 ? 0.3 : 0);
  };
  const pass = (seconds = 4) => {
    const s = shapes.find((x) => !x.active) ?? shapes[0];
    const side = rnd() < 0.5 ? -1 : 1;
    const w = 13 + rnd() * 2.5;
    s.r = 8 + rnd() * 1.5;
    const span = halfW + s.r * 1.3 + 2;
    local(-side * span, -0.5 + rnd() * 1.5, w, s.from);
    local(side * span, 0.5 + rnd() * 1.5, w + 1.5, s.to);
    s.dur = Math.max(0.5, seconds);
    s.t = 0; s.bob = rnd() * 6.28; s.active = true; s.k = 3.5; s.forced = true;
  };

  const handle: ViewportHandle = {
    get state() { return state; },
    setState(s, seconds = 3) {
      flickerDown = LOOKS[s].flood < cur.flood;
      state = s;
      Object.assign(from, { ...cur, floodCol: cur.floodCol.clone(), spill: cur.spill.clone() });
      if (seconds <= 0) { tw = 1; twDur = 0; Object.assign(cur, { ...LOOKS[s], floodCol: LOOKS[s].floodCol.clone(), spill: LOOKS[s].spill.clone() }); }
      else { tw = 0; twDur = seconds; }
    },
    summon(progress = 0) { const s = shapes.find((x) => !x.active); if (s) { startShape(s); s.t = THREE.MathUtils.clamp(progress, 0, 0.99); } },
    pass,
    setBeacon,
    cutCable,
    get cableCut() { return cut.on; },
    object: group,
    get visible() { return group.visible; },
    set visible(v: boolean) { group.visible = v; },
    remove() {
      parent.remove(group);
      geo.dispose(); sgeo.dispose(); volMat.dispose(); snowMat.dispose();
    },
    update(dt, camera, pixelScale, q) {
      time += dt;
      shared.uTime.value = time % 3600;
      // tween
      let flick = 1;
      if (tw < 1) {
        tw = Math.min(1, tw + dt / Math.max(twDur, 1e-3));
        const k = tw * tw * (3 - 2 * tw);
        const T = LOOKS[state];
        cur.flood = from.flood + (T.flood - from.flood) * k;
        cur.floodCol.copy(from.floodCol).lerp(T.floodCol, k);
        cur.spill.copy(from.spill).lerp(T.spill, k);
        cur.beacon = from.beacon + (T.beacon - from.beacon) * k;
        cur.markers = from.markers + (T.markers - from.markers) * k;
        cur.bio = from.bio + (T.bio - from.bio) * k;
        cur.murk = from.murk + (T.murk - from.murk) * k;
        if (flickerDown && tw < 0.85) {
          // floods losing power: stutter
          const n = Math.sin(time * 61.3) * Math.sin(time * 23.7 + 1.3);
          flick = n > 0.55 - tw * 0.4 ? 0.15 : 1;
        }
      }
      shared.uFloodI.value.copy(floodBase).multiplyScalar(cur.flood * flick);
      shared.uFloodCol.value.copy(cur.floodCol);
      shared.uSpill.value.copy(cur.spill);
      shared.uBio.value = cur.bio;
      shared.uSigma.value.copy(sigma).multiplyScalar(cur.murk);
      const vu = volMat.uniforms;
      if (bea.t < 1) { bea.t = Math.min(1, bea.t + dt / Math.max(bea.dur, 1e-3)); bea.v = bea.from + (bea.to - bea.from) * bea.t; }
      if (cut.on && cut.t < 1) { cut.t = Math.min(1, cut.t + dt / Math.max(cut.dur, 1e-3)); cut.k = cut.t; cutUniforms(); }
      vu.uBeacon.value = cur.beacon * bea.v;
      vu.uMarkers.value = cur.markers * (cut.on ? 1 - Math.min(1, cut.k * 3) : 1);
      vu.uSteps.value = (wide ? QSTEPS_WIDE[q] : QSTEPS[q]) ?? 6;
      // shapes
      const maxShapes = Math.min(3, shapeMax ?? QSHAPES[q] ?? 2);
      for (let i = 0; i < 3; i++) {
        const s = shapes[i];
        if (!s.active) {
          shapeU[i].w = 0;
          if (i < maxShapes) { s.next -= dt; if (s.next <= 0) { startShape(s); } }
          continue;
        }
        s.t += dt / s.dur;
        if (s.t >= 1 || (i >= maxShapes && !s.forced)) { s.active = false; s.forced = false; s.next = gap * (0.6 + rnd() * 0.8); shapeU[i].w = 0; continue; }
        (volMat.uniforms.uShapeK.value as number[])[i] = s.k;
        const e = s.t;
        _v.copy(s.from).lerp(s.to, e);
        _v.addScaledVector(V, Math.sin(time * 0.21 + s.bob) * 0.4);
        // the bell breathes
        const r = s.r * (1 + 0.06 * Math.sin(time * 0.8 + s.bob));
        shapeU[i].set(_v.x, _v.y, _v.z, r);
      }
      // snow
      const su = snowMat.uniforms;
      su.uPxScale.value = pixelScale;
      sgeo.setDrawRange(0, (wide ? QSNOW_WIDE[q] : small ? QSNOW_SMALL[q] : QSNOW[q]) ?? 600);
      void camera;
    },
  };
  handle.setState(state, 0);
  if (o.cableCut) cutCable(0);
  return handle;
}
