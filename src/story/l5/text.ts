/**
 * Level 5 "POST 4" — every piece of written text (stage 3c §6.3–§6.4) and the ONE clock (`CLOCK5`).
 * Spoken lines live in `voice/lines.l5.json` (read-only here). Readables ≤ 30 words, each stands alone (R3).
 * Foreshadowing rule (user): nothing here says outright that navy people are taken or controlled — the plan's texts only.
 */
import type { Fragment } from '../text';

export const TITLE_CARD_L5 = ['POST 4', 'ERIDU DEEP — NAVAL DETACHMENT'];
/** §7 / D3: the stage-end card (`style: 'ending'`, 12 s, skippable). */
export const END_CARD_L5 = ['POST 4', '', 'TO BE CONTINUED'];
/** The end card when the chain has a next level (tests only while `LEVELS[5].next` is null): 6 s, skippable. */
export const END_CARD_L5_NEXT = ['POST 4'];

// ───────────────────────────────────────────────────────────── the clock (§6.4 CLOCK5)

/** The test hour at arrival when no carry brings one (62:30 = WED 23:10). */
export const ARRIVAL_DEFAULT5 = 62.5;
/** Test hour 0 = MON 08:40 (the link drill; level 3's `CLOCK.testStart`). */
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
/** Wall clock `WED 23:10` of a test hour. */
export function wallClock5(hour: number): string {
  const min = Math.floor((8 * 60 + 40) + hour * 60);
  const day = DAYS[Math.floor(min / 1440) % 7];
  const m = ((min % 1440) + 1440) % 1440;
  return `${day} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
/** `hh:mm` only. */
export const hhmm5 = (hour: number) => wallClock5(hour).slice(4);
/** `2d 14h 30m` of a test hour (the duty board's LINK DRILL counter; the screen counts up by itself). */
export function dhm5(hour: number): string {
  const m = Math.max(0, Math.floor(hour * 60));
  return `${Math.floor(m / 1440)}d ${Math.floor(m / 60) % 24}h ${m % 60}m`;
}

// ───────────────────────────────────────────────────────────── objectives / toasts (§6.4)

export const OBJ5 = {
  none: '',
  find: 'Find the navy — Post 4',
  survive: 'Survive',
  ready: 'The ready room',
  radio: 'Take the radio',
  keypad: 'Open the spine door — keypad',
  keypadCode: 'Open the spine door — 4719',
  door: "Kessler's door — the end of the spine",
  line: 'Stand on the yellow line — turn your back to the door',
  wheel: 'The gallery wheel — sub bay, west side',
  tunnel: 'The trunk tunnel — floor level, south-west',
};

export const TOAST5 = {
  restored: 'Checkpoint restored',
  radio: 'Radio',
  q: 'Q — radio Kessler',
  qCode: 'Q — ask Kessler for the code',
  crouch: 'Crouch — C',
  vest: 'Armour vest',
  plate: 'Armour plate',
  dogged: 'Hatch dogged from below',
};

// ───────────────────────────────────────────────────────────── screens (§6.4)

export const SCREEN5 = {
  gateAuth: 'AUTHORISED: AAS, L. (LT.) — PALM — LIVE',
  gateClosed: 'GATE 4 — CLOSED — TUBE CYCLE',
  gateClear: 'CLEAR THE GATE',
  gateLog: (hm: string) => [`GATE 4 — LAST AUTHORISED: AAS, L. (LT.) — PALM — LIVE — ${hm}`, 'PREVIOUS: AAS, L. (LT.) — TUE 21:52', 'PREVIOUS: AAS, L. (LT.) — TUE 03:15'].join('\n'),
  aasPalm: (hm: string) => `white|done|AAS, L. (LT.) — PALM — LIVE — ${hm}`,
  onpost: (n: number) => String(n),
  dock: (dhm: string) => ['SDV TERN — CRADLE — LAUNCH READY', 'TRUNK — NOMINAL', 'COMMAND MODULE — SEALED (INSIDE)', `LINK DRILL — IN PROGRESS ${dhm}`].join('\n'),
  keyOff: 'NO AUTHORITY',
  keyReady: 'ENTER CODE',
  keyTyping: (n: number) => `typing|${n}`,
  keyRejected: 'CODE REJECTED',
  keyAccepted: 'ACCEPTED',
  keyOpen: 'OPEN',
  launchIdle: 'idle',
  launchComplete: 'complete',
  palmStandby: 'white|standby|LAUNCH',
  palmRefused: 'fail|NOT ROSTERED — REYES, S.',
  ternIdle: 'TERN — CRADLE — LAUNCH READY',
  ternDone: 'COMPLETE — AWAITING OFFICER PALM',
  tunnelIdle: "TRUNK TUNNEL — CO'S AUTHORITY",
  tunnelRelease: 'CO RELEASE — HYDRAULICS ISOLATED ↑',
  tunnelOpen: 'HYDRAULICS RESTORED — OPEN',
  cmdPanel: 'COMMAND MODULE — SHIELDED — SEALED FROM INSIDE',
};
/** The HUD radio strip label (§8.6). */
export const RADIO_LABEL5 = 'POST 4 — CMD — CH 1';
/** The ON POST board: 26 before the player is counted in (§1). */
export const ON_POST5 = 26;

// ───────────────────────────────────────────────────────────── readables (§6.3)

export const FRAGMENTS5: Record<string, Fragment> = {
  note5_visitors: {
    header: 'VISITOR LOG — GATE 4 — MON', style: 'paper', step: 3,
    body: '05:10 HALCYON SUPPLY — IN — OUT 05:40.\n08:12 SUNDE, A. (DR.) — BIO-SYS — URGENT, TO CO — IN.\nOUT: —',
  },
  note5_watch: {
    header: 'WATCH LOG — DUTY ROOM — MON', style: 'paper', step: 3,
    body: '08:12 Dr. Sunde for CO, urgent.\n08:38 CO to module with Dr. Sunde.\n08:40 All stations: link drill.\n08:41',
  },
  note5_roster: {
    header: 'MODULE WATCH — MON 08:00–12:00', style: 'tag', step: 3,
    body: 'LS RISA · AB ØDEGÅRD · PO1 HAGEN · AB KNUTSEN.\nModule sealed on watch. Phones only.',
  },
  note5_locker: {
    header: 'LOCKER 7 — PO1 H. BREKKE', style: 'paper', step: 4,
    body: "Brekke — collar check moved to 08:40 Monday, all hands. Bring your forms. Don't be the last one again.\n— L. Aas",
  },
  note5_mess: {
    header: 'MESS BOARD', style: 'paper', step: 2,
    body: "READINESS TRIAL — DAY 9. WELL DONE ALL.\nCAKE 15:00 MON (CO's treat).",
  },
  note5_arm: {
    header: 'ARMOURY ISSUE — MON', style: 'paper', step: 4,
    body: '08:43 — CARBINE × 19, SIDEARM × 19, MAGS × 76.\nISSUED BY: —   SIGNED: —   REASON: —',
  },
  note5_mag: {
    header: 'MAGAZINE TALLY — 5.56 / 9 MM', style: 'paper', step: 4,
    body: '5.56: 40 TINS. DRAWN MON 08:44: 19.\n9 MM: 30 TINS. DRAWN: 6.\nFire party access: crawlway from the spine.',
  },
  note5_dive: {
    header: 'DIVE BOARD — SDV TERN', style: 'paper', step: 5,
    body: 'TUE: NO DIVES.\nTUE 22:00: PRE-LAUNCH CHECK — REQUESTED: CHOIR (MAINTENANCE).\nWED: PRE-LAUNCH CHECK — REQUESTED: CHOIR.',
  },
};
/** R8: a readable works only from inside its room (or region). */
export const READ_ROOM5: Record<string, string> = {
  note5_visitors: 'gate5', note5_watch: 'duty5', note5_roster: 'duty5', note5_locker: 'ready5', note5_mess: 'mess5',
  note5_arm: 'arm5', note5_mag: 'arm5', note5_dive: 'dive5',
};
export const LOG_IDS_L5 = Object.keys(FRAGMENTS5);
