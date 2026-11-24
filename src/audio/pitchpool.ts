/**
 * Pitch shifts for the voice chains, computed in a small worker pool (pitch.worker.ts). Falls back to the main thread
 * when workers are unavailable (tests / old browsers) — same result, just blocking.
 */
import { pitchShift } from './pitch';

const POOL = 2;
let workers: Worker[] | null = null;
let failed = false;
let nextId = 1, rr = 0;
const pending = new Map<number, { done: (y: Float32Array) => void; fallback: () => Float32Array }>();

/** A worker failed to load or crashed: stop using the pool and finish what was waiting on the main thread. */
function fail(): void {
  failed = true;
  for (const w of workers ?? []) w.terminate();
  workers = null;
  for (const [id, p] of pending) { pending.delete(id); p.done(p.fallback()); }
}

function pool(): Worker[] | null {
  if (workers || failed) return workers;
  try {
    workers = [];
    for (let i = 0; i < POOL; i++) {
      const w = new Worker(new URL('./pitch.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; y: Float32Array }>) => {
        const p = pending.get(e.data.id);
        pending.delete(e.data.id);
        p?.done(e.data.y);
      };
      w.onerror = (ev) => { ev.preventDefault?.(); console.warn('[audio] pitch worker failed — shifting on the main thread'); fail(); };
      workers.push(w);
    }
  } catch {
    failed = true;
    workers = null;
  }
  return workers;
}

/** `base` shifted by each of `sts` semitones (keys = the semitone values). `base` is not modified or transferred. */
export async function shiftMany(base: Float32Array, sts: readonly number[]): Promise<Map<number, Float32Array>> {
  const out = new Map<number, Float32Array>();
  const ws = pool();
  if (!ws) {
    for (const st of sts) out.set(st, pitchShift(base, st));
    return out;
  }
  await Promise.all(sts.map((st) => new Promise<void>((resolve) => {
    const id = nextId++;
    pending.set(id, { done: (y) => { out.set(st, y); resolve(); }, fallback: () => pitchShift(base, st) });
    ws[rr++ % ws.length].postMessage({ id, x: base, st }); // copied (structured clone), not transferred
  })));
  return out;
}
