/**
 * Stage 3c §8.2.5 — the soldier's firing rules: THE ONE TUNING TABLE (`SOLDIER_TUNING`, the reviewer's S3 numbers;
 * IA retunes here without touching behaviour), the hit-chance curve, and the level-wide `SoldierDirector` (two fire
 * tokens, the 18 / s damage cap, the 1.5 s "lit" window after the player fires, cover claims, suppression intake from
 * the player's shots, body drops, the debug log behind `enemies.debug.soldiers()` / `soldierLog()`).
 */
import * as THREE from 'three';
import type { CoverPoint, GameContext, SoldierArms, SoldierDebug } from '../../core/types';

const DEG = Math.PI / 180;

export const SOLDIER_TUNING = {
  hp: 100,
  /** Damage multipliers by hit volume part (plate carrier: torso 0.8 — pistol / carbine 7 body hits, 3 head). */
  mult: { head: 2.0, torso: 0.8, limb: 0.7 } as Record<string, number>,
  /**
   * Buckshot from ≤ `range` m (the player's shotgun): every pellet × `mult` on any part (× head 2.0 on the head) instead
   * of the bullet multipliers above, and one shell deals at most `shellMax`. Measured on the real body at 5 m, aimed at
   * the chest: ≈ 5.6 of 9 pellets land (torso 4.1, arms / legs 1.45, head 0.1) → ≈ 71 per shell; 2 shells need 8 of 18
   * pellets; never 1 shell, even at contact (plan §5.3: 2 shells ≤ 6 m). Beyond 6 m the bullet table applies.
   */
  buckshot: { range: 6, mult: 1.4, shellMax: 90 },
  /** Rise over low cover / lean out of high cover / raise in the open (s); light + glint on from its start. */
  rise: 0.35,
  /** Steady aim before the burst (s); `soldier_aim_click` at its start. */
  aim: 0.45,
  burst: { pistol: { n: 4, interval: 0.52 }, carbine: { n: 5, interval: 0.11 } } as Record<SoldierArms, { n: number; interval: number }>,
  /** Between bursts (s, uniform); it runs on through a reload. */
  gap: { pistol: [0.4, 0.9], carbine: [0.4, 0.8] } as Record<SoldierArms, [number, number]>,
  /** After the last round: hold the aim, then back into cover (s); the light goes off at the end of `back`. */
  holdAfter: 0.3, back: 0.4,
  /** Per hit on the player (`player.damage`, armour absorbs ⅔ while it lasts — as built). */
  damage: { pistol: 9, carbine: 7 } as Record<SoldierArms, number>,
  /** Hit chance by eye-to-eye range (m → p), linear between, clamped at the ends. Resolved per shot. */
  hitBase: [[8, 0.75], [15, 0.55], [25, 0.35], [35, 0.20]] as [number, number][],
  hitMods: {
    crossing: 0.5, crossingSpeed: 3.0,   // the player crosses his line at ≥ 3 m/s
    sprinting: 0.7, sprintSpeed: 4.2,    // horizontal speed above walk (3.6) = sprinting
    partly: 0.6, partlyMax: 2,           // ≤ 2 of 4 axis points visible (sentry.ts heights)
    crouched: 0.7,                       // player eye < 1.3 m above his feet
    suppressed: 0.4, suppressedAt: 0.5,  // his own suppression ≥ 0.5
  },
  /** He aims at the player's eye from `seconds` ago, `drop` m lower (the rig's aim point; the miss placement). */
  lag: { seconds: 0.25, drop: 0.35 },
  /** The first burst of every engagement misses; a new engagement only after ≥ 12 s unseen. */
  firstMissReset: 12,
  /** A burst in its rise / aim is cancelled only by one hit ≥ 25 (after multipliers) or a head hit. */
  cancelDamage: 25,
  /** Head hit or ≥ 25 in one hit → stagger 0.6 s; every hit flinches 0.25 s. */
  staggerDamage: 25, stagger: 0.6, flinch: 0.25,
  retreat: { damage: 40, window: 3, supp: 1.5, hp: 35 },
  supp: {
    gain: { carbine: 0.25, pistol: 0.35, shotgun: 0.6 } as Record<string, number>,
    /** A round passing within (or impacting within) this of his head. */
    radius: 1.5,
    /** Gain cap per shooter (the player) per second — a held trigger never pins him for good. */
    capPerSecond: 0.8,
    decay: 0.5,
    /** ≥ 1.0: no peeks until 1.5 s after it drops below 1.0. */
    noPeek: 1.0, noPeekAfter: 1.5,
    /** ≥ 1.0 (rising edge): choose cover now. */
    move: 1.0,
  },
  /** The player is "lit" this long after he fires: any soldier with an eye ray sees him at 30 m, dark or not. */
  lit: 1.5,
  sight: {
    range: 30, cone: 70 * DEG, close: 4, rate: 6,
    /** `regions.dark` with the lamp off: range, and how long sight must hold before he notices. */
    darkRange: 12, darkHold: 0.8,
    /** The flashlight beam on him (≤ this angle off the player's forward) this long within range = notice. */
    beamRange: 25, beamHold: 0.5, beamAngle: 0.3,
    /** Glass passes sight (re-cast up to this many panes); every other collider blocks it. */
    glass: 3,
  },
  hearing: { sprint: 8 },
  /** Level-wide: at most this many soldiers in rise / aim / burst at once. */
  tokens: 2,
  /** ≤ this much health + armour damage per second from all soldiers together (excess shots resolve as misses). */
  cap: 18,
  walk: 1.6, retreatSpeed: 3.0,
  /** Leaving a used / pressed / flanked point for the next (weapon up, never toward the player faster than `walk`). */
  relocateSpeed: 2.2,
  reload: { pistol: { rounds: 12, time: 1.8 }, carbine: { rounds: 30, time: 2.4 }, audible: 20 } as const,
  cover: {
    every: [2.5, 4] as [number, number],
    /** Relocate (another point) after this many bursts from one point (uniform integer), or when suppressed / hurt there. */
    relocate: [2, 3] as [number, number],
    radius: 14, path: 20, claimExpire: 2, candidates: 12, rays: 24,
    rangeBand: { pistol: [6, 18], carbine: [10, 28] } as Record<SoldierArms, [number, number]>, rangeFloor: 0.3, rangeFall: 6,
    advanceMax: 6, advanceBonus: 0.15, minPlayer: 7,
    flankMin: 15 * DEG, flankMax: 40 * DEG, flankBonus: 0.2,
    novelty: 0.3, otherSet: 0.6, stay: 0.1,
    /** Score × (1 − travel × path m), floor travelFloor: short moves preferred (the walk is his exposed time). */
    travel: 0.035, travelFloor: 0.5,
    /** Suppression / damage only count as "pressed at this point" once he has held it this long (s). */
    settle: 1.2,
    huskClear: 3, separation: 1.2, doorClear: 1.0,
    /**
     * Low cover: the real kneeling body (W3a rig, measured): chest 0.69, eye 0.97, helmet top 1.15 — under every 1.2 m
     * object (§13 S1e); the safety rays test the chest and a point 5 cm under the helmet top. High: standing.
     */
    lowChest: 0.69, lowHead: 1.1, highChest: 1.3, highHead: 1.65, peekEye: 1.6, lean: 0.35,
    /** High cover: the body steps this far to the peek side for the lean (with the rig's own lean ≈ 0.45 m at the eye). */
    leanStep: 0.3,
  },
  search: { after: 6, look: 4, maxPath: 30 },
  hold: { shotNear: 1.5, sees: 6 },
  friendly: { clear: 0.5, wait: 0.3, tries: 3 },
  miss: { min: 0.4, max: 1.2, band: 1.5, whiz: 2.5 },
  drops: { pistol: 8, carbine: 15, carbineGun: 30, touch: 1.2 },
  /** Eye heights of the behaviour's model (the rig's real eye is used for sight; these for cover geometry). */
  eye: { stand: 1.63, crouch: 0.97 },
};

export type SoldierTuning = typeof SOLDIER_TUNING;

/** Base hit chance at an eye-to-eye range (m). */
export function hitBase(d: number): number {
  const T = SOLDIER_TUNING.hitBase;
  if (d <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) {
    if (d <= T[i][0]) { const [d0, p0] = T[i - 1], [d1, p1] = T[i]; return p0 + (p1 - p0) * (d - d0) / (d1 - d0); }
  }
  return T[T.length - 1][1];
}

/** What a shot's hit chance depends on (besides range). */
export interface HitCtx { crossing: number; speed: number; visible: number; crouched: boolean; supp: number }
export function hitChance(d: number, c: HitCtx): number {
  const M = SOLDIER_TUNING.hitMods;
  let p = hitBase(d);
  if (c.crossing >= M.crossingSpeed) p *= M.crossing;
  if (c.speed > M.sprintSpeed && !c.crouched) p *= M.sprinting;
  if (c.visible <= M.partlyMax) p *= M.partly;
  if (c.crouched) p *= M.crouched;
  if (c.supp >= M.suppressedAt) p *= M.suppressed;
  return p;
}

// ───────────────────────────────────────────────────────────── the director

/** What the director needs from a soldier (soldier.ts implements it). */
export interface DirectedSoldier {
  readonly id: number; readonly group: string; readonly alive: boolean; readonly arms: SoldierArms;
  readonly position: THREE.Vector3;
  /** Head point for suppression (world). */
  headPoint(out: THREE.Vector3): THREE.Vector3;
  /** A player's round came within `d` m of his head (or hit near him). */
  nearMiss(weapon: string, d: number): void;
  /** The player sprinted within earshot. */
  heardSprint(at: THREE.Vector3): void;
  /** Another member of his group noticed the player at `at`. */
  told(at: THREE.Vector3): void;
  debugRow(): SoldierDebug;
}

export interface SoldierLogRow { t: number; id: number; ev: string; [k: string]: unknown }

interface Drop { id: number; pos: THREE.Vector3; arms: SoldierArms; taken: boolean }

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _h = new THREE.Vector3(), _c = new THREE.Vector3();

export class SoldierDirector {
  readonly soldiers: DirectedSoldier[] = [];
  /** Soldier ids holding a fire token. */
  readonly tokens = new Set<number>();
  /** Soldier damage dealt to the player (raw, before armour): [time, amount]. */
  private dealt: [number, number][] = [];
  litUntil = -1;
  /** Cover point id → who holds it and until when (claims expire 2 s after he leaves). */
  readonly claims = new Map<string, { id: number; until: number }>();
  /** Cached nearest nav node of each cover point. */
  readonly coverNode = new Map<string, number>();
  readonly log: SoldierLogRow[] = [];
  logOn = true;
  private drops: Drop[] = [];
  /** Debug (tests): the damage cap off (statistics runs); a fixed gap between bursts; first-miss off. */
  debugNoCap = false;
  /** Player's per-second suppression intake per soldier is capped: soldier id → [time, gain][] */
  private intake = new Map<number, [number, number][]>();

  constructor(private ctx: GameContext, private now: () => number) {
    const ev = ctx.events;
    ev.on('weapon:fired', ({ weapon, origin, direction }) => this.playerFired(weapon, origin, direction));
    ev.on('player:footstep', ({ position, running }) => {
      if (!running) return;
      const r = SOLDIER_TUNING.hearing.sprint;
      for (const s of this.soldiers) if (s.alive && s.position.distanceToSquared(position) < r * r) s.heardSprint(position);
    });
  }

  register(s: DirectedSoldier): void { this.soldiers.push(s); }
  unregister(s: DirectedSoldier): void {
    const i = this.soldiers.indexOf(s);
    if (i >= 0) this.soldiers.splice(i, 1);
    this.tokens.delete(s.id);
    for (const [k, c] of this.claims) if (c.id === s.id) this.claims.delete(k);
  }

  push(row: SoldierLogRow): void {
    if (!this.logOn) return;
    this.log.push(row);
    if (this.log.length > 6000) this.log.splice(0, 1000);
  }

  // ── tokens
  takeToken(id: number): boolean {
    if (this.tokens.has(id)) return true;
    if (this.tokens.size >= SOLDIER_TUNING.tokens) return false;
    this.tokens.add(id);
    return true;
  }
  dropToken(id: number): void { this.tokens.delete(id); }

  // ── damage cap: true = this hit may land (and is booked)
  allowHit(amount: number): boolean {
    const t = this.now();
    while (this.dealt.length && this.dealt[0][0] <= t - 1.0) this.dealt.shift();
    let sum = 0;
    for (const [, a] of this.dealt) sum += a;
    if (!this.debugNoCap && sum + amount > SOLDIER_TUNING.cap + 1e-6) return false;
    this.dealt.push([t, amount]);
    return true;
  }

  get lit(): boolean { return this.now() < this.litUntil; }

  // ── cover claims
  claimed(cover: CoverPoint, by: number): boolean {
    const c = this.claims.get(cover.id);
    return !!c && c.id !== by && c.until > this.now();
  }
  claim(cover: CoverPoint, by: number): void {
    for (const [k, c] of this.claims) if (c.id === by && k !== cover.id && c.until > 1e8) c.until = this.now() + SOLDIER_TUNING.cover.claimExpire;
    this.claims.set(cover.id, { id: by, until: 1e9 });
  }
  leave(cover: CoverPoint | null, by: number): void {
    if (!cover) return;
    const c = this.claims.get(cover.id);
    if (c && c.id === by) c.until = this.now() + SOLDIER_TUNING.cover.claimExpire;
  }

  /** Group knowledge (CHOIR): every member of `group` knows where the player is now. */
  share(group: string, from: number, at: THREE.Vector3): void {
    if (!group) return;
    for (const s of this.soldiers) if (s.alive && s.group === group && s.id !== from) s.told(at);
  }

  // ── suppression from the player's shots; also the "shot at" release of a holding soldier
  private playerFired(weapon: string, origin: THREE.Vector3, direction: THREE.Vector3): void {
    this.litUntil = this.now() + SOLDIER_TUNING.lit;
    if (this.soldiers.length === 0) return;
    const range = 90;
    _d.copy(direction).normalize();
    const hit = this.ctx.physics.raycast(origin, _d, range);
    const L = hit ? hit.distance : range;
    const R = SOLDIER_TUNING.supp.radius;
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      s.headPoint(_h);
      _o.copy(_h).sub(origin);
      const t = THREE.MathUtils.clamp(_o.dot(_d), 0, L);
      _c.copy(origin).addScaledVector(_d, t);
      let d = _c.distanceTo(_h);
      if (hit) d = Math.min(d, hit.point.distanceTo(_h));
      if (d <= R) s.nearMiss(weapon, d);
    }
  }

  /** Suppression gain allowed now for soldier `id` (per-second cap from the one shooter), and book it. */
  takeSuppression(id: number, want: number): number {
    const t = this.now();
    let q = this.intake.get(id);
    if (!q) this.intake.set(id, (q = []));
    while (q.length && q[0][0] <= t - 1.0) q.shift();
    let sum = 0;
    for (const [, g] of q) sum += g;
    const g = Math.max(0, Math.min(want, SOLDIER_TUNING.supp.capPerSecond - sum));
    if (g > 0) q.push([t, g]);
    return g;
  }

  // ── body drops (touch within 1.2 m, once per body)
  addDrop(id: number, pos: THREE.Vector3, arms: SoldierArms): void { this.drops.push({ id, pos: pos.clone(), arms, taken: false }); }
  removeDrops(ids: Set<number>): void { this.drops = this.drops.filter((d) => !ids.has(d.id)); }

  update(): void {
    const pl = this.ctx.player;
    if (!pl || !pl.alive || this.drops.length === 0) return;
    const r = SOLDIER_TUNING.drops.touch;
    for (const d of this.drops) {
      if (d.taken) continue;
      const dx = pl.position.x - d.pos.x, dz = pl.position.z - d.pos.z;
      if (dx * dx + dz * dz > r * r || Math.abs(pl.position.y - d.pos.y) > 1.6) continue;
      d.taken = true;
      const D = SOLDIER_TUNING.drops;
      let kind: 'ammo_pistol' | 'ammo_carbine' | 'carbine', amount: number;
      if (d.arms === 'pistol') { kind = 'ammo_pistol'; amount = D.pistol; }
      else if (!pl.weapons.carbine?.owned) { kind = 'carbine'; amount = D.carbineGun; }
      else { kind = 'ammo_carbine'; amount = D.carbine; }
      try { pl.give(kind, amount); } catch { /* player optional */ }
      this.ctx.events.emit('pickup', { kind, amount, position: d.pos.clone() });
      this.push({ t: this.now(), id: d.id, ev: 'drop', kind, amount });
    }
  }
}
