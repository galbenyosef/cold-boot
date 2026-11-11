/**
 * Audio harness (dev/audio.html). Modes via ?mode=
 *   sounds (default) — render every SoundDef through the same offline path, stats + spectrograms.
 *                      &filter=regex  &w=320&h=90
 *   music            — offline render of the generative score through every state transition.
 *   choir            — offline render of CHOIR lines.
 *   live             — real AudioContext: full createAudio() with a fake ctx, scripted scenario,
 *                      master bus captured and analysed over time.
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

(async () => {
  try {
    if (mode === 'music') await modeMusic();
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
