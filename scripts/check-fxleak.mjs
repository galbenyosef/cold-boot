// check:fxleak (stage 3b §8.6.6, D21, §13 S13) — no fx volume may be seen from a place it was not meant for, and no
// reflection probe may contain one.
//
// Usage: node scripts/check-fxleak.mjs [--url http://127.0.0.1:5173] [--level 3|4|5|all] [--grid 8] [--shots N] [--verbose]
//          [--selftest]  (negative controls: a half-width aperture must trip the gap rule, a bake hiding nothing the probe rule)
//
// Boots `?level=N&nostory=1&noenemies=1&autostart=1` at 320 × 180, every door opened, `fx.debugVolumes(true)` (each
// registered volume drawn in opaque unlit magenta, keeping its own clipping). View points: every room's centre and a
// grid (--grid m) of walkable points in it (eye = floor + 1.65) × 8 yaws × pitch 0 / −20°, plus every door 1 m out on
// both sides facing it, yaw −30 / 0 / +30°. Stage 3c (W6, level 5): every floor of a room is viewed — the `nav: false`
// floors (the crawlway, the magazine) have no nav nodes, so their plan box gets a centre + grid of its own at the
// floor's height — and every view point must stand inside a room interior (`roomAt` + 0.3 m inset from the room box;
// a view in a wall or a void would pass for the wrong reason): points that do not are dropped and counted
// (`skipped`), and a room left with none FAILS (rule `stand`). Each view is rendered through the normal pipeline; when more than 4 magenta
// pixels show, each drawn volume is rendered alone to attribute them. A volume FAILS when, with > 4 of its pixels:
//   (A) S13  — rendered with the room gate off, it shows in a view whose drawn room set contains none of its `rooms`
//              (the gate would hide something visible: its room list is wrong or a portal is missing);
//   (B) room — it shows (gate on, as in the game) from a view point in a room that is neither in its `rooms` nor in
//              its `seenFrom`;
//   (C) gap  — it has `apertures` (a viewport's pane) and pixels of it are seen along rays that cross none of them
//              (the 3a defect: the sea seen through gaps beside its pane).
//   (P) probe — a registered volume is visible while a reflection probe face is rendered: the load-time bake
//              (`render.prepare`, run again here with every volume forced on) and the progressive re-captures.
// Report: shots/checks/fxleak-l<N>.json; PNGs of failing views in shots/checks/fxleak-l<N>/. Exit 1 on any failure.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { parseArgs, levelsOf, launch, bootLevel, writeJson } from './lib/check-common.mjs';

const args = parseArgs();
const base = args.url ?? 'http://127.0.0.1:5173';
const levels = args.level ? levelsOf(args).filter((l) => l >= 3) : [3, 4, 5];
const opts = { grid: Number(args.grid ?? 8), maxPx: 4, shots: Number(args.shots ?? 12), verbose: !!args.verbose, selftest: !!args.selftest };

/** Runs in the page: the whole check for the booted level. */
async function run(o) {
  const g = window.__game;
  const fx = g.fx, level = g.level, player = g.player, render = g.render, THREE_V = g.camera.position.constructor;
  if (!fx.volumes) return { error: 'fx has no volume registry' };
  const vols = fx.volumes();
  const out = { volumes: vols.map((v) => ({ id: v.id, rooms: [...v.rooms], seenFrom: [...v.seenFrom], apertures: v.apertures.length })), views: 0, fails: [], probe: [], notes: [], shots: [] };
  if (!vols.length) out.notes.push('no fx volumes registered on this level');

  const canvas = g.canvas;
  const W = canvas.width, H = canvas.height;
  const c2 = document.createElement('canvas');
  c2.width = W; c2.height = H;
  const c2d = c2.getContext('2d', { willReadFrequently: true });
  const deg = Math.PI / 180;
  const cam = g.camera;

  // ── step + render one frame synchronously, return the canvas pixels
  const frame = () => {
    player.update(0);
    level.update(0);
    fx.update(0);
    render.render(0);
    c2d.drawImage(canvas, 0, 0);
    return c2d.getImageData(0, 0, W, H).data;
  };
  const isMag = (d, i) => { const r = d[i], gg = d[i + 1], b = d[i + 2]; return r > 120 && b > 120 && gg < 0.62 * Math.min(r, b) && Math.abs(r - b) < 0.35 * Math.max(r, b); };
  const magenta = (d) => { const px = []; for (let i = 0; i < d.length; i += 4) if (isMag(d, i)) px.push(i >> 2); return px; };
  // the scene without debug colours may hold magenta-ish things of its own (grow lights): known per view, subtracted
  const solo = (v) => {
    const prev = vols.map((x) => x.object.visible);
    vols.forEach((x) => { if (x !== v) x.object.visible = false; });
    render.render(0);
    c2d.drawImage(canvas, 0, 0);
    const d = c2d.getImageData(0, 0, W, H).data;
    vols.forEach((x, i) => { x.object.visible = prev[i]; });
    return magenta(d);
  };
  const baseline = () => {
    const prev = vols.map((x) => x.object.visible);
    vols.forEach((x) => { x.object.visible = false; });
    render.render(0);
    c2d.drawImage(canvas, 0, 0);
    const d = c2d.getImageData(0, 0, W, H).data;
    vols.forEach((x, i) => { x.object.visible = prev[i]; });
    return new Set(magenta(d));
  };
  // does the eye ray through pixel k cross one of the apertures?
  const ndc = new THREE_V(), dir = new THREE_V(), eye = new THREE_V(), hp = new THREE_V(), up = new THREE_V(), side = new THREE_V();
  const throughAperture = (k, aps) => {
    const x = k % W, y = (k / W) | 0;
    ndc.set(((x + 0.5) / W) * 2 - 1, -(((y + 0.5) / H) * 2 - 1), 0.5).unproject(cam);
    cam.getWorldPosition(eye);
    dir.copy(ndc).sub(eye).normalize();
    for (const a of aps) {
      const den = dir.dot(a.normal);
      if (Math.abs(den) < 1e-6) continue;
      const t = hp.copy(a.center).sub(eye).dot(a.normal) / den;
      if (t <= 0) continue;
      hp.copy(eye).addScaledVector(dir, t).sub(a.center);
      up.copy(a.up ?? { x: 0, y: 1, z: 0 });
      side.crossVectors(up, a.normal).normalize();
      // half a pixel's footprint at the pane + 3 cm (the frame) of slack
      const slack = 0.03 + (t * 2 * Math.tan((cam.fov * deg) / 2)) / H;
      if (Math.abs(hp.dot(side)) <= a.width / 2 + slack && Math.abs(hp.dot(up)) <= a.height / 2 + slack) return true;
    }
    return false;
  };

  // ── doors open (every view sees the most rooms the portal graph can draw)
  // (auto off: nothing closes them again; snap = end of the stroke)
  for (const d of level.doors) { try { d.unlock(); d.auto = false; d.open(); d.snap?.(); } catch { /* sealed prop */ } }

  // ── view points
  const views = [];
  const roomOfPoint = (p) => level.roomAt(p)?.id ?? null;
  // 3c lesson: a view must stand inside a room interior (roomAt + 0.3 m inset); returns the room id or null
  const standIn = (p) => {
    const r = level.roomAt(p);
    if (!r) return null;
    const b = r.bounds;
    if (p.x < b.min.x + 0.3 || p.x > b.max.x - 0.3 || p.z < b.min.z + 0.3 || p.z > b.max.z - 0.3) return null;
    return r.id;
  };
  out.skipped = 0;
  const standFails = [];
  const nodes = level.nav ?? [];
  for (const r of level.rooms) {
    const b = r.bounds;
    const mine = nodes.filter((n) => n.room === r.id);
    const pts = [];
    const pick = (x, z, rad) => {
      // the walkable point nearest (x, z), per floor height
      const byFloor = new Map();
      for (const n of mine) {
        const dd = Math.hypot(n.position.x - x, n.position.z - z);
        if (dd > rad) continue;
        const key = Math.round(n.position.y * 2);
        const cur = byFloor.get(key);
        if (!cur || dd < cur.d) byFloor.set(key, { n, d: dd });
      }
      for (const { n } of byFloor.values()) if (!pts.some((p) => p.distanceTo(n.position) < 1.5)) pts.push(n.position.clone());
    };
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    pick(cx, cz, 1e9);
    for (let x = b.min.x + o.grid / 2; x < b.max.x; x += o.grid) for (let z = b.min.z + o.grid / 2; z < b.max.z; z += o.grid) pick(x, z, o.grid * 0.45);
    // floors without nav nodes (stage 3c `nav: false`: the crawlway, the magazine): their own centre + grid
    for (const f of r.floors ?? []) {
      if (f.nav !== false) continue;
      const [x0, x1, z0, z1] = f.box;
      const add = (x, z) => { const q = new THREE_V(x, f.y, z); if (!pts.some((p) => p.distanceTo(q) < 1.5)) pts.push(q); };
      add((x0 + x1) / 2, (z0 + z1) / 2);
      for (let x = x0 + o.grid / 2; x < x1; x += o.grid) for (let z = z0 + o.grid / 2; z < z1; z += o.grid) add(x, z);
    }
    if (!pts.length) { const y = r.floor ?? r.y0 ?? 0; pts.push(new THREE_V(cx, y, cz)); out.notes.push(`room ${r.id}: no nav nodes, centre used`); }
    let kept = 0;
    for (const p of pts) {
      const probe = new THREE_V(p.x, p.y + 0.9, p.z);
      if (standIn(probe) === null) { out.skipped++; continue; }
      kept++;
      for (let k = 0; k < 8; k++) for (const pitch of [0, -20]) views.push({ kind: 'room', room: r.id, p: [p.x, p.y, p.z], yaw: k * 45, pitch });
    }
    if (!kept) standFails.push(r.id);
  }
  for (const d of level.doors) {
    const wall = d.spec?.wall;
    if (!wall) continue;
    const fy = d.floor ?? 0;
    for (const s of [-1, 1]) {
      const p = wall === 'x' ? [d.position.x + s, fy, d.position.z] : [d.position.x, fy, d.position.z + s];
      if (standIn(new THREE_V(p[0], fy + 0.9, p[2])) === null) { out.skipped++; continue; }
      // facing the door: direction (−s, 0) or (0, −s) → yaw (0 looks down −z, +90 = −x)
      const dx = wall === 'x' ? -s : 0, dz = wall === 'z' ? -s : 0;
      const yaw0 = Math.atan2(-dx, -dz) / deg;
      for (const dy of [-30, 0, 30]) views.push({ kind: 'door', door: d.id, p, yaw: yaw0 + dy, pitch: 0 });
    }
  }

  const fail = (rule, v, view, n, extra = {}, mark = null) => {
    const f = { rule, volume: v.id, view: { ...view, p: view.p.map((x) => +x.toFixed(2)), yaw: +view.yaw.toFixed(1) }, pixels: n, ...extra };
    out.fails.push(f);
    if (out.shots.length < o.shots) {
      // the frame of the volume alone; offending pixels (gap) painted green
      if (mark) { c2d.fillStyle = '#00ff00'; for (const k of mark) c2d.fillRect(k % W, (k / W) | 0, 1, 1); }
      out.shots.push({ name: `${rule}-${v.id}-${out.fails.length}`, url: c2.toDataURL('image/png') });
    }
  };

  for (const id of standFails) out.fails.push({ rule: 'stand', volume: '-', view: { kind: 'room', room: id, p: [0, 0, 0], yaw: 0 }, pixels: 0, from: id });
  const P = new THREE_V();
  const t0 = performance.now();
  for (const view of views) {
    P.set(view.p[0], view.p[1], view.p[2]);
    player.teleport(P, view.yaw * deg, view.pitch * deg);
    out.views++;
    // (B, C) gate on, as in the game
    fx.forceVolumes(false);
    let d = frame();
    const here = roomOfPoint(cam.getWorldPosition(new THREE_V()));
    const drawn = new Set(fx.drawnRooms());
    let mag = magenta(d);
    if (mag.length > o.maxPx) {
      const bl = baseline();
      if (mag.filter((k) => !bl.has(k)).length > o.maxPx) {
        for (const v of vols) {
          if (!v.object.visible) continue;
          const px = solo(v).filter((k) => !bl.has(k));
          if (px.length <= o.maxPx) continue;
          if (here && !v.rooms.includes(here) && !v.seenFrom.includes(here)) fail('room', v, view, px.length, { from: here, drawn: [...drawn] });
          if (v.apertures.length) {
            // (a pixel within 2 px of one seen through the aperture is the pane edge's AA / bloom halo, not a gap)
            const inAp = new Set(), out2 = [];
            for (const k of px) { if (throughAperture(k, v.apertures)) inAp.add(k); else out2.push(k); }
            const near = (k) => { const x = k % W, y = (k / W) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inAp.has((y + dy) * W + x + dx)) return true; return false; };
            const gap = out2.filter((k) => !near(k));
            if (gap.length > o.maxPx) fail('gap', v, view, gap.length, { from: here }, gap);
          }
        }
      }
    }
    // (A) S13: gate off — volumes none of whose rooms is drawn must not show
    const hidden = vols.filter((v) => !v.rooms.some((r) => drawn.has(r)));
    if (hidden.length) {
      fx.forceVolumes(true);
      d = frame();
      mag = magenta(d);
      if (mag.length > o.maxPx) {
        const bl = baseline();
        for (const v of hidden) {
          if (!v.object.visible) continue;
          const px = solo(v).filter((k) => !bl.has(k));
          if (px.length > o.maxPx) fail('s13', v, view, px.length, { from: here, drawn: [...drawn] });
        }
      }
      fx.forceVolumes(false);
    }
  }
  out.ms = Math.round(performance.now() - t0);

  // ── self-test (--selftest): negative controls — the gap rule must catch a volume whose aperture is shrunk to half
  if (o.selftest) {
    out.selftest = {};
    const v = vols.find((x) => x.apertures.length);
    if (v) {
      const a = v.apertures[0];
      const p = a.center.clone().addScaledVector(a.normal, 8);
      player.teleport(p, Math.atan2(a.normal.x, a.normal.z), 0);
      fx.forceVolumes(false);
      frame();
      const px = solo(v);
      const w0 = a.width;
      a.width = w0 / 2;
      const gap = px.filter((k) => !throughAperture(k, v.apertures)).length;
      a.width = w0;
      const full = px.filter((k) => !throughAperture(k, v.apertures)).length;
      out.selftest.gap = `${v.id}: ${px.length} px seen, ${full} outside the pane, ${gap} outside a half-width pane → ${gap > o.maxPx && full <= o.maxPx ? 'caught' : 'NOT CAUGHT'}`;
    } else out.selftest.gap = 'no volume with apertures on this level';
  }

  // ── (P) probes: the load-time bake (render.prepare, run again with every volume forced on) and re-captures
  const probes = render._debug?.probes;
  const renderer = g.renderer;
  if (probes && vols.length) {
    const cube = probes.cubeRT;
    const visibleNow = (obj) => { for (let o2 = obj; o2; o2 = o2.parent) if (!o2.visible) return false; return true; };
    const orig = renderer.render.bind(renderer);
    let faces = 0, phase = 'bake';
    renderer.render = (scene, camera) => {
      if (renderer.getRenderTarget() === cube) {
        faces++;
        for (const v of vols) if (visibleNow(v.object) && !out.probe.some((x) => x.volume === v.id)) out.probe.push({ volume: v.id, phase: phase });
      }
      return orig(scene, camera);
    };
    fx.forceVolumes(true);
    if (o.selftest) {
      // negative control: a bare bake that hides nothing must be caught
      phase = 'selftest';
      probes.bake(level.probes.slice(0, 2), level.rooms, 1e9);
      const hit = out.probe.filter((x) => x.phase === 'selftest');
      out.selftest.probe = hit.length > 0 ? `caught (${hit.map((x) => x.volume).join(', ')})` : 'NOT CAUGHT';
      out.probe = out.probe.filter((x) => x.phase !== 'selftest');
      phase = 'bake';
      faces = 0;
    }
    player.teleport(new THREE_V(...(level.probes[0] ? [level.probes[0].x, level.probes[0].y, level.probes[0].z] : [0, 0, 0])), 0, 0);
    await render.prepare(level.probes);
    out.probeFaces = { bake: faces };
    phase = 'recapture';
    faces = 0;
    for (const p of probes.probes) p.dirty = true;
    probes.settle = 0;
    for (let i = 0; i < 400 && faces < 6; i++) { fx.forceVolumes(true); frame(); }
    out.probeFaces.recapture = faces;
    renderer.render = orig;
    fx.forceVolumes(false);
  }
  return out;
}

let bad = 0;
const browser = await launch();
try {
  for (const lv of levels) {
    console.log(`[fxleak] level ${lv}`);
    const page = await bootLevel(browser, base, lv, { width: 320, height: 180, settle: 2500 });
    page.on('console', (m) => { if (m.type() === 'error' || (opts.verbose && m.type() === 'warning')) console.log(`  [console.${m.type()}] ${m.text()}`); });
    await page.evaluate(() => window.__game.fx.debugVolumes?.(true));
    const res = await page.evaluate(run, opts);
    await page.close();
    if (res.error) { console.log(`  ERROR ${res.error}`); bad++; continue; }
    const dir = `shots/checks/fxleak-l${lv}`;
    rmSync(dir, { recursive: true, force: true });
    if (res.shots.length) mkdirSync(dir, { recursive: true });
    for (const s of res.shots) writeFileSync(`${dir}/${s.name}.png`, Buffer.from(s.url.split(',')[1], 'base64'));
    const shots = res.shots.map((s) => s.name);
    delete res.shots;
    const file = writeJson('fxleak', lv, { ...res, shots });
    console.log(`  volumes: ${res.volumes.map((v) => `${v.id} [${v.rooms.join(',')}]${v.seenFrom.length ? ` +seen [${v.seenFrom.join(',')}]` : ''}${v.apertures ? ` ap ${v.apertures}` : ''}`).join('; ') || '—'}`);
    console.log(`  views: ${res.views} (${res.ms} ms; ${res.skipped} view point(s) outside a room interior dropped); probe faces: bake ${res.probeFaces?.bake ?? '-'}, re-capture ${res.probeFaces?.recapture ?? '-'}`);
    for (const n of res.notes) console.log(`  note: ${n}`);
    if (res.selftest) {
      console.log(`  selftest gap: ${res.selftest.gap}`);
      console.log(`  selftest probe: ${res.selftest.probe ?? 'not run'}`);
      if (/NOT CAUGHT/.test(`${res.selftest.gap} ${res.selftest.probe}`)) bad++;
    }
    const byKey = new Map();
    for (const f of res.fails) {
      const k = `${f.rule} ${f.volume} ${f.from ?? ''}`;
      const e = byKey.get(k) ?? { n: 0, max: 0, ex: f };
      e.n++; if (f.pixels > e.max) { e.max = f.pixels; e.ex = f; }
      byKey.set(k, e);
    }
    for (const [k, e] of byKey) console.log(`  FAIL ${k}: ${e.n} view(s), up to ${e.max} px — e.g. ${e.ex.view.kind} ${e.ex.view.room ?? e.ex.view.door} p=${e.ex.view.p.join(',')} yaw ${e.ex.view.yaw} pitch ${e.ex.view.pitch}`);
    for (const p of res.probe) console.log(`  FAIL probe ${p.volume}: visible during a probe ${p.phase}`);
    const n = res.fails.length + res.probe.length;
    console.log(`  ${n ? `${n} failure(s)` : 'OK'} → ${file}`);
    bad += n;
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
