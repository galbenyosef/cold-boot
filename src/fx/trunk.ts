/**
 * Stage 3d §8.6 (W6) — water fx for the trunk (level 6), reached as `ctx.fx as FxSystemEx`:
 *
 *   wake(p, r)       pooled ring ripples (≤ 24, ONE additive draw call) on the registered water surface under `p`
 *                    (`ctx.level.water`); nothing where there is no water at the point. Lit by the real light pool at
 *                    the ring (floods, flashlight): in the dark they are not seen, as real ripples.
 *   splash(p, size)  a pooled burst — droplets, a fast ring (+ a second for size ≥ 1), foam, and a spray column for
 *                    heavy things (size ≥ 1.5: the grab, a container) — from the shared fx particle pools (as bullet
 *                    impacts: no draw call of its own). Sizes: a round 0.3, a step 0.5, a body 1.2, the grab / a
 *                    container 2.5 … 3. Bullet impacts on `water` surfaces get one automatically (fx/index.ts); a
 *                    second call for the same point within 0.06 s is merged (the weapon module may call it too).
 *   waterFx(o)       the ring set's registry entry (D23): id / rooms / seenFrom. Without it the rings register on the
 *                    first frame with water as `water:wake`, rooms = the rooms of `level.water`.
 *   spray(o)         the hydraulic spray at a hit jaw ram (§2.9 `fx6_spray`): its own bounded particle set (2 calls
 *                    while alive) whose 3 m box follows the emitter (`set(point, dir)`); registered.
 * `well(o)` (the moon pool's well, well.ts) is wired in fx/index.ts beside the habitat effects.
 */
import * as THREE from 'three';
import type { GameContext, WaterVolume } from '../core/types';
import { FOG_FRAG, FX_LIGHT, litUniforms } from './shaders';
import type { Streaks } from './streaks';
import { ST, Streaks as StreaksClass } from './streaks';
import type { Puffs } from './puffs';
import { Puffs as PuffsClass, SHAPE } from './puffs';
import type { FxVolume, FxVolumeSpec } from './volumes';

export interface WaterFxOpts {
  /** Registry id of the ring set (default 'water:wake'). */
  id?: string;
  /** Rooms the rings are drawn for (default: the rooms of `level.water`). */
  rooms?: readonly string[];
  seenFrom?: readonly string[];
}

export interface SprayOpts {
  point: THREE.Vector3;
  /** Jet direction (default up). */
  dir?: THREE.Vector3;
  /** Strength 0 … 1.5 (default 1): rate and speed. */
  rate?: number;
  rooms: readonly string[];
  id?: string;
  seenFrom?: readonly string[];
}

export interface SprayHandle {
  enabled: boolean;
  rate: number;
  /** Move the emitter (it rides on the grab): its box moves along. */
  set(point: THREE.Vector3, dir?: THREE.Vector3): void;
  /** Stop and unregister (live particles die with the set). */
  remove(): void;
}

export interface FxTrunk {
  wake(p: THREE.Vector3, r?: number): void;
  splash(p: THREE.Vector3, size?: number): void;
  waterFx(o: WaterFxOpts): void;
  spray(o: SprayOpts): SprayHandle;
}

export interface TrunkDeps {
  ctx: GameContext;
  root: THREE.Object3D;
  streaks: Streaks;
  puffs: Puffs;
  atlas: THREE.Texture;
  pixelScale: THREE.IUniform<number>;
  resetStreak(type: number): void;
  resetPuff(shape: number): void;
  register(spec: FxVolumeSpec): FxVolume;
  qmul(): number;
}

const RINGS = 24;

const RING_VERT = /* glsl */ `
#include <common>
#include <lights_pars_begin>
${FX_LIGHT}
attribute vec4 aRing;   // centre xyz, start time
attribute vec4 aParm;   // max radius, life, strength, kind (0 wake, 1 splash)
uniform float uTime;
varying vec2 vQ;
varying vec4 vP;
varying vec3 vLight;
varying float vDepth;
void main() {
  float age = uTime - aRing.w;
  float life = aParm.y;
  if (age < 0.0 || age > life || aParm.x <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vQ = vec2(0.0); vP = vec4(0.0); vLight = vec3(0.0); vDepth = 0.0; return; }
  float u = age / life;
  // radius: fast at first, slowing (a real ripple's group spreading out)
  float r = aParm.x * (1.0 - pow(1.0 - u, 2.2)) + 0.05;
  float ext = r + 0.12 + 0.1 * aParm.x * u;
  vec3 w = aRing.xyz + vec3(position.x * ext, 0.0, position.y * ext);
  vQ = position.xy * ext;
  vP = vec4(r, u, aParm.z, aParm.w);
  vec4 mvc = viewMatrix * vec4(aRing.xyz, 1.0);
  vec3 ld;
  vLight = fxLight(mvc.xyz, 0.0, ld) * RECIPROCAL_PI;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const RING_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${FOG_FRAG}
varying vec2 vQ;
varying vec4 vP;
varying vec3 vLight;
varying float vDepth;
void main() {
  float d = length(vQ);
  float r = vP.x, u = vP.y;
  float w = 0.014 + 0.035 * u + 0.02 * vP.w;
  // the crest and, behind it, a weaker second ring (the wave train)
  float crest = exp(-pow((d - r) / w, 2.0));
  float train = exp(-pow((d - r * 0.62) / (w * 1.3), 2.0)) * 0.45;
  float inner = vP.w > 0.5 ? smoothstep(r * 0.5, 0.0, d) * 0.25 * (1.0 - u) : 0.0;   // a splash's churned centre
  float k = (crest + train + inner) * pow(1.0 - u, 2.0) * vP.z;
  if (k < 0.002) discard;
  // a ripple shows only by the light it catches: the lamps' sheen on the slope of the crest
  vec3 col = (vLight * 0.45 + vec3(0.002, 0.0025, 0.003)) * k;
  col *= 1.0 - fxFog(vDepth);
  gl_FragColor = vec4(col, 1.0);
}
`;

const r = (a: number, b: number) => a + (b - a) * Math.random();
const _p = new THREE.Vector3();

export function createTrunkFx(d: TrunkDeps): FxTrunk & { update(dt: number, cam: THREE.Camera): void; readonly count: number } {
  const { ctx } = d;
  // ── rings
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const aRing = new THREE.InstancedBufferAttribute(new Float32Array(RINGS * 4), 4);
  const aParm = new THREE.InstancedBufferAttribute(new Float32Array(RINGS * 4), 4);
  aRing.setUsage(THREE.DynamicDrawUsage);
  aParm.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aRing', aRing);
  geo.setAttribute('aParm', aParm);
  geo.instanceCount = RINGS;
  const uTime = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    name: 'fx:wake',
    vertexShader: RING_VERT, fragmentShader: RING_FRAG,
    uniforms: litUniforms({ uTime }),
    lights: true, fog: true, side: THREE.DoubleSide,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  const rings = new THREE.Mesh(geo, mat);
  rings.name = 'fx:wake';
  rings.frustumCulled = false;
  rings.renderOrder = 4;
  rings.visible = false;
  d.root.add(rings);
  let next = 0, live = 0, lastEnd = -1;
  let clock = 0;

  let cfg: WaterFxOpts = {};
  let reg: FxVolume | null = null;
  const ensureReg = () => {
    if (reg) return;
    const water = ctx.level?.water;
    if (!water?.length && !cfg.rooms) return;
    const rooms = cfg.rooms ?? [...new Set((water ?? []).map((w) => w.room))];
    reg = d.register({ id: cfg.id ?? 'water:wake', object: rings, rooms, seenFrom: cfg.seenFrom });
  };

  const waterAt = (p: THREE.Vector3, above: number): WaterVolume | null => {
    const water = ctx.level?.water;
    if (!water) return null;
    for (const w of water) {
      const b = w.box;
      if (p.x < b.min.x || p.x > b.max.x || p.z < b.min.z || p.z > b.max.z) continue;
      if (p.y < b.min.y - 0.05 || p.y > w.surface + above) continue;
      return w;
    }
    return null;
  };

  const ring = (x: number, y: number, z: number, rMax: number, life: number, strength: number, kind: number) => {
    const i = next;
    next = (next + 1) % RINGS;
    aRing.setXYZW(i, x, y, z, clock);
    aParm.setXYZW(i, rMax, life, strength, kind);
    aRing.needsUpdate = true;
    aParm.needsUpdate = true;
    live = RINGS;
    lastEnd = Math.max(lastEnd, clock + life);
    rings.visible = true;
  };

  // splash de-duplication (bullet:impact + the weapon module's own call)
  const recent: { x: number; y: number; z: number; t: number }[] = [];
  const merged = (p: THREE.Vector3) => {
    for (let i = recent.length - 1; i >= 0; i--) {
      const e = recent[i];
      if (clock - e.t > 0.06) { recent.splice(i, 1); continue; }
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 + (e.z - p.z) ** 2 < 0.0625) return true;
    }
    recent.push({ x: p.x, y: p.y, z: p.z, t: clock });
    if (recent.length > 16) recent.shift();
    return false;
  };

  // ── sprays
  interface Spray { h: SprayHandle; pos: THREE.Vector3; dir: THREE.Vector3; t1: THREE.Vector3; t2: THREE.Vector3; box: THREE.Box3; puffs: Puffs; streaks: Streaks; group: THREE.Group; reg: FxVolume; acc: number; t: number; dead: boolean }
  const sprays: Spray[] = [];
  let nSpray = 0;
  const frameOf = (s: Spray) => {
    s.t1.set(0, 1, 0);
    if (Math.abs(s.dir.y) > 0.9) s.t1.set(1, 0, 0);
    s.t1.cross(s.dir).normalize();
    s.t2.crossVectors(s.dir, s.t1);
  };

  const api = {
    get count() { return live ? RINGS : 0; },

    wake(p: THREE.Vector3, rad = 0.5) {
      const w = waterAt(p, -0.02);
      if (!w) return;
      ring(p.x, w.surface + 0.004, p.z, Math.max(0.15, rad) * 2.2, 1.5 + rad, 1, 0);
    },

    splash(p: THREE.Vector3, size = 0.5) {
      if (merged(p)) return;
      const w = waterAt(p, 0.6);
      const y = w ? w.surface : p.y;
      const s = Math.max(0.1, size);
      const q = Math.min(1, d.qmul() + 0.25);
      ring(p.x, y + 0.004, p.z, 0.35 + s * 1.1, 0.9 + s * 0.5, 1.6, 1);
      if (s >= 1) ring(p.x, y + 0.004, p.z, 0.6 + s * 2.0, 1.6 + s * 0.6, 1.0, 1);
      const plane = d.streaks.planes.add(0, 1, 0, p.x, y, p.z);
      const S = d.streaks.s;
      const n = Math.max(6, Math.round((10 + s * 45) * q));
      for (let i = 0; i < n; i++) {
        d.resetStreak(i % 5 === 0 ? ST.DROP : ST.SPLASH);
        const a = Math.random() * Math.PI * 2, lat = r(0.2, 1.0) * (0.6 + s * 0.6);
        S.px = p.x + Math.cos(a) * 0.05 * s; S.py = y + 0.02; S.pz = p.z + Math.sin(a) * 0.05 * s;
        S.vx = Math.cos(a) * lat; S.vy = r(1.4, 2.8) * (0.7 + s * 0.6); S.vz = Math.sin(a) * lat;
        S.life = r(0.8, 1.5); S.size = r(0.003, 0.006) * (0.8 + s * 0.3);
        S.r = 0.7; S.g = 0.78; S.b = 0.82; S.alpha = 0.9; S.drag = 0.35; S.rest = 0.1;
        S.planeA = plane;
        d.streaks.spawn();
      }
      // foam: low, wide, short — and for heavy things a spray column that hangs and falls back
      const P = d.puffs.s;
      const nf = Math.max(2, Math.round((2 + s * 4) * q));
      for (let i = 0; i < nf; i++) {
        d.resetPuff(SHAPE.SMOKE);
        const a = Math.random() * Math.PI * 2, sp = r(0.2, 0.8) * s;
        P.px = p.x + Math.cos(a) * 0.1 * s; P.py = y + 0.05; P.pz = p.z + Math.sin(a) * 0.1 * s;
        P.vx = Math.cos(a) * sp; P.vy = r(0.05, 0.3); P.vz = Math.sin(a) * sp;
        P.life = r(0.7, 1.4) * (0.8 + s * 0.3); P.s0 = 0.08 * s + 0.04; P.s1 = 0.4 * s + 0.2; P.grow = 1.6;
        P.alpha = r(0.1, 0.18); P.drag = 2.5; P.buoy = 0; P.fadePow = 1.8; P.fadeIn = 0.03;
        P.r = 0.72; P.g = 0.78; P.b = 0.8; P.phase = 0.5;
        d.puffs.spawn();
      }
      if (s >= 1.5) {
        const nc = Math.max(4, Math.round(s * 5 * q));
        for (let i = 0; i < nc; i++) {
          d.resetPuff(SHAPE.SMOKE);
          const a = Math.random() * Math.PI * 2;
          P.px = p.x + Math.cos(a) * 0.3 * s; P.py = y + 0.2; P.pz = p.z + Math.sin(a) * 0.3 * s;
          P.vx = Math.cos(a) * r(0.3, 1.0); P.vy = r(2.5, 5.0) * Math.sqrt(s); P.vz = Math.sin(a) * r(0.3, 1.0);
          P.life = r(0.6, 1.0); P.s0 = 0.15 * s; P.s1 = 0.45 * s; P.grow = 1.2; P.delay = r(0, 0.08);
          P.alpha = r(0.1, 0.16); P.drag = 1.6; P.buoy = -1.2; P.fadePow = 2.2; P.fadeIn = 0.03;
          P.r = 0.74; P.g = 0.8; P.b = 0.83; P.phase = 0.5;
          d.puffs.spawn();
        }
      }
    },

    waterFx(o: WaterFxOpts) {
      cfg = { ...o };
      if (reg) { reg.remove(); reg = null; }
      ensureReg();
    },

    spray(o: SprayOpts): SprayHandle {
      const group = new THREE.Group();
      group.name = `fx:spray:${o.id ?? ++nSpray}`;
      const box = new THREE.Box3().setFromCenterAndSize(o.point, new THREE.Vector3(6, 6, 6));
      const puffs = new PuffsClass(256, d.atlas, d.streaks.planes);
      const streaks = new StreaksClass(384, d.pixelScale);
      puffs.bounds = box; streaks.bounds = box;
      streaks.gravity = d.streaks.gravity;
      group.add(puffs.mesh, streaks.mesh);
      group.userData.fxCenter = o.point.clone();
      d.root.add(group);
      const sp: Spray = {
        h: null as unknown as SprayHandle,
        pos: o.point.clone(), dir: (o.dir ?? new THREE.Vector3(0, 1, 0)).clone().normalize(),
        t1: new THREE.Vector3(), t2: new THREE.Vector3(), box, puffs, streaks, group,
        reg: d.register({ id: o.id ?? `spray#${nSpray}`, object: group, rooms: o.rooms, seenFrom: o.seenFrom }),
        acc: 0, t: Math.random() * 10, dead: false,
      };
      frameOf(sp);
      sp.h = {
        enabled: true,
        rate: o.rate ?? 1,
        set(point, dir) {
          sp.pos.copy(point);
          if (dir && dir.lengthSq() > 1e-8) { sp.dir.copy(dir).normalize(); frameOf(sp); }
          box.setFromCenterAndSize(point, _p.set(6, 6, 6));
          (group.userData.fxCenter as THREE.Vector3).copy(point);
        },
        remove() {
          if (sp.dead) return;
          sp.dead = true;
          sp.reg.remove();
          d.root.remove(group);
          puffs.mesh.geometry.dispose(); streaks.mesh.geometry.dispose();
        },
      };
      sprays.push(sp);
      return sp.h;
    },

    update(dt: number, cam: THREE.Camera) {
      clock += dt;
      uTime.value = clock;
      ensureReg();
      if (live && clock > lastEnd) { live = 0; rings.visible = false; }
      for (let i = sprays.length - 1; i >= 0; i--) {
        const s = sprays[i];
        if (s.dead) { sprays.splice(i, 1); continue; }
        s.t += dt;
        if (s.h.enabled && dt > 0) {
          // a leaking ram: pulsing spurts (the pump's strokes), a fine mist and dark fluid
          const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(s.t * 9.0) * Math.sin(s.t * 2.3 + 1.0));
          s.acc += dt * 90 * s.h.rate * pulse * Math.min(1, d.qmul() + 0.3);
          const S = d.streaks.s, P = d.puffs.s;
          while (s.acc >= 1) {
            s.acc -= 1;
            d.resetStreak(ST.OIL);
            const sp = r(5, 9) * Math.min(1.5, s.h.rate), th = r(0, 0.22), ph = r(0, Math.PI * 2);
            _p.copy(s.dir).multiplyScalar(Math.cos(th)).addScaledVector(s.t1, Math.cos(ph) * Math.sin(th)).addScaledVector(s.t2, Math.sin(ph) * Math.sin(th));
            S.px = s.pos.x; S.py = s.pos.y; S.pz = s.pos.z;
            S.vx = _p.x * sp; S.vy = _p.y * sp; S.vz = _p.z * sp;
            S.life = r(0.4, 0.8); S.size = r(0.0025, 0.005);
            S.r = 0.09; S.g = 0.06; S.b = 0.025; S.alpha = 0.95; S.drag = 1.4; S.rest = 0.2;
            s.streaks.spawn(S);
            if (Math.random() < 0.3) {
              d.resetPuff(SHAPE.SMOKE);
              P.px = s.pos.x + _p.x * 0.15; P.py = s.pos.y + _p.y * 0.15; P.pz = s.pos.z + _p.z * 0.15;
              P.vx = _p.x * sp * 0.4; P.vy = _p.y * sp * 0.4; P.vz = _p.z * sp * 0.4;
              P.life = r(0.5, 1.0); P.s0 = 0.04; P.s1 = r(0.35, 0.6); P.grow = 2.0;
              P.alpha = r(0.12, 0.22); P.drag = 3.5; P.buoy = 0.05; P.fadePow = 1.4; P.fadeIn = 0.02;
              P.r = 0.55; P.g = 0.5; P.b = 0.4; P.phase = 0.4;
              s.puffs.spawn(P);
            }
          }
        }
        s.streaks.update(dt);
        s.puffs.update(dt, cam);
      }
    },
  };
  return api;
}
