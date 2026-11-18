// Lights-out readability on LOW and MEDIUM (stage 3b §8.11, §10.4; D15; 3a lesson 5). Task T.
//
//   node scripts/check-dark.mjs [--url http://127.0.0.1:5173] [--quality low,medium] [--views corr_w,cold_door]
//        [--view x,y,z,yaw[,pitch]] [--no-selftest] [--json shots/checks/dark-l4.json]
//
// On a static build (vite build + vite preview). Exit 1 on any failure.
// For each quality and view: `?level=4&nostory=1&noenemies=1&autostart=1&quality=<q>&spawn=<view>`, the level's
// `lights_out4` vignette (§4.3: Deck-2 groups dim to 0 in a wave, `<room>_emerg` + floor strips on), the flashlight on,
// the HUD hidden, a 1280 × 720 screenshot of what the player sees (post-processing included) → `shots/l4/dark/`.
//
// THE METRIC (every value is luma on the displayed, gamma-encoded sRGB pixel: Y' = 0.2126 R' + 0.7152 G' + 0.0722 B',
// 0 … 1; 1/255 ≈ 0.004). A view passes when ALL hold:
//   CONE   mean Y' of the centre 30 % × 30 % (where the flashlight lands) ≥ 0.16 (≈ 41/255).
//            Why: below ≈ 0.10 (25/255) an ordinary LCD at default brightness in a lit room crushes to black (most
//            panels' black level sits at 15–20/255); 0.16 keeps the floor / wall / door 2–8 m ahead a clearly
//            separate dark grey with room for the darker parts of the texture.
//   DETAIL p90 − p10 of Y' in the same centre box ≥ 0.08 (≈ 20/255).
//            Why: a flat haze or a fog wash can reach the mean without showing anything; 20 code values between the
//            dark and bright tenths is the smallest spread in which seams, door frames, edges and props read as shapes.
//   FRAME  mean Y' of the whole frame ≥ 0.04 (≈ 10/255).
//            Why: proves the view is not a black screen with one spot — the player keeps some context of the space.
//   STRIPS ≥ 3 % of the pixels in the outer 20 % ring (outside the 60 % × 60 % centre) have Y' ≥ 0.06 (≈ 15/255).
//            Why: the emergency floor strips (4 cm, emissive 1.2, both sides of every corridor and lab aisle), the lit
//            door panels and screens must show in peripheral vision outside the cone: two strip lines along the floor
//            edges at 1280 × 720 alone are ≈ 2 % of the ring; with panels and the cone's spill 3 % is the floor of a
//            readable periphery. 15/255 is just above the display black level (an emissive strip is far brighter;
//            the threshold only has to separate "something is there" from black).
//   TARGETS every door, interactable (readables, buttons, levers) and pickup of the level that is within 10 m, has a
//            clear line of sight from the eye, and projects into the central 60 % × 60 %: in its screen window
//            (doors: the frame ±1.2 m × floor+0.2 … +2.4 m; others: ±0.25 m around it, at least 12 × 12 px) the
//            p95 Y' ≥ 0.12 (≈ 31/255: a lit status panel, a lit edge or the object in the cone stands out of the
//            0.06 periphery by ≥ 2×). Targets farther out are listed, not judged.
// SELF-TEST (always, unless --no-selftest): the same metric must FAIL on (1) a synthetic black frame, (2) a uniform
// 0.25 grey frame (passes CONE/FRAME/STRIPS, must fail DETAIL — proves the contrast term), and (3) a real frame of
// the running game pushed through the same screenshot + decode path with the canvas forced black (CSS
// brightness(0)). If any of those passes, the check itself is broken: exit 1.
//
// FLASHLIGHT BATTERY (the lamp drains in 10 s and recharges in 4 s): every view is judged twice —
//   LAMP    the frame above with the cell FULL (set just before the screenshot; the beam at full brightness): the
//           level must be readable by flashlight;
//   NO LAMP the same view with the lamp OFF (it is off ≈ 30 % of the time even when used well): the route must still be
//           followable by the emergency lighting alone (§8.11: strips, lit door panels, `<room>_emerg`):
//             GLOW  ≥ 1.5 % of ALL pixels have Y' ≥ 0.06 (strips / panels / emergency pools exist in the frame), and
//             FAR   the frame mean ≥ 0.015 (not a black screen with a few dots).
//           Doors and interactables within 10 m in the central 60 % are listed with their p95 (reported, not judged:
//           a door panel 8 m off may be a few pixels).
// Views (§10.4): corr_w, corr_s, vivarium door, cold door, records door, scrub. On a level without them (K's stub, a
// greybox without `lights_out4`), each missing room / door / vignette is a named failure; the stub's spawn view is still
// measured as a pipeline smoke run (reported, not a pass).
//
// LEVEL 6 (`--level 6`, stage 3d §10.4): see runLevel6 below (views, glow incl. the loader and a flood-lit soldier,
//   three dark runs; skipped with a note on a build without the level-6 greybox unless --strict6).
// LEVEL 5 (`--level 5`, stage 3c §10.4, D16 / D18, §2.7.3) — after `lights_out5` + `dark5_on`, on LOW and MEDIUM:
//   [views] spine ×2, crawl ×2 (crouched), magazine, berths, sub-bay floor ×2, west gallery, the wheel, bridge, dive —
//          the plan's spawns, each asserted inside its room's interior (roomAt + 0.3 m inset) on a real floor; a spawn
//          that is not (a corrected layout) moves to the nearest free spot of that room ≤ 1.5 m away and says so.
//   LIGHT    `player.debug.torch(1)`, lamp on: the merged metric above (cone, detail, frame, strips, targets ≥ 0.12).
//   NO-LIGHT `player.debug.torch(0)`, lamp off: the merged lamp-OFF rule (glow ≥ 1.5 %, frame ≥ 0.015) AND level 5's
//            measure 1: frame mean ≥ 0.025, outer-ring strips ≥ 3 %, and every door frame, stair nosing (nav stair
//            nodes), gallery edge (the open edges of every upper deck in `Room.floors`) and required interactable
//            (wheel5, hatch5_spine, hatch5_mag, key5_duty) within 10 m in line of sight, in the central 60 %, p95 ≥ 0.10.
//   [glow]   (`noenemies=0`) a soldier (pose `hold` where the manager offers `spawnPose`), a husk and a skitter at 10 /
//            20 / 30 m in the dark sub bay (a clear 30 m lane found from the room's north end) and in the crawl (the
//            distances that fit its length): each enemy's dark-room mark must add ≥ 3 px (a 2.2 px mark) of luma ≥ 0.5
//            over a frame without it (lamp off), the soldier's red (R ≥ 1.5 × G and B) and never cyan; frames are taken
//            over 2.2 s (his mark blinks 1 Hz, 0.12 s on).
//   [run]    the dark run: the main route after V on the nav graph (spine at d5_key → d5_bay → the bridge (t5_bridge) →
//            the west gallery → wheel5 → d5_tunnel), sampled every 2 m with the lamp off, measure 1 per sample; fails
//            on > 4 consecutive failing samples (an unreadable stretch > 8 m).
//   PNGs → shots/l5/dark/, numbers → shots/checks/dark-l5.json. Thresholds: §10.4 minimums (IA calibrates with
//   `--measure` on real frames, never below these). Missing rooms / vignettes / groups are named failures (K's stub).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { launch, parseArgs } from './lib/check-common.mjs';

const args = parseArgs();
const base = (args.url ?? process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const QUALITIES = (args.quality ?? 'low,medium').split(',');
const LEVEL = Number(args.level ?? 4);
const W = 1280, H = 720;
const T = { cone: 0.16, detail: 0.08, frame: 0.04, ringPx: 0.06, ringFrac: 0.03, target: 0.12, targetDist: 10, glowFrac: 0.015, darkFrame: 0.015 };
/** §10.4 views: spawn = feet x, y, z, yaw° (+90 = −x), pitch°; `room` the plan room the view stands in; `door` faced. */
const VIEWS = [
  { id: 'corr_w', spawn: [-13.5, 4.8, -20, 0], room: 'corr_w' },
  { id: 'corr_s', spawn: [-10, 4.8, -35.5, -90], room: 'corr_s' },
  // (the three "door" views stand just inside the door, looking INTO the room as the player enters it: the door is
  // behind the camera — §10.4's spawns; integration: the view room corrected, the door is not a faced target)
  { id: 'viv_door', spawn: [-16, 4.8, -22, 90], room: 'vivarium' },
  { id: 'cold_door', spawn: [-11, 4.8, -29, -90], room: 'cold' },
  { id: 'rec_door', spawn: [11, 4.8, -29, 90], room: 'records' },
  { id: 'scrub', spawn: [0, 4.8, -38, 0], room: 'scrub' },
];
const want = args.views ? new Set(args.views.split(',')) : null;
const views = VIEWS.filter((v) => !want || want.has(v.id));
if (args.view) { const n = args.view.split(',').map(Number); views.push({ id: 'custom', spawn: n, room: null }); }
const OUT = `shots/l${LEVEL}/dark`;
mkdirSync(OUT, { recursive: true });

const problems = [];
const bad = (m) => { problems.push(m); console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);
const check = (c, m) => (c ? ok(m) : bad(m));
const f3 = (v) => (typeof v === 'number' ? v.toFixed(3) : String(v));

const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const warnings = [];
page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log(`  [pageerror] ${e.message}`); });
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'warning' || m.type() === 'error') warnings.push(t);
  if (m.type() === 'error') console.log(`  [console.error] ${t.slice(0, 200)}`);
});
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

/** The metric, in the page (decode the PNG with the browser, then the statistics). `kind` = png | black | grey. */
async function measure(png, kind = 'png', targets = []) {
  return ev(async ([b64, kind, W, H, T, targets]) => {
    let d;
    if (kind === 'png') {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d');
      x.drawImage(bmp, 0, 0); d = x.getImageData(0, 0, bmp.width, bmp.height).data;
    } else {
      d = new Uint8ClampedArray(W * H * 4);
      const v = kind === 'grey' ? Math.round(0.25 * 255) : 0;
      for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    }
    const Y = new Float32Array(W * H);
    for (let i = 0, k = 0; k < Y.length; i += 4, k++) Y[k] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const pct = (arr, p) => { if (!arr.length) return 0; const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
    const box = (x0, y0, x1, y1) => { const out = []; for (let y = Math.max(0, y0 | 0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(W, x1); x++) out.push(Y[y * W + x]); return out; };
    const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
    const cen = box(W * 0.35, H * 0.35, W * 0.65, H * 0.65);
    const ring = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < W * 0.2 || x >= W * 0.8 || y < H * 0.2 || y >= H * 0.8) ring.push(Y[y * W + x]);
    const m = {
      cone: mean(cen), detail: pct(cen, 0.9) - pct(cen, 0.1), frame: mean(Y),
      ringFrac: ring.filter((v) => v >= T.ringPx).length / ring.length, ringMedian: pct(ring, 0.5),
    };
    m.glowFrac = Y.filter((v) => v >= T.ringPx).length / Y.length;
    m.pass = { cone: m.cone >= T.cone, detail: m.detail >= T.detail, frame: m.frame >= T.frame, strips: m.ringFrac >= T.ringFrac };
    m.passDark = { glow: m.glowFrac >= T.glowFrac, far: m.frame >= T.darkFrame };
    m.targets = targets.map((t) => { const v = pct(box(t.x0, t.y0, t.x1, t.y1), 0.95); return { ...t, p95: v, pass: v >= T.target }; });
    m.ok = Object.values(m.pass).every(Boolean) && m.targets.every((t) => t.pass);
    return m;
  }, [png ? png.toString('base64') : '', kind, W, H, T, targets]);
}
const verdict = (m) => `cone ${f3(m.cone)} (≥ ${T.cone}) · detail ${f3(m.detail)} (≥ ${T.detail}) · frame ${f3(m.frame)} (≥ ${T.frame}) · ring lit ${(m.ringFrac * 100).toFixed(1)} % (≥ ${T.ringFrac * 100} %)`;

async function boot(q, spawn, { enemies = false } = {}) {
  const s = spawn ? `&spawn=${spawn.join(',')}` : '';
  for (let i = 0; ; i++) {
    try { await page.goto(`${base}/?level=${LEVEL}&nostory=1${enemies ? '&god=1' : '&noenemies=1'}&autostart=1&quality=${q}${s}`); break; } catch (e) { if (i >= 2) throw e; await wait(700); }
  }
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000 });
  await wait(2000);
}
/** What the level offers for the views (rooms, doors), and whether lights-out works. */
const levelInfo = () => ev(() => {
  const g = window.__game;
  const gm = g.render.lights.groups;
  const groups = gm instanceof Map ? [...gm.keys()] : Object.keys(gm ?? {});
  return { level: g.levelId, rooms: g.level.rooms.map((r) => r.id), doors: g.level.doors.map((d) => d.id), groups, quality: g.render.quality };
});
async function lightsOut() {
  const before = warnings.length;
  const r = await ev(() => {
    const g = window.__game;
    g.level.vignette('lights_out4');
    g.player.debug.torch?.(1);
    g.player.debug.flashlight(true);
    g.ui.setHudVisible(false);
    return true;
  });
  // §4.3: 1.5 s fade in a wave at 0.04 s/m from (−6, −29): the far end of the clean side is ≈ 35 m → ≈ 3 s; settle
  await wait(4500);
  const unknown = warnings.slice(before).some((w) => /unknown vignette "lights_out4"/.test(w));
  const st = await ev(() => {
    const g = window.__game, L = g.render.lights;
    // (the light manager's group table is private: read it as the Map it is, or a record)
    const names = L.groups instanceof Map ? [...L.groups.keys()] : Object.keys(L.groups ?? {});
    const on = (n) => L.group(n).filter((h) => h.enabled && h.factor > 0.01).length;
    return {
      emerg: names.filter((n) => n.endsWith('_emerg')).map((n) => [n, L.group(n).length, on(n)]),
      lit: names.filter((n) => !n.endsWith('_emerg') && !n.startsWith('player') && L.group(n).length).map((n) => [n, on(n)]),
      flash: g.player.flashlightOn,
    };
  });
  return { ran: r && !unknown, unknown, ...st };
}
/** Screen windows of every door / interactable / pickup within 10 m, in sight, in the central 60 %. */
const targetsInView = () => ev(([W, H, D]) => {
  const g = window.__game, cam = g.camera, V = cam.position.constructor;
  cam.updateMatrixWorld(); const eye = g.player.eye.clone();
  const proj = (x, y, z) => { const v = new V(x, y, z).project(cam); return { sx: (v.x + 1) / 2 * W, sy: (1 - v.y) / 2 * H, front: v.z < 1 && v.z > -1 }; };
  const out = [], far = [];
  const add = (kind, id, p, rx, y0, y1) => {
    const c = new V(p.x, (y0 + y1) / 2, p.z), dist = c.distanceTo(eye);
    const s = proj(c.x, c.y, c.z);
    if (!s.front) return;
    const central = s.sx > W * 0.2 && s.sx < W * 0.8 && s.sy > H * 0.2 && s.sy < H * 0.8;
    // line of sight to the target (a door: to a point 0.25 m in front of the leaf, toward the eye)
    const to = c.clone().add(eye.clone().sub(c).setLength(kind === 'door' ? 0.3 : 0.12));
    const los = g.physics.lineOfSight(eye, to);
    if (!central || !los || dist > D) { if (central && dist <= D + 6) far.push({ kind, id, dist: +dist.toFixed(1), los }); return; }
    // the window: project the extent's corners (in the plane facing the camera)
    const right = new V().crossVectors(cam.getWorldDirection(new V()), new V(0, 1, 0)).normalize();
    const pts = [[-rx, y0], [rx, y0], [-rx, y1], [rx, y1]].map(([dx, y]) => proj(p.x + right.x * dx, y, p.z + right.z * dx));
    let x0 = Math.min(...pts.map((q) => q.sx)), x1 = Math.max(...pts.map((q) => q.sx)), yy0 = Math.min(...pts.map((q) => q.sy)), yy1 = Math.max(...pts.map((q) => q.sy));
    if (x1 - x0 < 12) { const m = (x0 + x1) / 2; x0 = m - 6; x1 = m + 6; }
    if (yy1 - yy0 < 12) { const m = (yy0 + yy1) / 2; yy0 = m - 6; yy1 = m + 6; }
    out.push({ kind, id, dist: +dist.toFixed(1), x0: Math.round(x0), y0: Math.round(yy0), x1: Math.round(x1), y1: Math.round(yy1) });
  };
  for (const d of g.level.doors) { const y = d.y ?? 0; add('door', d.id, d.position, 1.2, y + 0.2, y + 2.4); }
  const pick = new Set(g.level.pickupSpawns.map((p) => p.id));
  for (const i of g.interactables.all) if (i.enabled && i.kind !== 'door' && !pick.has(i.id)) add('use', i.id, i.position, 0.25, i.position.y - 0.25, i.position.y + 0.25);
  const taken = new Set(g.player.snapshot().pickups ?? []);
  for (const p of g.level.pickupSpawns) if (!taken.has(p.id)) add('pickup', p.id, p.position, 0.25, p.position.y - 0.1, p.position.y + 0.3);
  return { out, far };
}, [W, H, T.targetDist]);

const report = { thresholds: T, selftest: null, runs: [] };

// `--measure a.png[,b.png]`: only print the metric of existing 1280 × 720 PNGs (calibration), no game
if (args.measure) {
  const { readFileSync } = await import('node:fs');
  await page.goto('about:blank');
  for (const f of args.measure.split(',')) console.log(`  ${f}: ${verdict(await measure(readFileSync(f), 'png'))}`);
  await browser.close();
  process.exit(0);
}

// ───────────────────────────────────────────────────────────── self-test: the metric must fail on black
if (!args['no-selftest']) {
  console.log('── self-test (the metric must FAIL on a black frame)');
  await boot('low', null);
  const blk = await measure(null, 'black');
  check(!blk.ok && !blk.pass.cone && !blk.pass.detail && !blk.pass.frame && !blk.pass.strips, `synthetic black frame fails every term: ${verdict(blk)}`);
  check(!blk.passDark.glow && !blk.passDark.far, `synthetic black frame fails the NO LAMP terms too`);
  const grey = await measure(null, 'grey');
  check(!grey.ok && grey.pass.cone && grey.pass.frame && grey.pass.strips && !grey.pass.detail, `uniform 0.25 grey passes cone/frame/strips but fails DETAIL: ${verdict(grey)}`);
  await ev(() => { window.__game.renderer.domElement.style.filter = 'brightness(0)'; window.__game.ui.setHudVisible(false); });
  await wait(400);
  const shot = await page.screenshot();
  const real = await measure(shot, 'png');
  await ev(() => { window.__game.renderer.domElement.style.filter = ''; });
  check(!real.ok && !real.pass.cone && !real.pass.frame, `a real game frame forced black, through the screenshot + decode path, fails: ${verdict(real)}`);
  // and the same frame un-blacked actually reaches the decoder (non-zero) — the path is not always black
  const lit = await measure(await page.screenshot(), 'png');
  check(lit.frame > real.frame, `the same view un-blacked decodes brighter (${f3(lit.frame)} > ${f3(real.frame)}): the decode path is live`);
  report.selftest = { black: blk, grey, forcedBlack: real, unblacked: { frame: lit.frame } };
}

// ───────────────────────────────────────────────────────────── level 5 (stage 3c §10.4)
/** The plan's views: spawn = feet x, y, z, yaw° (+90 = −x); `room` asserted; `crouch` for the crawl. */
const VIEWS5 = [
  { id: 'spine_w', spawn: [12, 0, -16, -90], room: 'spine5' },
  { id: 'spine_e', spawn: [38, 0, -15, 90], room: 'spine5' },
  { id: 'crawl_e', spawn: [34, -1.4, -16, 90], room: 'spine5', crouch: true },
  { id: 'crawl_w', spawn: [20, -1.4, -16, 90], room: 'spine5', crouch: true },
  { id: 'magazine', spawn: [17, -2.6, -24, 180], room: 'arm5' },
  { id: 'berths', spawn: [18, 0, -8, 0], room: 'berths5' },
  { id: 'bay_n', spawn: [34, 0, -22, 0], room: 'sub5' },
  { id: 'bay_s', spawn: [30, 0, -46, -90], room: 'sub5' },
  { id: 'gallery_w', spawn: [23.6, 4.8, -30, 0], room: 'sub5' },
  { id: 'wheel', spawn: [23.6, 4.8, -50, 90], room: 'sub5' },
  { id: 'bridge', spawn: [34, 4.8, -35, 0], room: 'sub5' },
  { id: 'dive', spawn: [48, 0, -34, -90], room: 'dive5' },
];
const T5 = { frame: 0.025, ringFrac: 0.03, target: 0.10, markPx: 3, markLuma: 0.5, runFails: 4, step: 2 };
const REQUIRED5 = ['wheel5', 'hatch5_spine', 'hatch5_mag', 'key5_duty'];
const views5 = VIEWS5.filter((v) => !want || want.has(v.id));
/** Page helpers for level 5 (free spot, floors, targets) — installed after each boot. */
const install5 = () => ev(() => {
  const g = window.__game, V = g.player.position.constructor, los = (a, b) => g.physics.lineOfSight(a, b);
  const S = window.__D5 = {};
  S.floors = (x, z) => { const r = g.level.roomAt(new V(x, 0, z)); if (!r) return []; const ys = [r.floor ?? r.y0 ?? 0]; for (const f of r.floors ?? []) if (x >= f.box[0] && x <= f.box[1] && z >= f.box[2] && z <= f.box[3]) ys.push(f.y); return ys; };
  S.interior = (x, z, inset = 0.3) => { const r = g.level.roomAt(new V(x, 0, z)); if (!r) return null; const b = r.bounds, k = 0.2 + inset; return x >= b.min.x + k && x <= b.max.x - k && z >= b.min.z + k && z <= b.max.z - k ? r.id : null; };
  S.free = (x, y, z, crouch) => {
    if (los(new V(x, y + 0.35, z), new V(x, y - 0.35, z))) return false;
    for (const h of crouch ? [0.35, 0.8] : [0.45, 1.25]) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, o = new V(x + Math.cos(a) * 0.45, y + h, z + Math.sin(a) * 0.45), c = new V(x, y + h, z); if (!los(c, o) || !los(o, c)) return false; }
    return los(new V(x, y + 0.4, z), new V(x, y + (crouch ? 1.12 : 1.85), z));
  };
  S.near = (x, y, z, room, maxR = 1.5, crouch = false) => {
    for (let r = 0; r <= maxR; r += 0.25) { const n = r === 0 ? 1 : Math.max(8, Math.round(2 * Math.PI * r / 0.25)); for (let k = 0; k < n; k++) { const a = k * 2 * Math.PI / n, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; const rm = S.interior(px, pz); if (!rm || (room && rm !== room)) continue; if (!S.floors(px, pz).some((fy) => Math.abs(fy - y) < 0.05)) continue; if (S.free(px, y, pz, crouch)) return [px, y, pz]; } }
    return null;
  };
  // the open edges of every upper deck (a floor ≥ 1 m above its room's main floor), one sample every 2 m
  S.edges = () => {
    const out = [];
    for (const r of g.level.rooms) {
      const main = r.floor ?? r.y0 ?? 0, b = r.bounds;
      const ups = (r.floors ?? []).filter((f) => f.y >= main + 1);
      for (const f of ups) {
        const [x0, x1, z0, z1] = f.box;
        const sides = [[[x0, z0], [x1, z0], [0, 0.1]], [[x0, z1], [x1, z1], [0, -0.1]], [[x0, z0], [x0, z1], [0.1, 0]], [[x1, z0], [x1, z1], [-0.1, 0]]];
        for (const [a, c, inn] of sides) {
          const L = Math.hypot(c[0] - a[0], c[1] - a[1]), n = Math.max(1, Math.floor(L / 2));
          for (let i = 0; i <= n; i++) {
            const x = a[0] + (c[0] - a[0]) * i / n + inn[0], z = a[1] + (c[1] - a[1]) * i / n + inn[1];
            if (x < b.min.x + 0.7 || x > b.max.x - 0.7 || z < b.min.z + 0.7 || z > b.max.z - 0.7) continue;   // against a wall
            const o = [x - inn[0] * 4, z - inn[1] * 4];   // just outside the edge: another deck there = not an open edge
            if (ups.some((q) => q !== f && Math.abs(q.y - f.y) < 0.05 && o[0] >= q.box[0] && o[0] <= q.box[1] && o[1] >= q.box[2] && o[1] <= q.box[3])) continue;
            out.push({ id: `${r.id}@${f.y}:${x.toFixed(1)},${z.toFixed(1)}`, p: [x, f.y, z] });
          }
        }
      }
    }
    return out;
  };
  S.stairs = () => { const seen = []; for (const n of g.level.nav) if (n.stair && !seen.some((q) => q.p.distanceTo(n.position) < 1.0)) seen.push({ id: `stair@${n.position.x.toFixed(1)},${n.position.y.toFixed(1)},${n.position.z.toFixed(1)}`, p: n.position.clone() }); return seen.map((q) => ({ id: q.id, p: [q.p.x, q.p.y, q.p.z] })); };
  return true;
});
/** Measure-1 targets: doors, stair nosings, gallery edges, required interactables (within D, LOS, central 60 %). */
const targets5 = (REQ_ = REQUIRED5, EXTRA = []) => ev(([W, H, D, REQ, EXTRA]) => {
  const g = window.__game, S = window.__D5, cam = g.camera, V = cam.position.constructor;
  cam.updateMatrixWorld(); const eye = g.player.eye.clone();
  const proj = (x, y, z) => { const v = new V(x, y, z).project(cam); return { sx: (v.x + 1) / 2 * W, sy: (1 - v.y) / 2 * H, front: v.z < 1 && v.z > -1 }; };
  const out = [], far = [];
  const right = new V().crossVectors(cam.getWorldDirection(new V()), new V(0, 1, 0)).normalize();
  const add = (kind, id, p, rx, y0, y1) => {
    const c = new V(p[0], (y0 + y1) / 2, p[2]), dist = c.distanceTo(eye), s = proj(c.x, c.y, c.z);
    if (!s.front) return;
    const central = s.sx > W * 0.2 && s.sx < W * 0.8 && s.sy > H * 0.2 && s.sy < H * 0.8;
    const to = c.clone().add(eye.clone().sub(c).setLength(kind === 'door' ? 0.3 : 0.12));
    const losOk = g.physics.lineOfSight(eye, to);
    if (!central || !losOk || dist > D) { if (central && dist <= D + 6) far.push({ kind, id, dist: +dist.toFixed(1), los: losOk }); return; }
    const pts = [[-rx, y0], [rx, y0], [-rx, y1], [rx, y1]].map(([dx, y]) => proj(p[0] + right.x * dx, y, p[2] + right.z * dx));
    let x0 = Math.min(...pts.map((q) => q.sx)), x1 = Math.max(...pts.map((q) => q.sx)), yy0 = Math.min(...pts.map((q) => q.sy)), yy1 = Math.max(...pts.map((q) => q.sy));
    if (x1 - x0 < 12) { const m = (x0 + x1) / 2; x0 = m - 6; x1 = m + 6; }
    if (yy1 - yy0 < 12) { const m = (yy0 + yy1) / 2; yy0 = m - 6; yy1 = m + 6; }
    out.push({ kind, id, dist: +dist.toFixed(1), x0: Math.round(x0), y0: Math.round(yy0), x1: Math.round(x1), y1: Math.round(yy1) });
  };
  for (const d of g.level.doors) { const y = d.y ?? 0; add('door', d.id, [d.position.x, y, d.position.z], 1.2, y + 0.2, y + 2.4); }
  for (const id of REQ) { const i = g.interactables.get(id); if (i) add('use', id, [i.position.x, i.position.y, i.position.z], 0.25, i.position.y - 0.25, i.position.y + 0.25); }
  for (const s of S.stairs()) add('stair', s.id, s.p, 0.5, s.p[1] - 0.05, s.p[1] + 0.2);
  for (const e of S.edges()) add('edge', e.id, e.p, 0.3, e.p[1] - 0.05, e.p[1] + 0.25);
  for (const x of EXTRA) add(x.kind, x.id, x.p, x.rx ?? 0.3, x.p[1] - (x.dy0 ?? 0.05), x.p[1] + (x.dy1 ?? 0.25));
  return { out, far };
}, [W, H, T.targetDist, REQ_, EXTRA]);
/** lights_out5 + dark5_on (§2.7.3, §4.7 L), HUD hidden; the 1.2 s fade on game time. */
async function dark5() {
  const before = warnings.length;
  await ev(() => { const g = window.__game; g.level.vignette('lights_out5'); g.level.vignette('dark5_on'); g.ui.setHudVisible(false); });
  await page.waitForFunction((t0) => window.__game.time - t0 > 2.2, await ev(() => window.__game.time), { timeout: 20000, polling: 100 }).catch(() => {});
  const unknown = warnings.slice(before).filter((w) => /unknown vignette "(lights_out5|dark5_on)"/.test(w)).map((w) => /"([^"]+)"/.exec(w)[1]);
  const st = await ev(() => {
    const g = window.__game, L = g.render.lights, names = L.groups instanceof Map ? [...L.groups.keys()] : Object.keys(L.groups ?? {});
    const on = (n) => (names.includes(n) ? L.group(n).filter((h) => h.enabled && h.factor > 0.01).length : null);
    return { spine: on('spine5'), sub: on('sub5'), se: on('spine5_emerg'), be: on('sub5_emerg'), dark: Object.keys(g.level.regions ?? {}).includes('dark') ? g.level.regions.dark.length : null };
  });
  return { unknown, ...st };
}
/** Lamp on at full charge / lamp off with an empty cell. */
// (off: the cell recharges while off after a 0.25 s settle — it is emptied again after the fade so the lamp cannot be on)
const lamp = (on) => ev(async (on) => { const p = window.__game.player; if (on) { p.debug.torch?.(1); p.debug.flashlight(true); } else { p.debug.flashlight(false); p.debug.torch?.(0); } const t0 = window.__game.time; while (window.__game.time - t0 < (on ? 0.15 : 1.0)) await new Promise((r) => setTimeout(r, 50)); if (on) p.debug.torch?.(1); else p.debug.torch?.(0); return p.debug.torch?.() ?? null; }, on);
/** Stand at a view, validated against the room data; returns the spawn used (or null). */
async function viewSpot5(q, v) {
  await boot(q, v.spawn);
  await install5();
  const chk = await ev(([v]) => {
    const g = window.__game, S = window.__D5, [x, y, z] = v.spawn;
    const room = S.interior(x, z, 0.3), onFloor = S.floors(x, z).some((fy) => Math.abs(fy - y) < 0.05), free = onFloor && S.free(x, y, z, !!v.crouch);
    if (room === v.room && free) return { ok: true, spawn: v.spawn };
    const alt = S.near(x, y, z, v.room, 1.5, !!v.crouch);
    return { ok: false, room, onFloor, free, alt, rooms: g.level.rooms.map((r) => r.id) };
  }, [v]);
  if (chk.ok) return v.spawn;
  if (!chk.rooms?.includes(v.room)) { bad(`${q}/${v.id}: SKIPPED — room ${v.room} missing (W4 greybox not on this build?)`); return null; }
  if (!chk.alt) { bad(`${q}/${v.id}: the plan's view (${v.spawn}) is not a free spot inside ${v.room}'s interior (room ${chk.room}, floor ${chk.onFloor}, free ${chk.free}) and no free spot within 1.5 m — layout vs plan`); return null; }
  const sp = [...chk.alt.map((n) => +n.toFixed(2)), v.spawn[3], v.spawn[4] ?? 0];
  console.log(`  note ${q}/${v.id}: the plan's view (${v.spawn.slice(0, 3)}) is not free inside ${v.room} (room ${chk.room}, floor ${chk.onFloor}, free ${chk.free}) — moved to (${sp.slice(0, 3)})`);
  await boot(q, sp); await install5();
  return sp;
}
const judge5 = (m, tg) => {
  const tPass = tg.map((t, i) => ({ ...t, p95: m.targets[i]?.p95 ?? 0, pass: (m.targets[i]?.p95 ?? 0) >= T5.target }));
  return { frame: m.frame >= T5.frame, ring: m.ringFrac >= T5.ringFrac, glow: m.passDark.glow, far: m.passDark.far, targets: tPass, ok: m.frame >= T5.frame && m.ringFrac >= T5.ringFrac && m.passDark.glow && m.passDark.far && tPass.every((t) => t.pass) };
};
async function runLevel5() {
  for (const q of QUALITIES) {
    console.log(`\n══════════ level 5 — quality ${q.toUpperCase()} ══════════`);
    await boot(q, null);
    const info = await levelInfo();
    check(info.quality === q, `quality ${info.quality} (asked ${q})`);
    await install5();
    const d0 = await dark5();
    for (const u of d0.unknown) bad(`vignette ${u} is not defined by the level (D2a / D3) — "[level] unknown vignette"`);
    if (d0.se === null || d0.be === null) bad(`emergency groups missing: spine5_emerg ${d0.se === null ? 'missing' : d0.se}, sub5_emerg ${d0.be === null ? 'missing' : d0.be} (§2.7.1)`);
    if (d0.spine || d0.sub) bad(`after lights_out5 the mains are still lit: spine5 ${d0.spine}, sub5 ${d0.sub} (the check would measure lights-on)`);
    if (d0.dark === null) bad('regions.dark missing (W4, §2.7.3)');
    // ── views: LIGHT and NO-LIGHT
    for (const v of views5) {
      const sp = await viewSpot5(q, v); if (!sp) continue;
      await dark5();
      if (v.crouch) { await ev(() => window.__game.player.debug.crouch(true)); await page.waitForFunction(() => window.__game.player.debug.state().crouched, null, { timeout: 4000, polling: 100 }).catch(() => bad(`${q}/${v.id}: could not crouch`)); }
      const cell = await lamp(true);
      if (cell && !(cell.on && cell.charge > 0.97)) bad(`${q}/${v.id}: the lamp is not on at full charge (${JSON.stringify(cell)})`);
      const tgL = await targetsInView();
      const m = await measure(await page.screenshot({ path: `${OUT}/${q}-${v.id}-light.png` }), 'png', tgL.out);
      const lineL = `${q}/${v.id} LIGHT: ${verdict(m)}`;
      if (Object.values(m.pass).every(Boolean)) ok(lineL); else for (const [k, p] of Object.entries(m.pass)) if (!p) bad(`${q}/${v.id} LIGHT: ${k.toUpperCase()} below threshold — ${verdict(m)}`);
      for (const t of m.targets) (t.pass ? ok : bad)(`${q}/${v.id} LIGHT: ${t.kind} ${t.id} at ${t.dist} m: p95 ${f3(t.p95)} (≥ ${T.target})`);
      const cellD = await lamp(false);
      if (cellD && (cellD.on || cellD.charge > 0.05)) bad(`${q}/${v.id}: the lamp is not off with an empty cell (${JSON.stringify(cellD)})`);
      const tg = await targets5();
      const md = await measure(await page.screenshot({ path: `${OUT}/${q}-${v.id}-nolight.png` }), 'png', tg.out);
      const j = judge5(md, tg.out);
      const lineD = `${q}/${v.id} NO-LIGHT: frame ${f3(md.frame)} (≥ ${T5.frame}) · ring lit ${(md.ringFrac * 100).toFixed(1)} % (≥ ${T5.ringFrac * 100} %) · glow ${(md.glowFrac * 100).toFixed(2)} % (≥ ${T.glowFrac * 100} %) · ${j.targets.length} targets`;
      if (j.ok) ok(lineD);
      else bad(`${lineD} — ${[!j.frame && 'FRAME', !j.ring && 'STRIPS', !j.glow && 'GLOW', !j.far && 'FAR'].filter(Boolean).join(', ') || 'targets'} (followable without the lamp? strips / emergency pools — D2a / D3)`);
      for (const t of j.targets) (t.pass ? ok : bad)(`${q}/${v.id} NO-LIGHT: ${t.kind} ${t.id} at ${t.dist} m: p95 ${f3(t.p95)} (≥ ${T5.target})`);
      if (tg.far.length) console.log(`  (not judged: ${tg.far.slice(0, 12).map((t) => `${t.kind} ${t.id} ${t.dist} m${t.los ? '' : ' no LOS'}`).join(', ')}${tg.far.length > 12 ? ' …' : ''})`);
      report.runs.push({ level: 5, quality: q, view: v.id, spawn: sp, light: m, noLight: md, judged: j });
    }
    if (!want) { await glow5(q); await darkRun5(q); }
  }
}
/** [glow] each enemy type's dark-room mark at 10 / 20 / 30 m, lamp off. */
async function glow5(q) {
  console.log(`── ${q}: enemy dark-room marks (soldier red, never cyan)`);
  // places from the room data: the sub bay — a clear 30 m lane along −z from its north end; the crawl — along −x
  await boot(q, null, { enemies: true }); await install5();
  const places = await ev(() => {
    const g = window.__game, S = window.__D5, V = g.player.position.constructor, los = (a, b) => g.physics.lineOfSight(a, b), out = [];
    const sub = g.level.rooms.find((r) => r.id === 'sub5');
    if (sub) {
      const b = sub.bounds, z0 = b.max.z - 2.5, y = sub.floor ?? 0;
      for (let x = b.min.x + 1.5; x <= b.max.x - 1.5; x += 1) {
        if (!S.free(x, y, z0, false)) continue;
        const okAll = [10, 20, 30].every((dd) => z0 - dd > b.min.z + 0.6 && los(new V(x, y + 1.65, z0), new V(x, y + 1.0, z0 - dd)));
        if (okAll) { out.push({ id: 'sub_bay', eye: [x, y, z0], dir: [0, -1], yaw: 0, crouch: false, room: 'sub5' }); break; }
      }
      if (!out.length) out.push({ id: 'sub_bay', err: 'no clear 30 m lane along −z in sub5 from its north end' });
    } else out.push({ id: 'sub_bay', err: 'room sub5 missing' });
    const sp = g.level.rooms.find((r) => r.id === 'spine5');
    const crawl = (sp?.floors ?? []).filter((f) => f.nav === false).sort((a, c) => (c.box[1] - c.box[0]) - (a.box[1] - a.box[0]))[0];
    if (crawl) { const z = (crawl.box[2] + crawl.box[3]) / 2; out.push({ id: 'crawl', eye: [crawl.box[1] - 0.6, crawl.y, z], dir: [-1, 0], yaw: 90, crouch: true, room: 'spine5', len: crawl.box[1] - crawl.box[0] - 1.2 }); }
    else out.push({ id: 'crawl', err: 'no nav:false floor (the crawl) in spine5.floors' });
    return out;
  });
  const real = await ev(() => typeof window.__game.enemies.debug?.soldiers === 'function');
  if (!real) bad(`${q}: the soldier is K's placeholder (a husk) — enemies.debug.soldiers missing (W3b): his mark hue is not judged`);
  for (const pl of places) {
    if (pl.err) { bad(`${q}/glow ${pl.id}: SKIPPED — ${pl.err}`); continue; }
    for (const dd of [10, 20, 30]) {
      if (pl.len !== undefined && dd > pl.len) { console.log(`  (${pl.id} ${dd} m: beyond its ${pl.len.toFixed(1)} m length — not judged)`); continue; }
      const types = pl.crouch ? [['soldier'], ['husk'], ['skitter']] : [['soldier', 'husk', 'skitter']];
      for (const set of types) {
        await boot(q, [...pl.eye, pl.yaw, 0], { enemies: true }); await install5(); await dark5();
        if (pl.crouch) { await ev(() => window.__game.player.debug.crouch(true)); await page.waitForFunction(() => window.__game.player.debug.state().crouched, null, { timeout: 4000, polling: 100 }).catch(() => {}); }
        await lamp(false);
        const base = await page.screenshot();
        const spawned = await ev(([pl, dd, set, real]) => {
          const g = window.__game, S = window.__D5, V = g.player.position.constructor, out = [];
          const lat = pl.dir[0] === 0 ? [1, 0] : [0, 1];
          set.forEach((type, i) => {
            const off = set.length === 1 ? 0 : (i - 1) * 1.8;
            const x = pl.eye[0] + pl.dir[0] * dd + lat[0] * off, z = pl.eye[2] + pl.dir[1] * dd + lat[1] * off;
            const p = S.near(x, pl.eye[1], z, pl.room, 1.2, pl.crouch) ?? [x, pl.eye[1], z];
            const yaw = Math.atan2(pl.eye[0] - p[0], pl.eye[2] - p[2]);
            const e = type === 'soldier' && real && g.enemies.spawnPose ? g.enemies.spawnPose(type, new V(...p), yaw, 'test_glow', 'hold') : g.enemies.spawn(type, new V(...p), yaw, 'test_glow');
            out.push({ type, id: e.id, p });
          });
          return out;
        }, [pl, dd, set, real]);
        // frames over 2.2 s of game time (the soldier's mark blinks 1 Hz, 0.12 s on): the best frame per enemy
        const best = Object.fromEntries(spawned.map((s) => [s.id, { n: 0, rgb: null, cyan: false }]));
        const t0 = await ev(() => window.__game.time);
        for (let i = 0; i < 30; i++) {
          const rects = await ev(([ids, W, H]) => {
            const g = window.__game, cam = g.camera, V = cam.position.constructor;
            cam.updateMatrixWorld();
            return ids.map((id) => {
              const e = g.enemies.all.find((x) => x.id === id); if (!e || !e.alive) return { id, gone: true };
              const p = e.position, h = e.type === 'skitter' ? 0.7 : 1.95, r = e.type === 'skitter' ? 0.6 : 0.5;
              const pts = []; for (const dx of [-r, r]) for (const dz of [-r, r]) for (const y of [p.y, p.y + h]) { const v = new V(p.x + dx, y, p.z + dz).project(cam); pts.push([(v.x + 1) / 2 * W, (1 - v.y) / 2 * H, v.z]); }
              if (pts.some((q2) => q2[2] > 1 || q2[2] < -1)) return { id, behind: true };
              const vis = g.physics.lineOfSight(g.player.eye, new V(p.x, p.y + h * 0.7, p.z));
              return { id, vis, x0: Math.max(0, Math.min(...pts.map((q2) => q2[0])) - 4), x1: Math.min(W, Math.max(...pts.map((q2) => q2[0])) + 4), y0: Math.max(0, Math.min(...pts.map((q2) => q2[1])) - 4), y1: Math.min(H, Math.max(...pts.map((q2) => q2[1])) + 4) };
            });
          }, [spawned.map((s) => s.id), W, H]);
          const png = await page.screenshot();
          const st = await markStats(png, base, rects);
          for (const r of st) { const b = best[r.id]; if (!b) continue; if (r.n > b.n) { b.n = r.n; b.rgb = r.rgb; b.vis = r.vis; } if (r.n >= T5.markPx && r.rgb && r.rgb[1] > r.rgb[0] && r.rgb[2] > r.rgb[0]) b.cyan = true; }
          const el = await ev((t0) => window.__game.time - t0, t0);
          if (el > 2.2) break;
        }
        await page.screenshot({ path: `${OUT}/${q}-glow-${pl.id}-${dd}m-${set.join('_')}.png` });
        for (const s of spawned) {
          const b = best[s.id], tag = `${q}/glow ${pl.id} ${s.type} at ${dd} m`;
          check(b.n >= T5.markPx, `${tag}: mark ${b.n} px of luma ≥ ${T5.markLuma} over the frame without it (≥ ${T5.markPx})${b.vis === false ? ' — no line of sight to it (placement)' : ''}`);
          if (s.type === 'soldier' && real && b.rgb) {
            check(b.rgb[0] >= 1.5 * b.rgb[1] && b.rgb[0] >= 1.5 * b.rgb[2], `${tag}: red (mean rgb of the mark ${b.rgb.map((c) => c.toFixed(2))})`);
            check(!b.cyan, `${tag}: never cyan`);
          }
          report.runs.push({ level: 5, quality: q, glow: pl.id, type: s.type, dist: dd, mark: b });
        }
      }
    }
  }
}
/** Bright pixels added in each rect over the base frame (luma ≥ T5.markLuma now, < it in the base), mean rgb. */
async function markStats(png, base, rects) {
  return ev(async ([a, b, rects, W, H, LU]) => {
    const dec = async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' })); const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return x.getImageData(0, 0, bmp.width, bmp.height).data; };
    const A = await dec(a), B = await dec(b);
    const Y = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    return rects.map((r) => {
      if (r.gone || r.behind) return { id: r.id, n: 0 };
      let n = 0; const s = [0, 0, 0];
      for (let y = Math.floor(r.y0); y < Math.ceil(r.y1); y++) for (let x = Math.floor(r.x0); x < Math.ceil(r.x1); x++) {
        const i = (y * W + x) * 4; if (i < 0 || i >= A.length) continue;
        if (Y(A, i) >= LU && Y(B, i) < LU) { n++; s[0] += A[i] / 255; s[1] += A[i + 1] / 255; s[2] += A[i + 2] / 255; }
      }
      return { id: r.id, n, vis: r.vis, rgb: n ? s.map((v) => v / n) : null };
    });
  }, [png.toString('base64'), base.toString('base64'), rects, W, H, T5.markLuma]);
}
/** [run] the main route after V on the nav graph, every 2 m, lamp off; > 4 consecutive failing samples fail. */
async function darkRun5(q) {
  console.log(`── ${q}: the dark run (spine → d5_bay → bridge → west gallery → wheel → d5_tunnel, lamp off, every ${T5.step} m)`);
  await boot(q, null); await install5(); await dark5();
  const path = await ev((step) => {
    const g = window.__game, V = g.player.position.constructor, nav = g.level.nav;
    if (!nav?.length) return { err: 'no nav graph' };
    const door = (id) => g.level.doors.find((d) => d.id === id);
    const trig = (id) => (g.__triggers ?? []).find((t) => t.id === id);
    const sub = g.level.rooms.find((r) => r.id === 'sub5');
    const westGal = (sub?.floors ?? []).filter((f) => f.y > 1).sort((a, b) => (a.box[0] + a.box[1]) - (b.box[0] + b.box[1]))[0];
    const wheel = g.interactables.get('wheel5');
    const pts = [];
    const need = [];
    const dk = door('d5_key'); if (dk) pts.push(['spine at d5_key', new V(dk.position.x + 1.2, 0, dk.position.z)]); else need.push('door d5_key');
    const db = door('d5_bay'); if (db) pts.push(['d5_bay', new V(db.position.x, 0, db.position.z - 1.0)]); else need.push('door d5_bay');
    const tb = trig('t5_bridge'); if (tb) pts.push(['bridge', new V((tb.x0 + tb.x1) / 2, 4.8, (tb.z0 + tb.z1) / 2)]); else need.push('trigger t5_bridge');
    if (westGal) pts.push(['west gallery', new V((westGal.box[0] + westGal.box[1]) / 2, westGal.y, (westGal.box[2] + westGal.box[3]) / 2)]); else need.push('sub5 upper floors');
    if (wheel) pts.push(['wheel5', wheel.position.clone()]); else need.push('wheel5');
    const dt = door('d5_tunnel'); if (dt) pts.push(['d5_tunnel', new V(dt.position.x + 1.0, 0, dt.position.z)]); else need.push('door d5_tunnel');
    if (need.length) return { err: `missing ${need.join(', ')}` };
    const nearest = (p) => { let best = -1, bd = 1e9; for (let i = 0; i < nav.length; i++) { const n = nav[i].position, d = Math.hypot(n.x - p.x, n.z - p.z) + Math.abs(n.y - p.y) * 4; if (d < bd) { bd = d; best = i; } } return best; };
    const idx = new Map(nav.map((n, i) => [n.id, i]));
    const dij = (a, b) => {
      const dist = new Float64Array(nav.length).fill(Infinity), prev = new Int32Array(nav.length).fill(-1), done = new Uint8Array(nav.length);
      dist[a] = 0;
      for (;;) {
        let u = -1, du = Infinity; for (let i = 0; i < nav.length; i++) if (!done[i] && dist[i] < du) { du = dist[i]; u = i; }
        if (u < 0 || u === b) break; done[u] = 1;
        for (const l of nav[u].links) { const v = idx.get(l); if (v === undefined || done[v]) continue; const w = nav[u].position.distanceTo(nav[v].position); if (du + w < dist[v]) { dist[v] = du + w; prev[v] = u; } }
      }
      if (!Number.isFinite(dist[b])) return null;
      const out = []; for (let v = b; v >= 0; v = prev[v]) out.unshift(v); return out;
    };
    let poly = [];
    for (let i = 1; i < pts.length; i++) {
      const seg = dij(nearest(pts[i - 1][1]), nearest(pts[i][1]));
      if (!seg) return { err: `no nav path ${pts[i - 1][0]} → ${pts[i][0]}` };
      poly = poly.concat(seg.map((k) => nav[k].position.clone()));
    }
    // resample every `step` m along the polyline
    const out = []; let carry = 0;
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1], b = poly[i], L = a.distanceTo(b); if (L < 1e-6) continue;
      for (let s = carry; s < L; s += step) { const p = a.clone().lerp(b, s / L); const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z)) * 180 / Math.PI; out.push([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +yaw.toFixed(1)]); }
      carry = (carry - L) % step; if (carry < 0) carry += step;
    }
    return { samples: out, legs: pts.map((p) => p[0]) };
  }, T5.step);
  if (path.err) { bad(`${q}/dark run: SKIPPED — ${path.err} (W4 greybox / nav)`); return; }
  let run = 0, worst = 0, fails = 0;
  const res = [];
  for (const [i, s] of path.samples.entries()) {
    await ev((s) => { const g = window.__game; g.player.teleport(new (g.player.position.constructor)(s[0], s[1], s[2]), s[3] * Math.PI / 180, -8 * Math.PI / 180); }, s);
    await lamp(false);
    const tg = await targets5();
    const md = await measure(await page.screenshot({ path: `${OUT}/${q}-run-${String(i).padStart(3, '0')}.png` }), 'png', tg.out);
    const j = judge5(md, tg.out);
    res.push({ s, ok: j.ok, frame: md.frame, ring: md.ringFrac, bad: j.targets.filter((t) => !t.pass).map((t) => t.id) });
    if (j.ok) run = 0; else { run++; fails++; worst = Math.max(worst, run); }
  }
  report.runs.push({ level: 5, quality: q, darkRun: res });
  const failing = res.map((r, i) => (r.ok ? null : `${i}@(${r.s.slice(0, 3)}) f${f3(r.frame)} r${(r.ring * 100).toFixed(1)}%${r.bad.length ? ' ' + r.bad.slice(0, 3).join('/') : ''}`)).filter(Boolean);
  check(worst <= T5.runFails, `${q}/dark run: ${path.samples.length} samples over ${path.legs.join(' → ')}; ${fails} failing, longest run ${worst} (≤ ${T5.runFails} = ≤ 8 m)${failing.length ? ' — ' + failing.slice(0, 10).join(', ') : ''}`);
}

// ───────────────────────────────────────────────────────────── level 6 (stage 3d §10.4, D19, §2.7.3)
// LEVEL 6 (`--level 6`): `?level=6&nostory=1&noenemies=1&autostart=1&quality=low|medium`, the vignettes each view needs
//   (`tun6_far_out`, `v6_shaft_lights:snap`, `lights_out6:snap`; nostory = no loader, so pool6 is judged with 0 floods),
//   level 5's LIGHT / NO-LIGHT judgments (measure 1: frame ≥ 0.025, strips ≥ 3 %, glow / far, and p95 ≥ 0.10 on every
//   door, stair nosing, gallery edge, the coaming top (the `deep` region's rim, D12: dock + 0.8), the cage (region
//   `cage`) and every required interactable within 10 m in sight in the central 60 %).
//   [views] §10.4: tun6_a, tun6_b ×2, the trench ×2 (crouched), the shaft L2, pool6 ×6 — inside rooms (roomAt + 0.3 m).
//   [glow]  (enemies on) the loader's marks (g6_loader spawned, lamp off, in the dark chamber) and a soldier standing in
//           a live flood's beam (`boss.floodLit`) at 10 / 20 / 30 m: ≥ 3 px of luma ≥ 0.5 added, the soldier red.
//   [run]   the dark runs, lamp off, every 2 m, ≤ 4 consecutive failures: tun6_b north → south; the shaft L0 → the
//           bottom; pool6 east gallery → ST6_NE → mid deck → the cage → ST6_M2 → the dock → the wet dock → the window walk.
//   A level without level-6 data (K's stub: no pool6) is SKIPPED with a note (exit unaffected) unless `--strict6`.
const VIEWS6 = [
  { id: 'tun6_a', spawn: [0, 0, -50, 0], room: 'tun6_a', prep: ['tun6_far_out'] },
  { id: 'tun6_b_n', spawn: [12, 0, -100, 0], room: 'tun6_b', prep: [] },
  { id: 'tun6_b_s', spawn: [12, 0, -140, 0], room: 'tun6_b', prep: [] },
  { id: 'trench_a', spawn: [-12.4, -1.4, -165, 0], room: 'vault6', crouch: true, prep: [] },
  { id: 'trench_b', spawn: [-4, -1.4, -178.8, -90], room: 'vault6', crouch: true, prep: [] },
  { id: 'shaft_l2', spawn: [-24.0, -6, -169.5, 0], room: 'shaft6', prep: ['v6_shaft_lights:snap'] },
  { id: 'pool_gal_e', spawn: [-30, -12, -166, 90], room: 'pool6', prep: ['lights_out6:snap'] },
  { id: 'pool_cage', spawn: [-52, -16, -167, 0], room: 'pool6', prep: ['lights_out6:snap'] },
  { id: 'pool_dock_w', spawn: [-70, -20, -178, -90], room: 'pool6', prep: ['lights_out6:snap'] },
  { id: 'pool_wet', spawn: [-52, -20.8, -186, 0], room: 'pool6', prep: ['lights_out6:snap'] },
  { id: 'pool_under', spawn: [-52, -20, -158, 0], room: 'pool6', prep: ['lights_out6:snap'] },
  { id: 'pool_mid', spawn: [-44, -16, -161, 0], room: 'pool6', prep: ['lights_out6:snap'] },
];
const REQUIRED6 = ['he6_switch', 'vault6_lock', 'vault6_loom', 'shaft6_lock', 'frame6_pin', 'frame6_pump', 'frame6_lever', 'console6', 'hatch6_vault', 'hatch6_he'];
const RUNS6 = [
  { id: 'tun6_b', prep: [], pts: [['tun6_b north', [12, 0, -93]], ['tun6_b south', [12, 0, -159]]] },
  { id: 'shaft', prep: ['v6_shaft_lights:snap'], pts: [['L0', [-24.5, 0, -170]], ['the bottom', [-25, -12, -166]]] },
  { id: 'pool', prep: ['lights_out6:snap'], pts: [['east gallery', [-30, -12, -166]], ['mid deck', [-44, -16, -161]], ['the cage', [-52, -16, -167]], ['the dock', [-70, -20, -178]], ['the wet dock', [-52, -20.8, -186]], ['the window walk', [-52, -20.8, -193]]] },
];
const views6 = VIEWS6.filter((v) => !want || want.has(v.id));
/** The coaming top (the `deep` region's rim at dock + 0.8 = −19.2, D12) every 2 m, and the cage's centre. */
const extras6 = () => ev(() => {
  const g = window.__game, out = [];
  for (const b of g.level.regions?.deep ?? []) {
    const y = -19.2;
    for (let x = b.min.x; x <= b.max.x + 1e-6; x += 2) for (const z of [b.min.z, b.max.z]) out.push({ kind: 'coaming', id: `coaming@${x.toFixed(0)},${z.toFixed(0)}`, p: [x, y, z] });
    for (let z = b.min.z; z <= b.max.z + 1e-6; z += 2) for (const x of [b.min.x, b.max.x]) out.push({ kind: 'coaming', id: `coaming@${x.toFixed(0)},${z.toFixed(0)}`, p: [x, y, z] });
  }
  for (const b of g.level.regions?.cage ?? []) out.push({ kind: 'cage', id: 'cage', p: [(b.min.x + b.max.x) / 2, b.min.y + 1.0, (b.min.z + b.max.z) / 2], rx: 1.0, dy0: 0.8, dy1: 0.8 });
  return out;
});
async function prep6(list) {
  const before = warnings.length;
  await ev((list) => { const g = window.__game; for (const id of list) g.level.vignette(id); g.ui.setHudVisible(false); }, list);
  await page.waitForFunction((t0) => window.__game.time - t0 > 2.2, await ev(() => window.__game.time), { timeout: 20000, polling: 100 }).catch(() => {});
  return warnings.slice(before).filter((w) => /unknown vignette|has no snap/.test(w));
}
async function runLevel6() {
  const info0 = await (async () => { await boot(QUALITIES[0], null); return levelInfo(); })();
  if (!info0.rooms.includes('pool6')) {
    const m = `level 6 has no greybox on this build (rooms: ${info0.rooms.join(', ')}) — level-6 views SKIPPED (W4a)`;
    if (args.strict6) bad(m); else console.log(`  SKIP ${m}`);
    return;
  }
  for (const q of QUALITIES) {
    console.log(`\n══════════ level 6 — quality ${q.toUpperCase()} ══════════`);
    await boot(q, null);
    const info = await levelInfo();
    check(info.quality === q, `quality ${info.quality} (asked ${q})`);
    for (const gname of ['tun6_b', 'shaft6_emerg', 'pool6']) if (!info.groups.includes(gname)) bad(`light group ${gname} missing (§2.7.1)`);
    for (const v of views6) {
      if (!info.rooms.includes(v.room)) { bad(`${q}/${v.id}: SKIPPED — room ${v.room} missing`); continue; }
      const sp = await viewSpot5(q, v); if (!sp) continue;
      const unk = await prep6(v.prep);
      for (const u of unk) bad(`${q}/${v.id}: ${u.slice(0, 100)} (the level's vignette — D1 / D3a / D3b)`);
      if (v.crouch) { await ev(() => window.__game.player.debug.crouch(true)); await page.waitForFunction(() => window.__game.player.debug.state().crouched, null, { timeout: 4000, polling: 100 }).catch(() => bad(`${q}/${v.id}: could not crouch`)); }
      const cell = await lamp(true);
      if (cell && !(cell.on && cell.charge > 0.97)) bad(`${q}/${v.id}: the lamp is not on at full charge (${JSON.stringify(cell)})`);
      const tgL = await targetsInView();
      const m = await measure(await page.screenshot({ path: `${OUT}/${q}-${v.id}-light.png` }), 'png', tgL.out);
      if (Object.values(m.pass).every(Boolean)) ok(`${q}/${v.id} LIGHT: ${verdict(m)}`); else for (const [k, p] of Object.entries(m.pass)) if (!p) bad(`${q}/${v.id} LIGHT: ${k.toUpperCase()} below threshold — ${verdict(m)}`);
      for (const t of m.targets) (t.pass ? ok : bad)(`${q}/${v.id} LIGHT: ${t.kind} ${t.id} at ${t.dist} m: p95 ${f3(t.p95)} (≥ ${T.target})`);
      const cellD = await lamp(false);
      if (cellD && (cellD.on || cellD.charge > 0.05)) bad(`${q}/${v.id}: the lamp is not off with an empty cell (${JSON.stringify(cellD)})`);
      const tg = await targets5(REQUIRED6, await extras6());
      const md = await measure(await page.screenshot({ path: `${OUT}/${q}-${v.id}-nolight.png` }), 'png', tg.out);
      const j = judge5(md, tg.out);
      const lineD = `${q}/${v.id} NO-LIGHT: frame ${f3(md.frame)} (≥ ${T5.frame}) · ring lit ${(md.ringFrac * 100).toFixed(1)} % (≥ ${T5.ringFrac * 100} %) · glow ${(md.glowFrac * 100).toFixed(2)} % (≥ ${T.glowFrac * 100} %) · ${j.targets.length} targets`;
      if (j.ok) ok(lineD);
      else bad(`${lineD} — ${[!j.frame && 'FRAME', !j.ring && 'STRIPS', !j.glow && 'GLOW', !j.far && 'FAR'].filter(Boolean).join(', ') || 'targets'} (strips / emergency pools — D1 / D2 / D3a / D3b)`);
      for (const t of j.targets) (t.pass ? ok : bad)(`${q}/${v.id} NO-LIGHT: ${t.kind} ${t.id} at ${t.dist} m: p95 ${f3(t.p95)} (≥ ${T5.target})`);
      if (tg.far.length) console.log(`  (not judged: ${tg.far.slice(0, 12).map((t) => `${t.kind} ${t.id} ${t.dist} m${t.los ? '' : ' no LOS'}`).join(', ')}${tg.far.length > 12 ? ' …' : ''})`);
      report.runs.push({ level: 6, quality: q, view: v.id, spawn: sp, light: m, noLight: md, judged: j });
    }
    if (!want) { await glow6(q); for (const r of RUNS6) await darkRun6(q, r); }
  }
}
/** [glow] the loader's marks and a flood-lit soldier in the dark chamber, lamp off. */
async function glow6(q) {
  console.log(`── ${q}: the loader's marks and a flood-lit soldier (pool6 after lights_out6, lamp off)`);
  const v = VIEWS6.find((x) => x.id === 'pool_gal_e');
  await boot(q, v.spawn, { enemies: true }); await install5(); await prep6(v.prep); await lamp(false);
  const has = await ev(() => window.__game.level.enemySpawns.some((e) => e.group === 'g6_loader'));
  if (!has) { bad(`${q}/glow: group g6_loader not in the level's spawns (W4a) — the loader's marks not judged`); return; }
  const base0 = await page.screenshot();
  await ev(() => window.__game.enemies.spawnGroup('g6_loader'));
  await page.waitForFunction((t0) => window.__game.time - t0 > 2.5, await ev(() => window.__game.time), { timeout: 20000, polling: 100 }).catch(() => {});
  // (the loader's screen extent is not exposed: the whole frame is compared — its floods count too; see "still weak")
  const rect = await ev(([W, H]) => { const g = window.__game, e = g.enemies.all.find((x) => x.type === 'loader' && x.alive); return e ? { id: e.id, dist: +e.position.distanceTo(g.player.eye).toFixed(1), x0: 0, x1: W, y0: 0, y1: H } : null; }, [W, H]);
  if (!rect) { bad(`${q}/glow: spawnGroup('g6_loader') made no loader`); return; }
  const png = await page.screenshot({ path: `${OUT}/${q}-glow-loader.png` });
  const [st] = await markStats(png, base0, [rect]);
  check(st.n >= T5.markPx, `${q}/glow the loader (${rect.dist} m): marks add ${st.n} px of luma ≥ ${T5.markLuma} (≥ ${T5.markPx})`);
  // a soldier in a live flood's beam at 10 / 20 / 30 m: wake the loader, find lit points on the decks
  await ev(() => { try { window.__game.enemies.boss('g6_loader')?.wake(); } catch { /* */ } });
  await page.waitForFunction((t0) => window.__game.time - t0 > 2.0, await ev(() => window.__game.time), { timeout: 20000, polling: 100 }).catch(() => {});
  for (const dd of [10, 20, 30]) {
    const spot = await ev((dd) => {
      const g = window.__game, S = window.__D5, V = g.player.position.constructor, B = g.enemies.boss?.('g6_loader'), eye = g.player.eye;
      if (!B) return { err: 'enemies.boss("g6_loader") is null' };
      for (let a = 0; a < 64; a++) {
        const ang = a / 64 * Math.PI * 2, x = eye.x + Math.cos(ang) * dd, z = eye.z + Math.sin(ang) * dd;
        for (const y of S.floors(x, z)) { const p = new V(x, y, z); if (S.interior(x, z) === 'pool6' && S.free(x, y, z, false) && B.floodLit(p) && g.physics.lineOfSight(eye, new V(x, y + 1.3, z))) return { p: [x, y, z] }; }
      }
      return { err: `no flood-lit free point ${dd} m from the eye with a line of sight` };
    }, dd);
    if (spot.err) { bad(`${q}/glow flood-lit soldier at ${dd} m: SKIPPED — ${spot.err}`); continue; }
    const b2 = await page.screenshot();
    const sp = await ev(([p]) => { const g = window.__game, V = g.player.position.constructor; const e = g.enemies.spawnPose ? g.enemies.spawnPose('soldier', new V(...p), 0, 'test_glow', 'hold') : g.enemies.spawn('soldier', new V(...p), 0, 'test_glow'); return e.id; }, [spot.p]);
    let best = { n: 0, rgb: null };
    for (let i = 0; i < 24; i++) {
      const r = await ev(([id, W, H]) => { const g = window.__game, cam = g.camera, V = cam.position.constructor, e = g.enemies.all.find((x) => x.id === id); if (!e) return null; cam.updateMatrixWorld(); const pts = []; for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) for (const y of [e.position.y, e.position.y + 1.95]) { const v = new V(e.position.x + dx, y, e.position.z + dz).project(cam); pts.push([(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]); } return { id, x0: Math.max(0, Math.min(...pts.map((p) => p[0])) - 4), x1: Math.min(W, Math.max(...pts.map((p) => p[0])) + 4), y0: Math.max(0, Math.min(...pts.map((p) => p[1])) - 4), y1: Math.min(H, Math.max(...pts.map((p) => p[1])) + 4) }; }, [sp, W, H]);
      if (!r) break;
      const [m] = await markStats(await page.screenshot(), b2, [r]);
      if (m.n > best.n) best = m;
      await wait(90);
    }
    check(best.n >= T5.markPx, `${q}/glow flood-lit soldier at ${dd} m: mark ${best.n} px (≥ ${T5.markPx})`);
    if (best.rgb) check(best.rgb[0] >= 1.5 * best.rgb[1] && best.rgb[0] >= 1.5 * best.rgb[2], `${q}/glow flood-lit soldier at ${dd} m: red (${best.rgb.map((c) => c.toFixed(2))})`);
    await ev(() => window.__game.enemies.removeGroup?.('test_glow'));
  }
}
/** [run] a dark run on the nav graph through `r.pts`, every 2 m, lamp off; > 4 consecutive failing samples fail. */
async function darkRun6(q, r) {
  console.log(`── ${q}: the dark run ${r.id} (${r.pts.map((p) => p[0]).join(' → ')}, lamp off, every ${T5.step} m)`);
  await boot(q, null); await install5(); await prep6(r.prep);
  const path = await ev(([pts, step]) => {
    const g = window.__game, V = g.player.position.constructor, nav = g.level.nav;
    if (!nav?.length) return { err: 'no nav graph' };
    const nearest = (p) => { let best = -1, bd = 1e9; for (let i = 0; i < nav.length; i++) { const n = nav[i].position, d = Math.hypot(n.x - p.x, n.z - p.z) + Math.abs(n.y - p.y) * 4; if (d < bd) { bd = d; best = i; } } return best; };
    const idx = new Map(nav.map((n, i) => [n.id, i]));
    const dij = (a, b) => {
      const dist = new Float64Array(nav.length).fill(Infinity), prev = new Int32Array(nav.length).fill(-1), done = new Uint8Array(nav.length);
      dist[a] = 0;
      for (;;) {
        let u = -1, du = Infinity; for (let i = 0; i < nav.length; i++) if (!done[i] && dist[i] < du) { du = dist[i]; u = i; }
        if (u < 0 || u === b) break; done[u] = 1;
        for (const l of nav[u].links) { const v = idx.get(l); if (v === undefined || done[v]) continue; const w = nav[u].position.distanceTo(nav[v].position); if (du + w < dist[v]) { dist[v] = du + w; prev[v] = u; } }
      }
      if (!Number.isFinite(dist[b])) return null;
      const out = []; for (let v = b; v >= 0; v = prev[v]) out.unshift(v); return out;
    };
    let poly = [];
    for (let i = 1; i < pts.length; i++) {
      const seg = dij(nearest(new V(...pts[i - 1][1])), nearest(new V(...pts[i][1])));
      if (!seg) return { err: `no nav path ${pts[i - 1][0]} → ${pts[i][0]}` };
      poly = poly.concat(seg.map((k) => nav[k].position.clone()));
    }
    const out = []; let carry = 0;
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1], b = poly[i], L = a.distanceTo(b); if (L < 1e-6) continue;
      for (let s = carry; s < L; s += step) { const p = a.clone().lerp(b, s / L); const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z)) * 180 / Math.PI; out.push([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +yaw.toFixed(1)]); }
      carry = (carry - L) % step; if (carry < 0) carry += step;
    }
    return { samples: out };
  }, [r.pts, T5.step]);
  if (path.err) { bad(`${q}/dark run ${r.id}: SKIPPED — ${path.err} (W4a greybox / W4b nav)`); return; }
  let run = 0, worst = 0, fails = 0;
  const res = [];
  const ex = await extras6();
  for (const [i, s] of path.samples.entries()) {
    await ev((s) => { const g = window.__game; g.player.teleport(new (g.player.position.constructor)(s[0], s[1], s[2]), s[3] * Math.PI / 180, -8 * Math.PI / 180); }, s);
    await lamp(false);
    const tg = await targets5(REQUIRED6, ex);
    const md = await measure(await page.screenshot({ path: `${OUT}/${q}-run-${r.id}-${String(i).padStart(3, '0')}.png` }), 'png', tg.out);
    const j = judge5(md, tg.out);
    res.push({ s, ok: j.ok, frame: md.frame, ring: md.ringFrac, bad: j.targets.filter((t) => !t.pass).map((t) => t.id) });
    if (j.ok) run = 0; else { run++; fails++; worst = Math.max(worst, run); }
  }
  report.runs.push({ level: 6, quality: q, darkRun: r.id, res });
  const failing = res.map((x, i) => (x.ok ? null : `${i}@(${x.s.slice(0, 3)}) f${f3(x.frame)} r${(x.ring * 100).toFixed(1)}%${x.bad.length ? ' ' + x.bad.slice(0, 3).join('/') : ''}`)).filter(Boolean);
  check(worst <= T5.runFails, `${q}/dark run ${r.id}: ${path.samples.length} samples; ${fails} failing, longest run ${worst} (≤ ${T5.runFails} = ≤ 8 m)${failing.length ? ' — ' + failing.slice(0, 10).join(', ') : ''}`);
}

// ───────────────────────────────────────────────────────────── the views
if (LEVEL === 5) await runLevel5();
else if (LEVEL === 6) await runLevel6();
else for (const q of QUALITIES) {
  console.log(`\n══════════ quality ${q.toUpperCase()} ══════════`);
  await boot(q, null);
  const info = await levelInfo();
  check(info.quality === q, `quality ${info.quality} (asked ${q})`);
  const missingRooms = [...new Set(views.map((v) => v.room).filter((r) => r && !info.rooms.includes(r)))];
  const missingDoors = views.map((v) => v.door).filter((d) => d && !info.doors.includes(d));
  if (missingRooms.length) bad(`level 4 lacks the view rooms ${missingRooms.join(', ')} (greybox W4 not on this build?) — rooms: ${info.rooms.join(', ')}`);
  if (missingDoors.length) bad(`level 4 lacks the doors ${missingDoors.join(', ')}`);
  const lo = await lightsOut();
  if (lo.unknown) bad(`vignette lights_out4 is not defined by the level (D1b's clean.ts) — "[level] unknown vignette"`);
  if (!lo.emerg.length) bad(`no <room>_emerg light groups exist (§2.7 / §8.11): nothing lights the level after lights-out`);
  else console.log(`  emergency groups: ${lo.emerg.map(([n, all, on]) => `${n} ${on}/${all}`).join(', ')}`);
  const still = lo.lit.filter(([n, on]) => on > 0 && /^(gown|shower|corr_|wetlab|pi_office|vivarium|cold|records|scrub|gallery)/.test(n));
  if (lo.ran && still.length) bad(`after lights_out4 these Deck-2 groups are still lit (the check would measure lights-on): ${still.map(([n, on]) => `${n}:${on}`).join(', ')}`);
  check(lo.flash, 'flashlight on');
  for (const v of views) {
    if (v.room && !info.rooms.includes(v.room)) { bad(`${q}/${v.id}: SKIPPED — room ${v.room} missing`); continue; }
    await boot(q, v.spawn);
    const l = await lightsOut();
    if (!l.ran) { bad(`${q}/${v.id}: lights_out4 did not run`); }
    const room = await ev(() => window.__game.level.roomAt(window.__game.player.position)?.id ?? null);
    if (v.room && room !== v.room) bad(`${q}/${v.id}: the view stands in ${room}, the plan says ${v.room}`);
    const tg = await targetsInView();
    // battery: judged at full charge (the cell would be part-drained after the 4.5 s settle)
    const cell = await ev(async () => { const p = window.__game.player; p.debug.torch?.(1); p.debug.flashlight(true); await new Promise((r) => setTimeout(r, 120)); return p.debug.torch?.() ?? null; });
    if (cell && !(cell.on && cell.charge > 0.97 && cell.bright === 1)) bad(`${q}/${v.id}: the lamp is not on at full charge for the frame (${JSON.stringify(cell)})`);
    const png = await page.screenshot({ path: `${OUT}/${q}-${v.id}.png` });
    const m = await measure(png, 'png', tg.out);
    const line = `${q}/${v.id}: ${verdict(m)}`;
    for (const [k, p] of Object.entries(m.pass)) if (!p) bad(`${q}/${v.id}: ${k.toUpperCase()} below threshold — ${verdict(m)}`);
    if (Object.values(m.pass).every(Boolean)) ok(line);
    // mood (reported, not judged — stage 3b integration B7): the same corridor lit reads ≈ 0.55 frame mean; the
    // readable dark frames of the run (gallery, chk by flashlight) sit at 0.14–0.19. A blackout should land there.
    if (m.frame > 0.22) console.log(`  note ${q}/${v.id}: frame mean ${f3(m.frame)} > 0.22 — reads lit rather than blacked out (B7 mood)`);
    for (const t of m.targets) (t.pass ? ok : bad)(`${q}/${v.id}: ${t.kind} ${t.id} at ${t.dist} m: p95 ${f3(t.p95)} (≥ ${T.target})`);
    if (v.door && !m.targets.some((t) => t.id === v.door)) bad(`${q}/${v.id}: the faced door ${v.door} is not a judged target (out of sight / > ${T.targetDist} m / missing)`);
    if (tg.far.length) console.log(`  (not judged: ${tg.far.map((t) => `${t.kind} ${t.id} ${t.dist} m${t.los ? '' : ' no LOS'}`).join(', ')})`);
    // NO LAMP: the same view by the emergency lighting alone
    await ev(() => window.__game.player.debug.flashlight(false));
    await wait(1500);
    const pngD = await page.screenshot({ path: `${OUT}/${q}-${v.id}-nolamp.png` });
    const md = await measure(pngD, 'png', tg.out);
    const lineD = `${q}/${v.id} NO LAMP: glow ${(md.glowFrac * 100).toFixed(2)} % (≥ ${T.glowFrac * 100} %) · frame ${f3(md.frame)} (≥ ${T.darkFrame}) · cone ${f3(md.cone)} · ring lit ${(md.ringFrac * 100).toFixed(1)} %`;
    if (Object.values(md.passDark).every(Boolean)) ok(lineD);
    else bad(`${lineD} — the route is not followable without the flashlight here (coordinator: emergency lighting / strips)`);
    if (md.targets.length) console.log(`  (no lamp, not judged: ${md.targets.map((t) => `${t.kind} ${t.id} p95 ${f3(t.p95)}`).join(', ')})`);
    report.runs.push({ quality: q, view: v.id, spawn: v.spawn, room, lightsOut: l, metric: m, noLamp: md });
  }
  if (missingRooms.length) {
    // pipeline smoke on what exists (the stub): proves the views would be measured; never a pass
    await boot(q, null);
    await lightsOut();
    const png = await page.screenshot({ path: `${OUT}/${q}-spawn-smoke.png` });
    const m = await measure(png, 'png', (await targetsInView()).out);
    console.log(`  smoke (spawn view, not judged): ${verdict(m)}; targets ${m.targets.map((t) => `${t.id} ${f3(t.p95)}`).join(', ') || '—'}`);
    report.runs.push({ quality: q, view: 'spawn-smoke', metric: m });
  }
}

await browser.close();
const jf = args.json ?? `shots/checks/dark-l${LEVEL}.json`;
mkdirSync(dirname(jf), { recursive: true });
writeFileSync(jf, JSON.stringify(report, null, 1));
console.log(`\n  PNGs in ${OUT}/, numbers in ${jf}`);
console.log(problems.length ? `\nCHECK-DARK FAILED (${problems.length}):\n - ${problems.join('\n - ')}` : '\nCHECK-DARK OK');
process.exit(problems.length ? 1 : 0);
