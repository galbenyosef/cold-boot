// ST's own order-independence cases not in playthrough-l4: §9 #7 (video log, hold cleared mid-log), #22 (sprint to the
// tube end before F6, F5 units alive), #10 (run past the ambush: checkpoint waits for calm), stuck-free end.
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://127.0.0.1:4566';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const problems = [];
const ok = (c, m) => { console.log(`  ${c ? 'ok' : '!!'} ${m}`); if (!c) problems.push(m); return c; };
page.on('pageerror', (e) => ok(false, 'pageerror ' + e.message));
const ev = (fn, a) => page.evaluate(fn, a);
const wait = (ms) => page.waitForTimeout(ms);
const until = async (fn, a, ms = 60000) => { try { await page.waitForFunction(fn, a, { timeout: ms, polling: 100 }); return true; } catch { return false; } };
const tp = (x, y, z, yaw = 0) => ev(([x, y, z, yaw]) => { const g = window.__game; const V = g.player.position.constructor; g.player.teleport(new V(x, y, z), yaw * Math.PI / 180, 0); }, [x, y, z, yaw]);
const use = (id) => ev((id) => { const g = window.__game; const i = g.interactables.get(id); if (!i) return 'missing'; if (!i.enabled) return 'disabled'; g.interactables.use(i); return 'ok'; }, id);
const ds = () => ev(() => window.__game.story.debugState);
const said = (id, ms = 30000) => until((id) => window.__game.story.lineLog.some((l) => l.said === id), id, ms);
const boot = async (q) => { await page.goto(`${base}/?level=4&autostart=1&god=1${q}`); await page.waitForFunction(() => window.__game?.ready && window.__game.story?.debugState, null, { timeout: 120000 }); };
const killAwake = (groups) => ev((groups) => { const g = window.__game; const V = g.player.position.constructor; for (const e of [...g.enemies.all]) { if (!e.alive || e.state === 'dormant' || (groups && !groups.includes(e.group))) continue; for (let k = 0; k < 8 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1)); } }, groups ?? null);
const toClean = async () => {
  await until(() => window.__game.story.debugState.flags.deconDone, null, 20000);
  await tp(0, 4.8, -7.6, 0);
  ok(await until(() => window.__game.story.debugState.phaseApplied === 'C', null, 20000), 'phase C');
};

// ── #7 the video log, the hold cleared mid-log
console.log('══ #7 video log + override mid-log');
await boot('&noenemies=1'); await ev(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('coldboot.')) localStorage.removeItem(k); }); await boot('&noenemies=1');
await toClean();
await tp(8, 4.8, -14.4, 0); await wait(300);
ok((await use('log4_video')) === 'ok', 'Play log');
ok(await said('l4_sunde_3', 20000), 'log at _3');
await ev(() => window.__game.story.fire('override'));
ok(await until(() => window.__game.story.debugState.video.state === 'paused', null, 15000), 'the log pauses at a line end for the scene line');
const d1 = await ds();
const log = await ev(() => window.__game.story.lineLog.filter((l) => l.said).map((l) => ({ id: l.said, t: l.t, end: l.end })));
const s3 = log.filter((l) => l.id.startsWith('l4_sunde_')).slice(-1)[0];
const hold = await until(() => window.__game.story.lineLog.some((l) => /l4_choir_hold_/.test(l.said ?? '')), null, 15000);
ok(hold, 'CHOIR hold line plays');
const log2 = await ev(() => window.__game.story.lineLog.filter((l) => l.said).map((l) => ({ id: l.said, t: l.t, end: l.end })));
const h = log2.find((l) => /l4_choir_hold_/.test(l.id));
ok(h && s3 && h.t >= (s3.end ?? 0) - 0.05, `CHOIR waits for the Sunde line to end (sunde end ${s3?.end}, choir ${h?.t})`);
ok(await until(() => window.__game.story.debugState.beats.includes('l4_lights_out'), null, 15000), 'lights-out follows');
const lo = (await ds()).t.l4_lights_out;
const h2 = (await ev(() => window.__game.story.lineLog.filter((l) => /l4_choir_hold_/.test(l.said ?? '')).map((l) => l.end)))[0];
ok(Math.abs(lo - h2 - 0.4) < 0.12, `lights-out at CHOIR end + 0.4 (${(lo - h2).toFixed(2)})`);
const next = d1.video.next;
await wait(1500);
ok((await use('log4_video')) === 'ok', 'Play log again');
ok(await until((n) => window.__game.story.lineLog.filter((l) => l.said === `l4_sunde_${n + 1}`).length >= 1, next, 10000), `resumes at the first line not finished (_${next + 1})`);
// stop mid-line, resume
await wait(600);
ok((await use('log4_video')) === 'ok', 'Stop log');
ok(await until(() => window.__game.story.debugState.video.state === 'paused' && !window.__game.story.debugState.speaking, null, 3000), 'stopped (fade), paused');
const n2 = (await ds()).video.next;
ok((await use('log4_video')) === 'ok', 'Play log (resume)');
ok(await until((n) => window.__game.story.lineLog.filter((l) => l.said === `l4_sunde_${n + 1}`).length >= 2 || window.__game.story.lineLog.filter((l) => l.said === `l4_sunde_${n + 1}`).length >= 1, n2, 8000), `resume at _${n2 + 1}`);
ok(await until(() => window.__game.story.lineLog.some((l) => l.said === 'l4_sunde_9' && typeof l.end === 'number'), null, 60000), 'log ran to _9');
const nine = (await ev(() => window.__game.story.lineLog.filter((l) => l.said === 'l4_sunde_9')))[0];
ok(nine && Math.abs(nine.end - nine.t - 3.27) < 0.1, `_9 cut at ${(nine.end - nine.t).toFixed(2)} s`);
ok(await ev(() => window.__game.facts.l4_video === true), 'fact l4_video');

// ── #22 the tube end before F6, F5 units alive behind
console.log('══ #22 sprint to the tube end before F6');
await boot(''); await ev(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('coldboot.')) localStorage.removeItem(k); }); await boot('');
await toClean();
await tp(-1.2, 4.8, -29, -90); await wait(300);
ok((await use('cold_ack')) === 'ok', 'cold_ack');
ok(await until(() => window.__game.story.debugState.beats.includes('l4_lights_out'), null, 20000), 'lights-out');
// run past the ambush: straight to the navy level (checkpoints must wait for calm)
await wait(6000);
await tp(12, 0, -57.5, 180); await wait(1500);
const cpl = (await ds()).checkpoints;
ok(!cpl.includes('cp4_hold') && !cpl.includes('cp4_lower'), `#10 runs past the ambush: no checkpoint while units hunt (${cpl})`);
await tp(54.6, 0, -59, -90); await wait(300);
ok((await use('valve4')) === 'ok', 'valve first (#15)');
ok(await until(() => window.__game.story.debugState.flags.equalised, null, 40000), 'equalised (fixed 25 s)');
await tp(28, 0, -56.8, 180); await wait(300);
ok((await use('booth_release')) === 'ok', 'release');
ok(await until(() => window.__game.story.debugState.phaseApplied === 'E', null, 5000), 'phase E');
const aliveF5 = await ev(() => window.__game.enemies.all.filter((e) => e.alive && ['g4_chk_sentry', 'g4_store', 'g4_plant'].includes(e.group)).length);
console.log(`  .. F5/plant units alive: ${aliveF5}`);
await tp(32, 0, -76, 180); await wait(300); await tp(32, 0, -104, 180); await wait(500);
await ev(() => { const g = window.__game; const d = g.level.doors.find((x) => x.id === 'd4_tube_s'); g.events.emit('door:denied', { id: 'd4_tube_s', position: d.position }); });
ok(await said('l4_unit_gatelock', 4000), 'gate lock cycling line (#22)');
ok((await ds()).flags.tubeFight === false || aliveF5 === 0, 'F6 waits while F5 units are near / seen');
ok(await until(() => window.__game.story.debugState.flags.tubeFight, null, 120000), 'F6 starts when the rule holds (dead, or ≥ 25 m unseen 20 s, or stranded)');
const fight = await until(() => { const g = window.__game; const V = g.player.position.constructor; for (const e of [...g.enemies.all]) { if (!e.alive || e.state === 'dormant') continue; for (let k = 0; k < 8 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1)); } return g.story.debugState.flags.gateOpen; }, null, 40000);
ok(fight, 'gate lock open (F)');
await tp(32, 0, -110, 180);
ok(await until(() => window.__game.state === 'ended', null, 60000), 'the end');
void killAwake;
await browser.close();
console.log(problems.length ? `\nFAILED (${problems.length})\n - ${problems.join('\n - ')}` : '\nST CASES OK');
process.exit(problems.length ? 1 : 0);
