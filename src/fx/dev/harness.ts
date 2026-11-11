/**
 * Isolated FX test scene (dev/fx.html). Fake ctx with a fixed light pool, simple PBR scene, real physics,
 * optional bloom (?bloom=0 to disable). ?fx=sparks|smoke|steam|fluid|arc|explosion|debris|dust|impacts|drip|emsparks|all
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createEvents } from '../../core/events';
import { createPhysics } from '../../physics/physics';
import type { DecalName, GameContext, LightDesc, LightHandle, LightManager, MaterialLibrary, MaterialName, Surface } from '../../core/types';
import { createFx } from '../index';

const q = new URLSearchParams(location.search);
const mode = q.get('fx') ?? 'all';
const bloomOn = q.get('bloom') !== '0';
const flashlight = q.get('flashlight') !== '0';
const dark = q.get('dark') === '1';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.info.autoReset = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010203);
scene.fog = new THREE.FogExp2(0x05080a, 0.035);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 200);
const camQ = q.get('cam')?.split(',').map(Number);
camera.position.set(camQ?.[0] ?? 0, camQ?.[1] ?? 1.6, camQ?.[2] ?? 3.6);
camera.lookAt(camQ?.[3] ?? 0, camQ?.[4] ?? 0.9, camQ?.[5] ?? -1);
scene.add(camera);

// ── fake light manager: fixed pool of real lights (no recompiles), assigned by priority each frame
const POOL = 8;
const pool: THREE.PointLight[] = [];
for (let i = 0; i < POOL; i++) { const l = new THREE.PointLight(0xffffff, 0, 1, 2); scene.add(l); pool.push(l); }
const handles: (LightHandle & { _color: THREE.Color })[] = [];
const lights: LightManager = {
  add(desc: LightDesc) {
    const h: any = {
      desc, enabled: desc.enabled !== false, intensityScale: 1, _color: new THREE.Color(desc.color),
      position: desc.position.clone(), target: (desc.target ?? new THREE.Vector3()).clone(),
      get factor() { return h.enabled ? h.intensityScale : 0; },
      setFlicker() {}, setColor(c: THREE.ColorRepresentation) { h._color.set(c); }, bindEmissive() {},
      remove() { handles.splice(handles.indexOf(h), 1); },
    };
    handles.push(h);
    return h;
  },
  setGroup() {}, group: (g) => handles.filter((h) => h.desc.group === g),
};
function assignLights() {
  const act = handles.filter((h) => h.factor > 0).sort((a, b) => (b.desc.priority ?? 1) - (a.desc.priority ?? 1));
  for (let i = 0; i < POOL; i++) {
    const l = pool[i], h = act[i];
    if (!h) { l.intensity = 0; continue; }
    l.position.copy(h.position); l.color.copy(h._color); l.intensity = h.desc.intensity * h.factor; l.distance = h.desc.distance;
  }
}
// flashlight (spot, as the player's would be)
const spot = new THREE.SpotLight(0xdfe8ff, flashlight ? 60 : 0, 25, 0.38, 0.45, 2);
spot.castShadow = true;
spot.shadow.mapSize.set(1024, 1024);
camera.add(spot); spot.position.set(0.2, -0.15, 0); camera.add(spot.target); spot.target.position.set(0, -0.1, -1);
scene.add(new THREE.HemisphereLight(0x223038, 0x0a0a0a, dark ? 0.05 : 0.25));

// scene lights via manager
lights.add({ type: 'point', position: new THREE.Vector3(-2.5, 2.8, -0.5), color: 0xffa040, intensity: dark ? 6 : 22, distance: 10 });
lights.add({ type: 'point', position: new THREE.Vector3(3, 2.6, 0.5), color: 0x60a0c0, intensity: dark ? 4 : 12, distance: 10 });

// ── scene
function noiseTex(base: number, amp: number) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) { const v = base + (Math.random() - 0.5) * amp; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4);
  return t;
}
const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.55, metalness: 0.6, roughnessMap: noiseTex(150, 90) });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x3c4542, roughness: 0.7, metalness: 0.3, roughnessMap: noiseTex(170, 60) });
const floor = new THREE.Mesh(new THREE.BoxGeometry(24, 0.2, 24), floorMat); floor.position.y = -0.1; floor.receiveShadow = true;
floor.userData.surface = 'metal';
const wall = new THREE.Mesh(new THREE.BoxGeometry(24, 6, 0.4), wallMat); wall.position.set(0, 3, -2.2); wall.receiveShadow = true;
wall.userData.surface = 'concrete';
const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3.2, 0.6), wallMat); pillar.position.set(2.2, 1.6, -0.8); pillar.castShadow = pillar.receiveShadow = true;
const ceiling = new THREE.Mesh(new THREE.BoxGeometry(24, 0.2, 24), wallMat); ceiling.position.y = 3.3;
const crate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), floorMat); crate.position.set(-2, 0.4, -1); crate.castShadow = crate.receiveShadow = true;
scene.add(floor, wall, pillar, ceiling, crate);

// ── fake materials
function decalTex(name: DecalName): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rad = (r0: number, a: number, col: string) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, r0);
    gr.addColorStop(0, col.replace('A', String(a))); gr.addColorStop(1, col.replace('A', '0'));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  };
  if (name.startsWith('bullet')) {
    rad(60, 0.6, 'rgba(20,18,16,A)');
    g.fillStyle = 'rgba(0,0,0,1)'; g.beginPath(); g.arc(64, 64, 14, 0, 7); g.fill();
    g.strokeStyle = 'rgba(160,150,140,0.6)'; g.lineWidth = 3; g.beginPath(); g.arc(64, 64, 17, 0, 7); g.stroke();
  } else if (name === 'scorch') {
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(5,4,3,${0.08})`; g.beginPath(); g.arc(64 + (Math.random() - 0.5) * 40, 64 + (Math.random() - 0.5) * 40, 20 + Math.random() * 30, 0, 7); g.fill(); }
    rad(64, 0.85, 'rgba(8,6,5,A)');
  } else if (name.startsWith('blood')) {
    rad(50, 0.9, 'rgba(70,4,3,A)');
  } else if (name === 'oil_drip') {
    rad(30, 0.9, 'rgba(5,4,3,A)'); g.fillStyle = 'rgba(5,4,3,0.85)'; for (let i = 0; i < 4; i++) g.fillRect(50 + i * 8, 64, 3, 30 + Math.random() * 30);
  } else {
    rad(56, 0.9, 'rgba(6,5,4,A)');
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const matCache = new Map<string, THREE.MeshStandardMaterial>();
const materials: MaterialLibrary = {
  get(name: MaterialName) {
    let m = matCache.get(name);
    if (!m) matCache.set(name, (m = new THREE.MeshStandardMaterial({ color: name === 'robot_frame' ? 0x1d1f22 : 0x8a8e92, metalness: 0.9, roughness: 0.4 })));
    return m;
  },
  clone(name) { return materials.get(name).clone(); },
  decal(name: DecalName) {
    return new THREE.MeshStandardMaterial({ map: decalTex(name), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: name.startsWith('oil') ? 0.15 : 0.8, metalness: 0 });
  },
  sign() { return new THREE.MeshStandardMaterial(); }, screen() { return new THREE.MeshStandardMaterial(); },
  setScreen() {}, setEnvMap() {}, update() {},
};

const physics = createPhysics();
physics.build([floor, wall, pillar, ceiling, crate]);
const events = createEvents();
let trauma = 0;
const ctx = {
  canvas, renderer, scene, camera, events, physics, materials,
  render: { lights, quality: 'high', post: {}, viewmodelLayer: 1 },
  player: { shake(a: number) { trauma = Math.min(1, trauma + a); }, eye: camera.position, position: camera.position, flashlightOn: flashlight },
  debug: { fps: 0 }, time: 0, state: 'playing', ready: false,
} as unknown as GameContext;

const fx = await createFx(ctx);
ctx.fx = fx;

// ── post
let composer: EffectComposer | null = null;
if (bloomOn) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.95));
  composer.addPass(new OutputPass());
}

// ── scripted demo
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const timers: { t: number; every: number; fn: () => void }[] = [];
const every = (sec: number, fn: () => void, first = 0.2) => timers.push({ t: first, every: sec, fn });
const surfaces: Surface[] = q.get('surface') ? [q.get('surface') as Surface] : ['metal', 'concrete', 'glass', 'rubber', 'robot', 'flesh'];
const has = (m: string) => mode === m || mode === 'all';
if (has('sparks')) every(0.12, () => fx.sparks(V(-0.6 + Math.random() * 0.2, 1.3, -1.99), V(0.3, 0.2, 1).normalize(), 28, 7));
if (has('smoke')) every(1.2, () => fx.smoke(V(0.8, 0.3, -1), { count: 8, size: 0.7 }));
if (has('steam')) fx.emitter('steam', V(-1.8, 1.1, -1.95), V(1, 0.12, 0.35));
if (has('fluid')) every(0.9, () => fx.fluid(V(0.3, 1.4, -0.5), V(-0.2, 0.3, -1), 14));
if (has('arc')) every(1.1, () => fx.arc(V(-0.8, 2.0, -1.95), V(0.9, 1.0, -1.95), 0.7));
if (has('explosion')) every(3.5, () => fx.explosion(V(0, 0.4, -0.8), 1), 0.4);
if (has('debris')) every(1.5, () => fx.debris(V(0, 1.5, -0.5), V(Math.random() - 0.5, 2, 1.5)));
if (has('dust')) fx.emitter('dust', V(0, 1.4, 0), V(3, 1.4, 3), 120);
if (has('drip')) fx.emitter('drip', V(-0.6, 3.19, 0.3), undefined, 1.5);
if (has('emsparks')) fx.emitter('sparks', V(1.2, 3.1, -0.4), V(0, -1, 0), 1.5);
if (has('impacts')) every(+(q.get('every') ?? 0.15), () => {
  const s = surfaces[(Math.random() * surfaces.length) | 0];
  const onFloor = q.get('floor') === '1' ? true : q.get('floor') === '0' ? false : Math.random() < 0.4;
  const p = onFloor ? V((Math.random() - 0.5) * 3, 0, -0.5 + (Math.random() - 0.5) * 1.4) : V((Math.random() - 0.5) * (q.get('spread') ? +q.get('spread')! : 3), 1.2 + (Math.random() - 0.5) * (q.get('spread') ? +q.get('spread')! : 2), -2);
  events.emit('bullet:impact', { point: p, normal: onFloor ? V(0, 1, 0) : V(0, 0, 1), surface: s });
});

const hud = document.getElementById('hud')!;
const g = { ready: false, renderer, debug: ctx.debug, fx, ctx, scene, camera, V, events };
(window as any).__game = g;
(window as any).THREE = THREE;

let last = performance.now(), acc = 0, frames = 0;
const camBase = camera.position.clone();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(1 / 20, (now - last) / 1000); last = now;
  acc += dt; frames++;
  if (acc > 0.5) { ctx.debug.fps = Math.round(frames / acc); acc = 0; frames = 0; }
  for (const t of timers) { t.t -= dt; if (t.t <= 0) { t.t += t.every; t.fn(); } }
  trauma = Math.max(0, trauma - dt * 1.5);
  camera.position.copy(camBase).add(V((Math.random() - 0.5) * trauma * trauma * 0.1, (Math.random() - 0.5) * trauma * trauma * 0.1, 0));
  fx.update(dt);
  assignLights();
  renderer.info.reset();
  if (composer) composer.render(dt); else renderer.render(scene, camera);
  const st = (fx as any).stats();
  hud.textContent = `fx=${mode} bloom=${bloomOn} fps=${ctx.debug.fps} calls=${renderer.info.render.calls} streaks=${st.streaks} puffs=${st.puffs} debris=${st.debris}`;
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false); composer?.setSize(innerWidth, innerHeight);
});
assignLights();
renderer.render(scene, camera);
g.ready = true;
requestAnimationFrame((t) => { last = t; frame(t); });
