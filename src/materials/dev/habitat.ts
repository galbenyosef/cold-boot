/**
 * Stage 3a habitat gallery for the materials harness (dev/materials.html). Bakes the habitat set as level 3 does.
 *   ?view=habitat[&page=0|1][&light=warm|cold]   grid of the 14 habitat materials (sphere + 2×2 m panel)
 *   ?view=booth&mat=name                          split view — warm "evening lamp" left, cold takeover light right:
 *                                                 3 × 3 m wall + 3 × 2 m floor + sphere (leaf / water / glass / bark /
 *                                                 fabric get a fitting set-up); &cy= &dist= move the camera, &time=s
 *   ?view=wayfinding[&light=cold]                 wayfinding plaques (and an industrial stencil for contrast)
 *   ?view=screens3[&time=s]                       pressure / habitat_status / feed / badge in every state
 */
import * as THREE from 'three';
import { LEAF_ATLAS } from '../index';
import type { MaterialLibrary, MaterialName, ScreenKind } from '../../core/types';

export const HABITAT_VIEWS = ['habitat', 'booth', 'wayfinding', 'screens3'];
const HABITAT: MaterialName[] = ['wood_veneer', 'wood_dark', 'fabric_warm', 'carpet', 'plaster_warm', 'terrazzo', 'stone_pale',
  'tile_ceramic', 'linoleum', 'soil', 'leaf', 'bark', 'water', 'glass_clear'];

function metreUV(geo: THREE.BufferGeometry, su: number, sv: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}
const panel = (w: number, h: number) => metreUV(new THREE.PlaneGeometry(w, h), w, h);
const sphere = (r: number) => metreUV(new THREE.SphereGeometry(r, 96, 64), Math.PI * 2 * r, Math.PI * r);
const trunk = (r: number, h: number) => metreUV(new THREE.CylinderGeometry(r * 0.8, r, h, 32, 8), Math.PI * 2 * r, h);
/** A square card mapped to one cell of the leaf atlas; base at the bottom edge. */
function leafCard(size: number, cell: keyof typeof LEAF_ATLAS) {
  const g = new THREE.PlaneGeometry(size, size);
  g.translate(0, size / 2, 0);
  const [u0, v0, u1, v1] = LEAF_ATLAS[cell];
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

/** Reflection environments: an evening-lit room, and the same room after the takeover. */
function habitatRoom(cold: boolean) {
  const sc = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 14), new THREE.MeshBasicMaterial({ color: cold ? 0x07090c : 0x2a2018, side: THREE.BackSide }));
  box.position.y = 1.5; sc.add(box);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ color: cold ? 0x030405 : 0x1a120c }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.99; sc.add(floor);
  const lamp = (x: number, z: number, c: number, i: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i) }));
    m.position.set(x, 3.9, z); sc.add(m);
  };
  if (cold) { lamp(-3, 2, 0xc8e0ff, 1.2); lamp(4, -3, 0xc8e0ff, 0.6); }
  else { lamp(-3, 2, 0xffc58a, 5); lamp(3, -2, 0xffc58a, 4); lamp(0, 4, 0xbcd0ff, 2); lamp(2, 5, 0xffc58a, 3); }
  const win = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ color: cold ? 0x020406 : new THREE.Color(0x10303a).multiplyScalar(1.5) }));
  win.position.set(0, 1.2, -6.9); sc.add(win);
  return sc;
}

export interface GalleryIO {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  lib: MaterialLibrary;
  q: URLSearchParams;
}

/** Builds the view; returns the per-frame step and, for the booth, a renderer of the split frame. */
export function habitatGallery(io: GalleryIO, view: string): { step: () => void; render?: () => void } {
  const { renderer, scene, camera, lib, q } = io;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envWarm = pmrem.fromScene(habitatRoom(false), 0.03).texture;
  const envCold = pmrem.fromScene(habitatRoom(true), 0.03).texture;
  scene.background = new THREE.Color(0x0b0a09);
  const warm = new THREE.Group(), cold = new THREE.Group();
  scene.add(warm, cold);
  const setLight = (isCold: boolean) => {
    warm.visible = !isCold; cold.visible = isCold;
    if (q.get('env') !== '0') lib.setEnvMap(isCold ? envCold : envWarm, isCold ? 0.5 : 0.9);
  };
  const step = () => lib.update(1 / 60);
  const isCold = q.get('light') === 'cold';

  if (view === 'habitat') {
    const page = Number(q.get('page') ?? 0);
    HABITAT.slice(page * 7, page * 7 + 7).forEach((n, i) => {
      const m = lib.get(n);
      const x = -4.5 + (i % 4) * 3, y = 1.5 - Math.floor(i / 4) * 3.1;
      const p = new THREE.Mesh(n === 'leaf' ? new THREE.PlaneGeometry(2, 2) : panel(2, 2), m);
      p.position.set(x - 0.5, y, 0);
      const s = new THREE.Mesh(sphere(0.5), m);
      s.position.set(x + 0.75, y - 0.45, 0.6);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.3), lib.sign(n, 'label', 6));
      label.position.set(x - 0.5, y + 1.22, 0.01);
      scene.add(p, s, label);
      if (n === 'glass_clear') { const back = new THREE.Mesh(panel(2, 2), lib.get('wood_veneer')); back.position.set(x - 0.5, y, -0.3); scene.add(back); }
    });
    camera.position.set(0, -0.1, 8.6); camera.lookAt(0, -0.1, 0);
    if (isCold) {
      const k = new THREE.PointLight(0xc8e0ff, 30, 40, 2); k.position.set(-5, 4, 4); cold.add(k, new THREE.AmbientLight(0x8090a0, 0.02));
    } else {
      const k = new THREE.PointLight(0xffc58a, 120, 40, 2); k.position.set(-6, 4, 4);
      const f = new THREE.PointLight(0xbcd0ff, 30, 40, 2); f.position.set(6, -3, 4);
      warm.add(k, f, new THREE.AmbientLight(0xffe0c0, 0.04));
    }
    setLight(isCold);
    return { step };
  }

  if (view === 'booth') {
    const name = (q.get('mat') ?? 'wood_veneer') as MaterialName;
    const m = lib.get(name);
    const special = ['leaf', 'water', 'glass_clear', 'bark'].includes(name);
    const wallMat = special ? lib.get(name === 'water' ? 'tile_ceramic' : 'plaster_warm') : m;
    const floorMat = name === 'leaf' || name === 'bark' ? lib.get('soil') : name === 'glass_clear' ? lib.get('terrazzo') : m;
    const wall = new THREE.Mesh(panel(3, 3), wallMat); wall.position.set(0, 1.5, 0);
    const floor = new THREE.Mesh(panel(3, 2), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 1);
    scene.add(wall, floor);
    const ball = new THREE.Mesh(sphere(0.42), m); ball.position.set(0.85, 0.42, 1.05);
    if (name !== 'leaf') scene.add(ball);
    const o = new THREE.Object3D();
    const R = (k: number) => { const x = Math.sin(k * 127.1) * 43758.5453; return x - Math.floor(x); };
    if (name === 'fabric_warm') {
      // per-instance tint: three cushions as one InstancedMesh with instance colours
      const im = new THREE.InstancedMesh(metreUV(new THREE.BoxGeometry(0.45, 0.16, 0.45), 0.45, 0.45), m, 3);
      [0xc26a48, 0x6f8f6a, 0x5d6f9c].forEach((c, i) => {
        im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(-0.95 + i * 0.5, 0.08, 1.2));
        im.setColorAt(i, new THREE.Color(c));
      });
      scene.add(im);
    }
    if (name === 'bark') { const tr = new THREE.Mesh(trunk(0.16, 3), m); tr.position.set(-0.6, 1.5, 0.7); scene.add(tr); }
    if (name === 'glass_clear') {
      const pane = new THREE.Mesh(panel(2.2, 2.4), m); pane.position.set(-0.2, 1.2, 1.4); scene.add(pane);
      for (const [w, h, x, y] of [[2.3, 0.06, -0.2, 2.43], [2.3, 0.06, -0.2, 0.03], [0.06, 2.4, -1.33, 1.2], [0.06, 2.4, 0.93, 1.2]] as const) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), lib.get('brass')); b.position.set(x, y, 1.4); scene.add(b);
      }
      ball.position.set(0.2, 0.42, 0.6);
    }
    if (name === 'water') {
      for (const [w, d, x, z] of [[3, 0.2, 0, 0.1], [3, 0.2, 0, 1.9], [0.2, 2, -1.4, 1], [0.2, 2, 1.4, 1]] as const) {
        const b = new THREE.Mesh(metreUV(new THREE.BoxGeometry(w, 0.12, d), w, d), lib.get('stone_pale')); b.position.set(x, 0.06, z); scene.add(b);
      }
      floor.position.y = 0.02;
      ball.position.set(0.85, 0.42, 0.45);
    }
    if (name === 'leaf') {
      // the atlas itself on the wall, and a small planting: fig leaves round a stem, fern fronds, grass, flowers
      const atlas = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), m); atlas.position.set(-0.85, 2.15, 0.02); scene.add(atlas);
      const stem = new THREE.Mesh(trunk(0.035, 1.6), lib.get('bark')); stem.position.set(0.55, 0.8, 0.9); scene.add(stem);
      const fig = new THREE.InstancedMesh(leafCard(0.13, 'broadleaf'), m, 180);
      for (let i = 0; i < 180; i++) {
        const a = R(i) * Math.PI * 2, el = R(i + 50) * 1.4 - 0.5, r = 0.15 + R(i + 99) * 0.35;
        o.position.set(0.55 + Math.cos(a) * r * Math.cos(el), 1.55 + Math.sin(el) * r, 0.9 + Math.sin(a) * r * Math.cos(el));
        o.rotation.set(-0.4 + R(i + 7) * 1.4, a + Math.PI / 2 + (R(i + 3) - 0.5), (R(i + 11) - 0.5) * 1.6);
        o.updateMatrix(); fig.setMatrixAt(i, o.matrix);
        fig.setColorAt(i, new THREE.Color(1, 1, 1).multiplyScalar(0.8 + R(i + 6) * 0.4));
      }
      scene.add(fig);
      const fern = new THREE.InstancedMesh(leafCard(0.55, 'frond'), m, 10);
      for (let i = 0; i < 10; i++) {
        o.position.set(-0.6, 0.02, 1.25); o.rotation.set(-0.5 - R(i + 20) * 0.5, (i / 10) * Math.PI * 2, 0, 'YXZ');
        o.updateMatrix(); fern.setMatrixAt(i, o.matrix);
      }
      scene.add(fern);
      const grass = new THREE.InstancedMesh(leafCard(0.4, 'blade'), m, 8);
      for (let i = 0; i < 8; i++) {
        o.position.set(-0.05 + (R(i + 30) - 0.5) * 0.3, 0.0, 1.55 + (R(i + 31) - 0.5) * 0.3); o.rotation.set(0, R(i + 32) * Math.PI, 0);
        o.updateMatrix(); grass.setMatrixAt(i, o.matrix);
      }
      scene.add(grass);
      const flw = new THREE.InstancedMesh(leafCard(0.3, 'flower'), m, 8);
      for (let i = 0; i < 8; i++) {
        o.position.set(1.05 + (R(i + 40) - 0.5) * 0.3, 0.0, 1.5 + (R(i + 41) - 0.5) * 0.3); o.rotation.set(-0.1, R(i + 42) * Math.PI, 0, 'YXZ');
        o.updateMatrix(); flw.setMatrixAt(i, o.matrix);
      }
      scene.add(flw);
    }
    // the atrium's evening key (0xffc58a) + sky fill (0xbcd0ff) | the cold emergency point (0xc8e0ff, low)
    const kw = new THREE.PointLight(0xffc58a, 26, 14, 2); kw.position.set(-1.3, 2.7, 2.4);
    const fw = new THREE.PointLight(0xbcd0ff, 5, 14, 2); fw.position.set(1.6, 2.2, 3.2);
    warm.add(kw, fw, new THREE.HemisphereLight(0xffe2c4, 0x2a1d14, 0.12));
    const kc = new THREE.PointLight(0xc8e0ff, 9, 12, 2); kc.position.set(1.3, 2.8, 2.2);
    cold.add(kc, new THREE.HemisphereLight(0x8ca4c0, 0x050608, 0.03));
    const cy = Number(q.get('cy') ?? 1.6), dist = Number(q.get('dist') ?? 5.0);
    camera.position.set(0, cy, dist); camera.lookAt(0, name === 'leaf' ? 1.2 : 1.15, 0.6);
    const tAdv = Number(q.get('time') ?? 1);
    for (let i = 0; i < tAdv * 60; i++) step();
    const render = () => {
      const W = renderer.domElement.width, H = renderer.domElement.height;
      camera.aspect = (W / 2) / H; camera.updateProjectionMatrix();
      renderer.setScissorTest(true);
      for (const [i, c] of [[0, false], [1, true]] as const) {
        renderer.setViewport(i * W / 2, 0, W / 2, H); renderer.setScissor(i * W / 2, 0, W / 2, H);
        setLight(c);
        renderer.render(scene, camera);
      }
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
    };
    return { step, render };
  }

  if (view === 'wayfinding') {
    scene.add(new THREE.Mesh(panel(9.5, 5.4), lib.get('plaster_warm')));
    const items: [string, number][] = [
      ['Biological Systems →', 4], ['← Habitat Atrium\nGarden · Viewport', 4], ['Canteen →', 3.2],
      ['Clinic', 2.6], ['Resident Quarters — Ring A\nCabins 1–6', 4.6], ['↑ West Stair', 3],
      ['P. Halvorsen — Facilities', 4.4], ['HABITAT RING — PLEASE WAIT FOR EQUALISATION', 6], ['SECTOR SEALED', 3.2],
      ['Biological Systems\nDeck 2\n→', 0.6], ['[cup] Café\nclosed', 0.75], ['Habitat Atrium — opened 2031', 4.2],
    ];
    items.forEach(([t, a], i) => {
      const h = a < 1 ? 1.0 : 0.4;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h * a, h), lib.sign(t, 'wayfinding', a));
      mesh.position.set(-2.75 + (i % 3) * 2.75, 1.8 - Math.floor(i / 3) * 0.95, 0.01);
      if (a < 1) mesh.position.set(i === 9 ? -4.25 : 4.25, -0.3, 0.01);
      scene.add(mesh);
    });
    const st = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.35), lib.sign('SUBLEVEL 3', 'stencil', 2.0 / 0.35));
    st.position.set(0, -2.2, 0.01); scene.add(st);
    camera.position.set(0, -0.15, 6.0); camera.lookAt(0, -0.15, 0);
    const k = new THREE.PointLight(isCold ? 0xc8e0ff : 0xffc58a, isCold ? 12 : 60, 30, 2); k.position.set(-2, 2.5, 3.5);
    (isCold ? cold : warm).add(k, new THREE.AmbientLight(isCold ? 0x8090a0 : 0xffe0c0, isCold ? 0.02 : 0.1));
    setLight(isCold);
    return { step };
  }

  // screens3: every state of the habitat kinds, in bezels on a wood-veneer wall
  scene.add(new THREE.Mesh(panel(10.5, 5.8), lib.get('wood_veneer')));
  const bezel = lib.get('plastic_dark');
  // stand-in for the live feed texture (RenderSystem.feed hands an sRGB 8-bit render target texture)
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 288;
  const g = cv.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 288); gr.addColorStop(0, '#3a4448'); gr.addColorStop(1, '#14181a');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 288);
  g.fillStyle = '#c8b8a0'; g.fillRect(200, 60, 110, 200);
  g.fillStyle = '#101214'; g.fillRect(232, 110, 46, 150); g.beginPath(); g.arc(255, 95, 16, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8f0e8'; g.font = '16px monospace'; g.fillText('CAM 01  GALLERY N   WED 22:41:07', 12, 24);
  const feedTex = new THREE.CanvasTexture(cv); feedTex.colorSpace = THREE.SRGBColorSpace;
  const S: [ScreenKind, string | undefined, number, boolean?][] = [
    ['pressure', 'TEST|10:00:00', 1.6], ['pressure', 'EQUALISING', 1.6], ['pressure', 'RELEASED|CHOIR', 1.6], ['pressure', 'OPEN', 1.6],
    ['pressure', 'SECTOR SEALED', 1.6], ['pressure', 'CLEAR THE DOOR', 1.6],
    ['habitat_status', 'WED 22:40|EVENING|NODES ONLINE: 5 OF 6\nNODE 2 — BIO-SYS\nNODE 5 — FAB L2: OFFLINE\nFAB SUBLEVELS: PRESSURE TEST — HR 62 OF 72\nALL STAFF SAFE\nNEXT REPORT 66:00 — CHOIR', 1.7],
    ['habitat_status', 'WED 22:58|EVENING|!PRESSURE ALARM — SECTOR SEALED\nNODES ONLINE: 6 OF 6\nNODE 5 — FAB L2: SUPERVISED\nREMAIN WHERE YOU ARE', 1.7],
    ['feed', 'CAM 01', 16 / 9, true], ['feed', 'CAM 04', 16 / 9],
    ['badge', 'idle|BIOLOGICAL SYSTEMS', 0.75], ['badge', 'read|BIOLOGICAL SYSTEMS', 0.75],
    ['badge', 'accepted|BIOLOGICAL SYSTEMS|P. HALVORSEN', 0.75], ['badge', 'denied|BIOLOGICAL SYSTEMS|BADGE REQUIRED', 0.75],
    ['badge', 'denied|QUARTERS|SECTOR SEALED', 0.75], ['badge', 'off', 0.75],
  ];
  S.forEach(([k, text, aspect, live], i) => {
    const small = k === 'badge';
    const h = small ? 0.62 : 0.8;
    const grp = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(h * aspect + 0.06, h + 0.06, 0.04), bezel);
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), lib.screen(k, { text, aspect, texture: live ? feedTex : undefined }));
    sc.position.z = 0.021;
    grp.add(b, sc);
    if (small) grp.position.set(-3.75 + (i - 10) * 1.5, -2.15, 0.03);
    else grp.position.set(-3.75 + (i % 4) * 2.5, 2.0 - Math.floor(i / 4) * 1.15, 0.03);
    scene.add(grp);
  });
  camera.position.set(0, 0.0, 6.8); camera.lookAt(0, 0.0, 0);
  const k = new THREE.PointLight(0xffc58a, 25, 30, 2); k.position.set(-3, 2.5, 3);
  warm.add(k, new THREE.AmbientLight(0xffe0c0, 0.03));
  setLight(false);
  const tAdv = Number(q.get('time') ?? 2);
  for (let i = 0; i < tAdv * 30; i++) lib.update(1 / 30);
  return { step };
}
