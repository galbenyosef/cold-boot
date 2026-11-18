/**
 * DEV ONLY — level 6 set pieces (stage 3d §8.7, W7): src/level/dev/setpieces6.html
 *   ?view=<name> (VIEWS below; default frame)   &light=lit|dark   &quality=low|medium|high   &fov=72   &hud=0   &water=0
 *   poses: &crank=<0…1> &keyout=<0…1> &bj=<open 0…1> &unlock=<0…1> &strain=<0…1> &rip=1 (ripped end state)
 *          &shaft=<0…1> &pin=<0…1> &pump=<0…1> &guard=<0…1> &lever=<0…1> &fired=1 &gate=<0…1> &phone=lift
 *          &page=idle|manifest|feed|cctv|static|choir|black   &feed=1 (start the cam_tern feed and show it on the console)
 * window.__sp = { view, views, light, sw, bj, shaft, frame, well, ladders, console, phone, feed: { start, stop, passCost,
 *   handle }, step(dt, n), stats(), moveOnly(), play(name) }   play: 'crank' | 'unlock' | 'open' | 'strain' | 'rip' |
 *   'pin' | 'pump' | 'fire' | 'gates' | 'phone'
 * The rooms are stand-ins at the plan's coordinates (§2.1) — the real shells and dressing are W4a's / the D-tasks'.
 */
import * as THREE from 'three';
import type { DynamicBox, FeedHandle, GameContext, MaterialName, Quality } from '../../core/types';
import { createEvents } from '../../core/events';
import { LevelBuild } from '../context';
import { defineInstances } from '../props';
import {
  beachJoint6, console6, feed6, frame6, moveOnlyBoxes6, phone6, shaftLock6, switch6, well6, FEED6, WELL6, type Cue6,
} from '../l6/setpieces6';

const q = new URLSearchParams(location.search);
const P = (k: string, d: string) => q.get(k) ?? d;
const num = (k: string) => (q.get(k) !== null ? Number(q.get(k)) : null);

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  if (q.get('hud') === '0') hud.classList.add('off');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(Number(P('fov', '72')), innerWidth / innerHeight, 0.05, 400);
  scene.add(camera);
  const debug = { autostart: true, spawn: null, noEnemies: true, noStory: true, god: false, giveAll: false, quality: (q.get('quality') as never) ?? 'high', verbose: false, fps: 0 };
  const boxes: DynamicBox[] = [];
  const physics = {
    addBox(box: THREE.Box3, surface = 'metal') { const b = { box, enabled: true, surface, remove() {} } as DynamicBox; boxes.push(b); return b; },
    addMover() { return () => {}; }, movers: [], gravity: 19,
  };
  const ctx = {
    canvas, uiRoot: document.getElementById('ui')!, scene, camera, events: createEvents(), debug, time: 0, state: 'playing', ready: false, levelId: 6, facts: {},
    physics, interactables: { add(o: object) { return { ...o }; }, remove() {} }, setState() {},
  } as unknown as GameContext;
  (window as any).__game = ctx;
  (window as any).__THREE = THREE;
  const { createRender } = await import('../../render');
  const { createMaterials } = await import('../../materials');
  ctx.render = await createRender(ctx);
  ctx.materials = await createMaterials(ctx);
  const M = ctx.materials;
  const pick = (n: MaterialName, fb: MaterialName): MaterialName => (M.get(n).name === n ? n : fb);

  const L = new LevelBuild(ctx);
  scene.add(L.root);
  defineInstances(L);
  const DECK = pick('deck_nonslip', 'floor_plate'), NAVY = pick('navy_grey', 'wall_panel'), HULL = pick('hull_white', 'wall_medical');
  const DOCK = pick('dock_steel', 'floor_plate'), EPOXY: MaterialName = 'floor_epoxy';

  // ── he6 east end
  L.currentRoom = 'he6';
  L.room('he6', 'TRUNK HEAD-END', 2, 22, -180, -160, 4.5, { y0: 0 });
  const hb = L.builder('he6_static');
  hb.bx('floor_plate', 12, -0.2, -180, 22, 0, -160);
  hb.bx('wall_panel', 21.8, 0, -180.2, 22.2, 4.5, -159.8).bx('wall_panel', 12, 0, -180.2, 21.8, 4.5, -179.8).bx('ceiling_panel', 12, 4.5, -180.2, 22.2, 4.8, -159.8);
  switch6(L, hb);
  phone6(L, hb);
  const heLit = [L.point('he6', 18, 4.1, -170, 0xeaf2ff, 26, 14), L.point('he6', 18, 4.1, -163, 0xeaf2ff, 18, 12)];

  // ── vault6 south-west
  L.currentRoom = 'vault6';
  L.room('vault6', 'CABLE VAULT', -22, 2, -180, -148, 6.0, { y0: 0 });
  const vb = L.builder('vault6_static');
  vb.bx(EPOXY, -22, -0.2, -180, -2, 0, -158);
  vb.bx('wall_panel', -22, 0, -180.2, -2, 6, -179.8).bx('wall_panel', -22.2, 0, -180.2, -21.8, 6, -158).bx('ceiling_panel', -22.2, 6, -180.2, -2, 6.3, -158);
  beachJoint6(L, vb);
  shaftLock6(L, vb);
  const vaLit = [
    L.spot('vault6', -12, 5.6, -172, -12, 0.8, -179, 0xdfe8ff, 160, 14, 0.7, { cast: true, priority: 0.7 }),
    L.point('vault6', -16, 5.2, -170, 0xdfe8ff, 18, 14),
  ];

  // ── pool6: dock round the well, coaming + guard stand-in, well walls, mid deck strip + the cage cantilever
  L.currentRoom = 'pool6';
  L.room('pool6', 'MOON POOL', -76, -28, -196, -148, 22, { y0: -20, floors: [{ y: -16, box: [-72.8, -31.2, -166, -148.2] }] });
  const pb = L.builder('pool6_static');
  const { x0: wx0, x1: wx1, z0: wz0, z1: wz1 } = WELL6, C = WELL6.coaming;
  pb.bx(DOCK, -66, -20.3, -194, wx0 - C, -20, -150).bx(DOCK, wx1 + C, -20.3, -194, -38, -20, -150);
  pb.bx(DOCK, wx0 - C, -20.3, -194, wx1 + C, -20, wz0 - C).bx(DOCK, wx0 - C, -20.3, wz1 + C, wx1 + C, -20, -150);
  pb.bx('hazard_stripes', wx0 - C, -34, wz0 - C, wx1 + C, -19.2, wz0).bx('hazard_stripes', wx0 - C, -34, wz1, wx1 + C, -19.2, wz1 + C);
  pb.bx('hazard_stripes', wx0 - C, -34, wz0, wx0, -19.2, wz1).bx('hazard_stripes', wx1, -34, wz0, wx1 + C, -19.2, wz1);
  for (const [ax, az, bx, bz] of [[wx0 - C, wz0 - C, wx1 + C, wz0 - C], [wx0 - C, wz1 + C, wx1 + C, wz1 + C], [wx0 - C, wz0 - C, wx0 - C, wz1 + C], [wx1 + C, wz0 - C, wx1 + C, wz1 + C]] as const) {
    const n = Math.round(Math.hypot(bx - ax, bz - az) / 0.15);
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      if (Math.abs(z - WELL6.ladderZ) < 0.5 && (Math.abs(x - (wx0 - C)) < 0.01 || Math.abs(x - (wx1 + C)) < 0.01)) continue;
      const ox = Math.abs(x - (wx0 - C)) < 0.01 ? 0.0125 : Math.abs(x - (wx1 + C)) < 0.01 ? -0.0125 : 0, oz = Math.abs(z - (wz0 - C)) < 0.01 ? 0.0125 : Math.abs(z - (wz1 + C)) < 0.01 ? -0.0125 : 0;
      pb.cyl('steel_raw', x + ox, -18.4, z + oz, 0.0125, 1.6, 'y', 6);
    }
    pb.bx('painted_yellow', Math.min(ax, bx) - 0.02, -17.64, Math.min(az, bz) - 0.02, Math.max(ax, bx) + 0.02, -17.6, Math.max(az, bz) + 0.02);
  }
  pb.bx(DOCK, -60, -16.3, -166, -36, -16, -148.2);
  pb.bx(DOCK, -55, -16.3, -171.85, -49, -16, -166).bx(DOCK, -55, -16.3, -172, -49, -16, -171.97);
  pb.bx(HULL, -60, -20, -148.6, -36, -8, -148.2);
  pb.bx(NAVY, -76, -20, -196.2, -28, -14, -195.8);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(wx1 - wx0, wz1 - wz0), M.clone('painted_dark', { color: 0x04070a, roughness: 0.04, metalness: 0.4, transparent: true, opacity: 0.88, map: null, normalMap: null }));
  water.rotation.x = -Math.PI / 2; water.position.set((wx0 + wx1) / 2, WELL6.water, (wz0 + wz1) / 2); water.userData.rooms = ['pool6'];
  water.visible = q.get('water') !== '0';
  L.root.add(water);
  frame6(L, pb); well6(L, pb); console6(L, pb);
  const fr = L.objects.get('frame6')!.userData;
  const poolLit = [
    L.point('pool6', -62, -6, -160, 0xfff1dc, 120, 34), L.point('pool6', -42, -6, -160, 0xfff1dc, 120, 34),
    L.point('pool6', -52, -10, -186, 0xfff1dc, 90, 30),
    L.spot('pool6', fr.lampPoint.x, fr.lampPoint.y, fr.lampPoint.z, fr.lampTarget.x, fr.lampTarget.y, fr.lampTarget.z, 0xfff0d8, 90, 10, 0.75, { cast: true, priority: 0.7 }),
  ];
  const poolDark = [L.point('pool6_emerg', -60, -12, -165, 0xff2a18, 10, 26, { enabled: false }), L.point('pool6_emerg', -44, -12, -165, 0xff2a18, 10, 26, { enabled: false }), L.point('pool6_emerg', -52, -18, -184, 0xff2a18, 6, 18, { enabled: false })];

  // ── feed6
  L.currentRoom = 'feed6';
  L.room('feed6', 'POST 4 — SUB BAY (CAM 2)', FEED6.x0, FEED6.x1, FEED6.z0, FEED6.z1, FEED6.h, { y0: 0 });
  feed6(L);
  L.currentRoom = '';
  L.finishLightBounds();
  L.finishBuilders();

  // ── visibility (main view never draws feed6; a feed pass draws only its rooms)
  let override: ReadonlySet<string> | null = null, mainOverride: ReadonlySet<string> | null = null;
  const applyVis = () => {
    for (const o of L.root.children) {
      const r = o.userData.rooms as string[] | undefined;
      if (!r || !r.length) continue;
      o.visible = override ? r.some((x) => override!.has(x)) : !r.every((x) => x === 'feed6');
    }
  };
  L.root.userData.visibility = { setOverride(rs: ReadonlySet<string> | null) { override = rs ?? mainOverride; applyVis(); }, setFeedRooms() {}, fed() { return false; } };
  (ctx as any).level = { root: L.root, rooms: L.rooms };
  applyVis();

  // ── handles
  const O = (n: string) => L.objects.get(n)!.userData as any;
  const sw = O('switch6'), bj = O('bj6'), sh = O('shaft6'), frame = O('frame6'), well = O('well6'), con = O('console6'), ph = O('phone6');
  const ladders = { w: O('ladder6_w'), e: O('ladder6_e') };
  const cueLog: string[] = [];
  const cue: Cue6 = (n, at) => cueLog.push(`${n}@${ctx.time.toFixed(2)} (${at.x.toFixed(1)},${at.y.toFixed(1)},${at.z.toFixed(1)})`);

  const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const VIEWS: Record<string, [THREE.Vector3, THREE.Vector3, number?]> = {
    switch: [V3(19.9, 1.65, -170.0), V3(21.0, 1.3, -171.0)],
    switch_close: [V3(20.4, 1.55, -170.7), V3(20.95, 1.3, -171.0), 50],
    phone: [V3(20.2, 1.65, -163.0), V3(21.6, 1.1, -164.1)],
    bj: [V3(-12.0, 1.65, -175.8), V3(-12.0, 1.1, -179.0)],
    bj_side: [V3(-9.3, 1.65, -176.6), V3(-12.0, 1.1, -178.8)],
    loom: [V3(-12.0, 1.6, -178.15), V3(-12.0, 0.95, -179.25), 55],
    shaft_lock: [V3(-20.6, 1.65, -166.9), V3(-21.8, 1.35, -167.6)],
    frame: [V3(-52.0, -14.35, -161.0), V3(-52.0, -15.0, -169.0)],
    frame_in: [V3(-52.15, -14.35, -166.7), V3(-52.0, -15.3, -169.6)],
    cage_side: [V3(-45.5, -14.35, -162.5), V3(-52.0, -14.9, -169.0)],
    shear: [V3(-50.9, -14.5, -167.4), V3(-51.9, -15.3, -168.6), 50],
    pump: [V3(-53.2, -14.35, -167.0), V3(-53.8, -15.25, -168.5), 55],
    lever: [V3(-49.6, -14.35, -167.2), V3(-50.25, -14.8, -168.6), 55],
    sheave: [V3(-50.2, -14.6, -170.2), V3(-52.0, -15.2, -171.6), 55],
    winch: [V3(-47.0, -14.35, -157.0), V3(-52.0, -14.9, -152.0)],
    trough: [V3(-52.0, -14.35, -157.5), V3(-52.0, -15.8, -165.0)],
    tether_dock: [V3(-52.0, -18.35, -166.7), V3(-52.0, -17.2, -172.5)],
    ladder_w: [V3(-62.0, -18.35, -176.0), V3(-58.4, -19.0, -176.0)],
    gate_w: [V3(-59.8, -18.35, -177.4), V3(-58.4, -18.4, -176.0), 55],
    gate_e: [V3(-44.2, -18.35, -177.4), V3(-45.6, -18.4, -176.0), 55],
    well_down: [V3(-55.0, -17.0, -176.0), V3(-52.0, -34.0, -176.5)],
    console: [V3(-44.0, -14.35, -160.8), V3(-44.0, -14.6, -158.0)],
    console_cam0: [V3(-44.0, -14.35, -159.4), V3(-44.0, -14.2, -157.9), 55],
    feed_direct: [V3(...FEED6.cam), V3(...FEED6.target), FEED6.fov],
    feed_wide: [V3(112, 6, 23.2), V3(112, 2.2, 2)],
  };
  let view = P('view', 'frame');
  const setView = (name: string) => {
    const v = VIEWS[name] ?? VIEWS.frame;
    view = name;
    mainOverride = name.startsWith('feed') ? new Set(['feed6']) : null; override = mainOverride; applyVis();
    camera.fov = v[2] ?? Number(P('fov', '72')); camera.updateProjectionMatrix();
    camera.position.copy(v[0]); camera.lookAt(v[1]); camera.updateMatrixWorld();
  };
  let mode = P('light', 'lit');
  const setLight = (m: string) => {
    mode = m;
    const d = m === 'dark';
    for (const h of [...heLit, ...vaLit, ...poolLit]) h.enabled = !d;
    for (const h of poolDark) h.enabled = d;
  };

  // ── feed spike
  const renderer = ctx.renderer;
  const feeds = (ctx.render as any)._debug.feeds;
  const syncRT = new THREE.WebGLRenderTarget(1, 1); const px = new Uint8Array(4);
  const sync = () => { const prev = renderer.getRenderTarget(); renderer.setRenderTarget(syncRT); renderer.clear(true, false, false); renderer.readRenderTargetPixels(syncRT, 0, 0, 1, 1, px); renderer.setRenderTarget(prev); };
  let passAcc: number[] | null = null, syncAcc: number[] | null = null;
  const fu = feeds.update.bind(feeds);
  feeds.update = (dt: number) => {
    const into = passAcc;
    if (!into) { fu(dt); return; }
    const n0 = feeds.stats.passes;
    sync(); const t = performance.now(); fu(dt);
    if (feeds.stats.passes !== n0) { sync(); into.push(performance.now() - t); }
    else if (syncAcc) { const t2 = performance.now(); sync(); syncAcc.push(performance.now() - t2); }
  };
  const frames = (n: number) => new Promise<void>((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const statsOf = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); const mean = a.reduce((x, y) => x + y, 0) / Math.max(1, a.length); return { n: a.length, mean: +mean.toFixed(3), p50: +(s[Math.floor(s.length / 2)] ?? 0).toFixed(3), p95: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(3) }; };
  const feed = {
    handle: null as FeedHandle | null,
    start() {
      if (feed.handle) return feed.handle;
      const f6 = O('feed6');
      const h = ctx.render.feed!({ name: 'cam_tern', width: 640, height: 360, hz: 15, rooms: ['feed6'], position: f6.cam.clone(), target: f6.target.clone(), fov: f6.fov, pinLights: f6.lights, exposure: FEED6.exposure, label: 'POST 4 — SUB BAY — CAM 2', clock: () => '14:58:07' } as any) as FeedHandle;
      feed.handle = h;
      con.page('feed', { texture: h.texture, text: 'POST 4 — SUB BAY — CAM 2\nSDV TERN — LAUNCHED 14:52\nLAUNCH AUTHORITY: AAS, L. (LT.) — PALM — LIVE' });
      return h;
    },
    stop() { feed.handle?.remove(); feed.handle = null; con.page('idle'); },
    async passCost(n = 240, quality?: Quality) {
      if (quality) { ctx.render.setQuality(quality); await frames(10); }
      feed.start();
      await frames(20);
      passAcc = []; syncAcc = [];
      await frames(n);
      const a = passAcc, o = syncAcc; passAcc = null; syncAcc = null;
      const w = statsOf(a), so = statsOf(o);
      return { quality: ctx.render.quality, wall: w, sync: so, net: +(w.mean - so.mean).toFixed(3), cpu: feeds.stats.lastCpuMs, calls: feeds.stats.lastCalls, tris: feeds.stats.lastTris };
    },
  };

  // ── timed demos
  const anim = (dur: number, f: (k: number) => void, done?: () => void) => L.tween(0, dur, f, done ?? null);
  const play = (name: string) => {
    switch (name) {
      case 'crank': anim(3.0, (k) => sw.setProgress(k), () => anim(1.0, (k) => sw.keyOut(k))); break;
      case 'unlock': anim(0.6, (k) => bj.unlock(k)); break;
      case 'open': anim(1.2, (k) => bj.open(k)); break;
      case 'strain': anim(3.0, (k) => bj.strain(k), () => bj.rip(cue)); break;
      case 'rip': bj.rip(cue); break;
      case 'pin': anim(1.2, (k) => frame.pin(k)); break;
      case 'pump': anim(6.0, (k) => frame.pump(k), () => anim(0.4, (k) => frame.guard(k))); break;
      case 'fire': frame.guard(1); anim(0.6, (k) => frame.lever(k), () => frame.fire(cue)); break;
      case 'gates': for (const l of [ladders.w, ladders.e]) anim(0.8, (k) => l.gate.open(k), () => L.after(0.8, () => l.gate.settle(0.9, () => cueLog.push('latch')))); break;
      case 'phone': ph.lift(); L.after(2.0, () => ph.drop()); break;
      case 'shaft': anim(0.6, (k) => sh.unlock(k)); break;
    }
  };

  // URL poses
  const pz = (k: string, f: (v: number) => void) => { const v = num(k); if (v !== null) f(v); };
  pz('crank', (v) => sw.setProgress(v)); pz('keyout', (v) => sw.keyOut(v));
  pz('unlock', (v) => bj.unlock(v)); pz('bj', (v) => bj.open(v)); pz('strain', (v) => bj.strain(v)); if (q.get('rip') === '1') bj.ripped();
  pz('shaft', (v) => sh.unlock(v)); pz('pin', (v) => frame.pin(v)); pz('pump', (v) => frame.pump(v)); pz('guard', (v) => frame.guard(v)); pz('lever', (v) => frame.lever(v));
  if (q.get('fired') === '1') frame.fired();
  pz('gate', (v) => { ladders.w.gate.open(v); ladders.e.gate.open(v); });
  if (q.get('phone') === 'lift') ph.lift(undefined, 0.01);
  if (q.get('page')) con.page(q.get('page')!, { text: q.get('page') === 'manifest' ? 'MANIFEST 0031-H — DISPATCH VIA MOON POOL — SUBSEA SHUTTLE\nB-01  14 APR  CLASP ASSY (CERVICAL) × 120\nB-14  WED 14:40  × 240  — IN WELL\nCONSIGNEE: —' : undefined });
  setLight(mode);

  let time = 0;
  const update = (dt: number) => { time += dt; ctx.time = time; L.updateTasks(dt); for (const u of L.updaters) u(dt, time); M.update(dt); };
  await ctx.render.prepare([V3(18, 1.6, -168), V3(-12, 1.6, -172), V3(-52, -14.4, -162), V3(-52, -18.4, -165), V3(112, 3, 12)]);
  update(1 / 60);
  setView(view);
  if (q.get('feed') === '1') feed.start();
  (window as any).__sp = {
    view: setView, views: Object.keys(VIEWS), light: setLight, sw, bj, shaft: sh, frame, well, ladders, console: con, phone: ph, feed, play, cueLog,
    step(dt: number, n = 1) { for (let i = 0; i < n; i++) update(dt); },
    stats: () => { const r = renderer.info.render; return { calls: r.calls, tris: r.triangles }; },
    moveOnly: () => moveOnlyBoxes6(L).map((b) => [b.min.toArray(), b.max.toArray()]),
    boxes: () => boxes.map((b) => [b.box.min.toArray(), b.box.max.toArray()]),
  };
  let last = performance.now(), acc = 0, nf = 0;
  const frame_ = (now: number) => {
    requestAnimationFrame(frame_);
    const raw = Math.min((now - last) / 1000, 0.1); last = now;
    acc += raw; nf++;
    if (acc > 0.5) { debug.fps = Math.round(nf / acc); acc = 0; nf = 0; }
    update(raw);
    // the post chain's height mist is based at y 0 (it blacks out everything below ≈ −2 m): follow the eye's floor (see W7 report)
    (ctx.render as any)._debug.post.look.mistBase = camera.position.y < -1 ? (camera.position.y < -16.5 ? -20 : -16) : 0;
    ctx.render.render(raw);
    const r = renderer.info.render;
    hud.textContent = `W7 level-6 set pieces — view ${view}  light ${mode}  fps ${debug.fps}  calls ${r.calls}  tris ${r.triangles}  feed ${feed.handle ? 'on' : 'off'}\n${cueLog.slice(-6).join('  ')}`;
  };
  ctx.render.render(0);
  ctx.ready = true;
  requestAnimationFrame((t) => { last = t; frame_(t); });
}

main().catch((e) => { console.error(e); (window as any).__game = { ready: true, debug: { fps: 0 } }; });
