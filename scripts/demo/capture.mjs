// Fixed-timestep capture of one or more demo shots (scripts/demo/shots.mjs).
//   node scripts/demo/capture.mjs [--base http://127.0.0.1:5199] [--only A,B] [--w 1920 --h 1080]
// For every shot: boots the game with scripts/demo/hooks.js injected, optionally loads a real checkpoint
// save (shots/demo/saves/<cp>.json, from scripts/demo/saves.mjs), runs the shot's coroutine in the page,
// steps the game exactly 1/60 s per frame and pipes a screenshot of every recorded frame to ffmpeg.
// Audio is rendered in lock-step by the page's OfflineAudioContext and written next to the clip.
// Output: shots/demo/clips/<name>.mp4 (video) + <name>.wav (synced audio) + <name>.json (timing).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { SHOTS } from './shots.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? '1' : process.argv[++i];
}
const BASE = args.base ?? 'http://127.0.0.1:5199';
const W = Number(args.w ?? 1920), H = Number(args.h ?? 1080);
const FPS = 60;
const only = args.only ? args.only.split(',') : null;
const OUT = 'shots/demo/clips';
mkdirSync(OUT, { recursive: true });
const hooks = readFileSync(new URL('./hooks.js', import.meta.url), 'utf8');

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

for (const shot of SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  const t0 = Date.now();
  console.log(`\n── shot ${shot.name}: ${shot.title}`);
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning' || m.text().startsWith('[shot]')) console.log(`  [${t}] ${m.text().slice(0, 240)}`); });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  let save = null;
  if (shot.save) {
    save = JSON.parse(readFileSync(`shots/demo/saves/${shot.save}.json`, 'utf8'));
    // saves harvested before the v2 schema (stage 3a §8.1): same record, new envelope
    if (save.v === 1) Object.assign(save, { v: 2, level: 1, rev: 1, facts: {} });
    if (shot.patchSave) shot.patchSave(save);
  }
  await page.addInitScript(({ save, audioSeconds }) => {
    window.__capCfg = { audioSeconds };
    try { if (save) localStorage.setItem('coldboot.save.l1.v2', JSON.stringify(save)); else localStorage.removeItem('coldboot.save.l1.v2'); } catch { /* ignore */ }
  }, { save, audioSeconds: shot.audioSeconds ?? 60 });
  await page.addInitScript({ content: hooks });
  if (shot.init) await page.addInitScript({ content: shot.init });
  const query = shot.query + (save ? '&continue=1' : '');
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 90000, polling: 100 });
  await page.waitForTimeout(shot.settleMs ?? 1500);
  if (shot.free) await page.evaluate(shot.free);
  // Start the shot coroutine (it runs inside the stepped clock).
  await page.evaluate(`(() => {
    const g = window.__game, cap = window.__cap, ctl = cap.ctl;
    cap.attach(g); cap.begin();
    cap.done = false; cap.marks = [];
    const mark = (name) => cap.marks.push([name, ctl.t]);
    const V = (x, y, z) => new g.player.position.constructor(x, y, z);
    const fn = ({ ${shot.run.toString()} }).run;
    Promise.resolve().then(() => fn({ g, ctl, cap, V, mark })).catch((e) => console.error('[shot] failed', e && e.stack || e)).finally(() => { cap.done = true; });
  })()`);

  const cdp = await context.newCDPSession(page);
  const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '10', '-pix_fmt', 'yuv420p', '-r', String(FPS), `${OUT}/${shot.name}.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] });
  let frames = 0, recStart = null, recEnd = null, steps = 0;
  const maxSteps = Math.ceil((shot.maxSeconds ?? 60) * FPS);
  let pendingWrite = Promise.resolve();
  for (;;) {
    const [rec, done, t] = await page.evaluate(async () => { const r = await window.__cap.step(1 / 60); return [r, window.__cap.done, window.__cap.ctl.t]; });
    steps++;
    if (rec || recStart !== null) {
      // once recording has started every frame is kept (marks + audio stay in sync); cut in the edit
      if (recStart === null) recStart = t;
      recEnd = t;
      const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 96, optimizeForSpeed: true });
      const buf = Buffer.from(r.data, 'base64');
      await pendingWrite;
      pendingWrite = new Promise((res) => { if (!ff.stdin.write(buf)) ff.stdin.once('drain', res); else res(); });
      frames++;
      if (frames % 300 === 0) console.log(`  ${frames} frames (${(frames / FPS).toFixed(1)} s) — ${((Date.now() - t0) / 1000).toFixed(0)} s elapsed`);
    }
    if (done || steps >= maxSteps) break;
  }
  await pendingWrite;
  ff.stdin.end();
  await new Promise((res) => ff.on('close', res));
  const marks = await page.evaluate(() => window.__cap.marks);
  if (recStart !== null) {
    const wav = await page.evaluate(([a, b]) => window.__cap.finishAudio(a, b), [recStart, recEnd + 1 / FPS]);
    if (wav) writeFileSync(`${OUT}/${shot.name}.wav`, Buffer.from(wav, 'base64'));
  }
  const meta = { name: shot.name, frames, seconds: frames / FPS, recStart, marks: marks.map(([n, t]) => [n, +(t - (recStart ?? 0)).toFixed(3)]) };
  writeFileSync(`${OUT}/${shot.name}.json`, JSON.stringify(meta, null, 1));
  console.log(`  done: ${frames} frames, ${(frames / FPS).toFixed(2)} s, marks ${JSON.stringify(meta.marks)} — ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await context.close();
}
await browser.close();
void existsSync;
