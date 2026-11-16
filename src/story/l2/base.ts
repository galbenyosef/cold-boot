/**
 * Level 2 script — shared state, helpers and the FACTS the dialogue rules ask (REVISION 5).
 *
 * The script is one class cut into layers so no file is a wall of text:
 *   ../stage/base.ts   the shared scaffolding: the record, beats, waits, place / actor helpers, phase plumbing,
 *                      latches, fights, checkpoints, fast-forward, the dialogue channel (stage 3a §8.13)
 *   base.ts    (this)  level 2's flags, places, cast, phase derivation and `facts`
 *   ghost.ts           the two holograms: pattern 14 roaming the section, pattern 00 on the rig
 *   taking.ts          Section C → the trap → the window → the loading → the escorts → the ride
 *   script.ts          everything else (acts 1–2, 4–5), consequences, checkpoint rules, barks, reactions, debug
 *
 * Construction rules (unchanged from level 1): every beat is its own thread waiting on its own condition;
 * everything that must survive a reload lives in ONE serialisable record (`prog`); every beat has an
 * idempotent entry in `CONSEQUENCES`, so loading a checkpoint applies them with no scene (`fastForward`).
 * REVISION 5 adds: door state comes from the phase table only (`setPhase` → level `applyPhase`), a closing
 * door behind the player is always a latch (`closeBehind`), and no line is spoken on an assumption
 * (`facts`, `Dialogue` rules).
 */
import * as THREE from 'three';
import type { Enemy, EnemyActor, GameContext } from '../../core/types';
import type { Sequencer } from '../sequencer';
import type { MusicDirector } from '../director';
import type { World } from '../world';
import type { CheckpointIdL2, ProgressL2 } from '../save';
import { StageBase, DEG, V, face, type StageHooks } from '../stage/base';
import { L2_DIALOGUE, type Facts, type SayOpts } from './dialogue';
import { REGION_FALLBACK_L2, applyPhase, letterOf, type PhaseId } from './phases';

export { DEG, V, face };

export interface HooksL2 extends StageHooks<CheckpointIdL2> {
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
  /** REVISION 6.1: husks the story removed from the player's world while alive (a stranded unit's last resort). */
  husksRemoved: number;
}
export const FLAGS0: Flags = {
  arrived: false, hall: false, seen: false, met: false, fitOpen: false, rig: false, pass: false, power: false, relayClear: false,
  trapped: false, taken: false, boothOpen: false, loaded: false, escort: false, escortDead: false, apron: false, unit32Dead: false,
  foremanDead: false, ghostIntro: false, unit14Shot: false, unit14Dead: false, core: false, offered: false, choice: '',
  workersKilled: 0, husksKilled: 0, husksRemoved: 0,
};
export function emptyProgressL2(): ProgressL2 {
  return { beats: [], read: [], visited: [], flags: { ...FLAGS0 }, triggered: [], cleared: [], checkpoints: [], heard: [] };
}

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

export abstract class Base extends StageBase<Flags, PhaseId, CheckpointIdL2, Facts, ProgressL2> {
  protected declare hooks: HooksL2;

  // ── the cast ──
  protected tomas: EnemyActor | null = null;
  protected tomasPose = '';
  protected tomasSpot: 'chair' | 'glass' | 'door' | 'window' | 'held' | 'belt' | 'gone' = 'chair';
  protected escorts: EnemyActor[] = [];

  // ── what just happened (for line conditions) ──
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

  constructor(ctx: GameContext, seq: Sequencer, director: MusicDirector, w: World, logs: Set<string>, hooks: HooksL2) {
    super(ctx, seq, director, w, logs, hooks, L2_DIALOGUE);
    this.regionFallback = REGION_FALLBACK_L2;
    this.talk.bindActor('tomas', () => this.tomas);
  }

  protected emptyProgress(): ProgressL2 { return emptyProgressL2(); }
  protected override onPose(a: EnemyActor, pose: string): void { if (a === this.tomas) this.tomasPose = pose; }
  /** Its living units no longer count as units on the line (`unitsLeft`) — unless `gone` is false (they merely stay behind the partition). */
  protected override onRemoved(_group: string, living: Enemy[], gone: boolean): void {
    if (gone) this.f.husksRemoved = (this.f.husksRemoved ?? 0) + living.filter((e) => e.type === 'husk').length;
  }

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
  protected applyPhaseTo(id: PhaseId, snap: boolean): void { applyPhase(this.ctx, id, snap); }

  /**
   * REVISION 6.1 — the ONE count: units still on this line = 32 − every unit destroyed or removed in this level.
   * Both option cards, the ending card and CHOIR's `_7` / `_7_killed` variant read it.
   */
  protected unitsLeft(): number { return Math.max(0, 32 - (this.f.husksKilled ?? 0) - (this.f.husksRemoved ?? 0)); }

  // ── where the player is ──

  protected atGlass = () => this.inRoom('line') && this.in(-10, -6, -50, -41.5);
  protected atLoad = () => this.at('t2_load', () => this.inRoom('line') && this.in(1, 8, -47, -42));
  protected hallSouth = () => this.at('t2_line_south', () => this.inRoom('line') && this.pos.z < -54 && this.pos.x < 2.5);
  protected atCoreDoor = () => this.at('t2_core_door', () => this.inRoom('line') && this.pos.z < -66);
  protected onApron = () => this.at('t2_tunnel_out', () => this.in(2.5, 7.5, -66, -62.5) && this.w.room() !== 'relay');
  protected inTunnel = () => this.region('tunnel') && this.in(2.5, 7.5, -62, -50.35);

  // ── dialogue shortcuts ──

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
    get unitsGone() { return 32 - self.unitsLeft(); },
    get foremanDead() { return self.f.foremanDead; },
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
