/**
 * Live dialogue for level 2: ONE speech channel with a queue, three priorities and interruption rules,
 * plus an overlap channel for voices that are meant to collide (units talking over each other).
 *
 *   scene — story lines. Queued in order; never dropped; a scene line cuts a bark that is playing and
 *           goes ahead of any queued talk.
 *   talk  — walking-and-talking filler (Tomas while the player crosses the hall). Queued; waits behind
 *           scene lines; dropped by `flush()`.
 *   bark  — reactions to what the player does. Only plays when the channel is idle and nothing is
 *           queued, never repeats inside its cooldown, and is cut by the next scene line.
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
}

interface Item { id: string; opts: SayOpts; pri: Pri; resolve: (played: boolean) => void }

export class Dialogue {
  /** Tests: every line takes 0.25 s. */
  fast = false;
  /** Script time of the last line start, per speaker id ('tomas', 'choir', …). */
  readonly lastSpoke = new Map<string, number>();
  private queue: Item[] = [];
  private current: { item: Item; endAt: number; handle: VoiceHandle | null; follow: (() => THREE.Vector3 | null) | null } | null = null;
  private over: { handle: VoiceHandle | null; endAt: number; follow: (() => THREE.Vector3 | null) | null }[] = [];
  private nextAt = 0;
  private cooldowns = new Map<string, number>();
  private actors = new Map<string, () => EnemyActor | null>();
  private muted = false;

  constructor(private ctx: GameContext, private seq: Sequencer) {}

  /** Who animates when `speaker` talks (looked up when the line starts; null = nobody on stage). */
  bindActor(speaker: string, get: () => EnemyActor | null): void { this.actors.set(speaker, get); }

  get busy(): boolean { return !!this.current || this.queue.length > 0; }
  get speaking(): string | null { return this.current?.item.id ?? null; }
  /** Seconds since `speaker` last started a line. */
  since(speaker: string): number { return this.seq.time - (this.lastSpoke.get(speaker) ?? -1e9); }

  /** Queue one line. Resolves true when it was spoken to the end, false when dropped / cut. */
  say(id: string, opts: SayOpts = {}): Promise<boolean> {
    const pri = opts.pri ?? 'scene';
    return new Promise((resolve) => {
      if (this.muted) { resolve(false); return; }
      const item: Item = { id, opts, pri, resolve };
      if (pri === 'bark') {
        const cd = this.cooldowns.get(id) ?? -1e9;
        if (this.busy || this.seq.time < this.nextAt || this.seq.time < cd) { resolve(false); return; }
        this.cooldowns.set(id, this.seq.time + (opts.cooldown ?? 60));
        this.queue.push(item);
        return;
      }
      if (pri === 'scene') {
        // A new important line cuts a bark, and goes ahead of queued filler.
        if (this.current?.item.pri === 'bark') this.cut();
        for (const q of this.queue.filter((q) => q.pri === 'bark')) q.resolve(false);
        this.queue = this.queue.filter((q) => q.pri !== 'bark');
        let i = this.queue.findIndex((q) => q.pri !== 'scene');
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

  /** A voice that does not wait its turn (units over each other, a death rattle). */
  overlap(id: string, opts: SayOpts = {}): number {
    if (this.muted) return 0;
    const l = voiceLine(id);
    const at = typeof opts.at === 'function' ? opts.at() : opts.at;
    const s = speak(this.ctx, id, { name: opts.name ?? (l ? speakerName(l) : undefined), position: at ?? undefined });
    const d = this.fast ? 0.25 : s.duration;
    this.over.push({ handle: s.handle, endAt: this.seq.time + d, follow: typeof opts.at === 'function' ? opts.at : null });
    return d;
  }

  /** Stop the line being spoken (short fade). */
  cut(): void {
    const c = this.current;
    if (!c) return;
    this.current = null;
    try { c.handle?.stop(0.12); } catch { /* ignore */ }
    this.nextAt = this.seq.time + 0.15;
    c.item.resolve(false);
  }

  /** Drop everything queued below `keep` priority (default: all) and cut the current line if it is one of them. */
  flush(keepScene = false): void {
    const drop = this.queue.filter((q) => !keepScene || q.pri !== 'scene');
    this.queue = this.queue.filter((q) => keepScene && q.pri === 'scene');
    for (const q of drop) q.resolve(false);
    if (this.current && (!keepScene || this.current.item.pri !== 'scene')) this.cut();
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
      c.item.resolve(true);
    }
    if (!this.queue.length || now < this.nextAt) return;
    this.start(this.queue.shift()!);
  }

  private start(item: Item): void {
    const now = this.seq.time;
    const l = voiceLine(item.id);
    const speaker = l?.speaker ?? '';
    const radio = speaker === 'tomas' && l?.fx !== 'unit' && l?.fx !== 'recorder';
    // The channel opens with a click when he has been quiet for a moment.
    if (radio && this.since('tomas') > 4 && !this.fast) {
      try { this.ctx.audio.play('intercom_click', { volume: 0.5 }); } catch { /* ignore */ }
    }
    const at = typeof item.opts.at === 'function' ? item.opts.at() : item.opts.at;
    const s = speak(this.ctx, item.id, { name: item.opts.name ?? (l ? speakerName(l) : undefined), position: at ?? undefined });
    const d = this.fast ? 0.25 : s.duration;
    this.lastSpoke.set(l?.fx === 'unit' ? 'unit' : speaker, now);
    this.current = { item, endAt: now + d, handle: s.handle, follow: typeof item.opts.at === 'function' ? item.opts.at : null };
    if (l?.fx !== 'unit' && l?.fx !== 'recorder') {
      try { this.actors.get(speaker)?.()?.speak?.(d); } catch { /* ignore */ }
    }
    try { item.opts.onStart?.(d); } catch (e) { console.warn('[story] line onStart failed', e); }
  }
}
