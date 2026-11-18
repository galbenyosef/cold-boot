// Stage 3d §8.3 (task W1): the player in water, the deep-water rescue and the grip.
//   node scripts/check-water.mjs [--url http://127.0.0.1:5173] [--part synthetic,level,grip,husk] [--grid 0.5]
// On a static build (vite build + vite preview). Exit 1 on any failure.
//
//   synthetic — on level 6's page (any build: K's stub room, or the real level) a TEST water volume is laid over a
//               dry floor (a `rayOnly` quad + a WaterVolume in `level.water`) at depths 0 / 0.2 / 0.5 / 1.0:
//               walk / sprint speeds per depth band (± 3 %, D13), no sprint ≥ 0.35, jump height × 0.5 at 0.35 … 0.7,
//               no jump ≥ 0.7, crouch refused ≥ 0.7 (toast `Too deep to crouch`), footsteps surface 'water',
//               `player.wading`; a carbine round into the water splashes AT the surface (bullet:impact 'water', y of
//               the surface), lineOfSight to a point under the surface is false; the deep-water hold and the rescue
//               in a test volume over the void (sink ≤ 0.5 m/s, rescued at 1.0 s + 0.5 s black, −15 health, never
//               below 1, alive, `player:rescued`, the nearest exit marker, never below the kill height)
//   grip      — hold advances, release pauses, progress resumes from `start`, a 35-damage hit pauses 0.3 s and does
//               not cancel, a 1.4 m walk-away pauses (hold) / cancels (press), real E held never fires `interact`
//               while the grip owns it, the weapon is lowered and raised back, 'done' / cancel / debug hooks
//   husk      — a husk standing waist-deep in the test water: rounds at its submerged legs hit the water (0 damage),
//               rounds at its torso hit it (level 6 page with enemies; skipped with --part without it)
//   level     — only when the level has `wat6_wet` (W4b's water, not K's stub): from every water cell (a --grid m grid
//               over `wat6_wet`, incl. the channel's bottom and its ends) a bot under the wading caps walks out to dry
//               floor in ≤ 10 s (B3, `player.debug.walkOut`, 16 headings); the rescue from a debug teleport into
//               `wat6_well` lands on `mk6_lw_exit` / `mk6_le_exit` / `mk6_boss_safe`; lineOfSight from
//               `mk6_boss_safe` (eye) to a point under the well's surface is false
import { launch, parseArgs } from './lib/check-common.mjs';

const args = parseArgs();
const base = (args.url ?? process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const parts = new Set(String(args.part ?? 'synthetic,grip,husk,level').split(','));
const GRID = Number(args.grid ?? 0.5);
const problems = [];
const check = (cond, m) => { if (cond) console.log(`  ok   ${m}`); else { problems.push(m); console.log(`  FAIL ${m}`); } };
const near = (v, want, tol) => Math.abs(v - want) <= Math.abs(want) * tol;

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => { problems.push(`pageerror ${e.message}`); console.log(`  [pageerror] ${e.message}`); });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function open(q) {
  await page.goto(`${base}/${q}`);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  // in-page helpers: game-time waits, a test water volume, event logs
  await page.evaluate(() => {
    const g = window.__game, V = g.player.position.constructor;
    const THREE = g.physics._fresh().THREE;
    const log = { steps: [], toasts: [], impacts: [], rescued: [], interacts: [], damaged: [] };
    g.events.on('player:footstep', (e) => log.steps.push(e.surface));
    g.events.on('story:toast', (e) => log.toasts.push(e.text));
    g.events.on('bullet:impact', (e) => log.impacts.push({ y: +e.point.y.toFixed(3), p: e.point.toArray(), surface: e.surface }));
    g.events.on('player:rescued', (e) => log.rescued.push({ from: e.from.toArray(), to: e.to.toArray() }));
    g.events.on('interact', (e) => log.interacts.push(e.id));
    g.events.on('enemy:damaged', (e) => log.damaged.push({ amount: e.amount, part: e.part ?? null }));
    const baseColliders = g.level.colliders.slice();
    const realWater = g.level.water.slice();
    window.__w1 = {
      log, V, THREE,
      /** Game-time wait (the main loop's clock). */
      wait: (s) => new Promise((res) => { const t0 = g.time; const f = () => (g.time - t0 >= s ? res(g.time - t0) : requestAnimationFrame(f)); f(); }),
      /** Lay test volumes ({ id, x0, x1, z0, z1, y0, surface, stand }) — physics rebuilt with their rayOnly quads. */
      water(vols) {
        const mat = new THREE.MeshBasicMaterial();
        const meshes = vols.map((v) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(v.x1 - v.x0, 0.01, v.z1 - v.z0), mat);
          m.position.set((v.x0 + v.x1) / 2, v.surface - 0.005, (v.z0 + v.z1) / 2);
          m.userData.rayOnly = true; m.userData.surface = 'water';
          m.updateMatrixWorld(true);
          return m;
        });
        g.physics.build([...baseColliders, ...meshes]);
        g.level.water.length = 0;
        for (const w of realWater) g.level.water.push(w);
        for (const v of vols) g.level.water.push({ id: v.id, room: 'test', box: new THREE.Box3(new V(v.x0, v.y0, v.z0), new V(v.x1, v.surface, v.z1)), surface: v.surface, stand: v.stand ?? 1.25 });
      },
      reset() { g.physics.build(baseColliders); g.level.water.length = 0; for (const w of realWater) g.level.water.push(w); },
    };
  });
}

// ═════════════════════════════════════════════════════════════ synthetic
if (parts.has('synthetic')) {
  console.log('══════════ wading (test water in level 6\'s spawn room) ══════════');
  await open('?level=6&autostart=1&nostory=1&noenemies=1&torch=inf');
  const r = await page.evaluate(async () => {
    const g = window.__game, P = g.player, W = window.__w1, V = W.V;
    const C = P.debug.wadeConst();
    const sp = g.level.spawn.position;
    // a run lane along −z through the spawn room: the room is the stub's (x −4 … 4, z −3 … 5) or the real lock6
    const lane = { x: sp.x, z0: sp.z + 1.2, z1: sp.z - 5.0, y: sp.y };
    const vol = (surface) => [{ id: 'wat_test', x0: lane.x - 3.5, x1: lane.x + 3.5, z0: lane.z1 - 1, z1: lane.z0 + 1.5, y0: lane.y - 1, surface: lane.y + surface, stand: 1.25 }];
    const out = { C: { walk: C.move.walk, sprint: C.move.sprint }, bands: [] };
    P.debug.switchTo('carbine'); P.give('carbine', 30);
    for (const d of [0, 0.2, 0.5, 1.0]) {
      if (d > 0) W.water(vol(d)); else W.reset();
      const band = { d };
      for (const sprint of [false, true]) {
        P.teleport(new V(lane.x, lane.y + 0.02, lane.z0), 0, 0);
        await W.wait(0.3);
        W.log.steps.length = 0;
        P.debug.move(1, 0, sprint);
        await W.wait(0.5);
        const z0 = P.position.z; const t = await W.wait(0.4); const z1 = P.position.z;
        P.debug.move(0, 0, false);
        band[sprint ? 'sprint' : 'walk'] = +((z0 - z1) / t).toFixed(3);
        if (!sprint) band.steps = [...new Set(W.log.steps)];
        band.wading = +P.wading.toFixed(3);
      }
      // jump: the apex over the floor
      P.teleport(new V(lane.x, lane.y + 0.02, lane.z0 - 1), 0, 0);
      await W.wait(0.3);
      const y0 = P.position.y; let top = y0;
      P.debug.jump();
      for (let i = 0; i < 50; i++) { await W.wait(0.02); top = Math.max(top, P.position.y); }
      band.jump = +(top - y0).toFixed(3);
      // crouch
      W.log.toasts.length = 0;
      P.debug.crouch(true); await W.wait(0.3);
      band.crouched = P.debug.state().crouched;
      band.toast = W.log.toasts.includes(C.toastCrouch);
      P.debug.crouch(false); await W.wait(0.4);
      out.bands.push(band);
    }
    // ── rounds and sight stop at the surface (d 1.0 water)
    W.water(vol(1.0));
    P.teleport(new V(lane.x, lane.y + 0.02, lane.z0), 0, 0);
    await W.wait(0.5);
    W.log.impacts.length = 0;
    P.weapons.carbine.clip = 30;
    const target = new V(lane.x, lane.y + 0.3, lane.z0 - 2.5);
    P.debug.aimLock(target.x, target.y, target.z);
    P.debug.fire(); await W.wait(0.3);
    P.debug.aimLock(null);
    out.impact = W.log.impacts.slice();
    out.surfaceY = lane.y + 1.0;
    out.los = g.physics.lineOfSight(new V(lane.x, lane.y + 1.6, lane.z0), target);
    out.losDry = g.physics.lineOfSight(new V(lane.x, lane.y + 1.6, lane.z0), new V(lane.x, lane.y + 1.3, lane.z0 - 2.5));
    // ── hitRate (H18): 0.5 → every other aim-locked shot passes the point 0.5 m off (a point on the wall ahead)
    {
      W.reset();
      P.teleport(new V(lane.x, lane.y + 0.02, lane.z0), 0, 0);
      await W.wait(0.3);
      const wh = g.physics.raycast(new V(lane.x, lane.y + 1.4, lane.z0), new V(0, 0, -1), 30);
      const pt = wh.point.clone();
      P.debug.hitRate(0.5);
      const off = [];
      for (let i = 0; i < 6; i++) {
        W.log.impacts.length = 0;
        P.weapons.carbine.clip = 30;
        P.debug.aimLock(pt.x, pt.y, pt.z); P.debug.fire(); await W.wait(0.25);
        const im = W.log.impacts[0];
        off.push(im ? +Math.hypot(im.p[0] - pt.x, im.p[1] - pt.y, im.p[2] - pt.z).toFixed(3) : null);
      }
      P.debug.aimLock(null); P.debug.hitRate(null);
      out.hitRate = off;
    }
    // ── the walk-out bot (B3's tool): out of a 1.0 m pool that ends 2 m ahead; and a control that never gets dry
    W.water([{ id: 'wat_test', x0: lane.x - 3.5, x1: lane.x + 3.5, z0: lane.z0 - 2, z1: lane.z0 + 1.5, y0: lane.y - 1, surface: lane.y + 1.0, stand: 1.25 }]);
    out.walkOut = P.debug.walkOut(lane.x, lane.y + 0.02, lane.z0, 0, 10, true);
    W.water(vol(1.0).map((v) => ({ ...v, x0: v.x0 - 10, x1: v.x1 + 10, z0: v.z0 - 10, z1: v.z1 + 10 })));
    out.walkOutCtl = P.debug.walkOut(lane.x, lane.y + 0.02, lane.z0, 0, 3, true);
    // ── deep water over the void beside the room: the hold and the rescue
    W.water([{ id: 'wat_deep', x0: lane.x + 8, x1: lane.x + 14, z0: lane.z0 - 4, z1: lane.z0 + 2, y0: lane.y - 30, surface: lane.y, stand: 1.25 }]);
    const fake = [
      ['mk6_lw_exit', new V(lane.x + 1.5, lane.y, lane.z0 - 1)],
      ['mk6_boss_safe', new V(lane.x - 1.5, lane.y, lane.z0 - 1)],
    ];
    const orig = g.level.object.bind(g.level);
    g.level.object = (n) => { const f = fake.find((e) => e[0] === n); if (f) { const o = new W.THREE.Object3D(); o.position.copy(f[1]); return o; } return orig(n); };
    const runRescue = async (health) => {
      W.log.rescued.length = 0;
      P.health = health;
      P.teleport(new V(lane.x + 11, lane.y - 1.6, lane.z0 - 1), 0, 0);
      const rec = { minY: 99, maxSink: 0, at09: null, tRescue: null };
      const t0 = g.time;
      while (g.time - t0 < 2.4 && !W.log.rescued.length) {
        await W.wait(0.02);
        const w = P.debug.water();
        if (P.position.x > lane.x + 5) { rec.minY = Math.min(rec.minY, P.position.y); rec.maxSink = Math.min(rec.maxSink, w.vy); }
        if (rec.at09 === null && g.time - t0 >= 0.9) rec.at09 = { rescued: W.log.rescued.length, deep: w.deep, under: w.under, gravityScale: w.gravityScale };
      }
      rec.tRescue = +(g.time - t0).toFixed(3);
      rec.rescued = W.log.rescued.slice();
      rec.health = P.health; rec.alive = P.alive;
      rec.pos = P.position.toArray().map((v) => +v.toFixed(2));
      return rec;
    };
    out.rescue = await runRescue(100);
    await W.wait(0.6);
    out.rescueLow = await runRescue(10);
    g.level.object = orig;
    out.killY = g.physics.killY;
    W.reset();
    P.health = 100;
    return out;
  });
  console.log('  ', JSON.stringify(r));
  const walk = r.C.walk, sprint = r.C.sprint;
  const want = { 0: [walk, sprint], 0.2: [walk * 0.85, sprint * 0.8], 0.5: [walk * 0.6, walk * 0.6], 1: [walk * 0.4, walk * 0.4] };
  for (const b of r.bands) {
    const [w, s] = want[b.d];
    check(near(b.walk, w, 0.03), `d ${b.d}: walk ${b.walk} m/s (want ${w.toFixed(2)} ± 3 %)`);
    check(near(b.sprint, s, 0.03), `d ${b.d}: sprint ${b.sprint} m/s (want ${s.toFixed(2)} ± 3 %${b.d >= 0.35 ? ', no sprint' : ''})`);
    check(Math.abs(b.wading - b.d) < 0.03, `d ${b.d}: player.wading ${b.wading}`);
    if (b.d >= 0.1) check(b.steps.length === 1 && b.steps[0] === 'water', `d ${b.d}: footsteps surface ${JSON.stringify(b.steps)}`);
    else check(b.steps.length && !b.steps.includes('water'), `dry: footsteps ${JSON.stringify(b.steps)}`);
    if (b.d >= 0.7) check(b.jump < 0.03, `d ${b.d}: no jump (rise ${b.jump})`);
    else if (b.d >= 0.35) check(b.jump > 0.4 && b.jump < 0.6, `d ${b.d}: jump × 0.5 (rise ${b.jump})`);
    else check(b.jump > 0.85, `d ${b.d}: full jump (rise ${b.jump})`);
    if (b.d >= 0.7) check(!b.crouched && b.toast, `d ${b.d}: crouch refused (crouched ${b.crouched}, toast ${b.toast})`);
    else check(b.crouched, `d ${b.d}: crouch allowed`);
  }
  check(r.impact.length === 1 && r.impact[0].surface === 'water' && Math.abs(r.impact[0].y - r.surfaceY) < 0.03, `a round into the water stops at the surface (${JSON.stringify(r.impact)}, surface ${r.surfaceY})`);
  check(r.los === false && r.losDry === true, `lineOfSight to a point under the surface false (${r.los}), above it true (${r.losDry})`);
  const hits = r.hitRate.filter((d) => d !== null && d < 0.05).length, misses = r.hitRate.filter((d) => d !== null && d > 0.4).length;
  check(hits === 3 && misses === 3, `hitRate(0.5): 3 of 6 rounds on the point, 3 ≥ 0.4 m off (offsets ${r.hitRate.join(' / ')})`);
  check(r.walkOut.dry && Math.abs(r.walkOut.t - (2 / (walk * 0.4) + 0.2)) < 0.4 && r.walkOut.maxD > 0.95, `walk-out bot: out of a 2 m waist-deep stretch in ${r.walkOut.t} s (${JSON.stringify(r.walkOut)})`);
  check(!r.walkOutCtl.dry, `walk-out control: no dry floor → not dry (${JSON.stringify(r.walkOutCtl)})`);
  for (const [name, x, hp0] of [['rescue', r.rescue, 100], ['rescue (10 hp)', r.rescueLow, 10]]) {
    check(x.at09 && x.at09.rescued === 0 && x.at09.deep && x.at09.gravityScale === 0, `${name}: held, not rescued at 0.9 s (${JSON.stringify(x.at09)})`);
    check(x.maxSink >= -0.5 - 1e-3, `${name}: sink ≤ 0.5 m/s (min vy ${x.maxSink})`);
    check(x.rescued.length === 1 && x.tRescue >= 1.45 && x.tRescue <= 1.75, `${name}: rescued once at ${x.tRescue} s (1.0 s under + 0.5 s black)`);
    check(x.alive && x.health === Math.max(1, hp0 - 15), `${name}: alive, health ${hp0} → ${x.health}`);
    check(x.minY > r.killY, `${name}: never below the kill height (min y ${x.minY}, kill ${r.killY})`);
    check(x.rescued[0] && Math.abs(x.rescued[0].to[0] - x.pos[0]) < 0.05, `${name}: placed at the nearest exit marker (${JSON.stringify(x.pos)})`);
  }
  const rescErr = errors.filter((e) => e.includes('[player] deep-water rescue')).length;
  check(rescErr === 2, `console.error '[player] deep-water rescue' logged per rescue (${rescErr})`);
}

// ═════════════════════════════════════════════════════════════ grip
if (parts.has('grip')) {
  console.log('══════════ grip ══════════');
  await open('?level=6&autostart=1&nostory=1&noenemies=1&torch=inf');
  const r = await page.evaluate(async () => {
    const g = window.__game, P = g.player, W = window.__w1, V = W.V;
    const sp = g.level.spawn.position;
    const point = new V(sp.x, sp.y + 1.15, sp.z - 2.0), normal = new V(0, 0, 1);
    const stand = new V(sp.x, sp.y + 0.02, sp.z - 1.1);
    P.debug.switchTo('carbine'); P.give('carbine', 30);
    await W.wait(0.8);
    const out = {};
    const mk = (o = {}) => P.grip({ id: 'w1_test', point, normal, seconds: 3, hold: true, motion: 'crank', ...o });
    let res = null;
    P.teleport(stand, 0, 0); await W.wait(0.3);
    out.lowerBefore = P.debug.state().lower;
    let h = mk(); h.done.then((v) => { res = v; });
    P.debug.gripHold(true);
    let t = await W.wait(1.0);
    out.hold = { p: +h.progress.toFixed(3), want: +(t / 3).toFixed(3), holding: h.holding, lower: P.debug.state().lower, stowed: P.debug.state().stowed, hands: P.debug.grip().hands };
    // the feet are planted while E works it
    const fp = P.position.clone(); P.debug.move(1, 0.5, true); await W.wait(0.3); P.debug.move(0, 0, false);
    out.planted = +P.position.distanceTo(fp).toFixed(4);
    P.debug.gripHold(false);
    await W.wait(0.1);
    const pr0 = h.progress; await W.wait(0.5);
    out.release = { dp: +(h.progress - pr0).toFixed(4), holding: h.holding, res };
    await W.wait(0.4);
    out.releasedLower = P.debug.state().lower;
    // resume
    P.debug.gripHold(true);
    const pr1 = h.progress; t = await W.wait(0.5);
    out.resume = { dp: +(h.progress - pr1).toFixed(3), want: +(t / 3).toFixed(3) };
    // a 35-damage hit: 0.3 s flinch, not cancelled
    P.debug.setArmor(0);
    P.damage(35);
    const pr2 = h.progress; await W.wait(0.25);
    out.flinch = { dp: +(h.progress - pr2).toFixed(4), res, holding: h.holding };
    await W.wait(0.3);
    out.afterFlinch = { dp: +(h.progress - pr2).toFixed(4), res };
    P.health = 100;
    // walk away 1.4 m (release first: the feet are planted while held), then hold: paused, not cancelled
    P.debug.gripHold(false); await W.wait(0.1);
    P.debug.move(-1, 0, false);
    const f0 = g.time; while (P.debug.grip()?.dist < 1.45 && g.time - f0 < 3) await W.wait(0.02);
    P.debug.move(0, 0, false); await W.wait(0.3);
    P.debug.gripHold(true);
    const pr3 = h.progress; await W.wait(0.5);
    out.away = { dist: P.debug.grip()?.dist ?? null, dp: +(h.progress - pr3).toFixed(4), res, alive: !!P.debug.grip() };
    P.debug.gripHold(false);
    // a new grip from `start` (the caller keeps the progress) cancels the old
    P.teleport(stand, 0, 0); await W.wait(0.2);
    out.teleportCancelled = res;
    const keep = 0.5;
    let res2 = null;
    const h2 = mk({ start: keep }); h2.done.then((v) => { res2 = v; });
    out.start = +h2.progress.toFixed(3);
    P.debug.gripHold(true);
    const t2 = g.time;
    while (res2 === null && g.time - t2 < 3) await W.wait(0.05);
    out.finish = { res: res2, t: +(g.time - t2).toFixed(2), want: 1.5, gripAfter: P.gripProgress };
    P.debug.gripHold(false);
    await W.wait(0.8);
    out.raisedBack = { lower: P.debug.state().lower, stowed: P.debug.state().stowed, hands: P.debug.grip() };
    // a press grip cancels on walking away
    let res3 = null;
    const h3 = mk({ hold: false, seconds: 10 }); h3.done.then((v) => { res3 = v; });
    await W.wait(0.5);
    out.pressRuns = +h3.progress.toFixed(3);
    P.debug.move(-1, 0, false);
    const f1 = g.time; while (res3 === null && g.time - f1 < 3) await W.wait(0.02);
    P.debug.move(0, 0, false);
    out.pressAway = res3;
    // refused: too far / behind the face
    let res4 = null; P.teleport(new V(sp.x, sp.y + 0.02, sp.z + 1), 0, 0); await W.wait(0.2);
    const h4 = mk(); await h4.done.then((v) => { res4 = v; });
    out.refusedFar = { res: res4, gp: P.gripProgress };
    // debug done / abandon
    P.teleport(stand, 0, 0); await W.wait(0.2);
    let res5 = null; mk().done.then((v) => { res5 = v; }); P.debug.grip('done'); await W.wait(0.05);
    let res6 = null; mk().done.then((v) => { res6 = v; }); P.debug.grip('abandon'); await W.wait(0.05);
    out.debugDone = res5; out.debugAbandon = res6;
    // E never fires interact during a grip: an interactable at the handle; the test presses the real key next
    g.interactables.add({ id: 'w1_handle', kind: 'test', position: point.clone(), prompt: 'test', enabled: true, radius: 2.2 });
    P.teleport(stand, 0, 0); P.pitch = -0.35; await W.wait(0.3);
    out.focusBefore = P.focus?.id ?? null;
    W.log.interacts.length = 0;
    window.__gripE = mk({ seconds: 1.0 });
    window.__gripERes = null; window.__gripE.done.then((v) => { window.__gripERes = v; });
    return out;
  });
  // the real E key: held through the whole grip (1.0 s) and a moment after it ends
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(1600);
  await page.keyboard.up('KeyE');
  await page.waitForTimeout(200);
  const e = await page.evaluate(() => ({ res: window.__gripERes, interacts: window.__w1.log.interacts.slice(), focus: window.__game.player.focus?.id ?? null }));
  // a fresh press after it: interact works again
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  const e2 = await page.evaluate(() => window.__w1.log.interacts.slice());
  console.log('  ', JSON.stringify(r), JSON.stringify(e), JSON.stringify(e2));
  check(r.hold.p > 0 && near(r.hold.p, r.hold.want, 0.08) && r.hold.holding, `hold advances (${r.hold.p} after 1 s of 3; want ${r.hold.want})`);
  check(r.hold.lower > 0.9 && r.hold.stowed && r.hold.hands === 'hold', `weapon lowered, hands on the handle (lower ${r.hold.lower}, hands ${r.hold.hands})`);
  check(r.planted < 0.01, `the feet are planted while E is held (moved ${r.planted} m)`);
  check(r.lowerBefore < 0.05, `weapon up before (${r.lowerBefore})`);
  check(Math.abs(r.release.dp) < 1e-4 && !r.release.holding && r.release.res === null, `release pauses (Δ ${r.release.dp}, not cancelled)`);
  check(r.releasedLower < 0.2, `released: the weapon comes back up (lower ${r.releasedLower})`);
  check(near(r.resume.dp, r.resume.want, 0.12), `resume advances (${r.resume.dp}, want ${r.resume.want})`);
  check(Math.abs(r.flinch.dp) < 0.004 && r.flinch.res === null, `a 35-damage hit pauses (Δ ${r.flinch.dp} over 0.25 s), not cancelled`);
  check(r.afterFlinch.dp > 0.05 && r.afterFlinch.res === null, `after the flinch it advances again (Δ ${r.afterFlinch.dp})`);
  check(r.away.dist >= 1.4 && Math.abs(r.away.dp) < 1e-4 && r.away.res === null && r.away.alive, `1.4 m walk-away pauses a hold grip (dist ${r.away.dist}, Δ ${r.away.dp})`);
  check(r.teleportCancelled === 'cancelled', `a teleport cancels (${r.teleportCancelled})`);
  check(r.start === 0.5 && r.finish.res === 'done' && Math.abs(r.finish.t - 1.5) < 0.15 && r.finish.gripAfter === -1, `start 0.5 → done in ${r.finish.t} s (want 1.5), gripProgress −1 after`);
  check(r.raisedBack.lower < 0.1 && !r.raisedBack.stowed && r.raisedBack.hands === null, `the weapon is raised back after (lower ${r.raisedBack.lower})`);
  check(r.pressRuns > 0.03 && r.pressAway === 'cancelled', `a press grip runs on its own (${r.pressRuns}) and cancels on walking away (${r.pressAway})`);
  check(r.refusedFar.res === 'cancelled' && r.refusedFar.gp === -1, `refused beyond reach (${r.refusedFar.res})`);
  check(r.debugDone === 'done' && r.debugAbandon === 'cancelled', `debug grip('done') / ('abandon') (${r.debugDone} / ${r.debugAbandon})`);
  check(r.focusBefore === 'w1_handle', `the test handle is focused before the grip (${r.focusBefore})`);
  check(e.res === 'done' && e.interacts.length === 0, `E held through a grip never fires interact (${e.res}, interacts ${JSON.stringify(e.interacts)})`);
  check(e2.length === 1, `a fresh E press after it uses the handle again (${JSON.stringify(e2)})`);
}

// ═════════════════════════════════════════════════════════════ husk in water
if (parts.has('husk')) {
  console.log('══════════ husk in water (legs under, torso above) ══════════');
  await open('?level=6&autostart=1&nostory=1&god=1&torch=inf');
  const r = await page.evaluate(async () => {
    const g = window.__game, P = g.player, W = window.__w1, V = W.V;
    const sp = g.level.spawn.position;
    W.water([{ id: 'wat_test', x0: sp.x - 3.5, x1: sp.x + 3.5, z0: sp.z - 6, z1: sp.z + 2.5, y0: sp.y - 1, surface: sp.y + 1.0, stand: 1.25 }]);
    P.debug.switchTo('carbine'); P.give('carbine', 120);
    P.teleport(new V(sp.x, sp.y + 0.02, sp.z + 1.5), 0, 0);
    await W.wait(0.8);
    const e = g.enemies.spawn('husk', new V(sp.x, sp.y, sp.z - 3.0), 0, 'w1_test');
    await W.wait(0.3);
    const shoot = async (dy, n) => {
      W.log.damaged.length = 0; W.log.impacts.length = 0;
      for (let i = 0; i < n && e.alive; i++) {
        P.weapons.carbine.clip = 30;
        P.debug.aimLock(e.position.x, e.position.y + dy, e.position.z);
        P.debug.fire(); await W.wait(0.15);
      }
      P.debug.aimLock(null);
      return { damage: W.log.damaged.reduce((a, d) => a + d.amount, 0), impacts: W.log.impacts.map((i) => i.surface) };
    };
    const legs = await shoot(0.45, 4);
    const torso = await shoot(1.45, 3);
    return { legs, torso, huskY: +e.position.y.toFixed(2), alive: e.alive };
  });
  console.log('  ', JSON.stringify(r));
  check(r.legs.damage === 0 && r.legs.impacts.length > 0 && r.legs.impacts.every((s) => s === 'water'), `rounds at the submerged legs splash at the surface, 0 damage (${JSON.stringify(r.legs)})`);
  check(r.torso.damage > 0, `rounds at the torso above the surface hit (${r.torso.damage} damage)`);
}

// ═════════════════════════════════════════════════════════════ the real level's water (W4b)
if (parts.has('level')) {
  console.log('══════════ level 6 water (wat6_wet / wat6_well) ══════════');
  await open('?level=6&autostart=1&nostory=1&noenemies=1&torch=inf');
  const have = await page.evaluate(() => window.__game.level.water.map((w) => w.id));
  if (!have.includes('wat6_wet')) console.log(`  SKIP level 6 has no wat6_wet yet (water: ${JSON.stringify(have)}) — runs once W4b's water is merged`);
  else {
    const r = await page.evaluate(async (GRID) => {
      const g = window.__game, P = g.player, W = window.__w1, V = W.V, THREE = W.THREE;
      const wet = g.level.water.find((w) => w.id === 'wat6_wet');
      const DOWN = new V(0, -1, 0);
      const cells = [], fails = [];
      let worst = 0;
      for (let x = wet.box.min.x + GRID / 2; x < wet.box.max.x; x += GRID) {
        for (let z = wet.box.min.z + GRID / 2; z < wet.box.max.z; z += GRID) {
          const hit = g.physics.raycastSolid(new V(x, wet.surface + 0.05, z), DOWN, wet.surface - wet.box.min.y + 0.5);
          if (!hit || hit.normal.y < 0.5) continue;
          const d = wet.surface - hit.point.y;
          if (d < 0.1 || d > wet.stand) continue;
          // the capsule must fit: a cell whose feet point is inside a collider (a kerb face) is no cell
          const fit = !g.physics.raycastSolid(new V(x, hit.point.y + 0.4, z), new V(0, 1, 0), 1.2);
          if (!fit) continue;
          cells.push([x, hit.point.y, z]);
          let best = null;
          for (let k = 0; k < 16 && !best; k++) {
            const res = P.debug.walkOut(x, hit.point.y + 0.02, z, (k / 16) * Math.PI * 2, 10, true);
            if (res.dry) best = res;
          }
          if (!best) fails.push([+x.toFixed(2), +z.toFixed(2), +d.toFixed(2)]);
          else worst = Math.max(worst, best.t);
        }
      }
      // the rescue from a debug teleport into the well
      const well = g.level.water.find((w) => w.id === 'wat6_well');
      let rescue = null;
      if (well) {
        W.log.rescued.length = 0;
        const c = well.box.getCenter(new V());
        P.teleport(new V(c.x, well.surface - 2.0, c.z), 0, 0);
        const t0 = g.time; let minY = 99;
        while (g.time - t0 < 2.5 && !W.log.rescued.length) { await W.wait(0.02); minY = Math.min(minY, P.position.y); }
        const to = P.position.clone();
        const exits = ['mk6_lw_exit', 'mk6_le_exit', 'mk6_boss_safe'].map((n) => g.level.object(n)?.getWorldPosition(new V())).filter(Boolean);
        rescue = { rescued: W.log.rescued.length, minY: +minY.toFixed(2), killY: g.physics.killY, alive: P.alive, onExit: exits.some((e) => e.distanceTo(to) < 0.3), to: to.toArray().map((v) => +v.toFixed(2)), exits: exits.length };
        // sight from the safe marker's eye to a point 1 m under the well's surface
        const safe = g.level.object('mk6_boss_safe');
        rescue.los = safe ? g.physics.lineOfSight(safe.getWorldPosition(new V()).add(new V(0, 1.6, 0)), new V(c.x, well.surface - 1.0, c.z)) : null;
      }
      void THREE;
      return { cells: cells.length, fails, worst: +worst.toFixed(2), rescue };
    }, GRID);
    console.log('  ', JSON.stringify({ ...r, fails: r.fails.slice(0, 20) }));
    check(r.cells > 20, `water cells found over wat6_wet (${r.cells})`);
    check(r.fails.length === 0, `walk-out to dry floor ≤ 10 s from every cell (worst ${r.worst} s; ${r.fails.length} fail: ${JSON.stringify(r.fails.slice(0, 12))})`);
    if (r.rescue) {
      check(r.rescue.rescued === 1 && r.rescue.alive && r.rescue.minY > r.rescue.killY, `well: rescued once, alive, never below the kill height (min y ${r.rescue.minY})`);
      check(r.rescue.exits === 3 && r.rescue.onExit, `well: placed on an exit marker (${JSON.stringify(r.rescue.to)}, markers ${r.rescue.exits})`);
      check(r.rescue.los === false, `lineOfSight from mk6_boss_safe to under the well's surface is false (${r.rescue.los})`);
    } else check(false, 'wat6_well missing');
  }
}

await browser.close();
console.log(problems.length ? `\n${problems.length} problem(s)` : '\nall water cases ok');
process.exit(problems.length ? 1 : 0);
