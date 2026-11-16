/**
 * Shared story scaffolding — the base class of a level's script (moved from level 2, stage 3a §8.13).
 * How to write a level on it: ./README.md.
 *
 * Construction rules (levels 1–2, REVISION 5 / 5.1): every beat is its own thread (`S`) waiting on its own
 * condition; everything that must survive a reload lives in ONE serialisable record (`prog`); every beat has an
 * idempotent consequence (`consequence(id)`), so loading a checkpoint applies them with no scene (`fastForward`).
 * Door state comes from the phase table only (`syncPhase` → the level's `applyPhase`); a door closing behind the
 * player is always a latch (`closeBehind`); a gate that waits on a fight never waits on a machine that is asleep,
 * idle or facing away (`fightOut` / `fightOutWhere` rouse every second; stranded → removed, last resort only);
 * no line is spoken on an assumption (`Dialogue`, the level's rule table, checked when the line starts).
 *
 * What a level supplies (abstract / overridable members, all `protected`):
 *   emptyProgress()            the level's empty record (flags with their defaults)
 *   phase (getter)             phase id derived from the record — never stored
 *   applyPhaseTo(id, snap)     hand the phase to the level's table (`applyPhaseSafe(ctx, levelApplyPhase, …)`)
 *   consequence(id)            the lasting effect of a beat / '#cue' (idempotent; `this.ff` = fast-forward)
 *   facts                      what the lines may assume (implements the level's facts type `F`)
 *   CHECKPOINTS + checkpointIds  when / valid per checkpoint id, in level order (the calm rule takes them)
 *   baseline(), baselineMood()   the world every run starts from; the music after a load
 *   objective()                the objective text for the record's state
 *   start(), and the threads   the level content itself
 * Optional hooks (default no-op): afterReplay / afterSnap (fast-forward), onStep / afterObjective / onFrame
 * (tick), checkpointBlocked, onRemoved (removeSilently), onPose, onNoteOpened.
 */
import * as THREE from 'three';
import type { ActorLook, ActorType, Door, Enemy, EnemyActor, GameContext, LoopHandle } from '../../core/types';
import type { UIInternal } from '../../ui/types';
import type { Sequencer } from '../sequencer';
import type { MusicDirector } from '../director';
import type { World } from '../world';
import type { Fragment } from '../text';
import { Dialogue, type DialogueConfig, type SayOpts } from './dialogue';
import { inRegion, inRegion3, regionBoxes, type RegionFallback } from './phases';

/**
 * The serialisable record, the `story` field of a v2 save (`SaveV2<P>`, src/story/save.ts). Same shape as
 * `ProgressL2`; a level may extend it (level 3: `t`) — extra fields are carried through `fastForward` as saved.
 */
export interface StageProgress {
  /** DESIGN beats and internal '#cue' markers, in the order they happened. */
  beats: string[];
  /** Readables (interactable ids) opened at least once. */
  read: string[];
  /** Rooms the player has been in. */
  visited: string[];
  /** The level's flags (free-form record; typed by the level through `f`). */
  flags: Record<string, boolean | number | string>;
  /** Enemy groups the story has woken / spawned / removed. */
  triggered: string[];
  /** Enemy groups that are completely dead. */
  cleared: string[];
  /** Checkpoints already taken (never taken twice). */
  checkpoints: string[];
  /** Ids of spoken lines the player heard (later lines may only refer back to these). */
  heard?: string[];
}

/** What the page-level story (index.ts of a level) gives the script. */
export interface StageHooks<Cp extends string> {
  setObjective(text: string): void;
  /** Write the checkpoint (the v2 save: `writeLevelSave`) and blink the HUD indicator. */
  checkpoint(id: Cp): void;
}

/** One checkpoint's rule: `when` it is due, and while it is still `valid` (a later state makes it moot). */
export interface CheckpointRule { when: () => boolean; valid: () => boolean }

export type FightTarget = ((e: Enemy) => boolean) | string | THREE.Box3;
export interface FightOpts {
  /** End the wait early. */
  stop?: () => boolean;
  /** Never remove while one of these is alive (a boss). */
  keep?: (e: Enemy) => boolean;
}

/** What every level's line rules may ask (`StageBase.commonFacts()`); a level's facts type extends it. */
export interface CommonFacts {
  /** Room id the player stands in. */
  readonly room: string | null;
  /** Awake, hunting enemies anywhere. */
  readonly hostiles: number;
  readonly health: number;
  /** A note / terminal is on screen. */
  readonly reading: boolean;
  /** The line was heard at some point of this run — also across loads. */
  heard(id: string): boolean;
  visited(room: string): boolean;
  /** The player's feet are inside the named region (3-D, `level.regions`). */
  inRegion(name: string): boolean;
  /** Living members of a group / those still inert / those awake. */
  alive(group: string): number;
  dormant(group: string): number;
  awake(group: string): number;
  /** The group has living members and every one of them is still inert. */
  calm(group: string): boolean;
  /** §6.2 "in view": a living member's chest is on a clear ray within `coneDeg` (default 50°) of the view. */
  inView(group: string, coneDeg?: number): boolean;
  /** Awake living hostiles matching a predicate / region name / box (any group). */
  hostilesWhere(where: FightTarget): number;
  firedWithin(seconds: number): boolean;
  hurtWithin(seconds: number): boolean;
  movedWithin(seconds: number): boolean;
  read(id: string): boolean;
  /** The readable is open now or was closed within the last `seconds`. */
  readWithin(id: string, seconds: number): boolean;
  /** The player tried this locked door within the last `seconds` (needs `trackPlayer()`). */
  deniedWithin(door: string, seconds: number): boolean;
  /** Inside a level trigger right now. */
  inTrigger(id: string): boolean;
  /** A carried fact (`ctx.facts`: level 2's `choice` 'stop' | 'command', `unitsLeft`…) — variants by stored facts. */
  fact(key: string): string | number | boolean | undefined;
}

/** `base` with `extra`'s members added — getters stay live (property descriptors are copied, not values). */
export function extendFacts<A extends object, B extends object>(base: A, extra: B): A & B {
  const out = Object.create(null) as A & B;
  Object.defineProperties(out, Object.getOwnPropertyDescriptors(base));
  Object.defineProperties(out, Object.getOwnPropertyDescriptors(extra));
  return out;
}

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const DEG = Math.PI / 180;
/** Yaw that faces from `a` toward `b` (yaw 0 looks down −Z). */
export const face = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

export abstract class StageBase<Fl, Ph extends string, Cp extends string, F, P extends StageProgress = StageProgress> {
  protected prog: P;
  protected done = new Set<string>();
  /** True while a checkpoint load replays consequences (no scenes, no sound, no phase transitions). */
  protected ff = false;
  protected restoredFrom: Cp | null = null;

  // ── session facts ──
  protected live = false;        // controls handed over (arrival finished)
  protected started = false;
  protected ended = false;
  protected triggerAt = new Map<string, number>();
  protected insideTrig = new Set<string>();
  protected triggeredAt = new Map<string, number>();
  protected closedAt = new Map<string, number>();
  protected roomTime = new Map<string, number>();
  protected toastCooldown = new Map<string, number>();
  protected deniedAt = new Map<string, number>();
  protected diedIn = new Map<string, number>();
  protected removedGroups = new Set<string>();
  protected quietUntil = 0;
  protected lastCombat = -1e9;
  protected noteId: string | null = null;
  protected legacyReading = false;
  protected tmp = new THREE.Vector3();
  protected tmp2 = new THREE.Vector3();
  protected actors = new Set<EnemyActor>();
  protected loops: LoopHandle[] = [];
  /** Script time of named instants (latch, taken, …): the measured timings in `debugState.t`. */
  protected marks: Record<string, number> = {};
  protected phaseApplied: Ph | null = null;

  readonly talk: Dialogue<F>;

  // ── what just happened (for line conditions) ──
  protected lastMovePos = new THREE.Vector3();
  protected lastMoveAt = 0;
  protected lastShotAt = -1e9;
  protected lastHurtAt = -1e9;

  // ── checkpoints ──
  protected calmFor = 0;
  protected lastCheckpoint: Cp | null = null;
  protected pendingCheckpoint: Cp | null = null;

  private tickTimer = 0;
  private noteClosedReal = -1e9;
  private lastNoteId: string | null = null;

  constructor(
    protected ctx: GameContext,
    protected seq: Sequencer,
    protected director: MusicDirector,
    protected w: World,
    protected logs: Set<string>,
    protected hooks: StageHooks<Cp>,
    dialogue: DialogueConfig<F>,
  ) {
    this.prog = this.emptyProgress();
    // (the level's `facts` is a field of the subclass: read through a getter, when a line's condition is checked)
    this.talk = new Dialogue<F>(ctx, seq, () => this.facts, dialogue);
    this.talk.onSaid = (id) => { if (!this.prog.heard) this.prog.heard = []; if (!this.prog.heard.includes(id)) this.prog.heard.push(id); };
    const ev = ctx.events;
    ev.on('trigger:enter', (e) => { this.triggerAt.set(e.id, this.seq.time); this.insideTrig.add(e.id); });
    ev.on('trigger:exit', (e) => { this.insideTrig.delete(e.id); });
    ev.on('enemy:group-cleared', (e) => { if (!this.prog.cleared.includes(e.group)) this.prog.cleared.push(e.group); });
    ev.on('weapon:fired', () => { this.lastShotAt = this.seq.time; });
    ev.on('player:died', () => this.onDied());
  }

  // ───────────────────────────────────────────────────────────── what the level supplies

  protected abstract emptyProgress(): P;
  /** The phase the record says the world is in (derived, never stored). */
  protected abstract get phase(): Ph;
  /** Hand a phase to the level's table (`applyPhaseSafe(this.ctx, levelApplyPhase, id, snap)`). */
  protected abstract applyPhaseTo(id: Ph, snap: boolean): void;
  /** The lasting effect of beat / cue `id`. Idempotent; replayed on load with `this.ff` true. */
  protected abstract consequence(id: string): void;
  /** What the lines may assume (the level's facts object). */
  protected abstract readonly facts: F;
  /** The level's checkpoint ids, in the order they can be taken. */
  protected abstract readonly checkpointIds: readonly Cp[];
  /** When / valid per checkpoint id (`cp: { when: () => false, valid: () => false }` for one saved by `checkpointNow`). */
  protected abstract readonly CHECKPOINTS: Record<Cp, CheckpointRule>;
  /** What every run starts from, before any phase: interactables, machines, screens. No door state. */
  protected abstract baseline(): void;
  /** The music after a load. */
  protected abstract baselineMood(): 'silence' | 'ambient' | 'tension';
  /** The objective text for the current state (set every 0.2 s). */
  protected abstract objective(): string;

  // ── optional hooks ──
  /** Fast-forward: after the consequences are replayed and the triggered groups removed, before the phase snap. */
  protected afterReplay(): void { /* level */ }
  /** Fast-forward: after the phase snap (a latch a phase cannot know about), before `level.settle`. */
  protected afterSnap(): void { /* level */ }
  /** Every frame once started, before the 0.2 s step. */
  protected onFrame(_dt: number): void { /* level */ }
  /** Every 0.2 s step, after `visited` / `roomTime` / movement, before the objective. */
  protected onStep(_step: number): void { /* level */ }
  /** Every 0.2 s step, after the objective, before the checkpoint rule (barks). */
  protected afterObjective(_step: number): void { /* level */ }
  /** True = no checkpoint now (on top of the calm rule: a scan, a scene…). */
  protected checkpointBlocked(): boolean { return false; }
  /** `removeSilently` is about to delete `group` (`living` = its living members). */
  protected onRemoved(_group: string, _living: Enemy[], _gone: boolean): void { /* level */ }
  /** `pose(a, p)` is about to set a pose (track an actor's pose). */
  protected onPose(_a: EnemyActor, _pose: string): void { /* level */ }
  /** A readable was opened (after `noteId` is set, before it is shown): a recorder, a bark. */
  protected onNoteOpened(_id: string): void { /* level */ }

  // ───────────────────────────────────────────────────────────── small helpers

  protected get ui(): UIInternal { return this.ctx.ui as UIInternal; }
  protected get now(): number { return this.seq.time; }
  protected get f(): Fl { return this.prog.flags as unknown as Fl; }
  protected get pos(): THREE.Vector3 { return this.ctx.player.position; }
  protected has(id: string): boolean { return this.done.has(id); }
  /** A pause in the telling: tests may shorten it (`hurry(true)`). */
  protected wait(s: number) { return this.seq.wait(this.talk.fast ? Math.min(s, 0.4) : s); }
  /** A wait that tests may not shorten (physical things: a walk, a door, a scene clock). */
  protected hold(s: number) { return this.seq.wait(s); }
  protected until(p: () => boolean) { return this.seq.waitUntil(p); }
  /** Until `p` or `seconds` passed; true = `p` held. */
  protected async untilOr(p: () => boolean, seconds: number): Promise<boolean> {
    const t0 = this.now;
    let ok = false;
    await this.until(() => (ok = p()) || this.now - t0 >= seconds);
    return ok;
  }
  /** A thread: one beat waiting on its own condition. */
  protected S(name: string, fn: () => Promise<unknown>): void { this.seq.spawn(name, fn); }
  /** Record the script time of a named instant (first time only): `debugState.t`. */
  protected stamp(name: string): void { if (!(name in this.marks)) this.marks[name] = +this.now.toFixed(2); }

  protected mark(id: string): boolean {
    if (this.done.has(id)) return false;
    this.done.add(id);
    this.prog.beats.push(id);
    this.consequence(id);
    this.syncPhase(); // a flag may have moved the phase: the level's table sets the doors
    return true;
  }
  /** A DESIGN beat: recorded, consequences applied, `story:beat` emitted. False = already happened. */
  protected beat(id: string): boolean {
    if (!this.mark(id)) return false;
    this.stamp(id);
    if (this.ctx.debug.verbose) console.log(`[story] beat ${id} @${this.now.toFixed(1)}s`);
    this.ctx.events.emit('story:beat', { id });
    return true;
  }
  /** Internal run-once cue ('#id' in the record). */
  protected once(id: string): boolean { return this.mark('#' + id); }

  // ───────────────────────────────────────────────────────────── phases

  /**
   * Apply the door state of the phase the record is in (level `applyPhase`). Called after every flag change
   * that moves the phase (`mark`), and once at the end of a checkpoint fast-forward (snapped, no animation).
   */
  protected syncPhase(): void {
    const id = this.phase;
    if (this.ff || id === this.phaseApplied) return;
    this.phaseApplied = id;
    this.stamp('phase_' + id);
    if (this.ctx.debug.verbose) console.log(`[story] phase ${id} @${this.now.toFixed(1)}s`);
    this.applyPhaseTo(id, false);
  }
  protected snapPhase(): void {
    this.phaseApplied = this.phase;
    this.applyPhaseTo(this.phaseApplied, true);
  }

  // ───────────────────────────────────────────────────────────── doors, latches

  protected door(id: string): Door | null {
    try { return this.w.hasDoor(id) ? this.ctx.level.door(id) : null; } catch { return null; }
  }
  protected doorStatus(id: string, status: 'cycling' | 'dark' | null): void {
    try { this.door(id)?.setStatus?.(status); } catch { /* a level build without setStatus */ }
  }
  /** Hold a door open for scripted walkers (puppets do not trip the auto-open, and an auto door would close on them). */
  protected holdOpen(id: string): void {
    const d = this.door(id);
    if (!d) return;
    try { d.unlock(); d.auto = false; d.open(); } catch { /* ignore */ }
  }
  /** Fully shut? (`Door.closed`; a build without it: locked and not open.) */
  protected isShut(d: Door): boolean {
    const c = (d as { closed?: boolean }).closed;
    return typeof c === 'boolean' ? c : d.locked && !d.isOpen;
  }
  /**
   * REVISION 5.1 latch. Lock the door, wait until it is fully shut, then check which side the player is on.
   * Wrong side → unlock and reopen; the caller re-arms its trigger. A scene clock may start only on `true`.
   */
  protected async closeBehind(id: string, keepSide: () => boolean): Promise<boolean> {
    const d = this.door(id);
    if (!d) return keepSide();
    d.lock();
    const t0 = this.now;
    await this.until(() => this.isShut(d) || this.now - t0 > 4);
    // A build whose doors have no `closed`: give the leaves their travel time.
    if (typeof (d as { closed?: boolean }).closed !== 'boolean') await this.hold(1.0);
    if (keepSide()) return true;
    d.unlock();
    d.open();
    return false;
  }

  // ───────────────────────────────────────────────────────────── fights

  /** Wake and / or spawn a level group; recorded in `triggered` (removed on load, never re-spawned). */
  protected engage(group: string, how: 'wake' | 'spawn' | 'both', stagger?: number): void {
    if (!this.prog.triggered.includes(group)) this.prog.triggered.push(group);
    this.triggeredAt.set(group, this.now);
    if (how !== 'spawn') this.w.wakeGroup(group, stagger);
    if (how !== 'wake') this.w.spawnGroup(group);
  }
  /** The group was triggered and is dead (at least `minDelay` s after it was triggered). */
  protected fought(g: string, minDelay = 5): boolean {
    if (!this.prog.triggered.includes(g)) return false;
    if (this.prog.cleared.includes(g)) return true;
    return this.now - (this.triggeredAt.get(g) ?? -1e9) > minDelay && this.w.alive(g) === 0;
  }
  /**
   * Delete a group without a trace (it is out of the player's world for good). `gone` is passed to `onRemoved`
   * (level 2: whether its living units stop counting as units on the line).
   */
  protected removeSilently(group: string, gone = true): void {
    this.onRemoved(group, this.members(group), gone);
    try { this.ctx.enemies.removeGroup(group); } catch (e) { console.warn(`[story] removeGroup ${group} failed`, e); }
    this.removedGroups.add(group);
    if (!this.prog.triggered.includes(group)) this.prog.triggered.push(group);
    this.triggeredAt.set(group, -1e9);
  }
  /** Living members of a group. */
  protected members(group: string): Enemy[] {
    try { return this.ctx.enemies.all.filter((e) => e.group === group && e.alive); } catch { return []; }
  }
  protected awakeIn(group: string): Enemy[] { return this.members(group).filter((e) => e.state !== 'dormant'); }
  /**
   * Every living member of `group` comes for the player: dormant ones wake, awake-but-idle ones are alerted
   * (an idle machine only notices by sight, in its front cone — a gate must never wait on one that was looking
   * the other way).
   */
  protected rouse(group: string): void {
    let sleeping = false;
    for (const e of this.members(group)) {
      if (e.state === 'dormant') sleeping = true;
      else if (e.state === 'idle') { try { this.ctx.enemies.alertNoise(e.position, 0.4); } catch { /* ignore */ } }
    }
    // (wakeGroup skips the awake and the already waking — an emerging 'drop' / 'hoist' keeps its own clock)
    if (sleeping) this.w.wakeGroup(group, 0.4);
  }
  /** The player is near `e` or can see it: a fight with it is going on. */
  protected engaged(e: Enemy, near = 9): boolean {
    return this.distTo(e.position) < near || this.los(this.tmp2.copy(e.position).setY(e.position.y + 1.1).clone());
  }
  /**
   * Until every member of `group` is dead (or `stop()`). Meanwhile they are roused every second, so the gate
   * waiting on this never depends on a machine that is asleep, idle or facing away. Last resort only: if for
   * `stranded` s no member has been near or in view of the player (stuck where nobody can get at it), the group is
   * removed silently — never while one is seen, and never while a `keep` member (a boss) is still alive.
   */
  protected async fightOut(group: string, stranded = 60, opts: FightOpts = {}): Promise<void> {
    let lost = 0, last = this.now, nextRouse = 0;
    await this.until(() => {
      if (this.w.alive(group) === 0 || opts.stop?.()) return true;
      const dt = Math.min(1, this.now - last); last = this.now;
      if (this.now >= nextRouse) { this.rouse(group); nextRouse = this.now + 1; }
      const m = this.members(group);
      lost = this.ctx.state !== 'playing' || m.some((e) => this.engaged(e)) ? 0 : lost + dt;
      if (lost > stranded && !(opts.keep && m.some(opts.keep))) {
        console.warn(`[story] ${group}: ${m.length} unit(s) out of the player's reach for ${stranded} s — removed`);
        this.removeSilently(group);
      }
      return false;
    });
  }

  /** The enemy test of a `fightOutWhere` target: a predicate, a region name (3-D, `level.regions`), or a box. */
  protected matcher(where: FightTarget): (e: Enemy) => boolean {
    if (typeof where === 'function') return where;
    if (typeof where === 'string') return (e) => this.region3(where, e.position);
    return (e) => where.containsPoint(e.position);
  }
  /** Living enemies (any group) that match `where`. */
  protected hostilesWhere(where: FightTarget): Enemy[] {
    const m = this.matcher(where);
    try { return this.ctx.enemies.all.filter((e) => e.alive && m(e)); } catch { return []; }
  }
  /**
   * `fightOut` over "every living hostile that matches `where`" instead of one named group (stage 3a §5.2:
   * the stage end waits for whatever got into the lock). Resolves when none match (dead, or walked out of the
   * region), or on `stop()`. Every second the matching ones are roused (idle ones alerted where they stand; a
   * dormant one wakes its group). Last resort: when for `stranded` s none of them has been near or in view of the
   * player, they are let go — every group whose living members ALL match is removed silently (`removeSilently`);
   * members of a group that also has living units elsewhere cannot be removed alone (no per-unit removal in the
   * enemy contract), so they are released from this wait instead (left in the world, no longer waited for). Never
   * while one is seen, never while a `keep` member is alive.
   */
  protected async fightOutWhere(where: FightTarget, stranded = 60, opts: FightOpts = {}): Promise<void> {
    const match = this.matcher(where);
    const released = new Set<number>();
    const left = () => this.hostilesWhere(match).filter((e) => !released.has(e.id));
    let lost = 0, last = this.now, nextRouse = 0;
    await this.until(() => {
      const m = left();
      if (m.length === 0 || opts.stop?.()) return true;
      const dt = Math.min(1, this.now - last); last = this.now;
      if (this.now >= nextRouse) {
        nextRouse = this.now + 1;
        const wake = new Set<string>();
        for (const e of m) {
          if (e.state === 'dormant') wake.add(e.group);
          else if (e.state === 'idle') { try { this.ctx.enemies.alertNoise(e.position, 0.4); } catch { /* ignore */ } }
        }
        for (const g of wake) this.w.wakeGroup(g, 0.4);
      }
      lost = this.ctx.state !== 'playing' || m.some((e) => this.engaged(e)) ? 0 : lost + dt;
      if (lost > stranded && !(opts.keep && m.some(opts.keep))) {
        for (const g of new Set(m.map((e) => e.group))) {
          if (this.members(g).every(match)) {
            console.warn(`[story] ${g}: out of the player's reach for ${stranded} s — removed`);
            this.removeSilently(g);
          } else {
            for (const e of m) if (e.group === g) released.add(e.id);
            console.warn(`[story] ${g}: unit(s) out of the player's reach for ${stranded} s — no longer waited for`);
          }
        }
        lost = 0;
      }
      return false;
    });
  }

  // ───────────────────────────────────────────────────────────── where the player is

  /** Level-supplied fallback boxes for `region` / `region3` (a level build without `level.regions`). */
  protected regionFallback: RegionFallback = {};
  protected inRoom(room: string): boolean { return this.w.room() === room; }
  protected in(xMin: number, xMax: number, zMin: number, zMax: number): boolean {
    const p = this.pos;
    return p.x >= xMin && p.x <= xMax && p.z >= zMin && p.z <= zMax;
  }
  /** x/z test of a named region. */
  protected region(name: string, p: THREE.Vector3 = this.pos): boolean { return inRegion(this.ctx, name, p, this.regionFallback); }
  /** 3-D test of a named region (two decks). */
  protected region3(name: string, p: THREE.Vector3 = this.pos): boolean { return inRegion3(this.ctx, name, p, this.regionFallback); }
  protected regionBoxes(name: string): readonly THREE.Box3[] { return regionBoxes(this.ctx, name, this.regionFallback); }
  /** Inside a level trigger right now — or, for a level build without it, inside the fallback area. */
  protected at(trigger: string, fallback?: () => boolean): boolean {
    return this.insideTrig.has(trigger) || (!!fallback && fallback());
  }
  /** Seconds since the player last entered `trigger` (∞ when never). */
  protected sinceTrigger(trigger: string): number { return this.now - (this.triggerAt.get(trigger) ?? -1e9); }

  protected distTo(point: THREE.Vector3): number {
    const p = this.pos;
    return Math.hypot(p.x - point.x, p.z - point.z);
  }
  protected angleTo(point: THREE.Vector3): number {
    const p = this.ctx.player;
    const d = this.tmp.copy(point).sub(p.eye);
    const len = d.length();
    if (len < 1e-3) return 0;
    return Math.acos(THREE.MathUtils.clamp(d.dot(p.forward) / len, -1, 1));
  }
  protected los(point: THREE.Vector3): boolean {
    try { return this.ctx.physics.lineOfSight(this.ctx.player.eye, point); } catch { return true; }
  }
  protected isLookingAt(point: THREE.Vector3, coneDeg = 25, needLos = false): boolean {
    return this.angleTo(point) <= coneDeg * DEG && (!needLos || this.los(point));
  }
  protected notLookingAt(point: THREE.Vector3, coneDeg = 64): boolean {
    return this.angleTo(point) > coneDeg * DEG || !this.los(point);
  }
  /** Stage 3a §6.2 "in view": a clear ray from the eye to the enemy's chest, within `coneDeg` of the view. */
  protected inView(e: Enemy, coneDeg = 50, chest = 1.3): boolean {
    return this.isLookingAt(this.tmp2.copy(e.position).setY(e.position.y + chest).clone(), coneDeg, true);
  }
  /** A living member of `group` is in view. */
  protected memberInView(group: string, coneDeg = 50): boolean { return this.members(group).some((e) => this.inView(e, coneDeg)); }

  protected get noteOpen(): boolean {
    if (this.legacyReading) return true;
    try { return !!this.ui.noteOpen; } catch { return false; }
  }
  /** Playing, no note open, nothing hunting the player, 4 s after the last fight. */
  protected free(): boolean {
    return this.ctx.state === 'playing' && !this.noteOpen && this.w.active() === 0 && this.now - this.lastCombat > 4;
  }
  /** A quiet window: `cue` waits it out (tests end it with `hurry()`). */
  protected quiet(seconds: number): void { this.quietUntil = Math.max(this.quietUntil, this.now + seconds); }
  /** Wait for a calm moment where `where()` holds; false when `expire()` came first. */
  protected async cue(where: () => boolean, expire?: () => boolean): Promise<boolean> {
    let ok = false;
    await this.until(() => {
      if (expire?.()) return true;
      ok = this.now >= this.quietUntil && this.free() && where();
      return ok;
    });
    return ok;
  }

  protected toast(text: string, cooldown = 0): void {
    const now = this.now;
    if (cooldown > 0 && (this.toastCooldown.get(text) ?? -1e9) > now - cooldown) return;
    this.toastCooldown.set(text, now);
    this.ctx.events.emit('story:toast', { text });
  }

  // ───────────────────────────────────────────────────────────── actors

  protected actor(type: ActorType, position: THREE.Vector3, yaw: number, pose?: string, look?: ActorLook): EnemyActor | null {
    let a: EnemyActor | null = null;
    try {
      const en = this.ctx.enemies as unknown as { actor?: (t: ActorType, p: THREE.Vector3, y?: number, pose?: string, o?: { look?: ActorLook }) => EnemyActor };
      if (typeof en.actor === 'function') a = en.actor(type, position, yaw, pose, look ? { look } : undefined) ?? null;
    } catch (e) { console.warn('[story] actor failed', e); }
    if (a) this.actors.add(a);
    return a;
  }
  protected drop(a: EnemyActor | null): void {
    if (!a) return;
    this.actors.delete(a);
    this.w.removeActor(a);
  }
  protected pose(a: EnemyActor | null, pose: string): void {
    if (a) this.onPose(a, pose);
    try { a?.setPose(pose); } catch { /* ignore */ }
  }
  protected gait(a: EnemyActor | null, gait: string): void { try { a?.setGait?.(gait); } catch { /* ignore */ } }
  protected eyes(a: EnemyActor | null, on: boolean): void { try { a?.setEyes(on); } catch { /* ignore */ } }
  /** A point pins a frozen point, an object pins it live (cutscenes: `ctx.camera`), null = back to `auto`. */
  protected lookAt(a: EnemyActor | null, p: THREE.Vector3 | THREE.Object3D | null): void { try { a?.lookAt(p); } catch { /* ignore */ } }
  /** `moveTo` through points (straight segments); gives up on each after a generous timeout. */
  protected async walk(a: EnemyActor | null, points: THREE.Vector3[], speed = 1.0): Promise<void> {
    if (!a) return;
    for (const p of points) {
      if (!this.actors.has(a)) return;
      let from = 3;
      try { from = Math.hypot(a.position.x - p.x, a.position.z - p.z); } catch { /* ignore */ }
      if (from < 0.05) continue;
      let arrived: Promise<unknown> = Promise.resolve();
      try { arrived = a.moveTo(p, speed).catch(() => undefined); } catch { /* ignore */ }
      await Promise.race([arrived, this.hold(from / Math.max(0.2, speed) + 1.5)]);
    }
  }
  protected place(a: EnemyActor | null, p: THREE.Vector3, yaw?: number): void {
    if (!a) return;
    try {
      a.position.copy(p);
      a.object.position.copy(p);
      if (yaw !== undefined) a.object.rotation.y = yaw;
    } catch { /* ignore */ }
  }
  protected headOf(a: EnemyActor): THREE.Vector3 { return this.tmp2.copy(a.position).setY(a.position.y + 1.55); }
  /** Floor / deck height under a point (ray down from `from`). */
  protected groundY(x: number, z: number, from = 3.2): number {
    try {
      const hit = this.ctx.physics.raycast(V(x, from, z), V(0, -1, 0), from + 0.5);
      if (hit) return hit.point.y;
    } catch { /* ignore */ }
    return 0;
  }

  // ───────────────────────────────────────────────────────────── dialogue

  protected say(id: string, opts?: SayOpts): Promise<boolean> { return this.talk.say(id, opts); }

  /**
   * Opt-in for new levels (level 2 does its own): record `deniedAt` on `door:denied` and `lastHurtAt` on
   * `player:damaged` (alive hits only), so `commonFacts().deniedWithin / hurtWithin` work. Call once in the
   * level's constructor.
   */
  protected trackPlayer(): void {
    this.ctx.events.on('door:denied', (e) => { this.deniedAt.set(e.id, this.now); });
    this.ctx.events.on('player:damaged', (e) => { if (e.health > 0) this.lastHurtAt = this.now; });
  }

  /**
   * The facts every level's lines may ask (stage 3a §6: rules evaluated at start, "in a place", "in view",
   * "heard", "read within"). Extend with the level's own: `extendFacts(this.commonFacts(), { get phase() {…} })`.
   */
  protected commonFacts(): CommonFacts {
    const self = this;
    return {
      get room() { return self.w.room(); },
      get hostiles() { return self.w.active(); },
      get health() { return self.ctx.player.health; },
      get reading() { return self.noteOpen; },
      heard: (id) => self.talk.heard.has(id),
      visited: (room) => self.prog.visited.includes(room),
      inRegion: (name) => self.region3(name),
      alive: (g) => self.members(g).length,
      dormant: (g) => self.members(g).filter((e) => e.state === 'dormant').length,
      awake: (g) => self.awakeIn(g).length,
      calm: (g) => { const m = self.members(g); return m.length > 0 && m.every((e) => e.state === 'dormant'); },
      inView: (g, cone) => self.memberInView(g, cone),
      hostilesWhere: (where) => self.hostilesWhere(where).filter((e) => e.state !== 'dormant').length,
      firedWithin: (s) => self.now - self.lastShotAt <= s,
      hurtWithin: (s) => self.now - self.lastHurtAt <= s,
      movedWithin: (s) => self.now - self.lastMoveAt <= s,
      read: (id) => self.prog.read.includes(id),
      readWithin: (id, s) => self.noteId === id || self.now - (self.closedAt.get(id) ?? -1e9) <= s,
      deniedWithin: (door, s) => self.now - (self.deniedAt.get(door) ?? -1e9) <= s,
      inTrigger: (id) => self.insideTrig.has(id),
      fact: (key) => self.ctx.facts[key],
    };
  }

  // ───────────────────────────────────────────────────────────── readables

  /** Open a readable (note / terminal): recorded in `read` and the logs, `closedAt` set when it closes. */
  protected openNote(id: string, f: Fragment): void {
    if (this.noteId === id) return;
    if (this.lastNoteId === id && performance.now() - this.noteClosedReal < 350) return;
    this.logs.add(id);
    if (!this.prog.read.includes(id)) this.prog.read.push(id);
    this.ctx.events.emit('story:log', { id, title: f.header, body: f.body });
    const done = () => {
      if (this.noteId !== id) return;
      this.noteId = null;
      this.lastNoteId = id;
      this.noteClosedReal = performance.now();
      this.closedAt.set(id, this.now);
    };
    this.noteId = id;
    this.onNoteOpened(id);
    const ui = this.ui;
    if (typeof ui.showNote === 'function') {
      ui.showNote(f.header, f.body, f.style).catch((e) => console.error('[story] showNote failed', e)).finally(done);
      return;
    }
    this.legacyReading = true;
    const prev = this.ctx.state;
    const pausable = prev === 'playing';
    if (pausable) this.ctx.setState('paused');
    ui.showLog(f.header, f.body).catch((e) => console.error('[story] showLog failed', e)).finally(() => {
      this.legacyReading = false;
      if (pausable && this.ctx.state === 'paused') this.ctx.setState(prev);
      done();
    });
  }

  // ───────────────────────────────────────────────────────────── per-frame

  /** Call from the page-level story's `update` every frame. */
  tick(dt: number): void {
    this.talk.update();
    if (!this.started) return;
    this.onFrame(dt);
    if (this.w.active() > 0) this.lastCombat = this.now;
    this.tickTimer -= dt;
    if (this.tickTimer > 0) return;
    const step = 0.2 - this.tickTimer;
    this.tickTimer = 0.2;
    const room = this.w.room();
    if (room) {
      if (!this.prog.visited.includes(room)) this.prog.visited.push(room);
      if (this.ctx.state === 'playing') this.roomTime.set(room, (this.roomTime.get(room) ?? 0) + step);
    }
    if (this.pos.distanceToSquared(this.lastMovePos) > 1.2) { this.lastMovePos.copy(this.pos); this.lastMoveAt = this.now; }
    this.onStep(step);
    this.hooks.setObjective(this.objective());
    this.afterObjective(step);
    this.checkpoints(step);
  }

  // ───────────────────────────────────────────────────────────── checkpoints

  /** The calm rule: nothing hunting, nothing triggered still alive, standing, alive, in control, no note. */
  protected calm(): boolean {
    const ctx = this.ctx, p = ctx.player;
    if (ctx.state !== 'playing' || !this.live || this.ended || this.noteOpen) return false;
    if (this.checkpointBlocked()) return false;
    if (!p.alive || p.health <= 0 || !p.controlsEnabled) return false;
    if (Math.abs(p.velocity.y) > 0.4) return false;
    if (this.w.active() > 0 || this.now - this.lastCombat < 3) return false;
    for (const g of this.prog.triggered) if (!this.fought(g, 8)) return false;
    return true;
  }

  /** The latest due-and-valid checkpoint after the last one taken is saved after 0.6 s of calm. */
  protected checkpoints(step: number): void {
    if (this.ctx.debug.noStory) return;
    const ids = this.checkpointIds;
    const taken = this.prog.checkpoints;
    const lastIdx = this.lastCheckpoint ? ids.indexOf(this.lastCheckpoint) : -1;
    let due: Cp | null = null;
    for (let i = ids.length - 1; i > lastIdx; i--) {
      const id = ids[i];
      if (taken.includes(id)) continue;
      const c = this.CHECKPOINTS[id];
      if (c.when() && c.valid()) { due = id; break; }
    }
    this.pendingCheckpoint = due;
    if (!due || !this.calm()) { this.calmFor = 0; return; }
    this.calmFor += step;
    if (this.calmFor < 0.6) return;
    this.calmFor = 0;
    this.pendingCheckpoint = null;
    this.save(due);
  }
  protected save(id: Cp): void {
    this.prog.checkpoints.push(id);
    this.lastCheckpoint = id;
    this.stamp(id);
    try { this.hooks.checkpoint(id); } catch (e) { console.error('[story] checkpoint failed', e); }
  }
  /** A checkpoint at a fixed instant of a scene (not when calm). Skipped only if the player is dead. */
  protected checkpointNow(id: Cp): void {
    const p = this.ctx.player;
    if (this.ctx.debug.noStory || this.prog.checkpoints.includes(id)) return;
    if (!p.alive || p.health <= 0 || this.ctx.state === 'dead' || this.ended) return;
    this.save(id);
  }

  /**
   * Load a checkpoint: the record from the save, every beat's consequence replayed (no scenes, `ff`, level
   * silent), every triggered group removed (it was fought or is gone), the phase snapped, the level settled.
   * Then the page-level story restores the player and calls `start()`.
   */
  fastForward(saved: P, from: Cp, cleared: readonly string[]): void {
    const p = { ...this.emptyProgress(), ...(JSON.parse(JSON.stringify(saved)) as P) };
    const p0 = this.emptyProgress();
    p.beats = [...saved.beats];
    p.read = [...saved.read];
    p.visited = [...saved.visited];
    p.flags = { ...p0.flags, ...saved.flags };
    p.triggered = [...new Set([...saved.triggered, ...cleared])];
    p.cleared = [...new Set([...saved.cleared, ...cleared])];
    p.checkpoints = [...saved.checkpoints];
    p.heard = [...(saved.heard ?? [])];
    this.prog = p;
    this.done = new Set();
    for (const id of p.heard ?? []) this.talk.heard.add(id);
    this.restoredFrom = from;
    this.lastCheckpoint = from;
    this.ff = true;
    const lv = this.ctx.level as unknown as { settle?: (seconds?: number) => void; setSilent?: (on: boolean) => void };
    try {
      try { lv.setSilent?.(true); } catch { /* ignore */ }
      this.baseline();
      for (const id of p.beats) {
        if (this.done.has(id)) continue;
        this.done.add(id);
        this.consequence(id);
      }
      for (const g of p.triggered) {
        try { this.ctx.enemies.removeGroup(g); } catch (e) { console.warn(`[story] removeGroup ${g} failed`, e); }
        this.triggeredAt.set(g, -1e9);
      }
      this.afterReplay();
      // Every door: the phase table, snapped. Then whatever latch a phase cannot know about.
      this.snapPhase();
      this.afterSnap();
      try { lv.settle?.(14); } catch (e) { console.warn('[story] level.settle failed', e); }
    } finally {
      this.ff = false;
      try { lv.setSilent?.(false); } catch { /* ignore */ }
    }
    for (const id of p.read) this.closedAt.set(id, -1e9);
    this.director.setMood(this.baselineMood());
  }

  /** The record as it would be saved now (a deep copy). */
  snapshot(): P { return JSON.parse(JSON.stringify(this.prog)) as P; }

  // ───────────────────────────────────────────────────────────── death, tests

  protected onDied(): void {
    const ctx = this.ctx;
    if (ctx.state === 'ended' || ctx.state === 'dead') return;
    ctx.setState('dead');
    this.talk.shutUp();
    for (const l of this.loops.splice(0)) { try { l.stop(1.5); } catch { /* ignore */ } }
    this.ui.closeNote?.();
    this.ui.setHudVisible(false);
    ctx.ui.showDeath().catch((e) => console.error('[story] showDeath failed', e));
  }

  /** Test hook (`story.hurry()`): end quiet windows; `fast` also shortens every line and scripted pause. */
  hurry(fast?: boolean): void {
    this.quietUntil = 0;
    this.lastCombat = -1e9;
    if (fast !== undefined) this.talk.fast = fast;
  }
}
