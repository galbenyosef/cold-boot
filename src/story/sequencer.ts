/**
 * Tiny coroutine scheduler for scripted beats.
 *
 * Scripts are plain async functions. Every wait resolves from inside `update()` and only while the
 * sequencer is "active" (the story passes `state === 'playing' || state === 'cutscene'`), so pausing the
 * game, reading a log or dying freezes every script exactly where it is.
 */
import type { EventBus, GameEvents } from '../core/types';

type Waiter = { kind: 'time'; until: number; resolve: () => void }
  | { kind: 'pred'; pred: () => boolean; resolve: () => void };

export class Sequencer {
  /** Seconds of active (unpaused) script time. */
  time = 0;
  private waiters: Waiter[] = [];
  private readyQueue: (() => void)[] = [];
  private disposed = false;

  constructor(private events: EventBus) {}

  update(dt: number, active: boolean): void {
    if (this.disposed || !active) return;
    this.time += dt;
    // Event-resolved waits queued while paused are released only now.
    if (this.readyQueue.length) {
      const q = this.readyQueue; this.readyQueue = [];
      for (const r of q) r();
    }
    if (!this.waiters.length) return;
    const keep: Waiter[] = [];
    const fire: (() => void)[] = [];
    for (const w of this.waiters) {
      let done = false;
      if (w.kind === 'time') done = this.time >= w.until;
      else {
        try { done = w.pred(); } catch (e) { console.error('[story] waitUntil predicate threw', e); done = true; }
      }
      if (done) fire.push(w.resolve); else keep.push(w);
    }
    this.waiters = keep;
    // Continuations run as microtasks after this frame, so new waits they add land in the fresh list.
    for (const f of fire) f();
  }

  /** Wait `seconds` of unpaused time. */
  wait(seconds: number): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ kind: 'time', until: this.time + Math.max(0, seconds), resolve }));
  }

  /** Resolve on the first active frame where `pred()` is true (checked every frame). */
  waitUntil(pred: () => boolean): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ kind: 'pred', pred, resolve }));
  }

  /** Next matching event; the continuation runs on the next active frame. */
  waitForEvent<K extends keyof GameEvents>(type: K, filter?: (e: GameEvents[K]) => boolean): Promise<GameEvents[K]> {
    return new Promise((resolve) => {
      const off = this.events.on(type, (e) => {
        if (filter && !filter(e)) return;
        off();
        this.readyQueue.push(() => resolve(e));
      });
    });
  }

  waitForTrigger(id: string): Promise<GameEvents['trigger:enter']> {
    return this.waitForEvent('trigger:enter', (e) => e.id === id);
  }

  /** Run a script "thread" — errors are logged, never thrown into the caller. */
  spawn(name: string, fn: () => Promise<unknown>): void {
    fn().catch((e) => console.error(`[story] script "${name}" failed`, e));
  }

  dispose(): void { this.disposed = true; this.waiters = []; this.readyQueue = []; }
}
