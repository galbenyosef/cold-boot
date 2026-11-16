// Cutscene camera + player cinematic + safe state + key consume (docs/plans/stage-3a.md §8.2, §8.3; task P4).
//   node scripts/check-cutscene.mjs [--url http://127.0.0.1:5173] [--only natural,skip,enter,safe,levels] [--frames]
// On a static build (vite build + vite preview), like the playthroughs. Exit 1 on any failure.
// Runs the dev scene (`?cutdev=1` on the two-deck greybox, src/story/dev/cutscene.ts): dev_meet (standing, cut to
// black, chained like C1 → C2) and dev_seated (seated, rise-and-turn hand-back, safe state after).
//   natural — first view: entered sprinting through the trigger; nothing the player does during the scenes moves,
//             turns, fires, reloads, jumps, steps or skips; camera at sample times = the shot table (±2 cm, ±1°);
//             durations ±0.5 s; end pose / yaw / weapon state exact; Δyaw(last shot, place) ≤ 1°; view continuity
//             at the hand-back (camera matrix delta of the last scene frame vs the first interactive frame)
//   skip    — refused before seen (above), accepted after: hold SPACE 0.6 s → both scenes skipped (re-arm between),
//             the same world state as the natural end (incl. fov, attention, controls, safe), no jump on hand-back
//   enter   — backwards, mid-jump, mid-reload, mid palm-scan, a note open, paused (deferred), fire held, dying (refused)
//   safe    — no shot / reload / switch while safe under pressed + held fire; look, move, interact work; the latch ends
//             it and the weapon is up (lower 0) within 0.5 s; no shot through either transition while firing every frame
//   levels  — levels 1 and 2 boot and play with no page error; the new player API is inert there
// --frames writes frame sequences to shots/p4/ (both scenes, the hand-back pair, the skip ring, the safe view).
import { mkdirSync } from 'node:fs';
import { launch, parseArgs } from './lib/check-common.mjs';

const args = parseArgs();
const base = (args.url ?? process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const only = args.only ? new Set(args.only.split(',')) : null;
const want = (k) => !only || only.has(k);
const FRAMES = !!args.frames;
const problems = [];
const bad = (m) => { problems.push(m); console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);
const check = (cond, m) => (cond ? ok(m) : bad(m));
const DEV = '/?level=3&greybox=deck2&nostory=1&autostart=1&give=all&cutdev=1';
const DEG = 180 / Math.PI;
const angD = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) * DEG;

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(e.message); console.log(`  [pageerror] ${e.message}`); });
page.on('console', (m) => { if (m.type() === 'error') console.log(`  [console.error] ${m.text().slice(0, 200)}`); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
if (FRAMES) mkdirSync('shots/p4', { recursive: true });
const shot = async (name) => { if (FRAMES) await page.screenshot({ path: `shots/p4/${name}.png` }); };

async function boot(query = DEV) {
  for (let i = 0; ; i++) {
    try { await page.goto(`${base}${query}`); break; } catch (e) { if (i >= 2) throw e; await wait(700); }
  }
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000 });
  if (query.includes('cutdev')) await page.waitForFunction(() => !!window.__cutdev, null, { timeout: 30000 });
  await wait(1500);
  // event counters + a mouse-look injector (the headless page has no pointer lock)
  await ev(() => {
    const g = window.__game;
    const c = (window.__cnt = { fired: [], reload: 0, jump: 0, step: 0, land: 0, switched: 0, skipShown: [] });
    g.events.on('weapon:fired', () => { const st = g.player.debug.state(); c.fired.push({ t: performance.now(), lower: st.lower, safe: st.safe, cine: st.cinematic, state: g.state }); });
    g.events.on('weapon:reload', () => c.reload++);
    g.events.on('weapon:switched', () => c.switched++);
    g.events.on('player:jump', () => c.jump++);
    g.events.on('player:footstep', () => c.step++);
    g.events.on('player:land', () => c.land++);
    window.__mdx = 0;
    Object.defineProperty(g.input, 'mouseDX', { get: () => window.__mdx, configurable: true });
    const ui = g.ui, show = ui.showSkip?.bind(ui);
    ui.showSkip = (p) => { if (p !== null) c.skipShown.push(p); show?.(p); };
  });
}
const cnt = () => ev(() => { const c = window.__cnt; return { ...c, fired: c.fired.length, firedList: c.fired, skipMax: c.skipShown.length ? Math.max(...c.skipShown) : 0 }; });
const zeroCnt = () => ev(() => { const c = window.__cnt; c.fired = []; c.reload = c.jump = c.step = c.land = c.switched = 0; c.skipShown = []; });
const ws = () => ev(() => window.__cutdev.worldState());
const cs = () => ev(() => window.__cutdev.cut.debugState());
const st = () => ev(() => window.__game.player.debug.state());
/** Wait for the scene clock to reach `t` (s) in scene `id` (or for no scene when id is null). */
const waitScene = (id, t, timeout = 60000) => page.waitForFunction(([id, t]) => {
  const c = window.__cutdev.cut;
  return id === null ? !c.busy : (c.id === id && c.active && c.time >= t);
}, [id, t], { timeout });
const placeOnGallery = (yaw) => ev((yaw) => {
  const g = window.__game, V = g.camera.position.constructor;
  g.player.teleport(new V(0, 4.8, -11.3), yaw, 0);
}, yaw);

// Everything the player could try during a scene: keys, clicks, mouse look, the debug inputs.
async function hammer(ms) {
  const t0 = Date.now();
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
  await ev(() => { window.__mdx = 25; });
  let i = 0;
  while (Date.now() - t0 < ms) {
    await page.mouse.down(); await wait(20); await page.mouse.up();
    if (i % 3 === 0) { await page.keyboard.press('KeyR'); await page.keyboard.press('Digit1'); await page.keyboard.press('KeyF'); await page.keyboard.press('KeyE'); }
    if (i % 4 === 1) { await page.keyboard.down('Space'); await wait(30); await page.keyboard.up('Space'); }
    await ev(() => { const d = window.__game.player.debug; d.fire(); d.jump(); d.reload(); d.move(-1, 1, true); });
    await wait(40); i++;
  }
  await ev(() => { window.__mdx = 0; window.__game.player.debug.move(0, 0, false); });
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
}

const nearV = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tol;

// ───────────────────────────────────────────────────────────── natural (first view) + skip (second)
let naturalEnd = null;
if (want('natural') || want('skip')) {
  console.log('══════════ natural: first view, entered sprinting ══════════');
  await boot();
  await ev(() => window.__cutdev.clearSeen());
  const L = await ev(() => JSON.parse(JSON.stringify(window.__cutdev.layout)));
  await placeOnGallery(Math.PI);
  await wait(300);
  await zeroCnt();
  await ev(() => { window.__cutdev.arm('meet'); window.__game.player.debug.move(1, 0, true); });
  await page.waitForFunction(() => window.__cutdev.cut.active, null, { timeout: 15000 });
  const atStart = await st();
  check(atStart.cinematic === 'lowered' && Math.hypot(atStart.vel[0], atStart.vel[2]) < 0.01, `scene took the player mid-sprint: cinematic ${atStart.cinematic}, velocity ${atStart.vel}`);
  await ev(() => window.__game.player.debug.move(0, 0, false));
  const before = await cnt();
  // one timeline per scene: frames (--frames), pose samples (mid-shot, away from blends) and the input hammer, in time order
  const samples = [], s2 = [];
  let pos1 = null, dsDuring = null;
  const hammerAt = async (id) => {
    pos1 = await st();
    await hammer(1800); // everything the player can press (not seen yet: SPACE must not skip)
    dsDuring = { ...(await cs()), want: id };
  };
  const walk = async (id, frames, sampleTimes, out, extra) => {
    const steps = [];
    if (FRAMES) frames.forEach((t, k) => steps.push({ t, f: () => shot(`${id.slice(4)}_${String(k).padStart(2, "0")}`) }));
    for (const t of sampleTimes) steps.push({ t, f: async () => out.push(await ev(() => window.__cutdev.poseNow())) });
    if (extra) steps.push(extra);
    steps.sort((a, b) => a.t - b.t);
    for (const s of steps) { await waitScene(id, s.t).catch(() => {}); await s.f(); }
  };
  await walk("dev_meet", Array.from({ length: 19 }, (_, k) => 0.15 + k * 0.6), [2.0, 4.4, 7.2], samples, FRAMES ? null : { t: 7.25, f: () => hammerAt("dev_meet") });
  if (!FRAMES) check(nearV(pos1.pos, [L.MEET_BODY.x, L.MEET_BODY.y, L.MEET_BODY.z], 1.2), `body in the scene's room under the camera (${pos1.pos})`);
  await walk("dev_seated", Array.from({ length: 18 }, (_, k) => 0.2 + k * 0.62), [2.4, 5.2, 8.0], s2, FRAMES ? { t: 8.05, f: () => hammerAt("dev_seated") } : null);
  check(dsDuring.active && dsDuring.id === dsDuring.want && !dsDuring.canSkip, `first view: skip refused (canSkip ${dsDuring.canSkip}, still playing ${dsDuring.id} at ${dsDuring.t})`);
  await page.keyboard.down('Space'); // held through the hand-back: must not jump
  await page.mouse.down();           // fire held through the hand-back: must not fire
  // last scene frame and the first interactive frame (the hand-back pair)
  await page.waitForFunction(() => { const c = window.__cutdev.cut; return c.id === 'dev_seated' && c.time >= 11.25; }, null, { timeout: 30000 });
  await shot('handback_0_last_scene');
  await page.waitForFunction(() => !window.__cutdev.cut.busy, null, { timeout: 20000 });
  await shot('handback_1_first_interactive');
  const during = await cnt();
  await wait(600);
  const afterHold = await cnt();
  await page.mouse.up(); await page.keyboard.up('Space');
  naturalEnd = await ws();
  const dsEnd = await cs();
  console.log('  log', JSON.stringify(dsEnd.log), 'handback', JSON.stringify(dsEnd.handback));
  check(during.fired === before.fired && during.reload === before.reload && during.jump === before.jump && during.step === before.step && during.switched === before.switched,
    `during the scenes: fired ${during.fired - before.fired}, reloads ${during.reload - before.reload}, jumps ${during.jump - before.jump}, footsteps ${during.step - before.step}, switches ${during.switched - before.switched}`);
  check(afterHold.fired === during.fired && afterHold.jump === during.jump, `held fire / SPACE across the hand-back: fired ${afterHold.fired - during.fired}, jumps ${afterHold.jump - during.jump}`);
  for (const [name, list] of [['dev_meet', samples], ['dev_seated', s2]]) {
    for (const s of list) {
      if (!s) { bad(`${name}: no pose sample`); continue; }
      const dp = Math.hypot(s.cam.eye[0] - s.want.eye[0], s.cam.eye[1] - s.want.eye[1], s.cam.eye[2] - s.want.eye[2]);
      const dy = angD(s.cam.yaw, s.want.yaw), dpi = angD(s.cam.pitch, s.want.pitch), df = Math.abs(s.cam.fov - s.want.fov);
      check(dp <= 0.02 && dy <= 1 && dpi <= 1 && df <= 1, `${name} t ${s.t.toFixed(2)} shot ${s.want.shot}: camera = table (Δ ${(dp * 100).toFixed(1)} cm, yaw ${dy.toFixed(2)}°, pitch ${dpi.toFixed(2)}°, fov ${df.toFixed(2)})`);
    }
  }
  const meetLog = dsEnd.log.find((l) => l.id === 'dev_meet'), seatLog = dsEnd.log.find((l) => l.id === 'dev_seated');
  const dur = await ev(() => ({ m: window.__cutdev.shots('dev_meet'), s: window.__cutdev.shots('dev_seated') }));
  check(meetLog?.result === 'done' && Math.abs(meetLog.t - dur.m.total) <= 0.5 && dur.m.total <= 13 + 1.6, `dev_meet done in ${meetLog?.t.toFixed(2)} s (declared ${dur.m.total.toFixed(2)}, ≤ 14.6 incl. black)`);
  check(seatLog?.result === 'done' && Math.abs(seatLog.t - dur.s.total) <= 0.5 && dur.s.total <= 30, `dev_seated done in ${seatLog?.t.toFixed(2)} s (declared ${dur.s.total.toFixed(2)}, ≤ 30)`);
  check(dur.s.dYawDeg <= 1, `Δyaw(last shot, place) ${dur.s.dYawDeg.toFixed(3)}° ≤ 1°`);
  const e = naturalEnd;
  check(nearV(e.pos, [L.PLACE.x, L.PLACE.y, L.PLACE.z], 0.01) && angD(e.yaw, L.PLACE_YAW) < 0.06 && angD(e.pitch, L.PLACE_PITCH) < 0.06,
    `placed at ${e.pos} yaw ${e.yaw} pitch ${e.pitch} (want ${[L.PLACE.x, L.PLACE.y, L.PLACE.z]} ${L.PLACE_YAW.toFixed(3)} ${L.PLACE_PITCH})`);
  check(e.state === 'playing' && e.controls && e.cinematic === null && e.safe && e.stowed && Math.abs(e.fov - 72) < 0.05,
    `control back: state ${e.state}, controls ${e.controls}, cinematic ${e.cinematic}, safe ${e.safe}, stowed ${e.stowed}, fov ${e.fov}`);
  check(e.keys.includes('dev_badge') && e.door.locked && e.actor?.attn === 'auto' && e.latch, `end state: key ${e.keys}, door locked ${e.door.locked}, actor attention ${e.actor?.attn}, latch armed ${e.latch}`);
  check(e.clips.shotgun[0] === 6 || e.clips.shotgun[1] === 0, `clip topped up (shotgun ${e.clips.shotgun})`);
  const hd = dsEnd.handback;
  check(!!hd && hd.dPos < 0.004 && hd.dDeg < 0.2, `view continuity at the hand-back: Δpos ${hd ? (hd.dPos * 1000).toFixed(2) : '?'} mm, Δrot ${hd ? hd.dDeg.toFixed(3) : '?'}°`);
  for (const s of [...samples, ...s2]) if (s) console.log(`  sample ${s.id} t ${s.t.toFixed(2)} cam ${s.cam.eye.map((v) => v.toFixed(3))} want ${s.want.eye.map((v) => v.toFixed(3))}`);
}

if (want('skip')) {
  console.log('══════════ skip: second view ══════════');
  await ev(() => window.__cutdev.reset());
  await placeOnGallery(Math.PI);
  await wait(300);
  await zeroCnt();
  await ev(() => { window.__cutdev.arm('meet'); window.__game.player.debug.move(1, 0, false); });
  await page.waitForFunction(() => window.__cutdev.cut.active, null, { timeout: 15000 });
  await ev(() => window.__game.player.debug.move(0, 0, false));
  check((await cs()).canSkip, 'seen → skippable');
  await waitScene('dev_meet', 1.0);
  // a short tap does not skip
  await page.keyboard.down('Space'); await wait(250); await page.keyboard.up('Space');
  check((await cs()).id === 'dev_meet', 'a 0.25 s tap does not skip');
  await page.keyboard.down('Space');
  await wait(350);
  await shot('skip_ring');
  await page.waitForFunction(() => window.__cutdev.cut.id === 'dev_seated', null, { timeout: 5000 }).catch(() => {});
  const mid = await cs();
  check(mid.id === 'dev_seated' && mid.log.at(-1)?.result === 'skipped', `meet skipped → seated plays (${mid.id}, ${mid.log.at(-1)?.result})`);
  await wait(900); // still held: the seated scene must not skip on the same hold
  check((await cs()).id === 'dev_seated', 'the same SPACE hold does not also skip the next scene');
  await page.keyboard.up('Space'); await wait(150);
  await page.keyboard.down('Space');
  await page.waitForFunction(() => !window.__cutdev.cut.busy, null, { timeout: 5000 }).catch(() => {});
  const sk = await cs();
  check(sk.log.at(-1)?.id === 'dev_seated' && sk.log.at(-1)?.result === 'skipped', `seated skipped (${sk.log.at(-1)?.id} ${sk.log.at(-1)?.result})`);
  const yBefore = (await st()).pos[1];
  await wait(500);
  const c = await cnt();
  const stA = await st();
  await page.keyboard.up('Space');
  check(c.jump === 0 && Math.abs(stA.pos[1] - yBefore) < 0.01, `skip key consumed: jumps ${c.jump}, y ${yBefore} → ${stA.pos[1]}`);
  check(c.skipMax >= 0.99, `skip ring driven to ${c.skipMax.toFixed(2)}`);
  const s = await ws();
  if (naturalEnd) {
    const keys = ['pos', 'yaw', 'pitch', 'state', 'controls', 'safe', 'stowed', 'cinematic', 'weapon', 'clips', 'keys', 'door', 'badge', 'latch'];
    const diff = keys.filter((k) => JSON.stringify(s[k]) !== JSON.stringify(naturalEnd[k]));
    // fov: the player's own camera settles to within 1e-3 of 72 (its update hysteresis), from either side
    if (Math.abs(s.fov - naturalEnd.fov) > 0.01) diff.push('fov');
    const aN = naturalEnd.actor, aS = s.actor;
    if (!aN || !aS || aN.at !== aS.at || aN.pose !== aS.pose || aN.attn !== aS.attn) diff.push('actor');
    check(diff.length === 0, `skip end state = natural end state${diff.length ? ' — differs: ' + diff.map((k) => `${k} ${JSON.stringify(s[k])} vs ${JSON.stringify(naturalEnd[k])}`).join('; ') : ''}`);
  }
  if (FRAMES) { await wait(700); await shot('skip_after_fadein'); }
}

// ───────────────────────────────────────────────────────────── awkward entries
if (want('enter')) {
  console.log('══════════ enter: awkward conditions ══════════');
  await boot();
  const L = await ev(() => JSON.parse(JSON.stringify(window.__cutdev.layout)));
  const resetAll = async () => {
    await page.waitForFunction(() => !window.__cutdev.cut.busy, null, { timeout: 40000 });
    await ev(() => { window.__cutdev.reset(); window.__cutdev.clearSeen(); });
    await wait(200);
  };
  // play the standalone meet (control at the end) and wait it out
  const playMeet1 = () => ev(() => { window.__r = null; window.__cutdev.meet({ chain: false }).then((r) => { window.__r = r; }); });
  const awaitDone = () => page.waitForFunction(() => window.__r !== null, null, { timeout: 40000 }).then(() => ev(() => window.__r));

  // backwards through the trigger
  await placeOnGallery(0); // facing −z: walking backwards goes +z into the room
  await wait(200); await zeroCnt();
  await ev(() => { window.__cutdev.arm('meet1'); window.__game.player.debug.move(-1, 0, false); });
  await page.waitForFunction(() => window.__cutdev.cut.active, null, { timeout: 15000 });
  await ev(() => window.__game.player.debug.move(0, 0, false));
  let s = await st();
  check(s.cinematic && Math.hypot(s.vel[0], s.vel[2]) < 0.01, `backwards: taken, velocity ${s.vel}`);
  await page.waitForFunction(() => !window.__cutdev.cut.busy, null, { timeout: 30000 });
  let w = await ws();
  check(w.state === 'playing' && w.controls && nearV(w.pos, [L.PLACE.x, L.PLACE.y, L.PLACE.z], 0.01) && !w.safe && !w.stowed, `backwards: ends placed with control, weapon live (safe ${w.safe}, stowed ${w.stowed})`);

  // mid-jump
  await resetAll();
  await ev(() => { const g = window.__game, V = g.camera.position.constructor; g.player.teleport(new V(0, 4.8, -7.5), Math.PI, 0); });
  await wait(300);
  await ev(() => window.__game.player.debug.jump());
  await page.waitForFunction(() => !window.__game.player.debug.state().grounded && window.__game.player.position.y > 5.2, null, { timeout: 3000 }).catch(() => {});
  const air = await st();
  await zeroCnt();
  await playMeet1();
  s = await st();
  check(!air.grounded && s.cinematic && Math.abs(s.pos[1] - 4.8) < 0.03, `mid-jump (y ${air.pos[1]}): feet snapped to the floor (y ${s.pos[1]})`);
  let r = await awaitDone();
  let c = await cnt();
  check(r[0] === 'done' && c.land === 0 && c.jump === 0, `mid-jump: scene ${r}, no landing (${c.land}) / jump (${c.jump}) events`);

  // mid-reload (pistol, then shotgun)
  for (const wpn of ['pistol', 'shotgun']) {
    await resetAll();
    await ev((wpn) => { const g = window.__game, V = g.camera.position.constructor; g.player.teleport(new V(0, 4.8, -7.5), Math.PI, 0); g.player.debug.switchTo(wpn); }, wpn);
    await wait(700);
    for (let i = 0; i < 2; i++) { await ev(() => window.__game.player.debug.fire()); await wait(350); }
    await ev(() => window.__game.player.debug.reload());
    await wait(250);
    const pre = await st();
    await zeroCnt();
    await playMeet1();
    s = await st();
    check(pre.weapons[wpn].reloading && !s.weapons[wpn].reloading, `mid-reload (${wpn}): reload cancelled (${pre.weapons[wpn].reloading} → ${s.weapons[wpn].reloading})`);
    r = await awaitDone();
    await wait(500);
    c = await cnt();
    check(r[0] === 'done' && c.fired === 0 && c.reload === 0, `mid-reload (${wpn}): no shot (${c.fired}) / reload (${c.reload}) leaks out of the scene`);
  }

  // mid palm-scan
  await resetAll();
  await ev(() => {
    const g = window.__game, V = g.camera.position.constructor;
    g.player.teleport(new V(0, 4.8, -7.5), Math.PI, 0);
    window.__palm = null;
    setTimeout(() => {
      g.player.palm({ position: new V(0, 5.9, -6.9), normal: new V(0, 0, -1), up: new V(0, 1, 0) }, 3).then((x) => { window.__palm = x; });
    }, 300);
  });
  await wait(900);
  const pp = await ev(() => window.__game.player.palmProgress);
  await playMeet1();
  await wait(100);
  const palmRes = await ev(() => ({ r: window.__palm, p: window.__game.player.palmProgress }));
  check(pp > 0 && palmRes.r === 'cancelled' && palmRes.p === -1, `mid palm-scan (progress ${pp.toFixed(2)}): cancelled (${palmRes.r})`);
  r = await awaitDone();
  w = await ws();
  check(r[0] === 'done' && !w.stowed && w.controls, `mid palm-scan: scene done, weapon free after (stowed ${w.stowed})`);

  // a note open
  await resetAll();
  await ev(() => { window.__game.ui.showNote('DEV NOTE', 'A note left open as the scene starts.'); });
  await wait(300);
  const noteBefore = await ev(() => window.__game.ui.noteOpen);
  await playMeet1();
  const noteAfter = await ev(() => window.__game.ui.noteOpen);
  check(noteBefore && !noteAfter && (await cs()).active, `note open: closed at the start (${noteBefore} → ${noteAfter}), scene plays`);
  await awaitDone();

  // paused: deferred until play resumes
  await resetAll();
  await ev(() => window.__game.setState('paused'));
  await playMeet1();
  await wait(600);
  const pend = await cs();
  check(!pend.active && pend.pending === 'dev_meet', `paused: start deferred (active ${pend.active}, pending ${pend.pending})`);
  await ev(() => window.__game.setState('playing'));
  await wait(150);
  check((await cs()).active, 'paused: starts on unpause');
  await awaitDone();

  // fire held into the scene (no shot leaks in or out)
  await resetAll();
  await ev(() => { const g = window.__game, V = g.camera.position.constructor; g.player.teleport(new V(0, 4.8, -7.5), Math.PI, 0); });
  await wait(300);
  await zeroCnt();
  await page.mouse.down();
  await wait(120);
  const firstShot = (await cnt()).fired;
  await playMeet1();
  await wait(1500);
  const inScene = (await cnt()).fired;
  r = await awaitDone();
  await wait(500);
  const out = (await cnt()).fired;
  await page.mouse.up();
  check(inScene === firstShot && out === firstShot, `fire held: ${firstShot} shot before, ${inScene - firstShot} during, ${out - inScene} after the hand-back`);

  // dying: refused
  await resetAll();
  await ev(() => { window.__game.player.damage(1000); });
  await wait(100);
  await playMeet1();
  r = await awaitDone();
  check(r[0] === 'refused' && !(await cs()).active, `dying: refused (${r})`);
}

// ───────────────────────────────────────────────────────────── safe state
if (want('safe')) {
  console.log('══════════ safe state ══════════');
  await boot();
  const L = await ev(() => JSON.parse(JSON.stringify(window.__cutdev.layout)));
  await ev(() => window.__cutdev.safeZone());
  await wait(800);
  await zeroCnt();
  let s = await st();
  const wpn0 = s.weapon;
  check(s.safe && s.stowed && s.lower >= 0.29, `safe: weapon lowered (lower ${s.lower})`);
  await shot('safe_view');
  // pressed + held fire, reload, switch, wheel
  for (let i = 0; i < 8; i++) { await page.mouse.down(); await wait(40); await page.mouse.up(); await ev(() => window.__game.player.debug.fire()); await wait(40); }
  await page.mouse.down(); await wait(600); await page.mouse.up();
  await page.keyboard.press('KeyR'); await page.keyboard.press('Digit1'); await page.keyboard.press('Digit2'); await page.mouse.wheel(0, 120);
  await wait(400);
  let c = await cnt();
  s = await st();
  check(c.fired === 0 && c.reload === 0 && c.switched === 0 && s.weapon === wpn0, `safe: fired ${c.fired}, reloads ${c.reload}, switches ${c.switched}, weapon ${s.weapon}`);
  // look + move
  const y0 = s.yaw, p0 = s.pos;
  await ev(() => { window.__mdx = 30; }); await wait(250); await ev(() => { window.__mdx = 0; });
  await page.keyboard.down('KeyD'); await wait(400); await page.keyboard.up('KeyD');
  s = await st();
  check(angD(s.yaw, y0) > 2 && Math.hypot(s.pos[0] - p0[0], s.pos[2] - p0[2]) > 0.2, `safe: looks (Δyaw ${angD(s.yaw, y0).toFixed(1)}°) and moves (${Math.hypot(s.pos[0] - p0[0], s.pos[2] - p0[2]).toFixed(2)} m)`);
  // stand in the doorway for a while, holding fire (softlock (f) analogue)
  await ev(() => { const g = window.__game, V = g.camera.position.constructor; g.player.teleport(new V(0, 4.8, -9.6), 0, 0); });
  await page.mouse.down(); await wait(2500); await page.mouse.up();
  c = await cnt();
  check(c.fired === 0 && (await st()).stowed, `safe: in the doorway holding fire 2.5 s → ${c.fired} shots, still stowed`);
  // the latch ends it: firing every frame across the transition — no shot before the weapon is up
  await ev((L) => {
    const g = window.__game, V = g.camera.position.constructor;
    const f = new V(L.LATCH.x - 0.2, 4.8, L.LATCH.z + 0.9), dx = L.LATCH.x - f.x, dy = L.LATCH.y - (f.y + 1.65), dz = L.LATCH.z - f.z;
    g.player.teleport(f, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  }, L);
  await wait(500);
  const foc = (await st()).focus;
  check(foc === 'dev_latch', `safe: the latch can be focused (${foc})`);
  await zeroCnt();
  const tE = await ev(() => performance.now());
  let hammering = true;
  const hammerP = (async () => { while (hammering) { await page.mouse.down(); await wait(16); await page.mouse.up(); await wait(16); } })();
  await wait(200);
  await page.keyboard.press('KeyE');
  const tUp = await ev(() => new Promise((res) => { const t0 = performance.now(); const f = () => { const s = window.__game.player.debug.state(); if (s.lower <= 0.001 || performance.now() - t0 > 2000) res({ dt: (performance.now() - t0) / 1000, lower: s.lower, safe: s.safe }); else requestAnimationFrame(f); }; f(); }));
  await wait(600);
  hammering = false; await hammerP;
  c = await cnt();
  const early = c.firedList.filter((f) => f.safe || f.lower > 0.05);
  check(!tUp.safe && tUp.dt <= 0.5, `latch: safe off, weapon up (lower ${tUp.lower}) in ${tUp.dt.toFixed(2)} s`);
  check(early.length === 0 && c.fired > 0, `latch transition under fire every frame: ${early.length} shot(s) before the weapon was up, ${c.fired} after (fire works again)`);
  void tE;
  // safe ON under fire every frame
  await zeroCnt();
  hammering = true;
  const hammer2 = (async () => { while (hammering) { await page.mouse.down(); await wait(16); await page.mouse.up(); await wait(16); } })();
  await wait(400);
  const tOn = await ev(() => { window.__game.player.setSafe(true); return performance.now(); });
  await wait(800);
  hammering = false; await hammer2;
  c = await cnt();
  const late = c.firedList.filter((f) => f.t > tOn);
  check(late.length === 0, `setSafe(true) under fire every frame: ${late.length} shot(s) after the call (${c.fired} before)`);
}

// ───────────────────────────────────────────────────────────── levels 1–2
if (want('levels')) {
  console.log('══════════ levels 1–2 unaffected ══════════');
  for (const lv of [1, 2]) {
    const n0 = pageErrors.length;
    await boot(`/?level=${lv}&autostart=1&nostory=1&noenemies=1&give=all`);
    await zeroCnt();
    await ev(() => { const d = window.__game.player.debug; d.move(1, 0, false); });
    await wait(800);
    await ev(() => { const d = window.__game.player.debug; d.move(0, 0, false); d.fire(); });
    await wait(500);
    const c = await cnt();
    const s = await st();
    const api = await ev(() => ({ cin: typeof window.__game.player.cinematic, safe: window.__game.player.safe }));
    check(pageErrors.length === n0 && c.fired === 1 && c.step > 0 && s.cinematic === null && !s.safe && api.cin === 'function',
      `level ${lv}: boots, walks (${c.step} steps), fires (${c.fired}), not cinematic / safe, no page error`);
  }
}

await browser.close();
if (pageErrors.length) bad(`${pageErrors.length} page error(s)`);
console.log(problems.length ? `\ncheck:cutscene FAILED (${problems.length})` : '\ncheck:cutscene OK');
process.exit(problems.length ? 1 : 0);
