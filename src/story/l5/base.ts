/**
 * Level 5 script — shared state: flags, the level's markers (places), phase derivation, the FACTS the lines may ask,
 * the speech wrapper (subtitles, timed-line log, dur / end), the overlap channel, enemy and place helpers, the level-5
 * calm rules (checkpoints, door-calm, scares) and the stray rule (stage 3c §3, §4, §5, §6, §8.10).
 * Layers (as levels 3 / 4):
 *   ../stage/base.ts   the scaffolding (record, beats, waits, latches, fights, checkpoints, fast-forward, dialogue)
 *   base.ts (this)     level 5's flags, markers, phase, facts, speech wrapper, world helpers
 *   scenes.ts          the cutscene "Under control" (§4.2)
 *   script.ts          the flow: arrival, the units, the first soldier, the radio, the keypad, Post 4, the crawl,
 *                      the door, lights-out, the sub bay, the wheel, the tunnel, the end; scares; Q; checkpoints; hooks
 *
 * Places come from the level's markers only (D22): `mk5_*` objects, doors and interactables by id, trigger boxes by
 * id (`ctx.__triggers`), rooms / regions by name. A missing marker is an error (`debugState.missingMarkers`).
 */
import * as THREE from 'three';
import type { Enemy, GameContext } from '../../core/types';
import type { Sequencer } from '../sequencer';
import type { MusicDirector } from '../director';
import type { World } from '../world';
import type { Cutscene } from '../cutscene';
import type { CheckpointIdL5, ProgressL5 } from '../save';
import { emptyProgressL5 } from '../save';
import { StageBase, V, DEG, type StageHooks } from '../stage/base';
import type { LineLog, SayOpts } from '../stage/dialogue';
import { applyPhase5, type PhaseId5 } from '../../level/l5/phases';
import { L5_DIALOGUE, isRadio5, line5, phaseRank5, speaker5, type Bark5, type Facts5 } from './dialogue';
import { ARRIVAL_DEFAULT5 } from './text';

export { V, DEG };

export interface HooksL5 extends StageHooks<CheckpointIdL5> {
  /** §7: the stage end (carry, end card, menu). */
  end(): Promise<void>;
}

/** §7 flags (+ the transient ones the phase derivation needs: never saved in a checkpoint — `checkpointBlocked`). */
export interface Flags5 {
  gateOpen: boolean;
  gateLatched: boolean;
  /** Transient: the camera is taken (phase C). */
  inScene: boolean;
  /** The scene ended (hand-back): D0. */
  scene: boolean;
  /** d5_ready opened for the units (D). */
  unitsIn: boolean;
  s1Free: boolean;
  radio: boolean;
  /** Kessler's power cue (K). */
  powered: boolean;
  /** 4719 accepted (S). */
  keypad: boolean;
  spineWave: boolean;
  /** Transient: d5_dive held open for g5_spine (S_dive). */
  diveOpen: boolean;
  hatchSpine: boolean;
  hatchMag: boolean;
  /** v5_boots fired (g5_patrol exists this page). */
  boots: boolean;
  /** The door beat started. */
  door: boolean;
  /** The neck check done (l5_verified). */
  checked: boolean;
  /** l5_kes_door_7 started: phase V. */
  verified: boolean;
  /** Lights-out (l5_dark). */
  dark: boolean;
  /** g5_cmd spawned. */
  cmdWave: boolean;
  /** Transient: d5_lockside held open for a wave (V_lock / W_lock). */
  lockOpen: boolean;
  bayA: boolean;
  /** The wheel was used. */
  wheel: boolean;
  /** The wheel's clock ran out: phase W. */
  released: boolean;
  /** Latched in the tunnel: X. */
  tunnel: boolean;
  patrolFree: boolean;
  /** g5_mag woke (v5_magazine). */
  magAwake: boolean;
}
export const FLAGS5: Flags5 = {
  gateOpen: false, gateLatched: false, inScene: false, scene: false, unitsIn: false, s1Free: false, radio: false, powered: false,
  keypad: false, spineWave: false, diveOpen: false, hatchSpine: false, hatchMag: false, boots: false, door: false, checked: false,
  verified: false, dark: false, cmdWave: false, lockOpen: false, bayA: false, wheel: false, released: false, tunnel: false,
  patrolFree: false, magAwake: false,
};
export function emptyProgress5(): ProgressL5 {
  return { ...emptyProgressL5(), flags: { ...FLAGS5 } as unknown as ProgressL5['flags'] };
}

/** §8.10: every marker the story reads (missing = error). `mk5_radio` is the story's own (the corpse point). */
export const STORY_MARKERS5 = [
  'mk5_start', 'mk5_gate_panel', 'mk5_c1_cam0', 'mk5_c1_cam1', 'mk5_c1_sol', 'mk5_c1_door', 'mk5_c1_out', 'mk5_c1_end',
  'mk5_duty_u1', 'mk5_duty_u2', 'mk5_s1', 'mk5_keypad', 'mk5_port', 'mk5_launch', 'mk5_wheel', 'mk5_tern_board', 'mk5_bunk_radio',
  'mk5_onpost', 'mk5_locker_slam', 'mk5_trays', 'mk5_oilskin', 'mk5_taps', 'mk5_body_a', 'mk5_body_b', 'mk5_boots_stop',
  'mk5_patrol_end', 'mk5_exit_spine', 'mk5_vent_spine', 'mk5_drain_a', 'mk5_drain_b', 'mk5_dive_door', 'mk5_lockside_door',
  'mk5_glass', 'tern',
] as const;
/** Every story group (debugState.groups). */
export const GROUPS5 = ['g5_duty', 'g5_s1', 'g5_spine', 'g5_patrol', 'g5_mag', 'g5_cmd', 'g5_bay_a', 'g5_bay_b'] as const;
/** What may open in front of a group at its spawn (spawn visibility, §10.1): doors | vignettes. */
const OPENING5: Record<string, { doors?: string[]; vig?: string[] }> = {
  g5_duty: { doors: ['d5_ready'] }, g5_spine: { doors: ['d5_dive'] }, g5_patrol: { doors: ['d5_bay'] },
  g5_cmd: { vig: ['vent5_spine'], doors: ['d5_lockside'] }, g5_bay_a: { doors: ['d5_lockside'] },
  g5_bay_b: { vig: ['drain5_a', 'drain5_b'], doors: ['d5_lockside'] },
};

interface TrigBox { id: string; x0: number; x1: number; z0: number; z1: number; y0?: number; y1?: number }
type LogEntry = LineLog & { dur?: number; end?: number; cue?: number };

export abstract class Base5 extends StageBase<Flags5, PhaseId5, CheckpointIdL5, Facts5, ProgressL5> {
  protected declare hooks: HooksL5;
  /** Set by index.ts (the page's camera rig). */
  cut: Cutscene | null = null;
  /** §6.4 CLOCK5: the test hour at arrival (carried, else 62:30). */
  readonly arrivalHour: number;
  readonly missingMarkers: string[] = [];
  /** H7 spawnLog / strays / scareLog. */
  readonly spawnLog: { group: string; id: number; t: number; pos: [number, number, number]; visible: boolean }[] = [];
  readonly strays: { id: number; t: number }[] = [];
  readonly scareLog: { id: string; t: number; room: string | null }[] = [];
  /** Groups the story created (or that exist from load) on this page. */
  protected spawnedGroups = new Set<string>(['g5_mag']);
  protected doorOpenedAt = new Map<string, number>();
  protected unseenFor = new Map<number, number>();
  /** Script time until which a radio line is on the channel (the HUD strip's live dot). */
  protected radioUntil = -1e9;
  /** Script time the last Kessler line ended / ends. */
  protected kesEndAt = -1e9;
  protected kesSpoke = false;
  protected lastEnemyShot = -1e9;
  protected acceptedAt = -1e9;
  protected doorShotAt = -1e9;
  protected launchSeen = 0;
  protected boardSeen = 0;
  protected shots: number[] = [];
  protected lastHitAny = -1e9;
  protected bark: Bark5 | null = null;
  /** The neck check (H7 door). */
  protected doorCheck = { started: false, check: 0, done: false };
  /** The pickup / door sequences hold the radio (other Kessler lines and barks wait). */
  protected seqBusy = false;
  /** A calm wait is running (the door, a due checkpoint, a scare): the stray rule may act. */
  protected calmWaiting = false;

  constructor(ctx: GameContext, seq: Sequencer, director: MusicDirector, w: World, logs: Set<string>, hooks: HooksL5) {
    super(ctx, seq, director, w, logs, hooks, L5_DIALOGUE);
    const th = ctx.facts.testHour;
    this.arrivalHour = typeof th === 'number' && Number.isFinite(th) && th > 0 ? th : ARRIVAL_DEFAULT5;
    for (const m of STORY_MARKERS5) if (!this.obj(m)) { this.missingMarkers.push(m); console.error(`[story] level 5: marker "${m}" missing`); }
    this.trackPlayer();
    const ev = ctx.events;
    ev.on('door:opening', (e) => this.doorOpenedAt.set(e.id, this.now));
    ev.on('enemy:fired', () => { this.lastEnemyShot = this.now; });
    ev.on('weapon:fired', () => { this.shots.push(this.now); if (this.shots.length > 60) this.shots.shift(); });
    ev.on('enemy:damaged', () => { this.lastHitAny = this.now; });
    ev.on('enemy:spawned', (e) => this.onSpawned(e.id));
  }

  protected emptyProgress(): ProgressL5 { return emptyProgress5(); }
  protected get t(): number { return this.prog.t; }
  protected get choice(): 'stop' | 'command' { return this.ctx.facts.choice === 'command' ? 'command' : 'stop'; }
  protected choiceId(base: string): string { return `${base}_${this.choice}`; }

  // ───────────────────────────────────────────────────────────── phase (the level's table is the door truth)

  protected get phase(): PhaseId5 {
    const f = this.f;
    if (f.tunnel) return 'X';
    if (f.released) return f.lockOpen ? 'W_lock' : 'W';
    if (f.verified) return f.lockOpen ? 'V_lock' : 'V';
    if (f.keypad) return f.diveOpen ? 'S_dive' : 'S';
    if (f.powered) return 'K';
    if (f.unitsIn) return 'D';
    if (f.scene) return 'D0';
    if (f.inScene) return 'C';
    if (f.gateLatched) return 'B2';
    if (f.gateOpen) return 'B';
    return 'A';
  }
  protected applyPhaseTo(id: PhaseId5, snap: boolean): void {
    this.stamp(`phase:${id}`);
    try { applyPhase5(this.ctx, id, { snap }); } catch (e) { console.warn(`[story] applyPhase ${id} failed`, e); }
    // §3: the keypad door's panel is dark until Kessler powers it (the table says `locked`; the story owns the panel)
    if (!this.f.powered) this.doorStatus('d5_key', 'dark');
  }
  protected atLeast(p: PhaseId5): boolean { return phaseRank5(this.phase) >= phaseRank5(p); }
  protected set<K extends keyof Flags5>(k: K, v: Flags5[K]): void {
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
  /** A door's panel point, pulled 0.4 m toward the player (unit lines at a door). */
  protected atDoor(id: string, up = 1.6): THREE.Vector3 {
    const d = this.door(id);
    if (!d) return this.pos.clone().setY(this.pos.y + 1.6);
    const p = d.position.clone();
    p.y = this.doorFloor(d) + up;
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z, l = Math.hypot(dx, dz) || 1;
    p.x += (dx / l) * 0.4; p.z += (dz / l) * 0.4;
    return p;
  }
  /** A level trigger's box (`ctx.__triggers`, level/triggers.ts). */
  protected trig(id: string): TrigBox | null {
    const t = (this.ctx as unknown as { __triggers?: readonly TrigBox[] }).__triggers;
    return t?.find((x) => x.id === id) ?? null;
  }
  /** Feet inside a trigger box grown by `pad` m in x / z (B3: the line's edge counts). */
  protected inTrig(id: string, pad = 0): boolean {
    if (pad <= 0 && this.insideTrig.has(id)) return true;
    const t = this.trig(id);
    if (!t) return this.insideTrig.has(id);
    const p = this.pos;
    return p.x >= t.x0 - pad && p.x <= t.x1 + pad && p.z >= t.z0 - pad && p.z <= t.z1 + pad && p.y > (t.y0 ?? -1) - 0.2 && p.y < (t.y1 ?? 4);
  }
  protected trigCentre(id: string, y = 0): THREE.Vector3 {
    const t = this.trig(id);
    return t ? V((t.x0 + t.x1) / 2, y, (t.z0 + t.z1) / 2) : this.pos.clone();
  }
  protected roomOf(p: THREE.Vector3): string | null {
    try { return this.ctx.level.roomAt(p)?.id ?? null; } catch { return null; }
  }
  /** Feet in the crawl or the magazine (the floors below the spine / armoury). */
  protected below(): boolean { return this.region3('crawl') || this.region3('magazine'); }
  /** Within 1.0 m of a door plane (scares never fire there, §5.5). */
  protected inDoorway(): boolean {
    try {
      for (const d of this.ctx.level.doors) {
        const p = d.position;
        if (Math.abs(this.pos.y - this.doorFloor(d)) > 1.5) continue;
        if (Math.hypot(this.pos.x - p.x, this.pos.z - p.z) <= 1.6) {
          // (the plane: within 1.0 m of the wall line, inside the opening's width + 0.6)
          const s = d as unknown as { wall?: string; spec?: { wall?: string } };
          const wall = s.wall ?? s.spec?.wall;
          const across = wall === 'x' ? Math.abs(this.pos.x - p.x) : wall === 'z' ? Math.abs(this.pos.z - p.z) : Math.hypot(this.pos.x - p.x, this.pos.z - p.z);
          if (across <= 1.0) return true;
        }
      }
    } catch { /* ignore */ }
    return false;
  }
  /** The player's view yaw in degrees, 0 = −z, +90 = −x (−180 … 180). */
  protected yawDeg(): number {
    const y = (this.ctx.player.yaw * 180) / Math.PI;
    return (((y % 360) + 540) % 360) - 180;
  }
  /** B3: 'away' = within ±50° of −x (back to the door at +x), 'door' = within ±90° of +x, else 'side'. */
  protected facing(): 'door' | 'away' | 'side' {
    const y = this.yawDeg();
    if (Math.abs(y - 90) <= 50) return 'away';
    if (Math.abs(y + 90) <= 90) return 'door';
    return 'side';
  }

  /**
   * Walking distance between two points through the doors (Dijkstra over door centres; straight inside a room) — the
   * door-calm rule's "nav path ≤ 30 m" (S2), without asking the enemies' nav for a route.
   */
  protected pathLen(a: THREE.Vector3, b: THREE.Vector3): number {
    const ra = this.roomOf(a), rb = this.roomOf(b);
    if (!ra || !rb) return a.distanceTo(b);
    if (ra === rb) return Math.hypot(a.x - b.x, a.z - b.z);
    let doors: { id: string; p: THREE.Vector3; rooms: string[] }[] = [];
    try {
      doors = this.ctx.level.doors.map((d) => {
        const r = (d as unknown as { rooms?: string[]; spec?: { rooms?: string[] } });
        return { id: d.id, p: d.position.clone(), rooms: r.rooms ?? r.spec?.rooms ?? [] };
      }).filter((d) => d.rooms.length === 2);
    } catch { return a.distanceTo(b); }
    const dist = new Map<string, number>();
    const open: string[] = [];
    for (const d of doors) if (d.rooms.includes(ra)) { dist.set(d.id, Math.hypot(a.x - d.p.x, a.z - d.p.z)); open.push(d.id); }
    let best = Infinity;
    const seen = new Set<string>();
    while (open.length) {
      open.sort((x, y) => (dist.get(x) ?? 1e9) - (dist.get(y) ?? 1e9));
      const id = open.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const d = doors.find((q) => q.id === id)!;
      const here = dist.get(id) ?? 1e9;
      if (d.rooms.includes(rb)) best = Math.min(best, here + Math.hypot(d.p.x - b.x, d.p.z - b.z));
      for (const n of doors) {
        if (seen.has(n.id) || !n.rooms.some((r) => d.rooms.includes(r))) continue;
        const nd = here + Math.hypot(d.p.x - n.p.x, d.p.z - n.p.z);
        if (nd < (dist.get(n.id) ?? Infinity)) { dist.set(n.id, nd); open.push(n.id); }
      }
    }
    return best;
  }

  // ───────────────────────────────────────────────────────────── enemies

  /** The soldier object behind an enemy (W3b extra `enemies.debug.soldier(id)`). */
  protected soldierObj(id: number): { holdingNow?: boolean; holdWalkTo?: (p: THREE.Vector3, speed?: number, light?: boolean) => Promise<void>; seesPlayer?: boolean } | null {
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
  /** Living, awake, hostile (not dormant, not a holding soldier). */
  protected awakeHostiles(): Enemy[] {
    try { return this.ctx.enemies.all.filter((e) => e.alive && e.state !== 'dormant' && !this.isHolding(e)); } catch { return []; }
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
  protected spawn(group: string, triggered = true): void {
    this.spawnedGroups.add(group);
    if (triggered) this.engage(group, 'spawn');
    else this.w.spawnGroup(group);
  }
  private onSpawned(id: number): void {
    // spawn visibility (§10.1, R4 evidence): on the next frame, was the member in view (frustum + a clear ray to its
    // chest), unless the door / vent / drain in front of it opened within the last 3 s
    this.S('spawnlog', async () => {
      await this.hold(0.02);
      let e: Enemy | undefined;
      try { e = this.ctx.enemies.all.find((x) => x.id === id); } catch { /* ignore */ }
      if (!e || !e.group) return;
      const cam = this.ctx.camera;
      cam.updateMatrixWorld();
      const chest = e.position.clone().setY(e.position.y + (e.type === 'skitter' ? 0.3 : 1.3));
      const v = chest.clone().project(cam);
      const seen = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && this.los(chest);
      const op = OPENING5[e.group] ?? {};
      const opened = (op.doors ?? []).some((d) => this.now - (this.doorOpenedAt.get(d) ?? -1e9) <= 3)
        || (op.vig ?? []).some((g) => this.now - (this.marks[`vignette:${g}`] ?? -1e9) <= 3);
      this.spawnLog.push({ group: e.group, id: e.id, t: +this.now.toFixed(2), pos: [+e.position.x.toFixed(2), +e.position.y.toFixed(2), +e.position.z.toFixed(2)], visible: seen && !opened });
      if (this.spawnLog.length > 120) this.spawnLog.shift();
    });
  }

  /**
   * The stray rule (§4.7, S2; level-wide during any calm wait — the door, a due checkpoint, a scare): an awake hostile
   * unseen ≥ 30 s and ≥ 25 m away is removed silently. Groups go whole (the enemy contract has no per-unit removal): a
   * group is removed when every living awake member of it is a stray and none of it is holding.
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
      if (!g || g.startsWith('test')) continue;
      // (the first soldier carries the radio — the only way on: he is fought, never removed)
      if (g === 'g5_s1' && !this.f.radio) continue;
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

  /** §4.7 door-calm: no hostile awake or holding that is in `spine5` or has a path ≤ 30 m to the line (S2). */
  protected doorCalm(): boolean {
    const line = this.trigCentre('t5_cmd_line', 0);
    let all: Enemy[] = [];
    try { all = this.ctx.enemies.all.filter((e) => e.alive && e.state !== 'dormant'); } catch { /* ignore */ }
    for (const e of all) {
      if (e.position.y < -0.5) continue;           // (nothing hostile lives below the grating)
      if (this.roomOf(e.position) === 'spine5') return false;
      if (this.pathLen(e.position, line) <= 30) return false;
    }
    return true;
  }

  // ───────────────────────────────────────────────────────────── checkpoints: the level-5 calm rule

  /**
   * B1: a group still in `hold` is not a fight — it is not in `triggered` until released, and a holding soldier is not
   * in `activeCount`. Otherwise the stage rule: playing, in control, standing, nothing hunting, the fights over 1.5 s.
   */
  protected override calm(): boolean {
    const ctx = this.ctx, p = ctx.player;
    if (ctx.state !== 'playing' || !this.live || this.ended || this.noteOpen) return false;
    if (this.checkpointBlocked()) return false;
    if (!p.alive || p.health <= 0 || !p.controlsEnabled) return false;
    if (Math.abs(p.velocity.y) > 0.4) return false;
    if (this.w.active() > 0 || this.now - this.lastCombat < 1.5) return false;
    if (this.awakeHostiles().length > 0) return false;
    for (const g of this.prog.triggered) if (!this.fought(g, 1.5)) return false;
    return true;
  }

  // ───────────────────────────────────────────────────────────── speech (subtitles, the timed-line log)

  /** The channel could start a line on this frame (nothing playing or queued, its gap over). */
  protected channelFree(): boolean {
    const next = (this.talk as unknown as { nextAt?: number }).nextAt ?? 0;
    return !this.talk.busy && this.now >= next;
  }
  /** The subtitle of a level-5 line (the shared DB has no level-5 text: written here, never twice). */
  protected subtitle(id: string, d: number, name?: string, show: boolean | (() => boolean) = true): void {
    let on = true;
    try { on = typeof show === 'function' ? show() !== false : show !== false; } catch { on = true; }
    const l = line5(id);
    if (!on || !l?.text) return;
    this.ctx.events.emit('story:subtitle', { speaker: name ?? speaker5(l), text: l.text, duration: d + 0.25 });
  }
  private noteStart(id: string, d: number): void {
    const l = line5(id);
    if (isRadio5(l)) this.radioUntil = Math.max(this.radioUntil, this.now + d);
    if (l?.speaker === 'kessler') { this.kesEndAt = this.now + d; this.kesSpoke = true; }
  }

  /**
   * Every level-5 line goes through here: the subtitle (with the line's label), and the H5 log fields — `dur` and
   * `end` for every line, `cue` for every TIMED line (asked on its beat — `cue` given, or `now` — with the channel
   * free: a line that must wait its turn by design is logged without a cue).
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
   * A voice that does not wait its turn (the overlap channel): a panel answering a press, CHOIR cutting in over
   * Kessler. Starts THIS frame; resolves at its end (true) or false when its rule said no.
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
   * starts on the cue's frame, with its gesture (level 3's rule).
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
  /** A set piece's userData API (W7 `cmdDoor`, `tern`, the hatch lids) — null when absent (greybox placeholder). */
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
  /** The head / chest / nape of an actor (bones by name; fallbacks by height). */
  protected bonePoint(o: THREE.Object3D | null | undefined, names: string[], dy: number, out: THREE.Vector3): THREE.Vector3 {
    if (o) {
      for (const n of names) {
        const b = o.getObjectByName(n);
        if (b) { b.getWorldPosition(out); return out; }
      }
      out.copy(o.position); out.y += dy;
    }
    return out;
  }

  // ───────────────────────────────────────────────────────────── facts

  protected readonly facts: Facts5 = ((self: Base5): Facts5 => {
    const common = self.commonFacts();
    const extra = {
      get phase() { return self.phase; },
      atLeast: (p: PhaseId5) => self.atLeast(p),
      get choice() { return self.choice; },
      get radioOwned() { return self.f.radio; },
      get accepted() { return self.f.keypad; },
      acceptedWithin: (s: number) => self.now - self.acceptedAt <= s,
      get nearRadioCam() { return self.radioNearCam(); },
      get doorStarted() { return self.doorCheck.started; },
      get checkPending() { return self.doorCheck.started && !self.doorCheck.done; },
      get onLine() { return self.inTrig('t5_cmd_line', 0.3); },
      get inCmd() { return self.inTrig('t5_cmd'); },
      get facing() { return self.facing(); },
      get doorCalm() { return self.doorCalm(); },
      get spineSpawned() { return self.spawnedGroups.has('g5_spine') || self.f.spineWave; },
      get waveInSight() { return self.memberInView('g5_spine'); },
      get launchSeenFor() { return self.launchSeen; },
      doorShotWithin: (s: number) => self.now - self.doorShotAt <= s,
      get bayASpawned() { return self.f.bayA; },
      get darkBeat() { return self.f.dark; },
      get tunnelClear() { return self.hostilesWhere('tunnel5').length === 0; },
      get kesQuietFor() { return self.kesSpoke ? self.now - self.kesEndAt : 1e9; },
      get subCheckDone() { return self.prog.scares.includes('v5_sub_check'); },
      get boardSeenFor() { return self.boardSeen; },
      hostileWithin: (m: number) => self.hostileWithin(m),
      get wastingRounds() { const n = self.shots.filter((t) => self.now - t <= 8).length; return n >= 15 && self.now - self.lastHitAny > 8; },
      get darkWithLight() { return self.region3('dark') && self.ctx.player.flashlightOn; },
      get bark() { return self.bark; },
    };
    const out = Object.create(null) as Facts5;
    Object.defineProperties(out, Object.getOwnPropertyDescriptors(common));
    Object.defineProperties(out, Object.getOwnPropertyDescriptors(extra));
    return out;
  })(this);

  /** Overridden by the script: within 12 m of the radio on the body, in duty5 / ready5. */
  protected radioNearCam(): boolean { return false; }
}
