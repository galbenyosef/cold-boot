/** JUNCTION 3 — x -3…3, z -20…-14, h 3.2. Signage hub; the slumped android sits against the east wall. */
import { rng } from '../builder';
import type { LevelBuild } from '../context';
import { cableBundle, floorSlab, ibeam, pipe, trench } from '../kit';
import { bench, crate, fireExtinguisher } from '../props';
import { bulkhead, ceilingSlab, troffer, wallFace } from '../structure';

const PI = Math.PI;

export function buildJunction(L: LevelBuild) {
  const b = L.builder('junction');
  const R = rng(303);
  const H = 3.2;
  L.room('junction', 'JUNCTION 3', -3, 3, -20, -14, H);

  floorSlab(b, 'floor_plate', -3, -20, 3, -14, [[-0.5, -17.5, 0.5, -16.5]], 'metal');
  trench(b, -0.5, -17.5, 0.5, -16.5, 0.4, R, true);
  ceilingSlab(b, -3, -20, 3, -13.6, H);

  wallFace(b, { n: '-z', plane: -14, from: -2.8, to: 2.8, h: H, t: 0.4, openings: [{ c: 0, w: 3.0, h: 3.0, margin: 0.1 }], seed: 11, trayY: 0 });
  wallFace(b, { n: '+z', plane: -19.8, from: -2.8, to: 2.8, h: H, t: 0.2, openings: [{ c: 0, w: 3.0, h: 2.8 }], seed: 12, trayY: 0 });
  wallFace(b, { n: '+x', plane: -2.8, from: -19.8, to: -14, h: H, t: 0.2, openings: [{ c: -17, w: 1.6, h: 2.4 }], seed: 13, features: 0.3, ext: [0, 0.2] });
  wallFace(b, { n: '-x', plane: 2.8, from: -19.8, to: -14, h: H, t: 0.2, openings: [{ c: -17, w: 1.6, h: 2.4 }], seed: 14, features: 0, ext: [0, 0.2] });

  // archway portal frame
  b.box('trim_steel', -1.57, 1.5, -14.0, 0.14, 3.0, 0.5).box('trim_steel', 1.57, 1.5, -14.0, 0.14, 3.0, 0.5);
  b.box('trim_steel', 0, 3.07, -14.0, 3.3, 0.14, 0.5);
  b.detail(() => {
    for (const s of [-1, 1]) b.bx('hazard_stripes', s * 1.64 - 0.05, 0.3, -14.26, s * 1.64 + 0.05, 2.6, -14.25);
    b.bx('hazard_stripes', -1.5, -0.01, -14.3, 1.5, 0.004, -14.0);
  });

  // ── ceiling: cross of beams, ring of conduit around the sign hub ──
  ibeam(b, 'trim_steel', 'x', 0, H - 0.11, -17, 5.6, 0.14, 0.22);
  ibeam(b, 'trim_steel', 'z', 0, H - 0.11, -17, 5.8, 0.14, 0.22);
  for (const z of [-15.3, -18.7]) b.box('trim_steel', 0, H - 0.06, z, 5.6, 0.12, 0.1);
  b.detail(() => {
    pipe(b, 'copper', [[-2.6, H - 0.2, -14.3], [-2.6, H - 0.2, -19.5]], 0.05, { every: 1.8 });
    pipe(b, 'steel_raw', [[2.55, H - 0.2, -14.3], [2.55, H - 0.2, -15.6], [1.7, H - 0.2, -15.6], [1.7, H - 0.2, -19.5]], 0.04, { every: 1.5 });
    cableBundle(b, [-1.2, H - 0.12, -14.2], [-1.2, H - 0.12, -16.9], 3, 0.12, 0.014, 0.05, R);
    cableBundle(b, [-1.2, H - 0.12, -17.1], [-1.2, H - 0.12, -19.6], 3, 0.1, 0.014, 0.05, R);
    cableBundle(b, [0.15, H - 0.12, -17.2], [2.6, H - 0.12, -17.2], 4, 0.14, 0.014, 0.05, R);
  });

  // ── hanging signage hub ──
  const hy = 2.62;
  for (const sx of [-0.55, 0.55]) for (const sz of [-0.55, 0.55]) b.rod('steel_raw', sx, H - 0.2, -17 + sz, sx, hy + 0.2, -17 + sz, 0.012, 5);
  b.box('painted_dark', 0, hy, -17, 1.5, 0.44, 1.5);
  b.detail(() => {
    b.box('trim_steel', 0, hy + 0.23, -17, 1.56, 0.03, 1.56).box('trim_steel', 0, hy - 0.23, -17, 1.56, 0.03, 1.56);
    // seen arriving from the corridor (facing +Z)
    b.sign('FABRICATION HALL 3 ^', 'directional', 0, hy + 0.1, -16.25, 1.4, 0.18, '+z');
    b.sign('← SECURITY 3      STORAGE →', 'directional', 0, hy - 0.11, -16.25, 1.4, 0.16, '+z');
    // seen coming back from the fab lock
    b.sign('MEDICAL 3-A ^', 'directional', 0, hy + 0.1, -17.75, 1.4, 0.18, '-z');
    b.sign('← STORAGE      SECURITY 3 →', 'directional', 0, hy - 0.11, -17.75, 1.4, 0.16, '-z');
    b.sign('← FAB HALL 3    MEDICAL →', 'directional', 0.75, hy, -17, 1.4, 0.18, '+x');
    b.sign('← MEDICAL    FAB HALL 3 →', 'directional', -0.75, hy, -17, 1.4, 0.18, '-x');
    b.box('emissive_cyan', 0, hy - 0.25, -17, 1.3, 0.012, 0.03).box('emissive_cyan', 0, hy - 0.25, -17, 0.03, 0.012, 1.3);
  });

  // ── lights ──
  troffer(b, L, { group: 'junction', x: 0, y: H, z: -15.4, axis: 'x', intensity: 48, distance: 7.5, angle: 1.1, flicker: 'fluorescent', cast: true, priority: 2 });
  troffer(b, L, { group: 'junction', x: 0, y: H, z: -18.7, axis: 'x', intensity: 30, distance: 6.5, angle: 1.0, flicker: 'broken' });
  L.point('junction', 0, hy - 0.5, -17, 0x60e0ff, 2.5, 4.5);
  b.at(-2.8, 0, -18.45, PI / 2, () => bulkhead(b, L, 'junction', 0, 2.2, 0.04, 0xffb070, 5, 4.5));

  // ── props: bench + crates on the west side; east wall north bay stays clear for the android ──
  b.at(-2.4, 0, -15.1, PI / 2, () => bench(b, 1.3));
  b.at(-2.35, 0, -19.2, 0.15, () => crate(b, 0.7, 0.6, 0.6, 'painted_dark', 'HALCYON'));
  b.at(-2.4, 0.6, -19.25, -0.3, () => crate(b, 0.5, 0.35, 0.45, 'wall_panel', undefined, false));
  b.at(2.8, 0.55, -19.1, -PI / 2, () => fireExtinguisher(b));
  // android spot: oil underneath + scrape marks leading from the storage door
  b.decal('oil_stain', 2, 2.3, 0.002, -15.1, 1.2, 1.2, '+y', 0.8);
  b.decal('oil_drip', 0, 2.764, 0.5, -15.1, 0.4, 0.8, '-x');
  b.decal('scratches', 0, 2.2, 0.002, -16.0, 0.9, 1.3, '+y', 0.2);
  b.decal('scratches', 2, 2.764, 0.9, -15.0, 0.6, 0.6, '-x');

  // ── wall signs ──
  b.sign('JUNCTION 3', 'stencil', -2.764, 2.3, -15.4, 1.1, 0.24, '+x');
  b.sign('SECURITY 3', 'directional', -2.764, 1.75, -15.8, 0.55, 0.14, '+x', 0, true);
  b.sign('EQUIPMENT STORAGE', 'directional', 2.764, 1.75, -18.3, 0.75, 0.14, '-x', 0, true);
  b.sign('AUTHORISED PERSONNEL — FAB ACCESS LOCK', 'warning', 2.15, 1.75, -19.764, 0.9, 0.14, '+z', 0, true);
  b.sign('ARM-FREE ZONE BEYOND THIS POINT', 'danger', -2.15, 1.75, -19.764, 0.9, 0.14, '+z', 0, true);
  b.sign('3', 'stencil', 0, 0.003, -15.4, 0.9, 1.2, '+y');
  b.decal('grime', 0, -1.6, 0.002, -18.2, 2.0, 2.0, '+y', 1.0);
  b.decal('blood_smear', 2, 0.6, 0.002, -14.6, 0.5, 1.2, '+y', -0.5);
  b.decal('blood_smear', 0, -0.9, 0.002, -16.2, 0.5, 1.4, '+y', -1.2);
  b.decal('blood_smear', 1, -2.1, 0.002, -16.9, 0.5, 1.2, '+y', -1.5);

  L.enemy('g_junction', 'husk', 'dormant', 2.3, 0, -15.1, PI / 2, 'slumped');
}
