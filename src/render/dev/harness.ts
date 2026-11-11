/**
 * Isolated render-module harness: /dev/render.html
 *   ?cam=x,y,z,yawDeg,pitchDeg  &quality=low|medium|high|ultra  &fl=0 (flashlight off)  &walk=1 (fly the corridor)
 *   &nohud=1  &pause=1 (dt = 0)  &emergency=1
 * `window.__game` mimics the GameContext enough for scripts/shot.mjs (ready, renderer, debug.fps, render, state).
 * `__game.bench(n)` renders n frames back-to-back with gl.finish() and returns ms/frame.
 */
import * as THREE from 'three';
import type { GameContext, LightHandle, Quality } from '../../core/types';
import { createRender } from '../index';
import { QUALITY } from '../quality';

const q = new URLSearchParams(location.search);
const num = (s: string | null, d: number) => (s !== null && Number.isFinite(Number(s)) ? Number(s) : d);

// ───────────────────────────────────────────── procedural textures
function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, srgb = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function noiseFill(g: CanvasRenderingContext2D, s: number, base: number, amp: number, blobs: number): void {
  g.fillStyle = `rgb(${base},${base},${base})`;
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < blobs; i++) {
    const x = rnd() * s, y = rnd() * s, r = 4 + rnd() * rnd() * s * 0.25;
    const v = Math.round(base + (rnd() - 0.5) * 2 * amp);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
    grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grad;
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, 7); g.fill(); }
  }
}

function normalFromHeight(height: THREE.CanvasTexture, strength: number): THREE.CanvasTexture {
  const src = height.image as HTMLCanvasElement;
  const s = src.width;
  const d = src.getContext('2d')!.getImageData(0, 0, s, s).data;
  return canvasTex(s, (g) => {
    const out = g.createImageData(s, s);
    const h = (x: number, y: number) => d[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * s + x) * 4;
      out.data[i] = (-dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
    }
    g.putImageData(out, 0, 0);
  });
}

const floorRough = canvasTex(512, (g, s) => {
  noiseFill(g, s, 120, 110, 260);
  g.strokeStyle = 'rgba(230,230,230,0.9)'; g.lineWidth = 3;
  for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(0, i * s / 2); g.lineTo(s, i * s / 2); g.stroke(); g.beginPath(); g.moveTo(i * s / 2, 0); g.lineTo(i * s / 2, s); g.stroke(); }
});
const floorHeight = canvasTex(512, (g, s) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
  g.fillStyle = '#b0b0b0';
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { g.save(); g.translate((x + 0.5) * s / 16, (y + 0.5) * s / 16); g.rotate((x + y) % 2 ? 0.78 : -0.78); g.fillRect(-9, -2.5, 18, 5); g.restore(); }
  g.strokeStyle = '#303030'; g.lineWidth = 4;
  for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(0, i * s / 2); g.lineTo(s, i * s / 2); g.stroke(); g.beginPath(); g.moveTo(i * s / 2, 0); g.lineTo(i * s / 2, s); g.stroke(); }
});
const wallHeight = canvasTex(512, (g, s) => {
  g.fillStyle = '#909090'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#202020'; g.lineWidth = 5;
  g.strokeRect(6, 6, s - 12, s / 2 - 12); g.strokeRect(6, s / 2 + 6, s / 2 - 12, s / 2 - 12); g.strokeRect(s / 2 + 6, s / 2 + 6, s / 2 - 12, s / 2 - 12);
  g.fillStyle = '#d0d0d0';
  for (let i = 0; i < 12; i++) { g.beginPath(); g.arc(20 + (i % 6) * (s - 40) / 5, i < 6 ? 20 : s / 2 - 20, 5, 0, 7); g.fill(); }
});
const wallRough = canvasTex(512, (g, s) => {
  noiseFill(g, s, 150, 70, 200);
  g.fillStyle = 'rgba(40,40,40,0.35)';
  for (let i = 0; i < 14; i++) g.fillRect(rnd() * s, 0, 2 + rnd() * 10, s * (0.2 + rnd() * 0.8)); // drips = glossier streaks
});
const wallColor = canvasTex(512, (g, s) => {
  noiseFill(g, s, 150, 40, 160);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = '#8fa39a'; g.fillRect(0, 0, s, s);
}, true);
const floorNormal = normalFromHeight(floorHeight, 3);
const wallNormal = normalFromHeight(wallHeight, 4);

const M = {
  floor: new THREE.MeshStandardMaterial({ color: 0x3a4044, metalness: 0.75, roughness: 1, roughnessMap: floorRough, normalMap: floorNormal }),
  wall: new THREE.MeshStandardMaterial({ color: 0xffffff, map: wallColor, metalness: 0.25, roughness: 1, roughnessMap: wallRough, normalMap: wallNormal }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0x1c1f21, metalness: 0.4, roughness: 0.7, normalMap: wallNormal }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xb08a18, metalness: 0.1, roughness: 0.55, roughnessMap: wallRough }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 1, roughness: 0.6, roughnessMap: floorRough }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x101214, metalness: 0.6, roughness: 0.45 }),
  white: new THREE.MeshStandardMaterial({ color: 0xc9cdd0, metalness: 0.0, roughness: 0.5, roughnessMap: wallRough }),
  gun: new THREE.MeshStandardMaterial({ color: 0x23262a, metalness: 0.9, roughness: 0.38, roughnessMap: floorRough }),
};
for (const k of ['floor', 'steel', 'gun'] as const) { M[k].roughnessMap!.repeat.set(1, 1); }

// ───────────────────────────────────────────── scene helpers
function box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, uvScale = 0.5): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] * uvScale, uv.getY(i) * dims[f][1] * uvScale); }
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 200);
  scene.add(camera);
  const debug = { quality: (q.get('quality') as Quality | null), fps: 0, verbose: true };
  const ctx = { canvas, scene, camera, debug, state: 'playing', ready: false, time: 0 } as unknown as GameContext;
  (window as unknown as { __game: unknown }).__game = ctx;

  // preset overrides for profiling: &p=msaa:0,ao:0,volumetrics:0
  for (const kv of (q.get('p') ?? '').split(',')) {
    const [k, v] = kv.split(':');
    if (!k || v === undefined) continue;
    const preset = QUALITY[debug.quality ?? 'high'] as unknown as Record<string, number | boolean>;
    preset[k] = typeof preset[k] === 'boolean' ? v !== '0' : Number(v);
  }
  const render = await createRender(ctx);
  ctx.render = render;
  const L = render.lights;
  const world = new THREE.Group();
  scene.add(world);

  // ── rooms: med (z 0..10), corridor (z -30..0), hall (z -50..-30)
  const rooms = [
    { id: 'med', bounds: new THREE.Box3(new THREE.Vector3(-5, 0, 0), new THREE.Vector3(5, 3.2, 10)) },
    { id: 'corr', bounds: new THREE.Box3(new THREE.Vector3(-1.5, 0, -30), new THREE.Vector3(1.5, 3, 0)) },
    { id: 'hall', bounds: new THREE.Box3(new THREE.Vector3(-10, 0, -50), new THREE.Vector3(10, 7, -30)) },
  ];
  (ctx as unknown as { level: unknown }).level = { rooms };

  // med
  box(world, 10.8, 0.4, 10.8, 0, -0.2, 5, M.floor);
  box(world, 10.8, 0.4, 10.8, 0, 3.4, 5, M.ceiling);
  box(world, 0.4, 3.2, 10.8, -5.2, 1.6, 5, M.white);
  box(world, 0.4, 3.2, 10.8, 5.2, 1.6, 5, M.white);
  box(world, 10.8, 3.2, 0.4, 0, 1.6, 10.2, M.white);
  box(world, 4.2, 3.2, 0.4, -3.3, 1.6, -0.2, M.white); // wall with door gap (x -0.8..0.8) → corridor walls continue
  box(world, 4.2, 3.2, 0.4, 3.3, 1.6, -0.2, M.white);
  box(world, 2.4, 0.8, 0.4, 0, 2.8, -0.2, M.white);
  box(world, 2.0, 0.5, 0.9, -3.2, 0.55, 6, M.white); // bed
  box(world, 0.08, 1.0, 0.08, -2.3, 0.5, 6.6, M.steel);
  box(world, 0.6, 0.9, 0.5, 3.6, 0.45, 8.5, M.dark);
  // corridor
  box(world, 3.8, 0.4, 30, 0, -0.2, -15, M.floor);
  box(world, 3.8, 0.4, 30, 0, 3.2, -15, M.ceiling);
  box(world, 0.4, 3, 30, -1.7, 1.5, -15.2, M.wall);
  box(world, 0.4, 3, 30, 1.7, 1.5, -15.2, M.wall);
  for (let i = 0; i < 6; i++) { // ribs + pipes
    box(world, 0.12, 3, 0.25, -1.44, 1.5, -2.5 - i * 5 + 2.5, M.steel);
    box(world, 0.12, 3, 0.25, 1.44, 1.5, -2.5 - i * 5 + 2.5, M.steel);
  }
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 30, 10), M.steel);
  pipe.rotation.x = Math.PI / 2; pipe.position.set(-1.38, 2.5, -15); pipe.castShadow = pipe.receiveShadow = true; world.add(pipe);
  const pipe2 = pipe.clone(); pipe2.position.set(-1.36, 2.3, -15); pipe2.scale.set(0.6, 1, 0.6); world.add(pipe2);
  box(world, 0.7, 0.7, 0.7, 0.9, 0.35, -6, M.yellow);
  box(world, 0.5, 0.5, 0.5, 0.95, 0.95, -6.1, M.steel).rotation.y = 0.5;
  box(world, 0.6, 1.1, 0.4, -1.0, 0.55, -13, M.dark);
  box(world, 0.9, 0.5, 0.6, 0.85, 0.25, -21, M.steel);
  // hall
  box(world, 20.8, 0.4, 20.8, 0, -0.2, -40, M.floor);
  box(world, 20.8, 0.4, 20.8, 0, 7.2, -40, M.ceiling);
  box(world, 0.4, 7, 20.8, -10.2, 3.5, -40, M.wall);
  box(world, 0.4, 7, 20.8, 10.2, 3.5, -40, M.wall);
  box(world, 20.8, 7, 0.4, 0, 3.5, -50.2, M.wall);
  box(world, 8.3, 7, 0.4, -6.05, 3.5, -30.2, M.wall);
  box(world, 8.3, 7, 0.4, 6.05, 3.5, -30.2, M.wall);
  box(world, 3.8, 4, 0.4, 0, 5, -30.2, M.wall);
  for (let i = 0; i < 4; i++) { // assembly line blocks + pillars
    box(world, 1.4, 1.0, 2.2, -3 + (i % 2) * 6, 0.5, -35 - i * 3.4, M.yellow);
    box(world, 0.5, 7, 0.5, -7 + (i % 2) * 14, 3.5, -34 - Math.floor(i / 2) * 9, M.steel);
  }
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.6, 48, 24), M.chrome);
  sphere.position.set(0, 0.6, -36); sphere.castShadow = sphere.receiveShadow = true; world.add(sphere);
  const sphere2 = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 16), M.chrome);
  sphere2.position.set(-0.8, 0.3, -9); sphere2.castShadow = sphere2.receiveShadow = true; world.add(sphere2);
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.5, 0.17, 160, 24), M.steel);
  knot.position.set(2.5, 1.6, -38); knot.castShadow = knot.receiveShadow = true; world.add(knot);
  // big slow fan under a volumetric light (to see shadowed shafts)
  const fan = new THREE.Group();
  for (let i = 0; i < 5; i++) { const b = box(fan, 2.2, 0.05, 0.55, 1.2, 0, 0, M.dark); const p = new THREE.Group(); p.rotation.y = (i / 5) * Math.PI * 2; p.add(b); fan.add(p); }
  fan.position.set(-3, 5.2, -42); world.add(fan);
  // grate between light and floor
  for (let i = 0; i < 9; i++) box(world, 0.07, 0.07, 2.6, 3.4 + i * 0.3, 4.4, -44, M.dark);
  // patrolling "enemy"
  const walker = new THREE.Group();
  box(walker, 0.5, 1.2, 0.3, 0, 1.0, 0, M.white); box(walker, 0.3, 0.3, 0.3, 0, 1.78, 0, M.white);
  box(walker, 0.16, 0.8, 0.16, -0.14, 0.4, 0, M.dark); box(walker, 0.16, 0.8, 0.16, 0.14, 0.4, 0, M.dark);
  world.add(walker);

  // ── lights
  const fixtureMat = (color: number) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 6, roughness: 0.4 });
  const handles: LightHandle[] = [];
  const ceilingSpot = (x: number, y: number, z: number, color: number, intensity: number, distance: number, angle: number, opts: Partial<Parameters<typeof L.add>[0]> = {}) => {
    const h = L.add({ type: 'spot', position: new THREE.Vector3(x, y - 0.12, z), target: new THREE.Vector3(x, 0, z), color, intensity, distance, angle, penumbra: 0.6, castShadow: true, ...opts });
    const fm = fixtureMat(color);
    box(world, 0.9, 0.06, 0.22, x, y - 0.03, z, fm).castShadow = false;
    h.bindEmissive(fm, 6);
    handles.push(h);
    return h;
  };
  const modes = ['none', 'fluorescent', 'broken', 'none', 'pulse', 'strobe'] as const;
  for (let i = 0; i < 6; i++) {
    ceilingSpot(0, 3.0, -2.5 - i * 5, i === 4 ? 0xffb060 : 0xdfe8ff, 70, 7.5, 1.0, { flicker: modes[i], group: 'corr', volumetric: i === 3 || i === 0 });
  }
  ceilingSpot(-2, 3.2, 3.5, 0xe6eeff, 60, 8, 1.05, { group: 'med', flicker: 'fluorescent' });
  ceilingSpot(2.5, 3.2, 7, 0xe6eeff, 45, 8, 1.05, { group: 'med', flicker: 'broken' });
  handles.push(L.add({ type: 'point', position: new THREE.Vector3(3.6, 1.1, 8.2), color: 0x40ff90, intensity: 1.5, distance: 3, group: 'med', flicker: 'pulse' }));
  for (let i = 0; i < 8; i++) {
    const x = -6 + (i % 4) * 4, z = -35 - Math.floor(i / 4) * 9;
    ceilingSpot(x, 7.0, z, 0xffb060, 420, 12, 0.5, { group: 'hall', volumetric: true, priority: 2 });
  }
  ceilingSpot(-3, 7.0, -42, 0xfff0d8, 900, 13, 0.6, { group: 'hall', volumetric: true, priority: 3 });
  ceilingSpot(4.6, 7.0, -44, 0xfff0d8, 900, 13, 0.45, { group: 'hall', volumetric: true, priority: 3 });
  const emergencyOn = q.get('emergency') === '1';
  for (let i = 0; i < 4; i++) {
    const x = i % 2 ? 9.6 : -9.6, z = -34 - Math.floor(i / 2) * 12;
    handles.push(L.add({ type: 'spot', position: new THREE.Vector3(x * 0.96, 4.5, z), target: new THREE.Vector3(0, 3.5, z), color: 0xff2a10, intensity: 500, distance: 16, angle: 0.5, penumbra: 0.5, flicker: 'alarm', group: 'hall_emergency', volumetric: true, enabled: emergencyOn }));
    handles.push(L.add({ type: 'point', position: new THREE.Vector3(x * 0.9, 1.2, z + 3), color: 0xff3018, intensity: 14, distance: 6, flicker: 'alarm', group: 'hall_emergency', enabled: emergencyOn }));
  }
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(-9.7 + (i % 2) * 19.4, 1.4, -32 - i * 2.2);
    const col = i % 3 === 0 ? 0xff2020 : 0x20e0ff;
    handles.push(L.add({ type: 'point', position: p, color: col, intensity: 1.2, distance: 2.5, group: 'leds' }));
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: 0, emissive: col, emissiveIntensity: 30 }));
    led.position.copy(p).x += i % 2 ? 0.25 : -0.25; world.add(led);
  }
  // flashlight (as the player module will add it)
  const flashOn = q.get('fl') !== '0';
  const flash = L.add({ type: 'spot', position: new THREE.Vector3(), target: new THREE.Vector3(0, 0, -1), color: 0xcfe2ff, intensity: 520, distance: 30, angle: 0.34, penumbra: 0.45, castShadow: true, priority: 100, volumetric: q.get('flvol') === '1', enabled: flashOn });

  // viewmodel
  const vm = new THREE.Group();
  const vmBox = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material = M.gun) => { const m = box(vm, w, h, d, x, y, z, mat, 4); m.layers.set(render.viewmodelLayer); m.castShadow = false; return m; };
  vmBox(0.045, 0.06, 0.34, 0, 0, 0);
  vmBox(0.04, 0.14, 0.06, 0, -0.09, 0.12).rotation.x = 0.25;
  vmBox(0.05, 0.035, 0.36, 0, 0.045, -0.01, M.steel);
  vmBox(0.012, 0.012, 0.012, 0, 0.075, -0.17, new THREE.MeshStandardMaterial({ color: 0, emissive: 0x30ff60, emissiveIntensity: 12 }));
  vm.position.set(0.17, -0.17, -0.42);
  vm.rotation.y = 0.04;
  camera.add(vm);
  if (q.get('novm') === '1') vm.visible = false;

  // camera
  const cam = (q.get('cam') ?? '0,1.65,7,0,0').split(',').map(Number);
  camera.position.set(cam[0] ?? 0, cam[1] ?? 1.65, cam[2] ?? 7);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(THREE.MathUtils.degToRad(cam[4] ?? 0), THREE.MathUtils.degToRad(cam[3] ?? 0), 0);
  const fwd = new THREE.Vector3();
  const updateFlash = () => {
    camera.updateMatrixWorld();
    camera.getWorldDirection(fwd);
    flash.position.copy(camera.position).addScaledVector(fwd, 0.1); flash.position.y -= 0.12;
    flash.target.copy(camera.position).addScaledVector(fwd, 12);
  };
  updateFlash();

  const probes = [new THREE.Vector3(0, 1.6, 5), new THREE.Vector3(0, 1.5, -15), new THREE.Vector3(0, 3, -40)];
  const t0 = performance.now();
  await render.prepare(probes);
  const prepMs = performance.now() - t0;
  const onResize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); render.resize(innerWidth, innerHeight); };
  addEventListener('resize', onResize);
  onResize();

  // look-dev overrides: &set=exposure:1.2,bloom:0.3
  for (const kv of (q.get('set') ?? '').split(',')) {
    const [k, v] = kv.split(':');
    if (k && v !== undefined) (render.settings as unknown as Record<string, number>)[k] = Number(v);
  }
  const walk = q.get('walk') === '1';
  const paused = q.get('pause') === '1';
  let time = num(q.get('t'), 0);
  const sim = (dt: number) => {
    time += dt;
    walker.position.set(Math.sin(time * 0.7) * 0.6, 0, -15 + Math.sin(time * 0.35) * 11);
    fan.rotation.y = time * 0.9;
    knot.rotation.set(time * 0.4, time * 0.6, 0);
    if (walk) {
      const u = (time * 0.12) % 1;
      camera.position.set(Math.sin(time * 0.5) * 0.4, 1.65, 8 - u * 52);
      camera.rotation.y = Math.sin(time * 0.8) * 0.5;
    }
    updateFlash();
  };
  if (time > 0) { const steps = Math.ceil(time / 0.05); const tt = time; time = 0; for (let i = 0; i < steps; i++) { sim(tt / steps); render.render(tt / steps); } }

  let last = performance.now(), acc = 0, frames = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000; last = now;
    const dt = paused ? 0 : Math.min(raw, 0.05);
    acc += raw; frames++;
    if (acc >= 0.5) {
      debug.fps = Math.round(frames / acc); acc = 0; frames = 0;
      if (q.get('nohud') !== '1') {
        const s = (render as unknown as { stats(): Record<string, unknown> }).stats();
        hud.textContent = `fps ${debug.fps}  ${s.width}x${s.height} ${s.quality}\nlights ${s.lights}  active slots ${s.activeSlots}/${Number(s.spotSlots) + Number(s.pointSlots)}  shadow updates ${s.shadowUpdates}\ncalls ${s.calls} tris ${s.triangles}  prepare ${prepMs.toFixed(0)} ms`;
      }
    }
    if (dt > 0) sim(dt);
    render.render(dt);
  };
  sim(0);
  render.render(0);
  ctx.ready = true;
  Object.assign(ctx, {
    handles, flash, world,
    bench(n = 60) {
      const gl = ctx.renderer.getContext();
      const px = new Uint8Array(4);
      const sync = () => { ctx.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      for (let i = 0; i < 5; i++) { sim(1 / 60); render.render(1 / 60); }
      sync();
      const t = performance.now();
      for (let i = 0; i < n; i++) { sim(1 / 60); render.render(1 / 60); sync(); }
      return +((performance.now() - t) / n).toFixed(2);
    },
  });
  requestAnimationFrame((t) => { last = t; frame(t); });
}

main().catch((e) => { console.error(e); });
