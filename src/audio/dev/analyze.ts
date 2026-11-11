/** Signal analysis + drawing helpers for the audio harness. */

export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

const N = 2048;
const hann = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));

/** Magnitude spectrum (power) of a frame starting at `at` (mono mixdown). */
export function powerSpectrum(x: Float32Array, at: number): Float64Array {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[at + i] ?? 0) * hann[i];
  fft(re, im);
  const p = new Float64Array(N / 2);
  const norm = 1 / (512 * 512); // (sum of hann / 2)^2 → full-scale sine ≈ 0 dB
  for (let i = 0; i < N / 2; i++) p[i] = (re[i] * re[i] + im[i] * im[i]) * norm;
  return p;
}

export function mono(chans: Float32Array[]): Float32Array {
  if (chans.length === 1) return chans[0];
  const out = new Float32Array(chans[0].length);
  for (const c of chans) for (let i = 0; i < out.length; i++) out[i] += c[i] / chans.length;
  return out;
}

export const BANDS: Array<[string, number, number]> = [
  ['sub', 0, 60], ['low', 60, 150], ['lowmid', 150, 500], ['mid', 500, 1000], ['upmid', 1000, 6000], ['high', 6000, 24000],
];

export interface Stats {
  dur: number; peak: number; peakDb: number; rmsDb: number; dc: number; clip: number; nan: number; silent: boolean;
  attackMs: number; tailMs: number; centroid: number; bands: Record<string, number>;
}

export function stats(chans: Float32Array[], sr: number, from = 0, to = -1): Stats {
  const x0 = mono(chans);
  const x = to < 0 ? x0.subarray(from) : x0.subarray(from, to);
  let peak = 0, sum = 0, sq = 0, clip = 0, nan = 0, peakAt = 0;
  for (const c of chans) for (let i = from; i < (to < 0 ? c.length : to); i++) {
    const v = c[i];
    if (!Number.isFinite(v)) { nan++; continue; }
    const a = Math.abs(v);
    if (a >= 0.999) clip++;
  }
  for (let i = 0; i < x.length; i++) {
    const v = x[i]; if (!Number.isFinite(v)) continue;
    sum += v; sq += v * v;
    const a = Math.abs(v); if (a > peak) { peak = a; peakAt = i; }
  }
  const n = Math.max(1, x.length);
  // attack: from first sample > 5% of peak to first > 90% of peak
  let on = 0; while (on < x.length && Math.abs(x[on]) < peak * 0.05) on++;
  let p90 = on; while (p90 < x.length && Math.abs(x[p90]) < peak * 0.9) p90++;
  // tail: windowed RMS after the peak until 40 dB below the peak window
  const W = Math.floor(sr * 0.01);
  let pkWin = 0;
  for (let i = 0; i + W <= x.length; i += W) { let e = 0; for (let k = 0; k < W; k++) e += x[i + k] * x[i + k]; pkWin = Math.max(pkWin, e / W); }
  let tailEnd = peakAt;
  for (let i = Math.floor(peakAt / W) * W; i + W <= x.length; i += W) {
    let e = 0; for (let k = 0; k < W; k++) e += x[i + k] * x[i + k];
    if (e / W > pkWin * 1e-4) tailEnd = i + W;
  }
  // spectrum over frames
  const bandE: Record<string, number> = {};
  for (const [b] of BANDS) bandE[b] = 0;
  let tot = 0, cen = 0;
  const hop = Math.max(512, Math.floor((x.length - N) / 60));
  for (let at = 0; at + N <= x.length || at === 0; at += hop) {
    const p = powerSpectrum(x, at);
    for (let i = 1; i < p.length; i++) {
      const f = (i * sr) / N;
      tot += p[i]; cen += p[i] * f;
      for (const [b, lo, hi] of BANDS) if (f >= lo && f < hi) { bandE[b] += p[i]; break; }
    }
    if (at + N > x.length) break;
  }
  for (const k in bandE) bandE[k] = +(bandE[k] / (tot || 1)).toFixed(3);
  return {
    dur: +(x.length / sr).toFixed(3), peak: +peak.toFixed(3), peakDb: +(20 * Math.log10(peak || 1e-9)).toFixed(1),
    rmsDb: +(10 * Math.log10(sq / n || 1e-12)).toFixed(1), dc: +(sum / n).toFixed(5), clip, nan, silent: peak < 1e-4,
    attackMs: +(((p90 - on) / sr) * 1000).toFixed(2), tailMs: +(((tailEnd - peakAt) / sr) * 1000).toFixed(0),
    centroid: Math.round(cen / (tot || 1)), bands: bandE,
  };
}

/** Spectrogram (log freq 30 Hz–18 kHz) + waveform envelope. */
export function draw(cv: HTMLCanvasElement, chans: Float32Array[], sr: number, marks: number[] = []): void {
  const x = mono(chans);
  const W = cv.width, H = cv.height;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(W, H);
  const lo = Math.log(30), hi = Math.log(18000);
  for (let col = 0; col < W; col++) {
    const at = Math.floor((col / W) * Math.max(1, x.length - N));
    const p = powerSpectrum(x, at);
    for (let row = 0; row < H; row++) {
      const f = Math.exp(lo + ((H - 1 - row) / (H - 1)) * (hi - lo));
      const bin = Math.min(p.length - 1, Math.round((f * N) / sr));
      const db = 10 * Math.log10(p[bin] + 1e-12);
      const v = Math.max(0, Math.min(1, (db + 95) / 85));
      const o = (row * W + col) * 4;
      img.data[o] = Math.floor(255 * Math.min(1, v * 1.6));
      img.data[o + 1] = Math.floor(255 * Math.max(0, v - 0.35) * 1.4);
      img.data[o + 2] = Math.floor(255 * Math.max(0, v * 0.6 - 0.1) + 40 * v);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // waveform envelope
  g.strokeStyle = 'rgba(80,230,255,0.85)';
  g.beginPath();
  const per = x.length / W;
  for (let col = 0; col < W; col++) {
    let m = 0;
    for (let i = Math.floor(col * per); i < Math.floor((col + 1) * per); i++) m = Math.max(m, Math.abs(x[i] ?? 0));
    const y = H - 2 - m * (H - 4);
    if (col) g.lineTo(col, y); else g.moveTo(col, y);
  }
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.5)';
  for (const t of marks) g.fillRect(Math.floor((t * sr / x.length) * W), 0, 1, H);
}
