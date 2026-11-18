/**
 * Dock loader rig dev page (stage 3d W3a): /src/enemies/dev/loader.html — real render, materials, lights and fx, in a
 * greybox copy of the moon-pool chamber (§2.6.9: dock −20, the well 12 × 12 with its coaming + bar guard and water at
 * −20.3, the mid deck −16 with the cage cantilever, the galleries −12, the runway rails at −4, the slots + containers).
 *
 *   ?demo=tour|travel|slam|jaws|floods|marks|carry|death   (default tour: travel → wake → slam → cowl → ram → flood → death)
 *   &cam=dock|gallery|wide|grab|pod|well|cage|top   &camat=x,y,z&lookat=x,y,z   &follow=1 (look at the grab)   &fov=<deg>
 *   &light=lit|dark|black   lit = the high-bay lamps; dark = after lights_out6 (red emergency points); black = floods only
 *   &quality=low|medium|high  &t=<s> pre-simulate  &slow=<k>  &lod=0|1  &nohud=1  &noshadow=1  &vol=1 (volumetric shafts)
 *   &walker=x,z   where the stand-in player walks (the floods track him; the slam targets him)
 * window.__dev: rig, ctx, sim(seconds), stats(), state(), cost(n)
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GameContext, LightHandle, MaterialName, Quality } from '../../core/types';
import { createEvents } from '../../core/events';
import { createPhysics } from '../../physics/physics';
import { createRender } from '../../render/index';
import { createMaterials } from '../../materials/index';
import { createFx } from '../../fx/index';
import { setMarkTime } from '../shared/rig';
import { buildLoaderTemplate, LOADER_DIM, LOADER_GEOM } from '../loader/model';
import { CraneAxis, createLoaderRig, JAW_CLAMP, type FloodId, type LoaderCue } from '../loader/rig';

const q = new URLSearchParams(location.search);
const P = (k: string, d: string) => q.get(k) ?? d;
const V = (s: string) => { const a = s.split(',').map(Number); return new THREE.Vector3(a[0], a[1], a[2]); };

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(Number(P('fov', '55')), innerWidth / innerHeight, 0.05, 400);
  scene.add(camera);
  const debug = { quality: (q.get('quality') as Quality | null) ?? 'high', fps: 0, verbose: true };
  const ctx = { canvas, scene, camera, debug, state: 'playing', ready: false, time: 0, levelId: 6, facts: {} } as unknown as GameContext;
  (window as unknown as { __game: unknown }).__game = ctx;
  ctx.events = createEvents();
  ctx.physics = createPhysics();
  ctx.render = await createRender(ctx);
  ctx.materials = await createMaterials(ctx);
  ctx.fx = await createFx(ctx);
  ctx.audio = { play() {}, loop() { return { setVolume() {}, setPosition() {}, stop() {} }; }, say() { return { duration: 2, done: Promise.resolve(), setPosition() {}, stop() {} }; } } as unknown as GameContext['audio'];
  const lib = ctx.materials, L = ctx.render.lights;
  // the render's floor mist is anchored at y 0 (post.look.mistBase) — the chamber's dock is at −20: re-anchor it, or the
  // exponential height term (exp(1.3 × 4)) fills the view with black mist (an in-game issue too: reported)
  const look = (ctx.render as unknown as { settings?: { mistBase?: number } }).settings;
  if (look) look.mistBase = Number(P('mist', '-20'));
  const lightMode = P('light', 'lit');

  // ── greybox chamber (merged per material: a few draw calls)
  const parts = new Map<string, THREE.BufferGeometry[]>();
  const colliders: THREE.Mesh[] = [];
  const bx = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: string = 'painted_dark') => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    let l = parts.get(m); if (!l) parts.set(m, (l = []));
    l.push(g);
  };
  const X0 = -75.8, X1 = -28.2, Z0 = -195.8, Z1 = -148.2;
  // dock floor round the well opening (x −58 … −46, z −182 … −170)
  bx(X0, -20.3, Z0, X1, -20, -182, 'floor_plate'); bx(X0, -20.3, -170, X1, -20, Z1, 'floor_plate');
  bx(X0, -20.3, -182, -58, -20, -170, 'floor_plate'); bx(-46, -20.3, -182, X1, -20, -170, 'floor_plate');
  // well shaft walls and the lock door
  bx(-58.4, -34, -182.4, -58, -20, -169.6, 'wall_panel_dark'); bx(-46, -34, -182.4, -45.6, -20, -169.6, 'wall_panel_dark');
  bx(-58, -34, -182.4, -46, -20, -182, 'wall_panel_dark'); bx(-58, -34, -170, -46, -20, -169.6, 'wall_panel_dark');
  bx(-58, -34.3, -182, -46, -34, -170, 'steel_raw');
  // coaming (0.8 m, hazard) + the 1.6 m bar guard on its outer face
  bx(-58.4, -20, -182.4, -45.6, -19.2, -182, 'hazard_stripes'); bx(-58.4, -20, -170, -45.6, -19.2, -169.6, 'hazard_stripes');
  bx(-58.4, -20, -182, -58, -19.2, -170, 'hazard_stripes'); bx(-46, -20, -182, -45.6, -19.2, -170, 'hazard_stripes');
  for (let x = -58.4; x <= -45.6; x += 0.3) { bx(x - 0.02, -19.2, -182.44, x + 0.02, -17.6, -182.4, 'steel_raw'); bx(x - 0.02, -19.2, -169.6, x + 0.02, -17.6, -169.56, 'steel_raw'); }
  for (let z = -182.4; z <= -169.6; z += 0.3) { bx(-58.44, -19.2, z - 0.02, -58.4, -17.6, z + 0.02, 'steel_raw'); bx(-45.6, -19.2, z - 0.02, -45.56, -17.6, z + 0.02, 'steel_raw'); }
  bx(-58.45, -17.65, -182.45, -45.55, -17.55, -182.35, 'painted_yellow'); bx(-58.45, -17.65, -169.65, -45.55, -17.55, -169.55, 'painted_yellow');
  // mid deck (−16) + the cage cantilever, its bars and roof
  bx(-72.8, -16.3, -166, -31.2, -16, Z1, 'floor_grate'); bx(-55, -16.3, -172, -49, -16, -166, 'floor_grate');
  for (let x = -55; x <= -49; x += 0.25) bx(x - 0.02, -16, -172.04, x + 0.02, -13.4, -172, 'steel_raw');
  for (let z = -172; z <= -166; z += 0.25) { bx(-55.04, -16, z - 0.02, -55, -13.4, z + 0.02, 'steel_raw'); bx(-49, -16, z - 0.02, -48.96, -13.4, z + 0.02, 'steel_raw'); }
  bx(-55.05, -13.45, -172.05, -48.95, -13.4, -166, 'steel_raw');
  bx(-54, -16, -154, -50, -13, -150, 'painted_dark');                             // winch hood
  bx(-52.6, -16, -169, -51.4, -14.6, -168, 'painted_yellow');                     // shear
  // galleries (−12)
  bx(-31.2, -12.3, Z0, X1, -12, Z1, 'floor_grate'); bx(X0, -12.3, Z0, -72.8, -12, Z1, 'floor_grate'); bx(-72.8, -12.3, -151.2, -31.2, -12, Z1, 'floor_grate');
  // walls, ceiling, the sea window band
  bx(X0 - 0.4, -20.3, Z0, X0, 2, Z1, 'wall_panel_dark'); bx(X1, -20.3, Z0, X1 + 0.4, 2, Z1, 'wall_panel_dark');
  bx(X0, -20.3, Z1, X1, 2, Z1 + 0.4, 'wall_panel_dark');
  bx(X0, -20.3, Z0 - 0.4, -64, 2, Z0, 'wall_panel_dark'); bx(-40, -20.3, Z0 - 0.4, X1, 2, Z0, 'wall_panel_dark');
  bx(-64, -20.3, Z0 - 0.4, -40, -19.6, Z0, 'wall_panel_dark'); bx(-64, -16, Z0 - 0.4, -40, 2, Z0, 'wall_panel_dark');
  bx(-64, -19.6, Z0 - 0.5, -40, -16, Z0 - 0.4, 'glass_thick');
  bx(X0, 2, Z0, X1, 2.4, Z1, 'ceiling_panel');
  // runway rails on corbels (y −4) and the end stops
  for (const xr of [LOADER_GEOM.railXW, LOADER_GEOM.railXE]) {
    const s = xr < -52 ? -1 : 1;
    bx(xr - 0.1, -4.25, -194, xr + 0.1, -4.0, -150, 'steel_raw');
    bx(xr - 0.4, -4.75, -194.5, xr + 0.4, -4.25, -149.5, 'painted_dark');
    for (let z = -194; z <= -150; z += 3) bx(Math.min(xr + s * 0.4, xr + s * 0.6) - 0.2 * (s < 0 ? 1 : 0), -5.6, z - 0.15, xr + s * 0.6 + 0.2 * (s > 0 ? 1 : 0), -4.75, z + 0.15, 'painted_dark');
    for (const ze of [-194.4, -149.6]) bx(xr - 0.3, -4.0, ze - 0.3, xr + 0.3, -3.3, ze + 0.3, 'hazard_stripes');
  }
  // slots: painted outlines + the containers at load (B-09 sl6_1, B-11 sl6_3, B-12 sl6_4, B-10 sl6_5)
  const SLOTS: [number, number, number, number, number, boolean][] = [
    [-74, -68, -182.0, -179.6, -20, true], [-74, -68, -176.4, -174.0, -20, false], [-36, -30, -182.0, -179.6, -20, true],
    [-36, -30, -176.4, -174.0, -20, true], [-60, -54, -192.0, -189.6, -20, true], [-50, -44, -192.0, -189.6, -20, false],
  ];
  SLOTS.forEach(([x0, x1, z0, z1, y, full], i) => {
    for (const [a, b2, c, d] of [[x0, x1, z0, z0 + 0.1], [x0, x1, z1 - 0.1, z1], [x0, x0 + 0.1, z0, z1], [x1 - 0.1, x1, z0, z1]]) bx(a, y, c, b2, y + 0.01, d, 'painted_yellow');
    if (full) bx(x0, y, z0, x1, y + 2.6, z1, i % 2 ? 'painted_orange' : 'painted_dark');
  });
  for (const [m, list] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(list, false)!, lib.get(m as MaterialName));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh); colliders.push(mesh);
  }
  // the well's water (a dark gloss plane)
  const water = new THREE.Mesh(new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2), lib.clone('glass_thick', { color: 0x0a1418, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.86 }));
  water.position.set(-52, -20.3, -176); scene.add(water);
  ctx.physics.build(colliders);

  // ── the loader
  const tpl = buildLoaderTemplate(ctx);
  const rig = createLoaderRig(ctx, tpl, { volumetric: q.get('vol') === '1', floodShadows: q.get('noshadow') === '1' ? false : undefined });
  scene.add(rig.root);
  const lodF = q.get('lod');
  if (lodF) rig.lod(Number(lodF) as 0 | 1);
  // B-14 (6.0 × 2.6 × 2.4, long axis x) hanging in the grab at load (working)
  const b14 = new THREE.Mesh(new THREE.BoxGeometry(6.0, 2.6, 2.4), lib.clone('painted_orange', { color: 0x9a4a1c }));
  b14.castShadow = true;

  // ── lights
  const lights: LightHandle[] = [];
  if (lightMode === 'lit') {
    for (const [x, z, k] of [[-62, -160, 1], [-42, -160, 1], [-62, -186, 1], [-42, -186, 1]]) lights.push(L.add({ type: 'point', position: new THREE.Vector3(x, -2, z), color: 0xe6ecf2, intensity: 520 * k, distance: 34, castShadow: false }));
  }
  if (lightMode === 'dark' || lightMode === 'lit') {
    lights.push(L.add({ type: 'point', position: new THREE.Vector3(-73, -10, -150), color: 0xff2a14, intensity: lightMode === 'dark' ? 45 : 15, distance: 18 }));
    lights.push(L.add({ type: 'point', position: new THREE.Vector3(-31, -10, -194), color: 0xff2a14, intensity: lightMode === 'dark' ? 45 : 15, distance: 18 }));
  }
  if (lightMode !== 'black') lights.push(L.add({ type: 'point', position: new THREE.Vector3(-52, -18.3, -160), color: 0xffd8a8, intensity: 30, distance: 9 }));   // the undercroft refuge

  // ── the stand-in player (a capsule that walks the dock; the floods track his chest)
  const walker = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 10), lib.clone('painted_white', { color: 0x6b7a88 }));
  walker.castShadow = true;
  scene.add(walker);
  const walk0 = q.get('walker') ? V(q.get('walker')! + ',0') : null;
  const walkerAt = (t: number, out: THREE.Vector3) => {
    if (walk0) return out.set(walk0.x, -20, walk0.y);
    // a loop round the dock south of the coaming, the slots and back
    const a = t * 0.11;
    return out.set(-52 + Math.cos(a) * 14, -20, -187.5 + Math.sin(a * 2) * 3.2);
  };
  const wp = new THREE.Vector3(), chest = new THREE.Vector3();

  // ── axes (the behaviour's job in the game: here a stand-in at the §5.6.5 stage-1 speeds)
  const AX = { bridge: new CraneAxis(rig.bridgeZ, 2.0, 1.1, 1.4), trolley: new CraneAxis(rig.trolleyX, 2.5, 1.4, 1.8), hoist: new CraneAxis(rig.hoistY, 2.0, 2.5, 3.0) };
  const RAISED = LOADER_GEOM.grabTop, GH = LOADER_DIM.grabH;
  const go = (x: number | null, z: number | null, top: number | null) => { if (x !== null) AX.trolley.set(x); if (z !== null) AX.bridge.set(z); if (top !== null) AX.hoist.set(top); };
  let drop: { v: number; floor: number } | null = null;

  // ── cues → fx (the behaviour plays the sounds in the game)
  const cueLog: string[] = [];
  const onCue = (c: LoaderCue, at: THREE.Vector3, data?: { flood?: FloodId; debris?: THREE.Object3D[] }) => {
    cueLog.push(`${t.toFixed(2)} ${c}${data?.flood ? ' ' + data.flood : ''}`);
    if (c === 'pod_blow') {
      ctx.fx.explosion(at, 0.8);
      if (data?.debris) for (const m of data.debris) ctx.fx.debris(m.position.clone(), new THREE.Vector3((Math.random() - 0.5) * 4, 3, -4 - Math.random() * 3), [m], 6);
    }
    if (c === 'drive_fail') ctx.fx.sparks(at.clone().setY(-2.5), new THREE.Vector3(0, -1, 0), 14, 3);
    if (c === 'splash') ctx.fx.smoke(at, { count: 30, size: 2.4, color: 0xc8d8e0, rise: 3.5, life: 2.4 });
    if (c === 'flood_out') ctx.fx.sparks(at, new THREE.Vector3(0, -1, 0), 20, 2.5);
    if (c === 'buffer') { ctx.fx.sparks(at, new THREE.Vector3(0, 0.3, 1), 26, 4); ctx.fx.smoke(at, { count: 6, size: 0.6 }); }
  };

  // ── the demos (timelines of commands)
  const demo = P('demo', 'tour');
  type Ev = [number, () => void];
  const evs: Ev[] = [];
  let carry0 = false;
  const die = () => { void rig.die({ well: new THREE.Vector3(-52, -20.3, -176), onCue }); };
  // a stand-in SLAM (§5.6.4 numbers: hover 3.5 m, track ≥ 1.4 s, lock 0.8 s, drop 0.45 s, sit 2.4 s, rise)
  let slam: { phase: 'track' | 'lock' | 'drop' | 'sit' | 'rise'; t: number; target: () => THREE.Vector3 } | null = null;
  const slamAt = (t0: number, target: () => THREE.Vector3) => {
    evs.push([t0, () => { slam = { phase: 'track', t: 0, target }; rig.setRing('white'); }]);
  };
  const slamStep = (dt: number) => {
    if (!slam) return;
    slam.t += dt;
    const s = slam;
    if (s.phase === 'track') {
      const p = s.target();
      const near = Math.hypot(AX.trolley.pos - p.x, AX.bridge.pos - p.z) < 0.5 && Math.abs(AX.hoist.pos - (-20 + 3.5 + GH)) < 0.05;
      if (s.t > 1.4 && near) { s.phase = 'lock'; s.t = 0; rig.setRing('red'); rig.setSwayHold(1); rig.setJaws(1); AX.bridge.set(AX.bridge.pos); AX.trolley.set(AX.trolley.pos); }
      else go(p.x, p.z, -20 + 3.5 + GH);
    } else if (s.phase === 'lock' && s.t >= 0.8) { s.phase = 'drop'; s.t = 0; drop = { v: 0, floor: -20 }; }
    else if (s.phase === 'drop' && !drop) { s.phase = 'sit'; s.t = 0; }
    else if (s.phase === 'sit' && s.t >= 2.4) { s.phase = 'rise'; s.t = 0; rig.setJaws(0); rig.setRing('white'); }
    else if (s.phase === 'rise' && s.t >= 0.5) { rig.setSwayHold(0); go(null, null, RAISED); slam = null; }
  };
  if (demo === 'tour') {
    carry0 = true;
    evs.push(
      [0.01, () => { go(-52, -176, RAISED); }],
      [6, () => { go(null, null, -22.4); }],                                    // lower B-14 into the well
      [13.5, () => { const o = rig.detach(); if (o) o.visible = false; rig.setJaws(0); go(null, null, RAISED); }],
      [18, () => { go(-40, -186, null); }],
      [24, () => { rig.setMarks('red'); for (const i of [1, 2, 3, 4] as FloodId[]) rig.setFloodCone(i, 16); }],
    );
    slamAt(26, () => walkerAt(t, wp));
    evs.push(
      [36, () => { rig.setCowl(1); }],
      [39, () => { rig.setCowl(0); }],
      [40, () => { rig.setJaws(1); }],
      [41, () => { rig.breakRam('e'); ctx.fx.fluid(rig.partPos('ram_e', new THREE.Vector3()), new THREE.Vector3(1, 0, 0), 30); }],
      [43, () => { rig.setJaws(0); rig.breakFlood(2); ctx.fx.sparks(rig.floodOrigin(2, new THREE.Vector3()), new THREE.Vector3(0, -1, 0), 30, 3); }],
      [45, () => { rig.breakRam('w'); rig.setCowl(1); }],
      [49, die],
    );
  } else if (demo === 'travel') {
    const pts: [number, number][] = [[-70, -190], [-34, -190], [-34, -155], [-70, -155], [-52, -176]];
    pts.forEach(([x, z], i) => evs.push([0.01 + i * 14, () => go(x, z, i % 2 ? -12 : RAISED)]));
  } else if (demo === 'slam') {
    rig.setMarks('red');
    for (let k = 0; k < 6; k++) slamAt(1 + k * 10, () => walkerAt(t, wp));
  } else if (demo === 'jaws') {
    rig.setMarks('red');
    go(-52, -186, -14);
    for (let k = 0; k < 6; k++) { evs.push([2 + k * 3, () => rig.setJaws(1)], [3.5 + k * 3, () => rig.setJaws(k === 2 ? JAW_CLAMP : 0)]); }
    evs.push([9, () => rig.setCowl(1)], [14, () => rig.setCowl(0)], [16.2, () => rig.breakRam('e')], [19, () => rig.breakRam('w')], [20, () => rig.setCowl(1)]);
  } else if (demo === 'floods') {
    rig.setMarks('red');
    go(-52, -170, RAISED);
    evs.push([10, () => rig.breakFlood(2)], [16, () => rig.breakFlood(3)], [20, () => rig.setFloodOn(1, false)], [23, () => rig.setFloodOn(1, true)]);
  } else if (demo === 'marks') {
    go(-46, -183, -14);
    evs.push([3, () => rig.setMarks('red')], [6, () => rig.setMarks('off')], [8, () => rig.setMarks('cyan')]);
  } else if (demo === 'carry') {
    carry0 = true;
    go(-52, -176, RAISED);
    evs.push([4, () => go(null, null, -22.4)], [11, () => { const o = rig.detach(); if (o) o.visible = false; rig.setJaws(0); go(null, null, RAISED); }]);
  } else if (demo === 'death') {
    rig.setMarks('red');
    evs.push([0.01, () => go(-40, -158, -14)], [12, () => { rig.setJaws(1); }], [12.5, die]);
  }
  // b-14 starts in the grab for tour / carry: its top under the grab's frame, the jaws on its long sides
  if (carry0) {
    b14.position.set(rig.grabTop.x, rig.grabTop.y + LOADER_DIM.hingeY - 1.3 + 0.0, rig.grabTop.z);
    scene.add(b14);
    rig.attach(b14);
    rig.setJaws(JAW_CLAMP, ['n', 's']); rig.setJaws(1, ['e', 'w']);
  }

  // ── camera
  const camName = P('cam', demo === 'death' ? 'well' : 'dock');
  const CAMS: Record<string, [THREE.Vector3, THREE.Vector3]> = {
    dock: [new THREE.Vector3(-37, -18.35, -193), new THREE.Vector3(-52, -12, -176)],
    gallery: [new THREE.Vector3(-30, -10.35, -166), new THREE.Vector3(-52, -14, -180)],
    wide: [new THREE.Vector3(-31, -6, -151), new THREE.Vector3(-56, -15, -184)],
    cage: [new THREE.Vector3(-52, -14.35, -167), new THREE.Vector3(-52, -16, -186)],
    well: [new THREE.Vector3(-40, -11.5, -160), new THREE.Vector3(-52, -20, -177)],
    top: [new THREE.Vector3(-52, 0.5, -149), new THREE.Vector3(-52, -20, -175)],
  };
  const camAt = q.get('camat') ? V(q.get('camat')!) : null, lookAt = q.get('lookat') ? V(q.get('lookat')!) : null;
  const follow = q.get('follow') === '1';
  const setCam = () => {
    if (camName === 'grab') { camera.position.copy(rig.grabTop).add(new THREE.Vector3(4.5, 0.5, -5.5)); camera.lookAt(rig.grabTop.x, rig.grabTop.y - 0.9, rig.grabTop.z); return; }
    if (camName === 'pod') { camera.position.copy(rig.podCenter).add(new THREE.Vector3(2.2, -2.4, -4.2)); camera.lookAt(rig.podCenter); return; }
    const [p, l] = CAMS[camName] ?? CAMS.dock;
    camera.position.copy(camAt ?? p);
    if (follow) camera.lookAt(rig.grabTop.x, rig.grabTop.y - 2, rig.grabTop.z); else camera.lookAt(lookAt ?? l);
  };

  // ── sim
  let t = 0;
  const slow = Number(P('slow', '1'));
  const perf: number[] = [];
  const sim = (dt: number) => {
    t += dt; ctx.time = t;
    setMarkTime(t);
    for (const e of evs) if (e[0] >= 0 && t >= e[0]) { e[0] = -1; e[1](); }
    walkerAt(t, wp);
    walker.position.set(wp.x, wp.y + 0.9, wp.z);
    chest.set(wp.x, wp.y + 1.3, wp.z);
    if (!rig.dying && !rig.dead) {
      slamStep(dt);
      if (drop) {
        // the dead-weight drop (7.8 m/s, §5.6.5) onto the deck, then it sits
        drop.v = Math.min(7.8, drop.v + 40 * dt);
        AX.hoist.teleport(Math.max(drop.floor + GH, AX.hoist.pos - drop.v * dt));
        if (AX.hoist.pos <= drop.floor + GH + 1e-3) { drop = null; ctx.fx.smoke(rig.grabBottom, { count: 14, size: 1.4, color: 0x9a9690 }); }
      } else AX.hoist.step(dt);
      rig.setBridge(AX.bridge.step(dt)); rig.setTrolley(AX.trolley.step(dt)); rig.setHoist(AX.hoist.pos);
      const aim = demo === 'marks' ? null : chest;
      for (const i of [1, 2, 3, 4] as FloodId[]) rig.aimFlood(i, aim);
    }
    const t0 = performance.now();
    rig.update(dt, camera.position);
    perf.push(performance.now() - t0);
    if (perf.length > 240) perf.shift();
    setCam();
    lib.update(dt);
    ctx.fx.update(dt);
  };

  const onResize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); ctx.render.resize(innerWidth, innerHeight); };
  addEventListener('resize', onResize); onResize();
  setCam();
  await ctx.render.prepare([new THREE.Vector3(-52, -18, -176), new THREE.Vector3(-52, -10, -165)]);
  const pre = Number(P('t', '0'));
  for (let k = 0; k < pre * 60; k++) sim(1 / 60);
  let last = performance.now(), acc = 0, frames = 0;
  const T = tpl.rig;
  const state = () => ({
    t: +t.toFixed(2), bridge: +rig.bridgeZ.toFixed(2), trolley: +rig.trolleyX.toFixed(2), hoist: +rig.hoistY.toFixed(2),
    sway: [+rig.sway.x.toFixed(3), +rig.sway.y.toFixed(3)], grabBottom: rig.grabBottom.toArray().map((v) => +v.toFixed(2)),
    jaws: Object.fromEntries(Object.entries(rig.jaws).map(([k, v]) => [k, +v.toFixed(2)])), rams: { e: +rig.ramExtension('e').toFixed(2), w: +rig.ramExtension('w').toFixed(2), broken: rig.ramBroken },
    cowl: +rig.cowl.toFixed(2), marks: rig.marks, floods: ([1, 2, 3, 4] as FloodId[]).map((i) => ({ i, alive: rig.floodAlive(i), on: rig.floodOn(i), pool: rig.floodInPool(i), covers: rig.floodCovers(i, chest) })),
    dying: rig.dying, dead: rig.dead, carried: !!rig.carried, drawCalls: rig.drawCalls, lod: rig.lodRig.lod, cues: cueLog.slice(-12),
  });
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const raw = Math.min((now - last) / 1000, 0.05); last = now;
    acc += raw; frames++;
    if (acc >= 0.5) {
      debug.fps = Math.round(frames / acc); acc = 0; frames = 0;
      if (q.get('nohud') !== '1') {
        const s = (ctx.render as unknown as { stats(): { calls: number; triangles: number } }).stats();
        const avg = perf.reduce((a, b) => a + b, 0) / Math.max(1, perf.length);
        const st = state();
        hud.textContent = `fps ${debug.fps}  calls ${s.calls} tris ${s.triangles}  t ${t.toFixed(2)}  demo ${demo}\n` +
          `loader: LOD0 ${T.triangles} tris / ${T.drawCalls} meshes · LOD1 ${T.lod1Triangles} / ${T.lod1.length} · shadow ${T.shadowTriangles} · bones ${T.bones.length} · calls now ${rig.drawCalls} (lod ${rig.lodRig.lod}) · update ${avg.toFixed(3)} ms\n` +
          `bridge ${st.bridge} trolley ${st.trolley} hoist ${st.hoist} sway ${st.sway.join(' ')} bottom ${st.grabBottom.join(' ')}\n` +
          `jaws ${JSON.stringify(st.jaws)} rams e ${st.rams.e} w ${st.rams.w} ${rig.ramBroken.e ? 'E-BURST ' : ''}${rig.ramBroken.w ? 'W-BURST' : ''} cowl ${st.cowl} marks ${st.marks}\n` +
          `floods ${st.floods.map((f) => `${f.i}:${f.alive ? (f.on ? 'on' : 'off') : 'X'}${f.pool ? '' : '(np)'}${f.covers ? '*' : ''}`).join(' ')}  ${st.dying ? 'DYING' : ''}${st.dead ? 'DEAD' : ''}\n` +
          cueLog.slice(-6).join('  ');
      }
    }
    sim(raw * slow);
    ctx.render.render(raw * slow);
  };
  ctx.ready = true;
  requestAnimationFrame(frame);
  (window as unknown as { __dev: unknown }).__dev = {
    rig, ctx, tpl,
    sim(seconds: number) { for (let k = 0; k < seconds * 60; k++) sim(1 / 60); return state(); },
    stats() { return { lod0: T.triangles, calls0: T.drawCalls, lod1: T.lod1Triangles, calls1: T.lod1.length, shadow: T.shadowTriangles, bones: T.bones.length, drawCalls: rig.drawCalls, keys: T.meshes.map((m) => m.key), keys1: T.lod1.map((m) => m.key) }; },
    state,
    cost(nf = 300) { const a = performance.now(); for (let k = 0; k < nf; k++) { for (const i of [1, 2, 3, 4] as FloodId[]) rig.aimFlood(i, chest); rig.update(1 / 60, camera.position); } return (performance.now() - a) / nf; },
  };
}
async function report() {
  const want = (q.get('log') ?? '').split(',').filter(Boolean);
  if (!want.length) return;
  await new Promise((r) => setTimeout(r, Number(q.get('logat') ?? '1500')));
  const d = (window as unknown as { __dev: Record<string, (...a: unknown[]) => unknown> }).__dev;
  for (const k of want) console.warn('[dev] ' + k + ' ' + JSON.stringify(d[k]()));
}
main().then(report).catch((e) => { console.error(e); document.getElementById('hud')!.textContent = String(e?.stack ?? e); });
