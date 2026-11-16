/**
 * Level 3 script — shared state: flags, places, the cast, phase derivation, the FACTS the lines may ask, and the
 * takeover state (stage 3a §3, §4, §6). Layers (as level 2):
 *   ../stage/base.ts   the scaffolding (record, beats, waits, latches, fights, checkpoints, fast-forward, dialogue)
 *   base.ts (this)     level 3's flags, places, cast, phase, facts, world-state helpers
 *   scenes.ts          the two cutscenes (C1 "Sealed in till tomorrow", C2 "Camera one")
 *   script.ts          the flow: arrival, lock, quiet side, office, escape, purge, end; checkpoints; reactions
 */
import * as THREE from 'three';
import type { EnemyActor, GameContext, LoopHandle } from '../../core/types';
import type { Sequencer } from '../sequencer';
import type { MusicDirector } from '../director';
import type { World } from '../world';
import type { CheckpointIdL3, ProgressL3 } from '../save';
import { StageBase, V, DEG, type StageHooks } from '../stage/base';
import { applyPhase3, type PhaseId3 } from '../../level/l3/phases';
import { L3_DIALOGUE, phaseRank, type Facts3 } from './dialogue';
import { SCREEN3, lobbyStatus } from './text';

export { V, DEG };

export interface HooksL3 extends StageHooks<CheckpointIdL3> {
  /** D19: the stage end (carry for 3b, end card, menu). */
  end(): Promise<void>;
}

export interface Flags3 {
  arrived: boolean; liftOpen: boolean; latched: boolean; released: boolean; quiet: boolean;
  /** C1 started (the inner door opened: S1). */
  met: boolean;
  /** C2 (in the black: S2). */
  c2: boolean;
  takeover: boolean;
  /** C2 over, control back in the office (E). */
  office: boolean;
  /** The office latch held (F). */
  left: boolean;
  /** d3_lobby_inner opened for g3_admin (the puppets promoted). */
  adminOpen: boolean;
  /** g3_canteen started. */
  canteen: boolean;
  /** Transient: d3_kitchen open for the kitchen husk (F_kitchen). */
  kitchenOpen: boolean;
  breach: boolean;
  /** The breach group's shutter opened (G). */
  shutter: boolean;
  /** g3_garden (the sentry) spawned. */
  garden: boolean;
  purge: boolean;
  /** Transient: d3_ring_e open for g3_breach_2 (H_ring). */
  ringOpen: boolean;
  breach2: boolean;
  bioOpen: boolean;
  sealed: boolean;
  /** Doors whose leaf was shot (comma list, e.g. d3_q3). */
  shotDoors: string;
}
export const FLAGS3: Flags3 = {
  arrived: false, liftOpen: false, latched: false, released: false, quiet: false, met: false, c2: false, takeover: false, office: false,
  left: false, adminOpen: false, canteen: false, kitchenOpen: false, breach: false, shutter: false, garden: false, purge: false,
  ringOpen: false, breach2: false, bioOpen: false, sealed: false, shotDoors: '',
};
export function emptyProgress3(): ProgressL3 {
  return { beats: [], read: [], visited: [], heard: [], flags: { ...FLAGS3 }, triggered: [], cleared: [], checkpoints: [], t: 0 };
}

// ───────────────────────────────────────────────────────────── places (§2, §4; level markers win)

/**
 * Story-side offsets (§4.3 is too far for a seated man who reaches 0.6–0.8 m: the desk's front edge x −31.8 is
 * 0.8 m from the plan's seat). Listed for the dressing task: move the chair / phone / monitor to these.
 */
export const OFFICE = {
  /** His seat (chair-seat centre), facing +x; desk front edge 0.35 m ahead (x −31.8), top 0.76. */
  seat: V(-32.15, 4.8, -24.2),
  seatYaw: -Math.PI / 2,
  desk: { front: 0.35, top: 0.76 },
  phone: V(-31.7, 5.57, -24.6),
  monitorArm: V(-31.3, 5.88, -23.8),
  badge: V(-31.0, 5.565, -24.0),
  speaker: V(-30.5, 7.62, -22.6),
  visitor: V(-29.5, 4.8, -24.2),
  visitorEye: V(-29.5, 6.0, -24.2),
  endPos: V(-29.4, 4.8, -23.6),
  endYaw: 3.02,
  endPitch: -0.05,
  aquarium: V(-33.4, 5.6, -21.2),
};
export const C1P = {
  body: V(-18.7, 4.8, -9.0), eye: V(-18.7, 6.45, -9.0), look: V(-20.0, 6.35, -9.0), dolly: V(-20.6, 6.45, -9.0),
  h1: V(-21.0, 4.8, -9.0), walk: V(-23.5, 4.8, -9.0),
};
export const PUPPET_LOCK = [V(0, 4.8, -5.6), V(0, 4.8, -4.2), V(0, 4.8, -2.8)];
export const PUPPET_PATH = [V(0, 4.8, -8.6), V(-11.0, 4.8, -9.5)];
export const PUPPET_END = [V(-18.6, 4.8, -8.2), V(-18.4, 4.8, -9.8), V(-17.2, 4.8, -9.0)];
export const FEED_UNITS = Array.from({ length: 8 }, (_, i) => V(61.8 + 1.2 * i, 0, -5.0));
export const FEED_WALK = [V(60.8, 0, -3.0), V(71.2, 0, -3.0)];
export const CAM01 = { pos: V(9.0, 7.5, -11.5), look: V(-2.0, 6.0, -8.0), fov: 62 };
export const CAM04 = { pos: V(66, 3.5, -1.0), look: V(66, 1.0, -8.0), fov: 58 };
export const HATCH_A = V(-18, 0, -41), HATCH_B = V(-14.5, 0, -37.5), KITCHEN_DOOR = V(-21, 0, -46);
export const RING_E = V(28, 1.4, -31);
export const RADIO_ADMIN = V(-22, 5.8, -8), RADIO_CANTEEN = V(-19.5, 0.95, -43.8), POOL = V(0, 0.4, -27);
export const PDOOR = V(0, 6.2, -7);
export const BIO_DOOR = V(12, 6.2, -38);

/** Habitat screens that die at the takeover (§6.5: not the pressure panels, bio_*, door panels; lobby_status alerts). */
export const DYING_SCREENS = [
  'admin_screen_1', 'admin_screen_2', 'admin_screen_3', 'admin_screen_4', 'admin_screen_5', 'admin_screen_6', 'admin_screen_7', 'admin_screen_8',
  'canteen_menu', 'clinic_monitor', 'lift3_panel',
];
const WARM_GROUPS = ['gallery_n', 'lobby', 'admin', 'stair_w', 'canteen', 'clinic', 'quarters'];
const EMERG_GROUPS = ['gallery_emerg', 'lobby_emerg', 'admin_emerg', 'stair_w_emerg', 'canteen_emerg', 'clinic_emerg', 'atrium_emerg'];
/** Doors whose leaves the story listens for hits on (R3 conditions: `l3_halv_door`, the cabins). */
const WATCHED_DOORS = ['d3_office', 'd3_q1', 'd3_q2', 'd3_q3', 'd3_q4', 'd3_q5', 'd3_q6'];

interface AtriumFx {
  viewport?: { setState?(s: string, seconds?: number): void };
  falls?: { setFlow?(f: number, seconds?: number): void };
  pool?: { setFlow?(f: number, seconds?: number): void; setGlow?(l: number, seconds?: number): void };
  lampGrid?: { setState?(s: string, o?: Record<string, unknown>): void };
}

export abstract class Base3 extends StageBase<Flags3, PhaseId3, CheckpointIdL3, Facts3, ProgressL3> {
  protected declare hooks: HooksL3;

  // ── the cast ──
  protected halv: EnemyActor | null = null;
  protected halvPose = '';
  protected halvAt: 'none' | 'h1' | 'walk' | 'h2' = 'none';
  /** The three C2 units: in the lock, then walking, then at the inner door (sealed in the lobby). */
  protected puppets: EnemyActor[] = [];
  protected feedActors: EnemyActor[] = [];

  // ── session state ──
  protected controlAt = -1e9;
  protected lastBusyAt = 0;
  protected doorHitAt = new Map<string, number>();
  protected viewportHitAt = -1e9;
  protected purgeAt = -1e9;
  protected loopsNamed = new Map<string, LoopHandle>();
  protected inScene = false;
  /** Set by a scene's skip path: the takeover is applied instantly (no waves, no sounds). */
  protected instantNext = false;

  constructor(ctx: GameContext, seq: Sequencer, director: MusicDirector, w: World, logs: Set<string>, hooks: HooksL3) {
    super(ctx, seq, director, w, logs, hooks, L3_DIALOGUE);
    this.talk.bindActor('halvorsen', () => this.halv);
    this.trackPlayer();
    ctx.events.on('bullet:impact', (e) => this.onImpact(e.point, e.surface));
  }

  protected emptyProgress(): ProgressL3 { return emptyProgress3(); }
  protected override onPose(a: EnemyActor, pose: string): void { if (a === this.halv) this.halvPose = pose; }
  protected get t(): number { return this.prog.t; }

  // ── phases (the level's table is the single source of door state) ──

  protected get phase(): PhaseId3 {
    const f = this.f;
    if (f.sealed) return 'J';
    if (f.bioOpen) return 'I';
    if (f.purge) return f.ringOpen ? 'H_ring' : 'H';
    if (f.shutter) return 'G';
    if (f.left) return f.kitchenOpen ? 'F_kitchen' : 'F';
    if (f.office) return 'E';
    if (f.takeover) return 'S2T';
    if (f.c2) return 'S2';
    if (f.met) return 'S1';
    if (f.quiet) return 'C';
    if (f.released) return 'B2';
    if (f.latched) return 'B';
    if (f.liftOpen) return 'A2';
    return 'A';
  }
  protected applyPhaseTo(id: PhaseId3, snap: boolean): void {
    try { applyPhase3(this.ctx, id, { snap }); } catch (e) { console.warn(`[story] applyPhase ${id} failed`, e); }
  }

  // ── world helpers ──

  protected mat(name: string): THREE.MeshStandardMaterial | undefined {
    try { return this.ctx.level.screen(name); } catch { return undefined; }
  }
  /** A dead screen (no `screen_off` kind: the badge drawer's 'off' state is a black panel). */
  protected screenOff(name: string): void {
    const m = this.mat(name);
    if (m) { try { this.ctx.materials.setScreen(m, 'badge', { text: 'off' }); } catch { /* ignore */ } }
  }
  protected pressurePanels(text: string): void {
    this.w.screen('pdoor_panel', 'pressure', text);
    this.w.screen('pdoor_panel_out', 'pressure', text);
  }
  protected lobbyBoard(): void {
    this.w.screen('lobby_status', 'habitat_status', lobbyStatus(this.t, this.choice, this.f.takeover));
  }
  protected get choice(): 'stop' | 'command' { return this.ctx.facts.choice === 'command' ? 'command' : 'stop'; }
  protected sfx(id: string, at?: THREE.Vector3, volume?: number): void { this.w.play(id, at, volume); }
  protected startLoop(name: string, id: string, at?: THREE.Vector3, volume = 0.6): void {
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
  protected atriumFx(): AtriumFx | null {
    try {
      const lv = this.ctx.level as unknown as { object?(n: string): THREE.Object3D | undefined; objects?: Map<string, THREE.Object3D> };
      const o = lv.object?.('atrium_fx') ?? lv.objects?.get?.('atrium_fx');
      return (o?.userData ?? null) as AtriumFx | null;
    } catch { return null; }
  }
  protected grade(warmth: number, seconds: number): void {
    try { this.ctx.render.post.grade?.(warmth, seconds); } catch { /* ignore */ }
  }
  /** Seconds since the dialogue channel was last busy. */
  protected get channelIdle(): number { return this.talk.busy ? 0 : this.now - this.lastBusyAt; }

  /**
   * The takeover (C2 t 19.4, §4.3, §2.6): warm habitat → cold. `instant`: a checkpoint load / a skip (no waves,
   * no sounds). Doors come from the phase (S2T). Lights, grade, screens, loops, the atrium's effect handles.
   */
  protected takeoverState(instant: boolean): void {
    const w = this.w;
    for (const g of WARM_GROUPS) w.lights(g, { enabled: false });
    for (const g of EMERG_GROUPS) w.lights(g, { enabled: true });
    w.lights('lock', { intensityScale: 0.5, flicker: 'alarm' });
    // the atrium keys go out north → south over 3 s (each light by its z)
    let day: readonly { enabled: boolean; position: THREE.Vector3 }[] = [];
    try { day = this.ctx.render.lights.group('atrium_day'); } catch { /* ignore */ }
    for (const h of day) {
      if (instant) { h.enabled = false; continue; }
      const k = THREE.MathUtils.clamp((-12 - h.position.z) / 32, 0, 1);
      this.S('lamp_wave', async () => { await this.hold(0.2 + 3 * k); h.enabled = false; });
    }
    this.grade(-0.6, instant ? 0 : 3);
    const fx = this.atriumFx();
    try {
      fx?.viewport?.setState?.('cold', instant ? 0 : 3);
      fx?.falls?.setFlow?.(0, instant ? 0 : 6);
      fx?.pool?.setFlow?.(0, instant ? 0 : 6);
      fx?.pool?.setGlow?.(0, instant ? 0 : 1.5);
      fx?.lampGrid?.setState?.('dead', { wave: instant ? 0 : 3, flicker: instant ? 0 : 0.6 });
      fx?.lampGrid?.setState?.('emergency', { wave: instant ? 0 : 3, delay: instant ? 0 : 4.5 });
    } catch (e) { console.warn('[story] atrium fx failed', e); }
    for (const s of DYING_SCREENS) {
      if (instant) { this.screenOff(s); continue; }
      w.screen(s, 'static');
      this.S('screen_die', async () => { await this.hold(0.4 + Math.random() * 0.5); this.screenOff(s); });
    }
    this.pressurePanels(SCREEN3.sealed);
    this.lobbyBoard();
    for (const n of ['radio_admin', 'radio_canteen', 'fountain', 'aquarium']) this.stopLoop(n, instant ? 0 : 0.3);
    // the audio mood: a `habitat_takeover` beat switches the habitat to the cold bed (also on a load)
    this.ctx.events.emit('story:beat', { id: 'habitat_takeover' });
    if (!instant) {
      this.sfx('habitat_takeover', undefined, 0.8);
      this.sfx('fountain_stop', POOL, 0.7);
      this.sfx('lamps_die', V(0, 10, -28), 0.7);
      this.startLoop('static_admin', 'radio_static', RADIO_ADMIN, 0.4);
      this.S('static_off', async () => { await this.hold(4); this.stopLoop('static_admin', 1.5); });
      this.S('far_alarm', async () => { await this.hold(1.2); this.sfx('alarm_soft', V(-20, 6, -30), 0.5); await this.hold(2.6); this.sfx('alarm_soft', V(20, 2, -30), 0.4); });
    }
  }

  // ── reactions the facts need ──

  private onImpact(p: THREE.Vector3, surface: string): void {
    if (surface === 'glass' && ((Math.abs(p.z + 44) < 0.35 && Math.abs(p.x) < 8.3) || (Math.abs(p.x + 24) < 0.35 && p.z > -42.2 && p.z < -36.8))) this.viewportHitAt = this.now;
    for (const id of WATCHED_DOORS) {
      const d = this.door(id);
      if (!d) continue;
      const y0 = d.y ?? 0;
      if (Math.hypot(p.x - d.position.x, p.z - d.position.z) < 0.9 && p.y > y0 && p.y < y0 + 2.5) {
        this.doorHitAt.set(id, this.now);
        const list = this.f.shotDoors ? this.f.shotDoors.split(',') : [];
        if (!list.includes(id)) { list.push(id); this.f.shotDoors = list.join(','); }
      }
    }
  }

  protected doorDist(id: string): number {
    const d = this.door(id);
    return d ? Math.hypot(this.pos.x - d.position.x, this.pos.z - d.position.z) : 1e9;
  }

  // ───────────────────────────────────────────────────────────── facts

  protected readonly facts: Facts3 = ((self: Base3): Facts3 => {
    const common = self.commonFacts();
    const extra = {
      get phase() { return self.phase; },
      atLeast: (p: PhaseId3) => phaseRank(self.phase) >= phaseRank(p),
      get choice() { return self.choice; },
      get armed() { return self.ctx.player.currentWeapon !== null; },
      get hasBadge() { return self.ctx.player.hasKey('facilities_badge'); },
      get controlFor() { return self.now - self.controlAt; },
      get channelIdle() { return self.channelIdle; },
      get inOffice() { return self.w.room() === 'office'; },
      shotDoorWithin: (d: string, s: number) => self.now - (self.doorHitAt.get(d) ?? -1e9) <= s,
      shotDoorEver: (d: string) => (self.f.shotDoors ?? '').split(',').includes(d),
      distToDoor: (d: string) => self.doorDist(d),
      viewportHitWithin: (s: number) => self.now - self.viewportHitAt <= s,
      get purgeFor() { return self.f.purge && !self.f.bioOpen ? self.now - self.purgeAt : -1; },
      awakeNear: (r: number) => self.hostilesWhere((e) => e.state !== 'dormant' && e.position.distanceTo(self.pos) <= r).length,
      get pressureOpen() { const d = self.door('d3_pressure'); return !!d && !d.closed; },
    };
    const out = Object.create(null) as Facts3;
    Object.defineProperties(out, Object.getOwnPropertyDescriptors(common));
    Object.defineProperties(out, Object.getOwnPropertyDescriptors(extra));
    return out;
  })(this);
}
