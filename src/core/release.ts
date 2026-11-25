/**
 * Phones: free the page's big memory at once when it is left.
 *
 * Every level change / restart reloads the page, and iOS Safari boots the new page in the same WebContent process.
 * The old page's objects are then garbage in JavaScriptCore's old generation: only a full collection frees them, and
 * that comes late — measured in WebKit, a reload of level 5 kept ~420 MB of the old page and peaked ~750 MB higher
 * than a fresh boot, and the phone kills the tab. Typed arrays, audio buffers and canvases can be freed without a
 * collection (an ArrayBuffer detached by `transfer(0)` and a canvas resized to 0 × 0 release their memory at once), so
 * audio buffers and canvases are registered as they are made (weakly, garbage still waiting for a collection included),
 * geometry and texture data are found through the scene, and all of it is released on `pagehide`.
 */
import type * as THREE from 'three';

const MIN_BYTES = 64 * 1024;
const refs: WeakRef<object>[] = [];
let tracking = false;

function keep(o: object): void {
  refs.push(new WeakRef(o));
  // drop dead entries now and then so the list stays small
  if (refs.length % 4096 === 0) {
    let w = 0;
    for (const r of refs) if (r.deref()) refs[w++] = r;
    refs.length = w;
  }
}

/**
 * Start registering big audio buffers and canvases (typed arrays are not wrapped: replacing their constructors would
 * break `array.constructor === Float32Array` checks in three.js; geometry is found through the scene instead).
 */
export function trackBigAllocations(): void {
  if (tracking || typeof WeakRef === 'undefined' || !('transfer' in ArrayBuffer.prototype)) return;
  tracking = true;
  const B = (globalThis as { BaseAudioContext?: typeof BaseAudioContext }).BaseAudioContext;
  if (B) {
    const create = B.prototype.createBuffer;
    B.prototype.createBuffer = function (this: BaseAudioContext, ch: number, len: number, sr: number) {
      const b = create.call(this, ch, len, sr);
      if (ch * len * 4 >= MIN_BYTES) keep(b);
      return b;
    };
  }
  if (typeof AudioBuffer !== 'undefined') {
    const AB = AudioBuffer;
    (globalThis as unknown as { AudioBuffer: unknown }).AudioBuffer = new Proxy(AB, {
      construct(t, args, nt) {
        const b = Reflect.construct(t, args, nt) as AudioBuffer;
        if (b.length * b.numberOfChannels * 4 >= MIN_BYTES) keep(b);
        return b;
      },
    });
  }
  // the sound bank: synthesised sounds come out of OfflineAudioContext renders
  const O = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (O) {
    const render = O.prototype.startRendering;
    O.prototype.startRendering = function (this: OfflineAudioContext) {
      return render.call(this).then((b) => { if (b.length * b.numberOfChannels * 4 >= MIN_BYTES) keep(b); return b; });
    };
  }
  // canvases are sized after they are made: register them when the height is set (width × height is then known)
  const hd = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
  if (hd?.set && hd.get) {
    const set = hd.set, get = hd.get;
    Object.defineProperty(HTMLCanvasElement.prototype, 'height', {
      configurable: true, enumerable: hd.enumerable,
      get() { return get.call(this); },
      set(v: number) { set.call(this, v); if (this.width * v * 4 >= MIN_BYTES) keep(this); },
    });
  }
}

type Detachable = ArrayBuffer & { transfer(len: number): ArrayBuffer };

/** Free everything registered plus the scene's geometry / texture data. The page is unusable afterwards. */
export function releaseBigAllocations(scene?: THREE.Object3D): number {
  let n = 0;
  const seen = new Set<ArrayBuffer>();
  const detach = (a: unknown) => {
    const buf = (a as { buffer?: unknown } | null)?.buffer ?? a;
    if (!(buf instanceof ArrayBuffer) || seen.has(buf) || buf.byteLength < 4096) return;
    seen.add(buf);
    try { n += buf.byteLength; (buf as Detachable).transfer(0); } catch { /* not detachable */ }
  };
  scene?.traverse((o) => {
    const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (geo) {
      for (const at of Object.values(geo.attributes)) detach((at as THREE.BufferAttribute).array ?? (at as THREE.InterleavedBufferAttribute).data?.array);
      if (geo.index) detach(geo.index.array);
      const bvh = (geo as { boundsTree?: { _roots?: ArrayBuffer[] } }).boundsTree;
      for (const r of bvh?._roots ?? []) detach(r);
    }
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      for (const v of Object.values(m)) {
        const im = ((v as THREE.Texture | null)?.isTexture ? (v as THREE.Texture).image : null) as { data?: unknown } | HTMLCanvasElement | null;
        if (im && 'data' in im && im.data) detach(im.data);
        else if (im instanceof HTMLCanvasElement) { n += im.width * im.height * 4; im.width = 0; im.height = 0; }
      }
    }
  });
  for (const r of refs) {
    const o = r.deref();
    if (!o) continue;
    try {
      if (o instanceof HTMLCanvasElement) { n += o.width * o.height * 4; o.width = 0; o.height = 0; }
      else if (typeof AudioBuffer !== 'undefined' && o instanceof AudioBuffer) {
        for (let c = 0; c < o.numberOfChannels; c++) detach(o.getChannelData(c));
      }
    } catch { /* already gone: leave it to the collector */ }
  }
  refs.length = 0;
  return n;
}
