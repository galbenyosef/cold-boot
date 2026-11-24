import { SR, Synth, hashStr, mulberry, type SoundDef } from './core';

const GAP = 0.05;
const LOOP_XF = 0.6;

/** Render every variation of a def in one OfflineAudioContext (variations laid out sequentially). */
export async function renderDef(def: SoundDef): Promise<AudioBuffer[]> {
  const ch = def.channels ?? 1;
  const xf = def.loop ? Math.min(LOOP_XF, def.dur * 0.25) : 0;
  const per = def.dur + xf + GAP;
  const n = def.variants;
  const oc = new OfflineAudioContext(ch, Math.ceil(per * n * SR), SR);
  const s = new Synth(oc);
  for (let v = 0; v < n; v++) {
    s.t0 = v * per;
    s.rnd = mulberry(hashStr(def.id) + v * 7919);
    try {
      def.render(s, v);
    } catch (e) {
      console.warn(`[audio] render of ${def.id}#${v} failed`, e);
    }
  }
  const rendered = await oc.startRendering();
  const out: AudioBuffer[] = [];
  for (let v = 0; v < n; v++) {
    const start = Math.floor(v * per * SR);
    const len = Math.floor((def.dur + xf) * SR);
    const chans: Float32Array[] = [];
    // views, not copies: `finish` edits them in place and copies the result into the final buffer, and the
    // rendered buffer is garbage right after (a phone tab cannot afford two transient copies per sound)
    for (let c = 0; c < ch; c++) chans.push(rendered.getChannelData(c).subarray(start, start + len));
    out.push(finish(def, chans, xf, mulberry(hashStr(def.id) * 31 + v), v));
  }
  return out;
}

/** Post-process: NaN guard, custom post, DC removal, loop fold / tail trim, fades, normalisation. */
export function finish(def: SoundDef, chans: Float32Array[], xf: number, rnd: () => number, v: number): AudioBuffer {
  let bad = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) { d[i] = 0; bad++; }
  if (bad) console.warn(`[audio] ${def.id}#${v}: ${bad} non-finite samples zeroed`);
  if (def.post) def.post(chans, rnd, v);
  // DC blocker (one-pole HP ~ 8 Hz)
  const R = 1 - (2 * Math.PI * 8) / SR;
  for (const d of chans) {
    let x1 = 0, y1 = 0;
    for (let i = 0; i < d.length; i++) { const x = d[i]; const y = x - x1 + R * y1; x1 = x; y1 = y; d[i] = y; }
  }
  let len = chans[0].length;
  if (def.loop) {
    // fold the extra tail into the head → seamless loop. Linear crossfade: exact for periodic content
    // (hums rendered with integer cycles per loop), only a shallow dip for noise beds.
    const L = len - Math.floor(xf * SR);
    const X = len - L;
    for (const d of chans) {
      for (let i = 0; i < X; i++) {
        const a = i / X;
        d[i] = d[i] * a + d[L + i] * (1 - a);
      }
    }
    len = L;
  } else {
    // trim trailing near-silence (keeps buffers short), then 4 ms fade-out
    let pk = 0;
    for (const d of chans) for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    const thr = Math.max(pk * 0.0004, 1e-6);
    let last = 0;
    for (const d of chans) for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) > thr) { last = i; break; }
    len = Math.min(len, last + Math.floor(0.01 * SR));
    const fade = Math.min(Math.floor(0.004 * SR), len);
    for (const d of chans) for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  }
  len = Math.max(len, 32);
  const peakT = def.peak ?? 0.9;
  let pk = 0;
  for (const d of chans) for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]));
  const k = peakT > 0 && pk > 1e-6 ? peakT / pk : 1;
  const buf = new AudioBuffer({ length: len, sampleRate: SR, numberOfChannels: chans.length });
  for (let c = 0; c < chans.length; c++) {
    const d = chans[c].subarray(0, len);
    if (k !== 1) for (let i = 0; i < len; i++) d[i] *= k;
    buf.copyToChannel(d as Float32Array<ArrayBuffer>, c);
  }
  return buf;
}

/** Renders defs with bounded concurrency. Returns total ms. */
export async function renderMany(defs: SoundDef[], onDone: (def: SoundDef, bufs: AudioBuffer[]) => void, concurrency = 6): Promise<number> {
  const t0 = performance.now();
  let i = 0;
  const worker = async () => {
    while (i < defs.length) {
      const d = defs[i++];
      try { onDone(d, await renderDef(d)); } catch (e) { console.warn(`[audio] failed to render ${d.id}`, e); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, defs.length) }, worker));
  return performance.now() - t0;
}
