/**
 * DEV ONLY — level-4 kit gallery (stage 3b §8.5, task W9b): every prop of `src/level/l4/kit4.ts` on a grid of
 * 7 × 7 m cells (clean ones on white HPL / epoxy, navy ones on haze grey / non-slip), each built in its own zone
 * builder exactly as a level would (static zone merge + shadow proxy), with its draw calls counted.
 *
 *   /src/level/dev/kit4.html                       overview (all cells, top-down-ish)
 *   ?prop=<name>                                   close-up of one prop (names in the HUD)
 *   ?page=N                                        six cells
 *   &light=cold | flash | dark                     cold 6500 K room light (default) | flashlight only | nothing but emissives
 *   &strips=1  &beacon=1  &valve=0…1  &sump=0…1  &needle=0…4   moving / switched states
 *   &yaw=deg &pitch=deg &dist=m                    camera overrides around the focus
 *   &stand=0                                       no stand-in materials (show W6's fallback as the game would)
 *
 * Until W6 lands, the clinical materials are drawn with dev-only stand-ins (white HPL, #4 stainless, frost, tyvek,
 * haze grey, non-slip) so the props can be judged against the plan's look; the HUD says which.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext, LightDesc, LightHandle, MaterialLibrary, MaterialName } from '../../core/types';
import { createMaterials } from '../../materials/index';
import { LevelBuild } from '../context';
import { defineInstances } from '../props';
import { rng, type Builder } from '../builder';
import * as K from '../l4/kit4';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const lightMode = q.get('light') ?? 'cold';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020304);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.03, 300);
scene.add(camera);

// ── materials (real library, level 4) + dev stand-ins for the clinical set while W6 is pending
const lib = await createMaterials({ renderer, levelId: 4 } as unknown as GameContext);
const dark = lib.get('painted_dark');
const pending = lib.get('stainless') === dark;
const useStand = pending && q.get('stand') !== '0';
const noMaps = { map: null, normalMap: null, roughnessMap: null, metalnessMap: null, aoMap: null };
const STAND: Partial<Record<MaterialName, () => THREE.MeshStandardMaterial>> = {
  wall_clean: () => lib.clone('plastic_white', { ...noMaps, color: 0xf0f2f2, roughness: 0.42, metalness: 0 }),
  floor_epoxy: () => lib.clone('plastic_white', { ...noMaps, color: 0xd9dcdc, roughness: 0.22, metalness: 0 }),
  ceiling_clean: () => lib.clone('plastic_white', { ...noMaps, color: 0xe9ecee, roughness: 0.6, metalness: 0 }),
  stainless: () => lib.clone('plastic_white', { ...noMaps, color: 0xb4babe, roughness: 0.35, metalness: 0.55 }),
  frost: () => lib.clone('plastic_white', { ...noMaps, color: 0xe6f2ff, roughness: 0.85, metalness: 0 }),
  tyvek: () => lib.clone('plastic_white', { ...noMaps, color: 0xeef0ec, roughness: 0.9, metalness: 0 }),
  navy_grey: () => lib.clone('painted_white', { color: 0x9aa3a9 }),
  deck_nonslip: () => lib.clone('floor_rubber', { color: 0x6a7176 }),
};
const standCache = new Map<string, THREE.MeshStandardMaterial>();
const get = (n: MaterialName) => {
  const mk = useStand ? STAND[n] : undefined;
  if (!mk) return lib.get(n);
  let m = standCache.get(n);
  if (!m) { standCache.set(n, (m = mk())); m.name = `${n}_stand`; }
  return m;
};
const materials: MaterialLibrary = { ...lib, get, clone: (n, o) => { const m = get(n).clone(); if (o) m.setValues(o); return m; } };

// ── minimal ctx for LevelBuild (props add no lights; a stub manager covers anything that does)
const handles: LightHandle[] = [];
const lights = {
  add(desc: LightDesc) { const h = { desc, enabled: true, intensityScale: 1, factor: 1, setFlicker() {}, setColor() {}, bindEmissive() {}, remove() {} } as unknown as LightHandle; handles.push(h); return h; },
  setGroup() {}, group: () => [],
};
const ctx = { renderer, scene, camera, materials, levelId: 4, render: { lights, quality: 'high' }, interactables: { add: () => ({}), all: [] }, audio: null } as unknown as GameContext;
const L = new LevelBuild(ctx);
scene.add(L.root);
defineInstances(L);

// ── the gallery
type Kind = 'clean' | 'navy';
interface Entry { name: string; cell: number; kind: Kind; mount: 'floor' | 'wall' | 'ceil'; x?: number; y?: number; z?: number; ry?: number; view?: [number, number, number]; build: (b: Builder) => void }
const R = rng(4);
const names10 = ['HOLM, E.', 'DAHL, K.', 'SUNDE, A.', 'BERG, T.', 'NESS, I.', 'MOE, S.', 'FOSS, L.', 'STRAND, E.', 'HAUGEN, M.', 'LIE, O.'];
const parts: Record<string, unknown> = {};
const E: Entry[] = [
  // clean room
  { name: 'benchIsland', cell: 0, kind: 'clean', mount: 'floor', build: (b) => K.benchIsland(b, L) },
  { name: 'fumeHood', cell: 1, kind: 'clean', mount: 'wall', build: (b) => K.fumeHood(b, L, { label: 'HOOD 2' }) },
  { name: 'ultFreezer', cell: 2, kind: 'clean', mount: 'wall', x: -1.2, build: (b) => K.ultFreezer(b, L) },
  { name: 'labSink', cell: 2, kind: 'clean', mount: 'wall', x: 1.2, build: (b) => K.labSink(b, L) },
  { name: 'penRowWall', cell: 3, kind: 'clean', mount: 'floor', z: -1.5, build: (b) => K.penRow(b, L, { n: 3, cards: ['A1 · S-112\nCOMPLIANT', 'A2 · S-114\nCOMPLIANT', 'A3 · S-117\nCOMPLIANT'] }) },
  { name: 'penRowGlass', cell: 4, kind: 'clean', mount: 'floor', z: -0.8, build: (b) => K.penRow(b, L, { n: 2, back: 'glass', cards: ['B1 · S-120\nCOMPLIANT', 'B2 · S-121\nCOMPLIANT'] }) },
  { name: 'sampleRackFrost', cell: 5, kind: 'clean', mount: 'wall', x: -1.0, build: (b) => K.sampleRack(b, L, R, { frost: true }) },
  { name: 'sampleRack', cell: 5, kind: 'clean', mount: 'wall', x: 1.0, build: (b) => K.sampleRack(b, L, R) },
  { name: 'cradleRack', cell: 6, kind: 'clean', mount: 'wall', y: 0.6, build: (b) => { parts.cradle = K.cradleRack(b, L); } },
  { name: 'lockerBank', cell: 7, kind: 'clean', mount: 'wall', build: (b) => K.lockerBank(b, L, { names: names10, open: [2] }) },
  { name: 'stepOverBench', cell: 8, kind: 'clean', mount: 'floor', build: (b) => K.stepOverBench(b, L, { len: 5.0 }) },
  { name: 'suitRack', cell: 9, kind: 'clean', mount: 'floor', z: -1.2, build: (b) => K.suitRack(b, L, R) },
  { name: 'scrubSink', cell: 10, kind: 'clean', mount: 'wall', build: (b) => K.scrubSink(b, L) },
  { name: 'filingWall', cell: 11, kind: 'clean', mount: 'wall', build: (b) => K.filingWall(b, L, R) },
  { name: 'serverRack', cell: 12, kind: 'clean', mount: 'floor', x: -0.7, build: (b) => K.serverRack(b, L, R) },
  { name: 'serverRack2', cell: 12, kind: 'clean', mount: 'floor', x: 0.0, build: (b) => K.serverRack(b, L, rng(11)) },
  { name: 'nozzleGrid', cell: 13, kind: 'clean', mount: 'wall', x: -1.3, y: 1.6, build: (b) => { parts.nozzles = K.nozzleGrid(b, L); } },
  { name: 'jetPanel', cell: 13, kind: 'clean', mount: 'wall', x: 1.2, build: (b) => { parts.jets = K.jetPanel(b, L, { w: 2.2 }); } },
  { name: 'luminaire', cell: 14, kind: 'clean', mount: 'ceil', x: -0.8, build: (b) => K.luminaire(b, L) },
  { name: 'hepaDiffuser', cell: 14, kind: 'clean', mount: 'ceil', x: 0.8, build: (b) => K.hepaDiffuser(b, L) },
  { name: 'floorStrip', cell: 14, kind: 'clean', mount: 'floor', build: (b) => { K.floorStrip(b, L, -3.0, -2.62, 3.0, -2.62); K.floorStrip(b, L, -3.0, 1.0, 3.0, 1.0); } },
  { name: 'clinicalSign', cell: 15, kind: 'clean', mount: 'wall', build: (b) => { K.clinicalSign(b, L, '← COLD STORE 2 · VIVARIUM', -1.0, 1.9, 0, 1.4, 0.24, '+z'); K.clinicalSign(b, L, 'SURGICAL SUITE ↓', 1.2, 1.9, 0, 1.0, 0.24, '+z'); } },
  { name: 'sticker', cell: 15, kind: 'clean', mount: 'wall', build: (b) => K.sticker(b, 0, 1.3, 0.001, '+z') },
  // navy
  { name: 'booth', cell: 16, kind: 'navy', mount: 'floor', z: -1.0, view: [55, -12, 6.0], build: (b) => K.booth(b, L) },
  { name: 'boothConsole', cell: 16, kind: 'navy', mount: 'floor', z: 0.6, ry: Math.PI, view: [185, -18, 1.9], build: (b) => { parts.console = K.boothConsole(b, L); } },
  { name: 'boom', cell: 17, kind: 'navy', mount: 'floor', x: -1.5, build: (b) => K.boom(b, L) },
  { name: 'cageMesh', cell: 18, kind: 'navy', mount: 'floor', x: 0, z: 0, build: (b) => K.cageMesh(b, L, { x0: -2.4, x1: 2.4, z0: -2.8, z1: 0.6, h: 4.0, faces: ['+z', '-x', '+x'], gaps: [['+z', -0.8, 0.8]] }) },
  { name: 'bentLeaf', cell: 18, kind: 'navy', mount: 'floor', x: -0.8, z: 0.6, build: (b) => K.bentLeaf(b, L, { open: -1.9 }) },
  { name: 'weaponRack', cell: 19, kind: 'navy', mount: 'wall', x: -1.0, build: (b) => K.weaponRack(b, L) },
  { name: 'vestHooks', cell: 19, kind: 'navy', mount: 'wall', x: 1.4, build: (b) => K.vestHooks(b, L) },
  { name: 'ammoCan', cell: 19, kind: 'navy', mount: 'floor', x: 0.6, z: -1.6, build: (b) => { K.ammoCan(b, L); b.at(0.35, 0, 0.05, 0.2, () => K.ammoCan(b, L, { open: true, label: null })); b.at(0.05, 0.155 + 0.02, 0, -0.1, () => K.ammoCan(b, L)); } },
  { name: 'bunk', cell: 20, kind: 'navy', mount: 'floor', z: -1.8, build: (b) => K.bunk(b, L, { made: [true, false] }) },
  { name: 'navyLockers', cell: 20, kind: 'navy', mount: 'wall', x: 2.2, build: (b) => K.navyLockers(b, L, { n: 3, open: [1] }) },
  { name: 'stencil', cell: 21, kind: 'navy', mount: 'wall', build: (b) => { K.stencil(b, 'NAVAL CHECKPOINT 2', 0, 2.4, 0.001, 2.4, 0.4, '+z'); K.stencil(b, 'FR 112', -2.2, 1.0, 0.001, 0.5, 0.2, '+z'); } },
  { name: 'deckLine', cell: 21, kind: 'navy', mount: 'floor', build: (b) => { K.deckLine(b, L, -3, -1.0, 3, -1.0); K.deckLine(b, L, -3, 0.5, 3, 0.5, { color: 'white', w: 0.05 }); } },
  // plant room
  { name: 'pumpSet', cell: 22, kind: 'navy', mount: 'floor', build: (b) => K.pumpSet(b, L) },
  { name: 'pipeTrunk', cell: 23, kind: 'navy', mount: 'floor', x: 1.5, z: -1.5, build: (b) => K.pipeTrunk(b, L) },
  { name: 'sumpGrille', cell: 23, kind: 'navy', mount: 'floor', x: -1.0, z: 0.5, view: [20, -50, 2.6], build: (b) => { parts.sump = K.sumpGrille(b, L); } },
  { name: 'valveLever', cell: 24, kind: 'navy', mount: 'wall', build: (b) => { parts.valve = K.valveLever(b, L); } },
  { name: 'gaugePanel', cell: 24, kind: 'navy', mount: 'wall', y: 2.4, build: (b) => { parts.gauge = K.gaugePanel(b, L); } },
  { name: 'rotBeacon', cell: 24, kind: 'navy', mount: 'wall', y: 3.25, build: (b) => { parts.beacon = K.rotBeacon(b, L); } },
  // tube (a 4 m section with both ribs, and the ring)
  { name: 'tubeRib', cell: 25, kind: 'navy', mount: 'floor', build: (b) => { b.at(0, 0, -2, 0, () => K.tubeRib(b, L)); b.at(0, 0, 2, 0, () => K.tubeRib(b, L)); } },
  { name: 'tubeRoof', cell: 25, kind: 'navy', mount: 'floor', build: (b) => K.tubeRoof(b, L) },
  { name: 'gratedDeck', cell: 25, kind: 'navy', mount: 'floor', build: (b) => K.gratedDeck(b, L) },
  { name: 'bulkheadRing', cell: 26, kind: 'navy', mount: 'floor', build: (b) => K.bulkheadRing(b, L) },
];
const CELL = 7, PER_ROW = 6, WALL_Z = -2.8;
const cellPos = (c: number) => new THREE.Vector3((c % PER_ROW) * CELL * 1.25, 0, -Math.floor(c / PER_ROW) * CELL * 1.25);
const cellKind = new Map<number, Kind>();
for (const e of E) cellKind.set(e.cell, e.kind);

// stage: floor slab, back wall (and a ceiling for ceiling props / the tall navy cells), tube glass for cell 25
const st = L.builder('stage');
for (const [c, kind] of cellKind) {
  const p = cellPos(c), h = kind === 'navy' ? 4.5 : 3.4;
  const fl: MaterialName = kind === 'clean' ? 'floor_epoxy' : 'deck_nonslip', wl: MaterialName = kind === 'clean' ? 'wall_clean' : 'navy_grey';
  if (c === 23) { // a hole for the sump
    const hx = p.x - 1.0, hz = p.z + 0.5;
    st.bx(fl, p.x - 3.5, -0.2, p.z - 3, hx - 0.6, 0, p.z + 3.5).bx(fl, hx + 0.6, -0.2, p.z - 3, p.x + 3.5, 0, p.z + 3.5);
    st.bx(fl, hx - 0.6, -0.2, p.z - 3, hx + 0.6, 0, hz - 0.6).bx(fl, hx - 0.6, -0.2, hz + 0.6, hx + 0.6, 0, p.z + 3.5);
  } else st.bx(fl, p.x - 3.5, -0.2, p.z - 3, p.x + 3.5, 0, p.z + 3.5);
  if (c !== 25 && c !== 26) st.bx(wl, p.x - 3.5, 0, p.z + WALL_Z - 0.3, p.x + 3.5, h, p.z + WALL_Z);
  if (c === 14) st.bx('ceiling_clean', p.x - 3.5, 3.0, p.z - 3, p.x + 3.5, 3.1, p.z + 1.5);
  if (c === 25) for (const s of [-1, 1]) st.quad('glass_clear', p.x + s * 2.0, 1.7, p.z, 4.0, 2.6, s < 0 ? '+x' : '-x');
}
const counts: { name: string; calls: number; signs: number; moving: number; tris: number }[] = [];
const groups = new Map<string, THREE.Object3D[]>();
for (const e of E) {
  const p = cellPos(e.cell);
  const b = L.builder(`kit:${e.name}`);
  const before = L.root.children.length;
  const y = e.mount === 'ceil' ? 3.0 : e.y ?? 0, z = e.mount === 'wall' ? WALL_Z : e.z ?? 0;
  b.push(p.x + (e.x ?? 0), y, p.z + z, e.ry ?? 0);
  e.build(b);
  b.pop();
  groups.set(e.name, L.root.children.slice(before));
}
if (q.get('strips') === '1') K.setStrips(L, 1);
L.finishBuilders();
for (const e of E) {
  const g = L.root.children.find((o) => o.name === `kit:${e.name}`);
  let calls = 0, signs = 0, moving = 0, tris = 0;
  g?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.name.endsWith(':shadow')) return;
    tris += (m.geometry.index?.count ?? 0) / 3;
    if ((m.material as THREE.Material).name.startsWith('sign_')) signs++; else calls++;
  });
  for (const o of groups.get(e.name) ?? []) o.traverse((x) => { if ((x as THREE.Mesh).isMesh) moving++; });
  counts.push({ name: e.name, calls, signs, moving, tris: Math.round(tris) });
  const list = [g, ...(groups.get(e.name) ?? [])].filter(Boolean) as THREE.Object3D[];
  groups.set(e.name, list);
}
L.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.name.endsWith(':shadow')) { m.receiveShadow = true; } });

// moving states
const P = parts as { valve?: K.ValveHandle; sump?: K.SumpHatch; beacon?: K.Beacon; gauge?: K.GaugeNeedle };
P.valve?.set(num('valve', 0));
P.sump?.lift(num('sump', 0));
P.gauge?.set(num('needle', 3.1));
P.beacon?.set(q.get('beacon') === '1');

// ── per-prop view (close-ups and the contact sheet)
function viewOf(name: string) {
  L.root.updateMatrixWorld(true);
  const bx = new THREE.Box3();
  for (const o of groups.get(name) ?? []) bx.expandByObject(o);
  if (bx.isEmpty()) bx.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  const e = E.find((x) => x.name === name)!;
  const c = bx.getCenter(new THREE.Vector3()), s = bx.getSize(new THREE.Vector3());
  const ceil = e.mount === 'ceil';
  const vw = e.view; const yw = (num('yaw', vw?.[0] ?? 28) * Math.PI) / 180, pt = (num('pitch', vw?.[1] ?? (ceil ? 35 : -14)) * Math.PI) / 180;
  const ds = num('dist', e.view?.[2] ?? Math.max(1.6, Math.max(s.x, s.y, s.z) * 0.95 + 0.6));
  const pos = c.clone().addScaledVector(new THREE.Vector3(Math.sin(yw) * Math.cos(pt), -Math.sin(pt), Math.cos(yw) * Math.cos(pt)), ds);
  if (ceil) pos.y = 1.6;
  return { pos, target: c, cell: e.cell };
}
const sheet = q.has('sheet') ? Number(q.get('sheet')) : null;

// ── focus + camera
const focusName = q.get('prop');
const page = q.has('page') ? Number(q.get('page')) : null;
const box = new THREE.Box3();
let focusCells: number[];
if (focusName) {
  L.root.updateMatrixWorld(true);
  for (const o of groups.get(focusName) ?? []) box.expandByObject(o);
  focusCells = [E.find((e) => e.name === focusName)?.cell ?? 0];
} else {
  focusCells = page !== null ? [...cellKind.keys()].filter((c) => Math.floor(c / PER_ROW) === page) : [...cellKind.keys()];
  for (const c of focusCells) { const p = cellPos(c); box.expandByPoint(p.clone().add(new THREE.Vector3(-3.5, 0, -3))).expandByPoint(p.clone().add(new THREE.Vector3(3.5, 2.5, 3.5))); }
}
if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(2, 2, 2));
const centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
const isCeil = focusName ? E.find((e) => e.name === focusName)?.mount === 'ceil' : false;
const yaw = (num('yaw', focusName ? 28 : 0) * Math.PI) / 180, pitch = (num('pitch', isCeil ? 35 : focusName ? -14 : -38) * Math.PI) / 180;
const dist = num('dist', focusName ? Math.max(1.6, Math.max(size.x, size.y, size.z) * 1.15 + 0.8) : Math.max(size.x, size.z) * 0.75);
const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
camera.position.copy(centre).addScaledVector(dir, dist);
if (isCeil) camera.position.y = 1.6;
const controls = new OrbitControls(camera, canvas);
controls.target.copy(centre);
controls.update();

// ── reflections: a dim clean room as the probe (the game captures one per room); none in the dark modes
{
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const k = lightMode === 'cold' ? num('env', 0.35) : 0.02;
  lib.setEnvMap(env, k);
  scene.environment = env;
  scene.environmentIntensity = k;
}

// ── lights
const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x101214, lightMode === 'cold' ? num('hi', 0.25) : lightMode === 'flash' ? 0.015 : 0.0);
scene.add(hemi);
/** Two ceiling points + a key spot that follow the cell being looked at (cold mode). */
const rig: { pts: THREE.PointLight[]; key: THREE.SpotLight | null } = { pts: [], key: null };
function placeRig(cell: number, target: THREE.Vector3) {
  const p = cellPos(cell);
  rig.pts.forEach((l, i) => l.position.set(p.x + (i ? 1.6 : -1.6), 2.9, p.z + 0.5));
  if (rig.key) { rig.key.position.set(target.x + 1.5, target.y + 3, target.z + 3); rig.key.target.position.copy(target); rig.key.target.updateMatrixWorld(); }
}
if (lightMode === 'cold') {
  const single = focusName || sheet !== null;
  const cells = single ? [] : focusCells.length > 8 ? [] : focusCells;
  for (const c of cells) {
    const p = cellPos(c);
    for (const dx of [-1.6, 1.6]) { const l = new THREE.PointLight(0xe8f0ff, num('li', 5), 10, 2); l.position.set(p.x + dx, 2.9, p.z + 0.5); scene.add(l); }
  }
  if (single) {
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xe8f0ff, num('li', 5), 10, 2); rig.pts.push(l); scene.add(l); }
    rig.key = new THREE.SpotLight(0xe8f0ff, num('si', 14), 14, 0.7, 0.6, 2);
    rig.key.castShadow = true;
    scene.add(rig.key, rig.key.target);
    if (focusName) placeRig(focusCells[0], centre);
  } else if (!cells.length) { const d = new THREE.DirectionalLight(0xe8f0ff, 1.6); d.position.set(10, 20, 15); scene.add(d); }
}
if (lightMode === 'flash') {
  const fl = new THREE.SpotLight(0xcfe0ff, 160, 28, 0.42, 0.5, 2);
  fl.castShadow = true;
  fl.shadow.mapSize.set(1024, 1024);
  camera.add(fl); fl.position.set(0.15, 0.25, 0); camera.add(fl.target); fl.target.position.set(0, 0, -1);
}

// ── post (the game's bloom: threshold 0.85, strength 0.55)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.6, 0.85));
composer.addPass(new OutputPass());

// ── contact sheet: 3 × 3 props per page (no bloom), labelled
const TILES = 3;
const sheetNames = sheet !== null ? E.map((e) => e.name).slice(sheet * TILES * TILES, (sheet + 1) * TILES * TILES) : [];
const sheetViews = sheetNames.map(viewOf);
for (let i = 0; i < sheetNames.length; i++) {
  const d = document.createElement('div');
  d.textContent = sheetNames[i];
  d.style.cssText = `position:fixed;left:${(i % TILES) * (100 / TILES) + 0.5}%;top:${Math.floor(i / TILES) * (100 / TILES) + 0.5}%;color:#ff8;font:13px ui-monospace,monospace;text-shadow:0 0 3px #000`;
  document.body.appendChild(d);
}

// ── HUD + hooks for scripts/shot.mjs
const lines = counts.map((c) => {
  const bad = c.calls > 2;
  const t = `${c.name.padEnd(16)} calls ${c.calls}${c.moving ? ` + ${c.moving} moving` : ''}${c.signs ? ` + ${c.signs} atlas` : ''}  tris ${c.tris}`;
  return bad ? `<span class="bad">${t}</span>` : t;
});
hud.innerHTML = q.get('hud') === '0' || sheet !== null ? '' : `level-4 kit — light ${lightMode}${useStand ? ' — DEV STAND-INS for the clinical set (W6 pending)' : pending ? ' — W6 FALLBACK (dark)' : ''}\n` +
  `${focusName ? `prop ${focusName}` : page !== null ? `page ${page}` : 'overview'}\n\n${lines.join('\n')}`;
const info = { ready: true, renderer, state: 'playing', debug: { fps: 0 }, kit: { counts, pending, useStand, parts } };
(window as unknown as { __game: unknown }).__game = info;
if (q.get('dump')) { // material report of one prop's meshes (console.info, for headless checks)
  setTimeout(() => L.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.name.startsWith(`kit:${q.get('dump')}`)) return;
    const t = m.material as THREE.MeshStandardMaterial;
    console.info(`[dump] ${m.name} env=${!!t.envMap} envI=${t.envMapIntensity} metal=${t.metalness} rough=${t.roughness} col=${t.color?.getHexString()} mmap=${!!t.metalnessMap} emI=${t.emissiveIntensity}`);
  }), 500);
}

let last = performance.now(), frames = 0, acc = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const u of L.updaters) u(dt, now / 1000);
  lib.update?.(dt);
  if (sheet !== null) {
    const W = innerWidth, H = innerHeight, tw = Math.floor(W / TILES), th = Math.floor(H / TILES);
    renderer.setScissorTest(true);
    renderer.setClearColor(0x000000); renderer.setScissor(0, 0, W, H); renderer.setViewport(0, 0, W, H); renderer.clear();
    camera.aspect = tw / th; camera.updateProjectionMatrix();
    sheetViews.forEach((v, i) => {
      const x = (i % TILES) * tw, y = H - (Math.floor(i / TILES) + 1) * th;
      camera.position.copy(v.pos); camera.lookAt(v.target); camera.updateMatrixWorld();
      placeRig(v.cell, v.target);
      renderer.setScissor(x + 1, y + 1, tw - 2, th - 2); renderer.setViewport(x, y, tw, th);
      renderer.render(scene, camera);
    });
    renderer.setScissorTest(false);
  } else {
    controls.update();
    composer.render();
  }
  frames++; acc += dt;
  if (acc > 1) { info.debug.fps = Math.round(frames / acc); frames = 0; acc = 0; }
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
