/**
 * DEV ONLY — level-5 kit gallery (stage 3c §8.9, task W8): every prop of `src/level/l5/kit5.ts` on a grid of 7 × 7 m
 * cells (haze-grey or hull-white back walls on non-slip deck), each built in its own zone builder exactly as a level
 * would (static zone merge + shadow proxy + the sign atlas), with its draw calls counted.
 *
 *   /src/level/dev/kit5.html                       overview (all cells)
 *   ?prop=<name>                                   close-up of one prop (names in the HUD)
 *   ?sheet=N                                       contact sheet: 3 × 3 props per page, no bloom
 *   &light=work | red | flash | dark               4000 K work light (default) | red emergency points | flashlight only |
 *                                                  nothing but emissives (strips on)
 *   &strips=1  &beacon=1  &fan=0  &radio=1  &tally=0          switched states
 *   &play=<scare>[&loop=s]                         trays | locker | lamp | turnstile | oilskin | gate (all run at +1 s)
 *   &at=<scare>:<t>                                freeze a scare at t s (mid-motion stills)
 *   &yaw=deg &pitch=deg &dist=m                    camera overrides around the focus
 *   &stand=0                                       no stand-ins for W5's navy-dock materials (the game's fallback)
 *   &zroom=bay                                     zfight tolerance room size (`__game.level`, for the zfight runner)
 *
 * Until W5 lands, `hull_white`, `deck_grate`, `helmet_navy`, `webbing`, `rubber_mat`, `fatigue_navy`, `knit_black`,
 * `wet_steel` are drawn with dev-only stand-ins (the HUD says so).
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
import type { Builder } from '../builder';
import * as K from '../l5/kit5';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const lightMode = q.get('light') ?? 'work';

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
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 300);
scene.add(camera);

// ── materials (real library, level 5) + dev stand-ins for W5's navy-dock set while it is pending
const lib = await createMaterials({ renderer, levelId: 5 } as unknown as GameContext);
const dark = lib.get('painted_dark');
const pending = lib.get('hull_white') === dark;
const useStand = pending && q.get('stand') !== '0';
const noMaps = { map: null, normalMap: null, roughnessMap: null, metalnessMap: null, aoMap: null };
function grateTex(): THREE.CanvasTexture {
  // 0.32 m tile: 8 bearing bars (5 mm at 40 mm) along v, cross rods every 0.08 m
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = '#9aa0a4';
  for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 14, 0, 4, 256);
  for (let j = 0; j < 4; j++) g.fillRect(0, j * 64 + 30, 256, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 0.32, 1 / 0.32); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; // (stand-in only: an alpha-tested grate vanishes in its mips)
  return t;
}
const STAND: Partial<Record<MaterialName, () => THREE.MeshStandardMaterial>> = {
  hull_white: () => lib.clone('painted_white', { color: 0xdcdad2 }),
  deck_grate: () => lib.clone('steel_raw', { ...noMaps, map: grateTex(), alphaTest: 0.5, side: THREE.DoubleSide, color: 0xffffff, metalness: 0.6, roughness: 0.5 }),
  wet_steel: () => lib.clone('steel_raw', { ...noMaps, color: 0x3a3e40, roughness: 0.06, metalness: 0.2 }),
  fatigue_navy: () => lib.clone('fabric', { color: 0x3a4352 }),
  knit_black: () => lib.clone('fabric', { color: 0x161616 }),
  helmet_navy: () => lib.clone('plastic_dark', { ...noMaps, color: 0x3d4752, roughness: 0.78, metalness: 0 }),
  webbing: () => lib.clone('fabric', { color: 0x7a7c68 }),
  rubber_mat: () => lib.clone('floor_rubber', { color: 0x2b2d2f }),
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
const ctx = { renderer, scene, camera, materials, levelId: 5, render: { lights, quality: 'high' }, interactables: { add: () => ({}), all: [] }, audio: null } as unknown as GameContext;
const L = new LevelBuild(ctx);
scene.add(L.root);
defineInstances(L);

// ── the gallery
type Wall = 'grey' | 'hull' | 'none';
interface Entry { name: string; cell: number; mount: 'floor' | 'wall' | 'ceil'; x?: number; y?: number; z?: number; ry?: number; view?: [number, number, number]; build: (b: Builder) => void }
const P: Record<string, unknown> = {};
const cellWall = new Map<number, Wall>([[8, 'hull'], [9, 'hull'], [19, 'hull'], [22, 'hull'], [25, 'hull']]);
const E: Entry[] = [
  // gatehouse
  { name: 'turnstile', cell: 0, mount: 'floor', x: -1.4, view: [35, -18, 2.6], build: (b) => { b.at(-0.5, 0, 0, 0, () => { P.turn = K.turnstile(b, L, { name: 'dev_turn_a' }); }); b.at(0.5, 0, 0, 0, () => K.turnstile(b, L, { name: 'dev_turn_b' })); } },
  { name: 'fence', cell: 0, mount: 'floor', x: -3.5, build: (b) => K.fence(b, L, { len: 1.1 }) },
  { name: 'equipmentGate', cell: 0, mount: 'floor', x: 1.6, view: [30, -20, 3.6], build: (b) => K.equipmentGate(b, L) },
  { name: 'guardBooth', cell: 1, mount: 'floor', z: -0.8, view: [20, -10, 6.5], build: (b) => K.guardBooth(b, L, { sides: ['-x'] }) },
  { name: 'boothCounter', cell: 1, mount: 'floor', z: -2.5, view: [10, -20, 3.2], build: (b) => { P.booth = K.boothCounter(b, L); } },
  { name: 'boardFrame', cell: 2, mount: 'wall', x: -1.5, y: 2.0, build: (b) => { P.board = K.boardFrame(b, L, { w: 1.6, h: 0.8 }); } },
  { name: 'noticeBoard', cell: 2, mount: 'wall', x: 1.4, y: 1.5, build: (b) => K.noticeBoard(b, L) },
  { name: 'firstAidCabinet', cell: 2, mount: 'wall', x: -2.8, y: 1.0, build: (b) => K.firstAidCabinet(b, L) },
  { name: 'clearingBarrel', cell: 3, mount: 'floor', x: 2.0, z: -0.5, build: (b) => K.clearingBarrel(b, L) },
  { name: 'watchDesk', cell: 3, mount: 'floor', x: -0.8, z: -0.5, ry: Math.PI, view: [160, -22, 3.4], build: (b) => { P.desk = K.watchDesk(b, L); } },
  // duty
  { name: 'filingCabinets', cell: 4, mount: 'wall', x: -1.5, build: (b) => K.filingCabinets(b, L, { open: 0 }) },
  { name: 'wallCamera', cell: 4, mount: 'wall', x: 1.0, y: 2.8, view: [30, 10, 1.6], build: (b) => { P.cam = K.wallCamera(b, L); } },
  { name: 'wallShelf', cell: 4, mount: 'wall', x: 1.4, y: 1.2, build: (b) => K.wallShelf(b, L) },
  // ready
  { name: 'lockerBank', cell: 5, mount: 'floor', z: -0.6, view: [25, -10, 5.0], build: (b) => {
    P.lockers = K.lockerBank(b, L, { len: 5.0, sides: 2, movable: [['+z', 4, 0.12], ['+z', 3], ['+z', 5]], ajar: [['+z', 1]], names: { '+z7': 'BREKKE' } });
  } },
  { name: 'looseHelmet', cell: 5, mount: 'floor', view: [30, -20, 3.0], build: () => { /* placed after the bank (needs its shelf point) */ } },
  { name: 'bench5', cell: 5, mount: 'floor', z: 1.4, build: (b) => K.bench5(b, L) },
  { name: 'gearCrate', cell: 6, mount: 'floor', x: -1.8, build: (b) => K.gearCrate(b, L) },
  { name: 'crateStack', cell: 6, mount: 'floor', x: 1.2, view: [30, -18, 4.0], build: (b) => K.crateStack(b, L, { w: 2.0, d: 2.0, h: 1.2, seed: 4 }) },
  { name: 'floorMat', cell: 6, mount: 'floor', build: (b) => K.floorMat(b, L, { x0: -3.0, z0: 1.4, x1: -0.6, z1: 2.6 }) },
  { name: 'kitRack', cell: 7, mount: 'wall', view: [20, -12, 5.0], build: (b) => { P.kit = K.kitRack(b, L, { len: 4.8 }); } },
  { name: 'helmetRow', cell: 7, mount: 'wall', build: (b) => { for (const x of [-1.8, -0.6, 0.6, 1.8]) b.at(x, 2.15, 0.3, 0, () => K.helmetRow(b, L, { seed: Math.round(x * 10) })); } },
  // spine / crawl
  { name: 'pipeRiser', cell: 8, mount: 'wall', x: -1.0, view: [30, -12, 3.4], build: (b) => { K.pipeRiser(b, L); b.at(2.0, 0, 0, 0, () => K.pipeRiser(b, L, { tag: 'CHILLED WATER ↓' })); } },
  { name: 'hullRib', cell: 8, mount: 'floor', z: 0.6, view: [80, -5, 4.2], build: (b) => K.hullRib(b, L, { w: 3.6, legs: 'both' }) },
  { name: 'fireHoseBox', cell: 8, mount: 'wall', x: -0.1, y: 1.2, build: (b) => K.fireHoseBox(b, L) },
  { name: 'crawl', cell: 9, mount: 'floor', view: [20, -40, 4.0], build: (b) => {
    K.grating(b, L, { x0: -3.0, z0: -0.6, x1: 3.0, z1: 0.6 });
    b.at(0, -0.03, 0, 0, () => K.crawlJoists(b, L, { len: 6.0 }));
    for (const s of [-1, 1]) b.at(0, -1.4, s * 0.6, s > 0 ? Math.PI : 0, () => K.pipeBundle(b, L, { len: 6.0 }));
    for (const s of [-1, 1]) K.strip5(b, L, -2.9, s * 0.5, 2.9, s * 0.5, { y: -1.4, ch: 'red' });
  } },
  { name: 'rail', cell: 9, mount: 'floor', build: (b) => K.rail(b, L, { pts: [[-3.0, 1.6], [0.0, 1.6], [0.0, 2.6]], h: 1.0 }) },
  // magazine / armoury
  { name: 'ammoTinRack', cell: 10, mount: 'wall', x: -1.0, view: [25, -10, 4.0], build: (b) => b.at(0, 0, 0.5, 0, () => { P.rack = K.ammoTinRack(b, L, { len: 3.0 }); }) },
  { name: 'bulkheadLamp', cell: 10, mount: 'wall', x: 1.8, y: 2.3, view: [35, 0, 1.4], build: (b) => { P.lamp = K.bulkheadLamp(b, L, { breakable: true, floorY: 0, name: 'dev_lamp' }); } },
  { name: 'fireBoard', cell: 10, mount: 'wall', x: 2.3, y: 1.3, build: (b) => K.fireBoard(b, L) },
  { name: 'cageRack', cell: 11, mount: 'wall', x: -1.2, view: [25, -8, 3.8], build: (b) => { P.cage = K.cageRack(b, L); } },
  { name: 'issueDesk', cell: 11, mount: 'floor', x: 2.0, z: 0.5, build: (b) => K.issueDesk(b, L) },
  // quarters
  { name: 'tripleBunk', cell: 12, mount: 'floor', x: -1.0, z: -1.4, view: [30, -10, 3.8], build: (b) => K.tripleBunk(b, L) },
  { name: 'openShelf', cell: 12, mount: 'wall', x: 1.6, build: (b) => { const s = K.openShelf(b, L); P.shelf = s; } },
  { name: 'bunkRadio', cell: 12, mount: 'wall', x: 1.6, y: 1.1, z: 0.15, view: [20, -10, 0.9], build: (b) => b.at(0, 0, 0.17, 0, () => { P.radio = K.bunkRadio(b, L); }) },
  { name: 'messTable', cell: 13, mount: 'floor', x: -1.4, z: 1.0, build: (b) => K.messTable(b, L) },
  { name: 'servingCounter', cell: 13, mount: 'wall', view: [10, -20, 4.5], build: (b) => K.servingCounter(b, L, { len: 5.0, wells: 3, wellsFrom: 0.2 }) },
  { name: 'trayStack', cell: 13, mount: 'wall', x: -1.4, y: 1.0, z: 0.3, view: [15, -25, 3.6], build: (b) => { P.trays = K.trayStack(b, L, { keepOut: [[-1.2, 2.55, 1.2, 4.45]] }); } },
  { name: 'galleyRange', cell: 14, mount: 'wall', x: -1.4, build: (b) => K.galleyRange(b, L) },
  { name: 'prepTable', cell: 14, mount: 'floor', x: 1.4, z: 0.2, build: (b) => K.prepTable(b, L) },
  { name: 'frostedWindow', cell: 15, mount: 'wall', y: 1.5, view: [10, -5, 3.2], build: (b) => { P.win = K.frostedWindow(b, L); } },
  { name: 'oilskin', cell: 15, mount: 'wall', view: [10, -5, 3.2], build: () => { /* behind the window, placed below */ } },
  { name: 'sinkRow', cell: 16, mount: 'wall', view: [20, -12, 3.2], build: (b) => { P.sinks = K.sinkRow(b, L); } },
  { name: 'showerStalls', cell: 17, mount: 'wall', view: [25, -10, 3.6], build: (b) => K.showerStalls(b, L) },
  { name: 'drainGrate', cell: 17, mount: 'floor', x: 2.6, z: 1.5, build: (b) => K.drainGrate(b, L) },
  { name: 'drainGrille', cell: 18, mount: 'floor', x: -1.0, z: 0.5, view: [20, -45, 2.6], build: (b) => { P.drain = K.drainGrille(b, L); } },
  { name: 'strip5', cell: 18, mount: 'floor', build: (b) => { K.strip5(b, L, 0.5, -1.0, 3.0, -1.0); K.strip5(b, L, 0.5, -0.5, 3.0, -0.5, { ch: 'red' }); } },
  // sub bay
  { name: 'galleryDeck', cell: 19, mount: 'floor', view: [25, -15, 6.0], build: (b) => {
    K.galleryDeck(b, L, { x0: -3.4, x1: 1.0, z0: -2.8, z1: -0.4, y: 2.4, rails: ['+z', '+x'], parapets: [['+z', -3.2, -1.2]], wall: '-z' });
  } },
  { name: 'stairDressing', cell: 19, mount: 'floor', view: [60, -12, 6.0], build: (b) => K.stairDressing(b, L, { stair: { x0: 1.2, x1: 2.6, z0: 2.6, dir: -1, risers: 8, rise: 0.3, tread: 0.5625 } }) },
  { name: 'equipmentBox', cell: 20, mount: 'floor', x: -1.6, z: 0.2, build: (b) => K.equipmentBox(b, L) },
  { name: 'crateStackCD', cell: 20, mount: 'floor', x: 1.8, z: 0.0, build: (b) => K.crateStack(b, L, { w: 1.4, d: 2.0, h: 2.0, seed: 9, palette: 'grey', label: 'TERN — BATTERY CELLS' }) },
  { name: 'forklift', cell: 21, mount: 'floor', view: [40, -12, 5.0], build: (b) => K.forklift(b, L) },
  { name: 'gasBottleRack', cell: 22, mount: 'wall', x: -1.0, build: (b) => b.at(0, 0, 0.45, 0, () => K.gasBottleRack(b, L)) },
  { name: 'rotBeacon', cell: 22, mount: 'wall', x: 2.0, y: 3.0, build: (b) => { P.beacon = K.rotBeacon(b, L); } },
  { name: 'diveSuits', cell: 23, mount: 'wall', view: [20, -8, 4.5], build: (b) => K.diveSuits(b, L) },
  { name: 'decompressionChamber', cell: 24, mount: 'floor', view: [40, -12, 5.5], build: (b) => K.decompressionChamber(b, L) },
  { name: 'cableTray', cell: 25, mount: 'wall', y: 2.3, view: [20, -10, 4.0], build: (b) => K.cableTray(b, L, { len: 6.0, led: 'amber' }) },
  { name: 'trunkCable', cell: 25, mount: 'floor', view: [20, -25, 4.0], build: (b) => K.trunkCable(b, L, { pts: [[-3.2, 0.13, -2.4], [-1.5, 0.13, -1.9], [0.0, 0.5, -2.5], [1.5, 0.13, -2.0], [3.2, 0.13, -2.2]] }) },
  { name: 'emergencyLamps', cell: 26, mount: 'wall', y: 2.2, view: [20, -5, 3.0], build: (b) => {
    b.at(-1.5, 0, 0, 0, () => K.bulkheadLamp(b, L, { color: 'red' }));
    b.at(0.0, 0, 0, 0, () => K.bulkheadLamp(b, L, { color: 'white' }));
    b.at(1.5, 0.6, 0.6, 0, () => K.bulkheadLamp(b, L, { color: 'amber', mount: 'ceiling', caged: false }));
  } },
  { name: 'navySign', cell: 26, mount: 'wall', build: (b) => { K.navySign(b, 'BILGE ACCESS — CRAWLWAY TO MAGAZINE — CROUCH', 0, 1.3, 0.001, 2.8, 0.2, '+z'); K.hullNumber(b, 'FR 112', -2.4, 2.9, 0.001, '+z'); K.navySign(b, 'TRUNK — HEAD-END 200 M ←', 1.2, 0.8, 0.001, 1.8, 0.16, '+z', { plate: true }); } },
];
const CELL = 7, PER_ROW = 6, WALL_Z = -2.8;
const cellPos = (c: number) => new THREE.Vector3((c % PER_ROW) * CELL * 1.25, 0, -Math.floor(c / PER_ROW) * CELL * 1.25);
const cells = new Set(E.map((e) => e.cell));

// stage: floor slab, back wall (hull cells get hull_white); holes for the crawl (9) and the drain (18); a window opening (15)
const st = L.builder('stage');
for (const c of cells) {
  const p = cellPos(c), h = 4.5, wall: Wall = cellWall.get(c) ?? 'grey', wm: MaterialName = wall === 'hull' ? 'hull_white' : 'navy_grey';
  if (c === 9) {
    st.bx('deck_nonslip', p.x - 3.5, -0.2, p.z - 3, p.x + 3.5, 0, p.z - 0.6).bx('deck_nonslip', p.x - 3.5, -0.2, p.z + 0.6, p.x + 3.5, 0, p.z + 3.5);
    st.bx('deck_nonslip', p.x - 3.5, -0.2, p.z - 0.6, p.x - 3.0, 0, p.z + 0.6).bx('deck_nonslip', p.x + 3.0, -0.2, p.z - 0.6, p.x + 3.5, 0, p.z + 0.6);
    st.bx('floor_plate', p.x - 3.0, -1.6, p.z - 0.6, p.x + 3.0, -1.4, p.z + 0.6); // bilge plate floor
    for (const s of [-1, 1]) st.bx('hull_white', p.x - 3.0, -1.4, p.z + s * 0.6 - (s > 0 ? 0 : 0.2), p.x + 3.0, -0.2, p.z + s * 0.6 + (s > 0 ? 0.2 : 0));
    for (const s of [-1, 1]) st.bx('hull_white', p.x + s * 3.0 - (s > 0 ? 0 : 0.2), -1.4, p.z - 0.6, p.x + s * 3.0 + (s > 0 ? 0.2 : 0), -0.2, p.z + 0.6);
  } else if (c === 18) {
    const hx = p.x - 1.0, hz = p.z + 0.5;
    st.bx('deck_nonslip', p.x - 3.5, -0.2, p.z - 3, hx - 0.5, 0, p.z + 3.5).bx('deck_nonslip', hx + 0.5, -0.2, p.z - 3, p.x + 3.5, 0, p.z + 3.5);
    st.bx('deck_nonslip', hx - 0.5, -0.2, p.z - 3, hx + 0.5, 0, hz - 0.5).bx('deck_nonslip', hx - 0.5, -0.2, hz + 0.5, hx + 0.5, 0, p.z + 3.5);
  } else st.bx('deck_nonslip', p.x - 3.5, -0.2, p.z - 3, p.x + 3.5, 0, p.z + 3.5);
  if (c === 15) {
    // back wall with the 2.0 × 1.0 window opening at y 1.0 … 2.0, a 1.2 m-deep lit cold room behind it
    const z0 = p.z + WALL_Z - 0.3, z1 = p.z + WALL_Z;
    st.bx(wm, p.x - 3.5, 0, z0, p.x - 1.0, h, z1).bx(wm, p.x + 1.0, 0, z0, p.x + 3.5, h, z1);
    st.bx(wm, p.x - 1.0, 0, z0, p.x + 1.0, 1.0, z1).bx(wm, p.x - 1.0, 2.0, z0, p.x + 1.0, h, z1);
    st.bx('stainless', p.x - 1.6, 0, z0 - 1.25, p.x + 1.6, 0.02, z0).bx('stainless', p.x - 1.6, 2.6, z0 - 1.25, p.x + 1.6, 2.62, z0);
    st.bx('stainless', p.x - 1.6, 0, z0 - 1.27, p.x + 1.6, 2.6, z0 - 1.25);
    for (const s of [-1, 1]) st.bx('stainless', p.x + s * 1.6 - (s > 0 ? 0 : 0.02), 0, z0 - 1.25, p.x + s * 1.6 + (s > 0 ? 0.02 : 0), 2.6, z0);
  } else if (c !== 24 && c !== 21) st.bx(wm, p.x - 3.5, 0, p.z + WALL_Z - 0.3, p.x + 3.5, h, p.z + WALL_Z);
}
// stand-in stair (W4 builds solid treads like this) under the stair dressing of cell 19
{ const p = cellPos(19); for (let k = 0; k < 8; k++) { const za = p.z + 2.6 - 0.5625 * k, zb = za - 0.5625; st.bx('steel_raw', p.x + 1.2, 0, zb, p.x + 2.6, 0.3 * (k + 1), za); } }
// cold-room glow + the oilskin behind the window's clear corner
const coldLight = new THREE.PointLight(0xdbe8ff, 1.2, 4, 2);
{ const p = cellPos(15); coldLight.position.set(p.x + 0.6, 2.3, p.z + WALL_Z - 0.9); scene.add(coldLight); }

const counts: { name: string; calls: number; shared: number; signs: number; moving: number; tris: number }[] = [];
const groups = new Map<string, THREE.Object3D[]>();
for (const e of E) {
  const p = cellPos(e.cell);
  const b = L.builder(`kit:${e.name}`);
  const before = L.root.children.length;
  const y = e.mount === 'ceil' ? 3.0 : e.y ?? 0, z = e.mount === 'wall' ? WALL_Z + (e.z ?? 0) : e.z ?? 0;
  b.push(p.x + (e.x ?? 0), y, p.z + z, e.ry ?? 0);
  e.build(b);
  if (e.name === 'looseHelmet') {
    const lk = P.lockers as ReturnType<typeof K.lockerBank> | undefined;
    const door = lk?.door('+z', 4);
    if (door) { b.pop(); b.push(0, 0, 0, 0); b.at(door.shelf.x, door.shelf.y, door.shelf.z, 0, () => { P.helmet = K.looseHelmet(b, L); }); }
  }
  if (e.name === 'oilskin') {
    const w = P.win as { clear: THREE.Vector3 } | undefined;
    if (w) { b.pop(); b.push(0, 0, 0, 0); b.at(w.clear.x + 0.3, w.clear.y + 1.08, w.clear.z - 0.5, 0, () => { P.oil = K.oilskin(b, L); }); }
  }
  b.pop();
  groups.set(e.name, L.root.children.slice(before));
}
if (q.get('strips') === '1' || lightMode === 'dark' || lightMode === 'red') K.setStrips5(L, 'emerg', 1);
L.finishBuilders();
const SHARED = /^(k5_strip_|k5_nightlight|k5_lens_)/;
for (const e of E) {
  const g = L.root.children.find((o) => o.name === `kit:${e.name}`);
  let calls = 0, shared = 0, signs = 0, moving = 0, tris = 0;
  g?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.name.endsWith(':shadow')) return;
    tris += (m.geometry.index?.count ?? 0) / 3;
    const n = (m.material as THREE.Material).name;
    if (n.startsWith('sign_')) signs++; else if (SHARED.test(n)) shared++; else calls++;
  });
  for (const o of groups.get(e.name) ?? []) o.traverse((x) => { if ((x as THREE.Mesh).isMesh) moving++; });
  counts.push({ name: e.name, calls, shared, signs, moving, tris: Math.round(tris) });
  const list = [g, ...(groups.get(e.name) ?? [])].filter(Boolean) as THREE.Object3D[];
  groups.set(e.name, list);
}
L.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.name.endsWith(':shadow')) m.receiveShadow = true; });

// ── switched states + scares
type Parts = {
  turn?: K.Turnstile; lockers?: ReturnType<typeof K.lockerBank>; helmet?: K.LooseHelmet; trays?: K.TrayStack; lamp?: K.BulkheadLamp; oil?: K.Oilskin;
  booth?: ReturnType<typeof K.boothCounter>; radio?: K.BunkRadio; beacon?: K.Beacon; drain?: K.SumpHatch; cam?: K.WallCamera;
};
const PP = P as Parts;
PP.beacon?.set(q.get('beacon') === '1' || lightMode === 'dark');
PP.radio?.set(q.get('radio') === '1');
if (q.get('fan') === '0') PP.booth?.fan.at(0);
if (q.get('tally') === '0') PP.cam?.setTally(null);
PP.drain?.lift(num('drain', 0));
const slam = PP.lockers?.door('+z', 4);
const scares: Record<string, { play(): number; at(t: number): void }> = {
  trays: { play: () => PP.trays?.fall().dur ?? 0, at: (t) => PP.trays?.at(t) },
  lamp: { play: () => PP.lamp?.pop().dur ?? 0, at: (t) => PP.lamp?.at(t) },
  turnstile: { play: () => PP.turn?.click() ?? 0, at: (t) => PP.turn?.at(t / 0.42 / 3) },
  oilskin: { play: () => PP.oil?.swing().dur ?? 0, at: (t) => PP.oil?.at(t) },
  locker: {
    play: () => {
      slam?.set(0.12);
      for (const i of [3, 4, 5]) PP.lockers?.door('+z', i)?.rattle(1.2);
      setTimeout(() => { slam?.bang(); setTimeout(() => PP.helmet && slam && PP.helmet.fall(slam.centre.clone().add(slam.normal.clone().multiplyScalar(2.5)).setY(0)), 100); }, 1200);
      return 5.0;
    },
    at: (t) => {
      if (!slam || !PP.helmet) return;
      if (t < 1.2) slam.set(0.12); else slam.at(t - 1.2);
      PP.helmet.fall(slam.centre.clone().add(slam.normal.clone().multiplyScalar(2.5)).setY(0));
      PP.helmet.at(Math.max(0, t - 1.3));
    },
  },
};
const play = q.get('play');
if (play && scares[play]) {
  const loop = num('loop', 0);
  setTimeout(function run() { scares[play].play(); if (loop > 0) setTimeout(run, loop * 1000); }, 1000);
}
const atq = q.get('at');
if (atq) { const [nm, tv] = atq.split(':'); setTimeout(() => scares[nm]?.at(Number(tv)), 50); }

// ── per-prop view (close-ups and the contact sheet)
function viewOf(name: string) {
  L.root.updateMatrixWorld(true);
  const bx = new THREE.Box3();
  for (const o of groups.get(name) ?? []) if (o.visible) bx.expandByObject(o);
  if (bx.isEmpty()) bx.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  const e = E.find((x) => x.name === name)!;
  const c = bx.getCenter(new THREE.Vector3()), s = bx.getSize(new THREE.Vector3());
  const ceil = e.mount === 'ceil';
  const vw = e.view; const yw = (num('yaw', vw?.[0] ?? 28) * Math.PI) / 180, pt = (num('pitch', vw?.[1] ?? (ceil ? 35 : -14)) * Math.PI) / 180;
  const ds = num('dist', e.view?.[2] ?? Math.max(1.6, Math.max(s.x, s.y, s.z) * 0.95 + 0.6));
  const pos = c.clone().addScaledVector(new THREE.Vector3(Math.sin(yw) * Math.cos(pt), -Math.sin(pt), Math.cos(yw) * Math.cos(pt)), ds);
  return { pos, target: c, cell: e.cell };
}
const sheet = q.has('sheet') ? Number(q.get('sheet')) : null;

// ── focus + camera
const focusName = q.get('prop');
const box = new THREE.Box3();
let focusCells: number[];
let camPos: THREE.Vector3, centre: THREE.Vector3;
if (focusName && E.some((e) => e.name === focusName)) {
  const v = viewOf(focusName);
  camPos = v.pos; centre = v.target; focusCells = [v.cell];
} else {
  focusCells = [...cells];
  for (const c of focusCells) { const p = cellPos(c); box.expandByPoint(p.clone().add(new THREE.Vector3(-3.5, 0, -3))).expandByPoint(p.clone().add(new THREE.Vector3(3.5, 2.5, 3.5))); }
  centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const yaw = (num('yaw', 0) * Math.PI) / 180, pitch = (num('pitch', -38) * Math.PI) / 180, dist = num('dist', Math.max(size.x, size.z) * 0.75);
  camPos = centre.clone().addScaledVector(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)), dist);
}
camera.position.copy(camPos);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(centre);
controls.update();

// ── reflections: a dim room probe in the work light; almost none in the dark modes
{
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const k = lightMode === 'work' ? num('env', 0.3) : 0.02;
  lib.setEnvMap(env, k);
  for (const m of standCache.values()) { m.envMap = env; m.envMapIntensity = k; }
  scene.environment = env;
  scene.environmentIntensity = k;
}

// ── lights: work = 4000 K fluorescents (two points + a key spot following the cell); red = two dim red emergency
// points per cell; flash = a camera flashlight; dark = nothing but emissives
const hemi = new THREE.HemisphereLight(0xfff1de, 0x101214, lightMode === 'work' ? num('hi', 0.22) : lightMode === 'flash' ? 0.012 : 0.0);
scene.add(hemi);
const rig: { pts: THREE.PointLight[]; key: THREE.SpotLight | null } = { pts: [], key: null };
function placeRig(cell: number, target: THREE.Vector3) {
  const p = cellPos(cell);
  rig.pts.forEach((l, i) => l.position.set(p.x + (i ? 1.6 : -1.6), 3.0, p.z + 0.5));
  if (rig.key) { rig.key.position.set(target.x + 1.5, target.y + 3, target.z + 3); rig.key.target.position.copy(target); rig.key.target.updateMatrixWorld(); }
}
const single = !!focusName || sheet !== null;
if (lightMode === 'work' || lightMode === 'red') {
  const col = lightMode === 'work' ? 0xfff0dc : 0xff2a14, I = lightMode === 'work' ? num('li', 5) : num('li', 1.6), D = lightMode === 'work' ? 10 : 7;
  if (single) {
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(col, I, D, 2); rig.pts.push(l); scene.add(l); }
    if (lightMode === 'work') { rig.key = new THREE.SpotLight(0xfff0dc, num('si', 12), 14, 0.7, 0.6, 2); rig.key.castShadow = true; scene.add(rig.key, rig.key.target); }
    else rig.pts.forEach((l) => { l.castShadow = false; });
    if (focusName) placeRig(focusCells[0], centre);
  } else if (focusCells.length <= 8) {
    for (const c of focusCells) { const p = cellPos(c); for (const dx of [-1.6, 1.6]) { const l = new THREE.PointLight(col, I, D, 2); l.position.set(p.x + dx, 3.0, p.z + 0.5); scene.add(l); } }
  } else { const d = new THREE.DirectionalLight(col, lightMode === 'work' ? 1.6 : 0.4); d.position.set(10, 20, 15); scene.add(d); }
  if (lightMode === 'red') { for (const l of rig.pts) l.position.y = 2.6; }
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

// ── contact sheet: 3 × 3 props per page, labelled
const TILES = 3;
const sheetNames = sheet !== null ? E.map((e) => e.name).slice(sheet * TILES * TILES, (sheet + 1) * TILES * TILES) : [];
const sheetViews = sheetNames.map(viewOf);
for (let i = 0; i < sheetNames.length; i++) {
  const d = document.createElement('div');
  d.textContent = `${sheetNames[i]}  [${lightMode}]`;
  d.style.cssText = `position:fixed;left:${(i % TILES) * (100 / TILES) + 0.5}%;top:${Math.floor(i / TILES) * (100 / TILES) + 0.5}%;color:#ff8;font:13px ui-monospace,monospace;text-shadow:0 0 3px #000`;
  document.body.appendChild(d);
}

// ── HUD + hooks for scripts/shot.mjs and the zfight runner
const lines = counts.map((c) => {
  const bad = c.calls > 2;
  const t = `${c.name.padEnd(21)} calls ${c.calls}${c.shared ? ` + ${c.shared} shared` : ''}${c.moving ? ` + ${c.moving} moving` : ''}${c.signs ? ` + ${c.signs} atlas` : ''}  tris ${c.tris}`;
  return bad ? `<span class="bad">${t}</span>` : t;
});
hud.innerHTML = q.get('hud') === '0' || sheet !== null ? '' : `level-5 kit — light ${lightMode}${useStand ? ' — DEV STAND-INS for the navy-dock set (W5 pending)' : pending ? ' — W5 FALLBACK (dark)' : ''}\n` +
  `${focusName ? `prop ${focusName}` : 'overview'}\n\n${lines.join('\n')}`;
// zfight runner: one room around all cells; `&zroom=bay` sizes it like the sub bay (24 × 12 × 38: the strictest tolerance)
// (each cell is a room; with `bay` every cell room is sized like the sub bay, centred on the cell, so the depth
// tolerance is the sub bay's 7.6 mm everywhere)
const bay = q.get('zroom') === 'bay';
const zrooms = [...cells].map((c) => {
  const p = cellPos(c), hx = bay ? 12 : 3.6, hz = bay ? 19 : 3.6;
  return { id: `cell${c}`, bounds: new THREE.Box3(new THREE.Vector3(p.x - hx, -2.0, p.z - hz), new THREE.Vector3(p.x + hx, bay ? 10 : 4.6, p.z + hz)) };
});
const level = { rooms: zrooms, roomAt: (p: THREE.Vector3) => zrooms.find((r) => r.bounds.containsPoint(p)) ?? null };
const info = { ready: true, renderer, scene, camera, level, state: 'playing', debug: { fps: 0 }, kit: { counts, pending, useStand, parts: P, scares } };
(window as unknown as { __game: unknown }).__game = info;

let last = performance.now(), frames = 0, acc = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  L.updateTasks(dt);
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
