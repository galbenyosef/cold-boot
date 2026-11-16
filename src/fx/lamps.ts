/**
 * Stage 3a §8.7 — daylight lamp grid: large soft emissive ceiling panels (one instanced draw call, no light slot),
 * plus whatever real lights / emissive fixtures the level hands over, all driven row by row from one call.
 *
 * States per panel: 'day' (warm evening daylight) → 'flicker' (stuttering) → 'dead' (off) → 'emergency' (a sparse
 * subset glows dim and cold). `setState(s, { wave, flicker })` sweeps the grid row by row along `rowDir`: each row
 * stutters for `flicker` seconds and then settles, rows staggered over `wave` seconds.
 *
 * Linked lights (`lights`): the grid owns their `intensityScale` (= the mean level of their row, flicker included).
 * Linked emergency lights (`emergencyLights`): enabled when their row reaches 'emergency', disabled otherwise.
 * Fixtures (`addFixture`): any emissive material of the habitat joins the wave by its position (its
 * `emissiveIntensity` is owned by the grid — do not also `bindEmissive` it to a light).
 */
import * as THREE from 'three';
import type { LightHandle } from '../core/types';

export type LampState = 'day' | 'flicker' | 'dead' | 'emergency';

export interface LampGridOpts {
  /** Centre of the panel plane (world). Panels face down. */
  center: THREE.Vector3;
  cols: number;
  rows: number;
  /** Centre-to-centre spacing along x (cols) and z (rows), metres. */
  pitch: [number, number];
  /** Panel size (x, z), metres. */
  panel: [number, number];
  /** Wave direction across the rows (world, horizontal). Default (0, 0, −1): from +z (north) to −z (south). */
  rowDir?: THREE.Vector3;
  /** Daylight colour and HDR emissive level. Default warm evening 0xffd2a0 × 3.2. */
  color?: THREE.ColorRepresentation;
  intensity?: number;
  /** Emergency colour / level and which panels glow (default every 4th, staggered). */
  emergencyColor?: THREE.ColorRepresentation;
  emergencyIntensity?: number;
  emergencyEvery?: number;
  /** Real lights that follow the panels (the atrium key spots and fills). */
  lights?: LightHandle[];
  /** Emergency lights switched on with their row's 'emergency' state. */
  emergencyLights?: LightHandle[];
  /** Initial state (default 'day'). */
  state?: LampState;
}

export interface LampSetOpts {
  /** Seconds for the sweep from the first row to the last (default 0 = all at once). */
  wave?: number;
  /** Seconds each row stutters before it settles (default 0.6 when going dark, else 0). */
  flicker?: number;
  /** Delay before the sweep starts (s). */
  delay?: number;
  /** Sweep from the last row instead of the first. */
  reverse?: boolean;
}

export interface LampGridHandle {
  readonly mesh: THREE.InstancedMesh;
  readonly rows: number;
  /** Row-by-row transition (see header). */
  setState(state: LampState, o?: LampSetOpts): void;
  /** One row now (0 = first along rowDir). */
  setRow(row: number, state: LampState, flicker?: number): void;
  /** State a row is in / heading to. */
  rowState(row: number): LampState;
  /** Join an emissive material to the wave (by its world position). `base` = its daylight emissiveIntensity. */
  addFixture(material: THREE.MeshStandardMaterial, position: THREE.Vector3, base?: number, emergency?: number): void;
  addLight(light: LightHandle, emergency?: boolean): void;
  /** Row index for a world position (clamped). */
  rowOf(p: THREE.Vector3): number;
  remove(): void;
  update(dt: number): void;
}

const VERT = /* glsl */ `
attribute vec4 aLamp;      // rgb = emission (linear HDR), a = diffuser lit 0..1
varying vec2 vUv;
varying vec4 vLamp;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vLamp = aLamp;
  vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vLamp;
uniform vec3 uFrame;
uniform vec2 uSize;
#include <fog_pars_fragment>
void main() {
  // distance to the panel edge in metres
  vec2 m = min(vUv, 1.0 - vUv) * uSize;
  float e = min(m.x, m.y);
  float frame = step(e, 0.05);
  // diffuser: a soft pillow (bright centre falls off toward the frame), a faint 4 × 4 cell grid of the luminaire
  vec2 c = (vUv - 0.5) * 2.0;
  float pillow = 1.0 - 0.28 * dot(c, c);
  vec2 cell = abs(fract(vUv * 4.0) - 0.5);
  float grid = 1.0 - 0.12 * smoothstep(0.47, 0.5, max(cell.x, cell.y));
  float inner = smoothstep(0.05, 0.16, e);
  vec3 col = vLamp.rgb * pillow * grid * mix(0.55, 1.0, inner);
  // unlit body (dead panel / frame): very dark warm grey diffuser, aluminium frame
  vec3 body = mix(vec3(0.010, 0.010, 0.011), uFrame, frame);
  gl_FragColor = vec4(mix(col, vec3(0.0), frame) + body, 1.0);
  #include <fog_fragment>
}
`;

interface Row {
  state: LampState;
  /** pending transitions in time order: stutter from `from`, settle into `state` at `at` */
  queue: { state: LampState; from: number; at: number }[];
}
interface Panel { row: number; col: number; level: number; target: number; seed: number; emerg: boolean; stut: number; stutT: number }
interface Fixture { mat: THREE.MeshStandardMaterial; row: number; base: number; emerg: number }

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2); // plane faces −y

export function createLampGrid(o: LampGridOpts, parent: THREE.Object3D): LampGridHandle {
  const rowDir = (o.rowDir ?? new THREE.Vector3(0, 0, -1)).clone().setY(0).normalize();
  const colDir = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), rowDir).normalize();
  const n = o.cols * o.rows;
  const dayCol = new THREE.Color(o.color ?? 0xffd2a0).multiplyScalar(o.intensity ?? 3.2);
  const emCol = new THREE.Color(o.emergencyColor ?? 0xc8e0ff).multiplyScalar(o.emergencyIntensity ?? 0.55);
  const every = Math.max(1, o.emergencyEvery ?? 4);

  const geo = new THREE.PlaneGeometry(o.panel[0], o.panel[1]);
  const lamp = new Float32Array(n * 4);
  const lampAttr = new THREE.InstancedBufferAttribute(lamp, 4);
  lampAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aLamp', lampAttr);
  const mat = new THREE.ShaderMaterial({
    name: 'fx:lampgrid',
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uFrame: { value: new THREE.Color(0.06, 0.06, 0.065) }, uSize: { value: new THREE.Vector2(o.panel[0], o.panel[1]) } }]),
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = 'fx:lampgrid';
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  // rows are along rowDir: row 0 is the most "behind" (smallest projection), so the wave runs along rowDir.
  // Panels are laid out on world x/z; row index from their projection on rowDir.
  const panels: Panel[] = [];
  const p = new THREE.Vector3();
  const rowsAlongX = Math.abs(rowDir.x) > Math.abs(rowDir.z);
  const rowPitch = rowsAlongX ? o.pitch[0] : o.pitch[1];
  const nRows = rowsAlongX ? o.cols : o.rows;
  let k = 0;
  for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
    p.set(o.center.x + (c - (o.cols - 1) / 2) * o.pitch[0], o.center.y, o.center.z + (r - (o.rows - 1) / 2) * o.pitch[1]);
    _m.compose(p, _q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(k, _m);
    panels.push({ row: 0, col: 0, level: 1, target: 1, seed: Math.random() * 1000, emerg: false, stut: 1, stutT: 0 });
    const proj = (p.x - o.center.x) * rowDir.x + (p.z - o.center.z) * rowDir.z;
    const row = Math.round(proj / rowPitch + (nRows - 1) / 2);
    panels[k].row = THREE.MathUtils.clamp(row, 0, nRows - 1);
    const cproj = (p.x - o.center.x) * colDir.x + (p.z - o.center.z) * colDir.z;
    panels[k].col = Math.round(cproj / (rowsAlongX ? o.pitch[1] : o.pitch[0]));
    k++;
  }
  for (const pn of panels) pn.emerg = ((pn.col + pn.row * 2) % every + every) % every === 0;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  parent.add(mesh);

  const rowOf = (q: THREE.Vector3) => {
    const proj = (q.x - o.center.x) * rowDir.x + (q.z - o.center.z) * rowDir.z;
    return THREE.MathUtils.clamp(Math.round(proj / rowPitch + (nRows - 1) / 2), 0, nRows - 1);
  };

  const init = o.state ?? 'day';
  const rows: Row[] = Array.from({ length: nRows }, () => ({ state: init, queue: [] }));
  const lights: { h: LightHandle; row: number }[] = [];
  const emLights: { h: LightHandle; row: number }[] = [];
  const fixtures: Fixture[] = [];
  const rowLevel = new Float32Array(nRows);
  const rowEm = new Float32Array(nRows);
  const cnt = new Float32Array(nRows);
  let time = 0;

  const flickerOf = (s: LampState, f?: number) => f ?? (s === 'dead' || s === 'emergency' ? 0.6 : 0);

  /** Row `row` stutters from `at` for `flicker` s, then settles into `s`. */
  function schedule(row: number, s: LampState, at: number, flicker: number) {
    const R = rows[row];
    // a later call replaces whatever was scheduled from its start time on; earlier steps still run
    R.queue = R.queue.filter((x) => x.from < at);
    R.queue.push({ state: s, from: at, at: at + flicker });
  }

  const handle: LampGridHandle = {
    mesh,
    rows: nRows,
    setState(s, so = {}) {
      const wave = so.wave ?? 0, delay = so.delay ?? 0, fl = flickerOf(s, so.flicker);
      for (let r = 0; r < nRows; r++) {
        const i = so.reverse ? nRows - 1 - r : r;
        const at = time + delay + (nRows > 1 ? (r / (nRows - 1)) * wave : 0);
        schedule(i, s, at, s === 'flicker' ? 0 : fl);
      }
    },
    setRow(row, s, flicker) { schedule(THREE.MathUtils.clamp(row, 0, nRows - 1), s, time, s === 'flicker' ? 0 : flickerOf(s, flicker)); },
    rowState(row) { const R = rows[row]; return R.queue.length ? R.queue[R.queue.length - 1].state : R.state; },
    addFixture(material, position, base, emergency = 0) {
      fixtures.push({ mat: material, row: rowOf(position), base: base ?? material.emissiveIntensity, emerg: emergency });
    },
    addLight(h, emergency = false) {
      (emergency ? emLights : lights).push({ h, row: rowOf(h.position) });
    },
    rowOf,
    remove() {
      parent.remove(mesh);
      geo.dispose(); mat.dispose();
    },
    update(dt) {
      time += dt;
      // rows: apply due transitions; compute each row's mean level (for lights / fixtures)
      for (let r = 0; r < nRows; r++) {
        const R = rows[r];
        while (R.queue.length && time >= R.queue[0].at) R.state = R.queue.shift()!.state;
      }
      rowLevel.fill(0); rowEm.fill(0); cnt.fill(0);
      for (let i = 0; i < n; i++) {
        const pn = panels[i];
        const R = rows[pn.row];
        const stuttering = R.state === 'flicker' || (R.queue.length > 0 && time >= R.queue[0].from && time < R.queue[0].at);
        const settled = R.state;
        let target = settled === 'day' ? 1 : 0;
        let em = settled === 'emergency' && pn.emerg ? 1 : 0;
        if (stuttering) {
          // fluorescent-style stutter: random hold times 30–220 ms, mostly on with deep drops (driver failing)
          pn.stutT -= dt;
          if (pn.stutT <= 0) {
            const x = Math.random();
            pn.stut = x < 0.45 ? 1 : x < 0.75 ? 0.05 : x < 0.9 ? 0.45 : 1.25;
            pn.stutT = 0.03 + Math.random() * 0.19;
          }
          target = pn.stut;
          em = 0;
        }
        // LED panels: fast on/off (no thermal glow); a short decay tail so a drop reads
        const rate = target > pn.level ? 40 : 18;
        pn.level += (target - pn.level) * Math.min(1, dt * rate);
        const emv = em;
        lamp[i * 4 + 0] = dayCol.r * pn.level + emCol.r * emv;
        lamp[i * 4 + 1] = dayCol.g * pn.level + emCol.g * emv;
        lamp[i * 4 + 2] = dayCol.b * pn.level + emCol.b * emv;
        lamp[i * 4 + 3] = pn.level;
        rowLevel[pn.row] += pn.level;
        rowEm[pn.row] = Math.max(rowEm[pn.row], settled === 'emergency' ? 1 : 0);
        cnt[pn.row]++;
      }
      for (let r = 0; r < nRows; r++) if (cnt[r]) rowLevel[r] /= cnt[r];
      lampAttr.needsUpdate = true;
      for (const l of lights) l.h.intensityScale = rowLevel[l.row];
      for (const l of emLights) l.h.enabled = rowEm[l.row] > 0;
      for (const f of fixtures) f.mat.emissiveIntensity = f.base * rowLevel[f.row] + f.emerg * rowEm[f.row];
    },
  };
  // initial state immediately
  for (let r = 0; r < nRows; r++) rows[r].state = init;
  for (const pn of panels) pn.level = init === 'day' ? 1 : 0;
  for (const l of o.lights ?? []) handle.addLight(l);
  for (const l of o.emergencyLights ?? []) handle.addLight(l, true);
  handle.update(0);
  return handle;
}
