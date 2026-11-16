/**
 * Unit voices (REVISION 4). The units' mutters are recorded staff lines played through `ctx.audio.say` (the audio
 * module applies the unit treatment from the line's speaker/fx). Line ids come from `voice/lines.l<N>.json`
 * (written by the story) and only lines present in `voice/manifest.json` (i.e. actually generated) are used.
 * Both files are bundled at build time (no runtime request). When `say`, the lines or the files are missing,
 * callers fall back to the procedural `husk_whisper`.
 */
import type * as THREE from 'three';
import type { GameContext, VoiceHandle } from '../core/types';
import { levelOf } from '../core/progress';

interface Line { id: string; speaker?: string; text?: string; fx?: string; note?: string }

const LINE_FILES = import.meta.glob('../../voice/lines.l*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const MANIFEST = import.meta.glob('../../voice/manifest.json', { eager: true, import: 'default' }) as Record<string, unknown>;

/** Lines reserved for scripted moments — never used as random mutters. */
const RESERVED = /unit32|unit_32|unit14|unit_14|foreman|tomas_joke/i;

let cache: { level: number; mutter: Line[]; foreman: Line[] } | null = null;

function load(level: number): { mutter: Line[]; foreman: Line[] } {
  if (cache && cache.level === level) return cache;
  const lines: Line[] = [];
  for (const [path, data] of Object.entries(LINE_FILES)) {
    if (!path.endsWith(`lines.l${level}.json`)) continue;
    const arr = Array.isArray(data) ? data : Array.isArray((data as any)?.lines) ? (data as any).lines : [];
    for (const l of arr) if (l && typeof l.id === 'string') lines.push(l as Line);
  }
  const man = Object.values(MANIFEST)[0] as any;
  const have = (id: string): boolean => {
    if (!man) return false;
    if (Array.isArray(man)) return man.some((e: any) => e?.id === id);
    const m = man.lines ?? man;
    return !!m[id];
  };
  const unit = lines.filter((l) => (l.speaker === 'unit' || l.fx === 'unit') && l.speaker !== 'tomas' && l.speaker !== 'choir' && have(l.id));
  const mutter = unit.filter((l) => !RESERVED.test(l.id));
  // foreman: its own lines if the story wrote some, else staff-voiced mutters
  let foreman = unit.filter((l) => /foreman/i.test(l.id));
  if (foreman.length < 3) foreman = foreman.concat(mutter);
  cache = { level, mutter, foreman };
  return cache;
}

/** True when recorded unit mutters can be played on this level. */
export function hasUnitVoices(ctx: GameContext): boolean {
  return typeof (ctx.audio as any)?.say === 'function' && load(levelOf(ctx).id).mutter.length > 0;
}

let lastIdx = -1;
/** Play one random unit mutter at `pos`. Returns the handle (duration known) or null → caller falls back. */
export function sayMutter(ctx: GameContext, pos: THREE.Vector3, rand: () => number): VoiceHandle | null {
  if (typeof (ctx.audio as any)?.say !== 'function') return null;
  const { mutter } = load(levelOf(ctx).id);
  if (mutter.length === 0) return null;
  let i = Math.floor(rand() * mutter.length);
  if (i === lastIdx && mutter.length > 1) i = (i + 1) % mutter.length;
  lastIdx = i;
  try { return ctx.audio.say(mutter[i].id, { position: pos }); } catch { return null; }
}

/**
 * Three different staff lines, one per position, deliberately out of sync (foreman). Returns the handles
 * (possibly fewer than three; empty when no recorded lines → caller falls back).
 */
export function sayChorus(ctx: GameContext, positions: THREE.Vector3[], rand: () => number, delays = [0, 0.32, 0.77]): { handle: Promise<VoiceHandle | null>; index: number }[] {
  if (typeof (ctx.audio as any)?.say !== 'function') return [];
  const { foreman } = load(levelOf(ctx).id);
  if (foreman.length === 0) return [];
  // prefer three different speakers
  const pool = foreman.slice();
  const picks: Line[] = [];
  const used = new Set<string>();
  for (let tries = 0; tries < 24 && picks.length < positions.length && pool.length > 0; tries++) {
    const k = Math.floor(rand() * pool.length);
    const l = pool[k];
    if (used.has(l.speaker ?? l.id) && tries < 16) continue;
    used.add(l.speaker ?? l.id);
    picks.push(l);
    pool.splice(k, 1);
  }
  return picks.map((l, i) => ({
    index: i,
    handle: new Promise<VoiceHandle | null>((resolve) => {
      setTimeout(() => {
        try { resolve(ctx.audio.say(l.id, { position: positions[i] })); } catch { resolve(null); }
      }, (delays[i] ?? i * 0.4) * 1000);
    }),
  }));
}
