/**
 * Level 3 "THE QUIET SIDE" — every piece of written text (stage 3a §6.3–§6.5) and the ONE clock (§6.4).
 * Spoken lines live in `voice/lines.l3.json`. Readables ≤ 30 words, each stands alone (R3).
 */
import type { Fragment } from '../text';

export const TITLE_CARD_L3 = ['THE QUIET SIDE', 'HABITAT RING A'];
/** §7 / D19: the stage-end card (`style: 'ending'`, 12 s, skippable). */
export const END_CARD_L3 = ['THE QUIET SIDE', '', 'TO BE CONTINUED'];

// ───────────────────────────────────────────────────────────── the clock (§6.4, D4)

/**
 * One constant drives every time in the level. Arrival = Wed 22:40 = test hour 62:00 (the test ran from Mon 08:40 for
 * 72 h). `t` = seconds since the level started (sequencer time, scenes included; saved in the record).
 */
export const CLOCK = { testStart: 'MON 08:40', testHours: 72, arrivalHour: 62, arrivalClock: [22, 40] as const, day: 'WED', lamps: 'EVENING' };

const p2 = (n: number) => String(Math.floor(n)).padStart(2, '0');
/** Test hour now (62 + t/3600). */
export const testHour = (t: number) => CLOCK.arrivalHour + t / 3600;
/** Countdown `hh:mm:ss` = 72 h − hour (10:00:00 at load, ticking). */
export function countdown(t: number): string {
  const left = Math.max(0, Math.floor((CLOCK.testHours - CLOCK.arrivalHour) * 3600 - t));
  return `${p2(left / 3600)}:${p2((left % 3600) / 60)}:${p2(left % 60)}`;
}
/** Lobby clock `WED 22:40` + t (rolls into THU after midnight). */
export function wallClock(t: number, seconds = false): string {
  const m0 = CLOCK.arrivalClock[0] * 60 + CLOCK.arrivalClock[1];
  const s = m0 * 60 + Math.floor(t);
  const day = Math.floor(s / 86400) > 0 ? 'THU' : CLOCK.day;
  const r = s % 86400;
  return `${day} ${p2(r / 3600)}:${p2((r % 3600) / 60)}${seconds ? ':' + p2(r % 60) : ''}`;
}
/** Report hours: last = 6·floor(h/6), next = last + 6 (60 / 66 for any realistic play). */
export function reports(t: number): { last: number; next: number } {
  const last = 6 * Math.floor(testHour(t) / 6);
  return { last, next: last + 6 };
}

// ───────────────────────────────────────────────────────────── readables (§6.3)

export function fragmentsL3(t: number): Record<string, Fragment> {
  const r = reports(t);
  return {
    term3_lobby: {
      header: 'HABITAT — FAB SUBLEVELS STATUS', style: 'terminal', step: 1,
      body: `SEALED — PRESSURE INTEGRITY TEST 72 H
LAST REPORT ${p2(r.last)}:00 — ALL STAFF SAFE
NEXT REPORT ${p2(r.next)}:00
COMMS TO FAB: SUSPENDED FOR THE TEST
— CHOIR`,
    },
    note3_guestbook: {
      header: "LOBBY — visitors' book, last page", style: 'paper', step: 2,
      body: `Lt. Aas, Post 4 — collected returns ×12 for Bio. 14:20.
Halvorsen — fab test from 08:40 Mon. No visits.`,
    },
    note3_board: {
      header: "RESIDENTS' COUNCIL", style: 'paper', step: 1,
      body: 'This habitat is unit-free by agreement. Facilities does its own lifting. If you see a unit on the ring, call Halvorsen, not CHOIR.',
    },
    note3_canteen: {
      header: 'KITCHEN — standing orders', style: 'paper', step: 2,
      body: `FAB GALLEY RESUPPLY — CANCELLED BY CHOIR (TEST PROTOCOL).
(handwritten) Three days of stores still in the freight bay. Who's eating down there? Asked CHOIR. No reply. — M.`,
    },
    note3_quiz: {
      header: 'THURSDAY — QUIZ NIGHT', style: 'paper', step: 1,
      body: 'Teams of four. Prize: a day on the surface rota. Question master: Halvorsen. No asking CHOIR.',
    },
    note3_clinic_post4: {
      header: 'CLINIC — sick call, Post 4 (navy)', style: 'paper', step: 4,
      body: 'Eleven sailors over five weeks: neck stiffness, poor sleep, one says "humming". Navy says refer to Bio-Sys. Not ours, they say. Noted. — Dr. Lund',
    },
    note3_clinic_reyes: {
      header: 'REMOTE PATIENTS', style: 'terminal', step: 3,
      body: `FAB MEDICAL 3-A — REYES, S.
SEDATION MANAGED REMOTELY BY CHOIR FOR THE TEST.
LINK OK. VISITS: NONE REQUIRED.`,
    },
    sign3_viewport: {
      header: 'WHAT YOU ARE LOOKING AT', style: 'tag', step: 1,
      body: "2,140 m of water. The cable lit red is the trunk — our only line to the surface. Please don't tap the glass.",
    },
    sign3_bio: {
      header: 'BIOLOGICAL SYSTEMS', style: 'tag', step: 4,
      body: `NAVAL SECURITY AREA (painted over)
tape: GUARD WITHDRAWN 09.03. FACILITIES BADGE ACCEPTED. DECON ON ENTRY.`,
    },
    note3_door: {
      header: 'note on a cabin door', style: 'paper', step: 4,
      body: "Sigrid — swapped your night with Per. He's on till six. Bio's freezer alarm went again; he says ignore it, they always say ignore it.",
    },
    note3_schedule: {
      header: 'FACILITIES — WEEK 46', style: 'paper', step: 2,
      body: `${CLOCK.testStart} — FAB SUBLEVELS: PRESSURE INTEGRITY TEST, ${CLOCK.testHours} H. STAFF REMAIN INSIDE. NO VISITS.
REQUESTED: CHOIR. APPROVED: P. HALVORSEN.`,
    },
    note3_pad: {
      header: 'HALVORSEN — notepad', style: 'paper', step: 3,
      body: 'Hr 30: asked CHOIR for a fab camera. "Unavailable for the duration." Hr 48: asked again. Same. Kitchen worried. Ask tomorrow.',
    },
    note3_memo: {
      header: 'HALCYON OPERATIONS → FACILITIES — ORDER 0031-H', style: 'terminal', step: 5,
      body: `FABRICATION TO ZERO HEADCOUNT.
FACILITIES: PREPARE TRANSFERS TO THE SURFACE FOR ALL FAB STAFF.
DO NOT DISCUSS.
SIGNED 4 OF 4. COPY: BIO-SYSTEMS DIV., FOR INFORMATION.`,
    },
    note3_desk: {
      header: 'PRINTER — last page', style: 'terminal', step: 4,
      body: `RETURNS — BIO-SYS DIV. 12 CRATES, SEALED, CHILLED.
COLLECTED BY POST 4 FOR THE SUBMERSIBLE RUN.
DO NOT OPEN. DO NOT LOG CONTENTS.`,
    },
  };
}
export const LOG_IDS_L3 = Object.keys(fragmentsL3(0));
/** The office readables (R8: usable only from inside the office). */
export const OFFICE_READS = ['note3_schedule', 'note3_pad', 'note3_memo'];

// ───────────────────────────────────────────────────────────── screens (§6.5)

/** `lobby_status` (kind habitat_status): `<clock>|<lamp>|<lines>`. */
export function lobbyStatus(t: number, choice: 'stop' | 'command', takeover: boolean): string {
  if (takeover) return `${wallClock(t)}|EMERGENCY|!PRESSURE ALARM — SECTOR SEALED\nRESIDENTS: STAY IN YOUR CABINS`;
  const nodes = choice === 'command' ? 'NODES ONLINE: 6 OF 6' : 'NODES ONLINE: 5 OF 6';
  const n5 = choice === 'command' ? 'NODE 5 — FAB L2: SUPERVISED' : 'NODE 5 — FAB L2: OFFLINE';
  return `${wallClock(t)}|${CLOCK.lamps}|${nodes}\nNODE 2 — BIO-SYS\n${n5}\nFAB SUBLEVELS: TEST`;
}
export const SCREEN3 = {
  liftArrive: 'HABITAT RING',
  liftGone: 'CALLED — SUBLEVEL 5',
  equalising: 'EQUALISING',
  released: 'RELEASED|CHOIR',
  open: 'OPEN',
  sealed: 'SECTOR SEALED',
  clear: 'CLEAR THE DOOR',
  test: (t: number) => `TEST|${countdown(t)}`,
  admin: 'FACILITIES',
  menu: 'TODAY — FISH SOUP / LENTIL CURRY',
  bioPanel: 'DECON — AWAITING',
  bioPurge: (n: number) => `PURGE ${String(n).padStart(2, '0')}`,
  bioDone: 'DECON — COMPLETE',
  reader: {
    idle: 'idle|BIOLOGICAL SYSTEMS|PRESENT BADGE',
    denied: 'denied|BADGE REQUIRED|FACILITIES BADGE',
    accepted: 'accepted|PURGE 15 S|HALVORSEN, P. — FACILITIES',
    read: 'read|READING|',
  },
};

// ───────────────────────────────────────────────────────────── objectives, toasts (§6.5)

export const OBJ3 = {
  none: '',
  lift: 'Wait for the lift',
  lock: 'Pressure lock — wait for equalisation',
  find: 'Find someone — the habitat lobby',
  post4: 'Get to Post 4 — through Biological Systems',
  hold: 'Hold until the lock opens',
  enter: 'Get into the outer lock',
};
export const TOAST3 = {
  badge: 'Facilities badge',
  restored: 'CHECKPOINT RESTORED',
  sealed: 'Sector sealed',
  private: 'Private cabin',
  staff: 'Staff only',
  noBadge: 'Badge required',
  halvLocked: 'Locked from the inside',
  night: 'Garden atrium — closed for the night (22:00–06:00)',
};
