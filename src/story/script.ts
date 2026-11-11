/**
 * The Sublevel 3 script — REVISION 2 (docs/DESIGN.md): a slow burn. The first minutes hold no combat at
 * all; dread comes from vignettes, puppet "actors", PA lines, light and sound. Then the android in the
 * junction stands up.
 *
 * Structure: every beat is its own "thread" (async function) waiting on its own condition, so play in
 * any order can never stall the flow. Conditions combine level trigger events with room/position polls,
 * every lock has a guaranteed unlock path, and everything the level / enemies modules add in revision 2
 * (`level.vignette`, `enemies.actor`, new rooms, triggers, interactables) is optional at runtime.
 *
 * Pacing rules implemented by `cue()`:
 *   - one event at a time: after each scare a quiet window (10–30 s) must pass before the next;
 *   - never while a note is open, never during (or right after) combat;
 *   - scares are gated on where the player is AND where they are looking, so they are actually seen.
 */
import * as THREE from 'three';
import type { EnemyActor, GameContext, LoopHandle, PickupKind } from '../core/types';
import type { UIInternal } from '../ui/types';
import type { Sequencer } from './sequencer';
import type { MusicDirector } from './director';
import type { CameraRig } from './camera';
import { ALL_SCREENS, type World } from './world';
import {
  CHOIR, ELEVATOR_VOICE, FRAGMENTS, OBJECTIVES, PROMPTS, SCREENS, TAG_ID, TOASTS, UNIT_LINES, WAKE_PUMP,
  type Fragment, type Line,
} from './text';

interface Hooks { setObjective(text: string): void }

const EMERGENCY_GROUPS = ['corr_a_emergency', 'fab_emergency', 'gen_emergency', 'lobby_emergency'];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

/** Where the corridor meets the junction (the silhouette crosses just beyond it). */
const JUNCTION_END = V(0, 1.5, -16.5);
/** Open floor at the far end of the fab hall with long sightlines from the entrance side (probed). */
const FAB_FIGURE_SPOTS = [V(-5, 0, -44), V(5, 0, -44.5), V(-10.5, 0, -44), V(0, 0, -49)];
/** Every scripted vignette id (DESIGN.md) — used by the `--scares` review mode. */
export const VIGNETTES = [
  'med_monitor_spike', 'med_arm_drop', 'corr_lights_chase', 'quarters_locker_bang', 'quarters_curtain',
  'sec_vent_drop', 'storage_canister', 'airlock_cycle', 'fab_conveyor_step', 'fab_arms_watch', 'gen_ripple',
  'pump_knock', 'pump_bubbles', 'lobby_tarp', 'elev_gate_rattle', 'gen_lever_throw',
] as const;
export const ACTOR_SCARES = ['corr_silhouette', 'quarters_figure', 'fab_skitter', 'fab_figure'] as const;

export class Script {
  // ── facts (set by persistent listeners; scripts poll them) ──
  private woke = false;
  private started = false;
  private triggerAt = new Map<string, number>();
  private insideTrig = new Set<string>();
  private lastInElevator = -1e9;
  private cleared = new Map<string, number>();
  private pickedUp = new Set<PickupKind>();
  private closedAt = new Map<string, number>();
  private roomTime = new Map<string, number>();
  private visited = new Set<string>();
  private sawFabHold = false;
  private consoleUsed = false;
  private armed = false;
  private huskWoke = false;
  private fabRevealed = false;
  private lockoutFound = false;
  private keyTaken = false;
  private power = false;
  private elevatorReady = false;
  private descending = false;
  private armsWatching = false;
  private toastCooldown = new Map<string, number>();
  private objectiveTimer = 0;
  private beats = new Set<string>();
  private alarm: LoopHandle | null = null;
  private elevLoop: LoopHandle | null = null;

  // ── pacing ──
  /** Script time before which no further scare may fire. */
  private quietUntil = 0;
  private lastCombat = -1e9;
  /** While set, music 'silence' may be held even with an active enemy (the first android standing up). */
  private silenceHold = -1e9;
  private noteId: string | null = null;
  private noteClosedReal = -1e9;
  private lastNoteId: string | null = null;
  private legacyReading = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private actors = new Set<EnemyActor>();

  constructor(
    private ctx: GameContext,
    private seq: Sequencer,
    private director: MusicDirector,
    private rig: CameraRig,
    private w: World,
    private logs: Set<string>,
    private hooks: Hooks,
  ) {
    const ev = ctx.events;
    ev.on('trigger:enter', (e) => { this.triggerAt.set(e.id, this.seq.time); this.insideTrig.add(e.id); });
    ev.on('trigger:exit', (e) => { this.insideTrig.delete(e.id); });
    ev.on('enemy:group-cleared', (e) => { if (!this.cleared.has(e.group)) this.cleared.set(e.group, this.seq.time); });
    ev.on('pickup', (e) => { this.pickedUp.add(e.kind); });
    ev.on('interact', (e) => this.onInteract(e.id));
    ev.on('door:denied', (e) => this.onDenied(e.id));
    ev.on('player:died', () => this.onDied());
    ev.on('weapon:empty', () => this.reloadHint());
    ev.on('weapon:fired', (e) => {
      try { if (this.ctx.player.weapons[e.weapon].clip <= 3) this.reloadHint(); } catch { /* ignore */ }
    });
  }

  // ───────────────────────────────────────────────────────────── small helpers

  private get ui(): UIInternal { return this.ctx.ui as UIInternal; }
  private get now(): number { return this.seq.time; }
  private loop(id: string, volume: number): LoopHandle | null {
    try { return this.ctx.audio.loop(id, { volume }); } catch { return null; }
  }
  private wait(s: number) { return this.seq.wait(s); }
  private until(p: () => boolean) { return this.seq.waitUntil(p); }
  /** `until(p)` with a timeout; resolves true when `p` became true. */
  private async untilOr(p: () => boolean, seconds: number): Promise<boolean> {
    const t0 = this.now;
    let ok = false;
    await this.until(() => (ok = p()) || this.now - t0 >= seconds);
    return ok;
  }

  private beat(id: string): boolean {
    if (this.beats.has(id)) return false;
    this.beats.add(id);
    if (this.ctx.debug.verbose) console.log(`[story] beat ${id} @${this.now.toFixed(1)}s`);
    this.ctx.events.emit('story:beat', { id });
    return true;
  }

  /** Internal run-once marker (not a DESIGN.md beat, so nothing is emitted). */
  private once(id: string): boolean {
    if (this.beats.has('#' + id)) return false;
    this.beats.add('#' + id);
    if (this.ctx.debug.verbose) console.log(`[story] cue ${id} @${this.now.toFixed(1)}s`);
    return true;
  }

  private toast(text: string, cooldown = 0): void {
    const now = this.now;
    if (cooldown > 0 && (this.toastCooldown.get(text) ?? -1e9) > now - cooldown) return;
    this.toastCooldown.set(text, now);
    this.ctx.events.emit('story:toast', { text });
  }

  private sub(speaker: string, text: string, duration: number): void {
    this.ctx.events.emit('story:subtitle', { speaker, text, duration });
  }

  private voice(l: Line): void {
    try { this.ctx.audio.choirVoice(l.text, l.duration); } catch { /* ignore */ }
  }

  /** CHOIR in person — every speaker and screen at once: subtitle + voice + a digital shudder. */
  private async choir(lines: Line[], glitch = 0.4): Promise<void> {
    this.quiet(lines.reduce((t, l) => t + l.duration + 0.5, 6));
    for (const l of lines) {
      this.sub('CHOIR', l.text, l.duration);
      this.voice(l);
      if (glitch > 0) this.w.glitch(glitch, 0.25);
      await this.wait(l.duration + 0.5);
    }
  }

  /** CHOIR over the PA: a soft chime, a breath of silence, then one calm line. No glitching. */
  private async pa(lines: Line[]): Promise<void> {
    this.quiet(lines.reduce((t, l) => t + l.duration + 0.5, 7.5));
    this.w.play('pa_chime', undefined, 0.7);
    await this.wait(1.5);
    for (const l of lines) {
      this.sub('PA', l.text, l.duration);
      this.voice(l);
      await this.wait(l.duration + 0.5);
    }
  }

  /** A service unit's broken, polite mutter. */
  private unitLine(text: string, at: THREE.Vector3 | null): void {
    // Subtitle only: the units mutter `husk_whisper` on their own (enemies module).
    void at;
    this.sub('SERVICE UNIT', text, 3.6);
  }

  /** Scripted head turn (drives player yaw/pitch directly; player.update applies them to the camera). */
  private look(point: THREE.Vector3, seconds: number, from?: THREE.Vector3): Promise<void> {
    const p = this.ctx.player;
    const eye = from ?? p.eye;
    const dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z;
    const yaw1 = Math.atan2(-dx, -dz);
    const pitch1 = Math.atan2(dy, Math.hypot(dx, dz));
    const yaw0 = p.yaw, pitch0 = p.pitch;
    let dyaw = yaw1 - yaw0;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const t0 = this.now;
    return this.until(() => {
      const k = Math.min(1, (this.now - t0) / Math.max(0.01, seconds));
      const e = k * k * (3 - 2 * k);
      p.yaw = yaw0 + dyaw * e;
      p.pitch = pitch0 + (pitch1 - pitch0) * e;
      return k >= 1;
    });
  }

  private entered(trigger: string, since = -Infinity): boolean {
    const t = this.triggerAt.get(trigger);
    return t !== undefined && t >= since;
  }

  private inRoom(room: string): boolean { return this.w.room() === room; }
  private get pos(): THREE.Vector3 { return this.ctx.player.position; }

  private groupDone(g: string, since: number, minDelay = 4): boolean {
    if (this.cleared.has(g)) return true;
    return this.now - since > minDelay && this.w.alive(g) === 0;
  }

  private ownsPistol(): boolean {
    try { return !!this.ctx.player.weapons.pistol?.owned; } catch { return false; }
  }

  private hasKey(): boolean {
    return this.pickedUp.has('keycard') || this.w.hasKey();
  }

  // ───────────────────────────────────────────────────────────── gaze helpers

  /** Angle (radians) between the view direction and the direction to `point`. */
  private angleTo(point: THREE.Vector3): number {
    const p = this.ctx.player;
    const d = this.tmp.copy(point).sub(p.eye);
    const len = d.length();
    if (len < 1e-3) return 0;
    return Math.acos(THREE.MathUtils.clamp(d.dot(p.forward) / len, -1, 1));
  }

  private los(point: THREE.Vector3): boolean {
    try { return this.ctx.physics.lineOfSight(this.ctx.player.eye, point); } catch { return true; }
  }

  /** The player is facing `point` (within `coneDeg` of the view axis) and, optionally, nothing static is in the way. */
  isLookingAt(point: THREE.Vector3, coneDeg = 25, needLos = false): boolean {
    return this.angleTo(point) <= coneDeg * DEG && (!needLos || this.los(point));
  }

  /** `point` is off-screen (outside `coneDeg`, default wider than the view frustum) or hidden behind geometry. */
  notLookingAt(point: THREE.Vector3, coneDeg = 64): boolean {
    return this.angleTo(point) > coneDeg * DEG || !this.los(point);
  }

  /** Resolves on the first frame `point` is off-screen/occluded (true), or after `timeout` seconds (false). */
  waitUntilLookingAway(point: THREE.Vector3, coneDeg = 64, timeout = 1e9): Promise<boolean> {
    return this.untilOr(() => this.notLookingAt(point, coneDeg), timeout);
  }

  private distTo(point: THREE.Vector3): number {
    const p = this.pos;
    return Math.hypot(p.x - point.x, p.z - point.z);
  }

  // ───────────────────────────────────────────────────────────── pacing

  private get noteOpen(): boolean {
    if (this.legacyReading) return true;
    try { return !!this.ui.noteOpen; } catch { return false; }
  }

  /** Nothing else is competing for the player's attention. */
  private free(): boolean {
    return this.ctx.state === 'playing' && !this.noteOpen && this.w.active() === 0 && this.now - this.lastCombat > 5;
  }

  /** Reserve `seconds` of quiet after an event. */
  private quiet(seconds: number): void {
    this.quietUntil = Math.max(this.quietUntil, this.now + seconds);
  }

  /**
   * Wait for the right moment for a scare: `where()` holds, the player is free (no note, no combat) and
   * the quiet window after the previous event has passed — all on the same frame. Resolves false if
   * `expire()` becomes true first (the moment has passed for good).
   */
  private async cue(where: () => boolean, expire?: () => boolean): Promise<boolean> {
    let ok = false;
    await this.until(() => {
      if (expire?.()) return true;
      ok = this.now >= this.quietUntil && this.free() && where();
      return ok;
    });
    return ok;
  }

  /** Make a figure disappear: silently if unseen, otherwise inside a quarter-second of darkness. */
  private async vanish(a: EnemyActor | null, lightGroup: string): Promise<void> {
    if (!a) return;
    this.actors.delete(a);
    let head: THREE.Vector3;
    try { head = a.position.clone().setY(a.position.y + 1.5); } catch { this.w.removeActor(a); return; }
    if (this.notLookingAt(head, 62)) { this.w.removeActor(a); return; }
    const restore = this.w.blackout(lightGroup);
    this.w.play('spark_zap', head, 0.35);
    await this.wait(0.14);
    this.w.removeActor(a);
    await this.wait(0.2);
    restore();
  }

  private actor(type: 'husk' | 'skitter', position: THREE.Vector3, yaw: number, pose?: string): EnemyActor | null {
    const a = this.w.actor(type, position, yaw, pose);
    if (a) this.actors.add(a);
    return a;
  }

  private dropActor(a: EnemyActor | null): void {
    if (!a) return;
    this.actors.delete(a);
    this.w.removeActor(a);
  }

  private armsWatch(on: boolean): void {
    if (this.armsWatching === on) return;
    // `fab_arms_watch` is a toggle on the level side; only flip our flag if the call went through.
    if (this.w.vignette('fab_arms_watch')) this.armsWatching = on;
  }

  // ───────────────────────────────────────────────────────────── per-frame

  tick(dt: number): void {
    if (!this.started) return;
    if (this.w.active() > 0) this.lastCombat = this.now;
    this.objectiveTimer -= dt;
    if (this.objectiveTimer > 0) return;
    const step = 0.2 - this.objectiveTimer;
    this.objectiveTimer = 0.2;
    const room = this.w.room();
    if (room) {
      this.visited.add(room);
      if (this.ctx.state === 'playing') this.roomTime.set(room, (this.roomTime.get(room) ?? 0) + step);
    }
    if (this.entered('t_gen')) this.visited.add('gen');
    if (room === 'elevator' || this.insideTrig.has('t_elevator')) this.lastInElevator = this.now;

    // Music 'silence' overrides the audio module's automatic combat switch — never let it outlast a fight.
    if (this.director.mood === 'silence' && this.w.active() > 0 && this.now > this.silenceHold && !this.descending) {
      this.director.setMood(this.fabRevealed ? 'tension' : 'ambient');
    }

    // The breaker lever: prompt follows what the player knows; it stays usable until power is back.
    if (!this.power) {
      const key = this.hasKey();
      this.w.setPrompt('gen_lever', key ? PROMPTS.leverKey : this.lockoutFound ? PROMPTS.leverLocked : PROMPTS.leverTag);
      this.w.setInteractable('gen_lever', true);
      this.w.setInteractable('log_gen', false);
    }
    this.hooks.setObjective(this.computeObjective());
  }

  /** The objective is always recomputed from state, never pushed by a beat. */
  private computeObjective(): string {
    if (!this.woke || this.descending) return OBJECTIVES.none;
    if (this.power) {
      if (this.elevatorReady && this.now - this.lastInElevator < 1.5) return OBJECTIVES.callElevator;
      return OBJECTIVES.reachElevator;
    }
    if (this.hasKey()) return this.inRoom('gen') ? OBJECTIVES.closeBreaker : OBJECTIVES.returnKey;
    if (this.lockoutFound) return this.inRoom('pump') ? OBJECTIVES.findHale : OBJECTIVES.findKey;
    if (this.fabRevealed) return this.visited.has('gen') ? OBJECTIVES.throwBreaker : OBJECTIVES.findPower;
    if (this.consoleUsed) return this.armed ? OBJECTIVES.enterFab : OBJECTIVES.takePistol;
    if (this.sawFabHold) return this.inRoom('sec') ? OBJECTIVES.useConsole : OBJECTIVES.checkSecurity;
    return OBJECTIVES.findSomeone;
  }

  // ───────────────────────────────────────────────────────────── flow

  /** Enforce initial lock states and start every beat thread. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const w = this.w;
    w.unlock('d_storage');
    w.lock('d_fab_outer');
    w.lock('d_lobby');
    w.lock('d_elev');
    if (w.hasDoor('d_pump')) w.lock('d_pump');
    w.setInteractable('elev_button', false);
    w.setInteractable('log_gen', false);
    this.director.setMood('silence');

    const S = (n: string, f: () => Promise<unknown>) => this.seq.spawn(n, f);
    S('med', () => this.medScares());
    S('pa_wake', () => this.paWake());
    S('corridor', () => this.corridorFirstDark());
    S('quarters', () => this.quarters());
    S('quarters_figure', () => this.quartersFigure());
    S('junction_hold', () => this.junctionHold());
    S('armed', () => this.armedAndVent());
    S('husk', () => this.huskWakes());
    S('storage', () => this.storage());
    S('airlock', () => this.airlock());
    S('fab_reveal', () => this.fabReveal());
    S('fab_figure', () => this.fabFigure());
    S('fab_first', () => this.fabFirstFight());
    S('gen', () => this.genRipple());
    S('fab_cross', () => this.fabCross());
    S('pump', () => this.pumpEnter());
    S('pump_skitter', () => this.pumpFirstSkitter());
    S('key', () => this.keyTakenBeat());
    S('fab_return', () => this.fabReturn());
    S('lobby', () => this.lobby());
    S('elev_gate', () => this.elevatorGate());
    S('elevator_fallback', () => this.elevatorFallback());
  }

  /** Opening: lying on the bed, the hold is released, eyes open. */
  async wakeCutscene(short: boolean): Promise<void> {
    const ctx = this.ctx, p = ctx.player, ui = this.ui, w = this.w;
    ui.setHudVisible(false);
    w.fade(1, 0);
    ui.eyelids?.(0, 0);
    ui.blur?.(16, 0);
    ctx.setState('cutscene');
    p.controlsEnabled = false;
    const sp = ctx.level.spawn;
    p.teleport(sp.position.clone(), sp.yaw, 1.32);
    this.rig.wake = { rise: 0, roll: 0.2, lying: this.rig.lyingPoint() };
    this.beat('wake');
    this.director.setMood('silence');
    await this.wait(0.05);
    ui.blackout?.(false, short ? 0.6 : 1.6);

    const monitor = (() => { try { return ctx.audio.loop('monitor_hum', { volume: 0.3 }); } catch { return null; } })();
    let blipping = true;
    this.seq.spawn('blips', async () => {
      // A flat, patient alarm from the infusion pump.
      for (let i = 0; i < 10 && blipping; i++) { w.play('alarm_blip', undefined, 0.28); await this.wait(1.4); }
    });

    if (!short) {
      await this.wait(1.4);
      this.sub('INFUSION PUMP', WAKE_PUMP.text, WAKE_PUMP.duration);
      w.fade(0.2, 1.8); ui.eyelids?.(0.28, 1.6);
      await this.wait(1.9);
      ui.eyelids?.(0, 0.22);
      await this.wait(0.7);
      ui.eyelids?.(0.62, 1.4); ui.blur?.(8, 2.4); w.fade(0.08, 1.5);
      await this.wait(2.0);
      ui.eyelids?.(0.12, 0.18);
      await this.wait(0.32);
    } else {
      await this.wait(0.6);
    }
    ui.eyelids?.(1, 1.0); ui.blur?.(0, short ? 1.5 : 3.2); w.fade(0, 1.6);
    await this.wait(short ? 0.4 : 1.2);

    // Sit up and look toward the door.
    const door = w.objectPos('med_terminal', new THREE.Vector3(0, 1.45, 0));
    door.y = Math.max(1.2, Math.min(1.8, door.y));
    const looking = this.look(door, short ? 2.0 : 3.2, sp.position.clone().setY(1.65));
    const rise = short ? 1.6 : 2.8;
    const t0 = this.now;
    await this.until(() => {
      const k = Math.min(1, (this.now - t0) / rise);
      if (this.rig.wake) this.rig.wake.rise = k;
      return k >= 1;
    });
    await looking;
    this.rig.wake = null;
    blipping = false;
    monitor?.setVolume(0.1, 3);
    await this.wait(0.3);

    p.controlsEnabled = true;
    ctx.setState('playing');
    this.afterWake(false);
  }

  /** Controls on. Also the autostart entry point. Only ONE hint here; the rest arrive in context. */
  afterWake(skipHints: boolean): void {
    this.woke = true;
    this.ctx.ui.setHudVisible(true);
    this.director.setMood('silence');
    this.quiet(6);
    this.hooks.setObjective(this.computeObjective());
    if (skipHints) return;
    this.seq.spawn('hints', async () => {
      await this.wait(2.5);
      // Only if the player hasn't already worked it out.
      const sp = this.ctx.level.spawn.position;
      if (this.distTo(sp) < 0.6) this.toast(TOASTS.move);
    });
  }

  private reloadHint(): void {
    if (!this.started || !this.once('hint_reload')) return;
    this.toast(TOASTS.reload);
  }

  // ───────────────────────────────────────────────────────────── act 1 — nobody is here

  /** Medical: the flat monitor shows two heartbeats; the arm slides off the gurney as you pass it. */
  private async medScares(): Promise<void> {
    await this.until(() => this.woke);
    const left = () => this.visited.has('junction') || (this.inRoom('corr_a') && this.pos.z < -3);
    await this.wait(5);
    if (await this.cue(() => this.inRoom('med'), left)) {
      if (this.once('med_monitor_spike')) { this.w.vignette('med_monitor_spike'); this.quiet(14); }
    }
    // Passing the gurney on the way to the door.
    if (await this.cue(() => this.inRoom('med') && this.pos.z < 4.2 && this.pos.z > 0.6, left)) {
      if (this.once('med_arm_drop')) { this.w.vignette('med_arm_drop'); this.quiet(12); }
    }
  }

  /** "Good morning, Technician Reyes." — right after the terminal says who authorised the hold. */
  private async paWake(): Promise<void> {
    await this.until(() => this.woke && (this.closedAt.has('log_med') || this.entered('t_med_exit') || this.inRoom('corr_a')));
    if (this.closedAt.has('log_med')) await this.wait(1.6);
    else await this.wait(0.8);
    await this.until(() => !this.noteOpen && this.ctx.state === 'playing');
    if (!this.once('pa_wake')) return;
    await this.pa(CHOIR.paWake);
    this.quiet(7);
    await this.wait(2);
    this.director.setMood('ambient');
  }

  /** Corridor: the lights die one by one toward you; something walks across the far end. */
  private async corridorFirstDark(): Promise<void> {
    await this.until(() => this.woke && this.inRoom('corr_a'));
    this.ui.setTorchHint?.(true);
    const gone = () => this.huskWoke || this.fabRevealed;
    // Facing the junction end from more than 8 m away.
    const ok = await this.cue(
      () => this.inRoom('corr_a') && this.pos.z > -7.2 && this.pos.z < -0.8 && this.isLookingAt(JUNCTION_END, 26),
      gone,
    );
    if (!ok || !this.beat('corr_first_dark')) return;
    this.quiet(30);
    const prevMood = this.director.mood;
    this.director.setMood('silence');
    this.seq.spawn('torch_hint', async () => {
      await this.wait(1.8);
      if (!this.ctx.player.flashlightOn) this.toast(TOASTS.flashlight);
    });
    await this.corrSilhouette(true);
    await this.wait(6);
    if (this.director.mood === 'silence') this.director.setMood(prevMood === 'silence' ? 'ambient' : prevMood);
  }

  /** The lights chase + the figure crossing the junction (also used by the review mode). */
  private async corrSilhouette(withLights: boolean): Promise<void> {
    const w = this.w;
    let restore: (() => void) | null = null;
    if (withLights && !w.vignette('corr_lights_chase')) {
      // Fallback (level without vignettes): the whole corridor drops out for three seconds.
      w.play('power_down', undefined, 0.5);
      restore = w.blackout('corr_a');
    }
    await this.wait(0.5);
    // From the Security side to the Storage side, between the two doors — it never comes this way.
    const a = this.actor('husk', V(-2.7, 0, -17.2), -Math.PI / 2, 'idle');
    if (a) {
      try { a.setEyes(false); } catch { /* ignore */ }
      const walk = a.moveTo(V(2.7, 0, -17.2), 1.3).catch(() => undefined);
      // Half-way across, its head turns toward you and the eyes come on. It keeps walking.
      this.seq.spawn('silhouette_look', async () => {
        await this.wait(1.7);
        if (!this.actors.has(a)) return;
        try { a.lookAt(this.ctx.player.eye); a.setEyes(true); } catch { /* ignore */ }
      });
      // Arrived, timed out, or the player ran at it.
      await Promise.race([walk, this.wait(6), this.until(() => this.pos.z < -11.5)]);
      await this.vanish(a, 'junction');
    } else {
      await this.wait(2.6);
      w.play('husk_step', V(0, 0, -17), 0.7);
    }
    await this.wait(0.8);
    restore?.();
  }

  /** Crew quarters (optional, no enemies ever): notes, the locker, the curtain. */
  private async quarters(): Promise<void> {
    await this.until(() => this.woke && (this.inRoom('quarters') || this.entered('t_quarters')));
    this.beat('quarters');
    const gone = () => this.fabRevealed;
    const inQ = () => this.inRoom('quarters');

    this.seq.spawn('q_locker', async () => {
      // After the badges note — or after a good while in the room without reading it.
      await this.until(() => this.closedAt.has('note_quarters_badges') || (this.roomTime.get('quarters') ?? 0) > 40 || gone());
      await this.wait(1.4);
      if (!(await this.cue(inQ, gone)) || !this.once('quarters_locker_bang')) return;
      this.w.vignette('quarters_locker_bang');
      this.quiet(26);
    });

    this.seq.spawn('q_curtain', async () => {
      // "I'm not opening the curtain." — it closes by itself, behind you.
      await this.until(() => this.closedAt.has('note_quarters_bunk') || (this.roomTime.get('quarters') ?? 0) > 75 || gone());
      await this.wait(1.2);
      const curtain = this.w.objectPos('quarters_curtain', V(1e6, 0, 0));
      const known = curtain.x < 1e5;
      const t0 = this.now;
      const behind = () => inQ() && (!known || this.notLookingAt(curtain, 58) || this.now - t0 > 25);
      if (!(await this.cue(behind, gone)) || !this.once('quarters_curtain')) return;
      this.w.vignette('quarters_curtain');
      this.quiet(24);
    });

    await this.wait(3);
    if (await this.cue(inQ, gone)) {
      this.w.play('breath_far', this.quartersFigureSpot().setY(1.4), 0.5);
      this.quiet(8);
    }
  }

  /** The corner of the canteen where a unit stands with its face to the wall. */
  private quartersFigureSpot(): THREE.Vector3 {
    const marker = this.w.objectPos('quarters_figure', V(1e6, 0, 0));
    if (marker.x < 1e5) return marker.setY(0);
    // Room corner nearest the canteen table, away from the door (east wall, z = -6.5).
    const table = this.w.interactablePos('note_quarters_badges') ?? V(-8.2, 0, -4.2);
    const cx = table.x < -5.5 ? -8.85 : -2.15;
    const cz = table.z > -7 ? -3.65 : -10.35;
    return V(cx, 0, cz);
  }

  /**
   * Quarters: a unit stands in the canteen corner, facing the wall, eyes dark. Once the player has
   * really seen it, it is removed the moment it is off-screen. Come too close and the light blinks.
   */
  private async quartersFigure(): Promise<void> {
    if (!this.w.hasRoom('quarters')) return;
    await this.until(() => this.woke && (this.inRoom('corr_a') || this.inRoom('quarters')));
    const gone = () => this.fabRevealed || this.huskWoke;
    const spot = this.quartersFigureSpot();
    const head = spot.clone().setY(1.55);
    // Face the nearer wall pair's corner.
    const yaw = Math.atan2(-(spot.x < -5.5 ? -1 : 1), -(spot.z > -7 ? 1 : -1));
    const a = this.actor('husk', spot, yaw, 'idle');
    if (!a) return;
    try { a.setEyes(false); } catch { /* ignore */ }
    let seen = 0, last = this.now, close = false;
    await this.until(() => {
      const dt = this.now - last; last = this.now;
      if (gone()) return true;
      if (!this.inRoom('quarters')) return false;
      if (this.isLookingAt(head, 20, true)) seen += dt;
      close = this.distTo(spot) < 3.3;
      return seen > 0.8 || close;
    });
    if (close && !this.notLookingAt(head, 62)) {
      await this.vanish(a, 'quarters');
    } else {
      await this.waitUntilLookingAway(head, 64);
      this.dropActor(a);
    }
    if (gone()) return;
    this.once('quarters_figure');
    this.quiet(18);
    await this.wait(1.5);
    if (this.inRoom('quarters')) this.w.play('breath_far', head, 0.35);
  }

  /** The fab door refuses: CHOIR, helpfully, says where the hold can be lifted. */
  private async junctionHold(): Promise<void> {
    await this.until(() => this.woke && this.sawFabHold);
    await this.wait(1.6);
    if (!(await this.cue(() => this.inRoom('junction') || this.inRoom('corr_a'), () => this.consoleUsed))) return;
    if (!this.once('pa_hold')) return;
    this.quiet(12);
    await this.pa(CHOIR.paHold);
  }

  // ───────────────────────────────────────────────────────────── act 2 — they took them

  private onSecConsole(): void {
    const f = FRAGMENTS.term_sec_unlock;
    this.openNote('term_sec_unlock', f, false);
    if (this.consoleUsed) return;
    this.consoleUsed = true;
    this.beat('hold_released');
    const w = this.w;
    w.unlock('d_fab_outer');
    w.screen('sec_console', 'terminal_idle', SCREENS.secConsoleDone);
    w.play('door_unlock', V(0, 1.4, -20), 0.6);
    this.seq.spawn('hold_toast', async () => {
      await this.until(() => !this.noteOpen);
      await this.wait(0.5);
      this.toast(TOASTS.holdReleased);
    });
  }

  /** The pistol — then the vent grille drops, and nothing comes out. */
  private async armedAndVent(): Promise<void> {
    // Pistol taken from the locker — or (debug give=all) already owned when walking into Security.
    await this.until(() => this.woke && (this.pickedUp.has('pistol') || (this.ownsPistol() && (this.inRoom('sec') || this.entered('t_sec')))));
    this.armed = true;
    this.beat('armed');
    this.ui.setTorchHint?.(false);
    const w = this.w;
    const inSec = () => this.inRoom('sec');
    if (!this.huskWoke) this.director.setMood('silence');
    await this.wait(4.5);
    if (await this.cue(inSec, () => !inSec() || this.huskWoke)) {
      if (this.once('sec_vent_drop')) {
        if (!w.vignette('sec_vent_drop')) {
          const vent = w.objectPos('sec_vent', V(-7, 3.1, -17));
          w.play('metal_clang', vent, 0.9);
          w.shake(0.12);
        }
        this.quiet(16);
        // Nothing comes out. Let that sit.
        await this.wait(8);
        if (inSec() && !this.huskWoke) {
          w.screen('sec_monitor_2', 'static');
          await this.wait(0.6);
          w.screen('sec_monitor_3', 'terminal_alert', SCREENS.secMotion);
          w.play('terminal_beep', w.objectPos('sec_console', V(-9.9, 1.2, -17)), 0.5);
        }
      }
    }
    await this.wait(2);
    if (this.director.mood === 'silence' && !this.huskWoke) this.director.setMood('ambient');
  }

  /** FIRST ENEMY: armed, back in the junction — the slumped android stands up. */
  private async huskWakes(): Promise<void> {
    await this.until(() => this.armed);
    const t0 = this.now;
    await this.until(() =>
      (this.now - t0 > 5 && this.inRoom('junction') && !this.noteOpen && this.ctx.state === 'playing')
      || this.inRoom('airlock') || this.fabRevealed);
    this.huskWoke = true;
    if (!this.beat('husk_wakes')) return;
    const w = this.w;
    const spawn = w.spawns('g_junction')[0]?.position ?? null;
    // Music stays down until it is on its feet.
    this.director.setMood('silence');
    this.silenceHold = this.now + 7;
    w.wakeGroup('g_junction');
    const since = this.now;
    await this.wait(1.4);
    this.unitLine(UNIT_LINES.junction, spawn);
    await this.untilOr(() => {
      try { return this.ctx.enemies.all.some((e) => e.group === 'g_junction' && (e.state === 'chase' || e.state === 'attack')); } catch { return true; }
    }, 5);
    this.silenceHold = -1e9;
    this.director.setMood(this.fabRevealed ? 'tension' : 'ambient');

    await this.until(() => this.groupDone('g_junction', since, 6));
    this.quiet(8);
    await this.wait(6);
    if (!(await this.cue(() => true, () => this.fabRevealed)) || !this.once('pa_husk')) return;
    this.quiet(12);
    await this.pa(CHOIR.paHusk);
  }

  /** Storage (optional): Hale's plan on a clipboard; a canister tips off a shelf. */
  private async storage(): Promise<void> {
    await this.until(() => this.woke && (this.inRoom('storage') || this.entered('t_storage')));
    const inS = () => this.inRoom('storage');
    await this.wait(5);
    if (!(await this.cue(inS, () => this.power)) || !this.once('storage_canister')) return;
    this.w.vignette('storage_canister');
    this.quiet(20);
  }

  /** The decon lock cycles around you; a wet hand slaps the inner glass. */
  private async airlock(): Promise<void> {
    await this.until(() => this.woke && (this.inRoom('airlock') || this.entered('t_airlock')));
    await this.wait(0.9);
    if (!(await this.cue(() => this.inRoom('airlock'), () => this.fabRevealed)) || !this.once('airlock_cycle')) return;
    this.w.vignette('airlock_cycle');
    this.quiet(14);
  }

  // ───────────────────────────────────────────────────────────── act 3 — the hall

  private async fabReveal(): Promise<void> {
    await this.until(() => this.woke && (this.entered('t_fab_enter') || this.inRoom('fab')));
    this.fabRevealed = true;
    if (!this.beat('fab_reveal')) return;
    const w = this.w;
    this.director.setMood('tension');
    this.quiet(30);
    w.screen('fab_bigscreen', 'choir');
    await this.wait(1.6);
    // Far away, something small runs along the ceiling — only once the player is facing the hall.
    await this.untilOr(() => this.isLookingAt(V(0, 6, -40), 50), 5);
    void this.fabSkitter();
    await this.wait(5.5);
    await this.untilOr(() => this.free(), 12);
    w.glitch(0.5, 0.3);
    w.play('glitch', undefined, 0.4);
    await this.wait(0.8);
    await this.choir(CHOIR.fabReveal, 0.3);
    this.quiet(22);
  }

  private async fabSkitter(): Promise<void> {
    // Under the ceiling, close enough to read as a small dark shape with one red dot.
    const from = V(-9, 7.7, -38.5), to = V(9, 7.7, -40.5);
    const a = this.actor('skitter', from, -Math.PI / 2, 'ceiling');
    this.w.play('vent_scuttle', V(0, 7.5, -39.5), 0.5);
    if (!a) return;
    await Promise.race([a.moveTo(to).catch(() => undefined), this.wait(7)]);
    this.dropActor(a);
  }

  /**
   * Where the far figure stands: an open spot at the far end of the hall near a work light, picked so
   * there is a clear sightline from where the player is now (it must be seen), at least 13 m away.
   * Null when no candidate works from here.
   */
  private fabFigureSpot(): THREE.Vector3 | null {
    const marker = this.w.objectPos('fab_figure', V(1e6, 0, 0));
    if (marker.x < 1e5) return marker.setY(0);
    // In order of preference (nearest a work light first).
    for (const c of FAB_FIGURE_SPOTS) {
      if (this.distTo(c) <= 13) continue;
      if (!this.los(this.tmp2.set(c.x, 1.55, c.z)) || !this.los(this.tmp2.set(c.x, 0.5, c.z))) continue;
      return c.clone();
    }
    return null;
  }

  /** A unit stands motionless under a far work light. The lights blink. It is gone. */
  private async fabFigure(): Promise<void> {
    await this.until(() => this.fabRevealed);
    const gone = () => this.lockoutFound || this.power;
    let spot = V(0, 0, 0);
    const placed = await this.cue(() => {
      if (!this.inRoom('fab')) return false;
      const c = this.fabFigureSpot();
      if (!c) return false;
      spot = c;
      // Placed while the spot is outside the view (it is simply there when the player turns).
      return this.angleTo(this.tmp2.set(c.x, 1.5, c.z)) > 58 * DEG;
    }, gone);
    if (!placed) return;
    const head = spot.clone().setY(1.55);
    const a = this.actor('husk', spot, Math.atan2(-(this.pos.x - spot.x), -(this.pos.z - spot.z)), 'idle');
    if (!a) return;
    this.quiet(20);
    // The hall is dark: what the player finds is two motionless points of light at head height.
    try { a.setEyes(true); } catch { /* ignore */ }
    let seen = 0, last = this.now, near = false;
    const t0 = this.now;
    await this.until(() => {
      const dt = this.now - last; last = this.now;
      if (gone() || this.w.active() > 0) return true;
      if (this.isLookingAt(head, 16, true)) seen += dt;
      near = this.distTo(spot) < 9;
      return seen > 1.1 || near || this.now - t0 > 90;
    });
    if (seen > 1.1 && this.once('fab_figure')) {
      // Its head turns to you. Then the lights blink.
      try { a.lookAt(this.ctx.player.eye); } catch { /* ignore */ }
      await this.wait(0.7);
      await this.vanish(a, 'fab');
      this.quiet(22);
    } else if (near) {
      await this.vanish(a, 'fab');
    } else {
      await this.waitUntilLookingAway(head, 64, 20);
      await this.vanish(a, 'fab');
    }
  }

  /** The android at the bench stops working. */
  private async fabFirstFight(): Promise<void> {
    const bench = this.w.spawns('g_fab_first').find((s) => s.type === 'husk')?.position ?? V(-4.1, 0, -37.2);
    await this.until(() => this.fabRevealed && (
      this.entered('t_fab_mid') || (this.inRoom('fab') && (this.pos.z < -36 || this.distTo(bench) < 5.5)) || this.power));
    if (!this.beat('fab_first_fight')) return;
    this.w.wakeGroup('g_fab_first', 0.5);
    await this.wait(1.2);
    if (this.w.alive('g_fab_first') > 0) this.unitLine(UNIT_LINES.bench, bench);
  }

  private async genRipple(): Promise<void> {
    await this.until(() => this.woke && (this.inRoom('gen') || this.entered('t_gen')));
    await this.wait(2);
    if (!(await this.cue(() => this.inRoom('gen'), () => this.power)) || !this.once('gen_ripple')) return;
    this.w.vignette('gen_ripple');
    this.quiet(10);
  }

  // ───────────────────────────────────────────────────────────── act 4 — the lock-out

  /** The lever without the key: read the tag. Never throws it. */
  private onLeverLocked(): void {
    this.openNote(TAG_ID, FRAGMENTS[TAG_ID], true);
    if (this.lockoutFound) { this.toast(TOASTS.leverLocked, 6); return; }
    this.lockoutFound = true;
    this.beat('lockout_found');
    const w = this.w;
    w.unlock('d_pump');
    this.seq.spawn('lockout', async () => {
      await this.until(() => !this.noteOpen);
      // Guaranteed path: a level without the pump room / key pickup hands the key over here.
      if (!w.hasRoom('pump') || !w.pickupSpawn('keycard')) {
        await this.wait(2);
        try { this.ctx.player.addKey('keycard'); } catch { /* ignore */ }
        return;
      }
      await this.wait(2.2);
      if (!(await this.cue(() => true, () => this.hasKey())) || !this.once('pa_lockout')) return;
      this.quiet(12);
      await this.pa(CHOIR.paLockout);
    });
  }

  /** Crossing the hall to the pump room: the arms follow you; the conveyor steps when your back is turned. */
  private async fabCross(): Promise<void> {
    await this.until(() => this.lockoutFound && this.inRoom('fab'));
    if (this.power) return;
    this.armsWatch(true);
    const rack = this.w.spawns('g_fab_rack');
    const mid = V(0, 4.5, -38);
    if (rack.length) { mid.set(0, 0, 0); for (const s of rack) mid.add(s.position); mid.multiplyScalar(1 / rack.length); mid.y = 4.2; }
    const done = () => this.keyTaken || this.power;
    const ok = await this.cue(() => this.inRoom('fab') && this.pos.x < 4 && this.distTo(mid) > 3.5 && this.angleTo(mid) > 80 * DEG, done);
    if (ok && this.once('fab_conveyor_step')) {
      this.w.vignette('fab_conveyor_step');
      this.quiet(20);
    }
    await this.until(() => this.inRoom('pump') || this.power);
    this.armsWatch(false);
  }

  private async pumpEnter(): Promise<void> {
    await this.until(() => this.woke && (this.inRoom('pump') || this.entered('t_pump')));
    this.beat('pump_enter');
    // Wet, dark, quiet. Music drops back; combat switches itself.
    if (!this.power) this.director.setMood('ambient');
    const deep = () => this.beats.has('pump_first_skitter');
    await this.wait(3);
    if (!(await this.cue(() => this.inRoom('pump'), deep)) || !this.once('pump_knock')) return;
    this.w.vignette('pump_knock');
    this.quiet(12);
  }

  /** First skitter — late, alone, and telegraphed. */
  private async pumpFirstSkitter(): Promise<void> {
    await this.until(() => this.woke && (this.entered('t_pump_deep') || (this.inRoom('pump') && this.pos.x < -17)));
    if (!this.beat('pump_first_skitter')) return;
    this.w.spawnGroup('g_pump_a');
    const since = this.now;
    await this.until(() => this.groupDone('g_pump_a', since, 5));
    await this.wait(5);
    // Something large moves under the water while you stand over Hale.
    if (!(await this.cue(() => this.inRoom('pump'), () => this.beats.has('fab_return'))) || !this.once('pump_bubbles')) return;
    this.w.vignette('pump_bubbles');
    this.quiet(8);
  }

  /** Hale's key comes out of her fist — and the sump grate by the door lifts. */
  private async keyTakenBeat(): Promise<void> {
    await this.until(() => this.woke && this.hasKey());
    this.keyTaken = true;
    this.lockoutFound = true;
    this.w.unlock('d_pump');
    if (!this.beat('key_taken')) return;
    const w = this.w;
    if (!w.hasRoom('pump') || !this.visited.has('pump')) return;
    await this.wait(1.8);
    const grate = w.spawns('g_pump_b')[0]?.position ?? V(-13.5, 0, -38);
    w.play('water_slosh', grate, 0.9);
    await this.wait(0.7);
    w.spawnGroup('g_pump_b');
    const since = this.now;
    await this.until(() => this.groupDone('g_pump_b', since, 5) || this.now - since > 150);
    await this.wait(4);
    if (this.power) return;
    if ((await this.cue(() => true, () => this.power || this.beats.has('fab_return'))) && this.once('pa_key')) {
      this.quiet(10);
      await this.pa(CHOIR.paKey);
    }
    // Far off, through the wall: the line has moved one place while you were away.
    await this.wait(3);
    if (!this.power && !this.inRoom('fab')) { w.vignette('fab_conveyor_step'); this.once('fab_conveyor_step_2'); }
  }

  /** Back across the hall with the key. */
  private async fabReturn(): Promise<void> {
    await this.until(() => this.woke && this.hasKey() && this.inRoom('fab') && (this.pos.x > -9.5 || !this.w.hasRoom('pump')));
    if (this.power || !this.beat('fab_return')) return;
    const w = this.w;
    this.director.setMood('tension');
    this.armsWatch(true);
    if (!this.beats.has('#fab_conveyor_step_2')) { w.vignette('fab_conveyor_step'); this.once('fab_conveyor_step_2'); }
    await this.wait(1.2);
    const husk = w.spawns('g_fab_return').find((s) => s.type === 'husk')?.position ?? null;
    w.wakeGroup('g_fab_return', 0.6);
    await this.wait(1.4);
    if (w.alive('g_fab_return') > 0) this.unitLine(UNIT_LINES.returnHusk, husk);
    await this.wait(1.6);
    w.spawnGroup('g_fab_return');
  }

  // ───────────────────────────────────────────────────────────── act 5 — required

  private async powerRestored(): Promise<void> {
    if (this.power) return;
    this.power = true;
    const w = this.w;
    this.ui.closeNote?.();
    w.setInteractable('gen_lever', false);
    this.armsWatch(false);
    // The level animates the lever only on this call.
    w.vignette('gen_lever_throw');
    this.beat('power_restored');
    // Anything still dormant in the hall comes alive with the bus.
    if (!this.beats.has('fab_first_fight')) { this.beat('fab_first_fight'); w.wakeGroup('g_fab_first', 0.8); }
    w.shake(0.35);
    w.lights('gen', { enabled: true, flicker: 'none', intensityScale: 1 });
    w.machine('gen_turbine', 'active');
    this.toast(TOASTS.busLive);
    await this.wait(1.3);

    // The whole hall lights up: the hanging line in full view, for a moment.
    w.lights('fab', { enabled: true, flicker: 'none', intensityScale: 1 });
    w.lights('lobby', { enabled: true, flicker: 'fluorescent' });
    w.lights('elevator', { enabled: true, flicker: 'none' });
    w.screen('fab_bigscreen', 'terminal_idle', SCREENS.fabResume);
    w.screen('lobby_screen', 'terminal_idle', SCREENS.lobby);
    w.screen('elev_panel', 'terminal_idle', SCREENS.elevUp);
    w.play('metal_groan', V(0, 6, -38), 0.7);
    // Hale's terminal only wakes when the bus is live.
    w.screen('gen_terminal', 'terminal_idle', SCREENS.genBoot);
    const genHas = w.setInteractable('log_gen', true);
    w.play('terminal_beep', w.interactablePos('log_gen') ?? V(12.4, 1.4, -35), 0.8);
    await this.wait(3.0);

    this.beat('choir_speaks');
    for (const s of ALL_SCREENS) if (s !== 'gen_terminal') w.screen(s, 'choir');
    w.glitch(1, 0.8);
    const speaking = this.choir(CHOIR.powerRestored, 0.5);
    await this.wait(2.2);

    // Lights die, beacons spin, the line starts moving.
    w.play('power_down', undefined, 0.9);
    w.lights('fab', { enabled: false });
    await this.wait(0.6);
    for (const g of EMERGENCY_GROUPS) w.lights(g, { enabled: true, flicker: 'alarm' });
    w.machine('fab_arms', 'frenzy');
    w.machine('fab_conveyor', 'active');
    // The way out is open from this moment, whatever happens next.
    w.unlock('d_lobby');
    w.unlock('d_elev');
    w.setInteractable('elev_button', true);
    this.elevatorReady = true;
    this.beat('elevator_ready');

    // Hold the ambush until Hale's last entry has been read — or ~12 s have gone by.
    const t0 = this.now;
    const readingGen = () => this.noteOpen && this.noteId === 'log_gen';
    await this.until(() => {
      const t = this.now - t0;
      if (t > 26) return true;
      if (readingGen()) return false;
      if (this.closedAt.has('log_gen')) return this.now - (this.closedAt.get('log_gen') ?? 0) > 1.2;
      return t > (genHas ? 12 : 3) || !this.inRoom('gen');
    });
    await speaking;

    this.beat('fab_ambush');
    w.wakeGroup('g_fab_rack', 1.2);
    this.alarm = this.loop('alarm_loop', 0.55);
    this.seq.spawn('rack_line', async () => { await this.wait(2.5); if (this.inRoom('fab')) this.unitLine(UNIT_LINES.rack, null); });
    this.seq.spawn('sentry', async () => { await this.wait(8); w.spawnGroup('g_fab_sentry'); });
    this.director.setMood('tension');
  }

  /** The lobby: one of the tarps shifts. Then it gets up. */
  private async lobby(): Promise<void> {
    await this.until(() => this.power && (this.entered('t_lobby') || this.inRoom('lobby')));
    if (!this.once('lobby_ambush')) return;
    this.w.vignette('lobby_tarp');
    await this.wait(2.2);
    this.w.wakeGroup('g_lobby', 0.7);
  }

  /** Something hits the cage gate from the shaft side, once, before you touch the button. */
  private async elevatorGate(): Promise<void> {
    await this.until(() => this.elevatorReady && (this.inRoom('elevator') || this.insideTrig.has('t_elevator') || (this.inRoom('lobby') && this.pos.z < -56.2)));
    await this.wait(0.8);
    if (this.descending || this.noteOpen || !this.once('elev_gate_rattle')) return;
    this.w.vignette('elev_gate_rattle');
    this.w.shake(0.15);
  }

  /** If the level never registers `elev_button`, entering the cab after power still ends the level. */
  private async elevatorFallback(): Promise<void> {
    await this.until(() => this.power && !this.ctx.interactables.get('elev_button') && (this.entered('t_elevator') || this.inRoom('elevator')));
    await this.wait(2.5);
    this.seq.spawn('descent', () => this.descent());
  }

  // ───────────────────────────────────────────────────────────── act 6 — down

  private async descent(): Promise<void> {
    if (this.descending || !this.power) return;
    this.descending = true;
    const ctx = this.ctx, p = ctx.player, w = this.w;
    this.ui.closeNote?.();
    w.setInteractable('elev_button', false);
    ctx.setState('cutscene');
    p.controlsEnabled = false;
    this.hooks.setObjective('');
    this.beat('descent');
    for (const a of [...this.actors]) this.dropActor(a);
    // Make sure we're inside the cage before it shuts.
    if (p.position.z > -59) {
      p.teleport(new THREE.Vector3(THREE.MathUtils.clamp(p.position.x, -1.6, 1.6), 0, -60.4), p.yaw, p.pitch);
    }
    w.lock('d_elev');
    const panel = w.objectPos('elevator_cab', new THREE.Vector3(0, 1.4, -61));
    void this.look(new THREE.Vector3(0, 1.5, -57), 1.6); // look back at the gate as it shuts
    w.screen('elev_panel', 'terminal_idle', SCREENS.elevDepart);
    await this.wait(2.2);
    w.machine('elevator', 'active');
    this.elevLoop = this.loop('elevator_loop', 0.9);
    this.alarm?.stop(2);
    this.alarm = null;
    w.shake(0.25);
    this.director.hard('silence');
    await this.wait(3.2);
    void this.look(new THREE.Vector3(panel.x + 1.2, 1.45, -61.5), 1.4);
    w.screen('elev_panel', 'terminal_alert', SCREENS.elevDown);
    w.play('alarm_blip', undefined, 0.9);
    w.glitch(0.6, 0.4);
    await this.wait(1.2);
    this.sub('ELEVATOR', ELEVATOR_VOICE.text, ELEVATOR_VOICE.duration);
    await this.wait(ELEVATOR_VOICE.duration + 0.6);
    await this.choir(CHOIR.descent, 0.5);
    w.play('power_down', undefined, 1);
    w.lights('elevator', { enabled: false });
    w.shake(0.5);
    w.fade(1, 3.0);
    this.elevLoop?.stop(3.2);
    await this.wait(3.6);
    this.beat('end');
    ctx.setState('ended');
    this.ui.setHudVisible(false);
    await ctx.ui.showEnding();
  }

  // ───────────────────────────────────────────────────────────── reactions

  private onInteract(id: string): void {
    if (!this.started || this.descending) return;
    if (id === 'term_sec_unlock') { this.onSecConsole(); return; }
    if (id === 'gen_lever') {
      if (this.power) return;
      if (this.hasKey()) this.seq.spawn('power', () => this.powerRestored());
      else this.onLeverLocked();
      return;
    }
    if (id === 'elev_button') { this.seq.spawn('descent', () => this.descent()); return; }
    if (id === 'log_gen' && !this.power) return;
    const f = FRAGMENTS[id];
    if (f) this.openNote(id, f, true);
  }

  /** Short fragments open as a compact note card; the world keeps running. */
  private openNote(id: string, f: Fragment, isRecord: boolean): void {
    // The same E press that closes a note must not immediately re-open it.
    if (this.noteId === id) return;
    if (this.lastNoteId === id && performance.now() - this.noteClosedReal < 350) return;
    if (isRecord) this.logs.add(id);
    this.ctx.events.emit('story:log', { id, title: f.header, body: f.body });
    const done = () => {
      if (this.noteId !== id) return;
      this.noteId = null;
      this.lastNoteId = id;
      this.noteClosedReal = performance.now();
      this.closedAt.set(id, this.now);
    };
    this.noteId = id;
    const ui = this.ui;
    if (typeof ui.showNote === 'function') {
      ui.showNote(f.header, f.body, f.style).catch((e) => console.error('[story] showNote failed', e)).finally(done);
      return;
    }
    // Legacy UI without the note card: the pausing overlay.
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

  private onDenied(id: string): void {
    if (!this.started) return;
    switch (id) {
      case 'd_fab_outer':
        this.sawFabHold = true;
        this.toast(TOASTS.fabHold, 4);
        break;
      case 'd_pump':
        this.toast(TOASTS.pumpLocked, 4);
        break;
      case 'd_lobby':
        if (!this.power) this.toast(TOASTS.noPower, 4);
        break;
      case 'd_elev':
        if (!this.power) this.toast(TOASTS.noPowerElev, 4);
        break;
    }
  }

  private onDied(): void {
    const ctx = this.ctx;
    if (ctx.state === 'ended' || ctx.state === 'dead') return;
    ctx.setState('dead');
    this.alarm?.stop(1.5);
    this.ui.closeNote?.();
    this.ui.setHudVisible(false);
    ctx.ui.showDeath().catch((e) => console.error('[story] showDeath failed', e));
  }

  // ───────────────────────────────────────────────────────────── review / debug

  /**
   * Fire one vignette or actor scare in place, ignoring pacing and gaze gates (for
   * `scripts/playthrough.mjs --scares`). Returns where to look, or null for unknown names.
   */
  fire(name: string): { x: number; y: number; z: number } | null {
    const at = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });
    switch (name) {
      case 'corr_silhouette':
        this.seq.spawn('dbg', () => this.corrSilhouette(false));
        return at(JUNCTION_END);
      case 'quarters_figure': {
        const spot = this.quartersFigureSpot();
        const yaw = Math.atan2(-(spot.x < -5.5 ? -1 : 1), -(spot.z > -7 ? 1 : -1));
        const a = this.actor('husk', spot, yaw, 'idle');
        try { a?.setEyes(false); } catch { /* ignore */ }
        this.seq.spawn('dbg', async () => { await this.wait(6); this.dropActor(a); });
        return at(spot.setY(1.5));
      }
      case 'fab_skitter':
        this.seq.spawn('dbg', () => this.fabSkitter());
        return { x: 0, y: 7.7, z: -39.5 };
      case 'fab_figure': {
        const spot = this.fabFigureSpot() ?? FAB_FIGURE_SPOTS[0].clone();
        const a = this.actor('husk', spot, Math.atan2(-(this.pos.x - spot.x), -(this.pos.z - spot.z)), 'idle');
        try { a?.setEyes(true); } catch { /* ignore */ }
        this.seq.spawn('dbg', async () => {
          await this.wait(2.5);
          try { a?.lookAt(this.ctx.player.eye); } catch { /* ignore */ }
          await this.wait(2.5);
          await this.vanish(a, 'fab');
        });
        return at(spot.setY(1.5));
      }
    }
    if ((VIGNETTES as readonly string[]).includes(name)) {
      if (name === 'fab_arms_watch') this.armsWatching = !this.armsWatching;
      return this.w.vignette(name) ? { x: 0, y: 0, z: 0 } : null;
    }
    return null;
  }

  /** Test hook: end the current quiet window (the playthrough doesn't sit through every pause). */
  hurry(): void { this.quietUntil = 0; this.lastCombat = -1e9; }

  /** Snapshot for the playthrough assertions. */
  get debugState() {
    return {
      beats: [...this.beats], quietFor: Math.max(0, this.quietUntil - this.now), note: this.noteId,
      armed: this.armed, consoleUsed: this.consoleUsed, lockoutFound: this.lockoutFound, keyTaken: this.keyTaken,
      power: this.power, actors: this.actors.size, mood: this.director.mood,
    };
  }
}
