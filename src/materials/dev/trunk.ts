/**
 * Stage 3d (W5) gallery: the trunk / dock materials and the level-6 screens. `src/materials/dev/trunk.html`.
 * Bakes as level 6 does (`levelId 6`: the trunk set at load, screens with the feed OSD patch).
 *
 * Lightings (`&light=`): `lit` (he6's cold-white 5000 K fluorescents), `red` (an emergency red point 3 cd, nothing
 * else), `flood` (the loader's work flood alone: a 5000 K LED spot from 12 m up, steep, hard), `flash` (the player's
 * flashlight alone: 160 cd, 0.42 rad).
 *   ?view=mats[&light=]                    the nine materials (+ dock_steel_wet): 1.7 m panel + sphere / cylinder each
 *   ?view=booth&mat=name                   split in four (lit | red | flood | flash): 3 × 3 m wall + floor + an object
 *   ?view=screens&set=S[&time=s][&light=]  one screen kind in every state: S = mimic | board | gauge | lock |
 *                                          manifest | feed (screens are emissive; &light only changes the bezels)
 *   ?view=screen&kind=k&text=…&w=m&aspect=a&dist=m[&yaw=deg][&time=s]   one screen of width w at distance dist, game
 *                                          camera fov 72° (legibility frames; `\n` in text as %0A)
 *   ?view=stencils[&light=]                the container stencil atlas on a navy and an orange container side
 *   &freeze=1 holds every screen at &time=.
 */
import * as THREE from 'three';
import { createMaterials } from '../index';
import { stencilAtlas6 } from '../stencils6';
import type { GameContext, MaterialLibrary, MaterialName, ScreenKind } from '../../core/types';

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
scene.background = new THREE.Color(0x020202);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 200);
const M = (n: string) => n as MaterialName;

function metreUV(geo: THREE.BufferGeometry, su: number, sv: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}
const panel = (w: number, h: number) => metreUV(new THREE.PlaneGeometry(w, h), w, h);
const sphere = (r: number) => metreUV(new THREE.SphereGeometry(r, 96, 64), Math.PI * 2 * r, Math.PI * r);
/** u around (circumference, m), v along (m). */
const cylinder = (r: number, h: number) => metreUV(new THREE.CylinderGeometry(r, r, h, 64, 1, true), Math.PI * 2 * r, h);

const TRUNK = ['tunnel_shotcrete', 'cable_armour', 'dock_steel', 'dock_steel_wet', 'crane_yellow', 'rope_wire',
  'container_navy', 'container_orange', 'coverall_orange'];
const ROUND = new Set(['cable_armour', 'rope_wire']);
const COLD = 0xe4ecff, RED = 0xff2a1a, FLOOD = 0xfff1de, TORCH = 0xcfe0ff;
type LightK = 'lit' | 'red' | 'flood' | 'flash';
const LIGHTS: LightK[] = ['lit', 'red', 'flood', 'flash'];

/** Reflection environment: a dim tunnel room with cold tubes (lit) or black with one red lamp (dark states). */
function envRoom(dark: boolean) {
  const sc = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 12), new THREE.MeshBasicMaterial({ color: dark ? 0x030303 : 0x4a4d50, side: THREE.BackSide }));
  box.position.y = 1; sc.add(box);
  if (!dark) for (const [x, z] of [[-2.5, -2], [2.5, -2], [-2.5, 2.5], [2.5, 2.5]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 1.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(COLD).multiplyScalar(5) }));
    m.position.set(x, 2.9, z); sc.add(m);
  }
  const r = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.08), new THREE.MeshBasicMaterial({ color: new THREE.Color(RED).multiplyScalar(dark ? 3 : 1) }));
  r.position.set(3, 2.4, -5.9); sc.add(r);
  return sc;
}

interface Rigs { lit: THREE.Group; red: THREE.Group; flood: THREE.Group; flash: THREE.Group }
function rigs(target: THREE.Vector3, cam: THREE.Vector3, scale = 1): Rigs {
  const lit = new THREE.Group();
  const a = new THREE.PointLight(COLD, 11 * scale, 10 * scale, 2); a.position.set(target.x - 0.8, target.y + 2.0, target.z + 1.6);
  const b = new THREE.PointLight(COLD, 7 * scale, 10 * scale, 2); b.position.set(target.x + 1.6, target.y + 2.0, target.z + 2.6);
  lit.add(a, b, new THREE.HemisphereLight(0xdde4ee, 0x262828, 0.06));
  const red = new THREE.Group();
  const pr = new THREE.PointLight(RED, 3 * scale, 9 * scale, 2); pr.position.set(target.x + 1.2, target.y + 1.6, target.z + 1.8);
  red.add(pr);
  // the loader's flood: 12 m up, 30° off vertical, a hard cone (non-shadow on LOW / MEDIUM in the game)
  const flood = new THREE.Group();
  const fs = new THREE.SpotLight(FLOOD, 900 * scale, 40 * scale, 0.32, 0.25, 2);
  fs.position.set(target.x - 4, target.y + 12, target.z + 5); fs.target.position.copy(target);
  flood.add(fs, fs.target);
  const flash = new THREE.Group();
  const fl = new THREE.SpotLight(TORCH, 160, 28, 0.42, 0.5, 2);
  fl.position.copy(cam).add(new THREE.Vector3(0.18, -0.12, 0)); fl.target.position.copy(target);
  flash.add(fl, fl.target);
  scene.add(lit, red, flood, flash);
  return { lit, red, flood, flash };
}

async function main() {
  const t0 = performance.now();
  const lib: MaterialLibrary = await createMaterials({ renderer, levelId: 6, render: { quality: q.get('q') ?? 'high' } } as unknown as GameContext);
  const genMs = performance.now() - t0;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envOn = pmrem.fromScene(envRoom(false), 0.03).texture;
  const envOff = pmrem.fromScene(envRoom(true), 0.03).texture;
  const light = (q.get('light') ?? 'lit') as LightK;
  const setEnv = (on: boolean) => { if (q.get('env') !== '0') lib.setEnvMap(on ? envOn : envOff, on ? 0.6 : 0.25); };
  const pick = (r: Rigs, k: LightK) => { for (const l of LIGHTS) r[l].visible = l === k; setEnv(k === 'lit'); };
  const freeze = q.get('freeze') === '1';
  const time = Number(q.get('time') ?? 2);
  const view = q.get('view') ?? 'mats';
  let step: () => void = freeze ? () => undefined : () => lib.update(1 / 60);
  let render: (() => void) | null = null;
  // (a screen redraws only while it was rendered in the last frames: render as the clock advances)
  const advance = (sec: number) => { for (let i = 0; i < sec * 60; i++) { lib.update(1 / 60); if (i % 4 === 0) renderer.render(scene, camera); } };

  if (view === 'mats') {
    TRUNK.forEach((n, i) => {
      const m = lib.get(M(n));
      const x = -6 + (i % 5) * 3.0, y = 1.6 - Math.floor(i / 5) * 3.1;
      const p = new THREE.Mesh(panel(1.9, 1.9), m); p.position.set(x - 0.4, y, 0); scene.add(p);
      const obj = ROUND.has(n) ? new THREE.Mesh(cylinder(n === "rope_wire" ? 0.0191 * 3 : 0.06, 1.6), m) : new THREE.Mesh(sphere(0.42), m);
      if (ROUND.has(n)) { obj.position.set(x + 0.85, y - 0.1, 0.5); obj.rotation.z = 0.35; } else obj.position.set(x + 0.8, y - 0.55, 0.6);
      scene.add(obj);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.28), lib.sign(n, 'label', 6.8)); label.position.set(x - 0.4, y + 1.12, 0.01);
      scene.add(label);
    });
    camera.position.set(0, 0.1, 10.5); camera.lookAt(0, 0.1, 0);
    const r = rigs(new THREE.Vector3(0, 0, 0), camera.position.clone(), 6);
    (r.lit.children[0] as THREE.PointLight).position.set(-5, 4, 4); (r.lit.children[1] as THREE.PointLight).position.set(5, 4, 4);
    (r.red.children[0] as THREE.PointLight).position.set(0, 2.5, 3);
    const fs = r.flood.children[0] as THREE.SpotLight; fs.angle = 0.6; fs.intensity = 2400; fs.distance = 60;
    (r.flash.children[0] as THREE.SpotLight).angle = 0.62;
    pick(r, light);
  } else if (view === 'booth') {
    const name = q.get('mat') ?? 'tunnel_shotcrete';
    const wallOf: Record<string, string> = { dock_steel: 'tunnel_shotcrete', dock_steel_wet: 'tunnel_shotcrete', cable_armour: 'tunnel_shotcrete', rope_wire: 'crane_yellow', coverall_orange: 'tunnel_shotcrete' };
    const floorOf: Record<string, string> = { tunnel_shotcrete: 'tunnel_shotcrete', crane_yellow: 'dock_steel', container_navy: 'dock_steel', container_orange: 'dock_steel_wet', cable_armour: 'tunnel_shotcrete', rope_wire: 'dock_steel', coverall_orange: 'dock_steel' };
    const wall = new THREE.Mesh(panel(3, 3), lib.get(M(wallOf[name] ?? name))); wall.position.set(0, 1.5, 0);
    const floor = new THREE.Mesh(panel(3, 2.4), lib.get(M(floorOf[name] ?? name))); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 1.2);
    scene.add(wall, floor);
    const m = lib.get(M(name));
    if (ROUND.has(name)) {
      const r0 = name === 'rope_wire' ? 0.019 : 0.06;
      for (let k = 0; k < (name === 'rope_wire' ? 2 : 3); k++) {
        const c = new THREE.Mesh(cylinder(r0, 2.6), m); c.rotation.z = Math.PI / 2; c.position.set(0, 0.5 + k * 0.16, 0.25 + k * 0.05); scene.add(c);
      }
      if (name === 'rope_wire') for (let k = 0; k < 2; k++) { const c = new THREE.Mesh(cylinder(r0, 2.4), m); c.position.set(0.6 + k * 0.2, 1.6, 0.6); scene.add(c); }
    } else if (name.startsWith('container')) {
      const box = new THREE.Mesh(metreUV(new THREE.BoxGeometry(2.4, 1.3, 0.8), 2.4, 1.3), m); box.position.set(0.3, 0.65, 1.1); scene.add(box);
    } else {
      const ball = new THREE.Mesh(sphere(0.42), m); ball.position.set(0.3, 0.42, 1.25); scene.add(ball);
    }
    const cy = Number(q.get('cy') ?? 1.6), dist = Number(q.get('dist') ?? 4.6);
    camera.position.set(0, cy, dist);
    const target = new THREE.Vector3(0, 1.0, 0.6);
    camera.lookAt(target);
    const r = rigs(target, camera.position.clone());
    render = () => {
      const W = renderer.domElement.width, H = renderer.domElement.height;
      camera.aspect = (W / 4) / H; camera.updateProjectionMatrix();
      renderer.setScissorTest(true);
      LIGHTS.forEach((k, i) => {
        renderer.setViewport(i * W / 4, 0, W / 4, H); renderer.setScissor(i * W / 4, 0, W / 4, H);
        pick(r, k);
        renderer.render(scene, camera);
      });
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
    };
  } else if (view === 'screens') {
    const set = q.get('set') ?? 'mimic';
    const wall = new THREE.Mesh(panel(16, 9), lib.get('tunnel_shotcrete')); wall.position.set(0, 0, -0.05); scene.add(wall);
    const bezel = lib.get('painted_dark');
    type Item = { kind: ScreenKind; text: string; aspect: number; w: number; label: string; then?: string; tex?: THREE.Texture };
    const E1 = ['@title HEAD-END REPEATER — DOCK', '@rate 0.35', 'TRUNK: LOS · BUOY: LOS', 'LAST OUTBOUND (BUFFERED): 1 ITEM',
      'MANIFEST 0031-H — DISPATCH VIA MOON POOL — SUBSEA SHUTTLE', 'B-01  14 APR  CLASP ASSY (CERVICAL) × 120', 'B-02  12 MAY  × 120',
      'B-03  09 JUN  × 240', 'B-04  07 JUL  × 240', 'B-05  11 AUG  × 240', 'B-06  08 SEP  × 240', 'B-07  06 OCT  × 240', 'B-08  10 NOV  × 240',
      'B-09  08 DEC  × 240', 'B-10  12 JAN  × 240', 'B-11  02 FEB  × 240', 'B-12  16 FEB  × 240', 'B-13  02 MAR  × 240',
      'B-14  WED 20:41  × 240  — IN WELL', 'TOTAL: CLASP ASSY (CERVICAL) — DISPATCHED 2,880 · IN TRANSFER 240', 'CONSIGNEE: —'];
    const head = E1.slice(0, 4).join('\n');
    let items: Item[] = [];
    if (set === 'mimic') items = ['auto', 'manual', 'pulled', 'cut'].map((t) => ({ kind: 'mimic', text: t, aspect: 5, w: 6, label: `mimic: ${t}` }));
    if (set === 'board') {
      const L = (a: string, b: string, c: string) => ['MOON POOL — DOCK — 2,140 M', `TRANSFER B-14: ${a}`, 'CARGO LOCK: INNER DOOR CLOSED', 'DEWATERING: 34 % — STOPPED', `TETHER: ${b}`, `LOADER DL-2: ${c}`].join('\n');
      items = [
        { kind: 'dock_board', text: '', aspect: 4, w: 6, label: 'board: arrival (empty text)' },
        { kind: 'dock_board', text: L('IN WELL — AWAITING LOCK CYCLE', 'TAUT — BUOY: STANDBY', 'HAZARD — PERSONNEL ON DOCK'), aspect: 4, w: 6, label: 'board: hostile' },
        { kind: 'dock_board', text: L('IN WELL — AWAITING LOCK CYCLE', 'TAUT — BUOY: LINK ACTIVE', 'CONTROL FAULT'), aspect: 4, w: 6, label: 'board: pulled + fault' },
        { kind: 'dock_board', text: L('IN WELL — AWAITING LOCK CYCLE', 'LOS', 'OFFLINE'), aspect: 4, w: 6, label: 'board: cut + offline' },
      ];
    }
    if (set === 'gauge') items = ['pin', '0', '0.43', '1', 'low|0.6', 'fired'].map((t) => ({ kind: 'gauge', text: t, aspect: 1, w: 2.2, label: `gauge: ${t}` }));
    if (set === 'lock') items = [
      'BEACH JOINT — INTERLOCK KEY A\nlocked', 'BEACH JOINT — INTERLOCK KEY A\nKEY A IN — OPEN', 'BEACH JOINT — INTERLOCK KEY A\nFIBRE — LOS',
      'MOON POOL ACCESS — INTERLOCK KEY B\nlocked', 'MOON POOL ACCESS — INTERLOCK KEY B\nopen',
    ].map((t) => ({ kind: 'interlock', text: t, aspect: 1.33, w: 2.6, label: `lock: ${t.split('\n')[1]}` }));
    if (set === 'manifest') items = [
      { kind: 'manifest', text: '', aspect: 1.5, w: 3, label: 'queue6 (empty text = §6.3 queue)' },
      { kind: 'manifest', text: head, then: E1.join('\n'), aspect: 2.29, w: 6, label: `console6 E1 typing (t=${time})` },
      { kind: 'manifest', text: E1.join('\n') + '\n@hl DISPATCHED 2,880', aspect: 2.29, w: 6, label: 'console6 E1: totals highlight' },
      { kind: 'manifest', text: E1.join('\n') + '\n@hl DISPATCHED 2,880\n@cursor CONSIGNEE', aspect: 2.29, w: 6, label: 'console6 E1: cursor on CONSIGNEE' },
    ];
    if (set === 'feed') {
      // a stand-in for the live feed's texture (a dim CCTV picture)
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 224;
      const g = cv.getContext('2d')!;
      const gr = g.createLinearGradient(0, 0, 0, 224); gr.addColorStop(0, '#1a2026'); gr.addColorStop(1, '#3a3f40'); g.fillStyle = gr; g.fillRect(0, 0, 512, 224);
      g.fillStyle = '#5a5e5c'; g.fillRect(80, 150, 350, 18); g.fillRect(120, 120, 20, 40); g.fillRect(370, 120, 20, 40);
      g.fillStyle = '#ff3020'; g.fillRect(440, 60, 12, 12); g.fillStyle = '#ffa030'; g.beginPath(); g.arc(60, 40, 9, 0, 7); g.fill();
      const ft = new THREE.CanvasTexture(cv); ft.colorSpace = THREE.SRGBColorSpace;
      const osd = 'POST 4 — SUB BAY — CAM 2 — 21:07:33';
      items = [
        { kind: 'feed', text: '', aspect: 2.29, w: 6, label: 'feed: no OSD', tex: ft },
        { kind: 'feed', text: osd, aspect: 2.29, w: 6, label: 'feed: OSD camera line (clock runs)', tex: ft },
        { kind: 'feed', text: osd, then: `${osd}\n_SDV TERN — LAUNCHED 20:12\n_LAUNCH AUTHORITY: AAS, L. (LT.) — PALM — LIVE`, aspect: 2.29, w: 6, label: `feed: O1 typing (t=${time})`, tex: ft },
        { kind: 'feed', text: '', aspect: 2.29, w: 6, label: 'feed without texture (NO SIGNAL)' },
      ];
    }
    const cols = items.length > 4 ? 3 : 2;
    const cw = 16 / cols;
    const mats: THREE.MeshStandardMaterial[] = [];
    items.forEach((it, i) => {
      const x = -8 + cw * (i % cols + 0.5), y = 2.6 - Math.floor(i / cols) * (items.length > 4 ? 3.2 : 4.0);
      const w = Math.min(it.w, cw * 0.9), h = w / it.aspect;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.06), bezel); b.position.set(x, y, 0);
      const mat = lib.screen(it.kind, { text: it.text, aspect: it.aspect, texture: it.tex });
      mats.push(mat);
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); sc.position.set(x, y, 0.031);
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(cw * 0.9, 4.5), 0.3), lib.sign(it.label, 'label', Math.min(cw * 0.9, 4.5) / 0.3));
      lab.position.set(x, y - h / 2 - 0.3, 0.01);
      scene.add(b, sc, lab);
    });
    // one second of "already showing", then the rewrites that type in, then &time
    advance(1);
    items.forEach((it, i) => { if (it.then) lib.setScreen(mats[i], it.kind, { text: it.then, texture: it.tex }); });
    // (the pressure-low and fired states count from their write)
    items.forEach((it, i) => { if (!it.then && (it.text.startsWith('low') || it.text === 'fired')) lib.setScreen(mats[i], it.kind, { text: it.text }); });
    advance(time);
    camera.position.set(0, 0, 12.5); camera.lookAt(0, 0, 0);
    const r = rigs(new THREE.Vector3(0, 0, 0), camera.position.clone(), 4);
    pick(r, light);
  } else if (view === 'screen') {
    const kind = (q.get('kind') ?? 'dock_board') as ScreenKind;
    const aspect = Number(q.get('aspect') ?? 4), w = Number(q.get('w') ?? 12), h = w / aspect;
    const text = q.get('text') ?? '';
    const dist = Number(q.get('dist') ?? 20), yaw = THREE.MathUtils.degToRad(Number(q.get('yaw') ?? 0));
    const wall = new THREE.Mesh(panel(w * 3, h * 4), lib.get('tunnel_shotcrete')); wall.position.z = -0.05; scene.add(wall);
    const mat = lib.screen(kind, { text, aspect });
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); scene.add(sc);
    if (q.get('then')) { advance(1); lib.setScreen(mat, kind, { text: q.get('then')! }); }
    advance(time);
    camera.fov = 72; camera.updateProjectionMatrix();
    camera.position.set(Math.sin(yaw) * dist, 0, Math.cos(yaw) * dist); camera.lookAt(0, 0, 0);
    const r = rigs(new THREE.Vector3(0, 0, 0), camera.position.clone(), w / 3);
    pick(r, light);
  } else if (view === 'stencils') {
    const a = stencilAtlas6();
    const floor = new THREE.Mesh(panel(16, 8), lib.get('dock_steel')); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 2); scene.add(floor);
    const L = 6.06, Hc = 2.59;
    ([['container_navy', -3.4, 'B-07'], ['container_orange', 3.4, 'B-14']] as const).forEach(([mn, x, lab]) => {
      const box = new THREE.Mesh(metreUV(new THREE.BoxGeometry(L, Hc, 2.44), L, Hc), lib.get(M(mn))); box.position.set(x, Hc / 2, 0); scene.add(box);
      const put = (label: string, w: number, px: number, py: number) => {
        const geo = a.apply(new THREE.PlaneGeometry(w, w / a.aspect(label)), label);
        const m = new THREE.Mesh(geo, a.material); m.position.set(x + px, py, 1.221); scene.add(m);
      };
      put(lab, 1.3, -1.9, 2.05);
      put('HALCYON BIO-SYSTEMS DIV.', 3.6, 0.6, 1.25);
      put('HBSU 140 031 [4]', 1.9, 1.6, 2.2);
      put('MAX GROSS 30,480 KG', 1.0, -2.2, 0.6);
      put('TARE 2,250 KG', 1.0, -2.2, 0.38);
      put('CLASP ASSY (CERVICAL)', 1.4, 1.9, 0.5);
    });
    const atlas = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: a.texture, transparent: true }));
    atlas.position.set(0, 3.9, -1); if (q.get('atlas') === '1') scene.add(atlas);
    camera.position.set(0, 1.7, 9.5); camera.lookAt(0, 1.4, 0);
    const r = rigs(new THREE.Vector3(0, 1.3, 1.3), camera.position.clone(), 3);
    pick(r, light);
  }

  info.textContent = `materials generated in ${genMs.toFixed(0)} ms   ${view} ${q.get('mat') ?? q.get('set') ?? ''} ${light}`;
  const debug = { fps: 0 };
  let frames = 0, last = performance.now(), acc = 0, cnt = 0;
  const loop = (t: number) => {
    requestAnimationFrame(loop);
    const dt = (t - last) / 1000; last = t; acc += dt; cnt++;
    if (acc > 0.5) { debug.fps = Math.round(cnt / acc); acc = 0; cnt = 0; }
    step();
    if (render) render(); else renderer.render(scene, camera);
    if (++frames === 3) (window as unknown as { __game: unknown }).__game = { ready: true, renderer, debug, lib, genMs };
  };
  requestAnimationFrame(loop);
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  void step;
}
main().catch((e) => { console.error(e); info.textContent = String(e?.stack ?? e); });
