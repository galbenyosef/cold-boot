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
 *   hab              — level 3 (stage 3a): every habitat room preset warm and cold (IR, wet, bed, events), each IR
 *                      auditioned with `door_chime` (click a cell). Plain `mode=sounds&filter=^(pdoor_|purge_|radio_|…)`
 *                      auditions the new level-3 ids: CLICK ANY SPECTROGRAM to play it (loops repeat; click again to stop).
 *   l4               — level 4 (stage 3b): every room preset normal and after lights-out, auditioned with `carbine_fire`
 *                      + its `carbine_tail` (click a cell); &live=1 runs the real system on level 4 and records which ids the
 *                      game events trigger (carbine burst + tail, reloads, armour, body hits, floors, lights-out mood).
 *                      The new ids themselves: `mode=sounds&filter=<rev9 ids>` (see SOUNDS.md → Level 4).
 *   l5               — level 5 (stage 3c): room presets normal / lights-out with `tray_crash`; &live=1 event wiring + the
 *                      play log; &voice=1 the radio / radio:1 / throat chains and their levels (see modeL5).
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
      cv.style.cursor = 'pointer';
      cv.onclick = () => audition(b, !!d.loop, (d.vol ?? 0.7));
    }
  }
  // offline-render hook for scripts (scripts: node → page): PCM of one variant as base64 Float32 per channel
  (window as any).__pcm = (id: string, variant = 0) => {
    const b = all.get(id)?.[variant];
    if (!b) return null;
    const chs: string[] = [];
    for (let c = 0; c < b.numberOfChannels; c++) {
      const u8 = new Uint8Array(b.getChannelData(c).slice().buffer);
      let bin = '';
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      chs.push(btoa(bin));
    }
    return { sr: b.sampleRate, channels: chs, variants: all.get(id)!.length, loop: !!SOUND_MAP.get(id)?.loop, vol: SOUND_MAP.get(id)?.vol ?? 0.7, dur: SOUND_MAP.get(id)?.dur };
  };
  const totalAudio = [...all.values()].reduce((a, bs) => a + bs.reduce((x, b) => x + b.duration, 0), 0);
  Object.assign(report, { loadMs: Math.round(loadMs), loadCount: loadDefs.length, restMs: Math.round(restMs), totalDefs: ALL_SOUNDS.length,
    totalAudioSec: +totalAudio.toFixed(1), slowest: Object.entries(timings).sort((a, b) => b[1] - a[1]).slice(0, 8), warnings, sounds: per });
  head.textContent = `load set: ${loadDefs.length} defs in ${loadMs.toFixed(0)} ms · rest ${restMs.toFixed(0)} ms · ${ALL_SOUNDS.length} defs, ${totalAudio.toFixed(1)} s audio · warnings ${warnings.length}`;
}

let auditionCtx: AudioContext | null = null;
let auditionSrc: AudioBufferSourceNode | null = null;
/** Click-to-listen: plays a rendered buffer at its def volume (loops repeat until the next click). */
function audition(b: AudioBuffer, loop: boolean, vol: number): void {
  auditionCtx ??= new AudioContext();
  void auditionCtx.resume();
  try { auditionSrc?.stop(); } catch { /* already stopped */ }
  const src = auditionCtx.createBufferSource();
  src.buffer = b; src.loop = loop;
  const g = auditionCtx.createGain(); g.gain.value = vol;
  src.connect(g); g.connect(auditionCtx.destination);
  src.start();
  auditionSrc = src;
}

async function modeHab() {
  const { ROOMS_L3, presetFor } = await import('../impulses');
  const chime = (await renderDef(SOUND_MAP.get('door_chime')!))[0];
  const rows: Record<string, unknown> = {};
  const W = 340, H = 80;
  for (const id of Object.keys(ROOMS_L3)) {
    for (const cold of [false, true]) {
      const p = presetFor(id, 3, cold);
      // the room's reverb tail applied to a chime (offline): dry + IR × wet
      const oc = new OfflineAudioContext(1, Math.ceil((chime.duration + 3) * SR), SR);
      const src = oc.createBufferSource(); src.buffer = chime;
      const dry = oc.createGain(); dry.gain.value = 0.35;
      const conv = oc.createConvolver(); conv.buffer = makeIR(p.ir, SR);
      const wet = oc.createGain(); wet.gain.value = p.wet;
      src.connect(dry); dry.connect(oc.destination); src.connect(conv); conv.connect(wet); wet.connect(oc.destination);
      src.start();
      const r = await oc.startRendering();
      const st = stats(chansOf(r), SR);
      rows[`${id}${cold ? ':cold' : ''}`] = { ir: p.ir, wet: p.wet, bed: p.bed, quiet: !!p.quiet, events: Object.keys(p.events), local: (p.local ?? []).map((e) => e.id), tailMs: st.tailMs };
      const cv = cell(`${id}${cold ? ' COLD' : ' warm'}  ir=${p.ir} wet=${p.wet}${p.quiet ? ' quiet' : ''}\nbed ${JSON.stringify(p.bed)}\ntail ${st.tailMs}ms`, W, H);
      draw(cv, chansOf(r), SR);
      cv.style.cursor = 'pointer';
      cv.onclick = () => audition(r, false, 1);
    }
  }
  Object.assign(report, { rooms: rows });
  if (q.get('live')) {
    // the real system on level 3: room presets, the mood switch, the room-based footsteps, the glass that holds
    const ctx = fakeCtx() as unknown as { levelId: number; events: ReturnType<typeof createEvents> };
    ctx.levelId = 3;
    const audio = await createAudio(ctx as unknown as GameContext);
    await audio.unlock();
    const dbg = (audio as any).debug;
    const eng = dbg.engine;
    const played: string[] = [];
    const orig = eng.play.bind(eng);
    eng.play = (id: string, p?: unknown) => { played.push(id); orig(id, p as never); };
    const out: Record<string, unknown> = { level: eng.level };
    audio.setRoom('office');
    out.office = { ir: eng.room.ir, quiet: !!eng.room.quiet, cold: eng.cold };
    ctx.events.emit('player:footstep', { position: new THREE.Vector3(), surface: 'concrete', running: false });
    audio.setRoom('canteen');
    ctx.events.emit('player:footstep', { position: new THREE.Vector3(), surface: 'metal', running: false });
    audio.setRoom('lock');
    ctx.events.emit('player:footstep', { position: new THREE.Vector3(), surface: 'metal', running: false });
    ctx.events.emit('bullet:impact', { point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), surface: 'glass' });
    audio.setRoom('atrium');
    out.atriumWarm = { ir: eng.room.ir, bed: eng.room.bed, local: (eng.room.local ?? []).map((e: { id: string }) => e.id) };
    audio.play('habitat_takeover');
    out.atriumCold = { ir: eng.room.ir, bed: eng.room.bed, quiet: !!eng.room.quiet, cold: eng.cold, mood: dbg.cold };
    ctx.events.emit('story:beat', { id: 'habitat_restore' });
    out.restored = { cold: eng.cold, ir: eng.room.ir };
    ctx.events.emit('story:beat', { id: 'habitat_takeover' });
    out.beatCold = eng.cold;
    await new Promise((r) => setTimeout(r, 1500));
    for (const id of ['fountain_loop', 'radio_music', 'lamp_hum_warm', 'amb_garden']) { const h = audio.loop(id); await new Promise((r) => setTimeout(r, 400)); h.stop(0.1); }
    out.played = played;
    out.bank = ['step_carpet', 'step_tile', 'impact_glass_hold', 'amb_hab_cold', 'fountain_loop', 'radio_music'].map((id) => `${id}:${eng.buffers(id) ? 'ready' : 'missing'}`);
    // level 1 stays level 1
    out.l1 = { carpetRenderedAtL3Only: SOUND_MAP.get('step_carpet')?.levels };
    report.live = out;
  }
  head.textContent = `hab: ${Object.keys(ROOMS_L3).length} level-3 rooms × warm/cold — click to hear a chime in the room`;
}

async function modeL4() {
  const { ROOMS_L4, presetFor } = await import('../impulses');
  const shot = (await renderDef(SOUND_MAP.get('carbine_fire')!))[0];
  const tails = await renderDef(SOUND_MAP.get('carbine_tail')!);
  const SIZE: Record<string, number> = { dead: 0, padded: 0, office: 0, lock: 0, whiteroom: 1, tiled: 1, corridor: 1, machine: 1 };
  const rows: Record<string, unknown> = {};
  const W = 340, H = 80;
  for (const id of Object.keys(ROOMS_L4)) {
    for (const dark of [false, true]) {
      const p = presetFor(id, 4, dark);
      if (dark && p === presetFor(id, 4, false)) continue; // no lights-out form (deck 1, theatre, node2, lock4)
      const tail = tails[SIZE[p.ir] ?? 2];
      // three rounds 0.1 s apart, the tail 0.11 s after the last; dry + IR × wet (offline)
      const oc = new OfflineAudioContext(1, Math.ceil((0.5 + tail.duration + 3) * SR), SR);
      const mix = oc.createGain();
      const dry = oc.createGain(); dry.gain.value = 0.35;
      const conv = oc.createConvolver(); conv.buffer = makeIR(p.ir, SR);
      const wet = oc.createGain(); wet.gain.value = p.wet * 0.3;
      mix.connect(dry); dry.connect(oc.destination); mix.connect(conv); conv.connect(wet); wet.connect(oc.destination);
      for (let i = 0; i < 3; i++) { const src = oc.createBufferSource(); src.buffer = shot; const g = oc.createGain(); g.gain.value = 0.72; src.connect(g); g.connect(mix); src.start(i * 0.1); }
      const ts = oc.createBufferSource(); ts.buffer = tail; const tg = oc.createGain(); tg.gain.value = 0.5; ts.connect(tg); tg.connect(mix); ts.start(0.31);
      const r = await oc.startRendering();
      const st = stats(chansOf(r), SR);
      rows[`${id}${dark ? ':dark' : ''}`] = { ir: p.ir, wet: p.wet, bed: p.bed, quiet: !!p.quiet, events: Object.keys(p.events), local: (p.local ?? []).map((e) => e.id), tailMs: st.tailMs, peakDb: st.peakDb };
      const cv = cell(`${id}${dark ? ' DARK' : ''}  ir=${p.ir} wet=${p.wet}${p.quiet ? ' quiet' : ''}\nbed ${JSON.stringify(p.bed)}\ntail ${st.tailMs}ms`, W, H);
      draw(cv, chansOf(r), SR);
      cv.style.cursor = 'pointer';
      cv.onclick = () => audition(r, false, 1);
    }
  }
  Object.assign(report, { rooms: rows });
  if (q.get('live')) {
    const ctx = fakeCtx() as unknown as { levelId: number; events: ReturnType<typeof createEvents>; player: any };
    ctx.levelId = 4;
    ctx.player.weapons.carbine = { clip: 0, clipSize: 30, reserve: 90 };
    const audio = await createAudio(ctx as unknown as GameContext);
    await audio.unlock();
    const dbg = (audio as any).debug;
    const eng = dbg.engine;
    const played: string[] = [];
    const orig = eng.play.bind(eng);
    eng.play = (id: string, p?: { variant?: number }) => { played.push(p?.variant !== undefined ? `${id}#${p.variant}` : id); orig(id, p as never); };
    const tick = async (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) { audio.update(0.016); await new Promise((r) => setTimeout(r, 16)); } };
    const V = () => new THREE.Vector3();
    const E = ctx.events;
    const out: Record<string, unknown> = { level: eng.level };
    const take = (k: string) => { out[k] = played.splice(0); };
    audio.setRoom('corr_n'); take('setup');
    out.corr_n = { ir: eng.room.ir, bed: eng.room.bed, quiet: !!eng.room.quiet };
    for (let i = 0; i < 5; i++) { E.emit('weapon:fired', { weapon: 'carbine', origin: V(), direction: V() }); await tick(100); }
    await tick(250); take('burst5');
    audio.setRoom('tube');
    E.emit('weapon:fired', { weapon: 'carbine', origin: V(), direction: V() }); await tick(300); take('singleInTube');
    E.emit('weapon:empty', { weapon: 'carbine' }); E.emit('weapon:switched', { weapon: 'carbine' }); take('emptySwitch');
    E.emit('weapon:reload', { weapon: 'carbine', duration: 2.6 }); take('reloadEmpty');
    ctx.player.weapons.carbine.clip = 12;
    E.emit('weapon:reload', { weapon: 'carbine', duration: 2.2 }); take('reloadPartial');
    E.emit('player:armor', { armor: 50, delta: 50 }); take('vest');
    await tick(400);
    E.emit('player:armor', { armor: 65, delta: 15 }); take('plate');
    E.emit('pickup', { kind: 'vest', amount: 50, position: V() }); E.emit('pickup', { kind: 'plate', amount: 15, position: V() }); take('pickupVestPlateSilent');
    E.emit('pickup', { kind: 'carbine', amount: 30, position: V() }); E.emit('pickup', { kind: 'ammo_carbine', amount: 30, position: V() }); take('pickupCarbineAmmo');
    E.emit('player:damaged', { amount: 6, health: 94, from: null, absorbed: 12, armor: 38 }); take('hitAbsorbed');
    await tick(100);
    E.emit('player:damaged', { amount: 25, health: 69, from: null, absorbed: 5, armor: 0 }); take('hitBreak');
    await tick(100);
    E.emit('player:damaged', { amount: 18, health: 51, from: null }); take('hitNoArmour');
    E.emit('player:armor', { armor: 0, delta: -5 }); take('armorLossSilent');
    E.emit('bullet:impact', { point: V(), normal: new THREE.Vector3(0, 1, 0), surface: 'flesh' }); take('bodyHit');
    audio.setRoom('gown');
    E.emit('player:footstep', { position: V(), surface: 'concrete', running: false }); take('stepGown');
    audio.setRoom('tube');
    E.emit('player:footstep', { position: V(), surface: 'metal', running: false }); take('stepTube');
    audio.setRoom('chk');
    E.emit('player:footstep', { position: V(), surface: 'metal', running: false }); take('stepChk');
    audio.setRoom('corr_w');
    const before = { ir: eng.room.ir, bed: eng.room.bed };
    E.emit('story:beat', { id: 'l4_lights_out' });
    out.lightsOut = { before, after: { ir: eng.room.ir, bed: eng.room.bed, quiet: !!eng.room.quiet, cold: eng.cold } };
    audio.setRoom('chk');
    out.chkAfterLightsOut = { bed: eng.room.bed };
    for (const id of ['pump_loop', 'alarm_beacon', 'amb_tube']) { const h = audio.loop(id, { position: new THREE.Vector3(2, 1, 0) }); await new Promise((r) => setTimeout(r, 300)); h.stop(0.1); }
    out.bank = ['carbine_fire', 'carbine_tail', 'vest_on', 'body_hit', 'decon_hiss', 'amb_clean', 'pump_loop'].map((id) => `${id}:${eng.buffers(id) ? 'ready' : 'missing'}`);
    report.live = out;
  }
  head.textContent = `l4: ${Object.keys(ROOMS_L4).length} level-4 rooms (normal / lights-out) — click to hear a 3-round burst + tail in the room`;
}

/**
 * Level 5 (stage 3c W2b): every room preset (normal / after lights_out5) auditioned with `tray_crash` (click a cell);
 * &live=1 runs the real system on level 5 with a stub level (rooms with floors, a wet region) and records which ids the
 * game events trigger (flashlight cell, soldier events, soldier fire + its burst tail, passing rounds, d5_gate, wet /
 * grate / deck footsteps, the crawl and magazine sub-rooms, l5_dark) and what `audio.debug.log` holds;
 * &voice=1 renders voice lines through `radio`, `radio:1`, `throat` (lead, duration, level) and measures `throat` at
 * 6.7 m against the in-ear reference on the voice bus.
 */
async function modeL5() {
  const { ROOMS_L5, presetFor } = await import('../impulses');
  const crash = (await renderDef(SOUND_MAP.get('tray_crash')!))[0];
  const rows: Record<string, unknown> = {};
  const W = 340, H = 80;
  if (q.get('rooms') !== '0') for (const id of Object.keys(ROOMS_L5)) {
    for (const dark of [false, true]) {
      const p = presetFor(id, 5, dark);
      if (dark && p === presetFor(id, 5, false)) continue;
      const oc = new OfflineAudioContext(1, Math.ceil((crash.duration + 4) * SR), SR);
      const src = oc.createBufferSource(); src.buffer = crash;
      const dry = oc.createGain(); dry.gain.value = 0.5;
      const conv = oc.createConvolver(); conv.buffer = makeIR(p.ir, SR);
      const wet = oc.createGain(); wet.gain.value = p.wet * 0.5;
      src.connect(dry); dry.connect(oc.destination); src.connect(conv); conv.connect(wet); wet.connect(oc.destination);
      src.start();
      const r = await oc.startRendering();
      const st = stats(chansOf(r), SR);
      rows[`${id}${dark ? ':dark' : ''}`] = { ir: p.ir, wet: p.wet, bed: p.bed, quiet: !!p.quiet, events: Object.keys(p.events), local: (p.local ?? []).map((e) => e.id), tailMs: st.tailMs };
      const cv = cell(`${id}${dark ? ' DARK' : ''}  ir=${p.ir} wet=${p.wet}${p.quiet ? ' quiet' : ''}\nbed ${JSON.stringify(p.bed)}\ntail ${st.tailMs}ms`, W, H);
      draw(cv, chansOf(r), SR);
      cv.style.cursor = 'pointer';
      cv.onclick = () => audition(r, false, 1);
    }
  }
  report.rooms = rows;
  if (q.get('live') || q.get('voice')) {
    const ctx = fakeCtx() as unknown as GameContext & { levelId: number; level: any; player: any; events: ReturnType<typeof createEvents> };
    (ctx as any).levelId = 5;
    // a stub of level 5: spine5 with its crawl floors, sub5 with a gallery, arm5 with the magazine, a wet patch
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    const rooms = [
      { id: 'spine5', name: 'THE SPINE', bounds: box(8, 44, -1.9, 3.2, -18, -14), floors: [{ y: -1.4, box: [16.4, 36.2, -16.6, -15.4], nav: false }, { y: -1.4, box: [36.2, 38.6, -17.6, -15.4], nav: false }] },
      { id: 'arm5', name: 'ARMOURY', bounds: box(14, 22, -3.1, 3.2, -28, -18), floors: [{ y: -1.4, box: [16.4, 17.6, -20, -18], nav: false }, { y: -2.6, box: [14.2, 21.8, -27.8, -21.4], nav: false }] },
      { id: 'sub5', name: 'SUB BAY', bounds: box(22, 46, -0.5, 12, -56, -18), floors: [{ y: 4.8, box: [22.2, 25, -55.8, -18.2] }] },
      { id: 'mess5', name: 'MESS', bounds: box(24, 38, -0.5, 3.2, -14, -2) },
      { id: 'heads5', name: 'WASHROOM', bounds: box(12, 20, -0.5, 2.8, -2, 4) },
    ];
    ctx.level = {
      rooms, regions: { wet: [box(30, 32, 0, 0.05, -40, -38)] },
      roomAt: (p: THREE.Vector3) => rooms.find((r) => p.x >= r.bounds.min.x && p.x <= r.bounds.max.x && p.z >= r.bounds.min.z && p.z <= r.bounds.max.z) ?? null,
      object: () => undefined,
    };
    (ctx.physics as any).lineOfSight = () => true;
    const audio = await createAudio(ctx);
    await audio.unlock();
    const dbg = (audio as any).debug;
    const eng = dbg.engine;
    const played: string[] = [];
    const orig = eng.play.bind(eng);
    eng.play = (id: string, p?: { variant?: number; retry?: boolean }) => { if (!p?.retry) played.push(p?.variant !== undefined ? `${id}#${p.variant}` : id); orig(id, p as never); };
    const tick = async (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) { ctx.camera.updateMatrixWorld(); audio.update(0.016); await new Promise((r) => setTimeout(r, 16)); } };
    const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
    const E = ctx.events;
    const out: Record<string, unknown> = { level: eng.level };
    const take = (k: string) => { out[k] = played.splice(0); };
    E.emit('game:state', { state: 'playing', prev: 'menu' });
    await tick(300); take('setup');
    if (q.get('live')) {
      // flashlight cell (every level: the same wiring)
      E.emit('player:flashlight', { on: true, cause: 'toggle' }); E.emit('player:flashlight', { on: false, cause: 'toggle' }); take('torchToggle');
      E.emit('player:flashlight', { on: false, cause: 'empty' }); take('torchEmpty');
      await tick(250);
      E.emit('player:flashlight', { on: false, cause: 'refused' }); take('torchRefused');
      E.emit('player:flashlight', { on: true, cause: 'story' }); take('torchStory');
      // soldier events: nothing from audio but his steps
      const sp = V(20, 0, -20);
      E.emit('enemy:woke', { id: 9, type: 'soldier', position: sp }); E.emit('enemy:alerted', { id: 9, type: 'soldier', position: sp });
      E.emit('enemy:attack', { id: 9, type: 'soldier', position: sp, kind: 'ranged' } as never);
      E.emit('enemy:damaged', { id: 9, type: 'soldier', point: sp, direction: V(0, 0, 1), amount: 14 });
      E.emit('enemy:died', { id: 9, type: 'soldier', position: sp, group: 'g5_s1' }); take('soldierEventsSilent');
      E.emit('enemy:step', { id: 9, type: 'soldier', position: V(12, 0, -16) }); await tick(60);
      E.emit('enemy:step', { id: 9, type: 'soldier', position: V(20, 0, -16) }); await tick(60);
      E.emit('enemy:step', { id: 9, type: 'soldier', position: V(31, 0, -39) }); await tick(60);
      E.emit('enemy:step', { id: 9, type: 'soldier', position: V(23, 4.8, -30) }); take('soldierSteps_deck_grate_wet_gallery');
      // a carbine burst (W3b's calls) → one tail after the burst; a pistol pair → one tail
      for (let i = 0; i < 3; i++) { audio.play('soldier_carbine_fire', { position: V(20, 1.5, -30) }); await tick(110); }
      await tick(600); take('carbineBurstThenTail');
      for (let i = 0; i < 2; i++) { audio.play('soldier_pistol_fire', { position: V(-10, 1.5, -30) }); await tick(350); }
      await tick(600); take('pistolPairThenTail');
      audio.play('bullet_crack', { position: V(1, 1.6, 4) }); audio.play('bullet_whiz', { position: V(-1, 1.6, 4) }); take('passingRounds');
      audio.play('soldier_step', { position: V(20, 0, -16) }); take('soldierStepByCall_grate');
      // the gate owns its sound; other doors keep door_open
      E.emit('door:opening', { id: 'd5_gate', position: V() }); E.emit('door:closing', { id: 'd5_gate', position: V() });
      E.emit('door:opening', { id: 'd5_duty', position: V() }); take('doors');
      // player footsteps: deck (mess tile), grating (spine), wet patch, gallery, crawl / magazine sub-rooms
      const step = async (x: number, y: number, z: number) => {
        ctx.player.position.set(x, y, z); await tick(600);
        E.emit('player:footstep', { position: V(x, y, z), surface: 'metal', running: false });
        return { room: eng.roomId, ir: eng.room.ir, bed: eng.room.bed, step: played.slice(-1)[0] };
      };
      out.walk = {
        mess: await step(30, 0, -8), spineDeck: await step(12, 0, -16), spineGrate: await step(25, 0, -16),
        crawl: await step(25, -1.4, -16), magazine: await step(18, -2.6, -24), armCrawl: await step(17, -1.4, -19),
        bayFloor: await step(34, 0, -30), bayWet: await step(31, 0, -39), gallery: await step(23, 4.8, -30), heads: await step(15, 0, 1),
      };
      played.length = 0;
      // lights out: spine / sub to amb_dark; the crawl's dark form
      ctx.player.position.set(12, 0, -16); await tick(600);
      const before = { ir: eng.room.ir, bed: eng.room.bed };
      E.emit('story:beat', { id: 'l5_dark' });
      out.lightsOut = { before, after: { room: eng.roomId, bed: eng.room.bed, cold: eng.cold } };
      ctx.player.position.set(34, 0, -30); await tick(600);
      out.bayDark = { room: eng.roomId, bed: eng.room.bed };
      ctx.player.position.set(30, 0, -8); await tick(600);
      out.messUnchanged = { room: eng.roomId, bed: eng.room.bed };
      // loops (lazy)
      for (const id of ['fan_loop', 'radio_static_bed', 'sub_systems_hum']) { const h = audio.loop(id, { position: V(2, 1, 0) }); await tick(400); h.stop(0.1); }
      out.log = dbg.log.slice(-12);
      out.logSize = dbg.log.length;
      out.bank = ['flashlight_die', 'flashlight_dead', 'gate_open_heavy', 'booth_door_shut', 'soldier_carbine_fire', 'soldier_step', 'amb_post', 'amb_dark', 'tray_crash', 'hull_groan_long']
        .map((id) => `${id}:${eng.buffers(id) ? 'ready' : 'missing'}`);
      report.live = out;
    }
    if (q.get('voice')) {
      // the three new chains over existing takes (W9's l5 lines are not on main yet): lead, duration, level
      const table = loadVoiceTable();
      const ids = (q.get('ids') ?? 'l4_sunde_2,l3_choir_pa_residents,l4_unit_gate').split(',');
      const dec = new OfflineAudioContext(1, 1, FX_SR);
      const base = (import.meta as any).env?.BASE_URL ?? '/';
      const vres: Record<string, unknown> = {};
      for (const id of ids) {
        const e = table.get(id);
        if (!e?.generated) { vres[id] = 'not generated'; continue; }
        const bufs = await Promise.all(e.files.map((f) => fetch(base + f).then((r) => r.arrayBuffer()).then((a) => dec.decodeAudioData(a))));
        const row: Record<string, unknown> = {};
        for (const fx of ['headset', 'radio', 'radio:1', 'throat']) {
          const b = await renderVoiceFx(fx, bufs, id, e.lead);
          const ch = chansOf(b);
          const st = stats(ch, b.sampleRate);
          // onset of the voice = first 10 ms frame above 0.1 × p95 speech level after the squelch (≥ 30 ms in)
          const x = ch[0], fr = Math.floor(b.sampleRate * 0.01);
          const lv: number[] = [];
          for (let i = 0; i + fr <= x.length; i += fr) { let s2 = 0; for (let k = 0; k < fr; k++) s2 += x[i + k] ** 2; lv.push(Math.sqrt(s2 / fr)); }
          const p95 = [...lv].sort((a2, b2) => a2 - b2)[Math.floor(lv.length * 0.95)];
          const on = lv.findIndex((v, i2) => i2 >= 3 && v > 0.25 * p95);
          row[fx] = { dur: st.dur, srcDur: +(bufs[0].duration - e.lead).toFixed(3), peakDb: st.peakDb, speechRms: +speechRms(ch).toFixed(4), clip: st.clip, centroid: st.centroid, onsetMs: on * 10 };
          if (q.get('draw') !== '0') {
            const cv = cell(`${id} → ${fx}\n${st.dur}s pk ${st.peakDb}dB onset ${on * 10}ms cen ${st.centroid}`, 520, 100);
            draw(cv, ch, b.sampleRate);
            cv.style.cursor = 'pointer';
            cv.onclick = () => audition(b, false, 1);
          }
        }
        vres[id] = row;
      }
      report.voiceFx = vres;
      // throat at 6.7 m against the in-ear reference, measured on the voice bus (as check-voice-level does)
      const ac: AudioContext = eng.ctx;
      const cap: Float32Array[] = [];
      const spn = ac.createScriptProcessor(4096, 2, 2);
      const mute = ac.createGain(); mute.gain.value = 0;
      eng.buses.voice.connect(spn); spn.connect(mute); mute.connect(ac.destination);
      let on = false;
      spn.onaudioprocess = (ev) => { if (on) { const l = ev.inputBuffer.getChannelData(0), r = ev.inputBuffer.getChannelData(1); const m = new Float32Array(l.length); for (let i = 0; i < l.length; i++) m[i] = Math.sqrt((l[i] * l[i] + r[i] * r[i]) / 2); cap.push(m); } };
      const measure = async (id: string, o?: { position?: THREE.Vector3; fx?: string }) => {
        await audio.preloadVoice([id]);
        if (o?.fx) await dbg.voice.processed(id, o.fx);
        cap.length = 0; on = true;
        const h = audio.say(id, o as never);
        await h.done; await tick(200); on = false;
        // gate as speechRms: frames above 0.25 × p95
        const all = cap.flatMap((a2) => Array.from(a2));
        const hop = 480, fr: number[] = [];
        for (let i = 0; i + hop <= all.length; i += hop) { let s2 = 0; for (let k = 0; k < hop; k++) s2 += all[i + k] ** 2; fr.push(Math.sqrt(s2 / hop)); }
        const p95 = [...fr].sort((a2, b2) => a2 - b2)[Math.floor(fr.length * 0.95)] ?? 0;
        let s2 = 0, n = 0; for (const v of fr) if (v > 0.25 * p95) { s2 += v * v; n++; }
        return Math.sqrt(s2 / Math.max(1, n));
      };
      ctx.camera.position.set(0, 1.65, 0); ctx.camera.lookAt(0, 1.65, -5); ctx.camera.updateMatrixWorld();
      await tick(100);
      const lineId = ids.find((i) => table.get(i)?.generated) ?? 'l3_choir_pa_residents';
      const ref = await measure('l3_choir_pa_residents');
      const throat67 = await measure(lineId, { position: V(0, 1.6, -6.7), fx: 'throat' });
      const radio2d = await measure(lineId, { fx: 'radio' });
      const radio2 = await measure(lineId, { position: V(0, 1.0, -2), fx: 'radio' });
      const radio6 = await measure(lineId, { position: V(0, 1.0, -6), fx: 'radio' });
      const radio12 = await measure(lineId, { position: V(0, 1.0, -12), fx: 'radio' });
      const dB = (x: number) => +(20 * Math.log10(x / ref)).toFixed(1);
      report.voiceLevel = { line: lineId, refRms: +ref.toFixed(4), throat_6_7m_dB: dB(throat67), radio2D_dB: dB(radio2d), radioBody_2m_dB: dB(radio2), radioBody_6m_dB: dB(radio6), radioBody_12m_dB: dB(radio12) };
      report.voiceTrace = dbg.voice.trace.slice(-6).map((t: any) => ({ id: t.id, fx: t.fx, fxLead: t.fxLead, dist: t.dist, occluded: t.occluded, distGain: t.distGain }));
    }
  }
  head.textContent = `l5: ${Object.keys(ROOMS_L5).length} level-5 rooms (normal / lights-out) — click to hear the tray crash in the room`;
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
    else if (mode === 'hab') await modeHab();
    else if (mode === 'l4') await modeL4();
    else if (mode === 'l5') await modeL5();
    else await modeSounds();
  } catch (e) {
    report.error = String((e as Error)?.stack ?? e);
    head.textContent = 'ERROR ' + report.error;
  }
  (window as any).__game = { ready: true };
})();

void SOUND_MAP;
