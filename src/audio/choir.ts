/**
 * CHOIR voice: many layered formant voices speaking the cadence of `text` (no words — subtitles carry
 * them). Rendered offline per line (~tens of ms), then played on the voice bus through the plate.
 */
import { Synth, hashStr, mulberry } from './synth/core';
import { buildConsonants, buildVoice, planText } from './synth/formant';
import { decimate, dropouts, stutter } from './synth/post';

export async function renderChoir(text: string, duration: number, seed = hashStr(text)): Promise<AudioBuffer> {
  const rnd = mulberry(seed);
  const plan = planText(text, duration, rnd);
  const len = plan.length + 0.9;
  // 24 kHz is plenty for a band-limited PA voice (lp 8.5 kHz) and halves the render latency
  const CSR = 24000;
  const oc = new OfflineAudioContext(2, Math.ceil(len * CSR), CSR);
  const s = new Synth(oc);
  s.rnd = rnd;
  s.t0 = 0.25; // PA switch-on lead-in

  // ── output chain: mix → (dry | ring-mod | bit-crush) → PA band → multi-speaker delays → out
  const mix = s.gain(1);
  const dry = s.gain(1);
  const ring = s.gain(0);
  const ringAmt = s.gain(0);
  const crushAmt = s.gain(0);
  const carrier = s.osc('sine', s.r(38, 70), -0.25, len);
  const carG = s.gain(1);
  carrier.connect(carG); carG.connect(ring.gain);
  mix.connect(dry); mix.connect(ring); ring.connect(ringAmt);
  s.chain(mix, s.shaper('crush', 4), crushAmt);
  const pa = s.gain(1);
  dry.connect(pa); ringAmt.connect(pa); crushAmt.connect(pa);
  const band = s.chain(pa, s.hp(75), s.pk(2400, 1.1, 4), s.pk(180, 0.8, 2), s.lp(8500)) as AudioNode;
  const outG = s.gain(1);
  band.connect(outG); outG.connect(s.out);
  // "every speaker at once": a few delayed, panned, band-limited copies
  for (const [dt, lv, p, lpF] of [[0.013, 0.32, -0.7, 5000], [0.029, 0.26, 0.75, 4200], [0.047, 0.18, -0.25, 3200], [0.071, 0.12, 0.4, 2500]] as const) {
    s.chain(band, s.delay(dt), s.lp(lpF), s.gain(lv), s.pan(p), s.out);
  }

  // glitch windows: ring-mod and crush take over the dry path briefly
  const glitches = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < glitches; i++) {
    const t = rnd() * plan.length;
    const d = 0.06 + rnd() * 0.2;
    const which = rnd() < 0.5 ? ringAmt : crushAmt;
    which.gain.setTargetAtTime(0.9, s.at(t), 0.005);
    which.gain.setTargetAtTime(0, s.at(t + d), 0.01);
    dry.gain.setTargetAtTime(0.25, s.at(t), 0.005);
    dry.gain.setTargetAtTime(1, s.at(t + d), 0.01);
  }

  // ── the voices
  const voices = [
    { f0: 82.4, fscale: 0.94, level: 0.9, delay: 0, pan: -0.25, breath: 0.08, vib: 0.006 },
    { f0: 123.5, fscale: 1.0, level: 0.55, delay: 0.018, pan: 0.3, breath: 0.12, vib: 0.007 },
    { f0: 329.6 * Math.pow(2, -14 / 1200), fscale: 1.38, level: 0.3, delay: 0.034, pan: 0.1, breath: 0.2, vib: 0.009 },
    { f0: 41.2, fscale: 0.8, level: 0.42, delay: 0.008, pan: 0, breath: 0, vib: 0.003 },
    { f0: 100, fscale: 1.1, level: 0.5, delay: 0.026, pan: -0.1, breath: 1, vib: 0 },
  ];
  for (const v of voices) {
    const p = s.pan(v.pan);
    p.connect(mix);
    buildVoice(s, plan, { f0: v.f0, fscale: v.fscale, level: v.level, delay: v.delay, jitter: 0.012, contour: 2.5, style: 'calm', vibrato: v.vib, breath: v.breath, dst: p });
  }
  buildConsonants(s, plan, 0.35, mix, 0.01);

  // PA: switch-on thump + faint mains hum under the whole line + switch-off click
  s.t0 = 0;
  s.click(0.02, 0.25, 250, 0.004, s.out);
  s.thump(0.02, 110, 55, 0.03, 0.04, 0.2, s.out);
  const humG = s.gain(0);
  humG.gain.setValueAtTime(0, 0);
  humG.gain.setTargetAtTime(0.012, 0.03, 0.05);
  humG.gain.setTargetAtTime(0, len - 0.4, 0.06);
  s.chain(s.osc('sine', 60, 0, len), humG, s.out);
  const hum2 = s.gain(0);
  hum2.gain.setValueAtTime(0, 0);
  hum2.gain.setTargetAtTime(0.004, 0.03, 0.05);
  hum2.gain.setTargetAtTime(0, len - 0.4, 0.06);
  s.chain(s.osc('sawtooth', 120, 0, len), s.bp(1200, 2), hum2, s.out);
  s.click(len - 0.35, 0.08, 400, 0.003, s.out);

  const rendered = await oc.startRendering();
  const chans = [rendered.getChannelData(0), rendered.getChannelData(1)];
  stutter(chans, rnd, 1 + Math.floor(rnd() * 2), 25, 60, 0.15, 0.85);
  decimate(chans, rnd, 1 + Math.floor(rnd() * 2), 50, 140, 6, 6);
  dropouts(chans, rnd, 1);
  let pk = 0, bad = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) { if (!Number.isFinite(d[i])) { d[i] = 0; bad++; } pk = Math.max(pk, Math.abs(d[i])); }
  if (bad) console.warn('[audio] choir: non-finite samples zeroed', bad);
  const k = pk > 1e-6 ? 0.85 / pk : 1;
  for (const d of chans) for (let i = 0; i < d.length; i++) d[i] *= k;
  return rendered;
}
