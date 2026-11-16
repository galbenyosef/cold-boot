// Reachability / containment check (REVISION 5, R6 + REVISION 5.1).
// For each story phase of a level (the table in src/level/phases.ts / src/level/l2/phases.ts, applied through
// `level.applyPhase(id, { snap: true })`), flood-fill the space the player can reach with the REAL physics
// capsule (ctx.physics.moveBody, the controller's radius / heights / speeds / jump / crouch-in-air), riding
// conveyors (carry) and one-way doors as the level declares them (`level.reachHints`). Fails when a phase's
// forbidden region is touched, a goal region / goal interactable is not reached, or an interactable inside a
// forbidden region can be used (in range + clear line, the player module's R8 rule) or walked over (pickups)
// from a reachable spot. A stress pass repeats every phase with +0.6 m of extra step (standing on a wreck box)
// wherever a wreck can lie: on a flat floor, within 0.65 m above the floor of the room the node is in (each room's
// own floor and its extra floors — Deck 2, balconies, landings; stage 3a §8.9).
// Per level (§8.9): every room's region contains the point 0.9 m above its own floor (and above each extra floor);
// every trigger contains a reachable node (feet, inside its y range) in at least one phase; `level.selfTest()` is
// run when the level has one (the dev greybox). A phase may declare `check.expect: 'fail'` (a deliberate failing
// case: it passes only if a forbidden region IS reached) and `check.stressFloors` (floors that must get stress jumps).
//
// Usage: node scripts/check-reach.mjs [--url http://127.0.0.1:5173] [--level 1|2|all] [--phase D2] [--no-stress]
//        [--cell 0.4] [--jobs 4] [--verbose] [--greybox [deck2]]   (--phase takes a comma list;
//        --greybox runs the two-deck test greybox of src/level/dev/ instead of the levels)
// Writes shots/checks/reach-l<N>.json. Exit code 1 on any failure.
import { parseArgs, levelsOf, launch, bootLevel, writeJson } from './lib/check-common.mjs';

const args = parseArgs();
const base = args.url ?? 'http://127.0.0.1:5173';
const stress = !args['no-stress'];
const cell = Number(args.cell ?? 0.4);

/** In page: run one phase. Synchronous (the game loop does not run while it works). */
function runPhase(o) {
  const g = window.__game;
  const level = g.level, phys = g.physics;
  const V = g.camera.position.constructor;
  const phase = level.phases.find((p) => p.id === o.phase);
  level.applyPhase(o.phase, { snap: true });
  // auto doors stand open for the flood (they open for anyone who comes near); snap every stroke
  for (const d of level.doors) {
    if (!d.locked && d.auto) d.open();
    d.snap?.();
  }
  const machines = {};
  for (const [k, v] of Object.entries(phase.machines ?? {})) machines[k] = v;
  const running = (m) => machines[m] === 'active' || machines[m] === 'frenzy';
  const hints = level.reachHints ?? { carry: [], oneway: [] };
  const inBox = (b, x, y, z) => x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5];
  const carries = hints.carry.filter((c) => running(c.machine));
  const oneway = hints.oneway.filter((w) => running(w.machine) && !level.doors.find((d) => d.id === w.door)?.locked);
  const useOneway = phase.check.oneway !== false;

  // ── floors (§8.9): a room's own floor + its extra floors (balcony over a hall) where the node stands ──
  const roomList = level.rooms.map((r) => ({ b: r.bounds, floor: typeof r.floor === 'number' ? r.floor : r.bounds.min.y + 0.5, extra: r.floors ?? [] }));
  const floorUnder = (p) => {
    for (const r of roomList) {
      const b = r.b;
      if (p.x < b.min.x || p.x > b.max.x || p.z < b.min.z || p.z > b.max.z || p.y < b.min.y || p.y > b.max.y) continue;
      // the highest floor at or below the feet (the lowest one if the node is below them all: a pit)
      let best = -Infinity, low = r.floor;
      for (const f of [r.floor, ...r.extra.filter((e) => p.x >= e.box[0] && p.x <= e.box[1] && p.z >= e.box[2] && p.z <= e.box[3]).map((e) => e.y)]) {
        if (f <= p.y + 0.05 && f > best) best = f;
        low = Math.min(low, f);
      }
      return best === -Infinity ? low : best;
    }
    return 0; // outside every room: the ground (as before §8.9)
  };
  const trig = g.__triggers ?? [];
  const inTrig = (t, p) => p.x >= t.x0 && p.x <= t.x1 && p.z >= t.z0 && p.z <= t.z1 && p.y > (t.y0 ?? -1) && p.y < (t.y1 ?? 4);

  // ── controller constants (src/player/controller.ts MOVE) ──
  const R = 0.35, HS = 1.8, HC = 1.1, WALK = 3.6, SPRINT = 6.0, CROUCH = 1.8, EYE = 1.65, EYEC = 0.98;
  const G = phys.gravity; // negative
  const VJ = Math.sqrt(2 * -G * 1.0);
  const DT = 1 / 60;
  const body = { position: new V(), velocity: new V(), radius: R, height: HS, onGround: false };
  const UP = new V(0, 1, 0), tmp = new V(), tmp2 = new V();

  const canStand = (p) => {
    const r = R * 0.7;
    const offs = [0, 0, r, 0, -r, 0, 0, r, 0, -r];
    for (let i = 0; i < offs.length; i += 2) {
      tmp.set(p.x + offs[i], p.y + HC - 0.15, p.z + offs[i + 1]);
      if (phys.raycast(tmp, UP, HS - HC + 0.2)) return false;
    }
    return true;
  };
  const DOWN = new V(0, -1, 0);
  const wide = (p) => {
    for (const [ox, oz] of [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) {
      tmp.set(p.x + ox, p.y + 0.2, p.z + oz);
      const h = phys.raycast(tmp, DOWN, 0.35);
      if (!h || h.normal.y < 0.9) return false;
    }
    return true;
  };
  const carryAt = (p) => { for (const c of carries) if (inBox(c.box, p.x, p.y, p.z)) return c.v; return null; };

  /**
   * Simulate a move from p. kind: 'walk' | 'jump'. Returns the grounded end position (or null) and whether
   * the walk was blocked / dropped (an edge: worth jumping from).
   */
  let sims = 0;
  const simulate = (p, dx, dz, speed, crouched, kind, crouchAir, lift) => {
    sims++;
    body.position.copy(p); body.position.y += lift;
    body.height = crouched ? HC : HS;
    body.velocity.set(dx * speed, kind === 'jump' ? VJ : 0, dz * speed);
    body.onGround = kind !== 'jump' && lift === 0;
    let crouchNow = crouched, airborne = kind === 'jump' || lift > 0, t = 0, still = 0;
    const maxWalk = 0.6 / Math.max(speed, 0.1);
    const x0 = p.x, z0 = p.z;
    for (; t < 2.2; t += DT) {
      const walking = kind === 'walk' && t < maxWalk;
      if (body.onGround) {
        if (walking) { body.velocity.x = dx * speed; body.velocity.z = dz * speed; }
        else if (kind === 'walk') { body.velocity.x *= 0.5; body.velocity.z *= 0.5; }
        if (body.velocity.y <= 0) body.velocity.y = -2;
        const cv = carryAt(body.position);
        if (cv) { body.position.x += cv[0] * DT; body.position.z += cv[2] * DT; }
      }
      if (airborne && crouchAir && !crouchNow && body.velocity.y < 0.8) {
        crouchNow = true; body.height = HC; body.position.y += HS - HC; // controller: legs pulled up in the air
      }
      const py = body.position.y, px = body.position.x, pz = body.position.z;
      phys.moveBody(body, DT);
      if (!body.onGround) airborne = true;
      if (kind === 'jump') { if (t > 0.05 && body.onGround) break; }
      else if (t >= maxWalk && body.onGround) break;
      if (Math.abs(body.position.x - px) + Math.abs(body.position.z - pz) + Math.abs(body.position.y - py) < 1e-4) { if (++still > 3 && body.onGround) break; } else still = 0;
      if (body.position.y < -5) return { end: null };
    }
    if (!body.onGround) return { end: null };
    const end = body.position.clone();
    const moved = Math.hypot(end.x - x0, end.z - z0);
    return { end, crouched: crouchNow, blocked: moved < 0.3, dropped: end.y < p.y - 0.25 };
  };

  // ── flood fill ──
  const key = (p) => `${Math.round(p.x / o.cell)},${Math.round(p.z / o.cell)},${Math.round(p.y / 0.3)}`;
  const nodes = []; // {p, parent, stand, via}
  const seen = new Map();
  const add = (p, parent, via) => {
    const k = key(p);
    if (seen.has(k)) return;
    const n = { p, parent, stand: canStand(p), via };
    seen.set(k, nodes.length);
    nodes.push(n);
  };
  // settle the start on the ground
  const s0 = new V(...phase.check.start);
  const st = simulate(s0, 0, 0, 0, false, 'walk', false, 0);
  add(st.end ?? s0, -1, 'start');
  const DIRS = [];
  for (let i = 0; i < 16; i++) DIRS.push([Math.sin((i * Math.PI) / 8), -Math.cos((i * Math.PI) / 8)]);
  const lifts = o.stress ? [0, 0.6] : [0];
  const boxFloors = {}; // floor y → nodes a wreck box was tried from (stress pass)
  let rides = 0;
  const t0 = performance.now();
  for (let qi = 0; qi < nodes.length && nodes.length < o.maxNodes; qi++) {
    const n = nodes[qi];
    const edgeDirs = new Set();
    for (let di = 0; di < 16; di += 2) {
      const [dx, dz] = DIRS[di];
      const r = simulate(n.p, dx, dz, n.stand ? WALK : CROUCH, !n.stand, 'walk', false, 0);
      if (r.end) add(r.end, qi, 'walk');
      if (!r.end || r.blocked || r.dropped) { edgeDirs.add(di); edgeDirs.add((di + 15) % 16); edgeDirs.add((di + 1) % 16); }
      if (n.stand && (!r.end || r.blocked)) {
        // something low ahead: try crawling under it
        const c = simulate(n.p, dx, dz, CROUCH, true, 'walk', false, 0);
        if (c.end) add(c.end, qi, 'crawl');
      }
    }
    // a wreck box (stress pass) can only lie where there is floor for it: a flat 0.6 m footprint under the node
    // (wrecks lie where things die: on floors, the belt, the apron — not on top of cabinets); "floor" = the floor
    // of the room the node is in (Deck 2 too), not y 0
    let boxOk = false;
    if (o.stress && n.stand) {
      const f = floorUnder(n.p);
      boxOk = n.p.y - f < 0.65 && wide(n.p);
      if (boxOk) { const k = String(+f.toFixed(2)); boxFloors[k] = (boxFloors[k] ?? 0) + 1; }
    }
    if (n.stand) for (const di of edgeDirs) {
      const [dx, dz] = DIRS[di];
      for (const lift of boxOk ? lifts : [0]) for (const sp of [SPRINT, 2.0]) for (const ca of [false, true]) {
        const r = simulate(n.p, dx, dz, sp, false, 'jump', ca, lift);
        if (r.end) add(r.end, qi, lift ? 'jump+box' : ca ? 'crouch-jump' : 'jump');
      }
    }
    // one-way edges (d2_exit): a body inside within 2 m is let out
    for (const w of oneway) if (inBox(w.from, n.p.x, n.p.y, n.p.z)) { rides++; if (useOneway) add(new V(...w.to), qi, `oneway:${w.door}`); }
    if (performance.now() - t0 > o.budgetMs) break;
  }
  const ms = performance.now() - t0;

  // ── regions ──
  const regions = level.regions;
  const regionsAt = (p) => {
    const out = [];
    tmp2.set(p.x, p.y + 0.9, p.z);
    for (const [id, boxes] of Object.entries(regions)) for (const b of boxes) if (b.containsPoint(tmp2)) { out.push(id); break; }
    return out;
  };
  const pathOf = (i) => { const out = []; let k = i, guard = 0; while (k >= 0 && guard++ < 400) { out.push([+nodes[k].p.x.toFixed(2), +nodes[k].p.y.toFixed(2), +nodes[k].p.z.toFixed(2), nodes[k].via]); k = nodes[k].parent; } return out.reverse(); };
  const reached = new Map(); // region -> first node index
  nodes.forEach((n, i) => { for (const r of regionsAt(n.p)) if (!reached.has(r)) reached.set(r, i); });
  const forbidden = phase.check.forbid.filter((r) => reached.has(r)).map((r) => {
    const i = reached.get(r);
    const path = pathOf(i);
    return { region: r, at: path[path.length - 1], path: path.length > 24 ? [...path.slice(0, 4), ['…'], ...path.slice(-18)] : path };
  });
  const goals = phase.check.goal.map((r) => ({ region: r, ok: r === 'ride' ? rides > 0 : reached.has(r) }));

  // ── interactables: goals usable; nothing inside a forbidden region usable / walk-over-able ──
  const usable = (it) => {
    const r = it.radius ?? 2.2;
    for (const n of nodes) {
      for (const eh of n.stand ? [EYE, EYEC] : [EYEC]) {
        tmp.set(n.p.x, n.p.y + eh, n.p.z);
        tmp2.copy(it.position).sub(tmp);
        const d = tmp2.length();
        if (d > r) continue;
        if (d <= 0.3 || !phys.raycast(tmp, tmp2.multiplyScalar(1 / d), d - 0.4)) return { node: n, eye: eh };
      }
      if (it.kind === 'pickup') {
        const dx = n.p.x - it.position.x, dz = n.p.z - it.position.z, dy = it.position.y - n.p.y;
        if (dx * dx + dz * dz < 1.0 && dy > -0.6 && dy < 1.4) return { node: n, eye: 'walk-over' };
      }
    }
    return null;
  };
  const all = g.interactables.all.filter((it) => it.kind !== 'door');
  const use = (phase.check.use ?? []).map((id) => {
    const it = all.find((x) => x.id === id);
    if (!it) return { id, ok: false, why: 'no such interactable' };
    const u = usable(it);
    return { id, ok: !!u, from: u ? [u.node.p.x, u.node.p.y, u.node.p.z].map((v) => +v.toFixed(2)) : null };
  });
  const leaks = [];
  for (const it of all) {
    const rs = regionsAt(new V(it.position.x, it.position.y - 0.9, it.position.z)).filter((r) => phase.check.forbid.includes(r));
    if (!rs.length) continue;
    const u = usable(it);
    if (u) leaks.push({ id: it.id, kind: it.kind, region: rs[0], pos: [it.position.x, it.position.y, it.position.z].map((v) => +v.toFixed(2)), from: [u.node.p.x, u.node.p.y, u.node.p.z].map((v) => +v.toFixed(2)), how: u.eye });
  }
  // ── triggers holding a reachable node (feet, inside the y range) ──
  const triggers = trig.filter((t) => nodes.some((n) => inTrig(t, n.p))).map((t) => t.id);
  const stressMissing = o.stress ? (phase.check.stressFloors ?? []).filter((f) => !boxFloors[String(+f.toFixed(2))]) : [];
  return {
    phase: phase.id, label: phase.label, stress: o.stress, nodes: nodes.length, sims, ms: Math.round(ms), truncated: nodes.length >= o.maxNodes || ms > o.budgetMs,
    reached: [...reached.keys()].sort(), forbidden, goals, use, leaks, rides, triggers, boxFloors, stressMissing, expect: phase.check.expect ?? null,
  };
}

/** In page, once per level (§8.9): every room region contains its own floor + 0.9; the level's self-test. */
function checkLevel() {
  const g = window.__game, level = g.level;
  const V = g.camera.position.constructor;
  const problems = [];
  for (const r of level.rooms) {
    const b = r.bounds, floor = typeof r.floor === 'number' ? r.floor : b.min.y + 0.5;
    const pts = [[(b.min.x + b.max.x) / 2, floor, (b.min.z + b.max.z) / 2, 'floor']];
    for (const f of r.floors ?? []) pts.push([(f.box[0] + f.box[1]) / 2, f.y, (f.box[2] + f.box[3]) / 2, 'extra floor']);
    const boxes = level.regions[r.id];
    for (const [x, y, z, what] of pts) {
      const p = new V(x, y + 0.9, z);
      if (!boxes || !boxes.some((q) => q.containsPoint(p))) problems.push(`region "${r.id}" does not contain its ${what} + 0.9 m (${x.toFixed(2)}, ${(y + 0.9).toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
  const self = typeof level.selfTest === 'function' ? level.selfTest() : null;
  return { problems, rooms: level.rooms.map((r) => `${r.id}@${typeof r.floor === 'number' ? r.floor : r.bounds.min.y + 0.5}`), triggers: (g.__triggers ?? []).map((t) => t.id), self };
}

const browser = await launch();
let failures = 0;
const jobsN = Number(args.jobs ?? 4);
const print = (r) => {
  let bad = r.forbidden.length || r.goals.some((x) => !x.ok) || r.use.some((x) => !x.ok) || r.leaks.length || r.truncated || r.stressMissing.length;
  let tag = bad ? 'FAIL' : ' ok ', note = '';
  if (r.expect === 'fail') {
    // the deliberate failing case: it must report its forbidden region, else the check cannot fail
    const failedAsMeant = r.forbidden.length > 0;
    tag = failedAsMeant ? ' ok ' : 'FAIL'; bad = !failedAsMeant;
    note = failedAsMeant ? '  [EXPECTED FAIL: failed as it must]' : '  [EXPECTED FAIL, but it PASSED: the check cannot see this forbidden region]';
  }
  if (bad) failures++;
  console.log(`${tag} ${r.stress ? '[stress +0.6]' : '[normal]     '} ${r.phase.padEnd(7)} ${r.label}  — ${r.nodes} nodes, ${(r.ms / 1000).toFixed(1)} s${r.truncated ? ' TRUNCATED' : ''}${note}`);
  for (const f of r.stressMissing) console.log(`       stress: no wreck box tried on floor y ${f}`);
  for (const f of r.forbidden) console.log(`       forbidden region "${f.region}" reached at (${f.at.slice(0, 3).join(', ')}) via ${f.at[3]}\n         path: ${f.path.map((q) => q.length < 3 ? '…' : `(${q[0]},${q[1]},${q[2]})${q[3] !== 'walk' ? ':' + q[3] : ''}`).join(' → ')}`);
  for (const x of r.goals.filter((x) => !x.ok)) console.log(`       goal region "${x.region}" NOT reached`);
  for (const x of r.use.filter((x) => !x.ok)) console.log(`       goal interactable "${x.id}" NOT usable${x.why ? ' (' + x.why + ')' : ''}`);
  for (const l of r.leaks) console.log(`       interactable "${l.id}" (${l.kind}) in sealed "${l.region}" usable from (${l.from.join(', ')}) [${l.how}]`);
  if (args.verbose) console.log(`       reached: ${r.reached.join(' ')}`);
  if (args.verbose && r.stress) console.log(`       wreck boxes per floor: ${Object.entries(r.boxFloors).map(([k, v]) => `y ${k}: ${v}`).join(', ')}`);
};
const greybox = args.greybox ? (args.greybox === '1' ? 'deck2' : args.greybox) : null;
for (const level of greybox ? [greybox] : levelsOf(args)) {
  const boot = () => (greybox ? bootLevel(browser, base, 1, { query: `&greybox=${greybox}` }) : bootLevel(browser, base, level));
  const first = await boot();
  const lv = await first.evaluate(checkLevel);
  console.log(`\n=== LEVEL ${level}: rooms ${lv.rooms.join(' ')} ===`);
  if (lv.problems.length) { failures++; for (const p of lv.problems) console.log(`FAIL ${p}`); }
  else console.log(` ok  every room region contains its floor + 0.9 m (${lv.rooms.length} rooms)`);
  if (lv.self) {
    if (!lv.self.ok) failures++;
    console.log(`${lv.self.ok ? ' ok ' : 'FAIL'} level self-test:`);
    for (const l of lv.self.lines) if (args.verbose || l.startsWith('FAIL') || !lv.self.ok || greybox) console.log(`       ${l}`);
  }
  const phases = await first.evaluate(() => (window.__game.level.phases ?? []).filter((p) => p.check).map((p) => p.id));
  const list = args.phase ? phases.filter((p) => args.phase.split(',').includes(p)) : phases;
  console.log(`\n=== REACH level ${level}: phases ${list.join(' ')} (${jobsN} pages in parallel) ===`);
  const jobs = [];
  for (const pass of stress ? [false, true] : [false]) for (const id of list) jobs.push({ phase: id, stress: pass, cell, maxNodes: 60000, budgetMs: 300000 });
  const pages = [first];
  for (let i = 1; i < Math.min(jobsN, jobs.length); i++) pages.push(await boot());
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(pages.map(async (page) => {
    while (next < jobs.length) {
      const k = next++;
      for (let attempt = 0; ; attempt++) {
        try { results[k] = await page.evaluate(runPhase, jobs[k]); break; } catch (e) {
          // the dev server reloaded the page (a source file changed): wait for the game and run the job again
          if (attempt > 3) throw e;
          console.log(`  (page reloaded during ${jobs[k].phase}; retrying)`);
          await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000 }).catch(() => {});
          await page.waitForTimeout(2500);
        }
      }
      print(results[k]);
    }
  }));
  // §8.9: every trigger holds a reachable node in some phase (normal pass; a phase run with --phase sees only its own)
  if (!args.phase) {
    const hit = new Set(results.filter((r) => !r.stress && r.expect !== 'fail').flatMap((r) => r.triggers));
    const missing = lv.triggers.filter((t) => !hit.has(t));
    if (missing.length) { failures++; console.log(`FAIL triggers with no reachable node (feet inside the trigger and its y range) in any phase: ${missing.join(' ')}`); }
    else console.log(` ok  every trigger (${lv.triggers.length}) holds a reachable node in some phase`);
  }
  console.log('json:', writeJson('reach', level, { level, cell, checks: lv, results }));
  for (const p of pages) await p.close();
}
await browser.close();
console.log(failures ? `\nREACH: ${failures} failing phase run(s)` : '\nREACH: all phases pass');
process.exit(failures ? 1 : 0);
