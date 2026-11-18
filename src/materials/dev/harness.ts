/**
 * Isolated harness for the materials module: dev/materials.html
 *   ?page=N                 grid of materials (8 per page): sphere + 2×2 m panel each
 *   ?mat=name               close-up of one material at grazing light (&dist=m &yaw=deg &tex=albedo|normal|orm)
 *   ?view=decals|signs|screens
 *   &env=0                  no environment reflections; &time=s advances screens
 *   ?view=habitat|booth|wayfinding|screens3   stage 3a habitat gallery (see ./habitat.ts)
 *   ?view=clinical|cbooth|screens4|screen4|signs4   stage 3b clinical gallery (see ./clinical.ts)
 *   ?view=navy|nbooth|nbig|kit5|screens5|screen5|signs5   stage 3c navy dock gallery (see ./navy.ts)
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createMaterials } from '../index';
import { habitatGallery, HABITAT_VIEWS } from './habitat';
import { clinicalGallery, CLINICAL_VIEWS } from './clinical';
import { navyGallery, NAVY_VIEWS } from './navy';
import { SPECS, EMISSIVE } from '../defs';
import type { DecalName, GameContext, MaterialName, ScreenKind, SignStyle } from '../../core/types';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const info = document.getElementById('info')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(q.get('exposure') ?? 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0b0c);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 100);

function metreUV(geo: THREE.BufferGeometry, su: number, sv: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}
function panel(w: number, h: number) { return metreUV(new THREE.PlaneGeometry(w, h), w, h); }
function sphere(r: number) { return metreUV(new THREE.SphereGeometry(r, 96, 64), Math.PI * 2 * r, Math.PI * r); }

/** A dim industrial room for reflections: dark walls, a few fluorescent strips + one warm work light. */
function darkRoom() {
  const sc = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 12), new THREE.MeshBasicMaterial({ color: 0x0b0c0d, side: THREE.BackSide }));
  box.position.y = 1;
  sc.add(box);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: 0x050505 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.99; sc.add(floor);
  const strip = (x: number, z: number, c: number, i: number, w = 0.15, l = 1.6) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, l), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i) }));
    m.position.set(x, 2.9, z); sc.add(m);
  };
  strip(-2, 1, 0xdfe8ff, 6); strip(2, -2, 0xdfe8ff, 6); strip(0, 4, 0xdfe8ff, 3);
  const warm = new THREE.Mesh(new THREE.SphereGeometry(0.25), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb060).multiplyScalar(8) }));
  warm.position.set(-4, 1.5, 3); sc.add(warm);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x30404a).multiplyScalar(1.2) }));
  panel.position.set(0, 1, -5.9); sc.add(panel);
  return sc;
}

async function main() {
  const t0 = performance.now();
  // the stage 3a gallery bakes the habitat set at load, as level 3 does
  const habView = HABITAT_VIEWS.includes(q.get('view') ?? '');
  const clinView = CLINICAL_VIEWS.includes(q.get('view') ?? '');
  // (the stage 3c gallery bakes the navy set at load, as level 5 does)
  const navyView = NAVY_VIEWS.includes(q.get('view') ?? '');
  const lib = await createMaterials({ renderer, levelId: navyView ? 5 : clinView ? 4 : habView ? 3 : undefined } as unknown as GameContext);
  const genMs = performance.now() - t0;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = q.get('room') === '1' ? pmrem.fromScene(new RoomEnvironment(), 0.04).texture : pmrem.fromScene(darkRoom(), 0.02).texture;
  if (q.get('env') !== '0') lib.setEnvMap(env, Number(q.get('envi') ?? 1));

  const names = [...Object.keys(SPECS), ...Object.keys(EMISSIVE)] as MaterialName[];
  const view = q.get('view');
  const mat = q.get('mat') as MaterialName | null;
  let animate: ((t: number) => void) | null = null;

  const key = new THREE.PointLight(0xfff2e0, 40, 30, 2);
  const rim = new THREE.PointLight(0x9fc4ff, 15, 30, 2);
  scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.03));

  let splitRender: (() => void) | undefined;
  if (habView) {
    scene.clear();
    const g = habitatGallery({ renderer, scene, camera, lib, q }, view!);
    animate = g.step; splitRender = g.render;
  } else if (clinView) {
    scene.clear();
    const g = clinicalGallery({ renderer, scene, camera, lib, q }, view!);
    animate = g.step; splitRender = g.render;
  } else if (navyView) {
    scene.clear();
    const g = navyGallery({ renderer, scene, camera, lib, q }, view!);
    animate = g.step; splitRender = g.render;
  } else if (mat) {
    const m = lib.get(mat);
    const texMode = q.get('tex');
    let useMat: THREE.Material = m;
    if (texMode) {
      const t = texMode === 'albedo' ? m.map : texMode === 'normal' ? m.normalMap : m.roughnessMap;
      useMat = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide });
    }
    const size = Number(q.get('size') ?? 3);
    const p = new THREE.Mesh(panel(size, size), useMat);
    scene.add(p);
    const s = new THREE.Mesh(sphere(0.35), m);
    s.position.set(size * 0.32, -size * 0.3, 0.4);
    if (!texMode) scene.add(s);
    const dist = Number(q.get('dist') ?? 2.2);
    const yaw = THREE.MathUtils.degToRad(Number(q.get('yaw') ?? 0));
    camera.position.set(Math.sin(yaw) * dist, Number(q.get('cy') ?? 0), Math.cos(yaw) * dist);
    camera.lookAt(0, 0, 0);
    key.position.set(-size * 0.7, size * 0.45, 0.35);
    rim.position.set(size * 0.6, -size * 0.2, 0.6);
    if (texMode) { scene.remove(key, rim); camera.position.set(0, 0, size * 0.9); camera.lookAt(0, 0, 0); }
    animate = (t) => { key.position.x = -size * 0.7 + Math.sin(t * 0.0) * 0.1; };
  } else if (view === 'decals') {
    const wall = new THREE.Mesh(panel(8, 4), lib.get(q.get('base') as MaterialName ?? 'floor_concrete'));
    scene.add(wall);
    const decals: DecalName[] = ['blood_splat', 'blood_smear', 'blood_pool', 'oil_stain', 'oil_drip', 'scorch',
      'bullet_metal', 'bullet_concrete', 'scratches', 'grime', 'handprint', 'water_stain'];
    const variant = Number(q.get('variant') ?? 0);
    decals.forEach((d, i) => {
      const geo = new THREE.PlaneGeometry(1.1, 1.1);
      const sz = d.startsWith('bullet') ? 0.35 : 1.1;
      const dm = new THREE.Mesh(geo, lib.decal(d, variant + (i % 2) * 0));
      dm.scale.setScalar(sz / 1.1);
      dm.position.set(-3.3 + (i % 6) * 1.32, 0.9 - Math.floor(i / 6) * 1.7, 0.002);
      scene.add(dm);
    });
    camera.position.set(0, 0, 5.2); camera.lookAt(0, 0, 0);
    key.position.set(-3, 2, 1.2); rim.position.set(3.5, -1, 1.5);
  } else if (view === 'signs') {
    const wall = new THREE.Mesh(panel(8, 4.5), lib.get('wall_panel'));
    scene.add(wall);
    const items: [string, SignStyle, number][] = [
      ['MEDICAL 3-A', 'label', 3], ['HIGH VOLTAGE\nAUTHORISED PERSONNEL ONLY', 'warning', 3], ['DANGER\nROBOTIC ARM ZONE', 'danger', 2.5],
      ['< FABRICATION HALL 3', 'directional', 4], ['SECURITY 3 >', 'directional', 4], ['SUBLEVEL 3', 'stencil', 3.5],
      ['B-07', 'stencil', 1.6], ['PRESSURE LINE\nDO NOT OPEN', 'label', 2], ['!', 'warning', 1],
    ];
    items.forEach(([t, s, a], i) => {
      const h = 0.6;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(h * a, h), lib.sign(t, s, a));
      m.position.set(-2.4 + (i % 3) * 2.6, 1.4 - Math.floor(i / 3) * 1.2, 0.01);
      scene.add(m);
    });
    camera.position.set(0, 0.2, 5.5); camera.lookAt(0, 0.2, 0);
    key.position.set(-3, 2, 1.5); rim.position.set(3.5, -1, 1.5);
  } else if (view === 'screens') {
    const wall = new THREE.Mesh(panel(8, 4.5), lib.get('wall_panel_dark'));
    scene.add(wall);
    const kinds: ScreenKind[] = ['terminal_idle', 'terminal_alert', 'static', 'choir', 'camera_feed', 'vitals', 'door_locked', 'door_open'];
    const bezel = lib.get('plastic_dark');
    kinds.forEach((k, i) => {
      const aspect = k.startsWith('door') ? 2 : 1.6;
      const h = k.startsWith('door') ? 0.4 : 0.9;
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(h * aspect + 0.08, h + 0.08, 0.05), bezel);
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), lib.screen(k, k === 'terminal_alert' ? { text: 'CONTAINMENT\nBREACH' } : undefined));
      sc.position.z = 0.026;
      g.add(b, sc);
      g.position.set(-2.7 + (i % 4) * 1.8, 1.0 - Math.floor(i / 4) * 1.7, 0.03);
      scene.add(g);
    });
    camera.position.set(0, 0.1, 5.4); camera.lookAt(0, 0.1, 0);
    key.position.set(-3, 2, 2); key.intensity = 8; rim.intensity = 4;
    const tAdv = Number(q.get('time') ?? 2);
    for (let i = 0; i < tAdv * 30; i++) lib.update(1 / 30);
    animate = () => lib.update(1 / 60);
  } else {
    const page = Number(q.get('page') ?? 0);
    const per = 8;
    const list = names.slice(page * per, page * per + per);
    list.forEach((n, i) => {
      const m = lib.get(n);
      const x = -4.5 + (i % 4) * 3, y = 1.5 - Math.floor(i / 4) * 3.1;
      const p = new THREE.Mesh(panel(2, 2), m);
      p.position.set(x - 0.5, y, 0);
      const s = new THREE.Mesh(sphere(0.5), m);
      s.position.set(x + 0.75, y - 0.45, 0.6);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.3), lib.sign(n, 'label', 6));
      label.position.set(x - 0.5, y + 1.22, 0.01);
      scene.add(p, s, label);
    });
    camera.position.set(0, -0.1, 8.6); camera.lookAt(0, -0.1, 0);
    key.position.set(-6, 4, 2.5); rim.position.set(6, -3, 3); key.intensity = 80; rim.intensity = 40;
  }

  info.textContent = `materials generated in ${genMs.toFixed(0)} ms   ${view ?? mat ?? 'page ' + (q.get('page') ?? 0)}`;
  const debug = { fps: 0 };
  let frames = 0;
  let last = performance.now(), acc = 0, cnt = 0;
  const loop = (t: number) => {
    requestAnimationFrame(loop);
    const dt = (t - last) / 1000; last = t; acc += dt; cnt++;
    if (acc > 0.5) { debug.fps = Math.round(cnt / acc); acc = 0; cnt = 0; }
    animate?.(t / 1000);
    if (splitRender) splitRender(); else renderer.render(scene, camera);
    if (++frames === 3) (window as unknown as { __game: unknown }).__game = { ready: true, renderer, debug, lib, genMs };
  };
  requestAnimationFrame(loop);
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  });
}
main().catch((e) => { console.error(e); info.textContent = String(e?.stack ?? e); });
