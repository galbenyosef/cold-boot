/**
 * Live dialogue for level 2: ONE speech channel with a queue, three priorities and interruption rules,
 * plus an overlap channel for voices that are meant to collide (units talking over each other).
 *
 *   scene — story lines. Queued in order; never dropped by `flush(true)`; a scene line cuts a bark that is
 *           playing and goes ahead of any queued talk.
 *   talk  — walking-and-talking filler (Tomas while the player crosses the hall). Queued; waits behind
 *           scene lines; dropped by `flush()`.
 *   bark  — reactions to what the player does. Only plays when the channel is idle and nothing is
 *           queued, never repeats inside its cooldown, and is cut by the next scene line.
 *
 * REVISION 5, rule R3 — no assumed order. Lines queue, so what a line says about the world may have
 * stopped being true by the time its turn comes. Every line therefore has a RULE (table `RULES` at the
 * bottom of this file, one entry per id in `voice/lines.l2.json`), evaluated at the moment the line would
 * START playing — never when it is queued:
 *   U(reason)            unconditional: a pure reaction to a trigger the player fired this instant.
 *   C(when, why, else?)  conditional: spoken only while `when(facts)` holds; otherwise the `else` variant
 *                        is tried (by its own rule), otherwise the line is skipped.
 * A caller may add its own `when` / `else` (SayOpts); both must hold. Implicit for every radio line of
 * Tomas: the player has the handset and he still wears his headset (`facts.onAir`).
 * Every decision is appended to `log` (id asked, condition result, id said) — the test oracle reads it.
 *
 * Each line: `audio.say(id)` (recorded voice, fx chosen by audio from the manifest), a subtitle with the
 * speaker name, the speaker's actor animated for the line's length (`actor.speak?.()`), and — for radio
 * voices — an intercom click when the channel opens after a silence. Time is the sequencer's (pauses with
 * the game). `fast` (tests) shortens every line to a fraction of a second.
 */
import type * as THREE from 'three';
import type { EnemyActor, GameContext, VoiceHandle } from '../../core/types';
import type { Sequencer } from '../sequencer';
import { speak, speakerName, voiceLine } from '../voice';
import type { PhaseLetter } from './phases';

export type Pri = 'scene' | 'talk' | 'bark';

export interface SayOpts {
  pri?: Pri;
  /** Subtitle label override ("UNIT 32"). */
  name?: string;
  /** World position (a function is followed while the line plays). Omit for in-the-ear voices. */
  at?: THREE.Vector3 | (() => THREE.Vector3 | null);
  /** Silence after the line before the next one (default 0.35 s). */
  gap?: number;
  /** Bark only: seconds before the same id may bark again (default 60). */
  cooldown?: number;
  /** Called on the frame the line starts (pose changes in sync). */
  onStart?: (seconds: number) => void;
  /** R3: extra condition, checked when the line is about to start (on top of the line's rule). */
  when?: () => boolean;
  /** R3: line to say instead when the condition is false (checked by its own rule). */
  else?: string;
  /** Seconds after queueing after which the line is stale and dropped (scene clocks). */
  ttl?: number;
  /** Scene only: goes in front of everything queued (an interjection between two lines). */
  next?: boolean;
}

/** One decision of the channel, for the test oracle. `cond`: null = unconditional line. */
export interface LineLog { t: number; id: string; cond: boolean | null; said: string | null; pri: Pri | 'over' }

interface Item { id: string; opts: SayOpts; pri: Pri; resolve: (played: boolean) => void; queuedAt: number }

export class Dialogue {
  /** Tests: every line takes 0.25 s. */
  fast = false;
  /** Script time of the last line start, per speaker id ('tomas', 'choir', …). */
  readonly lastSpoke = new Map<string, number>();
  /** Ids that were spoken (to the end, or cut after most of the line): what later lines may refer back to. */
  readonly heard = new Set<string>();
  readonly log: LineLog[] = [];
  /** Called for every line that starts (the script records `heard` into the save). */
  onSaid: ((id: string) => void) | null = null;
  private queue: Item[] = [];
  private current: { item: Item; said: string; startAt: number; endAt: number; handle: VoiceHandle | null; follow: (() => THREE.Vector3 | null) | null } | null = null;
  private over: { handle: VoiceHandle | null; endAt: number; follow: (() => THREE.Vector3 | null) | null }[] = [];
  private nextAt = 0;
  private cooldowns = new Map<string, number>();
  private actors = new Map<string, () => EnemyActor | null>();
  private muted = false;

  constructor(private ctx: GameContext, private seq: Sequencer, private facts: Facts) {}

  /** Who animates when `speaker` talks (looked up when the line starts; null = nobody on stage). */
  bindActor(speaker: string, get: () => EnemyActor | null): void { this.actors.set(speaker, get); }

  get busy(): boolean { return !!this.current || this.queue.length > 0; }
  get speaking(): string | null { return this.current?.said ?? null; }
  /** Seconds since `speaker` last started a line. */
  since(speaker: string): number { return this.seq.time - (this.lastSpoke.get(speaker) ?? -1e9); }

  /** Queue one line. Resolves true when it was spoken to the end, false when dropped / cut / skipped. */
  say(id: string, opts: SayOpts = {}): Promise<boolean> {
    const pri = opts.pri ?? 'scene';
    return new Promise((resolve) => {
      if (this.muted) { resolve(false); return; }
      const item: Item = { id, opts, pri, resolve, queuedAt: this.seq.time };
      if (pri === 'bark') {
        const cd = this.cooldowns.get(id) ?? -1e9;
        if (this.busy || this.seq.time < this.nextAt || this.seq.time < cd) { resolve(false); return; }
        // A bark whose condition is already false is not worth a cooldown.
        if (!this.decide(id, opts).id) { resolve(false); return; }
        this.cooldowns.set(id, this.seq.time + (opts.cooldown ?? 60));
        this.queue.push(item);
        return;
      }
      if (pri === 'scene') {
        // A new important line cuts a bark, and goes ahead of queued filler.
        if (this.current?.item.pri === 'bark') this.cut();
        for (const q of this.queue.filter((q) => q.pri === 'bark')) q.resolve(false);
        this.queue = this.queue.filter((q) => q.pri !== 'bark');
        let i = opts.next ? 0 : this.queue.findIndex((q) => q.pri !== 'scene');
        if (i < 0) i = this.queue.length;
        this.queue.splice(i, 0, item);
        return;
      }
      this.queue.push(item);
    });
  }

  /** Several lines in order; resolves when the last one ended (false if any was dropped). */
  async lines(ids: string[], opts: SayOpts = {}): Promise<boolean> {
    let ok = true;
    const all = ids.map((id) => this.say(id, opts));
    for (const p of all) ok = (await p) && ok;
    return ok;
  }

  /** A voice that does not wait its turn (units over each other, a death rattle). Returns its length (0 = skipped). */
  overlap(id: string, opts: SayOpts = {}): number {
    if (this.muted) return 0;
    const d0 = this.decide(id, opts);
    this.log.push({ t: this.seq.time, id, cond: d0.cond, said: d0.id, pri: 'over' });
    if (!d0.id) return 0;
    const l = voiceLine(d0.id);
    const at = typeof opts.at === 'function' ? opts.at() : opts.at;
    const s = speak(this.ctx, d0.id, { name: opts.name ?? (l ? speakerName(l) : undefined), position: at ?? undefined });
    const d = this.fast ? 0.25 : s.duration;
    this.over.push({ handle: s.handle, endAt: this.seq.time + d, follow: typeof opts.at === 'function' ? opts.at : null });
    this.markHeard(d0.id);
    return d;
  }

  /** Stop the line being spoken (short fade). */
  cut(): void {
    const c = this.current;
    if (!c) return;
    this.current = null;
    try { c.handle?.stop(0.12); } catch { /* ignore */ }
    this.nextAt = this.seq.time + 0.15;
    // Most of it was out: it counts as said.
    if (this.seq.time - c.startAt >= 0.7 * (c.endAt - c.startAt)) this.markHeard(c.said);
    c.item.resolve(false);
  }

  /** Drop everything queued (with `keepScene`: everything but scene lines) and cut the current line if it is one of them. */
  flush(keepScene = false): void {
    const drop = this.queue.filter((q) => !keepScene || q.pri !== 'scene');
    this.queue = this.queue.filter((q) => keepScene && q.pri === 'scene');
    for (const q of drop) q.resolve(false);
    if (this.current && (!keepScene || this.current.item.pri !== 'scene')) this.cut();
  }

  /** Cut / drop every queued or playing line of one speaker (his radio goes dead). */
  silence(speaker: string): void {
    const mine = (id: string) => voiceLine(id)?.speaker === speaker && voiceLine(id)?.fx !== 'unit';
    for (const q of this.queue.filter((q) => mine(q.id))) q.resolve(false);
    this.queue = this.queue.filter((q) => !mine(q.id));
    if (this.current && mine(this.current.said)) this.cut();
  }

  /** Death / ending: nothing more is said. */
  shutUp(): void {
    this.flush();
    for (const o of this.over) { try { o.handle?.stop(0.2); } catch { /* ignore */ } }
    this.over = [];
    this.muted = true;
  }

  update(): void {
    const now = this.seq.time;
    for (let i = this.over.length - 1; i >= 0; i--) {
      const o = this.over[i];
      if (now >= o.endAt) { this.over.splice(i, 1); continue; }
      if (o.follow && o.handle) { const p = o.follow(); if (p) { try { o.handle.setPosition(p); } catch { /* ignore */ } } }
    }
    const c = this.current;
    if (c) {
      if (c.follow && c.handle) { const p = c.follow(); if (p) { try { c.handle.setPosition(p); } catch { /* ignore */ } } }
      if (now < c.endAt) return;
      this.current = null;
      this.nextAt = now + (this.fast ? 0.05 : (c.item.opts.gap ?? 0.35));
      this.markHeard(c.said);
      c.item.resolve(true);
    }
    if (now < this.nextAt) return;
    // The next line whose condition holds NOW; the ones that fail are skipped in the same frame.
    while (this.queue.length) {
      const item = this.queue.shift()!;
      const stale = item.opts.ttl !== undefined && now - item.queuedAt > item.opts.ttl;
      const d = stale ? { id: null, cond: false as boolean | null } : this.decide(item.id, item.opts);
      this.log.push({ t: now, id: item.id, cond: d.cond, said: d.id, pri: item.pri });
      if (this.ctx.debug.verbose) console.log(`[line] ${item.id} cond=${d.cond} → ${d.id ?? 'skipped'}${stale ? ' (stale)' : ''}`);
      if (!d.id) { item.resolve(false); continue; }
      this.start(item, d.id);
      return;
    }
  }

  /**
   * R3: which id is actually spoken for `id` right now — itself, an `else` variant, or nothing.
   * `cond` is the result for the id asked for (null when it has no condition at all).
   */
  decide(id: string, opts: SayOpts = {}): { id: string | null; cond: boolean | null } {
    const first = this.check(id, opts.when);
    if (first !== false) return { id, cond: first };
    const seen = new Set([id]);
    let alt = opts.else ?? ruleOf(id)?.else;
    while (alt && !seen.has(alt)) {
      seen.add(alt);
      if (this.check(alt) !== false) return { id: alt, cond: false };
      alt = ruleOf(alt)?.else;
    }
    return { id: null, cond: false };
  }

  /** true / false = the line's condition; null = no condition applies to it. */
  private check(id: string, extra?: () => boolean): boolean | null {
    const F = this.facts;
    const l = voiceLine(id);
    const rule = ruleOf(id);
    let conditional = false, ok = true;
    try {
      if (l?.speaker === 'tomas' && !l.fx) { conditional = true; ok = ok && F.onAir; }
      if (rule?.when) { conditional = true; ok = ok && rule.when(F); }
      if (extra) { conditional = true; ok = ok && extra(); }
    } catch (e) {
      console.warn(`[story] condition of ${id} failed`, e);
      return false;
    }
    return conditional ? ok : null;
  }

  private markHeard(id: string): void {
    if (this.heard.has(id)) return;
    this.heard.add(id);
    try { this.onSaid?.(id); } catch { /* ignore */ }
  }

  private start(item: Item, id: string): void {
    const now = this.seq.time;
    const l = voiceLine(id);
    const speaker = l?.speaker ?? '';
    const radio = speaker === 'tomas' && l?.fx !== 'unit' && l?.fx !== 'recorder';
    // The channel opens with a click when he has been quiet for a moment.
    if (radio && this.since('tomas') > 4 && !this.fast) {
      try { this.ctx.audio.play('intercom_click', { volume: 0.5 }); } catch { /* ignore */ }
    }
    const at = typeof item.opts.at === 'function' ? item.opts.at() : item.opts.at;
    const s = speak(this.ctx, id, { name: item.opts.name ?? (l ? speakerName(l) : undefined), position: at ?? undefined });
    const d = this.fast ? 0.25 : s.duration;
    this.lastSpoke.set(l?.fx === 'unit' ? 'unit' : speaker, now);
    this.current = { item, said: id, startAt: now, endAt: now + d, handle: s.handle, follow: typeof item.opts.at === 'function' ? item.opts.at : null };
    if (l?.fx !== 'unit' && l?.fx !== 'recorder') {
      try { this.actors.get(speaker)?.()?.speak?.(d); } catch { /* ignore */ }
    }
    try { item.opts.onStart?.(d); } catch (e) { console.warn('[story] line onStart failed', e); }
  }
}

// ───────────────────────────────────────────────────────────── the world, as the lines see it

/**
 * Everything a line's condition may ask. Implemented by the script from live world state (`facts` in
 * script.ts); every member is cheap and side-effect free.
 */
export interface Facts {
  /** The player has the handset AND Tomas still wears his headset (not yet through the tunnel mouth). */
  readonly onAir: boolean;
  /** The design's phase letter (D covers the relay fight and after; G the escort fight and after). */
  readonly phase: PhaseLetter;
  /** Room id the player stands in. */
  readonly room: string | null;
  readonly met: boolean;
  readonly fitOpen: boolean;
  readonly pass: boolean;
  readonly power: boolean;
  /** The belt is moving. */
  readonly lineRunning: boolean;
  /** Awake, hunting enemies anywhere. */
  readonly hostiles: number;
  readonly health: number;
  /** The line `id` was said (to the end, or nearly) at some point of this run — also across loads. */
  heard(id: string): boolean;
  visited(room: string): boolean;
  /** Living members of a group / those still inert / those awake. */
  alive(group: string): number;
  dormant(group: string): number;
  awake(group: string): number;
  /** The group has living members and every one of them is still calmly working / inert. */
  calm(group: string): boolean;
  /** Awake members of the three working groups (dock, intake, treadmills). */
  readonly awakeWorkers: number;
  /** Working units (dock, intake, treadmills) and Unit 14 shot dead by the player. */
  readonly workersKilled: number;
  /** REVISION 6.1: 32 − the units left on the line (every unit destroyed or removed in this level). */
  readonly unitsGone: number;
  /** The supervisor is dead (phase I: the core door answers). */
  readonly foremanDead: boolean;
  workerKilledWithin(seconds: number): boolean;
  /** A working unit was made hostile or shot within the last `seconds`. */
  provokedWithin(seconds: number): boolean;
  /** Every member of the group is dead and the player killed them (not a silent removal). */
  killedByPlayer(group: string): boolean;
  firedWithin(seconds: number): boolean;
  hurtWithin(seconds: number): boolean;
  movedWithin(seconds: number): boolean;
  read(id: string): boolean;
  /** The readable `id` is open now or was closed within the last `seconds`. */
  readWithin(id: string, seconds: number): boolean;
  /** A note / terminal is on screen (or was a moment ago). */
  readonly reading: boolean;
  /** The player tried this locked door within the last `seconds`. */
  deniedWithin(door: string, seconds: number): boolean;
  /** …any of the unpowered Section C doors. */
  deadDoorWithin(seconds: number): boolean;
  /** Is the player's distance to the fitting door shrinking (already on the way)? */
  readonly headingToFitting: boolean;
  /** Hall, north of the partition, within 4 m of the booth glass. */
  readonly atGlass: boolean;
  readonly atCoreDoor: boolean;
  /** Tomas is in the booth, waving, and the player is looking at him through the hall glass. */
  readonly seesTomasWaving: boolean;
  /** Tomas is alive in the booth (not yet led out). */
  readonly tomasInBooth: boolean;
  readonly tomasAtDoor: boolean;
  /** The treadmill units fell into step within the last `seconds`. */
  syncWithin(seconds: number): boolean;
  /** The projection of pattern 14: 'rig' walking in place on the fourth rig, 'walk' leaving, 'station' standing somewhere, 'none'. */
  readonly ghost: 'none' | 'rig' | 'walk' | 'station';
  /** It exists, is behind the player (outside the view), within 25 m, and was not talked about in the last 60 s. */
  readonly ghostBehind: boolean;
  /** It walked through the wall in front of the player within the last `seconds`. */
  ghostThroughWallWithin(seconds: number): boolean;
  /** The reference pattern is playing on the calibration rig. */
  readonly rigPlaying: boolean;
  /** A living alcove unit is awake, within 10 m and outside the player's view. */
  readonly wakeBehind: boolean;
  /** The alcove units woke and were fought. */
  readonly fitFought: boolean;
  /** A torch beam is on a calm working unit's face. */
  readonly lightOnWorker: boolean;
  // ── the taking ──
  /** Within 4 m of a spine window, with a clear line to Tomas's face. */
  readonly atWindow: boolean;
  /** A unit has each of his arms. */
  readonly held: boolean;
  /** He was led out and the hall door shut behind them. */
  readonly taken: boolean;
  /** He lies on the belt, not yet at the mouth. */
  readonly tomasOnBelt: boolean;
  /** He has gone through the mouth. */
  readonly loaded: boolean;
  /** The player shot a booth window during the taking. */
  readonly shotGlass: boolean;
  /** …any booth pane, within the last `seconds`. */
  shotBoothGlassWithin(seconds: number): boolean;
  readonly escortsDead: boolean;
  /** Standing on the moving belt / inside the fitting tunnel. */
  readonly onBelt: boolean;
  readonly inTunnel: boolean;
  readonly unit32Alive: boolean;
  readonly unit32Dead: boolean;
  readonly foremanStarted: boolean;
  readonly unit14Alive: boolean;
  /** Unit 14 is alive, inert, and within 6 m of the player. */
  readonly unit14Near: boolean;
  unit14ShotWithin(seconds: number): boolean;
  /** The player has been inside the core. */
  readonly core: boolean;
  readonly offered: boolean;
  readonly choice: boolean;
}

// ───────────────────────────────────────────────────────────── the rules (R3): one per spoken line

export interface Rule { when?: (F: Facts) => boolean; else?: string; why: string }
/** Unconditional: a pure reaction to a trigger the player fired this instant. */
const U = (why: string): Rule => ({ why });
/** Conditional: said only while `when` holds at the moment the line starts; `otherwise` = variant id. */
const C = (when: (F: Facts) => boolean, why: string, otherwise?: string): Rule => ({ when, why, else: otherwise });

const preSwitch = (F: Facts) => !F.power;
const inRelay = (F: Facts) => F.room === 'relay' && !F.power;
const treadCalm = (F: Facts) => F.room === 'fitting' && F.calm('g2_fit_tread');
/** REVISION 6.1 — in the core room, before the choice: the entry lines (leaving and coming back resumes them). */
const inCore = (F: Facts) => F.room === 'core' && !F.choice;
/**
 * REVISION 6.1 — the backstory (`_2`…`_8`): flavour, never a gate. Said over the hall PA from the supervisor's
 * death on, wherever the player is — and what was not heard then, in the idle slots inside. Never over a fight.
 */
const backstory = (F: Facts) => F.foremanDead && !F.choice && F.hostiles === 0;

export const RULES: Record<string, Rule> = {
  // ── arrival, the tidy place ──
  l2_unit_cab_arrive: U('the lift stopping — inside the arrival cutscene'),
  l2_choir_arrive: C((F) => !F.visited('line'), 'a welcome: only before the player has reached the hall'),
  l2_choir_dock: C((F) => F.room === 'dock' && F.calm('g2_dock'), 'only in the dock, while its working unit is alive and calm'),
  l2_choir_provoked: C((F) => F.provokedWithin(12), 'a working unit was provoked or shot in the last 12 s'),
  l2_choir_intake: C((F) => F.room === 'intake', 'the player is in intake'),
  l2_choir_gauge: C((F) => F.room === 'intake' || F.room === 'line', 'the gauge just dropped beside the player (t2_intake_arch)'),
  l2_unit_fitting_denied: C((F) => !F.fitOpen && F.deniedWithin('d2_fitting', 3), 'the fitting door was tried while still unpowered'),

  // ── first talk (the intercom press takes the handset) ──
  l2_tomas_hello_1: U('the intercom press'),
  l2_tomas_hello_2: C(preSwitch, 'introduction: before the switch'),
  l2_tomas_hello_3: C(preSwitch, 'introduction: before the switch (the joke Unit 32 repeats)'),
  l2_tomas_fitting_wait: C((F) => F.met && !F.fitOpen && F.deniedWithin('d2_fitting', 6), 'the fitting door was tried before he unlocked it'),
  l2_tomas_unlock: U('d2_fitting unlocking — the story does it on the frame this line starts'),
  l2_tomas_hello_4: C((F) => F.heard('l2_tomas_hello_3') && !F.power, 'apologises for the joke: only if the joke was heard'),
  l2_tomas_reyes: C(preSwitch, 'before the switch'),
  l2_tomas_oneway: C(preSwitch, 'before the switch'),
  l2_tomas_estop_1: C(preSwitch, 'the line is still held'),
  l2_tomas_estop_2: C((F) => !F.power && F.heard('l2_tomas_estop_1'), 'follows the e-stop line; doors still locked'),
  l2_tomas_sulking: C(preSwitch, 'CHOIR has not spoken to him yet (it does at the switch)'),
  l2_tomas_ask: C(preSwitch, 'Section C is still dead'),
  l2_tomas_pass: C((F) => !F.pass, 'the pass is not taken yet'),
  l2_tomas_handset: C(preSwitch, 'before the switch'),
  l2_tomas_go: C(preSwitch, 'before the switch'),

  // ── guiding, the order ──
  l2_tomas_guide_east: C((F) => F.fitOpen && !F.pass && !F.visited('fitting') && !F.headingToFitting && F.room === 'line', 'fitting bays not reached, not already heading there, pass not taken'),
  l2_tomas_order_1: C(preSwitch, 'before the switch; no fight'),
  l2_tomas_order_2: C(preSwitch, 'before the switch'),
  l2_tomas_order_3: C((F) => !F.power && F.heard('l2_tomas_order_2'), 'needs the order read out'),
  l2_tomas_order_4: C((F) => !F.power && F.heard('l2_tomas_order_2'), 'needs the order read out'),
  l2_tomas_order_5: C((F) => !F.power && F.heard('l2_tomas_order_3'), 'needs "four people signed it"'),

  // ── fitting bays ──
  l2_tomas_stealth_1: C(treadCalm, 'in the fitting bays, treadmill units alive and calm'),
  l2_tomas_stealth_2: C(treadCalm, 'in the fitting bays, treadmill units alive and calm'),
  l2_tomas_treadmills: C(treadCalm, 'in the fitting bays, treadmill units alive and calm'),
  l2_tomas_sync: C((F) => treadCalm(F) && F.syncWithin(8), 'the treadmill units just fell into step, and are still calm'),
  l2_tomas_unit14: C((F) => F.ghost === 'rig' && F.room === 'fitting', 'the projection is walking on the fourth rig and the player is in the room'),
  l2_tomas_unit14_off: C((F) => F.ghostThroughWallWithin(8), 'it walked through the wall in view within the last 8 s'),
  l2_tomas_rig_1: C((F) => F.rigPlaying && !F.read('tag2_rig') && F.room === 'fitting', 'the reference pattern is playing; tag not read yet'),
  l2_tomas_rig_2: C((F) => F.readWithin('tag2_rig', 10), 'the tag is open or was just closed'),
  l2_tomas_rig_3: C((F) => F.heard('l2_tomas_rig_2') && !F.power, 'follows the tag line'),
  l2_tomas_rig_4: C((F) => F.heard('l2_tomas_rig_2') && !F.pass, 'follows the tag line; pass still on the desk'),
  l2_tomas_pass_taken: C((F) => F.dormant('g2_fit_wake') > 0, '"…oh no": alcove units alive and about to stand up', 'l2_tomas_pass_taken_quiet'),
  l2_tomas_pass_taken_quiet: C((F) => F.pass && F.alive('g2_fit_wake') === 0 && !F.visited('relay'), 'alcove units already dead; relay not found yet'),
  l2_tomas_fit_fight: C((F) => F.wakeBehind, '"Behind you!": a living alcove unit within 10 m, outside the view', 'l2_tomas_fit_fight_front'),
  l2_tomas_fit_fight_front: C((F) => F.awake('g2_fit_wake') > 0, 'an alcove unit is up and alive'),
  l2_tomas_fit_after_1: C((F) => F.fitFought && F.hostiles === 0 && F.firedWithin(6), '"That was loud": the player fired in the last 6 s', 'l2_tomas_fit_after_quiet'),
  l2_tomas_fit_after_quiet: C((F) => F.fitFought && F.hostiles === 0, 'after the alcove fight, nothing loud'),
  l2_tomas_fit_after_2: C((F) => F.fitFought && F.hostiles === 0 && F.heard('l2_tomas_hello_3') && !F.power, 'after the fight; repeats his joke (needs the joke)'),

  // ── across the hall ──
  l2_tomas_cross_1: C((F) => F.pass && !F.visited('relay') && !F.power, 'directions to the relay: not there yet'),
  l2_tomas_cross_wave: C((F) => F.seesTomasWaving, 'he is waving and the player is looking at him through the glass'),
  l2_tomas_coffee_1: C((F) => !F.power && F.hostiles === 0, 'before the switch; no fight'),
  l2_tomas_mum: C((F) => !F.power && F.hostiles === 0, 'before the switch; no fight'),
  l2_tomas_hall_fight: C((F) => F.awake('g2_hall_mid') > 0, 'the hall ambush is alive'),
  l2_tomas_hall_after: C((F) => F.killedByPlayer('g2_hall_mid') && !F.power && F.hostiles === 0, 'the player killed the ambush'),

  // ── the relay room ──
  l2_tomas_relay_1: C(inRelay, 'in the relay room, switch open'),
  l2_tomas_relay_2: C(inRelay, 'in the relay room, switch open'),
  l2_tomas_relay_cam: C(inRelay, 'in the relay room (no cameras), switch open'),
  l2_tomas_relay_breaker: C(preSwitch, 'before the switch'),
  l2_tomas_relay_wait_1: C(inRelay, 'in the relay room, switch still open'),
  l2_tomas_relay_wait_2: C((F) => !F.power && F.readWithin('note2_relay', 12), "Hale's note is open or was just closed"),

  // ── Section C ──
  l2_choir_power_1: U('the relay switch'),
  l2_choir_power_2: C((F) => F.lineRunning, 'the line has started'),
  l2_tomas_power_1: C((F) => F.phase === 'D' && F.lineRunning, 'the line is moving; he is not yet taken'),
  l2_tomas_power_2: C((F) => F.phase === 'D' && F.heard('l2_tomas_power_1'), 'follows "why\'s the line moving"'),
  l2_tomas_power_3: C((F) => F.phase === 'D', 'his door shows CYCLING; the player is not in the trap yet'),
  l2_tomas_run_1: C((F) => F.phase === 'D' && F.tomasAtDoor, 'dawdling: he is standing at his door'),
  l2_tomas_run_3: C((F) => F.phase === 'D', 'dawdling'),
  l2_tomas_run_wait: C((F) => F.phase === 'D' && F.heard('l2_tomas_run_3'), 'dawdling: he asked before'),

  // ── the taking ──
  l2_tomas_run_4: C((F) => F.phase === 'E' && !F.held, 'the hall door is opening (scene clock) and they have not reached him'),
  l2_tomas_window_1: C((F) => F.phase === 'E' && !F.held && F.atWindow, '"you made it": the player is at a window and can see him', 'l2_tomas_window_1_far'),
  l2_tomas_window_1_far: C((F) => F.phase === 'E' && !F.held && !F.atWindow, 'he cannot see the player'),
  l2_tomas_window_3: C((F) => F.phase === 'E' && !F.held && !F.shotGlass, 'the player has not shot the glass'),
  l2_tomas_shot_glass: C((F) => F.phase === 'E' && F.shotBoothGlassWithin(3), 'the player just shot the window'),
  l2_tomas_window_2: C((F) => F.held && !F.taken, 'the units have his arms; still in the booth'),
  l2_unit_take_1: C((F) => F.held, 'a unit has his arm'),
  l2_unit_take_2: C((F) => F.held, 'a unit has his arm'),
  l2_tomas_window_4: C((F) => F.held && F.heard('l2_tomas_mum'), 'needs the oil-rig line', 'l2_tomas_window_4_plain'),
  l2_tomas_window_4_plain: C((F) => F.held, 'held; the oil-rig line was never heard'),
  l2_tomas_window_5: C((F) => F.held && !F.tomasOnBelt, 'held by the arms'),
  l2_tomas_window_6: C((F) => F.tomasOnBelt && F.heard('l2_tomas_coffee_1'), 'on the belt; needs the coffee promise', 'l2_tomas_window_6_plain'),
  l2_tomas_window_6_plain: C((F) => F.tomasOnBelt, 'on the belt; the coffee promise was never heard'),
  l2_choir_window: C((F) => F.taken && !F.loaded, 'he was led out and is not yet through the mouth'),
  l2_choir_glass: C((F) => F.shotBoothGlassWithin(6), 'the player shot the booth glass in the last 6 s'),
  l2_tomas_headset_1: U('picking up his recorder'),
  l2_tomas_headset_2: U('picking up his recorder'),

  // ── the ride ──
  l2_choir_tunnel: C((F) => F.inTunnel && F.lineRunning, 'the player is inside the tunnel on the running belt'),
  l2_choir_nudge: C((F) => F.phase === 'G' && F.escortsDead && !F.inTunnel && !F.onBelt, 'escorts dead, player has not boarded'),
  l2_choir_apron: C((F) => F.phase === 'H' && !F.unit32Alive && !F.unit32Dead, 'off the belt; Unit 32 not out yet'),

  // ── Unit 32 (his lines, emptied) ──
  l2_unit32_1: C((F) => F.unit32Alive && F.heard('l2_tomas_hello_3'), 'needs the coffee joke', 'l2_unit32_plain'),
  l2_unit32_plain: C((F) => F.unit32Alive, 'Unit 32 is alive'),
  l2_unit32_2: C((F) => F.unit32Alive && F.heard('l2_tomas_hello_4'), 'needs "I do jokes when I\'m scared"'),
  l2_unit32_3: C((F) => F.unit32Alive && F.heard('l2_tomas_run_3'), 'needs "tell me you\'re close"'),
  l2_unit32_4: C((F) => F.unit32Alive && F.heard('l2_tomas_go'), 'needs "thanks for being a person"'),
  l2_unit32_5: C((F) => F.unit32Alive && F.heard('l2_tomas_cross_wave'), 'needs "I\'m the one waving"'),
  l2_unit32_die: C((F) => F.heard('l2_tomas_coffee_1'), 'needs the biscuit', 'l2_unit32_die_plain'),
  l2_unit32_die_plain: U('Unit 32 dying'),
  l2_choir_unit32_1: C((F) => F.unit32Dead && !F.foremanStarted, 'Unit 32 is dead; before the supervisor'),
  l2_choir_unit32_2: C((F) => F.unit32Dead && !F.foremanStarted, 'Unit 32 is dead; before the supervisor'),

  // ── the supervisor, Unit 14 ──
  l2_choir_foreman: U('the supervisor trigger (hall z < −60 after Unit 32)'),
  l2_unit14_door: C((F) => F.unit14Near, 'Unit 14 is alive, inert and within 6 m'),
  l2_unit14_shot: U('Unit 14 being shot'),
  l2_unit14_die: U('Unit 14 dying'),
  l2_choir_unit14_shot: C((F) => F.unit14ShotWithin(12), 'Unit 14 was shot in the last 12 s'),

  // ── the core (REVISION 6 / 6.1) ──
  l2_choir_core_2: C(backstory, 'backstory: supervisor dead, no choice made, nothing hostile awake'),
  l2_choir_core_3: C(backstory, 'backstory: supervisor dead, no choice made, nothing hostile awake'),
  l2_choir_core_4: C(backstory, 'backstory: supervisor dead, no choice made, nothing hostile awake'),
  l2_choir_core_6: C(backstory, 'backstory: supervisor dead, no choice made, nothing hostile awake'),
  l2_choir_core_7: C((F) => backstory(F) && F.unitsGone < 4, 'count: fewer than four units are gone (unitsLeft)', 'l2_choir_core_7_killed'),
  l2_choir_core_7_killed: C((F) => backstory(F) && F.unitsGone >= 4, 'count: four or more units are gone (unitsLeft)'),
  l2_choir_core_8: C(backstory, 'backstory: supervisor dead, no choice made, nothing hostile awake'),
  l2_choir_core_1: C(inCore, '"Come in": the player is inside, no choice made'),
  l2_choir_offer: C(inCore, 'describes the two plates: the player is in the room, no choice made'),
  l2_choir_offer_stop: C(inCore, 'describes the amber plate: in the room, no choice made (queued once: script)'),
  l2_choir_offer_command: C(inCore, 'describes the white plate: in the room, no choice made (queued once: script)'),
  l2_choir_core_14: C(inCore, 'in the room, no choice made'),
  l2_choir_core_idle_1: C((F) => F.offered && !F.choice, 'both scanners live, no choice made'),
  l2_choir_core_idle_2: C((F) => F.offered && !F.choice && F.met, 'both scanners live, no choice made; the player knew Tomas'),
  l2_choir_shutdown_1: U('the STOP scan completed'),
  l2_choir_shutdown_2: U('the STOP scan completed — the line stops on this line; states no count'),
  l2_choir_shutdown_3: U('the STOP scan completed'),
  l2_choir_rewrite_1: U('the COMMAND scan completed'),
  l2_choir_rewrite_2: U('the COMMAND scan completed — the line stops on this line; states no count'),
  l2_choir_rewrite_3: U('the COMMAND scan completed'),
  l2_unit14_wait: C((F) => F.unit14Alive, "Okafor's voice only while Unit 14 stands", 'l2_unit_wait'),
  l2_unit_wait: U('the COMMAND scan completed — another unit answers'),
  l2_unit_lift: U('the lift button'),

  // ── barks (Tomas reacting; all need the handset) ──
  l2_tomas_bark_stop_1: C((F) => !F.movedWithin(20) && F.hostiles === 0 && !F.power, 'the player has stood still for 20 s'),
  l2_tomas_bark_stop_2: C((F) => !F.movedWithin(20) && F.hostiles === 0 && !F.power, 'the player has stood still for 20 s'),
  l2_tomas_bark_shots_1: C((F) => F.firedWithin(6) && F.hostiles === 0 && !F.power, 'a shot in the last 6 s, nothing hostile'),
  l2_tomas_bark_shots_2: C((F) => F.firedWithin(6) && F.hostiles === 0 && !F.power, 'a shot in the last 6 s, nothing hostile'),
  l2_tomas_bark_killed_worker: C((F) => F.workerKilledWithin(10) && !F.power, 'the player shot a working unit dead in the last 10 s'),
  l2_tomas_bark_quiet_1: C((F) => !F.power && F.hostiles === 0, 'a long silence before the switch'),
  l2_tomas_bark_quiet_2: C((F) => !F.power && F.hostiles === 0, 'a long silence before the switch'),
  l2_tomas_bark_quiet_3: C((F) => !F.power && F.hostiles === 0, 'a long silence before the switch'),
  l2_tomas_bark_back: C((F) => (F.room === 'intake' || F.room === 'dock') && !F.power, 'the player went back toward the lift'),
  l2_tomas_bark_left: C((F) => F.room === 'line' && F.fitOpen && !F.pass && !F.visited('fitting'), 'wrong side of the hall, fitting bays not found yet'),
  l2_tomas_bark_relay_locked: C((F) => !F.pass && F.deniedWithin('d2_relay', 5) && F.heard('l2_tomas_pass'), '"I said it\'s locked": he did say it', 'l2_tomas_relay_needs_pass'),
  l2_tomas_relay_needs_pass: C((F) => !F.pass && F.deniedWithin('d2_relay', 5), 'relay door tried without the pass'),
  l2_tomas_bark_spine_dead: C((F) => !F.power && F.deadDoorWithin(5) && F.heard('l2_tomas_bark_dead_first'), '"dead too": an earlier dead door was commented', 'l2_tomas_bark_dead_first'),
  l2_tomas_bark_dead_first: C((F) => !F.power && F.deadDoorWithin(5), 'an unpowered Section C door was just tried'),
  l2_tomas_bark_core_door: C((F) => F.atCoreDoor && !F.power, 'the player is at the core door before the switch'),
  l2_tomas_bark_glass_1: C((F) => F.atGlass && F.tomasInBooth && !F.power, 'the player is at the booth glass'),
  l2_tomas_bark_glass_2: C((F) => F.atGlass && F.tomasInBooth && !F.power, 'the player is at the booth glass'),
  l2_tomas_bark_hurt: C((F) => F.hurtWithin(4) && !F.power, 'the player was hit in the last 4 s'),
  l2_tomas_bark_lowhp: C((F) => F.health < 35 && !F.power, 'health below 35'),
  l2_tomas_bark_provoked: C((F) => F.awakeWorkers > 0 && !F.power, 'a working unit is awake and coming'),
  l2_tomas_bark_light: C((F) => F.lightOnWorker && !F.power, "the torch is on a calm unit's face"),
  l2_tomas_bark_read: C((F) => F.reading && !F.power, 'a note is open'),
  l2_tomas_bark_unit14: C((F) => F.ghostBehind && F.heard('l2_tomas_bark_unit14_first') && !F.power, '"again": the projection is behind the player and he mentioned it before', 'l2_tomas_bark_unit14_first'),
  l2_tomas_bark_unit14_first: C((F) => F.ghostBehind && !F.power, 'the projection is behind the player'),
  l2_tomas_shot_at: C((F) => F.shotBoothGlassWithin(3) && F.tomasInBooth && F.phase !== 'E', 'the player just shot the booth glass with him behind it'),
};

/** Lines spoken by the enemies module itself (foreman heads, working units' mutter): not the story's. */
export const ENEMY_OWNED = /^l2_(foreman_|unit_mutter_)/;

export function ruleOf(id: string): Rule | undefined { return RULES[id]; }
