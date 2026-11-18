/**
 * POST 4 — soldier cover points (stage 3c §5.4, §8.3; task W4). `level.cover` returns `COVER5` as `CoverPoint[]`.
 *
 * Each point: feet (on a floor), `n` = the direction the soldier faces using it (toward the threat; the covering
 * object lies 0.3 … 0.7 m along `n` — every point here is 0.55 m from its object's face: capsule 0.35 + 0.2), `low`
 * (≤ 1.3 m: crouch, rise to fire over) or `high` (≥ 1.8 m: stand, lean out to the side). Every object is a greybox
 * stand-in block WITH a collider (grey.ts); the dressing keeps exactly one collider on it.
 *
 * `selfTestCover()` (run by `level.selfTest()`, i.e. by scripts/check-reach.mjs) proves per point: feet on a floor
 * (ray down ≤ 0.1 m), capsule free (r 0.35, h 1.1 low / 1.8 high), a collider 0.3 … 0.8 m along `n` at the chest AND
 * the head (crouch eye 0.85 for low, eye 1.65 for high) — safety —, a peek position free (low: the stand-up capsule;
 * high: 0.6 m to either side, at least one) with a LINE OF FIRE from it (the eye ray past the object reaches ≥ 3 m), a
 * nav node within 1.5 m on its floor, inside its room's interior, not within 1.0 m of a door plane, not on a
 * `nav: false` floor. scripts/check-nav.mjs adds: every point reachable from its set's soldier spawn.
 *
 * Corrections to the §5.4 table (W4, re-verified on the built geometry): see `COVER5_NOTES`.
 */
import * as THREE from 'three';
import type { CoverPoint, GameContext, Level } from '../../core/types';
import type { DoorImpl } from '../doors';

type Dir = '+x' | '-x' | '+z' | '-z';
interface Row { id: string; set: string; room: string; p: [number, number, number]; n: Dir; h: 'low' | 'high'; obj: string }

const R = (set: string, room: string, id: string, p: [number, number, number], n: Dir, h: 'low' | 'high', obj: string): Row => ({ id, set, room, p, n, h, obj });

/** §5.4, 41 points (8 + 2 + 8 + 17 + 2 + 4). */
export const COVER_ROWS5: Row[] = [
  R('ready', 'ready5', 'cv5_r1', [-4.0, 0, -34.95], '+z', 'low', 'C2 south face z −34.4'),
  R('ready', 'ready5', 'cv5_r2', [-4.0, 0, -30.45], '+z', 'low', 'C1 south face z −29.9'),
  R('ready', 'ready5', 'cv5_r3', [-8.55, 0, -26.25], '+x', 'high', 'L1 west face x −8.0 (north end)'),
  R('ready', 'ready5', 'cv5_r4', [0.75, 0, -26.25], '-x', 'high', 'L2 east face x 0.2 (north end)'),
  R('ready', 'ready5', 'cv5_r5', [-0.95, 0, -32.75], '+x', 'high', 'L2 west face x −0.4 (south end)'),
  R('ready', 'ready5', 'cv5_r6', [2.0, 0, -36.15], '+z', 'low', 'C3 south face z −35.6'),
  R('ready', 'ready5', 'cv5_r7', [-4.0, 0, -28.55], '-z', 'low', 'C1 north face z −29.1'),
  R('ready', 'ready5', 'cv5_r8', [3.15, 0, -35.2], '-x', 'low', 'C3 east face x 2.6'),
  R('duty', 'duty5', 'cv5_d1', [-1.5, 0, -16.55], '+z', 'low', 'watch desk south face z −16.0'),
  // (correction: §5.4 put d2 at (5.0, −20.65) facing −z, i.e. into the duty room's south wall 1.15 m away — no line
  // of fire; it now stands beside the cabinets, east of them, facing the room's west half and the ready door)
  R('duty', 'duty5', 'cv5_d2', [6.15, 0, -21.4], '-x', 'low', 'cabinets east face x 5.6'),
  R('spine', 'spine5', 'cv5_s1', [12.85, 0, -17.35], '-x', 'high', 'R1 east face x 12.3'),
  R('spine', 'spine5', 'cv5_s2', [14.85, 0, -14.65], '-x', 'high', 'R2 east face x 14.3'),
  R('spine', 'spine5', 'cv5_s3', [22.85, 0, -17.35], '-x', 'high', 'R3 east face x 22.3'),
  R('spine', 'spine5', 'cv5_s8', [21.15, 0, -17.35], '+x', 'high', 'R3 west face x 21.7'),
  R('spine', 'spine5', 'cv5_s4', [26.85, 0, -14.65], '-x', 'high', 'R4 east face x 26.3'),
  R('spine', 'spine5', 'cv5_s5', [27.15, 0, -17.35], '+x', 'high', 'R5 west face x 27.7'),
  R('spine', 'spine5', 'cv5_s6', [34.15, 0, -14.65], '+x', 'high', 'R6 west face x 34.7'),
  R('spine', 'spine5', 'cv5_s7', [40.15, 0, -17.35], '+x', 'high', 'R7 west face x 40.7'),
  R('floor', 'sub5', 'cv5_f1', [27.0, 0, -27.45], '-z', 'low', 'CA north face z −28.0'),
  R('floor', 'sub5', 'cv5_f2', [27.0, 0, -30.55], '+z', 'low', 'CA south face z −30.0'),
  R('floor', 'sub5', 'cv5_f3', [28.55, 0, -29.0], '-x', 'low', 'CA east face x 28.0'),
  R('floor', 'sub5', 'cv5_f4', [26.6, 0, -48.45], '-z', 'low', 'CB north face z −49.0'),
  R('floor', 'sub5', 'cv5_f5', [27.75, 0, -50.0], '-x', 'low', 'CB east face x 27.2'),
  R('floor', 'sub5', 'cv5_f6', [39.0, 0, -43.45], '-z', 'low', 'CC north face z −44.0'),
  R('floor', 'sub5', 'cv5_f7', [39.0, 0, -46.55], '+z', 'low', 'CC south face z −46.0'),
  R('floor', 'sub5', 'cv5_f8', [37.45, 0, -45.0], '+x', 'low', 'CC west face x 38.0'),
  R('floor', 'sub5', 'cv5_f9', [43.85, 0, -21.45], '-z', 'high', 'CD north face z −22.0 (west end)'),
  R('floor', 'sub5', 'cv5_f10', [43.85, 0, -24.55], '+z', 'high', 'CD south face z −24.0 (west end)'),
  R('floor', 'sub5', 'cv5_f11', [37.05, 0, -25.85], '+x', 'high', 'forklift west face x 37.6 (north end)'),
  R('floor', 'sub5', 'cv5_f12', [38.75, 0, -28.55], '+z', 'high', 'forklift south face z −28.0 (east end)'),
  R('floor', 'sub5', 'cv5_f13', [40.15, 0, -51.05], '-z', 'high', 'gas racks north face z −51.6 (east end)'),
  R('floor', 'sub5', 'cv5_f14', [31.0, 0, -33.55], '+z', 'low', 'EW1 south face z −33.0'),
  R('floor', 'sub5', 'cv5_f15', [31.0, 0, -41.55], '+z', 'low', 'EW2 south face z −41.0'),
  R('floor', 'sub5', 'cv5_f16', [37.0, 0, -33.55], '+z', 'low', 'EE1 south face z −33.0'),
  R('floor', 'sub5', 'cv5_f17', [37.0, 0, -41.55], '+z', 'low', 'EE2 south face z −41.0'),
  R('gallery_w', 'sub5', 'cv5_g1', [24.45, 4.8, -45.0], '+x', 'low', 'west parapet x 25.0'),
  R('gallery_w', 'sub5', 'cv5_g2', [24.45, 4.8, -26.0], '+x', 'low', 'west parapet x 25.0'),
  R('gallery_e', 'sub5', 'cv5_g3', [43.55, 4.8, -43.0], '-x', 'low', 'east parapet x 43.0'),
  R('gallery_e', 'sub5', 'cv5_g4', [43.55, 4.8, -26.0], '-x', 'low', 'east parapet x 43.0'),
  R('gallery_e', 'sub5', 'cv5_g5', [30.0, 4.8, -34.55], '+z', 'low', 'bridge parapet z −34.0'),
  R('gallery_e', 'sub5', 'cv5_g6', [38.0, 4.8, -34.55], '+z', 'low', 'bridge parapet z −34.0'),
];

/** Decisions / corrections to §5.4 (reported). */
export const COVER5_NOTES = [
  "cv5_d2: §5.4 (5.0, 0, −20.65) n −z faced the duty room's south wall 1.15 m away (no line of fire) → (6.15, 0, −21.4) n −x behind the cabinets' east face.",
  "cv5_r8: §5.4 (2.0, −34.25) n −z faced the kit rack 2.95 m away over C3 → (3.15, 0, −35.2) n −x behind C3's east face (line of fire across the room).",
  'high cover r3 / r4 / r5 / f11–f13: §5.4 put them mid-face, where a 0.6 m lean still looks into the object (no peek) → 0.25 m inside an end of the face, so the lean clears it by 0.35 m: r3 z −26.25, r4 z −26.25, r5 z −32.75, f11 z −25.85, f12 x 38.75, f13 x 40.15.',
  "cv5_f9 / f10: f9 (43.05, −23) n +x faced the sub bay's east wall 2.2 m away (and mid-face) → (43.85, −21.45) n −z on CD's north face; f10 → x 43.85 (west end of CD's south face).",
  "cv5_f14–f17 (S1b equipment boxes): n ±x faced the boat's hull 0.9 m beyond the box (no line of fire) → on each box's south face, n +z (facing up the floor lanes toward d5_bay): (31.0, −33.55), (31.0, −41.55), (37.0, −33.55), (37.0, −41.55).",
];

const DIRS: Record<Dir, [number, number]> = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };

export const COVER5: readonly CoverPoint[] = COVER_ROWS5.map((r) => {
  const [nx, nz] = DIRS[r.n];
  return { id: r.id, position: new THREE.Vector3(...r.p), normal: new THREE.Vector3(nx, 0, nz), height: r.h, room: r.room, set: r.set, enabled: true };
});

/** Soldier spawn (feet) of each cover set — check-nav proves every point reachable from it (§8.3). */
export const COVER_SPAWNS5: Record<string, [number, number, number]> = {
  ready: [-4.0, 0, -36.6],   // g5_s1 (mk5_s1)
  duty: [-4.0, 0, -36.6],    // g5_s1 follows the player into the duty room
  spine: [48.0, 0, -34.0],   // g5_spine
  floor: [42.0, 0, -60.0],   // g5_cmd / g5_bay_a
  gallery_w: [40.0, 0, -60.0], // g5_bay_a (west gallery via STAIR5_W)
  gallery_e: [44.0, 0, -60.0], // g5_bay_a second soldier
};

/** §8.3 self-test of every cover point (see the header). */
export function selfTestCover(ctx: GameContext, level: Level): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const t = (name: string, pass: boolean, detail = '') => { if (!pass) ok = false; lines.push(`${pass ? ' ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
  const ph = ctx.physics;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const DOWN = V(0, -1, 0), UP = V(0, 1, 0);
  const hitAt = (o: THREE.Vector3, d: THREE.Vector3, len: number) => ph.raycast(o, d, len);
  /** Capsule free at feet p (radius r, height h): no collider within r around the axis at 4 heights, nothing above. */
  const capsuleFree = (p: THREE.Vector3, h: number, r = 0.35): string | null => {
    for (const y of [0.2, h * 0.45, h * 0.8, h - 0.1]) {
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4, d = V(Math.cos(a), 0, Math.sin(a));
        const hh = hitAt(V(p.x, p.y + y, p.z), d, r - 0.01);
        if (hh) return `collider at ${hh.distance.toFixed(2)} m (y +${y.toFixed(2)}, dir ${k * 45}°)`;
      }
    }
    const u = hitAt(V(p.x, p.y + 0.15, p.z), UP, h - 0.15);
    return u ? `head room ${(u.point.y - p.y).toFixed(2)} m` : null;
  };
  const doors = level.doors as unknown as DoorImpl[];
  const navNear = (p: THREE.Vector3) => {
    let best = Infinity;
    for (const n of level.nav) if (Math.abs(n.position.y - p.y) < 0.4) best = Math.min(best, Math.hypot(n.position.x - p.x, n.position.z - p.z));
    return best;
  };
  t(`${COVER5.length} cover points (§5.4: 41)`, COVER5.length === 41);
  const ids = new Set(COVER5.map((c) => c.id));
  t('cover ids unique', ids.size === COVER5.length);
  for (const c of COVER5) {
    const p = c.position, n = c.normal, low = c.height === 'low';
    const probs: string[] = [];
    // feet on a floor
    const f = hitAt(V(p.x, p.y + 0.3, p.z), DOWN, 0.45);
    if (!f || Math.abs(f.point.y - p.y) > 0.1) probs.push(`no floor under the feet (${f ? f.point.y.toFixed(2) : 'none'})`);
    // capsule
    const cf = capsuleFree(p, low ? 1.1 : 1.8);
    if (cf) probs.push(`capsule blocked: ${cf}`);
    // safety: chest and head rays along n meet a collider 0.3 … 0.8 m away
    const heights = low ? [0.5, 0.6, 0.85] : [0.5, 1.3, 1.5, 1.65];
    for (const y of heights) {
      const h = hitAt(V(p.x, p.y + y, p.z), n, 0.8);
      if (!h || h.distance < 0.3) probs.push(`no cover object 0.3 … 0.8 m along n at +${y} (${h ? h.distance.toFixed(2) : 'none'})`);
    }
    // peek + line of fire
    const eye = 1.65;
    if (low) {
      const u = hitAt(V(p.x, p.y + 0.15, p.z), UP, 1.75);
      if (u) probs.push(`cannot stand to peek (head room ${(u.point.y - p.y).toFixed(2)})`);
      const lof = hitAt(V(p.x, p.y + eye, p.z), n, 3.0);
      if (lof) probs.push(`no line of fire over it: eye ray hits at ${lof.distance.toFixed(2)} m`);
    } else {
      const side = V(-n.z, 0, n.x);
      let any = false;
      const why: string[] = [];
      for (const s of [1, -1]) {
        const lat = hitAt(V(p.x, p.y + 1.5, p.z), side.clone().multiplyScalar(s), 0.95);
        const q = p.clone().addScaledVector(side, 0.6 * s);
        const lof = lat ? null : hitAt(V(q.x, q.y + eye, q.z), n, 3.0);
        if (!lat && !lof && !capsuleFree(q, 1.8)) any = true;
        else why.push(`${s > 0 ? 'left' : 'right'}: ${lat ? `side blocked at ${lat.distance.toFixed(2)}` : lof ? `line of fire blocked at ${lof.distance.toFixed(2)}` : 'peek capsule blocked'}`);
      }
      if (!any) probs.push(`no peek position: ${why.join('; ')}`);
    }
    // nav node, room, door planes, nav floor
    const nn = navNear(p);
    if (nn > 1.5) probs.push(`no nav node within 1.5 m (nearest ${nn.toFixed(2)})`);
    const room = level.roomAt(p);
    const b = room?.bounds;
    if (!room || room.id !== c.room || p.x < b!.min.x + 0.2 || p.x > b!.max.x - 0.2 || p.z < b!.min.z + 0.2 || p.z > b!.max.z - 0.2) probs.push(`not inside room ${c.room}'s interior (${room?.id ?? 'none'})`);
    for (const d of doors) {
      const dp = d.position, wallZ = (d as unknown as { spec: { wall: 'x' | 'z' } }).spec.wall === 'z';
      if (Math.abs(dp.y - p.y) > 1.5) continue;
      const along = wallZ ? Math.abs(p.x - dp.x) : Math.abs(p.z - dp.z), plane = wallZ ? Math.abs(p.z - dp.z) : Math.abs(p.x - dp.x);
      if (plane < 1.0 && along < d.width / 2 + 0.5) probs.push(`within 1.0 m of door ${d.id}'s plane`);
    }
    const fl = level.floorAt(p);
    if (!fl || !fl.nav) probs.push('on a nav: false floor');
    t(`cover ${c.id} (${c.set}, ${c.height}, n ${COVER_ROWS5.find((r) => r.id === c.id)!.n})`, probs.length === 0, probs.join('; '));
  }
  return { ok, lines };
}
