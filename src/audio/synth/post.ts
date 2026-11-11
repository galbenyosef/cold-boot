import { SR } from './core';

/** Repeat short chunks (digital stutter). */
export function stutter(chans: Float32Array[], rnd: () => number, count: number, minMs = 20, maxMs = 70, from = 0, to = 1): void {
  const len = chans[0].length;
  for (let k = 0; k < count; k++) {
    const chunk = Math.floor(((minMs + rnd() * (maxMs - minMs)) / 1000) * SR);
    const reps = 2 + Math.floor(rnd() * 3);
    const at = Math.floor((from + rnd() * (to - from)) * (len - chunk * (reps + 1)));
    if (at < 0) continue;
    for (const d of chans) {
      for (let r = 1; r <= reps; r++) {
        for (let i = 0; i < chunk; i++) {
          const dst = at + r * chunk + i;
          if (dst >= len) break;
          // tiny fades at chunk edges avoid clicks
          const e = Math.min(1, i / 64, (chunk - i) / 64);
          d[dst] = d[dst] * (1 - e) + d[at + i] * e;
        }
      }
    }
  }
}

/** Sample-and-hold decimation + bit reduction over random segments. */
export function decimate(chans: Float32Array[], rnd: () => number, count: number, minMs = 40, maxMs = 160, factor = 8, bits = 5): void {
  const len = chans[0].length;
  const q = Math.pow(2, bits - 1);
  for (let k = 0; k < count; k++) {
    const seg = Math.floor(((minMs + rnd() * (maxMs - minMs)) / 1000) * SR);
    const at = Math.floor(rnd() * Math.max(1, len - seg));
    const f = Math.max(2, Math.floor(factor * (0.5 + rnd())));
    for (const d of chans) {
      let hold = 0;
      for (let i = 0; i < seg && at + i < len; i++) {
        if (i % f === 0) hold = Math.round(d[at + i] * q) / q;
        const e = Math.min(1, i / 48, (seg - i) / 48);
        d[at + i] = d[at + i] * (1 - e) + hold * e;
      }
    }
  }
}

/** Short hard dropouts. */
export function dropouts(chans: Float32Array[], rnd: () => number, count: number, minMs = 4, maxMs = 25): void {
  const len = chans[0].length;
  for (let k = 0; k < count; k++) {
    const seg = Math.floor(((minMs + rnd() * (maxMs - minMs)) / 1000) * SR);
    const at = Math.floor(rnd() * Math.max(1, len - seg));
    for (const d of chans) for (let i = 0; i < seg && at + i < len; i++) {
      const e = Math.min(1, i / 24, (seg - i) / 24);
      d[at + i] *= 1 - e;
    }
  }
}

/** Reverse a time range (for reversed swells). */
export function reverse(chans: Float32Array[], from: number, to: number): void {
  const a = Math.floor(from * SR), b = Math.min(chans[0].length, Math.floor(to * SR));
  for (const d of chans) d.subarray(a, b).reverse();
}

/** Soft saturation in-place (input first normalised to peak 1, so `drive` is absolute). */
export function saturate(chans: Float32Array[], drive: number): void {
  let pk = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  if (pk < 1e-9) return;
  const k = drive / pk, n = Math.tanh(drive);
  for (const d of chans) for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * k) / n;
}
