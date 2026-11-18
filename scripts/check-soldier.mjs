// The taken soldier (stage 3c §8.2, §8.2.10; task W3b). On a static build (vite build + vite preview).
//   node scripts/check-soldier.mjs [--url http://127.0.0.1:4173] [--only ttk,first,hitrate,telegraph,cover,supp,misses,cap,death,perception,hold,exits,grating,actor,cost]
//                                  [--watch [--seconds 24] [--fp]] [--real]
// Default: the TEST ARENA (`?level=5&nostory=1&soldierArena=1`: lane, cover yard with 10 cover points in the contract's
// format, a crawl trench under a solid grating with one exit, a switchable dark region; src/enemies/soldier/stubrig.ts).
// The game loop is stepped synchronously in the page at 60 Hz (player, level, enemies, fx) — numbers do not depend on
// the headless frame rate. The player is kept alive (health topped up after every hit; the shots are logged and the
// time-to-kill is computed from them with the as-built armour rule, ⅔ absorbed while it lasts).
//   1 ttk        player → soldier with the debug aim lock: pistol 7 body / 3 head / 8 limb, carbine 7 / 3 / 8, shotgun 2
//                shells at 5 m; carbine hip vs aimed at 20 m with real spread (shots + seconds, aimed ≤ hip); soldier →
//                player: pistol at 15 m and carbine at 20 m, one soldier as tuned, 60 s, TTK with armour 0 and 50
//   2 first      the first burst of an engagement never hits (20 engagements at 8 m); a peek-and-hide under 12 s unseen
//                gets no new free miss, ≥ 12 s does
//   3 hitrate    hit fraction, player still in the open, 8 / 15 / 25 m within ±0.08 of 0.75 / 0.55 / 0.35; strafing 3.6 m/s
//                ≤ 0.6 ×; crouched behind a 1.0 m crate ≤ 0.45 ×
//   4 telegraph  every burst preceded by rise + aim ≥ 0.75 s with the light on from the rise; one aim click per burst;
//                one 18-damage hit in the aim does not cancel it, a head hit does
//   5 cover      yard, player firing at him: his chest hidden from the player's eye ≥ 70 % of his non-firing time; he
//                changes points within 1.5 s of being flanked
//   6 supp       3 s of carbine fire within 1 m of his head: gain ≤ 0.8 / s; no rise while ≥ 1.0; peeks again within
//                1.5 s + the decay time after the fire stops
//   7 misses     every miss impact 0.4 … 1.5 m from the player's body axis; a whiz / crack for every miss passing ≤ 2.5 m
//   8 cap        4 soldiers at a still player: ≤ 18 damage in every 1 s window (and 9: never > 2 in rise / aim / burst)
//  10 death      fwd / back against a crate / side: mark off ≤ 2.5 s after enemy:died, a walkable 0.15 m body box, the
//                drop given once (ammo; the carbine when none is owned), the radio at corpsePoint usable from 1.5 m
//  11 perception behind at 10 m 5 s → not noticed; beam 0.5 s at 20 m → noticed; dark + lamp off: 14 m → not in 5 s,
//                10 m → after ≥ 0.75 s (≤ 1.4 s); dark at 20 m, one shot → sees him at once (lit)
//  15 hold       idle, not in activeCount, holding(group) 1, never fires; release → enemy:alerted, AI; a shot near him
//                releases him by itself; the mark red-blinking in hold and in combat; a re-spawn after a page reload holds
//  16 exits      player in the trench: every awake enemy (soldiers + a husk) stands 2–5 m from the exit, never in the
//                keep-out box; no husk melee lands through the grating
//  12 grating    soldier above, player below: no sight either way, the player's bullets stop at the grating
//  13 actor      enemies.actor('soldier'): moveTo resolves, setPose / lookAt / speak / setEyes / prop do not throw
//  14 cost       5 soldiers + 4 husks fighting: enemies update ≤ 1.5 ms per frame (mean, in page)
// Always: no soldier hit lands on a player he has no line to (checked on every `enemy:fired` hit).
// --watch: real-time frame sequence (10 fps, shots/soldier/) of a soldier fighting a scripted player in the yard, seen
//          from an observer camera beside him (`--fp`: the player's own view).
// --real: the level-5 cases on the real level (g5_s1 hold / release / radio, the crawl exits) — skipped while the level
//         has no cover data (K's stub).
// Exit 1 on any failure.
import { launch, parseArgs, writeJson } from './lib/check-common.mjs';
import { mkdirSync } from 'node:fs';

const args = parseArgs();
const base = (args.url ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const only = args.only ? new Set(args.only.split(',')) : null;
const want = (k) => !only || only.has(k);
const problems = [];
const report = {};
const bad = (m) => { problems.push(m); console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);
const check = (cond, m) => (cond ? ok(m) : bad(m));

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => bad(`pageerror: ${e.message}`));
const ev = (fn, arg) => page.evaluate(fn, arg);

async function open(query = '') {
  await page.goto(`${base}/?level=5&autostart=1&nostory=1&soldierArena=1&torch=inf${query}`);
  await page.waitForFunction(() => window.__game?.ready && window.__game.state === 'playing', null, { timeout: 120000 });
  await page.waitForTimeout(800);
  const okA = await ev(install);
  if (!okA) { bad('no soldier arena (enemies.debug.arena) — is this a W3b build?'); await browser.close(); process.exit(1); }
}

/** In page: helpers (window.__S). */
function install() {
  const g = window.__game, E = g.enemies, D = E.debug, A = D?.arena;
  if (!A) return false;
  const V = g.camera.position.constructor;
  const DT = 1 / 60;
  const S = (window.__S = { A, V, DT, ms: 0, frames: 0, violations: [], groups: [], n: 0, attacks: [], damaged: [] });
  const p = g.player;
  S.armor = 0;
  g.events.on('player:damaged', (e) => { S.damaged.push({ t: E.world.time, amount: e.amount }); p.health = 100; });
  g.events.on('enemy:attack', (e) => S.attacks.push({ t: E.world.time, id: e.id, type: e.type, kind: e.kind }));
  g.events.on('enemy:fired', (e) => {
    if (!e.hit) return;
    const eh = p.eye.y - p.position.y;
    const chest = new V(p.position.x, p.position.y + eh * 0.72, p.position.z);
    if (!g.physics.lineOfSight(e.origin, chest) && !g.physics.lineOfSight(e.origin, p.eye)) S.violations.push({ t: E.world.time, id: e.id, origin: e.origin.toArray() });
  });
  S.step = (n = 1, each) => {
    for (let i = 0; i < n; i++) {
      g.time += DT;
      p.update(DT);
      g.level.update(DT);
      const t0 = performance.now();
      E.update(DT);
      S.ms += performance.now() - t0; S.frames++;
      g.fx.update(DT);
      if (each) each(i);
    }
  };
  S.secs = (s, each) => S.step(Math.round(s / DT), each);
  S.t = () => E.world.time;
  S.spawn = (x, z, yaw, o = {}, y = 0) => {
    const grp = o.group ?? `ts_${++S.n}`;
    const e = D.spawnSoldier(x, y, z, yaw, grp, o);
    if (!S.groups.includes(grp)) S.groups.push(grp);
    return e.id;
  };
  S.sol = (id) => D.soldier(id);
  S.row = (id) => D.soldiers().find((r) => r.id === id);
  S.log = (clear = false) => D.soldierLog(clear);
  S.clear = () => {
    for (const grp of S.groups) E.removeGroup(grp);
    S.groups.length = 0;
    for (const e of [...E.all]) if (e.group?.startsWith('th_')) E.removeGroup(e.group);
    D.soldierLog(true);
    A.dark(false); A.crate.on(false);
    D.director().debugNoCap = false;
    p.debug.move(0, 0, false); p.debug.crouch(false); p.debug.aimLock(null); p.debug.hold(false); p.debug.aim(false);
    p.debug.flashlight(false);
    p.health = 100; p.debug.setArmor(0);
    S.damaged.length = 0; S.attacks.length = 0;
    S.step(30);
  };
  S.lookYP = (from, pt) => { const dx = pt.x - from.x, dy = pt.y - from.y, dz = pt.z - from.z; return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))]; };
  S.place = (x, y, z, yaw = 0, pitch = 0) => { p.teleport(new V(x, y + 0.05, z), yaw, pitch); p.debug.move(0, 0, false); S.step(12); };
  S.placeLook = (x, y, z, pt) => { S.place(x, y, z); const [yw, pi] = S.lookYP(p.eye, new V(pt[0], pt[1], pt[2])); p.teleport(new V(x, y + 0.05, z), yw, pi); S.step(4); };
  /** A point on the wanted part of enemy e as seen from the player's eye (scan in his plane), or null. */
  S.partPoint = (e, part) => {
    const eye = p.eye.clone(), dir = new V();
    const dx = e.position.x - eye.x, dz = e.position.z - eye.z, l = Math.hypot(dx, dz) || 1;
    const rx = -dz / l, rz = dx / l;
    const pts = [];
    for (let s = -0.45; s <= 0.45; s += 0.03) for (let y = 0.05; y < 2.1; y += 0.03) {
      const tp = new V(e.position.x + rx * s, e.position.y + y, e.position.z + rz * s);
      dir.copy(tp).sub(eye).normalize();
      const h = E.hitscan(eye, dir, 60);
      if (h && h.enemy === e && h.part === part) pts.push(tp);
    }
    if (!pts.length) return null;
    const c = new V(); for (const q of pts) c.add(q); c.multiplyScalar(1 / pts.length);
    let best = pts[0], bd = Infinity; for (const q of pts) { const d = q.distanceToSquared(c); if (d < bd) { bd = d; best = q; } }
    return best;
  };
  S.inBox = (b, q) => q[0] > b.min.x && q[0] < b.max.x && q[2] > b.min.z && q[2] < b.max.z;
  return true;
}

const fmt = (x, n = 2) => (typeof x === 'number' ? x.toFixed(n) : String(x));

// ───────────────────────────────────────────────────────────── 1 TTK
async function caseTTK() {
  console.log('══════════ 1 time to kill ══════════');
  const res = {};
  const shotsToKill = async (weapon, part, dist) => ev(([weapon, part, dist]) => {
    const S = window.__S, g = window.__game, p = g.player, E = g.enemies;
    S.clear();
    S.place(202, 0, 4, 0, 0);
    const id = S.spawn(202, 4 - dist, Math.PI, { arms: 'carbine' });
    const e = S.sol(id);
    e.debugSet({ freeze: true, pose: 'aim' });
    S.step(30);
    p.give(weapon, 200);
    p.debug.switchTo(weapon);
    S.secs(1.2);
    let n = 0, hits = 0, hitNow = false, pellets = 0, dealt = 0;
    const off = g.events.on('enemy:damaged', (d) => { if (d.id === id) { hitNow = true; pellets++; dealt += d.amount; } });
    const t0 = S.t();
    while (e.alive && n < 16) {
      if (hitNow) hits++;
      hitNow = false;
      const pt = S.partPoint(e, part);
      if (!pt) return { err: `no ${part}`, n };
      // the aim lock is the carbine's; pistol / shotgun are aimed with the camera (their own small spread)
      if (weapon === 'carbine') p.debug.aimLock(pt.x, pt.y, pt.z);
      else { const [yw, pi] = S.lookYP(p.eye, pt); p.teleport(p.position.clone(), yw, pi); S.step(1); }
      p.weapons[weapon].clip = Math.max(p.weapons[weapon].clip, 2);
      p.debug.fire(); n++;
      S.secs(weapon === 'shotgun' ? 1.0 : 0.6);
    }
    if (hitNow) hits++;
    off?.();
    p.debug.aimLock(null);
    // shotgun: shells fired; the others: shots that hit (a pistol round off the leg's thin capsule is a miss, not a hit)
    return { n: weapon === 'shotgun' ? n : hits, shots: n, alive: e.alive, t: +(S.t() - t0).toFixed(2), pellets, dealt: +dealt.toFixed(1) };
  }, [weapon, part, dist]);
  const want = [['pistol', 'torso', 8, 7], ['pistol', 'head', 8, 3], ['pistol', 'limb', 8, 8], ['carbine', 'torso', 8, 7], ['carbine', 'head', 8, 3], ['carbine', 'limb', 8, 8], ['shotgun', 'torso', 5, 2]];
  for (const [w, part, d, n] of want) {
    const r = await shotsToKill(w, part, d);
    res[`${w}_${part}`] = r;
    if (w === 'shotgun') {
      // 2 shells need ≥ 7 of 9 pellets on the torso per shell (9 × 9 × 0.8); the pellet count depends on the body's width
      const per = r.pellets / Math.max(1, r.n);
      check(!r.alive && (r.n === n || per < 7), `${w} ${part} at ${d} m: ${r.n} shells (${fmt(per, 1)} pellets / shell landed; 2 shells when ≥ 7 land — W3a's wider body decides)`);
    } else check(!r.err && !r.alive && r.n === n, `${w} ${part} at ${d} m: ${n} hits (got ${r.n}${r.err ? ', ' + r.err : ''})`);
  }
  // carbine hip vs aimed at 20 m, real spread, aimed at the chest centre, single taps at 0.25 s
  const spread = async (aimed) => ev((aimed) => {
    const S = window.__S, g = window.__game, p = g.player;
    S.clear();
    S.place(202, 0, 8, 0, 0);
    const id = S.spawn(202, -12, Math.PI, { arms: 'carbine' });
    const e = S.sol(id);
    e.debugSet({ freeze: true, pose: 'aim' });
    S.step(30);
    p.give('carbine', 200); p.debug.switchTo('carbine'); S.secs(1.0);
    const pt = S.partPoint(e, 'torso');
    const [yw, pi] = S.lookYP(p.eye, pt);
    p.teleport(p.position.clone(), yw, pi);
    if (aimed) { p.debug.aim(true); S.secs(0.4); }
    let shots = 0, t0 = S.t();
    while (e.alive && shots < 90) {
      p.weapons.carbine.clip = Math.max(p.weapons.carbine.clip, 2);
      p.debug.fire(); shots++;
      S.secs(0.25);
    }
    p.debug.aim(false);
    return { shots, t: +(S.t() - t0).toFixed(2), alive: e.alive, hp: e.health };
  }, aimed);
  const hip = await spread(false), ads = await spread(true);
  res.carbine20 = { hip, ads };
  check(!hip.alive && !ads.alive && ads.shots <= hip.shots, `carbine at 20 m (taps every 0.25 s): hip ${hip.shots} shots / ${hip.t} s, aimed ${ads.shots} shots / ${ads.t} s (aimed ≤ hip)`);
  // soldier → player: one soldier as tuned, player still in the open, 60 s
  const sToP = async (arms, dist) => ev(([arms, dist]) => {
    const S = window.__S, g = window.__game, p = g.player;
    S.clear();
    S.place(202, 0, 8, 0, 0);
    const id = S.spawn(202, 8 - dist, Math.PI, { arms });
    S.sol(id).debugSet({ noMove: true });
    S.secs(60);
    return S.log().filter((l) => l.id === id && l.ev === 'shot').map((l) => [l.t, l.hit]);
  }, [arms, dist]);
  const ttkFrom = (shots, dmg, armor) => {
    let h = 100, a = armor;
    const t0 = shots.length ? shots[0][0] : 0;
    for (const [t, hit] of shots) {
      if (!hit) continue;
      const ab = Math.min(a, dmg * 2 / 3);
      a -= ab; h -= dmg - ab;
      if (h <= 0) return +(t - t0).toFixed(1);
    }
    return null;
  };
  for (const [arms, d, dmg] of [['pistol', 15, 9], ['carbine', 20, 7]]) {
    const shots = await sToP(arms, d);
    const hits = shots.filter((s) => s[1]).length;
    const dps = hits * dmg / 60;
    const t0 = ttkFrom(shots, dmg, 0), t50 = ttkFrom(shots, dmg, 50);
    res[`soldier_${arms}_${d}`] = { shots: shots.length, hits, dps: +dps.toFixed(2), ttk0: t0, ttk50: t50 };
    // the table (§8.2.5) as built: rise 0.35 + aim 0.45 + burst + hold 0.3 + back 0.4 + gap ≈ 4 s per burst. NOTE for the
    // soldier-in-motion review: §5.3 quotes ≈ 4.5 / s (pistol 15 m) and ≈ 4.0 / s (carbine 20 m); the table gives about half.
    check(dps >= 1.2 && (t0 === null || t0 >= 8), `${arms} soldier at ${d} m on a still unarmoured player: ${fmt(dps)} damage / s, TTK ${t0 === null ? '> 60' : t0} s (${hits}/${shots.length} hits; a threat: ≥ 1.2 / s)`);
    console.log(`       … with 50 armour: ${t50 === null ? '> 60 s' : t50 + ' s'}`);
  }
  report.ttk = res;
}

// ───────────────────────────────────────────────────────────── 2 first burst
async function caseFirst() {
  console.log('══════════ 2 first burst misses ══════════');
  const r = await ev(() => {
    const S = window.__S, out = [];
    for (let k = 0; k < 20; k++) {
      S.clear();
      S.place(202, 0, 0, 0, 0);
      const id = S.spawn(202, -8, Math.PI, { arms: k % 2 ? 'pistol' : 'carbine' });
      S.sol(id).debugSet({ noMove: true });
      let first = null;
      for (let i = 0; i < 600 && !first; i++) {
        S.step(1);
        const sh = S.log().filter((l) => l.id === id && l.ev === 'shot');
        const b = S.log().filter((l) => l.id === id && l.ev === 'end');
        if (b.length) first = sh;
      }
      out.push(first ? { shots: first.length, hits: first.filter((s) => s.hit).length } : null);
    }
    return out;
  });
  check(r.every((x) => x && x.shots > 0 && x.hits === 0), `20 engagements at 8 m: no hit in any first burst (${r.map((x) => x ? `${x.hits}/${x.shots}` : 'none').join(' ')})`);
  // peek-and-hide: after the first burst the player hides 8 s (no new free miss), then 13 s (a new one)
  const ph = await ev(() => {
    const S = window.__S, out = {};
    S.clear();
    S.place(202, 0, 0, 0, 0);
    const id = S.spawn(202, -8, Math.PI, { arms: 'carbine' });
    const e = S.sol(id);
    e.debugSet({ noMove: true });
    for (let i = 0; i < 600; i++) { S.step(1); if (S.log().some((l) => l.id === id && l.ev === 'end')) break; }
    const hide = (s) => { S.place(213, 0, 0, 0, 0); S.secs(s); S.place(202, 0, 0, 0, 0); };
    hide(8);
    out.after8 = S.row(id).firstMiss;
    S.secs(4);
    hide(13);
    S.secs(0.5);
    out.after13 = S.row(id).firstMiss;
    return out;
  });
  check(ph.after8 === false, `peek-and-hide under 12 s: no new free miss (firstMiss ${ph.after8})`);
  check(ph.after13 === true, `unseen ≥ 12 s: a new engagement (firstMiss ${ph.after13})`);
  report.first = { r, ph };
}

// ───────────────────────────────────────────────────────────── 3 hit rate
async function caseHitrate() {
  console.log('══════════ 3 hit fraction ══════════');
  const run = (o) => ev((o) => {
    const S = window.__S, p = window.__game.player;
    S.clear();
    const pz = 6, sz = pz - o.d;
    S.place(202, 0, pz, 0, 0);
    if (o.crate) S.A.crate.on(true);
    if (o.crouch) { p.debug.crouch(true); S.secs(0.8); }
    const id = S.spawn(202, sz, Math.PI, { arms: 'carbine' });
    const e = S.sol(id);
    e.debugSet({ noMove: true, noFirstMiss: true, gap: 0.2 });
    window.__game.enemies.debug.director().debugNoCap = true;
    let flip = 1.3, side = 1;
    S.secs(o.secs, () => {
      if (!o.strafe) return;
      flip += S.DT;
      if (flip > 2.6) { flip = 0; side = -side; }   // 9 m legs across the 12 m lane (each turn-round is < 3 m/s for ~0.3 s)
      p.debug.move(0, side, false);
    });
    const shots = S.log().filter((l) => l.id === id && l.ev === 'shot');
    const eh = p.eye.y - p.position.y;
    return { n: shots.length, hits: shots.filter((s) => s.hit).length, eh: +eh.toFixed(2), speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(2) };
  }, o);
  const res = {};
  for (const [d, want] of [[8, 0.75], [15, 0.55], [25, 0.35]]) {
    const r = await run({ d, secs: 150 });
    const f = r.hits / Math.max(1, r.n);
    res[d] = { ...r, f: +f.toFixed(3) };
    check(r.n >= 100 && Math.abs(f - want) <= 0.08, `still player at ${d} m: ${fmt(f, 3)} of ${r.n} rounds (want ${want} ± 0.08)`);
  }
  const st = await run({ d: 15, secs: 150, strafe: true });
  const fs = st.hits / Math.max(1, st.n);
  res.strafe15 = { ...st, f: +fs.toFixed(3) };
  check(fs <= 0.6 * res[15].f + 0.02, `strafing 3.6 m/s at 15 m: ${fmt(fs, 3)} ≤ 0.6 × ${fmt(res[15].f, 3)}`);
  const cr = await run({ d: 15, secs: 90, crate: true, crouch: true });
  const fc = cr.hits / Math.max(1, cr.n);
  res.crouch15 = { ...cr, f: +fc.toFixed(3) };
  check(cr.eh < 1.3 && fc <= 0.45 * res[15].f + 0.02, `crouched (eye ${cr.eh} m) behind a 1.0 m crate at 15 m: ${fmt(fc, 3)} of ${cr.n} ≤ 0.45 × ${fmt(res[15].f, 3)}`);
  report.hitrate = res;
}

// ───────────────────────────────────────────────────────────── 4 telegraph
async function caseTelegraph() {
  console.log('══════════ 4 telegraph ══════════');
  const r = await ev(() => {
    const S = window.__S;
    S.clear();
    S.place(202, 0, 4, 0, 0);
    const a = S.spawn(202, -12, Math.PI, { arms: 'carbine' }), b = S.spawn(205, -10, Math.PI, { arms: 'pistol' });
    S.secs(40);
    const L = S.log();
    const out = [];
    for (const id of [a, b]) {
      const mine = L.filter((l) => l.id === id);
      for (let i = 0; i < mine.length; i++) {
        if (mine[i].ev !== 'burst') continue;
        let rise = null, aim = null, lightOn = null, aims = 0;
        for (let j = i - 1; j >= 0; j--) {
          const m = mine[j];
          if (m.ev === 'end' || m.ev === 'cancel' || m.ev === 'abort') break;
          if (m.ev === 'aim') { aim = m.t; aims++; }
          if (m.ev === 'rise') { rise = m.t; }
          if (m.ev === 'light_on') lightOn = m.t;
          if (m.ev === 'rise') { const prev = mine[j - 1]; if (prev && prev.ev === 'light_on' && prev.t === m.t) lightOn = prev.t; break; }
        }
        out.push({ id, t: mine[i].t, tele: rise === null ? null : +(mine[i].t - rise).toFixed(3), light: lightOn !== null && rise !== null && Math.abs(lightOn - rise) < 1e-3, aims });
      }
    }
    return out;
  });
  check(r.length >= 8, `${r.length} bursts in 40 s from 2 soldiers`);
  check(r.every((b) => b.tele !== null && b.tele >= 0.75), `every burst preceded by rise + aim ≥ 0.75 s (min ${Math.min(...r.map((b) => b.tele ?? 0)).toFixed(3)} s)`);
  check(r.every((b) => b.light), `the weapon light on from the start of the rise, every burst`);
  check(r.every((b) => b.aims === 1), `one aim (soldier_aim_click) per burst`);
  // a hit in the aim: 18 raw on the torso (14.4) does not cancel it; a head hit does
  const c = await ev(() => {
    const S = window.__S, g = window.__game, E = g.enemies, V = S.V;
    const once = (part) => {
      S.clear();
      S.place(202, 0, 4, 0, 0);
      const id = S.spawn(202, -6, Math.PI, { arms: 'carbine' });
      const e = S.sol(id);
      e.debugSet({ noMove: true });
      for (let i = 0; i < 900; i++) { S.step(1); if (S.row(id).fire === 'aim') break; }
      if (S.row(id).fire !== 'aim') return 'no aim';
      S.step(4);
      E.damage({ enemy: e, point: e.position.clone().add(new V(0, part === 'head' ? 1.65 : 1.2, 0)), normal: new V(0, 0, 1), distance: 10, part }, 18, new V(0, 0, -1));
      for (let i = 0; i < 90; i++) { S.step(1); const L = S.log().filter((l) => l.id === id && (l.ev === 'burst' || l.ev === 'cancel')); if (L.length) return L[0].ev; }
      return 'nothing';
    };
    return { torso: once('torso'), head: once('head') };
  });
  check(c.torso === 'burst', `an 18-damage torso hit during the aim does not cancel it (${c.torso})`);
  check(c.head === 'cancel', `a head hit during the aim cancels it (${c.head})`);
  report.telegraph = { bursts: r.length, cancel: c };
}

// ───────────────────────────────────────────────────────────── 5 cover
async function caseCover() {
  console.log('══════════ 5 cover ══════════');
  const r = await ev(() => {
    const S = window.__S, g = window.__game, p = g.player, V = S.V;
    S.clear();
    S.place(227, 0, 6, 0, 0);
    p.give('carbine', 200); p.debug.switchTo('carbine'); S.secs(1);
    const id = S.spawn(227, -20, Math.PI, { arms: 'carbine', cover: 'yard' });
    const e = S.sol(id);
    let free = 0, exposed = 0, shotT = 0, covers = new Set();
    S.secs(45, () => {
      const row = S.row(id);
      if (row.cover) covers.add(row.cover);
      const firing = row.fire === 'rise' || row.fire === 'aim' || row.fire === 'burst' || row.fire === 'after' || row.fire === 'back';
      const chest = e.rig.chest;
      const vis = g.physics.lineOfSight(p.eye, chest);
      if (!firing) { free++; if (vis) exposed++; }
      shotT -= S.DT;
      if (vis && shotT <= 0) { shotT = 0.5; p.debug.aimLock(chest.x, chest.y, chest.z); p.weapons.carbine.clip = 30; p.debug.fire(); }
      e.health = Math.max(e.health, 60);  // keep him alive and out of the HP retreat
    });
    p.debug.aimLock(null);
    // flank: once he holds a point, the player steps to where that point's chest is visible
    let flank = null;
    for (let k = 0; k < 30 && !flank; k++) {
      const row = S.row(id);
      if (!row.cover || row.moving || (row.fire !== 'none' && row.fire !== 'reload')) { S.secs(0.3); continue; }
      const c = g.level.cover.find((q) => q.id === row.cover);
      const cands = [[c.position.x - 6, -c.position.z + 0], [c.position.x + 6, c.position.z - 3], [c.position.x - 5, c.position.z - 2], [c.position.x + 5, c.position.z + 6], [c.position.x - 6, c.position.z + 6]];
      for (const [x, z] of cands) {
        if (x < 210 || x > 242 || z < -23 || z > 14) continue;
        S.place(x, 0, z, 0, 0);
        const chest = new V(c.position.x, c.position.y + (c.height === 'low' ? 0.55 : 1.3), c.position.z);
        if (!g.physics.lineOfSight(p.eye, chest)) continue;
        const t0 = S.t(), from = row.cover;
        let left = null;
        for (let i = 0; i < 240 && left === null; i++) { S.step(1); const r2 = S.row(id); if (r2.cover !== from || r2.moving) left = S.t() - t0; }
        flank = { from, at: [x, z], left };
        break;
      }
      if (!flank) S.secs(1);
    }
    return { free, exposed, frac: free ? exposed / free : 1, covers: [...covers], flank };
  });
  check(r.frac <= 0.3, `chest hidden from the player ${fmt((1 - r.frac) * 100, 0)} % of his non-firing time (≥ 70 %; points used: ${r.covers.join(', ')})`);
  check(r.covers.length >= 1, `he fights from cover points (${r.covers.join(', ')}; a change is tested by the flank below)`);
  check(r.flank && r.flank.left !== null && r.flank.left <= 1.5, `flanked at ${r.flank?.from} from ${JSON.stringify(r.flank?.at)}: he leaves in ${fmt(r.flank?.left)} s (≤ 1.5 s)`);
  report.cover = r;
}

// ───────────────────────────────────────────────────────────── 6 suppression
async function caseSupp() {
  console.log('══════════ 6 suppression ══════════');
  const r = await ev(() => {
    const S = window.__S, g = window.__game, p = g.player;
    S.clear();
    S.place(202, 0, 6, 0, 0);
    p.give('carbine', 200); p.debug.switchTo('carbine'); S.secs(1);
    const id = S.spawn(202, -12, Math.PI, { arms: 'carbine' });
    const e = S.sol(id);
    e.debugSet({ noMove: true });
    // wait for his first burst to end (he is in the fight)
    for (let i = 0; i < 900; i++) { S.step(1); if (S.log().some((l) => l.id === id && l.ev === 'end')) break; }
    const samples = [];
    let rises = 0, risesHigh = 0;
    const L0 = S.log().length;
    // 3 s of carbine fire 0.8 m over his head (passes within 1 m)
    S.secs(3, () => {
      const h = e.rig.eye;
      p.debug.aimLock(h.x + 0.3, h.y + 0.8, h.z);
      p.weapons.carbine.clip = 30;
      p.debug.hold(true);
      samples.push([S.t(), S.row(id).suppression, S.row(id).fire]);
    });
    p.debug.hold(false); p.debug.aimLock(null);
    const stop = S.t();
    let below = null, peek = null;
    S.secs(8, () => {
      const row = S.row(id);
      samples.push([S.t(), row.suppression, row.fire]);
      if (below === null && row.suppression < 1.0) below = S.t();
      if (peek === null && row.fire === 'rise') peek = S.t();
    });
    // a rise STARTED while suppressed ≥ 1.0 (a rise already under way when the fire began is not a new peek)
    for (let i = 1; i < samples.length; i++) if (samples[i][2] === 'rise' && samples[i - 1][2] !== 'rise' && samples[i][1] >= 1.0) risesHigh++;
    const after = S.log().slice(L0).filter((l) => l.id === id && l.t >= stop - 0.5).map((l) => `${l.t.toFixed(2)} ${l.ev}`);
    // max gain over any 1 s window
    let maxGain = 0;
    for (let i = 0; i < samples.length; i++) for (let j = i; j < samples.length && samples[j][0] - samples[i][0] <= 1.0; j++) maxGain = Math.max(maxGain, samples[j][1] - samples[i][1]);
    const peak = Math.max(...samples.map((s) => s[1]));
    const rows = S.log().slice(L0).filter((l) => l.id === id && l.ev === 'rise'); rises = rows.length;
    return { maxGain, peak, stop, below, peek, risesHigh, rises, after: after.slice(0, 30) };
  });
  check(r.maxGain <= 0.8 + 0.02, `suppression gain ≤ 0.8 per 1 s window (max ${fmt(r.maxGain, 3)}; peak ${fmt(r.peak, 3)})`);
  check(r.peak >= 1.0, `3 s of near fire suppresses him (peak ${fmt(r.peak, 3)} ≥ 1.0)`);
  check(r.risesHigh === 0, `no rise while suppression ≥ 1.0`);
  // his own cycle may be running when the fire stops: then the gap (≤ 2.6 s) after its end counts too
  const lastEnd = Math.max(r.stop, ...r.after.filter((x) => x.endsWith(' end')).map((x) => Number(x.split(' ')[0])).filter((t) => t < (r.peek ?? 1e9)));
  const allowed = Math.max((r.below ?? r.stop) + 1.5, lastEnd + 2.6) - r.stop + 0.6;
  check(r.peek !== null && r.peek - r.stop <= allowed, `peeks again ${fmt(r.peek !== null ? r.peek - r.stop : null)} s after the fire stopped (≤ ${fmt(allowed)} s: max(decay ${fmt((r.below ?? r.stop) - r.stop)} + 1.5, his cycle's gap) + 0.6 s sight tick)`);
  report.supp = r;
}

// ───────────────────────────────────────────────────────────── 7 misses
async function caseMisses() {
  console.log('══════════ 7 misses land near the player ══════════');
  const r = await ev(() => {
    const S = window.__S, g = window.__game, p = g.player;
    const out = { n: 0, bad: [], whizWant: 0, whiz: 0 };
    for (const [arms, d] of [['carbine', 10], ['pistol', 18], ['carbine', 26]]) {
      S.clear();
      S.place(202, 0, 8, 0, 0);
      const id = S.spawn(202, 8 - d, Math.PI, { arms });
      S.sol(id).debugSet({ noMove: true, gap: 0.3 });
      const fired = [];
      const on = (e) => { if (e.id === id && !e.hit) fired.push({ o: e.origin.clone(), q: e.point.clone(), eye: p.eye.clone() }); };
      const off = g.events.on('enemy:fired', on);
      S.secs(30);
      off?.();
      const misses = S.log().filter((l) => l.id === id && l.ev === 'miss');
      out.n += misses.length;
      for (const m of misses) if (m.axis < 0.38 || m.axis > 1.5) out.bad.push(m);
      for (const f of fired) {
        const dir = f.q.clone().sub(f.o), L = dir.length(); dir.multiplyScalar(1 / L);
        const t = Math.max(0, Math.min(L, f.eye.clone().sub(f.o).dot(dir)));
        if (f.o.clone().addScaledVector(dir, t).distanceTo(f.eye) <= 2.5) out.whizWant++;
      }
      out.whiz += S.log().filter((l) => l.id === id && l.ev === 'whiz').length;
    }
    return out;
  });
  check(r.n >= 30 && r.bad.length === 0, `${r.n} misses: every impact 0.4 … 1.5 m from the body axis (${r.bad.length} outside: ${JSON.stringify(r.bad.slice(0, 3))})`);
  check(r.whiz >= r.whizWant && r.whizWant > 0, `a whiz / crack for every miss passing ≤ 2.5 m of his head (${r.whiz} / ${r.whizWant})`);
  report.misses = r;
}

// ───────────────────────────────────────────────────────────── 8 / 9 cap + tokens
async function caseCap() {
  console.log('══════════ 8 damage cap · 9 tokens ══════════');
  const r = await ev(() => {
    const S = window.__S;
    S.clear();
    S.place(202, 0, 6, 0, 0);
    const ids = [S.spawn(200, -2, Math.PI, { arms: 'carbine' }), S.spawn(204, -2, Math.PI, { arms: 'carbine' }), S.spawn(198.5, 0, Math.PI, { arms: 'pistol' }), S.spawn(205.5, 0, Math.PI, { arms: 'pistol' })];
    for (const id of ids) S.sol(id).debugSet({ noMove: true, noFirstMiss: true, gap: 0.3 });
    let maxFiring = 0, maxTok = 0;
    S.secs(40, () => {
      let f = 0, tk = 0;
      for (const id of ids) { const r = S.row(id); if (r.fire === 'rise' || r.fire === 'aim' || r.fire === 'burst') f++; if (r.token) tk++; }
      maxFiring = Math.max(maxFiring, f); maxTok = Math.max(maxTok, tk);
    });
    const hits = S.log().filter((l) => l.ev === 'shot' && l.hit).map((l) => [l.t, ids.indexOf(l.id) < 2 ? 7 : 9]);
    const capped = S.log().filter((l) => l.ev === 'shot' && l.capped).length;
    let worst = 0;
    for (let i = 0; i < hits.length; i++) { let s = 0; for (let j = i; j < hits.length && hits[j][0] - hits[i][0] < 1.0; j++) s += hits[j][1]; worst = Math.max(worst, s); }
    return { hits: hits.length, worst, capped, maxFiring, maxTok };
  });
  check(r.worst <= 18 && r.hits > 10, `4 soldiers at a still player: worst 1 s window ${r.worst} ≤ 18 (${r.hits} hits, ${r.capped} rounds turned into misses by the cap)`);
  check(r.maxFiring <= 2 && r.maxTok <= 2, `never more than 2 in rise / aim / burst (max ${r.maxFiring}; tokens ${r.maxTok})`);
  report.cap = r;
}

// ───────────────────────────────────────────────────────────── 10 death
async function caseDeath() {
  console.log('══════════ 10 death, body, drop, radio ══════════');
  const r = await ev(() => {
    const S = window.__S, g = window.__game, E = g.enemies, p = g.player, V = S.V;
    const out = [];
    const kinds = [
      // kind, soldier pos, soldier yaw, shot direction, player stand side (radio check), arms, own carbine
      { want: 'back', pos: S.A.backCrate, yaw: 0, dir: [0, 0, 1], from: [0, -1.5], arms: 'carbine', owned: false },
      { want: 'fwd', pos: [228, 0, -2], yaw: 0, dir: [0, 0, -1], from: [0, 1.5], arms: 'pistol', owned: true },
      { want: 'side', pos: [234, 0, 2], yaw: 0, dir: [1, 0, 0], from: [-1.5, 0], arms: 'carbine', owned: true },
    ];
    for (const k of kinds) {
      S.clear();
      S.place(k.pos[0] + 6, 0, k.pos[2] + 6, 0, 0);
      p.weapons.carbine.owned = k.owned;
      const id = S.spawn(k.pos[0], k.pos[2], k.yaw, { arms: k.arms });
      const e = S.sol(id);
      e.debugSet({ freeze: true, pose: 'aim' });
      S.step(20);
      let died = null;
      const on = (ev) => { if (ev.id === id) died = S.t(); };
      const offD = g.events.on('enemy:died', on);
      const d = new V(...k.dir);
      E.damage({ enemy: e, point: e.position.clone().add(new V(0, 1.2, 0)), normal: d.clone().negate(), distance: 5, part: 'torso' }, 200, d);
      let off = null;
      for (let i = 0; i < 240; i++) { S.step(1); if (off === null && died !== null && S.row(id).led === 'off') off = S.t() - died; }
      const box = e.wreckBox, body = e.wreckBody;
      const cp = E.corpsePoint(id, 'chest');
      // the radio: an interactable at corpsePoint, from 1.5 m on the open side, looking at it
      g.interactables.add({ id: 't_radio', kind: 'pickup', position: cp.clone(), radius: 2.2, prompt: 'Take radio', enabled: true });
      S.placeLook(cp.x + k.from[0], e.position.y, cp.z + k.from[1], [cp.x, cp.y, cp.z]);
      S.step(3);
      const focus = p.focus?.id ?? null;
      g.interactables.remove('t_radio');
      // the drop: walk onto the body (touch within 1.2 m), twice
      const picks = [];
      const onP = (ev) => picks.push(ev.kind + ':' + ev.amount);
      const offP = g.events.on('pickup', onP);
      S.place(cp.x + 0.6, e.position.y + 0.2, cp.z + 0.6, 0, 0); S.secs(0.5);
      S.place(cp.x + 3, e.position.y, cp.z + 3, 0, 0); S.secs(0.3);
      S.place(cp.x + 0.6, e.position.y + 0.2, cp.z + 0.6, 0, 0); S.secs(0.5);
      offD?.(); offP?.();
      out.push({ want: k.want, got: e.deathKind, off: off === null ? null : +off.toFixed(2), boxH: box ? +(box.max.y - box.min.y).toFixed(3) : null, walkable: !!body?.walkable, cp: cp ? cp.toArray().map((v) => +v.toFixed(2)) : null, focus, picks });
      p.weapons.carbine.owned = true;
    }
    return out;
  });
  for (const k of r) {
    check(k.got === k.want, `death '${k.want}' keyed by the hit direction (got '${k.got}')`);
    check(k.off !== null && k.off <= 2.5, `  mark off ${k.off} s after enemy:died (≤ 2.5)`);
    check(k.boxH !== null && Math.abs(k.boxH - 0.15) < 0.01 && k.walkable, `  body: a walkable ${k.boxH} m box`);
    check(k.focus === 't_radio', `  the radio at corpsePoint ${JSON.stringify(k.cp)} usable from 1.5 m (focus ${k.focus})`);
    const wantDrop = k.want === 'fwd' ? 'ammo_pistol:8' : k.want === 'back' ? 'carbine:30' : 'ammo_carbine:15';
    check(k.picks.length === 1 && k.picks[0] === wantDrop, `  drop given once: ${JSON.stringify(k.picks)} (want ${wantDrop})`);
  }
  report.death = r;
}

// ───────────────────────────────────────────────────────────── 11 perception
async function casePerception() {
  console.log('══════════ 11 perception ══════════');
  const r = await ev(() => {
    const S = window.__S, g = window.__game, p = g.player;
    const out = {};
    // a) behind him at 10 m, quiet, 5 s
    S.clear();
    const a = S.spawn(202, -10, 0);          // faces −z; the player at z 0 is behind him
    S.place(202, 0, 0, 0, 0);
    S.secs(5);
    out.behind = S.row(a).aware;
    // b) the flashlight on him for 0.5 s at 20 m (from behind)
    S.clear();
    const b = S.spawn(202, -14, 0);
    const sol = S.sol(b);
    S.placeLook(202, 0, 6, sol.rig.chest.toArray());
    p.debug.flashlight(true);
    const t0 = S.t(); let tb = null;
    S.secs(2, () => { if (tb === null && S.row(b).aware) tb = S.t() - t0; });
    out.beam = tb;
    p.debug.flashlight(false);
    // c) dark region, lamp off, in front at 14 m (5 s) / 10 m
    S.clear();
    S.A.dark(true);
    const c = S.spawn(202, -8, Math.PI);       // faces +z, toward the player
    S.place(202, 0, 6, 0, 0);
    S.secs(5);
    out.dark14 = S.row(c).aware;
    const t1 = S.t(); let tc = null;
    p.teleport(new S.V(202, 0.05, 2), 0, 0);
    S.secs(3, () => { if (tc === null && S.row(c).aware) tc = S.t() - t1; });
    out.dark10 = tc;
    // d) dark, lamp off, 20 m, aware but unseen → the player fires once → seen at once (lit)
    S.clear();
    S.A.dark(true);
    const d = S.spawn(202, -14, Math.PI);
    S.place(202, 0, 6, 0, 0);
    S.secs(2);
    out.dark20sees = S.row(d).sees;
    p.give('pistol', 50); p.debug.switchTo('pistol'); S.secs(0.8);
    p.teleport(p.position.clone(), Math.PI / 2, 0.2);
    p.debug.fire();
    const t2 = S.t(); let td = null;
    S.secs(1.0, () => { if (td === null && S.row(d).sees) td = S.t() - t2; });
    out.lit = td;
    out.litAware = S.row(d).aware;
    S.A.dark(false);
    return out;
  });
  check(r.behind === false, `behind him at 10 m, quiet, 5 s: not noticed`);
  check(r.beam !== null && r.beam >= 0.4 && r.beam <= 0.9, `flashlight on him at 20 m: noticed after ${fmt(r.beam)} s (0.5 s hold)`);
  check(r.dark14 === false, `dark, lamp off, 14 m in front, 5 s: not noticed`);
  check(r.dark10 !== null && r.dark10 >= 0.75 && r.dark10 <= 1.4, `dark, lamp off, 10 m: noticed after ${fmt(r.dark10)} s (0.8 s hold)`);
  check(r.dark20sees === false && r.lit !== null && r.lit <= 0.35, `dark at 20 m: unseen, then one shot → seen after ${fmt(r.lit)} s (lit 1.5 s)`);
  report.perception = r;
}

// ───────────────────────────────────────────────────────────── 15 hold
async function caseHold() {
  console.log('══════════ 15 hold / release ══════════');
  const r = await ev(() => {
    const S = window.__S, g = window.__game, E = g.enemies, p = g.player;
    const out = {};
    S.clear();
    S.place(202, 0, 0, 0, 0);
    const alerted = [];
    g.events.on('enemy:alerted', (e) => alerted.push(e.id));
    E.spawnGroup('ga_hold');
    S.step(5);
    const m = E.all.find((e) => e.group === 'ga_hold' && e.alive);
    out.spawned = !!m;
    S.secs(6);
    const row = S.row(m.id);
    out.hold = { state: row.state, holding: row.holding, active: E.activeCount, count: E.holding('ga_hold'), shots: row.shots, led: row.led };
    E.release('ga_hold');
    S.step(2);
    out.release = { alerted: alerted.includes(m.id), count: E.holding('ga_hold') };
    S.secs(6);
    const r2 = S.row(m.id);
    out.after = { state: r2.state, aware: r2.aware, led: r2.led, active: E.activeCount };
    E.removeGroup('ga_hold');
    // a shot passing within 1.5 m releases a held soldier by himself
    S.clear();
    S.place(202, 0, 8, 0, 0);
    alerted.length = 0;
    const id = S.spawn(202, -10, 0, { hold: true, arms: 'pistol' });
    S.secs(2);
    const before = S.row(id).holding;
    p.give('pistol', 50); p.debug.switchTo('pistol'); S.secs(0.8);
    const h = S.sol(id).rig.eye;
    const [yw, pi] = S.lookYP(p.eye, new S.V(h.x + 1.0, h.y + 0.3, h.z));
    p.teleport(p.position.clone(), yw, pi); S.step(2);
    p.weapons.pistol.clip = 12;
    let shot = 0; const offF = g.events.on('weapon:fired', () => shot++);
    p.debug.fire();
    S.secs(0.5);
    offF?.();
    out.shotNear = { before, after: S.row(id).holding, alerted: alerted.includes(id), shot, weapon: p.currentWeapon };
    return out;
  });
  check(r.spawned, `spawnGroup('ga_hold') brings the holding soldier`);
  check(r.hold.state === 'idle' && r.hold.holding && r.hold.count === 1 && r.hold.active === 0 && r.hold.shots === 0, `holding: state idle, holding(group) 1, activeCount 0, never fired in 6 s with the player in sight (${JSON.stringify(r.hold)})`);
  check(r.release.alerted && r.release.count === 0, `release(group) → enemy:alerted, holding 0`);
  check(r.after.state !== 'idle' && r.after.aware && r.after.active >= 1, `released: AI running (${r.after.state}, activeCount ${r.after.active})`);
  check(r.hold.led === 'red' && r.after.led === 'red', `the Clasp mark red (blinking) in hold and in combat, never cyan`);
  check(r.shotNear.before && !r.shotNear.after && r.shotNear.alerted, `a pistol round passing within 1.5 m releases him by himself + enemy:alerted`);
  report.hold = r;
  // re-spawn after a reload (a checkpoint load is a fresh page): the group holds again
  await open();
  const rs = await ev(() => { const S = window.__S, E = window.__game.enemies; S.place(202, 0, 0, 0, 0); E.spawnGroup('ga_hold'); S.secs(2); return E.holding('ga_hold'); });
  check(rs === 1, `after a page reload spawnGroup('ga_hold') holds again (${rs})`);
}

// ───────────────────────────────────────────────────────────── 16 exits · 12 grating
async function caseExits() {
  console.log('══════════ 16 exits (player in the crawl) ══════════');
  const r = await ev(() => {
    const S = window.__S, g = window.__game, E = g.enemies, p = g.player, A = S.A;
    S.clear();
    S.place(227, 0, 6, 0, 0);
    const ids = [S.spawn(224, -8, 0, { arms: 'carbine' }), S.spawn(232, -8, 0, { arms: 'pistol' })];
    const husk = E.spawn('husk', new S.V(236, 0, -4), 0, 'th_1');
    S.secs(3);
    for (const id of ids) S.sol(id).debugSet({ aware: true });
    husk.alert?.();
    p.debug.crouch(true); S.secs(0.6);
    S.place(233, A.trench.floorY, 17, 0, 0);
    const crouchEye = +(p.eye.y - A.trench.floorY).toFixed(2);
    const dmg0 = S.damaged.length;
    S.secs(30);
    const ex = A.trench.exit;
    const pos = [...ids.map((id) => S.row(id).pos), [husk.position.x, husk.position.y, husk.position.z]];
    const dists = pos.map((q) => +Math.hypot(q[0] - ex[0], q[2] - ex[2]).toFixed(2));
    const inKeep = pos.map((q) => S.inBox(A.trench.keepOut, q));
    const huskHits = S.attacks.filter((a) => a.type === 'husk').length;
    return { dists, inKeep, huskHits, dmg: S.damaged.length - dmg0, pos, crouchEye };
  });
  check(r.dists.every((d) => d >= 1.9 && d <= 5.2), `every awake enemy stands 2–5 m from the exit (${r.dists.join(', ')})`);
  check(r.inKeep.every((x) => !x), `none inside the exit keep-out box`);
  check(r.dmg === 0, `no damage through the grating (${r.dmg} hits; husk attacks ${r.huskHits})`);
  report.exits = r;
  console.log('══════════ 12 grating ══════════');
  const gr = await ev(() => {
    const S = window.__S, g = window.__game, p = g.player, A = S.A;
    S.clear();
    const id = S.spawn(233, 17, Math.PI);
    p.debug.crouch(true); S.secs(0.6);
    S.place(233, A.trench.floorY, 17.6, 0, 0);
    const e = S.sol(id);
    S.secs(3);
    const sees = S.row(id).sees || S.row(id).aware;
    const los = g.physics.lineOfSight(p.eye, e.rig.eye);
    let dmg = 0;
    const on = (ev) => { if (ev.id === id) dmg++; };
    g.events.on('enemy:damaged', on);
    p.give('carbine', 100); p.debug.switchTo('carbine'); S.secs(1);
    const c = e.rig.chest;
    p.debug.aimLock(c.x, c.y, c.z);
    for (let i = 0; i < 6; i++) { p.weapons.carbine.clip = 30; p.debug.fire(); S.secs(0.2); }
    p.debug.aimLock(null);
    return { sees, los, dmg, eye: +(p.eye.y - A.trench.floorY).toFixed(2) };
  });
  check(!gr.sees && !gr.los, `soldier on the grating above, player crouched below (eye ${gr.eye} m over the crawl floor): no sight either way`);
  check(gr.dmg === 0, `the player's bullets stop at the grating (${gr.dmg} damage events)`);
  report.grating = gr;
}

// ───────────────────────────────────────────────────────────── 13 actor · 14 cost
async function caseActor() {
  console.log('══════════ 13 actor (puppet) ══════════');
  const r = await ev(async () => {
    const S = window.__S, g = window.__game, E = g.enemies, V = S.V;
    S.clear();
    const a = E.actor('soldier', new V(210, 0, -4), 0, 'hold', { name: 'BREKKE' });
    let done = false;
    a.moveTo(new V(214, 0, -4), 1.4).then(() => { done = true; });
    S.secs(5);
    await new Promise((r) => setTimeout(r, 0));   // the promise settles outside the synchronous stepping
    a.setPose('walk'); a.lookAt(new V(212, 1.6, 0)); a.speak(2); a.setEyes(false); a.prop?.('led', 'fail'); a.setPose('hold');
    S.secs(0.5);
    const inAll = E.all.includes(a);
    a.remove();
    return { done, inAll };
  });
  check(r.done && !r.inAll, `actor: moveTo resolves, poses / lookAt / speak / setEyes / prop run, not in enemies.all`);
  console.log('══════════ 14 cost ══════════');
  const c = await ev(() => {
    const S = window.__S, g = window.__game, E = g.enemies, V = S.V;
    S.clear();
    S.place(227, 0, 8, 0, 0);
    for (const [x, z] of [[220, -18], [226, -20], [232, -19], [238, -18], [229, -15]]) S.spawn(x, z, 0, { arms: 'carbine', cover: 'yard' });
    for (const [x, z] of [[216, 2], [238, 2], [222, 12], [234, 12]]) { const h = E.spawn('husk', new V(x, 0, z), 0, 'th_c'); h.alert?.(); }
    S.secs(3);
    for (const r of E.debug.soldiers()) S.sol(r.id).debugSet({ aware: true });
    S.ms = 0; S.frames = 0;
    S.secs(12);
    return { ms: S.ms / S.frames, frames: S.frames };
  });
  check(c.ms <= 1.5, `5 soldiers + 4 husks fighting: enemies update ${fmt(c.ms, 3)} ms / frame (≤ 1.5; headless — MEDIUM on a real GPU is the target)`);
  report.cost = c;
}

// ───────────────────────────────────────────────────────────── --watch
async function watch() {
  const secs = Number(args.seconds ?? 24);
  const dir = 'shots/soldier';
  mkdirSync(dir, { recursive: true });
  console.log(`══════════ watch: ${secs} s at 10 fps → ${dir}/ (${args.fp ? 'player view' : 'observer view'}) ══════════`);
  await ev((obs) => { window.__OBS = obs; }, !args.fp);
  await ev(() => {
    const S = window.__S, g = window.__game, p = g.player;
    S.clear();
    S.place(227, 0, 0, 0, 0);
    p.give('carbine', 200); p.debug.switchTo('carbine');
    const id = S.spawn(228, -20, 0, { arms: 'carbine', cover: 'yard' });
    window.__W = { id, t: 0, leg: 0 };
    // the observer: every rendered frame is drawn from a camera 7 m to the soldier's side, 3 m up, tracking him (the
    // game itself still runs on the player's camera); the viewmodel (camera children) is hidden for that draw
    if (window.__OBS) {
      const cam = g.camera, r0 = g.render.render.bind(g.render);
      const sv = { p: cam.position.clone(), q: cam.quaternion.clone() }, at = new S.V(), eye = new S.V();
      g.render.render = (dt) => {
        const e = S.sol(id);
        if (!e) return r0(dt);
        sv.p.copy(cam.position); sv.q.copy(cam.quaternion);
        const vis = cam.children.map((c) => c.visible);
        cam.children.forEach((c) => { c.visible = false; });
        at.set(e.position.x, e.position.y + 1.0, e.position.z);
        // beside and in front of him (the player's side), kept inside the arena walls
        const sx = e.position.x > 229 ? -1 : 1;
        eye.set(Math.min(242.5, Math.max(209.5, e.position.x + sx * 4.5)), 2.6, Math.min(22, e.position.z + 6));
        cam.position.copy(eye); cam.lookAt(at); cam.updateMatrixWorld(true);
        r0(dt);
        cam.position.copy(sv.p); cam.quaternion.copy(sv.q); cam.updateMatrixWorld(true);
        cam.children.forEach((c, i) => { c.visible = vis[i]; });
      };
    }
  });
  // the scripted player: walks between four spots, looks at the soldier, fires taps when he sees his chest
  const spots = [[227, 0], [219, -2], [223, 2], [235, -1]];
  const t0 = Date.now();
  let k = 0;
  while ((Date.now() - t0) / 1000 < secs) {
    const sec = (Date.now() - t0) / 1000;
    const spot = spots[Math.floor(sec / 6) % spots.length];
    await ev(([x, z]) => {
      const S = window.__S, g = window.__game, p = g.player, W = window.__W, e = S.sol(W.id);
      if (!e) return;
      const dx = x - p.position.x, dz = z - p.position.z, l = Math.hypot(dx, dz);
      const c = e.alive ? e.rig.chest : e.position;
      const [yw, pi] = S.lookYP(p.eye, c);
      // strafe to the spot while looking at him
      p.teleport(p.position.clone().setY(p.position.y), yw, pi);
      if (l > 0.4) {
        const f = (-Math.sin(yw) * dx - Math.cos(yw) * dz) / l, s = (Math.cos(yw) * dx - Math.sin(yw) * dz) / l;
        p.debug.move(f, s, false);
      } else p.debug.move(0, 0, false);
      if (e.alive && g.physics.lineOfSight(p.eye, c) && Math.random() < 0.25) { p.weapons.carbine.clip = 30; p.debug.fire(); }
      e.health = Math.max(e.health, 40);
      p.health = 100;
    }, spot);
    await page.screenshot({ path: `${dir}/f${String(k).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 75 });
    k++;
    await page.waitForTimeout(Math.max(0, k * 100 - (Date.now() - t0)));
  }
  const log = await ev(() => window.__S.log().filter((l) => l.id === window.__W.id).map((l) => `${l.t.toFixed(2)} ${l.ev}${l.cover ? ' ' + l.cover : ''}${l.hit !== undefined ? (l.hit ? ' HIT' : ' miss') : ''}`));
  console.log(`  ${k} frames; soldier log:\n    ` + log.slice(0, 120).join('\n    '));
}

// ───────────────────────────────────────────────────────────── --real (level 5 as built)
async function real() {
  console.log('══════════ real level 5 ══════════');
  await page.goto(`${base}/?level=5&autostart=1&nostory=1&torch=inf`);
  await page.waitForFunction(() => window.__game?.ready && window.__game.state === 'playing', null, { timeout: 120000 });
  const info = await ev(() => { const g = window.__game; return { cover: g.level.cover.length, s1: g.level.enemySpawns.some((s) => s.group === 'g5_s1') }; });
  if (!info.cover || !info.s1) { console.log(`  skip: level 5 has ${info.cover} cover points, g5_s1 ${info.s1} (K's stub — run again on W4's greybox)`); return; }
  const r = await ev(() => {
    const g = window.__game, E = g.enemies, p = g.player, V = p.eye.constructor, DT = 1 / 60;
    const step = (n) => { for (let i = 0; i < n; i++) { g.time += DT; p.update(DT); g.level.update(DT); E.update(DT); } };
    g.events.on('player:damaged', () => { p.health = 100; });
    E.spawnGroup('g5_s1'); step(30);
    const s = E.all.find((e) => e.group === 'g5_s1');
    const out = { holding: E.holding('g5_s1'), state: s?.state };
    E.release('g5_s1'); step(600);
    out.after = E.debug.soldiers().find((r) => r.id === s.id);
    // the crawl exits: player at (26, −1.4, −16)
    p.teleport(new V(26, -1.35, -16), 0, 0); step(60 * 25);
    out.exit = E.debug.soldiers().map((r) => r.pos);
    return out;
  });
  check(r.holding === 1 && r.state === 'idle', `g5_s1 spawns holding (${r.holding}, ${r.state})`);
  check(r.after && r.after.aware, `released, he fights (${JSON.stringify(r.after)})`);
  const ex = [37.9, 0, -14.8];
  const d = r.exit.map((q) => Math.hypot(q[0] - ex[0], q[2] - ex[2]));
  check(d.every((x) => x >= 1.9 && x <= 5.2), `player in the crawl: soldiers 2–5 m from mk5_exit_spine (${d.map((x) => x.toFixed(2)).join(', ')})`);
  check(r.exit.every((q) => !(q[0] > 36.2 && q[0] < 38.6 && q[2] > -15.4 && q[2] < -14.2)), `none in the walkway box`);
}

// ───────────────────────────────────────────────────────────── run
if (args.real) { await real(); }
else {
  await open();
  if (args.watch) await watch();
  else {
    if (want('ttk')) await caseTTK();
    if (want('first')) await caseFirst();
    if (want('hitrate')) await caseHitrate();
    if (want('telegraph')) await caseTelegraph();
    if (want('cover')) await caseCover();
    if (want('supp')) await caseSupp();
    if (want('misses')) await caseMisses();
    if (want('cap')) await caseCap();
    if (want('death')) await caseDeath();
    if (want('perception')) await casePerception();
    if (want('exits') || want('grating')) await caseExits();
    if (want('actor') || want('cost')) await caseActor();
    const v = await ev(() => window.__S.violations);
    check(v.length === 0, `no soldier hit on a player he had no line to (${v.length})`);
    if (want('hold')) await caseHold();
    writeJson('soldier', 5, report);
  }
}
await browser.close();
if (problems.length) { console.log(`\n${problems.length} FAILED`); process.exit(1); }
console.log('\nall ok');
