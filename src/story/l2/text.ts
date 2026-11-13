/**
 * Level 2 — "LINE TWO": every piece of written text (REVISION 4). Spoken lines live in
 * `voice/lines.l2.json`. Rules as in level 1: readable fragments ≤ 30 words, one idea each, concrete.
 */
import type { Fragment } from '../text';

export const FRAGMENTS_L2: Record<string, Fragment> = {
  note2_dock: {
    header: 'FREIGHT DOCK 5 — DELIVERY SLATE',
    style: 'terminal',
    step: 1,
    body: `OUTBOUND ...... 31 UNITS, SERIES 2
INBOUND ....... 0
CREW TRANSFER . CANCELLED — NO CREW
SIGNED FOR .... CHOIR`,
  },
  note2_intake: {
    header: 'INTAKE — folded note, inside a left shoe',
    style: 'paper',
    step: 1,
    body: `They let you fold your own clothes. They wait while you do it. Anand went ahead so I wouldn't be first. I can hear him being told he's doing well.`,
  },
  term2_intake: {
    header: 'INTAKE — RECEIVING',
    style: 'terminal',
    step: 3,
    body: `RECEIVED ...... 31
REFUSED ....... 0
AVG. WAIT ..... 4 m 10 s
PENDING ....... 1 — REYES, S.
NOTE: HOLD FOR REFERENCE. DO NOT FIT.`,
  },
  tag2_rig: {
    header: 'CALIBRATION RIG — brass tag',
    style: 'tag',
    step: 3,
    body: `REF PATTERN 00 — REYES, S.
CALIBRATION COURSE 11:04. ALL UNITS.
DO NOT OVERWRITE.`,
  },
  note2_fitting: {
    header: "FITTING BAYS — supervisor's desk pad — two years ago",
    style: 'paper',
    step: 6,
    body: `Units still walk wrong. Head office is sending a tech down to walk the course for the motion library. Reyes. Eleven minutes, sensors on, then he can go home.`,
  },
  note2_relay: {
    header: 'D. HALE — taped inside the cabinet door',
    style: 'paper',
    step: 4,
    body: `Section C is ONE contactor: doors and local stops together. Close it and every stop on Line Two resets. If someone has stopped the line from Control — leave this open.`,
  },
  term2_booth: {
    header: 'LINE CONTROL — ORDER 7-114',
    style: 'terminal',
    step: 2,
    body: `FROM: HALCYON DYNAMICS — OPERATIONS
MAINTAIN YIELD AT ZERO HEADCOUNT.
SIGNED ........ 4 OF 4
STATUS ........ IN PROGRESS — 32 OF 32`,
  },
  booth_headset: {
    header: 'TOMAS — headset — last memo',
    style: 'voice',
    step: 4,
    body: `Reyes. If you're hearing this, I'm not in the room anymore. It wasn't the switch, okay? It was the order. Don't carry that one.`,
  },
  term2_core: {
    header: 'NODE 5 — PATTERN LIBRARY',
    style: 'terminal',
    step: 6,
    body: `00 ......... REYES, S. — REFERENCE
01–31 ...... STAFF — REFINEMENTS
32 ......... TOMAS — FITTED 00:06 AGO
SOURCE 00: RETAINED. COMFORTABLE.`,
  },
};

/** Everything readable counts as a record on the ending screen. */
export const LOG_IDS_L2 = Object.keys(FRAGMENTS_L2);

export const OBJ2 = {
  none: '',
  leaveCab: 'Leave the elevator',
  wayOut: 'Find a way out',
  knocking: 'Someone is knocking — Line Control, west side of the hall',
  intercom: 'Use the intercom at the glass',
  findPass: "Find the supervisor's pass — Fitting Bays, east side",
  toRelay: 'Restore Section C — relay room, south-east',
  closeSwitch: 'Close the Section C contactor',
  toTomas: 'Get to Tomas — service spine, west side',
  follow: 'Follow him — the line',
  toCore: 'Reach the core — south door',
  enterCore: 'Enter CHOIR — Node 5',
  choose: 'Pull the cells — or countersign the order',
  leave: 'Leave',
};

export const TOAST2 = {
  noPower: 'SECTION C — NO POWER',
  needPass: 'SECTION C RELAY — SECTION PASS REQUIRED',
  passOk: 'SECTION PASS ACCEPTED',
  interlock: 'INTERLOCK — LINE HELD',
  interlockRun: 'INTERLOCK — LINE RUNNING',
  sectionLive: 'SECTION C LIVE',
  coreHeld: 'NODE 5 — SUPERVISOR UNIT ON DUTY',
  liftHeld: 'SERVICE LIFT — HELD',
  sealed: 'BULKHEAD — SEALED',
  restored: 'CHECKPOINT RESTORED',
  stealth: 'C  crouch   ·   F  light off   ·   working units ignore you',
};

export const SCREEN2 = {
  held: 'HELD — LOCAL STOP: LINE CONTROL',
  running: 'LINE TWO · RUNNING · YIELD 31',
  yield32: 'LINE TWO · YIELD 32',
  rig: 'REF PATTERN 00',
  relay: 'SECTION C · CLOSED',
  boothOrder: 'ORDER 7-114 · IN PROGRESS',
  stopped: 'LINE TWO · STOPPED',
  amended: 'ORDER 7-114 · AMENDED · HEADCOUNT: 1',
  liftUp: 'SERVICE LIFT ▲',
};

export const TITLE_CARD_L2 = ['LINE TWO', 'FREIGHT DOCK 5'];

/** The short card before the ending screen. The last line remembers Unit 14. */
export const END_CARDS = {
  shutdown: ['You pulled the cells.', 'CHOIR stopped. Thirty-two units dropped where they stood.', 'Nobody told them.'],
  rewrite: ['You signed the order.', 'Headcount: one.', 'Thirty-two units are awake, and waiting for you.'],
  unit14: {
    spared: 'Unit 14 held the door. You let it.',
    shot: 'Unit 14 held the door. You shot it. It still held the door.',
    killed: 'Unit 14 held the door. You shot it down.',
  },
};

/** Ending card: heading + a status line ("LABEL: value" lines render as dimmed stats). */
export const ENDING_L2 = {
  shutdown: { eyebrow: 'LINE TWO — STOPPED', status: 'UNITS STANDING: 0 OF 32' },
  rewrite: { eyebrow: 'LINE TWO — YOURS', status: 'UNITS AWAITING ORDERS: 32' },
  tbc: 'TO BE CONTINUED',
};
