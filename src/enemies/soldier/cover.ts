/**
 * Stage 3c §8.2.4 — cover choice for the taken soldier. Candidates: `Level.cover` points within 14 m of him, his own
 * `set` first (others × 0.6), unclaimed, nav-reachable (path ≤ 20 m), ≥ 7 m from the player, ≥ 3 m from any awake husk
 * (§8.2.7), ≥ 1.2 m from every other enemy. Score = safety (eye → chest AND eye → head at the point, crouched for low /
 * standing for high, blocked from the player's eye: required) × usefulness (from the peek position — standing for low,
 * 0.35 m lateral for high — a clear line to the player's eye: required) × range fit × advance × flank × novelty.
 * At most 24 rays per choice (candidates ranked by the cheap factors first).
 */
import * as THREE from 'three';
import type { CoverPoint, SoldierArms } from '../../core/types';
import type { EnemyBase, EnemyWorld } from '../ai';
import { SOLDIER_TUNING as T, type SoldierDirector } from './fire';

export interface CoverChoice { point: CoverPoint; side: number; score: number }

export interface CoverAsk {
  id: number; set: string | undefined; arms: SoldierArms;
  position: THREE.Vector3;
  /** The point he holds now (a candidate with a small stay bonus), or null. */
  current: CoverPoint | null;
  /** A point id never to choose (relocation: the one he is leaving). */
  exclude?: string;
  /** His last two points (novelty). */
  recent: readonly string[];
  /** The threat: the player's eye (or where it was last known) and feet. */
  threatEye: THREE.Vector3; threatFeet: THREE.Vector3;
  /** Prefer points away from the threat (retreat). */
  retreat: boolean;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _lat = new THREE.Vector3();

/** Bearing (radians, plan view) of a point seen from the threat. */
function bearing(from: THREE.Vector3, p: THREE.Vector3): number { return Math.atan2(p.x - from.x, p.z - from.z); }
function angAbs(a: number, b: number): number { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); }

/** Range fit: 1 inside the weapon's band, falling linearly to 0.3 over 6 m outside it. */
export function rangeFit(arms: SoldierArms, d: number): number {
  const [lo, hi] = T.cover.rangeBand[arms];
  const out = d < lo ? lo - d : d > hi ? d - hi : 0;
  return Math.max(T.cover.rangeFloor, 1 - (out / T.cover.rangeFall) * (1 - T.cover.rangeFloor));
}

/** Is a cover point safe from the threat's eye (both chest and head blocked)? 2 rays. */
export function coverSafe(_world: EnemyWorld, c: CoverPoint, eye: THREE.Vector3, sight: (a: THREE.Vector3, b: THREE.Vector3) => boolean): boolean {
  const C = T.cover, low = c.height === 'low';
  _a.set(c.position.x, c.position.y + (low ? C.lowHead : C.highHead), c.position.z);
  if (sight(eye, _a)) return false;
  _a.y = c.position.y + (low ? C.lowChest : C.highChest);
  return !sight(eye, _a);
}

/** The peek eye of a cover point (low: standing at it; high: 0.35 m to `side`). */
export function peekEye(c: CoverPoint, side: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(c.position.x, c.position.y + T.cover.peekEye, c.position.z);
  if (c.height === 'high') { _lat.set(-c.normal.z, 0, c.normal.x).multiplyScalar(side * T.cover.lean); out.add(_lat); }
  return out;
}

/** Usefulness: which side (high cover) gives a clear line to the threat's eye; 0 = none. 1–2 rays. */
export function coverPeek(world: EnemyWorld, c: CoverPoint, eye: THREE.Vector3, prefer = 1): number {
  const phys = world.ctx.physics;
  if (c.height === 'low') return phys.lineOfSight(peekEye(c, 0, _b), eye) ? 1 : 0;
  for (const s of [prefer, -prefer]) if (phys.lineOfSight(peekEye(c, s, _b), eye)) return s;
  return 0;
}

export function chooseCover(world: EnemyWorld, dir: SoldierDirector, ask: CoverAsk, sight: (a: THREE.Vector3, b: THREE.Vector3) => boolean): CoverChoice | null {
  const level = world.ctx.level, nav = world.nav, C = T.cover;
  const points = level?.cover ?? [];
  if (points.length === 0) return null;
  const p = ask.position, tf = ask.threatFeet;
  const dCur = Math.hypot(p.x - tf.x, p.z - tf.z);
  const bCur = bearing(tf, p);
  // nav costs from his node (bounded Dijkstra, one search)
  const start = nav.count > 0 ? nav.nearestNode(p, true, nav.decks) : -1;
  if (start >= 0) nav.pathCosts(start, C.path + 1);
  const husks: EnemyBase[] = [];
  for (const e of world.enemies) if (e.alive && e.awake && e.type === 'husk') husks.push(e);
  type Cand = { c: CoverPoint; pre: number; dist: number };
  const cands: Cand[] = [];
  for (const c of points) {
    const cp = c.position;
    if (Math.abs(cp.y - p.y) > 3) continue;
    const dMe = Math.hypot(cp.x - p.x, cp.z - p.z);
    if (ask.exclude === c.id) continue;
    const isCur = ask.current?.id === c.id;
    if (dMe > C.radius && !isCur) continue;
    if (dir.claimed(c, ask.id)) continue;
    const dPl = Math.hypot(cp.x - tf.x, cp.z - tf.z);
    if (dPl < C.minPlayer) continue;
    let ok = true;
    for (const h of husks) if (Math.hypot(h.position.x - cp.x, h.position.z - cp.z) < C.huskClear) { ok = false; break; }
    if (!ok) continue;
    if (!isCur) {
      for (const e of world.enemies) {
        if (!e.alive || e.id === ask.id || Math.abs(e.position.y - cp.y) > 1.5) continue;
        if (Math.hypot(e.position.x - cp.x, e.position.z - cp.z) < C.separation) { ok = false; break; }
      }
      if (!ok) continue;
    }
    // bearing change from the threat ≤ 40° per move
    const bc = angAbs(bearing(tf, cp), bCur);
    if (!isCur && bc > C.flankMax && dMe > 1.0) continue;
    // reachable within 20 m of path
    let path = dMe;
    if (!isCur && start >= 0) {
      let n = dir.coverNode.get(c.id);
      if (n === undefined) { n = nav.nearestNode(cp, true, nav.decks); dir.coverNode.set(c.id, n); }
      if (n < 0 || nav.costTo(n) > C.path) continue;
      path = Math.max(dMe, nav.costTo(n));
    }
    let pre = rangeFit(ask.arms, dPl);
    if (ask.set && c.set !== ask.set) pre *= C.otherSet;
    if (isCur) pre *= 1 + C.stay;
    else {
      if (ask.recent.includes(c.id)) pre *= 1 - C.novelty;
      if (ask.retreat) {
        // retreat: away from the threat is preferred, a closer point only if nothing else is safe
        pre *= dPl < dCur - 0.5 ? 0.7 : 1 + Math.min(0.3, (dPl - dCur) * 0.05);
      } else if (dPl < dCur && dCur - dPl <= C.advanceMax) pre *= 1 + C.advanceBonus;
      if (bc >= C.flankMin && bc <= C.flankMax) pre *= 1 + C.flankBonus;
      // the walk between points is his exposed time: a short move beats a long one (−3.5 % per m, floor × 0.5)
      pre *= Math.max(C.travelFloor, 1 - C.travel * path);
    }
    cands.push({ c, pre, dist: dMe });
  }
  cands.sort((a, b) => b.pre - a.pre);
  let rays = 0, best: CoverChoice | null = null;
  for (let i = 0; i < cands.length && i < C.candidates; i++) {
    const { c, pre } = cands[i];
    if (best && pre <= best.score) break;   // sorted: nothing below can win
    if (rays + 2 > C.rays) break;
    rays += 2;
    if (!coverSafe(world, c, ask.threatEye, sight)) continue;
    if (rays + 1 > C.rays) break;
    rays += c.height === 'high' ? 2 : 1;
    const side = coverPeek(world, c, ask.threatEye);
    if (!side) continue;
    best = { point: c, side, score: pre };
  }
  return best;
}
