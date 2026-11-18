/**
 * THE TRUNK — soldier cover points (stage 3d §5.4, 3c §8.3; task W4a). `level.cover` returns `COVER6` as `CoverPoint[]`.
 *
 * Each point: feet (on a floor), `n` = the direction the soldier faces using it (the covering object lies 0.3 … 0.7 m
 * along `n`; every point is 0.55 m from its object's face), `low` (≤ 1.3 m) or `high` (≥ 1.8 m). Every object is a
 * greybox stand-in WITH a collider (grey.ts), except the dock containers — W4b's `Level.dock` (non-walkable dynamic
 * boxes). `enabled` (§8.1, mutable): a dock point starts enabled only when its slot holds a container at load (§2.6.9:
 * sl6_1, 3, 4, 5); `DockArena.lift` / `place` switch it after.
 *
 * `selfTestCover6()` (level 5's `selfTestCover`, copied — rule 9 — and extended): per point feet on a floor, capsule free,
 * a collider 0.3 … 0.8 m along `n` at the chest AND the head, a peek position with a line of fire, a nav node within
 * 1.5 m, inside its room's interior, not within 1.0 m of a door plane, not on a `nav: false` floor, not in water deeper
 * than 0.6 m; and `enabled` as the load state says. A dock point whose container is not there (W4b's dock not built yet,
 * or the slot empty) gets the placement tests only (the object tests need the container).
 *
 * Corrections to the §5.4 table (W4a, as 3c's W4 did): see `COVER6_NOTES`.
 */
import * as THREE from 'three';
import type { CoverPoint, GameContext, Level } from '../../core/types';
import type { DoorImpl } from '../doors';

type Dir = '+x' | '-x' | '+z' | '-z';
interface Row { id: string; set: string; room: string; p: [number, number, number]; n: Dir; h: 'low' | 'high'; obj: string; slot?: string }

const R = (set: string, room: string, id: string, p: [number, number, number], n: Dir, h: 'low' | 'high', obj: string, slot?: string): Row => ({ id, set, room, p, n, h, obj, ...(slot ? { slot } : {}) });

/** §2.6.9 cargo slots that hold a container at load. */
export const SLOTS_FULL_AT_LOAD6 = new Set(['sl6_1', 'sl6_3', 'sl6_4', 'sl6_5']);

/** §5.4, 75 points (12 + 8 + 6 + 6 + 6 + 4 + 3 + 3 + 5 + 18 + 4). */
export const COVER_ROWS6: Row[] = [
  // tunnel A (JB high, DT low)
  R('tunnel', 'tun6_a', 'cv6_t1', [-1.85, 0, -25.35], '+z', 'high', 'JB1 south −24.8'),
  R('tunnel', 'tun6_a', 'cv6_t1b', [-1.85, 0, -22.65], '-z', 'high', 'JB1 north −23.2'),
  R('tunnel', 'tun6_a', 'cv6_t2', [1.85, 0, -41.35], '+z', 'high', 'JB2 south −40.8'),
  R('tunnel', 'tun6_a', 'cv6_t2b', [1.85, 0, -38.65], '-z', 'high', 'JB2 north −39.2'),
  R('tunnel', 'tun6_a', 'cv6_t3', [-1.85, 0, -57.35], '+z', 'high', 'JB3 south −56.8'),
  R('tunnel', 'tun6_a', 'cv6_t3b', [-1.85, 0, -54.65], '-z', 'high', 'JB3 north −55.2'),
  R('tunnel', 'tun6_a', 'cv6_t4', [1.85, 0, -71.35], '+z', 'high', 'JB4 south −70.8'),
  R('tunnel', 'tun6_a', 'cv6_t4b', [1.85, 0, -68.65], '-z', 'high', 'JB4 north −69.2'),
  R('tunnel', 'tun6_a', 'cv6_t5', [1.2, 0, -31.05], '+z', 'low', 'DT1 south −30.5'),
  R('tunnel', 'tun6_a', 'cv6_t5b', [1.2, 0, -28.95], '-z', 'low', 'DT1 north −29.5'),
  R('tunnel', 'tun6_a', 'cv6_t6', [-1.2, 0, -63.05], '+z', 'low', 'DT2 south −62.5'),
  R('tunnel', 'tun6_a', 'cv6_t6b', [-1.2, 0, -60.95], '-z', 'low', 'DT2 north −61.5'),
  // repeater 2
  R('rep', 'rep6', 'cv6_r1', [12.15, 0, -81.85], '-x', 'high', 'DS1 east face 11.6 (north end)'),
  R('rep', 'rep6', 'cv6_r2', [9.25, 0, -83.55], '+z', 'high', 'DS1 south face −83.0 (west end)'),
  R('rep', 'rep6', 'cv6_r3', [0.35, 0, -90.95], '+z', 'high', 'DS2 south face −90.4 (east end)'),
  R('rep', 'rep6', 'cv6_r4', [-2.55, 0, -89.25], '+x', 'high', 'DS2 west face −2.0 (north end)'),
  R('rep', 'rep6', 'cv6_r5', [5.7, 0, -90.15], '+z', 'low', 'LC1 south face −89.6'),
  R('rep', 'rep6', 'cv6_r6', [6.95, 0, -89.0], '-x', 'low', 'LC1 east face 6.4'),
  R('rep', 'rep6', 'cv6_r7', [7.6, 0, -81.05], '-z', 'low', 'LC2 north face −81.6'),
  R('rep', 'rep6', 'cv6_r8', [7.6, 0, -83.35], '+z', 'low', 'LC2 south face −82.8'),
  // tunnel B (RH high, 1.4 m deep from the wall)
  R('tunb', 'tun6_b', 'cv6_b1', [10.85, 0, -110.55], '+z', 'high', 'RH1 south −110 (outer end)'),
  R('tunb', 'tun6_b', 'cv6_b1b', [10.85, 0, -107.45], '-z', 'high', 'RH1 north −108 (outer end)'),
  R('tunb', 'tun6_b', 'cv6_b2', [13.15, 0, -126.55], '+z', 'high', 'RH2 south −126 (outer end)'),
  R('tunb', 'tun6_b', 'cv6_b2b', [13.15, 0, -123.45], '-z', 'high', 'RH2 north −124 (outer end)'),
  R('tunb', 'tun6_b', 'cv6_b3', [10.85, 0, -142.55], '+z', 'high', 'RH3 south −142 (outer end)'),
  R('tunb', 'tun6_b', 'cv6_b3b', [10.85, 0, -139.45], '-z', 'high', 'RH3 north −140 (outer end)'),
  // head-end
  R('he', 'he6', 'cv6_h1', [4.45, 0, -164.3], '+x', 'high', 'R1 west end x 5'),
  R('he', 'he6', 'cv6_h2', [4.45, 0, -169.3], '+x', 'high', 'R2 west end x 5'),
  R('he', 'he6', 'cv6_h3', [14.75, 0, -163.45], '-z', 'high', 'R1 north face −164.0 (east end)'),
  R('he', 'he6', 'cv6_h4', [5.25, 0, -170.15], '+z', 'high', 'R2 south face −169.6 (west end)'),
  R('he', 'he6', 'cv6_h5', [15.55, 0, -164.3], '-x', 'high', 'R1 east end x 15'),
  R('he', 'he6', 'cv6_h6', [15.55, 0, -169.3], '-x', 'high', 'R2 east end x 15'),
  // vault
  R('vault', 'vault6', 'cv6_v1', [-16.75, 0, -155.25], '-z', 'high', 'CD1 north face −155.8 (east end)'),
  R('vault', 'vault6', 'cv6_v2', [-16.75, 0, -161.25], '-z', 'high', 'CD2 north face −161.8 (east end)'),
  R('vault', 'vault6', 'cv6_v3', [-15.95, 0, -156.05], '-x', 'high', 'CD1 east face −16.5 (north end)'),
  R('vault', 'vault6', 'cv6_v4', [-15.95, 0, -162.05], '-x', 'high', 'CD2 east face −16.5 (north end)'),
  R('vault', 'vault6', 'cv6_v6', [-15.95, 0, -150.05], '-x', 'high', 'CD3 east face −16.5 (north end)'),
  R('vault', 'vault6', 'cv6_v5', [-2.25, 0, -150.25], '-z', 'high', 'NR north face −150.8 (east end)'),
  // the chamber: galleries (parapets, low)
  ...[-62.0, -60.0, -42.0, -40.0].map((x, i) => R('gal_n', 'pool6', `cv6_gn${i + 1}`, [x, -12, -150.65], '-z', 'low', 'north parapet z −151.2')),
  ...[-188.0, -178.0, -164.0].map((z, i) => R('gal_w', 'pool6', `cv6_gw${i + 1}`, [-73.35, -12, z], '+x', 'low', 'west parapet x −72.8')),
  ...[-188.0, -186.0, -176.0].map((z, i) => R('gal_e', 'pool6', `cv6_ge${i + 1}`, [-30.65, -12, z], '-x', 'low', 'east parapet x −31.2')),
  // mid deck
  R('mid', 'pool6', 'cv6_m1', [-65.4, -16, -158.25], '-z', 'low', 'MC1 north face −158.8'),
  R('mid', 'pool6', 'cv6_m2', [-39.4, -16, -158.25], '-z', 'low', 'MC2 north face −158.8'),
  R('mid', 'pool6', 'cv6_m3', [-50.25, -16, -149.45], '-z', 'high', 'winch north face −150.0 (east end)'),
  R('mid', 'pool6', 'cv6_m4', [-49.45, -16, -153.75], '-x', 'high', 'winch east face −50.0 (south end)'),
  R('mid', 'pool6', 'cv6_m5', [-54.55, -16, -153.75], '+x', 'high', 'winch west face −54.0 (south end)'),
  // the dock: containers in their slots (6.0 × 2.4 × 2.6), enabled with the slot
  R('dock', 'pool6', 'cv6_s1n', [-73.75, -20, -179.05], '-z', 'high', 'sl6_1 north −179.6 (west end)', 'sl6_1'),
  R('dock', 'pool6', 'cv6_s1s', [-73.75, -20, -182.55], '+z', 'high', 'sl6_1 south −182.0 (west end)', 'sl6_1'),
  R('dock', 'pool6', 'cv6_s1e', [-67.45, -20, -179.85], '-x', 'high', 'sl6_1 east −68 (north end)', 'sl6_1'),
  R('dock', 'pool6', 'cv6_s2n', [-73.75, -20, -173.45], '-z', 'high', 'sl6_2 north −174.0 (west end)', 'sl6_2'),
  R('dock', 'pool6', 'cv6_s2s', [-73.75, -20, -176.95], '+z', 'high', 'sl6_2 south −176.4 (west end)', 'sl6_2'),
  R('dock', 'pool6', 'cv6_s2e', [-67.45, -20, -174.25], '-x', 'high', 'sl6_2 east −68 (north end)', 'sl6_2'),
  R('dock', 'pool6', 'cv6_s3n', [-30.25, -20, -179.05], '-z', 'high', 'sl6_3 north −179.6 (east end)', 'sl6_3'),
  R('dock', 'pool6', 'cv6_s3s', [-30.25, -20, -182.55], '+z', 'high', 'sl6_3 south −182.0 (east end)', 'sl6_3'),
  R('dock', 'pool6', 'cv6_s3w', [-36.55, -20, -179.85], '+x', 'high', 'sl6_3 west −36 (north end)', 'sl6_3'),
  R('dock', 'pool6', 'cv6_s4n', [-30.25, -20, -173.45], '-z', 'high', 'sl6_4 north −174.0 (east end)', 'sl6_4'),
  R('dock', 'pool6', 'cv6_s4s', [-30.25, -20, -176.95], '+z', 'high', 'sl6_4 south −176.4 (east end)', 'sl6_4'),
  R('dock', 'pool6', 'cv6_s4w', [-36.55, -20, -174.25], '+x', 'high', 'sl6_4 west −36 (north end)', 'sl6_4'),
  R('dock', 'pool6', 'cv6_s5n', [-59.75, -20.8, -189.05], '-z', 'high', 'sl6_5 north −189.6 (west end)', 'sl6_5'),
  R('dock', 'pool6', 'cv6_s5s', [-59.75, -20.8, -192.55], '+z', 'high', 'sl6_5 south −192.0 (west end)', 'sl6_5'),
  R('dock', 'pool6', 'cv6_s5w', [-60.55, -20.8, -189.85], '+x', 'high', 'sl6_5 west −60 (north end)', 'sl6_5'),
  R('dock', 'pool6', 'cv6_s6n', [-44.25, -20.8, -189.05], '-z', 'high', 'sl6_6 north −189.6 (east end)', 'sl6_6'),
  R('dock', 'pool6', 'cv6_s6s', [-44.25, -20.8, -192.55], '+z', 'high', 'sl6_6 south −192.0 (east end)', 'sl6_6'),
  R('dock', 'pool6', 'cv6_s6e', [-43.45, -20.8, -189.85], '-x', 'high', 'sl6_6 east −44 (north end)', 'sl6_6'),
  // the undercroft (pumps, high)
  R('uc', 'pool6', 'cv6_u1', [-62.25, -20, -153.45], '-z', 'high', 'P1 north face −154.0 (east end)'),
  R('uc', 'pool6', 'cv6_u2', [-40.25, -20, -153.45], '-z', 'high', 'P2 north face −154.0 (east end)'),
  R('uc', 'pool6', 'cv6_u3', [-61.45, -20, -154.25], '-x', 'high', 'P1 east face −62.0 (north end)'),
  R('uc', 'pool6', 'cv6_u4', [-42.55, -20, -154.25], '+x', 'high', 'P2 west face −42.0 (north end)'),
];

/** Decisions / corrections to §5.4 (reported). */
export const COVER6_NOTES = [
  'High cover mid-face (3c W4 rule): the self-test peeks 0.6 m to either side of a high point and needs a line of fire from there; §5.4 put most high points in the middle of a face wider than 1.2 m (both peeks look into the object). Each is moved 0.25 m inside one end of its face (the lean clears the end by 0.35 m), keeping its face, n and 0.55 m: r1 z −81.85, r2 x 9.25, r3 x 0.35, r4 z −89.25, b1/b1b/b3/b3b x 10.85, b2/b2b x 13.15, h3 x 14.75, h4 x 5.25, v1/v2 x −16.75, v3 z −156.05, v4 z −162.05, v6 z −150.05, v5 x −2.25, m3 x −50.25, m4/m5 z −153.75, every container point (n/s at the outer end x −73.75 / −30.25 / −59.75 / −44.25; e/w at the north end z −179.85 / −174.25 / −189.85), u1 x −62.25, u2 x −40.25, u3/u4 z −154.25.',
  'cv6_r7: §5.4 (8.75, −82.2) n −x stood in the 0.8 m gap between LC2 (east face 8.2) and DS1 (west face 9.0): the capsule does not fit → (7.6, −81.05) n −z on LC2\'s north face.',
  'Dock points: enabled at load = the slot holds a container at load (sl6_1, 3, 4, 5); cv6_s2*, cv6_s6* start disabled.',
];

const DIRS: Record<Dir, [number, number]> = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };

/** A fresh copy per level build (`enabled` is mutable state). */
export function makeCover6(): CoverPoint[] {
  return COVER_ROWS6.map((r) => {
    const [nx, nz] = DIRS[r.n];
    return { id: r.id, position: new THREE.Vector3(...r.p), normal: new THREE.Vector3(nx, 0, nz), height: r.h, room: r.room, set: r.set, enabled: !r.slot || SLOTS_FULL_AT_LOAD6.has(r.slot) };
  });
}

/** Soldier spawn (feet) of each cover set — check-nav proves every point reachable from it (3c §8.3). */
export const COVER_SPAWNS6: Record<string, [number, number, number]> = {
  tunnel: [10.0, 0, -86.0],      // g6_tun_s (mk6_tun_s1)
  rep: [10.2, 0, -111.6],        // g6_rep_s
  tunb: [12.0, 0, -162.0],       // g6_tunb_s (mk6_he_s)
  he: [-16.0, 0, -143.0],        // g6_he (mk6_hold_1)
  vault: [-16.0, 0, -143.0],     // g6_vault
  gal_n: [-72.0, -12, -144.0],   // g6_w1 (mk6_w1_a)
  gal_w: [-68.0, -12, -144.0],   // g6_w1 (mk6_w1_b)
  gal_e: [-24.0, -12, -163.4],   // g6_w3 (mk6_w3_a)
  mid: [-72.0, -12, -144.0],
  dock: [-72.0, -12, -144.0],
  uc: [-72.0, -12, -144.0],
};

/** §8.3 self-test of every cover point (see the header). */
export function selfTestCover6(ctx: GameContext, level: Level): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const t = (name: string, pass: boolean, detail = '') => { if (!pass) ok = false; lines.push(`${pass ? ' ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
  const ph = ctx.physics;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const DOWN = V(0, -1, 0), UP = V(0, 1, 0);
  // `raycast` (rays set: solid ∪ water) is the soldier's protection test; the capsule tests use `raycastSolid` (moves
  // set: solid ∪ rails / bars) — a capsule is stopped by a rail that a round passes
  const hitAt = (o: THREE.Vector3, d: THREE.Vector3, len: number) => ph.raycast(o, d, len);
  const solidAt = (o: THREE.Vector3, d: THREE.Vector3, len: number) => ph.raycastSolid(o, d, len);
  const capsuleFree = (p: THREE.Vector3, h: number, r = 0.35): string | null => {
    for (const y of [0.2, h * 0.45, h * 0.8, h - 0.1]) {
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4, d = V(Math.cos(a), 0, Math.sin(a));
        const hh = solidAt(V(p.x, p.y + y, p.z), d, r - 0.01);
        if (hh) return `collider at ${hh.distance.toFixed(2)} m (y +${y.toFixed(2)}, dir ${k * 45}°)`;
      }
    }
    const u = solidAt(V(p.x, p.y + 0.15, p.z), UP, h - 0.15);
    return u ? `head room ${(u.point.y - p.y).toFixed(2)} m` : null;
  };
  const doors = level.doors as unknown as DoorImpl[];
  const navNear = (p: THREE.Vector3) => {
    let best = Infinity;
    for (const n of level.nav) if (Math.abs(n.position.y - p.y) < 0.4) best = Math.min(best, Math.hypot(n.position.x - p.x, n.position.z - p.z));
    return best;
  };
  const cover = level.cover;
  t(`${cover.length} cover points (§5.4: 75)`, cover.length === 75);
  t('cover ids unique', new Set(cover.map((c) => c.id)).size === cover.length);
  const dock = level.dock;
  for (const c of cover) {
    const row = COVER_ROWS6.find((r) => r.id === c.id)!;
    const p = c.position, n = c.normal, low = c.height === 'low';
    const probs: string[] = [];
    const slot = row.slot ? dock?.slots.find((s) => s.id === row.slot) : undefined;
    const objectThere = !row.slot || (!!slot && slot.container !== null);
    // load state of `enabled` (§8.1): the slot's container at load
    const wantEnabled = !row.slot || (slot ? slot.container !== null : SLOTS_FULL_AT_LOAD6.has(row.slot));
    if (c.enabled !== wantEnabled) probs.push(`enabled ${c.enabled}, want ${wantEnabled}`);
    const f = solidAt(V(p.x, p.y + 0.3, p.z), DOWN, 0.45);
    if (!f || Math.abs(f.point.y - p.y) > 0.1) probs.push(`no floor under the feet (${f ? f.point.y.toFixed(2) : 'none'})`);
    const cf = capsuleFree(p, low ? 1.1 : 1.8);
    if (cf) probs.push(`capsule blocked: ${cf}`);
    if (objectThere) {
      for (const y of low ? [0.5, 0.6, 0.85] : [0.5, 1.3, 1.5, 1.65]) {
        const h = hitAt(V(p.x, p.y + y, p.z), n, 0.8);
        if (!h || h.distance < 0.3) probs.push(`no cover object 0.3 … 0.8 m along n at +${y} (${h ? h.distance.toFixed(2) : 'none'})`);
      }
      const eye = 1.65;
      if (low) {
        const u = solidAt(V(p.x, p.y + 0.15, p.z), UP, 1.75);
        if (u) probs.push(`cannot stand to peek (head room ${(u.point.y - p.y).toFixed(2)})`);
        const lof = hitAt(V(p.x, p.y + eye, p.z), n, 3.0);
        if (lof) probs.push(`no line of fire over it: eye ray hits at ${lof.distance.toFixed(2)} m`);
      } else {
        const side = V(-n.z, 0, n.x);
        let any = false;
        const why: string[] = [];
        for (const s of [1, -1]) {
          const lat = solidAt(V(p.x, p.y + 1.5, p.z), side.clone().multiplyScalar(s), 0.95);
          const q = p.clone().addScaledVector(side, 0.6 * s);
          const lof = lat ? null : hitAt(V(q.x, q.y + eye, q.z), n, 3.0);
          if (!lat && !lof && !capsuleFree(q, 1.8)) any = true;
          else why.push(`${s > 0 ? 'left' : 'right'}: ${lat ? `side blocked at ${lat.distance.toFixed(2)}` : lof ? `line of fire blocked at ${lof.distance.toFixed(2)}` : 'peek capsule blocked'}`);
        }
        if (!any) probs.push(`no peek position: ${why.join('; ')}`);
      }
    }
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
    for (const w of level.water) if (w.box.containsPoint(V(p.x, Math.max(p.y, w.box.min.y + 0.01), p.z)) && w.surface - p.y > 0.6) probs.push(`in water ${(w.surface - p.y).toFixed(2)} m deep (${w.id})`);
    t(`cover ${c.id} (${c.set}, ${c.height}, n ${row.n}${objectThere ? '' : ', object absent: placement only'})`, probs.length === 0, probs.join('; '));
  }
  return { ok, lines };
}
