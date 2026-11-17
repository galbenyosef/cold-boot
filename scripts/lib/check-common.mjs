// Shared helpers for scripts/check-*.mjs: arg parsing, headless boot of a level, JSON output.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

export function parseArgs(argv = process.argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const n = argv[i + 1];
      args[a.slice(2)] = n === undefined || n.startsWith('--') ? '1' : (i++, n);
    }
  }
  return args;
}

/** `--level N` → [N]; `all` (default) → every built level (stage 3b §10.2: 1–4; level 4 is K's stub until W4). */
export function levelsOf(args) {
  const l = args.level ?? 'all';
  return l === 'all' ? [1, 2, 3, 4] : [Number(l)];
}

export async function launch() {
  return chromium.launch({
    headless: true,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-swiftshader',
           '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
}

/** Open a page on the given level, wait for __game.ready and a few frames. */
export async function bootLevel(browser, base, level, { width = 1280, height = 720, settle = 2500, query = '' } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  const url = `${base.replace(/\/$/, '')}/?level=${level}&autostart=1&nostory=1&noenemies=1${query}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000 });
  await page.waitForTimeout(settle);
  return page;
}

export function writeJson(name, level, data) {
  mkdirSync('shots/checks', { recursive: true });
  const f = `shots/checks/${name}-l${level}.json`;
  writeFileSync(f, JSON.stringify(data, null, 1));
  return f;
}
