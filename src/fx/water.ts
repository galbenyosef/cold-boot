/**
 * Stage 3a §8.7 — falling water and the pool's light. Emissive-only (no light slot).
 *
 *   falls: a curved sheet (one draw call; lit `MeshStandardMaterial`, so it darkens with the lamps and reflects the
 *          probe) whose alpha is animated in the shader: strands scroll at their real falling speed (pattern in
 *          emission time), the sheet breaks up toward the foot; as `flow` drops columns dry up one by one until only
 *          drips are left (drops leave the lip at random intervals and stretch as they accelerate). Mist at the foot
 *          comes from the shared fx puffs (no draw call of its own), rate ∝ flow.
 *   pool:  one additive draw call for the light of the pool: an underwater glow on the surface with a caustic network,
 *          foam where the falls land, and caustic light reflected onto nearby surfaces (rim faces, the wall behind,
 *          any quads the level lists) fading with height above the water. With `flow` 0 the network freezes and
 *          flattens; `setGlow(0)` switches the pool light off (power loss).
 *   Both drive `material.userData.flow` of the level's `water` material when given (materials eases it over 1.5 s).
 */
import * as THREE from 'three';

export interface FallsOpts {
  /** Centre of the lip edge the water leaves from (world). */
  top: THREE.Vector3;
  /** Horizontal direction the water leaves the lip toward (it falls away from the wall along it). */
  dir: THREE.Vector3;
  width: number;
  /** Height of the drop to the surface below (m). */
  drop: number;
  /** Speed the water leaves the lip with (m/s; shapes the curve). Default 0.45. */
  speed?: number;
  /** Initial flow 0…1 (default 1). */
  flow?: number;
  /** The level's `water` material (pool): its `userData.flow` follows. */
  material?: THREE.Material;
}

export interface FallsHandle {
  readonly flow: number;
  setFlow(flow: number, seconds?: number): void;
  /** World point at the middle of the foot (where it lands). */
  readonly foot: THREE.Vector3;
  readonly mesh: THREE.Mesh;
  remove(): void;
  update(dt: number, cam: THREE.Vector3, mist: MistFn, qmul: number): void;
}

export interface PoolSurfaceQuad { position: THREE.Vector3; normal: THREE.Vector3; width: number; height: number }

export interface PoolOpts {
  /** Centre of the water surface (world; y = surface). */
  center: THREE.Vector3;
  /** Surface size x, z (m) — axis-aligned unless `yaw`. */
  size: [number, number];
  yaw?: number;
  /** Rim height above the water (m): its four inner faces get reflected caustics. 0 = none. Default 0.2. */
  rim?: number;
  /** Extra surfaces near the water that catch caustic light (wall behind the falls, a bench). Offset 4 mm off them. */
  caustics?: PoolSurfaceQuad[];
  /** Underwater light colour and HDR level. Default soft aqua 0x8fd8cc × 0.22. */
  color?: THREE.ColorRepresentation;
  intensity?: number;
  /** The falls landing in this pool (foam at its foot). */
  falls?: FallsHandle;
  material?: THREE.Material;
  flow?: number;
  glow?: number;
}

export interface PoolHandle {
  readonly flow: number;
  setFlow(flow: number, seconds?: number): void;
  /** Pool light 0…1 (power). */
  setGlow(level: number, seconds?: number): void;
  readonly mesh: THREE.Mesh;
  remove(): void;
  update(dt: number): void;
}

export type MistFn = (p: THREE.Vector3, v: THREE.Vector3, size: number, alpha: number) => void;

const NOISE = /* glsl */ `
float wHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y);
}
`;

// ───────────────────────────────────────────── falls

class Tween {
  v: number; private a: number; private b: number; private t = 1; private d = 0;
  constructor(v: number) { this.v = this.a = this.b = v; }
  to(b: number, s: number) { this.a = this.v; this.b = b; if (s <= 0) { this.v = b; this.t = 1; } else { this.t = 0; this.d = s; } }
  get target() { return this.b; }
  step(dt: number) { if (this.t < 1) { this.t = Math.min(1, this.t + dt / this.d); const k = this.t * this.t * (3 - 2 * this.t); this.v = this.a + (this.b - this.a) * k; } return this.v; }
}

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();

export function createFalls(o: FallsOpts, parent: THREE.Object3D): FallsHandle {
  const dir = o.dir.clone().setY(0).normalize();
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const v0 = o.speed ?? 0.45;
  const g = 9.81;
  const tFall = Math.sqrt((2 * o.drop) / g);
  const SEG = 14;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= SEG; j++) {
    const y01 = j / SEG;
    const t = tFall * Math.sqrt(y01); // equal height steps
    const out = v0 * t, down = 0.5 * g * t * t;
    for (let i = 0; i <= 1; i++) {
      _p.copy(o.top).addScaledVector(side, (i - 0.5) * o.width).addScaledVector(dir, out);
      _p.y -= Math.min(down, o.drop);
      pos.push(_p.x, _p.y, _p.z);
      uv.push(i, y01);
    }
  }
  for (let j = 0; j < SEG; j++) { const a = j * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const u = { uTime: { value: 0 }, uFlow: { value: 1 }, uDrip: { value: 0 }, uWidth: { value: o.width }, uDrop: { value: o.drop } };
  const mat = new THREE.MeshStandardMaterial({
    name: 'fx:falls', color: 0xf2f8fa, roughness: 0.12, metalness: 0, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, envMapIntensity: 1.4,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFall;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFall = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vFall;
uniform float uTime, uFlow, uDrip, uWidth, uDrop;
${NOISE}`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
  {
    float x = vFall.x * uWidth;
    float y = vFall.y;
    float tau = sqrt(2.0 * y * uDrop / 9.81);
    float te = uTime - tau;                         // emission time: the pattern travels with the water
    float n = wNoise(vec2(x * 34.0, te * 6.0)) * 0.6 + wNoise(vec2(x * 85.0 + 3.1, te * 13.0)) * 0.4;
    float cn = wHash(vec2(floor(x * 26.0), 7.0));   // strand columns dry up one by one as flow drops
    float cover = smoothstep(cn - 0.06, cn + 0.06, uFlow * 1.12);
    float a = cover * (0.32 + 0.68 * n * n * 1.4);
    a *= 1.0 - 0.85 * smoothstep(0.45, 1.0, y) * smoothstep(0.62, 0.25, n);   // breaks up toward the foot
    a *= smoothstep(0.0, 0.02, vFall.x) * smoothstep(1.0, 0.98, vFall.x);
    // drips: lanes, drops released at random intervals, stretched as they accelerate
    float lx = x * 9.0;
    float dh = wHash(vec2(floor(lx), 3.0));
    float lane = abs(fract(lx) - 0.5 - (dh - 0.5) * 0.6);
    float period = 0.7 + 2.6 * dh;
    float ph = fract(te / period + dh * 7.0);
    float drop = step(ph, 0.035) * smoothstep(0.06, 0.0, lane) * step(dh, 0.7);
    a = max(a, drop * uDrip * 0.9);
    a *= smoothstep(0.0, 0.01, uFlow + uDrip);
    diffuseColor.a *= clamp(a, 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95), smoothstep(0.82, 1.0, y) * uFlow * 0.5);
  }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    float sx = wNoise(vec2(vFall.x * uWidth * 34.0, (uTime - sqrt(2.0 * vFall.y * uDrop / 9.81)) * 6.0));
    normal = normalize(normal + vec3((sx - 0.5) * 0.9, 0.0, 0.0));
  }`);
  };
  mat.customProgramCacheKey = () => 'fx-falls';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx:falls';
  mesh.renderOrder = 2;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // the object sits at the foot so render's room occlusion judges it by its room
  const foot = new THREE.Vector3().copy(o.top).addScaledVector(dir, v0 * tFall);
  foot.y -= o.drop;
  mesh.position.copy(foot);
  geo.translate(-foot.x, -foot.y, -foot.z);
  geo.computeBoundingSphere();
  parent.add(mesh);

  const flow = new Tween(o.flow ?? 1);
  let time = 0, sinceDry = 0, mistAcc = 0;
  const setMat = (f: number) => { if (o.material) o.material.userData.flow = f; };
  setMat(flow.v);

  return {
    get flow() { return flow.target; },
    setFlow(f, seconds = 4) { flow.to(THREE.MathUtils.clamp(f, 0, 1), seconds); setMat(THREE.MathUtils.clamp(f, 0, 1)); },
    foot,
    mesh,
    remove() { parent.remove(mesh); geo.dispose(); mat.dispose(); },
    update(dt, cam, mist, qmul) {
      time += dt;
      const f = flow.step(dt);
      u.uTime.value = time % 1000;
      u.uFlow.value = f;
      // drips grow as the sheet dries, then slowly die down to a last few (20 s)
      if (f < 0.05) sinceDry += dt; else sinceDry = 0;
      const dripping = f < 0.6 ? Math.sin(Math.min(1, (0.6 - f) / 0.5) * Math.PI * 0.5) : 0;
      u.uDrip.value = dripping * (0.25 + 0.75 * Math.exp(-sinceDry / 20));
      // mist at the foot (shared puffs), within 28 m
      const dist = cam.distanceTo(foot);
      if (f > 0.02 && dist < 28) {
        mistAcc += dt * 9 * f * o.width * qmul;
        while (mistAcc >= 1) {
          mistAcc -= 1;
          _p.copy(foot).addScaledVector(side, (Math.random() - 0.5) * o.width * 0.95).addScaledVector(dir, Math.random() * 0.15);
          _p.y += 0.03;
          _v.copy(dir).multiplyScalar(0.12 + Math.random() * 0.2).addScaledVector(side, (Math.random() - 0.5) * 0.15);
          _v.y = 0.08 + Math.random() * 0.12;
          mist(_p, _v, 0.3 + 0.25 * f, 0.12 + 0.1 * f);
        }
      } else mistAcc = 0;
    },
  };
}

// ───────────────────────────────────────────── pool light

const POOL_VERT = /* glsl */ `
attribute float aKind;     // 0 water surface, 1 a surface catching reflected caustics
varying vec3 vW;
varying float vKind;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vKind = aKind;
  vUv = uv;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const POOL_FRAG = /* glsl */ `
varying vec3 vW;
varying float vKind;
varying vec2 vUv;
uniform float uPhase, uFlow, uGlow, uY, uTime;
uniform vec3 uCol;
uniform vec2 uHalf;
uniform vec3 uCenter;
uniform vec2 uAxis;         // cos, sin of yaw
uniform vec3 uFoot;         // falls foot (w = 0: none)
uniform float uFootOn, uFootW;
#include <fog_pars_fragment>
${NOISE}
float ridge(vec2 p) { return 1.0 - abs(wNoise(p) * 2.0 - 1.0); }
float caustic(vec2 p, float t) {
  vec2 q = p + vec2(sin(p.y * 1.3 + t * 0.9), cos(p.x * 1.1 - t * 0.7)) * 0.35;
  float a = ridge(q * 2.3 + vec2(t * 0.31, -t * 0.27));
  float b = ridge(q * 3.1 + vec2(-t * 0.23, t * 0.37) + 5.7);
  float c = pow(a, 7.0) + pow(b, 7.0) * 0.8;
  return c;
}
void main() {
  vec2 d = vW.xz - uCenter.xz;
  vec2 l = vec2(d.x * uAxis.x + d.y * uAxis.y, -d.x * uAxis.y + d.y * uAxis.x);   // pool-local
  // flow 0: the network freezes and loses contrast (no ripples to focus it)
  float c = caustic(l * 1.6, uPhase);
  float contrast = mix(0.12, 1.0, uFlow);
  vec3 col;
  if (vKind < 0.5) {
    vec2 e = 1.0 - abs(l) / uHalf;
    float edge = smoothstep(0.0, 0.25, min(e.x, e.y));
    float base = 0.35 + 0.65 * edge;
    col = uCol * uGlow * base * (0.35 + contrast * c * 1.1 + (1.0 - contrast) * 0.2);
    // foam where the falls land
    if (uFootOn > 0.5) {
      vec2 f = vW.xz - uFoot.xz;
      float r = length(f * vec2(1.0, 1.6)) / uFootW;
      float foam = smoothstep(1.0, 0.0, r) * (0.4 + 0.6 * wNoise(vW.xz * 14.0 + vec2(uTime * 0.7, -uTime * 0.5)));
      foam *= smoothstep(0.35, 0.7, wNoise(vW.xz * 6.0 - vec2(0.0, uTime * 0.4)) + 0.3);
      col += vec3(0.5, 0.55, 0.55) * foam * uFlow * (0.4 + 0.6 * uGlow) * 0.35;
    }
  } else {
    // reflected caustics on a nearby surface, fading with height above the water
    float h = max(vW.y - uY, 0.0);
    vec2 p = vec2(dot(vW.xz, vec2(0.7, 0.7)), vW.y * 1.5 - uPhase * 0.15);
    float k = caustic(p * 1.8 + l * 0.6, uPhase * 1.2);
    col = uCol * uGlow * exp(-h / 0.45) * (0.08 + contrast * k * 0.9) * 1.2;
    // soft edges of the quad
    col *= smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

export function createPool(o: PoolOpts, parent: THREE.Object3D): PoolHandle {
  const yaw = o.yaw ?? 0;
  const cx = Math.cos(yaw), sx = Math.sin(yaw);
  const hx = o.size[0] / 2, hz = o.size[1] / 2;
  const c = o.center;
  const pos: number[] = [], uv: number[] = [], kind: number[] = [], idx: number[] = [];
  const toW = (lx: number, lz: number, y: number) => [c.x + lx * cx + lz * sx, y, c.z - lx * sx + lz * cx];
  const addQuad = (a: number[], b: number[], cc: number[], d: number[], k: number) => {
    const i0 = pos.length / 3;
    for (const [p, t] of [[a, [0, 0]], [b, [1, 0]], [cc, [1, 1]], [d, [0, 1]]] as [number[], number[]][]) { pos.push(p[0], p[1], p[2]); uv.push(t[0], t[1]); kind.push(k); }
    idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  };
  const ys = c.y + 0.004;
  addQuad(toW(-hx, hz, ys), toW(hx, hz, ys), toW(hx, -hz, ys), toW(-hx, -hz, ys), 0);
  const rim = o.rim ?? 0.2;
  if (rim > 0) {
    const e = 0.004, y0 = c.y, y1 = c.y + rim;
    addQuad(toW(-hx, -hz + e, y0), toW(hx, -hz + e, y0), toW(hx, -hz + e, y1), toW(-hx, -hz + e, y1), 1);
    addQuad(toW(hx, hz - e, y0), toW(-hx, hz - e, y0), toW(-hx, hz - e, y1), toW(hx, hz - e, y1), 1);
    addQuad(toW(-hx + e, hz, y0), toW(-hx + e, -hz, y0), toW(-hx + e, -hz, y1), toW(-hx + e, hz, y1), 1);
    addQuad(toW(hx - e, -hz, y0), toW(hx - e, hz, y0), toW(hx - e, hz, y1), toW(hx - e, -hz, y1), 1);
  }
  for (const q of o.caustics ?? []) {
    const n = q.normal.clone().normalize();
    const up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const r = new THREE.Vector3().crossVectors(up, n).normalize();
    const v = new THREE.Vector3().crossVectors(n, r);
    const p0 = q.position.clone().addScaledVector(n, 0.004);
    const P = (a: number, b: number) => { const p = p0.clone().addScaledVector(r, a * q.width / 2).addScaledVector(v, b * q.height / 2); return [p.x, p.y, p.z]; };
    addQuad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  geo.setIndex(idx);
  const foot = o.falls?.foot;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uPhase: { value: 0 }, uFlow: { value: 1 }, uGlow: { value: 1 }, uY: { value: c.y }, uTime: { value: 0 },
    uCol: { value: new THREE.Color(o.color ?? 0x8fd8cc).multiplyScalar(o.intensity ?? 0.22) },
    uHalf: { value: new THREE.Vector2(hx, hz) }, uCenter: { value: c.clone() }, uAxis: { value: new THREE.Vector2(cx, sx) },
    uFoot: { value: foot ? foot.clone() : new THREE.Vector3() }, uFootOn: { value: foot ? 1 : 0 }, uFootW: { value: o.falls ? Math.max(0.4, (o.falls.mesh.geometry.boundingSphere?.radius ?? 1) * 0.9) : 1 },
  }]);
  const mat = new THREE.ShaderMaterial({
    name: 'fx:pool', vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, uniforms, fog: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx:pool';
  mesh.renderOrder = 1;
  mesh.position.copy(c);
  geo.translate(-c.x, -c.y, -c.z);
  geo.computeBoundingSphere();
  parent.add(mesh);

  const flow = new Tween(o.flow ?? 1);
  const glow = new Tween(o.glow ?? 1);
  const setMat = (f: number) => { if (o.material) o.material.userData.flow = f; };
  setMat(flow.v);
  let time = 0, phase = 0;
  return {
    get flow() { return flow.target; },
    setFlow(f, seconds = 4) { f = THREE.MathUtils.clamp(f, 0, 1); flow.to(f, seconds); setMat(f); },
    setGlow(l, seconds = 0.4) { glow.to(Math.max(0, l), seconds); },
    mesh,
    remove() { parent.remove(mesh); geo.dispose(); mat.dispose(); },
    update(dt) {
      time += dt;
      const f = flow.step(dt), gl = glow.step(dt);
      phase += dt * (0.15 + 0.85 * f) * f;
      const U = mat.uniforms;
      U.uPhase.value = phase % 1000;
      U.uFlow.value = f;
      U.uGlow.value = gl;
      U.uTime.value = time % 1000;
      mesh.visible = gl > 0.002;
    },
  };
}
