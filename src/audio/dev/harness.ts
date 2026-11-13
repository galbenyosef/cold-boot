/**
 * Audio harness (dev/audio.html). Modes via ?mode=
 *   sounds (default) — render every SoundDef through the same offline path, stats + spectrograms.
 *                      &filter=regex  &w=320&h=90
 *   music            — offline render of the generative score through every state transition.
 *   choir            — offline render of CHOIR lines.
 *   live             — real AudioContext: full createAudio() with a fake ctx, scripted scenario,
 *                      master bus captured and analysed over time.
 *   voice            — recorded voice lines (public/voice) through the run-time fx chains, offline:
 *                      level / peak / clipping / duration per line × chain, spectrograms, click a cell to
 *                      hear it. &ids=a,b (ids or prefixes; default: a few per speaker) &fx=all|<name>
 *                      &live=1 also runs say() through a real createAudio() and checks handles/ducking.
 * Results on window.__audioReport; window.__game = { ready: true } when done.
 */
import * as THREE from 'three';
import { ALL_SOUNDS, SOUND_MAP } from '../sounds';
import { renderDef } from '../synth/render';
import { SR } from '../synth/core';
import { Music, type MusicMode } from '../music';
import { renderChoir } from '../choir';
import { makeIR } from '../impulses';
import { draw, stats, mono, type Stats } from './analyze';
import { createAudio } from '../index';
import { loadVoiceTable } from '../voice';
import { FX_NAMES, FX_SR, renderVoiceFx, speechRms } from '../voicefx';
import { createEvents } from '../../core/events';
import type { GameContext } from '../../core/types';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'sounds';
const head = document.getElementById('head')!;
const grid = document.getElementById('grid')!;
const report: Record<string, unknown> = { mode };
(window as any).__audioReport = report;

function cell(label: string, w: number, h: number, wide = false): HTMLCanvasElement {
  const d = document.createElement('div');
  d.className = 'cell' + (wide ? ' wide' : '');
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const l = document.createElement('div');
  l.className = 'lbl'; l.textContent = label;
  d.append(cv, l); grid.append(d);
  return cv;
}

function chansOf(b: AudioBuffer): Float32Array[] {
  return Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
}

async function modeSounds() {
  const filter = q.get('filter') ? new RegExp(q.get('filter')!) : null;
  const W = +(q.get('w') ?? 300), H = +(q.get('h') ?? 80);
  const defs = ALL_SOUNDS.filter((d) => !filter || filter.test(d.id));
  // timing of the load set exactly as the engine does it (concurrency 8)
  const loadDefs = ALL_SOUNDS.filter((d) => (d.when ?? 'load') === 'load');
  const t0 = performance.now();
  const loadBufs = new Map<string, AudioBuffer[]>();
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (i < loadDefs.length) { const d = loadDefs[i++]; loadBufs.set(d.id, await renderDef(d)); } }));
  const loadMs = performance.now() - t0;
  const t1 = performance.now();
  const per: Record<string, unknown> = {};
  const timings: Record<string, number> = {};
  const all = new Map<string, AudioBuffer[]>();
  for (const d of ALL_SOUNDS) {
    if (loadBufs.has(d.id)) { all.set(d.id, loadBufs.get(d.id)!); continue; }
    const ts = performance.now();
    all.set(d.id, await renderDef(d));
    timings[d.id] = Math.round(performance.now() - ts);
  }
  const restMs = performance.now() - t1;
  const warnings: string[] = [];
  for (const d of defs) {
    const bufs = all.get(d.id)!;
    const vs: Stats[] = bufs.map((b) => stats(chansOf(b), b.sampleRate));
    const s0 = vs[0];
    per[d.id] = { ...s0, variants: bufs.length, vol: d.vol ?? 0.7, when: d.when ?? 'load', loop: !!d.loop,
      peakDbAtVol: +(s0.peakDb + 20 * Math.log10(d.vol ?? 0.7)).toFixed(1), rmsDbAtVol: +(s0.rmsDb + 20 * Math.log10(d.vol ?? 0.7)).toFixed(1),
      varRms: vs.map((v) => v.rmsDb) };
    for (const v of vs) {
      if (v.nan) warnings.push(`${d.id}: NaN`);
      if (v.silent) warnings.push(`${d.id}: silent`);
      if (Math.abs(v.dc) > 0.01) warnings.push(`${d.id}: DC ${v.dc}`);
    }
    if (q.get('nodraw') !== '1') {
      const b = bufs[0];
      const cv = cell(`${d.id} ×${bufs.length} ${s0.dur}s\npk ${s0.peakDb} rms ${s0.rmsDb} atk ${s0.attackMs}ms tail ${s0.tailMs}ms\ncen ${s0.centroid}Hz lo ${(s0.bands.sub + s0.bands.low).toFixed(2)} up ${s0.bands.upmid.toFixed(2)}`, W, H);
      draw(cv, chansOf(b), b.sampleRate);
    }
  }
  const totalAudio = [...all.values()].reduce((a, bs) => a + bs.reduce((x, b) => x + b.duration, 0), 0);
  Object.assign(report, { loadMs: Math.round(loadMs), loadCount: loadDefs.length, restMs: Math.round(restMs), totalDefs: ALL_SOUNDS.length,
    totalAudioSec: +totalAudio.toFixed(1), slowest: Object.entries(timings).sort((a, b) => b[1] - a[1]).slice(0, 8), warnings, sounds: per });
  head.textContent = `load set: ${loadDefs.length} defs in ${loadMs.toFixed(0)} ms · rest ${restMs.toFixed(0)} ms · ${ALL_SOUNDS.length} defs, ${totalAudio.toFixed(1)} s audio · warnings ${warnings.length}`;
}

async function loadMusicBank(): Promise<Map<string, AudioBuffer[]>> {
  const m = new Map<string, AudioBuffer[]>();
  for (const d of ALL_SOUNDS.filter((x) => x.id.startsWith('mus_'))) m.set(d.id, await renderDef(d));
  return m;
}

async function modeMusic() {
  const bank = await loadMusicBank();
  const seq: Array<[number, MusicMode]> = (q.get('seq') ?? '0:silence,1:ambient,22:tension,44:combat,66:aftermath,84:menu,96:silence').split(',').map((p) => {
    const [t, m] = p.split(':'); return [+t, m as MusicMode];
  });
  const T = +(q.get('len') ?? 102);
  const oc = new OfflineAudioContext(2, T * SR, SR);
  const out = oc.createGain(); out.gain.value = 0.5; // music bus level as in the engine
  const plate = oc.createConvolver(); plate.buffer = makeIR('plate', SR);
  const plateOut = oc.createGain(); plateOut.gain.value = 0.6;
  out.connect(oc.destination); plate.connect(plateOut); plateOut.connect(oc.destination);
  const music = new Music(oc, out, plate, (id) => bank.get(id));
  let r = 12345; music.rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const t0 = performance.now();
  let si = 0;
  for (let t = 0; t < T; t += 0.1) {
    while (si < seq.length && seq[si][0] <= t) { music.set(seq[si][1], seq[si][0]); si++; }
    music.tick(t);
  }
  const buf = await oc.startRendering();
  const ms = performance.now() - t0;
  const ch = chansOf(buf);
  const x = mono(ch);
  // per-state stats (skip 3 s after each transition)
  const states: Record<string, unknown> = {};
  for (let k = 0; k < seq.length; k++) {
    const a = seq[k][0] + 3, b = (seq[k + 1]?.[0] ?? T);
    if (b - a < 1) continue;
    states[`${seq[k][1]}@${seq[k][0]}`] = stats(ch, SR, Math.floor(a * SR), Math.floor(b * SR));
  }
  // windowed RMS + click detector (2nd difference spikes vs local RMS)
  const win = Math.floor(SR * 0.5);
  const rms: number[] = [];
  for (let i = 0; i + win <= x.length; i += win) { let e = 0; for (let k = 0; k < win; k++) e += x[i + k] ** 2; rms.push(+(10 * Math.log10(e / win + 1e-12)).toFixed(1)); }
  const clicks: number[] = [];
  const W2 = 256;
  for (let i = W2; i + W2 < x.length; i += W2) {
    let e = 0, dmax = 0;
    for (let k = 0; k < W2; k++) { const v = x[i + k]; e += v * v; const d2 = Math.abs(x[i + k] - 2 * x[i + k - 1] + x[i + k - 2]); if (d2 > dmax) dmax = d2; }
    const r0 = Math.sqrt(e / W2);
    if (dmax > 0.05 && dmax > r0 * 3.5) clicks.push(+(i / SR).toFixed(2));
  }
  let peak = 0, nan = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) { if (!Number.isFinite(c[i])) nan++; else peak = Math.max(peak, Math.abs(c[i])); }
  Object.assign(report, { renderMs: Math.round(ms), seq, peak: +peak.toFixed(3), nan, states, rms, clicks: clicks.slice(0, 40), clickCount: clicks.length });
  const cv = cell(`music timeline ${T}s (marks = transitions)`, 1580, 260, true);
  draw(cv, ch, SR, seq.map((s) => s[0]));
  head.textContent = `music offline ${T}s rendered in ${ms.toFixed(0)} ms · peak ${peak.toFixed(3)} · clicks ${clicks.length}`;
}

async function modeChoir() {
  const lines: Array<[string, number]> = [
    ['Good morning. We are glad you are awake.', 3.5],
    ['Please remain where you are. Help is coming. We are the help.', 5],
    ['You restored the power. Thank you. Everything is awake now.', 4.5],
    ['Do not be afraid, Sam. We have room for you.', 3.2],
  ];
  const out: Record<string, unknown> = {};
  for (const [text, dur] of lines) {
    const t0 = performance.now();
    const b = await renderChoir(text, dur);
    const ms = performance.now() - t0;
    const ch = chansOf(b);
    const s = stats(ch, b.sampleRate);
    out[text] = { renderMs: Math.round(ms), ...s };
    const cv = cell(`${text}\n${dur}s → ${s.dur}s, ${ms.toFixed(0)} ms, cen ${s.centroid}`, 1580, 200, true);
    draw(cv, ch, b.sampleRate);
  }
  Object.assign(report, { lines: out });
  head.textContent = 'choir lines';
}

// ───────────────────────────────────────────── live

function fakeCtx(): GameContext {
  const events = createEvents();
  const camera = new THREE.PerspectiveCamera();
  const player = {
    position: new THREE.Vector3(0, 0, 5), eye: new THREE.Vector3(0, 1.65, 5), forward: new THREE.Vector3(0, 0, -1),
    health: 100, alive: true, weapons: { pistol: { clip: 12, clipSize: 12, reserve: 24 }, shotgun: { clip: 2, clipSize: 6, reserve: 20 } },
  };
  let room = 'med';
  const level = { roomAt: () => ({ id: room, name: room, bounds: new THREE.Box3() }), object: () => undefined, setRoomForTest: (r: string) => { room = r; } };
  const ctx = {
    events, camera, player, level, debug: { verbose: true },
    physics: { lineOfSight: (_a: THREE.Vector3, b: THREE.Vector3) => b.x < 8 }, // things at x ≥ 8 are "behind a wall"
    enemies: { activeCount: 0 }, state: 'playing',
  } as unknown as GameContext;
  return ctx;
}

async function modeLive() {
  const ctx = fakeCtx();
  const t0 = performance.now();
  const audio = await createAudio(ctx);
  const createMs = performance.now() - t0;
  await audio.unlock();
  const dbg = (audio as any).debug;
  const eng = dbg.engine;
  const ac: AudioContext = eng.ctx;
  // capture master bus
  const cap: Float32Array[] = [];
  const sp = ac.createScriptProcessor(4096, 2, 2);
  const mute = ac.createGain(); mute.gain.value = 0;
  eng.master.connect(sp); sp.connect(mute); mute.connect(ac.destination);
  let capturing = true;
  sp.onaudioprocess = (e) => { if (capturing) cap.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  const timeline: Array<{ t: number; what: string }> = [];
  // per-bus level probes (snapshot RMS every 0.5 s)
  const busLv: Record<string, number[]> = {};
  const probes: Array<[string, AnalyserNode]> = [];
  for (const name of ['sfx', 'ambience', 'music', 'voice', 'ui']) {
    const an = ac.createAnalyser(); an.fftSize = 4096;
    eng.buses[name].connect(an); probes.push([name, an]); busLv[name] = [];
  }
  { const an = ac.createAnalyser(); an.fftSize = 4096; eng.reverbIn.connect(an); probes.push(['reverbIn', an]); busLv.reverbIn = []; }
  const tmpBuf = new Float32Array(4096);
  const probeIv = setInterval(() => {
    for (const [n, an] of probes) { an.getFloatTimeDomainData(tmpBuf); let e = 0; for (const v of tmpBuf) e += v * v; busLv[n].push(+(10 * Math.log10(e / 4096 + 1e-12)).toFixed(0)); }
  }, 500);
  const mark = (what: string) => timeline.push({ t: +(ac.currentTime).toFixed(2), what });
  // main-loop stand-in
  let last = performance.now();
  const iv = setInterval(() => { const n = performance.now(); ctx.camera.updateMatrixWorld(); audio.update(Math.min(0.05, (n - last) / 1000)); last = n; }, 16);
  const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
  const tStart = ac.currentTime;
  ctx.events.emit('game:state', { state: 'playing', prev: 'menu' });
  audio.setMusic('ambient'); mark('music ambient');
  await wait(2.5);
  const v = new THREE.Vector3();
  for (let k = 0; k < 6; k++) { ctx.events.emit('player:footstep', { position: v, surface: 'metal', running: false }); await wait(0.45); }
  mark('pistol x4');
  for (let k = 0; k < 4; k++) { ctx.events.emit('weapon:fired', { weapon: 'pistol', origin: v, direction: v }); await wait(0.25); }
  ctx.events.emit('weapon:reload', { weapon: 'pistol', duration: 1.4 });
  await wait(1.6);
  mark('shotgun spam x12 + 9-pellet impacts');
  for (let k = 0; k < 12; k++) {
    ctx.events.emit('weapon:fired', { weapon: 'shotgun', origin: v, direction: v });
    for (let p = 0; p < 9; p++) ctx.events.emit('bullet:impact', { point: new THREE.Vector3(Math.random() * 4 - 2, 1, -6), normal: v, surface: 'metal' });
    await wait(0.08);
  }
  const peakVoices = eng.voiceCount;
  await wait(1.5);
  mark('room → fab, tension');
  (ctx.level as any).setRoomForTest('fab');
  audio.setMusic('tension');
  const loopA = audio.loop('husk_loop', { position: new THREE.Vector3(3, 1.4, 0) });
  const loopB = audio.loop('sentry_loop', { position: new THREE.Vector3(12, 3, 0) }); // occluded
  await wait(3);
  mark('enemy events');
  ctx.events.emit('enemy:alerted', { id: 1, type: 'husk', position: new THREE.Vector3(3, 0, 0) });
  await wait(0.8);
  ctx.events.emit('enemy:alerted', { id: 2, type: 'skitter', position: new THREE.Vector3(-3, 0, -2) });
  await wait(0.8);
  (ctx.enemies as any).activeCount = 2;
  mark('auto combat');
  await wait(6);
  ctx.events.emit('enemy:died', { id: 1, type: 'husk', position: new THREE.Vector3(3, 0, 0), group: 'g' });
  ctx.events.emit('enemy:died', { id: 2, type: 'skitter', position: new THREE.Vector3(-3, 0, -2), group: 'g' });
  (ctx.enemies as any).activeCount = 0;
  loopA.stop(0.5); loopB.stop(0.5);
  await wait(5.5);
  mark('choir voice');
  audio.choirVoice('You restored the power. Thank you. Everything is awake now.', 4.5);
  await wait(5);
  mark('pause muffle');
  ctx.events.emit('game:state', { state: 'paused', prev: 'playing' });
  await wait(1.5);
  ctx.events.emit('game:state', { state: 'playing', prev: 'paused' });
  mark('story beats');
  ctx.events.emit('story:beat', { id: 'power_restored' });
  await wait(4);
  ctx.events.emit('story:beat', { id: 'corr_blackout' });
  await wait(4);
  audio.play('this_id_does_not_exist');
  audio.setMusic('silence'); mark('silence');
  await wait(3);
  capturing = false;
  clearInterval(iv); clearInterval(probeIv);
  // analyse
  const total = cap.reduce((a, b) => a + b.length, 0);
  const x = new Float32Array(total);
  let o = 0; for (const c of cap) { x.set(c, o); o += c.length; }
  const sr = ac.sampleRate;
  const win = Math.floor(sr * 0.25);
  const rms: number[] = [], peaks: number[] = [];
  let nan = 0, clip = 0;
  for (let i = 0; i + win <= x.length; i += win) {
    let e = 0, pk = 0;
    for (let k = 0; k < win; k++) { const s = x[i + k]; if (!Number.isFinite(s)) { nan++; continue; } e += s * s; pk = Math.max(pk, Math.abs(s)); if (Math.abs(s) > 0.999) clip++; }
    rms.push(+(10 * Math.log10(e / win + 1e-12)).toFixed(1)); peaks.push(+pk.toFixed(2));
  }
  Object.assign(report, {
    createMs: Math.round(createMs), preRenderMs: Math.round(eng.preRenderMs), idleRenderMs: Math.round(eng.idleRenderMs), sampleRate: sr,
    captured: +(x.length / sr).toFixed(1), nan, clip, peakVoices, voicesAtEnd: eng.voiceCount, loopsAtEnd: eng.loops.size,
    timeline: timeline.map((m) => ({ ...m, t: +(m.t - tStart).toFixed(2) })), rms, peaks, musicModeAtEnd: dbg.musicMode, busLv,
  });
  const cv = cell('live master bus capture', 1580, 220, true);
  draw(cv, [x], sr, timeline.map((m) => m.t - tStart));
  head.textContent = `live: ${report.captured}s captured · nan ${nan} · clip ${clip} · peak voices ${peakVoices}`;
}

// ───────────────────────────────────────────── ambience (dread layer)

async function modeAmbience() {
  const ctx = fakeCtx();
  (ctx.physics as any).lineOfSight = () => true; // worst case: nothing occluded
  (ctx.level as any).setRoomForTest('quarters');
  const audio = await createAudio(ctx);
  await audio.unlock();
  const dbg = (audio as any).debug;
  const eng = dbg.engine, amb = dbg.ambience;
  const ac: AudioContext = eng.ctx;
  const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
  // peak / rms meters on the direct sfx bus and the post-duck ambience path (master)
  const meter = (node: AudioNode) => {
    const an = ac.createAnalyser(); an.fftSize = 2048; node.connect(an);
    const buf = new Float32Array(2048);
    let pk = 0, e = 0, n = 0;
    const iv = setInterval(() => { an.getFloatTimeDomainData(buf); for (const v of buf) { pk = Math.max(pk, Math.abs(v)); e += v * v; n++; } }, 20);
    return { reset() { pk = 0; e = 0; n = 0; }, get peak() { return pk; }, get rmsDb() { return +(10 * Math.log10(e / Math.max(1, n) + 1e-12)).toFixed(1); }, stop() { clearInterval(iv); } };
  };
  const sfx = meter(eng.buses.sfx), master = meter(eng.master);
  let last = performance.now();
  const iv = setInterval(() => { const n = performance.now(); ctx.camera.updateMatrixWorld(); audio.update(Math.min(0.05, (n - last) / 1000)); last = n; }, 16);
  ctx.events.emit('game:state', { state: 'playing', prev: 'menu' });
  await wait(2.5); // idle render + bed fade in
  const out: Record<string, unknown> = { room: eng.roomId, ir: eng.room.ir, bedIds: Object.keys(eng.room.bed) };
  // 1. footstep reference
  sfx.reset();
  const v = new THREE.Vector3();
  for (let k = 0; k < 6; k++) { ctx.events.emit('player:footstep', { position: v, surface: 'metal', running: false }); await wait(0.45); }
  const stepPeak = sfx.peak;
  out.footstepPeak = +stepPeak.toFixed(4);
  // 2. bed level, then a room-tone dropout
  master.reset(); await wait(1.5); out.bedRmsDb = master.rmsDb;
  amb.debugForce('drop'); await wait(0.9);
  master.reset(); await wait(1.0); out.dropRmsDb = master.rmsDb; out.dropping = amb.dropping;
  await wait(4.5); master.reset(); await wait(1.0); out.afterDropRmsDb = master.rmsDb; out.droppingAfter = amb.dropping;
  // 3. every dread event in isolation: direct-sound peak vs footstep
  const ev: Record<string, unknown> = {};
  amb.debugForce('hold'); // isolate: no generated events while measuring
  for (const id of ['far_steps', 'drag_far', 'door_far', 'breath_far', 'husk_whisper', 'pipe_tick', 'dist_knock', 'metal_groan', 'vent_scuttle', 'drip']) {
    let worst = 0;
    for (let k = 0; k < 3; k++) {
      sfx.reset();
      amb.debugSpawn(id);
      const e = amb.log[amb.log.length - 1];
      const dur = Math.min(6, (eng.buffers(id === 'door_far' ? 'door_open' : id)?.[0]?.duration ?? 2) + 0.3);
      await wait(dur);
      worst = Math.max(worst, sfx.peak);
      ev[id] = { ...(ev[id] as object), [`d${k}`]: e?.d, [`v${k}`]: e?.vol };
    }
    ev[id] = { ...(ev[id] as object), worstPeak: +worst.toFixed(4), ratio: +(worst / stepPeak).toFixed(2) };
  }
  out.events = ev;
  // 4. generator: single slot + suppression during combat
  amb.log.length = 0;
  (ctx.enemies as any).activeCount = 2; audio.setMusic('ambient');
  await wait(1.6);
  amb.debugForce('event'); await wait(1.0);
  out.firedDuringCombat = amb.log.length;
  (ctx.enemies as any).activeCount = 0;
  amb.busy = 0;
  await wait(0.5);
  // 5. auto room mapping for unknown ids
  const { presetFor, ROOMS } = await import('../impulses');
  const mapName = (id: string) => Object.entries(ROOMS).find(([, p]) => p === presetFor(id))?.[0] ?? 'DEFAULT';
  out.mapping = Object.fromEntries(['crew_quarters_b', 'pump_sump', 'corr_b', 'mystery_room', 'quarters', 'pump'].map((k) => [k, mapName(k)]));
  // 6. bed + room-local layer per room (distant events held off)
  const beds: Record<string, unknown> = {};
  for (const r of ['med', 'quarters', 'corr_a', 'fab', 'pump']) {
    (ctx.level as any).setRoomForTest(r);
    await wait(3.2);
    amb.debugForce('hold');
    master.reset(); sfx.reset(); await wait(3);
    beds[r] = { ir: eng.room.ir, masterRmsDb: master.rmsDb, masterPeak: +master.peak.toFixed(3), sfxPeak: +sfx.peak.toFixed(3) };
  }
  out.beds = beds;
  out.genLog = amb.log.slice(-5);
  out.lateRenderMs = Math.round(eng.lateRenderMs); out.idleRenderMs = Math.round(eng.idleRenderMs); out.preRenderMs = Math.round(eng.preRenderMs);
  clearInterval(iv); sfx.stop(); master.stop();
  Object.assign(report, out);
  head.textContent = 'ambience: ' + JSON.stringify(out).slice(0, 400);
}

// ───────────────────────────────────────────── voice

async function modeVoice() {
  const table = loadVoiceTable();
  const gen = [...table.values()].filter((e) => e.generated);
  const want = (q.get('ids') ?? '').split(',').filter(Boolean);
  let pick = want.length ? gen.filter((e) => want.some((w) => e.id === w || e.id.startsWith(w))) : [];
  if (!want.length) {
    const seen = new Map<string, number>();
    for (const e of gen) { const k = e.speaker + '|' + e.fx; const n = seen.get(k) ?? 0; if (n < 1) { pick.push(e); seen.set(k, n + 1); } }
  }
  const fxq = q.get('fx');
  const dec = new OfflineAudioContext(1, 1, FX_SR);
  const base = (import.meta as any).env?.BASE_URL ?? '/';
  let live: AudioContext | null = null;
  const out: Record<string, unknown> = {};
  const W = 520, H = 110;
  for (const e of pick) {
    const raws = await Promise.all(e.files.map((f) => fetch(base + f).then((r) => r.arrayBuffer())));
    const bufs = await Promise.all(raws.map((r) => dec.decodeAudioData(r)));
    const clean = bufs[0];
    const chains = fxq === 'all' ? [...FX_NAMES] : fxq ? fxq.split(',') : [e.fx];
    const res: Record<string, unknown> = { manifestDuration: e.duration, cleanDuration: +clean.duration.toFixed(3), cleanSr: clean.sampleRate,
      cleanRms: +speechRms([clean.getChannelData(0)]).toFixed(4) };
    for (const fx of chains) {
      const t0 = performance.now();
      const b = await renderVoiceFx(fx, bufs, e.id);
      const ms = performance.now() - t0;
      const ch = chansOf(b);
      const st = stats(ch, b.sampleRate);
      const r = { renderMs: Math.round(ms), dur: st.dur, peak: st.peak, peakDb: st.peakDb, rmsDb: st.rmsDb, speechRms: +speechRms(ch).toFixed(4),
        clip: st.clip, nan: st.nan, channels: b.numberOfChannels, centroid: st.centroid, bands: st.bands };
      res[fx] = r;
      if (q.get('dump')) {
        // mono int16 PCM, base64 — for an external ASR check of the processed audio
        const m = mono(ch); const pcm = new Int16Array(m.length);
        for (let i = 0; i < m.length; i++) pcm[i] = Math.max(-32767, Math.min(32767, Math.round(m[i] * 32767)));
        const u8 = new Uint8Array(pcm.buffer); let bin = '';
        for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        ((report.dump ??= {}) as Record<string, string>)[`${e.id}|${fx}`] = btoa(bin);
      }
      const label = e.text.length > 64 ? e.text.slice(0, 62) + '…' : e.text;
      const cv = cell(`${e.id} [${e.speaker}] → ${fx}\n${st.dur}s pk ${st.peakDb}dB rms ${st.rmsDb}dB clip ${st.clip} ${r.renderMs}ms\n${label}`, W, H);
      draw(cv, ch, b.sampleRate);
      cv.style.cursor = 'pointer';
      cv.onclick = () => {
        live ??= new AudioContext();
        void live.resume();
        const s2 = live.createBufferSource(); s2.buffer = b; s2.connect(live.destination); s2.start();
      };
    }
    out[e.id] = res;
  }
  report.lines = out;
  // say() through the real audio system
  if (q.get('live')) {
    const ctx = fakeCtx();
    const audio = await createAudio(ctx);
    await audio.unlock();
    const dbg = (audio as any).debug;
    const eng = dbg.engine;
    const ids = pick.slice(0, 3).map((e) => e.id);
    const t0 = performance.now();
    await audio.preloadVoice(ids);
    const preloadMs = performance.now() - t0;
    const results: unknown[] = [];
    for (const id of ids) {
      const t1 = performance.now();
      const h = audio.say(id, id.includes('unit') ? { position: new THREE.Vector3(2, 1.5, 0) } : undefined);
      await new Promise((r) => setTimeout(r, 300));
      const duck = +eng.duck.music.gain.value.toFixed(3);
      await h.done;
      results.push({ id, duration: h.duration, wallSeconds: +((performance.now() - t1) / 1000).toFixed(2), musicDuckDuring: duck });
    }
    const unknown = audio.say('no_such_line');
    const t2 = performance.now();
    await unknown.done;
    const h2 = audio.say(ids[0]);
    setTimeout(() => h2.stop(0.1), 200);
    const t3 = performance.now();
    await h2.done;
    report.live = { preloadMs: Math.round(preloadMs), results, unknown: { duration: unknown.duration, wall: +((performance.now() - t2) / 1000).toFixed(2) },
      stopWall: +((performance.now() - t3) / 1000).toFixed(2), duckAfter: +eng.duck.music.gain.value.toFixed(3) };
  }
  head.textContent = `voice: ${pick.length} lines (click a spectrogram to listen)`;
}

(async () => {
  try {
    if (mode === 'voice') await modeVoice();
    else if (mode === 'ambience') await modeAmbience();
    else if (mode === 'music') await modeMusic();
    else if (mode === 'choir') await modeChoir();
    else if (mode === 'live') await modeLive();
    else await modeSounds();
  } catch (e) {
    report.error = String((e as Error)?.stack ?? e);
    head.textContent = 'ERROR ' + report.error;
  }
  (window as any).__game = { ready: true };
})();

void SOUND_MAP;
