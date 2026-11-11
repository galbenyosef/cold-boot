/**
 * Keyframed pose tracks. A track is a list of keys [t, v0, v1, ...] sampled with Catmull-Rom style
 * cubic Hermite interpolation (smooth velocity through keys, clamped at the ends).
 * Clip events fire when playback time crosses them.
 */
export type Track = number[][];
export interface Clip {
  name: string;
  dur: number;
  tracks: Record<string, Track>;
  events?: [number, string][];
  /** Finger pose keys per hand: [time, poseName] — blended smoothly between consecutive keys. */
  poses?: { lh?: PoseKeys; rh?: PoseKeys };
}
export type PoseKeys = [number, string][];

/** Blend the named poses around time `t` into `out` (smoothstep between keys, clamped at the ends). */
export function samplePoseKeys(keys: PoseKeys, t: number, table: Record<string, number[]>, out: number[]) {
  let k = 0;
  while (k < keys.length - 1 && t > keys[k + 1][0]) k++;
  const a = table[keys[k][1]];
  if (k >= keys.length - 1 || t <= keys[k][0]) { for (let i = 0; i < out.length; i++) out[i] = a[i]; return; }
  const b = table[keys[k + 1][1]];
  let u = (t - keys[k][0]) / (keys[k + 1][0] - keys[k][0]);
  u = u * u * (3 - 2 * u);
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * u;
}

export function sampleTrack(tr: Track, t: number, out: number[]): number[] {
  const n = tr.length;
  const w = tr[0].length - 1;
  if (t <= tr[0][0]) { for (let i = 0; i < w; i++) out[i] = tr[0][i + 1]; return out; }
  if (t >= tr[n - 1][0]) { for (let i = 0; i < w; i++) out[i] = tr[n - 1][i + 1]; return out; }
  let k = 0;
  while (k < n - 2 && t > tr[k + 1][0]) k++;
  const a = tr[k], b = tr[k + 1];
  const p = k > 0 ? tr[k - 1] : a, q = k + 2 < n ? tr[k + 2] : b;
  const h = b[0] - a[0];
  const u = (t - a[0]) / h;
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  for (let i = 1; i <= w; i++) {
    // tangents scaled to this segment's duration (non-uniform Catmull-Rom); flat at clip ends
    const m0 = k > 0 ? ((b[i] - p[i]) / (b[0] - p[0])) * h : 0;
    const m1 = k + 2 < n ? ((q[i] - a[i]) / (q[0] - a[0])) * h : 0;
    out[i - 1] = h00 * a[i] + h10 * m0 + h01 * b[i] + h11 * m1;
  }
  return out;
}

export class ClipPlayer {
  clip: Clip | null = null;
  t = 0;
  speed = 1;
  private onEvent: ((id: string) => void) | null = null;
  private onDone: (() => void) | null = null;

  play(clip: Clip, onEvent?: (id: string) => void, onDone?: () => void, startAt = 0) {
    this.clip = clip;
    this.t = startAt;
    this.onEvent = onEvent ?? null;
    this.onDone = onDone ?? null;
  }
  stop() { this.clip = null; this.onEvent = null; this.onDone = null; }
  get playing() { return this.clip !== null; }
  get name() { return this.clip?.name ?? ''; }

  update(dt: number) {
    const c = this.clip;
    if (!c) return;
    const t0 = this.t;
    const t1 = t0 + dt * this.speed;
    this.t = t1;
    if (c.events && this.onEvent) {
      for (const [et, id] of c.events) if (et > t0 && et <= t1) { this.onEvent(id); if (this.clip !== c) return; }
    }
    if (t1 >= c.dur) {
      const done = this.onDone;
      this.clip = null; this.onEvent = null; this.onDone = null;
      done?.();
    }
  }

  /** Sample a channel into `out`; returns false (out untouched) if the clip lacks it or nothing plays. */
  get(name: string, out: number[]): boolean {
    const c = this.clip;
    if (!c) return false;
    const tr = c.tracks[name];
    if (!tr) return false;
    sampleTrack(tr, Math.min(this.t, c.dur), out);
    return true;
  }
}
