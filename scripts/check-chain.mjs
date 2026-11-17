// The level chain + save/carry schema v2 (docs/plans/stage-3a.md §8.1, §7; stage 3b docs/plans/stage-3b.md §8.1).
//   node scripts/check-chain.mjs [--url http://127.0.0.1:5173] [--only grep|boot|chain|menu|storage]
// On a static build (vite build + vite preview), like the playthroughs. Exit 1 on any failure.
//   grep    — no binary level branch in src (allow-list: scripts/levelgrep-allow.txt)
//   boot    — every built level (1–4) boots directly; ?level=5/6/9 clamp to 4; bad ?level= → stored level;
//             ?level=3 and ?level=4 direct-start loadout + facts (+ armour 0), ?choice= / ?units=
//   chain   — L1 → L2 carry; L2 → L3 for both choices (carry + facts written, L2 save gone, no TO BE CONTINUED);
//             L2 → L3 real hand-over (reload, one click); L3 end WITHOUT `?next=`: today's end (carry incl. testHour,
//             stays on 3, card with TO BE CONTINUED); L3 → L4 through the test override `?next=3:4&handoff=1` for
//             both choices (card without TBC, stored 4, L3/L4 saves gone, level 4 arrives with weapons, health,
//             flashlight, facts, testHour, armour); carried armour 37 → 37, 900 → 100, NaN → 0; a 3 → 4 carry is
//             ignored without the override; L3 → L4 real hand-over (reload keeps `next`); L4 end (carry incl.
//             carbine + armour, stored level stays 4, card); the stub's end button
//   menu    — stored level 3 / 4: CONTINUE with and without a checkpoint, the chapter line; BEGIN → level 1, all cleared
//   storage — v1 save + carry discarded once; corrupt / wrong-chain carry ignored; a carry without `carbine` loads
//             it unowned; level-3 checkpoint round trip; a level-3 checkpoint written before stage 3b (no carbine,
//             no armour) restores
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
    if (/^src\/[^/]+\/l\d+\//.test(f) || f === 'src/core/progress.ts') continue;
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
const cardText = () => ev(() => document.querySelector('.cb')?.innerText?.replace(/\s+/g, ' ') ?? '');
const until = async (fn, ms, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ───────────────────────────────────────────────────────────── boot
if (want('boot')) {
  console.log('══════════ direct boots ══════════');
  await wipe();
  for (const n of [1, 2, 3, 4]) {
    const before = pageErrors.length;
    await open(`?level=${n}&autostart=1&god=1`); await wait(1500);
    const g = await game();
    check(g.level === n && g.state === 'playing' && pageErrors.length === before, `?level=${n} boots level ${n} and plays (${g.state}, ${pageErrors.length - before} page errors)`);
    await wipe();
  }
  for (const [q, n] of [['?level=5', 4], ['?level=9', 4], ['?level=6', 4]]) {
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
  await ev((K) => localStorage.setItem(K.level, '5'), SKEYS);
  await open('?autostart=1&god=1'); await wait(800);
  check((await game()).level === 4, 'a stored unbuilt level (5) clamps to level 4');
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

  console.log('══════════ L3 end (no ?next=: today\'s end on main) ══════════');
  await wipe();
  await open('?level=3&autostart=1&god=1&handoff=1&choice=command&units=12'); await wait(800);
  await ev(() => window.__game.story.checkpoint('cp3_start'));
  check((await store()).saves.includes(3), 'a level-3 checkpoint is written');
  await ev(() => { void window.__game.story.end(); });
  await until(() => /QUIET SIDE/i.test(document.querySelector('.cb')?.innerText ?? ''), 15000);
  await wait(2500);
  s = await store();
  const t3 = await cardText();
  check(s.carry?.from === 3 && s.carry.facts?.choice === 'command' && s.carry.facts?.unitsLeft === 12 && s.carry.facts?.badge === true && s.carry.facts?.halvorsenAlive === true && typeof s.carry.facts?.kills3 === 'number',
    `level 3's end writes the carry for 3b: ${JSON.stringify(s.carry?.facts)}`);
  check(typeof s.carry?.facts?.testHour === 'number' && s.carry.facts.testHour >= 62 && s.carry.facts.testHour < 63, `the carry holds testHour (D20): ${s.carry?.facts?.testHour}`);
  check(s.level === '3' && !s.saves.includes(3), 'stored level stays 3 (next = null), its checkpoint cleared');
  check(/THE QUIET SIDE/.test(t3) && /TO BE CONTINUED/.test(t3), `end card "${t3.slice(0, 60)}"`);
  check((await game()).state === 'ended', 'state ended');
  // without the override, level 4 does not take 3's carry (LEVELS[3].next is null): a direct start
  await open('?level=4&autostart=1&god=1'); await wait(1000);
  g = await game();
  check(g.level === 4 && g.loadout === 'direct' && g.facts.choice === 'stop' && g.facts.testHour === undefined, `without ?next=3:4 level 4 ignores 3's carry (${g.loadout}, ${JSON.stringify(g.facts)})`);

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

  console.log('══════════ L4 end ══════════');
  await wipe();
  await open('?level=4&autostart=1&god=1&handoff=1&choice=command&units=11'); await wait(800);
  await ev(() => window.__game.story.checkpoint('cp4_start'));
  check((await store()).saves.includes(4), 'a level-4 checkpoint is written');
  await ev(() => { void window.__game.story.end(); });
  await until(() => /BIOLOGICAL SYSTEMS/i.test(document.querySelector('.cb')?.innerText ?? ''), 15000);
  await wait(2500);
  s = await store();
  const t4 = await cardText();
  check(s.carry?.from === 4 && s.carry.facts?.choice === 'command' && s.carry.facts?.unitsLeft === 11 && typeof s.carry.facts?.kills4 === 'number' && typeof s.carry.facts?.testHour === 'number',
    `level 4's end writes the carry: ${JSON.stringify(s.carry?.facts)}`);
  check(s.carry && 'carbine' in s.carry.weapons && typeof s.carry.armor === 'number', `the carry holds the carbine record and armour: ${JSON.stringify({ carbine: s.carry?.weapons?.carbine, armor: s.carry?.armor })}`);
  check(s.level === '4' && !s.saves.includes(4), 'stored level stays 4 (next = null), its checkpoint cleared');
  check(/BIOLOGICAL SYSTEMS/.test(t4) && /TO BE CONTINUED/.test(t4), `end card "${t4.slice(0, 60)}"`);
  check((await game()).state === 'ended', 'state ended');
  // the stub room's end button (until W4/ST replace the stub)
  await wipe();
  await open('?level=4&autostart=1&god=1'); await wait(800);
  const hasButton = await ev(() => !!window.__game.interactables.get('l4_stub_end'));
  if (hasButton) {
    await ev(() => { const g = window.__game; g.interactables.use(g.interactables.get('l4_stub_end')); });
    await until(() => window.__game?.state === 'ended', 5000);
    check((await game()).state === 'ended', 'the stub\'s end button ends level 4');
  } else console.log('  note no l4_stub_end (the level-4 stub was replaced)');
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
  await wipe();
}

await browser.close();
if (pageErrors.length) problems.push(`${pageErrors.length} page error(s): ${[...new Set(pageErrors)].slice(0, 3).join(' | ')}`);
console.log(problems.length ? `\nFAILED:\n - ${problems.join('\n - ')}` : '\nCHAIN OK');
process.exit(problems.length ? 1 : 0);
