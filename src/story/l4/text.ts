/**
 * Level 4 "BIOLOGICAL SYSTEMS" — every piece of written text (stage 3b §6.3–§6.4) and the ONE clock (`CLOCK4`, D20).
 * Spoken lines live in `voice/lines.l4.json` (read-only here). Readables ≤ 30 words, each stands alone (R3).
 * Foreshadowing rule (user, §13 B2): nothing here says outright that navy people are taken or controlled.
 */
import type { Fragment } from '../text';

export const TITLE_CARD_L4 = ['BIOLOGICAL SYSTEMS', 'ERIDU DEEP — BIO-SYS'];
/** §7: the stage-end card (`style: 'ending'`, 12 s, skippable). */
export const END_CARD_L4 = ['BIOLOGICAL SYSTEMS', '', 'TO BE CONTINUED'];

// ───────────────────────────────────────────────────────────── the clock (D20)

/** D20: the test hour at arrival when no carry brings one (62:10). */
export const ARRIVAL_DEFAULT = 62 + 10 / 60;
/** Fumigation / the theatre queue started Mon 08:41 = test hour 0:01; one fitting attempt every 40 s since. */
export const CLOCK4 = { fumigated: 1 / 60, attemptSeconds: 40, log: 'SUN 23:10', reply: 'MON 04:12', roster: 'MON 08:40' };

/** `h:mm:ss` of a second count (hours not wrapped: 62:09:14). */
export function hms(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
/** Cold Store 2's DOOR OPEN counter at story time `t`: (arrivalHour − 1/60) h + t. */
export const doorOpenSeconds = (arrivalHour: number, t: number) => (arrivalHour - CLOCK4.fumigated) * 3600 + t;
/** Fitting attempts completed by story time `t` (5,593 at 62:10, t 0). */
export const attemptsAt = (arrivalHour: number, t: number) => Math.floor((arrivalHour * 3600 - 60 + t) / CLOCK4.attemptSeconds);
export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-GB');

// ───────────────────────────────────────────────────────────── objectives (§6.4)

export const OBJ4 = {
  none: '',
  post4: 'Get to Post 4 — through Biological Systems',
  hold: 'Clear the containment hold — Cold Store 2',
  suite: 'Get to Post 4 — the surgical suite',
  booth: 'Release the tube door — the guard booth',
  plant: 'Equalise the tube — the plant room',
  tube: 'Through the tube to Post 4',
  gate: 'Wait for the gate',
};

export const TOAST4 = {
  restored: 'Checkpoint restored',
  holdCleared: 'Containment hold cleared',
  carbine: 'Carbine',
  equalised: 'Tube equalised',
  released: 'Tube access released',
  serviceOnly: 'Service units only',
  staffOnly: 'Sterile store — staff only',
};

// ───────────────────────────────────────────────────────────── screens (§6.4)

export const SCREEN4 = {
  decon: (n: number) => `DECON ${String(Math.max(0, n)).padStart(2, '0')}`,
  deconClear: 'CLEAR',
  showerIdle: 'AIR SHOWER — ENTER, DOOR CLOSES BEHIND YOU',
  showerClear: 'CLEAR THE DOOR',
  showerCycle: (n: number) => `CYCLE ${String(Math.max(0, n)).padStart(2, '0')}`,
  showerDone: 'CLEAN SIDE — DO NOT RETURN GOWNED',
  fumig: [
    'CLEAN SIDE — FUMIGATION COMPLETE',
    'START MON 08:41 — REQUESTED: CHOIR (CONTAINMENT)',
    'OCCUPANCY AT START: 10',
    'HABITAT NOTICE: BIO-SYS CLOSED — CONTAINMENT DRILL — STAFF REMAIN INSIDE',
    'RE-ENTRY: SAFE',
  ].join('\n'),
  /** `containment` kind (W6 format): the suite panel / the cold-store panel. */
  suiteHold: (clock: string) => `suite|hold|${clock}|<`,
  suiteCleared: 'suite|cleared',
  storeHold: (clock: string) => `store|hold|${clock}`,
  storeAck: (clock: string) => `store|ack|${clock}`,
  node2: 'NODE 2 — BIO-SYS',
  video: { idle: 'idle', paused: (i: number) => `paused|${i}`, play: (i: number, s: number, pose: string) => `play|${i}|${s.toFixed(2)}|${pose}`, static: 'static' },
  theatre: (attempt: number, link: string) => [
    `THEATRE 1 — FITTING 31 — ATTEMPT ${fmtInt(attempt)}`,
    'HOST: STRAND, E.',
    'PULSE: NONE',
    `LINK: ${link}`,
    'QUEUE: AUTO — ORDER 0031-H (YIELD)',
  ].join('\n'),
  cam: (cue: string, t: number, attempt: number) => `${cue}|${t.toFixed(2)}|${Math.round(attempt)}`,
  // (`[plain]`: the panel's text is its whole content — no scrolling log lines competing with it; screens.ts PLAIN)
  tubeIdle: '[plain]TUBE ACCESS\nRELEASE FROM BOOTH',
  tubeRefused: '[plain]RELEASE REFUSED\nPRESSURE DIFFERENTIAL 3.1 BAR\nEQUALISE AT TUBE PLANT →',
  tubeReady: '[plain]RELEASE READY',
  tubeOpen: '[plain]OPEN',
  gaugeIdle: '[plain]TUBE Δp 3.1 BAR\nEQUALISE',
  gaugeRun: (left: number, dp: number) => `[plain]EQUALISING ${String(Math.max(0, left)).padStart(2, '0')}\nΔp ${dp.toFixed(1)}`,
  gaugeDone: '[plain]Δp 0.0 — EQUALISED\nRELEASE AT BOOTH',
  gateIdle: '[plain]POST 4 — PRESSURE GATE\nNAVAL ACCESS ONLY',
  gateEq: '[plain]EQUALISING',
  gateAuth: '[plain]AUTHORISED: AAS, L. (LT.)\nPALM — LIVE',
};

/** §4.4 the arm's LINK field per cue. */
export function linkOf(cue: string): string {
  if (cue === 'handshake') return 'HANDSHAKE';
  if (cue === 'fail' || cue === 'remove' || cue === 'regel' || cue === 'return') return 'FAILED';
  return '—';
}

// ───────────────────────────────────────────────────────────── Sunde's log (§6.2: gaps and screen poses)

/** The nine lines: gap after each (s, scene-owned) and the `video_log` pose for it. */
export const SUNDE_LOG: { id: string; gap: number; pose: string }[] = [
  { id: 'l4_sunde_1', gap: 0.9, pose: 'settle' },
  { id: 'l4_sunde_2', gap: 0.5, pose: '' },
  { id: 'l4_sunde_3', gap: 1.2, pose: 'off' },
  { id: 'l4_sunde_4', gap: 0.7, pose: '' },
  { id: 'l4_sunde_5', gap: 0.6, pose: 'lean' },
  { id: 'l4_sunde_6', gap: 1.6, pose: 'down' },
  { id: 'l4_sunde_7', gap: 0.8, pose: '' },
  { id: 'l4_sunde_8', gap: 1.4, pose: '' },
  { id: 'l4_sunde_9', gap: 0, pose: '' },
];

// ───────────────────────────────────────────────────────────── readables (§6.3)

export const FRAGMENTS4: Record<string, Fragment> = {
  note4_signout: {
    header: 'GOWNING — SUIT SIGN-OUT, MON', style: 'paper', step: 1,
    body: 'OUT 07:50–08:30: Berg, Dahl, Holm, Moe, Ness, Foss, Eng, Strand, Haugen, Lie.\nIN: —',
  },
  note4_gown: {
    header: 'GOWNING ORDER', style: 'paper', step: 1,
    body: 'Hood, mask, suit, boots, gloves. Step over the bench. Air shower: six seconds. Once gowned, never return to the dirty side.',
  },
  note4_cards: {
    header: 'CAGE CARDS — PEN ROW B', style: 'tag', step: 2,
    body: 'P-01 to P-10: CLASP FITTED — COMPLIANT. P-11: NON-COMPLIANT — EUTHANISED. P-12: COMPLIANT. All compliant subjects to Phase 2 pairing, 14.08. — K. Berg',
  },
  log4_viv: {
    header: 'HUSBANDRY — K. BERG', style: 'terminal', step: 2,
    body: 'Compliant pigs don\'t eat unless told to. Told, they eat until sick. Asked Sunde who tells them. "The link." Who\'s on the link? No answer.',
  },
  note4_wet: {
    header: 'CLASP GEL — BATCH 41', style: 'paper', step: 2,
    body: 'Store at −20 °C. Seats on a live host only: it needs body heat and a pulse. Dead tissue will not link. Do not attempt.',
  },
  term4_pi: {
    header: 'SUNDE → HALCYON OPERATIONS', style: 'terminal', step: 3,
    body: 'Phase 2 suspended on my authority. The controller field is empty and something is answering.\n\nREPLY, MON 04:12: Continue. Controller to be assigned centrally.',
  },
  note4_consent: {
    header: 'VOLUNTEER CONSENT — NAVAL READINESS PROGRAMME, PHASE 2', style: 'paper', step: 3,
    body: 'Cervical interface (CLASP). I understand it advises and does not act. Signed: 23 of 23, Post 4. Witness: Lt. L. Aas. Controller: to be assigned.',
  },
  note4_tveit: {
    header: 'CONSENT — AB J. TVEIT (margin, handwritten)', style: 'paper', step: 3,
    body: 'Signed because everyone signed. It doesn\'t hurt. Sometimes I\'m somewhere and don\'t remember walking there.',
  },
  note4_list: {
    header: 'THEATRE 1 — LIST', style: 'paper', step: 4,
    body: '29 HAUGEN — NO PULSE — FAILED. 30 LIE — NO PULSE — FAILED. 31 STRAND — IN PROGRESS. 32 MOE. 33 NESS. 34 DAHL. 35 FOSS. 36 HOLM. 37 BERG. 38 ENG.',
  },
  sign4_theatre: {
    header: 'THEATRE 1 — OBSERVATION GALLERY', style: 'tag', step: 4,
    body: 'Procedures are relayed on the gallery speaker. Please do not tap the glass.',
  },
  term4_ctrl: {
    header: 'CLASP LINK ROSTER — POST 4 DETACHMENT', style: 'terminal', step: 5,
    body: 'FITTED: 23. LINK: 19 ACTIVE · 4 NO SIGNAL.\nASSIGNED CONTROLLER: NONE → NODE 2 — BIO-SYS (MON 08:40).\nCO: CDR M. KESSLER — NOT FITTED.',
  },
  note4_guard: {
    header: 'STANDING ORDERS — BIO CHECKPOINT', style: 'paper', step: 5,
    body: 'Unmanned from 09.03. Booth release stays live for Bio staff. Tube plant: equalise before every transfer. Collars are not discussed off post. — Lt. L. Aas',
  },
  note4_bunk: {
    header: 'letter, unsent', style: 'paper', step: 5,
    body: 'Mum — the collar comes off after the trial, they say. It doesn\'t itch. The little light is amber. They say it only goes red in drills. Love, Jonas',
  },
};
/** Every readable (log count) + the video log. */
export const LOG_IDS_L4 = [...Object.keys(FRAGMENTS4), 'log4_video'];
/** R8: readables that only work from inside their room (interactable id → room id). */
export const READ_ROOM4: Record<string, string> = {
  note4_list: 'scrub', sign4_theatre: 'gallery', term4_ctrl: 'chk', note4_guard: 'guard', note4_bunk: 'guard',
  note4_cards: 'vivarium', log4_viv: 'vivarium', note4_wet: 'wetlab', term4_pi: 'pi_office', log4_video: 'pi_office',
  note4_consent: 'records', note4_tveit: 'records', note4_signout: 'gown', note4_gown: 'gown',
};
