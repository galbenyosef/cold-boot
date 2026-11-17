/**
 * Run-time processing of recorded voice lines (REVISION 4 → Voices). Every line ships as a clean take
 * (public/voice/<id>.mp3, 24 kHz mono); the character's treatment is rendered here, offline, the first
 * time a line is needed (tens of ms; cached by voice.ts) — so it stays adjustable without regenerating.
 *
 *   clean     the take as is
 *   choir     CHOIR: the line layered — pitch-shifted copies (formants move with them: lower/bigger and
 *             higher/smaller), small delays, wide stereo, a few "every speaker at once" slap copies.
 *             `choir:N` keeps N layers (1 = a single voice; used as it shuts down).
 *   intercom  wall panel: band-pass, a little drive, hiss, squelch clicks on and off
 *   headset   handset / radio (alias `radio`): narrower, dirtier, static crackle, short dropouts
 *   unit      a staff voice coming out of a service unit: comb resonance + ring modulation + light
 *             bit-crush, dropouts and one stutter — still the person, with nothing behind it
 *   foreman   all layers of a multi-voice line (cast "layers") through the unit chain, out of sync
 *   recorder  pocket recorder: small-speaker band, tape hiss, wow/flutter, start/stop clunks
 *   pa        automated announcement through a ceiling speaker
 *   room      (level 3) a voice from a small desk / wall speaker in an office: 200 Hz – 5.5 kHz, a little honk,
 *             light drive, four early reflections and a short soft tail. `room:400` = the same with a 400 Hz
 *             low-pass (an unintelligible murmur from the next room)
 *   door      (level 3) a voice from behind a sealed cabin door: two-pole low-pass at 900 Hz, panel/wood body
 *             resonances (~150 / 330 Hz) and a resonant thump path, a faint air-gap leak, −6 dB relative
 *
 * Output: a 24 kHz AudioBuffer (stereo for choir, mono otherwise) normalised so active speech sits at
 * the same RMS for every chain (OUT_RMS), peak ≤ 0.95.
 */
import { hashStr, mulberry } from './synth/core';

export const FX_SR = 24000;
const OUT_RMS = 0.13;

export type VoiceFxName = 'clean' | 'choir' | 'intercom' | 'headset' | 'unit' | 'foreman' | 'recorder' | 'pa' | 'room' | 'door';

export const FX_NAMES: readonly VoiceFxName[] = ['clean', 'choir', 'intercom', 'headset', 'unit', 'foreman', 'recorder', 'pa', 'room', 'door'];

export function parseFx(fx: string | undefined | null): { name: VoiceFxName; arg: number | null } {
  const [raw, a] = String(fx ?? 'clean').toLowerCase().split(':');
  const alias: Record<string, VoiceFxName> = { radio: 'headset', handset: 'headset', speaker: 'pa', staff: 'unit', tape: 'recorder', desk: 'room', cabin: 'door' };
  const n = (alias[raw] ?? raw) as VoiceFxName;
  const arg = a !== undefined && a !== '' && Number.isFinite(+a) ? +a : null;
  return { name: FX_NAMES.includes(n) ? n : 'clean', arg };
}

// ───────────────────────────────────────────── JS DSP helpers (24 kHz)

/** Pitch-preserving time stretch (WSOLA) — port of tools/voice/coldvoice/audio.py. speed > 1 → faster. */
export function wsola(x: Float32Array, speed: number, sr = FX_SR): Float32Array {
  if (Math.abs(speed - 1) < 1e-3 || x.length === 0) return x;
  const N = Math.floor(sr * 0.03), Hs = N >> 1, tol = Math.floor(sr * 0.008), Ha = Hs * speed;
  if (x.length < 2 * N) {
    const out = new Float32Array(Math.floor(x.length / speed));
    for (let i = 0; i < out.length; i++) out[i] = x[Math.min(x.length - 1, Math.floor(i * speed))];
    return out;
  }
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const xp = new Float32Array(x.length + N + 3 * tol + Hs + tol);
  xp.set(x, tol);
  const nFrames = Math.floor((x.length - N) / Ha) + 1;
  const out = new Float32Array(nFrames * Hs + N);
  let prev = 0;
  for (let k = 0; k < nFrames; k++) {
    const target = Math.round(k * Ha);
    let best = 0;
    if (k > 0) {
      const nat = prev + Hs;
      // decimated cross-correlation (every 2nd sample, every 2nd lag), as in the Python version
      let bestC = -Infinity, bestJ = 0;
      for (let j = 0; j <= tol; j++) {
        let c = 0;
        const r0 = target + 2 * j, t0 = nat + tol;
        for (let i = 0; i < N; i += 2) c += xp[r0 + i] * xp[t0 + i];
        if (c > bestC) { bestC = c; bestJ = j; }
      }
      best = Math.max(0, target - tol + 2 * bestJ);
    }
    const o = k * Hs, s = best + tol;
    for (let i = 0; i < N; i++) out[o + i] += xp[s + i] * win[i];
    prev = best;
  }
  return out.subarray(0, Math.floor(x.length / speed));
}

/** Resample (moves pitch and formants together), then WSOLA back to the original length. */
export function pitchShift(x: Float32Array, semitones: number, sr = FX_SR): Float32Array {
  if (Math.abs(semitones) < 1e-3) return x;
  const r = Math.pow(2, semitones / 12);
  const n = Math.floor((x.length - 1) / r);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * r, i0 = Math.floor(p), f = p - i0;
    y[i] = x[i0] * (1 - f) + x[Math.min(x.length - 1, i0 + 1)] * f;
  }
  return wsola(y, 1 / r, sr);
}

/** Short gaps (fade to `floor`) at seeded positions, not in the first/last 0.25 s. */
function gaps(d: Float32Array, rnd: () => number, count: number, minMs: number, maxMs: number, floor: number, from: number, to: number): void {
  const sr = FX_SR;
  for (let k = 0; k < count; k++) {
    const seg = Math.floor(((minMs + rnd() * (maxMs - minMs)) / 1000) * sr);
    const a = Math.floor(from * sr), b = Math.floor(to * sr) - seg;
    if (b <= a) continue;
    const at = a + Math.floor(rnd() * (b - a));
    const edge = Math.floor(0.004 * sr);
    for (let i = 0; i < seg; i++) {
      const e = Math.min(1, i / edge, (seg - i) / edge);
      d[at + i] *= 1 - e * (1 - floor);
    }
  }
}

/** Repeat one short grain (digital stutter). */
function stutterOnce(d: Float32Array, rnd: () => number, from: number, to: number): void {
  const sr = FX_SR;
  const chunk = Math.floor((0.045 + rnd() * 0.04) * sr);
  const reps = 2;
  const a = Math.floor(from * sr), b = Math.floor(to * sr) - chunk * (reps + 1);
  if (b <= a) return;
  const at = a + Math.floor(rnd() * (b - a));
  for (let r = 1; r <= reps; r++) for (let i = 0; i < chunk; i++) {
    const e = Math.min(1, i / 48, (chunk - i) / 48);
    const dst = at + r * chunk + i;
    d[dst] = d[dst] * (1 - e) + d[at + i] * e;
  }
}

/** RMS of the loud (speech) frames. */
export function speechRms(chans: Float32Array[]): number {
  const hop = 240, d = chans[0], n = Math.floor(d.length / hop);
  if (n < 2) return 0;
  const fr = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let e = 0;
    for (const c of chans) for (let i = f * hop; i < (f + 1) * hop; i++) e += c[i] * c[i];
    fr[f] = Math.sqrt(e / (hop * chans.length));
  }
  const sorted = Array.from(fr).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  let s = 0, k = 0;
  for (const v of fr) if (v > 0.25 * p95) { s += v * v; k++; }
  return k ? Math.sqrt(s / k) : 0;
}

function normalise(chans: Float32Array[], target: number): void {
  let bad = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) { d[i] = 0; bad++; }
  if (bad) console.warn('[audio] voice fx: non-finite samples zeroed', bad);
  const r = speechRms(chans);
  let g = r > 1e-5 ? target / r : 1;
  let pk = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  if (pk * g > 0.95) g = 0.95 / pk;
  for (const d of chans) for (let i = 0; i < d.length; i++) d[i] *= g;
}

// ───────────────────────────────────────────── offline graph helpers

type Ctx = OfflineAudioContext;
const gain = (c: Ctx, v: number) => { const g = c.createGain(); g.gain.value = v; return g; };
const filt = (c: Ctx, type: BiquadFilterType, f: number, Q = 0.707, db = 0) => {
  const b = c.createBiquadFilter(); b.type = type; b.frequency.value = Math.min(f, FX_SR * 0.45); b.Q.value = Q; b.gain.value = db; return b;
};
const chain = (...n: AudioNode[]) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; };
function shaper(c: Ctx, amt: number, crushBits = 0): WaveShaperNode {
  const w = c.createWaveShaper();
  const n = 2048, cv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    cv[i] = crushBits ? Math.round(x * 2 ** crushBits) / 2 ** crushBits : Math.tanh(x * amt) / Math.tanh(amt);
  }
  w.curve = cv;
  return w;
}
function bufOf(c: Ctx, d: Float32Array): AudioBuffer {
  const b = c.createBuffer(1, Math.max(1, d.length), FX_SR);
  b.getChannelData(0).set(d);
  return b;
}
function play(c: Ctx, d: Float32Array, at: number, dst: AudioNode, rate = 1): AudioBufferSourceNode {
  const s = c.createBufferSource(); s.buffer = bufOf(c, d); s.playbackRate.value = rate; s.connect(dst); s.start(at); return s;
}
function noise(c: Ctx, rnd: () => number, dur: number, pink = false): Float32Array {
  const d = new Float32Array(Math.ceil(dur * FX_SR));
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = rnd() * 2 - 1;
    if (!pink) { d[i] = w; continue; }
    b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
  }
  return d;
}
/** Burst of band-passed noise (squelch / tape clunk body). */
function burst(c: Ctx, rnd: () => number, at: number, dur: number, f: number, Q: number, level: number, dst: AudioNode): void {
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.002);
  g.gain.setTargetAtTime(0, at + dur * 0.4, dur / 4);
  const bp = filt(c, 'bandpass', f, Q);
  play(c, noise(c, rnd, dur + 0.05), at, bp);
  chain(bp, g, dst);
}
function click(c: Ctx, at: number, level: number, dst: AudioNode): void {
  const d = new Float32Array(Math.floor(0.004 * FX_SR));
  for (let i = 0; i < d.length; i++) d[i] = (i < 3 ? 1 : 0) * level - level * 0.4 * Math.exp(-i / 18) * Math.sin(i * 0.9);
  play(c, d, at, dst);
}
function thump(c: Ctx, at: number, f0: number, level: number, dst: AudioNode): void {
  const o = c.createOscillator(); o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f0 * 0.45, at + 0.05);
  const g = c.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(level, at + 0.002); g.gain.setTargetAtTime(0, at + 0.004, 0.025);
  o.connect(g); g.connect(dst); o.start(at); o.stop(at + 0.25);
}

// ───────────────────────────────────────────── chains

/** Seconds an fx chain puts before the voice by design (squelch, tape clunk, speaker click) — the sync point is there. */
export function fxLead(name: VoiceFxName): number {
  return name === 'recorder' ? 0.28 : name === 'intercom' || name === 'headset' ? 0.07 : name === 'pa' ? 0.04 : name === 'door' ? 0.05 : name === 'room' ? 0.02 : 0;
}

/** Render `fx` over the clean take(s). `layers[0]` is the line; more layers only for multi-voice lines. */
export async function renderVoiceFx(fxName: string, layers: AudioBuffer[], seedKey: string, leadIn = 0): Promise<AudioBuffer> {
  const { name, arg } = parseFx(fxName);
  const rnd = mulberry(hashStr(seedKey) ^ 0x5eed);
  const src = layers.map((b) => skipLead(monoAt24k(b), leadIn));
  const base = src[0];
  const dur = base.length / FX_SR;
  const stereo = name === 'choir';
  const lead = fxLead(name);
  const tail = name === 'choir' ? 0.35 : name === 'recorder' ? 0.22 : name === 'intercom' || name === 'headset' ? 0.2 : name === 'pa' ? 0.45 : name === 'foreman' ? 0.4 : name === 'unit' ? 0.08 : name === 'door' ? 0.4 : name === 'room' ? 0.3 : 0.01;
  const longest = Math.max(...src.map((d) => d.length)) / FX_SR + (name === 'foreman' ? 0.22 : 0);
  const len = Math.ceil((lead + longest + tail) * FX_SR);
  const c = new OfflineAudioContext(stereo ? 2 : 1, len, FX_SR);
  const out = gain(c, 1);
  out.connect(c.destination);
  const t0 = lead;

  if (name === 'clean') {
    play(c, base, 0, out);
  } else if (name === 'choir') {
    const n = Math.max(1, Math.min(5, arg ?? 5));
    const mix = gain(c, 1);
    const tone = chain(mix, filt(c, 'highpass', 80), filt(c, 'peaking', 2600, 1, 2.5), filt(c, 'lowpass', 9500)) as AudioNode;
    tone.connect(out);
    // [semitones, level, pan, delay, lowpass]
    const L: Array<[number, number, number, number, number]> = [
      [0, 1, 0, 0, 0],
      [-5, 0.55, -0.6, 0.021, 0],
      [4, 0.42, 0.62, 0.036, 0],
      [-12, 0.24, 0.12, 0.009, 2600],
      [0.35, 0.32, -0.25, 0.052, 6000],
    ];
    for (const [st, lv, pan, dt, lp] of L.slice(0, n)) {
      const d = st ? pitchShift(base, st) : base;
      const p = c.createStereoPanner(); p.pan.value = pan;
      const g = gain(c, n === 1 ? 1 : lv);
      if (lp) chain(g, filt(c, 'lowpass', lp), p, mix); else chain(g, p, mix);
      play(c, d, t0 + dt, g);
    }
    // "every speaker at once": delayed, band-limited, panned copies of the whole mix
    if (n >= 3) {
      for (const [dt, lv, pan, lpF] of [[0.013, 0.22, -0.8, 5000], [0.031, 0.18, 0.8, 4000], [0.058, 0.12, -0.3, 3000], [0.083, 0.08, 0.45, 2400]] as const) {
        const d = c.createDelay(0.2); d.delayTime.value = dt;
        const p = c.createStereoPanner(); p.pan.value = pan;
        chain(tone, d, filt(c, 'lowpass', lpF), gain(c, lv), p, out);
      }
    }
  } else if (name === 'intercom' || name === 'headset') {
    const radio = name === 'headset';
    const first = gain(c, 1);
    const hp1 = filt(c, 'highpass', radio ? 420 : 300), hp2 = filt(c, 'highpass', radio ? 420 : 300);
    const pk = filt(c, 'peaking', radio ? 1900 : 1700, 1, radio ? 6 : 4.5);
    const sh = shaper(c, radio ? 3.2 : 2.0);
    const lp1 = filt(c, 'lowpass', radio ? 2900 : 3600), lp2 = filt(c, 'lowpass', radio ? 2900 : 3600);
    chain(first, hp1, hp2, pk, sh, lp1, lp2, out);
    const d = base.slice();
    if (radio) gaps(d, rnd, 1 + Math.floor(rnd() * 2), 25, 60, 0.15, 0.3, dur - 0.3);
    play(c, d, t0, first);
    // hiss / static bed for the whole transmission
    const bedLen = lead + dur + tail * 0.6;
    const bed = noise(c, rnd, bedLen);
    if (radio) for (let i = 0; i < bed.length; i++) if (rnd() < 18 / FX_SR) { const a = (rnd() * 2 - 1) * 9; for (let k = 0; k < 40 && i + k < bed.length; k++) bed[i + k] += a * Math.exp(-k / 8); }
    const bedG = gain(c, 0);
    bedG.gain.setValueAtTime(0, 0);
    bedG.gain.linearRampToValueAtTime(radio ? 0.016 : 0.008, 0.02);
    bedG.gain.setValueAtTime(radio ? 0.016 : 0.008, bedLen - 0.05);
    bedG.gain.linearRampToValueAtTime(0, bedLen);
    const bedBp = filt(c, 'bandpass', 2400, 0.6);
    play(c, bed, 0, bedBp);
    chain(bedBp, bedG, out);
    // squelch: key-up click + short burst; key-down burst + click
    click(c, 0.005, 0.25, out);
    burst(c, rnd, 0.01, 0.05, 1800, 0.9, radio ? 0.12 : 0.06, out);
    const end = lead + dur + 0.03;
    burst(c, rnd, end, radio ? 0.14 : 0.09, 2200, 0.7, radio ? 0.16 : 0.08, out);
    click(c, end + (radio ? 0.13 : 0.08), 0.2, out);
  } else if (name === 'unit' || name === 'foreman') {
    const takes = name === 'foreman' ? src : [base];
    const offs = [0, 0.085, 0.19], rates = [1, 0.986, 1.018], combs = [0.0062, 0.0081, 0.0047], rings = [52, 67, 43];
    takes.forEach((tk, k) => {
      const d = tk.slice();
      const dd = d.length / FX_SR;
      gaps(d, rnd, 1 + Math.floor(rnd() * (dd > 2 ? 3 : 2)), 35, 110, 0.06, 0.25, dd - 0.2);
      if (dd > 1 && rnd() < 0.6) stutterOnce(d, rnd, 0.3, dd - 0.3);
      const inG = gain(c, 1);
      play(c, d, t0 + offs[k % 3], inG, rates[k % 3]);
      const mix = gain(c, k ? 0.8 : 1);
      // band of a small built-in speaker
      const sp = chain(mix, filt(c, 'highpass', 170), filt(c, 'peaking', 2300, 1.4, 4), filt(c, 'lowpass', 5200)) as AudioNode;
      sp.connect(out);
      // dry
      chain(inG, gain(c, 0.62), mix);
      // comb resonance (metal body)
      const dl = c.createDelay(0.05); dl.delayTime.value = combs[k % 3];
      const fb = gain(c, 0.52);
      const cin = gain(c, 0.45);
      chain(inG, cin, dl); chain(dl, fb, dl); chain(dl, gain(c, 0.55), mix);
      // ring modulation (x · sin)
      const ring = gain(c, 0);
      const osc = c.createOscillator(); osc.frequency.value = rings[k % 3];
      osc.connect(ring.gain); osc.start(0);
      chain(inG, ring, gain(c, 0.32), mix);
      // light bit-crush
      chain(inG, shaper(c, 1, 5), gain(c, 0.16), mix);
    });
  } else if (name === 'recorder') {
    const wow = c.createDelay(0.05); wow.delayTime.value = 0.012;
    const lfo1 = c.createOscillator(); lfo1.frequency.value = 0.55; const d1 = gain(c, 0.0011);
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 6.3; const d2 = gain(c, 0.00012);
    lfo1.connect(d1); d1.connect(wow.delayTime); lfo2.connect(d2); d2.connect(wow.delayTime); lfo1.start(0); lfo2.start(0);
    const first = gain(c, 1);
    chain(first, wow, filt(c, 'highpass', 260), filt(c, 'highpass', 260), filt(c, 'peaking', 1150, 0.9, 3.5),
      shaper(c, 1.6), filt(c, 'lowpass', 4300), filt(c, 'lowpass', 4300), out);
    play(c, base, t0, first);
    const all = lead + dur + tail;
    const hiss = noise(c, rnd, all, true);
    const hg = gain(c, 0);
    hg.gain.setValueAtTime(0, 0.05); hg.gain.linearRampToValueAtTime(0.03, 0.08); hg.gain.setValueAtTime(0.03, all - 0.12); hg.gain.linearRampToValueAtTime(0, all - 0.08);
    const hissHp = filt(c, 'highpass', 1800);
    play(c, hiss, 0, hissHp);
    chain(hissHp, filt(c, 'lowpass', 7000), hg, out);
    // play-button clunk; stop clunk
    thump(c, 0.02, 140, 0.25, out); click(c, 0.02, 0.2, out);
    thump(c, all - 0.1, 160, 0.2, out); click(c, all - 0.1, 0.15, out);
  } else if (name === 'pa') {
    const first = gain(c, 1);
    const band = chain(first, filt(c, 'highpass', 430, 0.9), filt(c, 'peaking', 1500, 1.2, 5), shaper(c, 2.0),
      filt(c, 'lowpass', 3400), filt(c, 'highpass', 360)) as AudioNode;
    band.connect(out);
    // hard little room behind the speaker
    const fbIn = gain(c, 1), fd = c.createDelay(0.3), fg = gain(c, 0.36);
    fd.delayTime.value = 0.121;
    chain(band, gain(c, 0.4), fbIn); chain(fbIn, fd, filt(c, 'lowpass', 2000), fg, fbIn); chain(fbIn, gain(c, 0.5), out);
    play(c, base, t0, first);
    click(c, 0.005, 0.12, out);
  } else if (name === 'room') {
    // small desk speaker: 200 Hz – 5.5 kHz with a little cabinet honk and light drive, then a small office
    const first = gain(c, 1);
    const fcut = arg && arg >= 150 ? arg : 5500;
    const spk = chain(first, filt(c, 'highpass', arg ? 160 : 200, 0.8), filt(c, 'highpass', arg ? 160 : 200, 0.6),
      filt(c, 'peaking', 1500, 0.9, 3), shaper(c, 1.4), filt(c, 'lowpass', fcut), filt(c, 'lowpass', fcut)) as AudioNode;
    const dry = gain(c, 1);
    spk.connect(dry); dry.connect(out);
    // early reflections of a carpeted 4 × 3 m room + a short soft tail
    for (const [dt, lv] of [[0.0063, 0.34], [0.0121, 0.27], [0.0197, 0.2], [0.031, 0.14]] as const) {
      const d = c.createDelay(0.1); d.delayTime.value = dt;
      chain(spk, d, filt(c, 'lowpass', 3200), gain(c, lv), out);
    }
    const fbIn = gain(c, 1), fd = c.createDelay(0.2), fg = gain(c, 0.3);
    fd.delayTime.value = 0.043;
    chain(spk, gain(c, 0.16), fbIn); chain(fbIn, fd, filt(c, 'lowpass', 2400), fg, fbIn); chain(fbIn, gain(c, 0.7), out);
    play(c, base, t0, first);
    if (!arg) click(c, 0.004, 0.04, out); // a speaker coming alive
  } else if (name === 'door') {
    // a voice through a sealed cabin door: nothing above ~1 kHz, the panel itself rings low
    const first = gain(c, 1);
    const thru = chain(first, filt(c, 'highpass', 90, 0.7), filt(c, 'lowpass', 900, 0.8), filt(c, 'lowpass', 900, 0.7),
      filt(c, 'peaking', 150, 2.2, 6), filt(c, 'peaking', 330, 3, 4)) as AudioNode;
    thru.connect(out);
    // resonant thump path: the take excites a 140 Hz panel mode (what you feel through wood)
    chain(first, filt(c, 'bandpass', 140, 5), gain(c, 1.3), out);
    // faint leak under the door: the consonants' top end, tiny and very dull
    chain(first, filt(c, 'bandpass', 1300, 1.2), filt(c, 'lowpass', 1500), gain(c, 0.06), out);
    // the cabin behind: short dead tail
    const d1 = c.createDelay(0.1); d1.delayTime.value = 0.017;
    chain(thru, d1, filt(c, 'lowpass', 700), gain(c, 0.3), out);
    play(c, base, t0, first);
  }
  const rendered = await c.startRendering();
  const chans = Array.from({ length: rendered.numberOfChannels }, (_, i) => rendered.getChannelData(i));
  // keep the take's own level relative to the generator's TARGET_RMS (0.12): a whisper stays quieter
  const inRms = speechRms([base]);
  const rel = inRms > 1e-5 ? Math.max(0.3, Math.min(1.5, inRms / 0.12)) : 1;
  normalise(chans, OUT_RMS * rel * (name === 'door' ? 0.5 : 1));
  return rendered;
}

/** Drop the take's lead-in (manifest `lead`, s: near-silence before the first word) with a 5 ms fade-in. */
export function skipLead(d: Float32Array, lead: number): Float32Array {
  const n = Math.floor(Math.max(0, lead) * FX_SR);
  if (n <= 0 || n >= d.length - FX_SR * 0.1) return d;
  const o = d.slice(n);
  const f = Math.floor(0.005 * FX_SR);
  for (let i = 0; i < f; i++) o[i] *= i / f;
  return o;
}

/** Mono Float32Array at FX_SR (files are 24 kHz mono; resample linearly if a browser decoded otherwise). */
export function monoAt24k(b: AudioBuffer): Float32Array {
  const n = b.numberOfChannels;
  let d: Float32Array = b.getChannelData(0);
  if (n > 1) {
    const m = new Float32Array(b.length);
    for (let ch = 0; ch < n; ch++) { const x = b.getChannelData(ch); for (let i = 0; i < m.length; i++) m[i] += x[i] / n; }
    d = m;
  }
  if (b.sampleRate === FX_SR) return d;
  const r = b.sampleRate / FX_SR, len = Math.floor(b.length / r), o = new Float32Array(len);
  for (let i = 0; i < len; i++) { const p = i * r, i0 = Math.floor(p), f = p - i0; o[i] = d[i0] * (1 - f) + d[Math.min(d.length - 1, i0 + 1)] * f; }
  return o;
}
