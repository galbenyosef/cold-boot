// Title / intro / end cards: while a line animates its letter-spacing, its number of text lines must not change and it
// must stay on screen, at four window sizes. Usage: node scripts/check-cards.mjs [url]
import { chromium } from 'playwright';
const b = await chromium.launch();
let bad = 0;
const CASES = [
  { style: 'title', lines: ['LINE TWO', 'FREIGHT DOCK 5'] },
  { style: 'title', lines: ['BIOLOGICAL SYSTEMS', 'ERIDU DEEP — BIO-SYS'] },
  { style: 'title', lines: ['THE QUIET SIDE', 'HABITAT RING A  ·  61 HOURS AFTER THE TEST BEGAN'] },
  { style: 'intro', lines: ['ERIDU DEEP', 'A fabrication complex 2.1 km under the sea. For sixty-one hours the sublevels have been sealed for a pressure test that nobody upstairs has questioned.', 'YOU SLEPT THROUGH IT'] },
  { style: 'ending', lines: ['BIOLOGICAL SYSTEMS', '', 'TO BE CONTINUED'] },
  { style: 'ending', lines: ['POST 4', '', 'TO BE CONTINUED'] },
  // stage 3d W2a: the chapter end
  { style: 'title', lines: ['END OF CHAPTER 3'] },
  { style: 'ending', lines: ['THE TRUNK', '', 'TO BE CONTINUED'] },
];
for (const [w, h] of [[2000, 1125], [1280, 720], [900, 600], [520, 800]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(`${(process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:5173").replace(/\/$/, "")}/?level=4&autostart=1`);
  await p.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000 });
  for (const c of CASES) {
    await p.evaluate((c) => { void window.__game.ui.showCard(c.lines, { style: c.style, skippable: true, seconds: 5 }); }, c);
    const seen = new Map(); const t0 = Date.now();
    while (Date.now() - t0 < 6500) {
      const r = await p.evaluate(() => [...document.querySelectorAll('.card .big, .card .ln')].filter((e) => e.textContent.trim()).map((e) => {
        const rects = []; const rg = document.createRange(); rg.selectNodeContents(e);
        for (const q of rg.getClientRects()) if (!rects.some((y) => Math.abs(y - q.top) < 2)) rects.push(q.top);
        const rc = e.getBoundingClientRect();
        return { t: e.textContent.slice(0, 22).replace(/\n/g, '|'), lines: rects.length, off: rc.left < -1 || rc.right - parseFloat(getComputedStyle(e).letterSpacing) > innerWidth + 1, ls: getComputedStyle(e).letterSpacing };
      }));
      for (const x of r) { const s = seen.get(x.t) ?? { n: new Set(), off: false, ls: new Set() }; s.n.add(x.lines); s.off ||= x.off; s.ls.add(x.ls); seen.set(x.t, s); }
      await p.waitForTimeout(60);
    }
    for (const [k, s] of seen) { const ok = s.n.size === 1 && !s.off; if (!ok) bad++; console.log(`${w}x${h} ${c.style.padEnd(6)} ${ok ? 'ok ' : 'BAD'} "${k}" lines ${[...s.n].join('→')}${s.off ? ' OFF-SCREEN' : ''} (spacing states ${s.ls.size})`); }
    await p.keyboard.press('Space'); await p.waitForTimeout(1800);
  }
  await p.close();
}
await b.close(); console.log(bad ? `FAILED ${bad}` : 'CARDS OK');
