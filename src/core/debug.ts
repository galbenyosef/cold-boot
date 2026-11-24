import * as THREE from 'three';
import type { DebugFlags, LevelId, Quality } from './types';
import { parseLevel } from './progress';

/**
 * Stage 3b §8.1 (tests only): `?next=3:4[,4:5]` → `{ 3: 4, 4: 5 }` (each side a level id, `parseLevel` rules);
 * malformed pairs are ignored; nothing valid → null. Read only through `nextOf()` (core/progress.ts).
 */
export function parseNext(raw: string | null): DebugFlags['next'] {
  if (!raw) return null;
  const out: Partial<Record<LevelId, LevelId>> = {};
  let any = false;
  for (const pair of raw.split(',')) {
    const [a, b, extra] = pair.split(':');
    if (extra !== undefined) continue;
    const from = parseLevel(a), to = parseLevel(b);
    if (from === null || to === null) continue;
    out[from] = to;
    any = true;
  }
  return any ? out : null;
}

export function parseDebug(): DebugFlags {
  const q = new URLSearchParams(location.search);
  const on = (k: string) => q.has(k) && q.get(k) !== '0';
  let spawn: DebugFlags['spawn'] = null;
  if (q.has('spawn')) {
    const n = q.get('spawn')!.split(',').map(Number);
    if (n.length >= 3 && n.every((v) => Number.isFinite(v))) {
      spawn = {
        position: new THREE.Vector3(n[0], n[1], n[2]),
        yaw: THREE.MathUtils.degToRad(n[3] ?? 0),
        pitch: THREE.MathUtils.degToRad(n[4] ?? 0),
      };
    }
  }
  const quality = q.get('quality');
  const mobile = q.has('mobile') ? on('mobile') : detectMobile();
  return {
    mobile,
    autostart: on('autostart'),
    spawn,
    noEnemies: on('noenemies'),
    noStory: on('nostory'),
    god: on('god'),
    giveAll: q.get('give') === 'all',
    quality: (['low', 'medium', 'high', 'ultra'] as const).includes(quality as Quality) ? (quality as Quality) : null,
    verbose: on('debug'),
    // §8.1: 1…6 parse (main.ts clamps an unbuilt level to the highest built one); anything else = stored level
    level: parseLevel(q.get('level')),
    choice: q.get('choice') === 'stop' || q.get('choice') === 'command' ? (q.get('choice') as 'stop' | 'command') : null,
    units: /^\d+$/.test(q.get('units') ?? '') ? Math.min(32, Number(q.get('units'))) : null,
    next: parseNext(q.get('next')),
    // stage 3c H10: a test sets it on __game.debug before using the keypad (never from the URL)
    keypadInput: null,
    fps: 0,
  };
}

/** Phone or tablet: iOS / Android user agents, iPadOS (reports itself as a Mac with touch), or a touch-only pointer. */
function detectMobile(): boolean {
  try {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
    return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  } catch { return false; }
}
