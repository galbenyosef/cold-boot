/**
 * Level 3 — the two non-interactive cutscenes (stage 3a §4; D8, D9, D11).
 *
 *   C1 "Sealed in till tomorrow" (13.0 s + 1.6 s black): the inner door opens on Halvorsen; he talks, his eyes drop to
 *      the lowered weapon, Reyes asks for a phone, he beckons and walks west, the eye follows him, fade. Under the
 *      black: the body to the visitor chair, the inner door shut + locked, S2 snapped, Halvorsen in his chair, the
 *      murmur. `then: 'hold'` → C2.
 *   C2 "Camera one" (≤ 30 s, measured ≈ 28.6 s): disbelief, the monitor turned to CAM 01 (the pressure door opens, the
 *      three units in the lock walk out at 100 % open, west into the lobby), CAM 04 (Line Two: dark after STOP, lit
 *      and waiting after COMMAND), the dead phone, CHOIR from the ceiling speaker, the screens die, the takeover, the
 *      plea, the badge; the release: the eye rises from the chair already turning to the door (hand-back).
 *
 * Line times are anchored on the previous line's recorded end (`lineDuration`) + a short gap; camera beats follow the
 * plan's table and shift with the lines. Every effect is a cue on the scene clock; the end state (`c1End` / `c2End`)
 * is applied by BOTH a natural end and a skip, and is the same state a `cp3_office` load rebuilds.
 */
import * as THREE from 'three';
import type { EnemyActor, FeedHandle } from '../../core/types';
import type { CamShot, CamCue, Cutscene, CutResult } from '../cutscene';
import { yawPitchTo } from '../cutscene';
import { lineDuration, speak } from '../voice';
import { Base3, C1P, CAM01, CAM04, FEED_UNITS, FEED_WALK, OFFICE, PUPPET_END, PUPPET_LOCK, PUPPET_PATH, V } from './base';
import { SCREEN3, TOAST3, wallClock } from './text';

type V3 = THREE.Vector3;
const PI = Math.PI;

/** Render feed options (render/feed.ts `FeedOptions`; the contract type is narrower). */
interface FeedOpts { name: string; rooms: string[]; position?: V3; target?: V3; fov?: number; label?: string; clock?: () => string; active?: boolean; hz?: number; pinLights?: boolean | unknown[]; exposure?: number }

export interface SceneTimes { [k: string]: number }

export abstract class Scenes3 extends Base3 {
  /** Set by index.ts (the page's camera rig). */
  cut: Cutscene | null = null;
  protected feeds: { cam01: FeedHandle | null; cam04: FeedHandle | null } = { cam01: null, cam04: null };
  /** Scene schedules (debugState / the playthrough). */
  protected sceneTimes: { c1?: SceneTimes; c2?: SceneTimes } = {};
  protected sceneLog: { id: string; result: CutResult; at: number; dur: number }[] = [];
  private _head = new THREE.Vector3();
  private _mon = new THREE.Vector3();
  private _up = new THREE.Vector3();

  // ───────────────────────────────────────────────────────────── the cast

  /** Halvorsen (absent until his beat). `at`: 'h1' behind the inner door (C1), 'h2' in his chair. */
  protected makeHalv(at: 'h1' | 'h2'): EnemyActor | null {
    this.dropHalv();
    let a: EnemyActor | null = null;
    try {
      const pos = at === 'h1' ? C1P.h1.clone() : OFFICE.seat.clone();
      a = this.ctx.enemies.actor('human', pos, -PI / 2, at === 'h1' ? 'idle' : 'sit_desk', { who: 'halvorsen' }) ?? null;
    } catch (e) { console.warn('[story] Halvorsen actor failed', e); }
    if (!a) return null;
    this.actors.add(a);
    this.halv = a;
    this.halvAt = at;
    this.halvPose = at === 'h1' ? 'idle' : 'sit_desk';
    const P = (n: string, v: unknown) => { try { a!.prop?.(n, v); } catch { /* ignore */ } };
    if (at === 'h1') { P('mug', true); P('badge', 'lanyard'); }
    else {
      P('mug', false);
      P('desk', OFFICE.desk);
      P('phone', OFFICE.phone);
      P('badgeTarget', OFFICE.badge);
      const arm = this.monitorArm();
      if (arm) P('monitor', arm);
      P('badge', this.f.office ? 'none' : 'lanyard');
    }
    return a;
  }
  protected dropHalv(): void {
    if (this.halv) this.drop(this.halv);
    this.halv = null;
    this.halvAt = 'none';
  }
  protected monitorArm(): THREE.Object3D | null {
    try { return this.ctx.level.object('office_monitor_arm') ?? null; } catch { return null; }
  }
  /** The monitor arm at its story mark, facing him (−x): before C2 and on loads before the scene. */
  protected resetMonitor(turned: boolean): void {
    const arm = this.monitorArm();
    if (!arm) return;
    arm.position.copy(OFFICE.monitorArm);
    arm.rotation.set(0, turned ? PI : 0, 0);
    arm.updateMatrixWorld(true);
  }
  /** His eyes (live): the head bone + 7 cm; fallback by pose. */
  protected halvHead = (up = 0.07): V3 => {
    const a = this.halv, o = a?.object.getObjectByName('head');
    if (o) { o.getWorldPosition(this._head); this._head.y += up; return this._head; }
    const p = a?.position ?? OFFICE.seat;
    return this._head.set(p.x, p.y + (this.halvAt === 'h2' ? 1.22 : 1.66), p.z);
  };
  protected monitorPoint = (): V3 => {
    // the screen's centre (the arm's mesh), not the pivot
    const arm = this.monitorArm();
    if (!arm) return this._mon.copy(OFFICE.monitorArm);
    let mesh: THREE.Object3D | null = null;
    arm.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o; });
    return (mesh ?? arm).getWorldPosition(this._mon);
  };

  /** The three C2 units (actors, solid; sealed in the lock, later in the lobby). */
  protected makePuppets(where: 'lock' | 'end'): void {
    this.dropPuppets();
    const at = where === 'lock' ? PUPPET_LOCK : PUPPET_END;
    for (const p of at) {
      const a = this.actor('husk', p.clone(), where === 'lock' ? 0 : PI / 2, 'idle');
      if (!a) continue;
      this.eyes(a, true);
      this.puppets.push(a);
    }
  }
  protected dropPuppets(): void {
    for (const a of this.puppets.splice(0)) this.drop(a);
  }

  // ───────────────────────────────────────────────────────────── feeds

  protected makeFeed(which: 'cam01' | 'cam04', active: boolean): FeedHandle | null {
    if (this.feeds[which]) return this.feeds[which];
    const r = this.ctx.render as unknown as { feed?: (o: FeedOpts) => FeedHandle };
    if (typeof r.feed !== 'function') return null;
    const c = which === 'cam01' ? CAM01 : CAM04;
    try {
      const h = r.feed({
        name: which, rooms: which === 'cam01' ? ['gallery_n', 'lock', 'lobby'] : ['feed_l2'],
        position: c.pos.clone(), target: c.look.clone(), fov: c.fov, active, hz: 12,
        label: which === 'cam01' ? 'CAM 01  GALLERY N' : 'CAM 04  LINE TWO',
        clock: () => wallClock(this.t, true),
        // CAM 04's set has one light, far from the player: pin it explicitly (the default pin search found none)
        ...(which === 'cam04' ? { pinLights: [...this.ctx.render.lights.group('feed_l2')], exposure: 2.4 } : {}),
      });
      this.feeds[which] = h;
      return h;
    } catch (e) { console.warn(`[story] feed ${which} failed`, e); return null; }
  }
  protected bindMonitor(which: 'cam01' | 'cam04'): void {
    const h = this.feeds[which], m = this.mat('office_monitor');
    if (!m) return;
    try {
      if (h) this.ctx.materials.setScreen(m, 'feed', { texture: h.texture });
      else this.ctx.materials.setScreen(m, 'camera_feed');
    } catch { /* ignore */ }
  }
  protected dropFeeds(): void {
    for (const k of ['cam01', 'cam04'] as const) {
      const h = this.feeds[k];
      if (h) { try { h.remove(); } catch { /* ignore */ } }
      this.feeds[k] = null;
    }
  }
  /** CAM 04's set: 8 units on the apron (STOP: dark, heads down; COMMAND: lit, facing the camera) + 2 walkers. */
  protected makeFeedSet(): void {
    this.dropFeedSet();
    const lit = this.choice === 'command';
    for (const p of FEED_UNITS) {
      const a = this.actor('husk', p.clone(), PI, lit ? 'idle' : 'standing');
      if (!a) continue;
      this.eyes(a, lit);
      if (lit) this.lookAt(a, CAM04.pos.clone());
      this.feedActors.push(a);
    }
    for (let i = 0; i < 2; i++) {
      const a = this.actor('husk', FEED_WALK[0].clone().add(V(-1.6 * i, 0, 0.4 * i)), -PI / 2, 'idle');
      if (!a) continue;
      this.eyes(a, true);
      this.feedActors.push(a);
    }
    this.w.lights('feed_l2', { enabled: true, intensityScale: 2.5 });
  }
  protected dropFeedSet(): void {
    for (const a of this.feedActors.splice(0)) this.drop(a);
    this.w.lights('feed_l2', { enabled: false });
  }

  /** The player's flashlight is off in the lit office (C2: it would glare on the monitor); back as it was at the end. */
  private lampWas = false;
  private lampSet = false;
  protected lamp(on: boolean): void {
    const p = this.ctx.player as unknown as { flashlightOn: boolean; applyLoadout?: (s: { flashlight: boolean }) => void };
    const put = (v: boolean) => { try { if (p.flashlightOn !== v) p.applyLoadout?.({ flashlight: v }); } catch { /* ignore */ } };
    if (!on) { if (!this.lampSet) { this.lampWas = p.flashlightOn; this.lampSet = true; } put(false); return; }
    if (this.lampSet) { put(this.lampWas); this.lampSet = false; }
  }

  // ───────────────────────────────────────────────────────────── C1

  /** The lowered weapon, seen from his side: a little ahead of and well below the eye. */
  private lowGun(): V3 {
    const c = this.ctx.camera;
    return new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion).setY(0).normalize().multiplyScalar(0.4).add(c.position).add(V(0, -0.85, 0));
  }

  /** C1 schedule (the variants known at the start: the weapon cannot change during a scene; the shot variant is the longer). */
  protected c1Times(): SceneTimes {
    const d1 = Math.max(lineDuration('l3_halv_c1_1'), lineDuration('l3_halv_c1_1_shots'));
    const d2 = this.ctx.player.currentWeapon !== null ? lineDuration('l3_halv_c1_2') : lineDuration('l3_halv_c1_2b');
    const d3 = lineDuration('l3_reyes_phone');
    let t1 = 0.9, gap = 0.12;
    if (t1 + d1 + d2 + d3 + 3 * gap > 10.9) { t1 = 0.8; gap = 0.06; }
    const T: SceneTimes = { door: 0.3, startle: 0.6, l1: t1 };
    T.l2 = T.l1 + d1 + gap;
    T.l3 = T.l2 + d2 + gap;
    T.l4 = Math.min(10.95, T.l3 + d3 + gap);
    T.beckon = T.l4 + 0.1;
    T.walk = T.l4 + 0.5;
    T.dolly = Math.min(T.walk + 0.3, 11.2);
    T.fade = 11.8;
    T.end = 13.0;
    T.black = 1.6;
    return T;
  }

  /** C1 — "Sealed in till tomorrow". Resolves with the scene result; the player is held for C2 (`then: 'hold'`). */
  protected async sceneC1(): Promise<CutResult> {
    const cut = this.cut!;
    const T = this.c1Times();
    this.sceneTimes.c1 = T;
    const a = this.makeHalv('h1');
    const head = () => this.halvHead(0.02);
    const E0 = C1P.eye, E1 = C1P.eye.clone().add(V(-0.15 * (T.dolly / 9.5), 0, 0));
    const say = (id: string, at?: () => V3) => { void this.say(id, { pri: 'scene', gap: 0.08, at: at ?? (() => this.halvHead(0)) }); };
    const cues: CamCue[] = [
      { t: T.door, run: () => { this.beat('l3_meet'); this.sfx('door_open', V(-20, 5.9, -9), 0.6); } },
      { t: T.startle, run: () => { this.pose(a, 'startle'); this.sfx('mug_clink', C1P.h1.clone().setY(5.9), 0.6); } },
      { t: T.l1, run: () => { this.pose(a, 'talk'); say('l3_halv_c1_1'); } },
      { t: T.l2, run: () => { say('l3_halv_c1_2'); this.lookAt(a, this.lowGun()); } },
      { t: T.l2 + 1.0, run: () => this.lookAt(a, cut.eye) },
      { t: T.l3, run: () => { this.pose(a, 'idle'); void this.say('l3_reyes_phone', { pri: 'scene', gap: 0.08 }); } },
      { t: T.l4, run: () => say('l3_halv_c1_3') },
      { t: T.beckon, run: () => this.pose(a, 'beckon') },
      { t: T.walk, run: () => { this.pose(a, 'idle'); void this.walk(a, [C1P.walk], 1.1); } },
      { t: T.fade, run: () => { this.stopLoop('radio_admin', 1.2); } },
    ];
    const shots: CamShot[] = [
      { dur: T.dolly, eye: [E0, E1], look: head, fov: 72, enter: 'blend', blend: 0.35, body: C1P.body, bodyYaw: PI / 2, ease: 'linear' },
      { dur: T.fade - T.dolly, eye: [E1, C1P.dolly], look: () => this.halvHead(0.1), body: 'follow' },
      { dur: T.end - T.fade, eye: C1P.dolly, look: () => this.halvHead(0.1), fadeOut: 1.2, body: 'follow' },
      {
        dur: T.black, eye: C1P.dolly, black: true,
        cues: [
          { t: 0.05, run: () => this.c1Black(), skip: () => { /* c1End */ } },
          { t: 0.3, run: () => this.murmur() },
          { t: 0.9, run: () => this.sfx('chair_creak', OFFICE.visitor.clone().setY(5.2), 0.6) },
        ],
      },
    ];
    const r = await cut.play('l3_c1', shots, {
      place: { pos: OFFICE.visitor.clone(), yaw: PI / 2, pitch: 0 },
      viewmodel: 'lowered', then: 'hold', pin: a ? [a] : [], cues,
      when: () => this.sceneReady(),
      end: (how) => { if (how === 'skipped') this.talk.flush(); this.c1End(); },
    });
    this.sceneLog.push({ id: 'l3_c1', result: r, at: this.now, dur: cut.debugState().log.slice(-1)[0]?.t ?? 0 });
    return r;
  }

  /** §4.1: no hostile alive, the way back shut and locked, phase C. */
  protected sceneReady(): boolean {
    const lift = this.door('d3_lift'), pd = this.door('d3_pressure');
    let hostile = false;
    try { hostile = this.ctx.enemies.all.some((e) => e.alive); } catch { /* ignore */ }
    const ok = !hostile && (!lift || (lift.locked && lift.closed)) && (!pd || (pd.locked && pd.closed));
    return ok;
  }

  /** Under the black, in order: teleport (the body is already moved by the shot), snap S2, Halvorsen to H2. */
  private c1Black(): void {
    this.ctx.player.teleport(OFFICE.visitor.clone(), PI / 2, 0);
    if (this.once('c2')) { /* consequence sets the flag */ }
    this.snapPhase();
    this.resetMonitor(false);
    if (this.halvAt !== 'h2') this.makeHalv('h2');
  }
  private c1End(): void {
    if (!this.has('l3_meet')) this.beat('l3_meet');
    this.c1Black();
  }
  /** `l3_reyes_murmur`: Reyes, unintelligible (fx room:400, set at load), ducked −10 dB, no subtitle. */
  private murmur(): void {
    try {
      const s = speak(this.ctx, 'l3_reyes_murmur', { subtitle: false, volume: 0.32, position: OFFICE.visitorEye.clone() });
      this.talk.log.push({ t: this.now, id: 'l3_reyes_murmur', cond: null, said: 'l3_reyes_murmur', pri: 'over' });
      void s;
    } catch { /* ignore */ }
  }

  // ───────────────────────────────────────────────────────────── C2

  protected c2Times(): SceneTimes {
    const d = lineDuration;
    const choirId = this.choice === 'command' ? 'l3_choir_told_command' : 'l3_choir_told_stop';
    const T: SceneTimes = {};
    T.l1 = 0.3;
    T.l2 = Math.max(3.3, T.l1 + d('l3_halv_c2_1') + 0.2);
    T.turn = Math.max(4.5, T.l2 + 0.9);
    T.mon = T.turn + 0.8;
    T.door = T.mon;                             // the real door opens (2.6 s) as the screen comes round
    T.walk = T.door + 2.65;                     // 100 % open
    T.l3 = Math.max(T.door + 1.2, T.l2 + d('l3_halv_c2_2') + 0.2);
    T.cam04 = Math.max(9.0, T.walk + 1.8);       // the units are seen walking out on CAM 01 for 1.8 s
    T.l4 = Math.max(T.cam04 + 0.2, T.l3 + d('l3_halv_c2_3') + 0.2);
    T.phone = Math.max(11.6, T.l4 + d('l3_halv_c2_4') - 0.9);   // he reaches while the line ends
    T.l6 = Math.max(T.phone + 1.1, T.l4 + d('l3_halv_c2_4') + 0.2); // the receiver is at his ear first
    T.speaker = Math.max(14.6, T.l6 + d('l3_halv_c2_6') + 0.65);
    T.choir = T.speaker + 0.2;
    T.mon2 = Math.max(17.6, T.choir + d(choirId) + 0.25);
    T.quiet = T.mon2;
    T.die = T.quiet + 0.8;                      // 18.4 monitor → static → black
    T.thumbs = T.die + 0.5;                     // 18.9
    T.takeover = T.die + 1.0;                   // 19.4
    T.lamp = T.die + 1.5;                       // 19.9
    T.face = Math.max(20.2, T.quiet + d('l3_choir_quiet') + 0.3);
    T.l7 = T.face;
    T.come = Math.max(23.8, T.l7 + d('l3_halv_c2_7') + 0.2);
    T.l9 = Math.max(25.0, T.come + d('l3_reyes_come') + 0.2);
    T.give = T.l9;
    T.badge = Math.max(26.0, T.l9 + 1.0);
    T.release = Math.max(27.2, T.l9 + d('l3_halv_c2_9') + 0.1);
    T.end = T.release + 1.4;
    if (T.end > 30) console.error(`[story] C2 runs ${T.end.toFixed(2)} s (> 30)`);
    return T;
  }

  /** C2 — "Camera one". Ends with control in the office (weapon stowed, badge, phase E). */
  protected async sceneC2(): Promise<CutResult> {
    const cut = this.cut!;
    const T = this.c2Times();
    this.sceneTimes.c2 = T;
    if (this.halvAt !== 'h2') this.makeHalv('h2');
    const a = this.halv;
    const E = OFFICE.visitorEye;
    const face = () => this.halvHead(0.0);
    const toward = (from: V3, to: V3, m: number) => from.clone().add(to.clone().sub(from).normalize().multiplyScalar(m));
    const Ep = toward(E, OFFICE.seat.clone().setY(6.0), 0.1);
    // (plan: 0.25 m; 0.8 m so the 0.55 m screen reads at fov 52 — the zoom stays capped at 52)
    const Elean = toward(Ep, OFFICE.monitorArm, 0.8);
    const phonePt = OFFICE.seat.clone().lerp(OFFICE.phone, 0.5).setY(6.05);
    const endEye = OFFICE.endPos.clone().setY(OFFICE.endPos.y + 1.65);
    const bp = yawPitchTo(E, OFFICE.badge);
    const say = (id: string, at?: () => V3) => { void this.say(id, { pri: 'scene', gap: 0.1, at: at ?? (() => this.halvHead(0)) }); };
    const choirId = this.choice === 'command' ? 'l3_choir_told_command' : 'l3_choir_told_stop';
    let screensDead = false;
    const cues: CamCue[] = [
      { t: 0.0, run: () => this.c2Start() },
      { t: 0.05, run: () => { this.pose(a, 'sit_desk'); this.lookAt(a, cut.eye); } },
      { t: T.l1, run: () => say('l3_halv_c2_1') },
      { t: T.l2, run: () => { say('l3_halv_c2_2'); this.pose(a, 'rub_face'); } },
      { t: T.turn, run: () => { this.pose(a, 'turn_monitor'); this.sfx('chair_creak', OFFICE.seat.clone().setY(5.3), 0.4); } },
      { t: T.door, run: () => { this.openPressureForFeed(); } },
      { t: T.l3, run: () => say('l3_halv_c2_3') },
      { t: T.walk, run: () => this.puppetsWalk() },
      { t: T.cam04 - 0.7, run: () => { const h = this.feeds.cam04; if (h) h.active = true; this.feedWalkers(); } },
      { t: T.cam04, run: () => { this.pose(a, 'sit_desk'); this.bindMonitor('cam04'); this.sfx('monitor_switch', this.monitorPoint().clone(), 0.5); } },
      { t: T.cam04 + 0.3, run: () => { const h = this.feeds.cam01; if (h) h.active = false; } },
      { t: T.l4, run: () => say('l3_halv_c2_4') },
      { t: T.phone, run: () => this.pose(a, 'phone_ear') },
      { t: T.l6, run: () => { say('l3_halv_c2_6'); this.sfx('phone_dead', OFFICE.phone.clone(), 0.5); } },
      { t: T.speaker - 0.1, run: () => { this.pose(a, 'phone_down'); this.lookAt(a, OFFICE.speaker.clone()); } },
      { t: T.choir, run: () => void this.say(choirId, { pri: 'scene', gap: 0.15, at: OFFICE.speaker.clone() }) },
      { t: T.quiet, run: () => { this.lookAt(a, this.monitorPoint().clone()); void this.say('l3_choir_quiet', { pri: 'scene', gap: 0.15, at: OFFICE.speaker.clone() }); } },
      { t: T.die, run: () => { this.w.screen('office_monitor', 'static'); this.sfx('screen_die', this.monitorPoint().clone(), 0.6); } },
      { t: T.die + 0.3, run: () => { this.screenOff('office_monitor'); this.dropFeeds(); } },
      { t: T.thumbs, run: () => { for (let i = 1; i <= 3; i++) this.screenOff(`office_thumb_${i}`); this.sfx('screen_die', V(-33.8, 6.5, -24.2), 0.5); screensDead = true; } },
      { t: T.takeover, run: () => this.takeover(false) },
      { t: T.lamp, run: () => { this.officeDark(); this.sfx('office_die', V(-31.6, 7.4, -23.4), 0.6); } },
      // the office goes dark: the player's torch comes back (as it was before the scenes)
      { t: T.lamp + 0.5, run: () => this.lamp(true) },
      { t: T.face, run: () => { this.pose(a, 'cower'); this.lookAt(a, cut.eye); say('l3_halv_c2_7'); } },
      { t: T.come, run: () => void this.say('l3_reyes_come', { pri: 'scene', gap: 0.1 }) },
      { t: T.give, run: () => { this.pose(a, 'give'); say('l3_halv_c2_9'); } },
      { t: T.release + 0.9, run: () => this.takeBadge() },
    ];
    void screensDead;
    const shots: CamShot[] = [
      { dur: T.turn, eye: [E, Ep], look: face, fov: 60, enter: 'fade', fade: 0.6, body: OFFICE.visitor, bodyYaw: PI / 2, ease: 'linear' },
      { dur: T.mon - T.turn, eye: [Ep, Elean], look: this.monitorPoint, fov: [60, 52], enter: 'blend', blend: 0.8 },
      { dur: T.phone - T.mon, eye: Elean, look: this.monitorPoint, fov: 52 },
      { dur: T.speaker - T.phone, eye: [Elean, Ep], look: phonePt, fov: [52, 58], enter: 'blend', blend: 0.8 },
      // (up toward the speaker, but keeping him in frame looking up with us: a bare ceiling corner reads as nothing)
      { dur: T.mon2 - T.speaker, eye: Ep, look: () => this._up.copy(this.halvHead(0)).lerp(OFFICE.speaker, 0.28), fov: 58, enter: 'blend', blend: 0.8 },
      { dur: T.face - T.mon2, eye: Ep, look: this.monitorPoint, fov: 58, enter: 'blend', blend: 0.8 },
      { dur: T.badge - T.face, eye: [Ep, E], look: face, fov: 58, enter: 'blend', blend: 0.8 },
      { dur: T.release - T.badge, eye: E, look: OFFICE.badge, fov: 58, enter: 'blend', blend: 0.6 },
      { dur: T.end - T.release, eye: [E, endEye], yaw: [bp.yaw, OFFICE.endYaw], pitch: [bp.pitch, OFFICE.endPitch], fov: [58, 72], handback: true },
    ];
    const r = await cut.play('l3_c2', shots, {
      place: { pos: OFFICE.endPos.clone(), yaw: OFFICE.endYaw, pitch: OFFICE.endPitch },
      viewmodel: 'hidden', safe: true, topUp: true, pin: a ? [a] : [], cues, fadeIn: 0.6,
      end: (how) => { if (how === 'skipped') this.talk.flush(); this.instantNext = how === 'skipped'; try { this.c2End(); } finally { this.instantNext = false; } },
    });
    this.sceneLog.push({ id: 'l3_c2', result: r, at: this.now, dur: cut.debugState().log.slice(-1)[0]?.t ?? 0 });
    return r;
  }

  /** C2 t 0 (still black): `l3_office_scene`; the puppets sealed in the lock; the feeds; CAM 04's set. */
  private c2Start(): void {
    this.beat('l3_office_scene');
    this.lamp(false);
    this.makePuppets('lock');
    this.makeFeedSet();
    this.makeFeed('cam01', true);
    this.makeFeed('cam04', false);
    this.bindMonitor('cam01');
    this.resetMonitor(false);
  }
  /** The real pressure door opens (story move inside S2: the door is locked in the phase table). */
  private openPressureForFeed(): void {
    const d = this.door('d3_pressure');
    if (!d) return;
    try { d.unlock(); d.auto = false; d.open(); } catch { /* ignore */ }
    this.pressurePanels(SCREEN3.open);
    this.sfx('pdoor_open', this.monitorPoint().clone(), 0.25);
  }
  /** At 100 % open: single file, 1.4 m apart (their start marks), 1.7 m/s, out of the lock, west, into the lobby. */
  private puppetsWalk(): void {
    this.holdOpen('d3_lobby');
    this.puppets.forEach((p, i) => { this.gait(p, 'walk'); void this.walk(p, [PUPPET_PATH[0], PUPPET_PATH[1], PUPPET_END[i]], 1.7); });
  }
  private feedWalkers(): void {
    const walkers = this.feedActors.slice(FEED_UNITS.length);
    walkers.forEach((w, i) => { void this.walk(w, [FEED_WALK[1].clone().add(V(1.6 * i, 0, 0.4 * i))], 1.25); });
  }
  /** The office goes dark: the banker's lamp and fill off, the cold emergency light. */
  protected officeDark(): void {
    this.w.lights('office', { enabled: false });
    this.w.lights('office_emerg', { enabled: true });
    this.screenOff('office_monitor');
    for (let i = 1; i <= 3; i++) this.screenOff(`office_thumb_${i}`);
  }
  /** The takeover at C2 t ≈ 19.4: `l3_takeover` (S2T seal + the cold state). Puppets still in the lobby doorway keep it open. */
  protected takeover(instant: boolean): void {
    if (!this.beat('l3_takeover')) return;
    if (instant) return;
    if (this.puppets.some((p) => p.position.x > -12.8)) {
      this.holdOpen('d3_lobby');
      this.S('lobby_seal', async () => {
        await this.untilOr(() => this.puppets.every((p) => p.position.x < -12.8), 8);
        this.door('d3_lobby')?.lock();
      });
    }
  }
  private takeBadge(): void {
    try { this.halv?.prop?.('badge', 'none'); } catch { /* ignore */ }
    if (!this.ctx.player.hasKey('facilities_badge')) {
      this.ctx.player.addKey('facilities_badge');
      this.toast(TOAST3.badge);
    }
  }
  /** C2's end state — natural end, skip and a `cp3_office` load are the same (§4.3). */
  protected c2End(): void {
    if (!this.has('l3_office_scene')) this.beat('l3_office_scene');
    this.lamp(true);
    if (!this.f.takeover) this.beat('l3_takeover');
    this.dropFeedSet();
    this.dropFeeds();
    this.officeDark();
    this.resetMonitor(true);
    // the three units at the inner door, sealed in the lobby (recreated exactly at their marks)
    const placed = this.puppets.length === 3 && this.puppets.every((p, i) => p.position.distanceTo(PUPPET_END[i]) < 0.3);
    if (!placed) this.makePuppets('end');
    this.door('d3_lobby')?.lock();
    this.takeBadge();
    if (this.halvAt !== 'h2') this.makeHalv('h2');
    this.pose(this.halv, 'cower');
    try { this.halv?.prop?.('badge', 'none'); } catch { /* ignore */ }
    this.beat('l3_office');
  }
}
