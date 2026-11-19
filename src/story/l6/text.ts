/**
 * Level 6 "THE TRUNK" — every piece of written text (stage 3d §6.3–§6.4) and the ONE clock (`CLOCK6`).
 * Spoken lines live in `voice/lines.l6.json` (read-only here). Readables ≤ 30 words, each stands alone (R3).
 */
import type { Fragment } from '../text';

export const TITLE_CARD_L6 = ['THE TRUNK', 'ERIDU DEEP — NAVAL DETACHMENT'];
/** §7.2 / D3: the chapter-end card (`style: 'ending'`, 14 s, skippable), then `END_CARD_L6_CHAPTER` (4 s, `title`). */
export const END_CARD_L6 = ['THE TRUNK', '', 'TO BE CONTINUED'];
export const END_CARD_L6_CHAPTER = ['END OF CHAPTER 3'];
/** The end card when the chain has a next level (never on main: `LEVELS[6].next` is null; a test `?next=6:N`). */
export const END_CARD_L6_NEXT = ['THE TRUNK'];

// ───────────────────────────────────────────────────────────── the clock (§6.4 CLOCK6)

/** The test hour at arrival when no carry brings one (62:45 = WED 23:25). */
export const ARRIVAL_DEFAULT6 = 62.75;
/** Test hour 0 = MON 08:40 (the link drill; level 3's `CLOCK.testStart`) — the same derivation as 3b / 3c. */
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
/** Wall clock `WED 23:25` of a test hour. */
export function wallClock6(hour: number): string {
  const min = Math.floor((8 * 60 + 40) + hour * 60);
  const day = DAYS[Math.floor(min / 1440) % 7];
  const m = ((min % 1440) + 1440) % 1440;
  return `${day} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
/** `hh:mm` only. */
export const hhmm6 = (hour: number) => wallClock6(hour).slice(4);

// ───────────────────────────────────────────────────────────── objectives / toasts (§6.4)

export const OBJ6 = {
  none: '',
  headEnd: 'The head-end — 200 m',
  switch: 'The changeover switch — east wall',
  bj: 'The beach joint — vault, south wall',
  stair: 'The stair door — vault, west wall',
  pool: 'The moon pool — down the stairs',
  tether: 'Cut the tether — the frame over the well',
  loader: 'Destroy the loader',
  /** (user fix 2026-11-19) the loader's two steps while it lives and is hostile: both rams, then the core (cowl open). */
  rams: 'Destroy the rams — they extend when the jaws open',
  core: 'Destroy the core under the ceiling',
  /** (IA-6) the wait for the quiet: tether cut + loader dead, hostiles still awake (§4.8 fight-out) — was empty. */
  clear: 'Clear the dock',
  console: 'The dock console — mid deck',
};

export const TOAST6 = {
  restored: 'Checkpoint restored',
  keyA: 'Key A — head-end mode',
  keyB: 'Key B — moon pool',
  deep: 'Too deep to crouch',
  crouch: 'Crouch — C',
  vest: 'Armour vest',
  plate: 'Armour plate',
  dogged: 'Hatch dogged from below',
  q: 'Q — radio Kessler',
};

/** Interlock prompts (§2.2, §2.6.7, §4.6): story-set by the key held. */
export const PROMPT6 = {
  lockA: 'Insert key A',
  lockANo: 'Interlock key A required',
  lockB: 'Interlock — key B',
  lockBNo: 'Interlock key B required',
};

// ───────────────────────────────────────────────────────────── screens (§6.4)

export const SCREEN6 = {
  tubeCycling: 'HEAD-END TUBE — CYCLING',
  tubeOpen: 'HEAD-END TUBE — OPEN',
  tubeClear: 'CLEAR THE TUBE',
  tubeClosed: 'TRUNK TUNNEL — HEAD-END TUBE — CLOSED',
  mimicAuto: 'HEAD-END — VAULT (BEACH JOINT) — SURFACE 2.1 KM\nMOON POOL — TETHER — ACOUSTIC BUOY: STANDBY\nMODE: AUTO',
  mimicManual: 'HEAD-END — VAULT (BEACH JOINT) — SURFACE 2.1 KM\nMOON POOL — TETHER — ACOUSTIC BUOY: STANDBY\nMODE: MANUAL — PROTECTION SWITCHING OFF',
  mimicPulled: 'HEAD-END — VAULT (BEACH JOINT) — SURFACE 2.1 KM: LOS\nMOON POOL — TETHER — ACOUSTIC BUOY: ACTIVE\nTRUNK FIBRE — LOS / BACKUP LINK — ACOUSTIC BUOY — ACTIVE',
  queue: 'HEAD-END — OUTBOUND QUEUE\nQUEUED: MANIFEST 0031-H / B-14\nSENT: B-01 … B-13\nCONSIGNEE: —',
  switchAuto: 'HEAD-END MODE: AUTO',
  switchManual: 'MANUAL — KEY A OUT',
  bjIdle: 'BEACH JOINT — INTERLOCK KEY A',
  bjOpen: 'KEY A IN — OPEN',
  bjLos: 'FIBRE — LOS',
  shaftIdle: 'MOON POOL ACCESS — INTERLOCK KEY B',
  shaftOpen: 'KEY B IN — OPEN',
  /** Every screen after the pull (§4.6). */
  los: 'TRUNK FIBRE — LOS\nBACKUP LINK — ACOUSTIC BUOY — ACTIVE',
};
/** The HUD radio strip label (§4.1) and while the handset is held (§4.5). */
export const RADIO_LABEL6 = 'POST 4 — CMD — CH 1';
export const HANDSET_LABEL6 = 'SOUND-POWERED — POST 4';

// ───────────────────────────────────────────────────────────── readables (§6.3)

/** `note6_transfer` names the reveal's time: `{reveal hh:mm}` — filled by `transferBody(hhmm)` (ST-b, at the reveal). */
export const transferBody = (hm: string) =>
  `B-14 CYCLE START ${hm}. LOADING WELL. CARGO LOCK: AWAITING SEALED CYCLE. DEWATERING 34 % — STOPPED. HOLD: CHOIR. PERSONNEL: NONE (UNMANNED CYCLE).`;

export const FRAGMENTS6: Record<string, Fragment> = {
  note6_jobcard: {
    header: 'JOB CARD — SPARE TRUNK JOINT — REPEATER 2', style: 'tag', step: 3,
    body: 'J. RØD (HALCYON SUBSEA) — MON 07:30.\nSTATUS: IN PROGRESS.\nDrum stand brakes OFF for pay-out (vault, CD2). Back by 09:00.',
  },
  note6_queue: {
    header: 'HEAD-END — OUTBOUND QUEUE', style: 'terminal', step: 3,
    body: 'QUEUED: MANIFEST 0031-H / B-14.\nCLASP ASSY (CERVICAL) × 240.\nDISPATCH: MOON POOL → SUBSEA SHUTTLE.\nSENT: B-01 … B-13.\nCONSIGNEE: —',
  },
  note6_jointer: {
    header: 'NOTEBOOK — M. LIE, HALCYON SUBSEA', style: 'paper', step: 4,
    body: "Mon. Fibre's live, no outage window. Navy says the buoy takes everything if the fibre drops. Slow, but it carries. Told them: then cut the tether too.",
  },
  note6_transfer: {
    header: 'TRANSFER LOG — DOCK LOADER DL-2', style: 'terminal', step: 3,
    body: transferBody('--:--'),
  },
};
/** R8: a readable works only from inside its room (or region). */
export const READ_ROOM6: Record<string, string> = {
  note6_jobcard: 'rep6', note6_queue: 'he6', note6_jointer: 'vault6', note6_transfer: 'pool6',
};
export const LOG_IDS_L6 = Object.keys(FRAGMENTS6);
