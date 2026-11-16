// Dead robots on the floor must be walked OVER, not into (user-found defect class).
//   node scripts/check-wreck.mjs [baseUrl]   → prints one line per wreck, exit 1 on failure.
// Kills a husk and a sentry in an open room, waits for the wreck collider, then walks the player straight
// across each wreck with real movement input from four directions.
import { chromium } from 'playwright';
const base = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
await page.goto(`${base}/?level=2&autostart=1&god=1&nostory=1&noenemies=1&spawn=-4,0,-30,0`);
await page.waitForFunction(() => window.__game?.state === 'playing' || window.__game?.game?.state === 'playing' || window.__game?.player?.position, null, { timeout: 60000 });
await page.waitForTimeout(3000);
const ev = (fn, arg) => page.evaluate(fn, arg);
let failed = 0;
for (const type of ['husk', 'sentry']) {
  const made = await ev((type) => {
    const g = window.__game, V = g.player.position.constructor;
    const p = g.player.position;
    const e = g.enemies.spawn(type, new V(p.x, p.y + (type === 'sentry' ? 1.2 : 0), p.z - 4), 0, 'wreck_test');
    window.__wt = e;
    return !!e;
  }, type);
  if (!made) { console.log(`FAIL ${type}: could not spawn`); failed++; continue; }
  await page.waitForTimeout(800);
  // kill it through the real path: hitscan from above it, then damage until it is dead
  const dead = await ev(() => {
    const g = window.__game, V = g.player.position.constructor, e = window.__wt;
    for (let i = 0; i < 60 && g.enemies.aliveInGroup('wreck_test') > 0; i++) {
      const o = new V(e.position.x, e.position.y + 3, e.position.z + 0.02), d = new V(0, -1, 0);
      const hit = g.enemies.hitscan(o, d, 6) ?? g.enemies.hitscan(g.player.eye, new V().subVectors(e.position, g.player.eye).setY(0.3).normalize(), 12);
      if (hit) g.enemies.damage(hit, 400, d);
    }
    return g.enemies.aliveInGroup('wreck_test') === 0;
  });
  if (!dead) { console.log(`FAIL ${type}: could not kill it`); failed++; continue; }
  // move away so the collider is allowed to appear, then wait for the body to settle
  await ev(() => { const g = window.__game, V = g.player.position.constructor; g.player.teleport(new V(g.player.position.x + 7, g.player.position.y, g.player.position.z)); });
  let box = null;
  for (let i = 0; i < 60 && !box; i++) {
    await page.waitForTimeout(250);
    box = await ev(() => { const e = window.__wt; const b = (e.wreckBody ?? e.impl?.wreckBody)?.box; return b ? { min: b.min.toArray(), max: b.max.toArray(), walkable: !!(e.wreckBody ?? e.impl?.wreckBody).walkable } : null; });
  }
  if (!box) { console.log(`FAIL ${type}: no wreck collider appeared`); failed++; continue; }
  if (process.argv.includes('--selftest')) await ev(() => { const e = window.__wt; (e.wreckBody ?? e.impl?.wreckBody).walkable = false; }); // old behaviour: must FAIL
  const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2, top = box.max[1], h = box.max[1] - box.min[1];
  for (const [dx, dz, name] of [[0, 1, 'from +z'], [0, -1, 'from -z'], [1, 0, 'from +x'], [-1, 0, 'from -x']]) {
    const res = await (async () => {
      await ev(([x, y, z, yaw]) => { const g = window.__game, V = g.player.position.constructor; g.player.teleport(new V(x, y, z), yaw, 0); }, [cx + dx * 2.0, box.min[1] + 0.05, cz + dz * 2.0, Math.atan2(dx, dz)]);
      await page.waitForTimeout(300);
      let maxY = -1e9, crossed = false;
      for (const end = Date.now() + 4000; Date.now() < end; ) {
        await ev(() => window.__game.player.debug.move(1, 0, false));
        const p = await ev(() => window.__game.player.position.toArray());
        maxY = Math.max(maxY, p[1]);
        if ((p[0] - cx) * dx + (p[2] - cz) * dz < -1.2) { crossed = true; break; }
        await page.waitForTimeout(60);
      }
      await ev(() => window.__game.player.debug.move(0, 0, false));
      return { crossed, rose: maxY - box.min[1] };
    })();
    const ok = res.crossed && res.rose > h * 0.6;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${type} wreck (h ${h.toFixed(2)} m, walkable ${box.walkable}) ${name}: ${res.crossed ? 'walked across' : 'STOPPED'}, rose ${res.rose.toFixed(2)} m`);
  }
  await ev(() => { try { window.__game.enemies.removeGroup?.('wreck_test'); } catch {} });
}
await browser.close();
console.log(failed ? `WRECKS: ${failed} failure(s)` : 'WRECKS OK');
process.exit(failed ? 1 : 0);
