// Scripted end-to-end run of the level's story flow (teleports + API calls, god mode).
// Usage: node scripts/playthrough.mjs [baseUrl] — screenshots land in shots/pt-*.png. Exit 1 on failure.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
mkdirSync('shots', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log('  [pageerror]', e.message); });
await page.goto(`${base}/?autostart=1&god=1&give=all`);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const tp = (x, y, z, yawDeg = 0) => ev(([x, y, z, yaw]) => {
  const g = window.__game; const V = g.player.position.constructor;
  g.player.teleport(new V(x, y, z), yaw * Math.PI / 180, 0);
}, [x, y, z, yawDeg]);
const use = (id) => ev((id) => { const g = window.__game; const i = g.interactables.get(id); if (!i) return 'missing'; if (!i.enabled) return 'disabled'; g.interactables.use(i); return 'ok'; }, id);
const key = async (code) => { await page.keyboard.press(code); };
const killAll = () => ev(() => {
  const g = window.__game; const V = g.player.position.constructor; let n = 0;
  for (const e of [...g.enemies.all]) {
    if (!e.alive || e.state === 'dormant') continue;
    for (let k = 0; k < 6 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1));
    n++;
  }
  return n;
});
const status = () => ev(() => {
  const g = window.__game;
  return { state: g.state, objective: g.story.objective, room: g.level.roomAt(g.player.position)?.id, active: g.enemies.activeCount,
    alive: g.enemies.all.filter((e) => e.alive).length, fps: g.debug.fps, calls: g.renderer.info.render.calls,
    locked: g.level.doors.filter((d) => d.locked).map((d) => d.id).join(',') };
});
const step = async (name, expect) => {
  const s = await status();
  await page.screenshot({ path: `shots/pt-${name}.png` });
  console.log(`[${name}]`, JSON.stringify(s));
  if (expect) { const why = expect(s); if (why) { problems.push(`${name}: ${why}`); console.log('  !! ' + why); } }
  return s;
};
const closeOverlay = async () => { await wait(1200); await key('KeyE'); await wait(400); const s = await status(); if (s.state === 'paused') { await key('Escape'); await wait(400); } };

await wait(2500); await step('01-med');
await tp(0, 0, -7); await wait(1200); await step('02-blackout'); await wait(3500);
await tp(0, 0, -16, 0); await wait(800); console.log('  fab door:', await use('door_d_fab_outer')); await wait(500);
await step('03-junction', (s) => s.locked.includes('d_fab_outer') ? null : 'd_fab_outer should be locked before the security ambush');
await tp(-7, 0, -17, 90); await wait(6500); await step('04-sec-ambush', (s) => s.alive > 0 ? null : 'g_sec did not spawn');
await wait(2500); console.log('  killed', await killAll()); await wait(6000);
await step('05-sec-cleared', (s) => s.locked.includes('d_fab_outer') ? 'd_fab_outer still locked after g_sec cleared' : null);
console.log('  console:', await use('term_sec_unlock')); await closeOverlay();
await step('06-storage-unlocked', (s) => s.locked.includes('d_storage') ? 'd_storage still locked' : (s.state !== 'playing' ? 'not back in playing: ' + s.state : null));
await tp(0, 0, -17, 0); await wait(4500); await step('07-husk-wakes', (s) => s.alive > 0 ? null : 'junction husk missing');
console.log('  killed', await killAll());
await tp(6, 0, -17, -90); await wait(3500); await step('08-storage'); console.log('  killed', await killAll());
await tp(0, 0, -23, 0); await wait(2500); await step('09-airlock');
await tp(0, 0, -27.5, 0); await wait(9000); await step('10-fab-reveal');
await tp(-2.5, 0, -38, 90); await wait(4500); await step('11-fab-first', (s) => s.active > 0 ? null : 'g_fab_first did not wake'); console.log('  killed', await killAll());
await tp(0, 0, -48, 0); await wait(500); console.log('  lobby door:', await use('door_d_lobby')); await wait(800);
await tp(15, 0, -38, -90); await wait(2500); await step('12-gen');
console.log('  lever:', await use('gen_lever')); await wait(3000); await step('13-power');
await tp(9, 0, -38, 90); await wait(2500); await step('14-fab-lit');
await wait(7000); await step('15-fab-ambush', (s) => s.locked.includes('d_lobby') ? 'd_lobby still locked after power' : null);
await wait(7000); await step('16-fab-ambush-2', (s) => s.active >= 4 ? null : `expected rack husks + sentry active, got ${s.active}`);
console.log('  killed', await killAll());
await tp(0, 0, -52, 0); await wait(5000); await step('17-lobby', (s) => s.active > 0 ? null : 'g_lobby did not wake'); console.log('  killed', await killAll());
await tp(0, 0, -60.5, 0); await wait(2500); await step('18-elevator');
console.log('  button:', await use('elev_button')); await wait(6000); await step('19-descent', (s) => s.state === 'cutscene' ? null : 'descent cutscene not running: ' + s.state);
await page.waitForFunction(() => window.__game.state === 'ended', null, { timeout: 90000 }).catch(() => problems.push('never reached state "ended"'));
await wait(4000); await step('20-end');

await browser.close();
console.log(problems.length ? `\nFAILED:\n - ${problems.join('\n - ')}` : '\nPLAYTHROUGH OK');
process.exit(problems.length ? 1 : 0);
