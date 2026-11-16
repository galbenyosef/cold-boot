/**
 * Level 2 script — shared state, helpers and the FACTS the dialogue rules ask (REVISION 5).
 *
 * The script is one class cut into layers so no file is a wall of text:
 *   base.ts    (this)  the record, time / place / actor helpers, phases, latches, `facts`
 *   ghost.ts           the two holograms: pattern 14 roaming the section, pattern 00 on the rig
 *   taking.ts          Section C → the trap → the window → the loading → the escorts → the ride
 *   script.ts          everything else (acts 1–2, 4–5), checkpoints, barks, reactions, debug
 *
 * Construction rules (unchanged from level 1): every beat is its own thread waiting on its own condition;
 * everything that must survive a reload lives in ONE serialisable record (`prog`); every beat has an
 * idempotent entry in `CONSEQUENCES`, so loading a checkpoint applies them with no scene (`fastForward`).
 * REVISION 5 adds: door state comes from the phase table only (`setPhase` → level `applyPhase`), a closing
 * door behind the player is always a latch (`closeBehind`), and no line is spoken on an assumption
 * (`facts`, `Dialogue` rules).
 */
import * as THREE from 'three';
import type { ActorLook, ActorType, Door, Enemy, EnemyActor, GameContext, LoopHandle } from '../../core/types';
import type { UIInternal } from '../../ui/types';
import type { Sequencer } from '../sequencer';
import type { MusicDirector } from '../director';
import type { World } from '../world';
import type { CheckpointIdL2, ProgressL2 } from '../save';
import { Dialogue, type Facts, type SayOpts } from './dialogue';
import { applyPhase, inRegion, letterOf, type PhaseId } from './phases';

export interface HooksL2 {
  setObjective(text: string): void;
  checkpoint(id: CheckpointIdL2): void;
  /** The level is finished: run the ending (cards, ending screen, clear the checkpoint). `left` = units still standing. */
  ending(choice: 'shutdown' | 'rewrite', unit14: 'spared' | 'shot' | 'killed', left: number): Promise<void>;
}

export interface Flags {
  arrived: boolean; hall: boolean; seen: boolean;
  /** The intercom was pressed: the player carries the handset from here on. */
  met: boolean;
  /** Tomas unlocked d2_fitting (phase B). */
  fitOpen: boolean;
  rig: boolean; pass: boolean; power: boolean;
  /** The relay room's arc interlock released (its fight is over). */
  relayClear: boolean;
  /** The south bulkhead latched behind the player (phase E). */
  trapped: boolean;
  /** He was led out; the hall door shut behind them. */
  taken: boolean;
  /** d2_booth opened (phase F). */
  boothOpen: boolean;
  /** He went through the tunnel mouth. */
  loaded: boolean;
  /** The escorts came back through the hall door as real enemies (phase G). */
  escort: boolean;
  escortDead: boolean;
  /** The player came off the belt on the far side (phase H). */
  apron: boolean;
  unit32Dead: boolean; foremanDead: boolean;
  ghostIntro: boolean;
  unit14Shot: boolean; unit14Dead: boolean; core: boolean; offered: boolean;
  choice: '' | 'shutdown' | 'rewrite';
  /** Working units (dock, intake, treadmills, Unit 14) the player shot dead. */
  workersKilled: number;
  /** Every husk the player shot dead (the ending's head count). */
  husksKilled: number;
}
export const FLAGS0: Flags = {
  arrived: false, hall: false, seen: false, met: false, fitOpen: false, rig: false, pass: false, power: false, relayClear: false,
  trapped: false, taken: false, boothOpen: false, loaded: false, escort: false, escortDead: false, apron: false, unit32Dead: false,
  foremanDead: false, ghostIntro: false, unit14Shot: false, unit14Dead: false, core: false, offered: false, choice: '',
  workersKilled: 0, husksKilled: 0,
};
export function emptyProgressL2(): ProgressL2 {
  return { beats: [], read: [], visited: [], flags: { ...FLAGS0 }, triggered: [], cleared: [], checkpoints: [], heard: [] };
}

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const DEG = Math.PI / 180;
/** Yaw that faces from `a` toward `b` (yaw 0 looks down −Z). */
export const face = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

export const WORKER_GROUPS = ['g2_dock', 'g2_intake', 'g2_fit_tread'];
/** Everything north of the partition: gone (silently) once the line runs — the partition hides them. */
export const NORTH_GROUPS = ['g2_dock', 'g2_intake', 'g2_fit_tread', 'g2_fit_wake'];
export const DEAD_DOORS = ['d2_spine', 'd2_bulkhead_s', 'd2_bulkhead_n', 'd2_booth'];

// ── places (DESIGN.md → Level 2 layout, REVISION 5.1). Booth: x −17…−10, z −50…−42. ──
/** Hall glass (x = −10). */
export const GLASS = V(-9.7, 1.5, -46);
/** `bang_glass` / `write` at the hall glass: the pane is 0.42 m in front of him. */
export const TOMAS_AT_GLASS = V(-10.44, 0, -47.3);
export const TOMAS_DESK = V(-13.6, 0, -47.3);
/** Where he waits once the line runs: at his own door, which says CYCLING. */
export const TOMAS_AT_DOOR = V(-16.3, 0, -46);
/** Spine windows (glass at x = −17): z spans, and his mark 0.5 m from each pane. */
export const SPINE_WINDOWS = [
  { z0: -49.5, z1: -47.8, mark: V(-16.5, 0, -48.65) }, // level object `booth_mark_1`
  { z0: -44.2, z1: -42.5, mark: V(-16.5, 0, -43.35) }, // level object `booth_mark_2`
];
export const HALL_DOOR = V(-10, 0, -43.12);
export const HALL_DOOR_IN = V(-11.5, 0, -43.12);
export const HALL_DOOR_OUT = V(-8.4, 0, -43.12);
export const STAIR_FOOT = V(1.0, 0, -44.5);
export const DECK = V(3.7, 0, -44.5);
/** Where he is laid on the belt (hard key light; clear sight line from the booth). */
export const LAY = V(4.6, 0.55, -45.2);
/** `cp2_taken` load: the escorts as real husks, already on their way back. */
export const ESCORT_SPAWNS = [V(-7.5, 0, -43.4), V(-6.5, 0, -44.4)];

export abstract class Base {
  protected prog: ProgressL2 = emptyProgressL2();
  protected done = new Set<string>();
  protected ff = false;
  protected restoredFrom: CheckpointIdL2 | null = null;

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
  protected phaseApplied: PhaseId | null = null;

  // ── the cast ──
  readonly talk: Dialogue;
  protected tomas: EnemyActor | null = null;
  protected tomasPose = '';
  protected tomasSpot: 'chair' | 'glass' | 'door' | 'window' | 'held' | 'belt' | 'gone' = 'chair';
  protected escorts: EnemyActor[] = [];

  // ── what just happened (for line conditions) ──
  protected lastMovePos = new THREE.Vector3();
  protected lastMoveAt = 0;
  protected lastShotAt = -1e9;
  protected lastHurtAt = -1e9;
  protected provokedAt = -1e9;
  protected workerKilledAt = -1e9;
  protected syncAt = -1e9;
  protected glassShotAt = -1e9;
  protected glassShotInTrap = false;
  protected unit14ShotAt = -1e9;
  protected fitDist: number[] = [];
  protected held = false;
  protected onBeltTomas = false;
  protected tomasOffAir = false;

  constructor(
    protected ctx: GameContext,
    protected seq: Sequencer,
    protected director: MusicDirector,
    protected w: World,
    protected logs: Set<string>,
    protected hooks: HooksL2,
  ) {
    this.talk = new Dialogue(ctx, seq, this.facts);
    this.talk.bindActor('tomas', () => this.tomas);
    this.talk.onSaid = (id) => { if (!this.prog.heard) this.prog.heard = []; if (!this.prog.heard.includes(id)) this.prog.heard.push(id); };
  }

  // ───────────────────────────────────────────────────────────── small helpers

  protected get ui(): UIInternal { return this.ctx.ui as UIInternal; }
  protected get now(): number { return this.seq.time; }
  protected get f(): Flags { return this.prog.flags as unknown as Flags; }
  protected get pos(): THREE.Vector3 { return this.ctx.player.position; }
  protected has(id: string): boolean { return this.done.has(id); }
  /** A pause in the telling: tests may shorten it. */
  protected wait(s: number) { return this.seq.wait(this.talk.fast ? Math.min(s, 0.4) : s); }
  /** A wait that tests may not shorten (physical things: a walk, a door, a scene clock). */
  protected hold(s: number) { return this.seq.wait(s); }
  protected until(p: () => boolean) { return this.seq.waitUntil(p); }
  protected async untilOr(p: () => boolean, seconds: number): Promise<boolean> {
    const t0 = this.now;
    let ok = false;
    await this.until(() => (ok = p()) || this.now - t0 >= seconds);
    return ok;
  }
  protected S(name: string, fn: () => Promise<unknown>): void { this.seq.spawn(name, fn); }
  protected stamp(name: string): void { if (!(name in this.marks)) this.marks[name] = +this.now.toFixed(2); }

  protected abstract consequence(id: string): void;

  protected mark(id: string): boolean {
    if (this.done.has(id)) return false;
    this.done.add(id);
    this.prog.beats.push(id);
    this.consequence(id);
    this.syncPhase(); // a flag may have moved the phase: the level's table sets the doors
    return true;
  }
  /** A DESIGN.md beat: recorded, consequences applied, `story:beat` emitted. False = already happened. */
  protected beat(id: string): boolean {
    if (!this.mark(id)) return false;
    this.stamp(id);
    if (this.ctx.debug.verbose) console.log(`[story] beat ${id} @${this.now.toFixed(1)}s`);
    this.ctx.events.emit('story:beat', { id });
    return true;
  }
  /** Internal run-once cue ('#id' in the record). */
  protected once(id: string): boolean { return this.mark('#' + id); }

  // ── phases (the level's table is the single source of door state) ──

  /** The phase the record says the world is in. */
  protected get phase(): PhaseId {
    const f = this.f;
    if (f.choice) return 'I2';
    if (f.foremanDead) return 'I';
    if (f.apron) return 'H';
    if (f.escort) return f.escortDead ? 'G2' : 'G';
    if (f.boothOpen) return 'F';
    if (f.trapped) return 'E';
    if (f.power) return f.relayClear ? 'D2' : 'D';
    if (f.pass) return 'C';
    if (f.fitOpen) return 'B';
    return 'A';
  }
  /**
   * Apply the door / line state of the phase the record is in (level `applyPhase`). Called after every flag
   * change that moves the phase, and once at the end of a checkpoint fast-forward (snapped, no animation).
   */
  protected syncPhase(): void {
    const id = this.phase;
    if (this.ff || id === this.phaseApplied) return;
    this.phaseApplied = id;
    this.stamp('phase_' + id);
    if (this.ctx.debug.verbose) console.log(`[story] phase ${id} @${this.now.toFixed(1)}s`);
    applyPhase(this.ctx, id);
  }
  protected snapPhase(): void {
    this.phaseApplied = this.phase;
    applyPhase(this.ctx, this.phaseApplied, true);
  }
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

  // ── fights ──

  protected engage(group: string, how: 'wake' | 'spawn' | 'both', stagger?: number): void {
    if (!this.prog.triggered.includes(group)) this.prog.triggered.push(group);
    this.triggeredAt.set(group, this.now);
    if (how !== 'spawn') this.w.wakeGroup(group, stagger);
    if (how !== 'wake') this.w.spawnGroup(group);
  }
  protected fought(g: string, minDelay = 5): boolean {
    if (!this.prog.triggered.includes(g)) return false;
    if (this.prog.cleared.includes(g)) return true;
    return this.now - (this.triggeredAt.get(g) ?? -1e9) > minDelay && this.w.alive(g) === 0;
  }
  /** Delete a group without a trace (it is out of the player's world for good). */
  protected removeSilently(group: string): void {
    try { this.ctx.enemies.removeGroup(group); } catch (e) { console.warn(`[story] removeGroup ${group} failed`, e); }
    this.removedGroups.add(group);
    if (!this.prog.triggered.includes(group)) this.prog.triggered.push(group);
    this.triggeredAt.set(group, -1e9);
  }
  protected members(group: string): Enemy[] {
    try { return this.ctx.enemies.all.filter((e) => e.group === group && e.alive); } catch { return []; }
  }
  protected awakeIn(group: string): Enemy[] { return this.members(group).filter((e) => e.state !== 'dormant'); }

  // ── where the player is ──

  protected inRoom(room: string): boolean { return this.w.room() === room; }
  protected in(xMin: number, xMax: number, zMin: number, zMax: number): boolean {
    const p = this.pos;
    return p.x >= xMin && p.x <= xMax && p.z >= zMin && p.z <= zMax;
  }
  protected region(name: string, p: THREE.Vector3 = this.pos): boolean { return inRegion(this.ctx, name, p); }
  /** Inside a level trigger right now — or, for a level build without it, inside the fallback area. */
  protected at(trigger: string, fallback?: () => boolean): boolean {
    return this.insideTrig.has(trigger) || (!!fallback && fallback());
  }
  protected atGlass = () => this.inRoom('line') && this.in(-10, -6, -50, -41.5);
  protected atLoad = () => this.at('t2_load', () => this.inRoom('line') && this.in(1, 8, -47, -42));
  protected hallSouth = () => this.at('t2_line_south', () => this.inRoom('line') && this.pos.z < -54 && this.pos.x < 2.5);
  protected atCoreDoor = () => this.at('t2_core_door', () => this.inRoom('line') && this.pos.z < -66);
  protected onApron = () => this.at('t2_tunnel_out', () => this.in(2.5, 7.5, -66, -62.5) && this.w.room() !== 'relay');
  protected inTunnel = () => this.region('tunnel') && this.in(2.5, 7.5, -62, -50.35);

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

  protected get noteOpen(): boolean {
    if (this.legacyReading) return true;
    try { return !!this.ui.noteOpen; } catch { return false; }
  }
  protected free(): boolean {
    return this.ctx.state === 'playing' && !this.noteOpen && this.w.active() === 0 && this.now - this.lastCombat > 4;
  }
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

  // ── actors ──

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
    if (a && a === this.tomas) this.tomasPose = pose;
    try { a?.setPose(pose); } catch { /* ignore */ }
  }
  protected gait(a: EnemyActor | null, gait: string): void { try { a?.setGait?.(gait); } catch { /* ignore */ } }
  protected eyes(a: EnemyActor | null, on: boolean): void { try { a?.setEyes(on); } catch { /* ignore */ } }
  protected lookAt(a: EnemyActor | null, p: THREE.Vector3 | null): void { try { a?.lookAt(p); } catch { /* ignore */ } }
  /** Walk an actor through points (straight segments); gives up after a generous timeout. */
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
  /** Floor / deck / belt height under a point. */
  protected groundY(x: number, z: number, from = 3.2): number {
    try {
      const hit = this.ctx.physics.raycast(V(x, from, z), V(0, -1, 0), from + 0.5);
      if (hit) return hit.point.y;
    } catch { /* ignore */ }
    return 0;
  }

  // ── dialogue shortcuts ──

  protected say(id: string, opts?: SayOpts): Promise<boolean> { return this.talk.say(id, opts); }
  /** Tomas, in the ear. While he is at the hall glass he gestures along. */
  protected tomasSays(ids: string[], pri: 'scene' | 'talk' = 'scene', opts: SayOpts = {}): Promise<boolean> {
    return this.talk.lines(ids, { pri, ...opts, onStart: () => { if (this.tomas && this.tomasSpot === 'glass' && this.tomasPose !== 'wave') this.pose(this.tomas, 'talk'); } });
  }
  protected bark(id: string, cooldown = 60): void {
    if (!this.f.met || this.ended || !this.live) return;
    void this.say(id, { pri: 'bark', cooldown });
  }
  /** CHOIR over every speaker: chime first when it is a PA line. */
  protected async choir(ids: string[], opts: { chime?: boolean; glitch?: number; ttl?: number } = {}): Promise<void> {
    if (opts.chime) { this.w.play('pa_chime', undefined, 0.7); await this.wait(1.4); }
    await this.talk.lines(ids, { pri: 'scene', name: opts.chime ? 'PA' : 'CHOIR', gap: 0.5, ttl: opts.ttl, onStart: () => { if (opts.glitch) this.w.glitch(opts.glitch, 0.25); } });
  }

  // ───────────────────────────────────────────────────────────── facts (what the lines may assume)

  protected lookingAtWorker(): boolean {
    try {
      for (const e of this.ctx.enemies.all) {
        if (!e.alive || e.state !== 'dormant' || !WORKER_GROUPS.includes(e.group)) continue;
        if (this.distTo(e.position) > 9) continue;
        if (this.isLookingAt(this.tmp2.copy(e.position).setY(e.position.y + 1.6), 9, true)) return true;
      }
    } catch { /* ignore */ }
    return false;
  }
  protected unit32(): Enemy | null { return this.members('g2_unit32')[0] ?? null; }
  protected unit14(): Enemy | null { return this.members('g2_unit14')[0] ?? null; }
  /** Ghost state for the facts; the ghost layer overrides these. */
  protected ghostState(): 'none' | 'rig' | 'walk' | 'station' { return 'none'; }
  protected ghostBehind(): boolean { return false; }
  protected ghostThroughWallAt(): number { return -1e9; }
  protected rigPlaying(): boolean { return false; }
  /** The player's eye → Tomas's face crosses one of the spine windows, from within 4 m of it. */
  protected atSpineWindow(): boolean {
    const t = this.tomas;
    if (!t || !this.region('trap')) return false;
    const e = this.ctx.player.eye, h = this.headOf(t);
    if (e.x > -17 || h.x < -17 || Math.abs(h.x - e.x) < 1e-3) return false;
    const k = (-17 - e.x) / (h.x - e.x);
    const z = e.z + (h.z - e.z) * k;
    return SPINE_WINDOWS.some((w) => z > w.z0 && z < w.z1 && Math.hypot(e.x + 17, e.z - (w.z0 + w.z1) / 2) < 4);
  }

  protected readonly facts: Facts = ((self: Base): Facts => ({
    get onAir() { return self.f.met && !self.tomasOffAir && !self.f.loaded; },
    get phase() { return letterOf(self.phase); },
    get room() { return self.w.room(); },
    get met() { return self.f.met; },
    get fitOpen() { return self.f.fitOpen; },
    get pass() { return self.f.pass; },
    get power() { return self.f.power; },
    get lineRunning() { return self.has('#line_running') && !self.f.choice; },
    get hostiles() { return self.w.active(); },
    get health() { return self.ctx.player.health; },
    heard: (id) => self.talk.heard.has(id),
    visited: (room) => self.prog.visited.includes(room),
    alive: (g) => self.members(g).length,
    dormant: (g) => self.members(g).filter((e) => e.state === 'dormant').length,
    awake: (g) => self.awakeIn(g).length,
    calm: (g) => { const m = self.members(g); return m.length > 0 && m.every((e) => e.state === 'dormant'); },
    get awakeWorkers() { let n = 0; for (const g of WORKER_GROUPS) n += self.awakeIn(g).length; return n; },
    get workersKilled() { return self.f.workersKilled; },
    workerKilledWithin: (s) => self.now - self.workerKilledAt <= s,
    provokedWithin: (s) => self.now - self.provokedAt <= s,
    killedByPlayer: (g) => !self.removedGroups.has(g) && self.members(g).length === 0 && (self.diedIn.get(g) ?? 0) > 0,
    firedWithin: (s) => self.now - self.lastShotAt <= s,
    hurtWithin: (s) => self.now - self.lastHurtAt <= s,
    movedWithin: (s) => self.now - self.lastMoveAt <= s,
    read: (id) => self.prog.read.includes(id),
    readWithin: (id, s) => self.noteId === id || self.now - (self.closedAt.get(id) ?? -1e9) <= s,
    get reading() { return self.noteOpen; },
    deniedWithin: (door, s) => self.now - (self.deniedAt.get(door) ?? -1e9) <= s,
    deadDoorWithin: (s) => DEAD_DOORS.some((d) => self.now - (self.deniedAt.get(d) ?? -1e9) <= s),
    get headingToFitting() { const d = self.fitDist; return d.length >= 5 && d[0] - d[d.length - 1] > 0.5; },
    get atGlass() { return self.atGlass(); },
    get atCoreDoor() { return self.atCoreDoor(); },
    get seesTomasWaving() {
      return !!self.tomas && self.tomasSpot === 'glass' && self.tomasPose === 'wave' && self.inRoom('line') && self.pos.z > -50.35
        && self.distTo(GLASS) < 18 && self.isLookingAt(GLASS, 45);
    },
    get tomasInBooth() { return !!self.tomas && !self.f.taken; },
    get tomasAtDoor() { return !!self.tomas && self.tomasSpot === 'door'; },
    syncWithin: (s) => self.now - self.syncAt <= s,
    get ghost() { return self.ghostState(); },
    get ghostBehind() { return self.ghostBehind(); },
    ghostThroughWallWithin: (s) => self.now - self.ghostThroughWallAt() <= s,
    get rigPlaying() { return self.rigPlaying(); },
    get wakeBehind() {
      for (const e of self.awakeIn('g2_fit_wake')) {
        if (self.distTo(e.position) > 10) continue;
        if (self.notLookingAt(self.tmp2.copy(e.position).setY(e.position.y + 1.4).clone(), 60)) return true;
      }
      return false;
    },
    get fitFought() { return self.has('l2_fit_fight'); },
    get lightOnWorker() { return self.ctx.player.flashlightOn && self.lookingAtWorker(); },
    get atWindow() { return self.atSpineWindow(); },
    get held() { return self.held; },
    get taken() { return self.f.taken; },
    get tomasOnBelt() { return self.onBeltTomas; },
    get loaded() { return self.f.loaded; },
    get shotGlass() { return self.glassShotInTrap; },
    shotBoothGlassWithin: (s) => self.now - self.glassShotAt <= s,
    get escortsDead() { return self.f.escortDead; },
    get onBelt() { return self.insideTrig.has('t2_belt') && self.has('#line_running'); },
    get inTunnel() { return self.inTunnel(); },
    get unit32Alive() { return !!self.unit32(); },
    get unit32Dead() { return self.f.unit32Dead; },
    get foremanStarted() { return self.has('l2_foreman'); },
    get unit14Alive() { return !!self.unit14(); },
    get unit14Near() { const e = self.unit14(); return !!e && e.state === 'dormant' && self.distTo(e.position) < 6; },
    unit14ShotWithin: (s) => self.now - self.unit14ShotAt <= s,
    get core() { return self.f.core; },
    get offered() { return self.f.offered; },
    get choice() { return !!self.f.choice; },
  }))(this);
}
