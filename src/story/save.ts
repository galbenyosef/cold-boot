/**
 * Checkpoint + carry storage, schema v2 for every level (REVISION 3/4; stage 3a §8.1).
 *
 * Keys: `coldboot.level` (core/progress.ts), `coldboot.save.l<N>.v2` (one checkpoint per level), `coldboot.carry.v2`
 * (what one level hands to the next), `coldboot.seen.v1` (scenes seen on this browser; never cleared by BEGIN).
 * The v1 keys (`coldboot.save.v1`, `coldboot.save.l2.v1`, `coldboot.carry`) are deleted on boot (`discardV1`): an old
 * player starts their stored level over.
 *
 * Every access is wrapped in try/catch (private mode, disabled storage, quota); a blob that does not parse, has
 * another version / level / story revision or the wrong shape is discarded. Nothing here touches the game world.
 */
import type { BossState, CarryV2, DebugFlags, Facts, LevelId, PlayerSave, SaveV2, WeaponId } from '../core/types';
import { WEAPON_IDS } from '../core/types';
import { FIRST_LEVEL, LEVEL_IDS, levelInfo, nextOf, setStoredLevel, storedLevel } from '../core/progress';

export const SAVE_VERSION = 2;
/** sessionStorage flag: set by LOAD CHECKPOINT so the reloaded page resumes from the save (one click). */
export const CONTINUE_KEY = 'coldboot.continue';
/** sessionStorage flag: BEGIN was chosen on a later level's page — the reloaded level-1 page starts a new run behind one click. */
export const BEGIN_KEY = 'coldboot.begin';
export const CARRY_KEY = 'coldboot.carry.v2';
/** D9: scenes seen on this browser (skip allowed on the second view). Never cleared by BEGIN. */
export const SEEN_KEY = 'coldboot.seen.v1';
/** v1 storage (REVISION 3/4), discarded once on boot. */
export const V1_KEYS = ['coldboot.save.v1', 'coldboot.save.l2.v1', 'coldboot.carry'] as const;

export const saveKey = (level: LevelId): string => `coldboot.save.l${level}.v2`;

const strings = (a: unknown): a is string[] => Array.isArray(a) && a.every((s) => typeof s === 'string');
const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** Stage 3b §8.1: carried armour is 0 … 100 (`Player.maxArmor`); non-finite / missing → 0. */
export const MAX_ARMOR = 100;
export const clampArmor = (a: unknown): number => (num(a) ? Math.min(MAX_ARMOR, Math.max(0, Math.round(a))) : 0);

// ───────────────────────────────────────────────────────────── generic checkpoint per level

/** What a level's story declares about its checkpoints. */
export interface SaveSpec {
  level: LevelId;
  /** Story revision: a save written by an older flow is discarded on load. */
  rev: number;
  ids: readonly string[];
}

function validPlayer(p: any): p is PlayerSave {
  if (!p || !Array.isArray(p.position) || p.position.length !== 3 || !p.position.every(num) || !num(p.yaw) || !num(p.health)) return false;
  if (!p.weapons || typeof p.weapons !== 'object' || !strings(p.keys) || !strings(p.pickups)) return false;
  return true;
}

export function validFacts(f: any): f is Facts {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
  for (const v of Object.values(f)) if (typeof v !== 'string' && typeof v !== 'boolean' && !num(v)) return false;
  if (f.choice !== undefined && f.choice !== 'stop' && f.choice !== 'command') return false;
  if (f.unitsLeft !== undefined && !num(f.unitsLeft)) return false;
  return true;
}

function validSave(s: any, spec: SaveSpec): boolean {
  if (!s || typeof s !== 'object' || s.v !== SAVE_VERSION || s.level !== spec.level || s.rev !== spec.rev) return false;
  if (!spec.ids.includes(s.id) || !validPlayer(s.player) || !validFacts(s.facts)) return false;
  const st = s.story;
  if (!st || !strings(st.beats) || !strings(st.read) || !strings(st.visited) || !strings(st.triggered) || !strings(st.cleared) || !strings(st.checkpoints)) return false;
  if (!st.flags || typeof st.flags !== 'object') return false;
  if (st.heard !== undefined && !strings(st.heard)) return false;
  // stage 3c §7 (level 5): optional extra arrays / counters of a progress record
  if (st.scares !== undefined && !strings(st.scares)) return false;
  if (st.codeWrong !== undefined && !num(st.codeWrong)) return false;
  // stage 3d §7 (level 6): the boss record, waves, launch clock and lockers (each optional; shape-checked when present)
  if (st.boss !== undefined && st.boss !== null && (typeof st.boss !== 'object' || !num(st.boss.stage) || !st.boss.parts || typeof st.boss.parts !== 'object' || !Array.isArray(st.boss.slots))) return false;
  if (st.waves !== undefined && (!st.waves || typeof st.waves !== 'object')) return false;
  if (st.launchAt !== undefined && st.launchAt !== null && !num(st.launchAt)) return false;
  if (st.lockers !== undefined && (!st.lockers || typeof st.lockers !== 'object')) return false;
  if (!strings(s.logs) || !strings(s.cleared) || !s.stats || !num(s.stats.time) || !num(s.stats.kills)) return false;
  return true;
}

/** The stored checkpoint of `spec.level`, or null (none / unreadable / corrupt / other version — those are deleted). */
export function loadLevelSave<P>(spec: SaveSpec): SaveV2<P> | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(saveKey(spec.level)); } catch { return null; }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (validSave(s, spec)) { if (typeof s.place !== 'string') s.place = ''; return s as SaveV2<P>; }
  } catch { /* fall through: discard */ }
  clearLevelSave(spec.level);
  return null;
}

export function writeLevelSave<P>(s: SaveV2<P>): boolean {
  try { localStorage.setItem(saveKey(s.level), JSON.stringify(s)); return true; } catch { return false; }
}

export function clearLevelSave(level: LevelId): void {
  try { localStorage.removeItem(saveKey(level)); } catch { /* ignore */ }
}

// ───────────────────────────────────────────────────────────── level 1

export const CHECKPOINT_IDS = ['cp_armed', 'cp_fab', 'cp_lockout', 'cp_key', 'cp_breaker', 'cp_lobby'] as const;
export type CheckpointId = typeof CHECKPOINT_IDS[number];
/** Revision of level 1's story record (v2 schema). */
export const STORY_REV_L1 = 1;
const SPEC_L1: SaveSpec = { level: 1, rev: STORY_REV_L1, ids: CHECKPOINT_IDS };

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

export type SaveData = SaveV2<Progress, CheckpointId>;

export function emptyProgress(): Progress {
  return {
    beats: [], read: [], visited: [],
    flags: { sawFabHold: false, holdReleased: false, armed: false, huskWoke: false, fabRevealed: false, tagRead: false, keyTaken: false, power: false, elevatorReady: false },
    triggered: [], cleared: [], checkpoints: [],
  };
}

export function loadSave(): SaveData | null {
  const s = loadLevelSave<Progress>(SPEC_L1) as SaveData | null;
  // Flags added by later builds default to false.
  if (s) s.story.flags = { ...emptyProgress().flags, ...s.story.flags };
  return s;
}
export function writeSave(s: SaveData): boolean { return writeLevelSave(s); }
export function clearSave(): void { clearLevelSave(1); }

// ───────────────────────────────────────────────────────────── level 2

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
const SPEC_L2: SaveSpec = { level: 2, rev: STORY_REV_L2, ids: CHECKPOINT_IDS_L2 };

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

export type SaveDataL2 = SaveV2<ProgressL2, CheckpointIdL2>;

export function loadSaveL2(): SaveDataL2 | null { return loadLevelSave<ProgressL2>(SPEC_L2) as SaveDataL2 | null; }
export function writeSaveL2(s: SaveDataL2): boolean { return writeLevelSave(s); }
export function clearSaveL2(): void { clearLevelSave(2); }

// ───────────────────────────────────────────────────────────── level 3 (stage 3a §7)

export const CHECKPOINT_IDS_L3 = ['cp3_start', 'cp3_office', 'cp3_canteen', 'cp3_balcony'] as const;
export type CheckpointIdL3 = typeof CHECKPOINT_IDS_L3[number];
export const STORY_REV_L3 = 1;
export const SPEC_L3: SaveSpec = { level: 3, rev: STORY_REV_L3, ids: CHECKPOINT_IDS_L3 };

/** §7 `ProgressL3`. `flags`: released, quiet, met, office, left, breach, purge, bioOpen, sealed, shotDoors. */
export interface ProgressL3 extends ProgressL2 {
  heard: string[];
  /** Level clock (seconds since arrival, §6.4). */
  t: number;
}
export type SaveDataL3 = SaveV2<ProgressL3, CheckpointIdL3>;

export function emptyProgressL3(): ProgressL3 {
  return { beats: [], read: [], visited: [], heard: [], flags: {}, triggered: [], cleared: [], checkpoints: [], t: 0 };
}

// ───────────────────────────────────────────────────────────── level 4 (stage 3b §7, §8.1)

export const CHECKPOINT_IDS_L4 = ['cp4_start', 'cp4_clean', 'cp4_cold', 'cp4_hold', 'cp4_lower', 'cp4_navy', 'cp4_armed'] as const;
export type CheckpointIdL4 = typeof CHECKPOINT_IDS_L4[number];
export const STORY_REV_L4 = 1;
export const SPEC_L4: SaveSpec = { level: 4, rev: STORY_REV_L4, ids: CHECKPOINT_IDS_L4 };
/**
 * §7 `ProgressL4` = `ProgressL3`'s shape. `flags`: deconDone, showered, override, lightsOut, theatre, refused, armed,
 * equalising, equalised, released, tubeFight, gateLock, video, roster (free-form record, owned by `src/story/l4`).
 */
export type ProgressL4 = ProgressL3;
export type SaveDataL4 = SaveV2<ProgressL4, CheckpointIdL4>;
export const emptyProgressL4 = emptyProgressL3;

// ───────────────────────────────────────────────────────────── level 5 (stage 3c §7, §8.1)

export const CHECKPOINT_IDS_L5 = ['cp5_start', 'cp5_duty', 'cp5_ready', 'cp5_radio', 'cp5_spine', 'cp5_door', 'cp5_bay'] as const;
export type CheckpointIdL5 = typeof CHECKPOINT_IDS_L5[number];
export const STORY_REV_L5 = 1;
export const SPEC_L5: SaveSpec = { level: 5, rev: STORY_REV_L5, ids: CHECKPOINT_IDS_L5 };
/**
 * §7 `ProgressL5` = `ProgressL3`'s shape plus `scares` and `codeWrong` (K decision: an extension, so every ProgressL5
 * is a ProgressL3 and the stage base takes it unchanged). `flags` (free-form, owned by `src/story/l5`): gateOpen,
 * gateLatched, scene, unitsIn, s1Free, radio, powered, keypad, spineWave, hatchSpine, hatchMag, boots, door, verified,
 * dark, bayA, wheel, released, tunnel, patrolFree. `scares` = vignette ids fired (snapped on restore, D21);
 * `codeWrong` = wrong keypad codes entered. A save without them (K's stub record) loads with `[]` / 0 — the story
 * fills them with `{ ...emptyProgressL5(), ...saved }`.
 */
export interface ProgressL5 extends ProgressL3 {
  scares: string[];
  codeWrong: number;
}
export type SaveDataL5 = SaveV2<ProgressL5, CheckpointIdL5>;
export function emptyProgressL5(): ProgressL5 { return { ...emptyProgressL3(), scares: [], codeWrong: 0 }; }

// ───────────────────────────────────────────────────────────── level 6 (stage 3d §7, §8.1)

export const CHECKPOINT_IDS_L6 = ['cp6_start', 'cp6_tunnel', 'cp6_rep', 'cp6_he', 'cp6_manual', 'cp6_pulled', 'cp6_shaft',
  'cp6_m1', 'cp6_m2', 'cp6_m3', 'cp6_m4', 'cp6_m5', 'cp6_quiet'] as const;
export type CheckpointIdL6 = typeof CHECKPOINT_IDS_L6[number];
export const STORY_REV_L6 = 1;
export const SPEC_L6: SaveSpec = { level: 6, rev: STORY_REV_L6, ids: CHECKPOINT_IDS_L6 };
/** §7: the state of one boss wave (W1 … W3). */
export type WaveStateL6 = 'pending' | 'alive' | 'dead' | null;
/**
 * §7 `ProgressL6` = `ProgressL5` plus the boss record (`BossState`, null before the loader is hostile), the boss waves
 * (`latest` = the wave a boss restore handles, §7.1 / S2a), `launchAt` (the game-clock second of the SDV launch, D16;
 * null = not yet) and `lockers` (the three dock ammo lockers taken since the last milestone, B5). `flags` (free-form,
 * owned by `src/story/l6`): tubeOpen, tubeLatched, crossing, f1Free, f1Cancelled, bayLive, f3Free, manual, queue, handset,
 * aas, bjOpen, pulled, thud, shaftOpen, lights6, reveal, hostile, lights_out6, pin, pressure, trunkCut, ramE, ramW,
 * loaderDead, quiet, ending. A save without the new fields loads with `emptyProgressL6()`'s (`{ ...empty, ...saved }`).
 */
export interface ProgressL6 extends ProgressL5 {
  boss: BossState | null;
  waves: { w1: WaveStateL6; w2: WaveStateL6; w3: WaveStateL6; latest: 'w1' | 'w2' | 'w3' | null };
  launchAt: number | null;
  lockers: Record<'e' | 'w' | 'n', boolean>;
}
export type SaveDataL6 = SaveV2<ProgressL6, CheckpointIdL6>;
export function emptyProgressL6(): ProgressL6 {
  return {
    ...emptyProgressL5(), boss: null, waves: { w1: null, w2: null, w3: null, latest: null }, launchAt: null,
    lockers: { e: false, w: false, n: false },
  };
}

/** Every level's checkpoint spec (menu CONTINUE validates through these). */
const SPECS: Partial<Record<LevelId, SaveSpec>> = { 1: SPEC_L1, 2: SPEC_L2, 3: SPEC_L3, 4: SPEC_L4, 5: SPEC_L5, 6: SPEC_L6 };

/** The room name of a level's valid checkpoint (menu); null = no checkpoint (an invalid one is deleted). */
function checkpointPlace(level: LevelId): string | null {
  const spec = SPECS[level];
  if (!spec) return null;
  const s = loadLevelSave<unknown>(spec);
  return s ? s.place : null;
}

// ───────────────────────────────────────────────────────────── carry

/** A carried weapon record → the full `Record<WeaponId>`: unknown ids dropped, missing ones unowned (§8.1). */
export function fullWeapons(w: unknown): CarryV2['weapons'] {
  const src = (w && typeof w === 'object' ? w : {}) as Record<string, any>;
  const out = {} as CarryV2['weapons'];
  for (const id of WEAPON_IDS) {
    const e = src[id];
    out[id] = e && typeof e === 'object'
      ? { owned: !!e.owned, clip: num(e.clip) ? Math.max(0, Math.floor(e.clip)) : 0, reserve: num(e.reserve) ? Math.max(0, Math.floor(e.reserve)) : 0 }
      : { owned: false, clip: 0, reserve: 0 };
  }
  return out;
}

export function makeCarry(from: LevelId, p: PlayerSave, facts: Facts): CarryV2 {
  const current: WeaponId | null = p.current && (WEAPON_IDS as readonly string[]).includes(p.current) ? p.current : null;
  return { v: 2, from, health: Math.round(p.health), armor: clampArmor(p.armor), flashlight: !!p.flashlight, current, weapons: fullWeapons(p.weapons), facts: { ...facts } };
}

export function writeCarry(c: CarryV2): void {
  try { localStorage.setItem(CARRY_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

/** The stored carry, whatever level wrote it, or null (none / corrupt / other version). Does not delete. */
export function readCarry(): CarryV2 | null {
  try {
    const c = JSON.parse(localStorage.getItem(CARRY_KEY) ?? 'null');
    if (!c || typeof c !== 'object' || c.v !== 2 || !LEVEL_IDS.includes(c.from) || !num(c.health) || !validFacts(c.facts)) return null;
    if (!c.weapons || typeof c.weapons !== 'object') return null;
    return {
      v: 2, from: c.from, health: c.health, armor: clampArmor(c.armor), flashlight: !!c.flashlight,
      current: (WEAPON_IDS as readonly unknown[]).includes(c.current) ? c.current : null,
      weapons: fullWeapons(c.weapons), facts: { ...c.facts },
    };
  } catch { return null; }
}

/**
 * The carry that leads INTO `level` (written by the level whose `next` it is — `nextOf(from, debug)`, so the test
 * override `?next=3:4` lets level 4 accept 3's carry), or null.
 */
export function loadCarryFor(level: LevelId, debug?: Pick<DebugFlags, 'next'> | null): CarryV2 | null {
  const c = readCarry();
  return c && nextOf(c.from, debug) === level ? c : null;
}

// ───────────────────────────────────────────────────────────── menu / chain helpers

/**
 * For the menu (UI): what CONTINUE would resume. `place` is the checkpoint's room name, or null when the
 * stored level has no checkpoint (a later level then starts from its beginning). null = nothing to continue.
 */
export function saveInfo(): { level: LevelId; place: string | null } | null {
  const level = storedLevel();
  const place = checkpointPlace(level);
  if (level === FIRST_LEVEL) return place === null ? null : { level, place: place || levelInfo(level).place };
  return { level, place: place === null ? null : place || levelInfo(level).place };
}

/** BEGIN: back to level 1, every checkpoint and the carried loadout gone (`seen` stays, D9). */
export function clearAllProgress(): void {
  for (const l of LEVEL_IDS) clearLevelSave(l);
  try { localStorage.removeItem(CARRY_KEY); } catch { /* ignore */ }
  setStoredLevel(FIRST_LEVEL);
}

/** Delete the v1 keys (once: afterwards they do not exist). True when something was discarded. */
export function discardV1(): boolean {
  let any = false;
  for (const k of V1_KEYS) {
    try { if (localStorage.getItem(k) !== null) { localStorage.removeItem(k); any = true; } } catch { /* ignore */ }
  }
  if (any) console.info('[save] v1 progress discarded (schema v2): the stored level starts over');
  return any;
}

/** Ask the next page load to resume from the checkpoint (death / pause → LOAD CHECKPOINT, hand-over). */
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

/** D9: has this scene been seen on this browser? */
export function seen(id: string): boolean {
  try { const a = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'); return Array.isArray(a) && a.includes(id); } catch { return false; }
}

export function markSeen(id: string): void {
  try {
    const a = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    const list: string[] = Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
    if (!list.includes(id)) { list.push(id); localStorage.setItem(SEEN_KEY, JSON.stringify(list)); }
  } catch { /* ignore */ }
}
