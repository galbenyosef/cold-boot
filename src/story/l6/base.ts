/**
 * Level 6 script — shared state: flags, the level's markers (places), phase derivation, the FACTS the lines may ask,
 * the speech wrapper (subtitles, timed-line log, dur / end), the overlap channel, enemy and place helpers, the level-6
 * calm rule (holding soldiers ignored, the loader counted), the stray rule, the latch, the scare kit and `linesReady`
 * (stage 3d §3, §4, §5.7, §6, §7, §8.10). The level-5 pieces (calm / stray / bark gate / scare kit / latch /
 * linesReady) are COPIED from `src/story/l5` (rule 9), not imported.
 * Layers:
 *   ../stage/base.ts   the scaffolding (record, beats, waits, latches, fights, checkpoints, fast-forward, dialogue)
 *   base.ts (this)     level 6's flags, markers, phase, facts, speech wrapper, world helpers, scare kit
 *   boss.ts            the moon pool: reveal, the loader, stages, waves, milestones, the frame, the shear, the quiet (ST-b)
 *   scenes.ts          the ending E1 / E2 at the dock console (ST-b)
 *   script.ts          the route: arrival, tunnels, repeater, tunnel B, head-end, vault, shaft; keys, grips, the handset,
 *                      scares, Q, barks, checkpoints, restore, hooks (ST-a)
 *
 * Places come from the level's markers only (D22): `mk6_*` objects, doors and interactables by id, trigger boxes by id
 * (`ctx.__triggers`), rooms / regions by name. A missing marker is an error (`debugState.missingMarkers`).
 */
import * as THREE from 'three';
import type { Enemy, GameContext } from '../../core/types';
import type { Sequencer } from '../sequencer';
import type { MusicDirector } from '../director';
import type { World } from '../world';
import type { Cutscene } from '../cutscene';
import type { CheckpointIdL6, ProgressL6 } from '../save';
import { emptyProgressL6 } from '../save';
import { StageBase, V, DEG, type StageHooks } from '../stage/base';
import type { LineLog, SayOpts } from '../stage/dialogue';
import { applyPhase6, type PhaseId6 } from '../../level/l6/phases';
import { L6_DIALOGUE, isRadio6, line6, phaseRank6, speaker6, type Bark6, type Facts6 } from './dialogue';
import { ARRIVAL_DEFAULT6 } from './text';

export { V, DEG };

export interface HooksL6 extends StageHooks<CheckpointIdL6> {
  /** §7.2: the chapter end (carry, two cards, menu). */
  end(): Promise<void>;
}

/**
 * §7 flags (+ the route's own and the transient ones the phase derivation needs). Booleans unless noted; transient
 * ones (`holdOpen`, `storesOpen`) are reset by `afterReplay` (a save never holds a door standing open for a wave).
 */
export interface Flags6 {
  tubeOpen: boolean;
  tubeLatched: boolean;
  /** v6_crossing ran (F1's s1 walked the mouth). */
  crossing: boolean;
  /** F1 spawned (g6_tun_s exists this page or was fought). */
  f1: boolean;
  f1Free: boolean;
  f1Cancelled: boolean;
  /** F1 over (both groups dead / skipped, or cancelled): cp6_tunnel due. */
  f1Done: boolean;
  /** F2 spawned (beat l6_rep). */
  f2: boolean;
  bayLive: boolean;
  /** F3's soldier spawned (walks out of he6). */
  f3: boolean;
  f3Free: boolean;
  /** The head-end sequence started (beat l6_headend; cp6_he). */
  he: boolean;
  manual: boolean;
  /** note6_queue read (fact manifest). */
  queue: boolean;
  /** v6_handset ran (the call happened, answered or not). */
  handset: boolean;
  /** The handset was answered and l6_aas_2 heard (fact aas). */
  aas: boolean;
  /** F4 spawned. */
  f4: boolean;
  bjOpen: boolean;
  pulled: boolean;
  /** Level-clock second (`prog.t`) of the pull (−1 before). */
  pullT: number;
  /** F5 spawned. */
  f5: boolean;
  thud: boolean;
  shaftOpen: boolean;
  lights6: boolean;
  hatchVault: boolean;
  hatchHe: boolean;
  /** Transient: d6_hold standing open for F4 / F5 (phase B_hold). */
  holdOpen: boolean;
  /** Transient: d6_stores standing open for W1 / its twin (phase K_stores; boss.ts). */
  storesOpen: boolean;
  // ── the boss and the end (boss.ts / scenes.ts, ST-b)
  reveal: boolean;
  hostile: boolean;
  lights_out6: boolean;
  pin: boolean;
  /** 0 … 1 (cumulative pump work). */
  pressure: number;
  trunkCut: boolean;
  ramE: boolean;
  ramW: boolean;
  loaderDead: boolean;
  quiet: boolean;
  ending: boolean;
}
export const FLAGS6: Flags6 = {
  tubeOpen: false, tubeLatched: false, crossing: false, f1: false, f1Free: false, f1Cancelled: false, f1Done: false, f2: false,
  bayLive: false, f3: false, f3Free: false, he: false, manual: false, queue: false, handset: false, aas: false, f4: false,
  bjOpen: false, pulled: false, pullT: -1, f5: false, thud: false, shaftOpen: false, lights6: false, hatchVault: false,
  hatchHe: false, holdOpen: false, storesOpen: false,
  reveal: false, hostile: false, lights_out6: false, pin: false, pressure: 0, trunkCut: false, ramE: false, ramW: false,
  loaderDead: false, quiet: false, ending: false,
};
export function emptyProgress6(): ProgressL6 {
  return { ...emptyProgressL6(), flags: { ...FLAGS6 } as unknown as ProgressL6['flags'] };
}

/** §8.11: every marker the route reads (missing = error; boss.ts / scenes.ts check their own). */
export const STORY_MARKERS6 = [
  'mk6_start', 'mk6_tube_panel', 'mk6_cross_0', 'mk6_cross_1', 'mk6_tun_s1', 'mk6_tun_s2', 'mk6_tun_u1', 'mk6_tun_u2',
  'mk6_rep_s', 'mk6_bay_u1', 'mk6_bay_u2', 'mk6_vent_rep', 'mk6_he_s', 'mk6_tunb_hold', 'mk6_sentry',
  'mk6_switch', 'mk6_queue', 'mk6_handset', 'mk6_phone', 'mk6_hold_1', 'mk6_hold_2', 'mk6_hold_3', 'mk6_bj', 'mk6_loom',
  'mk6_shaft_lock', 'mk6_grille_1', 'mk6_grille_2', 'mk6_grille_3', 'mk6_vent_vault', 'mk6_exit_vault', 'mk6_exit_he', 'mk6_drum',
  'mk6_shaft_u', 'mk6_ll0', 'mk6_ll1', 'mk6_ll2', 'mk6_ll3', 'mk6_llb',
] as const;
/** Every story group of the route (debugState.groups; boss.ts adds its own). */
export const GROUPS6 = ['g6_tun_s', 'g6_tun_u', 'g6_rep_s', 'g6_rep_u', 'g6_rep_k', 'g6_tunb_s', 'g6_tunb_k', 'g6_he', 'g6_vault', 'g6_vault_k', 'g6_vault_kv', 'g6_shaft'] as const;
/** What may open in front of a group at its spawn (spawn visibility, §10.1): doors | vignettes. */
const OPENING6: Record<string, { doors?: string[]; vig?: string[] }> = {
  g6_rep_u: { doors: ['d6_bay'] }, g6_rep_k: { vig: ['vent6_rep'] }, g6_tunb_s: { doors: ['d6_he'] },
  g6_he: { doors: ['d6_hold'] }, g6_vault: { doors: ['d6_hold'] }, g6_vault_k: { vig: ['grille6_1', 'grille6_2', 'grille6_3'] },
  g6_vault_kv: { vig: ['vent6_vault'] }, g6_w1: { doors: ['d6_stores'] }, g6_w1_r: { doors: ['d6_stores'] },
  g6_w3: { doors: ['d6_pool'] }, g6_w3_r: { doors: ['d6_pool'] }, g6_w3_s: { doors: ['d6_stores'] }, g6_w3_s_r: { doors: ['d6_stores'] },
};
/** §5.7: the loud scares (L) and the ones exempt from spacing (S4); `v6_crossing` is the soldier himself (no vignette). */
export const LOUD6 = new Set(['v6_drum', 'v6_ring', 'v6_thud', 'v6_shaft_lights']);
export const EXEMPT6 = new Set(['v6_ring', 'v6_shaft_lights', 'v6_well_eyes']);
const NO_VIGNETTE6 = new Set(['v6_crossing']);

/** What the boss layer tells the facts and the calm rule (boss.ts implements it; stub values until ST-b). */
export interface BossFacts6 {
  stage: number; loaderAlive: boolean; loaderInView: boolean; onDock: boolean; inCage: boolean; soldierAlive: boolean;
  floodLitFor: number; floodAlive: boolean; slamRecoveryInView: boolean; ramsGone: number; endingPending: boolean; inEnding: boolean;
}

interface TrigBox { id: string; x0: number; x1: number; z0: number; z1: number; y0?: number; y1?: number }
type LogEntry = LineLog & { dur?: number; end?: number; cue?: number };

export abstract class Base6 extends StageBase<Flags6, PhaseId6, CheckpointIdL6, Facts6, ProgressL6> {
  protected declare hooks: HooksL6;
  /** Set by index.ts (the page's camera rig). */
  cut: Cutscene | null = null;
  /** §6.4 CLOCK6: the test hour at arrival (carried, else 62:45). */
  readonly arrivalHour: number;
  readonly missingMarkers: string[] = [];
  /** H7 spawnLog / strays / scareLog. */
  readonly spawnLog: { group: string; id: number; t: number; pos: [number, number, number]; visible: boolean }[] = [];
  readonly strays: { id: number; t: number }[] = [];
  readonly scareLog: { id: string; t: number; room: string | null }[] = [];
  /** Groups the story created (or that exist from load) on this page. */
  protected spawnedGroups = new Set<string>(['g6_tunb_k']);
  protected doorOpenedAt = new Map<string, number>();
  protected unseenFor = new Map<number, number>();
  /** Script time until which a radio line is on the channel (the HUD strip's live dot). */
  protected radioUntil = -1e9;
  /** Script time the last Kessler line ended / ends. */
  protected kesEndAt = -1e9;
  protected kesSpoke = false;
  protected lastEnemyShot = -1e9;
  protected shots: number[] = [];
  protected lastHitAny = -1e9;
  protected bark: Bark6 | null = null;
  /** A radio sequence holds the channel (other Kessler lines and barks wait). */
  protected seqBusy = false;
  /** A calm wait is running (a due checkpoint, the head-end, the quiet): the stray rule may act. */
  protected calmWaiting = false;
  /** Scare spacing (§5.7). */
  protected lastScare = -1e9;
  protected lastLoud = -1e9;

  constructor(ctx: GameContext, seq: Sequencer, director: MusicDirector, w: World, logs: Set<string>, hooks: HooksL6) {
    super(ctx, seq, director, w, logs, hooks, L6_DIALOGUE);
    const th = ctx.facts.testHour;
    this.arrivalHour = typeof th === 'number' && Number.isFinite(th) && th > 0 ? th : ARRIVAL_DEFAULT6;
    for (const m of STORY_MARKERS6) if (!this.obj(m)) { this.missingMarkers.push(m); console.error(`[story] level 6: marker "${m}" missing`); }
    this.trackPlayer();
    const ev = ctx.events;
    ev.on('door:opening', (e) => this.doorOpenedAt.set(e.id, this.now));
    ev.on('enemy:fired', () => { this.lastEnemyShot = this.now; });
    ev.on('weapon:fired', () => { this.shots.push(this.now); if (this.shots.length > 60) this.shots.shift(); });
    ev.on('enemy:damaged', () => { this.lastHitAny = this.now; });
    ev.on('enemy:spawned', (e) => this.onSpawned(e.id));
  }

  protected emptyProgress(): ProgressL6 { return emptyProgress6(); }
  /** The level clock (s since arrival, saved). */
  protected get t(): number { return this.prog.t; }
  protected get choice(): 'stop' | 'command' { return this.ctx.facts.choice === 'command' ? 'command' : 'stop'; }
  protected choiceId(base: string): string { return `${base}_${this.choice}`; }
  /** §7: the test hour now (carried as fact `testHour`). */
  clockHour(): number { return this.arrivalHour + this.t / 3600; }
  /** The test hour of a level-clock second (`launchAt`, the OSD). */
  hourAt(t: number): number { return this.arrivalHour + t / 3600; }

  /** The boss layer's facts (boss.ts). */
  protected abstract bossFacts(): BossFacts6;
  /** The loader counts against calm while alive and past `working` (§7.1; boss.ts). */
  protected abstract bossBusy(): boolean;

  // ───────────────────────────────────────────────────────────── phase (the level's table is the door truth)

  protected get phase(): PhaseId6 {
    const f = this.f;
    if (f.shaftOpen) return f.storesOpen ? 'K_stores' : 'K';
    if (f.holdOpen) return 'B_hold';
    if (f.bayLive) return 'B';
    if (f.tubeLatched) return 'U';
    if (f.tubeOpen) return 'T';
    return 'A';
  }
  protected applyPhaseTo(id: PhaseId6, snap: boolean): void {
    this.stamp(`phase:${id}`);
    try { applyPhase6(this.ctx, id, { snap }); } catch (e) { console.warn(`[story] applyPhase ${id} failed`, e); }
  }
  protected atLeast(p: PhaseId6): boolean { return phaseRank6(this.phase) >= phaseRank6(p); }
  protected set<K extends keyof Flags6>(k: K, v: Flags6[K]): void {
    (this.f as unknown as Record<string, unknown>)[k] = v;
    this.syncPhase();
  }

  // ───────────────────────────────────────────────────────────── markers, places

  protected obj(name: string): THREE.Object3D | null {
    try { return this.ctx.level.object(name) ?? null; } catch { return null; }
  }
  /** World position of a marker (fallback: `fb`, or the player — the marker's absence is already an error). */
  protected mk(name: string, fb?: THREE.Vector3): THREE.Vector3 {
    const o = this.obj(name);
    if (o) { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); }
    return fb ? fb.clone() : this.pos.clone();
  }
  /** A level trigger's box (`ctx.__triggers`, level/triggers.ts). */
  protected trig(id: string): TrigBox | null {
    const t = (this.ctx as unknown as { __triggers?: readonly TrigBox[] }).__triggers;
    return t?.find((x) => x.id === id) ?? null;
  }
  /** Feet inside a trigger box (3-D) grown by `pad` m in x / z. */
  protected inTrig(id: string, pad = 0): boolean {
    if (pad <= 0 && this.insideTrig.has(id)) return true;
    const t = this.trig(id);
    if (!t) return this.insideTrig.has(id);
    const p = this.pos;
    return p.x >= t.x0 - pad && p.x <= t.x1 + pad && p.z >= t.z0 - pad && p.z <= t.z1 + pad && p.y > (t.y0 ?? -1) - 0.2 && p.y < (t.y1 ?? 4);
  }
  protected roomOf(p: THREE.Vector3): string | null {
    try { return this.ctx.level.roomAt(p)?.id ?? null; } catch { return null; }
  }
  /** Feet in the cable trench (the floors below the vault / head-end). */
  protected inTrench(p: THREE.Vector3 = this.pos): boolean { return this.region3('trench', p) || this.inTrig('t6_trench'); }
  /** Within 1.0 m of a door plane (scares never fire there, §5.7). */
  protected inDoorway(): boolean {
    try {
      for (const d of this.ctx.level.doors) {
        const p = d.position;
        if (Math.abs(this.pos.y - this.doorFloor(d)) > 1.5) continue;
        if (Math.hypot(this.pos.x - p.x, this.pos.z - p.z) <= 1.6) {
          const s = d as unknown as { wall?: string; spec?: { wall?: string } };
          const wall = s.wall ?? s.spec?.wall;
          const across = wall === 'x' ? Math.abs(this.pos.x - p.x) : wall === 'z' ? Math.abs(this.pos.z - p.z) : Math.hypot(this.pos.x - p.x, this.pos.z - p.z);
          if (across <= 1.0) return true;
        }
      }
    } catch { /* ignore */ }
    return false;
  }

  // ───────────────────────────────────────────────────────────── enemies

  /** The soldier object behind an enemy (`enemies.debug.soldier(id)`). */
  protected soldierObj(id: number): {
    holdingNow?: boolean; patrolling?: boolean; seesPlayer?: boolean;
    patrol?: (points: THREE.Vector3[], o: { speed?: number; light?: boolean; end: 'hold' }) => void;
  } | null {
    try {
      const dbg = (this.ctx.enemies as unknown as { debug?: { soldier?: (id: number) => unknown } }).debug;
      return (dbg?.soldier?.(id) as never) ?? null;
    } catch { return null; }
  }
  protected soldierRows(): { id: number; group: string; pos: number[]; holding: boolean; aware: boolean; sees?: boolean; state: string }[] {
    try {
      const dbg = (this.ctx.enemies as unknown as { debug?: { soldiers?: () => unknown[] } }).debug;
      return (dbg?.soldiers?.() ?? []) as never;
    } catch { return []; }
  }
  protected isHolding(e: Enemy): boolean {
    if (e.type !== 'soldier') return false;
    const s = this.soldierObj(e.id);
    if (s && typeof s.holdingNow === 'boolean') return s.holdingNow;
    try { return e.state === 'idle' && this.ctx.enemies.holding(e.group) > 0; } catch { return false; }
  }
  /** Living, awake, hostile (not dormant, not a holding soldier, not the loader — the boss layer counts it). */
  protected awakeHostiles(): Enemy[] {
    try { return this.ctx.enemies.all.filter((e) => e.alive && e.state !== 'dormant' && e.type !== 'loader' && !this.isHolding(e)); } catch { return []; }
  }
  protected hostileWithin(m: number): boolean {
    return this.awakeHostiles().some((e) => e.position.distanceTo(this.pos) <= m);
  }
  protected holdingIn(group: string): number {
    try { return this.ctx.enemies.holding(group); } catch { return 0; }
  }
  /** Record a group as triggered (released / woken by itself): the calm rule waits for it; removed on load. */
  protected markTriggered(group: string): void {
    if (!this.prog.triggered.includes(group)) this.prog.triggered.push(group);
    this.triggeredAt.set(group, this.now);
  }
  /** Spawn a group: `triggered` (a fight: in `prog.triggered`, removed on load) or held (`spawnGroup` only). */
  protected spawn(group: string, triggered = true): void {
    this.spawnedGroups.add(group);
    if (triggered) this.engage(group, 'spawn');
    else this.w.spawnGroup(group);
  }
  private onSpawned(id: number): void {
    // spawn visibility (§10.1, R4 evidence): on the next frame, was the member in view (frustum + a clear ray to its
    // chest), unless the door / vent / grille in front of it opened within the last 3 s
    this.S('spawnlog', async () => {
      await this.hold(0.02);
      let e: Enemy | undefined;
      try { e = this.ctx.enemies.all.find((x) => x.id === id); } catch { /* ignore */ }
      if (!e || !e.group) return;
      const chest = e.position.clone().setY(e.position.y + (e.type === 'skitter' ? 0.3 : 1.3));
      const seen = this.inFrustum(chest) && this.los(chest);
      const op = OPENING6[e.group] ?? {};
      const opened = (op.doors ?? []).some((d) => this.now - (this.doorOpenedAt.get(d) ?? -1e9) <= 3)
        || (op.vig ?? []).some((g) => this.now - (this.marks[`vignette:${g}`] ?? -1e9) <= 3);
      this.spawnLog.push({ group: e.group, id: e.id, t: +this.now.toFixed(2), pos: [+e.position.x.toFixed(2), +e.position.y.toFixed(2), +e.position.z.toFixed(2)], visible: seen && !opened });
      if (this.spawnLog.length > 120) this.spawnLog.shift();
    });
  }
  protected inFrustum(p: THREE.Vector3): boolean {
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    const v = p.clone().project(cam);
    return v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
  }
  /** Would a member of `group` be seen at its spawn point now (frustum + a clear ray to its chest)? (§4.2 R4) */
  protected spawnVisible(group: string): boolean {
    return this.w.spawns(group).some((s) => { const c = s.position.clone().setY(s.position.y + 1.3); return this.inFrustum(c) && this.los(c); });
  }

  /**
   * The stray rule (3c §4.7, S2; level-wide during any calm wait): an awake hostile unseen ≥ 30 s and ≥ 25 m away is
   * removed silently. Groups go whole (the enemy contract has no per-unit removal): a group is removed when every living
   * awake member of it is a stray and none of it is holding. Never the loader (the boss layer owns it).
   */
  protected strayRule(step: number): void {
    const live = this.awakeHostiles();
    const ids = new Set(live.map((e) => e.id));
    for (const k of [...this.unseenFor.keys()]) if (!ids.has(k)) this.unseenFor.delete(k);
    for (const e of live) {
      const far = this.distTo(e.position) >= 25 && !this.los(e.position.clone().setY(e.position.y + 1.1));
      this.unseenFor.set(e.id, far ? (this.unseenFor.get(e.id) ?? 0) + step : 0);
    }
    if (!this.calmWaiting || this.ctx.state !== 'playing') return;
    const groups = new Set(live.map((e) => e.group));
    for (const g of groups) {
      if (!g || g.startsWith('test') || g === 'g6_loader') continue;
      const m = this.members(g);
      if (m.some((e) => this.isHolding(e))) continue;
      const awake = m.filter((e) => e.state !== 'dormant');
      if (!awake.length || !awake.every((e) => (this.unseenFor.get(e.id) ?? 0) >= 30)) continue;
      if (m.some((e) => e.state === 'dormant')) continue;
      for (const e of awake) this.strays.push({ id: e.id, t: +this.now.toFixed(2) });
      console.warn(`[story] ${g}: stray (unseen ≥ 30 s, ≥ 25 m) during a calm wait — removed`);
      this.removeSilently(g);
    }
  }

  // ───────────────────────────────────────────────────────────── checkpoints: the level-6 calm rule

  /**
   * 3c B1 / S2f: a group still in `hold` is not a fight — it is not in `triggered` until released, and a holding soldier
   * is not awake (`EnemyManager.holding`). The loader counts explicitly (alive and past `working` = not calm). Otherwise the
   * stage rule: playing, in control, standing, nothing hunting, the fights over 1.5 s.
   */
  protected override calm(): boolean {
    const ctx = this.ctx, p = ctx.player;
    if (ctx.state !== 'playing' || !this.live || this.ended || this.noteOpen) return false;
    if (this.checkpointBlocked()) return false;
    if (!p.alive || p.health <= 0 || !p.controlsEnabled) return false;
    if (Math.abs(p.velocity.y) > 0.4) return false;
    if (this.bossBusy()) return false;
    if (this.awakeHostiles().length > 0 || this.now - this.lastCombat < 1.5) return false;
    for (const g of this.prog.triggered) if (g !== 'g6_loader' && !this.fought(g, 1.5)) return false;
    return true;
  }

  /**
   * §3 latch: `closeBehind`, but a player standing in the doorway fails it at once — the door never closes on them; it
   * reopens and the caller re-arms only once the player has moved off (3c lesson). `halfW` / `halfD`: the doorway box
   * (along / across the wall).
   */
  protected async latch(id: string, keepSide: () => boolean, halfW: number, halfD: number, timeout: number): Promise<boolean> {
    const d = this.door(id);
    if (!d) return keepSide();
    const wall = (d as unknown as { spec?: { wall?: string } }).spec?.wall ?? 'z';
    const inDoorway = () => {
      const ax = Math.abs(this.pos.x - d.position.x), az = Math.abs(this.pos.z - d.position.z);
      const [along, across] = wall === 'x' ? [az, ax] : [ax, az];
      return along < halfW && across < halfD && Math.abs(this.pos.y - this.doorFloor(d)) < 1.5;
    };
    if (!inDoorway()) {
      d.lock();
      const t0 = this.now;
      await this.until(() => this.isShut(d) || inDoorway() || this.now - t0 > timeout);
      if (!inDoorway() && this.isShut(d) && keepSide()) return true;
    }
    d.unlock();
    d.open();
    return false;
  }

  // ───────────────────────────────────────────────────────────── speech (subtitles, the timed-line log)

  /** The channel could start a line on this frame (nothing playing or queued, its gap over). */
  protected channelFree(): boolean {
    const next = (this.talk as unknown as { nextAt?: number }).nextAt ?? 0;
    return !this.talk.busy && this.now >= next;
  }
  /** The subtitle of a level-6 line (the shared DB has no level-6 text: written here, never twice). */
  protected subtitle(id: string, d: number, name?: string, show: boolean | (() => boolean) = true): void {
    let on = true;
    try { on = typeof show === 'function' ? show() !== false : show !== false; } catch { on = true; }
    const l = line6(id);
    if (!on || !l?.text) return;
    this.ctx.events.emit('story:subtitle', { speaker: name ?? speaker6(l), text: l.text, duration: d + 0.25 });
  }
  private noteStart(id: string, d: number): void {
    const l = line6(id);
    if (isRadio6(l)) this.radioUntil = Math.max(this.radioUntil, this.now + d);
    if (l?.speaker === 'kessler') { this.kesEndAt = this.now + d; this.kesSpoke = true; }
  }

  /**
   * Every level-6 line goes through here: the subtitle (with the line's label), and the H5 log fields — `dur` and `end`
   * for every line, `cue` for every TIMED line (asked on its beat — `cue` given, or `now` — with the channel free: a line
   * that must wait its turn by design is logged without a cue).
   */
  protected override say(id: string, opts: SayOpts & { cue?: number } = {}): Promise<boolean> {
    const timed = (opts.cue !== undefined || (!!opts.now && opts.pri !== 'talk' && opts.pri !== 'bark')) && this.channelFree();
    const cue = opts.cue ?? this.now;
    const user = opts.onStart;
    const show = opts.subtitle ?? true;
    let entry: LogEntry | null = null;
    const p = super.say(id, {
      ...opts,
      subtitle: false,
      onStart: (d) => {
        entry = (this.talk.log[this.talk.log.length - 1] as LogEntry) ?? null;
        const said = entry?.said ?? id;
        if (entry) { entry.dur = +d.toFixed(3); if (timed) entry.cue = +cue.toFixed(3); }
        this.subtitle(said, d, opts.name, show);
        this.noteStart(said, d);
        user?.(d);
      },
    });
    void p.then(() => { if (entry) entry.end = +this.now.toFixed(3); });
    return p;
  }

  /**
   * A voice that does not wait its turn (the overlap channel): a panel answering a press, CHOIR cutting in over Kessler.
   * Starts THIS frame; resolves at its end (true) or false when its rule said no.
   */
  protected overlapLine(id: string, opts: { at?: THREE.Vector3 | (() => THREE.Vector3 | null); cue?: number; onStart?: (d: number) => void; subtitle?: boolean | (() => boolean) } = {}): Promise<boolean> {
    const cue = opts.cue ?? this.now;
    const qp = performance.now();
    const d = this.talk.overlap(id, { at: opts.at as THREE.Vector3 | undefined, subtitle: false });
    const entry = this.talk.log[this.talk.log.length - 1] as (LogEntry & { qp?: number; sp?: number }) | undefined;
    if (d <= 0) return Promise.resolve(false);
    const said = entry?.said ?? id;
    if (entry) { entry.dur = +d.toFixed(3); entry.cue = +cue.toFixed(3); entry.q = +this.now.toFixed(3); entry.qp = qp; entry.sp = performance.now(); }
    this.subtitle(said, d, undefined, opts.subtitle ?? true);
    this.noteStart(said, d);
    try { opts.onStart?.(d); } catch (e) { console.warn('[story] overlap onStart failed', e); }
    return new Promise((resolve) => {
      this.S('over_' + id, async () => { await this.hold(d); if (entry) entry.end = +this.now.toFixed(3); resolve(true); });
    });
  }
  /** A UNIT line at a panel (overlap channel: a panel does not wait its turn). */
  protected unit(id: string, at?: THREE.Vector3, onStart?: (d: number) => void): Promise<boolean> {
    return this.overlapLine(id, { at, onStart });
  }

  /**
   * Wait (wall clock, ≤ `timeout` s) until every line in `ids` is decoded and processed by the audio — so a cue's line
   * starts on the cue's frame, with its gesture (level 3's rule; copied from level 5).
   */
  protected async linesReady(ids: string[], timeout: number): Promise<boolean> {
    const a = this.ctx.audio as unknown as { preloadVoice?: (ids: string[]) => Promise<void> };
    if (typeof a.preloadVoice !== 'function') return true;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      a.preloadVoice(ids).then(() => { done = true; }, () => undefined),
      new Promise<void>((r) => { timer = setTimeout(r, timeout * 1000); }),
    ]);
    if (timer) clearTimeout(timer);
    if (!done) console.warn(`[story] lines not ready after ${timeout} s — starting anyway`);
    return done;
  }

  // ───────────────────────────────────────────────────────────── scares (§5.7, 3c kit copied)

  /** "Calm" for a scare: no awake hostile within 30 m, no shot by anyone within 4 s, playing, no note. */
  protected scareCalm(allowKessler: boolean): boolean {
    if (this.ctx.state !== 'playing' || this.noteOpen) return false;
    if (this.hostileWithin(30)) return false;
    if (this.now - this.lastShotAt < 4 || this.now - this.lastEnemyShot < 4) return false;
    if (!allowKessler) {
      const sp = this.talk.speaking;
      if (this.seqBusy || (sp && line6(sp)?.speaker === 'kessler')) return false;
    }
    return true;
  }
  /**
   * §5.7 common rule: once, calm, spacing (45 s / loud 90 s; EXEMPT6 skip it), never within 1.0 m of a door plane; the
   * boss rule (none from the hostile start until the quiet) is the caller's (boss.ts).
   */
  protected scareOk(id: string, allowKessler = false): boolean {
    if (this.prog.scares.includes(id)) return false;
    if (!this.scareCalm(allowKessler)) return false;
    if (!EXEMPT6.has(id)) {
      if (this.now - this.lastScare < 45) return false;
      if (LOUD6.has(id) && this.now - this.lastLoud < 90) return false;
    }
    return !this.inDoorway();
  }
  /** Record and fire a scare (the level's vignette plays its own sounds, D25). */
  protected fireScare(id: string): void {
    if (this.prog.scares.includes(id)) return;
    this.prog.scares.push(id);
    this.scareLog.push({ id, t: +this.now.toFixed(2), room: this.w.room() });
    if (!EXEMPT6.has(id)) {
      this.lastScare = this.now;
      if (LOUD6.has(id)) this.lastLoud = this.now;
    }
    if (!NO_VIGNETTE6.has(id)) this.vig(id);
    else this.stamp(`vignette:${id}`);
  }

  // ───────────────────────────────────────────────────────────── world helpers

  /** Fire a level vignette (stamped `vignette:<id>` in debugState.t, first time only). */
  protected vig(id: string): boolean { this.stamp(`vignette:${id}`); return this.w.vignette(id); }
  /** The `:snap` convention (§8.7): the vignette's end state, silent. */
  protected snapVig(id: string): void { this.w.vignette(`${id}:snap`); }
  /** A first-view / earned fact, on `ctx.facts` as soon as it is earned. */
  protected earn(key: string, v: unknown = true): void {
    (this.ctx.facts as Record<string, unknown>)[key] = v;
  }
  protected screen(name: string, kind: Parameters<World['screen']>[1], text?: string): void { this.w.screen(name, kind, text); }
  protected screenText(name: string): string {
    try { return String(this.ctx.level.screen(name)?.userData?.screenText ?? ''); } catch { return ''; }
  }
  protected sfx(id: string, at?: THREE.Vector3, volume?: number): void { if (!this.ff) this.w.play(id, at, volume); }
  /** A set piece's userData API (W7 `switch6`, `bj6`, `shaft6`, `phone6`, …) — null when absent. */
  protected api(name: string): Record<string, unknown> | null {
    const o = this.obj(name);
    return o ? (o.userData as Record<string, unknown>) : null;
  }
  protected call(name: string, fn: string, ...a: unknown[]): boolean {
    const f = this.api(name)?.[fn];
    if (typeof f !== 'function') return false;
    try { (f as (...x: unknown[]) => unknown)(...a); return true; } catch (e) { console.warn(`[story] ${name}.${fn} failed`, e); return false; }
  }
  /** A clear ray from the eye to `p`, within `cone`° of the view and `range` m. */
  protected sees(p: THREE.Vector3, range: number, cone = 50, needLos = true): boolean {
    if (this.ctx.player.eye.distanceTo(p) > range) return false;
    return this.isLookingAt(p, cone, needLos);
  }

  // ───────────────────────────────────────────────────────────── facts

  /** Overridden by the script (route state the facts read). */
  protected f1BothFree(): boolean { return false; }
  protected f3SeenFor(): number { return 0; }
  protected thudAt = -1e9;
  protected shaftLightsAt = -1e9;
  protected queueClosed(): boolean { return false; }

  protected readonly facts: Facts6 = ((self: Base6): Facts6 => {
    const common = self.commonFacts();
    const F = () => self.f;
    const B = () => self.bossFacts();
    const extra = {
      get phase() { return self.phase; },
      atLeast: (p: PhaseId6) => self.atLeast(p),
      get choice() { return self.choice; },
      get tubeLatched() { return F().tubeLatched; },
      get f1BothFree() { return self.f1BothFree(); },
      get f1SoldiersDead() { return (F().f1 || F().f1Done) && self.members('g6_tun_s').length === 0; },
      get f2Spawned() { return F().f2; },
      get f2InView() { return ['g6_rep_s', 'g6_rep_u', 'g6_rep_k'].some((g) => self.memberInView(g)); },
      get f3Holding() { return self.holdingIn('g6_tunb_s') > 0; },
      get f3SeenFor() { return self.f3SeenFor(); },
      get manual() { return F().manual; },
      get bjOpen() { return F().bjOpen; },
      get pulled() { return F().pulled; },
      get shaftOpen() { return F().shaftOpen; },
      get queueClosed() { return self.queueClosed(); },
      get f4Spawned() { return F().f4; },
      get f4InView() { return self.memberInView('g6_he'); },
      get inVault() { return self.roomOf(self.pos) === 'vault6'; },
      get inHeVault() { const r = self.roomOf(self.pos); return r === 'he6' || r === 'vault6' || self.inTrench(); },
      get inPoolShaft() { const r = self.roomOf(self.pos); return r === 'pool6' || r === 'shaft6'; },
      thudWithin: (s: number) => self.now - self.thudAt <= s,
      get shaftLightsAgo() { return self.now - self.shaftLightsAt; },
      hostileWithin: (m: number) => self.hostileWithin(m),
      get wastingRounds() { const n = self.shots.filter((t) => self.now - t <= 8).length; return n >= 15 && self.now - self.lastHitAny > 8; },
      get darkWithLight() { return self.region3('dark') && self.ctx.player.flashlightOn; },
      get bark() { return self.bark; },
      // the boss and the end
      get revealed() { return F().reveal; },
      get hostile() { return F().hostile; },
      get stage() { return B().stage; },
      get loaderAlive() { return B().loaderAlive; },
      get loaderInView() { return B().loaderInView; },
      get onDock() { return B().onDock; },
      get inCage() { return B().inCage; },
      get soldierAlive() { return B().soldierAlive; },
      get floodLitFor() { return B().floodLitFor; },
      get floodAlive() { return B().floodAlive; },
      get slamRecoveryInView() { return B().slamRecoveryInView; },
      get ramsGone() { return B().ramsGone; },
      get pinOut() { return F().pin; },
      get pressure() { return Number(F().pressure) || 0; },
      get trunkCut() { return F().trunkCut; },
      get loaderDead() { return F().loaderDead; },
      get quiet() { return F().quiet; },
      get endingPending() { return B().endingPending; },
      get inEnding() { return B().inEnding; },
      get manifestRead() { return F().queue || self.ctx.facts.manifest === true; },
    };
    const out = Object.create(null) as Facts6;
    Object.defineProperties(out, Object.getOwnPropertyDescriptors(common));
    Object.defineProperties(out, Object.getOwnPropertyDescriptors(extra));
    return out;
  })(this);
}
