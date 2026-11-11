/**
 * Isolated viewmodel harness (dev/player.html). Neutral studio lighting + env map (harness only).
 *   ?view=grid&model=pistol|shotgun|hand|lhand|mag|shell|casing   — 4 inspection angles
 *   ?view=one&model=..&yaw=30&pitch=10&dist=0.4                    — single orbit view
 *   ?view=fp&weapon=pistol|shotgun[&clip=reload|fire|...&t=0.5]   — first-person framing via the real rig
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext, MaterialLibrary } from '../../core/types';
import { resolveMats, type VmMats } from '../viewmodels/mats';
import { setVmLight } from '../viewmodels/vmlight';
import { buildPistol, buildMagazine } from '../viewmodels/pistol';
import { Hand, Forearm, POSES } from '../viewmodels/hands';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(q.get('exposure') ?? 1);
const debug = { fps: 0 };
(window as any).__game = { ready: false, renderer, debug };

const scene = new THREE.Scene();
scene.background = new THREE.Color(q.get('bg') ? Number('0x' + q.get('bg')) : 0x2a2d30);
const pmrem = new THREE.PMREMGenerator(renderer);
const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = env;
scene.environmentIntensity = Number(q.get('env') ?? 0.7);
const key = new THREE.DirectionalLight(0xfff4e8, Number(q.get('key') ?? 2.2));
key.position.set(-1, 2, 1.5);
scene.add(key);
const rim = new THREE.DirectionalLight(0xbfd8ff, 1.2);
rim.position.set(1.5, 0.6, -1.5);
scene.add(rim);

function fallbackLib(): MaterialLibrary {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const C: Record<string, number> = { gunmetal: 0x23262a, chrome: 0xd0d4d8, steel_raw: 0x7c8085, brass: 0xb59a48, copper: 0xa5633a, rubber: 0x111111, plastic_dark: 0x1a1b1d, plastic_white: 0xd8d8d2, fabric: 0x4a5560, painted_white: 0xcfd2d0 };
  const E: Record<string, number> = { emissive_white: 0xe8f2ff, emissive_red: 0xff2010, emissive_amber: 0xff9a20, emissive_cyan: 0x30e0ff, emissive_green: 0x40ff70, emissive_warm: 0xffd9a0 };
  const get = (n: string) => {
    let m = cache.get(n);
    if (!m) {
      const metal = /steel|chrome|gunmetal|brass|copper/.test(n);
      m = n in E ? new THREE.MeshStandardMaterial({ color: 0, emissive: E[n], emissiveIntensity: 2 })
        : new THREE.MeshStandardMaterial({ color: C[n] ?? 0xff00ff, roughness: metal ? 0.38 : 0.8, metalness: metal ? 1 : 0 });
      cache.set(n, m);
    }
    return m;
  };
  return {
    get: get as any,
    clone: ((n: string, o?: any) => { const m = get(n).clone(); if (o) m.setValues(o); return m; }) as any,
    decal: () => new THREE.MeshBasicMaterial(), sign: () => new THREE.MeshStandardMaterial({ color: 0xc0c0a0 }),
    screen: () => new THREE.MeshStandardMaterial({ emissive: 0x20ff80 }), setScreen() {}, setEnvMap() {}, update() {},
  };
}

async function loadLib(): Promise<MaterialLibrary> {
  if (q.get('mats') === 'flat') return fallbackLib();
  try {
    const mod = await import('../../materials');
    const fake = { renderer, scene, debug: { ...debug, quality: 'high', verbose: false }, events: { on() { return () => {}; }, emit() {}, once() { return () => {}; } } } as unknown as GameContext;
    const lib = await mod.createMaterials(fake);
    lib.setEnvMap(env, 1);
    return lib;
  } catch (e) {
    console.warn('[harness] materials module failed, using fallback', e);
    return fallbackLib();
  }
}

type Builder = (m: VmMats) => THREE.Object3D;
const MODELS: Record<string, Builder> = {
  pistol: (m) => buildPistol(m).root,
  mag: (m) => buildMagazine(m),
  hand: (m) => { const h = new Hand(m, false); h.setPose(posePick(), true); h.apply(); return h.root; },
  lhand: (m) => { const h = new Hand(m, true); h.setPose(posePick(), true); h.apply(); return h.root; },
  forearm: (m) => new Forearm(m, true).root,
};
function posePick() { return (POSES as any)[q.get('pose') ?? 'relaxed'] ?? POSES.relaxed; }
export function registerModel(name: string, b: Builder) { MODELS[name] = b; }

async function main() {
  const lib = await loadLib();
  const view0 = q.get('view') ?? 'grid';
  setVmLight(Number(q.get('lamp') ?? 0), Number(q.get('vml') ?? 1));
  const mats = resolveMats(lib, view0 === 'fp');
  (window as any).__h = { THREE, scene, renderer, mats, lib };
  const view = q.get('view') ?? 'grid';
  if (view === 'fp') {
    const mod = await import('./fpview');
    await mod.runFp({ renderer, scene, mats, lib, q, hud, debug });
    (window as any).__game.ready = true;
    return;
  }
  const extra = await import('./models').catch(() => null);
  extra?.register(registerModel);
  const name = q.get('model') ?? 'pistol';
  const obj = (MODELS[name] ?? MODELS.pistol)(mats);
  scene.add(obj);
  const bb = new THREE.Box3().setFromObject(obj);
  const c = bb.getCenter(new THREE.Vector3());
  if (q.get('target')) { const t = q.get('target')!.split(',').map(Number); c.set(t[0], t[1], t[2]); }
  const size = bb.getSize(new THREE.Vector3()).length();
  const dist = Number(q.get('dist') ?? size * 1.25);
  const cam = new THREE.PerspectiveCamera(Number(q.get('fov') ?? 35), 1, 0.005, 20);
  const views: [number, number][] = view === 'one'
    ? [[Number(q.get('yaw') ?? 35), Number(q.get('pitch') ?? 15)]]
    : [[-150, 18], [90, 0], [-30, 30], [0, 89]];
  const labels = view === 'one' ? [''] : ['player 3/4 (rear-left)', 'right side', 'front-left 3/4', 'top'];
  hud.textContent = `${name}  tris=${countTris(obj)}  meshes=${countMeshes(obj)}  size=${size.toFixed(3)}m`;
  let frames = 0, t0 = performance.now();
  const spin = q.get('spin') === '1';
  const render = () => {
    requestAnimationFrame(render);
    const W = innerWidth, H = innerHeight;
    renderer.setScissorTest(true);
    const cols = views.length === 1 ? 1 : 2;
    const rows = views.length === 1 ? 1 : 2;
    views.forEach(([yawD, pitchD], i) => {
      const vx = (i % cols) * (W / cols), vy = (rows - 1 - Math.floor(i / cols)) * (H / rows);
      renderer.setViewport(vx, vy, W / cols, H / rows);
      renderer.setScissor(vx, vy, W / cols, H / rows);
      cam.aspect = (W / cols) / (H / rows);
      cam.updateProjectionMatrix();
      const yaw = THREE.MathUtils.degToRad(yawD + (spin ? performance.now() * 0.02 : 0)), pitch = THREE.MathUtils.degToRad(pitchD);
      cam.position.set(c.x + Math.sin(yaw) * Math.cos(pitch) * dist, c.y + Math.sin(pitch) * dist, c.z + Math.cos(yaw) * Math.cos(pitch) * dist);
      cam.up.set(0, 1, 0);
      if (Math.abs(pitchD) > 80) cam.up.set(0, 0, -1);
      cam.lookAt(c);
      renderer.render(scene, cam);
    });
    frames++;
    const now = performance.now();
    if (now - t0 > 500) { debug.fps = Math.round(frames * 1000 / (now - t0)); frames = 0; t0 = now; }
    void labels;
  };
  render();
  (window as any).__game.ready = true;
}

export function countTris(o: THREE.Object3D) {
  let n = 0;
  o.traverse((x) => { const g = (x as THREE.Mesh).geometry; if (g) n += (g.index ? g.index.count : g.getAttribute('position').count) / 3; });
  return Math.round(n);
}
export function countMeshes(o: THREE.Object3D) { let n = 0; o.traverse((x) => { if ((x as THREE.Mesh).isMesh) n++; }); return n; }

main().catch((e) => { console.error(e); hud.textContent = 'ERROR ' + e.message; });
