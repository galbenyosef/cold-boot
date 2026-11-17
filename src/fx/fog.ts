/**
 * Stage 3b §8.6.1 — bounded ground fog (the cold store): cold air lying on the floor, spilling out of a door.
 *
 * One draw call: a merged stack of horizontal slices (0.5 m vertex grid, lit per vertex by the real light pool —
 * flashlight included — like the smoke puffs) over the `box` and the `spill` box. Per fragment: two octaves of
 * drifting 3-D noise make it wispy (it pools and thins, its top billows), density falls off with height, and goes to
 * 0 at every side face of `box` / `spill` over 0.3 m (and over its top), so nothing of it can stand in a wall or
 * show through a gap. Where the spill box meets the box (a door) the two densities join without a seam.
 * Optional glints (≤ 300 points, 1 more draw call): ice crystals hanging in the air, twinkling as the eye moves.
 */
import * as THREE from 'three';
import type { Quality } from '../core/types';
import { FOG_FRAG, FX_LIGHT, litUniforms } from './shaders';
import { noiseTexture } from './viewport';

export interface FogOpts {
  /** The fog volume (world). Its floor is `box.min.y`. */
  box: THREE.Box3;
  /** A second box the fog spills into (out of a door; must not overlap `box`); it joins `box` without a seam across a gap ≤ 0.9 m (the wall). */
  spill?: THREE.Box3;
  color: THREE.ColorRepresentation;
  /** Extinction per metre at the floor (≈ 0.6 thin … 2.5 thick). */
  density: number;
  /** Height over which the fog thins out (m; default the box height). */
  height?: number;
  /** Drift of the noise (m/s in x, z), or a speed (default 0.05 along +x). */
  drift?: number | [number, number];
  /** Ice glints: count (≤ 300) in the box's footprint up to 2.6 m, or { count, box }. */
  glints?: number | { count: number; box: THREE.Box3 };
  /** Registry (D21): drawn only while one of these rooms is drawn. */
  rooms: readonly string[];
  /** Registry id (default 'fog#n'); the glints register as `<id>_glints`, drawn for `glintRooms` (default `rooms`). */
  id?: string;
  glintRooms?: readonly string[];
  seenFrom?: readonly string[];
  /** LOW quality: draw every other slice (half the fill cost; slice bands on vertical surfaces show more). */
  lowHalf?: boolean;
}

export interface FogHandle {
  /** The slice stack (one mesh). */
  readonly mesh: THREE.Mesh;
  /** The glints, when asked for. */
  readonly glints: THREE.Points | null;
  /** Overall density multiplier (tweened by `setDensity`). */
  readonly level: number;
  setDensity(k: number, seconds?: number): void;
  remove(): void;
  update(dt: number): void;
}

const FADE = 0.3;
const CELL = 0.5;
const GLINT_MAX = 300;

const VERT = /* glsl */ `
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
  vLight = fxLight(mv.xyz, 0.35, ld) * RECIPROCAL_PI;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${FOG_FRAG}
uniform highp sampler3D tNoise;
uniform vec3 uMin[2];
uniform vec3 uMax[2];
uniform float uBoxes;
uniform vec3 uColor;
uniform float uDensity;
uniform float uHeight;
uniform float uThick;
uniform vec2 uDrift;
uniform float uTime;
uniform vec4 uJoin;   // spill: axis (0 x, 1 z), the join face's coordinate, on (1) / off (0)
varying vec3 vW;
varying vec3 vLight;
varying float vDepth;
float vnoise(vec3 p) { return texture(tNoise, p * 0.125).r; }
/** 0 at the box's side faces and top, 1 inside (FADE m ramps); 0 outside. */
float boxEdge(vec3 p, vec3 mn, vec3 mx, float fade) {
  vec3 a = p - mn, b = mx - p;
  float dx = min(a.x, b.x), dz = min(a.z, b.z), dt = b.y;
  if (min(min(dx, dz), min(dt, a.y + 0.01)) < 0.0) return 0.0;
  float k = smoothstep(0.0, fade, dx) * smoothstep(0.0, fade, dz);
  return k * smoothstep(0.0, min(${FADE.toFixed(2)}, (mx.y - mn.y) * 0.5), dt);
}
void main() {
  vec3 p = vW;
  float edge = boxEdge(p, uMin[0], uMax[0], ${FADE.toFixed(2)});
  if (uBoxes > 1.5) {
    // the spill: soft wide edges, thinning away from the door it pours out of
    float js = uJoin.w > 0.5 ? exp(-abs((uJoin.x < 0.5 ? p.x : p.z) - uJoin.y) / 1.3) : 1.0;
    edge = max(edge, boxEdge(p, uMin[1], uMax[1], 0.7) * js);
  }
  if (edge <= 0.0) discard;
  float floorY = uMin[0].y;
  float h01 = clamp((p.y - floorY) / uHeight, 0.0, 1.0);
  vec3 q = vec3(p.x * 0.45 + uDrift.x * uTime, p.y * 1.4 + uTime * 0.025, p.z * 0.45 + uDrift.y * uTime);
  float n = vnoise(q) * 0.6 + vnoise(q * 2.7 + vec3(7.1, 3.3, 1.7) + vec3(uDrift.x, 0.0, uDrift.y) * uTime * 1.9) * 0.4;
  // pools and gaps: the wisps; the top billows (noise lifts or sinks the ceiling of the layer)
  float wisp = smoothstep(0.4, 0.86, n + 0.2 * (1.0 - h01));
  float top = 0.55 + 0.6 * n;
  float prof = pow(max(1.0 - h01 / top, 0.0), 1.5);
  float dens = uDensity * edge * wisp * prof * smoothstep(0.0, 0.05, p.y - floorY);
  // path through this slice: longer at grazing angles (capped, so far slices do not turn into bands)
  vec3 vd = normalize(p - cameraPosition);
  float a = 1.0 - exp(-dens * uThick / max(abs(vd.y), 0.16));
  a *= smoothstep(0.25, 0.9, vDepth);
  if (a < 0.002) discard;
  float f = fxFog(vDepth);
  vec3 rgb = uColor * vLight * a;
  rgb = mix(rgb, fogColor * a, f);
  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const GLINT_VERT = /* glsl */ `
#include <common>
#include <lights_pars_begin>
${FX_LIGHT}
attribute vec4 aSeed;
uniform vec3 uGMin;
uniform vec3 uGSize;
uniform float uTime;
uniform float uPx;
uniform float uLevel;
varying vec3 vCol;
void main() {
  // hanging crystals: a slow fall with a sideways wander, wrapped in the box
  vec3 l = aSeed.xyz * uGSize;
  l.y = mod(l.y - uTime * (0.015 + 0.02 * aSeed.w), uGSize.y);
  l.x += 0.25 * sin(uTime * 0.21 + aSeed.w * 31.0);
  l.z += 0.25 * sin(uTime * 0.17 + aSeed.w * 17.0);
  vec3 world = uGMin + l;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.1);
  // a crystal flashes when the eye–light geometry lines up with its facet: view-direction dependent twinkle
  vec3 vd = normalize(world - cameraPosition);
  vec3 facet = normalize(vec3(sin(aSeed.w * 91.0), cos(aSeed.w * 53.0), sin(aSeed.w * 27.0 + 1.0)));
  float tw = pow(max(sin(dot(vd, facet) * 60.0 + uTime * 0.6 + aSeed.w * 40.0), 0.0), 22.0);
  vec3 ld;
  vec3 L = fxLight(mv.xyz, 0.7, ld) * RECIPROCAL_PI;
  float edge = min(min(min(l.y, uGSize.y - l.y), 0.4) / 0.4, 1.0);
  vCol = L * (0.25 + 9.0 * tw) * edge * uLevel * smoothstep(0.4, 1.5, dist);
  gl_PointSize = clamp(uPx * 0.004 / dist, 1.0, 2.5) * (1.0 + tw);
}
`;

const GLINT_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  gl_FragColor = vec4(vCol * exp(-r * 3.0), 0.0);
}
`;

/** The spill box, pushed into `box` by FADE along the axis where they meet (density only), or null. */
function joinSpill(box: THREE.Box3, spill: THREE.Box3): THREE.Box3 {
  const j = spill.clone();
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0.2;
  const gap = 0.9;
  if (overlap(box.min.z, box.max.z, spill.min.z, spill.max.z)) {
    if (spill.max.x <= box.min.x + 0.01 && box.min.x - spill.max.x < gap) j.max.x = box.min.x + FADE;
    else if (spill.min.x >= box.max.x - 0.01 && spill.min.x - box.max.x < gap) j.min.x = box.max.x - FADE;
  }
  if (overlap(box.min.x, box.max.x, spill.min.x, spill.max.x)) {
    if (spill.max.z <= box.min.z + 0.01 && box.min.z - spill.max.z < gap) j.max.z = box.min.z + FADE;
    else if (spill.min.z >= box.max.z - 0.01 && spill.min.z - box.max.z < gap) j.min.z = box.max.z - FADE;
  }
  return j;
}

/** Where the spill pours out of the box: axis (0 x, 1 z), the box face's coordinate, on. */
function joinOf(box: THREE.Box3, spill?: THREE.Box3): THREE.Vector4 {
  if (!spill) return new THREE.Vector4();
  if (spill.max.x <= box.min.x + 0.01) return new THREE.Vector4(0, box.min.x, 0, 1);
  if (spill.min.x >= box.max.x - 0.01) return new THREE.Vector4(0, box.max.x, 0, 1);
  if (spill.max.z <= box.min.z + 0.01) return new THREE.Vector4(1, box.min.z, 0, 1);
  if (spill.min.z >= box.max.z - 0.01) return new THREE.Vector4(1, box.max.z, 0, 1);
  return new THREE.Vector4();
}

/** Horizontal slices over [x0, x1] × [z0, z1] (0.5 m grid) at the given heights, appended to pos / idx. */
function slices(pos: number[], idx: number[], x0: number, x1: number, z0: number, z1: number, ys: number[]) {
  const nx = Math.max(1, Math.round((x1 - x0) / CELL)), nz = Math.max(1, Math.round((z1 - z0) / CELL));
  for (const y of ys) {
    const base = pos.length / 3;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) pos.push(x0 + ((x1 - x0) * i) / nx, y, z0 + ((z1 - z0) * j) / nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = base + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
}

export function createFog(o: FogOpts, parent: THREE.Object3D, quality: () => Quality = () => 'high'): FogHandle {
  const box = o.box.clone();
  const spill = o.spill ? joinSpill(box, o.spill) : null;
  const top = Math.max(box.max.y, spill?.max.y ?? -Infinity);
  const floor = box.min.y;
  const n = THREE.MathUtils.clamp(Math.round((top - floor) / 0.04), 8, 16);
  const thick = (top - floor - 0.02) / n;
  /** Slice heights of one parity (even slices first in the index buffer: LOW draws only those, twice as thick). */
  const ys = (maxY: number, parity: number) => {
    const out: number[] = [];
    for (let k = parity; k < n; k += 2) { const y = floor + 0.02 + (k + 0.5) * thick; if (y < maxY) out.push(y); }
    return out;
  };
  const pos: number[] = [], idx: number[] = [];
  // the spill's geometry is its own box (it must not overlap `box`); its density reaches into the box for the join
  // (across the wall gap up to the box's face, so the doorway itself has fog)
  let g: THREE.Box3 | null = null;
  if (o.spill && spill) {
    const s = o.spill;
    g = spill.clone();
    if (s.max.x <= box.min.x + 0.01) g.max.x = Math.min(g.max.x, box.min.x);
    if (s.min.x >= box.max.x - 0.01) g.min.x = Math.max(g.min.x, box.max.x);
    if (s.max.z <= box.min.z + 0.01) g.max.z = Math.min(g.max.z, box.min.z);
    if (s.min.z >= box.max.z - 0.01) g.min.z = Math.max(g.min.z, box.max.z);
  }
  let evenCount = 0;
  for (const parity of [0, 1]) {
    slices(pos, idx, box.min.x, box.max.x, box.min.z, box.max.z, ys(box.max.y, parity));
    if (g) slices(pos, idx, g.min.x, g.max.x, g.min.z, g.max.z, ys(o.spill!.max.y, parity));
    if (parity === 0) evenCount = idx.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const drift = typeof o.drift === 'number' ? [o.drift, 0] : o.drift ?? [0.05, 0.01];
  const level = { value: 1 };
  const uniforms = litUniforms({
    tNoise: { value: noiseTexture() },
    uMin: { value: [box.min.clone(), (spill ?? box).min.clone()] },
    uMax: { value: [box.max.clone(), (spill ?? box).max.clone()] },
    uBoxes: { value: spill ? 2 : 1 },
    uColor: { value: new THREE.Color(o.color) },
    uDensity: { value: o.density },
    uHeight: { value: o.height ?? top - floor },
    uThick: { value: thick },
    uDrift: { value: new THREE.Vector2(drift[0], drift[1]) },
    uTime: { value: 0 },
    uJoin: { value: joinOf(box, o.spill) },
  });
  const mat = new THREE.ShaderMaterial({
    name: 'fx:fog', vertexShader: VERT, fragmentShader: FRAG, uniforms, lights: true, fog: true,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, premultipliedAlpha: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx:fog';
  mesh.renderOrder = 3;
  mesh.castShadow = mesh.receiveShadow = false;
  parent.add(mesh);

  // ── glints
  let glints: THREE.Points | null = null;
  let gmat: THREE.ShaderMaterial | null = null;
  if (o.glints) {
    const count = Math.min(GLINT_MAX, typeof o.glints === 'number' ? o.glints : o.glints.count);
    const gb = typeof o.glints === 'number'
      ? new THREE.Box3(new THREE.Vector3(box.min.x + FADE, floor + 0.1, box.min.z + FADE), new THREE.Vector3(box.max.x - FADE, floor + 2.6, box.max.z - FADE))
      : o.glints.box;
    const seeds = new Float32Array(count * 4);
    let seed = 4242;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    const ggeo = new THREE.BufferGeometry();
    ggeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    ggeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const size = gb.getSize(new THREE.Vector3());
    ggeo.boundingSphere = new THREE.Sphere(gb.getCenter(new THREE.Vector3()), size.length() * 0.5 + 0.5);
    gmat = new THREE.ShaderMaterial({
      name: 'fx:fog:glints', vertexShader: GLINT_VERT, fragmentShader: GLINT_FRAG, lights: true,
      uniforms: litUniforms({ uGMin: { value: gb.min.clone() }, uGSize: { value: size }, uTime: uniforms.uTime, uPx: { value: 900 }, uLevel: level }),
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, premultipliedAlpha: true,
    });
    glints = new THREE.Points(ggeo, gmat);
    glints.name = 'fx:fog:glints';
    glints.renderOrder = 4;
    parent.add(glints);
  }

  const base = o.density;
  let from = 1, to = 1, tw = 1, dur = 0;
  let time = 0;
  return {
    mesh, glints,
    get level() { return level.value; },
    setDensity(k, seconds = 2) {
      from = level.value; to = k;
      if (seconds <= 0) { tw = 1; level.value = k; } else { tw = 0; dur = seconds; }
    },
    remove() {
      parent.remove(mesh); geo.dispose(); mat.dispose();
      if (glints) { parent.remove(glints); glints.geometry.dispose(); gmat!.dispose(); }
    },
    update(dt) {
      time += dt;
      uniforms.uTime.value = time % 3600;
      if (tw < 1) { tw = Math.min(1, tw + dt / Math.max(dur, 1e-3)); level.value = from + (to - from) * tw * tw * (3 - 2 * tw); }
      uniforms.uDensity.value = base * level.value;
      // `lowHalf` on LOW: every other slice, each twice as thick (same optical depth, half the overdraw; bands show
      // more where slices cut vertical surfaces — off by default)
      const half = !!o.lowHalf && quality() === 'low';
      geo.setDrawRange(0, half ? evenCount : Infinity);
      uniforms.uThick.value = half ? thick * 2 : thick;
      if (gmat) gmat.uniforms.uPx.value = innerHeight;
    },
  };
}
