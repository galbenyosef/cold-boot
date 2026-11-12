/**
 * Which level to boot (REVISION 4). One level per page load: finishing level 1 stores level 2 and reloads.
 * Owned by the coordinator. Every storage access is guarded (private mode / disabled storage).
 */
import type { DebugFlags, LevelId } from './types';

export const LEVEL_KEY = 'coldboot.level';

export function storedLevel(): LevelId {
  try { return localStorage.getItem(LEVEL_KEY) === '2' ? 2 : 1; } catch { return 1; }
}

export function setStoredLevel(level: LevelId): void {
  try { localStorage.setItem(LEVEL_KEY, String(level)); } catch { /* ignore */ }
}

/** `?level=` wins; `?nostory=1`/tests without it get the stored level. */
export function resolveLevel(debug: DebugFlags): LevelId {
  return debug.level ?? storedLevel();
}
