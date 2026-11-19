// The level chain + save/carry schema v2 (docs/plans/stage-3a.md §8.1, §7; stage 3b docs/plans/stage-3b.md §8.1;
// stage 3c docs/plans/stage-3c.md §8.1; stage 3d docs/plans/stage-3d.md §8.1).
//   node scripts/check-chain.mjs [--url http://127.0.0.1:5173] [--only grep|boot|chain|chain5|menu|storage]
// On a static build (vite build + vite preview), like the playthroughs. Exit 1 on any failure.
//   grep    — no binary level branch in src (allow-list: scripts/levelgrep-allow.txt)
//   boot    — every built level (1–6) boots directly; ?level=7/9 clamp to 6; bad ?level= → stored level; a stored 6
//             boots 6; ?level=3 … ?level=6 direct-start loadout + facts (+ armour 0 / 50, carbine on 5 and 6), ?choice= /
//             ?units=; level 5's HUD shows the carbine, the armour bar and the flashlight cell meter
//   chain   — L1 → L2 carry; L2 → L3 for both choices (carry + facts written, L2 save gone, no TO BE CONTINUED);
//             L2 → L3 real hand-over (reload, one click); L3 end WITHOUT `?next=` (LEVELS[3].next = 4): the live
//             hand-over (carry incl. testHour, stored 4, card without TO BE CONTINUED, reload into level 4 with the
//             carry); L3 → L4 through the test override `?next=3:4&handoff=1` for
//             both choices (card without TBC, stored 4, L3/L4 saves gone, level 4 arrives with weapons, health,
//             flashlight, facts, testHour, armour); carried armour 37 → 37, 900 → 100, NaN → 0;
//             L3 → L4 real hand-over (reload keeps `next`)
//   chain5  — (stage 3c A1, 3d K) L4 → L5 LIVE (`LEVELS[4].next = 5`, no `?next=`) for both choices (card without TBC,
//             stored 5, L4/L5 saves gone, level 5 arrives with weapons incl. the carbine, health (floor 50), armour,
//             flashlight, facts, testHour; the cell is NOT carried — level 5 starts full); carried armour 37 → 37,
//             900 → 100, NaN → 0 (4 → 5); L4 → L5 real hand-over (store + reload, one click); L5 end WITHOUT `?next=`
//             (3d IA: LEVELS[5].next = 6 LIVE — carry from 5 incl. kills5 + testHour + radio, stored level 6, card
//             POST 4 alone); L5 → L6 LIVE (no `?next=`) for both choices (the card POST 4 alone, stored 6, L5/L6 saves
//             gone, level 6 arrives with weapons, health, armour, the lamp, facts incl. radio + testHour; a full cell);
//             carried armour 37 / 900 / NaN (5 → 6); a carry from 4 does not lead into level 6; the test override
//             `?next=5:6` still hands over; L5 → L6 real hand-over (store + reload, no `?next=`); L6 end (carry from 6 incl. kills6 + testHour, stored level 6, THE TRUNK / TO BE
//             CONTINUED then END OF CHAPTER 3); the stub's end button
//   menu    — stored level 3 / 4 / 5 / 6: CONTINUE with and without a checkpoint, the chapter line; BEGIN → level 1,
//             all cleared
//   storage — v1 save + carry discarded once; corrupt / wrong-chain carry ignored; a carry without `carbine` loads
//             it unowned; level-3 checkpoint round trip; a level-3 checkpoint written before stage 3b (no carbine,
//             no armour) restores; a level-4 checkpoint written before stage 3c K restores (and one with a corrupt
//             story record is discarded); a level-5 checkpoint round trip; a level-5 checkpoint written before 3d's K
//             restores; a level-6 checkpoint round trip (and one with a corrupt boss record is discarded)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { launch, parseArgs } from './lib/check-common.mjs';

const args = parseArgs();
const base = (args.url ?? process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const only = args.only ? new Set(args.only.split(',')) : null;
const want = (k) => !only || only.has(k);
const problems = [];
const bad = (m) => { problems.push(m); console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);
const check = (cond, m) => (cond ? ok(m) : bad(m));

// ───────────────────────────────────────────────────────────── grep
if (want('grep')) {
  console.log('══════════ level grep ══════════');
  const PATTERN = /levelId|storedLevel|=== 2|!== 1|=== '2'|lvl2|\blevel\s*[!=]==\s*\d/;
  const allow = readFileSync('scripts/levelgrep-allow.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf(' :: '); return { file: l.slice(0, i), sub: l.slice(i + 4), used: false }; });
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
  walk('src');
  let hits = 0;
  for (const f of files) {
    if (/^src\/[^/]+\/l\d+\//.test(f) || f === 'src/core/progress.ts' || f.includes('/dev/')) continue; // level folders, the chain table, dev harness pages
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (!PATTERN.test(line)) return;
      hits++;
      const as = allow.filter((e) => e.file === f && line.includes(e.sub));
      for (const a of as) a.used = true;
      if (!as.length) bad(`binary level branch? ${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  for (const a of allow) if (!a.used) console.log(`  note stale allow-list entry: ${a.file} :: ${a.sub}`);
  check(problems.length === 0, `${hits} pattern hits in ${files.length} files, all allow-listed`);
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(e.message); console.log(`  [pageerror] ${e.message}`); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const KEYS = { level: 'coldboot.level', carry: 'coldboot.carry.v2', save: (n) => `coldboot.save.l${n}.v2` };
const SKEYS = { level: KEYS.level, carry: KEYS.carry };

async function open(query, { ready = true } = {}) {
  for (let i = 0; ; i++) {
    try { await page.goto(`${base}/${query}`); break; } catch (e) { if (i >= 2) throw e; await wait(700); }
  }
  if (ready) await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
}
/** Fresh storage: load any page of the origin, clear both storages. */
async function wipe() {
  if (!page.url().startsWith(base)) await open('?autostart=1&nostory=1&noenemies=1');
  await ev(() => { localStorage.clear(); sessionStorage.clear(); });
}
const store = () => ev((K) => ({
  level: localStorage.getItem(K.level), carry: JSON.parse(localStorage.getItem(K.carry) ?? 'null'),
  saves: [1, 2, 3, 4, 5, 6].filter((n) => localStorage.getItem(`coldboot.save.l${n}.v2`) !== null),
  v1: ['coldboot.save.v1', 'coldboot.save.l2.v1', 'coldboot.carry'].filter((k) => localStorage.getItem(k) !== null),
}), SKEYS);
const game = () => ev(() => {
  const g = window.__game, p = g.player, d = g.story.debugState ?? {};
  return {
    level: g.levelId, state: g.state, facts: { ...g.facts }, health: Math.round(p.health), flashlight: p.flashlightOn, current: p.currentWeapon,
    weapons: Object.fromEntries(Object.entries(p.weapons).map(([k, w]) => [k, { owned: w.owned, clip: w.clip, reserve: w.reserve }])),
    restoredFrom: d.restoredFrom ?? null, loadout: d.loadout ?? null, url: location.search,
    armor: p.armor, arrival: d.arrival ?? null,
  };
});
/** Is the player's armour live (W1) or still K's stub (`addArmor` → 0)? Probed once on a level-4 page. */
let armorLive = null;
async function probeArmor() {
  if (armorLive !== null) return armorLive;
  await open('?level=4&autostart=1&god=1&nostory=1&noenemies=1'); await wait(500);
  armorLive = await ev(() => { const p = window.__game.player; const a = p.addArmor(10); return a === 10 && p.armor === 10; });
  console.log(`  note player armour is ${armorLive ? 'live (W1)' : "K's stub: arrival armour is checked on the story's record"}`);
  return armorLive;
}
/** The armour level 4 arrived with: the player's (live) or the story's arrival record (stub player). */
const arrivalArmor = (g) => (armorLive ? g.armor : g.arrival?.armor ?? null);
// the card's own text (falls back to the whole overlay when no `.card` element exists)
const cardText = () => ev(() => {
  const cards = [...document.querySelectorAll('.cb .card')].map((e) => e.innerText).join(' ').trim();
  return (cards || document.querySelector('.cb')?.innerText || '').replace(/\s+/g, ' ');
});
const until = async (fn, ms, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ───────────────────────────────────────────────────────────── boot
if (want('boot')) {
  console.log('══════════ direct boots ══════════');
  await wipe();
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const before = pageErrors.length;
    await open(`?level=${n}&autostart=1&god=1`); await wait(1500);
    const g = await game();
    check(g.level === n && g.state === 'playing' && pageErrors.length === before, `?level=${n} boots level ${n} and plays (${g.state}, ${pageErrors.length - before} page errors)`);
    await wipe();
  }
  for (const [q, n] of [['?level=9', 6], ['?level=7', 6]]) {
    await open(`${q}&autostart=1&god=1`); await wait(800);
    const g = await game();
    check(g.level === n, `${q} clamps to level ${n} (got ${g.level})`);
  }
  await ev((K) => localStorage.setItem(K.level, '2'), SKEYS);
  for (const q of ['?level=abc', '?level=0', '?level=-1', '?level=']) {
    await open(`${q}&autostart=1&god=1`); await wait(800);
    check((await game()).level === 2, `${q} falls back to the stored level (2)`);
  }
  await ev((K) => localStorage.setItem(K.level, 'garbage'), SKEYS);
  await open('?autostart=1&god=1'); await wait(800);
  check((await game()).level === 1, 'a garbage stored level boots level 1');
  await ev((K) => localStorage.setItem(K.level, '6'), SKEYS);
  await open('?autostart=1&god=1'); await wait(800);
  check((await game()).level === 6, 'a stored level 6 boots level 6');
  await ev((K) => localStorage.setItem(K.level, '8'), SKEYS);
  await open('?autostart=1&god=1'); await wait(800);
  check((await game()).level === 6, 'a stored level above 6 (8) clamps to level 6');
  await ev((K) => localStorage.setItem(K.level, '5'), SKEYS);
  await open('?autostart=1&god=1'); await wait(800);
  check((await game()).level === 5, 'a stored level 5 boots level 5');
  await wipe();

  console.log('══════════ ?level=3 direct start ══════════');
  await open('?level=2&autostart=1&god=1'); await wait(1000);
  const l2direct = (await game()).weapons;
  await open('?level=3&autostart=1&god=1'); await wait(1200);
  let g = await game();
  check(eq(g.facts, { choice: 'stop', unitsLeft: 28 }), `default facts ${JSON.stringify(g.facts)}`);
  const w = g.weapons;
  // §7 "pistol 12 + 24, shotgun 6 + 8" = level 2's direct start (give(weapon, 12) + give(ammo, 24) …)
  check(g.loadout === 'direct' && w.pistol.owned && w.shotgun.owned && eq(w, l2direct) && g.health === 100 && g.flashlight,
    `direct loadout = level 2's direct start, health 100, flashlight on: ${JSON.stringify({ w, l2direct, health: g.health, flashlight: g.flashlight, loadout: g.loadout })}`);
  await open('?level=3&autostart=1&god=1&choice=command&units=20'); await wait(1000);
  g = await game();
  check(eq(g.facts, { choice: 'command', unitsLeft: 20 }), `?choice=command&units=20 → ${JSON.stringify(g.facts)}`);
  await open('?level=3&autostart=1&god=1&choice=bogus'); await wait(800);
  check((await game()).facts.choice === 'stop', 'an unknown ?choice= is ignored');
  await wipe();

  console.log('══════════ ?level=4 direct start ══════════');
  await open('?level=4&autostart=1&god=1'); await wait(1200);
  g = await game();
  check(eq(g.facts, { choice: 'stop', unitsLeft: 28, badge: true, halvorsenAlive: true }), `default facts ${JSON.stringify(g.facts)}`);
  check(g.loadout === 'direct' && eq(g.weapons, { ...l2direct, carbine: { owned: false, clip: 0, reserve: 0 } }) && g.health === 100 && g.flashlight && g.armor === 0,
    `direct loadout = pistol 12 + 24, shotgun 6 + 8, no carbine, health 100, flashlight on, armour 0: ${JSON.stringify({ w: g.weapons, health: g.health, flashlight: g.flashlight, armor: g.armor, loadout: g.loadout })}`);
  await open('?level=4&autostart=1&god=1&choice=command&units=9'); await wait(1000);
  g = await game();
  check(eq(g.facts, { choice: 'command', unitsLeft: 9, badge: true, halvorsenAlive: true }), `?level=4&choice=command&units=9 → ${JSON.stringify(g.facts)}`);
  await wipe();

  console.log('══════════ ?level=5 direct start ══════════');
  await open('?level=5&autostart=1&god=1'); await wait(1200);
  g = await game();
  check(eq(g.facts, { choice: 'stop', unitsLeft: 28, badge: true, halvorsenAlive: true, testHour: 62.5 }), `default facts ${JSON.stringify(g.facts)}`);
  // §7 "pistol 12 + 24, shotgun 6 + 6, carbine 30 + 90", applied as pickups like every direct start (give(weapon, clip)
  // fills the clip and adds to the reserve, then give(ammo, reserve)): totals ≥ 36 / 12 / 120
  const w5 = g.weapons;
  check(g.loadout === 'direct' && w5.pistol.owned && w5.shotgun.owned && w5.carbine.owned && w5.pistol.clip === 12 && w5.shotgun.clip === 6 && w5.carbine.clip === 30
    && w5.pistol.clip + w5.pistol.reserve >= 36 && w5.shotgun.clip + w5.shotgun.reserve >= 12 && w5.carbine.clip + w5.carbine.reserve >= 120 && g.health === 100 && g.flashlight && g.armor === 50,
    `direct loadout = pistol 12 + 24, shotgun 6 + 6, carbine 30 + 90, health 100, flashlight on, armour 50: ${JSON.stringify({ w: w5, health: g.health, flashlight: g.flashlight, armor: g.armor, loadout: g.loadout })}`);
  check(g.arrival?.from === null && g.arrival?.armor === 50, `the story's arrival record: ${JSON.stringify(g.arrival)}`);
  await page.keyboard.press('Digit3'); await wait(900);
  const hud5 = await ev(() => {
    const vis = (el) => !!el && !el.closest('.off') && !el.closest('.hide') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    return {
      hud: vis(document.querySelector('.hud')), armour: vis(document.querySelector('.hud .armour')),
      armNum: document.querySelector('.hud .armour-num')?.textContent ?? null, cell: !!document.querySelector('.hud .cell'),
      current: window.__game.player.currentWeapon, charge: window.__game.player.flashlightCharge ?? null,
    };
  });
  check(hud5.hud && hud5.armour && hud5.armNum === '50' && hud5.cell && hud5.current === 'carbine' && hud5.charge > 0.5,
    `level 5 HUD: carbine held (Digit3), armour 50 shown, the flashlight cell meter, a full-ish cell: ${JSON.stringify(hud5)}`);
  await open('?level=5&autostart=1&god=1&choice=command&units=9'); await wait(1000);
  g = await game();
  check(eq(g.facts, { choice: 'command', unitsLeft: 9, badge: true, halvorsenAlive: true, testHour: 62.5 }), `?level=5&choice=command&units=9 → ${JSON.stringify(g.facts)}`);
  await wipe();

  console.log('══════════ ?level=6 direct start ══════════');
  const F6 = { choice: 'stop', unitsLeft: 28, badge: true, halvorsenAlive: true, radio: true, kessler: true, l5_door: true, l5_boat: false, kills5: 0, testHour: 62.75 };
  await open('?level=6&autostart=1&god=1'); await wait(1200);
  g = await game();
  check(eq(g.facts, F6), `default facts ${JSON.stringify(g.facts)}`);
  // §7.2: pistol 12 + 24, shotgun 6 + 6, carbine 30 + 90 → 12 / 36, 6 / 12, 30 / 120 through the pickup path
  const w6 = g.weapons;
  check(g.loadout === 'direct' && w6.pistol.clip === 12 && w6.pistol.reserve === 36 && w6.shotgun.clip === 6 && w6.shotgun.reserve === 12 && w6.carbine.clip === 30 && w6.carbine.reserve === 120
    && g.health === 100 && g.flashlight && g.armor === 50,
    `direct loadout = 12 / 36, 6 / 12, 30 / 120, health 100, flashlight on, armour 50: ${JSON.stringify({ w: w6, health: g.health, flashlight: g.flashlight, armor: g.armor, loadout: g.loadout })}`);
  check(g.arrival?.from === null && g.arrival?.armor === 50, `the story's arrival record: ${JSON.stringify(g.arrival)}`);
  await open('?level=6&autostart=1&god=1&choice=command&units=9'); await wait(1000);
  g = await game();
  check(eq(g.facts, { ...F6, choice: 'command', unitsLeft: 9 }), `?level=6&choice=command&units=9 → ${JSON.stringify(g.facts)}`);
  await wipe();
}

// ───────────────────────────────────────────────────────────── chain
async function l2End(choice, left) {
  // a level-2 checkpoint exists before the end: it must be gone afterwards, the carry written
  await ev(([k]) => localStorage.setItem(k, '{"v":2,"level":2,"placeholder":true}'), [KEYS.save(2)]);
  await ev(([c, l]) => { void window.__game.story.ending(c, 'spared', l); }, [choice, left]);
  await until(() => /TIME:/i.test(document.querySelector('.cb')?.innerText ?? ''), 15000);
  await wait(1500);
}
if (want('chain')) {
  console.log('══════════ L1 → L2 ══════════');
  await wipe();
  await ev((k) => localStorage.setItem(k, '{"v":2,"level":1}'), KEYS.save(1));
  await open('?level=1&autostart=1&god=1&handoff=1'); await wait(500);
  await ev(() => { const g = window.__game; g.player.give('pistol', 12); g.player.give('ammo_pistol', 7); g.story.handoff(); });
  let s = await store();
  check(s.level === '2' && s.carry?.v === 2 && s.carry.from === 1 && s.carry.weapons?.pistol?.owned && !s.carry.weapons.shotgun.owned && s.saves.length === 0,
    `level 1's hand-over stores level 2 + carry v2, clears the level-1 save: ${JSON.stringify({ level: s.level, from: s.carry?.from, saves: s.saves })}`);
  check(s.carry && eq(Object.keys(s.carry.weapons).sort(), ['carbine', 'pistol', 'shotgun']), 'carry weapons are a full record (every WeaponId)');
  await open('?autostart=1&god=1'); await wait(1000);
  let g = await game();
  check(g.level === 2 && g.weapons.pistol.owned && !g.weapons.shotgun.owned, `then level 2 boots with the carried loadout: ${JSON.stringify({ level: g.level, w: g.weapons })}`);

  for (const [choice, fact, left] of [['shutdown', 'stop', 27], ['rewrite', 'command', 31]]) {
    console.log(`══════════ L2 (${choice}) → L3 ══════════`);
    await wipe();
    await open('?level=2&autostart=1&god=1&handoff=1'); await wait(800);
    await ev(() => { const g = window.__game; g.player.give('ammo_pistol', 5); });
    const before = await game();
    await l2End(choice, left);
    s = await store();
    const text = await cardText();
    check(s.carry?.v === 2 && s.carry.from === 2 && s.carry.facts?.choice === fact && s.carry.facts?.unitsLeft === left,
      `carry from 2 with facts ${JSON.stringify(s.carry?.facts)}`);
    check(eq(s.carry?.weapons?.pistol, before.weapons.pistol), 'carry holds the loadout at the end');
    check(s.level === '3' && !s.saves.includes(2), `stored level 3, level-2 checkpoint cleared (${JSON.stringify(s)})`);
    check(/TIME:/i.test(text) && !/TO BE CONTINUED/i.test(text), `end card stays, without TO BE CONTINUED: "${text.slice(0, 90)}…"`);
    await open('?autostart=1&god=1'); await wait(1000);
    g = await game();
    check(g.level === 3 && g.facts.choice === fact && g.facts.unitsLeft === left && g.loadout === 'carry' && eq(g.weapons.pistol, before.weapons.pistol),
      `level 3 boots with facts + carried loadout: ${JSON.stringify({ level: g.level, facts: g.facts, loadout: g.loadout })}`);
  }

  console.log('══════════ L2 → L3 real hand-over (reload) ══════════');
  await wipe();
  await open('?level=2&autostart=1&god=1'); await wait(800);
  await ev(() => { window.__game.debug.autostart = false; });          // as a real run: store + reload
  await ev(() => { void window.__game.story.ending('shutdown', 'spared', 30); });
  await until(() => /TIME:/i.test(document.querySelector('.cb')?.innerText ?? ''), 15000);
  s = await store();
  check(s.level === '3' && s.carry?.from === 2 && !s.saves.includes(2), 'stored before the card');
  await wait(2500);
  const nav = page.waitForNavigation({ timeout: 20000 }).then(() => true, () => false);
  await page.keyboard.press('Space');                                    // skip the card
  const navigated = await nav;
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 }).catch(() => {});
  await wait(1500);
  g = await game();
  check(navigated && g.level === 3 && !/level=/.test(g.url), `after the card the page reloads into level 3 without ?level= (${g.url}, level ${g.level})`);
  // autostart is still in the URL, so the level begins directly (a real run shows the one-click gate first)
  check(g.facts.choice === 'stop' && g.facts.unitsLeft === 30, `facts arrive: ${JSON.stringify(g.facts)}`);

  console.log('══════════ L3 end (no ?next=: LEVELS[3].next = 4 — the live hand-over, store + reload) ══════════');
  await wipe();
  await open('?level=3&autostart=1&god=1&handoff=1&choice=command&units=12'); await wait(800);
  await ev(() => window.__game.story.checkpoint('cp3_start'));
  check((await store()).saves.includes(3), 'a level-3 checkpoint is written');
  await ev(() => { window.__game.debug.autostart = false; });          // as a real run: store + reload
  await ev(() => { void window.__game.story.end(); });
  await until(() => /QUIET SIDE/i.test(document.querySelector('.cb')?.innerText ?? ''), 15000);
  await wait(2500);
  s = await store();
  const t3 = await cardText();
  check(s.carry?.from === 3 && s.carry.facts?.choice === 'command' && s.carry.facts?.unitsLeft === 12 && s.carry.facts?.badge === true && s.carry.facts?.halvorsenAlive === true && typeof s.carry.facts?.kills3 === 'number',
    `level 3's end writes the carry for 3b: ${JSON.stringify(s.carry?.facts)}`);
  check(typeof s.carry?.facts?.testHour === 'number' && s.carry.facts.testHour >= 62 && s.carry.facts.testHour < 63, `the carry holds testHour (D20): ${s.carry?.facts?.testHour}`);
  check(s.level === '4' && !s.saves.includes(3), `stored level 4 (next = 4), the level-3 checkpoint cleared (${s.level})`);
  check(/THE QUIET SIDE/.test(t3) && !/TO BE CONTINUED/i.test(t3), `the 3a card without TO BE CONTINUED: "${t3.slice(0, 60)}"`);
  check((await game()).state === 'ended', 'state ended');
  {
    const nav = page.waitForNavigation({ timeout: 20000 }).then(() => true, () => false);
    await page.keyboard.press('Space');                                  // skip the card
    const navigated = await nav;
    await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 }).catch(() => {});
    await wait(1500);
    g = await game();
    check(navigated && g.level === 4 && !/level=/.test(g.url) && g.loadout === 'carry' && g.arrival?.from === 3 && g.facts.choice === 'command' && g.facts.unitsLeft === 12,
      `after the card the page reloads into level 4 with 3's carry, no ?next= (${g.url}, level ${g.level}, ${g.loadout}, ${JSON.stringify(g.facts)})`);
  }

  const armorOn = await probeArmor();
  for (const [choice, units] of [['stop', 26], ['command', 14]]) {
    console.log(`══════════ L3 (${choice}) → L4 through ?next=3:4 ══════════`);
    await wipe();
    await open(`?level=3&autostart=1&god=1&handoff=1&next=3:4&choice=${choice}&units=${units}`); await wait(800);
    await ev(() => { const g = window.__game; g.player.give('ammo_pistol', 3); g.player.health = 40; });
    await ev(() => window.__game.story.checkpoint('cp3_start'));
    await ev(([k]) => localStorage.setItem(k, '{"v":2,"level":4,"placeholder":true}'), [KEYS.save(4)]);
    const before = await game();
    await ev(() => { void window.__game.story.end(); });
    await until(() => /QUIET SIDE/i.test(document.querySelector('.cb')?.innerText ?? ''), 15000);
    await wait(2500);
    s = await store();
    const tc = await cardText();
    check(/THE QUIET SIDE/.test(tc) && !/TO BE CONTINUED/i.test(tc), `the 3a card without TO BE CONTINUED: "${tc.slice(0, 60)}"`);
    check(s.level === '4' && !s.saves.includes(3) && !s.saves.includes(4), `stored level 4, the level-3 and the old level-4 checkpoints cleared: ${JSON.stringify({ level: s.level, saves: s.saves })}`);
    check(s.carry?.from === 3 && s.carry.facts?.choice === choice && s.carry.facts?.unitsLeft === units && typeof s.carry.facts?.testHour === 'number' && s.carry.armor === 0 && eq(Object.keys(s.carry.weapons).sort(), ['carbine', 'pistol', 'shotgun']),
      `carry from 3: ${JSON.stringify({ facts: s.carry?.facts, armor: s.carry?.armor, weapons: Object.keys(s.carry?.weapons ?? {}) })}`);
    await open('?autostart=1&god=1&next=3:4'); await wait(1200);
    g = await game();
    check(g.level === 4 && g.loadout === 'carry' && g.arrival?.from === 3, `level 4 boots from the stored level with 3's carry (${JSON.stringify({ level: g.level, loadout: g.loadout, arrival: g.arrival })})`);
    check(eq(g.weapons.pistol, before.weapons.pistol) && eq(g.weapons.shotgun, before.weapons.shotgun) && !g.weapons.carbine.owned && g.flashlight === before.flashlight,
      `weapons + flashlight carried: ${JSON.stringify({ w: g.weapons, before: before.weapons, flashlight: g.flashlight })}`);
    check(g.health === Math.max(50, before.health), `health carried (floor 50): ${before.health} → ${g.health}`);
    check(g.facts.choice === choice && g.facts.unitsLeft === units && g.facts.badge === true && g.facts.halvorsenAlive === true && typeof g.facts.kills3 === 'number' && g.facts.testHour === s.carry.facts.testHour,
      `facts carried: ${JSON.stringify(g.facts)}`);
    check(arrivalArmor(g) === 0, `armour carried (0): ${arrivalArmor(g)}`);
  }

  console.log('══════════ carried armour (3 → 4) ══════════');
  for (const [raw, want] of [[37, 37], [900, 100], ['NaN', 0], [null, 0], [-5, 0]]) {
    await wipe();
    await ev(([K, a]) => {
      localStorage.setItem(K.level, '4');
      localStorage.setItem(K.carry, JSON.stringify({ v: 2, from: 3, health: 90, armor: a === 'NaN' ? NaN : a, flashlight: true, current: 'pistol', weapons: { pistol: { owned: true, clip: 5, reserve: 10 } }, facts: { choice: 'stop', unitsLeft: 20, testHour: 62.5 } }));
    }, [SKEYS, raw]);
    await open('?autostart=1&god=1&next=3:4'); await wait(1000);
    g = await game();
    check(g.level === 4 && g.loadout === 'carry' && arrivalArmor(g) === want, `armour ${raw} → ${want} (${armorOn ? 'player' : 'arrival record'}: ${arrivalArmor(g)})`);
  }

  console.log('══════════ L3 → L4 real hand-over (reload keeps ?next=) ══════════');
  await wipe();
  await open('?level=3&autostart=1&god=1&next=3:4'); await wait(800);
  await ev(() => { window.__game.debug.autostart = false; });          // as a real run: store + reload
  await ev(() => { void window.__game.story.end(); });
  await until(() => /QUIET SIDE/i.test(document.querySelector('.cb')?.innerText ?? ''), 15000);
  s = await store();
  check(s.level === '4' && s.carry?.from === 3, 'stored before the card');
  await wait(2500);
  {
    const nav = page.waitForNavigation({ timeout: 20000 }).then(() => true, () => false);
    await page.keyboard.press('Space');                                  // skip the card
    const navigated = await nav;
    await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 }).catch(() => {});
    await wait(1500);
    g = await game();
    check(navigated && g.level === 4 && !/level=/.test(g.url) && /next=3(:|%3A)4/i.test(g.url) && g.loadout === 'carry',
      `after the card the page reloads into level 4 without ?level= (${g.url}, level ${g.level}, ${g.loadout})`);
  }

  // the greybox's placeholder end button is gone (the real end is the gate lock)
  await wipe();
  await open('?level=4&autostart=1&god=1'); await wait(800);
  check(!(await ev(() => !!window.__game.interactables.get('l4_stub_end'))), 'no placeholder end button l4_stub_end in level 4');
}

// ───────────────────────────────────────────────────────────── chain 4 → 5 → 6 (stage 3c A1 / D2; stage 3d §8.1, D2, D3)
/** Skip the end card (Space) and wait for the reload into the next level; returns whether the page navigated. */
async function skipAndReload() {
  const nav = page.waitForNavigation({ timeout: 20000 }).then(() => true, () => false);
  await page.keyboard.press('Space');
  const navigated = await nav;
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 }).catch(() => {});
  await wait(1500);
  return navigated;
}
const cardIs = (re, ms = 15000) => until((src) => new RegExp(src, 'i').test(document.querySelector('.cb')?.innerText ?? ''), ms, re.source);
if (want('chain5')) {
  let s, g;
  // ── 4 → 5 is LIVE on main (LEVELS[4].next = 5): no `?next=` anywhere in this part
  for (const [choice, units] of [['stop', 26], ['command', 14]]) {
    console.log(`══════════ L4 (${choice}) → L5 (live, no ?next=) ══════════`);
    await wipe();
    await open(`?level=4&autostart=1&god=1&handoff=1&choice=${choice}&units=${units}`); await wait(800);
    await ev(() => {
      const p = window.__game.player;
      p.give('carbine', 30); p.give('ammo_pistol', 3); p.health = 40; p.addArmor(37);
      p.debug?.torch?.(0.2);                                              // a low cell: it must NOT arrive in level 5
    });
    await ev(() => window.__game.story.checkpoint('cp4_start'));
    await ev(([k]) => localStorage.setItem(k, '{"v":2,"level":5,"placeholder":true}'), [KEYS.save(5)]);
    const before = await game();
    check((await ev(() => window.__game.story.next?.() ?? null)) === 5, 'level 4: next() = 5 on main (live)');
    await ev(() => { void window.__game.story.end(); });
    await cardIs(/BIOLOGICAL SYSTEMS/);
    await wait(2500);
    s = await store();
    const tc = await cardText();
    check(/BIOLOGICAL SYSTEMS/.test(tc) && !/TO BE CONTINUED/i.test(tc), `the 3b card without TO BE CONTINUED: "${tc.slice(0, 60)}"`);
    check(s.level === '5' && !s.saves.includes(4) && !s.saves.includes(5), `stored level 5, the level-4 and the old level-5 checkpoints cleared: ${JSON.stringify({ level: s.level, saves: s.saves })}`);
    check(s.carry?.from === 4 && s.carry.facts?.choice === choice && s.carry.facts?.unitsLeft === units && typeof s.carry.facts?.testHour === 'number' && typeof s.carry.facts?.kills4 === 'number' && s.carry.armor === before.armor && s.carry.weapons?.carbine?.owned,
      `carry from 4: ${JSON.stringify({ facts: s.carry?.facts, armor: s.carry?.armor, before: before.armor, carbine: s.carry?.weapons?.carbine })}`);
    check(s.carry && !('torch' in s.carry), 'the carry holds no flashlight cell (a new level starts full)');
    await open('?autostart=1&god=1'); await wait(1200);
    g = await game();
    check(g.level === 5 && g.loadout === 'carry' && g.arrival?.from === 4, `level 5 boots from the stored level with 4's carry (${JSON.stringify({ level: g.level, loadout: g.loadout, arrival: g.arrival })})`);
    check(eq(g.weapons, before.weapons) && g.flashlight === before.flashlight,
      `weapons (incl. the carbine) + flashlight carried: ${JSON.stringify({ w: g.weapons, before: before.weapons, flashlight: g.flashlight })}`);
    check(g.health === Math.max(50, before.health), `health carried (floor 50): ${before.health} → ${g.health}`);
    check(before.armor === 37 && g.armor === 37 && g.arrival?.armor === 37, `armour carried: ${before.armor} → ${g.armor} (arrival record ${g.arrival?.armor})`);
    check(g.facts.choice === choice && g.facts.unitsLeft === units && g.facts.badge === true && g.facts.halvorsenAlive === true && typeof g.facts.kills4 === 'number' && g.facts.testHour === s.carry.facts.testHour,
      `facts carried: ${JSON.stringify(g.facts)}`);
    const cell = await ev(() => window.__game.player.flashlightCharge ?? null);
    check(typeof cell === 'number' && cell > 0.6, `level 5 starts with a full cell, not 4's 0.2 (now ${cell}; the lamp drains while on)`);
  }

  console.log('══════════ carried armour (4 → 5) ══════════');
  for (const [raw, wantA] of [[37, 37], [900, 100], ['NaN', 0]]) {
    await wipe();
    await ev(([K, a]) => {
      localStorage.setItem(K.level, '5');
      localStorage.setItem(K.carry, JSON.stringify({ v: 2, from: 4, health: 90, armor: a === 'NaN' ? NaN : a, flashlight: true, current: 'carbine', weapons: { pistol: { owned: true, clip: 5, reserve: 10 }, carbine: { owned: true, clip: 12, reserve: 40 } }, facts: { choice: 'stop', unitsLeft: 20, testHour: 62.4 } }));
    }, [SKEYS, raw]);
    await open('?autostart=1&god=1'); await wait(1000);
    g = await game();
    check(g.level === 5 && g.loadout === 'carry' && g.armor === wantA && g.weapons.carbine.owned && g.weapons.carbine.clip === 12, `armour ${raw} → ${wantA} (player ${g.armor}, carbine ${JSON.stringify(g.weapons.carbine)})`);
  }

  console.log('══════════ L4 → L5 real hand-over (store + reload, live) ══════════');
  await wipe();
  await open('?level=4&autostart=1&god=1'); await wait(800);
  await ev(() => { window.__game.debug.autostart = false; });          // as a real run: store + reload
  await ev(() => { void window.__game.story.end(); });
  await cardIs(/BIOLOGICAL SYSTEMS/);
  s = await store();
  check(s.level === '5' && s.carry?.from === 4, 'stored before the card');
  await wait(2500);
  {
    const navigated = await skipAndReload();
    g = await game();
    check(navigated && g.level === 5 && !/level=/.test(g.url) && !/next=/.test(g.url) && g.loadout === 'carry' && g.arrival?.from === 4,
      `after the card the page reloads into level 5 without ?level= / ?next= (${g.url}, level ${g.level}, ${g.loadout})`);
  }

  console.log('══════════ L5 end (no ?next=: LEVELS[5].next = 6, live) ══════════');
  await wipe();
  await open('?level=5&autostart=1&god=1&handoff=1&choice=command&units=11'); await wait(800);
  await ev(() => window.__game.story.checkpoint('cp5_start'));
  check((await store()).saves.includes(5), 'a level-5 checkpoint is written');
  check((await ev(() => typeof window.__game.story.next === 'function' ? window.__game.story.next() : 'missing')) === 6, 'level 5: next() = 6 on main (live)');
  await ev(() => { void window.__game.story.end(); });
  await cardIs(/POST 4/);
  await wait(2500);
  s = await store();
  const t5 = await cardText();
  check(s.carry?.from === 5 && s.carry.facts?.choice === 'command' && s.carry.facts?.unitsLeft === 11 && typeof s.carry.facts?.kills5 === 'number' && typeof s.carry.facts?.testHour === 'number' && s.carry.facts.testHour >= 62.5,
    `level 5's end writes the carry: ${JSON.stringify(s.carry?.facts)}`);
  check(s.carry && ['radio', 'kessler', 'l5_door', 'l5_boat'].every((k) => typeof s.carry.facts?.[k] === 'boolean'), `the carry holds radio / kessler / l5_door / l5_boat: ${JSON.stringify(s.carry?.facts)}`);
  check(s.carry && s.carry.weapons?.carbine?.owned && s.carry.armor === 50, `the carry holds the carbine and armour: ${JSON.stringify({ carbine: s.carry?.weapons?.carbine, armor: s.carry?.armor })}`);
  check(s.level === '6' && !s.saves.includes(5), `stored level 6 (next = 6), its checkpoint cleared (${s.level})`);
  check(/POST 4/.test(t5) && !/TO BE CONTINUED/i.test(t5), `end card POST 4 alone "${t5.slice(0, 60)}"`);
  check((await game()).state === 'ended', 'state ended');

  const F5 = ['radio', 'kessler', 'l5_door', 'l5_boat'];
  for (const [choice, units] of [['stop', 26], ['command', 14]]) {
    console.log(`══════════ L5 (${choice}) → L6 (live, no ?next=) ══════════`);
    await wipe();
    await open(`?level=5&autostart=1&god=1&handoff=1&choice=${choice}&units=${units}`); await wait(800);
    await ev(() => {
      const p = window.__game.player;
      p.give('ammo_pistol', 3); p.health = 40;
      p.debug?.setArmor?.(37);
      p.debug?.torch?.(0.2);                                              // a low cell: it must NOT arrive in level 6
    });
    await ev(() => window.__game.story.checkpoint('cp5_start'));
    await ev(([k]) => localStorage.setItem(k, '{"v":2,"level":6,"placeholder":true}'), [KEYS.save(6)]);
    const before = await game();
    check((await ev(() => window.__game.story.next?.() ?? null)) === 6, 'level 5: next() = 6 on main (live)');
    await ev(() => { void window.__game.story.end(); });
    await cardIs(/POST 4/);
    await wait(2500);
    s = await store();
    const tc = await cardText();
    check(/POST 4/.test(tc) && !/TO BE CONTINUED/i.test(tc), `the 3c card POST 4 alone: "${tc.slice(0, 60)}"`);
    check(s.level === '6' && !s.saves.includes(5) && !s.saves.includes(6), `stored level 6, the level-5 and the old level-6 checkpoints cleared: ${JSON.stringify({ level: s.level, saves: s.saves })}`);
    check(s.carry?.from === 5 && s.carry.facts?.choice === choice && s.carry.facts?.unitsLeft === units && typeof s.carry.facts?.kills5 === 'number' && s.carry.facts.testHour >= 62.5 && F5.every((k) => typeof s.carry.facts[k] === 'boolean') && s.carry.armor === before.armor,
      `carry from 5: ${JSON.stringify({ facts: s.carry?.facts, armor: s.carry?.armor, before: before.armor })}`);
    check(s.carry && !('torch' in s.carry), 'the carry holds no flashlight cell');
    await open('?autostart=1&god=1'); await wait(1200);
    g = await game();
    check(g.level === 6 && g.loadout === 'carry' && g.arrival?.from === 5, `level 6 boots from the stored level with 5's carry (${JSON.stringify({ level: g.level, loadout: g.loadout, arrival: g.arrival })})`);
    check(eq(g.weapons, before.weapons) && g.flashlight === before.flashlight,
      `weapons + the lamp carried: ${JSON.stringify({ w: g.weapons, before: before.weapons, flashlight: g.flashlight })}`);
    check(g.health === Math.max(50, before.health), `health carried (floor 50): ${before.health} → ${g.health}`);
    check(before.armor === 37 && g.armor === 37 && g.arrival?.armor === 37, `armour carried: ${before.armor} → ${g.armor} (arrival record ${g.arrival?.armor})`);
    check(g.facts.choice === choice && g.facts.unitsLeft === units && typeof g.facts.kills5 === 'number' && g.facts.testHour === s.carry.facts.testHour && F5.every((k) => g.facts[k] === s.carry.facts[k]),
      `facts carried (incl. radio, testHour): ${JSON.stringify(g.facts)}`);
    const cell = await ev(() => window.__game.player.flashlightCharge ?? null);
    check(typeof cell === 'number' && cell > 0.6, `level 6 starts with a full cell, not 5's 0.2 (now ${cell})`);
  }

  console.log('══════════ carried armour (5 → 6) ══════════');
  for (const [raw, wantA] of [[37, 37], [900, 100], ['NaN', 0]]) {
    await wipe();
    await ev(([K, a]) => {
      localStorage.setItem(K.level, '6');
      localStorage.setItem(K.carry, JSON.stringify({ v: 2, from: 5, health: 90, armor: a === 'NaN' ? NaN : a, flashlight: true, current: 'carbine', weapons: { pistol: { owned: true, clip: 5, reserve: 10 }, carbine: { owned: true, clip: 12, reserve: 40 } }, facts: { choice: 'stop', unitsLeft: 20, radio: true, testHour: 62.6 } }));
    }, [SKEYS, raw]);
    await open('?autostart=1&god=1'); await wait(1000);
    g = await game();
    check(g.level === 6 && g.loadout === 'carry' && g.armor === wantA && g.weapons.carbine.clip === 12 && g.facts.radio === true && g.facts.testHour === 62.6, `armour ${raw} → ${wantA} (player ${g.armor}, carbine ${JSON.stringify(g.weapons.carbine)})`);
  }
  // a carry from 4 (wrong chain) does not lead into level 6: the direct start
  await wipe();
  await ev(([K]) => {
    localStorage.setItem(K.level, '6');
    localStorage.setItem(K.carry, JSON.stringify({ v: 2, from: 4, health: 90, armor: 20, flashlight: true, current: 'pistol', weapons: { pistol: { owned: true, clip: 5, reserve: 10 } }, facts: { choice: 'stop', unitsLeft: 20, testHour: 62.4 } }));
  }, [SKEYS]);
  await open('?autostart=1&god=1'); await wait(1000);
  g = await game();
  check(g.level === 6 && g.loadout === 'direct', `a carry from 4 is not level 6's (${g.loadout})`);
  // the test override still works (same target as the live chain)
  await wipe();
  await open('?level=5&autostart=1&god=1&handoff=1&next=5:6'); await wait(800);
  check((await ev(() => window.__game.story.next?.() ?? null)) === 6, 'level 5: next() = 6 with ?next=5:6 too');

  console.log('══════════ L5 → L6 real hand-over (store + reload, live) ══════════');
  await wipe();
  await open('?level=5&autostart=1&god=1'); await wait(800);
  await ev(() => { window.__game.debug.autostart = false; });          // as a real run: store + reload
  await ev(() => { void window.__game.story.end(); });
  await cardIs(/POST 4/);
  s = await store();
  check(s.level === '6' && s.carry?.from === 5, 'stored before the card');
  await wait(2500);
  {
    const navigated = await skipAndReload();
    g = await game();
    check(navigated && g.level === 6 && !/level=/.test(g.url) && !/next=/.test(g.url) && g.loadout === 'carry' && g.arrival?.from === 5,
      `after the card the page reloads into level 6 without ?level= / ?next= (${g.url}, level ${g.level}, ${g.loadout})`);
  }

  console.log('══════════ L6 end (the chapter end) ══════════');
  await wipe();
  await open('?level=6&autostart=1&god=1&handoff=1&choice=command&units=11'); await wait(800);
  await ev(() => window.__game.story.checkpoint('cp6_start'));
  check((await store()).saves.includes(6), 'a level-6 checkpoint is written');
  check((await ev(() => typeof window.__game.story.next === 'function' ? window.__game.story.next() : 'missing')) === null, 'level 6: next() is null (D3)');
  await ev(() => { void window.__game.story.end(); });
  await cardIs(/THE TRUNK/);
  await wait(2000);
  s = await store();
  const t6 = await cardText();
  check(s.carry?.from === 6 && s.carry.facts?.choice === 'command' && s.carry.facts?.unitsLeft === 11 && typeof s.carry.facts?.kills6 === 'number' && s.carry.facts?.testHour >= 62.75
    && ['manifest', 'aas', 'trunkCut', 'loaderDead'].every((k) => typeof s.carry.facts[k] === 'boolean') && typeof s.carry.facts.launchHour === 'number',
    `level 6's end writes the carry: ${JSON.stringify(s.carry?.facts)}`);
  check(s.carry && s.carry.weapons?.carbine?.owned && s.carry.armor === 50, `the carry holds weapons and armour: ${JSON.stringify({ carbine: s.carry?.weapons?.carbine, armor: s.carry?.armor })}`);
  check(s.level === '6' && !s.saves.includes(6), 'stored level 6, its checkpoint cleared');
  check(/THE TRUNK/.test(t6) && /TO BE CONTINUED/.test(t6), `end card "${t6.slice(0, 60)}"`);
  await page.keyboard.press('Space');                                    // skip it: END OF CHAPTER 3 follows
  const chapter = await cardIs(/END OF CHAPTER 3/, 8000);
  check(chapter, `then the END OF CHAPTER 3 card ("${(await cardText()).slice(0, 40)}")`);
  check((await game()).state === 'ended', 'state ended');
  // K's stub ends by its button too; skipped once W4a / ST replace it
  await wipe();
  await open('?level=6&autostart=1&god=1'); await wait(800);
  const btn = await ev(() => { const i = window.__game.interactables.get('l6_stub_end'); if (!i) return false; window.__game.interactables.use(i); return true; });
  const ended6 = btn && await until(() => window.__game.state === 'ended', 10000);
  check(!btn || ended6, btn ? `the stub's end button ends level 6 (${ended6})` : 'no stub end button (the stub is replaced) — skipped');
  await wipe();
}

// ───────────────────────────────────────────────────────────── menu (stored level 3)
if (want('menu')) {
  console.log('══════════ menu: stored level 3 ══════════');
  const menuOpen = () => until(() => window.__game?.state === 'menu' && !!document.querySelector('.menu.show'), 30000);
  const click = (label) => ev((label) => {
    const b = [...document.querySelectorAll('.menu button')].find((x) => x.textContent?.includes(label));
    if (!b || b.classList.contains('hidden')) return false;
    b.click(); return true;
  }, label);
  const menuInfo = () => ev(() => ({
    cont: [...document.querySelectorAll('.menu button')].some((b) => b.textContent.includes('Continue') && !b.classList.contains('hidden')),
    where: document.querySelector('.menu .where')?.textContent ?? '',
    line: document.querySelector('.menu .lvlline')?.classList.contains('hidden') ? null : document.querySelector('.menu .lvlline')?.textContent ?? null,
  }));
  // a level-3 run with a checkpoint
  await wipe();
  await open('?level=3&autostart=1&god=1&handoff=1'); await wait(800);
  await ev(() => { const g = window.__game, V = g.player.position.constructor; g.player.teleport(new V(2.5, 0, -6.5), 1.0); });
  await wait(300);
  await ev(() => window.__game.story.checkpoint('cp3_office'));
  await ev((K) => localStorage.setItem(K.level, '3'), SKEYS);
  await open('?god=1'); await menuOpen();
  let m = await menuInfo();
  // (as level 2: CONTINUE names the checkpoint's place — its room — and the level line names the chapter)
  const place3 = await ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.place ?? '', KEYS.save(3));
  check((await game()).level === 3 && m.cont && !!place3 && m.where.includes(place3) && !/LEVEL/i.test(m.where) && /Chapter 3\s+—\s+The Quiet Side/i.test(m.line ?? ''), `menu offers CONTINUE on level 3 (place "${place3}"): ${JSON.stringify(m)}`);
  check(await click('Continue'), 'CONTINUE clicked');
  await until(() => window.__game?.state === 'playing', 20000); await wait(800);
  let g = await game();
  const pos = await ev(() => { const p = window.__game.player.position; return [p.x, p.z]; });
  check(g.restoredFrom === 'cp3_office' && Math.abs(pos[0] - 2.5) < 0.2 && Math.abs(pos[1] + 6.5) < 0.2, `CONTINUE resumes the checkpoint (${g.restoredFrom} at ${pos.map((v) => v.toFixed(2))})`);
  // no checkpoint: CONTINUE starts level 3 from its beginning
  await ev((k) => localStorage.removeItem(k), KEYS.save(3));
  await open('?god=1'); await menuOpen();
  m = await menuInfo();
  check(m.cont && m.where === '' && /Chapter 3/i.test(m.line ?? ''), `no checkpoint: CONTINUE still offered, no place: ${JSON.stringify(m)}`);
  await click('Continue');
  await until(() => window.__game?.state === 'playing', 30000); await wait(500);
  g = await game();
  check(g.level === 3 && g.restoredFrom === null, `CONTINUE without a checkpoint begins level 3 (${JSON.stringify({ level: g.level, from: g.restoredFrom })})`);
  // BEGIN: everything cleared, back to level 1
  await ev((K) => { localStorage.setItem(K.carry, JSON.stringify({ v: 2, from: 2, health: 80, armor: 0, flashlight: true, current: 'pistol', weapons: { pistol: { owned: true, clip: 3, reserve: 3 } }, facts: { choice: 'stop', unitsLeft: 5 } })); localStorage.setItem('coldboot.seen.v1', '["c1"]'); }, SKEYS);
  await ev(() => window.__game.story.checkpoint('cp3_start'));
  await open('?god=1'); await menuOpen();
  const nav = page.waitForNavigation({ timeout: 20000 }).then(() => true, () => false);
  await click('Begin');
  const navigated = await nav;
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 }).catch(() => {});
  await wait(800);
  const s = await store();
  const seenKept = await ev(() => localStorage.getItem('coldboot.seen.v1'));
  check(navigated && (await game()).level === 1 && s.level === '1' && !s.carry && s.saves.length === 0, `BEGIN reloads into level 1 with everything cleared: ${JSON.stringify(s)}`);
  check(seenKept === '["c1"]', 'BEGIN keeps coldboot.seen.v1 (D9)');

  console.log('══════════ menu: stored level 4 ══════════');
  await wipe();
  await open('?level=4&autostart=1&god=1&handoff=1'); await wait(800);
  await ev(() => { const g = window.__game, V = g.player.position.constructor; g.player.teleport(new V(1.5, 4.8, 3.5), 0.5); });
  await wait(300);
  await ev(() => window.__game.story.checkpoint('cp4_start'));
  await ev((K) => localStorage.setItem(K.level, '4'), SKEYS);
  await open('?god=1'); await menuOpen();
  m = await menuInfo();
  const place4 = await ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.place ?? '', KEYS.save(4));
  check((await game()).level === 4 && m.cont && !!place4 && m.where.includes(place4) && /Chapter 3\s+—\s+Biological Systems/i.test(m.line ?? ''), `menu offers CONTINUE on level 4 (place "${place4}"): ${JSON.stringify(m)}`);
  check(await click('Continue'), 'CONTINUE clicked');
  await until(() => window.__game?.state === 'playing', 20000); await wait(800);
  g = await game();
  const pos4 = await ev(() => { const p = window.__game.player.position; return [p.x, p.y, p.z]; });
  check(g.level === 4 && g.restoredFrom === 'cp4_start' && Math.abs(pos4[0] - 1.5) < 0.2 && Math.abs(pos4[2] - 3.5) < 0.2 && Math.abs(pos4[1] - 4.8) < 0.2, `CONTINUE resumes the level-4 checkpoint (${g.restoredFrom} at ${pos4.map((v) => v.toFixed(2))})`);
  await ev((k) => localStorage.removeItem(k), KEYS.save(4));
  await open('?god=1'); await menuOpen();
  m = await menuInfo();
  check(m.cont && m.where === '' && /Biological Systems/i.test(m.line ?? ''), `no checkpoint: CONTINUE still offered on level 4, no place: ${JSON.stringify(m)}`);
  await click('Continue');
  await until(() => window.__game?.state === 'playing', 30000); await wait(500);
  g = await game();
  check(g.level === 4 && g.restoredFrom === null && g.loadout === 'direct', `CONTINUE without a checkpoint begins level 4 (${JSON.stringify({ level: g.level, from: g.restoredFrom, loadout: g.loadout })})`);
  await open('?god=1'); await menuOpen();
  {
    const nav4 = page.waitForNavigation({ timeout: 20000 }).then(() => true, () => false);
    await click('Begin');
    const nv = await nav4;
    await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 }).catch(() => {});
    await wait(800);
    const s4 = await store();
    check(nv && (await game()).level === 1 && s4.level === '1' && s4.saves.length === 0, `BEGIN on a stored level 4 reloads into level 1: ${JSON.stringify(s4)}`);
  }

  console.log('══════════ menu: stored level 5 ══════════');
  await wipe();
  await open('?level=5&autostart=1&god=1&handoff=1'); await wait(800);
  await ev(() => { const g = window.__game, V = g.player.position.constructor; g.player.teleport(new V(1.5, 0, 2.0), 0.5); });
  await wait(300);
  await ev(() => window.__game.story.checkpoint('cp5_start'));
  await ev((K) => localStorage.setItem(K.level, '5'), SKEYS);
  await open('?god=1'); await menuOpen();
  m = await menuInfo();
  const place5 = await ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.place ?? '', KEYS.save(5));
  check((await game()).level === 5 && m.cont && !!place5 && m.where.includes(place5) && /Chapter 3\s+—\s+Post 4/i.test(m.line ?? ''), `menu offers CONTINUE on level 5 (place "${place5}"): ${JSON.stringify(m)}`);
  check(await click('Continue'), 'CONTINUE clicked');
  await until(() => window.__game?.state === 'playing', 20000); await wait(800);
  g = await game();
  const pos5 = await ev(() => { const p = window.__game.player.position; return [p.x, p.y, p.z]; });
  check(g.level === 5 && g.restoredFrom === 'cp5_start' && Math.abs(pos5[0] - 1.5) < 0.2 && Math.abs(pos5[2] - 2.0) < 0.2, `CONTINUE resumes the level-5 checkpoint (${g.restoredFrom} at ${pos5.map((v) => v.toFixed(2))})`);
  await ev((k) => localStorage.removeItem(k), KEYS.save(5));
  await open('?god=1'); await menuOpen();
  m = await menuInfo();
  check(m.cont && m.where === '' && /Post 4/i.test(m.line ?? ''), `no checkpoint: CONTINUE still offered on level 5, no place: ${JSON.stringify(m)}`);
  await click('Continue');
  await until(() => window.__game?.state === 'playing', 30000); await wait(500);
  g = await game();
  check(g.level === 5 && g.restoredFrom === null && g.loadout === 'direct' && g.weapons.carbine.owned && g.armor === 50, `CONTINUE without a checkpoint begins level 5 with its direct loadout (${JSON.stringify({ level: g.level, from: g.restoredFrom, loadout: g.loadout, armor: g.armor })})`);
  await open('?god=1'); await menuOpen();
  {
    const nav5 = page.waitForNavigation({ timeout: 20000 }).then(() => true, () => false);
    await click('Begin');
    const nv = await nav5;
    await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 }).catch(() => {});
    await wait(800);
    const s5 = await store();
    check(nv && (await game()).level === 1 && s5.level === '1' && s5.saves.length === 0 && !s5.carry, `BEGIN on a stored level 5 reloads into level 1, all cleared: ${JSON.stringify(s5)}`);
  }

  console.log('══════════ menu: stored level 6 ══════════');
  await wipe();
  await open('?level=6&autostart=1&god=1&handoff=1'); await wait(800);
  await ev(() => { const g = window.__game, V = g.player.position.constructor; g.player.teleport(new V(1.5, 0, 2.0), 0.5); });
  await wait(300);
  await ev(() => window.__game.story.checkpoint('cp6_start'));
  await ev((K) => localStorage.setItem(K.level, '6'), SKEYS);
  await open('?god=1'); await menuOpen();
  m = await menuInfo();
  const place6 = await ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.place ?? '', KEYS.save(6));
  check((await game()).level === 6 && m.cont && !!place6 && m.where.includes(place6) && /Chapter 3\s+—\s+The Trunk/i.test(m.line ?? ''), `menu offers CONTINUE on level 6 (place "${place6}"): ${JSON.stringify(m)}`);
  check(await click('Continue'), 'CONTINUE clicked');
  await until(() => window.__game?.state === 'playing', 20000); await wait(800);
  g = await game();
  const pos6 = await ev(() => { const p = window.__game.player.position; return [p.x, p.y, p.z]; });
  check(g.level === 6 && g.restoredFrom === 'cp6_start' && Math.abs(pos6[0] - 1.5) < 0.2 && Math.abs(pos6[2] - 2.0) < 0.2, `CONTINUE resumes the level-6 checkpoint (${g.restoredFrom} at ${pos6.map((v) => v.toFixed(2))})`);
  await ev((k) => localStorage.removeItem(k), KEYS.save(6));
  await open('?god=1'); await menuOpen();
  m = await menuInfo();
  check(m.cont && m.where === '' && /The Trunk/i.test(m.line ?? ''), `no checkpoint: CONTINUE still offered on level 6, no place: ${JSON.stringify(m)}`);
  await click('Continue');
  await until(() => window.__game?.state === 'playing', 30000); await wait(500);
  g = await game();
  check(g.level === 6 && g.restoredFrom === null && g.loadout === 'direct' && g.weapons.carbine.owned && g.armor === 50, `CONTINUE without a checkpoint begins level 6 with its direct loadout (${JSON.stringify({ level: g.level, from: g.restoredFrom, loadout: g.loadout, armor: g.armor })})`);
  await open('?god=1'); await menuOpen();
  {
    const nav6 = page.waitForNavigation({ timeout: 20000 }).then(() => true, () => false);
    await click('Begin');
    const nv = await nav6;
    await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 }).catch(() => {});
    await wait(800);
    const s6 = await store();
    check(nv && (await game()).level === 1 && s6.level === '1' && s6.saves.length === 0 && !s6.carry, `BEGIN on a stored level 6 reloads into level 1, all cleared: ${JSON.stringify(s6)}`);
  }
}

// ───────────────────────────────────────────────────────────── storage
if (want('storage')) {
  console.log('══════════ storage ══════════');
  await wipe();
  // v1 progress of a level-2 player
  const v1save = { v: 1, rev: 5, level: 2, id: 'cp2_talk', place: 'LINE TWO', player: { position: [0, 0, -30], yaw: 0, health: 80, weapons: { pistol: { owned: true, clip: 5, reserve: 7 }, shotgun: { owned: false, clip: 0, reserve: 0 } }, current: 'pistol', keys: [], flashlight: false, pickups: [] },
    story: { beats: ['l2_arrive'], read: [], visited: [], flags: {}, triggered: [], cleared: [], checkpoints: ['cp2_talk'] }, logs: [], stats: { time: 60, kills: 0 }, cleared: [] };
  await ev(([s]) => {
    localStorage.setItem('coldboot.level', '2');
    localStorage.setItem('coldboot.save.l2.v1', JSON.stringify(s));
    localStorage.setItem('coldboot.save.v1', JSON.stringify({ ...s, v: 1, id: 'cp_armed' }));
    localStorage.setItem('coldboot.carry', JSON.stringify({ health: 70, weapons: s.player.weapons, current: 'pistol', flashlight: false }));
  }, [v1save]);
  await open('?autostart=1&god=1&continue=1'); await wait(1500);
  let g = await game(), s = await store();
  check(g.level === 2 && g.state === 'playing' && !g.restoredFrom && s.v1.length === 0, `v1 save + carry discarded, level 2 starts over: ${JSON.stringify({ level: g.level, from: g.restoredFrom, v1: s.v1 })}`);
  check(g.weapons.shotgun.owned, 'with the direct-start loadout (the v1 carry is gone)');
  await open('?autostart=1&god=1&continue=1'); await wait(800);
  g = await game();
  check(g.level === 2 && g.state === 'playing' && pageErrors.length === 0, 'second boot after the discard is clean');

  for (const [name, raw] of [
    ['garbage carry', '{not json'],
    ['carry of another chain step (from 1 into level 3)', JSON.stringify({ v: 2, from: 1, health: 90, armor: 0, flashlight: false, current: null, weapons: {}, facts: { choice: 'command', unitsLeft: 3 } })],
    ['carry with a bad fact', JSON.stringify({ v: 2, from: 2, health: 90, armor: 0, flashlight: false, current: null, weapons: {}, facts: { choice: 'maybe' } })],
    ['carry v1 shape under the v2 key', JSON.stringify({ health: 90, weapons: { pistol: { owned: true, clip: 1, reserve: 1 } }, current: 'pistol', flashlight: false })],
  ]) {
    await ev(([k, v]) => localStorage.setItem(k, v), [KEYS.carry, raw]);
    await open('?level=3&autostart=1&god=1'); await wait(800);
    g = await game();
    check(g.loadout === 'direct' && eq(g.facts, { choice: 'stop', unitsLeft: 28 }), `${name} is ignored (${g.loadout}, ${JSON.stringify(g.facts)})`);
  }
  // unknown weapon ids are dropped, missing ones (here the carbine: a carry written before stage 3b) unowned
  await ev(([k]) => localStorage.setItem(k, JSON.stringify({ v: 2, from: 2, health: 20, armor: 5, flashlight: true, current: 'railgun', weapons: { railgun: { owned: true, clip: 30, reserve: 90 }, pistol: { owned: true, clip: 9, reserve: 4 } }, facts: { choice: 'command', unitsLeft: 7 } })), [KEYS.carry]);
  await open('?level=3&autostart=1&god=1'); await wait(800);
  g = await game();
  check(g.loadout === 'carry' && g.weapons.pistol.owned && g.weapons.pistol.clip === 9 && !g.weapons.shotgun.owned && !('railgun' in g.weapons) && g.weapons.carbine && !g.weapons.carbine.owned && g.health === 50 && g.facts.choice === 'command',
    `carry with an unknown weapon and no carbine: dropped / missing unowned / health floored to 50: ${JSON.stringify({ w: g.weapons, health: g.health, facts: g.facts })}`);
  // level-3 checkpoint round trip with &continue=1; a save of another story revision is discarded
  await ev(() => window.__game.story.checkpoint('cp3_canteen'));
  await open('?level=3&autostart=1&god=1&continue=1'); await wait(800);
  check((await game()).restoredFrom === 'cp3_canteen', '&continue=1 loads the level-3 checkpoint');
  // a level-3 checkpoint written before stage 3b: no carbine in the weapon record, no armour field
  await ev((k) => { const s = JSON.parse(localStorage.getItem(k)); delete s.player.weapons.carbine; delete s.player.armor; localStorage.setItem(k, JSON.stringify(s)); }, KEYS.save(3));
  await open('?level=3&autostart=1&god=1&continue=1'); await wait(800);
  g = await game();
  check(g.restoredFrom === 'cp3_canteen' && g.weapons.pistol.owned && !g.weapons.carbine.owned && g.armor === 0, `a pre-3b level-3 checkpoint restores (carbine unowned, armour 0): ${JSON.stringify({ from: g.restoredFrom, w: g.weapons, armor: g.armor })}`);
  await ev((k) => { const s = JSON.parse(localStorage.getItem(k)); s.rev = 0; localStorage.setItem(k, JSON.stringify(s)); }, KEYS.save(3));
  await open('?level=3&autostart=1&god=1&continue=1'); await wait(800);
  g = await game(); s = await store();
  check(!g.restoredFrom && !s.saves.includes(3) && g.state === 'playing', 'a level-3 save of another revision is discarded and the level starts');

  // a level-4 checkpoint written before stage 3c K (the same v2 / rev-1 record: nothing in it changed) restores
  await wipe();
  await open('?level=4&autostart=1&god=1'); await wait(800);
  const cp4 = { v: 2, level: 4, rev: 1, id: 'cp4_clean', place: 'CLEAN CORRIDOR',
    player: { position: [0, 4.8, -12], yaw: 0, health: 77, weapons: { pistol: { owned: true, clip: 9, reserve: 20 }, shotgun: { owned: true, clip: 4, reserve: 6 } }, current: 'pistol', keys: [], flashlight: true, pickups: [], armor: 15 },
    story: { beats: ['l4_start'], read: [], visited: [], heard: [], flags: { deconDone: true, showered: true }, triggered: [], cleared: [], checkpoints: ['cp4_start', 'cp4_clean'], t: 120 },
    logs: [], stats: { time: 120, kills: 0 }, cleared: [], facts: { choice: 'stop', unitsLeft: 28, badge: true, halvorsenAlive: true, testHour: 62.2 } };
  await ev(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEYS.save(4), cp4]);
  await open('?level=4&autostart=1&god=1&continue=1'); await wait(1500);
  g = await game();
  check(g.restoredFrom === 'cp4_clean' && g.weapons.pistol.clip === 9 && !g.weapons.carbine.owned && g.armor === 15 && g.state === 'playing', `a pre-3c level-4 checkpoint restores (${JSON.stringify({ from: g.restoredFrom, pistol: g.weapons.pistol, armor: g.armor, state: g.state })})`);
  await ev(([k, v]) => localStorage.setItem(k, JSON.stringify({ ...v, story: { ...v.story, beats: 'garbage' } })), [KEYS.save(4), cp4]);
  await open('?level=4&autostart=1&god=1&continue=1'); await wait(1000);
  g = await game(); s = await store();
  check(!g.restoredFrom && !s.saves.includes(4), 'a level-4 checkpoint with a corrupt story record is discarded');

  // level-5 checkpoint round trip (K's stub record; ST's real record keeps the same SaveSpec)
  await wipe();
  await open('?level=5&autostart=1&god=1'); await wait(800);
  await ev(() => window.__game.story.checkpoint('cp5_radio'));
  await open('?level=5&autostart=1&god=1&continue=1'); await wait(1000);
  g = await game();
  check(g.restoredFrom === 'cp5_radio' && g.weapons.carbine.owned && g.armor === 50, `&continue=1 loads the level-5 checkpoint (${g.restoredFrom}, armour ${g.armor})`);
  // a level-5 checkpoint written before 3d's K (3c's record: no level-6 fields; nothing level 5 reads changed) restores
  await ev((k) => { const s = JSON.parse(localStorage.getItem(k)); for (const f of ['boss', 'waves', 'launchAt', 'lockers']) delete s.story[f]; localStorage.setItem(k, JSON.stringify(s)); }, KEYS.save(5));
  await open('?level=5&autostart=1&god=1&continue=1'); await wait(1000);
  g = await game();
  check(g.restoredFrom === 'cp5_radio', `a pre-3d level-5 checkpoint restores (${g.restoredFrom})`);
  await wipe();

  // level-6 checkpoint round trip (K's stub record: ProgressL6 with boss / waves / launchAt / lockers)
  await open('?level=6&autostart=1&god=1'); await wait(800);
  await ev(() => window.__game.story.checkpoint('cp6_m2'));
  const rec6 = await ev((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEYS.save(6));
  check(rec6 && rec6.level === 6 && rec6.id === 'cp6_m2' && 'boss' in rec6.story && rec6.story.waves && rec6.story.lockers && 'launchAt' in rec6.story, `the level-6 record holds the 3d fields: ${JSON.stringify(rec6?.story ?? null).slice(0, 160)}`);
  await open('?level=6&autostart=1&god=1&continue=1'); await wait(1000);
  g = await game();
  check(g.restoredFrom === 'cp6_m2' && g.weapons.carbine.owned && g.armor === 50, `&continue=1 loads the level-6 checkpoint (${g.restoredFrom}, armour ${g.armor})`);
  await ev(([k, v]) => localStorage.setItem(k, JSON.stringify({ ...v, story: { ...v.story, boss: 'garbage' } })), [KEYS.save(6), rec6]);
  await open('?level=6&autostart=1&god=1&continue=1'); await wait(1000);
  g = await game(); s = await store();
  check(!g.restoredFrom && !s.saves.includes(6), 'a level-6 checkpoint with a corrupt boss record is discarded');
  await ev(([k, v]) => localStorage.setItem(k, JSON.stringify({ ...v, id: 'cp6_nonsense' })), [KEYS.save(6), rec6]);
  await open('?level=6&autostart=1&god=1&continue=1'); await wait(1000);
  g = await game(); s = await store();
  check(!g.restoredFrom && !s.saves.includes(6), 'a level-6 checkpoint with an unknown id is discarded');
  await wipe();
}

await browser.close();
if (pageErrors.length) problems.push(`${pageErrors.length} page error(s): ${[...new Set(pageErrors)].slice(0, 3).join(' | ')}`);
console.log(problems.length ? `\nFAILED:\n - ${problems.join('\n - ')}` : '\nCHAIN OK');
process.exit(problems.length ? 1 : 0);
