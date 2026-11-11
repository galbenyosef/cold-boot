/**
 * The Sublevel 3 script. Each beat is its own "thread" (async function) that waits for its own
 * condition, so events arriving in odd orders (console used before the pistol, enemies killed before
 * a trigger, the player sprinting past volumes) can never stall the flow. Conditions combine the
 * level's trigger events with a position/room poll, and every lock has a guaranteed unlock path.
 */
import * as THREE from 'three';
import type { GameContext, LoopHandle, PickupKind } from '../core/types';
import type { UIInternal } from '../ui/types';
import type { Sequencer } from './sequencer';
import type { MusicDirector } from './director';
import type { CameraRig } from './camera';
import { ALL_SCREENS, type World } from './world';
import { CHOIR, LOGS, OBJECTIVES, SEC_CONSOLE, TOASTS } from './text';

interface Hooks { setObjective(text: string): void }

const EMERGENCY_GROUPS = ['corr_a_emergency', 'fab_emergency', 'gen_emergency', 'lobby_emergency'];

export class Script {
  // ── facts (set by persistent listeners; scripts poll them) ──
  private woke = false;
  private started = false;
  private triggerAt = new Map<string, number>();
  private insideTrig = new Set<string>();
  private lastInElevator = -1e9;
  private cleared = new Map<string, number>();
  private pickedUp = new Set<PickupKind>();
  private used = new Set<string>();
  private sawFabHold = false;
  private reachedJunction = false;
  private armed = false;
  private ambushStarted = false;
  private ambushAt = 0;
  private secCleared = false;
  private storageUnlocked = false;
  private fabRevealed = false;
  private visitedGen = false;
  private power = false;
  private elevatorReady = false;
  private descending = false;
  private reading = false;
  private toastCooldown = new Map<string, number>();
  private objectiveTimer = 0;
  private beats = new Set<string>();
  private alarm: LoopHandle | null = null;
  private elevLoop: LoopHandle | null = null;

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
  }

  private get ui(): UIInternal { return this.ctx.ui as UIInternal; }
  private loop(id: string, volume: number): LoopHandle | null {
    try { return this.ctx.audio.loop(id, { volume }); } catch { return null; }
  }
  private wait(s: number) { return this.seq.wait(s); }
  private until(p: () => boolean) { return this.seq.waitUntil(p); }

  private beat(id: string): boolean {
    if (this.beats.has(id)) return false;
    this.beats.add(id);
    if (this.ctx.debug.verbose) console.log(`[story] beat ${id} @${this.seq.time.toFixed(1)}s`);
    this.ctx.events.emit('story:beat', { id });
    return true;
  }

  /** Internal run-once marker (not a DESIGN.md beat, so nothing is emitted). */
  private once(id: string): boolean {
    if (this.beats.has('#' + id)) return false;
    this.beats.add('#' + id);
    return true;
  }

  private toast(text: string, cooldown = 0): void {
    const now = this.seq.time;
    if (cooldown > 0 && (this.toastCooldown.get(text) ?? -1e9) > now - cooldown) return;
    this.toastCooldown.set(text, now);
    this.ctx.events.emit('story:toast', { text });
  }

  private sub(speaker: string, text: string, duration: number): void {
    this.ctx.events.emit('story:subtitle', { speaker, text, duration });
  }

  /** CHOIR speaks through every speaker at once: subtitle + voice + a digital shudder. */
  private async choir(lines: { text: string; duration: number }[], glitch = 0.45): Promise<void> {
    for (const l of lines) {
      this.sub('CHOIR', l.text, l.duration);
      try { this.ctx.audio.choirVoice(l.text, l.duration); } catch { /* ignore */ }
      this.w.glitch(glitch, 0.25);
      await this.wait(l.duration + 0.35);
    }
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
    const t0 = this.seq.time;
    return this.until(() => {
      const k = Math.min(1, (this.seq.time - t0) / Math.max(0.01, seconds));
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

  private groupDone(g: string, since: number, minDelay = 4): boolean {
    if (this.cleared.has(g)) return true;
    return this.seq.time - since > minDelay && this.w.alive(g) === 0;
  }

  private ownsPistol(): boolean {
    try { return !!this.ctx.player.weapons.pistol?.owned; } catch { return false; }
  }

  // ───────────────────────────────────────────────────────────── per-frame

  tick(dt: number): void {
    if (!this.started) return;
    this.objectiveTimer -= dt;
    if (this.objectiveTimer > 0) return;
    this.objectiveTimer = 0.2;
    if (this.inRoom('junction')) this.reachedJunction = true;
    if (this.inRoom('gen') || this.entered('t_gen')) this.visitedGen = true;
    if (this.inRoom('elevator') || this.insideTrig.has('t_elevator')) this.lastInElevator = this.seq.time;
    this.hooks.setObjective(this.computeObjective());
  }

  private computeObjective(): string {
    if (!this.woke || this.descending) return OBJECTIVES.none;
    if (this.power) {
      if (this.elevatorReady && this.seq.time - this.lastInElevator < 1.5) return OBJECTIVES.callElevator;
      return OBJECTIVES.reachElevator;
    }
    if (this.fabRevealed) return this.visitedGen ? OBJECTIVES.throwBreaker : OBJECTIVES.findPower;
    if (this.secCleared) return OBJECTIVES.enterFab;
    if (this.ambushStarted) return OBJECTIVES.survive;
    if (this.armed) return OBJECTIVES.pastHold;
    if (!this.armed && (this.inRoom('sec') || this.entered('t_sec')) && (this.sawFabHold || this.reachedJunction)) return OBJECTIVES.takePistol;
    if (this.sawFabHold || this.reachedJunction || this.entered('t_junction')) return OBJECTIVES.checkSecurity;
    return OBJECTIVES.findOut;
  }

  // ───────────────────────────────────────────────────────────── flow

  /** Enforce initial lock states and start every beat thread. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const w = this.w;
    w.lock('d_storage');
    w.lock('d_fab_outer');
    w.lock('d_lobby');
    w.lock('d_elev');
    w.setInteractable('elev_button', false);
    this.director.setMood('ambient');

    const S = (n: string, f: () => Promise<unknown>) => this.seq.spawn(n, f);
    S('corridor', () => this.corridorBlackout());
    S('armed', () => this.armedAndAmbush());
    S('husk', () => this.huskWakes());
    S('storage', () => this.storageAmbush());
    S('fab_reveal', () => this.fabReveal());
    S('fab_first', () => this.fabFirstFight());
    S('lobby', () => this.lobby());
    S('elevator_fallback', () => this.elevatorFallback());
  }

  /** Opening: lying on the bed, the pump runs dry, eyes open. */
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

    const monitor = (() => { try { return ctx.audio.loop('monitor_hum', { volume: 0.35 }); } catch { return null; } })();
    let blipping = true;
    this.seq.spawn('blips', async () => {
      // A flat, patient alarm from the vitals monitor.
      for (let i = 0; i < 14 && blipping; i++) { w.play('alarm_blip', undefined, 0.35); await this.wait(1.15); }
    });

    if (!short) {
      await this.wait(1.4);
      this.sub('INFUSION PUMP', 'Reservoir empty. Please contact attending staff.', 4.2);
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
    const t0 = this.seq.time;
    await this.until(() => {
      const k = Math.min(1, (this.seq.time - t0) / rise);
      if (this.rig.wake) this.rig.wake.rise = k;
      return k >= 1;
    });
    await looking;
    this.rig.wake = null;
    blipping = false;
    monitor?.setVolume(0.12, 3);
    await this.wait(0.3);

    p.controlsEnabled = true;
    ctx.setState('playing');
    this.afterWake(false);
  }

  /** Controls on: objective, hints, music. Also the autostart entry point. */
  afterWake(skipHints: boolean): void {
    this.woke = true;
    this.ctx.ui.setHudVisible(true);
    this.director.setMood('ambient');
    this.hooks.setObjective(this.computeObjective());
    if (skipHints) return;
    this.seq.spawn('hints', async () => {
      await this.wait(1.2);
      this.toast(TOASTS.move);
      await this.wait(6);
      this.toast(TOASTS.use);
    });
  }

  // ───────────────────────────────────────────────────────────── beats

  private async corridorBlackout(): Promise<void> {
    await this.until(() => this.woke && (this.entered('t_corr_mid') || (this.inRoom('corr_a') && this.ctx.player.position.z < -6.5)));
    if (!this.beat('corr_blackout')) return;
    const w = this.w, pz = this.ctx.player.position.z;
    // Audio plays power_down + a vent_scuttle moving overhead (starts +1.4 s) on this beat.
    w.lights('corr_a', { enabled: false });
    await this.wait(1.5);
    w.shake(0.22);
    await this.wait(1.1);
    w.play('metal_clang', new THREE.Vector3(0, 3.0, pz - 5), 0.4);
    await this.wait(0.3);
    w.lights('corr_a', { enabled: true, flicker: 'broken' });
    w.play('spark_zap', new THREE.Vector3(0, 2.9, pz - 2), 0.6);
  }

  private async armedAndAmbush(): Promise<void> {
    // Pistol taken from the locker — or (debug give=all) already owned when walking into Security.
    await this.until(() => this.woke && (this.pickedUp.has('pistol') || (this.ownsPistol() && (this.inRoom('sec') || this.entered('t_sec')))));
    this.armed = true;
    this.beat('armed');
    this.seq.spawn('reload_hint', async () => { await this.wait(1.0); this.toast(TOASTS.reload); });
    await this.wait(3.2);

    const w = this.w;
    this.ambushStarted = true;
    this.ambushAt = this.seq.time;
    this.beat('sec_ambush');
    const vent = w.objectPos('sec_vent', new THREE.Vector3(-7, 3.1, -17));
    w.play('vent_scuttle', vent, 0.8);
    w.flicker('sec', 'strobe');
    w.screen('sec_monitor_1', 'terminal_alert', 'MOTION — SEC 3');
    w.screen('sec_monitor_2', 'static');
    w.screen('sec_monitor_3', 'terminal_alert', 'VENT 3-C OPEN');
    w.screen('sec_monitor_4', 'static');
    await this.wait(0.7);
    w.lights('sec', { enabled: false });
    w.shake(0.3);
    await this.wait(0.55);
    w.lights('sec', { enabled: true, flicker: 'broken', color: 0xff2a14, intensityScale: 0.45 });
    w.spawnGroup('g_sec');

    // Cleared — or a failsafe so a stuck enemy can never hold the fab door shut.
    const t0 = this.seq.time;
    await this.until(() => this.groupDone('g_sec', t0) || this.seq.time - t0 > 150);
    this.secCleared = true;
    this.cleared.set('g_sec', this.cleared.get('g_sec') ?? this.seq.time);
    w.restoreColor('sec');
    w.lights('sec', { enabled: true, flicker: 'fluorescent', intensityScale: 0.75 });
    w.screen('sec_monitor_1', 'camera_feed');
    w.screen('sec_monitor_3', 'camera_feed');
    await this.wait(1.4);
    w.unlock('d_fab_outer');
    this.toast(TOASTS.holdLifted);
  }

  private async huskWakes(): Promise<void> {
    await this.until(() => this.secCleared);
    const since = this.cleared.get('g_sec') ?? this.seq.time;
    await this.until(() => this.entered('t_junction', since) || this.inRoom('junction') || this.fabRevealed);
    if (!this.beat('husk_wakes')) return;
    this.w.wakeGroup('g_junction');
    this.w.play('sting', undefined, 0.9);
  }

  private onSecConsole(): void {
    this.openText('term_sec_unlock', SEC_CONSOLE.title, SEC_CONSOLE.body, false);
    if (this.storageUnlocked) return;
    this.storageUnlocked = true;
    this.beat('storage_unlocked');
    const w = this.w;
    w.unlock('d_storage');
    w.screen('sec_console', 'terminal_idle', 'STORAGE RELEASED · FAB HOLD ACTIVE');
    w.screen('sec_monitor_2', 'camera_feed');
    w.screen('sec_monitor_4', 'camera_feed');
    this.toast(TOASTS.storageReleased);
  }

  private async storageAmbush(): Promise<void> {
    await this.until(() => this.storageUnlocked && (this.entered('t_storage') || this.inRoom('storage')));
    await this.wait(1.6);
    if (!this.once('storage_ambush')) return;
    this.w.spawnGroup('g_storage');
    this.w.play('metal_clang', new THREE.Vector3(8, 1.5, -19), 0.8);
  }

  private async fabReveal(): Promise<void> {
    await this.until(() => this.woke && (this.entered('t_fab_enter') || this.inRoom('fab')));
    this.fabRevealed = true;
    if (!this.beat('fab_reveal')) return;
    const w = this.w;
    this.director.setMood('tension');
    w.screen('fab_bigscreen', 'choir');
    w.glitch(0.7, 0.4);
    w.play('glitch', undefined, 0.5);
    await this.wait(0.9);
    await this.choir(CHOIR.fabReveal);
  }

  private async fabFirstFight(): Promise<void> {
    await this.until(() => this.fabRevealed && (this.entered('t_fab_mid') || (this.inRoom('fab') && this.ctx.player.position.z < -36) || this.power));
    if (!this.beat('fab_first_fight')) return;
    this.w.wakeGroup('g_fab_first', 0.5);
  }

  private async powerRestored(): Promise<void> {
    if (this.power) return;
    this.power = true;
    const w = this.w;
    w.setInteractable('gen_lever', false);
    this.beat('power_restored');
    // Anything still dormant in the first fab encounter comes alive with the bus.
    if (!this.beats.has('fab_first_fight')) { this.beat('fab_first_fight'); w.wakeGroup('g_fab_first', 0.8); }
    w.shake(0.35);
    w.lights('gen', { enabled: true, flicker: 'none', intensityScale: 1 });
    w.machine('gen_turbine', 'active');
    w.screen('gen_terminal', 'terminal_idle', 'MAIN BUS · ONLINE');
    this.toast(TOASTS.busLive);
    await this.wait(1.3);

    // The whole hall lights up: the hanging line in full view, for a moment.
    w.lights('fab', { enabled: true, flicker: 'none', intensityScale: 1 });
    w.lights('lobby', { enabled: true, flicker: 'fluorescent' });
    w.lights('elevator', { enabled: true, flicker: 'none' });
    w.screen('fab_bigscreen', 'terminal_idle', 'LINE 2 · RESUMING');
    w.screen('lobby_screen', 'terminal_idle', 'FREIGHT LIFT · POWER OK');
    w.screen('elev_panel', 'terminal_idle', 'SURFACE ▲');
    w.play('metal_groan', new THREE.Vector3(0, 6, -38), 0.7);
    await this.wait(3.0);

    this.beat('choir_speaks');
    for (const s of ALL_SCREENS) w.screen(s, 'choir');
    w.glitch(1, 0.8);
    const speaking = this.choir(CHOIR.powerRestored, 0.6);
    await this.wait(2.2);

    // Lights die, beacons spin, the line starts moving.
    w.play('power_down', undefined, 0.9);
    w.lights('fab', { enabled: false });
    await this.wait(0.6);
    for (const g of EMERGENCY_GROUPS) w.lights(g, { enabled: true, flicker: 'alarm' });
    w.machine('fab_arms', 'frenzy');
    w.machine('fab_conveyor', 'active');

    this.beat('fab_ambush');
    w.wakeGroup('g_fab_rack', 1.2);
    this.alarm = this.loop('alarm_loop', 0.55);
    w.unlock('d_lobby');
    w.unlock('d_elev');
    w.setInteractable('elev_button', true);
    this.elevatorReady = true;
    this.beat('elevator_ready');
    this.seq.spawn('sentry', async () => { await this.wait(6); w.spawnGroup('g_fab_sentry'); });
    await speaking;
    this.director.setMood('tension');
  }

  private async lobby(): Promise<void> {
    await this.until(() => this.power && (this.entered('t_lobby') || this.inRoom('lobby')));
    if (!this.once('lobby_ambush')) return;
    this.w.wakeGroup('g_lobby', 0.7);
    this.w.play('sting', undefined, 0.6);
  }

  /** If the level never registers `elev_button`, entering the cab after power still ends the level. */
  private async elevatorFallback(): Promise<void> {
    await this.until(() => this.power && !this.ctx.interactables.get('elev_button') && (this.entered('t_elevator') || this.inRoom('elevator')));
    await this.wait(1.5);
    this.seq.spawn('descent', () => this.descent());
  }

  private async descent(): Promise<void> {
    if (this.descending || !this.power) return;
    this.descending = true;
    const ctx = this.ctx, p = ctx.player, w = this.w;
    w.setInteractable('elev_button', false);
    ctx.setState('cutscene');
    p.controlsEnabled = false;
    this.hooks.setObjective('');
    this.beat('descent');
    // Make sure we're inside the cage before it shuts.
    if (p.position.z > -59) {
      p.teleport(new THREE.Vector3(THREE.MathUtils.clamp(p.position.x, -1.6, 1.6), 0, -60.4), p.yaw, p.pitch);
    }
    w.lock('d_elev');
    const panel = w.objectPos('elevator_cab', new THREE.Vector3(0, 1.4, -61));
    void this.look(new THREE.Vector3(0, 1.5, -57), 1.6); // look back at the gate as it shuts
    w.screen('elev_panel', 'terminal_idle', 'SURFACE ▲  · DEPARTING');
    await this.wait(2.2);
    w.machine('elevator', 'active');
    this.elevLoop = this.loop('elevator_loop', 0.9);
    this.alarm?.stop(2);
    this.alarm = null;
    w.shake(0.25);
    this.director.hard('silence');
    await this.wait(3.2);
    void this.look(new THREE.Vector3(panel.x + 1.2, 1.45, -61.5), 1.4);
    w.screen('elev_panel', 'terminal_alert', 'DESTINATION OVERRIDE: SUBLEVEL 9 — CORE');
    w.play('alarm_blip', undefined, 0.9);
    w.glitch(0.8, 0.5);
    await this.wait(1.2);
    this.sub('ELEVATOR', 'Destination override. Sublevel nine. Core.', 3.4);
    await this.wait(3.6);
    await this.choir(CHOIR.descent, 0.7);
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
    if (id in LOGS) { const l = LOGS[id]; this.openText(id, l.title, l.body, true); return; }
    if (id === 'term_sec_unlock') { this.onSecConsole(); return; }
    if (id === 'gen_lever') { this.seq.spawn('power', () => this.powerRestored()); return; }
    if (id === 'elev_button') { this.seq.spawn('descent', () => this.descent()); return; }
  }

  /** Logs pause the world while being read. */
  private openText(id: string, title: string, body: string, isLog: boolean): void {
    if (this.reading) return;
    this.reading = true;
    if (isLog && !this.logs.has(id)) this.logs.add(id);
    this.used.add(id);
    this.ctx.events.emit('story:log', { id, title, body });
    const prev = this.ctx.state;
    const pausable = prev === 'playing';
    if (pausable) this.ctx.setState('paused');
    this.ui.showLog(title, body).catch((e) => console.error('[story] showLog failed', e)).finally(() => {
      this.reading = false;
      if (pausable && this.ctx.state === 'paused') this.ctx.setState(prev);
    });
  }

  private onDenied(id: string): void {
    if (!this.started) return;
    switch (id) {
      case 'd_fab_outer':
        this.sawFabHold = true;
        this.toast(TOASTS.fabHold, 4);
        break;
      case 'd_storage':
        this.toast(TOASTS.storageLocked, 4);
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
    this.ui.setHudVisible(false);
    ctx.ui.showDeath().catch((e) => console.error('[story] showDeath failed', e));
  }
}
