/**
 * Stage 3b W7 dev scene (src/fx/dev/cold.html) with the real render pipeline, materials and fx:
 *   - the cold store (plan §2.9 boxes, floor at y 0 here): bounded ground fog spilling out of its door into a corridor,
 *     ice glints, the breath zone (a fake player at the camera);
 *   - a decon-lock-sized bounded steam set (12 nozzles, box 3.6 × 2.2 × 3.6, no walls so the bounds are visible);
 *   - the tube: two 34 m sea viewports facing each other across a 4 m tube (plan §2.9 options).
 *
 *   ?view=cold|door|low|decon|tube|tubeN|tubeIn|pane   &quality=low|medium|high   &dark=1 (emergency light only)
 *   &flash=1 (flashlight from the camera)  &cheap=east|both|none (tube fallback)  &walk=1 (camera drifts, breath trails)
 *   &nofog=1 &nosteam=1 &notube=1 &debug=1 (volumes magenta)  &nohud=1
 * Console / scripts: `window.__dev`  .view(name)  .cost(names, n, rounds) → per-effect ms (GPU-synced frame time, shown − hidden;
 *   names: sea | seaW | seaE | fog | steam). (A timer-query / isolated-draw measure was tried: on ANGLE-Metal it times the
 *   MSAA resolve of each render call, not the effect, so it is not offered.)
 */
import * as THREE from 'three';
import type { GameContext, LightHandle, MaterialName, Quality } from '../../core/types';
import { createEvents } from '../../core/events';
import { createPhysics } from '../../physics/physics';
import { createRender } from '../../render/index';
import { createMaterials } from '../../materials/index';
import { createFx, type FxSystemEx } from '../index';

const q = new URLSearchParams(location.search);

const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  cold: [-1.2, 1.65, -25.2, -9, 0.2, -32],
  door: [-14.2, 1.65, -24.0, -10, 0.4, -30.5],
  low: [-2.0, 0.9, -29.0, -10, 0.1, -29.5],
  decon: [5.8, 1.65, -23.2, 5.8, 1.0, -28.2],
  tube: [32, 1.65, -86, 32, 1.5, -100],
  tubeN: [32, 1.65, -72, 32, 1.4, -100],
  tubeIn: [31, 1.65, -88, 29, 1.2, -95],
  pane: [33.6, 1.65, -87, 30, 1.6, -87],
};

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 200);
  scene.add(camera);
  const debug = { quality: (q.get('quality') as Quality | null) ?? 'medium', fps: 0, verbose: true };
  const ctx = { canvas, scene, camera, debug, state: 'playing', ready: false, time: 0, levelId: 4 } as unknown as GameContext;
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
  const dark = q.get('dark') === '1';

  const world = new THREE.Group();
  scene.add(world);
  /** Axis box x0…x1, y0…y1, z0…z1 with UVs in metres. */
  const bx = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: MaterialName) => {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
    const mesh = new THREE.Mesh(g, lib.get(m));
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    world.add(mesh);
    return mesh;
  };

  // ── cold store: interior x −11.8…−0.2, z −33.8…−24.2 (walls 0.4 on the boundaries x −12 / 0, z −34 / −24), h 3.2;
  //    door in the west wall z −29.8…−28.2 (2.4 high) to a corridor x −15…−12
  const H = 3.2;
  bx(-16, -0.2, -36, 0.2, 0, -19.8, 'floor_plate');
  bx(-12.2, H, -34.2, 0.2, H + 0.2, -23.8, 'ceiling_panel');
  bx(-15.2, 2.9, -36, -11.8, 3.1, -19.8, 'ceiling_panel');
  bx(-0.2, 0, -34.2, 0.2, H, -23.8, 'wall_medical');                 // east
  bx(-12.2, 0, -34.2, 0.2, H, -33.8, 'wall_medical');                // south
  bx(-12.2, 0, -24.2, 0.2, H, -23.8, 'wall_medical');                // north
  bx(-12.2, 0, -34.2, -11.8, H, -29.8, 'wall_medical');              // west, south of the door
  bx(-12.2, 0, -28.2, -11.8, H, -23.8, 'wall_medical');              // west, north of the door
  bx(-12.2, 2.4, -29.8, -11.8, H, -28.2, 'wall_medical');            // lintel
  bx(-15.4, 0, -36, -15, 2.9, -19.8, 'wall_medical');                // corridor far wall
  // racks along the long walls, a crate stack, a body-sized bundle on the floor
  for (const z of [-33.3, -24.7]) for (let x = -10.5; x < -1; x += 2.4) {
    for (const y of [0.15, 0.95, 1.75]) bx(x - 1.0, y, z - 0.35, x + 1.0, y + 0.05, z + 0.35, 'steel_raw');
    for (const dx of [-1.0, 1.0]) bx(x + dx - 0.03, 0, z - 0.35, x + dx + 0.03, 2.2, z + 0.35, 'steel_raw');
    bx(x - 0.6, 0.2, z - 0.25, x - 0.1, 0.55, z + 0.25, 'painted_white');
    bx(x + 0.2, 1.0, z - 0.25, x + 0.8, 1.3, z + 0.25, 'painted_white');
  }
  bx(-4.5, 0, -30.2, -3.3, 0.9, -28.6, 'painted_white');
  bx(-10.2, 0, -29.4, -9.6, 0.22, -28.2, 'rubber');

  // ── decon: open bounds x 4…7.6, y 0…2.2, z −30…−26.4 (no walls: the box's faces must be visible as the fade)
  bx(3.6, 0, -30.4, 8.0, 0.02, -26.0, 'floor_grate');

  // ── tube: inner x 30…34, z −106…−68, floor y 0, panes x 30 / 34 y 0.4…3.0, ceiling 3.2
  bx(28.8, -0.3, -106, 35.2, 0, -68, 'floor_plate');
  bx(28.8, 3.2, -106, 35.2, 3.5, -68, 'ceiling_panel');
  for (const [x0, x1] of [[29.6, 30.0], [34.0, 34.4]] as const) {
    bx(x0, 0, -106, x1, 0.4, -68, 'trim_steel');
    bx(x0, 3.0, -106, x1, 3.2, -68, 'trim_steel');
  }
  for (let z = -104; z <= -70; z += 2) for (const x of [30.06, 33.94]) bx(x - 0.06, 0.4, z - 0.06, x + 0.06, 3.0, z + 0.06, 'painted_dark');
  bx(29.6, 0, -106.4, 34.4, 3.2, -106, 'wall_panel_dark');
  bx(29.6, 0, -68, 30.8, 3.2, -67.6, 'wall_panel_dark');
  bx(33.2, 0, -68, 34.4, 3.2, -67.6, 'wall_panel_dark');
  const panes: THREE.Mesh[] = [];
  for (const [x, ry] of [[30.0, Math.PI / 2], [34.0, -Math.PI / 2]] as const) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(34, 2.6), lib.get('glass_clear' as MaterialName));
    p.position.set(x, 1.7, -87);
    p.rotation.y = ry;
    world.add(p);
    panes.push(p);
  }

  // ── lights
  const cold = new THREE.Box3(new THREE.Vector3(-12, -0.5, -34), new THREE.Vector3(0, H + 0.5, -24));
  const corr = new THREE.Box3(new THREE.Vector3(-15.2, -0.5, -36), new THREE.Vector3(-11.8, 3.4, -19.8));
  const tubeB = new THREE.Box3(new THREE.Vector3(29.6, -0.5, -106), new THREE.Vector3(34.4, 3.7, -68));
  const lights: LightHandle[] = [];
  const add = (d: Parameters<typeof L.add>[0]) => { const h = L.add(d); lights.push(h); return h; };
  if (dark) add({ type: 'point', position: new THREE.Vector3(-6, 2.9, -29), color: 0x7fa8ff, intensity: 2.2, distance: 12, bounds: cold });
  else {
    add({ type: 'point', position: new THREE.Vector3(-8, 2.9, -29), color: 0xd4e6ff, intensity: 16, distance: 13, bounds: cold });
    add({ type: 'point', position: new THREE.Vector3(-3, 2.9, -29), color: 0xd4e6ff, intensity: 10, distance: 10, bounds: cold, minQuality: 'medium' });
  }
  add({ type: 'point', position: new THREE.Vector3(-13.5, 2.7, -26), color: 0xffe4c8, intensity: dark ? 1.5 : 8, distance: 10, bounds: corr });
  add({ type: 'point', position: new THREE.Vector3(5.8, 2.6, -27.0), color: 0xffffff, intensity: 30, distance: 9 });
  for (const z of [-78, -96]) add({ type: 'point', position: new THREE.Vector3(32, 3.0, z), color: 0xbfd6ff, intensity: 6, distance: 12, bounds: tubeB });
  const flash = q.get('flash') === '1' ? add({ type: 'spot', position: camera.position.clone(), target: new THREE.Vector3(0, 0, -1), color: 0xfff1dc, intensity: 60, distance: 22, angle: 0.42, penumbra: 0.6, castShadow: true, priority: 10 }) : null;

  // ── the effects (plan §2.9 boxes, floor shifted from y 4.8 to 0)
  const B = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
  const fog = q.get('nofog') === '1' ? null : fx.fog({
    id: 'fx4_cold_fog', rooms: ['cold', 'corr_w'], glintRooms: ['cold'],
    box: B(-11.8, 0, -33.8, -0.2, 0.65, -24.2), spill: B(-14.8, 0, -30.0, -12.2, 0.4, -28.0),
    color: 0xc4d4e2, density: 1.3, drift: [0.06, 0.015], glints: 300,
  });
  const breath = fx.breathZone(B(-12, 0, -34, 0, H, -24), { id: 'fx4_breath', rooms: ['cold'] });
  const steamBox = B(4, 0, -30, 7.6, 2.2, -26.4);
  const nozzles: { stop(): void }[] = [];
  if (q.get('nosteam') !== '1') {
    for (let i = 0; i < 12; i++) {
      const side = i % 4, k = (i >> 2) / 2 - 0.5;
      const p = side === 0 ? new THREE.Vector3(4.05, 1.9, -28.2 + k * 2.4) : side === 1 ? new THREE.Vector3(7.55, 1.9, -28.2 + k * 2.4)
        : side === 2 ? new THREE.Vector3(5.8 + k * 2.4, 1.9, -29.95) : new THREE.Vector3(5.8 + k * 2.4, 1.9, -26.45);
      const d = new THREE.Vector3(5.8, 0.6, -28.2).sub(p).normalize();
      nozzles.push(fx.emitter('steam', p, d, 22, { bounds: steamBox, id: 'fx4_decon', rooms: ['lock4'], speed: 0.3 }));
    }
  }
  const cheap = q.get('cheap') ?? 'none';
  const tube = q.get('notube') === '1' ? null : {
    west: fx.viewport({
      id: 'fx4_sea_w', rooms: ['tube'], seenFrom: ['chk', 'gatel'], cheap: cheap === 'both',
      position: new THREE.Vector3(30.0, 1.7, -87.0), normal: new THREE.Vector3(1, 0, 0), width: 34, height: 2.6, depth: 12, spread: 0.1,
      visibility: 6, seabed: -2, shapes: 1, shapeGap: 90, state: 'cold', cable: null,
      floods: [{ at: [0, 2.2, 1.0], dir: [0, -1, 0.6], intensity: 0.35 }],
    }),
    east: fx.viewport({
      id: 'fx4_sea_e', rooms: ['tube'], seenFrom: ['chk', 'gatel'], cheap: cheap === 'both' || cheap === 'east',
      position: new THREE.Vector3(34.0, 1.7, -87.0), normal: new THREE.Vector3(-1, 0, 0), width: 34, height: 2.6, depth: 12, spread: 0.1,
      visibility: 6, seabed: -2, shapes: 1, shapeGap: 90, state: 'cold',
      cable: { from: new THREE.Vector3(40, -3, -101), to: new THREE.Vector3(44, 30, -112), radius: 0.08, markers: 3 },
      floods: [{ at: [-8, 2.0, 1.4], dir: [0.2, -1, 0.7], intensity: 0.5 }],
    }),
  };
  if (q.get('debug') === '1') fx.debugVolumes(true);

  // ── a fake player at the camera (breath)
  const fwd = new THREE.Vector3();
  const vel = new THREE.Vector3();
  (ctx as unknown as { player: unknown }).player = { eye: camera.position, forward: fwd, velocity: vel, alive: true };

  const setView = (name: string) => {
    const v = VIEWS[name] ?? VIEWS.cold;
    camera.position.set(v[0], v[1], v[2]);
    camera.lookAt(v[3], v[4], v[5]);
  };
  setView(q.get('view') ?? 'cold');
  const probes = [new THREE.Vector3(-6, 1.6, -29), new THREE.Vector3(32, 1.6, -87), new THREE.Vector3(5.8, 1.6, -28.2)];
  (ctx as unknown as { level: unknown }).level = { rooms: [{ id: 'cold', bounds: cold }, { id: 'tube', bounds: tubeB }] };
  await render.prepare(probes);
  const onResize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); render.resize(innerWidth, innerHeight); };
  addEventListener('resize', onResize);
  onResize();

  const walk = q.get('walk') === '1';
  const sim = (dt: number) => {
    ctx.time += dt;
    if (walk) { camera.position.x -= dt * 0.9; vel.set(-0.9, 0, 0); }
    camera.getWorldDirection(fwd);
    if (flash) { flash.position.copy(camera.position).addScaledVector(fwd, 0.2).y -= 0.15; flash.target!.copy(camera.position).addScaledVector(fwd, 5); }
    lib.update(dt);
    fx.update(dt);
  };
  let last = performance.now(), acc = 0, frames = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000; last = now;
    acc += raw; frames++;
    if (acc >= 0.5) {
      debug.fps = Math.round(frames / acc); acc = 0; frames = 0;
      if (q.get('nohud') !== '1') {
        const s = render.stats();
        hud.textContent = `fps ${debug.fps}  ${s.width}x${s.height} ${s.quality}  calls ${s.calls} tris ${s.triangles}\n` +
          `fx ${JSON.stringify(fx.stats())}  tube cheap: ${cheap}`;
      }
    }
    sim(Math.min(raw, 0.05));
    render.render(Math.min(raw, 0.05));
  };
  sim(0);
  render.render(0);
  ctx.ready = true;

  const gl = ctx.renderer.getContext() as WebGL2RenderingContext;
  const px = new Uint8Array(4);
  const sync = () => { ctx.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const objs = (name: string): THREE.Object3D[] => {
    if (name === 'sea') return tube ? [tube.west.object, tube.east.object] : [];
    if (name === 'seaW') return tube ? [tube.west.object] : [];
    if (name === 'seaE') return tube ? [tube.east.object] : [];
    if (name === 'fog') return fog ? [fog.mesh, ...(fog.glints ? [fog.glints] : [])] : [];
    if (name === 'steam') return fx.volumes().filter((v) => v.id === 'fx4_decon').map((v) => v.object);
    return [];
  };
  const dev = {
    fx, render, fog, breath, tube, nozzles, view: setView,
    /** Frame time with the effect shown minus hidden (alternating rounds, median), GPU-synced per round. */
    cost(names = ['sea', 'seaW', 'seaE', 'fog', 'steam'], n = 60, rounds = 7) {
      const run = (k: number) => { sync(); const t = performance.now(); for (let i = 0; i < k; i++) { sim(1 / 60); render.render(1 / 60); } sync(); return (performance.now() - t) / k; };
      const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
      const out: Record<string, unknown> = { quality: render.quality, size: `${render.stats().width}x${render.stats().height}` };
      run(30);
      for (const name of names) {
        const list = objs(name);
        if (!list.length) continue;
        const d: number[] = [];
        for (let r = 0; r < rounds; r++) {
          for (const o of list) o.visible = false;
          const off = run(n);
          for (const o of list) o.visible = true;
          const on = run(n);
          d.push(on - off);
        }
        out[name] = +med(d).toFixed(3);
      }
      out.frameMs = +run(n).toFixed(2);
      out.calls = render.stats().calls;
      return out;
    },
  };
  Object.assign(window, { __dev: dev });
  requestAnimationFrame((t) => { last = t; frame(t); });
}

main().catch((e) => { console.error(e); });
