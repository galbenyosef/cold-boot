// Headless screenshot + console capture for verifying work without a human.
// Usage:
//   node scripts/shot.mjs --url "http://127.0.0.1:5173/?autostart=1&spawn=0,0,7,0" --out shots/a.png
//        [--wait 4000] [--width 1600] [--height 900] [--eval "window.__game.player.teleport(...)"]
//        [--eval-wait 1000] [--frames 3 --interval 500]
// Prints every console error / page error, and the fps reported by window.__game.debug.fps if present.
// Exit code 1 if there were page errors.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? '1' : process.argv[++i];
}
const url = args.url ?? 'http://127.0.0.1:5173/?autostart=1';
const out = args.out ?? 'shots/shot.png';
const wait = Number(args.wait ?? 4000);
const width = Number(args.width ?? 1600);
const height = Number(args.height ?? 900);
const frames = Number(args.frames ?? 1);
const interval = Number(args.interval ?? 500);
mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-swiftshader',
         '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
let errors = 0;
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') console.log(`[console.${t}] ${m.text()}`);
  else if (args.verbose) console.log(`[console.${t}] ${m.text()}`);
});
page.on('pageerror', (e) => { errors++; console.log(`[pageerror] ${e.message}\n${e.stack ?? ''}`); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 }).catch(() => {
  console.log('[shot] WARNING: window.__game.ready never became true (60s)');
});
await page.waitForTimeout(wait);
if (args.eval) {
  const r = await page.evaluate(args.eval).catch((e) => `EVAL ERROR: ${e.message}`);
  if (r !== undefined) console.log('[eval]', typeof r === 'string' ? r : JSON.stringify(r));
  await page.waitForTimeout(Number(args['eval-wait'] ?? 1000));
}
for (let i = 0; i < frames; i++) {
  const f = frames === 1 ? out : out.replace(/(\.\w+)$/, `-${i}$1`);
  await page.screenshot({ path: f });
  console.log(`[shot] wrote ${f}`);
  if (i < frames - 1) await page.waitForTimeout(interval);
}
const info = await page.evaluate(() => {
  const g = window.__game;
  if (!g) return null;
  const r = g.renderer?.info;
  return { state: g.state, fps: g.debug?.fps, calls: r?.render?.calls, tris: r?.render?.triangles,
           gpu: (() => { try { const gl = g.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; } catch { return 'n/a'; } })() };
}).catch(() => null);
console.log('[info]', JSON.stringify(info));
await browser.close();
process.exit(errors ? 1 : 0);
