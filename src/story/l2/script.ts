/**
 * Level 2 — "LINE TWO" (docs/DESIGN.md → REVISION 4, reworked to REVISION 5 / 5.1).
 *
 * This file is the top layer of the script (see base.ts for the layering): acts 1–2 (the tidy place, someone
 * is alive), acts 4–5 (Unit 32, the supervisor, the core), checkpoints, Tomas's barks and every reaction to
 * what the player does. Act 3 — the taking — is taking.ts; the holograms are ghost.ts.
 *
 * REVISION 5 rules this file is built on:
 *   R1  no gate is a spoken instruction — every gate is a door state of a phase (level `applyPhase`);
 *   R3  no line assumes an order — every line has a rule in dialogue.ts, checked when it starts playing;
 *   R4  nothing of a later beat exists early (spawn-mode groups; puppets only behind sealed glass);
 *   R5  the taking runs on its own clock behind a latched door (taking.ts).
 * The story never waits for the player to behave: each thread waits for a state of the world, and each
 * line it queues is dropped by its own rule if the world has moved on.
 */
import * as THREE from 'three';
import type { Enemy, EnemyType, GameContext } from '../../core/types';
import type { Sequencer } from '../sequencer';
import type { MusicDirector } from '../director';
import type { World } from '../world';
import type { Fragment } from '../text';
import { CHECKPOINT_IDS_L2, type CheckpointIdL2, type ProgressL2 } from '../save';
import { hasSay, speak } from '../voice';
import { DEAD_DOORS, GLASS, TOMAS_AT_GLASS, TOMAS_DESK, V, WORKER_GROUPS, emptyProgressL2, face, type HooksL2 } from './base';
import { Taking } from './taking';
import { applyPhase } from './phases';
import { FRAGMENTS_L2, OBJ2, SCREEN2, TOAST2 } from './text';

export { emptyProgressL2 };
export type { HooksL2 };

/** One-shot level vignettes that leave the place visibly changed (re-applied silently on load). */
const LASTING = ['intake_gauge', 'intake_shoe', 'booth_write_1', 'booth_write_2'];
export const VIGNETTES_L2 = ['dock_polisher', 'intake_shoe', 'intake_gauge', 'hall_hooks_sway', 'hall_screen_count', 'booth_write_1', 'booth_write_2', 'booth_wipe', 'booth_light_fail', 'fitting_sync', 'fitting_rig_wake', 'relay_arc', 'line_start', 'load_scan', 'tunnel_press', 'foreman_arrive', 'core_bow', 'core_cells_out'] as const;

/**
 * What Tomas still has to tell, delivered over the handset whenever the channel is free and nothing is
 * hunting the player — in this order, each line by its own rule, wherever the player has gone meanwhile.
 * `B`: from the fitting unlock on (the rest of the first talk, then the order on his screen).
 * `C`: once the pass is taken and the alcove fight is over (the coffee, his mother — set-ups for later).
 */
const BACKLOG: { id: string; stage: 'B' | 'C'; pause?: number }[] = [
  { id: 'l2_tomas_hello_4', stage: 'B' }, { id: 'l2_tomas_reyes', stage: 'B', pause: 0.6 }, { id: 'l2_tomas_oneway', stage: 'B' },
  { id: 'l2_tomas_estop_1', stage: 'B', pause: 0.5 }, { id: 'l2_tomas_estop_2', stage: 'B' }, { id: 'l2_tomas_sulking', stage: 'B' },
  { id: 'l2_tomas_ask', stage: 'B', pause: 0.5 }, { id: 'l2_tomas_pass', stage: 'B' }, { id: 'l2_tomas_handset', stage: 'B' },
  { id: 'l2_tomas_go', stage: 'B' },
  { id: 'l2_tomas_order_1', stage: 'B', pause: 7 }, { id: 'l2_tomas_order_2', stage: 'B', pause: 0.6 }, { id: 'l2_tomas_order_3', stage: 'B', pause: 0.6 },
  { id: 'l2_tomas_order_4', stage: 'B', pause: 0.6 }, { id: 'l2_tomas_order_5', stage: 'B', pause: 0.6 },
  { id: 'l2_tomas_coffee_1', stage: 'C', pause: 6 }, { id: 'l2_tomas_mum', stage: 'C', pause: 5 },
];

export class ScriptL2 extends Taking {
  private tickTimer = 0;
  private noteClosedReal = -1e9;
  private lastNoteId: string | null = null;
  private recorder: ReturnType<typeof speak>['handle'] = null;

  // ── checkpoints ──
  private calmFor = 0;
  private lastCheckpoint: CheckpointIdL2 | null = null;
  private pendingCheckpoint: CheckpointIdL2 | null = null;

  // ── bark state ──
  private lightOnWorker = 0;
  private quietBarks = 0;
  private relayEnteredAt = -1e9;
  private knock = false;
  private writing = false;
  private backlogTries = new Map<string, number>();
  private backlogHoldUntil = 0;
  private fittingDeniedAt = -1e9;
  private barkHoldUntil = 0;

  constructor(ctx: GameContext, seq: Sequencer, director: MusicDirector, w: World, logs: Set<string>, hooks: HooksL2) {
    super(ctx, seq, director, w, logs, hooks);
    const ev = ctx.events;
    ev.on('trigger:enter', (e) => { this.triggerAt.set(e.id, this.seq.time); this.insideTrig.add(e.id); });
    ev.on('trigger:exit', (e) => { this.insideTrig.delete(e.id); });
    ev.on('enemy:group-cleared', (e) => { if (!this.prog.cleared.includes(e.group)) this.prog.cleared.push(e.group); });
    ev.on('interact', (e) => this.onInteract(e.id));
    ev.on('door:denied', (e) => this.onDenied(e.id));
    ev.on('player:died', () => this.onDied());
    ev.on('weapon:fired', () => { this.lastShotAt = this.seq.time; this.onShot(); });
    ev.on('bullet:impact', (e) => this.onImpact(e.point, e.surface));
    ev.on('player:damaged', (e) => this.onHurt(e.health));
    ev.on('enemy:alerted', (e) => this.onEnemyStir(e.id));
    ev.on('enemy:woke', (e) => this.onEnemyStir(e.id));
    ev.on('enemy:damaged', (e) => this.onEnemyDamaged(e.id));
    ev.on('enemy:died', (e) => this.onEnemyDied(e.group, e.type));
  }

  // ───────────────────────────────────────────────────────────── lasting consequences

  private readonly CONSEQUENCES: Record<string, () => void> = {
    l2_arrive: () => { this.f.arrived = true; }, // phase A: the cab gate answers
    l2_hall_reveal: () => {
      this.f.hall = true;
      this.w.screen('line_bigscreen', 'terminal_alert', SCREEN2.held);
      if (this.ff) this.w.vignette('hall_screen_count');
    },
    l2_tomas_seen: () => { this.f.seen = true; },
    // The intercom press takes the handset: he is in the player's ear from here on.
    l2_intercom: () => {
      this.f.met = true; this.f.seen = true;
      if (this.ff) this.w.vignette('booth_wipe');
    },
    '#fit_open': () => { this.f.fitOpen = true; }, // phase B: he unlocked the fitting bays from his console
    l2_rig: () => {
      this.f.rig = true;
      this.w.screen('fitting_rig_screen', 'terminal_idle', SCREEN2.rig);
      if (this.ff) this.w.vignette('fitting_rig_wake');
    },
    l2_pass: () => { this.f.pass = true; }, // phase C
    // Section C: the doors, the bulkheads — and the local stop. Phase D.
    l2_power: () => {
      const w = this.w;
      this.f.power = true;
      w.setInteractable('relay_switch', false);
      w.lights('relay', { enabled: true, flicker: 'fluorescent' });
      w.screen('relay_panel', 'terminal_idle', SCREEN2.relay);
      if (this.ff) w.vignette('relay_arc');
    },
    '#line_running': () => {
      const w = this.w;
      w.machine('l2_tunnel', 'active');
      w.lights('line_emergency', { enabled: true, flicker: 'alarm' });
      w.lights('spine_emergency', { enabled: true, flicker: 'alarm' });
      w.lights('tunnel', { enabled: true, flicker: 'strobe' });
      w.screen('line_bigscreen', 'terminal_alert', SCREEN2.running);
      if (this.ff) w.vignette('line_start');
    },
    '#relay_clear': () => { this.f.relayClear = true; }, // phase D2
    l2_trap: () => { this.f.trapped = true; }, // phase E
    l2_window: () => { if (this.ff) this.w.vignette('booth_light_fail'); },
    '#taken': () => { this.f.taken = true; },
    // Phase F. His console and the recorder he left are the player's only now that he is gone.
    l2_booth_open: () => {
      this.f.boothOpen = true;
      this.w.setInteractable('term2_booth', true);
      this.w.setInteractable('booth_headset', true);
    },
    l2_loaded: () => {
      this.f.loaded = true;
      this.w.screen('line_bigscreen', 'terminal_alert', SCREEN2.yield32);
    },
    l2_escort: () => { this.f.escort = true; }, // phase G
    '#escort_dead': () => { this.f.escortDead = true; }, // phase G2
    l2_apron: () => { // phase H
      this.f.apron = true;
      this.w.machine('l2_tunnel', 'idle');
    },
    '#unit32_dead': () => { this.f.unit32Dead = true; },
    l2_foreman: () => { if (!this.f.foremanDead) this.w.machine('l2_core', 'frenzy'); },
    '#foreman_dead': () => { // phase I
      this.f.foremanDead = true;
      this.w.machine('l2_core', 'active');
      // The real Unit 14 exists only from here on, in front of the core door: inert, killable, remembered.
      if (!this.f.unit14Dead) this.w.spawnGroup('g2_unit14');
    },
    '#unit14_shot': () => { this.f.unit14Shot = true; },
    '#unit14_dead': () => { this.f.unit14Shot = true; this.f.unit14Dead = true; },
    l2_core: () => {
      this.f.core = true;
      for (let i = 1; i <= 4; i++) this.w.screen(`core_wall_${i}`, 'choir');
      this.w.screen('core_pedestal', 'choir');
      if (this.ff) this.w.vignette('core_bow');
    },
    '#core_offered': () => {
      this.f.offered = true;
      this.w.setInteractable('core_shutdown', true);
      this.w.setInteractable('core_rewrite', true);
    },
  };

  protected consequence(id: string): void {
    const fn = this.CONSEQUENCES[id];
    if (fn) { try { fn(); } catch (e) { console.warn(`[story] consequence ${id} failed`, e); } return; }
    if (!this.ff || !id.startsWith('#') || !LASTING.includes(id.slice(1))) return;
    // The marker writing is wiped when the talk starts: not redrawn once he has been met.
    if (id.startsWith('#booth_write') && this.prog.beats.includes('l2_intercom')) return;
    this.w.vignette(id.slice(1));
  }

  /** What every run starts from, before any phase: interactables, machines, screens. No door state. */
  private baseline(): void {
    const w = this.w;
    for (const id of ['booth_headset', 'term2_booth', 'core_shutdown', 'core_rewrite', 'lift_button']) w.setInteractable(id, false);
    w.setPrompt('booth_headset', TOAST2.recorder);
    w.machine('l2_tunnel', 'idle');
    w.machine('l2_treadmills', 'active');
    w.machine('l2_core', 'active');
    w.screen('booth_console', 'terminal_idle', SCREEN2.boothOrder);
  }

  private baselineMood(): 'silence' | 'ambient' | 'tension' {
    if (this.f.core) return 'silence';
    if (this.f.power) return 'tension';
    if (this.f.hall) return 'ambient';
    return 'silence';
  }

  fastForward(saved: ProgressL2, from: CheckpointIdL2, cleared: readonly string[]): void {
    const p = emptyProgressL2();
    p.beats = [...saved.beats];
    p.read = [...saved.read];
    p.visited = [...saved.visited];
    p.flags = { ...p.flags, ...saved.flags };
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
      if (this.f.unit14Dead) { try { this.ctx.enemies.removeGroup('g2_unit14'); } catch { /* ignore */ } }
      // Every door and the line: the phase table, snapped. Then the one latch a phase cannot know about.
      this.snapPhase();
      if (this.f.loaded && !this.f.escort) this.snapShut('d2_mouth');
      try { lv.settle?.(14); } catch (e) { console.warn('[story] level.settle failed', e); }
    } finally {
      this.ff = false;
      try { lv.setSilent?.(false); } catch { /* ignore */ }
    }
    for (const id of p.read) this.closedAt.set(id, -1e9);
    this.director.setMood(this.baselineMood());
  }
  private snapShut(id: string): void {
    const d = this.door(id) as (ReturnType<ScriptL2['door']> & { snap?: () => void }) | null;
    try { d?.lock(); d?.snap?.(); } catch { /* ignore */ }
  }

  snapshot(): ProgressL2 { return JSON.parse(JSON.stringify(this.prog)) as ProgressL2; }

  // ───────────────────────────────────────────────────────────── per-frame

  tick(dt: number): void {
    this.talk.update();
    if (!this.started) return;
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
    // Is the player already walking toward the fitting door? (1 s of distance samples.)
    this.fitDist.push(Math.hypot(this.pos.x - 10, this.pos.z + 34));
    if (this.fitDist.length > 6) this.fitDist.shift();
    if (this.pos.distanceToSquared(this.lastMovePos) > 1.2) { this.lastMovePos.copy(this.pos); this.lastMoveAt = this.now; }
    if (this.talk.speaking?.startsWith('l2_tomas_bark_unit14')) this.ghostCommentAt = this.now;
    if (this.director.mood === 'silence' && this.w.active() > 0 && !this.f.core) this.director.setMood('ambient');
    this.hooks.setObjective(this.computeObjective());
    this.barks(step);
    this.checkpoints(step);
  }

  private computeObjective(): string {
    const f = this.f;
    if (!this.live || this.ended) return OBJ2.none;
    if (f.choice) return OBJ2.leave;
    if (f.core) return f.offered ? OBJ2.choose : OBJ2.none;
    if (f.foremanDead) return OBJ2.enterCore;
    if (f.unit32Dead) return OBJ2.toCore;
    if (f.apron) return OBJ2.none;
    if (f.escortDead) return OBJ2.follow;
    if (f.escort) return OBJ2.none;
    if (f.boothOpen) return OBJ2.booth;
    if (f.trapped) return OBJ2.none;
    if (f.power) return f.relayClear ? OBJ2.toTomas : OBJ2.relayHeld;
    if (f.pass) return this.inRoom('relay') ? OBJ2.closeSwitch : OBJ2.toRelay;
    if (f.fitOpen) return OBJ2.findPass;
    if (f.met) return OBJ2.talking;
    if (f.seen) return OBJ2.intercom;
    if (f.hall) return OBJ2.knocking;
    return this.inRoom('cab') ? OBJ2.leaveCab : OBJ2.wayOut;
  }

  // ───────────────────────────────────────────────────────────── checkpoints

  /**
   * Each id loads into one phase (door state from the level's table):
   *   cp2_start, cp2_hall → A · cp2_talk → B · cp2_pass, cp2_relay → C · cp2_taken → F (then G after 2 s) ·
   *   cp2_escort → G2 · cp2_foreman → H · cp2_core → I.
   * `cp2_taken` is never taken by the calm rule: it is saved at one fixed instant (taking.ts).
   */
  private readonly CHECKPOINTS: Record<CheckpointIdL2, { when: () => boolean; valid: () => boolean }> = {
    cp2_start: { when: () => this.has('l2_dock'), valid: () => !this.f.hall },
    cp2_hall: { when: () => this.f.hall, valid: () => !this.f.met },
    cp2_talk: { when: () => this.f.fitOpen, valid: () => !this.f.pass },
    cp2_pass: { when: () => this.f.pass && this.has('#fit_over'), valid: () => !this.has('#hall_mid') && !this.f.power },
    cp2_relay: { when: () => this.has('l2_relay_enter') && this.inRoom('relay'), valid: () => !this.f.power },
    cp2_taken: { when: () => false, valid: () => false },
    cp2_escort: { when: () => this.f.escortDead, valid: () => !this.has('l2_tunnel') && !this.f.apron && !this.inTunnel() },
    cp2_foreman: { when: () => this.f.unit32Dead, valid: () => !this.has('l2_foreman') },
    cp2_core: { when: () => this.f.core && this.inRoom('core'), valid: () => !this.f.choice },
  };

  private calm(): boolean {
    const ctx = this.ctx, p = ctx.player;
    if (ctx.state !== 'playing' || !this.live || this.ended || this.noteOpen) return false;
    if (!p.alive || p.health <= 0 || !p.controlsEnabled) return false;
    if (Math.abs(p.velocity.y) > 0.4) return false;
    if (this.w.active() > 0 || this.now - this.lastCombat < 3) return false;
    for (const g of this.prog.triggered) if (!this.fought(g, 8)) return false;
    return true;
  }

  private checkpoints(step: number): void {
    if (this.ctx.debug.noStory) return;
    const taken = this.prog.checkpoints;
    const lastIdx = this.lastCheckpoint ? CHECKPOINT_IDS_L2.indexOf(this.lastCheckpoint) : -1;
    let due: CheckpointIdL2 | null = null;
    for (let i = CHECKPOINT_IDS_L2.length - 1; i > lastIdx; i--) {
      const id = CHECKPOINT_IDS_L2[i];
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
  private save(id: CheckpointIdL2): void {
    this.prog.checkpoints.push(id);
    this.lastCheckpoint = id;
    this.stamp(id);
    try { this.hooks.checkpoint(id); } catch (e) { console.error('[story] checkpoint failed', e); }
  }
  /** A checkpoint at a fixed instant of a scene (not when calm). Skipped only if the player is dead. */
  protected checkpointNow(id: 'cp2_taken'): void {
    const p = this.ctx.player;
    if (this.ctx.debug.noStory || this.prog.checkpoints.includes(id)) return;
    if (!p.alive || p.health <= 0 || this.ctx.state === 'dead' || this.ended) return;
    this.save(id);
  }

  // ───────────────────────────────────────────────────────────── flow

  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.restoredFrom) {
      this.baseline();
      // Before the lift has stopped: phase A's doors, but the cab gate stays shut until `l2_arrive`.
      applyPhase(this.ctx, 'A', true);
      this.w.lock('d2_cab');
      this.director.setMood('silence');
    }
    this.lastMovePos.copy(this.pos);
    this.lastMoveAt = this.now;
    if (this.f.hall) this.knock = true;
    if (this.f.power && !this.f.apron) { try { this.loops.push(this.ctx.audio.loop('siren_loop', { volume: 0.4 })); } catch { /* ignore */ } }
    const S = (n: string, fn: () => Promise<unknown>) => this.S(n, fn);
    this.placeTomas();
    this.ghostFiction();
    if (this.f.rig) this.showRigPattern();
    S('dock', () => this.dock());
    S('intake', () => this.intake());
    S('hall', () => this.hallReveal());
    S('knocking', () => this.knocking());
    S('seen', () => this.tomasSeen());
    S('intercom_fallback', () => this.intercomFallback());
    S('backlog', () => this.backlog());
    S('guide', () => this.guide());
    S('fitting', () => this.fitting());
    S('rig', () => this.rig());
    S('pass', () => this.passTaken());
    S('cross', () => this.hallCross());
    S('relay', () => this.relayEnter());
    S('trap', () => this.trap());
    if (this.f.loaded && !this.f.escortDead) S('taken_resume', () => this.resumeTaken());
    S('ride', () => this.ride());
    S('apron', () => this.apron());
    S('foreman', () => this.foreman());
    S('unit14_door', () => this.unit14AtDoor());
    S('core', () => this.core());
    S('lift', () => this.lift());
    S('ghost', () => this.ghostLoop());
  }

  /** The lift arrives. `short`: no cutscene (tests, restart). */
  async arrival(short: boolean): Promise<void> {
    const ctx = this.ctx, p = ctx.player, w = this.w;
    if (short) {
      this.beat('l2_arrive');
      this.live = true;
      ctx.ui.setHudVisible(true);
      ctx.setState('playing');
      return;
    }
    ctx.setState('cutscene');
    p.controlsEnabled = false;
    ctx.ui.setHudVisible(false);
    w.fade(1, 0);
    // In transit ('frenzy'), then the brakes ('active' stops at the gate in ~8 s).
    w.machine('l2_elevator', 'frenzy');
    const loop = (() => { try { return ctx.audio.loop('elevator_loop', { volume: 0.8 }); } catch { return null; } })();
    await this.hold(0.3);
    this.ui.blackout?.(false, 1.6);
    w.fade(0, 2.2);
    await this.hold(3.4);
    w.machine('l2_elevator', 'active');
    loop?.stop(7.5);
    await this.hold(7.8);
    w.play('metal_clang', undefined, 0.8);
    w.shake(0.35);
    await this.hold(1.0);
    await this.say('l2_unit_cab_arrive', { name: 'ELEVATOR' });
    await this.hold(0.6);
    this.beat('l2_arrive'); // phase A: the gate opens
    p.controlsEnabled = true;
    this.live = true;
    ctx.ui.setHudVisible(true);
    ctx.setState('playing');
    await this.hold(2.0);
    if (this.once('choir_arrive')) await this.choir(['l2_choir_arrive'], { chime: true });
  }

  /** After a checkpoint load. */
  resumeLive(): void {
    this.live = true;
    // He does not fill a silence the moment the game is back.
    this.talk.lastSpoke.set('tomas', this.now);
    this.lastMoveAt = this.now;
    this.backlogHoldUntil = this.now + 6;
    this.barkHoldUntil = this.now + 8;
    this.ghostRest(20 + Math.random() * 20);
    this.ctx.ui.setHudVisible(true);
  }

  // ───────────────────────────────────────────────────────────── act 1 — the tidy place

  /** Clean, lit, wrong. One unit polishes the floor. CHOIR asks you not to interrupt — while there is one to interrupt. */
  private async dock(): Promise<void> {
    await this.until(() => this.live && (this.at('t2_dock') || this.inRoom('dock')));
    if (this.beat('l2_dock')) this.w.vignette('dock_polisher');
    if (this.has('#choir_dock')) return;
    await this.wait(3.5);
    if (!(await this.cue(() => this.inRoom('dock') && this.facts.calm('g2_dock'), () => this.f.hall || this.w.alive('g2_dock') === 0)) || !this.once('choir_dock')) return;
    this.quiet(10);
    await this.choir(['l2_choir_dock'], { chime: true });
    if (this.facts.calm('g2_dock') && this.once('hint_stealth')) this.toast(TOAST2.stealth);
  }

  /** Where the staff were received: the shoes, the gauge that still knows your height. */
  private async intake(): Promise<void> {
    await this.until(() => this.live && (this.at('t2_intake') || this.inRoom('intake')));
    this.beat('l2_intake');
    const gone = () => this.f.hall;
    this.S('intake_shoe', async () => {
      if (this.has('#intake_shoe')) return;
      await this.wait(4);
      const shoes = this.w.objectPos('intake_shoes', V(-3.5, 0.1, -14));
      if (!(await this.cue(() => this.inRoom('intake') && this.isLookingAt(shoes, 40) && this.distTo(shoes) < 9, gone))) return;
      if (this.once('intake_shoe')) { this.w.vignette('intake_shoe'); this.quiet(10); }
    });
    this.S('intake_pa', async () => {
      if (this.has('#choir_intake')) return;
      await this.until(() => this.closedAt.has('note2_intake') || (this.roomTime.get('intake') ?? 0) > 14 || gone());
      await this.wait(1.5);
      if (!(await this.cue(() => this.inRoom('intake'), gone)) || !this.once('choir_intake')) return;
      this.quiet(9);
      await this.choir(['l2_choir_intake'], { chime: true });
    });
    if (this.has('#intake_gauge')) return;
    await this.until(() => gone() || this.at('t2_intake_arch', () => this.inRoom('intake') && this.pos.z < -19));
    if (gone() || !this.once('intake_gauge')) return;
    this.w.vignette('intake_gauge');
    await this.wait(1.6);
    await this.choir(['l2_choir_gauge'], { ttl: 4 });
  }

  // ───────────────────────────────────────────────────────────── act 2 — someone is alive

  /** Tomas is on stage from the start of the level until the units take him. */
  private placeTomas(): void {
    if (this.f.taken || this.f.power || this.tomas) return;
    // `sit`: his position is the chair's seat centre.
    const chair = this.w.hasObject('booth_chair') ? this.w.objectPos('booth_chair', TOMAS_DESK) : TOMAS_DESK;
    const up = this.f.met || this.f.hall;
    const at = up ? TOMAS_AT_GLASS : chair;
    this.tomas = this.actor('human', at, face(at, GLASS), up ? 'idle' : 'sit');
    this.tomasSpot = up ? 'glass' : 'chair';
    this.tomasPose = up ? 'idle' : 'sit';
  }

  private async hallReveal(): Promise<void> {
    if (this.has('l2_hall_reveal')) return;
    await this.until(() => this.live && (this.at('t2_line_enter') || this.inRoom('line')));
    if (!this.beat('l2_hall_reveal')) return;
    const w = this.w;
    this.director.setMood('ambient');
    this.quiet(14);
    await this.wait(1.2);
    w.vignette('hall_screen_count');
    await this.wait(3.2);
    w.vignette('hall_hooks_sway');
    await this.wait(2.5);
    // Somebody saw the doors open on a monitor.
    this.knock = true;
  }

  /** He is at the glass, hitting it with the flat of his hand — for as long as nobody presses the intercom. */
  private async knocking(): Promise<void> {
    await this.until(() => this.knock || this.f.met);
    if (this.f.met) return;
    this.place(this.tomas, TOMAS_AT_GLASS, face(TOMAS_AT_GLASS, GLASS));
    this.tomasSpot = 'glass';
    for (let i = 0; !this.f.met; i++) {
      if (this.writing || this.ctx.state !== 'playing') { await this.hold(0.5); continue; }
      if (this.tomasPose !== 'bang_glass') this.pose(this.tomas, 'bang_glass');
      this.w.play('glass_bang', GLASS, 0.9);
      await this.hold(i % 3 === 2 ? 2.4 : 0.55);
    }
  }

  /** The first sight of him, then the writing: he cannot hear you. */
  private async tomasSeen(): Promise<void> {
    if (this.f.met) return;
    await this.until(() => this.f.hall && (this.knock || this.f.met));
    await this.until(() => this.f.met || this.atGlass()
      || (this.inRoom('line') && this.pos.z > -50.35 && this.distTo(GLASS) < 18 && this.isLookingAt(GLASS, 22)));
    if (this.f.met) return;
    this.writing = true;
    if (this.beat('l2_tomas_seen')) {
      this.pose(this.tomas, 'wave');
      this.lookAt(this.tomas, this.ctx.player.eye);
    }
    await this.until(() => this.f.met || this.atGlass() || this.distTo(GLASS) < 7);
    if (!this.f.met && this.once('booth_write_1')) {
      this.pose(this.tomas, 'write');
      this.w.play('marker_squeak', GLASS, 0.6);
      await this.hold(0.9);
      if (!this.f.met) this.w.vignette('booth_write_1'); // (pressed meanwhile: he wiped the glass — nothing is written after)
      await this.wait(2.4);
    }
    if (!this.f.met && this.once('booth_write_2')) {
      this.pose(this.tomas, 'write');
      this.w.play('marker_squeak', GLASS, 0.6);
      await this.hold(0.9);
      if (!this.f.met) this.w.vignette('booth_write_2'); // (pressed meanwhile: he wiped the glass — nothing is written after)
      await this.wait(0.8);
    }
    if (!this.f.met) this.pose(this.tomas, 'idle');
    // He points at the writing for a while, then goes back to the glass with his hands.
    await this.untilOr(() => this.f.met, 9);
    this.writing = false;
  }

  /** A level build without the intercom panel: he starts talking once you stand at the glass. */
  private async intercomFallback(): Promise<void> {
    await this.until(() => this.f.hall && this.atGlass());
    await this.wait(5);
    if (!this.ctx.interactables.get('intercom_hall') && !this.f.met) this.S('intercom', () => this.intercom());
  }

  /**
   * First talk. Pressing the intercom takes the handset — from this frame Tomas is in the player's ear
   * wherever they go. Three lines, then he unlocks the fitting bays (phase B, the real gate), and the rest of
   * what he has to say follows over the handset (`backlog`), each line by its own rule.
   */
  private async intercom(): Promise<void> {
    if (!this.beat('l2_intercom')) {
      // Pressing it again later: he is still there.
      this.bark(this.now % 2 < 1 ? 'l2_tomas_bark_glass_1' : 'l2_tomas_bark_glass_2', 45);
      return;
    }
    const w = this.w;
    this.toast(TOAST2.handset);
    w.play('intercom_click', undefined, 0.6);
    w.play('intercom_static', GLASS, 0.5);
    this.director.setMood('ambient');
    // He wipes the writing off with his sleeve: somebody can hear him now.
    this.writing = true;
    this.place(this.tomas, TOMAS_AT_GLASS, face(TOMAS_AT_GLASS, GLASS));
    this.tomasSpot = 'glass';
    this.pose(this.tomas, 'write');
    w.vignette('booth_wipe');
    this.lookAt(this.tomas, this.ctx.player.eye);
    await this.hold(0.5);
    this.pose(this.tomas, 'talk');
    await this.tomasSays(['l2_tomas_hello_1', 'l2_tomas_hello_2', 'l2_tomas_hello_3']);
    // The gate: d2_fitting unlocks from his console as he says so.
    const unlock = () => {
      if (!this.once('fit_open')) return;
      this.stamp('fit_open');
      w.play('door_unlock', V(10, 1.4, -34), 0.9);
      this.toast(TOAST2.fittingOpen);
    };
    unlock();
    await this.say('l2_tomas_unlock');
    this.beat('l2_guided');
    if (this.tomasSpot === 'glass') this.pose(this.tomas, 'idle');
    this.lastMoveAt = this.now;
  }

  /** The rest of what he has to tell (see BACKLOG): one line at a time, whenever the channel and the world are quiet. */
  private async backlog(): Promise<void> {
    await this.until(() => this.f.fitOpen && this.has('l2_guided'));
    await this.wait(0.5);
    for (;;) {
      await this.hold(0.3);
      if (this.f.power || this.ended) { this.once('first_talk_over'); return; }
      const left = BACKLOG.filter((b) => !this.talk.heard.has(b.id) && (this.backlogTries.get(b.id) ?? 0) < 2);
      if (!left.some((b) => b.id === 'l2_tomas_go')) this.once('first_talk_over');
      if (!left.length) return;
      if (!this.live || this.ctx.state !== 'playing' || this.talk.busy || this.noteOpen || this.now < this.backlogHoldUntil) continue;
      if (this.w.active() > 0 || this.now - this.lastCombat < 4) continue;
      const next = left[0];
      if (next.stage === 'C' && !(this.f.pass && this.has('#fit_over') && this.has('l2_hall_cross'))) continue;
      if (next.pause && this.talk.since('tomas') < next.pause) continue;
      this.backlogTries.set(next.id, (this.backlogTries.get(next.id) ?? 0) + 1);
      await this.tomasSays([next.id], 'talk');
    }
  }

  /** A nudge east, only for a player who is neither there nor on the way. */
  private async guide(): Promise<void> {
    await this.until(() => this.has('l2_guided'));
    for (const after of [18, 45]) {
      if (await this.untilOr(() => this.f.pass || this.prog.visited.includes('fitting'), after)) return;
      await this.until(() => this.f.pass || !this.talk.busy);
      if (this.f.pass) return;
      void this.talk.lines(['l2_tomas_guide_east'], { pri: 'talk' });
    }
  }

  /** The fitting bays: the stealth lesson, the treadmills in step. (The projection: ghost.ts.) */
  private async fitting(): Promise<void> {
    await this.until(() => this.live && (this.at('t2_fitting') || this.inRoom('fitting')));
    const done = () => this.f.pass || this.w.alive('g2_fit_tread') === 0;
    if (!this.f.pass && this.once('fit_stealth')) {
      this.talk.flush(true); // the order can wait: whisper
      this.backlogHoldUntil = this.now + 10;
      await this.tomasSays(['l2_tomas_stealth_1', 'l2_tomas_stealth_2']);
      if (this.facts.calm('g2_fit_tread') && this.once('hint_stealth')) this.toast(TOAST2.stealth);
    }
    if (this.has('#fitting_sync') || done()) return;
    await this.wait(5);
    if (!done() && this.once('fit_treadmills')) await this.talk.lines(['l2_tomas_treadmills'], { pri: 'talk' });
    await this.wait(4);
    if (!(await this.cue(() => this.inRoom('fitting') && this.facts.calm('g2_fit_tread'), done)) || !this.once('fitting_sync')) return;
    this.w.vignette('fitting_sync');
    try { (this.ctx.enemies as unknown as { syncTreadmills?: (s: number) => void }).syncTreadmills?.(4); } catch { /* ignore */ }
    this.syncAt = this.now;
    this.quiet(8);
    await this.wait(2.6);
    await this.talk.lines(['l2_tomas_sync'], { pri: 'talk', ttl: 4 });
  }

  /** The rig with your name on it — and your walk, playing on it. */
  private async rig(): Promise<void> {
    if (!this.has('l2_rig')) {
      const rig = this.w.objectPos('rig_ref', V(17.5, 1.2, -37.5));
      await this.until(() => this.live && (this.at('t2_fitting_rig') || (this.inRoom('fitting') && this.distTo(rig) < 3.2) || this.closedAt.has('tag2_rig') || this.noteId === 'tag2_rig'));
      if (this.beat('l2_rig')) {
        this.w.vignette('fitting_rig_wake');
        this.showRigPattern();
        this.quiet(8);
        void this.talk.lines(['l2_tomas_rig_1'], { pri: 'talk', ttl: 6 });
      }
    }
    if (this.has('#rig_read')) return;
    await this.until(() => this.closedAt.has('tag2_rig'));
    if (!this.once('rig_read') || this.f.power) return;
    await this.wait(0.6);
    await this.tomasSays(['l2_tomas_rig_2', 'l2_tomas_rig_3', 'l2_tomas_rig_4']);
  }

  /** The pass comes off the desk — and the units in the charging alcoves stand up, if any are left to. */
  private async passTaken(): Promise<void> {
    await this.until(() => this.live && (this.f.pass || this.w.hasKeyNamed('section_pass') || this.w.hasKey()));
    if (this.beat('l2_pass')) { // phase C: d2_relay answers the pass
      this.toast(TOAST2.passOk);
      void this.say('l2_tomas_pass_taken', { ttl: 5 });
      if (this.w.alive('g2_fit_wake') > 0) {
        this.prog.triggered.push('g2_fit_wake');
        this.triggeredAt.set('g2_fit_wake', this.now + 2);
        await this.hold(1.6);
        if (this.w.alive('g2_fit_wake') > 0) {
          this.beat('l2_fit_fight');
          this.engage('g2_fit_wake', 'wake', 0.7);
          this.director.setMood('tension');
          await this.hold(0.8);
          void this.say('l2_tomas_fit_fight', { ttl: 4 });
        }
      }
    }
    if (this.has('#fit_over')) return;
    await this.until(() => this.f.power || !this.prog.triggered.includes('g2_fit_wake') || this.fought('g2_fit_wake', 3));
    this.once('fit_over'); // → cp2_pass
    this.director.setMood('ambient');
    if (!this.has('l2_fit_fight') || this.f.power) return;
    await this.wait(2.2);
    await this.tomasSays(['l2_tomas_fit_after_1']);
    await this.wait(1.4);
    await this.tomasSays(['l2_tomas_fit_after_2']);
  }

  /** Back across the hall, south to the relay room. (Coffee and his mother: BACKLOG stage C.) */
  private async hallCross(): Promise<void> {
    if (this.f.power) return;
    await this.until(() => this.f.power || (this.f.pass && this.has('#fit_over') && this.inRoom('line')));
    if (this.f.power) return;
    if (this.beat('l2_hall_cross')) {
      this.S('cross_1', async () => { await this.wait(1.5); if (!this.has('#hall_mid')) await this.talk.lines(['l2_tomas_cross_1'], { pri: 'talk' }); });
      this.S('cross_wave', async () => {
        await this.until(() => this.f.power || (this.tomasSpot === 'glass' && this.inRoom('line') && this.pos.z < -40 && this.pos.z > -50.35 && this.pos.x < 2 && this.isLookingAt(GLASS, 45) && !this.talk.busy));
        if (this.f.power || !this.once('cross_wave')) return;
        this.pose(this.tomas, 'wave');
        await this.talk.lines(['l2_tomas_cross_wave'], { pri: 'talk', ttl: 3 });
        if (this.tomasSpot === 'glass' && !this.f.power) this.pose(this.tomas, 'idle');
      });
    }
    if (this.has('#hall_mid')) return;
    await this.until(() => this.f.power || this.hallSouth());
    if (this.f.power || !this.once('hall_mid')) return;
    if (!this.w.spawns('g2_hall_mid').length) return;
    this.engage('g2_hall_mid', 'spawn');
    this.director.setMood('tension');
    this.talk.flush(true);
    await this.hold(0.6);
    void this.say('l2_tomas_hall_fight', { ttl: 4 });
    await this.until(() => this.f.power || this.fought('g2_hall_mid', 4));
    if (this.f.power) return;
    this.director.setMood('ambient');
    await this.wait(2);
    void this.talk.lines(['l2_tomas_hall_after'], { pri: 'talk', ttl: 6 });
  }

  private async relayEnter(): Promise<void> {
    if (this.f.power) return;
    await this.until(() => this.f.power || (this.live && this.f.pass && (this.at('t2_relay') || this.inRoom('relay'))));
    if (this.f.power) return;
    this.relayEnteredAt = this.now;
    if (this.beat('l2_relay_enter')) {
      this.talk.flush(true);
      this.backlogHoldUntil = this.now + 14;
      await this.tomasSays(['l2_tomas_relay_1', 'l2_tomas_relay_2']);
      await this.wait(1.5);
      if (!this.f.power) await this.talk.lines(['l2_tomas_relay_cam'], { pri: 'talk' });
      await this.wait(4);
      if (!this.f.power) await this.talk.lines(['l2_tomas_relay_breaker'], { pri: 'talk' });
    }
    // Hale's note says what the switch also does. He can hear you not closing it.
    this.S('relay_note', async () => {
      await this.until(() => this.f.power || this.closedAt.has('note2_relay'));
      if (this.f.power || !this.once('relay_note')) return;
      await this.wait(1.2);
      if (!this.f.power) await this.tomasSays(['l2_tomas_relay_wait_2']);
    });
    await this.until(() => this.f.power || (this.inRoom('relay') && this.now - this.relayEnteredAt > 32 && !this.talk.busy && !this.noteOpen));
    if (this.f.power || !this.once('relay_wait')) return;
    await this.tomasSays(['l2_tomas_relay_wait_1']);
  }

  // ───────────────────────────────────────────────────────────── act 4 — he is still in there

  /** Off the belt on the far side (phase H). Then the next unit comes off the line behind the player. */
  private async apron(): Promise<void> {
    if (this.f.unit32Dead) return;
    await this.until(() => this.f.loaded && this.onApron() && !this.inTunnel());
    const w = this.w;
    this.beat('l2_tunnel');
    if (this.beat('l2_apron')) {
      this.stamp('apron');
      this.director.setMood('silence');
      for (const l of this.loops.splice(0)) { try { l.stop(3); } catch { /* ignore */ } }
      this.talk.flush();
      await this.wait(2.0);
      if (this.once('choir_apron')) await this.choir(['l2_choir_apron'], { ttl: 3 });
    }
    await this.hold(2.5);
    if (this.beat('l2_unit32')) {
      const at = () => { const e = this.unit32(); return e ? this.tmp2.copy(e.position).setY(e.position.y + 1.55).clone() : null; };
      // Spawn-mode, inside the tunnel behind the exit shutter: it was never anywhere before this.
      if (w.spawns('g2_unit32').length) this.engage('g2_unit32', 'spawn');
      else { try { this.ctx.enemies.spawn('husk', V(5, 0.55, -60.5), Math.PI, 'g2_unit32'); this.prog.triggered.push('g2_unit32'); this.triggeredAt.set('g2_unit32', this.now); } catch { /* ignore */ } }
      await this.hold(0.8);
      // His joke, in his voice, with nothing behind it — if the player ever heard the joke. Then it does its job.
      await this.say('l2_unit32_1', { name: 'UNIT 32', at });
      await this.wait(0.9);
      await this.say('l2_unit32_2', { name: 'UNIT 32', at });
      this.director.setMood('tension');
      let i = 0;
      const rest = ['l2_unit32_3', 'l2_unit32_4', 'l2_unit32_5'];
      let next = this.now + 5;
      await this.until(() => {
        if (!this.unit32()) return true;
        if (this.now >= next && !this.talk.busy && i < rest.length) { void this.say(rest[i++], { name: 'UNIT 32', at }); next = this.now + 7; }
        return false;
      });
    }
    await this.until(() => this.fought('g2_unit32', 2) || (!this.unit32() && this.now - (this.triggeredAt.get('g2_unit32') ?? this.now) > 2));
    if (!this.once('unit32_dead')) return;
    this.director.setMood('silence');
    this.talk.flush();
    await this.hold(2.4);
    await this.choir(['l2_choir_unit32_1']);
    await this.wait(1.6);
    await this.choir(['l2_choir_unit32_2']);
  }

  private onEnemyDied(group: string, type: EnemyType): void {
    if (!this.started) return;
    this.diedIn.set(group, (this.diedIn.get(group) ?? 0) + 1);
    if (type === 'husk') this.f.husksKilled++;
    if (WORKER_GROUPS.includes(group) || group === 'g2_unit14') {
      this.f.workersKilled++;
      this.workerKilledAt = this.now;
      this.provokedAt = this.now;
      if (WORKER_GROUPS.includes(group)) this.S('killed_worker', async () => {
        // Shot on sight: no stealth line any more — one reaction that fits, never "don't".
        await this.hold(0.9);
        if (this.f.met) this.bark('l2_tomas_bark_killed_worker', 1e6);
        else if (this.once('choir_provoked')) { await this.hold(0.6); await this.choir(['l2_choir_provoked']); }
      });
    }
    if (group === 'g2_unit32' && !this.f.unit32Dead) {
      // The last thing it says is the biscuit — if there ever was a biscuit.
      this.talk.flush();
      this.talk.overlap('l2_unit32_die', { name: 'UNIT 32', at: this.pos.clone().setY(1.2) });
    }
    if (group === 'g2_unit14') {
      this.once('unit14_dead');
      this.talk.overlap('l2_unit14_die', { name: 'UNIT 14' });
    }
  }

  /**
   * The supervisor (three staff voices, out of sync — voiced by the enemies module). Nothing of it exists
   * before this beat: the level's hoist brings it in (`foreman_arrive`) and the group is spawn-mode.
   */
  private async foreman(): Promise<void> {
    if (this.f.foremanDead) return;
    // Hall z < −60 after Unit 32 is dead — and after the breath that follows it (the apron itself lies south of
    // −60: without this the supervisor would arrive on the same second, before cp2_foreman could be saved).
    await this.until(() => this.f.unit32Dead && this.live);
    await this.untilOr(() => this.prog.checkpoints.includes('cp2_foreman'), 14);
    await this.until(() => this.inRoom('line') && this.pos.z < -60 && this.region('hall_south'));
    if (this.beat('l2_foreman')) {
      this.director.setMood('tension');
      void this.choir(['l2_choir_foreman']);
      this.w.vignette('foreman_arrive');
      await this.hold(1.5);
      if (this.w.spawns('g2_foreman').length) this.engage('g2_foreman', 'both', 1.2);
    }
    await this.until(() => !this.prog.triggered.includes('g2_foreman') || this.fought('g2_foreman', 6));
    await this.hold(1.5);
    this.once('foreman_dead'); // phase I: the core door answers
    this.director.setMood('silence');
  }

  /** Unit 14 in front of the core door: a real machine. It holds the door. It never wakes unless shot. */
  private async unit14AtDoor(): Promise<void> {
    await this.until(() => this.f.foremanDead);
    if (this.f.unit14Dead || this.has('#unit14_after_you')) return;
    const at = () => { const e = this.unit14(); return e ? e.position.clone().setY(e.position.y + 1.55) : null; };
    await this.until(() => this.f.core || this.f.unit14Shot || (() => { const p = at(); return !!p && this.distTo(p) < 4.2; })());
    if (this.f.core || this.f.unit14Shot || !this.once('unit14_after_you')) return;
    await this.say('l2_unit14_door', { name: 'UNIT 14', at, ttl: 4 });
  }

  private onEnemyDamaged(id: number): void {
    if (!this.started) return;
    let e: Enemy | undefined;
    try { e = this.ctx.enemies.all.find((x) => x.id === id); } catch { return; }
    if (!e) return;
    if (WORKER_GROUPS.includes(e.group)) this.provokedAt = this.now;
    if (e.group !== 'g2_unit14' || !this.f.foremanDead) return;
    this.unit14ShotAt = this.now;
    if (!this.once('unit14_shot')) return;
    const pos = e.position.clone().setY(e.position.y + 1.5);
    this.S('unit14_shot', async () => {
      this.talk.overlap('l2_unit14_shot', { name: 'UNIT 14', at: pos });
      await this.hold(2.6);
      await this.choir(['l2_choir_unit14_shot']);
    });
  }

  // ───────────────────────────────────────────────────────────── act 5 — pattern 00, and the choice

  private async core(): Promise<void> {
    if (this.f.choice) return;
    await this.until(() => this.f.foremanDead && (this.at('t2_core') || this.inRoom('core')));
    const w = this.w;
    const fresh = this.beat('l2_core');
    this.director.setMood('silence');
    if (fresh) {
      this.talk.flush();
      w.vignette('core_bow');
      await this.hold(1.6);
    }
    if (!this.f.offered) {
      // (core_7 / core_11 count the units the player shot: dialogue.ts picks the variant.)
      const first = ['l2_choir_core_1', 'l2_choir_core_2', 'l2_choir_core_3', 'l2_choir_core_4', 'l2_choir_core_5', 'l2_choir_core_6', 'l2_choir_core_7', 'l2_choir_core_8'];
      // After a load into the middle of it, CHOIR does not start over.
      if (fresh) for (const id of first) { await this.choir([id], { glitch: 0.12 }); await this.wait(0.7); }
      else await this.hold(6);
      await this.choir(['l2_choir_core_9']);
      this.once('core_offered'); // both are live from here; the first one used wins
      for (const id of ['l2_choir_core_10', 'l2_choir_core_11', 'l2_choir_core_12', 'l2_choir_core_13', 'l2_choir_core_14']) {
        if (this.f.choice) return;
        await this.choir([id]);
        await this.wait(0.8);
      }
    }
    // It waits. Now and then it says so.
    for (const id of ['l2_choir_core_idle_1', 'l2_choir_core_idle_2']) {
      const t0 = this.now;
      await this.until(() => !!this.f.choice || (this.now - t0 > 28 && !this.noteOpen));
      if (this.f.choice) return;
      if (this.once(id)) await this.choir([id]);
    }
  }

  private async choose(choice: 'shutdown' | 'rewrite'): Promise<void> {
    if (this.f.choice || !this.f.offered) return;
    const w = this.w;
    this.f.choice = choice;
    this.ui.closeNote?.();
    w.setInteractable('core_shutdown', false);
    w.setInteractable('core_rewrite', false);
    this.talk.flush();
    const cells = w.objectPos('core_cells', V(0, 1.4, -84));
    if (choice === 'shutdown') {
      this.beat('l2_choice_shutdown'); // phase I2: the lift door answers
      w.vignette('core_cells_out');
      for (const [i, id] of ['l2_choir_shutdown_1', 'l2_choir_shutdown_2', 'l2_choir_shutdown_3'].entries()) {
        w.play('cell_pull', cells, 1);
        w.shake(0.2 + i * 0.1);
        await this.hold(0.7);
        if (i === 1) w.machine('l2_line', 'off');
        await this.choir([id], { glitch: 0.3 + i * 0.25 });
        await this.hold(0.5);
      }
      w.play('power_down', undefined, 1);
      w.machine('l2_core', 'off');
      w.machine('l2_tunnel', 'idle');
      for (const g of ['line_emergency', 'spine_emergency', 'tunnel']) w.lights(g, { enabled: false });
      for (let i = 1; i <= 4; i++) w.screen(`core_wall_${i}`, 'static');
      w.screen('core_pedestal', 'static');
      w.screen('line_bigscreen', 'terminal_alert', SCREEN2.stopped);
      this.dropUnits();
    } else {
      this.beat('l2_choice_rewrite'); // phase I2
      w.play('terminal_beep', w.objectPos('core_pedestal', V(0, 1.2, -80)), 0.9);
      await this.hold(0.8);
      await this.choir(['l2_choir_rewrite_1']);
      w.machine('l2_line', 'off');
      w.machine('l2_tunnel', 'idle');
      w.play('power_down', V(0, 3, -60), 0.7);
      for (const g of ['line_emergency', 'spine_emergency']) w.lights(g, { enabled: false });
      for (let i = 1; i <= 4; i++) w.screen(`core_wall_${i}`, 'terminal_idle', SCREEN2.amended);
      w.screen('line_bigscreen', 'terminal_idle', SCREEN2.amended);
      await this.hold(0.8);
      await this.choir(['l2_choir_rewrite_2']);
      await this.wait(1.2);
      // From the hall, through the open door: awake. Okafor's voice only if Unit 14 still stands (dialogue.ts).
      this.talk.overlap('l2_unit14_wait', { name: this.unit14() ? 'UNIT 14' : 'SERVICE UNIT', at: V(0, 1.5, -69) });
      await this.hold(2.4);
      await this.choir(['l2_choir_rewrite_3']);
    }
    w.setInteractable('lift_button', true);
    w.screen('lift_panel', 'terminal_idle', SCREEN2.liftUp);
    this.once('choice_done');
  }

  /** Shutdown: every unit drops where it stands. Unit 14 too: it is switched off where it stood (a wreck, not a puppet). */
  private dropUnits(): void {
    if (this.f.unit14Dead) return;
    try {
      const e = this.unit14();
      if (!e || e.state !== 'dormant') return;
      if (!this.notLookingAt(this.tmp.copy(e.position).setY(1.5).clone(), 60)) return;
      this.w.play('body_fall', e.position.clone(), 0.8);
      (e as unknown as { setEyes?: (on: boolean) => void }).setEyes?.(false);
    } catch { /* ignore */ }
  }

  /** The service lift at the back of the core: the way out. */
  private async lift(): Promise<void> {
    await this.until(() => !!this.f.choice);
    // A level build without the button: standing in the lift is enough.
    await this.until(() => this.ended || (!this.ctx.interactables.get('lift_button') && (this.at('t2_lift') || this.inRoom('lift'))));
    if (this.ended) return;
    await this.hold(1.5);
    await this.end();
  }

  private async end(): Promise<void> {
    if (this.ended || !this.f.choice) return;
    this.ended = true;
    const ctx = this.ctx, w = this.w;
    this.ui.closeNote?.();
    w.setInteractable('lift_button', false);
    ctx.setState('cutscene');
    ctx.player.controlsEnabled = false;
    this.hooks.setObjective('');
    this.beat('l2_end');
    w.lock('d2_lift'); // the lift leaves (ending cutscene; the player no longer has controls)
    w.machine('l2_lift', 'active');
    const loop = (() => { try { return ctx.audio.loop('lift_loop', { volume: 0.8 }); } catch { return null; } })();
    this.director.hard('silence');
    await this.hold(1.2);
    await this.say('l2_unit_lift', { name: 'SERVICE LIFT' });
    await this.hold(1.4);
    w.fade(1, 3);
    loop?.stop(3.2);
    await this.hold(3.4);
    for (const a of [...this.actors]) this.drop(a);
    this.talk.shutUp();
    ctx.setState('ended');
    ctx.ui.setHudVisible(false);
    // The ending counts what the player left standing: it never claims thirty-two.
    await this.hooks.ending(this.f.choice, this.f.unit14Dead ? 'killed' : this.f.unit14Shot ? 'shot' : 'spared', Math.max(0, 32 - this.f.husksKilled));
  }

  // ───────────────────────────────────────────────────────────── barks (Tomas reacts to where you are)

  /** What triggers a bark. Whether it is still true when he opens his mouth is the line's rule (dialogue.ts). */
  private barks(step: number): void {
    if (!this.f.met || this.f.power || !this.live || this.ctx.state !== 'playing' || this.now < this.barkHoldUntil) return;
    const now = this.now, p = this.pos;
    const calm = this.w.active() === 0 && !this.noteOpen && !this.talk.busy;
    if (!calm) return;
    const room = this.w.room();
    // The projection is behind you.
    if (this.facts.ghostBehind && this.has('#fit_over')) { this.bark('l2_tomas_bark_unit14', 120); return; }
    // You stopped.
    if (now - this.lastMoveAt > 26 && !this.atGlass() && room !== 'relay') {
      this.lastMoveAt = now - 6;
      this.bark(this.quietBarks % 2 ? 'l2_tomas_bark_stop_2' : 'l2_tomas_bark_stop_1', 120);
      return;
    }
    // Long silence: he fills it.
    if (this.talk.since('tomas') > 48 && this.quietBarks < 3 && room !== 'relay' && this.has('#first_talk_over')) {
      this.bark(`l2_tomas_bark_quiet_${++this.quietBarks}`, 1e6);
      return;
    }
    // Wrong way.
    if ((room === 'intake' || room === 'dock') && this.f.fitOpen) { this.bark('l2_tomas_bark_back', 150); return; }
    if (room === 'line' && !this.f.pass && this.f.fitOpen && !this.prog.visited.includes('fitting') && p.x > 6 && p.z < -42 && p.z > -62) { this.bark('l2_tomas_bark_left', 1e6); return; }
    if (this.atCoreDoor()) { this.bark('l2_tomas_bark_core_door', 150); return; }
    if (this.atGlass() && this.f.fitOpen && now - (this.triggerAt.get('t2_glass') ?? 0) < 3 && this.has('#first_talk_over')) {
      if (this.tomasSpot === 'glass') this.pose(this.tomas, 'wave');
      this.bark(this.quietBarks % 2 ? 'l2_tomas_bark_glass_2' : 'l2_tomas_bark_glass_1', 75);
      return;
    }
    if (this.ctx.player.health < 35) { this.bark('l2_tomas_bark_lowhp', 150); return; }
    // The light on a working unit's face.
    if (this.ctx.player.flashlightOn && this.lookingAtWorker()) {
      this.lightOnWorker += step;
      if (this.lightOnWorker > 0.5) { this.lightOnWorker = 0; this.bark('l2_tomas_bark_light', 25); }
    } else this.lightOnWorker = 0;
  }

  private onShot(): void {
    if (!this.started || this.w.active() > 0 || this.f.power) return;
    this.S('shot_bark', async () => {
      await this.hold(0.7);
      if (this.w.active() === 0 && this.now - this.workerKilledAt > 3 && this.now - this.glassShotAt > 3) this.bark(this.quietBarks % 2 ? 'l2_tomas_bark_shots_2' : 'l2_tomas_bark_shots_1', 50);
    });
  }

  private onHurt(health: number): void {
    if (!this.started || health <= 0) return;
    this.lastHurtAt = this.now;
    this.bark('l2_tomas_bark_hurt', 40);
  }

  /** A working unit was made to look up. */
  private onEnemyStir(id: number): void {
    if (!this.started) return;
    let e: Enemy | undefined;
    try { e = this.ctx.enemies.all.find((x) => x.id === id); } catch { return; }
    if (!e || !WORKER_GROUPS.includes(e.group)) return;
    this.provokedAt = this.now;
    if (this.f.met && !this.f.power) { void this.say('l2_tomas_bark_provoked', { pri: 'bark', cooldown: 30 }); return; }
    if (this.once('choir_provoked')) this.S('provoked', async () => { await this.hold(1.5); await this.choir(['l2_choir_provoked']); });
  }

  // ───────────────────────────────────────────────────────────── reactions

  private onInteract(id: string): void {
    if (!this.started || this.ended) return;
    switch (id) {
      case 'intercom_hall': this.S('intercom', () => this.intercom()); return;
      case 'relay_switch': if (this.f.pass || this.inRoom('relay')) this.S('power', () => this.power()); return;
      case 'core_shutdown': this.S('choice', () => this.choose('shutdown')); return;
      case 'core_rewrite': this.S('choice', () => this.choose('rewrite')); return;
      case 'lift_button': if (this.f.choice) this.S('end', () => this.end()); return;
      case 'booth_headset': case 'term2_booth': if (!this.f.boothOpen) return; break;
    }
    const f = FRAGMENTS_L2[id];
    if (f) this.openNote(id, f);
  }

  private openNote(id: string, f: Fragment): void {
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
    // His last memo is heard (recorded voice only).
    if (id === 'booth_headset' && hasSay(this.ctx)) {
      try { this.recorder?.stop(0.1); } catch { /* ignore */ }
      this.recorder = speak(this.ctx, 'l2_tomas_headset_1', { subtitle: false }).handle;
      this.talk.log.push({ t: this.now, id: 'l2_tomas_headset_1', cond: null, said: 'l2_tomas_headset_1', pri: 'over' });
      const d = this.recorder?.duration ?? 3.5;
      const mine = this.recorder;
      setTimeout(() => { if (this.recorder === mine && this.noteId === id) this.recorder = speak(this.ctx, 'l2_tomas_headset_2', { subtitle: false }).handle; }, (d + 0.5) * 1000);
    } else if (id.startsWith('note2_') || id.startsWith('term2_')) this.bark('l2_tomas_bark_read', 120);
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

  /** A locked door was tried: the door says why (toast). Tomas only comments on what he can know. */
  private onDenied(id: string): void {
    if (!this.started) return;
    const f = this.f;
    this.deniedAt.set(id, this.now);
    switch (id) {
      case 'd2_fitting':
        if (f.fitOpen) break;
        if (!f.met) {
          this.toast(TOAST2.fittingDark, 4);
          if (this.now - this.fittingDeniedAt > 12) { this.fittingDeniedAt = this.now; this.talk.overlap('l2_unit_fitting_denied', { name: 'DOOR', at: V(10, 1.6, -34) }); }
        } else {
          this.toast(TOAST2.fittingWait, 4);
          if (this.once('fitting_wait')) void this.say('l2_tomas_fitting_wait', { next: true, ttl: 6 });
        }
        break;
      case 'd2_relay':
        if (!f.pass) { this.toast(TOAST2.needPass, 4); this.bark('l2_tomas_bark_relay_locked', 60); }
        else if (f.power && !f.relayClear) this.toast(TOAST2.arcInterlock, 4);
        break;
      case 'd2_spine': case 'd2_bulkhead_s': case 'd2_booth': case 'd2_bulkhead_n':
        if (!f.power) { this.toast(TOAST2.noPower, 4); if (DEAD_DOORS.includes(id)) this.bark('l2_tomas_bark_spine_dead', 90); }
        else if (id === 'd2_booth') this.toast(TOAST2.cycling, 4);
        else this.toast(TOAST2.sealed, 4);
        break;
      case 'd2_booth_hall': this.toast(f.power ? TOAST2.cycling : TOAST2.interlock, 4); break;
      case 'd2_gate': this.toast(TOAST2.gate, 4); break;
      case 'd2_mouth': this.toast(f.power ? TOAST2.mouthLoading : TOAST2.mouthHeld, 4); break;
      case 'd2_exit': this.toast(TOAST2.exitOneWay, 4); break;
      case 'd2_core': if (!f.foremanDead) this.toast(TOAST2.coreHeld, 4); break;
      case 'd2_lift': if (!f.choice) this.toast(TOAST2.liftHeld, 4); break;
    }
  }

  private onDied(): void {
    const ctx = this.ctx;
    if (ctx.state === 'ended' || ctx.state === 'dead') return;
    ctx.setState('dead');
    this.talk.shutUp();
    for (const l of this.loops.splice(0)) { try { l.stop(1.5); } catch { /* ignore */ } }
    this.ui.closeNote?.();
    this.ui.setHudVisible(false);
    ctx.ui.showDeath().catch((e) => console.error('[story] showDeath failed', e));
  }

  /** `?nostory=1`: no beats; line held, gate open, mouth and exit shut, every other door unlocked (level table). */
  openEverything(): void {
    applyPhase(this.ctx, 'nostory', true);
    this.w.machine('l2_line', 'off');
  }

  // ───────────────────────────────────────────────────────────── review / debug

  fire(name: string): { x: number; y: number; z: number } | null {
    if ((VIGNETTES_L2 as readonly string[]).includes(name)) return this.w.vignette(name) ? { x: 0, y: 0, z: 0 } : null;
    return null;
  }

  /** Test hook: end quiet windows; `fast` also shortens every line and scripted pause. */
  hurry(fast?: boolean): void {
    this.quietUntil = 0;
    this.lastCombat = -1e9;
    this.backlogHoldUntil = 0;
    if (fast !== undefined) this.talk.fast = fast;
  }

  get debugState() {
    const pos = (a: { position: THREE.Vector3 } | null) => (a ? [a.position.x, a.position.y, a.position.z].map((v) => +v.toFixed(2)) : null);
    return {
      level: 2, beats: [...this.prog.beats], quietFor: Math.max(0, this.quietUntil - this.now), note: this.noteId,
      flags: { ...this.f }, actors: this.actors.size, mood: this.director.mood, speaking: this.talk.speaking, talking: this.talk.busy,
      phase: this.phase, phaseApplied: this.phaseApplied, now: +this.now.toFixed(2), t: { ...this.marks },
      tomas: pos(this.tomas), tomasSpot: this.tomasSpot, tomasPose: this.tomasPose, held: this.held,
      escorts: this.escorts.map((a) => pos(a)), ghost: this.ghost ? { at: pos(this.ghost), mode: this.ghostState() } : null,
      rigPattern: !!this.holoTech, heard: [...this.talk.heard], lines: this.talk.log.length,
      restoredFrom: this.restoredFrom, checkpoint: this.lastCheckpoint, pendingCheckpoint: this.pendingCheckpoint,
      checkpoints: [...this.prog.checkpoints], calm: this.started && this.calm(),
      triggered: [...this.prog.triggered], cleared: [...this.prog.cleared], power: this.f.power,
    };
  }
}
