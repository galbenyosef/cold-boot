/**
 * Level 2 script — act 3: "You open the door for it. Again." (REVISION 5 "The taking", REVISION 5.1
 * "The taking — final staging"). Beats: l2_power → l2_trap → l2_window → l2_booth_open → l2_loaded →
 * l2_escort → (ride) l2_tunnel → l2_apron.
 *
 * What the player can do at every moment, and what happens:
 *   l2_power   The switch. Phase D: the relay door shows CYCLING — ARC INTERLOCK until the room's guard and
 *              the hall ambush are dead (45 s fail-safe: survivors out of sight are removed). The line runs,
 *              the gate latches, everything north of the partition is removed silently. Tomas goes to his own
 *              door ("it says cycling"). Dawdling: three lines, then he stops asking. Nothing else moves.
 *   l2_trap    The player is north of the south bulkhead (`t2_spine_trap`) with nothing hostile behind them:
 *              the bulkhead LATCHES (lock → fully shut → right side? else reopen and re-arm). Phase E.
 *              The scene clock starts on the successful latch and never waits for the player again.
 *   l2_window  0–≈21 s. Red light, the hall door opens, two units come in single file. Tomas goes to the spine
 *              window nearest the player (he follows the player between the windows until a unit reaches
 *              him). Shooting the glass, trying the door, looking away: nothing changes the clock.
 *   l2_booth_open  ≤ 1 s after the hall door shut behind them d2_booth opens (phase F).
 *   l2_loaded  The escorts walk him to the loading station (≈ 9.5 s), the scanner holds him until the player is
 *              in the booth (or 12 s after the door opened), he is laid on the belt, the belt takes him
 *              through the mouth, the mouth latches (LOADING INTERLOCK), the escorts stand 1.5 s — cp2_taken.
 *   l2_escort  They walk back; 4 m from the hall door it opens and they are promoted to real enemies
 *              (phase G). Dead → mouth reopens (G2), cp2_escort. Unreachable for 60 s → removed.
 *   ride       The belt is the only way south. One CHOIR line inside; a nudge after 40 s of not boarding.
 */
import * as THREE from 'three';
import type { EnemyActor } from '../../core/types';
import {
  DECK, ESCORT_SPAWNS, GLASS, HALL_DOOR, HALL_DOOR_IN, HALL_DOOR_OUT, LAY, NORTH_GROUPS, SPINE_WINDOWS, STAIR_FOOT, TOMAS_AT_DOOR, V, face,
} from './base';
import { Ghosted } from './ghost';
import { TOAST2 } from './text';

/** Yaw facing −X (toward the spine windows). */
const FACE_WEST = Math.PI / 2;

export abstract class Taking extends Ghosted {
  private shotReacted = new Set<string>();
  private choirRated = false;
  private markIdx = -1;
  private escortsReal = false;

  /** His voice once he is led out: thin, from the desk speaker in the booth. */
  private speaker = () => this.w.objectPos('booth_console', V(-13.6, 1.0, -48.7));

  // ───────────────────────────────────────────────────────────── l2_power

  /** The switch. CHOIR could not reach it. */
  protected async power(): Promise<void> {
    if (this.f.power) return;
    const w = this.w;
    this.ui.closeNote?.();
    const at = w.interactablePos('relay_switch') ?? w.objectPos('relay_switch', V(17.5, 1.3, -61));
    this.talk.flush();
    // Phase D on this frame (level table): relay CYCLING, the line runs, the gate shuts, the spine opens.
    if (!this.beat('l2_power')) return;
    this.once('line_running');
    this.once('hall_mid'); // the hall ambush can no longer be sprung
    // Everything north of the partition is out of the player's world: gone, without a trace.
    // (they are still units on the line: not counted as gone)
    for (const g of NORTH_GROUPS) this.removeSilently(g, false);
    w.play('lever', at, 1);
    w.vignette('relay_arc');
    w.play('contactor_arc', at, 1);
    w.shake(0.3);
    w.vignette('line_start');
    this.toast(TOAST2.sectionLive);
    try { this.loops.push(this.ctx.audio.loop('siren_loop', { volume: 0.4 })); } catch { /* ignore */ }
    this.director.setMood('tension');
    this.S('relay_hold', () => this.relayHold());
    this.S('gate_latch', () => this.gateLatch());
    this.S('tomas_to_door', () => this.tomasToDoor());
    await this.hold(1.4);
    w.glitch(0.8, 0.5);
    await this.choir(['l2_choir_power_1'], { glitch: 0.4 });
    await this.choir(['l2_choir_power_2'], { glitch: 0.3 });
    await this.tomasSays(['l2_tomas_power_1', 'l2_tomas_power_2']);
    await this.wait(0.6);
    await this.tomasSays(['l2_tomas_power_3']);
  }

  /** The gate is a latch like every door that closes on the player: never shut with them on the wrong side. */
  private async gateLatch(): Promise<void> {
    for (let i = 0; i < 40; i++) {
      if (await this.closeBehind('d2_gate', () => this.pos.z < -50.35 || !this.inRoom('line'))) return;
      // (Only reachable with debug teleports: the relay is sealed while the gate closes.)
      await this.until(() => this.pos.z < -51 || !this.inRoom('line') || this.f.trapped);
      if (this.f.trapped) { this.door('d2_gate')?.lock(); return; }
    }
  }

  /**
   * The arc interlock: the relay door stays shut until nothing hostile is left IN the relay room (its guard, the
   * skitters, and whatever of the hall ambush followed the player in), so no fight follows the player into the
   * scene. They are roused every second: the gate never waits on a machine asleep or looking the other way. What
   * is left of the ambush OUTSIDE the locked door cannot get in and is not waited for — it is roused too and meets
   * the player in the hall when the door opens (the trap only latches once the spine is quiet).
   * Fail-safe, last resort only: after 45 s, survivors in the room nobody can see are removed.
   */
  private async relayHold(): Promise<void> {
    if (this.f.relayClear) return;
    const w = this.w, t0 = this.now;
    const groups = ['g2_relay', 'g2_hall_mid'];
    await this.hold(2);
    if (w.spawns('g2_relay').length) this.engage('g2_relay', 'both', 0.5);
    await this.hold(1.5);
    const inRelay = (e: { position: THREE.Vector3 }) => { try { return this.ctx.level.roomAt(e.position)?.id === 'relay'; } catch { return false; } };
    const left = (g: string) => this.members(g).filter(inRelay);
    const seen = (g: string) => left(g).some((e) => !this.notLookingAt(this.tmp2.copy(e.position).setY(e.position.y + 1).clone(), 60));
    let nextRouse = 0;
    await this.until(() => {
      if (groups.every((g) => left(g).length === 0)) return true;
      if (this.now >= nextRouse) { nextRouse = this.now + 1; for (const g of groups) this.rouse(g); }
      if (this.now - t0 > 45) for (const g of groups) if (left(g).length > 0 && !seen(g)) this.removeSilently(g);
      return false;
    });
    await this.hold(0.8);
    this.stamp('relay_clear');
    if (this.once('relay_clear')) w.play('door_unlock', V(10, 1.4, -61), 0.7); // phase D2: the door releases
    // The rest of the ambush (outside) comes for the player. Whatever is left when the bulkhead latches is behind
    // sealed doors for good (the player never comes back this way before the ride): removed then, unseen.
    for (const g of groups) if (w.alive(g) > 0) this.S(`hunt_${g}`, async () => {
      await this.fightOut(g, 60, { stop: () => this.f.trapped });
      if (this.f.trapped && w.alive(g) > 0) this.removeSilently(g);
    });
    this.S('dawdle', () => this.dawdle());
  }

  /** He waits at his own door, which says CYCLING. */
  private async tomasToDoor(): Promise<void> {
    const t = this.tomas;
    if (!t || this.f.trapped) return;
    this.pose(t, 'back_away');
    await this.hold(2.2);
    if (this.f.trapped || this.tomas !== t) return;
    this.pose(t, 'idle');
    this.lookAt(t, null);
    await this.walk(t, [V(-13.2, 0, -46.4), TOMAS_AT_DOOR], 1.5);
    if (this.f.trapped || this.tomas !== t) return;
    this.tomasSpot = 'door';
    this.place(t, TOMAS_AT_DOOR, FACE_WEST);
    // A glance at his own door, then back to whoever he can see (REVISION 6.1: attention is `auto` unless pinned).
    this.lookAt(t, V(-17, 1.5, -46));
    this.S('door_glance', async () => {
      await this.hold(1.5);
      if (this.tomas === t && this.tomasSpot === 'door' && !this.f.trapped) this.lookAt(t, null);
    });
  }

  /** The player takes their time: three lines that claim nothing they can disprove, then he stops asking. */
  private async dawdle(): Promise<void> {
    for (const [id, after] of [['l2_tomas_run_1', 24], ['l2_tomas_run_3', 28], ['l2_tomas_run_wait', 32]] as const) {
      if (await this.untilOr(() => this.f.trapped, after)) return;
      await this.until(() => this.f.trapped || (!this.talk.busy && this.w.active() === 0 && !this.noteOpen));
      if (this.f.trapped) return;
      await this.say(id);
    }
  }

  // ───────────────────────────────────────────────────────────── l2_trap

  private inTrapTrigger = () => this.at('t2_spine_trap', () => this.in(-21, -17, -54.5, -51));
  /** Nothing awake south of the bulkhead or in the trap segment. */
  private spineQuiet(): boolean {
    try {
      for (const e of this.ctx.enemies.all) {
        if (!e.alive || e.state === 'dormant') continue;
        if (this.region('spine_south', e.position) || this.region('trap', e.position)) return false;
      }
    } catch { /* ignore */ }
    return true;
  }

  private rouseSpine(): void {
    try {
      for (const e of this.ctx.enemies.all) {
        if (!e.alive || e.state !== 'idle') continue;
        if (this.region('spine_south', e.position) || this.region('trap', e.position)) this.ctx.enemies.alertNoise(e.position, 0.4);
      }
    } catch { /* ignore */ }
  }

  /** The bulkhead latches behind the player; only then does the scene clock start. */
  protected async trap(): Promise<void> {
    if (this.f.trapped) return;
    await this.until(() => this.f.power && this.live);
    for (;;) {
      // (a machine idling in the spine is roused: the latch never waits on one that has not seen the player)
      await this.until(() => this.ctx.state === 'playing' && this.inTrapTrigger() && (this.spineQuiet() || (this.rouseSpine(), false)));
      const ok = await this.closeBehind('d2_bulkhead_s', () => this.pos.z > -55.6 && this.region('trap'));
      if (ok) break;
      // Wrong side (they sprinted back through the closing leaves): reopened — re-arm when they come again.
      this.stamp('latch_retry');
      this.marks.latch_retries = (this.marks.latch_retries ?? 0) + 1;
      await this.until(() => !this.inTrapTrigger());
    }
    this.stamp('latch');
    this.beat('l2_trap'); // phase E
    await this.windowScene();
  }

  // ───────────────────────────────────────────────────────────── l2_window

  private nearestMark(): number {
    const z = this.pos.z;
    return Math.abs(z - SPINE_WINDOWS[0].mark.z) <= Math.abs(z - SPINE_WINDOWS[1].mark.z) ? 0 : 1;
  }

  /** Through thick glass, on its own clock. He does not scream a speech. */
  private async windowScene(): Promise<void> {
    const w = this.w;
    const T0 = this.now, T = () => this.now - T0;
    const at = (t: number) => this.hold(Math.max(0, t - T()));
    this.beat('l2_window');
    this.director.setMood('silence');
    this.talk.flush();
    w.vignette('booth_light_fail');
    const t = this.tomas;
    // The hall door — the one that never opens — opens. (The player is sealed in the spine: R2 holds.)
    this.holdOpen('d2_booth_hall');
    const e1 = this.actor('husk', V(-8.2, 0, HALL_DOOR.z), FACE_WEST, 'idle');
    const e2 = this.actor('husk', V(-6.8, 0, HALL_DOOR.z), FACE_WEST, 'idle');
    this.escorts = [e1, e2].filter((a): a is EnemyActor => !!a);
    void this.say('l2_tomas_run_4', { ttl: 3 });
    this.lookAt(t, HALL_DOOR.clone().setY(1.5));
    this.pose(t, 'back_away');

    // ── Tomas: to the window the player is at; he changes window with them until a unit reaches him ──
    let free = true;
    this.S('tomas_window', async () => {
      await at(0.7);
      let going = -1, there = false;
      while (free && t && this.tomas === t) {
        const want = this.nearestMark();
        const mark = SPINE_WINDOWS[want].mark;
        if (want !== going) {
          going = want; there = false; this.markIdx = want;
          this.tomasSpot = 'window';
          this.pose(t, 'back_away');
          try { void t.moveTo(mark, 1.9).catch(() => undefined); } catch { /* ignore */ }
        } else if (!there && Math.hypot(t.position.x - mark.x, t.position.z - mark.z) < 0.22) {
          there = true;
          // Palms on the glass, half a metre from it, face to face.
          this.place(t, mark, FACE_WEST);
          this.pose(t, 'bang_glass:0.5');
          this.lookAt(t, null); // off the hall door: at the player, through the glass (auto)
        }
        await this.hold(0.12);
      }
    });

    // ── the units: single file through the door, then to him ──
    const mid = [V(-13.3, 0, -45.7), V(-12.5, 0, -44.8)];
    const approach = async (a: EnemyActor | null, i: number, start: number) => {
      await at(start);
      await this.walk(a, [HALL_DOOR_IN, mid[i]], 1.5);
    };
    const coming = Promise.all([approach(e1, 0, 0.6), approach(e2, 1, 1.5)]);
    this.S('window_lines', async () => {
      await at(2.8);
      void this.say('l2_tomas_window_1', { ttl: 4 });
      await at(5.0);
      void this.say('l2_tomas_window_3', { ttl: 3 });
    });
    await Promise.race([coming, at(6.0)]);
    await at(5.6);
    // From here the window is fixed: they go to him.
    free = false;
    const mark = SPINE_WINDOWS[this.markIdx < 0 ? this.nearestMark() : this.markIdx].mark;
    const pull = V(mark.x + 1.75, 0, mark.z + 0.25);         // where the first unit stands: between him and the room
    const behind = V(mark.x + 0.5, 0, mark.z - 0.85);        // the second, at his shoulder
    await Promise.race([
      Promise.all([this.walk(e1, [pull], 1.6), this.walk(e2, [V(mark.x + 1.6, 0, mark.z - 0.9), behind], 1.7)]),
      at(9.0),
    ]);
    if (t && this.tomas === t) {
      // He is still at the glass when they take his arms.
      if (Math.hypot(t.position.x - mark.x, t.position.z - mark.z) > 0.3) this.place(t, mark, FACE_WEST);
      this.pose(t, 'held:file');
      this.tomasSpot = 'held';
      // Grabbed (whether or not he ever reached a window): no longer pinned to the hall door — held and on the walk
      // out his head and eyes go to the player.
      this.lookAt(t, null);
    }
    this.held = true;
    this.stamp('held');
    this.gait(e1, 'lead'); this.gait(e2, 'push');
    for (const a of this.escorts) this.lookAt(a, null);
    this.talk.overlap('l2_unit_take_1', { at: () => (e1 ? this.headOf(e1).clone() : null) });
    void this.say('l2_tomas_window_2', { ttl: 5 });
    await this.hold(1.2);

    // ── out through the hall door: the first unit ahead with his wrist, the second behind ──
    this.S('window_lines_2', async () => {
      await this.hold(1.6);
      void this.say('l2_tomas_window_4', { ttl: 5 });
    });
    const out = V(HALL_DOOR_OUT.x + 1.3, 0, HALL_DOOR_OUT.z);
    await this.file(t, e1, e2, [V(mark.x + 2.9, 0, (mark.z + HALL_DOOR_IN.z) / 2 - 0.4), HALL_DOOR_IN, out], 1.45, 9.5);
    // The door shuts behind them. (A latch needs no side check here: the player cannot be in the booth.)
    w.lock('d2_booth_hall');
    const d = this.door('d2_booth_hall');
    if (d) await this.untilOr(() => this.isShut(d), 2.5);
    this.stamp('taken');
    this.once('taken');
    this.S('loading', () => this.loading());
    // ── l2_booth_open: within a second, his door opens by itself ──
    await this.hold(0.6);
    this.beat('l2_booth_open'); // phase F
    w.play('door_unlock', V(-17, 1.4, -46), 0.7);
    this.stamp('booth_open');
    void this.choir(['l2_choir_window'], { ttl: 8 });
  }

  /**
   * Single file: `lead` 0.85 m ahead of the man, `push` 0.7 m behind, all on the same corners. Each leg is
   * walked together (speeds scaled so they stay in file); gives up after `timeout` seconds.
   */
  private async file(t: EnemyActor | null, lead: EnemyActor | null, push: EnemyActor | null, path: THREE.Vector3[], speed: number, timeout: number): Promise<void> {
    const t0 = this.now;
    let prev = t ? t.position.clone() : path[0].clone();
    for (const [i, p] of path.entries()) {
      const d = p.clone().sub(prev).setY(0);
      const len = d.length() || 1;
      d.multiplyScalar(1 / len);
      const last = i === path.length - 1;
      const ahead = last ? p.clone().addScaledVector(d, 0.85) : p.clone().addScaledVector(d, 0.85);
      const back = p.clone().addScaledVector(d, -0.7);
      const sp = (a: EnemyActor | null, to: THREE.Vector3) => {
        if (!a) return speed;
        const l = Math.hypot(a.position.x - to.x, a.position.z - to.z);
        return THREE.MathUtils.clamp(speed * l / len, 0.5, 1.9);
      };
      await Promise.race([
        Promise.all([this.walk(t, [p], speed), this.walk(lead, [ahead], sp(lead, ahead)), this.walk(push, [back], sp(push, back))]),
        this.hold(Math.max(0.2, timeout - (this.now - t0))),
      ]);
      prev = p;
    }
  }

  // ───────────────────────────────────────────────────────────── l2_loaded

  private playerInBooth = () => this.in(-17.4, -10, -50, -42) && this.f.boothOpen;

  /** Across the hall to the loading station, the scanner, the belt, the mouth — seen from the booth. */
  private async loading(): Promise<void> {
    const w = this.w;
    const [e1, e2] = [this.escorts[0] ?? null, this.escorts[1] ?? null];
    const t = this.tomas;
    const t1 = this.now;
    const deckY = Math.max(0.3, this.groundY(DECK.x - 0.4, DECK.z, 2.2));
    this.S('loading_lines', async () => {
      await this.hold(3.2);
      void this.say('l2_tomas_window_5', { at: this.speaker, ttl: 6 });
      await this.hold(3.4);
      this.talk.overlap('l2_unit_take_2', { at: () => (e2 ? this.headOf(e2).clone() : null) });
    });
    // ≈ 12.3 m at 1.3 m/s: door → stair foot → deck.
    await this.file(t, e1, e2, [V(-3.5, 0, -43.8), STAIR_FOOT, V(DECK.x - 0.75, deckY, DECK.z)], 1.3, 13);
    this.stamp('at_deck');
    // The loading arch's scanner sweeps him; he fights it. It ends when the player can see it from the booth.
    w.vignette('load_scan');
    this.pose(t, 'struggle');
    const s0 = this.now;
    await this.until(() => {
      const scanned = this.now - s0;
      if (scanned < 1.5) return false;
      const openFor = this.now - (this.marks.booth_open ?? t1);
      return scanned >= 5 || this.playerInBooth() || openFor >= 12;
    });
    // Laid on the running belt, under the hard light.
    const beltY = Math.max(0.3, this.groundY(LAY.x, LAY.z, 1.7)) || LAY.y;
    const lm = w.objectPos('lay_mark', LAY);
    const lay = V(lm.x, beltY, lm.z);
    this.held = false;
    this.onBeltTomas = true;
    this.tomasSpot = 'belt';
    this.gait(e1, ''); this.gait(e2, '');
    if (t) {
      this.place(t, lay, 0);
      this.pose(t, 'carried');
      this.lookAt(t, null);
    }
    this.stamp('laid');
    void this.say('l2_tomas_window_6', { at: this.speaker, ttl: 3 });
    await this.hold(1.2);
    // The belt takes him (1.6 m/s) into the mouth.
    const mouthZ = w.objectPos('tunnel_mouth', V(5, beltY, -50)).z;
    let last = this.now;
    await this.until(() => {
      const dt = this.now - last; last = this.now;
      lay.z -= 1.6 * dt;
      if (t) this.place(t, lay);
      return lay.z < mouthZ - 0.9;
    });
    // His radio dies at the mouth.
    this.tomasOffAir = true;
    this.onBeltTomas = false;
    this.talk.silence('tomas');
    w.play('intercom_static', this.speaker(), 0.45);
    this.drop(t);
    if (this.tomas === t) this.tomas = null;
    this.tomasSpot = 'gone';
    // LOADING INTERLOCK — UNITS ON FLOOR: the mouth latches until the escorts are dealt with.
    await this.closeBehind('d2_mouth', () => !this.inTunnel());
    this.stamp('loaded');
    this.beat('l2_loaded');
    // They stand still for a second and a half. This instant is the checkpoint.
    await this.hold(1.5);
    this.checkpointNow('cp2_taken');
    await this.escortsReturn(e1, e2, deckY);
  }

  protected abstract checkpointNow(id: 'cp2_taken'): void;

  // ───────────────────────────────────────────────────────────── l2_escort

  /** They turn and walk back toward the booth; 4 m from the hall door it opens and they are real. */
  private async escortsReturn(e1: EnemyActor | null, e2: EnemyActor | null, deckY: number): Promise<void> {
    void deckY;
    const near = (a: EnemyActor | null) => !a || Math.hypot(a.position.x - HALL_DOOR.x, a.position.z - HALL_DOOR.z) < 4;
    const back = [STAIR_FOOT, V(-3.5, 0, -43.8), V(-9.0, 0, HALL_DOOR.z)];
    this.S('escort_1', () => this.walk(e1, back, 1.3));
    this.S('escort_2', async () => { await this.hold(0.9); await this.walk(e2, back, 1.3); });
    await this.untilOr(() => near(e1) || near(e2), 14);
    this.stamp('attack');
    this.beat('l2_escort'); // phase G: the hall door answers again
    try { this.door('d2_booth_hall')?.open(); } catch { /* ignore */ }
    this.promote();
    await this.escortFight();
  }

  /** The two puppets become two real husks where they walk (no pop); a build without `promote` swaps them. */
  private promote(): void {
    if (this.escortsReal) return;
    this.escortsReal = true;
    if (!this.prog.triggered.includes('g2_escort')) this.prog.triggered.push('g2_escort');
    this.triggeredAt.set('g2_escort', this.now);
    let n = 0;
    for (const a of this.escorts) {
      try {
        if (typeof a.promote === 'function') { this.actors.delete(a); a.promote('g2_escort'); n++; continue; }
      } catch (e) { console.warn('[story] promote failed', e); }
      const p = a.position.clone(), yaw = a.object.rotation.y;
      this.drop(a);
      try { this.ctx.enemies.spawn('husk', p, yaw, 'g2_escort'); n++; } catch { /* ignore */ }
    }
    this.escorts = [];
    if (n === 0) this.spawnEscorts();
  }
  private spawnEscorts(): void {
    if (!this.prog.triggered.includes('g2_escort')) this.prog.triggered.push('g2_escort');
    this.triggeredAt.set('g2_escort', this.now);
    if (this.w.spawns('g2_escort').length) { this.w.spawnGroup('g2_escort'); return; }
    for (const p of ESCORT_SPAWNS) { try { this.ctx.enemies.spawn('husk', p.clone(), -Math.PI / 2, 'g2_escort'); } catch { /* ignore */ } }
  }

  /** Loading `cp2_taken`: no scene. Booth red and open, he is gone, the mouth is shut; two seconds, then they come. */
  protected async resumeTaken(): Promise<void> {
    this.tomasOffAir = true;
    this.tomasSpot = 'gone';
    await this.hold(2);
    this.stamp('attack');
    if (this.beat('l2_escort')) {
      try { this.door('d2_booth_hall')?.open(); } catch { /* ignore */ }
      this.escortsReal = true;
      this.spawnEscorts();
    }
    await this.escortFight();
  }

  /** Until both are dead. An escort the player cannot get at for 60 s is removed. Then the mouth reopens (G2). */
  protected async escortFight(): Promise<void> {
    if (this.f.escortDead) return;
    this.director.setMood('tension');
    await this.hold(1.0);
    // They know where the player is (they came back for them): never two units idling in the hall — roused every
    // second until dead. Last resort: an escort out of the player's reach and sight for 60 s is removed.
    await this.fightOut('g2_escort', 60);
    await this.hold(1.2);
    this.stamp('escort_dead');
    this.once('escort_dead'); // phase G2: LOADING INTERLOCK releases, the mouth opens
    this.director.setMood('ambient');
  }

  // ───────────────────────────────────────────────────────────── the ride

  /** The belt through the fitting tunnel, behind him. One CHOIR line; one nudge if the player will not board. */
  protected async ride(): Promise<void> {
    if (this.f.apron) return;
    const w = this.w;
    await this.until(() => this.f.escortDead || this.f.apron);
    const t0 = this.now;
    this.S('nudge', async () => {
      const boarded = () => this.f.apron || this.has('l2_tunnel');
      if (await this.untilOr(boarded, 40)) return;
      await this.until(() => boarded() || (this.ctx.state === 'playing' && !this.talk.busy && !this.noteOpen));
      if (!boarded() && this.once('choir_nudge')) { this.marks.nudge = +(this.now - t0).toFixed(1); await this.choir(['l2_choir_nudge']); }
    });
    await this.until(() => this.f.apron || (this.inTunnel() && this.pos.z < -50.6));
    if (this.f.apron) return;
    this.stamp('boarded');
    if (this.beat('l2_tunnel')) {
      await this.until(() => this.f.apron || this.at('t2_tunnel_mid', () => this.in(2.5, 7.5, -59, -54.5)));
      if (!this.f.apron) {
        w.vignette('tunnel_press');
        w.shake(0.3);
        if (this.once('choir_tunnel')) void this.choir(['l2_choir_tunnel'], { ttl: 3 });
      }
    }
  }

  // ───────────────────────────────────────────────────────────── shots at the glass (R2 / H5)

  /** `bullet:impact` on a booth pane with him behind it: he flinches and says so — once per phase. */
  protected onImpact(point: THREE.Vector3, surface: string): void {
    if (!this.started || surface !== 'glass' || !this.tomas || this.f.taken) return;
    const hall = Math.abs(point.x + 10) < 0.45 && point.z > -50.2 && point.z < -41.8;
    const spine = Math.abs(point.x + 17) < 0.5 && SPINE_WINDOWS.some((s) => point.z > s.z0 - 0.4 && point.z < s.z1 + 0.4);
    if (!hall && !spine) return;
    this.glassShotAt = this.now;
    const ph = this.facts.phase;
    if (ph === 'E') this.glassShotInTrap = true;
    if (!this.shotReacted.has(ph)) {
      this.shotReacted.add(ph);
      try { this.tomas.setPose('flinch'); } catch { /* ignore */ } // an overlay: his pose stays what it was
      void this.say(ph === 'E' ? 'l2_tomas_shot_glass' : 'l2_tomas_shot_at', { ttl: 2.5, next: true });
    }
    if (ph === 'E' && !this.choirRated) {
      this.choirRated = true;
      this.S('rated', async () => { await this.hold(1.6); await this.choir(['l2_choir_glass'], { ttl: 5 }); });
    }
  }

  /** Where he looks from the hall glass (for poses elsewhere). */
  protected glassPoint(): THREE.Vector3 { return GLASS; }
  protected faceGlass(p: THREE.Vector3): number { return face(p, GLASS); }
}
