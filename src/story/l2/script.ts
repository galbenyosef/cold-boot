/**
 * Level 2 — "LINE TWO" (docs/DESIGN.md → REVISION 4). Same construction as level 1's script: every beat
 * is its own thread waiting on its own condition; everything that must survive a reload lives in ONE
 * serialisable record (`prog`); every beat has a scene (its thread) and an idempotent entry in
 * `CONSEQUENCES` (what it leaves behind), so loading a checkpoint applies the consequences of every
 * recorded marker with no scene at all (`fastForward`).
 *
 * What is new here is a living character. Tomas is an actor behind glass (`enemies.actor('human')`) and a
 * voice in the player's ear; his lines go through `Dialogue` (queue, interruption, barks with cooldowns).
 * The story is about being a few seconds late, so the loss is trigger-driven end to end: the units wait at
 * his door until the player is in the spine, hold him until the player is at the window, lay him on the
 * belt once the player stands in the empty booth.
 *
 * Everything other modules build in parallel is optional at run time (triggers have position fallbacks,
 * actors / vignettes / interactables may be missing): the flow can never stall on a missing piece.
 */
import * as THREE from 'three';
import type { ActorType, Enemy, EnemyActor, GameContext, LoopHandle, VoiceHandle } from '../../core/types';
import type { UIInternal } from '../../ui/types';
import type { Sequencer } from '../sequencer';
import type { MusicDirector } from '../director';
import type { World } from '../world';
import type { Fragment } from '../text';
import { CHECKPOINT_IDS_L2, type CheckpointIdL2, type ProgressL2 } from '../save';
import { hasSay, speak } from '../voice';
import { Dialogue, type SayOpts } from './dialogue';
import { FRAGMENTS_L2, OBJ2, SCREEN2, TOAST2 } from './text';

export interface HooksL2 {
  setObjective(text: string): void;
  checkpoint(id: CheckpointIdL2): void;
  /** The level is finished: run the ending (cards, ending screen, clear the checkpoint). */
  ending(choice: 'shutdown' | 'rewrite', unit14: 'spared' | 'shot' | 'killed'): Promise<void>;
}

interface Flags {
  arrived: boolean; hall: boolean; seen: boolean; met: boolean; handset: boolean; rig: boolean; pass: boolean;
  power: boolean; taken: boolean; boothEmpty: boolean; loaded: boolean; apron: boolean; unit32Dead: boolean;
  foremanDead: boolean; unit14Off: boolean; unit14Shot: boolean; unit14Dead: boolean; core: boolean; offered: boolean;
  choice: '' | 'shutdown' | 'rewrite';
}
const FLAGS0: Flags = {
  arrived: false, hall: false, seen: false, met: false, handset: false, rig: false, pass: false, power: false,
  taken: false, boothEmpty: false, loaded: false, apron: false, unit32Dead: false, foremanDead: false,
  unit14Off: false, unit14Shot: false, unit14Dead: false, core: false, offered: false, choice: '',
};
export function emptyProgressL2(): ProgressL2 {
  return { beats: [], read: [], visited: [], flags: { ...FLAGS0 }, triggered: [], cleared: [], checkpoints: [] };
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;
/** Yaw that faces from `a` toward `b` (yaw 0 looks down −Z). */
const face = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

/** One-shot level vignettes that leave the place visibly changed (re-applied silently on load). */
const LASTING = ['hall_screen_count', 'booth_write_1', 'booth_write_2', 'booth_write_3', 'booth_light_fail', 'fitting_rig_wake', 'relay_arc', 'line_start', 'spine_bulkheads', 'intake_gauge', 'intake_shoe', 'core_bow', 'core_cells_out'];
export const VIGNETTES_L2 = ['dock_polisher', 'intake_shoe', 'intake_gauge', 'hall_hooks_sway', 'hall_screen_count', 'booth_write_1', 'booth_write_2', 'booth_write_3', 'booth_light_fail', 'fitting_sync', 'fitting_rig_wake', 'relay_arc', 'line_start', 'spine_bulkheads', 'tunnel_press', 'tunnel_silhouette', 'core_bow', 'core_cells_out'] as const;
const WORKER_GROUPS = ['g2_dock', 'g2_intake', 'g2_fit_tread'];
const ALL_DOORS = ['d2_cab', 'd2_intake', 'd2_line', 'd2_fitting', 'd2_relay', 'd2_spine', 'd2_bulkhead_s', 'd2_bulkhead_n', 'd2_booth', 'd2_booth_hall', 'd2_core', 'd2_lift'];

// ── places (DESIGN.md → Level 2 layout). Booth: x −17…−10, z −50…−42; glass to the hall at x = −10. ──
const GLASS = V(-9.7, 1.5, -46);
/** `bang_glass` / `write` assume the glass 0.42 m in front of him. */
const TOMAS_AT_GLASS = V(-10.44, 0, -47.3);
const TOMAS_DESK = V(-13.6, 0, -47.3);
const TOMAS_HELD = V(-13.2, 0, -48.3); // seen from the spine window centred at z −48.4
const BOOTH_DOOR_SPINE = V(-17, 0, -46);
const BOOTH_DOOR_HALL = V(-10, 0, -43);
/** Where Unit 14 may stand in the hall: open floor on the west walkway and at the ends. */
const HALL_STATIONS = [V(-7.5, 0, -25.5), V(-8, 0, -34), V(-1.5, 0, -29), V(-8, 0, -54), V(-5, 0, -61), V(-1, 0, -67), V(1.5, 0, -38), V(8.5, 0, -25.5), V(-3, 0, -47)];

export class ScriptL2 {
  private prog: ProgressL2 = emptyProgressL2();
  private done = new Set<string>();
  private ff = false;
  private restoredFrom: CheckpointIdL2 | null = null;

  // ── session facts ──
  private live = false;        // controls handed over (arrival finished)
  private started = false;
  private ended = false;
  private triggerAt = new Map<string, number>();
  private insideTrig = new Set<string>();
  private triggeredAt = new Map<string, number>();
  private closedAt = new Map<string, number>();
  private roomTime = new Map<string, number>();
  private toastCooldown = new Map<string, number>();
  private tickTimer = 0;
  private quietUntil = 0;
  private lastCombat = -1e9;
  private noteId: string | null = null;
  private noteClosedReal = -1e9;
  private lastNoteId: string | null = null;
  private legacyReading = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private actors = new Set<EnemyActor>();
  private loops: LoopHandle[] = [];

  // ── checkpoints ──
  private calmFor = 0;
  private lastCheckpoint: CheckpointIdL2 | null = null;
  private pendingCheckpoint: CheckpointIdL2 | null = null;

  // ── the cast ──
  readonly talk: Dialogue;
  private tomas: EnemyActor | null = null;
  private takers: EnemyActor[] = [];
  private unit14: EnemyActor | null = null;
  private unit14MovedAt = -1e9;
  private unit14Busy = false;
  private recorder: VoiceHandle | null = null;

  // ── bark state ──
  private lastMovePos = new THREE.Vector3();
  private lastMoveAt = 0;
  private lastShotAt = -1e9;
  private lightOnWorker = 0;
  private quietBarks = 0;
  private relayEnteredAt = -1e9;
  private windowStarted = false;
  private unitsInside = false;
  private escortGone = false;
  private escortAtStation = false;

  constructor(
    private ctx: GameContext,
    private seq: Sequencer,
    private director: MusicDirector,
    private w: World,
    private logs: Set<string>,
    private hooks: HooksL2,
  ) {
    this.talk = new Dialogue(ctx, seq);
    this.talk.bindActor('tomas', () => this.tomas);
    const ev = ctx.events;
    ev.on('trigger:enter', (e) => { this.triggerAt.set(e.id, this.seq.time); this.insideTrig.add(e.id); });
    ev.on('trigger:exit', (e) => { this.insideTrig.delete(e.id); });
    ev.on('enemy:group-cleared', (e) => { if (!this.prog.cleared.includes(e.group)) this.prog.cleared.push(e.group); });
    ev.on('interact', (e) => this.onInteract(e.id));
    ev.on('door:denied', (e) => this.onDenied(e.id));
    ev.on('player:died', () => this.onDied());
    ev.on('weapon:fired', () => { this.lastShotAt = this.seq.time; this.onShot(); });
    ev.on('player:damaged', (e) => this.onHurt(e.health));
    ev.on('enemy:alerted', (e) => this.onEnemyStir(e.id));
    ev.on('enemy:woke', (e) => this.onEnemyStir(e.id));
    ev.on('enemy:damaged', (e) => this.onEnemyDamaged(e.id));
    ev.on('enemy:died', (e) => this.onEnemyDied(e.group));
  }

  // ───────────────────────────────────────────────────────────── small helpers

  private get ui(): UIInternal { return this.ctx.ui as UIInternal; }
  private get now(): number { return this.seq.time; }
  private get f(): Flags { return this.prog.flags as unknown as Flags; }
  private get pos(): THREE.Vector3 { return this.ctx.player.position; }
  private has(id: string): boolean { return this.done.has(id); }
  private wait(s: number) { return this.seq.wait(this.talk.fast ? Math.min(s, 0.4) : s); }
  /** A wait that tests may not shorten (physical things: a walk, a fight starting). */
  private hold(s: number) { return this.seq.wait(s); }
  private until(p: () => boolean) { return this.seq.waitUntil(p); }
  private async untilOr(p: () => boolean, seconds: number): Promise<boolean> {
    const t0 = this.now;
    let ok = false;
    await this.until(() => (ok = p()) || this.now - t0 >= seconds);
    return ok;
  }
  private S(name: string, fn: () => Promise<unknown>): void { this.seq.spawn(name, fn); }

  private mark(id: string): boolean {
    if (this.done.has(id)) return false;
    this.done.add(id);
    this.prog.beats.push(id);
    this.consequence(id);
    return true;
  }
  /** A DESIGN.md beat: recorded, consequences applied, `story:beat` emitted. False = already happened. */
  private beat(id: string): boolean {
    if (!this.mark(id)) return false;
    if (this.ctx.debug.verbose) console.log(`[story] beat ${id} @${this.now.toFixed(1)}s`);
    this.ctx.events.emit('story:beat', { id });
    return true;
  }
  /** Internal run-once cue ('#id' in the record). */
  private once(id: string): boolean { return this.mark('#' + id); }

  private engage(group: string, how: 'wake' | 'spawn', stagger?: number): void {
    if (!this.prog.triggered.includes(group)) this.prog.triggered.push(group);
    this.triggeredAt.set(group, this.now);
    if (how === 'wake') this.w.wakeGroup(group, stagger); else this.w.spawnGroup(group);
  }
  private fought(g: string, minDelay = 5): boolean {
    if (!this.prog.triggered.includes(g)) return false;
    if (this.prog.cleared.includes(g)) return true;
    return this.now - (this.triggeredAt.get(g) ?? -1e9) > minDelay && this.w.alive(g) === 0;
  }

  private inRoom(room: string): boolean { return this.w.room() === room; }
  private in(xMin: number, xMax: number, zMin: number, zMax: number): boolean {
    const p = this.pos;
    return p.x >= xMin && p.x <= xMax && p.z >= zMin && p.z <= zMax;
  }
  /** Inside a level trigger right now — or, for a level build without it, inside the fallback area. */
  private at(trigger: string, fallback?: () => boolean): boolean {
    return this.insideTrig.has(trigger) || (!!fallback && fallback());
  }
  private atGlass = () => this.at('t2_glass', () => this.inRoom('line') && this.in(-10, -6, -50.5, -41.5));
  private atSpineWindow = () => this.at('t2_spine_window', () => this.inRoom('spine') && this.in(-21, -17, -52, -44));
  private inSpine = () => this.at('t2_spine', () => this.inRoom('spine'));
  private atLoad = () => this.at('t2_load', () => this.inRoom('line') && this.in(1, 8, -47, -42));
  private hallSouth = () => this.at('t2_line_south', () => this.inRoom('line') && this.pos.z < -54);
  private atCoreDoor = () => this.at('t2_core_door', () => this.inRoom('line') && this.pos.z < -66);
  private onApron = () => this.at('t2_tunnel_out', () => this.in(2.5, 7.5, -66, -62) && this.w.room() !== 'relay');

  private distTo(point: THREE.Vector3): number {
    const p = this.pos;
    return Math.hypot(p.x - point.x, p.z - point.z);
  }
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
  private isLookingAt(point: THREE.Vector3, coneDeg = 25, needLos = false): boolean {
    return this.angleTo(point) <= coneDeg * DEG && (!needLos || this.los(point));
  }
  private notLookingAt(point: THREE.Vector3, coneDeg = 64): boolean {
    return this.angleTo(point) > coneDeg * DEG || !this.los(point);
  }

  private get noteOpen(): boolean {
    if (this.legacyReading) return true;
    try { return !!this.ui.noteOpen; } catch { return false; }
  }
  private free(): boolean {
    return this.ctx.state === 'playing' && !this.noteOpen && this.w.active() === 0 && this.now - this.lastCombat > 4;
  }
  private quiet(seconds: number): void { this.quietUntil = Math.max(this.quietUntil, this.now + seconds); }
  /** Wait for a calm moment where `where()` holds; false when `expire()` came first. */
  private async cue(where: () => boolean, expire?: () => boolean): Promise<boolean> {
    let ok = false;
    await this.until(() => {
      if (expire?.()) return true;
      ok = this.now >= this.quietUntil && this.free() && where();
      return ok;
    });
    return ok;
  }

  private toast(text: string, cooldown = 0): void {
    const now = this.now;
    if (cooldown > 0 && (this.toastCooldown.get(text) ?? -1e9) > now - cooldown) return;
    this.toastCooldown.set(text, now);
    this.ctx.events.emit('story:toast', { text });
  }

  private actor(type: ActorType, position: THREE.Vector3, yaw: number, pose?: string): EnemyActor | null {
    const a = this.w.actor(type, position, yaw, pose);
    if (a) this.actors.add(a);
    return a;
  }
  private drop(a: EnemyActor | null): void {
    if (!a) return;
    this.actors.delete(a);
    this.w.removeActor(a);
  }
  private pose(a: EnemyActor | null, pose: string): void { try { a?.setPose(pose); } catch { /* ignore */ } }
  private gait(a: EnemyActor | null, gait: string): void { try { a?.setGait?.(gait); } catch { /* ignore */ } }
  private eyes(a: EnemyActor | null, on: boolean): void { try { a?.setEyes(on); } catch { /* ignore */ } }
  private lookAt(a: EnemyActor | null, p: THREE.Vector3 | null): void { try { a?.lookAt(p); } catch { /* ignore */ } }
  /** Walk an actor through points (straight segments); gives up after a generous timeout. */
  private async walk(a: EnemyActor | null, points: THREE.Vector3[], speed = 1.0): Promise<void> {
    if (!a) return;
    for (const p of points) {
      if (!this.actors.has(a)) return;
      let from = 3;
      try { from = Math.hypot(a.position.x - p.x, a.position.z - p.z); } catch { /* ignore */ }
      let arrived: Promise<unknown> = Promise.resolve();
      try { arrived = a.moveTo(p, speed).catch(() => undefined); } catch { /* ignore */ }
      await Promise.race([arrived, this.hold(from / Math.max(0.2, speed) + 2.5)]);
    }
  }
  private place(a: EnemyActor | null, p: THREE.Vector3, yaw?: number): void {
    if (!a) return;
    try {
      a.position.copy(p);
      a.object.position.copy(p);
      if (yaw !== undefined) a.object.rotation.y = yaw;
    } catch { /* ignore */ }
  }
  private headOf(a: EnemyActor): THREE.Vector3 { return this.tmp2.copy(a.position).setY(a.position.y + 1.55); }

  /** Dialogue shortcuts. */
  private say(id: string, opts?: SayOpts): Promise<boolean> { return this.talk.say(id, opts); }
  /** Tomas, in the ear. Poses follow the line. */
  private tomasSays(ids: string[], pri: 'scene' | 'talk' = 'scene'): Promise<boolean> {
    return this.talk.lines(ids, { pri, onStart: () => { if (this.tomas && !this.f.power) this.pose(this.tomas, 'talk'); } });
  }
  private bark(id: string, cooldown = 60): void {
    if (!this.f.handset || this.f.power || this.ended || !this.live) return;
    void this.say(id, { pri: 'bark', cooldown });
  }
  /** CHOIR over every speaker: chime first when it is a PA line. */
  private async choir(ids: string[], opts: { chime?: boolean; glitch?: number } = {}): Promise<void> {
    if (opts.chime) { this.w.play('pa_chime', undefined, 0.7); await this.wait(1.4); }
    await this.talk.lines(ids, { pri: 'scene', name: opts.chime ? 'PA' : 'CHOIR', gap: 0.5, onStart: () => { if (opts.glitch) this.w.glitch(opts.glitch, 0.25); } });
  }

  // ───────────────────────────────────────────────────────────── lasting consequences

  private readonly CONSEQUENCES: Record<string, () => void> = {
    l2_arrive: () => {
      this.f.arrived = true; // (the cab starts stopped at the gate: nothing to do for the machine)
      this.w.openDoor('d2_cab');
    },
    l2_hall_reveal: () => {
      this.f.hall = true;
      this.w.screen('line_bigscreen', 'terminal_alert', SCREEN2.held);
      if (this.ff) this.w.vignette('hall_screen_count');
    },
    l2_tomas_seen: () => { this.f.seen = true; },
    l2_intercom: () => { this.f.met = true; this.f.seen = true; },
    '#handset': () => { this.f.handset = true; },
    l2_rig: () => {
      this.f.rig = true;
      this.w.screen('fitting_rig_screen', 'terminal_idle', SCREEN2.rig);
      if (this.ff) this.w.vignette('fitting_rig_wake');
    },
    '#unit14_off': () => { this.f.unit14Off = true; },
    l2_pass: () => {
      this.f.pass = true;
      this.w.unlock('d2_relay');
    },
    // Section C: the doors, the bulkheads — and the local stop.
    l2_power: () => {
      const w = this.w;
      this.f.power = true;
      w.setInteractable('relay_switch', false);
      w.unlock('d2_relay');
      w.unlock('d2_spine');
      w.unlock('d2_bulkhead_s');
      w.lights('relay', { enabled: true, flicker: 'fluorescent' });
      w.screen('relay_panel', 'terminal_idle', SCREEN2.relay);
      if (this.ff) w.vignette('relay_arc');
    },
    '#line_running': () => {
      const w = this.w;
      w.machine('l2_line', 'active');
      w.machine('l2_tunnel', 'active');
      w.lights('line_emergency', { enabled: true, flicker: 'alarm' });
      w.lights('spine_emergency', { enabled: true, flicker: 'alarm' });
      w.lights('tunnel', { enabled: true, flicker: 'strobe' });
      w.screen('line_bigscreen', 'terminal_alert', SCREEN2.running);
      if (this.ff) { w.vignette('line_start'); w.vignette('spine_bulkheads'); w.vignette('booth_light_fail'); }
    },
    // He is gone from the booth. The north bulkhead is shut for good behind the units.
    l2_window: () => {
      this.f.taken = true;
      this.w.lock('d2_bulkhead_n');
      if (this.ff) this.w.vignette('booth_write_3');
    },
    '#booth_open': () => {
      this.w.unlock('d2_booth');
      this.w.setInteractable('booth_headset', true);
    },
    l2_booth_empty: () => { this.f.boothEmpty = true; },
    '#booth_hall_open': () => { this.w.unlock('d2_booth_hall'); },
    l2_loaded: () => {
      this.f.loaded = true;
      this.w.screen('line_bigscreen', 'terminal_alert', SCREEN2.yield32);
    },
    l2_apron: () => {
      this.f.apron = true;
      this.w.machine('l2_tunnel', 'idle');
    },
    '#unit32_dead': () => { this.f.unit32Dead = true; },
    l2_foreman: () => { if (!this.f.foremanDead) this.w.machine('l2_core', 'frenzy'); },
    '#foreman_dead': () => {
      this.f.foremanDead = true;
      this.w.machine('l2_core', 'active');
      this.w.unlock('d2_core');
      // Unit 14 is in front of the core door from here on: a real, dormant machine.
      if (!this.f.unit14Dead) this.w.spawnGroup('g2_unit14');
      this.showUnit14(true);
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

  private consequence(id: string): void {
    const fn = this.CONSEQUENCES[id];
    if (fn) { try { fn(); } catch (e) { console.warn(`[story] consequence ${id} failed`, e); } return; }
    if (this.ff && id.startsWith('#') && LASTING.includes(id.slice(1))) this.w.vignette(id.slice(1));
  }

  /**
   * The level may list g2_unit14 as a dormant machine (present from load) instead of a spawn: until the
   * foreman is dead Unit 14 is the puppet that follows the player, so the real one is kept out of sight.
   */
  private showUnit14(on: boolean): void {
    try { for (const e of this.ctx.enemies.all) if (e.group === 'g2_unit14') e.object.visible = on; } catch { /* ignore */ }
  }

  /** The state every run starts from. */
  private baseline(): void {
    const w = this.w;
    for (const d of ['d2_cab', 'd2_relay', 'd2_spine', 'd2_bulkhead_s', 'd2_bulkhead_n', 'd2_booth', 'd2_booth_hall', 'd2_core', 'd2_lift']) w.lock(d);
    for (const d of ['d2_intake', 'd2_line', 'd2_fitting']) w.unlock(d);
    w.setInteractable('booth_headset', false);
    w.setInteractable('core_shutdown', false);
    w.setInteractable('core_rewrite', false);
    w.setInteractable('lift_button', false);
    w.machine('l2_line', 'off');
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
    this.prog = p;
    this.done = new Set();
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
      try { lv.settle?.(14); } catch (e) { console.warn('[story] level.settle failed', e); }
    } finally {
      this.ff = false;
      try { lv.setSilent?.(false); } catch { /* ignore */ }
    }
    for (const id of p.read) this.closedAt.set(id, -1e9);
    this.director.setMood(this.baselineMood());
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
    if (f.boothEmpty) return OBJ2.follow;
    if (f.power) return OBJ2.toTomas;
    if (f.pass) return this.inRoom('relay') ? OBJ2.closeSwitch : OBJ2.toRelay;
    if (f.met) return OBJ2.findPass;
    if (f.seen) return OBJ2.intercom;
    if (f.hall) return OBJ2.knocking;
    return this.inRoom('cab') ? OBJ2.leaveCab : OBJ2.wayOut;
  }

  // ───────────────────────────────────────────────────────────── checkpoints

  private readonly CHECKPOINTS: Record<CheckpointIdL2, { when: () => boolean; valid: () => boolean }> = {
    cp2_start: { when: () => this.has('l2_dock'), valid: () => !this.f.hall },
    cp2_hall: { when: () => this.f.hall, valid: () => !this.f.met },
    cp2_pass: { when: () => this.f.pass && this.has('#fit_over'), valid: () => !this.has('#hall_mid') && !this.f.power },
    cp2_relay: { when: () => this.has('l2_relay_enter') && this.inRoom('relay'), valid: () => !this.f.power },
    cp2_apron: { when: () => this.f.apron, valid: () => !this.has('l2_unit32') },
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
    taken.push(due);
    this.lastCheckpoint = due;
    try { this.hooks.checkpoint(due); } catch (e) { console.error('[story] checkpoint failed', e); }
  }

  // ───────────────────────────────────────────────────────────── flow

  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.restoredFrom) {
      this.baseline();
      this.director.setMood('silence');
    }
    this.lastMovePos.copy(this.pos);
    if (!this.f.foremanDead) this.showUnit14(false);
    const S = (n: string, fn: () => Promise<unknown>) => this.S(n, fn);
    this.placeTomas();
    S('dock', () => this.dock());
    S('intake', () => this.intake());
    S('hall', () => this.hallReveal());
    S('seen', () => this.tomasSeen());
    S('intercom_fallback', () => this.intercomFallback());
    S('guided', () => this.guided());
    S('fitting', () => this.fitting());
    S('rig', () => this.rig());
    S('pass', () => this.passTaken());
    S('cross', () => this.hallCross());
    S('relay', () => this.relayEnter());
    if (this.f.power && !this.f.apron) S('power_resume', () => this.afterPower());
    S('apron', () => this.apron());
    S('foreman', () => this.foreman());
    S('unit14_door', () => this.unit14AtDoor());
    S('core', () => this.core());
    S('lift', () => this.lift());
    S('shadow', () => this.shadow14());
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
    w.lock('d2_cab');
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
    this.beat('l2_arrive'); // the gate opens
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
    this.ctx.ui.setHudVisible(true);
  }

  // ───────────────────────────────────────────────────────────── act 1 — the tidy place

  /** Clean, lit, wrong. One unit polishes the floor. CHOIR asks you not to interrupt. */
  private async dock(): Promise<void> {
    await this.until(() => this.live && (this.at('t2_dock') || this.inRoom('dock')));
    if (this.beat('l2_dock')) this.w.vignette('dock_polisher');
    if (this.has('#choir_dock')) return;
    await this.wait(3.5);
    if (!(await this.cue(() => true, () => this.f.hall)) || !this.once('choir_dock')) return;
    this.quiet(10);
    await this.choir(['l2_choir_dock'], { chime: true });
    if (this.once('hint_stealth')) this.toast(TOAST2.stealth);
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
    await this.choir(['l2_choir_gauge']);
  }

  // ───────────────────────────────────────────────────────────── act 2 — someone is alive

  /** Tomas is on stage from the start of the level until the units take him. */
  private placeTomas(): void {
    if (this.f.taken || this.tomas) return;
    // `sit`: his position is the chair's seat centre.
    const chair = this.w.hasObject('booth_chair') ? this.w.objectPos('booth_chair', TOMAS_DESK) : TOMAS_DESK;
    const met = this.f.met;
    const at = met ? TOMAS_AT_GLASS : chair;
    this.tomas = this.actor('human', at, face(at, GLASS), met ? 'idle' : 'sit');
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
    // Somebody saw the doors open on a monitor. He is at the glass, hitting it with the flat of his hand.
    this.place(this.tomas, TOMAS_AT_GLASS, face(TOMAS_AT_GLASS, GLASS));
    this.pose(this.tomas, 'bang_glass');
    for (let i = 0; i < 40 && !this.f.seen; i++) {
      w.play('glass_bang', GLASS, 0.9);
      await this.hold(i % 3 === 2 ? 2.4 : 0.55);
    }
  }

  /** The first sight of him, then the writing: he cannot hear you. */
  private async tomasSeen(): Promise<void> {
    if (this.f.met) return;
    await this.until(() => this.f.hall);
    await this.until(() => this.f.met || this.atGlass()
      || (this.inRoom('line') && this.distTo(GLASS) < 18 && this.isLookingAt(GLASS, 22, true)));
    if (this.f.met) return;
    if (this.beat('l2_tomas_seen')) {
      this.pose(this.tomas, 'wave');
      this.lookAt(this.tomas, this.ctx.player.eye);
    }
    await this.until(() => this.f.met || this.atGlass() || this.distTo(GLASS) < 7);
    if (this.f.met) return;
    if (this.once('booth_write_1')) {
      this.pose(this.tomas, 'write');
      this.w.play('marker_squeak', GLASS, 0.6);
      await this.hold(0.9);
      this.w.vignette('booth_write_1');
      await this.wait(2.4);
    }
    if (!this.f.met && this.once('booth_write_2')) {
      this.w.play('marker_squeak', GLASS, 0.6);
      await this.hold(0.9);
      this.w.vignette('booth_write_2');
      await this.wait(0.8);
    }
    if (!this.f.met) this.pose(this.tomas, 'idle');
  }

  /** A level build without the intercom panel: he starts talking once you stand at the glass. */
  private async intercomFallback(): Promise<void> {
    await this.until(() => this.f.hall && this.atGlass());
    await this.wait(5);
    if (!this.ctx.interactables.get('intercom_hall') && !this.f.met) this.S('intercom', () => this.intercom());
  }

  /** First talk. He has had nobody to talk to for sixty hours. */
  private async intercom(): Promise<void> {
    if (!this.beat('l2_intercom')) {
      // Pressing it again later: he is still there.
      if (this.f.handset && !this.f.power) this.bark(this.now % 2 < 1 ? 'l2_tomas_bark_glass_1' : 'l2_tomas_bark_glass_2', 45);
      return;
    }
    this.w.play('intercom_static', GLASS, 0.5);
    this.director.setMood('ambient');
    this.lookAt(this.tomas, this.ctx.player.eye);
    await this.hold(0.5);
    await this.tomasSays(['l2_tomas_hello_1', 'l2_tomas_hello_2', 'l2_tomas_hello_3', 'l2_tomas_hello_4']);
    await this.wait(0.6);
    await this.tomasSays(['l2_tomas_reyes', 'l2_tomas_oneway']);
    await this.wait(0.5);
    await this.tomasSays(['l2_tomas_estop_1', 'l2_tomas_estop_2', 'l2_tomas_sulking']);
    await this.wait(0.5);
    await this.tomasSays(['l2_tomas_ask', 'l2_tomas_pass', 'l2_tomas_handset']);
    this.once('handset');
    this.w.play('intercom_click', undefined, 0.6);
    await this.tomasSays(['l2_tomas_go']);
    this.pose(this.tomas, 'idle');
    this.lastMoveAt = this.now;
    this.once('first_talk_over');
  }

  /** Walking east: he steers, and reads the order aloud because he has read it alone for too long. */
  private async guided(): Promise<void> {
    if (this.has('l2_guided')) return;
    await this.until(() => this.has('#first_talk_over'));
    await this.until(() => this.f.pass || this.distTo(GLASS) > 6.5 || !this.inRoom('line'));
    if (this.f.pass || !this.beat('l2_guided')) return;
    await this.talk.lines(['l2_tomas_guide_east'], { pri: 'talk' });
    await this.wait(1.2);
    await this.talk.lines(['l2_tomas_order_1', 'l2_tomas_order_2', 'l2_tomas_order_3', 'l2_tomas_order_4', 'l2_tomas_order_5'], { pri: 'talk', gap: 0.6 });
    this.once('order_read');
  }

  /** The fitting bays: the stealth lesson, the treadmills in step, Unit 14. */
  private async fitting(): Promise<void> {
    await this.until(() => this.live && (this.at('t2_fitting') || this.inRoom('fitting')));
    const done = () => this.f.pass;
    if (this.f.handset && !done() && this.once('fit_stealth')) {
      this.talk.flush(true); // the order can wait: whisper
      await this.tomasSays(['l2_tomas_stealth_1', 'l2_tomas_stealth_2']);
      if (this.once('hint_stealth')) this.toast(TOAST2.stealth);
    }
    // Unit 14 steps off its treadmill and limps to the far wall: the walk is Okafor's.
    this.S('unit14_intro', () => this.unit14Intro());
    if (this.has('#fitting_sync') || done()) return;
    await this.wait(5);
    if (this.f.handset && !done() && this.once('fit_treadmills')) await this.talk.lines(['l2_tomas_treadmills'], { pri: 'talk' });
    await this.wait(4);
    if (!(await this.cue(() => this.inRoom('fitting'), done)) || !this.once('fitting_sync')) return;
    this.w.vignette('fitting_sync');
    try { (this.ctx.enemies as unknown as { syncTreadmills?: (s: number) => void }).syncTreadmills?.(4); } catch { /* ignore */ }
    this.quiet(8);
    await this.wait(2.6);
    if (this.f.handset) await this.talk.lines(['l2_tomas_sync'], { pri: 'talk' });
  }

  /** The fourth rig: the free slot in the row of treadmills the level's worker units stand on. */
  private unit14Rig(): THREE.Vector3 {
    if (this.w.hasObject('rig_unit14')) return this.w.objectPos('rig_unit14', V(17, 0, -31));
    const s = this.w.spawns('g2_fit_tread').map((x) => x.position);
    if (s.length >= 2) {
      // Extend the row by one step past the end that leaves the most room.
      const a = s[0], b = s[s.length - 1];
      const step = b.clone().sub(a).multiplyScalar(1 / (s.length - 1));
      const next = b.clone().add(step), prev = a.clone().sub(step);
      const inside = (p: THREE.Vector3) => p.x > 10.8 && p.x < 19.2 && p.z > -39.2 && p.z < -28.8;
      if (inside(next)) return next.setY(a.y);
      if (inside(prev)) return prev.setY(a.y);
    }
    return V(17.5, 0, -30.5);
  }

  private async unit14Intro(): Promise<void> {
    if (this.f.unit14Off || this.f.power) return;
    const rig = this.unit14Rig();
    const a = this.unit14 = this.actor('husk', rig, Math.PI, 'idle');
    this.gait(a, 'limp');
    if (!a) { this.once('unit14_off'); return; }
    this.unit14Busy = true;
    const head = () => this.headOf(a);
    // It has to be seen walking away.
    await this.untilOr(() => this.f.pass || (this.inRoom('fitting') && this.isLookingAt(head(), 30, true) && this.distTo(a.position) < 12), 60);
    if (this.f.handset && !this.f.pass) void this.talk.lines(['l2_tomas_unit14'], { pri: 'talk' });
    // Off the belt, to the far corner, and then it only stands and looks.
    const corner = V(rig.x > 15 ? 19.0 : 11.2, 0, rig.z > -34 ? -28.9 : -39.1);
    await this.walk(a, [V(rig.x - 1.5, 0, rig.z), V(rig.x - 1.5, 0, corner.z), corner], 0.7);
    this.lookAt(a, this.ctx.player.eye);
    this.once('unit14_off');
    this.unit14MovedAt = this.now;
    this.unit14Busy = false;
    await this.wait(1.5);
    if (this.f.handset && !this.f.pass) void this.talk.lines(['l2_tomas_unit14_off'], { pri: 'talk' });
  }

  /** The empty rig with your name on it. */
  private async rig(): Promise<void> {
    if (!this.has('l2_rig')) {
      const rig = this.w.objectPos('rig_ref', V(17.5, 1.2, -37.5));
      await this.until(() => this.live && (this.at('t2_fitting_rig') || (this.inRoom('fitting') && this.distTo(rig) < 3.2) || this.closedAt.has('tag2_rig') || this.noteId === 'tag2_rig'));
      if (this.beat('l2_rig')) {
        this.w.vignette('fitting_rig_wake');
        this.quiet(8);
        if (this.f.handset && !this.closedAt.has('tag2_rig') && this.noteId !== 'tag2_rig') void this.talk.lines(['l2_tomas_rig_1'], { pri: 'talk' });
      }
    }
    if (this.has('#rig_read')) return;
    await this.until(() => this.closedAt.has('tag2_rig'));
    if (!this.once('rig_read') || !this.f.handset || this.f.power) return;
    await this.wait(0.6);
    await this.tomasSays(['l2_tomas_rig_2', 'l2_tomas_rig_3', 'l2_tomas_rig_4']);
  }

  /** The pass comes off the desk — and the two units in the charging alcoves stand up. */
  private async passTaken(): Promise<void> {
    await this.until(() => this.live && (this.f.pass || this.w.hasKeyNamed('section_pass') || this.w.hasKey()));
    if (this.beat('l2_pass')) {
      this.toast(TOAST2.passOk);
      const fight = this.w.spawns('g2_fit_wake').length > 0;
      if (fight) { this.prog.triggered.push('g2_fit_wake'); this.triggeredAt.set('g2_fit_wake', this.now + 2); }
      if (this.f.handset) void this.say('l2_tomas_pass_taken');
      await this.hold(1.6);
      if (fight) {
        this.beat('l2_fit_fight');
        this.engage('g2_fit_wake', 'wake', 0.7);
        this.director.setMood('tension');
        await this.hold(0.8);
        if (this.f.handset) void this.say('l2_tomas_fit_fight');
      } else this.beat('l2_fit_fight');
    }
    if (this.has('#fit_over')) return;
    const t0 = this.now;
    await this.until(() => !this.prog.triggered.includes('g2_fit_wake') || this.fought('g2_fit_wake', 4) || this.now - t0 > 180);
    this.once('fit_over'); // → cp2_pass
    this.director.setMood('ambient');
    if (!this.f.handset || this.f.power) return;
    await this.wait(2.2);
    await this.tomasSays(['l2_tomas_fit_after_1']);
    await this.wait(1.4);
    await this.tomasSays(['l2_tomas_fit_after_2']);
  }

  /** Back across the hall, south to the relay room. He talks about coffee and his mother. */
  private async hallCross(): Promise<void> {
    if (this.f.power) return;
    await this.until(() => this.f.pass && this.has('#fit_over') && this.inRoom('line'));
    if (this.f.power) return;
    if (this.beat('l2_hall_cross') && this.f.handset) {
      this.S('cross_1', async () => { await this.wait(1.5); if (!this.has('#hall_mid')) await this.talk.lines(['l2_tomas_cross_1'], { pri: 'talk' }); });
      this.S('cross_wave', async () => {
        await this.until(() => this.f.power || (this.inRoom('line') && this.pos.z < -40 && this.pos.x < 2 && this.isLookingAt(GLASS, 45)));
        if (this.f.power || !this.once('cross_wave')) return;
        this.pose(this.tomas, 'wave');
        await this.talk.lines(['l2_tomas_cross_wave'], { pri: 'talk' });
        this.pose(this.tomas, 'idle');
      });
      this.S('cross_talk', async () => {
        await this.wait(7);
        if (this.f.power || this.has('#hall_mid') || !this.once('coffee')) return;
        await this.talk.lines(['l2_tomas_coffee_1'], { pri: 'talk' });
        await this.wait(5);
        if (this.f.power || this.w.active() > 0 || !this.once('mum')) return;
        await this.talk.lines(['l2_tomas_mum'], { pri: 'talk' });
      });
    }
    if (this.has('#hall_mid')) return;
    await this.until(() => this.f.power || this.hallSouth());
    if (this.f.power || !this.once('hall_mid')) return;
    if (!this.w.spawns('g2_hall_mid').length) return;
    this.engage('g2_hall_mid', 'spawn');
    this.director.setMood('tension');
    this.talk.flush(true);
    if (this.f.handset) void this.say('l2_tomas_hall_fight');
    await this.until(() => this.fought('g2_hall_mid', 4));
    this.director.setMood('ambient');
    await this.wait(2);
    if (this.f.handset && !this.f.power) void this.talk.lines(['l2_tomas_hall_after'], { pri: 'talk' });
  }

  // ───────────────────────────────────────────────────────────── act 3 — you open the door for it. Again.

  private async relayEnter(): Promise<void> {
    if (this.f.power) return;
    await this.until(() => this.live && this.f.pass && (this.at('t2_relay') || this.inRoom('relay')));
    if (this.f.power) return;
    this.relayEnteredAt = this.now;
    if (this.beat('l2_relay_enter') && this.f.handset) {
      this.talk.flush(true);
      await this.tomasSays(['l2_tomas_relay_1', 'l2_tomas_relay_2']);
      await this.wait(1.5);
      if (!this.f.power) await this.talk.lines(['l2_tomas_relay_cam'], { pri: 'talk' });
      await this.wait(4);
      if (!this.f.power) await this.talk.lines(['l2_tomas_relay_breaker'], { pri: 'talk' });
    }
    // Hale's note says what the switch also does. He can hear you not closing it.
    this.S('relay_note', async () => {
      await this.until(() => this.f.power || this.closedAt.has('note2_relay'));
      if (this.f.power || !this.f.handset || !this.once('relay_note')) return;
      await this.wait(1.2);
      if (!this.f.power) await this.tomasSays(['l2_tomas_relay_wait_2']);
    });
    await this.until(() => this.f.power || (this.inRoom('relay') && this.now - this.relayEnteredAt > 32 && !this.talk.busy && !this.noteOpen));
    if (this.f.power || !this.f.handset || !this.once('relay_wait')) return;
    await this.tomasSays(['l2_tomas_relay_wait_1']);
  }

  /** The switch. CHOIR could not reach it. */
  private async power(): Promise<void> {
    if (this.f.power) return;
    const w = this.w;
    this.ui.closeNote?.();
    const at = w.interactablePos('relay_switch') ?? w.objectPos('relay_switch', V(17.5, 1.3, -61));
    this.talk.flush();
    if (!this.beat('l2_power')) return;
    this.once('first_talk_over');
    w.play('lever', at, 1);
    w.vignette('relay_arc');
    w.play('contactor_arc', at, 1);
    w.shake(0.3);
    this.toast(TOAST2.sectionLive);
    // The relay room's own guard wakes two seconds after the arc.
    if (w.spawns('g2_relay').length) { this.prog.triggered.push('g2_relay'); this.triggeredAt.set('g2_relay', this.now + 2); }
    this.S('relay_fight', async () => {
      await this.hold(2);
      if (!w.spawns('g2_relay').length) return;
      w.wakeGroup('g2_relay', 0.5);
      w.spawnGroup('g2_relay');
    });
    await this.hold(1.4);
    w.glitch(0.8, 0.5);
    await this.choir(['l2_choir_power_1'], { glitch: 0.4 });
    // And the line starts.
    this.once('line_running');
    w.vignette('line_start');
    w.vignette('spine_bulkheads');
    w.vignette('booth_light_fail');
    w.play('belt_start', V(5, 1, -46), 1);
    try { this.loops.push(this.ctx.audio.loop('siren_loop', { volume: 0.4 })); } catch { /* ignore */ }
    this.director.setMood('tension');
    await this.choir(['l2_choir_power_2'], { glitch: 0.3 });
    this.pose(this.tomas, 'back_away');
    await this.tomasSays(['l2_tomas_power_1', 'l2_tomas_power_2']);
    await this.wait(0.6);
    await this.tomasSays(['l2_tomas_power_3']);
    await this.afterPower();
  }

  /**
   * Everything after the switch, as guarded steps (also resumed after a load — though no checkpoint is
   * taken between the switch and the apron). The player is always a few seconds late: each stage waits
   * for where the player is, not for a clock.
   */
  private async afterPower(): Promise<void> {
    const w = this.w;
    if (this.f.taken) { await this.boothAndBelt(); return; }
    this.beat('l2_run');
    // Two units come down the spine from the north. Unit 14 is with them.
    const door = BOOTH_DOOR_SPINE;
    w.openDoor('d2_bulkhead_n');
    const u1 = this.actor('husk', V(-19.4, 0, -32.6), Math.PI, 'idle');
    const u2 = this.actor('husk', V(-18.6, 0, -31.2), Math.PI, 'idle');
    this.takers = [u1, u2].filter((a): a is EnemyActor => !!a);
    for (const a of this.takers) this.gait(a, 'carry');
    this.dropUnit14Silently();
    const u14 = this.unit14 = this.actor('husk', V(-19, 0, -29.8), Math.PI, 'idle');
    this.gait(u14, 'limp');
    this.unit14Busy = true;
    this.S('takers_walk', async () => {
      await Promise.all([
        this.walk(u1, [V(-19.4, 0, -40), V(door.x - 1.1, 0, door.z - 0.75)], 1.0),
        this.walk(u2, [V(-18.6, 0, -39), V(door.x - 1.1, 0, door.z + 0.75)], 1.0),
        this.walk(u14, [V(-19, 0, -40.5)], 0.75),
      ]);
      w.lock('d2_bulkhead_n'); // shut behind them, for good
      this.pose(this.tomas, 'back_away');
    });
    this.S('run_lines', async () => {
      await this.wait(3.5);
      if (!this.unitsInside) await this.tomasSays(['l2_tomas_run_1']);
      await this.untilOr(() => this.unitsInside || this.inRoom('line'), 14);
      if (!this.unitsInside) await this.tomasSays(['l2_tomas_run_2']);
      await this.untilOr(() => this.unitsInside || this.atCoreDoor() || (this.inRoom('line') && this.pos.z < -60 && this.pos.x < -3), 16);
      if (!this.unitsInside) await this.tomasSays(['l2_tomas_run_3']);
      // He can see the hall glass and the monitors: the wrong way gets told.
      let last = this.now;
      await this.until(() => {
        if (this.unitsInside) return true;
        if (this.now - last > 22 && !this.talk.busy && this.w.active() === 0) {
          last = this.now;
          void this.say(this.atGlass() ? 'l2_tomas_run_glass' : 'l2_tomas_run_wait');
        } else if (this.atGlass() && this.once('run_glass')) { last = this.now; void this.say('l2_tomas_run_glass'); }
        return false;
      });
    });

    // ── they wait at his door until the player is in the spine ──
    await this.until(() => this.inSpine() || this.atSpineWindow() || this.inRoom('booth'));
    if (this.once('spine_skitters') && w.spawns('g2_spine').length) this.engage('g2_spine', 'spawn');
    this.unitsInside = true;
    this.talk.flush(true);
    void this.tomasSays(['l2_tomas_run_4']);
    // They knocked. Then they open it.
    w.play('glass_bang', door.clone().setY(1.4), 0.5);
    await this.hold(0.5);
    w.play('glass_bang', door.clone().setY(1.4), 0.5);
    await this.hold(0.9);
    w.openDoor('d2_booth');
    // The last thing he writes, on the hall glass, half finished.
    this.pose(this.tomas, 'write');
    this.S('write3', async () => { await this.hold(0.7); if (this.once('booth_write_3')) { w.play('marker_squeak', GLASS, 0.6); w.vignette('booth_write_3'); } });
    await Promise.all([
      this.walk(u1, [V(door.x + 1.4, 0, door.z), V(TOMAS_HELD.x, 0, TOMAS_HELD.z + 0.62)], 1.0),
      (async () => { await this.hold(1.1); await this.walk(u2, [V(door.x + 1.4, 0, door.z), V(TOMAS_HELD.x, 0, TOMAS_HELD.z - 0.62)], 1.0); })(),
      (async () => {
        await this.hold(1.3);
        this.pose(this.tomas, 'back_away');
        void this.tomasSays(['l2_tomas_run_5']);
        await this.walk(this.tomas, [TOMAS_HELD], 1.1);
        // Unit 14 comes as far as the doorway. It does not come in for him.
        await this.walk(u14, [V(door.x - 1.2, 0, door.z), V(door.x + 1.0, 0, door.z + 0.9)], 0.7);
      })(),
    ]);
    w.lock('d2_booth');
    // One on each arm.
    this.place(this.tomas, TOMAS_HELD, Math.PI / 2);
    this.pose(this.tomas, 'held');
    for (const a of this.takers) this.lookAt(a, null);
    this.gait(u1, 'carry_l'); this.gait(u2, 'carry_r');

    // ── they hold him until the player is at the window (and the spine is quiet) ──
    await this.until(() => this.atSpineWindow() || this.inRoom('booth') || (this.atGlass() && this.now - (this.triggeredAt.get('g2_spine') ?? this.now) > 40));
    await this.untilOr(() => this.w.active() === 0, 25);
    await this.windowScene(u1, u2, u14);
    await this.boothAndBelt();
  }

  /** Through thick glass. He does not scream a speech. */
  private async windowScene(u1: EnemyActor | null, u2: EnemyActor | null, u14: EnemyActor | null): Promise<void> {
    const w = this.w, eye = this.ctx.player.eye;
    this.windowStarted = true;
    this.beat('l2_window');
    this.director.setMood('silence');
    this.lookAt(this.tomas, eye);
    const unitAt = (a: EnemyActor | null) => () => (a ? this.headOf(a).clone() : null);
    await this.hold(0.8);
    await this.tomasSays(['l2_tomas_window_1']);
    await this.wait(1.0);
    await this.tomasSays(['l2_tomas_window_2']);
    this.talk.overlap('l2_unit_take_1', { at: unitAt(u1) });
    await this.wait(1.4);
    await this.tomasSays(['l2_tomas_window_3']);
    await this.wait(1.6);
    await this.tomasSays(['l2_tomas_window_4']);
    await this.wait(1.2);
    if (u14) { this.lookAt(u14, this.tomas ? this.headOf(this.tomas).clone() : null); this.talk.overlap('l2_unit14_booth', { name: 'UNIT 14', at: unitAt(u14) }); }
    await this.wait(2.2);
    await this.tomasSays(['l2_tomas_window_5']);
    this.talk.overlap('l2_unit_take_2', { at: unitAt(u2) });
    await this.wait(2.0);
    await this.tomasSays(['l2_tomas_window_6']);
    // The headset comes off. From here he makes no sound at all.
    this.lookAt(this.tomas, null);
    w.play('intercom_click', undefined, 0.7);
    w.play('intercom_static', undefined, 0.35);
    await this.wait(1.2);
    void this.choir(['l2_choir_window']);
    // Out through the hall door, toward the loading station. Unit 14 goes last.
    w.openDoor('d2_booth_hall');
    const out1 = V(BOOTH_DOOR_HALL.x - 1.6, 0, BOOTH_DOOR_HALL.z - 0.2), out2 = V(BOOTH_DOOR_HALL.x + 1.8, 0, BOOTH_DOOR_HALL.z);
    const st = this.loadStation();
    const side = V(st.x - 1.6, 0, st.z);
    const off = (dz: number) => (p: THREE.Vector3) => V(p.x, 0, p.z + dz);
    const path = [out1, out2, side];
    let unit14Out = !u14;
    this.S('unit14_leaves', async () => {
      await this.hold(3);
      await this.walk(u14, [out1, out2], 0.9);
      unit14Out = true;
      await this.walk(u14, [V(-6.5, 0, -33)], 0.9);
      this.lookAt(u14, eye);
      this.unit14Busy = false;
      this.unit14MovedAt = this.now + 30;
    });
    this.S('escort', async () => {
      await Promise.all([
        this.walk(this.tomas, path, 0.95),
        this.walk(u1, path.map(off(0.62)), 0.95),
        this.walk(u2, path.map(off(-0.62)), 0.95),
      ]);
      this.escortAtStation = true;
    });
    // The booth is the player's once they are through the far door.
    await this.untilOr(() => !!this.tomas && this.tomas.position.x > BOOTH_DOOR_HALL.x + 1.2, 12);
    await this.untilOr(() => unit14Out, 16);
    w.lock('d2_booth_hall');
    this.escortGone = true;
    this.once('booth_open');
    w.play('door_unlock', BOOTH_DOOR_SPINE.clone().setY(1.4), 0.7);
  }

  /** Belt top at the loading station (the level's marker if it has one). */
  private loadStation(): THREE.Vector3 {
    const p = this.w.hasObject('line_load_station') ? this.w.objectPos('line_load_station', V(5, 0, -44.5)) : V(5, 0, -44.5);
    const x = THREE.MathUtils.clamp(p.x, 3.6, 6.4), z = THREE.MathUtils.clamp(p.z, -46.5, -42.5);
    let y = 0.5;
    try {
      const hit = this.ctx.physics.raycast(V(x, 3.2, z), V(0, -1, 0), 3.2);
      if (hit) y = hit.point.y;
    } catch { /* ignore */ }
    return V(x, y, z);
  }

  /** The empty booth; he goes onto the belt as the player stands where he stood. */
  private async boothAndBelt(): Promise<void> {
    const w = this.w;
    if (this.f.taken && !this.has('#booth_open')) { this.once('booth_open'); this.escortAtStation = true; this.escortGone = true; }
    if (!this.f.boothEmpty) {
      await this.until(() => this.at('t2_booth') || this.inRoom('booth') || this.atLoad());
      this.beat('l2_booth_empty');
      this.director.setMood('tension');
    }
    if (!this.f.loaded) {
      // Seconds late, whatever the pace: they lay him down once the player is in the booth.
      await this.untilOr(() => this.escortAtStation, 16);
      await this.hold(1.0);
      this.beat('l2_loaded');
      const st = this.loadStation();
      const t = this.tomas;
      if (t) {
        this.place(t, st, 0);
        this.pose(t, 'carried');
        this.eyes(t, false);
        this.S('tomas_belt', async () => {
          const mouth = w.objectPos('tunnel_mouth', V(st.x, st.y, -50)).z;
          let last = this.now;
          await this.until(() => {
            const dt = this.now - last; last = this.now;
            st.z -= 1.6 * dt;
            this.place(t, st);
            return st.z < mouth - 1.4 || !this.actors.has(t);
          });
          this.drop(t);
          if (this.tomas === t) this.tomas = null;
        });
      }
      // The two that carried him go back to work.
      for (const [i, a] of this.takers.entries()) {
        this.gait(a, '');
        this.S('taker_leave', async () => {
          await this.hold(2 + i);
          await this.walk(a, [V(1.5 - i, 0, -36), V(0, 0, -24.5 + i)], 1.0);
          await this.until(() => this.notLookingAt(this.headOf(a), 70) || this.f.apron);
          this.drop(a);
        });
      }
      this.takers = [];
      await this.hold(0.6);
      this.once('booth_hall_open');
      w.openDoor('d2_booth_hall');
    }
    await this.tunnel();
  }

  /** The belt ride through the fitting tunnel, behind him. */
  private async tunnel(): Promise<void> {
    const w = this.w;
    if (this.f.apron) return;
    this.S('belt_choir', async () => {
      await this.until(() => this.f.apron || this.insideTrig.has('t2_belt') || this.at('t2_tunnel_in', () => this.in(2.5, 7.5, -53, -47.5)));
      if (!this.f.apron && this.once('choir_belt')) await this.choir(['l2_choir_belt']);
    });
    await this.until(() => this.onApron() || this.at('t2_tunnel_in', () => this.in(2.5, 7.5, -54, -50)));
    if (this.beat('l2_tunnel') && !this.onApron()) {
      w.vignette('tunnel_silhouette');
      await this.until(() => this.onApron() || this.at('t2_tunnel_mid', () => this.in(2.5, 7.5, -59, -54.5)));
      if (!this.onApron()) {
        w.vignette('tunnel_press');
        w.shake(0.3);
        if (this.once('choir_tunnel')) void this.choir(['l2_choir_tunnel']);
      }
    }
  }

  // ───────────────────────────────────────────────────────────── act 4 — he is still in there

  private unit32(): Enemy | null {
    try { return this.ctx.enemies.all.find((e) => e.group === 'g2_unit32' && e.alive) ?? null; } catch { return null; }
  }

  private async apron(): Promise<void> {
    if (this.f.unit32Dead) return;
    await this.until(() => this.f.loaded && this.onApron());
    const w = this.w;
    this.beat('l2_tunnel');
    if (this.beat('l2_apron')) {
      this.director.setMood('silence');
      for (const l of this.loops.splice(0)) { try { l.stop(3); } catch { /* ignore */ } }
      this.talk.flush();
      await this.wait(2.5);
      if (this.once('choir_apron')) await this.choir(['l2_choir_apron']);
    }
    // cp2_apron is taken here (calm). Then the next unit comes off the line.
    await this.untilOr(() => this.prog.checkpoints.includes('cp2_apron'), 6);
    // (After a load the player gets a breath on the apron first.)
    await this.hold(this.restoredFrom === 'cp2_apron' && !this.has('l2_unit32') ? 7 : 2.5);
    if (this.beat('l2_unit32')) {
      const at = () => { const e = this.unit32(); return e ? this.tmp2.copy(e.position).setY(e.position.y + 1.55).clone() : null; };
      if (w.spawns('g2_unit32').length) this.engage('g2_unit32', 'spawn');
      else { try { this.ctx.enemies.spawn('husk', w.objectPos('tunnel_exit', V(5, 0, -62.5)).setY(0), Math.PI, 'g2_unit32'); this.prog.triggered.push('g2_unit32'); this.triggeredAt.set('g2_unit32', this.now); } catch { /* ignore */ } }
      await this.hold(0.8);
      // His joke, in his voice, with nothing behind it. Then it does its job.
      await this.say('l2_unit32_1', { name: 'UNIT 32', at });
      await this.wait(0.9);
      if (this.unit32()) await this.say('l2_unit32_2', { name: 'UNIT 32', at });
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
    await this.until(() => this.fought('g2_unit32', 2) || !this.unit32());
    if (!this.once('unit32_dead')) return;
    this.director.setMood('silence');
    this.talk.flush();
    await this.hold(2.4);
    await this.choir(['l2_choir_unit32_1']);
    await this.wait(1.6);
    await this.choir(['l2_choir_unit32_2']);
  }

  private onEnemyDied(group: string): void {
    if (group === 'g2_unit32' && this.started && !this.f.unit32Dead) {
      // The last thing it says is the biscuit.
      this.talk.flush();
      this.talk.overlap('l2_unit32_die', { name: 'UNIT 32', at: this.pos.clone().setY(1.2) });
    }
    if (group === 'g2_unit14' && this.started) {
      this.once('unit14_dead');
      this.talk.overlap('l2_unit14_die', { name: 'UNIT 14' });
    }
  }

  /** The supervisor: three staff voices, out of sync (the enemies module voices it from the same lines). */
  private async foreman(): Promise<void> {
    if (this.f.foremanDead) return;
    await this.until(() => this.f.unit32Dead && this.atCoreDoor());
    if (this.beat('l2_foreman')) {
      this.director.setMood('tension');
      void this.choir(['l2_choir_foreman']);
      await this.hold(1.5);
      if (this.w.spawns('g2_foreman').length) this.engage('g2_foreman', 'wake', 1.2);
    }
    await this.until(() => !this.prog.triggered.includes('g2_foreman') || this.fought('g2_foreman', 6));
    await this.hold(1.5);
    this.dropUnit14Silently();
    this.once('foreman_dead');
    this.director.setMood('silence');
  }

  /** Unit 14 in front of the core door: a real machine now. It holds the door. It never wakes unless shot. */
  private async unit14AtDoor(): Promise<void> {
    await this.until(() => this.f.foremanDead);
    if (this.f.unit14Dead || this.has('#unit14_after_you')) return;
    // A level build without the g2_unit14 spawn: it still stands there, as a puppet beside the door.
    let puppet: EnemyActor | null = null;
    try {
      if (!this.ctx.enemies.all.some((x) => x.group === 'g2_unit14')) {
        puppet = this.unit14 = this.actor('husk', V(-2.1, 0, -68.7), Math.PI, 'idle');
        this.gait(puppet, 'limp');
        this.lookAt(puppet, this.ctx.player.eye);
      }
    } catch { /* ignore */ }
    const at = () => {
      if (puppet) return this.headOf(puppet).clone();
      try { const e = this.ctx.enemies.all.find((x) => x.group === 'g2_unit14' && x.alive); return e ? e.position.clone().setY(e.position.y + 1.55) : null; } catch { return null; }
    };
    await this.until(() => this.f.core || this.f.unit14Shot || (() => { const p = at(); return !!p && this.distTo(p) < 4.2; })());
    if (this.f.core || this.f.unit14Shot || !this.once('unit14_after_you')) return;
    await this.say('l2_unit14_door', { name: 'UNIT 14', at });
  }

  private onEnemyDamaged(id: number): void {
    if (!this.started) return;
    let e: Enemy | undefined;
    try { e = this.ctx.enemies.all.find((x) => x.id === id); } catch { return; }
    if (!e || e.group !== 'g2_unit14' || !this.f.foremanDead || !this.once('unit14_shot')) return;
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
      this.beat('l2_choice_shutdown');
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
      this.beat('l2_choice_rewrite');
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
      // From the hall, through the open door: awake.
      this.talk.overlap('l2_unit14_wait', { name: this.f.unit14Dead ? 'SERVICE UNIT' : 'UNIT 14', at: V(0, 1.5, -69) });
      await this.hold(2.4);
      await this.choir(['l2_choir_rewrite_3']);
    }
    w.unlock('d2_lift');
    w.setInteractable('lift_button', true);
    w.screen('lift_panel', 'terminal_idle', SCREEN2.liftUp);
  }

  /** Shutdown: every unit drops where it stands. Unit 14 too, if nobody is looking at it. */
  private dropUnits(): void {
    if (this.f.unit14Dead) return;
    try {
      const e = this.ctx.enemies.all.find((x) => x.group === 'g2_unit14' && x.alive);
      if (!e || e.state !== 'dormant') return;
      const p = e.position.clone();
      if (!this.notLookingAt(this.tmp.copy(p).setY(1.5).clone(), 60)) return;
      const yaw = e.object.rotation.y;
      this.ctx.enemies.removeGroup('g2_unit14');
      const a = this.actor('husk', p, yaw, 'slumped');
      this.eyes(a, false);
      this.w.play('body_fall', p, 0.8);
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
    w.lock('d2_lift');
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
    await this.hooks.ending(this.f.choice, this.f.unit14Dead ? 'killed' : this.f.unit14Shot ? 'shot' : 'spared');
  }

  // ───────────────────────────────────────────────────────────── Unit 14, at a distance

  private dropUnit14Silently(): void {
    const a = this.unit14;
    this.unit14 = null;
    this.drop(a);
  }

  /**
   * From the fitting bays until the switch, Unit 14 follows: always far, usually found when the player
   * turns round. It is only ever moved or removed while off-screen; if the player walks at it, it limps
   * away, and if cornered the lights blink and it is somewhere else.
   */
  private async shadow14(): Promise<void> {
    await this.until(() => this.f.unit14Off || this.f.power);
    for (;;) {
      await this.hold(0.5);
      if (this.f.power || this.ended) return; // from the switch on it is scripted (afterPower)
      if (this.unit14Busy || this.ctx.state !== 'playing') continue;
      let a = this.unit14;
      const room = this.w.room();
      const head = a ? this.headOf(a).clone() : null;
      const offscreen = !head || this.notLookingAt(head, 68);
      const d = a ? this.distTo(a.position) : 1e9;
      if (a && !offscreen && d < 4.5) {
        // Walked at: it backs off round the nearest corner; too close, and it is simply gone for a while.
        this.unit14Busy = true;
        const away = this.farthestStation();
        if (d < 2.8) {
          const restore = this.w.blackout('line');
          await this.hold(0.16);
          this.dropUnit14Silently();
          await this.hold(0.2);
          restore();
        } else {
          this.lookAt(a, null);
          await Promise.race([this.walk(a, [away], 1.1), this.until(() => this.notLookingAt(this.headOf(a!), 68))]);
          if (this.notLookingAt(this.headOf(a), 68)) this.dropUnit14Silently();
        }
        this.unit14MovedAt = this.now;
        this.unit14Busy = false;
        continue;
      }
      // Relocate (or appear) only unseen, only now and then, only in the hall.
      if (!offscreen || this.now - this.unit14MovedAt < 16 || this.w.active() > 0) continue;
      if (room !== 'line' && room !== 'fitting' && room !== 'relay') continue;
      if (a && d > 9 && d < 20 && this.los(head!)) continue; // already where it should be
      const spot = this.shadowStation();
      if (!spot) continue;
      if (!a) { a = this.unit14 = this.actor('husk', spot, face(spot, this.pos), 'idle'); this.gait(a, 'limp'); }
      else this.place(a, spot, face(spot, this.pos));
      if (!a) return;
      this.eyes(a, true);
      this.lookAt(a, this.ctx.player.eye);
      this.unit14MovedAt = this.now;
      if (this.w.room() === 'line' && this.has('#fit_over')) this.bark('l2_tomas_bark_unit14', 240);
    }
  }

  /** A hall station 11–24 m away, outside the view, preferably with a sightline to where the player is. */
  private shadowStation(): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bestScore = -1e9;
    for (const s of HALL_STATIONS) {
      const d = this.distTo(s);
      if (d < 11 || d > 26) continue;
      const head = this.tmp2.set(s.x, 1.55, s.z);
      if (this.angleTo(head) < 70 * DEG && this.los(head)) continue; // would pop into view
      const score = (this.los(head) ? 6 : 0) - Math.abs(d - 14) * 0.4;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best ? best.clone() : null;
  }
  private farthestStation(): THREE.Vector3 {
    let best = HALL_STATIONS[0], bd = -1;
    for (const s of HALL_STATIONS) { const d = this.distTo(s); if (d > bd) { bd = d; best = s; } }
    return best.clone();
  }

  // ───────────────────────────────────────────────────────────── barks (Tomas reacts to where you are)

  private barks(step: number): void {
    if (!this.f.handset || this.f.power || !this.live || this.ctx.state !== 'playing') return;
    const now = this.now, p = this.pos;
    if (p.distanceToSquared(this.lastMovePos) > 1.2) { this.lastMovePos.copy(p); this.lastMoveAt = now; }
    const calm = this.w.active() === 0 && !this.noteOpen && !this.talk.busy;
    if (!calm) return;
    const room = this.w.room();
    // You stopped.
    if (now - this.lastMoveAt > 26 && !this.atGlass() && room !== 'relay') {
      this.lastMoveAt = now;
      this.bark(this.quietBarks % 2 ? 'l2_tomas_bark_stop_2' : 'l2_tomas_bark_stop_1', 120);
      return;
    }
    // Long silence: he fills it.
    if (this.talk.since('tomas') > 48 && this.quietBarks < 3 && room !== 'relay') {
      this.bark(`l2_tomas_bark_quiet_${++this.quietBarks}`, 1e6);
      return;
    }
    // Wrong way.
    if ((room === 'intake' || room === 'dock') && this.has('#first_talk_over')) { this.bark('l2_tomas_bark_back', 150); return; }
    if (room === 'line' && !this.f.pass && this.has('l2_guided') && p.x > 6 && p.z < -42 && p.z > -62) { this.bark('l2_tomas_bark_left', 1e6); return; }
    if (this.insideTrig.has('t2_belt') || (room === 'line' && this.in(3, 7, -62, -42) && p.y > 0.25)) { this.bark('l2_tomas_bark_belt', 90); return; }
    if (this.atCoreDoor()) { this.bark('l2_tomas_bark_core_door', 150); return; }
    if (this.atGlass() && this.has('#first_talk_over') && now - (this.triggerAt.get('t2_glass') ?? 0) < 3 && this.has('l2_guided')) {
      this.pose(this.tomas, 'wave');
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

  private lookingAtWorker(): boolean {
    try {
      for (const e of this.ctx.enemies.all) {
        if (!e.alive || e.state !== 'dormant' || !WORKER_GROUPS.includes(e.group)) continue;
        if (this.distTo(e.position) > 9) continue;
        if (this.isLookingAt(this.tmp2.copy(e.position).setY(e.position.y + 1.6), 9, true)) return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  private onShot(): void {
    if (!this.started || this.w.active() > 0) return;
    this.S('shot_bark', async () => {
      await this.hold(0.7);
      if (this.w.active() === 0) this.bark(this.quietBarks % 2 ? 'l2_tomas_bark_shots_2' : 'l2_tomas_bark_shots_1', 50);
    });
  }

  private onHurt(health: number): void {
    if (!this.started || health <= 0) return;
    this.bark('l2_tomas_bark_hurt', 40);
  }

  /** A working unit was made to look up. */
  private onEnemyStir(id: number): void {
    if (!this.started) return;
    let e: Enemy | undefined;
    try { e = this.ctx.enemies.all.find((x) => x.id === id); } catch { return; }
    if (!e || !WORKER_GROUPS.includes(e.group)) return;
    if (this.f.handset && !this.f.power) { void this.say('l2_tomas_bark_provoked', { pri: 'bark', cooldown: 30 }); return; }
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
      case 'booth_headset': if (!this.f.taken) return; break;
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
    // His last memo is heard (recorded voice only).
    if (id === 'booth_headset' && hasSay(this.ctx)) {
      try { this.recorder?.stop(0.1); } catch { /* ignore */ }
      this.recorder = speak(this.ctx, 'l2_tomas_headset_1', { subtitle: false }).handle;
      const d = this.recorder?.duration ?? 3.5;
      const mine = this.recorder;
      setTimeout(() => { if (this.recorder === mine && this.noteId === id) this.recorder = speak(this.ctx, 'l2_tomas_headset_2', { subtitle: false }).handle; }, (d + 0.5) * 1000);
    } else if (id.startsWith('note2_') || id.startsWith('term2_')) this.bark('l2_tomas_bark_read', 120);
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
    const f = this.f;
    switch (id) {
      case 'd2_relay':
        if (!f.pass) { this.toast(TOAST2.needPass, 4); this.bark('l2_tomas_bark_relay_locked', 60); }
        break;
      case 'd2_spine': case 'd2_bulkhead_s': case 'd2_booth':
        if (!f.power) { this.toast(TOAST2.noPower, 4); this.bark('l2_tomas_bark_spine_dead', 90); }
        else if (id === 'd2_booth') this.toast(TOAST2.interlockRun, 4);
        break;
      case 'd2_bulkhead_n': this.toast(f.power ? TOAST2.sealed : TOAST2.noPower, 4); break;
      case 'd2_booth_hall': this.toast(f.power ? TOAST2.interlockRun : TOAST2.interlock, 4); break;
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

  /** `?nostory=1`: no beats; every door open; the line stays held. */
  openEverything(): void {
    for (const d of ALL_DOORS) this.w.unlock(d);
    try { for (const d of this.ctx.level.doors) d.unlock(); } catch { /* ignore */ }
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
    if (fast !== undefined) this.talk.fast = fast;
  }

  get debugState() {
    return {
      level: 2, beats: [...this.prog.beats], quietFor: Math.max(0, this.quietUntil - this.now), note: this.noteId,
      flags: { ...this.f }, actors: this.actors.size, mood: this.director.mood, speaking: this.talk.speaking, talking: this.talk.busy,
      tomas: this.tomas ? [this.tomas.position.x, this.tomas.position.y, this.tomas.position.z].map((v) => +v.toFixed(2)) : null,
      unit14: this.unit14 ? [this.unit14.position.x, this.unit14.position.z].map((v) => +v.toFixed(2)) : null,
      windowStarted: this.windowStarted, unitsInside: this.unitsInside, escortGone: this.escortGone,
      restoredFrom: this.restoredFrom, checkpoint: this.lastCheckpoint, pendingCheckpoint: this.pendingCheckpoint,
      checkpoints: [...this.prog.checkpoints], calm: this.started && this.calm(),
      triggered: [...this.prog.triggered], cleared: [...this.prog.cleared], power: this.f.power,
    };
  }
}
