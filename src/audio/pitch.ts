/**
 * Pure-DSP pitch shifting for the voice chains (no Web Audio, no DOM): runs on the main thread or in
 * `pitch.worker.ts`. Moved out of voicefx.ts so the CHOIR layers can be shifted off the main thread — on a phone
 * the WSOLA loops cost seconds per line and froze the game right after boot.
 */
export const FX_SR = 24000;

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
