/**
 * K1 feeds spike — dev driver, loaded only with `?feedtest=1` (render/index.ts imports it lazily).
 *
 *   /?level=2&autostart=1&nostory=1&feedtest=1&spawn=0,0,-1.5,0
 *
 * Level 2: a monitor stands in FREIGHT DOCK 5 showing a live feed of LINE TWO (the hall) + INTAKE; three husk actors
 * walk from the intake through `d2_line` into the hall and back, in a loop. The dock's own doors stay shut, so the main
 * camera's portal culling hides the hall: everything on the monitor is drawn only because of the feed's override.
 *
 * Console / scripts: `window.__feedtest`
 *   .feed.active = true|false
 *   .view('dock' | 'monitor' | 'direct')        main camera: player / close-up on the monitor / the feed camera's pose
 *   .bench(frames)  → frame-time stats (enemies.update + render.render, GPU-synced) for the current state
 *   .passCost(frames) → per feed pass wall time (CPU + GPU, synced before/after)
 *   .diffMain()     → main view feed off / on / off pixel diffs (monitor excluded), game paused, grain off
 *   .feedLuma() / .viewLuma() → mean luminance of the feed texture / of the main canvas
 *   .report         → actor-visibility assertions from the pass hook
 */
import * as THREE from 'three';
import type { EnemyActor, GameContext, Quality } from '../../core/types';
import type { RenderSystemEx } from '../index';
import type { FeedHandle } from '../feed';

type View = 'dock' | 'monitor' | 'direct';

const FEED_ROOMS = ['line', 'intake'];
const CAM_POS = new THREE.Vector3(7.0, 4.2, -31.0);
const CAM_AT = new THREE.Vector3(-0.5, 1.1, -22.5);
const CAM_FOV = 58;
const MONITOR = { pos: new THREE.Vector3(1.3, 1.55, -5.0), w: 1.44, h: 0.81 };
const PATH_IN = [new THREE.Vector3(0, 0, -19.0), new THREE.Vector3(0.6, 0, -25.0), new THREE.Vector3(2.2, 0, -29.5)];
const STARTS = [new THREE.Vector3(-1.2, 0, -12.5), new THREE.Vector3(0.9, 0, -14.4), new THREE.Vector3(-0.3, 0, -16.3)];

export function installFeedTest(ctx: GameContext, render: RenderSystemEx): void {
  const wait = () => new Promise<void>((r) => {
    const tick = () => (ctx.ready && ctx.level && ctx.enemies && ctx.player ? r() : setTimeout(tick, 50));
    tick();
  });
  void wait().then(() => setup(ctx, render));
}

function setup(ctx: GameContext, render: RenderSystemEx): void {
  if (ctx.levelId !== 2) { console.error('[feedtest] needs ?level=2'); return; }
  const renderer = ctx.renderer;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const feeds = render._debug.feeds;

  // ── the feed
  const programs0 = renderer.info.programs?.length ?? 0;
  const feed: FeedHandle = render.feed({
    slices: Number(new URLSearchParams(location.search).get('slices') ?? 4),
    name: 'cam_line', rooms: FEED_ROOMS, position: CAM_POS, target: CAM_AT, fov: CAM_FOV, hz: 12,
    label: 'CAM 04  LINE TWO', clock: () => {
      const t = Math.floor(ctx.time) + 22 * 3600 + 40 * 60;
      const p = (n: number) => String(n).padStart(2, '0');
      return `${p(Math.floor(t / 3600) % 24)}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`;
    },
  });

  // ── the monitor (a plain screen: black body, the feed as emissive, as a `feed` ScreenKind would be — P1 owns that)
  const g = new THREE.Group();
  g.position.copy(MONITOR.pos);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(MONITOR.w + 0.1, MONITOR.h + 0.1, 0.08), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.3 }));
  bezel.position.z = -0.045;
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.25, metalness: 0, emissive: 0xffffff, emissiveMap: feed.texture, emissiveIntensity: 2.0 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(MONITOR.w, MONITOR.h), screenMat);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, MONITOR.pos.y - MONITOR.h / 2, 0.08), bezel.material);
  stand.position.set(0, -(MONITOR.pos.y - MONITOR.h / 2) / 2 - MONITOR.h / 2, -0.06);
  g.add(bezel, screen, stand);
  g.userData.feedtest = true;
  ctx.scene.add(g);
  g.updateMatrixWorld(true);

  // ── the walkers
  const door = ctx.level.door('d2_line') as unknown as { auto: boolean; open(): void; close(): void };
  door.auto = false;
  door.open();
  const actors: EnemyActor[] = STARTS.map((p) => ctx.enemies.actor('husk', p.clone(), Math.PI, 'idle'));
  for (const a of actors) a.setEyes(true);
  let walking = true;
  const walk = async (a: EnemyActor, k: number) => {
    await new Promise((r) => setTimeout(r, 400 + k * 900));
    while (walking) {
      for (const p of PATH_IN) await a.moveTo(p.clone().add(new THREE.Vector3((k - 1) * 0.9, 0, 0)), 1.5);
      for (const p of [...PATH_IN].reverse().slice(1)) await a.moveTo(p.clone().add(new THREE.Vector3((k - 1) * 0.9, 0, 0)), 1.5);
      await a.moveTo(STARTS[k].clone(), 1.5);
    }
  };
  actors.forEach((a, k) => void walk(a, k));

  // ── pass hook: every actor in a feed room must be visible during the pass
  const report = { passes: 0, actorChecks: 0, actorHidden: 0, levelHidden: 0, programsBefore: programs0, programsAfter10: -1, newPrograms: [] as string[] };
  const hallTag = ctx.level.root.children.filter((o) => (o.userData.rooms as string[] | undefined)?.length === 1 && o.userData.rooms[0] === 'line');
  feeds.onPass = () => {
    report.passes++;
    for (const a of actors) { report.actorChecks++; if (!a.object.visible) report.actorHidden++; }
    for (const o of hallTag) if (!o.visible) report.levelHidden++;
    if (report.passes === 10) {
      const ps = renderer.info.programs ?? [];
      report.programsAfter10 = ps.length;
      report.newPrograms = ps.slice(programs0).map((p) => (p as unknown as { name: string }).name);
    }
  };

  // ── camera views (applied right after the player positions the camera, so the level's culling uses them)
  let view: View = 'dock';
  const mainFov = ctx.camera.fov;
  const pu = ctx.player.update.bind(ctx.player);
  ctx.player.update = (dt: number) => {
    pu(dt);
    if (view === 'dock') { if (ctx.camera.fov !== mainFov) { ctx.camera.fov = mainFov; ctx.camera.updateProjectionMatrix(); } return; }
    if (view === 'direct') {
      ctx.camera.position.copy(feed.camera.position);
      ctx.camera.quaternion.copy(feed.camera.quaternion);
      ctx.camera.fov = feed.camera.fov;
    } else {
      ctx.camera.position.copy(MONITOR.pos).add(new THREE.Vector3(0, 0, 0.95));
      ctx.camera.lookAt(MONITOR.pos);
      ctx.camera.fov = 50;
    }
    ctx.camera.updateProjectionMatrix();
    ctx.camera.updateMatrixWorld();
  };

  // ── timing wrappers
  // Timing. Frame time = interval between consecutive frames (run the browser without vsync / frame-rate limit to
  // see real costs) plus the CPU wall time of enemies.update + render.render. Pass cost = wall time of one feed pass
  // between two full GPU syncs (1-pixel read-backs from an RGBA8 target), i.e. CPU submit + GPU execution, serialized.
  // (EXT_disjoint_timer_query_webgl2 exists on ANGLE-Metal but returned nonsense here: a 128×72 pass "cost" more than 512×288.)
  type Rec = { cpu: number; dt: number; feed: boolean };
  let frameAcc: Rec[] | null = null;
  let passAcc: number[] | null = null;
  let syncAcc: number[] | null = null;
  const px = new Uint8Array(4);
  // a private 1×1 RGBA8 target, cleared then read: the read waits for everything queued before it, and reading it back
  // costs nothing (reading the sRGB feed texture itself added ≈ 5 ms of conversion to every sample — measured)
  const syncRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const sync = () => {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(syncRT);
    renderer.clear(true, false, false);
    renderer.readRenderTargetPixels(syncRT, 0, 0, 1, 1, px);
    renderer.setRenderTarget(prev);
  };
  let frameT = 0, lastFrame = 0;
  let capture: ((pixels: Uint8Array) => void) | null = null;
  const eu = ctx.enemies.update.bind(ctx.enemies);
  ctx.enemies.update = (dt: number) => {
    const t = performance.now();
    eu(dt);
    frameT = performance.now() - t;
  };
  const rr = render.render.bind(render);
  render.render = (dt: number) => {
    const passes = feeds.stats.passes;
    const t = performance.now();
    rr(dt);
    const now = performance.now();
    if (frameAcc && lastFrame) frameAcc.push({ cpu: frameT + now - t, dt: t - lastFrame, feed: feeds.stats.passes !== passes });
    lastFrame = t;
    frameT = 0;
    if (capture) {
      const w = ctx.canvas.width, h = ctx.canvas.height, buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const c = capture; capture = null; c(buf);
    }
  };
  const fu = feeds.update.bind(feeds);
  feeds.update = (dt: number) => {
    const into = passAcc;
    if (!into) { fu(dt); return; }
    const passes = feeds.stats.passes;
    sync();
    const t = performance.now();
    fu(dt);
    if (feeds.stats.passes !== passes) { sync(); into.push(performance.now() - t); }
    else if (syncAcc) { const t2 = performance.now(); sync(); syncAcc.push(performance.now() - t2); } // overhead of a sync alone
  };

  const frames = (n: number) => new Promise<void>((r) => {
    let k = 0;
    const f = () => (++k >= n ? r() : requestAnimationFrame(f));
    requestAnimationFrame(f);
  });
  const statsOf = (a: number[]) => {
    const s = a.slice().sort((x, y) => x - y);
    const mean = a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    return { n: a.length, mean: +mean.toFixed(3), p50: +(s[Math.floor(s.length * 0.5)] ?? 0).toFixed(3), p95: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(3), max: +(s[s.length - 1] ?? 0).toFixed(3) };
  };
  const grab = () => new Promise<Uint8Array>((r) => { capture = r; });
  const lumaOf = (buf: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number, srgb: boolean) => {
    // mean relative luminance of display-encoded pixels, decoded to linear (and the mean code value)
    const dec = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    let sum = 0, code = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const r = buf[i], g2 = buf[i + 1], b = buf[i + 2];
      sum += srgb ? 0.2126 * dec(r) + 0.7152 * dec(g2) + 0.0722 * dec(b) : (0.2126 * r + 0.7152 * g2 + 0.0722 * b) / 255;
      code += (0.2126 * r + 0.7152 * g2 + 0.0722 * b) / 255;
      n++;
    }
    return { linear: +(sum / n).toFixed(4), code: +(code / n).toFixed(4) };
  };
  /** Monitor rectangle in canvas pixels (GL origin bottom-left), with a margin. */
  const monitorRect = () => {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const p = new THREE.Vector3(MONITOR.pos.x + sx * (MONITOR.w / 2 + 0.06), MONITOR.pos.y + sy * (MONITOR.h / 2 + 0.06), MONITOR.pos.z).project(ctx.camera);
      const x = (p.x * 0.5 + 0.5) * w, y = (p.y * 0.5 + 0.5) * h;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const m = 6;
    return { x0: Math.max(0, Math.floor(x0) - m), y0: Math.max(0, Math.floor(y0) - m), x1: Math.min(w, Math.ceil(x1) + m), y1: Math.min(h, Math.ceil(y1) + m) };
  };
  const diff = (a: Uint8Array, b: Uint8Array, rect: { x0: number; y0: number; x1: number; y1: number }) => {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    let sum = 0, max = 0, over = 0, n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1) continue;
      const i = (y * w + x) * 4;
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      sum += d; n++; if (d > max) max = d; if (d > 8) over++;
    }
    return { meanAbs: +(sum / n).toFixed(4), max, over8: over, pixels: n };
  };

  const api = {
    feed, actors, report, feeds,
    view(v: View) { view = v; },
    setQuality(q: Quality) { render.setQuality(q); },
    async bench(n = 360) {
      await frames(20);
      frameAcc = [];
      await frames(n);
      const all = frameAcc;
      frameAcc = null;
      const pick = (f: (r: Rec) => boolean, k: 'cpu' | 'dt') => statsOf(all.filter(f).map((r) => r[k]));
      return {
        quality: render.quality, active: feed.active, canvas: [ctx.canvas.width, ctx.canvas.height],
        frame: pick(() => true, 'dt'), cpu: pick(() => true, 'cpu'),
        cpuFeedFrames: pick((r) => r.feed, 'cpu'), cpuOther: pick((r) => !r.feed, 'cpu'),
        feedStats: { ...feeds.stats },
      };
    },
    async passCost(n = 360) {
      await frames(10);
      passAcc = []; syncAcc = [];
      await frames(n);
      const a = passAcc, o = syncAcc; passAcc = null; syncAcc = null;
      const ldr = (feed as unknown as { ldr: THREE.WebGLRenderTarget }).ldr;
      const so = statsOf(o);
      return { quality: render.quality, wall: statsOf(a), syncOverhead: so, net: +(statsOf(a).mean - so.mean).toFixed(3), cpuSubmitLast: feeds.stats.lastCpuMs, calls: feeds.stats.lastCalls, tris: feeds.stats.lastTris, size: [ldr.width, ldr.height] };
    },
    feedLuma() {
      const t = (feed as unknown as { ldr: THREE.WebGLRenderTarget }).ldr;
      const buf = new Uint8Array(t.width * t.height * 4);
      renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, buf);
      // skip the overlay strip at the top (label / clock) — rows are bottom-up
      return lumaOf(buf, t.width, 0, 0, t.width, Math.floor(t.height * 0.88), true);
    },
    async viewLuma() {
      const buf = await grab();
      const w = ctx.canvas.width, h = ctx.canvas.height;
      return lumaOf(buf, w, 0, 0, w, Math.floor(h * 0.88), true);
    },
    async diffMain(settle = 40) {
      const grain = render.settings.grain;
      render.settings.grain = 0;
      const prevState = ctx.state;
      ctx.setState('paused');
      try {
        feed.active = false; await frames(settle);
        const a = await grab();
        feed.active = true; await frames(settle);
        const b = await grab();
        const pinnedOn = { ...feeds.stats };
        feed.active = false; await frames(settle);
        const c = await grab();
        const rect = monitorRect();
        return { rect, offOn: diff(a, b, rect), offOff: diff(a, c, rect), whileOn: pinnedOn };
      } finally {
        render.settings.grain = grain;
        ctx.setState(prevState);
        feed.active = true;
      }
    },
    stop() { walking = false; },
  };
  (window as unknown as { __feedtest: typeof api }).__feedtest = api;
  console.info('[feedtest] ready');
}
