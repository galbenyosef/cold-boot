// The dock loader (stage 3d §5.6.10, W3b). On a static build (vite build + vite preview).
//   node scripts/check-loader.mjs [--url http://127.0.0.1:4173] [--only telegraph,fair,window,damage,stages,cargo,guard,lit,cap,death,restore,cost,cheese,wreck]
//        [--trials N]
// Default: the GREYBOX CHAMBER (`?level=6&nostory=1&loaderArena=1`, src/enemies/loader/stubrig.ts `buildLoaderArena`:
// the moon pool's decks, well, coaming + guard, cage, galleries, rails and six cargo slots as a `DockArena`) — built only
// while the level has no dock of its own; on a level WITH a dock the same cases run against the real one (spots taken
// from the arena table below must then stand on its decks). The game loop is stepped synchronously in the page at 60 Hz
// (player, level, enemies, fx). The player is kept alive (health topped up; every hit logged).
//   1 telegraph  every SLAM: track ≥ 0.9 s + lock 0.8 s before the drop; the ring stops at the lock; `loader_jaws` once
//                per slam (rams alive); no damage outside r 1.8 + 0.35
//   2 fair       a bot walking straight away from rest at the lock start is never hit (N trials, dock + knee-deep wet
//                dock); every lock point is a `dock.target` point
//   3 window     after a slam the rams are ×1 through the recovery (2.4 s, stage 3 1.8 s) and ×0 after; a debug aim-lock
//                carbine at 10 m kills a ram inside one window
//   4 damage     floods 3 carbine hits; rams ×0 retracted (`armour_clank` ≤ 1 per 0.3 s, `enemy:damaged` amount 0 with the
//                part); pod ×0 shut; body ×0.05
//   5 stages     setStage(2) → boss:stage 2; first ram → 2; both rams → 3 + cowl open (pod ×1)
//   6 cargo      SHIFT / DROP: outline ≥ 1.6 s before every set-down / release; only into free slots; never from a gallery
//   8 guard      unreachable (gallery) ≥ 2 s → parked at `dock.park`; leaves when he steps onto a target deck
//   9 lit        floodLit while the floods are on him; false once every flood is out
//  10 cap        ≤ 40 health + armour per 2 s (every window of the run); `enemy:damaged` never for another enemy
//  12 death      pod → enemy:died once; the grab ends in the well (bottom under the water, x/z in the well); marks out
//  13 restore    snapshot → restore round trip (parts, stage, slots), grace 3.0 s in guard; boss:stage re-emitted
//  14 cost       loader update ≤ 0.25 ms mean (in page); rays ≤ 20 / s
//  15 cheese     a bot in the cage and on the east gallery firing at the rams and the pod for 60 s: 0 damage to either
//  B6 wreck      a body that dies in water deeper than 0.6 m makes no wreck box
// Exit 1 on any failure.
import { launch, parseArgs } from './lib/check-common.mjs';

const args = parseArgs();
const base = (args.url ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const only = args.only ? new Set(args.only.split(',')) : null;
const want = (k) => !only || only.has(k);
const TRIALS = +(args.trials ?? 20);
const problems = [];
const bad = (m) => { problems.push(m); console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);
const check = (cond, m) => (cond ? ok(m) : bad(m));
const f2 = (x) => (typeof x === 'number' ? x.toFixed(2) : String(x));

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => bad(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.log(`  [console.error] ${m.text().slice(0, 200)}`); });
const ev = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${base}/?level=6&autostart=1&nostory=1&loaderArena=1&torch=inf`);
await page.waitForFunction(() => window.__game?.ready && window.__game.state === 'playing', null, { timeout: 120000 });
await page.waitForTimeout(600);
const installed = await ev(() => {
  const g = window.__game, E = g.enemies, D = E.debug;
  if (!D?.loaderArena) return false;
  const A = D.loaderArena(), V = g.camera.position.constructor, DT = 1 / 60, p = g.player;
  const S = (window.__L = { A, V, DT, hurt: [], sounds: [], events: [], n: 0 });
  g.events.on('player:damaged', (e) => { S.hurt.push({ t: E.world.time, a: e.amount + (e.absorbed ?? 0) }); p.health = 100; });
  for (const k of ['enemy:damaged', 'enemy:part-destroyed', 'enemy:died', 'boss:stage']) g.events.on(k, (e) => S.events.push({ k, t: E.world.time, type: e.type, id: e.id, part: e.part, amount: e.amount, stage: e.stage }));
  const play = g.audio.play.bind(g.audio);
  g.audio.play = (id, o) => { S.sounds.push({ t: E.world.time, id }); return play(id, o); };
  S.step = (n = 1, each) => { for (let i = 0; i < n; i++) { g.time += DT; p.update(DT); g.level.update(DT); E.update(DT); g.fx.update(DT); if (each && each(i) === true) return true; } return false; };
  S.secs = (s, each) => S.step(Math.round(s / DT), each);
  S.place = (q, yaw = 0) => { p.teleport(new V(q[0], q[1] + 0.05, q[2]), yaw, 0); p.debug.move(0, 0, false); S.step(10); };
  S.spawn = (pose) => { for (const e of [...E.all]) if (e.type === 'loader') E.removeGroup(e.group); const grp = `gl_${++S.n}`; const e = D.spawnLoader(grp, pose); S.grp = grp; S.L = e; S.B = E.boss(grp); D.loaderLog(true); return e.id; };
  S.row = () => D.loader(S.grp);
  S.log = () => D.loaderLog();
  S.reset = () => { S.hurt.length = 0; S.sounds.length = 0; S.events.length = 0; D.loaderLog(true); p.debug.move(0, 0, false); p.debug.crouch(false); p.debug.aimLock(null); p.debug.hold(false); p.health = 100; p.debug.setArmor(0); };
  /** Damage a part directly (a synthetic hit through the manager). */
  S.hit = (part, amount) => { const e = S.L, v = e.volumes.find((q) => q.part === part); const pt = new V().copy(v.a).applyMatrix4(v.bone.matrixWorld); E.damage({ enemy: e, part, point: pt, normal: new V(0, 1, 0), distance: 5 }, amount, new V(0, -1, 0)); S.step(1); };
  return true;
});
if (!installed) { bad('no loader arena (enemies.debug.loaderArena) — is this a W3b build with ?loaderArena=1 on a level without a dock?'); await browser.close(); process.exit(1); }

// ───────────────────────────────────────────────────────── 1 telegraph + 10 cap (a long still-standing run)
if (want('telegraph') || want('cap')) {
  console.log('══════════ 1 telegraph · 10 cap ══════════');
  const r = await ev(() => {
    const S = window.__L; S.reset(); S.spawn(); S.place(S.A.spots.dock); S.reset();
    // he stands still; put back on his spot 0.5 s after a knock-back (it may carry him off a target deck)
    let nh = 0, back = -1;
    S.secs(60, (i) => { if (S.hurt.length !== nh) { nh = S.hurt.length; back = i + 30; } if (i === back) window.__game.player.teleport(new S.V(S.A.spots.dock[0], S.A.spots.dock[1] + 0.05, S.A.spots.dock[2]), 0, 0); });
    return { log: S.log(), hurt: S.hurt, sounds: S.sounds.filter((s) => s.id === 'loader_jaws').map((s) => s.t), ev: S.events };
  });
  const atk = r.log.filter((e) => e.kind === 'attack' && e.attack === 'slam'), locks = r.log.filter((e) => e.kind === 'lock'), imps = r.log.filter((e) => e.kind === 'impact');
  check(imps.length >= 4, `slams in 60 s on a still player: ${imps.length} (≥ 4)`);
  let tele = true, lockOk = true, jaws = true, far = true;
  for (const im of imps) {
    const lk = [...locks].reverse().find((l) => l.t < im.t), at = [...atk].reverse().find((a) => a.t < im.t);
    if (!lk || !at || lk.t - at.t < 0.9 - 1e-3) tele = false;
    if (!lk || im.t - lk.t < 0.8 + 0.45 - 0.02) lockOk = false;
    const nj = r.sounds.filter((t) => t >= (lk?.t ?? 0) - 0.01 && t <= im.t).length;
    if (nj !== 1) jaws = false;
    if (im.hit && im.dist >= 1.8 + 0.35) far = false;
  }
  check(tele, 'every slam tracks ≥ 0.9 s before its lock');
  check(lockOk, 'lock 0.8 s + drop 0.45 s before every impact');
  check(jaws, 'loader_jaws once per slam');
  check(far, 'no damage outside r 1.8 + 0.35');
  // cap: every 2 s window
  let worst = 0;
  for (const h of r.hurt) { const s = r.hurt.filter((q) => q.t >= h.t - 1e-6 && q.t < h.t + 2).reduce((a, q) => a + q.a, 0); worst = Math.max(worst, s); }
  check(worst <= 40 + 1e-6, `cap: worst 2 s window ${f2(worst)} ≤ 40 (${r.hurt.length} hits)`);
  check(!r.ev.some((e) => e.k === 'enemy:damaged' && e.type !== 'loader'), 'the loader damaged no enemy');
}

// ───────────────────────────────────────────────────────── 2 fairness
if (want('fair')) {
  console.log('══════════ 2 fairness ══════════');
  const r = await ev((N) => {
    const S = window.__L, g = window.__game, p = g.player, A = S.A;
    const out = { hits: 0, n: 0, wadeHits: 0, wn: 0, illegal: 0, noLock: 0 };
    for (const wet of [false, true]) {
      for (let k = 0; k < N; k++) {
        S.reset(); S.spawn();
        const spot = wet ? A.spots.wet : (k & 1 ? A.spots.dock : A.spots.dock2);
        // face away along ±x (alternating), stand still until the lock, then walk from rest
        const yaw = (k & 2) ? Math.PI / 2 : -Math.PI / 2;
        S.place([spot[0] + (k % 3 - 1) * 0.6, spot[1], spot[2] + ((k >> 2) % 3 - 1) * 0.6], yaw);
        const locked = S.secs(12, () => S.row().ring.state === 'lock');
        if (!locked) { out.noLock++; continue; }
        const lp = S.row().ring.pos;
        if (!A.dock.target(new S.V(lp[0], lp[1], lp[2]))) out.illegal++;
        p.debug.move(1, 0, false);
        S.secs(2.0);
        p.debug.move(0, 0, false);
        const imp = S.log().filter((e) => e.kind === 'impact').pop();
        if (wet) { out.wn++; if (imp?.hit) out.wadeHits++; } else { out.n++; if (imp?.hit) out.hits++; }
      }
    }
    return out;
  }, TRIALS);
  check(r.noLock === 0, `every trial reached a lock (${r.noLock} did not)`);
  check(r.hits === 0, `walker from rest at the lock start: ${r.hits} hits in ${r.n}`);
  check(r.wadeHits === 0, `knee-deep wader: ${r.wadeHits} hits in ${r.wn}`);
  check(r.illegal === 0, `every lock point is a dock.target point (${r.illegal} not)`);
}

// ───────────────────────────────────────────────────────── 3 windows
if (want('window')) {
  console.log('══════════ 3 windows ══════════');
  const r = await ev(() => {
    const S = window.__L, g = window.__game, p = g.player;
    S.reset(); S.spawn(); S.place(S.A.spots.dock);
    let tImp = -1, extUntil = -1, early = false;
    S.secs(20, () => {
      const row = S.row();
      const imp = S.log().find((e) => e.kind === 'impact');
      if (imp && tImp < 0) tImp = imp.t;
      if (tImp >= 0 && row.parts.ram_e.mult > 0) extUntil = row.time;
      if (tImp < 0 && row.parts.ram_e.mult > 0 && row.lastAttack.lockStart < 0) early = true;
      return tImp >= 0 && row.time > tImp + 4.5;
    });
    // kill a ram inside one window: stand 10 m off, carbine aim-locked at the ram
    S.reset(); S.spawn(); S.place(S.A.spots.dock);
    p.give('carbine', 200); p.debug.switchTo('carbine'); S.secs(1.2);
    let killed = false, inWin = true, shots = 0;
    S.secs(25, () => {
      const row = S.row();
      if (row.parts.ram_e.hp <= 0) { killed = true; return true; }
      if (row.mode === 'slam' && row.phase === 'recover') {
        // move 10 m away the first time, then fire
        if (!S.moved) { const gp = row.grab; S.moved = true; p.teleport(new S.V(gp[0] + 10, S.A.spots.dock[1] + 0.05, gp[2]), Math.PI / 2, 0); }
        const pos = row.parts.ram_e.pos; p.debug.aimLock(pos[0], pos[1], pos[2]); p.debug.hold(true); shots++;
        if (row.parts.ram_e.mult <= 0) inWin = false;
      } else if (S.moved) { p.debug.hold(false); if (row.parts.ram_e.hp < 200) return true; }
      p.weapons.carbine.clip = Math.max(p.weapons.carbine.clip, 5);
      return false;
    });
    S.moved = false; p.debug.hold(false); p.debug.aimLock(null);
    return { tImp, extUntil, window: extUntil - tImp, early, killed, hp: S.row().parts.ram_e.hp };
  });
  check(r.window >= 2.3 && r.window <= 2.6, `rams ×1 for ${f2(r.window)} s after the impact (2.4)`);
  check(!r.early, 'rams ×0 before the first lock');
  check(r.killed, `carbine at 10 m kills a ram inside one window (ram hp after: ${f2(r.hp)})`);
}

// ───────────────────────────────────────────────────────── 9 lit (the light pool is filled by real frames: step, then let the page render)
if (want('lit')) {
  console.log('══════════ 9 flood-lit ══════════');
  await ev(() => { const S = window.__L; S.reset(); S.spawn(); S.place(S.A.spots.dock); S.secs(3); });
  let lit = 0, n = 0;
  for (let k = 0; k < 6; k++) {
    await page.waitForTimeout(250);
    const v = await ev(() => { const S = window.__L; S.secs(0.3); return S.B.floodLit(window.__game.player.position); });
    n++; if (v) lit++;
  }
  check(lit >= 3, `floodLit while the floods are on him (${lit}/${n} samples)`);
  // S13: a flood whose light is out of the pool does not count
  const off = await ev(() => { const S = window.__L; for (const l of S.L.rig.floods) if (l) l.enabled = false; S.L.litCache.t = -1; return S.B.floodLit(window.__game.player.position); });
  check(!off, 'not lit while every flood light is out of the pool');
}

// ───────────────────────────────────────────────────────── 4 damage model + 5 stages + 9 lit + 12 death
if (want('damage') || want('stages') || want('lit') || want('death')) {
  console.log('══════════ 4 damage · 5 stages · 9 lit · 12 death ══════════');
  const r = await ev(() => {
    const S = window.__L, g = window.__game, E = g.enemies;
    S.reset(); S.spawn(); S.place(S.A.spots.dock); S.secs(2);
    const o = {};
    // floods: 3 carbine hits (18)
    let n = 0; while (S.B.partHp('flood_1') > 0 && n < 10) { S.hit('flood_1', 18); n++; }
    o.flood = n;
    // a retracted ram: 0, clank ≤ 1 per 0.3 s, enemy:damaged amount 0 with the part
    S.L.mode = 'hunt'; S.events.length = 0; S.sounds.length = 0;
    const h0 = S.B.partHp('ram_e');
    for (let k = 0; k < 10; k++) { S.L.ramsGoal = 0; S.L.rams = 0; S.hit('ram_e', 18); }
    o.ramRetracted = h0 - S.B.partHp('ram_e');
    o.clanks = S.sounds.filter((s) => s.id === 'armour_clank').length;
    o.zeroEv = S.events.filter((e) => e.k === 'enemy:damaged' && e.part === 'ram_e' && e.amount === 0).length;
    // pod shut: 0
    const p0 = S.B.partHp('pod'); S.hit('pod', 30); o.podShut = p0 - S.B.partHp('pod');
    // body ×0.05
    const dmgs = []; const off = g.events.on('enemy:damaged', (e) => dmgs.push(e.amount)); S.hit('body', 20); off?.(); o.body = dmgs[0];
    // stages
    S.events.length = 0;
    S.B.setStage(2); S.step(2); o.stage2 = S.B.stage; o.ev2 = S.events.filter((e) => e.k === 'boss:stage').map((e) => e.stage);
    const kill = (part) => { let k = 0; while (S.B.partHp(part) > 0 && k < 40) { S.L.rams = 1; S.L.ramsGoal = 1; S.hit(part, 18); k++; } return k; };
    o.ramHits = kill('ram_e'); o.stageAfter1 = S.B.stage;
    kill('ram_w'); S.secs(1); o.stage3 = S.B.stage; o.cowl = S.row().cowl; o.podMult = S.row().parts.pod.mult;
    o.events = S.events.filter((e) => e.k === 'boss:stage').map((e) => e.stage);
    // floods out → never lit
    for (const f of ['flood_2', 'flood_3', 'flood_4']) while (S.B.partHp(f) > 0) S.hit(f, 18);
    S.secs(3); o.litAfter = S.B.floodLit(g.player.position);
    // death
    S.events.length = 0;
    let k = 0; while (S.B.partHp('pod') > 0 && k < 60) { S.hit('pod', 18); k++; }
    o.podHits = k;
    const tD = E.world.time; let markOff = -1;
    S.secs(16, () => { if (markOff < 0 && S.L.pose.mark === 'off') markOff = E.world.time - tD; });
    const row = S.row();
    o.died = S.events.filter((e) => e.k === 'enemy:died').length;
    o.grab = row.grab; o.grabBottom = row.grabBottom; o.mode = row.mode; o.markOff = markOff;
    o.well = S.A.well.toArray();
    return o;
  });
  if (want('lit')) check(!r.litAfter, 'not lit once every flood is out');
  if (want('damage')) {
    check(r.flood === 3, `flood: ${r.flood} carbine hits (3)`);
    check(r.ramRetracted === 0, `retracted ram takes ${r.ramRetracted} (0)`);
    check(r.zeroEv === 10, `enemy:damaged amount 0 + part on each clank hit (${r.zeroEv}/10)`);
    check(r.clanks <= 1, `armour_clank ≤ 1 per 0.3 s (${r.clanks} for 10 hits in 10 frames)`);
    check(r.podShut === 0, `shut pod takes ${r.podShut} (0)`);
    check(Math.abs(r.body - 1) < 1e-6, `body ×0.05 (${f2(r.body)} of 20)`);
    check(r.ramHits === 12, `extended ram: ${r.ramHits} carbine hits (12)`);
    check(r.podHits === 28, `open pod: ${r.podHits} carbine hits (28)`);
  }
  if (want('stages')) {
    check(r.stage2 === 2 && r.ev2.includes(2), `setStage(2) → stage ${r.stage2}, boss:stage ${JSON.stringify(r.ev2)}`);
    check(r.stageAfter1 === 2, `first ram → stage ${r.stageAfter1}`);
    check(r.stage3 === 3 && r.events.includes(3), `both rams → stage ${r.stage3} (events ${JSON.stringify(r.events)})`);
    check(r.cowl > 0.5 && r.podMult === 1, `cowl open ${f2(r.cowl)}, pod ×${r.podMult}`);
  }
  if (want('death')) {
    check(r.died === 1, `enemy:died ${r.died} (1)`);
    const inWell = Math.abs(r.grab[0] - r.well[0]) < 6 && Math.abs(r.grab[2] - r.well[2]) < 6 && r.grabBottom < r.well[1];
    check(inWell && r.mode === 'dead', `the grab ends in the well: ${JSON.stringify(r.grab)} bottom ${f2(r.grabBottom)} (${r.mode})`);
    check(r.markOff >= 0 && r.markOff <= 2.5, `marks out ${f2(r.markOff)} s after death (≤ 2.5)`);
  }
}

// ───────────────────────────────────────────────────────── 6 cargo
if (want('cargo')) {
  console.log('══════════ 6 SHIFT / DROP ══════════');
  const r = await ev(() => {
    const S = window.__L, A = S.A;
    const out = {};
    // SHIFT: stand 1.5 m north of B-12, clear of the stair margin (sl6_4: −36 … −30, −176.4 … −174.0) on the dock, stage 1; the period elapsed
    S.reset(); S.spawn(); S.place([-33, -20, -173.5]); S.L.shiftClock = 99; S.L.cd.slam = 99;
    const before = A.dock.slots.map((s) => s.container);
    S.secs(70, () => S.log().some((e) => e.kind === 'setdown'));
    const lg = S.log();
    const ol = lg.find((e) => e.kind === 'outline'), sd = lg.find((e) => e.kind === 'setdown');
    out.shift = { before, after: A.dock.slots.map((s) => s.container), lead: sd && ol ? sd.t - ol.t : -1, slot: sd?.slot, wasFree: sd ? before[A.dock.slots.findIndex((s) => s.id === sd.slot)] === null : false };
    // DROP: stage 2, stand by a free slot on the dock (sl6_2: −74 … −68, −176.4 … −174.0)
    // stand 0.5 m south of a free dry-dock slot (whatever the SHIFT left)
    const fs = A.dock.slots.find((q) => !q.container && q.floorY > -20.5);
    S.reset(); S.spawn(); S.B.setStage(2); S.place([(fs.box.min.x + fs.box.max.x) / 2, -20, fs.box.min.z - 0.5]); S.L.cd.slam = 99; S.L.cd.drop = 0; S.L.shiftClock = -99;
    const b2 = A.dock.slots.map((s) => s.container);
    S.secs(70, () => S.log().some((e) => e.kind === 'release'));
    const l2 = S.log(), o2 = l2.find((e) => e.kind === 'outline'), rl = l2.find((e) => e.kind === 'release');
    S.secs(1.5);
    out.drop = { lead: rl && o2 ? rl.t - o2.t : -1, slot: rl?.slot, wasFree: rl ? b2[A.dock.slots.findIndex((s) => s.id === rl.slot)] === null : false };
    // a gallery never triggers a shift
    S.reset(); S.spawn(); S.place(A.spots.gallery); S.L.shiftClock = 99;
    S.secs(10);
    out.galleryShift = S.log().filter((e) => e.kind === 'attack' && (e.attack === 'shift' || e.attack === 'drop')).length;
    return out;
  });
  check(r.shift.lead >= 1.6 - 1e-3, `SHIFT: outline ${f2(r.shift.lead)} s before the set-down (≥ 1.6) into ${r.shift.slot}`);
  check(r.shift.wasFree, 'SHIFT set down into a free slot');
  check(r.drop.lead >= 1.6 - 1e-3, `DROP: strobe ${f2(r.drop.lead)} s before the release (≥ 1.6) into ${r.drop.slot}`);
  check(r.drop.wasFree, 'DROP into a free slot');
  check(r.galleryShift === 0, `a player on a gallery triggers no SHIFT / DROP (${r.galleryShift})`);
}

// ───────────────────────────────────────────────────────── 8 guard
if (want('guard')) {
  console.log('══════════ 8 GUARD ══════════');
  const r = await ev(() => {
    const S = window.__L, A = S.A;
    S.reset(); S.spawn(); S.place(A.spots.gallery);
    S.secs(14);
    const row = S.row(), park = A.dock.park;
    const at = Math.hypot(row.grab[0] - park.x, row.grab[2] - park.z);
    S.place(A.spots.dock); S.secs(0.8);
    return { mode: row.mode, at, after: S.row().mode };
  });
  check(r.mode === 'guard' && r.at < 0.5, `gallery ≥ 2 s → guard at the park (${r.mode}, ${f2(r.at)} m off)`);
  check(r.after !== 'guard', `steps onto the dock → leaves the guard (${r.after})`);
}

// ───────────────────────────────────────────────────────── 13 restore
if (want('restore')) {
  console.log('══════════ 13 restore ══════════');
  const r = await ev(() => {
    const S = window.__L, A = S.A;
    S.reset(); S.spawn(); S.place(A.spots.dock); S.secs(1);
    S.B.setStage(2);
    for (let k = 0; k < 3; k++) S.hit('flood_2', 18);
    S.L.rams = 1; for (let k = 0; k < 4; k++) { S.L.rams = 1; S.hit('ram_w', 18); }
    const snap = JSON.parse(JSON.stringify(S.B.snapshot()));
    // a fresh loader, as after a page reload
    S.spawn(); S.events.length = 0;
    S.B.restore(snap);
    const back = S.B.snapshot();
    const row0 = S.row();
    S.secs(2.9); const mid = S.row().mode; S.secs(0.4); const after = S.row().mode;
    return { snap, back, mode0: row0.mode, mid, after, ev: S.events.filter((e) => e.k === 'boss:stage').map((e) => e.stage) };
  });
  check(JSON.stringify(r.snap) === JSON.stringify(r.back), `snapshot → restore round trip (${JSON.stringify(r.back)})`);
  check(r.mode0 === 'guard' && r.mid === 'guard' && r.after !== 'guard', `grace 3.0 s in guard (${r.mode0} → ${r.mid} → ${r.after})`);
  check(r.ev.includes(2), `boss:stage re-emitted on restore (${JSON.stringify(r.ev)})`);
}

// ───────────────────────────────────────────────────────── 14 cost
if (want('cost')) {
  console.log('══════════ 14 cost ══════════');
  const r = await ev(() => {
    const S = window.__L;
    S.reset(); S.spawn(); S.place(S.A.spots.dock);
    S.L.costMs = 0; S.L.costN = 0; const r0 = S.L.rays;
    S.secs(20);
    return { ms: S.L.costMs / S.L.costN, rays: (S.L.rays - r0) / 20 };
  });
  check(r.ms <= 0.25, `loader update ${f2(r.ms)} ms mean (≤ 0.25; headless timing)`);
  check(r.rays <= 20, `rays ${f2(r.rays)} / s (≤ 20)`);
}

// ───────────────────────────────────────────────────────── 15 cheese
if (want('cheese')) {
  console.log('══════════ 15 cage / gallery cheese ══════════');
  const r = await ev(() => {
    const S = window.__L, g = window.__game, p = g.player, A = S.A;
    const out = {};
    for (const where of ['cage', 'gallery']) {
      S.reset(); S.spawn(); S.place(A.spots[where]); S.secs(1);
      p.give('carbine', 999); p.debug.switchTo('carbine'); S.secs(1.2);
      let dealt = 0;
      const off = g.events.on('enemy:damaged', (e) => { if (e.type === 'loader' && (e.part === 'pod' || e.part === 'ram_e' || e.part === 'ram_w')) dealt += e.amount; });
      let k = 0;
      S.secs(60, () => {
        const row = S.row(), parts = ['ram_e', 'ram_w', 'pod'], q = row.parts[parts[(k++ >> 5) % 3]].pos;
        p.debug.aimLock(q[0], q[1], q[2]); p.debug.hold(true);
        p.weapons.carbine.clip = Math.max(p.weapons.carbine.clip, 5); p.weapons.carbine.reserve = 999;
      });
      off?.(); p.debug.hold(false); p.debug.aimLock(null);
      out[where] = { dealt, mode: S.row().mode };
    }
    return out;
  });
  check(r.cage.dealt === 0, `from the cage: ${f2(r.cage.dealt)} damage to rams / pod in 60 s (${r.cage.mode})`);
  check(r.gallery.dealt === 0, `from the east gallery: ${f2(r.gallery.dealt)} damage to rams / pod in 60 s (${r.gallery.mode})`);
}

// ───────────────────────────────────────────────────────── B6 wreck in deep water
if (want('wreck')) {
  console.log('══════════ B6 no wreck box in deep water ══════════');
  const r = await ev(() => {
    const S = window.__L, g = window.__game, E = g.enemies;
    for (const e of [...E.all]) if (e.type === 'loader') E.removeGroup(e.group);
    // a husk dies on the well's floor region at the wet dock's channel depth — test the rule directly on the wet dock
    // (0.5 m: a box) and in the well (deep: none)
    const mk = (x, y, z) => { const e = E.spawn('husk', new S.V(x, y, z), 0, 'gw_' + (++S.n)); return e; };
    const a = mk(-52, -20.8, -188), b = mk(-52, -33.9, -176);
    for (const e of [a, b]) { const v = e.volumes[0]; const pt = new S.V().copy(v.a).applyMatrix4(v.bone.matrixWorld); E.damage({ enemy: e, part: v.part, point: pt, normal: new S.V(0, 1, 0), distance: 3 }, 9999, new S.V(0, -1, 0)); }
    S.secs(5);
    return { shallow: !!a.wreckBody, deep: !!b.wreckBody, deepBox: !!b.wreckBox, aBox: !!a.wreckBox };
  });
  check(!r.deep, `a body in the well (deep water) makes no wreck box (box seen ${r.deepBox}, body ${r.deep})`);
  console.log(`  info shallow wet dock body: wreck box ${r.aBox}, collider ${r.shallow}`);
}

await browser.close();
console.log(problems.length ? `\n${problems.length} problem(s)` : '\nall loader checks passed');
process.exit(problems.length ? 1 : 0);
