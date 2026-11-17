/**
 * The level chain (REVISION 4; stage 3a §8.1). One level per page load: finishing a level stores the next one and
 * reloads. `LEVELS` is the only place that knows per-level facts — modules look them up with `levelOf(ctx)`
 * instead of comparing level numbers (`npm run check:chain` greps for such branches).
 * Adding a level: set the previous level's `next`, set `built: true`, add one entry to the dispatch maps in
 * `level/index.ts`, `story/index.ts` and `story/camera.ts` (menu shots). The chain reads `next` only through `nextOf()`.
 * Owned by the coordinator. Every storage access is guarded (private mode / disabled storage).
 */
import type { DebugFlags, DirectLoadout, LevelId, LevelInfo } from './types';

export const LEVEL_KEY = 'coldboot.level';

/** Where a new game starts (BEGIN). */
export const FIRST_LEVEL: LevelId = 1;
export const LEVEL_IDS: readonly LevelId[] = [1, 2, 3, 4, 5, 6];

/** §7: a direct start without a carry (levels 2, 3 and 4). */
const DIRECT: DirectLoadout = { weapons: { pistol: { clip: 12, reserve: 24 }, shotgun: { clip: 6, reserve: 8 } }, health: 100, flashlight: false };
const NO_CAST = { foreman: false, human: false, tomasHead: false };

const unbuilt = (id: LevelId): LevelInfo => ({
  id, tag: `l${id}`, built: false, title: `LEVEL ${id}`, place: `Level ${id}`, bootStatus: `level ${id}`,
  screenHeader: 'HALCYON DYNAMICS // ERIDU DEEP', camLabel: `L${id}`, idleText: true, powerOnAtLoad: true,
  keycardName: null, endEyebrow: null, menuLine: null, subtitles: 'stacked', cast: NO_CAST,
  direct: { facts: {}, loadout: DIRECT }, healthFloor: 50, next: null,
});

export const LEVELS: Readonly<Record<LevelId, LevelInfo>> = {
  1: {
    id: 1, tag: 'l1', built: true, title: 'COLD BOOT', place: 'Sublevel 3', bootStatus: 'sublevel 3',
    screenHeader: 'HALCYON DYNAMICS // ERIDU DEEP FAB  —  SUBLEVEL 3', camLabel: 'SUBLVL-3', idleText: false, powerOnAtLoad: false,
    keycardName: null, endEyebrow: null, menuLine: null, subtitles: 'single', cast: NO_CAST,
    direct: { facts: {}, loadout: null }, healthFloor: 0, next: 2,
  },
  2: {
    id: 2, tag: 'l2', built: true, title: 'LINE TWO', place: 'Line Two', bootStatus: 'line two',
    screenHeader: 'HALCYON DYNAMICS // ERIDU DEEP FAB  —  LINE TWO / SECTION C', camLabel: 'LINE-2', idleText: true, powerOnAtLoad: true,
    keycardName: 'SECTION PASS', endEyebrow: 'End of Line Two', menuLine: 'Level 2  —  Line Two', subtitles: 'stacked',
    cast: { foreman: true, human: true, tomasHead: true },
    direct: { facts: {}, loadout: DIRECT }, healthFloor: 40, next: 3,
  },
  3: {
    id: 3, tag: 'l3', built: true, title: 'THE QUIET SIDE', place: 'Habitat Ring A', bootStatus: 'habitat ring',
    screenHeader: 'HALCYON DYNAMICS // ERIDU DEEP — HABITAT RING A', camLabel: 'CAM', idleText: true, powerOnAtLoad: true,
    keycardName: 'FACILITIES BADGE', endEyebrow: 'End of the Quiet Side', menuLine: 'Chapter 3  —  The Quiet Side', subtitles: 'stacked',
    cast: { foreman: false, human: true, tomasHead: false },
    direct: { facts: { choice: 'stop', unitsLeft: 28 }, loadout: { ...DIRECT, flashlight: true } }, healthFloor: 50,
    // stage 3b D4 (integration): finishing 3a hands over to level 4 (Biological Systems).
    next: 4,
  },
  4: {
    id: 4, tag: 'l4', built: true, title: 'BIOLOGICAL SYSTEMS', place: 'Biological Systems', bootStatus: 'biological systems',
    screenHeader: 'HALCYON BIO-SYSTEMS DIV. // ERIDU DEEP — BIOLOGICAL', camLabel: 'BIO', idleText: true, powerOnAtLoad: true,
    keycardName: 'FACILITIES BADGE', endEyebrow: 'End of Biological Systems', menuLine: 'Chapter 3  —  Biological Systems', subtitles: 'stacked',
    cast: { foreman: false, human: false, tomasHead: false },
    direct: { facts: { choice: 'stop', unitsLeft: 28, badge: true, halvorsenAlive: true }, loadout: { ...DIRECT, flashlight: true, armor: 0 } },
    healthFloor: 50, next: null,
  },
  5: unbuilt(5),
  6: unbuilt(6),
};

export function isLevelId(n: unknown): n is LevelId {
  return typeof n === 'number' && (LEVEL_IDS as readonly number[]).includes(n);
}

/**
 * The info of a level. `undefined` (a dev page that sets no level) is level 1 — the explicit default; any other
 * value that is not a level id throws, so a missing table entry fails loudly instead of silently becoming level 1.
 */
export function levelInfo(id: LevelId | number | undefined | null): LevelInfo {
  if (id === undefined || id === null) return LEVELS[FIRST_LEVEL];
  if (!isLevelId(id)) throw new Error(`[progress] unknown level ${String(id)}`);
  return LEVELS[id];
}

/** The info of the level this page load runs. */
export function levelOf(ctx: { levelId?: LevelId }): LevelInfo {
  return levelInfo(ctx.levelId);
}

/**
 * Stage 3b §8.1: the level the chain hands over to after `id` — the test override `debug.next[id]` (`?next=3:4`) when
 * given, else `LEVELS[id].next`. Every reader of the chain (finishLevel, the carry check, level ends) goes through it.
 */
export function nextOf(id: LevelId, debug?: Pick<DebugFlags, 'next'> | null): LevelId | null {
  const o = debug?.next?.[id];
  return o !== undefined && isLevelId(o) ? o : LEVELS[id].next;
}

/** The highest built level ≤ `id` (`?level=5` boots level 4 while 3c is unbuilt, §7). */
export function clampBuilt(id: number): LevelId {
  let best: LevelId = FIRST_LEVEL;
  for (const l of LEVEL_IDS) if (LEVELS[l].built && l <= id) best = l;
  return best;
}

/** `?level=` / stored value → a level id: integers ≥ 1 (above 6 → 6); anything else null. Not clamped to built. */
export function parseLevel(raw: string | null | undefined): LevelId | null {
  if (raw === null || raw === undefined || !/^\s*\d+\s*$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 1) return null;
  return Math.min(n, LEVEL_IDS[LEVEL_IDS.length - 1]) as LevelId;
}

export function storedLevel(): LevelId {
  let raw: string | null = null;
  try { raw = localStorage.getItem(LEVEL_KEY); } catch { return FIRST_LEVEL; }
  const n = parseLevel(raw);
  return n === null ? FIRST_LEVEL : clampBuilt(n);
}

export function setStoredLevel(level: LevelId): void {
  try { localStorage.setItem(LEVEL_KEY, String(level)); } catch { /* ignore */ }
}

/** `?level=` wins; `?nostory=1`/tests without it get the stored level. Always a built level. */
export function resolveLevel(debug: DebugFlags): LevelId {
  return clampBuilt(debug.level ?? storedLevel());
}
