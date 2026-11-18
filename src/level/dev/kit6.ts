/**
 * DEV ONLY — level-6 kit gallery (stage 3d §8.8, task W8): every prop of `src/level/l6/kit6.ts` on a grid of 12 × 12 m
 * cells (shotcrete or haze-grey back walls on a concrete / dock-plate floor), each built in its own zone builder exactly
 * as a level would (static zone merge + shadow proxy + the sign atlas), with its draw calls counted.
 *
 *   /src/level/dev/kit6.html                       overview (all cells)
 *   ?prop=<name>                                   close-up of one prop (names in the HUD)
 *   ?sheet=N                                       contact sheet: 3 × 3 props per page, no bloom
 *   &light=work | red | flood | flash | dark       work light (default) | red emergency points | one cold flood |
 *                                                  flashlight only | nothing but emissives (strips on)
 *   &play=<scare>[&loop=s]                         drum | lamp | grille | locker | festoon (all run at +1 s)
 *   &at=<scare>:<t>                                freeze a scare at t s (mid-motion stills)
 *   &yaw=deg &pitch=deg &dist=m                    camera overrides around the focus
 *   &zroom=pool                                    zfight tolerance room size (`__game.level`, for the zfight runner)
 *
 * W5's trunk materials are drawn by `tmat6`'s stand-ins until they land (the HUD says which).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext, LightDesc, LightHandle, MaterialName, TrunkMaterialName } from '../../core/types';
import { createMaterials } from '../../materials/index';
import { LevelBuild } from '../context';
import { defineInstances } from '../props';
import type { Builder, Mat } from '../builder';
import * as K from '../l6/kit6';

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
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 400);
scene.add(camera);

const lib = await createMaterials({ renderer, levelId: 6 } as unknown as GameContext);
const TRUNK: TrunkMaterialName[] = ['tunnel_shotcrete', 'cable_armour', 'dock_steel', 'crane_yellow', 'rope_wire', 'container_navy', 'container_orange', 'coverall_orange'];
const pendingW5 = TRUNK.filter((n) => lib.get(n).name !== n);

// ── minimal ctx for LevelBuild (props add no lights; physics stubs for the hatch lid's dynamic box)
const handles: LightHandle[] = [];
const lights = {
  add(desc: LightDesc) { const h = { desc, enabled: true, intensityScale: 1, factor: 1, setFlicker() {}, setColor() {}, bindEmissive() {}, remove() {} } as unknown as LightHandle; handles.push(h); return h; },
  setGroup() {}, group: () => [],
};
const physics = { addBox: () => ({ box: new THREE.Box3(), owner: null, enabled: true }), addMover() {} };
const ctx = { renderer, scene, camera, materials: lib, levelId: 6, physics, render: { lights, quality: 'high' }, interactables: { add: () => ({}), all: [] }, audio: null } as unknown as GameContext;
const L = new LevelBuild(ctx);
scene.add(L.root);
defineInstances(L);

// ── the gallery
type Wall = 'shot' | 'grey' | 'none';
type Floor = 'concrete' | 'dock' | 'epoxy';
interface Entry { name: string; cell: number; mount: 'floor' | 'wall' | 'ceil'; x?: number; y?: number; z?: number; ry?: number; view?: [number, number, number]; build: (b: Builder) => void }
const P: Record<string, unknown> = {};
const cellWall = new Map<number, Wall>([[0, 'shot'], [1, 'shot'], [2, 'shot'], [3, 'shot'], [12, 'none'], [13, 'none'], [14, 'none'], [16, 'none'], [17, 'none']]);
const cellFloor = new Map<number, Floor>([[9, 'epoxy'], [10, 'epoxy'], [11, 'epoxy'], [12, 'dock'], [13, 'dock'], [14, 'dock'], [15, 'dock'], [16, 'dock'], [17, 'dock']]);
const CEIL = 6.0, CH6 = 2.6;
const E: Entry[] = [
  // tunnels
  { name: 'tunnelRing', cell: 1, mount: 'floor', x: 0, z: 3.0, view: [25, -10, 7.0], build: (b) => K.tunnelRing(b, L, { label: 'R 16' }) },
  { name: 'cableTrays', cell: 0, mount: 'wall', x: 0, view: [25, 8, 5.0], build: (b) => K.cableTrays(b, L, { len: 9, tiers: [2.0, 2.6, 3.2], fill: [5, 6, 3], skip: [[1.6, 2.2]] }) },
  { name: 'trunkRun', cell: 0, mount: 'wall', view: [20, 6, 4.0], build: (b) => K.trunkRun(b, L, { pts: [[-4.5, 2.25, 0.25], [-1.5, 2.25, 0.25], [0.5, 2.05, 0.3], [2.0, 2.25, 0.25], [4.5, 2.25, 0.25]] }) },
  { name: 'junctionBox', cell: 1, mount: 'wall', x: -2.5, view: [28, -14, 4.2], build: (b) => { P.jb = K.junctionBox(b, L, { shelf: true }); } },
  { name: 'drumTrolley', cell: 1, mount: 'floor', x: 2.0, z: 0.5, view: [35, -18, 3.8], build: (b) => K.drumTrolley(b, L) },
  { name: 'tunnelFitting', cell: 2, mount: 'ceil', x: -2.5, view: [25, 20, 3.0], build: (b) => { b.at(0, 0, 0, 0, () => K.tunnelFitting(b, L)); b.at(1.6, 0, 0, 0, () => K.tunnelFitting(b, L, { lit: false })); } },
  { name: 'fittingHanging', cell: 2, mount: 'ceil', x: 2.5, view: [60, 5, 3.2], build: (b) => { P.hang = K.tunnelFitting(b, L, { lit: false, hanging: true, name: 'dev_hang' }); } },
  { name: 'dewaterPipe', cell: 3, mount: 'wall', view: [25, -15, 3.5], build: (b) => K.dewaterPipe(b, L, { len: 9 }) },
  { name: 'tunnelDrain', cell: 3, mount: 'floor', z: 1.0, view: [20, -45, 3.0], build: (b) => b.at(0, 0, 0, Math.PI / 2, () => K.tunnelDrain(b, L, { len: 8 })) },
  { name: 'strip6', cell: 3, mount: 'floor', view: [20, -35, 3.0], build: (b) => { K.strip6(b, L, -4, 2.6, 4, 2.6); K.strip6(b, L, -4, 3.0, 4, 3.0, { ch: 'red' }); K.strip6(b, L, -4, 3.4, 4, 3.4, { ch: 'amber' }); } },
  // repeater bend / joint bay
  { name: 'repeaterBank', cell: 4, mount: 'wall', view: [25, -10, 7.5], build: (b) => K.repeaterBank(b, L, { len: 8.0 }) },
  { name: 'repeaterHousing', cell: 5, mount: 'wall', x: -2.0, view: [35, -12, 4.5], build: (b) => { P.rh = K.repeaterHousing(b, L, { shelf: true }); } },
  { name: 'crate6', cell: 5, mount: 'floor', x: 2.6, z: 0.5, view: [30, -20, 3.4], build: (b) => K.crate6(b, L, { w: 1.4, d: 1.2 }) },
  { name: 'cableDrumCradle', cell: 6, mount: 'floor', x: -2.5, z: 0, view: [30, -10, 5.5], build: (b) => K.cableDrum(b, L, { mount: 'cradle' }) },
  { name: 'spareCoil', cell: 6, mount: 'floor', x: 2.6, z: 1.5, view: [30, -30, 3.0], build: (b) => K.spareCoil(b, L) },
  { name: 'jointerTent', cell: 7, mount: 'floor', x: -1.0, z: 0, ry: Math.PI, view: [200, -12, 5.5], build: (b) => { P.tent = K.jointerTent(b, L); } },
  { name: 'splicingTable', cell: 7, mount: 'floor', x: -1.0, z: 0.25, ry: Math.PI, view: [190, -25, 2.6], build: (b) => K.splicingTable(b, L) },
  { name: 'jointBox', cell: 8, mount: 'floor', x: -2.0, z: 0.5, view: [30, -20, 4.0], build: (b) => K.jointBox(b, L) },
  { name: 'wallShelf6', cell: 8, mount: 'wall', x: 2.5, view: [25, -10, 3.2], build: (b) => K.wallShelf6(b, L) },
  { name: 'firstAidBox6', cell: 8, mount: 'wall', x: 4.6, view: [25, -5, 1.6], build: (b) => K.firstAidBox6(b, L) },
  // head-end
  { name: 'oltRack', cell: 9, mount: 'floor', z: 0.5, view: [25, -12, 7.0], build: (b) => K.oltRack(b, L, { len: 10 }) },
  { name: 'mimicFrame', cell: 10, mount: 'wall', y: 3.6, view: [10, -8, 7.5], build: (b) => { P.mimic = K.mimicFrame(b, L); } },
  { name: 'consoleDesk', cell: 10, mount: 'wall', view: [25, -22, 5.5], build: (b) => K.consoleDesk(b, L) },
  { name: 'wallLocker', cell: 11, mount: 'wall', x: -3.0, view: [25, -10, 3.6], build: (b) => K.wallLocker(b, L) },
  { name: 'dehumidifier', cell: 11, mount: 'wall', x: 0.4, view: [25, -5, 5.0], build: (b) => K.dehumidifier(b, L) },
  { name: 'nitrogenRack', cell: 11, mount: 'floor', x: 3.8, z: 1.0, view: [30, -15, 4.0], build: (b) => K.nitrogenRack(b, L) },
  // vault
  { name: 'cableDrumStand', cell: 12, mount: 'floor', x: -1.0, view: [55, -8, 8.5], build: (b) => { P.drum = K.cableDrum(b, L, { mount: 'stand', ratchet: true, name: 'dev_drum' }); b.at(2.6, 0, -0.8, 0, () => { P.slack = K.slackCoil(b, L, { name: 'dev_slack' }); }); } },
  { name: 'cableDrumPlain', cell: 13, mount: 'floor', x: 0, view: [30, -8, 8.5], build: (b) => K.cableDrum(b, L, { mount: 'stand', plain: true }) },
  { name: 'trenchGrating', cell: 14, mount: 'floor', view: [20, -50, 5.0], build: (b) => {
    K.trenchGrating(b, L, { x0: -0.6, z0: -4.5, x1: 0.6, z1: 4.5, holes: [[-0.4, 1.6, 0.4, 2.4]] });
    b.at(0, 0, 2.0, 0, () => { P.grille = K.liftingGrille(b, L, { name: 'dev_grille' }); });
  } },
  { name: 'hatchLid6', cell: 14, mount: 'floor', view: [40, -35, 4.0], build: (b) => {
    const a = b.world(2.0, 0, -1.2), c = b.world(3.2, 0, 1.2), d = b.world(-3.6, 0, -1.1), f = b.world(-2.4, 0, 1.1), saved = b.m.clone();
    b.m.identity(); // hatch specs are world coordinates (the level's builders are in the world frame)
    P.hatchA = K.hatchLid6(L, b, { ...K.HATCH6_VAULT, name: 'dev_hatch_a', x0: a.x, x1: c.x, z0: a.z, z1: c.z, rooms: [] });
    P.hatchB = K.hatchLid6(L, b, { ...K.HATCH6_HE, name: 'dev_hatch_b', x0: d.x, x1: f.x, z0: d.z, z1: f.z, rooms: [] });
    b.m.copy(saved);
  } },
  // shaft
  { name: 'landingLamp', cell: 15, mount: 'wall', x: -3.5, y: 2.4, view: [35, 0, 1.6], build: (b) => { P.lamp = K.landingLamp(b, L, { breakable: true, floorY: 0, name: 'dev_lamp' }); b.at(1.0, 0, 0, 0, () => K.landingLamp(b, L, { color: 'red' })); } },
  { name: 'firePointCabinet', cell: 15, mount: 'wall', x: -0.6, view: [25, -10, 3.0], build: (b) => K.firePointCabinet(b, L) },
  { name: 'storeBox', cell: 15, mount: 'floor', x: 2.2, z: 1.0, view: [30, -25, 2.4], build: (b) => { K.storeBox(b, L); b.at(1.4, 0, 0, 0, () => K.storeBox(b, L, { w: 0.6, d: 1.0, h: 1.0 })); } },
  { name: 'ammoLocker', cell: 15, mount: 'wall', x: 3.8, view: [25, -8, 2.8], build: (b) => { P.locker = K.ammoLocker(b, L, { name: 'dev_locker' }); } },
  // moon pool
  { name: 'galleryRun', cell: 16, mount: 'floor', view: [30, -15, 10], build: (b) => {
    K.galleryRun(b, L, { x0: -5.5, x1: 5.5, z0: -4.5, z1: -1.5, y: 3.0, rails: ['+z', '+x'], parapets: [['+z', -1.0, 3.0]], wall: '-z' });
  } },
  { name: 'rail6', cell: 16, mount: 'floor', view: [25, -15, 5], build: (b) => K.rail6(b, L, { pts: [[-5.5, 2.5], [-2.0, 2.5], [-2.0, 4.0]], y: 0 }) },
  { name: 'barGuard', cell: 16, mount: 'floor', view: [160, -15, 8.0], build: (b) => {
    K.barGuard(b, L, { pts: [[-1.0, 2.0], [5.5, 2.0], [5.5, 4.5]], h: 2.4 });
    K.barGuard(b, L, { pts: [[-5.5, 4.5], [-1.5, 4.5]], h: 2.4, style: 'mesh' });
  } },
  { name: 'coaming', cell: 17, mount: 'floor', view: [200, -30, 13], build: (b) => K.coaming(b, L, { x0: -5.0, x1: 5.0, z0: -4.5, z1: 4.5, gates: [['-x', 0], ['+x', 0]], sluices: [-2, 2] }) },
  { name: 'cargoContainer', cell: 18, mount: 'floor', z: -0.5, view: [35, -12, 9.0], build: (b) => { K.cargoContainer(b, L, { color: 'navy', n: 9 }); } },
  { name: 'slotPaint', cell: 18, mount: 'floor', view: [20, -50, 9.0], build: (b) => K.slotPaint(b, L, { x0: -3.4, x1: 3.4, z0: 2.0, z1: 4.6, n: 2 }) },
  { name: 'containerObject', cell: 19, mount: 'floor', view: [35, -12, 9.0], build: (b) => {
    const g = K.containerObject(L, { color: 'orange', n: 14 }); b.world(0, 0, -0.5, g.position); L.root.add(g);
  } },
  { name: 'containerInstances', cell: 23, mount: 'floor', view: [35, -20, 12], build: (b) => {
    const m1 = new THREE.Matrix4().makeTranslation(b.world(0, 0, -2.5).x, 0, b.world(0, 0, -2.5).z), m2 = new THREE.Matrix4().makeTranslation(b.world(0, 0, 0.5).x, 0, b.world(0, 0, 0.5).z);
    const m3 = m1.clone().multiply(new THREE.Matrix4().makeTranslation(0, CH6, 0));
    L.root.add(K.containerInstances(L, [{ m: m1, color: 'navy', n: 11 }, { m: m2, color: 'orange', n: 12 }, { m: m3, color: 'orange', n: 10 }]));
  } },
  { name: 'pumpHousing', cell: 20, mount: 'floor', x: -2.5, view: [25, -15, 5.0], build: (b) => K.pumpHousing(b, L) },
  { name: 'hoseReel', cell: 20, mount: 'wall', x: 2.0, y: 1.3, view: [25, -5, 2.4], build: (b) => K.hoseReel(b, L) },
  { name: 'lifeRing', cell: 20, mount: 'wall', x: 4.2, y: 1.5, view: [20, 0, 1.8], build: (b) => K.lifeRing(b, L) },
  { name: 'bollard', cell: 21, mount: 'floor', x: -3.0, z: 1.5, view: [30, -25, 2.4], build: (b) => K.bollard(b, L) },
  { name: 'fender', cell: 21, mount: 'wall', x: -3.0, y: 1.0, view: [30, -10, 2.4], build: (b) => K.fender(b, L) },
  { name: 'amberBeacon', cell: 21, mount: 'wall', x: -0.5, y: 3.0, view: [25, 5, 1.4], build: (b) => { P.beacon = K.amberBeacon(b, L); } },
  { name: 'festoon', cell: 21, mount: 'wall', x: -5.5, y: 4.6, view: [25, 5, 9.0], build: (b) => { P.fest = K.festoon(b, L, { len: 11, n: 8, name: 'dev_festoon' }); } },
  { name: 'runwayRail', cell: 22, mount: 'wall', y: 4.6, view: [25, 8, 8.0], build: (b) => K.runwayRail(b, L, { len: 10 }) },
];
const CELL = 12, PER_ROW = 6, WALL_Z = -5.5;
const cellPos = (c: number) => new THREE.Vector3((c % PER_ROW) * CELL * 1.15, 0, -Math.floor(c / PER_ROW) * CELL * 1.15);
const cells = new Set(E.map((e) => e.cell));

const st = L.builder('stage');
const FLOOR: Record<Floor, MaterialName | TrunkMaterialName> = { concrete: 'floor_concrete', dock: 'dock_steel', epoxy: 'floor_epoxy' };
for (const c of cells) {
  const p = cellPos(c), wall: Wall = cellWall.get(c) ?? 'grey', fl = cellFloor.get(c) ?? 'concrete';
  const fm: Mat = fl === 'dock' ? K.tmat6(L, 'dock_steel') : FLOOR[fl] as MaterialName;
  if (c === 14) {
    // the trench strip (x −0.6 … 0.6) is open below: a 1.4 m pit with a dark floor
    st.bx(fm, p.x - 6, -0.2, p.z - 6, p.x - 0.6, 0, p.z + 6).bx(fm, p.x + 0.6, -0.2, p.z - 6, p.x + 6, 0, p.z + 6);
    st.bx(fm, p.x - 0.6, -0.2, p.z - 6, p.x + 0.6, 0, p.z - 4.5).bx(fm, p.x - 0.6, -0.2, p.z + 4.5, p.x + 0.6, 0, p.z + 6);
    st.bx('painted_dark', p.x - 0.6, -1.6, p.z - 4.5, p.x + 0.6, -1.4, p.z + 4.5);
    for (const sx of [-1, 1]) st.bx('floor_concrete', p.x + sx * 0.6 - (sx > 0 ? 0 : 0.1), -1.4, p.z - 4.5, p.x + sx * 0.6 + (sx > 0 ? 0.1 : 0), -0.2, p.z + 4.5);
  } else st.bx(fm, p.x - 6, -0.2, p.z - 6, p.x + 6, 0, p.z + 6);
  if (wall !== 'none') st.bx(wall === 'shot' ? K.tmat6(L, 'tunnel_shotcrete') : 'navy_grey', p.x - 6, 0, p.z + WALL_Z - 0.3, p.x + 6, CEIL, p.z + WALL_Z);
}

const counts: { name: string; calls: number; shared: number; signs: number; moving: number; tris: number }[] = [];
const groups = new Map<string, THREE.Object3D[]>();
for (const e of E) {
  const p = cellPos(e.cell);
  const b = L.builder(`kit:${e.name}`);
  const before = L.root.children.length;
  const y = e.mount === 'ceil' ? CEIL - 2.0 : e.y ?? 0, z = e.mount === 'wall' ? WALL_Z + (e.z ?? 0) : e.z ?? 0;
  b.push(p.x + (e.x ?? 0), y, p.z + z, e.ry ?? 0);
  e.build(b);
  b.pop();
  groups.set(e.name, L.root.children.slice(before));
}
// ceiling stub plates over the ceiling props
{ const p = cellPos(2); st.bx('ceiling_panel', p.x - 4.5, CEIL - 2.0, p.z - 1.0, p.x + 4.5, CEIL - 1.9, p.z + 1.0); }
if (lightMode === 'dark') for (const ch of ['emerg', 'red', 'amber'] as const) K.setStrips6(L, ch, 1);
L.finishBuilders();
const mo = K.moveOnlyColliders6(L);
const SHARED = /^(k6_strip_|k6_lens_|k6_led)/;
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
  groups.set(e.name, [g, ...(groups.get(e.name) ?? [])].filter(Boolean) as THREE.Object3D[]);
}
L.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.name.endsWith(':shadow')) m.receiveShadow = true; });

// ── scares / switched states
type Parts = { drum?: K.CableDrum; slack?: K.SlackCoil; lamp?: K.LandingLamp; grille?: K.LiftGrille; locker?: K.AmmoLocker; fest?: K.Festoon; beacon?: K.Beacon; hang?: { sway?: (on: boolean) => void } };
const PP = P as Parts;
(P.hatchA as THREE.Object3D | undefined)?.userData.open?.(num('hatch', 0.6));
PP.beacon?.set(lightMode === 'dark' || q.get('beacon') === '1');
let festT = -1;
L.updaters.push((dt) => { if (festT < 0 || !PP.fest) return; festT += dt; PP.fest.set(PP.fest.max * (0.55 + 0.45 * Math.cos(festT * 0.8))); });
let slackRun = -1;
L.updaters.push((dt) => { if (slackRun < 0 || !PP.drum || !PP.slack) return; slackRun += dt; PP.slack.set(PP.drum.angle / 3.0); });
const scares: Record<string, { play(): number; at(t: number): void }> = {
  drum: { play: () => { slackRun = 0; return PP.drum?.run().dur ?? 0; }, at: (t) => { PP.drum?.at(t); PP.slack?.set((PP.drum?.angle ?? 0) / 3.0); } },
  lamp: { play: () => PP.lamp?.pop().dur ?? 0, at: (t) => PP.lamp?.at(t) },
  grille: { play: () => { PP.grille?.pop(); setTimeout(() => PP.grille?.drop(), 1500); return 2.7; }, at: (t) => { if (t < 0.3) { PP.grille?.pop(); PP.grille?.at(t); } else { PP.grille?.drop(); PP.grille?.at(t - 0.3); } } },
  locker: { play: () => { PP.locker?.swing(); setTimeout(() => PP.locker?.set(false), 900); return 1.0; }, at: (t) => { PP.locker?.open(Math.min(1, t / 0.5)); PP.locker?.set(t < 0.9); } },
  festoon: { play: () => { festT = 0; return 8; }, at: (t) => PP.fest?.set(PP.fest.max * (0.55 + 0.45 * Math.cos(t * 0.8))) },
};
const play = q.get('play');
if (play && scares[play]) {
  const loop = num('loop', 0);
  setTimeout(function run() { scares[play].play(); if (loop > 0) setTimeout(run, loop * 1000); }, 1000);
}
const atq = q.get('at');
if (atq) { const [nm, tv] = atq.split(':'); setTimeout(() => scares[nm]?.at(Number(tv)), 50); }

// ── per-prop view
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

const focusName = q.get('prop');
const box = new THREE.Box3();
let focusCells: number[];
let camPos: THREE.Vector3, centre: THREE.Vector3;
if (focusName && E.some((e) => e.name === focusName)) {
  const v = viewOf(focusName);
  camPos = v.pos; centre = v.target; focusCells = [v.cell];
} else {
  focusCells = [...cells];
  for (const c of focusCells) { const p = cellPos(c); box.expandByPoint(p.clone().add(new THREE.Vector3(-6, 0, -6))).expandByPoint(p.clone().add(new THREE.Vector3(6, 3, 6))); }
  centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const yaw = (num('yaw', 0) * Math.PI) / 180, pitch = (num('pitch', -38) * Math.PI) / 180, dist = num('dist', Math.max(size.x, size.z) * 0.75);
  camPos = centre.clone().addScaledVector(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)), dist);
}
camera.position.copy(camPos);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(centre);
controls.update();

{
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const k = lightMode === 'work' ? num('env', 0.3) : 0.02;
  lib.setEnvMap(env, k);
  scene.environment = env;
  scene.environmentIntensity = k;
}

// ── lights: work = 4000 K points + a key spot; red = dim red emergency points; flood = one cold 5600 K flood from high
// (the chamber under the loader's floods); flash = a camera flashlight; dark = nothing but emissives
const hemi = new THREE.HemisphereLight(0xfff1de, 0x101214, lightMode === 'work' ? num('hi', 0.22) : lightMode === 'flash' ? 0.012 : 0.0);
scene.add(hemi);
const rig: { pts: THREE.PointLight[]; key: THREE.SpotLight | null } = { pts: [], key: null };
function placeRig(cell: number, target: THREE.Vector3) {
  const p = cellPos(cell);
  rig.pts.forEach((l, i) => l.position.set(p.x + (i ? 2.5 : -2.5), lightMode === 'red' ? 2.6 : 4.5, p.z + 1.0));
  if (rig.key) { const up = lightMode === 'flood' ? 9 : 3; rig.key.position.set(target.x + 2.0, target.y + up, target.z + 4); rig.key.target.position.copy(target); rig.key.target.updateMatrixWorld(); }
}
const single = !!focusName || sheet !== null;
if (lightMode === 'work' || lightMode === 'red' || lightMode === 'flood') {
  const col = lightMode === 'red' ? 0xff2a14 : 0xfff0dc, I = lightMode === 'red' ? num('li', 2.0) : num('li', 4), D = lightMode === 'red' ? 8 : 14;
  if (single) {
    if (lightMode !== 'flood') for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(col, I, D, 2); rig.pts.push(l); scene.add(l); }
    if (lightMode !== 'red') { rig.key = new THREE.SpotLight(lightMode === 'flood' ? 0xe4eeff : 0xfff0dc, num('si', lightMode === 'flood' ? 60 : 10), 30, 0.6, 0.5, 2); rig.key.castShadow = true; scene.add(rig.key, rig.key.target); }
    if (focusName) placeRig(focusCells[0], centre);
  } else { const d = new THREE.DirectionalLight(col, lightMode === 'red' ? 0.4 : 1.6); d.position.set(10, 20, 15); scene.add(d); }
}
if (lightMode === 'flash') {
  const fl = new THREE.SpotLight(0xcfe0ff, 160, 28, 0.42, 0.5, 2);
  fl.castShadow = true; fl.shadow.mapSize.set(1024, 1024);
  camera.add(fl); fl.position.set(0.15, 0.25, 0); camera.add(fl.target); fl.target.position.set(0, 0, -1);
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.6, 0.85));
composer.addPass(new OutputPass());

const TILES = 3;
const sheetNames = sheet !== null ? E.map((e) => e.name).slice(sheet * TILES * TILES, (sheet + 1) * TILES * TILES) : [];
const sheetViews = sheetNames.map(viewOf);
for (let i = 0; i < sheetNames.length; i++) {
  const d = document.createElement('div');
  d.textContent = `${sheetNames[i]}  [${lightMode}]`;
  d.style.cssText = `position:fixed;left:${(i % TILES) * (100 / TILES) + 0.5}%;top:${Math.floor(i / TILES) * (100 / TILES) + 0.5}%;color:#ff8;font:13px ui-monospace,monospace;text-shadow:0 0 3px #000`;
  document.body.appendChild(d);
}

const lines = counts.map((c) => {
  const bad = c.calls > 2;
  const t = `${c.name.padEnd(21)} calls ${c.calls}${c.shared ? ` + ${c.shared} shared` : ''}${c.moving ? ` + ${c.moving} moving` : ''}${c.signs ? ` + ${c.signs} atlas` : ''}  tris ${c.tris}`;
  return bad ? `<span class="bad">${t}</span>` : t;
});
hud.innerHTML = q.get('hud') === '0' || sheet !== null ? '' : `level-6 kit — light ${lightMode}${pendingW5.length ? ` — W5 pending, kit stand-ins: ${pendingW5.join(', ')}` : ''}\n` +
  `${focusName ? `prop ${focusName}` : 'overview'}  move-only boxes ${mo ? (mo.geometry.index!.count / 36) : 0}\n\n${lines.join('\n')}`;
const big = q.get('zroom') === 'pool';
const zrooms = [...cells].map((c) => {
  const p = cellPos(c), hx = big ? 24 : 6.2, hz = big ? 24 : 6.2;
  return { id: `cell${c}`, bounds: new THREE.Box3(new THREE.Vector3(p.x - hx, -2.0, p.z - hz), new THREE.Vector3(p.x + hx, big ? 22 : CEIL + 0.5, p.z + hz)) };
});
const level = { doors: [] as unknown[], rooms: zrooms, roomAt: (p: THREE.Vector3) => zrooms.find((r) => r.bounds.containsPoint(p)) ?? null };
const info = { ready: true, renderer, scene, camera, level, state: 'playing', debug: { fps: 0 }, kit: { counts, pendingW5, parts: P, scares } };
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
