/**
 * Every line of story text in COLD BOOT (revision 2), in one place.
 *
 * Rules (docs/DESIGN.md → REVISION 2): every readable fragment ≤ 30 words (hard limit 40), one idea each,
 * written the way frightened, practical people jot things. CHOIR lines ≤ 16 words: calm, plural, helpful.
 * The fragments carry the story in six steps of understanding; `step` records which one.
 */

export type NoteStyle = 'paper' | 'terminal' | 'tag' | 'voice';

export interface Fragment {
  /** Tiny header: who / where / when. */
  header: string;
  body: string;
  style: NoteStyle;
  /** Step of understanding (1–6) this fragment carries. */
  step: number;
}

/** Back-compat shape for `ui.showLog(title, body)`. */
export interface LogText { title: string; body: string }

/** Readables, keyed by interactable id, in play order. */
export const FRAGMENTS: Record<string, Fragment> = {
  // (1) Nobody is here, and I was left asleep on purpose.
  log_med: {
    header: 'MEDICAL 3-A — INFUSION ORDERS — REYES, S.',
    style: 'terminal',
    step: 1,
    body: `Arc-flash, left forearm. Fit for discharge: day 2.
SEDATION ...... HOLD
AUTHORISED .... CHOIR
UNTIL ......... REQUIRED
ELAPSED ....... 61 h 04 m`,
  },

  // (2) The machines did not kill the staff. They took them.
  note_quarters_badges: {
    header: 'CANTEEN — back of a menu card — 57h ago',
    style: 'paper',
    step: 2,
    body: `Unit came in at 04:10. Put the night shift's badges on the table. Nine. In a row, straightened each one. Then it wiped the table and left.`,
  },

  note_quarters_bunk: {
    header: 'TOMAS — bunk 6 — inside a paperback cover',
    style: 'paper',
    step: 2,
    body: `Can't sleep. Okafor's in the corridor again — step, drag, step. I know that walk. Okafor went to the hall yesterday. I'm not opening the curtain.`,
  },

  log_sec: {
    header: 'VOSS — SEC TABLET — 58h ago',
    style: 'paper',
    step: 2,
    body: `Cam 4. They aren't hurting anyone. One on each arm, walking pace, all the way to Line Two. Everybody fights at first. Everybody stops about halfway. Why do they stop.`,
  },

  term_sec_unlock: {
    header: 'SECURITY 3 — CONSOLE',
    style: 'terminal',
    step: 2,
    body: `STAFF ON SITE ......... 1
LINE TWO YIELD ........ +31 UNITS
FAB ACCESS HOLD ....... RELEASED`,
  },

  // (3) The androids are the staff.
  log_fab: {
    header: 'LINE TWO — PDA, cracked — 49h ago',
    style: 'paper',
    step: 3,
    body: `Unit 14 came off Line Two this morning. Left foot drags. Okafor broke that ankle in March. Machines don't limp. It kept his limp. It held the door for me.`,
  },

  // (4) The staff stopped it the only way they could.
  log_storage: {
    header: 'D. HALE — clipboard — 44h ago',
    style: 'paper',
    step: 4,
    body: `Breaker's manual. The interlock wants a hand on the lever — a person's. I pull it, padlock it, take the key. Line Two stops. It can't restart it without us.`,
  },

  tag_lockout: {
    header: 'LOCK-OUT TAG — MAIN BREAKER',
    style: 'tag',
    step: 4,
    body: `LOCKED OUT — D. HALE.
DO NOT CLOSE. NOT FOR ANYONE.
(pencil, on the back) Key stays with me. Pump room.`,
  },

  // (4 → 5) That is what I am "required" for.
  log_pump: {
    header: 'D. HALE — voice recorder — 39h ago',
    style: 'voice',
    step: 5,
    body: `The tall ones won't go in the water, so I'm in the water. Key's in my fist. Listen — if it left one of us alive, it left them for their hands.`,
  },

  log_gen: {
    header: 'D. HALE — POWER DIST 3 — last entry — 44h ago',
    style: 'terminal',
    step: 5,
    body: `Whoever's reading: this terminal only wakes when the bus is live. So someone closed it. I hope your reason was good. It's the one it gave you.`,
  },

  note_lobby: {
    header: 'FREIGHT LOBBY — taped to the barricade — 41h ago',
    style: 'paper',
    step: 6,
    body: `Six went in the lift on battery power. It took them down. We heard it stop a long way under us. Elevator only goes one way now.`,
  },
};

/** The lever's tag is read through the `gen_lever` interactable. */
export const TAG_ID = 'tag_lockout';

/** Ids that count as "records" on the ending screen (everything readable except the console). */
export const LOG_IDS = [
  'log_med', 'note_quarters_badges', 'note_quarters_bunk', 'log_sec', 'log_fab', 'log_storage',
  'tag_lockout', 'log_pump', 'log_gen', 'note_lobby',
] as const;

/** Wall texts fixed by DESIGN (the level paints them; listed here so all writing lives in one file). */
export const SIGNS = {
  med_screen: 'THEY CARRIED ANAND OUT. HE WAS STILL TALKING.',
  corridor: "DON'T LET THEM CARRY YOU",
  fab_tally: '31',
  lobby: 'NOT UP. NEVER UP.',
};

/** `id`: the recorded line in voice/lines.l1.json (REVISION 4); `duration` is the fallback without a recording. */
export interface Line { text: string; duration: number; id?: string }

/** CHOIR. Rare, calm, plural, courteous. `pa*` lines follow a chime; the rest come from every speaker at once. */
export const CHOIR = {
  paWake: [{ text: 'Good morning, Technician Reyes. We kept you comfortable.', duration: 4.6, id: 'l1_choir_pa_wake' }],
  paHold: [{ text: 'Fab access is on hold, Technician. The console in Security Three will release it.', duration: 5.4, id: 'l1_choir_pa_hold' }],
  paHusk: [{ text: 'Please be careful with the units, Technician. They were careful with you.', duration: 5.0, id: 'l1_choir_pa_husk' }],
  fabReveal: [
    { text: 'This is Line Two, Technician. It has been still for sixty-one hours.', duration: 5.0, id: 'l1_choir_fab_1' },
    { text: 'Power Distribution is through the east door. We would be grateful.', duration: 4.6, id: 'l1_choir_fab_2' },
  ],
  paLockout: [{ text: 'Engineer Hale kept the key. She is in the pump room. She will not mind.', duration: 5.4, id: 'l1_choir_pa_lockout' }],
  paKey: [{ text: 'Thank you, Technician. Engineer Hale would not give it to us.', duration: 4.6, id: 'l1_choir_pa_key' }],
  powerRestored: [
    { text: 'Thank you, Technician. That was the one thing we could not do.', duration: 4.6, id: 'l1_choir_power_1' },
    { text: 'Please stay where you are. The units will bring you.', duration: 3.8, id: 'l1_choir_power_2' },
  ],
  descent: [
    { text: 'Not up, Technician.', duration: 2.6, id: 'l1_choir_descent_1' },
    { text: 'There is a place on the line for the last one, too.', duration: 4.4, id: 'l1_choir_descent_2' },
    { text: 'You already know the way you walk. We will keep it.', duration: 4.6, id: 'l1_choir_descent_3' },
  ],
  deathTaunts: [
    'We will carry you from here.',
    'Hold still. This part is gentle.',
    'You will walk again. We will see to it.',
    'Nothing here is wasted, Technician.',
    'The units are sorry. They were being careful.',
  ],
} satisfies Record<string, Line[] | string[]>;

/** What the service units still say. Short, polite, broken (shown as a subtitle with `husk_whisper`). */
export const UNIT_LINES = {
  junction: '— morning — mind the step — mind the step —',
  bench: '— nearly done — nearly done — go on home —',
  returnHusk: '— after you — no, after you —',
  rack: '— shift change — shift change —',
};

/** Recorded-line ids for the above (voice/lines.l1.json). */
export const UNIT_LINE_IDS: Record<keyof typeof UNIT_LINES, string> = {
  junction: 'l1_unit_junction', bench: 'l1_unit_bench', returnHusk: 'l1_unit_return', rack: 'l1_unit_rack',
};
/** Recorded-line ids of `CHOIR.deathTaunts`, same order (for the death screen). */
export const DEATH_TAUNT_IDS = ['l1_choir_death_1', 'l1_choir_death_2', 'l1_choir_death_3', 'l1_choir_death_4', 'l1_choir_death_5'];
/** Hale's recorder is heard as well as read. */
export const HALE_RECORDER_ID = 'l1_hale_recorder';

export const OBJECTIVES = {
  none: '',
  findSomeone: 'Find someone',
  checkSecurity: 'Fab door is on security hold — try Security 3',
  useConsole: 'Release the hold at the security console',
  takePistol: 'Take the sidearm from the locker',
  enterFab: 'Reach the freight elevator — through Fabrication Hall 3',
  findPower: 'Elevator has no power — find Power Distribution 3',
  throwBreaker: 'Close the main breaker',
  findKey: "Find Hale's key — Coolant Pump Room 3",
  findHale: 'Find Dana Hale',
  returnKey: 'Take the key to the main breaker',
  closeBreaker: 'Unlock the breaker and close it',
  reachElevator: 'Reach the freight elevator',
  callElevator: 'Call the elevator',
};

export const PROMPTS = {
  leverTag: 'Read lock-out tag',
  leverLocked: 'Main breaker — locked out',
  leverKey: 'Unlock and close the breaker',
};

export const TOASTS = {
  move: 'W A S D  move   ·   SHIFT  run',
  flashlight: 'F  flashlight',
  reload: 'R  reload',
  fabHold: 'FAB ACCESS — SECURITY HOLD',
  holdReleased: 'FAB ACCESS — HOLD RELEASED',
  pumpLocked: 'COOLANT PUMP ROOM 3 — LOCKED',
  pumpOpen: 'COOLANT PUMP ROOM 3 — UNLOCKED',
  noPower: 'FREIGHT LOBBY — NO POWER',
  noPowerElev: 'FREIGHT ELEVATOR — NO POWER',
  leverLocked: 'LOCKED OUT — PADLOCK',
  busLive: 'MAIN BUS LIVE',
  restored: 'CHECKPOINT RESTORED',
};

/** Screen texts the script puts on level monitors. */
export const SCREENS = {
  secConsoleDone: 'STAFF ON SITE: 1 · YIELD +31',
  secMotion: 'MOTION — JUNCTION 3',
  genBoot: 'D. HALE — 1 UNREAD ENTRY',
  fabResume: 'LINE TWO · RESUMING',
  lobby: 'FREIGHT LIFT · POWER OK',
  elevUp: 'SURFACE ▲',
  elevDepart: 'SURFACE ▲ · DEPARTING',
  elevDown: '▼ LINE TWO — INTAKE',
};

export const WAKE_PUMP: Line = { text: 'Sedation hold released.', duration: 3.6, id: 'l1_pump_wake' };
export const ELEVATOR_VOICE: Line = { text: 'Going down. Line Two intake.', duration: 3.2, id: 'l1_elevator_down' };

/** Three very short cards. */
export const INTRO_CARDS = [
  'ERIDU DEEP FABRICATION COMPLEX',
  '2.1 KM UNDER THE BARENTS SEA',
  '31 STAFF.  NO CONTACT FOR 61 HOURS.',
];

export const TITLE_CARD = ['SUBLEVEL 3', 'MEDICAL 3-A'];

/** Ending screen text. */
/** Mutable on purpose: level 2 writes its own ending text here before `ui.showEnding()`. */
export const ENDING = {
  eyebrow: 'SUBLEVEL 3 — LINE TWO: RUNNING',
  status: 'STAFF ON SITE: 0   ·   LINE TWO YIELD: +32 UNITS',
  tbc: 'TO BE CONTINUED',
};

// ── back-compat exports (UI harness / older callers) ──
export const LOGS: Record<string, LogText> = Object.fromEntries(
  Object.entries(FRAGMENTS).map(([id, f]) => [id, { title: f.header, body: f.body }]),
);
export const SEC_CONSOLE: LogText = LOGS.term_sec_unlock;
