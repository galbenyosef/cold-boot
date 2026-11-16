/**
 * Checkpoint storage (REVISION 3): one small versioned JSON blob in localStorage.
 *
 * Every access is wrapped in try/catch (private mode, disabled storage, quota); a blob that does not
 * parse, has another version or the wrong shape is discarded. Nothing here touches the game world.
 */
import type { LevelId, PlayerSave, WeaponId } from '../core/types';
import { setStoredLevel, storedLevel } from '../core/progress';

export const SAVE_KEY = 'coldboot.save.v1';
export const SAVE_VERSION = 1;
/** sessionStorage flag: set by LOAD CHECKPOINT so the reloaded page resumes from the save (one click). */
export const CONTINUE_KEY = 'coldboot.continue';

export const CHECKPOINT_IDS = ['cp_armed', 'cp_fab', 'cp_lockout', 'cp_key', 'cp_breaker', 'cp_lobby'] as const;
export type CheckpointId = typeof CHECKPOINT_IDS[number];

/** The story's whole serialisable progress record (owned by `Script`). */
export interface Progress {
  /** DESIGN.md beats and internal '#cue' markers, in the order they happened. */
  beats: string[];
  /** Fragments (interactable ids) that were opened at least once. */
  read: string[];
  /** Rooms the player has been in. */
  visited: string[];
  /** Named facts the objective and the beat threads branch on. */
  flags: {
    /** The fab door refused once (objective: try Security). */
    sawFabHold: boolean;
    /** Security console used: fab access hold released. */
    holdReleased: boolean;
    armed: boolean;
    huskWoke: boolean;
    fabRevealed: boolean;
    /** Lock-out tag read. */
    tagRead: boolean;
    keyTaken: boolean;
    power: boolean;
    elevatorReady: boolean;
  };
  /** Enemy groups the story has woken / spawned. */
  triggered: string[];
  /** Enemy groups that are completely dead. */
  cleared: string[];
  /** Checkpoints already taken (never taken twice). */
  checkpoints: string[];
}

export interface SaveData {
  v: number;
  id: CheckpointId;
  /** Display name of the room the checkpoint was taken in (menu CONTINUE). */
  place: string;
  player: PlayerSave;
  story: Progress;
  /** Records recovered (ending stat). */
  logs: string[];
  stats: { time: number; kills: number };
  /** Enemy groups to delete on load (all dead at save time). */
  cleared: string[];
}

export function emptyProgress(): Progress {
  return {
    beats: [], read: [], visited: [],
    flags: { sawFabHold: false, holdReleased: false, armed: false, huskWoke: false, fabRevealed: false, tagRead: false, keyTaken: false, power: false, elevatorReady: false },
    triggered: [], cleared: [], checkpoints: [],
  };
}

const strings = (a: unknown): a is string[] => Array.isArray(a) && a.every((s) => typeof s === 'string');
const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function valid(s: any): s is SaveData {
  if (!s || typeof s !== 'object' || s.v !== SAVE_VERSION) return false;
  if (!(CHECKPOINT_IDS as readonly string[]).includes(s.id)) return false;
  const p = s.player, st = s.story;
  if (!p || !Array.isArray(p.position) || p.position.length !== 3 || !p.position.every(num) || !num(p.yaw) || !num(p.health)) return false;
  if (!p.weapons || !p.weapons.pistol || !p.weapons.shotgun || !strings(p.keys) || !strings(p.pickups)) return false;
  if (!st || !strings(st.beats) || !strings(st.read) || !strings(st.visited) || !strings(st.triggered) || !strings(st.cleared) || !strings(st.checkpoints)) return false;
  if (!st.flags || typeof st.flags !== 'object') return false;
  if (!strings(s.logs) || !strings(s.cleared) || !s.stats || !num(s.stats.time) || !num(s.stats.kills)) return false;
  return true;
}

/** The stored checkpoint, or null (none / unreadable / corrupt / other version — those are deleted). */
export function loadSave(): SaveData | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (valid(s)) {
      // Flags added by later builds default to false.
      s.story.flags = { ...emptyProgress().flags, ...s.story.flags };
      if (typeof s.place !== 'string') s.place = '';
      return s;
    }
  } catch { /* fall through: discard */ }
  clearSave();
  return null;
}

export function writeSave(s: SaveData): boolean {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); return true; } catch { return false; }
}

export function clearSave(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

/** Ask the next page load to resume from the checkpoint (death / pause → LOAD CHECKPOINT). */
export function requestContinue(): void {
  try { sessionStorage.setItem(CONTINUE_KEY, '1'); } catch { /* ignore */ }
}

/** Read and clear the "resume from the checkpoint" request. */
export function takeContinueRequest(): boolean {
  try {
    const on = sessionStorage.getItem(CONTINUE_KEY) === '1';
    sessionStorage.removeItem(CONTINUE_KEY);
    return on;
  } catch { return false; }
}

// ───────────────────────────────────────────────────────────── REVISION 4: two levels

export const SAVE_KEY_L2 = 'coldboot.save.l2.v1';
/** The loadout carried from level 1 into level 2 (written by level 1's ending). */
export const CARRY_KEY = 'coldboot.carry';
/** sessionStorage flag: BEGIN was chosen on a level-2 page — the reloaded level-1 page starts a new run behind one click. */
export const BEGIN_KEY = 'coldboot.begin';

/**
 * REVISION 5: `cp2_talk` (fitting door unlocked), `cp2_taken` (fixed instant: he is through the mouth, the
 * escorts have not turned yet), `cp2_escort` (escorts dead, before the ride). `cp2_apron` is gone.
 */
export const CHECKPOINT_IDS_L2 = ['cp2_start', 'cp2_hall', 'cp2_talk', 'cp2_pass', 'cp2_relay', 'cp2_taken', 'cp2_escort', 'cp2_foreman', 'cp2_core'] as const;
/**
 * Revision of level 2's story record. A save written by an older flow (other beats, other flags, removed
 * checkpoint ids) cannot be fast-forwarded into the new one: it is discarded on load, like any invalid save.
 */
export const STORY_REV_L2 = 5;
export type CheckpointIdL2 = typeof CHECKPOINT_IDS_L2[number];

/** Level 2's progress record: same shape as level 1's, with free-form flags (owned by `src/story/l2`). */
export interface ProgressL2 {
  beats: string[];
  read: string[];
  visited: string[];
  flags: Record<string, boolean | number | string>;
  triggered: string[];
  cleared: string[];
  checkpoints: string[];
  /** REVISION 5: ids of spoken lines the player heard (later lines may only refer back to these). */
  heard?: string[];
}

export interface SaveDataL2 {
  v: number;
  /** `STORY_REV_L2` at the time of writing. */
  rev: number;
  level: 2;
  id: CheckpointIdL2;
  place: string;
  player: PlayerSave;
  story: ProgressL2;
  logs: string[];
  stats: { time: number; kills: number };
  cleared: string[];
}

function validL2(s: any): s is SaveDataL2 {
  if (!s || typeof s !== 'object' || s.v !== SAVE_VERSION || s.rev !== STORY_REV_L2) return false;
  if (!(CHECKPOINT_IDS_L2 as readonly string[]).includes(s.id)) return false;
  const p = s.player, st = s.story;
  if (!p || !Array.isArray(p.position) || p.position.length !== 3 || !p.position.every(num) || !num(p.yaw) || !num(p.health)) return false;
  if (!p.weapons || !p.weapons.pistol || !p.weapons.shotgun || !strings(p.keys) || !strings(p.pickups)) return false;
  if (!st || !strings(st.beats) || !strings(st.read) || !strings(st.visited) || !strings(st.triggered) || !strings(st.cleared) || !strings(st.checkpoints)) return false;
  if (!st.flags || typeof st.flags !== 'object') return false;
  if (st.heard !== undefined && !strings(st.heard)) return false;
  if (!strings(s.logs) || !strings(s.cleared) || !s.stats || !num(s.stats.time) || !num(s.stats.kills)) return false;
  return true;
}

export function loadSaveL2(): SaveDataL2 | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SAVE_KEY_L2); } catch { return null; }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (validL2(s)) { if (typeof s.place !== 'string') s.place = ''; return s; }
  } catch { /* fall through: discard */ }
  clearSaveL2();
  return null;
}

export function writeSaveL2(s: SaveDataL2): boolean {
  try { localStorage.setItem(SAVE_KEY_L2, JSON.stringify(s)); return true; } catch { return false; }
}

export function clearSaveL2(): void {
  try { localStorage.removeItem(SAVE_KEY_L2); } catch { /* ignore */ }
}

/** What level 2 starts with: weapons / ammo / health only (never position, keys or pickups). */
export interface Carry {
  health: number;
  weapons: Record<WeaponId, { owned: boolean; clip: number; reserve: number }>;
  current: WeaponId | null;
  flashlight: boolean;
}

export function writeCarry(p: PlayerSave): void {
  const c: Carry = { health: p.health, weapons: p.weapons, current: p.current, flashlight: p.flashlight };
  try { localStorage.setItem(CARRY_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export function loadCarry(): Carry | null {
  try {
    const c = JSON.parse(localStorage.getItem(CARRY_KEY) ?? 'null');
    if (c && num(c.health) && c.weapons && c.weapons.pistol && c.weapons.shotgun) return c as Carry;
  } catch { /* ignore */ }
  return null;
}

/**
 * For the menu (UI): what CONTINUE would resume. `place` is the checkpoint's room name, or null when the
 * stored level has no checkpoint (level 2 then starts from its beginning). null = nothing to continue.
 */
export function saveInfo(): { level: LevelId; place: string | null } | null {
  if (storedLevel() === 2) {
    const s = loadSaveL2();
    return { level: 2, place: s ? (s.place || 'Line Two') : null };
  }
  const s = loadSave();
  return s ? { level: 1, place: s.place || 'Sublevel 3' } : null;
}

/** BEGIN: back to level 1, every checkpoint and the carried loadout gone. */
export function clearAllProgress(): void {
  clearSave();
  clearSaveL2();
  try { localStorage.removeItem(CARRY_KEY); } catch { /* ignore */ }
  setStoredLevel(1);
}

export function requestBegin(): void {
  try { sessionStorage.setItem(BEGIN_KEY, '1'); } catch { /* ignore */ }
}

export function takeBeginRequest(): boolean {
  try {
    const on = sessionStorage.getItem(BEGIN_KEY) === '1';
    sessionStorage.removeItem(BEGIN_KEY);
    return on;
  } catch { return false; }
}
