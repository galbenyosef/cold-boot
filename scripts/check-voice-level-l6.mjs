// Level 6 speech MEASURED at the listener (stage 3d §8.14, S12; task IA-6 — the ST-a / ST-b / W9 additions of
// docs/plans/deferred-final.md). Called by `check-voice-level.mjs --level 6` (or directly):
//   node scripts/check-voice-level-l6.mjs [--url http://127.0.0.1:4353] [--choice stop|command] [--json f] [--no-fail]
//        [--no-asr] [--wav <file>]
// Static build. Exit 1 on any failure. Same tap and measures as check-voice-level.mjs (voice bus + master, 10 ms mean
// squares; LEVEL = speech RMS vs the reference CHOIR PA line said in the ear; SYNC = speech onset − the line's cue −
// the fx chain's lead, |Δ| ≤ 0.12 s). Level 6's lines and listeners:
//
//   ST-a  l6_kes_start (2-D radio) SYNC; l6_unit_tube from ~3 m (the tube panel); l6_choir_he at l6_kes_he_3's cut
//         (− 0.05 s); l6_aas_1 at 0.8 m from the hanging handset, its second ring from 3 m; l6_aas_2 HELD (2-D phone
//         band); l6_aas_3 to its cut. fx `phone` is EXEMPT from the ≤ 4 m person rule (a telephone earpiece: band-
//         limited and quiet by design) — it is judged by the ASR pass instead.
//   ST-b  E1 / E2 (the ending's radio lines) SYNC from `mk6_end_stand`; the loader's PA (fx pa, at the trolley's PA horn
//         `mk6_horn`) from the dock under it, the dock 15 m off, the east gallery (~25 m), the cage and 30 m — audible;
//         UNIT at `frame6.shearPoint` from 1–2 m (l6_unit_shear_pin); soldier barks (fx throat) at 15 / 30 m in tun6_a;
//         the sequenced radio cues l6_kes_dark = cut + 1.2, l6_kes_pool_1 = reveal + 0.6, l6_choir_pool_* = hostile +
//         0.4 (lineLog cue) and their speech onset.
//   W9    SYNC for every timed line (the game skips each take's `lead`); the ASR pass of l6_aas_2 THROUGH the phone band:
//         the rendered voice bus is recorded while it plays, resampled to 24 kHz and scored by the voice tool's
//         Parakeet (tools/voice, `Engine.score`) against the spoken text — the same gate `npm run voice:check` uses.
//
// Limits decided here (IA-6, the plan gives none): PA (a device) ≥ −12 dB vs the reference up to 26 m and ≥ −16 dB at
// 30 m ("audible"); soldier barks (a person shouting) ≥ −10 dB at 15 m and ≥ −16 dB at 30 m; UNIT at 1–2 m ≥ −3 dB.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, parseArgs } from './lib/check-common.mjs';

const args = parseArgs();
const base = (args.url ?? process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const CHOICE = args.choice ?? 'stop';
const NOFAIL = !!args['no-fail'];
const problems = [];
const bad = (m) => { problems.push(m); console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);
const check = (cond, m) => (cond ? ok(m) : bad(m));
const NEAR = 4, FAR = 10, FAR_DB = -5, NEAR_TOL = 0.5, SYNC_MAX = 0.12;
const REF_ID = 'l3_choir_pa_residents';
const LIM = { pa: [[26, -12], [31, -16]], throat: [[16, -10], [31, -16]], unit: [[2.2, -3]] };

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log(`  [pageerror] ${e.message}`); });
page.on('console', (m) => { if (m.type() === 'error' || /\[audio\] voice/.test(m.text())) console.log(`  [console.${m.type()}] ${m.text().slice(0, 200)}`); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const until = async (fn, arg, ms = 60000) => { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch { return false; } };

// the tap (as check-voice-level.mjs) + a raw recorder on the voice bus (the ASR pass)
await page.addInitScript(() => {
  const W = (window.__vtap = { frames: [], offset: null, installed: false, err: null, rec: [], recOn: false, recT0: null });
  const code = `class CbTap extends AudioWorkletProcessor {
    constructor() { super(); this.N = Math.round(sampleRate * 0.01); this.n = 0; this.a = 0; this.b = 0; this.buf = []; this.rec = false; this.rb = [];
      this.port.onmessage = (e) => { this.rec = !!e.data; if (!this.rec && this.rb.length) { this.port.postMessage({ pcm: this.rb }); this.rb = []; } }; }
    process(inputs) {
      const A = inputs[0] || [], B = inputs[1] || [];
      const len = (A[0] && A[0].length) || (B[0] && B[0].length) || 128;
      if (this.rec && A[0]) { const m = new Float32Array(len); for (let i = 0; i < len; i++) { let s = 0; for (const ch of A) s += ch[i]; m[i] = s / A.length; } this.rb.push(currentTime, m); if (this.rb.length >= 200) { this.port.postMessage({ pcm: this.rb }); this.rb = []; } }
      for (let i = 0; i < len; i++) {
        let ea = 0, eb = 0;
        for (const ch of A) ea += ch[i] * ch[i];
        for (const ch of B) eb += ch[i] * ch[i];
        this.a += ea / 2; this.b += eb / 2;
        if (++this.n >= this.N) { this.buf.push(currentTime + (i + 1) / sampleRate, this.a / this.n, this.b / this.n); this.n = 0; this.a = 0; this.b = 0; }
      }
      if (this.buf.length >= 60) { this.port.postMessage(this.buf); this.buf = []; }
      return true;
    }
  }
  registerProcessor('cb-tap6', CbTap);`;
  const tryInstall = async () => {
    const eng = window.__game?.audio?.debug?.engine;
    if (!eng || W.installed) return !!W.installed;
    W.installed = 'pending';
    try {
      const c = eng.ctx;
      await c.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
      const node = new AudioWorkletNode(c, 'cb-tap6', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
      eng.buses.voice.connect(node, 0, 0);
      eng.master.connect(node, 0, 1);
      const z = c.createGain(); z.gain.value = 0; node.connect(z); z.connect(c.destination);
      node.port.onmessage = (e) => {
        if (Array.isArray(e.data)) { for (const v of e.data) W.frames.push(v); return; }
        if (e.data?.pcm) for (let i = 0; i < e.data.pcm.length; i += 2) { if (W.recT0 === null) W.recT0 = e.data.pcm[i]; for (const s of e.data.pcm[i + 1]) W.rec.push(s); }
      };
      W.node = node; W.rate = c.sampleRate;
      W.record = (on) => node.port.postMessage(!!on);
      W.installed = true;
    } catch (e) { W.err = String(e); W.installed = false; }
    return W.installed;
  };
  const iv = setInterval(() => { void tryInstall().then((x) => { if (x === true) clearInterval(iv); }); }, 50);
  setInterval(() => {
    const c = window.__game?.audio?.debug?.engine?.ctx;
    if (!c || c.state !== 'running') return;
    const ts = c.getOutputTimestamp?.();
    if (ts && ts.performanceTime > 0) W.offset = ts.performanceTime - ts.contextTime * 1000;
  }, 500);
});

const boot = async (query) => {
  for (let i = 0; ; i++) { try { await page.goto(`${base}/${query}`); break; } catch (e) { if (i >= 2) throw e; await wait(700); } }
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
};
const clearAll = () => ev(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('coldboot.')) localStorage.removeItem(k); });
const tp = (p, yawDeg = 0, pitchDeg = 0) => ev(([p, yaw, pitch]) => { const g = window.__game; const V = g.player.position.constructor; g.player.teleport(new V(p[0], p[1], p[2]), yaw * Math.PI / 180, pitch * Math.PI / 180); }, [p, yawDeg, pitchDeg]);
const mk = (id) => ev((id) => { const o = window.__game.level.object(id); if (!o) return null; const v = o.getWorldPosition(new o.position.constructor()); return [v.x, v.y, v.z]; }, id);
const faceYaw = (from, to) => Math.atan2(-(to[0] - from[0]), -(to[2] - from[2])) * 180 / Math.PI;
const beat = (id, ms = 60000) => until((id) => window.__game.story.debugState.beats.includes(id), id, ms);
const said = (id, ms = 30000) => until((id) => window.__game.story.lineLog.some((l) => l.said === id), id, ms);
const ended = (id, ms = 30000) => until((id) => window.__game.story.lineLog.some((l) => l.said === id && typeof l.end === 'number'), id, ms);
const fire = (n) => ev((n) => { try { return window.__game.story.fire(n); } catch (e) { return 'ERR ' + e.message; } }, n);
const use = (id) => ev((id) => { const g = window.__game; const i = g.interactables.get(id); if (!i) return 'missing'; if (!i.enabled) return 'disabled'; if (g.interactables.allowedAt && !g.interactables.allowedAt(i, g.player.position)) return 'refused'; g.interactables.use(i); return 'ok'; }, id);
/** A free standing point (feet) `d` m from `p` on the floor at `fy`, inside a room interior, preferring `dir` (deg yaw). */
const near = (p, d, fy, dirs = [0, 90, 180, 270, 45, 135, 225, 315]) => ev(([p, d, fy, dirs]) => {
  const g = window.__game; const V = g.player.position.constructor;
  for (const a of dirs) {
    const r = a * Math.PI / 180, x = p[0] + Math.sin(r) * d, z = p[2] + Math.cos(r) * d;
    const rm = g.level.rooms.find((q) => x > q.bounds.min.x + 0.3 && x < q.bounds.max.x - 0.3 && z > q.bounds.min.z + 0.3 && z < q.bounds.max.z - 0.3 && fy >= q.bounds.min.y - 0.5 && fy <= q.bounds.max.y);
    if (!rm) continue;
    const hit = g.physics.raycastSolid?.(new V(x, fy + 1.0, z), new V(0, -1, 0), 1.6);
    if (!hit || Math.abs(hit.point.y - fy) > 0.35) continue;
    const head = g.physics.raycastSolid?.(new V(x, hit.point.y + 0.3, z), new V(0, 1, 0), 1.6);
    if (head) continue;
    return [x, hit.point.y, z];
  }
  return null;
}, [p, d, fy, dirs]);
/** A direct positional line (the audio path only; no story): said at `src`, heard at the player. */
const sayAt = (id, src) => ev(async ([id, src]) => { const g = window.__game; const V = g.player.position.constructor; const h = g.audio.say(id, src ? { position: new V(...src) } : {}); await h.done; }, [id, src]);

// ───────────────────────────────────────────────────────────── run
console.log(`══════════ level 6 (choice ${CHOICE}) ══════════`);
const q = `?level=6&autostart=1&god=1&noenemies=1&torch=inf&choice=${CHOICE}`;
await boot(q); await clearAll(); await boot(q);
await ev(() => window.__game.audio.preloadVoice(['l6_', 'l5_sol_', 'l3_choir_pa_residents']));
const expect = [];   // [id, what] the run must have measured

// 1. arrival (ST-a): l6_kes_start 2-D (SYNC), l6_unit_tube ~3 m from the tube panel
check(await said('l6_kes_start', 20000), 'l6_kes_start said');
{
  const panel = await mk('mk6_tube_panel'), me = await ev(() => window.__game.player.position.toArray());
  ok(`listener ${Math.hypot(panel[0] - me[0], panel[2] - me[2]).toFixed(1)} m from mk6_tube_panel at the tube`);
}
check(await said('l6_unit_tube', 8000), 'l6_unit_tube said');
expect.push(['l6_kes_start', 'sync'], ['l6_unit_tube', 'level']);
await wait(3500);

// 2. the reference in the ear, then the device / bark distances (audio path, no story lines running)
await ended('l6_kes_start_2', 1);   // (not needed: the start lines may still run — the ref waits for the channel below)
await until(() => !window.__game.story.lineLog.some((l) => typeof l.dur === 'number' && l.end === null), null, 15000);
await sayAt(REF_ID, null); await wait(400);
const horn = (await mk('mk6_horn')) ?? [-52, -2.0, -176];
const paSpots = [
  ['dock under the trolley', [-52, -19.2, -184.5]], ['dock 15 m off', [-66, -19.2, -184.5]],
  ['east gallery', await mk('mk6_boss_safe') ?? [-30, -12, -166]], ['the cage', [-52, -16, -167]], ['dock west (30 m)', [-72.5, -19.2, -186]],
];
for (const [what, at] of paSpots) {
  await tp(at, faceYaw(at, horn)); await wait(350);
  const d = await ev(([h]) => window.__game.player.eye.distanceTo(new (window.__game.player.position.constructor)(...h)), [horn]);
  ok(`PA from ${what}: ${d.toFixed(1)} m`);
  await sayAt('l6_unit_loader_1', horn); await wait(300);
}
// soldier barks at 15 / 30 m (fx throat) down tun6_a
for (const d of [15, 30]) {
  await tp([0, 0, -20], 180); await wait(300);
  await sayAt('l6_sol_frame_' + CHOICE, [0, 1.6, -20 - d]); await wait(300);
}
expect.push(['l6_unit_loader_1', 'pa'], ['l6_sol_frame_' + CHOICE, 'throat']);

// 3. the head-end (ST-a): kes_he_1 … _3 radio, CHOIR at _he_3's cut (the head-end thread waits for the tube's latch)
check(!!(await fire('latch')), 'fire latch');
await wait(1500);
check(!!(await fire('he')), 'fire he');
const he = await ev(() => { const t = (window.__game.__triggers ?? []).find((x) => x.id === 't6_he'); return t ? [(t.x0 + t.x1) / 2, t.y0 ?? 0, t.z0 + (t.z1 - t.z0) * 0.9] : null; });
if (he) await tp(he, 180);
check(await said('l6_kes_he_1', 15000), 'l6_kes_he_1 said');
check(await said(`l6_choir_he_${CHOICE}`, 45000), `l6_choir_he_${CHOICE} said`);
await ended(`l6_choir_he_${CHOICE}`, 20000);
expect.push(['l6_kes_he_3', 'sync'], [`l6_choir_he_${CHOICE}`, 'sync']);

// 4. the handset (ST-a): ring at 0.8 m, the second ring at 3 m, answer → aas_2 held (2-D) + ASR, aas_3 to its cut
const hs = await mk('mk6_handset');
const p08 = await near(hs, 0.8, 0, [270, 225, 315, 180, 0]);
if (p08) await tp(p08, faceYaw(p08, hs));
check(!!(await fire('handset')), 'fire handset (the howler)');
check(await said('l6_aas_1', 8000), 'l6_aas_1 (first ring) said');
await ended('l6_aas_1', 15000);
const p3 = await near(hs, 3.0, 0, [270, 225, 315]);
if (p3) await tp(p3, faceYaw(p3, hs));
check(await until(() => window.__game.story.lineLog.filter((l) => l.said === 'l6_aas_1').length >= 2, null, 30000), 'l6_aas_1 (second ring, 3 m) said');
await ended('l6_aas_1', 15000);
if (p08) await tp(p08, faceYaw(p08, hs));
await wait(300);
await ev(() => window.__vtap.record?.(true));
check((await use('he6_phone')) === 'ok', 'answer the handset (he6_phone)');
check(await said('l6_aas_2', 6000), 'l6_aas_2 said (held)');
await ended('l6_aas_2', 20000);
await ev(() => window.__vtap.record?.(false));
await wait(400);
check(await ended('l6_aas_3', 30000), 'l6_aas_3 ran to its cut');
expect.push(['l6_aas_1', 'phone'], ['l6_aas_2', 'phone'], ['l6_aas_3', 'phone']);
await wait(2000);

// 5. the vault → the shaft → the pool: reveal (+0.6 kes_pool_1), hostile (+0.4 choir_pool), the UNIT at the shear
for (const n of ['manual', 'bj', 'pull', 'shaft']) check(!!(await fire(n)), `fire ${n}`);
await wait(1500);
const rv = await mk('mk6_reveal');
if (rv) await tp(rv, 90, -10);
await wait(500);
{ const r = await fire('reveal'); check(!!r || await beat('l6_reveal', 3000), `the reveal (fire ${r}; or by its trigger at mk6_reveal)`); }
check(await said('l6_kes_pool_1', 15000), 'l6_kes_pool_1 said');
check(!!(await fire('hostile')), 'fire hostile');
check(await said(`l6_choir_pool_${CHOICE}`, 20000), `l6_choir_pool_${CHOICE} said`);
expect.push(['l6_kes_pool_1', 'sync'], [`l6_choir_pool_${CHOICE}`, 'sync']);
await wait(6000);
// the UNIT at frame6.shearPoint from 1.5 m inside the cage: the pump before the pin
const sp = await ev(() => { const o = window.__game.level.object('frame6'); const p = o?.userData?.shearPoint; return p ? [p.x, p.y, p.z] : null; }) ?? await mk('mk6_lever');
const cage = await ev(() => { const t = (window.__game.__triggers ?? []).find((x) => x.id === 't6_cage'); return t ? [t.x0, t.x1, t.z0, t.z1] : null; });
let ps = null;
for (const d of [1.5, 1.2, 1.8]) {
  ps = await near(sp, d, -16, [0, 315, 45, 270, 90, 180]);
  if (ps && cage && ps[0] > cage[0] + 0.3 && ps[0] < cage[1] - 0.3 && ps[2] > cage[2] + 0.3 && ps[2] < cage[3] - 0.3) break;
  ps = null;
}
if (ps) {
  await tp(ps, faceYaw(ps, sp)); await wait(400);
  ok(`listener ${Math.hypot(sp[0] - ps[0], sp[1] - ps[1] - 1.65, sp[2] - ps[2]).toFixed(1)} m from the shear point`);
  check((await use('frame6_pump')) === 'ok', 'frame6_pump pressed with the pin in');
  check(await said('l6_unit_shear_pin', 5000), 'l6_unit_shear_pin said');
  expect.push(['l6_unit_shear_pin', 'unit']);
} else bad('no stand point 1–2 m from frame6.shearPoint inside t6_cage');
await wait(3000);
for (const n of ['pin', 'pump']) check(!!(await fire(n)), `fire ${n}`);
await wait(4000);
check(!!(await fire('fire')), 'fire the shear');
check(await said('l6_kes_dark', 15000), 'l6_kes_dark said');
expect.push(['l6_kes_dark', 'sync']);
await wait(5000);

// 6. the ending (ST-b): E1 / E2 from mk6_end_stand (the cutscene puts the camera there)
for (const n of ['pod', 'quiet']) await fire(n);
await until(() => window.__game.story.debugState.beats.includes('l6_quiet'), null, 30000);
await wait(4000);
const es = await mk('mk6_end_stand');
if (es) await tp(es, 180);
await wait(500);
check(!!(await fire('console')) || (await use('console6')) === 'ok', 'the console (E1)');
check(await until(() => !!window.__game.story.debugState.ending?.started, null, 15000), 'the ending started');
check(await said(`l6_choir_last_${CHOICE}`, 90000), `l6_choir_last_${CHOICE} said`);
await ended(`l6_choir_last_${CHOICE}`, 30000);
await wait(1500);
const endingIds = (await ev(() => window.__game.story.lineLog.filter((l) => /^l6_(kes_end|sunde_end|reyes_end|choir_last)/.test(l.said ?? '')).map((l) => l.said)));
for (const id of endingIds) expect.push([id, 'sync']);

const data = await ev(() => ({
  frames: window.__vtap.frames, offset: window.__vtap.offset, installed: window.__vtap.installed, err: window.__vtap.err,
  trace: window.__game.audio.debug.voice.trace, log: window.__game.story.lineLog, rate: window.__vtap.rate,
  recN: window.__vtap.rec.length, recT0: window.__vtap.recT0,
}));
const pcm = await ev(() => Array.from(window.__vtap.rec));
await browser.close();
check(data.installed === true && data.frames.length > 300, `tap on the voice bus + master (${data.frames.length / 3} frames${data.err ? ', ' + data.err : ''})`);

// frames → per-line measures (as check-voice-level.mjs)
const F = data.frames, NF = F.length / 3;
const T = (i) => F[3 * i], Vv = (i) => Math.sqrt(F[3 * i + 1]), M = (i) => Math.sqrt(F[3 * i + 2]);
const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
function frameRange(t0, t1) { let lo = 0, hi = NF; while (lo < hi) { const m = (lo + hi) >> 1; if (T(m) < t0) lo = m + 1; else hi = m; } const out = []; for (let i = lo; i < NF && T(i) <= t1; i++) out.push(i); return out; }
function measure(tr) {
  if (tr.startT === undefined) return null;
  const next = Math.min(...data.trace.filter((o) => o !== tr && o.startT !== undefined && o.startT > tr.startT + 0.05).map((o) => o.startT));
  const idx = frameRange(tr.startT, Math.min(tr.startT + tr.dur + 0.15, next));
  if (idx.length < 5) return null;
  const v = idx.map(Vv), m = idx.map(M);
  const p95 = [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.95)];
  let s = 0, sm = 0, k = 0;
  for (let j = 0; j < v.length; j++) if (v[j] > 0.25 * p95) { s += v[j] * v[j]; sm += m[j] * m[j]; k++; }
  const after = tr.startT + Math.max(0, (tr.fxLead ?? 0) - 0.02);
  const on = idx.find((i, j) => T(i) >= after && v[j] > 0.1 * p95 && v.slice(j, j + 5).filter((x) => x > 0.1 * p95).length >= 3 && Math.max(...v.slice(j, j + 20)) > 0.3 * p95);
  return { rms: db(Math.sqrt(s / k)), master: db(Math.sqrt(sm / k)), onsetT: on !== undefined ? T(on) - 0.005 : null };
}
const speakerOf = (id) => { const m = /^l\d_([a-z]+)_/.exec(id); return m ? m[1] : '?'; };
const rows = [];
for (const tr of data.trace) {
  const m = measure(tr);
  const lg = data.log.filter((l) => l.said === tr.id && l.sp !== undefined && Math.abs(l.sp - tr.askP) < 250).slice(-1)[0];
  // the cue on the perf clock: the line's start (`sp`, perf) less (start − cue) on the script clock
  // (a sequenced line asked while the channel was still closing logs no `cue`: its start IS its cue — the beat offset
  //  itself is judged by play:l6; here the start → speech onset)
  const cueP = lg && lg.sp !== undefined ? lg.sp - (lg.t - (typeof lg.cue === 'number' ? lg.cue : lg.t)) * 1000 : undefined;
  rows.push({ ...tr, ...(m ?? {}), cue: lg?.cue, cueP, sp: lg?.sp, speaker: speakerOf(tr.id) });
}
const ref = rows.find((r) => r.id === REF_ID && r.rms !== undefined);
const refDb = ref?.rms ?? null;
check(refDb !== null, `reference ${REF_ID} measured (${refDb?.toFixed(1)} dB)`);
const limitFor = (r) => {
  const kind = /^pa/.test(r.fx) ? 'pa' : /^throat/.test(r.fx) ? 'throat' : /^unit/.test(r.fx) ? 'unit' : null;
  if (kind && LIM[kind]) { const e = LIM[kind].find(([d]) => (r.dist ?? 0) <= d); return e ? e[1] : null; }
  if (/^phone/.test(r.fx) || /^radio/.test(r.fx)) return null;   // phone: exempt (ASR); radio: 2-D, the mix's own level
  if (r.speaker === 'reyes' || !r.positional || r.dist <= NEAR) return -NEAR_TOL;
  if (r.dist <= 13) return r.dist >= FAR ? FAR_DB : -NEAR_TOL + (FAR_DB + NEAR_TOL) * (r.dist - NEAR) / (FAR - NEAR);
  return null;
};
console.log('\n  LEVEL (voice bus, speech RMS; Δ = vs reference)');
console.log('  id                          fx       3D  dist  occl  dB     Δref  limit  master');
for (const r of rows) {
  if (r.rms === undefined) { console.log(`  ${r.id.padEnd(28)} ${String(r.fx).padEnd(8)} — ${r.skip ?? 'not measured'}`); continue; }
  const d = refDb !== null ? r.rms - refDb : null, limit = r.id === REF_ID ? null : limitFor(r);
  const pass = limit === null || d === null || d >= limit;
  r.delta = d; r.limit = limit;
  console.log(`  ${r.id.padEnd(28)} ${String(r.fx).padEnd(8)} ${r.positional ? 'y' : '-'}  ${r.dist !== undefined ? r.dist.toFixed(1).padStart(5) : '    -'}  ${r.occluded ? 'OCC ' : '    '} ${r.rms.toFixed(1).padStart(6)}  ${d !== null ? (d >= 0 ? '+' : '') + d.toFixed(1) : '  -'}  ${limit !== null ? limit.toFixed(1).padStart(5) : '    -'}  ${r.master.toFixed(1)}${pass ? '' : '   << FAIL'}`);
  if (!pass) bad(`${r.id}: ${d.toFixed(1)} dB vs the reference (limit ${limit.toFixed(1)}; ${r.dist !== undefined ? r.dist.toFixed(1) + ' m' : 'in the ear'}${r.occluded ? ', occluded' : ''})`);
}
console.log('\n  SYNC (s): cue → say (wall), say → buffer, cue → speech onset (rendered, − the fx lead)');
console.log('  id                          cue→say  say→buf  cue→onset');
for (const r of rows) {
  if (r.cueP === undefined || r.startP === undefined) continue;
  const a = (r.askP - r.cueP) / 1000, b = (r.startP - r.askP) / 1000;
  const on = r.onsetT !== null && r.onsetT !== undefined ? a + (r.onsetT - r.askT) - (r.fxLead ?? 0) : null;
  r.sync = on;
  const pass = on !== null && Math.abs(on) <= SYNC_MAX;
  console.log(`  ${r.id.padEnd(28)} ${a.toFixed(3).padStart(7)}  ${b.toFixed(3).padStart(7)}  ${on !== null ? on.toFixed(3).padStart(8) : '       ?'}${pass ? '' : '   << FAIL'}`);
  if (!pass) bad(`${r.id}: speech ${on === null ? '?' : on.toFixed(3)} s after its cue (limit ${SYNC_MAX})`);
}
// the sequenced radio cues (the story's lineLog: cue vs the beat)
{
  const L = data.log, firstT = (id) => L.find((l) => l.said === id);
  const tt = (await Promise.resolve(null));
  void tt;
  const k = firstT('l6_kes_pool_1'), c = firstT(`l6_choir_pool_${CHOICE}`), dk = firstT('l6_kes_dark');
  for (const [l, what] of [[k, 'reveal + 0.6'], [c, 'hostile + 0.4'], [dk, 'cut + 1.2']]) if (l) ok(`${l.said} cue ${l.cue ?? '—'} start ${l.t} (${what}; the beat offset itself is play:l6's check)`);
}
// what must have been measured
for (const [id, what] of expect) {
  const r = rows.find((x) => x.id === id && x.startT !== undefined);
  if (!r) { bad(`${id}: not played / not traced (${what})`); continue; }
  if (what === 'sync' && r.sync === undefined) bad(`${id}: no SYNC measured (no lineLog entry matched its trace)`);
}
// the ending lines from mk6_end_stand: 2-D radio, never occluded
for (const r of rows.filter((x) => /^l6_(kes_end|sunde_end)/.test(x.id))) check(!r.positional || !r.occluded, `${r.id}: radio not occluded at the console`);

// ASR of l6_aas_2 through the phone band (S12)
if (!args['no-asr']) {
  const S = 24000, src = data.rate ?? 48000;
  if (pcm.length < src * 1.0) bad(`ASR: the l6_aas_2 recording is ${(pcm.length / src).toFixed(2)} s (recorder failed?)`);
  else {
    const dir = args.wav ? dirname(args.wav) : 'shots/l6/voice';
    mkdirSync(dir, { recursive: true });
    const raw = join(dir, 'l6_aas_2.f32'), wav = args.wav ?? join(dir, 'l6_aas_2_phone.wav');
    writeFileSync(raw, Buffer.from(new Float32Array(pcm).buffer));
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(src), '-ac', '1', '-i', raw, '-ar', String(S), '-ac', '1', wav]);
    const lines = JSON.parse((await import('node:fs')).readFileSync('voice/lines.l6.json', 'utf8'));
    const ln = (Array.isArray(lines) ? lines : lines.lines).find((l) => l.id === 'l6_aas_2');
    const text = ln?.spoken ?? ln?.text ?? '';
    const py = ['tools/voice/.venv/bin/python', '/Users/ar/Code/thegame/tools/voice/.venv/bin/python'].find((p) => existsSync(p));
    if (!py) bad('ASR: no tools/voice/.venv (uv sync in tools/voice)');
    else {
      const code = `import sys, json, subprocess, numpy as np\nsys.path.insert(0, 'tools/voice')\nfrom coldvoice.engine import Engine\nfrom coldvoice import audio as A\nw = A.read_wav(sys.argv[1])\nr = Engine(lambda m: None).score(w, sys.argv[2])\nprint(json.dumps(r))`;
      try {
        const out = execFileSync(py, ['-c', code, wav, text], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 }).trim().split('\n').pop();
        const r = JSON.parse(out);
        check(r.ok, `ASR l6_aas_2 through the phone band: score ${r.score} ratio ${r.ratio} (missing ${JSON.stringify(r.missing)}) — heard "${r.transcript}"`);
        console.log(`       text: "${text}"\n       wav:  ${wav}`);
      } catch (e) { bad(`ASR run failed: ${String(e.stderr ?? e.message).slice(-300)}`); }
    }
  }
}

if (args.json) { mkdirSync(dirname(args.json), { recursive: true }); writeFileSync(args.json, JSON.stringify({ level: 6, choice: CHOICE, refDb, rows: rows.map(({ lis, src, ...r }) => r) }, null, 1)); }
const failed = problems.length;
console.log(failed ? `\ncheck:voice-level --level 6 FAILED (${failed})` : '\ncheck:voice-level --level 6 OK');
process.exit(failed && !NOFAIL ? 1 : 0);
