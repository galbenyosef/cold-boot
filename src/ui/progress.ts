/**
 * What the menu / death / pause screens need to know about stored progress (REVISION 4; stage 3a §8.1 chain).
 * The story owns the save format (`src/story/save.ts`); level facts come from `LEVELS` (core/progress.ts).
 */
import type { GameContext, LevelId } from '../core/types';
import * as save from '../story/save';
import { LEVEL_KEY, levelOf } from '../core/progress';
import { SKIP_INTRO_KEY } from './types';

export interface SaveInfo {
  level: LevelId;
  /** Display name of the checkpoint's room, or null = no checkpoint (CONTINUE starts the level). */
  place: string | null;
}

/** The stored run: which level CONTINUE resumes and whether a checkpoint exists there. null = nothing to continue. */
export function saveInfo(): SaveInfo | null {
  try { return save.saveInfo(); } catch (e) { console.warn('[ui] saveInfo failed', e); return null; }
}

/** A checkpoint of THIS page's level exists (LOAD CHECKPOINT on the death / pause screens). */
export function hasCheckpoint(ctx: GameContext): SaveInfo | null {
  const info = saveInfo();
  return info && info.level === levelOf(ctx).id && info.place !== null ? info : null;
}

/** BEGIN: back to level 1, every save / carried loadout gone. */
export function clearAllProgress(): void {
  try { save.clearAllProgress(); } catch (e) { console.warn('[ui] clearAllProgress failed', e); }
}

/** Clear only this level's checkpoint (RESTART LEVEL); the carried loadout stays. */
export function clearLevelSave(ctx: GameContext): void {
  try { save.clearLevelSave(levelOf(ctx).id); } catch { /* ignore */ }
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

/** Ask the next (level-1) page load to start a new run behind a one-click gate. */
export function requestBegin(): boolean {
  try { save.requestBegin(); return true; } catch { return false; }
}

export function requestContinue(): void {
  try { save.requestContinue(); } catch { /* ignore */ }
}

/** Short level label for meta lines ("Sublevel 3" / "Line Two" / "Habitat Ring A"). */
export function levelLabel(ctx: GameContext): string {
  return levelOf(ctx).place;
}
