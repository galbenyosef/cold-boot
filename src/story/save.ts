/**
 * Checkpoint storage (REVISION 3): one small versioned JSON blob in localStorage.
 *
 * Every access is wrapped in try/catch (private mode, disabled storage, quota); a blob that does not
 * parse, has another version or the wrong shape is discarded. Nothing here touches the game world.
 */
import type { PlayerSave } from '../core/types';

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
