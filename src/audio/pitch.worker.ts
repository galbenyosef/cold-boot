/** Off-main-thread pitch shifting for the voice chains (see pitch.ts / pitchpool.ts). */
import { pitchShift } from './pitch';

self.onmessage = (e: MessageEvent<{ id: number; x: Float32Array; st: number }>) => {
  const { id, x, st } = e.data;
  const y = pitchShift(x, st).slice(); // own buffer (wsola returns a view)
  (self as unknown as Worker).postMessage({ id, y }, [y.buffer]);
};
