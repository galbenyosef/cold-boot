/**
 * Phones: synthesised sounds kept in IndexedDB between page loads.
 *
 * Every level change / restart reloads the page, and a phone spends seconds (and a few hundred MB of transient
 * buffers) synthesising the same sounds again. A stored sound is 16-bit PCM per variation and channel; reading it back
 * is a copy, not a synthesis.
 *
 * Key: build id (a new deploy / dev server start invalidates everything) | sample rate | sound id | a hash of the
 * sound's own render / post code and shape (an edited sound re-renders within the same dev session). Entries of other
 * builds are deleted a while after boot.
 */
import { SR, hashStr, type SoundDef } from './core';

declare const __BUILD_ID__: string;
const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const DB = 'cb-sounds';
const STORE = 'pcm';

interface Entry { sr: number; vars: ArrayBuffer[][] }

let enabled = false;
let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (!dbp) {
    dbp = new Promise((res) => {
      try {
        const rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = () => { rq.result.createObjectStore(STORE); };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(null);
        rq.onblocked = () => res(null);
      } catch { res(null); }
    });
  }
  return dbp;
}

const prefix = () => `${BUILD}|${SR}|`;

function keyOf(def: SoundDef): string {
  const shape = [def.variants, def.dur, def.channels ?? 1, def.loop ? 1 : 0, def.peak ?? ''].join(',');
  return prefix() + def.id + '|' + hashStr(String(def.render) + String(def.post ?? '') + shape).toString(36);
}

function get(db: IDBDatabase, key: string): Promise<Entry | undefined> {
  return new Promise((res) => {
    try {
      const rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      rq.onsuccess = () => res(rq.result as Entry | undefined);
      rq.onerror = () => res(undefined);
    } catch { res(undefined); }
  });
}

function put(db: IDBDatabase, key: string, e: Entry): void {
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(e, key); } catch { /* quota / closed: skip */ }
}

function toPcm(b: AudioBuffer): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c), q = new Int16Array(d.length);
    for (let i = 0; i < d.length; i++) { const x = d[i]; q[i] = x >= 1 ? 32767 : x <= -1 ? -32767 : Math.round(x * 32767); }
    out.push(q.buffer);
  }
  return out;
}

function fromPcm(chans: ArrayBuffer[], sr: number): AudioBuffer {
  const len = chans[0].byteLength >> 1;
  const b = new AudioBuffer({ length: Math.max(1, len), sampleRate: sr, numberOfChannels: chans.length });
  for (let c = 0; c < chans.length; c++) {
    const q = new Int16Array(chans[c]), d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = q[i] * (1 / 32767);
  }
  return b;
}

/** Turn the cache on (phones). Also drops other builds' entries once the game has settled. */
export function enableSoundCache(): void {
  if (enabled || typeof indexedDB === 'undefined') return;
  enabled = true;
  setTimeout(() => { void prune(); }, 90_000);
}

/** `render(def)` through the cache: a stored copy when there is one, else render and store. */
export async function cachedRender(def: SoundDef, render: (d: SoundDef) => Promise<AudioBuffer[]>): Promise<AudioBuffer[]> {
  if (!enabled) return render(def);
  const db = await open();
  if (!db) return render(def);
  const key = keyOf(def);
  const hit = await get(db, key);
  if (hit && hit.sr === SR && hit.vars.length === def.variants) {
    try { return hit.vars.map((ch) => fromPcm(ch, hit.sr)); } catch { /* corrupt: render */ }
  }
  const bufs = await render(def);
  put(db, key, { sr: SR, vars: bufs.map(toPcm) });
  return bufs;
}

async function prune(): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const keep = prefix();
    const st = db.transaction(STORE, 'readwrite').objectStore(STORE);
    const rq = st.openKeyCursor();
    rq.onsuccess = () => {
      const c = rq.result;
      if (!c) return;
      if (!String(c.key).startsWith(keep)) st.delete(c.key);
      c.continue();
    };
  } catch { /* ignore */ }
}
