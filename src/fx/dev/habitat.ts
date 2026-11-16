/**
 * P2 dev scene (src/fx/dev/habitat.html): a small garden atrium with the real render pipeline, materials and fx —
 * the sea viewport in its south wall, a pool with falling water, a daylight lamp grid on the 13.5 m ceiling.
 *
 *   ?view=viewport|pool|lamps|wide|glass   camera preset        &quality=low|medium|high
 *   ?state=calm|cold|dark                  viewport state        &flow=0…1   &lamps=day|flicker|dead|emergency
 *   ?grade=w                               post grade at load    &takeover=1 (run the takeover at t = 1 s)
 *   &nohud=1  &noviewport=1 &nowater=1 &nolamps=1 (leave an effect out)
 * Console / scripts: `window.__dev`
 *   .viewport.setState(s, sec)  .falls/.pool.setFlow(f, sec)  .pool.setGlow(v, sec)  .grid.setState(s, { wave, flicker })
 *   .grade(w, sec)  .takeover()  .restore()  .view(name)  .bench(n) → ms/frame (GPU-synced)  .cost(n) → per-effect cost
 */
import * as THREE from 'three';
import type { GameContext, LightHandle, MaterialName, Quality } from '../../core/types';
import { createEvents } from '../../core/events';
import { createPhysics } from '../../physics/physics';
import { createRender } from '../../render/index';
import { QUALITY } from '../../render/quality';
import { createMaterials } from '../../materials/index';
import { createFx, type FxSystemEx } from '../index';
import type { LampState, ViewportState } from '../index';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);

const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  viewport: [-1.5, 1.7, -11.5, 0, 2.6, -22],
  glass: [3.5, 1.6, -19.5, -1, 3.2, -22],
  pool: [0.5, 1.5, -0.8, 6, 0.4, -7.5],
  falls: [4.6, 1.15, -7.4, 6.0, 0.5, -10],
  lamps: [0, 1.6, -1.0, 0, 12.5, -13],
  wide: [-10.5, 4.2, -0.8, 3, 3.5, -18],
};

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 200);
  scene.add(camera);
  const debug = { quality: (q.get('quality') as Quality | null), fps: 0, verbose: true };
  const ctx = { canvas, scene, camera, debug, state: 'playing', ready: false, time: 0, levelId: 3 } as unknown as GameContext;
  (window as unknown as { __game: unknown }).__game = ctx;
  ctx.events = createEvents();
  ctx.physics = createPhysics();
  // preset overrides for profiling: &p=msaa:0,ao:0
  for (const kv of (q.get('p') ?? '').split(',')) {
    const [k, v] = kv.split(':');
    if (!k || v === undefined) continue;
    const preset = QUALITY[debug.quality ?? 'high'] as unknown as Record<string, number | boolean>;
    preset[k] = typeof preset[k] === 'boolean' ? v !== '0' : Number(v);
  }
  const render = await createRender(ctx);
  ctx.render = render;
  const lib = await createMaterials(ctx);
  ctx.materials = lib;
  const fx = (await createFx(ctx)) as FxSystemEx;
  ctx.fx = fx;
  const L = render.lights;

  // ── the room: x −12…12, z −22…0, y 0…13.5; viewport opening in the south wall x −8…8, y 0.6…9.6
  const world = new THREE.Group();
  scene.add(world);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: MaterialName | THREE.Material) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
    const mesh = new THREE.Mesh(g, typeof m === 'string' ? lib.get(m) : m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    world.add(mesh);
    return mesh;
  };
  const H = 13.5, Z0 = -22;
  box(24.8, 0.4, 22.8, 0, -0.2, -11, 'terrazzo');
  box(24.8, 0.4, 22.8, 0, H + 0.2, -11, 'plaster_warm');
  box(0.4, H, 22.8, -12.2, H / 2, -11, 'plaster_warm');
  box(0.4, H, 22.8, 12.2, H / 2, -11, 'plaster_warm');
  box(24.8, H, 0.4, 0, H / 2, 0.2, 'plaster_warm');
  // south wall around the opening (x −8…8, y 0.6…9.6)
  box(4.2, H, 0.6, -10.1, H / 2, Z0 - 0.3, 'plaster_warm');
  box(4.2, H, 0.6, 10.1, H / 2, Z0 - 0.3, 'plaster_warm');
  box(16, 0.6, 0.6, 0, 0.3, Z0 - 0.3, 'stone_pale');
  box(16, H - 9.6, 0.6, 0, 9.6 + (H - 9.6) / 2, Z0 - 0.3, 'plaster_warm');
  // ribs every 2 m and a sill bench
  for (let x = -6; x <= 6; x += 2) box(0.14, 9.0, 0.3, x, 5.1, Z0 - 0.12, 'trim_steel');
  box(16, 0.45, 0.7, 0, 0.225, Z0 + 0.45, 'wood_dark');
  // the glass (the level's pane): clean architectural glass, the probe reflection
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), lib.get('glass_clear'));
  pane.position.set(0, 5.1, Z0 - 0.3);
  world.add(pane);
  if (q.get('nopane') === '1') pane.visible = false;
  // garden bits for scale
  box(1.6, 0.5, 4, -8, 0.25, -8, 'wood_dark');
  box(1.4, 0.4, 3.8, -8, 0.5, -8, 'soil');
  box(2.2, 0.45, 0.55, -3, 0.225, -15, 'wood_dark');

  // ── pool x 3…9, z −10…−4 (water 0.25, rim 0.45), rill wall on its north side at z −10 with a 0.6 m sheet
  const water = lib.clone('water');
  const rim = 0.45, wy = 0.25;
  box(6.6, rim, 0.3, 6, rim / 2, -3.85, 'stone_pale');
  box(0.3, rim, 6.3, 2.85, rim / 2, -7, 'stone_pale');
  box(0.3, rim, 6.3, 9.15, rim / 2, -7, 'stone_pale');
  box(6.6, 0.85, 0.5, 6, 0.425, -10.25, 'stone_pale');
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), water);
  surf.rotation.x = -Math.PI / 2;
  surf.position.set(6, wy, -7);
  surf.receiveShadow = q.get('watershadow') === '1';
  world.add(surf);
  box(6, 0.1, 6, 6, wy - 0.3, -7, 'stone_pale');

  // ── lights (via the pool): two evening key spots from the grid (shadows), sky fills, high-only fills, emergency
  const day: LightHandle[] = [];
  const room = new THREE.Box3(new THREE.Vector3(-12.3, -0.5, -22.6), new THREE.Vector3(12.3, H + 0.5, 0.3));
  day.push(L.add({ type: 'spot', position: new THREE.Vector3(-4, 13.0, -6), target: new THREE.Vector3(-2, 0, -11), color: 0xffc58a, intensity: 1500, distance: 24, angle: 0.62, penumbra: 0.9, castShadow: true, group: 'atrium_day' }));
  day.push(L.add({ type: 'spot', position: new THREE.Vector3(4, 13.0, -16), target: new THREE.Vector3(4, 0, -10), color: 0xffc58a, intensity: 1500, distance: 24, angle: 0.62, penumbra: 0.9, castShadow: true, group: 'atrium_day' }));
  day.push(L.add({ type: 'point', position: new THREE.Vector3(-6, 9, -11), color: 0xbcd0ff, intensity: 90, distance: 20, bounds: room, group: 'atrium_day' }));
  day.push(L.add({ type: 'point', position: new THREE.Vector3(6, 9, -11), color: 0xbcd0ff, intensity: 90, distance: 20, bounds: room, group: 'atrium_day' }));
  day.push(L.add({ type: 'point', position: new THREE.Vector3(-8, 4, -3), color: 0xffd2a0, intensity: 40, distance: 14, bounds: room, group: 'atrium_day', minQuality: 'high' }));
  day.push(L.add({ type: 'point', position: new THREE.Vector3(8, 4, -18), color: 0xffd2a0, intensity: 40, distance: 14, bounds: room, group: 'atrium_day', minQuality: 'high' }));
  const emerg: LightHandle[] = [];
  emerg.push(L.add({ type: 'point', position: new THREE.Vector3(-9.5, 6.5, -6), color: 0xc8e0ff, intensity: 16, distance: 14, bounds: room, group: 'atrium_emerg', enabled: false }));
  emerg.push(L.add({ type: 'point', position: new THREE.Vector3(9.5, 6.5, -16), color: 0xc8e0ff, intensity: 16, distance: 14, bounds: room, group: 'atrium_emerg', enabled: false }));
  emerg.push(L.add({ type: 'point', position: new THREE.Vector3(0, 4.5, -2), color: 0xc8e0ff, intensity: 12, distance: 12, bounds: room, group: 'atrium_emerg', enabled: false, minQuality: 'medium' }));

  // ── the effects
  const viewport = q.get('noviewport') === '1' ? null : fx.viewport({
    position: new THREE.Vector3(0, 5.1, Z0 - 0.3), normal: new THREE.Vector3(0, 0, 1), width: 16, height: 9,
    state: (q.get('state') as ViewportState | null) ?? 'calm',
  });
  const noWater = q.get('nowater') === '1';
  const falls = noWater ? null : fx.falls({ top: new THREE.Vector3(6, 0.85, -10.0), dir: new THREE.Vector3(0, 0, 1), width: 4.2, drop: 0.6, material: water, flow: num('flow', 1) });
  const pool = noWater ? null : fx.pool({
    center: new THREE.Vector3(6, wy, -7), size: [6, 6], rim: 0.2, falls: falls!, material: water, flow: num('flow', 1),
    caustics: [{ position: new THREE.Vector3(6, 0.55, -10.0), normal: new THREE.Vector3(0, 0, 1), width: 6, height: 0.6 }],
  });
  const grid = q.get('nolamps') === '1' ? null : fx.lampGrid({
    center: new THREE.Vector3(0, H - 0.3, -11), cols: 6, rows: 5, pitch: [4, 4.2], panel: [2.7, 2.7],
    lights: day, emergencyLights: emerg, state: (q.get('lamps') as LampState | null) ?? 'day',
  });

  // ── camera
  const setView = (name: string) => {
    const v = VIEWS[name] ?? VIEWS.viewport;
    camera.position.set(v[0], v[1], v[2]);
    camera.lookAt(v[3], v[4], v[5]);
  };
  setView(q.get('view') ?? 'viewport');
  const probes = [new THREE.Vector3(0, 1.6, -11), new THREE.Vector3(5, 1.2, -5)];
  (ctx as unknown as { level: unknown }).level = { rooms: [{ id: 'atrium', bounds: room }] };
  const t0 = performance.now();
  await render.prepare(probes);
  const prepMs = performance.now() - t0;
  const onResize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); render.resize(innerWidth, innerHeight); };
  addEventListener('resize', onResize);
  onResize();
  if (q.has('grade')) render.post.grade?.(num('grade', 0), 0);

  const sim = (dt: number) => { ctx.time += dt; lib.update(dt); fx.update(dt); };
  const takeover = () => {
    viewport?.setState('cold', 3);
    grid?.setState('dead', { wave: 3, flicker: 0.6 });
    grid?.setState('emergency', { wave: 3, flicker: 0, delay: 4.5 });
    falls?.setFlow(0, 6);
    pool?.setFlow(0, 6);
    pool?.setGlow(0, 1.5);
    render.post.grade?.(-0.6, 3);
  };
  const restore = () => {
    viewport?.setState('calm', 2);
    grid?.setState('day', { wave: 2 });
    falls?.setFlow(1, 3); pool?.setFlow(1, 3); pool?.setGlow(1, 1);
    render.post.grade?.(0, 2);
  };
  if (q.get('takeover') === '1') setTimeout(takeover, 1000);

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
        const lp = render._debug.lights;
        hud.textContent = `fps ${debug.fps}  ${s.width}x${s.height} ${s.quality}  calls ${s.calls} tris ${s.triangles}\n` +
          `lights ${s.lights} active ${s.activeSlots}/${s.spotSlots + s.pointSlots} capped ${lp.capped} shadow upd ${s.shadowUpdates}  prepare ${prepMs.toFixed(0)} ms\n` +
          `viewport ${viewport?.state ?? '-'}  flow ${falls?.flow ?? '-'}  grade ${(render._debug.post as unknown as { warmth: number }).warmth.toFixed(2)}`;
      }
    }
    sim(dt);
    render.render(dt);
  };
  sim(0);
  render.render(0);
  ctx.ready = true;
  const gl = ctx.renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => { ctx.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const bench = (n = 60) => {
    for (let i = 0; i < 5; i++) { sim(1 / 60); render.render(1 / 60); }
    sync();
    const t = performance.now();
    for (let i = 0; i < n; i++) { sim(1 / 60); render.render(1 / 60); sync(); }
    return +((performance.now() - t) / n).toFixed(3);
  };
  const calls = () => { sim(1 / 60); render.render(1 / 60); return render.stats().calls; };
  const dev = {
    viewport, falls, pool, grid, render, fx, lib, day, emerg, takeover, restore, bench,
    grade: (w: number, s: number) => render.post.grade?.(w, s),
    view: setView,
    lightStats: () => ({ capped: render._debug.lights.capped, active: render._debug.lights.activeSlots, handles: render._debug.lights.handles.length,
      slots: [...render._debug.lights.spotSlots, ...render._debug.lights.pointSlots].map((s) => s.handle ? (s.handle.desc.group ?? '?') + (s.handle.desc.minQuality ? '/' + s.handle.desc.minQuality : '') : null) }),
    /**
     * Per-effect cost: GPU-bound frame time with the effect shown minus hidden, alternating rounds of n frames
     * (one sync per round, so frames pipeline as in the game), median over `rounds`. Draw calls = the effect's own
     * drawables (none of them cast shadows or enter probe captures).
     */
    cost(n = 60, rounds = 7) {
      const objs: Record<string, THREE.Object3D[]> = {
        viewport: viewport ? [viewport.object] : [],
        water: [falls?.mesh, pool?.mesh].filter(Boolean) as THREE.Object3D[],
        lamps: grid ? [grid.mesh] : [],
      };
      const run = (frames: number) => {
        sync();
        const t = performance.now();
        for (let i = 0; i < frames; i++) { sim(1 / 60); render.render(1 / 60); }
        sync();
        return (performance.now() - t) / frames;
      };
      const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
      const drawables = (list: THREE.Object3D[]) => { let c = 0; for (const o of list) o.traverse((x) => { if ((x as THREE.Mesh).isMesh || (x as THREE.Points).isPoints) c++; }); return c; };
      const out: Record<string, unknown> = { quality: render.quality, size: `${render.stats().width}x${render.stats().height}` };
      const all = Object.values(objs).flat();
      run(20);
      for (const [k, list] of Object.entries(objs)) {
        if (!list.length) continue;
        const d: number[] = [];
        for (let r = 0; r < rounds; r++) {
          for (const o of list) o.visible = false;
          const off = run(n);
          for (const o of list) o.visible = true;
          const on = run(n);
          d.push(on - off);
        }
        out[k] = { ms: +med(d).toFixed(3), spread: [+Math.min(...d).toFixed(2), +Math.max(...d).toFixed(2)], calls: drawables(list) };
      }
      for (const o of all) o.visible = true;
      out.frameMs = +run(n).toFixed(2);
      return out;
    },
  };
  /**
   * Isolated GPU cost of one effect at the current view: the scene is drawn once (depth + lights state), then the
   * effect alone (with the light pool, so lit materials keep their program) n times into the scene target, one sync;
   * minus the same loop drawing nothing. ms per draw of the effect, as it would be in the frame.
   */
  (dev as Record<string, unknown>).isolate = (name: 'viewport' | 'water' | 'lamps', n = 200) => {
    const list = (name === 'viewport' ? [viewport?.object] : name === 'water' ? [falls?.mesh, pool?.mesh] : [grid?.mesh]).filter(Boolean) as THREE.Object3D[];
    const renderer = ctx.renderer;
    const target = (render._debug.post as unknown as { scene: THREE.WebGLRenderTarget }).scene;
    const temp = new THREE.Scene();
    temp.fog = scene.fog;
    temp.environment = scene.environment;
    const lightsRoot = render._debug.lights.root;
    const parents = list.map((o) => o.parent);
    const time = (draw: boolean) => {
      renderer.setRenderTarget(target);
      for (const o of list) o.visible = false;
      renderer.clear();
      renderer.render(scene, camera);           // depth of the world
      for (const o of list) o.visible = true;
      temp.add(lightsRoot, ...list);
      const empty = new THREE.Group();
      sync(); renderer.setRenderTarget(target);
      const t = performance.now();
      for (let i = 0; i < n; i++) renderer.render(draw ? temp : empty, camera);
      sync();
      const ms = (performance.now() - t) / n;
      scene.add(lightsRoot);
      list.forEach((o, i) => parents[i]!.add(o));
      return ms;
    };
    const r: number[] = [];
    for (let k = 0; k < 5; k++) r.push(time(true) - time(false));
    r.sort((a, b) => a - b);
    return { effect: name, quality: render.quality, size: `${render.stats().width}x${render.stats().height}`, msPerDraw: +r[2].toFixed(3), range: [+r[0].toFixed(3), +r[4].toFixed(3)] };
  };
  /** GPU timer queries (EXT_disjoint_timer_query_webgl2) when available: the effect's draws alone, ms per draw. */
  (dev as Record<string, unknown>).gpuCost = async (name: 'viewport' | 'volume' | 'snow' | 'water' | 'falls' | 'pool' | 'lamps', n = 50) => {
    const glx = ctx.renderer.getContext() as WebGL2RenderingContext;
    const ext = glx.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    if (!ext) return { effect: name, timer: false };
    const list = (name === 'viewport' ? [viewport?.object] : name === 'volume' ? [viewport?.object.children[0]] : name === 'snow' ? [viewport?.object.children[1]]
      : name === 'water' ? [falls?.mesh, pool?.mesh] : name === 'falls' ? [falls?.mesh] : name === 'pool' ? [pool?.mesh] : [grid?.mesh]).filter(Boolean) as THREE.Object3D[];
    const renderer = ctx.renderer;
    const target = (render._debug.post as unknown as { scene: THREE.WebGLRenderTarget }).scene;
    const temp = new THREE.Scene();
    temp.fog = scene.fog;
    temp.environment = scene.environment;
    const lightsRoot = render._debug.lights.root;
    const one = async (draw: boolean) => {
      renderer.setRenderTarget(target);
      for (const o of list) o.visible = false;
      renderer.clear();
      renderer.render(scene, camera);
      for (const o of list) o.visible = true;
      // n copies (shared geometry + material) drawn in ONE render call: one MSAA resolve either way
      temp.add(lightsRoot);
      const copies: THREE.Object3D[] = [];
      if (draw) for (let i = 0; i < n; i++) for (const o of list) {
        const c = o.clone();
        o.updateWorldMatrix(true, false);
        c.matrixAutoUpdate = false;
        c.matrix.copy(o.matrixWorld);
        c.renderOrder = o.renderOrder;
        copies.push(c);
      }
      if (copies.length) temp.add(...copies);
      temp.position.set(0, 0, 0);
      renderer.setRenderTarget(target);
      renderer.render(temp, camera); // warm
      renderer.setRenderTarget(target);
      const qy = glx.createQuery()!;
      glx.beginQuery(ext.TIME_ELAPSED_EXT, qy);
      renderer.render(temp, camera);
      glx.endQuery(ext.TIME_ELAPSED_EXT);
      if (copies.length) temp.remove(...copies);
      scene.add(lightsRoot);
      for (let k = 0; k < 120; k++) {
        await new Promise((r) => setTimeout(r, 16));
        if (glx.getQueryParameter(qy, glx.QUERY_RESULT_AVAILABLE)) break;
      }
      const ns = glx.getQueryParameter(qy, glx.QUERY_RESULT) as number;
      glx.deleteQuery(qy);
      return ns / 1e6 / n;
    };
    const r: number[] = [];
    for (let k = 0; k < 5; k++) r.push((await one(true)) - (await one(false)));
    r.sort((a, b) => a - b);
    return { effect: name, quality: render.quality, size: `${render.stats().width}x${render.stats().height}`, gpuMsPerDraw: +r[2].toFixed(3), range: [+r[0].toFixed(3), +r[4].toFixed(3)] };
  };
  Object.assign(window, { __dev: dev });
  requestAnimationFrame((t) => { last = t; frame(t); });
}

main().catch((e) => { console.error(e); });
