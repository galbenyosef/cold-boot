// Harvest real checkpoint saves (coldboot.save.l1.v2) for the demo shots, by playing the story quickly
// (teleports + story hooks, like scripts/playthrough.mjs in its fast mode). Writes shots/demo/saves/<cp>.json.
//   node scripts/demo/saves.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5199';
const KEY = 'coldboot.save.l1.v2';
mkdirSync('shots/demo/saves', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/?autostart=1&god=1&quality=low`);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
await page.evaluate((k) => localStorage.removeItem(k), KEY);
await page.reload();
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });

const ev = (fn, a) => page.evaluate(fn, a);
const wait = (ms) => page.waitForTimeout(ms);
const tp = (x, z, yaw = 0, pitch = 0) => ev(([x, z, yaw, pitch]) => { const g = window.__game; const V = g.player.position.constructor; g.player.teleport(new V(x, 0, z), yaw * Math.PI / 180, pitch * Math.PI / 180); }, [x, z, yaw, pitch]);
const use = (id) => ev((id) => { const g = window.__game; const i = g.interactables.get(id); if (!i) return 'missing'; if (!i.enabled) return 'disabled'; g.interactables.use(i); return 'ok'; }, id);
const closeNote = async () => { await wait(900); await ev(() => window.__game.ui.closeNote?.()); await wait(350); };
const hurry = () => ev(() => window.__game.story.hurry?.());
const killAll = () => ev(() => {
  const g = window.__game; const V = g.player.position.constructor; let n = 0;
  for (const e of [...g.enemies.all]) {
    if (!e.alive || e.state === 'dormant') continue;
    for (let k = 0; k < 6 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1));
    n++;
  }
  return n;
});
const waitBeat = async (id, s = 30) => {
  const end = Date.now() + s * 1000;
  while (Date.now() < end) { if ((await ev(() => window.__game.story.debugState?.beats ?? [])).includes(id)) return true; await hurry(); await wait(250); }
  console.log('  beat never fired:', id); return false;
};
const grab = async (id, s = 25) => {
  const end = Date.now() + s * 1000;
  while (Date.now() < end) {
    const sv = await ev((k) => localStorage.getItem(k), KEY);
    if (sv && JSON.parse(sv).id === id) { writeFileSync(`shots/demo/saves/${id}.json`, sv); console.log('saved', id); return; }
    await wait(200);
  }
  console.log('!! no save', id);
};

// A — to the pistol
await wait(800);
await tp(1.4, 1.2, 0); await use('log_med'); await closeNote();
await tp(0, -18.6, 0); await wait(900); await use('door_d_fab_outer'); await wait(700);
await tp(-8.8, -17, 90); await wait(600); await use('term_sec_unlock'); await wait(500); await closeNote();
await tp(-8, -19.6, 180); await wait(600); await use('p_pistol'); await wait(800);
await waitBeat('armed', 6);
await grab('cp_armed');
// B — vent, junction husk, airlock
await tp(-6.5, -17, 90, 25); await waitBeat('#sec_vent_drop', 20); await wait(1500);
await tp(-1.6, -17, -90); await waitBeat('husk_wakes', 15); await wait(5000);
await killAll(); await wait(1500);
await tp(0, -22, 0);
await grab('cp_fab');
await waitBeat('#airlock_cycle', 15);
// C — hall, bench husk, lock-out
await tp(0, -27.6, 0); await waitBeat('fab_reveal', 10); await wait(1500);
await tp(-1.2, -37.2, 90); await waitBeat('fab_first_fight', 10); await wait(4500);
await killAll(); await wait(1000); await killAll();
await tp(14, -38, -90); await wait(600);
await ev(() => { const g = window.__game; const i = g.interactables.get('gen_lever'); const V = g.player.position.constructor; g.player.teleport(new V(i.position.x - 1.4, 0, i.position.z), -Math.PI / 2, 0); });
await wait(800); await use('gen_lever'); await wait(700); await closeNote();
await grab('cp_lockout');
// D — pump room
await tp(-13.4, -38, 90); await waitBeat('pump_enter', 10);
await tp(-18.5, -38, 90); await waitBeat('pump_first_skitter', 10); await wait(3500);
await killAll(); await wait(800);
const keyId = await ev(() => window.__game.level.pickupSpawns.find((p) => p.kind === 'keycard')?.id);
const kp = await ev((id) => { const i = window.__game.interactables.get(id); return [i.position.x, i.position.z]; }, keyId);
await tp(kp[0] + 1.0, kp[1], 90, -40); await wait(800);
await use('p_shotgun'); await use(keyId); await wait(600);
await waitBeat('key_taken', 8); await wait(4500);
await killAll(); await wait(800);
await grab('cp_key');
// E — back across, to the breaker
await tp(-8, -38, -90); await waitBeat('fab_return', 10); await wait(5500);
await killAll(); await wait(800);
await ev(() => { const g = window.__game; const i = g.interactables.get('gen_lever'); const V = g.player.position.constructor; g.player.teleport(new V(i.position.x - 1.4, 0, i.position.z), -Math.PI / 2, 0); });
await wait(1200);
await grab('cp_breaker');
await browser.close();
