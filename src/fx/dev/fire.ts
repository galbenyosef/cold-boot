/**
 * Stage 3c W6 dev scene (src/fx/dev/fire.html) with the real render pipeline, materials, physics and fx — a 16 × 38 m
 * steel bay (navy grey walls = metal, a concrete column, an office pane = glass, crate cover) and a soldier dummy:
 *
 *   ?scene=fire   — the soldier fires bursts at the camera: muzzle flash + keyed light, a tracer every round, misses
 *                   0.4 … 1.2 m off the player's body that land behind him (sparks / chips / glass star via the real
 *                   `bullet:impact` + `enemy:fired` events, so fx's no-light rule for enemy rounds is exercised);
 *   ?scene=water  — the lock wall with its 0.6 m port (cheap dark viewport), bounded drips that splash, wet patches,
 *                   two tap streams, the ballast mist emitter;
 *   ?scene=scare  — a caged lamp popping, a helmet dropping with dust, grit sifting from the ceiling (every 4 s);
 *   ?scene=all.
 * Options: &dark=1 (emergency light only: one dim red point + amber floor strips) &arms=pistol &shooter=front|side|far|high
 *          &near=1 (misses 0.4–0.6 m) &hits=0.25 (fraction of rounds that hit the player) &quality=low|medium|high
 *          &flash=1 (flashlight from the camera) &debug=1 (volumes magenta) &nohud=1 &cam=x,y,z,lx,ly,lz
 *          &step=1 (no free-running clock: drive it with `__dev.capture`).
 * Console / scripts: `window.__dev` .burst() .shot() .capture(frames, dt, every, quality) → JPEG data URLs (fixed dt,
 *   frame-exact) .lights() (active fx flash lights) .stats().
 */
import * as THREE from 'three';
import type { GameContext, LightHandle, MaterialName, Quality, Surface } from '../../core/types';
import { createEvents } from '../../core/events';
import { createPhysics } from '../../physics/physics';
import { createRender } from '../../render/index';
import { createMaterials } from '../../materials/index';
import { createFx, type FxSystemEx } from '../index';

const q = new URLSearchParams(location.search);
const scene0 = q.get('scene') ?? 'fire';
const has = (s: string) => scene0 === 'all' || scene0 === s;

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 200);
  scene.add(camera);
  const debug = { quality: (q.get('quality') as Quality | null) ?? 'medium', fps: 0, verbose: true };
  const ctx = { canvas, scene, camera, debug, state: 'playing', ready: false, time: 0, levelId: 5 } as unknown as GameContext;
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
  const colliders: THREE.Mesh[] = [];
  const bx = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: MaterialName, surface: Surface = 'metal', collide = true) => {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
    const mesh = new THREE.Mesh(g, lib.get(m));
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.surface = surface;
    world.add(mesh);
    if (collide) colliders.push(mesh);
    return mesh;
  };

  // ── the bay: interior x −8…8, z −34…4, y 0…7
  const H = 7;
  bx(-8.4, -0.3, -34.4, 8.4, 0, 4.4, 'deck_nonslip' as MaterialName);
  bx(-8.4, H, -34.4, 8.4, H + 0.3, 4.4, 'ceiling_panel');
  bx(-8.4, 0, -34.4, -8, H, 4.4, 'navy_grey' as MaterialName);
  bx(8, 0, -34.4, 8.4, H, 4.4, 'navy_grey' as MaterialName);
  bx(-8.4, 0, 4, 8.4, H, 4.4, 'navy_grey' as MaterialName);
  // south wall = the lock wall, with a 0.6 m port at (0, 2.0, −34)
  const PZ = -34, PY = 2.0, PR = 0.3;
  bx(-8.4, 0, PZ - 0.4, -PR, H, PZ, 'hull_white' as MaterialName);
  bx(PR, 0, PZ - 0.4, 8.4, H, PZ, 'hull_white' as MaterialName);
  bx(-PR, 0, PZ - 0.4, PR, PY - PR, PZ, 'hull_white' as MaterialName);
  bx(-PR, PY + PR, PZ - 0.4, PR, H, PZ, 'hull_white' as MaterialName);
  // port rim (a steel collar) + the 5 m lock door ring as a hazard band
  bx(-0.42, PY - 0.42, PZ, 0.42, PY - 0.3, PZ + 0.08, 'trim_steel', 'metal', false);
  bx(-0.42, PY + 0.3, PZ, 0.42, PY + 0.42, PZ + 0.08, 'trim_steel', 'metal', false);
  bx(-0.42, PY - 0.3, PZ, -0.3, PY + 0.3, PZ + 0.08, 'trim_steel', 'metal', false);
  bx(0.3, PY - 0.3, PZ, 0.42, PY + 0.3, PZ + 0.08, 'trim_steel', 'metal', false);
  bx(-2.6, 0, PZ, 2.6, 0.12, PZ + 0.05, 'hazard_stripes', 'metal', false);
  // concrete column, crates (cover), the office pane on the east side
  bx(-3.4, 0, -8.4, -2.6, H, -7.6, 'floor_concrete', 'concrete');
  bx(1.8, 0, -12.6, 3.2, 1.1, -11.4, 'painted_dark');
  bx(-4.6, 0, -16.5, -3.0, 1.2, -15.6, 'painted_dark');
  bx(7.2, 0, -16, 8, 0.9, -4, 'navy_grey' as MaterialName);           // sill
  bx(7.2, 2.6, -16, 8, H, -4, 'navy_grey' as MaterialName);           // above the pane
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.7), lib.get('glass_clear' as MaterialName));
  pane.position.set(7.4, 1.75, -10); pane.rotation.y = -Math.PI / 2;
  pane.userData.surface = 'glass';
  world.add(pane);
  // (a thin collider box for the pane so rounds stop on it)
  const paneCol = bx(7.38, 0.9, -16, 7.42, 2.6, -4, 'glass_clear' as MaterialName, 'glass');
  paneCol.visible = false;
  // amber floor strips (the dark's guide)
  for (const x of [-7.7, 7.0]) bx(x, 0, -33.5, x + 0.08, 0.03, 3.5, 'emissive_amber', 'metal', false);

  // ── the soldier dummy (a capsule + helmet + a carbine stub)
  const SHOOTERS: Record<string, [number, number, number]> = { front: [0.6, 0, -20], side: [-6.2, 0, -12], far: [1.0, 0, -31], high: [-5, 0, -26] };
  const S = new THREE.Vector3(...(SHOOTERS[q.get('shooter') ?? 'front'] ?? SHOOTERS.front));
  const soldier = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.1, 6, 12), lib.get('fatigue_navy' as MaterialName));
  body.position.y = 0.8; body.castShadow = true;
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), lib.get('helmet_navy' as MaterialName));
  helm.position.y = 1.62;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.7), lib.get('gunmetal'));
  gun.position.set(0.18, 1.38, 0.3);
  soldier.add(body, helm, gun);
  soldier.position.copy(S);
  world.add(soldier);

  ctx.physics.build(colliders);

  // ── lights
  const bay = new THREE.Box3(new THREE.Vector3(-8, -0.5, -34), new THREE.Vector3(8, H + 0.5, 4));
  const lights: LightHandle[] = [];
  const add = (d: Parameters<typeof L.add>[0]) => { const h = L.add(d); lights.push(h); return h; };
  if (dark) add({ type: 'point', position: new THREE.Vector3(6.5, 5.5, -30), color: 0xff2a1a, intensity: 1.6, distance: 12, bounds: bay });
  else {
    for (const z of [-4, -16, -28]) add({ type: 'point', position: new THREE.Vector3(0, H - 0.4, z), color: 0xdfe8ff, intensity: 140, distance: 16, bounds: bay });
  }
  const flash = q.get('flash') === '1' ? add({ type: 'spot', position: camera.position.clone(), target: new THREE.Vector3(0, 0, -1), color: 0xfff1dc, intensity: 60, distance: 22, angle: 0.42, penumbra: 0.6, castShadow: true, priority: 10 }) : null;

  // ── fake player at the camera
  const fwd = new THREE.Vector3();
  const vel = new THREE.Vector3();
  (ctx as unknown as { player: unknown }).player = { eye: camera.position, forward: fwd, velocity: vel, alive: true, shake() { /* */ } };
  const camQ = q.get('cam')?.split(',').map(Number);
  if (camQ?.length === 6) { camera.position.set(camQ[0], camQ[1], camQ[2]); camera.lookAt(camQ[3], camQ[4], camQ[5]); }
  else if (scene0 === 'water') { camera.position.set(-1.5, 1.65, -24); camera.lookAt(0.5, 1.6, -34); }
  else if (scene0 === 'scare') { camera.position.set(0, 1.65, 0); camera.lookAt(0, 1.3, -7); }
  else { camera.position.set(0, 1.65, 0); camera.lookAt(S.x, 1.4, S.z); }

  // ── fire
  const arms = q.get('arms') === 'pistol' ? 'pistol' : 'carbine';
  const nearOnly = q.get('near') === '1';
  const hitFrac = Number(q.get('hits') ?? 0);
  const muzzle = new THREE.Vector3(), dir = new THREE.Vector3(), target = new THREE.Vector3(), side = new THREE.Vector3();
  let shots = 0, impacts = 0;
  function shot() {
    soldier.lookAt(camera.position.x, S.y, camera.position.z);
    soldier.updateMatrixWorld(true);
    muzzle.set(0.18, 1.38, 0.68).applyMatrix4(soldier.matrixWorld);
    // aim at the body axis, then 0.4 … 1.2 m off it to a random side, slightly high / low (§8.2.5 misses)
    const chest = new THREE.Vector3(camera.position.x, camera.position.y - 0.4, camera.position.z);
    const hit = Math.random() < hitFrac;
    dir.copy(chest).sub(muzzle).normalize();
    side.set(-dir.z, 0, dir.x).normalize();
    const off = nearOnly ? 0.4 + Math.random() * 0.2 : 0.4 + Math.random() * 0.8;
    target.copy(chest);
    if (!hit) target.addScaledVector(side, Math.random() < 0.5 ? -off : off).add(new THREE.Vector3(0, (Math.random() - 0.4) * 0.6, 0));
    dir.copy(target).sub(muzzle).normalize();
    fx.muzzle(muzzle, dir, { kind: arms });
    shots++;
    if (hit) {
      const end = chest.clone().addScaledVector(dir, -0.25);
      fx.tracer(muzzle, end);
      ctx.events.emit('enemy:fired', { id: 1, type: 'soldier', origin: muzzle.clone(), point: end, hit: true });
      return;
    }
    const h = ctx.physics.raycast(muzzle, dir, 90);
    if (!h) return;
    if (arms === 'carbine') fx.tracer(muzzle, h.point);
    ctx.events.emit('enemy:fired', { id: 1, type: 'soldier', origin: muzzle.clone(), point: h.point.clone(), hit: false });
    ctx.events.emit('bullet:impact', { point: h.point.clone(), normal: h.normal.clone(), surface: h.surface });
    impacts++;
  }
  const queue: number[] = [];
  let simT = 0;
  function burst() {
    const n = arms === 'pistol' ? 2 : 3, gap = arms === 'pistol' ? 0.35 : 0.11;
    for (let i = 0; i < n; i++) queue.push(simT + i * gap);
  }

  // ── water
  const sub = new THREE.Box3(new THREE.Vector3(-7.8, 0, -33.8), new THREE.Vector3(7.8, H - 0.05, 3.8));
  const water: { stop(): void; enabled: boolean }[] = [];
  let mist: { stop(): void; enabled: boolean }[] = [];
  let port: ReturnType<FxSystemEx['viewport']> | null = null;
  if (has('water')) {
    for (const [x, z] of [[-3, -24], [2.5, -27], [4.5, -20], [-5, -30]] as const) {
      water.push(fx.emitter('drip', new THREE.Vector3(x, H - 0.06, z), undefined, 1.4, { bounds: sub, id: 'fx5_drips_sub', rooms: ['sub5'] }));
      fx.wetPatch(new THREE.Box3(new THREE.Vector3(x - 1.1, 0, z - 0.8), new THREE.Vector3(x + 1.3, 0.1, z + 0.9)), ['sub5']);
    }
    fx.wetPatch(new THREE.Box3(new THREE.Vector3(-2.2, 0, -33.6), new THREE.Vector3(2.2, 0.1, -31.6)), ['sub5'], { ragged: 0.45 });
    const taps = new THREE.Box3(new THREE.Vector3(-7.8, 0, -8), new THREE.Vector3(-5, 1.4, -3));
    for (const z of [-6.5, -4.5]) water.push(fx.emitter('stream', new THREE.Vector3(-6.6, 1.15, z), undefined, 45, { bounds: taps, id: 'fx5_taps', rooms: ['sub5'] }));
    bx(-7.2, 0.75, -7.2, -6.0, 0.8, -3.8, 'stainless' as MaterialName, 'metal', false);
    const hull = new THREE.Box3(new THREE.Vector3(-6, 0, -31), new THREE.Vector3(6, 5, -18));
    mist = [
      fx.emitter('mist', new THREE.Vector3(-2.2, 0.6, -24), new THREE.Vector3(-1, -0.15, 0), 18, { bounds: hull, id: 'fx5_ballast_mist', rooms: ['sub5'] }),
      fx.emitter('mist', new THREE.Vector3(2.2, 0.6, -26), new THREE.Vector3(1, -0.15, 0), 18, { bounds: hull, id: 'fx5_ballast_mist', rooms: ['sub5'] }),
    ];
    port = fx.viewport({
      id: 'fx5_lock_water', rooms: ['sub5'], cheap: true, state: 'dark',
      position: new THREE.Vector3(0, PY, PZ - 0.2), normal: new THREE.Vector3(0, 0, 1), width: 0.6, height: 0.6,
      depth: 5.6, spread: 0.45, visibility: 3, seabed: null, cable: null, shapes: 0, floods: [],
    });
  }

  // ── scares
  const lampP = new THREE.Vector3(0.5, 3.4, -6);
  if (has('scare')) {
    bx(0.3, 3.45, -6.2, 0.7, 3.7, -5.8, 'gunmetal', 'metal', false);
    bx(0.47, 3.7, -6.03, 0.53, H, -5.97, 'steel_raw', 'metal', false);
  }
  const bulb = has('scare') ? (() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), lib.get('emissive_warm'));
    m.position.copy(lampP); world.add(m);
    return m;
  })() : null;
  const lampLight = has('scare') ? add({ type: 'point', position: lampP.clone().setY(3.3), color: 0xffd8a0, intensity: dark ? 6 : 4, distance: 8, bounds: bay }) : null;
  let scareT = 0, scareN = 0;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lib.get('helmet_navy' as MaterialName));
  function scare() {
    const k = scareN++ % 3;
    if (k === 0 && bulb && lampLight) {
      fx.bulbPop(lampP);
      bulb.visible = false; lampLight.enabled = false;
      relight = simT + 2.5;
    } else if (k === 1) {
      const h = helmet.clone();
      h.position.set(-1.4, 2.1, -4.5);
      world.add(h);
      fx.debris(h.position, new THREE.Vector3(0.4, 0, 0.6), [h], 5);
      dropAt = simT + 0.6; // ~ the fall from 2.1 m
    } else fx.dustSift(new THREE.Box3(new THREE.Vector3(-2.5, 0, -9), new THREE.Vector3(2.5, H, -4)), { amount: 1.2 });
  }
  let dropAt = -1, relight = -1;

  if (q.get('debug') === '1') fx.debugVolumes(true);
  (ctx as unknown as { level: unknown }).level = { rooms: [{ id: 'sub5', bounds: bay }], roomAt: () => ({ id: 'sub5' }) };
  await render.prepare([new THREE.Vector3(0, 1.6, -15)]);
  const onResize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); render.resize(innerWidth, innerHeight); };
  addEventListener('resize', onResize);
  onResize();

  let burstT = 0.6;
  const sim = (dt: number) => {
    simT += dt;
    ctx.time += dt;
    camera.getWorldDirection(fwd);
    if (flash) { flash.position.copy(camera.position).addScaledVector(fwd, 0.2).y -= 0.15; flash.target!.copy(camera.position).addScaledVector(fwd, 5); }
    if (has('fire')) {
      burstT -= dt;
      if (burstT <= 0) { burstT = 2.2; burst(); }
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i] <= simT) { queue.splice(i, 1); shot(); }
    }
    if (has('scare')) { scareT -= dt; if (scareT <= 0) { scareT = 4; scare(); } }
    if (relight > 0 && simT >= relight && bulb && lampLight) { relight = -1; bulb.visible = true; lampLight.enabled = true; }
    if (dropAt > 0 && simT >= dropAt) { dropAt = -1; fx.dustFall(new THREE.Vector3(-1.1, 0, -4.1), { size: 0.5 }); }
    lib.update(dt);
    fx.update(dt);
  };
  const step = q.get('step') === '1';
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
          `fx ${JSON.stringify(fx.stats())}  shots ${shots} impacts ${impacts}  scene ${scene0}${dark ? ' dark' : ''}`;
      }
    }
    if (step) return;
    sim(Math.min(raw, 0.05));
    render.render(Math.min(raw, 0.05));
  };
  sim(0);
  render.render(0);
  ctx.ready = true;

  const dev = {
    fx, render, port, mist, water, burst, shot,
    /** Per captured frame: the brightest fx flash light (the muzzle light's envelope). */
    log: [] as number[],
    mistOn(on: boolean) { for (const m of mist) m.enabled = on; },
    /** Frame-exact sequence: `n` frames at fixed `dt`, a JPEG every `every` frames. */
    capture(n = 30, dt = 1 / 60, every = 1, quality = 0.85): string[] {
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        sim(dt);
        render.render(dt);
        dev.log.push(L.group('fx_flash').reduce((m, h) => Math.max(m, h.enabled ? h.intensityScale : 0), 0));
        if (i % every === 0) out.push(ctx.renderer.domElement.toDataURL('image/jpeg', quality));
      }
      return out;
    },
    /** Advance without capturing. */
    run(seconds: number, dt = 1 / 60) { for (let t = 0; t < seconds; t += dt) { sim(dt); render.render(dt); } },
    lights() { return L.group('fx_flash').filter((h) => h.enabled).map((h) => ({ i: +h.intensityScale.toFixed(2), d: h.desc.distance, p: h.position.toArray().map((v) => +v.toFixed(2)) })); },
    stats() { return { ...fx.stats(), calls: render.stats().calls, shots, impacts }; },
  };
  Object.assign(window, { __dev: dev });
  requestAnimationFrame((t) => { last = t; frame(t); });
}

main().catch((e) => { console.error(e); });
