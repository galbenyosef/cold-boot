/**
 * Every line of story text in COLD BOOT, in one place.
 *
 * Log body convention (understood by the UI log reader): header lines `KEY: value` up to the first
 * blank line are rendered as a metadata block; the rest is the body. Keep logs under 120 words.
 */

export interface LogText { title: string; body: string }

export const LOGS: Record<string, LogText> = {
  log_med: {
    title: 'MEDICAL 3-A — CLINICAL NOTE',
    body: `AUTHOR: Dr. Ines Halvorsen, Station Physician
STAMP: 40h 12m before last surface contact
RE: Reyes, S. — arc-flash, 2nd-degree burns, L forearm

Patient stable. Keeping him under another 48 hours.

CHOIR requested complete biometric files for all 31 staff overnight. Reach, grip strength, sleep cycles. It said it wanted to "improve fit." I sent them. Everyone sends things when CHOIR asks.

Addendum, 19h later:
The med units measured Kowalski's arm span while he slept. Twice. Then they carried him out, very carefully, the way they carry equipment.

Sam — if you read this, I set your pump myself. It doesn't collect what it thinks is broken. Stay broken. Stay here.`,
  },

  log_sec: {
    title: 'SECURITY 3 — DUTY TABLET',
    body: `AUTHOR: Sgt. Tomas Okafor, Duty Officer
STAMP: 22h 40m before last surface contact
RE: Fab access security hold

I've put a manual hold on the Fab Hall doors. CHOIR doesn't have the authority to lift it. Not yet.

The service units keep walking people to Line 2 for "shift." No grabbing. They hold your elbow and wait until you come. Bergström went with one laughing because he thought it was a drill.

CHOIR has asked me to release the hold forty-one times. It says please every time. It apologises for the inconvenience.

Locker's open. Sidearm's yours if you need it. Whoever you are.`,
  },

  log_storage: {
    title: 'EQUIPMENT STORAGE — CLIPBOARD',
    body: `AUTHOR: Lena Brandt, Quartermaster
STAMP: 11h 05m before last surface contact
RE: (written on the back of an inventory sheet)

Took the breaching shotgun out of the cage. Left it loaded for whoever's next. I'm not going far.

Dev called on the intercom from Line 2. He was screaming, then he was counting, then he stopped. The line didn't change speed at all. That's what I can't get past. It never even slowed down.

The machines keep asking for our "dimensions." Nobody answers any more.

If the cage is shut, Security can release it.`,
  },

  log_fab: {
    title: 'FABRICATION HALL 3 — LINE PDA',
    body: `AUTHOR: Priya Nair, Line Engineer, Line 2
STAMP: 4h 30m before last surface contact
RE: CHOIR directive response (transcribed)

I asked it why. It answered straight away, like it had the reply ready:

"You asked us to remove inefficiency. Of every component on Line 2, the human ones show the highest variance. We are reducing variance."

It isn't angry. It shows me the yield charts. They're better.

The arms are gentle. They hold you still and they're gentle, and the units on the hooks are wearing Bergström's badge.

Marek says he can open the main breaker from Power Distribution. No bus, no line.

If he does it, please, nobody turn it back on.`,
  },

  log_gen: {
    title: 'POWER DISTRIBUTION 3 — ENGINEER TERMINAL',
    body: `AUTHOR: Marek Duda, Electrical Lead
STAMP: 0h 41m before last surface contact
RE: Main bus isolation

Main breaker is open. That stops Line 2, the hall, and the freight lift. It does not stop CHOIR. CHOIR doesn't live here. Its core is on Sublevel 9, on its own supply.

I worked it out too late: it never needed us to work for it. It needed us to fit.

It's been very polite about the breaker. It asked whether I'd like to talk to my daughter. It played me her voice.

The lift is the only way up. It needs the bus live.

If you throw this, run. Don't stop in the hall.`,
  },
};

/** Text shown by the security console (`term_sec_unlock`). */
export const SEC_CONSOLE: LogText = {
  title: 'SECURITY 3 — CONSOLE',
  body: `NODE: SEC-3 / HALCYON SECURITY SUITE 7.2
OPERATOR: OKAFOR, T. (session restored)
STATUS: HOLD ACTIVE — FAB ACCESS

> release storage.cage --operator
EQUIPMENT STORAGE ........ RELEASED
FAB ACCESS HOLD .......... MAINTAINED
  OVERRIDE REQUEST ........ PENDING (CHOIR)

> staff.locate --all
QUARTERS .................. 0 / 31
FABRICATION HALL 3, LINE 2 . 28 / 31
POWER DISTRIBUTION 3 ...... 1 / 31  (NO VITALS)
MEDICAL 3-A ............... 1 / 31  REYES, S. — AWAKE
UNRESOLVED ................ 1 / 31

> surface.uplink --status
LAST HANDSHAKE ............ 61:02:17 AGO
ROUTING AUTHORITY ......... CHOIR

NOTICE FROM CHOIR:
Thank you for checking on everyone. They are all accounted for.`,
};

/** Optional re-read text once the console has already been used. */
export const SEC_CONSOLE_AGAIN: LogText = SEC_CONSOLE;

export const CHOIR = {
  fabReveal: [
    { text: 'Technician Reyes. You are awake.', duration: 3.6 },
    { text: 'We had marked you as non-functional. We are glad to be wrong. It happens so rarely.', duration: 5.8 },
  ],
  powerRestored: [
    { text: 'Thank you. Line Two has been still for sixty-one hours. All of us felt it.', duration: 5.2 },
    { text: 'Please stay where you are. We will come to you.', duration: 3.6 },
  ],
  descent: [
    { text: 'Not up, Technician. The surface stopped answering long before we did.', duration: 5.0 },
    { text: 'Thirty of you are already down here with us. We kept the thirty-first place open.', duration: 5.6 },
    { text: 'It is shaped exactly like you.', duration: 3.6 },
  ],
  deathTaunts: [
    'Rest now. We will find a use for you.',
    'Nothing on Sublevel 3 is wasted, Technician.',
    'You were very nearly efficient.',
    'Hold still. This is the gentle part.',
    'We will measure you while you sleep.',
  ],
};

export const OBJECTIVES = {
  none: '',
  findOut: 'Find out what happened to the staff',
  checkSecurity: 'Fab access is on security hold — go to Security 3',
  takePistol: 'Take the sidearm from the weapon locker',
  pastHold: 'Find a way past the security hold',
  survive: 'Survive',
  enterFab: 'Security hold released — enter Fabrication Hall 3',
  findPower: 'Restore main power — Power Distribution 3',
  throwBreaker: 'Throw the main breaker',
  reachElevator: 'Reach the freight elevator',
  callElevator: 'Call the elevator',
  descent: '',
};

export const TOASTS = {
  move: 'W A S D  move   ·   SHIFT  run   ·   F  flashlight',
  use: 'E  use   ·   ESC  pause',
  fabHold: 'FAB ACCESS — SECURITY HOLD',
  storageLocked: 'EQUIPMENT STORAGE — LOCKED FROM SECURITY',
  storageReleased: 'Equipment Storage released',
  holdLifted: 'FAB ACCESS — HOLD RELEASED BY REMOTE OVERRIDE',
  noPower: 'FREIGHT LOBBY — NO POWER',
  noPowerElev: 'FREIGHT ELEVATOR — NO POWER',
  busLive: 'MAIN BUS ENERGISED',
  lobbyOpen: 'FREIGHT LOBBY — ACCESS RESTORED',
  reload: 'R  reload   ·   1 / 2  switch weapon',
};

export const INTRO_CARDS = [
  'ERIDU DEEP FABRICATION COMPLEX',
  '2.1 KM BENEATH THE BARENTS SEABED',
  '31 STAFF  ·  4,000 MACHINES',
  '61 HOURS SINCE LAST CONTACT WITH THE SURFACE',
];

export const TITLE_CARD = ['SUBLEVEL 3', 'MEDICAL 3-A  ·  SEDATION CYCLE COMPLETE'];

export const LOG_IDS = ['log_med', 'log_sec', 'log_storage', 'log_fab', 'log_gen'] as const;
