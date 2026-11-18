/**
 * Stage 3d W6 dev scene (src/fx/dev/trunk.html) with the real render pipeline, materials and fx — a greybox of the
 * moon-pool chamber's south half at its level coordinates (stage-3d.md §2.6.9):
 *   - the well x −58 … −46, z −182 … −170, water −20.3, floor −34 (`fx.well`: tether, gate lamps, ladders, eyes, snow),
 *     its coaming (top −19.2) and bar guard (top −17.6);
 *   - the wet dock x −66 … −38, z −194 … −182.4 (floor −20.8, water −20.3) with a wader walking a loop (`fx.wake`),
 *     splashes (`fx.splash`) of every size;
 *   - the sea windows 24 × 3.6 in the south wall z −195.8 (`fx.viewport` with the tether + beacon: `cutCable`, `pass`);
 *   - two sweeping floods over the well (spots) + two high-bays, `&dark=1` for after `lights_out6`.
 *
 *   ?view=well|top|cage|wet|window|walk|low   &quality=low|medium|high   &dark=1   &flash=1 (lamp at the camera)
 *   &eyes=1  &cut=1 (cut at t = 2 s)  &pass=1 (pass at t = 2 s)  &splash=1 (a splash every 1.5 s)  &debug=1 (magenta)
 *   &nohud=1  &nowalk=1  &t=<s> (advance the clock first)  &no=well,sea,mist (leave an effect out)
 * Console / scripts: `window.__dev`  .view(n)  .cut(s)  .pass(s)  .eyes(on)  .dark(on)  .splash(size, x, z)  .wake(x, z, r)
 *   .step(seconds) (simulate + render at 30 fps)
 */
import * as THREE from 'three';
import type { GameContext, LightHandle, MaterialName, Quality, WaterVolume } from '../../core/types';
import { createEvents } from '../../core/events';
import { createPhysics } from '../../physics/physics';
import { createRender } from '../../render/index';
import { createMaterials } from '../../materials/index';
import { createFx, type FxSystemEx } from '../index';

const q = new URLSearchParams(location.search);
/**
 * World y offset of the whole scene (default 0 = the plan's coordinates). `&lift=30` raises everything (geometry, fx
 * boxes, lights, camera) — the scene's lighting below y ≈ −3 was found dark in this harness (see the W6 report).
 */
const OFF = Number(q.get('lift') ?? 0);
const V3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y + OFF, z);

const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  well: [-52, -14.35, -164.5, -52, -22, -176],      // the mid deck's south edge, looking down into the well
  top: [-52, -12.4, -168.5, -52, -30, -176.5],        // from the cage, steep
  cage: [-51.5, -14.35, -167.2, -53, -21, -174],
  wet: [-52, -18.35, -184.2, -52, -18.5, -196],       // wet dock toward the windows (perf view 10)
  window: [-46, -18.35, -194.6, -50, -17.8, -205],    // the window walk, facing the sea
  walk: [-60, -18.35, -178.5, -52, -20.3, -188],      // over the wet dock from the coaming's corner
  low: [-44.3, -18.35, -176.3, -52, -21.5, -176],     // at the coaming, eye height, looking across the water
};

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 300);
  scene.add(camera);
  const debug = { quality: (q.get('quality') as Quality | null) ?? 'medium', fps: 0, verbose: true };
  const ctx = { canvas, scene, camera, debug, state: 'playing', ready: false, time: 0, levelId: Number(q.get('lv') ?? 6) } as unknown as GameContext;
  (window as unknown as { __game: unknown }).__game = ctx;
  ctx.events = createEvents();
  ctx.physics = createPhysics();
  const render = await createRender(ctx);
  ctx.render = render;
  const lib = await createMaterials(ctx);
  ctx.materials = lib;
  const fx = (await createFx(ctx)) as FxSystemEx;
  ctx.fx = fx;
  const L = render.lights;
  let dark = q.get('dark') === '1';

  const world = new THREE.Group();
  scene.add(world);
  const colliders: THREE.Mesh[] = [];
  const bx = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: MaterialName | THREE.Material, solid = true) => {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
    const mesh = new THREE.Mesh(g, typeof m === 'string' ? lib.get(m) : m);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2 + OFF, (z0 + z1) / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    world.add(mesh);
    if (solid) colliders.push(mesh);
    return mesh;
  };
  const Y = -20;
  // ── dock floor (top −20) around the well and the wet dock; x −76 … −28, z −196 … −160
  bx(-76, Y - 0.4, -170, -28, Y, -160, 'floor_concrete');                 // north of the well
  bx(-76, Y - 0.4, -182.4, -58, Y, -170, 'floor_concrete');               // west of the well
  bx(-46, Y - 0.4, -182.4, -28, Y, -170, 'floor_concrete');               // east of the well
  bx(-76, Y - 0.4, -194, -66, Y, -182.4, 'floor_concrete');               // west of the wet dock
  bx(-38, Y - 0.4, -194, -28, Y, -182.4, 'floor_concrete');               // east of the wet dock
  bx(-76, Y - 0.4, -195.8, -28, Y, -194, 'floor_concrete');               // window walk
  // the wet dock: recess floor −20.8, channel −21.3 (z −184 … −182.4)
  bx(-66, -21.2, -194, -38, -20.8, -185.5, 'floor_concrete');
  bx(-66, -21.7, -185.5, -38, -21.3, -182.4, 'floor_concrete');
  // the well: walls y −34 … −20 (inside x −58 … −46, z −182 … −170), floor −34
  bx(-58.4, -34.4, -182.4, -45.6, -34, -169.6, 'steel_raw');
  bx(-58.4, -34, -182.4, -58, Y, -169.6, 'steel_raw');
  bx(-46, -34, -182.4, -45.6, Y, -169.6, 'steel_raw');
  bx(-58, -34, -170, -46, Y, -169.6, 'steel_raw');
  bx(-58, -34, -182.4, -46, -21.0, -182, 'steel_raw');
  // the coaming (0.4 thick, top −19.2), hazard striped, and the 1.6 m vertical-bar guard on its outer face (top −17.6)
  const cm: MaterialName = 'hazard_stripes';
  bx(-58.4, Y, -170, -45.6, -19.2, -169.6, cm);
  bx(-58.4, Y, -182.4, -45.6, -19.2, -182, cm);
  bx(-58.4, Y, -182, -58, -19.2, -170, cm);
  bx(-46, Y, -182, -45.6, -19.2, -170, cm);
  const barMat = lib.get('painted_yellow');
  const barPos: [number, number][] = [];
  for (let x = -58.4; x <= -45.6 + 1e-3; x += 0.12) barPos.push([x, -169.6], [x, -182.4]);
  for (let z = -182.4; z <= -169.6 + 1e-3; z += 0.12) barPos.push([-58.4, z], [-45.6, z]);
  const bars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 6), barMat, barPos.length);
  const _m = new THREE.Matrix4();
  barPos.forEach(([x, z], i) => bars.setMatrixAt(i, _m.makeTranslation(x, -18.4 + OFF, z)));
  world.add(bars);
  bx(-58.45, -17.65, -169.65, -45.55, -17.55, -169.55, 'painted_yellow', false);
  bx(-58.45, -17.65, -182.45, -45.55, -17.55, -182.35, 'painted_yellow', false);
  bx(-58.45, -17.65, -182.45, -58.35, -17.55, -169.55, 'painted_yellow', false);
  bx(-45.65, -17.65, -182.45, -45.55, -17.55, -169.55, 'painted_yellow', false);
  // the south wall with the windows (x −64 … −40, y −19.6 … −16.0), mullions at −56 and −48
  const ZW = -195.8;
  bx(-76, Y, ZW - 0.6, -64, -8, ZW, 'wall_panel_dark');
  bx(-40, Y, ZW - 0.6, -28, -8, ZW, 'wall_panel_dark');
  bx(-64, Y, ZW - 0.6, -40, -19.6, ZW, 'wall_panel_dark');
  bx(-64, -16, ZW - 0.6, -40, -8, ZW, 'wall_panel_dark');
  bx(-56.15, -19.6, ZW - 0.5, -55.85, -16, ZW - 0.1, 'gunmetal');
  bx(-48.15, -19.6, ZW - 0.5, -47.85, -16, ZW - 0.1, 'gunmetal');
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(24, 3.6), lib.get('glass_thick'));
  pane.position.set(-52, -17.8 + OFF, ZW - 0.3);
  world.add(pane);
  // side walls / the mid deck edge for scale (mid deck y −16 at z ≥ −166; a slab)
  bx(-76, -16.3, -166, -28, -16, -160, 'floor_concrete');
  bx(-76.4, Y, -196, -76, 2, -148, 'wall_panel_dark');
  bx(-28, Y, -196, -27.6, 2, -148, 'wall_panel_dark');
  bx(-76, -16, -148.4, -28, 2, -148, 'wall_panel_dark');
  bx(-76, Y - 0.4, -166, -28, -16.3, -148, 'floor_concrete');           // under the mid deck (closed, greybox)
  bx(-76, 2, -196, -28, 2.4, -148, 'ceiling_panel');
  bx(-76, -8, ZW - 0.6, -28, 2, ZW, 'wall_panel_dark');

  // ── water surfaces (the level's opaque `water` quads; ray-only colliders in the game)
  const water = lib.clone('water');
  const quad = (x0: number, x1: number, z0: number, z1: number, y: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), water);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, y + OFF, (z0 + z1) / 2);
    m.receiveShadow = true;
    world.add(m);
    return m;
  };
  quad(-58, -46, -182, -170, -20.3);
  quad(-66, -38, -194, -182.4, -20.3);
  const vols: WaterVolume[] = [
    { id: 'wat6_wet', room: 'pool6', box: new THREE.Box3(V3(-66, -21.4, -194), V3(-38, -20.3, -182.4)), surface: -20.3 + OFF, stand: 1.25 },
    { id: 'wat6_well', room: 'pool6', box: new THREE.Box3(V3(-58, -34, -182), V3(-46, -20.3, -170)), surface: -20.3 + OFF, stand: 1.25 },
  ];
  const room = new THREE.Box3(V3(-76, -36, -196), V3(-28, 2, -148));
  (ctx as unknown as { level: unknown }).level = {
    rooms: [{ id: 'pool6', bounds: room }], water: vols,
    roomAt: (p: THREE.Vector3) => (room.containsPoint(p) ? { id: 'pool6', bounds: room } : null),
  };
  if (q.get('nophys') !== '1') ctx.physics.build(colliders);

  // ── lights: two high-bays (mains), two floods sweeping over the well (the loader's), the frame lamp
  const lights: LightHandle[] = [];
  const add = (d: Parameters<typeof L.add>[0]) => { const h = L.add(d); lights.push(h); return h; };
  const mains = [
    add({ type: 'point', position: V3(-62, -2, -186), color: 0xdfe8ff, intensity: 420, distance: 34, group: 'mains' }),
    add({ type: 'point', position: V3(-42, -2, -186), color: 0xdfe8ff, intensity: 420, distance: 34, group: 'mains' }),
    add({ type: 'point', position: V3(-62, -2, -160), color: 0xdfe8ff, intensity: 420, distance: 34, group: 'mains' }),
    add({ type: 'point', position: V3(-42, -2, -160), color: 0xdfe8ff, intensity: 420, distance: 34, group: 'mains' }),
  ];
  const floods = [
    add({ type: 'spot', position: V3(-55, -8, -172), target: V3(-52, -20, -176), color: 0xfff0d8, intensity: 2200, distance: 40, angle: 0.32, penumbra: 0.5, castShadow: false, priority: 0.9 }),
    add({ type: 'spot', position: V3(-49, -8, -180), target: V3(-52, -20, -188), color: 0xfff0d8, intensity: 2200, distance: 40, angle: 0.32, penumbra: 0.5, castShadow: false, priority: 0.9 }),
  ];
  add({ type: 'spot', position: V3(-52, -13.8, -166.2), target: V3(-52, -16, -168.5), color: 0xffd9a8, intensity: 300, distance: 10, angle: 0.6, penumbra: 0.7, priority: 0.7 });
  const flash = q.get('flash') === '1' ? add({ type: 'spot', position: camera.position.clone(), target: new THREE.Vector3(0, 0, -1), color: 0xfff1dc, intensity: 60, distance: 22, angle: 0.42, penumbra: 0.6, castShadow: true, priority: 10 }) : null;

  // ── the effects (as the level will call them, §2.9)
  const well = fx.well({
    id: 'fx6_well', rooms: ['pool6'], seenFrom: ['shaft6'],
    box: vols[1].box,
    tether: { top: V3(-52, -20.3, -171.9), bottom: V3(-52, -34, -171.9), radius: 0.11 },
    gate: { center: V3(-52, -34, -176), radius: 4.6, lamps: 8 },
    ladders: [V3(-57.8, -34, -176), V3(-46.2, -34, -176)],
  });
  const sea = fx.viewport({
    id: 'fx6_sea', rooms: ['pool6'], seenFrom: ['shaft6'],
    position: V3(-52, -17.8, ZW - 0.3), normal: new THREE.Vector3(0, 0, 1), width: 24, height: 3.6,
    depth: 26, spread: 0.9, seabed: -24, heads: 0.6, desat: 0.3, state: 'calm',
    cable: { from: V3(-50, -40, -200.5), to: V3(-53, 18, -206), radius: 0.35, beacon: V3(-50.8, -12, -203.1), markers: 2 },
    floods: [
      { at: [-8, -1.5, 2.5], dir: [0.55, 0.05, 1], intensity: 1 },
      { at: [8, -1.5, 2.5], dir: [-0.55, 0.05, 1], intensity: 1 },
      { at: [0, -2.4, 2], dir: [0, -0.45, 1], intensity: 0.8 },
    ],
  });
  fx.waterFx({ id: 'fx6_wet', rooms: ['pool6'], seenFrom: ['shaft6'] });
  const mist = fx.fog({ id: 'fx6_mist', box: new THREE.Box3(V3(-58, -20.3, -182), V3(-46, -18.6, -170)), color: 0xc8d4dc, density: 0.6, height: 1.2, rooms: ['pool6'], seenFrom: ['shaft6'] });
  if (q.get('eyes') === '1') well.eyes(true, eyeList());
  function eyeList() {
    return [
      { position: V3(-54.2, -25.5, -177.5) }, { position: V3(-54.0, -25.5, -177.5) },
      { position: V3(-49.1, -27.8, -174.0) }, { position: V3(-48.9, -27.8, -174.05) },
      { position: V3(-52.6, -30.5, -180.0) }, { position: V3(-52.4, -30.5, -180.0) },
    ];
  }

  const setDark = (on: boolean) => {
    dark = on;
    for (const m of mains) m.enabled = !on;
    sea.setState(on ? 'dark' : 'calm', on ? 1 : 2);
    well.setState(on ? 'dark' : 'calm', 1);
  };
  if (dark) setDark(true);

  // ── camera
  const setView = (name: string) => {
    const v = VIEWS[name] ?? VIEWS.well;
    camera.position.set(v[0], v[1] + OFF, v[2]);
    camera.lookAt(v[3], v[4] + OFF, v[5]);
  };
  setView(q.get('view') ?? 'well');
  const fwd = new THREE.Vector3();
  (ctx as unknown as { player: unknown }).player = { eye: camera.position, forward: fwd, velocity: new THREE.Vector3(), alive: true };
  await render.prepare([V3(-52, -18.4, -186), V3(-52, -18.4, -165)]);
  if (q.get('debug') === '1') fx.debugVolumes(true);
  const off = (q.get('no') ?? '').split(',');
  if (off.includes('well')) well.visible = false;
  if (off.includes('sea')) sea.visible = false;
  if (off.includes('mist')) mist.mesh.visible = false;
  const onResize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); render.resize(innerWidth, innerHeight); };
  addEventListener('resize', onResize);
  onResize();

  // ── the wader: a loop through the wet dock, a wake ring every step (0.55 s)
  const walkOn = q.get('nowalk') !== '1';
  const wader = new THREE.Vector3();
  let stepT = 0, splashT = 0, clock = 0;
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.7, 10), lib.get('painted_dark'));
  world.add(marker);
  marker.visible = walkOn;
  const sim = (dt: number) => {
    clock += dt;
    ctx.time += dt;
    // the floods sweep (the loader looking for him)
    floods[0].target!.set(-52 + Math.sin(clock * 0.35) * 5, -20.3 + OFF, -176 + Math.cos(clock * 0.27) * 5);
    floods[1].target!.set(-52 + Math.sin(clock * 0.31 + 2) * 9, -20.3 + OFF, -188 + Math.cos(clock * 0.23) * 4);
    if (walkOn) {
      const a = clock * 0.18;
      wader.set(-52 + Math.cos(a) * 9, -20.8 + OFF, -189.5 + Math.sin(a) * 2.6);
      marker.position.set(wader.x, wader.y + 0.85, wader.z);
      stepT -= dt;
      if (stepT <= 0) { stepT = 0.55; fx.wake(wader, 0.45); }
    }
    if (q.get('splash') === '1') {
      splashT -= dt;
      if (splashT <= 0) {
        splashT = 1.5;
        const k = Math.floor(clock / 1.5) % 4;
        const sizes = [0.3, 0.5, 1.2, 3];
        fx.splash(V3(-58 + k * 4, -20.3, -188), sizes[k]);
      }
    }
    camera.getWorldDirection(fwd);
    if (flash) { flash.position.copy(camera.position).addScaledVector(fwd, 0.2).y -= 0.15; flash.target!.copy(camera.position).addScaledVector(fwd, 5); }
    lib.update(dt);
    fx.update(dt);
  };
  if (q.get('cut') === '1') setTimeout(() => sea.cutCable(6), 2000);
  if (q.get('pass') === '1') setTimeout(() => sea.pass(4), 2000);
  const t0 = Number(q.get('t') ?? 0);
  for (let t = 0; t < t0; t += 1 / 30) sim(1 / 30);

  let last = performance.now(), acc = 0, frames = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000; last = now;
    const dt = Math.min(raw, 0.05);
    acc += raw; frames++;
    if (acc >= 0.5) {
      debug.fps = Math.round(frames / acc); acc = 0; frames = 0;
      if (q.get('nohud') !== '1') {
        const s = render.stats();
        hud.textContent = `fps ${debug.fps}  ${s.width}x${s.height} ${s.quality}  calls ${s.calls} tris ${s.triangles}  lights ${s.lights}\n` +
          `well ${well.state}  sea ${sea.state}${sea.cableCut ? ' (cut)' : ''}  ${dark ? 'DARK' : 'mains'}`;
      }
    }
    sim(dt);
    render.render(dt);
  };
  sim(0);
  render.render(0);
  ctx.ready = true;
  const dev = {
    well, sea, fx, render, lib, lights,
    view: setView,
    cut: (s = 6) => sea.cutCable(s),
    pass: (s = 4) => sea.pass(s),
    eyes: (on = true) => well.eyes(on, eyeList()),
    dark: (on = true) => setDark(on),
    splash: (size = 1, x = -52, z = -188) => fx.splash(V3(x, -20.3, z), size),
    wake: (x = -52, z = -188, r = 0.5) => fx.wake(V3(x, -20.8, z), r),
    step: (seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) { sim(1 / 30); render.render(1 / 30); } },
    calls: () => { sim(1 / 60); render.render(1 / 60); return render.stats().calls; },
  };
  Object.assign(window, { __dev: dev });
  requestAnimationFrame((t) => { last = t; frame(t); });
}

main().catch((e) => { console.error(e); });
