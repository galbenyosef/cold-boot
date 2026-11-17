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
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { launch, parseArgs } from './lib/check-common.mjs';

const args = parseArgs();
const base = (args.url ?? process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const QUALITIES = (args.quality ?? 'low,medium').split(',');
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
const OUT = 'shots/l4/dark';
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

async function boot(q, spawn) {
  const s = spawn ? `&spawn=${spawn.join(',')}` : '';
  for (let i = 0; ; i++) {
    try { await page.goto(`${base}/?level=4&nostory=1&noenemies=1&autostart=1&quality=${q}${s}`); break; } catch (e) { if (i >= 2) throw e; await wait(700); }
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

// ───────────────────────────────────────────────────────────── the views
for (const q of QUALITIES) {
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
const jf = args.json ?? 'shots/checks/dark-l4.json';
mkdirSync(dirname(jf), { recursive: true });
writeFileSync(jf, JSON.stringify(report, null, 1));
console.log(`\n  PNGs in ${OUT}/, numbers in ${jf}`);
console.log(problems.length ? `\nCHECK-DARK FAILED (${problems.length}):\n - ${problems.join('\n - ')}` : '\nCHECK-DARK OK');
process.exit(problems.length ? 1 : 0);
