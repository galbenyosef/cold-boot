// Shared helpers for scripts/check-*.mjs: arg parsing, headless boot of a level, JSON output.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

/** `--level N` → [N]; `all` (default) → every built level (stage 3d §8.1: 1–6; level 6 is K's stub until W4a). */
export function levelsOf(args) {
  const l = args.level ?? 'all';
  return l === 'all' ? [1, 2, 3, 4, 5, 6] : [Number(l)];
}

/**
 * The headless shell to run: playwright's own, or — when the installed playwright's browser revision was never
 * downloaded (`npx playwright install` not run after an update) — the newest `chromium_headless_shell-*` in the cache.
 */
function shellPath() {
  try { const p = chromium.executablePath(); if (existsSync(p)) return undefined; } catch { /* fall through */ }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  try {
    const dirs = readdirSync(cache).filter((d) => /^chromium_headless_shell-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const d of dirs) {
      for (const sub of readdirSync(join(cache, d))) {
        const exe = join(cache, d, sub, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
        if (existsSync(exe)) { console.log(`  note playwright's browser is missing; using ${d}`); return exe; }
      }
    }
  } catch { /* none */ }
  return undefined;
}

export async function launch() {
  return chromium.launch({
    headless: true,
    executablePath: shellPath(),
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
