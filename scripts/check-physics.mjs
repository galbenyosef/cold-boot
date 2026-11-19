// Physics contract cases of stage 3d (docs/plans/stage-3d.md §8.1, D14, S5, B6, S8g; task K). Fast: one page.
//   node scripts/check-physics.mjs [--url http://127.0.0.1:5173] [--stair 0]
// On a static build (vite build + vite preview). Exit 1 on any failure.
//   sets     — a ray through a `rayOnly` quad stops at it (surface 'water'), a capsule falls through it to the floor,
//              lineOfSight stops at it, `raycastSolid` down over it hits the floor; a capsule stops at a `moveOnly` box,
//              a ray / lineOfSight pass it, `raycastSolid` hits it, an up-ray from a crouched head under a move-only bar
//              hits it (what `Controller.canStand` will use, W1); a scene with neither flag bakes one set
//   kill     — default kill height −30; with `setKillY(−36)` a body at −34 is not put back and falls on; below −36 it is
//   seam     — a capsule walking up a 28° slope slab (two triangles per face, `holdSlopes`) across its diagonal keeps its
//              line (|Δx| < 2 cm); the slab's seams are found
//   region   — `Interactable.requireRegion` on the real level 6's `he6_main` region: `allowedAt` / `pick` with the feet
//              inside / outside the region; unknown id (the level's own interactables are disabled meanwhile)
//   live     — the real level 6 boots: killY −36 (physics = `Level.killY`), water volumes, a dock arena, two collider
//              sets (ray-only water / move-only guards), and its own water quads are ray-only (a ray down over the
//              well stops at the surface, `raycastSolid` does not)
//   stair    — level 5: the player walks straight up STAIR5_W on three lines (x 25.9 / 26.4 / 26.9): |Δx| < 5 cm
//              (the 3c drift, ≈ 0.6–1.1 m west before K's seam fix); `--stair 0` skips it
//   (W3c adds: a nav shortcut over the wet dock never ends in the channel — once its nav is merged)
import { launch, parseArgs } from './lib/check-common.mjs';

const args = parseArgs();
const base = (args.url ?? process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const problems = [];
const check = (cond, m) => { if (cond) console.log(`  ok   ${m}`); else { problems.push(m); console.log(`  FAIL ${m}`); } };

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => { problems.push(`pageerror ${e.message}`); console.log(`  [pageerror] ${e.message}`); });
async function open(q) {
  await page.goto(`${base}/${q}`);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
  await page.waitForTimeout(500);
}

console.log('══════════ physics (level 6 page) ══════════');
await open('?level=6&autostart=1&nostory=1&noenemies=1');
const r = await page.evaluate(() => {
  const g = window.__game;
  const { physics: P, THREE } = g.physics._fresh();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const DOWN = V(0, -1, 0), UP = V(0, 1, 0);
  const mat = new THREE.MeshBasicMaterial();
  const box = (x0, y0, z0, x1, y1, z1, ud = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    Object.assign(m.userData, ud);
    m.updateMatrixWorld(true);
    return m;
  };
  const body = (x, y, z) => ({ position: V(x, y, z), velocity: V(0, 0, 0), radius: 0.35, height: 1.8, onGround: false });
  const run = (b, s, vx = 0, vz = 0) => { for (let i = 0; i < s * 60; i++) { if (vx || vz) { b.velocity.x = vx; b.velocity.z = vz; } P.moveBody(b, 1 / 60); } return b; };
  const out = {};

  // ── sets: floor y 0, water quad at y 0.5 (rayOnly), a move-only wall at x 3, a move-only bar at y 1.3 over x −6
  P.build([
    box(-10, -0.3, -10, 10, 0, 10, { surface: 'concrete' }),
    box(-5, 0.49, -5, 5, 0.5, 5, { rayOnly: true, surface: 'water' }),
    box(3, 0, -5, 3.1, 2.4, 5, { moveOnly: true }),
    box(-7, 1.3, -1, -5, 1.36, 1, { moveOnly: true }),
  ]);
  const hw = P.raycast(V(0, 2, 0), DOWN, 5);
  out.rayWater = hw ? { y: +hw.point.y.toFixed(3), surface: hw.surface } : null;
  const hs = P.raycastSolid(V(0, 2, 0), DOWN, 5);
  out.solidFloor = hs ? +hs.point.y.toFixed(3) : null;
  out.losWater = P.lineOfSight(V(0, 1.5, 0), V(0, 0.2, 0.3));
  out.fall = +run(body(0, 1.5, 0), 1.5).position.y.toFixed(3);
  const wall = run(body(1, 0.05, 0), 2, 3, 0);
  out.wallStop = +wall.position.x.toFixed(3);
  const hr = P.raycast(V(0, 1, 2), V(1, 0, 0), 8);
  out.rayThroughWall = hr ? +hr.point.x.toFixed(2) : null;
  out.losWall = P.lineOfSight(V(2, 1, 2), V(4, 1, 2));
  const hsw = P.raycastSolid(V(0, 1, 2), V(1, 0, 0), 8);
  out.solidWall = hsw ? +hsw.point.x.toFixed(2) : null;
  const up = P.raycastSolid(V(-6, 1.08, 0), UP, 0.8);
  out.headroomBar = up ? +up.point.y.toFixed(2) : null;
  out.headroomRay = !!P.raycast(V(-6, 1.08, 0), UP, 0.8);
  out.split = P._sets.split;

  // ── kill height
  out.killDefault = P.killY;
  P.build([box(-1, -0.3, -1, 1, 0, 1)]);
  out.oneSet = !P._sets.split;
  const k0 = run(body(20, -31, 20), 1 / 60);
  out.resetAt31 = +k0.position.y.toFixed(2);
  P.setKillY(-36);
  const kb = body(20, -34, 20);
  P.moveBody(kb, 1 / 60);
  out.at34 = +kb.position.y.toFixed(3);
  let minY = kb.position.y, reset = false;
  for (let i = 0; i < 120 && !reset; i++) { P.moveBody(kb, 1 / 60); if (kb.position.y > 0) reset = true; else minY = Math.min(minY, kb.position.y); }
  out.kill36 = { minY: +minY.toFixed(3), reset };
  P.setKillY(NaN); out.killNaN = P.killY;

  // ── seam: a 2 × 10 m slab at 28°, box faces split along their diagonals
  {
    const ang = 28 * Math.PI / 180, len = 10;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, len), mat);
    slab.position.set(0, Math.sin(ang) * len / 2 - 0.1, -Math.cos(ang) * len / 2);
    slab.rotation.x = ang;
    slab.userData.holdSlopes = true;
    slab.updateMatrixWorld(true);
    P.build([box(-10, -0.3, -15, 10, 0, 3), slab]);
    out.seams = P._sets.seams;
    const walk = (x) => {
      const b = body(x, 0.6, -0.8);
      run(b, 0.3);
      const x0 = b.position.x;
      run(b, 2.0, 0, -3.6);
      return { x, dx: +(b.position.x - x0).toFixed(4), y: +b.position.y.toFixed(2) };
    };
    out.slope = [-0.5, 0, 0.5].map(walk);
    // negative control: the same walks with the seam rule off must drift (the case tests what it says)
    P._seamFix = false;
    out.slopeOff = [-0.5, 0, 0.5].map(walk);
    P._seamFix = true;
  }

  // ── requireRegion (the live registry; the real level 6's head-end floor region `he6_main`, x 2…22, z −180…−160)
  {
    const reg = g.interactables;
    out.regionKnown = !!g.level.regions?.he6_main;
    const was = reg.all.map((i) => [i, i.enabled]);
    for (const [i] of was) i.enabled = false;                          // the level's own interactables must not win the pick
    const mk = (id, region) => reg.add({ id, kind: 'test', position: V(12, 1.2, -171.5), prompt: 'test', enabled: true, requireRegion: region });
    const a = mk('k_test_in', 'he6_main'), z = mk('k_test_none', 'no_such_region');
    const eye = V(12, 1.6, -170), fwd = V(0, -0.27, -1).normalize();
    out.region = {
      inside: reg.allowedAt(a, V(12, 0, -168)), outside: reg.allowedAt(a, V(40, 0, -168)), unknown: reg.allowedAt(z, V(12, 0, -168)),
      pickIn: reg.pick(eye, fwd, V(12, 0, -170))?.id ?? null,
      pickNoFeet: reg.pick(eye, fwd)?.id ?? null,
      pickOut: reg.pick(eye, fwd, V(40, 0, -170))?.id ?? null,
    };
    reg.remove('k_test_in'); reg.remove('k_test_none');
    for (const [i, e] of was) i.enabled = e;
  }

  // ── the real level 6 (the live physics, not the fresh one)
  {
    const LP = g.physics, w = g.level.water[0];
    let wet = null;
    if (w) {
      const b = w.box ?? w.bounds ?? null;
      const cx = b ? (b.min.x + b.max.x) / 2 : null, cz = b ? (b.min.z + b.max.z) / 2 : null;
      const sy = typeof w.surface === 'number' ? w.surface : (b ? b.max.y : null);
      if (cx !== null && sy !== null) {
        const o = V(cx, sy + 1.5, cz);
        const hr = LP.raycast(o, DOWN, 40), hs = LP.raycastSolid(o, DOWN, 40);
        wet = { surfaceY: +sy.toFixed(2), ray: hr ? +hr.point.y.toFixed(2) : null, solid: hs ? +hs.point.y.toFixed(2) : null };
      }
    }
    out.live = { killY: LP.killY, levelKillY: g.level.killY, water: g.level.water.length, waterKeys: w ? Object.keys(w) : [], dock: !!g.level.dock, split: LP._sets.split, wet };
  }
  return out;
});
console.log('  ', JSON.stringify(r));
check(r.rayWater && Math.abs(r.rayWater.y - 0.5) < 0.02 && r.rayWater.surface === 'water', `rayOnly: a ray stops at the water quad (${JSON.stringify(r.rayWater)})`);
check(r.solidFloor !== null && Math.abs(r.solidFloor) < 0.02, `raycastSolid down over water hits the floor (${r.solidFloor})`);
check(r.losWater === false, 'lineOfSight stops at the water surface');
check(Math.abs(r.fall) < 0.03, `a capsule falls through the water quad onto the floor (feet ${r.fall})`);
check(r.wallStop < 2.66 && r.wallStop > 2.5, `moveOnly: a capsule stops at the move-only wall (x ${r.wallStop})`);
check(r.rayThroughWall === null || r.rayThroughWall > 3.2, `moveOnly: a ray passes the wall (${r.rayThroughWall})`);
check(r.losWall === true, 'lineOfSight passes the move-only wall');
check(r.solidWall !== null && Math.abs(r.solidWall - 3) < 0.02, `raycastSolid hits the move-only wall (${r.solidWall})`);
check(r.headroomBar !== null && Math.abs(r.headroomBar - 1.3) < 0.02 && r.headroomRay === false, `headroom under a move-only bar: raycastSolid up-ray hits it (${r.headroomBar}), raycast passes (canStand is W1's)`);
check(r.split === true && r.oneSet === true, 'two collider sets only when a flag is present');
check(r.killDefault === -30 && r.resetAt31 === 2, `default kill height −30 (a body at −31 is put back: y ${r.resetAt31})`);
check(r.at34 < -33.9 && r.at34 > -34.2, `setKillY(−36): a body at −34 is not put back (y ${r.at34})`);
check(r.kill36.reset && r.kill36.minY < -35.5 && r.kill36.minY >= -36.0, `setKillY(−36): it falls below −35.5 and is put back only past −36 (min ${r.kill36.minY})`);
check(r.killNaN === -30, 'setKillY(NaN) → −30');
check(r.seams >= 2, `slope seams found (${r.seams})`);
for (const s of r.slope) check(Math.abs(s.dx) < 0.02 && s.y > 0.9, `seam: up the 28° slab on x ${s.x}: Δx ${s.dx}, reached y ${s.y}`);
check(r.slopeOff.some((s) => Math.abs(s.dx) > 0.1), `seam control: with the rule off the walks drift (Δx ${r.slopeOff.map((s) => s.dx).join(' / ')})`);
check(r.regionKnown, 'level 6 has the region he6_main');
check(r.region.inside && !r.region.outside && !r.region.unknown, `requireRegion allowedAt: inside ${r.region.inside}, outside ${r.region.outside}, unknown ${r.region.unknown}`);
check(r.region.pickIn === 'k_test_in' && r.region.pickNoFeet === null && r.region.pickOut === null, `requireRegion pick: in ${r.region.pickIn}, no feet ${r.region.pickNoFeet}, out ${r.region.pickOut}`);
check(r.live.killY === r.live.levelKillY && r.live.killY === -36, `level 6: killY ${r.live.killY} (level ${r.live.levelKillY}) = −36`);
check(r.live.water > 0 && r.live.dock === true, `level 6: water volumes ${r.live.water}, a dock arena ${r.live.dock}`);
check(r.live.split === true, 'level 6: two collider sets (ray-only water / move-only guards)');
check(r.live.wet && r.live.wet.ray !== null && Math.abs(r.live.wet.ray - r.live.wet.surfaceY) < 0.1 && (r.live.wet.solid === null || r.live.wet.solid < r.live.wet.surfaceY - 0.1),
  `level 6: a ray down over the first water volume stops at its surface, raycastSolid goes below it (${JSON.stringify(r.live.wet)}; keys ${r.live.waterKeys.join(',')})`);

if (args.stair !== '0') {
  console.log('══════════ STAIR5_W walk (level 5) ══════════');
  await open('?level=5&autostart=1&nostory=1&noenemies=1');
  const w = await page.evaluate(() => {
    const g = window.__game, V = g.player.position.constructor, DT = 1 / 60;
    const step = (n) => { for (let i = 0; i < n; i++) { g.time += DT; g.player.update(DT); g.level.update(DT); } };
    const out = [];
    for (const x of [25.9, 26.4, 26.9]) {
      g.player.teleport(new V(x, 0.05, -46.5), Math.PI, 0);
      g.player.debug.move(0, 0, false); step(20);
      const p0 = g.player.position.clone();
      g.player.debug.move(1, 0, false);
      let maxDx = 0;
      for (let i = 0; i < 240; i++) { step(1); maxDx = Math.max(maxDx, Math.abs(g.player.position.x - p0.x)); }
      g.player.debug.move(0, 0, false); step(5);
      out.push({ x, maxDx: +maxDx.toFixed(3), top: +g.player.position.y.toFixed(2), z: +g.player.position.z.toFixed(2) });
    }
    return { out, killY: g.physics.killY, split: g.physics._sets.split, seams: g.physics._sets.seams };
  });
  for (const s of w.out) check(s.maxDx < 0.05 && s.top > 4.7, `STAIR5_W up on x ${s.x}: max |Δx| ${s.maxDx}, top y ${s.top} (z ${s.z})`);
  check(w.killY === -30 && w.split === false, `level 5: killY ${w.killY}, one collider set (seams ${w.seams})`);
}

await browser.close();
console.log(problems.length ? `\n${problems.length} problem(s)` : '\nall physics cases ok');
process.exit(problems.length ? 1 : 0);
