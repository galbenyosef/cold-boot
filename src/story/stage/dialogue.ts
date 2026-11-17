/**
 * Shared story scaffolding — the live dialogue channel (moved from level 2, stage 3a §8.13).
 *
 * ONE speech channel with a queue, three priorities and interruption rules, plus an overlap channel for voices
 * that are meant to collide (units talking over each other).
 *
 *   scene — story lines. Queued in order; never dropped by `flush(true)`; a scene line cuts a bark that is
 *           playing and goes ahead of any queued talk.
 *   talk  — walking-and-talking filler. Queued; waits behind scene lines; dropped by `flush()`.
 *   bark  — reactions to what the player does. Only plays when the channel is idle and nothing is
 *           queued, never repeats inside its cooldown, and is cut by the next scene line.
 *
 * Rule R3 — no assumed order. Lines queue, so what a line says about the world may have stopped being true by
 * the time its turn comes. Every line therefore has a RULE (the level's `rules` table, one entry per id in its
 * `voice/lines.lN.json`), evaluated at the moment the line would START playing — never when it is queued:
 *   U(reason)            unconditional: a pure reaction to a trigger the player fired this instant.
 *   C(when, why, else?)  conditional: spoken only while `when(facts)` holds; otherwise the `else` variant
 *                        is tried (by its own rule), otherwise the line is skipped.
 * A rule may also carry `once` / `max` / `cooldown` (counted over line STARTS of that id on this page load; `once`
 * also counts `heard` from a loaded save). A caller may add its own `when` / `else` (SayOpts); both must hold.
 * A level may add an implicit condition for whole classes of lines (`DialogueConfig.implicit`, e.g. level 2: every
 * radio line of Tomas needs `facts.onAir`). Every decision is appended to `log` (id asked, condition result, id
 * said) — the test oracle reads it (`story.lineLog`).
 *
 * Each line: `audio.say(id)` (recorded voice, fx chosen by audio from the manifest), a subtitle with the speaker
 * name, the speaker's actor animated for the line's length (`actor.speak?.()`), and — for radio voices
 * (`DialogueConfig.radio`) — a click when the channel opens after a silence. Time is the sequencer's (pauses
 * with the game). `fast` (tests) shortens every line to a fraction of a second.
 */
import type * as THREE from 'three';
import type { EnemyActor, GameContext, VoiceHandle } from '../../core/types';
import type { Sequencer } from '../sequencer';
import { speak, speakerName, voiceLine, type VoiceLine } from '../voice';

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
  /**
   * Scene clocks: when the channel is free, start on THIS frame (inside `say`), not on the next `update` — a cue's
   * gesture and its line begin together (scripts/check-voice-level.mjs, SYNC). `onStart` then runs inside `say`.
   */
  now?: boolean;
  /** false (or a function returning false when the line starts): sound only, no subtitle (a screen out of sight). */
  subtitle?: boolean | (() => boolean);
}

/** One decision of the channel, for the test oracle. `cond`: null = unconditional line. */
export interface LineLog {
  t: number; id: string; cond: boolean | null; said: string | null; pri: Pri | 'over';
  /** Queued at (script time) / performance.now() when queued and when started (sync checks: the cue IS the ask). */
  q?: number; qp?: number; sp?: number;
}

/** The subtitle flag of a line as it starts (default: shown). */
function subOf(o: SayOpts): boolean {
  const f = o.subtitle;
  if (typeof f === 'function') { try { return f() !== false; } catch { return true; } }
  return f !== false;
}

// ───────────────────────────────────────────────────────────── rules (R3)

/** A line's rule. `F` is the level's facts type (what a condition may ask). */
export interface Rule<F> {
  when?: (F: F) => boolean;
  /** Variant id tried (by its own rule) when this one's condition is false. */
  else?: string;
  /** Why the line may be said — read by reviewers and printed by the oracle. */
  why: string;
  /** Said at most once per run (a heard id restored from a save counts). */
  once?: boolean;
  /** At most this many starts on this page load. */
  max?: number;
  /** Seconds between two starts of this id. */
  cooldown?: number;
}
export type Rules<F> = Record<string, Rule<F>>;
/** Unconditional: a pure reaction to a trigger the player fired this instant. */
export const U = <F>(why: string, extra: Pick<Rule<F>, 'once' | 'max' | 'cooldown'> = {}): Rule<F> => ({ why, ...extra });
/** Conditional: said only while `when` holds at the moment the line starts; `otherwise` = variant id. */
export const C = <F>(when: (F: F) => boolean, why: string, otherwise?: string, extra: Pick<Rule<F>, 'once' | 'max' | 'cooldown'> = {}): Rule<F> =>
  ({ when, why, else: otherwise, ...extra });

/** What a level hands the channel. */
export interface DialogueConfig<F> {
  /** The level's rule table (one entry per spoken id). */
  rules: Rules<F>;
  /** Line lookup (default: the shared voice DB, `voiceLine`). */
  line?: (id: string) => VoiceLine | undefined;
  /**
   * A condition that applies to a whole class of lines (checked before the rule). Return null when it does not
   * apply to `id`, else the condition's value. Level 2: radio lines of Tomas need `F.onAir`.
   */
  implicit?: (id: string, line: VoiceLine | undefined, F: F) => boolean | null;
  /** Radio voices: a click (`sound`) when one of `speakers` opens the channel after `after` s of silence. */
  radio?: { speakers: readonly string[]; sound: string; volume?: number; after?: number };
  /**
   * Line fx that are not a person on stage (no actor animation; `unit` lines are clocked as speaker 'unit';
   * `silence(speaker)` spares `unit` lines). Default ['unit', 'recorder'].
   */
  offStageFx?: readonly string[];
}

interface Item { id: string; opts: SayOpts; pri: Pri; resolve: (played: boolean) => void; queuedAt: number; queuedP: number }

export class Dialogue<F = unknown> {
  /** Tests: every line takes 0.25 s. */
  fast = false;
  /** Script time of the last line start, per speaker id ('tomas', 'choir', …). */
  readonly lastSpoke = new Map<string, number>();
  /** Ids that were spoken (to the end, or cut after most of the line): what later lines may refer back to. */
  readonly heard = new Set<string>();
  readonly log: LineLog[] = [];
  /** Called for every line that was heard (the story records `heard` into the save). */
  onSaid: ((id: string) => void) | null = null;
  private queue: Item[] = [];
  private current: { item: Item; said: string; startAt: number; endAt: number; handle: VoiceHandle | null; follow: (() => THREE.Vector3 | null) | null } | null = null;
  private over: { handle: VoiceHandle | null; endAt: number; follow: (() => THREE.Vector3 | null) | null }[] = [];
  private nextAt = 0;
  private cooldowns = new Map<string, number>();
  private actors = new Map<string, () => EnemyActor | null>();
  private muted = false;
  /** Starts per id (rule `once` / `max` / `cooldown`). */
  private starts = new Map<string, { n: number; at: number }>();
  private readonly lineOf: (id: string) => VoiceLine | undefined;
  private readonly offStage: readonly string[];

  /** `facts`: the level's facts object, or a getter for it (read when a condition is checked). */
  constructor(private ctx: GameContext, private seq: Sequencer, private facts: F | (() => F), private cfg: DialogueConfig<F>) {
    this.lineOf = cfg.line ?? voiceLine;
    this.offStage = cfg.offStageFx ?? ['unit', 'recorder'];
  }

  /** The rule of a line id in this level's table. */
  ruleOf(id: string): Rule<F> | undefined { return this.cfg.rules[id]; }

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
      const item: Item = { id, opts, pri, resolve, queuedAt: this.seq.time, queuedP: performance.now() };
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
        if (opts.now && !this.current && this.queue[0] === item && this.seq.time >= this.nextAt) this.pump();
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
    const l = this.lineOf(d0.id);
    const at = typeof opts.at === 'function' ? opts.at() : opts.at;
    const s = speak(this.ctx, d0.id, { name: opts.name ?? (l ? speakerName(l) : undefined), position: at ?? undefined, subtitle: subOf(opts) });
    const d = this.fast ? 0.25 : s.duration;
    this.over.push({ handle: s.handle, endAt: this.seq.time + d, follow: typeof opts.at === 'function' ? opts.at : null });
    this.countStart(d0.id);
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
    const mine = (id: string) => this.lineOf(id)?.speaker === speaker && this.lineOf(id)?.fx !== 'unit';
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
    this.pump();
  }

  /** Start the next queued line whose condition holds NOW; the ones that fail are skipped in the same frame. */
  private pump(): void {
    const now = this.seq.time;
    while (this.queue.length) {
      const item = this.queue.shift()!;
      const stale = item.opts.ttl !== undefined && now - item.queuedAt > item.opts.ttl;
      const d = stale ? { id: null, cond: false as boolean | null } : this.decide(item.id, item.opts);
      this.log.push({ t: now, id: item.id, cond: d.cond, said: d.id, pri: item.pri, q: item.queuedAt, qp: item.queuedP, sp: performance.now() });
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
    let alt = opts.else ?? this.ruleOf(id)?.else;
    while (alt && !seen.has(alt)) {
      seen.add(alt);
      if (this.check(alt) !== false) return { id: alt, cond: false };
      alt = this.ruleOf(alt)?.else;
    }
    return { id: null, cond: false };
  }

  private getFacts(): F { return typeof this.facts === 'function' ? (this.facts as () => F)() : this.facts; }

  /** true / false = the line's condition; null = no condition applies to it. */
  private check(id: string, extra?: () => boolean): boolean | null {
    const l = this.lineOf(id);
    const rule = this.ruleOf(id);
    let conditional = false, ok = true;
    try {
      const F = this.getFacts();
      if (this.cfg.implicit) {
        const r = this.cfg.implicit(id, l, F);
        if (r !== null) { conditional = true; ok = ok && r; }
      }
      if (rule?.when) { conditional = true; ok = ok && rule.when(F); }
      if (rule && (rule.once || rule.max !== undefined || rule.cooldown !== undefined)) {
        conditional = true;
        const s = this.starts.get(id);
        if (rule.once && (this.heard.has(id) || (s?.n ?? 0) > 0)) ok = false;
        if (rule.max !== undefined && (s?.n ?? 0) >= rule.max) ok = false;
        if (rule.cooldown !== undefined && s && this.seq.time - s.at < rule.cooldown) ok = false;
      }
      if (extra) { conditional = true; ok = ok && extra(); }
    } catch (e) {
      console.warn(`[story] condition of ${id} failed`, e);
      return false;
    }
    return conditional ? ok : null;
  }

  private countStart(id: string): void {
    const s = this.starts.get(id);
    this.starts.set(id, { n: (s?.n ?? 0) + 1, at: this.seq.time });
  }

  private markHeard(id: string): void {
    if (this.heard.has(id)) return;
    this.heard.add(id);
    try { this.onSaid?.(id); } catch { /* ignore */ }
  }

  private start(item: Item, id: string): void {
    const now = this.seq.time;
    const l = this.lineOf(id);
    const speaker = l?.speaker ?? '';
    const offStage = !!l?.fx && this.offStage.includes(l.fx);
    const radio = this.cfg.radio;
    // The channel opens with a click when the radio voice has been quiet for a moment.
    if (radio && radio.speakers.includes(speaker) && !offStage && this.since(speaker) > (radio.after ?? 4) && !this.fast) {
      try { this.ctx.audio.play(radio.sound, { volume: radio.volume ?? 0.5 }); } catch { /* ignore */ }
    }
    const at = typeof item.opts.at === 'function' ? item.opts.at() : item.opts.at;
    const s = speak(this.ctx, id, { name: item.opts.name ?? (l ? speakerName(l) : undefined), position: at ?? undefined, subtitle: subOf(item.opts) });
    const d = this.fast ? 0.25 : s.duration;
    this.lastSpoke.set(l?.fx === 'unit' ? 'unit' : speaker, now);
    this.countStart(id);
    this.current = { item, said: id, startAt: now, endAt: now + d, handle: s.handle, follow: typeof item.opts.at === 'function' ? item.opts.at : null };
    if (!offStage) {
      try { this.actors.get(speaker)?.()?.speak?.(d); } catch { /* ignore */ }
    }
    try { item.opts.onStart?.(d); } catch (e) { console.warn('[story] line onStart failed', e); }
  }
}
