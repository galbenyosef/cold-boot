/**
 * Real-time engine: one AudioContext, bus graph, reverb slots, buffer bank, voices (2D / 3D / moving),
 * loops, occlusion, muffle and polyphony management.
 *
 *   sources → [sfx | ambience | music | voice] → duck → world → muffle LP → muffle gain ┐
 *   reverb send → A/B room convolvers ─────────────→ world                               ├→ comp → limiter → master → out
 *   voice/music send → plate convolver ─────────────→ world                              │
 *   ui ────────────────────────────────────────────────────────────────────────────────┘
 */
import * as THREE from 'three';
import type { AudioLogEntry, LoopHandle } from '../core/types';
import { SR, type BusName, type SoundDef } from './synth/core';
import { renderDef, renderMany } from './synth/render';
import { cachedRender } from './synth/cache';
import { SOUND_MAP } from './sounds';
import { makeIR, presetFor, DEFAULT_ROOM, type IrName, type RoomPreset } from './impulses';

const MAX_VOICES = 40;
/** Stage 3c §8.11 / H14: ring size of the play log (`audio.debug.log`). */
const LOG_MAX = 512;
const MAX_DIST = 70;
const LATE_PLAY_WINDOW = 0.3;

interface Voice {
  id: string;
  src: AudioBufferSourceNode;
  fade: GainNode;
  nodes: AudioNode[];
  start: number;
  priority: number;
  done: boolean;
}

export interface PlayParams {
  position?: THREE.Vector3 | null;
  volume?: number;
  pitch?: number;
  /** Seconds from now. */
  delay?: number;
  /** Moving source: glide from `position` to `moveTo` over `moveDur` seconds. */
  moveTo?: THREE.Vector3;
  moveDur?: number;
  /** Multiplier on the def's reverb send. */
  send?: number;
  /** Force a specific variant. */
  variant?: number;
  /** Skip the occlusion test (already known / not wanted). */
  noOcclusion?: boolean;
  /** Internal: the deferred replay of a play whose buffer was still rendering (already logged). */
  retry?: boolean;
  /** Extra low-pass (Hz) on the direct sound: "through walls / far away". */
  lowpass?: number;
}

interface Slot { input: GainNode; conv: ConvolverNode; out: GainNode; ir: IrName | null; }

const NOOP_LOOP: LoopHandle = { setVolume() {}, setPosition() {}, stop() {} };

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly buses: Record<BusName, GainNode>;
  readonly duck: { music: GainNode; ambience: GainNode };
  /** Room-tone dropout gains (ambience bed / music), separate from the CHOIR duck. */
  private readonly tone: { music: GainNode; ambience: GainNode };
  readonly world: GainNode;
  readonly master: GainNode;
  readonly analyser: AnalyserNode;
  readonly reverbIn: GainNode;
  readonly plateIn: GainNode;
  private readonly muffleLP: BiquadFilterNode;
  private readonly muffleGain: GainNode;
  private readonly slots: [Slot, Slot];
  private curSlot = 0;
  private irs = new Map<IrName, AudioBuffer>();
  private wet = 0.5;
  room: RoomPreset = DEFAULT_ROOM;
  roomId = '';
  /** The level this page runs (selects room presets + which 'idle'/'late' sounds are pre-rendered). */
  level = 0;
  /** `LevelInfo.paDock`: positional `pa` voice lines use the dock horn's falloff. */
  paDock = false;
  /** Habitat mood: false = warm bed, true = cold bed (the plant AI has taken over). Only level-3 presets have a cold form. */
  cold = false;
  /** Stage 3d: level 6's last state — the quiet after the cut and the loader (`story:beat l6_quiet`). Rooms with an
   *  `after` form use it (it wins over `cold`). */
  after = false;

  private bank = new Map<string, AudioBuffer[]>();
  private pending = new Map<string, Promise<void>>();
  private warned = new Set<string>();
  private voices: Voice[] = [];
  private lastStart = new Map<string, number>();
  private lastVariant = new Map<string, number>();
  private cycleDir = new Map<string, number>();
  readonly loops = new Set<LoopVoice>();
  /**
   * Stage 3c §8.11 / §10.0 H14: every `play` (incl. the ones audio makes itself on events and in the ambience), every
   * `loop` start and every voice `say`, as asked (before rate limits, culls or a missing buffer) — the `--scares`
   * one-owner audit reads it. A ring of the last LOG_MAX; `t` = AudioContext seconds, `pos` = the source or null (2-D).
   */
  readonly log: AudioLogEntry[] = [];

  /** Listener pose (synced from the camera each frame). */
  readonly listener = new THREE.Vector3();
  readonly listenerFwd = new THREE.Vector3(0, 0, -1);
  /** Line-of-sight test (wired to physics lazily by index.ts). */
  los: ((a: THREE.Vector3, b: THREE.Vector3) => boolean) | null = null;
  usePanningModel: PanningModelType = 'HRTF';

  private muffleTarget = -1;
  preRenderMs = 0;
  idleRenderMs = 0;
  /** Phones: background renders run a couple at a time (set by createAudio from DebugFlags.mobile). */
  lowMemory = false;
  /** Synthesis, through the IndexedDB sound cache when it is on (phones: src/audio/synth/cache.ts). */
  private readonly render = (def: SoundDef) => cachedRender(def, renderDef);
  lateRenderMs = 0;

  constructor() {
    const AC: typeof AudioContext = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    const g = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };

    this.master = g(0.85);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.22;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -2.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.12;
    comp.connect(limiter); limiter.connect(this.master); this.master.connect(c.destination);
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(this.analyser);

    this.world = g(1);
    this.muffleLP = c.createBiquadFilter();
    this.muffleLP.type = 'lowpass'; this.muffleLP.frequency.value = 20000; this.muffleLP.Q.value = 0.6;
    this.muffleGain = g(1);
    this.world.connect(this.muffleLP); this.muffleLP.connect(this.muffleGain); this.muffleGain.connect(comp);

    this.buses = { sfx: g(1), ambience: g(0.45), music: g(0.5), voice: g(0.95), ui: g(0.55) };
    this.duck = { music: g(1), ambience: g(1) };
    this.tone = { music: g(1), ambience: g(1) };
    this.buses.sfx.connect(this.world);
    this.buses.voice.connect(this.world);
    this.buses.music.connect(this.tone.music); this.tone.music.connect(this.duck.music); this.duck.music.connect(this.world);
    this.buses.ambience.connect(this.tone.ambience); this.tone.ambience.connect(this.duck.ambience); this.duck.ambience.connect(this.world);
    this.buses.ui.connect(comp);

    // room reverb A/B
    this.reverbIn = g(1);
    const mk = (): Slot => {
      const s: Slot = { input: g(0), conv: c.createConvolver(), out: g(0), ir: null };
      this.reverbIn.connect(s.input); s.input.connect(s.conv); s.conv.connect(s.out); s.out.connect(this.world);
      return s;
    };
    this.slots = [mk(), mk()];
    // plate (voice + music)
    this.plateIn = g(1);
    const plate = c.createConvolver();
    plate.buffer = this.ir('plate');
    const plateOut = g(0.6);
    this.plateIn.connect(plate); plate.connect(plateOut); plateOut.connect(this.world);
  }

  get now() { return this.ctx.currentTime; }
  get running() { return this.ctx.state === 'running'; }

  private ir(name: IrName): AudioBuffer {
    let b = this.irs.get(name);
    if (!b) { b = makeIR(name, this.ctx.sampleRate); this.irs.set(name, b); }
    return b;
  }

  // ───────────────────────── bank

  has(id: string) { return SOUND_MAP.has(id); }
  buffers(id: string): AudioBuffer[] | undefined { return this.bank.get(id); }

  /** Append to the play log (see `log`). */
  logPlay(id: string, pos?: THREE.Vector3 | null): void {
    this.log.push({ id, t: +this.now.toFixed(3), pos: pos ? [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)] : null });
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
  }

  async preload(): Promise<void> {
    // the load set honours `levels` (stage 3c: level 5's arrival sounds are needed in its first second, nowhere else)
    const defs = [...SOUND_MAP.values()].filter((d) => (d.when ?? 'load') === 'load' && (!d.levels || !this.level || d.levels.includes(this.level)));
    this.preRenderMs = await renderMany(defs, (d, b) => this.bank.set(d.id, b), this.lowMemory ? 3 : 8, this.render);
    // pre-build the IRs used most (cheap; avoids a hitch on first room switch)
    for (const n of ['corridor', 'padded', 'hall'] as IrName[]) this.ir(n);
  }

  /** Background render of 'idle' sounds (not awaited by createAudio), then the 'late' set. */
  renderIdle(): Promise<void> {
    const pick = (w: 'idle' | 'late') => [...SOUND_MAP.values()].filter((d) => d.when === w && !this.bank.has(d.id) && (!d.levels || d.levels.includes(this.level)));
    const t0 = performance.now();
    // all at once on desktop; phones a couple at a time — every render holds an OfflineAudioContext, its node graph
    // and its output until done, and a hundred of them at once is a memory spike a phone tab does not survive
    const idle = pick('idle');
    const lanes = this.lowMemory ? 2 : idle.length;
    let next = 0;
    const lane = async () => { while (next < idle.length) await this.ensure(idle[next++].id); };
    return Promise.all(Array.from({ length: Math.min(lanes, idle.length) }, lane)).then(() => {
      this.idleRenderMs = performance.now() - t0;
      for (const n of ['machine', 'shaft', 'dead'] as IrName[]) this.ir(n);
      return new Promise<void>((res) => setTimeout(res, 50));
    }).then(() => {
      const t1 = performance.now();
      return renderMany(pick('late'), (d, b) => { if (!this.bank.has(d.id)) this.bank.set(d.id, b); }, this.lowMemory ? 2 : 3, this.render).then(() => {
        this.lateRenderMs = performance.now() - t1;
        this.ir('cistern');
      });
    });
  }

  ensure(id: string): Promise<void> {
    if (this.bank.has(id)) return Promise.resolve();
    let p = this.pending.get(id);
    if (p) return p;
    const def = SOUND_MAP.get(id);
    if (!def) return Promise.resolve();
    p = this.render(def).then((b) => { this.bank.set(id, b); }).catch((e) => { console.warn('[audio] render failed', id, e); });
    this.pending.set(id, p);
    return p;
  }

  warnUnknown(id: string) {
    if (this.warned.has(id)) return;
    this.warned.add(id);
    console.warn(`[audio] unknown sound id "${id}"`);
  }

  // ───────────────────────── voices

  play(id: string, p: PlayParams = {}): void {
    if (!p.retry) this.logPlay(id, p.position);
    const def = SOUND_MAP.get(id);
    if (!def) { this.warnUnknown(id); return; }
    if (!this.running) return;
    const bufs = this.bank.get(id);
    if (!bufs) {
      const asked = this.now;
      // callers pass shared temp vectors — snapshot them for the deferred play
      const q: PlayParams = { ...p, position: p.position?.clone(), moveTo: p.moveTo?.clone(), retry: true };
      this.ensure(id).then(() => { if (this.now - asked < LATE_PLAY_WINDOW && this.bank.has(id)) this.play(id, q); });
      return;
    }
    if (def.loop) { console.warn(`[audio] "${id}" is a loop; use loop()`); return; }
    const when = this.now + (p.delay ?? 0);
    // rate limit
    const prevStart = this.lastStart.get(id) ?? -1;
    if (when - prevStart < (def.minInterval ?? 0.015)) return;
    // distance cull
    let dist = 0;
    if (p.position) {
      dist = p.position.distanceTo(this.listener);
      if (dist > MAX_DIST * Math.max(1, (def.ref ?? 2.5) / 3)) return;
    }
    this.lastStart.set(id, when);
    this.enforceCaps(id, def);

    const c = this.ctx;
    const src = c.createBufferSource();
    let vi = p.variant ?? Math.floor(Math.random() * bufs.length);
    if (p.variant === undefined && def.order === 'cycle' && bufs.length > 1) {
      const lv = this.lastVariant.get(id);
      let dir = this.cycleDir.get(id) ?? 1;
      if (lv === undefined || when - prevStart > 2.5) { vi = 0; dir = 1; }
      else {
        if (lv + dir < 0 || lv + dir >= bufs.length) dir = -dir;
        vi = lv + dir;
      }
      this.cycleDir.set(id, dir);
    } else if (p.variant === undefined && bufs.length > 1 && vi === this.lastVariant.get(id)) vi = (vi + 1) % bufs.length;
    this.lastVariant.set(id, vi);
    src.buffer = bufs[vi];
    const pv = def.pitchVar ?? 0.04;
    src.playbackRate.value = (p.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * pv);
    const vv = def.volVar ?? 0.12;
    const vol = (def.vol ?? 0.7) * (p.volume ?? 1) * (1 + (Math.random() * 2 - 1) * vv);
    const fade = c.createGain();
    fade.gain.value = vol;
    src.connect(fade);
    const nodes: AudioNode[] = [src, fade];
    let last: AudioNode = fade;
    const bus = this.buses[def.bus ?? 'sfx'];
    let sendAmt = (def.send ?? 1) * (p.send ?? 1);

    if (p.position) {
      const occluded = !p.noOcclusion && this.los ? !this.los(this.listener, p.position) : false;
      let lpF = 0;
      if (dist > 10) lpF = Math.max(2500, 20000 * Math.exp(-(dist - 10) / 25));
      if (occluded) lpF = lpF ? Math.min(lpF, 750) : 750;
      if (p.lowpass) lpF = lpF ? Math.min(lpF, p.lowpass) : p.lowpass;
      if (lpF) {
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = lpF; lp.Q.value = 0.5;
        last.connect(lp); last = lp; nodes.push(lp);
      }
      if (occluded) { const og = c.createGain(); og.gain.value = 0.45; last.connect(og); last = og; nodes.push(og); }
      const pan = this.panner(def);
      this.setPannerPos(pan, p.position, when);
      if (p.moveTo) {
        const t1 = when + (p.moveDur ?? 2);
        pan.positionX.linearRampToValueAtTime(p.moveTo.x, t1);
        pan.positionY.linearRampToValueAtTime(p.moveTo.y, t1);
        pan.positionZ.linearRampToValueAtTime(p.moveTo.z, t1);
      }
      last.connect(pan); pan.connect(bus); nodes.push(pan);
      sendAmt *= (0.45 + Math.min(dist, 25) / 25) * (occluded ? 1.3 : 1);
      // reverb from the pre-occlusion signal (sound reaches us via reflections)
      if (sendAmt > 0.01) { const sg = c.createGain(); sg.gain.value = sendAmt * 0.5; fade.connect(sg); sg.connect(this.reverbIn); nodes.push(sg); }
    } else {
      last.connect(bus);
      if (sendAmt > 0.01 && (def.bus ?? 'sfx') !== 'ui') {
        const sg = c.createGain(); sg.gain.value = sendAmt * 0.35;
        fade.connect(sg); sg.connect(def.bus === 'music' || def.bus === 'voice' ? this.plateIn : this.reverbIn); nodes.push(sg);
      }
    }
    const v: Voice = { id, src, fade, nodes, start: when, priority: def.priority ?? 1, done: false };
    src.onended = () => this.release(v);
    src.start(when);
    this.voices.push(v);
  }

  private panner(def: SoundDef): PannerNode {
    const pan = this.ctx.createPanner();
    try { pan.panningModel = this.usePanningModel; } catch { pan.panningModel = 'equalpower'; }
    pan.distanceModel = 'inverse';
    pan.refDistance = def.ref ?? 2.5;
    pan.rolloffFactor = def.rolloff ?? 1.1;
    pan.maxDistance = 200;
    return pan;
  }

  private setPannerPos(pan: PannerNode, p: THREE.Vector3, when: number): void {
    pan.positionX.setValueAtTime(p.x, when);
    pan.positionY.setValueAtTime(p.y, when);
    pan.positionZ.setValueAtTime(p.z, when);
  }

  private release(v: Voice) {
    if (v.done) return;
    v.done = true;
    for (const n of v.nodes) n.disconnect();
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  private kill(v: Voice, fade = 0.03) {
    if (v.done) return;
    const t = this.now;
    v.fade.gain.cancelScheduledValues(t);
    v.fade.gain.setTargetAtTime(0, t, fade / 3);
    try { v.src.stop(t + fade + 0.02); } catch { /* not started */ }
    v.priority = -99; // already dying
  }

  private enforceCaps(id: string, def: SoundDef) {
    const cap = def.maxVoices ?? 4;
    let n = 0, oldest: Voice | null = null;
    for (const v of this.voices) if (v.id === id && v.priority > -99) { n++; if (!oldest || v.start < oldest.start) oldest = v; }
    if (n >= cap && oldest) this.kill(oldest);
    let live = 0;
    for (const v of this.voices) if (v.priority > -99) live++;
    if (live >= MAX_VOICES) {
      let victim: Voice | null = null;
      for (const v of this.voices) {
        if (v.priority <= -99) continue;
        if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
      }
      if (victim) this.kill(victim);
    }
  }

  get voiceCount() { return this.voices.length; }

  // ───────────────────────── loops

  loop(id: string, p: { position?: THREE.Vector3; volume?: number; pitch?: number } = {}, busOverride?: BusName): LoopHandle {
    this.logPlay(id, p.position);
    const def = SOUND_MAP.get(id);
    if (!def) { this.warnUnknown(id); return NOOP_LOOP; }
    if (!def.loop) {
      // a one-shot requested as a loop: honour it by looping the buffer anyway
    }
    const lv = new LoopVoice(this, def, p, busOverride);
    this.loops.add(lv);
    return lv;
  }

  // ───────────────────────── room / reverb

  setRoom(id: string): void {
    if (id === this.roomId) return;
    this.roomId = id;
    const preset = presetFor(id, this.level, this.cold, this.after);
    this.room = preset;
    this.setReverb(preset.ir, preset.wet);
  }

  /** Switch the warm/cold mood and re-resolve the current room. Returns true if anything changed. */
  setMood(cold: boolean, after = this.after): boolean {
    if (cold === this.cold && after === this.after) return false;
    this.cold = cold;
    this.after = after;
    if (!this.roomId) return true;
    const preset = presetFor(this.roomId, this.level, this.cold, this.after);
    if (preset === this.room) return true;
    this.room = preset;
    this.setReverb(preset.ir, preset.wet);
    return true;
  }

  private setReverb(name: IrName, wet: number): void {
    const t = this.now;
    this.wet = wet;
    const a = this.slots[this.curSlot];
    if (a.ir === name) {
      a.input.gain.setTargetAtTime(1, t, 0.15);
      a.out.gain.setTargetAtTime(wet, t, 0.3);
      return;
    }
    const b = this.slots[1 - this.curSlot];
    this.curSlot = 1 - this.curSlot;
    a.input.gain.setTargetAtTime(0, t, 0.25); // old room's tail rings out naturally
    if (b.ir !== name) {
      // b is idle (input 0) — mute its residual tail, then swap the IR (no clicks: in/out both silent)
      b.out.gain.cancelScheduledValues(t);
      b.out.gain.setTargetAtTime(0, t, 0.01);
      b.input.gain.cancelScheduledValues(t);
      b.input.gain.setValueAtTime(0, t);
      const buf = this.ir(name);
      setTimeout(() => {
        b.conv.buffer = buf;
        b.ir = name;
        const t2 = this.now;
        b.input.gain.setTargetAtTime(1, t2, 0.2);
        b.out.gain.setTargetAtTime(this.wet, t2, 0.05);
      }, 70);
    } else {
      b.input.gain.cancelScheduledValues(t);
      b.input.gain.setTargetAtTime(1, t, 0.2);
      b.out.gain.cancelScheduledValues(t);
      b.out.gain.setTargetAtTime(wet, t, 0.2);
    }
  }

  // ───────────────────────── muffle / volume / ducking

  setMuffleAmount(m: number): void {
    m = Math.max(0, Math.min(1, m));
    if (Math.abs(m - this.muffleTarget) < 0.005) return;
    this.muffleTarget = m;
    const t = this.now;
    const f = Math.exp(Math.log(20000) * (1 - m) + Math.log(320) * m);
    this.muffleLP.frequency.setTargetAtTime(f, t, 0.12);
    this.muffleGain.gain.setTargetAtTime(1 - 0.6 * m, t, 0.12);
  }

  setMaster(v: number): void { this.master.gain.setTargetAtTime(Math.max(0, v) * 0.85, this.now, 0.05); }

  /** Room tone level (1 = normal): the ambience bed drops to `bed`, music to `music`. */
  setRoomTone(bed: number, music: number, tau: number): void {
    const t = this.now;
    this.tone.ambience.gain.setTargetAtTime(Math.max(0, bed), t, tau);
    this.tone.music.gain.setTargetAtTime(Math.max(0, music), t, tau);
  }

  setDuck(amount: number, tau = 0.25): void {
    const t = this.now;
    this.duck.music.gain.setTargetAtTime(1 - 0.5 * amount, t, tau);
    this.duck.ambience.gain.setTargetAtTime(1 - 0.4 * amount, t, tau);
  }

  // ───────────────────────── listener

  syncListener(m: THREE.Matrix4): void {
    const e = m.elements;
    const L = this.ctx.listener;
    const px = e[12], py = e[13], pz = e[14];
    const fx = -e[8], fy = -e[9], fz = -e[10];
    this.listener.set(px, py, pz);
    this.listenerFwd.set(fx, fy, fz);
    if (L.positionX) {
      L.positionX.value = px; L.positionY.value = py; L.positionZ.value = pz;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
      L.upX.value = e[4]; L.upY.value = e[5]; L.upZ.value = e[6];
    } else {
      (L as any).setPosition(px, py, pz);
      (L as any).setOrientation(fx, fy, fz, e[4], e[5], e[6]);
    }
  }

  /** Low-rate occlusion refresh for 3D loops (round-robin, ≤ 2 checks per call). */
  private occIter: Iterator<LoopVoice> | null = null;
  updateLoopOcclusion(): void {
    if (!this.los || this.loops.size === 0) return;
    for (let k = 0; k < 2; k++) {
      if (!this.occIter) this.occIter = this.loops.values();
      const r = this.occIter.next();
      if (r.done) { this.occIter = null; continue; }
      r.value.refreshOcclusion();
    }
  }
  onLoopRemoved() { this.occIter = null; }
}

/** A looping voice. Valid before its buffer exists / before unlock (starts as soon as both are true). */
export class LoopVoice implements LoopHandle {
  private src: AudioBufferSourceNode | null = null;
  private readonly fade: GainNode;
  private readonly occLP: BiquadFilterNode | null = null;
  private readonly occGain: GainNode | null = null;
  private readonly panner: PannerNode | null = null;
  private readonly sendG: GainNode | null = null;
  private readonly pos: THREE.Vector3 | null = null;
  private target: number;
  private stopped = false;
  private occluded = false;

  constructor(private readonly eng: AudioEngine, private readonly def: SoundDef, p: { position?: THREE.Vector3; volume?: number; pitch?: number }, busOverride?: BusName) {
    const c = eng.ctx;
    this.target = (def.vol ?? 0.5) * (p.volume ?? 1);
    this.fade = c.createGain();
    this.fade.gain.value = 0;
    const bus = eng.buses[busOverride ?? def.bus ?? 'sfx'];
    if (p.position) {
      this.pos = p.position.clone();
      this.occLP = c.createBiquadFilter();
      this.occLP.type = 'lowpass'; this.occLP.frequency.value = 20000; this.occLP.Q.value = 0.5;
      this.occGain = c.createGain();
      const pan = c.createPanner();
      try { pan.panningModel = eng.usePanningModel; } catch { pan.panningModel = 'equalpower'; }
      pan.distanceModel = 'inverse'; pan.refDistance = def.ref ?? 2.5; pan.rolloffFactor = def.rolloff ?? 1.1; pan.maxDistance = 200;
      pan.positionX.value = this.pos.x; pan.positionY.value = this.pos.y; pan.positionZ.value = this.pos.z;
      this.panner = pan;
      this.fade.connect(this.occLP); this.occLP.connect(this.occGain); this.occGain.connect(pan); pan.connect(bus);
      this.sendG = c.createGain(); this.sendG.gain.value = (def.send ?? 1) * 0.3;
      this.fade.connect(this.sendG); this.sendG.connect(eng.reverbIn);
      this.refreshOcclusion();
    } else {
      this.fade.connect(bus);
    }
    const pitch = p.pitch ?? 1;
    eng.ensure(def.id).then(() => {
      if (this.stopped) return;
      const bufs = eng.buffers(def.id);
      if (!bufs) return;
      const s = c.createBufferSource();
      s.buffer = bufs[Math.floor(Math.random() * bufs.length)];
      s.loop = true;
      s.playbackRate.value = pitch;
      s.connect(this.fade);
      const t = c.currentTime;
      s.start(t, Math.random() * s.buffer.duration);
      this.fade.gain.setTargetAtTime(this.target, t, 0.08);
      this.src = s;
    });
  }

  setVolume(v: number, fadeSeconds = 0.15): void {
    if (this.stopped) return;
    this.target = (this.def.vol ?? 0.5) * Math.max(0, v);
    if (this.src) this.fade.gain.setTargetAtTime(this.target, this.eng.now, Math.max(0.005, fadeSeconds / 3));
  }

  setPosition(p: THREE.Vector3): void {
    if (!this.pos || !this.panner) return;
    this.pos.copy(p);
    this.panner.positionX.value = p.x; this.panner.positionY.value = p.y; this.panner.positionZ.value = p.z;
  }

  setPitch(r: number): void { if (this.src) this.src.playbackRate.setTargetAtTime(r, this.eng.now, 0.1); }

  refreshOcclusion(): void {
    if (!this.pos || !this.occLP || !this.occGain || !this.eng.los) return;
    const d = this.pos.distanceTo(this.eng.listener);
    const occ = d > 1.2 && d < 60 ? !this.eng.los(this.eng.listener, this.pos) : false;
    let f = d > 10 ? Math.max(2500, 20000 * Math.exp(-(d - 10) / 25)) : 20000;
    if (occ) f = Math.min(f, 750);
    const t = this.eng.now;
    this.occLP.frequency.setTargetAtTime(f, t, 0.15);
    if (occ !== this.occluded) {
      this.occluded = occ;
      this.occGain.gain.setTargetAtTime(occ ? 0.45 : 1, t, 0.15);
    }
  }

  stop(fadeSeconds = 0.3): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.eng.now;
    const f = Math.max(0.01, fadeSeconds);
    this.fade.gain.cancelScheduledValues(t);
    this.fade.gain.setTargetAtTime(0, t, f / 3);
    const src = this.src;
    const nodes: (AudioNode | null)[] = [this.fade, this.occLP, this.occGain, this.panner, this.sendG];
    const cleanup = () => { src?.disconnect(); for (const n of nodes) n?.disconnect(); };
    if (src) { src.onended = cleanup; src.stop(t + f * 1.6 + 0.02); }
    else cleanup();
    this.eng.loops.delete(this);
    this.eng.onLoopRemoved();
  }
}

export { SR };
