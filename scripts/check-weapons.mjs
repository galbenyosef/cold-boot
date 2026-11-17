// Armour and carbine (docs/plans/stage-3b.md §8.2, §8.3). On a static build (vite build + vite preview).
//   node scripts/check-weapons.mjs [--url http://127.0.0.1:5173] [--only armour|carbine]
// Exit 1 on any failure.
//   armour  — precondition health 100 / armour 0: addArmor(50) → 50; damage(18) → health 94, armour 38;
//             armour 5 + damage(30) → armour 0, health 69, one break (player:armor → 0); vest refused at 100
//             ("Armour full", the vest stays); a plate is not collected at 100 and is at 90 (→ 100); the strap is
//             cancelled by damage (the vest stays) and completes in 0.8 s (+50 at its end); snapshot / restore keeps
//             armour; carry 37 → 37, 900 → 100, NaN → 0; `player:damaged.amount` = health actually lost; the HUD bar
//             width follows armour (when the HUD has one)
//   carbine — raise 0.38 s; hold fire 1.0 s → 10 ± 1 rounds; climb after 10 rounds 3.0°–4.5°, < 1.2° 1.0 s after
//             release; reload 2.2 s / empty 2.6 s (± 0.05); a husk at 8 m dies after exactly 5 body / 3 head hits, a
//             skitter after 1 (debug aim lock); switching / the wheel skip the unowned carbine; Digit3; ammo_carbine
//             +30 up to 180 (not collected when full); ≤ 1 muzzle light during a 30-round burst; pistol / shotgun
//             numbers unchanged
import { launch, parseArgs } from './lib/check-common.mjs';

const args = parseArgs();
const base = (args.url ?? process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const only = args.only ? new Set(args.only.split(',')) : null;
const want = (k) => !only || only.has(k);
const problems = [];
const bad = (m) => { problems.push(m); console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);
const check = (cond, m) => (cond ? ok(m) : bad(m));
const near = (a, b, e = 0.01) => typeof a === 'number' && Math.abs(a - b) <= e;

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => { bad(`pageerror: ${e.message}`); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

async function open(query) {
  await page.goto(`${base}/?autostart=1&nostory=1&noenemies=1${query}`);
  await page.waitForFunction(() => window.__game?.ready && window.__game.state === 'playing', null, { timeout: 120000 });
  await wait(1200);
  // event recorder (game-clock stamps from performance.now)
  await ev(() => {
    const g = window.__game;
    window.__w = { log: [] };
    for (const n of ['player:armor', 'player:damaged', 'pickup', 'story:toast', 'weapon:fired', 'weapon:reload', 'weapon:switched', 'weapon:empty']) {
      g.events.on(n, (e) => window.__w.log.push({ n, t: performance.now(), e: JSON.parse(JSON.stringify(e, (k, v) => (v && v.isVector3 ? [v.x, v.y, v.z] : v))) }));
    }
  });
}
const clearLog = () => ev(() => { window.__w.log.length = 0; });
const log = (n) => ev((n) => window.__w.log.filter((l) => !n || l.n === n), n);
/** A point on the floor `d` m in front of the player (yaw only). */
const ahead = (d) => ev((d) => { const p = window.__game.player; const s = Math.sin(p.yaw), c = Math.cos(p.yaw); return [p.position.x - s * d, p.position.y, p.position.z - c * d]; }, d);

// ───────────────────────────────────────────────────────────── armour
if (want('armour')) {
  console.log('══════════ armour (§8.2) ══════════');
  await open('&level=1');
  await ev(() => { const p = window.__game.player; p.health = 100; p.debug.setArmor(0); });
  await clearLog();
  const r1 = await ev(() => { const p = window.__game.player; const a = p.addArmor(50); return { a, armor: p.armor }; });
  const e1 = await log('player:armor');
  check(r1.a === 50 && r1.armor === 50 && e1.length === 1 && e1[0].e.armor === 50 && e1[0].e.delta === 50, `addArmor(50) → 50, one player:armor {50, +50}: ${JSON.stringify({ r1, e1: e1.map((l) => l.e) })}`);
  await clearLog();
  const r2 = await ev(() => { const p = window.__game.player; p.damage(18); return { health: p.health, armor: p.armor }; });
  const d2 = (await log('player:damaged'))[0]?.e;
  check(near(r2.health, 94) && near(r2.armor, 38), `damage(18) → health 94, armour 38: ${JSON.stringify(r2)}`);
  check(d2 && near(d2.amount, 6) && near(d2.absorbed, 12) && near(d2.armor, 38), `player:damaged = { amount 6 (health lost), absorbed 12, armor 38 }: ${JSON.stringify(d2)}`);
  await clearLog();
  const r3 = await ev(() => { const p = window.__game.player; p.debug.setArmor(5); p.damage(30); return { health: p.health, armor: p.armor }; });
  const a3 = await log('player:armor'), d3 = (await log('player:damaged'))[0]?.e;
  const breaks = a3.filter((l) => l.e.armor === 0 && l.e.delta < 0);
  check(near(r3.health, 69) && r3.armor === 0 && breaks.length === 1 && near(d3?.amount, 25) && near(d3?.absorbed, 5), `armour 5 + damage(30) → armour 0, health 69, one break: ${JSON.stringify({ r3, armorEvents: a3.map((l) => l.e), d3 })}`);
  const r3b = await ev(() => { const p = window.__game.player; p.damage(9); return { a: p.armor }; });
  const d3b = (await log('player:damaged')).at(-1)?.e;
  check(r3b.a === 0 && near(d3b?.amount, 9) && !(d3b?.absorbed > 0), `no armour: the whole hit is health: ${JSON.stringify(d3b)}`);

  // vest refused at 100; plate not taken at 100, taken at 90
  await ev(() => { const p = window.__game.player; p.health = 100; p.debug.setArmor(100); });
  const vp = await ahead(0.9);
  await ev(([x, y, z]) => window.__game.player.debug.spawnPickup('vest', x, y + 1.4, z, 50), vp);
  await wait(200);
  await clearLog();
  const vid = await ev(() => { const p = window.__game.player; const it = window.__game.interactables.all.find((i) => i.prompt === 'Put on vest'); if (!it) return null; window.__game.interactables.use(it); return it.id; });
  await wait(300);
  const toasts = (await log('story:toast')).map((l) => l.e.text);
  check(vid && toasts.includes('Armour full') && (await ev((id) => window.__game.player.pickups.has(id), vid)) && (await ev(() => window.__game.player.debug.strap())) === -1,
    `vest refused at 100: "Armour full", no strap, the vest stays: ${JSON.stringify({ vid, toasts })}`);
  const pp = await ev(() => { const p = window.__game.player; const f = p.position; p.debug.spawnPickup('plate', f.x, f.y + 0.1, f.z, 15); return p.pickups.remaining.filter((s) => s.kind === 'plate').map((s) => s.id); });
  await wait(500);
  const plateLeft = await ev((ids) => ids.filter((id) => window.__game.player.pickups.has(id)).length, pp);
  check(pp.length === 1 && plateLeft === 1, `plate not collected at armour 100`);
  await clearLog();
  await ev(() => window.__game.player.debug.setArmor(90));
  await wait(500);
  const plateNow = await ev((ids) => ({ left: ids.filter((id) => window.__game.player.pickups.has(id)).length, armor: window.__game.player.armor }), pp);
  const pa = (await log('player:armor')).map((l) => l.e);
  check(plateNow.left === 0 && plateNow.armor === 100 && pa.length === 1 && pa[0].delta === 10, `plate taken at 90 → 100 (+10): ${JSON.stringify({ plateNow, pa })}`);

  // strap: cancelled by damage (vest stays), then completes in 0.8 s
  await ev(() => { const p = window.__game.player; p.health = 100; p.debug.setArmor(0); });
  await clearLog();
  await ev((id) => window.__game.interactables.use(window.__game.interactables.get(id)), vid);
  await wait(300);
  const mid = await ev(() => ({ strap: window.__game.player.debug.strap(), stowed: window.__game.player.debug.state().stowed }));
  await ev(() => window.__game.player.damage(1));
  await wait(100);
  const after = await ev((id) => ({ strap: window.__game.player.debug.strap(), has: window.__game.player.pickups.has(id), armor: window.__game.player.armor }), vid);
  check(mid.strap > 0 && mid.stowed && after.strap === -1 && after.has && after.armor === 0, `strap runs with the weapon lowered, damage cancels it, the vest stays: ${JSON.stringify({ mid, after })}`);
  await clearLog();
  const t0 = await ev((id) => { window.__game.interactables.use(window.__game.interactables.get(id)); return performance.now(); }, vid);
  await page.waitForFunction(() => window.__game.player.armor > 0, null, { timeout: 5000 }).catch(() => {});
  const ae = (await log('player:armor'))[0];
  const pk = (await log('pickup')).find((l) => l.e.kind === 'vest');
  const dur = ae ? (ae.t - t0) / 1000 : -1;
  check(ae && ae.e.delta === 50 && ae.e.armor === 50 && pk && !(await ev((id) => window.__game.player.pickups.has(id), vid)) && dur > 0.7 && dur < 1.0,
    `strap completes: +50 at its end (${dur.toFixed(2)} s), vest taken, pickup event: ${JSON.stringify(ae?.e)}`);

  // snapshot / restore / carry
  const sr = await ev(() => {
    const p = window.__game.player;
    p.debug.setArmor(37);
    const snap = p.snapshot();
    p.debug.setArmor(0);
    p.restore(snap);
    const restored = p.armor;
    const carry = [];
    for (const a of [37, 900, NaN]) { p.debug.setArmor(0); p.applyLoadout({ armor: a }); carry.push(p.armor); }
    p.debug.setArmor(12); p.applyLoadout({ flashlight: true }); const kept = p.armor;
    return { snapArmor: snap.armor, restored, carry, kept };
  });
  check(sr.snapArmor === 37 && sr.restored === 37, `snapshot / restore keeps armour 37: ${JSON.stringify(sr)}`);
  check(sr.carry[0] === 37 && sr.carry[1] === 100 && sr.carry[2] === 0 && sr.kept === 12, `carry 37 → 37, 900 → 100, NaN → 0; a loadout without armour leaves it: ${JSON.stringify(sr.carry)}`);

  // HUD bar width ∝ armour (W2a's bar; skipped with a note while the HUD has none)
  const hud = [];
  for (const a of [37, 100]) {
    await ev((a) => window.__game.player.debug.setArmor(a), a);
    await wait(250);
    hud.push(await ev(() => {
      const els = [...document.querySelectorAll('[class*="armo"]')];
      for (const el of els) {
        for (const c of [el, ...el.querySelectorAll('*')]) {
          const w = c.style?.width;
          if (w && w.endsWith('%')) return parseFloat(w);
          const tf = c.style?.transform;
          const m = tf && /scaleX\(([\d.]+)\)/.exec(tf);
          if (m) return parseFloat(m[1]) * 100;
        }
      }
      return null;
    }));
  }
  if (hud[0] === null || hud[1] === null) console.log(`  note HUD armour bar not found (W2a) — width check skipped`);
  else check(near(hud[0] / hud[1], 0.37, 0.02), `HUD armour bar width ∝ armour (37 → ${hud[0]}%, 100 → ${hud[1]}%)`);
}

// ───────────────────────────────────────────────────────────── carbine
if (want('carbine')) {
  console.log('══════════ carbine (§8.3) ══════════');
  await open('&level=1&god=1');
  // unowned: Digit3 / switchTo / the wheel never select it
  const un = await ev(async () => {
    const p = window.__game.player;
    const out = { owned: p.weapons.carbine.owned };
    p.give('pistol', 12); p.give('shotgun', 6);
    await new Promise((r) => setTimeout(r, 800));
    p.debug.switchTo('carbine');
    await new Promise((r) => setTimeout(r, 600));
    out.afterSwitch = p.currentWeapon;
    const seen = new Set();
    for (let i = 0; i < 4; i++) { window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 })); await new Promise((r) => setTimeout(r, 700)); seen.add(p.currentWeapon); }
    out.wheel = [...seen];
    return out;
  });
  check(!un.owned && un.afterSwitch !== 'carbine' && !un.wheel.includes('carbine') && un.wheel.length === 2, `unowned carbine is skipped by switching and the wheel: ${JSON.stringify(un)}`);
  // ammo pickup cap
  const am = await ev(async () => {
    const p = window.__game.player;
    p.give('carbine', 30);
    p.weapons.carbine.reserve = 170;
    p.give('ammo_carbine', 30);
    const capped = p.weapons.carbine.reserve;
    const f = p.position;
    p.debug.spawnPickup('ammo_carbine', f.x, f.y + 0.1, f.z, 30);
    const id = p.pickups.remaining.filter((s) => s.kind === 'ammo_carbine').at(-1).id;
    await new Promise((r) => setTimeout(r, 500));
    const stays = p.pickups.has(id);
    p.weapons.carbine.reserve = 100;
    await new Promise((r) => setTimeout(r, 500));
    return { capped, stays, taken: !p.pickups.has(id), reserve: p.weapons.carbine.reserve };
  });
  check(am.capped === 180 && am.stays && am.taken && am.reserve === 130, `ammo_carbine +30 up to 180, not collected when full: ${JSON.stringify(am)}`);
  // wheel now reaches it; Digit3 selects it
  const wh = await ev(async () => {
    const p = window.__game.player;
    p.debug.switchTo('pistol'); await new Promise((r) => setTimeout(r, 900));
    const seen = [];
    for (let i = 0; i < 3; i++) { window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 })); await new Promise((r) => setTimeout(r, 900)); seen.push(p.currentWeapon); }
    return seen;
  });
  check(JSON.stringify(wh) === JSON.stringify(['shotgun', 'carbine', 'pistol']), `wheel pistol → shotgun → carbine → pistol: ${JSON.stringify(wh)}`);
  await page.keyboard.down('Digit3'); await wait(80); await page.keyboard.up('Digit3');
  // raise time
  const raise = await ev(async () => {
    const p = window.__game.player;
    const t0 = performance.now();
    let tSwitch = null, tUp = null;
    while (performance.now() - t0 < 3000) {
      await new Promise((r) => requestAnimationFrame(r));
      const s = p.debug.state();
      if (tSwitch === null && s.weapon === 'carbine') tSwitch = performance.now();
      if (tSwitch !== null && s.lower === 0) { tUp = performance.now(); break; }
    }
    return { weapon: p.currentWeapon, raise: tUp && tSwitch ? (tUp - tSwitch) / 1000 : null };
  });
  check(raise.weapon === 'carbine' && raise.raise !== null && raise.raise > 0.3 && raise.raise < 0.5, `Digit3 selects the carbine; raise ${raise.raise?.toFixed(2)} s (0.38)`);

  // numbers of the others
  const stats = await ev(() => window.__game.player.debug.stats());
  check(JSON.stringify(stats.pistol) === JSON.stringify({ clipSize: 12, damage: 20, interval: 0.14, range: 90, baseSpread: 0.0025, bloom: 0.011, noise: 30, maxReserve: 96, light: 70 })
    && JSON.stringify(stats.shotgun) === JSON.stringify({ clipSize: 6, damage: 9, pellets: 9, interval: 0.25, range: 45, cone: 0.062, noise: 42, maxReserve: 36, light: 140 }), `pistol / shotgun numbers unchanged`);
  check(stats.carbine.clipSize === 30 && stats.carbine.damage === 18 && stats.carbine.interval === 0.1 && stats.carbine.maxReserve === 180, `carbine numbers: ${JSON.stringify(stats.carbine)}`);

  // 1.0 s of held fire: rounds, climb, recovery, muzzle lights
  const burst = async (seconds, stopAfter = 0) => ev(async ([seconds, stopAfter]) => {
    const g = window.__game, p = g.player;
    p.weapons.carbine.clip = 30; p.weapons.carbine.reserve = 180;
    p.pitch = 0;
    await new Promise((r) => setTimeout(r, 600)); // bloom / recovery settle
    const p0 = p.pitch;
    const shots = [];
    const off = g.events.on('weapon:fired', () => shots.push({ t: performance.now(), pitch: p.pitch }));
    let maxMuzzle = 0, maxFx = 0;
    p.debug.hold(true);
    const t0 = performance.now();
    let pitch10 = null;
    while (performance.now() - t0 < seconds * 1000 && !(stopAfter && shots.length >= stopAfter)) {
      await new Promise((r) => requestAnimationFrame(r));
      maxMuzzle = Math.max(maxMuzzle, p.debug.muzzleLights());
      maxFx = Math.max(maxFx, g.render.lights.group('fx_flash').filter((h) => h.enabled).length);
    }
    p.debug.hold(false);
    const tRel = performance.now();
    const n = shots.length;
    if (n >= 10) { const t10 = shots[9].t; while (performance.now() - t10 < 100) await new Promise((r) => requestAnimationFrame(r)); pitch10 = p.pitch; }
    const atRelease = p.pitch;
    while (performance.now() - tRel < 1000) await new Promise((r) => requestAnimationFrame(r));
    off?.();
    return { n, p0, climb10: pitch10 === null ? null : (pitch10 - p0) * 180 / Math.PI, peak: (atRelease - p0) * 180 / Math.PI, residual: (p.pitch - p0) * 180 / Math.PI, maxMuzzle, maxFx, fps: g.debug.fps };
  }, [seconds, stopAfter]);
  const b1 = await burst(1.0);
  check(b1.n >= 9 && b1.n <= 11, `hold fire 1.0 s → ${b1.n} rounds (10 ± 1) @ ${b1.fps} fps`);
  const b2 = await burst(2.0, 10);
  check(b2.climb10 !== null && b2.climb10 >= 3.0 && b2.climb10 <= 4.5, `climb after 10 rounds ${b2.climb10?.toFixed(2)}° (3.0–4.5)`);
  check(b2.n === 10 && Math.abs(b2.residual) < 1.2, `10-round burst, 1.0 s after release ${b2.residual.toFixed(2)}° left (< 1.2; peak ${b2.peak.toFixed(2)}°)`);
  const b3 = await burst(3.3);
  check(b3.n === 30 && b3.maxMuzzle <= 1, `30-round burst: ${b3.n} rounds, ≤ 1 muzzle light (max ${b3.maxMuzzle}; fx_flash pool max ${b3.maxFx})`);

  // reloads
  const reloadTime = (clip) => ev(async (clip) => {
    const p = window.__game.player;
    p.debug.aimLock(null);
    p.weapons.carbine.clip = clip; p.weapons.carbine.reserve = 120;
    if (clip === 0) { p.weapons.carbine.clip = 1; p.debug.fire(); await new Promise((r) => setTimeout(r, 400)); }
    await new Promise((r) => setTimeout(r, 300));
    p.debug.reload();
    let t0 = null, t1 = null;
    const s = performance.now();
    while (performance.now() - s < 5000) {
      await new Promise((r) => requestAnimationFrame(r));
      const r = p.weapons.carbine.reloading;
      if (r && t0 === null) t0 = performance.now();
      if (!r && t0 !== null) { t1 = performance.now(); break; }
    }
    return { dur: t0 && t1 ? (t1 - t0) / 1000 : null, clip: p.weapons.carbine.clip, reserve: p.weapons.carbine.reserve, charger: p.debug.state().charger };
  }, clip);
  const rl = await reloadTime(12);
  const ev1 = (await log('weapon:reload')).at(-1)?.e;
  check(rl.dur !== null && Math.abs(rl.dur - 2.2) <= 0.05 + 1 / 30 && rl.clip === 30 && rl.reserve === 102 && ev1?.duration === 2.2, `reload ${rl.dur?.toFixed(3)} s (2.2), 12 → 30, event duration ${ev1?.duration}`);
  const re = await reloadTime(0);
  const ev2 = (await log('weapon:reload')).at(-1)?.e;
  check(re.dur !== null && Math.abs(re.dur - 2.6) <= 0.05 + 1 / 30 && re.clip === 30 && !re.charger && ev2?.duration === 2.6, `empty reload ${re.dur?.toFixed(3)} s (2.6), charging handle released, event duration ${ev2?.duration}`);

  // TTK at 8 m (aim lock, single shots)
  const ttk = async (type, part) => {
    const at = await ahead(8);
    return ev(async ([type, part, at]) => {
      const g = window.__game, p = g.player, T = g.THREE ?? p.eye.constructor;
      for (const e of g.enemies.all) if (e.alive && e.group === 'w1test') e.object.visible = false;
      const pos = new p.eye.constructor(at[0], at[1], at[2]);
      const e = g.enemies.spawn(type, pos, p.yaw, 'w1test');
      await new Promise((r) => setTimeout(r, 900));
      // find a point on the wanted part: scan a vertical line through the machine
      const eye = p.eye.clone(), dir = p.eye.clone();
      let target = null;
      const hits = [];
      for (let y = 0.05; y < 2.1; y += 0.02) {
        const tp = new p.eye.constructor(e.position.x, e.position.y + y, e.position.z);
        dir.copy(tp).sub(eye).normalize();
        const h = g.enemies.hitscan(eye, dir, 20);
        if (h && h.enemy === e) hits.push({ y, part: h.part });
      }
      if (!hits.some((h) => h.part === part)) return { err: `no ${part} found`, parts: [...new Set(hits.map((h) => h.part))] };
      // re-aim at the middle of the part before every shot (a hit knocks the head about)
      const aim = () => {
        const mine = [];
        for (let y = 0.05; y < 2.1; y += 0.01) {
          const tp = new p.eye.constructor(e.position.x, e.position.y + y, e.position.z);
          dir.copy(tp).sub(eye).normalize();
          const h = g.enemies.hitscan(eye, dir, 20);
          if (h && h.enemy === e && h.part === part) mine.push(y);
        }
        if (!mine.length) return false;
        const y = mine[Math.floor(mine.length / 2)];
        target = [e.position.x, e.position.y + y, e.position.z];
        p.debug.aimLock(target[0], target[1], target[2]);
        return true;
      };
      p.weapons.carbine.clip = 30;
      const dist = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
      let n = 0;
      while (e.alive && n < 12) {
        for (let k = 0; k < 20 && !aim(); k++) await new Promise((r) => setTimeout(r, 50));
        p.debug.fire(); n++;
        await new Promise((r) => setTimeout(r, 120));
        for (let k = 0; k < 30 && e.alive; k++) { await new Promise((r) => setTimeout(r, 50)); if (aim()) { await new Promise((r) => setTimeout(r, 300)); aim(); break; } }
      }
      p.debug.aimLock(null);
      return { n, alive: e.alive, dist: +dist.toFixed(2), part };
    }, [type, part, at]);
  };
  await ev(() => window.__game.player.debug.switchTo('carbine'));
  await wait(600);
  const tb = await ttk('husk', 'torso');
  check(tb.n === 5 && !tb.alive, `husk at 8 m dies after exactly 5 body hits: ${JSON.stringify(tb)}`);
  const th = await ttk('husk', 'head');
  check(th.n === 3 && !th.alive, `husk at 8 m dies after exactly 3 head hits: ${JSON.stringify(th)}`);
  const ts = await ttk('skitter', 'torso').then((r) => (r.err ? ttk('skitter', 'body') : r)).then((r) => (r.err ? ttk('skitter', 'core') : r));
  check(ts.n === 1 && !ts.alive, `skitter at 8 m dies after 1 hit: ${JSON.stringify(ts)}`);
}

await browser.close();
console.log(problems.length ? `\ncheck-weapons: ${problems.length} FAILED` : '\ncheck-weapons: all passed');
process.exit(problems.length ? 1 : 0);
