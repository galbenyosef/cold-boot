/**
 * What the menu / death / pause screens need to know about stored progress (REVISION 4: two levels).
 *
 * The story owns the save format (`src/story/save.ts`). It exports `saveInfo()` / `clearAllProgress()` for
 * the UI; until a build has them we fall back to what we can read ourselves. Accessed through the module
 * namespace so a missing export is just `undefined` (a named import of a missing export would not link).
 */
import type { GameContext, LevelId } from '../core/types';
import * as save from '../story/save';
import { LEVEL_KEY, setStoredLevel, storedLevel } from '../core/progress';
import { SKIP_INTRO_KEY } from './types';

export interface SaveInfo {
  level: LevelId;
  /** Display name of the checkpoint's room, or null = no checkpoint (CONTINUE starts the level). */
  place: string | null;
}

const L2_SAVE_KEY = 'coldboot.save.l2.v1';
const CARRY_KEY = 'coldboot.carry';

type SaveModule = {
  saveInfo?: () => SaveInfo | null;
  clearAllProgress?: () => void;
  clearSave?: () => void;
  loadSave?: () => { place?: string } | null;
  requestContinue?: () => void;
  requestBegin?: () => void;
};
const S = save as unknown as SaveModule;

function readL2Place(): string | null {
  try {
    const raw = localStorage.getItem(L2_SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && typeof s === 'object' ? (typeof s.place === 'string' ? s.place : '') : null;
  } catch { return null; }
}

/** The stored run: which level CONTINUE resumes and whether a checkpoint exists there. null = nothing to continue. */
export function saveInfo(): SaveInfo | null {
  if (typeof S.saveInfo === 'function') {
    try { return S.saveInfo(); } catch (e) { console.warn('[ui] saveInfo failed', e); }
  }
  const level = storedLevel();
  if (level === 2) return { level: 2, place: readL2Place() };
  let l1: { place?: string } | null = null;
  try { l1 = S.loadSave?.() ?? null; } catch { /* ignore */ }
  return l1 ? { level: 1, place: l1.place ?? '' } : null;
}

/** A checkpoint of THIS page's level exists (LOAD CHECKPOINT on the death / pause screens). */
export function hasCheckpoint(ctx: GameContext): SaveInfo | null {
  const info = saveInfo();
  const level = ctx.levelId ?? 1;
  return info && info.level === level && info.place !== null ? info : null;
}

/** BEGIN: back to level 1, every save / carried loadout gone. */
export function clearAllProgress(): void {
  if (typeof S.clearAllProgress === 'function') {
    try { S.clearAllProgress(); return; } catch (e) { console.warn('[ui] clearAllProgress failed', e); }
  }
  try { S.clearSave?.(); } catch { /* ignore */ }
  for (const k of [L2_SAVE_KEY, CARRY_KEY]) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  setStoredLevel(1);
}

/** Clear only this level's checkpoint (RESTART LEVEL); level 2 keeps its carried loadout. */
export function clearLevelSave(ctx: GameContext): void {
  if ((ctx.levelId ?? 1) === 2) { try { localStorage.removeItem(L2_SAVE_KEY); } catch { /* ignore */ } }
  else { try { S.clearSave?.(); } catch { /* ignore */ } }
}

/** Reload the page into `level` (drops a forcing `?level=` so the stored level wins). */
export function reloadInto(level: LevelId | null, skipIntro = false): void {
  if (level) { try { localStorage.setItem(LEVEL_KEY, String(level)); } catch { /* ignore */ } }
  if (skipIntro) { try { sessionStorage.setItem(SKIP_INTRO_KEY, '1'); } catch { /* ignore */ } }
  try {
    const u = new URL(location.href);
    if (level && u.searchParams.has('level')) { u.searchParams.delete('level'); location.replace(u.toString()); return; }
  } catch { /* ignore */ }
  location.reload();
}

/** Ask the next (level-1) page load to start a new run behind a one-click gate. False if the story can't. */
export function requestBegin(): boolean {
  if (typeof S.requestBegin !== 'function') return false;
  try { S.requestBegin(); return true; } catch { return false; }
}

export function requestContinue(): void {
  try { S.requestContinue?.(); } catch { /* ignore */ }
}

/** Short level label for meta lines ("SUBLEVEL 3" / "LINE TWO"). */
export function levelLabel(ctx: GameContext): string {
  return (ctx.levelId ?? 1) === 2 ? 'Line Two' : 'Sublevel 3';
}
