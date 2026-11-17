// Voice level + speech sync, MEASURED at the listener (REVISION 4 → Voices; task: Halvorsen too quiet, C1 late).
//   node scripts/check-voice-level.mjs [--url http://127.0.0.1:5173] [--choice stop|command] [--mode cold|from2|level2]
//        [--level 4] (= --mode level4)
//        [--json shots/checks/voice-level.json] [--no-fail] [--evict]
// On a static build (vite build + vite preview). Exit 1 on any failure.
//
// A tap (AudioWorklet) sits on the voice bus (the direct sound of every voice line, after its 3D panner / occlusion
// filter, before the room reverb and the master compressor) and on the master output; every 10 ms it records the
// mean square of both. Each `say` leaves a trace in the VoiceBank (`audio.debug.voice.trace`: asked / started, the
// listener and source positions, occluded, the distance gain); each queued line a log entry in the dialogue channel
// (`story.lineLog`: when it was queued = the cue / gesture, when it started). From those:
//
//   LEVEL  speech RMS of every line on the voice bus (frames above 0.25 × the line's p95, like the voice tool's
//          loudness gate), in dB relative to the REFERENCE = CHOIR's PA line (`l3_choir_pa_residents`, in the ear).
//          A line by a person in the scene (speaker not choir / unit) must arrive at least as loud as the reference
//          when it is ≤ 4 m away, no more than 5 dB below at ≥ 10 m (linear in between), no more than 8 dB below
//          through a door (fx `door`); a line said during a cutscene, or a clean line within 6 m, must not be occluded.
//   SYNC   for every line queued by a scene cue in C1 and C2: speech onset in the rendered output (first frame above
//          0.1 × the line's p95, followed by a word, on the voice bus; AudioContext time) − the cue (when the line was
//          queued: the gesture starts on that frame; cue → say on the wall clock + say → onset on the context clock) − the fx chain's designed lead (a radio
//          squelch; voicefx `fxLead`). |Δ| ≤ 0.12 s.
//
// Modes: cold   — `?level=3`, straight out of the lift (teleports, no dawdling: the shortest preload window), C1, C2,
//                 the office, his door, the PA. Level + sync.
//        from2  — the chain: level 2 ends (store + reload, no ?level=), level 3 starts from the carry; C1 + C2 sync.
//        level4 — level 4 (stage 3b §8.12): Sunde's video log from the PI desk (2 m) and the office door (6 m), a unit
//                 panel line from 3 m, the gallery announcer from both ends of the gallery. Level + sync.
//        level2 — level 2's lines through the same audio path (its gestures run in the dialogue's onStart, on the
//                 frame the line starts): the takes with a lead-in and a few without, said after the level's
//                 preload; speech onset − say ≤ 0.12 s.
// --evict (cold / from2): drop every processed line and fetched file just before C1 triggers — the scenes must wait for
// their lines (`linesReady`) and still start each line with its cue. The table is printed; --json writes it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { launch, parseArgs } from './lib/check-common.mjs';

const args = parseArgs();
const base = (args.url ?? process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const MODE = args.mode ?? (String(args.level ?? '') === '4' ? 'level4' : 'cold');
const CHOICE = args.choice ?? 'stop';
const NOFAIL = !!args['no-fail'];
const problems = [];
const bad = (m) => { problems.push(m); console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);
const check = (cond, m) => (cond ? ok(m) : bad(m));

// limits (dB relative to the reference; seconds)
const NEAR = 4, FAR = 10, FAR_DB = -5, DOOR_DB = -8, NEAR_TOL = 0.5, SYNC_MAX = 0.12;
const DEVICE_SPEAKERS = new Set(['choir', 'unit']);
const REF_ID = 'l3_choir_pa_residents';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log(`  [pageerror] ${e.message}`); });
page.on('console', (m) => { if (m.type() === 'error' || /voice .* late|\[audio\] voice/.test(m.text())) console.log(`  [console.${m.type()}] ${m.text().slice(0, 200)}`); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const until = async (fn, arg, ms = 60000) => { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch { return false; } };

// the tap: installed on every page as soon as the game's audio exists (before the first line)
await page.addInitScript(() => {
  const W = (window.__vtap = { frames: [], offset: null, installed: false, err: null });
  const code = `class CbTap extends AudioWorkletProcessor {
    constructor() { super(); this.N = Math.round(sampleRate * 0.01); this.n = 0; this.a = 0; this.b = 0; this.buf = []; }
    process(inputs) {
      const A = inputs[0] || [], B = inputs[1] || [];
      const len = (A[0] && A[0].length) || (B[0] && B[0].length) || 128;
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
  registerProcessor('cb-tap', CbTap);`;
  const tryInstall = async () => {
    const eng = window.__game?.audio?.debug?.engine;
    if (!eng || W.installed) return !!W.installed;
    W.installed = 'pending';
    try {
      const c = eng.ctx;
      await c.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
      const node = new AudioWorkletNode(c, 'cb-tap', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
      eng.buses.voice.connect(node, 0, 0);
      eng.master.connect(node, 0, 1);
      const z = c.createGain(); z.gain.value = 0; node.connect(z); z.connect(c.destination);
      node.port.onmessage = (e) => { for (const v of e.data) W.frames.push(v); };
      W.installed = true;
      W.node = node;
    } catch (e) { W.err = String(e); W.installed = false; }
    return W.installed;
  };
  const iv = setInterval(() => { void tryInstall().then((x) => { if (x === true) clearInterval(iv); }); }, 50);
  // ctx time → performance time (the moment that sample is heard), refreshed
  setInterval(() => {
    const c = window.__game?.audio?.debug?.engine?.ctx;
    if (!c || c.state !== 'running') return;
    const ts = c.getOutputTimestamp?.();
    if (ts && ts.performanceTime > 0) {
      W.offset = ts.performanceTime - ts.contextTime * 1000;
      (W.offsets ??= []).push([performance.now(), W.offset, c.outputLatency ?? 0, c.baseLatency ?? 0]);
    }
  }, 500);
});

const boot = async (query) => {
  for (let i = 0; ; i++) {
    try { await page.goto(`${base}/${query}`); break; } catch (e) { if (i >= 2) throw e; await wait(700); }
  }
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
};
const clearAll = () => ev(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('coldboot.')) localStorage.removeItem(k); });
const tp = (x, y, z, yawDeg = 0) => ev(([x, y, z, yaw]) => {
  const g = window.__game; const V = g.player.position.constructor;
  g.player.teleport(new V(x, y, z), yaw * Math.PI / 180, 0);
}, [x, y, z, yawDeg]);
const beat = (id, ms = 60000) => until((id) => window.__game.story.debugState.beats.includes(id), id, ms);
const said = (id, ms = 30000) => until((id) => window.__game.story.lineLog.some((l) => l.said === id), id, ms);
const use = (id) => ev((id) => { const g = window.__game; const i = g.interactables.get(id); if (!i) return 'missing'; if (!i.enabled) return 'disabled'; g.interactables.use(i); return 'ok'; }, id);
const killAll = (ms) => until(() => {
  const g = window.__game; const V = g.player.position.constructor;
  for (const e of [...g.enemies.all]) {
    if (!e.alive || e.state === 'dormant') continue;
    for (let k = 0; k < 8 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1));
  }
  return g.story.lineLog.some((l) => l.said === 'l3_choir_pa_residents');
}, null, ms);

/** Level 3 from the lift, as fast as a player can: the lock, the release, the gallery → C1 → C2. */
async function toScenes() {
  check(await beat('l3_arrive', 30000), 'l3_arrive');
  await until(() => window.__game.story.debugState.beats.includes('#lift_open'), null, 20000);
  await tp(0, 4.8, -3.5, 0);
  check(await beat('l3_lock', 20000), 'l3_lock');
  await tp(0, 4.8, -5.6, 0);
  check(await beat('l3_release', 20000), 'l3_release');
  await until(() => window.__game.level.door('d3_pressure').isOpen, null, 8000);
  if (args.evict) {
    // worst case: nothing decoded / processed / even fetched when C1 triggers (the scene must wait for its lines)
    const n = await ev(() => { const v = window.__game.audio.debug.voice; const n = v.ready.size; v.ready.clear(); v.bytes.clear(); v.cacheBytes = 0; return n; });
    ok(`evicted ${n} processed lines and every fetched file before C1`);
  }
  await tp(0, 4.8, -9.6, 90);
  check(await until(() => window.__game.story.debugState.scenes.cut?.id === 'l3_c1', null, 20000), 'C1 starts');
  check(await until(() => window.__game.state === 'playing' && window.__game.story.debugState.beats.includes('l3_office'), null, 120000), 'C2 ends, control in the office');
}
/** The office (his talk lines), out through his door (the lock line), his door tried (the door line), the PA. */
async function afterScenes() {
  await wait(1500);
  check((await use('note3_memo')) === 'ok', 'read the memo');
  check(await said('l3_halv_memo', 15000), 'l3_halv_memo said');
  await ev(() => window.__game.ui.closeNote?.());
  check(await said('l3_halv_go_1', 40000), 'l3_halv_go_1 said');
  await wait(3200);
  await tp(-30, 4.8, -18.3, 0);
  check(await beat('l3_leave', 15000), 'l3_leave');
  check(await said('l3_halv_lock', 8000), 'l3_halv_lock said');
  await wait(2600);
  await tp(-30, 4.8, -18.6, 180);
  await ev(() => window.__game.events.emit('door:denied', { id: 'd3_office', position: window.__game.level.door('d3_office').position }));
  check(await said('l3_halv_door', 5000), 'l3_halv_door said');
  await wait(2500);
  check(await killAll(40000), `${REF_ID} said (the reference)`);
  await wait(6000);
}

// ───────────────────────────────────────────────────────────── run
let note = '';
if (MODE === 'cold') {
  console.log(`══════════ cold ?level=3 (choice ${CHOICE}) ══════════`);
  await boot(`?level=3&autostart=1&god=1&choice=${CHOICE}&handoff=1`); await clearAll();
  await boot(`?level=3&autostart=1&god=1&choice=${CHOICE}&handoff=1`);
  await toScenes();
  await afterScenes();
} else if (MODE === 'from2') {
  console.log('══════════ the chain: level 2 → level 3 (store + reload) ══════════');
  await boot('?level=2&autostart=1&god=1'); await clearAll();
  await boot('?level=2&autostart=1&god=1');
  await wait(800);
  await ev(() => { window.__game.debug.autostart = false; });
  await ev(() => { void window.__game.story.ending('shutdown', 'spared', 30); });
  await until(() => /TIME:/i.test(document.querySelector('.cb')?.innerText ?? ''), 15000);
  await wait(2500);
  const nav = page.waitForNavigation({ timeout: 20000 }).then(() => true, () => false);
  await page.keyboard.press('Space');
  check(await nav, 'reloaded into the next level');
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
  const lv = await ev(() => window.__game.levelId);
  check(lv === 3 && !/level=/.test(await ev(() => location.search)), `level ${lv} from the stored level (${await ev(() => location.search)})`);
  await ev(() => { window.__game.debug.god = true; });
  await toScenes();
  note = 'from level 2';
} else if (MODE === 'level2') {
  // Level 2 has no clocked scene: its gestures run in the dialogue's onStart, on the frame the line starts (the say
  // is in the same call). What can still part them is the audio path: readiness and the take's lead-in. Every
  // level-2 take with a lead-in (and a few without) is said through the shared VoiceBank after the level's preload.
  console.log('══════════ level 2: the shared audio path ══════════');
  await boot('?level=2&autostart=1&god=1&nostory=1&noenemies=1'); await clearAll();
  await boot('?level=2&autostart=1&god=1&nostory=1&noenemies=1');
  await ev(() => window.__game.audio.preloadVoice(['l2_']));
  const ids = await ev(() => {
    const all = [...window.__game.audio.debug.voice.table.values()].filter((e) => e.level === 'l2' && e.generated);
    const withLead = all.filter((e) => e.lead > 0).sort((a, b) => b.lead - a.lead);
    return [...withLead.slice(0, 18), ...all.filter((e) => !e.lead).slice(0, 6)].map((e) => e.id);
  });
  for (const id of ids) {
    await ev(async (id) => { const h = window.__game.audio.say(id); await h.done; }, id);
    await wait(350);
  }
  note = `${ids.length} level-2 lines`;
}

if (MODE === 'level4') {
  // stage 3b §8.12 / D30: level 4's scene speech at the listener — Sunde's video log from the PI desk (2 m) and the office
  // door (6 m), the gallery announcer from both ends of the gallery, a unit panel line from 3 m; the reference CHOIR line
  // (level 3's PA line, said directly in the ear) for the level.
  console.log(`══════════ level 4 (choice ${CHOICE}) ══════════`);
  const q = `?level=4&autostart=1&god=1&noenemies=1&choice=${CHOICE}`;
  await boot(q); await clearAll(); await boot(q);
  await ev(() => window.__game.audio.preloadVoice(['l4_', 'l3_choir_pa_residents']));
  await wait(1500);
  await ev(async (id) => { const h = window.__game.audio.say(id); await h.done; }, REF_ID);
  await wait(500);
  check(await beat('l4_decon_done', 20000), 'l4_decon_done');
  await ev(() => window.__game.story.fire('lights_out'));      // phase D without the ambush (noenemies)
  await wait(4000);
  // the video log: 2 m from the screen, then from the office door (6 m)
  await tp(8.0, 4.8, -14.4, 0);
  await wait(300);
  check((await use('log4_video')) === 'ok', 'Play log');
  check(await said('l4_sunde_4', 30000), 'l4_sunde_4 started (2 m)');
  await tp(11.5, 4.8, -17.5, 35);
  await wait(300);
  check(await until(() => window.__game.story.lineLog.some((l) => l.said === 'l4_sunde_9' && typeof l.end === 'number'), null, 60000), 'the log ran to its cut (6 m from l4_sunde_5)');
  // a unit panel line from 3 m (the tube door, D)
  await tp(32, 0, -64, 180);
  await wait(500);
  await ev(() => { const g = window.__game; const d = g.level.doors.find((x) => x.id === 'd4_tube_n'); g.events.emit('door:denied', { id: 'd4_tube_n', position: d.position }); });
  check(await said('l4_unit_tube_denied', 5000), 'l4_unit_tube_denied (3 m)');
  // the gallery: west end, then east end
  await tp(-9.2, 4.8, -45.5, 180);
  check(await said('l4_unit_theatre_2', 60000), 'l4_unit_theatre_2 (west end)');
  await tp(9.2, 4.8, -45.5, 180);
  check(await said('l4_unit_theatre_3', 30000), 'l4_unit_theatre_3 (east end)');
  check(await said('l4_unit_theatre_1', 45000), 'l4_unit_theatre_1');
  await wait(3000);
  note = 'level 4';
}

const data = await ev(() => ({
  frames: window.__vtap.frames, offset: window.__vtap.offset, offsets: window.__vtap.offsets ?? [], installed: window.__vtap.installed, err: window.__vtap.err,
  trace: window.__game.audio.debug.voice.trace, log: window.__game.story.lineLog,
  times: window.__game.story.debugState?.scenes?.times ?? null, rate: window.__game.audio.debug.engine.ctx.sampleRate,
  panning: window.__game.audio.debug.engine.usePanningModel,
}));
await browser.close();
check(data.installed === true && data.frames.length > 300, `tap on the voice bus + master (${data.frames.length / 3} frames${data.err ? ', ' + data.err : ''})`);
check(data.offset !== null, 'ctx → performance time mapping');

// frames → per-line measures
const F = data.frames, NF = F.length / 3;
const T = (i) => F[3 * i], V = (i) => Math.sqrt(F[3 * i + 1]), M = (i) => Math.sqrt(F[3 * i + 2]);
const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
function frameRange(t0, t1) {
  let lo = 0, hi = NF;
  while (lo < hi) { const m = (lo + hi) >> 1; if (T(m) < t0) lo = m + 1; else hi = m; }
  const out = [];
  for (let i = lo; i < NF && T(i) <= t1; i++) out.push(i);
  return out;
}
function measure(tr) {
  if (tr.startT === undefined) return null;
  // (to the line's end, or to the next line's start when they overlap)
  const next = Math.min(...data.trace.filter((o) => o !== tr && o.startT !== undefined && o.startT > tr.startT + 0.05).map((o) => o.startT));
  const idx = frameRange(tr.startT, Math.min(tr.startT + tr.dur + 0.15, next));
  if (idx.length < 5) return null;
  const v = idx.map(V), m = idx.map(M);
  const p95 = [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.95)];
  let s = 0, sm = 0, k = 0;
  for (let j = 0; j < v.length; j++) if (v[j] > 0.25 * p95) { s += v[j] * v[j]; sm += m[j] * m[j]; k++; }
  // speech onset: the first frame above 0.1 × p95 (−20 dB) that starts a run (3 of the next 5 frames) and reaches
  // 0.3 × p95 within 200 ms — the same definition as the voice tool's `lead` (a breath or a click is not speech)
  // (a chain with a designed lead — a squelch, a speaker click, a tape clunk — makes its noise inside the lead: the
  // voice is looked for after it, so the click is never taken for the onset)
  const after = tr.startT + Math.max(0, (tr.fxLead ?? 0) - 0.02);
  const on = idx.find((i, j) => T(i) >= after && v[j] > 0.1 * p95 && v.slice(j, j + 5).filter((x) => x > 0.1 * p95).length >= 3 && Math.max(...v.slice(j, j + 20)) > 0.3 * p95);
  return { rms: db(Math.sqrt(s / k)), master: db(Math.sqrt(sm / k)), onsetT: on !== undefined ? T(on) - 0.005 : null };
}

const rows = [];
for (const tr of data.trace) {
  const m = measure(tr);
  // the dialogue's entry for this say (same id, started within 0.25 s before the ask)
  const lg = data.log.filter((l) => l.said === tr.id && l.sp !== undefined && Math.abs(l.sp - tr.askP) < 250).slice(-1)[0];
  const sp = String(data.log.find((l) => l.said === tr.id)?.said ?? tr.id);
  rows.push({ ...tr, ...(m ?? {}), q: lg?.q, qp: lg?.qp, sp: lg?.sp, pri: lg?.pri ?? 'over', speaker: speakerOf(sp) });
}
function speakerOf(id) { const m = /^l\d_([a-z]+)_/.exec(id); return m ? m[1] : '?'; }

const ref = rows.find((r) => r.id === REF_ID && r.rms !== undefined);
const refDb = ref?.rms ?? null;
if (MODE === 'cold' || MODE === 'level4') check(refDb !== null, `reference ${REF_ID} measured (${refDb?.toFixed(1)} dB)`);
const sceneOf = (r) => {
  if (!data.times || r.q === undefined) return null;
  const c = data.log; void c;
  return null;
};
void sceneOf;
// which lines were said inside a scene: C1/C2 by their queue time against the scene log
const inScene = (r) => /^l3_(halv_c[12]_|reyes_(phone|come)|choir_(told|quiet))/.test(r.id) || /^l4_(sunde_|unit_theatre_|unit_decon|unit_cold_ack|unit_gate$)/.test(r.id);

{
  const o = data.offsets.map((x) => x[1]);
  if (o.length) console.log(`  ctx→perf offset: ${o.length} samples, min ${Math.min(...o).toFixed(1)} max ${Math.max(...o).toFixed(1)} ms; outputLatency ${data.offsets.at(-1)[2]}, baseLatency ${data.offsets.at(-1)[3]}`);
}
console.log(`\n  panning model ${data.panning}, sample rate ${data.rate}${note ? ', ' + note : ''}`);
console.log('\n  LEVEL (voice bus, speech RMS; Δ = vs reference)');
console.log('  id                        fx      3D  dist  occl distG   dB     Δref  limit  master');
for (const r of rows) {
  if (r.rms === undefined) { console.log(`  ${r.id.padEnd(26)} ${String(r.fx).padEnd(7)} — ${r.skip ?? 'not measured'}`); continue; }
  // (a line said quieter on purpose — volume < 0.9, e.g. the murmur through the wall — is reported, not judged)
  const person = !DEVICE_SPEAKERS.has(r.speaker) && (r.vol ?? 1) >= 0.9;
  let limit = null;
  if (person && refDb !== null) {
    if (/^door/.test(r.fx)) limit = DOOR_DB;
    else if (!r.positional || r.dist <= NEAR) limit = -NEAR_TOL;
    else if (r.dist <= 13) limit = r.dist >= FAR ? FAR_DB : -NEAR_TOL + (FAR_DB + NEAR_TOL) * (r.dist - NEAR) / (FAR - NEAR);
  }
  const d = refDb !== null ? r.rms - refDb : null;
  const pass = limit === null || d >= limit;
  r.delta = d; r.limit = limit;
  console.log(`  ${r.id.padEnd(26)} ${String(r.fx).padEnd(7)} ${r.positional ? 'y' : '-'}  ${r.dist !== undefined ? r.dist.toFixed(1).padStart(5) : '    -'}  ${r.occluded ? 'OCC ' : '    '} ${r.distGain !== undefined ? r.distGain.toFixed(2) : '   -'}  ${r.rms.toFixed(1).padStart(6)}  ${d !== null ? (d >= 0 ? '+' : '') + d.toFixed(1) : '  -'}  ${limit !== null ? limit.toFixed(1).padStart(5) : '    -'}  ${r.master.toFixed(1)}${pass ? '' : '   << FAIL'}`);
  if ((MODE === 'cold' || MODE === 'level4') && limit !== null && !pass) bad(`${r.id}: ${d.toFixed(1)} dB vs the reference (limit ${limit.toFixed(1)}; dist ${r.dist?.toFixed(1) ?? 'in the ear'}${r.occluded ? ', occluded' : ''})`);
  if ((MODE === 'cold' || MODE === 'level4') && person && r.positional && r.occluded && (inScene(r) || (/^clean/.test(r.fx) && r.dist <= 6))) bad(`${r.id}: occluded (dist ${r.dist.toFixed(1)}) — a person in the same room / in a scene`);
}

console.log('\n  SYNC (s): cue → dialogue start, say → buffer start, cue → speech onset (rendered; heard = + the device latency)');
console.log('  id                        cue→say  say→buf  cue→onset   heard');
for (const r of rows) {
  if (MODE === 'level2') { r.qp = r.sp = r.askP; }   // (said directly: the ask is the dialogue start)
  if (r.qp === undefined || r.startP === undefined) continue;
  const a = (r.sp - r.qp) / 1000, b = (r.startP - r.askP) / 1000;
  // cue → the say (wall clock) + the say → the speech onset in the rendered stream (AudioContext time: the device's
  // output latency is the machine's, not the game's — a headset on Bluetooth adds 150+ ms to everything alike),
  // less the fx chain's designed lead (a radio squelch / a tape clunk IS where the line starts)
  const has = r.onsetT !== null && r.onsetT !== undefined;
  const on = has ? a + (r.onsetT - r.askT) - (r.fxLead ?? 0) : null;
  const heard = has && data.offset !== null ? (r.onsetT * 1000 + data.offset - r.qp) / 1000 - (r.fxLead ?? 0) : null;
  r.sync = on; r.heard = heard;
  const scene = MODE === 'level2' ? true : inScene(r);
  const pass = on !== null && Math.abs(on) <= SYNC_MAX;
  console.log(`  ${r.id.padEnd(26)} ${a.toFixed(3).padStart(7)}  ${b.toFixed(3).padStart(7)}  ${on !== null ? on.toFixed(3).padStart(8) : '       ?'}  ${heard !== null ? heard.toFixed(3).padStart(6) : '     ?'}${scene && !pass ? '   << FAIL' : ''}`);
  if (scene && !pass) bad(`${r.id}: speech heard ${on === null ? '?' : on.toFixed(3)} s after its cue (limit ${SYNC_MAX})`);
}
for (const r of rows) if (r.skip && r.skip !== 'silent' && (inScene(r) || MODE === 'level2')) bad(`${r.id}: not played (${r.skip})`);
if (MODE !== 'level2' && MODE !== 'level4') {
  const want = ['l3_halv_c1_1', 'l3_halv_c1_3', 'l3_halv_c2_9'];
  for (const id of want) check(rows.some((r) => r.id.startsWith(id.replace(/_1$/, '_1')) && r.startT !== undefined) || rows.some((r) => r.id === id + '_shots'), `${id} played`);
}

if (args.json) {
  mkdirSync(dirname(args.json), { recursive: true });
  writeFileSync(args.json, JSON.stringify({ mode: MODE, choice: CHOICE, refDb, rows: rows.map(({ lis, src, ...r }) => r) }, null, 1));
}
const failed = problems.length;
console.log(failed ? `\ncheck:voice-level FAILED (${failed})` : '\ncheck:voice-level OK');
process.exit(failed && !NOFAIL ? 1 : 0);
