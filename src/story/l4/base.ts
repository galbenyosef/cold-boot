/**
 * Level 4 script — shared state: flags, the level's markers (places), the arm adapter, phase derivation, the FACTS the
 * lines may ask, the speech wrapper (subtitles, timed-line log) and small world helpers (stage 3b §3, §6, §8.10).
 * Layers (as level 3):
 *   ../stage/base.ts   the scaffolding (record, beats, waits, latches, fights, checkpoints, fast-forward, dialogue)
 *   base.ts (this)     level 4's flags, markers, arm, phase, facts, speech wrapper, world helpers
 *   script.ts          the flow: decon, shower, the clean loop, the hold, lights-out, the theatre, the navy level, the
 *                      plant room, the tube, the end; checkpoints; reactions; the video log; debug hooks
 *
 * Places come from the level's markers only (D23): `mk4_*` objects and the `theatre_arm` object, doors and interactables
 * by id, light groups by the §2.7 names. A missing marker is an error (`debugState.missingMarkers`); the story then
 * falls back to the nearest door / room centre so nothing throws, but the playthrough fails on it.
 */
import * as THREE from 'three';
import type { GameContext, LoopHandle } from '../../core/types';
import type { Sequencer } from '../sequencer';
import type { MusicDirector } from '../director';
import type { World } from '../world';
import type { CheckpointIdL4, ProgressL4 } from '../save';
import { emptyProgressL4 } from '../save';
import { StageBase, V, DEG, type StageHooks } from '../stage/base';
import type { LineLog, SayOpts } from '../stage/dialogue';
import { applyPhase4, type PhaseId4 } from '../../level/l4/phases';
import { L4_DIALOGUE, line4, phaseRank4, speaker4, type Facts4 } from './dialogue';
import { ARRIVAL_DEFAULT } from './text';

export { V, DEG };

export interface HooksL4 extends StageHooks<CheckpointIdL4> {
  /** §7: the stage end (carry, end card, menu). */
  end(): Promise<void>;
}

export interface Flags4 {
  deconDone: boolean;
  /** The shower latch held (S). */
  showered: boolean;
  /** The shower cycle ended: d4_shower_out open (C). */
  clean: boolean;
  /** First t4_clean in C (cp4_clean due). */
  cleanSeen: boolean;
  /** cold_ack pressed (l4_override). */
  override: boolean;
  /** The hold cleared: d4_surg auto (D). */
  suite: boolean;
  lightsOut: boolean;
  /** Transient: d4_bay held open for g4_bay (D_bay). */
  bayOpen: boolean;
  bayDone: boolean;
  /** The vent g4_vent came out of: 'a' | 'b' | ''. */
  vent: string;
  /** The vivarium vent dropped (g4_viv spawned). */
  viv: boolean;
  theatre: boolean;
  /** The stair foot reached (cp4_lower due). */
  lower: boolean;
  /** g4_lower woken (t4_lcorr + 1 s). */
  lcorr: boolean;
  /** First t4_chk (cp4_navy due). */
  navy: boolean;
  refused: boolean;
  /** F5 (l4_armed). */
  armed: boolean;
  storeOpen: boolean;
  storeDone: boolean;
  equalising: boolean;
  equalised: boolean;
  released: boolean;
  tubeFight: boolean;
  /** Transient: d4_tube_s held open while g4_tube walks out (F_open). */
  tubeOpen: boolean;
  /** F: the gate lock door auto. */
  gateOpen: boolean;
  /** G: latched in the gate lock. */
  gateLock: boolean;
  /** First-view facts (D24). */
  video: boolean;
  roster: boolean;
  /** The hold's reason seen (objective → cold store). */
  holdSeen: boolean;
}
export const FLAGS4: Flags4 = {
  deconDone: false, showered: false, clean: false, cleanSeen: false, override: false, suite: false, lightsOut: false,
  bayOpen: false, bayDone: false, vent: '', viv: false, theatre: false, lower: false, lcorr: false, navy: false, refused: false,
  armed: false, storeOpen: false, storeDone: false, equalising: false, equalised: false, released: false, tubeFight: false,
  tubeOpen: false, gateOpen: false, gateLock: false, video: false, roster: false, holdSeen: false,
};
export function emptyProgress4(): ProgressL4 {
  return { ...emptyProgressL4(), flags: { ...FLAGS4 } as unknown as ProgressL4['flags'] };
}

/** §8.10: every marker the story reads (missing = error). */
export const STORY_MARKERS4 = [
  'mk4_start', 'mk4_decon_panel', 'mk4_gate_panel', 'mk4_booth', 'mk4_gauge', 'mk4_bodies', 'mk4_wet_win', 'mk4_node2_win',
  'mk4_roster', 'mk4_video', 'mk4_cold_panel', 'mk4_gallery_spk', 'mk4_glass', 'mk4_vent_viv', 'mk4_vent_s_a', 'mk4_vent_s_b',
  'mk4_sump', 'mk4_bay_door', 'mk4_store_door', 'theatre_arm',
] as const;

export interface Body4 { name: string; p: THREE.Vector3 }
export interface Pane4 { id: string; box: THREE.Box3 }

/** What the story needs of the arm: W9a's `theatreArm` userData, or W4's greybox placeholder (fewer members). */
export interface ArmView {
  readonly ok: boolean;
  readonly placeholder: boolean;
  cue(): string;
  n(): number;
  t(): number;
  period(): number;
  cueStart(cue: string): number;
  timeTo(cue: string): number;
  led(): string;
}

export abstract class Base4 extends StageBase<Flags4, PhaseId4, CheckpointIdL4, Facts4, ProgressL4> {
  protected declare hooks: HooksL4;
  /** D20: the test hour at arrival (carried from 3a or 62:10). */
  readonly arrivalHour: number;
  /** Record time when this page started (0, or the saved `t` on a load): the attempt count's base. */
  protected t0 = 0;
  readonly missingMarkers: string[] = [];
  protected bodies: Body4[] = [];
  protected panes: Pane4[] = [];
  protected arm: ArmView;
  protected loopsNamed = new Map<string, LoopHandle>();
  /** Script time until which a machine line (overlap channel) is speaking. */
  protected machineUntil = -1e9;

  // ── session facts ──
  protected cleanAt = -1e9;
  protected eqAt = -1e9;
  protected carbineAt = -1e9;
  protected glassHitAt = -1e9;
  protected bodySeen = 0;
  protected node2Seen = 0;
  protected rosterSeen = 0;
  /** Timed lines (§8.12): intended cue and actual start (script time), per line start. */
  readonly cueLog: { id: string; said: string; cue: number; start: number; d: number }[] = [];
  /** Per spawn / wake: was a member in view (R4 evidence; `door` = it came through a door / grille that just opened). */
  readonly spawnLog: { group: string; t: number; seen: boolean; through: string }[] = [];

  constructor(ctx: GameContext, seq: Sequencer, director: MusicDirector, w: World, logs: Set<string>, hooks: HooksL4) {
    super(ctx, seq, director, w, logs, hooks, L4_DIALOGUE);
    const th = ctx.facts.testHour;
    this.arrivalHour = typeof th === 'number' && Number.isFinite(th) && th > 0 ? th : ARRIVAL_DEFAULT;
    for (const m of STORY_MARKERS4) if (!this.obj(m)) { this.missingMarkers.push(m); console.error(`[story] level 4: marker "${m}" missing`); }
    this.bindLists();
    this.arm = this.makeArmView();
    this.trackPlayer();
    ctx.events.on('bullet:impact', (e) => this.onImpact(e.point, e.surface));
  }

  protected emptyProgress(): ProgressL4 { return emptyProgress4(); }
  protected get t(): number { return this.prog.t; }
  protected get choice(): 'stop' | 'command' { return this.ctx.facts.choice === 'command' ? 'command' : 'stop'; }

  // ───────────────────────────────────────────────────────────── phase (the level's table is the door truth)

  protected get phase(): PhaseId4 {
    const f = this.f;
    if (f.gateLock) return 'G';
    if (f.gateOpen) return 'F';
    if (f.tubeOpen) return 'F_open';
    if (f.released) return 'E';
    if (f.storeOpen) return 'D_store';
    if (f.bayOpen) return 'D_bay';
    if (f.equalised) return 'D2';
    if (f.suite) return 'D';
    if (f.clean) return 'C';
    if (f.showered) return 'S';
    if (f.deconDone) return 'B';
    return 'A';
  }
  protected applyPhaseTo(id: PhaseId4, snap: boolean): void {
    this.stamp(`phase:${id}`);
    try { applyPhase4(this.ctx, id, { snap }); } catch (e) { console.warn(`[story] applyPhase ${id} failed`, e); }
  }
  protected atLeast(p: PhaseId4): boolean { return phaseRank4(this.phase) >= phaseRank4(p); }

  // ───────────────────────────────────────────────────────────── markers

  protected obj(name: string): THREE.Object3D | null {
    try { return this.ctx.level.object(name) ?? null; } catch { return null; }
  }
  /** World position of a marker (fallback: `fb`, or the origin — the marker's absence is already an error). */
  protected mk(name: string, fb?: THREE.Vector3): THREE.Vector3 {
    const o = this.obj(name);
    if (o) { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); }
    return fb ? fb.clone() : new THREE.Vector3();
  }
  /** A door's panel point, pulled 0.4 m toward the player (unit lines at a door). */
  protected atDoor(id: string): THREE.Vector3 {
    const d = this.door(id);
    if (!d) return this.pos.clone().setY(this.pos.y + 1.6);
    const p = d.position.clone();
    p.y = this.doorFloor(d) + 1.6;
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z, l = Math.hypot(dx, dz) || 1;
    p.x += (dx / l) * 0.4; p.z += (dz / l) * 0.4;
    return p;
  }
  private toVec(v: unknown): THREE.Vector3 | null {
    if (Array.isArray(v) && v.length >= 3) return V(Number(v[0]), Number(v[1]), Number(v[2]));
    if (v && typeof v === 'object' && 'x' in (v as object)) { const o = v as { x: number; y: number; z: number }; return V(o.x, o.y, o.z); }
    return null;
  }
  /** `mk4_bodies.userData.list` (W4 `{ name, p }` or W9a `{ name, position }`; last entry per name wins) and `mk4_glass.userData.panes`. */
  protected bindLists(): void {
    const byName = new Map<string, Body4>();
    const list = (this.obj('mk4_bodies')?.userData.list ?? []) as { name?: string; p?: unknown; position?: unknown }[];
    for (const b of list) {
      const p = this.toVec(b.position) ?? this.toVec(b.p);
      if (b?.name && p) byName.set(String(b.name), { name: String(b.name), p });
    }
    this.bodies = [...byName.values()];
    const panes = (this.obj('mk4_glass')?.userData.panes ?? []) as { id?: string; box?: number[] }[];
    this.panes = panes.filter((p) => Array.isArray(p.box) && p.box.length >= 6).map((p) => ({
      id: String(p.id), box: new THREE.Box3(V(p.box![0], p.box![1], p.box![2]), V(p.box![3], p.box![4], p.box![5])).expandByScalar(0.06),
    }));
  }

  // ───────────────────────────────────────────────────────────── the arm (§4.4)

  private makeArmView(): ArmView {
    const o = this.obj('theatre_arm');
    const ud = (o?.userData ?? {}) as Record<string, unknown>;
    const cyc = () => (ud.cycle ?? { t: 0, n: 0, cue: '' }) as { t: number; n: number; cue: string; period?: number; led?: string; failHold?: number };
    const placeholder = !!ud.placeholder || typeof ud.cueTimes !== 'function';
    const fh = () => Math.max(2.5, cyc().failHold ?? 2.5);
    const marks = (): Record<string, number> => {
      if (typeof ud.cueTimes === 'function') return (ud.cueTimes as () => Record<string, number>)();
      const F = fh();
      return { approach: 0, fit: 6, handshake: 12, fail: 14.5, remove: 14.5 + F, regel: 19.5 + F, return: 25.5 + F, idle: 30.5 + F, period: 37.5 + F };
    };
    const period = () => cyc().period ?? marks().period ?? 40;
    return {
      ok: !!o && !!ud.cycle,
      placeholder,
      cue: () => String(cyc().cue ?? ''),
      n: () => Number(cyc().n ?? 0),
      t: () => Number(cyc().t ?? 0),
      period,
      cueStart: (c) => marks()[c] ?? 0,
      timeTo: (c) => {
        if (typeof ud.timeTo === 'function') return (ud.timeTo as (c: string) => number)(c);
        const P = period();
        return (((marks()[c] ?? 0) - cyc().t) % P + P) % P;
      },
      led: () => {
        if (typeof cyc().led === 'string') return cyc().led!;
        const t = cyc().t;
        if (t >= 9.45 && t < 12) return 'amber';
        if (t >= 12 && t < 13) return 'red';
        if (t >= 13 && t < 14.5) return Math.floor((t - 13) / 0.25) % 2 === 0 ? 'red' : 'off';
        return 'off';
      },
    };
  }
  /** Register a cue callback on the arm (either API). */
  protected onArmCue(cb: (cue: string) => void): void {
    const o = this.obj('theatre_arm');
    const f = o?.userData.onCue as ((cb: (cue: string) => void) => void) | undefined;
    if (typeof f === 'function') { try { f((cue: string) => cb(String(cue))); } catch (e) { console.warn('[story] theatre_arm onCue failed', e); } }
  }
  /** The fitting attempt shown now (D20): attempts by this page's start + the arm's cycles since load. */
  protected attempt(): number {
    return Math.floor((this.arrivalHour * 3600 - 60 + this.t0) / 40) + this.arm.n();
  }

  // ───────────────────────────────────────────────────────────── speech (subtitles, timed-line log)

  /**
   * Every level-4 line goes through here. Adds the subtitle name and the subtitle rule (`subtitleIf`: Sunde's log shows
   * text only within 14 m or with sight of the screen); records each start against its cue in `cueLog` (§8.12: `cue` =
   * when the line was asked for, unless the caller names its beat's instant).
   */
  protected override say(id: string, opts: SayOpts & { cue?: number; subtitleIf?: () => boolean } = {}): Promise<boolean> {
    // timed (§8.12) = asked on its beat with the channel free; a line that must wait its turn by design (CHOIR after the
    // video log's current line, case #7) is logged without a cue
    const timed = (opts.cue !== undefined || (!!opts.now && opts.pri !== 'talk')) && this.channelFree();
    const cue = opts.cue ?? this.now;
    const user = opts.onStart;
    const l = line4(id);
    let entry: (LineLog & { dur?: number; end?: number; cue?: number }) | null = null;
    const p = super.say(id, {
      name: opts.name ?? speaker4(l),
      ...opts,
      subtitle: opts.subtitleIf ?? opts.subtitle,
      onStart: (d) => {
        entry = this.talk.log[this.talk.log.length - 1] ?? null;
        const said = entry?.said ?? id;
        if (entry) { entry.dur = +d.toFixed(3); if (timed) entry.cue = +cue.toFixed(3); }
        this.cueLog.push({ id, said, cue: +cue.toFixed(3), start: +this.now.toFixed(3), d: +d.toFixed(3) });
        if (this.cueLog.length > 400) this.cueLog.splice(0, this.cueLog.length - 400);
        user?.(d);
      },
    });
    void p.then(() => { if (entry) entry.end = +this.now.toFixed(3); });
    return p;
  }

  /** The channel could start a line on this frame (nothing playing or queued, its gap over). */
  protected channelFree(): boolean {
    const next = (this.talk as unknown as { nextAt?: number }).nextAt ?? 0;
    return !this.talk.busy && this.now >= next;
  }
  /** Nothing speaking at all (the channel and the machines): CHOIR's sight lines wait for this. */
  protected quietNow(): boolean { return this.channelFree() && this.now >= this.machineUntil; }
  /**
   * A machine's voice on its beat (a panel, a speaker): starts THIS frame, always, on the dialogue's overlap channel
   * (stacked subtitles) — a panel does not wait its turn, never holds the channel CHOIR and the log speak on, and a
   * timed line is never late (§8.12). Its sequel lines are cued from its duration by the caller.
   * Resolves at its end (true) or false when its rule said no.
   */
  protected unit(id: string, opts: { at?: THREE.Vector3; cue?: number; onStart?: (d: number) => void } = {}): Promise<boolean> {
    const cue = opts.cue ?? this.now;
    const l = line4(id);
    const qp = performance.now();
    const d = this.talk.overlap(id, { at: opts.at, name: speaker4(l) });
    const entry = this.talk.log[this.talk.log.length - 1] as (LineLog & { dur?: number; end?: number; cue?: number }) | undefined;
    if (d <= 0) return Promise.resolve(false);
    this.machineUntil = Math.max(this.machineUntil, this.now + d + 0.2);
    const said = entry?.said ?? id;
    if (entry) { entry.dur = +d.toFixed(3); entry.cue = +cue.toFixed(3); entry.q = +this.now.toFixed(3); entry.qp = qp; entry.sp = performance.now(); }
    this.cueLog.push({ id, said, cue: +cue.toFixed(3), start: +this.now.toFixed(3), d: +d.toFixed(3) });
    try { opts.onStart?.(d); } catch (e) { console.warn('[story] unit onStart failed', e); }
    return new Promise((resolve) => {
      this.S('unit_' + id, async () => { await this.hold(d); if (entry) entry.end = +this.now.toFixed(3); resolve(true); });
    });
  }

  // ───────────────────────────────────────────────────────────── world helpers

  /** Fire a level vignette (stamped `vignette:<id>` in debugState.t, first time only). */
  protected vig(id: string): void { this.stamp(`vignette:${id}`); this.w.vignette(id); }
  /** D24: a first-view fact, on `ctx.facts` as soon as it is earned. */
  protected earn(key: string): void {
    const F = this.ctx.facts as Record<string, unknown>;
    if (F[key] === true) return;
    F[key] = true;
    // (one key order whatever the order they were earned in: a load rebuilds the same object)
    for (const k of ['l4_theatre', 'l4_video', 'l4_roster', 'l4_equalised']) if (k in F) { const v = F[k]; delete F[k]; F[k] = v; }
  }
  protected screen(name: string, kind: Parameters<World['screen']>[1], text?: string): void { this.w.screen(name, kind, text); }
  protected sfx(id: string, at?: THREE.Vector3, volume?: number): void { if (!this.ff) this.w.play(id, at, volume); }
  protected startLoop(name: string, id: string, at?: THREE.Vector3, volume = 0.8): void {
    if (this.loopsNamed.has(name)) return;
    try {
      const l = this.ctx.audio.loop(id, { position: at, volume });
      this.loopsNamed.set(name, l);
      this.loops.push(l);
    } catch { /* audio optional */ }
  }
  protected stopLoop(name: string, fade = 0.4): void {
    const l = this.loopsNamed.get(name);
    if (!l) return;
    this.loopsNamed.delete(name);
    try { l.stop(fade); } catch { /* ignore */ }
  }
  protected grade(warmth: number, seconds: number): void {
    try { this.ctx.render.post.grade?.(warmth, seconds); } catch { /* ignore */ }
  }
  /** Room centre at a height above its floor (positions for loops that have no marker). */
  protected roomPoint(id: string, dy = 1.0): THREE.Vector3 {
    try {
      const r = this.ctx.level.rooms.find((q) => q.id === id);
      if (r) { const c = r.bounds.getCenter(new THREE.Vector3()); c.y = r.bounds.min.y + 0.5 + dy; return c; }
    } catch { /* ignore */ }
    return this.pos.clone();
  }
  /** A clear ray from the eye to `p`, within `cone`° of the view and `range` m. */
  protected sees(p: THREE.Vector3, range: number, cone = 50): boolean {
    if (this.ctx.player.eye.distanceTo(p) > range) return false;
    return this.isLookingAt(p, cone, true);
  }

  private onImpact(p: THREE.Vector3, surface: string): void {
    if (surface !== 'glass') return;
    if (this.panes.some((q) => q.box.containsPoint(p))) this.glassHitAt = this.now;
  }

  /** R4 evidence: was a member of `group` in view at its spawn / wake (`through` = the opening it came out of). */
  protected logSpawn(group: string, through: string): void {
    this.S('spawnlog', async () => {
      await this.hold(0.05);
      const seen = this.members(group).some((e) => this.inView(e, 60));
      this.spawnLog.push({ group, t: +this.now.toFixed(2), seen, through });
    });
  }

  // ───────────────────────────────────────────────────────────── facts

  protected readonly facts: Facts4 = ((self: Base4): Facts4 => {
    const common = self.commonFacts();
    const extra = {
      get phase() { return self.phase; },
      atLeast: (p: PhaseId4) => self.atLeast(p),
      get choice() { return self.choice; },
      get inGallery() { return self.at('t4_gallery', () => self.inRoom('gallery')); },
      get armCue() { return self.arm.cue(); },
      get toApproach() { return self.arm.ok ? self.arm.timeTo('approach') : 1e9; },
      get cleanFor() { return self.f.clean ? self.now - self.cleanAt : -1; },
      get bodySeenFor() { return self.bodySeen; },
      get node2SeenFor() { return self.node2Seen; },
      get rosterSeenFor() { return self.rosterSeen; },
      glassHitWithin: (s: number) => self.now - self.glassHitAt <= s,
      carbineWithin: (s: number) => self.now - self.carbineAt <= s && !!self.ctx.player.weapons.carbine?.owned,
      get equalisingFor() { return self.f.equalising && !self.f.equalised ? self.now - self.eqAt : -1; },
      get tubeFight() { return self.f.tubeFight; },
    };
    const out = Object.create(null) as Facts4;
    Object.defineProperties(out, Object.getOwnPropertyDescriptors(common));
    Object.defineProperties(out, Object.getOwnPropertyDescriptors(extra));
    return out;
  })(this);
}
